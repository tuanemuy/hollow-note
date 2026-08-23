# Run B 観測ログ（DEV・未サインイン → 手順内でサインイン/サインアウト） — Issue #13 / PR #36

**環境:** DEV `pnpm dev` / http://localhost:3100（`APP_URL=http://localhost:3100` のため、testing.md 記載の `:3000` は `:3100` に読み替えて実行した）
**セッション:** verify-run-b

## 確認項目 8: 未サインインで保護ルートを直接開くと `/signin?redirect=...` に着く

**期待:**
- `/notes` → `/signin?redirect=/notes`
- `/notes/{noteId}` → `/signin?redirect=/notes/{noteId}`
- `/settings/auth` → `/signin?redirect=/settings/auth`
- `/settings` → `/signin?redirect=/settings/profile`（`main` は `/signin?redirect=/settings`）
- 手順3のサインイン後、`/notes` に戻る

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | サインアウト状態で `http://localhost:3100/notes` をアドレスバーから直接開く（`open` + `wait --load networkidle`） | 着地 URL: `http://localhost:3100/signin?redirect=%2Fnotes`（タブタイトル「サインイン — Hollow」） |
| 2 | 同様に `http://localhost:3100/notes/01a02d3f-6b4c-772a-b1d1-6a3c359dde1d`（run-a が確認項目1/2で使用したノートID）を直接開く | 着地 URL: `http://localhost:3100/signin?redirect=%2Fnotes%2F01a02d3f-6b4c-772a-b1d1-6a3c359dde1d` |
| 3 | 同様に `http://localhost:3100/settings/auth` を直接開く | 着地 URL: `http://localhost:3100/signin?redirect=%2Fsettings%2Fauth` |
| 4 | 同様に `http://localhost:3100/settings` を直接開く | 着地 URL: `http://localhost:3100/signin?redirect=%2Fsettings%2Fprofile` |
| 5 | `http://localhost:3100/signin?redirect=/notes` を開き直し、「Google で続ける」→ 開発用 IdP 同意画面でメールアドレス `nav@example.com` / 表示名 `ナビ太郎` を入力（`email_verified` チェックボックスは既定で `checked=true`）、「許可する」をクリック | 着地 URL: `http://localhost:3100/notes`（サインイン成功、`/notes` 一覧画面が表示された） |

**備考:** `/notes/{noteId}` のノートIDは自分のセッションでは（未サインインのため）用意できなかったので、`.thread/13/manual-test/run-a-observations.md` に記載されていた実在ノートID `01a02d3f-6b4c-772a-b1d1-6a3c359dde1d`（run-a セッションが作成したノート）を借用した。ガード自体はノートの実在性を問わず作動する前提で使用。

## 確認項目 10: 未サインインの断片ブリッジは遷移元パスを検証してから `/signin` へ倒す

**期待:**
- 手順4の4検体（`//evil.example` / `https://evil.example` / `/\evil.example` / 生LFを含む `"/\n/evil.example"`）はいずれも応答 JSON に `"isSerializedRedirect": true` を含み、遷移先が `/signin`、その `redirect` が `/notes` になる
- 手順5（`redirect` を文字列 `"/%0Aevil"` に）は `/signin?redirect=/%0Aevil`（`"/%0Aevil"` がそのまま載る）
- 手順6（2049文字）は HTTP 422（`kind: "validation"` / `code: "INVALID_INPUT"`）。400 ではない

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | サインイン済み状態で `/notes` の詳細ノートから「ノート一覧」リンクをクリックしてクライアント遷移し、`network requests --filter _serverFn` で `renderNoteList` の `_serverFn` GET リクエストを捕捉（DevTools の Copy as fetch に相当する情報を `network request <id> --json` で取得） | URL: `http://localhost:3100/_serverFn/eyJmaWxlIjoiL2FwcC9yb3V0ZXMvbm90ZXMvLWFjdGlvbi50c3g_dHNzLXNlcnZlcmZuLXNwbGl0IiwiZXhwb3J0IjoicmVuZGVyTm90ZUxpc3RfY3JlYXRlU2VydmVyRm5faGFuZGxlciJ9?payload=...`（method GET, status 200, ヘッダー `accept: application/x-tss-framed, application/x-ndjson, application/json`, `x-tsr-serverfn: true`） |
| 2 | `payload` クエリを `decodeURIComponent` して構造確認 | `{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":10,"i":1,"p":{"k":["redirect"],"v":[{"t":1,"s":"/notes"}]},"o":0}]},"o":0},"f":63,"m":[]}`（`redirect` の値は `"s":"/notes"` の位置に格納） |
| 3 | アカウントメニュー →「サインアウト」をクリック | 着地 URL: `http://localhost:3100/`。`cookies get --json` の結果 `"cookies":[]`（Cookie 消滅を確認） |
| 4-1 | `redirect` を `//evil.example` に書き換えて（`JSON.parse`→値差し替え→`JSON.stringify`→`encodeURIComponent`）同じ URL 形式で再送 | status 200, body: `{"to":"/signin","search":{"redirect":"/notes"},"statusCode":307,"href":"/signin?redirect=%2Fnotes","isSerializedRedirect":true}` |
| 4-2 | `redirect` を `https://evil.example` に書き換えて再送 | status 200, body: `{"to":"/signin","search":{"redirect":"/notes"},"statusCode":307,"href":"/signin?redirect=%2Fnotes","isSerializedRedirect":true}` |
| 4-3 | `redirect` を `/\evil.example`（先頭 `/` + バックスラッシュ1文字）に書き換えて再送 | status 200, body: `{"to":"/signin","search":{"redirect":"/notes"},"statusCode":307,"href":"/signin?redirect=%2Fnotes","isSerializedRedirect":true}` |
| 4-4 | `redirect` を `"/\n/evil.example"`（`\n` は生の LF 1バイト。`String.fromCharCode(10)` で構築）に書き換えて再送 | status 200, body: `{"to":"/signin","search":{"redirect":"/notes"},"statusCode":307,"href":"/signin?redirect=%2Fnotes","isSerializedRedirect":true}` |
| 5 | `redirect` を文字列 `"/%0Aevil"`（8文字、パーセントエンコードされたまま・生LFに戻さず）に書き換えて再送 | status 200, body: `{"to":"/signin","search":{"redirect":"/%0Aevil"},"statusCode":307,"href":"/signin?redirect=%2F%250Aevil","isSerializedRedirect":true}`（`search.redirect` は `"/%0Aevil"` のまま＝パーセントエンコードが復号されずに載っている。`href` 側は `%2F%250Aevil` で `%` がさらに `%25` にエンコードされた形） |
| 6 | `redirect` を `"/" + "a".repeat(2048)`（2049文字）に書き換えて再送 | **status 422**, body: `{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[{"t":2,"s":1},{"t":25,"i":1,"s":{"v":{"t":10,"i":2,"p":{"k":["kind","code","message","retryable","fieldErrors"],"v":[{"t":1,"s":"validation"},{"t":1,"s":"INVALID_INPUT"},{"t":1,"s":"Invalid input"},{"t":2,"s":3},{"t":10,"i":3,"p":{"k":["redirect"],"v":[{"t":9,"i":4,"a":[{"t":1,"s":"Too big: expected string to have \\x3C=2048 characters"}],"o":0}]},"o":0}]},"o":0}},"c":"$TSR/t/AppServerError"},{"t":10,"i":5,"p":{"k":[],"v":[]},"o":0}]},"o":0}`（`kind":"validation"` と `"code":"INVALID_INPUT"` を含む） |

**備考:** 手順1「右クリック→Copy as fetch」は agent-browser に DevTools コンテキストメニュー相当の操作が無いため、`network requests --filter renderNoteList`（ヒットせず。エンドポイントの URL 自体が base64 エンコードされておりファイル名文字列を含まないため）→ `network requests --filter _serverFn` で該当リクエストを特定し、`network request <id> --json` で URL・メソッド・ヘッダーを取得する方法で代替した。再送は `fetch()` を `eval` 経由でブラウザーコンテキスト内で実行する形で行った（Cookie 未送信は手順3のサインアウトで担保）。

## エッジケース 1: 未サインインで `/settings/profile` を SSR 直開きしたときの HTML 応答が 307 である

**期待:** Doc 応答は 307（`/signin?redirect=/settings/profile` へ）。`renderProfileForm` の `_serverFn` が 401 で1本残るのは想定内で、画面には出ない。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | サインアウト状態を確認（`cookies get --json`） | `"cookies":[]` |
| 2 | `network requests --clear` の後、`http://localhost:3100/settings/profile` を `open`（フルロード）し `wait --load networkidle` | ブラウザーが自動的にリダイレクトへ追従し、着地 URL は `http://localhost:3100/signin?redirect=%2Fsettings%2Fprofile`（`eval location.href` の結果） |
| 3 | `network requests --json` で Document 種別のエントリを確認 | 1行目: `resourceType: Document, method: GET, status: undefined, url: http://localhost:3100/settings/profile`（ステータスコードがこのツールの一覧表示では記録されない＝ブラウザー内でリダイレクトが自動追従され中間応答のステータスが失われた）。2行目: `resourceType: Document, method: GET, status: 200, url: http://localhost:3100/signin?redirect=%2Fsettings%2Fprofile`（最終着地の応答） |
| 4 | 同 URL に対し `curl -s -o /dev/null -w "%{http_code}"` を実行（リダイレクトを追わない・エッジケース1として許可された手段） | `307` |
| 5 | 同 URL に対し `curl -sI` を実行 | `HTTP/1.1 307` / `location: /signin?redirect=%2Fsettings%2Fprofile` / `cache-control: private, no-store` ほか |
| 6 | 手順2の Network キャプチャ内で `_serverFn`（Fetch/XHR 種別）のリクエストを `network requests --type fetch,xhr --json` で検索 | `"requests":[]`（0件。`renderProfileForm` を含め `_serverFn` へのリクエストは1件も記録されなかった） |

**備考:** 手順4「同じ Network に残る `_serverFn` 要求のステータスを確認する」について、agent-browser のブラウザー操作（`open` によるフルロード）ではリダイレクトへの自動追従によって最終的に `/signin` ページへ遷移し切ってしまい、`_serverFn`（Fetch/XHR）種別のリクエストは Network キャプチャに一切現れなかった（0件）。Doc 応答の 307 自体は curl で個別に確認した（手順4・5）。
