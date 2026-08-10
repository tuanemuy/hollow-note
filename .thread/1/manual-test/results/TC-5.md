# TC-5: サインアウト

**結果**: PASS
**対応する受け入れ基準**: AC-15、AC-18（AppShell アカウントメニュー）、ADR-008

## 使用アカウント

- `user-a@example.com` / `Passw0rd123`（サインイン状態から実施）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | アカウントメニューを開く | 表示名とサインアウトが出る | 「User A」＋ ボタン「サインアウト」 | PASS |
| 2 | サインアウトを実行（Network 観察） | 未認証へ戻る／Cookie 破棄／POST で実行 | `POST /_serverFn/...AccountMenu/action.ts...signOutFn... → 200`（GET リンクではない、ADR-008 準拠）。実行後 `http://localhost:3000/` へ遷移し、Cookie 一覧が空（`hollow_session` 削除済み） | PASS |
| 3 | `/notes` を再度開く | サインイン画面へリダイレクト | `http://localhost:3000/signin?redirect=%2Fnotes` へリダイレクトし、サインインフォームを表示 | PASS |
