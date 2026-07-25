# テストケース: runNoteExport

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本文のあるノートと待機中のジョブ | 実行する | PDF が生成・保管され、ジョブが `succeeded` になり、生成物が 24 時間の期限を持つ | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わり、生成物は増えない | |
| ノートが削除済み | 実行する | ジョブが `failed("targetMissing")` になる | |
| 本文が `processing` のノート | 実行する | ジョブが `failed("targetMissing")` になる | |
| 描画がタイムアウトする | 実行する | ジョブが `failed("timeout")` になる | |
| 保管が失敗する | 実行する | ジョブが `failed("storageError")` になる | |
| `styleMode: "default"` のノート | 実行する | 既定スタイルが当たった PDF になる | |
| `styleMode: "preserve"` のノート | 実行する | 既定スタイルが当たらない PDF になる | |
