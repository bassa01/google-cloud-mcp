/**
 * MCP resources that expose the Google Cloud documentation catalog.
 */
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { GcpMcpError } from "../../utils/error.js";
import {
  buildStructuredResponse,
  previewList,
  resolveBoundedNumber,
} from "../../utils/output.js";
import {
  findDocsCatalogService,
  loadDocsCatalog,
  searchDocsCatalog,
} from "./catalog.js";

const DOCS_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.DOCS_CATALOG_PREVIEW_LIMIT,
  25,
  { min: 5, max: 200 },
);

const DOCS_SEARCH_RESULTS_LIMIT = resolveBoundedNumber(
  process.env.DOCS_CATALOG_SEARCH_LIMIT,
  8,
  { min: 3, max: 50 },
);

/**
 * Register documentation catalog resources with the MCP server.
 */
export function registerDocsCatalogResources(server: McpServer): void {
  server.resource(
    "gcp-docs-catalog",
    "docs://google-cloud/catalog",
    async (uri) => {
      const catalog = await loadDocsCatalog();
      const summary = catalog.services.map((service) => ({
        id: service.id,
        name: service.productName,
        category: service.productCategory,
        documents: service.documents.length,
        lastValidated: service.lastValidated,
        officialDocsRoot: service.officialDocsRoot,
      }));

      const text = buildStructuredResponse({
        title: "Google Cloud Documentation Catalog",
        metadata: {
          services: catalog.services.length,
          generatedAt: catalog.metadata.generatedAt,
        },
        dataLabel: "services",
        data: summary,
        note: catalog.metadata.description,
      });

      return {
        contents: [{ uri: uri.href, text }],
      };
    },
  );

  server.resource(
    "gcp-docs-service",
    new ResourceTemplate("docs://google-cloud/{serviceId}", { list: undefined }),
    async (uri, params: Record<string, string | string[]> = {}) => {
      const serviceId = Array.isArray(params.serviceId)
        ? params.serviceId[0]
        : params.serviceId;

      if (!serviceId) {
        throw new GcpMcpError(
          "Service ID is required (e.g., docs://google-cloud/logging).",
          "INVALID_ARGUMENT",
          400,
        );
      }

      const service = await findDocsCatalogService(serviceId);
      if (!service) {
        throw new GcpMcpError(
          `Unknown documentation catalog entry: ${serviceId}`,
          "NOT_FOUND",
          404,
        );
      }

      const { displayed, omitted } = previewList(
        service.documents,
        DOCS_PREVIEW_LIMIT,
      );

      const text = buildStructuredResponse({
        title: `Google Cloud Docs · ${service.productName}`,
        metadata: {
          id: service.id,
          category: service.productCategory,
          lastValidated: service.lastValidated,
          officialDocsRoot: service.officialDocsRoot,
        },
        note: service.summary,
        dataLabel: "documents",
        data: displayed,
        preview: {
          total: service.documents.length,
          displayed: displayed.length,
          label: "documents",
          omitted,
          limit: DOCS_PREVIEW_LIMIT,
        },
      });

      return {
        contents: [{ uri: uri.href, text }],
      };
    },
  );

  server.resource(
    "gcp-docs-search",
    new ResourceTemplate("docs://google-cloud/search/{query}", {
      list: undefined,
    }),
    async (uri, params: Record<string, string | string[]> = {}) => {
      const query = Array.isArray(params.query) ? params.query[0] : params.query;
      if (!query || !query.trim()) {
        throw new GcpMcpError(
          "Search query is required (e.g., docs://google-cloud/search/logging).",
          "INVALID_ARGUMENT",
          400,
        );
      }

      const results = await searchDocsCatalog(query, DOCS_SEARCH_RESULTS_LIMIT);
      const data = results.map((result) => ({
        serviceId: result.serviceId,
        serviceName: result.serviceName,
        category: result.serviceCategory,
        score: result.score,
        document: result.document,
      }));

      const text = buildStructuredResponse({
        title: "Google Cloud Docs Search",
        metadata: {
          query,
          matches: results.length,
          limit: DOCS_SEARCH_RESULTS_LIMIT,
        },
        dataLabel: "matches",
        data,
        note:
          results.length === 0
            ? "No documentation entries matched the search terms."
            : undefined,
      });

      return {
        contents: [{ uri: uri.href, text }],
      };
    },
  );
}
