# テストケース: applyTextNodeEdits

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本文があり、有効な経路と `expected` を指定する | 編集を適用する | そのテキストノードだけが書き換わり、要素・属性は保たれる | |
| 元の HTML に `class` と `style` がある | 編集を適用する | 属性がそのまま残る | |
| 存在しない経路を指定する | 適用する | その編集は `skipped(pathNotFound)` になり、他は適用される | |
| `expected` が現在の内容と異なる | 適用する | その編集は `skipped(contentChanged)` になる | |
| すべての編集が `skipped` になる | 適用する | 成功として返り、版は作られず本文も変わらない | |
| テキストを空文字列にする | 適用する | ノードは削除されず空のまま残る | |
| 本文が `processing` で、実行中の変換・再生成ジョブがない（ジョブがキャンセル・回収された後） | 適用する | 手順 2 の `NoteLockedByJob` 検査を通過し、手順 3 で `BusinessRuleError(CannotCaptureEmptyContent)` が投げられる | |
| 本文が `awaitingIntegration` または `failed`（実行中ジョブなし） | 適用する | 同じく手順 3 で `BusinessRuleError(CannotCaptureEmptyContent)` が投げられる | |
| 本文が `processing` で、その変換ジョブが実行中 | 適用する | 手順 2 が先に効くため、`CannotCaptureEmptyContent` ではなく `BusinessRuleError(NoteLockedByJob)` が投げられる（検査の順序を確認する） | |
| 実行中の再生成ジョブがある（本文は `ready` のまま） | 適用する | `BusinessRuleError(NoteLockedByJob)` が投げられる | |
| `script` の中身を指す経路を指定する | 適用する | `skipped(pathNotFound)` になる（編集対象外） | |
| `<style>` の中身を指す経路を指定する | 適用する | `skipped(pathNotFound)` になる。`editTextNodes` は `<style>` の子テキストノードに経路を割り当てないため、ビジュアルエディタから CSS を書き換えて `position: fixed` / `@import` を再注入する経路が存在しない | |
| 編集が成功した | 保存までの経路を確認する | `editTextNodes` の結果を `HtmlProcessor.process` に通してから `Note.updateBody` に渡す（`updateBody` は `ProcessedHtml` を要求する。派生情報も作り直される） | |
| 編集でテキストを書き換えた | 保存後の `excerpt` / `headings` を確認する | 書き換え後の本文から作り直されている（`process` を通さないと読み取りモデルへの投影が古いまま残る） | |
| viewer である | 適用する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 他者が先に更新した | 古い `expectedVersion` で適用する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 適用が成功した | 版を確認する | 直前の内容が `manualEdit` として記録されている | |
