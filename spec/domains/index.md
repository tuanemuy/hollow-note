# ドメイン一覧

境界の切り方と依存方向は [ADR 008](../adr/008-domain-boundaries.md) に従う。

## ドメイン

| ドメイン | 責務（一文） | ファイル |
| --- | --- | --- |
| Identity | 利用者を識別し、認証手段とセッションの正当性を保つ | [identity.md](./identity.md) |
| Workspace | 共同作業の場と、そこでの権限を管理する | [workspace.md](./workspace.md) |
| Note | ノートの本文・所属・公開範囲とその変遷を保つ | [note.md](./note.md) |
| Tag | ノートを分類する語彙を管理し、ノートへの付与を保つ | [tag.md](./tag.md) |
| Storage | バイト列を預かり、保管先と参照可能性を保証する | [storage.md](./storage.md) |
| Conversion | ファイルの形式を判定し、HTML 断片へ変換する | [conversion.md](./conversion.md) |
| Integration | 外部サービスとの連携状態と資格情報を保つ | [integration.md](./integration.md) |
| Job | 非同期処理の状態・進捗・再試行・キャンセルを管理する | [job.md](./job.md) |
| Usage | 保存容量と LLM 実行回数の消費と上限を管理する | [usage.md](./usage.md) |

## 依存方向

矢印は「参照する側 → 参照される側」。参照はすべて ID による。

| ドメイン | 依存先 | 参照している主な型 |
| --- | --- | --- |
| Identity | （なし） | — |
| Workspace | Identity | `UserId`, `Email`, `TokenHash` |
| Storage | Identity, Workspace, Note | `UserId`, `WorkspaceId`, `NoteId` |
| Conversion | Storage | `StoredFileId`, `FileName`, `MimeType`, `ByteSize` |
| Note | Identity, Workspace, Storage, Conversion | `UserId`, `WorkspaceId`, `WorkspaceRole`, `TokenHash`, `PasswordHash`, `StoredFileId`, `ConversionFailureReason` |
| Tag | Identity, Workspace, Note | `UserId`, `WorkspaceId`, `NoteId`, `NoteOwner` |
| Integration | Identity, Storage, Note | `UserId`, `StoredFileId`, `Checksum`, `FileName`, `MimeType`, `ByteSize`, `NoteId` |
| Job | Identity, Workspace, Storage, Note | `UserId`, `WorkspaceId`, `StoredFileId`, `NoteId` |
| Usage | Identity, Workspace, Storage, Note | `UserId`, `WorkspaceId`, `StorageOwner`, `NoteOwner` |

依存の深さ順に並べると `Identity → Workspace → Storage → Conversion → Note → {Tag, Integration, Job, Usage}` となる。この並びで唯一の逆向きが Storage → Note で、`Note.sourceFileId`（`StoredFileId`）と `StoredFile.noteId`（`NoteId`）は ID による相互参照を持つ。どちらも相手の ID 値オブジェクトを参照するだけで相手の集約を読まず、外部キーも張らない（[database/index.md](../database/index.md) のドメイン跨ぎの参照）。所属ファイルの回収は `note.purged` を購読する `deleteFilesForNote` が行い、参照先が消えた `sourceFileId` は「対象が存在しない」として扱う。後始末がイベント駆動で完結し、片方が欠けても他方の不変条件が壊れないため、集約の独立性は保たれる。Note は Tag を知らない。Conversion は Integration を知らず、LLM の呼び出しは Conversion が定義した `StructuringModel` / `TranscriptionModel` ポートを Integration 側のアダプターが満たす形で解決する。

Note は Job も知らない。Job → Note の依存が既にあるため、Note から Job を参照すると循環する。`JobId` を含む PDF エクスポートのチケット（`ExportTicket`）は Note の不変条件に関与しないので、ドメインではなくアプリケーション層の型として定義してこの向きを保つ（[usecases/note.md](../usecases/note.md) の「共通: ExportTicket」、[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。実行中ジョブの有無の判定も同様に Job 側のクエリ（`JobRepository.listActiveByTarget`）をユースケースが呼ぶ形で行い、Note は関知しない。

## 共通の型と規約

`packages/core/src/domain/common/` の既存プリミティブに従う。

- **ID 値オブジェクト**: `unique symbol` による公称型。`create(id: string)` のみが生成経路。空文字列は `BusinessRuleError` を投げる。`generate()` は持たず、生成は `IdGenerator` ポート
- **エンティティの状態**: 排他的な状態は判別可能なユニオンで表す。boolean フラグの併置はしない
- **状態遷移**: `WithEventDrafts<TEntity, TEvent>` を返す。`EventId` は Unit of Work が採番する
- **リポジトリ**: `TransactionalRepository<TEntity, TId>` を継承し、`TId` は分岐 ID にバインドする。読み取り専用のクエリは各ポートに個別に定義する
- **`Versioned<T>` の使い分け**: 更新前提の取得は `findById` 経由で `Versioned<T>` を受け取り、`save` が版トークンを消費する。読み取り専用の経路は素の型を返す
- **ドメインサービス**: ドメインが定義したポートへの依存を宣言できる（`CredentialResolver` / `ConversionExecutor` など）。依存はポート越しに限り、フェイクの注入で決定的にテストできること。ポートを使わないサービスは依存を宣言しない
- **時刻**: ドメインは `now: Date` を引数で受け取る。`new Date()` は呼ばない
- **エラー**: 不変条件違反は `BusinessRuleError<${Domain}ErrorCode>`

### ScopeKey と永続化境界

`NoteOwner` / `TagScope` / `JobScope` / `QuotaSubject` が指す所有文脈を、アプリケーション共通型 `ScopeKey` に正規化する。

```ts
type ScopeKey =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;
```

`ScopeKey` は infrastructure の sharding key であり、domain entity が Durable Object を知ることはない。application port が次を担う。

```ts
interface ScopeRouter {
  forScope(scope: ScopeKey): ScopeHandle;
  resolveNote(noteId: NoteId): Promise<Readonly<{ scope: ScopeKey; routeVersion: number }>>;
}

interface ScopeUnitOfWorkProvider {
  run<T>(scope: ScopeKey, fn: (uow: ScopeUnitOfWork) => T): Promise<T>;
}

interface ScopeCleanupAdmissionStore {
  assertWritable(): Promise<void>;
  assertActorWritable(actorUserId: UserId): Promise<void>;
  beginPersonalAccountDeletion(operationId: string, userId: UserId): Promise<void>;
  abortPersonalAccountDeletion(operationId: string): Promise<void>;
  assertOwner(operationId: string): Promise<void>;
  describePersonalCleanup(operationId: string): Promise<PersonalCleanupProgress | null>;
  acknowledgePersonalComponent(operationId: string, component: PersonalCleanupComponent): Promise<void>;
  markCompleted(operationId: string, retainUntil: Date): Promise<void>;
  pruneCompleted(asOf: Date, limit: number): Promise<number>;
}

// component の語彙。必須集合ではない（必須集合は配備が宣言した部分集合）
type PersonalCleanupComponent =
  | "job" | "note" | "tag" | "storage" | "backup" | "usage" | "localProjection" | "outbox";

type PersonalCleanupProgress = Readonly<{
  status: "running" | "completed";
  acknowledged: readonly PersonalCleanupComponent[];
}>;

interface AccountDeletionManifestStore {
  begin(operationId: string, userId: UserId): Promise<void>;
  describe(operationId: string): Promise<AccountDeletionManifestHeader | null>;   // header の読み取り射影。manifest が消えていれば null
  appendMembershipPage(operationId: string, afterEdgeKey: string | null, limit: number): Promise<Readonly<{ count: number; nextCursor: string | null }>>;
  appendAuthorRoutePage(operationId: string, routes: readonly AccountDeletionAuthorRoute[], nextCursor: string | null): Promise<void>;
  markBuilt(operationId: string): Promise<void>;
  beginRollback(operationId: string): Promise<void>;
  claimPending(operationId: string, phase: "prepare" | "release" | "cleanup" | "redaction", limit: number): Promise<readonly AccountDeletionManifestItem[]>;
  acknowledge(operationId: string, itemKeys: readonly string[], phase: "prepare" | "release" | "cleanup" | "localRedaction" | "publicRedaction"): Promise<void>;
  acknowledgeReceipt(operationId: string, receipt: AccountDeletionReceipt): Promise<void>;
  allRollbackReleased(operationId: string): Promise<boolean>;
  allRequiredAcknowledged(operationId: string): Promise<boolean>;
  compactItems(operationId: string, limit: number): Promise<Readonly<{ removed: number; remaining: boolean }>>;
  markCompleted(operationId: string, terminalAt: Date, retainUntil: Date): Promise<void>;
  markRejected(operationId: string, terminalAt: Date, retainUntil: Date): Promise<void>;
  pruneTerminal(asOf: Date, cursor: string | null, limit: number): Promise<Readonly<{ operationIds: readonly string[]; nextCursor: string | null }>>;
}

// receipt の語彙。finalize の必須集合ではない（必須集合は配備が宣言した部分集合で、`personalAbort` は rollback 側）
type AccountDeletionReceipt =
  | "personalAbort" | "personalCleanup" | "authResidue" | "externalConnections" | "jobHistory" | "uniquenessRelease";

type AccountDeletionManifestHeader = Readonly<{
  operationId: string;
  userId: UserId;
  status: "building" | "built" | "rollingBack" | "completed" | "rejected";   // 永続化列も同じ5値（database/index.md の `account_deletion_manifests.status`）
  membershipCursor: string | null;
  authorRouteCursor: string | null;
  receipts: readonly AccountDeletionReceipt[];
  terminalAt: Date | null;
  retainUntil: Date | null;
}>;

type AccountDeletionManifestItem =
  | Readonly<{ key: string; kind: "membership"; workspaceId: WorkspaceId; edgeState: "active" | "removing" | "pending"; membershipId: string | null; prepareCommandKey: string | null; prepareDispatchedAt: Date | null; prepareAckedAt: Date | null; releaseCommandKey: string | null; releaseDispatchedAt: Date | null; releaseAckedAt: Date | null; cleanupAckedAt: Date | null }>
  | Readonly<{ key: string; kind: "authorRoute"; noteId: NoteId; routeVersion: number; localRedactionAckedAt: Date | null; publicRedactionAckedAt: Date | null }>;

type AccountDeletionAuthorRoute = Readonly<{ noteId: NoteId; routeVersion: number }>;

interface GlobalMaintenanceRunStore {
  beginOrResumeKind(input: { candidateRunId: string; kind: "authStatePrune" | "jobTombstonePrune" | "accountManifestPrune"; candidateAsOf: Date; generations: readonly string[]; leaseOwner: string; leaseUntil: Date }): Promise<Readonly<{ runId: string; asOf: Date; result: "started" | "resumed" | "leased" }>>;
  claimLanes(runId: string, leaseOwner: string, limit: number): Promise<readonly { generation: string; shardId: string; table: string; cursor: string | null; asOf: Date; commandKey: string }[]>;
  checkpointLane(input: { runId: string; leaseOwner: string; generation: string; shardId: string; table: string; cursor: string | null; asOf: Date; nextCommandKey: string }): Promise<void>;
  advanceOrAck(input: { runId: string; leaseOwner: string; generation: string; shardId: string; completed: boolean }): Promise<{ next: { generation: string; shardId: string; table: string; cursor: string | null; asOf: Date; commandKey: string } | null; runCompleted: boolean }>;
  recoverLease(runId: string, leaseOwner: string, leaseUntil: Date): Promise<boolean>;
  pruneCompleted(expiresAtOrBefore: Date, cursor: string | null, limit: number): Promise<Readonly<{ removed: number; nextCursor: string | null }>>;
}
```

- 1 UoW は 1 scope object の repository と local outbox だけを公開する
- 別 scope または global D1 の UoW を入れ子にしない
- scope 内の Job / Note / StoredFile metadata / Membership の強制終端は同じ UoW に入る
- scope をまたぐ note move と account deletion は `DistributedOperationStore` が持つ operation ID / state で再開する（`state` の語彙は `running` / `completed` / `rejected` の 3 値。account deletion manifest header の `status`（`building` / `built` / `rollingBack` / `completed` / `rejected` の 5 値）は別の状態機械で、両者を混ぜない）
- 1 つの operation が同じ scope へ配る**コマンドの重複排除**は `AppliedOperationStore` が `(operationId, commandKey)` で担い、barrier receipt を扱う `ScopeCleanupAdmissionStore` とは**鍵の意味でポートを分ける**（[ADR 045](../adr/045-idempotency-by-commutativity.md)）。記録はガードするコマンドと同じ Unit of Work に入る。記録は「そのコマンドの効果が今そこにある」という主張なので、効果を打ち消す**補償**トランザクションは同じ UoW で `clearApplied(operationId, commandKey)` により記録も消す。消さないと、同じ operation ID で再開したサガが、補償で消えたばかりのコマンドを「適用済み」として飛ばす。存在しない記録の消去は no-op
- `ScopeCleanupAdmissionStore`はcurrent scopeに束縛する。`assertWritable`はworkspace scopeではWorkspace deletion state、personal scopeではaccount deletion barrier receiptを検査する。`assertActorWritable`は加えてworkspaceのmembership removal prepare lockをactor UserIdで検査し、当該actor由来のNote/Tag/Storage/Usage/Integration/Job writeをlocal commit時に拒否する。全ドメインの通常write入口が両方を呼ぶ。`beginPersonalAccountDeletion`はpersonal DOの直列化点でbarrier receiptを保存し、先行writeはbarrier前に確定して後続scanに拾わせ、後続writeは`ACCOUNT_DELETING`で拒否する。workspace cleanup ownerは`Workspace.deleting`または削除manifest header、personal cleanup ownerはbarrier receiptのoperation IDを照合する。cleanup consumerはremote D1を読まず、別ID・欠落・未commit・完了済みを拒否する。`assertOwner`が完了後に偽になるのは、これが「まだ掃除して良いか」を問う述語だからで、完了済みを冪等に受ける`markCompleted` / `acknowledgePersonalComponent`（[ADR 039](../adr/039-cleanup-participants-declaration.md)）とは問いが違う。完了後のackを通すと、`pruneCompleted`が回収した後の遅延配送がbarrierを`running`へ戻しうる。personal barrier resultには配備が宣言した全component（composition rootがparticipant registryから実装へ渡す集合であって、enum全体ではない）のackをoperation専用に保存する。宣言していないcomponentへダミーackを置かず、unrelated scheduled taskの有無も完了条件にしない。`describePersonalCleanup`は再駆動された継続を安く決着させるための読み取りで、barrierがまだrunningか、どのcomponentがack済みかを答える。already completedなら残りを処理せずglobal receiptを再ackするだけで済む。receiptが無い場合と別operationがscopeを持つ場合は`null`を返す
- `abortPersonalAccountDeletion`は同じrunning ownerだけが呼べ、receiptを削除して通常writeを再開する。account deletion receiptは全local task/event consumer ack前に`markCompleted`できず、それまではexpiryを持たずprune禁止。完了時に同じUoWで120日後のprune taskを保存し、期限到達後はscope Alarmが最大100件ずつ消す。遅延重複を保持窓内は安全にno-op化する
- `AccountDeletionManifestStore`はapplication orchestration portでUserId shardに置く。membership pageはco-locateしたactive/removing/pending edgeをedge key順に最大100件固定する。author routeは`NoteRouteFanOutReader`のgenerationを含むopaque cursorで最大100件読んだpageを冪等appendし、header cursorと同じtransactionで進める。`describe`はheaderの読み取り射影で、2つのbuild cursorと所有userを返す（継続要求はoperationしか名指さないため、page位置はheaderが持つ）。manifestが既に消えていれば`null`を返す。itemはoperation ID+kind+対象IDで一意。finalizeとrollbackの完了判定は**別の問い**なので非対称である（[ADR 053](../adr/053-account-deletion-rollback-completion.md)）。**finalizeの正本**は固定済み全itemの完全ackと宣言された全receiptの両方（`allRequiredAcknowledged`）で、「全参加者が終えたか」を問う。**rollbackの正本**は固定済みmembership itemのrelease ackだけ（`allRollbackReleased`）で、「prepareを出した先へ解放を配り切ったか」を問う。`personalAbort` receiptはこの述語の判定対象に入らない。必須集合はどちらも**配備が宣言した集合**（composition rootがparticipant registryから実装へ渡す集合）から導き、enum全体でも固定件数でもない（[ADR 039](../adr/039-cleanup-participants-declaration.md)）。`personalAbort`はrollback側のreceiptなのでfinalizeの必須receipt集合には入らない。**membership itemの完全ackはcleanup phaseのackを含む** — prepare ackだけでは`allRequiredAcknowledged`は満たされず、cleanupレーンが同じitemをackして初めてitemが完全ackになる。各remote commandは送信前に`claimPending`で決定的command key/dispatchedAtを最大100件保存する。prepare rejectionはprepare ackの有無でなくprepare dispatched全件をrelease対象にし、未取得lockへのreleaseは同じcommand keyでno-op成功する。100件page・最大6接続で全release ack後だけ縮約へ進む。成功/prepare rejectionのどちらもitemsを100件ずつ縮約し、terminal headerだけを120日保持した後、generation/shard/run付きglobal maintenance laneで100件ずつ回収する。`pruneTerminal`は回収したoperationを件数ではなくID列で返す。[database/index.md](../database/index.md) の`account_deletion_manifests`がheaderとoperationを同じUserId shardのtransactionで消すと定めており、件数だけでは`DistributedOperationStore.deleteTerminal`へ渡すIDが取れないためである
- `GlobalMaintenanceRunStore`はauth/Job prunerが共有するapplication portでrouting catalog shardに置く。kindごとにrunning runは1つだけで、次hourのCronも未完了runを最古の`asOf`のまま再開し、完了後だけcandidate runを新規作成する。lane claim、page checkpoint+次Queue outbox、shard ack+次claim、全完了判定はそれぞれ原子的で、kind全体のactive laneは最大6。target shardのDELETEとはtransactionを共有しないため、応答喪失時は同じ入力cursorのDELETEを冪等再実行してからcheckpointする。10分leaseのownerだけが進捗を更新できる。completed runは30日保持後に`(expiresAt, runId)` keysetで1回100件ずつ回収する。**表の走査順はrun生成時に固定した順序付き表集合が唯一の正本**で、laneのpositionはその集合へのindexであり、resume中に配備の設定が変わってもこの集合は動かない。呼び出し側は表順を持たない。`advanceOrAck`は進めた先のpositionを`table` / `cursor` / `asOf` / `commandKey`ごと返す（同じlaneの次表は`cursor: null`、別shardの自動claimはそのlaneの永続化済みposition — 一度もclaimされていないlaneならrun先頭表のhead、処理して解放済みのlaneならcheckpoint済みの表とcursor）。`asOf`はrun生成時にrun行へ固定したrun自身の境界で、runのどのlaneも同じ値を運び、claim / ack時の壁時計も`checkpointLane`の`asOf`入力もこれを上書きしない。`next: null`は解放（`completed: false`）、run完了、引き渡せるpending laneが無いまま他laneがclaimedで残っているとき、の3つで返るため、それ自体はrun完了を意味しない（完了は`runCompleted`が別に答える）。解放は他にpending laneがあっても新しいlaneをclaimしない。command keyは**positionを作った側がmintする** — storeが作るposition（run生成時の先頭positionと次表へ進めたposition）は呼び出し側が同じpositionから導けるキーと一致し、既存positionを返すとき（上記の自動claimと`claimLanes`が返す全lane）は永続化済みのキーをそのまま返して再mintしない（[ADR 061](../adr/061-maintenance-sweep-order-authority.md)）
- routeVersion が古い mutation は adapter が `ConflictError("STALE_SCOPE_ROUTE")` に写し、application が route を 1 回だけ引き直す。2 回目も競合したらそのまま返す

## 横断的な関心事

| 関心事 | 置き場所 |
| --- | --- |
| 時刻 | `application/ports/clock.ts`（既存） |
| ID 採番 | `application/ports/idGenerator.ts`（既存） |
| ログ | `application/ports/logger.ts`（既存） |
| トランザクション | `application/execution/unitOfWork.ts`（既存） |
| アウトボックス | `application/ports/outboxRepository.ts`（既存） |
| イベントの重複排除 | `application/ports/idempotencyStore.ts`（新規。再適用が非可換な購読者が使う） |
| HTML のサニタイズ | Note ドメインのドメインサービス（[ADR 006](../adr/006-html-content-model.md)） |
| パスワードのハッシュ化 | Identity ドメインのポート |
| 資格情報の暗号化 | Integration ドメインのポート（`SecretCipher`）。**鍵そのものの供給と版の解決はアダプターの責務**で、正典は [presentation/index.md](../presentation/index.md) の「秘密と鍵の供給」 |
| 秘密と鍵の供給（署名鍵・暗号鍵） | [presentation/index.md](../presentation/index.md) の「秘密と鍵の供給」。ドメインは鍵を受け取るポートの形だけを定め、どこから来るかを知らない |
| 全文検索 | Note ドメインのクエリポート（検索インデックスの更新はイベント駆動） |
| メール送信 | `application/ports/mailSender.ts`（新規。Identity と Workspace の両方が使う） |
| 認可フロー状態（OAuth の `state` / `codeVerifier`） | `application/ports/oauthStateStore.ts`（新規。Identity と Integration の両方が使う） |
| 画像の公開 URL | エンティティは `StoredFileId` ではなく公開 URL の文字列を保持する。Identity / Workspace が Storage に依存しないための取り決め |

### 新設する横断的ポート

以下の 4 件（`MailSender` / `TimeZoneResolver` / `OAuthStateStore` / `IdempotencyStore`）はアプリケーション層に置き、どのドメインのポート一覧にも現れない。ポートの総数を数えるときは各ドメインの一覧とこの 4 件の和を取る。複数のドメインが使うもの（`MailSender` は Identity と Workspace、`OAuthStateStore` は Identity と Integration）も 1 件として数え、使う側のドメインごとに二重計上しない。

#### MailSender（`application/ports/mailSender.ts`）

```ts
interface MailSender {
  send(message: MailMessage): Promise<void>;
}

type MailMessage = Readonly<{
  to: string;
  template: MailTemplate;
  locale: "ja";
}>;

type MailTemplate =
  | { kind: "emailVerification"; verifyUrl: string; expiresAt: Date }
  | { kind: "passwordReset"; resetUrl: string; expiresAt: Date }
  | { kind: "passwordResetUnavailable"; signInUrl: string }      // パスワード認証手段を持たない相手への案内
  | { kind: "existingAccountNotice"; signInUrl: string }         // 登録済みアドレスへのサインアップ試行
  | { kind: "workspaceInvitation"; workspaceName: string; role: string; inviterName: string; acceptUrl: string; expiresAt: Date };
```

**エラーケース**: `SystemError(ExternalServiceError)`（送信基盤の失敗）。送信の失敗は呼び出し元の操作を失敗させない（記録して継続する）。

#### TimeZoneResolver（`application/ports/timeZoneResolver.ts`）

月やカレンダーの境界を利用者のタイムゾーンで判定するために使う（OR-05 / OR-02）。

```ts
interface TimeZoneResolver {
  monthRange(month: YearMonth, timeZone: string): DateRange;
  monthOf(instant: Date, timeZone: string): YearMonth;
  dayKey(instant: Date, timeZone: string): string;              // "YYYY-MM-DD"
}
```

タイムゾーンは要求ごとにクライアントから受け取り、不正な値は `"UTC"` に落とす。

**エラーケース**: なし（不正な入力は既定値に落とす）

#### OAuthStateStore（`application/ports/oauthStateStore.ts`）

認可フローの `state` と `codeVerifier` を、コールバックが返るまで短期間保持する。サインイン（Identity の `startOAuthFlow` / `completeOAuthSignIn` / `linkOAuthIdentity`）と外部連携（Integration の `startIntegrationOAuth` / `completeIntegrationOAuth`）が同じ表を共有するため、どちらのドメインにも置かずアプリケーション層に置く。

```ts
interface OAuthStateStore {
  put(state: string, value: OAuthFlowState, ttlMs: number): Promise<void>;
  take(state: string, stateBindingHash: TokenHash): Promise<OAuthFlowState | null>; // 束縛が一致したときだけ取得と同時に削除する
  deleteExpired(now: Date, cursor: string | null, limit: number): Promise<Readonly<{ deleted: number; nextCursor: string | null }>>; // 有界回収
}

type OAuthFlowState = Readonly<{
  provider: string;           // OAuthProvider（サインイン）または ProviderKind（連携）
  codeVerifier: string;
  redirectTo: string | null;
  intent: "signIn" | "linkIdentity" | "integration";
  userId: UserId | null;      // intent が "linkIdentity" / "integration" のとき必須
  userAuthEpoch: number | null; // authenticated intent発行時の世代。signInはnull
  stateBindingHash: TokenHash;  // 束縛の秘密の digest。intent を問わず必須
}>;
```

`provider` を原始型のままにしているのは、Identity と Integration が別々の列挙を持つため。値の解釈は取り出した側が自分の値オブジェクトで再構築する。期限切れの回収は 1 か所に寄せ、Identity の [`pruneExpiredAuthState`](../usecases/identity.md) が両方の `intent` をまとめて掃除する（Integration 側に同種の定期掃除は置かない）。

`take` の「取得と同時に削除する」は**原子的でなければならない**。削除の条件は 1 本のルールに畳む — **削除するのは束縛が一致したときだけ。一致すれば期限切れでも削除して `null` を返す。不一致は常に行を残して `null` を返す**。`stateBindingHash` はストアにとって不透明な digest で、その由来も運搬手段もストアは知らない。判定の順序は契約ではなく実装ノートで、global D1 なら `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *`（`WHERE` に期限を混ぜない）で削除し、返った行の `expires_at` を見て期限切れなら `null` を返す。

束縛が一致しない要求で行が消費されないことは、呼び出し側の順序ではなくこの 1 回の原子操作の性質として保証する。

**エラーケース**: `SystemError(DatabaseError)`

#### IdempotencyStore（`application/ports/idempotencyStore.ts`）

イベントの配送は at-least-once のため、重複配送を自力で吸収できないコンシューマーはイベント ID で重複を排除する。

```ts
interface IdempotencyStore {
  markProcessed(consumer: string, eventId: EventId): Promise<boolean>;   // 既に処理済みなら false
}
```

使うかどうかは購読側の処理の性質で決める。

- **必須**: 集計・加減算など、同じイベントの再適用が非可換な処理を行う購読者（`applyStorageDelta`）。処理の冒頭で `markProcessed` を呼び、`false` なら何もせず成功として完了する。記録と本処理は同一の Unit of Work で行い、片方だけが確定した状態を作らない
- **使わない**: 上書き・削除など本質的に冪等な処理を行う購読者（現在の状態を読み直して上書きする `projectNoteChanges`、鍵を指定して消す `deleteStoredObjects`、対象が消えていれば 0 件で終わる `deleteFilesForNote` など）。使わない購読者は、何が冪等性の根拠かを各ユースケースに明記する

この分類はイベント購読者にだけ適用する。`rebuildNoteProjection` のような運用操作はイベントを受け取らず、重複配送の対象でもないため、いずれの側にも属さない。

`deleteStoredObjects` のように外部リソースへの書き込みを含む購読者では、記録を持たないほうが安全側に倒れる（処理済みを先に記録すると、失敗したイベントが再配送で弾かれて実体が回収されない）。判断の根拠は [usecases/storage.md](../usecases/storage.md) の当該ユースケースを参照。

`markProcessed` の「既に処理済みなら false」は**本処理と同じ plane で原子的でなければならない**。global consumer は D1、scope consumer は対象 DO の `processed_events` を本処理と同じ transaction で更新する。

**エラーケース**: `SystemError(DatabaseError)`

## 継続要求

イベントとは別に、**1 回で処理しきれなかった仕事の続き**を表す local task がある。scope task は `scheduled_tasks` と Alarm、global task は D1 outbox と Queue で運ぶ。どちらも購読者は1つだけである。

**payload の欄は task 行に積む値そのものである。** scope は `scheduled_tasks` の行が持つので、どの payload にも現れない。

| 継続要求 | payload | 唯一の購読者 |
| --- | --- | --- |
| `note.ownerPurgeContinued` | `{ deletionOperationId, stuckPurges?: { noteId, expectedVersion }[] }`（`stuckPurges` は持ち回る停止 purge があるときだけ載る） | scope Alarm → [`deleteNotesForOwner`](../usecases/note.md) |
| `note.trashExpiryContinued` | `{}`（期限は turn 自身の `now` が決めるので載せるものが無い） | scope Alarm → [`purgeExpiredTrash`](../usecases/note.md) |
| `storage.ownerDeleteContinued` | `{ deletionOperationId }` | scope Alarm → [`deleteFilesByOwner`](../usecases/storage.md) |
| `storage.noteDeleteContinued` | `{ noteId, deletionOperationId }` | scope Alarm → [`deleteFilesForNote`](../usecases/storage.md) |
| `storage.orphanMediaContinued` | `{ afterCreatedAt, afterId }`（次の turn が再開する keyset 位置。読めなければ先頭から） | scope Alarm → [`collectOrphanMedia`](../usecases/storage.md) |
| `tag.scopeDeleteContinued` | `{ deletionOperationId }` | scope Alarm → [`deleteTagsForScope`](../usecases/tag.md) |
| `tag.noteDeleteContinued` | `{ noteId, deletionOperationId }` | scope Alarm → [`deleteAssignmentsForNote`](../usecases/tag.md) |
| `integration.noteDeleteContinued` | `{ noteId, deletionOperationId }` | scope Alarm → [`deleteBackupRecordsForNote`](../usecases/integration.md) |
| `workspace.deletionLocalContinued` | `{ operationId, phase ("memberships" / "invitations" / "localDelete"), cursor, slug, advertisedSlug }` | workspace scope Alarm → [`deleteWorkspace`](../usecases/workspace.md) のmanifest build・local edge削除・Workspace行削除phase |
| `workspace.deletionGlobalCleanupContinued` | `{ operationId, cursor, slug, advertisedSlug }` | workspace scope Alarm → [`deleteWorkspace`](../usecases/workspace.md) のglobal cleanup phase（directory tombstone・slug解放・directory edge / invitation route削除） |
| `workspace.deletionManifestCompactContinued` | `{ operationId }` | workspace scope Alarm → [`deleteWorkspace`](../usecases/workspace.md) のack済みmanifest縮約phase |
| `projection.reprojectRequested` | `{ noteId }` | scope Alarm → [`projectNoteChanges`](../usecases/note.md) |
| `projection.tagFanOutContinued` | `{ tagId, afterNoteId }` | scope Alarm → [`projectNoteChanges`](../usecases/note.md) |
| `projection.authorRefreshRequested` | `{ userId, identityVersion, afterNoteId }` | scope Alarm → [`projectNoteChanges`](../usecases/note.md) |
| `projection.authorRouteFanOutContinued` | `{ userId, identityVersion, cursor }` | global Queue → [`projectNoteChanges`](../usecases/note.md) |
| `projection.workspaceRouteFanOutContinued` | `{ workspaceId, workspaceVersion, cursor }` | global Queue → [`projectNoteChanges`](../usecases/note.md) |
| `projection.authorRedactionRequested` | `{ noteId, userId, redactionVersion, operationId }` | scope/global投影 → [`projectNoteChanges`](../usecases/note.md) |
| `tag.deleteContinued` | `{ operationId, tagId }` | scope Alarm → [`deleteTag`](../usecases/tag.md) worker phase |
| `tag.mergeContinued` | `{ operationId, sourceTagId, targetTagId }` | scope Alarm → [`mergeTags`](../usecases/tag.md) worker phase |
| `tag.deleteUnusedContinued` | `{ operationId, scope }` | scope Alarm → [`deleteUnusedTags`](../usecases/tag.md) worker phase |
| `job.terminationContinued` | `{ origin }` | scope Alarm → [`continueForcedTermination`](../usecases/job.md) |
| `job.removalLocalContinued` | `{ removalOperationId }` | scope Alarm → `pruneJobHistory` / `deleteJobsForRequester`の共通family removal worker |
| `job.removalGlobalContinued` | `{ scope, removalOperationId }` | global Queue → [`projectJobHistory`](../usecases/job.md) のremoval分岐 |
| `job.removalManifestCompactContinued` | `{ scope, removalOperationId }` | scope Alarm → [`projectJobHistory`](../usecases/job.md) の完了manifest縮約phase |
| `job.targetHistoryCleanupContinued` | `{ target, operationId, cursor }` | global Queue → [`projectJobHistory`](../usecases/job.md) のtarget削除分岐 |
| `job.globalTombstonePruneContinued` | `{ runId, generation, shardId, table, cursor, asOf }` | global Queue → [`pruneJobHistory`](../usecases/job.md) のD1 tombstone回収分岐 |
| `job.globalTombstonePruneCron` | `{ type: "job.globalTombstonePruneCron" }` | Cron → [`pruneJobHistory`](../usecases/job.md) のglobal run開始分岐 |
| `identity.authStatePruneContinued` | `{ runId, generation, shardId, table, cursor, asOf }` | global Queue → [`pruneExpiredAuthState`](../usecases/identity.md) |
| `identity.userAuthResidueCleanupContinued` | `{ userId, authEpoch, table: "sessions" | "authTokens", deletionOperationId? }` | global Queue → password/session失効後の旧世代Session/AuthToken回収 |
| `identity.accountDeletionManifestBuildContinued` | `{ operationId, phase: "memberships" | "authorRoutes", cursor: string | null, continuationKey: string }` | global Queue → [`deleteAccount`](../usecases/identity.md) の対象固定phase |
| `identity.accountDeletionDispatchContinued` | `{ operationId, phase: "prepare" | "rollbackRelease" | "cleanup" | "redaction" | "finalize", cursor: string | null, continuationKey: string }` | global Queue → [`deleteAccount`](../usecases/identity.md) のbounded fan-out |
| `identity.accountDeletionManifestCompactContinued` | `{ operationId, cursor: string | null, continuationKey: string }` | global Queue → [`deleteAccount`](../usecases/identity.md) の完了manifest縮約 |
| `identity.personalCleanupHandoverContinued` | `{ deletionOperationId }` | scope Alarm → scope平面のtask runnerが閉じたbarrierの引き渡しを行い、global manifestへ`personalCleanup` receiptをackする |
| `identity.accountDeletionManifestPruneContinued` | `{ runId, generation, shardId, cursor, asOf }` | global Queue → [`deleteAccount`](../usecases/identity.md) のterminal manifest回収 |
| `identity.personalBarrierPruneContinued` | `{ scope, asOf }` | scope Alarm → [`deleteAccount`](../usecases/identity.md) のcompleted barrier回収 |
| `global.maintenanceRunPruneContinued` | `{ cursor, asOf }` | global Queue → [`pruneExpiredAuthState`](../usecases/identity.md) の共通maintenance run回収分岐（唯一の購読者） |
| `integration.userCleanupContinued` | `{ operationId, userId, scope }` | scope Alarmまたはglobal Queue → [`deleteIntegrationsForUser`](../usecases/integration.md) |
| `usage.userCleanupContinued` | `{ scope, deletionOperationId }` | scope Alarm → [`deleteQuota`](../usecases/usage.md) |
| `publicProjection.reprojectRequested` | `{ noteId, expectedRouteVersion? }` | global Queue → public projection consumer。scope-local tag fan-outはversionを省略し、consumerがcurrent routeを解決する |

規約は 4 つ。

scopeの継続・個別taskを`scheduled_tasks`へ保存するとき、`operation_id`は生成元operation/event/command IDと対象ID・version・cursorから決定的に導出する。同じ生成元が複数Noteへ`projection.reprojectRequested`を積む場合もNoteIdとprojectionRevisionを含めるため、1件へ潰れず、応答喪失時にも増殖しない。具体式は [database/index.md](../database/index.md) の`scheduled_tasks`に定める。global outboxで運ぶ継続要求では同じ役割を payload の`continuationKey`が担い、導出式は `` `${eventType}:${operationId}:${phase}:${cursor ?? "-"}` `` である。payloadに`phase`を持たない継続（`identity.accountDeletionManifestCompactContinued`）は、`phase`の位置に固定文字列`compact`を置く。commit応答を失ったターンが同じ鍵を再導出するため、再実行は先着の1行へ潰れて鎖が分岐しない（[ADR 041](../adr/041-deterministic-continuation-event-id.md) / [ADR 042](../adr/042-outbox-save-id-collision.md)）。鍵はターンごとに変わらなければならない。自分と同じ鍵を再発行するターンは、直後のrelay finalizeに処理済みとして印を付けられ、鎖がそこで止まる。global outboxで運ぶidentity系の継続要求のうちこの鍵を持たないのは`identity.userAuthResidueCleanupContinued`だけで、理由はカーソルを持たない継続だからである（仕事そのもの＝行の削除が次ターンの母集合から対象を外すので、ターンを鍵で区別しなくても常に前へ進む）。

- **購読者を 1 つに保つ**。既存のイベントを再投入して継続する形は採らない（購読者の数だけコピーが増え、outbox とキューを水増しする）
- **継続要求は、続きを引き直すのに必要な情報をすべて運ぶ**。次の実行で網を引き直す形の継続（`job.terminationContinued`）では、payload が**元の経路の選択述語をそのまま再現できなければならない**。再現できないと、続きが元より広い集合を処理してしまう。強制終端の 9 経路は対象の選び方（対象・スコープ・要求者・`kind`）と当てる遷移（`cancel` か `fail` か）が経路ごとに違うため、payload は**どの経路の続きか**を判別子で持つ（[usecases/job.md](../usecases/job.md) の「共通: 強制終端の後始末」）
- **カーソルは、処理そのものが対象を検索結果から外す場合は持たない**。削除も終端も対象を `listBy*` / `listActive*` の結果から外すため、「残っているものを先頭から `batchSize` 件読む」だけで必ず前に進む。処理しても母集合が残るtag assignment fan-out、Note routeのauthor/workspace fan-out、target history fan-outはkeyset cursorを持つ
  - 根拠を「対象が消えないから」と書いてはならない。付与そのものは `unassignTag` / `deleteTag` の CASCADE / `deleteAssignmentsForNote` / `relocateAssignmentsForNote` / `mergeTags` の衝突行削除によって並行して消えうる。カーソルが要るのは、消えるかどうかではなく**処理しても残る**ためである
  - **カーソルは必ずキーセット方式で解釈する**。`afterNoteId` は `WHERE tag_id = ? AND note_id > ? ORDER BY note_id` の意味であり、読んだ件数を数える `OFFSET` ではない。`OFFSET` にすると、カーソルより前の付与が並行して消えるたびに後続のノートを静かに飛ばす。位置を ID で表すこの形なら、前方の削除は残りの行の位置を動かさない
- **対象が残っているのに 1 件も処理できなかったときは継続を増やさない**。scope task は同じ `scheduled_tasks` 行の attempt と `dueAt` を指数backoffで更新し、上限到達時は `failed` にして global 運用イベントを送る。global task は Queue の再試行と DLQ に委ねる。恒久的に失敗する 1 件が新しい継続を無限に増やすのを防ぐ
  - **「対象が 0 件だった」は正常な終端であり、この規則の対象ではない**。継続を積まずに成功として返る。とくにカーソル方式（`projection.tagFanOutContinued`）では、付与の件数がちょうど 1 ページの倍数のときに**最後のページが空になるのが正常な終わり方**であり、これを失敗として扱うと正常終了を運用障害として通知してしまう

## ユースケースの分布

| ドメイン | ユースケース数 |
| --- | --- |
| Identity | 25 |
| Workspace | 25 |
| Note | 36 |
| Tag | 14 |
| Storage | 13 |
| Conversion | 4 |
| Integration | 15 |
| Job | 12 |
| Usage | 7 |
| 合計 | 151 |

詳細は `spec/usecases/${domain}.md` に定義する。
