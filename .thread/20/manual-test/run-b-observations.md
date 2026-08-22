# ブラウザ観測結果 Run B — Issue #20（項目7・8）

**実行日:** 2026-08-22
**サーバー:** http://localhost:3100

## 項目 7: 連携（ログイン方法を追加）の往復にも同じ束縛が掛かる

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | ウィンドウ1でサインアウト → `/signup` から `pass-a@example.com` / `Passw0rd123` / 表示名 `パスワード太郎` で登録 → サーバーログの `actionUrl` を同ウィンドウで開く | メール確認まで完了する | サインアウト後、`/settings/auth` から `アカウントメニュー` → `サインアウト` で `http://localhost:3100/` へ遷移。`/signup` で3項目を入力し `利用規約とプライバシーポリシーに同意します` にチェック→「アカウントを作る」押下で見出し「確認メールを送信しました」表示。サーバーログ（offset 40-66）に `mail.sent { to: 'pass-a@example.com', template: 'emailVerification', actionUrl: 'http://localhost:3100/verify-email?token=MDFhMDI4YmEtMTdjOS03N2E5LWEyMTctYTM4Y2E5MGUxZTA3.TBlpbsHd3wGCzV0G9zviTaLeJA4wbm8LfKzW_yKX3C4' }` を検出。同URLを開くと見出し「個人」/「最初のノートを作る」のホーム画面に遷移（サインイン済み状態）。 |
| 2 | `/settings/auth` を開き「ログイン方法を追加」（Google）を押す | 同意画面へ遷移する | `/settings/auth` の snapshot に `heading "有効なログイン方法"` / `button "解除" [disabled]` / `button "Google を追加"` が表示。「Google を追加」押下後、URLが `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=ZOujnUuP6cFqlpbFCPe1QL0v4nNQ6H4YaAV-NsIuM2U&code_challenge=AUd9i6_IuxByOmPzMPXnEXSaQOOVHLWLOmg8LFGEqJ0&code_challenge_method=S256` に遷移。 |
| 3 | `cookies get --json` で `hollow_oauth_state` を確認し、同意画面 `state` および `sha256(state)` と突き合わせる | Cookie値が `state` とも `sha256(state)` とも一致しない | `cookies get --json` の `hollow_oauth_state` は `name":"hollow_oauth_state","value":"dZR5q8SSwLWY5XItHd3WaRhYB3ZISZDrwsfGOxX1uVc"`（`httpOnly:true, sameSite:"Lax", path:"/"`）。URLの `state=ZOujnUuP6cFqlpbFCPe1QL0v4nNQ6H4YaAV-NsIuM2U`。`node -e` で計算した `sha256(state) = 6811eafb91c9af213ba9f3c39f32ba4ebc2e1bd61f0cbcca7c783c63639fa9ff`。3値はいずれも文字列として不一致。 |
| 4 | 同意画面でメール `bind-b@example.com`、表示名 `連携太郎`、`email_verified` トグル ON で「許可する」 | 同意処理が進む | フォームの `メールアドレス` に `dev-user@example.com` が初期値として入っていたため `bind-b@example.com` に書き換え、`表示名` を `連携太郎` に書き換え。`checkbox "メールアドレスは確認済み（email_verified）"` は初期状態から `checked=true` （変更操作は不要だった）。「許可する」押下後、URLは `http://localhost:3100/settings/auth` に遷移。 |
| 5 | 戻った画面と `/settings/auth` の一覧、`cookies get --json` を確認 | 「ログイン方法を追加しました」が表示され、一覧にGoogleが加わり、`hollow_oauth_state` が消え、解除ボタンが有効になっている | `read` で本文全体を取得したところ、「ログイン方法を追加しました」という文言は**画面上に見当たらなかった**（読み取り時点で既に消えていた可能性あり）。一覧本文: 「メールアドレスとパスワード有効追加 2026年8月22日解除」「Google有効bind-b@example.com で連携済み解除」。snapshotでは `button "解除" [ref=e18]` と `button "解除" [ref=e19]` の2つとも `disabled` 属性なし（＝有効）。`cookies get --json` は `hollow_session` のみを返し、`hollow_oauth_state` は含まれていなかった（消えている）。 |

**控えた値:**
- state: `ZOujnUuP6cFqlpbFCPe1QL0v4nNQ6H4YaAV-NsIuM2U`
- Cookie 値（`hollow_oauth_state`）: `dZR5q8SSwLWY5XItHd3WaRhYB3ZISZDrwsfGOxX1uVc`
- sha256(state): `6811eafb91c9af213ba9f3c39f32ba4ebc2e1bd61f0cbcca7c783c63639fa9ff`
- 検証URL（メール確認）: `http://localhost:3100/verify-email?token=MDFhMDI4YmEtMTdjOS03N2E5LWEyMTctYTM4Y2E5MGUxZTA3.TBlpbsHd3wGCzV0G9zviTaLeJA4wbm8LfKzW_yKX3C4`

## 項目 8: キャンセルの破棄 — 束縛が一致した破棄要求は Cookie を落とす

**注記:** 手順1で「もし既に Google が連携済みで追加できない場合は、サインアウトして `/signin` の「Google で続ける」を押す」に該当したため、後者（サインアウト → `/signin` → 「Google で続ける」）を使用した。項目7でGoogleが連携済みとなったため `/settings/auth` に「Google を追加」ボタンが存在しなかった（snapshotで確認、`解除`ボタン2つのみで `Google を追加` は無し）。

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | `/settings/auth` で「Google の追加」を試す→不可のためサインアウトし `/signin` の「Google で続ける」を押す | 同意画面へ遷移する | `/settings/auth` の snapshot に「Google を追加」ボタンが存在しないことを確認。アカウントメニュー→「サインアウト」で `http://localhost:3100/` へ遷移。`/signin` を開き「Google で続ける」押下で `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=h1sPgcxrIc9jP7Zw4QtmzUq9PNsYDWaNDDkR1b8UdC4&code_challenge=th60XSEkcB6PB9_j_a45JCwKwUfYnFp_70vdomJIh_o&code_challenge_method=S256` に遷移。 |
| 2 | `cookies get --json` で `hollow_oauth_state` が焼かれていることを確認し、同意画面URL全体を控える | Cookieが焼かれている | `cookies get --json` は `{"domain":"localhost","httpOnly":true,"name":"hollow_oauth_state","path":"/","sameSite":"Lax","secure":false,"value":"3JO5UaX0gEvr7Uizb4E81ZHvnVtHal_04ERS13N_IN4"}` のみを返した（サインアウト済みのため `hollow_session` は無し）。同意画面URLは上記の通り。 |
| 3 | `network requests --clear` で記録をクリアし、同意画面で「キャンセル」を押す | — | クリア後、`snapshot` で `button "キャンセル" [ref=e8]` を確認して押下。 |
| 4 | 遷移した `/auth/callback/google?error=access_denied&state=...` の表示を見る | 「手続きをキャンセルしました」が表示される | URLは `http://localhost:3100/auth/callback/google?error=access_denied&state=h1sPgcxrIc9jP7Zw4QtmzUq9PNsYDWaNDDkR1b8UdC4` に遷移。見出し「手続きをキャンセルしました」、本文「何も変更されていません。必要になったらいつでもやり直せます。」、リンク「Hollow に戻る」を確認。 |
| 5 | `network requests --type document` でコールバックURLのドキュメント要求を探し、`network request <id>` で応答ヘッダーを確認。あわせて `cookies get --json` を確認 | `hollow_oauth_state` が消えている（ドキュメント応答に破棄の `set-cookie` が出る） | `network requests --type document` は `[8A84CB9F35F4F04DFB17D110BB082E9B] GET http://localhost:3100/auth/callback/google?error=access_denied&state=h1sPgcxrIc9jP7Zw4QtmzUq9PNsYDWaNDDkR1b8UdC4 (Document) 200` を返した。`network request <id> --json` の `responseHeaders` は `{"Connection":"keep-alive","Date":"Sat, 22 Aug 2026 09:09:23 GMT","Keep-Alive":"timeout=5","Transfer-Encoding":"chunked","Vary":"Origin\nSec-Fetch-Dest","cache-control":"private, no-store","content-security-policy":"frame-ancestors 'self'; form-action 'self'; object-src 'none'; base-uri 'self'","content-type":"text/html; charset=utf-8","referrer-policy":"strict-origin-when-cross-origin","x-content-type-options":"nosniff"}` で、`set-cookie` キーは含まれていなかった（注意書きの通りツール側の制約と判断し、Cookie直接確認で代替）。`cookies get --json` は `{"cookies":[]}` を返し、`hollow_oauth_state` を含め全Cookieが消えていた。 |

**控えた値:**
- state: `h1sPgcxrIc9jP7Zw4QtmzUq9PNsYDWaNDDkR1b8UdC4`
- Cookie 値（`hollow_oauth_state`、キャンセル前）: `3JO5UaX0gEvr7Uizb4E81ZHvnVtHal_04ERS13N_IN4`
- 同意画面URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=h1sPgcxrIc9jP7Zw4QtmzUq9PNsYDWaNDDkR1b8UdC4&code_challenge=th60XSEkcB6PB9_j_a45JCwKwUfYnFp_70vdomJIh_o&code_challenge_method=S256`
- コールバックURL: `http://localhost:3100/auth/callback/google?error=access_denied&state=h1sPgcxrIc9jP7Zw4QtmzUq9PNsYDWaNDDkR1b8UdC4`
