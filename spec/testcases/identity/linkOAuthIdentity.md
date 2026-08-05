# テストケース: linkOAuthIdentity

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| サインイン済みで Google 未連携、`intent: "linkIdentity"` の `state` がある | 認可コードを交換する | `OAuthIdentity` が追加され、`identity.added` が発行される | |
| 対象の Google アカウントが別の利用者に紐づいている | 認可コードを交換する | `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` が投げられる | |
| `intent: "signIn"` の `state` を使う | 認可コードを交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| 対象の利用者が削除済み | 認可コードを交換する | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| flow開始後にsign-out-all/password resetで`authEpoch`が進んだ | 認可コードを交換する | flow stateの世代不一致としてIdentityを追加せず、確保済みprovider reservationをreleaseする | |
| flow開始後にaccount deletionが始まった | 認可コードを交換する | final UserId-shard UoWで`ActiveUser`検査に失敗し、Identityのlate insertを行わない | |
| Password/OAuth合計8件のIdentityがある | 9件目をリンクする | `BusinessRuleError(IdentityLimitExceeded)`。provider reservationをreleaseし、Identityを追加しない | |
| 7件の状態から2件を同時にリンクする | 両callbackを処理する | UserId shard UoW/DB triggerにより一方だけ成功し、合計8件を超えない | |
| 同じ Google アカウントが既に自分に紐づいている | 認可コードを交換する | 既存として扱われ、重複した `Identity` は作られない | |
