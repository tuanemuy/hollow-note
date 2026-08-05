# テストケース: createBlankNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| サインイン済み | 個人所有で作成する | 非公開・`content.status: "ready"`・本文が空のノートが作られ、`note.created` が発行される | |
| ワークスペースの editor | ワークスペース所有で作成する | ノートが作られ、所有者がワークスペースになる | |
| ワークスペースの viewer | ワークスペース所有で作成する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 非メンバー | ワークスペース所有で作成する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| — | タイトルを省略して作成する | タイトルが `"無題"`、由来が `auto` になる | |
| — | タイトルを指定して作成する | 指定した値が入り、由来が `manual` になる | |
| — | 201 文字のタイトルで作成する | `BusinessRuleError(InvalidTitle)` が投げられる | |
| 存在しないワークスペース ID | 作成する | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| 作成直後 | `styleMode` を確認する | `default` になっている | |
| route予約後にscope-local commitが失敗する | 作成する | reserved routeをoperation IDで解放し、外部からNoteへ到達できない | |
| scope-local commit後にactivation応答を失う | 再試行する | 同じoperation IDでrouteをactiveにし、Noteを二重作成しない | |
| reserved routeが期限切れ | recoveryを実行する | 対象scopeにNoteがあればactivateし、なければreservationを削除する | |
| workspaceにNoteを作成する | routeを確認する | immutable `created_by` に作成者userIdが入り、membership離脱やNote move後も著者refresh台帳として残る | |
