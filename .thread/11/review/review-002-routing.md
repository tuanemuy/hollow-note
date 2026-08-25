### Routing / outbox / scope インフラ

Round 001 の結果は前提にせず、契約（ポート JSDoc）・canon（`spec/database/index.md` / `spec/platform/index.md` / ADR 021 / 039–042 / 045 / 047 / 053）・実装・テストを突き合わせて読んだ。

状態機械と CAS まわりは総じて堅い。`note_routes` の 10 遷移は「読んだ行像 + patch の全列書き戻し」に畳まれ、5 本の相関 CHECK と `unchangedGuard` の 5 列一致が噛み合っている。`switchMove` の `last_migration_id` による lost-response 分岐、`isReadable` の `reserved` / `purging` 除外と tombstone 期限判定、`resolveMany` の `json_each` 展開（500 id / bind 100 の両立）、`OutboxRepository` の `RETURNING` 1 文 claim・`ON CONFLICT DO NOTHING`（ADR 042）・staged セッションの明示的拒否、`IdempotencyStore` の staged / autocommit 二経路（どちらも「勝者ちょうど 1 人」が成り立つことを追って確認）、`ScopeRouter` を意図的に包まない判断（ADR-034）はいずれも妥当。`claimGuardStatement` の条件は `claimStatement` の `WHERE` と字面まで一致しており、per-row 排他の仕掛け自体は正しい。コメントには弁明・修正経緯の残骸は無く、本番ソースから `.thread/` への参照も 0 件（ADR-052 が効いている）。

#### Blockers

- **[B-001]** `claimDue` が競合時に投げる `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が、ポートの明示的なエラー契約に無く、唯一の呼び出し側も捕まえていない
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts:201-219`（guard 積み）／ `packages/core/src/application/ports/scopeTaskScheduler.ts:153`（`Error contract: SystemError(DatabaseError).`）／ `packages/core/src/application/workers/scopeTaskRunner.ts:159-162`
  - 理由: ADR-044 の決定自体は支持する（guard 無しでは敗者も同じ行を受け取り、ポートの「two `claimDue` calls running at once never hand out the same row」が破れる）。問題は**その決定を契約へ書き戻していない**こと。
    - ポート JSDoc は `ScopeTaskScheduler` 全体のエラー契約を `SystemError(DatabaseError)` と 1 行で宣言している。CF バックエンドはこれを満たさない実装として出荷される。CLAUDE.md「Port contracts and conformance」は「契約の正本はポート定義とその JSDoc」「contractual behaviour を足すならポート JSDoc と適合スイートの両方に触れる」と定めており、AC-8（ADR 026 / 046）も同じ手続きを要求している。適合スイートへの追加を見送る判断（#48）は triage 済みで蒸し返さないが、**JSDoc を更新しない理由はどの ADR にも書かれていない**（ADR-019 が「JSDoc を変更しない」と言っているのは fencing token の話であって、claim の失敗形の話ではない）。
    - 実害も残る。`runDueScopeTasks` は `claimDue` を `try` の外で呼んでいるので（`scopeTaskRunner.ts:159`）、1 scope の競合で例外が `runDueScopeTasks` 全体を貫き、**その tick の残り全 scope が処理されない**。ADR-044 の Consequences は「runner は次 tick で取り直す」と書いているが、取り直されるのは競合した行だけで、同じ tick の他 scope は巻き添えで落ちる。memory バックエンドはこの経路で決して投げないので、application 層は「投げない」前提で書かれている。
  - 提案: (a) `application/ports/scopeTaskScheduler.ts` のエラー契約行に `ConflictError("OPTIMISTIC_LOCK_FAILURE")`（「候補読みと適用のあいだに別 writer が同じ行を取ったとき。バッチ全体が 0 件になり、次ラウンドで取り直す」）を明記する。(b) `runDueScopeTasks` の `claimDue` を per-scope の `try / catch` で囲み、競合した scope だけ skip して round を続ける（ハンドラ実行側は既に per-task で隔離されているので、同じ粒度に揃うだけ）。

- **[B-002]** `note_routes` に新設した 2 列が `spec/database/index.md` にも adr.md にも無く、AC-9 を満たしていない
  - 場所: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql:201-202`（`migration_id` / `last_migration_id`）／ `spec/database/index.md:96-113`（`note_routes` の列表）
  - 理由: AC-9 は「新規に決めた物理スキーマ（列名・索引・`_occ_guard` の形）が spec に反映されている。反映しない差分は adr.md に理由とともに残っている」と要求している。本 PR は `_occ_guard` / `scope_task_due_index` / `_scope_identity` / `account_deletion_manifest_items` / `global_maintenance_run_lanes` については spec に節を足しているのに、`note_routes` の列表だけ手つかずのまま 2 列増えている。
    - `migration_id` は `NoteRoute.migrationId`（`spec/domains/note.md:656`）の物理化と読めなくもないが、`last_migration_id` は**契約側に対応物が無い純粋な新規列**で、`switchMove` の lost-response 再試行（`d1/repositories/noteRouteStore.ts:427-433`）という状態機械の一分岐を単独で支えている。adr.md での言及は ADR-015 の guard 条件列挙に `migration_id` が 1 度出るだけで、`last_migration_id` は全文に無い。
    - `note_routes` の 5 本の相関 CHECK（`0001_global_schema.sql:207-211`）も spec 側は列ごとの条件文としてしか書かれていないので、ここも合わせて詰めたい。
  - 提案: `spec/database/index.md#note_routes` の列表に `migration_id`（`state = 'moving'` のとき NOT NULL）と `last_migration_id`（直近に完了した switch の migration ID／lost-response 再試行の識別子）を足し、本文に「`switchMove` の応答喪失後の再試行は `state='active' かつ route_version = expected+1 かつ last_migration_id = migrationId` で冪等に判定する」を 1 文加える。spec を動かさない判断なら adr.md に理由を残す。

#### Warnings

- **[W-001]** commit 後の due index publish / alarm 再武装の失敗が、確定済みの scope UoW を「失敗」として呼び出し元へ返す
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:85-99`
  - 理由: `applyWriteSet` は `this.sql.apply(statements)`（= `transactionSync` で確定）した**後**に `rescheduleAlarm` → `publishDueIndex` を await しており、どちらの例外も catch されずに RPC を reject する。呼び出し側の `createScopeUnitOfWorkProvider` はそれを `throwTranslated("the scope unit of work", cause)` で `SystemError(DatabaseError)` にする（`execution/scopeUnitOfWork.ts:90-95`）ので、**scope 側は確定しているのにユースケースには「トランザクションが失敗した」と見える**。
    - `spec/database/index.md#scope_task_due_index` は「commit と索引更新のあいだで落ちた場合の drift は当該 scope の Alarm が治す」「余分な行が出ても cost は claim を 1 つ落とすことに留まる」と、索引を派生データとして明示的に許容側へ倒している。同じ判断を `ScopeTaskScheduler.write` は取っている（`do/repositories/scopeTaskScheduler.ts:113-121` で warn に落とす）のに、object 側だけ倒し方が逆になっている。
    - `durability.test.ts:161` は「refuse された write-set が index を publish しない」ことは固定しているが、「commit 済み write-set の publish が落ちたとき何が起きるか」は誰も観測していない。
    - なお ADR-045 により既定（レジストリ空）では alarm が武装されないので、この経路の drift を治す alarm turn は存在しない — 「Alarm が治す」という canon の前提が既定配備では働かない点も含めて整理が要る。
  - 提案: `publishDueIndex` / `rescheduleAlarm` を `applyWriteSet` の中で try/catch し、失敗は `Logger` へ落として RPC は成功で返す（scheduler 側の扱いに揃える）。そのうえで「レジストリ空の配備では drift を治すのが誰か」を ADR-020 / ADR-045 のどちらかに 1 行で書く。テストは commit 済み write-set + publish 失敗で `run` が解決することを固定する。

- **[W-002]** alarm turn が「1 行も訪問せずに chunk 全部を release して即再武装」する経路があり、進捗ゼロのループになりうる
  - 場所: `packages/core/src/adapters/cloudflare/do/alarm.ts:142-218`（`while` 条件 142、ハンドラ前の予算判定 183、release + break 208-217）
  - 理由: 予算判定 `elapsedMs() < cpuBudgetMs` は chunk の claim の**前**にしか無く、候補読み + `transactionSync`（最大 10 行）自体が予算を食い切ると、ハンドラループの最初の判定（183）で `index === 0` のまま break し、claim した 10 行を全部 release して turn を終える。`release` は `due_at` を据え置くので、直後の `rescheduleAlarm` は過去の `due_at` で `setAlarm` し、workerd は即座に再配送する。claim → 全 release → 即再配送、が閉じる。
    - ADR-046 の「誰も試していない仕事に attempt を払わない」という判断は正しいが、その裏返しとして「1 件も試さない turn」が attempt も `due_at` も動かさないまま無限に回りうる。`SCOPE_ALARM_CPU_BUDGET_MS` が 2 秒と短めなので、負荷時に claim が 2 秒を超える可能性はゼロではない。
  - 提案: chunk を claim した turn は**最低 1 行は必ず訪問する**（`index === 0` のときは予算超過でも 1 件だけハンドラを呼ぶ、または `elapsedMs()` 判定を `index > 0` の条件と AND する）。これで「claim したのに 0 件処理」で再武装するループが構造的に消える。

- **[W-003]** 「レジストリが writer を決める」という決着が、実際には受け渡しになっていない
  - 場所: `packages/core/src/adapters/cloudflare/do/alarm.ts:67-83, 248-257` ／ `packages/core/src/application/di/cloudflareRuntime.ts:409`
  - 理由: ADR-019 の fencing 決着（契約非変更）は「1 scope = 1 writer」に全面的に依存し、ADR-045 はその 1 writer を決める唯一の事実を module レベルの可変レジストリに置いた。しかし
    - `createWorkerContainer` は `scopeTaskQueue` を**無条件に**配線している（`cloudflareRuntime.ts:409`）。配備が `registerScopeTaskHandler` を呼んだ瞬間に object も driver になり、中央 runner と併走する — つまり ADR-019 が「実配備前に再訪せよ」と書いた構成に、コード上は何の抵抗もなく入れてしまう。ADR-045 の「配備スライスはハンドラを登録するだけで object 側へ倒せる」は、runner を止める手当てが同時に要る点を書き落としている。
    - 逆向きの受け渡しも欠けている。レジストリが空のあいだ `rescheduleAlarm` は `deleteAlarm()` する（`alarm.ts:251-254`）ので、後からハンドラを登録しても**既に積まれている行は誰にも武装されない**。武装が起きるのは「`scheduled_tasks` を名指した write-set の commit」か「alarm turn の終わり」だけで、後者は最初の alarm が要るという循環になる。既存行はその scope に次の書き込みが来るまで止まる。
  - 提案: writer の決定を 1 つの宣言に寄せる — 例えば composition root が `scopeTaskHandlers` を渡すかどうかで「レジストリ登録」と「`scopeTaskQueue` 配線」の両方が決まる形にする（併走を型か組み立てで表現できないなら、少なくとも `createWorkerContainer` 側で「レジストリが空でないなら runner を回さない」を assert する）。加えて、レジストリ有りの配備へ切り替えるときに既存行を武装し直す手順（object 起動時に 1 度 `rescheduleAlarm` する等）を ADR-045 の Consequences に足す。

- **[W-004]** per-row 排他を観測しているテストが autocommit 経路だけで、実配備が通る staged（scope UoW）経路の guard は誰も観測していない
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts:164-215`（`createAutocommitSession` で 2 本の scheduler を作る）／ 実配備は `application/di/cloudflareRuntime.ts:294` の `buildRepositories` 経由なので常に `createStagedSession`
  - 理由: 積む文は同じでも、guard が発火する地点（`session.write` の即時適用 vs write-set の commit）と翻訳される場所（`scheduled_tasks` コンテキスト vs `the scope unit of work` コンテキスト）が違う。AC-2/AC-3 が「実バインディングに対して契約を観測する」ことを求めている以上、実配備が通る経路で「2 本の UoW が同じ行を掴んだら 1 本だけが受け取る」を固定しておきたい。ついでに、`session.staged` が常に真である以上、`createCloudflareScopeTaskScheduler` の `publishDueIndex` と `db: D1Database` 依存は**実配備では一度も実行されない**（ADR-020 の想定「中央 runner の claim / settle は UoW を開かない経路もある」は、少なくとも現在の `runDueScopeTasks` には当てはまらない）。
  - 提案: `lease.test.ts` の競合ケースを `scopeUnitOfWorkProvider.run` 越しにも 1 本足す。あわせて ADR-020 の Context を現状（runner も UoW を開く）に合わせて訂正するか、autocommit 経路が残る理由（適合スイートの `forScope` 経由）を明示する。

- **[W-005]** `pruneProcessed` が削除件数を数えるためだけに全削除行を `RETURNING` で materialize する
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts:241-252`
  - 理由: `DELETE … RETURNING id` に LIMIT が無いので、保持期間を過ぎた処理済み行が溜まった状態で 1 回呼ぶと、削除行数ぶんの id が D1 のレスポンスに載る。D1 のレスポンス上限に触れると prune 自体が毎回失敗し、outbox が縮まなくなる。ADR 042 の「重複排除の有効期間は行の寿命と等しい／保持期間は再配送の窓を上回る必要がある」は prune が回り続けることを前提にしているので、ここが詰まると effect が dedup 側にも及ぶ。
  - 提案: 件数は `RETURNING` ではなくドライバの `meta.changes` から取る（`SqlExecutor` に「書いて件数を返す」1 本を足すか、`apply` の戻りを使う）。ポートに limit が無いので keyset 分割は契約変更になるが、少なくとも id の materialize は避けられる。

#### カバレッジ

観点（routing / outbox / scope インフラ）に関わるものを確認し、他観点の担当ファイルはスキップした。一覧 123 行との対応は以下で 1 対 1。

- 確認（本観点の中心）: `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteStore.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteFanOutReader.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/idempotencyStore.ts`, `packages/core/src/adapters/cloudflare/scopeRouter.ts`, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`, `packages/core/src/adapters/cloudflare/do/alarm.ts`, `packages/core/src/adapters/cloudflare/do/dueIndex.ts`, `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts`, `packages/core/src/adapters/cloudflare/do/scopeObject.ts`, `packages/core/src/adapters/cloudflare/do/scopeStub.ts`, `packages/core/src/adapters/cloudflare/do/scopeName.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`, `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/cloudflare/do/repositories/scopeCleanupAdmissionStore.ts`, `packages/core/src/adapters/cloudflare/do/repositories/appliedOperationStore.ts`
- 確認（判断に必要だった周辺）: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/sql/occGuard.ts`, `packages/core/src/adapters/cloudflare/sql/errors.ts`, `packages/core/src/adapters/cloudflare/sql/session.ts`, `packages/core/src/adapters/cloudflare/sql/executor.ts`, `packages/core/src/adapters/cloudflare/sql/json.ts`, `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/nesting.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`
- 確認（差分外・契約 / canon 側）: `packages/core/src/application/ports/{noteRouteStore,outboxRepository,scopeTaskScheduler,scopeTaskQueue}.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `spec/database/index.md`, `spec/platform/index.md`, `spec/adr/{040,041,042}.md`, `.thread/11/plan.md`, `.thread/11/adr.md`（ADR-003 / 008 / 013 / 015 / 016 / 017 / 019 / 020 / 033 / 034 / 044 / 045 / 046 / 047）, `.thread/11/review/triage-keys.md`
- 確認（テスト）: `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`, `.../lease.test.ts`, `.../routeGuard.test.ts`, `.../idempotency.test.ts`, `.../durability.test.ts`, `.../globalConcurrency.test.ts`（ケース名のみ）
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,globalMaintenanceRunStore,identityRemovalReceiptStore,identityRepository,identitySupport,identityUniqueDirectory,loginAttemptStore,oauthStateStore,publicNoteProjection,publicNoteQueryService,sessionRepository,userBatchReader,userRepository}.ts` — identity / directory / 公開投影の担当観点
- スキップ: `packages/core/src/adapters/cloudflare/do/repositories/{llmUsageRepository,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,storageQuotaRepository,storedFileRepository}.ts` — scope 業務データの担当観点
- スキップ: `packages/core/src/adapters/cloudflare/{cursor.ts,projection/*,search/*,r2/objectStorage.ts,sql/row.ts,sql/statement.ts}` — 検索 / 投影 / R2 / 値変換の担当観点（`sql/row.ts` / `sql/statement.ts` は本観点のコード経由で挙動だけ追認）
- スキップ: `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts` — UoW 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{conformance/*,conformanceBackend.ts,ports/*,worker.ts,env.d.ts,harness.test.ts,support.test.ts,unitOfWork.test.ts,sessionOverlay.test.ts,searchEdges.test.ts,r2.test.ts,deleteFilesByOwner.test.ts,runtimeComposition.test.ts}`, `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合ハーネス / 合成 / 他観点のバックエンド固有テスト
- スキップ: `packages/core/src/domain/note/ports/{localNoteQueryService,publicNoteQueryService}.ts` — 検索契約の担当観点
- スキップ: `packages/core/src/application/di/runtime.ts` — 合成観点の担当
- スキップ: `.github/workflows/ci.yml`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`, `docs/test.md` — ツーリング / テスト基盤の担当観点
- スキップ: `.thread/11/{foundation.md,progress.md,steps.md,testing.md,review/review-001-*.md,review/review-001.md,review/triage.md}` — 進行記録（`plan.md` / `adr.md` / `triage-keys.md` のみ参照）
