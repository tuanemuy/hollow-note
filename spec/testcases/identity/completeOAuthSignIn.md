# テストケース: completeOAuthSignIn

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 有効な `state` があり、該当の紐づけも同メールの利用者も存在しない | 認可コードを交換する | `ActiveUser` と `OAuthIdentity` が作られ、セッションが発行され、`created: true` が返る | |
| 既に同じ `(provider, providerAccountId)` の紐づけがある | 認可コードを交換する | 既存の利用者でセッションが発行され、`created: false` が返る | |
| 同じメールアドレスの `ActiveUser` が存在する | 認可コードを交換する | 既存の利用者に `OAuthIdentity` が追加され、セッションが発行される | |
| 同じメールの既存利用者がIdentityを8件持つ | 新しいprovider accountで交換する | `BusinessRuleError(IdentityLimitExceeded)`となり、Identity/Sessionを追加せずreservationをreleaseする | |
| 同じメールアドレスの `PendingUser` が存在する | 認可コードを交換する | `ValidationError("EXISTING_ACCOUNT_UNVERIFIED")` が投げられ、紐づけは行われない | |
| provider accountまたはemailが`DeletingUser`へ解決される | 認可コードを交換する | `ValidationError("ACCOUNT_UNAVAILABLE")`でIdentity/Sessionを作らない | |
| 同じプロバイダーアカウントで 2 つのサインアップが同時に走る | 両方が認可コードを交換する | normalized providerAccount shardのreservationは一方だけ成立し、他方は `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` になる | |
| createNewでemail reservation後にproviderAccount reservationが失敗する | recoveryする | 親operationから別sub-operation IDを導出し、確保済みemail reservationをreleaseする | |
| User/Identity保存後に2 reservationの片方だけactivate応答を失う | recoveryする | operation payloadと正データversionを照合し、email/providerAccount両方をactiveへ収束させる | |
| プロバイダーが返すメールが未確認 | 認可コードを交換する | `ValidationError("OAUTH_EMAIL_UNVERIFIED")` が投げられる | |
| `state` が保存されていない | 認可コードを交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| `state` が既に 1 度使われている | 同じ `state` で再度交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる（束縛が一致したときに取り出しと同時に削除される） | |
| コード交換がプロバイダー側で拒否される | 認可コードを交換する | `ValidationError("OAUTH_CODE_INVALID")` が投げられる | |
| プロバイダーとの通信が失敗する | 認可コードを交換する | `SystemError(ExternalApiError)` が投げられる | |
| `redirectTo` が保存されている | 認可コードを交換する | 応答に `redirectTo` が含まれる | |
| directory の claim は残っているが対応する identity が居ない | 同じプロバイダーアカウントで認可コードを交換する | `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` が投げられ、セッションは発行されない（他人が持っている `PROVIDER_ACCOUNT_ALREADY_LINKED` とは別のコード — [ADR 038](../../adr/038-provider-account-claim-and-identity-row.md)） | |
| 有効な `state` がある | 束縛の秘密が一致しない `stateBinding` で交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられ、state 行は消費されない。続けて正しい `stateBinding` で交換すると完了できる | |
