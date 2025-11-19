import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { TransportManager } from '../../../src/utils/transport-manager.js';
import type {
  ISessionManager,
  SecurityValidator,
  ILogger,
  TransportConfig,
} from '../../../src/utils/interfaces.js';

class MockResponse extends EventEmitter {
  statusCode: number | undefined;
  headers: Record<string, string> = {};
  body = '';
  writableEnded = false;

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode;
    this.headers = { ...headers };
    return this;
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  end(chunk?: string): this {
    if (chunk) {
      this.body += chunk;
    }
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }
}

class MockRequest extends EventEmitter {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders = {};
  connection: { remoteAddress: string } = { remoteAddress: '127.0.0.1' };
  destroyed = false;

  destroy = vi.fn(() => {
    this.destroyed = true;
  });
}

type TransportDeps = {
  server: McpServer;
  sessionManager: ISessionManager;
  securityValidator: SecurityValidator;
  logger: ILogger;
  config?: Partial<TransportConfig>;
};

const createDeps = (overrides: Partial<TransportDeps> = {}): TransportDeps => {
  const server = ({ connect: vi.fn().mockResolvedValue(undefined) } as unknown) as McpServer;
  const sessionManager: ISessionManager = {
    createSession: vi.fn().mockReturnValue('session-1'),
    validateSession: vi.fn().mockReturnValue(true),
    invalidateSession: vi.fn().mockReturnValue(true),
    rotateSessionId: vi.fn(),
    getSessionMetadata: vi.fn(),
    updateSessionMetadata: vi.fn(),
    getSessionStats: vi.fn().mockReturnValue({ active: 1, total: 1, expired: 0 }),
    cleanupExpiredSessions: vi.fn().mockReturnValue(0),
  };
  const securityValidator: SecurityValidator = {
    validateOriginHeader: vi.fn().mockReturnValue(true),
    setSecurityHeaders: vi.fn(),
    validateRequestHeaders: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
    sanitiseInput: vi.fn((value) => value),
    validateMethodName: vi.fn().mockReturnValue(true),
    logSecurityEvent: vi.fn(),
  };
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    server,
    sessionManager,
    securityValidator,
    logger,
    ...overrides,
  } as TransportDeps;
};

describe('TransportManager', () => {
  it('starts configured transports in sequence', async () => {
    const deps = createDeps();
    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: true, supportHttp: true, supportSse: false, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 10 },
    );

    const stdioSpy = vi
      .spyOn(manager as unknown as { startStdioTransport: () => Promise<void> }, 'startStdioTransport')
      .mockResolvedValue();
    const httpSpy = vi
      .spyOn(manager as unknown as { startHttpTransport: () => Promise<void> }, 'startHttpTransport')
      .mockResolvedValue();

    await manager.startTransport();

    expect(stdioSpy).toHaveBeenCalledTimes(1);
    expect(httpSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects requests with invalid headers before routing', async () => {
    const deps = createDeps();
    deps.securityValidator.validateRequestHeaders = vi
      .fn()
      .mockReturnValue({ valid: false, errors: ['danger'] });

    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: false, supportHttp: true, supportSse: false, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 1 },
    );

    const req = new MockRequest();
    req.method = 'GET';
    req.headers = {};
    req.url = '/health';

    const res = new MockResponse();

    await (manager as any).handleHttpRequest(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Invalid request headers');
    expect(deps.securityValidator.logSecurityEvent).toHaveBeenCalledWith(
      'suspicious_headers',
      expect.objectContaining({ clientIp: '127.0.0.1' }),
      'medium',
    );
  });

  it('returns 406 for unsupported Accept headers during POST', async () => {
    const deps = createDeps();
    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: false, supportHttp: true, supportSse: false, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 1 },
    );

    const req = new MockRequest();
    req.method = 'POST';
    req.headers = { accept: 'text/plain', 'user-agent': 'vitest' };

    const res = new MockResponse();

    const completed = new Promise<void>((resolve) => {
      res.once('finish', () => resolve());
    });

    await (manager as any).handlePostRequest(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);

    req.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'listResources', id: 1 })));
    req.emit('end');

    await completed;

    expect(res.statusCode).toBe(406);
    expect(res.body).toContain('Unsupported Accept header');
    expect(req.destroy).toHaveBeenCalled();
    expect(deps.securityValidator.logSecurityEvent).toHaveBeenCalledWith(
      'unsupported_accept',
      expect.objectContaining({ clientId: '127.0.0.1' }),
      'medium',
    );
  });

  it('throttles requests when the rate limiter rejects the client', async () => {
    const deps = createDeps();
    deps.securityValidator.checkRateLimit = vi.fn().mockReturnValue({
      allowed: false,
      retryAfter: 42,
    });
    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: false, supportHttp: true, supportSse: false, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 5 },
    );

    const req = new MockRequest();
    req.method = 'GET';
    req.url = '/health';
    req.headers = { origin: 'https://allowed', 'user-agent': 'vitest' } as http.IncomingHttpHeaders;
    const res = new MockResponse();

    await (manager as any).handleHttpRequest(req as any, res as any);

    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('Too Many Requests');
    expect(deps.securityValidator.logSecurityEvent).toHaveBeenCalledWith(
      'rate_limit_exceeded',
      expect.objectContaining({ retryAfter: 42 }),
      'medium',
    );
  });

  it('rejects requests that fail the origin validator', async () => {
    const deps = createDeps();
    deps.securityValidator.validateOriginHeader = vi.fn().mockReturnValue(false);
    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: false, supportHttp: true, supportSse: false, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 5 },
    );

    const req = new MockRequest();
    req.method = 'GET';
    req.url = '/health';
    req.headers = { origin: 'https://evil', 'user-agent': 'bad' } as http.IncomingHttpHeaders;
    const res = new MockResponse();

    await (manager as any).handleHttpRequest(req as any, res as any);

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Forbidden: Invalid origin');
    expect(deps.securityValidator.logSecurityEvent).toHaveBeenCalledWith(
      'invalid_origin',
      expect.objectContaining({ origin: 'https://evil' }),
      'high',
    );
  });

  it('enforces the active connection limit before routing', async () => {
    const deps = createDeps();
    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: false, supportHttp: true, supportSse: false, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 1 },
    );

    (manager as any).activeConnections.add(new MockResponse() as any);

    const req = new MockRequest();
    req.method = 'GET';
    req.url = '/health';
    req.headers = { origin: 'https://allowed', 'user-agent': 'vitest' } as http.IncomingHttpHeaders;
    const res = new MockResponse();

    await (manager as any).handleHttpRequest(req as any, res as any);

    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('Too many connections');
    expect(deps.securityValidator.logSecurityEvent).toHaveBeenCalledWith(
      'connection_limit_exceeded',
      expect.objectContaining({ maxConnections: 1 }),
      'medium',
    );
  });

  it('maintains SSE connections with heartbeats and cleanup', async () => {
    vi.useFakeTimers();
    try {
      const deps = createDeps();
      const manager = new TransportManager(
        deps.server,
        deps.sessionManager,
        deps.securityValidator,
        deps.logger,
        { supportStdio: false, supportHttp: false, supportSse: true, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 5 },
      );

      const req = new MockRequest();
      req.headers = { host: 'localhost:3000', 'user-agent': 'vitest' } as http.IncomingHttpHeaders;
      const res = new MockResponse();

      await (manager as any).handleSseConnection(req as any, res as any);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('event: connected');
      expect((manager as any).activeConnections.size).toBe(1);

      vi.advanceTimersByTime(30000);
      expect(res.body).toContain('event: heartbeat');

      req.emit('close');
      expect(deps.sessionManager.invalidateSession).toHaveBeenCalledWith('session-1');
      expect((manager as any).activeConnections.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('responds to OPTIONS preflight requests with the documented headers', () => {
    const deps = createDeps();
    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: false },
    );

    const res = new MockResponse();
    (manager as any).handleOptionsRequest(res as any);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(res.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
  });

  it('exposes transport and session stats through the health endpoint', () => {
    const deps = createDeps();
    deps.sessionManager.getSessionStats = vi
      .fn()
      .mockReturnValue({ active: 3, total: 5, expired: 0 });
    const manager = new TransportManager(
      deps.server,
      deps.sessionManager,
      deps.securityValidator,
      deps.logger,
      { supportStdio: false, supportHttp: true, supportSse: true, httpPort: 0, httpHost: '127.0.0.1', maxConnections: 5 },
    );

    (manager as any).activeConnections.add(new MockResponse() as any);
    const res = new MockResponse();
    (manager as any).handleHealthCheck(res as any);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.activeConnections).toBe(1);
    expect(payload.activeSessions).toBe(3);
    expect(payload.transport).toEqual({ stdio: false, http: true, sse: true });
  });
});
