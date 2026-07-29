# テストケース: downloadExportArtifact

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `{ kind: "file" }` の有効なチケットと期限内の artifact | ダウンロードする | 有効期間つきの URL・`fileName`・`mimeType` が返る | |
| 同じチケットで 2 回ダウンロードする | ダウンロードする | 期限内なら何度でも成功する（冪等） | |
| サインイン済みの所有者が取得したチケット | ダウンロードする | 匿名と同じ手順で成功する（サインインの有無を問わない） | |
| `{ kind: "job" }` のチケット | ダウンロードする | `ValidationError("INVALID_TICKET")` が投げられる | |
| 発行から 30 分ちょうど経過したチケット | ダウンロードする | `ValidationError("TICKET_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される（`issuedAt + 30 分 <= now` で失効。境界値） | |
| 発行から 30 分未満のチケット | ダウンロードする | 有効なものとして扱われる（境界値） | |
| 署名を改ざんしたチケット | ダウンロードする | presentation 層の署名検証で拒否され、ユースケースに到達しない（署名と検証は presentation 層の責務） | |
| 検証済みの `ExportTicket` | ダウンロードする | ユースケースはアプリケーション層の型（`application/export/`）として受け取る。Note ドメインの値オブジェクトではないため Note → Job の依存は生じない | |
| artifact の期限（24 時間）が切れている | ダウンロードする | `ValidationError("ARTIFACT_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される | |
| artifact が回収済みで不在 | ダウンロードする | `ValidationError("ARTIFACT_EXPIRED")` が投げられる | |
| チケットの `noteId` と artifact の `noteId` が一致しない | ダウンロードする | `ValidationError("ARTIFACT_EXPIRED")` が投げられる | |
| ダウンロードの前にノートが非公開に戻された（匿名の閲覧者） | ダウンロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（チケットはアクセスをバイパスせず、毎回再評価される） | |
| ダウンロードの前にノートが削除された | ダウンロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 共有リンクが再発行され、旧トークンで閲覧している | ダウンロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| パスワード付き共有リンクで通過証がない | ダウンロードする | `ValidationError("SHARE_PASSWORD_REQUIRED")` が投げられる | |
