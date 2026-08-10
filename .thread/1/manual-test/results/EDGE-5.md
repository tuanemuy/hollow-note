# EDGE-5: サインイン画面に見送り機能の UI が出ていないこと

**結果**: PASS
**目的**: 見送り行の placeholder 禁止方針の確認（plan.md スコープ）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | `/signin` を開いて snapshot を取得 | Google OAuth ボタン・パスワード再設定リンク・確認メール再送導線が無い（無効ボタンの placeholder も無い） | 要素は「メールアドレス」「パスワード」textbox、「サインイン」button（未入力のため disabled）、「アカウントを作る」リンクのみ。OAuth / 再設定 / 再送の UI は皆無 | PASS |
| 2 | `/signup` を開いて snapshot を取得 | 同上 | 要素は メール / パスワード / 表示名 の textbox、規約同意 checkbox（+ 利用規約・プライバシーポリシーへのリンク）、「アカウントを作る」button（disabled）、「サインイン」リンクのみ。OAuth ボタン等は皆無 | PASS |
| 3 | 両ページの HTML を `curl` して `google\|oauth\|パスワードをお忘れ\|再設定\|再送\|resend` を grep | ヒット 0 件 | どちらもヒット 0 件（SSR 出力にも placeholder が埋まっていない） | PASS |

## 補足

- 「サインイン」ボタンが disabled なのは未入力状態のフォームバリデーションによるもので、見送り機能の placeholder ではない。
- サインアップ画面のリンクは `/terms` と `/privacy`（TC-13 で確認済みの静的ページ）であり、見送り機能への導線ではない。
