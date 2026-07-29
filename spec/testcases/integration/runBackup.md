# テストケース: runBackup

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 未バックアップの元ファイル | 実行する | Drive にアップロードされ、記録が作られ、ジョブが `succeeded` になる | |
| 同じ内容が既にバックアップ済み | 実行する | 再アップロードされず、成功として扱われる | |
| 内容が変わっている | 実行する | 置き換えられ、記録の参照が更新される | |
| 同じノートに別のメンバーが作った既存記録がある | 実行する | `BackupPlanner.decide` が `replace` と判定し、実行者自身の Drive へ上げ直したうえで `BackupRecord.replace(record, { userId: requestedBy, external, checksum }, now)` を保存する（IN-07 の記録所有者失効時の復旧経路） | |
| `replace` が適用された | 記録を確認する | `userId`（所有者）・外部参照・内容ハッシュが差し替わり、`(noteId, sourceFileId)` は変わらないため一意条件に触れない | |
| `replace` が適用された | 元の所有者の Drive を確認する | 元の所有者の Drive に残るファイルは削除しない（IN-09 と同じ整理） | |
| 保存先フォルダの再作成などで外部参照だけが変わった | 実行する | `replace` ではなく `updateExternalRef` で参照だけを更新する | |
| 実行後 | 記録を確認する | `BackupRecord.userId` が実行者（ジョブの `requestedBy`）になっており、保存先も実行者の Drive である | |
| 保存先フォルダが削除されている | 実行する | フォルダが作り直され、`ExternalConnection.updateBackupSetting` を適用した保存で設定に反映される（`updateBackupSetting` ユースケースは呼ばない — その手順 2 が `ensureFolder` を再び呼んで往復が二重になるため） | |
| フォルダを作り直した後にアップロードが失敗した | 実行する | 新しいフォルダ ID は連携に残る（手順 7 の UoW とは別の UoW で先に確定するため）。次の試行が同じフォルダを作り直さずに済む | |
| Drive の容量が不足している | 実行する | `failed("quotaExceeded")` になる | |
| Drive の権限が失われている | 実行する | `failed("permissionRevoked")` になる | |
| 連携が失効している | 実行する | `failed("providerAuthFailed")` になり、連携が `expired` になる | |
| ノート・ファイルが削除済み | 実行する | `failed("targetMissing")` になる | |
| 通信が失敗する | 実行する | `failed("unknown")` になり、再試行できる | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わる | |
| ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） | 配送で受け取る | 何もせず成功として返る（run 系共通規則の判定 1） | |
| 実行後 | ノートを確認する | 「バックアップ済み」と Drive へのリンクが表示される | |
