# テストケース: storeMedia

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 編集できるノート | PNG をアップロードする | 保管され、配信用の URL が返る | |
| — | SVG をアップロードする | サニタイズされてから保管される | |
| — | 未対応の形式をアップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられる | |
| — | 21 MB の画像をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| — | 20 MB の画像をアップロードする | 成功する（境界値） | |
| — | 201 MB の動画をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| 保存容量の残りが足りない | アップロードする | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| viewer である | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しないノート | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| アップロード後 | 使用量を確認する | 保存容量が増えている | |
