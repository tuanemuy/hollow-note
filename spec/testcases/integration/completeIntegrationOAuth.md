# テストケース: completeIntegrationOAuth

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 有効な `state` と未連携の OpenRouter | 認可コードを交換する | 連携が作られ、既定のモデル設定が入り、`reconnected: false` が返る | |
| 既に連携済み | 認可コードを交換する | 資格情報が差し替わり、既存の設定が維持され、`reconnected: true` が返る | |
| 失効した連携がある | 認可コードを交換する | `status: "active"` に戻り、設定が維持される | |
| `state` が保存されていない | 交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| 同じ `state` を 2 回使う | 2 回目に交換する | `ValidationError("OAUTH_STATE_INVALID")` が投げられる | |
| Drive で必要なスコープが不足 | 交換する | `ValidationError("OAUTH_SCOPE_INSUFFICIENT")` が投げられ、連携は作られない | |
| Drive でリフレッシュトークンが得られない | 交換する | `ValidationError("OAUTH_REFRESH_TOKEN_MISSING")` が投げられる | |
| 疎通確認が失敗する | 交換する | `ValidationError("CONNECTION_PROBE_FAILED")` が投げられ、連携は作られない | |
| 交換後 | 保存された資格情報を確認する | 暗号化されて保存されている | |
| OpenRouter を新規連携した | 交換後に応答を確認する | 「要 LLM 連携」のノートがある旨が含まれる | |
| プロバイダーとの通信が失敗する | 交換する | `SystemError(ExternalServiceError)` が投げられる | |
