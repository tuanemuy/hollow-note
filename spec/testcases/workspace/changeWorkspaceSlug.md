# テストケース: changeWorkspaceSlug

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で非公開のワークスペース | 未使用のスラッグに変更する | スラッグが更新され、`workspace.slugChanged` が旧スラッグつきで発行される | |
| 公開中のワークスペース | スラッグを `null` にする | `BusinessRuleError(PublishedWorkspaceRequiresSlug)` が投げられる | |
| 非公開のワークスペース | スラッグを `null` にする | 成功する | |
| 他のワークスペースが使用中のスラッグ | 変更する | `ConflictError("SLUG_ALREADY_USED")` が投げられる | |
| 自分と同じスラッグ | 同じ値に変更する | 変更もイベントも起きず成功する | |
| owner でない | 変更する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 公開中でスラッグを変更した | 旧スラッグの公開ページを開く | 「見つかりません」が返る | |
