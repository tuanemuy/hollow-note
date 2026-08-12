# 項目 7: パスワード再設定 — パスワード手段を持たないアカウントへの申請

**結果**: PASS
**対応する受け入れ基準**: AC-10、AC-12（TC-25）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | ウィンドウ2 でサインアウトし、`/signin` の「パスワードを忘れた」から `/reset-password` を開く | 申請モードの `/reset-password` が開く | アカウントメニューの「サインアウト」→ `/signin`。「パスワードを忘れた」は実リンクで、押すと `http://localhost:3100/reset-password` へ遷移。「パスワードを再設定」見出し + メールアドレス欄 +「再設定リンクを送る」+「サインインに戻る」 | PASS |
| 2 | `google-a@example.com` を入力して送信 | 共通の完了文言が出る | 「メールを送りました／そのアドレスで登録されていれば、再設定のリンクが届きます。リンクは 1 時間で無効になります。／サインインに戻る」 | PASS |
| 3 | サーバーログを確認 | 再設定リンクではなく `passwordResetUnavailable` の案内メール | `mail.sent { to: 'google-a@example.com', template: 'passwordResetUnavailable', actionUrl: 'http://localhost:3100/signin' }`。`/reset-password?token=` の URL は出ていない | PASS |

## 確認ポイント

- `/signin` の「パスワードを忘れた」が **実リンク**（`/reset-password` へ遷移）になっており、#1 の「文言のみ」縮退が解消されている。
- `actionUrl` はサインイン画面（`http://localhost:3100/signin`）で、ホストは `localhost:3100`。

## 失敗詳細

なし。
