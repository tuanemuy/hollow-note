# テストケース: changePassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| パスワード認証手段があり、複数のセッションがある | 正しい現在のパスワードと新しいパスワードで変更する | ハッシュが差し替わり、現在のセッション以外が削除される | |
| — | 誤った現在のパスワードで変更する | `ValidationError("INVALID_CREDENTIALS")` が投げられ、ハッシュは変わらない | |
| パスワード認証手段を持たない利用者 | 変更する | `NotFoundError("PASSWORD_IDENTITY_NOT_FOUND")` が投げられる | |
| — | 強度要件を満たさない新しいパスワードで変更する | `BusinessRuleError(WeakPassword)` が投げられる | |
| 変更後 | 古いパスワードでサインインする | `ValidationError("INVALID_CREDENTIALS")` が投げられる | |
| 変更中に他の要求が同じ認証手段を更新した | 変更する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
