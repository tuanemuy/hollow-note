# テストケース: deleteFilesForNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 元ファイル 1 件・メディア 2 件・取り込んだ外部参照 1 件を持つノートが完全削除された | `note.purged` を処理する | 4 件すべてのメタデータが削除され、1 件ごとに `storage.fileDeleted` が発行され、`deletedCount: 4` が返る | |
| 同じノート由来の artifact（PDF エクスポートの生成物）もある | `note.purged` を処理する | artifact は削除の対象にならず残る（期限の経過時に `collectExpiredArtifacts` が回収する） | |
| 他のノートのメディアがある | `note.purged` を処理する | `listByNote(noteId)` に現れないため削除されない | |
| 所有者のアイコン（`purpose: "avatar"`）がある | `note.purged` を処理する | ノートに属さない（`noteId: null`）ため削除されない | |
| 削除後 | 使用量を確認する | `storage.fileDeleted` を購読する `applyStorageDelta` によって保存容量が返る | |
| 削除後 | オブジェクトストレージを確認する | 実体は `storage.fileDeleted` を購読する `deleteStoredObjects` が削除する | |
| 対象のファイルが 1 件もない（元ファイルのないノート） | `note.purged` を処理する | 何もせず成功し、`deletedCount: 0` が返る | |
| deletable fileが250件ある | 処理する | 100件ずつ`storage.noteDeleteContinued`で再開し、各taskが同じ`deletionOperationId`を保持する | |
| personal account deletion由来のtoken | 処理する | personal scopeのcommit済み`applied_operations` receiptと照合して通し、workspace専用portを要求しない。障壁が既に `completed` でも通す（この追随者は receipt に触れないため） | |
| workspace deletion由来の別operation ID | 処理する | manifest owner不一致として削除を拒否する | |
| 同じイベントを 2 回受け取る | 2 回処理する | 削除済みのファイルは `listByNote` に現れず、2 回目は `deletedCount: 0` で終わる（冪等） | |
| 一部のファイルが既に不在 | 処理する | 無視して継続し、残りが削除される | |
