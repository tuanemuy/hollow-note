# Workspace

共同作業の場と、そこでの権限を管理する。ロールの定義は [ADR 004](../adr/004-workspace-roles.md) に従う。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| Workspace | ワークスペース | 複数人でノートを共有する場 |
| Membership | メンバーシップ | ある利用者があるワークスペースに属していること、およびその権限 |
| Role | ロール | メンバーの権限の段階。`owner` / `editor` / `viewer` |
| Invitation | 招待 | まだメンバーでない相手にメンバーシップを与えるための、期限付きの申し出 |
| Slug | スラッグ | 公開ページの URL に使う一意の文字列 |
| Publication | 公開状態 | ワークスペース自体が外部に公開されているか |

## 値オブジェクト

### WorkspaceId / MembershipId / InvitationId

- **バリデーション**: 空白のみは不可。`BusinessRuleError(WorkspaceErrorCode.InvalidId)`

### WorkspaceSlug

- **フィールド**: `value: string`
- **バリデーション**: 3〜30 文字、`[a-z0-9_-]` のみ、先頭と末尾は英数字。予約語（`new`, `settings`, `api`, `search`, `about`）は不可。違反時 `BusinessRuleError(InvalidSlug)` / `SlugReserved`
- **等価性**: 小文字化した文字列が一致

### WorkspaceName

- **バリデーション**: 前後の空白を除去して 1〜80 文字

### WorkspaceDescription

- **バリデーション**: 500 文字以内。空文字列を許す

### WorkspaceRole

- **フィールド**: `value: "owner" | "editor" | "viewer"`
- **バリデーション**: 既知の値のみ
- **順序**: `owner > editor > viewer`。`WorkspaceRole.atLeast(role, minimum): boolean` で比較する

## エンティティ

### Workspace（集約ルート）

```
WorkspaceBase = {
  id: WorkspaceId
  name: WorkspaceName
  description: WorkspaceDescription
  avatarUrl: AvatarUrl | null   // 公開 URL。Storage への依存を持たないための取り決め
  slug: WorkspaceSlug | null
  version: number
  lifecycle: { state: "active" } | { state: "deleting"; operationId: string }
  createdAt: Date
  updatedAt: Date
}

PrivateWorkspace   = WorkspaceBase & { publication: "private" }
PublishedWorkspace = WorkspaceBase & { publication: "published", slug: WorkspaceSlug, publishedAt: Date }
Workspace = PrivateWorkspace | PublishedWorkspace
```

`PublishedWorkspace` は `slug` を必須で持つ。これにより「公開なのにスラッグがない」状態が型として表現できない。

`create` が `ownerId` を受けるのは `workspace.created` の payload が `{ workspaceId, ownerId }` であり、イベントの発行元が集約だからである。`updateProfile` の `avatarUrl` だけが構築済みの VO で渡るのは [identity.md](./identity.md) の `User.updateProfile` と同じ理由による（`AvatarUrl.create` が `appUrl` を要し、集約は設定を読まない。[ADR 051](../adr/051-same-origin-url-predicate.md)）。

**不変条件**

- `slug` は設定されていればサービス全体で一意
- 公開中はスラッグを空にできない
- `lifecycle.state = "deleting"`になった後は同じoperation IDの削除継続以外のscope mutationを受理しない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; ownerId: UserId; name: string; description: string; slug: string \| null }, now: Date` | `WithEventDrafts<PrivateWorkspace, WorkspaceEvent>` | `lifecycle: { state: "active" }`・非公開で生成。`workspace.created` を発行 |
| `updateProfile` | `workspace: Workspace, params: { name?: string; description?: string; avatarUrl?: AvatarUrl \| null }, now: Date` | `WithEventDrafts<Workspace, WorkspaceEvent>` | 指定項目のみ更新。公開状態は保つ。`name` が変わったときのみ `workspace.profileUpdated` を発行 |
| `changeSlug` | `workspace: Workspace, slug: string \| null, now: Date` | `WithEventDrafts<Workspace, WorkspaceEvent>` | 公開中に `null` を渡すと `BusinessRuleError(PublishedWorkspaceRequiresSlug)`。変更時は `workspace.slugChanged`（旧スラッグを含む）を発行 |
| `publish` | `workspace: PrivateWorkspace, now: Date` | `WithEventDrafts<PublishedWorkspace, WorkspaceEvent>` | `slug` が `null` なら `BusinessRuleError(SlugRequiredToPublish)`。`workspace.published` を発行 |
| `unpublish` | `workspace: PublishedWorkspace, now: Date` | `WithEventDrafts<PrivateWorkspace, WorkspaceEvent>` | `workspace.unpublished` を発行 |

削除はユースケースが `WorkspaceEvents.workspaceDeleted` を直接発行する。

### Membership（集約ルート）

```
Membership = {
  id: MembershipId
  workspaceId: WorkspaceId
  userId: UserId
  role: WorkspaceRole
  version: number
  joinedAt: Date
  updatedAt: Date
}
```

**不変条件**

- `(workspaceId, userId)` の組は一意
- 1 つのワークスペースには常に 1 名以上の `owner` がいる（`MembershipPolicy` が検査する。アカウント削除の経路は [usecases/identity.md](../usecases/identity.md) の `deleteAccount` 手順 2 が `countByRole` の検査で `LastOwnerCannotLeave` を返すことで守る）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; workspaceId: WorkspaceId; userId: UserId; role: string }, now: Date` | `WithEventDrafts<Membership, WorkspaceEvent>` | 生成し `membership.added` を発行 |
| `changeRole` | `membership: Membership, role: string, now: Date` | `WithEventDrafts<Membership, WorkspaceEvent>` | 同じロールなら変更せずイベントも出さない。異なれば更新し `membership.roleChanged`（旧ロールを含む）を発行 |

削除はユースケースが `WorkspaceEvents.membershipRemoved` を直接発行する。

### Invitation（集約ルート）

```
InvitationBase = {
  id: InvitationId
  workspaceId: WorkspaceId
  email: Email
  role: WorkspaceRole
  invitedBy: UserId
  tokenHash: TokenHash
  version: number
  createdAt: Date
  expiresAt: Date
}

PendingInvitation  = InvitationBase & { status: "pending" }
AcceptedInvitation = InvitationBase & { status: "accepted", acceptedAt: Date, acceptedBy: UserId }
RevokedInvitation  = InvitationBase & { status: "revoked", revokedAt: Date }
Invitation = PendingInvitation | AcceptedInvitation | RevokedInvitation
```

**不変条件**

- `(workspaceId, email)` に対して `pending` の招待は最大 1 件
- 受諾済み・取り消し済みの招待は再び `pending` に戻らない
- 有効期限は発行から 14 日

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `issue` | `params: { id: string; workspaceId: WorkspaceId; email: string; role: string; invitedBy: UserId; tokenHash: TokenHash }, now: Date` | `WithEventDrafts<PendingInvitation, WorkspaceEvent>` | `expiresAt = now + 14 日`。`invitation.created` を発行 |
| `resend` | `invitation: PendingInvitation, tokenHash: TokenHash, now: Date` | `WithEventDrafts<PendingInvitation, WorkspaceEvent>` | トークンと期限を更新。`invitation.created` を再発行 |
| `accept` | `invitation: PendingInvitation, acceptedBy: UserId, now: Date` | `WithEventDrafts<AcceptedInvitation, WorkspaceEvent>` | 期限切れなら `BusinessRuleError(InvitationExpired)`。`invitation.accepted` を発行 |
| `revoke` | `invitation: PendingInvitation, now: Date` | `WithEventDrafts<RevokedInvitation, WorkspaceEvent>` | `invitation.revoked` を発行 |
| `isExpired` | `invitation: Invitation, now: Date` | `boolean` | `invitation.expiresAt <= now` |

## ドメインサービス

### WorkspaceAuthorization

**責務**: ロールが操作を行えるかを判定する。

```
WorkspaceAction =
  | "viewNote" | "downloadNote"
  | "createNote" | "editNote" | "deleteNote" | "changeNoteVisibility" | "moveNote"
  | "manageTags" | "viewTrash"
  | "manageMembers" | "manageWorkspace" | "publishWorkspace" | "deleteWorkspace"
```

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `minimumRoleFor` | `action: WorkspaceAction` | `WorkspaceRole` | 下表を引く。判定の唯一の情報源 |
| `can` | `role: WorkspaceRole, action: WorkspaceAction` | `boolean` | `WorkspaceRole.atLeast(role, minimumRoleFor(action))` |
| `ensureCan` | `role: WorkspaceRole, action: WorkspaceAction` | `void` | `can` が偽なら `BusinessRuleError(InsufficientRole)` |

| 操作 | 必要な最小ロール |
| --- | --- |
| `viewNote`, `downloadNote` | viewer |
| `createNote`, `editNote`, `deleteNote`, `changeNoteVisibility`, `moveNote`, `manageTags`, `viewTrash` | editor |
| `manageMembers`, `manageWorkspace`, `publishWorkspace`, `deleteWorkspace` | owner |

**バックアップ専用の action を置かない**。元ファイルの Drive バックアップは editor を要する（[ADR 004](../adr/004-workspace-roles.md) のロール表）が、`WorkspaceAction` に `backupNote` は加えず `editNote` で判定する。バックアップが editor 側にあるのは、`BackupRecord` がノートに紐づく共有状態であり、既存記録が別のメンバーのものなら所有者ごと付け替わるためで、「ノートの内容の扱いに関わる決定を書き換える」という点で `editNote` とまったく同じ理由による。要求する最小ロールも判定に使う情報も同じ action を 2 つに割ると、片方だけを変更したときに表が食い違う。実際 `requestBackup`（[usecases/integration.md](../usecases/integration.md)）は `NoteAccessPolicy` の `canEdit` を呼んでおり、この表は `canEdit` の中で引かれる。降格時に取り消すジョブの `kind` → 要ロールの対応（[usecases/workspace.md](../usecases/workspace.md) の `changeMemberRole`）でも `driveBackup` / `bulkBackup` は `editNote` を根拠に editor 側へ置いている。

同じ理由で、生成物を作るだけでノート側に何も書かない PDF ダウンロード・一括ダウンロードには `downloadNote` を使い、専用の action を置かない。

`minimumRoleFor` と `WorkspaceRole.atLeast` はユースケースからは直接呼ばない。表を引く責務と順序比較の責務を切り出して `can` の実装に使うもので、外向きの入口は `can` / `ensureCan` の 2 つに限る。ロール変更に伴う実行中ジョブの取り消し（[usecases/workspace.md](../usecases/workspace.md) の `changeMemberRole`）は、この表を `JobKind` 側に読み替えた対応を同ユースケースに持つ。

**依存するポート**: なし

### MembershipPolicy

**責務**: ワークスペースのメンバー集合に対する規則を検査する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureOwnerRemains` | `ownerCount: number, target: Membership, nextRole: WorkspaceRole \| null` | `void` | 対象が `owner` で、変更・除名後に `owner` が 0 人になるなら `BusinessRuleError(LastOwnerCannotLeave)`。`nextRole` が `null` は除名を表す |
| `ensureNotSelfRoleChange` | `actor: UserId, target: Membership` | `void` | 自分自身のロール変更なら `BusinessRuleError(CannotChangeOwnRole)` |
| `ensureNotSelfRemoval` | `actor: UserId, target: Membership` | `void` | 自分自身の除名なら `BusinessRuleError(CannotRemoveSelf)`。自身の離脱は `leaveWorkspace` を使う |
| `ensureWorkspaceQuota` | `ownedCount: number` | `void` | 20 件以上を所有していれば `BusinessRuleError(WorkspaceQuotaExceeded)` |

**依存するポート**: なし

## ポート

### WorkspaceRepository

```ts
interface WorkspaceRepository extends TransactionalRepository<Workspace, WorkspaceId> {
}

interface UserWorkspaceDirectory {
  listActiveByUser(userId: UserId, cursor: string | null, limit: number): Promise<Readonly<{ items: readonly { workspaceId: WorkspaceId; role: WorkspaceRole }[]; nextCursor: string | null }>>;
  countOwnedByUser(userId: UserId, limit: number): Promise<number>; // limitで打ち切る
}

type WorkspaceDirectoryEntry = Readonly<{
  workspaceId: WorkspaceId;
  name: WorkspaceName;
  slug: WorkspaceSlug | null;
  avatarUrl: string | null;
  publication: Workspace["publication"];
}>;

interface WorkspaceDirectoryBatchReader {
  resolveMany(ids: readonly WorkspaceId[]): Promise<ReadonlyMap<WorkspaceId, WorkspaceDirectoryResolution>>; // 最大20件、最大6接続
}

type WorkspaceDirectoryResolution =
  | Readonly<{ state: "active"; entry: Versioned<WorkspaceDirectoryEntry> }>
  | Readonly<{ state: "deleted" }>
  | Readonly<{ state: "unavailable"; retryAfterSeconds: number | null }>;

interface PublicWorkspaceDirectoryReader {
  listPublished(cursor: string | null, limit: number): Promise<Readonly<{ items: readonly { workspaceId: WorkspaceId; slug: WorkspaceSlug; updatedAt: Date }[]; nextCursor: string | null }>>;
}

type WorkspaceDirectorySnapshot = Readonly<{
  workspaceId: WorkspaceId;
  name: WorkspaceName;
  slug: WorkspaceSlug | null;
  avatarUrl: string | null;
  publication: Workspace["publication"];
  sourceVersion: number;
}>;

interface WorkspaceDirectoryProjectionWriter {
  applySnapshotIfNewer(snapshot: WorkspaceDirectorySnapshot): Promise<boolean>; // 書いたらtrue
  tombstone(input: { workspaceId: WorkspaceId; operationId: string }): Promise<void>;
}

interface WorkspaceSlugReservationStore {
  resolveActive(slug: WorkspaceSlug): Promise<WorkspaceId | null>;
  reserve(input: { slug: WorkspaceSlug; workspaceId: WorkspaceId; operationId: string; expiresAt: Date }): Promise<void>;
  activate(input: { slug: WorkspaceSlug; workspaceId: WorkspaceId; operationId: string; releasing: WorkspaceSlug | null }): Promise<void>;
  abandon(input: { slug: WorkspaceSlug; operationId: string }): Promise<void>;
  release(input: { slug: WorkspaceSlug; workspaceId: WorkspaceId }): Promise<void>;
}
```

`WorkspaceDirectoryProjectionWriter` は `workspace_directory` の唯一の書き手で、`workspace.created` / `.profileUpdated` / `.slugChanged` / `.published` / `.unpublished` は scope-local commit 後の snapshot 1 件に、`workspace.deleted` は tombstone になる。投影は out-of-band かつ at-least-once なので、順序は `sourceVersion` だけで決める — 保存済みの版以下の snapshot は書かずに `false` を返し、これが stale event の規則と応答喪失の再送の規則を兼ねる。tombstone は終端で、どの版の snapshot も再開させない（削除済み workspace が一覧やサイトマップへ戻らないため）。同じ operation ID の tombstone は冪等、別 operation の tombstone は `ConflictError`。`slug` は書き込み時に他の行から奪う（[database/index.md](../database/index.md) の `workspace_directory`）。

`WorkspaceRepository` は current workspace scope に束縛されて自 scope の 1 行しか見えないので、slug の global uniqueness は `WorkspaceSlugReservationStore` が global D1 の `workspace_slug_reservations` で担う。`ConflictError("SLUG_ALREADY_USED")` を返すのはこのポートであり、`WorkspaceRepository` ではない。`WorkspaceSlug` は自身の構築時に小文字化されるので、渡す値がそのまま `normalized_slug` である。

予約は operation ID ごとの 2 相で、`reserve` → workspace-local commit → `activate`。local commit が着地しなかった場合は `abandon` で補償する。slug 変更では `activate` の `releasing` に手放す側の slug を渡し、新旧の切替を 1 transaction で行う — 新しい公開 URL が有効になるまで旧 URL が解決し続け、両方が解決する窓も両方が解決しない窓も生じない。`release` は代わりを取らずに手放す唯一の経路で、ワークスペース削除が directory tombstone の ack 後に呼ぶ（同じ slug の再利用を tombstone が妨げないため）。期限を持つのは `reserved` 行だけであり、`active` な予約は所有者の `activate(releasing)` / `release` でしか解放されない。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("SLUG_ALREADY_USED")`、`SystemError(DatabaseError)`

### MembershipRepository

```ts
interface MembershipRepository extends TransactionalRepository<Membership, MembershipId> {
  findByWorkspaceAndUser(workspaceId: WorkspaceId, userId: UserId): Promise<Versioned<Membership> | null>;
  listByWorkspace(workspaceId: WorkspaceId, pagination: Pagination): Promise<PaginationResult<Membership>>;
  countByRole(workspaceId: WorkspaceId, role: WorkspaceRole): Promise<number>;
  deleteByIds(ids: readonly MembershipId[]): Promise<number>; // 最大100件
}
```

repository は current workspace scope に束縛される。slug検索、公開workspace一覧、利用者の参加workspace一覧・所有数は global D1 の `workspace_slug_reservations` / `workspace_directory` / `membership_directory` を読む query service が担う。scope内 repository に全workspace走査を持たせない。

`UserWorkspaceDirectory.listActiveByUser`はUserId shard内のactive edgeを`(created_at DESC, workspace_id)`のkeysetで読み、limitは1〜20とする。cursorはrouting generationと末尾keyを含む署名opaque値である。`WorkspaceDirectoryBatchReader.resolveMany`はpage内最大20 WorkspaceIdをhash shard別にgroupingし、最大6接続で読み、reshard中はversionが大きい行を採る。名前変更に依存しない順序なのでpage間のrenameで欠落せず、全参加workspaceの取得・メモリsortを行わない。

`UserWorkspaceDirectory.countOwnedByUser`は所有上限（[usecases/workspace.md](../usecases/workspace.md) の `createWorkspace`）の判定に使い、`role = owner`の`active` / `pending` / `activating` edgeを数える。未確定の join を含めるのは、自分の activation と競争すれば 21 件目を開けてしまうためである。`removing` edgeは席を明け渡し済みなので数えない。`limit`（1〜100）で打ち切るので戻り値は `min(実数, limit)` であり、呼び出し側は判定したい上限を渡す。

`PublicWorkspaceDirectoryReader.listPublished`はWorkspaceId hashの最大32 shardを同時6接続のwaveで読み、各shardの`(updated_at DESC, workspace_id)` keysetを署名opaque cursorへ保持して全体最大200件へmergeする。reshard中は旧新generationを読み、WorkspaceId/sourceVersionで重複排除する。総件数は数えず、サイトマップ生成側が`nextCursor`を末尾まで反復する。

directory edgeを消す前に、その利用者のJob正データ・BackupRecord・security cleanupをcurrent workspace scopeから消す。削除途中はedgeを`removing`として保持し、account deletion / integration cleanupが対象scopeを見失わないようにする。除名・脱退はこの2相を`MembershipDirectoryReservationStore.beginRemoval` / `completeRemoval`で回す。`removing` edgeは`listActiveByUser`から即座に外れるので、宣言した瞬間に一覧から消える。`(userId, workspaceId)`で鍵を引くのは、行の`operation_id`が作成した join のものであり除名側が導出できないためで、冪等性は目標状態で取る — `removing`への再実行も、消えた edge の`completeRemoval`も成功する。edgeが不在の`beginRemoval`も成功し、`pending` / `activating`（未確定の join）への両操作と、`removing`を経ていない`completeRemoval`は`ConflictError`にする。

ワークスペース削除はmanifestに固定したIDを`deleteByIds`へ最大100件ずつ渡し、Membership/Invitationを先に消してからWorkspaceを消す。メンバー数は `listByWorkspace` の `PaginationResult` から得る。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("MEMBERSHIP_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### InvitationRepository

```ts
interface InvitationRepository extends TransactionalRepository<Invitation, InvitationId> {
  findByTokenHash(tokenHash: TokenHash): Promise<Versioned<Invitation> | null>;
  findPendingByWorkspaceAndEmail(workspaceId: WorkspaceId, email: Email): Promise<Versioned<Invitation> | null>;
  listByWorkspace(workspaceId: WorkspaceId, pagination: Pagination): Promise<PaginationResult<Invitation>>;
  countPendingIssuedSince(workspaceId: WorkspaceId, since: Date): Promise<number>;
  deleteByIds(ids: readonly InvitationId[]): Promise<number>; // 最大100件
}

interface InvitationRouteStore {
  resolveActive(tokenHash: TokenHash): Promise<{ workspaceId: WorkspaceId; invitationId: InvitationId } | null>;
  reserve(input: { tokenHash: TokenHash; workspaceId: WorkspaceId; invitationId: InvitationId; operationId: string; expiresAt: Date }): Promise<void>;
  activate(input: { tokenHash: TokenHash; operationId: string }): Promise<void>;
  reserveReplacement(input: { oldTokenHash: TokenHash; newTokenHash: TokenHash; workspaceId: WorkspaceId; invitationId: InvitationId; operationId: string; expiresAt: Date }): Promise<void>;
  activateReplacement(input: { oldTokenHash: TokenHash; newTokenHash: TokenHash; invitationId: InvitationId; operationId: string }): Promise<void>;
  abandon(input: { tokenHash: TokenHash; operationId: string }): Promise<void>;
  revoke(input: { tokenHash: TokenHash; invitationId: InvitationId; operationId: string }): Promise<void>;
  consume(input: { tokenHash: TokenHash; invitationId: InvitationId; operationId: string }): Promise<void>;
}

interface MembershipDirectoryReservationStore {
  reserveAndClaimActivation(input: { operationId: string; userId: UserId; workspaceId: WorkspaceId; membershipId: MembershipId; role: WorkspaceRole; expiresAt: Date }): Promise<void>;
  activate(operationId: string): Promise<void>;
  abandon(operationId: string): Promise<void>;
  prepareAccountDeletion(input: { edgeOperationId: string; deletionOperationId: string; expiresAt: Date }): Promise<void>;
  renewAccountDeletion(edgeOperationId: string, deletionOperationId: string, expiresAt: Date): Promise<void>;
  commitAccountDeletion(edgeOperationId: string, deletionOperationId: string): Promise<void>;
  releaseAccountDeletion(edgeOperationId: string, deletionOperationId: string): Promise<void>;
  listActivatingByUser(userId: UserId, limit: number): Promise<readonly { operationId: string; workspaceId: WorkspaceId }[]>;
  beginRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
  completeRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
}

`MembershipDirectoryReservationStore`はcurrent UserId shardに束縛する。`reserveAndClaimActivation`はpending row insert、同shardのcurrent UserがActiveであることの検査、`activating`へのclaimを1 transactionで行う。Userがdeletingならrowを一切insertしない。account deletion開始前にclaim済みの`activating` edgeはaccept Sagaがactive/abandonedへ収束するまで削除manifest構築を待たせる。pending edgeのprepare/release/commitはedge operation IDとdeletion operation IDの組で冪等にする。

interface MembershipRemovalPreparationStore {
  prepare(input: { operationId: string; userId: UserId; expectedMembershipVersion: number; expiresAt: Date }): Promise<void>;
  renew(operationId: string, expiresAt: Date): Promise<void>;
  commit(operationId: string): Promise<void>;
  release(operationId: string): Promise<void>;
  hasConflict(userId: UserId): Promise<boolean>;
}

interface WorkspaceOperationLockStore {
  hasActiveMove(): Promise<boolean>;
  hasMoveConflict(userId: UserId): Promise<boolean>;
  stageMove(input: { migrationId: string; actorUserId: UserId }): Promise<void>;
  releaseMove(migrationId: string): Promise<void>;
  beginDeletion(input: { workspaceId: WorkspaceId; operationId: string; expectedWorkspaceVersion: number }): Promise<void>;
  assertWritable(): Promise<void>;
  assertDeletionOwner(operationId: string): Promise<void>;
  assertMaintenanceAllowed(kind: "jobRetention" | "outboxRelay" | "tombstonePrune"): Promise<void>;
}

interface WorkspaceDeletionManifestStore {
  appendMembershipPage(operationId: string, afterMembershipId: MembershipId | null, limit: number): Promise<Readonly<{ next: MembershipId | null; count: number }>>;
  appendInvitationPage(operationId: string, afterInvitationId: InvitationId | null, limit: number): Promise<Readonly<{ next: InvitationId | null; count: number }>>;
  markReady(operationId: string): Promise<void>;
  listLocalPending(operationId: string, limit: number): Promise<readonly WorkspaceDeletionManifestItem[]>;
  acknowledgeLocal(operationId: string, itemKeys: readonly string[]): Promise<void>;
  listItems(operationId: string, cursor: string | null, limit: number): Promise<Readonly<{ items: readonly WorkspaceDeletionManifestItem[]; nextCursor: string | null }>>;
  acknowledge(operationId: string, itemKeys: readonly string[]): Promise<void>;
  compactAcknowledged(operationId: string, limit: number): Promise<Readonly<{ removed: number; remaining: boolean }>>;
  markCompleted(operationId: string): Promise<void>;
}

type WorkspaceDeletionManifestItem =
  | Readonly<{ key: string; kind: "membership"; userId: UserId; membershipId: MembershipId; localDeletedAt: Date | null; globalAckedAt: Date | null }>
  | Readonly<{ key: string; kind: "invitation"; tokenHash: TokenHash; invitationId: InvitationId; localDeletedAt: Date | null; globalAckedAt: Date | null }>;
```

`InvitationRouteStore.resolveActive` は `active` な route を、期限切れかどうかに関わらず解決する。期限の判定は workspace scope の Invitation が持つので、route で打ち切ると preview の `expired` と accept の `InvitationExpired` が「存在しない」に潰れてしまう。書き込み側は逆で、期限を過ぎた `reserved` 行の `activate` は `ConflictError` にし、recovery が `abandon` する（[database/index.md](../database/index.md) の `invitation_routes`）。

`countPendingIssuedSince` は招待の発行上限（[usecases/workspace.md](../usecases/workspace.md) の `inviteMember`）の判定に使う。返すのは件数だけで、**枠が空く時刻は返せない** — 上限は「発行済みかつ未処理の件数」で決まり、招待が 1 件受諾されるか取り消されればその時点で枠が空くため、時刻を予告できない。この性質から、上限に達したことを表す応答は「待てば解ける」レート制限とは別のものとして扱う（[presentation/index.md](../presentation/index.md)）。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

`WorkspaceOperationLockStore`はmove authorization lockと永続的なworkspace deletion admission stateを同じworkspace DOで読む。`beginDeletion`はWorkspaceを`active → deleting(operationId)`へCASし、同じtransactionで`WorkspaceDeletionManifestStore`のheaderを`building`として作る。以後`assertWritable`はWorkspaceの`deleting`、またはWorkspace行削除後も残るmanifest headerを見て`ConflictError("WORKSPACE_DELETING")`を返す。ScopeRouterはworkspace scopeの全write command（Note/Tag/Storage/Job/Usageを含む）の入口でこれを呼ぶ。削除workerだけが`assertDeletionOwner`でWorkspace lifecycleまたはmanifest headerの同じoperation IDを確認して継続できる。`compactAcknowledged`はlocal/global双方のack済みitemだけを最大`limit`件消し、残件有無を返す。`markCompleted`はitemが0件のときだけheaderを完了tombstoneへ移す。対象actorのrole/removalとworkspace deletionはactive move中に拒否する。

move authorization lockの書き手は`stageMove` / `releaseMove`である。`moveNote`はsource freezeとtarget stageのそれぞれのlocal transaction内で`stageMove`を呼び、lockと、それが認可する行を同じtransactionで確定する。`stageMove`は`migrationId`について冪等で、同じactorの再実行は成功し、別のactorを指す再実行は`ConflictError("MOVE_AUTHORIZATION_LOCK_CONFLICT")`にする（actorはoperation payloadで固定されているため、live lockの指し替えは常に欠陥である）。lockどうしは排他しない — 同じscopeに複数のmigrationのlockが立ちうる。`releaseMove`は無条件かつ冪等で、route switch後のtarget activate、source retire、switch前abortの両scopeがこれを呼ぶ。`stageMove`自身はdeletion admissionを見ない（`beginDeletion`が`hasActiveMove`を見ないのと同じ理由で、呼び出し側が同じtransactionで`assertWritable`を呼ぶ）。lease・expiryは無く、行の存在そのものがlockである。

Workspace削除後も意図的に残すoutbox、Job履歴正データ、compact tombstoneの回収だけは`assertMaintenanceAllowed`で通す。allowlistは`jobRetention` / `outboxRelay` / `tombstonePrune`に閉じ、create/retry/progressなど業務状態を増やす操作は含めない。maintenance taskは利用者commandへ派生せず、削除済み行の縮約だけを行う。

削除受理後は利用者によるabortを提供せず、失敗時も同じoperation IDでforward recoveryする。manifest/CASCADE/global cleanupが複数turnに跨ってもactiveへ戻さないため、cursor通過後に新しいedge/Job/Noteが入らない。`WorkspaceDeletionManifestStore`は同じUoWでpage itemとcursorを保存し、全global ack後に完了tombstoneへ縮約する。tombstoneはscope routingの保持期間以上残し、削除済みscope宛ての遅延writeを恒久的に拒否する。

membership removal prepare leaseはTTL 10分、orchestratorは2分ごとにrenewする。`hasConflict`は期限を過ぎたprepared lockも自動で無効にせず、安全側に拒否する。global recoveryだけがD1 operationをprimaryで確認し、`running`ならrenew、`rejected` / `completed`ならreleaseする。commit開始前に全lockの残存5分以上を確認し、各lockを`committed`へ遷移してからdestructive cleanupを始める。committed lockは自動失効せず完了/recoveryがreleaseする。

## ドメインイベント

Workspace / Membership / Invitation の正データは workspace scope DO に置く。`workspace.*` event は global D1 の `workspace_directory` を更新するが、権限判定は必ず scope DO の Membership で行う。membership 作成前には D1 に pending edge を予約し、scope-local commit 後に active にする。削除は scope-local job termination と membership removal を先に commit し、その後 directory edge を消す。

用途欄の 3 分類は [identity.md](./identity.md) のドメインイベント節と同じ規約に従う。

| 型 | payload | 用途 |
| --- | --- | --- |
| `workspace.created` | `{ workspaceId, ownerId }` | Usage のクォータ行の初期化（[`initializeQuota`](../usecases/usage.md)）。読み取りモデルの投影は購読しない（`createWorkspace` はノートを 1 件も作らず、作成直後のワークスペースには投影対象の行が存在しないため。[usecases/note.md](../usecases/note.md) の `projectNoteChanges`） |
| `workspace.profileUpdated` | `{ workspaceId, name }` | 読み取りモデルの投影（`projectNoteChanges` のワークスペース名） |
| `workspace.slugChanged` | `{ workspaceId, previousSlug, currentSlug }` | 読み取りモデルの投影（`projectNoteChanges` のスラッグ） |
| `workspace.published` | `{ workspaceId, slug }` | 読み取りモデルの投影（`projectNoteChanges` の公開状態） |
| `workspace.unpublished` | `{ workspaceId }` | 読み取りモデルの投影（`projectNoteChanges` の公開状態） |
| `workspace.deleted` | `{ workspaceId, operationId }` | Note / Tag / Storage / Usage の後始末。global directory cleanupは削除前manifestのroute keyを使う |
| `workspace.membership.added` | `{ workspaceId, userId, role }` | 監査 |
| `workspace.membership.roleChanged` | `{ workspaceId, userId, previousRole, currentRole }` | 監査（購読者なし。降格に伴う実行中ジョブの取り消しは `changeMemberRole` が同じ手順の中で行う） |
| `workspace.membership.removed` | `{ workspaceId, userId }` | 監査（購読者なし。実行中ジョブの取り消しは `removeMember` / `leaveWorkspace` が同じ手順の中で行う） |
| `workspace.invitation.created` | `{ invitationId, workspaceId, email, role }` | 監査（購読者なし。招待メールの送信は `inviteMember` / `resendInvitation` が同じ手順の中で `MailSender.send` を呼んで行う） |
| `workspace.invitation.accepted` | `{ invitationId, workspaceId, userId }` | 監査 |
| `workspace.invitation.revoked` | `{ invitationId, workspaceId }` | 監査 |

招待メールをアウトボックス経由にしない（`invitation.created` に送信の購読者を置かない）のは意図した設計判断である。送信結果を要求の応答に反映して「招待を送りました」を即時に返すため、`MailSender` は呼び出し元が同期的に呼ぶ。代償として再送保証はなく、送信の失敗は記録して継続し招待自体は成立させる（[domains/index.md](./index.md) の `MailSender`）。届かなかった相手には `resendInvitation` で送り直す。

サイトマップは購読で更新しない（`listPublicWorkspaces` が要求のたびに現在の状態から列挙する引き取り型のため）。公開ページのキャッシュについても、無効化の仕組みを本設計は持たない。

読み取りモデルへ投影されるworkspace eventのpayloadも変化の通知にとどめる。workspace scope内のlocal writerとglobal public writerは、Workspaceのcurrent snapshotから `name` / `slug` / `published` の組を解決する（[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）。

## エラーコード

```
WorkspaceErrorCode =
  | "InvalidId" | "InvalidSlug" | "SlugReserved" | "InvalidName" | "InvalidDescription"
  | "InvalidRole" | "InsufficientRole"
  | "SlugRequiredToPublish" | "PublishedWorkspaceRequiresSlug"
  | "LastOwnerCannotLeave" | "CannotChangeOwnRole" | "CannotRemoveSelf" | "WorkspaceQuotaExceeded"
  | "InvitationExpired"
```

## ユースケース（概要）

`resolveWorkspaceAccess`, `createWorkspace`, `updateWorkspaceProfile`, `changeWorkspaceSlug`, `publishWorkspace`, `unpublishWorkspace`, `deleteWorkspace`, `inviteMember`, `resendInvitation`, `revokeInvitation`, `getInvitationPreview`, `acceptInvitation`, `listMembers`, `listPendingInvitations`, `listUserWorkspaces`, `changeMemberRole`, `removeMember`, `leaveWorkspace`, `deleteMembershipsForUser`, `listPublicWorkspaces`, `getPublicWorkspace`

詳細は [usecases/workspace.md](../usecases/workspace.md)。
