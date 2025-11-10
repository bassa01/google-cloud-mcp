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
- 各サービス固有のマークダウン (表・見出し) は原文のまま返却されるため、クライアント側でレンダリングしてください。

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
# Log Query Results
Project: my-sre-prod
Filter: resource.type="cloud_run_revision" severity>=ERROR
Entries: 3

## 2025-03-01T04:15:27Z — ERROR
textPayload: POST /v1/orders 500
...
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
# Log Time Range Results
Project: my-sre-prod
Time Range: 2025-03-05T02:10:00.000Z to 2025-03-05T04:10:00.000Z
Filter: severity>=WARNING resource.type="gce_instance"
Entries: 42
...
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
# Comprehensive Log Search Results
Project: my-sre-prod
Search Term: "deadline exceeded"
Time Range: 2025-03-04T05:00:00.000Z to 2025-03-05T05:00:00.000Z
Severity: ERROR
Resource: cloud_run_revision
Entries Found: 7
...
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
# Query Results
Project: prod-data
Instance: main-instance
Database: ledger
SQL: `SELECT user_id, status ...`
Rows: 25
| user_id | status |
| 12345 | ACTIVE |
...
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
# Spanner Tables
Project: prod-data
Instance: main-instance
Database: ledger
| Table Name | Column Count |
| accounts | 14 |
| payments | 22 |
...
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
# Spanner Instances
Project: prod-data
| Instance ID | State | Config | Nodes |
| main-instance | READY | regional-us-central1 | 3 |
...
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
# Spanner Databases
Project: prod-data
Instance: main-instance
| Database ID | State |
| ledger | READY |
| analytics | READY |
...
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
# Query Results
Project: prod-data
Instance: main-instance
Database: ledger
Natural Language Query: List the first 20 orders...
Generated SQL: `SELECT * FROM orders WHERE total > 100 LIMIT 20`
| order_id | total | status |
...
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
# Spanner Query Count
Project: prod-data
Instance: main-instance
Query Type: READ / Status: OK
Time Range: 2025-03-05T00:00:00Z to 2025-03-05T06:00:00Z
| Timestamp | Query Count |
| 2025-03-05T00:05:00Z | 1820 |
...
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
# Metric Query Results
Project: sre-metrics
Filter: metric.type="compute.googleapis.com/instance/cpu/utilization" ...
Time Range: 2025-03-05T02:00:00Z to 2025-03-05T04:00:00Z
Alignment: 60s
## Instance n2-standard-4
| Timestamp | Value |
| ... |
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
# Available Metric Types
Project: sre-metrics
Search term: "spanner"
| Metric Type | Display Name | Kind | Value Type | Description |
| spanner.googleapis.com/instance/cpu/utilization | CPU utilization | GAUGE | DOUBLE | ... |
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
# Natural Language Query Results
Project: sre-metrics
Query: Show App Engine latency by region for the last day
Generated Filter: metric.type="appengine.googleapis.com/http/server/response_latencies" ...
Time Range: 2025-03-04T00:00:00Z to 2025-03-05T00:00:00Z
...
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
| parent | string | いいえ | デフォルト | 検索対象。 |
| query | string | はい |  | `

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
