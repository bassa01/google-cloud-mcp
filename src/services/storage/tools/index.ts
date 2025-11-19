import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBucketTools } from "./buckets.js";
import { registerObjectTools } from "./objects.js";

export function registerStorageTools(server: McpServer): void {
  registerBucketTools(server);
  registerObjectTools(server);
}
