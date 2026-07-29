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
| 同じトークンで 2 つの要求が同時に走る | 両方が確認する | 片方が成功してセッションを受け取り、負けた側はトークンの条件付き更新が `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` になる。トランザクションを巻き戻したうえで利用者を引き直し、`active` なら `alreadyVerified: true` を返す（セッションは発行しない）。確認が二重に成立することも、失敗として見えることもない | |
| 並行消費で負けた側 | 応答を確認する | エラーにはならず `alreadyVerified: true` が返り、セッションは増えない | |
| 並行消費で負けた側 | トークンと利用者の状態を確認する | トークンは勝った側の消費のまま 1 回だけ `consumed` になり、利用者は `ActiveUser` のままである | |
