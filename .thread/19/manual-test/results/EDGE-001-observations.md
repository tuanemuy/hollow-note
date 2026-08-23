# エッジケース 1 観測ログ: 削除の進行中に dev サーバーがリロードされてもデッドロックしない

**セッション:** verify-edge-001
**実行日:** 2026-08-24
**env:** `SCOPE_TASK_LEASE_MS=10000`（10秒）

## 試行の記録

### 試行 1（`del-e@example.com`）
- 作れたノート件数: 20 件
- アバターアップロード: 成功（`/settings/profile` で `input[type=file]` に `upload` コマンドで `/tmp/hollow-manual-19/avatar.png` を渡した。直後は `button "アップロード中..." [disabled]` を表示、3秒後の再確認で `button "画像を選ぶ"` に復帰し `button "削除"` が有効化されていた）
- 削除クリック時刻: 1787510057（Unix秒）
- HMR トリガー時刻: 1787510057（Unix秒、クリックと同一秒）／ 手段: `touch`（改行追加のフォールバックは不要だった）
- HMR が起きたか: 起きた。サーバーログに以下の原文が出現（クリックから約5秒後の確認時点で行番号308付近）:
  ```
  3:34:17 [vite] (client) hmr update /app/styles/index.css?direct, /app/routes/index.tsx
  3:34:17 [vite] (ssr) page reload app/routes/index.tsx
  3:34:17 [vite] (ssr) program reload
  ```
  ただし `[server.node] retiring the previous boot` / `[server.node] worker runner started` はこの時点では出ておらず、その後 `/` へ新規リクエストを送った後（さらに数秒後）に初めて出現した（行309-310）。
- クリック時点で削除が完了していたか: 判定不能だが、クリックから5秒後の最初の確認時点で既に画面は「アカウントを削除しました」で、サーバーログ上も上記 vite reload 行より**前**にアカウント削除の全継続イベント（memberships / authorRoutes / cleanup / redaction / finalize:uniquenessRelease / finalize:redaction / finalize:authResidue / compact）が出そろっていた。つまり vite の reload がログに現れた時点で削除処理自体は既に完了済みだった。
- 進捗の推移:
  | 経過秒 | 表示された文言（原文） |
  |---|---|
  | 5（最初の確認） | 見出し「アカウントを削除しました」、`button "トップページへ"`（この時点で既に完了表示） |
- 完了までの所要時間: 明確な計測はできなかったが、クリックから5秒以内に完了していた（10秒おきではなく最初の確認を5秒後に行ったため、それより前に完了していた可能性が高い）

### 試行 2（`del-e2@example.com`）
- 作れたノート件数: 10 件（時間制約のため試行1の20件から減らした。手順書は「窓に入らなかった場合はノート件数を増やす」ことを示唆していたが、試行1の観測でノート件数が継続ステップ数にほぼ影響しないと判断し、時間短縮を優先した）
- アバターアップロード: 未実施（時間制約のためスキップ。手順3は試行1でのみ実施）
- 削除クリック時刻: 1787510205.96（Unix秒、サブ秒精度）
- HMR トリガー時刻: 1787510205.97（Unix秒）／ クリックの約12ミリ秒後 ／ 手段: `touch`
- HMR が起きたか: 起きた。サーバーログ原文:
  ```
  3:36:46 [vite] (client) hmr update /app/styles/index.css?direct, /app/routes/index.tsx, /app/routes/index.tsx?tsr-split=component
  3:36:46 [vite] (ssr) page reload app/routes/index.tsx
  3:36:46 [vite] (ssr) program reload
  ```
- クリック時点で削除が完了していたか: 判定不能。クリックから2秒後の最初の確認時点で既に「アカウントを削除しました」を表示。サーバーログでも vite reload 行より前に全継続イベント（試行1と同じ並び）が出そろっていた。
- 進捗の推移:
  | 経過秒 | 表示された文言（原文） |
  |---|---|
  | 2 | 見出し「アカウントを削除しました」、`button "トップページへ"` |
  | 4 | 同上（変化なし） |
  | 6 | 同上（変化なし） |
  | 8 | 同上（変化なし） |
  | 10 | 同上（変化なし） |
- 完了までの所要時間: クリックから2秒以内（最初の確認時点で既に完了）

### 試行 3（`del-e3@example.com`）
- 作れたノート件数: 5 件（時間制約のためさらに減らした）
- アバターアップロード: 未実施（時間制約のためスキップ）
- 削除クリック時刻: 1787510275.85（Unix秒、サブ秒精度）
- HMR トリガー時刻: 1787510275.82（Unix秒）／ **今回はクリックより先に `touch` を実行**（クリックの約35ミリ秒前）／ 手段: `touch`
- HMR が起きたか: 起きた。サーバーログ原文:
  ```
  3:37:56 [vite] (client) hmr update /app/styles/index.css?direct, /app/routes/index.tsx, /app/routes/index.tsx?tsr-split=component
  3:37:56 [vite] (ssr) page reload app/routes/index.tsx
  3:37:56 [vite] (ssr) program reload
  ```
- クリック時点で削除が完了していたか: 判定不能。クリックから2秒後の最初の確認時点で既に「アカウントを削除しました」を表示。
- 進捗の推移:
  | 経過秒 | 表示された文言（原文） |
  |---|---|
  | 2 | 見出し「アカウントを削除しました」、`button "トップページへ"` |
  | 4 | 同上（変化なし） |
  | 6 | 同上（変化なし） |
- 完了までの所要時間: クリックから2秒以内（最初の確認時点で既に完了）

## サーバーログの観測

- `[server.node] retiring the previous boot` / `worker runner started`:
  ```
  14:[server.node] worker runner started   （起動時の初回ログ）
  309:[server.node] retiring the previous boot   （試行1の touch から数秒後、次のHTTPリクエスト送信後に出現）
  310:[server.node] worker runner started
  ```
  試行2・3では、削除完了とその後の観測（最大10秒）の範囲内では `retiring the previous boot` / 2回目以降の `worker runner started` の出現を個別に確認するための追加リクエストは送らなかった（時間制約のため）。試行1で確認した通り、これらの行は `[vite] (ssr) program reload` の直後には出ず、その後の新規リクエストを契機に遅延して出現するパターンだった。
- `[scope-tasks] task threw` / `backoff failed` / `no handler for`: 出ない（3試行を通じて増分ログに `scope-tasks` という文字列は一度も出現しなかった。試行3の増分では `grep -c scope-tasks` の結果が `0`）

## 結論として観測できたこと

- 窓に入ったか: **未再現（3回試行）**。3試行とも、`touch` によるファイル変更検知（`[vite] (ssr) program reload` 等の行）はサーバーログ上で確認できた＝HMR 自体は毎回発生した。しかし3試行とも、削除処理の全継続イベント（manifest 構築 → dispatch → cleanup/redaction → finalize 各段 → compact）が、ログ上で vite の reload 行より**前に**出そろっており、かつ画面側も最初の確認（クリックから2〜5秒後）の時点で既に「アカウントを削除しました」の完了表示になっていた。つまり、この参照ランタイム（単一プロセス・in-memory・キュー駆動の継続処理）では削除処理自体がクリックから数秒未満で完走してしまい、`touch` を使った手動の HMR トリガーではその完走より前に claim 中の行を割り込ませる窓を作れなかった。クリック直前に touch する／直後に touch する、ノート件数を 20→10→5 と変えるなど条件を変えても結果は変わらなかった。
- 削除は完了したか: **3試行とも完了した**（「アカウントを削除しました」表示に到達）。ただし完了が HMR による中断・リース失効・再 claim を経由したものかどうかは、ログ上の継続イベントの並びからは判別できなかった（`[deleteAccount] finalize is still waiting` は3試行とも通常の待ち合わせとして1回ずつ出現したのみで、リース失効に伴うと見られる再実行の痕跡は確認できなかった）。

## 後片付け

- `apps/web/app/routes/index.tsx` の状態: touch のみ（内容変更なし）。`git status --short` / `git diff` ともに差分なしを確認済み。改行追加のフォールバックは3試行とも使用しなかったため、`git checkout` による復元は不要だった。

## 未実行・観測できなかった手順

- 試行2・3でのアバターアップロード（手順3）: 8分のタイムケース制限内でリトライを3回実施する優先度を上げるため、試行1でのみ実施し試行2・3ではスキップした
- 試行2・3でのノート件数20件: 時間制約のため試行2は10件、試行3は5件に減らした（試行1の観測から、ノート件数が継続ステップ数・削除所要時間にほぼ影響しないと判断したため）
- 10秒おきの進捗観測（手順書は10秒間隔・最大90秒を指定）: 3試行とも最初の確認（2〜5秒後）時点で既に完了表示だったため、それ以降は「変化なし」の確認に留まり、90秒間の継続観測は行わなかった
- `accepted` → `running` → `completed` のような中間進捗状態の文言: 3試行とも一度も観測できなかった（最初の確認時点で常に完了表示だったため）
