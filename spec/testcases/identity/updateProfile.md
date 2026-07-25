# テストケース: updateProfile

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `ActiveUser` がいる | 表示名と自己紹介を更新する | 値が更新され、公開ページの表示に反映される | |
| ハンドル未設定の `ActiveUser` | 未使用のハンドルを設定する | ハンドルが設定され、`user.handleChanged` が発行される | |
| 他の利用者が使用中のハンドル | そのハンドルを設定する | `ConflictError("HANDLE_ALREADY_USED")` が投げられる | |
| — | 2 文字のハンドルを設定する | `BusinessRuleError(InvalidHandle)` が投げられる | |
| — | 3 文字のハンドルを設定する | 成功する（長さの境界値） | |
| — | 30 文字のハンドルを設定する | 成功する（長さの境界値） | |
| — | 31 文字のハンドルを設定する | `BusinessRuleError(InvalidHandle)` が投げられる | |
| — | 予約語（`settings`）をハンドルに設定する | `BusinessRuleError(HandleReserved)` が投げられる | |
| — | 大文字を含むハンドルを設定する | 小文字に正規化されて保存される | |
| ハンドル設定済み | ハンドルを空文字列にする | ハンドルが解除され、`user.handleChanged` が発行される | |
| ハンドル設定済みで公開ノートがある | ハンドルを変更する | 旧ハンドルの URL は「見つかりません」になり、新しい URL で到達できる | |
| `PendingUser` | 更新する | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられる | |
| — | 51 文字の表示名にする | `BusinessRuleError(InvalidDisplayName)` が投げられる | |
| — | 501 文字の自己紹介にする | `BusinessRuleError(InvalidBio)` が投げられる | |
| 同時に別の要求が同じ利用者を更新した | 更新する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
