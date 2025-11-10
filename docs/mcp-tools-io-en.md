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

### gcp-spanner-query-natural-language — NL helper
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| query | string | yes |  | Describe the desired read-only result (“List top 20 orders over $100”). |
| instanceId | string | no | env/state | Target instance. |
| databaseId | string | no | env/state | Target database. |

**Call example**
```jsonc
{
  "name": "gcp-spanner-query-natural-language",
  "arguments": {
    "query": "List the first 20 orders with total > 100 USD"
  }
}
```

⚠️ Generated SQL is validated with the same read-only guard as `gcp-spanner-execute-query`; any DML/DDL or multi-statement output is blocked before hitting Spanner.

**Response example**
```text
Spanner Query Results
projectId=prod-data | instance=main-instance | database=ledger
```

```json
{
  "naturalLanguageQuery": "List the first 20 orders with total > 100 USD",
  "generatedSql": "SELECT * FROM orders WHERE total > 100 LIMIT 20",
  "rows": [
    { "order_id": "ORD-1001", "total": 240.15, "status": "PENDING" },
    { "...": "..." }
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

### gcp-monitoring-query-natural-language — NL metric query
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| query | string | yes |  | e.g., “Show App Engine latency by region for the last day.” |
| startTime | string | no | `1h` | Relative/ISO override. |
| endTime | string | no | now | End timestamp. |
| alignmentPeriod | string | no | unset | `<number><s|m|h|d>`. |

**Call example**
```jsonc
{
  "name": "gcp-monitoring-query-natural-language",
  "arguments": {
    "query": "Show App Engine latency by region for the last day",
    "alignmentPeriod": "5m"
  }
}
```

**Response example**
```text
Natural Language Query Results
projectId=sre-metrics | generatedFilter=metric.type="appengine.googleapis.com/http/server/response_latencies" | timeRange=2025-03-04T00:00:00Z -> 2025-03-05T00:00:00Z
```

```json
{
  "query": "Show App Engine latency by region for the last day",
  "series": [
    {
      "metricType": "appengine.googleapis.com/http/server/response_latencies",
      "metricLabels": { "region": "us-central" },
      "points": [
        { "timestamp": "2025-03-04T12:00:00Z", "value": 320.5 },
        { "...": "..." }
      ]
    }
  ]
}
```

## Trace

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
Trace: projects/my-sre-prod/traces/4f6c2d9b1a8e5cf2
Duration: 842 ms
Root Span: frontend:/orders
- Span checkout/service (120 ms)
  - Span charge-card (430 ms)
...
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
# Trace Search Results
Project: my-sre-prod
Time Range: 2025-03-05T02:10:00Z–2025-03-05T04:10:00Z
| Trace ID | Latency | Root Span | Status |
| 4f6c2d9b1a8e5cf2 | 842 ms | frontend:/orders | ERROR |
...
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
# Traces Found in Logs
Project: my-sre-prod
Log Filter: severity>=ERROR ...
Found 12 unique traces in 37 log entries
| Trace ID | Timestamp | Severity | Log Name | Message |
| 4f6c2d9b1a8e5cf2 | 2025-03-05T03:42:10Z | ERROR | run.googleapis.com/request_log | ... |
```

### gcp-trace-query-natural-language — NL trace analysis
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| query | string | yes |  | e.g., “Find the last 5 failed checkout traces.” Trace IDs inside the query trigger direct fetches. |
| projectId | string | no | active project | Optional override. |

**Call example**
```jsonc
{
  "name": "gcp-trace-query-natural-language",
  "arguments": {
    "query": "Find the last 5 traces with errors in checkout within the past hour"
  }
}
```

**Response example**
```text
# Trace Trend Summary
Detected intent: error traces / window=1h / limit=5
| Trace ID | Timestamp | Service | Status |
| 4f6c2d9b1a8e5cf2 | 2025-03-05T03:42:10Z | checkout | ERROR |
...
```

## Error Reporting

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
# Error Groups Analysis
Project: my-sre-prod
Time Range: 24h
Service Filter: checkout
1. checkout — NullReferenceException — 152 hits
2. checkout — Timeout contacting inventory — 47 hits
...
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
# Error Group Details
Group ID: abcdef1234567890
Project: my-sre-prod
Time Range: 7d
## Recent Error Events (5)
1. 2025/03/04 22:13:42 — checkout v20250304-1 — NullReferenceException at cart.ts:118
...
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
# Error Trends Analysis
Project: my-sre-prod
Time Range: 7d / Resolution: 1h
## Summary
- Total Error Groups: 18
- Total Errors: 4,832
## Error Count Over Time
| Time Period | Error Count |
...
```

## Profiler

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
# Profiler Analysis
Project: perf-lab
Profile Type Filter: CPU
Target Filter: checkout
1. CPU @ checkout (2025-03-05T03:40Z, duration 10s)
...
Next Page Available: token "Cg0IARABGAEiB..."
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
# Profile Performance Analysis
Project: perf-lab
Focus: Heap profile (allocation)
Analysed: 62 profiles
## Performance Insights
- Top allocation packages...
## Actionable Recommendations
- Increase sampling on checkout-worker
...
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
# Profile Trend Analysis
Project: perf-lab
Profile Type: CPU
Analysed: 132 profiles
## Trend Summary
- Average CPU: 420 ms → 610 ms (+45%) week-over-week
- Regression detected after deploy 2025-03-04
```

## Support API

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
# Support Cases
Parent: projects/my-sre-prod
Returned: 3
1. [P1][OPEN] network outage - case/12345
...
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
# Support Case Search
Parent: projects/my-sre-prod
Query: displayName:incident state=OPEN
Returned: 2
1. [P2][OPEN] Incident 500s - case/67890
...
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
Case: projects/my-sre-prod/cases/12345
State: OPEN / Priority: P1
Description: Traffic hitting 503 on us-central1
Contacts: sre@example.com
...
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
Case: projects/my-sre-prod/cases/98765
State: NEW / Priority: P1
✅ Support case created successfully in projects/my-sre-prod
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
Case: projects/my-sre-prod/cases/98765
Updated fields: priority=P2, subscribers=1
✅ Support case projects/my-sre-prod/cases/98765 updated successfully.
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
Case: projects/my-sre-prod/cases/98765
State: CLOSED
✅ Support case projects/my-sre-prod/cases/98765 closed.
Justification: Issue resolved after rollback
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
# Support Case Comments
Case: projects/my-sre-prod/cases/98765
Returned: 3
- 2025-03-05T04:10Z Google: Please attach stack traces
- 2025-03-05T04:18Z You: Uploaded logs
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
✅ Comment added to projects/my-sre-prod/cases/98765.
- 2025-03-05T04:33Z You: Attached Cloud Storage link with tcpdump
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
# Support Case Attachments
Case: projects/my-sre-prod/cases/98765
Returned: 2
1. error-logs.zip (2.4 MB)
2. tcpdump.har (5.1 MB)
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
# Case Classifications
Query: displayName:"Cloud Run"
Returned: 4
- 100152 Cloud Run > Deployments > 5xx
...
```

## Project Utilities

### gcp-utils-set-project-id — Set default project
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| project_id | string | yes |  | Project used by subsequent tools. |

**Call example**
```jsonc
{
  "name": "gcp-utils-set-project-id",
  "arguments": { "project_id": "my-sre-prod" }
}
```

**Response example**
```text
# Project ID Updated
Default Google Cloud project ID has been set to: `my-sre-prod`
```

### gcp-utils-get-project-id — Show current project
| Field | Type | Required | Default / Constraints | Description |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | No arguments required. |

**Call example**
```jsonc
{ "name": "gcp-utils-get-project-id", "arguments": {} }
```

**Response example**
```text
# Current Google Cloud Project
Current project ID: `my-sre-prod`
## Recently Used Projects
- `my-sre-prod` (current)
- `analytics-playground`
```
