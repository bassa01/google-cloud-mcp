/**
 * Google Cloud MCP Server
 *
 * This server provides Model Context Protocol resources and tools for interacting
 * with Google Cloud services (Error Reporting, Logging, Monitoring, Profiler, Spanner, and Trace).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dotenv from "dotenv";
import { z } from "zod";

// Import service modules
import {
  registerLoggingResources,
  registerLoggingTools,
} from "./services/logging/index.js";
import {
  registerSpannerResources,
  registerSpannerTools,
  registerSpannerQueryCountTool,
} from "./services/spanner/index.js";
import {
  registerMonitoringResources,
  registerMonitoringTools,
} from "./services/monitoring/index.js";
import { registerBigQueryTools } from "./services/bigquery/index.js";
import { registerTraceService } from "./services/trace/index.js";
import {
  registerErrorReportingResources,
  registerErrorReportingTools,
} from "./services/error-reporting/index.js";
import {
  registerProfilerResources,
  registerProfilerTools,
} from "./services/profiler/index.js";
import { registerSupportTools } from "./services/support/index.js";
import { registerDocsTools } from "./services/docs/index.js";
import { registerGcloudTools } from "./services/gcloud/index.js";
import { registerPrompts } from "./prompts/index.js";
import { initGoogleAuth, authClient } from "./utils/auth.js";
import { registerResourceDiscovery } from "./utils/resource-discovery.js";
import { registerProjectTools } from "./utils/project-tools.js";
import { registerDocsCatalogResources } from "./services/docs-catalog/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./utils/logger.js";
import {
  getEnabledServices,
  isServiceEnabled,
  parseServiceSelection,
  resolveServiceName,
  type ServiceName,
} from "./utils/service-selector.js";
import { configureToolListPagination } from "./utils/tool-pagination.js";

type ServerMode = "daemon" | "standalone";

// Load environment variables
dotenv.config();

// Using imported structured logger from utils/logger.ts

/**
 * Main function to start the MCP server
 */
async function main(): Promise<void> {
  // Set up unhandled error handlers to prevent silent crashes
  process.on("uncaughtException", (error) => {
    logger.error(error);
    // Don't exit, just log the error
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
    // Don't exit, just log the error
  });

  // Enhanced signal handlers for graceful shutdown
  let isShuttingDown = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const gracefulShutdown = async (
    reason: string,
    exitCode: number = 0,
  ): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${reason} signal, shutting down gracefully`);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }

    try {
      // Close any remaining connections
      logger.info("Graceful shutdown completed");
      process.exit(exitCode);
    } catch (error) {
      logger.error(
        `Error during shutdown: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(exitCode === 0 ? 1 : exitCode);
    }
  };

  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });

  // Debug environment variables
  if (process.env.DEBUG) {
    logger.debug("Environment variables:");
    logger.debug(
      `GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || "not set"}`,
    );
    logger.debug(
      `GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT || "not set"}`,
    );
    logger.debug(
      `GOOGLE_CLIENT_EMAIL: ${process.env.GOOGLE_CLIENT_EMAIL ? "set" : "not set"}`,
    );
    logger.debug(
      `GOOGLE_PRIVATE_KEY: ${process.env.GOOGLE_PRIVATE_KEY ? "set" : "not set"}`,
    );
    logger.debug(`LAZY_AUTH: ${process.env.LAZY_AUTH || "not set"}`);
    logger.debug(`DEBUG: ${process.env.DEBUG || "not set"}`);
  }

  try {
    logger.info("Starting Google Cloud MCP server...");

    const serverModeEnv = process.env.MCP_SERVER_MODE?.toLowerCase();
    let serverMode: ServerMode = "daemon";

    if (serverModeEnv) {
      if (serverModeEnv === "daemon" || serverModeEnv === "standalone") {
        serverMode = serverModeEnv;
      } else {
        logger.warn(
          `Unknown MCP_SERVER_MODE value: ${process.env.MCP_SERVER_MODE}. Falling back to daemon mode`,
        );
      }
    }

    const isStandaloneMode = serverMode === "standalone";
    logger.info(
      `Execution mode: ${isStandaloneMode ? "standalone (exit after transport closes)" : "daemon (keep process alive)"}`,
    );

    // Create the MCP server first to ensure it's ready to handle requests
    // even if authentication is still initializing
    logger.info("Creating MCP server instance");
    const server = new McpServer(
      {
        name: "Google Cloud MCP",
        version: "0.1.0",
        description: "Model Context Protocol server for Google Cloud services",
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {},
        },
      },
    );

    // Initialize Google Cloud authentication in non-blocking mode
    // This allows the server to start even if credentials aren't available yet
    const lazyAuth = process.env.LAZY_AUTH !== "false"; // Default to true if not set
    logger.info(
      `Initializing Google Cloud authentication in lazy loading mode: ${lazyAuth}`,
    );

    // If LAZY_AUTH is true (default), we'll defer authentication until it's actually needed
    // This helps with Smithery which may time out during auth initialization
    if (!lazyAuth) {
      try {
        const auth = await initGoogleAuth(false);
        if (auth) {
          logger.info("Google Cloud authentication initialized successfully");
        } else {
          logger.warn(
            "Google Cloud authentication not available - will attempt lazy loading when needed",
          );
        }
      } catch (err) {
        logger.warn(
          `Auth initialization warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const serviceSelection = parseServiceSelection(
      process.env.MCP_ENABLED_SERVICES,
    );

    if (process.env.MCP_ENABLED_SERVICES) {
      if (serviceSelection.mode === "custom") {
        logger.info(
          `MCP_ENABLED_SERVICES restricting active services to: ${getEnabledServices(serviceSelection).join(", ")}`,
        );
      } else {
        logger.info(
          "MCP_ENABLED_SERVICES matched wildcard/ALL value; enabling every Google Cloud service",
        );
      }
    }

    if (serviceSelection.invalidEntries.length > 0) {
      logger.warn(
        `Ignoring unknown MCP_ENABLED_SERVICES entries: ${serviceSelection.invalidEntries.join(", ")}`,
      );
    }

    const serviceRegistrations: Array<{
      name: ServiceName;
      label: string;
      register: () => Promise<void>;
    }> = [
      {
        name: "logging",
        label: "Google Cloud Logging",
        register: async () => {
          registerLoggingResources(server);
          registerLoggingTools(server);
        },
      },
    {
      name: "spanner",
      label: "Google Cloud Spanner",
      register: async () => {
        registerSpannerResources(server);
        registerSpannerTools(server);
        registerSpannerQueryCountTool(server);
      },
    },
    {
      name: "bigquery",
      label: "Google Cloud BigQuery",
      register: async () => {
        registerBigQueryTools(server);
      },
    },
      {
        name: "monitoring",
        label: "Google Cloud Monitoring",
        register: async () => {
          registerMonitoringResources(server);
          await registerMonitoringTools(server);
        },
      },
      {
        name: "trace",
        label: "Google Cloud Trace",
        register: async () => {
          await registerTraceService(server);
        },
      },
      {
        name: "error-reporting",
        label: "Google Cloud Error Reporting",
        register: async () => {
          registerErrorReportingResources(server);
          registerErrorReportingTools(server);
        },
      },
      {
        name: "profiler",
        label: "Google Cloud Profiler",
        register: async () => {
          registerProfilerResources(server);
          registerProfilerTools(server);
        },
      },
      {
        name: "support",
        label: "Google Cloud Support",
        register: async () => {
          registerSupportTools(server);
        },
      },
      {
        name: "docs",
        label: "Google Cloud Documentation",
        register: async () => {
          registerDocsTools(server);
        },
      },
      {
        name: "gcloud",
        label: "gcloud CLI (read-only)",
        register: async () => {
          registerGcloudTools(server);
        },
      },
    ];
    const serviceMap = new Map<ServiceName, (typeof serviceRegistrations)[number]>(
      serviceRegistrations.map((svc) => [svc.name, svc]),
    );
    const loadedServices = new Set<ServiceName>();
    const loadingServices = new Map<ServiceName, Promise<void>>();

    const ensureServiceLoaded = async (
      serviceName: ServiceName,
    ): Promise<boolean> => {
      if (loadedServices.has(serviceName)) {
        return false;
      }

      const descriptor = serviceMap.get(serviceName);
      if (!descriptor) {
        throw new Error(`Unknown service: ${serviceName}`);
      }

      let pending = loadingServices.get(serviceName);
      if (!pending) {
        pending = (async () => {
          logger.info(`Registering ${descriptor.label} services`);
          await descriptor.register();
          loadedServices.add(serviceName);
          logger.info(`${descriptor.label} services registered`);
        })();
        loadingServices.set(serviceName, pending);
      }

      try {
        await pending;
        return true;
      } catch (error) {
        throw error;
      } finally {
        loadingServices.delete(serviceName);
      }
    };

    const registerServiceLoaderTool = (): void => {
      server.registerTool(
        "gcp-services-load",
        {
          title: "Load Google Cloud service tools",
          description:
            "Registers the requested Google Cloud service integrations so you only fetch tool schemas on demand.",
          inputSchema: {
            services: z
              .array(
                z
                  .string()
                  .min(1)
                  .describe(
                    "Service names or aliases (logging, spanner, bigquery, monitoring, trace, error-reporting, profiler, support, docs, gcloud).",
                  ),
              )
              .min(1)
              .describe(
                "List of services to load before invoking their individual tools.",
              ),
          },
        },
        async ({ services }) => {
          const tokenize = (value: string): string[] =>
            value
              .split(/[\s,]+/)
              .map((part) => part.trim())
              .filter((part) => part.length > 0);

          const tokens = Array.from(
            new Set(services.flatMap((entry) => tokenize(entry))),
          );

          const requested: ServiceName[] = [];
          const invalidTokens: string[] = [];
          const disabledTokens: string[] = [];

          for (const token of tokens) {
            const resolved = resolveServiceName(token);
            if (!resolved) {
              invalidTokens.push(token);
              continue;
            }

            if (!isServiceEnabled(serviceSelection, resolved)) {
              disabledTokens.push(token);
              continue;
            }

            if (!requested.includes(resolved)) {
              requested.push(resolved);
            }
          }

          if (requested.length === 0) {
            const messageParts = [];
            if (invalidTokens.length > 0) {
              messageParts.push(
                `Unknown services: ${invalidTokens.join(", ")}`,
              );
            }
            if (disabledTokens.length > 0) {
              messageParts.push(
                `Disabled via MCP_ENABLED_SERVICES: ${disabledTokens.join(", ")}`,
              );
            }

            const fallback =
              messageParts.length > 0
                ? messageParts.join(" | ")
                : "No valid services were provided.";

            return {
              content: [
                {
                  type: "text",
                  text: fallback,
                },
              ],
              isError: true,
            };
          }

          const newlyLoaded: ServiceName[] = [];
          const alreadyLoaded: ServiceName[] = [];
          const failures: Array<{ service: ServiceName; error: string }> = [];

          for (const name of requested) {
            try {
              const loaded = await ensureServiceLoaded(name);
              if (loaded) {
                newlyLoaded.push(name);
              } else {
                alreadyLoaded.push(name);
              }
            } catch (error) {
              failures.push({
                service: name,
                error:
                  error instanceof Error ? error.message : String(error),
              });
            }
          }

          if (newlyLoaded.length > 0) {
            server.sendToolListChanged();
            server.sendResourceListChanged();
            server.sendPromptListChanged();
          }

          const labelFor = (service: ServiceName): string => {
            const descriptor = serviceMap.get(service);
            return descriptor ? descriptor.label : service;
          };

          const summaryParts: string[] = [];
          if (newlyLoaded.length > 0) {
            summaryParts.push(
              `Loaded services: ${newlyLoaded.map(labelFor).join(", ")}`,
            );
          }
          if (alreadyLoaded.length > 0) {
            summaryParts.push(
              `Already registered: ${alreadyLoaded.map(labelFor).join(", ")}`,
            );
          }
          if (invalidTokens.length > 0) {
            summaryParts.push(`Unknown services: ${invalidTokens.join(", ")}`);
          }
          if (disabledTokens.length > 0) {
            summaryParts.push(
              `Disabled via MCP_ENABLED_SERVICES: ${disabledTokens.join(", ")}`,
            );
          }
          if (failures.length > 0) {
            summaryParts.push(
              `Failed: ${failures
                .map((item) => `${labelFor(item.service)} (${item.error})`)
                .join(", ")}`,
            );
          }

          summaryParts.push(
            "Re-run tools/list (optionally with cursor=service=<name>) to download only the schemas you just loaded.",
          );

          return {
            content: [
              {
                type: "text",
                text: summaryParts.join("\n"),
              },
            ],
            isError: failures.length === requested.length,
          };
        },
      );
    };

    const lazyServiceMode =
      process.env.MCP_LAZY_TOOLS?.toLowerCase() === "true";

    if (lazyServiceMode) {
      logger.info(
        "MCP_LAZY_TOOLS enabled; load tool definitions via the gcp-services-load helper as you need them.",
      );
      registerServiceLoaderTool();
    } else {
      for (const service of serviceRegistrations) {
        if (!isServiceEnabled(serviceSelection, service.name)) {
          logger.info(
            `Skipping ${service.label} registration (disabled via MCP_ENABLED_SERVICES)`,
          );
          continue;
        }

        try {
          await ensureServiceLoaded(service.name);
        } catch (error) {
          logger.warn(
            `Error registering ${service.label} services: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    try {
      // Register additional tools
      logger.info("Registering additional tools");
      registerProjectTools(server);
    } catch (error) {
      logger.warn(
        `Error registering project tools: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      // Register prompts
      logger.info("Registering prompts");
      registerPrompts(server);
    } catch (error) {
      logger.warn(
        `Error registering prompts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      // Register documentation catalog resources
      logger.info("Registering documentation catalog resources");
      registerDocsCatalogResources(server);
    } catch (error) {
      logger.warn(
        `Error registering documentation catalog resources: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      // Register resource discovery endpoints
      logger.info("Registering resource discovery");
      await registerResourceDiscovery(server);
    } catch (error) {
      logger.warn(
        `Error registering resource discovery: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    configureToolListPagination(server);

    // Initialize stdio transport for Claude Desktop compatibility
    logger.info("Initializing stdio transport for Claude Desktop");
    const transport = new StdioServerTransport();

    await server.connect(transport);

    const existingCloseHandler = transport.onclose?.bind(transport);
    transport.onclose = () => {
      if (isStandaloneMode) {
        logger.info(
          "Standalone mode enabled; transport closed so the server will exit",
        );
        void gracefulShutdown("STDIO transport closed");
      } else {
        logger.info("STDIO transport closed; waiting in daemon mode");
      }

      existingCloseHandler?.();
    };

    logger.info("Server started successfully and ready to handle requests");

    if (!isStandaloneMode) {
      // Keep the process alive and periodically check auth status
      let heartbeatCount = 0;
      heartbeatTimer = setInterval(() => {
        // Heartbeat to keep the process alive
        heartbeatCount++;
        if (process.env.DEBUG) {
          logger.debug(`Server heartbeat #${heartbeatCount}`);
        }

        // Check auth status periodically, but not on every heartbeat to reduce load
        // Only check auth every 5 heartbeats (approximately every 2.5 minutes)
        if (!authClient && heartbeatCount % 5 === 0) {
          logger.debug("Attempting delayed authentication check");
          initGoogleAuth(false)
            .then((auth) => {
              if (auth && !authClient) {
                logger.info(
                  "Google Cloud authentication initialized successfully (delayed)",
                );
              }
            })
            .catch((authError) => {
              // Log but don't crash on auth errors
              logger.debug(
                `Delayed auth check failed: ${authError instanceof Error ? authError.message : String(authError)}`,
              );
            });
        }
      }, 30000);
    }
  } catch (error) {
    // Log the error to stderr (won't interfere with stdio protocol)
    logger.error(
      `Failed to start MCP server: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.error(
      error instanceof Error
        ? error.stack || "No stack trace available"
        : "No stack trace available",
    );

    // Don't exit immediately, give time for logs to be seen
    // But also don't exit at all - let the server continue running even with errors
    // This is important for Smithery which expects the server to stay alive
    logger.info("Server continuing to run despite startup errors");
  }
}

// Start the server
main();
