import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMcpServer } from '../../../utils/test-helpers.js';
import { GcpMcpError } from '../../../../src/utils/error.js';

const mocks = vi.hoisted(() => {
  return {
    getProjectId: vi.fn<[], Promise<string>>(),
    monitoringClient: {
      listTimeSeries: vi.fn(),
    },
    formatTimeSeriesData: vi.fn(),
    buildStructuredTextBlock: vi.fn(),
  };
});

vi.mock('../../../../src/utils/auth.js', () => ({
  getProjectId: mocks.getProjectId,
}));

vi.mock('../../../../src/services/monitoring/types.js', () => ({
  getMonitoringClient: () => mocks.monitoringClient,
  formatTimeSeriesData: mocks.formatTimeSeriesData,
}));

vi.mock('../../../../src/utils/output.js', () => ({
  buildStructuredTextBlock: mocks.buildStructuredTextBlock,
}));

const RECENT_RESOURCE = 'gcp-monitoring-recent-metrics';
const FILTERED_RESOURCE = 'gcp-monitoring-filtered-metrics';

const callArgsFor = (
  mockServer: ReturnType<typeof createMockMcpServer>,
  resourceId: string,
) => {
  const match = mockServer.resource.mock.calls.find(([name]) => name === resourceId);
  expect(match).toBeDefined();
  return match!;
};

const getHandlerFor = (
  mockServer: ReturnType<typeof createMockMcpServer>,
  resourceId: string,
) => {
  const [, , handler] = callArgsFor(mockServer, resourceId);
  return handler as (
    uri: URL,
    params: Record<string, any>,
  ) => Promise<{ contents: Array<{ uri: string; text: string }> }>;
};

describe('Monitoring resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MONITORING_FILTER;
    mocks.getProjectId.mockResolvedValue('project-from-auth');
    mocks.monitoringClient.listTimeSeries.mockResolvedValue([[{ id: 'series-1' }], {}, {}]);
    mocks.formatTimeSeriesData.mockReturnValue({
      series: [{ metric: 'cpu' }],
      totalSeries: 1,
      omittedSeries: 0,
    });
    mocks.buildStructuredTextBlock.mockReturnValue('structured-block');
  });

  it('registers both monitoring resources with the MCP server', async () => {
    const { registerMonitoringResources } = await import(
      '../../../../src/services/monitoring/resources.js'
    );
    const mockServer = createMockMcpServer();

    registerMonitoringResources(mockServer as any);

    expect(mockServer.resource).toHaveBeenCalledTimes(2);
    expect(mockServer.resource).toHaveBeenCalledWith(
      RECENT_RESOURCE,
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockServer.resource).toHaveBeenCalledWith(
      FILTERED_RESOURCE,
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns structured output for recent metrics when data exists', async () => {
    const { registerMonitoringResources } = await import(
      '../../../../src/services/monitoring/resources.js'
    );
    const mockServer = createMockMcpServer();
    const expectedFilter = 'metric.type="custom"';

    process.env.MONITORING_FILTER = expectedFilter;
    mocks.formatTimeSeriesData.mockReturnValue({
      series: [{ metric: 'cpu' }],
      totalSeries: 3,
      omittedSeries: 2,
    });
    mocks.buildStructuredTextBlock.mockReturnValue('recent-block');

    registerMonitoringResources(mockServer as any);

    const handler = getHandlerFor(mockServer, RECENT_RESOURCE);
    const response = await handler(new URL('https://mcp.local/resources/recent'), {});

    expect(mocks.getProjectId).toHaveBeenCalledTimes(1);
    expect(mocks.monitoringClient.listTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'projects/project-from-auth',
        filter: expectedFilter,
      }),
    );
    expect(mocks.buildStructuredTextBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Recent Metrics',
        metadata: expect.objectContaining({ projectId: 'project-from-auth', filter: expectedFilter }),
        note: 'Showing 1 of 3 series.',
      }),
    );
    expect(response.contents[0]).toEqual({
      uri: 'https://mcp.local/resources/recent',
      text: 'recent-block',
    });
  });

  it('falls back to default text when no recent metrics match the filter', async () => {
    const { registerMonitoringResources } = await import(
      '../../../../src/services/monitoring/resources.js'
    );
    const mockServer = createMockMcpServer();

    mocks.monitoringClient.listTimeSeries.mockResolvedValue([[]]);

    registerMonitoringResources(mockServer as any);

    const handler = getHandlerFor(mockServer, RECENT_RESOURCE);
    const response = await handler(new URL('https://mcp.local/resources/recent'), {
      projectId: 'explicit-project',
    });

    expect(mocks.getProjectId).not.toHaveBeenCalled();
    expect(mocks.buildStructuredTextBlock).not.toHaveBeenCalled();
    expect(response.contents[0].text).toContain('No metrics found matching filter');
    expect(response.contents[0].text).toContain('explicit-project');
  });

  it('decodes the filter template parameter for filtered metrics', async () => {
    const { registerMonitoringResources } = await import(
      '../../../../src/services/monitoring/resources.js'
    );
    const mockServer = createMockMcpServer();
    mocks.buildStructuredTextBlock.mockReturnValue('filtered-block');

    registerMonitoringResources(mockServer as any);

    const handler = getHandlerFor(mockServer, FILTERED_RESOURCE);
    const response = await handler(new URL('https://mcp.local/resources/filter'), {
      projectId: 'manual-project',
      filter: ['metric.type%3D%22custom.cpu%22'],
    });

    expect(mocks.monitoringClient.listTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'projects/manual-project',
        filter: 'metric.type="custom.cpu"',
      }),
    );
    expect(response.contents[0].text).toBe('filtered-block');
    expect(mocks.getProjectId).not.toHaveBeenCalled();
  });

  it('wraps monitoring API failures in a GcpMcpError for recent metrics', async () => {
    const { registerMonitoringResources } = await import(
      '../../../../src/services/monitoring/resources.js'
    );
    const mockServer = createMockMcpServer();

    mocks.monitoringClient.listTimeSeries.mockRejectedValue(new Error('boom'));

    registerMonitoringResources(mockServer as any);

    const handler = getHandlerFor(mockServer, RECENT_RESOURCE);

    const caught = await handler(new URL('https://mcp.local/resources/recent'), {}).catch(
      (error) => error,
    );

    expect(caught).toBeInstanceOf(GcpMcpError);
    expect(caught).toMatchObject({
      message: 'Failed to retrieve recent metrics: boom',
      code: 'UNKNOWN',
      statusCode: 500,
    });
  });
});
