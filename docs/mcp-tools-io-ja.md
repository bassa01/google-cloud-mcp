# MCPツール入出力リファレンス

## このドキュメントについて
- Google Cloud MCPサーバーが公開しているすべてのツールについて、入力スキーマと代表的なレスポンスをまとめています。
- ここに記載の JSON スキーマは、MCP クライアントが `call_tool` / `performTool` リクエストを構築するときの参考用です。
- 例はダミーのプロジェクトやリソース名で示しており、実行環境にあわせて置き換えてください。

### 呼び出しフォーマット
各ツールは MCP プロトコル上では以下の形で呼び出します。

```jsonc
{
  "name": "<tool-name>",
  "arguments": { /* スキーマに従った引数 */ }
}
```

### 共通レスポンス
- すべてのツールは `content` 配列に 1 つ以上の `text` チャンクを返します。
- エラー時は `isError: true` と簡潔なメッセージを含むことがあります。
- 2025/11 時点の実装では、出力は「要約テキスト + JSON ブロック」の 2 段構成になっています。要約テキストでは `projectId=... | filter=...` などのメタ情報／省略件数を `key=value` 形式で列挙し、続く JSON ブロックに最新データをそのまま載せます。LLM での二次利用を想定したコンパクトなフォーマットです。
- マスク対象（IP・ユーザー識別子など）が含まれる場合は、要約テキスト末尾に `_Redacted ..._` という注記が付きます。
- 追加のプレビュー制御:
  - **Error Reporting** – `ERROR_REPORTING_GROUP_PREVIEW_LIMIT` / `ERROR_REPORTING_EVENT_PREVIEW_LIMIT` / `ERROR_REPORTING_ANALYSIS_PREVIEW_LIMIT` / `ERROR_REPORTING_TREND_POINTS_LIMIT`
  - **Profiler** – `PROFILER_PROFILE_PREVIEW_LIMIT` / `PROFILER_ANALYSIS_PREVIEW_LIMIT`
  - **Support** – `SUPPORT_CASE_PREVIEW_LIMIT` / `SUPPORT_COMMENT_PREVIEW_LIMIT` / `SUPPORT_ATTACHMENT_PREVIEW_LIMIT` / `SUPPORT_CLASSIFICATION_PREVIEW_LIMIT` / `SUPPORT_DESCRIPTION_PREVIEW_LIMIT`
  - **Trace** – `TRACE_SPAN_PREVIEW_LIMIT` / `TRACE_TRACE_PREVIEW_LIMIT` / `TRACE_LOG_PREVIEW_LIMIT` / `TRACE_ATTRIBUTE_PREVIEW_LIMIT` / `TRACE_ANALYSIS_PREVIEW_LIMIT`

### 表記ルール
| 表記 | 説明 |
| --- | --- |
| 型 | `string`, `number`, `boolean`, `enum[...]`, `record`, `array` など。 |
| 必須 | `はい` = 必須、`いいえ` = 省略可。 |
| デフォルト/制約 | 初期値、許容範囲、フォーマットなど。 |

---

## ロギング (Logging)

### gcp-logging-query-logs — 任意フィルタでログ検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| filter | string | はい | Cloud Logging クエリ構文 | 取得したいログのフィルタ式。リソース・ラベル・payload など任意の条件を書けます。 |
| limit | number | いいえ | 50 (1-1000) | 返却するエントリ件数の上限。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-logging-query-logs",
  "arguments": {
    "filter": "resource.type=\"cloud_run_revision\" severity>=ERROR",
    "limit": 20
  }
}
```

**戻り値例**
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

### gcp-logging-query-time-range — 時間範囲でログ検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| startTime | string | はい | ISO8601 または相対値 (`1h`, `2d` など) | 期間開始。相対指定は現在時刻からのオフセット。 |
| endTime | string | いいえ | 省略時は現在時刻 | 期間終了。start との組み合わせでレンジを決定。 |
| filter | string | いいえ | 追加条件なし | 期間条件に加える任意フィルタ。 |
| limit | number | いいえ | 50 (1-1000) | 返却件数。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-logging-search-comprehensive — 全フィールド横断検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| searchTerm | string | はい |  | text/json/proto payload, labels, HTTP 情報などを横断して検索する語句。 |
| timeRange | string | いいえ | `1h` | 相対時間で検索窓を指定。 |
| severity | enum[`DEFAULT`,`DEBUG`,`INFO`,`NOTICE`,`WARNING`,`ERROR`,`CRITICAL`,`ALERT`,`EMERGENCY`] | いいえ | すべて | 最低シビアリティ。 |
| resource | string | いいえ | 全リソース | `gke_container` 等の resource.type 条件。 |
| limit | number | いいえ | 50 (1-500) | 返却件数。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-spanner-execute-query — SQL を直接実行
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| sql | string | はい |  | SELECT / WITH / EXPLAIN / SHOW / DESCRIBE といった読み取り専用 SQL のみ許可。 |
| instanceId | string | いいえ | `SPANNER_INSTANCE` env/state | 対象インスタンス。省略時は環境変数もしくは state-manager。 |
| databaseId | string | いいえ | `SPANNER_DATABASE` env/state | 対象データベース。 |
| params | record<string, any> | いいえ | `{}` | 名前付きパラメータ。JSON 互換値を渡します。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-spanner-execute-query",
  "arguments": {
    "sql": "SELECT user_id, status FROM accounts WHERE status=@status LIMIT 25",
    "params": { "status": "ACTIVE" }
  }
}
```

⚠️ INSERT/UPDATE/DELETE や DDL、トランザクション制御、複数ステートメントを含む SQL は送信前にブロックされます。

**戻り値例**
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

### gcp-spanner-list-tables — テーブル一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| instanceId | string | いいえ | state/env の既定値 | 対象インスタンス。 |
| databaseId | string | いいえ | state/env の既定値 | 対象データベース。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-spanner-list-tables",
  "arguments": {
    "databaseId": "ledger"
  }
}
```

**戻り値例**
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

### gcp-spanner-list-instances — インスタンス一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| _dummy | string | いいえ | 内部互換用 | 入力不要。 |

**呼び出し例**
```jsonc
{ "name": "gcp-spanner-list-instances", "arguments": {} }
```

**戻り値例**
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

### gcp-spanner-list-databases — データベース一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| instanceId | string | はい |  | `projects/{project}/instances/{instance}` のインスタンス ID。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-spanner-list-databases",
  "arguments": { "instanceId": "main-instance" }
}
```

**戻り値例**
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

### gcp-spanner-query-natural-language — 自然言語→SQL 補助
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| query | string | はい |  | 「orders テーブルの件数を知りたい」など、読み取り専用の要件を自然文で記述。 |
| instanceId | string | いいえ | state/env | 対象インスタンス。 |
| databaseId | string | いいえ | state/env | 対象 DB。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-spanner-query-natural-language",
  "arguments": {
    "query": "List the first 20 orders with total > 100 USD"
  }
}
```

⚠️ 生成される SQL も `gcp-spanner-execute-query` と同じ読み取り専用ガードを通過します。DML/DDL や複数ステートメントが検出された場合は Spanner へ送信される前にブロックされます。

**戻り値例**
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

### gcp-spanner-query-count — クエリ回数の指標
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| instanceId | string | いいえ | 全インスタンス | 指定すると特定インスタンスのみ集計。 |
| databaseId | string | いいえ | 全 DB | 指定すると特定 DB のみ集計。 |
| queryType | enum[`ALL`,`READ`,`QUERY`] | いいえ | `ALL` | Metric `query_type` による絞り込み。 |
| status | enum[`ALL`,`OK`,`ERROR`] | いいえ | `ALL` | 成功/失敗ステータスで絞り込み。 |
| startTime | string | いいえ | `1h` | 相対または ISO8601。 |
| endTime | string | いいえ | 現在時刻 | 期間終了。 |
| alignmentPeriod | string | いいえ | `60s` | `60s`, `5m`, `1h` 等。メトリクス集計粒度。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-spanner-query-plan（リソース） — EXPLAIN / EXPLAIN ANALYZE を確認
| パラメータ | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| projectId | string | いいえ | 現在のプロジェクト | URI パス `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-plan` の一部。 |
| instanceId | string | いいえ | env/state | 省略時は `SPANNER_INSTANCE` や state manager から補完。 |
| databaseId | string | いいえ | env/state | 省略時は `SPANNER_DATABASE` や state manager から補完。 |
| sql | string (query param) | はい | URL エンコード必須 | EXPLAIN / EXPLAIN ANALYZE で評価する SELECT 文。DML/DDL はブロック。 |
| mode | enum[`explain`,`analyze`] | いいえ | `explain` | EXPLAIN (プランのみ) と EXPLAIN ANALYZE (実行あり) を切り替え。 |
| analyze | string/bool (query param) | いいえ | false | `mode` の代替。`?analyze=1` のように指定可能。 |

MCP では `read_resource` で呼び出します:
```jsonc
{
  "type": "read_resource",
  "uri": "gcp-spanner://my-sre-prod/main-instance/ledger/query-plan?sql=SELECT+user_id%2C+status+FROM+accounts&mode=analyze"
}
```

**戻り値例**
```text
# Spanner Query Plan
Project: my-sre-prod
Instance: main-instance
Database: ledger
Mode: EXPLAIN ANALYZE

Original SQL:
SELECT user_id, status FROM accounts LIMIT 25

_EXPLAIN ANALYZE で実行し、タイミング情報を取得しています。_

## Plan Insights
- 現在のプランとスキーマでは分散 JOIN やインデックス不足は確認されませんでした。
参照テーブル: accounts

## Plan Nodes
| ID | Type | Rows | Executions | Description |
|----|------|------|------------|-------------|
| 1 | Distributed Union | 1200 | 1 | ...
```


## Monitoring

### gcp-monitoring-query-metrics — 任意フィルタでメトリクス取得
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| filter | string | はい | Monitoring ListTimeSeries フィルタ | `metric.type` や `resource.type` 等を含む完全なフィルタ式。 |
| startTime | string | はい | ISO8601 または `1h` など | 取得範囲の開始。 |
| endTime | string | いいえ | 現在時刻 | 取得範囲の終了。 |
| alignmentPeriod | string | いいえ | 未指定 | `60s`,`5m`,`1h`...でアライン。フォーマットは `<数字><s|m|h|d>`。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-monitoring-list-metric-types — メトリック種別ディスカバリ
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| filter | string | いいえ | なし | `spanner` などの自由語、または API フィルタ式。 |
| pageSize | number | いいえ | 20 (1-100) | 最大取得件数。 |
| timeout | number | いいえ | 30s (5-60) | API タイムアウト。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-monitoring-list-metric-types",
  "arguments": {
    "filter": "spanner",
    "pageSize": 15
  }
}
```

**戻り値例**
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

### gcp-monitoring-query-natural-language — 自然言語でメトリクス検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| query | string | はい |  | 「Spanner の CPU 使用率を見せて」など自然文。 |
| startTime | string | いいえ | `1h` 相当 | NL から解釈できない場合の開始。 |
| endTime | string | いいえ | 現在時刻 | 期間終了。 |
| alignmentPeriod | string | いいえ | 未指定 | `60s` など。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-monitoring-query-natural-language",
  "arguments": {
    "query": "Show App Engine latency by region for the last day",
    "alignmentPeriod": "5m"
  }
}
```

**戻り値例**
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

Trace ツールは span/trace プレビューと階層マークダウンを含む JSON を返し、`TRACE_*` プレビュー変数でスパン件数や属性数を調整できます。

### gcp-trace-get-trace — Trace ID から詳細取得
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| traceId | string | はい | 16〜32桁の hex | 取得対象の Trace ID。 |
| projectId | string | いいえ | 現在のデフォルト | 別プロジェクトを明示する場合に指定。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-trace-get-trace",
  "arguments": {
    "traceId": "4f6c2d9b1a8e5cf2"
  }
}
```

**戻り値例**
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

### gcp-trace-list-traces — 最近のトレース一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| projectId | string | いいえ | 現在のデフォルト | 別プロジェクトでも検索可能。 |
| filter | string | いいえ | なし | 例: `span:checkout latency>1s`、`status.code != 0` 等。 |
| limit | number | いいえ | 10 (1-100) | 最大取得件数。 |
| startTime | string | いいえ | `1h` | ISO または相対 (`30m`, `2d`)。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-trace-find-from-logs — ログから Trace ID を抽出
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| projectId | string | いいえ | デフォルト | 検索対象プロジェクト。 |
| filter | string | はい | Cloud Logging フィルタ | `trace` ラベルを含むログを指定。相対時間 (`timestamp >= "-1h"`) も自動展開。 |
| limit | number | いいえ | 10 (1-100) | 調査するログ件数。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-trace-find-from-logs",
  "arguments": {
    "filter": "severity>=ERROR AND resource.type=\"cloud_run_revision\" AND timestamp>\"-1h\"",
    "limit": 50
  }
}
```

**戻り値例**
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

### gcp-trace-query-natural-language — NL でトレース調査
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| query | string | はい |  | 例: "Show failed traces from last day"。Trace ID が含まれる場合は直接 get-trace を実行。 |
| projectId | string | いいえ | デフォルト | 任意で上書き。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-trace-query-natural-language",
  "arguments": {
    "query": "Find the last 5 traces with errors in checkout within the past hour"
  }
}
```

**戻り値例**
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
      "status": "ERROR"
    }
  ],
  "spansOmitted": 12,
  "hierarchyMarkdown": "## Trace Details...",
  "hierarchyTruncated": true
}
```

## Error Reporting

Error Reporting 系ツールも要約+JSON 形式で返り、`ERROR_REPORTING_*` プレビュー変数でグループ数・イベント数・トレンド粒度を調整できます。

### gcp-error-reporting-list-groups — エラーグループ集計
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| timeRange | string | いいえ | `1h` | `1h`, `6h`, `24h`/`1d`, `7d`, `30d`。期間に応じて API period を自動変換。 |
| serviceFilter | string | いいえ | なし | `serviceFilter.service` に適用。 |
| order | enum[`COUNT_DESC`,`LAST_SEEN_DESC`,`CREATED_DESC`,`AFFECTED_USERS_DESC`] | いいえ | `COUNT_DESC` | 並び替え。 |
| pageSize | number | いいえ | 20 (1-100) | 取得数。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-error-reporting-get-group-details — グループ詳細とイベント
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| groupId | string | はい |  | `projects/.../groups/...` の末尾 ID。 |
| timeRange | string | いいえ | `24h` | `1h`,`24h`,`7d`,`30d` など。 |
| pageSize | number | いいえ | 10 (1-100) | 返却するイベント件数。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-error-reporting-analyse-trends — 時系列トレンド分析
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| timeRange | string | いいえ | `24h` | `1h`,`6h`,`24h`,`7d`,`30d`。 |
| serviceFilter | string | いいえ | なし | `serviceFilter.service`。 |
| resolution | enum[`1m`,`5m`,`1h`,`1d`] | いいえ | `1h` | `timedCountDuration` に反映。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-error-reporting-analyse-trends",
  "arguments": {
    "timeRange": "7d",
    "resolution": "1h"
  }
}
```

**戻り値例**
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
      "count": 480
    }
  ],
  "recommendations": [
    "Investigate the 3 time windows where error volumes exceeded 2x the rolling average (284)."
  ]
}
```

## Profiler

Profiler も同じサマリ+JSON 形式で、`PROFILER_PROFILE_PREVIEW_LIMIT` / `PROFILER_ANALYSIS_PREVIEW_LIMIT` により一覧件数や洞察テキストの長さを制御できます。

### gcp-profiler-list-profiles — プロファイル一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| pageSize | number | いいえ | 50 (1-1000) | 最大取得数。 |
| pageToken | string | いいえ |  | 追加ページを取得するためのトークン。 |
| profileType | enum[`CPU`,`WALL`,`HEAP`,`THREADS`,`CONTENTION`,`PEAK_HEAP`,`HEAP_ALLOC`] | いいえ | 全タイプ | 特定タイプに絞る。 |
| target | string | いいえ |  | デプロイメントターゲット (サービス名) 部分一致。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-profiler-analyse-performance — プロファイル集合を要約
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| profileType | enum[...] | いいえ | 全タイプ | CPU などに限定。 |
| target | string | いいえ |  | `deployment.target` を部分一致。 |
| pageSize | number | いいえ | 100 (1-1000) | 解析対象の取得件数。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-profiler-compare-trends — 時系列比較
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| target | string | いいえ |  | 比較対象ターゲット。 |
| profileType | enum[...] | いいえ | 全タイプ | 特定タイプ。 |
| pageSize | number | いいえ | 200 (1-1000) | トレンド計算に使う件数。 |

**呼び出し例**
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

**戻り値例**
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

Support 関連のレスポンスはケース／コメント／添付ファイルをサニタイズした JSON で返り、`SUPPORT_*` プレビュー変数で件数や本文トリミング長を制御できます。

### gcp-support-list-cases — ケース一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| parent | string | いいえ | `projects/{currentProject}` | `projects/{id}` または `organizations/{id}`。 |
| pageSize | number | いいえ | 20 (1-100) | 最大件数。 |
| pageToken | string | いいえ |  | ページング。 |
| filter | string | いいえ |  | `state=OPEN AND priority=P1` など。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-list-cases",
  "arguments": {
    "filter": "state=OPEN AND priority=P1",
    "pageSize": 10
  }
}
```

**戻り値例**
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

### gcp-support-search-cases — フリーテキスト検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| parent | string | いいえ | デフォルト | 検索対象。 |
| query | string | はい |  | `displayName:"upgrade"` などのフィールド検索も可。 |
| pageSize | number | いいえ | 20 (1-100) | 最大件数。 |
| pageToken | string | いいえ |  | 次ページ。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-search-cases",
  "arguments": {
    "query": "displayName:incident state=OPEN",
    "pageSize": 5
  }
}
```

**戻り値例**
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

### gcp-support-get-case — ケース詳細を取得
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい | `projects/{id}/cases/{caseId}` | 完全修飾ケース名。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-get-case",
  "arguments": {
    "name": "projects/my-sre-prod/cases/12345"
  }
}
```

**戻り値例**
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

### gcp-support-create-case — ケース作成
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| parent | string | いいえ | 現在のプロジェクト | `projects/{id}` または `organizations/{id}`。 |
| displayName | string | はい | 最低 4 文字 | タイトル。 |
| description | string | はい | 最低 10 文字 | 詳細。 |
| classificationId | string | はい |  | `gcp-support-search-classifications` で取得。 |
| priority | enum[`P0`,`P1`,`P2`,`P3`,`P4`,`PRIORITY_UNSPECIFIED`] | いいえ | `P3` | 優先度。 |
| timeZone | string | いいえ |  | IANA TZ。 |
| languageCode | string | いいえ |  | 例: `ja-JP`。 |
| contactEmail | string | いいえ |  | 主要連絡先。 |
| subscriberEmailAddresses | array<string> | いいえ |  | 追加通知。 |

**呼び出し例**
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

**戻り値例**
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

### gcp-support-update-case — ケース更新
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | 更新対象。 |
| displayName | string | いいえ |  | タイトル変更。 |
| description | string | いいえ |  | 説明変更。 |
| classificationId | string | いいえ |  | 新しい分類 ID。 |
| priority | enum[...] | いいえ |  | 優先度変更。 |
| contactEmail | string | いいえ |  | 主要連絡先。 |
| subscriberEmailAddresses | array<string> | いいえ |  | 通知先。 |
| languageCode | string | いいえ |  | ロケール。 |
| timeZone | string | いいえ |  | タイムゾーン。 |

**呼び出し例**
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

**戻り値例**
```text
Support Case Updated
caseName=projects/my-sre-prod/cases/98765 | updateMask=priority,subscriberEmailAddresses
```

```json
{
  "case": {
    "name": "projects/my-sre-prod/cases/98765",
    "priority": "P2",
    "subscriberEmailAddresses": ["mgr@example.com"]
  },
  "detailsMarkdown": "# Support Case Details...",
  "status": "updated"
}
```

### gcp-support-close-case — ケースをクローズ
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | 対象ケース。 |
| justification | string | いいえ |  | 閉じる理由。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-close-case",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765",
    "justification": "Issue resolved after rollback"
  }
}
```

**戻り値例**
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

### gcp-support-list-comments — コメント一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | ケース名。 |
| pageSize | number | いいえ | 20 (1-100) | 最大件数。 |
| pageToken | string | いいえ |  | 次ページ。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-list-comments",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765",
    "pageSize": 5
  }
}
```

**戻り値例**
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

### gcp-support-create-comment — コメント追加
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | ケース名。 |
| body | string | はい |  | 本文。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-create-comment",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765",
    "body": "Attached Cloud Storage link with tcpdump"
  }
}
```

**戻り値例**
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

### gcp-support-list-attachments — 添付ファイル一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | ケース名。 |
| pageSize | number | いいえ | 20 (1-100) | 最大件数。 |
| pageToken | string | いいえ |  | 次ページ。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-list-attachments",
  "arguments": {
    "name": "projects/my-sre-prod/cases/98765"
  }
}
```

**戻り値例**
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

### gcp-support-search-classifications — 分類検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| query | string | はい |  | 例: `id:"100445"` や `displayName:"service account"`。 |
| pageSize | number | いいえ | 20 (1-100) | 取得件数。 |
| pageToken | string | いいえ |  | 次ページ。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-support-search-classifications",
  "arguments": {
    "query": "displayName:\"Cloud Run\"",
    "pageSize": 10
  }
}
```

**戻り値例**
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

### gcp-utils-set-project-id — 既定プロジェクト設定
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| project_id | string | はい |  | 以降のツールで使うデフォルト GCP プロジェクト。 |

**呼び出し例**
```jsonc
{
  "name": "gcp-utils-set-project-id",
  "arguments": { "project_id": "my-sre-prod" }
}
```

**戻り値例**
```text
# Project ID Updated
Default Google Cloud project ID has been set to: `my-sre-prod`
```

### gcp-utils-get-project-id — 既定プロジェクト確認
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| (なし) | — | — | — | 引数不要。 |

**呼び出し例**
```jsonc
{ "name": "gcp-utils-get-project-id", "arguments": {} }
```

**戻り値例**
```text
# Current Google Cloud Project
Current project ID: `my-sre-prod`
## Recently Used Projects
- `my-sre-prod` (current)
- `analytics-playground`
```

## リソースリファレンス

MCP リソースは `read_resource` / `get_resource` で取得します。特に記載がない限り、`{projectId}` や `{instanceId}`、`{databaseId}` などのプレースホルダは `gcp-utils-set-project-id` や Google Cloud 認証から決定された既定値にフォールバックできます。

### ロギング リソース
| リソース | URI テンプレート | パラメータ | レスポンス |
| --- | --- | --- | --- |
| `gcp-logging-recent-logs` | `gcp-logs://{projectId}/recent` | `projectId` は省略可。 | `LOG_FILTER` (設定されていれば) を使って最新 50 件のログを要約し、マスク情報を付与。 |
| `gcp-logging-filtered-logs` | `gcp-logs://{projectId}/filter/{filter}` | `filter` は URL エンコードした Cloud Logging フィルタ。 | 条件に合致した最大 50 件をシビアリティ／リソース情報付きで返却。 |

### Monitoring リソース
| リソース | URI テンプレート | パラメータ | レスポンス |
| --- | --- | --- | --- |
| `gcp-monitoring-recent-metrics` | `gcp-monitoring://{projectId}/recent` | `MONITORING_FILTER` がなければ CPU メトリクスを使用。 | 直近 1 時間の時系列データを `buildStructuredTextBlock` 形式で要約。 |
| `gcp-monitoring-filtered-metrics` | `gcp-monitoring://{projectId}/filter/{filter}` | `filter` は URL エンコード済み。取得範囲は常に直近 1 時間。 | 指定フィルタの時系列を同じ構造化フォーマットで返却。 |

### Spanner リソース
| リソース | URI テンプレート | パラメータ | レスポンス |
| --- | --- | --- | --- |
| `gcp-spanner-database-schema` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/schema` | インスタンス／DB を指定、または既定値に依存。 | テーブル・カラム・インデックス・外部キーまで含む Markdown スキーマ。 |
| `gcp-spanner-table-preview` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/tables/{tableName}/preview` | `tableName` は `[A-Za-z][A-Za-z0-9_]*`。件数は `SPANNER_ROW_PREVIEW_LIMIT` に従う。 | プレビュー行と省略メモを含むテーブルダンプ。 |
| `gcp-spanner-database-tables` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/tables` | ↑と同じ。 | テーブル名とカラム数の一覧、さらに schema/preview へのリンクが付く。 |
| `gcp-spanner-query-plan` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-plan?sql=<URL-encoded>&mode=explain\|analyze` | `sql` クエリパラメータ必須。`mode=analyze` もしくは `analyze=1` で EXPLAIN ANALYZE。 | 実行/非実行の注記つきでプラン表と分散 JOIN・インデックスの指摘を返却。 |
| `gcp-spanner-query-stats` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-stats` | 既定のインスタンス／DB を使用。 | `buildQueryStatsJson` が生成するレイテンシ・オプティマイザ情報などの JSON。 |

### Trace リソース
| リソース | URI テンプレート | パラメータ | レスポンス |
| --- | --- | --- | --- |
| `gcp-trace-get-by-id` | `gcp-trace://{projectId}/traces/{traceId}` | `traceId` は 16 進文字列。 | 階層化されたスパン構造を Markdown で表示。 |
| `gcp-trace-related-logs` | `gcp-trace://{projectId}/traces/{traceId}/logs` | `traceId` でログを突き合わせ。 | トレース ID を含む最大 50 件のログとリソース／ラベル情報。 |
| `gcp-trace-recent-failed` | `gcp-trace://{projectId}/recent-failed?startTime=<ISO\|1h\|6h\|30m>` | `startTime` は ISO 形式または `1h`,`2d` などの相対表記。 | 指定期間内でエラーになったトレースの表を表示し、各行にリンクを付与。 |

### Error Reporting リソース
| リソース | URI テンプレート | パラメータ | レスポンス |
| --- | --- | --- | --- |
| `gcp-error-reporting-recent-errors` | `gcp-error-reporting://{projectId}/recent` | 直近 1 時間を解析。 | 優勢なエラーグループの要約と推奨アクションを Markdown で返却。 |
| `gcp-error-reporting-error-analysis` | `gcp-error-reporting://{projectId}/analysis/{timeRange}` | `timeRange` は `1h`,`6h`,`24h`,`7d`,`30d` など。既定は `1h`。 | 指定期間のエラー統計とリメディエーション提案。 |
| `gcp-error-reporting-service-errors` | `gcp-error-reporting://{projectId}/service/{serviceName}` | `serviceName` で `serviceFilter.service` を指定。 | 過去 24 時間のサービス単位エラーダイジェスト。 |

### Profiler リソース
| リソース | URI テンプレート | パラメータ | レスポンス |
| --- | --- | --- | --- |
| `gcp-profiler-all-profiles` | `gcp-profiler://{projectId}/profiles` | Cloud Profiler API への認証が必要。最大 100 件。 | 収集済みプロファイルの Markdown ダイジェストと個別サマリ。 |
| `gcp-profiler-cpu-profiles` | `gcp-profiler://{projectId}/cpu-profiles` | 同上。 | CPU プロファイルのみを抽出し、ホットスポット分析と改善提案を記載。 |
| `gcp-profiler-memory-profiles` | `gcp-profiler://{projectId}/memory-profiles` | HEAP / HEAP_ALLOC / PEAK_HEAP に限定。 | メモリ使用状況とリーク検知のためのインサイトを提供。 |
| `gcp-profiler-performance-recommendations` | `gcp-profiler://{projectId}/performance-recommendations` | 最大 200 件のプロファイルを収集。 | 直近のプロファイルから導いた短期・中期・長期のパフォーマンス施策。 |
