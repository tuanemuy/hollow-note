# テストケース: deleteIntegrationsForUser

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 退会処理中の利用者が OpenRouter と Drive を連携している | `scope: null`のglobal cleanup commandを処理する | global connection 2件だけを削除し、`deletedConnections: 2` / `deletedRecords: 0`を返す | |
| 指定scopeに本人のバックアップ記録が5件ある | 当該`scope`のcleanup commandを処理する | current scopeの記録5件だけを削除し、`deletedConnections: 0` / `deletedRecords: 5`を返す | |
| global connectionと5scopeのbackup記録がある | account deletionを完了する | orchestratorがglobal commandとscope別commandの全ackを集約し、単一commandでscopeを横断しない | |
| `ActiveConnection` がある | 処理する | それぞれ `IntegrationOAuthClient.revoke` が試みられてから削除される | |
| 取り消し要求がプロバイダー側で失敗する | 処理する | 記録して継続し、削除は完了する | |
| 処理後 | 保存されていた資格情報とバックアップ設定を確認する | 連携行ごと消えるため、暗号化済みトークンも `ConnectionSettings` も残らない | |
| 処理後 | Drive 上のバックアップファイルを確認する | 削除されない（IN-09。`deleteBackupRecordsForNote` と同じ整理） | |
| 処理後 | 発行されたイベントを確認する | イベントは発行しない（実行中ジョブのキャンセルは `deleteAccount` の手順 3 で済んでいる） | |
| 他の利用者の連携・バックアップ記録がある | 処理する | 他の利用者の連携も記録も削除されない | |
| 連携が 1 件もない | 処理する | 何もせず `deletedConnections: 0` で成功として返る | |
| 同じイベントを 2 回受け取る | 2 回処理する | 2 回目は削除対象がなく 0 件で終わる。取り消し要求の再送も、既に無効なトークンへの失敗が記録されるだけで無害（冪等） | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
| 1 scopeにBackupRecordが250件ある | cleanupする | 100件ずつ3回に分け、`integration.userCleanupContinued`を同じoperation IDで再登録してから完了ackする | |
| 100件目の削除後に応答を失う | recoveryする | 同じoperation IDで再開し、残件だけを削除して二重ackしない | |
| membership removalが同じscopeで先行中 | account cleanupを実行する | committed account deletion lock/operation ownerを確認して同じscope Alarm列で直列化し、directory edge削除前にBackupRecordを0件まで回収する | |
