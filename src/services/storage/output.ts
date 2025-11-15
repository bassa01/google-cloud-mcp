import { Buffer } from "node:buffer";
import type {
  Bucket,
  BucketMetadata,
  File,
  FileMetadata,
} from "@google-cloud/storage";
import {
  buildStructuredResponse,
  createTextPreview,
  previewList,
  previewRecordEntries,
  resolveBoundedNumber,
} from "../../utils/output.js";

export const BUCKET_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.STORAGE_BUCKET_PREVIEW_LIMIT,
  20,
  { min: 5, max: 200 },
);

export const OBJECT_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.STORAGE_OBJECT_PREVIEW_LIMIT,
  50,
  { min: 5, max: 200 },
);

const LABEL_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.STORAGE_LABEL_PREVIEW_LIMIT,
  10,
  { min: 3, max: 50 },
);

const METADATA_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.STORAGE_METADATA_PREVIEW_LIMIT,
  12,
  { min: 3, max: 60 },
);

export const OBJECT_CONTENT_PREVIEW_BYTES = resolveBoundedNumber(
  process.env.STORAGE_OBJECT_CONTENT_PREVIEW_BYTES,
  8192,
  { min: 512, max: 65536 },
);

const TEXT_PREVIEW_CHAR_LIMIT = resolveBoundedNumber(
  process.env.STORAGE_TEXT_PREVIEW_CHAR_LIMIT,
  4000,
  { min: 200, max: 12000 },
);

interface BaseSummary {
  [key: string]: unknown;
}

export interface BucketSummary extends BaseSummary {
  name: string;
  location?: string;
  storageClass?: string;
  locationType?: string;
  requesterPays?: boolean;
  publicAccessPrevention?: string;
  uniformBucketLevelAccess?: boolean;
  versioningEnabled?: boolean;
  defaultEventBasedHold?: boolean;
  lifecycleRuleCount?: number;
  retentionPolicy?: {
    retentionPeriod?: string | number;
    isLocked?: boolean;
    effectiveTime?: string;
  };
  labels?: Record<string, string>;
  omittedLabelCount?: number;
  created?: string;
  updated?: string;
}

export interface ObjectSummary extends BaseSummary {
  name: string;
  sizeBytes?: number;
  storageClass?: string;
  generation?: string;
  metageneration?: string;
  contentType?: string;
  crc32c?: string;
  md5Hash?: string;
  updated?: string;
  timeCreated?: string;
  timeDeleted?: string;
  eventBasedHold?: boolean;
  temporaryHold?: boolean;
  kmsKeyName?: string;
  customTime?: string;
  metadata?: Record<string, string>;
  omittedMetadataCount?: number;
}

export interface ObjectContentPreview {
  encoding: "utf8" | "base64";
  preview: string;
  truncated: boolean;
  bytesReturned: number;
  totalBytes?: number;
}

export const formatBucketListResponse = (
  buckets: Bucket[],
  options: {
    projectId: string;
    prefix?: string;
    limit: number;
    pageToken?: string;
    nextPageToken?: string;
  },
): string => {
  const { displayed, omitted } = previewList(buckets, BUCKET_PREVIEW_LIMIT);
  const summaries = displayed.map((bucket) =>
    buildBucketSummary(bucket.metadata, bucket.name),
  );

  return buildStructuredResponse({
    title: "Cloud Storage Buckets",
    metadata: {
      projectId: options.projectId,
      prefix: options.prefix || "*",
      limit: options.limit,
      nextPageToken: options.nextPageToken,
    },
    data: summaries,
    dataLabel: "buckets",
    preview: {
      total: buckets.length,
      displayed: summaries.length,
      omitted,
      label: "buckets",
      limit: BUCKET_PREVIEW_LIMIT,
    },
    footnote: options.nextPageToken
      ? `More buckets available. Re-run with pageToken=${options.nextPageToken}.`
      : undefined,
  });
};

export const formatBucketMetadataResponse = (
  metadata: BucketMetadata,
  options: { bucket: string },
): string => {
  const summary = buildBucketSummary(metadata, options.bucket);

  return buildStructuredResponse({
    title: "Bucket Metadata",
    metadata: {
      bucket: summary.name,
    },
    data: summary,
    dataLabel: "bucket",
  });
};

export const formatBucketIamResponse = (
  policy: unknown,
  options: { bucket: string; projectId?: string },
): string => {
  return buildStructuredResponse({
    title: "Bucket IAM Policy",
    metadata: {
      bucket: options.bucket,
      projectId: options.projectId,
    },
    data: policy,
  });
};

export const formatPermissionCheckResponse = (
  permissions: Array<{ permission: string; allowed: boolean }>,
  options: { bucket: string },
): string => {
  return buildStructuredResponse({
    title: "Bucket Permission Check",
    metadata: {
      bucket: options.bucket,
    },
    dataLabel: "permissions",
    data: permissions,
  });
};

export const formatObjectListResponse = (
  files: File[],
  options: {
    bucket: string;
    prefix?: string;
    limit: number;
    versions?: boolean;
    nextPageToken?: string;
  },
): string => {
  const { displayed, omitted } = previewList(files, OBJECT_PREVIEW_LIMIT);
  const summaries = displayed.map((file) => buildObjectSummary(file));

  return buildStructuredResponse({
    title: "Cloud Storage Objects",
    metadata: {
      bucket: options.bucket,
      prefix: options.prefix || "*",
      versions: options.versions ?? false,
      limit: options.limit,
      nextPageToken: options.nextPageToken,
    },
    dataLabel: "objects",
    data: summaries,
    preview: {
      total: files.length,
      displayed: summaries.length,
      omitted,
      label: "objects",
      limit: OBJECT_PREVIEW_LIMIT,
    },
    footnote: options.nextPageToken
      ? `Additional objects available. Provide pageToken=${options.nextPageToken} to continue.`
      : undefined,
  });
};

export const formatObjectMetadataResponse = (
  metadata: FileMetadata,
  options: { bucket: string; object: string },
): string => {
  const summary = buildObjectMetadata(metadata);

  return buildStructuredResponse({
    title: "Object Metadata",
    metadata: {
      bucket: options.bucket,
      object: options.object,
      generation: metadata.generation,
    },
    data: summary,
    dataLabel: "object",
  });
};

export const formatObjectContentResponse = (
  preview: ObjectContentPreview,
  options: {
    bucket: string;
    object: string;
    generation?: string | number;
  },
): string => {
  return buildStructuredResponse({
    title: "Object Content Preview",
    metadata: {
      bucket: options.bucket,
      object: options.object,
      generation: options.generation,
      previewBytes: preview.bytesReturned,
      totalBytes: preview.totalBytes,
      encoding: preview.encoding,
    },
    note: preview.truncated
      ? `Content truncated to preview size (${OBJECT_CONTENT_PREVIEW_BYTES} bytes).`
      : undefined,
    data: preview,
  });
};

export const buildBucketSummary = (
  metadata: BucketMetadata | undefined,
  fallbackName?: string,
): BucketSummary => {
  const name = metadata?.name ?? fallbackName ?? "unknown-bucket";
  const { displayed: labels, omitted: omittedLabelCount } = previewRecordEntries(
    metadata?.labels,
    LABEL_PREVIEW_LIMIT,
  );

  return compact({
    name,
    location: metadata?.location,
    storageClass: metadata?.storageClass,
    locationType: metadata?.locationType,
    requesterPays: metadata?.billing?.requesterPays,
    publicAccessPrevention: metadata?.iamConfiguration?.publicAccessPrevention,
    uniformBucketLevelAccess:
      metadata?.iamConfiguration?.uniformBucketLevelAccess?.enabled,
    versioningEnabled: metadata?.versioning?.enabled,
    defaultEventBasedHold: metadata?.defaultEventBasedHold,
    lifecycleRuleCount: metadata?.lifecycle?.rule?.length,
    retentionPolicy: metadata?.retentionPolicy
      ? {
          retentionPeriod: metadata.retentionPolicy.retentionPeriod,
          effectiveTime: metadata.retentionPolicy.effectiveTime,
          isLocked: metadata.retentionPolicy.isLocked,
        }
      : undefined,
    labels: Object.keys(labels).length ? labels : undefined,
    omittedLabelCount: omittedLabelCount || undefined,
    created: metadata?.timeCreated,
    updated: metadata?.updated,
  });
};

export const buildObjectSummary = (file: File): ObjectSummary => {
  return buildObjectMetadata(file.metadata ?? { name: file.name });
};

export const buildObjectMetadata = (
  metadata: FileMetadata,
): ObjectSummary => {
  const {
    displayed: customMetadata,
    omitted: omittedMetadataCount,
  } = previewRecordEntries(metadata.metadata, METADATA_PREVIEW_LIMIT);

  return compact({
    name: metadata.name,
    sizeBytes: metadata.size ? Number(metadata.size) : undefined,
    storageClass: metadata.storageClass,
    generation: metadata.generation,
    metageneration: metadata.metageneration,
    contentType: metadata.contentType,
    crc32c: metadata.crc32c,
    md5Hash: metadata.md5Hash,
    updated: metadata.updated,
    timeCreated: metadata.timeCreated,
    timeDeleted: metadata.timeDeleted,
    eventBasedHold: metadata.eventBasedHold,
    temporaryHold: metadata.temporaryHold,
    kmsKeyName: metadata.kmsKeyName,
    customTime: metadata.customTime,
    metadata: Object.keys(customMetadata).length ? customMetadata : undefined,
    omittedMetadataCount: omittedMetadataCount || undefined,
  });
};

export const buildObjectContentPreview = (
  buffer: Buffer,
  options: { totalBytes?: number } = {},
): ObjectContentPreview => {
  const totalBytes = options.totalBytes;
  const binary = isLikelyBinary(buffer);

  if (binary) {
    const truncated = Boolean(totalBytes && totalBytes > buffer.length);
    return {
      encoding: "base64",
      preview: buffer.toString("base64"),
      truncated,
      bytesReturned: buffer.length,
      totalBytes,
    };
  }

  const textResult = createTextPreview(buffer.toString("utf8"), TEXT_PREVIEW_CHAR_LIMIT);
  const truncated =
    textResult.truncated || Boolean(totalBytes && totalBytes > buffer.length);

  return {
    encoding: "utf8",
    preview: textResult.text,
    truncated,
    bytesReturned: buffer.length,
    totalBytes,
  };
};

function compact<T extends BaseSummary>(value: T): T {
  const entries = Object.entries(value).filter(([, val]) => {
    if (val === undefined || val === null) {
      return false;
    }

    if (typeof val === "object") {
      if (Array.isArray(val)) {
        return val.length > 0;
      }
      return Object.keys(val as Record<string, unknown>).length > 0;
    }

    return true;
  });

  return Object.fromEntries(entries) as T;
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  const sampleLength = Math.min(buffer.length, 1024);
  let nonPrintable = 0;

  for (let i = 0; i < sampleLength; i++) {
    const byte = buffer[i];
    if (byte === 0) {
      return true;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      nonPrintable++;
    }
  }

  return nonPrintable / sampleLength > 0.1;
}
