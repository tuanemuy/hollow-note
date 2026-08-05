# テストケース: pruneJobHistory

保持期間の比較は終了時刻（`finishedAt`）で行い、境界は排他（`finishedAt < cutoff` のみ削除）。削除の起点は終端状態かつ**親を持たない**ジョブ（`parentId === null`）に限り、family route manifestを固定してから100件ずつ削除する。

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `finishedAt` が 91 日前で親を持たないジョブがある | 実行する | 削除される | |
| `finishedAt` が 89 日前のジョブがある | 実行する | 残る | |
| `finishedAt` がちょうど 90 日前のジョブ | 実行する | 残る（境界は排他） | |
| 作成は 100 日前だが `finishedAt` は 10 日前のジョブ | 実行する | 比較は終了時刻で行うため残る | |
| `retentionDays: 30` を指定する | 実行する | `finishedAt` が 30 日より前のジョブだけが削除される | |
| 実行中のジョブがある | 実行する | 終端状態でない（`finishedAt` を持たない）ため削除されない | |
| 待機中のジョブがある | 実行する | 同じく削除されない | |
| 91 日前に終了した親ジョブとその子がある | 実行する | 削除の起点は親（`parentId === null`）で、route manifest完成後に子を100件ずつ、最後に親を消す | |
| 子だけが 91 日前に終端し、親は `retryFailedChildren` で `running` に戻っている | 実行する | 子は単独では削除されない（起点が親に限られるため）。子が消えると `summarizeChildren` の件数が `total` に届かず親が永久に終端しなくなる | |
| 子は 100 日前に終端したが親の `finishedAt` は 10 日前 | 実行する | 保持期間は起点である親の `finishedAt` で判定されるため、親子とも残る | |
| 親が 91 日前に終端し、子の一部は 10 日前に終端している | 実行する | 保持判定は親で行い、manifestにfamily全件を固定してから削除する | |
| 90 日より前に終了した匿名ジョブ（`requestedBy: null`）がある | 実行する | 削除される（匿名ジョブは `parentId: null` のみ構成できるため必ず削除の起点になる。退会時の `deleteJobsForRequester` が及ばないため、これが唯一の掃除経路） | |
| 500子のbatch親 | 削除する | manifestを100件ずつ6 turnで固定し、各local/global pageも100件以下のまま全501 history/reverse routeを回収する | |
| manifest構築の3page目で停止する | recoveryする | 保存済みcursorと同じoperation IDから再開し、Job削除前に全family routeを固定する | |
| local family削除後にglobal cleanupが停止する | recoveryする | 残るmanifest itemのtarget/requestedByからreverse routeとhistoryを再開する | |
| manifest構築中または子削除途中 | retry/progress/terminal/cancel/reapを競合させる | root claimにより全通常transitionを`JOB_REMOVAL_IN_PROGRESS`で拒否し、claim ownerだけが続行する | |
| claim直後に応答を失う | 同じrootを再選択する | scope+root由来の同じremoval operation IDとmanifest stateから再開する | |
| family cleanupが完了した | taskを確認する | 次のrootへ進み、対象0件で翌日へ戻す | |
| global ackが全件完了した | manifest prunerを実行する | itemを100件ずつ縮約し、completed headerは30日保持後に最大100件ずつ回収する | |
| ack済みmanifest itemが101件ある | 縮約する | 100件を消して同じ`job.removalManifestCompactContinued`を保存し、次turnの1件後にだけheaderをcompletedへ移す | |
| ack済みmanifest itemが501件ある | 縮約する | 6 turnに分け、各transactionのDELETEは100件以下 | |
| history tombstone 250件が30日を越えた | global Cronを実行する | generation/shard/table cursorから100件ずつ回収する | |
| target tombstoneが120日ちょうど | global Cronを実行する | 境界前は保持し、期限到達後も対応route/保持窓内Jobが0件の場合だけ回収する | |
| tombstone100件の削除応答を失う | continuationを再実行する | 同じcursorで冪等に再開し、全shardを1 invocationへ詰めない | |
| target shardのDELETE後、run checkpoint前に停止する | continuationを再実行する | 同じ入力cursorのDELETEを冪等再実行し、次cursor/command keyとQueue outboxをcatalog transactionで保存する | |
| 32 shardのglobal tombstone runが次hourにも未完了 | 次hourのCronを起動する | 同kindの新runを作らず最古running runを再開し、重複走査せずactive laneを最大6に保つ | |
| global tombstone Cronが重複起動し、その後lease ownerが停止する | lease期限後に再実行する | lease中は片方がno-op、期限後は同じrun/positionを別ownerが回復する | |
| completed global maintenance runが30日を越えて101件ある | run prunerを実行する | 100+1件の2 turnで回収し、running runと30日境界前のrunは残す | |
| 対象が 0 件 | 実行する | `deletedCount: 0` が返る | |
| global Cronが起動する | `{ type: "job.globalTombstonePruneCron" }`で実行する | scope retention行を読まず、global runと共通maintenance-run pruner taskを開始する | |
