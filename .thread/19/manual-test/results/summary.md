# 動作検証サマリー — Issue #19 / PR #40

**実行日:** 2026-08-24
**テストソース:** `.thread/19/testing.md`
**ブランチ:** `issue/19/scope-task-priority-lease`
**サーバー:** `http://localhost:3100`（`pnpm dev`。項目 4 のみ `pnpm build` → `pnpm start`）

| # | 確認項目 | 対応 AC | 手段 | 結果 |
|---|---|---|---|---|
| 1 | アカウント削除が claim → 処理 → settle を跨いで完走する | AC-16 / AC-7 | browser | **PASS** |
| 2 | 2 アカウントの削除を並行して受理しても両方完走する | AC-6 / AC-16 | browser | **PASS** |
| 3 | `SCOPE_TASK_LEASE_MS` を配備側が選べる（dev で値が届く） | AC-17 | browser | **PASS** |
| 4 | 正でない `SCOPE_TASK_LEASE_MS` は boot を拒否する | AC-17 | api | **PASS** |
| 5 | 静的検査が緑 | AC-16 | api | **PASS** |
| 6 | 適合スイートと application 層のテストが緑 | AC-12 / 11 / 13 / 16 | api | **PASS** |
| E1 | 削除の進行中に dev サーバーがリロードされてもデッドロックしない | AC-8 / AC-16 | browser | **未再現（通過扱い）** |
| E2 | 極端に短いリースでも取り違えが起きない | AC-17 / AC-7 | browser | **PASS** |

**合計:** 8 件（PASS: 7 / 未再現: 1 / FAIL: 0）

**起票した Issue:** なし（変更起因の FAIL がゼロのため）

---

## 判定の根拠

### 1. アカウント削除が完走する — PASS

`del-a@example.com` の削除がクリックから**約 1 秒**で「アカウントを削除しました」に到達。「トップページへ」で未サインインのトップに遷移し、`/notes` は `signin?redirect=%2Fnotes` に倒れた。サーバーログに `[scope-tasks] task threw` / `backoff failed` / `no handler for` は 1 行も出ず、完了後 15 秒待っても周期的な警告は立たなかった。ノート作成中（通常の書き込み操作）にも `[scope-tasks]` ログは出ていない。

期待結果は「数秒（遅くとも 60 秒以内）で完了する」。**リース期間（既定 5 分）ぶん止まる退行は観測されなかった。** 中間状態（`accepted` / `running`）の文言を捕捉できなかったのは、完了がサンプリング間隔より速かったためで、期待結果と矛盾しない。

補足: この回はノートのタイトル入力とアバターアップロードが agent-browser で操作できず、既定タイトルのノート 3 件のみで実行した。アバターは項目 3 以降で `upload` コマンドにより成功している。

### 2. 並行削除で両方完走する — PASS

`del-b@example.com` と `del-c@example.com` の削除クリックを **0.047 秒差**（同一秒内）で撃った。両方とも「アカウントを削除しました」に到達。サーバーログでは 2 つの `operationId`（`01a02fdd-0432-…` / `01a02fdd-0433-…`）の処理行がほぼ完全に交互に出現し、それぞれ別の `aggregateId` で `identity.user.deleted` に到達しており、**2 つの削除が実際に重なっていた**ことが確認できる。片方が `running` のまま止まる状態は一度も観測されなかった。`[scope-tasks]` 系エラーなし。

### 3. `SCOPE_TASK_LEASE_MS` が dev に届く — PASS

`apps/web/.env.example` に `#SCOPE_TASK_LEASE_MS=300000`（既定値つきコメント）が実在することを確認（AC-17 の「配備側が口の存在を知れる」側面）。**その行の書式のまま** `apps/web/.env` に `SCOPE_TASK_LEASE_MS=600000` を置いてサーバーを起動し、500 も zod エラーも出ずに正常応答した。`del-d@example.com` の削除は**約 2 秒**で完了し、既定値のときと所要時間が変わらない。この回でアバターアップロード（`upload` コマンド）も成功している。

### 4. 正でない値は boot を拒否する — PASS

本番ランチャー（`pnpm build` → `pnpm start`、`NODE_ENV=production`）で観測:

| 入力 | 終了コード | 観測 |
|---|---|---|
| `SCOPE_TASK_LEASE_MS=0` | 1 | `[listen.node] failed to start ZodError`、`path: ["leaseMs"]`、`too_small` / `minimum: 0`。`listening on` は出ない |
| `SCOPE_TASK_LEASE_MS=abc` | 1 | 同様に `path: ["leaseMs"]`、`code: "invalid_type"`、`received: "NaN"`。`listening on` は出ない |
| 行を削除（未設定） | — | `[listen.node] listening on http://0.0.0.0:3000` で起動 |

`OUTBOX_LEASE_MS=300000` を併置した状態でも起動しており、既存 4 変数の射影が壊れていないことも同時に確認できた（「既存機能への影響確認」の該当項目）。

### 5. 静的検査が緑 — PASS

`pnpm typecheck` / `pnpm lint:fix` / `pnpm format` がいずれも終了コード 0。実行後の `git status --short` は空で、書き込み系コマンドによる差分は出なかった。

### 6. 適合スイートと application 層のテストが緑 — PASS

`pnpm test` が終了コード 0、`Test Files 76 passed (76)` / `Tests 958 passed | 3 skipped (961)`。verbose 実行で、適合スイート・`scopeTaskRunner.test.ts`・回帰群（`deleteAccount.cleanup` / `deleteAccount.terminalPrune` / `deleteFilesByOwner` / `deleteQuota` / `adapters/memory/__tests__/unitOfWork`）がすべて緑で含まれていることを確認した。

### E1. HMR リロード中の reclaim — 未再現（通過扱い）

`SCOPE_TASK_LEASE_MS=10000`（10 秒）で **3 回試行**（ノート 20 件 / 10 件 / 5 件、HMR トリガーの時刻をクリックの同一秒・12ms 後・35ms 前と変えた）。**HMR は 3 回とも実際に起きた**（`[vite] (client) hmr update … /app/routes/index.tsx` / `(ssr) page reload` / `(ssr) program reload`）が、いずれの回も削除の継続イベント（manifest build → cleanup / redaction dispatch → finalize → compact）が vite のリロード行より前にすべて出揃っており、画面は最初の確認時点（クリックから 2〜5 秒）で既に完了表示だった。

**削除は 3 回とも完走した。** リース失効による reclaim の観測には至らなかったが、これは `testing.md` が事前に規定した扱い — 「3 回試して窓に入らなければ『未再現』と記録して打ち切る（既定の在庫では turn が短すぎるという事実の記録であって、失敗ではない）」 — に該当する。`[scope-tasks]` 系エラーは 3 回ともゼロ。`apps/web/app/routes/index.tsx` は `touch` のみを使ったため差分なし（`git status` / `git diff` で確認済み）。

AC-8（リース失効後の reclaim）の担保は、適合スイートの reclaim ケース群（Round 2〜4 でミューテーション実証済み）に残る。

### E2. 極端に短いリースでも取り違えが起きない — PASS

`SCOPE_TASK_LEASE_MS=1000`（1 秒 = ランナーの tick と同じ長さ）で `del-g@example.com` を削除。ノート 20 件 + アバターありの状態で、**約 5 秒**で完了表示に到達した。**`[scope-tasks] task threw` は 0 件**（`backoff failed` / `no handler for` も 0 件）で、`testing.md` が「1 秒という極端な値で顕在化しうる」としていた取り違えの窓には入らなかった。実装済み 4 kind がいずれも自分の turn の中で settle するという期待どおりの結果。

参照ログ（項目 3、リース 600000ms）との比較では `[queue] received` が 12 行で一致、イベント種別 6 種が完全一致、今回にしか出ない行種別はなし。唯一の差は `[deleteAccount] finalize is still waiting` の回数（今回 1 / 参照 2、`attemptedBy: 'redaction'` の有無）で、これはイベント到着順序の揺れによるもの。

`testing.md` はこの「ログが何も変わらない」状態を「env の値が `claimDue` まで届いていない疑い」の手がかりとしていたが、**配線は別の経路で positive に確認済み**なので疑いは晴れている:

1. 項目 4 — `SCOPE_TASK_LEASE_MS=0` / `abc` が `path: ["leaseMs"]` の zod エラーで boot を落とす（env → スキーマ）
2. `di/__tests__/serverNode.test.ts` の追加ケース — 値を入れたとき `SCOPE_TASK_LEASE_MS` / `OUTBOX_LEASE_MS` がそれぞれの tuning まで素通しで届く（スキーマ → tuning）
3. `apps/web/app/worker/node/runner.ts` → `runDueScopeTasks({ leaseMs })`（tuning → runner）
4. 適合スイートの `holds a claimed row for the leaseMs it was given` — `claimDue` が引数の `leaseMs` を使うことをミューテーションで実証（runner → `claimDue`）

そもそもリース 1 秒で観測可能な差が出るのは**取り違えが起きたとき**だけなので、ログが同一であること自体が期待結果と整合している。

---

## 実行上の注意（次回のために）

- **サーバーの停止確認は必須。** E2 の初回実行は `pkill -f "vite dev --config vite.config.node.ts"` がプロセスのコマンドライン（`node …/vite.js dev --config vite.config.node.ts`）に一致せず停止に失敗し、リース 10 秒の旧プロセスに対して観測していた（`server.log` の `Port 3100 is already in use` で発覚）。プロセスを入れ替えて再実行し、本記録は再実行の結果。停止パターンは `vite.js dev` を使う
- **`input[type=file]` は `fill` では動かない。** `upload <sel|@ref> <パス>` を使う（`_shared/references/agent-browser.md` に追記済み）
- 削除がどの条件でも数秒で完走するため、`accepted` → `running` の中間状態はブラウザのサンプリングでは捕捉できない
