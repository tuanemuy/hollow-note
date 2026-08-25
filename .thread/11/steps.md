# 実装手順 — Issue #11

本 Issue は spec-slice ファストパスで計画している。**設計は新規に導出せず、spec の該当箇所を正典として参照する**。spec が持たない実装詳細（列名の最終形、SQL の書き方、エラー分岐の内側）は実装フェーズがコードと spec を読んで決める。決めた結果が spec の持ち分（境界・用語・ルール・契約）を変える場合だけ adr.md に記録し、`spec/` を改訂する（AC-9）。

## 実装対象ポートの総数

**35 ポート実装。** 内訳は下表。数え方は `packages/core/src/adapters/conformance/backend.ts` の `ConformanceBackend`（global 面 21 メンバー + 2 UoW provider）と `ScopedConformancePorts`（12 メンバー）。1 行 = 1 ポート実装であって 1 ポートメソッドではない（メソッド粒度の台帳は `spec/inventory/adapter.md`）。

| 面 | 数 | ポート |
| --- | --- | --- |
| Global D1 | 19 | `GlobalUnitOfWorkProvider`, `UserRepository`, `IdentityRepository`, `SessionRepository`, `AuthTokenRepository`, `IdentityUniqueDirectory`, `IdentityRemovalReceiptStore`, `DistributedOperationStore`, `UserBatchReader`, `LoginAttemptStore`, `OAuthStateStore`, `IdempotencyStore`, `OutboxRepository`, `NoteRouteStore`, `NoteRouteFanOutReader`, `AccountDeletionManifestStore`, `GlobalMaintenanceRunStore`, `PublicNoteProjectionWriter`, `PublicNoteQueryService` |
| Scope Durable Object | 13 | `ScopeUnitOfWorkProvider`, `NoteRepository`, `NoteRevisionRepository`, `ScopeCleanupAdmissionStore`, `LocalNoteProjectionWriter`, `NoteProjectionSnapshotReader`, `NoteProjectionRevisionStore`, `LocalNoteQueryService`, `ScopeTaskScheduler`, `AppliedOperationStore`, `StorageQuotaRepository`, `LlmUsageRepository`, `StoredFileRepository` |
| D1 + DO 横断 | 2 | `ScopeRouter`（`note_routes` 解決 + DO stub の受け渡し）, `ScopeTaskQueue`（全 scope 横断の due 読み） |
| R2 | 1 | `ObjectStorage` |

`spec/database/index.md` が定める Workspace / Tag / Job / Integration の表は、対応するポートがコードに存在しないため本 Issue の対象外（plan.md「スコープ / 含まれないもの」）。

## 設計

### ドメインモデルへの影響

**なし。** アダプター層の追加であり、依存方向は内向き。`packages/core/src/domain/` は 1 行も触らない前提で進める。触る必要が生じた場合（適合スイートが要求する振る舞いをドメイン側の型が表現できない等）は、着手前に adr.md へ理由を書く。

### ユースケース / アプリケーションロジック

**原則なし。** ポート定義（`packages/core/src/application/ports/` と `packages/core/src/domain/*/ports/`）と `packages/core/src/application/execution/unitOfWork.ts` が契約の正本であり、実装側の都合で契約を変えない（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）。

例外は 2 つで、いずれも Issue のコメントが決着を明示的に依頼しているもの。

- `ScopeTaskScheduler` の settle に fencing token を足すかどうか（Issue コメント2 / AC-6）。足すならポート定義・JSDoc・適合スイート・`spec/domains/` の 4 つを同時に触る（[ADR 052](../../spec/adr/052-adapter-inventory-granularity.md) の通り台帳 `spec/inventory/adapter.md` にも新メソッド行が要る）。
- `spec/platform/index.md` の実行予算行の改訂（Issue コメント1 / AC-5）。こちらはテストケース表（バックエンド非依存の契約）を動かさない。

`packages/core/src/application/di/types.ts` はランタイム非依存で memory への依存を持たない（確認済み）ので、コンテナ型の変更は不要。`di/env.ts` の `TuningEnv` も両ランタイム共用として書かれており再利用する。

### アダプター / 永続化 / 外部連携

新規ディレクトリ `packages/core/src/adapters/cloudflare/` に置く。既存の `memory/` は参照バックエンドとして無変更で残す（[ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md) / [ADR 025](../../spec/adr/025-single-reference-runtime.md)、AC-7）。定義場所は次の通り。

| 決めること | 正典 |
| --- | --- |
| global / scope のデータ配置、どの表がどちらの面か | `spec/database/index.md` の「物理配置」表（`:22-33`） |
| 共通の規約（ID / 時刻 / 真偽値 / 列挙 / 楽観ロック / 外部キー / 正規化 / 行サイズ / bound 変数 / 原子性 / scope 検証） | `spec/database/index.md` の「共通の規約」（`:7-20`） |
| 各表の列・制約・索引 | `spec/database/index.md` の各表の節 |
| ScopeKey → Durable Object の名前 | `spec/platform/index.md`「ScopeKey と Durable Object」＝ `user:{userId}` / `workspace:{workspaceId}`。コード上の正本は `packages/core/src/application/scope.ts` の `ScopeKey.serialize` |
| routing（note_routes / routeVersion / primary 読み） | `spec/platform/index.md`「routing」、[ADR 021](../../spec/adr/021-scope-sharded-data-plane.md) |
| 実上限（1 行 2,000,000 バイト / SQL 文 100,000 / bound 100 / DO alarm 15 分 / D1 1,000 query） | `spec/platform/index.md`「実上限」 |
| 実行予算と分割単位（1 turn 100 行・CPU 2 秒、各経路の 1 回の上限） | `spec/platform/index.md`「実行予算と分割単位」 |
| Scope Alarm の起床規則・priority・WRR・SLO・リース期間の決め方 | `spec/platform/index.md`「Alarm と Cron」→「Scope Alarm」 |
| `scheduled_tasks` の列・状態・再 claim 条件・3 本の部分索引 | `spec/database/index.md#scheduled_tasks` |
| 全文検索（contentless FTS5 / bigram 前処理 / クエリ構築 / ハイライト / 再構築 / 既知の限界） | `spec/database/index.md` の `note_search` / `note_search_tags` / `note_search_fts` 節、[ADR 011](../../spec/adr/011-bigram-search.md)、[ADR 017](../../spec/adr/017-content-size-budget.md) |
| public 投影の世代ベクトル条件付き書き込み | `spec/database/index.md#public_note_search--public_note_search_tags--public_note_search_fts`、[ADR 027](../../spec/adr/027-projection-revision-numbering.md) |
| 各ポートの契約本文 | 各ポート定義ファイルの JSDoc（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）。実行形は `packages/core/src/adapters/conformance/` |
| 各ポートメソッドの台帳 | `spec/inventory/adapter.md`（ADP-*） |

spec が明示していない実装詳細で、実装フェーズが決めてよいもの: 物理列名の最終形、SQL 文の書き方、`_occ_guard` の列と使い方、write-set の内部表現、cursor のエンコード実装、DO の RPC メソッド名。このうち `_occ_guard` は `spec/database/index.md` に節が無いので、決めたら節を足す（AC-9）。

### UI / プレゼンテーション

**なし。** 画面・ルート・server function に影響しない。デザインゲートは対象外。

---

## 実装ステップ

依存順。ステップ 1–4 は直列（後続すべての土台）。ステップ 5–10 は互いに独立で、**並列委譲できる束**として切ってある。ステップ 11 以降は再び直列。

### 1. テストハーネスの足場（`@cloudflare/vitest-plugin` + wrangler + projects 分割）

- **対象ファイル:** `/Users/hikaru/github.com/tuanemuy/hollow/vitest.config.ts`（書き換え）、`/Users/hikaru/github.com/tuanemuy/hollow/package.json`（scripts）、`/Users/hikaru/github.com/tuanemuy/hollow/packages/core/package.json`（devDependencies）、`/Users/hikaru/github.com/tuanemuy/hollow/packages/core/wrangler.test.jsonc`（新規）、`/Users/hikaru/github.com/tuanemuy/hollow/packages/core/tsconfig.cloudflare.json`（新規）、`/Users/hikaru/github.com/tuanemuy/hollow/packages/core/src/adapters/cloudflare/__tests__/worker.ts`（新規・テスト用 worker entry）
- **変更内容:**
  - `@cloudflare/vitest-plugin@1.0.0` と `wrangler@^4.125` を `@repo/core` の devDependency に足す（`@cloudflare/vitest-pool-workers` は使わない。後継が `@cloudflare/vitest-plugin` で、peer は `vitest ^4.1.0` / `@vitest/runner ^4.1.0` / `@vitest/snapshot ^4.1.0`。本リポジトリの vitest 4.1.10 と互換なのは実測済み）。
  - root `vitest.config.ts` を `test.projects` の 2 プロジェクト構成にする。`node` プロジェクトは現行設定（`environment: "node"`, `globals: true`, `resolve.tsconfigPaths`, `env: { TZ: "Asia/Tokyo" }`, `testTimeout: 10_000`）をそのまま持ち、`include` を既存のテスト位置に、`exclude` に `packages/core/src/adapters/cloudflare/**` を足す。`workers` プロジェクトは `plugins: [cloudflareTest({ wrangler: { configPath: ... }, miniflare: { bindings: { MIGRATIONS: ... } } })]` を持ち、`include` を `packages/core/src/adapters/cloudflare/**/__tests__/**/*.test.ts` に限る。両者の集合は交わらない。
  - `wrangler.test.jsonc` に D1 / R2 / DO バインディングを宣言する。DO は **SQLite-backed**（`migrations[].new_sqlite_classes`）にする — `spec/database/index.md` が scope DO を SQL schema として定めており、`ctx.storage.sql` が要る（miniflare 上で動作することは実測済み）。`compatibility_flags` に `nodejs_compat` を入れる（`node:crypto` の scrypt / `node:async_hooks` の `AsyncLocalStorage` が動くことは実測済み）。
  - `packages/core/tsconfig.cloudflare.json` を追加し、CF アダプターディレクトリだけに `types: ["@cloudflare/vitest-plugin/types"]` を効かせる。既存 3 つの tsconfig は `types: ["node"]` のまま触らない。`pnpm typecheck` がこの 4 つ目も見るように `@repo/core` の `typecheck` script を調整する。
- **理由:** 実バインディングに対して適合スイートを走らせる（AC-3）ための前提。**このステップ単体で `pnpm test` が既存 76 ファイル・978 件緑のまま**であることを確認してから次へ進む（AC-7）。CF アダプターがまだ無い段階では `workers` プロジェクトは 0 ファイルにマッチする no-op になる。

### 2. 二平面 Unit of Work の実行機構（write-set + 原子適用）

- **対象ファイル:** `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `.../execution/globalUnitOfWork.ts`, `.../execution/scopeUnitOfWork.ts`, `.../execution/nesting.ts`（すべて新規）
- **変更内容:** `GlobalUnitOfWorkProvider` / `ScopeUnitOfWorkProvider`（契約は `packages/core/src/application/execution/unitOfWork.ts` の JSDoc）を、ステージした write-set の原子適用として実装する。D1 は `db.batch()`、DO は `ctx.storage.transactionSync`。read-your-writes のためのオーバーレイ、OCC 違反の検出、`collectEvents` の outbox flush（コミットと同一原子単位）、コミット後にだけ撃つ `RelayTrigger.kick` / `ScopeTaskTrigger.kick`、平面をまたぐものを含む `run` の入れ子禁止の検出（`AsyncLocalStorage`）まで含む。設計判断は adr.md ADR-001 / ADR-002。
- **理由:** 全リポジトリ実装がこの上に乗るので、束の並列委譲より前に単独で確定させる必要がある。判定材料は `packages/core/src/adapters/conformance/unitOfWork.ts`（232 行）— このスイートだけを先に緑にすることを本ステップの出口条件にする。`spec/database/index.md:19`「global D1 の非集約更新は単一 SQL 文、scope 内の複数更新は `transactionSync`。D1 と scope DO、または 2 つの scope DO を 1 transaction に含めない」が原典。

### 3. Global D1 のスキーマと migration

- **対象ファイル:** `packages/core/src/adapters/cloudflare/d1/migrations/0001_*.sql`（以降連番）、`.../d1/schema.ts`（新規）
- **変更内容:** `spec/database/index.md` の「物理配置」表のうち**今日ポートがある表**の DDL を書く。Identity 群（`users` / `identities` / `identity_removal_receipts` / `sessions` / `auth_tokens` / `login_attempts` / `oauth_flow_states`）、directory / operation 群（`identity_unique_reservations` / `note_routes` / `distributed_operations` / `account_deletion_manifests` — header と items / `global_maintenance_runs` — run と lane）、projection 群（`public_note_search` / `public_note_search_tags` / `public_note_search_fts`）、infrastructure 群（`outbox_events` / `processed_events` / `_occ_guard`）、および ADR-003 で決める scope task due index。列名・制約・索引は各表の節を正本にし、節が無い `_occ_guard` と due index は本 Issue で定めて spec へ足す。
- **理由:** チェックリスト「Global D1 の制御表・読み取りモデル・migration を実装する」。migration は `.sql` ファイル群として持ち、テストでは `readD1Migrations()` + `applyD1Migrations()` で適用する（実測で動作確認済み）。`membership_directory` / `workspace_slug_reservations` / `invitation_routes` / `job_slots` / `workspace_directory` / `job_history*` は対応ポートが無いのでこの Issue では作らない。

### 4. Scope Durable Object のスキーマ・DO クラス・alarm・transaction 境界

- **対象ファイル:** `packages/core/src/adapters/cloudflare/do/scopeObject.ts`（DO クラス）、`.../do/migrations/*.sql`、`.../do/schema.ts`、`.../do/alarm.ts`（すべて新規）
- **変更内容:**
  - DO クラスの生成と初期化。`ScopeKey.serialize` から得た名前で `idFromName` する（`spec/platform/index.md`「ScopeKey と Durable Object」）。初回起動時に `ctx.storage.sql` へ scope 側の schema を適用し、以降は migration version で追随する（`spec/database/index.md:3`「両者の SQL schema は同じ migration version を共有するが、配置する表は異なる」）。
  - scope 表の DDL: `notes` / `note_projection_revisions` / `note_revisions` / `stored_files` / `storage_quotas` / `llm_usages`、local projection の `note_search` / `note_search_tags` / `note_search_fts`、infrastructure の `outbox_events` / `processed_events` / `_occ_guard` / `scheduled_tasks` / `applied_operations`。`scheduled_tasks` は `spec/database/index.md#scheduled_tasks` の列・CHECK・**3 本の部分索引**をそのまま持つ。
  - `alarm()` ハンドラ: 起床時刻は「pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方」（`spec/platform/index.md`「Scope Alarm」）。1 turn は priority 0/1/2/3 の weighted round-robin で各 priority へ最低 1 枠、合計 100 行または CPU 2 秒で yield、budget を超えて claim しない、ハンドラを持たない kind の行は訪問しても settle せずリース満了まで `running` のまま待つ。最後に次の起床時刻を `setAlarm()`、task が無ければ alarm を消す。
  - transaction 境界: DO 側の write-set 適用（ステップ 2）を DO 内で実行する RPC 面を用意する。`blockConcurrencyWhile` / `transactionSync` の中で external I/O を待たない（`spec/platform/index.md`「外部要求」）。
- **理由:** チェックリスト「Scope Durable Objects の永続化・alarm・transaction 境界を実装する」。alarm 本体の周回ロジックは `packages/core/src/application/workers/scopeTaskRunner.ts` のランタイム非依存部分と重複しないよう、既存関数を呼ぶ形にできるかを最初に確認すること。

### 5.〔並列可〕D1 Identity 群（8 ポート）

- **対象ファイル:** `packages/core/src/adapters/cloudflare/d1/repositories/{userRepository,identityRepository,sessionRepository,authTokenRepository,userBatchReader,identityRemovalReceiptStore,loginAttemptStore,oauthStateStore}.ts`
- **変更内容:** 対応する memory 実装（`adapters/memory/repositories/`）と同じポートを D1 で実装する。`UserRepository` は `version` 列の OCC（`spec/database/index.md:13`）。`SessionRepository.findByTokenHash(userId, tokenHash)` は `(user_id, token_hash)` の索引で引く（memory は全走査）。`LoginAttemptStore.recordFailure` は原子的カウンタ、`OAuthStateStore.take` は「束縛一致のときだけ原子的に取得・削除」（ADP-common-037）。期限切れ掃引（`deleteExpired`）はテーブルキーの keyset で、`expiresAt <= now` は順序ではなくフィルタ。`UserBatchReader.resolveMany` は最大 100 件だが `?` を並べず JSON + `json_each`。
- **理由:** 適合スイート `userRepository` / `identityRepository` / `sessionRepository` / `authTokenRepository` / `userBatchReader` / `identityRemovalReceiptStore` / `loginAttemptStore` / `oauthStateStore` の 8 本（計 876 行）を通す。`spec/database/index.md` の `users` / `identities` / `sessions` / `auth_tokens` / `login_attempts` / `oauth_flow_states` 節が正典。

### 6.〔並列可〕D1 directory / operation 群（4 ポート）

- **対象ファイル:** `packages/core/src/adapters/cloudflare/d1/repositories/{identityUniqueDirectory,distributedOperationStore,accountDeletionManifestStore,globalMaintenanceRunStore}.ts`
- **変更内容:** 本 Issue で最も条件付き更新が集中する束。`IdentityUniqueDirectory` は reserve の 3 分岐 CAS と、ディレクトリ行ではなく `users.version` を検査する `activate` の all-or-nothing（[ADR 048](../../spec/adr/048-uniqueness-reservation-operation-id.md) / [ADR 054](../../spec/adr/054-provider-account-uniqueness-owner.md) / [ADR 060](../../spec/adr/060-conditional-unique-claim-teardown.md)）。`DistributedOperationStore.beginOrResume` は `UNIQUE(partition_key) WHERE state NOT IN ('completed','rejected')` の部分ユニーク索引。`AccountDeletionManifestStore` は header + items の 2 表、`(operation_id, key)` 複合 PK、2 本の build cursor、phase 別 ack、`pruneTerminal` の keyset（[ADR 039](../../spec/adr/039-cleanup-participants-declaration.md) / [ADR 053](../../spec/adr/053-account-deletion-rollback-completion.md)）。`GlobalMaintenanceRunStore` は lane の lease / reclaim / checkpoint / advanceOrAck と、`commandKeyOf` のバイト一致（[ADR 061](../../spec/adr/061-maintenance-sweep-order-authority.md) / [ADR 062](../../spec/adr/062-unknown-sweep-table-skip.md)）。`setMaintenanceTables` が本当に効くこと（`conformance/backend.ts:148-151` が要求）。
- **理由:** 適合スイート 4 本で 1,945 行（`globalMaintenanceRunStore` 690 / `accountDeletionManifestStore` 573 / `identityUniqueDirectory` 468 / `distributedOperationStore` 214）。`spec/database/index.md` の `identity_unique_reservations` / `distributed_operations` / `account_deletion_manifests` / `global_maintenance_runs` 節が正典。

### 7.〔並列可〕D1 route / infrastructure / 横断群（6 ポート）

- **対象ファイル:** `packages/core/src/adapters/cloudflare/d1/repositories/{noteRouteStore,noteRouteFanOutReader,outboxRepository,idempotencyStore}.ts`, `.../scopeRouter.ts`, `.../scopeTaskQueue.ts`, `.../cursor.ts`
- **変更内容:** `NoteRouteStore` は 5 状態（`reserved`/`active`/`moving`/`purging`/`tombstone`）の状態機械と `routeVersion` の CAS、`lastMigrationId` による lost-response 再試行と stale 要求の区別、`readableRow` の読み取りフィルタ、`resolveMany` 最大 500 件（**必ず JSON + `json_each`**。`?` 500 個は D1 の bound parameter 上限 100 を超える）。`NoteRouteFanOutReader` は opaque cursor の keyset（`MAX_LIMIT=200`）。`OutboxRepository` は `claimPending` の lease と `save` の id 衝突 no-op（[ADR 042](../../spec/adr/042-outbox-save-id-collision.md)）。`IdempotencyStore.markProcessed` は本処理と同一 transaction での原子記録（`spec/domains/index.md:266`）。`ScopeRouter` は `forScope` で DO stub を載せた `ScopeHandle` を返し、`resolveNote` は `note_routes` を primary で引く。`ScopeTaskQueue.listDue` は ADR-003 の due index 表を読む。`cursor.ts` は memory の `Buffer` 依存を持ち込まない形で書く（cursor は backend 内で閉じた不透明値なので memory 版との互換は不要）。
- **理由:** 適合スイート `noteRouteStore`（296）/ `noteRouteFanOutReader`（164）/ `outboxRepository`（163）/ `idempotencyStore`（45）/ `scopeRouter`（64）と、`scopeTaskScheduler`（700）のうち `listDue` を観測する部分。`spec/platform/index.md`「routing」と `spec/database/index.md#note_routes` が正典。

### 8.〔並列可〕Scope DO business 群（6 ポート）

- **対象ファイル:** `packages/core/src/adapters/cloudflare/do/repositories/{noteRepository,noteRevisionRepository,storedFileRepository,storageQuotaRepository,llmUsageRepository,appliedOperationStore}.ts`
- **変更内容:** `version` 列の OCC（`NoteRepository` / `StoredFileRepository`）と複合キー OCC（`StorageQuotaRepository` は subject、`LlmUsageRepository` は `(userId, period)`）。`listByOwner` 系は `PaginationResult { items, count }` を返す契約なので `COUNT(*)` が要る。`StoredFileRepository.deleteFilesByOwner` は AC-5 の実測対象 — 列挙 1 ＋ 多行 DELETE 1 ＋ 多行 outbox INSERT 1 の 3 文で OCC を保ったまま書けるかをここで確かめ、書けなければ実測値を記録して `spec/platform/index.md` の実行予算行を改める（`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例しない」は動かさない。[ADR 056](../../spec/adr/056-performance-budget-placement.md)）。`AppliedOperationStore.markApplied` は `(operationId, commandKey)` を 1 列へ畳む（`spec/database/index.md:35`）。scope 検証（`owner_type` / `owner_id` が object 自身の ScopeKey と一致すること）を復元・保存の両方で検査する（`spec/database/index.md:20`）。
- **理由:** 適合スイート `storedFileRepository`（241）/ `noteRepository`（174）/ `storageQuotaRepository`（105）/ `noteRevisionRepository`（94）/ `llmUsageRepository`（93）/ `appliedOperationStore`（75）。

### 9.〔並列可〕Scope DO infrastructure 群（2 ポート）+ fencing の決着

- **対象ファイル:** `packages/core/src/adapters/cloudflare/do/repositories/{scopeTaskScheduler,scopeCleanupAdmissionStore}.ts`
- **変更内容:** `ScopeTaskScheduler` は `spec/database/index.md#scheduled_tasks` の列・状態・再 claim 条件（`status='pending' AND due_at<=now` または `status='running' AND lease_expires_at<=now`）・claim が `due_at`/`attempts`/`priority`/`payload` を書き換えないこと・priority ごとの枠取りを、dequeue 用 1 本の部分索引の走査に述語を掛ける形で実装する。settle（`complete`/`backoff`/`schedule`）は現契約では行キー `(kind, operationId)` のみで撃たれる — **AC-6 の fencing 決着をここで行う**。`ScopeCleanupAdmissionStore` は scope 全体の書き込みバリア（`assertWritable` / `assertActorWritable` / personal barrier の開始・中断・所有権検査・component ack・完了化・回収）。[ADR 039](../../spec/adr/039-cleanup-participants-declaration.md) の「必須集合は配備の宣言から導出する」を守り、宣言し忘れが早期完了ではなく stall になる安全側の既定にする。
- **理由:** 適合スイート `scopeTaskScheduler`（700 — 全スイート中最大）/ `scopeCleanupAdmissionStore`（200）。Issue コメント2 が指定した決着点。#19 で契約・適合スイート・memory・`spec/database` / `spec/platform` は改訂済みなので、そこを前提にする。

### 10.〔並列可〕投影と全文検索（5 ポート）+ R2（1 ポート）

- **対象ファイル:** `packages/core/src/adapters/cloudflare/do/repositories/{noteProjection,localNoteQueryService}.ts`, `.../d1/repositories/{publicNoteProjection,publicNoteQueryService}.ts`, `.../search/bigram.ts`, `.../r2/objectStorage.ts`
- **変更内容:**
  - bigram 前処理（NFKC 正規化 → 小文字化 → CJK run 分割 → 重なりビグラム）を**書き込み側とクエリ側で共有する単一の純関数**として置く（`spec/database/index.md#bigram-前処理`、[ADR 011](../../spec/adr/011-bigram-search.md)）。
  - contentless FTS5(unicode61) 表を local（`note_search_fts`）と public（`public_note_search_fts`）の両方に作り、完全 snapshot writer（`LocalNoteProjectionWriter` / `PublicNoteProjectionWriter`）が本体・タグ・FTS・表示 context を 1 transaction で書く唯一の書き手になる。`bm25` の列重みとクエリ構築、ハイライト / 抜粋の生成、再構築、既知の限界はいずれも `spec/database/index.md` の該当節が正典。
  - `NoteProjectionRevisionStore.bump` は revision を運ぶイベントを書く transaction と同一（[ADR 027](../../spec/adr/027-projection-revision-numbering.md)）。public 側は route・Note/tag・author・workspace の世代ベクトル条件付き書き込み（`replaceSnapshotIfNewer`）で、`written` / `stale` / `incomparable` の判定を SQL の述語に落とす。
  - `ObjectStorage` は R2 バケットで実装する。`put` はバイト列から実測した size / checksum を返す（sha256 は `crypto.subtle.digest`。memory 版の `node:crypto` は持ち込まない）。`deleteMany` は不在を許容。`publicUrl` は「配備の URL の形をアダプターに閉じる」契約で、R2 の public domain を設定から受ける（[ADR 049](../../spec/adr/049-object-storage-public-url.md)）。R2 は UoW の外にあり、`put` は記録の transaction より前、`deleteMany` は行が消えた後の subscriber。
- **理由:** チェックリスト「R2 の保管ファイル・生成物アダプターを実装する」と読み取りモデル。適合スイート `noteProjection`（279）/ `localNoteQueryService`（201）/ `publicNoteQueryService`（116）/ `objectStorage`（100）。**memory は FTS を持たず素朴な部分一致で通している**ので、FTS 版が落とすケースが出たら [ADR 046](../../spec/adr/046-port-contract-divergence.md) に従って倒す向きを決め、スイートを直すなら memory も同じスイートを通ること（AC-8）。

### 11. 適合バックエンド factory と 30 スイートの全件通し

- **対象ファイル:** `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `.../__tests__/conformance.test.ts`（ともに新規）
- **変更内容:** `MakeConformanceBackend`（`conformance/backend.ts:154`）を実装し、`conformance.test.ts` を `adapters/memory/__tests__/conformance.test.ts` と同型に置いて同じ 30 の `describeXxxContract` を呼ぶ。**スイート本体は 1 行も変更しない。** factory 呼び出しごとの名前空間分離（ADR-004）、`relayKickCount` を数える `RelayTrigger` の配線、`ConformanceBackendOptions` の 4 項目（`maintenanceShardIds` / `maintenanceTablesByKind` / `requiredCleanupComponents` / `requiredFinalizeReceipts`）の受け渡し、`forScope(scope)` が返す 12 ポートの組み立て、`seedMembershipEdges`、そして**本当に効く**`setMaintenanceTables` を用意する。
- **理由:** チェックリスト「D1・Durable Objects・R2 の全アダプターで共有ポート適合テストを通す」＝ AC-2。チェックリスト 1 行目「domain ポート契約から共有ポート適合テストを作成する」は `packages/core/src/adapters/conformance/` として**既に存在する**（30 スイート・6,885 行、`spec/inventory/adapter.md` の ADP 行と対応）ので、本 Issue で実質やるのは「その既存スイートを Cloudflare backend で全件通す」ことであり、新規作成ではない。契約の穴が見つかったときだけスイートにケースを足す（AC-8）。

### 12. 統合テストと 2 つの決着の記録

- **対象ファイル:** `packages/core/src/adapters/cloudflare/__tests__/{unitOfWork,durability,alarm,r2}.test.ts` 等（バックエンド固有テスト）
- **変更内容:** plan.md「テスト方針」の統合テスト項目（AC-4）を書く。あわせて AC-5（`deleteFilesByOwner` の SQL 文数の実測）と AC-6（fencing の要否）の結論を確定させ、adr.md へ記録する。AC-5 で「3 文」が満たせなければ `spec/platform/index.md` の `### Scope DO` の当該行を実測値へ改める。AC-6 で claim token を契約へ足す判断になれば、ポート定義・JSDoc・適合スイート・`spec/domains/`・`spec/inventory/adapter.md` を同時に更新し、memory 実装も追随させる。
- **理由:** Issue 本文「検証」の 2 行目と、2 つのコメントが名指しで依頼した確認。

### 13. DI ランタイム合成と spec / docs の追随

- **対象ファイル:** `packages/core/src/application/di/cloudflareRuntime.ts`（新規）、`spec/database/index.md`、`spec/platform/index.md`、`docs/test.md`、`spec/adr/`（必要なら新 ADR）、`spec/inventory/adapter.md`（必要なら）
- **変更内容:**
  - `memoryRuntime.ts` と同階層に `cloudflareRuntime.ts` を置き、`di/types.ts` の `RequestContainer` / `WorkerContainer` を Cloudflare バインディングから組み立てる。`types.ts` はランタイム非依存なので変更しない。`env.ts` の `TuningEnv` はそのまま共用する。`MemoryRuntime` 型に相当する共通インターフェイス（`bindRelayTrigger` / `bindScopeTaskTrigger` / `createRequestContainer` / `createWorkerContainer` の 4 メソッド）が未抽出なので、抽出するか CF 版を別型として定義するかを決める。**`serverNode.ts` と `memoryRuntime.ts` は触らない**（AC-7）。
  - spec の追随: `_occ_guard` の節、scope task due index の表（ADR-003）、AC-5 の結果による実行予算行、AC-6 の結果による `scheduled_tasks` / ポート契約。
  - `docs/test.md` の追随: 冒頭の「a real backend (D1 / Durable Objects, Issue #11) arrives」「its own integration config」、`:26` の「deferred to the real-backend integration run of Issue #11」、Commands 表に `--project` の使い分けを足す。`CLAUDE.md` の「Reference runtime」節が Node + in-memory を単一の参照ランタイムと書いている点は [ADR 025](../../spec/adr/025-single-reference-runtime.md) がそのまま有効（本 Issue は配備一式を含まない）ので変えない。
  - `adapters/memory/` に同居している暗号 / Intl アダプターの分離（[ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md) が言う再検討）は本 Issue のスコープ外だが、2 つ目のバックエンドが実在するようになったので**別 Issue として起票**する。
- **理由:** アダプターを配線可能な形で閉じ、spec を実装の正本に保つ（AC-9）。Worker entry・wrangler 本番設定・Queue consumer は plan.md のスコープ外。
