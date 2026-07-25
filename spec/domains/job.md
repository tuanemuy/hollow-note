# Job

非同期処理の状態・進捗・再試行・キャンセルを管理する。方針は [ADR 005](../adr/005-async-processing.md) に従う。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| Job | ジョブ | 1 件の非同期処理。実行者に紐づく |
| ParentJob | 親ジョブ | 一括操作の全体を表すジョブ |
| ChildJob | 子ジョブ | 一括操作の対象 1 件を表すジョブ |
| Target | 対象 | ジョブが作用する相手。種別と ID の組で多相に持つ |
| Artifact | 生成物 | ジョブが作った成果物（PDF / ZIP） |
| FailureReason | 失敗理由 | 利用者に説明できる粒度の失敗の分類 |

## 値オブジェクト

### JobId

- **バリデーション**: 空白のみは不可。`BusinessRuleError(JobErrorCode.InvalidId)`

### JobKind

- **フィールド**: `value: "conversion" | "regeneration" | "referenceImport" | "driveBackup" | "pdfExport" | "bulkExport" | "bulkMove" | "bulkVisibility" | "bulkTag" | "bulkDelete" | "bulkBackup"`

### JobTarget

```
JobTarget =
  | { type: "note"; noteId: NoteId }
  | { type: "storedFile"; fileId: StoredFileId }
  | { type: "batch" }              // 親ジョブ。個々の対象は子ジョブが持つ
```

### JobProgress

- **フィールド**: `completed: number`, `total: number`
- **バリデーション**: `0 <= completed <= total`。違反時 `BusinessRuleError(InvalidProgress)`
- **補助**: `JobProgress.ratio(progress): number`

### JobFailure

- **フィールド**: `reason: JobFailureReason`, `detail: string`
- `detail` は運用者向けの文字列。利用者には `reason` から導いた文言を出す

```
JobFailureReason =
  | "unsupportedFormat" | "corruptedFile" | "integrationRequired" | "providerAuthFailed"
  | "modelError" | "quotaExceeded" | "timeout" | "sizeExceeded" | "passwordProtected"
  | "permissionRevoked" | "targetMissing" | "storageError" | "canceled" | "unknown"
```

`JobFailureReason` は Conversion の `ConversionFailureReason` の全値を含む上位集合であり、変換ジョブの失敗理由をそのまま格納できる。Job から Conversion への型依存は持たない。

### JobPayload

ジョブ登録時の指定を保持する。`kind` によって形が決まる。

```
JobPayload =
  | { kind: "conversion"; requestedVisibility: "private" | "unlisted" | "public" }
  | { kind: "regeneration"; source: "localFile" | "driveBackup"; instruction: string | null; modelOverride: string | null }
  | { kind: "referenceImport" }
  | { kind: "driveBackup" }
  | { kind: "pdfExport" }
  | { kind: "bulkExport"; format: "html" | "markdown" | "pdf" }
  | { kind: "bulkMove"; targetOwnerType: "user" | "workspace"; targetWorkspaceId: string | null }
  | { kind: "bulkVisibility"; visibility: "private" | "unlisted" | "public" }
  | { kind: "bulkTag"; action: "add" | "remove"; tagName: string }
  | { kind: "bulkDelete"; mode: "trash" | "purge" }
  | { kind: "bulkBackup" }
```

- **バリデーション**: `payload.kind` は `Job.kind` と一致する。不一致なら `BusinessRuleError(PayloadKindMismatch)`
- 子ジョブは親ジョブと同じ `payload` を持つ

### ArtifactRef

- **フィールド**: `fileId: StoredFileId`, `expiresAt: Date`
- **バリデーション**: `expiresAt` は生成時刻より後

### AttemptCount

- **フィールド**: `value: number`
- **バリデーション**: 0 以上の整数。上限は 3（`AttemptCount.exhausted(count): boolean`）

## エンティティ

### Job（集約ルート）

```
JobBase = {
  id: JobId
  parentId: JobId | null
  kind: JobKind
  target: JobTarget
  payload: JobPayload
  requestedBy: UserId
  scope: JobScope                       // 対象が属する文脈。履歴の絞り込みに使う
  attempts: AttemptCount
  version: number
  createdAt: Date
  updatedAt: Date
}

JobScope =
  | { type: "user"; userId: UserId }
  | { type: "workspace"; workspaceId: WorkspaceId }

QueuedJob    = JobBase & { status: "queued" }
RunningJob   = JobBase & { status: "running"; startedAt: Date; progress: JobProgress }
SucceededJob = JobBase & { status: "succeeded"; startedAt: Date; finishedAt: Date; artifact: ArtifactRef | null }
FailedJob    = JobBase & { status: "failed"; startedAt: Date | null; finishedAt: Date; failure: JobFailure }
CanceledJob  = JobBase & { status: "canceled"; startedAt: Date | null; finishedAt: Date }

Job = QueuedJob | RunningJob | SucceededJob | FailedJob | CanceledJob
```

**不変条件**

- 終端状態（`succeeded` / `failed` / `canceled`）からは遷移しない
- `artifact` を持つのは `succeeded` のみ
- `parentId` が指すジョブの `target.type` は `"batch"`
- 親ジョブの `progress.total` は子ジョブの件数と一致する

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `enqueue` | `params: { id: string; parentId: JobId \| null; kind: JobKind; target: JobTarget; payload: JobPayload; requestedBy: UserId; scope: JobScope }, now: Date` | `WithEventDrafts<QueuedJob, JobEvent>` | `payload.kind !== kind` なら `BusinessRuleError(PayloadKindMismatch)`。`attempts: 0` で生成し `job.enqueued` を発行 |
| `enqueueBatch` | `params: { id: string; kind: JobKind; payload: JobPayload; requestedBy: UserId; scope: JobScope; total: number }, now: Date` | `WithEventDrafts<RunningJob, JobEvent>` | 親ジョブ。`target: { type: "batch" }`、`progress: { completed: 0, total }` で即 `running` にする。`job.enqueued` を発行 |
| `start` | `job: QueuedJob, total: number, now: Date` | `WithEventDrafts<RunningJob, JobEvent>` | `attempts` を 1 増やす。`job.started` を発行 |
| `reportProgress` | `job: RunningJob, completed: number, now: Date` | `RunningJob` | `JobProgress` を作り直す。イベントは発行しない（更新が高頻度になるため） |
| `succeed` | `job: RunningJob, artifact: ArtifactRef \| null, now: Date` | `WithEventDrafts<SucceededJob, JobEvent>` | `job.succeeded` を発行 |
| `fail` | `job: QueuedJob \| RunningJob, failure: JobFailure, now: Date` | `WithEventDrafts<FailedJob, JobEvent>` | `job.failed` を発行 |
| `cancel` | `job: QueuedJob \| RunningJob, now: Date` | `WithEventDrafts<CanceledJob, JobEvent>` | `job.canceled` を発行 |
| `retry` | `job: FailedJob, now: Date` | `WithEventDrafts<QueuedJob, JobEvent>` | `AttemptCount.exhausted` が真なら `BusinessRuleError(RetryLimitExceeded)`。`status` を `queued` に戻し `failure` を捨てる。`job.enqueued` を発行 |
| `isTerminal` | `job: Job` | `boolean` | 終端状態かどうか |
| `isCancelable` | `job: Job` | `boolean` | `queued` または `running` |

**ライフサイクル**

`enqueue` → `queued` → `start` → `running` → `succeed` / `fail` / `cancel`。`failed` からのみ `retry` で `queued` に戻れる。

## ドメインサービス

### BatchProgressCalculator

**責務**: 子ジョブの結果から親ジョブの進捗と終了状態を導く。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `summarize` | `children: readonly Job[]` | `BatchSummary` | 件数を数え、全件が終端なら親の終了状態を決める |
| `applyTo` | `parent: RunningJob, summary: BatchSummary, now: Date` | `WithEventDrafts<Job, JobEvent>` | 未終了なら `reportProgress`、全件終端なら `succeed` または `fail` |

```
BatchSummary = Readonly<{
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  settled: boolean;                 // 全件が終端状態
}>;
```

全件が終端で、成功が 1 件以上なら親は `succeeded`（部分失敗を含む）。成功が 0 件かつ失敗が 1 件以上なら `failed`（`reason: "unknown"`, `detail` に内訳）。それ以外（全件キャンセル）は `canceled`。

**依存するポート**: なし

### JobConcurrencyPolicy

**責務**: 同時に実行してよいジョブかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureNoDuplicate` | `existing: readonly Job[], kind: JobKind, target: JobTarget` | `void` | 同じ `kind` と `target` の未終端ジョブがあれば `BusinessRuleError(DuplicateJob)` |
| `ensureBulkExportSlot` | `runningBulkExports: number` | `void` | 1 件以上動いていれば `BusinessRuleError(BulkExportInProgress)` |

**依存するポート**: なし

## ポート

### JobRepository

```ts
interface JobRepository extends TransactionalRepository<Job, JobId> {
  listByRequester(userId: UserId, criteria: JobListCriteria): Promise<PaginationResult<Job>>;
  listChildren(parentId: JobId, pagination: Pagination): Promise<PaginationResult<Job>>;
  listActiveByTarget(target: JobTarget): Promise<readonly Job[]>;
  listActiveByRequester(userId: UserId): Promise<readonly Job[]>;
  countActiveByKind(userId: UserId, kind: JobKind): Promise<number>;
  listActiveByScope(scope: JobScope): Promise<readonly Job[]>;
  summarizeChildren(parentId: JobId): Promise<BatchSummary>;
  deleteOlderThan(cutoff: Date): Promise<number>;
  deleteByRequester(userId: UserId): Promise<number>;
}

type JobListCriteria = Readonly<{
  status: readonly Job["status"][] | null;
  kind: readonly JobKind[] | null;
  parentsOnly: boolean;
  pagination: Pagination;
}>;
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

### JobDispatcher

**目的**: ジョブを実行系（キュー）へ送る。

```ts
interface JobDispatcher {
  dispatch(jobId: JobId, kind: JobKind): Promise<void>;
  dispatchMany(jobs: readonly { jobId: JobId; kind: JobKind }[]): Promise<void>;
}
```

このポートを呼ぶのは `job.enqueued` を購読するハンドラーだけとする。ジョブを登録するユースケースは `Job.enqueue` / `Job.retry` がイベントを発行するのに任せ、直接は呼ばない。これにより送信経路が 1 本に定まり、登録とトランザクションの原子性も保たれる。

配送は少なくとも 1 回。受け手は同じジョブを 2 回受け取っても結果が変わらないように実装する。

**エラーケース**: `SystemError(ExternalServiceError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `job.enqueued` | `{ jobId, kind, target, requestedBy, parentId }` | 実行系への送信 |
| `job.started` | `{ jobId, kind }` | 監査 |
| `job.succeeded` | `{ jobId, kind, target, parentId, artifactFileId }` | 親ジョブの進捗更新、通知 |
| `job.failed` | `{ jobId, kind, target, parentId, reason }` | 親ジョブの進捗更新、通知、ノートの失敗表示 |
| `job.canceled` | `{ jobId, kind, target, parentId }` | 親ジョブの進捗更新 |

## エラーコード

```
JobErrorCode =
  | "InvalidId" | "InvalidProgress" | "InvalidTarget" | "PayloadKindMismatch"
  | "RetryLimitExceeded" | "DuplicateJob" | "BulkExportInProgress"
  | "JobNotCancelable" | "JobNotRetryable"
```

## ユースケース（概要）

`listJobs`, `getJobDetail`, `retryJob`, `retryFailedChildren`, `cancelJob`, `updateBatchProgress`, `pruneJobHistory`

詳細は [usecases/job.md](../usecases/job.md)。
