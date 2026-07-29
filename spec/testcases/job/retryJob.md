# テストケース: retryJob

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 失敗したジョブで原因が解消済み | 再試行する | `queued` に戻り、実行系に送られる | |
| 実行中のジョブ | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる | |
| 成功したジョブ | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる | |
| 試行回数が 3 回に達している | 再試行する | `BusinessRuleError(RetryLimitExceeded)` が投げられる | |
| 試行回数が 2 回 | 再試行する | 成功する（境界値） | |
| リース失効を検出したリーパー（`reapExpiredJobs`）が `failed("timeout")` に回収したジョブ | 再試行する | `Job.expire` で `attempts` が 0 に戻っているため `queued` に戻る | |
| 引き継ぎ再開で試行上限を超え `failed("timeout")` になったジョブ | 再試行する | 同じく `attempts` が 0 のため `queued` に戻る | |
| `failed` の `bulkExport` 親（子は全件終端・成功 1 件以上） | 再試行する | 失敗したのは ZIP の組み立てなので、`summarizeChildren` が返した `BatchSummary` をそのまま `Job.reopenBatch(parent, summary, now, leaseUntil)` に渡して `running` に戻り、`job.readyToAssemble` が発行されて組み立てだけがやり直される | |
| `reopenBatch` の呼び出し | 第 2 引数を確認する | `JobProgress` ではなく `BatchSummary`（`summarizeChildren` の結果）を渡す。呼び出し側は `completed` を組み立てず、`reopenBatch` が `{ completed: succeeded + failed + canceled, total: summary.total }` として作り直す | |
| `bulkExport` 親を `reopenBatch` で戻した | 発行イベントを確認する | `kind === "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1` のときだけ `job.readyToAssemble` が発行される | |
| `bulkExport` 親を `reopenBatch` で戻した | `attempts` を確認する | 0 に戻っており、`Job.beginAssembly` が改めて組み立ての実行権を取れる | |
| `failed` の `bulkExport` 親で子に未終端が残る | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる | |
| `failed` の `bulkExport` 親で子は全件終端だが成功が 0 件 | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる（`reopenBatch` の発行条件にも当たらないため、組み立てるものがないまま親が `running` で滞留し `timeout` を待つ状態を作らない） | |
| `failed` の batch 親（`bulkExport` 以外） | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる（子の再試行は `retryFailedChildren` の担当。batch 親を `queued` に戻しても `job.enqueued` の購読ハンドラーがキューへ送らないため実行されない） | |
| `succeeded` の `bulkExport` 親（ZIP の artifact を持つ）を子の再試行で開き直す | 開き直す | `Job.reopenBatch` が `artifact` の参照を捨てるのに合わせ、古い ZIP の保管ファイルが同一 UoW で「保管ファイルの削除手順」により破棄される（誰からも参照されない行が TTL まで残らない） | |
| 失敗した**子ジョブ**で親が組み立て中（`bulkExport` かつ `running` かつ `attempts >= 1`） | 再試行する | `BusinessRuleError(AssemblyInProgress)` が投げられ、`Job.retry` は適用されない（`retryFailedChildren` の手順 2 と同じガード。子を 1 件だけ指しても組み立てワーカーとの競合は同じ） | |
| 失敗した**子ジョブ**で親が `canceled` | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる（`retryFailedChildren` の手順 3 と同じガード。`reopenBatch` は `CanceledJob` を受け取らないため、子だけ戻すと結果が行き場を失う） | |
| 失敗した**子ジョブ**で親が `failed` / `succeeded` | 再試行する | 子が `queued` に戻り、同一 UoW で親も `Job.reopenBatch` で `running` に戻る（`retry` 適用後の子の現況を `BatchProgressCalculator.summarize` で集計し直した `BatchSummary` を渡す） | |
| 失敗した**子ジョブ**で親が `running`（`attempts === 0`） | 再試行する | 子が `queued` に戻り、同一 UoW で親の進捗が `Job.reportProgress` で作り直される（進捗リースの延長を兼ねる） | |
| 対象ノートが削除済み | 再試行する | `ValidationError("TARGET_MISSING")` が投げられる | |
| 失敗理由が `integrationRequired` で連携の行がないまま（未連携） | 再試行する | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられ、連携すれば再実行できる旨が案内される | |
| 失敗理由が `providerAuthFailed` で連携が失効したまま（`ExpiredConnection`） | 再試行する | `BusinessRuleError(ReauthorizationRequired)` が投げられ、再連携が要る旨が案内される（未連携とは案内が異なるため畳まない） | |
| 失敗理由が `driveBackup` 由来で Google Drive が未連携 | 再試行する | `provider` が `kind` から `googleDrive` に決まり `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる | |
| 失敗理由が `integrationRequired` で連携済み（`ActiveConnection`）になった | 再試行する | 成功する | |
| 失敗理由が `providerAuthFailed` で再連携済みになった | 再試行する | 成功する | |
| 失敗理由が `integrationRequired` / `providerAuthFailed` 以外（`corruptedFile` など） | 再試行する | 連携の確認は行われず、対象と権限の確認だけで再試行される | |
| 対象への権限を失っている | 再試行する | `BusinessRuleError(AccessDenied)` が投げられる | |
| 他の利用者のジョブ | 再試行する | `NotFoundError("JOB_NOT_FOUND")` が投げられる | |
| 匿名ジョブ（`requestedBy: null`） | 再試行する | 所有の確認で `NotFoundError("JOB_NOT_FOUND")` になる（匿名の再試行は `exportNote` の再実行） | |
