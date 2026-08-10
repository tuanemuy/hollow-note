# TC-1: サインアップの基本フロー

**結果**: PASS
**対応する受け入れ基準**: AC-16（P-01）、AC-8

## テストアカウント

- メール: `user-a@example.com`
- パスワード: `Passw0rd123`
- 表示名: `User A`
- 状態: サインアップ済み（TC-3 でメール確認済みになる）
- userId: `019feb0a-ee57-74e7-bab2-1871794ed58f`

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | `http://localhost:3000/` を開き「はじめる」を選ぶ | `/signup` へ遷移 | ヘッダーの「はじめる」リンクから `/signup`（「アカウントを作る」）へ遷移 | PASS |
| 2 | メール `user-a@example.com` / パスワード `Passw0rd123` / 表示名 `User A` を入力 | 入力できる | 3 項目とも入力反映。パスワード `Pass`（途中）で「強度: 弱い」、`Passw0rd123` で「強度: 強い」へ変化（強度メーターが反応） | PASS |
| 3 | 利用規約に同意チェック → 送信 | 送信完了状態に切り替わる | チェック前は送信ボタン `disabled`、チェック後に有効化。送信後「確認メールを送信しました / user-a@example.com 宛に確認メールを送りました…リンクは 24 時間で無効になります」＋「サインインへ」リンク | PASS |
| 4 | サーバーログを確認 | `user-a@example.com` 宛の確認メール（URL 付き） | `mail.sent { to: 'user-a@example.com', template: 'emailVerification', actionUrl: 'http://localhost:3000/verify-email?token=MDE5...' }`。併せて `identity.user.created` / `identity.identity.added` イベントも配信 | PASS |
| 5 | （確認ポイント）`/notes` を直接開く | サインイン画面へ弾かれる | `http://localhost:3000/signin?redirect=%2Fnotes` へリダイレクト。サインインフォームが表示 | PASS |

## 補足

- サインアップ応答で `hollow_pending_verification` Cookie が発行される（`httpOnly: true` / `sameSite: Lax` / `path: /` / `secure: false` / 有効期限 2026-08-11T09:39:49Z ＝ 約 24 時間後）。dev（http）で `secure` が付かないのは計画どおりの縮退。
