# テストケース: linkOAuthIdentity

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| サインイン済みで Google 未連携、`intent: "linkIdentity"` の `state` がある | 認可コードを交換する | `OAuthIdentity` が追加され、`identity.added` が発行される | |
| 対象の Google アカウントが別の利用者に紐づいている | 認可コードを交換する | `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` が投げられる | |
| `intent: "signIn"` の `state` を使う | 認可コードを交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| 対象の利用者が削除済み | 認可コードを交換する | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| 同じ Google アカウントが既に自分に紐づいている | 認可コードを交換する | 既存として扱われ、重複した `Identity` は作られない | |
