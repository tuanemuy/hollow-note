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
| OpenRouter を新規連携し、`awaitingIntegration` のノートが 3 件ある | 交換後に応答を確認する | `NoteQueryService.countByContentStatus` で数えた `awaitingIntegrationCount: 3` が返り、P-23 が「3 件のノートが本文の生成を待っています」と案内してノート一覧への導線を出す（IN-01 手順 4） | |
| OpenRouter を新規連携し、`awaitingIntegration` のノートが 0 件 | 交換後に応答を確認する | `awaitingIntegrationCount: 0` が返り、案内は表示されない | |
| OpenRouter を再連携した（`reconnected: true`） | 交換後に応答を確認する | `awaitingIntegrationCount: null` が返る（件数の取得は新規連携時のみ） | |
| Google Drive を連携した | 交換後に応答を確認する | `awaitingIntegrationCount: null` が返る | |
| プロバイダーとの通信が失敗する | 交換する | `SystemError(ExternalServiceError)` が投げられる | |
| OAuth開始後にUserが`deleting`またはauth epoch更新済み | callbackを完了する | `ValidationError("ACCOUNT_UNAVAILABLE")`でConnectionをinsert/reconnectせず、account cleanup後へ資格情報を残さない | |
