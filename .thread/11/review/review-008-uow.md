### UoW / 実行機構・SQL 土台

**Blocker 0 件 / Warning 0 件。**

ゼロベースで `execution/` / `sql/` / `cursor.ts` / `do/{scopeObject,scopeStub,scopeName,alarm,dueIndex,scheduledTasks}.ts` と対応テストを読み直したが、直すべき欠陥は見つからなかった。

#### Blockers

なし

#### Warnings

なし

#### 確認した内容（判定の根拠）

観点ごとに、実装と「それを守っているテスト」の対を確認した。

- **二平面 UoW の契約** — `execution/globalUnitOfWork.ts:69-99` / `execution/scopeUnitOfWork.ts:67-111` は callback が throw すれば `WriteSet` を捨てるだけで、`stageOutbox` で積んだ event も含めて 1 文も走らない。commit 途中で driver が拒む側は `__tests__/durability.test.ts:79-214` が D1 `batch()` と DO `transactionSync` の両方で読み戻して確認しており、rollback した write-set が due index を publish しないところまで観測している（同 159-190）。並行 run の半端な観測は `__tests__/unitOfWork.test.ts:350-369`、UoW 外の原子操作が巻き込まれないことは `durability.test.ts:192-214`。
- **入れ子 `run` の禁止** — `execution/nesting.ts` の `AsyncLocalStorage` は同一平面・平面跨ぎの 4 組み合わせすべてを `unitOfWork.test.ts:416-430` で観測。post-commit kick が文脈の外で撃たれること（trigger 自身が `run` を開けること）は同 432-489 が、`relayTrigger` と `scopeTaskTrigger` の両方について「kick の中で開いた `run` が resolve する」形で固定している。`scopeUnitOfWork.ts:90-108` が `touchedTables()` から `armedTasks` を導く形なので、`backoff` が再武装する経路も kick に乗る。
- **write-set + 原子適用** — `execution/writeSet.ts` の `opaque` は「表を名乗るか否か」で `touchedTables()` への寄与が変わる設計で、`__tests__/sessionOverlay.test.ts:187-205` が `_occ_guard`（表なし）と `scheduled_tasks` 一括 DELETE（表あり）の両方を観測。`sql/session.ts:162-206` の `readRows` は `LIMIT` とオーバーレイが合成できない 3 形（staged delete / 述語外への update / `ORDER BY` を跨ぎうる update）を `databaseError` で拒み、`sessionOverlay.test.ts:123-184` が 3 形すべてと「拒まない 2 形」を対に持っている。`opaque` の read-your-writes 不在は JSDoc（`writeSet.ts:18-28`）が明示し、`scopeTaskScheduler` が `backedOffImage` で行像を積む側に倒しているのを確認した（`do/repositories/scopeTaskScheduler.ts:305-316`。SQL 側 `backoffStatement` の `1 << attempts`(更新前値) と JS 側 `backoffDelayMs(attempts+1)` = `2**(attempt-1)` が全 attempt で一致することを算術で突き合わせた）。
- **`_occ_guard` の発火漏れ** — `sql/occGuard.ts` の「守る文の直前に積む」規律を、全 30 か所の呼び出し地点（`grep occGuard(`）について前後関係を確認した。`globalMaintenanceRunStore` の `runIdentityGuard` / `laneIdentityGuard` は lane checkpoint / ack の全経路の先頭にあり、`spec/platform/index.md:197` の「run の lease は fencing である」と対応している。guard なしの条件付き書き込みは `outboxRepository.claimPending`（1 文の `UPDATE … RETURNING` で原子性が文自身にある）と `finalize`（id 指定の無条件 settle）だけで、いずれも guard を要さない形。guard 表が発火後も空であることは `unitOfWork.test.ts:391-414` が固定している。
- **bound parameter / 文数 / `json_each` / エラー翻訳** — `assertBindable` は D1・DO storage・scope stub の 3 経路すべてに入っており（`sql/executor.ts:63,109` / `do/scopeStub.ts:42,45,53`）、`MAX_STATEMENTS_PER_COMMIT = 250` は `spec/platform/index.md:134` の「500 の半分」と一致。cap の上下 1 件と autocommit 側の同一 cap は `sessionOverlay.test.ts:239-260`、`json_each` が 250 件・500 件・100 件を 1 文で通すことは `support.test.ts:35-76,116-153` が実バインディングで観測している。`sql/errors.ts` の `classifySqlError` が DO の RPC 境界を越えて guard 名を拾えることは `unitOfWork.test.ts:532-577`。
- **alarm turn** — `do/alarm.ts:144-232` の予算・chunk claim・release / backoff の使い分け・「claim した chunk は必ず 1 行訪問する」の各性質が `__tests__/alarm.test.ts` の対応ケースで観測されている（round-robin 197、handler 無しの `running` 据え置き 256、handler 例外の backoff 344、CPU 予算の release 406、claim だけで予算を使い切った場合 475、再入と reclaim が attempt を消費しないこと 1046）。`leaseMs` の env 読み取りは turn ごとで、既定値・設定値・不正値（`"0"` で turn を落とし 1 行も claim しない）の 3 ケースが揃っている（887 / 922 / 962）。alarm を消す地点が turn の出口 1 か所であることは `spec/platform/index.md:202` と `alarm.ts:249-294` が 1 対 1 で、commit 経路が消さないことを rebuild・後続 commit・失敗 publish の 3 方向から固定している（639 / 669 / 601）。
- **due index の整合** — `do/dueIndex.ts` の全置換 publish と `armAndPublish` の直列化は `alarm.test.ts:765-790` が D1 batch を実際に stall させて「古いスライスが最後に着地しない」ことを観測。publish 失敗時の再試行 alarm が eviction・後続 commit を跨いで残ることも上記 3 ケースが持つ。publish 側の符号化（`status <> 'failed'` / `lease_expires_at` の NULL 有無）と `scopeTaskQueue.ts:22-23` の候補述語が同じ規約を読んでいることを突き合わせた。優先度ごと 25 行・全体 100 行の上限は `spec/database/index.md:1113` と一致。
- **セキュリティ / 性能** — `cursor.ts` は「認証されない・可視性は毎回 read 側が判定する」を JSDoc で明示し、`ValidationError("INVALID_PAGINATION")` へ倒す形で `support.test.ts:88-103` が round-trip と fingerprint 不一致・非 base64 を観測。`scopeObject.bind` の scope pin は `assertAddressed` で毎 RPC 検査され、`unitOfWork.test.ts:579-601` が 2 scope の分離を読み戻している。
- **コメント** — 担当範囲の実装・テスト全ファイルに、指摘への弁明・修正の経緯・レビュー ラウンドへの言及は無い（`grep` で "Round" / "以前は" / "no longer" 等を走査。ヒット 2 件はいずれも述語の説明で経緯ではない）。

#### カバレッジ

一覧 192 行に 1 対 1 で対応させる。

- 確認:
  - `packages/core/src/adapters/cloudflare/execution/writeSet.ts`
  - `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts`
  - `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`
  - `packages/core/src/adapters/cloudflare/execution/nesting.ts`
  - `packages/core/src/adapters/cloudflare/sql/session.ts`
  - `packages/core/src/adapters/cloudflare/sql/executor.ts`
  - `packages/core/src/adapters/cloudflare/sql/statement.ts`
  - `packages/core/src/adapters/cloudflare/sql/occGuard.ts`
  - `packages/core/src/adapters/cloudflare/sql/json.ts`
  - `packages/core/src/adapters/cloudflare/sql/errors.ts`
  - `packages/core/src/adapters/cloudflare/sql/row.ts`
  - `packages/core/src/adapters/cloudflare/cursor.ts`
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts`
  - `packages/core/src/adapters/cloudflare/do/scopeStub.ts`
  - `packages/core/src/adapters/cloudflare/do/scopeName.ts`
  - `packages/core/src/adapters/cloudflare/do/alarm.ts`
  - `packages/core/src/adapters/cloudflare/do/dueIndex.ts`
  - `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts`
  - `packages/core/src/adapters/cloudflare/do/schema.ts`
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`
  - `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`
  - `packages/core/src/adapters/cloudflare/d1/schema.ts`
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`_occ_guard` の DDL / 制約名の一致のみ）
  - `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/sessionOverlay.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/durability.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/idempotency.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/support.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`（UoW プロバイダの組み立てと staged / autocommit 双方の露出のみ）
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`
  - `packages/core/src/application/workers/scopeTaskRunner.ts`
  - `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
  - `packages/core/src/application/errors.ts`
  - `spec/platform/index.md`（実行予算 / Scope Alarm / 外部要求）
  - `spec/database/index.md`（共通の規約 / `_occ_guard` / `scope_task_due_index`）
  - `.thread/11/plan.md`, `.thread/11/review/triage-keys.md`
- スキップ:
  - `packages/core/src/adapters/cloudflare/d1/repositories/*`（15 ファイル）— 個々のポート実装は identity / routing / composition 観点の持ち分。ただし `occGuard(` の積み順と bound parameter の扱いだけは全件横断で確認した
  - `packages/core/src/adapters/cloudflare/do/repositories/*`（`scopeTaskScheduler.ts` を除く 9 ファイル）— 同上
  - `packages/core/src/adapters/cloudflare/projection/*`, `search/*`, `r2/objectStorage.ts`, `scopeRouter.ts` — 投影 / 検索 / R2 / routing 観点
  - `packages/core/src/adapters/cloudflare/__tests__/conformance/*`, `__tests__/ports/*`, `harness.test.ts`, `runtimeComposition.test.ts`, `env.d.ts`, `worker.ts` — 適合ハーネスの網羅と DI 合成は composition 観点
  - `packages/core/src/adapters/cloudflare/__tests__/{deleteFilesByOwner,projectionConcurrency,r2,routeGuard,searchEdges}.test.ts` — 各担当領域の固有テスト
  - `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイート網羅の検査で composition 観点
  - `packages/core/src/application/{cleanup,identity,di,storage}/*`, `application/ports/noteRouteFanOutReader.ts`, `domain/**` — usecase / domain 側の変更で観点外
  - `packages/core/{tsconfig*.json,vitest.workers.config.ts,wrangler.test.jsonc,package.json}`, `vitest.config.ts`, `vitest.shared.ts`, `package.json`, `pnpm-*`, `.github/workflows/ci.yml` — ビルド / テスト基盤の構成で composition 観点
  - `README.md`, `docs/*` — ドキュメント整備で観点外
  - `spec/adr/*`, `spec/domains/*`, `spec/inventory/*`, `spec/testcases/*`, `spec/usecases/*` — canon 追随の妥当性は各領域の担当（`spec/platform` / `spec/database` の該当節のみ本観点で確認済み）
  - `.thread/11/{adr,foundation,progress,steps,testing}.md`, `.thread/11/review/review-00[1-7]*.md`, `triage.md` — 前ラウンドの記録。ゼロベース判定のため参照しない（`triage-keys.md` の既出判定のみ確認）
