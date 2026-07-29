# テストケース: runBulkNoteOperationItem

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 待機中の子ジョブと有効な対象 | タグ追加（`addTag`）を実行する | タグが付き、ジョブが `succeeded` になる | |
| 既にタグが付いている | `addTag` を実行する | 成功として扱われ、重複した付与は作られない | |
| そのタグが付いた対象 | タグ削除（`removeTag`）を実行する | 付与が外れ、ジョブが `succeeded` になる | |
| そのタグが付いていない対象 | `removeTag` を実行する | 既に目的の状態のため成功として扱われる（冪等） | |
| 対象ノートの所有文脈のスコープに同名のタグが存在しない | `removeTag` を実行する | `TagRepository.findByScopeAndName` が `tagId` を返さないため `unassignTag` を呼ばず、成功として扱われる（冪等） | |
| `removeTag` を実行する | `unassignTag` に渡す引数を確認する | `payload` の `tagName` を `TagScope.fromNoteOwner(note.owner)` と `TagRepository.findByScopeAndName` で `tagId` に解決してから渡す（`userId` は `job.requestedBy`） | |
| アクティブなノート | `trash` を実行する | `trashNote` に `excludingJobId: jobId`（この子ジョブ自身の ID）を渡して呼び、ノートがゴミ箱に移り、この子ジョブは `succeeded` になる | |
| 同上 | 取り消されたジョブを確認する | 同じノートを対象とする他の未終端ジョブ（変換・再生成・PDF 書き出し・別の一括操作の子）は通常どおり取り消されるが、呼び出し元であるこの子ジョブ自身だけは `trashNote` の手順 2 の対象から外れる | |
| `excludingJobId` を渡さずに `trash` を呼んだ場合（退行） | 実行する | 子ジョブ自身が `Job.cancel` され、手順 4 の `Job.succeed` が `ConflictError` になり、全件正常に移動できたのに親が `canceled` として集計される（この退行を防ぐための引数。「共通: ユースケースを合成するときの副作用の範囲」） | |
| 既にゴミ箱にあるノート | `trash` を実行する | 既に目的の状態のため成功として扱われる（冪等） | |
| 対象ノートが削除済み | 実行する | `failed("targetMissing")` になる | |
| 実行時に権限を失っている | 実行する | `failed("permissionRevoked")` になる | |
| 本文が空のノートに公開への変更を実行する | 実行する | `failed("unknown")` になり、理由が `detail` に記録される | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わる | |
| ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） | 配送で受け取る | 何もせず成功として返る（run 系共通規則の判定 1） | |
| リースが有効な `running` の子ジョブ | 再配送で受け取る | 何もせず終わる（他のワーカーが実行中） | |
| リースが失効した `running` の子ジョブ | 再配送で受け取る | 引き継いで再開し、`attempts` が加算される | |
| 実行中に子ジョブが外部から強制終端された（親の `cancelJob` など） | `Job.succeed` / `Job.fail` の保存が `ConflictError` になる | ジョブを読み直し、終端済みのため生成物を破棄して成功として返す。ジョブは書き換えない（run 系共通規則の判定 4） | |
| ジョブ保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） | 結果を保存する | `ConflictError` をそのまま投げて再配送に委ねる | |
| ノートの版が競合する | 実行する | 1 度読み直して再適用し、成功する | |
| ノートの版の競合が続く | 実行する | `failed("unknown")` になる | |
| 移動を実行する | 実行する | タグ・保管ファイル・使用量の付け替えも行われる | |
| `move` の移動先ワークスペースが登録から実行までの間に削除された | 実行する | `moveNote` が返す `NotFoundError("WORKSPACE_NOT_FOUND")` を `Job.fail("targetMissing")` に写す（`unknown` にはしない。この経路の想定内の分岐であるため） | |
| 個人 → ワークスペースの一括移動で移動先が削除された | ジョブが取り消されるかを確認する | `bulkMove` の `scope` は移動**元**の文脈で固定されるため移動先ワークスペースの削除・除名によるキャンセル網には載らず、実行時に対象不在（`targetMissing`）として分岐する | |
| ゴミ箱のノートに `purge` を実行する | 実行する | 完全削除され、ジョブが `succeeded` になる | |
| ゴミ箱にないノートに `purge` を実行する | 実行する | `failed("unknown")` になり、理由が `detail` に記録される | |
