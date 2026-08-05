# テストケース: resetPassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 有効な再設定トークンとパスワード認証手段がある | 新しいパスワードで実行する | ハッシュとUserの`authEpoch`が更新され、トークンが `consumed` になり、全sessionは物理削除前から無効になる | |
| 発行から 59 分経過したトークン | 実行する | 成功する（有効期限の境界値） | |
| 発行から 1 時間経過したトークン | 実行する | `BusinessRuleError(TokenExpired)` が投げられる | |
| 消費済みのトークン | 実行する | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる | |
| 発行後にUserの`authEpoch`が進んだトークン | 実行する | 旧世代として`NotFoundError("AUTH_TOKEN_NOT_FOUND")`になり、パスワードを変更しない | |
| tokenの利用者が`deleting`へ遷移済み | 実行する | `NotFoundError("AUTH_TOKEN_NOT_FOUND")`でUserをactiveへ戻さず、削除を継続する | |
| 用途が `email_verification` のトークン | 実行する | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる | |
| 有効なトークンがあるがパスワード認証手段を持たない | 実行する | `PasswordIdentity` が新規に作られ、パスワードが設定される | |
| — | 強度要件を満たさないパスワードで実行する | `BusinessRuleError(WeakPassword)` が投げられ、トークンは消費されない | |
| 実行前に別の端末でサインイン中 | 実行する | その端末のセッションが無効になる | |
| セッションが10,000件ある | 実行する | Userの世代更新で即時失効し、行は100件ずつ継続回収する | |
| 同じトークンで 2 つの要求が同時に走る | 両方が実行する | 片方が成功し、負けた側はトークンの保存が `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` になるため、パスワードの差し替えごと巻き戻して `NotFoundError("AUTH_TOKEN_NOT_FOUND")` を返す | |
| 並行消費で負けた側 | パスワードを確認する | 先に成立した再設定のパスワードが残り、後から上書きされない（`verifyEmail` と違って成功に落とさないのは、勝った側と負けた側で設定されるパスワードが異なるため） | |
