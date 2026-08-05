# テストケース: listUserWorkspaces

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 3 つのワークスペースに参加している | 一覧する | 3 件が参加日時降順・WorkspaceId tie-breakで返り、それぞれ自分のロールが含まれる | |
| どこにも参加していない | 一覧する | 空配列が返る | |
| viewer として参加している | 一覧する | そのワークスペースも含まれ、`role: "viewer"` になる | |
| 除名された直後 | 一覧する | そのワークスペースは含まれない | |
| ワークスペースが削除された | 一覧する | そのワークスペースは含まれない | |
| 数千workspaceにviewerとして参加している | 一覧する | 1page最大20件とopaque nextCursorを返し、全件取得・名前sortを行わない | |
| page内20 workspaceが複数directory shardへ分散する | 一覧する | WorkspaceIdでgroupingして最大6接続で表示を解決する | |
| 同名workspaceが複数ある | 2page以上を読む | createdAt/WorkspaceId keysetにより欠落・重複せず返る | |
| 1page目の後にworkspace名が変わる | 続きを読む | 並び順が名前に依存しないためcursorが無効化されず、対象を飛ばさない | |
| directoryをreshard中 | 一覧する | routing generationに従って旧新を読み、WorkspaceId/versionで重複排除する | |
| page内1 workspaceのdirectory shardだけ障害 | 一覧する | 他itemはactiveで返し、当該itemは`status: unavailable`とretryAfterを持つ | |
| directory tombstoneを解決する | 一覧する | `state: deleted`としてitemを落とし、unavailableとは区別する | |
