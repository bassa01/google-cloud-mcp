import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStorageClient } from "../client.js";
import {
  OBJECT_CONTENT_PREVIEW_BYTES,
  OBJECT_PREVIEW_LIMIT,
  buildObjectContentPreview,
  formatObjectContentResponse,
  formatObjectListResponse,
  formatObjectMetadataResponse,
} from "../output.js";
import {
  optionalProjectId,
  storageErrorResult,
} from "../helpers.js";

const bucketNameSchema = z
  .string()
  .min(3)
  .describe("Name of the Cloud Storage bucket (without gs:// prefix)");

const objectNameSchema = z
  .string()
  .min(1)
  .describe("Name of the Cloud Storage object (path inside the bucket)");

const projectIdSchema = z
  .string()
  .min(4)
  .optional()
  .describe("Optional Google Cloud project ID override for billing.");

const generationSchema = z
  .union([z.string(), z.number()])
  .optional()
  .describe("Optional object generation to target a specific version.");

export function registerObjectTools(server: McpServer): void {
  const listObjectsSchema = z.object({
    bucket: bucketNameSchema,
    projectId: projectIdSchema,
    prefix: z
      .string()
      .optional()
      .describe("Filter objects by prefix (folder-like behavior)."),
    delimiter: z
      .string()
      .optional()
      .describe(
        "Optional delimiter (e.g. '/') to emulate directory boundaries.",
      ),
    versions: z
      .boolean()
      .default(false)
      .describe("Include noncurrent versions (storage.objects.list versions=true)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(OBJECT_PREVIEW_LIMIT)
      .describe("Maximum number of objects to retrieve."),
    pageToken: z
      .string()
      .optional()
      .describe("Page token for continued listing."),
  });

  server.registerTool(
    "gcp-storage-list-objects",
    {
      title: "List objects in a bucket",
      description:
        "Lists objects within a Cloud Storage bucket with optional prefix filtering.",
      inputSchema: listObjectsSchema.shape,
    },
    async ({ bucket, projectId, prefix, delimiter, versions, limit, pageToken }) => {
      try {
        const storage = getStorageClient();
        const userProject = await optionalProjectId(projectId);
        const bucketHandle = storage.bucket(
          bucket,
          userProject ? { userProject } : undefined,
        );
        const [files, nextQuery, apiResponse] = await bucketHandle.getFiles({
          prefix,
          delimiter,
          maxResults: limit,
          pageToken,
          userProject,
          versions,
          autoPaginate: false,
        });

        const nextPageToken =
          (nextQuery as { pageToken?: string } | undefined)?.pageToken ||
          (apiResponse as { nextPageToken?: string } | undefined)?.nextPageToken;

        const text = formatObjectListResponse(files, {
          bucket,
          prefix,
          limit,
          versions,
          nextPageToken,
        });

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error) {
        return storageErrorResult("List Cloud Storage objects", error);
      }
    },
  );

  const objectMetadataSchema = z.object({
    bucket: bucketNameSchema,
    object: objectNameSchema,
    generation: generationSchema,
    projectId: projectIdSchema,
  });

  server.registerTool(
    "gcp-storage-read-object-metadata",
    {
      title: "Read object metadata",
      description:
        "Retrieves metadata for a Cloud Storage object, including size, checksums, custom metadata, and encryption info.",
      inputSchema: objectMetadataSchema.shape,
    },
    async ({ bucket, object, generation, projectId }) => {
      try {
        const storage = getStorageClient();
        const userProject = await optionalProjectId(projectId);
        const bucketHandle = storage.bucket(
          bucket,
          userProject ? { userProject } : undefined,
        );
        const fileHandle = bucketHandle.file(
          object,
          {
            generation: generation as number | string | undefined,
            userProject,
          },
        );
        const [metadata] = await fileHandle.getMetadata(
          userProject ? { userProject } : undefined,
        );

        const text = formatObjectMetadataResponse(metadata, { bucket, object });
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error) {
        return storageErrorResult("Read Cloud Storage object metadata", error);
      }
    },
  );

  const objectContentSchema = z.object({
    bucket: bucketNameSchema,
    object: objectNameSchema,
    generation: generationSchema,
    projectId: projectIdSchema,
    bytes: z
      .number()
      .int()
      .min(128)
      .max(OBJECT_CONTENT_PREVIEW_BYTES)
      .optional()
      .describe(
        "Maximum bytes to preview (defaults to STORAGE_OBJECT_CONTENT_PREVIEW_BYTES).",
      ),
  });

  server.registerTool(
    "gcp-storage-read-object-content",
    {
      title: "Preview object content",
      description:
        "Downloads a limited preview of an object's contents. Large payloads are truncated automatically.",
      inputSchema: objectContentSchema.shape,
    },
    async ({ bucket, object, generation, projectId, bytes }) => {
      try {
        const storage = getStorageClient();
        const userProject = await optionalProjectId(projectId);
        const bucketHandle = storage.bucket(
          bucket,
          userProject ? { userProject } : undefined,
        );
        const fileHandle = bucketHandle.file(
          object,
          {
            generation: generation as number | string | undefined,
            userProject,
          },
        );

        const [metadata] = await fileHandle.getMetadata(
          userProject ? { userProject } : undefined,
        );
        const totalBytes = metadata.size ? Number(metadata.size) : undefined;
        const previewLimit = bytes ?? OBJECT_CONTENT_PREVIEW_BYTES;

        const [buffer] = await fileHandle.download({
          end: previewLimit - 1,
          validation: false,
          userProject,
        });

        const preview = buildObjectContentPreview(buffer, {
          totalBytes,
        });
        const text = formatObjectContentResponse(preview, {
          bucket,
          object,
          generation,
        });

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error) {
        return storageErrorResult("Read Cloud Storage object content", error);
      }
    },
  );
}
