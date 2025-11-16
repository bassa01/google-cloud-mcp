import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/services/gcloud/cli.js', () => ({
  invokeGcloud: vi.fn().mockResolvedValue({
    code: 0,
    stdout: 'project: test-project',
    stderr: '',
  }),
  lintGcloudCommand: vi.fn().mockResolvedValue({
    success: true,
    commandPath: 'projects list',
  }),
}));

vi.mock('../../../../src/services/gcloud/service-account.js', () => ({
  requireServiceAccountIdentity: vi
    .fn()
    .mockResolvedValue('example@gserviceaccount.com'),
}));

import { registerGcloudTools } from '../../../../src/services/gcloud/tools.js';
import {
  invokeGcloud,
  lintGcloudCommand,
} from '../../../../src/services/gcloud/cli.js';
import { requireServiceAccountIdentity } from '../../../../src/services/gcloud/service-account.js';
import { createMockMcpServer } from '../../../utils/test-helpers.js';
import { GcpMcpError } from '../../../../src/utils/error.js';

describe('gcloud tools', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
  });

  it('registers the read-only gcloud tool', () => {
    registerGcloudTools(mockServer as any);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcloud-run-read-command',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('executes a safe read-only command', async () => {
    registerGcloudTools(mockServer as any);
    const call = mockServer.registerTool.mock.calls.find(
      ([name]) => name === 'gcloud-run-read-command',
    );
    expect(call).toBeDefined();

    const handler = call![2];
    const result = await handler({
      args: ['gcloud', 'projects', 'list'],
    });

    expect(requireServiceAccountIdentity).toHaveBeenCalled();
    expect(lintGcloudCommand).toHaveBeenCalledWith('projects list');
    expect(invokeGcloud).toHaveBeenCalledWith(['projects', 'list']);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Service account');
  });

  it('blocks commands that violate the read-only policy', async () => {
    vi.mocked(lintGcloudCommand).mockResolvedValueOnce({
      success: true,
      commandPath: 'projects delete',
    });

    registerGcloudTools(mockServer as any);
    const handler = mockServer.registerTool.mock.calls.find(
      ([name]) => name === 'gcloud-run-read-command',
    )![2];

    const result = await handler({
      args: ['gcloud', 'projects', 'delete'],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('gcloud command rejected');
    expect(invokeGcloud).not.toHaveBeenCalledWith(['projects', 'delete']);
  });

  it('surfaces service account validation failures', async () => {
    vi.mocked(requireServiceAccountIdentity).mockRejectedValueOnce(
      new GcpMcpError('not a service account', 'UNSUPPORTED_IDENTITY', 403),
    );

    registerGcloudTools(mockServer as any);
    const handler = mockServer.registerTool.mock.calls.find(
      ([name]) => name === 'gcloud-run-read-command',
    )![2];

    const result = await handler({
      args: ['gcloud', 'projects', 'list'],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('UNSUPPORTED_IDENTITY');
    expect(invokeGcloud).not.toHaveBeenCalled();
  });
});
