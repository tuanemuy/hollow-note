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
| `updateProfile` | `workspace: Workspace, params: { name?: string; description?: string; avatarUrl?: string \| null }, now: Date` | `WithEventDrafts<Workspace, WorkspaceEvent>` | 指定項目のみ更新。公開状態は保つ。`name` が変わったときのみ `workspace.profileUpdated` を発行 |
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

**バックアップ専用の action を置かない**。元ファイルの Drive バックアップは editor を要する（[ADR 004](../adr/004-workspace-roles.md) のロール表）が、`WorkspaceAction` に `backupNote` は加えず `editNote` で判定する。バックアップが editor 側にあるのは、`BackupRecord` がノートに紐づく共有状態であり、既存記録が別のメンバーのものなら所有者ごと付け替わるためで、「ノートの内容の扱いに関わる決定を書き換える」という点で `editNote` とまったく同じ理由による。要求する最小ロールも判定に使う情報も同じ action を 2 つに割ると、片方だけを変える改訂で表が食い違う。実際 `requestBackup`（[usecases/integration.md](../usecases/integration.md)）は `NoteAccessPolicy` の `canEdit` を呼んでおり、この表は `canEdit` の中で引かれる。降格時に取り消すジョブの `kind` → 要ロールの対応（[usecases/workspace.md](../usecases/workspace.md) の `changeMemberRole`）でも `driveBackup` / `bulkBackup` は `editNote` を根拠に editor 側へ置いている。

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
  deleteByUser(userId: UserId): Promise<number>;   // 退会時の後始末（deleteMembershipsForUser）
}
```

ワークスペース削除に伴うメンバーシップと招待の削除は同一ドメイン内の FK CASCADE に任せるため、両リポジトリともワークスペース単位の削除・計数メソッドを持たない（[usecases/workspace.md](../usecases/workspace.md) の `deleteWorkspace` 手順 5）。メンバー数は `listByWorkspace` の `PaginationResult` から得る。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("MEMBERSHIP_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### InvitationRepository

```ts
interface InvitationRepository extends TransactionalRepository<Invitation, InvitationId> {
  findByTokenHash(tokenHash: TokenHash): Promise<Versioned<Invitation> | null>;
  findPendingByWorkspaceAndEmail(workspaceId: WorkspaceId, email: Email): Promise<Versioned<Invitation> | null>;
  listByWorkspace(workspaceId: WorkspaceId, pagination: Pagination): Promise<PaginationResult<Invitation>>;
  countPendingIssuedSince(workspaceId: WorkspaceId, since: Date): Promise<number>;
}
```

`countPendingIssuedSince` は招待の発行上限（[usecases/workspace.md](../usecases/workspace.md) の `inviteMember`）の判定に使う。返すのは件数だけで、**枠が空く時刻は返せない** — 上限は「発行済みかつ未処理の件数」で決まり、招待が 1 件受諾されるか取り消されればその時点で枠が空くため、時刻を予告できない。この性質から、上限に達したことを表す応答は「待てば解ける」レート制限とは別のものとして扱う（[presentation/index.md](../presentation/index.md)）。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

## ドメインイベント

用途欄の 3 分類は [identity.md](./identity.md) のドメインイベント節と同じ規約に従う。

| 型 | payload | 用途 |
| --- | --- | --- |
| `workspace.created` | `{ workspaceId, ownerId }` | Usage のクォータ行の初期化（[`initializeQuota`](../usecases/usage.md)）。読み取りモデルの投影は購読しない（`createWorkspace` はノートを 1 件も作らず、作成直後のワークスペースには投影対象の行が存在しないため。[usecases/note.md](../usecases/note.md) の `projectNoteChanges`） |
| `workspace.profileUpdated` | `{ workspaceId, name }` | 読み取りモデルの投影（`projectNoteChanges` のワークスペース名） |
| `workspace.slugChanged` | `{ workspaceId, previousSlug, currentSlug }` | 読み取りモデルの投影（`projectNoteChanges` のスラッグ） |
| `workspace.published` | `{ workspaceId, slug }` | 読み取りモデルの投影（`projectNoteChanges` の公開状態） |
| `workspace.unpublished` | `{ workspaceId }` | 読み取りモデルの投影（`projectNoteChanges` の公開状態） |
| `workspace.deleted` | `{ workspaceId }` | Note / Tag / Storage / Usage の後始末。購読者の一覧は [usecases/workspace.md](../usecases/workspace.md) の `deleteWorkspace` 手順 5 |
| `workspace.membership.added` | `{ workspaceId, userId, role }` | 監査 |
| `workspace.membership.roleChanged` | `{ workspaceId, userId, previousRole, currentRole }` | 監査（購読者なし。降格に伴う実行中ジョブの取り消しは `changeMemberRole` が同じ手順の中で行う） |
| `workspace.membership.removed` | `{ workspaceId, userId }` | 監査（購読者なし。実行中ジョブの取り消しは `removeMember` / `leaveWorkspace` が同じ手順の中で行う） |
| `workspace.invitation.created` | `{ invitationId, workspaceId, email, role }` | 監査（購読者なし。招待メールの送信は `inviteMember` / `resendInvitation` が同じ手順の中で `MailSender.send` を呼んで行う） |
| `workspace.invitation.accepted` | `{ invitationId, workspaceId, userId }` | 監査 |
| `workspace.invitation.revoked` | `{ invitationId, workspaceId }` | 監査 |

招待メールをアウトボックス経由にしない（`invitation.created` に送信の購読者を置かない）のは意図した設計判断である。送信結果を要求の応答に反映して「招待を送りました」を即時に返すため、`MailSender` は呼び出し元が同期的に呼ぶ。代償として再送保証はなく、送信の失敗は記録して継続し招待自体は成立させる（[domains/index.md](./index.md) の `MailSender`）。届かなかった相手には `resendInvitation` で送り直す。

サイトマップは購読で更新しない（`listPublicWorkspaces` が要求のたびに現在の状態から列挙する引き取り型のため）。公開ページのキャッシュについても、無効化の仕組みを本設計は持たない。

読み取りモデルへ投影されるイベント（`workspace.profileUpdated` / `slugChanged` / `published` / `unpublished`）の payload も、変化の通知にとどめて投影に必要な現在値を運ばない。`NoteProjectionWriter.updateWorkspace(workspaceId, name, slug, published)` が要る `name` / `slug` / `published` の組は、購読側が `workspaceId` で `WorkspaceRepository.findById` を引いて解決して渡す（[domains/identity.md](./identity.md) の同じ注記、[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）。

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
