import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";

import {
  buildBucketSummary,
  buildObjectContentPreview,
  formatObjectContentResponse,
  OBJECT_CONTENT_PREVIEW_BYTES,
} from "../../../../src/services/storage/output.js";

describe("storage output helpers", () => {
  it("summarizes buckets with sanitized metadata and omission counts", () => {
    const labels = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `label-${index}`,
        index % 2 === 0 ? index : Boolean(index),
      ]),
    );

    const summary = buildBucketSummary({
      name: "analytics-bucket",
      location: "us-central1",
      storageClass: "STANDARD",
      labels: {
        ...labels,
        empty: "",
        nullish: undefined,
      } as Record<string, string>,
      billing: { requesterPays: true },
      iamConfiguration: {
        publicAccessPrevention: "enforced",
        uniformBucketLevelAccess: { enabled: true },
      },
      versioning: { enabled: true },
      lifecycle: { rule: [{ action: { type: "Delete" } }] },
      retentionPolicy: {
        retentionPeriod: "3600",
        isLocked: true,
        effectiveTime: "2024-01-01T00:00:00Z",
      },
      timeCreated: "2024-01-01T00:00:00Z",
      updated: "2024-01-02T00:00:00Z",
    }, "fallback-bucket");

    expect(summary.name).toBe("analytics-bucket");
    expect(summary.location).toBe("us-central1");
    expect(summary.requesterPays).toBe(true);
    expect(summary.uniformBucketLevelAccess).toBe(true);
    expect(summary.retentionPolicy).toEqual(
      expect.objectContaining({ retentionPeriod: "3600" }),
    );
    expect(summary.labels).toBeDefined();
    expect(Object.keys(summary.labels ?? {})).toHaveLength(10);
    expect(summary.labels?.["label-0"]).toBe("0");
    expect(summary.omittedLabelCount).toBe(3);
  });

  it("produces text previews for UTF-8 data and truncates when total bytes exceed sample", () => {
    const buffer = Buffer.from("Hello Storage!", "utf8");
    const preview = buildObjectContentPreview(buffer, { totalBytes: 4096 });

    expect(preview.encoding).toBe("utf8");
    expect(preview.preview).toContain("Hello Storage");
    expect(preview.truncated).toBe(true);
    expect(preview.bytesReturned).toBe(buffer.length);
  });

  it("encodes binary payloads as base64", () => {
    const binary = Buffer.from([0, 255, 1, 2, 3]);
    const preview = buildObjectContentPreview(binary);

    expect(preview.encoding).toBe("base64");
    expect(preview.preview).toBe(binary.toString("base64"));
    expect(preview.truncated).toBe(false);
  });

  it("annotates object content responses when preview is truncated", () => {
    const textPreview = {
      encoding: "utf8" as const,
      preview: "partial",
      truncated: true,
      bytesReturned: 100,
      totalBytes: 2048,
    };

    const response = formatObjectContentResponse(textPreview, {
      bucket: "demo-bucket",
      object: "logs.txt",
      generation: "123",
    });

    expect(response).toContain("Object Content Preview");
    expect(response).toContain("bucket=demo-bucket");
    expect(response).toContain(
      `Content truncated to preview size (${OBJECT_CONTENT_PREVIEW_BYTES} bytes).`,
    );
  });
});
