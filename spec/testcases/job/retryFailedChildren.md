# テストケース: retryFailedChildren

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 子 10 件のうち 3 件が失敗している | 再試行する | 3 件が `queued` に戻り、`retriedCount: 3` が返る | |
| 失敗した子が 0 件 | 再試行する | `ValidationError("NO_RETRYABLE_CHILD")` が投げられる | |
| 失敗した子のうち 1 件が上限に達している | 再試行する | その 1 件は `skipped` に積まれ、残りが再試行される | |
| 対象が削除済みの子がある | 再試行する | その子は `skipped` に積まれる | |
| 親がまだ `running` で組み立てが始まっていない（`attempts === 0`） | 再試行する | `Job.reportProgress` で進捗が作り直され、進捗リースが延長される | |
| 親がまだ `running` で組み立て中（`bulkExport` かつ `attempts >= 1`） | 再試行する | `BusinessRuleError(AssemblyInProgress)` が投げられ、失敗した子は 1 件も `Job.retry` されない（手順 2。弾かないと組み立てワーカーが再試行前の子集合のまま `succeed(artifact)` し、再試行した子の結果が ZIP に入らないまま親が固定される） | |
| 組み立て中の親のリースが既に失効している（`running` かつ `attempts >= 1` のまま、リーパー未着） | 再試行する | 同じく `AssemblyInProgress` で拒否される（リースの有効・失効で分けない。失効した親に再試行を許しても `attempts >= 1` のままではリースを延ばせず、リーパーの回収を待つあいだに親だけが `failed` になって子の終端が行き場を失う） | |
| 親が `canceled` で終端していて、キャンセル前に `failed` だった子が残っている | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられ、失敗した子は 1 件も `Job.retry` されない（手順 3。`Job.reopenBatch` は `CanceledJob` を受け取らず親を戻せないため、子だけ戻すと `updateBatchProgress` が「終端状態なら何もせず返す」で抜けて結果が行き場を失う。取り消したものは元の操作をやり直す） | |
| 親が `succeeded` で終端している | 再試行する | `Job.reopenBatch` で `running` に戻る（終端状態から戻れる唯一の例外） | |
| 親が `failed` で終端している | 再試行する | `Job.reopenBatch` で `running` に戻り、`failure` と `finishedAt` が捨てられる | |
| 親が `succeeded` の `bulkExport` で、組み立て済みの ZIP（`artifact`）を持つ | 再試行する | `Job.reopenBatch` が `artifact` の参照を捨てるのに合わせ、その保管ファイルが同一 UoW で「保管ファイルの削除手順」により破棄される（[usecases/job.md](../../usecases/job.md) の「親を開き直すときの生成物の破棄」）。開き直しと破棄はどちらかが失敗すれば両方巻き戻る | |
| 親が `failed` / `canceled`、または `bulkExport` 以外の batch 親 | 再試行する | 破棄する生成物はない（`artifact` を持つのは `succeeded` のみで、自身の実行を持つのは `bulkExport` 親だけ） | |
| 子 500 件の親で失敗した子が 120 件ある | 再試行する | `listChildren` を全ページ走査して 120 件すべてを集める（`limit` の上限は 100 なので 1 ページには収まらない） | |
| 終端した親を戻す | `reopenBatch` の第 2 引数を確認する | `retry` 適用後の子の現況を `BatchProgressCalculator.summarize` で集計し直した `BatchSummary` を渡す（`JobProgress` ではない）。進捗は `reopenBatch` が `{ completed: succeeded + failed + canceled, total: summary.total }` として作り直す | |
| 子 10 件のうち 3 件を再試行した | 親の進捗を確認する | `retry` 適用後の子の現況から計算し直され、`completed` が終端の子の件数（7）になる | |
| 親を `reopenBatch` で戻した | 親の `startedAt` を確認する | 元の値が維持されている | |
| 親を `reopenBatch` で戻した | 親の `attempts` を確認する | 0 に戻る（親自身の実行＝組み立てを改めて主張できるようにするため） | |
| `bulkExport` 親を `reopenBatch` で戻した（`retry` した子が未終端になる） | 発行イベントを確認する | `reopenBatch` は `WithEventDrafts` を返すが、`summary.settled` が偽のため `job.readyToAssemble` を発行しない | |
| 組み立て中の再試行が `AssemblyInProgress` で拒否されたあと、組み立てワーカーが完了して親が `succeeded`（または落ちてリース失効で `reapExpiredJobs` が `failed("timeout")` に回収）した | 改めて失敗した子を再試行する | 拒否は一時的で、待てば必ず解ける（組み立て中の親は必ず終端に至る）。終端した親は手順 6 の `Job.reopenBatch` 経路に合流して `running` に戻り、`attempts` が 0 に戻る。再試行した子が改めて全件終端すると `updateBatchProgress` が `job.readyToAssemble` を発行し、`Job.beginAssembly` が実行権を取り直して組み立てからやり直せる | |
| `bulkExport` 以外の kind の親を `reopenBatch` で戻した | 発行イベントを確認する | イベントは発行されない（発行条件は `kind === "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1`） | |
| 再試行した子 | 実行系への送信を確認する | `job.enqueued` を購読するハンドラーが送る（このユースケースは `JobDispatcher` を直接呼ばない） | |
| 他の利用者の親ジョブ | 再試行する | `NotFoundError("JOB_NOT_FOUND")` が投げられる | |
| 成功した子がある | 再試行する | 成功した子は再実行されない | |
