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

1. `NoteRepository.findById` でノートを引き、`NoteAccessPolicy` で `canEdit` を確認する。あわせてゴミ箱在籍を検査し、ゴミ箱なら `BusinessRuleError(NoteIsTrashed)`。`NoteAccessPolicy` は所有者にはゴミ箱のノートでも `canEdit: true` を返すため、この検査は権限判定とは別に置く
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
5. 衝突があり `confirmMerge` が真なら `mergeTags` を**呼ぶ**（`sourceTagId: tagId`、`targetTagId: 衝突した既存タグの ID`）。その結果をそのまま返し（`tagId` は統合先、`merged: true`、`mergeRequired: false`）、手順 6 には進まない
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

`targetTagId`, `movedAssignments: number`

### 処理フロー

1. スコープを解決し、`manageTags` の権限を確認する
2. 両方のタグを引き、同一スコープであることと `sourceTagId !== targetTagId` を確認する
3. `TagAssignmentRepository.reassign(sourceTagId, targetTagId)` を呼ぶ（衝突する行は削除される）
4. `sourceTag` を削除し、`TagEvents.merged` を収集する

付与の付け替えと `sourceTag` の削除は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する（手順 3 も UoW の内側で実行する）。付け替えだけが残って統合元のタグが生き延びる状態を作らない。

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
2. 削除前に付与を読み、対象ノートの一覧を得る（`affectedNotes` はノートの件数）
3. 付与とタグを削除し、付与 1 件ごとに `TagEvents.unassigned` を併発して収集する。あわせて `TagEvents.deleted` を監査用として発行する（読み取りモデルの投影は `tag.unassigned` が担う。[domains/tag.md](../domains/tag.md)）

手順 2 の読み取りと手順 3 の削除は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する。読み取りが外側だと、その間に付いた付与が `tag.unassigned` を伴わずに FK CASCADE で消え、読み取りモデルにタグが残る。

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
2. `UnitOfWorkProvider.run` で `TagRepository.deleteUnusedInScope(scope)` を呼ぶ。これは**1 文の集合削除**で、そのスコープのタグのうち `tag_assignments` に行を持たないものをすべて消す。`deletedCount` は削除された行数
3. 削除したタグ 1 件につき `TagEvents.deleted`（監査用）を同一 UoW で収集する。多行 INSERT 1 文で outbox に積む

**1 件ずつ `deleteTag` を呼ばないのはなぜか**。`deleteTag` が 1 件ずつ独立した UoW を張るのは、付与ごとに `tag.unassigned` を併発して読み取りモデルの投影につなぐためである（手順 2）。しかしここでの対象は**使用件数 0 のタグに限られる**ので、読む付与は必ず 0 件で `tag.unassigned` は 1 件も出ない。`deleteTag` を 1 件ずつ呼ぶ唯一の理由がそもそも存在しない。

一方、1 件ずつ呼ぶ形には上限がない。タグの数に比例したクエリを発行するため、スコープに未使用タグが数千あると 1 回の実行あたり 1,000 クエリという D1 の上限を超える（[ADR 018](../adr/018-query-budget.md)）。集合削除なら件数によらず 2 クエリで終わる。

**「未使用である」の判定時点も強くなる**。以前は手順 2 の列挙から削除までの間に付与が付いたタグを `deleteTag` の読み直しが救っていたが、集合削除では削除の副問い合わせが**削除の時点で**付与の有無を見るため、その窓自体が存在しない。`TagQueryService.listWithUsage` は画面に件数を出すための読み取りであって、削除の根拠ではなくなる。

### エラーケース

`deleteTag` と同じ。ただし個々のタグの `TAG_NOT_FOUND` は飛ばして続ける。

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

`noteId`, `previousScope: TagScope`, `targetScope: TagScope`

### 出力DTO

`reassignedCount: number`, `droppedCount: number`

### 処理フロー

1. `TagAssignmentRepository.listByNote(noteId)` を引き、`TagRepository.listByIds` で名前を解決する
2. `TagRepository.listByScope(targetScope)` を引く
3. `TagRelocationPolicy.plan` で計画を作る
4. `UnitOfWorkProvider.run` で、`drop` と `reassign` の元の付与を削除し、`reassign` の新しい付与を作る。作り直す付与の `assignedBy` は元の付与の値を引き継ぐ（`note.moved` の payload に操作者は含まれない）。イベントを収集する
5. 同じイベントを 2 回受け取っても、既に付け替え済みなら計画が空になり結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが既に削除済み | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## deleteAssignmentsForNote

### 概要

ノートの完全削除に追随してタグの付与を削除する（`note.purged` の購読）。

### 入力DTO

`noteId`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `UnitOfWorkProvider.run` で `TagAssignmentRepository.deleteByNote(noteId)` を呼ぶ
2. イベントは発行しない（読み取りモデルの行は `note.purged` の投影 `NoteProjectionWriter.remove` が消すため）

削除は対象がなければ 0 件で終わるため、同じイベントを 2 回受け取っても結果は変わらない（冪等）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 付与が既にない | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## deleteTagsForScope

### 概要

利用者・ワークスペースの削除に伴って、そのスコープのタグをすべて削除する（`identity.user.deleted` / `workspace.deleted` の購読）。

### 入力DTO

`scopeType`, `scopeId`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `TagScope` を組み立てる（`identity.user.deleted` → 個人スコープ、`workspace.deleted` → ワークスペーススコープ）
2. `UnitOfWorkProvider.run` で `TagRepository.deleteByScope(scope)` を呼ぶ。付与は `tag_assignments` の FK CASCADE で同時に消える
3. イベントは発行しない（`tag.unassigned` の投影先である読み取りモデルの行自体を、同じ削除イベントを購読する Note の `deleteNotesForOwner` が消すため）

Note の `deleteNotesForOwner` が発行する `note.purged` 経由の `deleteAssignmentsForNote` と削除範囲が重なるが、どちらも 0 件削除で無害に終わるため、順序・重複によらず結果は同じ。

冪等性: 削除は対象がなければ 0 件で終わるため、同じイベントを 2 回受け取っても結果は変わらない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| タグが 1 件もない | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |
