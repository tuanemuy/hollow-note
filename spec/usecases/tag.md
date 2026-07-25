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

1. `NoteRepository.findById` でノートを引き、`NoteAccessPolicy` で `canEdit` を確認する
2. `TagScope.fromNoteOwner(note.owner)` でスコープを決める
3. `TagName.create(tagName)` を構築する
4. `TagAssignmentRepository.countByNote(noteId)` を引き、`TagAssignmentPolicy.ensureAssignable` を呼ぶ
5. `TagRepository.findByScopeAndName(scope, normalized)` を引く。なければ `Tag.create` を作る
6. 既に同じ付与があれば何もせず `created: false` で返す
7. `TagAssignment.create` を作り、`UnitOfWorkProvider.run` でタグと付与を保存してイベントを収集する

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

1. ノートを引き、`canEdit` を確認する
2. `TagAssignmentRepository.findByTagAndNote` を引く。なければ何もせず成功として返す
3. `UnitOfWorkProvider.run` で削除し、`TagEvents.unassigned` を収集する

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

`tagId`, `name`, `merged: boolean`, `mergeRequired: boolean`

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. `TagRepository.findById` で引き、スコープの一致を確認する
3. `TagName.create(name)` を構築し、`findByScopeAndName` で衝突を調べる
4. 衝突があり `confirmMerge` が偽なら、変更せず `mergeRequired: true` を返す
5. 衝突があり `confirmMerge` が真なら `mergeTags` の手順に委ねる
6. 衝突がなければ `Tag.rename` を保存する

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

`targetTagId`, `movedAssignments: number`

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. 両方のタグを引き、同一スコープであることと `sourceTagId !== targetTagId` を確認する
3. `TagAssignmentRepository.reassign(sourceTagId, targetTagId)` を呼ぶ（衝突する行は削除される）
4. `UnitOfWorkProvider.run` で `sourceTag` を削除し、`TagEvents.merged` を収集する

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

`affectedNotes: number`

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. `TagAssignmentRepository.deleteByTag(tagId)` の件数を得る
3. `UnitOfWorkProvider.run` でタグを削除し、`TagEvents.deleted` を収集する

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

`deletedCount: number`

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. `TagQueryService.listWithUsage` で使用件数 0 のものを集める
3. 順に `deleteTag` と同じ手順で削除する

### エラーケース

`deleteTag` と同じ。

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

ノートの移動に追随してタグの付与を付け替える（`note.moved` の購読）。

### 入力DTO

`noteId`, `previousScope: TagScope`, `targetScope: TagScope`, `actorUserId`

### 出力DTO

`reassignedCount: number`, `droppedCount: number`

### 処理フロー

1. `TagAssignmentRepository.listByNote(noteId)` を引き、`TagRepository.listByIds` で名前を解決する
2. `TagRepository.listByScope(targetScope)` を引く
3. `TagRelocationPolicy.plan` で計画を作る
4. `UnitOfWorkProvider.run` で、`drop` と `reassign` の元の付与を削除し、`reassign` の新しい付与を作る。イベントを収集する
5. 同じイベントを 2 回受け取っても、既に付け替え済みなら計画が空になり結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが既に削除済み | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |
