import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockMcpServer } from "../../../utils/test-helpers.js";

vi.mock("../../../../src/services/docs/search.js", () => ({
  searchGoogleCloudDocs: vi.fn(),
}));

describe("docs tools", () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
  });

  afterEach(() => {
    delete process.env.DOCS_SEARCH_PREVIEW_LIMIT;
  });

  it("registers the docs search tool with the MCP server", async () => {
    const { registerDocsTools } = await import("../../../../src/services/docs/tools.js");

    registerDocsTools(mockServer as any);

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "google-cloud-docs-search",
      expect.objectContaining({ title: "Google Cloud Docs Search" }),
      expect.any(Function),
    );
  });

  it("invokes the search backend and formats successful responses", async () => {
    const { registerDocsTools } = await import("../../../../src/services/docs/tools.js");
    const { searchGoogleCloudDocs } = await import("../../../../src/services/docs/search.js");
    const searchMock = vi.mocked(searchGoogleCloudDocs);
    searchMock.mockResolvedValue({
      results: [
        {
          title: "Cloud Run request concurrency",
          url: "https://cloud.google.com/run/docs/concurrency",
          summary: "Explains concurrency settings",
          tags: ["cloud run"],
          product: "cloud-run",
          lastReviewed: "2025-01-01T00:00:00.000Z",
          score: 0.87,
          rank: 1,
        },
      ],
      approxTotalResults: 4,
      fetchedResults: 50,
      catalogPath: "/tmp/catalog.json",
      catalogUpdated: "2024-12-01T00:00:00.000Z",
    });

    registerDocsTools(mockServer as any);
    const handler = findToolHandler(mockServer, "google-cloud-docs-search");

    const response = await handler({ query: "cloud run", maxResults: 1 });

    expect(searchMock).toHaveBeenCalledWith({ query: "cloud run", maxResults: 1 });
    expect(response.content[0]?.text).toContain("Google Cloud Docs Search");
    expect(response.content[0]?.text).toContain(
      '"title": "Cloud Run request concurrency"',
    );
  });

  it("uses the DOCS_SEARCH_PREVIEW_LIMIT env var as the default limit", async () => {
    process.env.DOCS_SEARCH_PREVIEW_LIMIT = "7";
    vi.resetModules();

    const { registerDocsTools } = await import("../../../../src/services/docs/tools.js");
    const { searchGoogleCloudDocs } = await import("../../../../src/services/docs/search.js");
    const searchMock = vi.mocked(searchGoogleCloudDocs);
    searchMock.mockResolvedValue({
      results: [],
      approxTotalResults: 0,
      fetchedResults: 0,
      catalogPath: "test",
    });

    registerDocsTools(mockServer as any);
    const handler = findToolHandler(mockServer, "google-cloud-docs-search");
    await handler({ query: "spanner" });

    expect(searchMock).toHaveBeenCalledWith({ query: "spanner", maxResults: 7 });
  });

  it("returns a structured error payload when the search backend fails", async () => {
    const { registerDocsTools } = await import("../../../../src/services/docs/tools.js");
    const { searchGoogleCloudDocs } = await import("../../../../src/services/docs/search.js");
    const searchMock = vi.mocked(searchGoogleCloudDocs);
    searchMock.mockRejectedValue(new Error("catalog missing"));

    registerDocsTools(mockServer as any);
    const handler = findToolHandler(mockServer, "google-cloud-docs-search");

    const response = await handler({ query: "broken" });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Google Cloud Docs Search Error");
    expect(response.content[0]?.text).toContain("broken");
  });
});

function findToolHandler(
  server: ReturnType<typeof createMockMcpServer>,
  toolName: string,
): (args: Record<string, unknown>) => Promise<unknown> {
  const call = server.registerTool.mock.calls.find(([name]) => name === toolName);
  if (!call) {
    throw new Error(`Tool ${toolName} was not registered`);
  }
  return call[2] as (args: Record<string, unknown>) => Promise<unknown>;
}
