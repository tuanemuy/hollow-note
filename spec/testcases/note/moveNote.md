# テストケース: moveNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 個人ノート、移動先ワークスペースの editor | ワークスペースへ移動する | 所有者が変わり、`note.moved` が旧所有者つきで発行される | |
| ワークスペースのノート、そこの editor | 個人へ移動する | 所有者が変わる | |
| 移動先ワークスペースの viewer | 移動する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 移動元で編集権限がない | 移動する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（権限不足は存在秘匿に統一する） | |
| 移動先ワークスペースが存在しない（削除済みを含む） | 移動する | `WorkspaceRepository.findById` の実在確認で `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる（移動先は要求者が選んだ先であり隠す対象ではないため、移動元の権限不足の `NOTE_NOT_FOUND` とは分ける） | |
| 変換処理中のノート | 移動する | `BusinessRuleError(CannotMoveWhileProcessing)` が投げられる | |
| 同じ所有者を指定する | 移動する | 変更もイベントも起きず成功する | |
| 限定公開のノート | 移動する | 共有リンクの URL は変わらず、引き続き到達できる | |
| 移動元にのみ存在するタグが付いている | 移動する | `droppedTagNames` にそのタグ名が含まれ、付与が外れる | |
| 移動先に同名のタグがある | 移動する | そのタグに付け替えられる | |
| 元ファイルとメディアを持つノート | 移動する | 保管ファイルの所有者も移動先に移り、使用量が付け替わる | |
| 移動が成功した | `note.moved` の購読者を確認する | Tag の `relocateAssignmentsForNote` / Storage の `relocateFilesForNote` / Note の `projectNoteChanges`（所有者・ワークスペース列の解決し直し）/ Usage の `applyStorageDelta` の 4 つが受け取る | |
| 移動先の使用量が既に容量クォータを超えている | 移動する | 移動は成功する（移動時に容量クォータを検査しないのは意図的な設計。クォータの強制は取り込み時のみ） | |
| 移動によって移動先がクォータを超える | 移動する | 移動は成功し、以後の新規アップロードが拒否されるだけになる（`applyStorageDelta` は消費量を付け替えるが判定はしない） | |
| 移動の確定時点で移動元のワークスペースから除名されていた | 移動する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（`ensureMovable` の `AccessDenied` には到達しない） | |
| 移動の確定時点で移動先のワークスペースから除名されていた | 移動する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| ワークスペースのノートを個人へ移動した | ワークスペースの他メンバーが開く | 「見つかりません」が返る | |
| 他者が先に更新した | 古い `expectedVersion` で移動する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
