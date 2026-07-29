# テストケース: dispatchJob

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 単体ジョブの `job.enqueued` | 配送する | `JobDispatcher.dispatch(jobId, kind)` が呼ばれる | |
| batch 親の `job.enqueued`（`target.type: "batch"`） | 配送する | キューへ送られない（親の実行は `job.readyToAssemble` 経由のみ） | |
| `bulkExport` 親の `job.readyToAssemble` | 配送する | 親ジョブがキューへ送られる（`job.readyToAssemble` は `bulkExport` 親にしか発行されないため無条件に送る） | |
| 任意のジョブ | 配送する | メッセージが運ぶのは `jobId` と `kind` だけで、このハンドラーは実行体を選ばない | |
| `kind: "bulkExport"` の子ジョブ（`target.type: "note"`） | 受け手が処理する | ジョブを読み直し、`kind` × `target.type` の組から `runBulkExportItem` に振り分けられる | |
| `kind: "bulkExport"` の親ジョブ（`target.type: "batch"`） | 受け手が処理する | 同じ `kind` でも `target.type` が異なるため `runBulkExport` に振り分けられる（子ジョブは親と同じ `kind` を持つため `kind` だけでは実行体が決まらない） | |
| `bulkExport` 以外の batch 親のメッセージが古い配送で届いた | 受け手が処理する | 実行体がないため何もせず返る | |
| `Job.retry`（`retryJob` / `retryFailedChildren`）が発行した `job.enqueued` | 配送する | 再開したジョブがキューへ送られる | |
| 匿名ジョブ（`requestedBy: null`）の `job.enqueued` | 配送する | 通常どおりキューへ送られる | |
| 同じ `job.enqueued` を 2 回受け取る | 2 回配送する | 重複排除は行わず 2 回送られる（受け手の run 系共通規則が吸収する） | |
| キュー送信が失敗する | 配送する | `SystemError(ExternalServiceError)` が投げられ、再配送に委ねられる | |
