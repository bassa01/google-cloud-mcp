# Google Cloud MCP Server

A Model Context Protocol server that connects to Google Cloud services to provide context and tools for interacting with your Google Cloud resources.

This codebase is actively maintained as a fork of [krzko/google-cloud-mcp](https://github.com/krzko/google-cloud-mcp), and we’re grateful to Kris Kozak and contributors for laying the groundwork that powers this project.

<a href="https://glama.ai/mcp/servers/@krzko/google-cloud-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@krzko/google-cloud-mcp/badge" alt="Google Cloud Server MCP server" />
</a>

## Requirements

- Node.js 24.11.0 or newer (see `.nvmrc`)
- pnpm 10.21.0+ via Corepack (`corepack enable && corepack use pnpm@10.21.0`)

## Services

Supported Google Cloud services:

- [x] [Error Reporting](https://cloud.google.com/error-reporting)
- [x] [Logging](https://cloud.google.com/logging)
- [x] [Monitoring](https://cloud.google.com/monitoring)
- [x] [Profiler](https://cloud.google.com/profiler)
- [x] [Spanner](https://cloud.google.com/spanner)
- [x] [Trace](https://cloud.google.com/trace)
- [x] [Support](https://cloud.google.com/support/docs/reference/rest)

### Selecting active services

Set the optional `MCP_ENABLED_SERVICES` environment variable to a comma-separated
list (e.g. `spanner,trace`) to load only the services you need. When unset or
set to `all`/`*`, the server registers every Google Cloud integration. Unknown
entries are ignored with a startup warning, and common aliases such as
`metrics`→Monitoring or `errors`→Error Reporting are supported for convenience.

```json
"env": {
  "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/key.json",
  "MCP_ENABLED_SERVICES": "spanner,trace"
}
```

### Error Reporting

Monitor and analyse application errors with automated investigation and remediation suggestions:

**Tools:** `gcp-error-reporting-list-groups`, `gcp-error-reporting-get-group-details`, `gcp-error-reporting-analyse-trends`

*Example prompts:*
- "Show me error groups from project my-webapp-prod-789 for the last hour"
- "Get details for error group projects/my-app-123/groups/xyz789"
- "Analyse error trends for service my-api in project analytics-prod-456"

### Logging

Query and filter log entries from Google Cloud Logging:

**Tools:** `gcp-logging-query-logs`, `gcp-logging-query-time-range`, `gcp-logging-search-comprehensive`

*Example prompts:*
- "Show me logs from project my-app-prod-123 from the last hour with severity ERROR"
- "Search for logs containing 'timeout' from service my-api in project backend-456"
- "Query logs for resource type gce_instance in project compute-prod-789"

#### Log redaction policy

All `gcp-logging-*` tools scrub IP addresses, user identifiers, and request bodies before results leave the server. To permit trusted operators to view full payloads, set the comma-separated `LOG_PAYLOAD_FULL_ACCESS_ROLES` environment variable (defaults to `security_admin,compliance_admin,site_reliability_admin`) and provide matching roles through `MCP_USER_ROLES`/`MCP_ACTIVE_ROLES`. A role match is required before payload redaction is lifted.

#### Response sizing & preview controls

To keep MCP responses LLM-friendly, every tool now emits a short metadata line followed by JSON data, and large result sets are previewed instead of streamed in full. Tune the preview windows with the following environment variables:

| Variable | Default | Scope |
| --- | --- | --- |
| `LOG_OUTPUT_PREVIEW_LIMIT` (alias `LOG_OUTPUT_MAX`) | `20` entries | Caps how many log entries are returned per call. |
| `LOG_TEXT_PAYLOAD_PREVIEW` | `600` characters | Truncates long `textPayload` values with an ellipsis. |
| `SPANNER_ROW_PREVIEW_LIMIT` | `50` rows | Limits `execute-query`, `list-*`, and NL query outputs. |
| `SPANNER_QUERY_COUNT_SERIES_LIMIT` | `5` series | Maximum Spanner query-count time series per response. |
| `SPANNER_QUERY_COUNT_POINT_LIMIT` | `60` points | Per-series datapoint cap for query-count results. |
| `MONITORING_SERIES_PREVIEW_LIMIT` | `5` series | Maximum Monitoring time series per response. |
| `MONITORING_POINT_PREVIEW_LIMIT` | `12` points | Per-series datapoint cap for Monitoring results. |

Each response clearly reports how many rows/series were omitted so that automations can decide whether to narrow filters or request a smaller time window.

### Spanner

Interact with Google Cloud Spanner databases:

**Tools:** `gcp-spanner-execute-query`, `gcp-spanner-list-tables`, `gcp-spanner-list-instances`, `gcp-spanner-list-databases`, `gcp-spanner-query-natural-language`, `gcp-spanner-query-count`

**Resource Highlight:** `gcp-spanner-query-stats` surfaces Query Insights (SPANNER_SYS.QUERY_STATS_TOP_MINUTE/10MINUTE/HOUR) as AI-ready JSON, listing 1m/10m/1h latency and CPU leaders for downstream automation.
**Resources:** `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-plan?sql=SELECT+...` (add `&mode=analyze` for EXPLAIN ANALYZE) to review plans, distributed joins, and missing indexes.

*Example prompts:*
- "List all databases in Spanner instance my-instance in project ecommerce-prod-123"
- "Execute SQL: SELECT COUNT(*) FROM users in database user-db in project my-app-456"
- "Show me table structure for orders in database inventory-db in project retail-789"

### Monitoring

Retrieve and analyse metrics from Google Cloud Monitoring:

**Tools:** `gcp-monitoring-query-metrics`, `gcp-monitoring-list-metric-types`, `gcp-monitoring-query-natural-language`

*Example prompts:*
- "Show me CPU utilisation metrics for project web-app-prod-123 for the last 6 hours"
- "List available metric types for Compute Engine in project infrastructure-456"
- "Query memory usage for instances in project backend-services-789"

### Profiler

Analyse application performance with Google Cloud Profiler:

**Tools:** `gcp-profiler-list-profiles`, `gcp-profiler-analyse-performance`, `gcp-profiler-compare-trends`

*Example prompts:*
- "List CPU profiles from project my-java-app-123 for the last 24 hours"
- "Analyse performance bottlenecks in service my-api in project backend-prod-456"
- "Compare heap profiles for deployment v1.2 vs v1.3 in project performance-test-789"

### Trace

Analyse distributed traces from Google Cloud Trace:

**Tools:** `gcp-trace-get-trace`, `gcp-trace-list-traces`, `gcp-trace-find-from-logs`, `gcp-trace-query-natural-language`

*Example prompts:*
- "Get trace details for ID abc123def456 in project distributed-app-789"
- "Show me failed traces from project microservices-prod-123 from the last hour"
- "Find logs related to trace xyz789 in project web-backend-456"
- "Query traces for service checkout-api in project ecommerce-prod-321"

## Deep Wiki / 詳細ドキュメント

- [Deep Dive (English)](docs/deep-dive-en.md)
- [詳細ガイド (日本語)](docs/deep-dive-ja.md)

## Quick Start

Once configured, you can interact with Google Cloud services using natural language:

```
"Show me errors from project ecommerce-api-456 in the last hour"
"Find logs containing 'database timeout' from project backend-prod-321 yesterday"
"List Spanner databases in instance prod-db for project data-store-654"
"What's the CPU usage of Compute Engine instances in project infrastructure-987?"
"Compare recent heap profiles in project performance-test-789"
"List traces for checkout-api in project ecommerce-prod-321 during the past day"
```

## Authentication

This server supports two methods of authentication with Google Cloud:

1. **Service Account Key File** (Recommended): Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of your service account key file. This is the standard Google Cloud authentication method.

2. **Environment Variables**: Set `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` environment variables directly. This is useful for environments where storing a key file is not practical.

The server will also use the `GOOGLE_CLOUD_PROJECT` environment variable if set, otherwise it will attempt to determine the project ID from the authentication credentials.

## Installation

```bash
# Clone the repository
git clone https://github.com/krzko/google-cloud-mcp.git
cd google-cloud-mcp

# Install dependencies
pnpm install

# Build
pnpm build
```

Authenticate to Google Cloud:

```bash
gcloud auth application-default login
```

Configure the `mcpServers` in your client:

```json
{
  "mcpServers": {
      "google-cloud-mcp": {
          "command": "node",
          "args": [
              "/Users/foo/code/google-cloud-mcp/dist/index.js"
          ],
          "env": {
              "GOOGLE_APPLICATION_CREDENTIALS": "/Users/foo/.config/gcloud/application_default_credentials.json"
          }
      }
  }
}
```

## Development

### Starting the server

```bash
# Build the project
pnpm build

# Start the server
pnpm start
```

### Development mode

```bash
# Build the project
pnpm build

# Start the server and inspector
npx -y @modelcontextprotocol/inspector node dist/index.js
```

## Troubleshooting

### Server Timeout Issues

If you encounter timeout issues when running the server with Smithery, try the following:

1. Enable debug logging by setting `debug: true` in your configuration
2. Ensure `lazyAuth: true` is set to defer authentication until it's actually needed
3. Ensure your credentials file is accessible and valid
4. Check the logs for any error messages

**Important**: Authentication is still required for operation, but with lazy loading enabled, the server will start immediately and authenticate when needed rather than during initialization.

### Authentication Issues

The server supports two methods of authentication:

1. **Service Account Key File**: Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of your service account key file
2. **Environment Variables**: Set `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` environment variables

If you're having authentication issues, make sure:

- Your service account has the necessary permissions
- The key file is properly formatted and accessible
- Environment variables are correctly set
