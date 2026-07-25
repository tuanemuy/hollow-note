# ユースケース: Job

ドメインの詳細は [domains/job.md](../domains/job.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## listJobs

### 概要

処理履歴を一覧する（JB-01）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `status` | `string[] \| null` | — | 既知の状態のみ |
| `kind` | `string[] \| null` | — | 既知の種別のみ |
| `parentsOnly` | `boolean` | ○ | 既定は `true` |
| `page`, `limit` | `number` | ○ | `limit` は 1〜100 |

### 出力DTO

`items: JobSummary[]`, `count: number`, `activeCount: number`

`JobSummary` は `jobId`, `kind`, `status`, `targetType`, `targetId`, `targetLabel`, `progress: { completed; total } | null`, `failureReason: string | null`, `artifact: { fileId; expiresAt; expired: boolean } | null`, `startedAt`, `finishedAt`, `createdAt`, `retryable: boolean`, `cancelable: boolean`。

### 処理フロー

1. `JobRepository.listByRequester` を引く
2. `targetLabel` は対象がノートなら `NoteRepository.listByIds` でタイトルを、ファイルなら `StoredFileRepository.listByIds` でファイル名を解決する。対象が削除済みなら「削除済み」と表示する
3. `retryable` は `status === "failed"` かつ再試行上限に達していないこと。`cancelable` は `Job.isCancelable`
4. `activeCount` は `JobRepository.listActiveByRequester` の件数

ジョブは実行者本人にのみ見える。ワークスペースのノートに対するジョブでも他のメンバーには表示しない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ページング値の範囲外 | `ValidationError("INVALID_PAGINATION")` |
| 未知の状態・種別 | `ValidationError("INVALID_FILTER")` |

## getJobDetail

### 概要

親ジョブを開いて子ジョブの内訳を見る（JB-01）。

### 入力DTO

`userId`, `jobId`, `page`, `limit`

### 出力DTO

`job: JobSummary`, `children: JobSummary[]`, `childCount: number`, `summary: { total; succeeded; failed; canceled }`

### 処理フロー

1. `JobRepository.findById` で引き、`requestedBy` が `userId` と一致しなければ `NotFoundError("JOB_NOT_FOUND")`
2. `JobRepository.listChildren` と `summarizeChildren` を引く

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ジョブ不在・他人のもの | `NotFoundError("JOB_NOT_FOUND")` |

## retryJob

### 概要

失敗したジョブを同じ設定で再実行する（JB-02）。

### 入力DTO

`userId`, `jobId`

### 出力DTO

`jobId`, `status`

### 処理フロー

1. ジョブを引き、所有を確認する
2. `status !== "failed"` なら `BusinessRuleError(JobNotRetryable)`
3. 対象が存在するかを確認する。ノート・ファイルが削除済みなら `ValidationError("TARGET_MISSING")`
4. 失敗理由が `integrationRequired` / `providerAuthFailed` の場合、該当の連携が `active` でなければ `BusinessRuleError(ReauthorizationRequired)`
5. 対象への権限を再確認する。失っていれば `BusinessRuleError(AccessDenied)`
6. `Job.retry` を保存する。実行系への送信は `job.enqueued` を購読するハンドラーが行う（このユースケースは `JobDispatcher` を直接呼ばない）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 失敗状態でない | `BusinessRuleError(JobNotRetryable)` |
| 再試行の上限 | `BusinessRuleError(RetryLimitExceeded)` |
| 対象が削除済み | `ValidationError("TARGET_MISSING")` |
| 原因が未解消（連携なし） | `BusinessRuleError(ReauthorizationRequired)` |
| 権限を喪失 | `BusinessRuleError(AccessDenied)` |

## retryFailedChildren

### 概要

親ジョブの失敗した子だけをまとめて再実行する（JB-02）。

### 入力DTO

`userId`, `parentJobId`

### 出力DTO

`retriedCount: number`, `skipped: { jobId: string; reason: string }[]`

### 処理フロー

1. 親ジョブを引き、所有を確認する
2. `JobRepository.listChildren` から `failed` のものを集める
3. 各件について `retryJob` と同じ検査を行い、通ったものだけを `Job.retry` する。通らなかったものは `skipped` に積む
4. 親ジョブを `RunningJob` に戻して進捗を計算し直す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 親ジョブ不在・他人のもの | `NotFoundError("JOB_NOT_FOUND")` |
| 失敗した子が 0 件 | `ValidationError("NO_RETRYABLE_CHILD")` |

## cancelJob

### 概要

待機中・実行中のジョブを取り消す（JB-03）。

### 入力DTO

`userId`, `jobId`

### 出力DTO

`jobId`, `status`, `canceledChildren: number`

### 処理フロー

1. ジョブを引き、所有を確認する
2. `Job.isCancelable` が偽なら `BusinessRuleError(JobNotCancelable)`
3. 親ジョブなら、待機中の子をすべて `Job.cancel` する。実行中の子は完了を待つ（結果は残る）
4. `Job.cancel` を保存し、イベントを収集する
5. 一括ダウンロードの中間生成物があれば `deleteFiles`（Storage）で破棄する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 既に終端状態 | `BusinessRuleError(JobNotCancelable)` |
| ジョブ不在・他人のもの | `NotFoundError("JOB_NOT_FOUND")` |

## updateBatchProgress

### 概要

子ジョブの終了を受けて親ジョブの進捗と終了状態を更新する（`job.succeeded` / `job.failed` / `job.canceled` の購読）。

### 入力DTO

`parentJobId: string`

### 出力DTO

`status: string`, `summary: { total; succeeded; failed; canceled }`

### 処理フロー

1. `JobRepository.findById` で親を引く。終端状態なら何もせず返す
2. `JobRepository.summarizeChildren` を引く
3. `BatchProgressCalculator.applyTo(parent, summary, now)` を適用して保存する
4. 現在の子の状態から毎回計算し直すため、同じイベントを 2 回受け取っても結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 親が不在 | 何もせず成功として返す |
| 版の競合 | `ConflictError` を投げて再配送に委ねる |

## pruneJobHistory

### 概要

保持期間を過ぎたジョブ履歴を削除する。定期ワーカーから呼ばれる。

### 入力DTO

`retentionDays: number`（既定 90）

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `JobRepository.deleteOlderThan(now - retentionDays)` を呼ぶ
2. 終端状態のジョブのみを対象とする

### エラーケース

`SystemError(DatabaseError)`
