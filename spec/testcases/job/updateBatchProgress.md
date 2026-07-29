# テストケース: updateBatchProgress

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 子 10 件のうち 3 件が終端（組み立てが始まる前の親。`attempts === 0`） | 更新する | 親の進捗が 3 / 10 になり、`reportProgress` が親の進捗リースを 60 分先へ延長する | |
| 組み立て中の `bulkExport` 親（`attempts >= 1`）で、遅れて届いた・重複配送された子の終了報告により進捗が動いた（組み立て中は `retryFailedChildren` が `AssemblyInProgress` で弾かれるため、子の再試行では起こらない） | 更新する | `reportProgress` は進捗だけを作り直し、`leaseExpiresAt` を延長しない（組み立て中の親の期限を動かせるのは実行権を持つワーカーの `renewAssemblyLease` だけ） | |
| 組み立て中の親（`attempts >= 1`）で組み立てワーカーが停止した | 子の終了報告を繰り返し処理する | `reportProgress` が期限を延ばさないため組み立てリースは必ず失効し、`beginAssembly` の再取得か `reapExpiredJobs` の回収に戻る（`running` のまま永久に終端しない） | |
| 全 10 件が成功（`bulkExport` 以外の kind） | 更新する | 親が `succeeded` になる | |
| 8 件成功・2 件失敗（`bulkExport` 以外の kind） | 更新する | 親が `succeeded` になる（部分失敗を含む） | |
| 全 10 件が失敗 | 更新する | 親が `failed` になり、内訳が `detail` に記録される | |
| 全件がキャンセル | 更新する | 親が `canceled` になる | |
| `kind: "bulkExport"` の親で全子が終端し、成功が 1 件以上 | 更新する | 親は終端化せず、進捗が `total` まで進んで `job.readyToAssemble` が発行される（終端化は `runBulkExport` の `succeed(artifact)` が行う） | |
| `kind: "bulkExport"` の親で全子が終端し、成功が 0 件・失敗あり | 更新する | 他の kind と同じ規則で `failed` になり、`job.readyToAssemble` は発行されない | |
| `kind: "bulkExport"` の親で全子がキャンセル | 更新する | 親が `canceled` になり、`job.readyToAssemble` は発行されない | |
| `kind: "bulkExport"` の親で未終了の子が残っている | 更新する | 進捗だけが更新され、`job.readyToAssemble` は発行されない | |
| `kind: "bulkExport"` の親で同じイベントを 2 回受け取る | 2 回更新する | `job.readyToAssemble` が重複発行されうるが、`runBulkExport` は「batch 親の組み立て規則」に従い `Job.beginAssembly` の実行権（親の `attempts` とリースの組）で二重の組み立てを防ぐ | |
| `retryFailedChildren` / `retryJob` が `reopenBatch` で親を `running` に戻した | 親のイベントを確認する | `reopenBatch` は `WithEventDrafts` を返し、`kind: "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1` のときだけ `job.readyToAssemble` を発行する（`applyTo` の `bulkExport` の例外と同じ条件） | |
| 全子終端だが成功 0 件の `bulkExport` 親を `reopenBatch` で戻した | 親のイベントを確認する | `summary.succeeded === 0` のため `job.readyToAssemble` は発行されない（発行すると `runBulkExport` は組み立てるものを持たずに何もせず返り、親が `running` のまま `timeout` を待つ） | |
| `reopenBatch` で戻した親に未終端の子が残っている（`summary.settled` が偽） | 子が改めて全件終端して更新する | `reopenBatch` 自身はイベントを発行せず、`job.readyToAssemble` はこの `updateBatchProgress` が全子終端時に発行する | |
| `kind: "conversion"` の親（`startBulkUpload`）で、変換不能だった子が `failed` で終端した | 更新する | その子も終端として数えられ、全子終端で親が終端する | |
| `kind: "conversion"` の親で `total: 5` に対し子が 4 件しか登録されなかった | 更新する | 親は終端せず、`total` も変更されない（回収は `reapExpiredJobs` の責務） | |
| 既に終端状態の親 | 更新する | 何もせず返る | |
| 同じイベントを 2 回受け取る | 2 回更新する | 現在の子の状態から計算されるため結果が変わらない | |
| 親が存在しない | 更新する | 何もせず成功として返る | |
| 版が競合する | 更新する | `ConflictError` が投げられ、再配送に委ねられる | |
