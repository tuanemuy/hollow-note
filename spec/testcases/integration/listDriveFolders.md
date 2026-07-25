# テストケース: listDriveFolders

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| Drive が連携済み | 一覧する | フォルダの一覧が返る | |
| `parentId` を指定する | 一覧する | その配下のフォルダが返る | |
| 未連携 | 一覧する | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる | |
| 連携が失効している | 一覧する | `BusinessRuleError(ReauthorizationRequired)` が投げられる | |
| 権限が不足している | 一覧する | `ValidationError("DRIVE_PERMISSION_DENIED")` が投げられる | |
| フォルダが 0 件 | 一覧する | 空配列が返る | |
| 通信が失敗する | 一覧する | `SystemError(ExternalServiceError)` が投げられる | |
