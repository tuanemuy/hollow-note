# 項目 5: OAuth — dev IdP の同意をキャンセルする

**結果**: PASS
**対応する受け入れ基準**: AC-6（ADR-021）、AC-9（P-05 キャンセル状態）（TC-40）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | ウィンドウ2 の `/signin` で「Google で続ける」を押す | dev IdP の同意画面へ遷移 | `/dev/oauth/authorize?...` へ遷移。「開発用 ID プロバイダー」見出し、メールアドレス（既定 `dev-user@example.com`）・表示名（既定 `Dev User`）・`email_verified` チェックボックス（既定 ON）・「許可する」「キャンセル」が表示された | PASS |
| 2 | 遷移先 URL のパラメーターを確認 | `client_id` / `redirect_uri` / `state` / `code_challenge` / `code_challenge_method` / `scope` が付く | `client_id=dev-google`、`redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle`、`response_type=code`、`scope=openid email profile`、`state=sW7lhVFUsjDVypyHZvz_EGyvH4e-7xMTozbabPFWwjw`、`code_challenge=Te80bF6rQmHNzzyT9NVL_i2megChOGSs5okgcsDvq0M`、`code_challenge_method=S256` | PASS |
| 3 | 「キャンセル」を押す | `/auth/callback/google?error=access_denied&state=...` へ遷移し P-05 キャンセル状態。サインイン状態にならない | `http://localhost:3100/auth/callback/google?error=access_denied&state=sW7lhVFUsjDVypyHZvz_EGyvH4e-7xMTozbabPFWwjw` へ遷移。見出し「手続きをキャンセルしました」+ 導線「Hollow に戻る」。導線を押すと `/` へ遷移し、ヘッダーは「サインイン」「はじめる」（未サインイン） | PASS |
| 4 | サインイン画面へ戻り、もう一度「Google で続ける」を押す | 同意画面が再表示され、state は別の値 | 同意画面が再表示。`state=Tk-V7NPrn8D3hVZEmetXvljKQuIknymqJjcwoD6BEvA`、`code_challenge=m9FxoEIWZ9i1XSHz6u9jPLurI3qMcab-AW3BO8_Lk3E` と、いずれも手順 2 と別の値 | PASS |

## 確認ポイント

- `code_challenge_method=S256` を確認。`code_challenge` は 43 文字（`Te80bF6rQmHNzzyT9NVL_i2megChOGSs5okgcsDvq0M` の長さを実測）で ADR-010 どおり。
- キャンセル後もサインイン状態にはならなかった（`/` のヘッダーが未サインイン表示）。

## 気づいた点

- 同意画面の `email_verified` チェックボックスのラベルがバッククォート込みの「メールアドレスは確認済み（\`email_verified\`）」で、Markdown の記法がそのまま画面に出ている（dev 専用画面なので実害はないが表記の揺れ）。

## 失敗詳細

なし。
