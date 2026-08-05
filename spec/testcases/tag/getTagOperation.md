# テストケース: getTagOperation

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| deleteTag operationが進行中 | 進捗を取得する | `pending`、現在の`processedCount`、`affectedCount: null`が返る | |
| operationが完了した | 取得する | `completed`と確定`affectedCount`が返り、UIが一覧を再読込できる | |
| taskがretry上限を超えた | 取得する | `failed`と表示用error codeが返る | |
| operationを処理前に中止済み | 取得する | 終端状態`aborted`が返り、同じabort要求にも同じ結果を返せる | |
| 別scopeのoperation ID | 取得する | `NotFoundError("TAG_OPERATION_NOT_FOUND")`になる | |
| workspace viewer | 取得する | `BusinessRuleError(InsufficientRole)`になる | |
