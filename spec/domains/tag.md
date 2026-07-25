# Tag

ノートを分類する語彙を管理し、ノートへの付与を保つ。Tag が NoteId を参照し、Note は Tag を知らない（[ADR 008](../adr/008-domain-boundaries.md)）。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| Tag | タグ | ノートを分類する語。所属先ごとに独立した名前空間を持つ |
| Scope | スコープ | タグが属する文脈。個人またはワークスペース |
| Assignment | 付与 | あるタグがあるノートに付いていること |
| Merge | 統合 | 2 つのタグを 1 つにまとめ、付与を寄せること |

## 値オブジェクト

### TagId / AssignmentId

- **バリデーション**: 空白のみは不可。`BusinessRuleError(TagErrorCode.InvalidId)`

### TagName

- **フィールド**: `value: string`（表示用）、`normalized: string`（同一判定用）
- **バリデーション**: 前後の空白を除去して 1〜50 文字。改行を含まない。違反時 `BusinessRuleError(InvalidTagName)`
- **正規化**: 小文字化し、全角英数字を半角へ、連続する空白を 1 つに畳む。この結果を `normalized` とする
- **等価性**: `normalized` が一致

### TagScope

```
TagScope =
  | { type: "user"; userId: UserId }
  | { type: "workspace"; workspaceId: WorkspaceId }
```

- **等価性**: `type` と ID が一致
- **補助**: `TagScope.fromNoteOwner(owner: NoteOwner): TagScope`（ノートの所有者からスコープを導く）

## エンティティ

### Tag（集約ルート）

```
Tag = {
  id: TagId
  scope: TagScope
  name: TagName
  version: number
  createdAt: Date
  updatedAt: Date
}
```

**不変条件**

- `(scope, name.normalized)` はサービス全体で一意
- スコープをまたぐ変更はできない（タグは作られたスコープから移動しない）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; scope: TagScope; name: string }, now: Date` | `WithEventDrafts<Tag, TagEvent>` | `TagName.create` で検証・正規化して生成。`tag.created` を発行 |
| `rename` | `tag: Tag, name: string, now: Date` | `WithEventDrafts<Tag, TagEvent>` | 正規化後が同じなら表示名のみ更新。異なれば更新し `tag.renamed`（旧名を含む）を発行 |

削除と統合はユースケースが `TagEvents.deleted` / `TagEvents.merged` を直接発行する。

### TagAssignment（集約ルート）

```
TagAssignment = {
  id: AssignmentId
  tagId: TagId
  noteId: NoteId
  scope: TagScope
  assignedBy: UserId
  assignedAt: Date
}
```

不変（作成後に変更されない）ため OCC を持たない。付け替えは削除と作成で表す。

**不変条件**

- `(tagId, noteId)` は一意
- `scope` は付与先ノートの所有者から導かれるスコープと一致する
- 1 ノートあたりの付与は 50 件まで（`TagAssignmentPolicy` が検査する）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `create` | `params: { id: string; tagId: TagId; noteId: NoteId; scope: TagScope; assignedBy: UserId }, now: Date` | `WithEventDrafts<TagAssignment, TagEvent>` | 生成し `tag.assigned` を発行 |

削除はユースケースが `TagEvents.unassigned` を直接発行する。

## ドメインサービス

### TagAssignmentPolicy

**責務**: 1 ノートに対する付与の集合に関する規則を検査する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureAssignable` | `currentCount: number` | `void` | 50 件以上なら `BusinessRuleError(TooManyTags)` |
| `ensureScopeMatches` | `assignmentScope: TagScope, noteOwner: NoteOwner` | `void` | 不一致なら `BusinessRuleError(ScopeMismatch)` |

**依存するポート**: なし

### TagRelocationPolicy

**責務**: ノートが別の所属先へ移ったときに、付与をどう付け替えるかを決める。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `plan` | `current: readonly { assignment: TagAssignment; name: TagName }[], targetScope: TagScope, existingInTarget: readonly Tag[]` | `RelocationPlan` | 移動先に同じ `normalized` のタグがあれば付け替え、なければ付与を外す（[ADR 003](../adr/003-note-ownership-model.md)） |

```
RelocationPlan = Readonly<{
  reassign: readonly { dropAssignmentId: AssignmentId; targetTagId: TagId }[];
  drop: readonly AssignmentId[];
}>;
```

`reassign` の各要素は「この付与を削除し、移動先の `targetTagId` で付与を作り直す」ことを表す。`drop` は移動先に同名のタグがないため外れる付与。

移動先に存在しないタグを新規作成することはしない。名前が一致するタグだけを引き継ぐ。

**依存するポート**: なし

## ポート

### TagRepository

```ts
interface TagRepository extends TransactionalRepository<Tag, TagId> {
  findByScopeAndName(scope: TagScope, normalized: string): Promise<Versioned<Tag> | null>;
  listByScope(scope: TagScope): Promise<readonly Tag[]>;
  listByIds(ids: readonly TagId[]): Promise<readonly Tag[]>;
  deleteByScope(scope: TagScope): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("TAG_NAME_ALREADY_USED")`、`SystemError(DatabaseError)`

### TagAssignmentRepository

```ts
interface TagAssignmentRepository {
  insert(assignment: TagAssignment): Promise<void>;
  findByTagAndNote(tagId: TagId, noteId: NoteId): Promise<TagAssignment | null>;
  listByNote(noteId: NoteId): Promise<readonly TagAssignment[]>;
  listByNotes(noteIds: readonly NoteId[]): Promise<readonly TagAssignment[]>;
  countByNote(noteId: NoteId): Promise<number>;
  delete(id: AssignmentId): Promise<void>;
  deleteByTag(tagId: TagId): Promise<number>;
  deleteByNote(noteId: NoteId): Promise<number>;
  reassign(fromTagId: TagId, toTagId: TagId): Promise<number>;   // 統合時に付与を寄せる。衝突する行は削除する
}
```

**エラーケース**: `ConflictError("ASSIGNMENT_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### TagQueryService

**目的**: タグ管理画面と候補表示のための読み取り。

```ts
interface TagQueryService {
  listWithUsage(scope: TagScope, criteria: TagListCriteria): Promise<PaginationResult<TagUsage>>;
  suggest(scope: TagScope, prefix: string, limit: number): Promise<readonly TagUsage[]>;
  listNamesByNotes(noteIds: readonly NoteId[]): Promise<ReadonlyMap<string, readonly string[]>>;
}

type TagListCriteria = Readonly<{
  keyword: string | null;
  sort: "usageDesc" | "nameAsc" | "lastUsedDesc";
  pagination: Pagination;
}>;

type TagUsage = Readonly<{
  id: string;
  name: string;
  usageCount: number;
  lastUsedAt: Date | null;
}>;
```

**エラーケース**: `SystemError(DatabaseError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `tag.created` | `{ tagId, scope, name }` | 監査 |
| `tag.renamed` | `{ tagId, scope, previousName, currentName }` | 読み取りモデルの投影 |
| `tag.merged` | `{ sourceTagId, targetTagId, scope }` | 読み取りモデルの投影 |
| `tag.deleted` | `{ tagId, scope }` | 読み取りモデルの投影 |
| `tag.assigned` | `{ tagId, noteId, scope }` | 読み取りモデルの投影 |
| `tag.unassigned` | `{ tagId, noteId, scope }` | 読み取りモデルの投影 |

## エラーコード

```
TagErrorCode =
  | "InvalidId" | "InvalidTagName" | "TooManyTags" | "ScopeMismatch"
  | "TagNameAlreadyUsed" | "CannotMergeIntoItself"
```

## ユースケース（概要）

`assignTag`, `unassignTag`, `listTagsWithUsage`, `suggestTags`, `renameTag`, `mergeTags`, `deleteTag`, `deleteUnusedTags`, `listTagsForNotes`, `relocateAssignmentsForNote`

詳細は [usecases/tag.md](../usecases/tag.md)。
