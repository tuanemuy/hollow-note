# テストケース: dispatchJob

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 単体ジョブの `job.enqueued` | 配送する | `JobDispatcher.dispatch(scope, jobId, kind)` が呼ばれる | |
| batch 親の `job.enqueued`（`target.type: "batch"`） | 配送する | キューへ送られない（親の実行は `job.readyToAssemble` 経由のみ） | |
| `bulkExport` 親の `job.readyToAssemble` | 配送する | 親ジョブがキューへ送られる（`job.readyToAssemble` は `bulkExport` 親にしか発行されないため無条件に送る） | |
| 任意のジョブ | 配送する | メッセージが `scope`, `jobId`, `kind` を運び、このハンドラーは実行体を選ばない | |
| message scopeとJobId prefixが違う | 配送する | 不正messageとして失敗し、別scopeのJobを読まない | |
| `kind: "bulkExport"` の子ジョブ（`target.type: "note"`） | 受け手が処理する | ジョブを読み直し、`kind` × `target.type` の組から `runBulkExportItem` に振り分けられる | |
| `kind: "bulkExport"` の親ジョブ（`target.type: "batch"`） | 受け手が処理する | 同じ `kind` でも `target.type` が異なるため `runBulkExport` に振り分けられる（子ジョブは親と同じ `kind` を持つため `kind` だけでは実行体が決まらない） | |
| `bulkExport` 以外の batch 親のメッセージが古い配送で届いた | 受け手が処理する | 実行体がないため何もせず返る | |
| `Job.retry`（`retryJob` / `retryFailedChildren`）が発行した `job.enqueued` | 配送する | 再開したジョブがキューへ送られる | |
| 匿名ジョブ（`requestedBy: null`）の `job.enqueued` | 配送する | 通常どおりキューへ送られる | |
| 同じ `job.enqueued` を 2 回受け取る | 2 回配送する | 重複排除は行わず 2 回送られる（受け手の run 系共通規則が吸収する） | |
| 同じhot workspaceの外部I/O Jobが4件実行中 | 5件目を開始する | scope admissionが待機させ、同時実行を4以下に保つ | |
| 4件が同時に空き枠を取得しようとする | 開始する | DOの同一transactionでadmission lease取得とJob.startが直列化され、5件目はJobを変更せずQueue retryへ戻る | |
| slot取得commit後に応答を失う | 再配送する | jobId UNIQUEの同じslotとrunning Jobを読み、有効lease中は二重実行しない | |
| 外部I/O Jobが成功・失敗・強制cancelされる | 終端する | terminal Job保存と同じUoWでadmission leaseを解放する | |
| worker crashでJob leaseが失効する | reaperを動かす | 同期限のadmission leaseを最大100件ずつ回収し、後続Jobが枠を取得できる | |
| foreground待ち行列100件またはp95 500ms超が5分継続 | background処理を投入する | backgroundを一時停止し、過負荷のHTTP要求には `Retry-After` を返す | |
| キュー送信が失敗する | 配送する | `SystemError(ExternalServiceError)` が投げられ、再配送に委ねられる | |
