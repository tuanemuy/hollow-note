# テストケース: getPublicWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 公開中のワークスペース | スラッグで引く | 名前・説明・アイコンが返る | |
| 非公開のワークスペース | スラッグで引く | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| 存在しないスラッグ | 引く | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| 形式が不正なスラッグ | 引く | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる（バリデーションエラーにしない） | |
| 削除済みのワークスペース | 引く | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| — | 引く | 応答にメンバーの情報が含まれない | |
