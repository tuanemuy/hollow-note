# テストケース: authenticateSession

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 有効なセッションがある | トークンで認証する | 利用者の射影が返る | |
| `lastUsedAt` が 6 分前のセッション | トークンで認証する | `lastUsedAt` が更新される | |
| `lastUsedAt` が 1 分前のセッション | トークンで認証する | `lastUsedAt` は更新されない（書き込みを抑える） | |
| 期限切れのセッション | トークンで認証する | `ValidationError("UNAUTHENTICATED")` が投げられ、セッションが削除される | |
| 存在しないトークン | トークンで認証する | `ValidationError("UNAUTHENTICATED")` が投げられる | |
| セッションはあるが利用者が削除済み | トークンで認証する | `ValidationError("UNAUTHENTICATED")` が投げられる | |
| 期限のちょうど 1 ミリ秒前 | トークンで認証する | 認証が成功する（境界値） | |
