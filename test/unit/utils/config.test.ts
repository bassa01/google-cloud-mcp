/**
 * Tests for configuration utilities
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONFIG_SUBDIR = '.google-cloud-mcp';
const CONFIG_FILE = 'config.json';

const createTempHome = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'config-manager-test-'));

describe('Configuration Manager', () => {
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = createTempHome();
    configPath = path.join(tempHome, CONFIG_SUBDIR, CONFIG_FILE);
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    vi.unmock('os');
    vi.unmock('../../../src/utils/logger.js');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const importConfigModule = async () => {
    vi.resetModules();
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
    return import('../../../src/utils/config.js');
  };

  it('creates config manager instances and exposes core accessors', async () => {
    const { ConfigManager } = await importConfigModule();

    const configManager = new ConfigManager();
    expect(configManager).toBeDefined();
    expect(typeof configManager.getDefaultProjectId).toBe('function');
    expect(typeof configManager.setDefaultProjectId).toBe('function');

    await expect(configManager.setDefaultProjectId('test-project-config')).resolves
      .toBeUndefined();
  });

  it('initializes by creating the default config file when none exists', async () => {
    const { ConfigManager } = await importConfigModule();
    const manager = new ConfigManager();

    await manager.initialize();

    expect(fs.existsSync(configPath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(persisted).toEqual({ recentProjectIds: [], maxRecentProjects: 5 });
  });

  it('loads persisted defaults and recent projects from disk', async () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          defaultProjectId: 'persisted-project',
          recentProjectIds: ['recent-1', 'recent-2'],
          maxRecentProjects: 7,
        },
        null,
        2,
      ),
      'utf-8',
    );

    const { ConfigManager } = await importConfigModule();
    const manager = new ConfigManager();
    await manager.initialize();

    expect(manager.getDefaultProjectId()).toBe('persisted-project');
    expect(manager.getRecentProjectIds()).toEqual(['recent-1', 'recent-2']);
  });

  it('maintains a bounded MRU list without duplicates', async () => {
    const { ConfigManager } = await importConfigModule();
    const manager = new ConfigManager();
    await manager.initialize();

    const sequence = ['one', 'two', 'three', 'four', 'five', 'six', 'three'];
    for (const projectId of sequence) {
      await manager.addToRecentProjects(projectId);
    }

    expect(manager.getRecentProjectIds()).toEqual([
      'three',
      'six',
      'five',
      'four',
      'two',
    ]);
  });

  it('persists setDefaultProjectId updates alongside the MRU cache', async () => {
    const { ConfigManager } = await importConfigModule();
    const manager = new ConfigManager();

    await manager.setDefaultProjectId('persisted-value');

    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(persisted.defaultProjectId).toBe('persisted-value');
    expect(persisted.recentProjectIds[0]).toBe('persisted-value');
  });
});
