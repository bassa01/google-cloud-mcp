/**
 * Google Cloud Spanner resources for MCP
 */
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectId } from "../../utils/auth.js";
import { GcpMcpError } from "../../utils/error.js";
import { getSpannerClient, getSpannerConfig } from "./types.js";
import { formatSchemaAsMarkdown, getSpannerSchema } from "./schema.js";
import {
  analyzeQueryPlan,
  formatPlanRowsAsMarkdown,
} from "./query-plan.js";
import { logger } from "../../utils/logger.js";

function parseBooleanFlag(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function determineExplainMode(
  modeParam: string | null,
  analyzeParam: string | null,
): { analyze: boolean; label: "EXPLAIN" | "EXPLAIN ANALYZE" } {
  const normalizedMode = (modeParam || "").trim().toLowerCase();
  const analyze =
    normalizedMode === "analyze" ||
    normalizedMode === "explain analyze" ||
    parseBooleanFlag(analyzeParam);

  return {
    analyze,
    label: analyze ? "EXPLAIN ANALYZE" : "EXPLAIN",
  };
}

function buildExplainStatement(sql: string, analyze: boolean): string {
  const trimmed = sql.trim();

  if (/^explain\b/i.test(trimmed)) {
    return trimmed;
  }

  const prefix = analyze ? "EXPLAIN ANALYZE" : "EXPLAIN";
  return `${prefix} ${trimmed}`;
}

function normalizePlanRows(rows?: unknown[] | null): Record<string, unknown>[] {
  if (!rows || !Array.isArray(rows)) return [];

  return rows.map((row: any) => {
    if (row && typeof row.toJSON === "function") {
      return row.toJSON();
    }
    return row as Record<string, unknown>;
  });
}
const SPANNER_IDENTIFIER_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;
const TABLE_NAME_FORMAT_DOC =
  "Table names must start with a letter and may only contain letters, numbers, or underscores.";

/**
 * Registers Google Cloud Spanner resources with the MCP server
 *
 * @param server The MCP server instance
 */
export function registerSpannerResources(server: McpServer): void {
  // Register a resource for database schema
  server.resource(
    "gcp-spanner-database-schema",
    new ResourceTemplate(
      "gcp-spanner://{projectId}/{instanceId}/{databaseId}/schema",
      { list: undefined },
    ),
    async (uri, { projectId, instanceId, databaseId }, _extra) => {
      try {
        // Enhanced project ID detection with better error handling
        let actualProjectId: string;
        try {
          // Handle case where projectId might be an array
          const projectIdValue = Array.isArray(projectId)
            ? projectId[0]
            : projectId;
          actualProjectId = projectIdValue || (await getProjectId());
          if (!actualProjectId) {
            throw new Error("Project ID could not be determined");
          }
          logger.debug(
            `Using project ID: ${actualProjectId} for spanner-schema resource`,
          );
        } catch (error) {
          logger.error(
            `Error detecting project ID: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw new GcpMcpError(
            "Unable to detect a Project ID in the current environment.\nTo learn more about authentication and Google APIs, visit:\nhttps://cloud.google.com/docs/authentication/getting-started",
            "UNAUTHENTICATED",
            401,
          );
        }

        const config = await getSpannerConfig(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
          Array.isArray(databaseId) ? databaseId[0] : databaseId,
        );

        const schema = await getSpannerSchema(
          config.instanceId,
          config.databaseId,
        );
        const markdown = formatSchemaAsMarkdown(schema);

        return {
          contents: [
            {
              uri: uri.href,
              text: `# Spanner Database Schema\n\nProject: ${actualProjectId}\nInstance: ${config.instanceId}\nDatabase: ${config.databaseId}\n\n${markdown}`,
            },
          ],
        };
      } catch (error: any) {
        logger.error(
          `Error fetching Spanner schema: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Register a resource for query plan analysis
  server.resource(
    "gcp-spanner-query-plan",
    new ResourceTemplate(
      "gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-plan",
      { list: undefined },
    ),
    async (uri, { projectId, instanceId, databaseId }, _extra) => {
      try {
        let actualProjectId: string;
        try {
          const projectIdValue = Array.isArray(projectId)
            ? projectId[0]
            : projectId;
          actualProjectId = projectIdValue || (await getProjectId());
          if (!actualProjectId) {
            throw new Error("Project ID could not be determined");
          }
          logger.debug(
            `Using project ID: ${actualProjectId} for spanner-query-plan resource`,
          );
        } catch (error) {
          logger.error(
            `Error detecting project ID: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw new GcpMcpError(
            "Unable to detect a Project ID in the current environment.\nTo learn more about authentication and Google APIs, visit:\nhttps://cloud.google.com/docs/authentication/getting-started",
            "UNAUTHENTICATED",
            401,
          );
        }

        const config = await getSpannerConfig(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
          Array.isArray(databaseId) ? databaseId[0] : databaseId,
        );

        const params = new URL(uri.href).searchParams;
        const sqlParam = params.get("sql");

        if (!sqlParam) {
          throw new GcpMcpError(
            "SQL query parameter (?sql=) is required to generate a query plan.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const trimmedSql = sqlParam.trim();
        if (!trimmedSql) {
          throw new GcpMcpError(
            "SQL query cannot be empty.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const { analyze, label } = determineExplainMode(
          params.get("mode"),
          params.get("analyze"),
        );
        const explainSql = buildExplainStatement(trimmedSql, analyze);

        const spanner = await getSpannerClient();
        logger.debug(
          `Using Spanner client with project ID: ${spanner.projectId} for spanner-query-plan`,
        );
        const instanceRef = spanner.instance(config.instanceId);
        const databaseRef = instanceRef.database(config.databaseId);

        const [rawPlanRows] = await databaseRef.run({
          sql: explainSql,
        });

        const planRows = normalizePlanRows(rawPlanRows as unknown[]);
        const schema = await getSpannerSchema(
          config.instanceId,
          config.databaseId,
        );
        const analysis = analyzeQueryPlan(planRows, schema, trimmedSql);
        const planMarkdown = formatPlanRowsAsMarkdown(planRows);

        let insightsMarkdown = "## Plan Insights\n\n";
        const hasIssues =
          analysis.distributedJoinIssues.length > 0 ||
          analysis.missingIndexIssues.length > 0;

        if (!hasIssues) {
          insightsMarkdown +=
            "- No obvious distributed joins or missing indexes detected based on the current plan and schema.\n";
        } else {
          if (analysis.distributedJoinIssues.length > 0) {
            insightsMarkdown += "### Distributed Joins\n\n";
            for (const issue of analysis.distributedJoinIssues) {
              insightsMarkdown += `- ${issue}\n`;
            }
            insightsMarkdown += "\n";
          }

          if (analysis.missingIndexIssues.length > 0) {
            insightsMarkdown += "### Missing Indexes\n\n";
            for (const issue of analysis.missingIndexIssues) {
              insightsMarkdown += `- ${issue}\n`;
            }
            insightsMarkdown += "\n";
          }
        }

        if (analysis.referencedTables.length > 0) {
          insightsMarkdown += `Tables referenced: ${analysis.referencedTables.join(", ")}\n`;
        } else {
          insightsMarkdown +=
            "Tables referenced: Could not determine from the current plan or SQL.\n";
        }

        const modeNotice = analyze
          ? "_Executed with EXPLAIN ANALYZE (query was run to capture timing information)._"
          : "_Executed with EXPLAIN (plan only; query was not executed)._";

        return {
          contents: [
            {
              uri: uri.href,
              text: `# Spanner Query Plan\n\nProject: ${actualProjectId}\nInstance: ${config.instanceId}\nDatabase: ${config.databaseId}\nMode: ${label}\n\nOriginal SQL:\n\`\`\`sql\n${trimmedSql}\n\`\`\`\n\n${modeNotice}\n\n${insightsMarkdown}\n\n## Plan Nodes\n\n${planMarkdown}`,
            },
          ],
        };
      } catch (error: any) {
        logger.error(
          `Error fetching Spanner query plan: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Register a resource for table data preview
  server.resource(
    "gcp-spanner-table-preview",
    new ResourceTemplate(
      "gcp-spanner://{projectId}/{instanceId}/{databaseId}/tables/{tableName}/preview",
      { list: undefined },
    ),
    async (uri, { projectId, instanceId, databaseId, tableName }, _extra) => {
      try {
        // Enhanced project ID detection with better error handling
        let actualProjectId: string;
        try {
          // Handle case where projectId might be an array
          const projectIdValue = Array.isArray(projectId)
            ? projectId[0]
            : projectId;
          actualProjectId = projectIdValue || (await getProjectId());
          if (!actualProjectId) {
            throw new Error("Project ID could not be determined");
          }
          logger.debug(
            `Using project ID: ${actualProjectId} for table-preview resource`,
          );
        } catch (error) {
          logger.error(
            `Error detecting project ID: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw new GcpMcpError(
            "Unable to detect a Project ID in the current environment.\nTo learn more about authentication and Google APIs, visit:\nhttps://cloud.google.com/docs/authentication/getting-started",
            "UNAUTHENTICATED",
            401,
          );
        }

        const config = await getSpannerConfig(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
          Array.isArray(databaseId) ? databaseId[0] : databaseId,
        );

        const tableNameValue = Array.isArray(tableName)
          ? tableName[0]
          : tableName;

        if (!tableNameValue) {
          throw new GcpMcpError(
            `Table name is required. ${TABLE_NAME_FORMAT_DOC}`,
            "INVALID_ARGUMENT",
            400,
          );
        }

        if (!SPANNER_IDENTIFIER_REGEX.test(tableNameValue)) {
          throw new GcpMcpError(
            `Invalid table name: "${tableNameValue}". ${TABLE_NAME_FORMAT_DOC}`,
            "INVALID_ARGUMENT",
            400,
          );
        }

        const spanner = await getSpannerClient();
        logger.debug(
          `Using Spanner client with project ID: ${spanner.projectId} for spanner-tables`,
        );
        const instance = spanner.instance(config.instanceId);
        const database = instance.database(config.databaseId);

        // Get a preview of the table data (first 10 rows)
        const sanitizedTableName = `\`${tableNameValue}\``;
        const [result] = await database.run({
          sql: `SELECT * FROM ${sanitizedTableName} LIMIT @limit`,
          params: { limit: "10" },
          types: { limit: "int64" },
        });

        if (!result || result.length === 0) {
          return {
            contents: [
              {
                uri: uri.href,
                text: `# Table Preview: ${tableNameValue}\n\nNo data found in the table.\n\nAccepted table name format: ${TABLE_NAME_FORMAT_DOC}`,
              },
            ],
          };
        }

        // Convert to markdown table
        const columns = Object.keys(result[0]);

        let markdown = `# Table Preview: ${tableNameValue}\n\n`;
        markdown += `> Accepted table name format: ${TABLE_NAME_FORMAT_DOC}\n\n`;

        // Table header
        markdown += "| " + columns.join(" | ") + " |\n";
        markdown += "| " + columns.map(() => "---").join(" | ") + " |\n";

        // Table rows
        for (const row of result) {
          const rowValues = columns.map((col) => {
            const value = (row as any)[col];
            if (value === null || value === undefined) return "NULL";
            if (typeof value === "object") return JSON.stringify(value);
            return String(value);
          });

          markdown += "| " + rowValues.join(" | ") + " |\n";
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: `# Table Preview: ${tableNameValue}\n\nProject: ${actualProjectId}\nInstance: ${config.instanceId}\nDatabase: ${config.databaseId}\n\n${markdown}`,
            },
          ],
        };
      } catch (error: any) {
        logger.error(
          `Error fetching table preview: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Register a resource for listing available tables
  server.resource(
    "gcp-spanner-database-tables",
    new ResourceTemplate(
      "gcp-spanner://{projectId}/{instanceId}/{databaseId}/tables",
      { list: undefined },
    ),
    async (uri, { projectId, instanceId, databaseId }, _extra) => {
      try {
        // Enhanced project ID detection with better error handling
        let actualProjectId: string;
        try {
          // Handle case where projectId might be an array
          const projectIdValue = Array.isArray(projectId)
            ? projectId[0]
            : projectId;
          actualProjectId = projectIdValue || (await getProjectId());
          if (!actualProjectId) {
            throw new Error("Project ID could not be determined");
          }
          logger.debug(
            `Using project ID: ${actualProjectId} for spanner-tables resource`,
          );
        } catch (error) {
          logger.error(
            `Error detecting project ID: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw new GcpMcpError(
            "Unable to detect a Project ID in the current environment.\nTo learn more about authentication and Google APIs, visit:\nhttps://cloud.google.com/docs/authentication/getting-started",
            "UNAUTHENTICATED",
            401,
          );
        }

        const config = await getSpannerConfig(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
          Array.isArray(databaseId) ? databaseId[0] : databaseId,
        );

        const spanner = await getSpannerClient();
        logger.debug(
          `Using Spanner client with project ID: ${spanner.projectId} for spanner-tables`,
        );
        const instance = spanner.instance(config.instanceId);
        const database = instance.database(config.databaseId);

        // Query for tables with column count
        const [tablesResult] = await database.run({
          sql: `SELECT t.table_name, 
                    (SELECT COUNT(1) FROM information_schema.columns 
                     WHERE table_name = t.table_name) as column_count
              FROM information_schema.tables t
              WHERE t.table_catalog = '' AND t.table_schema = ''
              ORDER BY t.table_name`,
        });

        if (!tablesResult || tablesResult.length === 0) {
          return {
            contents: [
              {
                uri: uri.href,
                text: `# Spanner Tables\n\nProject: ${actualProjectId}\nInstance: ${config.instanceId}\nDatabase: ${config.databaseId}\n\nNo tables found in the database.`,
              },
            ],
          };
        }

        let markdown = `# Spanner Tables\n\nProject: ${actualProjectId}\nInstance: ${config.instanceId}\nDatabase: ${config.databaseId}\n\n`;

        // Table header
        markdown += "| Table Name | Column Count |\n";
        markdown += "|------------|-------------|\n";

        // Table rows
        for (const row of tablesResult) {
          const tableName = (row as any).table_name as string;
          const columnCount = (row as any).column_count as number;

          markdown += `| ${tableName} | ${columnCount} |\n`;
        }

        // Add links to each table's schema and preview
        markdown += "\n## Available Resources\n\n";
        for (const row of tablesResult) {
          const tableName = (row as any).table_name as string;
          markdown += `- **${tableName}**\n`;
          markdown += `  - Schema: \`gcp-spanner://${actualProjectId}/${config.instanceId}/${config.databaseId}/schema\`\n`;
          markdown += `  - Preview: \`gcp-spanner://${actualProjectId}/${config.instanceId}/${config.databaseId}/tables/${tableName}/preview\`\n\n`;
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: markdown,
            },
          ],
        };
      } catch (error: any) {
        logger.error(
          `Error listing Spanner tables: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Register a resource for listing available instances
  server.resource(
    "gcp-spanner-list-instances",
    new ResourceTemplate("gcp-spanner://{projectId}/instances", {
      list: undefined,
    }),
    async (uri, { projectId }, _extra) => {
      try {
        // Enhanced project ID detection with better error handling
        let actualProjectId: string;
        try {
          // Handle case where projectId might be an array
          const projectIdValue = Array.isArray(projectId)
            ? projectId[0]
            : projectId;
          actualProjectId = projectIdValue || (await getProjectId());
          if (!actualProjectId) {
            throw new Error("Project ID could not be determined");
          }
          logger.debug(
            `Using project ID: ${actualProjectId} for spanner-instances resource`,
          );
        } catch (error) {
          logger.error(
            `Error detecting project ID: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw new GcpMcpError(
            "Unable to detect a Project ID in the current environment.\nTo learn more about authentication and Google APIs, visit:\nhttps://cloud.google.com/docs/authentication/getting-started",
            "UNAUTHENTICATED",
            401,
          );
        }

        const spanner = await getSpannerClient();
        logger.debug(
          `Using Spanner client with project ID: ${spanner.projectId}`,
        );

        const [instances] = await spanner.getInstances();

        if (!instances || instances.length === 0) {
          return {
            contents: [
              {
                uri: uri.href,
                text: `# Spanner Instances\n\nProject: ${actualProjectId}\n\nNo instances found in the project.`,
              },
            ],
          };
        }

        let markdown = `# Spanner Instances\n\nProject: ${actualProjectId}\n\n`;

        // Table header
        markdown += "| Instance ID | State | Config | Nodes |\n";
        markdown += "|-------------|-------|--------|-------|\n";

        // Table rows
        for (const instance of instances) {
          const metadata = instance.metadata || {};
          markdown += `| ${instance.id || "unknown"} | ${metadata.state || "unknown"} | ${metadata.config?.split("/").pop() || "unknown"} | ${metadata.nodeCount || "unknown"} |\n`;
        }

        // Add links to each instance's databases
        markdown += "\n## Available Resources\n\n";
        for (const instance of instances) {
          markdown += `- **${instance.id}**\n`;
          markdown += `  - Databases: \`gcp-spanner://${actualProjectId}/${instance.id}/databases\`\n\n`;
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: markdown,
            },
          ],
        };
      } catch (error: any) {
        logger.error(
          `Error listing Spanner instances: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Register a resource for listing available databases
  server.resource(
    "gcp-spanner-list-databases",
    new ResourceTemplate("gcp-spanner://{projectId}/{instanceId}/databases", {
      list: undefined,
    }),
    async (uri, { projectId, instanceId }, _extra) => {
      try {
        // Enhanced project ID detection with better error handling
        let actualProjectId: string;
        try {
          // Handle case where projectId might be an array
          const projectIdValue = Array.isArray(projectId)
            ? projectId[0]
            : projectId;
          actualProjectId = projectIdValue || (await getProjectId());
          if (!actualProjectId) {
            throw new Error("Project ID could not be determined");
          }
          logger.debug(
            `Using project ID: ${actualProjectId} for spanner-databases resource`,
          );
        } catch (error) {
          logger.error(
            `Error detecting project ID: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw new GcpMcpError(
            "Unable to detect a Project ID in the current environment.\nTo learn more about authentication and Google APIs, visit:\nhttps://cloud.google.com/docs/authentication/getting-started",
            "UNAUTHENTICATED",
            401,
          );
        }

        if (!instanceId) {
          throw new GcpMcpError(
            "Instance ID is required",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const spanner = await getSpannerClient();
        logger.debug(
          `Using Spanner client with project ID: ${spanner.projectId} for spanner-databases`,
        );
        const instance = spanner.instance(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
        );

        const [databases] = await instance.getDatabases();

        if (!databases || databases.length === 0) {
          return {
            contents: [
              {
                uri: uri.href,
                text: `# Spanner Databases\n\nProject: ${actualProjectId}\nInstance: ${Array.isArray(instanceId) ? instanceId[0] : instanceId}\n\nNo databases found in the instance.`,
              },
            ],
          };
        }

        let markdown = `# Spanner Databases\n\nProject: ${actualProjectId}\nInstance: ${Array.isArray(instanceId) ? instanceId[0] : instanceId}\n\n`;

        // Table header
        markdown += "| Database ID | State |\n";
        markdown += "|-------------|-------|\n";

        // Table rows
        for (const database of databases) {
          const metadata = database.metadata || {};
          markdown += `| ${database.id || "unknown"} | ${metadata.state || "unknown"} |\n`;
        }

        // Add links to each database's tables
        markdown += "\n## Available Resources\n\n";
        for (const database of databases) {
          markdown += `- **${database.id}**\n`;
          markdown += `  - Tables: \`gcp-spanner://${actualProjectId}/${Array.isArray(instanceId) ? instanceId[0] : instanceId}/${database.id}/tables\`\n`;
          markdown += `  - Schema: \`gcp-spanner://${actualProjectId}/${Array.isArray(instanceId) ? instanceId[0] : instanceId}/${database.id}/schema\`\n\n`;
        }

        return {
          contents: [
            {
              uri: uri.href,
              text: markdown,
            },
          ],
        };
      } catch (error: any) {
        logger.error(
          `Error listing Spanner databases: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );
}
