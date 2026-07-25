# テストケース: planConversionForUpload

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| HTML ファイル、LLM 未連携 | 方針を決める | `passthrough`、`initialContentStatus: "processing"` になる | |
| Markdown ファイル、LLM 連携済み | 方針を決める | `markdown` になる（LLM は使わない） | |
| Word ファイル、LLM 未連携 | 方針を決める | `textExtraction` になる | |
| Word ファイル、LLM 連携済み | 方針を決める | `textExtractionThenStructuring` になる | |
| テキスト層のある PDF、LLM 未連携 | 方針を決める | `textExtraction` になる | |
| テキスト層のない PDF、LLM 未連携 | 方針を決める | `unavailable(integrationRequired)`、`initialContentStatus: "awaitingIntegration"` になる | |
| テキスト層のない PDF、LLM 連携済み | 方針を決める | `pageImageStructuring` になる | |
| 画像、LLM 未連携 | 方針を決める | `unavailable(integrationRequired)` になる | |
| 音声、LLM 連携済み | 方針を決める | `transcriptionThenStructuring` になる | |
| 未対応形式 | 方針を決める | `unavailable(unsupportedFormat)`、`initialContentStatus: "failed"` になる | |
| パスワード保護された PDF | 方針を決める | `passwordProtected: true` が返る | |
| 判定処理が失敗する | 方針を決める | `SystemError(ExternalServiceError)` が投げられる | |
