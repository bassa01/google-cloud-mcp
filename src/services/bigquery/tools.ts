/**
 * Google Cloud BigQuery tools for MCP
 */
import {
  type Dataset,
  type DatasetResponse,
  type Query,
  type QueryResultsOptions,
  type Table,
  type TableField,
  type TableMetadata,
} from "@google-cloud/bigquery";
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

const BIGQUERY_DATASET_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.BIGQUERY_DATASET_PREVIEW_LIMIT,
  25,
  { min: 5, max: 100 },
);

const BIGQUERY_TABLE_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.BIGQUERY_TABLE_PREVIEW_LIMIT,
  25,
  { min: 5, max: 100 },
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

type QueryResultOptionsInput = {
  maxResults?: number;
  timeoutMs?: number;
  startIndex?: number;
};

function coerceQueryResultsOptions(
  options?: QueryResultOptionsInput,
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
    sanitized.startIndex = options.startIndex.toString();
  }

  return sanitized;
}

async function getDatasetMetadata(
  dataset: Dataset,
): Promise<DatasetResponse[1]> {
  if (dataset.metadata) {
    return dataset.metadata;
  }

  const [metadata] = await dataset.getMetadata();
  return metadata;
}

async function getTableMetadata(table: Table): Promise<TableMetadata> {
  if (table.metadata) {
    return table.metadata;
  }

  const [metadata] = await table.getMetadata();
  return metadata;
}

function extractProjectIdFromResourceId(
  resourceId?: string,
): string | undefined {
  if (!resourceId) {
    return undefined;
  }

  const [project] = resourceId.split(":");
  return project;
}

function buildDatasetSummary(
  metadata: DatasetResponse[1],
): Record<string, unknown> {
  const datasetReference = metadata.datasetReference ?? {};
  const datasetId =
    datasetReference.datasetId || metadata.id?.split(":")[1] || metadata.id;

  return {
    datasetId,
    projectId:
      datasetReference.projectId || extractProjectIdFromResourceId(metadata.id),
    friendlyName: metadata.friendlyName,
    description: metadata.description,
    location: metadata.location,
    labels: metadata.labels,
    defaultTableExpirationMs: metadata.defaultTableExpirationMs,
    defaultPartitionExpirationMs: metadata.defaultPartitionExpirationMs,
    lastModifiedTime: metadata.lastModifiedTime,
    access: metadata.access,
  };
}

function buildTableSummary(metadata: TableMetadata): Record<string, unknown> {
  const tableReference = metadata.tableReference ?? {};

  return {
    tableId: tableReference.tableId || metadata.id,
    datasetId: tableReference.datasetId,
    projectId:
      tableReference.projectId || extractProjectIdFromResourceId(metadata.id),
    type: metadata.type,
    friendlyName: metadata.friendlyName,
    description: metadata.description,
    location: metadata.location,
    numRows: metadata.numRows,
    numBytes: metadata.numBytes,
    timePartitioning: metadata.timePartitioning,
    rangePartitioning: metadata.rangePartitioning,
    clustering: metadata.clustering?.fields,
    creationTime: metadata.creationTime,
    expirationTime: metadata.expirationTime,
    requirePartitionFilter: metadata.timePartitioning?.requirePartitionFilter,
  };
}

function mapSchemaFields(fields?: TableField[]): Record<string, unknown>[] {
  if (!fields || fields.length === 0) {
    return [];
  }

  return fields.map((field) => ({
    name: field.name,
    type: field.type,
    mode: field.mode,
    description: field.description,
    policyTags: field.policyTags?.names,
    fields: mapSchemaFields(field.fields as TableField[] | undefined),
  }));
}

function describePartitioning(metadata: TableMetadata): string | undefined {
  const parts: string[] = [];

  if (metadata.timePartitioning) {
    const { type, field } = metadata.timePartitioning;
    if (field) {
      parts.push(`Time partitioned by ${type} on column ${field}.`);
    } else {
      parts.push(`Ingestion-time partitioned by ${type}.`);
    }
  }

  if (metadata.rangePartitioning) {
    const { field, range } = metadata.rangePartitioning;
    const rangeDetail = range
      ? ` between ${range.start || "start"} and ${range.end || "end"} (step ${range.interval || "?"})`
      : "";
    parts.push(`Range partitioned on ${field || "(unspecified field)"}${rangeDetail}.`);
  }

  if (metadata.clustering?.fields?.length) {
    parts.push(
      `Clustered by ${metadata.clustering.fields.join(", ")}.`,
    );
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
}

function normalizeIdentifier(value: string | undefined): string {
  return value?.trim() ?? "";
}

function resolveDatasetReference(
  dataset: { datasetId: string; projectId?: string | null } | undefined,
  defaultProjectId: string,
): { datasetId: string; projectId: string } {
  if (!dataset) {
    throw new GcpMcpError(
      "Dataset reference is required (datasetId and optional projectId).",
      "INVALID_ARGUMENT",
      400,
    );
  }

  const datasetId = normalizeIdentifier(dataset.datasetId);
  if (!datasetId) {
    throw new GcpMcpError(
      "datasetId must be a non-empty string.",
      "INVALID_ARGUMENT",
      400,
    );
  }

  const datasetProjectId =
    normalizeString(dataset.projectId) || defaultProjectId;

  return {
    datasetId,
    projectId: datasetProjectId,
  };
}

function resolveTableReference(
  table: {
    datasetId: string;
    tableId: string;
    projectId?: string | null;
  },
  defaultProjectId: string,
): { datasetId: string; tableId: string; projectId: string } {
  const datasetId = normalizeIdentifier(table.datasetId);
  const tableId = normalizeIdentifier(table.tableId);

  if (!datasetId || !tableId) {
    throw new GcpMcpError(
      "table.datasetId and table.tableId must be provided.",
      "INVALID_ARGUMENT",
      400,
    );
  }

  const projectId = normalizeString(table.projectId) || defaultProjectId;

  return {
    datasetId,
    tableId,
    projectId,
  };
}

export function registerBigQueryTools(server: McpServer): void {
  server.tool(
    "gcp-bigquery-list-datasets",
    {
      projectId: z
        .string()
        .optional()
        .describe(
          "Overrides the Google Cloud project ID before listing datasets.",
        ),
    },
    async ({ projectId }, _extra) => {
      try {
        const normalizedProjectId = normalizeString(projectId);
        const resolvedProjectId =
          normalizedProjectId || (await getProjectId());

        if (!resolvedProjectId) {
          throw new GcpMcpError(
            "Project ID is required to list datasets.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const bigquery = await getBigQueryClient(resolvedProjectId);
        logger.debug(
          `Using BigQuery client with project ID: ${resolvedProjectId} for gcp-bigquery-list-datasets`,
        );

        const [datasets] = await bigquery.getDatasets();
        const datasetSummaries = await Promise.all(
          (datasets ?? []).map(async (dataset) => {
            const metadata = await getDatasetMetadata(dataset);
            return buildDatasetSummary(metadata);
          }),
        );

        const { displayed, omitted } = previewList(
          datasetSummaries,
          BIGQUERY_DATASET_PREVIEW_LIMIT,
        );

        const text = buildStructuredTextBlock({
          title: "BigQuery Datasets",
          metadata: {
            projectId: resolvedProjectId,
            totalDatasets: datasetSummaries.length,
          },
          dataLabel: "datasets",
          data: displayed,
          note:
            datasetSummaries.length === 0
              ? "No datasets found in this project."
              : omitted > 0
                ? `Showing ${displayed.length} of ${datasetSummaries.length} datasets (preview limit ${BIGQUERY_DATASET_PREVIEW_LIMIT}).`
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
          `Error listing BigQuery datasets: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    },
  );

  server.tool(
    "gcp-bigquery-list-tables",
    {
      dataset: z
        .object({
          datasetId: z
            .string()
            .min(1)
            .describe("Dataset ID containing the tables to list."),
          projectId: z
            .string()
            .optional()
            .describe(
              "Overrides the project where the dataset is located.",
            ),
        })
        .describe("Dataset reference (ID plus optional project override)."),
      projectId: z
        .string()
        .optional()
        .describe(
          "Default project ID when dataset.projectId is not provided.",
        ),
    },
    async ({ dataset, projectId }, _extra) => {
      try {
        const normalizedProjectId = normalizeString(projectId);
        const fallbackProjectId =
          normalizedProjectId || (await getProjectId());

        if (!fallbackProjectId) {
          throw new GcpMcpError(
            "Project ID is required to list tables.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const datasetRef = resolveDatasetReference(dataset, fallbackProjectId);
        const bigquery = await getBigQueryClient(datasetRef.projectId);
        logger.debug(
          `Using BigQuery client with project ID: ${datasetRef.projectId} for gcp-bigquery-list-tables`,
        );

        const datasetHandle = bigquery.dataset(datasetRef.datasetId, {
          projectId: datasetRef.projectId,
        });
        const [tables] = await datasetHandle.getTables();
        const tableSummaries = await Promise.all(
          (tables ?? []).map(async (table) => {
            const metadata = await getTableMetadata(table);
            return buildTableSummary(metadata);
          }),
        );

        const { displayed, omitted } = previewList(
          tableSummaries,
          BIGQUERY_TABLE_PREVIEW_LIMIT,
        );

        const text = buildStructuredTextBlock({
          title: "BigQuery Tables",
          metadata: {
            projectId: datasetRef.projectId,
            datasetId: datasetRef.datasetId,
            totalTables: tableSummaries.length,
          },
          dataLabel: "tables",
          data: displayed,
          note:
            tableSummaries.length === 0
              ? "No tables or views found in this dataset."
              : omitted > 0
                ? `Showing ${displayed.length} of ${tableSummaries.length} tables (preview limit ${BIGQUERY_TABLE_PREVIEW_LIMIT}).`
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
          `Error listing BigQuery tables: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    },
  );

  server.tool(
    "gcp-bigquery-get-table-schema",
    {
      table: z.object({
        datasetId: z
          .string()
          .min(1)
          .describe("Dataset ID that contains the table."),
        tableId: z
          .string()
          .min(1)
          .describe("Table ID whose schema should be fetched."),
        projectId: z
          .string()
          .optional()
          .describe("Overrides the project where the table lives."),
      }),
      projectId: z
        .string()
        .optional()
        .describe(
          "Default project ID when table.projectId is not provided.",
        ),
    },
    async ({ table, projectId }, _extra) => {
      try {
        const normalizedProjectId = normalizeString(projectId);
        const fallbackProjectId =
          normalizedProjectId || (await getProjectId());

        if (!fallbackProjectId) {
          throw new GcpMcpError(
            "Project ID is required to retrieve a table schema.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const tableRef = resolveTableReference(table, fallbackProjectId);
        const bigquery = await getBigQueryClient(tableRef.projectId);
        logger.debug(
          `Using BigQuery client with project ID: ${tableRef.projectId} for gcp-bigquery-get-table-schema`,
        );

        const datasetHandle = bigquery.dataset(tableRef.datasetId, {
          projectId: tableRef.projectId,
        });
        const tableHandle = datasetHandle.table(tableRef.tableId);
        const metadata = await getTableMetadata(tableHandle);

        const columns = mapSchemaFields(
          metadata.schema?.fields as TableField[] | undefined,
        );
        const partitionNote = describePartitioning(metadata);
        const noteParts = [] as string[];
        if (partitionNote) {
          noteParts.push(partitionNote);
        }
        if (columns.length === 0) {
          noteParts.push(
            "No schema fields reported; this may be a view or external table.",
          );
        }

        const text = buildStructuredTextBlock({
          title: "BigQuery Table Schema",
          metadata: {
            projectId: tableRef.projectId,
            datasetId: tableRef.datasetId,
            tableId: tableRef.tableId,
            type: metadata.type,
            location: metadata.location,
          },
          dataLabel: "schema",
          data: {
            table: {
              type: metadata.type,
              friendlyName: metadata.friendlyName,
              description: metadata.description,
              location: metadata.location,
              numRows: metadata.numRows,
              numBytes: metadata.numBytes,
              creationTime: metadata.creationTime,
              expirationTime: metadata.expirationTime,
            },
            columns,
            partitioning: {
              timePartitioning: metadata.timePartitioning,
              rangePartitioning: metadata.rangePartitioning,
              requirePartitionFilter:
                metadata.timePartitioning?.requirePartitionFilter,
            },
            clustering: metadata.clustering?.fields,
          },
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
          `Error getting BigQuery table schema: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    },
  );

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

        const queryOptions: Query = {
          query: sql,
          params: params || {},
          location: normalizedLocation,
          defaultDataset: defaultDataset
            ? {
                datasetId: defaultDataset.datasetId,
                projectId: defaultDataset.projectId || resolvedProjectId,
              }
            : undefined,
          maximumBytesBilled:
            maximumBytesBilled !== undefined
              ? maximumBytesBilled.toString()
              : undefined,
          dryRun: dryRun ?? false,
          useLegacySql: useLegacySql ?? false,
        };

        const [job] = await bigquery.createQueryJob(queryOptions);
        const [metadata] = await job.getMetadata();

        const jobErrors = metadata.status?.errors ?? [];
        if (jobErrors.length > 0) {
          throw new GcpMcpError(
            `BigQuery job failed: ${jobErrors
              .map((error: { message?: string }) => error.message ?? "Unknown error")
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
