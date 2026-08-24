# テストケース: removeIdentity

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| パスワードと Google の 2 件を持つ利用者 | Google を解除する | `Identity` が削除され、`identity.identity.removed` が発行される | |
| 認証手段が 1 件だけの利用者 | その 1 件を解除する | `BusinessRuleError(LastIdentityCannotBeRemoved)` が投げられ、削除されない | |
| 他の利用者の認証手段を指定する | 解除する | `NotFoundError("IDENTITY_NOT_FOUND")` が投げられる | |
| 存在しない ID を指定する | 解除する | `NotFoundError("IDENTITY_NOT_FOUND")` が投げられる | |
| Google Drive 連携がある利用者 | Google の認証手段を解除する | Drive 連携は残る | |
| Google Identityを解除する | provider directoryを確認する | Identity削除後にproviderAccount reservationがreleaseされ、別の利用者が同じGoogle accountをリンクできる | |
| Identity削除commit後に応答を失う | 同じ解除を再送する | local receiptから削除済み成功を返し、outbox consumerが固定済みprovider keyを同じoperation IDでreleaseする | |
| 2 件のうち 2 件を同時に解除しようとする | 並行して実行する | 少なくとも 1 件は `BusinessRuleError(LastIdentityCannotBeRemoved)` になり、0 件にはならない | |
| 解放判定 UoW が commit した直後に、先行配送の解放と本人の再連携が割り込む | removal event を配送する | 判定より前に観測した claim は既に張り替わっているので取り壊しは no-op になり、`resolve("providerAccount", key)` は本人を返し続け、再連携された identity 行も残る | |
| `beginRelease` 済み・`release` 前で解放が中断した | 同じ removal event を再配送する | 観測が null でも `release(operationId)` が走って `releasing` 行が回収され、別の利用者がその鍵を `reserve` できる | |
| 解放が完了したあと、別の利用者が同じ provider account を連携している | 同じ removal event を再配送する | 所有者が一致しない claim は観測が null になるため取り壊しは走らず、claim は `active` のままその利用者が持ち続け、連携した identity 行も残る | |
