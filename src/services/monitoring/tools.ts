/**
 * Google Cloud Monitoring tools for MCP
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectId } from "../../utils/auth.js";
import { GcpMcpError } from "../../utils/error.js";
import { formatTimeSeriesData, getMonitoringClient } from "./types.js";
import { parseRelativeTime } from "../../utils/time.js";
import {
  buildStructuredTextBlock,
  createTextPreview,
} from "../../utils/output.js";

/**
 * Registers Google Cloud Monitoring tools with the MCP server
 *
 * @param server The MCP server instance
 */
export async function registerMonitoringTools(
  server: McpServer,
): Promise<void> {
  // Tool to query metrics with a custom filter and time range
  server.tool(
    "gcp-monitoring-query-metrics",
    {
      filter: z.string().describe("The filter to apply to metrics"),
      startTime: z
        .string()
        .describe(
          'Start time in ISO format or relative time (e.g., "1h", "2d")',
        ),
      endTime: z
        .string()
        .optional()
        .describe("End time in ISO format (defaults to now)"),
      alignmentPeriod: z
        .string()
        .optional()
        .describe('Alignment period (e.g., "60s", "300s")'),
    },
    async ({ filter, startTime, endTime, alignmentPeriod }) => {
      try {
        const projectId = await getProjectId();
        const client = getMonitoringClient();

        const start = parseRelativeTime(startTime);
        const end = endTime ? parseRelativeTime(endTime) : new Date();

        // Build request
        const request: any = {
          name: `projects/${projectId}`,
          filter,
          interval: {
            startTime: {
              seconds: Math.floor(start.getTime() / 1000),
              nanos: 0,
            },
            endTime: {
              seconds: Math.floor(end.getTime() / 1000),
              nanos: 0,
            },
          },
        };

        // Add alignment if specified
        if (alignmentPeriod) {
          // Parse alignment period (e.g., "60s" -> 60 seconds)
          const match = alignmentPeriod.match(/^(\d+)([smhd])$/);
          if (!match) {
            throw new GcpMcpError(
              'Invalid alignment period format. Use format like "60s", "5m", "1h".',
              "INVALID_ARGUMENT",
              400,
            );
          }

          const value = parseInt(match[1]);
          const unit = match[2];
          let seconds = value;

          switch (unit) {
            case "m": // minutes
              seconds = value * 60;
              break;
            case "h": // hours
              seconds = value * 60 * 60;
              break;
            case "d": // days
              seconds = value * 60 * 60 * 24;
              break;
          }

          request.aggregation = {
            alignmentPeriod: {
              seconds: seconds,
            },
            perSeriesAligner: "ALIGN_MEAN",
          };
        }

        const [timeSeries] = await client.listTimeSeries(request);

        if (!timeSeries || timeSeries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Metric Query Results\n\nProject: ${projectId}\nFilter: ${filter}\nTime Range: ${start.toISOString()} to ${end.toISOString()}\n\nNo metrics found matching the filter.`,
              },
            ],
          };
        }

        const formattedData = formatTimeSeriesData(timeSeries);
        const note =
          formattedData.omittedSeries > 0
            ? `Showing ${formattedData.series.length} of ${formattedData.totalSeries} series.`
            : undefined;
        const text = buildStructuredTextBlock({
          title: "Metric Query Results",
          metadata: {
            projectId,
            filter,
            timeRange: `${start.toISOString()} -> ${end.toISOString()}`,
            alignment: alignmentPeriod,
          },
          dataLabel: "series",
          data: formattedData.series,
          note,
        });

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error: any) {
        throw new GcpMcpError(
          `Failed to query metrics: ${error.message}`,
          error.code || "UNKNOWN",
          error.statusCode || 500,
        );
      }
    },
  );

  // Tool to list available metric types
  server.tool(
    "gcp-monitoring-list-metric-types",
    {
      filter: z
        .string()
        .optional()
        .describe(
          'Simple search term (e.g., "spanner") or full filter expression (e.g., "metric.type = starts_with(\\"spanner\\")")',
        ),
      pageSize: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of metric types to return"),
      timeout: z
        .number()
        .min(5)
        .max(60)
        .default(30)
        .describe("Timeout in seconds for the request"),
    },
    async ({ filter, pageSize, timeout }) => {
      try {
        const projectId = await getProjectId();
        const client = getMonitoringClient();

        // Format the filter if it's a simple string without operators
        let formattedFilter = filter;
        let useClientSideFiltering = false;

        if (
          filter &&
          !filter.includes("=") &&
          !filter.includes(">") &&
          !filter.includes("<")
        ) {
          // If it's just a simple term, we'll use client-side filtering
          // We don't set a filter for the API call to avoid syntax errors
          formattedFilter = undefined;
          useClientSideFiltering = true;
        }

        // Create a promise that rejects after the timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Request timed out after ${timeout} seconds`));
          }, timeout * 1000);
        });

        // Create the actual request promise
        const requestPromise = (async () => {
          const request: any = {
            name: `projects/${projectId}`,
            pageSize,
          };

          if (formattedFilter) {
            request.filter = formattedFilter;
          }

          return await client.listMetricDescriptors(request);
        })();

        // Race the timeout against the actual request
        const [metricDescriptors] = (await Promise.race([
          requestPromise,
          timeoutPromise,
        ])) as [any];

        // Apply client-side filtering if needed
        let filteredDescriptors = metricDescriptors;
        if (useClientSideFiltering && filter) {
          const searchTerm = filter.toLowerCase();
          filteredDescriptors = metricDescriptors.filter((descriptor: any) => {
            // Search in the type name
            if (
              descriptor.type &&
              descriptor.type.toLowerCase().includes(searchTerm)
            ) {
              return true;
            }
            // Search in the display name
            if (
              descriptor.displayName &&
              descriptor.displayName.toLowerCase().includes(searchTerm)
            ) {
              return true;
            }
            // Search in the description
            if (
              descriptor.description &&
              descriptor.description.toLowerCase().includes(searchTerm)
            ) {
              return true;
            }
            return false;
          });
        }

        if (!filteredDescriptors || filteredDescriptors.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Available Metric Types\n\nProject: ${projectId}\n${filter ? `\nSearch term: "${filter}"` : ""}\n\nNo metric types found matching your search term. Try a different search term or increase the timeout.`,
              },
            ],
          };
        }

        const limitedDescriptors = filteredDescriptors.slice(0, 50).map(
          (descriptor: any) => {
            const { text, truncated } = descriptor.description
              ? createTextPreview(descriptor.description, 280)
              : { text: undefined, truncated: false };

            return {
              type: descriptor.type,
              displayName: descriptor.displayName,
              metricKind: descriptor.metricKind,
              valueType: descriptor.valueType,
              unit: descriptor.unit,
              labels: descriptor.labels?.map((label: any) => ({
                key: label.key,
                description: label.description,
              })),
              description: text,
              descriptionTruncated: truncated || undefined,
            };
          },
        );

        const noteParts: string[] = [];
        if (filteredDescriptors.length > 50) {
          noteParts.push(
            `Showing first 50 of ${filteredDescriptors.length} metric types. Use a narrower filter for more targeted results.`,
          );
        }
        if (useClientSideFiltering && filter) {
          noteParts.push(
            `Filtering was performed client-side by searching for "${filter}" within type, display name, and description.`,
          );
        }
        const note = noteParts.length ? noteParts.join(" ") : undefined;

        const text = buildStructuredTextBlock({
          title: "Available Metric Types",
          metadata: {
            projectId,
            filter: filter || "None",
            returned: limitedDescriptors.length,
            totalMatched: filteredDescriptors.length,
          },
          dataLabel: "descriptors",
          data: limitedDescriptors,
          note,
        });

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error: unknown) {
        // Extract error message safely
        let errorMessage = "Unknown error";
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === "object" && error !== null) {
          errorMessage = String(
            (error as any).message || JSON.stringify(error),
          );
        } else if (typeof error === "string") {
          errorMessage = error;
        }

        // Check for timeout errors
        if (errorMessage.includes("timed out")) {
          throw new GcpMcpError(
            `Request timed out. Try using a filter to narrow down results or increase the timeout parameter.`,
            "DEADLINE_EXCEEDED",
            504,
          );
        }

        // Handle other errors
        const errorCode = (error as any)?.code || "UNKNOWN";
        const statusCode = (error as any)?.statusCode || 500;

        throw new GcpMcpError(
          `Failed to list metric types: ${errorMessage}`,
          errorCode,
          statusCode,
        );
      }
    },
  );
}
