# テストケース: restoreNoteRevision

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 版が複数あるノート | 過去の版を指定して戻す | 本文・タイトル・スタイルがその版の内容になる | |
| 戻した後 | 版の一覧を確認する | 戻す直前の内容が `reason: "restore"` で記録されている | |
| 他のノートの版 ID を指定する | 戻す | `NotFoundError("REVISION_NOT_FOUND")` が投げられる | |
| 存在しない版 ID | 戻す | `NotFoundError("REVISION_NOT_FOUND")` が投げられる | |
| viewer である | 戻す | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 公開中のノート | 戻す | 公開ステータスと共有リンクは変わらない | |
| タグが付いたノート | 戻す | タグは変わらない | |
| 他者が先に更新した | 古い `expectedVersion` で戻す | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
