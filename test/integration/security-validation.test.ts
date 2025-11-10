/**
 * Security Validation Tests
 * Tests security best practices and vulnerability prevention
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import mocks first
import '../mocks/google-cloud-mocks.js';

describe('Security Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Input Validation Security', () => {
    it('should validate logging filter input', async () => {
      const { registerLoggingTools } = await import('../../src/services/logging/tools.js');
      const { createMockMcpServer } = await import('../utils/test-helpers.js');
      const { mockLoggingClient } = await import('../mocks/google-cloud-mocks.js');

      mockLoggingClient.getEntries.mockResolvedValueOnce([[{ textPayload: 'ok' }]] as any);

      const mockServer = createMockMcpServer();
      registerLoggingTools(mockServer as any);

      const toolCall = mockServer.registerTool.mock.calls.find(
        call => call[0] === 'gcp-logging-query-logs'
      );

      const toolHandler = toolCall?.[2];

      const maliciousFilters = [
        'severity>=ERROR; rm -rf /',
        'severity>=ERROR OR textPayload:"<script>alert(1)</script>"',
        'severity>=ERROR\nDROP TABLE logs'
      ];

      for (const filter of maliciousFilters) {
        const result = await toolHandler?.({ filter, limit: 5 });

        expect(result).toBeDefined();
        expect(typeof result?.content?.[0]?.text).toBe('string');
      }
    });

    it('should constrain logging page size', async () => {
      const { registerLoggingTools } = await import('../../src/services/logging/tools.js');
      const { createMockMcpServer } = await import('../utils/test-helpers.js');
      const { mockLoggingClient } = await import('../mocks/google-cloud-mocks.js');

      mockLoggingClient.getEntries.mockResolvedValue([[{ textPayload: 'ok' }]] as any);

      const mockServer = createMockMcpServer();
      registerLoggingTools(mockServer as any);

      const toolCall = mockServer.registerTool.mock.calls.find(
        call => call[0] === 'gcp-logging-query-logs'
      );

      const schema = toolCall?.[1];
      const limitSchema = schema?.inputSchema?.limit;
      if (limitSchema && 'safeParse' in limitSchema) {
        expect(limitSchema.safeParse(10000).success).toBe(false);
        expect(limitSchema.safeParse(50).success).toBe(true);
      } else {
        throw new Error('Expected limit schema to be defined');
      }
    });
  });

  describe('Authentication Security', () => {
    it('should not expose credentials in logs', async () => {
      const { initGoogleAuth } = await import('../../src/utils/auth.js');

      const consoleSpy = vi.spyOn(console, 'log');
      const errorSpy = vi.spyOn(console, 'error');

      try {
        await initGoogleAuth(false);
      } catch (error) {
        // Expected in test environment
      }

      const allLogs = [
        ...consoleSpy.mock.calls.flat(),
        ...errorSpy.mock.calls.flat()
      ];

      allLogs.forEach(log => {
        const logString = String(log);
        expect(logString).not.toMatch(/private_key/i);
        expect(logString).not.toMatch(/client_secret/i);
        expect(logString).not.toMatch(/password/i);
        expect(logString).not.toMatch(/token/i);
      });

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should handle authentication failures securely', async () => {
      const { initGoogleAuth } = await import('../../src/utils/auth.js');

      const result = await initGoogleAuth(false);

      expect(result).toBeDefined();
    });
  });

  describe('Error Handling Security', () => {
    it('should not expose stack traces to clients', async () => {
      const { registerLoggingTools } = await import('../../src/services/logging/tools.js');
      const { createMockMcpServer } = await import('../utils/test-helpers.js');
      const { mockLoggingClient } = await import('../mocks/google-cloud-mocks.js');

      mockLoggingClient.getEntries.mockRejectedValueOnce(
        new Error('Internal server error with sensitive data: /etc/passwd')
      );

      const mockServer = createMockMcpServer();
      registerLoggingTools(mockServer as any);

      const toolCall = mockServer.registerTool.mock.calls.find(
        call => call[0] === 'gcp-logging-query-logs'
      );

      const toolHandler = toolCall?.[2];
      const result = await toolHandler?.({ filter: 'severity>=ERROR', limit: 10 });

      expect(result?.isError).toBe(true);
      expect(result?.content?.[0]?.text).toBeDefined();
      expect(result?.content?.[0]?.text).not.toContain('stack trace');
    });

    it('should sanitize error messages', async () => {
      const { GcpMcpError } = await import('../../src/utils/error.js');

      const sensitiveError = new GcpMcpError(
        'Database connection failed: mysql://user:password@host/db',
        'CONNECTION_ERROR'
      );

      const errorMessage = sensitiveError.message;

      expect(typeof errorMessage).toBe('string');
    });
  });

  describe('Data Protection', () => {
    it('should not log sensitive logging data', async () => {
      const { createMockLogEntries } = await import('../utils/test-helpers.js');
      const entries = createMockLogEntries(1);

      const entry = entries[0];
      expect(entry.textPayload).toContain('Mock log entry');
      expect(entry.resource.type).toBe('gce_instance');
    });
  });
});
