/**
 * Tests for Spanner service tools
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/services/spanner/query-safety.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/services/spanner/query-safety.js')>(
    '../../../../src/services/spanner/query-safety.js'
  );

  return {
    ...actual,
    assertReadOnlySpannerQuery: vi.fn(actual.assertReadOnlySpannerQuery),
  };
});

// Import mocks first
import '../../../mocks/google-cloud-mocks.js';
import { mockSpannerClient } from '../../../mocks/google-cloud-mocks.js';
import { createMockMcpServer } from '../../../utils/test-helpers.js';
import { assertReadOnlySpannerQuery } from '../../../../src/services/spanner/query-safety.js';

function createNaturalLanguageDatabaseMock(finalRows: Array<Record<string, unknown>> = [{ id: '1', name: 'Alice' }]) {
  const run = vi
    .fn()
    .mockResolvedValueOnce([
      [{ table_name: 'test_table' }],
      {},
    ])
    .mockResolvedValueOnce([
      [
        { column_name: 'id', spanner_type: 'STRING(36)', is_nullable: 'NO' },
        { column_name: 'name', spanner_type: 'STRING(255)', is_nullable: 'YES' },
      ],
      {},
    ])
    .mockResolvedValueOnce([[], {}])
    .mockResolvedValueOnce([[], {}])
    .mockResolvedValueOnce([
      [{ table_name: 'test_table' }],
      {},
    ])
    .mockResolvedValueOnce([finalRows, {}]);

  return {
    run,
    runStream: vi.fn().mockReturnValue({
      on: vi.fn(),
      pipe: vi.fn(),
    }),
    getSchema: vi.fn().mockResolvedValue([
      {
        name: 'test_table',
        columns: [
          { name: 'id', type: 'STRING(36)', nullable: false },
          { name: 'name', type: 'STRING(255)', nullable: true },
        ],
      },
    ]),
  };
}

describe('Spanner Tools', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    
    // Reset mock implementations
    const mockDatabase = {
      run: vi.fn().mockResolvedValue([[], {}]),
      runStream: vi.fn().mockReturnValue({
        on: vi.fn(),
        pipe: vi.fn(),
      }),
      getSchema: vi.fn().mockResolvedValue([{
        name: 'test_table',
        columns: [
          { name: 'id', type: 'STRING(36)', nullable: false },
          { name: 'name', type: 'STRING(255)', nullable: true }
        ]
      }])
    };
    
    const mockInstance = {
      database: vi.fn().mockReturnValue(mockDatabase),
      getDatabases: vi.fn().mockResolvedValue([
        [{ name: 'test-database' }],
        {}
      ])
    };
    
    mockSpannerClient.instance.mockReturnValue(mockInstance);
  });

  describe('registerSpannerTools', () => {
    it('should register spanner tools with MCP server', async () => {
      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      
      registerSpannerTools(mockServer as any);
      
      expect(mockServer.tool).toHaveBeenCalledWith(
        'gcp-spanner-execute-query',
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockServer.tool).toHaveBeenCalledWith(
        'gcp-spanner-list-databases',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle execute-spanner-query tool execution', async () => {
      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      
      registerSpannerTools(mockServer as any);
      
      const toolCall = mockServer.tool.mock.calls.find(
        call => call[0] === 'gcp-spanner-execute-query'
      );
      
      expect(toolCall).toBeDefined();
      
      const toolHandler = toolCall![2];
      const result = await toolHandler({
        instanceId: 'test-instance',
        databaseId: 'test-database',
        sql: 'SELECT * FROM test_table LIMIT 10'
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should allow read-only queries that use CTEs', async () => {
      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      
      registerSpannerTools(mockServer as any);
      
      const toolCall = mockServer.tool.mock.calls.find(
        call => call[0] === 'gcp-spanner-execute-query'
      );
      
      const toolHandler = toolCall![2];
      const result = await toolHandler({
        instanceId: 'test-instance',
        databaseId: 'test-database',
        sql: 'WITH recent AS (SELECT * FROM test_table) SELECT * FROM recent'
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should block destructive queries', async () => {
      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      
      registerSpannerTools(mockServer as any);
      
      const toolCall = mockServer.tool.mock.calls.find(
        call => call[0] === 'gcp-spanner-execute-query'
      );
      
      const toolHandler = toolCall![2];
      
      await expect(toolHandler({
        instanceId: 'test-instance',
        databaseId: 'test-database',
        sql: 'INSERT INTO test_table (id) VALUES (1)'
      })).rejects.toThrow(/read-only/i);
    });

    it('should enforce read-only guard for natural language helper', async () => {
      const readOnlySpy = vi.mocked(assertReadOnlySpannerQuery);
      readOnlySpy.mockClear();

      const mockDatabase = createNaturalLanguageDatabaseMock();

      const mockInstance = {
        database: vi.fn().mockReturnValue(mockDatabase),
        getDatabases: vi.fn().mockResolvedValue([
          [{ name: 'test-database' }],
          {},
        ]),
      };

      mockSpannerClient.instance.mockReturnValue(mockInstance);

      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      registerSpannerTools(mockServer as any);

      const toolCall = mockServer.tool.mock.calls.find(
        call => call[0] === 'gcp-spanner-query-natural-language'
      );

      expect(toolCall).toBeDefined();

      const toolHandler = toolCall![2];
      const result = await toolHandler({
        instanceId: 'test-instance',
        databaseId: 'test-database',
        query: 'show all data from test_table'
      });

      expect(result).toBeDefined();
      expect(readOnlySpy).toHaveBeenCalledWith(expect.stringMatching(/^SELECT\s+\*/i));
    });

    it('should surface guard failures for natural language helper', async () => {
      const readOnlySpy = vi.mocked(assertReadOnlySpannerQuery);
      readOnlySpy.mockImplementationOnce(() => {
        throw new Error('Blocked unsafe SQL. INSERT statements modify data.');
      });

      const mockDatabase = createNaturalLanguageDatabaseMock();

      const mockInstance = {
        database: vi.fn().mockReturnValue(mockDatabase),
        getDatabases: vi.fn().mockResolvedValue([
          [{ name: 'test-database' }],
          {},
        ]),
      };

      mockSpannerClient.instance.mockReturnValue(mockInstance);

      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      registerSpannerTools(mockServer as any);

      const toolCall = mockServer.tool.mock.calls.find(
        call => call[0] === 'gcp-spanner-query-natural-language'
      );

      const toolHandler = toolCall![2];
      const result = await toolHandler({
        instanceId: 'test-instance',
        databaseId: 'test-database',
        query: 'show all data from test_table'
      });

      expect(result).toBeDefined();
      expect(result.content?.[0]?.text).toContain('Blocked unsafe SQL');
    });

    it('should handle list-spanner-databases tool execution', async () => {
      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      
      registerSpannerTools(mockServer as any);
      
      const toolCall = mockServer.tool.mock.calls.find(
        call => call[0] === 'gcp-spanner-list-databases'
      );
      
      expect(toolCall).toBeDefined();
      
      const toolHandler = toolCall![2];
      const result = await toolHandler({
        instanceId: 'test-instance'
      });
      
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      const { registerSpannerTools } = await import('../../../../src/services/spanner/tools.js');
      
      // Mock error in database operation
      const mockDatabase = {
        run: vi.fn().mockRejectedValue(new Error('Database error')),
        runStream: vi.fn(),
        getSchema: vi.fn()
      };
      
      const mockInstance = {
        database: vi.fn().mockReturnValue(mockDatabase)
      };
      
      mockSpannerClient.instance.mockReturnValue(mockInstance);
      
      registerSpannerTools(mockServer as any);
      
      const toolCall = mockServer.tool.mock.calls.find(
        call => call[0] === 'gcp-spanner-execute-query'
      );
      
      const toolHandler = toolCall![2];
      
      try {
        await toolHandler({
          instanceId: 'test-instance',
          databaseId: 'test-database',
          sql: 'SELECT * FROM test_table'
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('Database error');
      }
    });
  });
});
