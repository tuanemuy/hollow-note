# テストケース: fetchBackupForRegeneration

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| バックアップ記録があり Drive 上にファイルがある | 取り出す | 記録所有者（`BackupRecord.userId`）の連携トークンで取得され、内容のストリームとファイル名・形式が返る | |
| ワークスペースノートで、記録所有者と要求者が別のメンバー | 要求者が取り出す | 記録所有者の連携トークンが使われ、要求者自身の Drive 連携は参照されない（IN-07） | |
| 記録所有者以外のメンバーが Drive 未連携 | そのメンバーが取り出す | 記録所有者の連携で成功する（要求者の連携の有無は結果に影響しない） | |
| バックアップ記録がない | 取り出す | `NotFoundError("BACKUP_NOT_FOUND")` が投げられる | |
| Drive 上のファイルが削除されている | 取り出す | `NotFoundError("DRIVE_FILE_NOT_FOUND")` が投げられる | |
| Drive 上のファイルが移動されている | 取り出す | 記録の参照で到達できれば成功する | |
| 記録所有者が連携を解除している | 取り出す | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられ、記録所有者には再連携を、他のメンバーには自分の Drive への再バックアップ（IN-06）を経た再生成を案内する | |
| 記録所有者が退会済み | 取り出す | 同じく `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる（連携は `deleteIntegrationsForUser` で消えている） | |
| 記録所有者の連携が失効している | 取り出す | `BusinessRuleError(ReauthorizationRequired)` が投げられる（案内は未連携時と同じ） | |
| 通信が失敗する | 取り出す | `SystemError(ExternalServiceError)` が投げられる | |
