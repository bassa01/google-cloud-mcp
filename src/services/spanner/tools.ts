/**
 * Google Cloud Spanner tools for MCP
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectId } from "../../utils/auth.js";
import { getSpannerClient, getSpannerConfig } from "./types.js";
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
          `Using Spanner client with project ID: ${spanner.projectId} for gcp-spanner-list-tables`,
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
}
