# テストケース: renameTag

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 同名タグのない状態 | 名前を変更する | タグ名が更新され、付いているすべてのノートの表示に反映される | |
| 同じスコープに同名タグがある、`confirmMerge: false` | 変更する | 変更されず `mergeRequired: true` が返る | |
| 同じスコープに同名タグがある、`confirmMerge: true` | 変更する | 統合され、`merged: true` が返る | |
| 大文字小文字だけが違う名前にする | 変更する | 表示名だけが更新され、統合は起きない | |
| — | 空文字列にする | `BusinessRuleError(InvalidTagName)` が投げられる | |
| — | 空白のみにする | `BusinessRuleError(InvalidTagName)` が投げられる | |
| — | 51 文字にする | `BusinessRuleError(InvalidTagName)` が投げられる | |
| 他スコープのタグ ID を指定する | 変更する | `NotFoundError("TAG_NOT_FOUND")` が投げられる | |
| ワークスペースの viewer | 変更する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 変更後 | 読み取りモデルを確認する | `tag_names` が更新されている | |
