### Routing / outbox / scope インフラ

#### Blockers

なし

#### Warnings

- **[W-001]** due index の drift のうち「行が載らなかった側」に自己修復経路が無く、既定配備では spec の記述が成り立たない
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:127-141`（`armAndPublish`）、`packages/core/src/adapters/cloudflare/do/dueIndex.ts:24-33`（JSDoc）、`spec/database/index.md:1089`
  - 理由: ADR-060 の決定どおり `publishDueIndex` の失敗は `Logger.warn` に落ちる。その正当化は「両者が互いの保険だから — 武装できた object は次の turn で index を書き直し、index にだけ載った scope へは中央 runner が到達できる」だが、**ADR-045 で既定配備（ハンドラレジストリが空）は `rescheduleAlarm` が `deleteAlarm` になる**ため、前半の保険は既定配備では存在しない。したがって「scope 側 commit は成功、publish は失敗」で残るのは *index に載らなかった行*であり、これは中央 runner から**永久に見えない**。次に同じ scope の `scheduled_tasks` を名指す write-set が commit されるまで回復せず、継続要求はその 1 本だけで駆動されるので、実質「次が無い」。plan.md が挙げた最悪ケース（personal cleanup の継続が止まり `accountDeletionBarrier` が開いたまま User が `deleting` で残る）にそのまま乗る。
    `dueIndex.ts` の JSDoc は「absorbed by the central runner, since a stale row costs at most one failed claim」と書くが、これは**余分な行**にしか当てはまらない。`spec/database/index.md:1089` の「commit と索引更新のあいだで落ちた場合の drift は、当該 scope の Alarm が自分の `scheduled_tasks` を正として書き直して治す」も、同じ PR の ADR-045 が既定配備でその Alarm を消したことで成り立たなくなっている（この 2 文は本 PR で新規に追加された記述なので、既存の穴ではなく本 PR の内部矛盾）。
    `__tests__/alarm.test.ts:454`（"keeps a committed write-set when the due index publish fails"）が観測しているのも「次の `seed` で治る」ことだけで、`seed` を呼ばない場合の残存は観測していない。
  - 提案: どちらかに倒す。(a) canon と JSDoc を実態へ合わせる — `spec/database/index.md#scope_task_due_index` の drift 節に「レジストリが空の配備では Alarm による治癒が働かないので、publish 失敗は次に同じ scope の `scheduled_tasks` を触る commit まで残る」を明記し、`dueIndex.ts` / ADR-060 の「互いの保険」の記述を「余分な行のみ吸収できる」に限定する。(b) 経路を足す — `publishDueIndex` が失敗したときだけレジストリの有無にかかわらず `setAlarm` して、次の turn（レジストリが空でも `armAndPublish` は通る）に再 publish させる。少なくとも (a) は AC-9 の持ち分として本 PR 内で閉じられる。

- **[W-002]** `scopeTaskRunner` が `claimDue` の**あらゆる** `ConflictError` を「claim を競り負けた」と解釈して scope を黙って飛ばす
  - 場所: `packages/core/src/application/workers/scopeTaskRunner.ts:170-179`
  - 理由: ポート JSDoc（`application/ports/scopeTaskScheduler.ts` の Error contract、本 PR で追記）が `claimDue` に許した追加の失敗は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` **1 コードだけ**である。実装は `isConflictError(cause)`（= `instanceof ConflictError`）で受けており、コードを見ていない。今日は `execution/scopeUnitOfWork.ts` → `throwTranslated` が occGuard 以外を `SystemError` にするので他コードは到達しないが、到達したときの挙動が「`[scope-tasks] claim lost the race; leaving the scope to its winner` と嘘のログを出して `continue`」になる。その scope は毎ラウンド同じ理由で飛ばされ続け、継続の鎖が warn 1 行だけで無言停止する — これは本リポジトリが最も避けたい失敗モードそのもの。`ConflictError` は `code` を持つので、判定を狭めるコストはほぼゼロ。
  - 提案: `isConflictError(cause) && cause.code === "OPTIMISTIC_LOCK_FAILURE"` に絞り、それ以外は再 throw する。テスト（`__tests__/scopeTaskRunner.test.ts:317` の `withLostClaim`）は既に `OPTIMISTIC_LOCK_FAILURE` を注入しているので、別コードの `ConflictError` が素通ししないケースを 1 本足せば契約が固定できる。

- **[W-003]** `NoteRouteFanOutReader` の 2 つの走査が、canon が定めた索引で順序を取れない
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteFanOutReader.ts:88-99`、`packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`note_routes_created_by_idx` / `note_routes_scope_idx`）、`spec/database/index.md`「note_routes」の indexes 行
  - 理由: 発行される SQL は `WHERE created_by = ? AND state <> 'reserved' AND note_id > ? ORDER BY note_id LIMIT ?`。索引は `(created_by, state, note_id)` で、`state` が**等値ではなく不等値**なので `note_id` 順は索引から出てこない — SQLite は `created_by` 一致ぶんを全部読んでから一時 B-tree でソートするか、`note_id` の暗黙 unique 索引で全表を舐めるかのどちらかになる。keyset にしてある意味（前方の削除で位置がずれない）は残るが、**1 page のコストが「その著者の route 総数」に比例**し、page を進めても下がらない。`spec/database/index.md` はこの索引を明示的に `NoteRouteFanOutReader` の scatter-gather 用と書いており、想定は `state = ?` の等値である。account deletion の author route 固定は 100 件 page を繰り返すので、多作な利用者ほど効く。`scope` 側（`note_routes_scope_idx`）も同型。
  - 提案: どちらかを canon 側で決める。(a) 走査を `state IN ('active','moving','purging')` の等値集合に書き換える（ポートの契約は「`reserved` だけを飛ばす」なので意味は変わらない。ただし `tombstone` の扱いはポートが「unspecified」なので、落とす／載せるを決めて JSDoc へ）、または (b) `(created_by, note_id)` / `(scope_type, scope_id, note_id)` の索引に改め `spec/database/index.md` の indexes 行を直す。少なくとも「この索引ではソートが避けられない」ことを実測して adr.md へ残すこと。

#### カバレッジ

- 確認（実装・観点の中心）:
  - `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteStore.ts` — 5 状態、`routeVersion` CAS、`last_migration_id` による lost-response 判定、`unchangedGuard` / `absentGuard`、`isReadable`。memory 実装と 1 対 1 で対応し、DDL の相関 CHECK 5 本（`spec/database/index.md#note_routes`）をどの遷移も破らないことを追跡。`migration_id` / `last_migration_id` に CHECK を置かない点も spec と一致。
  - `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteFanOutReader.ts` — keyset、fingerprint、`state <> 'reserved'`（→ W-003）
  - `packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts` — `save` の `ON CONFLICT DO NOTHING`（ADR 042）、1 binding のサイズ上限、`claimPending` の単文 `RETURNING` + FIFO 再整列、`finalize` の 1 原子適用と quarantine（`next_attempt_at IS NULL` → `failed_at`）、`refuseStaged`、`pruneProcessed` の `applyCounted`（`meta.changes`）。`writeCounted` が count を返せないバックエンドで大声で落ちる設計も確認。
  - `packages/core/src/adapters/cloudflare/d1/repositories/idempotencyStore.ts` — autocommit の `RETURNING` と staged の read + `_occ_guard` の 2 経路
  - `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts` / `.../do/dueIndex.ts` / `.../do/scheduledTasks.ts` — 候補述語の対応（`lease_expires_at IS NULL` ⇔ `pending`）、`selectDueRows` の共有、priority ごとの有界化（`DUE_INDEX_ROWS_PER_PRIORITY = 25`）と `listDue` の枠取りの整合、slice 全置換
  - `packages/core/src/adapters/cloudflare/do/alarm.ts` — weighted round-robin、`CLAIM_CHUNK` 単位の claim、`index > 0` による「最低 1 行訪問」（ADR-061）、予算切れ行の `release`（`due_at` / `attempts` 据え置き）、ハンドラ無し kind を settle しない、`scopeAlarmDrivesTasks()` による空レジストリの no-op と `deleteAlarm`
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts` — constructor の `blockConcurrencyWhile` 内 DDL + pin + 再武装、`applyWriteSet` の touched-table 起点の `armAndPublish`、`alarm()` の `try/finally`、scope pin の不一致拒否（→ W-001）
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts` — claim の `occGuard` + 条件付き UPDATE、`backoff` の SQL 算術と `backedOffImage` の一致（`base × 2^(attempt-1)`、ceiling で `failed`、`due_at` 据え置き）、`schedule` の upsert、autocommit 経路のみ publish・alarm 非再武装
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeCleanupAdmissionStore.ts` — barrier の書き込みバリア、所有権検査、`json_set` による可換な component ack、`requiredComponents` 未宣言時に enum 全体へ倒す stall 側の既定（ADR 039）、`running` は `expires_at IS NULL` で prune 対象外
  - `packages/core/src/adapters/cloudflare/scopeRouter.ts`, `do/scopeStub.ts`, `do/scopeName.ts`, `d1/schema.ts`, `do/schema.ts`, `cursor.ts`
  - `packages/core/src/adapters/cloudflare/sql/{errors,executor,json,occGuard,row,session,statement}.ts` — 駆動エラーの翻訳が 1 か所で、occGuard を他の CHECK と取り違えないこと。`throwTranslated` が occGuard 以外を素通しで `SystemError` にする点も、過剰包装が無いことを含め確認。
  - `packages/core/src/adapters/cloudflare/execution/{writeSet,nesting,scopeUnitOfWork,globalUnitOfWork}.ts` — `touchedTables` が due index publish と `scopeTaskTrigger` を駆動する経路、`opaque` の table 明示規約
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql` — `note_routes` / `outbox_events` / `processed_events` / `scope_task_due_index` / `_occ_guard` の DDL と索引が `spec/database/index.md` と一致すること
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`, `.../ports/noteRouteFanOutReader.ts`, `.../errors.ts`, `.../workers/scopeTaskRunner.ts`, `.../workers/__tests__/scopeTaskRunner.test.ts`（→ W-002）
  - `packages/core/src/application/di/cloudflareRuntime.ts`, `.../di/runtime.ts` — AC-6 の前提（レジストリが空 ＝ 中央 runner が唯一の writer）が既定合成で成り立つこと。`registerScopeTaskHandler` の呼び出しがリポジトリ内 0 件、`createWorkerContainer` が `scopeTaskQueue` を配線、という組み合わせが `spec/platform/index.md`「配備はハンドラを登録するか中央 runner を回すかのどちらか一方」と矛盾しないことを確認。
  - テスト: `__tests__/alarm.test.ts`（13 ケース）, `lease.test.ts`, `routeGuard.test.ts`, `idempotency.test.ts`, `durability.test.ts`, `globalConcurrency.test.ts`, `support.test.ts`, `runtimeComposition.test.ts`, `conformanceBackend.ts`, `__tests__/ports/route.ts`, `__tests__/ports/scopeInfra.ts` — 担当ポートが全て適合スイートへ配線され、`listDue` が `conformance/scopeTaskScheduler.ts` で実観測されていること、D1 が factory ごとに wipe されて due index の名前空間欠落が実害にならないことを確認。
  - canon: `spec/platform/index.md`（routing / 実上限 / 実行予算 / Queue 構成 / Alarm と Cron）, `spec/database/index.md`（`note_routes` / `_occ_guard` / `scope_task_due_index` / `scheduled_tasks` / `applied_operations`）, `spec/domains/index.md`, `spec/adr/{021,039,040,041,042,045,047,053,063}.md`, `spec/adr/index.md`, `.thread/11/plan.md`, `.thread/11/adr.md`（ADR-019 / 045 / 060 / 061）, `.thread/11/review/triage-keys.md` / `triage.md`

- スキップ:
  - `.thread/11/{foundation,progress,steps,testing}.md`, `.thread/11/review/review-00{1,2}*.md` — 作業記録。`plan.md` / `adr.md` / `triage*.md` だけ判断材料として読んだ
  - `.github/workflows/ci.yml`, `README.md`, `docs/test.md`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json` — ビルド / テスト基盤。composition 観点の持ち分
  - `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,globalMaintenanceRunStore,identityRemovalReceiptStore,identityRepository,identitySupport,identityUniqueDirectory,loginAttemptStore,oauthStateStore,publicNoteProjection,publicNoteQueryService,sessionRepository,userBatchReader,userRepository}.ts` — identity / directory / 公開投影。identity・scope 観点の持ち分
  - `packages/core/src/adapters/cloudflare/do/repositories/{appliedOperationStore,llmUsageRepository,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,storageQuotaRepository,storedFileRepository}.ts` — scope 業務データ。scope 観点の持ち分
  - `packages/core/src/adapters/cloudflare/{projection/*,r2/objectStorage.ts,search/*}.ts` — 投影 / R2 / 全文検索。他観点の持ち分
  - `packages/core/src/adapters/cloudflare/__tests__/{conformance/*.test.ts,conformanceCoverage.test.ts,deleteFilesByOwner.test.ts,env.d.ts,harness.test.ts,projectionConcurrency.test.ts,r2.test.ts,searchEdges.test.ts,sessionOverlay.test.ts,unitOfWork.test.ts,worker.ts,ports/{deps,directory,identity,projection,scopeBusiness}.ts}`, `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイートの配線（route / scopeInfra 束のみ確認）、UoW / 投影 / 検索 / R2 / AC-5 の観測。他観点の持ち分
  - `packages/core/src/application/identity/{requestPasswordReset,resendVerificationEmail}.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — identity ユースケースと AC-5 の計測。他観点の持ち分
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `packages/core/src/domain/note/ports/{localNoteProjectionWriter,localNoteQueryService,publicNoteProjectionWriter,publicNoteQueryService}.ts` — Note / Identity のポート JSDoc。scope / identity 観点の持ち分
  - `spec/domains/{identity,note}.md`, `spec/inventory/*.md`, `spec/testcases/**`, `spec/usecases/{identity,note}.md` — 台帳とテストケース。composition 観点の持ち分
