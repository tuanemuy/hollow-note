# テストケース: issueDownloadUrl

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 自分が所有するファイル | URL を発行する | 期限つきの URL とファイル名が返る | |
| ワークスペースの viewer | そのワークスペースのファイルの URL を発行する | 発行できる（`downloadNote` は viewer に許される） | |
| 非メンバー | URL を発行する | `NotFoundError("STORED_FILE_NOT_FOUND")` が投げられる | |
| 期限切れの生成物 | URL を発行する | `NotFoundError("ARTIFACT_EXPIRED")` が投げられる | |
| 期限内の生成物 | URL を発行する | 発行できる | |
| 存在しないファイル ID | URL を発行する | `NotFoundError("STORED_FILE_NOT_FOUND")` が投げられる | |
| 発行された URL | 期限経過後にアクセスする | アクセスできない | |
| 匿名の閲覧者が公開ノートの PDF 生成物を取得しようとする | — | 本ユースケースは対象にしない（入力に `userId` を要する）。匿名のダウンロードは Note 側の `downloadExportArtifact`（ExportTicket 経由）が担う | |
| 匿名の PDF エクスポートで作られた artifact（`uploadedBy: null`） | 所有者本人が URL を発行する | ノートの所有文脈で所有者判定が通り、発行できる | |
