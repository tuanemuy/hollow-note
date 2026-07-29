# テストケース: runNoteExport

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本文のあるノートと待機中のジョブ | 実行する | PDF が生成・保管され、ジョブが `succeeded` になり、生成物が 24 時間の期限を持つ | |
| 生成に成功した | 保管記録を確認する | `purpose: "artifact"`、対象の `noteId` と描画時点の版 `noteVersion` が付く | |
| サインイン済みの要求から登録されたジョブ | 実行する | artifact の `uploadedBy` が要求者、`owner` は要求者の個人 subject になる | |
| 匿名の要求から登録されたジョブ（`requestedBy: null`） | 実行する | artifact の `uploadedBy` が `null`、`owner` はノートの所有文脈になる | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わり、生成物は増えない | |
| ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） | 配送で受け取る | 何もせず成功として返る（run 系共通規則の判定 1） | |
| リースが有効な `running` のジョブ | 再配送で受け取る | 何もせず終わる（他のワーカーが実行中） | |
| リースが失効した `running` のジョブ | 再配送で受け取る | 引き継いで再開し、`attempts` が加算される | |
| 実行中にジョブが外部から強制終端された（`cancelJob` など） | `Job.succeed` の保存が `ConflictError` になる | ジョブを読み直し、終端済みのため生成した PDF を破棄して成功として返す。ジョブは書き換えず、保管済みの artifact は期限付き保管の自動回収に委ねる（run 系共通規則の判定 4） | |
| 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） | 結果を保存する | `ConflictError` をそのまま投げて再配送に委ねる | |
| ノートが削除済み | 実行する | ジョブが `failed("targetMissing")` になる | |
| 本文が `processing` のノート | 実行する | ジョブが `failed("targetMissing")` になる | |
| 描画がタイムアウトする | 実行する | ジョブが `failed("timeout")` になる | |
| 保管が失敗する | 実行する | ジョブが `failed("storageError")` になる | |
| `styleMode: "default"` のノート | 実行する | 既定スタイルが当たった PDF になる | |
| `styleMode: "preserve"` のノート | 実行する | 既定スタイルが当たらない PDF になる | |
