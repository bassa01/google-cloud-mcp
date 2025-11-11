import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GcpMcpError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_CATALOG_PATH = path.resolve(
  PROJECT_ROOT,
  "docs/catalog/google-cloud-docs.json",
);

const ALLOWED_HOST_SUFFIXES = [
  "cloud.google.com",
  "docs.cloud.google.com",
  "console.cloud.google.com",
  "developers.google.com",
  "firebase.google.com",
  "support.google.com",
  "cloudskillsboost.google",
];

interface RawCatalogEntry {
  title: string;
  url: string;
  summary?: string;
  tags?: string[];
  product?: string;
  lastReviewed?: string;
}

interface CatalogEntry extends RawCatalogEntry {
  tags: string[];
  normalized: {
    title: string;
    summary: string;
    tags: string;
    product: string;
  };
  tokens: {
    title: string[];
    summary: string[];
    tags: string[];
    product: string[];
    combined: string[];
  };
  vector: {
    weights: Map<string, number>;
    norm: number;
  };
}

interface CatalogCache {
  path: string;
  entries: CatalogEntry[];
  lastModified?: Date;
  idf: Map<string, number>;
}

let catalogCache: CatalogCache | undefined;

export interface DocsSearchOptions {
  query: string;
  maxResults: number;
}

export interface RankedDocResult {
  title: string;
  url: string;
  summary?: string;
  tags: string[];
  product?: string;
  lastReviewed?: string;
  score: number;
  rank: number;
}

export interface DocsSearchExecutionResult {
  results: RankedDocResult[];
  approxTotalResults: number;
  fetchedResults: number;
  catalogPath: string;
  catalogUpdated?: string;
}

export async function searchGoogleCloudDocs({
  query,
  maxResults,
}: DocsSearchOptions): Promise<DocsSearchExecutionResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new GcpMcpError("Search query cannot be empty.", "DOCS_QUERY_EMPTY", 400);
  }

  const catalog = await loadCatalog();
  if (catalog.entries.length === 0) {
    throw new GcpMcpError(
      "The docs catalog is empty. Add entries to docs/catalog/google-cloud-docs.json.",
      "DOCS_CATALOG_EMPTY",
      500,
    );
  }

  const ranked = rankDocsResults(trimmedQuery, catalog.entries, catalog.idf);
  const limited = ranked.slice(0, maxResults);

  return {
    results: limited,
    approxTotalResults: ranked.length,
    fetchedResults: catalog.entries.length,
    catalogPath: catalog.path,
    catalogUpdated: catalog.lastModified?.toISOString(),
  };
}

async function loadCatalog(): Promise<CatalogCache> {
  const resolvedPath = resolveCatalogPath();
  if (catalogCache && catalogCache.path === resolvedPath) {
    return catalogCache;
  }

  let fileData: string;
  try {
    fileData = await readFile(resolvedPath, "utf-8");
  } catch (error) {
    throw new GcpMcpError(
      `Unable to read docs catalog at ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`,
      "DOCS_CATALOG_MISSING",
      500,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileData);
  } catch (error) {
    throw new GcpMcpError(
      `Docs catalog JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      "DOCS_CATALOG_INVALID",
      500,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new GcpMcpError(
      "Docs catalog must be a JSON array of entries.",
      "DOCS_CATALOG_INVALID",
      500,
    );
  }

  const entries = parsed
    .map((raw, index) => normalizeCatalogEntry(raw as RawCatalogEntry, index))
    .filter((entry): entry is CatalogEntry => Boolean(entry));

  const idf = buildIdf(entries);
  entries.forEach((entry) => {
    entry.vector = buildEntryVector(entry, idf);
  });

  const fileStats = await stat(resolvedPath).catch(() => undefined);

  catalogCache = {
    path: resolvedPath,
    entries,
    lastModified: fileStats?.mtime,
    idf,
  };

  logger.debug(
    `Loaded ${entries.length} Google Cloud docs catalog entries from ${resolvedPath}`,
  );

  return catalogCache;
}

function resolveCatalogPath(): string {
  const override = process.env.GOOGLE_CLOUD_DOCS_CATALOG?.trim();
  if (!override) {
    return DEFAULT_CATALOG_PATH;
  }

  return path.isAbsolute(override)
    ? override
    : path.resolve(PROJECT_ROOT, override);
}

function normalizeCatalogEntry(
  raw: RawCatalogEntry,
  index: number,
): CatalogEntry | undefined {
  if (!raw || typeof raw !== "object") {
    logger.warn(`Skipping catalog entry at index ${index}: not an object`);
    return undefined;
  }

  if (!raw.title || !raw.url) {
    logger.warn(`Skipping catalog entry at index ${index}: missing title or url`);
    return undefined;
  }

  if (!isAllowedGoogleHost(raw.url)) {
    logger.warn(`Skipping catalog entry (${raw.title}) with non-Google domain: ${raw.url}`);
    return undefined;
  }

  const normalizedTitle = normalizeForScoring(raw.title);
  const normalizedSummary = normalizeForScoring(raw.summary || "");
  const normalizedTags = normalizeForScoring((raw.tags || []).join(" "));
  const normalizedProduct = normalizeForScoring(raw.product || "");

  const tagsArray = Array.isArray(raw.tags)
    ? raw.tags.filter((tag) => Boolean(tag && tag.trim())).map((tag) => tag.trim())
    : [];

  const entry: CatalogEntry = {
    title: raw.title.trim(),
    url: raw.url.trim(),
    summary: raw.summary?.trim(),
    tags: tagsArray,
    product: raw.product?.trim(),
    lastReviewed: raw.lastReviewed,
    normalized: {
      title: normalizedTitle,
      summary: normalizedSummary,
      tags: normalizedTags,
      product: normalizedProduct,
    },
    tokens: {
      title: tokenizeText(normalizedTitle),
      summary: tokenizeText(normalizedSummary),
      tags: tokenizeText(normalizedTags),
      product: tokenizeText(normalizedProduct),
      combined: tokenizeText(
        [normalizedTitle, normalizedSummary, normalizedTags, normalizedProduct]
          .filter(Boolean)
          .join(" "),
      ),
    },
    vector: {
      weights: new Map(),
      norm: 1,
    },
  };

  return entry;
}

function isAllowedGoogleHost(candidateUrl: string): boolean {
  try {
    const { hostname } = new URL(candidateUrl);
    return ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

export function rankDocsResults(
  query: string,
  entries: CatalogEntry[],
  idf: Map<string, number>,
): RankedDocResult[] {
  const normalizedQuery = normalizeForScoring(query);
  const queryTokens = tokenizeText(normalizedQuery);
  const queryVector = buildQueryVector(queryTokens, idf);

  const scored = entries.map((entry) => {
    const cosineScore = computeCosineSimilarity(queryVector, entry.vector);
    const lexicalScore = cosineScore > 0 ? cosineScore : computeOverlapScore(
      queryTokens,
      entry.tokens.combined,
      normalizedQuery,
      entry.tokens.combined.join(" "),
    );
    const recencyScore = computeRecencyBoost(entry.lastReviewed) * 0.06;
    const tagHint = entry.tags.some((tag) => normalizedQuery.includes(tag.toLowerCase()))
      ? 0.02
      : 0;

    const finalScore = Number((lexicalScore * 0.92 + recencyScore + tagHint).toFixed(4));

    return {
      entry,
      score: finalScore,
    };
  });

  const filtered = scored.filter(({ score }) => score > 0);

  if (filtered.length === 0) {
    return [];
  }

  return filtered
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .map((item, index) => ({
      title: item.entry.title,
      url: item.entry.url,
      summary: item.entry.summary,
      tags: item.entry.tags,
      product: item.entry.product,
      lastReviewed: item.entry.lastReviewed,
      score: item.score,
      rank: index + 1,
    }));
}

function computeRecencyBoost(lastReviewed?: string): number {
  if (!lastReviewed) {
    return 0;
  }

  const reviewedTime = Date.parse(lastReviewed);
  if (Number.isNaN(reviewedTime)) {
    return 0;
  }

  const daysSince = (Date.now() - reviewedTime) / (1000 * 60 * 60 * 24);
  const boost = Math.max(0, 1 - daysSince / 730);
  return Number(Math.min(boost, 1).toFixed(4));
}

function computeOverlapScore(
  queryTokens: string[],
  targetTokens: string[],
  queryText: string,
  targetText: string,
): number {
  if (!queryTokens.length || !targetTokens.length) {
    return fallbackTextSimilarity(queryText, targetText);
  }

  const querySet = new Set(queryTokens);
  let overlap = 0;
  for (const token of targetTokens) {
    if (querySet.has(token)) {
      overlap += 1;
    }
  }

  if (overlap === 0) {
    return fallbackTextSimilarity(queryText, targetText);
  }

  const recall = overlap / queryTokens.length;
  const precision = overlap / targetTokens.length;
  return recall * 0.7 + precision * 0.3;
}

function fallbackTextSimilarity(queryText: string, targetText: string): number {
  if (!queryText || !targetText) {
    return 0;
  }

  if (targetText.includes(queryText)) {
    return Math.min(queryText.length / targetText.length, 1);
  }

  if (queryText.includes(targetText)) {
    return Math.min(targetText.length / queryText.length, 1);
  }

  return 0;
}

function normalizeForScoring(value: string): string {
  return value.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function tokenizeText(value: string): string[] {
  const trimmed = value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) {
    return [];
  }

  const tokens = trimmed.split(/[\p{Z}\p{P}\p{S}]+/u).filter(Boolean);
  if (tokens.length > 0) {
    return Array.from(new Set(tokens));
  }

  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) {
    return [];
  }

  const bigrams = new Set<string>();
  for (let i = 0; i < compact.length - 1 && bigrams.size < 24; i += 1) {
    const pair = compact.slice(i, i + 2);
    bigrams.add(pair);
  }

  return bigrams.size ? Array.from(bigrams) : [compact];
}

export function __clearDocsCatalogCacheForTests(): void {
  catalogCache = undefined;
}

function buildIdf(entries: CatalogEntry[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const entry of entries) {
    const uniqueTokens = new Set(entry.tokens.combined);
    for (const token of uniqueTokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const totalDocs = Math.max(entries.length, 1);
  const idf = new Map<string, number>();
  for (const [token, df] of docFreq.entries()) {
    const weight = Math.log((totalDocs + 1) / (df + 1)) + 1;
    idf.set(token, Number(weight.toFixed(6)));
  }
  return idf;
}

function buildEntryVector(
  entry: CatalogEntry,
  idf: Map<string, number>,
): { weights: Map<string, number>; norm: number } {
  const counts = new Map<string, number>();
  for (const token of entry.tokens.combined) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const weights = new Map<string, number>();
  let sumSquares = 0;
  const tokenCount = entry.tokens.combined.length || 1;

  for (const [token, count] of counts.entries()) {
    const idfWeight = idf.get(token);
    if (!idfWeight) {
      continue;
    }
    const tf = count / tokenCount;
    const weight = tf * idfWeight;
    weights.set(token, weight);
    sumSquares += weight * weight;
  }

  const norm = sumSquares > 0 ? Math.sqrt(sumSquares) : 1;
  return { weights, norm };
}

function buildQueryVector(
  tokens: string[],
  idf: Map<string, number>,
): { weights: Map<string, number>; norm: number } {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const weights = new Map<string, number>();
  let sumSquares = 0;
  const tokenCount = tokens.length || 1;

  for (const [token, count] of counts.entries()) {
    const idfWeight = idf.get(token);
    if (!idfWeight) {
      continue;
    }
    const tf = count / tokenCount;
    const weight = tf * idfWeight;
    weights.set(token, weight);
    sumSquares += weight * weight;
  }

  const norm = sumSquares > 0 ? Math.sqrt(sumSquares) : 0;
  return { weights, norm };
}

function computeCosineSimilarity(
  queryVector: { weights: Map<string, number>; norm: number },
  entryVector: { weights: Map<string, number>; norm: number },
): number {
  if (queryVector.norm === 0 || entryVector.norm === 0) {
    return 0;
  }

  let dot = 0;
  for (const [token, weight] of queryVector.weights.entries()) {
    const entryWeight = entryVector.weights.get(token);
    if (entryWeight) {
      dot += weight * entryWeight;
    }
  }

  if (dot === 0) {
    return 0;
  }

  const cosine = dot / (queryVector.norm * entryVector.norm);
  return Number(Math.min(Math.max(cosine, 0), 1).toFixed(4));
}
