# テストケース: rebuildNoteProjection

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 読み取りモデルが空でノートが 50 件ある | `ownerType: null` で全件を対象に再構築する | `NoteRepository.listAll(cursor, batchSize)` を `NoteId` 順に読み進め、50 件の行が作られる | |
| 全件再構築で対象が `batchSize` を超える | 再構築する | 最後に読んだ `NoteId` を `cursor` に次の塊を読み、重複も取りこぼしもなく全件が処理される（総件数は数えないため `PaginationResult` を返さない） | |
| 読み取りモデルの内容がずれている | 再構築する | 書き込みモデルの内容に一致する | |
| 所有者を指定する（`ownerType` が非 `null`） | 再構築する | `NoteRepository.listByOwner(owner, "all", pagination)` を `batchSize` 件ずつ読み、その所有者のノートだけが対象になる | |
| 所有者を指定した文脈にゴミ箱のノートがある | 再構築する | `lifecycle: "all"` で引くためゴミ箱のノートも読み取りモデルに載る | |
| 通常の一覧経路 | `listAll` の利用を確認する | 全件再構築（`ownerType` 未指定）だけが `listAll` を使い、通常の一覧経路からは呼ばない | |
| 1 件の処理が失敗する | 再構築する | 記録して継続し、他は処理される | |
| ノートが 0 件 | 再構築する | `processedCount: 0` が返る | |
| ノートが 1 件ある | 再構築する | `NoteProjectionWriter.upsert` と `updateTags` の 2 呼び出しで投影が作られる（`upsert` はタグの 3 経路と表示名に触れないため、この組でしか再構築できない） | |
| タグが付いたノートがある | 再構築する | タグを引き直して表示名と正規化名の組（`{ name, normalized }`）で `updateTags` が呼ばれ、`tag_names` / `tag_names_fts` / `note_search_tags` と表示名が揃う | |
| 著者・ワークスペースの情報がある | 再構築する | `upsert` の呼び出し側が解決して渡し、著者列・ワークスペース列が埋まる | |
| `created_by` の利用者が退会している | 再構築する | `projectNoteChanges` と同じ既定値 `{ displayName: "退会した利用者", handle: null }` が入る | |
| 2 回続けて実行する | 再構築する | 結果が変わらない（冪等） | |
