# レビュー 003 — Runtime Wiring

## Runtime Wiring

### Blockers

なし。

配線は 1 本道で、既定値の二重定義も値の落ちる箇所も無いことを実機で確認した。

- 経路: `NodeServerEnv`（`di/serverNode.ts:27,84`）→ `nodeServerEnvToTuningEnv`（同 `:142`）→ `TuningEnv`（`di/env.ts:16`）→ `readScopeTaskTuning`（同 `:65`）→ `server.node.ts:109` → `NodeWorkerRunnerTuning.scopeTaskLeaseMs`（`runner.ts:37`）→ `runDueScopeTasks({ leaseMs })`（`runner.ts:135-140`）→ `claimDue({ now, limit, leaseMs })`（`scopeTaskRunner.ts:163`）。`runDueScopeTasks` を叩く経路は runner の 1 秒 interval と `scopeTaskTrigger.kick()` の 2 つだが、どちらも `runScopeTaskTick` を通るので tuning を迂回する経路は無い（`runner.ts:133-151, 240, 252-254`）。
- 既定値の出どころは `SCOPE_TASK_LEASE_MS = 5 * 60 * 1000`（`ports/scopeTaskScheduler.ts:52`）ただ 1 箇所。`di/env.ts:44` の `.default()` と `scopeTaskRunner.ts:145` の `??` が同じ定数を参照しており、数値リテラルの二重定義は無い（`runner.ts` は自前の既定を持たず、未設定なら `{}` を渡して runner 側の既定に落とす）。`OUTBOX_LEASE_MS` の先例（`di/env.ts:31` → `server.node.ts:107` の `relayOptions` → `eventRelayWorker.ts:198` の `?? DEFAULT_LEASE_MS`）と同じ形。
- 両経路に届く: 本番は `scripts/listen.node.ts:23` の dotenv → `boot()`（同 `:201`）。dev は実際に `pnpm dev` を起動して確認した。`apps/web/.env` に `SCOPE_TASK_LEASE_MS=abc` を足して起動すると、初回リクエストで `ZodError … "message": "SCOPE_TASK_LEASE_MS must be a positive integer (ms)"` が `readScopeTaskTuning (di/env.ts:66) ← boot (server.node.ts:109)` のスタックで出て boot が拒否された（確認後 `.env` は復元済み・dev サーバーも停止済み）。
- エラーメッセージは全経路で意図どおり: `"abc"` / `"1.5"` / `"0"` / `"-1"` / `""` はいずれも `SCOPE_TASK_LEASE_MS must be a positive integer (ms)`、未設定は `{leaseMs: 300000}`、`"60000"` は `60000`。`OUTBOX_LEASE_MS` 側も同じ形（`OUTBOX_LEASE_MS must be a positive integer (ms)`）で、`batchSize` など変数名が一意なフィールドは zod の既定文言のまま — `leaseMsField` の JSDoc（`di/env.ts:19-23`）が述べる「`leaseMs` だけが両スキーマで衝突する」という限定と整合している。
- 空文字テストは実効的: `di/serverNode.ts:142` を `nonEmpty(...)` から `!== undefined` に戻すと `serverNode.test.ts:169` が `expected {} received { "SCOPE_TASK_LEASE_MS": "" }` で赤になることを確認した（確認後、元に戻して 17 件緑を再確認済み・`git status` クリーン）。
- 既定 5 分とバッチ上限の関係: 1 claim の最大件数は `SCOPE_TASK_TICK_LIMIT = 100`（`scopeTaskRunner.ts:21,147`）で、各行は in-memory の scope UoW 1 ターン。5 分は桁違いの余裕があり、かつ round は `scopeTaskTrigger` が直列化するので同一プロセス内でラウンドが重なることも無い。`claimDue(now, budget)` の直後に同じ budget を減らす不変条件（`scopeTaskRunner.ts:158-167`）も破れていない（`claimed.length <= budget` なので内側の `break` は到達しない）。
- 機密の露出は無い。`envDigestOf` は env 全体を JSON 化するが、不一致時の例外文（`di/serverNode.ts:240-242`）に digest を載せていないので `GOOGLE_OAUTH_CLIENT_SECRET` は漏れない。新設のログ・エラーはいずれも値を出さず変数名のみ。
- コメントに経緯・弁明・「Round N」の類は無い。`serverNode.test.ts:174` の `AC-17:` は同ファイル `:83` ほか既存箇所で使われている表記なので踏襲として問題無し。

### Warnings

- **[W-001]** 新設の「停滞は最古 task の `dueAt` age で測れ」という運用指示が、この runtime では実行できない
  - 場所: `docs/runtime_node.md:102`（および `docs/runtime_node.md:131`）
  - 理由: Node ランタイムに task age を観測する面が無い。ストアはプロセス内の memory で、管理エンドポイントも metric も無く、唯一の出力である `[scope-tasks] no handler for …`（`packages/core/src/application/workers/scopeTaskRunner.ts:170-173`）は `kind` と `operationId` しか載せず `dueAt` を出さない。`ports/scopeTaskScheduler.ts:44-51` の JSDoc は「reference runtime には oldest-task-age monitoring も自動回復経路も無い」と明言しているので、docs 側だけが存在しない計測手段を指している。しかも同じ段落で「ログの頻度は目安にならない」と、運用者が実際に持っている唯一の信号を（正しく）値引きしているため、読んだ運用者は代わりの面を探して空振りする。
  - 提案: どちらかで閉じる。(a) `[scope-tasks] no handler for …` の payload に `dueAt`（または `now - dueAt`）を足して、docs の言う計測を実際に可能にする。(b) docs 側に「この runtime では age を出す面が無く、ログ行は『そのkindが止まっている』ことの存在証明にしかならない。age で測るのはタスクが writer より長生きする配備（#11 / `spec/platform`）の話」と一言足す。(a) の方が 1 行で運用者の実利になる。

- **[W-002]** 新しいツマミの説明が、この runtime では起こり得ない多writerの危険だけを根拠にしており、値を選ぶのに要る数字が書かれていない
  - 場所: `apps/web/.env.example:78-81`, `docs/runtime_node.md:69`
  - 理由: 両方とも「turn がリースを超過すると、別の writer が再 arm した行を settle してしまう」を唯一の理由として提示している。だが Node ランタイムは単一プロセスかつ `scopeTaskTrigger` がラウンドを直列化するので、この事象は構造上起こらない（`apps/web/app/worker/node/runner.ts:146-151`）。つまり運用者はこの runtime では既定値を触る理由が無いのに、そのことが書かれていない。逆に、値が実際に効く配備（`spec/platform`）で必要な数字も書かれていない: `spec/platform/index.md:186` は priority 0 の最古 task age SLO を **1 分** と定めており、リース既定 300000 ms はその 5 倍 — つまり `.env.example` が例示する既定値は最終プラットフォームの帯（下限 = 最悪 turn 所要、上限 = age SLO）の外側にある。これは `ports/scopeTaskScheduler.ts:44-51` が「reference runtime だから許される」と根拠づけている選択だが、`.env.example` と docs だけを読む運用者には既定値を持ち出せないことが分からない。
  - 提案: docs の表の行（または `.env.example` のコメント）に一節足す。「単一プロセスの本 runtime では別 writer が存在しないので既定のままでよい。値が効くのは task が writer より長生きする backend で、そこでは `spec/platform` の帯（下限 = 最悪 turn 所要時間、上限 = age SLO。priority 0 は 1 分）から選び直すこと — 既定の 5 分はその上限を超えている」。

### カバレッジ

- 確認（差分）: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`（配線・budget・JSDoc の範囲）
- 確認（差分外・判断材料）: `apps/web/scripts/listen.node.ts`, `apps/web/vite.config.node.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/workers/eventRelayWorker.ts`, `spec/platform/index.md` / `spec/database/index.md`（差分のリース帯・SLO の照合のみ）
- 実機確認: `pnpm dev` を不正値つき `.env` で起動しての boot 拒否（`.env` 復元済み）、`di/serverNode.ts:142` を一時的に `!== undefined` へ戻しての赤確認（復元済み）、`readScopeTaskTuning` / `readRelayTuning` の全入力クラス（非数値・小数・0・負数・空文字・未設定・正常値）の挙動確認
- スキップ: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/**`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `packages/core/src/application/{cleanup,identity,storage,usage}/**` とその `__tests__` — ポート契約 / アダプター / ユースケースの観点で、Runtime Wiring の範囲外（リース値がポートまで届くことは `claimDue` の呼び出し点で確認済み）
- スキップ: `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts` — application / adapter 層のテスト観点
- スキップ: `spec/database/index.md`, `spec/platform/index.md` の改訂内容そのもの — spec 観点の担当（本レビューではリース帯・SLO の数値照合にのみ参照）
- スキップ: `.thread/19/**` — Phase 7 で削除される足場
