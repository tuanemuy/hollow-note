# TC-3: メール確認リンクでサインイン状態になりノート一覧へ着地

**結果**: PASS
**対応する受け入れ基準**: AC-17、AC-15（Cookie 属性）

## 使用アカウント

- メール: `user-a2@example.com` / パスワード: `Passw0rd123` / 表示名: `User A2`（確認済み・Active）
- ※ 当初は `user-a@example.com`（TC-1 で作成）で実行したが、TC-2 実行中にブラウザセッションが一度 `about:blank` に落ちて **Cookie がすべて失われた**ため、確認待ち Cookie を持たない別ウィンドウ相当の状態になり ADR-038 の「サインインへ」フォールバックに倒れた。これはテスト実行環境側の事故のため、確認待ち Cookie が正しく残った状態で再実行するべく `user-a2@example.com` を新規にサインアップして本ケースを実施した。`user-a@example.com` はその 1 回目の確認で **メール確認済み（Active）** になっている。

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | サーバーログの確認 URL をサインアップと同じウィンドウで開く | 確認ページ → `/notes` | `/verify-email?token=...` で「メールアドレスを確認しています / 数秒で終わります。」（処理中）を表示した後、`http://localhost:3000/notes` へ遷移 | PASS |
| 2 | Network を観察 | トークン消費は GET ではなく POST | `POST /_serverFn/...VerifyEmailPanel/action.ts...verifyEmailFn... → 200` が発行されている（ページ自体の GET はトークンを消費しない）。ADR-007 準拠 | PASS |
| 3 | 遷移後にサインイン状態を確認 | アカウントメニューに表示名 | ヘッダーの「アカウントメニュー」を開くと `User A2` と「サインアウト」が表示。`/notes` に「個人 / 0 件のノート」 | PASS |
| 4 | セッション Cookie を確認 | `HttpOnly` / `SameSite=Lax` / `Path=/` / 約 30 日 | `hollow_session`: `httpOnly: true`, `sameSite: Lax`, `path: /`, `expires: 2026-09-09T09:42:51Z`（= 30.00 日後）, `secure: false` | PASS |
| 5 | 確認待ち Cookie の消滅を確認 | 確認完了後に消えている | サインアップ直後は `hollow_pending_verification`（`httpOnly` / `Lax` / `Path=/` / 約 24 時間）が存在し、確認完了後の Cookie 一覧は `hollow_session` のみ（pending は消滅） | PASS |

## 補足（失敗ではない事象）

- dev（http）で `Secure` が付かないのは plan.md「縮退の記録」どおりであり失敗ではない。
- 別ウィンドウで確認 URL を開くと自動サインインせず「メールアドレスを確認しました → サインインへ」に倒れる挙動を（Cookie 消失により）偶然観測したが、ADR-038 の設計どおりであり不具合ではない。
