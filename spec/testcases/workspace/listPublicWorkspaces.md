# テストケース: listPublicWorkspaces

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 公開ワークスペースが 3 件ある | 列挙する | 3 件のスラッグと更新日時が返る | |
| 非公開のワークスペースがある | 列挙する | それは含まれない | |
| 削除済みのワークスペースがある | 列挙する | それは含まれない | |
| 公開ワークスペースが 0 件 | 列挙する | 空配列、`nextCursor: null`、`hasMore: false` が返る | |
| 件数が `limit` を超える | 列挙する | `limit` 件と署名opaque `nextCursor`が返り、総件数の全shard countは行わない | |
| 公開workspaceが32 shardへ分散する | 列挙する | 同時6接続のwaveで全体最大200件へmergeする | |
| reshard中に同じworkspaceが旧新へ存在する | 列挙する | WorkspaceIdで重複排除し、大きいsourceVersionを採る | |
