# ユースケース: Workspace

ドメインの詳細は [domains/workspace.md](../domains/workspace.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## 共通: scope storage と global directory

Workspace / Membership / Invitation の正データは `{ type: "workspace", workspaceId }` の scope DO に置く。`resolveWorkspaceAccess` を含む workspace 内操作は `ScopeRouter` でその object を呼び、権限判定と変更を同じ object 内で行う。

利用者横断の一覧、global uniqueness、URL / token から workspace を見つける入口だけを global D1 の `membership_directory`、`workspace_directory`、`workspace_slug_reservations`、`invitation_routes` に置く。D1 と DO の更新は operation ID 付きの reserve → scope-local commit → activate で行い、応答喪失は同じ operation ID で再開する。pending reservation は正データではなく、期限切れ recovery の対象である。

既存Membershipのrole変更・削除はscope-local commitを先に行い、そのeventでglobal directoryを更新する。遅延中に一覧へ古いrole / edgeが見えても、mutation直前のlocal権限確認が必ず拒否するため権限昇格にはならない。directory更新はsource version条件付きで、古いeventが新しいroleを戻さない。

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

1. global D1 の active / pending `membership_directory` から `role = owner` の件数を数え、`MembershipPolicy.ensureWorkspaceQuota` を呼ぶ
2. workspace ID と operation ID を採番し、slug があれば `workspace_slug_reservations` を予約する。同時予約は一意制約で `SLUG_ALREADY_USED` になる
3. workspace scope DO の `ScopeUnitOfWorkProvider.run` で `Workspace.create` と `Membership.create(role: "owner")` を保存する
4. local commit 後に global D1 の membership edge、slug reservation、`workspace_directory` を operation ID 条件で active にする。activation の応答を失った場合は再試行し、local commit 前に失敗した reservation は解放する

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
2. `slug` が非 `null` なら global D1 の `workspace_slug_reservations` を operation ID 付きで予約する。現在の workspace が同じ値を保持する場合だけ再利用できる
3. workspace scope で `Workspace.changeSlug` を適用して保存する（公開中に `null` を渡すとドメインが拒否する）
4. local commit 後に reservation と `workspace_directory` を切り替え、旧slugを解放する。失敗時は operation record から再開し、旧slugは切替完了まで有効に保つ

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

`operationId`, `status: "accepted"`

### 処理フロー

1. 権限を `deleteWorkspace` で確認する
2. `confirmationName` がワークスペース名と一致しなければ `ValidationError("CONFIRMATION_MISMATCH")`
3. operation IDを採番し、最初のworkspace-local transactionで`hasActiveMove`を確認して`beginDeletion`を呼び、決定的IDの`workspace.deletionLocalContinued { operationId }`を`scheduled_tasks`へ保存する。これが全scope mutationを閉じる切替点であり、task保存と同じcommitの成功後にacceptedを返す。staged targetを消してsourceだけをretireする競合を防ぐ
4. deletion ownerとして `JobRepository.listActiveByScope({ type: "workspace", workspaceId }, limit: 100)` を0件になるまで引き、取り消しと後始末を`scheduled_tasks`で継続する。deleting切替後なので新しいJobは入らない
5. `workspace.deletionLocalContinued` workerはheader stateから再開し、`WorkspaceDeletionManifestStore`でMembershipとInvitationを各100件ずつキーセットで読み、`{ userId, membershipId }`と`{ tokenHash, invitationId }`をlocal manifestへ固定する。page/cursorと次の同名taskを同じUoWで保存し、両方の終端後にmarkReadyする
6. manifest完成後かつ手順4の強制終端continuationが0件まで完了したことを確認する。`listLocalPending(operationId, 100)`でmanifest itemを読み、Membership/Invitationをkind別に`deleteByIds`で最大100件ずつ削除して、同じUoWで`acknowledgeLocal`と次の`workspace.deletionLocalContinued`を保存する。local pendingが0件になった最後のUoWでだけ、子行が0件であることを確認してWorkspaceを削除し、`workspace.deleted { workspaceId, operationId }`を保存する。manifest/tombstoneはglobal cleanup ackまで残す。FKはRESTRICTを安全網とし、数千edgeを親DELETEのCASCADEへ渡さない

| ドメイン | 購読ユースケース | 責務 |
| --- | --- | --- |
| Note | [`deleteNotesForOwner`](./note.md) | ワークスペース所有ノートと版・読み取りモデルの削除。1 件ずつ `note.purged` を発行し、タグ付与・保管ファイル・バックアップ記録の後始末につなぐ |
| Tag | [`deleteTagsForScope`](./tag.md) | ワークスペーススコープのタグと付与の削除（`TagRepository.deleteByScope`） |
| Storage | [`deleteFilesByOwner`](./storage.md) | ワークスペース所有ファイルの削除 |
| Usage | [`deleteQuota`](./usage.md) | クォータ行の削除 |

ワークスペース所有ノートのバックアップ記録は `workspace.deleted` を直接は購読せず、`deleteNotesForOwner` が発行する `note.purged` の購読者（Integration の [`deleteBackupRecordsForNote`](./integration.md)）が削除する（`backup_records` は owner 列を持たず、`noteId` 経由でしか特定できないため）。

上表の各cleanup commandと、それらが保存するscope-local `scheduled_tasks` は`workspace.deleted`の`operationId`を必ずpayloadへ保持する。ScopeRouterでは通常write用`assertWritable`を迂回せず、`assertDeletionOwner(operationId)`がWorkspace lifecycleまたはmanifest headerと一致した場合だけ削除continuationとして通す。別operation IDやoperation ID欠落は拒否する。

7. local cleanup開始後、global orchestratorは `workspace_directory` をtombstoneにし、同じWorkspaceId shardのrowで`slug = null`・表示PIIをredactしてpublic routeを直ちにnot foundにする。そのack後にslug key shardのreservationをreleaseするため、旧directory tombstoneが同じslugの再利用を妨げない。manifestを100件ずつ読み、userIdからmembership directory shard、tokenHashからinvitation route shardへ最大6接続で直接delete commandを送る。各item ackをoperation IDで記録し、reshard中は旧新両generationへdeleteする。全ack後に`workspace.deletionManifestCompactContinued { operationId }`をscopeへ保存する。workerはlocal/global双方のack済みitemを`compactAcknowledged(operationId, 100)`で1pageだけ回収し、残件中は同じtaskを同一UoWで再登録する。itemsが0件になった最後のUoWだけが`markCompleted`でheaderをcompleted tombstone化する。local行削除後や応答喪失でも正データを読み直さずmanifestから再開し、遅延した通常writeはcompleted tombstoneで拒否する

`inviteMember` / `resendInvitation` / `acceptInvitation`はglobal reservationの前にworkspace scopeの`assertWritable`を呼び、local commit transactionでも再確認する。2回の間にdeletingへ変わった場合はlocal writeを拒否し、確保済みroute/directory reservationを同じoperation IDでabandonする。その他のworkspace writeはScopeRouter入口の共通検査で拒否する。

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
6. invitation ID / operation ID / tokenを採番し、global D1の `InvitationRouteStore.reserve` でtoken hashを`reserved`にする
7. workspace scopeのlocal transactionで `Invitation.issue` を保存する
8. commit後に `InvitationRouteStore.activate` を同じoperation IDで呼ぶ。local失敗時は`abandon`し、応答喪失時は再試行する
9. active化後に `MailSender.send({ kind: "workspaceInvitation" })` を送る

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
3. operation IDと新tokenを採番し、`InvitationRouteStore.reserveReplacement`で新routeを予約する
4. workspace scopeのlocal transactionで `Invitation.resend` を保存する
5. `activateReplacement`を呼び、D1 1 transactionで旧routeを`revoked`、新routeを`active`にする。local失敗時は新reservationを`abandon`し、応答喪失は同じoperation IDで再開する
6. 新routeのactive化後にメールを送る

このユースケースは**メール送信を伴うため転送境界のレート制限の対象である**（[presentation/index.md](../presentation/index.md)）。`inviteMember` 経由で呼ばれる場合は手前の手順 4 が在庫の上限で守るが、直接呼ばれる経路にはその検査がない — 同じ招待に対する再送を繰り返しても `pending` の件数は増えないため、在庫の上限では止まらない。しきい値は `inviteMember` と同じ**ワークスペース × 発行者で 10 回 / 60 秒**（既定値。正典は [presentation/index.md](../presentation/index.md) の「レート制限」）で、Workers の Rate Limiting binding で数える。

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
2. Invitationを引いてtoken hashとversionを固定し、operation IDを採番する
3. workspace scopeのlocal transactionで `Invitation.revoke` を保存する
4. commit後に `InvitationRouteStore.revoke` を呼ぶ。応答喪失は同じoperation IDで再試行する。手順3〜4の間もlocal正データがrevokedなので旧route経由のpreview / acceptは拒否される

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

1. トークンのハッシュを `InvitationRouteStore.resolveActive` で workspace scope に解決し、対象 object の `InvitationRepository.findByTokenHash` で引く。不在なら `NotFoundError("INVITATION_NOT_FOUND")`
2. `WorkspaceRepository.findById` を引き、不在なら `state: "workspaceMissing"`
3. `Invitation.isExpired` と `status` から `state` を決める
4. `userId` があり既にメンバーなら `state: "alreadyMember"`
5. 招待者の表示名を `UserBatchReader.resolveMany` でUserId shard別に解決する

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

1. トークンのハッシュを `InvitationRouteStore.resolveActive` で解決し、workspace scope object から招待を引く
2. `status !== "pending"` なら `ValidationError("INVITATION_NOT_PENDING")`
3. 既にメンバーなら招待を `accept` にしたうえで既存のロールを返す（ロールは変更しない）
4. UserId shardの`MembershipDirectoryReservationStore.reserveAndClaimActivation`でpending row insert、current UserのActive検査、`activating` claimを1 transactionで行う。Userがdeletingならrowを作らず、削除開始後にmanifest cursorの後方へpending edgeを差し込まない
5. activation claim取得後だけworkspace scope の1 transactionで `Invitation.accept` と `Membership.create` を保存する。local失敗時はedgeをabandonしInvitationはpendingに保つ。claim後にaccount deletionが開始した場合、削除側はこのSagaがactive/abandonedへ収束するまでmanifest scanを待つ
6. local commit 後に directory edge を `active` にし、`InvitationRouteStore.consume`でtoken routeをrevokedにする。両方の応答喪失は同じoperation IDで再試行し、受諾済みtokenをactiveのまま残さない

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
2. `MembershipRepository.listByWorkspace` のpage内最大100 UserIdを`UserBatchReader.resolveMany`でshard別に最大6接続で解決し、射影を組み立てる
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

`userId: string`, `cursor: string | null`, `limit: number`（既定・最大20）

### 出力DTO

`workspaces: ({ status: "active"; workspaceId; name; slug; avatarUrl; role; publication } | { status: "unavailable"; workspaceId; role; retryAfterSeconds })[]`, `nextCursor: string | null`, `hasMore: boolean`

### 処理フロー

1. `UserWorkspaceDirectory.listActiveByUser(userId, cursor, limit)`でUserId shardのactive edgeを`createdAt DESC, workspaceId`のkeysetから最大20件だけ引く
2. page内WorkspaceIdだけを`WorkspaceDirectoryBatchReader.resolveMany`でshard別に最大6接続で解決する。`deleted` tombstoneは落とし、projection未到着・当該shard障害は`unavailable` variantとして返す。全件join・名前sortは行わない。個々の操作時の権限はこの投影を信用せず workspace scope の Membership を読み直す
3. directoryが返したopaque cursorと`hasMore`を返す

### エラーケース

`SystemError(DatabaseError)`、`ValidationError("INVALID_PAGINATION")`

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
4. `MembershipRemovalPreparationStore.hasConflict`と`WorkspaceOperationLockStore.hasMoveConflict(target.userId)`を確認してからowner数を引く。account deletionまたはmove lockと競合すれば拒否する
5. 降格の場合、下表から許可されなくなるkindを作り、`JobRepository.listActiveByRequesterAndKinds(target.userId, disallowedKinds, 100)`で最終述語にlimitを適用する。100件なら同じlocal UoWでcontinuationを積む。kind配列はpayloadへ焼き付けず`nextRole`から毎回導く
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
4. account deletion lockまたは`WorkspaceOperationLockStore.hasMoveConflict(target.userId)`が真なら拒否する。`JobRepository.listActiveByRequester(target.userId, 100)`で最終述語にlimitを適用する
5. global directory edgeを`removing`にしてから、local UoWで4のJob終端・後始末・Membership削除・`workspace.membership.removed`を保存する。同時に残Job正データと`BackupRecord.userId`を100件ずつ削除するsecurity cleanup taskを保存し、全residue削除と`job.removed`発行が完了してからD1 edgeを削除する

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
2. account deletion lockと`WorkspaceOperationLockStore.hasMoveConflict(userId)`を確認し、`ensureOwnerRemains(ownerCount, membership, null)`を呼ぶ
3. `JobRepository.listActiveByRequester(userId, 100)`で脱退者の実行中Jobを集める
4. directory edgeを`removing`にしてから、local UoWでJob終端・Membership削除・security cleanup task保存を行う。残Job正データとBackupRecordを消し終えてからdirectory edgeを削除する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 唯一の owner | `BusinessRuleError(LastOwnerCannotLeave)` |
| 非メンバー | `NotFoundError("MEMBERSHIP_NOT_FOUND")` |

## listPublicWorkspaces

### 概要

サイトマップ用に公開ワークスペースを列挙する（DS-06）。

### 入力DTO

`cursor: string | null`, `limit: number`（既定100、最大200）

### 出力DTO

`entries: { slug: string; updatedAt: Date }[]`, `nextCursor: string | null`, `hasMore: boolean`

### 処理フロー

1. `PublicWorkspaceDirectoryReader.listPublished(cursor, limit)`でWorkspaceId hashの最大32 shardを同時6接続のwaveで読む。署名cursorはrouting generationと各shardの`(updatedAt DESC, workspaceId)`位置を持つ
2. `publication = published AND lifecycle = active`だけを全体limit件へmergeし、WorkspaceId/sourceVersionで重複排除する。総件数は数えず、サイトマップ生成側が`nextCursor`を末尾まで反復する

### エラーケース

`SystemError(DatabaseError)`、`ValidationError("INVALID_PAGINATION")`

## getPublicWorkspace

### 概要

スラッグから公開ワークスペースの情報を引く（WS-09 / DS-02）。

### 入力DTO

`slug: string`

### 出力DTO

`workspaceId`, `name`, `description`, `avatarUrl`, `slug`

### 処理フロー

1. `WorkspaceSlug.create` を構築する（形式違反は不在として扱う）
2. global D1 のactive slug reservationと `workspace_directory` を引く。not found / 非公開なら `WORKSPACE_NOT_FOUND`
3. 詳細にprojection外の列が必要な場合だけWorkspaceIdからscope objectを読み、source versionがdirectoryより古ければretryする

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 形式違反・不在・非公開 | `NotFoundError("WORKSPACE_NOT_FOUND")`（区別しない） |

## deleteMembershipsForUser

### 概要

account deletion operation が指定した1つの workspace scope から、対象利用者のメンバーシップを削除する。

### 入力DTO

`operationId`, `workspaceId`, `userId`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. workspace ID が current scope と一致することを検証し、`applied_operations` に同じ operation ID があれば保存済みの結果を返す
2. 対象が owner なら `countByRole(workspaceId, "owner")` を同じ local transaction で再検査し、唯一なら `LastOwnerCannotLeave` で失敗する
3. 対象利用者が要求した active Job の強制終端と後始末、local著者投影の置換、Membership削除を scope-local task で完了させ、operation結果を保存する
4. 完了 ack を受けた global orchestrator が `membership_directory` edge を削除する。workspace scope から global D1 を直接更新しない

冪等性: 削除は対象がなければ 0 件で終わるため、同じイベントを 2 回受け取っても結果は変わらない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| メンバーシップが 1 件もない | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |
