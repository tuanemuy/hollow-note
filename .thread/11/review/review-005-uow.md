### UoW / 実行機構・SQL 土台

ゼロベースで再レビューした。二平面 UoW（write-set + 原子適用 + オーバーレイ）、`_occ_guard`、bound parameter / 文数の上限、`json_each` 展開、エラー翻訳、`AsyncLocalStorage` による入れ子禁止と post-commit kick の位置、alarm turn の予算・release / backoff・再入、due index の publish 直列化 — いずれも契約どおりに実装され、実効的なテストで観測されている。以下は Blocker ではないが、いずれも「コード自身が主張している性質」との微差である。

#### Blockers

なし。

#### Warnings

- **[W-001]** republish 再試行 alarm を、それが守る publish の**前に**無条件で消している
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:179-193`（`armAndPublishNow`）、`packages/core/src/adapters/cloudflare/do/alarm.ts:254-263`（`rescheduleAlarm`）
  - 理由: `armAndPublishNow` は `rescheduleAlarm` → `publishDueIndex` の順で走る。既定配備（`scopeAlarmDrivesTasks()` が偽）では `rescheduleAlarm` は必ず `deleteAlarm()` に落ちるので、**scheduled_tasks を触る commit のたびに、前回の publish 失敗で張った再試行 alarm が先に消える**。消してよいのは「その直後の publish が成功して slice が最新になったから」であって、publish が失敗したときは `catch` の `armNoLaterThan` が張り直すことで辻褄が合っている。つまり retry の存続は「delete と publish の間で isolate が死なないこと」に依存している。ここで落ちると、その scope は `scheduled_tasks` に行を持ちながら due index に 1 行も無く alarm も無い状態で残り、`listDue` はこの scope を二度と返さない（`dueIndex.ts:35-45` が「この方向のドリフトだけは他に受け皿が無い」と明記している方向そのもの）。復旧経路は「その scope への次の書き込み」しか無く、personal cleanup の継続が止まると plan.md「リスクと注意点」が挙げた `accountDeletionBarrier` が開いたままになる。窓は狭い（D1 batch 1 往復）が、`dueIndex.ts:44-45` の「Nothing takes the retry away either」という記述は rebuild 経路にしか当てはまっていない。
  - 提案: 順序を「publish 先・reschedule 後」に入れ替える。`publishDueIndex()` が成功したときだけ `rescheduleAlarm()`（＝alarm を消しうる操作）を呼び、失敗したときは `armForStoredRows()` ＋ `armNoLaterThan(now + DUE_INDEX_REPUBLISH_DELAY_MS)` を張る。こうすると「slice が最新だと確認できるまで、既存の alarm を何も消さない」が不変条件になり、`armAndPublishNow` のどこで落ちても retry が残る。現状の「arming first keeps the object's self-healing independent of D1」という理由づけは、失敗側で `armForStoredRows()` を足せば保たれる。

- **[W-002]** ステージした行イメージが「読み文の射影」と一致しないとき、集合読みが**黙って**間違った頁を返す
  - 場所: `packages/core/src/adapters/cloudflare/execution/writeSet.ts:21-35`（`RowMutation` の `row`）、`packages/core/src/adapters/cloudflare/sql/session.ts:151-195`（`createStagedSession.readRows`）
  - 理由: `readRows` は `spec.matches` / `spec.compare` を**ステージした行イメージに対して**適用する。イメージが読み文の SELECT が返す列を欠くと、その列は `undefined` になり、`matches` は偽になって行が頁から静かに消え、`compare` は `NaN` を返して順序が壊れる。`readRow` 側は欠けた列が `row.ts` の reader で `DataIntegrityError` として大声で落ちるのに対し、この経路だけは失敗が観測できない。`RowMutation` の JSDoc は「read-your-writes が返す行イメージ」としか書いておらず、「その表の読み文が選ぶ列を全部持つこと」を型でも文書でも要求していない（`session.ts:6-12` は `key` の作り方の一致だけを要求している）。今日のリポジトリはすべて完全なイメージを積んでいるので実害は無いが、`sessionOverlay.test.ts:85-94` のフィクスチャ（`row: { id, status }` の部分イメージ）がそのまま本番コードに現れうる形であることを示している。
  - 提案: `RowMutation.upsert.row` の JSDoc に「その表を読む文が選ぶ列をすべて持つこと。欠けた列は `readRows` の `matches` / `compare` で静かに誤動作する」を明記する。加えて `readRows` で、ステージ行が `stored[0]` のキー集合を包含しているかを 1 度だけ検査し、外れたら `databaseError` にする（LIMIT の修復不能検査と同じ「黙って間違えるより落ちる」方針に揃う）。

- **[W-003]** `armAndPublish` の直列鎖が publish を合流させないので、同一 scope への継続 arming が D1 往復 1 本ずつに serialize する
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:172-177`
  - 理由: 鎖の意図（最後に読んだ slice が最後に書かれる）は正しく、`alarm.test.ts:617-642` が実測で守っている。ただし slice は**全置換**なので、鎖に N 本溜まった publish の最終結果は「最後の 1 本だけを走らせた結果」と同じである。にもかかわらず `applyWriteSet` は自分より前の N-1 本の D1 往復をすべて待ってから RPC を返す。`scheduled_tasks` を触る commit（継続を arm する commit はすべてこれ）のスループットが 1 scope あたり「1 / D1 RTT」で頭打ちになり、`spec/platform/index.md:67` の foreground p95 500ms 予算に対する余裕が同時実行数に比例して削れる。`alarm()` の `finally` も同じ鎖の後ろに並ぶ。
  - 提案: 鎖を「実行中 1 本 ＋ 保留フラグ 1 つ」に畳む。publish 実行中に来た要求はフラグを立てて、実行中の 1 本が終わったら**もう 1 本だけ**走らせ、待ち手全員をその 1 本に紐づける。「commit のあとに開始された publish の完了を待つ」ことさえ保てば `dueIndex.ts` の順序保証（`run` が解決した時点で index に載っている）は維持され、往復は最大 2 に収まる。

- **[W-004]** autocommit 経路の `ScopeTaskScheduler` は due index を publish するが alarm を張らない — object 駆動配備では継続が誰にも起こされない
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts:86-92, 101-108`、`packages/core/src/adapters/cloudflare/do/scopeStub.ts:44-46`（`apply` が `touchedTables` に `[]` を渡す）
  - 理由: JSDoc は「arming は object の持ち分で、object は commit した write-set ごとと turn の終わりに必ず張る」と書くが、autocommit の `session.write` は `executor.apply` → `stub.applyWriteSet(key, stmts, [])` を通るので object 側の `armAndPublish` に入らない。既定配備（registry 空＝中央 runner が唯一の writer）では due index さえ載れば足りるので実害は無い。しかし `registerScopeTaskHandler` を使う配備（＝`scopeAlarmDrivesTasks()` が真、その配備では中央 runner を併走させないことが `spec/platform/index.md:197` の前提）で autocommit の `schedule` が呼ばれると、その行は alarm でも `listDue` でも起こされず、次に同 scope へ別の書き込みが来るまで停止する。今日は本番配線に autocommit の呼び出し元が無い（`cloudflareRuntime.ts` は UoW 内でしか組み立てていない）ので潜在的だが、`ConformanceBackend.forScope` はこの形を公開している。
  - 提案: どちらかに倒す。(a) `publishDueIndex` と同じ位置で「この配備が object 駆動なら arm も要求する」ことを表明する（`scopeAlarmDrivesTasks()` は Worker 側でも読めるので、真なら `databaseError` で autocommit 利用を拒む）、または (b) JSDoc の「arming belongs to the object」の一文を「autocommit 経路は object 駆動配備では使えない」という前提条件として明示する。現状の理由づけ（"arming from here would let an alarm turn race the caller"）は、その配備でこの行が誰にも起こされない事実を説明していない。

#### 確認した設計上の要点（指摘ではない）

- 二平面の契約: 失敗時の全ロールバックは write-set を捨てるだけ、並行 run の半端観測は「commit = 1 batch / 1 `transactionSync`」で閉じている。`durability.test.ts:81-216` が D1 batch 中断・`transactionSync` 巻き戻し・既 commit 分の非巻き込みを実ストアの読み戻しで観測。入れ子禁止は `AsyncLocalStorage` で同一平面・平面跨ぎの 4 通りを `unitOfWork.test.ts:400-414` が観測。UoW 外の原子操作（autocommit session）は write-set を持たないので巻き込まれない。
- post-commit kick: `relayTrigger` / `scopeTaskTrigger` はいずれも `runInUnitOfWork` の解決**後**にあり、`unitOfWork.test.ts:416-473` が「kick の中から UoW を開いて成功する」ことで文脈が閉じていることを観測している。`armedTasks` を `touchedTables()` から読む形なので `backoff` による再 arm も kick を落とさない。
- `_occ_guard`: DDL・定数名・分類器（`OCC_GUARD_CONSTRAINT`）が 1 か所に集約され、D1 batch / DO `transactionSync` の両方で abort → `ConflictError("OPTIMISTIC_LOCK_FAILURE")` に翻訳されることが `unitOfWork.test.ts:373-391, 516-561` と `globalConcurrency.test.ts` / `projectionConcurrency.test.ts` / `lease.test.ts:170-292` で観測されている。guard を保護対象文の**前**に積む規律も JSDoc と全呼び出し地点で一致。積み忘れ経路は見当たらない（`claimDue` / 各 OCC リポジトリの全経路で対になっている）。`spec/database/index.md:1073-1086` に節が起きている（AC-9）。
- 上限系: bound parameter 100 は `assertBindable` が D1 / DO storage / scope stub の 3 経路すべてで掛かり、`support.test.ts:78-86` がアンカー付きで、`support.test.ts:113-154` が 500 件 / 100 件の実データで `json_each` 展開の貫通を観測。文数上限 250（500 の半分）は `createD1Executor.apply` 1 か所で UoW commit と autocommit の両方に掛かり、`support.test.ts:239-260` が境界の両側を観測。`spec/platform/index.md:62,134` と一致。
- alarm turn: 予算（100 行 / CPU 2s）は `spec/platform/index.md:191` と一致。「訪問しない行を claim しない」ための chunk 分割、budget で切った行の `release`（`due_at` / `attempts` を動かさない）と handler 失敗時の `backoff`（attempt を進める）の使い分け、handler 不在 kind を settle せず `running` のまま残す規律、いずれも `alarm.test.ts:330-508` が状態遷移まで観測している。再入は `alarm.test.ts:749-823` が「lease 中は何も動かない → lease 失効後の再 claim は attempt を消費しない」まで見ている。候補 SELECT から claim の `transactionSync` までに await が無いので、turn 内で guard が跳ねる余地は構造的に無い。
- `backoffStatement`（SQL 側、更新前の `attempts` を参照）と `backoffDelayMs`（TS 側、更新後の値を受ける）は指数と上限が一致しており、オーバーレイ像と実行結果が食い違わない。
- cursor: 不透明・非認証であることが JSDoc に明記され、`fp` 不一致とデコード不能の双方を `ValidationError("INVALID_PAGINATION")` に倒す。`atob` の unpadded base64url は WHATWG forgiving-base64 で成立。`spec/adr/063` に決定が着地している。
- コメント: `packages/core/src/adapters/cloudflare/` 全体を「以前は / no longer / レビュー / 指摘 / 修正した」等で走査したが、指摘への弁明・修正の経緯を残した記述は無い。当たったのはすべて対象の状態を説明する本文（`session.ts:44` など）。

#### カバレッジ

- 確認: `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/nesting.ts`
- 確認: `packages/core/src/adapters/cloudflare/sql/session.ts`, `sql/executor.ts`, `sql/statement.ts`, `sql/occGuard.ts`, `sql/errors.ts`, `sql/json.ts`, `sql/row.ts`
- 確認: `packages/core/src/adapters/cloudflare/cursor.ts`, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/scopeObject.ts`, `do/alarm.ts`, `do/dueIndex.ts`, `do/scheduledTasks.ts`, `do/scopeStub.ts`, `do/scopeName.ts`, `do/schema.ts`, `do/repositories/scopeTaskScheduler.ts`
- 確認: `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts`, `__tests__/alarm.test.ts`, `__tests__/sessionOverlay.test.ts`, `__tests__/support.test.ts`, `__tests__/durability.test.ts`, `__tests__/lease.test.ts`, `__tests__/harness.test.ts`, `__tests__/conformanceBackend.ts`
- 確認（該当箇所のみ）: `packages/core/src/adapters/cloudflare/d1/schema.ts`（`_occ_guard` / `scope_task_due_index` の名前）, `d1/migrations/0001_global_schema.sql`（同 2 表の DDL）, `packages/core/src/application/di/cloudflareRuntime.ts`（両 UoW provider の配線・トリガー遅延束縛）, `packages/core/src/application/ports/scopeTaskScheduler.ts`（`claimDue` の 1 UoW 1 回・`ConflictError` 追記）, `packages/core/src/adapters/conformance/unitOfWork.ts`（契約の読み合わせ）
- 確認: `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`（AC-3: 実バインディングで走ること、`nodejs_compat` が `node:async_hooks` を供給すること）
- 確認（俯瞰のみ）: `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`, `__tests__/projectionConcurrency.test.ts`, `__tests__/idempotency.test.ts` — `_occ_guard` の敗者側の答えが実測されていることの確認に留める（本体は identity / routing の観点）
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/**`（17 ファイル） — 個別ポートの実装で identity / routing / projection の観点
- スキップ: `packages/core/src/adapters/cloudflare/do/repositories/**`（`scopeTaskScheduler.ts` を除く 9 ファイル） — scope 平面の個別ポート実装で scope 観点
- スキップ: `packages/core/src/adapters/cloudflare/projection/**`, `search/**`, `r2/objectStorage.ts`, `scopeRouter.ts` — 検索 / 投影 / R2 / ルーティングで観点外
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/conformance/**`（7 ファイル）, `__tests__/ports/**`（7 ファイル）, `__tests__/deleteFilesByOwner.test.ts`, `__tests__/r2.test.ts`, `__tests__/routeGuard.test.ts`, `__tests__/runtimeComposition.test.ts`, `__tests__/searchEdges.test.ts`, `__tests__/env.d.ts`, `__tests__/worker.ts` — 適合スイートの束ね方と各ポート束のテストで composition / 各ポート観点
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — スイート網羅の台帳検査で composition 観点
- スキップ: `packages/core/src/application/cleanup/participants.ts`, `cleanup/personalCleanup.ts`, `application/errors.ts`, `application/identity/requestPasswordReset.ts`, `application/identity/resendVerificationEmail.ts`, `application/ports/noteRouteFanOutReader.ts`, `application/di/runtime.ts`, `application/storage/__tests__/deleteFilesByOwner.test.ts`, `application/workers/scopeTaskRunner.ts`, `application/workers/__tests__/scopeTaskRunner.test.ts` — usecase / worker 本体の変更で scope・composition 観点（`scopeTaskRunner` の `ConflictError` 許容だけはポート JSDoc 側で読み合わせ済み）
- スキップ: `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `domain/note/ports/localNoteProjectionWriter.ts`, `domain/note/ports/localNoteQueryService.ts`, `domain/note/ports/publicNoteProjectionWriter.ts`, `domain/note/ports/publicNoteQueryService.ts` — ドメインポートの契約文言で identity / projection 観点
- スキップ: `spec/**`（`database/index.md` の `_occ_guard` / `scope_task_due_index` 節と `platform/index.md` の実上限・実行予算・Scope Alarm・fencing 節を除く 20 ファイル） — canon 追随の是非は composition 観点
- スキップ: `.thread/11/**`（`plan.md` / `review/triage-keys.md` / `adr.md` の ADR-001〜003 を除く 29 ファイル） — 過去ラウンドの記録で、ゼロベース判断の材料にしない
- スキップ: `.github/workflows/ci.yml`, `README.md`, `docs/runtime_node.md`, `docs/test.md`, `package.json`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` — ツール・ドキュメント・依存で composition 観点
