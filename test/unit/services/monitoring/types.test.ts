/**
 * Tests for Monitoring service types and utilities
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import mocks first
import '../../../mocks/google-cloud-mocks.js';

describe('Monitoring Types and Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMonitoringClient', () => {
    it('should return monitoring client instance', async () => {
      const { getMonitoringClient } = await import('../../../../src/services/monitoring/types.js');
      
      const client = getMonitoringClient();
      expect(client).toBeDefined();
    });

    it('should return same client instance on multiple calls', async () => {
      const { getMonitoringClient } = await import('../../../../src/services/monitoring/types.js');
      
      const client1 = getMonitoringClient();
      const client2 = getMonitoringClient();
      
      expect(client1).toBe(client2);
    });
  });

  describe('formatTimeSeriesData', () => {
    it('should format time series data correctly', async () => {
      const { formatTimeSeriesData } = await import('../../../../src/services/monitoring/types.js');
      
      const mockTimeSeries = [{
        metric: {
          type: 'compute.googleapis.com/instance/cpu/utilization',
          labels: { instance_name: 'test-instance' }
        },
        points: [{
          interval: { endTime: { seconds: Date.now() / 1000 } },
          value: { doubleValue: 0.75 }
        }]
      }];
      
      const formatted = formatTimeSeriesData(mockTimeSeries);

      expect(formatted.series.length).toBe(1);
      expect(formatted.series[0].metricType).toBe('compute.googleapis.com/instance/cpu/utilization');
      expect(formatted.series[0].points[0].value).toBe(0.75);
    });

    it('should handle empty time series', async () => {
      const { formatTimeSeriesData } = await import('../../../../src/services/monitoring/types.js');
      
      const formatted = formatTimeSeriesData([]);

      expect(formatted.series.length).toBe(0);
      expect(formatted.totalSeries).toBe(0);
    });
  });

  describe('TimeSeriesData interface', () => {
    it('should handle time series data structure', async () => {
      const { formatTimeSeriesData } = await import('../../../../src/services/monitoring/types.js');
      
      const mockTimeSeries = [{
        metric: {
          type: 'compute.googleapis.com/instance/cpu/utilization',
          labels: { instance_name: 'test-instance' }
        },
        points: [{
          interval: { endTime: { seconds: Date.now() / 1000 } },
          value: { doubleValue: 0.75 }
        }]
      }];
      
      const formatted = formatTimeSeriesData(mockTimeSeries);
      expect(formatted.series[0].points.length).toBeGreaterThan(0);
    });
  });
});
