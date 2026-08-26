### UoW / 実行機構・SQL 土台

#### Blockers

なし。

二平面 UoW の契約（失敗時の全ロールバック・並行 run の不可視性・入れ子禁止・UoW 外原子操作の独立）、write-set とオーバーレイの整合、`_occ_guard` の積み順と翻訳、bound parameter / 文数の上限検査、`json_each` 展開、alarm turn の予算・release / backoff・再入、そして今ラウンドの 2 変更（`Upkeep = "commit" | "turnExit"`、`scopeTaskScheduler.write` の autocommit 拒否）を、コードと spec（`spec/database/index.md#_occ_guard` / `#scope_task_due_index`、`spec/platform/index.md`「Scope Alarm」）と実バインディング上のテストの三者で突き合わせた。**齟齬なし。**

##### 今ラウンドの変更の検証結果

- **`Upkeep` の二経路** — `armAndPublishNow`（`do/scopeObject.ts:190-211`）で `turnExit` だけが `rescheduleAlarm`（唯一 `deleteAlarm()` を呼ぶ地点）を通り、`commit` は `armForStoredRows`（`do/alarm.ts:284-294`。`armNoLaterThan` 経由で前倒しのみ）を通る。`spec/platform/index.md:202` と `spec/database/index.md` の「この alarm を消す地点は turn の出口だけ」と実装が 1 対 1 になっている。`deleteAlarm` 後・publish 完了前のクラッシュ窓は、`turnExit` では「消す alarm が既に配信済み」なので構造的に無害。
- **publish 失敗時の `armNoLaterThan`** — `armAndPublishNow` の `catch` は `upkeep` で分岐しないので、両経路とも `Date.now() + DUE_INDEX_REPUBLISH_DELAY_MS` へ武装する。`turnExit` で `rescheduleAlarm` が直前に `deleteAlarm()` した場合も `getAlarm()` が `null` → `setAlarm` になるので再試行は残る（コード上は正しい。ただし W-001 の通り観測されていない）。
- **`write` の autocommit 拒否**（`do/repositories/scopeTaskScheduler.ts:115-120`） — 発火条件は `!session.staged && scopeAlarmDrivesTasks()`。適合ハーネス `forScope`（`__tests__/conformanceBackend.ts:217-222`）は autocommit だが、`registerScopeTaskHandler` を呼ぶのは `__tests__/alarm.test.ts` だけで、workers pool は**ファイル単位で isolate が分かれる**ため適合ファイルではレジストリが空のまま。production 側（`di/cloudflareRuntime.ts:294`）は staged session でしか組み立てない。将来の配備でも「object 駆動なら中央 runner が居ない」が前提なので、拒否が正しい側に倒れている。

##### 主要な確認点（要点のみ）

- `execution/nesting.ts` — `AsyncLocalStorage` の store は `fn` の内側にしか伝播せず、`await runInUnitOfWork(...)` の後は呼び出し元の文脈に戻るので、post-commit の `relayTrigger.kick()` / `scopeTaskTrigger.kick()`（`globalUnitOfWork.ts:95-97` / `scopeUnitOfWork.ts:104-109`）が入れ子バーを踏まない。`__tests__/unitOfWork.test.ts:414` が「kick の中で `run` を開いて解決すること」まで観測しており、これは実効的。
- `execution/writeSet.ts` — `opaque` が `table` を任意にし、`touchedTables()` に載るのは名指した場合だけ。`scheduled_tasks` を書く `opaque` は scheduler の `claimDue` の occ guard のみ（`_occ_guard` しか書かないので載せないのが正しい）で、実データを動かす経路は全て `upsert` / `remove`。`__tests__/sessionOverlay.test.ts:188` が両方向を固定している。
- `sql/session.ts:163-207` — `readRows` の「LIMIT × 同一 UoW の書き込み」修復不能検査は、`stored.length >= limit` のときだけ走り、削除 / 述語外へ出た更新 / `compare` ありの更新を全て `databaseError` で拒む。staged 新規行が混ざる場合は `slice(0, limit)` が正しい答えになるので拒まないのも整合している。3 方向とも `sessionOverlay.test.ts:123-159` が観測。
- `sql/occGuard.ts` + `sql/errors.ts` — guard は保護対象文の**直前**に積む規約で、`claimDue`（`scopeTaskScheduler.ts:216-233`）も alarm turn（`do/alarm.ts:156-174`）も守っている。`classifySqlError` は制約名で識別し、DO の RPC 境界を跨いでも `OPTIMISTIC_LOCK_FAILURE` に翻訳されることを `unitOfWork.test.ts:514` が実バインディングで観測。
- bound parameter 上限 — `assertBindable` が D1 (`executor.ts:63`)・DO storage (`executor.ts:109`)・stub の RPC 前 (`scopeStub.ts:42,45,53`) の 3 箇所に掛かる。`dueIndexStatements`（`do/dueIndex.ts:85-98`）とスライスの有界化（`scheduledTasks.ts:89-104`、優先度ごと 25 行 = 最大 100 行）で publish の binding も件数に依存しない。
- 文数上限 — `MAX_STATEMENTS_PER_COMMIT = 250` は `createD1Executor.apply` の 1 箇所だけで、UoW commit と autocommit `write` の両方が同じ門を通る（`sessionOverlay.test.ts:239-260` が cap 丁度 / cap+1 / autocommit の 3 ケース）。scope plane に等価の上限が無いのは spec 通り。
- alarm turn の予算 — claim を `CLAIM_CHUNK = 10` 刻みにし、budget 切れの行は `releaseStatement`（`due_at` / `attempts` 不変）で返す。`index > 0` ガードで「claim だけで budget を使い切った chunk も 1 行は必ず訪問する」空回りループ防止まで入っており、`alarm.test.ts:394` / `:463` が両方を観測。
- 再入 — `alarm.test.ts:847` が「リース中の再配信は何も動かさない → リース失効後の再 claim は attempt を消費せず `due_at` を保つ」まで通しで観測。AC-4 を満たす。
- `runDueScopeTasks`（`application/workers/scopeTaskRunner.ts:167-181`）が `claimDue` の `OPTIMISTIC_LOCK_FAILURE` **だけ**を skip する形は、ポート JSDoc の追記（「staged backend は commit 時に投げるのでアダプター側では空結果に畳めない」）と対応が取れている。他の `ConflictError` を通すのも妥当。
- セキュリティ — `cursor.ts` は ADR 063 の通り非認証で、その事実が JSDoc・`application/errors.ts`・`ports/noteRouteFanOutReader.ts` の文言まで一貫して「tampered」から「unreadable / retired」へ書き換えられている。`scopeName.ts` / `_scope_identity` の pin により、名前空間接頭辞が本番データへ漏れないことと 2 scope が 1 object へ届かないことが両立している（`harness.test.ts:100` が観測）。
- コメント — 担当範囲の全ファイルを `Round` / `review` / `previously` / `TODO` / `FIXME` / issue 番号で走査。**指摘への弁明・修正経緯の残滓はゼロ。** `application/cleanup/{participants,personalCleanup}.ts` は逆に `#11` 参照を落とす方向に直っている。

#### Warnings

- **[W-001]** turn 出口の publish 失敗 → 再武装が、唯一の非自然回復方向であるのにテストで観測されていない
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:190-211` / `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts:557`
  - 理由: `armAndPublishNow` は `turnExit` のとき `rescheduleAlarm` を先に通す。ハンドラ未登録の配備ではこれが無条件に `deleteAlarm()` なので、その直後の publish が落ちたときに `armNoLaterThan(now + DUE_INDEX_REPUBLISH_DELAY_MS)` が効かなければ、その scope は**索引にも載らず alarm も持たない**状態で固定される — `dueIndex.ts` の JSDoc と `spec/database/index.md` が「自然回復しない唯一の方向」と名指している状態そのもの。コードは正しい（`getAlarm()` が `null` を返すので `setAlarm` に落ちる）が、`withPublishBroken` を使う 4 ケース（`alarm.test.ts:531,567,599,629`）はすべて commit 経路で、turn 経路で publish を壊したケースが 1 つも無い。commit 経路の武装だけを見て `rescheduleAlarm` を publish の後ろへ動かす、といった将来の変更をこのファイルは止められない。
  - 提案: `withPublishBroken(() => runDurableObjectAlarm(stubFor(scope)))` の 1 ケースを足し、turn 後に `armedAt(scope)` が `now + DUE_INDEX_REPUBLISH_DELAY_MS` 近傍で非 null であること、続く（索引を戻した後の）配信でスライスが載ることを観測する。`alarm.test.ts:557` の直後が置き場所として自然。

- **[W-002]** `_occ_guard` が行を残さないことを主張するテストが、`beforeEach` の wipe により無条件に通る
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts:391`（`beforeEach` は `:300-305`）
  - 理由: `GLOBAL_TABLES_TO_WIPE` は FTS5 以外の全 `GLOBAL_TABLES` を含むので `_occ_guard` も毎テスト `DELETE FROM` される。テスト名が言う「even after it has fired」は前のテストの出来事で、その効果は wipe で消えている。結果としてこのケースは `_occ_guard` の設計が変わっても（例: sentinel を `id = 0` から `CHECK` に触れない値へ変えて guard が中断せず行だけ残す退行）検出できない。`occGuard()` は「実行されれば必ず `CHECK` に反する」ことに全面的に依存しているので、そこが守られていないことは実質的に無防備。
  - 提案: 同一テスト内で guard を発火させてから（`:371` のケースと同じ形で `bumpVersion` を 2 回撃つ）行数を数えるか、`beforeEach` の wipe 対象から `_occ_guard` を外して発火後の状態を跨いで観測する。前者を推す（テスト間順序に依存しなくなる）。

- **[W-003]** `drops the alarm once nothing is scheduled` が、alarm を一度も張らないまま `null` を確認している（名前と経路の両方が現行設計とずれている）
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts:765-779`
  - 理由: `user-empty` はこのファイル内で他に使われない新規 scope で、`applyWriteSet([], [SCHEDULED_TASKS_TABLE])` は 0 文なので `apply` が即 return し、`armForStoredRows` も `nextWakeAt() === null` で何もしない。つまり `getAlarm()` が `null` なのは「消したから」ではなく「一度も張っていないから」で、アサーションは無条件に通る。加えて今ラウンドの変更で commit 経路は**そもそも alarm を消さない**ので、テスト名が主張する性質はこの経路に存在しない。実際の drop は `:557` の turn 経路が観測しているため穴は塞がっているが、このケースは現行設計を誤って記述したまま残っている。
  - 提案: 「最後の行が消えた commit は alarm を残し、続く 1 回の空 turn がそれを落とす」を観測する形に組み替える（`register` した状態で 1 行 schedule → 武装を確認 → `complete` 相当の write-set を commit → alarm が残っていることを確認 → `runDurableObjectAlarm` → `null`）。これは Round 005 の決定「副作用は空 turn が 1 回走るだけ」を実際に固定する唯一のケースにもなる。名前を実態に合わせるだけの修正でも可。

#### カバレッジ

**確認**（自分の観点に関わるものとして差分本文および作業ツリーを読んだもの）:

- 実行機構: `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `execution/nesting.ts`, `execution/globalUnitOfWork.ts`, `execution/scopeUnitOfWork.ts`
- SQL 土台: `packages/core/src/adapters/cloudflare/sql/session.ts`, `sql/executor.ts`, `sql/statement.ts`, `sql/occGuard.ts`, `sql/row.ts`, `sql/json.ts`, `sql/errors.ts`
- cursor: `packages/core/src/adapters/cloudflare/cursor.ts`
- DO 土台: `packages/core/src/adapters/cloudflare/do/scopeObject.ts`, `do/scopeStub.ts`, `do/scopeName.ts`, `do/alarm.ts`, `do/dueIndex.ts`, `do/scheduledTasks.ts`, `do/schema.ts`（scope 識別・`_occ_guard`・`scheduled_tasks` の DDL のみ）, `do/repositories/scopeTaskScheduler.ts`
- 索引の読み側: `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`
- global 側の関連 DDL: `packages/core/src/adapters/cloudflare/d1/schema.ts`（`GLOBAL_TABLES_TO_WIPE` / `GLOBAL_WIPE_STATEMENTS` / `occGuard` / `scopeTaskDueIndex`）, `d1/migrations/0001_global_schema.sql`（`_occ_guard` と `scope_task_due_index` の節のみ）
- テスト: `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts`, `__tests__/sessionOverlay.test.ts`, `__tests__/durability.test.ts`, `__tests__/alarm.test.ts`, `__tests__/lease.test.ts`, `__tests__/deleteFilesByOwner.test.ts`, `__tests__/conformanceBackend.ts`, `__tests__/harness.test.ts`, `__tests__/idempotency.test.ts`（ケース名と outbox / applied_operations の原子性のみ）, `__tests__/globalConcurrency.test.ts`（ケース名と `_occ_guard` 依存ケースのみ）, `__tests__/support.test.ts`（binding 上限・cursor round-trip のみ）, `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- application 側の接点: `packages/core/src/application/ports/scopeTaskScheduler.ts`, `application/workers/scopeTaskRunner.ts`, `application/errors.ts`, `application/ports/noteRouteFanOutReader.ts`, `application/cleanup/participants.ts`, `application/cleanup/personalCleanup.ts`, `application/identity/requestPasswordReset.ts`, `application/identity/resendVerificationEmail.ts`, `application/di/cloudflareRuntime.ts`（scope UoW / scheduler の配線のみ）, `application/storage/__tests__/deleteFilesByOwner.test.ts`（コメント差分のみ）
- 設計正典: `spec/platform/index.md`（実上限・実行予算・Scope Alarm・fencing）, `spec/database/index.md`（共通の規約・`_occ_guard`・`scope_task_due_index`・`_scope_identity`・`scheduled_tasks`）
- 実行構成: `packages/core/wrangler.test.jsonc`, `packages/core/vitest.workers.config.ts`
- 契約: `.thread/11/plan.md`（AC-1 / AC-3 / AC-4 / AC-5 / AC-7 / AC-9）, `.thread/11/review/triage-keys.md`

**スキップ**:

- `packages/core/src/adapters/cloudflare/d1/repositories/*`（18 ファイル） — identity / directory / route / projection 各バンドルの担当。UoW 土台の利用側であって土台そのものではない
- `packages/core/src/adapters/cloudflare/do/repositories/*`（`scopeTaskScheduler.ts` を除く 9 ファイル） — scope バンドルの担当
- `packages/core/src/adapters/cloudflare/projection/*`, `search/*`, `r2/objectStorage.ts`, `scopeRouter.ts` — projection / search / storage / routing バンドルの担当
- `packages/core/src/adapters/cloudflare/__tests__/conformance/*`（7 ファイル）, `__tests__/ports/*`（7 ファイル）, `__tests__/env.d.ts`, `__tests__/worker.ts` — 適合スイートの配線で、composition バンドルの担当（`conformanceBackend.ts` 側だけ本観点で確認）
- `packages/core/src/adapters/cloudflare/__tests__/{r2,routeGuard,runtimeComposition,searchEdges,projectionConcurrency}.test.ts` — 各担当バンドルの観測対象
- `packages/core/src/application/di/runtime.ts`, `packages/core/src/domain/**`（4 ファイル）, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts` — ポート契約文の改訂で identity / note バンドルおよび composition の担当（`scopeTaskScheduler` ポートだけ本観点で確認）
- `spec/`（`platform/index.md` / `database/index.md` 以外の 17 ファイル）, `.thread/11/*`（`plan.md` / `triage-keys.md` 以外の 22 ファイル） — 設計正典同期は composition バンドルの担当
- `README.md`, `docs/runtime_node.md`, `docs/test.md`, `.github/workflows/ci.yml`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/core/tsconfig*.json`, `vitest.config.ts`, `vitest.shared.ts` — ビルド / CI / ドキュメントで composition バンドルの担当（`vitest.workers.config.ts` と `wrangler.test.jsonc` だけ、`nodejs_compat` と実バインディングの成立に関わるため本観点で確認）
