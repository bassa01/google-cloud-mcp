import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

const mockSpawn = vi.fn();
const mockLogger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  logger: mockLogger,
}));

type SpawnController = {
  child: ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  emitStdout: (value: string) => void;
  emitStderr: (value: string) => void;
  close: (code: number | null) => void;
  error: (err: NodeJS.ErrnoException) => void;
};

function createSpawnController(): SpawnController {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as SpawnController['child'];
  child.stdout = stdout;
  child.stderr = stderr;

  return {
    child,
    emitStdout: (value: string) => stdout.emit('data', Buffer.from(value)),
    emitStderr: (value: string) => stderr.emit('data', Buffer.from(value)),
    close: (code: number | null) => child.emit('close', code),
    error: (err: NodeJS.ErrnoException) => child.emit('error', err),
  };
}

describe('gcloud cli helpers', () => {
  let spawnControllers: SpawnController[];

  const lastSpawnController = (): SpawnController => {
    const controller = spawnControllers[spawnControllers.length - 1];
    if (!controller) {
      throw new Error('no gcloud invocation captured');
    }
    return controller;
  };

  beforeEach(() => {
    vi.resetModules();
    spawnControllers = [];
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => {
      const controller = createSpawnController();
      spawnControllers.push(controller);
      return controller.child;
    });
    Object.values(mockLogger).forEach((fn) => fn.mockReset());
  });

  it('invokes gcloud and streams stdout/stderr', async () => {
    const { invokeGcloud } = await import('../../../../src/services/gcloud/cli.js');

    const resultPromise = invokeGcloud(['projects', 'list']);
    const controller = lastSpawnController();
    controller.emitStdout('hello ');
    controller.emitStdout('world');
    controller.emitStderr('warn');
    controller.close(0);

    await expect(resultPromise).resolves.toEqual({
      code: 0,
      stdout: 'hello world',
      stderr: 'warn',
    });
    expect(mockSpawn).toHaveBeenCalledWith('gcloud', ['projects', 'list'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('surfaces GCLOUD_NOT_FOUND when the CLI is missing', async () => {
    const { invokeGcloud } = await import('../../../../src/services/gcloud/cli.js');

    const resultPromise = invokeGcloud(['version']);
    const controller = lastSpawnController();
    const enoent = Object.assign(new Error('missing'), { code: 'ENOENT' as const });
    controller.error(enoent);

    await expect(resultPromise).rejects.toMatchObject({
      code: 'GCLOUD_NOT_FOUND',
      statusCode: 500,
    });
  });

  it('returns the normalized linted command path', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');

    const lintPromise = module.lintGcloudCommand('projects list');
    const controller = lastSpawnController();
    controller.emitStdout(
      JSON.stringify([
        {
          command_string_no_args: 'gcloud   projects list',
          success: true,
          error_message: null,
          error_type: null,
        },
      ]),
    );
    controller.close(0);

    const result = await lintPromise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'gcloud',
      [
        'meta',
        'lint-gcloud-commands',
        '--command-string',
        'gcloud projects list',
      ],
      expect.any(Object),
    );
    expect(result).toEqual({ success: true, commandPath: 'projects list' });
  });

  it('raises a GCLOUD_LINT_FAILED error on malformed lint output', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');
    const lintPromise = module.lintGcloudCommand('projects list');
    const controller = lastSpawnController();
    controller.emitStdout('not-json');
    controller.close(0);

    await expect(lintPromise).rejects.toMatchObject({
      code: 'GCLOUD_LINT_FAILED',
      statusCode: 500,
    });
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('includes stderr from gcloud lint failures', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');
    const lintPromise = module.lintGcloudCommand('projects list');
    const controller = lastSpawnController();
    controller.emitStdout(
      JSON.stringify([
        {
          command_string_no_args: 'gcloud projects list',
          success: true,
          error_message: 'lint blew up',
          error_type: 'INTERNAL',
        },
      ]),
    );
    controller.emitStderr('stack trace');
    controller.close(1);

    await expect(lintPromise).rejects.toMatchObject({
      code: 'GCLOUD_LINT_FAILED',
      statusCode: 400,
      message: expect.stringContaining('lint blew up'),
    });
  });

  it('flags linted commands that are not safe to execute', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');
    const lintPromise = module.lintGcloudCommand('projects delete');
    const controller = lastSpawnController();
    controller.emitStdout(
      JSON.stringify([
        {
          command_string_no_args: 'gcloud projects delete',
          success: false,
          error_message: 'not safe',
          error_type: 'FORBIDDEN',
        },
      ]),
    );
    controller.close(0);

    await expect(lintPromise).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      statusCode: 400,
    });
  });

  it('returns the active service account when present', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');
    const accountPromise = module.getActiveGcloudAccount();
    const controller = lastSpawnController();
    controller.emitStdout(
      JSON.stringify([
        { account: 'user@example.com', status: 'INACTIVE' },
        { account: 'service@example.iam.gserviceaccount.com', status: 'ACTIVE' },
      ]),
    );
    controller.close(0);

    await expect(accountPromise).resolves.toBe(
      'service@example.iam.gserviceaccount.com',
    );
  });

  it('returns null when no active account exists', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');
    const accountPromise = module.getActiveGcloudAccount();
    const controller = lastSpawnController();
    controller.emitStdout(
      JSON.stringify([
        { account: 'user@example.com', status: 'INACTIVE' },
      ]),
    );
    controller.close(0);

    await expect(accountPromise).resolves.toBeNull();
  });

  it('propagates GCLOUD_AUTH_ERROR when gcloud auth list fails', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');
    const accountPromise = module.getActiveGcloudAccount();
    const controller = lastSpawnController();
    controller.emitStderr('boom');
    controller.close(2);

    await expect(accountPromise).rejects.toMatchObject({
      code: 'GCLOUD_AUTH_ERROR',
      statusCode: 500,
    });
  });

  it('validates the JSON returned by gcloud auth list', async () => {
    const module = await import('../../../../src/services/gcloud/cli.js');
    const accountPromise = module.getActiveGcloudAccount();
    const controller = lastSpawnController();
    controller.emitStdout('oops');
    controller.close(0);

    await expect(accountPromise).rejects.toMatchObject({
      code: 'GCLOUD_AUTH_ERROR',
      statusCode: 500,
    });
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
