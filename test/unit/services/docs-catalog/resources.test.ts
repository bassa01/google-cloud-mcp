/**
 * Tests for documentation catalog resources.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockMcpServer } from "../../../utils/test-helpers.js";
import {
  findDocsCatalogService,
  loadDocsCatalog,
  registerDocsCatalogResources,
  resetDocsCatalogCache,
} from "../../../../src/services/docs-catalog/index.js";

describe("Documentation Catalog Resources", () => {
  beforeEach(() => {
    resetDocsCatalogCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads catalog metadata and services from disk", async () => {
    const catalog = await loadDocsCatalog();
    expect(catalog.metadata).toBeDefined();
    expect(catalog.services.length).toBeGreaterThan(0);
    const hasLogging = catalog.services.some((service) => service.id === "logging");
    expect(hasLogging).toBe(true);
  });

  it("finds services by ID or product name", async () => {
    const byId = await findDocsCatalogService("error-reporting");
    expect(byId?.productName).toBe("Error Reporting");

    const byName = await findDocsCatalogService("Cloud Monitoring");
    expect(byName?.id).toBe("monitoring");
  });

  it("registers catalog resources that return structured responses", async () => {
    const mockServer = createMockMcpServer();

    registerDocsCatalogResources(mockServer as any);

    expect(mockServer.resource).toHaveBeenCalledWith(
      "gcp-docs-catalog",
      "docs://google-cloud/catalog",
      expect.any(Function),
    );

    const catalogCall = mockServer.resource.mock.calls.find(
      (call) => call[0] === "gcp-docs-catalog",
    );
    expect(catalogCall).toBeDefined();

    const catalogHandler = catalogCall?.[2];
    const catalogResponse = await catalogHandler?.(
      new URL("docs://google-cloud/catalog"),
    );
    expect(catalogResponse?.contents?.[0]?.text).toContain(
      "Google Cloud Documentation Catalog",
    );

    const serviceCall = mockServer.resource.mock.calls.find(
      (call) => call[0] === "gcp-docs-service",
    );
    expect(serviceCall).toBeDefined();
    const serviceHandler = serviceCall?.[2];
    const serviceResponse = await serviceHandler?.(
      new URL("docs://google-cloud/logging"),
      { serviceId: "logging" },
    );

    expect(serviceResponse?.contents?.[0]?.text).toContain("Google Cloud Docs");
    expect(serviceResponse?.contents?.[0]?.text).toContain("logging");
  });
});
