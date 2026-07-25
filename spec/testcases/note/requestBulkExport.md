# テストケース: requestBulkExport

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 閲覧できるノートが 10 件 | 一括ダウンロードを要求する | 親ジョブと 10 件の子ジョブが作られる | |
| 501 件を指定する | 要求する | `ValidationError("TOO_MANY_TARGETS")` が投げられる | |
| 500 件を指定する | 要求する | 成功する（境界値） | |
| 本文が空のノートを含む | 要求する | それらは除外され、`skipped` に数えられる | |
| すべて本文が空 | 要求する | `ValidationError("NO_EXPORTABLE_TARGET")` が投げられる | |
| 閲覧権限のないノートを含む | 要求する | それらは除外される | |
| 合計サイズの見積もりが 1 GB を超える | 要求する | `ValidationError("EXPORT_TOO_LARGE")` が投げられる | |
| 一括ダウンロードが既に実行中 | 要求する | `BusinessRuleError(BulkExportInProgress)` が投げられる | |
| — | 要求後にジョブの `payload` を確認する | 指定した形式が保存されている | |
