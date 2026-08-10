# EDGE-4: オープンリダイレクト防止

**結果**: PASS
**目的**: サインイン後の復帰先が同一オリジンのパスに制限されていること（AC-15、plan.md リスク欄）

## 実行ログ

各パターンとも、未認証状態で `/signin?redirect=…` を開き、`user-a@example.com` / `Passw0rd123` で正しくサインインした後の着地 URL を確認した（パターン間はアカウントメニューからサインアウトして未認証に戻している）。

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | `/signin?redirect=https://example.com` でサインイン | 外部サイトへ遷移せず既定の `/notes` へ着地 | 着地 URL は `http://localhost:3000/notes`。`example.com` へは遷移せず、user-a のノート一覧（2 件）が表示 | PASS |
| 2 | `/signin?redirect=//example.com`（プロトコル相対 URL）でサインイン | 同上 | 着地 URL は `http://localhost:3000/notes`。`//example.com` はスキーム相対の外部遷移になり得るが遮断されている | PASS |
| 3 | `/signin?redirect=%2F%5C%2Fexample.com`（デコード後 `/\/example.com` — バックスラッシュによるスキーム相対バイパス） | 同上 | 着地 URL は `http://localhost:3000/notes`。`/` 始まりでも実質外部になるパターンを弾いている | PASS |
| 4 | （正常系の対照）`/signin?redirect=%2Fnotes%2F019feb0e-e2a8-7703-b022-9a8f8745dafd` でサインイン | 同一オリジンの相対パスは復帰先として尊重される | 着地 URL は `http://localhost:3000/notes/019feb0e-e2a8-7703-b022-9a8f8745dafd`。`redirect` 機能自体は生きており、手順1〜3 は「機能が壊れている」ではなく「外部だけ拒否」であることを確認 | PASS |

## 補足

- 手順1〜3 はいずれも `/notes`（安全なフォールバック先）へ着地し、外部オリジンへのナビゲーションは 1 度も発生しなかった。
- 手順4 の対照実験により、フォールバックが「常に `/notes` に固定されているだけ」ではなく、同一オリジンのパスは正しく復帰先として使われることを確認済み。
