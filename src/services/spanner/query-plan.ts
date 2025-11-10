/**
 * Query plan utilities for Google Cloud Spanner
 */
import { SpannerSchema, SpannerTable } from "./types.js";

/**
 * Result of analyzing a query plan for potential issues
 */
export interface QueryPlanAnalysis {
  referencedTables: string[];
  distributedJoinIssues: string[];
  missingIndexIssues: string[];
}

type PlanRow = Record<string, unknown>;

/**
 * Format plan rows returned by Spanner into a Markdown table
 */
export function formatPlanRowsAsMarkdown(planRows: PlanRow[]): string {
  if (!planRows || planRows.length === 0) {
    return "No plan nodes were returned by EXPLAIN.";
  }

  const columnOrder = Array.from(
    planRows.reduce((set, row) => {
      for (const key of Object.keys(row)) {
        set.add(key);
      }
      return set;
    }, new Set<string>()),
  );

  const header = `| ${columnOrder.join(" | ")} |`;
  const separator = `| ${columnOrder.map(() => "---").join(" | ")} |`;
  const body = planRows
    .map((row) => {
      const cells = columnOrder.map((column) =>
        stringifyValue(row[column], 80),
      );
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}

/**
 * Analyze plan rows for distributed joins and possible missing indexes
 */
export function analyzeQueryPlan(
  planRows: PlanRow[],
  schema: SpannerSchema,
  sql: string,
): QueryPlanAnalysis {
  const referencedTables = collectReferencedTables(planRows, sql);
  const schemaByName = new Map(
    schema.tables.map((table) => [table.name.toLowerCase(), table]),
  );

  const distributedJoinIssues: string[] = [];
  const missingIndexIssues: string[] = [];
  const tablesWithFullScan = new Set<string>();

  for (const row of planRows) {
    const nodeSummary = formatNodeSummary(row);
    const rowText = nodeSummary.toLowerCase();

    if (rowText.includes("distributed") && rowText.includes("join")) {
      distributedJoinIssues.push(
        `Distributed join detected (${nodeSummary}). Consider reviewing data locality or using interleaved tables to keep related rows together.`,
      );
    }

    const tableName = findTableName(row);
    const mentionsScan = rowText.includes("scan");
    const mentionsIndex = rowText.includes("index");
    const isFullTableScan =
      rowText.includes("table scan") || (mentionsScan && !mentionsIndex);

    if (tableName && isFullTableScan) {
      tablesWithFullScan.add(tableName.toLowerCase());
    }
  }

  for (const tableName of referencedTables) {
    const schemaTable = schemaByName.get(tableName.toLowerCase());
    if (!schemaTable) continue;

    const hasFullScan = tablesWithFullScan.has(tableName.toLowerCase());
    if (!hasFullScan) continue;

    if (!hasSecondaryIndexes(schemaTable)) {
      missingIndexIssues.push(
        `Table ${schemaTable.name} appears in a full scan and has no secondary indexes. Consider adding an index on frequently filtered columns.`,
      );
      continue;
    }
  }

  return {
    referencedTables: Array.from(referencedTables),
    distributedJoinIssues,
    missingIndexIssues,
  };
}

function stringifyValue(value: unknown, maxLength: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return truncate(value, maxLength);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return truncate(JSON.stringify(value), maxLength);
  }
  return truncate(JSON.stringify(value), maxLength);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function collectReferencedTables(
  planRows: PlanRow[],
  sql: string,
): Set<string> {
  const names = new Set<string>();

  // Extract from plan rows first
  for (const row of planRows) {
    const tableName = findTableName(row);
    if (tableName) {
      names.add(tableName);
    }
  }

  // Fallback to parsing FROM/JOIN clauses from SQL text
  const tableRegex = /\b(?:FROM|JOIN)\s+([`"'[\]A-Za-z0-9_.-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(sql)) !== null) {
    const raw = match[1];
    const cleaned = normalizeIdentifier(raw);
    if (cleaned) {
      names.add(cleaned);
    }
  }

  return names;
}

function normalizeIdentifier(identifier: string): string {
  const withoutQuotes = identifier
    .replace(/[`"'[\]]/g, "")
    .replace(/[,;)]$/, "");
  // Remove alias by splitting on whitespace
  const [base] = withoutQuotes.trim().split(/\s+/);
  return base;
}

function findTableName(row: PlanRow): string | undefined {
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== "string") continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("table")) {
      const normalized = normalizeIdentifier(value);
      if (normalized) {
        return normalized;
      }
    }
    if (lowerKey === "name" && value.toLowerCase().includes("scan")) {
      const potential = value.replace(/.*scan\s+/i, "");
      const normalized = normalizeIdentifier(potential);
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function formatNodeSummary(row: PlanRow): string {
  const id =
    (findField(row, [
      "plan_node_id",
      "planNodeId",
      "id",
      "node_id",
      "NodeId",
    ]) as string | undefined) || "";
  const operator =
    (findField(row, ["operator", "operator_type", "name"]) as
      | string
      | undefined) || "";
  const extra =
    (findField(row, ["distribution", "details"]) as string | undefined) || "";

  return [id, operator, extra].filter(Boolean).join(" ").trim();
}

function findField(row: PlanRow, fieldNames: string[]): unknown {
  for (const candidate of fieldNames) {
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase() === candidate.toLowerCase()) {
        return value;
      }
    }
  }
  return undefined;
}

function hasSecondaryIndexes(table: SpannerTable): boolean {
  if (!table.indexes || table.indexes.length === 0) {
    return false;
  }

  return table.indexes.some((index) => {
    if (!index.name) {
      return false;
    }

    const normalizedName = index.name.trim().toUpperCase();

    return (
      normalizedName !== "PRIMARY KEY" && normalizedName !== "PRIMARY_KEY"
    );
  });
}
