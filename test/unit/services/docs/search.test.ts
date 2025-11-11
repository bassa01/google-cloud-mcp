import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import {
  __clearDocsCatalogCacheForTests,
  searchGoogleCloudDocs,
  tokenizeText,
} from "../../../../src/services/docs/search.js";

const FIXTURE_CATALOG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../mocks/docs-catalog.sample.json",
);

describe("local docs search", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLOUD_DOCS_CATALOG = FIXTURE_CATALOG;
    __clearDocsCatalogCacheForTests();
  });

  it("returns the best matching entries for a Cloud Run query", async () => {
    const result = await searchGoogleCloudDocs({
      query: "Cloud Run concurrency",
      maxResults: 2,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].url).toContain("concurrency");
    expect(result.catalogPath).toContain("docs-catalog.sample.json");
    expect(result.approxTotalResults).toBe(3);
  });

  it("rejects empty queries", async () => {
    await expect(
      searchGoogleCloudDocs({
        query: " ",
        maxResults: 3,
      }),
    ).rejects.toThrow(/cannot be empty/i);
  });
});

describe("tokenizeText", () => {
  it("handles latin and non-latin strings", () => {
    expect(tokenizeText("Cloud Run"))
      .toContain("cloud");
    const jpTokens = tokenizeText("スパナーで検索");
    expect(jpTokens.length).toBeGreaterThan(0);
  });
});
