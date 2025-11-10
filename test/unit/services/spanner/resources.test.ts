import { beforeEach, describe, expect, it, vi } from 'vitest';

let registerSpannerResources: (server: any) => void;
let runMock: ReturnType<typeof vi.fn>;
let databaseFactoryMock: ReturnType<typeof vi.fn>;
let instanceFactoryMock: ReturnType<typeof vi.fn>;

const mockGetProjectId = vi.fn();
const mockGetSpannerConfig = vi.fn();
const mockGetSpannerClient = vi.fn();

vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/auth.js', () => ({
  getProjectId: mockGetProjectId,
}));

vi.mock('../../../../src/services/spanner/types.js', () => ({
  getSpannerConfig: mockGetSpannerConfig,
  getSpannerClient: mockGetSpannerClient,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(),
  ResourceTemplate: class {},
}));

function getTablePreviewHandler() {
  const mockServer = { resource: vi.fn() };
  registerSpannerResources(mockServer as any);
  const tablePreviewCall = mockServer.resource.mock.calls.find(
    call => call[0] === 'gcp-spanner-table-preview',
  );
  if (!tablePreviewCall) {
    throw new Error('Table preview resource not registered');
  }
  return tablePreviewCall[2] as (
    uri: URL,
    params: Record<string, unknown>,
    extra: unknown,
  ) => Promise<unknown>;
}

function getQueryStatsHandler() {
  const mockServer = { resource: vi.fn() };
  registerSpannerResources(mockServer as any);
  const queryStatsCall = mockServer.resource.mock.calls.find(
    call => call[0] === 'gcp-spanner-query-stats',
  );
  if (!queryStatsCall) {
    throw new Error('Query stats resource not registered');
  }
  return queryStatsCall[2] as (
    uri: URL,
    params: Record<string, unknown>,
    extra: unknown,
  ) => Promise<unknown>;
}

describe('Spanner resources table preview', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    runMock = vi.fn().mockResolvedValue([[{ id: '1', name: 'Alice' }]]);
    databaseFactoryMock = vi.fn(() => ({ run: runMock }));
    instanceFactoryMock = vi.fn(() => ({ database: databaseFactoryMock }));

    mockGetProjectId.mockResolvedValue('resolved-project');
    mockGetSpannerConfig.mockResolvedValue({
      instanceId: 'test-instance',
      databaseId: 'test-database',
    });
    mockGetSpannerClient.mockResolvedValue({
      projectId: 'resolved-project',
      instance: instanceFactoryMock,
    });

    ({ registerSpannerResources } = await import(
      '../../../../src/services/spanner/resources.js'
    ));
  });

  it('sanitizes table names before executing preview queries', async () => {
    const handler = getTablePreviewHandler();

    const response: any = await handler(
      new URL('gcp-spanner://resolved-project/test-instance/test-database/tables/Users/preview'),
      {
        projectId: 'resolved-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        tableName: 'Users',
      },
      undefined,
    );

    expect(runMock).toHaveBeenCalledWith({
      sql: 'SELECT * FROM `Users` LIMIT @limit',
      params: { limit: '10' },
      types: { limit: 'int64' },
    });
    expect(response.contents[0].text).toContain('Accepted table name format');
  });

  it('rejects invalid table names that could inject SQL', async () => {
    const handler = getTablePreviewHandler();

    await expect(
      handler(
        new URL('gcp-spanner://resolved-project/test-instance/test-database/tables/Users/preview'),
        {
          projectId: 'resolved-project',
          instanceId: 'test-instance',
          databaseId: 'test-database',
          tableName: 'Users; DROP TABLE Accounts',
        },
        undefined,
      ),
    ).rejects.toThrow(/Invalid table name/);

    expect(runMock).not.toHaveBeenCalled();
  });

  it('documents the accepted table name format when table name is missing', async () => {
    const handler = getTablePreviewHandler();

    await expect(
      handler(
        new URL('gcp-spanner://resolved-project/test-instance/test-database/tables/Users/preview'),
        {
          projectId: 'resolved-project',
          instanceId: 'test-instance',
          databaseId: 'test-database',
          tableName: '',
        },
        undefined,
      ),
    ).rejects.toThrow(/Table name is required/);

    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('Spanner query stats resource', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    runMock = vi.fn();
    databaseFactoryMock = vi.fn(() => ({ run: runMock }));
    instanceFactoryMock = vi.fn(() => ({ database: databaseFactoryMock }));

    mockGetProjectId.mockResolvedValue('resolved-project');
    mockGetSpannerConfig.mockResolvedValue({
      instanceId: 'test-instance',
      databaseId: 'test-database',
    });
    mockGetSpannerClient.mockResolvedValue({
      projectId: 'resolved-project',
      instance: instanceFactoryMock,
    });

    ({ registerSpannerResources } = await import(
      '../../../../src/services/spanner/resources.js'
    ));
  });

  it('renders latency and CPU tables', async () => {
    runMock.mockImplementation(({ sql }: { sql: string }) => {
      const baseRow = {
        query_text: 'SELECT * FROM Users',
        text_fingerprint: 'fp-users',
        request_tag: 'tag-users',
        interval_end: '2025-01-02T03:04:05Z',
        execution_count: '12',
        avg_latency_seconds: 1.25,
        avg_cpu_seconds: 0.5,
        total_cpu_seconds: 6,
      };
      const altRow = {
        query_text: 'UPDATE Accounts SET balance = balance - 1',
        text_fingerprint: 'fp-accounts',
        request_tag: null,
        interval_end: '2025-01-02T03:04:05Z',
        execution_count: '3',
        avg_latency_seconds: 2.75,
        avg_cpu_seconds: 1.5,
        total_cpu_seconds: 4.5,
      };

      if (sql.includes('QUERY_STATS_TOP_MINUTE') && sql.includes('avg_latency')) {
        return Promise.resolve([[baseRow, altRow]]);
      }
      if (sql.includes('QUERY_STATS_TOP_MINUTE') && sql.includes('total_cpu')) {
        return Promise.resolve([[altRow, baseRow]]);
      }
      if (sql.includes('QUERY_STATS_TOP_10MINUTE') && sql.includes('avg_latency')) {
        return Promise.resolve([[altRow]]);
      }
      if (sql.includes('QUERY_STATS_TOP_10MINUTE') && sql.includes('total_cpu')) {
        return Promise.resolve([[baseRow]]);
      }
      if (sql.includes('QUERY_STATS_TOP_HOUR') && sql.includes('avg_latency')) {
        return Promise.resolve([[baseRow]]);
      }
      if (sql.includes('QUERY_STATS_TOP_HOUR') && sql.includes('total_cpu')) {
        return Promise.resolve([[altRow]]);
      }
      return Promise.resolve([[]]);
    });

    const handler = getQueryStatsHandler();
    const response: any = await handler(
      new URL('gcp-spanner://resolved-project/test-instance/test-database/query-stats'),
      {
        projectId: 'resolved-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
      },
      undefined,
    );

    const payload = JSON.parse(response.contents[0].text as string);
    expect(payload.metadata.projectId).toBe('resolved-project');
    expect(Array.isArray(payload.latencyTop)).toBe(true);
    expect(Array.isArray(payload.cpuTop)).toBe(true);
    const latencyFingerprints = payload.latencyTop.map((entry: any) => entry.fingerprint);
    expect(latencyFingerprints).toContain('fp-users');
    expect(latencyFingerprints).toContain('fp-accounts');
    const cpuFingerprints = payload.cpuTop.map((entry: any) => entry.fingerprint);
    expect(cpuFingerprints).toContain('fp-users');
    expect(cpuFingerprints).toContain('fp-accounts');
    expect(payload.latencyTop[0].windows).toBeDefined();
    expect(payload.latencyTop[0].windows.minute).toBeDefined();
    expect(runMock).toHaveBeenCalledTimes(6);
  });

  it('handles missing query stats gracefully', async () => {
    runMock.mockResolvedValue([[]]);

    const handler = getQueryStatsHandler();
    const response: any = await handler(
      new URL('gcp-spanner://resolved-project/test-instance/test-database/query-stats'),
      {
        projectId: 'resolved-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
      },
      undefined,
    );

    const payload = JSON.parse(response.contents[0].text as string);
    expect(payload.warnings?.[0]).toContain('No query stats were returned');
    expect(runMock).toHaveBeenCalled();
  });
});
