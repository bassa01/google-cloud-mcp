/**
 * Tests for BigQuery service tools
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../mocks/google-cloud-mocks.js';
import { mockBigQueryClient } from '../../../mocks/google-cloud-mocks.js';
import { createMockMcpServer } from '../../../utils/test-helpers.js';

describe('BigQuery Tools', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();

    const mockJob = {
      id: 'test-job',
      getQueryResults: vi.fn().mockResolvedValue([
        [
          {
            id: 'row-1',
            status: 'OK',
          },
        ],
      ]),
      getMetadata: vi.fn().mockResolvedValue([
        {
          jobReference: { jobId: 'test-job', location: 'US' },
          statistics: {
            query: {
              totalBytesProcessed: '1000',
              cacheHit: false,
            },
          },
          configuration: { query: { dryRun: false } },
          status: {},
        },
      ]),
    };

    mockBigQueryClient.createQueryJob.mockReset();
    mockBigQueryClient.createQueryJob.mockResolvedValue([mockJob]);
  });

  it('registers the BigQuery execute query tool', async () => {
    const { registerBigQueryTools } = await import('../../../../src/services/bigquery/tools.js');

    registerBigQueryTools(mockServer as any);

    expect(mockServer.tool).toHaveBeenCalledWith(
      'gcp-bigquery-execute-query',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('executes a read-only query and returns rows', async () => {
    const { registerBigQueryTools } = await import('../../../../src/services/bigquery/tools.js');

    registerBigQueryTools(mockServer as any);

    const toolCall = mockServer.tool.mock.calls.find(
      (call) => call[0] === 'gcp-bigquery-execute-query',
    );

    expect(toolCall).toBeDefined();

    const handler = toolCall![2];
    const response = await handler({
      sql: 'SELECT * FROM `dataset.table` LIMIT 5',
      projectId: 'test-project',
    });

    expect(response).toBeDefined();
    expect(response.content?.[0]?.text).toContain('BigQuery Query Results');
    expect(mockBigQueryClient.createQueryJob).toHaveBeenCalled();
  });

  it('blocks destructive queries before hitting BigQuery', async () => {
    const { registerBigQueryTools } = await import('../../../../src/services/bigquery/tools.js');

    registerBigQueryTools(mockServer as any);

    const toolCall = mockServer.tool.mock.calls.find(
      (call) => call[0] === 'gcp-bigquery-execute-query',
    );
    const handler = toolCall![2];

    await expect(
      handler({
        sql: 'DELETE FROM `dataset.table` WHERE true',
      }),
    ).rejects.toThrow(/read-only/i);
    expect(mockBigQueryClient.createQueryJob).not.toHaveBeenCalled();
  });

  it('skips fetching rows when dryRun is true', async () => {
    const dryRunJob = {
      id: 'dry-run-job',
      getQueryResults: vi.fn(),
      getMetadata: vi.fn().mockResolvedValue([
        {
          jobReference: { jobId: 'dry-run-job', location: 'US' },
          statistics: {
            query: {
              totalBytesProcessed: '0',
              cacheHit: false,
            },
          },
          configuration: { query: { dryRun: true } },
          status: {},
        },
      ]),
    };

    mockBigQueryClient.createQueryJob.mockResolvedValueOnce([dryRunJob]);

    const { registerBigQueryTools } = await import('../../../../src/services/bigquery/tools.js');

    registerBigQueryTools(mockServer as any);

    const toolCall = mockServer.tool.mock.calls.find(
      (call) => call[0] === 'gcp-bigquery-execute-query',
    );
    const handler = toolCall![2];

    const response = await handler({
      sql: 'SELECT 1',
      dryRun: true,
    });

    expect(response.content?.[0]?.text).toContain('BigQuery Query Dry Run');
    expect(dryRunJob.getQueryResults).not.toHaveBeenCalled();
  });
});
