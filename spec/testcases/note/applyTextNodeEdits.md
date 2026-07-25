# テストケース: applyTextNodeEdits

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本文があり、有効な経路と `expected` を指定する | 編集を適用する | そのテキストノードだけが書き換わり、要素・属性は保たれる | |
| 元の HTML に `class` と `style` がある | 編集を適用する | 属性がそのまま残る | |
| 存在しない経路を指定する | 適用する | その編集は `skipped(pathNotFound)` になり、他は適用される | |
| `expected` が現在の内容と異なる | 適用する | その編集は `skipped(contentChanged)` になる | |
| すべての編集が `skipped` になる | 適用する | 成功として返り、版は作られず本文も変わらない | |
| テキストを空文字列にする | 適用する | ノードは削除されず空のまま残る | |
| 本文が `processing` のノート | 適用する | `BusinessRuleError(CannotCaptureEmptyContent)` が投げられる | |
| `script` の中身を指す経路を指定する | 適用する | `skipped(pathNotFound)` になる（編集対象外） | |
| viewer である | 適用する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 他者が先に更新した | 古い `expectedVersion` で適用する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 適用が成功した | 版を確認する | 直前の内容が `manualEdit` として記録されている | |
