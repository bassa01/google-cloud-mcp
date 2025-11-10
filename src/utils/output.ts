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

export interface PreviewNoteOptions {
  total: number;
  displayed: number;
  label?: string;
  limit?: number;
  emptyMessage?: string;
  omitted?: number;
}

export interface StructuredResponseOptions<T>
  extends Omit<StructuredOutputOptions<T>, "note"> {
  note?: string;
  preview?: PreviewNoteOptions;
  additionalNotes?: Array<string | undefined>;
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

export function buildPreviewNote(
  options?: PreviewNoteOptions,
): string | undefined {
  if (!options) {
    return undefined;
  }

  const {
    total,
    displayed,
    label = "items",
    limit,
    emptyMessage,
    omitted,
  } = options;

  if (total === 0) {
    return emptyMessage || `No ${label} found.`;
  }

  const omittedCount = Math.max(
    omitted ?? total - displayed,
    0,
  );

  if (omittedCount === 0) {
    return undefined;
  }

  const limitDetail = limit ? ` (preview limit ${limit})` : "";
  return `Showing ${displayed} of ${total} ${label}${limitDetail}.`;
}

export function buildStructuredResponse<T>({
  preview,
  additionalNotes = [],
  note,
  ...rest
}: StructuredResponseOptions<T>): string {
  const combinedNotes = [buildPreviewNote(preview), note, ...additionalNotes]
    .filter((value): value is string => Boolean(value && value.trim().length))
    .join(" ");

  return buildStructuredTextBlock({
    ...rest,
    note: combinedNotes.length ? combinedNotes : undefined,
  });
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

export function previewRecordEntries<T>(
  record: Record<string, T> | undefined,
  maxEntries: number,
): { displayed: Record<string, T>; omitted: number } {
  if (!record) {
    return { displayed: {}, omitted: 0 };
  }

  const entries = Object.entries(record);
  const { displayed, omitted } = previewList(entries, maxEntries);
  return {
    displayed: Object.fromEntries(displayed),
    omitted,
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
