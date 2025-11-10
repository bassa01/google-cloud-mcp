import type { Database } from "@google-cloud/spanner";
import { createHash } from "node:crypto";
import { logger } from "../../utils/logger.js";

type QueryStatsWindowId = "MINUTE" | "10MINUTE" | "HOUR";

interface QueryWindowConfig {
  id: QueryStatsWindowId;
  label: string;
  shortLabel: string;
  tableName: string;
}

const QUERY_WINDOWS: QueryWindowConfig[] = [
  {
    id: "MINUTE",
    label: "Last minute",
    shortLabel: "1m",
    tableName: "SPANNER_SYS.QUERY_STATS_TOP_MINUTE",
  },
  {
    id: "10MINUTE",
    label: "Last 10 minutes",
    shortLabel: "10m",
    tableName: "SPANNER_SYS.QUERY_STATS_TOP_10MINUTE",
  },
  {
    id: "HOUR",
    label: "Last hour",
    shortLabel: "1h",
    tableName: "SPANNER_SYS.QUERY_STATS_TOP_HOUR",
  },
];

type QueryMetric = "latency" | "cpu";

interface QueryStatsRow {
  queryText: string;
  textFingerprint?: string;
  requestTag?: string | null;
  intervalEnd?: string | null;
  executionCount?: number | null;
  avgLatencySeconds?: number | null;
  avgCpuSeconds?: number | null;
  totalCpuSeconds?: number | null;
}

interface QueryMetricEntry {
  key: string;
  sampleQuery: string;
  requestTag?: string | null;
  windows: Partial<Record<QueryStatsWindowId, QueryStatsRow>>;
}

interface QueryStatsCollection {
  intervals: Record<QueryStatsWindowId, string | null>;
  latency: Map<string, QueryMetricEntry>;
  cpu: Map<string, QueryMetricEntry>;
}

export interface QueryStatsOptions {
  maxRows?: number;
}

export interface QueryStatsContext {
  projectId: string;
  instanceId: string;
  databaseId: string;
}

const DEFAULT_SQL_LIMIT = 15;
const DEFAULT_TABLE_ROWS = 5;

interface MetricWindows {
  minute?: number;
  tenMinute?: number;
  hour?: number;
}

interface MetricSummaryEntry {
  rank: number;
  fingerprint: string;
  sampleQuery: string;
  requestTag?: string | null;
  dominantWindow?: string | null;
  dominantValue?: number | null;
  windows: MetricWindows;
  metric: QueryMetric;
  unit: "seconds";
}

interface IntervalStatus {
  id: QueryStatsWindowId;
  label: string;
  shortLabel: string;
  sourceView: string;
  latestIntervalEnd: string | null;
}

interface QueryStatsResponse {
  metadata: {
    projectId: string;
    instanceId: string;
    databaseId: string;
    generatedAt: string;
  };
  intervals: IntervalStatus[];
  latencyTop: MetricSummaryEntry[];
  cpuTop: MetricSummaryEntry[];
  warnings?: string[];
  source: string;
}

/**
 * Generates JSON describing query stats per metric/window.
 */
export async function buildQueryStatsJson(
  database: Database,
  context: QueryStatsContext,
  options: QueryStatsOptions = {},
): Promise<string> {
  const tableRows = options.maxRows ?? DEFAULT_TABLE_ROWS;
  const sqlLimit = Math.max(DEFAULT_SQL_LIMIT, tableRows * 2);
  const collection = await collectQueryStats(database, sqlLimit);

  const hasLatency = collection.latency.size > 0;
  const hasCpu = collection.cpu.size > 0;

  const response: QueryStatsResponse = {
    metadata: {
      projectId: context.projectId,
      instanceId: context.instanceId,
      databaseId: context.databaseId,
      generatedAt: new Date().toISOString(),
    },
    intervals: QUERY_WINDOWS.map(window => ({
      id: window.id,
      label: window.label,
      shortLabel: window.shortLabel,
      sourceView: window.tableName,
      latestIntervalEnd: collection.intervals[window.id] ?? null,
    })),
    latencyTop: hasLatency
      ? buildMetricEntries(collection.latency, "latency", tableRows)
      : [],
    cpuTop: hasCpu
      ? buildMetricEntries(collection.cpu, "cpu", tableRows)
      : [],
    source:
      "SPANNER_SYS.QUERY_STATS_TOP_MINUTE, _10MINUTE, _HOUR (Query Insights)",
  };

  if (!hasLatency && !hasCpu) {
    response.warnings = [
      "No query stats were returned. Ensure Query Insights is enabled and that the service account can read SPANNER_SYS views.",
    ];
  }

  return JSON.stringify(response, null, 2);
}

async function collectQueryStats(
  database: Database,
  limit: number,
): Promise<QueryStatsCollection> {
  const intervals: Record<QueryStatsWindowId, string | null> = {
    MINUTE: null,
    "10MINUTE": null,
    HOUR: null,
  };
  const latency = new Map<string, QueryMetricEntry>();
  const cpu = new Map<string, QueryMetricEntry>();

  for (const window of QUERY_WINDOWS) {
    const latencyRows = await fetchTopQueryStats(
      database,
      window.tableName,
      "avg_latency_seconds",
      limit,
    );
    const cpuRows = await fetchTopQueryStats(
      database,
      window.tableName,
      "total_cpu_seconds",
      limit,
    );

    intervals[window.id] =
      latencyRows[0]?.intervalEnd || cpuRows[0]?.intervalEnd || null;

    addRowsToMetric(latency, latencyRows, window.id);
    addRowsToMetric(cpu, cpuRows, window.id);
  }

  return { intervals, latency, cpu };
}

async function fetchTopQueryStats(
  database: Database,
  tableName: string,
  orderColumn: "avg_latency_seconds" | "total_cpu_seconds",
  limit: number,
): Promise<QueryStatsRow[]> {
  const sql = `
    SELECT
      text AS query_text,
      text_fingerprint,
      request_tag,
      interval_end,
      execution_count,
      avg_latency_seconds,
      avg_cpu_seconds,
      execution_count * avg_cpu_seconds AS total_cpu_seconds
    FROM ${tableName}
    WHERE interval_end = (
      SELECT MAX(interval_end)
      FROM ${tableName}
    )
    ORDER BY ${orderColumn} DESC
    LIMIT @limit`;

  try {
    const [rows] = await database.run({
      sql,
      params: { limit: limit.toString() },
      types: { limit: "int64" },
    });

    return rows.map(normalizeRow).filter(Boolean) as QueryStatsRow[];
  } catch (error) {
    logger.warn(
      `Failed to read ${tableName} ordered by ${orderColumn}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function normalizeRow(row: Record<string, any>): QueryStatsRow | null {
  if (!row) {
    return null;
  }

  return {
    queryText: sanitizeQueryText(row.query_text),
    textFingerprint: row.text_fingerprint ?? undefined,
    requestTag: row.request_tag ?? null,
    intervalEnd: toIsoString(row.interval_end),
    executionCount: toNumber(row.execution_count),
    avgLatencySeconds: toNumber(row.avg_latency_seconds),
    avgCpuSeconds: toNumber(row.avg_cpu_seconds),
    totalCpuSeconds: toNumber(row.total_cpu_seconds),
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    if (value instanceof Date) {
      return value.getTime() / 1000;
    }
    if ("value" in (value as Record<string, unknown>)) {
      return toNumber((value as any).value);
    }
    if ("seconds" in (value as Record<string, unknown>)) {
      const seconds = Number((value as any).seconds ?? 0);
      const nanos = Number((value as any).nanos ?? 0);
      return seconds + nanos / 1_000_000_000;
    }
  }
  const fallback = Number(value as number);
  return Number.isNaN(fallback) ? null : fallback;
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("value" in (value as Record<string, unknown>)) {
      return toIsoString((value as any).value);
    }
    if ("seconds" in (value as Record<string, unknown>)) {
      const seconds = Number((value as any).seconds ?? 0);
      const nanos = Number((value as any).nanos ?? 0);
      return new Date(seconds * 1000 + nanos / 1_000_000).toISOString();
    }
  }
  try {
    return new Date(value as string).toISOString();
  } catch {
    return null;
  }
}

function sanitizeQueryText(text: unknown): string {
  if (!text) {
    return "<unknown query>";
  }
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "<unknown query>";
  }
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function addRowsToMetric(
  map: Map<string, QueryMetricEntry>,
  rows: QueryStatsRow[],
  windowId: QueryStatsWindowId,
): void {
  for (const row of rows) {
    const key = deriveRowKey(row);
    const existing = map.get(key);

    if (existing) {
      existing.windows[windowId] = row;
      if (!existing.sampleQuery && row.queryText) {
        existing.sampleQuery = row.queryText;
      }
      if (!existing.requestTag && row.requestTag) {
        existing.requestTag = row.requestTag;
      }
    } else {
      map.set(key, {
        key,
        sampleQuery: row.queryText,
        requestTag: row.requestTag,
        windows: { [windowId]: row },
      });
    }
  }
}

function deriveRowKey(row: QueryStatsRow): string {
  if (row.textFingerprint) {
    return row.textFingerprint;
  }
  if (row.requestTag) {
    return `tag:${row.requestTag}`;
  }
  const text = row.queryText ?? "";
  const hash = createHash("sha1").update(text).digest("hex").slice(0, 16);
  return `sql:${hash}`;
}

const WINDOW_PROP_MAP: Record<QueryStatsWindowId, keyof MetricWindows> = {
  MINUTE: "minute",
  "10MINUTE": "tenMinute",
  HOUR: "hour",
};

function buildMetricEntries(
  entries: Map<string, QueryMetricEntry>,
  metric: QueryMetric,
  limit: number,
): MetricSummaryEntry[] {
  return pickTopEntries(entries, metric, limit).map((entry, index) => {
    const windows = buildMetricWindows(entry, metric);
    const dominant = getDominantWindow(entry, metric);

    return {
      rank: index + 1,
      fingerprint: normalizeFingerprint(entry.key),
      sampleQuery: entry.sampleQuery || "<unknown query>",
      requestTag: entry.requestTag ?? null,
      dominantWindow: dominant?.label ?? null,
      dominantValue: dominant?.value ?? null,
      windows,
      metric,
      unit: "seconds",
    };
  });
}

function buildMetricWindows(
  entry: QueryMetricEntry,
  metric: QueryMetric,
): MetricWindows {
  const windows: MetricWindows = {};
  for (const window of QUERY_WINDOWS) {
    const value = getMetricValue(entry.windows[window.id], metric);
    if (value === null || value === undefined) {
      continue;
    }
    const prop = WINDOW_PROP_MAP[window.id];
    windows[prop] = value;
  }
  return windows;
}

function pickTopEntries(
  entries: Map<string, QueryMetricEntry>,
  metric: QueryMetric,
  limit: number,
): QueryMetricEntry[] {
  return Array.from(entries.values())
    .sort((a, b) => {
      const aValue = maxMetricValue(a, metric);
      const bValue = maxMetricValue(b, metric);
      return (bValue ?? 0) - (aValue ?? 0);
    })
    .slice(0, limit);
}

function maxMetricValue(entry: QueryMetricEntry, metric: QueryMetric): number | null {
  let max: number | null = null;
  for (const window of QUERY_WINDOWS) {
    const value = getMetricValue(entry.windows[window.id], metric);
    if (value === null || value === undefined) {
      continue;
    }
    if (max === null || value > max) {
      max = value;
    }
  }
  return max;
}

function getDominantWindow(
  entry: QueryMetricEntry,
  metric: QueryMetric,
): { label: string; value: number } | null {
  let dominant: { label: string; value: number } | null = null;
  for (const window of QUERY_WINDOWS) {
    const value = getMetricValue(entry.windows[window.id], metric);
    if (value === null || value === undefined) {
      continue;
    }
    if (!dominant || value > dominant.value) {
      dominant = { label: window.label, value };
    }
  }
  return dominant;
}

function getMetricValue(
  row: QueryStatsRow | undefined,
  metric: QueryMetric,
): number | null {
  if (!row) {
    return null;
  }
  if (metric === "latency") {
    return row.avgLatencySeconds ?? null;
  }
  return row.totalCpuSeconds ?? null;
}

function normalizeFingerprint(key: string): string {
  return key.startsWith("sql:") ? key.slice(4) : key;
}
