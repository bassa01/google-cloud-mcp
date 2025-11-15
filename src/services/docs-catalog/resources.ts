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
import { findDocsCatalogService, loadDocsCatalog } from "./catalog.js";

const DOCS_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.DOCS_CATALOG_PREVIEW_LIMIT,
  25,
  { min: 5, max: 200 },
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
    async (uri, params) => {
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
}
