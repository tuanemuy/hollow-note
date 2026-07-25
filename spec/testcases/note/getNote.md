# テストケース: getNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 自分の個人ノート（本文あり） | 引く | 本文・見出し・タグ・公開状態が返り、`permissions` がすべて `true` になる | |
| ワークスペースの viewer | そのワークスペースのノートを引く | 本文が返り、`permissions` がすべて `false` になる | |
| ワークスペースの editor | そのワークスペースのノートを引く | `canEdit` と `canDelete` が `true` になる | |
| 他人の非公開ノート | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 変換処理中のノート | 引く | `content.status: "processing"`、`html: null` が返る | |
| 「要 LLM 連携」のノート | 引く | `content.status: "awaitingIntegration"` が返る | |
| 変換に失敗したノート | 引く | `content.status: "failed"` と `failureReason` が返る | |
| ゴミ箱のノート（所有者） | 引く | 取得できる | |
| ゴミ箱のノート（他人） | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しないノート ID | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 限定公開のノート（所有者） | 引く | `shareUrl` が含まれる | |
| 公開ノート（サインインしていない閲覧者） | 引く | 本文が返り、`shareUrl` は含まれない | |
