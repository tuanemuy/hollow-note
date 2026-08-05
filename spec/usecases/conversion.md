# ユースケース: Conversion

ドメインの詳細は [domains/conversion.md](../domains/conversion.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

このドメインのユースケースは、いずれもジョブワーカーから呼ばれる。利用者の要求から直接呼ばれるものはない。

外部リソース（LLM / Drive）の実行主体はジョブの `requestedBy` である。Drive バックアップからの元ファイル取得のみ `BackupRecord.userId` の連携を使う（[ADR 010](../adr/010-anonymous-export-and-ticket.md)、[usecases/integration.md](./integration.md) の `fetchBackupForRegeneration`）。

run 系ユースケース（`runConversion` / `runRegeneration`）は [usecases/job.md](./job.md) の「run 系ワーカーの冪等規則」の判定 1〜4 に従う。冒頭ガード（判定 1〜3）は、終端状態なら何もせず返す。リース有効な `running` なら何もせず返す。それ以外は `Job.start` を保存して実行する（リース失効の `running` は引き継いで再開する。[ADR 012](../adr/012-job-execution-resilience.md)）。結果の保存が `ConflictError`（楽観ロック）になったときは判定 4 に従う — ジョブを読み直し、終端済み（実行中に外部から強制終端された）なら生成物を破棄して成功として返し、終端していなければ `ConflictError` を投げて再配送に委ねる。

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

1. `JobRepository.findById` で引き、冒頭の共通ガードに従って `Job.start(job, 1, now, leaseUntil)` を保存する
2. `NoteRepository.findById` でノートを引く。不在なら `Job.fail(reason: "targetMissing")` として終了する
3. `sourceFileId` から `StoredFileRepository.findById` でファイルを引く
4. `FileContentReader.readHead(sourceFileId, 8192)` で先頭バイト列を読み、手順 3 で引いた `StoredFile` の `fileName` / `mimeType` とともに `FormatDetector.detect` を呼んで形式を判定する（`requestRegeneration` の手順 4 と同じ読み方）。`passwordProtected` が真なら、方針の決定にも連携の解決にも進まず `Note.markConversionFailed(passwordProtected)` と `Job.fail("passwordProtected")` を保存して終了する（`planConversionForUpload` の手順 3 と同じ優先順位）。パスワード保護された PDF はテキスト層を読めないため `pdfWithoutText` と判定され、優先しないと取り込み直後に `failed(passwordProtected)` としたノートが変換後に `machineExtractionUnavailable` / `integrationRequired` へ化ける。P-13 は 3 つの理由で案内を分けているため、同じファイルで理由が入れ替わってはならない
5. `ConversionCapability` の `llm` を決める。`payload.conversionPreference === "machineOnly"` なら連携の有無にかかわらず `"declined"`（取り込み時の指定を引き継ぐ。[usecases/storage.md](./storage.md) の `storeUpload`）。それ以外は要求者（`requestedBy`）の OpenRouter 連携を引き、次の 3 分岐で決める（[domains/integration.md](../domains/integration.md) の `CredentialResolver`）
   - 連携の行がない（未連携）: `{ llm: "unavailable" }` として 6 へ進む（LLM 必須形式なら手順 7 の `integrationRequired` に至り、機械的変換で足りる形式はそのまま変換される）
   - `CredentialResolver.resolve` が `resolved`: `updated` が非 `null` なら、先にglobal D1のUoWで連携とeventを保存し、`{ llm: "available" }` として 6 へ進む
   - `resolve` が `reauthorizationRequired`（失効）: `expired` が非 `null` なら、先にglobal D1のUoWで連携と `integration.expired` を保存する。その後scope-local UoWで `Note.markConversionFailed(providerAuthFailed)` と `Job.fail("providerAuthFailed")` を保存して終了する。global保存とscope-local保存の間で停止しても再試行がexpired状態を読み直して同じ失敗へ収束する。未連携（`integrationRequired` / `awaitingIntegration`）と失効（`providerAuthFailed` / `failed`）で結果と案内が変わるため、`unavailable` に畳まない
6. `ConversionPlanner.plan(format, capability)` で方針を決める
7. 方針が `unavailable(integrationRequired)` なら `Note.markAwaitingIntegration` を保存し、`Job.fail(reason: "integrationRequired")` とする
8. 方針が `unavailable(machineExtractionUnavailable)` なら `Note.markConversionFailed(machineExtractionUnavailable)` を保存し、`Job.fail(reason: "machineExtractionUnavailable")` とする。利用者が LLM を使わないと決めた結果なので `markAwaitingIntegration` は呼ばず、連携ではなく `conversionPreference: "auto"` での取り込み直しを案内する
9. 方針が `unavailable(unsupportedFormat)` なら `Note.markConversionFailed(unsupportedFormat)` を保存し、`Job.fail` とする
10. `ConversionPlan.requiresLlm(plan)` が真なら `consumeLlmCall`（Usage）を呼ぶ。上限に達していれば `Note.markConversionFailed(quotaExceeded)` と `Job.fail("quotaExceeded")` として終了する。`storeUpload` / `startBulkUpload` の残量確認は受け付け時の事前検査にすぎず、消費はここでのみ行う（[usecases/usage.md](./usage.md) の `consumeLlmCall`）
11. `ConversionExecutor.execute` を呼ぶ
12. 成功なら `HtmlProcessor.process(rawHtml)`（Note）でサニタイズし、`hasDecoration` から `StyleMode` を決め、`Note.applyConversionResult` を保存する
13. 参照取り込みジョブを登録する。条件は 2 つで、`updateNoteBody`（[usecases/note.md](./note.md) の手順 8）と同じ規則に従う。
    - `HtmlProcessor.extractExternalReferences` の結果のうち `StorageUrlPolicy.isInternal`（[domains/storage.md](../domains/storage.md)）が偽のものが 1 件以上ある
    - 同じノートを対象とする未終端の `referenceImport` ジョブがない（`JobRepository.listActiveByTarget` を `kind === "referenceImport"` で絞る。`JobConcurrencyPolicy.ensureNoDuplicate` は使わない — 重複は利用者の誤りではないので例外にせず、登録を見送るだけにする）

    登録する場合は `Job.enqueue({ target: { type: "note", noteId }, payload: { kind: "referenceImport" }, scope, kind: "referenceImport", requestedBy, parentId: null })`。`scope` は手順 2 で引いたノートの所有文脈（`NoteOwner`）から導出し、`requestedBy` は変換ジョブの `requestedBy` を引き継ぐ。`parentId` は一括アップロードの子として動いている場合でも `null` にする（親の `total` は登録後に変えられないため、子を増やしてはならない）
14. `payload.requestedVisibility` が `private` 以外なら、公開ステータスを適用する。**`changeNoteVisibility` ユースケースは呼ばず、その手順 2〜4 をこの UoW の中で再現する**（下記「手順 14 は複製であって呼び出しではない」）。検査の基準は所有者であり、作成者（`createdBy`）ではない（[usecases/note.md](./note.md) の `changeNoteVisibility` 手順 2）。公開ハンドル／スラッグが未設定などで適用できない場合は非公開のまま残し、`JobNotice` の `{ kind: "visibilityNotApplied", requested, reason }` を組み立てて手順 15 に渡す（ジョブ自体は成功とする）
15. `Job.succeed(job, null, notices, now)` を保存する。`notices` は手順 14 が申し送りを作っていればその 1 件、なければ空配列である（[ADR 014](../adr/014-import-result-provenance.md)。従来この事実は「ジョブの `detail` に記録する」と書かれていたが、`detail` は `JobFailure` のフィールドであり成功したジョブは持てなかった）
16. 失敗なら `Note.markConversionFailed(reason)` と `Job.fail(reason, detail)` を保存する

ノートの更新とジョブの更新は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する。手順 10 の `consumeLlmCall`（Usage）はこの UoW を開く**前**に呼ぶ — `UnitOfWorkProvider.run` を入れ子にしないためで、消費が先に確定して変換が失敗しても戻さない設計（[usecases/usage.md](./usage.md) の「共通: UoW の境界」）とも整合する。

**手順 14 は複製であって呼び出しではない**。`changeNoteVisibility` を呼ぶ形にはできない。呼べば呼ばれた側が自分の `UnitOfWorkProvider.run` を開いて `run` が入れ子になり、本文の更新（手順 12）とは別のトランザクションで確定してしまう。さらに `changeNoteVisibility` は `expectedVersion` を要求するが、この経路が持つのは手順 12 で `Note.applyConversionResult` を適用したばかりの未保存のノートであり、渡せる版がない。本文と公開ステータスは 1 回の変換の結果として一緒に確定すべきものなので、手順 2〜4（所有者基準の公開ハンドル／スラッグ検査 → 休眠リンクがなければ [usecases/note.md](./note.md) の共通形式で NoteId locator 付きトークンを発行・保護 → `Note.makeUnlisted` / `makePublic` の適用）をこの UoW の中で再現する。手順 1 の権限確認は再現しない — 実行主体は利用者ではなくジョブであり、取り込み時の権限は `storeUpload` の手順 1 が既に確認している。

変換ジョブは `storeUpload` が受理したファイル 1 件につき必ず 1 件登録される（方針が `unavailable` でも省かない。[usecases/storage.md](./storage.md)）。7〜9 の分岐はその結果として通常経路であり、一括アップロードの親ジョブはここでの終端化によって進捗が進む。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート・ファイルが不在 | `Job.fail("targetMissing")` |
| `conversionPreference: "machineOnly"` で LLM 必須形式 | `Job.fail("machineExtractionUnavailable")` とし、ノートは `failed(machineExtractionUnavailable)` |
| 連携が失効（`CredentialResolver.resolve` が `reauthorizationRequired`） | `expired` はglobal D1で先に保存し、その後scope-localで `Job.fail("providerAuthFailed")` とノートの `failed(providerAuthFailed)` を保存する |
| LLM 実行回数の上限到達（サービス側。`consumeLlmCall`） | `Job.fail("quotaExceeded")` とし、ノートは `failed(quotaExceeded)` |
| モデルのレート制限・残高不足 | `Job.fail("quotaExceeded")` |
| 実行時間の超過 | `Job.fail("timeout")` |
| 破損・パスワード保護 | `Job.fail("corruptedFile")` / `Job.fail("passwordProtected")` とし、ノートは同じ理由の `failed`。パスワード保護は手順 4 の判定時点で確定し、方針の決定・連携の解決より優先する（取り込み時に付いた `failed(passwordProtected)` を別の理由に化けさせない） |
| 実行中に外部から強制終端された | ジョブ保存が `ConflictError` になる。読み直して終端済みなら生成物を破棄して成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる（run 系の共通規則の判定 4） |

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
3. `source === "localFile"` なら `sourceFileId` が非 `null` であることを確認し、`StoredFileRepository.findById` で元ファイルを引く。`driveBackup` なら `BackupRecordRepository.findByNoteAndFile` の存在を確認する。いずれも満たさなければ `ValidationError("NO_REGENERATION_SOURCE")`
4. `source === "localFile"` のときだけ、LLM 連携の事前確認を行う。`driveBackup` では行わない（下記）
   - `FileContentReader.readHead(sourceFileId, 8192)` で先頭バイト列を読み、手順 3 で引いた `StoredFile` の `fileName` / `mimeType` とともに `FormatDetector.detect` を呼ぶ
   - LLM が必要かは方針で判定する — `ConversionPlanner.plan(format, { llm: "unavailable" })` が `unavailable(integrationRequired)` を返す形式（テキスト層のない PDF・画像・音声）だけが LLM 必須である。`word` / `pdfWithText` のように連携がなくても `textExtraction` で取り込める形式は必須に数えない
   - LLM 必須なら `ExternalConnectionRepository.findByUserAndProvider(userId, "openrouter")` を引く。行がなければ `NotFoundError("CONNECTION_NOT_FOUND")`（未連携）、`ExpiredConnection` なら `BusinessRuleError(ReauthorizationRequired)`（失効）。`ActiveConnection` なら登録に進む
   - ここで `CredentialResolver.resolve` は呼ばない。登録に必要なのは「連携が今あるか」だけであり、トークンの更新と失効の確定（`markExpired` とその保存）は実行時に `runRegeneration` が行う。登録時に外部通信と連携の書き換えを持ち込まないため
   - 先頭バイト列を読めない（`NotFoundError("STORED_FILE_NOT_FOUND")`）・形式を判定できない（`SystemError(ExternalServiceError)`）場合は、確認を省いて登録に進む。確定判定は `runRegeneration` がやり直す（実体が失われていれば `Job.fail("targetMissing")` になる）ので、事前確認の失敗で要求は止めない
5. `JobConcurrencyPolicy.ensureNoDuplicate` で同じノートへの多重実行を防ぐ
6. `Job.enqueue({ target: { type: "note", noteId }, payload: { kind: "regeneration", source, instruction, modelOverride }, scope, kind: "regeneration", requestedBy: userId, parentId: null })` を保存する

`driveBackup` で事前確認を行わないのは、元ファイルがローカルにないためである。形式を判定するには記録所有者（`BackupRecord.userId`）の資格情報で Drive から内容を取る必要があり（`fetchBackupForRegeneration`）、`BackupRecord` は `external` / `checksum` しか持たないので形式の手がかりにならない。登録のたびに他人の連携を使ったネットワーク取得を走らせるのは要求の受け付けとして重すぎるため、この経路では連携の要否も含めて `runRegeneration` の手順 4〜7 に委ねる（未連携は `Job.fail("integrationRequired")`、失効は `Job.fail("providerAuthFailed")` として処理履歴に残り、P-13 と処理履歴が理由に応じた案内を出す。IN-07 の「LLM を要する変換なのに OpenRouter が未連携」の案内はこの経路になる）。

未連携（`CONNECTION_NOT_FOUND`）と失効（`ReauthorizationRequired`）を 1 つのエラーに畳まないのは、`ConversionCapability` を 3 値にしたのと同じ理由による — 未連携は「連携すれば取り込める」、失効は「再連携が要る」で案内が異なり、`runRegeneration` 側の `integrationRequired` / `providerAuthFailed` の区別とも対応する。どちらも Integration の語彙をそのまま使い（未連携を `NotFoundError("CONNECTION_NOT_FOUND")` とするのは `requestBackup` / `listAvailableModels` / `listDriveFolders` と同じ）、`ConversionErrorCode` に連携関連のコードは足さない。連携の有無を見るのはこのユースケース（アプリケーション層）であって Conversion ドメインではないため、[domains/index.md](../domains/index.md) の依存表に Conversion → Integration がないこととは矛盾しない。

`scope` は手順 1 で引いたノートの所有文脈（`NoteOwner`）から導出する（個人所有なら `{ type: "user", userId: owner.userId }`、ワークスペース所有なら `{ type: "workspace", workspaceId: owner.workspaceId }`。[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。要求者からは導かない — 参加ワークスペースのノートを再生成するジョブの `scope` は、要求者が誰であれ `workspace` になり、そのワークスペースの削除・除名でキャンセルされる。

実行前の版の保持は `runRegeneration` の中で行う（登録から実行までの間に本文が変わりうるため）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 元ファイルもバックアップもない | `ValidationError("NO_REGENERATION_SOURCE")` |
| `localFile` で LLM 必須形式なのに OpenRouter が未連携 | `NotFoundError("CONNECTION_NOT_FOUND")`（連携を促す） |
| `localFile` で LLM 必須形式なのに OpenRouter が失効 | `BusinessRuleError(ReauthorizationRequired)`（再連携を促す） |
| `localFile` で LLM を要さない形式（`html` / `markdown` / `word` など） | 連携を確認せず登録する |
| `driveBackup` で LLM 必須だが未連携・失効 | 登録時には検査せず、`runRegeneration` が `Job.fail("integrationRequired")` / `Job.fail("providerAuthFailed")` とする |
| 先頭バイト列の読み取り・形式判定の失敗 | 事前確認を省いて登録する（確定判定は `runRegeneration`） |
| 追加指示が長すぎる | `BusinessRuleError(InvalidInstruction)` |
| `modelOverride` が 1〜200 文字の範囲外（空文字列を含む） | `ValidationError("INVALID_MODEL_OVERRIDE")`（転送境界での入力検証） |
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

1. ジョブを引き、冒頭の共通ガードに従って `Job.start(job, 1, now, leaseUntil)` を保存する
2. ノートを引く。不在なら `Job.fail(reason: "targetMissing")` として終了する。本文が `ready` なら現在の内容から `NoteRevision.capture("regeneration")` を作って保存する
3. `source === "localFile"` なら `sourceFileId` から `StoredFileRepository.findById` でファイルを引く。`driveBackup` なら `fetchBackupForRegeneration`（Integration）で内容を取り出し、一時的な保管ファイルとして扱う。Drive からの取得は `BackupRecord.userId` の連携トークンで行われる（冒頭の規約。[ADR 010](../adr/010-anonymous-export-and-ticket.md)）
4. `FormatDetector.detect` で形式を判定する。渡す先頭バイト列は経路で分かれる — `source === "localFile"` なら `FileContentReader.readHead(sourceFileId, 8192)` の結果と手順 3 で引いた `StoredFile` の `fileName` / `mimeType`、`driveBackup` なら手順 3 で取り出した内容の先頭 8192 バイトと `fetchBackupForRegeneration` が返した `fileName` / `mimeType` を用いる（`requestRegeneration` の手順 4 と同じ読み方）。`passwordProtected` が真なら、連携の解決にも方針の決定にも進まず、本文を変更せず `Job.fail("passwordProtected")` を保存して終了する（`runConversion` の手順 4 と同じ優先順位。再生成では本文を保持するため `Note.markConversionFailed` は呼ばない）。優先しないと、パスワード保護された PDF はテキスト層を読めないため `pdfWithoutText` と判定されて LLM 経路に進み、手順 9 で `consumeLlmCall` を消費してから executor が落ちる（変換を実行する前に判明した失敗では消費しない。[usecases/usage.md](./usage.md) の `consumeLlmCall`）
5. 要求者（`requestedBy`）の OpenRouter 連携を引き、`runConversion` の手順 5 と同じ 3 分岐で `ConversionCapability` を決める（[domains/integration.md](../domains/integration.md) の `CredentialResolver`）
   - 連携の行がない（未連携）: `{ llm: "unavailable" }` として 6 へ進む（LLM 必須形式なら手順 7 の `integrationRequired` に至り、機械的変換で足りる形式はそのまま変換される）
   - `CredentialResolver.resolve` が `resolved`: `updated` が非 `null` なら、先にglobal D1のUoWで連携とeventを保存し、`{ llm: "available" }` として 6 へ進む
   - `resolve` が `reauthorizationRequired`（失効）: `expired` が非 `null` なら、先にglobal D1のUoWで連携と `integration.expired` を保存する。その後scope-local UoWで本文を変更せず `Job.fail("providerAuthFailed")` を保存して終了する（再生成では本文を保持するため `Note.markConversionFailed` は呼ばない）。途中停止は再試行で同じ状態へ収束する

   `"declined"` は再生成では起こらない（payload に `conversionPreference` がない）
6. `ConversionPlanner.plan(format, capability)` で方針を決める
7. 方針が `unavailable(integrationRequired)` なら、本文を変更せず `Job.fail(reason: "integrationRequired")` のみとする（`Note.markAwaitingIntegration` は初回変換専用であり、ここでは呼ばない）
8. 方針が `unavailable(unsupportedFormat)` なら、本文を変更せず `Job.fail(reason: "unsupportedFormat")` とする
9. `ConversionPlan.requiresLlm(plan)` が真なら `consumeLlmCall`（Usage）を呼ぶ。上限に達していれば本文を変更せず `Job.fail("quotaExceeded")` として終了する
10. `instruction` と `modelOverride` を載せた `ConversionInput` で `ConversionExecutor.execute` を呼ぶ。`modelOverride` は方針の構造化に使うフィールドだけを上書きする: `textExtractionThenStructuring` / `transcriptionThenStructuring` は `structuring` を、`pageImageStructuring` / `imageStructuring` は `vision` を置き換え、`transcription` は対象にしない（[domains/conversion.md](../domains/conversion.md)）
11. 成功なら `HtmlProcessor.process(rawHtml)`（Note）でサニタイズし、`hasDecoration` から `StyleMode` を決め、`Note.applyConversionResult` で本文を差し替えて保存する。本文が変わるのは成功時のみ
12. 参照取り込みジョブを登録する — `runConversion` の手順 13 と**条件も形も同じ**（内部を指さない参照が 1 件以上あり、かつ同じノートを対象とする未終端の `referenceImport` がないときに限り `Job.enqueue({ target: { type: "note", noteId }, payload: { kind: "referenceImport" }, scope, kind: "referenceImport", requestedBy, parentId: null })`。`scope` は手順 2 で引いたノートの所有文脈から導出し、`requestedBy` は再生成ジョブの `requestedBy` を引き継ぐ）
13. `Job.succeed(job, null, [], now)` を保存する（再生成は申し送りを持たない。公開ステータスの適用がないため）
14. 失敗した場合は本文を変更せず（`Note.markConversionFailed` を呼ばない）、`Job.fail(reason, detail)` のみを保存する

初回変換（`runConversion`）との違い: `markAwaitingIntegration` は使わない（初回変換専用）、公開ステータスの適用はない（regeneration の payload に `requestedVisibility` が存在しない）、`capability.llm` は `"declined"` を取らない（本人明示の再生成のため payload に `conversionPreference` が存在せず、`unavailable(machineExtractionUnavailable)` にも到達しない）、失敗しても本文は保持されジョブだけが `failed` になる（失効時の `providerAuthFailed` とパスワード保護時の `passwordProtected` も同じで、`Note.markConversionFailed` は呼ばない）。

ノートの更新とジョブの更新は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 元ファイルもバックアップもない | `Job.fail("targetMissing")` |
| Drive 上のファイルが削除・移動済み | `Job.fail("targetMissing")` |
| OpenRouter の連携なし・失効 | 連携なしは `Job.fail("integrationRequired")`、失効（`resolve` が `reauthorizationRequired`）はglobal D1へ `expired` を保存してからscope-localで `Job.fail("providerAuthFailed")`。どちらも本文は変更しない |
| 記録所有者の Drive 連携が解除・失効・退会済み（`driveBackup`） | `Job.fail("integrationRequired")` / `Job.fail("providerAuthFailed")`（記録所有者には再連携を、他のメンバーには自分の Drive への再バックアップを経た再生成を案内する。IN-07） |
| LLM 実行回数の上限到達（サービス側。`consumeLlmCall`） | 本文を維持したまま `Job.fail("quotaExceeded")` |
| パスワード保護 | 本文を維持したまま `Job.fail("passwordProtected")`。手順 4 の判定時点で確定し、連携の解決・方針の決定・`consumeLlmCall` より優先する（実行前に判明した失敗で LLM 実行回数を消費しない） |
| 変換の失敗 | 本文を維持したまま `Job.fail(reason)` |
| 実行中に外部から強制終端された | ジョブ保存が `ConflictError` になる。読み直して終端済みなら生成物（差し替え前に取得した変換結果）を破棄して成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる（run 系の共通規則の判定 4） |
| 追加指示が長すぎる | `BusinessRuleError(InvalidInstruction)`（ジョブ登録時に検査する） |

## planConversionForUpload

### 概要

アップロード時に、形式の判定と方針の決定だけを行う（`storeUpload` から呼ばれる）。

### 入力DTO

`fileName`, `declaredMimeType`, `head: Uint8Array`, `llm: "available" | "unavailable" | "declined"`（`ConversionCapability` の値。`conversionPreference` の解釈は呼び出し側の責務）

### 出力DTO

`format: SourceFormat`, `plan: ConversionPlan`, `requiresLlm: boolean`, `initialContent: InitialContentState`, `passwordProtected: boolean`

このユースケースは `storeUpload` からのみ呼ばれ転送境界を跨がないため、`plan` と `initialContent` はドメインの判別ユニオンをそのまま返す。`unavailable` の 3 つの理由（`integrationRequired` / `machineExtractionUnavailable` / `unsupportedFormat`）は `plan` に、本文としての帰結は `initialContent` に含まれるため、呼び出し側は理由を別経路で組み立てずに `Note.createFromUpload` の `initialContent` へ渡せる。

### 処理フロー

1. `FormatDetector.detect` を呼ぶ
2. `ConversionPlanner.plan(format, { llm })` を呼ぶ
3. `ConversionPlanner.initialContentFor(plan)` を呼ぶ。`passwordProtected` が真ならその結果より優先して `{ status: "failed", reason: "passwordProtected" }` を返す（形式判定の時点で本文を作れないことが確定しているため）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 判定処理の失敗 | `SystemError(ExternalServiceError)`（呼び出し側は `unsupported` として扱う） |
