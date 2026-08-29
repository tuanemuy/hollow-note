# テストケース: publishWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner、スラッグ設定済み、非公開 | 公開する | `publication: "published"` になり、`workspace.published` が発行され、公開ページの URL が返る | |
| スラッグ未設定 | 公開する | `BusinessRuleError(SlugRequiredToPublish)` が投げられる | |
| 公開ノートが 0 件 | 公開する | 公開は成功し、`publicNoteCount: 0` が返る（公開ページが空であることを画面が案内するために返す） | |
| 公開ノートが 3 件ある | 公開する | `NoteQueryService.searchPublic` で数えた `publicNoteCount: 3` が返る | |
| 出力の形 | `unpublishWorkspace` と比べる | 公開側だけが `publicNoteCount` を返す（取り下げ側の出力には含まれない） | |
| 既に公開中 | 公開する | 変更もイベントも起きず成功する | |
| editor である | 公開する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 公開後 | 非公開のノートを外部から開く | 「見つかりません」が返る（ワークスペースの公開はノートの公開範囲を変えない） | |
| commit 後の投影を恒久的に失う | 公開する | scope は公開済み・directory は非公開のままで公開ページに到達できない。同じ要求の再送が投影を打ち直し、公開を二重に行わない | |
