/**
 * Tests for Support service tools
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  const defaultCasesResponse = {
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
  };

  const createResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();

    mockAccessTokenClient.getAccessToken.mockResolvedValue({ token: 'mock-token' });
    mockAuthClient.getClient.mockResolvedValue(mockAccessTokenClient as any);

    mockFetch.mockResolvedValue(createResponse(defaultCasesResponse) as any);
  });

  afterEach(() => {
    mockFetch.mockReset();
    mockAccessTokenClient.getAccessToken.mockReset();
    mockAuthClient.getClient.mockReset();
  });

  async function registerTools() {
    vi.resetModules();
    const module = await import('../../../../src/services/support/tools.js');
    module.registerSupportTools(mockServer as any);
    return module;
  }

  function getHandler(toolName: string) {
    const call = mockServer.registerTool.mock.calls.find(([name]) => name === toolName);
    expect(call).toBeDefined();
    return call![2];
  }

  it('registers all support tools with the MCP server', async () => {
    await registerTools();

    const expectedTools = [
      'gcp-support-list-cases',
      'gcp-support-search-cases',
      'gcp-support-get-case',
      'gcp-support-create-case',
      'gcp-support-update-case',
      'gcp-support-close-case',
      'gcp-support-list-comments',
      'gcp-support-create-comment',
      'gcp-support-list-attachments',
      'gcp-support-search-classifications',
    ];

    for (const tool of expectedTools) {
      expect(mockServer.registerTool).toHaveBeenCalledWith(tool, expect.any(Object), expect.any(Function));
    }
  });

  it('lists support cases successfully', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-list-cases');

    const result = await handler({ pageSize: 10 });

    expect(result.content[0].text).toContain('Support Cases');
    expect(result.content[0].text).toContain('Example Case');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://cloudsupport.googleapis.com/v2/projects/test-project/cases?pageSize=10'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('searches support cases with filters', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-search-cases');

    await handler({ query: 'state=OPEN', pageSize: 5 });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/projects/test-project/cases:search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'state=OPEN', pageSize: 5 }),
      }),
    );
  });

  it('retrieves individual support case details', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-get-case');

    mockFetch.mockResolvedValueOnce(
      createResponse({
        name: 'projects/test-project/cases/123',
        displayName: 'Detailed Case',
        description: 'Full description',
      }) as any,
    );

    const result = await handler({ name: 'projects/test-project/cases/123' });

    expect(result.content[0].text).toContain('Support Case Details');
    expect(result.content[0].text).toContain('Detailed Case');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/projects/test-project/cases/123',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('creates a support case successfully', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-create-case');

    mockFetch.mockResolvedValueOnce(
      createResponse({
        name: 'projects/test-project/cases/456',
        displayName: 'New Case',
        description: 'Detailed description of the new case',
        priority: 'P2',
        state: 'NEW',
      }) as any,
    );

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
      }),
    );
  });

  it('updates a support case and builds the correct update mask', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-update-case');

    mockFetch.mockResolvedValueOnce(
      createResponse({
        name: 'projects/test-project/cases/123',
        displayName: 'Updated Case',
        description: 'Updated',
        priority: 'P1',
      }) as any,
    );

    await handler({
      name: 'projects/test-project/cases/123',
      displayName: 'Updated Case',
      description: 'Updated',
      classificationId: '999',
      priority: 'P1',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://cloudsupport.googleapis.com/v2/projects/test-project/cases/123?updateMask='),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          case: {
            displayName: 'Updated Case',
            description: 'Updated',
            priority: 'P1',
            classification: { id: '999' },
          },
        }),
      }),
    );
  });

  it('returns an error if no update fields are provided', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-update-case');

    const result = await handler({ name: 'projects/test-project/cases/123' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No update fields were provided');
  });

  it('closes a support case with optional justification', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-close-case');

    mockFetch.mockResolvedValueOnce(
      createResponse({
        name: 'projects/test-project/cases/123',
        state: 'CLOSED',
      }) as any,
    );

    await handler({ name: 'projects/test-project/cases/123', justification: 'resolved' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/projects/test-project/cases/123:close',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ justification: 'resolved' }),
      }),
    );
  });

  it('lists comments for project and organization scoped case names', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-list-comments');

    mockFetch.mockResolvedValue(
      createResponse({
        comments: [
          {
            name: 'projects/test-project/cases/123/comments/1',
            body: 'Mock comment body',
          },
        ],
      }) as any,
    );

    await handler({ name: 'projects/test-project/cases/123', pageSize: 10 });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/projects/test-project/cases/123/comments?pageSize=10',
      expect.objectContaining({ method: 'GET' }),
    );

    await handler({ name: 'organizations/123456789/cases/abc', pageSize: 5 });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/organizations/123456789/cases/abc/comments?pageSize=5',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('creates comments on support cases', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-create-comment');

    mockFetch.mockResolvedValueOnce(
      createResponse({
        name: 'projects/test-project/cases/123/comments/1',
        body: 'Reply',
      }) as any,
    );

    const result = await handler({ name: 'projects/test-project/cases/123', body: 'Reply' });

    expect(result.content[0].text).toContain('Support Case Comment Created');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/projects/test-project/cases/123/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ comment: { body: 'Reply' } }),
      }),
    );
  });

  it('lists attachments for a case', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-list-attachments');

    mockFetch.mockResolvedValueOnce(
      createResponse({
        attachments: [
          { name: 'projects/test-project/cases/123/attachments/1', filename: 'error.log' },
        ],
      }) as any,
    );

    const result = await handler({ name: 'projects/test-project/cases/123', pageSize: 10 });

    expect(result.content[0].text).toContain('Support Case Attachments');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/projects/test-project/cases/123/attachments?pageSize=10',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('searches case classifications to help build new cases', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-search-classifications');

    mockFetch.mockResolvedValueOnce(
      createResponse({
        caseClassifications: [
          { id: '1000', displayName: 'IAM > Service Accounts' },
        ],
      }) as any,
    );

    const result = await handler({ query: 'service account', pageSize: 10 });

    expect(result.content[0].text).toContain('Case Classifications');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cloudsupport.googleapis.com/v2/caseClassifications:search?query=service+account&pageSize=10',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('validates parent arguments and returns structured errors', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-list-cases');

    const result = await handler({ parent: 'invalid-scope', pageSize: 5 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Parent must be formatted as projects/{projectId}');
  });

  it('handles support API errors gracefully', async () => {
    await registerTools();
    const handler = getHandler('gcp-support-list-cases');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal',
      text: vi.fn().mockResolvedValue('boom'),
      headers: new Headers(),
    } as any);

    const result = await handler({ pageSize: 5 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list support cases');
  });
});
