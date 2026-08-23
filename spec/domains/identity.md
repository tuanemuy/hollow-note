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

### AvatarUrl

- **フィールド**: `value: string`
- **バリデーション**: 前後の空白を除去して 1〜2048 文字。`/` で始まる値はアプリ相対パスとして扱い `SameOriginPolicy.isSameOriginPath` を満たすこと、それ以外は絶対 URL として解釈でき `appUrl` と同一オリジンであること。違反時 `BusinessRuleError(IdentityErrorCode.InvalidAvatarUrl)`
- **構築**: `create(raw: string, appUrl: string)`。自オリジンの情報は引数で受け取り、値オブジェクトは設定を読みに行かない

保存する値は**アプリ相対パス**を正とする（配備のオリジンが変わっても保存済みの値が壊れない）。自オリジンの絶対 URL 形は、自分の公開ドメインで配信する object store のために受理する。永続化からの再構築は「書き込み時に検証済み」として通し、再検証しない（[ADR 051](../adr/051-same-origin-url-predicate.md)）。

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

生成経路はこの 2 つのメソッドだけとし、文字列連結を呼び出し側に書かせない。共有リンク側が素のトークンではなく `TokenHash` を材料にするのは、`login_attempts.key`（[database/index.md](../database/index.md)）に共有の秘密が平文で残らないようにするため。`clientKey` は発信元を表す文字列で、要求ごとに transport 層が組み立てて入力 DTO で渡す（材料は `CF-Connecting-IP`。正典は [presentation/index.md](../presentation/index.md) のレート制限の節）。

## エンティティ

### User（集約ルート）

```
UserBase = {
  id: UserId
  email: Email
  displayName: DisplayName
  bio: Bio
  avatarUrl: AvatarUrl | null   // 公開 URL。Storage への依存を持たないための取り決め
  handle: Handle | null
  authEpoch: number             // 全session/tokenをO(1)で論理失効する単調増加世代
  version: number
  createdAt: Date
  updatedAt: Date
}

PendingUser  = UserBase & { status: "pending" }    // メール未確認
ActiveUser   = UserBase & { status: "active", verifiedAt: Date }
DeletingUser = UserBase & { status: "deleting", verifiedAt: Date; deletionOperationId: string }
DeletedUser = {
  id: UserId
  status: "deleted"
  authEpoch: number
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date
}
User = PendingUser | ActiveUser | DeletingUser | DeletedUser
```

**不変条件**

- `email` はサービス全体で一意（`IdentityUniqueDirectory` のreservationで保証）
- `handle` は設定されていればサービス全体で一意
- `PendingUser` はセッションを発行できない
- `ActiveUser` から `PendingUser` へ戻る遷移は存在しない
- `DeletingUser` はsession・membership・Jobを新規作成できない。削除事前検査が唯一ownerで失敗した場合だけ同じoperation IDで `ActiveUser` に戻せる
- `DeletedUser` はPIIを持たないtombstoneで、activeへ戻らない
- `authEpoch`は減少しない。Session/AuthTokenの発行時世代がcurrent Userと違えば、物理行が残っていても無効

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; email: string; displayName: string }, now: Date` | `WithEventDrafts<PendingUser, IdentityEvent>` | VO を構築し `status: "pending"`、`authEpoch: 0`、`version: 0` で生成。`user.created` を発行 |
| `createVerified` | `params: { id: string; email: string; displayName: string }, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | OAuth サインアップ・招待経由サインアップ用。`authEpoch: 0`の確認済みとして生成。`user.created` と `user.emailVerified` を発行 |
| `verifyEmail` | `user: PendingUser, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `status` を `active` にし `verifiedAt` を設定。`user.emailVerified` を発行 |
| `updateProfile` | `user: ActiveUser, params: { displayName?: string; bio?: string; avatarUrl?: AvatarUrl \| null }, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | 指定された `displayName` / `bio` のみ VO を再構築して更新し、`avatarUrl` は受け取った値をそのまま置く。`displayName` が変わったときのみ `user.profileUpdated` を発行 |
| `assignHandle` | `user: ActiveUser, handle: string, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `Handle.create` で検証して設定。`user.handleChanged`（旧ハンドルを payload に含む。未設定からの初回設定なら `previousHandle: null`）を無条件で発行 |
| `clearHandle` | `user: ActiveUser, now: Date` | `WithEventDrafts<ActiveUser, IdentityEvent>` | `handle` を `null` にする。`user.handleChanged` を発行 |
| `advanceAuthEpoch` | `user: ActiveUser, now: Date` | `ActiveUser` | `authEpoch + 1`へ進め、既存session/tokenを論理失効する |
| `beginDeletion` | `user: ActiveUser, operationId: string, now: Date` | `DeletingUser` | `authEpoch + 1`へ進め、新しい認証・membership・Jobを拒否する状態へ移す |
| `rejectDeletion` | `user: DeletingUser, operationId: string, now: Date` | `ActiveUser` | 事前検査失敗時だけactiveへ戻す |
| `finalizeDeletion` | `user: DeletingUser, operationId: string, now: Date` | `WithEventDrafts<DeletedUser, IdentityEvent>` | 全cleanup ack後にPIIを落とし `identity.user.deleted` を発行 |

`updateProfile` の `avatarUrl` だけが構築済みの VO で渡るのは、`AvatarUrl.create` が `appUrl` を要するためである。集約は設定を読まないので、生値からの構築はユースケース側（[usecases/identity.md](../usecases/identity.md) の `updateProfile`）が行う。集約のメソッドが生の文字列を受けない形にしておくことで、将来の別経路が同一オリジン検証を素通りできない（[ADR 051](../adr/051-same-origin-url-predicate.md)）。

`assignHandle` が初回設定でもイベントを出すのは、読み取りモデルの `note_search.author_handle` を埋める唯一の経路がこのイベントだからである。ハンドル未設定のままワークスペース所有の公開ノートを作り、あとからハンドルを設定した場合、初回設定を無音にすると `author_handle` が `null` のまま残り、`searchPublicNotes` の結果に著者リンクが出ない一方 `getPublicNote` は Identity から直接引くので詳細だけ正しい、という不整合になる。`previousHandle: null` は payload の型で表現済みなので、購読側は初回設定と変更を区別せず現在値で上書きすればよい。`clearHandle` が常に発行するのと対称になる。

**ライフサイクル**

`create` → `PendingUser` → `verifyEmail` → `ActiveUser`。`createVerified` は直接 `ActiveUser` を生成する。削除は `ActiveUser → DeletingUser → DeletedUser` で、最後の遷移だけが `identity.user.deleted` を発行する。

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
  authEpoch: number
  createdAt: Date
  expiresAt: Date
}
```

版管理（OCC）は行わない。通常は作成と削除だけで、`signOutOtherSessions` / `changePassword`が現在の1行だけをcurrent Userの`authEpoch`へ追随させる条件付き更新を例外として持つ。

- **保持方法**: 平文のセッショントークンはクライアントが持ち、サーバー側は `tokenHash` だけを保存する
- **運搬方法**: Cookie で運ぶ。属性（`HttpOnly` / `Secure` / `SameSite` / `Path`）と CSRF 対策は presentation 層の責務であり、正典は [presentation/index.md](../presentation/index.md)。ドメインは平文トークンとそのハッシュだけを扱い、どう運ばれるかを知らない（`SharePass`（[note.md](./note.md)）と同じ分担）

**有効期間**

`Session.ttlMs` は **30 日**。サインインした時点からの絶対期限であり、使うたびに延びることはない。`AuthTokenPurpose.ttlMs` が用途から期間を導くのと同じく、値はドメインが持ち、`create` の呼び出し側は渡さない。呼び出し側は 4 つある（`signUpWithPassword` / `verifyEmail` / `signInWithPassword` / `completeOAuthSignIn`。[usecases/identity.md](../usecases/identity.md)）ので、引数で受けると 4 か所が同じ値を渡すことを型で保証できない。

**アイドル失効（最終使用時刻からの相対期限）は採らない**。採ると `authenticateSession` が要求のたびに `expiresAt` を延ばして Cookie を張り直すことになり、「サーバー側の失効が唯一の正であり、Cookie 側はそれに一致させるだけ」という presentation との分担（[presentation/index.md](../presentation/index.md)）が崩れる。最終使用時刻（`lastUsedAt`）そのものも持たない — 値を読む経路が存在せず（セッション一覧・端末管理の画面要件を持たない）、認証要求のたびに書き込むコストだけが残るためである。

**受け入れたリスク**: セッションの一覧も端末管理も持たないため、利用者は不審なセッションの存在に気づく手段を持たない。トークンが漏れた場合の対抗手段は、他端末からのサインアウト（`signOutOtherSessions`。P-22）とパスワード再設定（`resetPassword` が全セッションを破棄する）の 2 つに限られる。「サインイン状態を保持しない」選択肢（ブラウザセッション限りの Cookie）も持たない。

**不変条件**

- `expiresAt > createdAt`
- `authenticateSession`は`session.authEpoch === user.authEpoch`を要求する
- `PendingUser` に対しては生成しない（この規則はユースケースが `ActiveUser` を要求することで型として担保される）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; userId: UserId; tokenHash: TokenHash; authEpoch: number }, now: Date` | `Session` | `expiresAt = now + Session.ttlMs` で生成。イベントは発行しない |
| `isExpired` | `session: Session, now: Date` | `boolean` | `session.expiresAt <= now` |

### AuthToken（集約ルート）

```
AuthTokenBase = {
  id: AuthTokenId
  userId: UserId
  purpose: AuthTokenPurpose
  tokenHash: TokenHash
  authEpoch: number
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
- 発行時`authEpoch`がcurrent Userと異なるトークンは消費できない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `issue` | `params: { id: string; userId: UserId; purpose: AuthTokenPurpose; tokenHash: TokenHash; authEpoch: number }, now: Date` | `PendingAuthToken` | `expiresAt = now + AuthTokenPurpose.ttlMs(purpose)` |
| `consume` | `token: PendingAuthToken, now: Date` | `ConsumedAuthToken` | `isExpired` が真なら `BusinessRuleError(TokenExpired)`。そうでなければ `status: "consumed"` にする |
| `isExpired` | `token: AuthToken, now: Date` | `boolean` | `token.expiresAt <= now` |

## ドメインサービス

### IdentityPolicy

**責務**: 1 人の利用者が持つ認証手段の集合に対する規則を検査する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureRemovable` | `identities: readonly Identity[], targetId: IdentityId` | `void` | 対象を除いて 1 件も残らないなら `BusinessRuleError(LastIdentityCannotBeRemoved)` |
| `ensureAddable` | `identities: readonly Identity[]` | `void` | 既に`maxIdentitiesPerUser`件なら`BusinessRuleError(IdentityLimitExceeded)` |
| `ensurePasswordAddable` | `identities: readonly Identity[]` | `void` | 既に `PasswordIdentity` があれば `BusinessRuleError(PasswordIdentityAlreadyExists)` |
| `findPassword` | `identities: readonly Identity[]` | `PasswordIdentity \| null` | パスワード認証手段を取り出す |

**依存するポート**: なし

`maxIdentitiesPerUser = 8`を正典とする。Password/OAuthの合計で数え、Identity追加を伴う`completeOAuthSignIn`、`linkOAuthIdentity`、`addPasswordIdentity`はUserId shardの最終UoW内でcurrent集合を読み直して`ensureAddable`してからinsertする。これにより`listByUserId`、一覧応答、account deletionで解放するprovider reservation集合は常に8件以下になる。

### AccountLinkingPolicy

**責務**: OAuth サインイン時に、既存の利用者へ紐づけてよいかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `decide` | `existingUser: User \| null, providerEmailVerified: boolean` | `LinkDecision` | 下表の規則で判定する |

```
LinkDecision =
  | { kind: "createNew" }                       // 該当利用者なし
  | { kind: "linkToExisting"; userId: UserId }  // 確認済みの既存利用者
  | { kind: "refuse"; reason: "providerEmailUnverified" | "existingUserUnverified" | "existingUserUnavailable" }
```

| 既存利用者 | プロバイダー側のメール確認 | 判定 |
| --- | --- | --- |
| なし | 済 | `createNew` |
| なし | 未 | `refuse(providerEmailUnverified)` |
| `ActiveUser` | 済 | `linkToExisting` |
| `PendingUser` | 済 | `refuse(existingUserUnverified)` |
| `DeletingUser` / `DeletedUser` | 済 | `refuse(existingUserUnavailable)` |
| いずれか | 未 | `refuse(providerEmailUnverified)` |

**依存するポート**: なし

### LoginThrottlePolicy

**責務**: 連続した認証失敗に対する待機とロックを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `evaluate` | `attempt: LoginAttempt, now: Date` | `ThrottleDecision` | 失敗回数と最終失敗時刻から `allow` / `delay` / `locked` を**導出**する |
| `initial` | `key: string` | `LoginAttempt` | 記録がないときの初期値（`failureCount: 0`、`lastFailedAt: null`） |

```
LoginAttempt = { key: string; failureCount: number; lastFailedAt: Date | null }
ThrottleDecision = { kind: "allow" } | { kind: "delay"; waitMs: number } | { kind: "locked"; until: Date }
```

規則: 3 回目以降の失敗ごとに待機 `2^(failureCount-2)` 秒（上限 60 秒）。**`failureCount >= 10` かつ `now < lastFailedAt + 15 分` ならロック**（解除時刻は `lastFailedAt + 15 分`）。

定数（このサービスが公開する。値の正典はここ）:

| 定数 | 値 | 意味 |
| --- | --- | --- |
| `lockThreshold` | 10 | ロックに入る失敗回数 |
| `lockDurationMs` | 15 分 | ロックの長さ |
| `maxDelayMs` | 60 秒 | 待機の上限 |
| `attemptTtlMs` | 24 時間 | 記録の保持期間 |

`attemptTtlMs` をロック期間の 15 分より十分長く取るのは、ロック中の記録が期限切れで消えるとロックが早期に解除され、失敗回数を捨てて総当たりを続けられてしまうため。逆に無期限にしないのは、`pruneExpiredAuthState` が回収できない行が溜まり続けるのを避けるためで、成功時は期限を待たず `clear` で即座に消す。

**ロックを保存せず導出するのはなぜか**。失敗回数の加算は並行した試行に対して原子的でなければならず（下記 `LoginAttemptStore` の契約）、原子性を単一の SQL 文で与えるには**書き込む値が読んだ値に依存してはならない**。`lockedUntil` を保存すると、その値が `failureCount` から計算される以上、しきい値の判定をアダプターの SQL に持ち込むことになる。導出に変えれば、しきい値の規則はこのドメインサービスの 1 か所に残る。

振る舞いは保存していたときと変わらない。ロック中は照合そのものを行わないので `lastFailedAt` は 10 回目で凍り、ロックは 10 回目の失敗から 15 分で解ける。解けたあとは `failureCount` が 10 のままなので待機は上限の 60 秒になり、次の失敗で `lastFailedAt` が更新されて再びロックに入る。

**読み書きの分担**: `evaluate` / `initial` は純関数で、`LoginAttemptStore` の読み書きはユースケースが行う。呼ぶ側は次の順序を守る。

1. `LoginAttemptStore.get(key)`（`null` なら `initial(key)`）→ `evaluate` で入場を判定する
2. 認証に失敗したら `LoginAttemptStore.recordFailure(key, now, attemptTtlMs)` を呼ぶ。**加算はポート側の原子的な操作**であり、戻り値は加算後の `LoginAttempt`。応答に載せる待機秒数・解除時刻は、この戻り値を `evaluate` して求める
3. 認証に成功したら `LoginAttemptStore.clear(key)`

成功時に「失敗回数を 0 にした記録を書き戻す」のではなく行ごと消すのは、消費 0 の行を残さないため。ロック中は 2 を実行しない（`evaluate` が `locked` を返した時点で照合そのものを行わない）。

手順 1 の `get` は**古い値を読みうる**が害にならない。判定が緩む方向に外れても、その試行の失敗は手順 2 で原子的に数えられるため施錠は必ず追いつく。

**依存するポート**: なし（`evaluate` / `initial` は純関数）

### AccountDeletionRetryPolicy

**責務**: 1 人の利用者が保持期間内に残せる退会操作の試行回数を判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `windowStart` | `now: Date` | `Date` | `now - retentionWindowMs`。保持中の terminal 行を数える窓の下端 |
| `ensureRetryable` | `terminalCount: number` | `void` | `terminalCount >= maxTerminalAttempts` なら `BusinessRuleError(AccountDeletionRetryLimitExceeded)` |

定数（このサービスが公開する。値の正典はここ）:

| 定数 | 値 | 意味 |
| --- | --- | --- |
| `retentionWindowMs` | 120 日 | terminal な control-plane 行の保持期間。数える窓の幅はこれと同じ |
| `maxTerminalAttempts` | 8 | 1 人の利用者が保持中に残せる terminal 行の上限 |

しきい値と窓をここに置き、`DistributedOperationStore.countTerminalSince` には件数の観測だけをさせる（[ADR 044](../adr/044-business-thresholds-in-domain.md)）。数値がバックエンドの数だけ複製されるのを避けるためで、呼ぶ側（[usecases/identity.md](../usecases/identity.md) の `deleteAccount`）は**数えて → 判定して → はじめて作る**順に呼ぶ（作ってからロールバックしない）。新しい operation を作りうる要求だけが判定の対象で、進行中の operation を引き継ぐ再開は terminal 行を増やさないので数えない。

**依存するポート**: なし（`ensureRetryable` / `windowStart` は純関数。件数は呼ぶ側が読む）

### SameOriginPolicy

**責務**: 与えられた値が、どのオリジンに対して解決しても必ずそのオリジンに収まるアプリ相対パスかを判定する。「自オリジンに限る」判定の唯一の置き場で、呼び出し元は保存するアバターの位置（`AvatarUrl`）と、認可の往復のあとに再生する遷移先（[usecases/identity.md](../usecases/identity.md) の `startOAuthFlow` の `redirectTo`）の 2 つ。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `isSameOriginPath` | `value: string` | `boolean` | `/` で始まり、`//` で始まらず、バックスラッシュと C0 制御文字（`U+0000`〜`U+001F` と `U+007F`）を含まないなら `true` |

先頭が `/` で `//` ではないことだけでは足りない。URL パーサーは特別スキームでバックスラッシュを区切りとして扱い、解決の前に C0 制御文字を除去するため、`"/\evil.test/x"` や先頭スラッシュ直後に制御文字を挟んだ値は素朴な前置検査を通り抜けて**別オリジンへ解決する**。判定を 1 本に集めるのは、この 3 つの回避形の知識が片方の呼び出し元にしか反映されない状態を作れなくするためである。

真偽値だけを返し、違反をどう倒すかは呼び出し側が決める（`AvatarUrl.create` は `BusinessRuleError(InvalidAvatarUrl)`、`startOAuthFlow` は `ValidationError("INVALID_REDIRECT")`）。必要より厳しくてよく、同一オリジンへ解決する値でも制御文字を含めば拒否する（[ADR 051](../adr/051-same-origin-url-predicate.md)）。

**依存するポート**: なし（`isSameOriginPath` は純関数）

## ポート

### UserRepository

**目的**: UserId shard内の利用者集約の永続化。

```ts
interface UserRepository extends TransactionalRepository<User, UserId> {}

interface UserBatchReader {
  resolveMany(ids: readonly UserId[]): Promise<ReadonlyMap<UserId, Versioned<User>>>;
}

interface IdentityUniqueDirectory {
  resolve(kind: "email" | "handle" | "providerAccount", normalizedKey: string): Promise<UserId | null>;
  reserve(input: { kind: "email" | "handle" | "providerAccount"; normalizedKey: string; userId: UserId; operationId: string; expiresAt: Date }): Promise<void>;
  activate(operationId: string, expectedUserVersion: number): Promise<void>;
  beginRelease(input: { kind: "email" | "handle" | "providerAccount"; normalizedKey: string; expectedUserId: UserId; operationId: string }): Promise<void>;
  release(operationId: string): Promise<void>;
}
```

`UserRepository`はcurrent UserId shardの書き込み用であり、別shardのIDを受けない。`UserBatchReader.resolveMany`は入力最大100 UserIdをhash shard別にgroupingし、最大6接続のwaveでbatch readする。署名済みrouting generationを使い、reshard中は旧新を読み、UserIdごとにversionが大きい行を採る。入力IDから直接routeするため全User shard scanは行わない。入力が 100 件の上限を超えた場合は `SystemError(DatabaseError)` になる — 呼び出し側のプログラミングエラーであって並行状態の衝突ではないため `ConflictError` にはしない。`NoteRouteStore.resolveMany`（上限 500 件。[domains/note.md](./note.md)）と同じ契約である。

サイトマップに載せる「公開ノートを持つ利用者」の列挙は、公開ノートの有無を判定する必要があるため `NoteQueryService.listPublicAuthors` が担う。母集合は `/@:handle` の一覧（`searchPublicNotes` の `ownerFilter`）と同じ所有者基準で、`listPublicAuthors` が返す利用者 ID を `UserBatchReader.resolveMany` でハンドルに解決する（[usecases/identity.md](../usecases/identity.md) の `listPublicProfiles`）。

`IdentityUniqueDirectory` の行は `reserved` / `active` / `releasing` の 3 状態を取る。確保は 2 相で、`reserve` が正規化鍵を期限付きで operation に割り当て、所有 UoW の commit 後に `activate`（期待 User version を条件とする）が恒久 claim へ昇格させ、失敗時は `release` が解放する。**取り壊しも同じ 2 相の鏡像**であり、`beginRelease` が `active` の行を `releasing` にして解放側の operation へ付け替え、続く `release(operationId)` がその行を落とす。`beginRelease` を operation ID ではなく `normalizedKey` で引くのは、claim を作った operation はとうに終わっており、解放する側がその ID を再導出できないためである。取り壊しを 2 相にするのは、claim が索引であって資格ではなく（[ADR 038](../adr/038-provider-account-claim-and-identity-row.md)）、解放を促すイベントの配送が at-least-once だからである。下の「ドメインイベント」の `identity.identity.removed` が「global consumer が releasing→release する」と書いているのは、この 2 相のことを指す。

**非対称が 4 つある。取り違えない。**

- `resolve` は恒久 claim（`active`）の持ち主だけを返す。まだ `reserved` の鍵と、既に `releasing` の鍵は、どちらも `null` に見える
- `reserve` は `releasing` の行を**奪えない**。奪えるのは「`reserved` かつ期限切れ」の行だけで、`releasing` の鍵に対しては `ConflictError`（`EMAIL_ALREADY_USED` / `HANDLE_ALREADY_USED` / `PROVIDER_ACCOUNT_ALREADY_LINKED`）を返す。同じ operation ID からの再要求は冪等に期限を延ばすだけである
- `beginRelease` は `reserved` の行に対して **no-op**。取り壊す対象は恒久 claim だけである。予約を解放側へ付け替えると、続く `release` が `reserved` の行も落とすため、その予約を握って進行中の operation がサガの途中で鍵を失う。行が無い場合と別の利用者が持っている場合も同じく no-op で、解放要求が持ち主から鍵を奪うことはない
- `release` は当該 operation の `reserved` と `releasing` の行を落とす。`active` の行には触れない（恒久 claim の解放は必ず `beginRelease` を通る）

provider account の一意性は `IdentityUniqueDirectory` が**唯一の担保**であり、`IdentityRepository` は検査しない（claim は索引であって資格ではない — [ADR 038](../adr/038-provider-account-claim-and-identity-row.md)、[ADR 054](../adr/054-provider-account-uniqueness-owner.md)）。

**エラーケース**（`UserRepository`）: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`（版の不一致）、`ConflictError("EMAIL_ALREADY_USED")` / `ConflictError("HANDLE_ALREADY_USED")`（一意制約違反）、`SystemError(DatabaseError)`

**エラーケース**（`UserBatchReader`）: `SystemError(DatabaseError)`（入力 100 件の上限超過を含む）

**エラーケース**（`IdentityUniqueDirectory`）: `ConflictError("EMAIL_ALREADY_USED")` / `ConflictError("HANDLE_ALREADY_USED")` / `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`（鍵を別の operation が保持している。判定材料は operation ID であって利用者ではないので、同じ利用者の別 operation からの再予約も同じく衝突する。奪えるのは期限切れの `reserved` だけ）、`SystemError(DatabaseError)`

### IdentityRepository

```ts
interface IdentityRepository extends TransactionalRepository<Identity, IdentityId> {
  listByUserId(userId: UserId): Promise<readonly Identity[]>; // IdentityPolicyの不変条件により最大8件
}
```

`(provider, providerAccountId)` の一意性はここでは検査しない。担保は `IdentityUniqueDirectory` の claim 索引だけが持ち、`ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` を投げるのもそちらである（[ADR 054](../adr/054-provider-account-uniqueness-owner.md)）。バックエンドが DB 側に一意制約を置くのは自由だが、契約としては要求しない。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

### SessionRepository

```ts
interface SessionRepository {
  insert(session: Session): Promise<void>;
  findByTokenHash(userId: UserId, tokenHash: TokenHash): Promise<Session | null>;
  deleteById(id: SessionId): Promise<void>;
  refreshAuthEpoch(id: SessionId, userId: UserId, authEpoch: number): Promise<void>;
  deleteOlderEpochByUser(userId: UserId, currentEpoch: number, limit: number): Promise<number>;
  deleteExpired(now: Date, cursor: string | null, limit: number): Promise<Readonly<{ deleted: number; nextCursor: string | null }>>;
}
```

更新の口（`save`）を持たない。`Session` は絶対期限で、作成後に変わるフィールドがないため（上記「有効期間」）。

**エラーケース**: `SystemError(DatabaseError)`

### AuthTokenRepository

```ts
interface AuthTokenRepository {
  insert(token: AuthToken): Promise<void>;
  findByTokenHash(userId: UserId, tokenHash: TokenHash): Promise<AuthToken | null>;
  findPendingByUserAndPurpose(userId: UserId, purpose: AuthTokenPurpose): Promise<PendingAuthToken | null>;
  save(token: AuthToken): Promise<void>;
  deleteByUserAndPurpose(userId: UserId, purpose: AuthTokenPurpose, limit: number): Promise<number>;
  deleteOlderEpochByUser(userId: UserId, currentEpoch: number, limit: number): Promise<number>;
  deleteExpired(now: Date, cursor: string | null, limit: number): Promise<Readonly<{ deleted: number; nextCursor: string | null }>>;
}
```

`findPendingByUserAndPurpose` は、`auth_tokens` の (`user_id`, `purpose`) 部分一意索引（[database/index.md](../database/index.md) の `auth_tokens`）が保証する at-most-one live token を読む唯一の口である。「その利用者へ最後にトークンを発行したのはいつか」を答えるのがこの索引だけなので、再送間隔の判定はここを通す（`resendVerificationEmail` / `requestPasswordReset`。[usecases/identity.md](../usecases/identity.md)）。

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
  issueForUser(userId: UserId): { readonly token: string; readonly hash: TokenHash };
  locateUser(token: string): UserId | null;
  hashOf(token: string): TokenHash;
}
```

`token` は利用者に渡す値、`hash` は保存する値。`issue` の `token` は 256 ビット以上の乱数を URL 安全な文字列にしたもの。IdentityのSession/AuthTokenだけは`issueForUser`を使い、`base64url(UserId).256bit-secret`のlocator付き資格を発行する。`locateUser`は形式だけを検証してUserIdを返し、真正性は必ずtoken全体のhash照合で決める。UserId locator単体を認証済み主体として扱わない。

**エラーケース**: `SystemError(ExternalServiceError)`

### SignInOAuthClient

**目的**: サインイン用 OAuth プロバイダーとのやり取り。

```ts
interface SignInOAuthClient {
  deriveCodeChallenge(codeVerifier: string): string;   // PKCE S256。純粋・決定的
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

`deriveCodeChallenge` を `SecureTokenGenerator` ではなくここに置くのは、PKCE の challenge が S256 の**プロトコル規定の表現**（`base64url(sha256(verifier))`）であって、アダプターが自由に選べる保存用ハッシュではないからである。プロトコルを既に知っているポートに置くことで、application 層をハッシュ表現から解放する（[usecases/identity.md](../usecases/identity.md) の `startOAuthFlow` 手順 3 で「`codeChallenge` を算出する」主体がこれにあたる）。

**エラーケース**: `SystemError(ExternalApiError)`（通信・応答不正）、`ValidationError("OAUTH_CODE_INVALID")`（コードの期限切れ・不正）

### LoginAttemptStore

**目的**: 認証失敗の回数を `LoginAttemptKey` ごとに記録する。サインインの照合と共有リンクのパスワード照合が、名前空間で分離された鍵で同じ表を共有する。

```ts
interface LoginAttemptStore {
  get(key: string): Promise<LoginAttempt | null>;
  recordFailure(key: string, now: Date, ttlMs: number): Promise<LoginAttempt>;   // 加算後の値を返す
  clear(key: string): Promise<void>;
  deleteExpired(now: Date, cursor: string | null, limit: number): Promise<Readonly<{ deleted: number; nextCursor: string | null }>>; // pruneExpiredAuthState
}
```

`recordFailure` は失敗回数を 1 増やし、`lastFailedAt` を `now` に、`expiresAt` を `now + ttlMs` に書き直したうえで、**加算後の状態**を返す。行がなければ `failureCount: 1` で作る。呼び出し元は `signInWithPassword`（`recordFailure` / `clear`）と `verifySharePassword`（`recordFailure` / `clear`）、`pruneExpiredAuthState`（`deleteExpired`）。読み書きの順序は `LoginThrottlePolicy` の「読み書きの分担」に従う。

**契約: `recordFailure` は単一の原子的な操作でなければならない。読んでから書く実装を禁ずる。** `login_attempts`（[database/index.md](../database/index.md)）は集約ルートではないため楽観ロックが掛からず、素朴に実装すると並行した失敗が同じ `failureCount` を読んで同じ値を書き、要求を並列化するだけで施錠を回避できる。`LoginThrottlePolicy` のしきい値（3 回目から待機、10 回で 15 分ロック）はこの契約が満たされて初めて意味を持つ。

D1 ではこの契約を `INSERT … ON CONFLICT DO UPDATE SET failure_count = failure_count + 1, last_failed_at = ?, expires_at = ? RETURNING failure_count, last_failed_at` の 1 文で満たす。ロックの判定は書き込む値に含まれないため、しきい値の規則が SQL に漏れない。要件の正典は [presentation/index.md](../presentation/index.md) のレート制限の節。

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
| `identity.user.deleted` | `{ userId, deletionOperationId }` | cleanup完了の監査とglobal projectionの最終確認。scope cleanupの開始トリガーには使わない |
| `identity.identity.added` | `{ identityId, userId, kind }` | 監査 |
| `identity.identity.removed` | `{ identityId, userId, kind, providerAccountKey, operationId }` | providerAccount reservation解放。passwordではkey null、OAuthでは削除前に固定したnormalized keyをglobal consumerがreleasing→releaseする |
| `identity.identity.passwordChanged` | `{ identityId, userId }` | 監査（購読者なし。既存sessionの即時失効は [`changePassword`](../usecases/identity.md) / [`resetPassword`](../usecases/identity.md) がUserの`authEpoch`を同じ手順で進めて行う） |

`identity.passwordChanged` に失効の購読者を後から足してはならない。`changePassword` はUserの`authEpoch`を進めたtransactionで現在のSession 1行だけを新世代へ追随させるのに対し、購読側は「どのセッションが現在のものか」を知らない。`resetPassword` は追随させるsessionがないため全件が論理失効する。物理行の削除件数を認証安全性の切替点にしない。

サイトマップは購読で更新しない。`listSitemapEntries` / `listPublicProfiles` / `listPublicWorkspaces` が要求のたびに現在の状態から列挙する引き取り型のため、ハンドルの変更にイベント駆動の追随は要らない。公開ページのキャッシュについても、無効化の仕組みを本設計は持たない。

payload は変化の通知にとどめ、投影に必要な現在値を運ばない。global consumerは `note_routes(created_by, state, note_id)` をキーセットでページングし、各Noteのpublic再投影と、重複排除したscopeへのlocal author refresh commandを送る。active membershipだけを台帳にしないため、作成者がworkspaceから離脱した後も残るNoteを更新できる。各writerはcurrent Identity versionを含む完全snapshotを条件付きで置換する（[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）。

## エラーコード

```
IdentityErrorCode =
  | "InvalidId" | "InvalidEmail" | "InvalidHandle" | "HandleReserved"
  | "InvalidDisplayName" | "InvalidBio" | "InvalidAvatarUrl" | "WeakPassword"
  | "InvalidProviderAccount" | "TokenExpired"
  | "LastIdentityCannotBeRemoved" | "PasswordIdentityAlreadyExists"
  | "IdentityLimitExceeded" | "AccountDeletionRetryLimitExceeded"
```

## ユースケース（概要）

`signUpWithPassword`, `verifyEmail`, `resendVerificationEmail`, `signInWithPassword`, `startOAuthFlow`, `completeOAuthSignIn`, `completeOAuthCallback`, `linkOAuthIdentity`, `abandonOAuthFlow`, `authenticateSession`, `signOut`, `signOutOtherSessions`, `requestPasswordReset`, `resetPassword`, `addPasswordIdentity`, `changePassword`, `removeIdentity`, `listIdentities`, `updateProfile`, `getProfile`, `checkHandleAvailability`, `getPublicProfile`, `listPublicProfiles`, `deleteAccount`, `pruneExpiredAuthState`

詳細は [usecases/identity.md](../usecases/identity.md)。
