# テストケース: getWorkspaceSettings

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner のメンバー | 設定を読む | `name` / `description` / `avatarUrl` / `slug` / `publication` / `role` が返り、`canManage` / `canPublish` / `canDelete` がすべて `true` になる | |
| viewer のメンバー | 設定を読む | 同じ射影が返り、`canManage` / `canPublish` / `canDelete` がすべて `false` になる（画面は読み取り専用で描く） | |
| 説明とアイコンが設定済み | 設定を読む | `description` と `avatarUrl` が保存された値のまま返る（空では返らない） | |
| スラッグ未設定 | 設定を読む | `slug: null` が返る | |
| 非メンバー | 設定を読む | `BusinessRuleError(InsufficientRole)` が投げられる | |
| ワークスペースが不在・削除済み | 設定を読む | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
