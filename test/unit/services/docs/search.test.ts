import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  afterEach(() => {
    delete process.env.GOOGLE_CLOUD_DOCS_CATALOG;
    __clearDocsCatalogCacheForTests();
    vi.restoreAllMocks();
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

  it("resolves relative catalog overrides and memoizes repeated loads", async () => {
    const originalEntries = [
      {
        title: "Cloud Run concurrency tuning",
        url: "https://cloud.google.com/run/docs/concurrency",
        summary: "How to configure Cloud Run request concurrency.",
        tags: ["cloud run"],
        product: "cloud-run",
        lastReviewed: "2024-01-01T00:00:00.000Z",
      },
      {
        title: "Spanner SQL best practices",
        url: "https://cloud.google.com/spanner/docs/sql-best-practices",
        summary: "Query tuning tips and anti-patterns for Cloud Spanner.",
        tags: ["spanner"],
        product: "cloud-spanner",
        lastReviewed: "2024-01-02T00:00:00.000Z",
      },
    ];
    const catalogPath = await writeTempCatalog(originalEntries);
    const relativeOverride = path.relative(process.cwd(), catalogPath);
    process.env.GOOGLE_CLOUD_DOCS_CATALOG = relativeOverride;
    __clearDocsCatalogCacheForTests();

    const first = await searchGoogleCloudDocs({
      query: "Cloud Run", // triggers initial catalog load
      maxResults: 1,
    });
    expect(path.normalize(first.catalogPath)).toBe(
      path.normalize(catalogPath),
    );

    // Update the on-disk catalog to remove the Spanner entry. Because of caching,
    // the next search should still surface the cached entry.
    await writeFile(
      catalogPath,
      JSON.stringify([
        {
          title: "Cloud Run concurrency tuning",
          url: "https://cloud.google.com/run/docs/concurrency",
          summary: "Updated on-disk payload without Spanner.",
          tags: ["cloud run"],
          product: "cloud-run",
          lastReviewed: "2024-01-03T00:00:00.000Z",
        },
      ]),
      "utf-8",
    );

    const second = await searchGoogleCloudDocs({
      query: "Spanner",
      maxResults: 1,
    });

    expect(second.results[0]?.title).toContain("Spanner SQL best practices");
  });

  it("throws when docs catalog JSON cannot be parsed", async () => {
    const catalogPath = await writeTempCatalogFile("not a json payload");
    process.env.GOOGLE_CLOUD_DOCS_CATALOG = catalogPath;
    __clearDocsCatalogCacheForTests();

    await expect(
      searchGoogleCloudDocs({ query: "anything", maxResults: 1 }),
    ).rejects.toThrow(/invalid/i);
  });

  it("throws when catalog entries are filtered out due to unsupported hosts", async () => {
    const catalogPath = await writeTempCatalog([
      {
        title: "External reference",
        url: "https://example.com/cloud/run",
        summary: "points to a non-google domain",
      },
    ]);
    process.env.GOOGLE_CLOUD_DOCS_CATALOG = catalogPath;
    __clearDocsCatalogCacheForTests();

    await expect(
      searchGoogleCloudDocs({ query: "external reference", maxResults: 1 }),
    ).rejects.toThrow(/catalog is empty/i);
  });

  it("uses recency scoring to boost fresher documents", async () => {
    const catalogPath = await writeTempCatalog([
      {
        title: "Cloud SQL maintenance guide",
        url: "https://cloud.google.com/sql/docs/latest-maint",
        summary: "Detailed Cloud SQL maintenance guidance.",
        tags: ["cloud sql"],
        product: "cloud-sql",
        lastReviewed: new Date().toISOString(),
      },
      {
        title: "Cloud SQL maintenance guide (archived)",
        url: "https://cloud.google.com/sql/docs/archived-maint",
        summary: "Identical content but outdated.",
        tags: ["cloud sql"],
        product: "cloud-sql",
        lastReviewed: "2015-01-01T00:00:00.000Z",
      },
    ]);
    process.env.GOOGLE_CLOUD_DOCS_CATALOG = catalogPath;
    __clearDocsCatalogCacheForTests();

    const result = await searchGoogleCloudDocs({
      query: "Cloud SQL maintenance guide",
      maxResults: 2,
    });

    expect(result.results[0]?.url).toContain("latest-maint");
    expect(result.results[1]?.url).toContain("archived-maint");
  });
});

describe("tokenizeText", () => {
  it("handles latin and non-latin strings", () => {
    expect(tokenizeText("Cloud Run"))
      .toContain("cloud");
    const jpTokens = tokenizeText("スパナーで検索");
    expect(jpTokens.length).toBeGreaterThan(0);
  });

  it("deduplicates tokens and falls back to bigrams", () => {
    expect(tokenizeText("Cloud   Cloud"))
      .toEqual(["cloud"]);

    const compactTokens = tokenizeText("観測");
    expect(compactTokens.length).toBeGreaterThan(0);
  });
});

async function writeTempCatalog(entries: unknown[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "docs-catalog-"));
  const filePath = path.join(dir, "catalog.json");
  await writeFile(filePath, JSON.stringify(entries), "utf-8");
  return filePath;
}

async function writeTempCatalogFile(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "docs-catalog-invalid-"));
  const filePath = path.join(dir, "catalog.json");
  await writeFile(filePath, contents, "utf-8");
  return filePath;
}
