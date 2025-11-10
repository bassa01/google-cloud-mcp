# Google Cloud MCP Deep Dive

## Overview

The Google Cloud MCP server exposes Google Cloud Platform (GCP) operations through the Model Context Protocol so that clients can invoke structured tools, browse knowledge, and automate workflows. This deep dive explains how the server is organised, how requests are handled, and how to make the most of each supported service. Use it alongside the high-level [README](../README.md) when you need architectural context or advanced usage patterns.

### Core capabilities

- Unifies access to Error Reporting, Logging, Monitoring, Profiler, Spanner, and Trace through a single MCP endpoint.
- Normalises authentication across service account credentials and direct environment variable secrets.
- Provides curated prompts, filters, and result formatting that are optimised for conversational agents.
- Ships with guard rails such as project scoping, time-range defaults, and pagination helpers to keep responses reliable.

## Architecture

### Component responsibilities

| Component | Description |
| --- | --- |
| `src/index.ts` | Boots the MCP server, registers services, and wires shared infrastructure such as logging. |
| `src/services/*` | Implements service-specific tool definitions, data mappers, and domain logic (for example, Monitoring metric queries). |
| `src/prompts/*` | Stores reusable prompt templates for generative query helpers such as natural-language Spanner searches. |
| `src/utils/*` | Helper utilities for authentication, request shaping, and result pagination shared by multiple services. |

### Request lifecycle

1. **Client request** – The MCP client sends a tool invocation with parameters supplied by the user or prompt template.
2. **Validation** – The server validates the payload with Zod schemas to ensure required fields and formats.
3. **Authentication context** – Credential helpers resolve project IDs, service account tokens, and region defaults.
4. **Service execution** – The relevant Google Cloud SDK is called, responses are normalised, and errors mapped to actionable messages.
5. **Response delivery** – Structured data and human-readable summaries are returned to the MCP client.

### Error handling strategy

- Each service wraps SDK errors to surface permission issues, missing resources, or throttling separately.
- Transient errors trigger retry hints while permanent failures recommend IAM or configuration fixes.
- Logging is routed through Winston so production deployments can centralise telemetry.

## Supported services

### Error Reporting

The Error Reporting tools surface error group metadata and trend analysis from Cloud Error Reporting. They are ideal for triaging production exceptions across multiple services.

**Key tools**

- `gcp-error-reporting-list-groups` – Lists error groups with filtering by time range and service context.
- `gcp-error-reporting-get-group-details` – Returns stack traces, occurrences, and affected services for a specific group.
- `gcp-error-reporting-analyse-trends` – Summarises frequency changes to flag regressions or emerging issues.

**Example workflow**

1. Filter groups for the affected project and service.
2. Retrieve group details to inspect stack traces.
3. Use trend analysis to decide whether the incident is escalating.

### Logging

Logging tools query Cloud Logging with flexible filters, consistent pagination, and summarised results to make log hunting conversational.

**Key tools**

- `gcp-logging-query-logs` – Runs advanced LogQL-style filters with severity and resource constraints.
- `gcp-logging-query-time-range` – Convenience helper focused on time-bounded searches.
- `gcp-logging-search-comprehensive` – Performs multi-field searches to uncover related events.

**Operational tips**

- Keep queries bounded to avoid quota issues.
- Combine severity filters with resource types to narrow noisy workloads.
- Use follow-up prompts to summarise or cluster returned entries.

### Monitoring

Monitoring tools query Cloud Monitoring metrics, making it easy to fetch CPU, memory, or custom metrics without memorising MQL.

**Key tools**

- `gcp-monitoring-query-metrics` – Executes parameterised MQL expressions.
- `gcp-monitoring-list-metric-types` – Discovers metric type URIs for services such as Compute Engine or Cloud Run.
- `gcp-monitoring-query-natural-language` – Converts plain-language prompts into MQL before execution.

**Operational tips**

- Use `list-metric-types` before natural-language queries to confirm metric availability.
- Provide alignment windows (e.g., 5m, 1h) to match dashboard expectations.
- Request aggregations (`mean`, `max`, `percentile`) to reduce result volume.

### Profiler

Profiler helpers analyse Cloud Profiler data so you can identify CPU, heap, or wall-time hot spots.

**Key tools**

- `gcp-profiler-list-profiles` – Lists profiles by type, deployment target, and date window.
- `gcp-profiler-analyse-performance` – Highlights dominant call stacks and performance regressions.
- `gcp-profiler-compare-trends` – Contrasts two profile sets to show improvements or regressions.

**Operational tips**

- Start with smaller date windows to avoid processing large profile collections.
- Use comparisons when validating new releases or configuration changes.

### Spanner

Spanner tools assist with schema discovery and SQL execution across distributed databases.

**Key tools**

- `gcp-spanner-list-instances`, `gcp-spanner-list-databases`, and `gcp-spanner-list-tables` catalogue your topology.
- `gcp-spanner-execute-query` runs raw SQL queries safely through parameter binding.
- `gcp-spanner-query-natural-language` and `gcp-spanner-query-count` build summary queries for conversational insights.
- `gcp-spanner-query-plan` (resource) runs EXPLAIN/EXPLAIN ANALYZE via \`gcp-spanner://.../query-plan?sql=SELECT+...\` and calls out distributed joins or missing indexes.

**Operational tips**

- Always scope to production vs. staging instances to avoid cross-environment confusion.
- Use natural-language helpers to draft queries, then refine them manually when needed.

### Trace

Trace utilities focus on distributed tracing diagnostics, correlating with logging where possible.

**Key tools**

- `gcp-trace-list-traces` – Lists traces by latency, span count, or time range.
- `gcp-trace-get-trace` – Retrieves full trace timelines for root-cause analysis.
- `gcp-trace-find-from-logs` – Cross-references log entries to locate related traces.
- `gcp-trace-query-natural-language` – Generates advanced filters from descriptive prompts.

**Operational tips**

- Pair `find-from-logs` with Logging queries to pivot quickly between traces and logs.
- Focus on latency percentiles (95th/99th) to track performance regressions.

## Authentication and authorisation

### Credential options

1. **Service account key file** – Point `GOOGLE_APPLICATION_CREDENTIALS` to a JSON file containing service account credentials. This is the most portable option for CLI or desktop MCP clients.
2. **Environment variables** – Provide `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` directly in environment configuration. Best suited for secret managers or managed runtimes.

### Project resolution

- If `GOOGLE_CLOUD_PROJECT` is present, it sets the default project for all tools.
- When absent, the server derives the project from service account metadata.
- Individual tools allow overriding the project or resource path when needed.

### Permission guidance

- Grant service accounts least-privilege roles (e.g., `roles/logging.viewer`, `roles/monitoring.viewer`).
- For write-heavy tasks such as Spanner SQL execution, ensure `roles/spanner.databaseUser` or custom roles.
- Logging and Monitoring requests may require region-specific endpoints; the server handles them automatically.

## Configuration and deployment

### Environment variables

| Variable | Purpose |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to the service account JSON key. |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | Inline credentials alternative to key files. |
| `GOOGLE_CLOUD_PROJECT` | Default project used when individual requests omit a project ID. |
| `DEBUG` | Enable verbose logging when set to `true`. |
| `MCP_SERVER_PORT` | Custom port when self-hosting behind a proxy or container. |

### Client configuration snippet

```json
{
  "mcpServers": {
    "google-cloud-mcp": {
      "command": "node",
      "args": ["/path/to/google-cloud-mcp/dist/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/Users/example/.config/gcloud/application_default_credentials.json",
        "GOOGLE_CLOUD_PROJECT": "my-production-project"
      },
      "metadata": {
        "lazyAuth": true,
        "debug": false
      }
    }
  }
}
```

### Deployment tips

- Use `lazyAuth` when available to reduce startup latency in clients that support it.
- Containerised deployments should mount credential files read-only and rotate them regularly.
- Pair with Cloud Logging exports or SIEM ingestion for observability across teams.

## Tool reference quick sheet

| Service | Tool | Purpose |
| --- | --- | --- |
| Error Reporting | `gcp-error-reporting-list-groups` | Discover active error groups within a time window. |
| Error Reporting | `gcp-error-reporting-get-group-details` | Inspect stack traces and occurrences for a group. |
| Error Reporting | `gcp-error-reporting-analyse-trends` | Trend analysis across services and versions. |
| Logging | `gcp-logging-query-logs` | Execute advanced Cloud Logging queries. |
| Logging | `gcp-logging-query-time-range` | Quick time-bounded search helper. |
| Logging | `gcp-logging-search-comprehensive` | Multi-field search across payloads and metadata. |
| Monitoring | `gcp-monitoring-query-metrics` | Run MQL queries with aggregation hints. |
| Monitoring | `gcp-monitoring-list-metric-types` | Enumerate available metric descriptors. |
| Monitoring | `gcp-monitoring-query-natural-language` | Translate natural language into MQL. |
| Profiler | `gcp-profiler-list-profiles` | Locate CPU, heap, or wall-time profiles. |
| Profiler | `gcp-profiler-analyse-performance` | Summarise profiler hotspots. |
| Profiler | `gcp-profiler-compare-trends` | Compare profile sets across releases. |
| Spanner | `gcp-spanner-list-instances` | List Spanner instances. |
| Spanner | `gcp-spanner-list-databases` | List databases within an instance. |
| Spanner | `gcp-spanner-list-tables` | Reveal table schemas. |
| Spanner | `gcp-spanner-execute-query` | Execute parameterised SQL. |
| Spanner | `gcp-spanner-query-natural-language` | Generate SQL from natural language. |
| Spanner | `gcp-spanner-query-count` | Quickly calculate row counts. |
| Spanner | `gcp-spanner-query-plan` (resource) | Inspect EXPLAIN / EXPLAIN ANALYZE output and surface distributed joins or missing indexes. |
| Trace | `gcp-trace-list-traces` | Surface slow or erroring traces. |
| Trace | `gcp-trace-get-trace` | Inspect complete trace timelines. |
| Trace | `gcp-trace-find-from-logs` | Pivot from logs to traces. |
| Trace | `gcp-trace-query-natural-language` | Build trace filters conversationally. |

## Prompt patterns

### General guidance

- Start with concrete context: project ID, service name, resource type, and time window.
- Iterate: run a broad query first, then follow up with narrower filters.
- Ask the agent to summarise or compare results when raw data is too verbose.

### Service-specific prompts

- **Logging** – “Summarise ERROR logs for Cloud Run service `checkout` in project `prod-app-123` over the last two hours.”
- **Monitoring** – “Show the 95th percentile latency for HTTPS load balancer `lb-frontend` in `my-network-prod` during the past day.”
- **Profiler** – “Compare CPU profiles for service `payments-api` between versions `v1.4.0` and `v1.5.0`.”
- **Spanner** – “Draft a SQL query that finds the top five customers by order count in the `orders` table.”
- **Trace** – “Find traces longer than five seconds that include span `CheckoutService/ProcessPayment`.”

## Troubleshooting

### Authentication failures

- Confirm credentials correspond to the target project.
- When using environment variables, escape newline characters in private keys.
- Regenerate keys if you see `invalid_grant` or `malformed token` errors.

### Permission denied

- Verify the service account roles include viewer access for read operations and writer roles for Spanner mutations.
- Use `gcloud projects get-iam-policy` to audit role bindings quickly.

### Timeout or quota issues

- Narrow time ranges or resource filters.
- For Monitoring, request lower alignment periods.
- Respect API quotas; repeated 429 responses indicate the need for backoff.

### Unexpected data gaps

- Ensure metrics or traces are being exported for the resource in question.
- Some services (e.g., Profiler) sample data; short windows may legitimately return no results.

## Appendix

### Useful gcloud commands

- `gcloud auth application-default login` – Initialise local ADC credentials.
- `gcloud projects list` – Discover accessible projects for the current identity.
- `gcloud logging read` – Sanity-check log filters outside MCP when debugging queries.

### Additional resources

- [Google Cloud Error Reporting documentation](https://cloud.google.com/error-reporting/docs)
- [Cloud Logging query language reference](https://cloud.google.com/logging/docs/view/logging-query-language)
- [Cloud Monitoring metrics guide](https://cloud.google.com/monitoring)
- [Cloud Profiler overview](https://cloud.google.com/profiler)
- [Cloud Spanner SQL reference](https://cloud.google.com/spanner/docs/reference/standard-sql)
- [Cloud Trace documentation](https://cloud.google.com/trace/docs)
