# テストケース: purgeNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| ゴミ箱にあるノート | 完全削除する | ノートが削除され、`note.purged` が発行される | |
| 完全削除後 | 版（`note_revisions`）を確認する | DB の FK CASCADE で同時に削除される | |
| 完全削除後 | タグ付与を確認する | Tag の `deleteAssignmentsForNote` が `note.purged` を受けて削除する | |
| 完全削除後 | 保管ファイル（`source` / `media` / `reference`）を確認する | Storage の `deleteFilesForNote` が回収する | |
| 完全削除後 | バックアップ記録を確認する | Integration の `deleteBackupRecordsForNote` が削除する | |
| 完全削除後 | 読み取りモデルを確認する | Note の `projectNoteChanges` が該当の行を削除する | |
| 完全削除後 | 使用量を確認する | Usage の `applyStorageDelta` で保存容量とノート件数が減る | |
| Drive にバックアップがある | 完全削除する | Drive 上のファイルは残る（記録だけが消える） | |
| ゴミ箱にないノート | 完全削除する | `ValidationError("NOTE_NOT_TRASHED")` が投げられる | |
| viewer である | 完全削除する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 同じノートで 2 つの要求が同時に走る | 両方が完全削除する | 片方は成功、もう片方は `NotFoundError` になり、二重に減算されない | |
