# テストケース: startOAuthFlow

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| — | `provider: "google"`, `intent: "signIn"` で開始する | 認可 URL が返り、`state` と `codeVerifier` が 10 分の期限で保存される。応答は `authorizationUrl` と併せて保存した `state` も返す（転送境界がフローを開始したブラウザーへ束縛するため — [ADR 034](../../adr/034-oauth-callback-browser-binding.md)） | |
| Activeでサインイン済み | `intent: "linkIdentity"` と `userId` を指定して開始する | 認可 URL が返り、保存された状態に `userId` とcurrent `userAuthEpoch`が含まれる | |
| 削除開始済みまたは削除済み | `intent: "linkIdentity"` で開始する | OAuth stateを作らず、`UnauthorizedError("UNAUTHENTICATED")` が投げられる（認証済み利用者として扱わない） | |
| — | `intent: "linkIdentity"` で `userId` を省略する | `ValidationError("USER_REQUIRED")` が投げられる | |
| — | 未知のプロバイダーを指定する | `BusinessRuleError(InvalidProviderAccount)` が投げられる | |
| — | `redirectTo` に外部オリジンの URL を指定する | `ValidationError("INVALID_REDIRECT")` が投げられる | |
| — | `redirectTo` に相対パスを指定する | 認可 URL が返り、保存された状態に `redirectTo` が含まれる | |
| — | 2 回続けて開始する | 異なる `state` が 2 件保存され、どちらも有効 | |
