# テストケース: deleteJobsForRequester

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| requesterの親子Jobを削除する | 実行する | 1 root familyずつroute manifestを100件pageで固定し、local/global cleanupを継続する | |
| current scopeに退会者の終端Jobが5件 | scope cleanup command | familyごとにmanifestを作り、全local正データとglobal historyを削除する | |
| 5 familyを同じaccount operationで削除する | 継続する | scope+rootから5つの異なるfamily removal IDを導出し、親account operation IDはtask/headerの対応として保持する | |
| 1 familyの完了応答を失う | account commandを再配送する | 同じfamily manifestを再開し、次root用headerへ上書きしない | |
| 500子の親子Jobがある | 削除する | FK RESTRICT下で子を100件ずつ削除し、最後に親を消す。manifestは全global ackまで残る | |
| 他scopeにもJobがある | current scopeで実行 | 他scopeには触れず、orchestratorの別commandが処理する | |
| active Jobが残っている | 削除を試す | 強制終端task完了前として延期し、走行中の行を消さない | |
| 匿名Job | user基準で削除 | 対象外。personal scope全削除時またはretention pruneで回収する | |
| 同じoperation IDを再配送 | 実行する | 2回目は保存済み結果または0件で冪等に終わる | |
| global history削除eventが遅延 | 一覧する | 一時表示されうるがdetail/actionはlocal行不在としてnot foundになる | |
