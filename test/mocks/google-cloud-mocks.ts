/**
 * Mock implementations for Google Cloud services
 */
import { vi } from 'vitest';
import { createMockLogEntries, createMockSpannerSchema, createMockBillingAccount, createMockCostData } from '../utils/test-helpers.js';

// Mock @google-cloud/logging
export const mockLoggingClient = {
  getEntries: vi.fn().mockResolvedValue([createMockLogEntries(), {}, {}]),
  createSink: vi.fn().mockResolvedValue([{ name: 'test-sink' }]),
  getSinks: vi.fn().mockResolvedValue([[], {}, {}]),
};

const LoggingMock = vi.fn(function LoggingMock() {
  return mockLoggingClient;
});

vi.mock('@google-cloud/logging', () => ({
  Logging: LoggingMock,
}));

// Mock @google-cloud/monitoring
export const mockMonitoringClient = {
  listTimeSeries: vi.fn().mockResolvedValue([[], {}, {}]),
  listMetricDescriptors: vi.fn().mockResolvedValue([[], {}, {}]),
  createTimeSeries: vi.fn().mockResolvedValue([{}]),
};

const MetricServiceClientMock = vi.fn(function MetricServiceClientMock() {
  return mockMonitoringClient;
});

vi.mock('@google-cloud/monitoring', () => ({
  default: { MetricServiceClient: MetricServiceClientMock },
  MetricServiceClient: MetricServiceClientMock,
}));

// Mock @google-cloud/spanner
export const mockSpannerClient = {
  instance: vi.fn(() => ({
    database: vi.fn(() => ({
      run: vi.fn().mockResolvedValue([[], {}]),
      runStream: vi.fn().mockReturnValue({
        on: vi.fn(),
        pipe: vi.fn(),
      }),
      getSchema: vi.fn().mockResolvedValue([createMockSpannerSchema()]),
    })),
  })),
};

const SpannerMock = vi.fn(function SpannerMock() {
  return mockSpannerClient;
});

vi.mock('@google-cloud/spanner', () => ({
  Spanner: SpannerMock,
}));

// Mock google-auth-library
export const mockAuthClient = {
  getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
  getProjectId: vi.fn().mockResolvedValue('test-project'),
  authorize: vi.fn().mockResolvedValue(undefined),
};

const GoogleAuthMock = vi.fn(function GoogleAuthMock() {
  return mockAuthClient;
});

vi.mock('google-auth-library', () => ({
  GoogleAuth: GoogleAuthMock,
}));

// Mock @modelcontextprotocol/sdk
export const mockMcpServer = {
  registerTool: vi.fn(),
  tool: vi.fn(),
  resource: vi.fn(),
  prompt: vi.fn(),
  registerPrompt: vi.fn(),
  connect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

const McpServerMock = vi.fn(function McpServerMock() {
  return mockMcpServer;
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: McpServerMock,
  ResourceTemplate: vi.fn(),
}));

const StdioServerTransportMock = vi.fn(function StdioServerTransportMock() {
  return {};
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: StdioServerTransportMock,
}));
