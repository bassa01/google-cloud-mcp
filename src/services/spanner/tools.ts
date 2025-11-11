/**
 * Google Cloud Spanner tools for MCP
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectId } from "../../utils/auth.js";
import { getSpannerClient, getSpannerConfig } from "./types.js";
import { getSpannerSchema } from "./schema.js";
import { stateManager } from "../../utils/state-manager.js";
import { logger } from "../../utils/logger.js";
import { assertReadOnlySpannerQuery } from "./query-safety.js";
import {
  buildStructuredTextBlock,
  previewList,
  resolveBoundedNumber,
} from "../../utils/output.js";

const SPANNER_ROW_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.SPANNER_ROW_PREVIEW_LIMIT,
  50,
  { min: 5, max: 200 },
);

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
  const { displayed, omitted } = previewList(rows, SPANNER_ROW_PREVIEW_LIMIT);
  const noteParts: string[] = [];
  if (omitted > 0) {
    noteParts.push(
      `Showing ${displayed.length} of ${rows.length} rows (preview limit ${SPANNER_ROW_PREVIEW_LIMIT}).`,
    );
  }
  if (rows.length === 0 && emptyMessage) {
    noteParts.push(emptyMessage);
  }
  if (additionalNote) {
    noteParts.push(additionalNote);
  }

  const payload: unknown =
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

/**
 * Get detailed schema information for a Spanner database in a format suitable for query generation
 *
 * @param instanceId Spanner instance ID
 * @param databaseId Spanner database ID
 * @returns Detailed schema information with table relationships
 */
async function getDetailedSchemaForQueryGeneration(
  instanceId: string,
  databaseId: string,
): Promise<string> {
  const schema = await getSpannerSchema(instanceId, databaseId);

  // Format the schema in a way that's useful for SQL generation
  let schemaText = `Database: ${databaseId}\n\nTables:\n`;

  for (const table of schema.tables) {
    schemaText += `\nTable: ${table.name}\n`;
    schemaText += `Columns:\n`;

    for (const column of table.columns) {
      schemaText += `  - ${column.name}: ${column.type}${column.nullable ? " (nullable)" : ""}\n`;
    }

    if (table.indexes && table.indexes.length > 0) {
      schemaText += `Indexes:\n`;
      for (const index of table.indexes) {
        schemaText += `  - ${index.name}: ${index.columns.join(", ")}${index.unique ? " (unique)" : ""}\n`;
      }
    }

    if (table.foreignKeys && table.foreignKeys.length > 0) {
      schemaText += `Foreign Keys:\n`;
      for (const fk of table.foreignKeys) {
        schemaText += `  - ${fk.name}: ${fk.columns.join(", ")} → ${fk.referencedTable}(${fk.referencedColumns.join(", ")})\n`;
      }
    }
  }

  return schemaText;
}

export function registerSpannerTools(server: McpServer): void {
  // Tool to execute SQL queries
  server.tool(
    "gcp-spanner-execute-query",
    {
      sql: z.string().describe("The SQL query to execute"),
      instanceId: z
        .string()
        .optional()
        .describe("Spanner instance ID (defaults to SPANNER_INSTANCE env var)"),
      databaseId: z
        .string()
        .optional()
        .describe("Spanner database ID (defaults to SPANNER_DATABASE env var)"),
      params: z
        .record(z.string(), z.any())
        .optional()
        .describe("Query parameters"),
    },
    async ({ sql, instanceId, databaseId, params }, _extra) => {
      try {
        assertReadOnlySpannerQuery(sql);
        const projectId = await getProjectId();
        const config = await getSpannerConfig(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
          Array.isArray(databaseId) ? databaseId[0] : databaseId,
        );

        const spanner = await getSpannerClient();
        logger.debug(
          `Using Spanner client with project ID: ${spanner.projectId} for gcp-spanner-execute-query`,
        );
        const instance = spanner.instance(config.instanceId);
        const database = instance.database(config.databaseId);

        // Execute the query
        const [result] = await database.run({
          sql,
          params: params || {},
        });

        const rows = (result as Record<string, unknown>[]) || [];
        const text = buildRowsResponse({
          title: "Spanner Query Results",
          metadata: {
            projectId,
            instanceId: config.instanceId,
            databaseId: config.databaseId,
          },
          rows,
          context: {
            sql,
            params: params || {},
          },
          dataLabel: "result",
          emptyMessage: "Query executed successfully, but no rows were returned.",
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
          `Error executing Spanner query: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Tool to list tables
  server.tool(
    "gcp-spanner-list-tables",
    {
      instanceId: z
        .string()
        .optional()
        .describe("Spanner instance ID (defaults to SPANNER_INSTANCE env var)"),
      databaseId: z
        .string()
        .optional()
        .describe("Spanner database ID (defaults to SPANNER_DATABASE env var)"),
    },
    async ({ instanceId, databaseId }, _extra) => {
      try {
        const projectId = await getProjectId();
        const config = await getSpannerConfig(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
          Array.isArray(databaseId) ? databaseId[0] : databaseId,
        );

        const spanner = await getSpannerClient();
        logger.debug(
          `Using Spanner client with project ID: ${spanner.projectId} for gcp-spanner-execute-query`,
        );
        const instance = spanner.instance(config.instanceId);
        const database = instance.database(config.databaseId);

        // Query for tables
        // Execute query to list tables
        const [tablesResult] = await database.run({
          sql: `SELECT t.table_name, 
                    (SELECT COUNT(1) FROM information_schema.columns 
                     WHERE table_name = t.table_name) as column_count
              FROM information_schema.tables t
              WHERE t.table_catalog = '' AND t.table_schema = ''
              ORDER BY t.table_name`,
        });

        const tablesData =
          (tablesResult as Array<Record<string, unknown>>) ?? [];
        const tables = tablesData.map((row) => ({
          tableName: (row.table_name as string) || "unknown",
          columnCount: Number(row.column_count ?? 0),
        }));

        const text = buildRowsResponse({
          title: "Spanner Tables",
          metadata: {
            projectId,
            instanceId: config.instanceId,
            databaseId: config.databaseId,
          },
          rows: tables,
          context: {
            schemaResource: `gcp-spanner://${projectId}/${config.instanceId}/${config.databaseId}/schema`,
            tablePreviewTemplate: `gcp-spanner://${projectId}/${config.instanceId}/${config.databaseId}/tables/{table}/preview`,
          },
          emptyMessage: "No tables were found in the database.",
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
          `Error listing Spanner tables: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Tool to list instances
  server.tool(
    "gcp-spanner-list-instances",
    // Define an empty schema with a dummy parameter that's optional
    // This ensures compatibility with clients that expect an object parameter
    {
      _dummy: z
        .string()
        .optional()
        .describe("Not used, just to ensure parameter compatibility"),
    },
    async (_params, _extra) => {
      try {
        // First try to get the project ID from the state manager
        let projectId = stateManager.getCurrentProjectId();

        if (projectId) {
          logger.debug(`Got project ID from state manager: ${projectId}`);
        } else {
          // If not in state manager, try to get it from environment
          const envProjectId = process.env.GOOGLE_CLOUD_PROJECT;

          if (envProjectId) {
            projectId = envProjectId;
            logger.debug(`Got project ID from environment: ${projectId}`);
            // Store in state manager for future use
            await stateManager.setCurrentProjectId(projectId);
          } else {
            // If not in environment, try to get it from our function
            projectId = await getProjectId();
            logger.debug(`Got project ID from getProjectId: ${projectId}`);
          }
        }

        if (!projectId) {
          throw new Error(
            "Project ID could not be determined. Please set a project ID using the set-project-id tool.",
          );
        }

        // Create Spanner client with explicit project ID
        const spanner = new (await import("@google-cloud/spanner")).Spanner({
          projectId: projectId,
        });

        logger.debug(
          `Using Spanner client with explicit project ID: ${projectId} for gcp-spanner-list-instances`,
        );

        const [instances] = await spanner.getInstances();

        const instanceList = instances ?? [];
        const normalized = instanceList.map((instance) => {
          const metadata = instance.metadata || {};
          return {
            id: instance.id || "unknown",
            state: metadata.state || "unknown",
            config: metadata.config?.split("/").pop() || "unknown",
            nodeCount: metadata.nodeCount ?? metadata.processingUnits,
            processingUnits: metadata.processingUnits,
            displayName: metadata.displayName,
          };
        });

        const text = buildRowsResponse({
          title: "Spanner Instances",
          metadata: { projectId },
          rows: normalized,
          context: {
            instancesResource: `gcp-spanner://${projectId}/instances`,
            databaseResourceTemplate: `gcp-spanner://${projectId}/{instance}/databases`,
          },
          emptyMessage: "No Spanner instances were found in the project.",
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
          `Error listing Spanner instances: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Tool to list databases
  server.tool(
    "gcp-spanner-list-databases",
    {
      instanceId: z.string().describe("Spanner instance ID"),
    },
    async ({ instanceId }, _extra) => {
      try {
        // First try to get the project ID from the state manager
        let projectId = stateManager.getCurrentProjectId();

        if (!projectId) {
          // If not in state manager, try to get it from our function
          const authProjectId = await getProjectId();
          if (authProjectId) {
            projectId = authProjectId;
            logger.debug(`Got project ID from getProjectId: ${projectId}`);
          }
        } else {
          logger.debug(`Got project ID from state manager: ${projectId}`);
        }

        if (!projectId) {
          throw new Error(
            "Project ID could not be determined. Please set a project ID using the set-project-id tool.",
          );
        }

        // Create Spanner client with explicit project ID
        const spanner = new (await import("@google-cloud/spanner")).Spanner({
          projectId: projectId,
        });

        logger.debug(
          `Using Spanner client with project ID: ${projectId} for gcp-spanner-list-databases`,
        );
        const instance = spanner.instance(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
        );

        const [databases] = await instance.getDatabases();

        const databaseList = databases ?? [];
        const normalized = databaseList.map((database) => {
          const metadata = database.metadata || {};
          return {
            id: database.id || "unknown",
            state: metadata.state || "unknown",
            createTime: metadata.createTime,
            encryptionConfig: metadata.encryptionConfig,
          };
        });

        const resolvedInstanceId = Array.isArray(instanceId)
          ? instanceId[0]
          : instanceId;

        const text = buildRowsResponse({
          title: "Spanner Databases",
          metadata: {
            projectId,
            instanceId: resolvedInstanceId,
          },
          rows: normalized,
          context: {
            tablesResourceTemplate: `gcp-spanner://${projectId}/${resolvedInstanceId}/{database}/tables`,
            schemaResourceTemplate: `gcp-spanner://${projectId}/${resolvedInstanceId}/{database}/schema`,
          },
          emptyMessage: "No databases were found in the instance.",
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
          `Error listing Spanner databases: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  // Tool to execute natural language queries against Spanner
  server.tool(
    "gcp-spanner-query-natural-language",
    {
      query: z
        .string()
        .describe(
          "Natural language description of the query you want to execute",
        ),
      instanceId: z
        .string()
        .optional()
        .describe("Spanner instance ID (defaults to SPANNER_INSTANCE env var)"),
      databaseId: z
        .string()
        .optional()
        .describe("Spanner database ID (defaults to SPANNER_DATABASE env var)"),
    },
    async ({ query, instanceId, databaseId }, _extra) => {
      try {
        // First try to get the project ID from the state manager
        let projectId = stateManager.getCurrentProjectId();

        if (!projectId) {
          // If not in state manager, try to get it from our function
          const authProjectId = await getProjectId();
          if (authProjectId) {
            projectId = authProjectId;
            logger.debug(`Got project ID from getProjectId: ${projectId}`);
          }
        } else {
          logger.debug(`Got project ID from state manager: ${projectId}`);
        }

        if (!projectId) {
          throw new Error(
            "Project ID could not be determined. Please set a project ID using the set-project-id tool.",
          );
        }

        const config = await getSpannerConfig(
          Array.isArray(instanceId) ? instanceId[0] : instanceId,
          Array.isArray(databaseId) ? databaseId[0] : databaseId,
        );

        // Get the schema for the database
        const schemaInfo = await getDetailedSchemaForQueryGeneration(
          config.instanceId,
          config.databaseId,
        );

        // Create Spanner client with explicit project ID
        const spanner = new (await import("@google-cloud/spanner")).Spanner({
          projectId: projectId,
        });

        logger.debug(
          `Using Spanner client with project ID: ${projectId} for gcp-spanner-execute-query`,
        );
        const instance = spanner.instance(config.instanceId);
        const database = instance.database(config.databaseId);

        const [tablesResult] = await database.run({
          sql: `SELECT table_name FROM information_schema.tables 
                WHERE table_catalog = '' AND table_schema = ''
                ORDER BY table_name`,
        });

        const tableNames = tablesResult.map(
          (row: any) => row.table_name as string,
        );

        if (!tableNames || tableNames.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `# Query Error\n\nNo tables found in database ${config.databaseId}.`,
              },
            ],
          };
        }

        // Generate a SQL query based on the natural language query and schema
        let generatedSql = "";

        // For simple queries about table structure, generate SQL directly
        if (
          query.toLowerCase().includes("list tables") ||
          query.toLowerCase().includes("show tables") ||
          query.toLowerCase().includes("what tables")
        ) {
          generatedSql = `SELECT table_name FROM information_schema.tables 
                          WHERE table_catalog = '' AND table_schema = ''
                          ORDER BY table_name`;
        } else if (
          query.toLowerCase().includes("schema") ||
          query.toLowerCase().includes("structure") ||
          query.toLowerCase().includes("columns")
        ) {
          // Extract table name if specified
          let tableName = "";
          for (const name of tableNames) {
            if (query.toLowerCase().includes(name.toLowerCase())) {
              tableName = name;
              break;
            }
          }

          if (tableName) {
            generatedSql = `SELECT column_name, spanner_type, is_nullable 
                            FROM information_schema.columns 
                            WHERE table_catalog = '' AND table_schema = '' AND table_name = '${tableName}'
                            ORDER BY ordinal_position`;
          } else {
            generatedSql = `SELECT table_name, column_name, spanner_type 
                            FROM information_schema.columns 
                            WHERE table_catalog = '' AND table_schema = ''
                            ORDER BY table_name, ordinal_position`;
          }
        }
        // For simple 'show all data' queries
        else if (
          query.toLowerCase().includes("all data") ||
          query.toLowerCase().includes("all rows")
        ) {
          // Extract table name if specified
          let tableName = "";
          for (const name of tableNames) {
            if (query.toLowerCase().includes(name.toLowerCase())) {
              tableName = name;
              break;
            }
          }

          if (tableName) {
            generatedSql = `SELECT * FROM ${tableName} LIMIT 100`;
          } else {
            // If no specific table mentioned, return an error
            return {
              content: [
                {
                  type: "text",
                  text: `# Query Error\n\nPlease specify which table you want to see data from. Available tables: ${tableNames.join(", ")}`,
                },
              ],
            };
          }
        }
        // For count queries
        else if (
          query.toLowerCase().includes("count") ||
          query.toLowerCase().includes("how many")
        ) {
          // Extract table name if specified
          let tableName = "";
          for (const name of tableNames) {
            if (query.toLowerCase().includes(name.toLowerCase())) {
              tableName = name;
              break;
            }
          }

          if (tableName) {
            generatedSql = `SELECT COUNT(*) as count FROM ${tableName}`;
          } else {
            // If no specific table mentioned, count rows in all tables
            const countQueries = tableNames.map(
              (name) =>
                `SELECT '${name}' as table_name, COUNT(*) as row_count FROM ${name}`,
            );
            generatedSql = countQueries.join(" UNION ALL ");
          }
        }
        // For more complex queries, provide schema information and ask the user to use gcp-spanner-execute-query
        else {
          return {
            content: [
              {
                type: "text",
                text: `# Complex Query Detected\n\nYour query requires a custom SQL statement. Here's the database schema to help you formulate your query:\n\n\`\`\`\n${schemaInfo}\n\`\`\`\n\nPlease use the \`gcp-spanner-execute-query\` tool with a specific SQL statement to query this data.\n\nExample:\n\`\`\`sql\nSELECT * FROM [table_name] WHERE [condition] LIMIT 100\n\`\`\``,
              },
            ],
          };
        }

        // Execute the generated SQL query
        if (!generatedSql.trim()) {
          throw new Error(
            "Natural language query generation returned an empty SQL statement.",
          );
        }

        assertReadOnlySpannerQuery(generatedSql);

        const [result] = await database.run({
          sql: generatedSql,
        });

        const rows = (result as Record<string, unknown>[]) || [];
        const text = buildRowsResponse({
          title: "Spanner Query Results",
          metadata: {
            projectId,
            instanceId: config.instanceId,
            databaseId: config.databaseId,
          },
          rows,
          context: {
            naturalLanguageQuery: query,
            generatedSql,
          },
          dataLabel: "result",
          emptyMessage:
            "Query executed successfully, but no rows were returned. Use gcp-spanner-execute-query for more control.",
          additionalNote:
            "Need a more complex query? Use the gcp-spanner-execute-query tool with an explicit SQL statement.",
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
          `Error executing natural language Spanner query: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `# Query Error\n\nFailed to execute query: ${error.message}\n\nIf this is a complex query, please use the \`gcp-spanner-execute-query\` tool with a specific SQL statement.`,
            },
          ],
        };
      }
    },
  );
}
