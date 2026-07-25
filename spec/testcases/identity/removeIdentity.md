# テストケース: removeIdentity

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| パスワードと Google の 2 件を持つ利用者 | Google を解除する | `Identity` が削除され、`identity.removed` が発行される | |
| 認証手段が 1 件だけの利用者 | その 1 件を解除する | `BusinessRuleError(LastIdentityCannotBeRemoved)` が投げられ、削除されない | |
| 他の利用者の認証手段を指定する | 解除する | `NotFoundError("IDENTITY_NOT_FOUND")` が投げられる | |
| 存在しない ID を指定する | 解除する | `NotFoundError("IDENTITY_NOT_FOUND")` が投げられる | |
| Google Drive 連携がある利用者 | Google の認証手段を解除する | Drive 連携は残る | |
| 2 件のうち 2 件を同時に解除しようとする | 並行して実行する | 少なくとも 1 件は `BusinessRuleError(LastIdentityCannotBeRemoved)` になり、0 件にはならない | |
