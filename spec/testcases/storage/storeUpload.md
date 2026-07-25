# テストケース: storeUpload

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 対応形式の Markdown ファイル | アップロードする | ファイルが保管され、ノートが `processing` で作られ、変換ジョブが登録される | |
| 画像ファイルで OpenRouter 未連携 | アップロードする | ノートが `awaitingIntegration` で作られ、変換ジョブは登録されない | |
| 画像ファイルで OpenRouter 連携済み | アップロードする | ノートが `processing` で作られ、変換ジョブが登録される | |
| 未対応の拡張子 | アップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられる | |
| 拡張子と内容が食い違う | アップロードする | 内容から判定した形式が使われる | |
| 51 MB の PDF | アップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| 50 MB の PDF | アップロードする | 成功する（境界値） | |
| パスワード保護された PDF | アップロードする | ノートが作られ、`content` が `failed(passwordProtected)` になる | |
| 保存容量の残りが足りない | アップロードする | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| LLM 実行回数の残りがない画像 | アップロードする | `BusinessRuleError(LlmQuotaExceeded)` が投げられる | |
| Drive の自動バックアップが有効 | アップロードする | バックアップジョブも登録される | |
| 自動バックアップが無効 | アップロードする | バックアップジョブは登録されない | |
| ワークスペースの viewer | アップロードする | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 宣言サイズと実サイズが食い違う | アップロードする | 実サイズが採用される | |
| オブジェクトストレージが失敗する | アップロードする | `SystemError(ExternalServiceError)` が投げられ、ノートは作られない | |
| 同名ファイルを 2 回アップロードする | アップロードする | 別のノートが 2 件作られる | |
| `visibility: "unlisted"` を指定する | アップロードする | ノートは非公開で作られ、変換成功後に限定公開になる | |
| 変換が失敗した | 結果を確認する | 公開ステータスは非公開のまま残る | |
