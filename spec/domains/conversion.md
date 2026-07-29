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

- **フィールド**: `llm: "available" | "unavailable" | "declined"`
- `available` は要求者の LLM 連携が使える、`unavailable` は連携がない、`declined` は利用者が `conversionPreference: "machineOnly"` を選んで LLM 構造化を使わないと決めた状態
- 失効した連携は方針決定の入力にしない。資格情報を解決した時点で失効が判明するため、呼び出し側は方針を決めずに `providerAuthFailed` として失敗させる（[usecases/conversion.md](../usecases/conversion.md) の `runConversion` 手順 5）。「連携すれば取り込める」保留（`awaitingIntegration`）と「再連携が要る」失敗は案内が異なるため、`unavailable` に畳まない。ジョブ登録時の事前確認（`requestRegeneration`）でも同じ区別を保ち、未連携と失効を 1 つのエラーに畳まない
- 「使えない」と「使わないと決めた」を分けるのは、LLM を要する形式が来たときの結果と案内が異なるため（前者は連携を促す `awaitingIntegration`、後者は方針の変更を促す `failed(machineExtractionUnavailable)`）。連携済みの利用者が `machineOnly` を選ぶ場合もあるため、真偽値 1 つでは表現できない
- 変換方針の決定に必要な情報だけを表す。Integration ドメインの詳細は持ち込まない

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
  | { kind: "unavailable"; reason: "integrationRequired" | "machineExtractionUnavailable" | "unsupportedFormat" }
```

- **補助**: `ConversionPlan.requiresLlm(plan): boolean`

### ConversionInstruction

- **フィールド**: `value: string`
- **バリデーション**: 2000 文字以内。空文字列を許す。IM-06 の追加指示に使う

### ConversionFailureReason

- **フィールド**: `value: "unsupportedFormat" | "corruptedFile" | "integrationRequired" | "machineExtractionUnavailable" | "providerAuthFailed" | "modelError" | "quotaExceeded" | "timeout" | "sizeExceeded" | "passwordProtected" | "unknown"`
- **バリデーション**: 既知の値のみ
- 利用者に説明できる語彙に限る。Note の `content.status = "failed"` と Job の失敗記録が同じ語彙を共有するため、ここを唯一の定義とする
- `integrationRequired` は Job の失敗理由としてのみ現れる。Note 本文の `failed` はこの値を取らない（未連携は本文では `awaitingIntegration` として表す。[note.md](./note.md)）
- `machineExtractionUnavailable` は `capability.llm === "declined"` の取り込みで LLM 必須形式（テキスト層のない PDF・画像・音声）が来た場合にのみ現れる。利用者が LLM を使わないと決めた結果なので、連携を促す `awaitingIntegration` ではなく Note 本文の `failed` に入る

### InitialContentState

```
InitialContentState =
  | { status: "processing" }
  | { status: "awaitingIntegration" }
  | { status: "failed"; reason: Extract<ConversionFailureReason, "machineExtractionUnavailable" | "unsupportedFormat" | "passwordProtected"> }
```

取り込み時にノートへ与える本文の初期値。Note の `NoteContent` から `ready` を除いた部分と構造的に一致し、`Note.createFromUpload` の `initialContent` にそのまま渡せる（Note → Conversion の依存方向は [index.md](./index.md) のとおり）。状態と理由を 1 つの値に閉じ込めることで、`failed` なのに理由が失われた状態を表現できなくする。

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
| `initialContentFor` | `plan: ConversionPlan` | `InitialContentState` | ノート作成時の本文の初期値を決める。`unavailable(integrationRequired)` は `{ status: "awaitingIntegration" }`、`unavailable(machineExtractionUnavailable)` / `unavailable(unsupportedFormat)` は同じ理由を載せた `{ status: "failed"; reason }`、それ以外は `{ status: "processing" }`。状態と理由を同時に返すため、呼び出し側が理由を別経路で持ち回る必要がない |

| 入力形式 | `llm: "declined"` | `llm: "unavailable"` | `llm: "available"` |
| --- | --- | --- | --- |
| `html` | `passthrough` | `passthrough` | `passthrough` |
| `markdown` | `markdown` | `markdown` | `markdown` |
| `plainText` / `word` / `excel` / `powerPoint` | `textExtraction` | `textExtraction` | `textExtractionThenStructuring` |
| `pdfWithText` | `textExtraction` | `textExtraction` | `textExtractionThenStructuring` |
| `pdfWithoutText` | `unavailable(machineExtractionUnavailable)` | `unavailable(integrationRequired)` | `pageImageStructuring` |
| `image` | `unavailable(machineExtractionUnavailable)` | `unavailable(integrationRequired)` | `imageStructuring` |
| `audio` | `unavailable(machineExtractionUnavailable)` | `unavailable(integrationRequired)` | `transcriptionThenStructuring` |
| `unsupported` | `unavailable(unsupportedFormat)` | `unavailable(unsupportedFormat)` | `unavailable(unsupportedFormat)` |

`declined` と `unavailable` は、機械的変換で取り込める形式では同じ方針になる。分かれるのは LLM 必須形式のときだけで、`declined` は「利用者が選んだ方針では取り込めない」ため失敗として確定し、`unavailable` は「連携すれば取り込める」ため保留（`awaitingIntegration`）になる。

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
| `textExtractionThenStructuring` | `DocumentTextExtractor.extract` → `StructuringModel.structureText`（`models.structuring`） |
| `pageImageStructuring` | `DocumentTextExtractor.renderPages` → `StructuringModel.structureImages`（`models.vision`） |
| `imageStructuring` | `FileContentReader.readBytes` → `StructuringModel.structureImages`（`models.vision`） |
| `transcriptionThenStructuring` | `TranscriptionModel.transcribe`（`models.transcription`）→ `StructuringModel.structureText`（`models.structuring`） |
| `unavailable` | 実行せず `failed` を返す |

LLM を呼ぶ手順は、表中の括弧に示した `models` のフィールドのモデルを使う。再生成（`runRegeneration`）の `modelOverride` は、方針の構造化に使うフィールドだけを上書きする: `textExtractionThenStructuring` / `transcriptionThenStructuring` は `structuring` を、`pageImageStructuring` / `imageStructuring` は `vision` を置き換える。`transcription` は上書きの対象にしない（音声認識モデルは IN-02 の設定に従う）。

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

連携の未接続・失効を表すコードはここに持たない。それらは Integration の語彙（未連携は `NotFoundError("CONNECTION_NOT_FOUND")`、失効は `IntegrationErrorCode.ReauthorizationRequired`）で表し、判断するのは両ドメインを束ねるユースケース層である（[usecases/conversion.md](../usecases/conversion.md) の `requestRegeneration`）。Conversion ドメイン自体は連携の存在を知らず、`ConversionCapability` という値としてだけ受け取る（[index.md](./index.md) の依存方向）。

## ユースケース（概要）

`planConversionForUpload`, `runConversion`, `requestRegeneration`, `runRegeneration`

詳細は [usecases/conversion.md](../usecases/conversion.md)。
