# Google Cloud MCP Deep Dive

## Onboarding checklist

1. **Verify your toolchain** – ensure Node.js 24.11+ and pnpm 10.21+ are available:
   ```bash
   node -v
   corepack enable && corepack use pnpm@10.21.0
   pnpm -v
   ```
2. **Install the Google Cloud CLI** – run `gcloud components update` and sign in with an account that has at least viewer access to one project.
3. **Clone the repo & install dependencies** – `git clone`, `pnpm install`, and confirm `pnpm lint` & `pnpm test` pass before starting feature work.
4. **Decide on credentials** – choose between a service-account key file or inline environment variables, then create a local `.env` (see below).
5. **Authenticate** – run `gcloud auth application-default login` so ADC fallbacks work even if your `.env` is incomplete.
6. **Launch the dev server** – `pnpm dev` boots `ts-node --esm src/index.ts`; confirm it registers with your MCP client (Claude Desktop or the MCP Inspector).
7. **Review this guide** – skim the repository tour, architecture, and testing sections so you understand how services, prompts, utilities, and docs fit together.
8. **Run the CI pipeline locally** – `pnpm ci` executes lint, format, and coverage tests, matching what CI runs on every PR.

## Local environment setup

### 1. Install prerequisites

- **Node.js 24.11+** – matches the `engines.node` constraint in `package.json`.
- **pnpm 10.21+** – enable via `corepack enable && corepack use pnpm@10.21.0` to stay aligned with the repo’s `packageManager` metadata.
- **Google Cloud CLI** – manages credentials and sets the active project (`gcloud init`).
- **Google Cloud project & entitlements** – access to Logging, Monitoring, Spanner, Trace, Profiler, Error Reporting, and (optionally) Support APIs.

Sanity-check versions:

```bash
node -v
pnpm -v
gcloud version
```

### 2. Authenticate to Google Cloud

1. `gcloud auth application-default login`
2. `gcloud config set project <PROJECT_ID>`
3. `gcloud auth application-default print-access-token` (verifies ADC works)

The MCP server prefers Application Default Credentials when `GOOGLE_APPLICATION_CREDENTIALS` is unset, so keeping ADC fresh prevents 401 errors during local testing.

### 3. Choose your credential strategy

- **Service-account key file (recommended locally)**  
  1. Create a service account with least-privilege roles (`roles/logging.viewer`, `roles/monitoring.viewer`, `roles/spanner.databaseUser`, `roles/cloudsupport.viewer`, etc.).  
  2. Generate a key:
     ```bash
     gcloud iam service-accounts keys create ~/.config/gcloud/google-cloud-mcp.json \
       --iam-account <SERVICE_ACCOUNT_EMAIL>
     ```  
  3. Point `GOOGLE_APPLICATION_CREDENTIALS` to that JSON path.

- **Inline environment variables (CI-friendly)**  
  Set `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (with literal `\n` sequences), and `GOOGLE_CLOUD_PROJECT` in your runtime environment. This keeps credentials ephemeral in hosted runners.

Regardless of method, set `LAZY_AUTH=true` (default) to defer Google SDK auth until the first request, and flip `DEBUG=1` locally when you need verbose logs.

### 4. Create a local `.env`

```
GOOGLE_APPLICATION_CREDENTIALS=/Users/<you>/.config/gcloud/google-cloud-mcp.json
GOOGLE_CLOUD_PROJECT=my-sandbox-project
LAZY_AUTH=true
DEBUG=0
MCP_SERVER_PORT=8082
```

`.gitignore` already excludes `.env`; load it with `direnv`, `dotenvx`, or your shell profile.

### 5. First build & smoke test

```bash
pnpm install           # install dependencies
pnpm lint              # ESLint gate
pnpm test              # Vitest suites
pnpm dev               # ts-node hot reload
pnpm build && pnpm start  # transpiled run (needed for MCP Inspector)
```

For UI debugging, run:

```bash
npx -y @modelcontextprotocol/inspector node dist/index.js
```

## Repository tour

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Entry point wiring logging, auth, prompts, resource discovery, and every service registrar. |
| `src/services/<service>/tools.ts` | Tool registrations plus Zod schemas for Logging, Monitoring, Profiler, Error Reporting, Spanner, Trace, and Support. |
| `src/services/<service>/resources.ts` | Resource registrations that expose browseable data (logs, metrics, traces, etc.). |
| `src/services/<service>/types.ts` | DTOs, transformers, and formatter helpers that keep tool outputs consistent. |
| `src/services/support/client.ts` | Lightweight REST client for the Google Cloud Support API. |
| `src/prompts/index.ts` | Reusable prompt definitions (log analysis, monitoring post-processing, Spanner NL helpers). |
| `src/utils/auth.ts` | Google auth helpers plus project resolution. |
| `src/utils/logger.ts` | Winston logger configuration—use this instead of `console.log`. |
| `src/utils/resource-discovery.ts` / `project-tools.ts` | Shared tools for listing projects, metric descriptors, and regions. |
| `src/utils/security-validator.ts`, `session-manager.ts`, `time.ts` | Input sanitisation, per-session caches, and temporal helpers. |
| `test/unit/**` | Fast Vitest specs that mirror `src/**`. |
| `test/integration/**` | Multi-service flows that exercise prompts/resources end-to-end. |
| `test/mocks/**` | Google Cloud client mocks plus canned fixtures. |
| `test/setup.ts` | Vitest global hooks, including mock registration. |
| `docs/**` | Deep-dive docs; keep these updated when you add services or workflows. |
| `dist/` | TypeScript build output (never edit). |
| `smithery.yaml` | Default Smithery template for hosted MCP deployments. |
| `Dockerfile` | Container definition for reproducible builds. |

## Day-to-day development workflow

- **Sync + branch** – `git pull origin main && git switch -c feature/<slug>`.
- **Install when the lockfile changes** – `pnpm install` respects `pnpm-lock.yaml`.
- **Iterate with hot reload** – `pnpm dev` uses `ts-node --esm`; add `-- --inspect` to attach Chrome DevTools.
- **Use the MCP Inspector** – `npx -y @modelcontextprotocol/inspector node dist/index.js` mirrors how Claude Desktop calls the server.
- **Lint & format early** – `pnpm format:check && pnpm lint` (or `pnpm lint:fix`).
- **Run focused tests** – `pnpm test:watch` for tight loops, or `pnpm test --runInBand test/unit/services/logging.test.ts` for a single file.
- **Build before sharing artifacts** – `pnpm build` compiles TypeScript and copies Monitoring assets via `copy-assets`.
- **Update docs + README** – new tools/services must be reflected under `docs/` so the next newcomer can follow along.

## Overview

The Google Cloud MCP server exposes Google Cloud Platform (GCP) operations through the Model Context Protocol so that clients can invoke structured tools, browse knowledge, and automate workflows. This deep dive explains how the server is organised, how requests are handled, and how to make the most of each supported service. Use it alongside the high-level [README](../README.md) when you need architectural context or advanced usage patterns.

### Core capabilities

- Unifies access to Error Reporting, Logging, Monitoring, Profiler, Spanner, Support, and Trace through a single MCP endpoint.
- Normalises authentication across service account credentials and direct environment variable secrets.
- Provides curated prompts, filters, and result formatting that are optimised for conversational agents.
- Ships with guard rails such as project scoping, time-range defaults, and pagination helpers to keep responses reliable.
- Exposes resource-discovery helpers (`project-tools`, `resource-discovery`) so agents can look up metadata inline.

## Architecture

### Component responsibilities

| Component | Description |
| --- | --- |
| `src/index.ts` | Boots the MCP server, registers services, and wires shared infrastructure such as logging. |
| `src/services/*` | Implements service-specific tool definitions, data mappers, and domain logic (for example, Monitoring metric queries). |
| `src/prompts/*` | Stores reusable prompt templates for log reviews, monitoring summaries, and other guided analyses. |
| `src/utils/*` | Helper utilities for authentication, request shaping, and result pagination shared by multiple services. |
| `test/*` | Mirrors runtime code with Vitest so behaviour stays locked down by automated suites. |

### Shared utility modules

| Module | Role |
| --- | --- |
| `utils/auth.ts` | Initialises `google-auth-library`, resolves the active project, and exposes helpers such as `getProjectId()`. |
| `utils/logger.ts` | Configures Winston transports/levels and serves as the single logging surface. |
| `utils/resource-discovery.ts` | Registers MCP resources that list projects, regions, and monitoring descriptors for browsing. |
| `utils/project-tools.ts` | Provides generic tools (list projects, inspect configs) that complement service-specific tools. |
| `utils/security-validator.ts` | Sanitises user-supplied strings (project IDs, table names) before they reach Google APIs. |
| `utils/session-manager.ts` | Tracks per-session state to support lazy authentication and caching. |
| `utils/time.ts` | Normalises time-window parsing and formatting. |

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

#### Key tools

- `gcp-error-reporting-list-groups` – Lists error groups with filtering by time range and service context.
- `gcp-error-reporting-get-group-details` – Returns stack traces, occurrences, and affected services for a specific group.
- `gcp-error-reporting-analyse-trends` – Summarises frequency changes to flag regressions or emerging issues.

#### Example workflow

1. Filter groups for the affected project and service.
2. Retrieve group details to inspect stack traces.
3. Use trend analysis to decide whether the incident is escalating.

### Logging

Logging tools query Cloud Logging with flexible filters, consistent pagination, and summarised results to make log hunting conversational.

#### Key tools

- `gcp-logging-query-logs` – Runs advanced LogQL-style filters with severity and resource constraints.
- `gcp-logging-query-time-range` – Convenience helper focused on time-bounded searches.
- `gcp-logging-search-comprehensive` – Performs multi-field searches to uncover related events.

#### Operational tips

- Keep queries bounded to avoid quota issues.
- Combine severity filters with resource types to narrow noisy workloads.
- Use follow-up prompts to summarise or cluster returned entries.

#### Log redaction policy

Every `gcp-logging-*` tool sanitises remote IPs, user identifiers, and request bodies before emitting a response. To allow trusted operators to inspect full payloads, set the comma-separated `LOG_PAYLOAD_FULL_ACCESS_ROLES` environment variable (defaults to `security_admin, compliance_admin, site_reliability_admin`) and provide matching roles through `MCP_USER_ROLES` or `MCP_ACTIVE_ROLES`. Without an explicit role match the payloads stay redacted and the response includes a notice explaining why.

### Monitoring

Monitoring tools query Cloud Monitoring metrics so you can inspect CPU, memory, or custom signals while migrating dashboards and alerts to PromQL.

### Key tools

- `gcp-monitoring-query-metrics` – Executes Cloud Monitoring metric filters and returns label/value pairs ready to port into PromQL.
- `gcp-monitoring-list-metric-types` – Discovers metric type URIs for services such as Compute Engine or Cloud Run.

### Operational tips

- Use `list-metric-types` to confirm metric availability before crafting filters.
- Provide alignment windows (e.g., 5m, 1h) to match dashboard expectations.
- Request aggregations (`mean`, `max`, `percentile`) to reduce result volume.
- When you need full PromQL expressions, pair these discovery tools with Managed Service for Prometheus or the `projects.timeSeries.query` API.

### Profiler

Profiler helpers analyse Cloud Profiler data so you can identify CPU, heap, or wall-time hot spots.

#### Key tools

- `gcp-profiler-list-profiles` – Lists profiles by type, deployment target, and date window.
- `gcp-profiler-analyse-performance` – Highlights dominant call stacks and performance regressions.
- `gcp-profiler-compare-trends` – Contrasts two profile sets to show improvements or regressions.

#### Operational tips

- Start with smaller date windows to avoid processing large profile collections.
- Use comparisons when validating new releases or configuration changes.

### Spanner

Spanner tools assist with schema discovery and SQL execution across distributed databases.

#### Key tools

- `gcp-spanner-list-instances`, `gcp-spanner-list-databases`, and `gcp-spanner-list-tables` catalogue your topology.
- `gcp-spanner-execute-query` runs read-only SQL (SELECT/WITH/EXPLAIN/SHOW/DESCRIBE) with parameter binding and blocks mutating statements before they reach Spanner.
- `gcp-spanner-query-count` samples request volumes through the Spanner query-count metrics API.
- `gcp-spanner-query-stats` (resource) renders Query Insights data from `SPANNER_SYS.QUERY_STATS_TOP_MINUTE/10MINUTE/HOUR` as AI-readable JSON across 1m/10m/1h windows, ranking fingerprints by latency and CPU.
- `gcp-spanner-query-plan` (resource) runs EXPLAIN/EXPLAIN ANALYZE via \`gcp-spanner://.../query-plan?sql=SELECT+...\` and calls out distributed joins or missing indexes.

#### Operational tips

- Always scope to production vs. staging instances to avoid cross-environment confusion.
- Sketch queries in your MCP client or editor first, then paste explicit SQL into `execute-query` for validation.
- Ensure Cloud Spanner Query Insights is enabled and grant the MCP service account `roles/spanner.databaseReader` so the query-stats resource can pull from the SPANNER_SYS views; if any interval is missing the markdown will note it.

### Trace

Trace utilities focus on distributed tracing diagnostics, correlating with logging where possible.

#### Key tools

- `gcp-trace-list-traces` – Lists traces by latency, span count, or time range.
- `gcp-trace-get-trace` – Retrieves full trace timelines for root-cause analysis.
- `gcp-trace-find-from-logs` – Cross-references log entries to locate related traces.

#### Operational tips

- Pair `find-from-logs` with Logging queries to pivot quickly between traces and logs.
- Focus on latency percentiles (95th/99th) to track performance regressions.

### Support

Support tools integrate with the Cloud Support API so agents can triage customer cases without leaving the MCP workflow.

#### Key tools

- `gcp-support-list-cases` / `gcp-support-search-cases` – Enumerate or query cases for a project/organisation.
- `gcp-support-get-case` – Fetch full metadata, classifications, and SLA details for a single case.
- `gcp-support-create-case`, `gcp-support-update-case`, `gcp-support-close-case` – Maintain the case lifecycle.
- `gcp-support-list-comments`, `gcp-support-create-comment`, `gcp-support-list-attachments` – Collaborate directly from the MCP client.
- `gcp-support-search-classifications` – Discover the correct product & component taxonomy before filing a case.

#### Operational tips

- Use the `parent` argument (`projects/<id>` or `organizations/<id>`) to scope results; defaults to the active project.
- The billing project must align with the Support entitlement—`tools.ts` resolves it automatically, but keep credentials consistent.
- Avoid leaking sensitive attachment data by redacting before uploading.

## Prompt patterns and authoring

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
- **Support** – “List open P1 cases for `projects/payments-prod` created this week.”

### Adding or editing prompts

1. Update `src/prompts/index.ts`, grouping related prompts (logging, monitoring, spanner) into helper functions.
2. Define arguments with Zod so MCP clients can render forms with validation messages.
3. Reference resources via URIs such as `logging://entries?...` or `monitoring://metrics?...` so downstream LLMs receive structured context.
4. Keep prompts idempotent and deterministic; avoid inline randomness or external side effects.
5. Document new prompts in `docs/` so agents know when to use them.

## Extending the server

### Add a tool to an existing service

1. Locate the service folder under `src/services/<service>/`.
2. Update `tools.ts` with a new `server.registerTool` call. Follow existing naming: `gcp-<service>-<action>`.
3. Define the input schema with Zod, reuse helpers from `utils/security-validator.ts`, and normalise output via formatter utilities.
4. If the tool exposes browseable data, also register an MCP resource in `resources.ts`.
5. Write unit tests in `test/unit/services/<service>.test.ts` that cover happy paths and error cases using mocks from `test/mocks/`.
6. Document the tool (README + `docs/deep-dive-*.md`) and add usage examples.

### Add a brand-new service

1. Create `src/services/<new-service>/{index,tools,resources,types}.ts`.
2. Export `register<CapitalisedService>Tools` and (optionally) `register<CapitalisedService>Resources` from the folder’s `index.ts`.
3. Wire the registrar inside `src/index.ts`, wrapping it in `try/catch` like the existing services.
4. Add mocks under `test/mocks/<service>.ts` and tests under both `test/unit/services/<service>.test.ts` and `test/integration/<service>.test.ts` if it depends on shared flows.
5. Update documentation, the tool quick sheet, and any client configuration snippets that mention supported services.

### Keep documentation and examples aligned

- Update `README.md` (“Services” section) whenever you add or remove tools.
- Expand `docs/deep-dive-en.md` / `docs/deep-dive-ja.md` so future engineers inherit the playbook you just followed.
- Provide sample prompts or Inspector screenshots in PR descriptions when the change is user-facing.

## Testing and quality gates

| Command | Purpose |
| --- | --- |
| `pnpm test` | Runs all Vitest suites in CI mode. |
| `pnpm test:watch` | Watch mode for tight feedback during development. |
| `pnpm test:coverage` | Generates V8 coverage reports; run before release work. |
| `pnpm lint` / `pnpm lint:fix` | ESLint rules for `src/**/*.ts`. |
| `pnpm format:check` | Ensures Prettier formatting on `src/**/*.ts`. Use `pnpm format` to auto-format. |
| `pnpm build` | Transpiles TypeScript and copies monitoring doc assets into `dist/`. |
| `pnpm ci` | The full pipeline: lint → format check → coverage tests. |

Testing tips:

- `vitest` picks up global mocks from `test/setup.ts`; add new mocks there instead of duplicating boilerplate.
- Use fixtures under `test/mocks/` to simulate Google Cloud responses and avoid quota usage.
- Prefer integration tests for flows that cross services (e.g., logging + trace correlation).
- Record regressions as tests before fixing them; this keeps coverage meaningful for future contributors.

## Troubleshooting playbook

### Authentication failures

- Confirm credentials correspond to the target project.
- When using environment variables, escape newline characters in private keys.
- Regenerate keys if you see `invalid_grant` or `malformed token` errors.
- Set `DEBUG=1` to log which credential path is being used.

### Permission denied

- Verify the service account roles include viewer access for read operations and writer roles for Spanner mutations.
- Use `gcloud projects get-iam-policy <project>` to audit role bindings quickly.
- Remember that the Support API requires an active support entitlement tied to the billing account.

### Timeout or quota issues

- Narrow time ranges or resource filters.
- For Monitoring, request lower alignment periods.
- Respect API quotas; repeated 429 responses indicate the need for exponential backoff.

### Unexpected data gaps

- Ensure metrics or traces are being exported for the resource in question.
- Some services (e.g., Profiler) sample data; short windows may legitimately return no results.
- Double-check that the active project matches the project you queried.

### Local dev issues

- Delete `dist/` and rerun `pnpm build` if the Inspector is serving stale code.
- Remove stale `.tsbuildinfo` files if TypeScript acts oddly (`rm -rf .tsbuildinfo`).
- Restart `pnpm dev` after changing environment variables; ts-node does not reload them automatically.

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
| `LAZY_AUTH` | `true` (default) delays auth initialisation until the first request. Set to `false` to fail fast. |
| `MCP_SERVER_PORT` | Custom port when self-hosting behind a proxy or container. |
| `MCP_ENABLED_SERVICES` | Comma-separated whitelist of Google Cloud services to register (e.g., `spanner,trace`). Defaults to all services when unset or when set to `all` / `*`. |
| `MCP_SERVER_MODE` | `daemon` (default) keeps the Node.js process alive; set to `standalone` to exit once the MCP transport closes. |

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
| Monitoring | `gcp-monitoring-query-metrics` | Run metric filters and stage data for PromQL migrations. |
| Monitoring | `gcp-monitoring-list-metric-types` | Enumerate available metric descriptors. |
| Profiler | `gcp-profiler-list-profiles` | Locate CPU, heap, or wall-time profiles. |
| Profiler | `gcp-profiler-analyse-performance` | Summarise profiler hotspots. |
| Profiler | `gcp-profiler-compare-trends` | Compare profile sets across releases. |
| Spanner | `gcp-spanner-list-instances` | List Spanner instances. |
| Spanner | `gcp-spanner-list-databases` | List databases within an instance. |
| Spanner | `gcp-spanner-list-tables` | Reveal table schemas. |
| Spanner | `gcp-spanner-execute-query` | Execute parameterised SQL. |
| Spanner | `gcp-spanner-query-count` | Quickly calculate row counts. |
| Spanner | `gcp-spanner-query-stats` (resource) | AI-friendly 1m/10m/1h Query Insights JSON summary. |
| Spanner | `gcp-spanner-query-plan` (resource) | Inspect EXPLAIN / EXPLAIN ANALYZE output and surface distributed joins or missing indexes. |
| Trace | `gcp-trace-list-traces` | Surface slow or erroring traces. |
| Trace | `gcp-trace-get-trace` | Inspect complete trace timelines. |
| Trace | `gcp-trace-find-from-logs` | Pivot from logs to traces. |
| Support | `gcp-support-list-cases` | List support cases for the active project. |
| Support | `gcp-support-search-cases` | Full-text search across support cases. |
| Support | `gcp-support-get-case` | Retrieve a single case with metadata and SLA details. |
| Support | `gcp-support-create-case` / `update-case` / `close-case` | Manage the case lifecycle. |
| Support | `gcp-support-list-comments` / `create-comment` | Collaborate with Google Support without leaving MCP. |
| Support | `gcp-support-search-classifications` | Discover product/component taxonomy before filing a case. |

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
- [Cloud Support API reference](https://cloud.google.com/support/docs/reference/rest)
