# Offline Google Cloud Docs Search

This server ships with a local-only documentation search tool (`google-cloud-docs-search`). This file summarizes how it works so operators can audit the behavior or extend it safely.

## Catalog Source of Truth

- Entries live in `docs/catalog/google-cloud-docs.json` (override via `GOOGLE_CLOUD_DOCS_CATALOG`).
- Each entry is a JSON object:
  ```json
  {
    "title": "Cloud Run resource limits",
    "url": "https://cloud.google.com/run/docs/configuring/memory-limits",
    "summary": "Lists CPU, memory, and request limits for Cloud Run services and jobs.",
    "tags": ["cloud run", "limits", "cpu", "memory"],
    "product": "cloud-run",
    "lastReviewed": "2025-06-30"
  }
  ```
- Only Google-owned domains are accepted. During load we drop any entry whose URL hostname is not one of:
  `cloud.google.com`, `docs.cloud.google.com`, `console.cloud.google.com`, `developers.google.com`, `firebase.google.com`, `support.google.com`, `cloudskillsboost.google` (subdomains included).
- The catalog is read once at server start (or after clearing the cache). A missing or invalid file raises `DOCS_CATALOG_*` errors immediately.

## Normalization Pipeline

When the catalog loads (`src/services/docs/search.ts`):

1. **Trim + lowercase**: title, summary, tags, product strings are normalized by removing markdown markers and collapsing whitespace.
2. **Tokenization**: we split normalized text on Unicode punctuation/separators and deduplicate tokens. If a string contains no ASCII/word boundaries (e.g., Japanese), we fall back to bigrams so overlap scoring still works.
3. **Caching**: Each entry stores the raw values, normalized strings, and token arrays (`title`, `summary`, `tags`, `product`, plus a combined vector) for reuse across queries.

## Scoring Algorithm

For each query:

1. The query string is normalized exactly like catalog text (lowercase, whitespace collapse, punctuation stripping) and tokenized.
2. Every catalog entry receives individual similarity scores:
   - `titleScore`: overlap between query tokens and title tokens (weight 0.50).
   - `summaryScore`: overlap vs. summary tokens (weight 0.25).
   - `tagsScore`: overlap vs. tag tokens (weight 0.15).
   - `productScore`: overlap vs. product tokens (weight 0.05).
3. **Overlap metric** uses a simple recall/precision blend: `0.7 * recall + 0.3 * precision`. If the overlap is zero, we fall back to substring similarity (exact containment yields a ratio between 0 and 1).
4. **Recency boost**: if `lastReviewed` is provided, entries newer than ~2 years get up to +0.04 in score, decaying linearly toward zero after ~730 days.
5. **Tag hint**: if any tag literal already appears in the normalized query string, we add +0.05.
6. Final score = weighted sum above (clamped via `Number.toFixed(4)` for readability). Results are sorted by score desc, then title lexicographically for stability, and ranked (1-indexed).

## Result Metadata

Every tool response includes:

- `catalogEntries`: total number of entries loaded.
- `catalogPath`: absolute path to the JSON.
- `catalogUpdated`: file mtime if available (ISO string).
- `results`: array of `{ title, url, summary, tags, product, lastReviewed, score, rank }`.

## Updating the Catalog

1. Edit `docs/catalog/google-cloud-docs.json` (or your override file) and append new entries following the schema above.
2. Optionally maintain multiple catalogs (e.g., `docs/catalog/cloud-run.json`) and point `GOOGLE_CLOUD_DOCS_CATALOG` at whichever one you want for a given deployment.
3. Restart the MCP server (or call `__clearDocsCatalogCacheForTests()` inside tests) so the catalog reloads.

## Testing Helpers

Unit tests (`test/unit/services/docs/search.test.ts`) use `test/mocks/docs-catalog.sample.json` plus `__clearDocsCatalogCacheForTests()` to exercise the search logic without touching the real catalog.

