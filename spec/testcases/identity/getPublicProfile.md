# テストケース: getPublicProfile

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| ハンドル設定済みの `ActiveUser` | ハンドルで引く | 表示名・自己紹介・アイコンが返る | |
| 存在しないハンドル | 引く | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| 形式が不正なハンドル | 引く | `NotFoundError("USER_NOT_FOUND")` が投げられる（バリデーションエラーにしない） | |
| `PendingUser` にハンドルが設定されている | 引く | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| 削除済みの利用者のハンドル | 引く | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| — | 引く | 応答にメールアドレスが含まれない | |
| 大文字を含むハンドルで引く | 引く | 小文字に正規化されて一致する | |
