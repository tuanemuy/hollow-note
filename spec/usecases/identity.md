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

### Identity uniqueness の物理shard境界

email・handle・provider accountの作成/変更は、normalized key shardの `identity_unique_reservations` をoperation ID付きでreserveし、UserId shardのUser/Identityを更新してからactivateする。1つの親operationで複数keyを予約する場合は `reservationOperationId = sha256(parentOperationId + ":" + kind + ":" + normalizedKey)` を使い、各rowに別のIDを与える。User保存に失敗すれば確保済みsub-operationをすべてreleaseする。activate応答を失った場合はreservationとUser versionを読み、値が一致すればactivate、不一致ならreleaseする。複数予約の途中停止はoperation payloadに固定した全sub-operationを照合し、不足分reserve、正データ未commitなら全release、commit済みなら全activateへ収束させる。旧値は新値activate後にreleasingへ進めるため、途中停止は一時的な過剰予約にしかならない。sign-up、OAuth sign-in/link、email/handle変更はすべてこの共通状態機械を使い、User rowのUNIQUEとcross-shard transactionを前提にしない。

### 認証資格発行と削除開始の直列化

Session/AuthToken/Identityを新たに発行する全経路は、事前readの結果だけでinsertしない。UserId shardの最終UoW内でUserのstatusと`authEpoch`を読み直し、Sessionは`ActiveUser`、email verification tokenは`PendingUser`、password reset tokenとIdentity追加は`ActiveUser`である場合だけ、そのcurrent epochを行へ保存してinsertする。password sign-inは照合に使ったPasswordIdentityのversionも再検査する。status/epoch/identity versionが変わっていればinsertせず、各ユースケースの認証・削除中エラーへ戻す。

対象は`signUpWithPassword`、`verifyEmail`、`signInWithPassword`、`completeOAuthSignIn`のSession 4経路、sign-up/resend/password resetのAuthToken全経路、`linkOAuthIdentity`を含むIdentity追加経路である。`deleteAccount`の`ActiveUser → DeletingUser`と`authEpoch + 1`も同じUserId shardでcommitするため、資格発行と削除開始は直列化される。auth residue consumerが旧世代0件をackした後に旧世代行がlate insertされることはない。

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
3. `invitationToken` があればhashをglobal D1の `invitation_routes` でworkspace scopeに解決し、そのobjectの `InvitationRepository.findByTokenHash` を引く。`pending` かつ期限内かつemail一致なら確認済みで登録する
4. `IdentityUniqueDirectory.resolve("email", email.normalized)` がuserIdを返したら、利用者の存在を漏らさないため新規作成せず、既存通知を送って終了する。なければemail reservationを確保してからUserId shardへ作成する
5. `PasswordHasher.hash(password)` でハッシュを得る
6. 確認済みの経路なら `User.createVerified`、そうでなければ `User.create` を呼ぶ
7. `Identity.createPassword` を呼ぶ
8. `UnitOfWorkProvider.run` の中で `userRepository.insert` / `identityRepository.insert`を実行し、確認済みならSession、未確認ならemail verification AuthTokenも同じUserId shard UoWでcurrent status/epochを再検査してinsertする。イベントを `collectEvents` する
9. User/Identity commit後にemail reservationをactivateする。手順8が失敗したらreleaseする。activate応答を失った場合はUserId shardのUser email/versionを確認し、一致すれば同じsub-operation IDでactivate、不一致またはUser不在ならreleaseする
10. 確認済みの経路はUoWで作成済みのSessionの平文トークンを返す。有効期間は `Session.ttlMs`（30 日の絶対期限）をドメインが与える
11. 未確認ならUoWで作成済みAuthTokenの `MailSender.send({ kind: "emailVerification" })` をcommit後に送る

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 規約未同意 | `ValidationError("TERMS_NOT_ACCEPTED")` |
| メール形式・パスワード強度・表示名の違反 | `BusinessRuleError`（`InvalidEmail` / `WeakPassword` / `InvalidDisplayName`） |
| 招待トークンが無効・期限切れ・メール不一致 | 招待を無視して通常の登録として扱う（エラーにしない） |
| email reservationの競合 | `ConflictError("EMAIL_ALREADY_USED")` |
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

1. `SecureTokenGenerator.locateUser(input.token)`でUserId shardを決め、token全体のハッシュを求める。形式不正なら`NotFoundError("AUTH_TOKEN_NOT_FOUND")`
2. `AuthTokenRepository.findByTokenHash(userId, tokenHash)` で引く。存在しないか `purpose` が `email_verification` でなければ `NotFoundError("AUTH_TOKEN_NOT_FOUND")`
3. `status` が `consumed` なら、対象の利用者が既に `active` かを確認して `alreadyVerified: true` で返す（セッションは発行しない）
4. `UserRepository.findById` で利用者を引き、`token.authEpoch`がcurrent Userと違えば`NotFoundError("AUTH_TOKEN_NOT_FOUND")`
5. `AuthToken.consume(token, now)` を呼び、`PendingUser` なら `User.verifyEmail` を適用する（期限切れは `BusinessRuleError(TokenExpired)`）
6. `UnitOfWorkProvider.run` で利用者とトークンを保存し、同じUoWでactiveになったUser/current epochを再検査してSessionもinsertし、イベントを収集する。トークンの保存は `status = 'pending'` の行への条件付き更新であり（[domains/identity.md](../domains/identity.md) の `AuthTokenRepository`）、並行する要求が先に消費していれば `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` になる。この場合はSessionを含むtransactionを巻き戻したうえで手順 3 と同じ扱いに落とす
7. UoWで作成済みSessionの平文トークンを返す（有効期間は `Session.ttlMs`）

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

1. email directoryを解決し、返ったUserIdのshardからUserを引く。`PendingUser`以外なら何もせず返す
2. 直近 60 秒以内に同じ利用者へ発行していれば何もせず返す
3. 既存の `email_verification` pending tokenは1利用者・用途につき最大1件の一意制約下で、`AuthTokenRepository.deleteByUserAndPurpose(userId, purpose, 1)`で消す
4. UserId shard UoWで`PendingUser`とcurrent epochを再検査し、既存token削除と`AuthToken.issue`を同じtransactionで保存する。競合でPending以外へ変わっていれば何も送らず成功として返る。commit後に`MailSender.send({ kind: "emailVerification" })` を送る

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
3. email directoryを解決し、返ったUserIdのshardからUserを引く
4. 利用者がいない、`IdentityPolicy.findPassword` が `null`、または `PasswordHasher.verify` が偽のいずれかなら、`LoginAttemptStore.recordFailure(key, now, LoginThrottlePolicy.attemptTtlMs)` で失敗を**原子的に**記録し、`ValidationError("INVALID_CREDENTIALS")`。返ってきた加算後の記録を `evaluate` し、次が待機・ロックに当たるなら `ValidationError("THROTTLED")` / `ValidationError("LOCKED")` に切り替える（待機秒数・解除時刻はこの `ThrottleDecision` から取る）
5. 利用者が `PendingUser` なら `ValidationError("EMAIL_NOT_VERIFIED")`（失敗として記録しない。資格情報は正しく、再送すれば通る状態のため）
6. 利用者が`DeletingUser`なら`ValidationError("ACCOUNT_DELETING")`、`DeletedUser`なら`ValidationError("INVALID_CREDENTIALS")`。どちらもSessionを発行しない
7. `LoginAttemptStore.clear(key)` で失敗の記録を消す
8. `ActiveUser`のcurrent `authEpoch`で`Session.create`を作って保存し、平文トークンを返す（有効期間は `Session.ttlMs`）

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
2. `intent === "linkIdentity"` で `userId` が `null` なら `ValidationError("USER_REQUIRED")`。指定時はUserId shardで`ActiveUser`を確認し、current `authEpoch`を読む
3. `state` と `codeVerifier` を `SecureTokenGenerator.issue` で作り、`codeChallenge` を算出する
4. `OAuthStateStore.put(state, flowState, 10 分)` で保存する。`linkIdentity`は認証済み`userId`と取得した`userAuthEpoch`を必ず保存し、`signIn`は両方`null`にする
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
3. providerAccount directoryを解決し、返ったUserId shardで既存IdentityとUserを確認する。既存Userが`ActiveUser`ならその利用者でセッションを発行して終了し、`DeletingUser` / `DeletedUser`なら`ValidationError("ACCOUNT_UNAVAILABLE")`として発行しない
4. email directoryを解決し、返ったUserId shardのUserを引いて `AccountLinkingPolicy.decide` で判定する
5. `createNew` → 親operationからemail/providerAccount別のsub-operation IDを導出して両reservationを確保し、UserId shardで `User.createVerified` と `Identity.createOAuth` を保存後に両方activateする。2つ目のreserveまたはUser保存が失敗したら確保済みreservationをすべてreleaseする。応答喪失時は両reservationとUser/Identity versionを照合し、正データcommit済みなら不足分をreserveして両方activate、未commitなら両方releaseする
6. `linkToExisting` → providerAccount reservationを確保し、既存UserId shardで `Identity.createOAuth` を保存後にactivateする
7. `refuse` → 理由に応じた `ValidationError` を返す
8. 既存Userの各分岐はUser/IdentityをUserId shard UoWで読み直し、`ActiveUser`とcurrent epoch（および既存Identity version）を確認し、current Identity集合へ`IdentityPolicy.ensureAddable`を適用してからIdentity追加とSession insertを同じtransactionで行う。上限8件ならreservationをreleaseして`BusinessRuleError(IdentityLimitExceeded)`を返す。新規分岐もUser/Identity/Sessionを同じUoWでinsertする。作成済み平文トークンと `redirectTo` を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `state` の不一致・期限切れ | `ValidationError("OAUTH_STATE_INVALID")` |
| コード交換の失敗 | `ValidationError("OAUTH_CODE_INVALID")` / `SystemError(ExternalServiceError)` |
| プロバイダー側のメール未確認 | `ValidationError("OAUTH_EMAIL_UNVERIFIED")` |
| 既存利用者がメール未確認 | `ValidationError("EXISTING_ACCOUNT_UNVERIFIED")` |
| 紐づけ先が別の利用者 | `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`（providerAccount reservationの競合） |
| 既存利用者の認証手段が8件 | `BusinessRuleError(IdentityLimitExceeded)` |

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
3. providerAccount directoryを解決し、別userIdのactive/reserved行があれば `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`。なければreservationを確保する
4. UserId shard UoWでUserとcurrent Identity集合を読み直し、`ActiveUser`かつcurrent epochがflow stateの`userAuthEpoch`と一致し、`IdentityPolicy.ensureAddable`を満たすことを確認してから `Identity.createOAuth` を保存する。削除開始済み・世代不一致・上限8件なら保存せずreservationをreleaseする。成功後にreservationをactivateする

### エラーケース

`completeOAuthSignIn` と同じ分類に加え、`NotFoundError("USER_NOT_FOUND")`。認証手段が8件なら`BusinessRuleError(IdentityLimitExceeded)`。

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

1. `SecureTokenGenerator.locateUser(token)`でUserId shardを決め、形式不正なら`ValidationError("UNAUTHENTICATED")`。続いてtoken全体を`hashOf`する
2. `SessionRepository.findByTokenHash(userId, tokenHash)` が `null` なら `ValidationError("UNAUTHENTICATED")`
3. `Session.isExpired` が真なら削除して `ValidationError("UNAUTHENTICATED")`
4. `UserRepository.findById` で利用者を引く。不在なら `ValidationError("UNAUTHENTICATED")`
5. Userが`active`でない、または`Session.authEpoch !== User.authEpoch`なら`ValidationError("UNAUTHENTICATED")`。古いSession行の削除はbest effortで、認証結果を左右しない

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

なし（Cookieの破棄はpresentation層が成功応答に合わせて行う）。

### 処理フロー

1. `locateUser(sessionToken)`でUserId shardを決め、token全体をハッシュして`SessionRepository.findByTokenHash(userId, tokenHash)`で引く。あれば `deleteById` する。locator形式不正も不在と同じに扱う
2. 見つからなくてもエラーにしない

### エラーケース

なし（常に成功）。

## signOutOtherSessions

### 概要

現在のセッション以外をすべて破棄する（AC-08）。

### 入力DTO

`userId: string`, `currentSessionToken: string`

### 出力DTO

`revocationAccepted: true`

### 処理フロー

1. `locateUser(currentSessionToken)`でUserId shardを決め、token全体のhashから現在のセッションとcurrent Userを引き、入力`userId`との一致・期限・`authEpoch`一致を検査する
2. Userの`authEpoch`を1進め、同じUserId shard transactionで現在のSession 1行だけを`refreshAuthEpoch`して新世代へ追随させる。これをcommitした時点で他sessionは件数に依らず即時失効する
3. 旧世代の物理行は`identity.userAuthResidueCleanupContinued { userId, authEpoch, table: "sessions" }`で1回100件ずつ回収する。応答は削除件数ではなく`revocationAccepted: true`を返す

cleanup consumerはUserを読み直してpayloadの`authEpoch`以下へ戻っていないことを確認し、payloadの`table`に対応する`deleteOlderEpochByUser(userId, authEpoch, 100)`だけを1回呼ぶ。100件ならpage削除と同じtransactionで同じtableの決定的taskを再登録する。`sessions`が100件未満なら同じtransactionで`table: "authTokens"`のtaskへ置換し、`authTokens`が100件未満なら終了する。新世代行は削除しない。account deletion由来では`authTokens`の0件確認後だけauth residue ackをdistributed operationへ記録し、finalizeの必須条件にする。table切替の応答喪失も保存済みtask phaseから再開する。

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

1. email directoryを解決し、返ったUserId shardのUserを引く。不在または`ActiveUser`以外なら何もせず返す
2. `IdentityPolicy.findPassword` が `null` なら `MailSender.send({ kind: "passwordResetUnavailable" })` を送って返す
3. 既存の`password_reset` pending tokenは部分一意制約下で`deleteByUserAndPurpose(userId, purpose, 1)`により消す
4. UserId shard UoWで`ActiveUser`とcurrent epochを再検査し、既存token削除と`AuthToken.issue(purpose: "password_reset")`を同じtransactionで保存する。commit後に`MailSender.send({ kind: "passwordReset" })` を送る

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

1. token locatorからUserId shardを決め、トークン全体をハッシュで引く。current Userが`ActiveUser`であること、用途・状態・`authEpoch`一致を検査し、それ以外は`NotFoundError("AUTH_TOKEN_NOT_FOUND")`
2. `AuthToken.consume` を呼ぶ
3. `PlainPassword.create(newPassword)` と `PasswordHasher.hash` を実行する
4. `IdentityPolicy.findPassword` で対象の認証手段を得る。存在しなければ `Identity.createPassword` を作る
5. UserId shard UoWでUser/token/Identityを読み直し、`ActiveUser`・token epoch/status・Identity versionを再検査してから`Identity.changePassword`、トークン消費、Userの`authEpoch + 1`を保存する。トークンの保存が競合した場合はパスワードと世代の差し替えごと巻き戻す。commit時点で全セッションは件数に依らず即時失効する
6. `identity.userAuthResidueCleanupContinued { userId, authEpoch, table: "sessions" }`を保存し、Session/AuthTokenの旧世代行を各100件ずつ物理回収する

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

1. `IdentityRepository.listByUserId` を引き、`IdentityPolicy.ensureAddable`と`ensurePasswordAddable`を呼ぶ。最終UserId shard UoWでもcurrent集合に対して両方を再検査する
2. `PlainPassword.create` と `PasswordHasher.hash` を実行する
3. `Identity.createPassword` を作って保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 既にパスワード手段がある | `BusinessRuleError(PasswordIdentityAlreadyExists)` |
| 認証手段が8件 | `BusinessRuleError(IdentityLimitExceeded)` |
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
2. `currentSessionToken`のlocator/hashからcurrent Sessionを引き、入力UserId・期限・`authEpoch`一致を検査する。不正なら`ValidationError("UNAUTHENTICATED")`。続いて`PasswordHasher.verify(currentPassword, hash)` が偽なら `ValidationError("INVALID_CREDENTIALS")`
3. `PlainPassword.create(newPassword)` と `PasswordHasher.hash` を実行する
4. `Identity.changePassword`、Userの`authEpoch + 1`、現在のSession 1行の`refreshAuthEpoch`を同じUserId shard transactionで保存する。commit時点で現在以外の全sessionが即時失効する
5. `identity.userAuthResidueCleanupContinued { userId, authEpoch, table: "sessions" }`を保存し、旧世代行を100件ずつ物理回収する

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
3. `operationId = sha256("removeIdentity:" + identityId)`を導出する。UserId shardの同じUoWで `identityRepository.delete`、30日保持の`identity_removal_receipt`、`identity.identity.removed { identityId, userId, kind, providerAccountKey, operationId }` outboxを保存する。passwordではproviderAccountKeyをnullにする
4. global consumerはOAuth eventのproviderAccountKeyを使ってreservationをreleasing→releaseする。event再配送はoperation IDで冪等にし、正データ削除後にだけ解放する。手順3の応答を失って同じ要求が来た場合はreceiptを読み、削除済み成功を返す。したがってIdentity不在後にkeyを復元する必要がなく、consumer停止は一時的な過剰予約にだけなる

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

`identities: { id: string; kind: "password" \| "oauth"; provider: string \| null; accountLabel: string \| null; createdAt: Date }[]`（最大8件）, `removable: boolean`

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
2. handleを新規設定/変更するならnormalized handle reservationをoperation ID付きで確保する。別userのactive/reserved行があれば `ConflictError("HANDLE_ALREADY_USED")`
3. `User.updateProfile` を適用し、`handle` の指定があれば `User.assignHandle` または `User.clearHandle` を続けて適用する
4. UserId shardのUoWで保存し、成功後にreservationをexpected User versionでactivateする。旧handleはその後releasingへ進める。`displayName` が変わったときはprofile eventを発行する

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
2. handle directoryを解決し、返ったUserId shardのUserを引く。`null` または `PendingUser` なら `NotFoundError("USER_NOT_FOUND")`

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 形式違反・不在・未確認 | `NotFoundError("USER_NOT_FOUND")`（区別しない） |

## listPublicProfiles

### 概要

サイトマップ用に、公開ハンドルを持つ利用者を列挙する（DS-06）。

### 入力DTO

`cursor: string | null`, `limit: number`（既定100、最大100）

### 出力DTO

`entries: { handle: string; updatedAt: Date }[]`, `nextCursor: string | null`

### 処理フロー

1. `NoteQueryService.listPublicAuthors(cursor, limit)` を引く。**個人所有**（`owner_type = "user"`）で公開かつ有効なノートを 1 件以上持つ利用者について、`{ userId, updatedAt }`（`updatedAt` はその利用者の個人所有の公開ノートの最新更新時刻）が `userId` の昇順で返る。cursorはpublic shard generationと各shard位置を含む署名opaque値である
2. page内最大100 UserIdを`UserBatchReader.resolveMany`でhash shard別に最大6接続で解決し、`handle` が未設定の利用者は落とす（`/@:handle` を持たないため）。読み取りモデルは所有者のハンドルを列に持たないので、解決はここで行う
3. `nextCursor` はquery serviceが返したopaque cursorをそのまま返す

母集合は所有者基準に統一する。`/@:handle` の一覧は `searchPublicNotes` が `ownerFilter: { type: "user", userId }` で引く所有者基準の集合であり、サイトマップに載せる利用者の集合はそれと一致しなければならない。著者基準（`created_by` / `author_handle`）で列挙すると、ワークスペース所有の公開ノートしか作っていない利用者がサイトマップに現れる一方その `/@:handle` は 0 件になり、空の公開ページを量産する。逆に、ワークスペースから個人へ移したノート（作成者は別人のまま）を持つ利用者は所有者基準でのみ拾える。

### エラーケース

`SystemError(DatabaseError)`、`ValidationError("INVALID_PAGINATION")`

## deleteAccount

### 概要

アカウントと関連データを削除する（AC-09）。

### 入力DTO

`{ type: "userRequest"; userId: string; confirmationEmail: string; requestId: string } | { type: "identity.accountDeletionManifestBuildContinued"; operationId: string; phase: "memberships" | "authorRoutes" } | { type: "identity.accountDeletionDispatchContinued"; operationId: string; phase: "prepare" | "rollbackRelease" | "cleanup" | "redaction" | "finalize" } | { type: "identity.accountDeletionManifestCompactContinued"; operationId: string } | { type: "identity.accountDeletionManifestPruneContinued"; runId: string; generation: string; shardId: string; cursor: string | null; asOf: Date } | { type: "identity.personalBarrierPruneContinued"; scope: ScopeKey; asOf: Date }`

### 出力DTO

userRequest / operation continuationは`operationId: string`, `status: "accepted"`。`identity.accountDeletionManifestPruneContinued` / `identity.personalBarrierPruneContinued`はinternal handlerで外部DTOを返さない。

アプリケーション層はoperation IDと`accepted`だけを返す。presentation層がこれを30分の読み取り専用status ticketへ署名し、HTTP 202の応答へ追加する。同じ`requestId`の再要求は進行中/terminalの同じoperation IDを返し、terminal結果はstatus ticketで読む。rejected後に唯一owner問題などを解消して再試行する場合は、再確認画面が新しい`requestId`を発行し、新しい削除operationを作れる。rejected operation/manifestは同じkeyのreplay用に120日保持し、その後同じUserId-shard transactionで回収する。completed後はUserがdeletedなので新operationを作らない。

### 処理フロー

1. `userRequest`だけが`UserRepository.findById`と`confirmationEmail` / UUID `requestId`を検査する。operation continuationは利用者認証/確認入力を再要求せず、UserId shardのdistributed operation/manifest owner・stateから再開する。account manifest pruneは固定run/generation/shard/asOf/cursor、personal barrier pruneは固定scope/asOfだけでterminal rowを回収し、operation ownerを要求しない
2. UserId shard transaction で User を `deleting` にして`authEpoch + 1`へ進め、`distributed_operations(kind: "accountDeletion", partitionKey: userId, requestKey: requestId, state: "preparing")` を作る。同じrequest keyなら既存operationを返し、別request keyでもrunning operationがあればそれを返す。rejected後の新request keyだけが新operationを作れるが、120日保持中のrejected attemptは利用者ごとに最大8件とし、8件なら`BusinessRuleError(AccountDeletionRetryLimitExceeded)`で新operationを作らない。続いてpersonal scope DOへbarrier commandを送り、`beginPersonalAccountDeletion(operationId, userId)`とreceiptを同じlocal transactionで保存したackを待つ。DO直列化により先行中のNote/Tag/Storage/Usage/Integration/Job writeはbarrier前に確定して後続scanが拾い、barrier後は全通常write入口の`assertWritable`が`ACCOUNT_DELETING`で拒否する。cleanup tokenだけが`assertOwner`で通る。barrier ack前にprepare/destructive cleanupへ進まない。事前検査でactiveへ戻す場合も世代は巻き戻さずbarrierをreleaseして再サインインを要求する
3. orchestrator はUserId shardのaccount deletion manifestを100件pageで構築する。Userをdeletingにした時点で新しいmembership activation claimは閉じている。まず`MembershipDirectoryReservationStore.listActivatingByUser(userId, 100)`で先行accept Sagaを有界に回復し、activating edgeが0件になるまでmanifest scanを開始しない。active/abandonedへ収束後、`appendMembershipPage`が`membership_directory`のactive/removing/pending edgeをedge key順に固定し、page/cursor/次のbuild continuationを同じtransactionで保存する。membership固定後、`claimPending(..., "prepare", 100)`が決定的prepare command keyと`prepareDispatchedAt`を送信前に保存し、そのpageを最大6 workspace waveで処理する。active edgeはMembership version/owner lockに加えて当該actorの全通常writeをlocal commit時に閉じるbarrier、removing edgeは先行cleanup完了待ち、pending edgeは`MembershipDirectoryReservationStore.prepareAccountDeletion`でreservation変更を閉じるprepare lockを取得する。pending reservationの取消はcommit後のcleanupで行い、prepare中は破壊しない。itemごとのprepare ackと次のdispatch continuationを同じUserId-shard transactionで保存する

   全membership barrier ack後だけ`NoteRouteFanOutReader.listByCreatedBy(userId, cursor, 100)`のauthor route固定へ進む。これによりbarrier前に確定したin-flight workspace writeはroute scanが拾い、barrier後は新しいcreatedBy routeが増えない。route readerは最大32 shard・同時6接続の署名generation cursorで読み、page item/cursor/次build continuationをmanifestへ冪等appendする。全route固定後にmarkBuiltする。operation payloadへ全ID配列を載せない。1scopeでもprepare不能なら全workspace barrier/personal barrierをreleaseしてrollbackへ進み、redactionを含むdestructive cleanupは始めない
prepare leaseはTTL 10分で2分ごとにrenewする。全ack後も残存5分以上を確認し、全scope lockを非失効の`committed`へ進めてからdestructive cleanupを始める。renew失敗時はcommitへ入らずrecoveryを待つ。期限切れprepared lockはmembership操作側が無視せず、global recoveryがD1 operation stateに従ってrenewまたはreleaseする。

prepareが1scopeでも失敗した場合は`beginRollback`でmanifestを`rollingBack`へ進める。`claimPending(operationId, "release", 100)`はprepare dispatched済みでrelease未ackのmembership itemをprepare ack有無にかかわらずclaimし、決定的release command key/`releaseDispatchedAt`を保存してから最大6 workspace接続のwaveでlock releaseを冪等配送する。prepareがremote commit後・中央ack前に止まっていても対象に含み、実際にはlock未取得だったitemへのreleaseはno-op ackになる。各release ack pageと次`rollbackRelease` continuationを同じUserId-shard transactionで保存する。personal scopeの`abortPersonalAccountDeletion(operationId)`も`personalAbort` receiptとして再送可能にする。`allRollbackReleased`が全workspace release ackとpersonal abort ackを確認した後だけUserを`active`へ戻してmanifestを`compactingRejected`へ進める。同じcompact continuationでitemsを1turn100件ずつ消し、item 0件のtransactionでmanifestとoperationを`rejected`にして`expiresAt = now + 120日`を設定する。barrier解除応答を失った場合はoperation IDで再送し、全release ack前およびmanifest縮約前はactive/rejectedの終端結果を公開しない。destructive cleanup開始後はabortしない。

pending edge itemのprepare/release/cleanupはそれぞれ`MembershipDirectoryReservationStore.prepareAccountDeletion` / `releaseAccountDeletion` / `commitAccountDeletion`を使う。active edgeのworkspace-local lockと同じdeletion operation IDで管理し、rollbackはpending reservationを元の状態へ戻し、commit後だけ取消す。

rollback compactionのitem 0件transactionは`markRejected(operationId, now, now + 120日)`を呼び、headerとmatching distributed operationへ同じterminal時刻/期限を設定する。

4. author route manifest完成後にだけoperationを`committing`へ進め、`claimPending`で各phase最大100 itemのcommand key/dispatchedAtを送信前に保存し、外部scope最大6接続のwaveに分けてcommandを配送する。各ack pageと残件がある場合の次`identity.accountDeletionDispatchContinued`を同じUserId-shard transactionで保存する。各 scope object は operation ID を `applied_operations` で重複排除し、100件ずつ `scheduled_tasks` / Alarm で継続する
   - personal scope: scope 内 Job を強制終端し、その後始末、Note / Tag / Storage / Backup / Usage の削除を1つの local transaction列として完了させる
   - 各 workspace scope: prepared lockを確認し、`requestedBy = userId` のactive Jobを強制終端してJob正データとBackupRecordを削除し、残るノートの著者表示を「退会した利用者」に更新してからMembershipを削除する。`MembershipRemovalPreparationStore.commit`も同じlocal transaction列で完了する
   - global cleanup: Session/AuthTokenの物理行を各100件ずつ、ExternalConnection、global job history、public projection の著者表示を処理し、Userのhandle / emailと最大8件のIdentityに対応する全OAuth providerAccount reservationを最大6接続のwaveでfinalize時にreleasing→releaseする。`identity.userAuthResidueCleanupContinued { userId, authEpoch, table, deletionOperationId }`は各page/phaseを保存し、AuthToken残件0のack前はfinalizeしない。応答喪失はoperation payloadに固定したkeyから再開する
   - author redaction: manifestに固定した各authorRoute itemへ `projection.authorRedactionRequested { noteId, userId, redactionVersion, operationId }` をlocal/publicそれぞれ送り、plane別ackをitemへ保存する。redactionVersionはcommit開始時に固定し、旧Identity versionより大きい。routeが移動していればcurrent routeへ再解決し、purged/tombstoneなら両planeをackする
   personal scopeはoperation専用barrier resultに`job` / `note` / `tag` / `storage` / `backup` / `usage` / `localProjection` / `outbox`の8 component ackを持つ。各componentの最終pageは、残件があれば次task、0件なら自身のackを同じscope-local UoWで保存する。localProjectionは削除由来のlocal投影task、outboxは削除由来eventの必須配送ackだけを追い、unrelated task/outboxが空かどうかでは判定しない。全8 ackが揃った最後のscope-local UoWで`ScopeCleanupAdmissionStore.markCompleted(operationId, now + 120日)`と期限時刻の`identity.personalBarrierPruneContinued` task保存を実行する。そのcommit ackを受けた後だけUserId shard manifestへ`personalCleanup` receiptを記録する。prune分岐は固定`asOf`でcompleted receiptを最大100件削除し、100件なら同じscope Alarm taskを再登録する。running barrierを完了前に縮約せず、DO応答喪失時は同じoperation IDで完了確認を再送する
5. `finalize` continuationはmanifestの全membership cleanup ack・全authorRoute plane ack、`personalCleanup`、auth residue・ExternalConnection・global job history・全uniqueness releaseを含む必須receiptを検査する。揃えばuser coordination shard transactionでdirectory edgeとPIIを削除し、Userを`deleted` tombstoneにしてeventを発行する。D1と複数DOを同じtransactionに入れない。その後compact continuationがitemsを1turn100件ずつ消し、残件中は同じtaskを保存し、item 0件のtransactionだけがheaderをcompletedへ移して`expiresAt = now + 120日`を設定する。prepare rejectionも`compactingRejected`から同じbounded workerを使い、0件時だけrejectedへ移る。global recovery Cronはhour bucket・`accountManifestPrune`・current UserId routing generationsからmaintenance runを開始/再開する。各`identity.accountDeletionManifestPruneContinued` laneは固定runId/generation/shardId/asOfと`(expiresAt, operationId)` cursorを持ち、current UserId shardのterminal headerを最大100件だけ回収する。target shard DELETE後はrun checkpoint/次Queue outboxをrouting catalog transactionで保存し、最大32 shard・同時6 lane、全shard ackでrunをcompletedにする。running/building/compacting manifestは回収しない

成功compactionのitem 0件transactionは`markCompleted(operationId, now, now + 120日)`を呼ぶ。terminal prunerはmatching manifest headerとdistributed operation/request keyを同じUserId-shard transactionで削除する。

active noteMoveが同userをactor/source/targetに持つ場合、scope cleanup前にD1 operationを確認し、switch前ならabort、switch後ならforward完了を待つ。personal targetのmove lockもaccount deletionと競合させる。

後始末の責務は次のとおり。表の各ユースケースは global event を直接購読して全 shard を走査するのではなく、上記 orchestrator が対象 scope を明示した command として呼ぶ。

| ドメイン | scope / global cleanup | 責務 |
| --- | --- | --- |
| Note | [`deleteNotesForOwner`](./note.md) | 個人所有ノートと版・読み取りモデルの削除。1 件ずつ `note.purged` を発行し、タグ付与・保管ファイル・バックアップ記録の後始末につなぐ（ワークスペース所有ノートは残る — AC-09） |
| Note（読み取りモデル） | [`projectNoteChanges`](./note.md) | `note_routes(created_by)`をbounded pageで列挙し、Identity tombstone version付き完全snapshotへ個別再投影する。行は消さず旧PIIを復活させない |
| Tag | [`deleteTagsForScope`](./tag.md) | 個人スコープのタグと付与の削除（`TagRepository.deleteByScope`） |
| Workspace | [`deleteMembershipsForUser`](./workspace.md) | orchestrator が指定した workspace scope でのmembership削除と最終owner再検査 |
| Integration | [`deleteIntegrationsForUser`](./integration.md) | global connection削除と、対象scopeごとのbackup記録削除 |
| Job | [`deleteJobsForRequester`](./job.md) | 対象scopeで強制終端後のJob正データを削除し、global history削除eventを発行 |
| Storage | [`deleteFilesByOwner`](./storage.md) | 個人所有ファイルの削除 |
| Usage | [`deleteQuota`](./usage.md) | クォータ行の削除 |

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 確認入力の不一致 | `ValidationError("CONFIRMATION_MISMATCH")` |
| requestIdがUUID形式でない | `ValidationError("INVALID_REQUEST_ID")` |
| 120日保持中のrejected attemptが8件 | `BusinessRuleError(AccountDeletionRetryLimitExceeded)` |
| 唯一の owner であるワークスペースがある | `BusinessRuleError(LastOwnerCannotLeave)` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## pruneExpiredAuthState

### 概要

期限切れの認証状態（セッション・認証トークン・ログイン試行・認可フロー状態）をまとめて回収する。定期ワーカーから呼ばれる。

### 入力DTO

`{ type: "cron" } | { type: "identity.authStatePruneContinued"; runId; generation; shardId; table: "sessions" | "authTokens" | "loginAttempts" | "oauthFlowStates"; cursor: string | null; asOf: Date } | { type: "global.maintenanceRunPruneContinued"; cursor: string | null; asOf: Date }`。初回だけ`clock`から`asOf`を固定する。最後の分岐はauth/job/account-manifestの3種のCronが発行する共通maintenance run回収taskの唯一の購読者である。

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `sessions` | `number` |
| `authTokens` | `number` |
| `loginAttempts` | `number` |
| `oauthFlowStates` | `number` |
| `continued` | `boolean` |

### 処理フロー

1. `type: "global.maintenanceRunPruneContinued"`なら`GlobalMaintenanceRunStore.pruneCompleted(asOf, cursor, 100)`だけを呼ぶ。100件なら同じ固定`asOf`とnext cursorを持つ次taskをcatalog transactionで保存し、100件未満なら終了する。`expiresAt <= asOf`を対象とし、running runは除外する。応答喪失時は同じcursorから冪等に再実行する。`type: "cron"`ならこの共通prunerの初回taskを発行し、続いてhour bucket・kind・current routing generationsから決定的`candidateRunId`を作り、`beginOrResumeKind`する。同kindのrunning runがあればhourをまたいでも新runを作らず、その最古runの固定`runId` / `asOf` / generation positionを再開する。新規または期限切れleaseの回復時だけ未claim shardから最大6件のcontinuationを起動し、lease中再入はno-op。auth continuation入力ならpayloadの固定値から再開する。最大32 shardをkind全体のactive lane 6本で処理し、reshard中は旧新を別positionとして対象にする
2. 1 commandは1 shard・1表だけを選び、各portの`deleteExpired(asOf, cursor, 100)`を1回だけ呼ぶ。Session/AuthTokenは`(expiresAt, id)`、LoginAttemptは`(expiresAt, key)`、OAuthStateは`(expiresAt, state)` keysetの`nextCursor`を返す。target shardのDELETEとは別に、run storeの`checkpointLane`が次table/cursor/決定的command keyと次Queue outboxをrouting catalog transactionで保存する。DELETE後・checkpoint前の応答喪失は同じ入力cursorのDELETEを再実行する。100件なら同じlaneの次cursor、100件未満なら次表、全4表完了ならrun storeへshard ackして未claim shardを1件取得する。全shard ackでrunをcompletedにする
3. `authenticateSession` は期限または世代不一致を常に `UNAUTHENTICATED` として扱う。AuthTokenの単回性も消費時の条件付き更新と世代検査が担保するため、物理回収の進み具合は認証結果を変えない
4. LoginAttemptの保持24時間は15分のロックより長く、期限切れ回収がロックを早めない。OAuth stateはIdentity/Integration両intentを同じ有界処理で覆う
5. 表ごとの失敗はその継続をbackoffして他shard/tableの最低枠を妨げない。1 invocationは全体100 operationsまたは400 queriesでyieldし、cursorをD1へ保存してQueue continuationへ渡す。出力countは当該invocationで消した件数（未処理tableは0）、次taskがあれば`continued: true`

各delete自体に横断Unit of Workは使わない。global continuation cursorの更新だけはそのrouting catalog shardで原子的に保存し、応答喪失時は同じkeysetから再実行する。

冪等性: すべて「期限を過ぎた行の削除」であり、2 回目以降は 0 件で終わる。境界は `expiresAt <= now`（`Session.isExpired` / `AuthToken.isExpired` と同じ判定）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の削除の失敗 | 記録して継続 |
| 4 つすべての削除が失敗 | `SystemError(DatabaseError)` |
