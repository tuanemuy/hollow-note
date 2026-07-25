# テストケース: updateNoteBody

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 編集権限のあるノート | 有効な HTML で保存する | 本文が更新され、直前の内容が版として記録される | |
| `script` を含む HTML | 保存する | `script` が除去され、`removed` に理由つきで含まれる | |
| `onclick` 属性を含む HTML | 保存する | 属性が除去され、`removed` に含まれる | |
| `javascript:` の URL を含む HTML | 保存する | URL が除去され、`removed` に含まれる | |
| 壊れた HTML | 保存する | 補正された結果が保存され、例外にならない | |
| サニタイズ後が 1 MB を超える | 保存する | `BusinessRuleError(ContentTooLarge)` が投げられる | |
| サニタイズ前が 2 MB を超える | 保存する | `ValidationError` が投げられる（転送境界での制限） | |
| 版が 20 件ある | 保存する | 最古の版が削除され、20 件が保たれる | |
| viewer である | 保存する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ゴミ箱のノート | 保存する | `BusinessRuleError(NoteIsTrashed)` が投げられる | |
| 他者が先に更新した | 古い `expectedVersion` で保存する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 保存時に除名されている | 保存する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 新しい外部参照を含み `importReferences: true` | 保存する | 参照取り込みジョブが登録され、`referenceImportJobId` が返る | |
| 外部参照がなく `importReferences: true` | 保存する | ジョブは登録されず、`referenceImportJobId: null` が返る | |
| `reason: "wysiwygConversion"` | 保存する | 版の記録理由が `wysiwygConversion` になる | |
