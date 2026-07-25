# テストケース: startBulkUpload

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 対応形式のファイルを 5 件指定する | 開始する | 親ジョブが作られ、5 件が `accepted` になる | |
| 101 件を指定する | 開始する | `ValidationError("TOO_MANY_FILES")` が投げられる | |
| 100 件を指定する | 開始する | 成功する（境界値） | |
| 合計 501 MB を指定する | 開始する | `ValidationError("UPLOAD_TOO_LARGE")` が投げられる | |
| 未対応形式を含む | 開始する | それらは `rejected` に理由つきで入り、他は `accepted` になる | |
| すべて未対応形式 | 開始する | `ValidationError("NO_ACCEPTABLE_FILE")` が投げられる | |
| 保存容量の残りが足りない | 開始する | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| ワークスペースの viewer | 開始する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| LLM を要するファイルを含み未連携 | 開始する | `llmRequiredCount` と `llmAvailable: false` が返り、受け付けは成功する | |
| ハンドル未設定で `visibility: "public"` を指定する | 開始する | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる | |
| 音声 200 MB のファイルを含む | 開始する | 受け付けられる（形式別の上限の境界値） | |
| 音声 201 MB のファイルを含む | 開始する | そのファイルが `rejected` になる | |
