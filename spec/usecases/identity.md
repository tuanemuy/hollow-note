# ユースケース: Identity

すべてのユースケースは `ServiceArgs<TInput>` を受け取り、`container` から `clock` / `idGenerator` / `unitOfWorkProvider` などを解決する。ドメインの詳細は [domains/identity.md](../domains/identity.md)。

## 共通の約束

- 入力 DTO のフィールドは原始型。値オブジェクトの構築はユースケースの先頭かエンティティのファクトリーで行う
- 出力 DTO のフィールドも原始型。ブランド型は原始型へ自然に広がるため射影にキャストは不要
- ここに列挙したエラーは、明示のない限りアプリケーション層の `NotFoundError` / `ConflictError` / `ValidationError` / `SystemError`、またはドメインの `BusinessRuleError`

## signUpWithPassword

### 概要

メールアドレスとパスワードで新しい利用者を登録し、確認メールを送る。招待経由の場合は確認を省いてセッションを発行する。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `email` | `string` | ○ | `Email` の規則 |
| `password` | `string` | ○ | `PlainPassword` の規則 |
| `displayName` | `string` | ○ | `DisplayName` の規則 |
| `termsAccepted` | `boolean` | ○ | `true` であること |
| `invitationToken` | `string \| null` | — | 招待経由のとき |

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `userId` | `string` |
| `emailVerificationRequired` | `boolean` |
| `sessionToken` | `string \| null` |

### 処理フロー

1. `termsAccepted` が偽なら `ValidationError("TERMS_NOT_ACCEPTED")`
2. `Email.create(input.email)` と `PlainPassword.create(input.password)` を構築する
3. `invitationToken` があれば `InvitationRepository.findByTokenHash(SecureTokenGenerator.hashOf(token))` を引き、`pending` かつ期限内かつ `invitation.email` が入力のメールと一致するかを調べる。一致すれば確認済みで登録する
4. `UserRepository.existsByEmail(email)` が真なら、利用者の存在を漏らさないため新規作成せず、`MailSender.send({ kind: "existingAccountNotice" })` を送って `emailVerificationRequired: true`, `sessionToken: null` を返して終了する
5. `PasswordHasher.hash(password)` でハッシュを得る
6. 確認済みの経路なら `User.createVerified`、そうでなければ `User.create` を呼ぶ
7. `Identity.createPassword` を呼ぶ
8. `UnitOfWorkProvider.run` の中で `userRepository.insert` / `identityRepository.insert` を実行し、両者のイベントを `collectEvents` する
9. 確認済みの経路なら `Session.create` を作って `sessionRepository.insert` し、平文トークンを返す
10. そうでなければ `AuthToken.issue(purpose: "email_verification")` を作って保存し、`MailSender.send({ kind: "emailVerification" })` を送る

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 規約未同意 | `ValidationError("TERMS_NOT_ACCEPTED")` |
| メール形式・パスワード強度・表示名の違反 | `BusinessRuleError`（`InvalidEmail` / `WeakPassword` / `InvalidDisplayName`） |
| 招待トークンが無効・期限切れ・メール不一致 | 招待を無視して通常の登録として扱う（エラーにしない） |
| メールアドレスの一意制約違反（競合） | `ConflictError("EMAIL_ALREADY_USED")` |
| メール送信の失敗 | 記録して継続（登録は成功として返す） |
| レート制限 | `ValidationError("RATE_LIMITED")` |

## verifyEmail

### 概要

確認トークンを消費して利用者を確認済みにし、セッションを発行する。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `token` | `string` | ○ | 空文字列でないこと |

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `userId` | `string` |
| `sessionToken` | `string` |
| `alreadyVerified` | `boolean` |

### 処理フロー

1. `SecureTokenGenerator.hashOf(input.token)` でハッシュを求める
2. `AuthTokenRepository.findByTokenHash` で引く。存在しないか `purpose` が `email_verification` でなければ `NotFoundError("AUTH_TOKEN_NOT_FOUND")`
3. `status` が `consumed` なら、対象の利用者が既に `active` かを確認して `alreadyVerified: true` で返す（セッションは発行しない）
4. `AuthToken.consume(token, now)` を呼ぶ（期限切れは `BusinessRuleError(TokenExpired)`）
5. `UserRepository.findById` で利用者を引き、`PendingUser` なら `User.verifyEmail` を適用する
6. `UnitOfWorkProvider.run` で利用者とトークンを保存し、イベントを収集する
7. `Session.create` を作って保存し、平文トークンを返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・用途違い | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` |
| 期限切れ | `BusinessRuleError(TokenExpired)` |
| 利用者が既に削除済み | `NotFoundError("USER_NOT_FOUND")` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## resendVerificationEmail

### 概要

確認メールを再送する。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `email` | `string` | ○ | `Email` の規則 |

### 出力DTO

なし（常に成功として返す）。

### 処理フロー

1. `UserRepository.findByEmail` で引く。存在しないか既に `active` なら何もせず返す
2. 直近 60 秒以内に同じ利用者へ発行していれば何もせず返す
3. 既存の `email_verification` トークンを `AuthTokenRepository.deleteByUserAndPurpose` で消す
4. `AuthToken.issue` を作って保存し、`MailSender.send({ kind: "emailVerification" })` を送る

### エラーケース

| 条件 | 種類 |
| --- | --- |
| メール形式の違反 | `BusinessRuleError(InvalidEmail)` |
| レート制限 | 何もせず成功として返す（存在の推測を防ぐ） |

## signInWithPassword

### 概要

メールアドレスとパスワードで認証してセッションを発行する。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `email` | `string` | ○ | `Email` の規則 |
| `password` | `string` | ○ | 空文字列でないこと |
| `clientKey` | `string` | ○ | 発信元を表す文字列（レート制限の鍵） |

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `userId` | `string` |
| `sessionToken` | `string` |

### 処理フロー

1. `LoginAttemptStore.get` と `LoginThrottlePolicy.evaluate` で待機・ロックを判定する
2. `UserRepository.findByEmail` で引く
3. 利用者がいない、`IdentityPolicy.findPassword` が `null`、または `PasswordHasher.verify` が偽のいずれかなら、失敗を記録して `ValidationError("INVALID_CREDENTIALS")`
4. 利用者が `PendingUser` なら `ValidationError("EMAIL_NOT_VERIFIED")`
5. `LoginThrottlePolicy.reset` で失敗回数を消す
6. `Session.create` を作って保存し、平文トークンを返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 認証失敗（利用者不在・手段なし・パスワード相違） | `ValidationError("INVALID_CREDENTIALS")`（原因を区別しない） |
| メール未確認 | `ValidationError("EMAIL_NOT_VERIFIED")` |
| 待機中 | `ValidationError("LOGIN_THROTTLED")`（待機秒数を添える） |
| ロック中 | `ValidationError("LOGIN_LOCKED")`（解除時刻を添える） |

## startOAuthFlow

### 概要

サインイン用の OAuth 認可 URL を生成し、`state` と `codeVerifier` を保存する。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `provider` | `string` | ○ | `OAuthProvider` の規則 |
| `intent` | `"signIn" \| "linkIdentity"` | ○ | 既知の値 |
| `redirectTo` | `string \| null` | — | 同一オリジンの相対パスのみ |
| `userId` | `string \| null` | — | `intent === "linkIdentity"` のとき必須 |

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `authorizationUrl` | `string` |

### 処理フロー

1. `OAuthProvider.create(input.provider)` を構築する
2. `intent === "linkIdentity"` で `userId` が `null` なら `ValidationError("USER_REQUIRED")`
3. `state` と `codeVerifier` を `SecureTokenGenerator.issue` で作り、`codeChallenge` を算出する
4. `OAuthStateStore.put(state, flowState, 10 分)` で保存する
5. `SignInOAuthClient.buildAuthorizationUrl` の結果を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未知のプロバイダー | `BusinessRuleError(InvalidProvider)` |
| `redirectTo` が外部 URL | `ValidationError("INVALID_REDIRECT")` |

## completeOAuthSignIn

### 概要

認可コードを交換し、利用者を作成または既存利用者へ紐づけてセッションを発行する。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `state` | `string` | ○ | 空文字列でないこと |
| `code` | `string` | ○ | 空文字列でないこと |

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `userId` | `string` |
| `sessionToken` | `string` |
| `redirectTo` | `string \| null` |
| `created` | `boolean` |

### 処理フロー

1. `OAuthStateStore.take(state)` で取り出す。`null` なら `ValidationError("OAUTH_STATE_INVALID")`
2. `SignInOAuthClient.exchangeCode` でプロフィールを得る
3. `IdentityRepository.findByProviderAccount` で既存の紐づけを探す。あればその利用者でセッションを発行して終了する
4. `UserRepository.findByEmail(profile.email)` を引き、`AccountLinkingPolicy.decide` で判定する
5. `createNew` → `User.createVerified` と `Identity.createOAuth` を作って保存する
6. `linkToExisting` → `Identity.createOAuth` のみを作って保存する
7. `refuse` → 理由に応じた `ValidationError` を返す
8. `Session.create` を作って保存し、平文トークンと `redirectTo` を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `state` の不一致・期限切れ | `ValidationError("OAUTH_STATE_INVALID")` |
| コード交換の失敗 | `ValidationError("OAUTH_CODE_INVALID")` / `SystemError(ExternalServiceError)` |
| プロバイダー側のメール未確認 | `ValidationError("OAUTH_EMAIL_UNVERIFIED")` |
| 既存利用者がメール未確認 | `ValidationError("EXISTING_ACCOUNT_UNVERIFIED")` |
| 紐づけ先が別の利用者 | `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` |

## linkOAuthIdentity

### 概要

サインイン済みの利用者に OAuth の認証手段を追加する。

### 入力DTO

`state` / `code`。`OAuthFlowState.intent` が `linkIdentity` であること。

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `identityId` | `string` |

### 処理フロー

1. `OAuthStateStore.take` で取り出し、`intent` が `linkIdentity` でなければ `ValidationError("OAUTH_STATE_INVALID")`
2. `SignInOAuthClient.exchangeCode` でプロフィールを得る
3. `IdentityRepository.findByProviderAccount` に既存があり、`userId` が異なれば `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`
4. `Identity.createOAuth` を作って保存する

### エラーケース

`completeOAuthSignIn` と同じ分類に加え、`NotFoundError("USER_NOT_FOUND")`。

## authenticateSession

### 概要

セッショントークンから利用者を解決する。すべての保護された操作の前段で呼ばれる。

### 入力DTO

| フィールド | 型 | 必須 |
| --- | --- | --- |
| `sessionToken` | `string` | ○ |

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `userId` | `string` |
| `displayName` | `string` |
| `handle` | `string \| null` |
| `avatarUrl` | `string \| null` |

### 処理フロー

1. `SecureTokenGenerator.hashOf(token)` で引く
2. `SessionRepository.findByTokenHash` が `null` なら `ValidationError("UNAUTHENTICATED")`
3. `Session.isExpired` が真なら削除して `ValidationError("UNAUTHENTICATED")`
4. `UserRepository.findById` で利用者を引く。不在なら `ValidationError("UNAUTHENTICATED")`
5. `Session.touch` の結果を保存する（`lastUsedAt` の更新が 5 分以上前のときのみ書き込む）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・期限切れ・利用者不在 | `ValidationError("UNAUTHENTICATED")`（区別しない） |

## signOut

### 概要

現在のセッションを破棄する。

### 入力DTO

`sessionToken: string`

### 出力DTO

なし。

### 処理フロー

1. ハッシュで引き、あれば `SessionRepository.deleteById` する
2. 見つからなくてもエラーにしない

### エラーケース

なし（常に成功）。

## signOutOtherSessions

### 概要

現在のセッション以外をすべて破棄する。

### 入力DTO

`userId: string`, `currentSessionToken: string`

### 出力DTO

`revokedCount: number`

### 処理フロー

1. 現在のセッションを引いて `SessionId` を得る
2. `SessionRepository.deleteByUserId(userId, excluding)` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 現在のセッションが無効 | `ValidationError("UNAUTHENTICATED")` |

## requestPasswordReset

### 概要

パスワード再設定用のトークンを発行してメールを送る。

### 入力DTO

`email: string`

### 出力DTO

なし（常に同じ結果を返す）。

### 処理フロー

1. `UserRepository.findByEmail` で引く。不在なら何もせず返す
2. `IdentityPolicy.findPassword` が `null` なら `MailSender.send({ kind: "passwordResetUnavailable" })` を送って返す
3. 既存の `password_reset` トークンを消す
4. `AuthToken.issue(purpose: "password_reset")` を作って保存し、`MailSender.send({ kind: "passwordReset" })` を送る

### エラーケース

| 条件 | 種類 |
| --- | --- |
| メール形式の違反 | `BusinessRuleError(InvalidEmail)` |
| レート制限 | 何もせず成功として返す |

## resetPassword

### 概要

再設定トークンを消費してパスワードを差し替え、全セッションを破棄する。

### 入力DTO

`token: string`, `newPassword: string`

### 出力DTO

`userId: string`

### 処理フロー

1. トークンをハッシュで引き、用途と状態を検査する
2. `AuthToken.consume` を呼ぶ
3. `PlainPassword.create(newPassword)` と `PasswordHasher.hash` を実行する
4. `IdentityPolicy.findPassword` で対象の認証手段を得る。存在しなければ `Identity.createPassword` を作る
5. `Identity.changePassword` の結果とトークンを `UnitOfWorkProvider.run` で保存する
6. `SessionRepository.deleteByUserId(userId, null)` で全セッションを破棄する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・用途違い・消費済み | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` |
| 期限切れ | `BusinessRuleError(TokenExpired)` |
| パスワード強度の違反 | `BusinessRuleError(WeakPassword)` |

## addPasswordIdentity

### 概要

パスワード認証手段を持たない利用者に追加する。

### 入力DTO

`userId: string`, `newPassword: string`

### 出力DTO

`identityId: string`

### 処理フロー

1. `IdentityRepository.listByUserId` を引き、`IdentityPolicy.ensurePasswordAddable` を呼ぶ
2. `PlainPassword.create` と `PasswordHasher.hash` を実行する
3. `Identity.createPassword` を作って保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 既にパスワード手段がある | `BusinessRuleError(PasswordIdentityAlreadyExists)` |
| パスワード強度の違反 | `BusinessRuleError(WeakPassword)` |

## changePassword

### 概要

現在のパスワードを確認して差し替え、他のセッションを破棄する。

### 入力DTO

`userId: string`, `currentPassword: string`, `newPassword: string`, `currentSessionToken: string`

### 出力DTO

なし。

### 処理フロー

1. `IdentityPolicy.findPassword` で認証手段を得る。なければ `NotFoundError("PASSWORD_IDENTITY_NOT_FOUND")`
2. `PasswordHasher.verify(currentPassword, hash)` が偽なら `ValidationError("INVALID_CREDENTIALS")`
3. `PlainPassword.create(newPassword)` と `PasswordHasher.hash` を実行する
4. `Identity.changePassword` を保存する
5. `SessionRepository.deleteByUserId(userId, currentSessionId)` を呼ぶ

### エラーケース

上記に加え `BusinessRuleError(WeakPassword)`、`ConflictError("OPTIMISTIC_LOCK_FAILURE")`。

## removeIdentity

### 概要

認証手段を 1 件削除する。

### 入力DTO

`userId: string`, `identityId: string`

### 出力DTO

なし。

### 処理フロー

1. `IdentityRepository.listByUserId` を引き、対象が利用者のものであることを確認する
2. `IdentityPolicy.ensureRemovable(identities, identityId)` を呼ぶ
3. `UnitOfWorkProvider.run` で `identityRepository.delete` し、`IdentityEvents.identityRemoved` を収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象が不在・他人のもの | `NotFoundError("IDENTITY_NOT_FOUND")` |
| 最後の 1 件 | `BusinessRuleError(LastIdentityCannotBeRemoved)` |

## listIdentities

### 概要

利用者の認証手段を一覧する。

### 入力DTO

`userId: string`

### 出力DTO

`identities: { id: string; kind: "password" \| "oauth"; provider: string \| null; accountLabel: string \| null; createdAt: Date }[]`, `removable: boolean`

### 処理フロー

1. `IdentityRepository.listByUserId` を引く
2. 件数が 2 件以上なら `removable: true` として射影する

### エラーケース

`SystemError(DatabaseError)`

## updateProfile

### 概要

表示名・自己紹介・アイコン・公開ハンドルを更新する。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `displayName` | `string \| null` | — | `DisplayName` の規則 |
| `bio` | `string \| null` | — | `Bio` の規則 |
| `avatarUrl` | `string \| null` | — | 同一オリジンの URL |
| `handle` | `string \| null` | — | `Handle` の規則。空文字列は解除を意味する |

### 出力DTO

利用者の射影（`userId`, `displayName`, `bio`, `avatarUrl`, `handle`）。

### 処理フロー

1. `UserRepository.findById` で引く。`PendingUser` なら `ValidationError("EMAIL_NOT_VERIFIED")`
2. `handle` が指定されていれば `UserRepository.existsByHandle(handle, userId)` を調べ、真なら `ConflictError("HANDLE_ALREADY_USED")`
3. `User.updateProfile` を適用し、`handle` の指定があれば `User.assignHandle` または `User.clearHandle` を続けて適用する
4. `UnitOfWorkProvider.run` で保存し、イベントを収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ハンドルの形式違反・予約語 | `BusinessRuleError(InvalidHandle)` / `BusinessRuleError(HandleReserved)` |
| ハンドルの重複 | `ConflictError("HANDLE_ALREADY_USED")` |
| 表示名・自己紹介の違反 | `BusinessRuleError` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## getPublicProfile

### 概要

公開ページ用に、ハンドルから利用者の公開情報を引く。

### 入力DTO

`handle: string`

### 出力DTO

`userId`, `handle`, `displayName`, `bio`, `avatarUrl`

### 処理フロー

1. `Handle.create(input.handle)` を構築する（形式違反は不在として扱う）
2. `UserRepository.findByHandle` で引く。`null` または `PendingUser` なら `NotFoundError("USER_NOT_FOUND")`

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 形式違反・不在・未確認 | `NotFoundError("USER_NOT_FOUND")`（区別しない） |

## listPublicProfiles

### 概要

サイトマップ用に、公開ハンドルを持つ利用者を列挙する（DS-06）。

### 入力DTO

`cursor: string | null`, `limit: number`

### 出力DTO

`entries: { handle: string; updatedAt: Date }[]`, `nextCursor: string | null`

### 処理フロー

1. `NoteQueryService.listPublicAuthors(cursor, limit)` を引く。読み取りモデルの `author_handle` が非 NULL で、公開かつ有効なノートを 1 件以上持つ利用者だけが返る

### エラーケース

`SystemError(DatabaseError)`

## deleteAccount

### 概要

アカウントと関連データを削除する。

### 入力DTO

`userId: string`, `confirmationEmail: string`

### 出力DTO

なし。

### 処理フロー

1. `UserRepository.findById` で引き、`confirmationEmail` が一致しなければ `ValidationError("CONFIRMATION_MISMATCH")`
2. `MembershipRepository.listByUser` を引き、`owner` として属するワークスペースそれぞれについて `MembershipRepository.countByRole(workspaceId, "owner")` を調べる。1 なら `BusinessRuleError(LastOwnerCannotLeave)` として中止する
3. `JobRepository.listActiveByRequester` を引き、すべて `Job.cancel` する
4. `UnitOfWorkProvider.run` で利用者を削除し、`IdentityEvents.userDeleted` を収集する
5. 関連データ（認証手段、セッション、トークン、ノート、ファイル、タグ、連携、クォータ、ジョブ）は `identity.user.deleted` を購読するワーカーが削除する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 確認入力の不一致 | `ValidationError("CONFIRMATION_MISMATCH")` |
| 唯一の owner であるワークスペースがある | `BusinessRuleError(LastOwnerCannotLeave)` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |
