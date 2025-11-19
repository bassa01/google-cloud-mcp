import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStorageClient } from "../client.js";
import {
  BUCKET_PREVIEW_LIMIT,
  formatBucketIamResponse,
  formatBucketListResponse,
  formatBucketMetadataResponse,
  formatPermissionCheckResponse,
} from "../output.js";
import {
  optionalProjectId,
  requireProjectId,
  storageErrorResult,
} from "../helpers.js";

const bucketNameSchema = z
  .string()
  .min(3)
  .describe("Name of the Cloud Storage bucket (without gs:// prefix)");

const projectIdSchema = z
  .string()
  .min(4)
  .optional()
  .describe("Override Google Cloud project ID. Defaults to GOOGLE_CLOUD_PROJECT.");

export function registerBucketTools(server: McpServer): void {
  const listBucketsSchema = z.object({
    projectId: projectIdSchema,
    prefix: z
      .string()
      .optional()
      .describe("Optional name prefix to filter buckets."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(BUCKET_PREVIEW_LIMIT)
      .describe("Maximum number of buckets to retrieve (server caps preview)."),
    pageToken: z
      .string()
      .optional()
      .describe("Page token from a previous list_buckets call."),
  });

  server.registerTool(
    "gcp-storage-list-buckets",
    {
      title: "List Cloud Storage buckets",
      description:
        "Lists Cloud Storage buckets visible to the configured project.",
      inputSchema: listBucketsSchema,
    },
    async (input) => {
      try {
        const storage = getStorageClient();
        const projectId = await requireProjectId(input.projectId);
        const [buckets, nextQuery, apiResponse] = await storage.getBuckets({
          project: projectId,
          prefix: input.prefix,
          maxResults: input.limit,
          pageToken: input.pageToken,
          autoPaginate: false,
        });

        const nextPageToken =
          (nextQuery as { pageToken?: string } | undefined)?.pageToken ||
          (apiResponse as { nextPageToken?: string } | undefined)?.nextPageToken;

        const text = formatBucketListResponse(buckets, {
          projectId,
          prefix: input.prefix,
          limit: input.limit,
          pageToken: input.pageToken,
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
        return storageErrorResult("List Cloud Storage buckets", error);
      }
    },
  );

  const getBucketSchema = z.object({
    bucket: bucketNameSchema,
    projectId: projectIdSchema,
  });

  server.registerTool(
    "gcp-storage-get-bucket",
    {
      title: "Describe a Cloud Storage bucket",
      description:
        "Retrieves metadata for a Cloud Storage bucket, including location, retention policy, and labels.",
      inputSchema: getBucketSchema,
    },
    async ({ bucket, projectId }) => {
      try {
        const storage = getStorageClient();
        const userProject = await optionalProjectId(projectId);
        const bucketHandle = storage.bucket(
          bucket,
          userProject ? { userProject } : undefined,
        );
        const [metadata] = await bucketHandle.getMetadata(
          userProject ? { userProject } : undefined,
        );

        const text = formatBucketMetadataResponse(metadata, { bucket });
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error) {
        return storageErrorResult("Describe Cloud Storage bucket", error);
      }
    },
  );

  const iamSchema = z.object({
    bucket: bucketNameSchema,
    projectId: projectIdSchema,
  });

  server.registerTool(
    "gcp-storage-view-bucket-iam",
    {
      title: "View bucket IAM policy",
      description:
        "Reads the IAM policy for a Cloud Storage bucket (requesting version 3 policies when available).",
      inputSchema: iamSchema,
    },
    async ({ bucket, projectId }) => {
      try {
        const storage = getStorageClient();
        const userProject = await optionalProjectId(projectId);
        const bucketHandle = storage.bucket(
          bucket,
          userProject ? { userProject } : undefined,
        );
        const [policy] = await bucketHandle.iam.getPolicy({
          requestedPolicyVersion: 3,
        });

        const text = formatBucketIamResponse(policy, {
          bucket,
          projectId: userProject,
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
        return storageErrorResult("Read bucket IAM policy", error);
      }
    },
  );

  const permissionsSchema = z.object({
    bucket: bucketNameSchema,
    permissions: z
      .array(z.string().min(3))
      .min(1)
      .max(50)
      .describe("List of IAM permissions to check (e.g. storage.objects.get)."),
    projectId: projectIdSchema,
  });

  server.registerTool(
    "gcp-storage-test-bucket-permissions",
    {
      title: "Check bucket IAM permissions",
      description:
        "Uses storage.buckets.testIamPermissions to verify which permissions are granted on a bucket.",
      inputSchema: permissionsSchema,
    },
    async ({ bucket, permissions, projectId }) => {
      try {
        const storage = getStorageClient();
        const userProject = await optionalProjectId(projectId);
        const bucketHandle = storage.bucket(
          bucket,
          userProject ? { userProject } : undefined,
        );

        const result = await bucketHandle.iam.testPermissions(
          permissions,
          { userProject },
        );
        const summary = permissions.map((permission) => ({
          permission,
          allowed: Boolean(result[0][permission]),
        }));

        const text = formatPermissionCheckResponse(summary, { bucket });
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error) {
        return storageErrorResult("Check bucket IAM permissions", error);
      }
    },
  );
}
