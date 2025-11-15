/**
 * Documentation catalog service entry point.
 */
export { registerDocsCatalogResources } from "./resources.js";
export {
  loadDocsCatalog,
  findDocsCatalogService,
  searchDocsCatalog,
  resetDocsCatalogCache,
} from "./catalog.js";
export type {
  DocsCatalogDocument,
  DocsCatalogMetadata,
  DocsCatalogService,
  GoogleCloudDocsCatalog,
  DocsCatalogSearchResult,
} from "./types.js";
