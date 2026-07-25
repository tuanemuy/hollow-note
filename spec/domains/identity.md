# Identity

利用者を識別し、認証手段とセッションの正当性を保つ。認証手段の分離方針は [ADR 001](../adr/001-authentication-strategy.md) に従う。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| User | 利用者 | サービスを使う人。1 人につき 1 レコード |
| Identity | 認証手段 | 利用者が本人であることを示す方法。パスワードまたは OAuth |
| Session | セッション | サインイン状態を表す、期限付きの資格 |
| AuthToken | 認証トークン | メール確認・パスワード再設定に使う 1 回限りの秘密 |
| Handle | ハンドル | 公開ページの URL に使う一意の文字列 |
| Verified | 確認済み | メールアドレスの到達性が確認された状態 |

## 値オブジェクト

### UserId / IdentityId / SessionId / AuthTokenId

- **フィールド**: `string`（公称型）
- **バリデーション**: 空白のみは不可。`BusinessRuleError(IdentityErrorCode.InvalidId)`
- **等価性**: 文字列として一致

### Email

- **フィールド**: `value: string`
- **バリデーション**: 254 文字以内、`local@domain` の形式に一致する。前後の空白を除去し、小文字に正規化する。違反時 `BusinessRuleError(IdentityErrorCode.InvalidEmail)`
- **等価性**: 正規化後の文字列が一致

### Handle

- **フィールド**: `value: string`
- **バリデーション**: 3〜30 文字、`[a-z0-9_-]` のみ、先頭と末尾は英数字。予約語（`settings`, `api`, `signin`, `signup`, `search`, `notes`, `workspaces`, `jobs`, `tags`, `n`, `s`, `w`, `auth`, `admin`, `about`, `terms`, `privacy`, `sitemap.xml`, `robots.txt`）は不可。違反時 `BusinessRuleError(IdentityErrorCode.InvalidHandle)` / `HandleReserved`
- **等価性**: 小文字化した文字列が一致

### DisplayName

- **フィールド**: `value: string`
- **バリデーション**: 前後の空白を除去して 1〜50 文字。違反時 `BusinessRuleError(IdentityErrorCode.InvalidDisplayName)`

### Bio

- **フィールド**: `value: string`
- **バリデーション**: 500 文字以内。空文字列を許す

### PasswordHash

- **フィールド**: `value: string`
- **バリデーション**: 空文字列は不可。生成は `PasswordHasher` ポートのみ
- **等価性**: 比較は行わない（照合は `PasswordHasher.verify`）

### PlainPassword

- **フィールド**: `value: string`
- **バリデーション**: 8〜128 文字。英字と数字をそれぞれ 1 文字以上含む。違反時 `BusinessRuleError(IdentityErrorCode.WeakPassword)`
- **等価性**: 定義しない（ログ・シリアライズ禁止）

### TokenHash

- **フィールド**: `value: string`
- **バリデーション**: 空文字列は不可。生成は `SecureTokenGenerator` ポートのみ

### OAuthProvider

- **フィールド**: `value: "google"`
- **バリデーション**: 既知の値のみ。将来の追加はこのユニオンに足す

### AuthTokenPurpose

- **フィールド**: `value: "email_verification" | "password_reset"`
- **有効期間**: `email_verification` は 24 時間、`password_reset` は 1 時間。`AuthTokenPurpose.ttlMs(purpose): number` で引く

## エンティティ

### User（集約ルート）

```
UserBase = {
  id: UserId
  email: Email
  displayName: DisplayName
  bio: Bio
  avatarUrl: string | null      // 公開 URL。Storage への依存を持たないための取り決め
  handle: Handle | null
  version: number
  createdAt: Date
  updatedAt: Date
}

PendingUser  = UserBase & { status: "pending" }    // メール未確認
ActiveUser   = UserBase & { status: "active", verifiedAt: Date }
User = PendingUser | ActiveUser
```

**不変条件**

- `email` はサービス全体で一意（`UserRepository.findByEmail` で検査）
- `handle` は設定されていればサービス全体で一意
- `PendingUser` はセッションを発行できない
- `ActiveUser` から `PendingUser` へ戻る遷移は存在しない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; email: string; displayName: string }, now: Date` | `WithEventDrafts<PendingUser, IdentityEvent>` | VO を構築し `status: "pending"`、`version: 0` で生成。`user.created` を発行 |
| `createVerified` | `params: { id: string; email: string; displayName: string }, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | OAuth サインアップ・招待経由サインアップ用。確認済みとして生成。`user.created` と `user.emailVerified` を発行 |
| `verifyEmail` | `user: PendingUser, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `status` を `active` にし `verifiedAt` を設定。`user.emailVerified` を発行 |
| `updateProfile` | `user: ActiveUser, params: { displayName?: string; bio?: string; avatarUrl?: string \| null }, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | 指定された項目のみ VO を再構築して更新。イベントなし |
| `assignHandle` | `user: ActiveUser, handle: string, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `Handle.create` で検証して設定。変更前の値があれば `user.handleChanged`（旧ハンドルを payload に含む）を発行 |
| `clearHandle` | `user: ActiveUser, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `handle` を `null` にする。`user.handleChanged` を発行 |

**ライフサイクル**

`create` → `PendingUser` → `verifyEmail` → `ActiveUser`。`createVerified` は直接 `ActiveUser` を生成する。削除は後継エンティティを持たないため、ユースケースが `IdentityEvents.userDeleted` を直接発行する。

### Identity（集約ルート）

```
IdentityBase = {
  id: IdentityId
  userId: UserId
  version: number
  createdAt: Date
  updatedAt: Date
}

PasswordIdentity = IdentityBase & { kind: "password", passwordHash: PasswordHash }
OAuthIdentity    = IdentityBase & {
  kind: "oauth",
  provider: OAuthProvider,
  providerAccountId: string,
  providerEmail: Email,
}
Identity = PasswordIdentity | OAuthIdentity
```

**不変条件**

- 1 人の利用者が持つ `PasswordIdentity` は最大 1 件
- `(provider, providerAccountId)` はサービス全体で一意
- 1 人の利用者は最低 1 件の `Identity` を持つ（この規則は `IdentityPolicy` が検査する）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `createPassword` | `params: { id: string; userId: UserId; passwordHash: PasswordHash }, now: Date` | `WithEventDrafts<PasswordIdentity, IdentityEvent>` | 生成し `identity.added` を発行 |
| `createOAuth` | `params: { id: string; userId: UserId; provider: string; providerAccountId: string; providerEmail: string }, now: Date` | `WithEventDrafts<OAuthIdentity, IdentityEvent>` | VO を構築して生成し `identity.added` を発行。`providerAccountId` が空文字列なら `BusinessRuleError(InvalidProviderAccount)` |
| `changePassword` | `identity: PasswordIdentity, passwordHash: PasswordHash, now: Date` | `WithEventDrafts<PasswordIdentity, IdentityEvent>` | ハッシュを差し替え、`identity.passwordChanged` を発行 |

削除はユースケースが `IdentityEvents.identityRemoved` を直接発行する。

### Session（集約ルート）

```
Session = {
  id: SessionId
  userId: UserId
  tokenHash: TokenHash
  createdAt: Date
  expiresAt: Date
  lastUsedAt: Date
}
```

版管理（OCC）は行わない。書き込みは作成・`lastUsedAt` の更新・削除のみで、競合しても害がないため。

**不変条件**

- `expiresAt > createdAt`
- `PendingUser` に対しては生成しない（この規則はユースケースが `ActiveUser` を要求することで型として担保される）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; userId: UserId; tokenHash: TokenHash }, now: Date, ttlMs: number` | `Session` | `expiresAt = now + ttlMs` で生成。イベントは発行しない |
| `isExpired` | `session: Session, now: Date` | `boolean` | `session.expiresAt <= now` |
| `touch` | `session: Session, now: Date` | `Session` | `lastUsedAt` を更新。`isExpired` が真なら `BusinessRuleError(SessionExpired)` |

### AuthToken（集約ルート）

```
AuthTokenBase = {
  id: AuthTokenId
  userId: UserId
  purpose: AuthTokenPurpose
  tokenHash: TokenHash
  createdAt: Date
  expiresAt: Date
}

PendingAuthToken  = AuthTokenBase & { status: "pending" }
ConsumedAuthToken = AuthTokenBase & { status: "consumed", consumedAt: Date }
AuthToken = PendingAuthToken | ConsumedAuthToken
```

**不変条件**

- 消費済みトークンは再び `pending` に戻らない
- 期限切れのトークンは消費できない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `issue` | `params: { id: string; userId: UserId; purpose: AuthTokenPurpose; tokenHash: TokenHash }, now: Date` | `PendingAuthToken` | `expiresAt = now + AuthTokenPurpose.ttlMs(purpose)` |
| `consume` | `token: PendingAuthToken, now: Date` | `ConsumedAuthToken` | 期限切れなら `BusinessRuleError(TokenExpired)`。そうでなければ `status: "consumed"` にする |
| `isExpired` | `token: AuthToken, now: Date` | `boolean` | `token.expiresAt <= now` |

## ドメインサービス

### IdentityPolicy

**責務**: 1 人の利用者が持つ認証手段の集合に対する規則を検査する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureRemovable` | `identities: readonly Identity[], targetId: IdentityId` | `void` | 対象を除いて 1 件も残らないなら `BusinessRuleError(LastIdentityCannotBeRemoved)` |
| `ensurePasswordAddable` | `identities: readonly Identity[]` | `void` | 既に `PasswordIdentity` があれば `BusinessRuleError(PasswordIdentityAlreadyExists)` |
| `findPassword` | `identities: readonly Identity[]` | `PasswordIdentity \| null` | パスワード認証手段を取り出す |

**依存するポート**: なし

### AccountLinkingPolicy

**責務**: OAuth サインイン時に、既存の利用者へ紐づけてよいかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `decide` | `existingUser: User \| null, providerEmailVerified: boolean` | `LinkDecision` | 下表の規則で判定する |

```
LinkDecision =
  | { kind: "createNew" }                       // 該当利用者なし
  | { kind: "linkToExisting"; userId: UserId }  // 確認済みの既存利用者
  | { kind: "refuse"; reason: "providerEmailUnverified" | "existingUserUnverified" }
```

| 既存利用者 | プロバイダー側のメール確認 | 判定 |
| --- | --- | --- |
| なし | 済 | `createNew` |
| なし | 未 | `refuse(providerEmailUnverified)` |
| `ActiveUser` | 済 | `linkToExisting` |
| `PendingUser` | 済 | `refuse(existingUserUnverified)` |
| いずれか | 未 | `refuse(providerEmailUnverified)` |

**依存するポート**: なし

### LoginThrottlePolicy

**責務**: 連続した認証失敗に対する待機とロックを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `evaluate` | `attempt: LoginAttempt, now: Date` | `ThrottleDecision` | 失敗回数から判定 |
| `recordFailure` | `attempt: LoginAttempt, now: Date` | `LoginAttempt` | 失敗回数を 1 増やし、最終失敗時刻を更新 |
| `reset` | `attempt: LoginAttempt` | `LoginAttempt` | 失敗回数を 0 に戻す |

```
LoginAttempt = { key: string; failureCount: number; lastFailedAt: Date | null; lockedUntil: Date | null }
ThrottleDecision = { kind: "allow" } | { kind: "delay"; waitMs: number } | { kind: "locked"; until: Date }
```

規則: 3 回目以降の失敗ごとに待機 `2^(failureCount-2)` 秒（上限 60 秒）。10 回で 15 分ロック。

**依存するポート**: `LoginAttemptStore`

## ポート

### UserRepository

**目的**: 利用者集約の永続化と一意性の問い合わせ。

```ts
interface UserRepository extends TransactionalRepository<User, UserId> {
  findByEmail(email: Email): Promise<Versioned<User> | null>;
  findByHandle(handle: Handle): Promise<User | null>;
  existsByEmail(email: Email): Promise<boolean>;
  existsByHandle(handle: Handle, excluding: UserId | null): Promise<boolean>;
  listByIds(ids: readonly UserId[]): Promise<readonly User[]>;
}
```

サイトマップに載せる「公開ノートを持つ利用者」の列挙は、公開ノートの有無を判定する必要があるため `NoteQueryService.listPublicAuthors` が担う。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`（版の不一致）、`ConflictError("EMAIL_ALREADY_USED")` / `ConflictError("HANDLE_ALREADY_USED")`（一意制約違反）、`SystemError(DatabaseError)`

### IdentityRepository

```ts
interface IdentityRepository extends TransactionalRepository<Identity, IdentityId> {
  listByUserId(userId: UserId): Promise<readonly Identity[]>;
  findByProviderAccount(provider: OAuthProvider, providerAccountId: string): Promise<Versioned<Identity> | null>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`、`SystemError(DatabaseError)`

### SessionRepository

```ts
interface SessionRepository {
  insert(session: Session): Promise<void>;
  findByTokenHash(tokenHash: TokenHash): Promise<Session | null>;
  save(session: Session): Promise<void>;
  deleteById(id: SessionId): Promise<void>;
  deleteByUserId(userId: UserId, excluding: SessionId | null): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}
```

**エラーケース**: `SystemError(DatabaseError)`

### AuthTokenRepository

```ts
interface AuthTokenRepository {
  insert(token: AuthToken): Promise<void>;
  findByTokenHash(tokenHash: TokenHash): Promise<AuthToken | null>;
  save(token: AuthToken): Promise<void>;
  deleteByUserAndPurpose(userId: UserId, purpose: AuthTokenPurpose): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}
```

**エラーケース**: `SystemError(DatabaseError)`

### PasswordHasher

**目的**: 平文パスワードのハッシュ化と照合。

```ts
interface PasswordHasher {
  hash(password: PlainPassword): Promise<PasswordHash>;
  verify(password: PlainPassword, hash: PasswordHash): Promise<boolean>;
}
```

**エラーケース**: `SystemError(ExternalServiceError)`（暗号処理の失敗）

### SecureTokenGenerator

**目的**: 推測できない秘密トークンの生成と、保存用ハッシュの算出。

```ts
interface SecureTokenGenerator {
  issue(): { readonly token: string; readonly hash: TokenHash };
  hashOf(token: string): TokenHash;
}
```

`token` は利用者に渡す値、`hash` は保存する値。`issue` の `token` は 256 ビット以上の乱数を URL 安全な文字列にしたもの。

**エラーケース**: `SystemError(ExternalServiceError)`

### SignInOAuthClient

**目的**: サインイン用 OAuth プロバイダーとのやり取り。

```ts
interface SignInOAuthClient {
  buildAuthorizationUrl(params: { provider: OAuthProvider; state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(params: { provider: OAuthProvider; code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthProfile>;
}

type OAuthProfile = Readonly<{
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}>;
```

**エラーケース**: `SystemError(ExternalServiceError)`（通信・応答不正）、`ValidationError("OAUTH_CODE_INVALID")`（コードの期限切れ・不正）

### OAuthStateStore

**目的**: 認可フローの `state` と `codeVerifier` を、コールバックまで短期間保持する。サインイン用（Identity）と外部連携用（Integration）の両方が使う横断的なポート。

```ts
interface OAuthStateStore {
  put(state: string, value: OAuthFlowState, ttlMs: number): Promise<void>;
  take(state: string): Promise<OAuthFlowState | null>;   // 取得と同時に削除する
}

type OAuthFlowState = Readonly<{
  provider: string;           // OAuthProvider（サインイン）または ProviderKind（連携）
  codeVerifier: string;
  redirectTo: string | null;
  intent: "signIn" | "linkIdentity" | "integration";
  userId: UserId | null;      // intent が "linkIdentity" / "integration" のとき必須
}>;
```

`provider` を原始型のままにしているのは、Identity と Integration が別々の列挙を持つため。値の解釈は取り出した側が自分の値オブジェクトで再構築する。

**エラーケース**: `SystemError(DatabaseError)`

### LoginAttemptStore

**目的**: 認証失敗の回数を、メールアドレスと発信元の組で記録する。

```ts
interface LoginAttemptStore {
  get(key: string): Promise<LoginAttempt | null>;
  put(attempt: LoginAttempt, ttlMs: number): Promise<void>;
  clear(key: string): Promise<void>;
}
```

**エラーケース**: `SystemError(DatabaseError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `identity.user.created` | `{ userId }` | Usage のクォータ行を初期化する |
| `identity.user.emailVerified` | `{ userId }` | 監査 |
| `identity.user.handleChanged` | `{ userId, previousHandle: string \| null, currentHandle: string \| null }` | 公開ページのキャッシュ・サイトマップの更新 |
| `identity.user.deleted` | `{ userId }` | Note / Storage / Workspace / Integration / Job / Usage の後始末 |
| `identity.identity.added` | `{ identityId, userId, kind }` | 監査 |
| `identity.identity.removed` | `{ identityId, userId, kind }` | 監査 |
| `identity.identity.passwordChanged` | `{ identityId, userId }` | 他セッションの失効（購読側で実行） |

## エラーコード

```
IdentityErrorCode =
  | "InvalidId" | "InvalidEmail" | "InvalidHandle" | "HandleReserved"
  | "InvalidDisplayName" | "InvalidBio" | "WeakPassword"
  | "InvalidProviderAccount" | "SessionExpired" | "TokenExpired"
  | "LastIdentityCannotBeRemoved" | "PasswordIdentityAlreadyExists"
```

## ユースケース（概要）

`signUpWithPassword`, `verifyEmail`, `resendVerificationEmail`, `signInWithPassword`, `startOAuthFlow`, `completeOAuthSignIn`, `linkOAuthIdentity`, `authenticateSession`, `signOut`, `signOutOtherSessions`, `requestPasswordReset`, `resetPassword`, `addPasswordIdentity`, `changePassword`, `removeIdentity`, `listIdentities`, `updateProfile`, `getPublicProfile`, `listPublicProfiles`, `deleteAccount`

詳細は [usecases/identity.md](../usecases/identity.md)。
