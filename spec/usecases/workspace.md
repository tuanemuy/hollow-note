# ユースケース: Workspace

ドメインの詳細は [domains/workspace.md](../domains/workspace.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## resolveWorkspaceAccess

### 概要

ある利用者のあるワークスペースにおけるロールを解決する（WS-02 の「除名された・削除済みのワークスペースを URL で直接開いた」判定を含む）。ワークスペース配下のすべての操作が事前に呼ぶ。

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

新しいワークスペースを作り、作成者を owner として参加させる（WS-01）。

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

名前・説明・アイコンを更新する（WS-07）。

### 入力DTO

`workspaceId`, `userId`, `name?`, `description?`, `avatarUrl?`

### 出力DTO

更新後のワークスペースの射影。

### 処理フロー

1. `resolveWorkspaceAccess` でロールを解決し、`WorkspaceAuthorization.ensureCan(role, "manageWorkspace")` を呼ぶ
2. `WorkspaceRepository.findById` で引き、`Workspace.updateProfile` を適用して保存し、イベントを収集する。`name` が変わったときは `Workspace.updateProfile` が `workspace.profileUpdated` を発行し、読み取りモデルのワークスペース名の投影（`projectNoteChanges`）が購読する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 名前・説明の違反 | `BusinessRuleError` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## changeWorkspaceSlug

### 概要

公開ページのスラッグを変更する（WS-07）。

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

## publishWorkspace

### 概要

ワークスペースを公開する（WS-08）。

### 入力DTO

`workspaceId`, `userId`

### 出力DTO

`workspaceId`, `publication`, `publicUrl: string`, `publicNoteCount: number`

### 処理フロー

1. 権限を `publishWorkspace` で確認する
2. `WorkspaceRepository.findById` で引く。既に `published` なら変更もイベントもなく、現在の状態を射影して返す
3. `Workspace.publish` を適用して保存し、イベントを収集する（スラッグ未設定はドメインが `SlugRequiredToPublish` で拒否する）
4. `NoteQueryService.searchPublic` で公開ノート件数を数えて `publicNoteCount` として返す（0 件でも成功する。公開ページが空であることを画面が案内するために返す）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| スラッグ未設定で公開しようとした | `BusinessRuleError(SlugRequiredToPublish)` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 既に公開中 | 変更もイベントもなく成功として返す |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## unpublishWorkspace

### 概要

ワークスペースの公開を取り下げる（WS-08）。

### 入力DTO

`workspaceId`, `userId`

### 出力DTO

`workspaceId`, `publication`

公開ノート件数は返さない。取り下げ後の公開ページは存在しないため、数えても画面で使い道がない。

### 処理フロー

1. 権限を `publishWorkspace` で確認する
2. `WorkspaceRepository.findById` で引く。既に `private` なら変更もイベントもなく、現在の状態を射影して返す
3. `Workspace.unpublish` を適用して保存し、イベントを収集する。スラッグは残る（再公開でも同じ URL に戻せるようにするため。解除は `changeWorkspaceSlug` が担う）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 既に非公開 | 変更もイベントもなく成功として返す |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## deleteWorkspace

### 概要

ワークスペースを削除する（WS-10）。

### 入力DTO

`workspaceId`, `userId`, `confirmationName: string`

### 出力DTO

なし。

### 処理フロー

1. 権限を `deleteWorkspace` で確認する
2. `confirmationName` がワークスペース名と一致しなければ `ValidationError("CONFIRMATION_MISMATCH")`
3. `JobRepository.listActiveByScope({ type: "workspace", workspaceId })` を引き、取り消す対象の実行中ジョブを集める（要求者を問わない。匿名の PDF 書き出しもこのワークスペースの所有文脈に属するため入る）
4. `UnitOfWorkProvider.run` の中で、3 で集めたジョブに `Job.cancel` を適用して保存し、ワークスペースを削除して `WorkspaceEvents.workspaceDeleted` を収集する。**これらの保存はすべて同一 UoW で行う** — ワークスペースだけが消えてジョブが走り続ける中間状態を作らないため（`deleteAccount` 手順 4 と同じ理由）。併せて [usecases/job.md](./job.md) の「共通: 強制終端の後始末」に従う（`kind: "conversion"` の対象ノートが `processing` なら `Note.markConversionFailed("canceled")`、生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を `deleteFiles` で回収。いずれも同一 UoW）
5. メンバーシップと招待は同一ドメインの FK CASCADE で消える。残りの関連データは `workspace.deleted` を購読する各ドメインの掃除ユースケースが削除する。購読関係は次のとおり（本体の定義は各ドメインのユースケース文書が持つ）

| ドメイン | 購読ユースケース | 責務 |
| --- | --- | --- |
| Note | [`deleteNotesForOwner`](./note.md) | ワークスペース所有ノートと版・読み取りモデルの削除。1 件ずつ `note.purged` を発行し、タグ付与・保管ファイル・バックアップ記録の後始末につなぐ |
| Tag | [`deleteTagsForScope`](./tag.md) | ワークスペーススコープのタグと付与の削除（`TagRepository.deleteByScope`） |
| Storage | [`deleteFilesByOwner`](./storage.md) | ワークスペース所有ファイルの削除 |
| Usage | [`deleteQuota`](./usage.md) | クォータ行の削除 |

ワークスペース所有ノートのバックアップ記録は `workspace.deleted` を直接は購読せず、`deleteNotesForOwner` が発行する `note.purged` の購読者（Integration の [`deleteBackupRecordsForNote`](./integration.md)）が削除する（`backup_records` は owner 列を持たず、`noteId` 経由でしか特定できないため）。

ジョブ履歴の削除は購読者に含めない（`deleteAccount` の購読者表が持つ [`deleteJobsForRequester`](./job.md) にあたる行がないのは意図的である）。ジョブ履歴は要求者に帰属する記録であり、ワークスペースの削除で他のメンバーの処理履歴（JB-01）まで消してはならない。対象が消えた行は `listJobs` / `getJobDetail` の `targetLabel` が「削除済み」になり（[usecases/job.md](./job.md)）、保持期間を過ぎれば `pruneJobHistory` が回収する。実行中のものは手順 4 でキャンセル済みなので、走り続ける行も残らない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 確認入力の不一致 | `ValidationError("CONFIRMATION_MISMATCH")` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |

## inviteMember

### 概要

メールアドレスとロールを指定して招待を発行し、メールを送る（WS-03）。

### 入力DTO

`workspaceId`, `userId`（招待者）, `email: string`, `role: string`

### 出力DTO

`invitationId`, `email`, `role`, `expiresAt`, `invitationUrl`

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `Email.create` と `WorkspaceRole.create` を構築する
3. 招待先が既にメンバーなら `ConflictError("ALREADY_MEMBER")`
4. `InvitationRepository.countPendingIssuedSince(workspaceId, now - 24 時間)` が上限（50 件）以上なら `ValidationError("INVITATION_LIMIT_REACHED")`。**これはレート制限ではなくクォータである** — 上限に掛かるのは「直近 24 時間に発行した未処理の招待」の在庫であり、招待が 1 件受諾されるか取り消されればその場で枠が空く。待てば必ず解けるとは限らず、解除の時刻も出せない（`countPendingIssuedSince` は件数しか返さない。[domains/workspace.md](../domains/workspace.md)）。`THROTTLED` / `RATE_LIMITED` と別のコードにするのはこの違いによる（[presentation/index.md](../presentation/index.md)）
5. `InvitationRepository.findPendingByWorkspaceAndEmail` を引き、既に `pending` の招待があれば `resendInvitation` を**呼ぶ**（`workspaceId` / `userId` はそのまま、`invitationId` は引いた招待の ID）。その結果の `invitationId` / `expiresAt` / `invitationUrl` をそのまま返し、`email` / `role` は既存の招待の値を写して手順 6・7 には進まない
6. `UnitOfWorkProvider.run` で `SecureTokenGenerator.issue` のトークンとともに `Invitation.issue` を保存する
7. `MailSender.send({ kind: "workspaceInvitation" })` を送る

手順 5 はユースケースの**呼び出し**であり、手順の複製ではない（[usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」）。このユースケースは手順 5 までに 1 件も書き込みを行わないため末尾呼び出しになり、`resendInvitation` が自分の UoW で確定した結果だけが残る。`resendInvitation` は `expectedVersion` を要求しないため渡す版もなく、その手順 1・2（権限の確認と `pending` の再確認）が重複するだけである。既存招待のロールを入力の `role` で書き換えないのは意図で、ロールを変えたい場合は取り消してから招待し直す（WS-03）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| メール形式・ロールの違反 | `BusinessRuleError` |
| 既にメンバー | `ConflictError("ALREADY_MEMBER")` |
| 未処理の招待が上限（50 件） | `ValidationError("INVITATION_LIMIT_REACHED")` |
| メール送信の失敗 | 記録して継続（招待は成立させる） |

## resendInvitation

### 概要

保留中の招待のトークンと期限を作り直して再送する（WS-03）。

### 入力DTO

`workspaceId`, `userId`, `invitationId`

### 出力DTO

`invitationId`, `expiresAt`, `invitationUrl`

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `InvitationRepository.findById` で引き、`workspaceId` の一致と `status === "pending"` を確認する
3. `Invitation.resend` を保存し、メールを送る

このユースケースは**メール送信を伴うため転送境界のレート制限の対象である**（[presentation/index.md](../presentation/index.md)）。`inviteMember` 経由で呼ばれる場合は手前の手順 4 が在庫の上限で守るが、直接呼ばれる経路にはその検査がない — 同じ招待に対する再送を繰り返しても `pending` の件数は増えないため、在庫の上限では止まらない。しきい値は転送境界のレート制限のしきい値がまだ未定であるのと同じ理由で保留する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 招待が不在・他ワークスペースのもの | `NotFoundError("INVITATION_NOT_FOUND")` |
| 受諾済み・取り消し済み | `ValidationError("INVITATION_NOT_PENDING")` |
| レート制限（転送境界） | `ValidationError("RATE_LIMITED")` |

## revokeInvitation

### 概要

保留中の招待を取り消す（WS-03）。

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

招待リンクを開いた相手に、参加前の情報を見せる（WS-04）。

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

招待を受諾してメンバーになる（WS-04）。

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

ワークスペースのメンバーを一覧する（WS-05）。

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
| ページング値の範囲外 | `ValidationError("INVALID_PAGINATION")`（一覧系ユースケース共通の規約） |

## listPendingInvitations

### 概要

保留中の招待を一覧する（WS-03）。

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

サインイン中の利用者が参加しているワークスペースを、文脈切り替え用に一覧する（WS-02 / DS-03）。

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

メンバーのロールを変更する（WS-05）。

### 入力DTO

`workspaceId`, `actorUserId`, `membershipId`, `role: string`

### 出力DTO

`membershipId`, `role`

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `MembershipRepository.findById` で対象を引き、`workspaceId` の一致を確認する
3. `MembershipPolicy.ensureNotSelfRoleChange(actorUserId, target)` を呼ぶ
4. `MembershipRepository.countByRole(workspaceId, "owner")` を引き、`MembershipPolicy.ensureOwnerRemains(ownerCount, target, nextRole)` を呼ぶ
5. 降格（`nextRole` が現在のロールより低い）の場合、`removeMember` の手順 4 と同じ絞り込みで、降格後のロールでは実行できなくなる kind の実行中ジョブを集める。`JobRepository.listActiveByScope({ type: "workspace", workspaceId })` のうち `requestedBy` が対象の利用者で、`kind` が下表で `nextRole` に許されないものが対象（昇格と同ロールの指定では対象なし）
6. `UnitOfWorkProvider.run` の中で、5 で集めたジョブに `Job.cancel` を適用して保存し、`Membership.changeRole` を保存してイベントを収集する。**これらの保存はすべて同一 UoW で行う** — ロールだけが下がってジョブが走り続ける中間状態を作らないため。ジョブを取り消したときは [usecases/job.md](./job.md) の「共通: 強制終端の後始末」に従う（`kind: "conversion"` の対象ノートが `processing` なら `Note.markConversionFailed("canceled")`、生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を `deleteFiles` で回収。いずれも同一 UoW。取り消しが起きない昇格・同ロールの指定では後始末も起きない）

| `kind` | 実行に要するロール | editor → viewer で取り消す |
| --- | --- | --- |
| `conversion` / `regeneration` / `referenceImport` | editor（`editNote`） | ○ |
| `bulkMove` / `bulkVisibility` / `bulkTag` / `bulkDelete` | editor（`moveNote` / `changeNoteVisibility` / `manageTags` / `deleteNote`） | ○ |
| `driveBackup` / `bulkBackup` | editor（`editNote`。[usecases/integration.md](./integration.md) の `requestBackup` 手順 2 が各ノートの `canEdit` を確認する） | ○ |
| `pdfExport` / `bulkExport` | viewer（`downloadNote`） | — |

`driveBackup` / `bulkBackup` が editor 側にあるのは、バックアップがノートに紐づく共有状態を書き換えるためである。`runBackup` は `BackupRecord` を作り、既存記録が別のメンバーのものなら所有者ごと付け替える（`BackupPlanner.decide` の `replace`）。この記録は「どのメンバーの Drive から再生成の元ファイルを取るか」を決める（`fetchBackupForRegeneration`）ので、書き換えられるのはノートの内容の扱いに関わる決定であり、`downloadNote` の範囲を超える。要求者個人に帰属する生成物を作るだけでノート側に何も書かない `pdfExport` / `bulkExport` とはこの点で分かれる（[ADR 004](../adr/004-workspace-roles.md) のロール表）。

取り消す根拠は `removeMember` と同じで、`runConversion` / `runRegeneration` / `runBackup` は実行時に権限を再確認しないため、取り消さないと降格後も本文やバックアップ記録が書き換わる（[ADR 004](../adr/004-workspace-roles.md) のロール表と同じ対応を、実行中の非同期処理にも及ぼす）。一括操作・一括ダウンロードの子（`runBulkNoteOperationItem` / `runBulkExportItem`）はこの列挙に入らず、手順 2 で要求者の権限を再確認して失っていれば `Job.fail("permissionRevoked")` にする（[usecases/note.md](./note.md)）。線引きは対象の粒度による — 前者はノート本文や共有状態を 1 件丸ごと書き換える実行体で、途中で権限を確かめ直しても書きかけを戻せないのに対し、子ジョブは 1 件 = 1 ジョブで対象ノートが確定しており、実行の直前にその 1 件の権限を確かめられる。取り消し対象に入らない `bulkExport` では、この再確認が権限喪失に対する唯一の防御になる（キャンセル網に載らないため、登録から実行までの間に対象への閲覧権を失った場合はここでしか止まらない）。owner → editor の降格では取り消しが起きない — owner だけに許される操作（`manageMembers` / `manageWorkspace` / `publishWorkspace` / `deleteWorkspace`）に対応する `JobKind` が存在しないため。

強制終端の後始末のうち生成物の回収は、この経路では規則どおり適用しても実際には空になる。この経路も一括操作・一括バックアップの batch 親を終端させうるが、回収の対象になりうるのは `bulkExport` 親の成功済みの子が持つ生成物だけで、`bulkExport` は viewer でも実行できるため上表の取り消し対象に入らないからである。除名・脱退（`removeMember` / `leaveWorkspace`）と違い、降格した利用者は閲覧・ダウンロードの権限を保つため、生成済みの ZIP・PDF が手元に残っても差し支えない。規則の記述を省かないのは、後始末を経路ごとの例外なく同じ形で読めるようにするため。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 自分自身の変更 | `BusinessRuleError(CannotChangeOwnRole)` |
| 最後の owner の降格 | `BusinessRuleError(LastOwnerCannotLeave)` |
| 対象が不在 | `NotFoundError("MEMBERSHIP_NOT_FOUND")` |
| 未知のロール | `BusinessRuleError(InvalidRole)` |
| 同じロールの指定 | 変更もイベントもなく成功として返す（ジョブの取り消しも起きない） |

## removeMember

### 概要

メンバーを除名する（WS-05）。

### 入力DTO

`workspaceId`, `actorUserId`, `membershipId`

### 出力DTO

なし。

### 処理フロー

1. 権限を `manageMembers` で確認する
2. 対象を引き、`MembershipPolicy.ensureNotSelfRemoval(actorUserId, target)` を呼ぶ
3. `ensureOwnerRemains(ownerCount, target, null)` を呼ぶ
4. `JobRepository.listActiveByScope({ type: "workspace", workspaceId })` を引き、`requestedBy` が除名対象の利用者であるものを取り消す対象として集める（`runConversion` / `runRegeneration` / `runBackup` は実行時に権限を再確認しないため、取り消さないと除名後も本文が書き換わる。要求者が他のメンバーのジョブと匿名ジョブには触れない）
5. `UnitOfWorkProvider.run` の中で、4 で集めたジョブに `Job.cancel` を適用して保存し、メンバーシップを削除して `WorkspaceEvents.membershipRemoved` を収集する。**これらの保存はすべて同一 UoW で行う** — メンバーシップだけが消えてジョブが走り続ける中間状態を作らないため。併せて [usecases/job.md](./job.md) の「共通: 強制終端の後始末」に従う（`kind: "conversion"` の対象ノートが `processing` なら `Note.markConversionFailed("canceled")`、生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を `deleteFiles` で回収。いずれも同一 UoW）

生成物の回収は除名では特に落とせない。一括ダウンロードの生成物は要求者の個人 subject に帰属して TTL が 7 日あるため、回収しなければ、アクセス権を失った利用者の手元にこのワークスペースのノート本文を含む ZIP が 7 日残る（[usecases/job.md](./job.md)）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 自分自身の除名 | `BusinessRuleError(CannotRemoveSelf)`（自身の離脱は `leaveWorkspace` へ誘導する） |
| 最後の owner の除名 | `BusinessRuleError(LastOwnerCannotLeave)` |
| 対象が不在 | `NotFoundError("MEMBERSHIP_NOT_FOUND")` |

## leaveWorkspace

### 概要

自分がワークスペースを脱退する（WS-06）。

### 入力DTO

`workspaceId`, `userId`

### 出力DTO

なし。

### 処理フロー

1. `MembershipRepository.findByWorkspaceAndUser` を引く。不在なら `NotFoundError("MEMBERSHIP_NOT_FOUND")`
2. `ensureOwnerRemains(ownerCount, membership, null)` を呼ぶ
3. `removeMember` の手順 4 と同じ規則で、脱退者がこのワークスペースのノート・ファイルに対して持つ実行中ジョブを集める
4. `UnitOfWorkProvider.run` の中で、3 で集めたジョブに `Job.cancel` を適用して保存し、メンバーシップを削除してイベントを収集する（`removeMember` 手順 5 と同じく、すべて同一 UoW で行う）。[usecases/job.md](./job.md) の「共通: 強制終端の後始末」に従う点も `removeMember` と同じで、`processing` のノートの回復（理由は `canceled`）と生成物の回収を同一 UoW で併せて行う

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

スラッグから公開ワークスペースの情報を引く（WS-09 / DS-02）。

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

## deleteMembershipsForUser

### 概要

利用者の退会に伴って、参加していた全ワークスペースからメンバーシップを削除する（`identity.user.deleted` の購読）。

### 入力DTO

`userId`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `UnitOfWorkProvider.run` で `MembershipRepository.deleteByUser(userId)` を呼ぶ（`memberships.user_id` はドメインをまたぐ参照のため FK を持たず、イベントで後始末する）
2. 退会者が唯一の `owner` であるワークスペースが残らないことは `deleteAccount` の手順 2 が保証する
3. イベントは発行しない（`workspace.membership.removed` は監査用で、退会そのものは `identity.user.deleted` が記録する。退会者の実行中ジョブは `deleteAccount` の手順 3 が要求者とスコープの両面から取り消し済み）
4. 招待はメールアドレス宛でワークスペースに従属するため対象外（`invited_by` / `accepted_by` は履歴として残す）

冪等性: 削除は対象がなければ 0 件で終わるため、同じイベントを 2 回受け取っても結果は変わらない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| メンバーシップが 1 件もない | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |
