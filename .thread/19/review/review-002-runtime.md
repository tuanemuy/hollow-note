# Runtime Wiring

## Blockers

なし。

`SCOPE_TASK_LEASE_MS` の配線は 1 本道で通っており、値が落ちる箇所も既定値が二重に定義された箇所も無い。実機で確認した（下記「検証したこと」）。

## Warnings

- **[W-001]** `nodeServerEnvToTuningEnv` の「空文字 = 未設定」への挙動変更が、AC に無い既存 4 変数まで及んでいて、それを守るテストが 1 つも無い
  - 場所: `packages/core/src/application/di/serverNode.ts:118-144`
  - 理由: AC-17 が求めるのは `SCOPE_TASK_LEASE_MS` の 1 本道だけで、`OUTBOX_BATCH_SIZE` / `OUTBOX_LEASE_MS` / `OUTBOX_MAX_ATTEMPTS` / `OUTBOX_RETENTION_MS` の「`OUTBOX_LEASE_MS=` は boot 拒否」→「既定値で黙って起動」は plan の受け入れ基準にも「含まれないもの」にも無い。新変数だけ `nonEmpty` にすれば AC は満たせるので、必然性のある変更でもない。方向としては境界検証を緩める側（`Validate at the boundaries` の緩和）なのに、`packages/core/src/application/di/__tests__/serverNode.test.ts` は `nodeServerEnvToTuningEnv` を 1 ケースも触っておらず、この契約は JSDoc のコメントにしか存在しない。`nonEmpty` を `!== undefined` に戻しても全テストが緑のままで、`OUTBOX_RETENTION_MS=` が 7 日既定に化ける／拒否されるのどちらが正なのか、コード側に証拠が残らない。plan のテスト方針「`OUTBOX_LEASE_MS` の先例が専用テストを持たないので新テストを足さない」は、先例の**挙動を変えない**場合の理屈であって、先例を書き換えた本 PR には効かない。
  - 提案: 既存の `di/__tests__/serverNode.test.ts` に 2 ケース足せば足りる（新規ファイル不要）。`nodeServerEnvToTuningEnv(readNodeServerEnv({ ...BASE, ...GOOGLE, OUTBOX_LEASE_MS: "", SCOPE_TASK_LEASE_MS: "" }))` が `{}` であること、値を入れたときは素通しであること。ついでに AC-17 の「1 本道」も 1 行で拘束できる。挙動変更自体を戻す（`SCOPE_TASK_LEASE_MS` だけ `!== undefined` の先例に揃える）のも選択肢で、その場合は JSDoc も一緒に落とす。

- **[W-002]** 新しく明文化した「空値 = 未設定」の読みが、同じ boot の 2 行隣で破れている（既存挙動・本 PR の導入ではない）
  - 場所: `packages/core/src/application/di/serverNode.ts:118-125`（宣言）/ `apps/web/app/server.node.ts:137-138`（破れている側）
  - 理由: 追加された JSDoc は「空値はコンテナ manifest で普通なので未設定と読む — `DELETION_TICKET_KEY` と同じ読み」と repo 全体の読みとして宣言している（`DELETION_TICKET_KEY` の refine と `nonEmpty` の既存用法を確認、主張自体は正しい）。一方で同じ `NodeServerEnv` から読む `PORT` は `Number.parseInt(env.PORT ?? "3000", 10)` なので `PORT=` は `NaN` になり `serve({ port: NaN })` に落ちる。`HOSTNAME=` も空文字がそのまま bind に渡る。挙動変更を「repo の読み」として一般化した以上、その読みが最も壊れる 2 変数だけ逆のままなのは据わりが悪い。
  - 提案: `nonEmpty(env.PORT) ? env.PORT : "3000"` / `nonEmpty(env.HOSTNAME) ? ... : "0.0.0.0"` に揃える（各 1 行）。本 Issue の範囲外と判断するなら、JSDoc の主張を「tuning env の 5 変数について」に限定して、越権な一般化を残さない。

- **[W-003]** 未処理 kind の再来周期が 1 秒 → 5 分に変わったのに、運用ドキュメントの可視性の記述が追随していない
  - 場所: `docs/runtime_node.md:90-104`（Worker runner）/ `docs/runtime_node.md:122-129`（Logging and observability）
  - 理由: `scopeTaskRunner.ts` の JSDoc は「standing log line」から「リース周期で戻る／停滞は最古 task age で測る」へ正しく書き直された（ADR-004、リスク欄の指摘に対応）。しかし運用者が読むのは `docs/runtime_node.md` の方で、そこは今も「Scope tasks = 1-second `setInterval` + kick」しか言っておらず、`[scope-tasks] no handler for …` は Notable lines にも載っていない。ハンドラ未登録・turn が死んだ行が既定 5 分間どのログにも現れなくなるのは、この runtime を運用する上で観測可能な変化で、`SCOPE_TASK_LEASE_MS` の env 表の 1 行だけからは読み取れない。docs の記述に**偽になったものは無い**ので Warning 止まり。
  - 提案: Worker runner 節の Scope tasks 行か直後の段落に 1 文。「claim はリースを取るので、settle されなかった行（ハンドラ未登録を含む）は `SCOPE_TASK_LEASE_MS` が経つまで tick に現れない。停滞はログの頻度ではなく `dueAt` からの経過で測る」程度。

## 検証したこと（Blocker 無しの根拠）

- **1 本道**: `TuningEnv.SCOPE_TASK_LEASE_MS`（`di/env.ts:16`）→ `readScopeTaskTuning`（`:65-69`）→ `server.node.ts:109` `scopeTaskLeaseMs` → `runner.ts:36,133-140` → `runDueScopeTasks(container, { leaseMs })`（`scopeTaskRunner.ts:145,163`）→ `claimDue({ now, limit, leaseMs })`。分岐は無く、`runDueScopeTasks` の他の本番呼び出し元も無い（grep 済み、他は runner とテストのみ）。interval 経路と `ScopeTaskTrigger.kick()` 経路・`start()` の初回 drain はすべて同じ `runScopeTaskTick` クロージャを通る。
- **既定値の二重定義は無い**: 既定は `scopeTaskTuningSchema` の `.default(SCOPE_TASK_LEASE_MS)` と `runDueScopeTasks` の `?? SCOPE_TASK_LEASE_MS` の 2 か所に現れるが、どちらも `ports/scopeTaskScheduler.ts:44` の同じ定数を参照していて乖離しえない。`OUTBOX_LEASE_MS`（`relayTuningSchema` の `.default(DEFAULT_LEASE_MS)` + `processOutboxEvents` 側の `?? DEFAULT_LEASE_MS`）と同型。
- **`OUTBOX_LEASE_MS` との対称性**: 差分外の全経路（`env.ts` → `server.node.ts` の `relayOptions` → `runner.ts` の `tuning.relayOptions ?? {}` → `processOutboxEvents`）を読んで照合。relay がオプション束をまるごと渡すのに対しスコープタスクはスカラー 1 個、という形の違いだけで、既定・検証・boot 拒否のタイミングはすべて同じ。runner 側の `tuning.scopeTaskLeaseMs !== undefined ? … : {}` は本番経路では常に定義済み（`readScopeTaskTuning` が既定を埋める）だが、`exactOptionalPropertyTypes` 下でオプショナルを転送する定型なので冗長ではない。
- **エラーメッセージの実効性**: `leaseMsField` を実際に走らせて全経路を確認した（`readNodeServerEnv` → `nodeServerEnvToTuningEnv` → `readScopeTaskTuning` / `readRelayTuning`）。未設定・`""` → 既定値。`"abc"` / `"300_000"` / `"300000ms"`（NaN）、`"1.5"`（int）、`"0"` / `"-1"` / `"  "`（positive）、`"Infinity"` のすべてで `SCOPE_TASK_LEASE_MS must be a positive integer (ms)` / `OUTBOX_LEASE_MS must be …` が出る。zod の issue path はどちらも `leaseMs` なので、変数名を message に載せた判断（JSDoc の理由づけ）は実際に必要で、かつ有効。`"1e3"` → 1000 / `"0x10"` → 16 と緩く通るのは `z.coerce` の既存挙動で、他の tuning 変数と同じ。
- **dev / 本番の両経路**: `pnpm dev`（`vite dev`）を実際に起動して確認。`SCOPE_TASK_LEASE_MS=0` を与えると初回リクエストで boot が `readScopeTaskTuning (di/env.ts:66) ← boot (server.node.ts:109)` のスタックで拒否し、message に変数名が載る（HTTP 500）。未指定なら通常起動する。`apps/web/.env` は dev でも `process.env` に届いている（APP_URL / OAuth が .env 由来で boot が通ることから確認）ので、`.env` に書いた `SCOPE_TASK_LEASE_MS` も dev に効く。本番は `scripts/listen.node.ts:23` の dotenv → 同じ `boot()` なので同一経路。※dev では boot 失敗がプロセス終了ではなくリクエスト毎の 500 になるが、これは遅延 boot の既存仕様で全 env 共通。
- **`.env.example` / `docs/runtime_node.md`**: `#SCOPE_TASK_LEASE_MS=300000` と表の既定 `300000` が `SCOPE_TASK_LEASE_MS = 5 * 60 * 1000` と一致。「no / 既定あり」の分類も正しい。`.env.example` の配置は `# --- Optional: outbox / worker tuning` 節の末尾で妥当。
- **既定値の妥当性**: 1 round の claim 上限は `SCOPE_TASK_TICK_LIMIT = 100`、既定リース 5 分＝1 行あたり 3 秒の予算。in-memory の 1 turn はミリ秒オーダーで、かつ `createInProcessRelayTrigger` が round を 1 本に直列化する（単一プロセスでは 2 本目の round が走っているリースを踏めない）ので、参照ランタイムでは十分。`runDueScopeTasks` の budget 会計（claim 件数 ≤ 処理件数）も破れていない: `claimDue(limit: budget)` の直後に同じ budget を 1 件ずつ減らすので、claim したまま放置される行は出ない。ステップ 8 の WHY コメント（`scopeTaskRunner.ts:158-160`）はこの不変条件を正しく説明している。
- **コメント**: 追加された WHY コメント（`di/env.ts:19-23` / `di/serverNode.ts:118-125` / `scopeTaskRunner.ts:158-160` / `runner.ts:36`）はいずれも非自明な制約か不変条件を述べていて、修正の経緯・レビューへの弁明の混入は無し。`scopeTaskHandlers` の JSDoc 書き直しも同様。
- **セキュリティ**: 追加された env は数値のチューニング値のみ。ログ・エラーメッセージに載るのは変数名と zod の issue（値そのものは `received: "NaN"` 等の型名まで）で、機密の露出は無い。

## カバレッジ

- 確認: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`（リース周期に関わる 2 ケースのみ）, `packages/core/src/application/ports/scopeTaskScheduler.ts`（`SCOPE_TASK_LEASE_MS` 定数と `leaseMs` 契約の参照として。ポート契約自体の是非は port/application 観点の持ち分）, `.thread/19/plan.md`
- 差分外で参照: `packages/core/src/application/di/__tests__/serverNode.test.ts`, `apps/web/vite.config.node.ts`, `apps/web/scripts/listen.node.ts`, `packages/core/src/application/workers/eventRelayWorker.ts`（`OUTBOX_LEASE_MS` の先例照合）, `docs/runtime_node.md`, `README.md`, `CLAUDE.md`
- スキップ: `packages/core/src/adapters/**`（`conformance/scopeTaskScheduler.ts`, `memory/repositories/scopeTaskScheduler.ts`, `memory/scopeTaskQueue.ts`, `memory/scopeTaskSelection.ts`, `memory/store.ts`, `memory/__tests__/unitOfWork.test.ts`）— アダプター観点の持ち分で、ランタイム配線に触れない
- スキップ: `packages/core/src/application/{cleanup/personalCleanup.ts,identity/__tests__/*,storage/deleteFilesByOwner.ts,storage/__tests__/*,usage/deleteQuota.ts}` — priority 付与とテスト追随はユースケース観点の持ち分
- スキップ: `packages/core/src/application/ports/scopeTaskQueue.ts` — ポート契約の JSDoc で、env 配線に関わらない
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — spec 観点の持ち分
- スキップ: `.thread/19/{adr.md,steps.md,testing.md}` — 実装計画の足場（plan.md のみ契約として参照）
- スキップ: `.thread/19/review/*` — 本 PR のレビュー記録そのもの（Phase 7 で削除）
