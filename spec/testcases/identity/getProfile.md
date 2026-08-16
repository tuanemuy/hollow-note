# テストケース: getProfile

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `ActiveUser` が自分のプロフィールを持つ | 自分のプロフィールを読む | `userId` / `displayName` / `bio` / `avatarUrl` / `handle` が返る | |
| 一度も編集していない `ActiveUser` | 自分のプロフィールを読む | 登録時の既定が返る（`bio` は空文字列、`handle` と `avatarUrl` は `null`） | |
| パスワード認証手段を持つ `ActiveUser` | 自分のプロフィールを読む | 応答にパスワードのハッシュやトークンが含まれない | |
| 利用者が不在または削除済み | 読み出す | `NotFoundError("USER_NOT_FOUND")` が投げられる | |
| `PendingUser` | 読み出す | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられる | |
| `DeletingUser` | 読み出す | `ValidationError("ACCOUNT_UNAVAILABLE")` が投げられる | |
