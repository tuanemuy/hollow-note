# テストケース: setSharePassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 限定公開のノート | 8 文字以上のパスワードを設定する | `hasSharePassword: true` になり、`passwordUpdatedAt` が更新される | |
| — | 7 文字のパスワードを設定する | `BusinessRuleError(WeakPassword)` が投げられる | |
| — | 8 文字のパスワードを設定する | 成功する（境界値） | |
| パスワード設定済み | `null` を指定して解除する | `hasSharePassword: false` になり、`passwordUpdatedAt` が更新される | |
| 非公開のノート | 設定する | `BusinessRuleError(NotUnlisted)` が投げられる | |
| 公開ノート | 設定する | `BusinessRuleError(NotUnlisted)` が投げられる | |
| 通過済みの閲覧者がいる | パスワードを変更する | その閲覧者は再度パスワードを求められる | |
| 通過済みの閲覧者がいる | パスワードを解除する | その閲覧者はパスワードなしで閲覧できる | |
| — | 設定後に応答を確認する | パスワードの値もハッシュも含まれない | |
| viewer である | 設定する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
