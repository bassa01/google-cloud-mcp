/**
 * Type definitions for Google Cloud Logging service
 */
import { Buffer } from "node:buffer";
import { Logging } from "@google-cloud/logging";
import {
  createTextPreview,
  resolveBoundedNumber,
} from "../../utils/output.js";

/**
 * Interface for Google Cloud Log Entry
 */
export interface LogEntry {
  timestamp?: string;
  severity?: string;
  resource?: {
    type?: string;
    labels?: Record<string, string>;
  };
  logName?: string;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  protoPayload?: Record<string, unknown>;
  labels?: Record<string, string>;
  insertId?: string;
  trace?: string;
  spanId?: string;
  traceSampled?: boolean;
  sourceLocation?: {
    file?: string;
    line?: number;
    function?: string;
  };
  httpRequest?: {
    requestMethod?: string;
    requestUrl?: string;
    requestSize?: string;
    status?: number;
    responseSize?: string;
    userAgent?: string;
    remoteIp?: string;
    referer?: string;
    latency?: string;
    cacheLookup?: boolean;
    cacheHit?: boolean;
    cacheValidatedWithOriginServer?: boolean;
    cacheFillBytes?: string;
    protocol?: string;
  };
  operation?: {
    id?: string;
    producer?: string;
    first?: boolean;
    last?: boolean;
  };
  receiveTimestamp?: string;
  [key: string]: unknown;
}

export type LogEntryLike = LogEntry | Record<string, unknown>;

/**
 * Initialises the Google Cloud Logging client
 *
 * @returns A configured Logging client
 */
export function getLoggingClient(): Logging {
  return new Logging({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  });
}

/**
 * Formats a log entry for display with comprehensive information
 *
 * @param entry The log entry to format
 * @returns A formatted string representation of the log entry with all available fields
 */
export interface LogPayloadSummary {
  type: "text" | "json" | "proto" | "other";
  value: unknown;
  truncated?: boolean;
}

export interface LogEntrySummary {
  timestamp: string;
  severity: string;
  resource?: {
    type?: string;
    labels?: Record<string, string>;
  };
  logName?: string;
  insertId?: string;
  receiveTimestamp?: string;
  trace?: string;
  spanId?: string;
  traceSampled?: boolean;
  sourceLocation?: {
    file?: string;
    line?: number;
    function?: string;
  };
  httpRequest?: {
    method?: string;
    url?: string;
    status?: number;
    latency?: string;
    userAgent?: string;
    remoteIp?: string;
  };
  operation?: {
    id?: string;
    producer?: string;
    first?: boolean;
    last?: boolean;
  };
  labels?: Record<string, string>;
  payload: LogPayloadSummary;
  additionalFields?: Record<string, unknown>;
}

function normaliseTimestamp(input?: string): string {
  if (!input) {
    return "unknown";
  }

  try {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      return input;
    }
    return parsed.toISOString();
  } catch {
    return input;
  }
}

function cleanRecord<T extends Record<string, unknown>>(
  value?: T,
): T | undefined {
  if (!value) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    ([, fieldValue]) => fieldValue !== undefined && fieldValue !== null,
  );

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as T;
}

const TEXT_PAYLOAD_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.LOG_TEXT_PAYLOAD_PREVIEW,
  600,
  { min: 120, max: 4000 },
);

export const LOG_PREVIEW_LIMIT = resolveBoundedNumber(
  process.env.LOG_OUTPUT_PREVIEW_LIMIT ?? process.env.LOG_OUTPUT_MAX,
  20,
  { min: 5, max: 200 },
);

/**
 * Format a log entry into a compact, machine-friendly summary object.
 */
export function formatLogEntry(entry: LogEntry): LogEntrySummary {
  const payload = buildPayload(entry);

  const knownFields = new Set([
    "timestamp",
    "severity",
    "resource",
    "logName",
    "textPayload",
    "jsonPayload",
    "protoPayload",
    "labels",
    "insertId",
    "trace",
    "spanId",
    "traceSampled",
    "sourceLocation",
    "httpRequest",
    "operation",
    "receiveTimestamp",
    "data",
    "message",
    "msg",
  ]);

  const additionalFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!knownFields.has(key) && value !== undefined && value !== null) {
      additionalFields[key] = value;
    }
  }

  return {
    timestamp: normaliseTimestamp(entry.timestamp),
    severity: entry.severity || "DEFAULT",
    resource: cleanRecord({
      type: entry.resource?.type,
      labels:
        entry.resource?.labels && Object.keys(entry.resource.labels).length > 0
          ? entry.resource.labels
          : undefined,
    }),
    logName: entry.logName,
    insertId: entry.insertId,
    receiveTimestamp: normaliseTimestamp(entry.receiveTimestamp),
    trace: entry.trace,
    spanId: entry.spanId,
    traceSampled: entry.traceSampled,
    sourceLocation: cleanRecord(entry.sourceLocation),
    httpRequest: cleanRecord({
      method: entry.httpRequest?.requestMethod,
      url: entry.httpRequest?.requestUrl,
      status: entry.httpRequest?.status,
      latency: entry.httpRequest?.latency,
      userAgent: entry.httpRequest?.userAgent,
      remoteIp: entry.httpRequest?.remoteIp,
    }),
    operation: cleanRecord(entry.operation),
    labels:
      entry.labels && Object.keys(entry.labels).length > 0
        ? entry.labels
        : undefined,
    payload,
    additionalFields:
      Object.keys(additionalFields).length > 0 ? additionalFields : undefined,
  };
}

function buildPayload(entry: LogEntry): LogPayloadSummary {
  if (entry.textPayload !== undefined && entry.textPayload !== null) {
    const { text, truncated } = createTextPreview(
      String(entry.textPayload),
      TEXT_PAYLOAD_PREVIEW_LIMIT,
    );
    return {
      type: "text",
      value: text,
      truncated,
    };
  }

  if (entry.jsonPayload) {
    return {
      type: "json",
      value: entry.jsonPayload,
    };
  }

  if (entry.protoPayload) {
    return {
      type: "proto",
      value: entry.protoPayload,
    };
  }

  const data = entry.data || entry.message || entry.msg;
  if (data) {
    if (typeof data === "string") {
      const { text, truncated } = createTextPreview(
        data,
        TEXT_PAYLOAD_PREVIEW_LIMIT,
      );
      return { type: "text", value: text, truncated };
    }

    return {
      type: "json",
      value: data,
    };
  }

  return {
    type: "other",
    value: "[no payload available]",
  };
}

type TimestampValue =
  | string
  | Date
  | {
      seconds?: number | string;
      nanos?: number;
    };

function normaliseTimestampValue(value?: TimestampValue): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object" && "seconds" in value) {
    const seconds = Number(value.seconds || 0);
    const nanos = Number(value.nanos || 0);
    if (!Number.isNaN(seconds)) {
      const millis = seconds * 1000 + Math.floor(nanos / 1e6);
      return new Date(millis).toISOString();
    }
  }

  return undefined;
}

function isBufferLike(value: unknown): value is Buffer {
  return (
    typeof Buffer !== "undefined" &&
    Buffer.isBuffer &&
    Buffer.isBuffer(value as Buffer)
  );
}

function resolvePayloadFromEntry(entry: Record<string, unknown>): {
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
} {
  if (typeof entry.textPayload === "string") {
    return { textPayload: entry.textPayload };
  }

  const data = entry.data;

  if (typeof data === "string") {
    return { textPayload: data };
  }

  if (isBufferLike(data)) {
    return { textPayload: data.toString("utf8") };
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { jsonPayload: data as Record<string, unknown> };
  }

  if (
    entry.jsonPayload &&
    typeof entry.jsonPayload === "object" &&
    !Array.isArray(entry.jsonPayload)
  ) {
    return { jsonPayload: entry.jsonPayload as Record<string, unknown> };
  }

  return {};
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.entries(value).reduce((acc, [key, fieldValue]) => {
    if (fieldValue !== undefined && fieldValue !== null) {
      acc[key as keyof T] = fieldValue as T[keyof T];
    }
    return acc;
  }, {} as T);
}

function hasMetadataShape(entry: Record<string, unknown>): boolean {
  return typeof entry.metadata === "object" && entry.metadata !== null;
}

export function normalizeLogEntry(entry: LogEntryLike | undefined): LogEntry {
  if (!entry) {
    return {
      severity: "DEFAULT",
      timestamp: "unknown",
    };
  }

  const record = entry as Record<string, unknown>;

  if (!hasMetadataShape(record)) {
    return entry as LogEntry;
  }

  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const payload = resolvePayloadFromEntry(record);

  const normalized: LogEntry = pruneUndefined({
    timestamp:
      normaliseTimestampValue(metadata.timestamp as TimestampValue) ??
      normaliseTimestampValue(record.timestamp as TimestampValue),
    receiveTimestamp:
      normaliseTimestampValue(metadata.receiveTimestamp as TimestampValue) ??
      normaliseTimestampValue(record.receiveTimestamp as TimestampValue),
    severity:
      (metadata.severity as string) ||
      (record.severity as string) ||
      "DEFAULT",
    resource: (metadata.resource || record.resource) as LogEntry["resource"],
    logName: (metadata.logName as string) ?? (record.logName as string),
    insertId: (metadata.insertId as string) ?? (record.insertId as string),
    trace: (metadata.trace as string) ?? (record.trace as string),
    spanId: (metadata.spanId as string) ?? (record.spanId as string),
    traceSampled:
      (metadata.traceSampled as boolean) ?? (record.traceSampled as boolean),
    sourceLocation: (metadata.sourceLocation ||
      record.sourceLocation) as LogEntry["sourceLocation"],
    httpRequest: (metadata.httpRequest ||
      record.httpRequest) as LogEntry["httpRequest"],
    operation: (metadata.operation || record.operation) as LogEntry["operation"],
    labels: (metadata.labels || record.labels) as LogEntry["labels"],
    textPayload:
      payload.textPayload ??
      (metadata.textPayload as string) ??
      (record.textPayload as string),
    jsonPayload:
      payload.jsonPayload ??
      (metadata.jsonPayload as Record<string, unknown>) ??
      (record.jsonPayload as Record<string, unknown>),
    protoPayload: (metadata.protoPayload ||
      record.protoPayload) as Record<string, unknown>,
    data: record.data,
  });

  return normalized;
}
