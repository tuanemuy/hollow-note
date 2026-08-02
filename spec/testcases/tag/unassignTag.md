# テストケース: unassignTag

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| タグが付いたノート | 外す | 付与が削除され、`tag.unassigned` が発行される | |
| 付いていないタグ | 外す | 何もせず成功する | |
| 外した後 | タグ自体を確認する | タグは残る（使用件数が減るだけ） | |
| viewer である | 外す | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しないノート | 外す | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 外した後 | 読み取りモデルを確認する | `tag.unassigned` を受けた `projectNoteChanges` が `updateTags` を呼び、外したタグが `tag_names` / `note_search_tags` / `tag_display_names` の 3 列と FTS 索引の `tag_names_fts` 列すべてから同一バッチで除かれる | |
| 外した後、同じノートに他のタグが残っている | 読み取りモデルを確認する | 残ったタグは 3 列と FTS 索引のすべてに残る（`updateTags` はタグ集合を丸ごと入れ替える） | |
