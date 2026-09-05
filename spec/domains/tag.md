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

削除と統合は再開可能なlocal operationが最大200付与ずつ処理する。operation開始後は対象タグをlockし、assign/rename/別operationを拒否する。各pageで付与変更・対象Noteのprojection revision bump・個別再投影taskを同じUoWに入れ、全page完了後だけ `TagEvents.deleted` / `TagEvents.merged` を発行する。

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

`reassign` の各要素は「source snapshotの付与をtarget scopeの `targetTagId` で作る」ことを表す。`drop` は移動先に同名Tagがない付与。`assignedBy` はsnapshotの値を引き継ぎ、move Sagaは操作者を改めて要求しない。

移動先に存在しないタグを新規作成することはしない。名前が一致するタグだけを引き継ぐ。

**依存するポート**: なし

## ポート

### TagRepository

```ts
interface TagRepository extends TransactionalRepository<Tag, TagId> {
  findByScopeAndName(scope: TagScope, normalized: string): Promise<Versioned<Tag> | null>;
  listByScope(scope: TagScope): Promise<readonly Tag[]>;
  listByIds(ids: readonly TagId[]): Promise<readonly Tag[]>;
  deleteByScope(scope: TagScope, limit: number): Promise<number>;
  deleteUnusedInScope(scope: TagScope, limit: number): Promise<readonly TagId[]>;
}
```

`deleteByScope`はassignmentが0件になったTagだけをTagId順の先頭から最大`limit`件（1〜100）削除する。FK CASCADEは安全網でありscope cleanupの作業分割には使わない。`deleteUnusedInScope` は、そのスコープのタグのうち `TagAssignment` を持たずoperation lockもないものをTagId順で最大`limit`件だけ1文で消し、IDを返す。`limit`は1〜200。未使用判定と削除を同じ文にし、200件ならcursorを持たず次のAlarm turnで残存行を先頭から処理する。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("TAG_NAME_ALREADY_USED")`、`SystemError(DatabaseError)`

### TagAssignmentRepository

```ts
interface TagAssignmentRepository {
  insert(assignment: TagAssignment): Promise<void>;
  findByTagAndNote(tagId: TagId, noteId: NoteId): Promise<TagAssignment | null>;
  listByNote(noteId: NoteId): Promise<readonly TagAssignment[]>;
  listByNotes(noteIds: readonly NoteId[]): Promise<readonly TagAssignment[]>;
  listByTag(tagId: TagId, page: TagAssignmentPage): Promise<readonly TagAssignment[]>;
  countByNote(noteId: NoteId): Promise<number>;
  delete(id: AssignmentId): Promise<void>;
  deleteBatchByTag(tagId: TagId, limit: number): Promise<readonly TagAssignment[]>;
  deleteByScope(scope: TagScope, limit: number): Promise<number>;
  deleteByNote(noteId: NoteId, limit: number): Promise<number>;
  reassignBatch(fromTagId: TagId, toTagId: TagId, limit: number): Promise<readonly NoteId[]>;   // 衝突行削除を含み、影響Noteを返す
}

type TagAssignmentPage = Readonly<{
  afterNoteId: NoteId | null;   // この NoteId より後ろを読む（キーセット。件数を数える OFFSET ではない）
  limit: number;
}>;
```

**`listByNote` は必ず `AssignmentId` の昇順で返す。** 順序が無ければ同じノートの読み取りがバックエンド間でも再読の間でも一致せず、比較できるのは集合だけになる。カーソルを持たないので昇順であること以外の要求はない。

**`deleteByNote` は同じ `AssignmentId` 昇順の先頭から最大 `limit` 件を消す。** どの `limit` 件を消すかは契約であってバックエンドの裁量ではない — 途中まで消した時点の残りがバックエンド間で一致し、`listByNote` で観測できることがそのまま有界削除の検証手段になる。

**`listByTag` は必ず `noteId` の昇順で返す。** 順序は契約であって実装の裁量ではない — 読み取りモデルのタグのファンアウト（[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）が `afterNoteId` をカーソルにしてページを進めるため、順序が安定しないとノートを取りこぼす。索引は `tag_assignments_tag_note_uq` (`tag_id`, `note_id`) がそのまま使える（[database/index.md](../database/index.md)）。

`listByTag` / delete / reassignはいずれも最大200件のpage/batchだけを扱う。全件を返す契約は提供しない。scope cleanup用`deleteByScope`もTagが同scopeであるassignmentを最大200件だけ消す。delete/reassign batchは影響Noteを返し、同じUoWでprojection revisionをbumpできるようにする。

`insert` は 2 つの一意制約を別の種類のエラーへ写す。`(tagId, noteId)` の重複は呼び手が受け入れられる衝突なので `ConflictError("ASSIGNMENT_ALREADY_EXISTS")`、`AssignmentId` の再利用は採番の誤りなので `SystemError(DatabaseError)` とする。両者を 1 つのエラーに畳むと、直すべき事故に対して「再試行せよ」と答えることになる（同じ整理を `BackupRecordRepository` の `BACKUP_RECORD_ALREADY_EXISTS` にも置く。[domains/integration.md](./integration.md)）。

### TagOperationStore

```ts
interface TagOperationStore {
  startDelete(input: { operationId: string; tagId: TagId; scope: TagScope }): Promise<void>;
  startMerge(input: { operationId: string; sourceTagId: TagId; targetTagId: TagId; scope: TagScope }): Promise<void>;
  startDeleteUnused(input: { operationId: string; scope: TagScope }): Promise<void>;
  find(operationId: string): Promise<TagOperation | null>;
  assertUnlocked(tagIds: readonly TagId[]): Promise<void>;
  addProcessed(operationId: string, count: number): Promise<void>;
  complete(operationId: string): Promise<void>;
  markFailed(operationId: string, errorCode: string): Promise<void>;
  retryFailed(operationId: string): Promise<void>;
  abortUnstarted(operationId: string): Promise<void>;
}

type TagOperation = Readonly<{
  operationId: string;
  kind: "delete" | "merge" | "deleteUnused";
  scope: TagScope;
  sourceTagId: TagId | null;
  targetTagId: TagId | null;
  affectedCount: number;
  processedCount: number;
  state: "running" | "completed" | "failed" | "aborted";
}>;
```

operation rowと対象tagのUNIQUE lockを同じscope SQLiteに置く。`assignTag` / `unassignTag` / `renameTag` / `deleteTag` / `mergeTags` は`assertUnlocked`を同じtransactionで呼ぶ。worker停止時もoperationとscheduled taskが残り、Alarmが同じoperation IDで再開する。retry上限では`markFailed`がoperationとtaskをfailedにし、lockは自動解放しない。`retryFailed`は同じoperation/taskをrunning/pendingへ戻し、処理済みpageをやり直さず残集合から再開する。`abortUnstarted`は`processedCount = 0`のfailed operationだけを`aborted`へ遷移させ、task削除とlock解放を同じtransactionで行う。aborted rowは冪等応答のため保持し、同じabortの再送にはabortedを返す。1件でも処理済みなら元のTag/Assignment集合へ原子的に戻せないため中止を拒否し、retryだけを許す。

**`afterNoteId` はキーセットであってオフセットではない。** `WHERE tag_id = ? AND note_id > ? ORDER BY note_id LIMIT ?` と解釈する。読んだ件数を数える `OFFSET` にすると、カーソルより前の付与が並行して消えるたびに後続のノートを静かに飛ばす — 付与は `unassignTag` / `deleteTag` の CASCADE / `deleteAssignmentsForNote` / `relocateAssignmentsForNote` / `mergeTags` の衝突行削除によって、ファンアウトの進行中にも消えうる。位置を ID で表せば、前方の削除は残りの行の位置を動かさない（[domains/index.md](./index.md) の「継続要求」）。

**エラーケース**: `ConflictError("ASSIGNMENT_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### TagQueryService

**目的**: タグ管理画面と候補表示のための読み取り。

```ts
interface TagQueryService {
  listWithUsage(scope: TagScope, criteria: TagListCriteria): Promise<PaginationResult<TagUsage>>;
  suggest(scope: TagScope, prefix: string, limit: number): Promise<readonly TagUsage[]>;
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

ノート群に付いたタグ名の解決（`listTagsForNotes`）は、付与と語彙をそれぞれの集約から引く `TagAssignmentRepository.listByNotes` + `TagRepository.listByIds` で行うため、この読み取りサービスには持たせない。

**エラーケース**: `SystemError(DatabaseError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `tag.created` | `{ tagId, scope, name }` | 監査 |
| `tag.renamed` | `{ tagId, scope, previousName, currentName }` | 読み取りモデルの投影 |
| `tag.merged` | `{ sourceTagId, targetTagId, scope, affectedNotes }` | 完了監査。各Noteの投影はpageごとの個別再投影taskが担う |
| `tag.deleted` | `{ tagId, scope, affectedNotes }` | 完了監査。各Noteの投影は個別再投影taskが担う |
| `tag.unusedBatchDeleted` | `{ tagIds, scope }`（最大200） | 未使用タグ一括削除の監査 |
| `tag.assigned` | `{ tagId, noteId, scope }` | 読み取りモデルの投影 |
| `tag.unassigned` | `{ tagId, noteId, scope }` | 読み取りモデルの投影 |

## エラーコード

```
TagErrorCode =
  | "InvalidId" | "InvalidTagName" | "TooManyTags" | "ScopeMismatch"
  | "TagNameAlreadyUsed" | "CannotMergeIntoItself"
```

## ユースケース（概要）

`assignTag`, `unassignTag`, `listTagsWithUsage`, `suggestTags`, `renameTag`, `mergeTags`, `deleteTag`, `deleteUnusedTags`, `getTagOperation`, `retryTagOperation`, `listTagsForNotes`, `relocateAssignmentsForNote`, `deleteAssignmentsForNote`, `deleteTagsForScope`

詳細は [usecases/tag.md](../usecases/tag.md)。
