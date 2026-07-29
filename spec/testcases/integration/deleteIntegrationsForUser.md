# テストケース: deleteIntegrationsForUser

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 退会した利用者が OpenRouter と Drive を連携し、バックアップ記録が 5 件ある | `identity.user.deleted` を処理する | 連携 2 件と記録 5 件が削除され、`deletedConnections: 2` / `deletedRecords: 5` が返る | |
| `ActiveConnection` がある | 処理する | それぞれ `IntegrationOAuthClient.revoke` が試みられてから削除される | |
| 取り消し要求がプロバイダー側で失敗する | 処理する | 記録して継続し、削除は完了する | |
| 処理後 | 保存されていた資格情報とバックアップ設定を確認する | 連携行ごと消えるため、暗号化済みトークンも `ConnectionSettings` も残らない | |
| 処理後 | Drive 上のバックアップファイルを確認する | 削除されない（IN-09。`deleteBackupRecordsForNote` と同じ整理） | |
| 処理後 | 発行されたイベントを確認する | イベントは発行しない（実行中ジョブのキャンセルは `deleteAccount` の手順 3 で済んでいる） | |
| 他の利用者の連携・バックアップ記録がある | 処理する | 他の利用者の連携も記録も削除されない | |
| 連携が 1 件もない | 処理する | 何もせず `deletedConnections: 0` で成功として返る | |
| 同じイベントを 2 回受け取る | 2 回処理する | 2 回目は削除対象がなく 0 件で終わる。取り消し要求の再送も、既に無効なトークンへの失敗が記録されるだけで無害（冪等） | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
