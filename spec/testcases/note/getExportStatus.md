# テストケース: getExportStatus

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `{ kind: "job" }` の有効なチケット、ジョブは待機中 | 照会する | `status: "queued"` が返る | |
| ジョブが実行中 | 照会する | `status: "running"` と `progress` が返る | |
| ジョブが成功している | 照会する | `status: "succeeded"` と、artifact の `fileId` へ差し替えた `{ kind: "file" }` の新しい署名済みチケットが返る | |
| ジョブが失敗している | 照会する | `status: "failed"` と `failureReason` が返る | |
| 実行中の `pdfExport` ジョブに相乗りしたあと、実行前にノートが更新された | 完了まで照会し、`downloadExportArtifact` まで進む | 受け取る PDF は要求時点の版ではなく**実行時点の版**になる（相乗りは版を条件にしない。キュー待ちのジョブは描画される版が実行時点まで確定しないため、`exportNote` の相乗りに「同版であること」を事前条件として置けない。版を条件にするのは既存 artifact の再利用のみ） | |
| `{ kind: "file" }` のチケットで、指す artifact が生きている | 照会する | `status: "succeeded"` と同じチケットが返る（`downloadExportArtifact` に進める） | |
| `{ kind: "file" }` のチケットだが、発行後に artifact が保持期限を迎えた | 照会する | `ValidationError("ARTIFACT_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される（`exportNote` の下限はチケット発行時点の保証にすぎないため、照会のたびに artifact の生死を確かめる。確かめないと「完了しました」の直後にダウンロードが失効で落ちる） | |
| `{ kind: "file" }` のチケットだが、artifact が強制終端の後始末や所有者の削除（`deleteFilesByOwner`）で回収されている | 照会する | 同じく `ValidationError("ARTIFACT_EXPIRED")` が投げられる | |
| `{ kind: "file" }` のチケットの `fileId` が指す artifact の `noteId` がチケットと一致しない | 照会する | 同じく `ValidationError("ARTIFACT_EXPIRED")` が投げられる（`downloadExportArtifact` の手順 3 と同じ扱い） | |
| 同じチケットで 2 回照会する | 照会する | 何度でも照会でき、状態は変わらない（冪等） | |
| サインイン済みの所有者が取得したチケット | 照会する | 匿名と同じ手順で成功する（サインインの有無を問わない） | |
| 発行から 30 分ちょうど経過したチケット | 照会する | `ValidationError("TICKET_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される（`issuedAt + 30 分 <= now` で失効。境界値） | |
| 発行から 30 分未満のチケット | 照会する | 有効なものとして扱われる（境界値） | |
| 署名を改ざんしたチケット | 照会する | presentation 層の署名検証で拒否され、ユースケースに到達しない（署名と検証は presentation 層の責務） | |
| 検証済みの `ExportTicket` | 照会する | ユースケースはアプリケーション層の型（`application/export/`）として受け取る。Note ドメインの値オブジェクトではないため Note → Job の依存は生じない | |
| 照会の前にノートが非公開に戻された（匿名の閲覧者） | 照会する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（チケットはアクセスをバイパスせず、毎回再評価される） | |
| 照会の前にノートが削除された | 照会する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 共有リンクが再発行され、旧トークンで閲覧している | 照会する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| パスワード付き共有リンクで通過証がない | 照会する | `ValidationError("SHARE_PASSWORD_REQUIRED")` が投げられる | |
| チケットの指すジョブが不在（履歴の削除後） | 照会する | `NotFoundError("EXPORT_NOT_FOUND")` が投げられ、`exportNote` の再実行へ誘導される | |
