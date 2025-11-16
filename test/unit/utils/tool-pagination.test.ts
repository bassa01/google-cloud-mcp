import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  configureToolListPagination,
  decodeToolCursor,
  encodeToolCursor,
} from "../../../src/utils/tool-pagination.js";

function createTool(overrides: Partial<RegisteredTool> = {}): RegisteredTool {
  const noop = vi.fn();
  return {
    title: "",
    description: "",
    inputSchema: z.object({ filter: z.string().optional() }),
    outputSchema: undefined,
    annotations: undefined,
    _meta: undefined,
    callback: vi.fn(),
    enabled: true,
    enable: noop,
    disable: noop,
    update: noop,
    remove: noop,
    ...overrides,
  };
}

function createServerStub() {
  const handlers: { list?: (request: unknown) => any } = {};
  const server = {
    _registeredTools: {
      "gcp-logging-query-logs": createTool({ title: "Logging" }),
      "gcp-monitoring-query-metrics": createTool({ title: "Monitoring" }),
      "gcp-spanner-execute-query": createTool({ title: "Spanner" }),
      "gcp-error-reporting-list-incidents": createTool({
        title: "Error Reporting",
      }),
    },
    server: {
      removeRequestHandler: vi.fn(),
      setRequestHandler: vi.fn((_schema, handler) => {
        handlers.list = handler;
      }),
    },
  };

  return { server, handlers };
}

describe("configureToolListPagination", () => {
  it("paginates tool definitions", () => {
    const { server, handlers } = createServerStub();

    configureToolListPagination(server as unknown as any, {
      pageSize: 1,
      maxPageSize: 5,
    });

    expect(server.server.removeRequestHandler).toHaveBeenCalledWith(
      "tools/list",
    );
    expect(server.server.setRequestHandler).toHaveBeenCalledTimes(1);

    const list = handlers.list!;
    const page1 = list({ params: {} });
    expect(page1.tools).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = list({ params: { cursor: page1.nextCursor } });
    expect(page2.tools).toHaveLength(1);
    expect(page2.tools[0].name).not.toBe(page1.tools[0].name);
  });

  it("filters by service shorthand cursor", () => {
    const { server, handlers } = createServerStub();

    configureToolListPagination(server as unknown as any, {
      pageSize: 5,
    });

    const list = handlers.list!;
    const filtered = list({ params: { cursor: "service=logging" } });
    expect(filtered.tools).toHaveLength(1);
    expect(filtered.tools[0].name).toBe("gcp-logging-query-logs");
  });

  it("filters by hyphenated service name", () => {
    const { server, handlers } = createServerStub();

    configureToolListPagination(server as unknown as any, {
      pageSize: 5,
    });

    const list = handlers.list!;
    const filtered = list({ params: { cursor: "service=error-reporting" } });

    expect(filtered.tools).toHaveLength(1);
    expect(filtered.tools[0].name).toBe(
      "gcp-error-reporting-list-incidents",
    );
  });
});

describe("cursor helpers", () => {
  it("round-trips encode/decode", () => {
    const cursor = encodeToolCursor({ offset: 5, service: "logging", query: "err" });
    const decoded = decodeToolCursor(cursor);
    expect(decoded.offset).toBe(5);
    expect(decoded.service).toBe("logging");
    expect(decoded.query).toBe("err");
  });

  it("parses query-string cursors", () => {
    const decoded = decodeToolCursor("service=monitoring&offset=10&pageSize=2");
    expect(decoded.service).toBe("monitoring");
    expect(decoded.offset).toBe(10);
    expect(decoded.pageSize).toBe(2);
  });

  it("decodes base64url-encoded cursors", () => {
    const cursor = Buffer.from(
      JSON.stringify({ offset: 3, service: "error-reporting" }),
    ).toString("base64url");

    const decoded = decodeToolCursor(cursor);

    expect(decoded.service).toBe("error-reporting");
    expect(decoded.offset).toBe(3);
  });
});
