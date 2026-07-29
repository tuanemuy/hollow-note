# テストケース: completeOAuthSignIn

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 有効な `state` があり、該当の紐づけも同メールの利用者も存在しない | 認可コードを交換する | `ActiveUser` と `OAuthIdentity` が作られ、セッションが発行され、`created: true` が返る | |
| 既に同じ `(provider, providerAccountId)` の紐づけがある | 認可コードを交換する | 既存の利用者でセッションが発行され、`created: false` が返る | |
| 同じメールアドレスの `ActiveUser` が存在する | 認可コードを交換する | 既存の利用者に `OAuthIdentity` が追加され、セッションが発行される | |
| 同じメールアドレスの `PendingUser` が存在する | 認可コードを交換する | `ValidationError("EXISTING_ACCOUNT_UNVERIFIED")` が投げられ、紐づけは行われない | |
| 同じプロバイダーアカウントで 2 つのサインアップが同時に走る | 両方が認可コードを交換する | 一方が `(provider, providerAccountId)` の一意制約違反となり `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` が投げられる（既存の紐づけは手順 3 で解決されるため、このエラーは同時サインアップの競合でのみ到達する） | |
| プロバイダーが返すメールが未確認 | 認可コードを交換する | `ValidationError("OAUTH_EMAIL_UNVERIFIED")` が投げられる | |
| `state` が保存されていない | 認可コードを交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| `state` が既に 1 度使われている | 同じ `state` で再度交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる（取り出しと同時に削除される） | |
| コード交換がプロバイダー側で拒否される | 認可コードを交換する | `ValidationError("OAUTH_CODE_INVALID")` が投げられる | |
| プロバイダーとの通信が失敗する | 認可コードを交換する | `SystemError(ExternalServiceError)` が投げられる | |
| `redirectTo` が保存されている | 認可コードを交換する | 応答に `redirectTo` が含まれる | |
