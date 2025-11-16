import { setTimeout as sleep } from "node:timers/promises";
import type { AuthClient } from "google-auth-library";
import { GcpMcpError } from "../../utils/error.js";
import {
  buildStructuredResponse,
  resolveBoundedNumber,
} from "../../utils/output.js";
import { initGoogleAuth } from "../../utils/auth.js";
import { logger } from "../../utils/logger.js";

const LOG_ANALYTICS_DEFAULT_LOCATION =
  process.env.LOG_ANALYTICS_LOCATION?.trim() || "global";
const LOG_ANALYTICS_DEFAULT_BUCKET =
  process.env.LOG_ANALYTICS_BUCKET?.trim() || "_Default";
const LOG_ANALYTICS_DEFAULT_VIEW =
  process.env.LOG_ANALYTICS_VIEW?.trim() || "_AllLogs";

const LOG_ANALYTICS_ROW_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.LOG_ANALYTICS_ROW_PREVIEW_LIMIT,
  50,
  { min: 5, max: 500 },
);

const QUERY_TIMEOUT_MS = resolveBoundedNumber(
  process.env.LOG_ANALYTICS_QUERY_TIMEOUT_MS,
  15000,
  { min: 1000, max: 600000 },
);

const READ_TIMEOUT_MS = resolveBoundedNumber(
  process.env.LOG_ANALYTICS_READ_TIMEOUT_MS,
  5000,
  { min: 500, max: 600000 },
);

const POLL_INTERVAL_MS = resolveBoundedNumber(
  process.env.LOG_ANALYTICS_POLL_INTERVAL_MS,
  1000,
  { min: 200, max: 10000 },
);

const MAX_POLL_ATTEMPTS = resolveBoundedNumber(
  process.env.LOG_ANALYTICS_MAX_POLL_ATTEMPTS,
  30,
  { min: 3, max: 200 },
);

interface JsonLike {
  [key: string]: unknown;
}

export interface LogAnalyticsViewSelection {
  projectId: string;
  location: string;
  bucketId: string;
  viewId: string;
}

export interface LogViewInput {
  resourceName?: string;
  projectId?: string;
  location?: string;
  bucketId?: string;
  viewId?: string;
}

export interface RunLogAnalyticsQueryOptions {
  sql: string;
  logViews: LogAnalyticsViewSelection[];
  rowLimit?: number;
  disableCache?: boolean;
  queryTimeoutMs?: number;
  readTimeoutMs?: number;
  placeholderApplied?: boolean;
}

export interface LogAnalyticsQueryResult {
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
  totalBytesProcessed?: number;
  totalSlotMs?: number;
  executionDuration?: string;
  jobLocation?: string;
  resultReference?: string;
  queryComplete: boolean;
  rowLimit: number;
  resourceNames: string[];
  primaryViewSqlIdentifier: string;
  queryStepHandle: string;
  restrictionConflicts?: JsonLike[];
  placeholderApplied: boolean;
  sql: string;
}

let cachedAuthorizedClient: AuthClient | null = null;

async function getAuthorizedHttpClient() {
  if (cachedAuthorizedClient) {
    return cachedAuthorizedClient;
  }

  const auth = await initGoogleAuth(true);
  if (!auth) {
    throw new GcpMcpError(
      "Google Cloud authentication is required to run Log Analytics queries.",
      "UNAUTHENTICATED",
      401,
    );
  }

  const client = await auth.getClient();
  cachedAuthorizedClient = client;
  return client;
}

function normalizeSegment(value: string, label: string): string {
  if (!value.trim()) {
    throw new GcpMcpError(
      `${label} is required for log analytics queries`,
      "INVALID_ARGUMENT",
      400,
    );
  }
  return value.trim();
}

export function resolveLogViewSelection(
  input: LogViewInput | undefined,
  fallbackProjectId: string,
): LogAnalyticsViewSelection {
  if (input?.resourceName) {
    const match = input.resourceName.match(
      /^projects\/([^/]+)\/locations\/([^/]+)\/buckets\/([^/]+)\/views\/([^/]+)$/,
    );
    if (!match) {
      throw new GcpMcpError(
        `Invalid log view resource name: ${input.resourceName}. Expected projects/{project}/locations/{location}/buckets/{bucket}/views/{view}.`,
        "INVALID_ARGUMENT",
        400,
      );
    }
    const [, projectId, location, bucketId, viewId] = match;
    return {
      projectId: normalizeSegment(projectId, "Project ID"),
      location: normalizeSegment(location, "Location"),
      bucketId: normalizeSegment(bucketId, "Bucket ID"),
      viewId: normalizeSegment(viewId, "View ID"),
    };
  }

  return {
    projectId:
      normalizeSegment(input?.projectId || fallbackProjectId, "Project ID"),
    location:
      normalizeSegment(
        input?.location || LOG_ANALYTICS_DEFAULT_LOCATION,
        "Location",
      ),
    bucketId: normalizeSegment(
      input?.bucketId || LOG_ANALYTICS_DEFAULT_BUCKET,
      "Bucket ID",
    ),
    viewId: normalizeSegment(
      input?.viewId || LOG_ANALYTICS_DEFAULT_VIEW,
      "View ID",
    ),
  };
}

export function buildLogViewResourceName(
  selection: LogAnalyticsViewSelection,
): string {
  return `projects/${selection.projectId}/locations/${selection.location}/buckets/${selection.bucketId}/views/${selection.viewId}`;
}

function escapeIdentifierComponent(value: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return value;
  }
  const escaped = value.replace(/`/g, "\\`");
  return `\`${escaped}\``;
}

export function buildSqlViewIdentifier(
  selection: LogAnalyticsViewSelection,
): string {
  return [
    escapeIdentifierComponent(selection.projectId),
    escapeIdentifierComponent(selection.location),
    escapeIdentifierComponent(selection.bucketId),
    escapeIdentifierComponent(selection.viewId),
  ].join(".");
}

interface QueryDataResponsePayload {
  queryStepHandles?: string[];
}

interface ReadQueryResultsResponsePayload {
  queryComplete?: boolean;
  rows?: Array<Record<string, unknown>>;
  nextPageToken?: string;
  totalRows?: number;
  totalBytesProcessed?: number;
  totalSlotMs?: number;
  executionDuration?: string;
  jobLocation?: string;
  resultReference?: string;
  restrictionConflicts?: JsonLike[];
}

async function callEntriesEndpoint<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  try {
    const client = await getAuthorizedHttpClient();
    const url = `https://logging.googleapis.com/v2/entries:${endpoint}`;
    const response = await client.request<T>({
      url,
      method: "POST",
      data: body,
    });
    return response.data;
  } catch (error) {
    const message = extractErrorMessage(error);
    const status =
      typeof error === "object" && error && "response" in error
        ? (error as { response?: { status?: number } }).response?.status ?? 500
        : 500;
    throw new GcpMcpError(
      `Log Analytics API error calling entries:${endpoint}: ${message}`,
      "UNKNOWN",
      status,
    );
  }
}

function extractErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error &&
    "response" in error &&
    (error as { response?: { data?: { error?: { message?: string } } } }).response
  ) {
    const err = (error as {
      response?: { data?: { error?: { message?: string } } };
    }).response?.data?.error?.message;
    if (err) {
      return err;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

const PLACEHOLDER_PATTERN = /{{\s*log_view\s*}}/gi;
const PLACEHOLDER_DETECTION_PATTERN = /{{\s*log_view\s*}}/i;

function applyLogViewPlaceholder(
  sql: string,
  identifier: string,
): { statement: string; applied: boolean } {
  if (!PLACEHOLDER_DETECTION_PATTERN.test(sql)) {
    return { statement: sql, applied: false };
  }

  const statement = sql.replace(PLACEHOLDER_PATTERN, identifier);
  return { statement, applied: true };
}

export async function runLogAnalyticsQuery(
  options: RunLogAnalyticsQueryOptions,
): Promise<LogAnalyticsQueryResult> {
  if (options.logViews.length === 0) {
    throw new GcpMcpError(
      "At least one log view is required to run a Log Analytics query.",
      "INVALID_ARGUMENT",
      400,
    );
  }

  const rowLimit = options.rowLimit ?? LOG_ANALYTICS_ROW_PREVIEW_LIMIT;
  const primaryIdentifier = buildSqlViewIdentifier(options.logViews[0]);
  const placeholderResult = applyLogViewPlaceholder(
    options.sql,
    primaryIdentifier,
  );

  const resourceNames = options.logViews.map((view) =>
    buildLogViewResourceName(view),
  );

  const queryTimeout = formatDuration(
    options.queryTimeoutMs ?? QUERY_TIMEOUT_MS,
  );

  const queryDataBody = {
    resourceNames,
    query: {
      querySteps: [
        {
          sqlQueryStep: {
            sqlQuery: placeholderResult.statement,
          },
        },
      ],
    },
    disableQueryCaching: options.disableCache ?? false,
    timeout: queryTimeout,
    clientId: "mcp-log-analytics",
  } satisfies Record<string, unknown>;

  logger.debug(
    `Running Log Analytics SQL via entries:queryData with views: ${resourceNames.join(", ")}`,
  );

  const queryDataResponse =
    await callEntriesEndpoint<QueryDataResponsePayload>(
      "queryData",
      queryDataBody,
    );

  const handle = queryDataResponse.queryStepHandles?.[0];
  if (!handle) {
    throw new GcpMcpError(
      "Log Analytics query did not return a handle to read results.",
      "INTERNAL",
      500,
    );
  }

  const readTimeout = formatDuration(options.readTimeoutMs ?? READ_TIMEOUT_MS);

  let pageToken: string | undefined;
  let totalRows: number | undefined;
  let totalBytesProcessed: number | undefined;
  let totalSlotMs: number | undefined;
  let executionDuration: string | undefined;
  let jobLocation: string | undefined;
  let resultReference: string | undefined;
  let restrictionConflicts: JsonLike[] | undefined;
  let queryComplete = false;

  const rows: Array<Record<string, unknown>> = [];
  let attempts = 0;

  do {
    const readBody = {
      queryStepHandle: handle,
      resourceNames,
      pageSize: Math.max(1, Math.min(rowLimit - rows.length, 1000)),
      pageToken,
      timeout: readTimeout,
      clientId: "mcp-log-analytics",
    } satisfies Record<string, unknown>;

    const readResponse =
      await callEntriesEndpoint<ReadQueryResultsResponsePayload>(
        "readQueryResults",
        readBody,
      );

    if (readResponse.rows?.length) {
      for (const row of readResponse.rows) {
        if (rows.length >= rowLimit) {
          break;
        }
        rows.push(row);
      }
    }

    totalRows = readResponse.totalRows ?? totalRows;
    totalBytesProcessed =
      readResponse.totalBytesProcessed ?? totalBytesProcessed;
    totalSlotMs = readResponse.totalSlotMs ?? totalSlotMs;
    executionDuration = readResponse.executionDuration ?? executionDuration;
    jobLocation = readResponse.jobLocation ?? jobLocation;
    resultReference = readResponse.resultReference ?? resultReference;
    restrictionConflicts =
      readResponse.restrictionConflicts ?? restrictionConflicts;

    queryComplete = Boolean(readResponse.queryComplete);
    pageToken = readResponse.nextPageToken;

    if (rows.length >= rowLimit) {
      break;
    }

    if (pageToken) {
      continue;
    }

    if (!queryComplete) {
      attempts += 1;
      if (attempts >= MAX_POLL_ATTEMPTS) {
        throw new GcpMcpError(
          "Timed out waiting for Log Analytics query to complete.",
          "DEADLINE_EXCEEDED",
          504,
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  } while ((!queryComplete || pageToken) && rows.length < rowLimit);

  return {
    rows,
    totalRows,
    totalBytesProcessed,
    totalSlotMs,
    executionDuration,
    jobLocation,
    resultReference,
    queryComplete,
    rowLimit,
    resourceNames,
    primaryViewSqlIdentifier: primaryIdentifier,
    queryStepHandle: handle,
    restrictionConflicts,
    placeholderApplied: placeholderResult.applied || options.placeholderApplied || false,
    sql: placeholderResult.statement,
  };
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;

  if (Number.isInteger(seconds)) {
    return `${seconds}s`;
  }

  return `${seconds
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "")}s`;
}

export function buildRestrictionSummary(
  conflicts: JsonLike[] | undefined,
): string | undefined {
  if (!conflicts || conflicts.length === 0) {
    return undefined;
  }

  const parts = conflicts.map((conflict) => {
    const typedConflict = conflict as {
      type?: unknown;
      line?: unknown;
      column?: unknown;
    };

    const type =
      typeof typedConflict.type === "string" && typedConflict.type.trim()
        ? typedConflict.type
        : "unknown";
    const lineValue = typedConflict.line;
    const columnValue = typedConflict.column;
    const line = (() => {
      if (typeof lineValue === "number") {
        return `line ${lineValue}`;
      }
      if (typeof lineValue === "string" && lineValue.trim()) {
        return `line ${lineValue.trim()}`;
      }
      return undefined;
    })();
    const column = (() => {
      if (typeof columnValue === "number") {
        return `column ${columnValue}`;
      }
      if (typeof columnValue === "string" && columnValue.trim()) {
        return `column ${columnValue.trim()}`;
      }
      return undefined;
    })();
    const location = [line, column].filter(Boolean).join(", ");
    return location ? `${type} conflict at ${location}` : `${type} conflict`;
  });

  return `Restrictions not applied: ${parts.join("; ")}.`;
}

export function formatLogAnalyticsRowsResponse({
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
  rows: Array<Record<string, unknown>>;
  context?: Record<string, unknown>;
  dataLabel?: string;
  emptyMessage?: string;
  additionalNote?: string;
}): string {
  const payload = context ? { ...context, rows } : rows;
  const totalRows =
    (metadata.totalRows as number | undefined) ?? rows.length;
  const rowLimit =
    (metadata.rowLimit as number | undefined) ??
    LOG_ANALYTICS_ROW_PREVIEW_LIMIT;
  const previewLabel = rows.length === 1 ? "row" : "rows";

  const additionalNotes = additionalNote ? [additionalNote] : undefined;

  return buildStructuredResponse({
    title,
    metadata: {
      rowsReturned: rows.length,
      ...metadata,
    },
    data: payload,
    dataLabel,
    preview: {
      total: totalRows,
      displayed: rows.length,
      label: previewLabel,
      limit: rowLimit,
      emptyMessage,
    },
    additionalNotes,
  });
}

export {
  LOG_ANALYTICS_ROW_PREVIEW_LIMIT,
  QUERY_TIMEOUT_MS,
  READ_TIMEOUT_MS,
};
