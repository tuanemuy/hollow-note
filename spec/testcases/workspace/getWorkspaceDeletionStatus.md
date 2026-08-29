# テストケース: getWorkspaceDeletionStatus

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 削除が開始されていない、owner のメンバー | 削除状況を読む | `status: "none"` / `operationId: null` / `canDelete: true` が返る | |
| 削除が開始されていない、viewer のメンバー | 削除状況を読む | `status: "none"` / `canDelete: false` が返る | |
| `deleteWorkspace` が受理済みで Workspace はまだ残っている | 削除状況を読む | `status: "inProgress"` と受理時の `operationId` が返る | |
| 削除サガが Workspace 行を消し終えている | 削除状況を読む | `status: "completed"` / `operationId: null` / `canDelete: false` が返る（メンバーシップは既に無いので判定しない） | |
| ワークスペースは存在するが非メンバー | 削除状況を読む | `BusinessRuleError(InsufficientRole)` が投げられる | |
