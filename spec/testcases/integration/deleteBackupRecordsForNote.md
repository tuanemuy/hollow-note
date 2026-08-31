# テストケース: deleteBackupRecordsForNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 完全削除されたノートにバックアップ記録が 2 件ある | `note.purged` を処理する | 2 件の記録が削除され、`deletedCount: 2` が返る | |
| 処理後 | Drive 上のファイルを確認する | 削除されない（バックアップは利用者自身の Drive にあり、扱いは利用者に委ねる。IN-09） | |
| 他のノートのバックアップ記録がある | 処理する | 他のノートの記録は削除されない | |
| 記録の所有者が削除実行者と異なるメンバー | 処理する | 所有者によらず、そのノートの記録がすべて削除される | |
| 対象ノートの記録が 1 件もない | 処理する | 何もせず `deletedCount: 0` で成功として返る | |
| 同じイベントを 2 回受け取る | 2 回処理する | 2 回目は削除対象がなく `deletedCount: 0` で終わり、結果は変わらない（冪等） | |
| ワークスペース削除に伴う `note.purged` を受け取る | 処理する | ワークスペース所有ノートの記録もこの経路で削除される（`backup_records` は owner 列を持たず `noteId` 経由でしか特定できないため） | |
| 記録が250件ある | 処理する | 100件ずつ`integration.noteDeleteContinued`で再開し、同じ`deletionOperationId`を保持する | |
| personal account deletion由来 | 処理する | personal scopeのcleanup owner receipt一致時だけ削除する。障壁が既に `completed` でも削除する（この追随者は receipt に触れないため） | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
