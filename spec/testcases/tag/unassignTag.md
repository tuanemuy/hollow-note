# テストケース: unassignTag

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| タグが付いたノート | 外す | 付与が削除され、`tag.unassigned` が発行される | |
| 付いていないタグ | 外す | 何もせず成功する | |
| 外した後 | タグ自体を確認する | タグは残る（使用件数が減るだけ） | |
| viewer である | 外す | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しないノート | 外す | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| move直後のstale route | 外す | primaryで1回引き直し、target scopeだけを変更する | |
| routeが`purging` | 外す | `NOTE_NOT_FOUND`で付与を変更しない | |
| 外した後 | 読み取りモデルを確認する | `tag.unassigned` を受けた `projectNoteChanges` が完全snapshotを置換し、外したタグを`tag_names` / `note_search_tags` / `tag_display_names`とFTS `tag_names_fts`から同一バッチで除く | |
| 外した後、同じノートに他のタグが残っている | 読み取りモデルを確認する | 完全snapshotのタグ集合に含まれる残りのタグは3列とFTS索引のすべてに残る | |
