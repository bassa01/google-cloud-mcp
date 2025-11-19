import { URL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockMcpServer } from "../../../utils/test-helpers.js";
import { GcpMcpError } from "../../../../src/utils/error.js";

const mockGetProjectId = vi.fn<[], Promise<string | undefined>>();
const mockInitGoogleAuth = vi.fn();
const mockBuildTraceHierarchy = vi.fn();
const mockFormatTraceData = vi.fn();

const mockLoggingClient = { getEntries: vi.fn() };
const mockLoggingConstructor = vi.fn(function MockLogging() {
  return mockLoggingClient;
});

vi.mock("../../../../src/utils/auth.js", () => ({
  getProjectId: mockGetProjectId,
  initGoogleAuth: mockInitGoogleAuth,
}));

vi.mock("../../../../src/services/trace/types.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/trace/types.js")
  >("../../../../src/services/trace/types.js");
  return {
    ...actual,
    buildTraceHierarchy: mockBuildTraceHierarchy,
    formatTraceData: mockFormatTraceData,
  };
});

vi.mock("../../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@google-cloud/logging", () => ({
  Logging: mockLoggingConstructor,
}));

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

const buildAuthStub = () => {
  const accessTokenMock = vi.fn().mockResolvedValue({ token: "stub-token" });
  const client = { getAccessToken: accessTokenMock };
  return {
    getClient: vi.fn().mockResolvedValue(client),
  };
};

const importResourcesModule = () =>
  import("../../../../src/services/trace/resources.js");

describe("trace resources", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = fetchMock as typeof fetch;
    fetchMock.mockReset();
    mockGetProjectId.mockReset();
    mockInitGoogleAuth.mockReset();
    mockBuildTraceHierarchy.mockReset();
    mockFormatTraceData.mockReset();
    mockLoggingConstructor.mockClear();
    mockLoggingClient.getEntries.mockReset();
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  const getResourceHandler = (
    server: ReturnType<typeof createMockMcpServer>,
    resourceId: string,
  ) => {
    const call = server.resource.mock.calls.find(
      ([registeredId]) => registeredId === resourceId,
    );
    if (!call) {
      throw new Error(`Resource ${resourceId} was not registered`);
    }
    return call[2] as (
      uri: URL,
      params?: Record<string, string | string[]>,
    ) => Promise<any>;
  };

  it("registers the trace resources and renders formatted traces", async () => {
    const mockServer = createMockMcpServer();
    const authStub = buildAuthStub();
    mockInitGoogleAuth.mockResolvedValue(authStub);
    mockGetProjectId.mockResolvedValue("derived-project");
    mockBuildTraceHierarchy.mockReturnValue({
      traceId: "deadbeef",
      projectId: "derived-project",
      rootSpans: [],
      allSpans: [],
    });
    mockFormatTraceData.mockReturnValue("formatted-trace-body");

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        spans: [
          {
            spanId: "1",
            name: "root",
            startTime: "2024-01-01T00:00:00Z",
            endTime: "2024-01-01T00:00:01Z",
          },
        ],
      }),
    } as any);

    const { registerTraceResources } = await importResourcesModule();
    registerTraceResources(mockServer as any);

    expect(mockServer.resource).toHaveBeenCalledTimes(3);
    const handler = getResourceHandler(mockServer, "gcp-trace-get-by-id");

    const response = await handler(new URL("gcp-trace://trace"), {
      traceId: "deadbeef",
    });

    expect(mockGetProjectId).toHaveBeenCalled();
    expect(mockBuildTraceHierarchy).toHaveBeenCalledWith(
      "derived-project",
      "deadbeef",
      expect.arrayContaining([
        expect.objectContaining({ spanId: "1" }),
      ]),
    );
    expect(mockFormatTraceData).toHaveBeenCalledWith({
      traceId: "deadbeef",
      projectId: "derived-project",
      rootSpans: [],
      allSpans: [],
    });
    expect(response.contents[0]?.text).toContain("formatted-trace-body");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloudtrace.googleapis.com/v1/projects/derived-project/traces/deadbeef",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects invalid trace identifiers", async () => {
    const mockServer = createMockMcpServer();
    mockInitGoogleAuth.mockResolvedValue(buildAuthStub());
    mockGetProjectId.mockResolvedValue("proj");

    const { registerTraceResources } = await importResourcesModule();
    registerTraceResources(mockServer as any);

    const handler = getResourceHandler(mockServer, "gcp-trace-get-by-id");

    await expect(
      handler(new URL("gcp-trace://trace"), { traceId: "not hex" }),
    ).rejects.toMatchObject<Partial<GcpMcpError>>({
      code: "INVALID_ARGUMENT",
      statusCode: 400,
    });
  });

  it("returns a friendly message when no spans exist", async () => {
    const mockServer = createMockMcpServer();
    mockInitGoogleAuth.mockResolvedValue(buildAuthStub());
    mockGetProjectId.mockResolvedValue("proj");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ spans: [] }),
    } as any);

    const { registerTraceResources } = await importResourcesModule();
    registerTraceResources(mockServer as any);

    const handler = getResourceHandler(mockServer, "gcp-trace-get-by-id");
    const response = await handler(new URL("gcp-trace://trace"), {
      traceId: "abc123",
    });

    expect(response.contents[0]?.text).toContain("No trace found");
  });

  it("exposes logs associated with a trace", async () => {
    const mockServer = createMockMcpServer();
    mockGetProjectId.mockResolvedValue("logs-project");
    mockLoggingClient.getEntries.mockResolvedValue([
      [
        {
          timestamp: "2024-01-01T00:00:00.000Z",
          severity: "ERROR",
          textPayload: "Trace failed",
          resource: { type: "gce_instance", labels: { zone: "us-central1-a" } },
          labels: { "logging.googleapis.com/trace_id": "trace-1" },
        },
      ],
    ]);

    const { registerTraceResources } = await importResourcesModule();
    registerTraceResources(mockServer as any);

    const handler = getResourceHandler(mockServer, "gcp-trace-related-logs");
    const response = await handler(new URL("gcp-trace://trace/logs"), {
      traceId: "deadbeef",
    });

    expect(mockLoggingConstructor).toHaveBeenCalledWith({ projectId: "logs-project" });
    expect(mockLoggingClient.getEntries).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50 }),
    );
    expect(response.contents[0]?.text).toContain("Logs for Trace: deadbeef");
    expect(response.contents[0]?.text).toContain("Trace failed");
  });

  it("lists recent failed traces", async () => {
    const mockServer = createMockMcpServer();
    mockInitGoogleAuth.mockResolvedValue(buildAuthStub());
    mockGetProjectId.mockResolvedValue("failed-project");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        traces: [
          {
            traceId: "deadbeef",
            displayName: "Checkout",
            startTime: "2024-01-01T00:00:00.000Z",
            endTime: "2024-01-01T00:00:01.500Z",
            status: { message: "Deadline exceeded" },
          },
        ],
      }),
    } as any);

    const { registerTraceResources } = await importResourcesModule();
    registerTraceResources(mockServer as any);

    const handler = getResourceHandler(mockServer, "gcp-trace-recent-failed");
    const response = await handler(new URL("gcp-trace://recent"), {});

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://cloudtrace.googleapis.com/v1/projects/failed-project/traces",
      ),
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.contents[0]?.text).toContain("Recent Failed Traces");
    expect(response.contents[0]?.text).toContain("Checkout");
    expect(response.contents[0]?.text).toContain("Deadline exceeded");
  });
});
