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

interface HeatmapSectionOptions {
  metric: QueryMetric;
  title: string;
  rowsLimit: number;
}

export interface QueryStatsMarkdownOptions {
  maxRows?: number;
}

export interface QueryStatsContext {
  projectId: string;
  instanceId: string;
  databaseId: string;
}

const DEFAULT_SQL_LIMIT = 15;
const DEFAULT_HEATMAP_ROWS = 6;

/**
 * Generates markdown describing query stats heatmaps per metric/window.
 */
export async function buildQueryStatsMarkdown(
  database: Database,
  context: QueryStatsContext,
  options: QueryStatsMarkdownOptions = {},
): Promise<string> {
  const heatmapRows = options.maxRows ?? DEFAULT_HEATMAP_ROWS;
  const sqlLimit = Math.max(DEFAULT_SQL_LIMIT, heatmapRows * 2);
  const collection = await collectQueryStats(database, sqlLimit);

  const hasLatency = collection.latency.size > 0;
  const hasCpu = collection.cpu.size > 0;

  let markdown = `# Spanner Query Stats (experimental)\n\n`;
  markdown += `Project: ${context.projectId}\n`;
  markdown += `Instance: ${context.instanceId}\n`;
  markdown += `Database: ${context.databaseId}\n\n`;

  markdown += "## Interval Coverage\n\n";
  markdown += "| Window | Latest Interval End | Source View |\n";
  markdown += "|--------|---------------------|-------------|\n";
  for (const window of QUERY_WINDOWS) {
    const interval = collection.intervals[window.id];
    markdown += `| ${window.label} | ${interval ?? "n/a"} | ${window.tableName} |\n`;
  }
  markdown += "\n";

  if (!hasLatency && !hasCpu) {
    markdown +=
      "No query stats were returned from SPANNER_SYS views. Ensure Query Insights is enabled and that your service account has monitoring access.";
    return markdown;
  }

  if (hasLatency) {
    markdown += buildHeatmapSection(collection.latency, {
      metric: "latency",
      title: "Average latency heatmap",
      rowsLimit: heatmapRows,
    });
  } else {
    markdown += "### Average latency heatmap\n\nNo latency records were returned.\n\n";
  }

  if (hasCpu) {
    markdown += buildHeatmapSection(collection.cpu, {
      metric: "cpu",
      title: "Total CPU heatmap",
      rowsLimit: heatmapRows,
    });
  } else {
    markdown += "### Total CPU heatmap\n\nNo CPU-intensive records were returned.\n\n";
  }

  markdown +=
    "Data sourced from SPANNER_SYS.QUERY_STATS_TOP_MINUTE / 10MINUTE / HOUR views. Values and colors are relative within each heatmap.\n";

  return markdown;
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

function buildHeatmapSection(
  entries: Map<string, QueryMetricEntry>,
  options: HeatmapSectionOptions,
): string {
  const rows = pickTopEntries(entries, options.metric, options.rowsLimit);
  if (rows.length === 0) {
    return `### ${options.title}\n\nNo data points available.\n\n`;
  }

  const values: number[] = [];
  for (const entry of rows) {
    for (const window of QUERY_WINDOWS) {
      const value = getMetricValue(entry.windows[window.id], options.metric);
      if (value !== null && value !== undefined) {
        values.push(value);
      }
    }
  }

  const colorScale = createColorScale(values);

  let markdown = `### ${options.title}\n\n`;
  const header = `| Query fingerprint | ${QUERY_WINDOWS.map(w => w.shortLabel).join(" | ")} |`;
  const separator =
    "|-------------------|" +
    QUERY_WINDOWS.map(() => "----------------|").join("");
  markdown += `${header}\n${separator}\n`;

  for (const entry of rows) {
    const label = formatQueryLabel(entry);
    const cells = QUERY_WINDOWS.map(window => {
      const value = getMetricValue(entry.windows[window.id], options.metric);
      return formatHeatmapCell(value, options.metric, colorScale);
    });
    markdown += `| ${label} | ${cells.join(" | ")} |\n`;
  }

  markdown += "\n";
  return markdown;
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

interface ColorScale {
  min: number;
  max: number;
}

function createColorScale(values: number[]): ColorScale {
  if (!values.length) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return { min, max: min + 1 };
  }
  return { min, max };
}

function formatHeatmapCell(
  value: number | null,
  metric: QueryMetric,
  scale: ColorScale,
): string {
  if (value === null || value === undefined) {
    return "⬜️ —";
  }
  const ratio = Math.min(
    1,
    Math.max(0, (value - scale.min) / (scale.max - scale.min || 1)),
  );
  const color = ratio > 0.75 ? "🟥" : ratio > 0.5 ? "🟧" : ratio > 0.25 ? "🟨" : "🟩";
  return `${color} ${formatMetricValue(value, metric)}`;
}

function formatMetricValue(value: number, metric: QueryMetric): string {
  const suffix = metric === "latency" ? "s" : "s";
  if (value >= 100) {
    return `${value.toFixed(0)}${suffix}`;
  }
  if (value >= 10) {
    return `${value.toFixed(1)}${suffix}`;
  }
  if (value >= 1) {
    return `${value.toFixed(2)}${suffix}`;
  }
  return `${value.toFixed(3)}${suffix}`;
}

function formatQueryLabel(entry: QueryMetricEntry): string {
  const fp = entry.key.startsWith("sql:") ? entry.key.slice(4) : entry.key;
  const hint = truncateForTable(entry.sampleQuery || "<unknown query>");
  return `\`${fp}\` ${hint.replace(/\|/g, "\\|")}`;
}

function truncateForTable(text: string): string {
  if (text.length <= 96) {
    return text;
  }
  return `${text.slice(0, 93)}...`;
}
