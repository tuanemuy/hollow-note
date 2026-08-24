# TC-001 観測ログ: アカウント削除が claim → 処理 → settle を跨いで完走する

**セッション:** verify-tc-001
**実行日:** 2026-08-24

## 実行ログ

| # | 操作 | 期待結果 | 実際に観測した内容（原文） |
|---|------|---------|--------------------------|
| 1 | `http://localhost:3100/signin` を開く | サインイン画面表示 | ページタイトル「サインイン — Hollow」、URL `http://localhost:3100/signin`。見出し「サインイン」、`textbox "メールアドレス"`、`textbox "パスワード"`、`button "サインイン" [disabled]`、`button "Google で続ける"`、`link "アカウントを作る"` を表示 |
| 2 | 「Google で続ける」を押す → 同意画面で email `del-a@example.com` / 表示名 `削除太郎` / `email_verified` ON → 「許可する」 | 同意画面が出てサインインが完了する | クリック後、見出し「開発用 ID プロバイダー」の同意画面に遷移。初期値は `textbox "メールアドレス"` = `dev-user@example.com`、`textbox "表示名"` = `Dev User`、`checkbox "メールアドレスは確認済み（email_verified）" [checked=true]`（デフォルトでチェック済み）。値を `del-a@example.com` / `削除太郎` に書き換えて「許可する」をクリック → `/notes` に遷移し、見出し「個人」「最初のノートを作る」、`button "白紙から書く"` を表示（サインイン成功、初回ユーザーでノート0件の状態） |
| 3 | `/notes` でノートを3件作る | 3件のノートが作成される | 「白紙から書く」→「新規作成」ボタンで3回ノート作成を実行。エディタ画面の見出し `h1`（テキスト「無題」）はクリック・fill・press操作を試みたがタイトルへの入力が反映されなかった（`document.activeElement` が `BODY` のままで、h1やその周辺に `contenteditable` / `textarea` / `input` / `[role=textbox]` が見つからず、DOM上に編集可能要素を特定できなかった）。そのためタイトルは指定できず、3件とも既定の「無題」のまま作成された。`/notes` 一覧では `link "無題 非公開。 更新 8月24日 03:17/03:18 8月24日"` が3件表示された |
| 4 | `/settings/profile` で「画像を選ぶ」から `/tmp/hollow-manual-19/avatar.png` を選び保存 | 画像がアップロードされる | `/settings/profile` を開くと見出し「公開プロフィール」、`button "画像を選ぶ"`、`textbox "表示名"`（値 `削除太郎`）等を表示。`input[type=file]` の存在は `eval` で確認できた（`true`）が、`fill` コマンドでパスを指定しても `files.length` は `0` のままで反映されなかった。**ファイル選択は agent-browser で操作できなかったため記録のみで次へ進んだ** |
| 5 | サーバーログの行数記録・手順3/4中の `[scope-tasks]` 確認 | — | 手順4完了時点のログ行数は 74 行。`grep scope-tasks` は手順3・4の操作中を通じて `NO_MATCH`（該当行なし） |
| 6 | `/settings/danger` を開き確認欄に `del-a@example.com` を入力し「アカウントを削除する」を押す | 削除処理が開始される | `/settings/danger` の見出し「アカウントを削除」、`textbox "確認のため、アカウントのメールアドレスを入力してください"`、`button "アカウントを削除する"` を表示。値を入力してクリック |
| 7 | 進捗表示を観察（最大60秒、10秒おき） | `accepted`→`running`→`completed` の推移 | クリック後 `wait 1000`（約1秒）を挟んで最初のスナップショットを取得した時点で、既に見出しが「アカウントを削除しました」・`button "トップページへ"` に変わっていた。`accepted` / `running` 等の中間状態文言はこの1回のスナップショットでは捕捉できなかった（推移を追う前に完了していた可能性が高いが、判定はしない） |
| 8 | 完了後「トップページへ」を押し、`/notes` を開く | トップページへ遷移、`/notes` はサインインへ倒れる | 「トップページへ」クリック後 `window.location.href` は `http://localhost:3100/`、画面は `link "サインイン"` `link "はじめる"` `heading "チームのための ひとつのノート。"` を表示（未サインイン状態のトップページ）。続けて `/notes` を開くと URL は `http://localhost:3100/signin?redirect=%2Fnotes` にリダイレクトされ、見出し「サインイン」の画面を表示 |
| 9 | 手順5以降に増えたサーバーログを確認 | — | ログ行数は 74 → 138 行に増加。増分には `[queue] received identity.accountDeletionManifestBuildContinued ...`、`[queue] received identity.accountDeletionDispatchContinued ... cleanup / redaction / finalize:uniquenessRelease / finalize:redaction / finalize:authResidue`、`[queue] received identity.userAuthResidueCleanupContinued ...`（2回）、`[deleteAccount] finalize is still waiting { operationId: '01a02fd9-0250-775f-8729-4a428dc61bf2', attemptedBy: 'uniquenessRelease', receipts: [ 'personalCleanup', 'uniquenessRelease' ] }`、`[queue] received identity.user.deleted ...`、`[subscribers] no subscriber for identity.user.deleted { eventId: '01a02fd9-0258-768a-8440-cfb9a9443f1e', eventType: 'identity.user.deleted' }`、`[queue] received identity.accountDeletionManifestCompactContinued ... compact:-` が含まれていた。`[scope-tasks]` というプレフィックスの行は増分中に一つも出現しなかった |

## 進捗表示の推移（手順7）

| 経過秒 | 表示された文言（原文） |
|---|---|
| 0 | （クリック直後、スナップショット未取得） |
| 約1 | 見出し「アカウントを削除しました」、`button "トップページへ"`（この時点で既に完了表示） |

完了までの所要時間: 明確な計測はできなかったが、クリックから約1秒後（`wait 1000` を挟んだ最初のスナップショット取得時点）には既に完了画面「アカウントを削除しました」が表示されていた。`accepted` / `running` 等の中間状態の文言は観測されなかった（1秒未満で遷移した可能性、または中間状態の表示自体がない可能性のいずれかは判定しない）。

## サーバーログの観測

- `[scope-tasks] task threw`: 出ない（ログ全体・増分ともに該当行なし）
- `[scope-tasks] backoff failed`: 出ない
- `[scope-tasks] no handler for`: 出ない
- 完了後の周期的な警告: なし（完了後15秒待って再確認したが、ログ行数は138行のまま増加なし。`[scope-tasks]` 系の行も引き続き0件）
- 手順3・4の操作中の `[scope-tasks]` ログ: なし（`grep scope-tasks` は `NO_MATCH`）
- 補足: サーバーログ全体を通じて `[scope-tasks]` というプレフィックスの行は一度も出現していない。実際に出現したのは `[queue]` / `[deleteAccount]` / `[subscribers]` プレフィックスのログのみ

## 未実行・観測できなかった手順

- 手順3のノートタイトル指定: エディタのタイトル要素（`h1`）に対する `click` / `fill` / `press` がいずれも編集状態への遷移を発生させず（`document.activeElement` が `BODY` のまま）、タイトル文字列を入力できなかった。3件とも既定の「無題」のまま作成
- 手順4のアバター画像選択: `input[type=file]` は存在したが、`fill` コマンドでファイルパスを指定しても `files.length` が `0` のままで反映されず、agent-browser では操作できなかった。手順の指示通り記録のみで次へ進んだ
- 手順7の10秒おき連続観測: クリックから約1秒後の最初のスナップショット時点で既に完了表示だったため、10秒間隔での複数回スナップショットは実施しなかった（完了後の状態が変化しないと判断したため。5分のタイムケース制限内で完了確認と手順8・9を優先した）
