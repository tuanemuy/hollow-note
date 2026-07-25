# テストケース: startOAuthFlow

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| — | `provider: "google"`, `intent: "signIn"` で開始する | 認可 URL が返り、`state` と `codeVerifier` が 10 分の期限で保存される | |
| サインイン済み | `intent: "linkIdentity"` と `userId` を指定して開始する | 認可 URL が返り、保存された状態に `userId` が含まれる | |
| — | `intent: "linkIdentity"` で `userId` を省略する | `ValidationError("USER_REQUIRED")` が投げられる | |
| — | 未知のプロバイダーを指定する | `BusinessRuleError(InvalidProvider)` が投げられる | |
| — | `redirectTo` に外部オリジンの URL を指定する | `ValidationError("INVALID_REDIRECT")` が投げられる | |
| — | `redirectTo` に相対パスを指定する | 認可 URL が返り、保存された状態に `redirectTo` が含まれる | |
| — | 2 回続けて開始する | 異なる `state` が 2 件保存され、どちらも有効 | |
