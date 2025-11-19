import { describe, expect, it } from "vitest";

import {
  buildSupportErrorMessage,
  formatAttachments,
  formatCaseDetails,
  formatCaseSummary,
  formatClassifications,
  formatComments,
  type CaseAttachment,
  type CaseClassification,
  type CaseComment,
  type SupportCase,
} from "../../../../src/services/support/types.js";

describe("support type formatting helpers", () => {
  describe("formatCaseSummary", () => {
    it("builds a comprehensive summary with metadata, subscribers, and truncation", () => {
      const longDescription = "A".repeat(620);
      const caseItem: SupportCase = {
        name: "projects/test/cases/123",
        displayName: "Critical outage",
        description: longDescription,
        priority: "P1",
        state: "ACTION_REQUIRED",
        classification: { id: "CL-1", displayName: "Networking" },
        createTime: "2024-01-01T00:00:00Z",
        updateTime: "2024-01-02T00:00:00Z",
        timeZone: "UTC",
        contactEmail: "ops@example.com",
        subscriberEmailAddresses: ["sre@example.com", "oncall@example.com"],
        escalated: true,
      };

      const summary = formatCaseSummary(caseItem, 2);

      expect(summary).toContain("### 2. Critical outage (projects/test/cases/123)");
      expect(summary).toContain(`${"A".repeat(600)}…`);
      expect(summary).toContain("**Priority:** P1");
      expect(summary).toContain("**State:** ACTION_REQUIRED");
      expect(summary).toContain("**Classification:** Networking (CL-1)");
      expect(summary).toContain("**Created:** 2024-01-01T00:00:00Z");
      expect(summary).toContain("**Updated:** 2024-01-02T00:00:00Z");
      expect(summary).toContain("**Time Zone:** UTC");
      expect(summary).toContain("**Contact Email:** ops@example.com");
      expect(summary).toContain("**Subscribers:** sre@example.com, oncall@example.com");
      expect(summary).toContain("⚠️ This case is escalated.");
    });

    it("handles sparse case payloads without crashing", () => {
      const summary = formatCaseSummary({}, undefined);
      expect(summary).toContain("### (No title)");
      expect(summary.includes("Priority")).toBe(false);
    });
  });

  describe("formatCaseDetails", () => {
    it("prints sections, metadata, creator, and status flags", () => {
      const caseItem: SupportCase = {
        name: "projects/test/cases/999",
        displayName: "Data corruption",
        description: "Details about corruption...",
        priority: "P0",
        state: "IN_PROGRESS_GOOGLE_SUPPORT",
        classification: { id: "DB-1" },
        createTime: "2024-01-03T00:00:00Z",
        updateTime: "2024-01-03T08:00:00Z",
        timeZone: "America/Los_Angeles",
        languageCode: "en-US",
        contactEmail: "owner@example.com",
        subscriberEmailAddresses: ["observer@example.com"],
        escalated: true,
        testCase: true,
        creator: {
          displayName: "Alice Analyst",
          email: "alice@example.com",
          username: "alice",
          googleSupport: true,
        },
      };

      const details = formatCaseDetails(caseItem);

      expect(details).toContain("# Support Case Details");
      expect(details).toContain("**Name:** projects/test/cases/999");
      expect(details).toContain("**Title:** Data corruption");
      expect(details).toContain("**Priority:** P0");
      expect(details).toContain("**State:** IN_PROGRESS_GOOGLE_SUPPORT");
      expect(details).toContain("**Classification:** DB-1 (DB-1)");
      expect(details).toContain("Details about corruption");
      expect(details).toContain("## Metadata");
      expect(details).toContain("- Created: 2024-01-03T00:00:00Z");
      expect(details).toContain("- Updated: 2024-01-03T08:00:00Z");
      expect(details).toContain("- Time Zone: America/Los_Angeles");
      expect(details).toContain("- Language: en-US");
      expect(details).toContain("- Contact Email: owner@example.com");
      expect(details).toContain("- Subscribers: observer@example.com");
      expect(details).toContain("- Creator: Alice Analyst <alice@example.com> alice (Google Support)");
      expect(details).toContain("- Status: 🚨 Escalated");
      expect(details).toContain("- Status: 🧪 Test case");
    });
  });

  describe("formatComments", () => {
    it("returns a placeholder when there are no comments", () => {
      expect(formatComments([])).toBe("No comments found for this case.");
    });

    it("formats author, timestamps, and falls back to plain text content", () => {
      const comments: CaseComment[] = [
        {
          createTime: "2024-02-01T00:00:00Z",
          creator: { displayName: "Bob", email: "bob@example.com", googleSupport: true },
          body: "<p>HTML body</p>",
        },
        {
          plainTextBody: "Plain only",
        },
      ];

      const output = formatComments(comments);
      expect(output).toContain("### Comment 1");
      expect(output).toContain("**Author:** Bob <bob@example.com> (Google Support)");
      expect(output).toContain("**Created:** 2024-02-01T00:00:00Z");
      expect(output).toContain("<p>HTML body</p>");
      expect(output).toContain("Plain only");
    });
  });

  describe("formatAttachments", () => {
    it("returns a placeholder when attachments array is empty", () => {
      expect(formatAttachments([])).toBe("No attachments found for this case.");
    });

    it("includes attachment metadata in order", () => {
      const attachments: CaseAttachment[] = [
        {
          name: "projects/test/cases/123/attachments/1",
          filename: "stacktrace.log",
          mimeType: "text/plain",
          sizeBytes: "2048",
          createTime: "2024-02-10T00:00:00Z",
          creator: { displayName: "Carol" },
        },
      ];

      const output = formatAttachments(attachments);
      expect(output).toContain("### Attachment 1: stacktrace.log");
      expect(output).toContain("**Name:** projects/test/cases/123/attachments/1");
      expect(output).toContain("**MIME Type:** text/plain");
      expect(output).toContain("**Size:** 2048 bytes");
      expect(output).toContain("**Uploaded:** 2024-02-10T00:00:00Z");
      expect(output).toContain("**Uploader:** Carol");
    });
  });

  describe("formatClassifications", () => {
    it("returns a placeholder when no classifications match", () => {
      expect(formatClassifications([])).toBe("No case classifications matched the query.");
    });

    it("lists each classification with numbering and optional IDs", () => {
      const classifications: CaseClassification[] = [
        { id: "IAM", displayName: "Identity and Access" },
        { id: "NETWORK" },
      ];

      const output = formatClassifications(classifications);
      expect(output).toContain("### 1. Identity and Access");
      expect(output).toContain("**ID:** IAM");
      expect(output).toContain("### 2. NETWORK");
      expect(output).not.toContain("**ID:** NETWORK");
    });
  });

  describe("buildSupportErrorMessage", () => {
    it("creates a markdown block with the provided context", () => {
      expect(buildSupportErrorMessage("Failed to list", "permission denied")).toBe(
        "# Google Cloud Support Error\n\nFailed to list\n\n- **Details:** permission denied",
      );
    });
  });
});
