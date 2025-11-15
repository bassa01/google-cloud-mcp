/**
 * Loader utilities for the Google Cloud documentation catalog.
 */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GcpMcpError } from "../../utils/error.js";
import {
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
