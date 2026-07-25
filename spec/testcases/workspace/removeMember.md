# テストケース: removeMember

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で、対象が editor | 除名する | `Membership` が削除され、`membership.removed` が発行される | |
| owner が 1 名で、その owner を対象にする | 除名する | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる | |
| editor である | 除名する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 除名後 | 対象がそのワークスペースのノートを開く | 「見つかりません」が返る | |
| 除名対象が作成したノートがある | 除名する | ノートはワークスペースに残る | |
| 除名対象がノートを編集中 | 除名後に保存する | 保存が拒否される | |
| 存在しないメンバーシップ ID | 除名する | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる | |
