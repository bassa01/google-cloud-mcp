/**
 * Type definitions for Google Cloud Logging service
 */
import { Logging } from "@google-cloud/logging";
import {
  createTextPreview,
  resolveBoundedNumber,
} from "../../utils/output.js";

/**
 * Interface for Google Cloud Log Entry
 */
export interface LogEntry {
  timestamp: string;
  severity: string;
  resource: {
    type: string;
    labels: Record<string, string>;
  };
  logName: string;
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
