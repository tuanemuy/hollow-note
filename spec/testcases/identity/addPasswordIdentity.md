# テストケース: addPasswordIdentity

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| Google のみで登録した利用者 | パスワードを追加する | `PasswordIdentity` が作られ、`identity.added` が発行される | |
| 既にパスワード認証手段を持つ利用者 | パスワードを追加する | `BusinessRuleError(PasswordIdentityAlreadyExists)` が投げられる | |
| — | 強度要件を満たさないパスワードで追加する | `BusinessRuleError(WeakPassword)` が投げられる | |
| 追加後 | 追加したパスワードでサインインする | サインインが成功する | |
| 同じ利用者に対して 2 つの要求が同時に走る | 両方が追加する | 片方は成功、もう片方は `ConflictError` または `BusinessRuleError(PasswordIdentityAlreadyExists)` になる | |
