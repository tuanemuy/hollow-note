# テストケース: recalculateStorageUsage

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 集計がずれている | 再計算する | 実データの合計に置き換わる | |
| `purpose: "artifact"` の生成物を所有している | 再計算する | 合計から除外され、`consumedBytes` に含まれない（増分集計の `applyStorageDelta` と同じ除外規則） | |
| artifact 以外のファイルがなく artifact だけがある | 再計算する | `consumedBytes: 0` になる | |
| ファイルが 0 件 | 再計算する | `consumedBytes: 0` になる | |
| ゴミ箱のノートがある | 再計算する | ノート件数に数えられる | |
| クォータのレコードがない | 再計算する | 作られてから値が入る | |
| 2 回続けて実行する | 再計算する | 結果が変わらない | |
| ワークスペースを対象にする | 再計算する | そのワークスペースの分だけが計算される | |
| user 主体が実行者と一致しない | 再計算する | `BusinessRuleError(InsufficientRole)` が投げられ、`StorageQuota` は書き換わらない | |
