/**
 * Tests for Trace service types and utilities
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import mocks first
import '../../../mocks/google-cloud-mocks.js';

describe('Trace Types and Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatTraceData', () => {
    it('should format trace data correctly', async () => {
      const { formatTraceData } = await import('../../../../src/services/trace/types.js');
      
      const mockTraceData = {
        traceId: 'trace-123',
        projectId: 'test-project',
        rootSpans: [{
          spanId: 'span-456',
          displayName: 'test-operation',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 1000).toISOString(),
          kind: 'INTERNAL',
          status: 'OK' as any,
          attributes: {
            'http.method': 'GET',
            'http.url': 'https://example.com/api'
          },
          childSpans: []
        }],
        allSpans: [{
          spanId: 'span-456',
          displayName: 'test-operation',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 1000).toISOString(),
          kind: 'INTERNAL',
          status: 'OK' as any,
          attributes: {
            'http.method': 'GET',
            'http.url': 'https://example.com/api'
          },
          childSpans: []
        }]
      };
      
      const formatted = formatTraceData(mockTraceData);
      
      expect(formatted).toContain('Trace Details');
      expect(formatted).toContain('trace-123');
      expect(formatted).toContain('test-operation');
      expect(formatted).toContain('GET');
    });

    it('should handle empty trace data', async () => {
      const { formatTraceData } = await import('../../../../src/services/trace/types.js');
      
      const emptyTraceData = {
        traceId: 'empty-trace',
        projectId: 'test-project',
        rootSpans: [],
        allSpans: []
      };
      
      const formatted = formatTraceData(emptyTraceData);
      
      expect(formatted).toContain('empty-trace');
      expect(formatted).toContain('- **Total Spans**: 0');
    });
  });

  describe('getTraceClient', () => {
    it('should return trace client instance', async () => {
      const { getTraceClient } = await import('../../../../src/services/trace/types.js');
      
      const client = getTraceClient();
      expect(client).toBeDefined();
    });
  });

  describe('TraceData interface', () => {
    it('should handle trace data structure', async () => {
      const { formatTraceData } = await import('../../../../src/services/trace/types.js');

      const traceData = {
        traceId: 'test-trace',
        projectId: 'test-project',
        rootSpans: [],
        allSpans: []
      };

      // Should not throw when formatting valid structure
      expect(() => formatTraceData(traceData)).not.toThrow();
    });
  });

  describe('buildTraceHierarchy', () => {
    it('organizes spans into parent/child relationships and preserves metadata', async () => {
      const { buildTraceHierarchy, TraceStatus } = await import('../../../../src/services/trace/types.js');

      const start = new Date('2024-01-01T00:00:00.000Z');
      const later = new Date('2024-01-01T00:00:02.000Z');
      const childEarlier = new Date('2024-01-01T00:00:00.500Z');
      const childLater = new Date('2024-01-01T00:00:01.500Z');

      const spans = [
        {
          spanId: 'root-span',
          name: '/root',
          startTime: start.toISOString(),
          endTime: later.toISOString(),
          status: { code: 0 },
          labels: {
            '/http/method': 'GET',
            '/http/path': '/root',
          },
        },
        {
          spanId: 'child-slow',
          parentSpanId: 'root-span',
          displayName: { value: 'slow-call' },
          startTime: childLater.toISOString(),
          endTime: later.toISOString(),
          status: { code: 2 },
          labels: {
            '/error/message': 'timeout',
          },
        },
        {
          spanId: 'child-fast',
          parentSpanId: 'root-span',
          displayName: { value: 'fast-call' },
          startTime: childEarlier.toISOString(),
          endTime: childLater.toISOString(),
          status: { code: 0 },
          labels: {},
        },
      ];

      const hierarchy = buildTraceHierarchy('demo-project', 'trace-1', spans as any[]);

      expect(hierarchy.traceId).toBe('trace-1');
      expect(hierarchy.projectId).toBe('demo-project');
      expect(hierarchy.allSpans).toHaveLength(3);
      expect(hierarchy.rootSpans).toHaveLength(1);

      const [rootSpan] = hierarchy.rootSpans;
      expect(rootSpan.displayName).toBe('HTTP /root');
      expect(rootSpan.status).toBe(TraceStatus.OK);
      expect(rootSpan.childSpans?.map((span) => span.spanId)).toEqual([
        'child-fast',
        'child-slow',
      ]);
      expect(rootSpan.childSpans?.[1]?.status).toBe(TraceStatus.ERROR);
      expect(rootSpan.childSpans?.[1]?.attributes['/error/message']).toBe('timeout');
    });

    it('derives display names from HTTP labels when span name is missing', async () => {
      const { buildTraceHierarchy } = await import('../../../../src/services/trace/types.js');

      const spans = [
        {
          spanId: 'http-span',
          startTime: new Date('2024-02-01T00:00:00.000Z').toISOString(),
          endTime: new Date('2024-02-01T00:00:00.500Z').toISOString(),
          labels: {
            '/http/method': 'POST',
            '/http/path': '/v1/items',
          },
        },
      ];

      const hierarchy = buildTraceHierarchy('demo', 'trace-http', spans as any[]);

      expect(hierarchy.rootSpans[0]?.displayName).toBe('POST /v1/items');
    });
  });

  describe('extractTraceIdFromLog', () => {
    it('detects trace IDs in multiple log entry shapes', async () => {
      const { extractTraceIdFromLog } = await import('../../../../src/services/trace/types.js');

      expect(
        extractTraceIdFromLog({ trace: 'projects/demo/traces/abc123' }),
      ).toBe('abc123');

      expect(
        extractTraceIdFromLog({
          labels: {
            'logging.googleapis.com/trace': 'projects/demo/traces/def456',
          },
        }),
      ).toBe('def456');

      expect(
        extractTraceIdFromLog({ jsonPayload: { traceId: 'payload-trace' } }),
      ).toBe('payload-trace');

      expect(extractTraceIdFromLog({})).toBeUndefined();
    });
  });
});