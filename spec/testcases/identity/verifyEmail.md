# テストケース: verifyEmail

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 有効な確認トークンと `PendingUser` | トークンを送る | 利用者が `ActiveUser` になり、トークンが `consumed` になり、セッションが発行される | |
| 発行から 23 時間 59 分経過したトークン | トークンを送る | 確認が成功する（有効期限の境界値） | |
| 発行から 24 時間経過したトークン | トークンを送る | `BusinessRuleError(TokenExpired)` が投げられ、利用者は `PendingUser` のまま | |
| 既に消費済みのトークンで、利用者は `ActiveUser` | トークンを送る | `alreadyVerified: true` が返り、セッションは発行されない | |
| 存在しないトークン | トークンを送る | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる | |
| 用途が `password_reset` のトークン | トークンを送る | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる | |
| トークンに対応する利用者が削除済み | トークンを送る | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| 同じトークンで 2 つの要求が同時に走る | 両方が確認する | 片方が成功し、もう片方は `alreadyVerified` または `ConflictError` になる。二重にセッションが増えない | |
