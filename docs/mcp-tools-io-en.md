# MCP Tool Input/Output Reference

## About This Document
- Covers every tool exposed by the Google Cloud MCP server, summarizing input schemas and representative responses.
- JSON schemas mirror the structures MCP clients must send via `call_tool` / `performTool`.
- Examples use placeholder projects/resources; replace them with values from your environment.

### Invocation Format
Tools are invoked over MCP using the payload below:

```jsonc
{
  "name": "<tool-name>",
  "arguments": { /* follow each schema */ }
}
```

### Common Response Pattern
- Every tool returns one or more `text` entries inside `content`.
- On failure, responses may include `isError: true` and a short explanation.
- Responses now follow a “summary line + JSON block” layout: the summary line lists key metadata (e.g., `projectId=... | filter=... | omitted=...`) and truncation notes, and the JSON block carries the structured payload that MCP clients feed into `structuredContent`.
- When sensitive fields are redacted, the summary ends with `_Redacted …_` to make the masking reason explicit.
- New preview knobs keep payloads bounded beyond Logging/Spanner/Monitoring:
  - **Error Reporting** – `ERROR_REPORTING_GROUP_PREVIEW_LIMIT`, `ERROR_REPORTING_EVENT_PREVIEW_LIMIT`, `ERROR_REPORTING_ANALYSIS_PREVIEW_LIMIT`, `ERROR_REPORTING_TREND_POINTS_LIMIT`.
  - **Profiler** – `PROFILER_PROFILE_PREVIEW_LIMIT`, `PROFILER_ANALYSIS_PREVIEW_LIMIT`.
  - **Support** – `SUPPORT_CASE_PREVIEW_LIMIT`, `SUPPORT_COMMENT_PREVIEW_LIMIT`, `SUPPORT_ATTACHMENT_PREVIEW_LIMIT`, `SUPPORT_CLASSIFICATION_PREVIEW_LIMIT`, `SUPPORT_DESCRIPTION_PREVIEW_LIMIT`.
  - **Trace** – `TRACE_SPAN_PREVIEW_LIMIT`, `TRACE_TRACE_PREVIEW_LIMIT`, `TRACE_LOG_PREVIEW_LIMIT`, `TRACE_ATTRIBUTE_PREVIEW_LIMIT`, `TRACE_ANALYSIS_PREVIEW_LIMIT`.
  - **BigQuery** – `BIGQUERY_ROW_PREVIEW_LIMIT` caps the number of rows embedded in query responses.

### Notation
| Column | Meaning |
| --- | --- |
| Type | `string`, `number`, `boolean`, `enum[...]`, `record`, `array`, etc. |
| Required | `yes` = mandatory, `no` = optional. |
| Default / Constraints | Defaults, ranges, or formatting guidance. |

---

## Logging

### gcp-logging-query-logs — Query logs with any filter
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| filter | string | yes | Cloud Logging query language | Filter covering payloads, resources, labels, etc. |
| limit | number | no | 50 (1-1000) | Maximum number of log entries. |

**Call example**
```jsonc
{
  "name": "gcp-logging-query-logs",
  "arguments": {
    "filter": "resource.type=\"cloud_run_revision\" severity>=ERROR",
    "limit": 20
  }
}
```

**Response example**
```text
Log Query Results
projectId=my-sre-prod | filter=resource.type="cloud_run_revision" severity>=ERROR | limit=20
Showing 3 of 50 entries. _Redacted fields: IP addresses, user identifiers, request bodies. Full payloads are limited to roles: security_admin, compliance_admin, site_reliability_admin._
```

```json
[
  {
    "timestamp": "2025-03-01T04:15:27.000Z",
    "severity": "ERROR",
    "resource": {
      "type": "cloud_run_revision",
      "labels": {
        "service_name": "payments",
        "revision_name": "payments-001"
      }
    },
    "payload": {
      "type": "text",
      "value": "POST /v1/orders 500 deadline exceeded"
    }
  },
  { "...": "..." }
]
```

### gcp-logging-query-time-range — Query logs by time window
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| startTime | string | yes | ISO 8601 or relative (`1h`, `2d`) | Window start; relative values offset from now. |
| endTime | string | no | Defaults to now | Window end. |
| filter | string | no | none | Additional filter expression. |
| limit | number | no | 50 (1-1000) | Maximum number of entries. |

**Call example**
```jsonc
{
  "name": "gcp-logging-query-time-range",
  "arguments": {
    "startTime": "2h",
    "filter": "severity>=WARNING resource.type=\"gce_instance\"",
    "limit": 100
  }
}
```

**Response example**
```text
Log Time Range Results
projectId=my-sre-prod | timeRange=2025-03-05T02:10:00.000Z -> 2025-03-05T04:10:00.000Z | filter=severity>=WARNING resource.type="gce_instance"
Showing 20 of 42 entries.
```

```json
[
  {
    "timestamp": "2025-03-05T03:02:11.000Z",
    "severity": "WARNING",
    "resource": { "type": "gce_instance" },
    "payload": {
      "type": "text",
      "value": "Disk utilization crossed 85%"
    }
  }
]
```

### gcp-logging-search-comprehensive — Cross-field search
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| searchTerm | string | yes |  | Term to search across text/json/proto payloads, labels, and HTTP metadata. |
| timeRange | string | no | `1h` | Relative window (e.g., `24h`, `7d`). |
| severity | enum[`DEFAULT`,`DEBUG`,`INFO`,`NOTICE`,`WARNING`,`ERROR`,`CRITICAL`,`ALERT`,`EMERGENCY`] | no | all | Minimum severity. |
| resource | string | no | all | `gke_container`, `cloud_run_revision`, etc. |
| limit | number | no | 50 (1-500) | Maximum entries. |

**Call example**
```jsonc
{
  "name": "gcp-logging-search-comprehensive",
  "arguments": {
    "searchTerm": "deadline exceeded",
    "timeRange": "24h",
    "severity": "ERROR",
    "resource": "cloud_run_revision",
    "limit": 30
  }
}
```

**Response example**
```text
Comprehensive Log Search Results
projectId=my-sre-prod | searchTerm="deadline exceeded" | timeRange=2025-03-04T05:00:00.000Z -> 2025-03-05T05:00:00.000Z | severity=ERROR | resource=cloud_run_revision
Entries: 7
```

```json
[
  {
    "timestamp": "2025-03-04T22:41:07.000Z",
    "severity": "ERROR",
    "trace": "projects/my-sre-prod/traces/abc123",
    "payload": {
      "type": "text",
      "value": "deadline exceeded calling billing API"
    }
  }
]
```

### gcp-logging-log-analytics-query — Run SQL with Log Analytics
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| sql | string | yes | Standard SQL | Sent directly to `entries:queryData`. Use `{{log_view}}` to inject the primary view identifier. |
| projectId | string | no | Active/authenticated project | Overrides the project used to resolve log views. |
| logView | record | no | `LOG_ANALYTICS_*` env defaults | `{ resourceName?, projectId?, location?, bucketId?, viewId? }` describing the primary Cloud Logging analytics view. |
| additionalLogViews | record[] | no | none | Extra log views to authorize when referencing multiple sources in SQL. |
| rowLimit | number | no | `LOG_ANALYTICS_ROW_PREVIEW_LIMIT` (5–500) | Caps rows returned in the preview. |
| disableCache | boolean | no | `false` | Disables Log Analytics caching for this query. |
| queryTimeoutMs | number | no | `LOG_ANALYTICS_QUERY_TIMEOUT_MS` | Timeout passed to `entries:queryData`. |
| readTimeoutMs | number | no | `LOG_ANALYTICS_READ_TIMEOUT_MS` | Timeout per `entries:readQueryResults` call. |

`logView.resourceName` accepts `projects/<project>/locations/<location>/buckets/<bucket>/views/<view>`. When omitted, the server falls back to `LOG_ANALYTICS_LOCATION` (default `global`), `LOG_ANALYTICS_BUCKET` (`_Default`), and `LOG_ANALYTICS_VIEW` (`_AllLogs`). No linked BigQuery dataset is required—the tool polls `entries:readQueryResults` until the query completes or the preview limit is reached.

**Call example**
```jsonc
{
  "name": "gcp-logging-log-analytics-query",
  "arguments": {
    "sql": "SELECT severity, COUNT(*) AS occurrences FROM {{log_view}} WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR) GROUP BY severity ORDER BY occurrences DESC"
  }
}
```

**Response example**
```text
Log Analytics Query Results
projectId=my-sre-prod | views=projects/my-sre-prod/locations/global/buckets/_Default/views/_AllLogs | sqlView=my-sre-prod.global._Default._AllLogs | rowsReturned=3
Showing 3 of 3 rows.
```

```json
{
  "sql": "SELECT severity, COUNT(*) AS occurrences FROM `my-sre-prod.global._Default._AllLogs` WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR) GROUP BY severity ORDER BY occurrences DESC",
  "placeholderApplied": true,
  "queryStepHandle": "handle-123",
  "resultReference": "projects/my-sre-prod/locations/global/operations/abc123",
  "resourceNames": [
    "projects/my-sre-prod/locations/global/buckets/_Default/views/_AllLogs"
  ],
  "rows": [
    { "severity": "ERROR", "occurrences": "12" },
    { "severity": "WARNING", "occurrences": "5" },
    { "severity": "INFO", "occurrences": "2" }
  ]
}
```

## BigQuery

### gcp-bigquery-execute-query — Run read-only SQL safely
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| sql | string | yes | Standard SQL only (SELECT/WITH/EXPLAIN/SHOW/DESCRIBE) | Query text; mutating statements are rejected client-side before reaching BigQuery. |
| projectId | string | no | Active/authenticated project | Overrides the project that owns the query job. |
| location | string | no | `BIGQUERY_LOCATION` env or dataset default | BigQuery region (e.g., `US`, `EU`). |
| defaultDataset | record | no | none | `{ datasetId, projectId? }` applied to unqualified table references. |
| params | record<string, any> | no | `{}` | Named parameters (JSON-compatible). |
| maximumBytesBilled | number | no | unlimited | Job fails if estimated bytes exceed this cap. |
| dryRun | boolean | no | `false` | Validate and estimate cost without executing the query. |
| useLegacySql | boolean | no | `false` | Set to `true` only for Legacy SQL workloads. |
| resultOptions | record | no | none | `{ maxResults, timeoutMs, startIndex }` passed to `getQueryResults`. |

**Call example**
```jsonc
{
  "name": "gcp-bigquery-execute-query",
  "arguments": {
    "sql": "SELECT user_id, total_spend FROM `analytics.orders` WHERE status=@status ORDER BY total_spend DESC LIMIT 20",
    "projectId": "analytics-prod-123",
    "location": "US",
    "defaultDataset": {
      "projectId": "analytics-prod-123",
      "datasetId": "analytics"
    },
    "params": { "status": "COMPLETE" }
  }
}
```

**Response example**
```text
BigQuery Query Results
projectId=analytics-prod-123 | location=US | jobId=job_123 | rowsReturned=20 | totalBytesProcessed=1234567
Showing 20 of 20 rows.
```

```json
{
  "sql": "SELECT user_id, total_spend FROM `analytics.orders` WHERE status=@status ORDER BY total_spend DESC LIMIT 20",
  "params": { "status": "COMPLETE" },
  "jobId": "job_123",
  "statistics": {
    "totalBytesProcessed": "1234567",
    "cacheHit": false
  },
  "rows": [
    { "user_id": "42", "total_spend": "1000.00" },
    { "...": "..." }
  ]
}
```

### gcp-bigquery-list-datasets — Discover datasets in a project
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| projectId | string | no | Active/authenticated project | Override the project whose datasets should be listed. |

**Call example**
```jsonc
{
  "name": "gcp-bigquery-list-datasets",
  "arguments": {
    "projectId": "analytics-prod-123"
  }
}
```

**Response example**
```text
BigQuery Datasets
projectId=analytics-prod-123 | totalDatasets=3
```

```json
[
  {
    "datasetId": "analytics",
    "projectId": "analytics-prod-123",
    "friendlyName": "Analytics",
    "location": "US",
    "labels": { "env": "prod" }
  },
  {
    "datasetId": "ml_features",
    "projectId": "analytics-prod-123",
    "friendlyName": "ML Features",
    "location": "US"
  }
]
```

### gcp-bigquery-list-tables — Enumerate tables in a dataset
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| dataset | record | yes | `{ datasetId, projectId? }` | Dataset reference (ID + optional project override) to inspect. |
| projectId | string | no | Active/authenticated project | Default project when `dataset.projectId` is omitted. |

**Call example**
```jsonc
{
  "name": "gcp-bigquery-list-tables",
  "arguments": {
    "dataset": {
      "projectId": "analytics-prod-123",
      "datasetId": "analytics"
    }
  }
}
```

**Response example**
```text
BigQuery Tables
projectId=analytics-prod-123 | datasetId=analytics | totalTables=2
```

```json
[
  {
    "tableId": "orders",
    "type": "TABLE",
    "timePartitioning": { "type": "DAY", "field": "order_date" },
    "clustering": ["order_date", "region"],
    "numRows": "125000000",
    "numBytes": "987654321"
  },
  {
    "tableId": "orders_mv",
    "type": "VIEW",
    "friendlyName": "Orders materialized view"
  }
]
```

### gcp-bigquery-get-table-schema — Inspect columns and partitioning
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| table | record | yes | `{ datasetId, tableId, projectId? }` | Table reference to describe. |
| projectId | string | no | Active/authenticated project | Default project when `table.projectId` is omitted. |

**Call example**
```jsonc
{
  "name": "gcp-bigquery-get-table-schema",
  "arguments": {
    "table": {
      "projectId": "analytics-prod-123",
      "datasetId": "analytics",
      "tableId": "orders"
    }
  }
}
```

**Response example**
```text
BigQuery Table Schema
projectId=analytics-prod-123 | datasetId=analytics | tableId=orders | type=TABLE
Time partitioned by DAY on column order_date. Clustered by order_date, region.
```

```json
{
  "table": {
    "type": "TABLE",
    "friendlyName": "Orders",
    "numRows": "125000000",
    "numBytes": "987654321"
  },
  "columns": [
    { "name": "order_id", "type": "STRING", "mode": "REQUIRED" },
    { "name": "order_date", "type": "DATE", "mode": "REQUIRED" },
    {
      "name": "items",
      "type": "RECORD",
      "mode": "REPEATED",
      "fields": [
        { "name": "sku", "type": "STRING", "mode": "REQUIRED" },
        { "name": "qty", "type": "INT64", "mode": "REQUIRED" }
      ]
    }
  ],
  "partitioning": {
    "timePartitioning": {
      "type": "DAY",
      "field": "order_date",
      "requirePartitionFilter": true
    }
  },
  "clustering": ["order_date", "region"]
}
```

## Spanner

### gcp-spanner-execute-query — Run SQL directly
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| sql | string | yes |  | Read-only SQL statement (SELECT/WITH/EXPLAIN/SHOW/DESCRIBE). |
| instanceId | string | no | `SPANNER_INSTANCE` env or state | Target instance. |
| databaseId | string | no | `SPANNER_DATABASE` env or state | Target database. |
| params | record<string, any> | no | `{}` | Named parameters (JSON-compatible). |

**Call example**
```jsonc
{
  "name": "gcp-spanner-execute-query",
  "arguments": {
    "sql": "SELECT user_id, status FROM accounts WHERE status=@status LIMIT 25",
    "params": { "status": "ACTIVE" }
  }
}
```

⚠️ This tool blocks any DML/DDL, transaction control statements, or multi-statement payloads before they reach Spanner.

**Response example**
```text
Spanner Query Results
projectId=prod-data | instance=main-instance | database=ledger
```

```json
{
  "sql": "SELECT user_id, status FROM accounts WHERE status=@status LIMIT 25",
  "params": { "status": "ACTIVE" },
  "rows": [
    { "user_id": "12345", "status": "ACTIVE" },
    { "user_id": "67890", "status": "ACTIVE" },
    { "...": "..." }
  ]
}
```

### gcp-spanner-list-tables — List tables
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| instanceId | string | no | env/state | Target instance. |
| databaseId | string | no | env/state | Target database. |

**Call example**
```jsonc
{
  "name": "gcp-spanner-list-tables",
  "arguments": {
    "databaseId": "ledger"
  }
}
```

**Response example**
```text
Spanner Tables
projectId=prod-data | instance=main-instance | database=ledger
```

```json
{
  "schemaResource": "gcp-spanner://prod-data/main-instance/ledger/schema",
  "tablePreviewTemplate": "gcp-spanner://prod-data/main-instance/ledger/tables/{table}/preview",
  "rows": [
    { "tableName": "accounts", "columnCount": 14 },
    { "tableName": "payments", "columnCount": 22 }
  ]
}
```

### gcp-spanner-list-instances — List instances
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| _dummy | string | no | unused | Compatibility placeholder; omit it. |

**Call example**
```jsonc
{ "name": "gcp-spanner-list-instances", "arguments": {} }
```

**Response example**
```text
Spanner Instances
projectId=prod-data
```

```json
{
  "instancesResource": "gcp-spanner://prod-data/instances",
  "databaseResourceTemplate": "gcp-spanner://prod-data/{instance}/databases",
  "rows": [
    {
      "id": "main-instance",
      "state": "READY",
      "config": "regional-us-central1",
      "nodeCount": 3
    },
    { "...": "..." }
  ]
}
```

### gcp-spanner-list-databases — List databases
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| instanceId | string | yes |  | `projects/{project}/instances/{instance}` ID. |

**Call example**
```jsonc
{
  "name": "gcp-spanner-list-databases",
  "arguments": { "instanceId": "main-instance" }
}
```

**Response example**
```text
Spanner Databases
projectId=prod-data | instance=main-instance
```

```json
{
  "tablesResourceTemplate": "gcp-spanner://prod-data/main-instance/{database}/tables",
  "schemaResourceTemplate": "gcp-spanner://prod-data/main-instance/{database}/schema",
  "rows": [
    { "id": "ledger", "state": "READY" },
    { "id": "analytics", "state": "READY" }
  ]
}
```

### gcp-spanner-query-count — Query count metric
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| instanceId | string | no | all instances | Restrict to one instance. |
| databaseId | string | no | all DBs | Restrict to one database. |
| queryType | enum[`ALL`,`READ`,`QUERY`] | no | `ALL` | Metric label `query_type`. |
| status | enum[`ALL`,`OK`,`ERROR`] | no | `ALL` | Metric label `status`. |
| startTime | string | no | `1h` | Relative or ISO start. |
| endTime | string | no | now | End timestamp. |
| alignmentPeriod | string | no | `60s` | `<number><s|m|h|d>` for aggregation window. |

**Call example**
```jsonc
{
  "name": "gcp-spanner-query-count",
  "arguments": {
    "instanceId": "main-instance",
    "queryType": "READ",
    "status": "OK",
    "startTime": "6h",
    "alignmentPeriod": "5m"
  }
}
```

**Response example**
```text
Spanner Query Count
projectId=prod-data | instance=main-instance | queryType=READ | status=OK | alignment=5m
Showing 2 of 6 time series.
```

```json
[
  {
    "instance": "main-instance",
    "database": "ledger",
    "queryType": "READ",
    "status": "OK",
    "optimizerVersion": "latest",
    "points": [
      { "timestamp": "2025-03-05T00:05:00Z", "count": "1820" },
      { "timestamp": "2025-03-05T00:10:00Z", "count": "1764" }
    ],
    "pointsOmitted": 10
  },
  { "...": "..." }
]
```

### gcp-spanner-query-plan (resource) — Inspect EXPLAIN / EXPLAIN ANALYZE
| Parameter | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| projectId | string | no | Defaults to active project | Part of the URI path `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-plan`. |
| instanceId | string | no | env/state | Pulled from `SPANNER_INSTANCE` or state manager when omitted. |
| databaseId | string | no | env/state | Pulled from `SPANNER_DATABASE` or state manager when omitted. |
| sql | string (query param) | yes | URL-encoded | Provide the SQL statement to wrap with EXPLAIN / EXPLAIN ANALYZE. DML/DDL is blocked. |
| mode | enum[`explain`,`analyze`] | no | `explain` | Switch between EXPLAIN (plan only) and EXPLAIN ANALYZE (executes query). |
| analyze | string/bool (query param) | no | false | Alternate flag (`?analyze=1`) when `mode` is unavailable. |

Invoke it with MCP `read_resource`:
```jsonc
{
  "type": "read_resource",
  "uri": "gcp-spanner://my-sre-prod/main-instance/ledger/query-plan?sql=SELECT+user_id%2C+status+FROM+accounts&mode=analyze"
}
```

**Response example**
```text
# Spanner Query Plan
Project: my-sre-prod
Instance: main-instance
Database: ledger
Mode: EXPLAIN ANALYZE

Original SQL:
SELECT user_id, status FROM accounts LIMIT 25

_Executed with EXPLAIN ANALYZE (query was run to capture timing information)._

## Plan Insights
- No obvious distributed joins or missing indexes detected based on the current plan and schema.
Tables referenced: accounts

## Plan Nodes
| ID | Type | Rows | Executions | Description |
|----|------|------|------------|-------------|
| 1 | Distributed Union | 1200 | 1 | ...
```


## Monitoring

### gcp-monitoring-query-metrics — Query metrics via filter
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| filter | string | yes | Monitoring ListTimeSeries filter | Must include `metric.type` and optional resource labels. |
| startTime | string | yes | ISO or relative | Range start. |
| endTime | string | no | now | Range end. |
| alignmentPeriod | string | no | unset | `<number><s|m|h|d>` alignment period. |

**Call example**
```jsonc
{
  "name": "gcp-monitoring-query-metrics",
  "arguments": {
    "filter": "metric.type=\"compute.googleapis.com/instance/cpu/utilization\" resource.label.instance_id=\"1234567890\"",
    "startTime": "2h",
    "alignmentPeriod": "60s"
  }
}
```

**Response example**
```text
Metric Query Results
projectId=sre-metrics | timeRange=2025-03-05T02:00:00Z -> 2025-03-05T04:00:00Z | filter=metric.type="compute.googleapis.com/instance/cpu/utilization"
```

```json
[
  {
    "metricType": "compute.googleapis.com/instance/cpu/utilization",
    "resource": {
      "type": "gce_instance",
      "labels": {
        "instance_id": "1234567890",
        "zone": "us-central1-b"
      }
    },
    "points": [
      { "timestamp": "2025-03-05T02:10:00Z", "value": 0.41 },
      { "timestamp": "2025-03-05T02:11:00Z", "value": 0.39 }
    ],
    "pointsOmitted": 108
  }
]
```

### gcp-monitoring-list-metric-types — Discover metric descriptors
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| filter | string | no | none | Plain text search or full API filter. |
| pageSize | number | no | 20 (1-100) | Max descriptors. |
| timeout | number | no | 30s (5-60) | Client-side timeout. |

**Call example**
```jsonc
{
  "name": "gcp-monitoring-list-metric-types",
  "arguments": {
    "filter": "spanner",
    "pageSize": 15
  }
}
```

**Response example**
```text
Available Metric Types
projectId=sre-metrics | filter="spanner"
```

```json
[
  {
    "type": "spanner.googleapis.com/instance/cpu/utilization",
    "displayName": "CPU utilization",
    "metricKind": "GAUGE",
    "valueType": "DOUBLE",
    "description": "Average CPU usage for Cloud Spanner instances."
  },
  { "...": "..." }
]
```

## Trace

Trace tools now emit structured span/trace previews with optional hierarchy markdown; adjust coverage via the `TRACE_*` preview settings.

### gcp-trace-get-trace — Retrieve by trace ID
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| traceId | string | yes | Hex string | Trace ID to fetch. |
| projectId | string | no | active project | Override project if needed. |

**Call example**
```jsonc
{
  "name": "gcp-trace-get-trace",
  "arguments": {
    "traceId": "4f6c2d9b1a8e5cf2"
  }
}
```

**Response example**
```text
Trace Details
projectId=my-sre-prod | traceId=4f6c2d9b1a8e5cf2 | spanCount=42 | omitted=12
```

```json
{
  "summary": {
    "rootSpanCount": 1,
    "failedSpanCount": 3
  },
  "spans": [
    {
      "spanId": "0001",
      "name": "frontend:/orders",
      "startTime": "2025-03-05T03:41:28.000Z",
      "endTime": "2025-03-05T03:41:29.842Z",
      "durationMs": 842,
      "status": "ERROR",
      "attributes": {
        "/http/method": "POST",
        "/http/status_code": "500"
      }
    }
  ],
  "spansOmitted": 12,
  "hierarchyMarkdown": "## Trace Details...",
  "hierarchyTruncated": true
}
```

### gcp-trace-list-traces — List recent traces
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| projectId | string | no | active project | Optional override. |
| filter | string | no | none | e.g., `status.code != 0`. |
| limit | number | no | 10 (1-100) | Max traces. |
| startTime | string | no | `1h` | ISO or relative (`30m`, `2d`). |

**Call example**
```jsonc
{
  "name": "gcp-trace-list-traces",
  "arguments": {
    "filter": "status.code != 0",
    "limit": 5,
    "startTime": "2h"
  }
}
```

**Response example**
```text
Trace List
projectId=my-sre-prod | timeRange=2025-03-05T02:10:00Z -> 2025-03-05T04:10:00Z | filter=status.code != 0 | returned=5
```

```json
{
  "traces": [
    {
      "traceId": "4f6c2d9b1a8e5cf2",
      "displayName": "frontend:/orders",
      "startTime": "2025-03-05T03:41:28.000Z",
      "endTime": "2025-03-05T03:41:29.842Z",
      "duration": "842ms",
      "spanCount": 42,
      "statusCode": 13,
      "projectId": "my-sre-prod"
    }
  ],
  "tracesOmitted": 0
}
```

### gcp-trace-find-from-logs — Extract Trace IDs from logs
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| projectId | string | no | active project | Optional override. |
| filter | string | yes | Cloud Logging filter | Can include relative timestamps (`timestamp >= "-1h"`). |
| limit | number | no | 10 (1-100) | Number of log entries to inspect. |

**Call example**
```jsonc
{
  "name": "gcp-trace-find-from-logs",
  "arguments": {
    "filter": "severity>=ERROR AND resource.type=\"cloud_run_revision\" AND timestamp>\"-1h\"",
    "limit": 50
  }
}
```

**Response example**
```text
Traces Found in Logs
projectId=my-sre-prod | logFilter=severity>=ERROR ... | uniqueTraces=12 | examinedEntries=37
```

```json
{
  "traces": [
    {
      "traceId": "4f6c2d9b1a8e5cf2",
      "timestamp": "2025-03-05T03:42:10.000Z",
      "severity": "ERROR",
      "logName": "run.googleapis.com/request_log",
      "message": "POST /orders 500 deadline exceeded"
    }
  ],
  "tracesOmitted": 7
}
```

## Error Reporting

All Error Reporting tools emit metadata summaries plus JSON payloads; adjust preview depth with the `ERROR_REPORTING_*` variables outlined above.

### gcp-error-reporting-list-groups — Aggregate error groups
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| timeRange | string | no | `1h` | `1h`, `6h`, `24h`/`1d`, `7d`, `30d`. |
| serviceFilter | string | no | none | Maps to `serviceFilter.service`. |
| order | enum[`COUNT_DESC`,`LAST_SEEN_DESC`,`CREATED_DESC`,`AFFECTED_USERS_DESC`] | no | `COUNT_DESC` | Sort order. |
| pageSize | number | no | 20 (1-100) | Max groups. |

**Call example**
```jsonc
{
  "name": "gcp-error-reporting-list-groups",
  "arguments": {
    "timeRange": "24h",
    "serviceFilter": "checkout",
    "order": "LAST_SEEN_DESC"
  }
}
```

**Response example**
```text
Error Groups
projectId=my-sre-prod | timeRange=24h | service=checkout | totalGroups=3 | omitted=1
```

```json
{
  "summary": {
    "totalGroups": 3,
    "nextPageToken": "Cg0IARABGAEiB..."
  },
  "groups": [
    {
      "groupId": "checkout-nullref",
      "counts": {
        "total": 152,
        "affectedUsers": 42
      },
      "representative": {
        "eventTime": "2025-03-05T04:11:27.000Z",
        "message": "NullReferenceException at cart.ts:118"
      }
    }
  ],
  "groupsOmitted": 1,
  "analysisMarkdown": "# Error Analysis...",
  "analysisTruncated": true
}
```

### gcp-error-reporting-get-group-details — Group detail + events
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| groupId | string | yes |  | The trailing ID from `projects/.../groups/...`. |
| timeRange | string | no | `24h` | `1h`, `24h`, `7d`, `30d`, etc. |
| pageSize | number | no | 10 (1-100) | Number of events. |

**Call example**
```jsonc
{
  "name": "gcp-error-reporting-get-group-details",
  "arguments": {
    "groupId": "abcdef1234567890",
    "timeRange": "7d",
    "pageSize": 5
  }
}
```

**Response example**
```text
Error Group Details
projectId=my-sre-prod | groupId=abcdef1234567890 | timeRange=7d | events=5
```

```json
{
  "group": {
    "name": "projects/my-sre-prod/groups/abcdef1234567890",
    "resolutionStatus": "OPEN"
  },
  "events": [
    {
      "eventTime": "2025-03-04T22:13:42.000Z",
      "serviceContext": {
        "service": "checkout",
        "version": "20250304-1"
      },
      "message": "NullReferenceException at cart.ts:118",
      "context": {
        "httpRequest": {
          "method": "POST",
          "url": "https://checkout.example.com/api/cart"
        }
      }
    }
  ],
  "eventsOmitted": 0,
  "investigationSteps": [
    "Check Cloud Logging for related entries around the error timestamps.",
    "Review Monitoring dashboards for correlated latency or saturation signals."
  ]
}
```

### gcp-error-reporting-analyse-trends — Error trends over time
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| timeRange | string | no | `24h` | Same options as above. |
| serviceFilter | string | no | none | Filter by service. |
| resolution | enum[`1m`,`5m`,`1h`,`1d`] | no | `1h` | Maps to `timedCountDuration`. |

**Call example**
```jsonc
{
  "name": "gcp-error-reporting-analyse-trends",
  "arguments": {
    "timeRange": "7d",
    "resolution": "1h"
  }
}
```

**Response example**
```text
Error Trends Analysis
projectId=my-sre-prod | timeRange=7d | resolution=1h | groups=18
```

```json
{
  "summary": {
    "totalGroups": 18,
    "totalErrors": 5120,
    "averagePerGroup": 284
  },
  "timeline": [
    {
      "time": "2025-03-04T22:00:00Z",
      "count": 210
    }
  ],
  "timelineOmitted": 12,
  "spikes": [
    {
      "time": "2025-03-05T03:00:00Z",
      "count": 640,
      "multiple": 2.6
    }
  ],
  "topContributors": [
    {
      "groupId": "checkout-timeout",
      "service": "checkout",
      "message": "Deadline exceeded calling inventory",
      "count": 480,
      "percentage": 9
    }
  ],
  "recommendations": [
    "Investigate the 3 time windows where error volumes exceeded 2x the rolling average (284)."
  ]
}
```

## Profiler

Profiler responses follow the summary+JSON contract, with profile samples and analysis markdown truncated via `PROFILER_*` preview limits.

### gcp-profiler-list-profiles — List raw profiles
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| pageSize | number | no | 50 (1-1000) | Max profiles per request. |
| pageToken | string | no |  | Use to fetch next page. |
| profileType | enum[`CPU`,`WALL`,`HEAP`,`THREADS`,`CONTENTION`,`PEAK_HEAP`,`HEAP_ALLOC`] | no | all | Filter by type. |
| target | string | no |  | Filter by `deployment.target` substring. |

**Call example**
```jsonc
{
  "name": "gcp-profiler-list-profiles",
  "arguments": {
    "profileType": "CPU",
    "target": "checkout",
    "pageSize": 25
  }
}
```

**Response example**
```text
Profiler Profiles
projectId=perf-lab | profileType=CPU | target=checkout | returned=10 | omitted=5
```

```json
{
  "profiles": [
    {
      "profileId": "cpu-20250305T0340Z",
      "profileType": "CPU",
      "target": "checkout",
      "startTime": "2025-03-05T03:40:00.000Z",
      "durationSeconds": 10,
      "summaryMarkdown": "## Profile: cpu-20250305T0340Z..."
    }
  ],
  "profilesOmitted": 5,
  "nextPageToken": "Cg0IARABGAEiB...",
  "analysisMarkdown": "# Profile Analysis and Performance Insights...",
  "analysisTruncated": true
}
```

### gcp-profiler-analyse-performance — Summarize profiles
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| profileType | enum[...] | no | all | Focus on a specific type. |
| target | string | no |  | Filter by deployment target. |
| pageSize | number | no | 100 (1-1000) | Number of profiles analysed. |

**Call example**
```jsonc
{
  "name": "gcp-profiler-analyse-performance",
  "arguments": {
    "profileType": "HEAP",
    "target": "orders",
    "pageSize": 80
  }
}
```

**Response example**
```text
Profile Performance Analysis
projectId=perf-lab | profileType=HEAP | target=orders | analysed=62
```

```json
{
  "summary": {
    "analysedProfiles": 62,
    "profileTypeDescription": "Heap Memory - Shows memory allocations and usage patterns",
    "target": "orders"
  },
  "sampleProfiles": [
    {
      "profileId": "heap-20250305T0200Z",
      "profileType": "HEAP",
      "target": "orders",
      "startTime": "2025-03-05T02:00:00.000Z"
    }
  ],
  "sampleProfilesOmitted": 37,
  "overviewMarkdown": "# Profile Analysis and Performance Insights...",
  "overviewTruncated": true,
  "timelineMarkdown": "### Profile Collection Timeline...",
  "timelineTruncated": true,
  "deploymentsMarkdown": "### Deployment Analysis...",
  "deploymentsTruncated": true,
  "recommendationsMarkdown": "**Immediate Actions:** ...",
  "recommendationsTruncated": false
}
```

### gcp-profiler-compare-trends — Compare performance trends
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| target | string | no |  | Deployment target focus. |
| profileType | enum[...] | no | all | Type focus. |
| pageSize | number | no | 200 (1-1000) | Profiles considered for the trend. |

**Call example**
```jsonc
{
  "name": "gcp-profiler-compare-trends",
  "arguments": {
    "profileType": "CPU",
    "target": "api-gateway",
    "pageSize": 150
  }
}
```

**Response example**
```text
Profile Trend Analysis
projectId=perf-lab | profileType=CPU | analysed=132
```

```json
{
  "summary": {
    "analysedProfiles": 132,
    "profileTypeDescription": "CPU Time - Shows where your application spends CPU time"
  },
  "sampleProfiles": [
    {
      "profileId": "cpu-20250304T1800Z",
      "target": "api-gateway",
      "startTime": "2025-03-04T18:00:00.000Z"
    }
  ],
  "sampleProfilesOmitted": 97,
  "trendMarkdown": "## Trend Analysis\n### Profile Collection Frequency ...",
  "trendMarkdownTruncated": true
}
```

## Support API

Support tools return sanitized case/comment/attachment previews plus metadata so automations can reason about truncation; configure the `SUPPORT_*` preview limits as needed.

### gcp-support-list-cases — List support cases
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| parent | string | no | `projects/{currentProject}` | Use `projects/{id}` or `organizations/{id}`. |
| pageSize | number | no | 20 (1-100) | Max cases. |
| pageToken | string | no |  | Pagination token. |
| filter | string | no |  | e.g., `state=OPEN AND priority=P1`. |

**Call example**
```jsonc
{
  "name": "gcp-support-list-cases",
  "arguments": {
    "filter": "state=OPEN AND priority=P1",
    "pageSize": 10
  }
}
```

**Response example**
```text
Support Cases
parent=projects/my-sre-prod | filter=state=OPEN AND priority=P1 | returned=3 | omitted=2
```

```json
{
  "cases": [
    {
      "name": "projects/my-sre-prod/cases/12345",
      "displayName": "network outage",
      "priority": "P1",
      "state": "OPEN",
      "classification": {
        "id": "100152",
        "displayName": "Cloud Run > Deployments"
      },
      "description": "Intermittent 503s in us-central1",
      "descriptionTruncated": false
    }
  ],
  "casesOmitted": 2,
  "nextPageToken": "AjABCD..."
}
```

### gcp-support-search-cases — Free-text search
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| parent | string | no | active project | Scope to search. |
| query | string | yes |  | Supports field filters, e.g., `displayName:"upgrade"`. |
| pageSize | number | no | 20 (1-100) | Max cases. |
| pageToken | string | no |  | Pagination token. |

**Call example**
```jsonc
{
  "name": "gcp-support-search-cases",
  "arguments": {
    "query": "displayName:incident state=OPEN",
    "pageSize": 5
  }
}
```

**Response example**
```text
Support Case Search
parent=projects/my-sre-prod | query=displayName:incident state=OPEN | returned=2
```

```json
{
  "cases": [
    {
      "name": "projects/my-sre-prod/cases/67890",
      "displayName": "Incident 500s",
      "priority": "P2",
      "state": "OPEN"
    }
  ],
  "casesOmitted": 0
}
```

### gcp-support-get-case — Fetch case details
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| name | string | yes | `projects/{id}/cases/{caseId}` | Fully-qualified case resource. |

**Call example**
```jsonc
{
  "name": "gcp-support-get-case",
  "arguments": {
    "name": "projects/my-sre-prod/cases/12345"
  }
}
```

**Response example**
```text
Support Case Details
caseName=projects/my-sre-prod/cases/12345 | priority=P1 | state=OPEN
```

```json
{
  "case": {
    "name": "projects/my-sre-prod/cases/12345",
    "displayName": "Cloud Run deploy fails",
    "priority": "P1",
    "state": "OPEN",
    "classification": {
      "id": "100152",
      "displayName": "Cloud Run > Deployments"
    },
    "description": "Traffic hitting 503 on us-central1",
    "contactEmail": "sre@example.com"
  },
  "detailsMarkdown": "# Support Case Details..."
}
```

### gcp-support-create-case — Create a new case
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| parent | string | no | active project | `projects/{id}` or `organizations/{id}`. |
| displayName | string | yes | min 4 chars | Case title. |
| description | string | yes | min 10 chars | Issue description. |
| classificationId | string | yes |  | Obtain via `gcp-support-search-classifications`. |
| priority | enum[`P0`,`P1`,`P2`,`P3`,`P4`,`PRIORITY_UNSPECIFIED`] | no | `P3` | Case priority. |
| timeZone | string | no |  | IANA TZ. |
| languageCode | string | no |  | e.g., `en-US`. |
| contactEmail | string | no | valid email | Primary contact. |
| subscriberEmailAddresses | array<string> | no |  | Additional notification recipients. |

**Call example**
```jsonc
{
  "name": "gcp-support-create-case",
  "arguments": {
    "displayName": "Cloud Run deploy fails",
    "description": "New revisions fail with 503 since 09:15 UTC",
    "classificationId": "100152",
    "priority": "P1",
    "contactEmail": "oncall@example.com"
  }
}
```

**Response example**
```text
Support Case Created
parent=projects/my-sre-prod | case=projects/my-sre-prod/cases/98765 | status=created
```

```json
{
  "case": {
    "name": "projects/my-sre-prod/cases/98765",
    "displayName": "Cloud Run deploy fails",
    "priority": "P1",
    "state": "NEW"
  },
  "detailsMarkdown": "# Support Case Details...",
  "status": "created"
}
```

### gcp-support-update-case — Update case fields
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| name | string | yes |  | Case resource to update. |
| displayName | string | no |  | Title update. |
| description | string | no |  | Description update. |
| classificationId | string | no |  | New classification ID. |
| priority | enum[`P0`…`PRIORITY_UNSPECIFIED`] | no |  | Priority change. |
| contactEmail | string | no |  | Primary contact. |
| subscriberEmailAddresses | array<string> | no |  | Notification recipients. |
| languageCode | string | no |  | Preferred language. |
| timeZone | string | no |  | Case timezone. |

**Call example**
```jsonc
{
  "name": "gcp-support-update-case",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765",
    "priority": "P2",
    "subscriberEmailAddresses": ["mgr@example.com"]
  }
}
```

**Response example**
```text
Support Case Updated
caseName=projects/my-sre-prod/cases/98765 | updateMask=priority,subscriberEmailAddresses
```

```json
{
  "case": {
    "name": "projects/my-sre-prod/cases/98765",
    "priority": "P2",
    "subscriberEmailAddresses": [
      "mgr@example.com"
    ]
  },
  "detailsMarkdown": "# Support Case Details...",
  "status": "updated"
}
```

### gcp-support-close-case — Close a case
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| name | string | yes |  | Case resource. |
| justification | string | no |  | Optional closure note. |

**Call example**
```jsonc
{
  "name": "gcp-support-close-case",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765",
    "justification": "Issue resolved after rollback"
  }
}
```

**Response example**
```text
Support Case Closed
caseName=projects/my-sre-prod/cases/98765 | justification=Issue resolved after rollback
```

```json
{
  "case": {
    "name": "projects/my-sre-prod/cases/98765",
    "state": "CLOSED"
  },
  "detailsMarkdown": "# Support Case Details...",
  "status": "closed",
  "justification": "Issue resolved after rollback"
}
```

### gcp-support-list-comments — List comments
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| name | string | yes |  | Case resource. |
| pageSize | number | no | 20 (1-100) | Max comments. |
| pageToken | string | no |  | Pagination token. |

**Call example**
```jsonc
{
  "name": "gcp-support-list-comments",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765",
    "pageSize": 5
  }
}
```

**Response example**
```text
Support Case Comments
caseName=projects/my-sre-prod/cases/98765 | returned=3 | omitted=2
```

```json
{
  "comments": [
    {
      "name": "projects/.../comments/1",
      "createTime": "2025-03-05T04:10:00.000Z",
      "creator": { "googleSupport": true },
      "body": "Please attach stack traces",
      "bodyTruncated": false
    }
  ],
  "commentsOmitted": 2,
  "nextPageToken": "BCDE..."
}
```

### gcp-support-create-comment — Add a comment
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| name | string | yes |  | Case resource. |
| body | string | yes | min 1 char | Comment body. |

**Call example**
```jsonc
{
  "name": "gcp-support-create-comment",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765",
    "body": "Attached Cloud Storage link with tcpdump"
  }
}
```

**Response example**
```text
Support Case Comment Created
caseName=projects/my-sre-prod/cases/98765 | status=created
```

```json
{
  "comment": {
    "name": "projects/.../comments/4",
    "createTime": "2025-03-05T04:33:00.000Z",
    "body": "Attached Cloud Storage link with tcpdump"
  },
  "status": "created"
}
```

### gcp-support-list-attachments — List attachments
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| name | string | yes |  | Case resource. |
| pageSize | number | no | 20 (1-100) | Max attachments. |
| pageToken | string | no |  | Pagination token. |

**Call example**
```jsonc
{
  "name": "gcp-support-list-attachments",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765"
  }
}
```

**Response example**
```text
Support Case Attachments
caseName=projects/my-sre-prod/cases/98765 | returned=2
```

```json
{
  "attachments": [
    {
      "name": "projects/.../attachments/1",
      "filename": "error-logs.zip",
      "mimeType": "application/zip",
      "sizeBytes": "2400000"
    },
    {
      "name": "projects/.../attachments/2",
      "filename": "tcpdump.har",
      "mimeType": "application/json",
      "sizeBytes": "5100000"
    }
  ],
  "attachmentsOmitted": 0,
  "markdown": "1. error-logs.zip..."
}
```

### gcp-support-search-classifications — Classification lookup
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| query | string | yes |  | e.g., `id:"100445"` or `displayName:"service account"`. |
| pageSize | number | no | 20 (1-100) | Max classifications. |
| pageToken | string | no |  | Pagination token. |

**Call example**
```jsonc
{
  "name": "gcp-support-search-classifications",
  "arguments": {
    "query": "displayName:\"Cloud Run\"",
    "pageSize": 10
  }
}
```

**Response example**
```text
Case Classifications
query=displayName:"Cloud Run" | returned=4
```

```json
{
  "classifications": [
    {
      "id": "100152",
      "displayName": "Cloud Run > Deployments > 5xx"
    }
  ],
  "classificationsOmitted": 0,
  "markdown": "- 100152 Cloud Run > Deployments > 5xx"
}
```

## Project Utilities

### gcp-resource-manager-set-project-id — Set default project
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| project_id | string | yes |  | Project used by subsequent tools. |

**Call example**
```jsonc
{
  "name": "gcp-resource-manager-set-project-id",
  "arguments": { "project_id": "my-sre-prod" }
}
```

**Response example**
```text
# Project ID Updated
Default Google Cloud project ID has been set to: `my-sre-prod`
```

### gcp-resource-manager-get-project-id — Show current project
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | No arguments required. |

**Call example**
```jsonc
{ "name": "gcp-resource-manager-get-project-id", "arguments": {} }
```

**Response example**
```text
# Current Google Cloud Project
Current project ID: `my-sre-prod`
## Recently Used Projects
- `my-sre-prod` (current)
- `analytics-playground`
```

## Resource Reference

MCP resources are retrieved with `read_resource` / `get_resource`. Unless noted otherwise, placeholders such as `{projectId}`, `{instanceId}`, or `{databaseId}` can be omitted to fall back to the defaults established via `gcp-resource-manager-set-project-id` or Google Cloud authentication context.

### Logging Resources
| Resource | URI template | Parameters | Response |
| --- | --- | --- | --- |
| `gcp-logging-recent-logs` | `gcp-logs://{projectId}/recent` | `projectId` optional; defaults to active project. | Returns the latest 50 log entries using `LOG_FILTER` (if set) plus a redaction notice and metadata summary. |
| `gcp-logging-filtered-logs` | `gcp-logs://{projectId}/filter/{filter}` | `filter` path segment must be URL-encoded Cloud Logging filter; `projectId` optional. | Lists up to 50 entries that match the filter with severity/resource metadata and truncation notes. |

### Monitoring Resources
| Resource | URI template | Parameters | Response |
| --- | --- | --- | --- |
| `gcp-monitoring-recent-metrics` | `gcp-monitoring://{projectId}/recent` | Uses `MONITORING_FILTER` env var or CPU metric if unset. | Shows one hour of time series data, summarised via `buildStructuredTextBlock` with omitted-series counts. |
| `gcp-monitoring-filtered-metrics` | `gcp-monitoring://{projectId}/filter/{filter}` | `filter` path segment URL-encoded; window fixed to last hour. | Returns the same structured time series view scoped to the supplied Monitoring filter. |

### Spanner Resources
| Resource | URI template | Parameters | Response |
| --- | --- | --- | --- |
| `gcp-spanner-database-schema` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/schema` | Provide instance/database or rely on env/state defaults. | Markdown schema with tables, columns, indexes, and foreign keys for SQL generation. |
| `gcp-spanner-table-preview` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/tables/{tableName}/preview` | `tableName` must match `[A-Za-z][A-Za-z0-9_]*`; preview row limit governed by `SPANNER_ROW_PREVIEW_LIMIT`. | Tabular preview (up to limit) plus notes when zero rows or truncation occurs. |
| `gcp-spanner-database-tables` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/tables` | Same defaults as above. | Markdown table of table names + column counts plus quick links to schema/preview URIs. |
| `gcp-spanner-query-plan` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-plan?sql=<URL-encoded>&mode=explain\|analyze` | `sql` query parameter required; use `mode=analyze` or `analyze=1` for EXPLAIN ANALYZE. | Returns plan markdown, distributed-join/index insights, and notes about whether the query was executed. |
| `gcp-spanner-query-stats` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-stats` | Inherits instance/database defaults. | Raw JSON from `buildQueryStatsJson` summarising latencies, optimizer versions, and top queries. |

### Trace Resources
| Resource | URI template | Parameters | Response |
| --- | --- | --- | --- |
| `gcp-trace-get-by-id` | `gcp-trace://{projectId}/traces/{traceId}` | `traceId` must be hex. | Hierarchical span breakdown rendered as markdown with timing metadata. |
| `gcp-trace-related-logs` | `gcp-trace://{projectId}/traces/{traceId}/logs` | `traceId` hex; reuses Logging API to expand related entries. | Up to 50 log entries that reference the trace ID, including resource/label breakdowns. |
| `gcp-trace-recent-failed` | `gcp-trace://{projectId}/recent-failed?startTime=<ISO\|1h\|6h\|30m>` | Optional `startTime` query accepts ISO timestamp or relative tokens (`1h`, `2d`, etc.). | Table of non-zero status traces between `startTime` and now with duration, error message, and deep links. |

### Error Reporting Resources
| Resource | URI template | Parameters | Response |
| --- | --- | --- | --- |
| `gcp-error-reporting-recent-errors` | `gcp-error-reporting://{projectId}/recent` | Analyses last hour of data. | Markdown summary of dominant error groups plus remediation suggestions. |
| `gcp-error-reporting-error-analysis` | `gcp-error-reporting://{projectId}/analysis/{timeRange}` | `timeRange` accepts `1h`, `6h`, `24h`, `7d`, or `30d`; defaults to `1h`. | Same analysis pipeline over the selected window with group counts and recommendations. |
| `gcp-error-reporting-service-errors` | `gcp-error-reporting://{projectId}/service/{serviceName}` | `serviceName` path segment filters `serviceFilter.service`. | 24-hour service-scoped error digestion with trend and remediation text. |

### Profiler Resources
| Resource | URI template | Parameters | Response |
| --- | --- | --- | --- |
| `gcp-profiler-all-profiles` | `gcp-profiler://{projectId}/profiles` | Requires Cloud Profiler API + auth; fetches up to 100 profiles. | Markdown digest of collected profiles, skipped counts, and per-profile summaries. |
| `gcp-profiler-cpu-profiles` | `gcp-profiler://{projectId}/cpu-profiles` | Same auth requirements. | CPU-only subset with hotspot analysis and optimisation recommendations. |
| `gcp-profiler-memory-profiles` | `gcp-profiler://{projectId}/memory-profiles` | Filters to HEAP / HEAP_ALLOC / PEAK_HEAP types. | Memory-distribution analysis plus leak/memory-management guidance. |
| `gcp-profiler-performance-recommendations` | `gcp-profiler://{projectId}/performance-recommendations` | Fetches up to 200 profiles for broader insights. | Comprehensive performance plan (immediate/medium/long-term) derived from recent profiles. |
