/**
 * Google Cloud BigQuery tools for MCP
 */
import { type QueryResultsOptions } from "@google-cloud/bigquery";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectId } from "../../utils/auth.js";
import { logger } from "../../utils/logger.js";
import {
  buildStructuredTextBlock,
  previewList,
  resolveBoundedNumber,
} from "../../utils/output.js";
import { getBigQueryClient } from "./types.js";
import { assertReadOnlyBigQueryQuery } from "./query-safety.js";
import { GcpMcpError } from "../../utils/error.js";

const BIGQUERY_ROW_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.BIGQUERY_ROW_PREVIEW_LIMIT,
  50,
  { min: 5, max: 500 },
);

function normalizeString(value?: string | string[] | null): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
}

function buildRowsResponse<T>({
  title,
  metadata,
  rows,
  context,
  dataLabel = "rows",
  emptyMessage,
  additionalNote,
}: {
  title: string;
  metadata: Record<string, unknown>;
  rows: T[];
  context?: Record<string, unknown>;
  dataLabel?: string;
  emptyMessage?: string;
  additionalNote?: string;
}): string {
  const { displayed, omitted } = previewList(rows, BIGQUERY_ROW_PREVIEW_LIMIT);
  const noteParts: string[] = [];

  if (omitted > 0) {
    noteParts.push(
      `Showing ${displayed.length} of ${rows.length} rows (preview limit ${BIGQUERY_ROW_PREVIEW_LIMIT}).`,
    );
  }

  if (rows.length === 0 && emptyMessage) {
    noteParts.push(emptyMessage);
  }

  if (additionalNote) {
    noteParts.push(additionalNote);
  }

  const payload =
    context && Object.keys(context).length > 0
      ? { ...context, rows: displayed }
      : displayed;

  return buildStructuredTextBlock({
    title,
    metadata: {
      ...metadata,
      rowsReturned: rows.length,
      omitted,
    },
    dataLabel,
    data: payload,
    note: noteParts.length ? noteParts.join(" ") : undefined,
  });
}

function coerceQueryResultsOptions(
  options?: QueryResultsOptions,
): QueryResultsOptions | undefined {
  if (!options) {
    return undefined;
  }

  const sanitized: QueryResultsOptions = {};
  if (options.maxResults !== undefined) {
    sanitized.maxResults = options.maxResults;
  }

  if (options.timeoutMs !== undefined) {
    sanitized.timeoutMs = options.timeoutMs;
  }

  if (options.startIndex !== undefined) {
    sanitized.startIndex = options.startIndex;
  }

  return sanitized;
}

export function registerBigQueryTools(server: McpServer): void {
  server.tool(
    "gcp-bigquery-execute-query",
    {
      sql: z
        .string()
        .min(1)
        .describe(
          "Read-only SQL query (SELECT/WITH/EXPLAIN/SHOW/DESCRIBE) to execute against BigQuery.",
        ),
      projectId: z
        .string()
        .optional()
        .describe(
          "Overrides the Google Cloud project ID used for the query.",
        ),
      location: z
        .string()
        .optional()
        .describe(
          "BigQuery location/region for the job (defaults to BIGQUERY_LOCATION env var).",
        ),
      defaultDataset: z
        .object({
          datasetId: z.string().describe("Dataset ID used for unqualified tables."),
          projectId: z
            .string()
            .optional()
            .describe("Project that owns the default dataset (defaults to the query project)."),
        })
        .optional()
        .describe(
          "Optional default dataset applied to the query when table references are unqualified.",
        ),
      params: z
        .record(z.string(), z.any())
        .optional()
        .describe("Query parameters in BigQuery JSON format."),
      maximumBytesBilled: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Caps the bytes billed for the query; the job fails if the estimate exceeds this value.",
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("If true, validates and estimates cost without executing the query."),
      useLegacySql: z
        .boolean()
        .optional()
        .describe("Set true to run legacy SQL (default false for standard SQL)."),
      resultOptions: z
        .object({
          maxResults: z.number().int().positive().optional(),
          timeoutMs: z.number().int().positive().optional(),
          startIndex: z.number().int().nonnegative().optional(),
        })
        .optional()
        .describe(
          "Advanced overrides passed to BigQuery's getQueryResults (maxResults, timeoutMs, startIndex).",
        ),
    },
    async (
      {
        sql,
        projectId,
        location,
        defaultDataset,
        params,
        maximumBytesBilled,
        dryRun,
        useLegacySql,
        resultOptions,
      },
      _extra,
    ) => {
      try {
        assertReadOnlyBigQueryQuery(sql);

        const normalizedProjectId = normalizeString(projectId);
        const resolvedProjectId =
          normalizedProjectId || (await getProjectId());

        if (!resolvedProjectId) {
          throw new GcpMcpError(
            "Project ID is required for BigQuery queries.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const normalizedLocation =
          normalizeString(location) || process.env.BIGQUERY_LOCATION;

        const bigquery = await getBigQueryClient(resolvedProjectId);
        logger.debug(
          `Using BigQuery client with project ID: ${resolvedProjectId} for gcp-bigquery-execute-query`,
        );

        const queryOptions = {
          query: sql,
          params: params || {},
          location: normalizedLocation,
          defaultDataset: defaultDataset
            ? {
                datasetId: defaultDataset.datasetId,
                projectId: defaultDataset.projectId || resolvedProjectId,
              }
            : undefined,
          maximumBytesBilled,
          dryRun: dryRun ?? false,
          useLegacySql: useLegacySql ?? false,
        };

        const [job] = await bigquery.createQueryJob(queryOptions);
        const [metadata] = await job.getMetadata();

        const jobErrors = metadata.status?.errors ?? [];
        if (jobErrors.length > 0) {
          throw new GcpMcpError(
            `BigQuery job failed: ${jobErrors
              .map((error) => error.message)
              .join("; ")}`,
            "FAILED_PRECONDITION",
            400,
            jobErrors,
          );
        }

        const queryStats = metadata.statistics?.query ?? {};
        const isDryRun =
          queryOptions.dryRun === true ||
          metadata.configuration?.query?.dryRun === true;

        let rows: Record<string, unknown>[] = [];
        if (!isDryRun) {
          const [resultRows] = await job.getQueryResults(
            coerceQueryResultsOptions(resultOptions),
          );
          rows = (resultRows as Record<string, unknown>[]) ?? [];
        }

        const jobReference = metadata.jobReference ?? {};
        const jobId =
          job.id ||
          jobReference.jobId ||
          "unknown-job";

        const text = buildRowsResponse({
          title: isDryRun
            ? "BigQuery Query Dry Run"
            : "BigQuery Query Results",
          metadata: {
            projectId: resolvedProjectId,
            location: jobReference.location || normalizedLocation,
            jobId,
            cacheHit: queryStats.cacheHit,
            totalBytesProcessed: queryStats.totalBytesProcessed,
            totalBytesBilled: queryStats.totalBytesBilled,
            totalSlotMs: queryStats.totalSlotMs,
            dryRun: isDryRun,
          },
          rows,
          context: {
            sql,
            params: params || {},
            jobId,
            statistics: queryStats,
            defaultDataset: queryOptions.defaultDataset,
            maximumBytesBilled,
            location: jobReference.location || normalizedLocation,
            dryRun: isDryRun,
          },
          dataLabel: "result",
          emptyMessage: isDryRun
            ? "Dry run completed; no rows were retrieved."
            : "Query executed successfully, but no rows were returned.",
          additionalNote: isDryRun
            ? "Dry run mode validates the query and estimates cost without executing it."
            : undefined,
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
          `Error executing BigQuery query: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );
}
