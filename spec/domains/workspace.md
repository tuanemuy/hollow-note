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
| `changeRole` | `membership: Membership, role: string, now: Date` | `WithEventDrafts<Membership, WorkspaceEvent>` | 同じロールなら変更せずイベントも出さない。異なれば更新し `membership.roleChanged`（旧ロールと、自身の `membershipId`、変更後の `version` を `sourceVersion` として含む）を発行 |

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

- `(workspaceId, email)` に対して `pending` の招待は最大 1 件。これは `inviteMember` が既存の pending を引いて resend へ畳むことで保つ規則であり、**store は強制しない**（[database/index.md](../database/index.md) の `invitations`。部分 UNIQUE 索引を置かない理由はそこにある）。同時に発行された 2 件はどちらも成立しうる
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
  countSettledByUser(userId: UserId, limit: number): Promise<number>; // limitで打ち切る
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
  applySnapshotIfNewer(snapshot: WorkspaceDirectorySnapshot): Promise<void>;
  tombstone(input: { workspaceId: WorkspaceId; operationId: string }): Promise<void>;
}

interface WorkspaceSlugReservationStore {
  resolveActive(slug: WorkspaceSlug): Promise<WorkspaceId | null>;
  reserve(input: { slug: WorkspaceSlug; workspaceId: WorkspaceId; operationId: string; attemptId: string; expiresAt: Date }): Promise<void>;
  activate(input: { slug: WorkspaceSlug; workspaceId: WorkspaceId; operationId: string; releasing: WorkspaceSlug | null }): Promise<void>;
  abandon(input: { slug: WorkspaceSlug; operationId: string; attemptId: string }): Promise<void>;
  release(input: { slug: WorkspaceSlug; workspaceId: WorkspaceId }): Promise<void>;
}
```

`WorkspaceDirectoryProjectionWriter` は `workspace_directory` の唯一の書き手で、呼び出し口は 2 つある。`applySnapshotIfNewer` は**要求パスが scope-local commit の直後に同期的に 1 件送る best-effort** であり（ワークスペースの作成・プロフィール更新・スラッグ変更・公開 / 非公開化がそれぞれ自分で送る）、`tombstone` はワークスペース削除のワーカー面だけが送る。投影を駆動する購読者は置かない — したがって**応答を失った snapshot を打ち直す主体は今日いない**。失った窓は「改名・公開切替が `/w/:slug` と参加中の一覧に反映されないまま残る」ことで、利用者が同じ値を保存し直せば復旧する。修復の駆動口を足すのは別スライスの持ち分であり、この投影をイベント名で語ってはならない — 下の「ドメインイベント」表のとおり、`workspace_directory` の行を投影するために購読されるイベントは 1 つも無い（edge の `role` を投影する `workspace.membership.roleChanged` は別のポートの話である）。

順序は `sourceVersion` だけで決める — 保存済みの版以下の snapshot は何も書かない。1 つの規則が stale な snapshot と応答喪失の再送の両方を畳むので、同じ snapshot を何度送っても害はない。**どちらだったかは答えない**（ガード付き UPDATE が 0 行だったことを報告できないバックエンドがあり、呼び出し側も必要としない。投影は誰が書いたかに関わらず最大の版へ収束する）。tombstone は終端で、どの版の snapshot も再開させない（削除済み workspace が一覧やサイトマップへ戻らないため）。同じ operation ID の tombstone は冪等、別 operation の tombstone は `ConflictError`。`slug` は書き込み時に他の行から奪う（[database/index.md](../database/index.md) の `workspace_directory`）。奪う操作と snapshot の適用は 1 段である — **何も書かない snapshot（stale、または tombstone 済みの行に対するもの）は何も奪わない**。剥がしだけが適用より長生きすると、第三者のワークスペースが slug を失ったまま誰にも取られず、その行自身の次の snapshot 適用までサイトマップから黙って消える。

`WorkspaceRepository` は current workspace scope に束縛されて自 scope の 1 行しか見えないので、slug の global uniqueness は `WorkspaceSlugReservationStore` が global D1 の `workspace_slug_reservations` で担う。`ConflictError("SLUG_ALREADY_USED")` を返すのはこのポートであり、`WorkspaceRepository` ではない。`WorkspaceSlug` は自身の構築時に小文字化されるので、渡す値がそのまま `normalized_slug` である。

予約は operation ID ごとの 2 相で、`reserve` → workspace-local commit → `activate`。local commit が着地しなかった場合は `abandon` で補償する。slug 変更では `activate` の `releasing` に手放す側の slug を渡し、新旧の切替を 1 transaction で行う — 新しい公開 URL が有効になるまで旧 URL が解決し続け、両方が解決する窓も両方が解決しない窓も生じない。`release` は代わりを取らずに手放す唯一の経路で、呼び出し元は 2 つある — ワークスペース削除が directory tombstone の ack 後に呼ぶ場合（同じ slug の再利用を tombstone が妨げないため）と、`changeWorkspaceSlug` が slug を `null` にする場合（次の予約が無いので `activate(releasing)` の交換が使えない）である。期限を持つのは `reserved` 行だけであり、`active` な予約は所有者の `activate(releasing)` / `release` でしか解放されない。`release` が解放するのも `active` 行だけである — **同じ workspace 自身の `reserved` 行は解放せず、expiry が回収する**。判断材料になる operation ID を `release` は持たないので、落とすとこれから `activate` する走行中の改名の足元から予約を抜くことになり、しかも呼び出し元は保持鍵ではなく候補を名指すので `reserved` 行には日常的に届く。**したがって手放す鍵は候補を 1 つに決めず、scope の現在値と `workspace_directory` の広告値の両方を解放する。** 2 つの候補は逆向きの窓でそれぞれ外れる — `activate` を恒久的に失った workspace は scope だけが新しい slug へ進むので鍵を名指すのは directory 行だけになり、投影を恒久的に失った workspace は global だけが進むので鍵を名指すのは scope だけになる（投影は再送されない）。どちらを選んでも他方を取り残すが、`activate` / `release` はどちらも「その workspace が `active` で保持している間だけ」解放する条件付き操作なので、外れた候補を渡した呼び出しは何も書かない。取り残しは復旧不能（`active` な予約に期限は無く、回収する掃除も無い）で、外すコストは無いので、両方に打つのが唯一の非対称でない選択になる。**ただし 2 候補が保持鍵を名指すのは、2 面のうち高々片側が 1 回だけ置き去りにされた場合までである** — 投影を恒久的に失って（scope `B` / directory `A` / 鍵 `B`）から、`activate` を恒久的に失う `C` への改名が scope だけを進めると、scope `C` / directory `A` / 鍵 `B` になり、保持鍵はどちらの候補でもなくなる。この鍵を解放できる主体は今日いない。ポートが「この workspace が保持している鍵」を逆に引けないためで、両側 1 回ずつの恒久失敗より先に断言は届かない。scope が手放す鍵だけは `activate` の `releasing` に載せ（新旧の URL が同時に切り替わる窓を保つため）、もう一方は同じ位置で、**`activate` の後段**に単独の `release` として打つ（`activate` が着地するまでは広告値のほうが唯一まだ解決している鍵でありうるため、生きた公開 URL を交換の前に手放さない）。解放はどちらも投影より先に置く（投影が先に走ると directory 行の slug が上書きされ、広告値を辿る唯一の手掛かりが消える）。

operation ID は 1 回の要求ではなく 1 つの改名を指すことがある — `changeWorkspaceSlug` は `(workspaceId, slug)` から採番するので、応答を失った再試行が先行の行に着地する — ため、同じ改名の 2 つの試行が 1 行を共有しうる。両者を分けるのが `attemptId` で、用途は `abandon` だけである: **`reserved` 行は最後に予約した試行のものであり、補償を打てるのはその試行だけ**とする。そうしないと、自分の理由で失敗した試行（読みの間に失ったロール、拒否したバリア）が、これから `activate` する走行中の試行の行を落とし、scope だけが slug を持ち global に予約が無い状態になる。握られるのが `reserved` 行だけなのは、`abandon` が落とせるのが `reserved` 行だけだからである — 同じ operation で既に `active` な行に `reserve` が届いても試行は付け替えず、そのまま残す（`active` 行には補償が無いので、後から来た試行が奪う claim も無い）。`activate` は試行に依らない — 着地したのはその改名であって、どの試行が予約したかは問わない。`createWorkspace` は要求ごとの operation ID をそのまま `attemptId` に使う（1 要求 = 1 試行なので分ける意味がない）。

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

`UserWorkspaceDirectory.countSettledByUser`はロールを問わず**確定した** edge（`active` / `pending` / `removing`）を数える。これは account deletion の manifest が membership item として固定する集合（`AccountDeletionManifestStore.appendMembershipPage`）と同じ述語であり、`activating` を除くのも同じ理由 — まだ確定していない join のものなので、働きかけられる確定状態を持たない。`listActiveByUser`は`pending` / `removing`を隠すので代用にならない。打ち切りは`countOwnedByUser`と同じ契約で、`limit`は1〜100、戻り値は`min(実数, limit)`、範囲外は`ValidationError("INVALID_PAGINATION")`とする。「1件でもあるか」だけを問う呼び出し側は`limit: 1`を渡す。

**この count 単独では「この利用者を取り壊してよいか」の述語にならない。** `activating` は join が claim してから `activate` が返るまでの全区間に置かれる状態なので、これだけを見ると [claim, activate] の窓で 0 を読む。したがってアカウント削除の受理は本 count と `MembershipDirectoryReservationStore.listActivatingByUser` の**2 本**で判定し、どちらかが 1 件でもあれば退ける（[usecases/identity.md](../usecases/identity.md) の `deleteAccount` 手順 2）。この 2 本は directory の読みとしては例外的に受理の transaction の**中**で取る — 判定を transaction の外へ出すと、読みと `deleting` への遷移のあいだに着地した join がそのまま受理の後ろで settle し、ack する主体の無い membership item が固定されるためである。ディレクトリの**書き**は従来どおりどの UoW にも属さない。

`PublicWorkspaceDirectoryReader.listPublished`はWorkspaceId hashの最大32 shardを同時6接続のwaveで読み、各shardの`(updated_at DESC, workspace_id)` keysetを署名opaque cursorへ保持して全体最大200件へmergeする。reshard中は旧新generationを読み、WorkspaceId/sourceVersionで重複排除する。総件数は数えず、サイトマップ生成側が`nextCursor`を末尾まで反復する。

directory edgeを消す前に、その利用者のJob正データ・BackupRecord・security cleanupをcurrent workspace scopeから消す。削除途中はedgeを`removing`として保持し、account deletion / integration cleanupが対象scopeを見失わないようにする。除名・脱退はこの2相を`MembershipDirectoryReservationStore.beginRemoval` / `completeRemoval`で回す。`removing` edgeは`listActiveByUser`から即座に外れるので、宣言した瞬間に一覧から消える。`(userId, workspaceId)`で鍵を引くのは、行の`operation_id`が作成した join のものであり除名側が導出できないためで、冪等性は目標状態で取る — `removing`への再実行も、消えた edge の`completeRemoval`も成功する。edgeが不在の`beginRemoval`も成功し、`removing`を経ていない`completeRemoval`は`ConflictError`にする。

除名は可逆で、`abandonRemoval`が`removing → active`を戻す。除名・脱退の規則は宣言の前と削除transactionの中の2回評価され、2回目が拒否しうる（同時に2人のownerを外す2つの除名は、1回目を両方通り2回目を片方しか通らない）。この遷移が無いと、負けた側のedgeが`removing`のまま残り、まだownerである利用者の一覧からワークスペースが消えたまま戻せなくなる。冪等性は同じく目標状態で取る — 既に`active`も、`completeRemoval`まで進んで不在になったedgeも成功する。

`beginRemoval`は`active`に加えて`activating`も受ける。`activating`は`activate`が着地しなかったjoinが残す状態で、membershipが在るかどうかの正本は呼び出し側が既に読んだworkspace scopeである。拒否すると、edgeが確定しなかったメンバーを永久に除名できず、manifestを歩くワークスペース削除がその item で止まる。join側は`activate`を失うが、その補償（`abandon`）は`pending` / `activating`に閉じているので除名を打ち消さない。`pending`だけは引き続き`ConflictError`にする — account deletionのprepare lockが持つ状態であり、既に判断を下した削除に逆らうことになるためである。`abandonRemoval`は逆に`pending` / `activating`を`ConflictError`にする（どの除名もそれらを宣言していないので、戻す対象が無い）。

ワークスペース削除はmanifestに固定したIDを`deleteByIds`へ最大100件ずつ渡し、Membership/Invitationを先に消してからWorkspaceを消す。メンバー数は `listByWorkspace` の `PaginationResult` から得る。

`MembershipRepository.listByWorkspace` と `InvitationRepository.listByWorkspace` / `listPendingByWorkspace` の 3 本は、**自分の transaction の書き込みを観測しない**。offset のページは未コミットの変更から組み直せないため、**どのバックエンドでも**最後にコミットされた状態から答える — 同じ unit of work の insert も `deleteByIds` も見えない。バックエンドごとの裁量ではない: 判定が「書き込みをどう stage するか」に依存すると、削除の掃引が一方では終端し他方では周回する。したがって同じ transaction の中では書き込みより前に呼ぶか、別の turn で呼ぶ — 削除の掃引は後者で、何も消さない turn で残件を探る。これらを除く読み（`findById` 系・`countByRole`・`countPendingIssuedSince`）は自 UoW の書き込みを観測する。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("MEMBERSHIP_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### InvitationRepository

```ts
interface InvitationRepository extends TransactionalRepository<Invitation, InvitationId> {
  findByTokenHash(tokenHash: TokenHash): Promise<Versioned<Invitation> | null>;
  findPendingByWorkspaceAndEmail(workspaceId: WorkspaceId, email: Email): Promise<Versioned<Invitation> | null>;
  listByWorkspace(workspaceId: WorkspaceId, pagination: Pagination): Promise<PaginationResult<Invitation>>;
  listPendingByWorkspace(workspaceId: WorkspaceId, pagination: Pagination): Promise<PaginationResult<Invitation>>;
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
  applyRoleIfNewer(input: { userId: UserId; workspaceId: WorkspaceId; membershipId: MembershipId; role: WorkspaceRole; sourceVersion: number }): Promise<void>;
  beginRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
  abandonRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
  completeRemoval(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
}
```

`MembershipDirectoryReservationStore`はcurrent UserId shardに束縛する。`reserveAndClaimActivation`はpending row insert、同shardのcurrent UserがActiveであることの検査、`activating`へのclaimを1 transactionで行う。Userがdeletingならrowを一切insertしない。**予約は `membershipId` を必須引数として受け、どの状態で行が止まっても書く** — workspace-local な Membership の実在に先立って予約するが、ID は予約より前に採番されている。これにより `activate` は operation ID だけで足り、settled でない edge も自分の世代を名乗る。account deletion開始前にclaim済みの`activating` edgeはaccept Sagaがactive/abandonedへ収束するまで削除manifest構築を待たせる。pending edgeのprepare/release/commitはedge operation IDとdeletion operation IDの組で冪等にする。

`abandon`は`active` / `removing`に加えて**account deletion の prepare lock が付いた edge も触らない**。その edge については削除側が既に判断を下しており、取り消せるのは`commitAccountDeletion`だけである（join は同じ lock に`activate`を拒まれているので、ここで行を落とすと削除の対象が足元から消え、manifest の cursor の後ろで別の join が同じ pair を取り直せてしまう）。

`applyRoleIfNewer`は`workspace.membership.roleChanged`をedgeの`role`へ投影する唯一の書き手で、`listActiveByUser`が返すroleはこのedgeからしか来ない。書くのは**その`membershipId`を名指ししているedge**に限り、そのうえで順序を`sourceVersion`（変更後のMembershipの版）だけで決め、保存済みの版**より大きい**ときだけ書く。予約が運んだ初期roleはどの版よりも古いものとして扱う。版の規則が兼ねるのは**同じ世代の中の3つ**（再配送・後着・同時適用）である — 同じ変更の再配送は版が大きくならないので何も書かず、後から届いた古い変更はroleを巻き戻さず、同時適用は保存済み行との比較なので版が大きい方が勝つ。世代をまたぐ4つ目は`membershipId`の照合が持つ: 版が並べるのは1つのMembershipの中の変更だけなので、照合を欠くと除名→再入会で作り直されたedge（`role_source_version`が`null`に戻る）へ前の世代の後着が通り、続けて新しいMembershipの最初の変更が版比較で落ちる。鍵は`beginRemoval`と同じ`(userId, workspaceId)`で、行の`operation_id`はjoinのものであり role 変更側が導出できない。そのmembershipを名指しする`activating` edgeにも適用する（`activate`はroleを触らないため、未確定のまま届いた変更を落とすとroleが取り残される）。**edgeが不在なら何もせず、決してinsertしない** — 除名後に届いた古い変更が削除済みedgeを復活させないため。**別の**membershipを名指しするedgeも同じ理由で何も書かない。どのmembershipも名指していないedgeも書かない — 予約は全状態で`membershipId`を書くので、名指しの無い行はこの変更が属する世代ではありえず、識別できない行へ投影するのではなく fail closed で落とす。この呼び出しが書き手だったかどうかは`applySnapshotIfNewer`と同じ理由で答えない。

```ts
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

`activateReplacement` は旧新 route の交換を 1 transaction で行うが、**replacement が既に閉じられている（再送の local commit 後・交換前に `revokeInvitation` が新トークンを閉じた）場合でも、同じ招待の旧 route が `active` ならそれを閉じてから成功する**。閉じた route を開き直す経路は無いので replacement は開かないが、旧 route を残すと、取り消された招待を指す live なトークンが期限も回収経路も無いまま残り続ける。別の招待に結び付いた旧 route は触らない。

`listByWorkspace` と `listPendingByWorkspace` はどちらも `createdAt DESC, id DESC` の全順序で読む（`id` の tiebreak が無いと同時刻の招待が page 間で重複・欠落しうる）。分かれているのは絞り込みの位置である。`listByWorkspace` は status を絞らず、削除 manifest が歩く列挙であり `count` はワークスペースの招待総数になる。画面が引く保留中一覧は `listPendingByWorkspace` を使い、`count` は保留中の総数になる — page を引いてから絞ると、終端状態の招待が 1 ページ分並んだだけで保留中の招待が隠れ、件数も縮む。期限切れは status ではないので、期限を過ぎた `pending` はどちらにも返り続ける（判定は `Invitation.isExpired` が呼び出し側の `now` に対して行う）。どちらも `MembershipRepository.listByWorkspace` と同じく最後にコミットされた状態から答える（`MembershipRepository` の節）。

`countPendingIssuedSince` は招待の発行上限（[usecases/workspace.md](../usecases/workspace.md) の `inviteMember`）の判定に使う。返すのは件数だけで、**枠が空く時刻は返せない** — 上限は「発行済みかつ未処理の件数」で決まり、招待が 1 件受諾されるか取り消されればその時点で枠が空くため、時刻を予告できない。この性質から、上限に達したことを表す応答は「待てば解ける」レート制限とは別のものとして扱う（[presentation/index.md](../presentation/index.md)）。2 つの listing とは逆に、この count は `countByRole` と同じく自 UoW の書き込みを観測する — 発行する transaction の中で枠を決めるので、同じ unit が既に書いた招待を数え落とすと次の発行が上限を越える。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

`WorkspaceOperationLockStore`はmove authorization lockと永続的なworkspace deletion admission stateを同じworkspace DOで読む。`beginDeletion`はWorkspaceを`active → deleting(operationId)`へCASし、同じtransactionで`WorkspaceDeletionManifestStore`のheaderを`building`として作る。以後`assertWritable`はWorkspaceの`deleting`、またはWorkspace行削除後も残るmanifest headerを見て`ConflictError("WORKSPACE_DELETING")`を返す。ScopeRouterはworkspace scopeの全write command（Note/Tag/Storage/Job/Usageを含む）の入口でこれを呼ぶ。削除workerだけが`assertDeletionOwner`でWorkspace lifecycleまたはmanifest headerの同じoperation IDを確認して継続できる。`compactAcknowledged`はlocal/global双方のack済みitemだけを最大`limit`件消し、残件有無を返す。`markCompleted`はitemが0件のときだけheaderを完了tombstoneへ移す。対象actorのrole/removalとworkspace deletionはactive move中に拒否する。

move authorization lockの書き手は`stageMove` / `releaseMove`である。`moveNote`はsource freezeとtarget stageのそれぞれのlocal transaction内で`stageMove`を呼び、lockと、それが認可する行を同じtransactionで確定する。`stageMove`は`migrationId`について冪等で、同じactorの再実行は成功し、別のactorを指す再実行は`ConflictError("MOVE_AUTHORIZATION_LOCK_CONFLICT")`にする（actorはoperation payloadで固定されているため、live lockの指し替えは常に欠陥である）。lockどうしは排他しない — 同じscopeに複数のmigrationのlockが立ちうる。`releaseMove`は無条件かつ冪等で、route switch後のtarget activate、source retire、switch前abortの両scopeがこれを呼ぶ。`stageMove`自身はdeletion admissionを見ない（`beginDeletion`が`hasActiveMove`を見ないのと同じ理由で、呼び出し側が同じtransactionで`assertWritable`を呼ぶ）。lease・expiryは無く、行の存在そのものがlockである。

Workspace削除後も意図的に残すoutbox、Job履歴正データ、compact tombstoneの回収だけは`assertMaintenanceAllowed`で通す。allowlistは`jobRetention` / `outboxRelay` / `tombstonePrune`に閉じ、create/retry/progressなど業務状態を増やす操作は含めない。maintenance taskは利用者commandへ派生せず、削除済み行の縮約だけを行う。

削除受理後は利用者によるabortを提供せず、失敗時も同じoperation IDでforward recoveryする。manifest/CASCADE/global cleanupが複数turnに跨ってもactiveへ戻さないため、cursor通過後に新しいedge/Job/Noteが入らない。`WorkspaceDeletionManifestStore`は同じUoWでpage itemとcursorを保存し、全global ack後に完了tombstoneへ縮約する。tombstoneはscope routingの保持期間以上残し、削除済みscope宛ての遅延writeを恒久的に拒否する。

`WorkspaceDeletionManifestStore` の読みは 2 種に分かれ、同じ transaction に対する見え方が逆になる。**状態のガード**（`markReady` / `markCompleted` が見る header と残件）は自分の transaction が既に行った書き込みを観測する — だからこそ 1 つの turn が最終ページを固定してそのまま manifest を ready にでき、最後の item を縮約してそのまま完了にできる。**ページの読み**（`listLocalPending` / `listItems` / 縮約が引くページ）は逆で、その transaction が manifest へ書く**前**に行わなければならない。未コミットの変更から組み直したページは短くなったり順序が崩れたりするので、バックエンドは答える代わりに拒否してよい。したがって各 turn は先頭でページを読み、書き込みを最後に置く。

membership removal prepare leaseはTTL 10分、orchestratorは2分ごとにrenewする。`hasConflict`は期限を過ぎたprepared lockも自動で無効にせず、安全側に拒否する。global recoveryだけがD1 operationをprimaryで確認し、`running`ならrenew、`rejected` / `completed`ならreleaseする。commit開始前に全lockの残存5分以上を確認し、各lockを`committed`へ遷移してからdestructive cleanupを始める。committed lockは自動失効せず完了/recoveryがreleaseする。

## ドメインイベント

Workspace / Membership / Invitation の正データは workspace scope DO に置く。global D1 の `workspace_directory` を更新するのはイベントではなく `WorkspaceDirectoryProjectionWriter` である（[WorkspaceRepository](#workspacerepository) 節のとおり、要求パスと削除ワーカーが名指しで呼ぶ）。権限判定は必ず scope DO の Membership で行う。membership 作成前には D1 に pending edge を予約し、scope-local commit 後に active にする。削除は scope-local job termination と membership removal を先に commit し、その後 directory edge を消す。

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
| `workspace.membership.roleChanged` | `{ workspaceId, userId, membershipId, previousRole, currentRole, sourceVersion }` | `membership_directory` edge の `role` の投影（`MembershipDirectoryReservationStore.applyRoleIfNewer`）。`membershipId` は `sourceVersion` がどの世代を数えた版かを名指しする（版は 1 つの Membership の中でしか比較できず、除名と再入会は 0 から数え直す）。降格に伴う実行中ジョブの取り消しは購読ではなく `changeMemberRole` が同じ手順の中で行う |
| `workspace.membership.removed` | `{ workspaceId, userId }` | 監査（購読者なし。実行中ジョブの取り消しは `removeMember` / `leaveWorkspace` が同じ手順の中で行う。directory edge の撤去も同様で、`beginRemoval` → local commit → `completeRemoval` の 2 相を購読者が二重に消しにいくと、後始末の ack を待つ `removing` edge を落としうる） |
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

`resolveWorkspaceAccess`, `createWorkspace`, `updateWorkspaceProfile`, `getWorkspaceSettings`, `changeWorkspaceSlug`, `checkWorkspaceSlugAvailability`, `publishWorkspace`, `unpublishWorkspace`, `getWorkspacePublication`, `deleteWorkspace`, `getWorkspaceDeletionStatus`, `inviteMember`, `resendInvitation`, `revokeInvitation`, `getInvitationPreview`, `acceptInvitation`, `listMembers`, `listPendingInvitations`, `listUserWorkspaces`, `changeMemberRole`, `removeMember`, `leaveWorkspace`, `deleteMembershipsForUser`, `listPublicWorkspaces`, `getPublicWorkspace`

詳細は [usecases/workspace.md](../usecases/workspace.md)。
