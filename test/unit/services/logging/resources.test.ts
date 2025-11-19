import { URL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockLogEntries,
  createMockMcpServer,
} from "../../../utils/test-helpers.js";

const mockGetProjectId = vi.fn<[], Promise<string>>();
const mockCanViewFullLogPayloads = vi.fn<[], boolean>();
const mockBuildRedactionNotice = vi.fn<[boolean], string>();
const mockBuildLogResponseText = vi.fn<[Record<string, unknown>], string>();

let loggingClient: { getEntries: ReturnType<typeof vi.fn> };
const mockGetLoggingClient = vi.fn(() => loggingClient);

vi.mock("../../../../src/utils/auth.js", () => ({
  getProjectId: mockGetProjectId,
}));

vi.mock("../../../../src/services/logging/types.js", () => ({
  getLoggingClient: mockGetLoggingClient,
}));

vi.mock("../../../../src/services/logging/policy.js", () => ({
  canViewFullLogPayloads: mockCanViewFullLogPayloads,
  buildRedactionNotice: mockBuildRedactionNotice,
}));

vi.mock("../../../../src/services/logging/output.js", () => ({
  buildLogResponseText: mockBuildLogResponseText,
}));

const importResourcesModule = () =>
  import("../../../../src/services/logging/resources.js");

const getResourceHandler = (
  server: ReturnType<typeof createMockMcpServer>,
  id: string,
) => {
  const call = server.resource.mock.calls.find(([resourceId]) => resourceId === id);
  if (!call) {
    throw new Error(`Resource ${id} was not registered`);
  }
  return call[2] as (uri: URL, params?: Record<string, unknown>) => Promise<any>;
};

describe("logging resources", () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    loggingClient = { getEntries: vi.fn() };
    mockGetLoggingClient.mockReturnValue(loggingClient);
    mockBuildLogResponseText.mockReturnValue("rendered logs");
    mockBuildRedactionNotice.mockReturnValue("redaction policy");
    mockCanViewFullLogPayloads.mockReturnValue(true);
    server = createMockMcpServer();
  });

  afterEach(() => {
    delete process.env.LOG_FILTER;
  });

  it("fetches recent logs with the default filter", async () => {
    const entries = createMockLogEntries(2);
    process.env.LOG_FILTER = "severity>=ERROR";
    mockGetProjectId.mockResolvedValue("runtime-project");
    loggingClient.getEntries.mockResolvedValue([entries]);

    const { registerLoggingResources } = await importResourcesModule();
    registerLoggingResources(server as any);

    expect(server.resource).toHaveBeenCalledWith(
      "gcp-logging-recent-logs",
      expect.anything(),
      expect.any(Function),
    );

    const handler = getResourceHandler(server, "gcp-logging-recent-logs");
    const response = await handler(new URL("gcp-logs://runtime-project/recent"), {});

    expect(mockGetProjectId).toHaveBeenCalledTimes(1);
    expect(mockGetLoggingClient).toHaveBeenCalledTimes(1);
    expect(loggingClient.getEntries).toHaveBeenCalledWith({
      pageSize: 50,
      filter: "severity>=ERROR",
    });
    expect(mockBuildRedactionNotice).toHaveBeenCalledWith(true);
    expect(mockBuildLogResponseText).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Recent Logs",
        metadata: expect.objectContaining({
          projectId: "runtime-project",
          defaultFilter: "severity>=ERROR",
        }),
        entries,
        allowFullPayload: true,
        footnote: "redaction policy",
      }),
    );
    expect(response).toEqual({
      contents: [
        {
          uri: "gcp-logs://runtime-project/recent",
          text: "rendered logs",
        },
      ],
    });
  });

  it("returns an empty-state message when no recent entries exist", async () => {
    mockGetProjectId.mockResolvedValue("project-without-logs");
    loggingClient.getEntries.mockResolvedValue([[]]);

    const { registerLoggingResources } = await importResourcesModule();
    registerLoggingResources(server as any);

    const handler = getResourceHandler(server, "gcp-logging-recent-logs");
    const response = await handler(
      new URL("gcp-logs://project-without-logs/recent"),
      {},
    );

    expect(response).toEqual({
      contents: [
        {
          uri: "gcp-logs://project-without-logs/recent",
          text: "No log entries found.",
        },
      ],
    });
  });

  it("returns a friendly error message when the recent logs call fails", async () => {
    mockGetProjectId.mockResolvedValue("broken-project");
    loggingClient.getEntries.mockRejectedValue(new Error("permission denied"));

    const { registerLoggingResources } = await importResourcesModule();
    registerLoggingResources(server as any);

    const handler = getResourceHandler(server, "gcp-logging-recent-logs");
    const response = await handler(
      new URL("gcp-logs://broken-project/recent"),
      {},
    );

    expect(response.contents[0]?.text).toContain("# Error Fetching Recent Logs");
    expect(response.contents[0]?.text).toContain("permission denied");
  });

  it("decodes filters and renders filtered log output", async () => {
    const entries = createMockLogEntries(1);
    loggingClient.getEntries.mockResolvedValue([entries]);
    mockCanViewFullLogPayloads.mockReturnValue(false);
    mockBuildRedactionNotice.mockReturnValue("payload redacted");

    const { registerLoggingResources } = await importResourcesModule();
    registerLoggingResources(server as any);

    const handler = getResourceHandler(server, "gcp-logging-filtered-logs");
    const response = await handler(
      new URL("gcp-logs://explicit/filter/%7Bfilter%7D"),
      {
        projectId: "explicit",
        filter: encodeURIComponent('resource.type="gce_instance"'),
      },
    );

    expect(mockGetProjectId).not.toHaveBeenCalled();
    expect(loggingClient.getEntries).toHaveBeenCalledWith({
      pageSize: 50,
      filter: 'resource.type="gce_instance"',
    });
    expect(mockBuildLogResponseText).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Filtered Logs",
        metadata: expect.objectContaining({
          projectId: "explicit",
          filter: 'resource.type="gce_instance"',
        }),
        entries,
        allowFullPayload: false,
        footnote: "payload redacted",
      }),
    );
    expect(response.contents[0]).toEqual({
      uri: "gcp-logs://explicit/filter/%7Bfilter%7D",
      text: "rendered logs",
    });
  });

  it("explains when no filtered entries match", async () => {
    loggingClient.getEntries.mockResolvedValue([[]]);
    const { registerLoggingResources } = await importResourcesModule();
    registerLoggingResources(server as any);

    const handler = getResourceHandler(server, "gcp-logging-filtered-logs");
    const response = await handler(new URL("gcp-logs://p/filter/some"), {
      filter: "severity>=ERROR",
    });

    expect(response.contents[0]?.text).toContain(
      "No log entries found matching filter: severity>=ERROR",
    );
  });

  it("returns a descriptive message when filtered log retrieval fails", async () => {
    loggingClient.getEntries.mockRejectedValue(new Error("quota exceeded"));
    const { registerLoggingResources } = await importResourcesModule();
    registerLoggingResources(server as any);

    const handler = getResourceHandler(server, "gcp-logging-filtered-logs");
    const response = await handler(new URL("gcp-logs://p/filter/some"), {
      filter: "severity>=ERROR",
    });

    expect(response.contents[0]?.text).toContain(
      "# Error Fetching Filtered Logs",
    );
    expect(response.contents[0]?.text).toContain("quota exceeded");
  });
});
