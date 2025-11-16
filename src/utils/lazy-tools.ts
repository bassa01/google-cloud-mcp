import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "./logger.js";
import { resolveServiceName } from "./service-selector.js";

type ToolCallback = (args: unknown, extra: unknown) => Promise<CallToolResult> | CallToolResult;

interface StoredToolDefinition {
  name: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
  inputSchema?: z.AnyZodObject;
  outputSchema?: z.AnyZodObject;
  callback: ToolCallback;
  acceptsArgs: boolean;
  service: string;
}

interface LazyToolController {
  isEnabled: boolean;
  finalize(): void;
  list(): StoredToolDefinition[];
}

const inferServiceFromName = (name: string): string => {
  const stripped = name.startsWith("gcp-") ? name.slice(4) : name;
  const tokens = stripped.split("-").filter(Boolean);

  for (let i = tokens.length; i >= 1; i -= 1) {
    const candidate = tokens.slice(0, i).join("-");
    const resolved = resolveServiceName(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return tokens[0]?.toLowerCase() || "misc";
};

export const setupLazyToolHost = (
  server: McpServer,
  enabled: boolean,
): LazyToolController => {
  if (!enabled) {
    return {
      isEnabled: false,
      finalize() {},
      list: () => [],
    } satisfies LazyToolController;
  }

  const originalRegister = server.registerTool.bind(server);
  const storedTools = new Map<string, StoredToolDefinition>();

  const hijackedRegister = (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodRawShape;
      outputSchema?: z.ZodRawShape;
      annotations?: ToolAnnotations;
      _meta?: Record<string, unknown>;
    },
    callback: ToolCallback,
  ): RegisteredTool => {
    const inputSchema = config.inputSchema
      ? z.object(config.inputSchema)
      : undefined;
    const outputSchema = config.outputSchema
      ? z.object(config.outputSchema)
      : undefined;

    const stored: StoredToolDefinition = {
      name,
      title: config.title,
      description: config.description,
      annotations: config.annotations,
      _meta: config._meta,
      inputSchema,
      outputSchema,
      callback,
      acceptsArgs: Boolean(inputSchema),
      service: resolveServiceName(name) ?? inferServiceFromName(name),
    };

    storedTools.set(name, stored);

    const registeredTool: RegisteredTool = {
      title: stored.title,
      description: stored.description,
      inputSchema,
      outputSchema,
      annotations: stored.annotations,
      _meta: stored._meta,
      callback,
      enabled: true,
      enable() {
        this.enabled = true;
      },
      disable() {
        this.enabled = false;
      },
      update(updates) {
        if (!updates) return;
        if (typeof updates.title !== "undefined") {
          stored.title = updates.title;
        }
        if (typeof updates.description !== "undefined") {
          stored.description = updates.description;
        }
        if (typeof updates.paramsSchema !== "undefined") {
          stored.inputSchema = z.object(updates.paramsSchema);
        }
        if (typeof updates.outputSchema !== "undefined") {
          stored.outputSchema = z.object(updates.outputSchema);
        }
        if (typeof updates.annotations !== "undefined") {
          stored.annotations = updates.annotations;
        }
        if (typeof updates._meta !== "undefined") {
          stored._meta = updates._meta;
        }
      },
      remove() {
        storedTools.delete(name);
      },
    };

    return registeredTool;
  };

  (server as unknown as { registerTool: typeof server.registerTool }).registerTool =
    hijackedRegister as typeof server.registerTool;

  const finalize = (): void => {
    (server as unknown as { registerTool: typeof server.registerTool }).registerTool =
      originalRegister;

    originalRegister(
      "gcp-tools-directory",
      {
        title: "List available Google Cloud tools",
        description:
          "Returns metadata for Google Cloud MCP tools without streaming their schemas.",
        inputSchema: {
          service: z
            .string()
            .optional()
            .describe("Filter tools by service alias (logging, metrics, trace, etc.)"),
          query: z
            .string()
            .optional()
            .describe("Case-insensitive substring filter across names and descriptions."),
          limit: z
            .number()
            .min(1)
            .max(200)
            .default(50)
            .describe("Maximum number of entries to return."),
        },
      },
      async ({ service, query, limit = 50 }) => {
        const targetService = service
          ? resolveServiceName(service) ?? service.toLowerCase()
          : undefined;
        const normalizedQuery = query?.toLowerCase();

        const entries = Array.from(storedTools.values())
          .filter((tool) => {
            if (targetService && tool.service !== targetService) {
              return false;
            }
            if (!normalizedQuery) {
              return true;
            }
            return (
              tool.name.toLowerCase().includes(normalizedQuery) ||
              (tool.title?.toLowerCase().includes(normalizedQuery) ?? false) ||
              (tool.description?.toLowerCase().includes(normalizedQuery) ?? false)
            );
          })
          .slice(0, limit)
          .map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            service: tool.service,
          }));

        const summary = `Tools directory | service=${
          targetService ?? "*"
        } | query=${normalizedQuery ?? ""} | returned=${entries.length} | total=${storedTools.size}`;
        return {
          content: [
            {
              type: "text" as const,
              text: `${summary}\n\n${JSON.stringify(entries, null, 2)}`,
            },
          ],
        } satisfies CallToolResult;
      },
    );

    originalRegister(
      "gcp-tool-exec",
      {
        title: "Execute a Google Cloud MCP tool",
        description:
          "Runs any registered Google Cloud tool by name, validating arguments lazily.",
        inputSchema: {
          tool: z.string().min(1).describe("Tool name (e.g., gcp-logging-query-logs)."),
          arguments: z
            .record(z.any())
            .default({})
            .describe("Arguments for the selected tool."),
        },
      },
      async ({ tool, arguments: args }, extra) => {
        const definition = storedTools.get(tool);
        if (!definition) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${tool} not found. Use gcp-tools-directory to list available names.`,
              },
            ],
            isError: true,
          } satisfies CallToolResult;
        }

        let parsedArgs: unknown = args ?? {};
        if (definition.inputSchema) {
          const parsed = await definition.inputSchema.safeParseAsync(parsedArgs);
          if (!parsed.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Input validation error for ${tool}: ${parsed.error.message}`,
                },
              ],
              isError: true,
            } satisfies CallToolResult;
          }

          parsedArgs = parsed.data;
        }

        const handler = definition.callback;
        let result: CallToolResult;
        try {
          result = await Promise.resolve(handler(parsedArgs, extra));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Lazy tool execution failed for ${tool}: ${message}`);
          return {
            content: [
              {
                type: "text",
                text: `Failed to execute ${tool}: ${message}`,
              },
            ],
            isError: true,
          } satisfies CallToolResult;
        }

        if (definition.outputSchema && !result.isError) {
          if (!result.structuredContent) {
            return {
              content: [
                {
                  type: "text",
                  text: `Tool ${tool} expected structuredContent but none was returned.`,
                },
              ],
              isError: true,
            } satisfies CallToolResult;
          }

          const parsed = await definition.outputSchema.safeParseAsync(
            result.structuredContent,
          );

          if (!parsed.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Output validation error for ${tool}: ${parsed.error.message}`,
                },
              ],
              isError: true,
            } satisfies CallToolResult;
          }
        }

        return result;
      },
    );

    logger.info(
      `MCP_LAZY_TOOLS enabled; exposed ${storedTools.size} Google Cloud tools via gcp-tool-exec/gcp-tools-directory`,
    );
  };

  return {
    isEnabled: true,
    finalize,
    list: () => Array.from(storedTools.values()),
  } satisfies LazyToolController;
};
