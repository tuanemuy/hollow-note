# テストケース: updateBackupSetting

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| Drive が連携済み | フォルダを指定して保存する | 設定が更新される | |
| フォルダ未設定 | 自動バックアップを有効にする | `BusinessRuleError(BackupFolderRequired)` が投げられる | |
| フォルダ設定済み | 自動バックアップを有効にする | 設定が更新される | |
| 指定したフォルダに書き込み権限がない | 保存する | `ValidationError("DRIVE_PERMISSION_DENIED")` が投げられる | |
| 指定したフォルダが削除されている | 保存する | フォルダが作り直され、その参照が保存される | |
| OpenRouter の連携に対して呼ぶ | 保存する | `BusinessRuleError(ProviderMismatch)` が投げられる | |
| フォルダまたは自動バックアップの設定を変更した | 発行されたイベントを確認する | `integration.backupSettingChanged`（`connectionId` / `userId` / `autoBackup`）が発行され、保存と同じ UoW で収集される（監査用） | |
| `BusinessRuleError(BackupFolderRequired)` で失敗した | 発行されたイベントを確認する | 設定が保存されないため `integration.backupSettingChanged` も発行されない | |
| 自動バックアップを有効にした | 既存のノートを確認する | 遡ってバックアップはされない | |
| 自動バックアップを有効にした | 新しくアップロードする | バックアップジョブが登録される | |
