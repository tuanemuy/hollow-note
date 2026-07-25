# ユースケース: Workspace

ドメインの詳細は [domains/workspace.md](../domains/workspace.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## resolveWorkspaceAccess

### 概要

ある利用者のあるワークスペースにおけるロールを解決する。ワークスペース配下のすべての操作が事前に呼ぶ。

### 入力DTO

`workspaceId: string`, `userId: string`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `workspaceId` | `string` |
| `role` | `"owner" \| "editor" \| "viewer" \| null` |
| `workspaceName` | `string` |
| `publication` | `"private" \| "published"` |

### 処理フロー

1. `WorkspaceId.create` を構築し `WorkspaceRepository.findById` で引く。不在なら `NotFoundError("WORKSPACE_NOT_FOUND")`
2. `MembershipRepository.findByWorkspaceAndUser` を引く。不在なら `role: null` を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ワークスペース不在・削除済み | `NotFoundError("WORKSPACE_NOT_FOUND")` |

## createWorkspace

### 概要

新しいワークスペースを作り、作成者を owner として参加させる。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `name` | `string` | ○ | `WorkspaceName` の規則 |
| `description` | `string` | — | `WorkspaceDescription` の規則 |
| `slug` | `string \| null` | — | `WorkspaceSlug` の規則 |

### 出力DTO

`workspaceId`, `name`, `slug`, `publication`, `role`

### 処理フロー

1. `WorkspaceRepository.countOwnedBy(userId)` を引き、`MembershipPolicy.ensureWorkspaceQuota` を呼ぶ
2. `slug` があれば `WorkspaceRepository.existsBySlug(slug, null)` を調べ、真なら `ConflictError("SLUG_ALREADY_USED")`
3. `Workspace.create` と `Membership.create(role: "owner")` を作る
4. `UnitOfWorkProvider.run` で両方を保存し、イベントを収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 所有数の上限超過 | `BusinessRuleError(WorkspaceQuotaExceeded)` |
| スラッグの形式違反・予約語 | `BusinessRuleError(InvalidSlug)` / `BusinessRuleError(SlugReserved)` |
| スラッグの重複 | `ConflictError("SLUG_ALREADY_USED")` |
| 名前の違反 | `BusinessRuleError(InvalidName)` |

## updateWorkspaceProfile

### 概要

名前・説明・アイコンを更新する。

### 入力DTO

`workspaceId`, `userId`, `name?`, `description?`, `avatarUrl?`

### 出力DTO

更新後のワークスペースの射影。

### 処理フロー

1. `resolveWorkspaceAccess` でロールを解決し、`WorkspaceAuthorization.ensureCan(role, "manageWorkspace")` を呼ぶ
2. `WorkspaceRepository.findById` で引き、`Workspace.updateProfile` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 名前・説明の違反 | `BusinessRuleError` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## changeWorkspaceSlug

### 概要

公開ページのスラッグを変更する。

### 入力DTO

`workspaceId`, `userId`, `slug: string | null`

### 出力DTO

`workspaceId`, `slug`, `previousSlug`

### 処理フロー

1. 権限を `manageWorkspace` で確認する
2. `slug` が非 `null` なら `existsBySlug(slug, workspaceId)` を調べる
3. `Workspace.changeSlug` を適用して保存する（公開中に `null` を渡すとドメインが拒否する）

### エラーケース

`createWorkspace` と同じスラッグ関連のエラーに加え、`BusinessRuleError(PublishedWorkspaceRequiresSlug)`。

## publishWorkspace / unpublishWorkspace

### 概要

ワークスペースの公開状態を切り替える。

### 入力DTO

`workspaceId`, `userId`

### 出力DTO

`workspaceId`, `publication`, `publicUrl: string | null`, `publicNoteCount: number`

### 処理フロー

1. 権限を `publishWorkspace` で確認する
2. `Workspace.publish` または `Workspace.unpublish` を適用して保存する
3. 公開時は `NoteQueryService.searchPublic` で公開ノート件数を数えて返す（0 件でも成功する）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| スラッグ未設定で公開しようとした | `BusinessRuleError(SlugRequiredToPublish)` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 既に同じ状態 | 変更もイベントもなく成功として返す |

## deleteWorkspace

### 概要

ワークスペースを削除する。

### 入力DTO

`workspaceId`, `userId`, `confirmationName: string`

### 出力DTO

なし。

### 処理フロー

1. 権限を `deleteWorkspace` で確認する
2. `confirmationName` がワークスペース名と一致しなければ `ValidationError("CONFIRMATION_MISMATCH")`
3. `JobRepository.listActiveByScope({ type: "workspace", workspaceId })` を引き、すべて `Job.cancel` する
4. `UnitOfWorkProvider.run` でワークスペースを削除し、`WorkspaceEvents.workspaceDeleted` を収集する
5. メンバーシップ・招待・ノート・タグ・ファイル・クォータは `workspace.deleted` を購読するワーカーが削除する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 確認入力の不一致 | `ValidationError("CONFIRMATION_MISMATCH")` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |

## inviteMember

### 概要

メールアドレスとロールを指定して招待を発行し、メールを送る。

### 入力DTO

`workspaceId`, `userId`（招待者）, `email: string`, `role: string`

### 出力DTO

`invitationId`, `email`, `role`, `expiresAt`, `invitationUrl`

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `Email.create` と `WorkspaceRole.create` を構築する
3. 招待先が既にメンバーなら `ConflictError("ALREADY_MEMBER")`
4. `InvitationRepository.countPendingIssuedSince(workspaceId, now - 24 時間)` が上限（50 件）以上なら `ValidationError("RATE_LIMITED")`
5. 既に `pending` の招待があれば `resendInvitation` と同じ経路で再送する
6. `SecureTokenGenerator.issue` でトークンを作り、`Invitation.issue` を保存する
7. `MailSender.send({ kind: "workspaceInvitation" })` を送る

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| メール形式・ロールの違反 | `BusinessRuleError` |
| 既にメンバー | `ConflictError("ALREADY_MEMBER")` |
| 招待数の上限 | `ValidationError("RATE_LIMITED")` |
| メール送信の失敗 | 記録して継続（招待は成立させる） |

## resendInvitation

### 概要

保留中の招待のトークンと期限を作り直して再送する。

### 入力DTO

`workspaceId`, `userId`, `invitationId`

### 出力DTO

`invitationId`, `expiresAt`, `invitationUrl`

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `InvitationRepository.findById` で引き、`workspaceId` の一致と `status === "pending"` を確認する
3. `Invitation.resend` を保存し、メールを送る

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 招待が不在・他ワークスペースのもの | `NotFoundError("INVITATION_NOT_FOUND")` |
| 受諾済み・取り消し済み | `ValidationError("INVITATION_NOT_PENDING")` |

## revokeInvitation

### 概要

保留中の招待を取り消す。

### 入力DTO

`workspaceId`, `userId`, `invitationId`

### 出力DTO

なし。

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `Invitation.revoke` を保存する

### エラーケース

`resendInvitation` と同じ。

## getInvitationPreview

### 概要

招待リンクを開いた相手に、参加前の情報を見せる。

### 入力DTO

`token: string`, `userId: string | null`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `workspaceName` | `string` |
| `workspaceDescription` | `string` |
| `role` | `string` |
| `inviterName` | `string` |
| `email` | `string` |
| `state` | `"acceptable" \| "expired" \| "revoked" \| "accepted" \| "alreadyMember" \| "workspaceMissing"` |

### 処理フロー

1. トークンのハッシュで `InvitationRepository.findByTokenHash` を引く。不在なら `NotFoundError("INVITATION_NOT_FOUND")`
2. `WorkspaceRepository.findById` を引き、不在なら `state: "workspaceMissing"`
3. `Invitation.isExpired` と `status` から `state` を決める
4. `userId` があり既にメンバーなら `state: "alreadyMember"`
5. 招待者の表示名を `UserRepository.listByIds` で解決する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・不正 | `NotFoundError("INVITATION_NOT_FOUND")` |

## acceptInvitation

### 概要

招待を受諾してメンバーになる。

### 入力DTO

`token: string`, `userId: string`

### 出力DTO

`workspaceId`, `role`

### 処理フロー

1. トークンのハッシュで招待を引く
2. `status !== "pending"` なら `ValidationError("INVITATION_NOT_PENDING")`
3. 既にメンバーなら招待を `accept` にしたうえで既存のロールを返す（ロールは変更しない）
4. `Invitation.accept` と `Membership.create` を作る
5. `UnitOfWorkProvider.run` で両方を保存し、イベントを収集する

招待されたメールアドレスとサインイン中のメールアドレスが異なっていても受諾を認める（リンク自体を認可の根拠とする）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在 | `NotFoundError("INVITATION_NOT_FOUND")` |
| 期限切れ | `BusinessRuleError(InvitationExpired)` |
| 受諾済み・取り消し済み | `ValidationError("INVITATION_NOT_PENDING")` |
| ワークスペースが削除済み | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| メンバーシップの競合 | `ConflictError("MEMBERSHIP_ALREADY_EXISTS")` |

## listMembers

### 概要

ワークスペースのメンバーを一覧する。

### 入力DTO

`workspaceId`, `userId`, `page`, `limit`

### 出力DTO

`members: { membershipId; userId; displayName; email; avatarUrl; role; joinedAt }[]`, `count`, `ownerCount: number`, `canManage: boolean`

### 処理フロー

1. `resolveWorkspaceAccess` でロールを解決する。`role === null` なら `BusinessRuleError(InsufficientRole)`
2. `MembershipRepository.listByWorkspace` と `UserRepository.listByIds` で射影を組み立てる
3. `MembershipRepository.countByRole(workspaceId, "owner")` を `ownerCount` として返す
4. `canManage` は `WorkspaceAuthorization.can(role, "manageMembers")`。UI が操作の可否を出し分けるために返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー | `BusinessRuleError(InsufficientRole)` |

## listPendingInvitations

### 概要

保留中の招待を一覧する。

### 入力DTO

`workspaceId`, `userId`, `page`, `limit`

### 出力DTO

`invitations: { invitationId; email; role; invitedBy; createdAt; expiresAt; expired: boolean }[]`, `count`

### 処理フロー

1. `resolveWorkspaceAccess` でロールを解決し、`WorkspaceAuthorization.ensureCan(role, "manageMembers")` を呼ぶ
2. `InvitationRepository.listByWorkspace` を引き、`status === "pending"` のものだけを射影する
3. `expired` は `Invitation.isExpired(invitation, now)`

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |

## listUserWorkspaces

### 概要

サインイン中の利用者が参加しているワークスペースを、文脈切り替え用に一覧する。

### 入力DTO

`userId: string`

### 出力DTO

`workspaces: { workspaceId; name; slug; avatarUrl; role; publication }[]`

### 処理フロー

1. `MembershipRepository.listByUser` を引く
2. `WorkspaceRepository.listByIds` で名前などを解決し、名前順に並べる

### エラーケース

`SystemError(DatabaseError)`

## changeMemberRole

### 概要

メンバーのロールを変更する。

### 入力DTO

`workspaceId`, `actorUserId`, `membershipId`, `role: string`

### 出力DTO

`membershipId`, `role`

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `MembershipRepository.findById` で対象を引き、`workspaceId` の一致を確認する
3. `MembershipPolicy.ensureNotSelfRoleChange(actorUserId, target)` を呼ぶ
4. `MembershipRepository.countByRole(workspaceId, "owner")` を引き、`MembershipPolicy.ensureOwnerRemains(ownerCount, target, nextRole)` を呼ぶ
5. `Membership.changeRole` を保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 自分自身の変更 | `BusinessRuleError(CannotChangeOwnRole)` |
| 最後の owner の降格 | `BusinessRuleError(LastOwnerCannotLeave)` |
| 対象が不在 | `NotFoundError("MEMBERSHIP_NOT_FOUND")` |
| 未知のロール | `BusinessRuleError(InvalidRole)` |

## removeMember

### 概要

メンバーを除名する。

### 入力DTO

`workspaceId`, `actorUserId`, `membershipId`

### 出力DTO

なし。

### 処理フロー

1. 権限を `manageMembers` で確認する
2. 対象を引き、`ensureOwnerRemains(ownerCount, target, null)` を呼ぶ
3. `UnitOfWorkProvider.run` で削除し、`WorkspaceEvents.membershipRemoved` を収集する

### エラーケース

`changeMemberRole` と同じ分類（自分自身の除名は `leaveWorkspace` を使う）。

## leaveWorkspace

### 概要

自分がワークスペースを脱退する。

### 入力DTO

`workspaceId`, `userId`

### 出力DTO

なし。

### 処理フロー

1. `MembershipRepository.findByWorkspaceAndUser` を引く。不在なら `NotFoundError("MEMBERSHIP_NOT_FOUND")`
2. `ensureOwnerRemains(ownerCount, membership, null)` を呼ぶ
3. `UnitOfWorkProvider.run` で削除し、イベントを収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 唯一の owner | `BusinessRuleError(LastOwnerCannotLeave)` |
| 非メンバー | `NotFoundError("MEMBERSHIP_NOT_FOUND")` |

## listPublicWorkspaces

### 概要

サイトマップ用に公開ワークスペースを列挙する（DS-06）。

### 入力DTO

`page`, `limit`

### 出力DTO

`entries: { slug: string; updatedAt: Date }[]`, `count: number`

### 処理フロー

1. `WorkspaceRepository.findPublishedPage` を引き、スラッグと更新日時に射影する

### エラーケース

`SystemError(DatabaseError)`

## getPublicWorkspace

### 概要

スラッグから公開ワークスペースの情報を引く。

### 入力DTO

`slug: string`

### 出力DTO

`workspaceId`, `name`, `description`, `avatarUrl`, `slug`

### 処理フロー

1. `WorkspaceSlug.create` を構築する（形式違反は不在として扱う）
2. `WorkspaceRepository.findBySlug` で引く。`null` または `publication !== "published"` なら `NotFoundError("WORKSPACE_NOT_FOUND")`

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 形式違反・不在・非公開 | `NotFoundError("WORKSPACE_NOT_FOUND")`（区別しない） |
