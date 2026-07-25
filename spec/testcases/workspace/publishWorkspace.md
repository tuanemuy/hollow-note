# テストケース: publishWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner、スラッグ設定済み、非公開 | 公開する | `publication: "published"` になり、`workspace.published` が発行され、公開ページの URL が返る | |
| スラッグ未設定 | 公開する | `BusinessRuleError(SlugRequiredToPublish)` が投げられる | |
| 公開ノートが 0 件 | 公開する | 公開は成功し、`publicNoteCount: 0` が返る | |
| 既に公開中 | 公開する | 変更もイベントも起きず成功する | |
| editor である | 公開する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 公開後 | 非公開のノートを外部から開く | 「見つかりません」が返る（ワークスペースの公開はノートの公開範囲を変えない） | |
