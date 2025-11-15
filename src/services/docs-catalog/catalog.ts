/**
 * Loader utilities for the Google Cloud documentation catalog.
 */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GcpMcpError } from "../../utils/error.js";
import {
  DocsCatalogSearchResult,
  DocsCatalogService,
  GoogleCloudDocsCatalog,
} from "./types.js";

const catalogFilePath = fileURLToPath(
  new URL("../../../docs/catalog/google-cloud-docs.json", import.meta.url),
);

interface CatalogCache {
  data: GoogleCloudDocsCatalog;
  mtimeMs: number;
}

let cachedCatalog: CatalogCache | undefined;

const normalizeId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Clear the cached catalog. Primarily used by tests.
 */
export function resetDocsCatalogCache(): void {
  cachedCatalog = undefined;
}

/**
 * Load the Google Cloud documentation catalog from disk (with memoisation).
 */
export async function loadDocsCatalog(): Promise<GoogleCloudDocsCatalog> {
  try {
    const fileStats = await stat(catalogFilePath);

    if (cachedCatalog && cachedCatalog.mtimeMs === fileStats.mtimeMs) {
      return cachedCatalog.data;
    }

    const raw = await readFile(catalogFilePath, "utf-8");
    const parsed = JSON.parse(raw) as GoogleCloudDocsCatalog;
    cachedCatalog = { data: parsed, mtimeMs: fileStats.mtimeMs };
    return parsed;
  } catch (error) {
    throw new GcpMcpError(
      `Unable to load Google Cloud documentation catalog from ${path.relative(process.cwd(), catalogFilePath)}: ${error instanceof Error ? error.message : String(error)}`,
      "DOCS_CATALOG_UNAVAILABLE",
      500,
    );
  }
}

/**
 * Find a catalog service entry by ID or product name.
 */
export async function findDocsCatalogService(
  serviceId: string,
): Promise<DocsCatalogService | undefined> {
  const normalizedId = normalizeId(serviceId);
  if (!normalizedId) {
    return undefined;
  }

  const catalog = await loadDocsCatalog();
  return catalog.services.find((service) => {
    const serviceIds = [
      service.id,
      service.productName,
      service.productCategory ?? "",
    ];
    return serviceIds.some(
      (candidate) => normalizeId(candidate) === normalizedId,
    );
  });
}

export { catalogFilePath as GOOGLE_CLOUD_DOCS_CATALOG_PATH };

/**
 * Search the documentation catalog for documents that match the query.
 */
export async function searchDocsCatalog(
  query: string,
  limit: number = 5,
): Promise<DocsCatalogSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const tokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const catalog = await loadDocsCatalog();
  const results: DocsCatalogSearchResult[] = [];

  for (const service of catalog.services) {
    for (const document of service.documents) {
      const score = scoreDocument(document, service, tokens);
      if (score > 0) {
        results.push({
          serviceId: service.id,
          serviceName: service.productName,
          serviceCategory: service.productCategory,
          document,
          score,
        });
      }
    }
  }

  if (results.length === 0) {
    return [];
  }

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.document.title.localeCompare(b.document.title);
  });

  return results.slice(0, limit);
}

function scoreDocument(
  document: DocsCatalogService["documents"][number],
  service: DocsCatalogService,
  tokens: string[],
): number {
  if (tokens.length === 0) {
    return 0;
  }

  const title = document.title.toLowerCase();
  const description = (document.description || "").toLowerCase();
  const category = (document.category || "").toLowerCase();
  const docType = document.docType.toLowerCase();
  const topics = (document.topics || []).join(" ").toLowerCase();
  const serviceName = service.productName.toLowerCase();
  const serviceId = service.id.toLowerCase();

  let score = 0;

  for (const token of tokens) {
    if (!token.length) {
      continue;
    }

    if (title === token) {
      score += 8;
    } else if (title.includes(token)) {
      score += 5;
    }

    if (description.includes(token)) {
      score += 2;
    }

    if (category.includes(token) || docType.includes(token)) {
      score += 1;
    }

    if (topics.includes(token)) {
      score += 3;
    }

    if (serviceName.includes(token) || serviceId.includes(token)) {
      score += 1;
    }
  }

  return score;
}
