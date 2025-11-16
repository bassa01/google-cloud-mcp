# Google Cloud MCP 詳細ガイド

## オンボーディングチェックリスト

1. **開発ツールを確認** – Node.js 24.11+ と pnpm 10.21+ が利用可能か確認します。
   ```bash
   node -v
   corepack enable && corepack use pnpm@10.21.0
   pnpm -v
   ```
2. **Google Cloud CLI をセットアップ** – `gcloud components update` を実行し、少なくとも 1 プロジェクトに Viewer 権限を持つアカウントでログインします。
3. **リポジトリを取得して依存関係を導入** – `git clone` → `pnpm install` を実行し、`pnpm lint` と `pnpm test` が通ることを確認してからブランチを切ります。
4. **認証方式を決める** – サービスアカウント キーファイルか環境変数かを選び、後述の手順で `.env` を作成します。
5. **ADC を用意** – `gcloud auth application-default login` を実行しておくと、`.env` が未設定でもフォールバックできます。
6. **開発サーバーを起動** – `pnpm dev` で `ts-node --esm src/index.ts` が立ち上がるので、Claude Desktop や MCP Inspector から接続できることを確認します。
7. **本ガイドをざっと読む** – リポジトリ構成、アーキテクチャ、テスト方針を把握し、新卒メンバーでも迷わず開発できるようにします。
8. **CI と同じパイプラインを実行** – `pnpm ci` は lint → format:check → coverage テストをまとめて実行します。PR 前に必ず通しておきましょう。

## ローカル環境セットアップ

### 1. 必要なソフトウェア

- **Node.js 24.11 以上** – `package.json` の `engines.node` と合わせます。
- **pnpm 10.21 以上** – `corepack enable && corepack use pnpm@10.21.0` でリポジトリの `packageManager` バージョンと同期します。
- **Google Cloud CLI** – `gcloud init` で認証・プロジェクト切り替えを行います。
- **Google Cloud プロジェクト** – Logging / BigQuery / Monitoring / Spanner / Trace / Profiler / Error Reporting / (必要なら) Support API へのアクセス権が必要です。

バージョン確認例:

```bash
node -v
pnpm -v
gcloud version
```

### 2. Google Cloud への認証

1. `gcloud auth application-default login`
2. `gcloud config set project <PROJECT_ID>`
3. `gcloud auth application-default print-access-token` (ADC が有効かを確認)

`GOOGLE_APPLICATION_CREDENTIALS` が未設定でも ADC を利用するため、定期的に更新して 401 エラーを防ぎます。

### 3. 認証情報の決め方

- **サービスアカウント キーファイル (ローカル開発向け推奨)**  
  1. 最小権限のロール (例: `roles/logging.viewer`, `roles/monitoring.viewer`, `roles/spanner.databaseUser`, `roles/cloudsupport.viewer`) を付与したサービスアカウントを作成します。  
  2. 次のコマンドでキーを生成します:
     ```bash
     gcloud iam service-accounts keys create ~/.config/gcloud/google-cloud-mcp.json \
       --iam-account <SERVICE_ACCOUNT_EMAIL>
     ```  
  3. `GOOGLE_APPLICATION_CREDENTIALS` にその JSON のパスを指定します。

- **環境変数 (CI / ホストランタイム向け)**  
  `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (改行は `\n` でエスケープ), `GOOGLE_CLOUD_PROJECT` を環境変数で渡します。ファイルを置きたくないランナーで便利です。

いずれの方法でも `LAZY_AUTH=true` (デフォルト) で初回リクエストまで認証を遅延できます。詳細ログが欲しいときは `DEBUG=1` を設定してください。

### 4. ローカル `.env` の作成

```
GOOGLE_APPLICATION_CREDENTIALS=/Users/<you>/.config/gcloud/google-cloud-mcp.json
GOOGLE_CLOUD_PROJECT=my-sandbox-project
LAZY_AUTH=true
DEBUG=0
MCP_SERVER_PORT=8082
```

`.gitignore` ですでに除外済みです。`direnv` や `dotenvx` などで自動読込すると便利です。

### 5. 初回ビルドとスモークテスト

```bash
pnpm install            # 依存関係
pnpm lint               # ESLint
pnpm test               # Vitest
pnpm dev                # ts-node ホットリロード
pnpm build && pnpm start  # トランスパイル後に Inspector などで使用
```

UI で挙動を確認したい場合は下記を実行します:

```bash
npx -y @modelcontextprotocol/inspector node dist/index.js
```

## リポジトリツアー

| パス | 役割 |
| --- | --- |
| `src/index.ts` | ロギング・認証・プロンプト・リソースディスカバリ・各サービス登録をまとめるエントリポイント。 |
| `src/services/<service>/tools.ts` | 各サービス (Logging / BigQuery / Monitoring / Profiler / Error Reporting / Spanner / Trace / Support) のツール登録と Zod スキーマ。 |
| `src/services/<service>/resources.ts` | ログやメトリクスなどを MCP リソースとして公開する登録処理。 |
| `src/services/<service>/types.ts` | DTO、フォーマッタ、ユーティリティをまとめて結果を整形。 |
| `src/services/support/client.ts` | Cloud Support API 向けの軽量 REST クライアント。 |
| `src/prompts/index.ts` | ログ解析・モニタリング・Spanner NL などの再利用プロンプト。 |
| `src/utils/auth.ts` | Google 認証とプロジェクト解決ロジック。 |
| `src/utils/logger.ts` | Winston ベースの構造化ロガー。`console.log` は使わずこれを利用します。 |
| `src/utils/resource-discovery.ts` / `project-tools.ts` | プロジェクトやリージョン、メトリクス記述子を一覧化する共通ツール。 |
| `src/utils/security-validator.ts` / `session-manager.ts` / `time.ts` | 入力サニタイズ、セッション状態、時間ユーティリティ。 |
| `test/unit/**` | `src/**` と 1:1 対応する高速 Vitest。 |
| `test/integration/**` | プロンプトやリソースを跨ぐ統合テスト。 |
| `test/mocks/**` | Google Cloud クライアントのモックとフィクスチャ。 |
| `test/setup.ts` | Vitest のグローバルフック/モック登録。 |
| `docs/**` | 本ガイドを含むドキュメント。コード変更時は必ず更新します。 |
| `dist/` | ビルド成果物 (直接編集禁止)。 |
| `smithery.yaml` | Smithery で MCP Server をホストするためのテンプレート。 |
| `Dockerfile` | 再現性のあるビルド用コンテナイメージ。 |

## 日々の開発フロー

- **最新化とブランチ切り替え** – `git pull origin main && git switch -c feature/<slug>`。
- **ロックファイル更新時だけインストール** – `pnpm install` は `pnpm-lock.yaml` を基準にします。
- **ホットリロードで反復** – `pnpm dev` (必要なら `-- --inspect` で DevTools 接続)。
- **MCP Inspector で実際の挙動を確認** – `npx -y @modelcontextprotocol/inspector node dist/index.js`。
- **早めに整形/静的解析** – `pnpm format:check && pnpm lint`、自動修正は `pnpm lint:fix`。 
- **集中的なテスト** – `pnpm test:watch` で継続実行、単体ファイルは `pnpm test --runInBand test/unit/services/logging.test.ts`。
- **成果物共有前にビルド** – `pnpm build` は TypeScript をトランスパイルし、Monitoring の Markdown 資産を `dist/services/monitoring/` へコピーします。
- **ドキュメントを並行更新** – 新しいツール/サービスを追加したら `docs/` と `README.md` も更新します。

## 概要

Google Cloud MCP サーバーは Google Cloud Platform (GCP) の操作を Model Context Protocol を通じて公開し、クライアントが構造化ツールを呼び出したり、ナレッジを参照したり、自動化ワークフローを実行できるようにします。本ガイドではサーバーの構成、リクエスト処理の流れ、各サービスを最大限に活用する方法を解説します。アーキテクチャの背景や高度な利用パターンが必要な場合は、上位レベルの [README](../README.md) と合わせて参照してください。

### 主要な機能

- Error Reporting / Logging / Monitoring / Profiler / Spanner / Support / Trace を単一の MCP エンドポイントで提供。
- サービスアカウント認証と環境変数ベースのシークレットを統一的に扱います。
- 会話型エージェント向けに最適化されたプロンプト、フィルター、結果整形を備えています。
- プロジェクト範囲、期間デフォルト、ページネーション補助などのガードレールで信頼性を高めます。
- `project-tools` / `resource-discovery` などの補助ツールでメタデータを即座に参照できます。

## アーキテクチャ

### コンポーネントの役割

| コンポーネント | 説明 |
| --- | --- |
| `src/index.ts` | MCP サーバーを起動し、サービス登録やロギングなど共通基盤を初期化します。 |
| `src/services/*` | サービス固有のツール定義、データ変換、ドメインロジック (例: Monitoring の指標クエリ) を実装します。 |
| `src/prompts/*` | ログ調査や Monitoring サマリーなど汎用ヘルパー向けのプロンプトテンプレートを格納します。 |
| `src/utils/*` | 認証、リクエスト整形、共通のページネーション処理を行うユーティリティ群です。 |
| `test/*` | ランタイムコードと 1:1 に対応する Vitest スイートです。 |

### 共有ユーティリティ

| モジュール | 役割 |
| --- | --- |
| `utils/auth.ts` | `google-auth-library` を初期化し、`getProjectId()` などのヘルパーを提供。 |
| `utils/logger.ts` | Winston 構成を集約し、すべてのログ出力をここに集めます。 |
| `utils/resource-discovery.ts` | プロジェクト/リージョン/メトリクス記述子を MCP リソースとして公開。 |
| `utils/project-tools.ts` | プロジェクト一覧など、サービス非依存の便利ツール。 |
| `utils/security-validator.ts` | プロジェクト ID やテーブル名などユーザー入力をサニタイズ。 |
| `utils/session-manager.ts` | セッションごとの状態を保持し、Lazy Auth やキャッシュを支援。 |
| `utils/time.ts` | 期間指定やタイムレンジの共通フォーマットを担います。 |

### リクエストライフサイクル

1. **クライアントリクエスト** – MCP クライアントがユーザー入力またはプロンプトを基にツール呼び出しを送信。
2. **バリデーション** – Zod スキーマで必須フィールドや形式を検証。
3. **認証コンテキスト** – 認証ヘルパーがプロジェクト ID やトークン、リージョンデフォルトを解決。
4. **サービス実行** – 対応する Google Cloud SDK を呼び出し、レスポンスを正規化してエラーを行動可能なメッセージに変換。
5. **レスポンス返却** – 構造化データと要約を MCP クライアントへ返します。

### エラーハンドリング方針

- SDK の例外をラップし、権限不足・リソース欠如・スロットリングを個別に提示します。
- 一時的なエラーにはリトライ指針を、永続的な失敗には IAM や設定の修正案を示します。
- ログは Winston 経由で出力し、本番環境でも一元管理できます。

## 対応サービス

### Error Reporting

Cloud Error Reporting からエラーグループのメタデータやトレンド分析を取得し、複数サービスの本番障害を素早く把握できます。

**主要ツール**

- `gcp-error-reporting-list-groups` – 期間やサービスコンテキストで絞り込んだエラーグループ一覧。
- `gcp-error-reporting-get-group-details` – スタックトレース、発生回数、影響サービスを取得。
- `gcp-error-reporting-analyse-trends` – 発生頻度の変化を要約し、再発や兆候を把握。

**利用手順例**

1. 対象プロジェクトとサービスでグループを選別。
2. 詳細情報でスタックトレースを確認。
3. トレンド分析でインシデントの拡大有無を判断。

### Logging

Cloud Logging を柔軟なフィルターと一貫したページネーションで検索し、会話形式のログ調査を実現します。

**主要ツール**

- `gcp-logging-query-logs` – 重大度やリソース条件を含む高度なフィルターを実行。
- `gcp-logging-query-time-range` – 時間範囲に特化したショートカットクエリ。
- `gcp-logging-search-comprehensive` – 複数フィールドを横断して関連イベントを捜索。
- `gcp-logging-log-analytics-query` – `entries:queryData` / `entries:readQueryResults` を使って Log Analytics SQL を実行し、`{{log_view}}` プレースホルダーでビューを差し込みます。

**運用ヒント**

- クエリは範囲を絞り、クォータ超過を防止。
- 重大度フィルターとリソース種別を組み合わせてノイズを削減。
- 取得結果は追跡質問で要約やクラスタリングを依頼すると効率的です。
- Log Analytics SQL を使う際は `LOG_ANALYTICS_LOCATION` (既定 `global`)、`LOG_ANALYTICS_BUCKET` (`_Default`)、`LOG_ANALYTICS_VIEW` (`_AllLogs`) を設定するか、`resourceName` で目的のアナリティクスビューを明示してください。
- 長時間実行やより大きなプレビューが必要な場合は `LOG_ANALYTICS_QUERY_TIMEOUT_MS` / `LOG_ANALYTICS_READ_TIMEOUT_MS` / `LOG_ANALYTICS_ROW_PREVIEW_LIMIT` を調整すると安定します。

#### ログのマスキングポリシー

すべての `gcp-logging-*` ツールは、レスポンスを返す前にリモート IP・ユーザー識別子・リクエストボディを自動でマスクします。信頼済みオペレーターが完全なペイロードを確認する必要がある場合は、カンマ区切りの `LOG_PAYLOAD_FULL_ACCESS_ROLES` 環境変数（既定: `security_admin, compliance_admin, site_reliability_admin`）を設定し、`MCP_USER_ROLES` もしくは `MCP_ACTIVE_ROLES` に一致するロールを渡してください。一致がない場合は常にマスクされたままで、レスポンス末尾に理由を示す注意書きが追加されます。

### Monitoring

Cloud Monitoring 指標を簡潔に取得し、PromQL への移行中でも CPU・メモリ・カスタム指標をすばやく確認できます。

**主要ツール**

- `gcp-monitoring-query-metrics` – Cloud Monitoring のフィルター式を実行し、PromQL に転用しやすいラベル/値を返します。
- `gcp-monitoring-list-metric-types` – Compute Engine や Cloud Run などのメトリクスタイプを調査。

**運用ヒント**

- 先に `gcp-monitoring-list-metric-types` を実行して利用可能なメトリクスを確認。
- 5m / 1h などのアライメントウィンドウを指定し、ダッシュボードと揃えます。
- `mean` / `max` / `percentile` などの集計を付与して結果を圧縮。
- Managed Service for Prometheus や `projects.timeSeries.query` API と組み合わせ、完全な PromQL 実行を行います。

### Profiler

Cloud Profiler のデータを解析し、CPU / ヒープ / 実行時間のホットスポットを特定できます。

**主要ツール**

- `gcp-profiler-list-profiles` – プロファイル種別・デプロイ先・期間で一覧化。
- `gcp-profiler-analyse-performance` – 支配的なコールスタックや性能退行を抽出。
- `gcp-profiler-compare-trends` – 2 つの期間を比較して改善/退行を可視化。

**運用ヒント**

- まずは短い期間でサーベイし、大量データを避けます。
- バージョン間の比較でリリース検証を効率化。

### BigQuery

BigQuery ツールは読み取り専用のガードレールを徹底しつつ、データウェアハウスの探索やコスト見積もりを会話形式でこなせます。

**主要ツール**

- `gcp-bigquery-list-datasets` – プロジェクト内のデータセットを一覧し、フレンドリ名やラベル、期限を確認。
- `gcp-bigquery-list-tables` – データセット内のテーブル/ビューを列挙し、パーティションやクラスタリング情報を付与。
- `gcp-bigquery-get-table-schema` – テーブルのカラム名/型/モード（入れ子含む）やパーティション条件を取得。
- `gcp-bigquery-execute-query` – SELECT/WITH/EXPLAIN/SHOW/DESCRIBE のみを許可し、INSERT/UPDATE/CREATE/EXPORT などは BigQuery に送る前に遮断。dryRun、パラメータ、`defaultDataset`、`BIGQUERY_LOCATION` などのオプションをサポートします。

**運用ヒント**

- SQL を書く前に `list-datasets` / `list-tables` / `get-table-schema` で正式名称とパーティション設計を把握すると、誤参照や非効率なスキャンを避けられます。
- EU/US などリージョンが固定されているデータセットは `BIGQUERY_LOCATION` もしくは `location` 引数で合わせます。
- テーブル参照を省略したい場合は `defaultDataset` を渡し、未修飾テーブルでも実行できるようにします。
- 大規模テーブルや新規クエリは先に `dryRun: true` でバイト数を確認し、コストを把握してから本番実行します。

### Spanner

Spanner のスキーマ調査や SQL 実行を支援します。

**主要ツール**

- `gcp-spanner-list-instances` / `gcp-spanner-list-databases` / `gcp-spanner-list-tables` – インフラ全体をカタログ化。
- `gcp-spanner-execute-query` – SELECT / WITH / EXPLAIN / SHOW / DESCRIBE といった読み取り専用 SQL のみ受け付け、破壊的クエリは実行前にブロック。
- `gcp-spanner-query-count` – 会話的に集計やクエリ生成を実施する
- `gcp-spanner-query-stats` – `SPANNER_SYS.QUERY_STATS_TOP_MINUTE/10MINUTE/HOUR` を読み、1m/10m/1h のレイテンシー/CPU トップクエリを AI が扱いやすい JSON で提示。
- `gcp-spanner-query-plan` （\`gcp-spanner://.../query-plan?sql=SELECT+...\`）で EXPLAIN / EXPLAIN ANALYZE を実行し、分散 JOIN やインデックス不足を把握。

**運用ヒント**

- 本番とステージングを明示的に分けて実行し、環境混在を避ける。
- クエリはテキストで下書きし、`execute-query` へ貼り付けて安全に実行。
- Query Insights を有効化し、MCP のサービスアカウントに `roles/spanner.databaseReader` 以上を付与すると `SPANNER_SYS` ビューを読み取れます。未取得のウィンドウは Markdown 上で `n/a` として明示されます。

### Trace

分散トレース診断に特化し、可能な限りログとの往復も支援します。

**主要ツール**

- `gcp-trace-list-traces` – 遅延・スパン数・期間でトレースを一覧。
- `gcp-trace-get-trace` – トレース全体を取得して原因分析。
- `gcp-trace-find-from-logs` – ログとトレースをクロスリファレンス。

**運用ヒント**

- Logging の結果と `find-from-logs` を組み合わせ、トレース⇔ログの往復を高速化。
- 95/99 パーセンタイルのレイテンシを追い、性能退行を監視。

### Support

Cloud Support API と連携し、MCP 上からサポートケースの管理・コミュニケーションを行えます。

**主要ツール**

- `gcp-support-list-cases` / `gcp-support-search-cases` – プロジェクト/組織単位でケースを一覧・検索。
- `gcp-support-get-case` – 単一ケースのメタデータ、分類、SLA を取得。
- `gcp-support-create-case` / `update-case` / `close-case` – ケースライフサイクルを管理。
- `gcp-support-list-comments` / `create-comment` / `list-attachments` – コメントや添付を MCP から直接操作。
- `gcp-support-search-classifications` – ケース作成前に適切な製品/コンポーネント分類を探索。

**運用ヒント**

- `parent` (`projects/<id>` or `organizations/<id>`) を指定して結果をスコープ。省略時はアクティブプロジェクトになります。
- サポートエンタイトルメントと課金プロジェクトの整合性に注意。`tools.ts` で自動解決しますが、認証情報を統一してください。
- 添付ファイルに機微情報が含まれる場合はマスキングのうえアップロードしましょう。

## プロンプトパターンと作成のコツ

### 基本方針

- プロジェクト ID / サービス名 / リソース種別 / 期間など具体的な文脈から始める。
- まず広く情報を集め、追加質問で徐々に絞り込む。
- 生データが多い場合は要約や比較を指示して負荷を下げる。

### サービス別プロンプト例

- **Logging** – 「`prod-app-123` の Cloud Run サービス `checkout` で過去 2 時間の ERROR ログを要約して」。
- **Monitoring** – 「`my-network-prod` の HTTPS LB `lb-frontend` の過去 1 日の p95 レイテンシを表示して」。
- **Profiler** – 「`payments-api` の v1.4.0 と v1.5.0 の CPU プロファイルを比較して」。
- **BigQuery** – 「プロジェクト `finops-prod-123` の `billing.daily_costs` テーブルで dry-run を実行し、スキャンバイト数を教えて」。
- **Spanner** – 「`orders` テーブルで注文数が多い顧客トップ 5 を出す SQL を作成して」。
- **Trace** – 「スパン `CheckoutService/ProcessPayment` を含み 5 秒超のトレースを探して」。
- **Support** – 「`projects/payments-prod` の今週作成された P1 ケースを列挙して」。

### プロンプトを追加/変更するときの手順

1. `src/prompts/index.ts` を更新し、サービスごとにヘルパー関数へまとめます。
2. Zod で引数スキーマを定義し、MCP クライアントがバリデーションつきフォームを描画できるようにします。
3. `logging://` や `monitoring://` のようなリソース URI を使い、LLM が構造化データにアクセスできるようにします。
4. 冪等性を保ち、副作用のある処理やランダム性は入れないようにします。
5. 新規プロンプトは `docs/` にも追記し、利用用途を周知します。

## サーバー拡張の手引き

### 既存サービスにツールを追加する

1. `src/services/<service>/` を開き、`tools.ts` に `server.registerTool` を追加 (命名は `gcp-<service>-<action>` に統一)。
2. Zod で入力スキーマを定義し、`utils/security-validator.ts` のヘルパーを再利用します。
3. 出力はフォーマッタ (`types.ts` のヘルパー) を通じて整形し、MCP クライアントに読みやすいテキスト/リソースを返します。
4. ブラウズ可能なデータを扱う場合は `resources.ts` に MCP リソースも登録します。
5. `test/unit/services/<service>.test.ts` でハッピーパス/エラーケースをモック付きで検証します (`test/mocks/` を活用)。
6. README とドキュメント (`docs/deep-dive-*.md`) に新ツールを明記し、利用例を追加します。

### 新しいサービス自体を追加する

1. `src/services/<new-service>/{index,tools,resources,types}.ts` を作成。
2. `index.ts` から `register<Service>Tools` / `register<Service>Resources` をエクスポート。
3. ルートの `src/index.ts` で該当サービスを `try/catch` 包含の形で `register` します。
4. `test/mocks/<service>.ts` を追加し、`test/unit` と `test/integration` にテストを用意します。
5. ドキュメントやツール一覧 (`README`, `docs/*`) を更新し、サポートサービスとして明記します。

### ドキュメントとサンプルを同期する

- ツール追加時は `README.md` の「Services」も更新。
- `docs/deep-dive-en.md` / `docs/deep-dive-ja.md` を同時に拡充し、次の新人が手順を辿れるようにします。
- ユーザー向け変更では PR にプロンプト例や Inspector のスクリーンショットを添付するとレビュアーが助かります。

## テストと品質ゲート

| コマンド | 目的 |
| --- | --- |
| `pnpm test` | 全 Vitest スイートを CI モードで実行。 |
| `pnpm test:watch` | 開発中の高速フィードバック用ウォッチモード。 |
| `pnpm test:coverage` | V8 カバレッジレポートを生成。リリース前に実行。 |
| `pnpm lint` / `pnpm lint:fix` | `src/**/*.ts` の ESLint。 |
| `pnpm format:check` | `src/**/*.ts` への Prettier チェック。`pnpm format` で自動整形。 |
| `pnpm build` | TypeScript をコンパイルし、Monitoring の Markdown 資産を `dist/` にコピー。 |
| `pnpm ci` | lint → format:check → coverage をまとめて実行 (CI 同等)。 |

テストのヒント:

- `test/setup.ts` でグローバルモックを登録し、個々のテストで重複を減らします。
- `test/mocks/` のフィクスチャで Google Cloud レスポンスを再現し、クォータを消費しないようにします。
- サービスを跨ぐフロー (例: Logging から Trace を引く) は統合テストで担保します。
- バグ修正前に必ず再現テストを書き、回 regressions を防ぎます。

## トラブルシューティングプレイブック

### 認証エラー

- 認証情報が対象プロジェクトと一致しているか確認。
- 環境変数の秘密鍵は改行を `\n` でエスケープ。
- `invalid_grant` や `malformed token` が出たらキーを再生成。
- `DEBUG=1` でどのパスの認証情報を読んでいるかログ出力。

### 権限不足

- 閲覧系は Viewer ロール、Spanner への書き込みは `roles/spanner.databaseUser` など適切な権限を付与。
- `gcloud projects get-iam-policy <project>` でバインド状況を確認。
- Support API はサポートエンタイトルメントが必須である点に注意。

### タイムアウト / クォータ超過

- 期間やフィルターを絞り、レスポンス量を減らす。
- Monitoring ではアライメント期間を短く設定。
- 429 が続く場合は指数バックオフを推奨。

### データが返らない

- そもそも対象リソースでメトリクス/トレースが出力されているか確認。
- Profiler などサンプリングサービスでは短時間ウィンドウで結果が空になることもあります。
- アクティブプロジェクトとクエリ対象プロジェクトが一致しているか再確認。

### ローカル開発特有の問題

- Inspector で古いコードが出る場合は `rm -rf dist && pnpm build`。
- TypeScript の挙動が不安定なら `.tsbuildinfo` を削除。
- 環境変数を変えたら `pnpm dev` を再起動 (ts-node は自動リロードしません)。

## 認証と権限

### 認証の選択肢

1. **サービスアカウント キーファイル** – `GOOGLE_APPLICATION_CREDENTIALS` で JSON を指定する標準的な方法。
2. **環境変数** – `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` を直接渡す。シークレットマネージャーや CI に適しています。

### プロジェクト解決

- `GOOGLE_CLOUD_PROJECT` が設定されていればデフォルトのプロジェクトになります。
- 未設定の場合はサービスアカウントのメタデータから推測します。
- 各ツールは個別にプロジェクトやリソースパスを上書き可能です。

### 権限ガイドライン

- Viewer ロールを最小限で付与し、書込み系 (Spanner など) は必要なロールを別途追加。
- ログ/モニタリングはリージョン別エンドポイントを使う場合がありますが、サーバー側で吸収済みです。

## 構成とデプロイ

### 環境変数一覧

| 変数 | 目的 |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウント JSON キーのパス。 |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | キーファイルを使わない場合の代替認証。 |
| `GOOGLE_CLOUD_PROJECT` | 個別リクエストにプロジェクト ID がない場合のデフォルト。 |
| `DEBUG` | `true` で詳細ログを有効化。 |
| `LAZY_AUTH` | `true` (デフォルト) で初回リクエストまで認証を遅延。`false` で即座に初期化。 |
| `MCP_SERVER_PORT` | プロキシ/コンテナ配下でホストする際のポート指定。 |
| `MCP_ENABLED_SERVICES` | 有効化したいサービスをカンマ区切りで指定（例: `spanner,trace`）。未設定や `all` / `*` の場合は全サービス。 |
| `MCP_SERVER_MODE` | デフォルトの `daemon` はプロセスを常駐、`standalone` でクライアント切断時に終了。 |

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

- クライアントが対応していれば `lazyAuth` を有効化し、起動遅延を抑えます。
- コンテナでは認証情報ファイルを読み取り専用でマウントし、定期的にローテーション。
- Cloud Logging エクスポートや SIEM 連携と組み合わせ、チーム全体の可観測性を向上させます。

## ツール早見表

| サービス | ツール | 目的 |
| --- | --- | --- |
| Error Reporting | `gcp-error-reporting-list-groups` | 指定期間内のアクティブなエラーグループ。 |
| Error Reporting | `gcp-error-reporting-get-group-details` | グループのスタックトレース/発生状況確認。 |
| Error Reporting | `gcp-error-reporting-analyse-trends` | サービス/バージョン間のトレンド分析。 |
| Logging | `gcp-logging-query-logs` | 高度な Cloud Logging クエリ。 |
| Logging | `gcp-logging-query-time-range` | 時間範囲指定のクエリショートカット。 |
| Logging | `gcp-logging-search-comprehensive` | 複数フィールド横断検索。 |
| Logging | `gcp-logging-log-analytics-query` | Cloud Logging の Log Analytics SQL (`entries:queryData` / `readQueryResults`) を実行。 |
| BigQuery | `gcp-bigquery-list-datasets` | データセットのメタデータ (名前/ラベル/期限/リージョン) を一覧。 |
| BigQuery | `gcp-bigquery-list-tables` | データセット内のテーブル/ビューとパーティション/クラスタリングを可視化。 |
| BigQuery | `gcp-bigquery-get-table-schema` | テーブルのカラム名・型・モードとパーティション設定を取得。 |
| BigQuery | `gcp-bigquery-execute-query` | 読み取り専用 SQL を dry-run/パラメータ付きで実行。 |
| Monitoring | `gcp-monitoring-query-metrics` | フィルター結果を取得し PromQL 移行を補助。 |
| Monitoring | `gcp-monitoring-list-metric-types` | 利用可能なメトリクス記述子を列挙。 |
| Profiler | `gcp-profiler-list-profiles` | CPU/Heap/Wall-time プロファイル一覧。 |
| Profiler | `gcp-profiler-analyse-performance` | ホットスポットの要約。 |
| Profiler | `gcp-profiler-compare-trends` | リリース間の比較。 |
| Spanner | `gcp-spanner-list-instances` | インスタンス一覧。 |
| Spanner | `gcp-spanner-list-databases` | データベース一覧。 |
| Spanner | `gcp-spanner-list-tables` | テーブルスキーマ表示。 |
| Spanner | `gcp-spanner-execute-query` | パラメータ化された SQL を実行。 |
| Spanner | `gcp-spanner-query-count` | 行数を即座に集計。 |
| Spanner | `gcp-spanner-query-stats` | Query Insights を 1m/10m/1h JSON で要約。 |
| Spanner | `gcp-spanner-query-plan`  | EXPLAIN / EXPLAIN ANALYZE を実行し、分散 JOIN やインデックス不足を特定。 |
| Trace | `gcp-trace-list-traces` | 遅い/失敗トレースを一覧。 |
| Trace | `gcp-trace-get-trace` | トレース全体を取得。 |
| Trace | `gcp-trace-find-from-logs` | ログからトレースへピボット。 |
| Support | `gcp-support-list-cases` | 対象プロジェクトのケース一覧。 |
| Support | `gcp-support-search-cases` | フリーテキスト検索。 |
| Support | `gcp-support-get-case` | 単一ケース詳細。 |
| Support | `gcp-support-create-case` / `update-case` / `close-case` | ケースライフサイクル管理。 |
| Support | `gcp-support-list-comments` / `create-comment` | コメントの閲覧/投稿。 |
| Support | `gcp-support-search-classifications` | ケース分類 (製品/コンポーネント) の検索。 |

## 付録

### ドキュメントカタログとオフライン検索

- `google-cloud-docs-search` は `docs/catalog/google-cloud-docs.json`（`GOOGLE_CLOUD_DOCS_CATALOG` で差し替え可）をローカルで読み込み、完全オフラインで TF-IDF 検索します。クエリは2文字以上で、`maxResults` を省略した場合は `DOCS_SEARCH_PREVIEW_LIMIT`（デフォルト5、最大10）が返却件数を決めます。
- カタログに登録できる URL は Google 管轄のホストのみです。新しいドキュメントを取り込んだら `lastReviewed` を更新し、サーバー再起動（またはキャッシュクリア）で最新版を読み込ませてください。
- 同じカタログは MCP リソースとして `docs://google-cloud/...` でも公開されます。
  - `gcp-docs-catalog`（`docs://google-cloud/catalog`）: すべてのプロダクトと検証日時を俯瞰。
  - `gcp-docs-service`（`docs://google-cloud/{serviceId}`）: 単一プロダクトのドキュメント一覧。表示件数は `DOCS_CATALOG_PREVIEW_LIMIT`（デフォルト25、最大200）で制御します。
  - `gcp-docs-search`（`docs://google-cloud/search/{query}`）: カタログ内検索。結果件数は `DOCS_CATALOG_SEARCH_LIMIT`（デフォルト8）まで。
- 複数の JSON ファイル（例: `docs/catalog/cloud-run-ja.json`）を用意し、デプロイ単位で `GOOGLE_CLOUD_DOCS_CATALOG` を切り替える運用も可能です。

### 便利な gcloud コマンド

- `gcloud auth application-default login` – ADC を初期化。
- `gcloud projects list` – 現在のアイデンティティでアクセス可能なプロジェクトを確認。
- `gcloud logging read` – MCP 外でフィルターを検証したいときの補助。

### MCP 内での gcloud 読み取り専用ツール

`gcloud-run-read-command` は [googleapis/gcloud-mcp](https://github.com/googleapis/gcloud-mcp) と同様に gcloud CLI をラップしつつ、さらに厳格なガードレールで「読むだけ」の操作に限定します。

1. gcloud 側で **サービス アカウント** をアクティブ化するか、`gcloud config set auth/impersonate_service_account <sa>` のように代理実行を設定します。ユーザー アカウントは即拒否されます。
2. ツール入力にはトークン配列（例: `["gcloud","projects","list","--format=json"]`）を渡します。先頭の `gcloud` は省略可能です。
3. サーバーはコマンドを lint→ポリシー判定→実行の順に処理し、STDOUT/STDERR をそのまま返します。どこかで違反すると実行前にブロックされます。

ガードレールの概要:

- **読み取り動詞のみ** – `list`／`describe`／`get`／`read`／`tail`／`check`／`status` などで終わるコマンドだけ許可。
- **変更操作のキーワードを拒否** – `create`／`delete`／`update`／`set`／`enable`／`disable`／`import`／`export`／`attach`／`detach`／`deploy` などが引数に含まれると即失敗。
- **機密 API を遮断** – IAM・Secret Manager・KMS・Access Context Manager へのアクセスは読み取り目的でも拒否。
- **SSH / interactive 無効化** – `ssh`／`interactive`／トンネル／シリアルポート接続などは常に不許可。
- **サービス アカウント強制** – `.gserviceaccount.com` で終わるプリンシパルに限定。`--impersonate-service-account=` を利用する場合も同じ。

*入力例*

- `["gcloud","projects","list","--format=json"]`
- `["gcloud","logging","sinks","list","--project=my-prod-project"]`
- `["gcloud","monitoring","channels","describe","projects/my-proj/notificationChannels/123"]`

*ブロック例*

- `["gcloud","secret-manager","secrets","describe", ...]` – Secret Manager 系は常に拒否。
- `["gcloud","compute","instances","delete", ...]` – `delete` などの動詞が含まれる。
- `["gcloud","compute","ssh", ...]` – SSH/interactive 系コマンドは禁止。

### 参考リンク

- [Google Cloud Error Reporting ドキュメント](https://cloud.google.com/error-reporting/docs)
- [Cloud Logging クエリ言語リファレンス](https://cloud.google.com/logging/docs/view/logging-query-language)
- [Cloud Monitoring ガイド](https://cloud.google.com/monitoring)
- [Cloud Profiler Overview](https://cloud.google.com/profiler)
- [BigQuery SQL リファレンス](https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax)
- [Cloud Spanner SQL リファレンス](https://cloud.google.com/spanner/docs/reference/standard-sql)
- [Cloud Trace ドキュメント](https://cloud.google.com/trace/docs)
- [Cloud Support API リファレンス](https://cloud.google.com/support/docs/reference/rest)
