# テストケース: retryTagOperation

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| retry上限でfailed、100件処理済み | retryする | 同じoperation ID・lock・task payloadのままpendingへ戻り、残集合から再開する | |
| failed operationをretryし応答を失う | 同じ要求を再送する | 既存taskのupsertとなり、operation系列やtaskが増殖しない | |
| 100件処理済みのfailed operation | abortする | `ConflictError("TAG_OPERATION_PARTIALLY_APPLIED")`。lockを保持し、retryだけを許す | |
| 0件処理のfailed operation | abortする | taskを削除してlockを解放し、`aborted`が返る | |
| aborted operationのabort応答を失う | 同じactionを再送する | operation rowから`aborted`を返し、NOT_FOUNDや二重解放にならない | |
| running/completed operation | retryまたはabortする | `ConflictError("TAG_OPERATION_NOT_FAILED")` | |
| 別scopeのoperation ID | retryする | `NotFoundError("TAG_OPERATION_NOT_FOUND")` | |
| workspace viewer | retryする | `BusinessRuleError(InsufficientRole)` | |
