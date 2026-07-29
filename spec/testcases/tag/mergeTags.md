# テストケース: mergeTags

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| タグ A（3 件）とタグ B（2 件）が同じスコープにある | A を B に統合する | B の使用件数が 5 になり、A が削除される | |
| 同じノートに A と B の両方が付いている | 統合する | 重複せず 1 件の付与になる | |
| 同じタグ同士を指定する | 統合する | `BusinessRuleError(CannotMergeIntoItself)` が投げられる | |
| 異なるスコープのタグを指定する | 統合する | `BusinessRuleError(ScopeMismatch)` が投げられる | |
| 存在しないタグ ID を指定する | 統合する | `NotFoundError("TAG_NOT_FOUND")` が投げられる | |
| ワークスペースの viewer | 統合する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 統合後 | 読み取りモデルを確認する | `tag.merged` を受けた `projectNoteChanges` が対象ノートごとに `updateTags` を呼び、`tag_names` / `tag_names_fts` / `note_search_tags` / `tag_display_names` の 4 か所が同一バッチで更新される | |
| 統合後 | 統合元のタグ名で確認する | 統合元の名前が 4 か所すべてから消え、統合先の名前だけが残る（同じノートに両方が付いていた場合も重複しない） | |
| 使用件数 0 のタグを統合する | 統合する | 成功し、`movedAssignments: 0` が返る | |
