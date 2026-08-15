# テストケース: completeOAuthCallback

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `intent: "signIn"` の state が保存されている | コールバックを処理する | `intent: "signIn"` arm が返り、`sessionToken` を運ぶ | |
| `intent: "linkIdentity"` の state が保存されている | コールバックを処理する | `intent: "linkIdentity"` arm が返り、`identityId` と `redirectTo` を運ぶ | |
| 経路の `:provider` が state に保存されたものと一致しない | コールバックを処理する | state を無効として扱い、`ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| state が存在しない・期限切れ | コールバックを処理する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| — | 同じ state で 2 回続けて処理する | 2 回目は state が消費済みのため `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
