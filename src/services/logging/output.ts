import { buildStructuredTextBlock, previewList } from "../../utils/output.js";
import { sanitizeLogEntry } from "./sanitizer.js";
import {
  formatLogEntry,
  LogEntry,
  LOG_PREVIEW_LIMIT,
} from "./types.js";

export interface LogResponseOptions {
  title: string;
  metadata: Record<string, unknown>;
  entries: LogEntry[];
  allowFullPayload: boolean;
  footnote?: string;
}

export function buildLogResponseText({
  title,
  metadata,
  entries,
  allowFullPayload,
  footnote,
}: LogResponseOptions): string {
  const { displayed, omitted } = previewList(entries, LOG_PREVIEW_LIMIT);
  const formattedEntries = displayed.map((entry) => {
    const safeEntry = sanitizeLogEntry(entry, { allowFullPayload });
    return formatLogEntry(safeEntry);
  });

  const note =
    omitted > 0
      ? `Showing ${formattedEntries.length} of ${entries.length} entries (preview limit ${LOG_PREVIEW_LIMIT}).`
      : undefined;

  return buildStructuredTextBlock({
    title,
    metadata: {
      ...metadata,
      displayed: formattedEntries.length,
      totalMatched: entries.length,
      omitted,
    },
    dataLabel: "entries",
    data: formattedEntries,
    note,
    footnote: footnote && footnote.trim().length > 0 ? footnote : undefined,
  });
}
