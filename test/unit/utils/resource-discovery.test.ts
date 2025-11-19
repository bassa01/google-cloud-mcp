import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockMcpServer } from '../../utils/test-helpers.js';

const getProjectIdMock = vi.fn().mockResolvedValue('test-project');

vi.mock('../../../src/utils/auth.js', () => ({
  getProjectId: getProjectIdMock,
}));

describe('resource discovery registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers discovery resources with canonical URIs', async () => {
    const { registerResourceDiscovery } = await import(
      '../../../src/utils/resource-discovery.js'
    );
    const mockServer = createMockMcpServer();

    await registerResourceDiscovery(mockServer as any);

    expect(getProjectIdMock).toHaveBeenCalledTimes(1);
    expect(mockServer.resource).toHaveBeenCalledTimes(4);
    expect(mockServer.resource).toHaveBeenCalledWith(
      'resource-list',
      'resources://list',
      expect.any(Function),
    );
    expect(mockServer.resource).toHaveBeenCalledWith(
      'spanner-resources',
      'resources://spanner',
      expect.any(Function),
    );
    expect(mockServer.resource).toHaveBeenCalledWith(
      'logging-resources',
      'resources://logging',
      expect.any(Function),
    );
    expect(mockServer.resource).toHaveBeenCalledWith(
      'monitoring-resources',
      'resources://monitoring',
      expect.any(Function),
    );
  });

  it('renders project-aware guidance in each registered handler', async () => {
    const { registerResourceDiscovery } = await import(
      '../../../src/utils/resource-discovery.js'
    );
    const mockServer = createMockMcpServer();

    await registerResourceDiscovery(mockServer as any);

    const resolveHandler = (name: string) => {
      const call = mockServer.resource.mock.calls.find(([resourceName]) => resourceName === name);
      expect(call, `resource handler ${name} should be registered`).toBeDefined();
      return call?.[2];
    };

    const listHandler = resolveHandler('resource-list');
    const listResponse = await listHandler?.(new URL('resources://list'));
    expect(listResponse?.contents?.[0]?.uri).toBe('resources://list');
    expect(listResponse?.contents?.[0]?.text).toContain('gcp-spanner://test-project/instances');
    expect(listResponse?.contents?.[0]?.text).toContain('gcp-logs://test-project/recent');

    const spannerHandler = resolveHandler('spanner-resources');
    const spannerResponse = await spannerHandler?.(new URL('resources://spanner'));
    expect(spannerResponse?.contents?.[0]?.text).toContain('gcp-spanner://test-project/instances');
    expect(spannerResponse?.contents?.[0]?.text).toContain('gcp-spanner://test-project/[instance-id]/databases');

    const loggingHandler = resolveHandler('logging-resources');
    const loggingResponse = await loggingHandler?.(new URL('resources://logging'));
    expect(loggingResponse?.contents?.[0]?.text).toContain('gcp-logs://test-project/recent');

    const monitoringHandler = resolveHandler('monitoring-resources');
    const monitoringResponse = await monitoringHandler?.(new URL('resources://monitoring'));
    expect(monitoringResponse?.contents?.[0]?.text).toContain('gcp-monitoring://test-project/metric-types');
  });
});
