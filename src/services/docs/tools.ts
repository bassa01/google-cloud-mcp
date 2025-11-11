import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildStructuredResponse, buildStructuredTextBlock, resolveBoundedNumber } from "../../utils/output.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { searchGoogleCloudDocs } from "./search.js";

const DOCS_TOOL_DEFAULT_LIMIT = resolveBoundedNumber(
  process.env.DOCS_SEARCH_PREVIEW_LIMIT,
  5,
  { min: 1, max: 10 },
);

const docsSearchSchema = z.object({
  query: z
    .string()
    .min(2, "Provide at least 2 characters to search Google Cloud docs."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(DOCS_TOOL_DEFAULT_LIMIT),
});

export function registerDocsTools(server: McpServer): void {
  server.tool(
    "google-cloud-docs-search",
    docsSearchSchema,
    async ({ query, maxResults }) => {
      const resolvedLimit = maxResults ?? DOCS_TOOL_DEFAULT_LIMIT;

      try {
        const searchResult = await searchGoogleCloudDocs({
          query,
          maxResults: resolvedLimit,
        });

        const summary = buildStructuredResponse({
          title: "Google Cloud Docs Search",
          metadata: {
            query,
            requested: resolvedLimit,
            returned: searchResult.results.length,
            catalogEntries: searchResult.approxTotalResults,
            catalogPath: searchResult.catalogPath,
            catalogUpdated: searchResult.catalogUpdated,
          },
          preview: {
            total: searchResult.approxTotalResults,
            displayed: searchResult.results.length,
            label: "results",
            limit: resolvedLimit,
            omitted: Math.max(
              searchResult.approxTotalResults - searchResult.results.length,
              0,
            ),
          },
          dataLabel: "results",
          data: searchResult.results,
          additionalNotes: [
            "Matches are computed locally from docs/catalog/google-cloud-docs.json.",
            "Update that catalog file or set GOOGLE_CLOUD_DOCS_CATALOG to point at your own JSON index when new docs launch.",
          ],
        });

        return {
          content: [
            {
              type: "text",
              text: summary,
            },
          ],
        };
      } catch (error) {
        logger.error(
          `google-cloud-docs-search failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return buildDocsErrorResponse(error, query);
      }
    },
  );
}

function buildDocsErrorResponse(
  error: unknown,
  query: string,
): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const details = formatError(error);
  const text = buildStructuredTextBlock({
    title: "Google Cloud Docs Search Error",
    metadata: {
      query,
      code: details.code,
    },
    dataLabel: "error",
    data: details,
  });

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError: true,
  };
}
