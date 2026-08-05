# テストケース: deleteTag

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 3 件のノートに付いたタグ | 削除する | `affectedNotes: null`, `status: "pending"`とoperation IDが返り、Alarm完了照会で3件と確定する | |
| 10,000 件のノートに付いたタグ | 削除する | operation lock後、付与を最大200件ずつ50 turnに分け、1 transactionのCPU・revision bump・task数を有界にする | |
| 各pageを処理する | 保存境界を確認する | assignment削除、各Noteのprojection revision bump、個別`projection.reprojectRequested`を同じscope-local UoWで保存する | |
| 同じpageに200 Noteがある | task IDを確認する | `tagOperationId + plane + noteId + projectionRevision`由来の決定的IDでlocal task/public outboxが別々に保存され、同一pageの再実行では増殖しない | |
| page commit後・public Queue処理前にNoteがmoveする | public requestを処理する | consumerがcurrent routeを解決して移動先を再投影し、旧scope snapshotを書かない | |
| page間に同じタグを付与/renameしようとする | 実行する | operation lockにより競合として拒否され、新規付与が削除処理の後ろへ入り込まない | |
| page commit後にworkerが停止する | 再開する | 同じoperation IDで残るassignmentの先頭から再開し、二重revision bumpせず完了する | |
| 削除後 | 発行されたイベントを確認する | `tag.deleted` も発行されるが用途は監査のみで、読み取りモデルは各pageの`projection.reprojectRequested`が更新済みである | |
| 削除後 | ノートを確認する | ノート自体は残り、そのタグだけが外れている | |
| 使用件数 0 のタグ | 削除する | bounded workerの最初のturnで0件を確認して削除され、完了照会で`affectedNotes: 0`になる | |
| 存在しないタグ ID | 削除する | `NotFoundError("TAG_NOT_FOUND")` が投げられる | |
| 他スコープのタグ | 削除する | `NotFoundError("TAG_NOT_FOUND")` が投げられる | |
| ワークスペースの viewer | 削除する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 削除後 | そのタグで絞り込む | 結果が 0 件になる | |
