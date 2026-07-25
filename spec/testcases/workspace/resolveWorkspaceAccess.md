# テストケース: resolveWorkspaceAccess

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner として参加している | 解決する | `role: "owner"` とワークスペース名が返る | |
| editor として参加している | 解決する | `role: "editor"` が返る | |
| viewer として参加している | 解決する | `role: "viewer"` が返る | |
| 参加していない | 解決する | `role: null` が返る（エラーにしない） | |
| ワークスペースが存在しない | 解決する | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| ワークスペースが削除済み | 解決する | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| 除名された直後 | 解決する | `role: null` が返る | |
