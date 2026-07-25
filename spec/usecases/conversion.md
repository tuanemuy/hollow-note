# ユースケース: Conversion

ドメインの詳細は [domains/conversion.md](../domains/conversion.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

このドメインのユースケースは、いずれもジョブワーカーから呼ばれる。利用者の要求から直接呼ばれるものはない。

## runConversion

### 概要

変換ジョブの本体。ファイルを HTML に変換してノートの本文にする（IM-01 / IM-02 / IM-03）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `jobId` | `string` | ○ | — |
| `noteId` | `string` | ○ | — |

### 出力DTO

`noteId`, `outcome: "succeeded" | "failed"`, `failureReason: string | null`

### 処理フロー

1. `JobRepository.findById` で引く。終端状態なら何もせず返す（同じジョブを 2 回受け取っても結果が変わらない）
2. `Job.start(job, 1, now)` を保存する
3. `NoteRepository.findById` でノートを引く。不在なら `Job.fail(reason: "targetMissing")` として終了する
4. `sourceFileId` から `StoredFileRepository.findById` でファイルを引く
5. `FormatDetector.detect` で形式を判定する
6. 実行者の OpenRouter 連携を引き、`CredentialResolver.resolve` で資格情報を得る。連携がなければ `ConversionCapability { llmAvailable: false }` とする
7. `ConversionPlanner.plan(format, capability)` で方針を決める
8. 方針が `unavailable(integrationRequired)` なら `Note.markAwaitingIntegration` を保存し、`Job.fail(reason: "integrationRequired")` とする
9. 方針が `unavailable(unsupportedFormat)` なら `Note.markConversionFailed(unsupportedFormat)` を保存し、`Job.fail` とする
10. `ConversionPlan.requiresLlm(plan)` が真なら `consumeLlmCall`（Usage）を呼ぶ。上限に達していれば `Note.markConversionFailed(quotaExceeded)` として終了する
11. `ConversionExecutor.execute` を呼ぶ
12. 成功なら `HtmlProcessor.process(rawHtml)`（Note）でサニタイズし、`hasDecoration` から `StyleMode` を決め、`Note.applyConversionResult` を保存する
13. 外部参照があれば参照取り込みジョブ（`referenceImport`）を登録する
14. `payload.requestedVisibility` が `private` 以外なら、`changeNoteVisibility` と同じ手順で公開ステータスを適用する。公開ハンドル／スラッグが未設定などで適用できない場合は非公開のまま残し、その旨をジョブの `detail` に記録する（ジョブ自体は成功とする）
15. `Job.succeed` を保存する
16. 失敗なら `Note.markConversionFailed(reason)` と `Job.fail(reason, detail)` を保存する

ノートの更新とジョブの更新は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート・ファイルが不在 | `Job.fail("targetMissing")` |
| 連携が失効 | `Job.fail("providerAuthFailed")` とし、ノートは `failed(providerAuthFailed)` |
| モデルのレート制限・残高不足 | `Job.fail("quotaExceeded")` |
| 実行時間の超過 | `Job.fail("timeout")` |
| 破損・パスワード保護 | `Job.fail("corruptedFile")` / `Job.fail("passwordProtected")` |
| ジョブ更新時の版の競合 | `ConflictError` を投げて再配送に委ねる |

## requestRegeneration

### 概要

ノートの再生成をジョブとして登録する（IM-06 / IN-07）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `noteId` | `string` | ○ | — |
| `source` | `"localFile" \| "driveBackup"` | ○ | 既知の値 |
| `instruction` | `string \| null` | — | `ConversionInstruction` の規則（2000 文字以内） |
| `modelOverride` | `string \| null` | — | 1〜200 文字 |

### 出力DTO

`jobId: string`, `revisionKept: boolean`

### 処理フロー

1. ノートを引き、`NoteAccessPolicy` で `canEdit` を確認する。`TrashedNote` なら `BusinessRuleError(NoteIsTrashed)`
2. `ConversionInstruction.create` で追加指示を検証する
3. `source === "localFile"` なら `sourceFileId` が非 `null` であることを確認する。`driveBackup` なら `BackupRecordRepository.findByNoteAndFile` の存在を確認する
4. 形式から LLM が必要かを判定し、必要なら OpenRouter の連携が `active` であることを確認する
5. `JobConcurrencyPolicy.ensureNoDuplicate` で同じノートへの多重実行を防ぐ
6. `Job.enqueue(kind: "regeneration", target: { type: "note", noteId }, payload)` を保存する

実行前の版の保持は `runRegeneration` の中で行う（登録から実行までの間に本文が変わりうるため）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 元ファイルもバックアップもない | `ValidationError("NO_REGENERATION_SOURCE")` |
| 連携なし・失効 | `BusinessRuleError(ReauthorizationRequired)` |
| 追加指示が長すぎる | `BusinessRuleError(InvalidInstruction)` |
| 同じノートの再生成が実行中 | `BusinessRuleError(DuplicateJob)` |

## runRegeneration

### 概要

既存のノートを、元ファイルまたは Drive バックアップから作り直す（IM-06 / IN-07）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `jobId` | `string` | ○ | — |
| `noteId` | `string` | ○ | — |
| `source` | `"localFile" \| "driveBackup"` | ○ | 既知の値 |
| `instruction` | `string \| null` | — | `ConversionInstruction` の規則 |
| `modelOverride` | `string \| null` | — | 1〜200 文字 |

### 出力DTO

`noteId`, `outcome`, `revisionId: string | null`

### 処理フロー

1. ジョブを引き、終端状態なら何もせず返す。`Job.start` を保存する
2. ノートを引く。本文が `ready` なら現在の内容から `NoteRevision.capture("regeneration")` を作って保存する
3. `source === "driveBackup"` なら `fetchBackupForRegeneration`（Integration）で内容を取り出し、一時的な保管ファイルとして扱う。`localFile` なら `sourceFileId` を使う
4. 以降は `runConversion` の 5〜15 と同じ。ただし `instruction` と `modelOverride` を `ConversionInput` に載せる
5. 失敗した場合は本文を変更しない（`Note.markConversionFailed` を呼ばない）。ジョブだけが `failed` になる

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 元ファイルもバックアップもない | `Job.fail("targetMissing")` |
| Drive 上のファイルが削除・移動済み | `Job.fail("targetMissing")` |
| 連携なし・失効 | `Job.fail("integrationRequired")` / `Job.fail("providerAuthFailed")` |
| 変換の失敗 | 本文を維持したまま `Job.fail(reason)` |
| 追加指示が長すぎる | `BusinessRuleError(InvalidInstruction)`（ジョブ登録時に検査する） |

## planConversionForUpload

### 概要

アップロード時に、形式の判定と方針の決定だけを行う（`storeUpload` から呼ばれる）。

### 入力DTO

`fileName`, `declaredMimeType`, `head: Uint8Array`, `llmAvailable: boolean`

### 出力DTO

`format: string`, `plan: string`, `requiresLlm: boolean`, `initialContentStatus: string`, `passwordProtected: boolean`

### 処理フロー

1. `FormatDetector.detect` を呼ぶ
2. `ConversionPlanner.plan(format, { llmAvailable })` を呼ぶ
3. `ConversionPlanner.initialContentStatusFor(plan)` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 判定処理の失敗 | `SystemError(ExternalServiceError)`（呼び出し側は `unsupported` として扱う） |
