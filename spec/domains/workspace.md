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
  avatarUrl: string | null
  slug: WorkspaceSlug | null
  version: number
  createdAt: Date
  updatedAt: Date
}

PrivateWorkspace   = WorkspaceBase & { publication: "private" }
PublishedWorkspace = WorkspaceBase & { publication: "published", slug: WorkspaceSlug, publishedAt: Date }
Workspace = PrivateWorkspace | PublishedWorkspace
```

`PublishedWorkspace` は `slug` を必須で持つ。これにより「公開なのにスラッグがない」状態が型として表現できない。

**不変条件**

- `slug` は設定されていればサービス全体で一意
- 公開中はスラッグを空にできない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; name: string; description: string; slug: string \| null }, now: Date` | `WithEventDrafts<PrivateWorkspace, WorkspaceEvent>` | 非公開で生成。`workspace.created` を発行 |
| `updateProfile` | `workspace: Workspace, params: { name?: string; description?: string; avatarUrl?: string \| null }, now: Date` | `WithEventDrafts<Workspace, WorkspaceEvent>` | 指定項目のみ更新。公開状態は保つ |
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
- 1 つのワークスペースには常に 1 名以上の `owner` がいる（`MembershipPolicy` が検査する）

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
| `can` | `role: WorkspaceRole, action: WorkspaceAction` | `boolean` | 下表に従う |
| `ensureCan` | `role: WorkspaceRole, action: WorkspaceAction` | `void` | 不可なら `BusinessRuleError(InsufficientRole)` |
| `minimumRoleFor` | `action: WorkspaceAction` | `WorkspaceRole` | 操作に必要な最小ロール |

| 操作 | 必要な最小ロール |
| --- | --- |
| `viewNote`, `downloadNote` | viewer |
| `createNote`, `editNote`, `deleteNote`, `changeNoteVisibility`, `moveNote`, `manageTags`, `viewTrash` | editor |
| `manageMembers`, `manageWorkspace`, `publishWorkspace`, `deleteWorkspace` | owner |

**依存するポート**: なし

### MembershipPolicy

**責務**: ワークスペースのメンバー集合に対する規則を検査する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureOwnerRemains` | `ownerCount: number, target: Membership, nextRole: WorkspaceRole \| null` | `void` | 対象が `owner` で、変更・除名後に `owner` が 0 人になるなら `BusinessRuleError(LastOwnerCannotLeave)`。`nextRole` が `null` は除名を表す |
| `ensureNotSelfRoleChange` | `actor: UserId, target: Membership` | `void` | 自分自身のロール変更なら `BusinessRuleError(CannotChangeOwnRole)` |
| `ensureWorkspaceQuota` | `ownedCount: number` | `void` | 20 件以上を所有していれば `BusinessRuleError(WorkspaceQuotaExceeded)` |

**依存するポート**: なし

## ポート

### WorkspaceRepository

```ts
interface WorkspaceRepository extends TransactionalRepository<Workspace, WorkspaceId> {
  findBySlug(slug: WorkspaceSlug): Promise<Workspace | null>;
  existsBySlug(slug: WorkspaceSlug, excluding: WorkspaceId | null): Promise<boolean>;
  listByIds(ids: readonly WorkspaceId[]): Promise<readonly Workspace[]>;
  countOwnedBy(userId: UserId): Promise<number>;
  findPublishedPage(pagination: Pagination): Promise<PaginationResult<PublishedWorkspace>>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("SLUG_ALREADY_USED")`、`SystemError(DatabaseError)`

### MembershipRepository

```ts
interface MembershipRepository extends TransactionalRepository<Membership, MembershipId> {
  findByWorkspaceAndUser(workspaceId: WorkspaceId, userId: UserId): Promise<Versioned<Membership> | null>;
  listByWorkspace(workspaceId: WorkspaceId, pagination: Pagination): Promise<PaginationResult<Membership>>;
  listByUser(userId: UserId): Promise<readonly Membership[]>;
  countByRole(workspaceId: WorkspaceId, role: WorkspaceRole): Promise<number>;
  countByWorkspace(workspaceId: WorkspaceId): Promise<number>;
  deleteByWorkspace(workspaceId: WorkspaceId): Promise<number>;
  deleteByUser(userId: UserId): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("MEMBERSHIP_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### InvitationRepository

```ts
interface InvitationRepository extends TransactionalRepository<Invitation, InvitationId> {
  findByTokenHash(tokenHash: TokenHash): Promise<Versioned<Invitation> | null>;
  findPendingByWorkspaceAndEmail(workspaceId: WorkspaceId, email: Email): Promise<Versioned<Invitation> | null>;
  listByWorkspace(workspaceId: WorkspaceId, pagination: Pagination): Promise<PaginationResult<Invitation>>;
  countPendingIssuedSince(workspaceId: WorkspaceId, since: Date): Promise<number>;
  deleteByWorkspace(workspaceId: WorkspaceId): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `workspace.created` | `{ workspaceId, ownerId }` | Usage のクォータ行を初期化する |
| `workspace.slugChanged` | `{ workspaceId, previousSlug, currentSlug }` | 公開ページのキャッシュ・サイトマップの更新 |
| `workspace.published` | `{ workspaceId, slug }` | サイトマップの更新 |
| `workspace.unpublished` | `{ workspaceId }` | サイトマップの更新 |
| `workspace.deleted` | `{ workspaceId }` | Note / Tag / Storage / Usage の後始末 |
| `workspace.membership.added` | `{ workspaceId, userId, role }` | 監査 |
| `workspace.membership.roleChanged` | `{ workspaceId, userId, previousRole, currentRole }` | 監査 |
| `workspace.membership.removed` | `{ workspaceId, userId }` | 実行中ジョブの整理 |
| `workspace.invitation.created` | `{ invitationId, workspaceId, email, role }` | 招待メールの送信 |
| `workspace.invitation.accepted` | `{ invitationId, workspaceId, userId }` | 監査 |
| `workspace.invitation.revoked` | `{ invitationId, workspaceId }` | 監査 |

## エラーコード

```
WorkspaceErrorCode =
  | "InvalidId" | "InvalidSlug" | "SlugReserved" | "InvalidName" | "InvalidDescription"
  | "InvalidRole" | "InsufficientRole"
  | "SlugRequiredToPublish" | "PublishedWorkspaceRequiresSlug"
  | "LastOwnerCannotLeave" | "CannotChangeOwnRole" | "WorkspaceQuotaExceeded"
  | "InvitationExpired"
```

## ユースケース（概要）

`resolveWorkspaceAccess`, `createWorkspace`, `updateWorkspaceProfile`, `changeWorkspaceSlug`, `publishWorkspace`, `unpublishWorkspace`, `deleteWorkspace`, `inviteMember`, `resendInvitation`, `revokeInvitation`, `getInvitationPreview`, `acceptInvitation`, `listMembers`, `listPendingInvitations`, `listUserWorkspaces`, `changeMemberRole`, `removeMember`, `leaveWorkspace`, `listPublicWorkspaces`, `getPublicWorkspace`

詳細は [usecases/workspace.md](../usecases/workspace.md)。
