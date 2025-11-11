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

const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;

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
  language: z
    .string()
    .regex(
      LANGUAGE_PATTERN,
      "Use a BCP-47 language tag like en, ja, or pt-BR.",
    )
    .optional(),
});

export function registerDocsTools(server: McpServer): void {
  server.tool(
    "google-cloud-docs-search",
    docsSearchSchema,
    async ({ query, maxResults, language }) => {
      const resolvedLimit = maxResults ?? DOCS_TOOL_DEFAULT_LIMIT;

      try {
        const searchResult = await searchGoogleCloudDocs({
          query,
          maxResults: resolvedLimit,
          language,
        });

        const summary = buildStructuredResponse({
          title: "Google Cloud Docs Search",
          metadata: {
            query,
            language: searchResult.language,
            requested: resolvedLimit,
            returned: searchResult.results.length,
            parsed: searchResult.fetchedResults,
            approxMatches: searchResult.approxTotalResults,
          },
          preview: {
            total: searchResult.approxTotalResults ?? searchResult.results.length,
            displayed: searchResult.results.length,
            label: "results",
            limit: resolvedLimit,
            omitted: Math.max(
              (searchResult.approxTotalResults || searchResult.fetchedResults) - searchResult.results.length,
              0,
            ),
          },
          dataLabel: "results",
          data: searchResult.results,
          additionalNotes: [
            searchResult.approxTotalResults
              ? `Google Cloud's site search reported approximately ${searchResult.approxTotalResults.toLocaleString()} matches.`
              : undefined,
            "Ranking blends Google Cloud relevance with local lexical matching to reduce false positives.",
            `Source URL: ${searchResult.searchUrl}`,
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
        return buildDocsErrorResponse(error, query, language);
      }
    },
  );
}

function buildDocsErrorResponse(
  error: unknown,
  query: string,
  language?: string,
): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const details = formatError(error);
  const text = buildStructuredTextBlock({
    title: "Google Cloud Docs Search Error",
    metadata: {
      query,
      language,
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
