/**
 * Tests for Support API client
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../mocks/google-cloud-mocks.js';

const mockAuthClient = {
  getClient: vi.fn(),
};

const mockAccessTokenClient = {
  getAccessToken: vi.fn(),
};

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../../../src/utils/auth.js', () => ({
  initGoogleAuth: vi.fn(),
  getProjectId: vi.fn().mockResolvedValue('test-project'),
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  logger: mockLogger,
}));

const mockFetch = vi.fn();

global.fetch = mockFetch as any;

describe('SupportApiClient', () => {
  const createResponse = ({
    ok = true,
    status = 200,
    statusText = 'OK',
    body = { message: 'ok' },
    text = undefined as string | undefined,
  } = {}) => ({
    ok,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(text ?? JSON.stringify(body)),
    headers: new Headers(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(createResponse());
    mockAccessTokenClient.getAccessToken.mockResolvedValue({ token: 'mock-token' });
    mockAuthClient.getClient.mockResolvedValue(mockAccessTokenClient as any);
  });

  afterEach(() => {
    mockFetch.mockReset();
    mockAccessTokenClient.getAccessToken.mockReset();
    mockAuthClient.getClient.mockReset();
  });

  async function importClient() {
    vi.resetModules();
    const { SupportApiClient } = await import('../../../../src/services/support/client.js');
    const auth = await import('../../../../src/utils/auth.js');
    (auth.initGoogleAuth as ReturnType<typeof vi.fn>).mockResolvedValue(mockAuthClient);
    return SupportApiClient;
  }

  it('sends GET requests with query parameters and authentication headers', async () => {
    const SupportApiClient = await importClient();
    const client = new SupportApiClient();

    await client.request('/projects/test/cases', {
      method: 'GET',
      queryParams: { state: 'OPEN', pageSize: 10, undefinedValue: undefined },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://cloudsupport.googleapis.com/v2/projects/test/cases?state=OPEN&pageSize=10'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
          'X-Goog-User-Project': 'test-project',
        }),
      }),
    );
  });

  it('serializes request bodies for POST requests', async () => {
    const SupportApiClient = await importClient();
    const client = new SupportApiClient('https://example.com/v2');

    await client.request('/cases', {
      method: 'POST',
      body: { foo: 'bar' },
      projectId: 'billing-project',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/v2/cases',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Goog-User-Project': 'billing-project',
        }),
      }),
    );
  });

  it('throws an authentication error when Google auth cannot be initialized', async () => {
    const SupportApiClient = await importClient();
    const auth = await import('../../../../src/utils/auth.js');
    (auth.initGoogleAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const client = new SupportApiClient();

    await expect(client.request('/cases')).rejects.toThrow('Google Cloud authentication is not available');
  });

  it('throws an authentication error when an access token is unavailable', async () => {
    const SupportApiClient = await importClient();
    const client = new SupportApiClient();

    mockAccessTokenClient.getAccessToken.mockResolvedValueOnce(undefined as any);

    await expect(client.request('/cases')).rejects.toThrow('Unable to obtain an access token');
  });

  it('propagates Support API errors with context', async () => {
    const SupportApiClient = await importClient();
    const client = new SupportApiClient();

    mockFetch.mockResolvedValueOnce(
      createResponse({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: 'permission denied',
      }) as any,
    );

    await expect(client.request('/cases')).rejects.toThrow('Support API request failed (403 Forbidden): permission denied');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Support API request failed (403 Forbidden): permission denied'),
    );
  });

  it('returns undefined for empty or 204 responses', async () => {
    const SupportApiClient = await importClient();
    const client = new SupportApiClient();

    mockFetch.mockResolvedValueOnce(
      createResponse({ ok: true, status: 204, statusText: 'No Content', text: '' }) as any,
    );
    await expect(client.request('/cases')).resolves.toBeUndefined();

    mockFetch.mockResolvedValueOnce(
      createResponse({ ok: true, status: 200, statusText: 'OK', text: '' }) as any,
    );
    await expect(client.request('/cases')).resolves.toBeUndefined();
  });

  it('throws when response JSON cannot be parsed', async () => {
    const SupportApiClient = await importClient();
    const client = new SupportApiClient();

    mockFetch.mockResolvedValueOnce(
      createResponse({ ok: true, status: 200, statusText: 'OK', text: 'not json' }) as any,
    );

    await expect(client.request('/cases')).rejects.toThrow('Failed to parse Support API response.');
  });

  it('supports convenience get/post/patch helpers', async () => {
    const SupportApiClient = await importClient();
    const client = new SupportApiClient();

    await client.get('/cases/123', { include: 'details' }, 'billing');
    await client.post('/cases', { foo: 'bar' });
    await client.patch('/cases/123', { bar: 'baz' }, { updateMask: 'bar' });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/cases/123?include=details'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, expect.any(String), expect.objectContaining({ method: 'PATCH' }));
  });
});
