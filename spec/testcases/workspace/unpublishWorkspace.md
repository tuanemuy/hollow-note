# テストケース: unpublishWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner、公開中 | 非公開に戻す | `publication: "private"` になり、`workspace.unpublished` が発行される | |
| 非公開に戻した | 出力を確認する | `workspaceId` と `publication` だけが返り、`publicNoteCount` は含まれない（取り下げ後の公開ページは存在せず、数えても画面で使い道がないため） | |
| 公開中にスラッグを設定していた | 非公開に戻す | スラッグは残り、再公開すると同じ URL に戻せる（スラッグの解除は `changeWorkspaceSlug` が担う） | |
| 非公開に戻した後 | 公開ページの URL を開く | 「見つかりません」が返る | |
| 非公開に戻した後 | 公開ステータスのノートの URL を直接開く | ノート自体は引き続き閲覧できる | |
| 既に非公開 | 非公開に戻す | 変更もイベントも起きず成功する | |
| owner でない | 非公開に戻す | `BusinessRuleError(InsufficientRole)` が投げられる | |
