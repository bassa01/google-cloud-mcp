import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

import { readFile, stat } from "node:fs/promises";

import { GcpMcpError } from "../../../../src/utils/error.js";
import {
  findDocsCatalogService,
  loadDocsCatalog,
  resetDocsCatalogCache,
  searchDocsCatalog,
} from "../../../../src/services/docs-catalog/index.js";

const defaultCatalog = {
  metadata: {
    version: "unit-test",
    generatedAt: "2024-01-01T00:00:00.000Z",
  },
  services: [
    {
      id: "logging",
      productName: "Cloud Logging",
      productCategory: "Operations",
      documents: [
        {
          title: "Logging quickstart",
          docType: "guide",
          description: "Quickstart for logging",
          category: "logging",
          url: "https://cloud.google.com/logging/docs/quickstart",
          topics: ["logging", "quickstart"],
        },
        {
          title: "Logging metrics",
          docType: "guide",
          description: "Create metrics",
          category: "metrics",
          url: "https://cloud.google.com/logging/docs/metrics",
          topics: ["metrics"],
        },
      ],
    },
    {
      id: "monitoring",
      productName: "Cloud Monitoring",
      productCategory: "Operations",
      documents: [
        {
          title: "Uptime checks",
          docType: "howto",
          description: "Create uptime checks",
          category: "availability",
          url: "https://cloud.google.com/monitoring/uptime",
          topics: ["uptime"],
        },
      ],
    },
  ],
};

const rankingCatalog = {
  metadata: {
    version: "ranking-test",
    generatedAt: "2024-02-01T00:00:00.000Z",
  },
  services: [
    {
      id: "logging",
      productName: "Cloud Logging",
      productCategory: "Operations",
      documents: [
        {
          title: "Cloud Logging deep dive",
          docType: "guide",
          description: "Deep coverage of Cloud Logging internals.",
          category: "operations",
          url: "https://cloud.google.com/logging/docs/deep-dive",
          topics: ["cloud", "logging"],
        },
        {
          title: "Cloud Logging analytics",
          docType: "guide",
          description: "Cloud Logging analytics overview.",
          category: "operations",
          url: "https://cloud.google.com/logging/docs/analytics",
          topics: [],
        },
        {
          title: "Cloud Logging architecture",
          docType: "guide",
          description: "Cloud Logging analytics overview.",
          category: "operations",
          url: "https://cloud.google.com/logging/docs/architecture",
          topics: [],
        },
      ],
    },
    {
      id: "spanner",
      productName: "Cloud Spanner",
      productCategory: "Database",
      documents: [
        {
          title: "Spanner query guide",
          docType: "guide",
          description: "Query tuning guidance.",
          category: "database",
          url: "https://cloud.google.com/spanner/docs/query-guide",
          topics: ["spanner"],
        },
      ],
    },
  ],
};

describe("docs catalog loader", () => {
  beforeEach(() => {
    resetDocsCatalogCache();
    vi.mocked(readFile).mockReset();
    vi.mocked(stat).mockReset();
  });

  afterEach(() => {
    resetDocsCatalogCache();
    vi.clearAllMocks();
  });

  it("memoizes catalog data until the on-disk mtime changes", async () => {
    const statMock = vi.mocked(stat);
    statMock.mockResolvedValueOnce({ mtimeMs: 100 } as any);
    statMock.mockResolvedValueOnce({ mtimeMs: 100 } as any);
    statMock.mockResolvedValueOnce({ mtimeMs: 200 } as any);

    const readFileMock = vi.mocked(readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify(defaultCatalog));
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        ...defaultCatalog,
        metadata: { ...defaultCatalog.metadata, version: "unit-test-2" },
      }),
    );

    const first = await loadDocsCatalog();
    const second = await loadDocsCatalog();
    const third = await loadDocsCatalog();

    expect(first.metadata.version).toBe("unit-test");
    expect(second.metadata.version).toBe("unit-test");
    expect(third.metadata.version).toBe("unit-test-2");
    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(statMock).toHaveBeenCalledTimes(3);
  });

  it("wraps filesystem failures in a descriptive GcpMcpError", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));

    await expect(loadDocsCatalog()).rejects.toMatchObject<Partial<GcpMcpError>>({
      code: "DOCS_CATALOG_UNAVAILABLE",
      statusCode: 500,
    });
  });

  it("normalizes lookup queries and ranks search results", async () => {
    vi.mocked(stat).mockResolvedValue({ mtimeMs: 100 } as any);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(defaultCatalog));

    const service = await findDocsCatalogService("  cloud logging  ");
    expect(service?.id).toBe("logging");
    expect(service?.productCategory).toBe("Operations");

    const searchResults = await searchDocsCatalog("Logging quickstart", 1);
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]?.serviceId).toBe("logging");
    expect(searchResults[0]?.document.title).toBe("Logging quickstart");
  });

  it("matches catalog entries by product names and categories", async () => {
    vi.mocked(stat).mockResolvedValue({ mtimeMs: 10 } as any);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(defaultCatalog));

    const byName = await findDocsCatalogService("cloud monitoring");
    expect(byName?.id).toBe("monitoring");

    const byCategory = await findDocsCatalogService("operations");
    expect(byCategory?.id).toBe("logging");
  });

  it("skips disk reads for blank search queries", async () => {
    const statMock = vi.mocked(stat);
    const readFileMock = vi.mocked(readFile);

    const results = await searchDocsCatalog("   ");

    expect(results).toEqual([]);
    expect(statMock).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("scores, sorts, and limits search results by relevance", async () => {
    const statMock = vi.mocked(stat);
    const readFileMock = vi.mocked(readFile);
    statMock.mockResolvedValue({ mtimeMs: 200 } as any);
    readFileMock.mockResolvedValue(JSON.stringify(rankingCatalog));

    const ordered = await searchDocsCatalog("Cloud Logging", 3);
    expect(ordered).toHaveLength(3);
    expect(ordered.map((match) => match.document.title)).toEqual([
      "Cloud Logging deep dive",
      "Cloud Logging analytics",
      "Cloud Logging architecture",
    ]);
    expect(ordered[0]?.score).toBeGreaterThan(ordered[1]?.score ?? 0);

    const limited = await searchDocsCatalog("Cloud Logging", 2);
    expect(limited).toHaveLength(2);
    expect(limited.map((match) => match.document.title)).toEqual([
      "Cloud Logging deep dive",
      "Cloud Logging analytics",
    ]);
  });

  it("returns an empty array when no documents match the search tokens", async () => {
    vi.mocked(stat).mockResolvedValue({ mtimeMs: 300 } as any);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(rankingCatalog));

    const results = await searchDocsCatalog("nonexistent product", 5);
    expect(results).toEqual([]);
  });
});
