/**
 * Tests for authentication utilities covering multiple fallback paths
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const originalEnv = { ...process.env };

const mockStateManager = {
  getCurrentProjectId: vi.fn(),
  setCurrentProjectId: vi.fn(),
  setAuthInitialized: vi.fn(),
  isAuthInitialized: vi.fn(),
  on: vi.fn(),
  emit: vi.fn(),
};

const mockConfigManager = {
  initialize: vi.fn(),
  getDefaultProjectId: vi.fn(),
  setDefaultProjectId: vi.fn(),
  getRecentProjectIds: vi.fn(),
};

const fsMock = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
};

const fsPromisesMock = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

type GoogleAuthMockInstance = {
  getClient: ReturnType<typeof vi.fn>;
  getProjectId: ReturnType<typeof vi.fn>;
};

const googleAuthInstances: GoogleAuthMockInstance[] = [];
let nextAuthInstanceFactory: () => GoogleAuthMockInstance;

const GoogleAuthMock = vi.fn(function GoogleAuthMockCtor() {
  const instance = nextAuthInstanceFactory();
  googleAuthInstances.push(instance);
  return instance;
});

vi.mock("../../../src/utils/state-manager.js", () => ({
  stateManager: mockStateManager,
}));

vi.mock("../../../src/utils/config.js", () => ({
  configManager: mockConfigManager,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("fs", () => ({
  default: { ...fsMock, promises: fsPromisesMock },
  ...fsMock,
  promises: fsPromisesMock,
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: GoogleAuthMock,
}));

const resetEnv = () => {
  Object.keys(process.env).forEach((key) => {
    delete process.env[key];
  });
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value !== undefined) {
      process.env[key] = value;
    }
  });
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLIENT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.LAZY_AUTH;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  googleAuthInstances.length = 0;
  nextAuthInstanceFactory = () => ({
    getClient: vi.fn().mockResolvedValue({
      getAccessToken: vi.fn().mockResolvedValue("token"),
    }),
    getProjectId: vi.fn().mockResolvedValue("auth-project"),
  });
  resetEnv();

  mockStateManager.getCurrentProjectId.mockReturnValue(null);
  mockStateManager.setCurrentProjectId.mockResolvedValue(undefined);
  mockConfigManager.initialize.mockResolvedValue(undefined);
  mockConfigManager.getDefaultProjectId.mockReturnValue(undefined);
  mockConfigManager.getRecentProjectIds.mockReturnValue([]);
  fsMock.existsSync.mockReturnValue(false);
  fsMock.readFileSync.mockReturnValue("");
});

afterAll(() => {
  resetEnv();
});

describe("initGoogleAuth", () => {
  it("initializes using explicit service account credentials when required", async () => {
    process.env.GOOGLE_CLIENT_EMAIL = "svc-account@test";
    process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";

    const { initGoogleAuth } = await import("../../../src/utils/auth.js");
    const client = await initGoogleAuth(true);

    expect(client).toBeDefined();
    expect(GoogleAuthMock).toHaveBeenCalledTimes(1);
    expect(GoogleAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          client_email: "svc-account@test",
        }),
      }),
    );
    expect(googleAuthInstances[0]?.getClient).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached client to avoid redundant instantiation", async () => {
    process.env.GOOGLE_CLIENT_EMAIL = "svc-account@test";
    process.env.GOOGLE_PRIVATE_KEY = "-----key-----";

    const { initGoogleAuth } = await import("../../../src/utils/auth.js");
    await initGoogleAuth(true);
    await initGoogleAuth(true);

    expect(GoogleAuthMock).toHaveBeenCalledTimes(1);
  });

  it("throws when authentication is required but no credentials exist", async () => {
    const { initGoogleAuth } = await import("../../../src/utils/auth.js");

    await expect(initGoogleAuth(true)).rejects.toThrow(
      /Google Cloud authentication not configured/i,
    );
  });

  it("supports Application Default Credentials via GOOGLE_APPLICATION_CREDENTIALS", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/mock-creds.json";

    const { initGoogleAuth } = await import("../../../src/utils/auth.js");
    const client = await initGoogleAuth(true);

    expect(client).toBeDefined();
    expect(GoogleAuthMock).toHaveBeenCalledTimes(1);
    expect(googleAuthInstances[0]?.getClient).toHaveBeenCalled();
  });
});

describe("getProjectId", () => {
  it("returns the project ID from state manager when present", async () => {
    mockStateManager.getCurrentProjectId.mockReturnValue("state-project");

    const { getProjectId } = await import("../../../src/utils/auth.js");
    const projectId = await getProjectId();

    expect(projectId).toBe("state-project");
    expect(mockStateManager.setCurrentProjectId).not.toHaveBeenCalled();
  });

  it("prefers the GOOGLE_CLOUD_PROJECT environment variable and caches it", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "env-project";

    const { getProjectId } = await import("../../../src/utils/auth.js");
    const projectId = await getProjectId();

    expect(projectId).toBe("env-project");
    expect(mockStateManager.setCurrentProjectId).toHaveBeenCalledWith("env-project");
  });

  it("extracts project ID from a credentials file when configured", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/creds.json";
    const credentials = { project_id: "file-project" };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(credentials));

    const { getProjectId } = await import("../../../src/utils/auth.js");
    const projectId = await getProjectId();

    expect(projectId).toBe("file-project");
    expect(mockStateManager.setCurrentProjectId).toHaveBeenCalledWith("file-project");
  });

  it("falls back to the config manager default when state and env are empty", async () => {
    mockConfigManager.getDefaultProjectId.mockReturnValue("config-project");

    const { getProjectId } = await import("../../../src/utils/auth.js");
    const projectId = await getProjectId();

    expect(projectId).toBe("config-project");
    expect(mockStateManager.setCurrentProjectId).toHaveBeenCalledWith("config-project");
  });

  it("uses the authenticated client when other sources fail", async () => {
    process.env.GOOGLE_CLIENT_EMAIL = "svc-account@test";
    process.env.GOOGLE_PRIVATE_KEY = "-----key-----";
    nextAuthInstanceFactory = () => ({
      getClient: vi.fn().mockResolvedValue({
        getAccessToken: vi.fn().mockResolvedValue("token"),
      }),
      getProjectId: vi.fn().mockResolvedValue("auth-derived"),
    });

    const { getProjectId } = await import("../../../src/utils/auth.js");
    const projectId = await getProjectId();

    expect(projectId).toBe("auth-derived");
    expect(googleAuthInstances[0]?.getProjectId).toHaveBeenCalled();
    expect(mockStateManager.setCurrentProjectId).toHaveBeenCalledWith("auth-derived");
  });

  it("returns 'unknown-project' when auth is optional and no data exist", async () => {
    const { getProjectId } = await import("../../../src/utils/auth.js");
    const projectId = await getProjectId(false);

    expect(projectId).toBe("unknown-project");
  });
});

describe("project ID helpers", () => {
  it("delegates setProjectId to the state manager", async () => {
    const { setProjectId } = await import("../../../src/utils/auth.js");
    await setProjectId("new-project");

    expect(mockStateManager.setCurrentProjectId).toHaveBeenCalledWith("new-project");
  });

  it("returns the recent project list from config manager", async () => {
    mockConfigManager.getRecentProjectIds.mockReturnValue(["p1", "p2"]);

    const { getRecentProjectIds } = await import("../../../src/utils/auth.js");
    const recent = await getRecentProjectIds();

    expect(mockConfigManager.initialize).toHaveBeenCalled();
    expect(recent).toEqual(["p1", "p2"]);
  });
});
