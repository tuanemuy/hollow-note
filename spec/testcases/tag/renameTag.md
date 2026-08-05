# テストケース: renameTag

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 同名タグのない状態 | 名前を変更する | タグ名が更新され、付いているすべてのノートの表示に反映される | |
| 同じスコープに同名タグがある、`confirmMerge: false` | 変更する | 変更されず `mergeRequired: true` が返る | |
| 同じスコープに同名タグがある、`confirmMerge: true` | 変更する | 統合operationが受理され、`merged: true`、統合先tagId、operation ID/statusが返る。pendingならUIは整理中を表示する | |
| 統合の経路 | `mergeTags` の呼び出しを確認する | 手順の複製ではなくユースケースの呼び出し。`renameTag` は手順 5 までに書き込みを行わないため末尾呼び出しになり、`run` の入れ子も部分確定も生じない | |
| 大文字小文字だけが違う名前にする | 変更する | 正規化名が変わらないため衝突とみなされず、`Tag.rename` で表示名だけが更新される（統合は起きない） | |
| — | 空文字列にする | `BusinessRuleError(InvalidTagName)` が投げられる | |
| — | 空白のみにする | `BusinessRuleError(InvalidTagName)` が投げられる | |
| — | 51 文字にする | `BusinessRuleError(InvalidTagName)` が投げられる | |
| 他スコープのタグ ID を指定する | 変更する | `NotFoundError("TAG_NOT_FOUND")` が投げられる | |
| ワークスペースの viewer | 変更する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 正規化名の変わる名前に変更した後 | 読み取りモデルを確認する | `tag.renamed` が対象ノートごとにlocal task/public outboxを積み、各consumerの完全snapshot置換で`tag_names` / `note_search_tags` / `tag_display_names`とFTS `tag_names_fts`を同一バッチで更新する | |
| 大文字小文字だけを変えて変更した後 | 読み取りモデルを確認する | `tag_display_names` だけが新しい表示名になり、`tag_names` / `tag_names_fts` / `note_search_tags.normalized` は正規化名のまま変化しない | |
| 大文字小文字だけを変えて変更した後 | 旧・新どちらの表記でも検索する | どちらでもヒットする（`tag_names_fts` が変わらないため関連度も変わらない） | |
