/**
 * Tests for Support service tools
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import shared mocks first
import '../../../mocks/google-cloud-mocks.js';
import { createMockMcpServer } from '../../../utils/test-helpers.js';

const mockAuthClient = {
  getClient: vi.fn(),
};

const mockAccessTokenClient = {
  getAccessToken: vi.fn(),
};

vi.mock('../../../../src/utils/auth.js', () => ({
  initGoogleAuth: vi.fn().mockResolvedValue(mockAuthClient),
  getProjectId: vi.fn().mockResolvedValue('test-project'),
}));

const mockFetch = vi.fn();

global.fetch = mockFetch as any;

describe('Support Tools', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();

    mockAccessTokenClient.getAccessToken.mockResolvedValue({ token: 'mock-token' });
    mockAuthClient.getClient.mockResolvedValue(mockAccessTokenClient as any);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          cases: [
            {
              name: 'projects/test-project/cases/123',
              displayName: 'Example Case',
              description: 'Example description',
              state: 'NEW',
              priority: 'P3',
            },
          ],
          nextPageToken: 'next-token',
        })
      ),
      headers: new Headers(),
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
    mockAccessTokenClient.getAccessToken.mockReset();
    mockAuthClient.getClient.mockReset();
  });

  it('registers all support tools with the MCP server', async () => {
    const { registerSupportTools } = await import('../../../../src/services/support/tools.js');

    registerSupportTools(mockServer as any);

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-list-cases',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-search-cases',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-get-case',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-create-case',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-update-case',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-close-case',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-list-comments',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-create-comment',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-list-attachments',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'gcp-support-search-classifications',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('lists support cases successfully', async () => {
    const { registerSupportTools } = await import('../../../../src/services/support/tools.js');
    registerSupportTools(mockServer as any);

    const toolCall = mockServer.registerTool.mock.calls.find(
      call => call[0] === 'gcp-support-list-cases'
    );

    expect(toolCall).toBeDefined();

    const handler = toolCall![2];
    const result = await handler({ pageSize: 10 });

    expect(result.content[0].text).toContain('Support Cases');
    expect(result.content[0].text).toContain('Example Case');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://cloudsupport.googleapis.com/v2/projects/test-project/cases'),
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('creates a support case successfully', async () => {
    const { registerSupportTools } = await import('../../../../src/services/support/tools.js');
    registerSupportTools(mockServer as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          name: 'projects/test-project/cases/456',
          displayName: 'New Case',
          description: 'Detailed description of the new case',
          priority: 'P2',
          state: 'NEW',
        })
      ),
      headers: new Headers(),
    });

    const toolCall = mockServer.registerTool.mock.calls.find(
      call => call[0] === 'gcp-support-create-case'
    );

    expect(toolCall).toBeDefined();

    const handler = toolCall![2];
    const result = await handler({
      displayName: 'New Case',
      description: 'Detailed description of the new case',
      classificationId: '12345',
      priority: 'P2',
    });

    expect(result.content[0].text).toContain('New Case');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/projects/test-project/cases',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          case: {
            displayName: 'New Case',
            description: 'Detailed description of the new case',
            priority: 'P2',
            classification: { id: '12345' },
          },
        }),
      })
    );
  });

  it('supports organization scoped case names', async () => {
    const { registerSupportTools } = await import('../../../../src/services/support/tools.js');
    registerSupportTools(mockServer as any);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          comments: [
            {
              name: 'organizations/123456789/cases/abc/comments/1',
              body: 'Org comment',
              createTime: '2024-01-01T00:00:00Z',
              creator: { displayName: 'Support Engineer' },
            },
          ],
        })
      ),
      headers: new Headers(),
    });

    const toolCall = mockServer.registerTool.mock.calls.find(
      call => call[0] === 'gcp-support-list-comments'
    );

    expect(toolCall).toBeDefined();

    const handler = toolCall![2];
    const result = await handler({
      name: 'organizations/123456789/cases/abc',
      pageSize: 5,
    });

    expect(result.content[0].text).toContain('organizations/123456789/cases/abc');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://cloudsupport.googleapis.com/v2/organizations/123456789/cases/abc/comments'
      ),
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('handles support API errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const { registerSupportTools } = await import('../../../../src/services/support/tools.js');
    registerSupportTools(mockServer as any);

    const toolCall = mockServer.registerTool.mock.calls.find(
      call => call[0] === 'gcp-support-list-cases'
    );

    const handler = toolCall![2];
    const result = await handler({ pageSize: 5 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list support cases');
  });
});
