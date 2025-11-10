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
Trace: projects/my-sre-prod/traces/4f6c2d9b1a8e5cf2
Duration: 842 ms
Root Span: frontend:/orders
- Span checkout/service (120 ms)
  - Span charge-card (430 ms)
...
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
# Trace Search Results
Project: my-sre-prod
Time Range: 2025-03-05T02:10:00Z–2025-03-05T04:10:00Z
| Trace ID | Latency | Root Span | Status |
| 4f6c2d9b1a8e5cf2 | 842 ms | frontend:/orders | ERROR |
...
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
# Traces Found in Logs
Project: my-sre-prod
Log Filter: severity>=ERROR ...
Found 12 unique traces in 37 log entries
| Trace ID | Timestamp | Severity | Log Name | Message |
| 4f6c2d9b1a8e5cf2 | 2025-03-05T03:42:10Z | ERROR | run.googleapis.com/request_log | ... |
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
# Trace Trend Summary
Detected intent: error traces / window=1h / limit=5
| Trace ID | Timestamp | Service | Status |
| 4f6c2d9b1a8e5cf2 | 2025-03-05T03:42:10Z | checkout | ERROR |
...
```

## Error Reporting

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
# Error Groups Analysis
Project: my-sre-prod
Time Range: 24h
Service Filter: checkout
1. checkout — NullReferenceException — 152 hits
2. checkout — Timeout contacting inventory — 47 hits
...
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
# Error Group Details
Group ID: abcdef1234567890
Project: my-sre-prod
Time Range: 7d
## Recent Error Events (5)
1. 2025/03/04 22:13:42 — checkout v20250304-1 — NullReferenceException at cart.ts:118
...
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
# Profiler Analysis
Project: perf-lab
Profile Type Filter: CPU
Target Filter: checkout
1. CPU @ checkout (2025-03-05T03:40Z, duration 10s)
...
Next Page Available: token "Cg0IARABGAEiB..."
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
# Profile Trend Analysis
Project: perf-lab
Profile Type: CPU
Analysed: 132 profiles
## Trend Summary
- Average CPU: 420 ms → 610 ms (+45%) week-over-week
- Regression detected after deploy 2025-03-04
```

## Support API

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
# Support Cases
Parent: projects/my-sre-prod
Returned: 3
1. [P1][OPEN] network outage - case/12345
...
```

### gcp-support-search-cases — フリーテキスト検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| parent | string | いいえ | デフォルト | 検索対象の親リソース。省略時は現在のプロジェクト (`projects/{id}`) 。 |
| query | string | はい |  | `displayName:"upgrade"` のような自由検索やフィールド条件に対応。 |
| pageSize | number | いいえ | 20 (1-100) | 最大取得件数。 |
| pageToken | string | いいえ |  | 次ページ取得トークン。 |

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
# Support Case Search
Parent: projects/my-sre-prod
Query: displayName:incident state=OPEN
Returned: 2
1. [P2][OPEN] Incident 500s - case/67890
...
```

### gcp-support-get-case — ケース詳細を取得
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい | `projects/{id}/cases/{caseId}` | 完全修飾されたケースリソース。 |

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
Case: projects/my-sre-prod/cases/12345
State: OPEN / Priority: P1
Description: Traffic hitting 503 on us-central1
Contacts: sre@example.com
...
```

### gcp-support-create-case — ケースを新規作成
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| parent | string | いいえ | 現在のプロジェクト | `projects/{id}` もしくは `organizations/{id}`。 |
| displayName | string | はい | 4 文字以上 | ケースタイトル。 |
| description | string | はい | 10 文字以上 | 詳細説明。 |
| classificationId | string | はい |  | `gcp-support-search-classifications` で取得。 |
| priority | enum[`P0`,`P1`,`P2`,`P3`,`P4`,`PRIORITY_UNSPECIFIED`] | いいえ | `P3` | 優先度。 |
| timeZone | string | いいえ |  | IANA タイムゾーン。 |
| languageCode | string | いいえ |  | 例: `ja-JP`。 |
| contactEmail | string | いいえ | 有効なメール | 主要コンタクト。 |
| subscriberEmailAddresses | array<string> | いいえ |  | 追加通知先。 |

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
Case: projects/my-sre-prod/cases/98765
State: NEW / Priority: P1
✅ Support case created successfully in projects/my-sre-prod
```

### gcp-support-update-case — ケース情報を更新
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | 更新対象のケース。 |
| displayName | string | いいえ |  | タイトル変更。 |
| description | string | いいえ |  | 詳細の更新。 |
| classificationId | string | いいえ |  | 新しい分類 ID。 |
| priority | enum[`P0`…`PRIORITY_UNSPECIFIED`] | いいえ |  | 優先度変更。 |
| contactEmail | string | いいえ |  | 主要コンタクトメール。 |
| subscriberEmailAddresses | array<string> | いいえ |  | 通知先リスト。 |
| languageCode | string | いいえ |  | 希望言語。 |
| timeZone | string | いいえ |  | ケースのタイムゾーン。 |

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
Case: projects/my-sre-prod/cases/98765
Updated fields: priority=P2, subscribers=1
✅ Support case projects/my-sre-prod/cases/98765 updated successfully.
```

### gcp-support-close-case — ケースをクローズ
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | 対象ケース。 |
| justification | string | いいえ |  | クローズ理由メモ。 |

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
Case: projects/my-sre-prod/cases/98765
State: CLOSED
✅ Support case projects/my-sre-prod/cases/98765 closed.
Justification: Issue resolved after rollback
```

### gcp-support-list-comments — コメント一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | ケースリソース。 |
| pageSize | number | いいえ | 20 (1-100) | 最大コメント件数。 |
| pageToken | string | いいえ |  | ページングトークン。 |

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
# Support Case Comments
Case: projects/my-sre-prod/cases/98765
Returned: 3
- 2025-03-05T04:10Z Google: Please attach stack traces
- 2025-03-05T04:18Z You: Uploaded logs
```

### gcp-support-create-comment — コメントを追加
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | ケースリソース。 |
| body | string | はい | 1 文字以上 | コメント本文。 |

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
✅ Comment added to projects/my-sre-prod/cases/98765.
- 2025-03-05T04:33Z You: Attached Cloud Storage link with tcpdump
```

### gcp-support-list-attachments — 添付ファイル一覧
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| name | string | はい |  | ケースリソース。 |
| pageSize | number | いいえ | 20 (1-100) | 最大取得件数。 |
| pageToken | string | いいえ |  | ページングトークン。 |

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
# Support Case Attachments
Case: projects/my-sre-prod/cases/98765
Returned: 2
1. error-logs.zip (2.4 MB)
2. tcpdump.har (5.1 MB)
```

### gcp-support-search-classifications — 分類を検索
| フィールド | 型 | 必須 | デフォルト/制約 | 説明 |
| --- | --- | --- | --- | --- |
| query | string | はい |  | `id:"100445"` や `displayName:"service account"` など。 |
| pageSize | number | いいえ | 20 (1-100) | 最大取得件数。 |
| pageToken | string | いいえ |  | ページングトークン。 |

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
# Case Classifications
Query: displayName:"Cloud Run"
Returned: 4
- 100152 Cloud Run > Deployments > 5xx
...
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
| `gcp-spanner-query-plan` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-plan?sql=<URL-encoded>&mode=explain|analyze` | `sql` クエリパラメータ必須。`mode=analyze` もしくは `analyze=1` で EXPLAIN ANALYZE。 | 実行/非実行の注記つきでプラン表と分散 JOIN・インデックスの指摘を返却。 |
| `gcp-spanner-query-stats` | `gcp-spanner://{projectId}/{instanceId}/{databaseId}/query-stats` | 既定のインスタンス／DB を使用。 | `buildQueryStatsJson` が生成するレイテンシ・オプティマイザ情報などの JSON。 |

### Trace リソース
| リソース | URI テンプレート | パラメータ | レスポンス |
| --- | --- | --- | --- |
| `gcp-trace-get-by-id` | `gcp-trace://{projectId}/traces/{traceId}` | `traceId` は 16 進文字列。 | 階層化されたスパン構造を Markdown で表示。 |
| `gcp-trace-related-logs` | `gcp-trace://{projectId}/traces/{traceId}/logs` | `traceId` でログを突き合わせ。 | トレース ID を含む最大 50 件のログとリソース／ラベル情報。 |
| `gcp-trace-recent-failed` | `gcp-trace://{projectId}/recent-failed?startTime=<ISO|1h|6h|30m>` | `startTime` は ISO 形式または `1h`,`2d` などの相対表記。 | 指定期間内でエラーになったトレースの表を表示し、各行にリンクを付与。 |

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
