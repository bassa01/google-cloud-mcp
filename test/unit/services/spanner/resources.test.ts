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
      params: { limit: 10 },
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
