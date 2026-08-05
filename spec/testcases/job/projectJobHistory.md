# テストケース: projectJobHistory

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| scope-local Jobがenqueueされた | `job.enqueued`を処理する | JobIdのscopeから現在値を読み、global `job_history`へ表示snapshotを保存する | |
| running Jobの進捗が1分または5%変わる | `job.progressed`を処理する | current snapshotのprogressをglobal historyへ更新する | |
| 500子が短時間に1件ずつ終端する | 親進捗を更新する | 5% bucketで中間eventを最大20程度に抑え、terminal eventは必ず発行する | |
| 対象Note/Fileが削除される | `note.purged` / `storage.fileDeleted`を処理する | target hash reverse indexを100件ずつ読み、requestedBy shardの対応履歴を「削除済み」に更新する | |
| 1 targetに数千履歴がある | target削除を処理する | 100件page・最大6 shard並行でcontinuationし、全history shard scanを行わない | |
| target削除の1page目が100件 | 続きを確認する | `target`, 同じ`operationId`, `nextCursor`を持つ`job.targetHistoryCleanupContinued`を1件だけ保存する | |
| startedの後に古いenqueued eventが届く | 処理する | `sourceVersion`が古いためstarted snapshotを上書きしない | |
| batch子が終端した | eventを処理する | 親の現在値とchild summaryも再投影する | |
| event処理前にJob正データが削除された | 処理する | eventのrequestedByでhistory shardを選び、対応するglobal historyをremoveして成功する | |
| removal manifestの1pageに親子100 routeが入る | `job.removed`を処理する | requestedBy別にgroupingし、最大6 shard並行のwaveで全historyを冪等に削除する | |
| 同じtargetを複数利用者が処理した | target削除を処理する | reverse indexの`{ requestedBy, jobId }`から各history shardへ直接到達する | |
| target削除と新しいhistory upsertが競合する | 並行処理する | target hash tombstoneを先に保存し、後発upsertも最初から「削除済み」になって表示を復活させない | |
| 通常eventを初回投影する | reverse index登録とhistory保存の順を確認する | batch以外は`registerBeforeHistory`成功後だけhistoryをupsertし、登録応答喪失はevent IDで再実行する | |
| reverse route登録後にhistory upsertが失敗する | eventを再配送する | 同じoperation IDで登録をno-opにし、history upsertを完了する | |
| consumerがJobを読んだ後にfamily removalが完了する | 遅延upsertを再開する | routeの`routeRemoved`またはrequestedBy shardのhistory removal tombstoneがupsertを拒否し、履歴を復活させない | |
| `job.removed`を処理する | manifest pageを削除する | 各itemの`tombstoneRoute`成功後だけhistoryをremoveし、両方成功後にscope manifestへackする | |
| removal manifestに101 itemある | 処理する | 100件ack後に`job.removalGlobalContinued`を保存し、残り1件を次turnで処理する | |
| 全101 itemをackした | manifestを縮約する | `job.removalManifestCompactContinued`で100件、1件に分け、item 0件のUoWだけがheaderをcompletedにする | |
| route/history tombstoneの30日またはtarget tombstoneの120日を跨ぐ | prunerを実行する | 期限前は保持し、期限後かつ安全条件成立時だけ100件ずつ回収する | |
| batch親を投影する | reverse indexを確認する | `target.type = batch`は実体削除対象でないためreverse routeへ登録せず、null target shardへ集中させない | |
| 同じeventが再配送される | 処理する | 条件付きupsert/removeにより結果は変わらない | |
| `JobFailure.detail`がある | 投影を読む | `failure_detail`を含む表示snapshotが復元できる | |
| 全scopeからJob eventがburstする | 投影する | requestedBy hash shardへ分散し、同じ利用者の親子は1 shardでsourceVersion順に更新される | |
| job_historyを旧単一DBからshardへ移行中 | eventとremoveを処理する | 旧新へ条件付きdual-writeし、read mergeはJobId重複排除、removeは両方へ適用する | |
