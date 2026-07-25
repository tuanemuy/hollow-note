# テストケース: requestBulkNoteOperation

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 編集できるノートが 20 件 | タグ追加を要求する | 親ジョブと 20 件の子ジョブが作られる | |
| 501 件を指定する | 要求する | `ValidationError("TOO_MANY_TARGETS")` が投げられる | |
| 権限のないノートが混ざる | 要求する | それらは `skipped` に積まれ、他は登録される | |
| すべて権限がない | 要求する | `BusinessRuleError(AccessDenied)` が投げられる | |
| ハンドル未設定で公開への変更を要求する | 要求する | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられ、1 件も登録されない | |
| 移動先の viewer である | 移動を要求する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 移動で閲覧できなくなる利用者が出る | 移動を要求する | `warnings` にその旨が含まれる | |
| 移動先にないタグが付いている | 移動を要求する | `warnings` に外れるタグ名が含まれる | |
| 対象が 1 件のみ | 要求する | ジョブとして登録される（経路を分けない） | |
| 未知の操作を指定する | 要求する | `ValidationError("INVALID_OPERATION")` が投げられる | |
