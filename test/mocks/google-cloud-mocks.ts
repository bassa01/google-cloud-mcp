/**
 * Mock implementations for Google Cloud services
 */
import { Buffer } from 'node:buffer';
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

// Mock @google-cloud/bigquery
export const mockDatasetMetadata = {
  id: 'test-project:sample_dataset',
  datasetReference: {
    projectId: 'test-project',
    datasetId: 'sample_dataset',
  },
  friendlyName: 'Sample Dataset',
  description: 'Mock dataset for testing',
  location: 'US',
  defaultTableExpirationMs: '86400000',
  labels: { env: 'test' },
};

export const mockTableMetadata = {
  id: 'test-project:sample_dataset.sample_table',
  tableReference: {
    projectId: 'test-project',
    datasetId: 'sample_dataset',
    tableId: 'sample_table',
  },
  type: 'TABLE',
  location: 'US',
  friendlyName: 'Sample Table',
  description: 'Mock table metadata',
  numRows: '42',
  numBytes: '2048',
  creationTime: '1700000000000',
  schema: {
    fields: [
      {
        name: 'event_date',
        type: 'DATE',
        mode: 'REQUIRED',
        description: 'Partition column',
      },
      {
        name: 'payload',
        type: 'RECORD',
        mode: 'NULLABLE',
        fields: [
          { name: 'user_id', type: 'STRING', mode: 'NULLABLE' },
          { name: 'value', type: 'FLOAT64', mode: 'NULLABLE' },
        ],
      },
    ],
  },
  timePartitioning: {
    type: 'DAY',
    field: 'event_date',
    requirePartitionFilter: true,
  },
  clustering: { fields: ['event_date', 'payload.user_id'] },
};

const createMockDatasetObject = () => ({
  metadata: mockDatasetMetadata,
  getMetadata: vi.fn().mockResolvedValue([mockDatasetMetadata]),
});

const createMockTableObject = () => ({
  metadata: mockTableMetadata,
  getMetadata: vi.fn().mockResolvedValue([mockTableMetadata]),
});

const createMockDatasetHandle = () => {
  const tableObject = createMockTableObject();
  return {
    getTables: vi.fn().mockResolvedValue([[tableObject]]),
    table: vi.fn(() => createMockTableObject()),
  };
};

export const mockBigQueryClient = {
  projectId: 'test-project',
  createQueryJob: vi.fn().mockResolvedValue([
    {
      id: 'test-job',
      getQueryResults: vi.fn().mockResolvedValue([
        [
          {
            id: 'row-1',
            value: 'mock',
          },
        ],
      ]),
      getMetadata: vi.fn().mockResolvedValue([
        {
          jobReference: { jobId: 'test-job', location: 'US' },
          statistics: {
            query: {
              totalBytesProcessed: '1000',
              cacheHit: false,
              totalSlotMs: '200',
            },
          },
          configuration: { query: { dryRun: false } },
          status: {},
        },
      ]),
    },
  ]),
  getDatasets: vi.fn().mockResolvedValue([[createMockDatasetObject()]]),
  dataset: vi.fn(() => createMockDatasetHandle()),
};

const BigQueryMock = vi.fn(function BigQueryMock() {
  return mockBigQueryClient;
});

vi.mock('@google-cloud/bigquery', () => ({
  BigQuery: BigQueryMock,
}));

// Mock @google-cloud/storage
export const mockStorageBucketMetadata = {
  name: 'test-bucket',
  location: 'US',
  storageClass: 'STANDARD',
  timeCreated: new Date().toISOString(),
  updated: new Date().toISOString(),
  labels: { env: 'test' },
};

export const mockStorageObjectMetadata = {
  bucket: 'test-bucket',
  name: 'folder/sample.txt',
  size: '128',
  storageClass: 'STANDARD',
  contentType: 'text/plain',
  updated: new Date().toISOString(),
  generation: '1',
  crc32c: 'dJUQtw==',
  metadata: { owner: 'unit-test' },
};

export const mockStorageFileHandle = {
  metadata: mockStorageObjectMetadata,
  getMetadata: vi.fn().mockResolvedValue([mockStorageObjectMetadata]),
  download: vi.fn().mockResolvedValue([Buffer.from('mock file content')]),
};

export const mockStorageBucketHandle = {
  metadata: mockStorageBucketMetadata,
  getMetadata: vi.fn().mockResolvedValue([mockStorageBucketMetadata]),
  iam: {
    getPolicy: vi.fn().mockResolvedValue([{ bindings: [] }]),
    testPermissions: vi.fn().mockResolvedValue({ 'storage.objects.get': true }),
  },
  getFiles: vi.fn().mockResolvedValue([[{ name: 'folder/sample.txt', metadata: mockStorageObjectMetadata }], {}, {}]),
  file: vi.fn(() => mockStorageFileHandle),
};

export const mockStorageClient = {
  getBuckets: vi.fn().mockResolvedValue([[{ name: 'test-bucket', metadata: mockStorageBucketMetadata }], {}, {}]),
  bucket: vi.fn(() => mockStorageBucketHandle),
};

const StorageMock = vi.fn(function StorageMock() {
  return mockStorageClient;
});

vi.mock('@google-cloud/storage', () => ({
  Storage: StorageMock,
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
