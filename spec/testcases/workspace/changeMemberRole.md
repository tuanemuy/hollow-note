# テストケース: changeMemberRole

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で、対象が editor | viewer に変更する | ロールが変わり、`membership.roleChanged` が旧ロールつきで発行される | |
| owner が 1 名で、その owner を対象にする | editor に変更する | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる | |
| owner が 2 名で、片方を対象にする | editor に変更する | 変更が成功する | |
| 自分自身を対象にする | 変更する | `BusinessRuleError(CannotChangeOwnRole)` が投げられる | |
| editor である | 他人のロールを変更する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 他のワークスペースのメンバーシップ ID | 変更する | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる | |
| — | 未知のロールを指定する | `BusinessRuleError(InvalidRole)` が投げられる | |
| 同じロールを指定する | 変更する | 変更もイベントも起きず成功する | |
| 対象を editor から viewer にした後 | 対象がノートを編集する | 編集が拒否される | |
