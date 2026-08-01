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

### LoginAttemptKey

`LoginAttemptStore` の鍵。用途ごとに名前空間を分け、`{namespace}:{subject}:{clientKey}` の形に組み立てる。名前空間を先頭に置くのは、別種の照合の失敗が同じ行に集まって互いのロックを誘発するのを防ぐため。

| 用途 | 生成メソッド | 鍵 | 呼び出し元 |
| --- | --- | --- | --- |
| パスワードサインイン | `forSignIn(email: Email, clientKey: string)` | `signIn:{正規化済みメールアドレス}:{clientKey}` | [`signInWithPassword`](../usecases/identity.md) |
| 共有リンクのパスワード照合 | `forSharePassword(tokenHash: TokenHash, clientKey: string)` | `share:{共有トークンのハッシュ}:{clientKey}` | [`verifySharePassword`](../usecases/note.md) |

生成経路はこの 2 つのメソッドだけとし、文字列連結を呼び出し側に書かせない。共有リンク側が素のトークンではなく `TokenHash` を材料にするのは、`login_attempts.key`（[database/index.md](../database/index.md)）に共有の秘密が平文で残らないようにするため。`clientKey` は発信元を表す文字列で、要求ごとに transport 層が組み立てて入力 DTO で渡す。

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
| `updateProfile` | `user: ActiveUser, params: { displayName?: string; bio?: string; avatarUrl?: string \| null }, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | 指定された項目のみ VO を再構築して更新。`displayName` が変わったときのみ `user.profileUpdated` を発行 |
| `assignHandle` | `user: ActiveUser, handle: string, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `Handle.create` で検証して設定。`user.handleChanged`（旧ハンドルを payload に含む。未設定からの初回設定なら `previousHandle: null`）を無条件で発行 |
| `clearHandle` | `user: ActiveUser, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `handle` を `null` にする。`user.handleChanged` を発行 |

`assignHandle` が初回設定でもイベントを出すのは、読み取りモデルの `note_search.author_handle` を埋める唯一の経路がこのイベントだからである。ハンドル未設定のままワークスペース所有の公開ノートを作り、あとからハンドルを設定した場合、初回設定を無音にすると `author_handle` が `null` のまま残り、`searchPublicNotes` の結果に著者リンクが出ない一方 `getPublicNote` は Identity から直接引くので詳細だけ正しい、という不整合になる。`previousHandle: null` は payload の型で表現済みなので、購読側は初回設定と変更を区別せず現在値で上書きすればよい。`clearHandle` が常に発行するのと対称になる。

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
}
```

版管理（OCC）は行わない。書き込みは作成と削除だけで、更新が存在しないため。

- **保持方法**: 平文のセッショントークンはクライアントが持ち、サーバー側は `tokenHash` だけを保存する
- **運搬方法**: Cookie で運ぶ。属性（`HttpOnly` / `Secure` / `SameSite` / `Path`）と CSRF 対策は presentation 層の責務であり、正典は [presentation/index.md](../presentation/index.md)。ドメインは平文トークンとそのハッシュだけを扱い、どう運ばれるかを知らない（`SharePass`（[note.md](./note.md)）と同じ分担）

**有効期間**

`Session.ttlMs` は **30 日**。サインインした時点からの絶対期限であり、使うたびに延びることはない。`AuthTokenPurpose.ttlMs` が用途から期間を導くのと同じく、値はドメインが持ち、`create` の呼び出し側は渡さない。呼び出し側は 4 つある（`signUpWithPassword` / `verifyEmail` / `signInWithPassword` / `completeOAuthSignIn`。[usecases/identity.md](../usecases/identity.md)）ので、引数で受けると 4 か所が同じ値を渡すことを型で保証できない。

**アイドル失効（最終使用時刻からの相対期限）は採らない**。採ると `authenticateSession` が要求のたびに `expiresAt` を延ばして Cookie を張り直すことになり、「サーバー側の失効が唯一の正であり、Cookie 側はそれに一致させるだけ」という presentation との分担（[presentation/index.md](../presentation/index.md)）が崩れる。最終使用時刻（`lastUsedAt`）そのものも持たない — 値を読む経路が存在せず（セッション一覧・端末管理の画面要件を持たない）、認証要求のたびに書き込むコストだけが残るためである。

**受け入れたリスク**: セッションの一覧も端末管理も持たないため、利用者は不審なセッションの存在に気づく手段を持たない。トークンが漏れた場合の対抗手段は、他端末からのサインアウト（`signOutOtherSessions`。P-22）とパスワード再設定（`resetPassword` が全セッションを破棄する）の 2 つに限られる。「サインイン状態を保持しない」選択肢（ブラウザセッション限りの Cookie）も持たない。

**不変条件**

- `expiresAt > createdAt`
- `PendingUser` に対しては生成しない（この規則はユースケースが `ActiveUser` を要求することで型として担保される）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; userId: UserId; tokenHash: TokenHash }, now: Date` | `Session` | `expiresAt = now + Session.ttlMs` で生成。イベントは発行しない |
| `isExpired` | `session: Session, now: Date` | `boolean` | `session.expiresAt <= now` |

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

版管理（OCC）は行わない。単回性は消費の書き込みが `status = 'pending'` の行への条件付き更新であること（`AuthTokenRepository` を参照）で担保され、それ以外の書き込みは作成・削除のみで、競合しても害がないため。

**不変条件**

- 消費済みトークンは再び `pending` に戻らない
- 期限切れのトークンは消費できない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `issue` | `params: { id: string; userId: UserId; purpose: AuthTokenPurpose; tokenHash: TokenHash }, now: Date` | `PendingAuthToken` | `expiresAt = now + AuthTokenPurpose.ttlMs(purpose)` |
| `consume` | `token: PendingAuthToken, now: Date` | `ConsumedAuthToken` | `isExpired` が真なら `BusinessRuleError(TokenExpired)`。そうでなければ `status: "consumed"` にする |
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
| `evaluate` | `attempt: LoginAttempt, now: Date` | `ThrottleDecision` | `lockedUntil > now` なら `locked`、そうでなければ失敗回数から `allow` / `delay` を判定 |
| `recordFailure` | `attempt: LoginAttempt, now: Date` | `LoginAttempt` | 失敗回数を 1 増やし、最終失敗時刻を更新。閾値に達していれば `lockedUntil` を設定 |
| `initial` | `key: string` | `LoginAttempt` | 記録がないときの初期値（`failureCount: 0`、時刻はいずれも `null`） |

```
LoginAttempt = { key: string; failureCount: number; lastFailedAt: Date | null; lockedUntil: Date | null }
ThrottleDecision = { kind: "allow" } | { kind: "delay"; waitMs: number } | { kind: "locked"; until: Date }
```

規則: 3 回目以降の失敗ごとに待機 `2^(failureCount-2)` 秒（上限 60 秒）。10 回で 15 分ロック。

`LoginThrottlePolicy.attemptTtlMs = 24 時間`（`LoginAttemptStore.put` に渡す保持期間。定数としてこのサービスが公開する）。ロック期間の 15 分より十分長く取るのは、ロック中の記録が期限切れで消えるとロックが早期に解除され、失敗回数を捨てて総当たりを続けられてしまうため。逆に無期限にしないのは、`pruneExpiredAuthState` が回収できない行が溜まり続けるのを避けるためで、成功時は期限を待たず `clear` で即座に消す。

**読み書きの分担**: 全メソッドが純関数で、`LoginAttemptStore` の読み書きはユースケースが行う。呼ぶ側は次の順序を守る。

1. `LoginAttemptStore.get(key)`（`null` なら `initial(key)`）→ `evaluate` で待機・ロックを判定
2. 認証に失敗したら `LoginAttemptStore.put(recordFailure(attempt, now), attemptTtlMs)`
3. 認証に成功したら `LoginAttemptStore.clear(key)`

成功時に「失敗回数を 0 にした記録を書き戻す」のではなく行ごと消すのは、消費 0 の行を残さないため。ロック中は 2 を実行しない（`evaluate` が `locked` を返した時点で照合そのものを行わないので、ロック期間中の試行で `lockedUntil` が延び続けることはない）。

**依存するポート**: なし（全メソッドが純関数）

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

サイトマップに載せる「公開ノートを持つ利用者」の列挙は、公開ノートの有無を判定する必要があるため `NoteQueryService.listPublicAuthors` が担う。母集合は `/@:handle` の一覧（`searchPublicNotes` の `ownerFilter`）と同じ所有者基準で、`listPublicAuthors` が返す利用者 ID を `listByIds` でハンドルに解決する（[usecases/identity.md](../usecases/identity.md) の `listPublicProfiles`）。

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
  deleteById(id: SessionId): Promise<void>;
  deleteByUserId(userId: UserId, excluding: SessionId | null): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}
```

更新の口（`save`）を持たない。`Session` は絶対期限で、作成後に変わるフィールドがないため（上記「有効期間」）。

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

`save` で `ConsumedAuthToken` を保存するとき、アダプターは `status = 'pending'` の行への条件付き更新（`UPDATE ... SET status = 'consumed' WHERE id = ? AND status = 'pending'`）として実装する。更新行数が 0 なら他の要求が先に消費したものとして `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` を返す。これにより並行する消費のうち 1 件だけが成功する。

**エラーケース**: `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")`、`SystemError(DatabaseError)`

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

### LoginAttemptStore

**目的**: 認証失敗の回数を `LoginAttemptKey` ごとに記録する。サインインの照合と共有リンクのパスワード照合が、名前空間で分離された鍵で同じ表を共有する。

```ts
interface LoginAttemptStore {
  get(key: string): Promise<LoginAttempt | null>;
  put(attempt: LoginAttempt, ttlMs: number): Promise<void>;   // ttlMs は LoginThrottlePolicy.attemptTtlMs
  clear(key: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;                  // pruneExpiredAuthState が呼ぶ
}
```

`put` は同じ鍵の行を上書きし、`expiresAt = now + ttlMs` を書き直す。呼び出し元は `signInWithPassword`（`put` / `clear`）と `verifySharePassword`（`put` / `clear`）、`pruneExpiredAuthState`（`deleteExpired`）。読み書きの順序は `LoginThrottlePolicy` の「読み書きの分担」に従う。

**契約: 失敗の記録は、同じ鍵に対する並行した試行に対してロストアップデートを起こしてはならない。** 呼び出し元の手順は `get` → 判定 → `put` の「読んでから書く」形であり、`login_attempts`（[database/index.md](../database/index.md)）は集約ルートではないため楽観ロックも掛からない。素朴に実装すると、並行した失敗が同じ `failureCount` を読んで同じ値を書き、要求を並列化するだけで施錠を回避できる。`LoginThrottlePolicy` のしきい値（3 回目から待機、10 回で 15 分ロック）はこの契約が満たされて初めて意味を持つ。

この契約を満たす手段（原子的な加算・条件付き更新・専用の機構のいずれを使うか）は実行基盤に依存するため**保留**とし、アダプターが基盤の確定後に決める。要件の正典は [presentation/index.md](../presentation/index.md) のレート制限の節。

**エラーケース**: `SystemError(DatabaseError)`

### OAuthStateStore（横断的ポート）

認可フローの `state` と `codeVerifier` を保持するポートは、サインイン用（Identity）と外部連携用（Integration）の両方が使うため、このドメインではなくアプリケーション層に置く。定義は [domains/index.md](./index.md) の `OAuthStateStore`（`application/ports/oauthStateStore.ts`）を参照。

## ドメインイベント

「用途」欄は「誰が何のために読むか」の索引であり、次の 3 分類しか取らない。

- **購読ユースケース名**: 実際に購読者が存在するもの。名前で引けば購読側の定義に到達できる
- **監査**: 購読者を持たず、アウトボックスの行そのものが記録になるもの
- **（購読者なし。◯◯ が同期的に行う）**: 効果はあるが、購読ではなく発行元のユースケースが同じ手順の中で果たすもの

| 型 | payload | 用途 |
| --- | --- | --- |
| `identity.user.created` | `{ userId }` | Usage のクォータ行の初期化（[`initializeQuota`](../usecases/usage.md)） |
| `identity.user.emailVerified` | `{ userId }` | 監査 |
| `identity.user.profileUpdated` | `{ userId, displayName }` | 読み取りモデルの投影（[`projectNoteChanges`](../usecases/note.md) の著者表示名） |
| `identity.user.handleChanged` | `{ userId, previousHandle: string \| null, currentHandle: string \| null }` | 読み取りモデルの投影（[`projectNoteChanges`](../usecases/note.md) の著者ハンドル） |
| `identity.user.deleted` | `{ userId }` | Note / Tag / Storage / Workspace / Integration / Job / Usage の後始末、読み取りモデルの投影（著者表示の置換）。購読者の一覧は [usecases/identity.md](../usecases/identity.md) の `deleteAccount` 手順 5 |
| `identity.identity.added` | `{ identityId, userId, kind }` | 監査 |
| `identity.identity.removed` | `{ identityId, userId, kind }` | 監査 |
| `identity.identity.passwordChanged` | `{ identityId, userId }` | 監査（購読者なし。他セッションの失効は [`changePassword`](../usecases/identity.md) / [`resetPassword`](../usecases/identity.md) が同じ手順の中で `SessionRepository.deleteByUserId` を呼んで行う） |

`identity.passwordChanged` に失効の購読者を後から足してはならない。`changePassword` は現在のセッションだけを残す（`excluding: currentSessionId`）のに対し、購読側は「どのセッションが現在のものか」を知らないため全件を消すことになり、パスワードを変えた本人が直後にサインアウトされる。`resetPassword` が全件失効なのは要求そのものがセッションを持たないからで、両者は同じ処理ではない。

サイトマップは購読で更新しない。`listSitemapEntries` / `listPublicProfiles` / `listPublicWorkspaces` が要求のたびに現在の状態から列挙する引き取り型のため、ハンドルの変更にイベント駆動の追随は要らない。公開ページのキャッシュについても、無効化の仕組みを本設計は持たない。

payload は「何が変わったか」の通知にとどめ、投影に必要な現在値を運ばない。`NoteProjectionWriter.updateAuthor(userId, displayName, handle)` は表示名とハンドルの組を要るが、`identity.user.profileUpdated` は `displayName` しか、`identity.user.handleChanged` は新旧のハンドルしか持たない。購読側が `userId` で `UserRepository.findById` を引き、現在値の組を解決して渡す規約とする（[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）。payload を投影メソッドの引数に合わせて拡張する案は採らない — 投影は現在の状態からの冪等な上書きであり、payload に写した値は配送順の入れ替わりで古くなりうるため。Note のイベント（`note.contentUpdated` など）が本文を運ばず `NoteRepository.findById` で読み直させるのと同じ型である。

## エラーコード

```
IdentityErrorCode =
  | "InvalidId" | "InvalidEmail" | "InvalidHandle" | "HandleReserved"
  | "InvalidDisplayName" | "InvalidBio" | "WeakPassword"
  | "InvalidProviderAccount" | "TokenExpired"
  | "LastIdentityCannotBeRemoved" | "PasswordIdentityAlreadyExists"
```

## ユースケース（概要）

`signUpWithPassword`, `verifyEmail`, `resendVerificationEmail`, `signInWithPassword`, `startOAuthFlow`, `completeOAuthSignIn`, `linkOAuthIdentity`, `authenticateSession`, `signOut`, `signOutOtherSessions`, `requestPasswordReset`, `resetPassword`, `addPasswordIdentity`, `changePassword`, `removeIdentity`, `listIdentities`, `updateProfile`, `getPublicProfile`, `listPublicProfiles`, `deleteAccount`, `pruneExpiredAuthState`

詳細は [usecases/identity.md](../usecases/identity.md)。
