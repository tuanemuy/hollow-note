# テストケース: fetchBackupForRegeneration

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| バックアップ記録があり Drive 上にファイルがある | 取り出す | 内容のストリームとファイル名・形式が返る | |
| バックアップ記録がない | 取り出す | `NotFoundError("BACKUP_NOT_FOUND")` が投げられる | |
| Drive 上のファイルが削除されている | 取り出す | `NotFoundError("DRIVE_FILE_NOT_FOUND")` が投げられる | |
| Drive 上のファイルが移動されている | 取り出す | 記録の参照で到達できれば成功する | |
| 連携が失効している | 取り出す | `BusinessRuleError(ReauthorizationRequired)` が投げられる | |
| 未連携 | 取り出す | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる | |
| 通信が失敗する | 取り出す | `SystemError(ExternalServiceError)` が投げられる | |
