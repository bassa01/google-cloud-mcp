# Google Cloud MCP 詳細ガイド

## 概要

Google Cloud MCP サーバーは Google Cloud Platform (GCP) の操作を Model Context Protocol を通じて公開し、クライアントが構造化ツールを呼び出したり、ナレッジを参照したり、自動化ワークフローを実行できるようにします。本ガイドではサーバーの構成、リクエスト処理の流れ、各サービスを最大限に活用する方法を解説します。アーキテクチャの背景や高度な利用パターンが必要な場合は、上位レベルの [README](../README.md) と合わせて参照してください。

### 主要な機能

- Error Reporting、Logging、Monitoring、Profiler、Spanner、Trace を単一の MCP エンドポイントで提供します。
- サービス アカウントの認証情報と環境変数による秘密情報を統一的に扱います。
- 会話型エージェント向けに最適化されたプロンプト、フィルター、結果整形を備えています。
- プロジェクト範囲、期間デフォルト、ページネーション補助などのガードレールで信頼性を高めます。

## アーキテクチャ

### コンポーネントの役割

| コンポーネント | 説明 |
| --- | --- |
| `src/index.ts` | MCP サーバーを起動し、サービス登録やロギングなど共通基盤を初期化します。 |
| `src/services/*` | サービス固有のツール定義、データ変換、ドメインロジック（例: Monitoring の指標クエリ）を実装します。 |
| `src/prompts/*` | Spanner の自然言語検索など生成的ヘルパー向けの再利用可能なプロンプトテンプレートを格納します。 |
| `src/utils/*` | 認証、リクエスト整形、共通のページネーション処理を行うユーティリティ群です。 |

### リクエストライフサイクル

1. **クライアント リクエスト** – MCP クライアントがユーザー入力やプロンプト テンプレートを基にツール呼び出しを送信します。
2. **バリデーション** – 必須フィールドや形式を確認するため Zod スキーマでペイロードを検証します。
3. **認証コンテキスト** – 認証ヘルパーがプロジェクト ID、サービス アカウント トークン、リージョン デフォルトを解決します。
4. **サービス実行** – 該当する Google Cloud SDK を呼び出し、レスポンスを正規化し、エラーを行動可能なメッセージに変換します。
5. **レスポンス返却** – 構造化データと読みやすい要約を MCP クライアントに返します。

### エラーハンドリング方針

- SDK の例外をラップし、権限不足、リソース欠如、スロットリングを個別に提示します。
- 一時的なエラーにはリトライのヒントを、恒久的な失敗には IAM や設定の修正案を提示します。
- Winston を介してロギングすることで、本番環境でもテレメトリーを一元化できます。

## 対応サービス

### Error Reporting

Cloud Error Reporting からエラー グループのメタデータやトレンド分析を取得し、複数サービスの本番障害を素早く把握できます。

**主要ツール**

- `gcp-error-reporting-list-groups` – 期間やサービス コンテキストでフィルタリングしたエラー グループ一覧を取得します。
- `gcp-error-reporting-get-group-details` – 特定グループのスタックトレース、発生回数、影響サービスを返します。
- `gcp-error-reporting-analyse-trends` – 発生頻度の変化を要約し、再発や兆候を把握します。

**利用手順例**

1. 対象プロジェクトとサービスでグループを絞り込みます。
2. 詳細情報を取得してスタックトレースを確認します。
3. トレンド分析でインシデントが拡大しているか判断します。

### Logging

Cloud Logging を柔軟なフィルターと一貫したページネーションで検索し、会話形式のログ調査を実現します。

**主要ツール**

- `gcp-logging-query-logs` – 深いフィルターや重大度、リソース条件を指定して検索します。
- `gcp-logging-query-time-range` – 時間範囲に特化したクエリのショートカットです。
- `gcp-logging-search-comprehensive` – 複数フィールドを横断して関連イベントを探します。

**運用のヒント**

- クエリは範囲を限定し、クォータ超過を避けましょう。
- 重大度フィルターとリソース種別を組み合わせてノイズを抑えます。
- 取得結果は追跡質問で要約やクラスタリングを依頼すると効率的です。

### Monitoring

Cloud Monitoring 指標を簡潔に取得し、CPU・メモリ・カスタム指標を MQL を覚えずに問い合わせできます。

**主要ツール**

- `gcp-monitoring-query-metrics` – パラメータ化された MQL を実行します。
- `gcp-monitoring-list-metric-types` – Compute Engine や Cloud Run などのメトリック種別 URI を調べます。
- `gcp-monitoring-query-natural-language` – 自然言語プロンプトを MQL に変換して実行します。

**運用のヒント**

- 自然言語クエリの前に `list-metric-types` で利用可能なメトリックを確認します。
- ダッシュボードと整合する整列ウィンドウ（例: 5m、1h）を指定します。
- `mean`、`max`、`percentile` などの集約を指定して結果量を抑えます。

### Profiler

Cloud Profiler のデータを分析し、CPU・ヒープ・ウォールタイムのホットスポットを特定します。

**主要ツール**

- `gcp-profiler-list-profiles` – プロファイル種別、デプロイ対象、期間で一覧表示します。
- `gcp-profiler-analyse-performance` – 支配的なコールスタックや性能退行を強調します。
- `gcp-profiler-compare-trends` – 2 つのプロファイル群を比較して改善・悪化を把握します。

**運用のヒント**

- 小さめの期間から開始し、大量のプロファイル処理を避けましょう。
- 新リリースや設定変更の検証には比較ツールが有効です。

### Spanner

分散データベースでのスキーマ探索や SQL 実行を支援します。

**主要ツール**

- `gcp-spanner-list-instances`、`gcp-spanner-list-databases`、`gcp-spanner-list-tables` でトポロジーを把握します。
- `gcp-spanner-execute-query` はパラメータバインド付きで SQL を安全に実行します。
- `gcp-spanner-query-natural-language` と `gcp-spanner-query-count` は会話的な要約クエリを生成します。

**運用のヒント**

- 本番とステージングのインスタンスを明確に分けて指定しましょう。
- 自然言語ヘルパーで草案を作り、必要に応じて手動で調整します。

### Trace

分散トレーシング診断に特化し、可能な場合はログと相互参照します。

**主要ツール**

- `gcp-trace-list-traces` – レイテンシ、スパン数、期間でトレース一覧を取得します。
- `gcp-trace-get-trace` – ルート原因分析のために完全なタイムラインを取得します。
- `gcp-trace-find-from-logs` – ログから関連トレースを見つけます。
- `gcp-trace-query-natural-language` – 記述的なプロンプトから高度なフィルターを生成します。

**運用のヒント**

- Logging の結果と `find-from-logs` を組み合わせるとトレースとログの往復が速くなります。
- 95/99 パーセンタイルのレイテンシに注目し、性能退行を監視します。

## 認証と権限

### 認証情報の選択肢

1. **サービス アカウント キーファイル** – `GOOGLE_APPLICATION_CREDENTIALS` に JSON キーのパスを指定します。CLI やデスクトップ MCP クライアントで最も扱いやすい方法です。
2. **環境変数** – `GOOGLE_CLIENT_EMAIL` と `GOOGLE_PRIVATE_KEY` を直接設定します。シークレット マネージャーやマネージド環境に適しています。

### プロジェクトの解決

- `GOOGLE_CLOUD_PROJECT` が設定されていれば、すべてのツールのデフォルト プロジェクトになります。
- 設定されていない場合、サーバーはサービス アカウントのメタデータからプロジェクトを推測します。
- 各ツールは必要に応じてプロジェクトやリソース パスを上書きできます。

### 権限のベストプラクティス

- サービス アカウントには最小権限のロール（例: `roles/logging.viewer`、`roles/monitoring.viewer`）を付与します。
- Spanner で書き込みを行う場合は `roles/spanner.databaseUser` など適切な権限が必要です。
- Logging や Monitoring はリージョン別エンドポイントが関与する場合がありますが、サーバー側で吸収します。

## 設定とデプロイ

### 環境変数

| 変数 | 目的 |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービス アカウント JSON キーのパス。 |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | キーファイルを使わない場合の代替認証情報。 |
| `GOOGLE_CLOUD_PROJECT` | 個別リクエストにプロジェクト ID がない場合のデフォルト。 |
| `DEBUG` | `true` で詳細ログを有効化します。 |
| `MCP_SERVER_PORT` | プロキシやコンテナ配下でホストする際のポート指定。 |

### クライアント設定例

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

### デプロイのヒント

- クライアントが対応していれば `lazyAuth` を有効にし、起動遅延を抑えます。
- コンテナ デプロイでは認証情報ファイルを読み取り専用でマウントし、定期的にローテーションします。
- チーム全体の可観測性を高めるため Cloud Logging エクスポートや SIEM 連携と組み合わせましょう。

## ツール早見表

| サービス | ツール | 目的 |
| --- | --- | --- |
| Error Reporting | `gcp-error-reporting-list-groups` | 期間内にアクティブなエラー グループを把握します。 |
| Error Reporting | `gcp-error-reporting-get-group-details` | スタックトレースや発生状況を確認します。 |
| Error Reporting | `gcp-error-reporting-analyse-trends` | サービスやバージョン間のトレンドを分析します。 |
| Logging | `gcp-logging-query-logs` | 高度な Cloud Logging クエリを実行します。 |
| Logging | `gcp-logging-query-time-range` | 時間範囲に特化した検索を行います。 |
| Logging | `gcp-logging-search-comprehensive` | ペイロードやメタデータを横断的に検索します。 |
| Monitoring | `gcp-monitoring-query-metrics` | 集約ヒント付きで MQL を実行します。 |
| Monitoring | `gcp-monitoring-list-metric-types` | 利用可能なメトリック記述子を列挙します。 |
| Monitoring | `gcp-monitoring-query-natural-language` | 自然言語を MQL に変換します。 |
| Profiler | `gcp-profiler-list-profiles` | CPU・ヒープ・ウォールタイムのプロファイルを検索します。 |
| Profiler | `gcp-profiler-analyse-performance` | ボトルネックとなるホットスポットを要約します。 |
| Profiler | `gcp-profiler-compare-trends` | リリース間でプロファイルを比較します。 |
| Spanner | `gcp-spanner-list-instances` | Spanner インスタンスを列挙します。 |
| Spanner | `gcp-spanner-list-databases` | インスタンス内のデータベースを一覧表示します。 |
| Spanner | `gcp-spanner-list-tables` | テーブル構造を確認します。 |
| Spanner | `gcp-spanner-execute-query` | パラメータ化された SQL を実行します。 |
| Spanner | `gcp-spanner-query-natural-language` | 自然言語から SQL を生成します。 |
| Spanner | `gcp-spanner-query-count` | 行数を素早く集計します。 |
| Trace | `gcp-trace-list-traces` | 遅延やエラーを含むトレースを検出します。 |
| Trace | `gcp-trace-get-trace` | トレース全体のタイムラインを調査します。 |
| Trace | `gcp-trace-find-from-logs` | ログから関連トレースへピボットします。 |
| Trace | `gcp-trace-query-natural-language` | 会話的にトレース フィルターを構築します。 |

## プロンプト パターン

### 基本指針

- プロジェクト ID、サービス名、リソース種別、期間など具体的な文脈から開始します。
- まず広いクエリを実行し、その結果をもとに絞り込むと効率的です。
- データ量が多い場合は要約や比較をリクエストしましょう。

### サービス別プロンプト例

- **Logging** – 「プロジェクト `prod-app-123` の Cloud Run サービス `checkout` における直近 2 時間の ERROR ログを要約して」
- **Monitoring** – 「HTTPS ロードバランサ `lb-frontend` の 95 パーセンタイル レイテンシを過去 1 日分表示して」
- **Profiler** – 「サービス `payments-api` のバージョン `v1.4.0` と `v1.5.0` の CPU プロファイルを比較して」
- **Spanner** – 「`orders` テーブルで注文数が多い上位 5 名の顧客を求める SQL を作成して」
- **Trace** – 「スパン `CheckoutService/ProcessPayment` を含み 5 秒超のトレースを探して」

## トラブルシューティング

### 認証エラー

- 認証情報が対象プロジェクトに対応しているか確認します。
- 環境変数で秘密鍵を設定する場合は改行を正しくエスケープします。
- `invalid_grant` や `malformed token` が出る場合はキーを再発行します。

### 権限不足

- 閲覧系操作にはビューア ロールを、Spanner など書き込みを行う操作には適切なロールを付与します。
- `gcloud projects get-iam-policy` でロールの付与状況を迅速に確認できます。

### タイムアウト・クォータ超過

- 時間範囲やリソース フィルターを絞り込みます。
- Monitoring では整列期間を短くしてレスポンス量を抑えます。
- 429 が頻発する場合はバックオフを含むリトライ戦略が必要です。

### データ欠損がある場合

- 対象リソースでメトリックやトレースがエクスポートされているか確認します。
- Profiler などサンプリング収集のサービスでは短時間ウィンドウだと結果がないことがあります。

## 付録

### 便利な gcloud コマンド

- `gcloud auth application-default login` – ローカルの ADC 認証情報を初期化します。
- `gcloud projects list` – 現在のアイデンティティでアクセス可能なプロジェクトを確認します。
- `gcloud logging read` – MCP 外でフィルターを検証する際に活用できます。

### 追加リソース

- [Google Cloud Error Reporting ドキュメント](https://cloud.google.com/error-reporting/docs)
- [Cloud Logging クエリ言語リファレンス](https://cloud.google.com/logging/docs/view/logging-query-language)
- [Cloud Monitoring メトリクス ガイド](https://cloud.google.com/monitoring)
- [Cloud Profiler の概要](https://cloud.google.com/profiler)
- [Cloud Spanner SQL リファレンス](https://cloud.google.com/spanner/docs/reference/standard-sql)
- [Cloud Trace ドキュメント](https://cloud.google.com/trace/docs)
