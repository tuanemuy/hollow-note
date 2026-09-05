# ユースケース: Tag

ドメインの詳細は [domains/tag.md](../domains/tag.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## 共通: スコープの解決

タグを扱うユースケースは、先頭で `TagScope` を組み立てる。ワークスペースのスコープでは `resolveWorkspaceAccess` を呼び、`manageTags`（管理系）または `editNote`（付与系）の権限を確認する。個人のスコープでは `userId` の一致を確認する。

## assignTag

### 概要

ノートにタグを付ける。既存のタグがなければ作る（OR-06 / OR-07）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `noteId` | `string` | ○ | — |
| `tagName` | `string` | ○ | `TagName` の規則 |

### 出力DTO

`tagId`, `tagName`, `assignmentId`, `created: boolean`

### 処理フロー

1. `NoteRouteStore.resolve(noteId)`をD1 primaryで引き、`active` routeの1つのscope objectだけを呼ぶ。`moving`は切替前source、`purging` / `tombstone` / 不在は`NotFoundError("NOTE_NOT_FOUND")`。scope miss / routeVersion不一致はprimaryで1回だけ引き直す
2. current scope の `NoteRepository.findById` でノートを引き、routeVersionと`canEdit`を確認する。ゴミ箱なら `BusinessRuleError(NoteIsTrashed)`。`TagScope`はcurrent ScopeKeyから組み立て、Note ownerから別DOを探索しない
3. `TagName.create(tagName)` を構築する
4. `TagAssignmentRepository.countByNote(noteId)` を引き、`TagAssignmentPolicy.ensureAssignable` を呼ぶ
5. `TagRepository.findByScopeAndName(scope, normalized)` を引く。既存tagなら同じUoWで`TagOperationStore.assertUnlocked([tagId])`を確認し、なければ `Tag.create` を作る
6. 既に同じ付与があれば何もせず `created: false` で返す
7. `TagAssignment.create`を作り、同じscope-local UoWでタグ・付与を保存し、`NoteProjectionRevisionStore.bump(noteId)`のrevisionを`tag.assigned`へ載せる

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| タグ名の違反 | `BusinessRuleError(InvalidTagName)` |
| 付与数の上限 | `BusinessRuleError(TooManyTags)` |
| 同名タグの同時作成 | `ConflictError("TAG_NAME_ALREADY_USED")`（呼び出し側は 1 度だけ読み直して再試行する） |
| ゴミ箱のノート | `BusinessRuleError(NoteIsTrashed)` |

## unassignTag

### 概要

ノートからタグを外す（OR-06 / OR-07）。

### 入力DTO

`userId`, `noteId`, `tagId`

### 出力DTO

なし。

### 処理フロー

1. assignTagと同じくD1 primaryのNote routeを解決し、その1つのscopeでノート・routeVersion・`canEdit`を確認する。`purging` / `tombstone`はnot found、stale routeは1回だけ引き直す
2. `TagAssignmentRepository.findByTagAndNote` を引く。なければ何もせず成功として返す。あれば同じUoWで`TagOperationStore.assertUnlocked([tagId])`を確認する
3. 同じscope-local UoWで付与を削除し、`NoteProjectionRevisionStore.bump(noteId)`のrevisionを`tag.unassigned`へ載せる

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## listTagsWithUsage

### 概要

タグ管理画面のために、タグを使用件数つきで一覧する（OR-08）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `keyword: string | null`, `sort`, `page`, `limit`

### 出力DTO

`items: { id; name; usageCount; lastUsedAt }[]`, `count`, `canManage: boolean`

### 処理フロー

1. スコープを解決し、ワークスペースなら `viewNote` の権限を確認する
2. `TagQueryService.listWithUsage` を呼ぶ
3. `canManage` は `manageTags` の可否

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー | `BusinessRuleError(InsufficientRole)` |

## suggestTags

### 概要

タグ入力の候補を返す（OR-06）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `prefix: string`, `limit: number`

### 出力DTO

`items: { id; name; usageCount }[]`

### 処理フロー

1. スコープを解決し、`viewNote` の権限を確認する
2. `TagQueryService.suggest` を呼ぶ（`prefix` が空なら使用頻度順の先頭を返す）

### エラーケース

`listTagsWithUsage` と同じ。

## renameTag

### 概要

タグ名を変更する。既存の同名タグがある場合は統合の可否を返す（OR-08）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `tagId`, `name: string`, `confirmMerge: boolean`

### 出力DTO

`tagId`, `name`, `merged: boolean`, `mergeRequired: boolean`, `operationId: string | null`, `status: "pending" | "completed" | null`

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. `TagRepository.findById` で引き、スコープの一致と`TagOperationStore.assertUnlocked([tagId])`を確認する
3. `TagName.create(name)` を構築し、`findByScopeAndName` で衝突を調べる
4. 衝突があり `confirmMerge` が偽なら、変更せず `mergeRequired: true` を返す
5. 衝突があり `confirmMerge` が真なら `mergeTags` を呼ぶ。`tagId`は統合先、`merged: true`、`mergeRequired: false`とoperation ID/statusを返し、手順6へ進まない。`merged`は統合operationを受理した意味で、`status: pending`なら物理付け替えは継続中である
6. 衝突がなければ `UnitOfWorkProvider.run` で `Tag.rename` を保存する

手順 5 はユースケースの**呼び出し**であり、手順の複製ではない（[usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」）。このユースケースは手順 5 までに 1 件も書き込みを行わないため末尾呼び出しになり、`mergeTags` が自分の `UnitOfWorkProvider.run` で確定した結果だけが残る。`run` の入れ子も、呼ばれた側だけが確定して矛盾する状態も生じない。`mergeTags` は `expectedVersion` を要求しないため渡す版もない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| タグ不在・他スコープ | `NotFoundError("TAG_NOT_FOUND")` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 名前の違反 | `BusinessRuleError(InvalidTagName)` |

## mergeTags

### 概要

2 つのタグを 1 つにまとめる（OR-08）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `sourceTagId`, `targetTagId`

### 出力DTO

`operationId`, `targetTagId`, `affectedNotes: number | null`, `status: "pending" | "completed"`（pendingではnull、完了照会で確定値）

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. operation IDを採番し、1つのlocal UoWで両タグを引き、同一スコープ・別tag・`assertUnlocked`を確認する。全件countは行わない
3. 同じUoWで`startMerge`と `tag.mergeContinued` taskを保存し、pendingを返す
4. Alarm workerは1 turnで `reassignBatch(source, target, 200)` を実行する。返った各NoteIdについて`NoteProjectionRevisionStore.bump`、local `projection.reprojectRequested`、routeVersionを持たないpublic `publicProjection.reprojectRequested` outboxを同じUoWへ保存し、processed件数を進める。両task IDは `tagProjectionTaskId(operationId, plane, noteId, projectionRevision)` で決定的に導出する
5. 200件なら同じtaskを直後へ再設定する。200件未満ならsourceの残件0を確認してsource tagを削除し、lockを解放して`tag.merged`を発行する

新規付与・rename・別のmerge/deleteはoperation中の両tagで拒否する。各pageがcommit済みなら再試行は残るsource assignmentだけを先頭から処理するため、cursorなしで前進する。targetへの重複付与は同じpageでsource行を削除し、影響Noteのrevisionはどちらの場合も1回進める。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 同一タグ同士 | `BusinessRuleError(CannotMergeIntoItself)` |
| いずれかが不在 | `NotFoundError("TAG_NOT_FOUND")` |
| スコープ不一致 | `BusinessRuleError(ScopeMismatch)` |

## deleteTag

### 概要

タグを削除し、すべてのノートから外す（OR-08）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `tagId`

### 出力DTO

`operationId`, `affectedNotes: number | null`, `status: "pending" | "completed"`（pendingではnull、完了照会で確定値）

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. operation IDを採番し、1つのlocal UoWでtagを引き、`TagOperationStore.assertUnlocked`を確認する。全件countは行わない
3. 同じUoWで`startDelete`と `tag.deleteContinued` taskを保存し、pendingを返す
4. Alarm workerは `deleteBatchByTag(tagId, 200)` で最大200付与を削除し、各NoteIdの`NoteProjectionRevisionStore.bump`、local `projection.reprojectRequested`、routeVersionを持たないpublic `publicProjection.reprojectRequested` outboxを同じUoWへ保存する。両task IDは `tagProjectionTaskId(operationId, plane, noteId, projectionRevision)` で決定的に導出する
5. 200件ならtaskを直後へ再設定する。200件未満なら残件0を確認してtagを削除し、lockを解放して`tag.deleted`を発行する

operation開始後は対象tagへのassign/renameを拒否するため、page間に新しい付与は入らない。worker停止・Alarm重複はoperation IDと残存assignment集合で冪等に再開する。1 transactionの付与変更・revision bump・task fan-outは最大200件である。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| タグ不在 | `NotFoundError("TAG_NOT_FOUND")` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |

## deleteUnusedTags

### 概要

使用件数 0 のタグをまとめて削除する（OR-08）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`

### 出力DTO

`operationId`, `deletedCount: number`, `status: "pending" | "completed"`

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. operation IDを採番し、`startDeleteUnused`と `tag.deleteUnusedContinued` taskを同じlocal UoWで保存してpendingを返す。workerは `TagRepository.deleteUnusedInScope(scope, 200)` を呼び、削除IDを最大200件含む1つの `tag.unusedBatchDeleted` 監査eventを保存する
3. 200件なら同じtaskを直後へ再設定し、累計をoperationへ加える。200件未満ならoperationをcompleteする

削除SQLはoperation lockのないtagに限り、`NOT EXISTS(tag_assignments)`を削除時点で評価する。したがって画面表示後に付与されたtagは消さない。個別`tag.deleted`を数千件生成せず、1 Alarm turnのrow・event payloadを200件に固定する。

### エラーケース

`deleteTag` と同じ。ただし個々のタグの `TAG_NOT_FOUND` は飛ばして続ける。

## getTagOperation

### 概要

非同期のタグ削除・統合・未使用削除の進捗を返す。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `operationId`

### 出力DTO

`operationId`, `kind`, `status: "pending" | "completed" | "failed" | "aborted"`, `processedCount`, `affectedCount: number | null`

### 処理フロー

1. scopeと`manageTags`権限を確認する
2. current scopeの`TagOperationStore.find`を引く。不在なら`NotFoundError("TAG_OPERATION_NOT_FOUND")`
3. runningはprocessedCountとaffectedCount null、completedは確定affectedCountを返す。failedはscheduled taskのlastErrorを表示用codeへ写す。abortedは中止済みの終端状態として返す

UIは2秒間隔でpollし、完了後にtag一覧と該当Note一覧を再読込する。

## retryTagOperation

### 概要

失敗したタグ操作を同じoperation IDで再開する。変更がまだ1件も確定していない場合だけ中止してlockを解放できる。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `operationId`, `action: "retry" | "abort"`

### 出力DTO

`operationId`, `status: "pending" | "aborted"`

### 処理フロー

1. scopeと`manageTags`権限を確認し、current scopeのoperationを引く
2. `state = "aborted"`かつ`action = "abort"`なら書き込まずabortedを返す。それ以外で`state !== "failed"`なら`ConflictError("TAG_OPERATION_NOT_FAILED")`
3. `action = "retry"`では、同じlocal UoWで`retryFailed(operationId)`を呼び、既存の継続taskをattempt 0 / pendingへ戻してAlarmを再設定する。operation ID、lock、task payloadは変えない
4. `action = "abort"`では`abortUnstarted(operationId)`を呼ぶ。`processedCount > 0`なら`ConflictError("TAG_OPERATION_PARTIALLY_APPLIED")`とし、lockを保持する。0ならoperationをabortedへ遷移させ、task削除とlock解放を同じUoWで行う

retry後のworkerが再び上限へ達した場合は`markFailed`へ戻る。新しいoperationを作らないため、完了済みpageのrevisionを二重に進めず、利用者が再試行を重ねても操作系列は1つのままである。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| operation不在・他scope | `NotFoundError("TAG_OPERATION_NOT_FOUND")` |
| viewer | `BusinessRuleError(InsufficientRole)` |
| failedでない | `ConflictError("TAG_OPERATION_NOT_FAILED")` |
| 一部適用済みのabort | `ConflictError("TAG_OPERATION_PARTIALLY_APPLIED")` |

## listTagsForNotes

### 概要

一覧やノート詳細に表示するため、複数ノートのタグをまとめて引く。

### 入力DTO

`noteIds: string[]`

### 出力DTO

`tagsByNote: Record<string, { id: string; name: string }[]>`

### 処理フロー

1. `TagAssignmentRepository.listByNotes` を引く
2. `TagRepository.listByIds` で名前を解決してノートごとにまとめる

権限の判定は呼び出し元（ノートの取得）が済ませている前提。このユースケース自体は権限を判定しない。

### エラーケース

`SystemError(DatabaseError)`

## relocateAssignmentsForNote

### 概要

move Saga の source snapshot作成とtarget stagingで、タグ付与を移送する内部scope command。`note.moved` の購読者ではない。

### 入力DTO

`migrationId`, `phase: "snapshotSource" | "stageTarget" | "retireSource"`, `noteId`, `assignments?: readonly MovedTagAssignment[]`

### 出力DTO

`reassignedCount: number`, `droppedCount: number`

### 処理フロー

1. `snapshotSource` はcurrent source scopeでassignmentとTagの表示名・正規化名・`assignedBy`を読み、portable snapshotを返す。まだ削除しない
2. `stageTarget` はcurrent target scopeの同名Tagを解決し、`TagRelocationPolicy.plan` に従ってassignmentをstaged Noteへ作る。存在しないTagはdropとして記録する
3. `retireSource` はroute切替後にsource assignmentを削除する
4. 各phaseは `migrationId + phase` を `applied_operations` で重複排除し、別scopeのrepositoryを同じUoWから呼ばない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが既に削除済み | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## deleteAssignmentsForNote

### 概要

ノートの完全削除に追随してタグの付与を削除する（`note.purged` の購読）。

### 入力DTO

`noteId`, `scope: ScopeKey`, `operationId: string`（追随する purge の operation ID。継続行 `(kind, operationId)` の鍵）, `deletionOperationId: string | null`（`note.purged`から引き継ぐ）

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `deletionOperationId`が非nullなら各turnで**同じ operation の receipt が current scope にあること**を確認する（`ScopeCleanupAdmissionStore.describePersonalCleanup` で引き、`running` でも `completed` でも通す。別 operation・不在・abort 済み・prune 済みは `ConflictError("CLEANUP_OPERATION_MISMATCH")`）。そのうえで `UnitOfWorkProvider.run` で `TagAssignmentRepository.deleteByNote(noteId, 200)` を1回呼ぶ
2. 200件なら同じUoWで`tag.noteDeleteContinued { noteId, deletionOperationId }`を再登録する。**再登録の priority は turn の出自で決める** — `deletionOperationId` が非 null なら security cleanup（0）、null なら期限回収（3）とする。class 0 は障壁が待つ削除 turn のためのもので、通常の完全削除（ゴミ箱の手動空け・保持期限の掃引）まで class 0 に入れると、class 内には fairness が無い（同一 class は `(dueAt, kind, operationId)` だけで並ぶ）ぶん [platform/index.md](../platform/index.md) の飢餓保証が崩れる。200件未満なら、同じUoWで`tag.noteDeleteContinued`の継続task行を`ScopeTaskScheduler.complete`する — これが継続の連鎖を止める唯一の手段で、呼ばなければ scope-task runner が同じ行を claim し続ける。イベントは発行しない（読み取りモデルの行は `note.purged` を処理するlocal/public projection writerが消すため）

手順 1 で `ScopeCleanupAdmissionStore.assertOwner`（「まだ掃除してよいか」を問う述語で、完了済みの障壁を拒否する）**は使えない**。障壁を完了させるのは Note コンポーネント自身の ack であり、その ack が待った purge は自分の transaction から `note.purged` を outbox へ入れて、リレーが**そのあと**配送する。したがって完了と fan-out は必ず競合し、`assertOwner` を通すと初回配送も継続も毎回拒否され、outbox 行は隔離、継続 task は `failed` になって付与が恒久的に取り残される。完了済みを通してよいのは、この追随者が何も ack しないからである — purge 済みノートの行を消すだけで receipt に触れないので、完了した receipt を `running` へ巻き戻すことがない。`deleteTagsForScope` のように障壁へ ack する経路は従来どおり `assertOwner` を使う。

削除は対象がなければ 0 件で終わるため、同じイベントを 2 回受け取っても結果は変わらない（冪等）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 付与が既にない | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## deleteTagsForScope

### 概要

scope cleanup commandに従って、そのscopeのタグをすべて削除する。workspace deletionはlocal event、account deletionはpersonal scope commandから呼ぶ。

### 入力DTO

`deletionOperationId`, `scope: ScopeKey`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. 入力`scope`から`TagScope`を組み立てる
2. 各pageのUoW前に`ScopeCleanupAdmissionStore.assertOwner(deletionOperationId)`を呼ぶ。最初のphaseは`TagAssignmentRepository.deleteByScope(scope, 200)`で付与を最大200件だけ消す。1件以上消したturnは件数にかかわらず同じUoWで`tag.scopeDeleteContinued { deletionOperationId }`を保存して終了する
3. assignment削除が0件だった次のturnだけ`TagRepository.deleteByScope(scope, 100)`でtagを最大100件消す。100件なら同じ継続を保存し、100件未満なら残るtag operation/lock行を縮約して完了する。1turnはassignment最大200またはtag最大100のどちらかで、1つのtagに数万assignmentがあっても親DELETEのCASCADEへ渡さない
4. イベントは発行しない（`tag.unassigned` の投影先である読み取りモデルの行自体を、同じ削除イベントを購読する Note の `deleteNotesForOwner` が消すため）

Note の `deleteNotesForOwner` が発行する `note.purged` 経由の `deleteAssignmentsForNote` と削除範囲が重なるが、どちらも 0 件削除で無害に終わるため、順序・重複によらず結果は同じ。

冪等性: 削除は対象がなければ 0 件で終わるため、同じcommand/taskを 2 回受け取っても結果は変わらない。cursorは持たず、削除後の先頭100件を読むため必ず前進する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| タグが 1 件もない | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |
