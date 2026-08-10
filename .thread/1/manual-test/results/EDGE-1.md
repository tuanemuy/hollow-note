# EDGE-1: 登録済みメールでの再サインアップ（応答同一性）

**結果**: PASS
**目的**: サインアップ応答からアカウントの存在が漏れないこと（AC-8）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | `/signup` を開き、確認済みユーザー `user-a@example.com` / `Passw0rd123` / `User A` を入力し規約に同意して送信 | 画面は未登録時と同一の送信完了状態 | 見出し「確認メールを送信しました」＋本文「user-a@example.com 宛に確認メールを送りました。メール内のリンクを開くと登録が完了します。リンクは 24 時間で無効になります。」＋「サインインへ」リンク。TC-1（未登録時）の記録と文言・構造が完全一致 | PASS |
| 2 | サーバーログを確認 | 確認メールではなく既存アカウント通知メールが出力される | `mail.sent { to: 'user-a@example.com', template: 'existingAccountNotice', actionUrl: 'http://localhost:3000/signin' }`。`emailVerification` テンプレートおよび `?token=` 付き URL は出力されていない | PASS |
| 3 | （注記の確認）未確認ユーザー `pending@example.com` / `Passw0rd123` / `Pending User` で同様に再サインアップ | Pending でも同じ挙動（既存アカウント通知メール） | 画面は同一の「確認メールを送信しました」状態。ログは `mail.sent { to: 'pending@example.com', template: 'existingAccountNotice', actionUrl: 'http://localhost:3000/signin' }` | PASS |
| 4 | 手順1・3 でユーザー状態が変化していないことを確認 | 既存アカウントが上書き・再作成されない | `identity.user.created` などのドメインイベントは追加出力されず、新しい確認トークンも発行されない（`pending@example.com` の未消費トークンは無効化されないまま残存） | PASS |

## 補足

- 画面表示は「登録済み / 未登録 / 未確認」のいずれでも同一で、レスポンスからアカウントの存在・状態は判別できない。差分はログ（＝メール受信者本人にしか届かない経路）にのみ現れる。
- testing.md の注記どおり、確認メールが再送されないことは失敗と判定していない（usecase / TC-identity-255 側を正とする）。
