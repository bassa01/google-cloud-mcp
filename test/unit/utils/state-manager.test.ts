/**
 * Tests for state manager utilities
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTempHome = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'state-manager-test-'));

const flushAsync = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

const waitForCondition = async (
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const waitForFile = async (filePath: string): Promise<void> => {
  await waitForCondition(() => {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    try {
      const stats = fs.statSync(filePath);
      return stats.size > 0;
    } catch (error) {
      return false;
    }
  });
};

describe('State Manager', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset any environment variables
    delete process.env.GOOGLE_CLOUD_PROJECT;
    
    // Clear the singleton state by setting a clean project ID
    const { stateManager } = await import('../../../src/utils/state-manager.js');
    await stateManager.setCurrentProjectId('test-project-env'); // Reset to known state
  });

  describe('stateManager', () => {
    it('should initialize state manager correctly', async () => {
      const { stateManager } = await import('../../../src/utils/state-manager.js');
      
      expect(stateManager).toBeDefined();
      expect(typeof stateManager.getCurrentProjectId).toBe('function');
      expect(typeof stateManager.setCurrentProjectId).toBe('function');
    });

    it('should get and set project ID', async () => {
      const { stateManager } = await import('../../../src/utils/state-manager.js');
      
      const testProjectId = 'test-state-project-unique';
      await stateManager.setCurrentProjectId(testProjectId);
      
      const retrievedProjectId = stateManager.getCurrentProjectId();
      expect(retrievedProjectId).toBe(testProjectId);
    });

    it('should handle empty project ID', async () => {
      const { stateManager } = await import('../../../src/utils/state-manager.js');
      
      // Empty project ID should throw an error
      try {
        await stateManager.setCurrentProjectId('');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should store and retrieve project ID correctly', async () => {
      const { stateManager } = await import('../../../src/utils/state-manager.js');
      
      const projectId = 'state-test-project-specific';
      await stateManager.setCurrentProjectId(projectId);
      
      const retrievedProjectId = stateManager.getCurrentProjectId();
      expect(retrievedProjectId).toBe(projectId);
      
      // Also check that environment variable is set
      expect(process.env.GOOGLE_CLOUD_PROJECT).toBe(projectId);
    });

    it('should track auth initialization state', async () => {
      const { stateManager } = await import('../../../src/utils/state-manager.js');
      
      expect(stateManager.isAuthInitialized()).toBeDefined();
      
      stateManager.setAuthInitialized(true);
      expect(stateManager.isAuthInitialized()).toBe(true);
      
      stateManager.setAuthInitialized(false);
      expect(stateManager.isAuthInitialized()).toBe(false);
    });
  });

  describe('state persistence and fallbacks', () => {
    let tempHome: string;
    let stateDir: string;
    let stateFile: string;

    beforeEach(() => {
      tempHome = createTempHome();
      stateDir = path.join(tempHome, '.google-cloud-mcp');
      stateFile = path.join(stateDir, 'state.json');
    });

    afterEach(() => {
      fs.rmSync(tempHome, { recursive: true, force: true });
      delete process.env.GOOGLE_CLOUD_PROJECT;
      vi.unmock('os');
      vi.unmock('../../../src/utils/logger.js');
      vi.unmock('../../../src/utils/config.js');
      vi.resetModules();
      vi.restoreAllMocks();
    });

    interface SetupOptions {
      config?: {
        defaultProjectId?: string;
        setDefaultProjectId?: ReturnType<typeof vi.fn>;
      };
      envProject?: string;
    }

    const importStateManager = async (
      options: SetupOptions = {},
    ): Promise<{
      stateManager: any;
      configMock: {
        initialize: ReturnType<typeof vi.fn>;
        getDefaultProjectId: ReturnType<typeof vi.fn>;
        setDefaultProjectId: ReturnType<typeof vi.fn>;
      };
    }> => {
      vi.resetModules();

      if (options.envProject !== undefined) {
        process.env.GOOGLE_CLOUD_PROJECT = options.envProject;
      } else {
        delete process.env.GOOGLE_CLOUD_PROJECT;
      }

      vi.doMock('os', () => ({
        default: { homedir: () => tempHome },
        homedir: () => tempHome,
      }));

      const loggerMock = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      vi.doMock('../../../src/utils/logger.js', () => ({ logger: loggerMock }));

      const configMock = {
        initialize: vi.fn().mockResolvedValue(undefined),
        getDefaultProjectId: vi.fn().mockReturnValue(
          options.config?.defaultProjectId,
        ),
        setDefaultProjectId:
          options.config?.setDefaultProjectId ??
          vi.fn().mockResolvedValue(undefined),
      };

      vi.doMock('../../../src/utils/config.js', () => ({
        configManager: configMock,
      }));

      const module = await import('../../../src/utils/state-manager.js');
      const { stateManager } = module as { stateManager: any };
      await flushAsync();

      return { stateManager, configMock };
    };

    it('loads persisted state from disk before consulting config fallbacks', async () => {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        stateFile,
        JSON.stringify(
          {
            currentProjectId: 'persisted-project',
            authInitialized: true,
          },
          null,
          2,
        ),
        'utf-8',
      );

      const { stateManager, configMock } = await importStateManager();

      await waitForCondition(
        () => stateManager.getCurrentProjectId() === 'persisted-project',
      );
      expect(stateManager.getCurrentProjectId()).toBe('persisted-project');
      expect(stateManager.isAuthInitialized()).toBe(true);
      expect(configMock.getDefaultProjectId).not.toHaveBeenCalled();
      expect(configMock.setDefaultProjectId).not.toHaveBeenCalled();
    });

    it('bootstraps the project ID from config defaults when no state file exists', async () => {
      const { stateManager, configMock } = await importStateManager({
        config: { defaultProjectId: 'config-project' },
      });

      await waitForCondition(
        () => stateManager.getCurrentProjectId() === 'config-project',
      );
      expect(stateManager.getCurrentProjectId()).toBe('config-project');
      expect(process.env.GOOGLE_CLOUD_PROJECT).toBe('config-project');
      expect(configMock.setDefaultProjectId).toHaveBeenCalledWith('config-project');
      await waitForFile(stateFile);
      const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(savedState.currentProjectId).toBe('config-project');
    });

    it('falls back to the GOOGLE_CLOUD_PROJECT environment variable when config lacks defaults', async () => {
      const { stateManager, configMock } = await importStateManager({
        envProject: 'env-project',
      });

      await waitForCondition(
        () => stateManager.getCurrentProjectId() === 'env-project',
      );
      expect(stateManager.getCurrentProjectId()).toBe('env-project');
      expect(configMock.setDefaultProjectId).toHaveBeenCalledWith('env-project');
      await waitForFile(stateFile);
      const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(savedState.currentProjectId).toBe('env-project');
    });

    it('persists project changes and emits notifications even if config persistence fails', async () => {
      const failingSet = vi.fn().mockRejectedValue(new Error('write failed'));
      const { stateManager } = await importStateManager({
        config: { setDefaultProjectId: failingSet },
      });

      const changePromise = new Promise((resolve) =>
        stateManager.once('projectIdChanged', resolve),
      );

      await expect(stateManager.setCurrentProjectId('runtime-project')).resolves
        .toBeUndefined();
      await changePromise;

      const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(savedState.currentProjectId).toBe('runtime-project');
      expect(typeof savedState.lastUpdated).toBe('number');
    });
  });
});