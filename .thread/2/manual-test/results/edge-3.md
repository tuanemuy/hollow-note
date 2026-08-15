# エッジケース 3: dev IdP のコールバックを直接改ざんする

**結果**: PASS
**対応する受け入れ基準**: AC-9（ADR-007 の `state` 単回消費）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | ウィンドウ2 の `/signin` から「Google で続ける」→ dev IdP 同意画面で `google-a@example.com` / `グーグル太郎` / `email_verified` ON で「許可する」 | サインインが成功する（このケースで再利用するコールバック URL を得る） | `/auth/callback/google?code=eyJ2IjoxLC…&state=OBc1zVVbKUpGXK6jfjdKyHhULr3dn0NkaOUnlkE9feg` を経て `/notes` へ。サインイン成功 | PASS |
| 2 | 成功したコールバック URL（手順 1 の `code` / `state` そのまま）を同じウィンドウで再度開く | サインイン状態にはならず、失敗状態が表示される | 「手続きを完了できませんでした／認可の手続きが途中で切れました。もう一度やり直してください。／Hollow に戻る」を表示。`/auth/callback/google` に留まり `/notes` へは進まない | PASS |
| 3 | Cookie を持たない別ウィンドウ（`mt-w3`）で同じ URL を開く | 新しいセッションが発行されない | 同じ失敗表示。`cookies` の出力は空（`hollow_session` 無し）。続けて `/notes` を開くと `/signin?redirect=%2Fnotes` へリダイレクト | PASS |

## 確認ポイント

- `state` は 1 回で消費され、同じ `code` / `state` の組では 2 度目の交換ができない（ADR-007）。
- 失敗表示は intent 中立の文言（「認可の手続きが途中で切れました」）で、再試行導線として「Hollow に戻る」だけを出す。
- 未認証のブラウザで再生しても Cookie が発行されない＝コールバック URL の使い回しでセッションを奪えない。

## 失敗詳細

なし。
