# ブラウザ観測結果 Run C — Issue #20（項目9・10 + エッジ4）

**実行日:** 2026-08-22
**サーバー:** http://localhost:3100

## 事前確認（各ウィンドウの初期 Cookie 状態）

- ウィンドウ1（verify-w1, --restore）: `cookies get --json` → `"cookies":[]`
- ウィンドウ2（verify-w2, --restore）: `cookies get --json` → `"cookies":[]`
- ウィンドウ3（verify-w3, --restore, 新規）: `cookies get --json` → `"cookies":[]`（`restoreStatus":"missing"`）

## 項目9: 別のブラウザーのフローを指す破棄は Cookie も `state` 行も落とさない

**フロー開始時刻（ウィンドウ1・state A 取得）:** 2026-08-22 18:11:41
**フロー開始時刻（ウィンドウ2・state B 取得）:** 2026-08-22 18:11:56

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | W1で `/signin` を開き「Google で続ける」を押す | 同意画面 URL と state A、Cookie A を控える | 遷移先URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=NG5g2dsw8_7TkMQoeoVDhO6GK_CFj9bMA48HH0Orf_Q&code_challenge=umozoL7gMXQSSyiwVLIubfyyt_if0yx71LmMYOFlt9g&code_challenge_method=S256`。`cookies get --json` の `hollow_oauth_state.value` = `bxAdTSnrk6yI2cU7Ubf8DB82OrdjxXM5kuAtj1FQAIE`。同意画面はこの後開いたまま維持した |
| 2 | W2で `cookies clear` 後 `/signin` を開き「Google で続ける」を押す | 同意画面 URL と Cookie B を控える | `cookies clear` → `✓ Cookies cleared`。遷移先URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=SwthPMtCSe6QQX1IhLFlcQeNaCOHvSrYc0ySzQtITf0&code_challenge=T7z6E7RL3mZmY_gYiylvFnZdmRbkRTmbLAdwNSMhRKE&code_challenge_method=S256`。`hollow_oauth_state.value` = `V8hSWIT8uo2hpy6w45VY3972AHeczxsMpAjLinQT-kg` |
| 3 | W2で `/auth/callback/google?error=access_denied&state=<state A>` を開く | 「手続きをキャンセルしました」表示 | 見出し `"手続きをキャンセルしました"` [level=1] を観測。他の要素: `link "Hollow のトップへ"`, `link "Hollow に戻る"` |
| 4 | W2で `cookies get --json` を確認 | Cookie B（`V8hSWIT8uo2hpy6w45VY3972AHeczxsMpAjLinQT-kg`）のまま残る | `cookies get --json` → `hollow_oauth_state.value` = `V8hSWIT8uo2hpy6w45VY3972AHeczxsMpAjLinQT-kg`（手順2で控えた Cookie B と一致、Cookie 配列は1件のみ） |
| 5 | W2で手順2の同意画面URLを開き直し、`bind-c@example.com` / `別ブラウザー太郎` / `email_verified` ON で「許可する」 | W2のフローが完了しサインインできる | フォームは開き直した時点で `email_verified` チェックボックスが `checked=true` の状態だった。`fill` でメールアドレス・表示名を入力後 `is checked e6` → `true`。「許可する」押下後、URLは `http://localhost:3100/notes` に遷移し、`heading "個人"` / `heading "最初のノートを作る"` 等を表示。`cookies get --json` → `hollow_session` Cookie（value=`MDFhMDI4YmUtMTc2My03MjQ5LThjNzctN2MxNDBjMDgwNGU3.jVmdjk_yV23Y6RCIZO--EcUvITQP9xvpz5ns_b7zVWo`）が1件のみ存在し、`hollow_oauth_state` は消えていた |
| 6 | W1に戻り、開いたままの同意画面で `bind-a@example.com` / `束縛太郎` / `email_verified` ON で「許可する」 | W1のフローも完了しサインインできる（state A の行が残っている） | W1のURLは手順1のまま変化していなかった（`state=NG5g2dsw8_7TkMQoeoVDhO6GK_CFj9bMA48HH0Orf_Q` を含む同意画面）。フォームに入力し `is checked e6` → `true`。「許可する」押下後、URLは `http://localhost:3100/notes` に遷移し、`heading "個人"` / `heading "最初のノートを作る"` 等を表示。`cookies get --json` → `hollow_session` Cookie（value=`MDFhMDI4YjUtYTI2NS03NDRhLWIwNWUtNWRjMjc2YWM4NTNi.bk8aMGUMU1YBCSMeDDI4KP3TUlNvQxUTOGw0xXuTYYE`）が1件のみ存在 |

**控えた値:**
- state A: `NG5g2dsw8_7TkMQoeoVDhO6GK_CFj9bMA48HH0Orf_Q`
- Cookie A（hollow_oauth_state, W1）: `bxAdTSnrk6yI2cU7Ubf8DB82OrdjxXM5kuAtj1FQAIE`
- state B: `SwthPMtCSe6QQX1IhLFlcQeNaCOHvSrYc0ySzQtITf0`
- Cookie B（hollow_oauth_state, W2）: `V8hSWIT8uo2hpy6w45VY3972AHeczxsMpAjLinQT-kg`

## 項目10: 束縛 Cookie を持たない破棄要求は何もしない

**フロー開始時刻（ウィンドウ1・state D 取得）:** 2026-08-22 18:12:43

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 0 | W1でサインアウト | サインアウトされる | アカウントメニューを開き「サインアウト」押下 → URLは `http://localhost:3100/`。`cookies get --json` → `"cookies":[]` |
| 1 | W1で `/signin` →「Google で続ける」を押す | 同意画面URLと state D を控える。同意画面は開いたままにする | 遷移先URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=9fRREnRL5F4nxIHk4YIvq_psOI1maK_2mwRYBsWICdY&code_challenge=L__0Q2J5zwc4B2GypEaJz1tl1uqilp-MkD10xTH91YQ&code_challenge_method=S256`。`hollow_oauth_state.value` = `ibmzxHySPrdQ9zjyjUemYJvcqy7pUqzKIJtUa_ZclYA` |
| 2 | W3（Cookie無し確認済み）で `network requests --clear` 後 `/auth/callback/google?error=access_denied&state=<state D>` を開く | — | `network requests --clear` → `✓ Request log cleared`。開いた結果、見出し `"手続きをキャンセルしました"` を表示 |
| 3 | `network requests --type document` で該当リクエストを探し `network request <id>` で応答ヘッダー確認。あわせて `cookies get --json` を確認 | 応答に `hollow_oauth_state` の `set-cookie` が一切出ない。W3にCookieは作られない | `network requests --type document --json` で該当requestId `B3FE93D1DA5A9F134FBB3A7F758F0F93` を発見。`responseHeaders` は `{"Connection":"keep-alive","Date":"Sat, 22 Aug 2026 09:12:55 GMT","Keep-Alive":"timeout=5","Transfer-Encoding":"chunked","Vary":"Origin\nSec-Fetch-Dest","cache-control":"private, no-store","content-security-policy":"frame-ancestors 'self'; form-action 'self'; object-src 'none'; base-uri 'self'","content-type":"text/html; charset=utf-8","referrer-policy":"strict-origin-when-cross-origin","x-content-type-options":"nosniff"}` — `set-cookie` キーは存在しなかった。`network request <id>` はURL文字列のみを返し、ヘッダー詳細はrequests一覧の`--json`出力の方に含まれていた（ツールの出力仕様上の制約と判断し、代替として`requests --type document --json`の`responseHeaders`を採用）。`cookies get --json`（W3） → `"cookies":[]` |
| 4 | W1に戻り、開いたままの同意画面で `bind-a@example.com` / `束縛太郎` / `email_verified` ON で「許可する」 | W1のフローが完了する（state D の行が残っている） | W1のURLは手順1のまま変化していなかった（`state=9fRREnRL5F4nxIHk4YIvq_psOI1maK_2mwRYBsWICdY` を含む同意画面）。フォームに入力し `is checked e6` → `true`。「許可する」押下後、URLは `http://localhost:3100/notes` に遷移し `heading "個人"` 等を表示。`cookies get --json` → `hollow_session` Cookie（value=`MDFhMDI4YjUtYTI2NS03NDRhLWIwNWUtNWRjMjc2YWM4NTNi.V5D3tDiPAI98BuhUiEIuYKHxNYbk8_QqcJvsKda-544`）が1件のみ存在 |

**控えた値:**
- state D: `9fRREnRL5F4nxIHk4YIvq_psOI1maK_2mwRYBsWICdY`
- Cookie D（hollow_oauth_state, W1）: `ibmzxHySPrdQ9zjyjUemYJvcqy7pUqzKIJtUa_ZclYA`

## エッジケース: `code` を伴わないコールバック（プロバイダーが `code` を返さない）

**フロー開始時刻（ウィンドウ1・state E 取得）:** 2026-08-22 18:13:27
**フロー開始時刻（ウィンドウ2・state F 取得）:** 2026-08-22 18:13:47

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 0 | W1でサインアウト | サインアウトされる | アカウントメニュー →「サインアウト」→ `cookies get --json` → `"cookies":[]` |
| 1 | W1で `/signin` →「Google で続ける」を押す | state E と `hollow_oauth_state` の値を控える | 遷移先URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=WR-5cbu4Bg-_n3_BM4WNmkmIt0VStzeu95QeCvm9hfM&code_challenge=JouqbvbnYRgmR48v3RGGEp9J366PtXIPUbeDb-lXKpo&code_challenge_method=S256`。`hollow_oauth_state.value` = `fXahjYFhvqiuxI8pIiULqLOf4JMroTOLXao_O-TWchE` |
| 2 | W1で `/auth/callback/google?state=<state E>`（code無し・error無し）を開く | — | 見出し `"手続きを完了できませんでした"` [level=1] を観測。表示要素は `link "Hollow のトップへ"`, `heading "手続きを完了できませんでした"`, `link "Hollow に戻る"` のみ（再試行ボタンは見当たらず） |
| 3 | 画面表示と `cookies get --json` を確認 | 「手続きを完了できませんでした」（再試行導線なし）が表示され `hollow_oauth_state` が消えている | 上記見出しを表示。`cookies get --json` → `"cookies":[]`（`hollow_oauth_state` を含め0件） |
| 4 | 対照実験: W2で新しくフロー開始（`/signin`→「Google で続ける」）、state F・Cookie F を控える。次にW2で `/auth/callback/google?state=<state E>`（他人のstate、code無し・error無し）を開き `cookies get --json` を確認 | W2の `hollow_oauth_state` は Cookie F のまま消えない | W2は開始時点で `hollow_session` Cookie（`MDFhMDI4YmUtMTc2My03MjQ5LThjNzctN2MxNDBjMDgwNGU3.jVmdjk_yV23Y6RCIZO--EcUvITQP9xvpz5ns_b7zVWo`）を保持中（項目9手順5でサインイン済みのまま）。`/signin` は通常通り表示され「Google で続ける」押下で遷移先URL: `http://localhost:3100/dev/oauth/authorize?...&state=mtU0KJ2P_TGoacvR2I57P6dfR7EQ0EuVOYu_FHMqjzk&...`。`hollow_oauth_state.value` = `ZPHuKt0n5Mz9ommomdxTRMCgBN2Zjsm4blTusLF4iQg`（= Cookie F）。他人のstate E を指すコールバックを開いた結果、見出し `"手続きを完了できませんでした"` を表示。`cookies get --json` → `hollow_session`（変化なし）と `hollow_oauth_state.value` = `ZPHuKt0n5Mz9ommomdxTRMCgBN2Zjsm4blTusLF4iQg`（Cookie Fのまま、2件とも維持） |

**控えた値:**
- state E: `WR-5cbu4Bg-_n3_BM4WNmkmIt0VStzeu95QeCvm9hfM`
- Cookie E（hollow_oauth_state, W1）: `fXahjYFhvqiuxI8pIiULqLOf4JMroTOLXao_O-TWchE`
- state F: `mtU0KJ2P_TGoacvR2I57P6dfR7EQ0EuVOYu_FHMqjzk`
- Cookie F（hollow_oauth_state, W2）: `ZPHuKt0n5Mz9ommomdxTRMCgBN2Zjsm4blTusLF4iQg`
