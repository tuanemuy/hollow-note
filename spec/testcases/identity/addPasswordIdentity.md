# テストケース: addPasswordIdentity

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| Google のみで登録した利用者が再認証を済ませている | パスワードを追加する | `PasswordIdentity` が作られ、`identity.added` が発行される | |
| 再認証が済んでいない | パスワードを追加する | `ValidationError("REAUTHENTICATION_REQUIRED")` が投げられ、`PasswordIdentity` は作られない | |
| 利用者が不在 | パスワードを追加する | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| 利用者が `ActiveUser` でない（`PendingUser` / `DeletingUser`） | パスワードを追加する | `ValidationError("ACCOUNT_UNAVAILABLE")` が投げられる | |
| 既にパスワード認証手段を持つ利用者 | パスワードを追加する | `BusinessRuleError(PasswordIdentityAlreadyExists)` が投げられる | |
| — | 強度要件を満たさないパスワードで追加する | `BusinessRuleError(WeakPassword)` が投げられる | |
| 追加後 | 追加したパスワードでサインインする | サインインが成功する | |
| 同じ利用者に対して 2 つの要求が同時に走る | 両方が追加する | 片方は成功、もう片方は `ConflictError` または `BusinessRuleError(PasswordIdentityAlreadyExists)` になる | |
| OAuth Identityを8件持ちPasswordは未登録 | パスワードを追加する | `BusinessRuleError(IdentityLimitExceeded)`となり、9件目を作らない | |
| Identityが7件のときOAuth linkとPassword追加が同時に走る | 両方の最終UoWを実行する | current件数の再検査/DB triggerにより一方だけ成功し、合計8件を超えない | |
