# テストケース: setSharePassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 限定公開のノート | 8 文字以上のパスワードを設定する | `hasSharePassword: true` になり、`shareLink.password` が `{ hash, updatedAt: now }` になる | |
| — | 7 文字のパスワードを設定する | `BusinessRuleError(WeakPassword)` が投げられる | |
| — | 8 文字のパスワードを設定する | 成功する（境界値） | |
| パスワード設定済み | 別のパスワードに変更する | `shareLink.password.updatedAt` が変更時刻に更新され、`hash` も差し替わる | |
| パスワード設定済み | `null` を指定して解除する | `hasSharePassword: false` になり、`shareLink.password` が `null` になる（ハッシュと更新時刻が同時に消える） | |
| 非公開のノート | 設定する | `BusinessRuleError(NotUnlisted)` が投げられる | |
| 公開ノート | 設定する | `BusinessRuleError(NotUnlisted)` が投げられる | |
| 通過済みの閲覧者がいる | パスワードを変更する | その閲覧者は再度パスワードを求められる（通過証の `passwordUpdatedAt` が `shareLink.password.updatedAt` と食い違う） | |
| 通過済みの閲覧者がいる | パスワードを解除する | その閲覧者はパスワードなしで閲覧できる（`shareLink.password` が `null` のため `passwordRequired` にならない） | |
| — | 設定後に応答を確認する | パスワードの値もハッシュも含まれない | |
| viewer である | 設定する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
