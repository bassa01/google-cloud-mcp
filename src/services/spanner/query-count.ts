/**
 * Tool for retrieving Spanner query count metrics
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetricServiceClient } from "@google-cloud/monitoring";
import { z } from "zod";
import { getProjectId } from "../../utils/auth.js";
import { GcpMcpError } from "../../utils/error.js";
import { parseRelativeTime } from "../../utils/time.js";
import { logger } from "../../utils/logger.js";
import {
  buildStructuredTextBlock,
  previewList,
  resolveBoundedNumber,
} from "../../utils/output.js";

const QUERY_COUNT_SERIES_LIMIT = resolveBoundedNumber(
  process.env.SPANNER_QUERY_COUNT_SERIES_LIMIT,
  5,
  { min: 1, max: 20 },
);

const QUERY_COUNT_POINT_LIMIT = resolveBoundedNumber(
  process.env.SPANNER_QUERY_COUNT_POINT_LIMIT,
  60,
  { min: 10, max: 240 },
);

/**
 * Interface for time series data points
 */
interface TimeSeriesPoint {
  interval: {
    startTime: {
      seconds: number;
      nanos: number;
    };
    endTime: {
      seconds: number;
      nanos: number;
    };
  };
  value: {
    int64Value?: string;
    doubleValue?: number;
    boolValue?: boolean;
    stringValue?: string;
    distributionValue?: any;
  };
}

/**
 * Interface for time series data
 */
interface TimeSeriesData {
  metric: {
    type: string;
    labels?: Record<string, string>;
  };
  resource: {
    type: string;
    labels: Record<string, string>;
  };
  metricKind: string;
  valueType: string;
  points: TimeSeriesPoint[];
}

/**
 * Registers the Spanner query count tool with the MCP server
 *
 * @param server The MCP server instance
 */
export function registerSpannerQueryCountTool(server: McpServer): void {
  server.tool(
    "gcp-spanner-query-count",
    {
      instanceId: z
        .string()
        .optional()
        .describe(
          "Spanner instance ID (optional, if not provided will show all instances)",
        ),
      databaseId: z
        .string()
        .optional()
        .describe(
          "Spanner database ID (optional, if not provided will show all databases)",
        ),
      queryType: z
        .enum(["ALL", "READ", "QUERY"])
        .default("ALL")
        .describe("Type of queries to count (ALL, READ, QUERY)"),
      status: z
        .enum(["ALL", "OK", "ERROR"])
        .default("ALL")
        .describe("Status of queries to count (ALL, OK, ERROR)"),
      startTime: z
        .string()
        .default("1h")
        .describe('Start time for the query (e.g., "1h", "2d", "30m")'),
      endTime: z
        .string()
        .optional()
        .describe("End time for the query (defaults to now)"),
      alignmentPeriod: z
        .string()
        .default("60s")
        .describe(
          'Alignment period for aggregating data points (e.g., "60s", "5m", "1h")',
        ),
    },
    async (
      {
        instanceId,
        databaseId,
        queryType,
        status,
        startTime,
        endTime,
        alignmentPeriod,
      },
      _context,
    ) => {
      try {
        const projectId = await getProjectId();
        const client = new MetricServiceClient({
          projectId: process.env.GOOGLE_CLOUD_PROJECT,
        });

        // Parse time range
        const start = parseRelativeTime(startTime);
        const end = endTime ? parseRelativeTime(endTime) : new Date();

        // Build filter for the metric
        let filter = 'metric.type = "spanner.googleapis.com/query_count"';

        // Add resource filters if specified
        if (instanceId) {
          filter += ` AND resource.labels.instance_id = "${instanceId}"`;
        }

        // Add metric label filters
        if (databaseId) {
          filter += ` AND metric.labels.database = "${databaseId}"`;
        }

        if (queryType !== "ALL") {
          filter += ` AND metric.labels.query_type = "${queryType.toLowerCase()}"`;
        }

        if (status !== "ALL") {
          filter += ` AND metric.labels.status = "${status.toLowerCase()}"`;
        }

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

        // Build the request
        const request = {
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
          aggregation: {
            alignmentPeriod: {
              seconds,
            },
            perSeriesAligner: "ALIGN_SUM",
            crossSeriesReducer: "REDUCE_SUM",
          },
        };

        // Execute the request
        const timeSeriesData = await client.listTimeSeries(request as any);
        const timeSeries = timeSeriesData[0];

        if (!timeSeries || timeSeries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Spanner Query Count\n\nProject: ${projectId}\n${instanceId ? `\nInstance: ${instanceId}` : ""}\n${databaseId ? `\nDatabase: ${databaseId}` : ""}\n\nQuery Type: ${queryType}\nStatus: ${status}\nTime Range: ${start.toISOString()} to ${end.toISOString()}\nAlignment Period: ${alignmentPeriod}\n\nNo query count data found for the specified parameters.`,
              },
            ],
          };
        }

        const { displayed: seriesSubset, omitted: seriesOmitted } = previewList(
          timeSeries,
          QUERY_COUNT_SERIES_LIMIT,
        );

        const summaries = seriesSubset.map((series) => {
          const seriesData = series as unknown as TimeSeriesData;
          const sortedPoints = [...(seriesData.points || [])].sort((a, b) => {
            const aTime = Number(a.interval.startTime.seconds);
            const bTime = Number(b.interval.startTime.seconds);
            return aTime - bTime;
          });

          const { displayed: pointSubset, omitted: pointOmitted } = previewList(
            sortedPoints,
            QUERY_COUNT_POINT_LIMIT,
          );

          return {
            instance: seriesData.resource.labels.instance_id || "unknown",
            database: seriesData.metric.labels?.database || "all",
            queryType: seriesData.metric.labels?.query_type || "all",
            status: seriesData.metric.labels?.status || "all",
            optimizerVersion:
              seriesData.metric.labels?.optimizer_version || "unknown",
            points: pointSubset.map((point) => ({
              timestamp: new Date(
                Number(point.interval.endTime.seconds) * 1000,
              ).toISOString(),
              count:
                point.value.int64Value ??
                point.value.doubleValue ??
                point.value.stringValue ??
                "0",
            })),
            pointsOmitted: pointOmitted,
          };
        });

        const noteParts: string[] = [];
        if (seriesOmitted > 0) {
          noteParts.push(
            `Showing ${summaries.length} of ${timeSeries.length} time series (preview limit ${QUERY_COUNT_SERIES_LIMIT}).`,
          );
        }

        const text = buildStructuredTextBlock({
          title: "Spanner Query Count",
          metadata: {
            projectId,
            instanceId,
            databaseId,
            queryType,
            status,
            alignmentPeriod,
            timeRange: `${start.toISOString()} -> ${end.toISOString()}`,
          },
          dataLabel: "series",
          data: summaries,
          note: noteParts.length ? noteParts.join(" ") : undefined,
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
        logger.error(
          `Error in gcp-spanner-query-count tool: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );
}
