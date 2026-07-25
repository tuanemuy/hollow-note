# テストケース: signInWithPassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `ActiveUser` とパスワード認証手段がある | 正しいメールとパスワードでサインインする | セッションが発行され、失敗回数が 0 に戻る | |
| `ActiveUser` がある | 誤ったパスワードでサインインする | `ValidationError("INVALID_CREDENTIALS")` が投げられ、失敗回数が 1 増える | |
| 未登録のメールアドレス | サインインする | `ValidationError("INVALID_CREDENTIALS")` が投げられる（利用者不在と区別されない） | |
| Google のみで登録した利用者 | メールとパスワードでサインインする | `ValidationError("INVALID_CREDENTIALS")` が投げられる | |
| `PendingUser` がある | 正しいパスワードでサインインする | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられ、セッションは発行されない | |
| 失敗が 2 回記録されている | 3 回目に失敗する | `ValidationError("LOGIN_THROTTLED")` が投げられ、待機秒数が添えられる | |
| 失敗が 9 回記録されている | 10 回目に失敗する | `ValidationError("LOGIN_LOCKED")` が投げられ、解除時刻が添えられる | |
| ロック中 | 正しいパスワードでサインインする | `ValidationError("LOGIN_LOCKED")` が投げられる | |
| ロックの期限が切れている | 正しいパスワードでサインインする | サインインが成功する | |
