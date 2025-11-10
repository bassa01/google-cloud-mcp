/**
 * Google Cloud Support tools for MCP
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectId } from "../../utils/auth.js";
import { GcpMcpError } from "../../utils/error.js";
import {
  buildSupportErrorMessage,
  CaseComment,
  formatAttachments,
  formatCaseDetails,
  formatCaseSummary,
  formatClassifications,
  formatComments,
  ListAttachmentsResponse,
  ListCasesResponse,
  ListCommentsResponse,
  SearchCaseClassificationsResponse,
  SearchCasesResponse,
  SupportCase,
} from "./types.js";
import { supportApiClient } from "./client.js";

const PARENT_PATTERN = /^(projects|organizations)\/[^/]+$/;
const CASE_NAME_PATTERN = /^projects\/[^/]+\/cases\/[^/]+$/;

function handleSupportError(context: string, error: unknown) {
  const message =
    error instanceof GcpMcpError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);

  return {
    content: [
      {
        type: "text" as const,
        text: buildSupportErrorMessage(context, message),
      },
    ],
    isError: true,
  };
}

function validateParent(parent: string) {
  if (!PARENT_PATTERN.test(parent)) {
    throw new GcpMcpError(
      "Parent must be formatted as projects/{projectId} or organizations/{organizationId}.",
      "INVALID_ARGUMENT",
      400,
    );
  }
}

function validateCaseName(name: string) {
  if (!CASE_NAME_PATTERN.test(name)) {
    throw new GcpMcpError(
      "Case name must match projects/{projectId}/cases/{caseId}.",
      "INVALID_ARGUMENT",
      400,
    );
  }
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.entries(value).reduce((acc, [key, val]) => {
    if (val !== undefined && val !== null && val !== "") {
      (acc as Record<string, unknown>)[key] = val;
    }
    return acc;
  }, {} as T);
}

function buildUpdateMask(fields: Record<string, unknown>): string {
  return Object.keys(fields)
    .filter((key) => fields[key] !== undefined)
    .join(",");
}

function resolveBillingProject(parent: string | undefined, defaultProjectId: string): string {
  if (!parent) {
    return defaultProjectId;
  }

  if (parent.startsWith("projects/")) {
    const [, projectId] = parent.split("/");
    return projectId || defaultProjectId;
  }

  return defaultProjectId;
}

export function registerSupportTools(server: McpServer): void {
  server.registerTool(
    "gcp-support-list-cases",
    {
      title: "List Support Cases",
      description: "List Google Cloud Support cases for a project or organization.",
      inputSchema: {
        parent: z
          .string()
          .optional()
          .describe("Parent resource. Defaults to the active project (projects/{projectId})."),
        pageSize: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum number of cases to return."),
        pageToken: z.string().optional().describe("Token for pagination."),
        filter: z
          .string()
          .optional()
          .describe("Optional filter, e.g. state=OPEN AND priority=P1."),
      },
    },
    async ({ parent, pageSize, pageToken, filter }) => {
      try {
        const defaultProjectId = await getProjectId();
        if (parent) {
          validateParent(parent);
        }
        const billingProject = resolveBillingProject(parent, defaultProjectId);
        const resolvedParent = parent ?? `projects/${defaultProjectId}`;

        const response = await supportApiClient.get<ListCasesResponse>(
          `/${resolvedParent}/cases`,
          cleanObject({
            pageSize,
            pageToken,
            filter,
          }),
          billingProject,
        );

        const cases = response.cases ?? [];
        const body = cases
          .map((item, index) => formatCaseSummary(item, index + 1))
          .join("\n\n");

        const paginationInfo = response.nextPageToken
          ? `\n\nNext page token: ${response.nextPageToken}`
          : "";

        const text =
          `# Support Cases\n\nParent: ${resolvedParent}\nReturned: ${cases.length}${
            filter ? `\nFilter: ${filter}` : ""
          }${paginationInfo}\n\n${cases.length ? body : "No support cases were found."}`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError("Failed to list support cases.", error);
      }
    },
  );

  server.registerTool(
    "gcp-support-search-cases",
    {
      title: "Search Support Cases",
      description: "Search Google Cloud Support cases using the Support API search endpoint.",
      inputSchema: {
        parent: z
          .string()
          .optional()
          .describe("Parent resource. Defaults to the active project."),
        query: z
          .string()
          .describe(
            "Free text search query. Supports field-specific filters such as " +
              '"displayName:upgrade" or "state=NEW".',
          ),
        pageSize: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum number of cases to return."),
        pageToken: z.string().optional().describe("Token for pagination."),
      },
    },
    async ({ parent, query, pageSize, pageToken }) => {
      try {
        const defaultProjectId = await getProjectId();
        if (parent) {
          validateParent(parent);
        }
        const billingProject = resolveBillingProject(parent, defaultProjectId);
        const resolvedParent = parent ?? `projects/${defaultProjectId}`;

        const response = await supportApiClient.post<SearchCasesResponse>(
          `/${resolvedParent}/cases:search`,
          cleanObject({
            query,
            pageSize,
            pageToken,
          }),
          undefined,
          billingProject,
        );

        const cases = response.cases ?? [];
        const body = cases
          .map((item, index) => formatCaseSummary(item, index + 1))
          .join("\n\n");

        const paginationInfo = response.nextPageToken
          ? `\n\nNext page token: ${response.nextPageToken}`
          : "";

        const text =
          `# Support Case Search\n\nParent: ${resolvedParent}\nQuery: ${query}\nReturned: ${cases.length}${
            paginationInfo
          }\n\n${cases.length ? body : "No support cases matched the query."}`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError("Failed to search support cases.", error);
      }
    },
  );

  server.registerTool(
    "gcp-support-get-case",
    {
      title: "Get Support Case",
      description: "Retrieve full details for a specific Google Cloud Support case.",
      inputSchema: {
        name: z
          .string()
          .describe("Case resource name, e.g. projects/{projectId}/cases/{caseId}."),
      },
    },
    async ({ name }) => {
      try {
        validateCaseName(name);
        const defaultProjectId = await getProjectId();
        const billingProject = resolveBillingProject(name.split("/cases")[0], defaultProjectId);

        const supportCase = await supportApiClient.get<SupportCase>(
          `/${name}`,
          undefined,
          billingProject,
        );

        if (!supportCase) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No data was returned for case ${name}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formatCaseDetails(supportCase),
            },
          ],
        };
      } catch (error) {
        return handleSupportError(`Failed to retrieve support case ${name}.`, error);
      }
    },
  );

  server.registerTool(
    "gcp-support-create-case",
    {
      title: "Create Support Case",
      description: "Create a new Google Cloud Support case.",
      inputSchema: {
        parent: z
          .string()
          .optional()
          .describe("Parent resource. Defaults to the active project."),
        displayName: z.string().min(4).describe("Short title for the case."),
        description: z.string().min(10).describe("Detailed description of the issue."),
        classificationId: z
          .string()
          .describe("Classification ID (use the search classifications tool to discover IDs)."),
        priority: z
          .enum(["P0", "P1", "P2", "P3", "P4", "PRIORITY_UNSPECIFIED"])
          .default("P3"),
        timeZone: z.string().optional().describe("Time zone in IANA format."),
        languageCode: z.string().optional().describe("Preferred language in BCP-47 format."),
        contactEmail: z.string().email().optional().describe("Contact email for the case."),
        subscriberEmailAddresses: z
          .array(z.string().email())
          .optional()
          .describe("Additional email addresses to receive updates."),
      },
    },
    async ({
      parent,
      displayName,
      description,
      classificationId,
      priority,
      timeZone,
      languageCode,
      contactEmail,
      subscriberEmailAddresses,
    }) => {
      try {
        const defaultProjectId = await getProjectId();
        if (parent) {
          validateParent(parent);
        }
        const billingProject = resolveBillingProject(parent, defaultProjectId);
        const resolvedParent = parent ?? `projects/${defaultProjectId}`;

        const requestBody = {
          case: cleanObject({
            displayName,
            description,
            priority,
            timeZone,
            languageCode,
            contactEmail,
            subscriberEmailAddresses,
            classification: { id: classificationId },
          }),
        };

        const createdCase = await supportApiClient.post<SupportCase>(
          `/${resolvedParent}/cases`,
          requestBody,
          undefined,
          billingProject,
        );

        const text =
          formatCaseDetails(createdCase) +
          `\n\n✅ Support case created successfully in ${resolvedParent}.`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError("Failed to create support case.", error);
      }
    },
  );

  server.registerTool(
    "gcp-support-update-case",
    {
      title: "Update Support Case",
      description: "Update fields on an existing Google Cloud Support case.",
      inputSchema: {
        name: z
          .string()
          .describe("Case resource name, e.g. projects/{projectId}/cases/{caseId}."),
        displayName: z.string().optional(),
        description: z.string().optional(),
        classificationId: z.string().optional(),
        priority: z.enum(["P0", "P1", "P2", "P3", "P4", "PRIORITY_UNSPECIFIED"]).optional(),
        contactEmail: z.string().email().optional(),
        subscriberEmailAddresses: z.array(z.string().email()).optional(),
        languageCode: z.string().optional(),
        timeZone: z.string().optional(),
      },
    },
    async ({
      name,
      displayName,
      description,
      classificationId,
      priority,
      contactEmail,
      subscriberEmailAddresses,
      languageCode,
      timeZone,
    }) => {
      try {
        validateCaseName(name);
        const defaultProjectId = await getProjectId();
        const billingProject = resolveBillingProject(name.split("/cases")[0], defaultProjectId);

        const updatedFields = cleanObject({
          displayName,
          description,
          priority,
          contactEmail,
          subscriberEmailAddresses,
          languageCode,
          timeZone,
          classification: classificationId ? { id: classificationId } : undefined,
        });

        if (Object.keys(updatedFields).length === 0) {
          throw new GcpMcpError(
            "No update fields were provided.",
            "INVALID_ARGUMENT",
            400,
          );
        }

        const updateMask = buildUpdateMask({
          displayName,
          description,
          priority,
          contactEmail,
          subscriberEmailAddresses,
          languageCode,
          timeZone,
          classification: classificationId ? { id: classificationId } : undefined,
        });

        const updatedCase = await supportApiClient.patch<SupportCase>(
          `/${name}`,
          { case: updatedFields },
          cleanObject({ updateMask }),
          billingProject,
        );

        const text =
          formatCaseDetails(updatedCase) +
          `\n\n✅ Support case ${name} updated successfully.`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError(`Failed to update support case ${name}.`, error);
      }
    },
  );

  server.registerTool(
    "gcp-support-close-case",
    {
      title: "Close Support Case",
      description: "Close an existing Google Cloud Support case.",
      inputSchema: {
        name: z
          .string()
          .describe("Case resource name, e.g. projects/{projectId}/cases/{caseId}."),
        justification: z
          .string()
          .optional()
          .describe("Optional justification or summary of the resolution."),
      },
    },
    async ({ name, justification }) => {
      try {
        validateCaseName(name);
        const defaultProjectId = await getProjectId();
        const billingProject = resolveBillingProject(name.split("/cases")[0], defaultProjectId);

        const response = await supportApiClient.post<SupportCase>(
          `/${name}:close`,
          justification ? { justification } : {},
          undefined,
          billingProject,
        );

        const text =
          formatCaseDetails(response) +
          `\n\n✅ Support case ${name} closed.${
            justification ? `\nJustification: ${justification}` : ""
          }`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError(`Failed to close support case ${name}.`, error);
      }
    },
  );

  server.registerTool(
    "gcp-support-list-comments",
    {
      title: "List Support Case Comments",
      description: "List comments attached to a Google Cloud Support case.",
      inputSchema: {
        name: z
          .string()
          .describe("Case resource name, e.g. projects/{projectId}/cases/{caseId}."),
        pageSize: z.number().min(1).max(100).default(20).describe("Maximum number of comments to return."),
        pageToken: z.string().optional().describe("Token for pagination."),
      },
    },
    async ({ name, pageSize, pageToken }) => {
      try {
        validateCaseName(name);
        const defaultProjectId = await getProjectId();
        const billingProject = resolveBillingProject(name.split("/cases")[0], defaultProjectId);

        const response = await supportApiClient.get<ListCommentsResponse>(
          `/${name}/comments`,
          cleanObject({ pageSize, pageToken }),
          billingProject,
        );

        const comments = response.comments ?? [];
        const paginationInfo = response.nextPageToken
          ? `\n\nNext page token: ${response.nextPageToken}`
          : "";

        const text =
          `# Support Case Comments\n\nCase: ${name}\nReturned: ${comments.length}${paginationInfo}\n\n${formatComments(
            comments,
          )}`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError(`Failed to list comments for case ${name}.`, error);
      }
    },
  );

  server.registerTool(
    "gcp-support-create-comment",
    {
      title: "Create Support Case Comment",
      description: "Add a comment to a Google Cloud Support case.",
      inputSchema: {
        name: z
          .string()
          .describe("Case resource name, e.g. projects/{projectId}/cases/{caseId}."),
        body: z.string().min(1).describe("Comment body."),
      },
    },
    async ({ name, body }) => {
      try {
        validateCaseName(name);
        const defaultProjectId = await getProjectId();
        const billingProject = resolveBillingProject(name.split("/cases")[0], defaultProjectId);

        const createdComment = await supportApiClient.post<CaseComment>(
          `/${name}/comments`,
          { comment: { body } },
          undefined,
          billingProject,
        );

        const text =
          `✅ Comment added to ${name}.\n\n${formatComments([createdComment])}`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError(`Failed to create comment for case ${name}.`, error);
      }
    },
  );

  server.registerTool(
    "gcp-support-list-attachments",
    {
      title: "List Support Case Attachments",
      description: "List file attachments associated with a Google Cloud Support case.",
      inputSchema: {
        name: z
          .string()
          .describe("Case resource name, e.g. projects/{projectId}/cases/{caseId}."),
        pageSize: z.number().min(1).max(100).default(20),
        pageToken: z.string().optional(),
      },
    },
    async ({ name, pageSize, pageToken }) => {
      try {
        validateCaseName(name);
        const defaultProjectId = await getProjectId();
        const billingProject = resolveBillingProject(name.split("/cases")[0], defaultProjectId);

        const response = await supportApiClient.get<ListAttachmentsResponse>(
          `/${name}/attachments`,
          cleanObject({ pageSize, pageToken }),
          billingProject,
        );

        const attachments = response.attachments ?? [];
        const paginationInfo = response.nextPageToken
          ? `\n\nNext page token: ${response.nextPageToken}`
          : "";

        const text =
          `# Support Case Attachments\n\nCase: ${name}\nReturned: ${attachments.length}${
            paginationInfo
          }\n\n${formatAttachments(attachments)}`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError(`Failed to list attachments for case ${name}.`, error);
      }
    },
  );

  server.registerTool(
    "gcp-support-search-classifications",
    {
      title: "Search Case Classifications",
      description:
        "Search support case classifications to help populate new case requests.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Classification search query. Examples: 'id:" +
              '"100445" or displayName:"service account".',
          ),
        pageSize: z.number().min(1).max(100).default(20),
        pageToken: z.string().optional(),
      },
    },
    async ({ query, pageSize, pageToken }) => {
      try {
        const projectId = await getProjectId();
        const response = await supportApiClient.get<SearchCaseClassificationsResponse>(
          `/caseClassifications:search`,
          cleanObject({ query, pageSize, pageToken }),
          projectId,
        );

        const classifications = response.caseClassifications ?? [];
        const paginationInfo = response.nextPageToken
          ? `\n\nNext page token: ${response.nextPageToken}`
          : "";

        const text =
          `# Case Classifications\n\nQuery: ${query}\nReturned: ${classifications.length}${
            paginationInfo
          }\n\n${formatClassifications(classifications)}`;

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
        };
      } catch (error) {
        return handleSupportError("Failed to search case classifications.", error);
      }
    },
  );
}
