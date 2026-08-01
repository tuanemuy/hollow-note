# ユースケース: Identity

すべてのユースケースは `ServiceArgs<TInput>` を受け取り、`container` から `clock` / `idGenerator` / `unitOfWorkProvider` などを解決する。ドメインの詳細は [domains/identity.md](../domains/identity.md)。

## 共通の約束

- 入力 DTO のフィールドは原始型。値オブジェクトの構築はユースケースの先頭かエンティティのファクトリーで行う
- 出力 DTO のフィールドも原始型。ブランド型は原始型へ自然に広がるため射影にキャストは不要
- ここに列挙したエラーは、明示のない限りアプリケーション層の `NotFoundError` / `ConflictError` / `ValidationError` / `SystemError`、またはドメインの `BusinessRuleError`
- 一覧系ユースケースのページングは全ドメイン共通の規約に従う。`limit` は 1〜100、`cursor` は直前の応答が返した値のみ。範囲外・不正な値は `ValidationError("INVALID_PAGINATION")`（各ユースケースのエラー表では省略することがある）

### UoW の合成と、ユースケースどうしの呼び出し

同一 UoW でどこまでを束ねるかの基準は [ADR 008](../adr/008-domain-boundaries.md) の「ドメインをまたぐ整合性の取り方」に従う。束ねると決めたものをどう組み立てるかは次の規約による。

- `UnitOfWorkProvider.run` は**入れ子にしない**。1 回の要求で開く UoW は最も外側の 1 つだけとする
- 複数の呼び出し元が同一トランザクションの中で使い回す書き込みは、ユースケースではなく**共有手順**として定義する。共有手順は UoW のコンテキストを引数に取り、自分では `run` を開かない。呼び出し元は自分の UoW の中でそれを実行する。現行の spec が持つ共有手順は次の 2 つで、どちらも同じ規約に従う
  - **保管ファイルの削除手順**（[usecases/storage.md](./storage.md) の「共有手順: 保管ファイルの削除」）。`deleteFiles` ユースケース自身は「UoW を開いてこの手順を実行するだけ」の薄い入口になる
  - **強制終端の後始末**（[usecases/job.md](./job.md) の「共通: 強制終端の後始末」の `finalizeTerminatedJobs`）。ジョブを終端させた 9 経路とリース失効の自動回収が使い回す。この手順は自分の中で前者を実行する（共有手順が共有手順を呼ぶ形になるが、どちらも `run` を開かないため入れ子は生じない）
  - 各経路の記述にある「`deleteFiles` で回収する（同一 UoW）」は、`deleteFiles` ユースケースの呼び出しではなく手順の実行を指す
- ユースケースが**他のユースケースを呼ぶ**場合（`runBulkNoteOperationItem` → `trashNote` / `purgeNote` など）、呼ばれた側は自分の UoW を開いて独立に確定する。`expectedVersion` を要求するユースケースには**呼び出し側が版を渡す**（この入力は転送境界から来たものに限らない）。対象の版を持たない呼び出し元は、呼ぶ直前に自分で対象を引いてそのときの版を渡す（`runBulkNoteOperationItem` は手順 2 で引いたノートの版を使う）。競合したときの扱い（1 度だけ読み直して再適用するか、失敗として記録するか）は呼び出し側が決める
- 呼ばれた側の保存とイベントの収集はその UoW で確定するため、そのあと呼び出し側が失敗しても巻き戻らない。ユースケースどうしの呼び出しを採ってよいのは「呼ばれた側だけが確定していても矛盾しない」場合に限り、そうでなければ共有手順に切り出して 1 つの UoW にまとめる
- 書き込みを持たないユースケース（`planConversionForUpload` のような判定だけのもの）はこの規約の対象外で、どこから呼んでも UoW に影響しない

## signUpWithPassword

### 概要

メールアドレスとパスワードで新しい利用者を登録し、確認メールを送る（AC-01）。招待経由の場合は確認を省いてセッションを発行する（WS-04）。

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
9. 確認済みの経路なら `Session.create` を作って `sessionRepository.insert` し、平文トークンを返す。有効期間は `Session.ttlMs`（30 日の絶対期限）をドメインが与え、呼び出し側は渡さない（[domains/identity.md](../domains/identity.md)）。`Session.create` を呼ぶ 4 つのユースケース（本ユースケース / `verifyEmail` / `signInWithPassword` / `completeOAuthSignIn`）はすべてこの形である
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

確認トークンを消費して利用者を確認済みにし、セッションを発行する（AC-02）。

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
6. `UnitOfWorkProvider.run` で利用者とトークンを保存し、イベントを収集する。トークンの保存は `status = 'pending'` の行への条件付き更新であり（[domains/identity.md](../domains/identity.md) の `AuthTokenRepository`）、並行する要求が先に消費していれば `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` になる。この場合はトランザクションを巻き戻したうえで手順 3 と同じ扱いに落とし、利用者を引き直して `active` なら `alreadyVerified: true` を返す（セッションは発行しない）。同じトークンによる同時アクセスで確認が二重に成立することも、失敗として見えることもない
7. `Session.create` を作って保存し、平文トークンを返す（有効期間は `Session.ttlMs`）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・用途違い | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` |
| 期限切れ | `BusinessRuleError(TokenExpired)` |
| 利用者が既に削除済み | `NotFoundError("USER_NOT_FOUND")` |
| 並行する要求が先にトークンを消費した（`ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")`） | エラーにせず `alreadyVerified: true` で返す（手順 6） |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## resendVerificationEmail

### 概要

確認メールを再送する（AC-02 / AC-04）。

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

メールアドレスとパスワードで認証してセッションを発行する（AC-04）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `email` | `string` | ○ | `Email` の規則 |
| `password` | `string` | ○ | 空文字列でないこと |
| `clientKey` | `string` | ○ | 発信元を表す文字列（レート制限の鍵の材料） |

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `userId` | `string` |
| `sessionToken` | `string` |

### 処理フロー

1. `Email.create(input.email)` を構築し、`LoginAttemptKey.forSignIn(email, input.clientKey)` で鍵を組み立てる（[domains/identity.md](../domains/identity.md)）
2. `LoginAttemptStore.get(key)` を引き（`null` なら `LoginThrottlePolicy.initial(key)`）、`LoginThrottlePolicy.evaluate` で待機・ロックを判定する。`delay` / `locked` なら以降の照合を行わずに `ValidationError("THROTTLED")` / `ValidationError("LOCKED")`
3. `UserRepository.findByEmail` で引く
4. 利用者がいない、`IdentityPolicy.findPassword` が `null`、または `PasswordHasher.verify` が偽のいずれかなら、`LoginAttemptStore.put(LoginThrottlePolicy.recordFailure(attempt, now), LoginThrottlePolicy.attemptTtlMs)` で失敗を記録し、`ValidationError("INVALID_CREDENTIALS")`
5. 利用者が `PendingUser` なら `ValidationError("EMAIL_NOT_VERIFIED")`（失敗として記録しない。資格情報は正しく、再送すれば通る状態のため）
6. `LoginAttemptStore.clear(key)` で失敗の記録を消す
7. `Session.create` を作って保存し、平文トークンを返す（有効期間は `Session.ttlMs`）

`login_attempts` への書き込みはこのユースケースと `verifySharePassword`（[usecases/note.md](./note.md)）の 2 か所だけで、どちらも同じ順序（`get` → `evaluate` → 失敗なら `put` / 成功なら `clear`）に従う。Unit of Work には入れない — 記録は集約の不変条件に関与せず、認証が失敗して例外を投げる経路でも書き込みが残らなければレート制限が機能しないため。書き込みの失敗は記録して継続し、認証の結果そのものは変えない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 認証失敗（利用者不在・手段なし・パスワード相違） | `ValidationError("INVALID_CREDENTIALS")`（原因を区別しない） |
| メール未確認 | `ValidationError("EMAIL_NOT_VERIFIED")` |
| 待機中 | `ValidationError("THROTTLED")`（待機秒数を添える） |
| ロック中 | `ValidationError("LOCKED")`（解除時刻を添える） |

## startOAuthFlow

### 概要

サインイン用の OAuth 認可 URL を生成し、`state` と `codeVerifier` を保存する（AC-03 / AC-06）。

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

認可コードを交換し、利用者を作成または既存利用者へ紐づけてセッションを発行する（AC-03）。

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
8. `Session.create` を作って保存し、平文トークンと `redirectTo` を返す（有効期間は `Session.ttlMs`）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `state` の不一致・期限切れ | `ValidationError("OAUTH_STATE_INVALID")` |
| コード交換の失敗 | `ValidationError("OAUTH_CODE_INVALID")` / `SystemError(ExternalServiceError)` |
| プロバイダー側のメール未確認 | `ValidationError("OAUTH_EMAIL_UNVERIFIED")` |
| 既存利用者がメール未確認 | `ValidationError("EXISTING_ACCOUNT_UNVERIFIED")` |
| 紐づけ先が別の利用者 | `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`（同時サインアップの競合で `(provider, providerAccountId)` の一意制約違反が起きたときのみ到達する。既存の紐づけは手順 3 で先に解決される） |

## linkOAuthIdentity

### 概要

サインイン済みの利用者に OAuth の認証手段を追加する（AC-06）。

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

セッショントークンから利用者を解決する（AC-04 / AC-08）。すべての保護された操作の前段で呼ばれる。

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

**このユースケースはセッションを書き換えない**。`Session` は絶対期限で最終使用時刻を持たないため（[domains/identity.md](../domains/identity.md)）、認証は純粋な読み取りである。すべての保護された操作の前段で呼ばれる経路に書き込みを置かない、という性質はここから来る。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・期限切れ・利用者不在 | `ValidationError("UNAUTHENTICATED")`（区別しない） |

## signOut

### 概要

現在のセッションを破棄する（AC-08）。

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

現在のセッション以外をすべて破棄する（AC-08）。

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

パスワード再設定用のトークンを発行してメールを送る（AC-05）。

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

再設定トークンを消費してパスワードを差し替え、全セッションを破棄する（AC-05）。

### 入力DTO

`token: string`, `newPassword: string`

### 出力DTO

`userId: string`

### 処理フロー

1. トークンをハッシュで引き、用途と状態を検査する
2. `AuthToken.consume` を呼ぶ
3. `PlainPassword.create(newPassword)` と `PasswordHasher.hash` を実行する
4. `IdentityPolicy.findPassword` で対象の認証手段を得る。存在しなければ `Identity.createPassword` を作る
5. `Identity.changePassword` の結果とトークンを `UnitOfWorkProvider.run` で保存する。トークンの保存が `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` になった場合（並行する要求が先に消費した）は、パスワードの差し替えごと巻き戻して `NotFoundError("AUTH_TOKEN_NOT_FOUND")` を返す。手順 1 の「消費済み」と同じ扱いで、先に成立した再設定を後から上書きしない。`verifyEmail` と違って成功に落とさないのは、勝った側と負けた側で設定されるパスワードが異なるため
6. `SessionRepository.deleteByUserId(userId, null)` で全セッションを破棄する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・用途違い・消費済み | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` |
| 並行する要求が先にトークンを消費した（`ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")`） | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` に落として返す（手順 5） |
| 期限切れ | `BusinessRuleError(TokenExpired)` |
| パスワード強度の違反 | `BusinessRuleError(WeakPassword)` |

## addPasswordIdentity

### 概要

パスワード認証手段を持たない利用者に追加する（AC-06）。

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

現在のパスワードを確認して差し替え、他のセッションを破棄する（AC-06）。

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

認証手段を 1 件削除する（AC-06）。

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

利用者の認証手段を一覧する（AC-06）。

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

表示名・自己紹介・アイコン・公開ハンドルを更新する（AC-07）。

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
4. `UnitOfWorkProvider.run` で保存し、イベントを収集する。`displayName` が変わったときは `User.updateProfile` が `identity.user.profileUpdated` を発行し、読み取りモデルの著者表示名の投影（`projectNoteChanges`）が購読する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ハンドルの形式違反・予約語 | `BusinessRuleError(InvalidHandle)` / `BusinessRuleError(HandleReserved)` |
| ハンドルの重複 | `ConflictError("HANDLE_ALREADY_USED")` |
| 表示名・自己紹介の違反 | `BusinessRuleError` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## getPublicProfile

### 概要

公開ページ用に、ハンドルから利用者の公開情報を引く（DS-01 / DS-04）。

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

1. `NoteQueryService.listPublicAuthors(cursor, limit)` を引く。**個人所有**（`owner_type = "user"`）で公開かつ有効なノートを 1 件以上持つ利用者について、`{ userId, updatedAt }`（`updatedAt` はその利用者の個人所有の公開ノートの最新更新時刻）が `userId` の昇順で返る
2. `UserRepository.listByIds` でハンドルを解決し、`handle` が未設定の利用者は落とす（`/@:handle` を持たないため）。読み取りモデルは所有者のハンドルを列に持たないので、解決はここで行う
3. `nextCursor` は最後に読んだ `userId`

母集合は所有者基準に統一する。`/@:handle` の一覧は `searchPublicNotes` が `ownerFilter: { type: "user", userId }` で引く所有者基準の集合であり、サイトマップに載せる利用者の集合はそれと一致しなければならない。著者基準（`created_by` / `author_handle`）で列挙すると、ワークスペース所有の公開ノートしか作っていない利用者がサイトマップに現れる一方その `/@:handle` は 0 件になり、空の公開ページを量産する。逆に、ワークスペースから個人へ移したノート（作成者は別人のまま）を持つ利用者は所有者基準でのみ拾える。

### エラーケース

`SystemError(DatabaseError)`

## deleteAccount

### 概要

アカウントと関連データを削除する（AC-09）。

### 入力DTO

`userId: string`, `confirmationEmail: string`

### 出力DTO

なし。

### 処理フロー

1. `UserRepository.findById` で引き、`confirmationEmail` が一致しなければ `ValidationError("CONFIRMATION_MISMATCH")`
2. `MembershipRepository.listByUser` を引き、`owner` として属するワークスペースそれぞれについて `MembershipRepository.countByRole(workspaceId, "owner")` を調べる。1 なら `BusinessRuleError(LastOwnerCannotLeave)` として中止する
3. 取り消す対象の実行中ジョブを集める。`JobRepository.listActiveByRequester(userId)`（この利用者が要求したジョブ。ワークスペース所有ノートを対象とするものを含む）と `JobRepository.listActiveByScope({ type: "user", userId })`（この利用者の個人所有ノートを対象とするジョブ。要求者が `null` の匿名 PDF 書き出しはこちらでしか拾えない。[ADR 010](../adr/010-anonymous-export-and-ticket.md)）の両方を引き、`jobId` で重複を除く
4. `UnitOfWorkProvider.run` の中で、3 で集めたジョブに `Job.cancel` を適用して保存し、利用者を削除して `IdentityEvents.userDeleted` を収集する。**これらの保存はすべて同一 UoW で行う** — 利用者だけが消えてジョブが走り続ける中間状態を作らないため。`Job.cancel` はリースを検査しないので、実行中のワーカーの生存を待つ必要はない（[domains/job.md](../domains/job.md) の「強制終端とリース」）。併せて [usecases/job.md](./job.md) の「共通: 強制終端の後始末」に従う（`kind: "conversion"` の対象ノートが `processing` なら `Note.markConversionFailed("canceled")`、生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を「保管ファイルの削除手順」（[usecases/storage.md](./storage.md) の `deleteFiles`）で回収。いずれもこの UoW の中で行う）。個人所有ノートは手順 5 の購読者がまとめて消すため回復は結果的に無意味だが、退会後も残るワークスペース所有ノート（AC-09）にはこの回復が要る
5. 認証手段・セッション・トークンは同一ドメインの FK CASCADE で消える。残りの関連データは `identity.user.deleted` を購読する各ドメインの掃除ユースケースが削除する。購読関係は次のとおり（本体の定義は各ドメインのユースケース文書が持つ）

| ドメイン | 購読ユースケース | 責務 |
| --- | --- | --- |
| Note | [`deleteNotesForOwner`](./note.md) | 個人所有ノートと版・読み取りモデルの削除。1 件ずつ `note.purged` を発行し、タグ付与・保管ファイル・バックアップ記録の後始末につなぐ（ワークスペース所有ノートは残る — AC-09） |
| Note（読み取りモデル） | [`projectNoteChanges`](./note.md) | 残るワークスペース所有ノートの著者表示の置換（`updateAuthor(userId, "退会した利用者", null)`）。行は消さず、退会後の投影で旧表示名が復活しないようにする |
| Tag | [`deleteTagsForScope`](./tag.md) | 個人スコープのタグと付与の削除（`TagRepository.deleteByScope`） |
| Workspace | [`deleteMembershipsForUser`](./workspace.md) | 参加していたワークスペースからの除去（`MembershipRepository.deleteByUser`。唯一の owner でないことは手順 2 が保証する） |
| Integration | [`deleteIntegrationsForUser`](./integration.md) | 連携・バックアップ記録の削除とトークンの破棄（`ExternalConnectionRepository.deleteByUser` / `BackupRecordRepository.deleteByUser`） |
| Job | [`deleteJobsForRequester`](./job.md) | ジョブ履歴の削除（`JobRepository.deleteByRequester`。実行中のものは手順 3 でキャンセル済み） |
| Storage | [`deleteFilesByOwner`](./storage.md) | 個人所有ファイルの削除 |
| Usage | [`deleteQuota`](./usage.md) | クォータ行の削除 |

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 確認入力の不一致 | `ValidationError("CONFIRMATION_MISMATCH")` |
| 唯一の owner であるワークスペースがある | `BusinessRuleError(LastOwnerCannotLeave)` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## pruneExpiredAuthState

### 概要

期限切れの認証状態（セッション・認証トークン・ログイン試行・認可フロー状態）をまとめて回収する。定期ワーカーから呼ばれる。

### 入力DTO

なし（基準時刻は `clock` から得る）。

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `sessions` | `number` |
| `authTokens` | `number` |
| `loginAttempts` | `number` |
| `oauthFlowStates` | `number` |

### 処理フロー

1. `SessionRepository.deleteExpired(now)` を呼ぶ。`authenticateSession` は期限切れのセッションを常に `UNAUTHENTICATED` として扱うため、削除しても認証結果は変わらない
2. `AuthTokenRepository.deleteExpired(now)` を呼ぶ。消費済みのトークンも期限を過ぎていれば消える。単回性は消費時の条件付き更新（[domains/identity.md](../domains/identity.md) の `AuthTokenRepository`）が担保しており、行が残り続けることには依存しない
3. `LoginAttemptStore.deleteExpired(now)` を呼ぶ。ロック中の記録は `lockedUntil` より後に期限が来るため、ロックの解除を早めることはない
4. `OAuthStateStore.deleteExpired(now)` を呼ぶ。サインイン用（Identity）と連携用（Integration）の認可フロー状態は同じポートに載るため、この 1 回の掃除が両方を覆う。Integration 側に同種の定期掃除は置かない
5. 4 つの削除は互いに独立で、1 つの失敗は他に影響させない（記録して継続し、成功した分の件数を返す）

Unit of Work は使わない。いずれも期限切れ行の削除だけで、イベントも集約の不変条件も関与しないため。

冪等性: すべて「期限を過ぎた行の削除」であり、2 回目以降は 0 件で終わる。境界は `expiresAt <= now`（`Session.isExpired` / `AuthToken.isExpired` と同じ判定）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の削除の失敗 | 記録して継続 |
| 4 つすべての削除が失敗 | `SystemError(DatabaseError)` |
