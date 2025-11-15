/**
 * Type definitions for Google Cloud documentation catalog entries.
 */

export interface DocsCatalogMetadata {
  generatedAt: string;
  description?: string;
  servicesCovered?: string[];
  docTypes?: Record<string, string>;
}

export interface DocsCatalogDocument {
  title: string;
  docType: string;
  category?: string;
  url: string;
  description?: string;
  topics?: string[];
}

export interface DocsCatalogService {
  id: string;
  productName: string;
  productCategory?: string;
  officialDocsRoot: string;
  summary?: string;
  lastValidated?: string;
  documents: DocsCatalogDocument[];
}

export interface GoogleCloudDocsCatalog {
  metadata: DocsCatalogMetadata;
  services: DocsCatalogService[];
}

export interface DocsCatalogSearchResult {
  serviceId: string;
  serviceName: string;
  serviceCategory?: string;
  document: DocsCatalogDocument;
  score: number;
}
