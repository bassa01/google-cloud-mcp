/**
 * Google Cloud Trace tools for MCP
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectId, initGoogleAuth } from "../../utils/auth.js";
import { GcpMcpError } from "../../utils/error.js";
import {
  buildTraceHierarchy,
  formatTraceData,
  extractTraceIdFromLog,
  TraceSpan,
  TraceStatus,
} from "./types.js";
import { Logging } from "@google-cloud/logging";
import { logger } from "../../utils/logger.js";
import {
  buildStructuredResponse,
  createTextPreview,
  previewList,
  previewRecordEntries,
  resolveBoundedNumber,
} from "../../utils/output.js";
import { stateManager } from "../../utils/state-manager.js";

const TRACE_SPAN_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.TRACE_SPAN_PREVIEW_LIMIT,
  50,
  { min: 10, max: 200 },
);

const TRACE_TRACE_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.TRACE_TRACE_PREVIEW_LIMIT,
  20,
  { min: 5, max: 100 },
);

const TRACE_ATTRIBUTE_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.TRACE_ATTRIBUTE_PREVIEW_LIMIT,
  15,
  { min: 5, max: 50 },
);

const TRACE_ANALYSIS_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.TRACE_ANALYSIS_PREVIEW_LIMIT,
  4000,
  { min: 500, max: 8000 },
);

/**
 * Registers Google Cloud Trace tools with the MCP server
 *
 * @param server The MCP server instance
 */
export async function registerTraceTools(server: McpServer): Promise<void> {
  // Tool to get a trace by ID
  server.tool(
    "gcp-trace-get-trace",
    {
      traceId: z.string().describe("The trace ID to retrieve"),
      projectId: z
        .string()
        .optional()
        .describe("Optional Google Cloud project ID"),
    },
    async ({ traceId, projectId }, _context) => {
      try {
        // Use provided project ID or get the default one from state manager first
        const actualProjectId =
          projectId ||
          stateManager.getCurrentProjectId() ||
          (await getProjectId());

        // Validate trace ID format (hex string)
        if (typeof traceId === "string" && !traceId.match(/^[a-f0-9]+$/i)) {
          throw new GcpMcpError(
            "Invalid trace ID format. Trace ID should be a hexadecimal string.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        // Initialize Google Auth client
        const auth = await initGoogleAuth(true);
        if (!auth) {
          throw new GcpMcpError(
            "Google Cloud authentication not available. Please configure authentication to access trace data.",
            "UNAUTHENTICATED",
            401,
          );
        }
        const client = await auth.getClient();
        const token = await client.getAccessToken();

        // Fetch the trace from the Cloud Trace API v1
        // API Reference: https://cloud.google.com/trace/docs/reference/v1/rest/v1/projects.traces/get
        const apiUrl = `https://cloudtrace.googleapis.com/v1/projects/${actualProjectId}/traces/${traceId}`;
        logger.debug(`Fetching trace from: ${apiUrl}`);
        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token.token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new GcpMcpError(
            `Failed to fetch trace: ${errorText}`,
            "FAILED_PRECONDITION",
            response.status,
          );
        }

        const traceData = await response.json();

        // Log the raw trace data for debugging
        logger.debug(`Raw trace data: ${JSON.stringify(traceData, null, 2)}`);

        // Debug: Log the exact structure of the trace data
        logger.debug("Trace data structure:");
        logger.debug(`- Type: ${typeof traceData}`);
        logger.debug(`- Keys: ${Object.keys(traceData).join(", ")}`);
        logger.debug(`- Has spans array: ${Array.isArray(traceData.spans)}`);
        logger.debug(`- Spans array length: ${traceData.spans?.length || 0}`);

        // Check if we have valid trace data
        // In v1 API, the response is a Trace object with spans array
        if (!traceData || !traceData.spans || traceData.spans.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No trace found with ID: ${traceId} in project: ${actualProjectId}`,
              },
            ],
          };
        }

        // Log the trace structure for debugging
        logger.debug(
          `Trace structure: projectId=${traceData.projectId}, traceId=${traceData.traceId}, spans count=${traceData.spans.length}`,
        );

        // Log the first span to help with debugging
        if (traceData.spans && traceData.spans.length > 0) {
          const firstSpan = traceData.spans[0];
          logger.debug(
            `First span example: ${JSON.stringify(firstSpan, null, 2)}`,
          );
          logger.debug(
            `First span fields: ${Object.keys(firstSpan).join(", ")}`,
          );

          // Debug: Log specific fields that we're looking for in the span
          logger.debug("Span field details:");
          logger.debug(`- spanId: ${firstSpan.spanId}`);
          logger.debug(`- name: ${firstSpan.name}`);
          logger.debug(`- displayName: ${firstSpan.displayName}`);
          logger.debug(`- startTime: ${firstSpan.startTime}`);
          logger.debug(`- endTime: ${firstSpan.endTime}`);
          logger.debug(`- parentSpanId: ${firstSpan.parentSpanId}`);
          logger.debug(`- kind: ${firstSpan.kind}`);
          logger.debug(`- Has labels: ${!!firstSpan.labels}`);

          if (firstSpan.labels) {
            logger.debug(
              `- Label keys: ${Object.keys(firstSpan.labels).join(", ")}`,
            );
            logger.debug(
              `- HTTP path label: ${firstSpan.labels["/http/path"]}`,
            );
            logger.debug(
              `- HTTP method label: ${firstSpan.labels["/http/method"]}`,
            );
            logger.debug(
              `- Component label: ${firstSpan.labels["/component"]}`,
            );
          }
        }

        logger.debug(
          `Found ${traceData.spans.length} spans in trace ${traceId}`,
        );

        try {
          logger.debug("Starting to build trace hierarchy...");

          traceData.spans.forEach((span: any, index: number) => {
            logger.debug(`Span ${index} (ID: ${span.spanId}):`);
            logger.debug(`- Name: ${span.name || "undefined"}`);
            logger.debug(`- Parent: ${span.parentSpanId || "None"}`);
            logger.debug(`- Has labels: ${!!span.labels}`);
          });

          const hierarchicalTrace = buildTraceHierarchy(
            actualProjectId.toString(),
            traceId.toString(),
            traceData.spans,
          );

          const formattedTrace = formatTraceData(hierarchicalTrace);
          const hierarchyPreview = createTextPreview(
            formattedTrace,
            TRACE_ANALYSIS_PREVIEW_LIMIT,
          );

          const { displayed: spanPreview, omitted: spansOmitted } = previewList(
            hierarchicalTrace.allSpans,
            TRACE_SPAN_PREVIEW_LIMIT,
          );

          const text = buildStructuredResponse({
            title: "Trace Details",
            metadata: {
              projectId: actualProjectId,
              traceId,
              spanCount: hierarchicalTrace.allSpans.length,
            },
            dataLabel: "trace",
            data: {
              summary: {
                rootSpanCount: hierarchicalTrace.rootSpans.length,
                failedSpanCount: hierarchicalTrace.allSpans.filter(
                  (span) => span.status === TraceStatus.ERROR,
                ).length,
              },
              spans: spanPreview.map(summarizeSpan),
              spansOmitted,
              hierarchyMarkdown: hierarchyPreview.text,
              hierarchyTruncated: hierarchyPreview.truncated,
            },
            preview: {
              total: hierarchicalTrace.allSpans.length,
              displayed: spanPreview.length,
              omitted: spansOmitted,
              limit: TRACE_SPAN_PREVIEW_LIMIT,
              label: "spans",
            },
          });

          return {
            content: [
              {
                type: "text",
                text,
              },
            ],
          };
        } catch (hierarchyError: any) {
          logger.error(
            `Error building trace hierarchy: ${hierarchyError.message}`,
          );

          const fallbackSpans = traceData.spans || [];
          const { displayed, omitted } = previewList(
            fallbackSpans,
            TRACE_SPAN_PREVIEW_LIMIT,
          );

          const text = buildStructuredResponse({
            title: "Trace Details (Fallback)",
            metadata: {
              projectId: actualProjectId,
              traceId,
              error: hierarchyError.message,
            },
            dataLabel: "spans",
            data: {
              spans: displayed.map((span: any) => ({
                spanId: span.spanId,
                name: span.name,
                parentSpanId: span.parentSpanId,
                startTime: span.startTime,
                endTime: span.endTime,
              })),
              spansOmitted: omitted,
            },
            preview: {
              total: fallbackSpans.length,
              displayed: displayed.length,
              omitted,
              limit: TRACE_SPAN_PREVIEW_LIMIT,
              label: "spans",
              emptyMessage: "No spans were available in the fallback payload.",
            },
          });

          return {
            content: [
              {
                type: "text",
                text,
              },
            ],
          };
        }
      } catch (error: any) {
        // Error handling for get-trace tool
        throw new GcpMcpError(
          `Failed to fetch trace: ${error.message}`,
          error.code || "UNKNOWN",
          error.statusCode || 500,
        );
      }
    },
  );

  // Tool to list recent traces
  server.tool(
    "gcp-trace-list-traces",
    {
      projectId: z
        .string()
        .optional()
        .describe("Optional Google Cloud project ID"),
      filter: z
        .string()
        .optional()
        .describe(
          'Optional filter for traces (e.g., "status.code != 0" for errors)',
        ),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe("Maximum number of traces to return"),
      startTime: z
        .string()
        .optional()
        .describe(
          'Start time in RFC3339 format (e.g., "2023-01-01T00:00:00Z") or relative time (e.g., "1h", "2d")',
        ),
    },
    async ({ projectId, filter, limit, startTime }, _context) => {
      try {
        // Use provided project ID or get the default one from state manager first
        const actualProjectId =
          projectId ||
          stateManager.getCurrentProjectId() ||
          (await getProjectId());

        // Calculate time range
        const endTime = new Date();
        let startTimeDate: Date;

        if (startTime) {
          logger.debug(`Raw startTime parameter: ${JSON.stringify(startTime)}`);

          // Handle the case where startTime might be passed as an object from JSON
          const startTimeStr =
            typeof startTime === "string" ? startTime : String(startTime);
          logger.debug(`Processing startTime: ${startTimeStr}`);

          // Check if the input is a relative time format (e.g., "1h", "2d", "30m")
          if (startTimeStr.match(/^\d+[hmd]$/)) {
            // Parse relative time (e.g., "1h", "2d")
            const value = parseInt(startTimeStr.slice(0, -1));
            const unit = startTimeStr.slice(-1);

            startTimeDate = new Date(endTime);
            if (unit === "h") {
              startTimeDate.setHours(startTimeDate.getHours() - value);
            } else if (unit === "d") {
              startTimeDate.setDate(startTimeDate.getDate() - value);
            } else if (unit === "m") {
              startTimeDate.setMinutes(startTimeDate.getMinutes() - value);
            }
            logger.debug(
              `Parsed relative time: ${startTimeStr} to ${startTimeDate.toISOString()}`,
            );
          } else {
            // Parse ISO format
            try {
              startTimeDate = new Date(startTimeStr);
              if (isNaN(startTimeDate.getTime())) {
                throw new Error("Invalid date format");
              }
              logger.debug(
                `Parsed ISO time: ${startTimeStr} to ${startTimeDate.toISOString()}`,
              );
            } catch (error: unknown) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              logger.error(`Error parsing time: ${errorMessage}`);
              throw new GcpMcpError(
                `Invalid start time format: "${startTimeStr}". Use ISO format or relative time (e.g., "1h", "2d").`,
                "INVALID_ARGUMENT",
                400,
              );
            }
          }
        } else {
          // Default to 1 hour ago
          startTimeDate = new Date(endTime);
          startTimeDate.setHours(startTimeDate.getHours() - 1);
        }

        // Initialize Google Auth client
        const auth = await initGoogleAuth(true);
        if (!auth) {
          throw new GcpMcpError(
            "Google Cloud authentication not available. Please configure authentication to access trace data.",
            "UNAUTHENTICATED",
            401,
          );
        }
        const client = await auth.getClient();
        const token = await client.getAccessToken();

        // Format timestamps in RFC3339 UTC "Zulu" format as required by the API
        // Example format: "2014-10-02T15:01:23Z"
        // The Cloud Trace API requires RFC3339 format timestamps
        const startTimeUTC = startTimeDate.toISOString();
        const endTimeUTC = endTime.toISOString();

        logger.debug(
          `Using formatted timestamps: startTime=${startTimeUTC}, endTime=${endTimeUTC}`,
        );

        // Build the query parameters for the request according to the API documentation
        const queryParams = new URLSearchParams();

        // Required parameters - format must be RFC3339 UTC "Zulu" format
        // The Cloud Trace API requires timestamps in RFC3339 format
        // Example: "2014-10-02T15:01:23Z"
        queryParams.append("startTime", startTimeUTC); // Start of the time interval (inclusive)
        queryParams.append("endTime", endTimeUTC); // End of the time interval (inclusive)

        // Optional parameters
        queryParams.append("pageSize", limit.toString()); // Maximum number of traces to return

        // The view parameter is optional and defaults to MINIMAL
        // ROOTSPAN includes the root span with the trace
        // COMPLETE includes all spans with the trace
        queryParams.append("view", "COMPLETE"); // Type of data returned (MINIMAL, ROOTSPAN, COMPLETE)

        // Add orderBy parameter to sort by most recent traces first
        queryParams.append("orderBy", "start desc"); // Sort by start time descending

        // Optional filter parameter
        if (filter) {
          queryParams.append("filter", filter); // Filter against labels for the request
        }

        // Construct the URL for the Cloud Trace API v1 endpoint
        // The correct endpoint format according to the documentation is:
        // GET https://cloudtrace.googleapis.com/v1/projects/{projectId}/traces
        const apiUrl = `https://cloudtrace.googleapis.com/v1/projects/${actualProjectId}/traces`;
        const requestUrl = `${apiUrl}?${queryParams.toString()}`;

        logger.debug(`List Traces URL: ${requestUrl}`);
        logger.debug(
          `List Traces Query Params: ${JSON.stringify(Object.fromEntries(queryParams.entries()))}`,
        );
        logger.debug(
          `List Traces Time Range: ${startTimeDate.toISOString()} to ${endTime.toISOString()}`,
        );
        logger.debug(`List Traces Raw Query String: ${queryParams.toString()}`);

        // Fetch traces from the Cloud Trace API
        logger.debug(`Sending request to Cloud Trace API: ${requestUrl}`);
        let tracesData;

        try {
          const response = await fetch(requestUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token.token}`,
              Accept: "application/json",
            },
          });

          logger.debug(`List Traces Response Status: ${response.status}`);

          if (!response.ok) {
            const errorText = await response.text();
            logger.error(`List Traces Error: ${errorText}`);
            throw new GcpMcpError(
              `Failed to list traces: ${errorText}`,
              "FAILED_PRECONDITION",
              response.status,
            );
          }

          // Log the full response headers to help debug
          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });
          logger.debug(
            `List Traces Response Headers: ${JSON.stringify(responseHeaders)}`,
          );

          tracesData = await response.json();
          logger.debug(
            `List Traces Response Data: ${JSON.stringify(tracesData, null, 2)}`,
          );
        } catch (fetchError: any) {
          logger.error(`Fetch error: ${fetchError.message}`);
          throw new GcpMcpError(
            `Failed to fetch traces: ${fetchError.message}`,
            "INTERNAL",
            500,
          );
        }

        // Check if we have valid traces data
        // In v1 API, the response contains a traces array
        if (!tracesData.traces || tracesData.traces.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No traces found matching the criteria in project: ${actualProjectId}`,
              },
            ],
          };
        }

        // Use the helper function to format the response
        return formatTracesResponse(
          tracesData,
          actualProjectId,
          startTimeDate,
          endTime,
          filter,
        );
      } catch (error: any) {
        // Error handling for list-traces tool
        throw new GcpMcpError(
          `Failed to list traces: ${error.message}`,
          error.code || "UNKNOWN",
          error.statusCode || 500,
        );
      }
    },
  );

  // Tool to find traces associated with logs
  server.tool(
    "gcp-trace-find-from-logs",
    {
      projectId: z
        .string()
        .optional()
        .describe("Optional Google Cloud project ID"),
      filter: z
        .string()
        .describe(
          'Filter for logs (e.g., severity>=ERROR AND timestamp>"-1d")',
        ),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe("Maximum number of logs to check"),
    },
    async ({ projectId, filter, limit }, _context) => {
      try {
        // Use provided project ID or get the default one from state manager first
        const actualProjectId =
          projectId ||
          stateManager.getCurrentProjectId() ||
          (await getProjectId());

        // Process the filter to handle relative time formats
        let processedFilter = filter;

        // Check for relative time patterns in the filter
        const relativeTimeRegex = /(timestamp[><]=?\s*["'])(-?\d+[hmd])(["'])/g;
        processedFilter = processedFilter.replace(
          relativeTimeRegex,
          (
            match: string,
            prefix: string,
            timeValue: string,
            suffix: string,
          ) => {
            logger.debug(
              `Found relative time in filter: ${match}, timeValue: ${timeValue}`,
            );

            // Parse the relative time
            const value = parseInt(timeValue.slice(1, -1));
            const unit = timeValue.slice(-1);
            const isNegative = timeValue.startsWith("-");

            // Calculate the absolute time
            const now = new Date();
            const targetDate = new Date(now);

            if (unit === "h") {
              targetDate.setHours(
                targetDate.getHours() + (isNegative ? -value : value),
              );
            } else if (unit === "d") {
              targetDate.setDate(
                targetDate.getDate() + (isNegative ? -value : value),
              );
            } else if (unit === "m") {
              targetDate.setMinutes(
                targetDate.getMinutes() + (isNegative ? -value : value),
              );
            }

            // Format as RFC3339
            const formattedTime = targetDate.toISOString();
            logger.debug(
              `Converted relative time ${timeValue} to absolute time: ${formattedTime}`,
            );

            // Return the updated filter part
            return `${prefix}${formattedTime}${suffix}`;
          },
        );

        logger.debug(`Original filter: ${filter}`);
        logger.debug(`Processed filter: ${processedFilter}`);

        // Initialize the logging client
        const logging = new Logging({
          projectId: actualProjectId,
        });

        // Fetch logs with the processed filter
        const [entries] = await logging.getEntries({
          filter: processedFilter,
          pageSize: limit,
        });

        if (!entries || entries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No logs found matching the filter: "${filter}" in project: ${actualProjectId}`,
              },
            ],
          };
        }

        // Extract trace IDs from logs
        const traceMap = new Map<
          string,
          {
            traceId: string;
            timestamp: string;
            severity: string;
            logName: string;
            message: string;
          }
        >();

        for (const entry of entries) {
          const metadata = entry.metadata;
          const traceId = extractTraceIdFromLog(metadata);

          if (traceId) {
            // Convert timestamp to string
            let timestampStr = "Unknown";
            if (metadata.timestamp) {
              if (typeof metadata.timestamp === "string") {
                timestampStr = metadata.timestamp;
              } else {
                try {
                  // Handle different timestamp formats
                  if (
                    typeof metadata.timestamp === "object" &&
                    metadata.timestamp !== null
                  ) {
                    if (
                      "seconds" in metadata.timestamp &&
                      "nanos" in metadata.timestamp
                    ) {
                      // Handle Timestamp proto format
                      const seconds = Number(metadata.timestamp.seconds);
                      const nanos = Number(metadata.timestamp.nanos || 0);
                      const milliseconds = seconds * 1000 + nanos / 1000000;
                      timestampStr = new Date(milliseconds).toISOString();
                    } else {
                      // Try to convert using JSON
                      timestampStr = JSON.stringify(metadata.timestamp);
                    }
                  } else {
                    timestampStr = String(metadata.timestamp);
                  }
                } catch {
                  timestampStr = "Invalid timestamp";
                }
              }
            }

            // Convert severity to string
            let severityStr = "DEFAULT";
            if (metadata.severity) {
              severityStr = String(metadata.severity);
            }

            // Convert logName to string
            let logNameStr = "Unknown";
            if (metadata.logName) {
              logNameStr = String(metadata.logName);
            }

            // Extract message
            let messageStr = "No message";
            if (metadata.textPayload) {
              messageStr = String(metadata.textPayload);
            } else if (metadata.jsonPayload) {
              try {
                messageStr = JSON.stringify(metadata.jsonPayload);
              } catch {
                messageStr = "Invalid JSON payload";
              }
            }

            traceMap.set(traceId, {
              traceId,
              timestamp: timestampStr,
              severity: severityStr,
              logName: logNameStr,
              message: messageStr,
            });
          }
        }

        if (traceMap.size === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No traces found in the logs matching the filter: "${filter}" in project: ${actualProjectId}`,
              },
            ],
          };
        }

        // Format the traces for display
        let markdown = `# Traces Found in Logs\n\n`;
        markdown += `Project: ${actualProjectId}\n`;
        markdown += `Log Filter: ${filter}\n`;
        markdown += `Found ${traceMap.size} unique traces in ${entries.length} log entries:\n\n`;

        // Table header
        markdown +=
          "| Trace ID | Timestamp | Severity | Log Name | Message |\n";
        markdown += "|----------|-----------|----------|----------|--------|\n";

        // Table rows
        for (const trace of traceMap.values()) {
          const traceId = trace.traceId;
          // Handle timestamp formatting safely
          let timestamp = trace.timestamp;
          try {
            if (timestamp !== "Unknown" && timestamp !== "Invalid timestamp") {
              timestamp = new Date(trace.timestamp).toISOString();
            }
          } catch {
            // Keep the original timestamp if conversion fails
          }
          const severity = trace.severity;
          const logName = trace.logName.split("/").pop() || trace.logName;
          const message =
            trace.message.length > 100
              ? trace.message.substring(0, 100) + "..."
              : trace.message;

          markdown += `| \`${traceId}\` | ${timestamp} | ${severity} | ${logName} | ${message} |\n`;
        }

        markdown +=
          "\n\nTo view a specific trace, use the `get-trace` tool with the trace ID.";

        return {
          content: [
            {
              type: "text",
              text: markdown,
            },
          ],
        };
      } catch (error: any) {
        // Error handling for find-traces-from-logs tool
        throw new GcpMcpError(
          `Failed to find traces from logs: ${error.message}`,
          error.code || "UNKNOWN",
          error.statusCode || 500,
        );
      }
    },
  );

}

/**
 * Calculates the duration between two timestamps
 *
 * @param startTime The start time
 * @param endTime The end time
 * @returns Formatted duration string
 */
function calculateDuration(startTime: string, endTime: string): string {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const durationMs = end - start;

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = ((durationMs % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Formats the traces response for display
 *
 * @param tracesData The traces data from the API
 * @param projectId The Google Cloud project ID
 * @param startTime The start time of the query
 * @param endTime The end time of the query
 * @param filter The filter used in the query
 * @returns Formatted response
 */
function formatTracesResponse(
  tracesData: any,
  projectId: string,
  startTime: Date,
  endTime: Date,
  filter?: string,
): any {
  const traces = tracesData.traces || [];
  const { displayed, omitted } = previewList(traces, TRACE_TRACE_PREVIEW_LIMIT);

  const text = buildStructuredResponse({
    title: "Trace List",
    metadata: {
      projectId,
      timeRange: `${startTime.toISOString()} -> ${endTime.toISOString()}`,
      filter,
      totalTraces: traces.length,
    },
    dataLabel: "traces",
    data: {
      traces: displayed.map((trace: any) =>
        summarizeTraceListItem(trace, projectId),
      ),
      tracesOmitted: omitted,
    },
    preview: {
      total: traces.length,
      displayed: displayed.length,
      omitted,
      limit: TRACE_TRACE_PREVIEW_LIMIT,
      label: "traces",
      emptyMessage: "No traces found matching the criteria.",
    },
  });

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

interface TraceSpanSummaryPayload {
  spanId: string;
  name: string;
  parentSpanId?: string;
  startTime: string;
  endTime: string;
  durationMs?: number;
  status: TraceStatus;
  kind?: string;
  attributes?: Record<string, string>;
  attributesOmitted?: number;
}

function summarizeSpan(span: TraceSpan): TraceSpanSummaryPayload {
  const { displayed, omitted } = previewRecordEntries(
    span.attributes,
    TRACE_ATTRIBUTE_PREVIEW_LIMIT,
  );

  const durationMs = (() => {
    const start = new Date(span.startTime).getTime();
    const end = new Date(span.endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return end - start;
    }
    return undefined;
  })();

  return {
    spanId: span.spanId,
    name: span.displayName,
    parentSpanId: span.parentSpanId,
    startTime: span.startTime,
    endTime: span.endTime,
    durationMs,
    status: span.status,
    kind: span.kind,
    attributes: Object.keys(displayed).length ? displayed : undefined,
    attributesOmitted: omitted || undefined,
  };
}

interface TraceListItemPayload {
  traceId: string;
  projectId: string;
  displayName?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  spanCount?: number;
  statusCode?: number;
}

function summarizeTraceListItem(
  trace: any,
  projectId: string,
): TraceListItemPayload {
  return {
    traceId: trace.traceId,
    projectId,
    displayName: trace.displayName,
    startTime: trace.startTime,
    endTime: trace.endTime,
    duration: calculateDuration(trace.startTime, trace.endTime),
    spanCount: Array.isArray(trace.spans) ? trace.spans.length : undefined,
    statusCode: trace.status?.code,
  };
}
