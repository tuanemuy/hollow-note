# テストケース: deleteTagsForScope

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 退会処理中の利用者の個人スコープに 10 件のタグがある | account deletionのpersonal cleanup commandを処理する | 個人スコープの 10 件が削除され、`deletedCount: 10` が返る | |
| 削除されるタグに付与がある | 処理する | assignmentを200件ずつ先に削除し、0件になってからtagを最大100件ずつ消す | |
| 削除されたワークスペースのスコープに 4 件のタグがある | `workspace.deleted` を処理する | そのワークスペーススコープの 4 件だけが削除される | |
| 同じ利用者が別のワークスペースにもタグを持つ | `workspace.deleted` を処理する | 別スコープのタグは削除されない | |
| 退会者が参加していたワークスペースのタグがある | account deletionのpersonal cleanup commandを処理する | ワークスペーススコープのタグは削除されない（対象は個人スコープのみ） | |
| 処理後 | 発行されたイベントを確認する | イベントは発行しない（読み取りモデルの行は同じ削除イベントを購読する `deleteNotesForOwner` が消すため） | |
| `note.purged` 経由の `deleteAssignmentsForNote` が先に付与を消していた | 処理する | タグの削除は成功し、結果は変わらない（順序・重複によらず同じ） | |
| 対象スコープにタグが 1 件もない | 処理する | 何もせず `deletedCount: 0` で成功として返る | |
| 同じイベントを 2 回受け取る | 2 回処理する | 2 回目は削除対象がなく `deletedCount: 0` で終わり、結果は変わらない（冪等） | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
| 250件のtagがある | workspace削除で処理する | `deletionOperationId`を保持したtaskで100件ずつ3 Alarm turnに分け、各turnでowner一致を検査する | |
| 1 tagに10,000 assignmentがある | scope削除する | assignmentを200件/turnで回収し、Tag DELETEのFK CASCADEへ一括で渡さない | |
