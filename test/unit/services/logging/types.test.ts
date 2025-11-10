/**
 * Tests for Logging service types and utilities
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import mocks first
import '../../../mocks/google-cloud-mocks.js';
import { createMockLogEntries } from '../../../utils/test-helpers.js';

describe('Logging Types and Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatLogEntry', () => {
    it('should format log entry correctly', async () => {
      const { formatLogEntry } = await import('../../../../src/services/logging/types.js');
      const mockEntry = createMockLogEntries(1)[0];
      
      const formatted = formatLogEntry(mockEntry as any);
      
      expect(formatted.severity).toBe('INFO');
      expect(formatted.resource?.type).toBe('gce_instance');
      expect(formatted.payload.type).toBe('text');
      expect(formatted.payload.value).toContain(mockEntry.textPayload);
    });

    it('should handle log entry with JSON payload', async () => {
      const { formatLogEntry } = await import('../../../../src/services/logging/types.js');
      const mockEntry = {
        timestamp: new Date().toISOString(),
        severity: 'INFO',
        jsonPayload: { message: 'JSON log message', userId: 123 },
        resource: {
          type: 'gce_instance',
          labels: { instance_id: 'test-instance' }
        }
      };
      
      const formatted = formatLogEntry(mockEntry as any);
      
      expect(formatted.payload.type).toBe('json');
      expect(formatted.payload.value).toMatchObject({ message: 'JSON log message', userId: 123 });
    });

    it('should handle log entry with minimal data', async () => {
      const { formatLogEntry } = await import('../../../../src/services/logging/types.js');
      const minimalEntry = {
        timestamp: new Date().toISOString(),
        severity: 'INFO'
      };
      
      const formatted = formatLogEntry(minimalEntry as any);
      
      expect(formatted.severity).toBe('INFO');
      expect(formatted.payload.value).toBe('[no payload available]');
    });
  });

  describe('getLoggingClient', () => {
    it('should return logging client instance', async () => {
      const { getLoggingClient } = await import('../../../../src/services/logging/types.js');
      
      const client = getLoggingClient();
      expect(client).toBeDefined();
    });

    it('should return same client instance on multiple calls', async () => {
      const { getLoggingClient } = await import('../../../../src/services/logging/types.js');
      
      const client1 = getLoggingClient();
      const client2 = getLoggingClient();
      
      expect(client1).toBe(client2);
    });
  });
});
