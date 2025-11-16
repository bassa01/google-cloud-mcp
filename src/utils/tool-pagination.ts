import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  McpServer,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { logger } from "./logger.js";

const DEFAULT_PAGE_SIZE = Number(process.env.MCP_TOOL_PAGE_SIZE || "0");
const DEFAULT_MAX_PAGE_SIZE = Number(
  process.env.MCP_TOOL_PAGE_MAX_SIZE || "50",
);

const EMPTY_OBJECT_JSON_SCHEMA = {
  type: "object",
  properties: {},
};

type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;

interface InternalToolRegistry {
  _registeredTools: Record<string, RegisteredTool>;
  server: {
    removeRequestHandler(method: string): void;
    setRequestHandler(
      schema: typeof ListToolsRequestSchema,
      handler: (request: ListToolsRequest) => unknown,
    ): void;
  };
}

interface ToolPaginationOptions {
  pageSize?: number;
  maxPageSize?: number;
}

interface CursorState {
  offset: number;
  service?: string;
  query?: string;
  pageSize?: number;
}

interface ToolListEntry {
  name: string;
  service: string;
  text: string;
  tool: RegisteredTool;
}

const toolPaginationApplied = new WeakSet<McpServer>();

export function configureToolListPagination(
  server: McpServer,
  options: ToolPaginationOptions = {},
): void {
  if (toolPaginationApplied.has(server)) {
    return;
  }

  const configuredPageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const normalizedConfig = Number(configuredPageSize);

  if (!Number.isFinite(normalizedConfig) || normalizedConfig <= 0) {
    logger.debug("Tool list pagination disabled (page size not configured)");
    return;
  }

  const basePageSize = clamp(normalizedConfig, 1, DEFAULT_MAX_PAGE_SIZE);
  const maxPageSize = clamp(
    Number.isFinite(options.maxPageSize)
      ? Number(options.maxPageSize)
      : DEFAULT_MAX_PAGE_SIZE,
    1,
    Number.POSITIVE_INFINITY,
  );

  const registry = server as unknown as InternalToolRegistry;

  registry.server.removeRequestHandler("tools/list");
  registry.server.setRequestHandler(ListToolsRequestSchema, (request) => {
    const cursorState = decodeToolCursor(request.params?.cursor);
    const effectivePageSize = clamp(
      cursorState.pageSize ?? basePageSize,
      1,
      maxPageSize,
    );

    const entries = buildToolIndex(registry._registeredTools);
    const filtered = filterTools(entries, cursorState);
    const page = filtered.slice(
      cursorState.offset,
      cursorState.offset + effectivePageSize,
    );

    const nextOffset = cursorState.offset + page.length;
    const result = {
      tools: page.map(({ name, tool }) =>
        serializeToolDefinition(name, tool),
      ),
      nextCursor:
        nextOffset < filtered.length
          ? encodeToolCursor({ ...cursorState, offset: nextOffset })
          : undefined,
    };

    return result;
  });

  toolPaginationApplied.add(server);

  logger.info(
    `Enabled paginated tools/list responses (pageSize=${basePageSize}, maxPageSize=${maxPageSize})`,
  );
}

export function decodeToolCursor(raw?: string | null): CursorState {
  if (!raw) {
    return { offset: 0 };
  }

  const normalized = raw.trim();
  if (!normalized) {
    return { offset: 0 };
  }

  const decoded =
    tryDecodeBase64Cursor(normalized) ?? tryParseJsonObject(normalized);
  if (decoded) {
    return normalizeCursor(decoded);
  }

  const params = new URLSearchParams(normalized.replace(/\|/g, "&"));
  if ([...params.keys()].length > 0) {
    return normalizeCursor({
      offset: params.get("offset"),
      service: params.get("service") ?? params.get("svc"),
      query: params.get("query") ?? params.get("q"),
      pageSize: params.get("limit") ?? params.get("pageSize"),
    });
  }

  // Allow shorthand "logging" or "logging:10" syntax.
  if (normalized.includes(":")) {
    const [service, offset] = normalized.split(":");
    return normalizeCursor({ service, offset });
  }

  const maybeNumber = Number(normalized);
  if (Number.isFinite(maybeNumber)) {
    return { offset: Math.max(0, maybeNumber) };
  }

  return normalizeCursor({ service: normalized });
}

export function encodeToolCursor(state: CursorState): string {
  const payload = JSON.stringify({
    offset: Math.max(0, state.offset),
    ...(state.service ? { service: state.service } : {}),
    ...(state.query ? { query: state.query } : {}),
    ...(state.pageSize ? { pageSize: state.pageSize } : {}),
  });

  return Buffer.from(payload).toString("base64url");
}

function buildToolIndex(
  tools: Record<string, RegisteredTool>,
): ToolListEntry[] {
  return Object.entries(tools)
    .filter(([, tool]) => tool.enabled)
    .map(([name, tool]) => {
      const service =
        (tool._meta?.service as string | undefined) ?? inferServiceName(name);
      const searchable = [
        name,
        service,
        tool.title ?? "",
        tool.description ?? "",
      ]
        .map((value) => value.toLowerCase())
        .join(" ");

      return {
        name,
        service,
        text: searchable,
        tool,
      } satisfies ToolListEntry;
    })
    .sort((a, b) => {
      if (a.service === b.service) {
        return a.name.localeCompare(b.name);
      }
      return a.service.localeCompare(b.service);
    });
}

function filterTools(entries: ToolListEntry[], cursor: CursorState) {
  let filtered = entries;

  if (cursor.service) {
    const service = cursor.service.toLowerCase();
    filtered = filtered.filter((entry) => entry.service === service);
  }

  if (cursor.query) {
    const query = cursor.query.toLowerCase();
    filtered = filtered.filter((entry) => entry.text.includes(query));
  }

  return filtered;
}

function serializeToolDefinition(name: string, tool: RegisteredTool) {
  const definition: Record<string, unknown> = {
    name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
    inputSchema: tool.inputSchema
      ? zodToJsonSchema(tool.inputSchema, {
          strictUnions: true,
          pipeStrategy: "input",
        })
      : EMPTY_OBJECT_JSON_SCHEMA,
  };

  if (tool.outputSchema) {
    definition.outputSchema = zodToJsonSchema(tool.outputSchema, {
      strictUnions: true,
      pipeStrategy: "output",
    });
  }

  const service = inferServiceName(name);
  const meta = tool._meta ?? {};
  definition._meta = {
    ...meta,
    service: (meta.service as string | undefined) ?? service,
  };

  return definition;
}

function inferServiceName(name: string): string {
  if (!name) {
    return "misc";
  }

  const sanitized = name.startsWith("gcp-") ? name.slice(4) : name;
  const [service] = sanitized.split("-");
  return service?.toLowerCase() || "misc";
}

function tryDecodeBase64Cursor(value: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded) {
      return null;
    }
    return tryParseJsonObject(decoded);
  } catch {
    return null;
  }
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeCursor(input: Record<string, unknown>): CursorState {
  const offset = Number(input.offset);
  const service = sanitizeString(input.service);
  const query = sanitizeString(input.query);
  const pageSize = Number(input.pageSize);

  return {
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
    service,
    query,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : undefined,
  };
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function clamp(value: number | undefined, min = 1, max = 100): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(min, Math.min(max, value as number));
}
