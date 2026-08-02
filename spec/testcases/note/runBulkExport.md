# テストケース: runBulkExport

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 子ジョブが全件終端し、成功が 1 件以上ある | `updateBatchProgress` を処理する | 親は終端化されず `job.readyToAssemble` が発行され、購読ハンドラーが親ジョブをキューへ送る | |
| `job.readyToAssemble` で起動した親ジョブ（子は全件成功） | 実行する | `Job.beginAssembly` で組み立ての実行権を取り、ZIP が生成・保管され、親ジョブが `succeeded` になり、7 日の期限が付く | |
| 全子が終端し `running` のままの親ジョブ | 実行する | run 系の共通規則の対象外のため `Job.start` は呼ばれない（呼べば「リース有効な `running`」に必ず該当して組み立てられない）。再入防止は `Job.beginAssembly` が担う | |
| 子ジョブに未終端のものが残っている | 実行する | 何もせず終わる（子の再試行などで進行中に戻っている。組み立ては次の全子終端で `updateBatchProgress` が改めて `job.readyToAssemble` を発行して起動される） | |
| 一部の子ジョブが失敗している | 実行する | 成功分を含む ZIP が作られ、失敗した対象の一覧がテキストとして同梱される | |
| すべての子ジョブが失敗している（成功 0 件） | 全子が終端する | `job.readyToAssemble` は発行されず `runBulkExport` は起動しない。`updateBatchProgress` が他 kind と同じ規則で親を `failed` にする | |
| すべての子ジョブが取り消された（成功 0 件） | 全子が終端する | 同様に起動せず、親は `canceled` になる | |
| ファイル名が重複する対象がある | 実行する | 連番が付いて衝突しない | |
| 実行中に対象ノートが削除された | 実行する | そのノートは除外され、処理は続行される | |
| 組み立てに時間がかかる | 実行する | `Job.renewAssemblyLease(parent, now, leaseUntil)` を保存して組み立てリースを 15 分先へ延長する（`Job.reportProgress` は使わない。組み立て中の親の期限を動かせるのは実行権を持つこのワーカーだけ） | |
| 組み立て中に、遅れて届いた・重複配送された子の終了報告で `updateBatchProgress` の `reportProgress` が走る（組み立て中は `retryFailedChildren` が `AssemblyInProgress` で弾かれるため、子の再試行では起こらない） | 親のリースを確認する | 進捗だけが作り直され、`leaseExpiresAt` は延びない（死んだ組み立てワーカーのリースを子側の報告が延ばし続ける事態を防ぐ） | |
| 組み立て権を持たないワーカーが `renewAssemblyLease` を呼ぶ（`attempts === 0`、`target.type !== "batch"`、`kind !== "bulkExport"` のいずれか） | 直接呼ぶ | `BusinessRuleError(InvalidTarget)` で拒否される | |
| ZIP の保管が失敗する | 実行する | 親ジョブが `failed("storageError")` になる | |
| 既に `succeeded` の親ジョブ | `job.readyToAssemble` を再度受け取る | 何もせず終わり、生成物は増えない（冪等） | |
| 親ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） | `job.readyToAssemble` を受け取る | 何もせず返る（手順 1。不在の扱いは run 系共通規則の判定 1 と同じ） | |
| 別のワーカーが組み立て中（`attempts >= 1` かつ組み立てリースが有効） | `job.readyToAssemble` の重複配送を受け取る | `Job.beginAssembly` が `BusinessRuleError(LeaseActive)` になり、それを吸収して何もせず返る（ZIP は 1 つしか作られない） | |
| 全子終端後に `job.readyToAssemble` が同時に 2 回配送される | 2 つのワーカーが実行する | 手順 1・2 は両方が通過するが、`beginAssembly` の実行権で一方だけが組み立てる（親は終端しておらず子は全件終端のため、終端判定と全子終端判定だけでは重複を排除できない） | |
| `beginAssembly` の保存が `ConflictError` になる | 実行する | ジョブを読み直し、終端済みまたは組み立て中（`attempts >= 1` かつリース有効）なら何もせず返る | |
| `beginAssembly` で `attempts` が上限を超える | 実行する | 組み立てを始めず `expire` の結果（`failed`、`reason: "timeout"`）を保存して終える。`beginAssembly` はリースを張り直さず、受け取った親（リース失効のまま）に `expire` を適用する（`Job.start` と同じ順序。先に張り直すと `expire` が `LeaseActive` で拒否され、上限超過の回収経路が成立しない） | |
| 組み立て中にワーカーが停止した | 組み立てリースが失効する | 再配送された `job.readyToAssemble` が `beginAssembly` を取り直して引き継ぐ。再配送が来なければ `reapExpiredJobs` が `failed("timeout")` として回収し、手動 `retry` で組み立てからやり直せる | |
| 組み立て中に親が外部から強制終端された（`cancelJob` など） | `Job.succeed(artifact)` を保存する | `ConflictError` になるためジョブを読み直し、終端済みなので生成した ZIP を破棄して成功として返す。ジョブは書き換えず、保管済みの artifact は期限付き保管の自動回収に委ねる | |
| — | 生成物の保管記録を確認する | `purpose: "artifact"`、`noteId` / `noteVersion` は `null`、`uploadedBy` は要求者、`owner` は要求者の個人 subject | |
| 親ジョブの `job.enqueued` が発行された | ディスパッチハンドラーが処理する | `target.type === "batch"` はキューへ送られず、親の実行経路は `job.readyToAssemble` の 1 本だけになる | |
