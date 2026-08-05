# テストケース: rebuildNoteProjection

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| user scopeにNoteが50件ある | `plane: local`, `scope: user` で実行する | 対象DOの `listByOwner(scope, "all")` だけを読み、50件のlocal再投影taskを積む | |
| workspace scopeを指定する | local再構築する | 他のuser / workspace DOにはアクセスしない | |
| `plane: local` でscopeがない | 実行する | `ValidationError("SCOPE_REQUIRED")` | |
| local Noteが100件を超える | 実行する | scope-local `scheduled_tasks` とAlarmでキーセット継続し、1 turnの仕事量を制限する | |
| global public projectionが空 | `plane: public`, `scope: null` で実行する | D1 `note_routes` のactive routeをキーセットで列挙し、routeVersion付き要求をQueueへ積む。全DO列挙APIは使わない | |
| route列挙後にNoteが別scopeへ移動する | public要求を処理する | consumerがcurrent routeを再解決し、旧 `expectedRouteVersion` をno-opにする | |
| routeがtombstone | public再構築する | public行を削除し、scope DOからsnapshotを読まない | |
| local projectionに孤児行がある | `sweepOrphans: true` | current scopeの正データとだけ突合して削除する | |
| public projectionに古いrouteVersionの行がある | `sweepOrphans: true` | D1 `note_routes` との突合で削除する | |
| `sweepOrphans: false` | 再構築する | 孤児行を残し `sweptCount: 0` | |
| タグ付きNoteがある | taskを処理する | local/publicとも本体・タグ・FTS・表示contextを世代ベクトル付き完全snapshotで1回置換する | |
| 空のpublic投影へタグ付きNoteを再構築する | taskを処理する | 本体と全タグが同じD1 batchで作られ、同version判定で片方がno-opにならない | |
| 同じNoteの新旧snapshotを2 consumerが逆順で処理する | 処理する | route/source versionが新しいsnapshotだけが残り、本体とタグの組が混ざらない | |
| FTS表を作り直す | 再構築する | 先に対象planeのFTS表を再作成する。contentless FTSの特殊`rebuild`コマンドは使わない | |
| 同じ要求を2回処理する | 実行する | current stateとversion条件付き書き込みにより結果は変わらない | |
