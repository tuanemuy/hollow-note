# テストケース: revokeInvitation

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で保留中の招待がある | 取り消す | `status: "revoked"` になり、`invitation.revoked` が発行される | |
| 取り消し後 | その招待リンクを開く | 取り消し済みとして扱われる | |
| 受諾済みの招待 | 取り消す | `ValidationError("INVITATION_NOT_PENDING")` が投げられる | |
| 存在しない招待 ID | 取り消す | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる | |
| editor である | 取り消す | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 取り消し後 | 同じメールアドレスに再度招待する | 新しい招待が作られる | |
| local revoke後にglobal応答を失う | recoveryする | local正データは即時にacceptを拒否し、同じoperation IDでrouteをrevokedへ収束させる | |
