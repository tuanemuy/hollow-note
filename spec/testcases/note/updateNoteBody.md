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
| 実行中の変換ジョブがある | 保存する | `BusinessRuleError(NoteLockedByJob)` が投げられる | |
| 実行中の再生成ジョブがある（本文は `ready` のまま） | 保存する | `BusinessRuleError(NoteLockedByJob)` が投げられる | |
| 終端した変換・再生成ジョブしかない | 保存する | 成功する（実行中のジョブだけが編集を拒む） | |
| 他者が先に更新した | 古い `expectedVersion` で保存する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 保存時に除名されている | 保存する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 新しい外部参照を含み `importReferences: true` | 保存する | 参照取り込みジョブが登録され、`referenceImportJobId` が返る | |
| 外部参照がなく `importReferences: true` | 保存する | ジョブは登録されず、`referenceImportJobId: null` が返る | |
| 個人所有のノートで参照取り込みジョブが登録された | ジョブの `scope` を確認する | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る | |
| 参加ワークスペース所有のノートを他のメンバーが編集して参照取り込みジョブが登録された | ジョブの `scope` を確認する | `{ type: "workspace", workspaceId }` が入る（基準は所有者であり、`createdBy` でも編集した `userId` でもない） | |
| `reason: "wysiwygConversion"` | 保存する | 版の記録理由が `wysiwygConversion` になる | |
