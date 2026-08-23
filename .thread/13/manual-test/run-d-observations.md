# Run D 観測ログ（本番ビルド） — Issue #13 / PR #36

**環境:** 本番ビルド `pnpm build` → `pnpm start` / http://localhost:3100
**セッション:** verify-run-d
**計測方法:** DevTools は使わず、agent-browser の `eval` で `performance.getEntriesByType("resource")` を testing.md 記載のスニペットのまま実行し、`_serverFn` へのリクエスト本数・`Start Time`・`responseEnd` を数値で取得。スケルトン検出は testing.md 記載の `MutationObserver`（`main[aria-busy="true"]` の追加を検出）を戻る操作の直前に仕込み、`window.__skel` の要素数を読んで判定した。

**準備:**
- `/signup` でメール `nav@example.com` / パスワード `Passw0rd123` / 表示名 `ナビ太郎` で登録。
- サーバーログ（`grep -A5 "mail.sent" prod-server.log`）から `actionUrl`（`http://localhost:3100/verify-email?token=...`）を取得して同じブラウザーで開き、メール確認が通った時点でセッションが発行され `/notes` に着地（サインイン済み）。
- `/notes` で「新規作成」ボタン相当の操作によりノートを 2 件作成（noteId 末尾 `...8ba9014` と `...4c0d`）。作成後 `/notes` を開き直し、一覧内の 1 件をクリックして `/notes/{noteId}` へ遷移し、`/notes` と `/notes/{noteId}` の両方を既訪にした。

**備考（環境上の制約）:**
- 確認項目 11 の手順 4「DevTools の Network で throttling を『Slow 4G』程度にする」は、使用した `agent-browser` CLI に DevTools 相当のネットワークスロットリングを設定するコマンドが無かった（`agent-browser --help` で確認。`network route/unroute/requests/har` はあるが帯域・遅延のエミュレーションは提供されていない）ため**未適用**（スロットリング無しの状態で計測した）。
- `click <ref>` コマンドが「新規作成」「白紙から書く」ボタン等で `✓ Done` を返しながら実際にはクリックが発生しない事象が繰り返し起きた（ネットワークリクエストも画面遷移も発生しない）ため、以降はページ内の DOM 要素を `eval` で直接 `.click()` する方式に切り替えた。この事象自体を観測として記録する（原因分析はしない）。
- testing.md の計測手順 8（HAR エクスポート）は、今回の記録フォーマットが HAR ファイルを要求していないため実行していない。

## 確認項目 11: 本番ビルドで戻ったとき 1 本の背景再取得になり、スケルトンに戻らない

**期待:**
- 戻る以降の `_serverFn` が **1 本**（`renderNoteList`）。
- 遷移は**即座に settle** し、**前回の一覧が表示されたまま**新しい内容に置き換わる。
- **戻る操作の直後に `NoteListSkeleton` が再表示されない**（4 回とも `window.__skel` が 0 件）。

**観測:**

各回とも、`/notes/{noteId}`（`.../01a02d67-44eb-7029-99db-992be50d4c0d`）でリンクを `eval` 経由でクリックして遷移した状態から開始し、`performance.clearResourceTimings()` と `MutationObserver` 仕込みを実行した直後にブラウザー「戻る」を実行した。

| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | 戻る（1回目） | 着地 URL: `http://localhost:3100/notes`。`window.__skel` = `[]`（0件）。`_serverFn` リクエスト: 1本 — `{"fn":"d844e66a363e1407c970232df1d335a7fbc7f98d5eccbe849eb843fc5e8448b5","start":44087,"end":44110}` |
| 2 | 戻る（2回目） | 着地 URL: `http://localhost:3100/notes`。`window.__skel` = `[]`（0件）。`_serverFn` リクエスト: 1本 — `{"fn":"d844e66a363e1407c970232df1d335a7fbc7f98d5eccbe849eb843fc5e8448b5","start":55131,"end":55140}` |
| 3 | 戻る（3回目） | 着地 URL: `http://localhost:3100/notes`。`window.__skel` = `[]`（0件）。`_serverFn` リクエスト: 1本 — `{"fn":"d844e66a363e1407c970232df1d335a7fbc7f98d5eccbe849eb843fc5e8448b5","start":62228,"end":62232}` |
| 4 | 戻る（4回目） | 着地 URL: `http://localhost:3100/notes`。`window.__skel` = `[]`（0件）。`_serverFn` リクエスト: 1本 — `{"fn":"d844e66a363e1407c970232df1d335a7fbc7f98d5eccbe849eb843fc5e8448b5","start":69524,"end":69531}` |

補足観測（4回目終了後の DOM 状態）:
- `snapshot -i -c` の結果、`region "ノート"` に `link "無題 非公開。 更新 8月23日 15:55 8月23日"` が 2 件表示されていた（ノート一覧本体が表示されている状態）。
- `document.querySelector('main').getAttribute('aria-busy')` の戻り値は `null`（`aria-busy="true"` が付いていない = `NoteListSkeleton` ではなく本体 `NoteList` が描画されている状態）。

**備考:** 「Slow 4G」相当のスロットリングは上記の理由により未適用のまま計測した。4回の `_serverFn` 本数はいずれも production ビルドのハッシュ化された同一関数名（`d844e66a...`）で、`start`/`end` の差はいずれも 3〜23ms 程度だった（数値をそのまま記載: 1回目 44087→44110、2回目 55131→55140、3回目 62228→62232、4回目 69524→69531）。

## 確認項目 9（本番ビルド側）: 別タブでサインアウトしたあと、既訪の `/notes` に戻るとガードが再判定される

**環境注記:** 本記録は**本番ビルド**（`pnpm build` → `pnpm start` / http://localhost:3100）での観測。DEV 側は別の担当が別途実行済み。

**期待:** DEV・本番ビルドの**どちらでも** `/signin?redirect=/notes` に着く（本項目は本番ビルド側のみを記録）。

**観測:**

| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | タブ A でサインインし `/notes` を開く | 確認項目 11 の準備で実施済み（`nav@example.com` でサインイン、`/notes` を開いた状態）。 |
| 2 | タブ A で一覧のノートをクリックして `/notes/{noteId}` へ遷移 | 着地 URL: `http://localhost:3100/notes/01a02d67-44eb-7029-99db-992be50d4c0d`（`/notes` と `/notes/{noteId}` の両方が既訪になった状態）。 |
| 3 | タブ B（同一セッション内の新規タブ、`tab new`）で `http://localhost:3100/settings/profile` を開き、アカウントメニューから「サインアウト」をクリック | サインアウト後の着地 URL: `http://localhost:3100/`。 |
| 4 | タブ A に戻り、`/notes/{noteId}` からブラウザー「戻る」で `/notes` へ移動 | 着地 URL: `http://localhost:3100/signin?redirect=%2Fnotes`。画面には「サインイン」の見出し、メールアドレス欄、パスワード欄、「サインイン」ボタン（disabled）、「Google で続ける」ボタン、「アカウントを作る」リンクが表示された。 |

**備考:** タブ操作中に一度、まだ切り替わっていないタブ（タブ B）に対して誤って「戻る」を実行してしまい、`http://localhost:3100/signin?redirect=%2Fsettings%2Fprofile` という着地を観測した（サインアウト後の `/` から `/settings/profile` へ戻った結果、認証ガードで signin へリダイレクトされたもの）。これは項目 9 の測定対象操作ではないため、正しいタブ（タブ A）に切り替えて手順4を実行し直した結果を上表に記載した。
