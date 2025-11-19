import { URL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockMcpServer } from "../../../utils/test-helpers.js";
import type {
  DocsCatalogSearchResult,
  DocsCatalogService,
  GoogleCloudDocsCatalog,
} from "../../../../src/services/docs-catalog/types.js";
import { GcpMcpError } from "../../../../src/utils/error.js";

const mockLoadDocsCatalog = vi.fn<[], Promise<GoogleCloudDocsCatalog>>();
const mockFindDocsCatalogService = vi.fn<
  [string],
  Promise<DocsCatalogService | undefined>
>();
const mockSearchDocsCatalog = vi.fn<
  [string, number],
  Promise<DocsCatalogSearchResult[]>
>();

const buildStructuredResponseMock = vi.fn(
  (options: Record<string, any>) => `structured:${options.title}`,
);
const previewListMock = vi.fn(
  (items: unknown[], maxItems: number): { displayed: unknown[]; omitted: number } => {
    if (items.length <= maxItems) {
      return { displayed: items, omitted: 0 };
    }
    return {
      displayed: items.slice(0, maxItems),
      omitted: items.length - maxItems,
    };
  },
);

vi.mock("../../../../src/services/docs-catalog/catalog.js", () => ({
  loadDocsCatalog: mockLoadDocsCatalog,
  findDocsCatalogService: mockFindDocsCatalogService,
  searchDocsCatalog: mockSearchDocsCatalog,
}));

vi.mock("../../../../src/utils/output.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/utils/output.js")
  >("../../../../src/utils/output.js");
  return {
    ...actual,
    buildStructuredResponse: buildStructuredResponseMock,
    previewList: previewListMock,
  };
});

const catalogFixture: GoogleCloudDocsCatalog = {
  metadata: {
    generatedAt: "2024-03-01T00:00:00.000Z",
    description: "Latest ingestion of curated Google Cloud docs.",
  },
  services: [
    {
      id: "logging",
      productName: "Cloud Logging",
      productCategory: "Operations",
      officialDocsRoot: "https://cloud.google.com/logging/docs",
      summary: "Centralized log management.",
      lastValidated: "2024-02-28",
      documents: [
        {
          title: "Quickstart",
          docType: "guide",
          url: "https://cloud.google.com/logging/docs/quickstart",
          description: "Set up Cloud Logging.",
        },
        {
          title: "Metrics",
          docType: "guide",
          url: "https://cloud.google.com/logging/docs/metrics",
          description: "Create log-based metrics.",
        },
        {
          title: "Exports",
          docType: "guide",
          url: "https://cloud.google.com/logging/docs/export",
          description: "Export logs to other systems.",
        },
      ],
    },
    {
      id: "spanner",
      productName: "Cloud Spanner",
      productCategory: "Database",
      officialDocsRoot: "https://cloud.google.com/spanner/docs",
      summary: "Horizontally scalable relational DB.",
      lastValidated: "2024-02-26",
      documents: [
        {
          title: "Overview",
          docType: "concept",
          url: "https://cloud.google.com/spanner/docs/overview",
          description: "Understand Spanner's architecture.",
        },
      ],
    },
  ],
};

const searchMatches: DocsCatalogSearchResult[] = [
  {
    serviceId: "logging",
    serviceName: "Cloud Logging",
    serviceCategory: "Operations",
    score: 42,
    document: catalogFixture.services[0]!.documents[0]!,
  },
];

const ORIGINAL_PREVIEW_LIMIT = process.env.DOCS_CATALOG_PREVIEW_LIMIT;
const ORIGINAL_SEARCH_LIMIT = process.env.DOCS_CATALOG_SEARCH_LIMIT;

const importResourcesModule = () =>
  import("../../../../src/services/docs-catalog/resources.js");

describe("docs catalog resources", () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.resetModules();
    mockServer = createMockMcpServer();
    mockServer.resource.mockClear();
    mockLoadDocsCatalog.mockReset();
    mockFindDocsCatalogService.mockReset();
    mockSearchDocsCatalog.mockReset();
    buildStructuredResponseMock.mockClear();
    previewListMock.mockClear();
    delete process.env.DOCS_CATALOG_PREVIEW_LIMIT;
    delete process.env.DOCS_CATALOG_SEARCH_LIMIT;
  });

  afterEach(() => {
    if (ORIGINAL_PREVIEW_LIMIT === undefined) {
      delete process.env.DOCS_CATALOG_PREVIEW_LIMIT;
    } else {
      process.env.DOCS_CATALOG_PREVIEW_LIMIT = ORIGINAL_PREVIEW_LIMIT;
    }
    if (ORIGINAL_SEARCH_LIMIT === undefined) {
      delete process.env.DOCS_CATALOG_SEARCH_LIMIT;
    } else {
      process.env.DOCS_CATALOG_SEARCH_LIMIT = ORIGINAL_SEARCH_LIMIT;
    }
  });

  const getResourceHandler = (
    resourceId: string,
  ): ((uri: URL, params?: Record<string, unknown>) => Promise<any>) => {
    const call = mockServer.resource.mock.calls.find(
      ([registeredId]) => registeredId === resourceId,
    );
    if (!call) {
      throw new Error(`Resource ${resourceId} was not registered`);
    }
    return call[2] as (uri: URL, params?: Record<string, unknown>) => Promise<any>;
  };

  it("registers catalog, service, and search resources", async () => {
    mockLoadDocsCatalog.mockResolvedValue(catalogFixture);
    const { registerDocsCatalogResources } = await importResourcesModule();

    registerDocsCatalogResources(mockServer as any);

    expect(mockServer.resource).toHaveBeenCalledTimes(3);

    const catalogHandler = getResourceHandler("gcp-docs-catalog");
    const response = await catalogHandler(
      new URL("docs://google-cloud/catalog"),
    );

    expect(mockLoadDocsCatalog).toHaveBeenCalledTimes(1);
    expect(buildStructuredResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Google Cloud Documentation Catalog",
        dataLabel: "services",
        metadata: expect.objectContaining({
          services: catalogFixture.services.length,
          generatedAt: catalogFixture.metadata.generatedAt,
        }),
        data: catalogFixture.services.map((service) => ({
          id: service.id,
          name: service.productName,
          category: service.productCategory,
          documents: service.documents.length,
          lastValidated: service.lastValidated,
          officialDocsRoot: service.officialDocsRoot,
        })),
      }),
    );
    expect(response).toEqual({
      contents: [
        {
          uri: "docs://google-cloud/catalog",
          text: "structured:Google Cloud Documentation Catalog",
        },
      ],
    });
  });

  it("returns a preview for a specific service", async () => {
    mockFindDocsCatalogService.mockResolvedValue(catalogFixture.services[0]);
    const { registerDocsCatalogResources } = await importResourcesModule();

    registerDocsCatalogResources(mockServer as any);

    const serviceHandler = getResourceHandler("gcp-docs-service");
    const response = await serviceHandler(
      new URL("docs://google-cloud/logging"),
      { serviceId: "logging" },
    );

    expect(mockFindDocsCatalogService).toHaveBeenCalledWith("logging");
    expect(previewListMock).toHaveBeenCalledWith(
      catalogFixture.services[0]!.documents,
      25,
    );
    const previewResult = previewListMock.mock.results
      .at(-1)?.value as { displayed: unknown[]; omitted: number };

    expect(buildStructuredResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Google Cloud Docs · Cloud Logging",
        metadata: expect.objectContaining({
          id: "logging",
          category: "Operations",
          officialDocsRoot: "https://cloud.google.com/logging/docs",
        }),
        dataLabel: "documents",
        data: previewResult.displayed,
        preview: expect.objectContaining({
          total: catalogFixture.services[0]!.documents.length,
          displayed: previewResult.displayed.length,
          limit: 25,
        }),
      }),
    );
    expect(response.contents[0]?.text).toBe(
      "structured:Google Cloud Docs · Cloud Logging",
    );
  });

  it("rejects service requests without an ID", async () => {
    const { registerDocsCatalogResources } = await importResourcesModule();
    registerDocsCatalogResources(mockServer as any);

    const serviceHandler = getResourceHandler("gcp-docs-service");

    await expect(
      serviceHandler(new URL("docs://google-cloud/logging")),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", statusCode: 400 });
  });

  it("rejects unknown services", async () => {
    mockFindDocsCatalogService.mockResolvedValue(undefined);
    const { registerDocsCatalogResources } = await importResourcesModule();
    registerDocsCatalogResources(mockServer as any);

    const serviceHandler = getResourceHandler("gcp-docs-service");

    await expect(
      serviceHandler(new URL("docs://google-cloud/spanner"), {
        serviceId: "spanner",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("executes catalog searches with bounded result sets", async () => {
    mockSearchDocsCatalog.mockResolvedValue(searchMatches);
    const { registerDocsCatalogResources } = await importResourcesModule();

    registerDocsCatalogResources(mockServer as any);

    const searchHandler = getResourceHandler("gcp-docs-search");
    const response = await searchHandler(
      new URL("docs://google-cloud/search/logging"),
      { query: "Logging" },
    );

    expect(mockSearchDocsCatalog).toHaveBeenCalledWith("Logging", 8);
    expect(buildStructuredResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Google Cloud Docs Search",
        metadata: expect.objectContaining({
          query: "Logging",
          matches: searchMatches.length,
          limit: 8,
        }),
        dataLabel: "matches",
        data: searchMatches.map((result) => ({
          serviceId: result.serviceId,
          serviceName: result.serviceName,
          category: result.serviceCategory,
          score: result.score,
          document: result.document,
        })),
      }),
    );
    expect(response.contents[0]?.text).toBe(
      "structured:Google Cloud Docs Search",
    );
  });

  it("rejects blank search queries", async () => {
    const { registerDocsCatalogResources } = await importResourcesModule();
    registerDocsCatalogResources(mockServer as any);

    const searchHandler = getResourceHandler("gcp-docs-search");

    await expect(
      searchHandler(new URL("docs://google-cloud/search/logging"), {
        query: " ",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", statusCode: 400 });
  });

  it("honours environment overrides for preview and search limits", async () => {
    process.env.DOCS_CATALOG_PREVIEW_LIMIT = "5";
    process.env.DOCS_CATALOG_SEARCH_LIMIT = "3";

    mockFindDocsCatalogService.mockResolvedValue(catalogFixture.services[0]);
    mockSearchDocsCatalog.mockResolvedValue(searchMatches);

    const { registerDocsCatalogResources } = await importResourcesModule();
    registerDocsCatalogResources(mockServer as any);

    const serviceHandler = getResourceHandler("gcp-docs-service");
    await serviceHandler(new URL("docs://google-cloud/logging"), {
      serviceId: "logging",
    });

    expect(previewListMock).toHaveBeenLastCalledWith(
      catalogFixture.services[0]!.documents,
      5,
    );

    const searchHandler = getResourceHandler("gcp-docs-search");
    await searchHandler(new URL("docs://google-cloud/search/logging"), {
      query: "logging",
    });

    expect(mockSearchDocsCatalog).toHaveBeenLastCalledWith("logging", 3);
  });
});
