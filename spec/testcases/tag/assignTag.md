# テストケース: assignTag

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 編集できるノート、同名タグなし | タグを付ける | タグが新規作成され付与され、`created: true` が返る | |
| 同じスコープに同名タグがある | タグを付ける | 既存のタグが使われ、`created: false` が返る | |
| 既に同じタグが付いている | 再度付ける | 重複した付与は作られず成功する | |
| — | 前後に空白のあるタグ名を指定する | 空白が除去されて保存される | |
| 全角英数字のタグ名がある | 半角で同じ名前を指定する | 同一とみなされ、新規作成されない | |
| 大文字のタグ名がある | 小文字で同じ名前を指定する | 同一とみなされる | |
| — | 空文字列のタグ名を指定する | `BusinessRuleError(InvalidTagName)` が投げられる | |
| — | 50 文字のタグ名を指定する | 成功する（境界値） | |
| — | 51 文字のタグ名を指定する | `BusinessRuleError(InvalidTagName)` が投げられる | |
| 既に 50 個のタグが付いている | さらに付ける | `BusinessRuleError(TooManyTags)` が投げられる | |
| 既に 49 個のタグが付いている | さらに付ける | 成功する（境界値） | |
| viewer である | 付ける | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ゴミ箱のノート（所有者本人） | 付ける | `BusinessRuleError(NoteIsTrashed)` が投げられる。処理フローの手順 1 で `canEdit` の確認とは**別に**ゴミ箱在籍を検査するため、`NoteAccessPolicy` が所有者に `canEdit: true` を返しても付与に進まない | |
| ゴミ箱のノート（ワークスペースの owner / editor で `viewTrash` を持つ） | 付ける | 同じく `BusinessRuleError(NoteIsTrashed)` が投げられる（権限判定を通過しても検査に掛かる） | |
| 個人ノートとワークスペースのノートに同名タグを付ける | それぞれに付ける | スコープごとに別のタグが作られる | |
| 同名タグを同時に 2 つの要求が作成する | 並行して付ける | 片方は `ConflictError("TAG_NAME_ALREADY_USED")` になり、読み直して再試行すれば成功する | |
| 付与に成功した | 読み取りモデルを確認する | `tag.assigned` を受けた `projectNoteChanges` が `updateTags` を呼び、`tag_names` / `note_search_tags` / `tag_display_names` の 3 列と FTS 索引の `tag_names_fts` 列が同一バッチで更新される | |
| 大文字・全角英数字を含むタグ名を付ける | 読み取りモデルを確認する | `tag_names` / `tag_names_fts` / `note_search_tags.normalized` には正規化名が、`tag_display_names` には入力どおりの表示名が入る | |
| 既にタグが付いているノートにもう 1 つ付ける | 読み取りモデルを確認する | ノートのタグ集合が丸ごと入れ替わり、既存のタグと新しいタグの両方が 3 列と FTS 索引のすべてに載る | |
| 既に同じタグが付いている（`created: false`、付与は増えない） | 読み取りモデルを確認する | イベントが発行されないため読み取りモデルは変化せず、内容も変わらない | |
