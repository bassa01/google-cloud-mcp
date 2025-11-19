import { Buffer } from "node:buffer";
import type {
  Bucket,
  BucketMetadata,
  File,
  FileMetadata,
} from "@google-cloud/storage";
import { describe, expect, it } from "vitest";
import {
  BUCKET_PREVIEW_LIMIT,
  OBJECT_CONTENT_PREVIEW_BYTES,
  OBJECT_PREVIEW_LIMIT,
  buildBucketSummary,
  buildObjectContentPreview,
  buildObjectMetadata,
  buildObjectSummary,
  formatBucketIamResponse,
  formatBucketListResponse,
  formatBucketMetadataResponse,
  formatObjectContentResponse,
  formatObjectListResponse,
  formatObjectMetadataResponse,
  formatPermissionCheckResponse,
  ObjectContentPreview,
  ObjectSummary,
  BucketSummary,
} from "../../../../src/services/storage/output.js";

describe("formatBucketListResponse", () => {
  it("summarizes buckets and advertises pagination", () => {
    const bucketCount = BUCKET_PREVIEW_LIMIT + 2;
    const buckets = Array.from({ length: bucketCount }, (_, index) =>
      createBucket(`bucket-${index}`, { location: "us-central1" }),
    );

    const response = formatBucketListResponse(buckets as Bucket[], {
      projectId: "test-project",
      prefix: "demo",
      limit: 25,
      nextPageToken: "next-token",
    });

    expect(response).toContain("Cloud Storage Buckets");
    expect(response).toContain("projectId=test-project");
    expect(response).toContain("prefix=demo");
    expect(response).toContain("More buckets available. Re-run with pageToken=next-token.");

    const summaries = extractJsonPayload<BucketSummary[]>(response);
    expect(summaries).toHaveLength(BUCKET_PREVIEW_LIMIT);
    expect(summaries[0]).toMatchObject({ name: "bucket-0", location: "us-central1" });
  });
});

describe("formatBucketMetadataResponse", () => {
  it("returns a single bucket summary", () => {
    const metadata = createBucketMetadata({
      name: "logs",
      storageClass: "STANDARD",
      versioning: { enabled: true },
    });

    const response = formatBucketMetadataResponse(metadata, { bucket: "logs" });

    expect(response).toContain("Bucket Metadata");
    expect(response).toContain("bucket=logs");

    const summary = extractJsonPayload<BucketSummary>(response);
    expect(summary).toMatchObject({ name: "logs", storageClass: "STANDARD", versioningEnabled: true });
  });
});

describe("formatBucketIamResponse", () => {
  it("embeds the policy and bucket context", () => {
    const response = formatBucketIamResponse({ bindings: [] }, {
      bucket: "assets",
      projectId: "demo-project",
    });

    expect(response).toContain("Bucket IAM Policy");
    expect(response).toContain("bucket=assets");
    expect(response).toContain("projectId=demo-project");

    const payload = extractJsonPayload(response);
    expect(payload).toEqual({ bindings: [] });
  });
});

describe("formatPermissionCheckResponse", () => {
  it("lists the requested permissions", () => {
    const response = formatPermissionCheckResponse(
      [
        { permission: "storage.objects.get", allowed: true },
        { permission: "storage.objects.delete", allowed: false },
      ],
      { bucket: "assets" },
    );

    expect(response).toContain("Bucket Permission Check");
    expect(response).toContain("bucket=assets");

    const permissions = extractJsonPayload<{ permission: string; allowed: boolean }[]>(response);
    expect(permissions).toEqual([
      { permission: "storage.objects.get", allowed: true },
      { permission: "storage.objects.delete", allowed: false },
    ]);
  });
});

describe("formatObjectListResponse", () => {
  it("summarizes object metadata and preview counts", () => {
    const fileCount = OBJECT_PREVIEW_LIMIT + 3;
    const files = Array.from({ length: fileCount }, (_, index) =>
      createFile(`file-${index}.txt`, {
        name: `file-${index}.txt`,
        size: String(100 + index),
      }),
    );

    const response = formatObjectListResponse(files as File[], {
      bucket: "docs",
      prefix: "reports",
      limit: 30,
      versions: true,
      nextPageToken: "token-2",
    });

    expect(response).toContain("Cloud Storage Objects");
    expect(response).toContain("bucket=docs");
    expect(response).toContain("prefix=reports");
    expect(response).toContain("versions=true");
    expect(response).toContain("Additional objects available. Provide pageToken=token-2 to continue.");

    const summaries = extractJsonPayload<ObjectSummary[]>(response);
    expect(summaries).toHaveLength(OBJECT_PREVIEW_LIMIT);
    expect(summaries[0]).toMatchObject({ name: "file-0.txt", sizeBytes: 100 });
  });
});

describe("formatObjectMetadataResponse", () => {
  it("exports structured object metadata", () => {
    const metadata: FileMetadata = {
      name: "doc.pdf",
      generation: 123n as unknown as string,
      size: "2048",
    };

    const response = formatObjectMetadataResponse(metadata, {
      bucket: "docs",
      object: "doc.pdf",
    });

    expect(response).toContain("Object Metadata");
    expect(response).toContain("bucket=docs");
    expect(response).toContain("object=doc.pdf");

    const summary = extractJsonPayload<ObjectSummary>(response);
    expect(summary).toMatchObject({
      name: "doc.pdf",
      generation: "123",
      sizeBytes: 2048,
    });
  });
});

describe("formatObjectContentResponse", () => {
  it("includes preview metadata and truncation note", () => {
    const preview: ObjectContentPreview = {
      encoding: "utf8",
      preview: "partial-text",
      truncated: true,
      bytesReturned: 512,
      totalBytes: 8192,
    };

    const response = formatObjectContentResponse(preview, {
      bucket: "docs",
      object: "logs.txt",
      generation: 3,
    });

    expect(response).toContain("Object Content Preview");
    expect(response).toContain("bucket=docs");
    expect(response).toContain("object=logs.txt");
    expect(response).toContain(
      `Content truncated to preview size (${OBJECT_CONTENT_PREVIEW_BYTES} bytes).`,
    );

    const payload = extractJsonPayload<ObjectContentPreview>(response);
    expect(payload).toEqual(preview);
  });
});

describe("buildBucketSummary", () => {
  it("normalizes labels, retention policy, and lifecycle counts", () => {
    const metadata = createBucketMetadata({
      name: "analytics",
      location: "US",
      labels: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`label-${index}`, index % 2 === 0 ? `value-${index}` : index]),
      ) as any,
      billing: { requesterPays: true },
      iamConfiguration: {
        publicAccessPrevention: "enforced",
        uniformBucketLevelAccess: { enabled: true },
      },
      versioning: { enabled: true },
      lifecycle: { rule: [{ action: { type: "Delete" } }] },
      retentionPolicy: {
        retentionPeriod: 86400,
        effectiveTime: "2024-01-01T00:00:00Z",
        isLocked: false,
      },
      timeCreated: "2024-01-01T00:00:00Z",
      updated: "2024-01-02T00:00:00Z",
    });

    const summary = buildBucketSummary(metadata, "fallback");

    expect(summary.name).toBe("analytics");
    expect(summary.requesterPays).toBe(true);
    expect(summary.publicAccessPrevention).toBe("enforced");
    expect(summary.uniformBucketLevelAccess).toBe(true);
    expect(summary.lifecycleRuleCount).toBe(1);
    expect(summary.labels).toBeDefined();
    expect(summary.omittedLabelCount).toBeGreaterThan(0);
    expect(summary.retentionPolicy).toEqual({
      retentionPeriod: 86400,
      effectiveTime: "2024-01-01T00:00:00Z",
      isLocked: false,
    });
  });
});

describe("buildObjectMetadata", () => {
  it("converts numeric fields and sanitizes metadata", () => {
    const metadata: FileMetadata = {
      name: "reports/data.json",
      size: "4096",
      generation: 789,
      metageneration: 2,
      storageClass: "STANDARD",
      metadata: {
        flag: true,
        retries: 5,
        empty: null,
      } as any,
      eventBasedHold: null,
      temporaryHold: false,
    };

    const summary = buildObjectMetadata(metadata);

    expect(summary).toMatchObject({
      name: "reports/data.json",
      sizeBytes: 4096,
      generation: "789",
      metageneration: "2",
      storageClass: "STANDARD",
      metadata: { flag: "true", retries: "5" },
      temporaryHold: false,
    });
    expect(summary.eventBasedHold).toBeUndefined();
    expect(summary.metadata).toBeDefined();
    expect(summary.metadata).not.toHaveProperty("empty");
  });
});

describe("buildObjectSummary", () => {
  it("derives metadata from the File wrapper when metadata is missing", () => {
    const summary = buildObjectSummary(createFile("orphan.txt") as File);

    expect(summary.name).toBe("orphan.txt");
  });
});

describe("buildObjectContentPreview", () => {
  it("returns a base64 preview for binary buffers", () => {
    const buffer = Buffer.from([0, 255, 1, 2]);

    const preview = buildObjectContentPreview(buffer, { totalBytes: 16 });

    expect(preview.encoding).toBe("base64");
    expect(preview.truncated).toBe(true);
    expect(preview.preview).toBe(buffer.toString("base64"));
  });

  it("returns a utf8 preview for textual buffers", () => {
    const buffer = Buffer.from("hello world", "utf8");

    const preview = buildObjectContentPreview(buffer, { totalBytes: 1024 });

    expect(preview.encoding).toBe("utf8");
    expect(preview.truncated).toBe(true);
    expect(preview.preview).toContain("hello world");
  });
});

type JsonLike = Record<string, unknown> | Array<unknown>;

function extractJsonPayload<T extends JsonLike>(payload: string): T {
  const match = payload.match(/```json\n([\s\S]*?)\n```/);
  expect(match, "structured payload missing JSON block").toBeTruthy();
  return JSON.parse(match![1]) as T;
}

function createBucket(
  name: string,
  metadataOverrides: Partial<BucketMetadata> = {},
): Bucket {
  return {
    name,
    metadata: {
      name,
      ...metadataOverrides,
    } as BucketMetadata,
  } as unknown as Bucket;
}

function createBucketMetadata(
  overrides: Partial<BucketMetadata> = {},
): BucketMetadata {
  return {
    name: "bucket",
    ...overrides,
  } as BucketMetadata;
}

function createFile(
  name: string,
  metadataOverrides: Partial<FileMetadata> = {},
): File {
  return {
    name,
    metadata: {
      name,
      ...metadataOverrides,
    } as FileMetadata,
  } as unknown as File;
}
