# テストケース: updateWorkspaceProfile

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner である | 名前と説明を更新する | 値が更新される | |
| editor である | 更新する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| viewer である | 更新する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 非メンバーである | 更新する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 公開中のワークスペース | 名前を更新する | 公開状態は保たれる | |
| — | 名前を空文字列にする | `BusinessRuleError(InvalidName)` が投げられる | |
| 同時に別の要求が更新した | 更新する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
