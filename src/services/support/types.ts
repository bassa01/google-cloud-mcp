/**
 * Google Cloud Support service type definitions and formatting helpers
 */

/**
 * Allowed Google Cloud Support case states.
 * Reference: https://cloud.google.com/support/docs/reference/rest/v2/cases
 */
export type CaseState =
  | "STATE_UNSPECIFIED"
  | "NEW"
  | "IN_PROGRESS_GOOGLE_SUPPORT"
  | "ACTION_REQUIRED"
  | "SOLUTION_PROVIDED"
  | "CLOSED";

/**
 * Allowed Google Cloud Support case priorities.
 */
export type CasePriority =
  | "PRIORITY_UNSPECIFIED"
  | "P0"
  | "P1"
  | "P2"
  | "P3"
  | "P4";

/**
 * Actor information returned by the Support API.
 */
export interface Actor {
  displayName?: string;
  email?: string;
  username?: string;
  googleSupport?: boolean;
}

/**
 * Support case representation matching the Cloud Support API response.
 */
export interface SupportCase {
  name?: string;
  displayName?: string;
  description?: string;
  classification?: CaseClassification;
  priority?: CasePriority;
  state?: CaseState;
  createTime?: string;
  updateTime?: string;
  timeZone?: string;
  languageCode?: string;
  contactEmail?: string;
  subscriberEmailAddresses?: string[];
  escalated?: boolean;
  testCase?: boolean;
  creator?: Actor;
}

/**
 * Support case classification information.
 */
export interface CaseClassification {
  id: string;
  displayName?: string;
}

/**
 * Support case comment representation.
 */
export interface CaseComment {
  name?: string;
  createTime?: string;
  creator?: Actor;
  body?: string;
  plainTextBody?: string;
}

/**
 * Support case attachment representation.
 */
export interface CaseAttachment {
  name?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: string;
  createTime?: string;
  creator?: Actor;
}

/**
 * API list responses returned by the Support API.
 */
export interface ListCasesResponse {
  cases?: SupportCase[];
  nextPageToken?: string;
}

export interface SearchCasesResponse {
  cases?: SupportCase[];
  nextPageToken?: string;
}

export interface ListCommentsResponse {
  comments?: CaseComment[];
  nextPageToken?: string;
}

export interface ListAttachmentsResponse {
  attachments?: CaseAttachment[];
  nextPageToken?: string;
}

export interface SearchCaseClassificationsResponse {
  caseClassifications?: CaseClassification[];
  nextPageToken?: string;
}

/**
 * Format a support case into a markdown summary suitable for MCP responses.
 */
export function formatCaseSummary(caseItem: SupportCase, index?: number): string {
  const headerPrefix = index !== undefined ? `${index}. ` : "";
  const nameLine = caseItem.name ? `(${caseItem.name})` : "";
  const priority = caseItem.priority ? `**Priority:** ${caseItem.priority}` : "";
  const state = caseItem.state ? `**State:** ${caseItem.state}` : "";
  const classification = caseItem.classification?.displayName
    ? `**Classification:** ${caseItem.classification.displayName} (${caseItem.classification.id})`
    : caseItem.classification?.id
      ? `**Classification:** ${caseItem.classification.id}`
      : "";

  const parts: string[] = [];
  parts.push(`### ${headerPrefix}${caseItem.displayName ?? "(No title)"} ${nameLine}`.trim());

  if (caseItem.description) {
    const truncated = caseItem.description.length > 600
      ? `${caseItem.description.slice(0, 600)}…`
      : caseItem.description;
    parts.push(truncated);
  }

  const meta: string[] = [];
  if (priority) meta.push(priority);
  if (state) meta.push(state);
  if (classification) meta.push(classification);
  if (caseItem.createTime) meta.push(`**Created:** ${caseItem.createTime}`);
  if (caseItem.updateTime) meta.push(`**Updated:** ${caseItem.updateTime}`);
  if (caseItem.timeZone) meta.push(`**Time Zone:** ${caseItem.timeZone}`);
  if (caseItem.contactEmail) meta.push(`**Contact Email:** ${caseItem.contactEmail}`);

  if (meta.length > 0) {
    parts.push(meta.join("  \n"));
  }

  if (caseItem.subscriberEmailAddresses?.length) {
    parts.push(`**Subscribers:** ${caseItem.subscriberEmailAddresses.join(", ")}`);
  }

  if (caseItem.escalated) {
    parts.push("⚠️ This case is escalated.");
  }

  return parts.join("\n\n");
}

/**
 * Format detailed information for a support case.
 */
export function formatCaseDetails(caseItem: SupportCase): string {
  const parts: string[] = [];
  parts.push(`# Support Case Details\n`);
  parts.push(`**Name:** ${caseItem.name ?? "Unknown"}`);
  parts.push(`**Title:** ${caseItem.displayName ?? "(No title)"}`);
  parts.push(`**Priority:** ${caseItem.priority ?? "Not set"}`);
  parts.push(`**State:** ${caseItem.state ?? "Unknown"}`);

  if (caseItem.classification) {
    parts.push(
      `**Classification:** ${caseItem.classification.displayName ?? caseItem.classification.id} (${caseItem.classification.id})`,
    );
  }

  if (caseItem.description) {
    parts.push(`\n${caseItem.description}`);
  }

  parts.push("\n## Metadata");
  if (caseItem.createTime) parts.push(`- Created: ${caseItem.createTime}`);
  if (caseItem.updateTime) parts.push(`- Updated: ${caseItem.updateTime}`);
  if (caseItem.timeZone) parts.push(`- Time Zone: ${caseItem.timeZone}`);
  if (caseItem.languageCode) parts.push(`- Language: ${caseItem.languageCode}`);
  if (caseItem.contactEmail) parts.push(`- Contact Email: ${caseItem.contactEmail}`);
  if (caseItem.subscriberEmailAddresses?.length) {
    parts.push(`- Subscribers: ${caseItem.subscriberEmailAddresses.join(", ")}`);
  }

  if (caseItem.creator) {
    const creatorBits: string[] = [];
    if (caseItem.creator.displayName) creatorBits.push(caseItem.creator.displayName);
    if (caseItem.creator.email) creatorBits.push(`<${caseItem.creator.email}>`);
    if (caseItem.creator.username) creatorBits.push(caseItem.creator.username);
    if (caseItem.creator.googleSupport) creatorBits.push("(Google Support)");
    if (creatorBits.length) {
      parts.push(`- Creator: ${creatorBits.join(" ")}`);
    }
  }

  if (caseItem.escalated) {
    parts.push("- Status: 🚨 Escalated");
  }

  if (caseItem.testCase) {
    parts.push("- Status: 🧪 Test case");
  }

  return parts.join("\n");
}

/**
 * Format support case comments.
 */
export function formatComments(comments: CaseComment[]): string {
  if (comments.length === 0) {
    return "No comments found for this case.";
  }

  return comments
    .map((comment, index) => {
      const header = `### Comment ${index + 1}`;
      const authorParts: string[] = [];
      if (comment.creator?.displayName) authorParts.push(comment.creator.displayName);
      if (comment.creator?.email) authorParts.push(`<${comment.creator.email}>`);
      if (comment.creator?.googleSupport) authorParts.push("(Google Support)");
      const authorLine = authorParts.length ? `**Author:** ${authorParts.join(" ")}` : "";
      const timestampLine = comment.createTime ? `**Created:** ${comment.createTime}` : "";
      const body = comment.body ?? comment.plainTextBody ?? "(No content)";

      return [header, authorLine, timestampLine, "", body].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/**
 * Format support case attachments.
 */
export function formatAttachments(attachments: CaseAttachment[]): string {
  if (attachments.length === 0) {
    return "No attachments found for this case.";
  }

  return attachments
    .map((attachment, index) => {
      const header = `### Attachment ${index + 1}: ${attachment.filename ?? "(No filename)"}`;
      const details: string[] = [];
      if (attachment.name) details.push(`**Name:** ${attachment.name}`);
      if (attachment.mimeType) details.push(`**MIME Type:** ${attachment.mimeType}`);
      if (attachment.sizeBytes) details.push(`**Size:** ${attachment.sizeBytes} bytes`);
      if (attachment.createTime) details.push(`**Uploaded:** ${attachment.createTime}`);
      if (attachment.creator?.displayName) details.push(`**Uploader:** ${attachment.creator.displayName}`);

      return [header, ...details].join("\n");
    })
    .join("\n\n");
}

/**
 * Format case classifications.
 */
export function formatClassifications(classifications: CaseClassification[]): string {
  if (classifications.length === 0) {
    return "No case classifications matched the query.";
  }

  return classifications
    .map((classification, index) => {
      const header = `### ${index + 1}. ${classification.displayName ?? classification.id}`;
      const idLine = classification.displayName ? `**ID:** ${classification.id}` : "";
      return [header, idLine].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/**
 * Build a standard error message for Support API tool failures.
 */
export function buildSupportErrorMessage(context: string, errorMessage: string): string {
  return `# Google Cloud Support Error\n\n${context}\n\n- **Details:** ${errorMessage}`;
}
