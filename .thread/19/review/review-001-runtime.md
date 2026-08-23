# レビュー 001 — Runtime Wiring

## Runtime Wiring

### Blockers

なし。

`SCOPE_TASK_LEASE_MS` の配線は 1 本道で通っており、値が落ちる箇所も既定値の二重定義も無い。詳細は「検証したこと」を参照。

### Warnings

- **[W-001]** `docs/runtime_node.md` の環境変数表に `SCOPE_TASK_LEASE_MS` の行が無い。先例の `OUTBOX_LEASE_MS` は `.env.example` と `docs/runtime_node.md` の両方に載っているので非対称
  - 場所: `docs/runtime_node.md:58-71`（Environment variables の表）/ `apps/web/.env.example:78-81`
  - 理由: CLAUDE.md が `docs/runtime_node.md` を「operating the runtime」の companion と位置づけており、この表は「boot が検証するスキーマ」の一覧という体裁（同ファイル 56 行目）で `PORT` / `HOSTNAME` / `OUTBOX_*` / `MEMORY_MAIL_LOG_ACTION_URL` まで網羅している。1 行足りないだけで「表に無い＝存在しない」と読める。さらに悪いことに、この変数の**唯一の散文説明が `application/ports/scopeTaskScheduler.ts` の JSDoc**（126-129 行「That runtime chooses the value with the `SCOPE_TASK_LEASE_MS` environment variable」）にある。ポートはバックエンド非依存の契約正本（ADR 026）で、Node ランタイム固有の環境変数名を運用ドキュメントより先に抱えるのは配置が倒置している。#11 が Cloudflare で wrangler var にした瞬間、ポート JSDoc の側が古くなる
  - 提案: `docs/runtime_node.md` の表に `| SCOPE_TASK_LEASE_MS | no | 300000 | Lease window (ms) a scope-task claim holds its batch for. |` を 1 行追加する（`OUTBOX_LEASE_MS` の直後が自然）。あわせてポート JSDoc の当該文は「配備側が選ぶ値であること」と「短すぎたときの実害」に留め、変数名は運用ドキュメント側に置く（`leaseMs` が呼び出し側の責務であるという契約自体はポートに残す）

- **[W-002]** `SCOPE_TASK_LEASE_MS` が拒否されたとき、boot のエラーが `OUTBOX_LEASE_MS` の拒否と区別できない
  - 場所: `packages/core/src/application/di/env.ts:33-35`（`scopeTaskTuningSchema`）／ 同 `:21`（`relayTuningSchema`）
  - 理由: 2 つのスキーマがどちらもフィールド名 `leaseMs` を使うため、zod の issue path は両方とも `["leaseMs"]` になる。`pnpm start` では `listen.node.ts:245-247` が `console.error("[listen.node] failed to start", cause)` して exit 1 するので、運用者が見るのは `leaseMs: Too small ...` だけ。変数が 1 つだったうちは一意だったが、2 つ目が入った時点で「どちらの env を直せばよいか」がメッセージから読めなくなった。境界での拒否そのものは正しく効いている（下記検証済み）ぶん、メッセージだけが弱い
  - 提案: どちらかのスキーマのキーを env 変数名そのものにする（`z.object({ SCOPE_TASK_LEASE_MS: ... })` を parse して `.leaseMs` に射影する）か、`.positive("SCOPE_TASK_LEASE_MS must be a positive integer (ms)")` のように変数名入りのメッセージを与える。後者なら 1 行で、`OUTBOX_*` 側も同じ手当てができる

- **[W-003]** 空文字（`SCOPE_TASK_LEASE_MS=`）が「未設定」ではなく「不正値」として boot を落とす
  - 場所: `packages/core/src/application/di/serverNode.ts:133-135` → `packages/core/src/application/di/env.ts:33-35`
  - 理由: `nodeServerEnvToTuningEnv` は `!== undefined` でしか弾かないので `""` はそのまま渡り、`z.coerce.number()` が `0` に落として `.positive()` が拒否する。同じファイルの `DELETION_TICKET_KEY` は `value === "" || isKeyMaterial(value)` と**空文字を明示的に未設定として扱って**おり（`serverNode.ts:73-79`）、`docs/runtime_node.md:81` は「empty values are ordinary in container manifests (`NODE_ENV=$UNSET_VAR`)」と、このリポジトリ自身が空文字を普通の形として認めている。`OUTBOX_*` の先例に揃えた結果ではあるが、揃えた先が既に穴なので、新しい変数を足すたびに穴が広がる
  - 提案: 本 PR の範囲で直すなら `nodeServerEnvToTuningEnv` の条件を `nonEmpty(...)`（同ファイルに既にある述語）へ変え、4 つの tuning 変数すべてで空文字＝未設定に揃える。範囲外とするなら、`OUTBOX_*` ごと別 Issue に切って `.thread/19` に 1 行残すこと（現状はどこにも記録が無い）

### 検証したこと（指摘に至らなかったもの）

- **配線が 1 本道であること**: `apps/web/.env` → (`scripts/listen.node.ts:23` の dotenv ／ `vite dev` は `@tanstack/start-plugin-core` の `load-env-plugin` が `Object.assign(process.env, loadEnv(mode, config.root, ""))` を実行) → `readNodeServerEnv`（`serverNode.ts:84` にキーがあるので zod の strip で消えない）→ `nodeServerEnvToTuningEnv`（`:133-135`）→ `readScopeTaskTuning`（`env.ts:55-59`）→ `server.node.ts:109` → `NodeWorkerRunnerTuning.scopeTaskLeaseMs`（`runner.ts:37`）→ `runScopeTaskTick`（`:135-140`）→ `runDueScopeTasks`（`scopeTaskRunner.ts:145`）→ `claimDue({ now, limit, leaseMs })`（`:163`）→ memory アダプター `leaseExpiresAt = now + leaseMs`（`repositories/scopeTaskScheduler.ts:79`）。途中で値が落ちる箇所は無い
- **既定値の単一定義**: 既定は `SCOPE_TASK_LEASE_MS` 定数（`ports/scopeTaskScheduler.ts:44`）1 か所のみ。`env.ts:34` の `.default()` と `scopeTaskRunner.ts:145` の `??` はどちらも同じ定数を参照しており、二重定義ではない（`outboxRetentionMs` が runner 側で `DEFAULT_OUTBOX_RETENTION_MS` を解決する先例とは形が違うが、`relayOptions ?? {}` の先例と同型で、既定値の所有者は 1 つ）
- **dev と本番の両経路に届くこと**: どちらも `apps/web/app/server.node.ts#boot` を通るので、配線としては経路差が無い。`vite dev` 側も上記プラグインが `apps/web/.env` を `process.env` へ流し込むため `.env` に書いた値が効く（`vite` の `loadEnv` 自体は `import.meta.env` にしか入れないので、この plugin が無ければ効かないという意味では暗黙の依存だが、`APP_URL` / `OAUTH_DEV_MODE` と同じ前提で既存）
- **正でない値・非数値の拒否**: `z.coerce.number().int().positive()` により `0` / 負値 / `abc`（NaN）はいずれも parse で throw。`pnpm start` は `listen.node.ts:245-247` で exit 1、つまり「黙って既定値に落ちる」経路は無い（AC-17 の「正でない値は boot が拒否する」を満たす）。dev はブート遅延のため初回リクエスト時に失敗する（既存の全変数と同じ性質）
- **`.env.example` とスキーマの一致**: `#SCOPE_TASK_LEASE_MS=300000` は定数 `5 * 60 * 1000` と一致。説明文（「バッチ全体を覆う必要がある」「超過すると別 writer が再武装した行を settle して継続の鎖が止まる」）はポート JSDoc の記述および `runDueScopeTasks` の実挙動と食い違わない
- **既定 5 分と `claimDue` のバッチ上限**: 1 round の claim は `SCOPE_TASK_TICK_LIMIT = 100` 行が上限（`scopeTaskRunner.ts:21`）。参照ランタイムの turn は in-memory アダプター上で 1 行あたりミリ秒オーダーなので、5 分は 100 行を十分覆う。逆側（reclaim の遅さ）は、turn が例外で落ちた場合は `backOff` がリースを解放し（`:185`）、プロセスが落ちた場合は store ごと消えるため、5 分待たされるのは「settle しないハンドラ」だけ — これは AC-13 が意図した挙動
- **budget 不変条件**: `claimDue` の `limit` は残 budget、claim した行は必ず 1 件ずつ budget を減らすので `claimed.length <= budget` が保たれ、「claim したまま処理されずリース期間ロックされる行」は生じない。`scopeTaskRunner.ts:158-160` の WHY コメントがこの不変条件の代償（次 tick ではなくリース満了まで）を明示していて妥当
- **ワーカー多重起動（dev の HMR）**: `server.node.ts` が旧 boot を retire してから新 boot を始める既存の仕組みは維持。仮に 2 本走っても、claim がリースを取るので同じ行が二重に配られない — Issue #19 が名指しした状況に対して配線は意図どおり効く。なお `InProcessRelayTrigger` が 1 プロセス内の tick を直列化するため、単一 runner ではリース超過による自己二重実行は起き得ない
- **ログ / 機密**: 新規のログ出力は無し。既存の `[scope-tasks] no handler for …` は `kind` / `operationId` のみで payload を出さない。リース値も出力しない
- **コメント**: 追加された散文はすべて WHY か library-level JSDoc で、弁明・修正経緯の記述は混ざっていない（`runner.ts:36`、`scopeTaskRunner.ts:120-124` / `:158-160`、`.env.example:78-80`）
- **スコープ逸脱**: 担当ファイル内に plan.md「含まれないもの」を越える変更は見当たらない。runner の round 内 budget 配分（ADR-007）は未変更、`.env.example` 以外のインフラ設定・エントリポイントの追加も無し
- **テストの非対称性**: `readRelayTuning` / `readPruneTuning` / `nodeServerEnvToTuningEnv` に専用テストが無いことを実際に確認した（`di/__tests__/serverNode.test.ts` は OAuth / runtime 初期化のみ）。`readScopeTaskTuning` にテストを足していないのは先例どおりで、指摘しない
- **typecheck**: `pnpm typecheck` 実行済み、緑（`packages/core` / `apps/web` とも Done）。`priority` が必須引数になったことで全 `schedule` / `backoffOrSchedule` 呼び出し側の付け忘れは型で捕まる構造になっている

### カバレッジ

- 確認: `.thread/19/plan.md`, `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`
  - 差分外で照合したもの: `docs/runtime_node.md`, `CLAUDE.md`, `README.md`, `apps/web/scripts/listen.node.ts`, `apps/web/vite.config.node.ts`, `apps/web/package.json`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/workers/eventRelayWorker.ts`（`OUTBOX_LEASE_MS` の全経路）, `@tanstack/start-plugin-core` の `load-env-plugin`
- スキップ: `.thread/19/adr.md`, `.thread/19/steps.md`, `.thread/19/testing.md` — 計画側の記録で、ランタイム配線の実体を持たない（plan.md のみ契約として通読）
- スキップ: `packages/core/src/adapters/memory/store.ts` — 行の判別共用体の定義でアダプター観点。リース可視性の判定（`isScopeTaskDue`）側は確認済み
- スキップ: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts` — ポート適合スイートでテスト観点
- スキップ: `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts` — テスト観点（`SCOPE_TASK_LEASE_MS` 定数の参照箇所だけ grep で確認）
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — spec 観点（AC-14 の担当）
