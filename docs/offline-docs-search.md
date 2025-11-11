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

## Scoring Algorithm (TF‑IDF + Cosine)

1. **Vectorization**
   - During catalog load we build a vocabulary over each entry's combined tokens (title + summary + tags + product).
   - Document frequency (`df`) counts the number of entries containing each token.
   - We compute smoothed inverse document frequency: `idf = ln((N + 1) / (df + 1)) + 1`.
   - Each entry stores TF‑IDF weights per token (`tf = count / totalTokens`, `weight = tf * idf`) plus the vector norm for cosine similarity.

2. **Query processing**
   - The query is normalized/tokenized the same way as catalog text.
   - Tokens are turned into a TF‑IDF vector using the catalog's `idf` table.

3. **Similarity**
   - Primary score = cosine similarity between the query vector and each entry vector (clamped to 0‑1). If the query vector has no overlap with the catalog vocabulary, we fall back to the historical lexical-overlap score (precision/recall blend) so typo-heavy queries still get a signal.

4. **Light boosts**
   - Recency: up to +0.06 if `lastReviewed` is within ~2 years.
   - Tag hint: +0.02 if any tag literal already appears in the normalized query string.

5. **Final score**
   - `score = cosineOrLexical * 0.92 + recencyBoost + tagHint`, rounded to 4 decimals. Ties break lexicographically by title for deterministic output.

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
