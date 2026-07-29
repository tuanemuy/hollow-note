# テストケース: runBulkExportItem

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 待機中の子ジョブ（`payload.format: "html"`） | 実行する | 自己完結 HTML が生成・保管され、ジョブが `succeeded` になる | |
| `payload.format: "markdown"` | 実行する | HTML から変換された Markdown が生成・保管される | |
| `payload.format: "pdf"`、`styleMode: "preserve"` のノート | 実行する | 既定スタイルの当たらない PDF が生成される | |
| 生成に成功した | 保管記録を確認する | `purpose: "artifact"`、対象の `noteId` と生成時点の版 `noteVersion` が付き、期限は 7 日（ZIP と同じに揃え、親の組み立て・子の再試行の間も生存させる） | |
| 生成に成功した | 保管記録とジョブの保存の境界を確認する | `StoredFile.registerEphemeral`（手順 4）と `Job.succeed(artifact)`（手順 5）が**同一 UoW** で保存される。「保管済みだが `Job.succeed` 前」の子を作らないためで、これがないと強制終端の後始末（`succeeded` の子で絞る回収）から漏れて、アクセス権を失った利用者の手元に本文を含む生成物が 7 日残る | |
| 手順 4 の UoW がロールバックした | 保管の状態を確認する | `ObjectStorage.put` 済みの実体はメタデータのない孤児オブジェクトとして残るが、参照されないため害はない（削除順序と同じ整理） | |
| `format: "pdf"` で生成した直後 | 同じノートを `exportNote` で PDF ダウンロードする | 残りの保持期間が 24 時間を超えるため再利用の対象にならず、単体エクスポートの 24 時間保持の約束が崩れない（再利用側の条件は `expiresAt <= now + 24 時間`） | |
| ジョブが `succeeded` になった | 親の進捗を確認する | `job.succeeded` を購読する `updateBatchProgress` が親の進捗を進める | |
| 対象ノートが削除済み | 実行する | `failed("targetMissing")` になる | |
| 対象ノートがゴミ箱にある | 実行する | `failed("targetMissing")` になる | |
| 本文が `ready` でない | 実行する | `failed("targetMissing")` になる | |
| 実行時に要求者が閲覧権限を失っている | 実行する | `failed("permissionRevoked")` になる | |
| 生成がタイムアウトする | 実行する | `failed("timeout")` になる | |
| 保管が失敗する | 実行する | `failed("storageError")` になる | |
| 既に `succeeded` の子ジョブ | 再度実行する | 何もせず終わり、生成物は増えない（冪等） | |
| 子ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） | 配送で受け取る | 何もせず成功として返る（run 系共通規則の判定 1） | |
| リースが有効な `running` の子ジョブ | 再配送で受け取る | 何もせず終わる（他のワーカーが実行中） | |
| リースが失効した `running` の子ジョブ | 再配送で受け取る | 引き継いで再開し、`attempts` が加算される | |
| 実行中に子ジョブが外部から強制終端された（親の `cancelJob` など） | `Job.succeed` の保存が `ConflictError` になる | ジョブを読み直し、終端済みのため生成物を破棄して成功として返す。ジョブは書き換えず、保管済みの artifact は期限付き保管の自動回収に委ねる（run 系共通規則の判定 4） | |
| 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） | 結果を保存する | `ConflictError` をそのまま投げて再配送に委ねる | |
