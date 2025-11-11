/**
 * Google Cloud Error Reporting tools for MCP
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectId, initGoogleAuth } from "../../utils/auth.js";
import { GcpMcpError } from "../../utils/error.js";
import {
  analyseErrorPatternsAndSuggestRemediation,
  ErrorGroupStats,
  summarizeErrorGroup,
  summarizeErrorEvent,
} from "./types.js";
import {
  buildStructuredResponse,
  createTextPreview,
  previewList,
  resolveBoundedNumber,
} from "../../utils/output.js";

const ERROR_GROUP_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.ERROR_REPORTING_GROUP_PREVIEW_LIMIT,
  20,
  { min: 5, max: 50 },
);

const ERROR_EVENT_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.ERROR_REPORTING_EVENT_PREVIEW_LIMIT,
  10,
  { min: 3, max: 50 },
);

const ERROR_REPORTING_ANALYSIS_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.ERROR_REPORTING_ANALYSIS_PREVIEW_LIMIT,
  4000,
  { min: 500, max: 8000 },
);

const ERROR_TREND_TIMESLOT_LIMIT = resolveBoundedNumber(
  process.env.ERROR_REPORTING_TREND_POINTS_LIMIT,
  40,
  { min: 10, max: 200 },
);

const ERROR_TREND_MESSAGE_PREVIEW_LIMIT = 240;

function previewMarkdown(markdown?: string): {
  text?: string;
  truncated: boolean;
} {
  if (!markdown) {
    return { text: undefined, truncated: false };
  }

  const { text, truncated } = createTextPreview(
    markdown,
    ERROR_REPORTING_ANALYSIS_PREVIEW_LIMIT,
  );
  return { text, truncated };
}

const DEFAULT_INVESTIGATION_STEPS = [
  "Check Cloud Logging for related entries around the error timestamps.",
  "Review Monitoring dashboards for correlated latency or saturation signals.",
  "Audit recent deployments or configuration changes that align with the errors.",
  "Examine user agents, IPs, or request parameters for repeating patterns.",
  "Inspect distributed traces (if available) to follow the failing request path.",
];

/**
 * Registers Google Cloud Error Reporting tools with the MCP server
 *
 * @param server The MCP server instance
 */
export function registerErrorReportingTools(server: McpServer): void {
  // Tool to list error groups with filtering and time range support
  server.tool(
    "gcp-error-reporting-list-groups",
    {
      title: "List Error Groups",
      description:
        "List error groups from Google Cloud Error Reporting with optional filtering and time range",
      inputSchema: {
        timeRange: z
          .string()
          .optional()
          .default("1h")
          .describe('Time range to query: "1h", "6h", "24h"/"1d", "7d", "30d"'),
        serviceFilter: z.string().optional().describe("Filter by service name"),
        order: z
          .enum([
            "COUNT_DESC",
            "LAST_SEEN_DESC",
            "CREATED_DESC",
            "AFFECTED_USERS_DESC",
          ])
          .optional()
          .default("COUNT_DESC")
          .describe("Sort order for error groups"),
        pageSize: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum number of error groups to return"),
      },
    },
    async ({ timeRange, serviceFilter, order, pageSize }) => {
      try {
        const projectId = await getProjectId();

        // Initialize Google Auth client (same pattern as trace service)
        const auth = await initGoogleAuth(true);
        if (!auth) {
          throw new GcpMcpError(
            "Google Cloud authentication not available. Please configure authentication to access error reporting data.",
            "UNAUTHENTICATED",
            401,
          );
        }
        const client = await auth.getClient();
        const token = await client.getAccessToken();

        // Parse time range - ensure we have a valid timeRange value
        const actualTimeRange = timeRange || "1h";
        const actualOrder = order || "COUNT_DESC";
        const actualPageSize = pageSize || 20;

        // Map time range to Google Cloud Error Reporting periods
        let period: string;
        switch (actualTimeRange) {
          case "1h":
            period = "PERIOD_1_HOUR";
            break;
          case "6h":
            period = "PERIOD_6_HOURS";
            break;
          case "24h":
          case "1d":
            period = "PERIOD_1_DAY";
            break;
          case "7d":
            period = "PERIOD_1_WEEK";
            break;
          case "30d":
            period = "PERIOD_30_DAYS";
            break;
          default:
            // Default to 1 hour for any other time range
            period = "PERIOD_1_HOUR";
            break;
        }

        // Build query parameters
        const params = new URLSearchParams({
          "timeRange.period": period,
          order: actualOrder,
          pageSize: actualPageSize.toString(),
        });

        // Add service filter if provided
        if (serviceFilter) {
          params.set("serviceFilter.service", serviceFilter);
        }

        // Make REST API call using same fetch approach as trace service
        const apiUrl = `https://clouderrorreporting.googleapis.com/v1beta1/projects/${projectId}/groupStats?${params}`;

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
            `Failed to fetch error group stats: ${errorText}`,
            "FAILED_PRECONDITION",
            response.status,
          );
        }

        const data = await response.json();
        const errorGroupStats = (data.errorGroupStats || []) as ErrorGroupStats[];
        const groupPreviewLimit = Math.min(
          ERROR_GROUP_PREVIEW_LIMIT,
          actualPageSize,
        );
        const { displayed, omitted } = previewList(
          errorGroupStats,
          groupPreviewLimit,
        );

        const analysisPreview = previewMarkdown(
          analyseErrorPatternsAndSuggestRemediation(errorGroupStats),
        );

        const text = buildStructuredResponse({
          title: "Error Groups",
          metadata: {
            projectId,
            timeRange: actualTimeRange,
            serviceFilter,
            order: actualOrder,
            pageSize: actualPageSize,
            nextPageToken: data.nextPageToken,
          },
          dataLabel: "result",
          data: {
            summary: {
              totalGroups: errorGroupStats.length,
              nextPageToken: data.nextPageToken,
            },
            groups: displayed.map(summarizeErrorGroup),
            groupsOmitted: omitted,
            analysisMarkdown: analysisPreview.text,
            analysisTruncated: analysisPreview.truncated,
          },
          preview: {
            total: errorGroupStats.length,
            displayed: displayed.length,
            omitted,
            limit: groupPreviewLimit,
            label: "error groups",
            emptyMessage: "No error groups found.",
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
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        throw new GcpMcpError(
          `Failed to list error groups: ${errorMessage}`,
          "INTERNAL_ERROR",
          500,
        );
      }
    },
  );

  // Tool to get detailed information about a specific error group
  server.tool(
    "gcp-error-reporting-get-group-details",
    {
      title: "Get Error Group Details",
      description:
        "Get detailed information about a specific error group including recent events",
      inputSchema: {
        groupId: z.string().describe("Error group ID to get details for"),
        timeRange: z
          .string()
          .optional()
          .default("24h")
          .describe('Time range to query events (e.g., "1h", "24h", "7d")'),
        pageSize: z
          .number()
          .min(1)
          .max(100)
          .default(10)
          .describe("Maximum number of error events to return"),
      },
    },
    async ({ groupId, timeRange, pageSize }) => {
      try {
        const projectId = await getProjectId();
        // Initialize Google Auth client (same pattern as trace service)
        const auth = await initGoogleAuth(true);
        if (!auth) {
          throw new GcpMcpError(
            "Google Cloud authentication not available. Please configure authentication to access error reporting data.",
            "UNAUTHENTICATED",
            401,
          );
        }
        const client = await auth.getClient();
        const token = await client.getAccessToken();

        // Parse time range - ensure we have a valid timeRange value
        const actualTimeRange = timeRange || "24h";
        const actualPageSize = pageSize || 10;

        // Map time range to Google Cloud Error Reporting periods
        let period: string;
        switch (actualTimeRange) {
          case "1h":
            period = "PERIOD_1_HOUR";
            break;
          case "6h":
            period = "PERIOD_6_HOURS";
            break;
          case "24h":
          case "1d":
            period = "PERIOD_1_DAY";
            break;
          case "7d":
            period = "PERIOD_1_WEEK";
            break;
          case "30d":
            period = "PERIOD_30_DAYS";
            break;
          default:
            // Default to 1 day for event details
            period = "PERIOD_1_DAY";
            break;
        }

        // First, get the error group details using projects.groups/get
        // The group name format should be: projects/{projectId}/groups/{groupId}
        const groupName = `projects/${projectId}/groups/${groupId}`;
        const groupApiUrl = `https://clouderrorreporting.googleapis.com/v1beta1/${groupName}`;

        // Get group details
        const groupResponse = await fetch(groupApiUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token.token}`,
            Accept: "application/json",
          },
        });

        if (!groupResponse.ok) {
          const errorText = await groupResponse.text();
          throw new GcpMcpError(
            `Failed to fetch error group details: ${errorText}`,
            "FAILED_PRECONDITION",
            groupResponse.status,
          );
        }

        const groupData = await groupResponse.json();

        // Build query parameters for events API
        // groupId should be the raw group identifier for the events API
        const params = new URLSearchParams({
          groupId: groupId,
          "timeRange.period": period,
          pageSize: actualPageSize.toString(),
        });

        // Make REST API call to list events
        const apiUrl = `https://clouderrorreporting.googleapis.com/v1beta1/projects/${projectId}/events?${params}`;
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
            `Failed to fetch error events: ${errorText}`,
            "FAILED_PRECONDITION",
            response.status,
          );
        }

        const data = await response.json();
        const errorEvents = data.errorEvents || [];
        const eventPreviewLimit = Math.min(
          ERROR_EVENT_PREVIEW_LIMIT,
          actualPageSize,
        );
        const { displayed: previewedEvents, omitted: eventsOmitted } =
          previewList(errorEvents, eventPreviewLimit);

        const text = buildStructuredResponse({
          title: "Error Group Details",
          metadata: {
            projectId,
            groupId,
            timeRange: actualTimeRange,
            pageSize: actualPageSize,
            nextPageToken: data.nextPageToken,
          },
          dataLabel: "details",
          data: {
            group: {
              name: groupData.name,
              resolutionStatus: groupData.resolutionStatus,
              trackingIssues: groupData.trackingIssues,
            },
            events: previewedEvents.map(summarizeErrorEvent),
            eventsOmitted,
            nextPageToken: data.nextPageToken,
            investigationSteps: DEFAULT_INVESTIGATION_STEPS,
          },
          preview: {
            total: errorEvents.length,
            displayed: previewedEvents.length,
            omitted: eventsOmitted,
            limit: eventPreviewLimit,
            label: "events",
            emptyMessage:
              "No error events found for this group in the specified time range.",
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
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        throw new GcpMcpError(
          `Failed to get error group details: ${errorMessage}`,
          "INTERNAL_ERROR",
          500,
        );
      }
    },
  );

  // Tool to analyse error trends over time
  server.tool(
    "gcp-error-reporting-analyse-trends",
    {
      title: "Analyse Error Trends",
      description:
        "Analyse error trends over time to identify patterns and spikes",
      inputSchema: {
        timeRange: z
          .string()
          .optional()
          .default("24h")
          .describe('Time range to analyse (e.g., "1h", "24h", "7d")'),
        serviceFilter: z.string().optional().describe("Filter by service name"),
        resolution: z
          .enum(["1m", "5m", "1h", "1d"])
          .optional()
          .default("1h")
          .describe("Time resolution for trend analysis"),
      },
    },
    async ({ timeRange, serviceFilter, resolution }) => {
      try {
        const projectId = await getProjectId();
        // Initialize Google Auth client (same pattern as trace service)
        const auth = await initGoogleAuth(true);
        if (!auth) {
          throw new GcpMcpError(
            "Google Cloud authentication not available. Please configure authentication to access error reporting data.",
            "UNAUTHENTICATED",
            401,
          );
        }
        const client = await auth.getClient();
        const token = await client.getAccessToken();

        // Parse time range - ensure we have a valid timeRange value
        const actualTimeRange = timeRange || "24h";
        const actualResolution = resolution || "1h";

        // Map time range to Google Cloud Error Reporting periods
        let period: string;
        switch (actualTimeRange) {
          case "1h":
            period = "PERIOD_1_HOUR";
            break;
          case "6h":
            period = "PERIOD_6_HOURS";
            break;
          case "24h":
          case "1d":
            period = "PERIOD_1_DAY";
            break;
          case "7d":
            period = "PERIOD_1_WEEK";
            break;
          case "30d":
            period = "PERIOD_30_DAYS";
            break;
          default:
            // Default to 1 day for trend analysis
            period = "PERIOD_1_DAY";
            break;
        }

        // Calculate timed count duration based on resolution
        let timedCountDuration: string;
        switch (actualResolution) {
          case "1m":
            timedCountDuration = "60s";
            break;
          case "5m":
            timedCountDuration = "300s";
            break;
          case "1h":
            timedCountDuration = "3600s";
            break;
          case "1d":
            timedCountDuration = "86400s";
            break;
          default:
            timedCountDuration = "3600s"; // Default to 1 hour
            break;
        }

        // Build query parameters for trends analysis
        const params = new URLSearchParams({
          "timeRange.period": period,
          timedCountDuration: timedCountDuration,
          order: "COUNT_DESC",
          pageSize: "50",
        });

        // Add service filter if provided
        if (serviceFilter) {
          params.set("serviceFilter.service", serviceFilter);
        }

        // Make REST API call for trends
        const apiUrl = `https://clouderrorreporting.googleapis.com/v1beta1/projects/${projectId}/groupStats?${params}`;
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
            `Failed to fetch error trends: ${errorText}`,
            "FAILED_PRECONDITION",
            response.status,
          );
        }

        const data = await response.json();
        const errorGroupStats = (data.errorGroupStats || []) as ErrorGroupStats[];

        const groupPreview = previewList(
          errorGroupStats,
          ERROR_GROUP_PREVIEW_LIMIT,
        );

        const timeSlots = new Map<string, number>();
        let totalErrors = 0;

        errorGroupStats.forEach((stat) => {
          const count = parseCount(stat.count);
          totalErrors += count;

          (stat.timedCounts || []).forEach((timedCount) => {
            if (!timedCount.startTime) {
              return;
            }
            const slotCount = parseCount(timedCount.count);
            timeSlots.set(
              timedCount.startTime,
              (timeSlots.get(timedCount.startTime) || 0) + slotCount,
            );
          });
        });

        const sortedTimeSlots = Array.from(timeSlots.entries()).sort(
          ([a], [b]) => new Date(a).getTime() - new Date(b).getTime(),
        );

        const timelinePreview = previewList(
          sortedTimeSlots,
          ERROR_TREND_TIMESLOT_LIMIT,
        );
        const timeline = timelinePreview.displayed.map(([time, count]) => ({
          time,
          count,
        }));

        const averageErrors =
          sortedTimeSlots.length > 0
            ? totalErrors / sortedTimeSlots.length
            : 0;

        const spikes = averageErrors
          ? sortedTimeSlots
              .filter(([, count]) => count > averageErrors * 2)
              .map(([time, count]) => ({
                time,
                count,
                multiple: Number((count / averageErrors).toFixed(1)),
              }))
          : [];

        const topErrors = errorGroupStats.slice(0, 5).map((stat) => {
          const { text } = createTextPreview(
            stat.representative?.message || "No message",
            ERROR_TREND_MESSAGE_PREVIEW_LIMIT,
          );
          const count = parseCount(stat.count);
          return {
            groupId: stat.group?.groupId ?? stat.group?.name,
            service: stat.representative?.serviceContext?.service || "Unknown",
            message: text,
            count,
            percentage:
              totalErrors > 0
                ? Math.round((count / totalErrors) * 100)
                : undefined,
          };
        });

        const recommendations = buildTrendRecommendations(
          spikes.length,
          topErrors.length,
          averageErrors,
          actualResolution,
        );

        const text = buildStructuredResponse({
          title: "Error Trends Analysis",
          metadata: {
            projectId,
            timeRange: actualTimeRange,
            serviceFilter,
            resolution: actualResolution,
          },
          dataLabel: "trends",
          data: {
            summary: {
              totalGroups: errorGroupStats.length,
              totalErrors,
              averagePerGroup:
                errorGroupStats.length > 0
                  ? Math.round(totalErrors / errorGroupStats.length)
                  : 0,
            },
            groups: groupPreview.displayed.map(summarizeErrorGroup),
            groupsOmitted: groupPreview.omitted,
            timeline,
            timelineOmitted: timelinePreview.omitted,
            spikes: spikes.slice(0, 5),
            topContributors: topErrors,
            recommendations,
          },
          preview: {
            total: errorGroupStats.length,
            displayed: groupPreview.displayed.length,
            omitted: groupPreview.omitted,
            limit: ERROR_GROUP_PREVIEW_LIMIT,
            label: "error groups",
            emptyMessage: "No error data found for trend analysis.",
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
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        throw new GcpMcpError(
          `Failed to analyse error trends: ${errorMessage}`,
          "INTERNAL_ERROR",
          500,
        );
      }
    },
  );
}

function parseCount(value?: string | number | null): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function buildTrendRecommendations(
  spikeCount: number,
  contributorCount: number,
  averageErrors: number,
  resolution?: string,
): string[] {
  const recs: string[] = [];

  if (spikeCount > 0) {
    recs.push(
      `Investigate the ${spikeCount} time windows where error volumes exceeded 2x the rolling average (${Math.round(averageErrors)}).`,
    );
    recs.push(
      "Correlate spikes with recent deployments or configuration changes to spot regressions.",
    );
  }

  if (contributorCount > 0) {
    recs.push(
      `Monitor the top ${Math.min(3, contributorCount)} contributing error groups—they drive the majority of volume.`,
    );
  }

  if (averageErrors > 0) {
    const alertThreshold = Math.round(averageErrors * 1.5);
    recs.push(
      `Set alerts for error rates above ${alertThreshold} per ${resolution ?? "sample window"} to catch emerging spikes early.`,
    );
  }

  recs.push(
    "Review recurring patterns (user agent, region, request path) to isolate chronic issues.",
  );

  return recs;
}
