# テストケース: deleteMembershipsForUser

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| account deletionが3 workspace edgeを列挙 | 各scope commandを実行する | 1 commandは指定された1 workspaceだけを処理し、3 scopeが独立にackする | |
| targetが唯一のowner | commandを処理する | local transactionの再検査で `LastOwnerCannotLeave`、membershipを削除しない | |
| ownerが他にもいる | commandを処理する | 本人のactive Job終端・著者投影置換・membership削除を同じscopeのtask列で完了する | |
| 他利用者のmembership / Jobがある | 処理する | 触れない | |
| 同じoperation IDを2回配送 | 処理する | `applied_operations` により保存済み結果を返す | |
| local ack後にglobal更新が失敗 | recoveryを実行する | local権限は既に失われ、directory edgeだけをoperation IDで削除する | |
| pending edgeでlocal membershipがない | commandを処理する | 0件でackし、global pending edgeを削除できる | |
