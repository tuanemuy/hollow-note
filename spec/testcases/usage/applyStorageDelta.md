# テストケース: applyStorageDelta

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| local fileStored event | current scopeで処理する | current scopeの消費量だけを加算する | |
| local fileDeleted event | 処理する | current scopeから減算し、0未満にしない | |
| artifact event | 処理する | quotaに算入しない | |
| note.created / note.purged | 処理する | current scopeのNote件数を増減する | |
| ノートの移動による増減 | 購読を確認する | このユースケースには届かない（移動の増減はサガの各 phase の transaction が直接適用する） | |
| 同じ local event を2回処理 | 実行する | current scopeの処理済み記録により二重増減しない | |
| 処理済み記録後にquota更新が失敗 | 処理する | 同じscope-local UoWで両方rollbackし再試行できる | |
