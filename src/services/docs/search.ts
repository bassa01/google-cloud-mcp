import { GcpMcpError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_PROXY_ENDPOINT = (
  process.env.GOOGLE_CLOUD_DOCS_PROXY?.trim() || "https://r.jina.ai"
).replace(/\/+$/, "");
const DEFAULT_LANGUAGE = (process.env.GOOGLE_CLOUD_DOCS_LANGUAGE || "en").trim();
const SEARCH_BASE_URL = "https://cloud.google.com/s/results";
const DEFAULT_TIMEOUT_MS = normalizeNumber(
  process.env.GOOGLE_CLOUD_DOCS_TIMEOUT_MS,
  12000,
);
const DEFAULT_MAX_CANDIDATES = normalizeNumber(
  process.env.GOOGLE_CLOUD_DOCS_MAX_FETCH,
  30,
);

const LINK_PATTERN = /\[(.+?)\]\((https?:\/\/[\w\-./?=&#%:+]+)\)/i;
const TOTAL_RESULTS_PATTERN = /About ([\d,]+) results/i;
const CLEAN_MARKDOWN_PATTERN = /[*_`]/g;
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

const ALLOWED_HOSTS = new Set([
  "cloud.google.com",
  "docs.cloud.google.com",
  "console.cloud.google.com",
  "developers.google.com",
  "firebase.google.com",
  "support.google.com",
  "cloudskillsboost.google",
]);

const STRIP_QUERY_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "hl"]);

export interface DocsSearchOptions {
  query: string;
  maxResults: number;
  language?: string;
}

export interface ParsedDocResult {
  title: string;
  url: string;
  snippet?: string;
  sourceRank: number;
}

export interface RankedDocResult extends ParsedDocResult {
  score: number;
  rank: number;
  scoreBreakdown: {
    title: number;
    snippet: number;
    url: number;
    positionBoost: number;
  };
}

export interface DocsSearchExecutionResult {
  results: RankedDocResult[];
  approxTotalResults?: number;
  fetchedResults: number;
  searchUrl: string;
  proxiedUrl: string;
  language: string;
}

export interface ParseResult {
  results: ParsedDocResult[];
  approxTotalResults?: number;
}

interface ActiveCandidate {
  title: string;
  url: string;
  snippet: string[];
  key: string;
  sourceRank: number;
}

export async function searchGoogleCloudDocs({
  query,
  maxResults,
  language,
}: DocsSearchOptions): Promise<DocsSearchExecutionResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new GcpMcpError("Search query cannot be empty.", "DOCS_QUERY_EMPTY", 400);
  }

  const resolvedLanguage = language?.trim() || DEFAULT_LANGUAGE;
  const pageUrl = new URL(SEARCH_BASE_URL);
  pageUrl.searchParams.set("q", trimmedQuery);
  if (resolvedLanguage) {
    pageUrl.searchParams.set("hl", resolvedLanguage);
  }

  const proxiedUrl = `${DEFAULT_PROXY_ENDPOINT}/${pageUrl.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let responseText: string;
  try {
    const response = await fetch(proxiedUrl, {
      headers: {
        Accept: "text/plain, text/markdown, */*",
        "User-Agent": "google-cloud-mcp-docs-search/0.1",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GcpMcpError(
        `Docs search returned HTTP ${response.status}`,
        "DOCS_SEARCH_HTTP_ERROR",
        response.status,
      );
    }

    responseText = await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GcpMcpError(
        "Call to Google Cloud docs search timed out.",
        "DOCS_SEARCH_TIMEOUT",
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!responseText || !responseText.trim()) {
    throw new GcpMcpError(
      "Received an empty response from the docs search proxy.",
      "DOCS_SEARCH_EMPTY",
      502,
    );
  }

  const parseCap = Math.max(maxResults * 3, DEFAULT_MAX_CANDIDATES);
  const { results: parsedResults, approxTotalResults } = parseDocsSearchPage(responseText, {
    maxCandidates: parseCap,
  });

  if (!parsedResults.length) {
    return {
      results: [],
      approxTotalResults,
      fetchedResults: 0,
      searchUrl: pageUrl.toString(),
      proxiedUrl,
      language: resolvedLanguage,
    };
  }

  const ranked = rankDocsResults(trimmedQuery, parsedResults);
  return {
    results: ranked.slice(0, maxResults),
    approxTotalResults,
    fetchedResults: parsedResults.length,
    searchUrl: pageUrl.toString(),
    proxiedUrl,
    language: resolvedLanguage,
  };
}

export function parseDocsSearchPage(
  content: string,
  options?: { maxCandidates?: number },
): ParseResult {
  const lines = content.split(/\r?\n/);
  const approxTotal = extractApproxTotal(lines);
  const maxCandidates = Math.max(1, options?.maxCandidates || DEFAULT_MAX_CANDIDATES);
  const results: ParsedDocResult[] = [];
  const seen = new Set<string>();
  let active: ActiveCandidate | undefined;
  let ordinal = 0;

  const finalizeActive = (): void => {
    if (!active) {
      return;
    }
    const snippet = normalizeWhitespace(active.snippet.join(" "));
    results.push({
      title: active.title,
      url: active.url,
      snippet: snippet || undefined,
      sourceRank: active.sourceRank,
    });
    active = undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      finalizeActive();
      if (results.length >= maxCandidates) {
        break;
      }
      continue;
    }

    const match = LINK_PATTERN.exec(line);
    if (match) {
      const [, rawTitle, rawUrl] = match;
      const normalizedUrl = sanitizeUrl(rawUrl);
      if (!normalizedUrl || !isAllowedHost(normalizedUrl)) {
        continue;
      }

      const key = buildResultKey(normalizedUrl);
      if (active && key === active.key) {
        // Duplicate link for the same result (common in rendered pages).
        continue;
      }

      if (seen.has(key)) {
        continue;
      }

      finalizeActive();
      ordinal += 1;
      const cleanedTitle = normalizeMarkdownText(rawTitle);
      active = {
        title: cleanedTitle,
        url: normalizedUrl,
        snippet: [],
        key,
        sourceRank: ordinal,
      };
      seen.add(key);
      if (results.length >= maxCandidates) {
        break;
      }
      continue;
    }

    if (!active) {
      continue;
    }

    if (isMetadataLine(line)) {
      continue;
    }

    active.snippet.push(normalizeMarkdownText(line));
  }

  finalizeActive();
  return { results, approxTotalResults: approxTotal };
}

export function rankDocsResults(
  query: string,
  candidates: ParsedDocResult[],
): RankedDocResult[] {
  if (!candidates.length) {
    return [];
  }

  const normalizedQuery = normalizeForScoring(query);
  const queryTokens = tokenizeText(normalizedQuery);

  const scored = candidates.map((candidate) => {
    const normalizedTitle = normalizeForScoring(candidate.title);
    const normalizedSnippet = normalizeForScoring(candidate.snippet || "");
    const normalizedUrl = normalizeForScoring(candidate.url);

    const titleScore = computeOverlapScore(
      queryTokens,
      tokenizeText(normalizedTitle),
      normalizedQuery,
      normalizedTitle,
    );
    const snippetScore = computeOverlapScore(
      queryTokens,
      tokenizeText(normalizedSnippet),
      normalizedQuery,
      normalizedSnippet,
    );
    const urlScore = computeOverlapScore(
      queryTokens,
      tokenizeText(normalizedUrl),
      normalizedQuery,
      normalizedUrl,
    );

    const positionBoost = 1 - (candidate.sourceRank - 1) / Math.max(candidates.length, 1);
    const score =
      titleScore * 0.55 + snippetScore * 0.25 + urlScore * 0.1 + positionBoost * 0.1;

    return {
      ...candidate,
      score: Number(score.toFixed(4)),
      scoreBreakdown: {
        title: Number(titleScore.toFixed(4)),
        snippet: Number(snippetScore.toFixed(4)),
        url: Number(urlScore.toFixed(4)),
        positionBoost: Number(positionBoost.toFixed(4)),
      },
    };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.sourceRank - b.sourceRank)
    .map((result, index) => ({
      ...result,
      rank: index + 1,
    }));
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

function normalizeForScoring(value: string): string {
  return normalizeWhitespace(value.replace(CLEAN_MARKDOWN_PATTERN, ""));
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

function normalizeMarkdownText(value: string): string {
  if (!value) {
    return "";
  }

  let normalized = value.replace(/\*\*/g, "").replace(/__+/g, "");
  normalized = normalized.replace(/\[(.+?)\]\((.+?)\)/g, "$1");
  normalized = decodeEntities(normalized);
  return normalizeWhitespace(normalized);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&[a-z#0-9]+;/gi, (entity) => {
    const normalized = entity.toLowerCase();
    return ENTITY_MAP[normalized] || entity;
  });
}

function sanitizeUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    const params = new URLSearchParams();
    for (const [key, val] of url.searchParams.entries()) {
      if (!STRIP_QUERY_PARAMS.has(key.toLowerCase())) {
        params.append(key, val);
      }
    }
    url.search = params.toString() ? `?${params.toString()}` : "";

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch (error) {
    logger.warn(`Skipping invalid docs URL: ${rawUrl}`);
    return undefined;
  }
}

function isAllowedHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

function buildResultKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function isMetadataLine(line: string): boolean {
  const plain = normalizeMarkdownText(line);
  if (!plain) {
    return true;
  }

  if (/^[\w.-]+\.google\.[a-z.]+$/i.test(plain)) {
    return true;
  }

  if (/^https?:\/\//i.test(plain)) {
    return true;
  }

  if (plain.includes("›")) {
    return true;
  }

  return false;
}

function extractApproxTotal(lines: string[]): number | undefined {
  for (const line of lines) {
    const match = TOTAL_RESULTS_PATTERN.exec(line);
    if (match) {
      return Number.parseInt(match[1].replace(/,/g, ""), 10);
    }
  }
  return undefined;
}

function normalizeNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
