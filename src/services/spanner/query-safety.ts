/**
 * Utilities to ensure user-provided Spanner SQL is read-only before execution.
 */
import { GcpMcpError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

const READ_ONLY_PREFIXES = new Set(["SELECT", "WITH", "EXPLAIN", "SHOW", "DESCRIBE"]);

const DESTRUCTIVE_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  {
    regex: /\bINSERT\s+INTO\b/i,
    description: "INSERT statements modify data.",
  },
  {
    regex: /\bUPDATE\s+[A-Z0-9_"`[\]]+/i,
    description: "UPDATE statements modify data.",
  },
  {
    regex: /\bDELETE\s+FROM\b/i,
    description: "DELETE statements remove data.",
  },
  {
    regex: /\bMERGE\s+[A-Z0-9_"`[\]]+/i,
    description: "MERGE statements modify data.",
  },
  {
    regex: /\bREPLACE\s+[A-Z0-9_"`[\]]+/i,
    description: "REPLACE statements modify data.",
  },
  {
    regex: /\bTRUNCATE\s+(TABLE|TEMP|TEMPORARY)\b/i,
    description: "TRUNCATE statements remove data.",
  },
  {
    regex: /\bDROP\s+(TABLE|INDEX|DATABASE|SCHEMA|VIEW)\b/i,
    description: "DROP statements remove schema objects.",
  },
  {
    regex: /\bALTER\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b/i,
    description: "ALTER statements change schema objects.",
  },
  {
    regex: /\bCREATE\s+(TABLE|INDEX|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE)\b/i,
    description: "CREATE statements change schema.",
  },
  {
    regex: /\bGRANT\s+/i,
    description: "GRANT statements change permissions.",
  },
  {
    regex: /\bREVOKE\s+/i,
    description: "REVOKE statements change permissions.",
  },
  {
    regex: /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b|\bSTART\s+TRANSACTION\b/i,
    description: "Transaction control statements are not allowed.",
  },
];

/**
 * Removes SQL comments for easier static analysis.
 */
function removeSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*/gm, " ");
}

/**
 * Masks string literals so destructive keywords inside quotes do not cause false positives.
 */
function maskStringLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

/**
 * Collapses whitespace to simplify downstream pattern checks.
 */
function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/**
 * Ensures only a single SQL statement is present.
 */
function ensureSingleStatement(sql: string): void {
  const firstSemicolon = sql.indexOf(";");
  if (firstSemicolon === -1) {
    return;
  }

  const trailing = sql.slice(firstSemicolon + 1).trim();
  if (trailing.length > 0) {
    throw new GcpMcpError(
      "Multiple SQL statements detected. Only a single read-only statement is permitted.",
      "FAILED_PRECONDITION",
      400,
    );
  }
}

/**
 * Extracts the first keyword in a SQL statement.
 */
function extractFirstKeyword(sql: string): string | null {
  const trimmed = sql.trimStart();
  const match = trimmed.match(/^([A-Z]+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Throws when the SQL query is not read-only.
 */
export function assertReadOnlySpannerQuery(sql: string): void {
  if (!sql || !sql.trim()) {
    throw new GcpMcpError(
      "SQL query cannot be empty. Provide a read-only SELECT statement.",
      "INVALID_ARGUMENT",
      400,
    );
  }

  const sanitized = normalizeWhitespace(maskStringLiterals(removeSqlComments(sql)));

  if (!sanitized) {
    throw new GcpMcpError(
      "SQL query cannot be empty after removing comments. Provide a read-only SELECT statement.",
      "INVALID_ARGUMENT",
      400,
    );
  }

  ensureSingleStatement(sanitized);

  const firstKeyword = extractFirstKeyword(sanitized);

  if (!firstKeyword || !READ_ONLY_PREFIXES.has(firstKeyword)) {
    throw new GcpMcpError(
      `Blocked unsafe SQL. Detected "${firstKeyword ?? "unknown"}" statement. Only read-only queries (SELECT, WITH, EXPLAIN, SHOW, DESCRIBE) are allowed.`,
      "FAILED_PRECONDITION",
      400,
    );
  }

  const violation = DESTRUCTIVE_PATTERNS.find(({ regex }) => regex.test(sanitized));

  if (violation) {
    logger.warn(`Blocked unsafe Spanner SQL query: ${violation.description}`);
    throw new GcpMcpError(
      `Blocked unsafe SQL. ${violation.description} Only read-only queries are permitted.`,
      "FAILED_PRECONDITION",
      400,
    );
  }
}
