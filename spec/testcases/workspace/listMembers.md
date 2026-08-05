# テストケース: listMembers

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で 3 名のメンバーがいる | 一覧する | 3 件が表示名・メール・ロール・参加日つきで返り、`canManage: true` になる | |
| viewer である | 一覧する | メンバー一覧が返り、`canManage: false` になる | |
| 非メンバーである | 一覧する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| owner が 2 名いる | 一覧する | `ownerCount: 2` が返る | |
| メンバーが `limit` を超える | 一覧する | `limit` 件と総件数が返る | |
| ページング値が範囲外 | 一覧する | `ValidationError("INVALID_PAGINATION")` が投げられる（一覧系ユースケース共通の規約） | |
| 削除済みの利用者がメンバーに残っている | 一覧する | その行は表示名を解決できない旨を示して返る（エラーにしない） | |
| 1pageの100メンバーが32 User shardへ分散する | 一覧する | UserIdでgroupingし、最大6接続のwaveで現在の利用者表示を解決する | |
