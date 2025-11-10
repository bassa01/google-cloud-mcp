/**
 * Helpers for producing compact, machine-friendly MCP responses.
 */

/**
 * Options for building a structured markdown/text response that embeds JSON.
 */
export interface StructuredOutputOptions<T> {
  title: string;
  metadata?: Record<string, unknown>;
  data: T;
  dataLabel?: string;
  note?: string;
  footnote?: string;
  space?: number;
}

/**
 * Safely stringify arbitrary data, converting unsupported values (e.g. bigint) to strings.
 */
export function safeJSONStringify(
  value: unknown,
  space: number = 2,
): string {
  return JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === "bigint") {
        return val.toString();
      }
      if (val instanceof Date) {
        return val.toISOString();
      }
      return val;
    },
    space,
  );
}

/**
 * Format metadata values as a single, pipe-delimited line (key=value).
 */
export function formatMetadataLine(
  metadata?: Record<string, unknown>,
): string | undefined {
  if (!metadata) {
    return undefined;
  }

  const parts = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      if (typeof value === "object") {
        return `${key}=${safeJSONStringify(value)}`;
      }
      return `${key}=${value}`;
    });

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" | ");
}

/**
 * Build a single text block that starts with a short summary line and embeds JSON data.
 */
export function buildStructuredTextBlock<T>({
  title,
  metadata,
  data,
  dataLabel,
  note,
  footnote,
  space = 2,
}: StructuredOutputOptions<T>): string {
  const segments: string[] = [];
  segments.push(title);

  const metadataLine = formatMetadataLine(metadata);
  if (metadataLine) {
    segments.push(metadataLine);
  }

  if (note) {
    segments.push(note);
  }

  const jsonPayload = `\`\`\`json\n${safeJSONStringify(data, space)}\n\`\`\``;
  if (dataLabel) {
    segments.push(`${dataLabel}:\n${jsonPayload}`);
  } else {
    segments.push(jsonPayload);
  }

  if (footnote) {
    segments.push(footnote);
  }

  return segments.join("\n\n");
}

/**
 * Return a preview subset of an array and how many items were omitted.
 */
export function previewList<T>(
  items: T[],
  maxItems: number,
): { displayed: T[]; omitted: number } {
  if (items.length <= maxItems) {
    return { displayed: items, omitted: 0 };
  }

  return {
    displayed: items.slice(0, maxItems),
    omitted: items.length - maxItems,
  };
}

/**
 * Trim overly long strings to avoid ballooning responses.
 */
export function createTextPreview(
  value: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, maxLength)}…`,
    truncated: true,
  };
}

/**
 * Parse a numeric environment variable and clamp it to safe bounds.
 */
export function resolveBoundedNumber(
  rawValue: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const clamped = Math.min(Math.max(parsed, bounds.min), bounds.max);
  return Math.floor(clamped);
}
