/**
 * Documentation catalog service entry point.
 */
export { registerDocsCatalogResources } from "./resources.js";
export {
  loadDocsCatalog,
  findDocsCatalogService,
  resetDocsCatalogCache,
} from "./catalog.js";
export type {
  DocsCatalogDocument,
  DocsCatalogMetadata,
  DocsCatalogService,
  GoogleCloudDocsCatalog,
} from "./types.js";
