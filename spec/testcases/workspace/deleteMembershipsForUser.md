# テストケース: deleteMembershipsForUser

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 退会した利用者が 3 つのワークスペースに参加している | `identity.user.deleted` を処理する | 3 件のメンバーシップが削除され、`deletedCount: 3` が返る | |
| 削除後 | 各ワークスペースのメンバー一覧を確認する | 退会者の行が現れない | |
| 退会者が owner として参加していたワークスペースがある（owner は他にもいる） | 処理する | owner のメンバーシップも削除される（唯一の owner でないことは `deleteAccount` の手順 2 が保証する） | |
| 同じワークスペースに他の利用者のメンバーシップがある | 処理する | 他の利用者のメンバーシップは削除されない | |
| 退会者が発行した招待・受諾した招待がある | 処理する | 招待は削除されず、`invited_by` / `accepted_by` は履歴として残る | |
| 処理後 | 発行されたイベントを確認する | イベントは発行されない（`workspace.membership.removed` は監査用で、退会そのものは `identity.user.deleted` が記録する） | |
| 退会者がワークスペースのノートに対して持っていた実行中ジョブ | 処理後に確認する | 本ユースケースはジョブに触れない。取り消しは `deleteAccount` の手順 3 が要求者（`listActiveByRequester`）とスコープ（`listActiveByScope`）の両面から済ませている | |
| 除名・脱退によるメンバーシップの削除 | 取り消しの担当を確認する | `removeMember` / `leaveWorkspace` の手順内で同期的に行われる（`workspace.membership.removed` の購読でジョブを取り消す経路は存在しない） | |
| メンバーシップが 1 件もない | 処理する | 何もせず `deletedCount: 0` で成功として返る | |
| 同じイベントを 2 回受け取る | 2 回処理する | 2 回目は削除対象がなく `deletedCount: 0` で終わり、結果は変わらない（冪等） | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
