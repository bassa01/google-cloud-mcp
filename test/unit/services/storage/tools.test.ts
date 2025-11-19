import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../mocks/google-cloud-mocks.js';
import {
  mockStorageBucketHandle,
  mockStorageClient,
  mockStorageFileHandle,
} from '../../../mocks/google-cloud-mocks.js';
import { createMockMcpServer } from '../../../utils/test-helpers.js';

describe('Storage Tools', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    mockServer = createMockMcpServer();
  });

  async function registerTools() {
    const { registerStorageTools } = await import('../../../../src/services/storage/index.js');
    registerStorageTools(mockServer as any);
  }

  const getHandler = (toolName: string) => {
    const call = mockServer.registerTool.mock.calls.find(([name]) => name === toolName);
    expect(call).toBeDefined();
    return call![2];
  };

  it('registers all storage tools', async () => {
    await registerTools();

    const registeredTools = mockServer.registerTool.mock.calls.map(([name]) => name);
    expect(registeredTools).toEqual(
      expect.arrayContaining([
        'gcp-storage-list-buckets',
        'gcp-storage-get-bucket',
        'gcp-storage-view-bucket-iam',
        'gcp-storage-test-bucket-permissions',
        'gcp-storage-list-objects',
        'gcp-storage-read-object-metadata',
        'gcp-storage-read-object-content',
      ]),
    );
  });

  it('lists buckets successfully', async () => {
    await registerTools();
    const handler = getHandler('gcp-storage-list-buckets');

    const result = await handler({ projectId: 'test-project', limit: 5 });

    expect(result.content[0].text).toContain('Cloud Storage Buckets');
    expect(mockStorageClient.getBuckets).toHaveBeenCalled();
  });

  it('lists objects with prefix filter', async () => {
    await registerTools();
    const handler = getHandler('gcp-storage-list-objects');

    const result = await handler({
      bucket: 'test-bucket',
      prefix: 'folder/',
      limit: 10,
      projectId: 'test-project',
    });

    expect(result.content[0].text).toContain('Cloud Storage Objects');
    expect(mockStorageBucketHandle.getFiles).toHaveBeenCalled();
  });

  it('reads object metadata', async () => {
    await registerTools();
    const handler = getHandler('gcp-storage-read-object-metadata');

    const result = await handler({
      bucket: 'test-bucket',
      object: 'folder/sample.txt',
      projectId: 'test-project',
    });

    expect(result.content[0].text).toContain('Object Metadata');
    expect(mockStorageBucketHandle.file).toHaveBeenCalledWith(
      'folder/sample.txt',
      expect.objectContaining({ userProject: 'test-project' }),
    );
    expect(mockStorageFileHandle.getMetadata).toHaveBeenCalled();
  });

  it('previews object content', async () => {
    await registerTools();
    const handler = getHandler('gcp-storage-read-object-content');

    const result = await handler({
      bucket: 'test-bucket',
      object: 'folder/sample.txt',
      projectId: 'test-project',
      bytes: 512,
    });

    expect(result.content[0].text).toContain('Object Content Preview');
    expect(mockStorageFileHandle.download).toHaveBeenCalled();
  });

  it('returns error when API fails', async () => {
    mockStorageClient.getBuckets.mockRejectedValueOnce(new Error('API error'));
    await registerTools();
    const handler = getHandler('gcp-storage-list-buckets');

    const result = await handler({ projectId: 'test-project', limit: 5 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed');
  });
});
