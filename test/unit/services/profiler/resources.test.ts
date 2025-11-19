import { URL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GcpMcpError } from "../../../../src/utils/error.js";
import type { Profile } from "../../../../src/services/profiler/types.js";
import { createMockMcpServer } from "../../../utils/test-helpers.js";

const mockInitGoogleAuth = vi.fn();
const mockGetProjectId = vi.fn();

vi.mock("../../../../src/utils/auth.js", () => ({
  initGoogleAuth: mockInitGoogleAuth,
  getProjectId: mockGetProjectId,
}));

const mockAnalyseProfilePatterns = vi.fn();
const mockFormatProfileSummary = vi.fn();
const mockGetProfileTypeDescription = vi.fn();

vi.mock("../../../../src/services/profiler/types.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/profiler/types.js")
  >("../../../../src/services/profiler/types.js");
  return {
    ...actual,
    analyseProfilePatterns: mockAnalyseProfilePatterns,
    formatProfileSummary: mockFormatProfileSummary,
    getProfileTypeDescription: mockGetProfileTypeDescription,
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

type ResourceHandler = (
  uri: URL,
  params?: Record<string, unknown>,
) => Promise<unknown>;

describe("registerProfilerResources", () => {
  const createProfile = (
    suffix: string,
    type: Profile["profileType"],
    overrides: Partial<Profile> = {},
  ): Profile => {
    const base: Profile = {
      name: `projects/test-project/profiles/${suffix}`,
      profileType: type,
      deployment: {
        projectId: "test-project",
        target: "test-service",
        labels: { version: "1.0.0" },
      },
      duration: "PT60S",
      profileBytes: "encoded-data",
      labels: { language: "node" },
      startTime: "2024-03-01T00:00:00.000Z",
    };

    return {
      ...base,
      ...overrides,
      deployment: {
        ...base.deployment,
        ...(overrides.deployment ?? {}),
      },
      labels: {
        ...base.labels,
        ...(overrides.labels ?? {}),
      },
    };
  };

  const defaultProfiles: Profile[] = [
    createProfile("cpu-1", "CPU" as Profile["profileType"]),
    createProfile("heap-1", "HEAP" as Profile["profileType"]),
    createProfile("heap-alloc", "HEAP_ALLOC" as Profile["profileType"]),
    createProfile("peak-heap", "PEAK_HEAP" as Profile["profileType"]),
    createProfile("wall-1", "WALL" as Profile["profileType"]),
  ];

  const buildFetchResponse = (
    data: Partial<{
      profiles: Profile[];
      nextPageToken?: string;
      skippedProfiles?: number;
    }> = {},
  ) => {
    const payload = {
      profiles: data.profiles ?? defaultProfiles,
      nextPageToken: data.nextPageToken,
      skippedProfiles: data.skippedProfiles,
    };
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    } as const;
  };

  const buildMockAuth = () => {
    const mockAccessToken = vi.fn().mockResolvedValue({ token: "mock-token" });
    const mockClient = {
      getAccessToken: mockAccessToken,
    };
    return {
      mockClient,
      mockAuth: {
        getClient: vi.fn().mockResolvedValue(mockClient),
      },
    };
  };

  let mockServer: ReturnType<typeof createMockMcpServer>;
  let handlers: Record<string, ResourceHandler>;

  const loadModule = () =>
    import("../../../../src/services/profiler/resources.js");

  const captureHandlers = () => {
    handlers = mockServer.resource.mock.calls.reduce<Record<string, ResourceHandler>>(
      (acc, [resourceId, , handler]) => ({
        ...acc,
        [resourceId]: handler as ResourceHandler,
      }),
      {},
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const { mockAuth } = buildMockAuth();
    mockInitGoogleAuth.mockResolvedValue(mockAuth);
    mockGetProjectId.mockResolvedValue("derived-project");
    mockAnalyseProfilePatterns.mockImplementation((profiles: Profile[]) =>
      `analysis:${profiles.map((p) => p.name).join(",")}`,
    );
    mockFormatProfileSummary.mockImplementation(
      (profile: Profile) => `summary:${profile.name}`,
    );
    mockGetProfileTypeDescription.mockImplementation(
      (type: string) => `description:${type}`,
    );
    mockFetch.mockResolvedValue(buildFetchResponse());

    mockServer = createMockMcpServer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const getHandler = (resourceId: string): ResourceHandler => {
    const handler = handlers[resourceId];
    if (!handler) {
      throw new Error(`Resource ${resourceId} not registered`);
    }
    return handler;
  };

  it("registers four profiler resources", async () => {
    const { registerProfilerResources } = await loadModule();

    registerProfilerResources(mockServer as any);
    captureHandlers();

    expect(mockServer.resource).toHaveBeenCalledTimes(4);
    expect(handlers).toHaveProperty("gcp-profiler-all-profiles");
    expect(handlers).toHaveProperty("gcp-profiler-cpu-profiles");
    expect(handlers).toHaveProperty("gcp-profiler-memory-profiles");
    expect(handlers).toHaveProperty(
      "gcp-profiler-performance-recommendations",
    );
  });

  it("fetches and renders comprehensive profile listings", async () => {
    mockFetch.mockResolvedValue(
      buildFetchResponse({
        profiles: defaultProfiles,
        nextPageToken: "next",
        skippedProfiles: 2,
      }),
    );

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-all-profiles");
    const result = (await handler(
      new URL("gcp-profiler://custom/profiles"),
      { projectId: "custom-project" },
    )) as { contents: Array<{ text: string }> };

    expect(mockInitGoogleAuth).toHaveBeenCalledWith(true);
    expect(mockGetProjectId).not.toHaveBeenCalled();
    expect(mockAnalyseProfilePatterns).toHaveBeenCalledWith(defaultProfiles);
    expect(mockFormatProfileSummary).toHaveBeenCalledTimes(
      defaultProfiles.length,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("projects/custom-project/profiles"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("mock-token") }),
      }),
    );
    const markdown = result.contents[0]!.text;
    expect(markdown).toContain("Project: custom-project");
    expect(markdown).toContain("Total Profiles: 5");
    expect(markdown).toContain("More profiles available (truncated view)");
    expect(markdown).toContain("Skipped Profiles: 2");
    expect(markdown).toContain("analysis:projects/test-project/profiles/cpu-1");
    expect(markdown).toContain("summary:projects/test-project/profiles/cpu-1");
  });

  it("falls back to derived project id when not provided", async () => {
    mockFetch.mockResolvedValue(
      buildFetchResponse({
        profiles: [],
      }),
    );

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-all-profiles");
    const result = (await handler(
      new URL("gcp-profiler://auto/profiles"),
      {},
    )) as {
      contents: Array<{ text: string }>;
    };

    expect(mockGetProjectId).toHaveBeenCalledTimes(1);
    expect(result.contents[0]!.text).toContain("No profiles found");
  });

  it("wraps upstream errors when listing all profiles fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue("service unavailable"),
    } as any);

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-all-profiles");

    const failingCall = handler(new URL("gcp-profiler://test/profiles"), {});

    await expect(failingCall).rejects.toBeInstanceOf(GcpMcpError);
    await expect(failingCall).rejects.toMatchObject({
      message: expect.stringContaining(
        "Failed to fetch profiler profiles resource",
      ),
    });
  });

  it("focuses on CPU profiles for the CPU resource", async () => {
    const profiles = [
      createProfile("cpu-a", "CPU" as Profile["profileType"]),
      createProfile("heap-a", "HEAP" as Profile["profileType"]),
      createProfile("cpu-b", "CPU" as Profile["profileType"]),
    ];
    mockFetch.mockResolvedValue(buildFetchResponse({ profiles }));

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-cpu-profiles");
    const result = (await handler(
      new URL("gcp-profiler://test/cpu-profiles"),
      { projectId: "cpu-project" },
    )) as { contents: Array<{ text: string }> };

    expect(mockAnalyseProfilePatterns).toHaveBeenCalledWith([
      expect.objectContaining({ name: expect.stringContaining("cpu-a") }),
      expect.objectContaining({ name: expect.stringContaining("cpu-b") }),
    ]);
    expect(mockGetProfileTypeDescription).toHaveBeenCalledWith("CPU");
    const markdown = result.contents[0]!.text;
    expect(markdown).toContain("CPU Profiles: 2 (of 3 total)");
    expect(markdown).toContain("CPU Performance Analysis");
    expect(markdown).toContain("description:CPU");
  });

  it("indicates when CPU profiles are unavailable", async () => {
    const profiles = [
      createProfile("heap-only", "HEAP" as Profile["profileType"]),
    ];
    mockFetch.mockResolvedValue(buildFetchResponse({ profiles }));

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-cpu-profiles");
    const result = (await handler(
      new URL("gcp-profiler://test/cpu-profiles"),
      {},
    )) as {
      contents: Array<{ text: string }>;
    };

    expect(result.contents[0]!.text).toContain("No CPU profiles found");
  });

  it("summarises heap, allocation, and peak heap memory data", async () => {
    const profiles = [
      createProfile("heap-a", "HEAP" as Profile["profileType"]),
      createProfile("alloc-a", "HEAP_ALLOC" as Profile["profileType"]),
      createProfile("peak-a", "PEAK_HEAP" as Profile["profileType"]),
      createProfile("cpu-ignored", "CPU" as Profile["profileType"]),
    ];
    mockFetch.mockResolvedValue(buildFetchResponse({ profiles }));

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-memory-profiles");
    const result = (await handler(
      new URL("gcp-profiler://test/memory"),
      {},
    )) as {
      contents: Array<{ text: string }>;
    };

    expect(mockAnalyseProfilePatterns).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ profileType: "HEAP" }),
        expect.objectContaining({ profileType: "HEAP_ALLOC" }),
        expect.objectContaining({ profileType: "PEAK_HEAP" }),
      ]),
    );
    const markdown = result.contents[0]!.text;
    expect(markdown).toContain("Memory Profiles: 3 (of 4 total)");
    expect(markdown).toContain("**Heap Profiles:** 1");
    expect(markdown).toContain("**Allocation Profiles:** 1");
    expect(markdown).toContain("**Peak Heap Profiles:** 1");
  });

  it("indicates when memory profiles are missing", async () => {
    const profiles = [
      createProfile("cpu-only", "CPU" as Profile["profileType"]),
    ];
    mockFetch.mockResolvedValue(buildFetchResponse({ profiles }));

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-memory-profiles");
    const result = (await handler(
      new URL("gcp-profiler://test/memory"),
      {},
    )) as {
      contents: Array<{ text: string }>;
    };

    expect(result.contents[0]!.text).toContain("No memory profiles found");
  });

  it("builds holistic recommendations using all profiles", async () => {
    const profiles = [
      createProfile("cpu-a", "CPU" as Profile["profileType"]),
      createProfile("heap-a", "HEAP" as Profile["profileType"]),
    ];
    mockFetch.mockResolvedValue(
      buildFetchResponse({ profiles }),
    );

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler(
      "gcp-profiler-performance-recommendations",
    );
    const result = (await handler(
      new URL("gcp-profiler://test/recommendations"),
      { projectId: "rec-project" },
    )) as { contents: Array<{ text: string }> };

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("pageSize=200"),
      expect.any(Object),
    );
    expect(mockAnalyseProfilePatterns).toHaveBeenCalledWith(profiles);
    const markdown = result.contents[0]!.text;
    expect(markdown).toContain("Project: rec-project");
    expect(markdown).toContain("Based on 2 profiles");
    expect(markdown).toContain("Comprehensive Performance Strategy");
  });

  it("handles missing data for recommendations", async () => {
    mockFetch.mockResolvedValue(buildFetchResponse({ profiles: [] }));

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler(
      "gcp-profiler-performance-recommendations",
    );
    const result = (await handler(
      new URL("gcp-profiler://test/recommendations"),
      {},
    )) as {
      contents: Array<{ text: string }>;
    };

    expect(result.contents[0]!.text).toContain("No profiles available");
  });

  it("fails fast when authentication is unavailable", async () => {
    mockInitGoogleAuth.mockResolvedValueOnce(null);

    const { registerProfilerResources } = await loadModule();
    registerProfilerResources(mockServer as any);
    captureHandlers();

    const handler = getHandler("gcp-profiler-cpu-profiles");

    await expect(
      handler(new URL("gcp-profiler://test/cpu-profiles"), {}),
    ).rejects.toThrow(/authentication not available/);
  });
});
