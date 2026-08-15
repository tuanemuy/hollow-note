# 項目 16: 認証手段管理 — 他人に紐づいた Google を追加しようとする

**結果**: PASS
**対応する受け入れ基準**: AC-15、AC-17 ／ TC-29

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | ウィンドウ1 でサインアウトし `user-a@example.com` / `NewPassw0rd456` でサインイン | サインインできる | `/notes` へ遷移 | PASS |
| 2 | `/settings/auth` で「Google を追加」を押す | `/dev/oauth/authorize` へ遷移 | `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=...&state=...&code_challenge=...&code_challenge_method=S256` へ遷移し、同意画面が表示 | PASS |
| 3 | 同意画面で `google-a@example.com` / `グーグル太郎` / `email_verified` ON で「許可する」 | 別の利用者に紐づいている旨のエラーが出て追加されない | `/auth/callback/google` で「手続きを完了できませんでした／この外部アカウントは別の利用者に紐づいています。別のアカウントでお試しください。」＋「Hollow に戻る」 | PASS |
| 4 | 戻った `/settings/auth` の一覧を確認 | 「メールアドレスとパスワード」1 件のまま、Google は増えていない | 一覧は「メールアドレスとパスワード（有効・追加 2026年8月12日）」1 件のみ。解除ボタンは `disabled`、「Google を追加」導線が残っている | PASS |
| 4-確認 | サインイン状態が壊れていないか | `user-a` のままで `グーグル太郎` に切り替わらない | `/settings/profile` の表示名は `ユーザーA`、アイコンのイニシャルも「ユー」。`user-a` のセッションが維持されている | PASS |
