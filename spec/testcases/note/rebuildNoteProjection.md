# テストケース: rebuildNoteProjection

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 読み取りモデルが空でノートが 50 件ある | `ownerType: null` で全件を対象に再構築する | `NoteRepository.listAll(cursor, batchSize)` を `NoteId` 順に読み進め、50 件ぶんの `projection.reprojectRequested` が積まれる。このユースケース自身は読み取りモデルに書き込まない | |
| 全件再構築で対象が `batchSize`（既定 100）を超える | 再構築する | 最後に読んだ `NoteId` を `cursor` に次の塊を読み、重複も取りこぼしもなく全件の要求が積まれる（総件数は数えないため `PaginationResult` を返さない） | |
| 1 バッチを処理する | 発行するクエリ数を確認する | 列挙 1 文 + 多行 outbox INSERT 1 文で、件数に比例しない | |
| 要求を積み終えた | 投影の完了を確認する | `requestedCount` が返った時点では 1 件も投影されていない。実際の書き込みは `projectNoteChanges` の `projection.reprojectRequested` 分岐が投影キューで行う | |
| 直接書き込む実装になっていないか | 経路を確認する | 読み取りモデルの書き手は `projectNoteChanges` だけに保たれる。直接書くと、この運用操作と生きているイベント購読が並行して単一ライターの前提が破れる | |
| 読み取りモデルの内容がずれている | 再構築して投影キューを空にする | 書き込みモデルの内容に一致する | |
| 所有者を指定する（`ownerType` が非 `null`） | 再構築する | `NoteRepository.listByOwner(owner, "all", pagination)` を `batchSize` 件ずつ読み、その所有者のノートだけが対象になる | |
| 所有者を指定した文脈にゴミ箱のノートがある | 再構築する | `lifecycle: "all"` で引くためゴミ箱のノートも読み取りモデルに載る | |
| 通常の一覧経路 | `listAll` の利用を確認する | 全件再構築（`ownerType` 未指定）だけが `listAll` を使い、通常の一覧経路からは呼ばない | |
| 書き込みモデルに存在しないノートの行が `note_search` に残っている | `sweepOrphans: true`（既定）で再構築する | その行が `note_search` / `note_search_tags` / FTS 索引から削除され、`sweptCount` に数えられる（`remove` の欠落は再投影だけでは直らない） | |
| 所有者を指定して再構築する | 孤児掃除の範囲を確認する | 対象所有者の行に限る（全件再構築でないため、他の所有者の行には触れない） | |
| `sweepOrphans: false` を指定する | 再構築する | 孤児行は残り、`sweptCount: 0` が返る | |
| 1 件の処理が失敗する | 再構築する | 記録して継続し、他は処理される | |
| ノートが 0 件 | 再構築する | `requestedCount: 0` が返る | |
| ノートが 1 件ある | 再構築して投影キューを空にする | `NoteProjectionWriter.upsert` と `updateTags` の 2 呼び出しで投影が作られる（`upsert` はタグの 3 列に触れないため、この組でしか再構築できない） | |
| タグが付いたノートがある | 再構築して投影キューを空にする | タグを引き直して表示名と正規化名の組（`{ name, normalized }`）で `updateTags` が呼ばれ、`tag_names` / `note_search_tags` / `tag_display_names` と FTS の `tag_names_fts` 列が揃う | |
| 著者・ワークスペースの情報がある | 再構築して投影キューを空にする | `upsert` の呼び出し側が解決して渡し、著者列・ワークスペース列が埋まる | |
| `created_by` の利用者が退会している | 再構築して投影キューを空にする | `projectNoteChanges` と同じ既定値 `{ displayName: "退会した利用者", handle: null }` が入る | |
| FTS 表を作り直したい（前処理関数を変えた場合など） | 手順を確認する | 先に FTS 表を再作成してから本ユースケースを走らせる。`INSERT INTO note_search_fts(note_search_fts) VALUES('rebuild')` は contentless 構成では使えない | |
| 2 回続けて実行する | 再構築する | 結果が変わらない（冪等。同じノートに要求が 2 件積まれても、投影は現在の状態からの上書きなので同じ行になる） | |
