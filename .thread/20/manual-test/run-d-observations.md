# ブラウザ観測結果 Run D — Issue #20（エッジ1・エッジ3）

**実行日:** 2026-08-22
**サーバー:** http://localhost:3100

## エッジ1: 束縛 Cookie の上書き（並行フロー）

**フロー開始時刻（同意画面A取得）:** 2026-08-22 18:16:33 JST 前後（コマンド実行順序上の推定。秒単位のタイムスタンプは個別取得していない）
**手順3〜6 はすべて 18:16:33〜18:19:08 JST の間に連続実行（各操作の個別タイムスタンプは取得していない）**

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | ウィンドウ1で `/signin` → 「Google で続ける」→ 同意画面A を控える | 同意画面A の URL と Cookie A を取得できる | URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=To51lU5iqFUwKi_Ad2sOtoWrg0XVbAiEfK7Okq0JcAc&code_challenge=wj_7kgzmdhXe04992hubB1OjsXzpUmMlWCcXQwZPCJA&code_challenge_method=S256`。Cookie A（`hollow_oauth_state`）: value=`kNhJ_gL-49-1ErpCmRlM7NRQ6ZhMjgDim7ZP5KbqnyQ`, domain=`localhost`, path=`/`, httpOnly=`true`, sameSite=`Lax`, secure=`false`, expires=`1787390801.879675`（Unix秒） |
| 2 | 同じウィンドウ1で `/signin` を開き直し、もう一度「Google で続ける」→ 同意画面B。Cookie B を控える | Cookie B が Cookie A から変わっている | URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=0fwZKVCanISuPsYFItMMh7w7APXv1Str8SiRu3CIO8c&code_challenge=k7WaIGtFP0ZtcZXnv5DoMk-C1bLWHhfTBdNPdPoqYrI&code_challenge_method=S256`。Cookie B（`hollow_oauth_state`）: value=`GVkxLfnx5rqipk8HIPUkFHH5Q6bH9x3xEF-BJ9WP7rc`, domain=`localhost`, path=`/`, httpOnly=`true`, sameSite=`Lax`, secure=`false`, expires=`1787390813.881335`。Cookie A の値とは異なる値になっていた |
| 3 | 同意画面Bで `edge-b@example.com` / `並行太郎B` / `email_verified` ON で「許可する」 | 成功する（サインインできる） | フォームに入力し送信後、URL が `http://localhost:3100/notes` へ遷移。snapshot: 見出し「個人」「最初のノートを作る」、ボタン「白紙から書く」「アカウントメニュー」が表示 — サインイン成功 |
| 4 | 手順1 で控えた同意画面A の URL を開き、`edge-a@example.com` / `並行太郎A` / `email_verified` ON で「許可する」 | 「手続きを完了できませんでした」になる | 同意画面Aの URL を再度開き、フォーム入力・送信後、コールバック URL `http://localhost:3100/auth/callback/google?code=eyJ2IjoxLCJwcm92aWRlckFjY291bnRJZCI6IjgyYjExODI5ODc3ZDJmNDZiYmNiMTExYjg4MDIxYTNjIiwiZW1haWwiOiJlZGdlLWFAZXhhbXBsZS5jb20iLCJlbWFpbFZlcmlmaWVkIjp0cnVlLCJkaXNwbGF5TmFtZSI6IuS4puihjOWkqumDjkEiLCJjb2RlQ2hhbGxlbmdlIjoid2pfN2tnem1kaFhlMDQ5OTJodWJCMU9qc1h6cFVtTWxXQ2NYUXdaUENKQSJ9&state=To51lU5iqFUwKi_Ad2sOtoWrg0XVbAiEfK7Okq0JcAc` に遷移。snapshot: 見出し「手続きを完了できませんでした」、リンク「Hollow に戻る」を表示 |
| 5 | 画面表示を確認する | （上記手順4に同じ） | 「手続きを完了できませんでした」の画面が表示されていた（手順4と同一操作の結果を確認） |
| 6 | `cookies set hollow_oauth_state <Cookie A の値> --url http://localhost:3100/ --path / --httpOnly --sameSite Lax` で Cookie を Cookie A の値に戻し、手順4 のコールバック URL を開き直す | 完了できる | `cookies set` 実行後、`cookies get --json` で `hollow_oauth_state`=`kNhJ_gL-49-1ErpCmRlM7NRQ6ZhMjgDim7ZP5KbqnyQ`（Cookie A の値）に戻っていることを確認。手順4 と同じコールバック URL を再度開いたところ、URL が `http://localhost:3100/notes` へ遷移。snapshot: 見出し「個人」「最初のノートを作る」、ボタン「白紙から書く」を表示 — サインイン成功。直後の `cookies get --json` では `hollow_oauth_state` は Cookie 一覧に存在せず（消費されて削除）、`hollow_session` のみ新しい値（`MDFhMDI4YzItYzJiMy03MmU0LWIxMDMtODUwZDFhYzQxMDM0.X80ohinnf0S-ZrQZubd_lZyKxxzFZU8Ea4jrs65vfZA`）で存在していた |

**控えた値:**
- state A: `To51lU5iqFUwKi_Ad2sOtoWrg0XVbAiEfK7Okq0JcAc`
- state B: `0fwZKVCanISuPsYFItMMh7w7APXv1Str8SiRu3CIO8c`
- Cookie A: `kNhJ_gL-49-1ErpCmRlM7NRQ6ZhMjgDim7ZP5KbqnyQ`（domain=localhost, path=/, httpOnly=true, sameSite=Lax, secure=false, expires=1787390801.879675）
- Cookie B: `GVkxLfnx5rqipk8HIPUkFHH5Q6bH9x3xEF-BJ9WP7rc`（domain=localhost, path=/, httpOnly=true, sameSite=Lax, secure=false, expires=1787390813.881335）

## エッジ3: TTL 検証（束縛 Cookie が一致した場合の期限切れ扱い）

**フロー開始時刻:** 2026-08-22 18:16:15 JST（「Google で続ける」クリック直後、同意画面表示時点）

（後半は10分30秒経過後に追記）

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1〜2 | ウィンドウ3で `/signin` → 「Google で続ける」→ 同意画面URL と `hollow_oauth_state` を控える。同意画面は開いたままにする | state と Cookie の値・属性を取得できる | URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=-itR6_KwS7C2FB8UV7sN6CAKD1wvfRBegxVwHyxdiGc&code_challenge=7zUJahpEv6Bnhxm-LjVA2gY0syAcLrhpxlPStgaeYCo&code_challenge_method=S256`。Cookie（`hollow_oauth_state`）: value=`jT4AKuFBT4GGYEB-Z6qWMzrLOGClgjt8CpHI9TPdu2s`, domain=`localhost`, path=`/`, httpOnly=`true`, sameSite=`Lax`, secure=`false`, expires=`1787390775.865253`（Unix秒 = 2026-08-22 18:26:15 JST 相当、開始時刻から10分後） |

**控えた値（開始時点）:**
- state: `-itR6_KwS7C2FB8UV7sN6CAKD1wvfRBegxVwHyxdiGc`
- Cookie（開始時点の値）: `jT4AKuFBT4GGYEB-Z6qWMzrLOGClgjt8CpHI9TPdu2s`（domain=localhost, path=/, httpOnly=true, sameSite=Lax, secure=false, expires=1787390775.865253）

### 後半（10分30秒以上経過後）

**待機:** `agent-browser --session verify-w3 --restore wait 60000` を8回連続実行（バッチ1回にまとめて実行）。待機後の時刻確認: 2026-08-22 18:27:13 JST（epoch 1787390833）。開始時刻 18:16:15 JST（epoch 概算 1787390175）からの経過は約 **10分58秒**。

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 2 | 10分30秒以上経過後、`cookies get --json` を確認。消えていれば①手順3で控えた値・属性で復元 | Expires 到達で `hollow_oauth_state` が消えている。復元後に `cookies get --json` で入ったことを確認できる | 待機後（18:27:13頃）の `cookies get --json`: `{"cookies":[]}` — `hollow_oauth_state` が消えていた。`cookies set hollow_oauth_state jT4AKuFBT4GGYEB-Z6qWMzrLOGClgjt8CpHI9TPdu2s --url http://localhost:3100/ --path / --httpOnly --sameSite Lax` を実行後、`cookies get --json` を再確認したところ `{"domain":"localhost","expires":-1.0,"httpOnly":true,"name":"hollow_oauth_state","path":"/","sameSite":"Lax","secure":false,"session":true,"size":61,"value":"jT4AKuFBT4GGYEB-Z6qWMzrLOGClgjt8CpHI9TPdu2s"}` が入っていることを確認した |
| 3 | 開いたままの同意画面で `edge-ttl@example.com` / `期限切れ太郎` / `email_verified` ON で「許可する」 | （手順4で判定） | 同意画面（`state=-itR6_KwS7C2FB8UV7sN6CAKD1wvfRBegxVwHyxdiGc` の画面、開始時から開いたまま）にフォーム入力し送信 |
| 4 | 画面表示を確認する | 「手続きを完了できませんでした」になる | 遷移先 URL: `http://localhost:3100/auth/callback/google?code=eyJ2IjoxLCJwcm92aWRlckFjY291bnRJZCI6IjVkNjk1YzNjNDc5NGYxMDljZDFkNmE2Mjc1OTQ2YjJmIiwiZW1haWwiOiJlZGdlLXR0bEBleGFtcGxlLmNvbSIsImVtYWlsVmVyaWZpZWQiOnRydWUsImRpc3BsYXlOYW1lIjoi5pyf6ZmQ5YiH44KM5aSq6YOOIiwiY29kZUNoYWxsZW5nZSI6Ijd6VUphaHBFdjZCbmh4bS1MalZBMmdZMHN5QWNMcmhweGxQU3RnYWVZQ28ifQ&state=-itR6_KwS7C2FB8UV7sN6CAKD1wvfRBegxVwHyxdiGc`。snapshot: 見出し「手続きを完了できませんでした」、リンク「Hollow に戻る」を表示。観測時刻: 2026-08-22 18:27:29 JST |
| 5 | 手順3 で遷移したコールバック URL をもう一度開き直す | もう一度開いても完了できない | 同じコールバック URL を再度 `open` し直したところ、URL はそのまま維持され、snapshot: 見出し「手続きを完了できませんでした」、リンク「Hollow に戻る」を表示（手順4と同一の結果）。観測時刻: 2026-08-22 18:27:37 JST |

**エッジ3 実経過時間（開始 18:16:15 → 手順4完了 18:27:29）:** 約 **11分14秒**
