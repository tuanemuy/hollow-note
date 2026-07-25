# Conversion

ファイルの形式を判定し、HTML 断片へ変換する。変換の実行は非同期ジョブとして呼ばれる（[ADR 005](../adr/005-async-processing.md)）。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| SourceFormat | 入力形式 | 変換元のファイルが属する種別 |
| ConversionPlan | 変換方針 | ある入力形式を、どの手段で HTML にするかの決定 |
| MechanicalStep | 機械的変換 | LLM を使わない抽出・変換 |
| StructuringStep | 構造化 | LLM によるテキスト・画像・音声からの HTML 生成 |
| ConversionOutcome | 変換結果 | 変換の成功・失敗と、その内容 |

## 値オブジェクト

### SourceFormat

- **フィールド**: `value: "html" | "markdown" | "plainText" | "word" | "excel" | "powerPoint" | "pdfWithText" | "pdfWithoutText" | "image" | "audio" | "unsupported"`
- **生成**: `FormatDetector` ポートの結果からのみ構築する

### ConversionCapability

- **フィールド**: `llmAvailable: boolean`
- 変換方針の決定に必要な、外部連携の有無だけを表す。Integration ドメインの詳細は持ち込まない

### ConversionPlan

```
ConversionPlan =
  | { kind: "passthrough" }                                        // HTML をそのまま（サニタイズのみ）
  | { kind: "markdown" }                                           // Markdown → HTML
  | { kind: "textExtraction" }                                     // テキスト抽出のみ
  | { kind: "textExtractionThenStructuring" }                      // テキスト抽出 → LLM 構造化
  | { kind: "pageImageStructuring" }                                // ページ画像 → LLM 構造化
  | { kind: "imageStructuring" }                                   // 画像 → LLM 構造化
  | { kind: "transcriptionThenStructuring" }                        // 音声認識 → LLM 構造化
  | { kind: "unavailable"; reason: "integrationRequired" | "unsupportedFormat" }
```

- **補助**: `ConversionPlan.requiresLlm(plan): boolean`

### ConversionInstruction

- **フィールド**: `value: string`
- **バリデーション**: 2000 文字以内。空文字列を許す。IM-06 の追加指示に使う

### ConversionFailureReason

- **フィールド**: `value: "unsupportedFormat" | "corruptedFile" | "integrationRequired" | "providerAuthFailed" | "modelError" | "quotaExceeded" | "timeout" | "sizeExceeded" | "passwordProtected" | "unknown"`
- **バリデーション**: 既知の値のみ
- 利用者に説明できる語彙に限る。Note の `content.status = "failed"` と Job の失敗記録が同じ語彙を共有するため、ここを唯一の定義とする

### TranscriptText

- **フィールド**: `value: string`
- **バリデーション**: 空でないこと

## エンティティ

このドメインは状態を永続化しない。変換の履歴と進捗は Job ドメイン、成果物は Note / Storage が持つ。ここには方針の決定と実行だけがある。

## ドメインサービス

### ConversionPlanner

**責務**: 入力形式と連携状況から、変換方針を決める。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `plan` | `format: SourceFormat, capability: ConversionCapability` | `ConversionPlan` | 下表に従う |
| `initialContentStatusFor` | `plan: ConversionPlan` | `"processing" \| "awaitingIntegration" \| "failed"` | ノート作成時の本文状態を決める。`unavailable(integrationRequired)` は `awaitingIntegration`、`unavailable(unsupportedFormat)` は `failed`、それ以外は `processing` |

| 入力形式 | LLM なし | LLM あり |
| --- | --- | --- |
| `html` | `passthrough` | `passthrough` |
| `markdown` | `markdown` | `markdown` |
| `plainText` / `word` / `excel` / `powerPoint` | `textExtraction` | `textExtractionThenStructuring` |
| `pdfWithText` | `textExtraction` | `textExtractionThenStructuring` |
| `pdfWithoutText` | `unavailable(integrationRequired)` | `pageImageStructuring` |
| `image` | `unavailable(integrationRequired)` | `imageStructuring` |
| `audio` | `unavailable(integrationRequired)` | `transcriptionThenStructuring` |
| `unsupported` | `unavailable(unsupportedFormat)` | `unavailable(unsupportedFormat)` |

**依存するポート**: なし

### ConversionExecutor

**責務**: 決まった方針に従って変換を実行し、HTML 断片を返す。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `execute` | `input: ConversionInput` | `Promise<ConversionOutcome>` | 方針ごとに下記のポートを順に呼ぶ |

```
ConversionInput = Readonly<{
  plan: ConversionPlan;
  source: { fileId: StoredFileId; fileName: FileName; mimeType: MimeType; size: ByteSize };
  models: ConversionModels | null;          // LLM を要する方針では必須
  instruction: ConversionInstruction | null;
}>;

ConversionModels = Readonly<{
  structuring: string;      // 文書構造化用のモデル識別子
  vision: string;           // 画像解析用
  transcription: string;    // 音声認識用
}>;

ConversionOutcome =
  | { kind: "succeeded"; rawHtml: string; suggestedTitle: string | null; usedLlm: boolean }
  | { kind: "failed"; reason: ConversionFailureReason; detail: string };
```

方針ごとの手順:

| 方針 | 手順 |
| --- | --- |
| `passthrough` | `FileContentReader.readText` → そのまま `rawHtml` |
| `markdown` | `FileContentReader.readText` → `MarkdownRenderer.render` |
| `textExtraction` | `DocumentTextExtractor.extract` → 段落を `<p>` に包んだ素朴な HTML |
| `textExtractionThenStructuring` | `DocumentTextExtractor.extract` → `StructuringModel.structureText` |
| `pageImageStructuring` | `DocumentTextExtractor.renderPages` → `StructuringModel.structureImages` |
| `imageStructuring` | `FileContentReader.readBytes` → `StructuringModel.structureImages` |
| `transcriptionThenStructuring` | `TranscriptionModel.transcribe` → `StructuringModel.structureText` |
| `unavailable` | 実行せず `failed` を返す |

失敗の分類:

| 例外 | `reason` |
| --- | --- |
| 読み取り不能・パース失敗 | `corruptedFile` |
| パスワード保護の検出 | `passwordProtected` |
| LLM の認証失敗 | `providerAuthFailed` |
| LLM のレート制限・残高不足 | `quotaExceeded` |
| LLM のその他のエラー | `modelError` |
| 実行時間の超過 | `timeout` |
| 入力サイズの超過 | `sizeExceeded` |
| 上記以外 | `unknown` |

**依存するポート**: `FileContentReader`, `MarkdownRenderer`, `DocumentTextExtractor`, `StructuringModel`, `TranscriptionModel`

## ポート

### FormatDetector

**目的**: ファイルの内容と申告された MIME から入力形式を判定する。拡張子より内容を優先する。

```ts
interface FormatDetector {
  detect(params: { fileName: FileName; declaredMimeType: MimeType; head: Uint8Array }): Promise<FormatDetection>;
}

type FormatDetection = Readonly<{
  format: SourceFormat;
  detectedMimeType: MimeType;
  passwordProtected: boolean;
}>;
```

PDF については、テキスト層の有無を調べて `pdfWithText` / `pdfWithoutText` を返し分ける。

**エラーケース**: `SystemError(ExternalServiceError)`（判定処理の失敗）

### FileContentReader

**目的**: 保管ファイルの内容を読む。Storage の実装がこのポートを満たす。

```ts
interface FileContentReader {
  readBytes(fileId: StoredFileId): Promise<Uint8Array>;
  readText(fileId: StoredFileId, encoding: string | null): Promise<string>;
  readHead(fileId: StoredFileId, bytes: number): Promise<Uint8Array>;
}
```

`encoding` が `null` のときは内容から推定する。

**エラーケース**: `NotFoundError("STORED_FILE_NOT_FOUND")`、`SystemError(ExternalServiceError)`

### MarkdownRenderer

```ts
interface MarkdownRenderer {
  render(markdown: string): string;                 // HTML 断片を返す
  toMarkdown(html: string): string;                 // 書き出し（EX-01）で使う逆方向
}
```

`toMarkdown` は表現できない要素を HTML のまま残す。

**エラーケース**: `SystemError(ExternalServiceError)`

### DocumentTextExtractor

```ts
interface DocumentTextExtractor {
  extract(params: { bytes: Uint8Array; format: SourceFormat }): Promise<ExtractedDocument>;
  renderPages(params: { bytes: Uint8Array; maxPages: number; dpi: number }): Promise<readonly PageImage[]>;
}

type ExtractedDocument = Readonly<{
  blocks: readonly TextBlock[];
  title: string | null;
}>;

type TextBlock = Readonly<{ kind: "paragraph" | "heading" | "listItem" | "tableRow"; level: number; text: string }>;
type PageImage = Readonly<{ pageNumber: number; bytes: Uint8Array; mimeType: MimeType }>;
```

**エラーケース**: `ValidationError("DOCUMENT_PASSWORD_PROTECTED")`、`ValidationError("DOCUMENT_CORRUPTED")`、`SystemError(ExternalServiceError)`

### StructuringModel

**目的**: LLM に構造化を依頼する。実装は Integration が保持する資格情報を使う。

```ts
interface StructuringModel {
  structureText(params: StructureTextParams): Promise<StructuringResult>;
  structureImages(params: StructureImagesParams): Promise<StructuringResult>;
}

type StructureTextParams = Readonly<{
  credential: LlmCredential;
  model: string;
  blocks: readonly TextBlock[];
  instruction: ConversionInstruction | null;
}>;

type StructureImagesParams = Readonly<{
  credential: LlmCredential;
  model: string;
  images: readonly PageImage[];
  instruction: ConversionInstruction | null;
}>;

type StructuringResult = Readonly<{ rawHtml: string; suggestedTitle: string | null }>;
type LlmCredential = Readonly<{ apiKey: string }>;
```

`LlmCredential` は Conversion が定義する最小の形。鍵の保管・復号・失効の判断は Integration の責務であり、ユースケースが解決して渡す。

**エラーケース**: `ValidationError("LLM_AUTH_FAILED")`、`ValidationError("LLM_QUOTA_EXCEEDED")`、`ValidationError("LLM_MODEL_UNAVAILABLE")`、`SystemError(ExternalServiceError)`、`SystemError(TimeoutError)`

### TranscriptionModel

```ts
interface TranscriptionModel {
  transcribe(params: { credential: LlmCredential; model: string; audio: Uint8Array; mimeType: MimeType }): Promise<TranscriptText>;
}
```

**エラーケース**: `StructuringModel` と同じ分類

## ドメインイベント

このドメインは永続状態を持たないため、独自のイベントを発行しない。変換の結果は Note と Job のイベントとして現れる。

## エラーコード

```
ConversionErrorCode =
  | "InvalidInstruction" | "InvalidFormat" | "ModelsRequired" | "EmptyTranscript"
```

`ModelsRequired` は、LLM を要する方針なのに `models` が `null` で `ConversionExecutor.execute` が呼ばれた場合に投げる。

## ユースケース（概要）

`planConversionForUpload`, `runConversion`, `requestRegeneration`, `runRegeneration`

詳細は [usecases/conversion.md](../usecases/conversion.md)。
