# テストケース: planConversionForUpload

入力の `llm` は呼び出し側（`storeUpload`）が OpenRouter 連携の有無と `conversionPreference` から決める。以下の「LLM 未連携」は `llm: "unavailable"`、「LLM 連携済み」は `llm: "available"`、「LLM を使わない選択」は `llm: "declined"` を指す。出力の `initialContent` は `InitialContentState`（`{ status: "processing" }` / `{ status: "awaitingIntegration" }` / `{ status: "failed"; reason }`）。

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| HTML ファイル、LLM 未連携 | 方針を決める | `passthrough`、`initialContent: { status: "processing" }` になる | |
| Markdown ファイル、LLM 連携済み | 方針を決める | `markdown` になる（LLM は使わない） | |
| Word ファイル、LLM 未連携 | 方針を決める | `textExtraction` になる | |
| Word ファイル、LLM 連携済み | 方針を決める | `textExtractionThenStructuring` になる | |
| テキスト層のある PDF、LLM 未連携 | 方針を決める | `textExtraction` になる | |
| テキスト層のない PDF、LLM 未連携 | 方針を決める | `unavailable(integrationRequired)`、`initialContent: { status: "awaitingIntegration" }` になる（`failed` にはならない） | |
| テキスト層のない PDF、LLM 連携済み | 方針を決める | `pageImageStructuring` になる | |
| 画像、LLM 未連携 | 方針を決める | `unavailable(integrationRequired)`、`initialContent: { status: "awaitingIntegration" }` になる | |
| 音声、LLM 連携済み | 方針を決める | `transcriptionThenStructuring` になる | |
| 未対応形式 | 方針を決める | `unavailable(unsupportedFormat)`、`initialContent: { status: "failed", reason: "unsupportedFormat" }` になる | |
| Word ファイル、LLM を使わない選択 | 方針を決める | `textExtraction` になる（`unavailable` と同じ方針） | |
| 画像、LLM を使わない選択 | 方針を決める | `unavailable(machineExtractionUnavailable)`、`initialContent: { status: "failed", reason: "machineExtractionUnavailable" }` になる（`awaitingIntegration` にはならない） | |
| テキスト層のない PDF / 音声、LLM を使わない選択 | 方針を決める | いずれも `unavailable(machineExtractionUnavailable)` と `initialContent: { status: "failed", reason: "machineExtractionUnavailable" }` になる | |
| 未対応形式、LLM を使わない選択 | 方針を決める | `unavailable(unsupportedFormat)` と `reason: "unsupportedFormat"` のまま（形式の未対応が優先する） | |
| パスワード保護された PDF | 方針を決める | `passwordProtected: true` と `initialContent: { status: "failed", reason: "passwordProtected" }` が返る | |
| パスワード保護された Word ファイル、LLM 連携済み（方針は `textExtractionThenStructuring`） | 方針を決める | 方針にかかわらず `initialContent` は `{ status: "failed", reason: "passwordProtected" }` になる（`initialContentFor` の結果より優先する） | |
| `failed` を返す 3 通りの入力（`machineExtractionUnavailable` / `unsupportedFormat` / `passwordProtected`） | 出力を比べる | いずれも `status: "failed"` だが `reason` で区別され、呼び出し側は理由を別経路で組み立てずに `Note.createFromUpload` の `initialContent` へそのまま渡せる | |
| いずれの入力でも | `initialContent` の形を確認する | 状態と理由が 1 つの値に閉じており、`failed` なのに理由が失われた状態を取れない | |
| OpenRouter 連携があり `conversionPreference: "machineOnly"` の取り込み | `storeUpload` から呼ぶ | `llm: "declined"` で呼ばれるため、Word ファイルは `textExtraction` になる（`conversionPreference` の解釈は呼び出し側の責務で、このユースケースは受け取らない） | |
| アップロード時の形式判定・方針決定 | 経路を確認する | `storeUpload` はこのユースケースを呼び、`FormatDetector` / `ConversionPlanner` を自前で呼ばない（経路は 1 本） | |
| 出力の `plan` / `initialContent` | 型を確認する | 転送境界を跨がないため、ドメインの判別ユニオンをそのまま返す（文字列へ平坦化しない） | |
| 判定処理が失敗する | 方針を決める | `SystemError(ExternalServiceError)` が投げられ、呼び出し側は `unsupported` として扱う | |
