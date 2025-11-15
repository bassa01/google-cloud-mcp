/**
 * Tests for Logging service tools
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import mocks first
import '../../../mocks/google-cloud-mocks.js';
import { mockAuthClient, mockLoggingClient, mockAuthorizedHttpClient } from '../../../mocks/google-cloud-mocks.js';
import { createMockMcpServer, createMockLogEntries } from '../../../utils/test-helpers.js';

describe('Logging Tools', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();

    process.env.GOOGLE_CLIENT_EMAIL = 'test@example.com';
    process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

    // Reset mock implementations
    mockLoggingClient.getEntries.mockResolvedValue([createMockLogEntries(), {}, {}]);
    mockLoggingClient.createSink.mockResolvedValue([{ name: 'test-sink' }]);
    mockAuthorizedHttpClient.request.mockReset();
    mockAuthorizedHttpClient.getAccessToken.mockResolvedValue({ token: 'mock-token' });
    mockAuthClient.getClient.mockResolvedValue(mockAuthorizedHttpClient);
  });

  describe('registerLoggingTools', () => {
    it('should register logging tools with MCP server', async () => {
      const { registerLoggingTools } = await import('../../../../src/services/logging/tools.js');
      
      registerLoggingTools(mockServer as any);
      
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'gcp-logging-query-logs',
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'gcp-logging-search-comprehensive',
        expect.any(Object),
        expect.any(Function)
      );

      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'gcp-logging-log-analytics-query',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle search-logs tool execution', async () => {
      const { registerLoggingTools } = await import('../../../../src/services/logging/tools.js');
      
      registerLoggingTools(mockServer as any);
      
      const toolCall = mockServer.registerTool.mock.calls.find(
        call => call[0] === 'gcp-logging-query-logs'
      );
      
      expect(toolCall).toBeDefined();
      
      const toolHandler = toolCall![2];
      const result = await toolHandler({
        filter: 'severity>=ERROR',
        pageSize: 10
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Log Query Results');
    });

    it('should handle search-logs-comprehensive tool execution', async () => {
      const { registerLoggingTools } = await import('../../../../src/services/logging/tools.js');
      
      registerLoggingTools(mockServer as any);
      
      const toolCall = mockServer.registerTool.mock.calls.find(
        call => call[0] === 'gcp-logging-search-comprehensive'
      );
      
      expect(toolCall).toBeDefined();
      
      const toolHandler = toolCall![2];
      const result = await toolHandler({
        searchTerm: 'error',
        searchFields: ['textPayload', 'jsonPayload'],
        timeRange: '1h'
      });
      
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('Comprehensive Log Search Results');
    });

    it('should handle errors gracefully', async () => {
      const { registerLoggingTools } = await import('../../../../src/services/logging/tools.js');
      
      // Mock error
      mockLoggingClient.getEntries.mockRejectedValue(new Error('Logging API Error'));
      
      registerLoggingTools(mockServer as any);
      
      const toolCall = mockServer.registerTool.mock.calls.find(
        call => call[0] === 'gcp-logging-query-logs'
      );
      
      const toolHandler = toolCall![2];
      const result = await toolHandler({
        filter: 'severity>=ERROR'
      });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });

    it('should execute log analytics queries via Log Analytics API', async () => {
      const { registerLoggingTools } = await import('../../../../src/services/logging/tools.js');

      registerLoggingTools(mockServer as any);

      const toolCall = mockServer.registerTool.mock.calls.find(
        call => call[0] === 'gcp-logging-log-analytics-query'
      );

      expect(toolCall).toBeDefined();

      mockAuthorizedHttpClient.request
        .mockResolvedValueOnce({
          data: { queryStepHandles: ['handle-123'] },
        })
        .mockResolvedValueOnce({
          data: {
            queryComplete: true,
            rows: [{ count: 1 }],
            totalRows: 1,
            resultReference: 'result-123',
          },
        });

      const toolHandler = toolCall![2];
      const result = await toolHandler({
        sql: 'SELECT COUNT(*) FROM {{log_view}}',
      });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('Log Analytics Query Results');

      expect(mockAuthorizedHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('entries:queryData'),
          method: 'POST',
        })
      );
      expect(mockAuthorizedHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('entries:readQueryResults'),
          method: 'POST',
        })
      );
    });
  });
});
