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
});
