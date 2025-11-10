import { describe, it, expect, afterEach } from 'vitest';

import { sanitizeLogEntry } from '../../../../src/services/logging/sanitizer.js';
import {
  buildRedactionNotice,
  canViewFullLogPayloads,
} from '../../../../src/services/logging/policy.js';
import { LogEntry } from '../../../../src/services/logging/types.js';

const ENV_KEYS = [
  'MCP_USER_ROLES',
  'MCP_ACTIVE_ROLES',
  'MCP_USER_ROLE',
  'LOG_PAYLOAD_FULL_ACCESS_ROLES',
];

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('sanitizeLogEntry', () => {
  const mockEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    severity: 'INFO',
    logName: 'projects/example/logs/test',
    textPayload: 'token=abc123',
    resource: { type: 'gce_instance', labels: {} },
    httpRequest: {
      requestMethod: 'POST',
      requestUrl: 'https://example.com/resource',
      remoteIp: '203.0.113.1',
    },
    jsonPayload: {
      userId: 'sensitive-user',
      requestBody: { card: '4111-1111-1111-1111' },
      meta: 'ok',
    },
  };

  it('redacts IPs, user identifiers, and bodies by default', () => {
    const sanitized = sanitizeLogEntry(mockEntry);

    expect(sanitized.httpRequest?.remoteIp).toBe('[REDACTED_IP]');
    expect(sanitized.textPayload).toBe(
      '[REDACTED_PAYLOAD - requires authorized role]',
    );
    expect((sanitized.jsonPayload as any).userId).toBe('[REDACTED_USER]');
    expect((sanitized.jsonPayload as any).requestBody).toBe('[REDACTED_BODY]');
    expect((sanitized.jsonPayload as any).meta).toBe('ok');
    // Ensure original entry is untouched
    expect(mockEntry.httpRequest?.remoteIp).toBe('203.0.113.1');
  });

  it('returns full payloads when allowed by policy', () => {
    const sanitized = sanitizeLogEntry(mockEntry, { allowFullPayload: true });

    expect(sanitized.textPayload).toBe('token=abc123');
    expect(sanitized.httpRequest?.remoteIp).toBe('203.0.113.1');
    expect((sanitized.jsonPayload as any).userId).toBe('sensitive-user');
  });
});

describe('log payload policy', () => {
  it('denies access when no role matches', () => {
    delete process.env.MCP_USER_ROLES;
    delete process.env.LOG_PAYLOAD_FULL_ACCESS_ROLES;

    expect(canViewFullLogPayloads()).toBe(false);
    expect(buildRedactionNotice(false)).toContain('Full payloads are limited');
  });

  it('allows access when active roles intersect with allowed list', () => {
    process.env.LOG_PAYLOAD_FULL_ACCESS_ROLES = 'security_admin,platform_owner';
    process.env.MCP_USER_ROLES = 'platform_owner,viewer';

    expect(canViewFullLogPayloads()).toBe(true);
    expect(buildRedactionNotice(true)).toBe('');
  });
});
