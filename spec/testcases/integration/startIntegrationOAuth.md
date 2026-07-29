# テストケース: startIntegrationOAuth

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| サインイン済み | OpenRouter で開始する | 認可 URL が返り、`state` が 10 分の期限で保存される | |
| サインイン済み | Google Drive で開始する | Drive のスコープと `prompt=consent` を含む URL が返る | |
| — | 未知のプロバイダーを指定する | `BusinessRuleError(InvalidProvider)` が投げられる | |
| — | `redirectTo` に外部 URL を指定する | `ValidationError("INVALID_REDIRECT")` が投げられる | |
| Google SSO 済み（`provider: "google"` の `OAuthIdentity` を持つ） | Drive で開始する | その `providerEmail` が `loginHint` として渡され、アカウント選択を省いた URL になる（`prompt=consent` は維持される。IN-04） | |
| Google の `OAuthIdentity` を持たない | Drive で開始する | `loginHint: null` となり、アカウント選択を伴う URL になる | |
| 既に連携済み | 開始する | 再連携として認可 URL が返る | |
| 保存された状態を確認する | 開始後に確認する | `intent: "integration"` と `userId` が含まれる | |
