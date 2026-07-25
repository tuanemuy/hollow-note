# テストケース: getInvitationPreview

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 有効な保留中の招待 | トークンで引く | ワークスペース名・説明・ロール・招待者名が返り、`state: "acceptable"` になる | |
| 期限切れの招待 | 引く | `state: "expired"` が返る | |
| 取り消し済みの招待 | 引く | `state: "revoked"` が返る | |
| 受諾済みの招待 | 引く | `state: "accepted"` が返る | |
| ワークスペースが削除済み | 引く | `state: "workspaceMissing"` が返る | |
| サインイン中で既にメンバー | 引く | `state: "alreadyMember"` が返る | |
| 未サインインで有効な招待 | 引く | `state: "acceptable"` が返る（サインインは受諾時に求める） | |
| 存在しないトークン | 引く | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる | |
