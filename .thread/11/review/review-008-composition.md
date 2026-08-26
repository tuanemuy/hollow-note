### 合成・スキーマ・テストハーネス・spec/docs

#### Blockers

なし

#### Warnings

なし

Round 008 は確認ラウンドとして、AC-1〜AC-9 を可能な限り**実測**で洗い直した。実測値はすべて `.thread/11/testing.md` の期待結果と一致し、spec 改訂は実装と 1 対 1 で、`.thread/11/adr.md` への外部参照は 0 件だった。前ラウンドまでの指摘に対する修正は退行していない。「気になるが直すほどではない」項目は本ラウンドの方針に従い記載しない。

#### 受け入れ基準の実測

| # | 判定 | 実測値 / 根拠 |
|---|---|---|
| AC-1 | 満たす | `packages/core/src/adapters/cloudflare/` と `application/di/cloudflareRuntime.ts` に `TODO` / `FIXME` / `not implemented` / 空実装は 0 件（唯一のヒットは `scopeTaskQueue.ts:31` のポート契約説明文で、マーカーではない）。steps.md が数える 35 ポート（Global D1 19 ＋ Scope DO 13 ＋ 横断 2 ＋ R2 1）は `__tests__/ports/{identity,directory,route,projection,scopeBusiness,scopeInfra}.ts` の 6 束と `conformanceBackend.ts` の返却物で全数が実体を持つ |
| AC-2 | 満たす | `pnpm exec vitest run --project workers` → **22 ファイル / 368 passed / 0 skipped / 0 failed**（exit 0）。`conformanceCoverage.test.ts` が `PERSISTENCE_SUITES = 30` と「memory 側と CF 側の呼び出し集合の一致」を固定し、node 側で緑（4 ケース） |
| AC-3 | 満たす | 実行は `packages/core/vitest.workers.config.ts` の `cloudflareTest()` プラグイン経由で、`wrangler.test.jsonc` の `GLOBAL_DB`(D1) / `OBJECT_STORAGE`(R2) / `SCOPE_OBJECT`(SQLite DO) に対して走る。`harness.test.ts` の `exposes the D1, R2 and Durable Object bindings` / `applies the global schema, including the contentless FTS5 table` / `creates the scope schema on first contact with an object` / `provides the Node built-ins the adapters rely on` が実バインディングを観測。読み替え防止は `conformanceCoverage.test.ts` の `hands each backend's suites that backend's own factory`（CF 入口が名乗る factory は `makeCloudflareConformanceBackend` の 1 種だけ）が固定 |
| AC-4 | 満たす | testing.md 項目 3 が名指す 4 群のケース名がすべて実在し緑 — `durability.test.ts`: `keeps no part of a D1 batch whose middle statement is refused` / `keeps no part of a global unit of work whose commit is refused` / `rolls a scope write-set back inside transactionSync and publishes no index`、`idempotency.test.ts`: `folds a re-saved outbox id onto the stored row instead of replacing it`、`lease.test.ts`: `lets a second writer reclaim a lapsed lease without moving the row`、`r2.test.ts`: `leaves one whole object behind when two writes race for a key` / `treats a delete of absent keys as done` / `spends the 1,000-key delete limit in chunks`。bound parameter 上限は `support.test.ts` の 4 ケース（500 route / 100 user / 上限越えの多行 INSERT・DELETE / 上限拒否）が実在 |
| AC-5 | 満たす | `deleteFilesByOwner.test.ts` に `AC-5:` で始まる 4 ケースが実在（`the turn commits once, whatever the batch size` / `enumeration and the outbox flush are constant, the per-row work is not` / `records the measured totals of one turn` / `the object executes exactly the statements it was sent`）。実測 `4n + 3` は `spec/platform/index.md:153-155`（実測行を確認）へ改訂済みで、契約側 `spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例した往復を要求しない」は無変更。`spec/adr/056` のコンテキストも「今日ある 2 つのバックエンドはいずれも届かない」へ改訂され、文数の正本が platform 側にあることが明記されている |
| AC-6 | 満たす | 決着は「`leaseMs` の帯 ＋ 単一 writer で足り、claim token は契約へ足さない」。3 か所の明文化を確認 — ポート JSDoc `application/ports/scopeTaskScheduler.ts`（`The lease is advisory: settling addresses a row by (kind, operationId) alone and carries no fencing token` ＋ 帯の下限・上限）、`spec/platform/index.md`「Scope Alarm」（帯・driver 別の単一 writer 根拠・レジストリが driver を決めること・`SCOPE_TASK_LEASE_MS` の注入点と不正値の扱い）、実装 `do/scopeObject.ts:53-80,166`（`ScopeObjectEnv.SCOPE_TASK_LEASE_MS?` と `leaseMsOf`）。契約無変更のため `adapters/conformance/` と `spec/domains/` に差分なし（変更ファイル一覧に 1 件も現れない）。`alarm.test.ts` の 3 ケース（`grants the lease the deployment configured` / `grants the built-in lease when the deployment configures none` / `refuses the turn and claims nothing when the configured lease is not a positive integer`）が帯からの選択を実物で観測 |
| AC-7 | 満たす | `pnpm exec vitest run --project node` → **77 ファイル / 984 passed / 3 skipped / 0 failed**。skip 3 件は `adapters/oauth/__tests__/conformance.test.ts` の `unverifiable: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set`（実行して名前を確認済み。testing.md の記述と一致）。`pnpm typecheck`（root tsgo ＋ `packages/core` の 2 プログラム ＋ `apps/web`）／`pnpm lint`（530 ファイル、エラー 0。info 2 件は既存の biome 設定移行案内）／`pnpm format:check`（543 ファイル、変更なし）／`pnpm install --frozen-lockfile`（成功＝ロックファイル同期済み）／`pnpm build:node`（成功）。変更ファイル一覧 192 行に `packages/core/src/adapters/memory/` と `apps/web/` の行は 1 件もなく、`adapters/conformance/` も 0 件 |
| AC-8 | 満たす | `packages/core/src/adapters/conformance/` は変更ファイル一覧に現れず、適合スイート本体は無変更。したがって「CF のために足したケースが memory を落とす」事態は構造的に発生していない。契約側の文言変更（`authTokenRepository` の複数 pending 許容、`publicNoteProjectionWriter.removeForPurge` の ack 撤回、`{local,public}NoteProjectionWriter` の `OPTIMISTIC_LOCK_FAILURE` 追記、cursor の「署名」撤回）はいずれもポート JSDoc と `spec/domains/` を同時に動かし、既存の両バックエンドの観測可能挙動を変えていない（両プロジェクト緑）。`spec/inventory/adapter.md` の ADP-identity-039 も同じ向きへ改訂済み |
| AC-9 | 満たす | `_occ_guard` は `spec/database/index.md:1074-1090` に節があり、DDL（`0001_global_schema.sql:20-23`：`id integer PRIMARY KEY, CONSTRAINT _occ_guard_conflict CHECK (id <> 0)`）と列・制約名まで一致。`scope_task_due_index` も spec に節があり、DDL（同 424-436）の PK 4 列・`due_at` / `priority` / `lease_expires_at` と索引 `(priority, due_at, kind, operation_id)` が spec の記述どおり。migration は `0001_global_schema.sql` の **1 本のみ**（`ls` で確認）で 21 テーブル ＋ FTS5 仮想表 1 = 22、`d1/schema.ts` の `GLOBAL_TABLES` 22 エントリと 1 対 1。反映しない差分（Workspace / Tag / Job / Integration の表）は plan.md の「含まれないもの」と progress.md に理由付きで残っている |

補足の実測:

- `pnpm exec vitest run --project workers --project node` → **99 ファイル / 1352 passed / 3 skipped**。77+22=99、984+368=1352 で和が一致し、二重実行も取りこぼしもない（testing.md 項目 6 の期待結果と完全一致）。複数 `--project` フラグが実際に受理されることも確認した
- CI は 2 テストジョブ構成（`lint-typecheck-unit`＝`pnpm test:node`、`unit-tests-workers`＝`pnpm test:workers`、timeout 10 分 / 20 分）＋ 既存の `build`。両ジョブの和が `pnpm test` の全量を覆う
- 適合ハーネスの名前空間分離は **D1 / DO / R2 の 3 面**で成立: DO は `namespace` を object 名の一部に混ぜて新しい object を取り（`createScopeStubExecutor(env.SCOPE_OBJECT, scope, namespace)`）、R2 は `objectKeyPrefix: ${namespace}/`、D1 だけが 1 DB 共有で factory 先頭の `GLOBAL_WIPE_STATEMENTS` 全消し。`harness.test.ts` の `hands out backends that cannot see one another on any plane` が 3 面すべてを 1 ケースで観測し、`leaves no migrated table out of the wipe` が `sqlite_master` 由来の表集合と `GLOBAL_TABLES` の一致を固定。`GLOBAL_TABLES_TO_WIPE` は `Object.values` から導出しているので表の追加漏れが起きない
- `.thread/11/adr.md` への参照は本番ソース・spec・docs から **0 件**（`grep -rn "thread/11\|adr\.md" --exclude-dir=.thread` の結果が空）。CF アダプター内の `ADR NNN` 参照 15 種はすべて `spec/adr/` の実在 ADR（009/010/011/017/026/027/039/041/042/045/046/049/056/061/062）で、`.thread` 側の `ADR-0NN` ハイフン形式は 1 件も混入していない
- `.thread/11/adr.md` の採番は `ADR-001` 〜 `ADR-098` が**欠番・重複なしで連続**（98 エントリ）
- `.thread/11/testing.md` の手順で名指されるファイルパスはすべて実在（`conformance/*.test.ts` 7 本、バックエンド固有 13 本、`memory/__tests__/conformance.test.ts`、`adapters/__tests__/conformanceCoverage.test.ts`、`adapters/conformance/scopeTaskScheduler.ts`、`application/ports/scopeTaskScheduler.ts`、`do/scopeObject.ts`、`spec/testcases/storage/deleteFilesByOwner.md`、`apps/web/.env.example`）。引用しているケース名 15 個も全数が実ファイルに存在。`spec/platform/index.md:153-155` の行番号も現物と一致
- spec の「署名 cursor」撤回は残存参照まで整合。残っている 署名/署名opaque cursor は (a) workspace directory 系（`spec/adr/063` の影響節が明示的に範囲外と宣言し、`spec/adr/021` も「公開workspace一覧は署名cursorのまま」と書いている）と (b) `ExportTicket` / deletion status ticket（別物）のみ。`UserBatchReader` の「署名済み routing generation」も ADR 063 決定 3 が対象外と明記
- `spec/adr/index.md` は 063 を一覧と前提依存マップの両方へ追加済み（Round 002 の「要確認」を案 (b) で決着）

#### カバレッジ

**確認**（自分の観点に関わるファイル / 一覧 192 行のうち 62 行）:

- `.github/workflows/ci.yml`
- `README.md`, `docs/test.md`, `docs/runtime_node.md`
- `package.json`, `packages/core/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`（`--frozen-lockfile` の成功で同期を確認）
- `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`
- `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`
- `packages/core/src/application/di/cloudflareRuntime.ts`, `packages/core/src/application/di/runtime.ts`
- `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `.../d1/schema.ts`, `.../do/schema.ts`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `worker.ts`, `env.d.ts`, `harness.test.ts`, `runtimeComposition.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/ports/{deps,directory,identity,projection,route,scopeBusiness,scopeInfra}.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformance/{directory,identity,projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/{alarm,deleteFilesByOwner,durability,idempotency,lease,r2,support}.test.ts`（ケース名と AC 対応の検証範囲で確認）
- `packages/core/src/application/{cleanup/participants.ts,cleanup/personalCleanup.ts,errors.ts,identity/requestPasswordReset.ts,identity/resendVerificationEmail.ts,ports/noteRouteFanOutReader.ts,ports/scopeTaskScheduler.ts,workers/scopeTaskRunner.ts}`（契約文と spec の 1 対 1 を見る範囲で確認）
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
- `packages/core/src/domain/{identity/ports/authTokenRepository.ts,note/ports/localNoteProjectionWriter.ts,note/ports/publicNoteProjectionWriter.ts,note/ports/publicNoteQueryService.ts}`（同上）
- `spec/adr/{021,056}.md`, `spec/adr/063-public-cursor-not-authenticated.md`, `spec/adr/index.md`
- `spec/database/index.md`, `spec/platform/index.md`
- `spec/domains/{identity,index,note,workspace}.md`
- `spec/inventory/{adapter,domain,frontend,test,usecase}.md`
- `spec/testcases/identity/{deleteAccount,listPublicProfiles}.md`, `spec/testcases/note/{projectNoteChanges,searchPublicNotes}.md`
- `spec/usecases/{identity,note}.md`
- `.thread/11/{plan,steps,testing,progress,adr}.md`, `.thread/11/review/triage-keys.md`

**スキップ**:

- `packages/core/src/adapters/cloudflare/{cursor,scopeRouter,scopeTaskQueue}.ts`, `d1/repositories/*.ts`(20), `do/{alarm,dueIndex,scheduledTasks,scopeName,scopeObject,scopeStub}.ts`, `do/repositories/*.ts`(10), `execution/*.ts`(4), `projection/*.ts`(4), `r2/objectStorage.ts`, `search/*.ts`(2), `sql/*.ts`(7) — 実装本体は uow / scope / identity / routing の各観点の持ち分。schema・DI 合成・AC の検証に必要な範囲（`scopeObject.ts` の lease 注入点、`scopeStub.ts` の namespace 引数、`sql/executor.ts` の apply 経路）だけを読んだ
- `packages/core/src/adapters/cloudflare/__tests__/{globalConcurrency,projectionConcurrency,routeGuard,searchEdges,sessionOverlay,unitOfWork}.test.ts` — バックエンド固有の振る舞い検証で、ハーネス構造ではなく各観点の担当領域
- `.thread/11/review/review-00{1..7}*.md`(46), `.thread/11/review/triage.md`, `.thread/11/foundation.md` — 過去ラウンドの記録で、ゼロベース方針により判定の前提にしない（`triage-keys.md` のみ既出判定の確認として読了）
