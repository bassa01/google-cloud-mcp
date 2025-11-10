import { LogEntry } from "./types.js";

export interface SanitizeOptions {
  /**
   * When true, returns a clone of the entry without scrubbing payload data.
   */
  allowFullPayload?: boolean;
}

const REDACTION_MARKERS = {
  ip: "[REDACTED_IP]",
  user: "[REDACTED_USER]",
  body: "[REDACTED_BODY]",
  payload: "[REDACTED_PAYLOAD - requires authorized role]",
};

const IP_KEYWORDS = [
  "ip",
  "ipaddress",
  "remoteip",
  "clientip",
  "sourceip",
  "destinationip",
  "forwardedfor",
];

const USER_KEYWORDS = [
  "user",
  "userid",
  "username",
  "principal",
  "principalemail",
  "email",
  "actor",
  "caller",
  "subject",
  "uid",
];

const BODY_KEYWORDS = [
  "body",
  "requestbody",
  "payload",
  "httpbody",
  "rawbody",
  "textpayload",
];

const IPV4_REGEX =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}(?!\d)/; // simple IPv4 matcher
const IPV6_REGEX = /([a-f\d]{1,4}:){2,7}[a-f\d]{1,4}/i;

/**
 * Performs a deep-clone sanitization pass over log entries.
 */
export function sanitizeLogEntry(
  entry: LogEntry,
  options: SanitizeOptions = {},
): LogEntry {
  const { allowFullPayload = false } = options;

  const clonedEntry = deepClone(entry);
  if (allowFullPayload) {
    return clonedEntry;
  }

  scrubHttpRequest(clonedEntry);
  scrubPayload(clonedEntry);
  scrubRecord(clonedEntry.labels);
  scrubRecord(clonedEntry.jsonPayload as Record<string, unknown>);
  scrubRecord(clonedEntry.protoPayload as Record<string, unknown>);

  // Also scrub any top-level dynamic fields (additional metadata added upstream)
  Object.entries(clonedEntry).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // already handled specific structured fields above
      if (
        key !== "resource" &&
        key !== "httpRequest" &&
        key !== "jsonPayload" &&
        key !== "protoPayload" &&
        key !== "labels"
      ) {
        scrubRecord(value as Record<string, unknown>);
      }
    } else {
      if (key === "textPayload") {
        return;
      }

      (clonedEntry as Record<string, unknown>)[key] = sanitizePrimitive(
        key,
        value,
      );
    }
  });

  return clonedEntry;
}

function scrubHttpRequest(entry: LogEntry): void {
  if (!entry.httpRequest) {
    return;
  }

  const request = entry.httpRequest;
  if (request.remoteIp) {
    request.remoteIp = REDACTION_MARKERS.ip;
  }
  if ((request as Record<string, unknown>).clientIp) {
    (request as Record<string, unknown>).clientIp = REDACTION_MARKERS.ip;
  }
  if ((request as Record<string, unknown>).body) {
    (request as Record<string, unknown>).body = REDACTION_MARKERS.body;
  }
}

function scrubPayload(entry: LogEntry): void {
  if (entry.textPayload) {
    entry.textPayload = REDACTION_MARKERS.payload;
  }

  if (entry.jsonPayload) {
    entry.jsonPayload = scrubRecord(entry.jsonPayload);
  }

  if (entry.protoPayload) {
    entry.protoPayload = scrubRecord(entry.protoPayload);
  }
}

function scrubRecord<T extends Record<string, unknown> | undefined>(
  record: T,
): T {
  if (!record) {
    return record;
  }

  Object.entries(record).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    const keyRedaction = getKeySpecificRedaction(key);
    if (keyRedaction) {
      (record as Record<string, unknown>)[key] = keyRedaction;
      return;
    }

    if (Array.isArray(value)) {
      (record as Record<string, unknown>)[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? scrubRecord(item as Record<string, unknown>)
          : sanitizePrimitive(key, item),
      );
      return;
    }

    if (typeof value === "object") {
      (record as Record<string, unknown>)[key] = scrubRecord(
        value as Record<string, unknown>,
      );
      return;
    }

    (record as Record<string, unknown>)[key] = sanitizePrimitive(key, value);
  });

  return record;
}

function sanitizePrimitive(key: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const keyRedaction = getKeySpecificRedaction(key);
  if (keyRedaction) {
    return keyRedaction;
  }

  if (typeof value === "string" && (IPV4_REGEX.test(value) || IPV6_REGEX.test(value))) {
    return REDACTION_MARKERS.ip;
  }

  return value;
}

function getKeySpecificRedaction(key: string): string | null {
  const lowerKey = key.toLowerCase();

  if (BODY_KEYWORDS.some((keyword) => lowerKey.includes(keyword))) {
    return REDACTION_MARKERS.body;
  }

  if (IP_KEYWORDS.some((keyword) => lowerKey.includes(keyword))) {
    return REDACTION_MARKERS.ip;
  }

  if (USER_KEYWORDS.some((keyword) => lowerKey.includes(keyword))) {
    return REDACTION_MARKERS.user;
  }

  return null;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
