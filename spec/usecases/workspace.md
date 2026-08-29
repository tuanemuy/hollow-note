# ユースケース: Workspace

ドメインの詳細は [domains/workspace.md](../domains/workspace.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## 共通: scope storage と global directory

Workspace / Membership / Invitation の正データは `{ type: "workspace", workspaceId }` の scope DO に置く。`resolveWorkspaceAccess` を含む workspace 内操作は `ScopeRouter` でその object を呼び、権限判定と変更を同じ object 内で行う。

利用者横断の一覧、global uniqueness、URL / token から workspace を見つける入口だけを global D1 の `membership_directory`、`workspace_directory`、`workspace_slug_reservations`、`invitation_routes` に置く。D1 と DO の更新は operation ID 付きの reserve → scope-local commit → activate で行い、応答喪失は同じ operation ID で再開する。pending reservation は正データではなく、期限切れ recovery の対象である。

既存Membershipのrole変更・削除はscope-local commitを先に行い、そのeventでglobal directoryを更新する。遅延中に一覧へ古いrole / edgeが見えても、mutation直前のlocal権限確認が必ず拒否するため権限昇格にはならない。directory更新はsource version条件付きで、古いeventが新しいroleを戻さない。

この「mutation直前のlocal権限確認」を成立させるため、**ワークスペースへの書き込みはすべて、書き込むtransactionの中でactorのMembershipを読み直して権限を再確認する**（プロフィール更新・slug変更・公開 / 非公開・削除受理・招待の発行 / 再送 / 取り消し・role変更・除名）。transactionの外の`resolveWorkspaceAccess`は残すが、それはglobal予約を取る前に権限の無い要求を落とすための早期拒否であって、判定の正本ではない。Workspaceの版はMembershipが変わっても動かないので、要求の処理中に降格・除名されたactorは外側の確認だけでは止まらない。呼ぶ位置は書き込みの前でありさえすればよく、対象側の規則（自分自身の変更・最後のownerの保護）を先に評価するか後にするかは、複数の拒否が同時に成り立つときにどれを報告するかだけを決める。

**この規則が及ぶ範囲**は「ワークスペース scope への書き込み全部」ではなく、**ワークスペースそのもの（プロフィール・公開設定・存在）とメンバー構成を変える書き込み**である。ユースケースがどのドメインに属するかでは分けない — ワークスペースを主体として同じロール表で許される他ドメインの書き込み、すなわちワークスペースのアイコンの差し替え（[usecases/storage.md](./storage.md#storeavatar) の `manageWorkspace`）と使用量の棚卸し（[usecases/usage.md](./usage.md#recalculatestorageusage) のメンバーシップ）も、同じ transaction で読み直す。

対象外は、ワークスペース scope に**中身**を作る・書き換える書き込み（ノートの作成・本文の更新・公開ステータスの変更など）で、これらは transaction の外の権限確認だけで書く。降格や除名の直後に 1 件だけ通ったノートの書き込みは、残ったメンバーが編集も削除もできる普通のコンテンツにとどまるのに対し、上の書き込みは「誰が何をできるか」や公開の可否そのものを動かし、権限を失った当人には取り消せない。ただしノートの**移動**だけは例外で、確定が別 scope への引き渡しになるため、各 phase の transaction で actor の Membership の版を検査する（[usecases/note.md](./note.md#movenote)）。

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

1. global D1 の `membership_directory` から `UserWorkspaceDirectory.countOwnedByUser` で `role = owner` の件数を数え、`MembershipPolicy.ensureWorkspaceQuota` を呼ぶ。数える edge の状態は `spec/domains/workspace.md` の同メソッドの規定に従う（未確定の join も含む）
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
3. local commit 後に `WorkspaceDirectoryProjectionWriter.applySnapshotIfNewer` で `workspace_directory` を更新する。応答喪失は同じ snapshot で再試行する（`sourceVersion` 条件付きなので再送は無害である）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 名前・説明の違反 | `BusinessRuleError` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |
| 対象者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |

## getWorkspaceSettings

### 概要

ワークスペース設定 3 画面（P-31 / P-33 / P-34）の初期表示を供給する（WS-07）。`updateWorkspaceProfile` が編集する項目を書き込みなしで読み出す対のユースケース。

### 入力DTO

`workspaceId: string`, `userId: string`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `workspaceId` | `string` |
| `name` | `string` |
| `description` | `string` |
| `avatarUrl` | `string \| null` |
| `slug` | `string \| null` |
| `publication` | `"private" \| "published"` |
| `role` | `"owner" \| "editor" \| "viewer"` |
| `canManage` | `boolean` |
| `canPublish` | `boolean` |
| `canDelete` | `boolean` |

`description` を含むのは、フォームが読めなかった項目を空で描くと保存時に既存の説明を消してしまうためである。可否フラグを 3 つに分けるのは、3 画面の「読み取り専用」が `manageWorkspace` / `publishWorkspace` / `deleteWorkspace` という別の action で決まるためで、最低ロールが今どれも owner であることは権限表の都合にすぎない。

### 処理フロー

1. `resolveWorkspaceAccess` でロールを解決する。`role` が `null` なら `BusinessRuleError(InsufficientRole)`（メンバーであれば owner でなくても読める — 画面は読み取り専用で描く）
2. `WorkspaceRepository.findById` で引き、射影に `WorkspaceAuthorization.can` の 3 つの判定を添えて返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ワークスペース不在・削除済み | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| 非メンバー | `BusinessRuleError(InsufficientRole)` |

## changeWorkspaceSlug

### 概要

公開ページのスラッグを変更する（WS-07）。

### 入力DTO

`workspaceId`, `userId`, `slug: string | null`

### 出力DTO

`workspaceId`, `slug`, `previousSlug`

### 処理フロー

1. 権限を `manageWorkspace` で確認する
2. scope の現在の slug を読む。**要求が現在値と同じ**なら、global が scope と食い違うときだけ鍵と `workspace_directory` を打ち直して返す（投影は毎回送る）。commit のあとに来る手順はどれも応答を失いうるので、同じ要求の再送がその修復要求になる。非 `null` の側は `resolveActive` がこの workspace を指していなければ予約し直す — これが無いと、予約が `reserved` のまま成功応答を返した要求のあと、新しい公開 URL を予約し直す呼び出しが 1 つも無くなる。`null` の側は同型で、`workspace_directory` がまだ広告している旧 slug を拾って `release` する — `active` な予約には期限が無いので、解放の応答を失うとその slug は**どのワークスペースからも二度と取得できない**。**鍵の解放は投影より先に置く**（投影が先に走ると directory 行の slug が消え、次の要求から旧 slug を辿る手掛かりが無くなる）
3. `slug` が非 `null` なら global D1 の `workspace_slug_reservations` を operation ID と試行 ID 付きで予約する。現在の workspace が同じ値を保持する場合だけ再利用できる
4. workspace scope の transaction で actor の権限を再確認したうえで `Workspace.changeSlug` を適用して保存する（公開中に `null` を渡すとドメインが拒否する）
5. local commit 後に reservation と `workspace_directory` を切り替え、旧slugを解放する。`slug` が `null` なら引き継ぐ先が無いので旧slugは `release` で手放す（`activate` と同じく 1 度だけ再試行し、恒久的に失った分は手順 2 の修復が回収する）。失敗時は operation record から再開し、旧slugは切替完了まで有効に保つ

### エラーケース

`createWorkspace` と同じスラッグ関連のエラーに加え、`BusinessRuleError(PublishedWorkspaceRequiresSlug)`、`ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("ACCOUNT_DELETING")`、`ConflictError("WORKSPACE_DELETING")`。

local commit が拒否された場合は確保済みの slug reservation を `abandon` する。ただし**この試行が行を保持しているときに限る** — 予約 operation ID は `(workspaceId, slug)` から決定的に導かれるので同じ slug を狙う 2 つの要求は 1 行を共有し、条件を付けないと負けた試行の補償が勝った試行の予約を落とす。条件は要求ごとの試行 ID で、`reserve` が行をその試行の保持にし、`abandon` はその試行のものだけを落とす（[domains/workspace.md](../domains/workspace.md) の `WorkspaceSlugReservationStore`）。OCC で負けた試行だけでなく、降格・バリア拒否・ロック競合で落ちた試行も同じ条件で止まる。

## checkWorkspaceSlugAvailability

### 概要

保存前にスラッグが空いているかを答える（WS-01 の「スラッグが既に使われている場合、入力中に検出して代替候補を示す」）。P-30 のスラッグ重複の即時検出と、P-31 のスラッグ編集に使う。

### 入力DTO

`slug: string`, `workspaceId: string | null`（編集中のワークスペースが既に保持している鍵。作成画面では `null`）

### 出力DTO

`slug: string`, `available: boolean`, `ownedBySelf: boolean`

### 処理フロー

1. `WorkspaceSlug.create(input.slug)` を構築する（形式違反・予約語は `BusinessRuleError`）
2. `WorkspaceSlugReservationStore.resolveActive(slug)` を引く。`null` または `workspaceId` と一致するなら `available: true` とし、一致した場合は `ownedBySelf: true` を添える

**助言的な読み取りであって claim ではない**。勝者を決めるのは `createWorkspace` / `changeWorkspaceSlug` が取る予約だけなので、空きと答えたスラッグが競合に負けて `ConflictError("SLUG_ALREADY_USED")` として返ることはありうる。`resolveActive` は確定した claim だけを解決し、他の operation が予約しただけの鍵は空きと読める — ヒントとしては保守的な向きである。スラッグは公開 URL の一部なので、これに答えること自体は列挙オラクルには当たらない。呼び出し元は認証済みセッションに限る（転送境界の責務）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| スラッグの形式違反・予約語 | `BusinessRuleError(InvalidSlug)` / `BusinessRuleError(SlugReserved)` |

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
4. local commit 後に `WorkspaceDirectoryProjectionWriter.applySnapshotIfNewer` で `workspace_directory` を更新する。公開ページとサイトマップはこの行を見るため、投影しなければ公開が外から見えない
5. ワークスペースが所有するノートを workspace scope で走査し、`visibility` が公開のものを数えて `publicNoteCount` として返す（0 件でも成功する。公開ページが空であることを画面が案内するために返す）

数え方が公開ページ本体（`NoteQueryService.searchPublic` が引く公開投影）と分かれているのは、ノートの公開状態を公開投影へ書く経路がまだ無く、投影を数えるとどのワークスペースも 0 件になるからである。scope は自分が所有するノートの可視性の正本なのでこの数字は正確で、一致していないのは公開ページが描く投影のほうである。**投影がノートの公開状態を運ぶようになったら `searchPublic` へ差し替える** — そのとき走査も消える。走査はページではなく件数なので、ワークスペースのノート数に比例した往復になる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| スラッグ未設定で公開しようとした | `BusinessRuleError(SlugRequiredToPublish)` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 既に公開中 | 変更もイベントもなく成功として返す |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |
| 対象者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |

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
4. local commit 後に `WorkspaceDirectoryProjectionWriter.applySnapshotIfNewer` で `workspace_directory` を更新する。`getPublicWorkspace` はこの行の `publication` で公開ページを絞るため、投影しなければ取り下げ後も公開 URL が解決し続ける

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 既に非公開 | 変更もイベントもなく成功として返す |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |
| 対象者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |

## getWorkspacePublication

### 概要

公開設定画面（P-33）の初期表示を供給する（WS-08 / DS-02）。`publishWorkspace` は公開を切り替えた要求にしか公開ページ URL と公開ノート件数を返さないため、画面が最初に描くための書き込みなしの読み取りを別に置く。

### 入力DTO

`workspaceId: string`, `userId: string`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `workspaceId` | `string` |
| `publication` | `"private" \| "published"` |
| `slug` | `string \| null` |
| `publicUrl` | `string \| null` |
| `publicNoteCount` | `number` |
| `canPublish` | `boolean` |

`publicUrl` が非 `null` になるのは `published` のときだけである。私有のワークスペースが持つスラッグはまだどのページにも解決しない。

### 処理フロー

1. `resolveWorkspaceAccess` でロールを解決する。`role` が `null` なら `BusinessRuleError(InsufficientRole)`（メンバーであれば読める）
2. `WorkspaceRepository.findById` で引く
3. `publishWorkspace` 手順 5 と同じ数え方で公開ノート件数を求める。非公開のときも数えるのは、「公開ページが空になる」という注意が意味を持つのが公開**前**だからである

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ワークスペース不在・削除済み | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| 非メンバー | `BusinessRuleError(InsufficientRole)` |

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
6. manifest完成後かつ手順4の強制終端continuationが0件まで完了したことを確認する。`listLocalPending(operationId, 100)`でmanifest itemを読み、Membership/Invitationをkind別に`deleteByIds`で最大100件ずつ削除して、同じUoWで`acknowledgeLocal`と次の`workspace.deletionLocalContinued`を保存する。local pendingが0件になった最後のUoWでだけ、Membership / Invitationの残件を数え直して0件であることを確認してからWorkspaceを削除し、`workspace.deleted { workspaceId, operationId }`を保存する。manifestが固定しそこねた子が残っていれば、削除を失敗させずにmembership列挙からやり直す（appendは対象ごとに冪等）。数千edgeを親DELETEのCASCADEへ渡さないのが目的なので、安全網も物理制約ではなくこの数え直しが担う（Workspace → Membership / Invitation の `RESTRICT` は論理的な所有関係の宣言であって DDL の `FOREIGN KEY` を要求しない。[database/index.md](../database/index.md)）。manifest/tombstoneはglobal cleanup ackまで残す

| ドメイン | 購読ユースケース | 責務 |
| --- | --- | --- |
| Note | [`deleteNotesForOwner`](./note.md) | ワークスペース所有ノートと版・読み取りモデルの削除。1 件ずつ `note.purged` を発行し、タグ付与・保管ファイル・バックアップ記録の後始末につなぐ |
| Tag | [`deleteTagsForScope`](./tag.md) | ワークスペーススコープのタグと付与の削除（`TagRepository.deleteByScope`） |
| Storage | [`deleteFilesByOwner`](./storage.md) | ワークスペース所有ファイルの削除 |
| Usage | [`deleteQuota`](./usage.md) | クォータ行の削除 |

ワークスペース所有ノートのバックアップ記録は `workspace.deleted` を直接は購読せず、`deleteNotesForOwner` が発行する `note.purged` の購読者（Integration の [`deleteBackupRecordsForNote`](./integration.md)）が削除する（`backup_records` は owner 列を持たず、`noteId` 経由でしか特定できないため）。

上表の各cleanup commandと、それらが保存するscope-local `scheduled_tasks` は`workspace.deleted`の`operationId`を必ずpayloadへ保持する。ScopeRouterでは通常write用`assertWritable`を迂回せず、`assertDeletionOwner(operationId)`がWorkspace lifecycleまたはmanifest headerと一致した場合だけ削除continuationとして通す。別operation IDやoperation ID欠落は拒否する。

7. local phaseがWorkspace行を消した最後のUoWで、決定的IDの`workspace.deletionGlobalCleanupContinued { operationId }`を`scheduled_tasks`へ積む（手順 3 / 手順 7 末尾の 2 つと同じ形の継続で、global orchestratorの駆動口はこれである）。orchestratorは `workspace_directory` をtombstoneにし、同じWorkspaceId shardのrowで`slug = null`・表示PIIをredactしてpublic routeをnot foundにする。そのack後にslug key shardのreservationをreleaseするため、旧directory tombstoneが同じslugの再利用を妨げない。manifestを100件ずつ読み、userIdからmembership directory shard、tokenHashからinvitation route shardへ最大6接続で直接delete commandを送る。各item ackをoperation IDで記録し、reshard中は旧新両generationへdeleteする。全ack後に`workspace.deletionManifestCompactContinued { operationId }`をscopeへ保存する。workerはlocal/global双方のack済みitemを`compactAcknowledged(operationId, 100)`で1pageだけ回収し、残件中は同じtaskを同一UoWで再登録する。itemsが0件になった最後のUoWだけが`markCompleted`でheaderをcompleted tombstone化する。local行削除後や応答喪失でも正データを読み直さずmanifestから再開し、遅延した通常writeはcompleted tombstoneで拒否する

global cleanupがlocal phaseの**後**に走ることで、削除受理からdirectory tombstoneまでの窓はlocal phaseのturn数だけ開く。この窓で観測できるのは `listPublicWorkspaces` が組むサイトマップだけである — 公開ページ本体（`getPublicWorkspace`）はscope側の lifecycle を見るので `beginDeletion` の瞬間からnot foundになるのに対し、サイトマップは `PublicWorkspaceDirectoryReader.listPublished` しか読まないため、メンバーの多いワークスペースはlocal phaseのあいだ列挙され続ける。受理と同時にglobal turnを積まないのは、global cleanupが対象を正データではなく**完成したmanifest**からしか読まないためである。manifestが`markReady`に達するのはlocal phaseの中であり、それ以前に走らせても消すべきedge / routeの集合が確定していない。手放すslugも、Workspace行が消える前のturnが読み取ってpayloadへ載せる

`inviteMember` / `resendInvitation` / `acceptInvitation`はglobal reservationの前にworkspace scopeの`assertWritable`を呼び、local commit transactionでも再確認する。2回の間にdeletingへ変わった場合はlocal writeを拒否し、確保済みroute/directory reservationを同じoperation IDでabandonする。その他のworkspace writeはScopeRouter入口の共通検査で拒否する。

ジョブ履歴の削除は購読者に含めない（`deleteAccount` の購読者表が持つ [`deleteJobsForRequester`](./job.md) にあたる行がないのは意図的である）。ジョブ履歴は要求者に帰属する記録であり、ワークスペースの削除で他のメンバーの処理履歴（JB-01）まで消してはならない。対象が消えた行は `listJobs` / `getJobDetail` の `targetLabel` が「削除済み」になり（[usecases/job.md](./job.md)）、保持期間を過ぎれば `pruneJobHistory` が回収する。実行中のものは手順 4 でキャンセル済みなので、走り続ける行も残らない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 確認入力の不一致 | `ValidationError("CONFIRMATION_MISMATCH")` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 移動が stage 済み | `ConflictError("WORKSPACE_MOVE_IN_PROGRESS")` |
| 既に削除が進行中 | 進行中の `operationId` を返して受理済みとして扱う |
| 削除が終端済み（Workspace 行が消えている） | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| 要求者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |

進行中の削除に**合流する**（別の operation を開かない）のは、要求パスが毎回新しい operation ID を採番するためである。要求そのものは冪等な鍵を持たないので、二重送信を `ConflictError` にすると、確認欄を正しく埋めた 2 回目の押下が失敗として見える。削除は終端であり結果は同じなので、進行中の operation ID を返して受理済みとして扱う。`beginDeletion` 自体は operation ID について冪等なので、継続 turn の再実行も何も書かない。

## getWorkspaceDeletionStatus

### 概要

削除の進み具合を答える（WS-10）。P-34 の「実行中 / 完了」を描くための読み取りで、`deleteWorkspace` が返す `accepted` の続きにあたる。

### 入力DTO

`workspaceId: string`, `userId: string`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `workspaceId` | `string` |
| `status` | `"none" \| "inProgress" \| "completed"` |
| `operationId` | `string \| null` |
| `canDelete` | `boolean` |

### 処理フロー

1. `WorkspaceRepository.findById` で引く。不在なら `completed` を返す（`operationId: null` / `canDelete: false`）。削除サガは local phase の最後に Workspace 行を消すため、行の不在がそのまま利用者から見た完了である。global cleanup と manifest の縮約はその後に続くが、ワークスペースを失った利用者からは観測できない
2. `resolveWorkspaceAccess` でロールを解決する。`role` が `null` なら `BusinessRuleError(InsufficientRole)`
3. `Workspace` の lifecycle が `deleting` なら `inProgress` と `operationId`、`active` なら `none` を返す

行が不在の場合にメンバー判定を行わないのは、その時点で参照できるメンバーシップがどこにも残っていない（manifest が edge を消し終えている）ためである。漏れるのは「そのワークスペースがもう無い」ことだけで、これは `resolveWorkspaceAccess` が `WORKSPACE_NOT_FOUND` で既にすべてのサインイン済み利用者へ答えている。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー（ワークスペースは存在する） | `BusinessRuleError(InsufficientRole)` |

## inviteMember

### 概要

メールアドレスとロールを指定して招待を発行し、メールを送る（WS-03）。

### 入力DTO

`workspaceId`, `userId`（招待者）, `email: string`, `role: string`

### 出力DTO

`invitationId`, `email`, `role`, `expiresAt`, `invitationUrl`, `mailSent: boolean`

`mailSent` はメールを送出できたかを表す。送信の失敗は招待を失敗させない（下の「エラーケース」）が、失敗したなら招待リンクは招待者が自分で共有するしかないため、P-32 が警告を出せるように結果を返す。

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `Email.create` と `WorkspaceRole.create` を構築する
3. 招待先が既にメンバーなら `ConflictError("ALREADY_MEMBER")`
4. `InvitationRepository.findPendingByWorkspaceAndEmail` を引き、既に `pending` の招待があれば `resendInvitation` を**呼ぶ**（`workspaceId` / `userId` はそのまま、`invitationId` は引いた招待の ID）。その結果の `invitationId` / `expiresAt` / `invitationUrl` をそのまま返し、`email` / `role` は既存の招待の値を写して手順 5・6 には進まない
5. invitation ID / operation ID / tokenを採番し、global D1の `InvitationRouteStore.reserve` でtoken hashを`reserved`にする
6. workspace scopeのlocal transactionで、`InvitationRepository.countPendingIssuedSince(workspaceId, now - 24 時間)` が上限（50 件）以上なら `ValidationError("INVITATION_LIMIT_REACHED")` とし、そうでなければ `Invitation.issue` を保存する。判定を発行と同じ transaction に置くのは、外で数えると検査と insert の間に枠が変わり、49 件を同時に読んだ 2 件がどちらも通って 51 件になるためである（この count だけが自 UoW の書き込みを観測する理由でもある。[domains/workspace.md](../domains/workspace.md)）。したがって判定は手順 4 の畳み込みより**後**にある — 再送は行を増やさないので、在庫の上限で止める理由が無い。**これはレート制限ではなくクォータである** — 上限に掛かるのは「直近 24 時間に発行した未処理の招待」の在庫であり、招待が 1 件受諾されるか取り消されればその場で枠が空く。待てば必ず解けるとは限らず、解除の時刻も出せない（`countPendingIssuedSince` は件数しか返さない）。`THROTTLED` / `RATE_LIMITED` と別のコードにするのはこの違いによる（[presentation/index.md](../presentation/index.md)）
7. commit後に `InvitationRouteStore.activate` を同じoperation IDで呼ぶ。local失敗時は`abandon`し、応答喪失時は再試行する
8. active化後に `MailSender.send({ kind: "workspaceInvitation" })` を送る

手順 4 はユースケースの**呼び出し**であり、手順の複製ではない（[usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」）。このユースケースは手順 4 までに 1 件も書き込みを行わないため末尾呼び出しになり、`resendInvitation` が自分の UoW で確定した結果だけが残る。`resendInvitation` は `expectedVersion` を要求しないため渡す版もなく、その手順 1・2（権限の確認と `pending` の再確認）が重複するだけである。既存招待のロールを入力の `role` で書き換えないのは意図で、ロールを変えたい場合は取り消してから招待し直す（WS-03）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| メール形式・ロールの違反 | `BusinessRuleError` |
| 既にメンバー | `ConflictError("ALREADY_MEMBER")` |
| 未処理の招待が上限（50 件） | `ValidationError("INVITATION_LIMIT_REACHED")` |
| 招待者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |
| メール送信の失敗 | 記録して継続（招待は成立させ、`mailSent: false` を返す） |

## resendInvitation

### 概要

保留中の招待のトークンと期限を作り直して再送する（WS-03）。

### 入力DTO

`workspaceId`, `userId`, `invitationId`

### 出力DTO

`invitationId`, `expiresAt`, `invitationUrl`, `mailSent: boolean`

`mailSent` の意味は `inviteMember` と同じで、送信の失敗は再送自体を失敗させない。`inviteMember` が末尾呼び出しでこのユースケースを使うときは、その値をそのまま写して返す。

### 処理フロー

1. 権限を `manageMembers` で確認する
2. `InvitationRepository.findById` で引き、`workspaceId` の一致と `status === "pending"` を確認する
3. operation IDと新tokenを採番し、`InvitationRouteStore.reserveReplacement`で新routeを予約する
4. workspace scopeのlocal transactionで `Invitation.resend` を保存する
5. `activateReplacement`を呼び、D1 1 transactionで旧routeを`revoked`、新routeを`active`にする。local失敗時は新reservationを`abandon`し、応答喪失は同じoperation IDで再開する
6. 新routeのactive化後にメールを送る

このユースケースは**メール送信を伴うため転送境界のレート制限の対象である**（[presentation/index.md](../presentation/index.md)）。**`inviteMember` 経由でも在庫の上限は再送を止めない** — 在庫の判定は畳み込みより後（発行の transaction の中）にあり、同じ招待に対する再送を繰り返しても `pending` の件数は増えないためである。したがって**両経路とも**歯止めは転送境界のレート制限だけである。しきい値は `inviteMember` と同じ**ワークスペース × 発行者で 10 回 / 60 秒**（既定値。正典は [presentation/index.md](../presentation/index.md) の「レート制限」）で、Workers の Rate Limiting binding で数える。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 招待が不在・他ワークスペースのもの | `NotFoundError("INVITATION_NOT_FOUND")` |
| 受諾済み・取り消し済み | `ValidationError("INVITATION_NOT_PENDING")` |
| レート制限（転送境界） | `ValidationError("RATE_LIMITED")` |
| 要求者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |

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
| `inviterName` | `string \| null` |
| `email` | `string` |
| `state` | `"acceptable" \| "expired" \| "revoked" \| "accepted" \| "alreadyMember" \| "workspaceMissing"` |
| `workspaceId` | `string \| null` |

`workspaceId` は `state: "alreadyMember"` のときだけ非 null にする。このユースケースは未サインインでも読めるため、他の状態で返すとリンクを持っているだけの相手にワークスペースの識別子を渡すことになる。`alreadyMember` の閲覧者は既にそのワークスペースを持っているので追加の露出にならず、受諾済みのリンクを本人が開き直した経路（`acceptInvitation` は `INVITATION_NOT_PENDING` を返すため使えない）でワークスペースへ送る唯一の手立てになる（P-06）。

### 処理フロー

1. トークンのハッシュを `InvitationRouteStore.resolveActive` で workspace scope に解決し、対象 object の `InvitationRepository.findByTokenHash` で引く。不在なら `NotFoundError("INVITATION_NOT_FOUND")`
2. `WorkspaceRepository.findById` を引き、不在なら `state: "workspaceMissing"`
3. `Invitation.isExpired` と `status` から `state` を決める
4. `userId` があり既にメンバーなら `state: "alreadyMember"`
5. 招待者の表示名を `UserBatchReader.resolveMany` でUserId shard別に解決する。招待者のアカウントが既に無い場合は `inviterName: null` にする（招待そのものは有効なままで、名乗る相手が消えただけである）

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
2. **既にメンバーなら**、招待が保留中であればそれを `accept` にし、`activating` のまま残っている自分の edge があれば settle し、token route を `consume` して既存のロールを返す（ロールは変更しない）。この判定を招待の status より**先**に置くのが、local commit は着地したが後続の global 手順を失った join の再入口になる — その時点で招待は `accepted` なので、status で先に落とすと edge を settle できる呼び出しが 1 つも無くなり、そのメンバーの一覧からワークスペースが永久に消える
3. メンバーでなく、招待が `status !== "pending"` なら `ValidationError("INVITATION_NOT_PENDING")`
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
| 受諾者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |

## listMembers

### 概要

ワークスペースのメンバーを一覧する（WS-05）。

### 入力DTO

`workspaceId`, `userId`, `page`, `limit`

### 出力DTO

`members: { membershipId; userId; displayName; email; avatarUrl; role; joinedAt }[]`, `count`, `ownerCount: number`, `viewerRole`, `canManage: boolean`

### 処理フロー

1. `resolveWorkspaceAccess` でロールを解決する。`role === null` なら `BusinessRuleError(InsufficientRole)`
2. `MembershipRepository.listByWorkspace` のpage内最大100 UserIdを`UserBatchReader.resolveMany`でshard別に最大6接続で解決し、射影を組み立てる
3. `MembershipRepository.countByRole(workspaceId, "owner")` を `ownerCount` として返す
4. `canManage` は `WorkspaceAuthorization.can(role, "manageMembers")`。UI が操作の可否を出し分けるために返す
5. 手順 1 で解決したロールを `viewerRole` として返す。一覧は `joinedAt` 昇順なので閲覧者自身の行はページに載るとは限らず、自分の操作（WS-06 の脱退）の可否を `members` から読み取ることはできない

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
2. `InvitationRepository.listPendingByWorkspace` を引き、`count` をそのまま返す。絞り込みは store 側にあるので `count` はワークスペースの保留中総数であり、終端状態の招待が 1 ページ分並んでも保留中の招待は隠れず件数も縮まない
3. `expired` は `Invitation.isExpired(invitation, now)`。期限切れは status ではないので、期限を過ぎた `pending` も一覧に残る（画面が出す操作は再送である）

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

1. `UserWorkspaceDirectory.listActiveByUser(userId, cursor, limit)`でUserId shardのactive edgeを`createdAt DESC, workspaceId`のkeysetから最大20件だけ引く。roleはこのedgeから来る投影で、[changeMemberRole](#changememberrole)のrole変更が`applyRoleIfNewer`で反映される
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

`membership_directory` edge の `role` は本ユースケースが同期的に書かず、`workspace.membership.roleChanged` の購読者が `MembershipDirectoryReservationStore.applyRoleIfNewer` で投影する（[domains/workspace.md](../domains/workspace.md) のドメインイベント）。edge は `listUserWorkspaces` が返す role の唯一の出どころなので、投影しなければ切替 UI が古い role を出し続ける。順序は event が運ぶ `membershipId` と `sourceVersion`（変更後の Membership の版）で決め、edge が別の世代を名指していれば何も書かず、同じ世代の中では後着の古い変更が role を巻き戻さない。表示だけの投影であり、操作時の権限は必ず workspace scope の Membership を読み直す（[listUserWorkspaces](#listuserworkspaces) 手順 2）ので、投影の遅れは表示の遅れであって権限の昇格にはならない。

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
| 対象者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| 対象者を actor とする移動が stage 済み | `ConflictError("WORKSPACE_MOVE_IN_PROGRESS")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |
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
5. global directory edgeを`removing`にしてから、local UoWで4のJob終端・後始末・Membership削除・`workspace.membership.removed`を保存する。同時に残Job正データと`BackupRecord.userId`を100件ずつ削除するsecurity cleanup taskを保存し、全residue削除と`job.removed`発行が完了してからD1 edgeを削除する。edge の削除は同じ transaction に積む scope task（`workspace.membershipRemovalEdgeContinued`。ID は `(workspaceId, userId)` の組）が耐久的に駆動し、commit 直後の即時削除はその前に置く速い経路である。削除の応答を失っても edge は必ず落ちる — 落ちなければ `(userId, workspaceId)` の組が押さえられ続け、再除名も再招待もその組を解放できない
6. 手順 5 の transaction が拒否されたら `abandonRemoval` で宣言を取り消し、edgeを`active`へ戻す。手順 2〜4 の規則は宣言の前と削除transactionの中の2回評価され、2回目が拒否しうる（最後のownerの保護・削除受理・actorのrole喪失はいずれも再試行で解けない終端の拒否である）。取り消さなければ、まだメンバーである利用者の一覧からワークスペースが消えたまま戻せない。**Membershipが既に無いという拒否だけは取り消さない** — 同じMembershipの別の除名が着地したということであり、edgeはその除名のものである

生成物の回収は除名では特に落とせない。一括ダウンロードの生成物は要求者の個人 subject に帰属して TTL が 7 日あるため、回収しなければ、アクセス権を失った利用者の手元にこのワークスペースのノート本文を含む ZIP が 7 日残る（[usecases/job.md](./job.md)）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 自分自身の除名 | `BusinessRuleError(CannotRemoveSelf)`（自身の離脱は `leaveWorkspace` へ誘導する） |
| 最後の owner の除名 | `BusinessRuleError(LastOwnerCannotLeave)` |
| 対象が不在 | `NotFoundError("MEMBERSHIP_NOT_FOUND")` |
| 対象者のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| 対象者を actor とする移動が stage 済み | `ConflictError("WORKSPACE_MOVE_IN_PROGRESS")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |

## leaveWorkspace

### 概要

自分がワークスペースを脱退する（WS-06）。

### 入力DTO

`workspaceId`, `userId`

### 出力DTO

なし。

### 処理フロー

1. `MembershipRepository.findByWorkspaceAndUser` を引く。不在なら、`MEMBERSHIP_NOT_FOUND` を返す**前に** `completeRemoval` を再発行する — local commit は着地したが global の edge を落とし損ねた脱退は、この状態でしか観測できない。edge が `removing` のまま残ると `(userId, workspaceId)` の組が押さえられ続け、以後の再参加が通らない。応答は不在のまま `NotFoundError("MEMBERSHIP_NOT_FOUND")`
2. account deletion lockと`WorkspaceOperationLockStore.hasMoveConflict(userId)`を確認し、`ensureOwnerRemains(ownerCount, membership, null)`を呼ぶ
3. `JobRepository.listActiveByRequester(userId, 100)`で脱退者の実行中Jobを集める
4. directory edgeを`removing`にしてから、local UoWでJob終端・Membership削除・security cleanup task保存を行う。残Job正データとBackupRecordを消し終えてからdirectory edgeを削除する。`removeMember` 手順 5 と同じく、edge の削除は同じ transaction に積む scope task（`workspace.membershipRemovalEdgeContinued`）が耐久的に駆動し、手順 1 の再発行と即時削除はその前に立つ速い経路である
5. 手順 4 の transaction が拒否されたら `removeMember` 手順 6 と同じ形で `abandonRemoval` を呼び、宣言を取り消す。2 人の owner が同時に脱退すれば手順 2 の owner 数の確認は両方が通り、削除transactionは片方しか通らない。Membershipが既に無い場合だけは取り消さない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 唯一の owner | `BusinessRuleError(LastOwnerCannotLeave)` |
| 非メンバー | `NotFoundError("MEMBERSHIP_NOT_FOUND")` |
| 自身のアカウント削除が進行中 | `ConflictError("ACCOUNT_DELETING")` |
| 自身を actor とする移動が stage 済み | `ConflictError("WORKSPACE_MOVE_IN_PROGRESS")` |
| ワークスペースの削除が受理済み | `ConflictError("WORKSPACE_DELETING")` |

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
