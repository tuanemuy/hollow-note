### UoW / 実行機構・SQL 土台

#### Blockers

- **[B-001]** `ScopeObject` の constructor が、due index republish の再試行 alarm を消す
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:80-95`（`blockConcurrencyWhile` 内の `rescheduleAlarm`）／関連 `packages/core/src/adapters/cloudflare/do/alarm.ts:254-263`
  - 理由: Round 003 で採った案 (a)（publish 失敗時に `armNoLaterThan(now + DUE_INDEX_REPUBLISH_DELAY_MS)`）は、`spec/database/index.md:1092` の `scope_task_due_index` 節が「索引に載らなかった行は `listDue` が索引しか読まないため誰も探しに来ず、自然回復しない。**上記の再試行 alarm がその唯一の回復経路である**」と明記している唯一の砦。ところが constructor は `stored !== null` の場合に必ず `rescheduleAlarm` を呼び、既定配備（ハンドラ未登録＝`scopeAlarmDrivesTasks()` が false）ではこれが無条件に `storage.deleteAlarm()` になる。object が evict されたあと**任意の RPC（読み取りでもよい）**が届けば constructor が走り、10 秒後に張ったはずの再試行 alarm がそこで消える。以後その scope の `scheduled_tasks` に触れる write-set が来るまで索引は空のままで、`listDue` は当該 scope を返さない — plan.md「リスクと注意点」が挙げた「継続の鎖が止まる／`accountDeletionBarrier` が開いたまま User が `deleting` で残る」が自動復旧不能な形で成立する。
    実機で確認済み（`packages/core/vitest.workers.config.ts` の workers プロジェクトに一時テストを置いて計測）: publish を落として `applyWriteSet` → `getAlarm()` は `1787709547205`。`state.abort()` で object を作り直し、次の `query()` を投げたあと `getAlarm()` は `null`。既存の `__tests__/alarm.test.ts:515`「republishes a slice whose publish failed on its own next alarm」は object を作り直さずに `runDurableObjectAlarm` を呼ぶため、この経路を観測していない。
  - 提案: constructor では「この配備が task を駆動しない」ときに alarm を消さない（`if (scopeAlarmDrivesTasks()) await tolerate(REARM_FAILED, () => rescheduleAlarm(ctx.storage))`）。駆動しない配備で残った古い alarm は、配送されれば `alarm()` → `EMPTY_TURN` → `finally` の `armAndPublish` → `rescheduleAlarm` が自分で落とすので、constructor で落とす必要は元々ない。あわせて「object を作り直しても再試行 alarm が残る」ケースを `alarm.test.ts` に足すこと（`runInDurableObject(stub, (_i, state) => state.abort())` → 次の RPC → `getAlarm()` が非 null）。

#### Warnings

- **[W-001]** 同一 scope への並行 publish が、古いスライスで新しいスライスを上書きしうる（しかも失敗しないので再試行 alarm が張られない）
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:157-177`（`armAndPublish` / `publishDueIndex`）、`packages/core/src/adapters/cloudflare/do/dueIndex.ts:60-93`
  - 理由: `publishDueIndex` は「object 内で `scheduled_tasks` を同期 SELECT → global D1 へ `DELETE + INSERT` の batch」という read-modify-write で、排他が無い。Durable Object は storage 操作が in-flight でない `await`（ここでは D1 への RPC）の間に次のイベントを受け付けるので、`applyWriteSet` A が D1 応答を待つ間に `applyWriteSet` B が入り、B の行を含まない A のスライスが後着すると B の行が索引から消える。`__tests__/lease.test.ts:170` / `:231` が示すとおり、同一 object への 2 本の呼び出しが実際に交錯することはこのコード基盤で観測済み。B-001 と違い publish 自体は成功しているため再試行 alarm は張られず、既定配備（レジストリ空 ⇒ alarm 無し）では回復経路が無い。
  - 提案: object 内の publish を直列化する（`ScopeObject` に `private publishing: Promise<void>` を持ち、`armAndPublish` をその鎖に繋ぐ）か、スライスに単調な世代（object 側の連番）を載せて `DELETE`/`INSERT` を古い世代では効かせない形にする。前者が既存の構造に収まる。並行 `applyWriteSet` 2 本のあと索引が最新スライスと一致することを `alarm.test.ts` か `unitOfWork.test.ts` に足すのが観測点。

#### カバレッジ

- 確認:
  - `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/nesting.ts`, `packages/core/src/adapters/cloudflare/execution/writeSet.ts`
  - `packages/core/src/adapters/cloudflare/sql/session.ts`, `packages/core/src/adapters/cloudflare/sql/executor.ts`, `packages/core/src/adapters/cloudflare/sql/statement.ts`, `packages/core/src/adapters/cloudflare/sql/json.ts`, `packages/core/src/adapters/cloudflare/sql/occGuard.ts`, `packages/core/src/adapters/cloudflare/sql/errors.ts`, `packages/core/src/adapters/cloudflare/sql/row.ts`
  - `packages/core/src/adapters/cloudflare/cursor.ts`
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts`, `packages/core/src/adapters/cloudflare/do/scopeStub.ts`, `packages/core/src/adapters/cloudflare/do/scopeName.ts`, `packages/core/src/adapters/cloudflare/do/alarm.ts`, `packages/core/src/adapters/cloudflare/do/dueIndex.ts`, `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`（`_occ_guard` の積み方・due index publish・claim 予定選択の共有規則）
  - `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts`, `.../sessionOverlay.test.ts`, `.../alarm.test.ts`, `.../durability.test.ts`, `.../lease.test.ts`, `.../harness.test.ts`, `.../support.test.ts`
  - `packages/core/src/application/di/cloudflareRuntime.ts`（UoW / session / scheduler の配線と、autocommit 経路が本番で使われるかの確認）
  - `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/errors.ts`
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`_occ_guard` / `scope_task_due_index` の DDL のみ）
  - `readRows` 呼び出し地点の全数（`do/repositories/{storedFileRepository,storageQuotaRepository,noteRepository,scopeCleanupAdmissionStore,llmUsageRepository}.ts`, `d1/repositories/{noteRouteStore,distributedOperationStore,identityRepository,identityUniqueDirectory,identityRemovalReceiptStore,accountDeletionManifestStore,sessionRepository,authTokenRepository,userBatchReader,globalMaintenanceRunStore}.ts`）— `limit` と `compare` が同時に付く 4 か所（`llmUsageRepository.deleteByUser` / `noteRepository.listPurgeable` / `accountDeletionManifestStore.pruneTerminal` / `authTokenRepository.findPendingByUserAndPurpose`）と、それらを呼ぶ usecase（`usage/deleteQuota.ts`, `identity/deleteAccount/terminalPrune.ts`, `identity/{requestPasswordReset,resendVerificationEmail}.ts`）を辿り、**1 UoW 内で読み→書き→同じ読みを繰り返す経路が無い**ことを確認。広げた LIMIT ガードは現行の正当な使い方を落とさない
  - `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`（node / workers の分割に穴が無いこと。実際に workers プロジェクトを走らせて検証に使用）
  - `spec/database/index.md`（`_occ_guard` / `scope_task_due_index` / `scheduled_tasks` / `_scope_identity` の節）、`spec/adr/023`, `spec/adr/024`, `spec/adr/026`, `.thread/11/plan.md`, `.thread/11/review/triage-keys.md`
- スキップ:
  - `packages/core/src/adapters/cloudflare/d1/repositories/**`（`scopeTaskQueue` / `_occ_guard` の積み方に関わる範囲だけ横断確認。各リポジトリの列マッピング・契約適合は identity / routing / scope 観点の担当）
  - `packages/core/src/adapters/cloudflare/do/repositories/**`（同上。`scopeTaskScheduler.ts` のみ本観点で精読）
  - `packages/core/src/adapters/cloudflare/{projection/**,search/**,r2/**,scopeRouter.ts}` — 投影・全文検索・R2・scope ルーティングは他観点の担当
  - `packages/core/src/adapters/cloudflare/d1/schema.ts` — 表名台帳。`_occ_guard` / due index の行のみ参照し、全体は composition 観点の担当
  - `packages/core/src/adapters/cloudflare/__tests__/{conformance/**,conformanceBackend.ts,ports/**,env.d.ts,worker.ts}` — 適合ハーネスの構成は composition 観点の担当
  - `packages/core/src/adapters/cloudflare/__tests__/{deleteFilesByOwner,globalConcurrency,idempotency,projectionConcurrency,r2,routeGuard,runtimeComposition,searchEdges}.test.ts` — それぞれ storage / identity / routing / projection 観点の担当
  - `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイート網羅の検査で composition 観点の担当
  - `packages/core/src/application/di/runtime.ts`, `packages/core/src/application/{identity,storage,ports/noteRouteFanOutReader.ts}` の残り、`packages/core/src/domain/**` — 契約文言の改訂であり、UoW / 実行機構の挙動を変えていないことだけ確認
  - `spec/**` の残り（`adr/021`, `adr/063`, `adr/index.md`, `platform/index.md`, `domains/**`, `inventory/**`, `testcases/**`, `usecases/**`）— 本観点に関わる `database/index.md` の 4 節以外は canon 同期の担当
  - `.github/workflows/ci.yml`, `README.md`, `docs/test.md`, `package.json`, `packages/core/package.json`, `packages/core/tsconfig*.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` — ビルド / 依存の配線で composition 観点の担当
  - `.thread/11/{adr.md,foundation.md,progress.md,steps.md,testing.md,review/**}` の残り — 作業記録
