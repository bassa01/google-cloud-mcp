import { Storage } from "@google-cloud/storage";

let storageClient: Storage | null = null;

export function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
    });
  }

  return storageClient;
}

export function resetStorageClient(): void {
  storageClient = null;
}
