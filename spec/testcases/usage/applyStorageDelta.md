# テストケース: applyStorageDelta

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| local fileStored event | current scopeで処理する | current scopeの消費量だけを加算する | |
| local fileDeleted event | 処理する | current scopeから減算し、0未満にしない | |
| artifact event | 処理する | quotaに算入しない | |
| note.created / note.purged | 処理する | current scopeのNote件数を増減する | |
| move snapshotが100 bytesを含む | sourceDebitを処理する | source scopeで100 bytesとNote 1件を減算する | |
| 同じmove | targetCreditを処理する | target scopeで100 bytesとNote 1件を加算する。上限超過でもmoveを拒否しない | |
| 同じmigration ID + phaseを2回処理 | 実行する | current scopeの処理済み記録により二重増減しない | |
| targetCreditの応答を失う | 再実行する | 2回目は保存済み結果を返し二重加算しない | |
| targetCredit後・route switch前 | upload判定を確認する | sourceは未減算、targetは加算済みで安全側の二重計上になる | |
| route switch後・sourceDebit前 | recoveryする | sourceは過剰計上のままで、新規uploadを過剰に許可しない。sourceDebitを冪等に再試行する | |
| quota行のないtarget | targetCredit | 初期値をinsertして加算する | |
| quota削除済みsource | sourceDebit | quota行を復活させず成功する | |
| 処理済み記録後にquota更新が失敗 | 処理する | 同じscope-local UoWで両方rollbackし再試行できる | |
