# Inventory — test

生成元: `spec/testcases/`（最終同期: 2026-08-24）

**1 行 = 1 テストケース**。`spec/testcases/*/*.md` の表に TC ID は書かれておらず、ID は本ファイルの行が持つ。**新規テストケースには各ドメイン群の末尾に採番し、ファイル名の辞書順の位置に挿入しない（ID は行位置ではない）**（[ADR 052](../adr/052-adapter-inventory-granularity.md)）。TC ID をテストコードの `it` 名に書くことは推奨するが要求しない（[ADR 058](../adr/058-ledger-id-callout-scope.md)）。

| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |
|----|------|---------|------------------------------|
| TC-conversion-001 | planConversionForUpload: HTML ファイル、LLM 未連携 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `passthrough`、`initialContent: { status: "processing" }` になる |
| TC-conversion-002 | planConversionForUpload: Markdown ファイル、LLM 連携済み — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `markdown` になる（LLM は使わない） |
| TC-conversion-003 | planConversionForUpload: Word ファイル、LLM 未連携 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `textExtraction` になる |
| TC-conversion-004 | planConversionForUpload: Word ファイル、LLM 連携済み — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `textExtractionThenStructuring` になる |
| TC-conversion-005 | planConversionForUpload: テキスト層のある PDF、LLM 未連携 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `textExtraction` になる |
| TC-conversion-006 | planConversionForUpload: テキスト層のない PDF、LLM 未連携 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `unavailable(integrationRequired)`、`initialContent: { status: "awaitingIntegration" }` になる（`failed` にはならない） |
| TC-conversion-007 | planConversionForUpload: テキスト層のない PDF、LLM 連携済み — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `pageImageStructuring` になる |
| TC-conversion-008 | planConversionForUpload: 画像、LLM 未連携 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `unavailable(integrationRequired)`、`initialContent: { status: "awaitingIntegration" }` になる |
| TC-conversion-009 | planConversionForUpload: 音声、LLM 連携済み — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `transcriptionThenStructuring` になる |
| TC-conversion-010 | planConversionForUpload: 未対応形式 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `unavailable(unsupportedFormat)`、`initialContent: { status: "failed", reason: "unsupportedFormat" }` になる |
| TC-conversion-011 | planConversionForUpload: Word ファイル、LLM を使わない選択 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `textExtraction` になる（`unavailable` と同じ方針） |
| TC-conversion-012 | planConversionForUpload: 画像、LLM を使わない選択 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `unavailable(machineExtractionUnavailable)`、`initialContent: { status: "failed", reason: "machineExtractionUnavailable" }` になる（`awaitingIntegration` にはならない） |
| TC-conversion-013 | planConversionForUpload: テキスト層のない PDF / 音声、LLM を使わない選択 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | いずれも `unavailable(machineExtractionUnavailable)` と `initialContent: { status: "failed", reason: "machineExtractionUnavailable" }` になる |
| TC-conversion-014 | planConversionForUpload: 未対応形式、LLM を使わない選択 — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `unavailable(unsupportedFormat)` と `reason: "unsupportedFormat"` のまま（形式の未対応が優先する） |
| TC-conversion-015 | planConversionForUpload: パスワード保護された PDF — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `passwordProtected: true` と `initialContent: { status: "failed", reason: "passwordProtected" }` が返る |
| TC-conversion-016 | planConversionForUpload: パスワード保護された Word ファイル、LLM 連携済み（方針は `textExtractionThenStructuring`） — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | 方針にかかわらず `initialContent` は `{ status: "failed", reason: "passwordProtected" }` になる（`initialContentFor` の結果より優先する） |
| TC-conversion-017 | planConversionForUpload: `failed` を返す 3 通りの入力（`machineExtractionUnavailable` / `unsupportedFormat` / `passwordProtected`） — 出力を比べる | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | いずれも `status: "failed"` だが `reason` で区別され、呼び出し側は理由を別経路で組み立てずに `Note.createFromUpload` の `initialContent` へそのまま渡せる |
| TC-conversion-018 | planConversionForUpload: いずれの入力でも — `initialContent` の形を確認する | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | 状態と理由が 1 つの値に閉じており、`failed` なのに理由が失われた状態を取れない |
| TC-conversion-019 | planConversionForUpload: OpenRouter 連携があり `conversionPreference: "machineOnly"` の取り込み — `storeUpload` から呼ぶ | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `llm: "declined"` で呼ばれるため、Word ファイルは `textExtraction` になる（`conversionPreference` の解釈は呼び出し側の責務で、このユースケースは受け取らない） |
| TC-conversion-020 | planConversionForUpload: アップロード時の形式判定・方針決定 — 経路を確認する | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `storeUpload` はこのユースケースを呼び、`FormatDetector` / `ConversionPlanner` を自前で呼ばない（経路は 1 本） |
| TC-conversion-021 | planConversionForUpload: 出力の `plan` / `initialContent` — 型を確認する | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | 転送境界を跨がないため、ドメインの判別ユニオンをそのまま返す（文字列へ平坦化しない） |
| TC-conversion-022 | planConversionForUpload: 判定処理が失敗する — 方針を決める | spec/testcases/conversion/planConversionForUpload.md#テストケース-planconversionforupload | `SystemError(ExternalServiceError)` が投げられ、呼び出し側は `unsupported` として扱う |
| TC-conversion-023 | requestRegeneration: 元ファイルがあり LLM 連携済み — `localFile` で要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 再生成ジョブが登録される |
| TC-conversion-024 | requestRegeneration: Drive バックアップがある — `driveBackup` で要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 再生成ジョブが登録される |
| TC-conversion-025 | requestRegeneration: 元ファイルもバックアップもない — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `ValidationError("NO_REGENERATION_SOURCE")` が投げられる |
| TC-conversion-026 | requestRegeneration: `localFile` で LLM 必須形式（テキスト層のない PDF・画像・音声）、OpenRouter の連携の行がない — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる（未連携。連携を促す） |
| TC-conversion-027 | requestRegeneration: `localFile` で LLM 必須形式、OpenRouter が `ExpiredConnection` — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `BusinessRuleError(ReauthorizationRequired)` が投げられる（失効。再連携を促す） |
| TC-conversion-028 | requestRegeneration: 未連携と失効を比べる — それぞれ要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 1 つのエラーに畳まれず、`ConversionCapability` の 3 値化と同じ理由で案内が分かれる（`runRegeneration` 側の `integrationRequired` / `providerAuthFailed` の区別と対応する） |
| TC-conversion-029 | requestRegeneration: `localFile` で LLM 必須形式、OpenRouter が `ActiveConnection` — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 登録に進む |
| TC-conversion-030 | requestRegeneration: `localFile` で LLM を要さない形式（`html` / `markdown` / `word` / `pdfWithText` など）、OpenRouter 未連携 — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 連携を確認せず登録される（`ConversionPlanner.plan(format, { llm: "unavailable" })` が `unavailable(integrationRequired)` を返す形式だけを LLM 必須に数える） |
| TC-conversion-031 | requestRegeneration: `localFile` の事前確認 — 呼び出しを確認する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `FileContentReader.readHead(sourceFileId, 8192)` と手順 3 の `StoredFile` の `fileName` / `mimeType` で `FormatDetector.detect` を呼ぶ。`CredentialResolver.resolve` は呼ばない（トークンの更新と失効の確定は実行時の `runRegeneration` が行う） |
| TC-conversion-032 | requestRegeneration: `readHead` が `NotFoundError("STORED_FILE_NOT_FOUND")` になる — `localFile` で要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 事前確認を省いて登録に進む（確定判定は `runRegeneration` がやり直し、実体が失われていれば `Job.fail("targetMissing")` になる） |
| TC-conversion-033 | requestRegeneration: `FormatDetector.detect` が `SystemError(ExternalServiceError)` になる — `localFile` で要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 同じく事前確認を省いて登録に進む（事前確認の失敗で要求は止めない） |
| TC-conversion-034 | requestRegeneration: `driveBackup` で LLM 必須だが OpenRouter 未連携 — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 登録時には検査せず登録され、実行時に `runRegeneration` が `Job.fail("integrationRequired")` とする |
| TC-conversion-035 | requestRegeneration: `driveBackup` で OpenRouter が失効している — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 同じく登録され、実行時に `Job.fail("providerAuthFailed")` になる（元ファイルがローカルにないため登録時に形式を判定できない） |
| TC-conversion-036 | requestRegeneration: `driveBackup` で要求した — `readHead` / `detect` の呼び出しを確認する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | どちらも呼ばれない（記録所有者の資格情報での Drive 取得は要求の受け付けとして重すぎるため、連携の要否も含め `runRegeneration` に委ねる） |
| TC-conversion-037 | requestRegeneration: — — 2001 文字の追加指示を指定する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `BusinessRuleError(InvalidInstruction)` が投げられる |
| TC-conversion-038 | requestRegeneration: — — 2000 文字の追加指示を指定する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 成功する（境界値） |
| TC-conversion-039 | requestRegeneration: — — 200 文字の `modelOverride` を指定する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 成功する（境界値） |
| TC-conversion-040 | requestRegeneration: — — 201 文字の `modelOverride` を指定する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `ValidationError("INVALID_MODEL_OVERRIDE")` が投げられる（転送境界での入力検証） |
| TC-conversion-041 | requestRegeneration: — — 空文字の `modelOverride` を指定する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `ValidationError("INVALID_MODEL_OVERRIDE")` が投げられる（1 文字以上。指定しない場合は `null`） |
| TC-conversion-042 | requestRegeneration: — — 1 文字の `modelOverride` を指定する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 成功する（境界値） |
| TC-conversion-043 | requestRegeneration: 同じノートの再生成が実行中 — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `BusinessRuleError(DuplicateJob)` が投げられる |
| TC-conversion-044 | requestRegeneration: 存在しない `noteId` — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-conversion-045 | requestRegeneration: viewer である — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-conversion-046 | requestRegeneration: ゴミ箱のノート — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `BusinessRuleError(NoteIsTrashed)` が投げられる |
| TC-conversion-047 | requestRegeneration: 「要 LLM 連携」のノートで連携済み — 要求する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 初回生成として登録される |
| TC-conversion-048 | requestRegeneration: 要求後 — ジョブの `payload` を確認する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `{ kind: "regeneration", source, instruction, modelOverride }` が保存されている |
| TC-conversion-049 | requestRegeneration: 個人所有のノートを再生成する — ジョブの `scope` を確認する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る |
| TC-conversion-050 | requestRegeneration: 参加ワークスペース所有のノートを再生成する（要求者は owner ではないメンバー） — ジョブの `scope` を確認する | spec/testcases/conversion/requestRegeneration.md#テストケース-requestregeneration | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない。そのワークスペースの削除・除名でキャンセルされるため） |
| TC-conversion-051 | runConversion: Markdown ファイルと待機中のジョブ — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | HTML に変換され、ノートが `ready` になり、ジョブが `succeeded` になる |
| TC-conversion-052 | runConversion: 装飾のない HTML から変換された — 実行後に確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `styleMode: "default"` になる |
| TC-conversion-053 | runConversion: `style` 要素を含む HTML ファイル — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `styleMode: "preserve"` になる |
| TC-conversion-054 | runConversion: 既に `succeeded` のジョブ — 再度実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 何もせず終わる（冪等） |
| TC-conversion-055 | runConversion: 既に `failed` / `canceled` のジョブ — 再配送で受け取る | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 何もせず終わる（終端状態は再実行しない） |
| TC-conversion-056 | runConversion: ジョブの行が存在しない（退会の後始末 `deleteJobsForRequester` と配送が競合した） — 配送で受け取る | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 何もせず成功として返る（行がない以上その配送で進められる処理はなく、再配送しても結果は変わらない。run 系共通規則の判定 1） |
| TC-conversion-057 | runConversion: リースが有効な `running` のジョブ — 再配送で受け取る | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 何もせず終わる（他のワーカーが実行中） |
| TC-conversion-058 | runConversion: リースが失効した `running` のジョブ — 再配送で受け取る | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `Job.start` が引き継いで再開し、`attempts` が加算され進捗が作り直される |
| TC-conversion-059 | runConversion: リース失効の引き継ぎで `attempts` が上限を超える — 再配送で受け取る | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 再開せず `failed("timeout")` になり、手動 `retry` の余地が残る。同じ UoW で「共通: 強制終端の後始末」を `cause: { type: "expired" }` として実行し、`processing` のままの対象ノートが `failed(timeout)` に回復する（本処理に入る前に終端するため、ワーカー自身が本文を書き換える余地がない） |
| TC-conversion-060 | runConversion: ノートが削除済み — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `failed("targetMissing")` になる |
| TC-conversion-061 | runConversion: LLM が必要で未連携 — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `Note.markAwaitingIntegration` でノートが `awaitingIntegration` になり、ジョブが `failed("integrationRequired")` になる |
| TC-conversion-062 | runConversion: `markAwaitingIntegration` が適用された — 発行イベントを確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `note.awaitingIntegration` が発行される（`content_status` は `upsert` でしか更新されないため、このイベントがないと投影が `processing` のまま残る） |
| TC-conversion-063 | runConversion: `note.awaitingIntegration` が投影された — 読み取りモデルを確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `content_status` が `awaitingIntegration` に更新され、`countByContentStatus(owner, "awaitingIntegration")` に数えられる |
| TC-conversion-064 | runConversion: `awaitingIntegration` のノートがある状態で OpenRouter を連携する — `completeIntegrationOAuth` の案内を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `countByContentStatus` を根拠とする「要 LLM 連携の N 件」が実体と一致する（イベントを購読しないと常に 0 件になる） |
| TC-conversion-065 | runConversion: `payload.conversionPreference: "machineOnly"` で OpenRouter 連携がある Word ファイル — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 連携があっても `capability.llm: "declined"` として扱われ、機械的変換（`textExtraction`）になる |
| TC-conversion-066 | runConversion: `payload.conversionPreference: "auto"` で OpenRouter 連携がある Word ファイル — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | LLM を使う方針（`textExtractionThenStructuring`）になる |
| TC-conversion-067 | runConversion: `payload.conversionPreference: "machineOnly"` で機械的変換ができない形式（テキスト層のない PDF） — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `unavailable(machineExtractionUnavailable)` となり、ノートが `failed(machineExtractionUnavailable)`、ジョブが `failed("machineExtractionUnavailable")` になる |
| TC-conversion-068 | runConversion: `payload.conversionPreference: "machineOnly"` で画像、OpenRouter 連携済み — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 連携があっても結果は同じで、`Note.markAwaitingIntegration` は呼ばれない（案内は連携ではなく `auto` での取り込み直し） |
| TC-conversion-069 | runConversion: `payload.conversionPreference: "machineOnly"` で変換した — 使用量を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | LLM 実行回数は消費されていない |
| TC-conversion-070 | runConversion: LLM が必要で連携が失効（`CredentialResolver.resolve` が `reauthorizationRequired`） — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 方針の決定に進まず、ノートが `failed(providerAuthFailed)`、ジョブが `failed("providerAuthFailed")` になる |
| TC-conversion-071 | runConversion: `resolve` がtoken refreshまたは `lastUsedAt` 更新を返す — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `resolved.updated` をglobal D1で先に保存してからscope-local変換を続ける。後続のノート・ジョブ保存が競合してもconnection更新は巻き戻さない |
| TC-conversion-072 | runConversion: `resolve` が返した `expired` が非 `null` — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | global D1で連携と `integration.expired` を先に保存し、scope-localでノート・ジョブを失敗させる。plane間で停止しても再試行がexpired状態を読み直して同じ結果へ収束する |
| TC-conversion-073 | runConversion: 未連携（連携の行がない）と失効を比べる — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 未連携は `awaitingIntegration` + `failed("integrationRequired")`、失効は `failed(providerAuthFailed)` + `failed("providerAuthFailed")` で、結果も案内も分かれる（`unavailable` に畳まない） |
| TC-conversion-074 | runConversion: 実行中に外部から強制終端された（`trashNote` / `cancelJob` / 連携失効による一括失敗など） — 結果を保存する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 保存が `ConflictError` になるためジョブを読み直し、終端済みなら生成物を破棄して成功として返す（ジョブは書き換えない。run 系共通規則の判定 4） |
| TC-conversion-075 | runConversion: 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） — 結果を保存する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `ConflictError` をそのまま投げて再配送に委ねる |
| TC-conversion-076 | runConversion: LLM 実行回数の上限に達している — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | ノートが `failed(quotaExceeded)` になる |
| TC-conversion-077 | runConversion: モデルがレート制限を返す — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `failed("quotaExceeded")` になる |
| TC-conversion-078 | runConversion: 実行が時間切れになる — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `failed("timeout")` になる |
| TC-conversion-079 | runConversion: 破損したファイル — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `failed("corruptedFile")` になる |
| TC-conversion-080 | runConversion: パスワード保護された PDF（`FormatDetector.detect` の `passwordProtected` が真）で `conversionPreference: "machineOnly"` — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 方針の決定にも連携の解決にも進まず、ノートが `failed(passwordProtected)`、ジョブが `failed("passwordProtected")` になる（`machineExtractionUnavailable` に化けない） |
| TC-conversion-081 | runConversion: パスワード保護された PDF で OpenRouter 未連携 — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 同じく `failed(passwordProtected)` + `Job.fail("passwordProtected")` になる（`integrationRequired` に化けず、`markAwaitingIntegration` も呼ばれない） |
| TC-conversion-082 | runConversion: パスワード保護された PDF で OpenRouter 連携済み（`conversionPreference: "auto"`） — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 同じく `failed(passwordProtected)` + `Job.fail("passwordProtected")` になり、LLM 実行回数も消費されない |
| TC-conversion-083 | runConversion: 取り込み時に `failed(passwordProtected)` としたノート — 変換後の理由を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 同じファイルで理由が入れ替わらない（P-13 は 3 つの理由で案内を分けているため、`planConversionForUpload` の手順 3 と同じ優先順位を保つ） |
| TC-conversion-084 | runConversion: 未対応形式 — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | ノートが `failed(unsupportedFormat)` になる |
| TC-conversion-085 | runConversion: 変換結果に外部参照がある — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 参照取り込みジョブが登録される |
| TC-conversion-086 | runConversion: `payload.requestedVisibility` が `unlisted` — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 変換成功後に限定公開になり、共有リンクが発行される |
| TC-conversion-087 | runConversion: `payload.requestedVisibility` が `public` でハンドル未設定 — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 非公開のまま残り、ジョブは成功する |
| TC-conversion-088 | runConversion: 変換に失敗した — 結果を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 公開ステータスは変更されない |
| TC-conversion-089 | runConversion: `payload.requestedVisibility` の適用 — 手順 14 の実装を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `changeNoteVisibility` ユースケースは呼ばず、その手順 2〜4 を本文の更新と同じ UoW で再現する（呼ぶと `run` が入れ子になり、未保存のノートに渡せる `expectedVersion` もない）。手順 1 の権限確認は再現しない（実行主体は利用者ではなくジョブ） |
| TC-conversion-090 | runConversion: LLM を要する方針 — `consumeLlmCall` の呼び出し位置を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | ノートとジョブを保存する `UnitOfWorkProvider.run` を開く**前**に呼ぶ（`run` を入れ子にしないため）。消費は Usage 側の UoW で先に確定し、そのあと変換が失敗しても戻らない |
| TC-conversion-091 | runConversion: `parentId` を持つ子ジョブで方針が `unavailable` — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | ジョブが終端し、`job.failed` によって親の進捗が進む（子が終端しないまま残らない） |
| TC-conversion-092 | runConversion: タイトルの由来が `auto` で変換が題名を返す — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | タイトルが差し替わる |
| TC-conversion-093 | runConversion: タイトルの由来が `manual` — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | タイトルは差し替わらない |
| TC-conversion-094 | runConversion: LLM を使う変換を実行した — 使用量を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | LLM 実行回数が 1 消費されている |
| TC-conversion-095 | runConversion: 実行前に判明した失敗（未連携） — 使用量を確認する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | LLM 実行回数は消費されていない |
| TC-conversion-096 | runConversion: `requestedVisibility: "public"` だが公開ハンドルが未設定 — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | ノートは非公開のまま残り、ジョブは `succeeded` になる。`notices` に `{ kind: "visibilityNotApplied", requested: "public", reason: "handleMissing" }` が入る（`failure.detail` には書かない。成功したジョブは `failure` を持たない） |
| TC-conversion-097 | runConversion: `requestedVisibility: "public"` でワークスペース所有だがスラッグが未設定 — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 同じく `reason: "slugMissing"` の申し送りが入る |
| TC-conversion-098 | runConversion: 公開ステータスが適用できた — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `notices` は空配列になる |
| TC-conversion-099 | runConversion: 変換結果に外部参照がある — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | `StorageUrlPolicy.isInternal` が偽の参照が 1 件以上あるときだけ参照取り込みジョブが登録される |
| TC-conversion-100 | runConversion: 同じノートに未終端の `referenceImport` ジョブがある — 実行する | spec/testcases/conversion/runConversion.md#テストケース-runconversion | 新しい参照取り込みジョブは登録されず、変換ジョブ自体は成功する（`ensureNoDuplicate` は使わない。例外にせず登録を見送るだけ） |
| TC-conversion-101 | runRegeneration: 本文が `ready` で元ファイルがある — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 直前の本文が `regeneration` の版として記録され、成功時に新しい本文へ置き換わる |
| TC-conversion-102 | runRegeneration: 本文が `ready` でない（`awaitingIntegration` のノートを連携後に再生成する） — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 版は作られず、成功時に本文が入る |
| TC-conversion-103 | runRegeneration: 成功した — 実行後に確認する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | サニタイズされた HTML と `hasDecoration` から決まる `styleMode` で本文が差し替わる |
| TC-conversion-104 | runRegeneration: ノートが削除済み — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `failed("targetMissing")` になる |
| TC-conversion-105 | runRegeneration: `source: "driveBackup"` — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `fetchBackupForRegeneration` が `BackupRecord.userId` の連携トークンで元ファイルを取り出す |
| TC-conversion-106 | runRegeneration: Drive 上の元ファイルが削除・移動されている — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `failed("targetMissing")` になり、本文は変わらない |
| TC-conversion-107 | runRegeneration: 記録所有者の Drive 連携が解除・失効・退会済み（`driveBackup`） — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `failed("integrationRequired")` / `failed("providerAuthFailed")` になり、本文は変わらない |
| TC-conversion-108 | runRegeneration: 方針が `unavailable(integrationRequired)`（OpenRouter 未連携） — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 本文を変更せず `failed("integrationRequired")` のみになる（`Note.markAwaitingIntegration` は呼ばれない） |
| TC-conversion-109 | runRegeneration: 方針が `unavailable(unsupportedFormat)` — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 本文を変更せず `failed("unsupportedFormat")` になる |
| TC-conversion-110 | runRegeneration: LLM 実行回数の上限に達している — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 本文を変更せず `failed("quotaExceeded")` になる |
| TC-conversion-111 | runRegeneration: 連携が失効している（`CredentialResolver.resolve` が `reauthorizationRequired`） — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 方針の決定に進まず `failed("providerAuthFailed")` になり、本文は変わらない（再生成では `Note.markConversionFailed` を呼ばない） |
| TC-conversion-112 | runRegeneration: `resolve` がtoken refreshまたは `lastUsedAt` 更新を返す — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `resolved.updated` をglobal D1で先に保存してからscope-local再生成を続ける |
| TC-conversion-113 | runRegeneration: `resolve` が返した `expired` が非 `null` — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | global D1で連携と `integration.expired` を先に保存し、scope-localでジョブを失敗させる。plane間で停止しても再試行で収束する |
| TC-conversion-114 | runRegeneration: OpenRouter 未連携（連携の行がない） — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 失効とは分かれ、本文を変更せず `failed("integrationRequired")` になる |
| TC-conversion-115 | runRegeneration: 変換の実行が失敗する — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | ノートの `content` は `ready` のまま（`Note.markConversionFailed` を呼ばない）、ジョブだけが `failed` になる |
| TC-conversion-116 | runRegeneration: 追加指示を指定した — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 指示が `ConversionInput` に載り、構造化の要求に含まれる |
| TC-conversion-117 | runRegeneration: `modelOverride` があり方針が `textExtractionThenStructuring` / `transcriptionThenStructuring` — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `structuring` のモデルだけが置き換わる |
| TC-conversion-118 | runRegeneration: `modelOverride` があり方針が `pageImageStructuring` / `imageStructuring` — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `vision` のモデルだけが置き換わる |
| TC-conversion-119 | runRegeneration: `modelOverride` があり方針に `transcription` が含まれる — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `transcription` は上書きされず、連携設定のモデルが使われる |
| TC-conversion-120 | runRegeneration: 変換結果に外部参照がある — 実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 参照取り込みジョブが登録される |
| TC-conversion-121 | runRegeneration: 取り込み時に `machineOnly` を指定していたノート — 再生成する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 再生成の payload に `conversionPreference` はなく、連携があれば LLM を使う方針になる |
| TC-conversion-122 | runRegeneration: `failed(machineExtractionUnavailable)` のノート（連携済み） — 再生成する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `unavailable(machineExtractionUnavailable)` には到達せず、LLM を使う方針で本文が生成される |
| TC-conversion-123 | runRegeneration: 実行後 — タグ・公開設定・共有リンクを確認する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | いずれも維持されている（公開ステータスの適用は行わない） |
| TC-conversion-124 | runRegeneration: 実行後 — 版の一覧を確認する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 直前の内容から「元に戻す」ことができる |
| TC-conversion-125 | runRegeneration: 既に `succeeded` のジョブ — 再度実行する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 何もせず終わる（冪等） |
| TC-conversion-126 | runRegeneration: 既に `failed` / `canceled` のジョブ — 再配送で受け取る | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 何もせず終わる |
| TC-conversion-127 | runRegeneration: ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） — 配送で受け取る | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 何もせず成功として返る（run 系共通規則の判定 1） |
| TC-conversion-128 | runRegeneration: リースが有効な `running` のジョブ — 再配送で受け取る | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 何もせず終わる（他のワーカーが実行中） |
| TC-conversion-129 | runRegeneration: リースが失効した `running` のジョブ — 再配送で受け取る | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `Job.start` が引き継いで再開し、`attempts` が加算される |
| TC-conversion-130 | runRegeneration: リース失効の引き継ぎで `attempts` が上限を超える — 再配送で受け取る | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 再開せず `failed("timeout")` になり、手動 `retry` の余地が残る |
| TC-conversion-131 | runRegeneration: 実行中に外部から強制終端された（`trashNote` / `cancelJob` など） — 結果を保存する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | 保存が `ConflictError` になるためジョブを読み直し、終端済みなら差し替え前に取得した変換結果を破棄して成功として返す（ジョブは書き換えない。run 系共通規則の判定 4） |
| TC-conversion-132 | runRegeneration: 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） — 結果を保存する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `ConflictError` をそのまま投げて再配送に委ねる |
| TC-conversion-133 | runRegeneration: 実行中 — そのノートを編集する | spec/testcases/conversion/runRegeneration.md#テストケース-runregeneration | `BusinessRuleError(NoteLockedByJob)` が投げられる |
| TC-identity-001 | addPasswordIdentity: Google のみで登録した利用者が再認証を済ませている — パスワードを追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | `PasswordIdentity` が作られ、`identity.added` が発行される |
| TC-identity-002 | addPasswordIdentity: 既にパスワード認証手段を持つ利用者 — パスワードを追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | `BusinessRuleError(PasswordIdentityAlreadyExists)` が投げられる |
| TC-identity-003 | addPasswordIdentity: — — 強度要件を満たさないパスワードで追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | `BusinessRuleError(WeakPassword)` が投げられる |
| TC-identity-004 | addPasswordIdentity: 追加後 — 追加したパスワードでサインインする | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | サインインが成功する |
| TC-identity-005 | addPasswordIdentity: 同じ利用者に対して 2 つの要求が同時に走る — 両方が追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | 片方は成功、もう片方は `ConflictError` または `BusinessRuleError(PasswordIdentityAlreadyExists)` になる |
| TC-identity-006 | addPasswordIdentity: OAuth Identityを8件持ちPasswordは未登録 — パスワードを追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | `BusinessRuleError(IdentityLimitExceeded)`となり、9件目を作らない |
| TC-identity-007 | addPasswordIdentity: Identityが7件のときOAuth linkとPassword追加が同時に走る — 両方の最終UoWを実行する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | current件数の再検査/DB triggerにより一方だけ成功し、合計8件を超えない |
| TC-identity-008 | authenticateSession: 有効なセッションがある — トークンで認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | 利用者の射影が返る |
| TC-identity-009 | authenticateSession: 有効なセッションがある — 認証の前後でセッションの行を比べる | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | 一切書き換わらない（`Session` は絶対期限で、最終使用時刻を持たない。認証は純粋な読み取りである） |
| TC-identity-010 | authenticateSession: サインインから 29 日経ったセッション — トークンで認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | 認証が成功し、`expiresAt` は延びない（使っても期限は延びない絶対期限） |
| TC-identity-011 | authenticateSession: サインインから 30 日を過ぎたセッション — トークンで認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | `ValidationError("UNAUTHENTICATED")` が投げられ、セッションが削除される（境界は `expiresAt <= now`） |
| TC-identity-012 | authenticateSession: 期限切れのセッション — トークンで認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | `ValidationError("UNAUTHENTICATED")` が投げられ、セッションが削除される |
| TC-identity-013 | authenticateSession: 存在しないトークン — トークンで認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | `ValidationError("UNAUTHENTICATED")` が投げられる |
| TC-identity-014 | authenticateSession: セッションはあるが利用者が削除済み — トークンで認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | `ValidationError("UNAUTHENTICATED")` が投げられる |
| TC-identity-015 | authenticateSession: Sessionの`authEpoch`がcurrent Userより古い — 認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | 物理行が残っていても`ValidationError("UNAUTHENTICATED")`。削除失敗で認証が復活しない |
| TC-identity-016 | authenticateSession: 期限のちょうど 1 ミリ秒前 — トークンで認証する | spec/testcases/identity/authenticateSession.md#テストケース-authenticatesession | 認証が成功する（境界値） |
| TC-identity-017 | changePassword: パスワード認証手段があり、複数のセッションがある — 正しい現在のパスワードと新しいパスワードで変更する | spec/testcases/identity/changePassword.md#テストケース-changepassword | ハッシュとUserの`authEpoch`が更新され、現在Sessionだけ新世代へ追随する。他行は物理削除前から無効 |
| TC-identity-018 | changePassword: セッションが10,000件ある — 変更する | spec/testcases/identity/changePassword.md#テストケース-changepassword | transactionの更新件数はIdentity/User/現在Sessionの定数件で、旧世代行は100件ずつ継続回収する |
| TC-identity-019 | changePassword: — — 誤った現在のパスワードで変更する | spec/testcases/identity/changePassword.md#テストケース-changepassword | `ValidationError("INVALID_CREDENTIALS")` が投げられ、ハッシュは変わらない |
| TC-identity-020 | changePassword: パスワード認証手段を持たない利用者 — 変更する | spec/testcases/identity/changePassword.md#テストケース-changepassword | `NotFoundError("PASSWORD_IDENTITY_NOT_FOUND")` が投げられる |
| TC-identity-021 | changePassword: — — 強度要件を満たさない新しいパスワードで変更する | spec/testcases/identity/changePassword.md#テストケース-changepassword | `BusinessRuleError(WeakPassword)` が投げられる |
| TC-identity-022 | changePassword: 変更後 — 古いパスワードでサインインする | spec/testcases/identity/changePassword.md#テストケース-changepassword | `ValidationError("INVALID_CREDENTIALS")` が投げられる |
| TC-identity-023 | changePassword: 変更中に他の要求が同じ認証手段を更新した — 変更する | spec/testcases/identity/changePassword.md#テストケース-changepassword | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-identity-024 | completeOAuthSignIn: 有効な `state` があり、該当の紐づけも同メールの利用者も存在しない — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ActiveUser` と `OAuthIdentity` が作られ、セッションが発行され、`created: true` が返る |
| TC-identity-025 | completeOAuthSignIn: 既に同じ `(provider, providerAccountId)` の紐づけがある — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | 既存の利用者でセッションが発行され、`created: false` が返る |
| TC-identity-026 | completeOAuthSignIn: 同じメールアドレスの `ActiveUser` が存在する — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | 既存の利用者に `OAuthIdentity` が追加され、セッションが発行される |
| TC-identity-027 | completeOAuthSignIn: 同じメールの既存利用者がIdentityを8件持つ — 新しいprovider accountで交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `BusinessRuleError(IdentityLimitExceeded)`となり、Identity/Sessionを追加せずreservationをreleaseする |
| TC-identity-028 | completeOAuthSignIn: 同じメールアドレスの `PendingUser` が存在する — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ValidationError("EXISTING_ACCOUNT_UNVERIFIED")` が投げられ、紐づけは行われない |
| TC-identity-029 | completeOAuthSignIn: provider accountまたはemailが`DeletingUser`へ解決される — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ValidationError("ACCOUNT_UNAVAILABLE")`でIdentity/Sessionを作らない |
| TC-identity-030 | completeOAuthSignIn: 同じプロバイダーアカウントで 2 つのサインアップが同時に走る — 両方が認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | normalized providerAccount shardのreservationは一方だけ成立し、他方は `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` になる |
| TC-identity-031 | completeOAuthSignIn: createNewでemail reservation後にproviderAccount reservationが失敗する — recoveryする | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | 親operationから別sub-operation IDを導出し、確保済みemail reservationをreleaseする |
| TC-identity-032 | completeOAuthSignIn: User/Identity保存後に2 reservationの片方だけactivate応答を失う — recoveryする | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | operation payloadと正データversionを照合し、email/providerAccount両方をactiveへ収束させる |
| TC-identity-033 | completeOAuthSignIn: プロバイダーが返すメールが未確認 — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ValidationError("OAUTH_EMAIL_UNVERIFIED")` が投げられる |
| TC-identity-034 | completeOAuthSignIn: `state` が保存されていない — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ValidationError("OAUTH_STATE_INVALID")` が投げられる |
| TC-identity-035 | completeOAuthSignIn: `state` が既に 1 度使われている — 同じ `state` で再度交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ValidationError("OAUTH_STATE_INVALID")` が投げられる（束縛が一致したときに取り出しと同時に削除される） |
| TC-identity-036 | completeOAuthSignIn: コード交換がプロバイダー側で拒否される — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ValidationError("OAUTH_CODE_INVALID")` が投げられる |
| TC-identity-037 | completeOAuthSignIn: プロバイダーとの通信が失敗する — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `SystemError(ExternalApiError)` が投げられる |
| TC-identity-038 | completeOAuthSignIn: `redirectTo` が保存されている — 認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | 応答に `redirectTo` が含まれる |
| TC-identity-039 | deleteAccount: 通常の利用者 — 正しいメールアドレスを入力して削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | usecaseは`operationId` / `status: accepted`を返し、presentationが読み取り専用status ticketを署名して202応答へ加える。Userは直ちに`deleting`、session / tokenは失効する |
| TC-identity-040 | deleteAccount: session/token行が各10,000件ある — 削除を受理する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `authEpoch`更新で全件を即時失効し、物理行は各100件pageのack完了までfinalizeを待つ |
| TC-identity-041 | deleteAccount: Session/AuthToken旧世代行が各101件ある — residue cleanupする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | payloadの`table`でSessionを100+1件処理してからAuthTokenへ切り替え、AuthToken残件0確認後だけreceiptをackする |
| TC-identity-042 | deleteAccount: Session→AuthToken phase切替の応答を失う — recoveryする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 保存済み`table`から再開し、Session phaseへ戻らずfinalize条件を満たす |
| TC-identity-043 | deleteAccount: cleanup中にさらに`authEpoch`が進む — 継続する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | payload世代より新しい資格行を削除せず、User世代を巻き戻さない |
| TC-identity-044 | deleteAccount: personal Note writeがbarrier commandより先にDOへ到着する — 削除を開始する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | writeを先に確定し、barrier ack後のowner scanがその行も回収する |
| TC-identity-045 | deleteAccount: personal Note/Tag/Storage/Usage writeがbarrier後に到着する — commitする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 共通`assertWritable`が`ACCOUNT_DELETING`で拒否し、cleanup cursor後方へ新規行を差し込まない |
| TC-identity-046 | deleteAccount: account deletion cleanupが長期化する — local receiptをpruneする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | running barrierは`expires_at = NULL`で回収されず、全local ackまでowner検査を継続できる |
| TC-identity-047 | deleteAccount: 全local cleanup ack後 — receiptを完了する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | completedへ縮約して120日保持し、遅延重複をno-op化してから最大100件ずつ回収する |
| TC-identity-048 | deleteAccount: session失効後 — status ticketで進捗を読む | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 当該operationの状態だけが返り、他operationや利用者データは読めない |
| TC-identity-049 | deleteAccount: — — 誤ったメールアドレスを入力する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `ValidationError("CONFIRMATION_MISMATCH")`。operationは作られない |
| TC-identity-050 | deleteAccount: 同じ利用者が同じ`requestId`で削除を再要求する — 同じ確認入力で実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 新しいoperationを作らず既存 `operationId` / status ticketを返し、terminal結果はticketから読める |
| TC-identity-051 | deleteAccount: 唯一ownerでrejected後、owner移譲を済ませる — 新しい`requestId`で再要求する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 旧rejected headerを120日保持したまま新operation/manifestを作り、削除を再試行できる |
| TC-identity-052 | deleteAccount: 120日の窓に保持中のterminal行（`completed` / `rejected`）が8件ある — 9つ目の新しい`requestId`で再要求する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `BusinessRuleError(AccountDeletionRetryLimitExceeded)`となり、terminal control-plane rowを利用者単位で8件以下に保つ |
| TC-identity-053 | deleteAccount: running中に別`requestId`で再要求する — 実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | running operationは1件に保ち、そのoperation IDを返す |
| TC-identity-054 | deleteAccount: `requestId`がUUID形式でない — userRequestを送る | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `ValidationError("INVALID_REQUEST_ID")`でoperationを作らない |
| TC-identity-055 | deleteAccount: 唯一のownerであるworkspaceがある — prepareする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 全prepare lock/barrierをreleaseしてUserは`active`へ戻り、manifest item縮約後にoperationが`rejected`になる。scope cleanupは始まらない |
| TC-identity-056 | deleteAccount: 全scopeのprepare前 — 別ownerが脱退・降格する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | local owner集合とlock取得が直列化され、prepareかowner変更の片方だけが成功する |
| TC-identity-057 | deleteAccount: 全scope prepare後 — 別ownerが脱退・降格・除名される | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `MEMBERSHIP_REMOVAL_PREPARED`で拒否され、commitはLastOwnerにならず完了できる |
| TC-identity-058 | deleteAccount: 3scope中2scopeをprepare後に3つ目が失敗する — rollback prepareする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 2scopeのlockを冪等にreleaseし、Membership/Job/個人データは一切削除されていない |
| TC-identity-059 | deleteAccount: prepare失敗時にpersonal barrier解除応答を失う — recoveryする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じoperation IDで`abortPersonalAccountDeletion`を再送し、workspace lockとbarrier双方の解除ack後だけUserをactiveに戻す。operation rejectedはmanifest縮約後だけ公開する |
| TC-identity-060 | deleteAccount: 数千membership item固定後にprepareが失敗する — rollbackする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 全lock/barrier release ack後に`compactingRejected`へ進み、itemsを100件ずつ消して0件時だけoperation/manifestをrejectedにし、headerを120日保持する |
| TC-identity-061 | deleteAccount: 250 workspace lock取得後に次scopeのprepareが失敗する — `rollbackRelease`を進める | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | release未ack itemを100+100+50件、外部接続最大6のwaveで配送し、全release ack前はUser active/manifest compactへ進まない |
| TC-identity-062 | deleteAccount: release 100件のack transaction後に応答を失う — rollback continuationを再実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 保存済みrelease ackを飛ばして残件だけを再配送し、二重releaseなく収束する |
| TC-identity-063 | deleteAccount: workspace prepareはcommitしたがUserId manifestへのprepare ack応答を失い、同waveの別scopeが失敗する — rollbackする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 送信前の`prepareDispatchedAt`を正本に当該workspaceもreleaseし、孤児lockを残さない |
| TC-identity-064 | deleteAccount: prepare / commit応答を失う — recoveryする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じoperation IDで保存済みphaseを返し、二重lock・二重削除なしで再開する |
| TC-identity-065 | deleteAccount: prepareから10分を越える — 実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 2分ごとのrenewでlockを維持し、全scopeの残存5分以上を確認するまでcommitへ入らない |
| TC-identity-066 | deleteAccount: renew応答を失う — 実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | destructive cleanupを開始せず、global recoveryがoperation stateを確認してrenewする |
| TC-identity-067 | deleteAccount: rejected後にrelease応答を失う — membershipを変更する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 期限だけでlockを無視せず、recoveryがrejectedを確認してreleaseした後に成功する |
| TC-identity-068 | deleteAccount: committed後にorchestratorが停止する — recoveryする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | lockは自動失効せず、LastOwner invariantを保ったままcleanupを再開する |
| TC-identity-069 | deleteAccount: personal scopeに実行中Jobが150件ある — 削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 100件をlocal transactionで終端・後始末し、`scheduled_tasks` とAlarmで残りを継続する。他scopeのJobを同じtransactionに入れない |
| TC-identity-070 | deleteAccount: 同scopeに大量の期限回収・projection taskがある — 削除cleanupを進める | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | security cleanupはpriority 0の最低枠で先行し、低優先taskに飢餓させられない |
| TC-identity-071 | deleteAccount: personal scopeに匿名PDF Jobがある — 削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `listActiveByScope(user)` で拾われて取り消される |
| TC-identity-072 | deleteAccount: workspace scopeに本人が要求したJobがある — 削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | directoryで列挙されたそのscopeの `listActiveByRequester` で拾われる |
| TC-identity-073 | deleteAccount: 先行する脱退のdirectory edgeが`removing` — 削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | そのscopeも固定し、先行cleanupのackを待ってからfinalizeする |
| TC-identity-074 | deleteAccount: pending membership reservationがある — prepare後に別scopeで失敗する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | prepare中はreservation変更lockだけを取り、rollback releaseで元のpending状態を保つ。取消はcommit後だけ行う |
| TC-identity-075 | deleteAccount: 過去に脱退済みでdirectory edgeが消えている — residueを確認する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | そのscopeに本人のJob正データ・BackupRecordは残っていない（edge削除前cleanupの不変条件） |
| TC-identity-076 | deleteAccount: workspace scopeに他メンバーのJobがある — 削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 取り消されない |
| TC-identity-077 | deleteAccount: activeな変換JobのNoteが`processing` — scope cleanupを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | Job終端と `Note.markConversionFailed("canceled")` が同じscope-local transactionで保存される |
| TC-identity-078 | deleteAccount: batch親に成功済みartifactがある — scope cleanupを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 強制終端の後始末に従い同じscopeでartifact metadataを回収する |
| TC-identity-079 | deleteAccount: workspace所有Noteを作成していた — workspace cleanupを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | Noteは残り、local著者投影が「退会した利用者」へ変わってからMembershipを削除する |
| TC-identity-080 | deleteAccount: 過去に脱退したworkspaceに本人作成のNoteが残る — 削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | membership edgeではなく`note_routes(created_by)`から発見し、local/public両方の著者表示を消去する |
| TC-identity-081 | deleteAccount: 本人作成routeが数千件ある — author redactionする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 100件のキーセットpageと個別要求で有界に進み、全local/public ack前はfinalizeしない |
| TC-identity-082 | deleteAccount: redaction完了後に削除前のNote eventが遅延到着する — 投影する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `redactionVersion`より古いauthorVersionでは旧表示名・handleを復活させない |
| TC-identity-083 | deleteAccount: personal Note / Tag / File / Backup / Usageがある — personal scope cleanupを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | current scopeだけで全データを削除し、完了ackを返す |
| TC-identity-084 | deleteAccount: personal cleanupの全正データとlocal task/event ackが揃う — 最終local UoWをcommitする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | barrierをcompletedへ進めて120日保持し、そのDO ack後だけUserId manifestの`personalCleanup` receiptを記録する |
| TC-identity-085 | deleteAccount: job/note/tag/storage/backup/usage/localProjection/outboxのうち1 componentが未ack — barrier完了を試す | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | operation専用component flagが不足するためrunningのまま。別operationのtask完了やscope全体のtask空判定で代用しない |
| TC-identity-086 | deleteAccount: 各componentの最終pageが0件になる — cleanupを継続する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | そのcomponent ackと次taskなしを同じscope-local UoWで保存し、応答喪失時も二重完了しない |
| TC-identity-087 | deleteAccount: barrier完了commit後にDO応答を失う — cleanup commandを再送する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じoperation IDのcompleted receiptを返し、UserId manifestへackしてrunning barrierを永久残存させない |
| TC-identity-088 | deleteAccount: Google Drive連携と複数scopeのbackup記録がある — 削除する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | global connectionと各scopeのrecordを別々に削除する。Drive上のファイルは削除しない |
| TC-identity-089 | deleteAccount: 1つのscope commandの応答が失われる — recoveryを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じoperation IDで再配送され、`applied_operations` により二重適用されず再開する |
| TC-identity-090 | deleteAccount: 一部scopeが未完了 — finalizeを試す | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | Userは`deleting`のままでPIIを削除せず、再試行時刻を記録する |
| TC-identity-091 | deleteAccount: 全scopeとglobal cleanupが完了 — finalizeする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | IdentityのPIIを削除し、Userを`deleted` tombstoneにして `identity.user.deleted` を発行する |
| TC-identity-092 | deleteAccount: 公開personal Noteがあった — 完了後にURLを開く | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | route / public projectionがtombstoneになり「見つかりません」 |
| TC-identity-093 | deleteAccount: 完了後 — 同じメールアドレスで登録する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | uniqueness reservationが解放済みで、新しいUserとして登録できる |
| TC-identity-094 | deleteAccount: OAuth Identityを持つ利用者 — 削除完了後に同じprovider accountで登録する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | providerAccount reservationも解放済みで、deleted Userへlookupされない |
| TC-identity-095 | deleteAccount: active/removing/pendingのmembership edgeが合計250件ある — manifestを構築する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | edge keysetを100+100+50件で固定し、各pageのcursorと次taskを同じtransactionで保存する |
| TC-identity-096 | deleteAccount: membership pageのcommit後に応答を失う — build continuationを再実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じoperation ID+edge keyで重複せず、保存済みcursorから次pageへ進む |
| TC-identity-097 | deleteAccount: 250 workspaceのprepareが必要 — dispatchする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 1page最大100件、外部scope同時6接続以下のwaveで処理し、全prepare ackまでauthor route scanへ進まない |
| TC-identity-098 | deleteAccount: actorのworkspace Note createがprepare barrierより先にcommitする — author route manifestを構築する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 全barrier ack後にroute scanするため作成済みrouteを固定し、local/public redaction対象に含める |
| TC-identity-099 | deleteAccount: actorのworkspace writeがprepare barrier後に到着する — commitする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `assertActorWritable`が拒否し、author route scan後方へ対象が増えない |
| TC-identity-100 | deleteAccount: author routeが250件ある — manifestを構築する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 署名generation cursorで100+100+50件を固定し、各itemのlocal/public ackを保存する |
| TC-identity-101 | deleteAccount: author route pageのcommit後に応答を失う — build continuationを再実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | operation ID+NoteIdで重複せず、headerの署名cursorから次pageへ進む |
| TC-identity-102 | deleteAccount: ack済みaccount manifest itemが101件ある — compactする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 100件削除してcontinuationを保存し、次turnの1件後だけheaderをcompletedにする |
| TC-identity-103 | deleteAccount: ack済みaccount manifest itemが1,000件ある — compactする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 10 turnに分け、各transactionを100件以下に保つ |
| TC-identity-104 | deleteAccount: completed/rejected account manifest headerが期限到達済みで101件ある — terminal prunerを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `(expiresAt, operationId)` keysetの100+1件で回収し、running/building/compacting headerは残す |
| TC-identity-105 | deleteAccount: terminal header 100件の削除commit後に応答を失う — prune continuationを再実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じ固定`asOf`/cursorから冪等に再開し、未回収headerを欠落させない |
| TC-identity-106 | deleteAccount: 32 UserId shardにterminal headerがありrunが次hourまで未完了 — 次Cronで再開する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | `accountManifestPrune`の同じrun/generation/shard positionを再開し、kind全体のactive laneを最大6に保つ |
| TC-identity-107 | deleteAccount: UserId shardでterminal DELETE後、run checkpoint前に停止する — laneを再実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じ入力cursorのDELETEを冪等再実行し、次cursor/Queue outboxをcatalog transactionでcheckpointする |
| TC-identity-108 | deleteAccount: rejected header/operationが120日を越える — terminal prunerを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | matching manifestとdistributed operation/request keyを同じUserId-shard transactionで回収し、running operationには触れない |
| TC-identity-109 | deleteAccount: terminal headerの`expiresAt`が固定`asOf`と同時刻 — pruneする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 120日境界到達として回収し、1ミリ秒後のheaderは残す |
| TC-identity-110 | deleteAccount: completed personal barrierが120日を迎える — scope Alarmを実行する | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 固定`asOf`で最大100件を回収し、running barrierは対象にしない |
| TC-identity-111 | deleteAccount: barrier完了とprune task保存の直後に応答を失う — Alarm/recoveryする | spec/testcases/identity/deleteAccount.md#テストケース-deleteaccount | 同じscope-local UoWにtaskが残るため、期限後にcompleted receiptを回収できる |
| TC-identity-112 | getPublicProfile: ハンドル設定済みの `ActiveUser` — ハンドルで引く | spec/testcases/identity/getPublicProfile.md#テストケース-getpublicprofile | 表示名・自己紹介・アイコンが返る |
| TC-identity-113 | getPublicProfile: 存在しないハンドル — 引く | spec/testcases/identity/getPublicProfile.md#テストケース-getpublicprofile | `NotFoundError("USER_NOT_FOUND")` が投げられる |
| TC-identity-114 | getPublicProfile: 形式が不正なハンドル — 引く | spec/testcases/identity/getPublicProfile.md#テストケース-getpublicprofile | `NotFoundError("USER_NOT_FOUND")` が投げられる（バリデーションエラーにしない） |
| TC-identity-115 | getPublicProfile: `PendingUser` にハンドルが設定されている — 引く | spec/testcases/identity/getPublicProfile.md#テストケース-getpublicprofile | `NotFoundError("USER_NOT_FOUND")` が投げられる |
| TC-identity-116 | getPublicProfile: 削除済みの利用者のハンドル — 引く | spec/testcases/identity/getPublicProfile.md#テストケース-getpublicprofile | `NotFoundError("USER_NOT_FOUND")` が投げられる |
| TC-identity-117 | getPublicProfile: — — 引く | spec/testcases/identity/getPublicProfile.md#テストケース-getpublicprofile | 応答にメールアドレスが含まれない |
| TC-identity-118 | getPublicProfile: 大文字を含むハンドルで引く — 引く | spec/testcases/identity/getPublicProfile.md#テストケース-getpublicprofile | 小文字に正規化されて一致する |
| TC-identity-119 | linkOAuthIdentity: サインイン済みで Google 未連携、`intent: "linkIdentity"` の `state` がある — 認可コードを交換する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | `OAuthIdentity` が追加され、`identity.added` が発行される |
| TC-identity-120 | linkOAuthIdentity: 対象の Google アカウントが別の利用者に紐づいている — 認可コードを交換する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` が投げられる |
| TC-identity-121 | linkOAuthIdentity: `intent: "signIn"` の `state` を使う — 認可コードを交換する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | `ValidationError("OAUTH_STATE_INVALID")` が投げられる |
| TC-identity-122 | linkOAuthIdentity: 対象の利用者が削除済み — 認可コードを交換する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | `NotFoundError("USER_NOT_FOUND")` が投げられる |
| TC-identity-123 | linkOAuthIdentity: flow開始後にsign-out-all/password resetで`authEpoch`が進んだ — 認可コードを交換する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | flow stateの世代不一致としてIdentityを追加せず、確保済みprovider reservationをreleaseする |
| TC-identity-124 | linkOAuthIdentity: flow開始後にaccount deletionが始まった — 認可コードを交換する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | final UserId-shard UoWで`ActiveUser`検査に失敗し、Identityのlate insertを行わない |
| TC-identity-125 | linkOAuthIdentity: Password/OAuth合計8件のIdentityがある — 9件目をリンクする | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | `BusinessRuleError(IdentityLimitExceeded)`。provider reservationをreleaseし、Identityを追加しない |
| TC-identity-126 | linkOAuthIdentity: 7件の状態から2件を同時にリンクする — 両callbackを処理する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | UserId shard UoW/DB triggerにより一方だけ成功し、合計8件を超えない |
| TC-identity-127 | linkOAuthIdentity: 同じ Google アカウントが既に自分に紐づいている — 認可コードを交換する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | 既存として扱われ、重複した `Identity` は作られない |
| TC-identity-128 | listIdentities: パスワードと Google の 2 件を持つ利用者 — 一覧する | spec/testcases/identity/listIdentities.md#テストケース-listidentities | 2 件が返り、`removable: true` になる |
| TC-identity-129 | listIdentities: 認証手段が 1 件だけの利用者 — 一覧する | spec/testcases/identity/listIdentities.md#テストケース-listidentities | 1 件が返り、`removable: false` になる |
| TC-identity-130 | listIdentities: — — 一覧する | spec/testcases/identity/listIdentities.md#テストケース-listidentities | 応答にパスワードのハッシュやトークンが含まれない |
| TC-identity-131 | listIdentities: OAuth の認証手段がある — 一覧する | spec/testcases/identity/listIdentities.md#テストケース-listidentities | `provider` と `accountLabel` が含まれる |
| TC-identity-132 | listIdentities: パスワードの認証手段がある — 一覧する | spec/testcases/identity/listIdentities.md#テストケース-listidentities | `provider` が `null` になる |
| TC-identity-133 | listIdentities: 上限まで認証手段がある — 一覧する | spec/testcases/identity/listIdentities.md#テストケース-listidentities | 8件だけ返る。不変条件により9件目は存在しない |
| TC-identity-134 | listPublicProfiles: 個人所有の公開ノートを持ちハンドル設定済みの利用者が 3 名 — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | 3 件のハンドルが返る |
| TC-identity-135 | listPublicProfiles: ハンドル設定済みだが公開ノートを持たない利用者 — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | その利用者は含まれない |
| TC-identity-136 | listPublicProfiles: 公開ノートを持つがハンドル未設定の利用者 — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | その利用者は含まれない（`/@:handle` を持たないため `UserBatchReader.resolveMany` の解決後に落とす） |
| TC-identity-137 | listPublicProfiles: 公開ノートをゴミ箱に入れた利用者 — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | その利用者は含まれない |
| TC-identity-138 | listPublicProfiles: ワークスペース所有の公開ノートしか持たない利用者（ハンドル設定済み） — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | 含まれない（著者基準で列挙すると `/@:handle` が 0 件の空の公開ページを量産するため） |
| TC-identity-139 | listPublicProfiles: ワークスペースから個人へ移したノートを持ち、そのノートの `createdBy` は別人である利用者 — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | 含まれる（所有者基準でのみ拾える） |
| TC-identity-140 | listPublicProfiles: 個人所有の公開ノートを複数持つ利用者 — `updatedAt` を確認する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | その利用者の**個人所有の公開ノート**の最新更新時刻が返る |
| TC-identity-141 | listPublicProfiles: 対象が `limit` を超える — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | `limit` 件と `nextCursor` が返る |
| TC-identity-142 | listPublicProfiles: `nextCursor` を渡す — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | 続きが重複なく返る |
| TC-identity-143 | listPublicProfiles: 対象が 0 件 — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | 空配列と `nextCursor: null` が返る |
| TC-identity-144 | listPublicProfiles: public Noteが32 shardへ分散する — 利用者を列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | 同時6接続のwaveで所有者を集約し、署名cursorのshard別位置から続きを返す |
| TC-identity-145 | listPublicProfiles: reshard中に同じ利用者が旧新へ現れる — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | UserIdで重複排除し、その利用者の最新updatedAtを採る |
| TC-identity-146 | listPublicProfiles: 同じ利用者の公開Noteが複数shardにある — page境界をまたいで列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | 全shard headの同一UserIdを消費して1件だけ返し、次pageへ同じ利用者を再出現させない |
| TC-identity-147 | listPublicProfiles: 1pageの利用者が32 User shardへ分散する — 表示を解決する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | UserIdでgroupingして最大6接続のwaveで読み、全shard scanを行わない |
| TC-identity-148 | listPublicProfiles: `limit: 101` — 列挙する | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | `ValidationError("INVALID_PAGINATION")`となり、UserBatchReaderの100件上限を超えない |
| TC-identity-149 | listPublicProfiles: User shardをreshard中 — 同じ利用者を旧新から読む | spec/testcases/identity/listPublicProfiles.md#テストケース-listpublicprofiles | UserIdで重複排除し、大きいUser versionのプロフィールを採る |
| TC-identity-150 | pruneExpiredAuthState: 期限切れのセッションが 3 件、期限内が 2 件 — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 期限切れの 3 件だけが削除され、`sessions: 3` が返る |
| TC-identity-151 | pruneExpiredAuthState: `expiresAt` が基準時刻とちょうど同じセッション — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除される（境界は `expiresAt <= now`。`Session.isExpired` と同じ判定） |
| TC-identity-152 | pruneExpiredAuthState: `expiresAt` が基準時刻の 1 ミリ秒後のセッション — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除されない（境界値） |
| TC-identity-153 | pruneExpiredAuthState: 期限切れのセッションを削除した — 削除前後で `authenticateSession` を呼ぶ | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | どちらも `ValidationError("UNAUTHENTICATED")` になる（期限切れは元から認証されないため、削除で結果は変わらない） |
| TC-identity-154 | pruneExpiredAuthState: 期限切れの `email_verification` / `password_reset` トークンがある — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除され、`authTokens` に数えられる |
| TC-identity-155 | pruneExpiredAuthState: 消費済みで期限を過ぎたトークンがある — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除される（単回性は消費時の条件付き更新が担保しており、行の残存に依存しない） |
| TC-identity-156 | pruneExpiredAuthState: 消費済みだが期限内のトークンがある — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除されない（境界は `AuthToken.isExpired` と同じ `expiresAt <= now`） |
| TC-identity-157 | pruneExpiredAuthState: 期限切れのログイン試行記録がある — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除され、`loginAttempts` に数えられる |
| TC-identity-158 | pruneExpiredAuthState: ロック中の記録がある（`failureCount >= 10` かつ最終失敗から 15 分以内） — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 記録の期限（最終失敗から 24 時間）はロックの解除（同 15 分）より後に来るため削除されず、ロックの解除が早まらない |
| TC-identity-159 | pruneExpiredAuthState: コールバックが返らなかったサインイン用の認可フロー状態がある — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除され、`oauthFlowStates` に数えられる |
| TC-identity-160 | pruneExpiredAuthState: 連携用（`intent: "integration"`）の認可フロー状態も期限切れになっている — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 同じ `OAuthStateStore` に載るため同時に削除される（Integration 側に同種の定期掃除は置かない） |
| TC-identity-161 | pruneExpiredAuthState: 期限内の認可フロー状態がある — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 削除されず、コールバックで `take` できる |
| TC-identity-162 | pruneExpiredAuthState: 4 種とも対象が 0 件 — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | すべて 0 件で成功する |
| TC-identity-163 | pruneExpiredAuthState: 直前に実行済み — 続けてもう一度実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 2 回目は対象が残っていないため 4 種とも 0 件で終わる（冪等） |
| TC-identity-164 | pruneExpiredAuthState: `AuthTokenRepository.deleteExpired` が失敗する — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 当該shard/tableの継続だけをbackoffし、他shard/tableの最低枠は進む |
| TC-identity-165 | pruneExpiredAuthState: そのinvocationで試みた削除がすべて失敗する（掃けない表のskipは分子にも分母にも入らない） — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | cursorを失わず再試行し、上限超過時はDLQと運用通知へ送る |
| TC-identity-166 | pruneExpiredAuthState: 実行時 — Unit of Work の利用を確認する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | table削除を横断UoWへ入れず、routing catalog上のcontinuation cursor更新だけを原子的に保存する |
| TC-identity-167 | pruneExpiredAuthState: 実行時 — 基準時刻の取得元を確認する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 基準時刻は外部入力で受けず `clock` から得る |
| TC-identity-168 | pruneExpiredAuthState: 1 shardの各表に期限切れ行が250件ある — Cronを実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 1 commandは1表100件以下でyieldし、generation/table/shard cursorから継続して全件を回収する |
| TC-identity-169 | pruneExpiredAuthState: 100件削除後に応答を失う — continuationを再実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 同じkeysetから冪等に再開し、他表・他shardの最低処理枠も維持する |
| TC-identity-170 | pruneExpiredAuthState: target shardで100件削除後、run checkpoint前に停止する — continuationを再実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 保存済み入力cursorから同じDELETEを安全に再実行し、cursor checkpointと次Queue outboxだけをcatalog transactionでcommitする |
| TC-identity-171 | pruneExpiredAuthState: reshard中 — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 旧新generationを最大32 shard・同時6接続で処理し、cursor generationを混在させない |
| TC-identity-172 | pruneExpiredAuthState: 同じhourのCronが同時に2回起動する — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 同じrun leaseを原子的にclaimし、片方はno-opとなってactive laneは最大6のまま |
| TC-identity-173 | pruneExpiredAuthState: 32 shardのrunが次hourにも未完了 — 次hourのCronを起動する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 新しいrunを作らず最古running runの固定`asOf` / positionを再開し、kind全体でactive laneを6以下に保つ |
| TC-identity-174 | pruneExpiredAuthState: lane owner停止後に10分leaseが切れる — 次Cronで回復する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 同じrun/table/cursor positionを新ownerがclaimし、重複runを作らず完了まで進める |
| TC-identity-175 | pruneExpiredAuthState: completed maintenance runが30日を越えて250件ある — Cronを実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | `(expiresAt, runId)` keysetで100件ずつ回収し、running runは削除しない |
| TC-identity-176 | pruneExpiredAuthState: completed runの`expiresAt`が固定`asOf`と同時刻 — 共通prunerを実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | `expiresAt <= asOf`として回収し、1ミリ秒後の行は残す |
| TC-identity-177 | pruneExpiredAuthState: completed runが101件あり、最初の100件commit後に応答を失う — 共通prunerを再実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | 同じcursorから冪等に再実行し、100+1件を欠落なく回収する |
| TC-identity-178 | pruneExpiredAuthState: LoginAttempt/OAuthStateが同じ`expiresAt`で101件ある — 実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | それぞれ`key` / `state`をtie-breakにした複合keysetで100+1件を重複・欠落なく回収する |
| TC-identity-179 | removeIdentity: パスワードと Google の 2 件を持つ利用者 — Google を解除する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | `Identity` が削除され、`identity.identity.removed` が発行される |
| TC-identity-180 | removeIdentity: 認証手段が 1 件だけの利用者 — その 1 件を解除する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | `BusinessRuleError(LastIdentityCannotBeRemoved)` が投げられ、削除されない |
| TC-identity-181 | removeIdentity: 他の利用者の認証手段を指定する — 解除する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | `NotFoundError("IDENTITY_NOT_FOUND")` が投げられる |
| TC-identity-182 | removeIdentity: 存在しない ID を指定する — 解除する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | `NotFoundError("IDENTITY_NOT_FOUND")` が投げられる |
| TC-identity-183 | removeIdentity: Google Drive 連携がある利用者 — Google の認証手段を解除する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | Drive 連携は残る |
| TC-identity-184 | removeIdentity: Google Identityを解除する — provider directoryを確認する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | Identity削除後にproviderAccount reservationがreleaseされ、別の利用者が同じGoogle accountをリンクできる |
| TC-identity-185 | removeIdentity: Identity削除commit後に応答を失う — 同じ解除を再送する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | local receiptから削除済み成功を返し、outbox consumerが固定済みprovider keyを同じoperation IDでreleaseする |
| TC-identity-186 | removeIdentity: 2 件のうち 2 件を同時に解除しようとする — 並行して実行する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | 少なくとも 1 件は `BusinessRuleError(LastIdentityCannotBeRemoved)` になり、0 件にはならない |
| TC-identity-187 | requestPasswordReset: パスワード認証手段を持つ利用者がいる — 再設定を要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | 既存の再設定トークンが削除され、新しいトークンで再設定メールが送られる |
| TC-identity-188 | requestPasswordReset: Google のみで登録した利用者がいる — 再設定を要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | `passwordResetUnavailable` の案内メールが送られ、再設定トークンは作られない |
| TC-identity-189 | requestPasswordReset: `DeletingUser`のメールアドレス — 再設定を要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | 未登録と同じ成功応答で、tokenもメールも発行しない |
| TC-identity-190 | requestPasswordReset: 未登録のメールアドレス — 再設定を要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | メールは送られず、成功として返る（存在を漏らさない） |
| TC-identity-191 | requestPasswordReset: — — 形式が不正なメールアドレスで要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | `BusinessRuleError(InvalidEmail)` が投げられる |
| TC-identity-192 | requestPasswordReset: 同じメールアドレスへの要求が連続する — 要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | 60 秒の発行間隔に掛かり、新しいトークンは発行されず、メールも送られず成功として返る |
| TC-identity-193 | requestPasswordReset: 既存の再設定トークンが未消費で残っており、発行から 60 秒以上経過している — 再度要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | 古いトークンは無効になり、新しいトークンだけが有効になる |
| TC-identity-194 | resendVerificationEmail: `PendingUser` が存在する — 再送を要求する | spec/testcases/identity/resendVerificationEmail.md#テストケース-resendverificationemail | 既存の確認トークンが削除され、新しいトークンで確認メールが送られる |
| TC-identity-195 | resendVerificationEmail: 直近 59 秒以内に再送済み — 再送を要求する | spec/testcases/identity/resendVerificationEmail.md#テストケース-resendverificationemail | メールは送られず、成功として返る |
| TC-identity-196 | resendVerificationEmail: 直近 61 秒前に再送済み — 再送を要求する | spec/testcases/identity/resendVerificationEmail.md#テストケース-resendverificationemail | 新しいメールが送られる（間隔制限の境界値） |
| TC-identity-197 | resendVerificationEmail: `ActiveUser` が存在する — 再送を要求する | spec/testcases/identity/resendVerificationEmail.md#テストケース-resendverificationemail | メールは送られず、成功として返る |
| TC-identity-198 | resendVerificationEmail: 未登録のメールアドレス — 再送を要求する | spec/testcases/identity/resendVerificationEmail.md#テストケース-resendverificationemail | メールは送られず、成功として返る（存在を漏らさない） |
| TC-identity-199 | resendVerificationEmail: — — 形式が不正なメールアドレスで要求する | spec/testcases/identity/resendVerificationEmail.md#テストケース-resendverificationemail | `BusinessRuleError(InvalidEmail)` が投げられる |
| TC-identity-200 | resetPassword: 有効な再設定トークンとパスワード認証手段がある — 新しいパスワードで実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | ハッシュとUserの`authEpoch`が更新され、トークンが `consumed` になり、全sessionは物理削除前から無効になる |
| TC-identity-201 | resetPassword: 発行から 59 分経過したトークン — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | 成功する（有効期限の境界値） |
| TC-identity-202 | resetPassword: 発行から 1 時間経過したトークン — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | `BusinessRuleError(TokenExpired)` が投げられる |
| TC-identity-203 | resetPassword: 消費済みのトークン — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる |
| TC-identity-204 | resetPassword: 発行後にUserの`authEpoch`が進んだトークン — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | 旧世代として`NotFoundError("AUTH_TOKEN_NOT_FOUND")`になり、パスワードを変更しない |
| TC-identity-205 | resetPassword: tokenの利用者が`deleting`へ遷移済み — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | `NotFoundError("AUTH_TOKEN_NOT_FOUND")`でUserをactiveへ戻さず、削除を継続する |
| TC-identity-206 | resetPassword: 用途が `email_verification` のトークン — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる |
| TC-identity-207 | resetPassword: 有効なトークンがあるがパスワード認証手段を持たない — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | `PasswordIdentity` が新規に作られ、パスワードが設定される |
| TC-identity-208 | resetPassword: — — 強度要件を満たさないパスワードで実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | `BusinessRuleError(WeakPassword)` が投げられ、トークンは消費されない |
| TC-identity-209 | resetPassword: 実行前に別の端末でサインイン中 — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | その端末のセッションが無効になる |
| TC-identity-210 | resetPassword: セッションが10,000件ある — 実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | Userの世代更新で即時失効し、行は100件ずつ継続回収する |
| TC-identity-211 | resetPassword: 同じトークンで 2 つの要求が同時に走る — 両方が実行する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | 片方が成功し、負けた側はトークンの保存が `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` になるため、パスワードの差し替えごと巻き戻して `NotFoundError("AUTH_TOKEN_NOT_FOUND")` を返す |
| TC-identity-212 | resetPassword: 並行消費で負けた側 — パスワードを確認する | spec/testcases/identity/resetPassword.md#テストケース-resetpassword | 先に成立した再設定のパスワードが残り、後から上書きされない（`verifyEmail` と違って成功に落とさないのは、勝った側と負けた側で設定されるパスワードが異なるため） |
| TC-identity-213 | signInWithPassword: `ActiveUser` とパスワード認証手段がある — 正しいメールとパスワードでサインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | セッションが発行され、失敗回数が 0 に戻る |
| TC-identity-214 | signInWithPassword: `ActiveUser` がある — 誤ったパスワードでサインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("INVALID_CREDENTIALS")` が投げられ、失敗回数が 1 増える |
| TC-identity-215 | signInWithPassword: 未登録のメールアドレス — サインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("INVALID_CREDENTIALS")` が投げられる（利用者不在と区別されない） |
| TC-identity-216 | signInWithPassword: Google のみで登録した利用者 — メールとパスワードでサインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("INVALID_CREDENTIALS")` が投げられる |
| TC-identity-217 | signInWithPassword: `PendingUser` がある — 正しいパスワードでサインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられ、セッションは発行されない |
| TC-identity-218 | signInWithPassword: 失敗が 2 回記録されている — 3 回目に失敗する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("THROTTLED")` が投げられ、待機秒数が添えられる |
| TC-identity-219 | signInWithPassword: 失敗が 9 回記録されている — 10 回目に失敗する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("LOCKED")` が投げられ、解除時刻が添えられる |
| TC-identity-220 | signInWithPassword: ロック中 — 正しいパスワードでサインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("LOCKED")` が投げられる |
| TC-identity-221 | signInWithPassword: ロックの期限が切れている（10 回目の失敗から 15 分経過） — 正しいパスワードでサインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | サインインが成功する |
| TC-identity-222 | signInWithPassword: ロックが解けた直後（`failureCount` は 10 のまま） — 誤ったパスワードで失敗する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | 待機は上限の 60 秒になり、`lastFailedAt` が更新されて再びロックに入る（保存していたときと同じ振る舞い） |
| TC-identity-223 | signInWithPassword: — — レート制限の鍵を確認する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `LoginAttemptKey.forSignIn(email, clientKey)` で `signIn:{正規化済みメールアドレス}:{clientKey}` の形に組み立てられる |
| TC-identity-224 | signInWithPassword: 同じメールアドレスに別の `clientKey` から失敗する — 失敗を記録する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | 鍵が異なるため別の行になり、互いの待機・ロックに影響しない |
| TC-identity-225 | signInWithPassword: 同じ利用者が共有リンクのパスワード照合で失敗している — サインインに失敗する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | 名前空間が `signIn:` と `share:` で分かれているため同じ行に集まらず、互いのロックを誘発しない |
| TC-identity-226 | signInWithPassword: 認証に失敗した（利用者不在・手段なし・パスワード相違） — 失敗を記録する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `LoginAttemptStore.recordFailure(key, now, LoginThrottlePolicy.attemptTtlMs)` が呼ばれ、TTL は 24 時間になる。戻り値は加算後の `LoginAttempt` |
| TC-identity-227 | signInWithPassword: 同じ鍵に対して失敗が並行して 10 件届く — すべて処理する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `failureCount` が 10 になる（1 件も取りこぼさない）。`recordFailure` は単一の原子的な操作でなければならず、「読んでから書く」実装だと要求を並列化するだけで施錠を回避できる |
| TC-identity-228 | signInWithPassword: 加算後の記録がしきい値に達した — 応答を確認する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | 返ってきた加算後の値を `evaluate` して `THROTTLED` / `LOCKED` を決め、待機秒数・解除時刻もその `ThrottleDecision` から取る |
| TC-identity-229 | signInWithPassword: 手順 2 の `get` が古い値を返した — サインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | 判定が緩む方向に外れても、その試行の失敗は手順 4 で必ず数えられるため施錠は追いつく |
| TC-identity-230 | signInWithPassword: `LoginAttempt` の形 — 保持する項目を確認する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `key` / `failureCount` / `lastFailedAt` の 3 つで、`lockedUntil` は持たない（ロックは `evaluate` が `failureCount >= 10` かつ `now < lastFailedAt + 15 分` として導出する） |
| TC-identity-231 | signInWithPassword: 記録の TTL — ロック期間と比べる | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | 24 時間はロック期間の 15 分より十分長く、ロック中の記録が期限切れで消えて総当たりが続けられることがない |
| TC-identity-232 | signInWithPassword: 認証に成功した — 記録を確認する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `LoginAttemptStore.clear(key)` が呼ばれ、期限を待たず失敗の記録が消える |
| TC-identity-233 | signInWithPassword: `PendingUser` で正しいパスワードを送った — 記録を確認する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `recordFailure` は呼ばれない（資格情報は正しく、再送すれば通る状態のため失敗として記録しない） |
| TC-identity-234 | signInWithPassword: `DeletingUser`で正しいパスワードを送った — サインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `ValidationError("ACCOUNT_DELETING")`でSessionを発行しない |
| TC-identity-235 | signInWithPassword: 待機中・ロック中と判定された — 照合の有無を確認する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | `UserRepository.findByEmail` 以降の照合を行わずに `THROTTLED` / `LOCKED` を返す |
| TC-identity-236 | signInWithPassword: `LoginAttemptStore` への書き込み — トランザクションの境界を確認する | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | Unit of Work には入れない（記録は集約の不変条件に関与せず、例外を投げる経路でも書き込みが残らなければレート制限が機能しないため） |
| TC-identity-237 | signInWithPassword: `recordFailure` / `clear` の書き込みが失敗した — サインインする | spec/testcases/identity/signInWithPassword.md#テストケース-signinwithpassword | 記録して継続し、認証の結果そのものは変えない |
| TC-identity-238 | signOut: 有効なセッションがある — サインアウトする | spec/testcases/identity/signOut.md#テストケース-signout | セッションが削除され、以降そのトークンでは認証できない |
| TC-identity-239 | signOut: 既に削除済みのセッション — サインアウトする | spec/testcases/identity/signOut.md#テストケース-signout | エラーにならず成功として返る |
| TC-identity-240 | signOut: 存在しないトークン — サインアウトする | spec/testcases/identity/signOut.md#テストケース-signout | エラーにならず成功として返る |
| TC-identity-241 | signOut: 同じ利用者が複数のセッションを持つ — 片方でサインアウトする | spec/testcases/identity/signOut.md#テストケース-signout | もう片方のセッションは有効なまま残る |
| TC-identity-242 | signOutOtherSessions: 同じ利用者に 3 件のセッションがある — 1 件を現在のセッションとして実行する | spec/testcases/identity/signOutOtherSessions.md#テストケース-signoutothersessions | Userの`authEpoch`が1進み、現在の1行だけが新世代へ追随して`revocationAccepted: true`を返す。他の2件は物理削除前から無効 |
| TC-identity-243 | signOutOtherSessions: セッションが 1 件のみ — 実行する | spec/testcases/identity/signOutOtherSessions.md#テストケース-signoutothersessions | 世代を進めて現在行を追随させ、`revocationAccepted: true`を返す |
| TC-identity-244 | signOutOtherSessions: 現在のセッションが期限切れ — 実行する | spec/testcases/identity/signOutOtherSessions.md#テストケース-signoutothersessions | `ValidationError("UNAUTHENTICATED")` が投げられ、削除は起きない |
| TC-identity-245 | signOutOtherSessions: 他の利用者のセッションが存在する — 実行する | spec/testcases/identity/signOutOtherSessions.md#テストケース-signoutothersessions | 他の利用者のセッションは削除されない |
| TC-identity-246 | signOutOtherSessions: 同じ利用者にセッションが10,000件ある — 実行する | spec/testcases/identity/signOutOtherSessions.md#テストケース-signoutothersessions | Userと現在Sessionの2行のcommitで即時失効し、旧世代行は100件ずつ継続回収する |
| TC-identity-247 | signUpWithPassword: 未登録のメールアドレス — 有効なメール・パスワード・表示名・規約同意で登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `PendingUser` と `PasswordIdentity` が作られ、確認メールが送られ、`emailVerificationRequired: true` / `sessionToken: null` が返る |
| TC-identity-248 | signUpWithPassword: 未登録のメールアドレス — 規約に同意せずに登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `ValidationError("TERMS_NOT_ACCEPTED")` が投げられ、利用者は作られない |
| TC-identity-249 | signUpWithPassword: — — 形式が不正なメールアドレスで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `BusinessRuleError(InvalidEmail)` が投げられる |
| TC-identity-250 | signUpWithPassword: — — 7 文字のパスワードで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `BusinessRuleError(WeakPassword)` が投げられる |
| TC-identity-251 | signUpWithPassword: — — 128 文字のパスワード（英数字を含む）で登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | 登録が成功する（上限の境界値） |
| TC-identity-252 | signUpWithPassword: — — 129 文字のパスワードで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `BusinessRuleError(WeakPassword)` が投げられる |
| TC-identity-253 | signUpWithPassword: — — 数字のみ 10 文字のパスワードで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `BusinessRuleError(WeakPassword)` が投げられる |
| TC-identity-254 | signUpWithPassword: — — 空白のみの表示名で登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `BusinessRuleError(InvalidDisplayName)` が投げられる |
| TC-identity-255 | signUpWithPassword: 既に登録済みのメールアドレス — 同じメールアドレスで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | 新しい利用者は作られず、`existingAccountNotice` のメールが送られ、応答は未登録のときと同じ |
| TC-identity-256 | signUpWithPassword: 有効な招待トークンがあり、招待先と同じメールアドレス — 招待トークンつきで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `ActiveUser` が作られ、確認メールは送られず、`sessionToken` が返る |
| TC-identity-257 | signUpWithPassword: 有効な招待トークンがあり、招待先と異なるメールアドレス — 招待トークンつきで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | 通常の登録として扱われ、確認メールが送られる |
| TC-identity-258 | signUpWithPassword: 期限切れの招待トークン — 招待トークンつきで登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | 通常の登録として扱われ、エラーにはならない |
| TC-identity-259 | signUpWithPassword: メール送信基盤が失敗する — 有効な入力で登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | 登録は成功として返り、送信失敗が記録される |
| TC-identity-260 | signUpWithPassword: 短時間に同一発信元から大量の試行がある — 登録する | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | `ValidationError("RATE_LIMITED")` が投げられる |
| TC-identity-261 | signUpWithPassword: 同じメールアドレスで 2 つの要求が同時に走る — 同時に 2 つの登録要求を出す | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | 両方の応答 shape が同一（`emailVerificationRequired: true` / セッションなし）で、返る decoy id は別値。利用者はちょうど 1 人。一意性違反は `IdentityUniqueDirectory` のポート契約として送出されるが、ユースケースが畳む |
| TC-identity-262 | signUpWithPassword: email reservation確保後にUser保存が失敗する — recoveryする | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | reservationをreleaseし、同じemailが恒久的に塞がらない |
| TC-identity-263 | signUpWithPassword: User/Identity保存後にreservation activate応答を失う — recoveryする | spec/testcases/identity/signUpWithPassword.md#テストケース-signupwithpassword | User email/version一致を確認し、同じsub-operation IDでactiveへ収束する |
| TC-identity-264 | startOAuthFlow: — — `provider: "google"`, `intent: "signIn"` で開始する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | 認可 URL が返り、`state` と `codeVerifier` が 10 分の期限で保存される |
| TC-identity-265 | startOAuthFlow: Activeでサインイン済み — `intent: "linkIdentity"` と `userId` を指定して開始する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | 認可 URL が返り、保存された状態に `userId` とcurrent `userAuthEpoch`が含まれる |
| TC-identity-266 | startOAuthFlow: 削除開始済みまたは削除済み — `intent: "linkIdentity"` で開始する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | OAuth stateを作らず、`UnauthorizedError("UNAUTHENTICATED")` が投げられる（認証済み利用者として扱わない） |
| TC-identity-267 | startOAuthFlow: — — `intent: "linkIdentity"` で `userId` を省略する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | `ValidationError("USER_REQUIRED")` が投げられる |
| TC-identity-268 | startOAuthFlow: — — 未知のプロバイダーを指定する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | `BusinessRuleError(InvalidProviderAccount)` が投げられる |
| TC-identity-269 | startOAuthFlow: — — `redirectTo` に外部オリジンの URL を指定する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | `ValidationError("INVALID_REDIRECT")` が投げられる |
| TC-identity-270 | startOAuthFlow: — — `redirectTo` に相対パスを指定する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | 認可 URL が返り、保存された状態に `redirectTo` が含まれる |
| TC-identity-271 | startOAuthFlow: — — 2 回続けて開始する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | 異なる `state` が 2 件保存され、どちらも有効 |
| TC-identity-272 | updateProfile: `ActiveUser` がいる — 表示名と自己紹介を更新する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 値が更新され、公開ページの表示に反映される |
| TC-identity-273 | updateProfile: 公開ノートを持つ `ActiveUser` — 表示名を変更する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `identity.user.profileUpdated` が発行され、`projectNoteChanges` が読み取りモデルの著者表示名を更新する（検索結果・公開ページの著者名に反映される） |
| TC-identity-274 | updateProfile: 公開ノートを持つ `ActiveUser` — 表示名は変えず自己紹介だけを更新する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `identity.user.profileUpdated` は発行されず、読み取りモデルは更新されない |
| TC-identity-275 | updateProfile: ハンドル未設定の `ActiveUser` — 未使用のハンドルを設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | ハンドルが設定され、`User.assignHandle` が `identity.user.handleChanged`（`previousHandle: null`）を**初回設定でも無条件で**発行する |
| TC-identity-276 | updateProfile: ハンドル未設定のままワークスペース所有の公開ノートを作っていた `ActiveUser` — ハンドルを初めて設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `note_routes(created_by)` のbounded fan-outが各Noteをversion付き完全snapshotで再投影し、`author_handle` が埋まる |
| TC-identity-277 | updateProfile: 初回設定後 — `searchPublicNotes` の結果を確認する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 該当ノートに著者リンクが出る |
| TC-identity-278 | updateProfile: ハンドルを設定済みから別の値に変更する — 変更する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 同じく `identity.user.handleChanged`（`previousHandle` は旧ハンドル）が発行され、購読側は初回設定と変更を区別せず現在値で上書きする |
| TC-identity-279 | updateProfile: 他の利用者が使用中のハンドル — そのハンドルを設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `ConflictError("HANDLE_ALREADY_USED")` が投げられる |
| TC-identity-280 | updateProfile: 新handle reservation後・UserId shard更新前に失敗する — 再試行する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 同じoperation IDで予約を再利用し、User更新後にactivateする |
| TC-identity-281 | updateProfile: UserId shard更新後・reservation activate応答を失う — recoveryする | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | User versionと値が一致するためactivateし、旧handle reservationをreleasingへ進める |
| TC-identity-282 | updateProfile: — — 2 文字のハンドルを設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `BusinessRuleError(InvalidHandle)` が投げられる |
| TC-identity-283 | updateProfile: — — 3 文字のハンドルを設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 成功する（長さの境界値） |
| TC-identity-284 | updateProfile: — — 30 文字のハンドルを設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 成功する（長さの境界値） |
| TC-identity-285 | updateProfile: — — 31 文字のハンドルを設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `BusinessRuleError(InvalidHandle)` が投げられる |
| TC-identity-286 | updateProfile: — — 予約語（`settings`）をハンドルに設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `BusinessRuleError(HandleReserved)` が投げられる |
| TC-identity-287 | updateProfile: — — 大文字を含むハンドルを設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 小文字に正規化されて保存される |
| TC-identity-288 | updateProfile: ハンドル設定済み — ハンドルを空文字列にする | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | ハンドルが解除され、`user.handleChanged` が発行される |
| TC-identity-289 | updateProfile: ハンドル設定済みで公開ノートがある — ハンドルを変更する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | 旧ハンドルの URL は「見つかりません」になり、新しい URL で到達できる |
| TC-identity-290 | updateProfile: `PendingUser` — 更新する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられる |
| TC-identity-291 | updateProfile: — — 51 文字の表示名にする | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `BusinessRuleError(InvalidDisplayName)` が投げられる |
| TC-identity-292 | updateProfile: — — 501 文字の自己紹介にする | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `BusinessRuleError(InvalidBio)` が投げられる |
| TC-identity-293 | updateProfile: 同時に別の要求が同じ利用者を更新した — 更新する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-identity-294 | verifyEmail: 有効な確認トークンと `PendingUser` — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | 利用者が `ActiveUser` になり、トークンが `consumed` になり、セッションが発行される |
| TC-identity-295 | verifyEmail: 発行から 23 時間 59 分経過したトークン — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | 確認が成功する（有効期限の境界値） |
| TC-identity-296 | verifyEmail: 発行から 24 時間経過したトークン — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | `BusinessRuleError(TokenExpired)` が投げられ、利用者は `PendingUser` のまま |
| TC-identity-297 | verifyEmail: 既に消費済みのトークンで、利用者は `ActiveUser` — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | `alreadyVerified: true` が返り、セッションは発行されない |
| TC-identity-298 | verifyEmail: 存在しないトークン — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる |
| TC-identity-299 | verifyEmail: 用途が `password_reset` のトークン — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | `NotFoundError("AUTH_TOKEN_NOT_FOUND")` が投げられる |
| TC-identity-300 | verifyEmail: トークンに対応する利用者が削除済み — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | `NotFoundError("USER_NOT_FOUND")` が投げられる |
| TC-identity-301 | verifyEmail: token発行後にUserの`authEpoch`が進んだ — トークンを送る | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | 旧世代tokenとして`NotFoundError("AUTH_TOKEN_NOT_FOUND")`。物理行が残っていてもsessionを発行しない |
| TC-identity-302 | verifyEmail: 同じトークンで 2 つの要求が同時に走る — 両方が確認する | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | 片方が成功してセッションを受け取り、負けた側はトークンの条件付き更新が `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` になる。トランザクションを巻き戻したうえで利用者を引き直し、`active` なら `alreadyVerified: true` を返す（セッションは発行しない）。確認が二重に成立することも、失敗として見えることもない |
| TC-identity-303 | verifyEmail: 並行消費で負けた側 — 応答を確認する | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | エラーにはならず `alreadyVerified: true` が返り、セッションは増えない |
| TC-identity-304 | verifyEmail: 並行消費で負けた側 — トークンと利用者の状態を確認する | spec/testcases/identity/verifyEmail.md#テストケース-verifyemail | トークンは勝った側の消費のまま 1 回だけ `consumed` になり、利用者は `ActiveUser` のままである |
| TC-identity-305 | getProfile: `ActiveUser` が自分のプロフィールを持つ — 自分のプロフィールを読む | spec/testcases/identity/getProfile.md#テストケース-getprofile | `userId` / `displayName` / `bio` / `avatarUrl` / `handle` が返る |
| TC-identity-306 | getProfile: パスワード認証手段を持つ `ActiveUser` — 自分のプロフィールを読む | spec/testcases/identity/getProfile.md#テストケース-getprofile | 応答にパスワードのハッシュやトークンが含まれない |
| TC-identity-307 | getProfile: 利用者が不在または削除済み — 読み出す | spec/testcases/identity/getProfile.md#テストケース-getprofile | `NotFoundError("USER_NOT_FOUND")` が投げられる |
| TC-identity-308 | getProfile: `PendingUser` — 読み出す | spec/testcases/identity/getProfile.md#テストケース-getprofile | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられる |
| TC-identity-309 | getProfile: `DeletingUser` — 読み出す | spec/testcases/identity/getProfile.md#テストケース-getprofile | `ValidationError("ACCOUNT_UNAVAILABLE")` が投げられる |
| TC-identity-310 | checkHandleAvailability: 誰も使っていないハンドル — 利用可否を問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | `available: true` / `ownedBySelf: false` が返る |
| TC-identity-311 | checkHandleAvailability: 自分が既に使っているハンドル — 利用可否を問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | `available: true` / `ownedBySelf: true` が返る |
| TC-identity-312 | checkHandleAvailability: 他人が使っているハンドル — 利用可否を問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | `available: false` / `ownedBySelf: false` が返る |
| TC-identity-313 | checkHandleAvailability: 他の要求が予約しただけで確定していない（`reserved`）ハンドル — 利用可否を問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | 空きとして返る（助言的な読み取りで、勝者は `updateProfile` の予約が決める） |
| TC-identity-314 | checkHandleAvailability: — — 形式が不正なハンドルで問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | `BusinessRuleError(InvalidHandle)` が投げられる |
| TC-identity-315 | checkHandleAvailability: — — 予約語のハンドルで問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | `BusinessRuleError(HandleReserved)` が投げられる |
| TC-identity-316 | completeOAuthCallback: `intent: "signIn"` の state が保存されている — コールバックを処理する | spec/testcases/identity/completeOAuthCallback.md#テストケース-completeoauthcallback | `intent: "signIn"` arm が返り、`sessionToken` を運ぶ |
| TC-identity-317 | completeOAuthCallback: `intent: "linkIdentity"` の state が保存されている — コールバックを処理する | spec/testcases/identity/completeOAuthCallback.md#テストケース-completeoauthcallback | `intent: "linkIdentity"` arm が返り、`identityId` と `redirectTo` を運ぶ |
| TC-identity-318 | completeOAuthCallback: 経路の `:provider` が state に保存されたものと一致しない — コールバックを処理する | spec/testcases/identity/completeOAuthCallback.md#テストケース-completeoauthcallback | state を無効として扱い、`ValidationError("OAUTH_STATE_INVALID")` が投げられる |
| TC-identity-319 | completeOAuthCallback: state が存在しない・期限切れ — コールバックを処理する | spec/testcases/identity/completeOAuthCallback.md#テストケース-completeoauthcallback | `ValidationError("OAUTH_STATE_INVALID")` が投げられる |
| TC-identity-320 | completeOAuthCallback: — — 同じ state で 2 回続けて処理する | spec/testcases/identity/completeOAuthCallback.md#テストケース-completeoauthcallback | 2 回目は state が消費済みのため `ValidationError("OAUTH_STATE_INVALID")` が投げられる |
| TC-identity-321 | requestPasswordReset: 直近 59 秒以内に要求済み — 再設定を要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | 新しいトークンは発行されず、成功として返る |
| TC-identity-322 | requestPasswordReset: 直近 61 秒前に要求済み — 再設定を要求する | spec/testcases/identity/requestPasswordReset.md#テストケース-requestpasswordreset | 新しい再設定メールが送られる（間隔制限の境界値） |
| TC-identity-323 | addPasswordIdentity: 再認証が済んでいない — パスワードを追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | `ValidationError("REAUTHENTICATION_REQUIRED")` が投げられ、`PasswordIdentity` は作られない |
| TC-identity-324 | addPasswordIdentity: 利用者が不在 — パスワードを追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | `NotFoundError("USER_NOT_FOUND")` が投げられる |
| TC-identity-325 | addPasswordIdentity: 利用者が `ActiveUser` でない（`PendingUser` / `DeletingUser`） — パスワードを追加する | spec/testcases/identity/addPasswordIdentity.md#テストケース-addpasswordidentity | `ValidationError("ACCOUNT_UNAVAILABLE")` が投げられる |
| TC-identity-326 | checkHandleAvailability: 自分が既に使っているハンドルを大文字小文字・前後の空白の違う表記で指定する — 利用可否を問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | 入力を正規化してから判定し、`available: true` / `ownedBySelf: true` が返る |
| TC-identity-327 | checkHandleAvailability: 解除待ち（`releasing`）の claim が残っているハンドル — 利用可否を問い合わせる | spec/testcases/identity/checkHandleAvailability.md#テストケース-checkhandleavailability | 空きとして返る（`resolve` は恒久 claim の持ち主だけを返す。保存は `updateProfile` の予約が拒みうる） |
| TC-identity-328 | completeOAuthCallback: `intent: "integration"` の state が保存されている — コールバックを処理する | spec/testcases/identity/completeOAuthCallback.md#テストケース-completeoauthcallback | 本スライスに受け皿が無いため state を無効として扱い、`ValidationError("OAUTH_STATE_INVALID")` が投げられる（受け皿は外部連携スライスの `completeIntegrationOAuth`） |
| TC-identity-329 | getProfile: 一度も編集していない `ActiveUser` — 自分のプロフィールを読む | spec/testcases/identity/getProfile.md#テストケース-getprofile | 登録時の既定が返る（`bio` は空文字列、`handle` と `avatarUrl` は `null`） |
| TC-identity-330 | completeOAuthSignIn: directory の claim は残っているが対応する identity が居ない — 同じプロバイダーアカウントで認可コードを交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` が投げられ、セッションは発行されない（他人が持っている `PROVIDER_ACCOUNT_ALREADY_LINKED` とは別のコード — [ADR 038](../adr/038-provider-account-claim-and-identity-row.md)） |
| TC-identity-331 | linkOAuthIdentity: directory の claim は残っているが対応する identity が居ない — 解除した直後の同じプロバイダーアカウントをリンクする | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` が投げられ、`Identity` は追加されない（他人が持っている `PROVIDER_ACCOUNT_ALREADY_LINKED` とは別のコード — [ADR 038](../adr/038-provider-account-claim-and-identity-row.md)） |
| TC-identity-332 | updateProfile: `ActiveUser` がいる — object store が払い出したアプリ相対パス（`/storage/...`）をアイコンに設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `AvatarUrl` として受理され、射影の `avatarUrl` にその値がそのまま返る |
| TC-identity-333 | updateProfile: — — 別オリジンの絶対 URL をアイコンに設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `BusinessRuleError(InvalidAvatarUrl)` が投げられる |
| TC-identity-334 | updateProfile: — — プロトコル相対の値（`//` で始まる）をアイコンに設定する | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | `BusinessRuleError(InvalidAvatarUrl)` が投げられる（`//` はアプリ相対パスとして扱わない） |
| TC-identity-335 | updateProfile: アイコンを設定済みの `ActiveUser` — `avatarUrl` に `null` を渡す | spec/testcases/identity/updateProfile.md#テストケース-updateprofile | アイコンが解除され、射影の `avatarUrl` が `null` になる |
| TC-identity-336 | startOAuthFlow: — — `provider: "google"`, `intent: "signIn"` で開始する | spec/testcases/identity/startOAuthFlow.md#テストケース-startoauthflow | 保存された `stateBindingHash` が、応答が返す `stateBinding` の `hashOf` と一致する。かつ `stateBinding` は認可 URL から読んだ `state`（応答には含まれない）と異なり、`stateBindingHash` は `state` の `hashOf` とも一致しない（束縛は `state` から導けない — [ADR 034](../adr/034-oauth-callback-browser-binding.md)） |
| TC-identity-337 | completeOAuthCallback: `intent: "signIn"` の state が保存されている — 束縛の秘密が一致しない `stateBinding` でコールバックを処理する | spec/testcases/identity/completeOAuthCallback.md#テストケース-completeoauthcallback | `ValidationError("OAUTH_STATE_INVALID")` が投げられ、state 行は消費されない。続けて正しい `stateBinding` で処理すると完了できる |
| TC-identity-338 | abandonOAuthFlow: フローの `state` が保存されている — 一致する `stateBinding` で放棄する | spec/testcases/identity/abandonOAuthFlow.md#テストケース-abandonoauthflow | `abandoned: true` が返り、state 行が解放される（TTL を待たない） |
| TC-identity-339 | abandonOAuthFlow: フローの `state` が保存されている — 一致しない `stateBinding` で放棄する | spec/testcases/identity/abandonOAuthFlow.md#テストケース-abandonoauthflow | `abandoned: false` が返り、state 行は残る（他人の進行中フローを壊せない） |
| TC-identity-340 | abandonOAuthFlow: `state` が保存されていない — 放棄する | spec/testcases/identity/abandonOAuthFlow.md#テストケース-abandonoauthflow | `abandoned: false` が返る（エラーにはしない） |
| TC-identity-341 | completeOAuthSignIn: 有効な `state` がある — 束縛の秘密が一致しない `stateBinding` で交換する | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `ValidationError("OAUTH_STATE_INVALID")` が投げられ、state 行は消費されない。続けて正しい `stateBinding` で交換すると完了できる |
| TC-identity-342 | removeIdentity: 解放判定 UoW が commit した直後に、先行配送の解放と本人の再連携が割り込む | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | 判定より前に観測した claim は既に張り替わっているので取り壊しは no-op になり、`resolve("providerAccount", key)` は本人を返し続け、再連携された identity 行も残る |
| TC-identity-343 | linkOAuthIdentity: 予約サガが commit 後・`activate` 前で止まり、`reserved` が TTL 失効したあと、残骸を含めて上限 8 件の利用者が再連携する | spec/testcases/identity/linkOAuthIdentity.md#テストケース-linkoauthidentity | `IdentityLimitExceeded` にならず、identity は 8 件のままで、返る `identityId` は既存行の ID、claim が `active` に復旧する |
| TC-identity-344 | completeOAuthSignIn: 既存利用者への追加が commit 後・`activate` 前で止まり、`reserved` が TTL 失効したあと、残骸を含めて上限 8 件の利用者が再サインインする | spec/testcases/identity/completeOAuthSignIn.md#テストケース-completeoauthsignin | `IdentityLimitExceeded` にならず、identity は 8 件のままで、claim が `active` に復旧し、セッションが発行される |
| TC-identity-345 | removeIdentity: `beginRelease` 済み・`release` 前で中断した解放の removal event を再配送する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | 観測が null でも `release(operationId)` が走って `releasing` 行が回収され、別の利用者がその鍵を `reserve` できる |
| TC-identity-346 | removeIdentity: 解放が完了したあと別の利用者が同じ provider account を連携した状態で、同じ removal event を再配送する | spec/testcases/identity/removeIdentity.md#テストケース-removeidentity | 所有者が一致しない claim は観測が null になるため取り壊しは走らず、claim は `active` のままその利用者が持ち続け、連携した identity 行も残る |
| TC-identity-347 | pruneExpiredAuthState: runの表集合が現行コードの既定順と違う（表構成を変えたデプロイをまたいでresumeする） — Cronを実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | runのスナップショットの順に最後まで進み、順序ずれで停滞しない |
| TC-identity-348 | pruneExpiredAuthState: shard数が同時claim上限（6）を超える — Cronを実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | ackが返す次laneをそのまま処理し、解放して取り直す往復をしない |
| TC-identity-349 | pruneExpiredAuthState: runの表集合にこの配備がsweepを持たない表が含まれる — Cronを実行する | spec/testcases/identity/pruneExpiredAuthState.md#テストケース-pruneexpiredauthstate | その表を飛ばしてrunを完走させ、飛ばした事実をrun / laneを特定できる形でログに残し、失敗には数えない |
| TC-integration-001 | completeIntegrationOAuth: 有効な `state` と未連携の OpenRouter — 認可コードを交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | 連携が作られ、既定のモデル設定が入り、`reconnected: false` が返る |
| TC-integration-002 | completeIntegrationOAuth: 既に連携済み — 認可コードを交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | 資格情報が差し替わり、既存の設定が維持され、`reconnected: true` が返る |
| TC-integration-003 | completeIntegrationOAuth: 失効した連携がある — 認可コードを交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `status: "active"` に戻り、設定が維持される |
| TC-integration-004 | completeIntegrationOAuth: `state` が保存されていない — 交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `ValidationError("OAUTH_STATE_INVALID")` が投げられる |
| TC-integration-005 | completeIntegrationOAuth: 同じ `state` を 2 回使う — 2 回目に交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `ValidationError("OAUTH_STATE_INVALID")` が投げられる |
| TC-integration-006 | completeIntegrationOAuth: Drive で必要なスコープが不足 — 交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `ValidationError("OAUTH_SCOPE_INSUFFICIENT")` が投げられ、連携は作られない |
| TC-integration-007 | completeIntegrationOAuth: Drive でリフレッシュトークンが得られない — 交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `ValidationError("OAUTH_REFRESH_TOKEN_MISSING")` が投げられる |
| TC-integration-008 | completeIntegrationOAuth: 疎通確認が失敗する — 交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `ValidationError("CONNECTION_PROBE_FAILED")` が投げられ、連携は作られない |
| TC-integration-009 | completeIntegrationOAuth: 交換後 — 保存された資格情報を確認する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | 暗号化されて保存されている |
| TC-integration-010 | completeIntegrationOAuth: OpenRouter を新規連携し、`awaitingIntegration` のノートが 3 件ある — 交換後に応答を確認する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `NoteQueryService.countByContentStatus` で数えた `awaitingIntegrationCount: 3` が返り、P-23 が「3 件のノートが本文の生成を待っています」と案内してノート一覧への導線を出す（IN-01 手順 4） |
| TC-integration-011 | completeIntegrationOAuth: OpenRouter を新規連携し、`awaitingIntegration` のノートが 0 件 — 交換後に応答を確認する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `awaitingIntegrationCount: 0` が返り、案内は表示されない |
| TC-integration-012 | completeIntegrationOAuth: OpenRouter を再連携した（`reconnected: true`） — 交換後に応答を確認する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `awaitingIntegrationCount: null` が返る（件数の取得は新規連携時のみ） |
| TC-integration-013 | completeIntegrationOAuth: Google Drive を連携した — 交換後に応答を確認する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `awaitingIntegrationCount: null` が返る |
| TC-integration-014 | completeIntegrationOAuth: プロバイダーとの通信が失敗する — 交換する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `SystemError(ExternalServiceError)` が投げられる |
| TC-integration-015 | completeIntegrationOAuth: OAuth開始後にUserが`deleting`またはauth epoch更新済み — callbackを完了する | spec/testcases/integration/completeIntegrationOAuth.md#テストケース-completeintegrationoauth | `ValidationError("ACCOUNT_UNAVAILABLE")`でConnectionをinsert/reconnectせず、account cleanup後へ資格情報を残さない |
| TC-integration-016 | deleteBackupRecordsForNote: 完全削除されたノートにバックアップ記録が 2 件ある — `note.purged` を処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | 2 件の記録が削除され、`deletedCount: 2` が返る |
| TC-integration-017 | deleteBackupRecordsForNote: 処理後 — Drive 上のファイルを確認する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | 削除されない（バックアップは利用者自身の Drive にあり、扱いは利用者に委ねる。IN-09） |
| TC-integration-018 | deleteBackupRecordsForNote: 他のノートのバックアップ記録がある — 処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | 他のノートの記録は削除されない |
| TC-integration-019 | deleteBackupRecordsForNote: 記録の所有者が削除実行者と異なるメンバー — 処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | 所有者によらず、そのノートの記録がすべて削除される |
| TC-integration-020 | deleteBackupRecordsForNote: 対象ノートの記録が 1 件もない — 処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | 何もせず `deletedCount: 0` で成功として返る |
| TC-integration-021 | deleteBackupRecordsForNote: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | 2 回目は削除対象がなく `deletedCount: 0` で終わり、結果は変わらない（冪等） |
| TC-integration-022 | deleteBackupRecordsForNote: ワークスペース削除に伴う `note.purged` を受け取る — 処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | ワークスペース所有ノートの記録もこの経路で削除される（`backup_records` は owner 列を持たず `noteId` 経由でしか特定できないため） |
| TC-integration-023 | deleteBackupRecordsForNote: 記録が250件ある — 処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | 100件ずつ`integration.noteDeleteContinued`で再開し、同じ`deletionOperationId`を保持する |
| TC-integration-024 | deleteBackupRecordsForNote: personal account deletion由来 — 処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | personal scopeのcleanup owner receipt一致時だけ削除する |
| TC-integration-025 | deleteBackupRecordsForNote: 書き込みが失敗する — 処理する | spec/testcases/integration/deleteBackupRecordsForNote.md#テストケース-deletebackuprecordsfornote | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる |
| TC-integration-026 | deleteIntegrationsForUser: 退会処理中の利用者が OpenRouter と Drive を連携している — `scope: null`のglobal cleanup commandを処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | global connection 2件だけを削除し、`deletedConnections: 2` / `deletedRecords: 0`を返す |
| TC-integration-027 | deleteIntegrationsForUser: 指定scopeに本人のバックアップ記録が5件ある — 当該`scope`のcleanup commandを処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | current scopeの記録5件だけを削除し、`deletedConnections: 0` / `deletedRecords: 5`を返す |
| TC-integration-028 | deleteIntegrationsForUser: global connectionと5scopeのbackup記録がある — account deletionを完了する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | orchestratorがglobal commandとscope別commandの全ackを集約し、単一commandでscopeを横断しない |
| TC-integration-029 | deleteIntegrationsForUser: `ActiveConnection` がある — 処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | それぞれ `IntegrationOAuthClient.revoke` が試みられてから削除される |
| TC-integration-030 | deleteIntegrationsForUser: 取り消し要求がプロバイダー側で失敗する — 処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 記録して継続し、削除は完了する |
| TC-integration-031 | deleteIntegrationsForUser: 処理後 — 保存されていた資格情報とバックアップ設定を確認する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 連携行ごと消えるため、暗号化済みトークンも `ConnectionSettings` も残らない |
| TC-integration-032 | deleteIntegrationsForUser: 処理後 — Drive 上のバックアップファイルを確認する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 削除されない（IN-09。`deleteBackupRecordsForNote` と同じ整理） |
| TC-integration-033 | deleteIntegrationsForUser: 処理後 — 発行されたイベントを確認する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | イベントは発行しない（実行中ジョブのキャンセルは `deleteAccount` の手順 3 で済んでいる） |
| TC-integration-034 | deleteIntegrationsForUser: 他の利用者の連携・バックアップ記録がある — 処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 他の利用者の連携も記録も削除されない |
| TC-integration-035 | deleteIntegrationsForUser: 連携が 1 件もない — 処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 何もせず `deletedConnections: 0` で成功として返る |
| TC-integration-036 | deleteIntegrationsForUser: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 2 回目は削除対象がなく 0 件で終わる。取り消し要求の再送も、既に無効なトークンへの失敗が記録されるだけで無害（冪等） |
| TC-integration-037 | deleteIntegrationsForUser: 書き込みが失敗する — 処理する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる |
| TC-integration-038 | deleteIntegrationsForUser: 1 scopeにBackupRecordが250件ある — cleanupする | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 100件ずつ3回に分け、`integration.userCleanupContinued`を同じoperation IDで再登録してから完了ackする |
| TC-integration-039 | deleteIntegrationsForUser: 100件目の削除後に応答を失う — recoveryする | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | 同じoperation IDで再開し、残件だけを削除して二重ackしない |
| TC-integration-040 | deleteIntegrationsForUser: membership removalが同じscopeで先行中 — account cleanupを実行する | spec/testcases/integration/deleteIntegrationsForUser.md#テストケース-deleteintegrationsforuser | committed account deletion lock/operation ownerを確認して同じscope Alarm列で直列化し、directory edge削除前にBackupRecordを0件まで回収する |
| TC-integration-041 | disconnectIntegration: OpenRouter が連携済み — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | HTTP 202で `operationId` / `status: accepted` が返り、connectionは処理完了まで安全な利用不可状態になる |
| TC-integration-042 | disconnectIntegration: 実行中の変換ジョブがある — OpenRouter を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | operation完了時にジョブがキャンセルされ、scope別進捗に反映される |
| TC-integration-043 | disconnectIntegration: 実行中のバックアップジョブがある — Drive を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | ジョブがキャンセルされる |
| TC-integration-044 | disconnectIntegration: 取り消し対象の絞り込み — 引くクエリを確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | `JobRepository.listActiveByRequesterAndKinds(userId, providerKinds, 100)` が最終述語をDBで適用する |
| TC-integration-045 | disconnectIntegration: 対象外jobが先頭に100件以上ある — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 対象外に遮られずprovider依存jobを最大100件処理できる |
| TC-integration-046 | disconnectIntegration: 網が 100 件を返した — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | current scopeの同じUoWで継続taskを積み、connection削除は全scope ack後まで待つ |
| TC-integration-047 | disconnectIntegration: 継続要求の `origin` — 内容を確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | `userId` と `provider` を運ぶ。スコープだけを運ぶ形では、続きが要求者の絞り込みも `kind` の絞り込みも失い、上の 3 行（`driveBackup` / `conversion` / `pdfExport` は対象外）を 2 巡目で破る |
| TC-integration-048 | disconnectIntegration: 同上 — `path` が失効の経路と分かれていることを確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | `integrationExpired` と別の `path` を持つ。両者は網も絞り込みも同じだが**当てる遷移が違う**（`cancel` と `fail`）ため、`path` で分けないと 2 巡目で遷移が入れ替わる |
| TC-integration-049 | disconnectIntegration: 実行中の `driveBackup` / `bulkBackup` のジョブがある — OpenRouter を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | `provider` に依存しない kind のため対象外で、取り消されない |
| TC-integration-050 | disconnectIntegration: 実行中の `conversion` / `regeneration` のジョブがある — Drive を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 同じく対象外で、取り消されない |
| TC-integration-051 | disconnectIntegration: 実行中の `pdfExport` / `bulkExport` / 一括操作系のジョブがある — いずれかを解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | どの連携にも依存しないため対象外で、取り消されない |
| TC-integration-052 | disconnectIntegration: `bulkBackup` の batch 親と子が実行中 — Drive を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | batch 親（`target.type === "batch"`）は直接は取り消さず、子の終端化の集計（`updateBatchProgress`）に委ねる（親を直接取り消すと、後から終端する子の `job.succeeded` が行き場を失い、親 `canceled` / 子 `succeeded` の食い違った履歴が残る） |
| TC-integration-053 | disconnectIntegration: 適用する遷移 — 履歴を確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 失効時の `Job.fail("providerAuthFailed")` ではなく `Job.cancel` を使い、履歴には「取り消された」として残る（利用者自身の操作による解除のため） |
| TC-integration-054 | disconnectIntegration: 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま — OpenRouter を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる（本文を作れなかった原因が資格情報の喪失ではなく利用者自身の操作のため。示す次の一手は「取り込み直す・再試行する」） |
| TC-integration-055 | disconnectIntegration: 同上 — 他の強制終端の経路と比べる | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 連携の失効（`failActiveJobsForExpiredIntegration`）だけがノート側の理由を `providerAuthFailed` にし、連携解除を含む残る 8 経路（`disconnectIntegration` / `trashNote` / `cancelJob` / `deleteWorkspace` / `deleteAccount` / `removeMember` / `leaveWorkspace` / `changeMemberRole`）は `canceled` になる |
| TC-integration-056 | disconnectIntegration: 取り消した `kind: "regeneration"` のジョブ — OpenRouter を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 本文は `ready` のまま変更されない |
| TC-integration-057 | disconnectIntegration: 取り消したジョブ — 破棄された生成物を確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 「共通: 強制終端の後始末」の 2 を規則どおり適用するが、この経路の回収対象は実際には空になる。対象を `provider` に依存する `kind`（`conversion` / `regeneration` / `driveBackup` / `bulkBackup`）に絞っており、生成物（`purpose: "artifact"`）を持つのは `pdfExport` / `bulkExport` だけで、batch 親も直接は終端させないためである（規則は経路ごとに省かず同じ形で適用する） |
| TC-integration-058 | disconnectIntegration: scopeの一部が一時失敗する — operationをpollする | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | `processing` とscope別進捗を返し、成功済みscopeをやり直さず失敗scopeを再試行する。connectionは削除されない |
| TC-integration-059 | disconnectIntegration: 全scopeがackする — operationをpollする | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | global D1からconnectionが削除され、`integration.disconnected` が発行され、`completed`になる |
| TC-integration-060 | disconnectIntegration: `membership_directory` に `removing` edgeがある — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 先行する離脱cleanupが完了するまでそのscopeも対象に含め、residueを漏らさない |
| TC-integration-061 | disconnectIntegration: `ActiveConnection` で `CredentialResolver.resolve` が `resolved` — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 平文で `IntegrationOAuthClient.revoke` を試みる（失敗しても続行する） |
| TC-integration-062 | disconnectIntegration: `resolve` が `reauthorizationRequired`（失効） — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 取り消し要求を省いて続行し、`expired` は保存しない（直後に連携ごと削除するため） |
| TC-integration-063 | disconnectIntegration: ジョブの取り消し時に版が競合した（ワーカーが同時に終端化した） — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 該当ジョブを読み直し、既に終端なら取り消しの対象から外す |
| TC-integration-064 | disconnectIntegration: 連携がない — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | operation IDを返し、pollすると直ちに`completed`。外部呼び出しやscope commandは行わない |
| TC-integration-065 | disconnectIntegration: プロバイダー側の取り消し要求が失敗する — 解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 記録して継続し、解除は成功する |
| TC-integration-066 | disconnectIntegration: 解除後 — 生成済みのノートを確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 内容は残る |
| TC-integration-067 | disconnectIntegration: 解除後 — 変換を要求する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 再連携を促すエラーになる |
| TC-integration-068 | disconnectIntegration: Drive を解除した — Google の認証手段を確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | サインインには影響しない |
| TC-integration-069 | disconnectIntegration: 自動バックアップが有効だった — Drive を解除する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | 設定も無効になる |
| TC-integration-070 | disconnectIntegration: Drive を解除した — Drive 上のバックアップを確認する | spec/testcases/integration/disconnectIntegration.md#テストケース-disconnectintegration | ファイルは残る |
| TC-integration-071 | failActiveJobsForExpiredIntegration: OpenRouter が失効し、`conversion` と `regeneration` が 1 件ずつ実行中 — `integration.expired` を処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 2 件が `failed("providerAuthFailed")` になり、`failedCount: 2` が返る |
| TC-integration-072 | failActiveJobsForExpiredIntegration: Google Drive が失効し、`driveBackup` が実行中 — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | `driveBackup` が `failed("providerAuthFailed")` になる |
| TC-integration-073 | failActiveJobsForExpiredIntegration: OpenRouter が失効し、Drive の `driveBackup` が実行中 — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | `driveBackup` は対象外で失敗しない（プロバイダーに依存する `kind` だけを選ぶ） |
| TC-integration-074 | failActiveJobsForExpiredIntegration: `bulkBackup` の batch 親が実行中 — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 親は直接失敗させず、子の終端化の集計（`updateBatchProgress`）に委ねる |
| TC-integration-075 | failActiveJobsForExpiredIntegration: `kind: "conversion"` の対象ノートが `processing` のまま — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | `Note.markConversionFailed(providerAuthFailed)` も保存され、`runConversion` の失敗時と同じ表示になる |
| TC-integration-076 | failActiveJobsForExpiredIntegration: `kind: "regeneration"` の対象ノートがある — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | ジョブは失敗するが、ノートの本文は変更されない |
| TC-integration-077 | failActiveJobsForExpiredIntegration: 失敗させたジョブ — 破棄された生成物を確認する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 「共通: 強制終端の後始末」の 2 を規則どおり適用するが、この経路の回収対象は実際には空になる。対象を `provider` に依存する `kind`（`conversion` / `regeneration` / `driveBackup` / `bulkBackup`）に絞っており、生成物（`purpose: "artifact"`）を持つのは `pdfExport` / `bulkExport` だけで、batch 親も直接は終端させないためである（`disconnectIntegration` と同じ理由。規則は経路ごとに省かず同じ形で適用する） |
| TC-integration-078 | failActiveJobsForExpiredIntegration: 同じ利用者に `queued` のジョブがある — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 未終端のため対象となり、`failed("providerAuthFailed")` になる |
| TC-integration-079 | failActiveJobsForExpiredIntegration: 他の利用者が同じプロバイダーの実行中ジョブを持つ — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 他の利用者のジョブには触れない（対象は `listActiveByRequester(userId)` の範囲） |
| TC-integration-080 | failActiveJobsForExpiredIntegration: 取り消し対象の絞り込み — 引くクエリを確認する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | `listActiveByRequester(userId)` を `limit: 100` で引く |
| TC-integration-081 | failActiveJobsForExpiredIntegration: 網が 100 件を返した — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 失敗させたジョブの保存と同じ UoW で継続要求 `job.terminationContinued { origin: { path: "integrationExpired", userId, provider } }` を積む。続きは `continueForcedTermination` が引き受ける |
| TC-integration-082 | failActiveJobsForExpiredIntegration: 継続要求の `origin` — 遷移の再現を確認する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | `path` は `disconnectIntegration` ではなく `integrationExpired`。**9 経路で唯一この経路だけが `cancel` ではなく `fail` を当てる**ため、続きも `path` から遷移を導いて `Job.fail("providerAuthFailed")` を当てる。`cause` だけを運ぶ形にすると 2 巡目で `canceled` にすり替わり、履歴と本文の理由が 1 巡目と食い違う |
| TC-integration-083 | failActiveJobsForExpiredIntegration: 継続で終端したジョブの対象ノートが `processing` のまま — 続きを処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | `cause.noteFailureReason` も `path` から導くため `providerAuthFailed` のままで、1 巡目と同じ表示になる |
| TC-integration-084 | failActiveJobsForExpiredIntegration: 対象の未終端ジョブが 1 件もない — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 何もせず `failedCount: 0` で成功として返る |
| TC-integration-085 | failActiveJobsForExpiredIntegration: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 2 回目は対象が既に終端で `listActiveByRequester` に現れず、`failedCount: 0` で終わる（冪等） |
| TC-integration-086 | failActiveJobsForExpiredIntegration: ワーカーが同時に同じジョブを終端化した — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | 該当ジョブを読み直し、既に終端なら何もしない（版の競合を表出させない） |
| TC-integration-087 | failActiveJobsForExpiredIntegration: 書き込みが失敗する — 処理する | spec/testcases/integration/failActiveJobsForExpiredIntegration.md#テストケース-failactivejobsforexpiredintegration | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる |
| TC-integration-088 | fetchBackupForRegeneration: バックアップ記録があり Drive 上にファイルがある — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | 記録所有者（`BackupRecord.userId`）の連携トークンで取得され、内容のストリームとファイル名・形式が返る |
| TC-integration-089 | fetchBackupForRegeneration: ワークスペースノートで、記録所有者と要求者が別のメンバー — 要求者が取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | 記録所有者の連携トークンが使われ、要求者自身の Drive 連携は参照されない（IN-07） |
| TC-integration-090 | fetchBackupForRegeneration: 記録所有者以外のメンバーが Drive 未連携 — そのメンバーが取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | 記録所有者の連携で成功する（要求者の連携の有無は結果に影響しない） |
| TC-integration-091 | fetchBackupForRegeneration: バックアップ記録がない — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | `NotFoundError("BACKUP_NOT_FOUND")` が投げられる |
| TC-integration-092 | fetchBackupForRegeneration: Drive 上のファイルが削除されている — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | `NotFoundError("DRIVE_FILE_NOT_FOUND")` が投げられる |
| TC-integration-093 | fetchBackupForRegeneration: Drive 上のファイルが移動されている — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | 記録の参照で到達できれば成功する |
| TC-integration-094 | fetchBackupForRegeneration: 記録所有者が連携を解除している — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられ、記録所有者には再連携を、他のメンバーには自分の Drive への再バックアップ（IN-06）を経た再生成を案内する |
| TC-integration-095 | fetchBackupForRegeneration: 記録所有者が退会済み — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | 同じく `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる（連携は `deleteIntegrationsForUser` で消えている） |
| TC-integration-096 | fetchBackupForRegeneration: 記録所有者の連携が失効している — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | `BusinessRuleError(ReauthorizationRequired)` が投げられる（案内は未連携時と同じ） |
| TC-integration-097 | fetchBackupForRegeneration: 通信が失敗する — 取り出す | spec/testcases/integration/fetchBackupForRegeneration.md#テストケース-fetchbackupforregeneration | `SystemError(ExternalServiceError)` が投げられる |
| TC-integration-098 | listAvailableModels: OpenRouter が連携済み — 一覧する | spec/testcases/integration/listAvailableModels.md#テストケース-listavailablemodels | 用途別のモデル一覧と現在の設定が返り、`catalogAvailable: true` になる |
| TC-integration-099 | listAvailableModels: 一覧の取得が失敗する — 一覧する | spec/testcases/integration/listAvailableModels.md#テストケース-listavailablemodels | 既定モデルのみが返り、`catalogAvailable: false` になる |
| TC-integration-100 | listAvailableModels: 画像に対応しないモデルがある — 一覧する | spec/testcases/integration/listAvailableModels.md#テストケース-listavailablemodels | `vision` の選択肢には含まれない |
| TC-integration-101 | listAvailableModels: 音声に対応しないモデルがある — 一覧する | spec/testcases/integration/listAvailableModels.md#テストケース-listavailablemodels | `transcription` の選択肢には含まれない |
| TC-integration-102 | listAvailableModels: 未連携 — 一覧する | spec/testcases/integration/listAvailableModels.md#テストケース-listavailablemodels | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる |
| TC-integration-103 | listAvailableModels: 連携が失効している — 一覧する | spec/testcases/integration/listAvailableModels.md#テストケース-listavailablemodels | `BusinessRuleError(ReauthorizationRequired)` が投げられる |
| TC-integration-104 | listAvailableModels: アクセストークンの期限が切れていてリフレッシュ可能 — 一覧する | spec/testcases/integration/listAvailableModels.md#テストケース-listavailablemodels | トークンが更新されて成功する |
| TC-integration-105 | listBackupStates: 3 件のうち 2 件がバックアップ済み — まとめて引く | spec/testcases/integration/listBackupStates.md#テストケース-listbackupstates | 2 件が `backedUp: true`、1 件が `false` になる |
| TC-integration-106 | listBackupStates: バックアップ済みのノート — 引く | spec/testcases/integration/listBackupStates.md#テストケース-listbackupstates | `webViewUrl` と `backedUpAt` が返る |
| TC-integration-107 | listBackupStates: ノート ID を 1 件も渡さない — 引く | spec/testcases/integration/listBackupStates.md#テストケース-listbackupstates | 空のマップが返る |
| TC-integration-108 | listBackupStates: 存在しないノート ID を含む — 引く | spec/testcases/integration/listBackupStates.md#テストケース-listbackupstates | `backedUp: false` として返り、エラーにならない |
| TC-integration-109 | listConnections: 両方の連携がある — 一覧する | spec/testcases/integration/listConnections.md#テストケース-listconnections | 2 件が状態・アカウント表示・最終利用日時つきで返る |
| TC-integration-110 | listConnections: 連携が 1 つもない — 一覧する | spec/testcases/integration/listConnections.md#テストケース-listconnections | 両方のプロバイダーが `status: "disconnected"` として返る |
| TC-integration-111 | listConnections: 失効した連携がある — 一覧する | spec/testcases/integration/listConnections.md#テストケース-listconnections | `status: "expired"` が返る |
| TC-integration-112 | listConnections: — — 一覧する | spec/testcases/integration/listConnections.md#テストケース-listconnections | 応答にアクセストークンやリフレッシュトークンが含まれない |
| TC-integration-113 | listConnections: Drive の連携がある — 一覧する | spec/testcases/integration/listConnections.md#テストケース-listconnections | `settings` にフォルダと自動バックアップの設定が含まれる |
| TC-integration-114 | listConnections: OpenRouter の連携がある — 一覧する | spec/testcases/integration/listConnections.md#テストケース-listconnections | `settings` にモデル設定が含まれる |
| TC-integration-115 | listConnections: アカウント表示が取得できていない — 一覧する | spec/testcases/integration/listConnections.md#テストケース-listconnections | `accountLabel: null` が返る |
| TC-integration-116 | listDriveFolders: Drive が連携済み — 一覧する | spec/testcases/integration/listDriveFolders.md#テストケース-listdrivefolders | フォルダの一覧が返る |
| TC-integration-117 | listDriveFolders: `parentId` を指定する — 一覧する | spec/testcases/integration/listDriveFolders.md#テストケース-listdrivefolders | その配下のフォルダが返る |
| TC-integration-118 | listDriveFolders: 未連携 — 一覧する | spec/testcases/integration/listDriveFolders.md#テストケース-listdrivefolders | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる |
| TC-integration-119 | listDriveFolders: 連携が失効している — 一覧する | spec/testcases/integration/listDriveFolders.md#テストケース-listdrivefolders | `BusinessRuleError(ReauthorizationRequired)` が投げられる |
| TC-integration-120 | listDriveFolders: 権限が不足している — 一覧する | spec/testcases/integration/listDriveFolders.md#テストケース-listdrivefolders | `ValidationError("DRIVE_PERMISSION_DENIED")` が投げられる |
| TC-integration-121 | listDriveFolders: フォルダが 0 件 — 一覧する | spec/testcases/integration/listDriveFolders.md#テストケース-listdrivefolders | 空配列が返る |
| TC-integration-122 | listDriveFolders: 通信が失敗する — 一覧する | spec/testcases/integration/listDriveFolders.md#テストケース-listdrivefolders | `SystemError(ExternalServiceError)` が投げられる |
| TC-integration-123 | requestBackup: Drive 連携済み、元ファイルのあるノート 1 件 — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 単体のバックアップジョブが登録される |
| TC-integration-124 | requestBackup: 元ファイルのあるノート 5 件 — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 親ジョブと 5 件の子ジョブが登録される |
| TC-integration-125 | requestBackup: 元ファイルのないノートを含む — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | それらは対象から外れ、`skipped` に `{ noteId, reason: "noSourceFile" }` として積まれる |
| TC-integration-126 | requestBackup: 存在しない `noteId` を含む — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `listByIds` の結果に現れないその ID は `skipped` に `{ noteId, reason: "notFound" }` として積まれる（入力の `noteIds` と結果を突き合わせる。省くと存在しない ID が無言で落ちる） |
| TC-integration-127 | requestBackup: 存在しない `noteId` だけを指定する — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 対象が 0 件になり `ValidationError("NO_BACKUPABLE_TARGET")` が投げられる。`skipped` にはすべての ID が `reason: "notFound"` として載る |
| TC-integration-128 | requestBackup: 存在しない ID・編集権限のない ID・元ファイルのない ID を混ぜて指定する — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `skipped` に `notFound` / `permissionDenied` / `noSourceFile` がそれぞれ対応する `noteId` とともに積まれ、残りだけが対象になる |
| TC-integration-129 | requestBackup: ワークスペースの viewer が自分の参加ワークスペースのノートを指定する — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `NoteAccessPolicy.canEdit` が偽のため対象から外れ、`skipped` に `{ noteId, reason: "permissionDenied" }` として積まれる（バックアップは `downloadNote` ではなく `editNote` を要する。`runBackup` が `BackupRecord` を書き、既存記録の所有者を付け替えるため） |
| TC-integration-130 | requestBackup: ワークスペースの viewer が指定したノートしかない — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 対象が 0 件になり `ValidationError("NO_BACKUPABLE_TARGET")` が投げられる（`skipped` にはすべての ID と理由が載る） |
| TC-integration-131 | requestBackup: ワークスペースの editor が同じノートを指定する — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 対象になり、ジョブが登録される |
| TC-integration-132 | requestBackup: 個人所有のノートを本人が指定する — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `canEdit` が真のため対象になる（個人所有ではロールの概念がなく所有者が編集できる） |
| TC-integration-133 | requestBackup: `skipped` の形 — `requestBulkNoteOperation` / `requestBulkExport` と比べる | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 3 経路とも `{ noteId, reason }[]` で揃っている（どれがなぜ外れたかを画面が案内できる） |
| TC-integration-134 | requestBackup: `skipped` の `reason` の語彙 — 同じく 3 経路を比べる | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 語彙は経路ごとに固有（`noSourceFile` は本経路にしかない）だが、「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う |
| TC-integration-135 | requestBackup: すべて元ファイルがない — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `ValidationError("NO_BACKUPABLE_TARGET")` が投げられる |
| TC-integration-136 | requestBackup: 未連携 — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる |
| TC-integration-137 | requestBackup: 同じノートのバックアップが実行中 — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `BusinessRuleError(DuplicateJob)` が投げられる |
| TC-integration-138 | requestBackup: 編集権限のないノートを含む — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | それらは対象から外れる |
| TC-integration-139 | requestBackup: 連携が失効している — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | ジョブは登録され、実行時に失敗する |
| TC-integration-140 | requestBackup: 対象 1 件 — 登録されたジョブの `kind` / `payload` / `target` を確認する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `kind: "driveBackup"`、`payload: { kind: "driveBackup" }`、`target: { type: "storedFile", fileId }`、`parentId: null` になる |
| TC-integration-141 | requestBackup: 対象 5 件 — 登録された親子の `kind` / `payload` を確認する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 親子とも `kind: "bulkBackup"`、`payload: { kind: "bulkBackup" }` になる（単体と一括で `kind` が変わる非対称。実行体はどちらも `runBackup`） |
| TC-integration-142 | requestBackup: 個人所有のノートの元ファイルだけを要求した — ジョブの `scope` を確認する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 対象ファイルの `StorageOwner`（＝取り込み先ノートの所有文脈）から `{ type: "user", userId }` が入る |
| TC-integration-143 | requestBackup: 参加ワークスペース所有のノートの元ファイルだけを要求した（要求者は owner ではないメンバー） — ジョブの `scope` を確認する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない） |
| TC-integration-144 | requestBackup: 複数件で親子が作られた — 親ジョブと子ジョブの `scope` を比べる | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 親子で一致する |
| TC-integration-145 | requestBackup: source scope と異なるノートIDを混ぜて要求する — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 異なるIDは存在を漏らさず `notFound` でskipされ、指定scope以外のDOは呼ばれない |
| TC-integration-146 | requestBackup: 指定時は混在しているが、権限・元ファイルの絞り込みのあとに残る所有文脈が 1 つになる — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | 判定は絞り込みのあとに行うため成功する |
| TC-integration-147 | requestBackup: 入力source scopeと異なるNoteIdを混ぜる — 要求する | spec/testcases/integration/requestBackup.md#テストケース-requestbackup | route一括検証で`notFound`にし、指定scope DOだけを呼ぶ |
| TC-integration-148 | runBackup: 未バックアップの元ファイル — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | Drive にアップロードされ、記録が作られ、ジョブが `succeeded` になる |
| TC-integration-149 | runBackup: 同じ内容が既にバックアップ済み — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | 再アップロードされず、成功として扱われる |
| TC-integration-150 | runBackup: 内容が変わっている — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | 置き換えられ、記録の参照が更新される |
| TC-integration-151 | runBackup: 同じノートに別のメンバーが作った既存記録がある — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `BackupPlanner.decide` が `replace` と判定し、実行者自身の Drive へ上げ直したうえで `BackupRecord.replace(record, { userId: requestedBy, external, checksum }, now)` を保存する（IN-07 の記録所有者失効時の復旧経路） |
| TC-integration-152 | runBackup: `replace` が適用された — 記録を確認する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `userId`（所有者）・外部参照・内容ハッシュが差し替わり、`(noteId, sourceFileId)` は変わらないため一意条件に触れない |
| TC-integration-153 | runBackup: `replace` が適用された — 元の所有者の Drive を確認する | spec/testcases/integration/runBackup.md#テストケース-runbackup | 元の所有者の Drive に残るファイルは削除しない（IN-09 と同じ整理） |
| TC-integration-154 | runBackup: 保存先フォルダの再作成などで外部参照だけが変わった — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `replace` ではなく `updateExternalRef` で参照だけを更新する |
| TC-integration-155 | runBackup: 実行後 — 記録を確認する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `BackupRecord.userId` が実行者（ジョブの `requestedBy`）になっており、保存先も実行者の Drive である |
| TC-integration-156 | runBackup: 保存先フォルダが削除されている — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | フォルダが作り直され、`ExternalConnection.updateBackupSetting` を適用した保存で設定に反映される（`updateBackupSetting` ユースケースは呼ばない — その手順 2 が `ensureFolder` を再び呼んで往復が二重になるため） |
| TC-integration-157 | runBackup: フォルダを作り直した後にアップロードが失敗した — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | 新しいフォルダ ID は連携に残る（手順 7 の UoW とは別の UoW で先に確定するため）。次の試行が同じフォルダを作り直さずに済む |
| TC-integration-158 | runBackup: Drive の容量が不足している — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `failed("quotaExceeded")` になる |
| TC-integration-159 | runBackup: Drive の権限が失われている — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `failed("permissionRevoked")` になる |
| TC-integration-160 | runBackup: 連携が失効している — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `failed("providerAuthFailed")` になり、連携が `expired` になる |
| TC-integration-161 | runBackup: ノート・ファイルが削除済み — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `failed("targetMissing")` になる |
| TC-integration-162 | runBackup: 通信が失敗する — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `failed("unknown")` になり、再試行できる |
| TC-integration-163 | runBackup: `CredentialResolver.resolve` がtoken refreshまたは `lastUsedAt` 更新を返す — 実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | `resolved.updated` をglobal D1で先に保存してからscope-localバックアップ処理を続ける |
| TC-integration-164 | runBackup: `resolve` が新たな失効を返し、global保存後・scope-local Job失敗前に停止する — 再配送する | spec/testcases/integration/runBackup.md#テストケース-runbackup | 保存済みのexpired connectionを読み、Jobを `failed("providerAuthFailed")` へ収束させる |
| TC-integration-165 | runBackup: 既に `succeeded` のジョブ — 再度実行する | spec/testcases/integration/runBackup.md#テストケース-runbackup | 何もせず終わる |
| TC-integration-166 | runBackup: ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） — 配送で受け取る | spec/testcases/integration/runBackup.md#テストケース-runbackup | 何もせず成功として返る（run 系共通規則の判定 1） |
| TC-integration-167 | runBackup: 実行後 — ノートを確認する | spec/testcases/integration/runBackup.md#テストケース-runbackup | 「バックアップ済み」と Drive へのリンクが表示される |
| TC-integration-168 | startIntegrationOAuth: サインイン済み — OpenRouter で開始する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | 認可 URL が返り、`state` が 10 分の期限で保存される |
| TC-integration-169 | startIntegrationOAuth: サインイン済み — Google Drive で開始する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | Drive のスコープと `prompt=consent` を含む URL が返る |
| TC-integration-170 | startIntegrationOAuth: — — 未知のプロバイダーを指定する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | `BusinessRuleError(InvalidProvider)` が投げられる |
| TC-integration-171 | startIntegrationOAuth: — — `redirectTo` に外部 URL を指定する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | `ValidationError("INVALID_REDIRECT")` が投げられる |
| TC-integration-172 | startIntegrationOAuth: Google SSO 済み（`provider: "google"` の `OAuthIdentity` を持つ） — Drive で開始する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | その `providerEmail` が `loginHint` として渡され、アカウント選択を省いた URL になる（`prompt=consent` は維持される。IN-04） |
| TC-integration-173 | startIntegrationOAuth: Google の `OAuthIdentity` を持たない — Drive で開始する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | `loginHint: null` となり、アカウント選択を伴う URL になる |
| TC-integration-174 | startIntegrationOAuth: 既に連携済み — 開始する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | 再連携として認可 URL が返る |
| TC-integration-175 | startIntegrationOAuth: 保存された状態を確認する — 開始後に確認する | spec/testcases/integration/startIntegrationOAuth.md#テストケース-startintegrationoauth | `intent: "integration"` と `userId` が含まれる |
| TC-integration-176 | updateBackupSetting: Drive が連携済み — フォルダを指定して保存する | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | 設定が更新される |
| TC-integration-177 | updateBackupSetting: フォルダ未設定 — 自動バックアップを有効にする | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | `BusinessRuleError(BackupFolderRequired)` が投げられる |
| TC-integration-178 | updateBackupSetting: フォルダ設定済み — 自動バックアップを有効にする | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | 設定が更新される |
| TC-integration-179 | updateBackupSetting: 指定したフォルダに書き込み権限がない — 保存する | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | `ValidationError("DRIVE_PERMISSION_DENIED")` が投げられる |
| TC-integration-180 | updateBackupSetting: 指定したフォルダが削除されている — 保存する | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | フォルダが作り直され、その参照が保存される |
| TC-integration-181 | updateBackupSetting: OpenRouter の連携に対して呼ぶ — 保存する | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | `BusinessRuleError(ProviderMismatch)` が投げられる |
| TC-integration-182 | updateBackupSetting: フォルダまたは自動バックアップの設定を変更した — 発行されたイベントを確認する | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | `integration.backupSettingChanged`（`connectionId` / `userId` / `autoBackup`）が発行され、保存と同じ UoW で収集される（監査用） |
| TC-integration-183 | updateBackupSetting: `BusinessRuleError(BackupFolderRequired)` で失敗した — 発行されたイベントを確認する | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | 設定が保存されないため `integration.backupSettingChanged` も発行されない |
| TC-integration-184 | updateBackupSetting: 自動バックアップを有効にした — 既存のノートを確認する | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | 遡ってバックアップはされない |
| TC-integration-185 | updateBackupSetting: 自動バックアップを有効にした — 新しくアップロードする | spec/testcases/integration/updateBackupSetting.md#テストケース-updatebackupsetting | バックアップジョブが登録される |
| TC-integration-186 | updateModelPreference: OpenRouter が連携済み — 3 つの用途のモデルを保存する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | 設定が更新される |
| TC-integration-187 | updateModelPreference: — — 空文字列のモデル ID を指定する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | `BusinessRuleError(InvalidModelPreference)` が投げられる |
| TC-integration-188 | updateModelPreference: — — 201 文字のモデル ID を指定する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | `BusinessRuleError(InvalidModelPreference)` が投げられる |
| TC-integration-189 | updateModelPreference: 未連携 — 保存する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる |
| TC-integration-190 | updateModelPreference: 保存後 — 発行されたイベントを確認する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | イベントは発行されない（`ExternalConnection.updateModels` は `ExternalConnection` だけを返す） |
| TC-integration-191 | updateModelPreference: 保存後 — 既存ノートを確認する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | 内容は変わらない（再実行が必要） |
| TC-integration-192 | updateModelPreference: 保存後 — 新しい変換を実行する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | 新しいモデルが使われる |
| TC-integration-193 | updateModelPreference: Drive の連携に対して呼ぶ — 保存する | spec/testcases/integration/updateModelPreference.md#テストケース-updatemodelpreference | `BusinessRuleError(ProviderMismatch)` が投げられる |
| TC-job-001 | cancelJob: 待機中のジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `canceled` になる |
| TC-job-002 | cancelJob: 実行中のジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `canceled` になる |
| TC-job-003 | cancelJob: 成功したジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `BusinessRuleError(JobNotCancelable)` が投げられる |
| TC-job-004 | cancelJob: 失敗したジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `BusinessRuleError(JobNotCancelable)` が投げられる |
| TC-job-005 | cancelJob: 親ジョブで待機中の子が 5 件、実行中が 2 件 — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | 待機中の 5 件が取り消され、実行中の 2 件は完了を待つ |
| TC-job-006 | cancelJob: 一括ダウンロードのジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | 中間生成物が破棄される |
| TC-job-007 | cancelJob: 取り込みジョブをキャンセルする — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | それまでに作られたノートは残る |
| TC-job-008 | cancelJob: 再生成ジョブをキャンセルする — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | ノートの本文は変更前のまま維持される |
| TC-job-009 | cancelJob: `kind: "conversion"` のジョブで対象ノートが `processing` のまま — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` がジョブの終端と**同一 UoW** で保存され、ノートが `failed(canceled)` になる（`processing` のまま固定されて移動も作り直しもできなくなるのを防ぐ） |
| TC-job-010 | cancelJob: `kind: "regeneration"` のジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | 本文は `ready` のまま変更されない（後始末の対象は `conversion` のみ） |
| TC-job-011 | cancelJob: `kind: "pdfExport"` / `bulkExport` / 一括操作系のジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `content.status` を動かす kind ではないため、ノートの本文状態は変わらない |
| TC-job-012 | cancelJob: 対象ノートが既にゴミ箱・完全削除済み — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `ActiveNote` でないため本文の回復は行わず、ジョブの終端だけが保存される |
| TC-job-013 | cancelJob: 単体ジョブ（batch 親ではない）をキャンセルした — 破棄された生成物を確認する | spec/testcases/job/cancelJob.md#テストケース-canceljob | 生成物の回収は起きない。`Job.cancel` が受け取るのは `QueuedJob \| RunningJob` で、`artifact` を持つのは `succeeded` のジョブだけだからである（「共通: 強制終端の後始末」の 2 — 回収の対象は、まだ終端していない親の既に成功した子の生成物だけ） |
| TC-job-014 | cancelJob: batch 親をキャンセルした（成功済みの子が artifact を持つ） — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact **だけ**を集めて `deleteFiles`（Storage）で破棄し、ジョブの終端と同一 UoW で保存する（一括ダウンロードの中間生成物が要求者の個人ストレージに 7 日残らない） |
| TC-job-015 | cancelJob: 成功して終端済みのジョブが持つ生成物（単体の PDF、匿名の PDF、組み立て済みの ZIP） — 別のジョブをキャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | この規則では回収しない。強制終端は未終端のジョブしか止めないため終端させる集合に入らず、回収は `collectExpiredArtifacts` による期限経過の自動回収に委ねられる |
| TC-job-016 | cancelJob: 回収対象の絞り込み — 破棄されたファイルを確認する | spec/testcases/job/cancelJob.md#テストケース-canceljob | 破棄されるのは `purpose: "artifact"` だけで、元ファイル（`source`）や媒体（`media` / `reference`）には触れない |
| TC-job-017 | cancelJob: キャンセルと同時に走っていたワーカーが、そのあと artifact を保管した — 保管ファイルを確認する | spec/testcases/job/cancelJob.md#テストケース-canceljob | 強制終端の時点では存在せず終端させた側から見えないため回収されず、期限付き保管の自動回収（`collectExpiredArtifacts`）に委ねられる |
| TC-job-018 | cancelJob: 他の利用者のジョブ — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | `NotFoundError("JOB_NOT_FOUND")` が投げられる |
| TC-job-019 | cancelJob: 匿名ジョブ（`requestedBy: null`） — キャンセルする | spec/testcases/job/cancelJob.md#テストケース-canceljob | 所有の確認で `NotFoundError("JOB_NOT_FOUND")` が投げられる |
| TC-job-020 | cancelJob: 匿名の PDF 書き出しが動いているノート — そのノートをゴミ箱へ移す | spec/testcases/job/cancelJob.md#テストケース-canceljob | `trashNote` の対象で引くキャンセル網（`listActiveByTarget`）に匿名ジョブも含まれ、取り消される |
| TC-job-021 | cancelJob: 匿名の PDF 書き出しが動いているノート — ワークスペースを削除する・退会する | spec/testcases/job/cancelJob.md#テストケース-canceljob | スコープで引くキャンセル網（`listActiveByScope`）に匿名ジョブも含まれ、取り消される（匿名ジョブの `scope` は対象ノートの所有文脈から導かれるため） |
| TC-job-022 | cancelJob: キャンセル後 — 内訳を確認する | spec/testcases/job/cancelJob.md#テストケース-canceljob | 完了と取り消しの件数が分かる |
| TC-job-023 | continueForcedTermination: 網が 100 件を返した — 処理する | spec/testcases/job/continueForcedTermination.md#テストケース-continueforcedtermination | 100 件を同一 UoW で終端させ、`finalizeTerminatedJobs` を同じ `ctx` で実行し、同じ UoW で `job.terminationContinued`（`origin` をそのまま写したもの）を 1 件だけ積む（境界値） |
| TC-job-024 | continueForcedTermination: 網がちょうど 99 件を返した — 処理する | spec/testcases/job/continueForcedTermination.md#テストケース-continueforcedtermination | 99 件を終端させ、継続要求は積まない（境界値。上限に達していないので続きはない） |
| TC-job-025 | continueForcedTermination: 網が 0 件を返した — 処理する | spec/testcases/job/continueForcedTermination.md#テストケース-continueforcedtermination | 何もせず成功として返る。**継続要求は積まず、メッセージも失敗させない**（対象が尽きた正常な終端であり、「進捗がなければ継続しない」の対象ではない） |
| TC-job-026 | continueForcedTermination: 対象が残っているのに 1 件も終端できなかった — 処理する | spec/testcases/job/continueForcedTermination.md#テストケース-continueforcedtermination | 継続要求を積まず、失敗として返る（キューの再試行と DLQ に委ねる。恒久的に失敗する 1 件が列の先頭に居座って継続が無限に回るのを防ぐ） |
| TC-job-027 | continueForcedTermination: 継続を積むとき — `origin` を確認する | spec/testcases/job/continueForcedTermination.md#テストケース-continueforcedtermination | 受け取った `origin` をそのまま写す（書き換えない）。カーソルを持たない継続であり、終端したジョブは `listActive*` の結果から外れるため同じ `origin` で引き直すだけで必ず前に進む |
| TC-job-028 | continueForcedTermination: `origin: { path: "removeMember", workspaceId, memberUserId }` — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | current workspace scopeで `listActiveByRequester(memberUserId, 100)` を引く。他のメンバーと匿名ジョブには触れない |
| TC-job-029 | continueForcedTermination: 同上 — スコープだけで引いていないことを確認する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `origin` が `{ scopeType, scopeId }` だけだと、続きがワークスペースの全ジョブを取り消してしまう。`memberUserId` は payload が運ぶ |
| TC-job-030 | continueForcedTermination: `origin: { path: "leaveWorkspace", workspaceId, memberUserId }` — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `removeMember` と同じ網・同じ絞り込み・同じ遷移（脱退は除名と同じ後始末） |
| TC-job-031 | continueForcedTermination: `origin: { path: "deleteWorkspace", workspaceId, deletionOperationId }` — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | owner一致を確認し、`listActiveByScope({ type: "workspace", workspaceId })` の**全件**を `Job.cancel` する |
| TC-job-032 | continueForcedTermination: `origin: { path: "changeMemberRole", workspaceId, memberUserId, nextRole: "viewer" }` — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `listActiveByRequesterAndKinds(memberUserId, disallowedKinds, 100)` が最終述語をDBで適用してからlimitする |
| TC-job-033 | continueForcedTermination: 対象外jobが先頭に100件以上ある — integration / role changeの継続を処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | 対象外に遮られず、該当kindを最大100件処理する |
| TC-job-034 | continueForcedTermination: 同上 — `kind` の絞り込みの出どころを確認する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `nextRole` から [usecases/workspace.md](../usecases/workspace.md) の kind → 要ロール表を引いて導く。継続要求に `kind` の並びを焼き付けない（焼き付けると表を変えたときに配送中のメッセージだけが古い規則で動く） |
| TC-job-035 | continueForcedTermination: `origin: { path: "changeMemberRole", …, nextRole: "viewer" }` で、対象が `bulkExport` の未終端ジョブを持つ — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `bulkExport` は viewer でも実行できるため取り消されない（1 巡目と同じ判定） |
| TC-job-036 | continueForcedTermination: `origin: { path: "trashNote", noteId, excludingJobId }` — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `listActiveByTarget({ type: "note", noteId })` を引き、`excludingJobId` に一致するものを除いて `Job.cancel` する。所有文脈の他のノートに対するジョブには触れない |
| TC-job-037 | continueForcedTermination: 同上（`excludingJobId` が非 `null`） — 除外を確認する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | 継続の 2 巡目でも除外が効く。1 ノートの網なので実際には 100 件に達しないが、達しないことは規模の見積もりであって型の保証ではないため `origin` に含める |
| TC-job-038 | continueForcedTermination: `origin: { path: "disconnectIntegration", userId, provider: "openrouter" }` — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `listActiveByRequester(userId)` を `conversion` / `regeneration` に絞って `Job.cancel` する。`driveBackup` / `bulkBackup` には触れない |
| TC-job-039 | continueForcedTermination: 同上（`provider: "googleDrive"`） — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `driveBackup` / `bulkBackup` に絞られる |
| TC-job-040 | continueForcedTermination: `origin: { path: "integrationExpired", userId, provider }` — 処理する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | 同じ網・同じ絞り込みだが、遷移は **`Job.fail("providerAuthFailed")`**（`Job.cancel` ではない） |
| TC-job-041 | continueForcedTermination: 同上 — 本文の回復理由を確認する | spec/testcases/job/continueForcedTermination.md#経路ごとの網と絞り込みの再現 | `cause.noteFailureReason` は `providerAuthFailed`。9 経路で唯一 `fail` を使う経路であり、遷移と理由を `path` から導くのはこの 1 経路のためである（`cause` だけを運ぶ形だと 2 巡目で `canceled` にすり替わる） |
| TC-job-042 | continueForcedTermination: personal scope command — 処理する | spec/testcases/job/continueForcedTermination.md#deleteaccount-の-scope-分割 | `listActiveByScope({ type: "user", userId })` を100件ずつ引き、匿名PDF Jobを含めて終端する |
| TC-job-043 | continueForcedTermination: workspace scope command — 処理する | spec/testcases/job/continueForcedTermination.md#deleteaccount-の-scope-分割 | current workspaceの `listActiveByRequester(userId)` を100件ずつ引き、他メンバーのJobには触れない |
| TC-job-044 | continueForcedTermination: membership directoryに3 workspaceがある — account deletionを処理する | spec/testcases/job/continueForcedTermination.md#deleteaccount-の-scope-分割 | 3つのscope taskが独立に進み、互いのtransactionにJobを混ぜない |
| TC-job-045 | continueForcedTermination: 1 scopeで100件返る — 処理する | spec/testcases/job/continueForcedTermination.md#deleteaccount-の-scope-分割 | 同じscopeのcontinuation taskを保存し、Alarmを直後に再設定する |
| TC-job-046 | continueForcedTermination: 終端させたジョブに `kind: "conversion"` があり、対象ノートが `processing` のまま — 処理する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | `finalizeTerminatedJobs` の手順 1 により `Note.markConversionFailed` が同一 UoW で適用される。理由は `origin.path` から導いた `cause.noteFailureReason`（`integrationExpired` なら `providerAuthFailed`、それ以外は `canceled`） |
| TC-job-047 | continueForcedTermination: 終端させたのが `bulkExport` の batch 親で、成功済みの子が artifact を持つ — 処理する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | `finalizeTerminatedJobs` の手順 2 により、`succeeded` の子の artifact が「保管ファイルの削除手順」で同一 UoW から破棄される（`cause.type` は `forced`） |
| TC-job-048 | continueForcedTermination: ジョブの終端と後始末 — トランザクションを確認する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | 同一の `UnitOfWorkProvider.run` で行う。1 巡目と同じ保証であり、継続に分けたことで結果整合に落ちない |
| TC-job-049 | continueForcedTermination: 同じ継続要求を 2 回受け取る — 2 回処理する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | 終端したジョブは `listActive*` の結果に現れないため、2 回目は残っているぶんだけを終端させる（冪等） |
| TC-job-050 | continueForcedTermination: 継続要求が重複配送され 2 系列が並走する — 処理する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | 両系列とも「残っているものを引いて終端させる」だけなので結果は変わらず、網が 0 件になった系列から順に止まる |
| TC-job-051 | continueForcedTermination: 個々のジョブの保存が版で競合した — 処理する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | そのジョブを飛ばして続ける。現在taskをAlarmで再試行して拾う |
| TC-job-052 | continueForcedTermination: `origin` が指すワークスペース・利用者・ノート・連携が、継続が届くまでに削除されていた — 処理する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | 実体の存在確認は行わない。網は述語に一致する未終端ジョブを返すだけなので、対象があれば終端させ、なければ 0 件で正常終了する（存在確認を足すと、消えた実体のせいで残っているジョブを終端させずに打ち切ることになる） |
| TC-job-053 | continueForcedTermination: 継続が届く前に利用者が `failed` の親を `retryJob` で開き直そうとする — 操作する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | 9 経路が batch 親に当てるのは必ず `Job.cancel` で、`canceled` の親は `Job.reopenBatch` の受理型（`SucceededJob \| FailedJob`）に入らないため開き直せない。継続が終端させたものが後から復活することはない |
| TC-job-054 | continueForcedTermination: 1 回の実行量 — 確認する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | current scopeの最大100 Jobに固定され、CPU時間・local event fan-out・再試行量が有界である |
| TC-job-055 | continueForcedTermination: 列挙時に DB が落ちている — 処理する | spec/testcases/job/continueForcedTermination.md#後始末冪等性競合 | `SystemError(DatabaseError)` が投げられる（再試行される） |
| TC-job-056 | deleteJobsForRequester: requesterの親子Jobを削除する — 実行する | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | 1 root familyずつroute manifestを100件pageで固定し、local/global cleanupを継続する |
| TC-job-057 | deleteJobsForRequester: current scopeに退会者の終端Jobが5件 — scope cleanup command | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | familyごとにmanifestを作り、全local正データとglobal historyを削除する |
| TC-job-058 | deleteJobsForRequester: 5 familyを同じaccount operationで削除する — 継続する | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | scope+rootから5つの異なるfamily removal IDを導出し、親account operation IDはtask/headerの対応として保持する |
| TC-job-059 | deleteJobsForRequester: 1 familyの完了応答を失う — account commandを再配送する | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | 同じfamily manifestを再開し、次root用headerへ上書きしない |
| TC-job-060 | deleteJobsForRequester: 500子の親子Jobがある — 削除する | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | FK RESTRICT下で子を100件ずつ削除し、最後に親を消す。manifestは全global ackまで残る |
| TC-job-061 | deleteJobsForRequester: 他scopeにもJobがある — current scopeで実行 | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | 他scopeには触れず、orchestratorの別commandが処理する |
| TC-job-062 | deleteJobsForRequester: active Jobが残っている — 削除を試す | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | 強制終端task完了前として延期し、走行中の行を消さない |
| TC-job-063 | deleteJobsForRequester: 匿名Job — user基準で削除 | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | 対象外。personal scope全削除時またはretention pruneで回収する |
| TC-job-064 | deleteJobsForRequester: 同じoperation IDを再配送 — 実行する | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | 2回目は保存済み結果または0件で冪等に終わる |
| TC-job-065 | deleteJobsForRequester: global history削除eventが遅延 — 一覧する | spec/testcases/job/deleteJobsForRequester.md#テストケース-deletejobsforrequester | 一時表示されうるがdetail/actionはlocal行不在としてnot foundになる |
| TC-job-066 | dispatchJob: 単体ジョブの `job.enqueued` — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | `JobDispatcher.dispatch(scope, jobId, kind)` が呼ばれる |
| TC-job-067 | dispatchJob: batch 親の `job.enqueued`（`target.type: "batch"`） — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | キューへ送られない（親の実行は `job.readyToAssemble` 経由のみ） |
| TC-job-068 | dispatchJob: `bulkExport` 親の `job.readyToAssemble` — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 親ジョブがキューへ送られる（`job.readyToAssemble` は `bulkExport` 親にしか発行されないため無条件に送る） |
| TC-job-069 | dispatchJob: 任意のジョブ — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | メッセージが `scope`, `jobId`, `kind` を運び、このハンドラーは実行体を選ばない |
| TC-job-070 | dispatchJob: message scopeとJobId prefixが違う — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 不正messageとして失敗し、別scopeのJobを読まない |
| TC-job-071 | dispatchJob: `kind: "bulkExport"` の子ジョブ（`target.type: "note"`） — 受け手が処理する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | ジョブを読み直し、`kind` × `target.type` の組から `runBulkExportItem` に振り分けられる |
| TC-job-072 | dispatchJob: `kind: "bulkExport"` の親ジョブ（`target.type: "batch"`） — 受け手が処理する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 同じ `kind` でも `target.type` が異なるため `runBulkExport` に振り分けられる（子ジョブは親と同じ `kind` を持つため `kind` だけでは実行体が決まらない） |
| TC-job-073 | dispatchJob: `bulkExport` 以外の batch 親のメッセージが古い配送で届いた — 受け手が処理する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 実行体がないため何もせず返る |
| TC-job-074 | dispatchJob: `Job.retry`（`retryJob` / `retryFailedChildren`）が発行した `job.enqueued` — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 再開したジョブがキューへ送られる |
| TC-job-075 | dispatchJob: 匿名ジョブ（`requestedBy: null`）の `job.enqueued` — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 通常どおりキューへ送られる |
| TC-job-076 | dispatchJob: 同じ `job.enqueued` を 2 回受け取る — 2 回配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 重複排除は行わず 2 回送られる（受け手の run 系共通規則が吸収する） |
| TC-job-077 | dispatchJob: 同じhot workspaceの外部I/O Jobが4件実行中 — 5件目を開始する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | scope admissionが待機させ、同時実行を4以下に保つ |
| TC-job-078 | dispatchJob: 4件が同時に空き枠を取得しようとする — 開始する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | DOの同一transactionでadmission lease取得とJob.startが直列化され、5件目はJobを変更せずQueue retryへ戻る |
| TC-job-079 | dispatchJob: slot取得commit後に応答を失う — 再配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | jobId UNIQUEの同じslotとrunning Jobを読み、有効lease中は二重実行しない |
| TC-job-080 | dispatchJob: 外部I/O Jobが成功・失敗・強制cancelされる — 終端する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | terminal Job保存と同じUoWでadmission leaseを解放する |
| TC-job-081 | dispatchJob: worker crashでJob leaseが失効する — reaperを動かす | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | 同期限のadmission leaseを最大100件ずつ回収し、後続Jobが枠を取得できる |
| TC-job-082 | dispatchJob: foreground待ち行列100件またはp95 500ms超が5分継続 — background処理を投入する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | backgroundを一時停止し、過負荷のHTTP要求には `Retry-After` を返す |
| TC-job-083 | dispatchJob: キュー送信が失敗する — 配送する | spec/testcases/job/dispatchJob.md#テストケース-dispatchjob | `SystemError(ExternalServiceError)` が投げられ、再配送に委ねられる |
| TC-job-084 | getJobDetail: 子ジョブが 5 件ある親ジョブ — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | 親の情報と 5 件の子、内訳が返る |
| TC-job-085 | getJobDetail: 子 5 件のうち 3 件が `succeeded`、2 件が `failed` — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `summary` が `{ total: 5, succeeded: 3, failed: 2, canceled: 0 }` になる |
| TC-job-086 | getJobDetail: 同じ親を `listJobs` でも引く — 両方の値を突き合わせる | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `summary` は `listJobs` の `job.childSummary` と同じ値になる（同じ投影） |
| TC-job-087 | getJobDetail: 親が終端した後 — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `summary` は子の行から数え直されるため、終端後も同じ内訳が残る |
| TC-job-088 | getJobDetail: 他の利用者のジョブ — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `NotFoundError("JOB_NOT_FOUND")` が投げられる |
| TC-job-089 | getJobDetail: 存在しないジョブ ID — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `NotFoundError("JOB_NOT_FOUND")` が投げられる |
| TC-job-090 | getJobDetail: 匿名ジョブ（`requestedBy: null`）の ID — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | どの `userId` とも一致しないため `NotFoundError("JOB_NOT_FOUND")` が投げられる |
| TC-job-091 | getJobDetail: 子を持たないジョブ — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `children` が空配列になる |
| TC-job-092 | getJobDetail: 子が `limit` を超える — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `limit` 件と総件数が返る |
| TC-job-093 | getJobDetail: 失敗した子がある — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | それぞれの失敗理由が返る |
| TC-job-094 | getJobDetail: 公開ステータスを適用できなかった変換ジョブ — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `notices` に `visibilityNotApplied` が返る |
| TC-job-095 | getJobDetail: 申し送りのない成功したジョブ — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `notices` が空配列になる |
| TC-job-096 | getJobDetail: `failed` / `canceled` のジョブ — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `notices` は空配列になる（申し送りを持つのは `succeeded` のみ） |
| TC-job-097 | getJobDetail: 参照取り込みのジョブ — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `notices` は空配列になる。取り込みの結果はノート詳細（`getNote` の `references`）が持ち、ジョブには載らない |
| TC-job-098 | getJobDetail: batch 親 — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | `notices` は空配列になる（集計から申し送りは生まれない。子が持つ申し送りは親に集約されない） |
| TC-job-099 | getJobDetail: workspace scopeのJob — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | JobId prefixのworkspace objectから親子の正データを読み、local `requestedBy` で認可する |
| TC-job-100 | getJobDetail: JobId prefixを改ざんする — 開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | 改ざん先objectに行がないため `JOB_NOT_FOUND`。global projectionのscope値で上書きしない |
| TC-job-101 | getJobDetail: global projectionが遅延している — 既知のJob URLを開く | spec/testcases/job/getJobDetail.md#テストケース-getjobdetail | local Jobから詳細を返し、history到着を待たない |
| TC-job-102 | listJobs: 自分のジョブが 10 件ある — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | 10 件が新しい順で返る |
| TC-job-103 | listJobs: 他の利用者のジョブがある — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | それらは含まれない |
| TC-job-104 | listJobs: ワークスペースのノートに対する自分のジョブがある — 他のメンバーが一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | そのジョブは含まれない |
| TC-job-105 | listJobs: 匿名ジョブ（`requestedBy: null`）がある — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | どの `userId` とも一致しないため結果に現れず、`activeCount` にも数えられない |
| TC-job-106 | listJobs: 親ジョブと子ジョブがある、`parentsOnly: true` — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | 親ジョブだけが返る |
| TC-job-107 | listJobs: 親ジョブと子ジョブがある、`parentsOnly: false` — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | 親ジョブと子ジョブの両方が返る |
| TC-job-108 | listJobs: 状態で絞り込む — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | 該当状態のジョブだけが返る |
| TC-job-109 | listJobs: 種別で絞り込む — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | 該当種別のジョブだけが返る |
| TC-job-110 | listJobs: 未知の状態を指定する — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `ValidationError("INVALID_FILTER")` が投げられる |
| TC-job-111 | listJobs: 未知の種別を指定する — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `ValidationError("INVALID_FILTER")` が投げられる |
| TC-job-112 | listJobs: ジョブが 0 件 — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | 空配列と `count: 0` が返る |
| TC-job-113 | listJobs: 対象ノートが削除済みのジョブ — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `targetLabel` が「削除済み」として返る |
| TC-job-114 | listJobs: 生成物の期限が切れたジョブ — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `artifact.expired: true` が返る |
| TC-job-115 | listJobs: 失敗したジョブで再試行上限に達している — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `retryable: false` が返る |
| TC-job-116 | listJobs: batch 親ジョブがある — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | global `job_history` projectionの `childSummary` が返る。batch 親以外は `null` |
| TC-job-117 | listJobs: 終端した batch 親ジョブ（子 100 件中 98 件成功） — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | 終端後も `childSummary` が残り、「100 件中 98 件成功」を作れる（親の状態に依存せず子の現況から数え直すため）。`progress` は `running` 限定のため `null` になる |
| TC-job-118 | listJobs: 一覧に異なるscopeのJobが含まれる — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | global D1 projectionだけで1ページを返し、scope DOへfan-outしない |
| TC-job-119 | listJobs: job_historyがrequestedBy hashで分割済み — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | userIdから1 shardを決定し、異なるscopeの親子をそのshardだけで1ページ化する |
| TC-job-120 | listJobs: projectionが古い — cancelを実行する | spec/testcases/job/listJobs.md#テストケース-listjobs | 表示値を信用せずJobIdのscopeへrouteし、scope-local正データで可否を再判定する |
| TC-job-121 | listJobs: `failed` の `bulkExport` 親で子が全件終端・成功 1 件以上 — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `retryable: true` が返る（`retryJob` で組み立てだけをやり直せる） |
| TC-job-122 | listJobs: `failed` の `bulkExport` 親で子に未終端が残る、または成功が 0 件 — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `retryable: false` が返る |
| TC-job-123 | listJobs: `failed` の batch 親（`bulkExport` 以外） — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `retryable: false` が返る（導線は `retryFailedChildren`） |
| TC-job-124 | listJobs: 実行中のジョブがある — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `activeCount` が 1 以上になり、進捗が含まれる |
| TC-job-125 | listJobs: `limit` を 101 にする — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | `ValidationError("INVALID_PAGINATION")` が投げられる |
| TC-job-126 | listJobs: 公開ステータスを適用できなかった変換ジョブがある — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | その行の `notices` に `visibilityNotApplied` が入る |
| TC-job-127 | listJobs: 終端していないジョブがある — 一覧する | spec/testcases/job/listJobs.md#テストケース-listjobs | その行の `notices` は空配列になる |
| TC-job-128 | projectJobHistory: scope-local Jobがenqueueされた — `job.enqueued`を処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | JobIdのscopeから現在値を読み、global `job_history`へ表示snapshotを保存する |
| TC-job-129 | projectJobHistory: running Jobの進捗が1分または5%変わる — `job.progressed`を処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | current snapshotのprogressをglobal historyへ更新する |
| TC-job-130 | projectJobHistory: 500子が短時間に1件ずつ終端する — 親進捗を更新する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 5% bucketで中間eventを最大20程度に抑え、terminal eventは必ず発行する |
| TC-job-131 | projectJobHistory: 対象Note/Fileが削除される — `note.purged` / `storage.fileDeleted`を処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | target hash reverse indexを100件ずつ読み、requestedBy shardの対応履歴を「削除済み」に更新する |
| TC-job-132 | projectJobHistory: 1 targetに数千履歴がある — target削除を処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 100件page・最大6 shard並行でcontinuationし、全history shard scanを行わない |
| TC-job-133 | projectJobHistory: target削除の1page目が100件 — 続きを確認する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | `target`, 同じ`operationId`, `nextCursor`を持つ`job.targetHistoryCleanupContinued`を1件だけ保存する |
| TC-job-134 | projectJobHistory: startedの後に古いenqueued eventが届く — 処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | `sourceVersion`が古いためstarted snapshotを上書きしない |
| TC-job-135 | projectJobHistory: batch子が終端した — eventを処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 親の現在値とchild summaryも再投影する |
| TC-job-136 | projectJobHistory: event処理前にJob正データが削除された — 処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | eventのrequestedByでhistory shardを選び、対応するglobal historyをremoveして成功する |
| TC-job-137 | projectJobHistory: removal manifestの1pageに親子100 routeが入る — `job.removed`を処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | requestedBy別にgroupingし、最大6 shard並行のwaveで全historyを冪等に削除する |
| TC-job-138 | projectJobHistory: 同じtargetを複数利用者が処理した — target削除を処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | reverse indexの`{ requestedBy, jobId }`から各history shardへ直接到達する |
| TC-job-139 | projectJobHistory: target削除と新しいhistory upsertが競合する — 並行処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | target hash tombstoneを先に保存し、後発upsertも最初から「削除済み」になって表示を復活させない |
| TC-job-140 | projectJobHistory: 通常eventを初回投影する — reverse index登録とhistory保存の順を確認する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | batch以外は`registerBeforeHistory`成功後だけhistoryをupsertし、登録応答喪失はevent IDで再実行する |
| TC-job-141 | projectJobHistory: reverse route登録後にhistory upsertが失敗する — eventを再配送する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 同じoperation IDで登録をno-opにし、history upsertを完了する |
| TC-job-142 | projectJobHistory: consumerがJobを読んだ後にfamily removalが完了する — 遅延upsertを再開する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | routeの`routeRemoved`またはrequestedBy shardのhistory removal tombstoneがupsertを拒否し、履歴を復活させない |
| TC-job-143 | projectJobHistory: `job.removed`を処理する — manifest pageを削除する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 各itemの`tombstoneRoute`成功後だけhistoryをremoveし、両方成功後にscope manifestへackする |
| TC-job-144 | projectJobHistory: removal manifestに101 itemある — 処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 100件ack後に`job.removalGlobalContinued`を保存し、残り1件を次turnで処理する |
| TC-job-145 | projectJobHistory: 全101 itemをackした — manifestを縮約する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | `job.removalManifestCompactContinued`で100件、1件に分け、item 0件のUoWだけがheaderをcompletedにする |
| TC-job-146 | projectJobHistory: route/history tombstoneの30日またはtarget tombstoneの120日を跨ぐ — prunerを実行する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 期限前は保持し、期限後かつ安全条件成立時だけ100件ずつ回収する |
| TC-job-147 | projectJobHistory: batch親を投影する — reverse indexを確認する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | `target.type = batch`は実体削除対象でないためreverse routeへ登録せず、null target shardへ集中させない |
| TC-job-148 | projectJobHistory: 同じeventが再配送される — 処理する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | 条件付きupsert/removeにより結果は変わらない |
| TC-job-149 | projectJobHistory: `JobFailure.detail`がある — 投影を読む | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | `failure_detail`を含む表示snapshotが復元できる |
| TC-job-150 | projectJobHistory: 全scopeからJob eventがburstする — 投影する | spec/testcases/job/projectJobHistory.md#テストケース-projectjobhistory | requestedBy hash shardへ分散し、同じ利用者の親子は1 shardでsourceVersion順に更新される |
| TC-job-151 | pruneJobHistory: `finishedAt` が 91 日前で親を持たないジョブがある — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 削除される |
| TC-job-152 | pruneJobHistory: `finishedAt` が 89 日前のジョブがある — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 残る |
| TC-job-153 | pruneJobHistory: `finishedAt` がちょうど 90 日前のジョブ — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 残る（境界は排他） |
| TC-job-154 | pruneJobHistory: 作成は 100 日前だが `finishedAt` は 10 日前のジョブ — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 比較は終了時刻で行うため残る |
| TC-job-155 | pruneJobHistory: `retentionDays: 30` を指定する — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | `finishedAt` が 30 日より前のジョブだけが削除される |
| TC-job-156 | pruneJobHistory: 実行中のジョブがある — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 終端状態でない（`finishedAt` を持たない）ため削除されない |
| TC-job-157 | pruneJobHistory: 待機中のジョブがある — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 同じく削除されない |
| TC-job-158 | pruneJobHistory: 91 日前に終了した親ジョブとその子がある — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 削除の起点は親（`parentId === null`）で、route manifest完成後に子を100件ずつ、最後に親を消す |
| TC-job-159 | pruneJobHistory: 子だけが 91 日前に終端し、親は `retryFailedChildren` で `running` に戻っている — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 子は単独では削除されない（起点が親に限られるため）。子が消えると `summarizeChildren` の件数が `total` に届かず親が永久に終端しなくなる |
| TC-job-160 | pruneJobHistory: 子は 100 日前に終端したが親の `finishedAt` は 10 日前 — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 保持期間は起点である親の `finishedAt` で判定されるため、親子とも残る |
| TC-job-161 | pruneJobHistory: 親が 91 日前に終端し、子の一部は 10 日前に終端している — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 保持判定は親で行い、manifestにfamily全件を固定してから削除する |
| TC-job-162 | pruneJobHistory: 90 日より前に終了した匿名ジョブ（`requestedBy: null`）がある — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 削除される（匿名ジョブは `parentId: null` のみ構成できるため必ず削除の起点になる。退会時の `deleteJobsForRequester` が及ばないため、これが唯一の掃除経路） |
| TC-job-163 | pruneJobHistory: 500子のbatch親 — 削除する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | manifestを100件ずつ6 turnで固定し、各local/global pageも100件以下のまま全501 history/reverse routeを回収する |
| TC-job-164 | pruneJobHistory: manifest構築の3page目で停止する — recoveryする | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 保存済みcursorと同じoperation IDから再開し、Job削除前に全family routeを固定する |
| TC-job-165 | pruneJobHistory: local family削除後にglobal cleanupが停止する — recoveryする | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 残るmanifest itemのtarget/requestedByからreverse routeとhistoryを再開する |
| TC-job-166 | pruneJobHistory: manifest構築中または子削除途中 — retry/progress/terminal/cancel/reapを競合させる | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | root claimにより全通常transitionを`JOB_REMOVAL_IN_PROGRESS`で拒否し、claim ownerだけが続行する |
| TC-job-167 | pruneJobHistory: claim直後に応答を失う — 同じrootを再選択する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | scope+root由来の同じremoval operation IDとmanifest stateから再開する |
| TC-job-168 | pruneJobHistory: family cleanupが完了した — taskを確認する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 次のrootへ進み、対象0件で翌日へ戻す |
| TC-job-169 | pruneJobHistory: global ackが全件完了した — manifest prunerを実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | itemを100件ずつ縮約し、completed headerは30日保持後に最大100件ずつ回収する |
| TC-job-170 | pruneJobHistory: ack済みmanifest itemが101件ある — 縮約する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 100件を消して同じ`job.removalManifestCompactContinued`を保存し、次turnの1件後にだけheaderをcompletedへ移す |
| TC-job-171 | pruneJobHistory: ack済みmanifest itemが501件ある — 縮約する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 6 turnに分け、各transactionのDELETEは100件以下 |
| TC-job-172 | pruneJobHistory: history tombstone 250件が30日を越えた — global Cronを実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | generation/shard/table cursorから100件ずつ回収する |
| TC-job-173 | pruneJobHistory: target tombstoneが120日ちょうど — global Cronを実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 境界前は保持し、期限到達後も対応route/保持窓内Jobが0件の場合だけ回収する |
| TC-job-174 | pruneJobHistory: tombstone100件の削除応答を失う — continuationを再実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 同じcursorで冪等に再開し、全shardを1 invocationへ詰めない |
| TC-job-175 | pruneJobHistory: target shardのDELETE後、run checkpoint前に停止する — continuationを再実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 同じ入力cursorのDELETEを冪等再実行し、次cursor/command keyとQueue outboxをcatalog transactionで保存する |
| TC-job-176 | pruneJobHistory: 32 shardのglobal tombstone runが次hourにも未完了 — 次hourのCronを起動する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 同kindの新runを作らず最古running runを再開し、重複走査せずactive laneを最大6に保つ |
| TC-job-177 | pruneJobHistory: global tombstone Cronが重複起動し、その後lease ownerが停止する — lease期限後に再実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | lease中は片方がno-op、期限後は同じrun/positionを別ownerが回復する |
| TC-job-178 | pruneJobHistory: completed global maintenance runが30日を越えて101件ある — run prunerを実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | 100+1件の2 turnで回収し、running runと30日境界前のrunは残す |
| TC-job-179 | pruneJobHistory: 対象が 0 件 — 実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | `deletedCount: 0` が返る |
| TC-job-180 | pruneJobHistory: global Cronが起動する — `{ type: "job.globalTombstonePruneCron" }`で実行する | spec/testcases/job/pruneJobHistory.md#テストケース-prunejobhistory | scope retention行を読まず、global runと共通maintenance-run pruner taskを開始する |
| TC-job-181 | reapExpiredJobs: リース失効（`leaseExpiresAt <= now`）の `running` が 3 件 — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 3 件が `failed("timeout")` になり、`expiredCount: 3` と `job.failed` × 3 が返る |
| TC-job-182 | reapExpiredJobs: リースが失効した `running` を回収した — 回収されたジョブを再試行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | `attempts` が 0 に戻っているため手動 `retry` できる |
| TC-job-183 | reapExpiredJobs: 回収したジョブが `kind: "conversion"` で対象ノートが `processing` のまま — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 「共通: 強制終端の後始末」を `cause: { type: "expired" }` として同一 UoW で実行し、`Note.markConversionFailed("timeout")` で本文が `failed(timeout)` になる（`processing` のまま固定されて移動も作り直しもできなくなるのを防ぐ） |
| TC-job-184 | reapExpiredJobs: 回収したジョブが `kind: "regeneration"`、または対象ノートが既に `ready` / `failed` — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 本文は書き換えられない（再生成は失敗しても `ready` を保つ設計。`processing` 以外は回復の対象外） |
| TC-job-185 | reapExpiredJobs: 回収したのが `bulkExport` の batch 親で、成功済みの子が artifact を持つ — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 生成物の回収は**行わない**。`failed` の親は `reopenBatch` で開き直せるため、成功済みの子の artifact は組み立ての資材として残す（回収するのは `canceled` を作る強制終端の経路だけ） |
| TC-job-186 | reapExpiredJobs: 同じ行を 2 回処理する — 2 回実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 本文の回復は `content.status === "processing"` のときだけ書き換えるため、2 回目は `failed(timeout)` のまま変わらない（冪等） |
| TC-job-187 | reapExpiredJobs: リースが有効な `running` がある — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 触れられない（`listExpiredRunning` に含まれない） |
| TC-job-188 | reapExpiredJobs: 失効した `running` が 150 件ある — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 100件を終端し、残り50件のcontinuationを直後のAlarmへ設定する |
| TC-job-189 | reapExpiredJobs: 組み立て中の `bulkExport` 親が落ちた — 15 分後に実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 組み立てリースは 15 分（キューのコンシューマーの壁時計と同じ）なので失効しており、`Job.expire` で `failed(timeout)` になる。60 分ではない |
| TC-job-190 | reapExpiredJobs: 単体ジョブ（または batch の子）が最後の `Job.start` / `reportProgress` から 15 分経過した — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | リース失効として `failed("timeout")` に回収される（境界値） |
| TC-job-191 | reapExpiredJobs: 同じジョブが最後の延長から 14 分しか経っていない — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | リース有効のため対象外（境界値） |
| TC-job-192 | reapExpiredJobs: batch 親が最後の子の終了報告から 60 分経過した — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 進捗リースの失効として `failed("timeout")` に回収される（境界値） |
| TC-job-193 | reapExpiredJobs: batch 親が最後の子の終了報告から 59 分しか経っていない — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | リース有効のため対象外（境界値） |
| TC-job-194 | reapExpiredJobs: 組み立て中の `bulkExport` 親（`attempts >= 1`）で、組み立てワーカーが停止した後も遅れて届く・重複配送される子の終了報告で `reportProgress` が呼ばれ続ける — 15 分経過後に実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 組み立て中の親のリースは `reportProgress` では延びないため必ず失効し、`failed("timeout")` に回収される（`running` のまま永久に残らない） |
| TC-job-195 | reapExpiredJobs: 子の投入が中断され、`total` に届かないまま子の終了が止まった batch 親 — 60 分経過後に実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 親のリースが延長されないため `failed("timeout")` として回収される（親が「処理中」のまま残らない） |
| TC-job-196 | reapExpiredJobs: Jobを持たないscopeが多数ある — global Cronを確認する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 全scope列挙は行わず、Alarm未設定のobjectは起動しない |
| TC-job-197 | reapExpiredJobs: 外部I/O Jobのleaseとadmission leaseが失効している — 回収する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | Jobのexpireと同じscope-local処理でadmission leaseも削除し、4枠のcountから外す |
| TC-job-198 | reapExpiredJobs: dueなprojection/期限回収taskが大量にある — Alarmを実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | priority 0のlease reapingに最低枠があり、最古task age 1分SLO内で処理される |
| TC-job-199 | reapExpiredJobs: 1 turnで100行またはCPU 2秒に達する — Alarmを実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 処理をyieldして次のAlarmを設定し、foreground mutationを長時間塞がない |
| TC-job-200 | reapExpiredJobs: `queued` のジョブがある — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 対象外で変化しない |
| TC-job-201 | reapExpiredJobs: 終端状態（`succeeded` / `failed` / `canceled`）のジョブがある — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 対象外で変化しない |
| TC-job-202 | reapExpiredJobs: 対象が 0 件 — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | `expiredCount: 0` が返る |
| TC-job-203 | reapExpiredJobs: 回収直後にもう一度実行する — 2 回実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 2 回目は対象が残っていないため 0 件で終わる（冪等） |
| TC-job-204 | reapExpiredJobs: 引き継ぎ再開（`Job.start`。batch 親の組み立ては `Job.beginAssembly`）と競合する — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 楽観ロックでどちらか一方だけが成立し、版が競合した行はスキップして継続する |
| TC-job-205 | reapExpiredJobs: 1 件の保存が失敗する — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | 失敗を記録して次の行へ進む（部分失敗の許容） |
| TC-job-206 | reapExpiredJobs: リース有効な `running` に `Job.expire` を適用する — 直接呼ぶ | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | `BusinessRuleError(LeaseActive)` で拒否される |
| TC-job-207 | reapExpiredJobs: 引き継ぎ再開（`Job.start`）で `attempts` が上限を超えた — 適用の順序を確認する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | リースを張り直さず、受け取ったジョブ（リース失効のまま）に `Job.expire` を適用する。先に `leaseUntil` へ張り直してから `expire` を当てるとリース有効とみなされて `LeaseActive` で拒否され、上限超過の回収経路が成立しない |
| TC-job-208 | reapExpiredJobs: `Job.beginAssembly` で `attempts` が上限を超えた — 適用の順序を確認する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | `start` と同じ順序に従い、リースを張り直さず受け取った親（リース失効のまま）に `expire` を適用する（上限に達するのは `attempts >= 2` の親だけで、直前の `LeaseActive` 判定を抜けている以上リースは必ず失効している） |
| TC-job-209 | reapExpiredJobs: 列挙時に DB が落ちている — 実行する | spec/testcases/job/reapExpiredJobs.md#テストケース-reapexpiredjobs | `SystemError(DatabaseError)` が投げられる |
| TC-job-210 | retryFailedChildren: 子 10 件のうち 3 件が失敗している — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | 3 件が `queued` に戻り、`retriedCount: 3` が返る |
| TC-job-211 | retryFailedChildren: 失敗した子が 0 件 — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `ValidationError("NO_RETRYABLE_CHILD")` が投げられる |
| TC-job-212 | retryFailedChildren: 失敗した子のうち 1 件が上限に達している — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | その 1 件は `skipped` に積まれ、残りが再試行される |
| TC-job-213 | retryFailedChildren: 対象が削除済みの子がある — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | その子は `skipped` に積まれる |
| TC-job-214 | retryFailedChildren: 親がまだ `running` で組み立てが始まっていない（`attempts === 0`） — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `Job.reportProgress` で進捗が作り直され、進捗リースが延長される |
| TC-job-215 | retryFailedChildren: 親がまだ `running` で組み立て中（`bulkExport` かつ `attempts >= 1`） — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `BusinessRuleError(AssemblyInProgress)` が投げられ、失敗した子は 1 件も `Job.retry` されない（手順 2。弾かないと組み立てワーカーが再試行前の子集合のまま `succeed(artifact)` し、再試行した子の結果が ZIP に入らないまま親が固定される） |
| TC-job-216 | retryFailedChildren: 組み立て中の親のリースが既に失効している（`running` かつ `attempts >= 1` のまま、リーパー未着） — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | 同じく `AssemblyInProgress` で拒否される（リースの有効・失効で分けない。失効した親に再試行を許しても `attempts >= 1` のままではリースを延ばせず、リーパーの回収を待つあいだに親だけが `failed` になって子の終端が行き場を失う） |
| TC-job-217 | retryFailedChildren: 親が `canceled` で終端していて、キャンセル前に `failed` だった子が残っている — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `BusinessRuleError(JobNotRetryable)` が投げられ、失敗した子は 1 件も `Job.retry` されない（手順 3。`Job.reopenBatch` は `CanceledJob` を受け取らず親を戻せないため、子だけ戻すと `updateBatchProgress` が「終端状態なら何もせず返す」で抜けて結果が行き場を失う。取り消したものは元の操作をやり直す） |
| TC-job-218 | retryFailedChildren: 親が `succeeded` で終端している — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `Job.reopenBatch` で `running` に戻る（終端状態から戻れる唯一の例外） |
| TC-job-219 | retryFailedChildren: 親が `failed` で終端している — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `Job.reopenBatch` で `running` に戻り、`failure` と `finishedAt` が捨てられる |
| TC-job-220 | retryFailedChildren: 親が `succeeded` の `bulkExport` で、組み立て済みの ZIP（`artifact`）を持つ — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `Job.reopenBatch` が `artifact` の参照を捨てるのに合わせ、その保管ファイルが同一 UoW で「保管ファイルの削除手順」により破棄される（[usecases/job.md](../usecases/job.md) の「親を開き直すときの生成物の破棄」）。開き直しと破棄はどちらかが失敗すれば両方巻き戻る |
| TC-job-221 | retryFailedChildren: 親が `failed` / `canceled`、または `bulkExport` 以外の batch 親 — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | 破棄する生成物はない（`artifact` を持つのは `succeeded` のみで、自身の実行を持つのは `bulkExport` 親だけ） |
| TC-job-222 | retryFailedChildren: 子 500 件の親で失敗した子が 120 件ある — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `listChildren` を全ページ走査して 120 件すべてを集める（`limit` の上限は 100 なので 1 ページには収まらない） |
| TC-job-223 | retryFailedChildren: 終端した親を戻す — `reopenBatch` の第 2 引数を確認する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `retry` 適用後の子の現況を `BatchProgressCalculator.summarize` で集計し直した `BatchSummary` を渡す（`JobProgress` ではない）。進捗は `reopenBatch` が `{ completed: succeeded + failed + canceled, total: summary.total }` として作り直す |
| TC-job-224 | retryFailedChildren: 子 10 件のうち 3 件を再試行した — 親の進捗を確認する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `retry` 適用後の子の現況から計算し直され、`completed` が終端の子の件数（7）になる |
| TC-job-225 | retryFailedChildren: 親を `reopenBatch` で戻した — 親の `startedAt` を確認する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | 元の値が維持されている |
| TC-job-226 | retryFailedChildren: 親を `reopenBatch` で戻した — 親の `attempts` を確認する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | 0 に戻る（親自身の実行＝組み立てを改めて主張できるようにするため） |
| TC-job-227 | retryFailedChildren: `bulkExport` 親を `reopenBatch` で戻した（`retry` した子が未終端になる） — 発行イベントを確認する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `reopenBatch` は `WithEventDrafts` を返すが、`summary.settled` が偽のため `job.readyToAssemble` を発行しない |
| TC-job-228 | retryFailedChildren: 組み立て中の再試行が `AssemblyInProgress` で拒否されたあと、組み立てワーカーが完了して親が `succeeded`（または落ちてリース失効で `reapExpiredJobs` が `failed("timeout")` に回収）した — 改めて失敗した子を再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | 拒否は一時的で、待てば必ず解ける（組み立て中の親は必ず終端に至る）。終端した親は手順 6 の `Job.reopenBatch` 経路に合流して `running` に戻り、`attempts` が 0 に戻る。再試行した子が改めて全件終端すると `updateBatchProgress` が `job.readyToAssemble` を発行し、`Job.beginAssembly` が実行権を取り直して組み立てからやり直せる |
| TC-job-229 | retryFailedChildren: `bulkExport` 以外の kind の親を `reopenBatch` で戻した — 発行イベントを確認する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | イベントは発行されない（発行条件は `kind === "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1`） |
| TC-job-230 | retryFailedChildren: 再試行した子 — 実行系への送信を確認する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `job.enqueued` を購読するハンドラーが送る（このユースケースは `JobDispatcher` を直接呼ばない） |
| TC-job-231 | retryFailedChildren: 他の利用者の親ジョブ — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | `NotFoundError("JOB_NOT_FOUND")` が投げられる |
| TC-job-232 | retryFailedChildren: 成功した子がある — 再試行する | spec/testcases/job/retryFailedChildren.md#テストケース-retryfailedchildren | 成功した子は再実行されない |
| TC-job-233 | retryJob: 失敗したジョブで原因が解消済み — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `queued` に戻り、実行系に送られる |
| TC-job-234 | retryJob: 実行中のジョブ — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(JobNotRetryable)` が投げられる |
| TC-job-235 | retryJob: 成功したジョブ — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(JobNotRetryable)` が投げられる |
| TC-job-236 | retryJob: 試行回数が 3 回に達している — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(RetryLimitExceeded)` が投げられる |
| TC-job-237 | retryJob: 試行回数が 2 回 — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 成功する（境界値） |
| TC-job-238 | retryJob: リース失効を検出したリーパー（`reapExpiredJobs`）が `failed("timeout")` に回収したジョブ — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `Job.expire` で `attempts` が 0 に戻っているため `queued` に戻る |
| TC-job-239 | retryJob: 引き継ぎ再開で試行上限を超え `failed("timeout")` になったジョブ — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 同じく `attempts` が 0 のため `queued` に戻る |
| TC-job-240 | retryJob: `failed` の `bulkExport` 親（子は全件終端・成功 1 件以上） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 失敗したのは ZIP の組み立てなので、`summarizeChildren` が返した `BatchSummary` をそのまま `Job.reopenBatch(parent, summary, now, leaseUntil)` に渡して `running` に戻り、`job.readyToAssemble` が発行されて組み立てだけがやり直される |
| TC-job-241 | retryJob: `reopenBatch` の呼び出し — 第 2 引数を確認する | spec/testcases/job/retryJob.md#テストケース-retryjob | `JobProgress` ではなく `BatchSummary`（`summarizeChildren` の結果）を渡す。呼び出し側は `completed` を組み立てず、`reopenBatch` が `{ completed: succeeded + failed + canceled, total: summary.total }` として作り直す |
| TC-job-242 | retryJob: `bulkExport` 親を `reopenBatch` で戻した — 発行イベントを確認する | spec/testcases/job/retryJob.md#テストケース-retryjob | `kind === "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1` のときだけ `job.readyToAssemble` が発行される |
| TC-job-243 | retryJob: `bulkExport` 親を `reopenBatch` で戻した — `attempts` を確認する | spec/testcases/job/retryJob.md#テストケース-retryjob | 0 に戻っており、`Job.beginAssembly` が改めて組み立ての実行権を取れる |
| TC-job-244 | retryJob: `failed` の `bulkExport` 親で子に未終端が残る — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(JobNotRetryable)` が投げられる |
| TC-job-245 | retryJob: `failed` の `bulkExport` 親で子は全件終端だが成功が 0 件 — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(JobNotRetryable)` が投げられる（`reopenBatch` の発行条件にも当たらないため、組み立てるものがないまま親が `running` で滞留し `timeout` を待つ状態を作らない） |
| TC-job-246 | retryJob: `failed` の batch 親（`bulkExport` 以外） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(JobNotRetryable)` が投げられる（子の再試行は `retryFailedChildren` の担当。batch 親を `queued` に戻しても `job.enqueued` の購読ハンドラーがキューへ送らないため実行されない） |
| TC-job-247 | retryJob: `succeeded` の `bulkExport` 親（ZIP の artifact を持つ）を子の再試行で開き直す — 開き直す | spec/testcases/job/retryJob.md#テストケース-retryjob | `Job.reopenBatch` が `artifact` の参照を捨てるのに合わせ、古い ZIP の保管ファイルが同一 UoW で「保管ファイルの削除手順」により破棄される（誰からも参照されない行が TTL まで残らない） |
| TC-job-248 | retryJob: 失敗した**子ジョブ**で親が組み立て中（`bulkExport` かつ `running` かつ `attempts >= 1`） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(AssemblyInProgress)` が投げられ、`Job.retry` は適用されない（`retryFailedChildren` の手順 2 と同じガード。子を 1 件だけ指しても組み立てワーカーとの競合は同じ） |
| TC-job-249 | retryJob: 失敗した**子ジョブ**で親が `canceled` — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(JobNotRetryable)` が投げられる（`retryFailedChildren` の手順 3 と同じガード。`reopenBatch` は `CanceledJob` を受け取らないため、子だけ戻すと結果が行き場を失う） |
| TC-job-250 | retryJob: 失敗した**子ジョブ**で親が `failed` / `succeeded` — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 子が `queued` に戻り、同一 UoW で親も `Job.reopenBatch` で `running` に戻る（`retry` 適用後の子の現況を `BatchProgressCalculator.summarize` で集計し直した `BatchSummary` を渡す） |
| TC-job-251 | retryJob: 失敗した**子ジョブ**で親が `running`（`attempts === 0`） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 子が `queued` に戻り、同一 UoW で親の進捗が `Job.reportProgress` で作り直される（進捗リースの延長を兼ねる） |
| TC-job-252 | retryJob: 対象ノートが削除済み — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `ValidationError("TARGET_MISSING")` が投げられる |
| TC-job-253 | retryJob: 失敗理由が `integrationRequired` で連携の行がないまま（未連携） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられ、連携すれば再実行できる旨が案内される |
| TC-job-254 | retryJob: 失敗理由が `providerAuthFailed` で連携が失効したまま（`ExpiredConnection`） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(ReauthorizationRequired)` が投げられ、再連携が要る旨が案内される（未連携とは案内が異なるため畳まない） |
| TC-job-255 | retryJob: 失敗理由が `driveBackup` 由来で Google Drive が未連携 — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `provider` が `kind` から `googleDrive` に決まり `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる |
| TC-job-256 | retryJob: 失敗理由が `integrationRequired` で連携済み（`ActiveConnection`）になった — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 成功する |
| TC-job-257 | retryJob: 失敗理由が `providerAuthFailed` で再連携済みになった — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 成功する |
| TC-job-258 | retryJob: 失敗理由が `integrationRequired` / `providerAuthFailed` 以外（`corruptedFile` など） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 連携の確認は行われず、対象と権限の確認だけで再試行される |
| TC-job-259 | retryJob: 対象への権限を失っている — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `BusinessRuleError(AccessDenied)` が投げられる |
| TC-job-260 | retryJob: 他の利用者のジョブ — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | `NotFoundError("JOB_NOT_FOUND")` が投げられる |
| TC-job-261 | retryJob: 匿名ジョブ（`requestedBy: null`） — 再試行する | spec/testcases/job/retryJob.md#テストケース-retryjob | 所有の確認で `NotFoundError("JOB_NOT_FOUND")` になる（匿名の再試行は `exportNote` の再実行） |
| TC-job-262 | updateBatchProgress: 子 10 件のうち 3 件が終端（組み立てが始まる前の親。`attempts === 0`） — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親の進捗が 3 / 10 になり、`reportProgress` が親の進捗リースを 60 分先へ延長する |
| TC-job-263 | updateBatchProgress: 組み立て中の `bulkExport` 親（`attempts >= 1`）で、遅れて届いた・重複配送された子の終了報告により進捗が動いた（組み立て中は `retryFailedChildren` が `AssemblyInProgress` で弾かれるため、子の再試行では起こらない） — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | `reportProgress` は進捗だけを作り直し、`leaseExpiresAt` を延長しない（組み立て中の親の期限を動かせるのは実行権を持つワーカーの `renewAssemblyLease` だけ） |
| TC-job-264 | updateBatchProgress: 組み立て中の親（`attempts >= 1`）で組み立てワーカーが停止した — 子の終了報告を繰り返し処理する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | `reportProgress` が期限を延ばさないため組み立てリースは必ず失効し、`beginAssembly` の再取得か `reapExpiredJobs` の回収に戻る（`running` のまま永久に終端しない） |
| TC-job-265 | updateBatchProgress: 全 10 件が成功（`bulkExport` 以外の kind） — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親が `succeeded` になる |
| TC-job-266 | updateBatchProgress: 8 件成功・2 件失敗（`bulkExport` 以外の kind） — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親が `succeeded` になる（部分失敗を含む） |
| TC-job-267 | updateBatchProgress: 全 10 件が失敗 — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親が `failed`（`reason: "unknown"`）になる。**内訳は `detail` に書かない** — 利用者向けの内訳は `childSummary` が子の行から数え直して返すため、`detail` に凍結した内訳を持つと再試行後に実態とずれる |
| TC-job-268 | updateBatchProgress: 全件終端で成功が 1 件以上 — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親が `succeeded` になり、`notices` は空配列で渡される（集計から申し送りは生まれない） |
| TC-job-269 | updateBatchProgress: 全件がキャンセル — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親が `canceled` になる |
| TC-job-270 | updateBatchProgress: `kind: "bulkExport"` の親で全子が終端し、成功が 1 件以上 — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親は終端化せず、進捗が `total` まで進んで `job.readyToAssemble` が発行される（終端化は `runBulkExport` の `succeed(artifact)` が行う） |
| TC-job-271 | updateBatchProgress: `kind: "bulkExport"` の親で全子が終端し、成功が 0 件・失敗あり — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 他の kind と同じ規則で `failed` になり、`job.readyToAssemble` は発行されない |
| TC-job-272 | updateBatchProgress: `kind: "bulkExport"` の親で全子がキャンセル — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親が `canceled` になり、`job.readyToAssemble` は発行されない |
| TC-job-273 | updateBatchProgress: `kind: "bulkExport"` の親で未終了の子が残っている — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 進捗だけが更新され、`job.readyToAssemble` は発行されない |
| TC-job-274 | updateBatchProgress: `kind: "bulkExport"` の親で同じイベントを 2 回受け取る — 2 回更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | `job.readyToAssemble` が重複発行されうるが、`runBulkExport` は「batch 親の組み立て規則」に従い `Job.beginAssembly` の実行権（親の `attempts` とリースの組）で二重の組み立てを防ぐ |
| TC-job-275 | updateBatchProgress: `retryFailedChildren` / `retryJob` が `reopenBatch` で親を `running` に戻した — 親のイベントを確認する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | `reopenBatch` は `WithEventDrafts` を返し、`kind: "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1` のときだけ `job.readyToAssemble` を発行する（`applyTo` の `bulkExport` の例外と同じ条件） |
| TC-job-276 | updateBatchProgress: 全子終端だが成功 0 件の `bulkExport` 親を `reopenBatch` で戻した — 親のイベントを確認する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | `summary.succeeded === 0` のため `job.readyToAssemble` は発行されない（発行すると `runBulkExport` は組み立てるものを持たずに何もせず返り、親が `running` のまま `timeout` を待つ） |
| TC-job-277 | updateBatchProgress: `reopenBatch` で戻した親に未終端の子が残っている（`summary.settled` が偽） — 子が改めて全件終端して更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | `reopenBatch` 自身はイベントを発行せず、`job.readyToAssemble` はこの `updateBatchProgress` が全子終端時に発行する |
| TC-job-278 | updateBatchProgress: `kind: "conversion"` の親（`startBulkUpload`）で、変換不能だった子が `failed` で終端した — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | その子も終端として数えられ、全子終端で親が終端する |
| TC-job-279 | updateBatchProgress: `kind: "conversion"` の親で `total: 5` に対し子が 4 件しか登録されなかった — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 親は終端せず、`total` も変更されない（回収は `reapExpiredJobs` の責務） |
| TC-job-280 | updateBatchProgress: 既に終端状態の親 — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 何もせず返る |
| TC-job-281 | updateBatchProgress: 同じイベントを 2 回受け取る — 2 回更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 現在の子の状態から計算されるため結果が変わらない |
| TC-job-282 | updateBatchProgress: 親が存在しない — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | 何もせず成功として返る |
| TC-job-283 | updateBatchProgress: 版が競合する — 更新する | spec/testcases/job/updateBatchProgress.md#テストケース-updatebatchprogress | `ConflictError` が投げられ、再配送に委ねられる |
| TC-note-001 | applyTextNodeEdits: 本文があり、有効な経路と `expected` を指定する — 編集を適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | そのテキストノードだけが書き換わり、要素・属性は保たれる |
| TC-note-002 | applyTextNodeEdits: 元の HTML に `class` と `style` がある — 編集を適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | 属性がそのまま残る |
| TC-note-003 | applyTextNodeEdits: 存在しない経路を指定する — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | その編集は `skipped(pathNotFound)` になり、他は適用される |
| TC-note-004 | applyTextNodeEdits: `expected` が現在の内容と異なる — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | その編集は `skipped(contentChanged)` になる |
| TC-note-005 | applyTextNodeEdits: すべての編集が `skipped` になる — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | 成功として返り、版は作られず本文も変わらない |
| TC-note-006 | applyTextNodeEdits: テキストを空文字列にする — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | ノードは削除されず空のまま残る |
| TC-note-007 | applyTextNodeEdits: 本文が `processing` で、実行中の変換・再生成ジョブがない（ジョブがキャンセル・回収された後） — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | 手順 2 の `NoteLockedByJob` 検査を通過し、手順 3 で `BusinessRuleError(CannotCaptureEmptyContent)` が投げられる |
| TC-note-008 | applyTextNodeEdits: 本文が `awaitingIntegration` または `failed`（実行中ジョブなし） — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | 同じく手順 3 で `BusinessRuleError(CannotCaptureEmptyContent)` が投げられる |
| TC-note-009 | applyTextNodeEdits: 本文が `processing` で、その変換ジョブが実行中 — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | 手順 2 が先に効くため、`CannotCaptureEmptyContent` ではなく `BusinessRuleError(NoteLockedByJob)` が投げられる（検査の順序を確認する） |
| TC-note-010 | applyTextNodeEdits: 実行中の再生成ジョブがある（本文は `ready` のまま） — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | `BusinessRuleError(NoteLockedByJob)` が投げられる |
| TC-note-011 | applyTextNodeEdits: `script` の中身を指す経路を指定する — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | `skipped(pathNotFound)` になる（編集対象外） |
| TC-note-012 | applyTextNodeEdits: `<style>` の中身を指す経路を指定する — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | `skipped(pathNotFound)` になる。`editTextNodes` は `<style>` の子テキストノードに経路を割り当てないため、ビジュアルエディタから CSS を書き換えて `position: fixed` / `@import` を再注入する経路が存在しない |
| TC-note-013 | applyTextNodeEdits: 編集が成功した — 保存までの経路を確認する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | `editTextNodes` の結果を `HtmlProcessor.process` に通してから `Note.updateBody` に渡す（`updateBody` は `ProcessedHtml` を要求する。派生情報も作り直される） |
| TC-note-014 | applyTextNodeEdits: 編集でテキストを書き換えた — 保存後の `excerpt` / `headings` を確認する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | 書き換え後の本文から作り直されている（`process` を通さないと読み取りモデルへの投影が古いまま残る） |
| TC-note-015 | applyTextNodeEdits: viewer である — 適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-016 | applyTextNodeEdits: 他者が先に更新した — 古い `expectedVersion` で適用する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-017 | applyTextNodeEdits: 適用が成功した — 版を確認する | spec/testcases/note/applyTextNodeEdits.md#テストケース-applytextnodeedits | 直前の内容が `manualEdit` として記録されている |
| TC-note-018 | changeNoteStyleMode: `styleMode: "default"` のノート — `preserve` に変更する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | 値が更新され、`note.styleModeChanged`（payload に `noteId` と `styleMode`）が発行される |
| TC-note-019 | changeNoteStyleMode: `styleMode: "preserve"` のノート — `default` に変更する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | 値が更新され、同じくイベントが発行される |
| TC-note-020 | changeNoteStyleMode: 変更を保存した — 読み取りモデルを確認する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | `note.styleModeChanged` を購読する `projectNoteChanges` の完全snapshot置換で `style_mode` が反映される（このイベントを発行・購読しないと一覧が恒久的に古くなる） |
| TC-note-021 | changeNoteStyleMode: 変更を保存した — 一覧（`NoteSummary.styleMode`）を確認する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | 変更後の値で表示される（ED-11 の切り替えが一覧に反映される） |
| TC-note-022 | changeNoteStyleMode: 同じ値を指定する — 変更する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | 更新は成立し `note.styleModeChanged` が発行される（差分によるイベントの抑制はしない）。投影は現在の状態からの上書きのため結果は変わらない |
| TC-note-023 | changeNoteStyleMode: — — 未知の値を指定する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | `BusinessRuleError(InvalidStyleMode)` が投げられる |
| TC-note-024 | changeNoteStyleMode: viewer である — 変更する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-025 | changeNoteStyleMode: 古い `expectedVersion` で変更する — 変更する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-026 | changeNoteStyleMode: 変更を保存した — ノートの `version` を確認する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | 版が進む（同版の PDF 生成物の再利用条件がスタイル変更後に外れる） |
| TC-note-027 | changeNoteStyleMode: 変更後 — 公開ページを開く | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | 変更後のスタイルで表示される |
| TC-note-028 | changeNoteStyleMode: 変更後 — HTML でダウンロードする | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | `default` のときだけ既定スタイルが埋め込まれる |
| TC-note-029 | changeNoteStyleMode: 変更後に本文を編集する — 編集する | spec/testcases/note/changeNoteStyleMode.md#テストケース-changenotestylemode | `styleMode` は自動では変わらない |
| TC-note-030 | changeNoteVisibility: 本文のある非公開ノート — 限定公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | 共有リンクが発行され、`shareUrl` が返る |
| TC-note-031 | changeNoteVisibility: ハンドル設定済みで本文のあるノート — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `visibility: "public"` になり、`note.published` が発行される |
| TC-note-032 | changeNoteVisibility: ハンドル未設定の個人ノート — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる |
| TC-note-033 | changeNoteVisibility: スラッグ未設定のワークスペースのノート — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる |
| TC-note-034 | changeNoteVisibility: 他の利用者が作ったワークスペースのノートを自分の個人所有へ移動した（`createdBy` は別人）。所有者の自分はハンドル設定済み — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | 成功する（検査は所有者 `owner.userId` 基準で、`createdBy` は用いない） |
| TC-note-035 | changeNoteVisibility: 同じく移動後のノートで、所有者の自分はハンドル未設定・作成者はハンドル設定済み — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる（作成者のハンドルでは通らない） |
| TC-note-036 | changeNoteVisibility: 個人ノートをワークスペースへ移動した。ワークスペースは公開スラッグ設定済み、作成者はハンドル未設定 — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | 成功する（ワークスペース所有はワークスペースの公開スラッグで判定する） |
| TC-note-037 | changeNoteVisibility: 変換処理中のノート — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `BusinessRuleError(CannotPublishEmptyNote)` が投げられる |
| TC-note-038 | changeNoteVisibility: 「要 LLM 連携」のノート — 限定公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `BusinessRuleError(CannotPublishEmptyNote)` が投げられる |
| TC-note-039 | changeNoteVisibility: 限定公開のノート — 非公開に戻す | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | 共有リンクが無効になり、休眠として保持される |
| TC-note-040 | changeNoteVisibility: 非公開に戻した後 — 再度限定公開にする | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | 同じ共有リンクが復活する |
| TC-note-041 | changeNoteVisibility: パスワード保護された限定公開ノート — 公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | パスワードが解除される |
| TC-note-042 | changeNoteVisibility: 公開ノート — 限定公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | 共有リンクが有効になり、公開タイムラインから消える |
| TC-note-043 | changeNoteVisibility: viewer である — 変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-044 | changeNoteVisibility: ワークスペースが非公開 — そのノートを公開に変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | ノートは公開になる（ワークスペースの公開状態と独立） |
| TC-note-045 | changeNoteVisibility: 他者が先に更新した — 古い `expectedVersion` で変更する | spec/testcases/note/changeNoteVisibility.md#テストケース-changenotevisibility | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-046 | countNotesByCreationDate: 1 月と 3 月にノートがある — 引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | `availableMonths` に 1 月と 3 月だけが含まれる |
| TC-note-047 | countNotesByCreationDate: ある日に 3 件のノートがある — その月を指定して引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | その日の `count: 3` が返る |
| TC-note-048 | countNotesByCreationDate: ノートが 0 件 — 引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | `availableMonths` と `days` がどちらも空になる |
| TC-note-049 | countNotesByCreationDate: タイムゾーンが `Asia/Tokyo` で、UTC では前月末に作られたノート — 引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | 東京時間での月に数えられる |
| TC-note-050 | countNotesByCreationDate: 不正なタイムゾーン文字列 — 引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | `UTC` として扱われ、エラーにならない |
| TC-note-051 | countNotesByCreationDate: ワークスペースの viewer — 引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | 取得できる |
| TC-note-052 | countNotesByCreationDate: 非メンバー — 引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-053 | countNotesByCreationDate: ゴミ箱のノートがある — 引く | spec/testcases/note/countNotesByCreationDate.md#テストケース-countnotesbycreationdate | 集計に含まれない |
| TC-note-054 | createBlankNote: サインイン済み — 個人所有で作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | 非公開・`content.status: "ready"`・本文が空のノートが作られ、`note.created` が発行される |
| TC-note-055 | createBlankNote: ワークスペースの editor — ワークスペース所有で作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | ノートが作られ、所有者がワークスペースになる |
| TC-note-056 | createBlankNote: ワークスペースの viewer — ワークスペース所有で作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-057 | createBlankNote: 非メンバー — ワークスペース所有で作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-058 | createBlankNote: — — タイトルを省略して作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | タイトルが `"無題"`、由来が `auto` になる |
| TC-note-059 | createBlankNote: — — タイトルを指定して作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | 指定した値が入り、由来が `manual` になる |
| TC-note-060 | createBlankNote: — — 201 文字のタイトルで作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | `BusinessRuleError(InvalidTitle)` が投げられる |
| TC-note-061 | createBlankNote: 存在しないワークスペース ID — 作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる |
| TC-note-062 | createBlankNote: 作成直後 — `styleMode` を確認する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | `default` になっている |
| TC-note-063 | createBlankNote: route予約後にscope-local commitが失敗する — 作成する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | reserved routeをoperation IDで解放し、外部からNoteへ到達できない |
| TC-note-064 | createBlankNote: scope-local commit後にactivation応答を失う — 再試行する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | 同じoperation IDでrouteをactiveにし、Noteを二重作成しない |
| TC-note-065 | createBlankNote: reserved routeが期限切れ — recoveryを実行する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | 対象scopeにNoteがあればactivateし、なければreservationを削除する |
| TC-note-066 | createBlankNote: workspaceにNoteを作成する — routeを確認する | spec/testcases/note/createBlankNote.md#テストケース-createblanknote | immutable `created_by` に作成者userIdが入り、membership離脱やNote move後も著者refresh台帳として残る |
| TC-note-067 | deleteNotesForOwner: 退会処理中の利用者の個人所有ノートが 10 件ある（ゴミ箱の 2 件を含む） — account deletionのpersonal cleanup commandを処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | `listByOwner(owner, "all", pagination)` で生死を問わず読み、10 件すべてが削除され、1 件ごとに `note.purged` が発行され、`purgedCount: 10` が返る |
| TC-note-068 | deleteNotesForOwner: ゴミ箱のノートだけを持つ利用者 — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | `lifecycle: "all"` で引くため、ゴミ箱のノートも取りこぼさず削除される |
| TC-note-069 | deleteNotesForOwner: 退会者が作成したワークスペース所有のノートがある — account deletionのpersonal cleanup commandを処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | そのノートは削除されない（AC-09。消えるのは個人所有のみ） |
| TC-note-070 | deleteNotesForOwner: 削除されたワークスペースの所有ノートがある — `workspace.deleted` を処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | そのワークスペース所有のノートがすべて削除される |
| TC-note-071 | deleteNotesForOwner: メンバーの個人所有ノートがある — `workspace.deleted` を処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 個人所有のノートは削除されない |
| TC-note-072 | deleteNotesForOwner: 削除が完了した — タグ付与・保管ファイル・バックアップ記録・読み取りモデル・件数を確認する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | `note.purged` の購読者（`purgeNote` と同じ受け手）によって後始末される |
| TC-note-073 | deleteNotesForOwner: 対象が `batchSize`（既定 100 件）ちょうど — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 全件が処理され、継続要求は積まれない（境界値） |
| TC-note-074 | deleteNotesForOwner: 対象が 101 件 — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 100 件を処理してcurrent scopeのcontinuation taskを1件だけ積み、残り1件は次のAlarm turnで削除される |
| TC-note-075 | deleteNotesForOwner: 継続が要る — 積まれたイベントを確認する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | `deletionOperationId`を保持した購読者1件の`note.ownerPurgeContinued`だけを積み、受け取った削除eventは再投入しない |
| TC-note-076 | deleteNotesForOwner: 継続要求を受け取る — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | `ownerType` / `ownerId` から対象を組み立て直し、残っているものを先頭から `batchSize` 件読んで続きを削除する（カーソルは持たない — 対象は処理するそばから消えるため先頭から読むだけで前に進む） |
| TC-note-077 | deleteNotesForOwner: 対象が残っているのにそのバッチで 1 件も削除できなかった — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 継続要求を積まず、失敗として返る（キューの再試行と DLQ に委ねる。恒久的に失敗する 1 件が列の先頭に居座って継続が無限に回るのを防ぐ） |
| TC-note-078 | deleteNotesForOwner: 継続要求が重複配送され 2 系列が並走する — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 両系列とも「残っているものを読んで消す」だけなので結果は変わらず、対象が 0 件になった系列から順に継続をやめる |
| TC-note-079 | deleteNotesForOwner: 1 バッチを処理する — 上限根拠を確認する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | `batchSize` 100は1 Alarm turnのCPUとpurge/public-remove event fan-outを有界にする値である |
| TC-note-080 | deleteNotesForOwner: 対象のノートが 1 件もない — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 何もせず成功として返る |
| TC-note-081 | deleteNotesForOwner: 個々の削除が失敗する — 処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 記録して次のノートへ継続する（再配送・継続要求でやり直す） |
| TC-note-082 | deleteNotesForOwner: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/note/deleteNotesForOwner.md#テストケース-deletenotesforowner | 削除済みのノートは `listByOwner` に現れず、2 回目は 0 件で終わる（冪等） |
| TC-note-083 | downloadExportArtifact: `{ kind: "file" }` の有効なチケットと期限内の artifact — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | 有効期間つきの URL・`fileName`・`mimeType` が返る |
| TC-note-084 | downloadExportArtifact: 同じチケットで 2 回ダウンロードする — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | 期限内なら何度でも成功する（冪等） |
| TC-note-085 | downloadExportArtifact: サインイン済みの所有者が取得したチケット — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | 匿名と同じ手順で成功する（サインインの有無を問わない） |
| TC-note-086 | downloadExportArtifact: `{ kind: "job" }` のチケット — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `ValidationError("INVALID_TICKET")` が投げられる |
| TC-note-087 | downloadExportArtifact: 発行から 30 分ちょうど経過したチケット — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `ValidationError("TICKET_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される（`issuedAt + 30 分 <= now` で失効。境界値） |
| TC-note-088 | downloadExportArtifact: 発行から 30 分未満のチケット — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | 有効なものとして扱われる（境界値） |
| TC-note-089 | downloadExportArtifact: 署名を改ざんしたチケット — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | presentation 層の署名検証で拒否され、ユースケースに到達しない（署名と検証は presentation 層の責務） |
| TC-note-090 | downloadExportArtifact: 検証済みの `ExportTicket` — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | ユースケースはアプリケーション層の型（`application/export/`）として受け取る。Note ドメインの値オブジェクトではないため Note → Job の依存は生じない |
| TC-note-091 | downloadExportArtifact: artifact の期限（24 時間）が切れている — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `ValidationError("ARTIFACT_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される |
| TC-note-092 | downloadExportArtifact: artifact が回収済みで不在 — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `ValidationError("ARTIFACT_EXPIRED")` が投げられる |
| TC-note-093 | downloadExportArtifact: チケットの `noteId` と artifact の `noteId` が一致しない — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `ValidationError("ARTIFACT_EXPIRED")` が投げられる |
| TC-note-094 | downloadExportArtifact: ダウンロードの前にノートが非公開に戻された（匿名の閲覧者） — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（チケットはアクセスをバイパスせず、毎回再評価される） |
| TC-note-095 | downloadExportArtifact: ダウンロードの前にノートが削除された — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-096 | downloadExportArtifact: 共有リンクが再発行され、旧トークンで閲覧している — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-097 | downloadExportArtifact: パスワード付き共有リンクで通過証がない — ダウンロードする | spec/testcases/note/downloadExportArtifact.md#テストケース-downloadexportartifact | `ValidationError("SHARE_PASSWORD_REQUIRED")` が投げられる |
| TC-note-098 | emptyTrash: ゴミ箱に 10 件ある — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 10 件が完全削除され、`mode: "purged"`、`purgedCount: 10`、`jobIds: []` が返る |
| TC-note-099 | emptyTrash: ゴミ箱に 10 件、有効なノートが 30 件ある — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 件数は `countByOwner(owner, "trashed")`、一覧は `listByOwner(owner, "trashed", pagination)` で引くため、有効なノートは 1 件も削除されない |
| TC-note-100 | emptyTrash: ゴミ箱が空 — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | `mode: "purged"`、`purgedCount: 0`、`jobIds: []` が返る |
| TC-note-101 | emptyTrash: ゴミ箱に 50 件ある — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | ジョブを登録せず同期削除され、`mode: "purged"`、`purgedCount: 50`、`jobIds: []` が返る（HTTP応答時間とevent fan-outの境界値） |
| TC-note-102 | emptyTrash: ゴミ箱に 51 件ある — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 同期削除は行わず、一括削除ジョブ（`bulkDelete`）が 1 件登録され、`mode: "scheduled"`、`purgedCount: 51`（削除を予約した対象件数）、`jobIds` に親ジョブの ID が 1 件返る（境界値） |
| TC-note-103 | emptyTrash: ゴミ箱に 501 件ある — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 500 件ごとに分割した一括削除ジョブが 2 件登録され、`jobIds` が 2 件返る（分割単位 500 は子ジョブが別々の実行で処理されるため 1 実行あたりの予算に掛からない。同期のしきい値 50 とは別の制約から来る） |
| TC-note-104 | emptyTrash: `mode: "scheduled"` が返った — 返った直後のゴミ箱を確認する | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | まだ 1 件も消えていない（`purgedCount` は予約した対象件数であり、削除し終えた件数ではない） |
| TC-note-105 | emptyTrash: `mode` ごとの応答 — 画面の文言を確認する | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | `"purged"` は「N 件を完全に削除しました」、`"scheduled"` は「N 件の削除を開始しました（処理履歴で進捗を確認できます）」と出し分け、後者は `jobIds` を処理履歴への導線に使う（`mode` を持たずに件数だけを返すと後者が虚偽の完了通知になる） |
| TC-note-106 | emptyTrash: ゴミ箱に 1200 件ある — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 一括削除ジョブが 3 件登録され（500 / 500 / 200）、`mode: "scheduled"`、`purgedCount: 1200`、`jobIds` が 3 件返る |
| TC-note-107 | emptyTrash: ゴミ箱に 1200 件ある — 分割した各ジョブの `scope` を確認する | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | どの分割も入力source ScopeKeyを親子Jobへ使う |
| TC-note-108 | emptyTrash: ワークスペースの viewer — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-109 | emptyTrash: ワークスペースの editor — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 成功する |
| TC-note-110 | emptyTrash: 個人とワークスペースの両方にゴミ箱がある — 個人の文脈で空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | ワークスペースのゴミ箱は残る |
| TC-note-111 | emptyTrash: 一部の削除が失敗する — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 他の削除は継続し、失敗件数が分かる |
| TC-note-112 | emptyTrash: 同期削除の経路 — `purgeNote` の呼び出しを確認する | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | 手順の複製ではなくユースケースの呼び出しで、`expectedVersion` には `listByOwner` で引いた各ノートのその時点の版を渡す。`emptyTrash` 自身は `UnitOfWorkProvider.run` を開かず、`purgeNote` が 1 件ごとに確定する |
| TC-note-113 | emptyTrash: 列挙後・削除前に 1 件が `restoreNote` でゴミ箱から戻された — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | そのノートは版の競合（`ConflictError`）で飛ばされ、`purgedCount` に数えられない。読み直して再適用はしない（戻したばかりのノートを消さないため） |
| TC-note-114 | emptyTrash: 列挙後・削除前に 1 件が別の経路で完全削除された — 空にする | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | `NOTE_NOT_TRASHED` / 不在として飛ばして続け、`purgedCount` に数えない |
| TC-note-115 | emptyTrash: ゴミ箱に 50 件ある — 同期削除の列挙を確認する | spec/testcases/note/emptyTrash.md#テストケース-emptytrash | `listByOwner` の 1 ページ（`limit` の上限は 100）で収まる。同期のしきい値 50 はページングの上限より小さい |
| TC-note-116 | exportNote: 本文のある自分のノート — HTML でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | スタイルと画像を埋め込んだ 1 ファイルが `kind: "immediate"` で即時に返り、`ticket` は `null` になる |
| TC-note-117 | exportNote: `styleMode: "preserve"` のノート — HTML でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 既定スタイルが埋め込まれない |
| TC-note-118 | exportNote: 埋め込めない外部参照がある — HTML でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | その参照は元の URL のまま残り、他は埋め込まれる |
| TC-note-119 | exportNote: 本文のあるノート — Markdown でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | HTML から変換された Markdown が即時に返る |
| TC-note-120 | exportNote: 表現できない要素を含む本文 — Markdown でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | その部分は HTML のまま残る |
| TC-note-121 | exportNote: 期限内の生成物も実行中の `pdfExport` ジョブもない — PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | ジョブが登録され、`kind: "job"`・`jobId` と `{ kind: "job" }` の署名済み `ExportTicket` が返る |
| TC-note-122 | exportNote: 同じ版の PDF 生成物があり、残りの保持期間が十分にある（`expiresAt >= now + 35 分`。`runNoteExport` が作った 24 時間 TTL の artifact） — 同じノートを PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | ジョブを登録せず、`kind: "file"`・`fileId` と `{ kind: "file" }` のチケットが返る（再生成しない） |
| TC-note-123 | exportNote: 一括ダウンロードの子（`runBulkExportItem`）が作った 7 日 TTL の生成物が、同一ノート・同版で残り時間も十分にある — PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 上限の条件はないため、経路によらず再利用され `kind: "file"` が返る（EX-01 の「24 時間保持」は保持期間の**下限**の約束であり、それより長く残る生成物を返しても約束に反しない） |
| TC-note-124 | exportNote: 同じ版の PDF 生成物はあるが、残りの保持期間がチケットの有効期間（30 分）を下回る（TTL 24 時間の artifact で生成から 23 時間 45 分が経過した、など） — PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 再利用されず、新しいジョブが登録されて `kind: "job"` が返る（または実行中のジョブに相乗りする）。有効期間 30 分のチケットを返した直後に artifact のほうが先に失効し、ダウンロードが `ARTIFACT_EXPIRED` で落ちるのを防ぐため |
| TC-note-125 | exportNote: 同じ版の PDF 生成物の `expiresAt` がちょうど `now + 35 分` — PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 下限は「以上」のため再利用され、`kind: "file"` が返る（境界値） |
| TC-note-126 | exportNote: 同じ版の PDF 生成物の `expiresAt` が `now + 35 分` をわずかに下回る — PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 下限を満たさないため再利用されず、`kind: "job"` が返る（境界値） |
| TC-note-127 | exportNote: 生成物はあるが、その後の本文更新で版が変わった — PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 同版でないため再利用されず、新しいジョブが登録されて `kind: "job"` が返る |
| TC-note-128 | exportNote: 他の利用者が作った同版の生成物が期限内にある — 別の閲覧者が PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 要求者をまたぐ再利用は意図した挙動のため再利用される（artifact はノートの版だけから決まる純粋な生成物で、アクセスは要求のたびに再評価される） |
| TC-note-129 | exportNote: 同じノートの `pdfExport` ジョブが実行中 — 別の閲覧者が PDF でダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 新規登録されず、その実行中ジョブへの `{ kind: "job" }` チケットが返る（相乗り） |
| TC-note-130 | exportNote: 匿名の閲覧者が公開ノートを PDF でダウンロードする — 登録されたジョブを確認する | spec/testcases/note/exportNote.md#テストケース-exportnote | `requestedBy: null`・`parentId: null` で登録され、`scope` はノートの所有文脈から導出される（匿名でも `scope` は対象ノートの所有文脈） |
| TC-note-131 | exportNote: サインイン済みの利用者が PDF でダウンロードする — 登録されたジョブを確認する | spec/testcases/note/exportNote.md#テストケース-exportnote | `requestedBy` が要求者になり、ジョブ履歴に現れる |
| TC-note-132 | exportNote: サインイン済みの利用者が、参加ワークスペース所有のノートを PDF でダウンロードする — 登録されたジョブの `scope` を確認する | spec/testcases/note/exportNote.md#テストケース-exportnote | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない。生成物の帰属先が要求者の個人 subject であることとは別物） |
| TC-note-133 | exportNote: チケットが失効した — 同じノートを PDF でダウンロードし直す | spec/testcases/note/exportNote.md#テストケース-exportnote | 相乗りまたは生成物の再利用で新しいチケットが発行され、同じ結果に再到達できる |
| TC-note-134 | exportNote: 変換処理中のノート — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | `ValidationError("NOTE_CONTENT_NOT_READY")` が投げられる |
| TC-note-135 | exportNote: 「要 LLM 連携」のノート — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | `ValidationError("NOTE_CONTENT_NOT_READY")` が投げられる |
| TC-note-136 | exportNote: 公開ノート（未サインインの閲覧者） — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 成功する |
| TC-note-137 | exportNote: 共有リンクの閲覧者（パスワード通過済み） — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | 成功する |
| TC-note-138 | exportNote: 共有リンクの閲覧者（パスワード未通過） — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | `ValidationError("SHARE_PASSWORD_REQUIRED")` が投げられる |
| TC-note-139 | exportNote: 他人の非公開ノート — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-140 | exportNote: タイトルに使えない文字を含む — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | ファイル名の該当文字が置き換えられる |
| TC-note-141 | exportNote: タイトルが記号のみで置換後に空になる — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | ファイル名にノート ID が使われる |
| TC-note-142 | exportNote: 閲覧者が短時間に大量に要求する — ダウンロードする | spec/testcases/note/exportNote.md#テストケース-exportnote | `ValidationError("RATE_LIMITED")` が投げられる（transport 層のレート制限） |
| TC-note-143 | getExportStatus: `{ kind: "job" }` の有効なチケット、ジョブは待機中 — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `status: "queued"` が返る |
| TC-note-144 | getExportStatus: ジョブが実行中 — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `status: "running"` と `progress` が返る |
| TC-note-145 | getExportStatus: ジョブが成功している — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `status: "succeeded"` と、artifact の `fileId` へ差し替えた `{ kind: "file" }` の新しい署名済みチケットが返る |
| TC-note-146 | getExportStatus: `{ kind: "job" }` のチケットでジョブは `succeeded` だが、その artifact が既に回収されている — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `ValidationError("ARTIFACT_EXPIRED")` が投げられる。**新しいチケットを発行する前に `{ kind: "file" }` の分岐と同じ確認（`findById` / 期限 / `noteId` の一致）を行う** — 発行する側だからこそ確認が要る。省くと `succeeded` を表示したうえで到達できない 30 分のチケットを配ることになる |
| TC-note-147 | getExportStatus: 同上 — 回収されうる経路を確認する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | 保管と `Job.succeed` は同一 UoW なので保持期限（24 時間）がチケット（30 分）に負けることはないが、ワークスペース所有の公開ノートに対する匿名の書き出しでは `deleteFilesByOwner` と `deleteNotesForOwner` がどちらも 1 バッチ 100 件ずつ進むため、artifact だけが先に消えてジョブ行が残る窓が開く |
| TC-note-148 | getExportStatus: ジョブが失敗している — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `status: "failed"` と `failureReason` が返る |
| TC-note-149 | getExportStatus: 実行中の `pdfExport` ジョブに相乗りしたあと、実行前にノートが更新された — 完了まで照会し、`downloadExportArtifact` まで進む | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | 受け取る PDF は要求時点の版ではなく**実行時点の版**になる（相乗りは版を条件にしない。キュー待ちのジョブは描画される版が実行時点まで確定しないため、`exportNote` の相乗りに「同版であること」を事前条件として置けない。版を条件にするのは既存 artifact の再利用のみ） |
| TC-note-150 | getExportStatus: `{ kind: "file" }` のチケットで、指す artifact が生きている — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `status: "succeeded"` と同じチケットが返る（`downloadExportArtifact` に進める） |
| TC-note-151 | getExportStatus: `{ kind: "file" }` のチケットだが、発行後に artifact が保持期限を迎えた — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `ValidationError("ARTIFACT_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される（`exportNote` の下限はチケット発行時点の保証にすぎないため、照会のたびに artifact の生死を確かめる。確かめないと「完了しました」の直後にダウンロードが失効で落ちる） |
| TC-note-152 | getExportStatus: `{ kind: "file" }` のチケットだが、artifact が強制終端の後始末や所有者の削除（`deleteFilesByOwner`）で回収されている — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | 同じく `ValidationError("ARTIFACT_EXPIRED")` が投げられる |
| TC-note-153 | getExportStatus: `{ kind: "file" }` のチケットの `fileId` が指す artifact の `noteId` がチケットと一致しない — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | 同じく `ValidationError("ARTIFACT_EXPIRED")` が投げられる（`downloadExportArtifact` の手順 3 と同じ扱い） |
| TC-note-154 | getExportStatus: 同じチケットで 2 回照会する — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | 何度でも照会でき、状態は変わらない（冪等） |
| TC-note-155 | getExportStatus: サインイン済みの所有者が取得したチケット — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | 匿名と同じ手順で成功する（サインインの有無を問わない） |
| TC-note-156 | getExportStatus: 発行から 30 分ちょうど経過したチケット — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `ValidationError("TICKET_EXPIRED")` が投げられ、`exportNote` の再実行へ誘導される（`issuedAt + 30 分 <= now` で失効。境界値） |
| TC-note-157 | getExportStatus: 発行から 30 分未満のチケット — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | 有効なものとして扱われる（境界値） |
| TC-note-158 | getExportStatus: 署名を改ざんしたチケット — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | presentation 層の署名検証で拒否され、ユースケースに到達しない（署名と検証は presentation 層の責務） |
| TC-note-159 | getExportStatus: 検証済みの `ExportTicket` — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | ユースケースはアプリケーション層の型（`application/export/`）として受け取る。Note ドメインの値オブジェクトではないため Note → Job の依存は生じない |
| TC-note-160 | getExportStatus: 照会の前にノートが非公開に戻された（匿名の閲覧者） — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（チケットはアクセスをバイパスせず、毎回再評価される） |
| TC-note-161 | getExportStatus: 照会の前にノートが削除された — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-162 | getExportStatus: 共有リンクが再発行され、旧トークンで閲覧している — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-163 | getExportStatus: パスワード付き共有リンクで通過証がない — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `ValidationError("SHARE_PASSWORD_REQUIRED")` が投げられる |
| TC-note-164 | getExportStatus: チケットの指すジョブが不在（履歴の削除後） — 照会する | spec/testcases/note/getExportStatus.md#テストケース-getexportstatus | `NotFoundError("EXPORT_NOT_FOUND")` が投げられ、`exportNote` の再実行へ誘導される |
| TC-note-165 | getNote: 自分の個人ノート（本文あり） — 引く | spec/testcases/note/getNote.md#テストケース-getnote | 本文・見出し・公開状態が返り、`permissions` がすべて `true` になる（タグは含まれない。`listTagsForNotes` の責務） |
| TC-note-166 | getNote: ワークスペースの viewer — そのワークスペースのノートを引く | spec/testcases/note/getNote.md#テストケース-getnote | 本文が返り、`permissions` がすべて `false` になる |
| TC-note-167 | getNote: ワークスペースの editor — そのワークスペースのノートを引く | spec/testcases/note/getNote.md#テストケース-getnote | `canEdit` と `canDelete` が `true` になる |
| TC-note-168 | getNote: 他人の非公開ノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-169 | getNote: 変換処理中のノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `content.status: "processing"`、`html: null` が返る |
| TC-note-170 | getNote: 「要 LLM 連携」のノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `content.status: "awaitingIntegration"` が返る |
| TC-note-171 | getNote: 変換に失敗したノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `content.status: "failed"` と `failureReason` が返る |
| TC-note-172 | getNote: ゴミ箱のノート（所有者） — 引く | spec/testcases/note/getNote.md#テストケース-getnote | 取得できる |
| TC-note-173 | getNote: ゴミ箱のノート（他人） — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-174 | getNote: ワークスペースの viewer — そのワークスペースのゴミ箱のノートを引く | spec/testcases/note/getNote.md#テストケース-getnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（`viewTrash` は editor 以上のため、メンバーでも到達できない） |
| TC-note-175 | getNote: ワークスペースの editor — そのワークスペースのゴミ箱のノートを引く | spec/testcases/note/getNote.md#テストケース-getnote | 取得できる（`viewTrash` を持つ） |
| TC-note-176 | getNote: 存在しないノート ID — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-177 | getNote: 限定公開のノート（所有者） — 引く | spec/testcases/note/getNote.md#テストケース-getnote | 権限確認後に暗号化済みトークンを復号し、同じ `shareUrl` が含まれる |
| TC-note-178 | getNote: 公開ノート（サインインしていない閲覧者） — 引く | spec/testcases/note/getNote.md#テストケース-getnote | 本文が返り、`shareUrl` は含まれない |
| TC-note-179 | getNote: 参照を取り込んだノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `references.imported` に `purpose: "reference"` の保管ファイルが並ぶ（`StoredFileRepository.listByNote` を絞った結果） |
| TC-note-180 | getNote: 外部スタイルシートを埋め込んだノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `references.inlinedStylesheets` に配布元の URL が並ぶ。供給元は本文の `data-imported-stylesheet` であり、取得記録やジョブではない |
| TC-note-181 | getNote: 外部スタイルシートの取得に失敗したノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `references.unavailableStylesheets` に URL が並び、記録があれば理由が添う |
| TC-note-182 | getNote: 同上で、取得記録が消えている（または一度も試行していない） — 引く | spec/testcases/note/getNote.md#テストケース-getnote | 同じ URL が `reason: null` で並ぶ（構造は本文が語るため、理由が引けなくても表示は壊れない） |
| TC-note-183 | getNote: 取り込みを実行したのが別のメンバーであるワークスペースのノート — 別のメンバーが引く | spec/testcases/note/getNote.md#テストケース-getnote | `references` が同じ内容で返る（ノートに帰属する情報であり、ジョブの可視性規則の影響を受けない） |
| TC-note-184 | getNote: 取り込みを実行したメンバーが退会した — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `references` は変わらず返る（`deleteJobsForRequester` はジョブを消すが、本文と取得記録には触れない） |
| TC-note-185 | getNote: 本文から参照を削除したあと — 引く | spec/testcases/note/getNote.md#テストケース-getnote | その URL の取得記録が残っていても `references` に現れない（突き合わせの向きが本文からのため） |
| TC-note-186 | getNote: 取り込みで CSS 宣言が落ちたノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `references.removedCss` にプロパティごとの件数が返る |
| TC-note-187 | getNote: 本文が `processing` / `failed` のノート — 引く | spec/testcases/note/getNote.md#テストケース-getnote | `references` の全フィールドが空になる |
| TC-note-188 | getNote: 公開ノート — `getPublicNote` で引く | spec/testcases/note/getNote.md#テストケース-getnote | `references` は含まれない（取り込みの状態は本文をこれから直す人のための情報） |
| TC-note-189 | getNote: 共有リンクのノート — `getSharedNote` で引く | spec/testcases/note/getNote.md#テストケース-getnote | 同じく `references` は含まれない |
| TC-note-190 | getPublicNote: 公開ノート（個人所有） — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | 本文・著者のハンドルと表示名・メタ情報が返る |
| TC-note-191 | getPublicNote: 公開ノート（ワークスペース所有） — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | ワークスペースのスラッグと名前も返る |
| TC-note-192 | getPublicNote: 限定公開のノート（公開されたことがない） — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-193 | getPublicNote: 非公開のノート（公開されたことがない） — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-194 | getPublicNote: かつて公開されていて、非公開または限定公開に戻されたノート — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（`NOTE_GONE` にはしない。410 を返すと「そのノートは存在したが今は取得できない」と伝わり、公開を取り下げた事実そのものを漏らす） |
| TC-note-195 | getPublicNote: ゴミ箱在籍中で、`visibility.status` が `public` のまま保たれているノート — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NotFoundError("NOTE_GONE")` が投げられる（インデックス削除を促す。復元すれば同じ URL で再び読めるため、410 を返す範囲はこの状態だけに限る） |
| TC-note-196 | getPublicNote: ゴミ箱在籍中だが、公開が取り下げられているノート — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（判定は公開状態が先。`lifecycle` だけでは 410 にならない） |
| TC-note-197 | getPublicNote: かつて公開されていたノートが完全削除された — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる。行そのものが消えて公開されていた事実を判定できないため、**`NOTE_GONE` を返せないことが仕様である**（検索エンジンからの削除は 404 と、読み取りモデル・`listSitemapEntries` から消えることに依存する） |
| TC-note-198 | getPublicNote: 存在しないノート ID — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-199 | getPublicNote: 4 つの状態（非公開・限定公開に戻された / ゴミ箱在籍中で公開保持 / 完全削除後 / 公開されたことがない） — 応答を並べて比べる | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `NOTE_GONE` になるのはゴミ箱在籍中で公開状態を保持しているものだけで、残る 3 つはすべて `NOTE_NOT_FOUND` に寄る（`getSharedNote` の「存在を漏らさない」原則と揃える） |
| TC-note-200 | getPublicNote: 著者がハンドルを変更した — 旧ハンドルの URL で引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | 「見つかりません」が返る |
| TC-note-201 | getPublicNote: 作成者が退会したワークスペース所有の公開ノート — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | ノート自体は公開のまま読め、著者は `{ displayName: "退会した利用者", handle: null }` として返り、著者ページへのリンクは出さない（R-59。AC-09 で退会時に消えるのは個人所有ノートのみ） |
| TC-note-202 | getPublicNote: 作成者の解決が `USER_NOT_FOUND` になる — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | 例外にせず同じフォールバック（「退会した利用者」・著者リンクなし）を用いる |
| TC-note-203 | getPublicNote: 退会した作成者のノート — 読み取りモデルの著者表示と比べる | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `projectNoteChanges` / `rebuildNoteProjection` の既定値と同じ文言に揃っている |
| TC-note-204 | getPublicNote: — — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | `description` が抜粋から生成されている |
| TC-note-205 | getPublicNote: ワークスペースが非公開の公開ノート — 引く | spec/testcases/note/getPublicNote.md#テストケース-getpublicnote | ノート自体は取得できる |
| TC-note-206 | getSharedNote: パスワードなしの限定公開ノート — 有効な共有トークンで引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | 本文が返る |
| TC-note-207 | getSharedNote: locator が canonical な NoteId を含む有効な共有リンク — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | D1 routeを1点参照し、対象scope DOでID取得とtoken hash照合を行う |
| TC-note-208 | getSharedNote: locatorだけを別NoteIdへ改ざんしたリンク — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | 対象Noteのhashと一致せず `NotFoundError("NOTE_NOT_FOUND")`。他scopeは探索しない |
| TC-note-209 | getSharedNote: パスワード保護された限定公開ノート、通過証なし — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `passwordRequired: true` が返り、タイトルも本文も含まれない |
| TC-note-210 | getSharedNote: パスワード保護され、有効な通過証がある — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | 本文が返る |
| TC-note-211 | getSharedNote: 通過証の `passwordUpdatedAt` がノート側と異なる — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `passwordRequired: true` が返る |
| TC-note-212 | getSharedNote: 発行から 25 時間経過した通過証 — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `passwordRequired: true` が返る |
| TC-note-213 | getSharedNote: 発行から 23 時間経過した通過証 — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | 本文が返る（有効期間の境界値） |
| TC-note-214 | getSharedNote: 存在しない共有トークン — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-215 | getSharedNote: 再発行されて無効になったトークン — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-216 | getSharedNote: 非公開に戻されたノートのトークン — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-217 | getSharedNote: 削除されたノートのトークン — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-218 | getSharedNote: サインイン済みで編集権限を持つ利用者 — 共有トークンで引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | `permissions.canEdit: true` が返る |
| TC-note-219 | getSharedNote: 公開ステータスのノートの休眠トークン — 引く | spec/testcases/note/getSharedNote.md#テストケース-getsharednote | 公開ノートとして本文が返る |
| TC-note-220 | listNoteRevisions: 版が 5 件あるノート — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | 5 件が新しい順で返る |
| TC-note-221 | listNoteRevisions: 版が 25 件あるノート — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | 最新 20 件だけが返る |
| TC-note-222 | listNoteRevisions: 版が 0 件のノート — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | 空配列が返る |
| TC-note-223 | listNoteRevisions: viewer である — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-224 | listNoteRevisions: 版の作成者が削除済み — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | 表示名を解決できない旨を示して返る |
| TC-note-225 | listNoteRevisions: 20件の作成者が複数User shardへ分散する — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | `UserBatchReader`がIDをshard別batchへ分け、最大6接続で表示名を解決する |
| TC-note-226 | listNoteRevisions: 再生成による版がある — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | `reason: "regeneration"` が含まれる |
| TC-note-227 | listNoteRevisions: — — 一覧する | spec/testcases/note/listNoteRevisions.md#テストケース-listnoterevisions | 各版に抜粋が含まれ、本文全体は含まれない |
| TC-note-228 | listSitemapEntries: 公開ノートが 3 件ある — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | 3 件の ID と更新日時が返る |
| TC-note-229 | listSitemapEntries: 非公開・限定公開のノートがある — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | それらは含まれない |
| TC-note-230 | listSitemapEntries: ゴミ箱の公開ノートがある — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | それは含まれない |
| TC-note-231 | listSitemapEntries: 件数が `limit` を超える — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | `limit` 件と `nextCursor` が返る |
| TC-note-232 | listSitemapEntries: `nextCursor` を渡す — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | 続きが重複なく返る |
| TC-note-233 | listSitemapEntries: 対象が 0 件 — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | 空配列と `nextCursor: null` が返る |
| TC-note-234 | listSitemapEntries: 多数のscopeに公開Noteがある — query先を確認する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | global D1のpublic projectionだけを読む。Durable Objectの列挙は行わない |
| TC-note-235 | listSitemapEntries: public Noteが32 shardへ分散する — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | 同時6接続のwaveで全体limit件へmergeし、cursorにgenerationと各shard位置を保持する |
| TC-note-236 | listSitemapEntries: 1page目の後にreshard cutoverする — 旧cursorで続ける | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | cursorの固定generationを読み、旧新にあるNoteIdを重複排除して欠落・重複なく返す |
| TC-note-237 | listSitemapEntries: 空shardが混ざる — 列挙する | spec/testcases/note/listSitemapEntries.md#テストケース-listsitemapentries | 空shardの位置も進め、他shardの結果を全体limitまで返す |
| TC-note-238 | moveNote: 個人ノート、移動先ワークスペースの editor — ワークスペースへ移動する | spec/testcases/note/moveNote.md#テストケース-movenote | 所有者が変わり、`note.moved` が旧所有者つきで発行される |
| TC-note-239 | moveNote: ワークスペースのノート、そこの editor — 個人へ移動する | spec/testcases/note/moveNote.md#テストケース-movenote | 所有者が変わる |
| TC-note-240 | moveNote: 移動先ワークスペースの viewer — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-241 | moveNote: 移動元で編集権限がない — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（権限不足は存在秘匿に統一する） |
| TC-note-242 | moveNote: 移動先ワークスペースが存在しない（削除済みを含む） — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `WorkspaceRepository.findById` の実在確認で `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる（移動先は要求者が選んだ先であり隠す対象ではないため、移動元の権限不足の `NOTE_NOT_FOUND` とは分ける） |
| TC-note-243 | moveNote: 変換処理中のノート — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `BusinessRuleError(CannotMoveWhileProcessing)` が投げられる |
| TC-note-244 | moveNote: 同じ所有者を指定する — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | 変更もイベントも起きず成功する |
| TC-note-245 | moveNote: 限定公開のノート — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | 共有リンクの URL は変わらず、引き続き到達できる |
| TC-note-246 | moveNote: 移動元にのみ存在するタグが付いている — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `droppedTagNames` にそのタグ名が含まれ、付与が外れる |
| TC-note-247 | moveNote: 移動先に同名のタグがある — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | そのタグに付け替えられる |
| TC-note-248 | moveNote: 元ファイルとメディアを持つノート — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | 保管ファイルの所有者も移動先に移り、使用量が付け替わる |
| TC-note-249 | moveNote: 移動が成功した — snapshotを確認する | spec/testcases/note/moveNote.md#テストケース-movenote | Note・Revision・Tag assignment・StoredFile metadata・Backup・Usage deltaを1つのmigration snapshotとしてtarget scopeへ取り込み、target local projectionも同じscopeで作る |
| TC-note-250 | moveNote: 移動先の使用量が既に容量クォータを超えている — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | 移動は成功する（移動時に容量クォータを検査しないのは意図的な設計。クォータの強制は取り込み時のみ） |
| TC-note-251 | moveNote: 移動によって移動先がクォータを超える — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | 移動は成功し、以後の新規アップロードが拒否されるだけになる（`applyStorageDelta` は消費量を付け替えるが判定はしない） |
| TC-note-252 | moveNote: 移動の確定時点で移動元のワークスペースから除名されていた — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（`ensureMovable` の `AccessDenied` には到達しない） |
| TC-note-253 | moveNote: 移動の確定時点で移動先のワークスペースから除名されていた — 移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-254 | moveNote: 事前確認後・source freeze前に移動元Membership versionが変わる — freezeする | spec/testcases/note/moveNote.md#テストケース-movenote | actorと期待Membership versionをlocal transactionで再検査し、移動を中止する |
| TC-note-255 | moveNote: target stage後にactorの除名・降格を試みる — 変更する | spec/testcases/note/moveNote.md#テストケース-movenote | target authorization lockと競合して拒否され、activateまたはabort後に解放される |
| TC-note-256 | moveNote: ワークスペースのノートを個人へ移動した — ワークスペースの他メンバーが開く | spec/testcases/note/moveNote.md#テストケース-movenote | 「見つかりません」が返る |
| TC-note-257 | moveNote: 他者が先に更新した — 古い `expectedVersion` で移動する | spec/testcases/note/moveNote.md#テストケース-movenote | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-258 | moveNote: sourceをfreezeした直後に失敗する — 同じmigration IDで再開する | spec/testcases/note/moveNote.md#テストケース-movenote | source snapshotを再利用し、重複したtarget Noteを作らない |
| TC-note-259 | moveNote: target staging後に失敗する — recoveryを実行する | spec/testcases/note/moveNote.md#テストケース-movenote | routeはsourceのままで利用者には旧scopeだけが見え、staged targetは直接読めない |
| TC-note-260 | moveNote: targetCredit後・route switch前に再認可失敗 — abortする | spec/testcases/note/moveNote.md#テストケース-movenote | creditを逆仕訳し、stage/lockを削除、sourceをthawしてrouteをactive sourceへ戻す |
| TC-note-261 | moveNote: abortMoveの応答を失う — recoveryする | spec/testcases/note/moveNote.md#テストケース-movenote | 同じmigration IDで各rollbackを再適用し、二重debit/creditなしでactive sourceへ戻る |
| TC-note-262 | moveNote: target stage後にworkspace削除を試みる — 削除する | spec/testcases/note/moveNote.md#テストケース-movenote | `WORKSPACE_MOVE_IN_PROGRESS`で拒否され、activate/abort後に再試行できる |
| TC-note-263 | moveNote: route switch後に失敗する — recoveryする | spec/testcases/note/moveNote.md#テストケース-movenote | abortせずtarget activate・source retire・sourceDebitへ前進する |
| TC-note-264 | moveNote: target credit後・route switch前に長時間停止する — sourceでuploadする | spec/testcases/note/moveNote.md#テストケース-movenote | source quotaはまだ減算されておらず空きを過大に見積もらない。中間状態は二重計上側になる |
| TC-note-265 | moveNote: route switch後・source debit前に停止する — recoveryを実行する | spec/testcases/note/moveNote.md#テストケース-movenote | targetがactiveでsourceは過剰計上のまま。source debitを冪等に再試行する |
| TC-note-266 | moveNote: route switchの応答を失う — 再開する | spec/testcases/note/moveNote.md#テストケース-movenote | D1のmigration IDとrouteVersionを読み、切替済みならactivateへ進む。二重switchしない |
| TC-note-267 | moveNote: route切替後・source tombstone前 — noteを読む | spec/testcases/note/moveNote.md#テストケース-movenote | current routeからtargetへ到達する。sourceへの遅延writeはfreeze/version不一致で拒否される |
| TC-note-268 | moveNote: move前のpublic projection eventが遅延 — 処理する | spec/testcases/note/moveNote.md#テストケース-movenote | routeVersionが古いためtarget ownerのpublic行を上書きしない |
| TC-note-269 | moveNote: source cleanupが失敗する — recoveryを実行する | spec/testcases/note/moveNote.md#テストケース-movenote | routeはtargetを維持し、source tombstoneだけを再試行する。利用者向け所属をsourceへ戻さない |
| TC-note-270 | projectNoteChanges: 個人所有のノートが作られた — `note.created` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 読み取りモデルに行が作られ、`created_by` の利用者から著者列（表示名・ハンドル）が最初から埋まる（ワークスペース列は `null`） |
| TC-note-271 | projectNoteChanges: ワークスペース所有のノートが作られた — `note.created` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 著者列に加えてワークスペース列（名前・スラッグ・公開状態）も最初から埋まる |
| TC-note-272 | projectNoteChanges: ノートがワークスペースへ移動された — `note.moved` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `NoteRepository.findById` で現在の状態を読み、`author`（`created_by` の利用者）と `workspace`（移動先の名前・スラッグ・公開状態）を解決し直して `upsert` する。所有者列とワークスペース列が更新され、著者列は `created_by` の利用者のまま保たれる |
| TC-note-273 | projectNoteChanges: ノートがワークスペースから個人へ移動された — `note.moved` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `workspace` が `null` として解決され、ワークスペース列が空になる（所有者列は個人になる） |
| TC-note-274 | projectNoteChanges: `note.moved` の投影 — payload との関係を確認する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | payload の `previousOwner` / `currentOwner` をそのまま書かず、`findById` で読み直した現在の状態から著者・ワークスペースを解決して上書きする（配送順が入れ替わっても結果が変わらない） |
| TC-note-275 | projectNoteChanges: 本文が更新された — `note.contentUpdated` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 読み取りモデルのテキストと抜粋が更新される |
| TC-note-276 | projectNoteChanges: 変換が「要 LLM 連携」で止まった — `note.awaitingIntegration` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `NoteRepository.findById` で現在の状態を読んで `upsert` し、`content_status` が `awaitingIntegration` に更新される（購読しないと `processing` のまま残り、`countByContentStatus` を根拠とする `completeIntegrationOAuth` の「要 LLM 連携の N 件」が常に 0 件になる） |
| TC-note-277 | projectNoteChanges: 表示スタイルが切り替えられた — `note.styleModeChanged` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 同じく `upsert` で `style_mode` が更新される（購読しないと ED-11 の切り替えが一覧に反映されない） |
| TC-note-278 | projectNoteChanges: 変換に失敗した — `note.conversionFailed` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `content_status` が `failed` に更新される |
| TC-note-279 | projectNoteChanges: `content_status` / `style_mode` を変える振る舞い — 発行イベントを網羅する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `applyConversionResult` / `updateBody`（`note.contentUpdated`）、`markConversionFailed`（`note.conversionFailed`）、`markAwaitingIntegration`（`note.awaitingIntegration`）、`changeStyleMode`（`note.styleModeChanged`）のいずれかが発行され、1 つでも欠けると読み取りモデルが恒久的に古くなる |
| TC-note-280 | projectNoteChanges: ノートが公開された — `note.published` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 購読しない（`note.visibilityChanged` と必ず併発し、用途はサイトマップだけのため） |
| TC-note-281 | projectNoteChanges: 共有リンクが再発行された — `note.shareLinkReissued` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 購読しない（投影列を 1 つも変えない） |
| TC-note-282 | projectNoteChanges: 共有リンクのパスワードが変更された — `note.sharePasswordChanged` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 同じく購読しない |
| TC-note-283 | projectNoteChanges: 同じ公開操作で併発した `note.visibilityChanged` — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | こちらは購読し、`visibility` 列が更新される（サイトマップだけを用途とする `note.published` との役割の分かれ目） |
| TC-note-284 | projectNoteChanges: 本文・タイトル・タグが更新された — 更新系のイベントを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `note_search` 本体・`note_search_tags`・FTS 索引が 1 バッチでアトミックに更新される |
| TC-note-285 | projectNoteChanges: FTS 索引の書き換え — 取り消しに渡す旧値を確認する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | bigram 前処理済みのテキストは列に保存されていないため、`note_search` の生テキスト列（`title` / `text` / `tag_names`）に前処理関数を再適用して求める。前処理は純関数なので書き込み時の値と必ず一致する |
| TC-note-286 | projectNoteChanges: 異なる2つのscopeで投影が発生する — 並行して処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 各scope DOのAlarmが独立にlocal projectionを更新し、互いを直列化しない |
| TC-note-287 | projectNoteChanges: 同じscopeで2つのlocal投影が発生する — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | そのDOが順序付け、`processed_events` とcurrent stateの上書きで収束する |
| TC-note-288 | projectNoteChanges: public投影が並行配送される — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `route_version` / `projection_revision` / `author_version` / `workspace_version` の世代ベクトルにより古い配送が新しい列を上書きしない |
| TC-note-289 | projectNoteChanges: workspaceからpersonalへNoteを移し、旧workspaceVersionが0より大きい — target投影する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 大きいrouteVersionを先に比較してowner contextをリセットし、workspaceVersion 0のsnapshotを受理する |
| TC-note-290 | projectNoteChanges: version 100のworkspace Aからversion 3のworkspace Bへ移す — target投影する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | routeVersionが大きいためworkspace Bの完全snapshotを受理し、永久にincomparableにならない |
| TC-note-291 | projectNoteChanges: move前scopeのeventがroute切替後に届く — public投影する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | current routeと一致しないためno-opになり、旧ownerの公開行を復活させない |
| TC-note-292 | projectNoteChanges: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 現在の状態を読んで上書きするため結果が変わらない（冪等） |
| TC-note-293 | projectNoteChanges: イベントが順不同で届く（`updated` が `created` より先） — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 現在の状態から上書きされるため矛盾しない |
| TC-note-294 | projectNoteChanges: ノートが完全削除された — `note.purged` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 読み取りモデルの行が削除される |
| TC-note-295 | projectNoteChanges: 対象ノートが既に削除済み — 更新系のイベントを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 何もせず成功として返る |
| TC-note-296 | projectNoteChanges: タグが付与された — `tag.assigned` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 対象ノートのタグを引き直し、完全snapshot置換で本体・タグ・FTSを同じ世代へ更新する |
| TC-note-297 | projectNoteChanges: タグの付与が外れた — `tag.unassigned` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 同じ完全snapshot置換でそのタグが投影から外れる |
| TC-note-298 | projectNoteChanges: 完全snapshotを置換した — 読み取りモデルを確認する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `note_search.tag_names` / `note_search_tags` / `tag_display_names` と FTS `tag_names_fts` が同一transaction/batchで更新される |
| TC-note-299 | projectNoteChanges: タグが削除された — `tag.deleted` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 何もしない（購読しない。各operation pageのlocal/public再投影要求が更新を担う） |
| TC-note-300 | projectNoteChanges: タグ名が変更された — `tag.renamed` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 対象ノートを1ページ（200件）だけ列挙し、1件につきlocal taskとpublic outbox requestを同じUoWへ積む。ここでは投影を直接書かない |
| TC-note-301 | projectNoteChanges: タグが500ノートに付いている — `tag.renamed` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 200件ぶんのlocal/public再投影要求とカーソル付きlocal taskを積み、scope Alarmで500件すべてへ進む |
| TC-note-302 | projectNoteChanges: tag pageのoutbox relay応答を失う — 再実行する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | plane・生成元ID・NoteId・revision由来のtask IDでlocal/publicとも増殖せず、public Queueへ確実に届く |
| TC-note-303 | projectNoteChanges: tag pageのpublic request保存後にNoteが別scopeへmoveする — 遅延requestを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | requestはrouteVersionを持たず、global consumerがcurrent routeの移動先snapshotを再投影して旧scope状態を復活させない |
| TC-note-304 | projectNoteChanges: `projection.tagFanOutContinued` を受け取る — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `listByTag(tagId, { afterNoteId, limit: 200 })` でカーソルの続きから列挙する。tag assignment継続では処理後も母集合が残るためkeyset cursorを使う |
| TC-note-305 | projectNoteChanges: 同上 — カーソルの解釈を確認する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `afterNoteId` はキーセット（`WHERE tag_id = ? AND note_id > ? ORDER BY note_id LIMIT 200`）であって `OFFSET` ではない。`listByTag` は `noteId` 昇順を契約として保証する |
| TC-note-306 | projectNoteChanges: ファンアウトの進行中に、カーソルより前の付与が `unassignTag` / `note.purged` / `mergeTags` の衝突行削除で消える — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | キーセットなので後続のノートを飛ばさない（`OFFSET` だと消えた件数ぶん後ろのノートが静かに落ちる） |
| TC-note-307 | projectNoteChanges: タグがちょうど 200 ノートに付いている — `tag.renamed` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 200件ぶんとlocal continuationを積み、**次のAlarm turnの列挙は0件になる** |
| TC-note-308 | projectNoteChanges: 続きの列挙が 0 件で返った — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | **継続を積まずに成功として返る。メッセージを失敗させない。** 付与の件数がちょうど 200 の倍数のとき最後のページが空になるのが正常な終わり方であり、「進捗がなければ継続しない」を字義どおり適用すると正常完了のたびに DLQ へメッセージが積まれる |
| TC-note-309 | projectNoteChanges: ファンアウトの進行中にタグそのものが削除された — 続きを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 付与が FK CASCADE で消えるため次のページが 0 件になり、継続が正常に終わる（無限に回らない） |
| TC-note-310 | projectNoteChanges: ファンアウトの進行中に同じタグがもう一度リネームされた — 2 系列を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | どちらの系列が積んだ `projection.reprojectRequested` も `findById` で現在値を読み直すため、最後に書かれる値は 2 回目のリネーム後の名前になる（系列の交錯によらず収束する） |
| TC-note-311 | projectNoteChanges: ファンアウトの進行中にノートがそのタグを新たに付与された — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | そのノートは `tag.assigned` の個別完全snapshotが別途拾うため、ファンアウトが取りこぼしても投影は正しくなる |
| TC-note-312 | projectNoteChanges: `projection.reprojectRequested` を受け取る — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | current routeと全source versionを読み、local/publicとも `replaceSnapshotIfNewer` 1回で本体・tags・FTS・表示contextを同じ世代にする |
| TC-note-313 | projectNoteChanges: 同じprojectionRevisionを通知する重複eventが逆順で届く — public投影を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | atomicな完全snapshot置換またはno-opとなり、本体/tagの部分状態を作らない |
| TC-note-314 | projectNoteChanges: consumer Aがtag変更前snapshot/revisionを読み、consumer Bがtag変更後revisionを書いた後にAが書く — 競合する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | Aは小さいprojectionRevisionでno-opとなり、新しいtag集合を巻き戻さない |
| TC-note-315 | projectNoteChanges: current routeが `purging` / `tombstone` — 更新eventを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | public行をremoveし、古いeventから復活させない |
| TC-note-316 | projectNoteChanges: タグが統合・削除された — 完了eventを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 完了eventは監査のみ。各200件operation pageがrevision bumpと個別再投影taskを保存済みである |
| TC-note-317 | projectNoteChanges: タグ付きのノート — ノート本体だけが変わるイベントを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | atomic snapshotから現在のタグ集合も読み、完全snapshot置換後もタグ投影が維持される |
| TC-note-318 | projectNoteChanges: 利用者がハンドルを変更した — `identity.user.handleChanged` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `note_routes(created_by)` を200件ずつ読み、各Noteのpublic再投影とscope-local refreshを最大6 RPCで送る |
| TC-note-319 | projectNoteChanges: 利用者が表示名を変更し、作成済みworkspaceから既に離脱している — `identity.user.profileUpdated` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | membership edgeではなく不変のroute `created_by` から旧workspaceを発見し、残るlocal表示も更新する |
| TC-note-320 | projectNoteChanges: 1利用者が数千scopeでNoteを作成している — author refreshする | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | routeを200件ずつキーセット継続し、1 invocationのRPCは同時6本までに制限する |
| TC-note-321 | projectNoteChanges: author routeが2page以上ある — `projection.authorRouteFanOutContinued`を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 署名opaque cursorを同じreaderへ渡し、全shardの続きへ漏れなく進む |
| TC-note-322 | projectNoteChanges: `identity.user.handleChanged` が配送順の入れ替わりで古くなっている — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | payload の値ではなく解決した現在値を書くため、古い値が復活しない |
| TC-note-323 | projectNoteChanges: ワークスペースのイベント（`workspace.slugChanged` / `published` / `unpublished` / `profileUpdated`） — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | scope routeを200件ずつ読み、version付きcurrent Workspaceを含む個別snapshotを再投影する |
| TC-note-324 | projectNoteChanges: workspace routeが2page以上ある — `projection.workspaceRouteFanOutContinued`を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 署名opaque cursorを同じreaderへ渡し、全shardの続きへ漏れなく進む |
| TC-note-325 | projectNoteChanges: ワークスペースが作られた — `workspace.created` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 購読しない（作成直後は対象routeが0件） |
| TC-note-326 | projectNoteChanges: Note snapshot読込後にIdentity更新snapshotが先に保存される — 古いNote snapshotを書こうとする | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | authorVersionが小さくベクトルがincomparableとなりno-op。全sourceを再読込して新Note＋新authorを保存する |
| TC-note-327 | projectNoteChanges: `identity.user.deleted` の投影後に削除前のNote eventが遅延到着する — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | tombstoneのauthorVersionより古いため旧表示名・handleを復活させない |
| TC-note-328 | projectNoteChanges: account deletionから`projection.authorRedactionRequested`を受け取る — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | current route上のlocal/public完全snapshotを退会者表示と`redactionVersion`で先に置換し、その成功応答後にuser shardへplane別ackする |
| TC-note-329 | projectNoteChanges: redaction投影後にuser shard ack応答を失う — 同じ要求を再処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 保存済みredactionVersionを確認してwriteはno-op、投影確定後にackだけを再送する |
| TC-note-330 | projectNoteChanges: author redaction対象Noteがmoveまたはpurge済み — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | current routeへ再解決し、tombstoneなら投影を復活させずackする |
| TC-note-331 | projectNoteChanges: 利用者が作られた — `identity.user.created` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 同じ理由で購読しない。購読する Identity のイベントは `identity.user.handleChanged` / `identity.user.profileUpdated` / `identity.user.deleted` の 3 つに限られる |
| TC-note-332 | projectNoteChanges: 利用者が退会した — account deletion commandを処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | membership edgeを消す前に各workspace scopeのlocal著者表示を置換し、global consumerはpublic著者表示を置換する。personal行はscope cleanupで消える |
| TC-note-333 | projectNoteChanges: 退会者が作成したワークスペース所有ノートがある — `identity.user.deleted` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 行は残り、著者表示が「退会した利用者」・ハンドルが `null` になる（AC-09） |
| TC-note-334 | projectNoteChanges: 同じ `identity.user.deleted` を 2 回受け取る — 2 回処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | 同じ値の上書きのため結果が変わらない（冪等）。`deleteNotesForOwner` との到着順にも依存せず、対象行が既に消えていれば 0 行更新で成功する |
| TC-note-335 | projectNoteChanges: `created_by` の利用者が既に退会していて解決できない — 更新系のイベント（`note.contentUpdated` / `note.moved`）を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `upsert` の `author` に既定値 `{ displayName: "退会した利用者", handle: null }` が埋まる（`author_display_name` は NOT NULL であり、旧表示名は復活しない） |
| TC-note-336 | projectNoteChanges: ワークスペースが名前を変更した — `workspace.profileUpdated` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | そのワークスペースのノートの `workspace_name` が更新される |
| TC-note-337 | projectNoteChanges: ワークスペースがスラッグを変更した — `workspace.slugChanged` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | そのワークスペースのノートの `workspace_slug` が更新される |
| TC-note-338 | projectNoteChanges: ワークスペースが公開された — `workspace.published` を処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | そのワークスペースのノートの `workspace_published` が更新される |
| TC-note-339 | projectNoteChanges: 書き込みが失敗する — 処理する | spec/testcases/note/projectNoteChanges.md#テストケース-projectnotechanges | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる |
| TC-note-340 | purgeExpiredTrash: 削除から 31 日経過したノートがある — 実行する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | そのノートが完全削除される |
| TC-note-341 | purgeExpiredTrash: 削除から 29 日経過したノートがある — 実行する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | そのノートは残る |
| TC-note-342 | purgeExpiredTrash: `purgeAfter` のちょうど 1 ミリ秒前 — 実行する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | 残る（境界値） |
| TC-note-343 | purgeExpiredTrash: 対象が `limit`（既定 100）を超える — Alarmで実行する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | `limit` 件だけ処理され、同じscopeのtaskが直後へ再設定される。global Cronは使わない |
| TC-note-344 | purgeExpiredTrash: `limit` の既定値 — 根拠を確認する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | 1回のscope Alarm turnのCPU時間とlocal event fan-outを有界にする値である |
| TC-note-345 | purgeExpiredTrash: 1 件の削除が失敗する — 実行する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | 記録して継続し、他の削除は成功する |
| TC-note-346 | purgeExpiredTrash: 対象が 0 件 — 実行する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | `purgedCount: 0` が返る |
| TC-note-347 | purgeExpiredTrash: 実行後 — 使用量を確認する | spec/testcases/note/purgeExpiredTrash.md#テストケース-purgeexpiredtrash | 削除した分だけ減っている |
| TC-note-348 | purgeNote: ゴミ箱にあるノート — 完全削除する | spec/testcases/note/purgeNote.md#テストケース-purgenote | ノートが削除され、`note.purged` が発行される |
| TC-note-349 | purgeNote: purgeを開始する — routeを確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | D1 routeがoperation ID付き `purging` になり、外部read/mutationを先に閉じる |
| TC-note-350 | purgeNote: 認可確認後・beginPurge前にrestoreが勝つ — local deleteする | spec/testcases/note/purgeNote.md#テストケース-purgenote | expected version/lifecycle競合となり、同じoperation IDでrouteをactiveへabortして復旧する |
| TC-note-351 | purgeNote: local delete前にactorのMembershipが変わる — 再確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | 削除せずrouteをactiveへabortする |
| TC-note-352 | purgeNote: abort応答を失う — recoveryする | spec/testcases/note/purgeNote.md#テストケース-purgenote | Noteが残ることを確認して同じoperation IDのabortを再試行する |
| TC-note-353 | purgeNote: local delete後・public remove前に停止する — recoveryする | spec/testcases/note/purgeNote.md#テストケース-purgenote | 同じoperation IDでpublic removeを再開し、古いeventはpublic行を復活させない |
| TC-note-354 | purgeNote: public removeがackした — 完了する | spec/testcases/note/purgeNote.md#テストケース-purgenote | routeが30日保持の`tombstone`になり、再配送しても同じ結果になる |
| TC-note-355 | purgeNote: remove ackの応答を失う — Cron recoveryする | spec/testcases/note/purgeNote.md#テストケース-purgenote | public削除とoperation ackを冪等に再実行し、ack後だけtombstoneへ進む |
| TC-note-356 | purgeNote: 完全削除後 — 版（`note_revisions`）を確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | DB の FK CASCADE で同時に削除される |
| TC-note-357 | purgeNote: 完全削除後 — タグ付与を確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | Tag の `deleteAssignmentsForNote` が `note.purged` を受けて削除する |
| TC-note-358 | purgeNote: 完全削除後 — 保管ファイル（`source` / `media` / `reference`）を確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | Storage の `deleteFilesForNote` が回収する |
| TC-note-359 | purgeNote: 完全削除後 — バックアップ記録を確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | Integration の `deleteBackupRecordsForNote` が削除する |
| TC-note-360 | purgeNote: scope cleanupで同じNote purgeを再配送する — 実行する | spec/testcases/note/purgeNote.md#テストケース-purgenote | `sha256("ownerPurge:" + deletionOperationId + ":" + noteId)`の同じ内部operation IDから再開する |
| TC-note-361 | purgeNote: 通常purgeが`purging`切替後に応答を失う — 再送する | spec/testcases/note/purgeNote.md#テストケース-purgenote | routeに保存済みoperation ID/phaseを再利用し、新しいpurge operationを作らない |
| TC-note-362 | purgeNote: personal cleanup対象がactive Noteでactorは`DeletingUser` — 内部purgeする | spec/testcases/note/purgeNote.md#テストケース-purgenote | cleanup ownerとscope/owner一致を確認し、trashed/active User制約を要求せず削除する |
| TC-note-363 | purgeNote: workspace cleanupでWorkspace/Membership行が既に削除済み — 内部purgeする | spec/testcases/note/purgeNote.md#テストケース-purgenote | manifest ownerとNote owner一致から続行し、削除済みMembershipを要求しない |
| TC-note-364 | purgeNote: 通常利用者がactive Noteをpurgeする — 実行する | spec/testcases/note/purgeNote.md#テストケース-purgenote | `NOTE_NOT_TRASHED`で拒否する |
| TC-note-365 | purgeNote: 完全削除後 — 読み取りモデルを確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | Note の `projectNoteChanges` が該当の行を削除する |
| TC-note-366 | purgeNote: 完全削除後 — 使用量を確認する | spec/testcases/note/purgeNote.md#テストケース-purgenote | Usage の `applyStorageDelta` で保存容量とノート件数が減る |
| TC-note-367 | purgeNote: Drive にバックアップがある — 完全削除する | spec/testcases/note/purgeNote.md#テストケース-purgenote | Drive 上のファイルは残る（記録だけが消える） |
| TC-note-368 | purgeNote: ゴミ箱にないノート — 完全削除する | spec/testcases/note/purgeNote.md#テストケース-purgenote | `ValidationError("NOTE_NOT_TRASHED")` が投げられる |
| TC-note-369 | purgeNote: viewer である — 完全削除する | spec/testcases/note/purgeNote.md#テストケース-purgenote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-370 | purgeNote: 同じノートで 2 つの要求が同時に走る — 両方が完全削除する | spec/testcases/note/purgeNote.md#テストケース-purgenote | 片方は成功、もう片方は `NotFoundError` になり、二重に減算されない |
| TC-note-371 | purgeNote: global recoveryに複数kindのdue operationが10,000件滞留 — Cronを実行する | spec/testcases/note/purgeNote.md#テストケース-purgenote | kind別最低枠を保ち、claim lease付きで最大100 operations/400 queriesだけ処理して残りをQueue continuationへ渡す |
| TC-note-372 | purgeNote: 前回Cronのclaim lease中に次のCronが起動 — 同じoperationをclaimする | spec/testcases/note/purgeNote.md#テストケース-purgenote | lease中はno-opとなり、二重orchestratorを走らせない |
| TC-note-373 | rebuildNoteProjection: user scopeにNoteが50件ある — `plane: local`, `scope: user` で実行する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | 対象DOの `listByOwner(scope, "all")` だけを読み、50件のlocal再投影taskを積む |
| TC-note-374 | rebuildNoteProjection: workspace scopeを指定する — local再構築する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | 他のuser / workspace DOにはアクセスしない |
| TC-note-375 | rebuildNoteProjection: `plane: local` でscopeがない — 実行する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | `ValidationError("SCOPE_REQUIRED")` |
| TC-note-376 | rebuildNoteProjection: local Noteが100件を超える — 実行する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | scope-local `scheduled_tasks` とAlarmでキーセット継続し、1 turnの仕事量を制限する |
| TC-note-377 | rebuildNoteProjection: global public projectionが空 — `plane: public`, `scope: null` で実行する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | D1 `note_routes` のactive routeをキーセットで列挙し、routeVersion付き要求をQueueへ積む。全DO列挙APIは使わない |
| TC-note-378 | rebuildNoteProjection: route列挙後にNoteが別scopeへ移動する — public要求を処理する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | consumerがcurrent routeを再解決し、旧 `expectedRouteVersion` をno-opにする |
| TC-note-379 | rebuildNoteProjection: routeがtombstone — public再構築する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | public行を削除し、scope DOからsnapshotを読まない |
| TC-note-380 | rebuildNoteProjection: local projectionに孤児行がある — `sweepOrphans: true` | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | current scopeの正データとだけ突合して削除する |
| TC-note-381 | rebuildNoteProjection: public projectionに古いrouteVersionの行がある — `sweepOrphans: true` | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | D1 `note_routes` との突合で削除する |
| TC-note-382 | rebuildNoteProjection: `sweepOrphans: false` — 再構築する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | 孤児行を残し `sweptCount: 0` |
| TC-note-383 | rebuildNoteProjection: タグ付きNoteがある — taskを処理する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | local/publicとも本体・タグ・FTS・表示contextを世代ベクトル付き完全snapshotで1回置換する |
| TC-note-384 | rebuildNoteProjection: 空のpublic投影へタグ付きNoteを再構築する — taskを処理する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | 本体と全タグが同じD1 batchで作られ、同version判定で片方がno-opにならない |
| TC-note-385 | rebuildNoteProjection: 同じNoteの新旧snapshotを2 consumerが逆順で処理する — 処理する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | route/source versionが新しいsnapshotだけが残り、本体とタグの組が混ざらない |
| TC-note-386 | rebuildNoteProjection: FTS表を作り直す — 再構築する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | 先に対象planeのFTS表を再作成する。contentless FTSの特殊`rebuild`コマンドは使わない |
| TC-note-387 | rebuildNoteProjection: 同じ要求を2回処理する — 実行する | spec/testcases/note/rebuildNoteProjection.md#テストケース-rebuildnoteprojection | current stateとversion条件付き書き込みにより結果は変わらない |
| TC-note-388 | reissueShareLink: 限定公開のノート — 再発行する | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | 新しい `shareUrl` が返る |
| TC-note-389 | reissueShareLink: 再発行後 — 古いリンクを開く | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | `NotFoundError("NOTE_NOT_FOUND")` が返る |
| TC-note-390 | reissueShareLink: パスワード設定済み — 再発行する | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | パスワードの設定は維持される |
| TC-note-391 | reissueShareLink: 非公開のノート — 再発行する | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | `BusinessRuleError(NotUnlisted)` が投げられる |
| TC-note-392 | reissueShareLink: 公開ノート — 再発行する | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | `BusinessRuleError(NotUnlisted)` が投げられる |
| TC-note-393 | reissueShareLink: viewer である — 再発行する | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-394 | reissueShareLink: 再発行を 2 回続ける — 2 回目の後に 1 回目のリンクを開く | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | 「見つかりません」が返る |
| TC-note-395 | reissueShareLink: ノートを別scopeへ移動済み — 移動前の共有リンクを開く | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | locator の NoteId から更新済み route を引き、移動先scopeの同じノートが表示される |
| TC-note-396 | reissueShareLink: 有効なトークンの locator 部分だけを別の NoteId に改ざんした — 開く | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | route先の token hash と一致せず `NotFoundError("NOTE_NOT_FOUND")` が返る |
| TC-note-397 | reissueShareLink: 有効なトークンの secret 部分を改ざんした — 開く | spec/testcases/note/reissueShareLink.md#テストケース-reissuesharelink | `NotFoundError("NOTE_NOT_FOUND")` が返り、他scopeを走査しない |
| TC-note-398 | renameNote: 編集権限のあるノート — タイトルを変更する | spec/testcases/note/renameNote.md#テストケース-renamenote | タイトルが更新され、由来が `manual` になり、`note.renamed` が発行される |
| TC-note-399 | renameNote: — — 空文字列にする | spec/testcases/note/renameNote.md#テストケース-renamenote | タイトルが `"無題"` になり、エラーにならない |
| TC-note-400 | renameNote: — — 空白のみにする | spec/testcases/note/renameNote.md#テストケース-renamenote | タイトルが `"無題"` になる |
| TC-note-401 | renameNote: — — 200 文字にする | spec/testcases/note/renameNote.md#テストケース-renamenote | 成功する（境界値） |
| TC-note-402 | renameNote: — — 201 文字にする | spec/testcases/note/renameNote.md#テストケース-renamenote | `BusinessRuleError(InvalidTitle)` が投げられる |
| TC-note-403 | renameNote: 由来が `auto` のノート — 変更する | spec/testcases/note/renameNote.md#テストケース-renamenote | 由来が `manual` に変わり、以降は変換結果で上書きされない |
| TC-note-404 | renameNote: viewer である — 変更する | spec/testcases/note/renameNote.md#テストケース-renamenote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-405 | renameNote: 同じタイトルのノートが既にある — 同じタイトルにする | spec/testcases/note/renameNote.md#テストケース-renamenote | 成功する（重複を許す） |
| TC-note-406 | renameNote: 他者が先に更新した — 古い `expectedVersion` で変更する | spec/testcases/note/renameNote.md#テストケース-renamenote | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-407 | requestBulkExport: 閲覧できるノートが 10 件 — 一括ダウンロードを要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 親ジョブと 10 件の子ジョブが作られる |
| TC-note-408 | requestBulkExport: 501 件を指定する — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `ValidationError("TOO_MANY_TARGETS")` が投げられる |
| TC-note-409 | requestBulkExport: 500 件を指定する — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 成功する（境界値） |
| TC-note-410 | requestBulkExport: 本文が空のノートを含む — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | それらは除外され、`skipped` に `{ noteId, reason: "contentNotReady" }` として積まれる |
| TC-note-411 | requestBulkExport: 閲覧権限のないノートを含む — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | それらは除外され、`skipped` に `{ noteId, reason: "permissionDenied" }` として積まれる |
| TC-note-412 | requestBulkExport: 存在しない `noteId` を含む — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `listByIds` の結果に現れないその ID は `skipped` に `{ noteId, reason: "notFound" }` として積まれる（入力の `noteIds` と結果を突き合わせる。省くと存在しない ID が無言で落ちる） |
| TC-note-413 | requestBulkExport: 存在しない `noteId` だけを指定する — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 対象が 0 件になり `ValidationError("NO_EXPORTABLE_TARGET")` が投げられる。`skipped` にはすべての ID が `reason: "notFound"` として載る（「どれが無かったのか」が返る） |
| TC-note-414 | requestBulkExport: 存在しない ID・権限のない ID・本文が空の ID を混ぜて指定する — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `skipped` に 3 種類の `reason` がそれぞれ対応する `noteId` とともに積まれ、残りだけが対象になる |
| TC-note-415 | requestBulkExport: すべて本文が空 — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `ValidationError("NO_EXPORTABLE_TARGET")` が投げられる |
| TC-note-416 | requestBulkExport: 閲覧権限のないノートを含む — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | それらは除外される |
| TC-note-417 | requestBulkExport: `skipped` の `reason` の語彙 — `requestBulkNoteOperation` / `requestBackup` と比べる | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 語彙は経路ごとに固有だが、「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う |
| TC-note-418 | requestBulkExport: 合計サイズの見積もりが 1 GB を超える — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `ValidationError("EXPORT_TOO_LARGE")` が投げられる |
| TC-note-419 | requestBulkExport: 一括ダウンロードが既に実行中 — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `BusinessRuleError(BulkExportInProgress)` が投げられる |
| TC-note-420 | requestBulkExport: — — 要求後にジョブの `payload` を確認する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `{ kind: "bulkExport", format }` が親子で同じ値として保存されている |
| TC-note-421 | requestBulkExport: 個人所有のノートだけを要求した — 親ジョブの `scope` を確認する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る |
| TC-note-422 | requestBulkExport: 参加ワークスペース所有のノートだけを要求した（要求者は owner ではないメンバー） — 親ジョブの `scope` を確認する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない） |
| TC-note-423 | requestBulkExport: — — 親ジョブと子ジョブの `scope` を比べる | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 親子で一致する |
| TC-note-424 | requestBulkExport: source scope と異なるノートIDを混ぜて要求する — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 異なるIDは存在を漏らさず `notFound` でskipされ、指定scope以外のDOは呼ばれない |
| TC-note-425 | requestBulkExport: 指定時は混在しているが、権限・本文の絞り込みのあとに残る所有文脈が 1 つになる — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 判定は絞り込みのあとに行うため成功し、残った文脈が `scope` になる |
| TC-note-426 | requestBulkExport: 混在で全体が中止された — ジョブ一覧を確認する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 子ジョブが部分的に残らない |
| TC-note-427 | requestBulkExport: 同じ利用者が2つのworkspace scopeから同時に要求する — 並行実行する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | global D1の `job_slots` 条件付きINSERTは片方だけ成功し、もう片方は `BulkExportInProgress` |
| TC-note-428 | requestBulkExport: slot予約後にscope-local Job作成が失敗する — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | operation IDでslotを解放し、Jobは1件も残らない |
| TC-note-429 | requestBulkExport: scope-local commit後にattach応答を失う — 再試行する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 同じoperation IDで既存Job IDへattachされ、2つ目の親Jobを作らない |
| TC-note-430 | requestBulkExport: Jobが終端する — eventを処理する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | scoped Job IDでslotを冪等に解放する |
| TC-note-431 | requestBulkExport: 未attachのslotが期限切れになる — recoveryを実行する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | 正データの有無を確認し、Jobがなければ回収、あればattachを完了する |
| TC-note-432 | requestBulkExport: 入力source scopeと異なるNoteIdを混ぜる — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | D1のbatch route lookupで`notFound`にし、指定scope DO以外へfan-outしない |
| TC-note-433 | requestBulkExport: 対象routeがmoving / purging — 要求する | spec/testcases/note/requestBulkExport.md#テストケース-requestbulkexport | `notFound`として外し、旧/new scopeの両方を探索しない |
| TC-note-434 | requestBulkNoteOperation: 編集できるノートが 20 件 — タグ追加（`addTag`）を要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 親ジョブと 20 件の子ジョブが作られる |
| TC-note-435 | requestBulkNoteOperation: 編集できるノートが 20 件 — タグ削除（`removeTag`）を要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 親ジョブと 20 件の子ジョブが作られる |
| TC-note-436 | requestBulkNoteOperation: 削除権限のあるノートが 20 件 — ゴミ箱への移動（`trash`）を要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 親ジョブと 20 件の子ジョブが作られる |
| TC-note-437 | requestBulkNoteOperation: 削除権限のないノートが混ざる — `trash` を要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | それらは `skipped` に積まれ、他は登録される |
| TC-note-438 | requestBulkNoteOperation: 501 件を指定する — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `ValidationError("TOO_MANY_TARGETS")` が投げられる |
| TC-note-439 | requestBulkNoteOperation: 500 件を指定する — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 成功する（境界値） |
| TC-note-440 | requestBulkNoteOperation: 権限のないノートが混ざる — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | それらは `skipped` に `{ noteId, reason: "permissionDenied" }` として積まれ、他は登録される |
| TC-note-441 | requestBulkNoteOperation: 存在しない `noteId` を含む — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `listByIds` の結果に現れないその ID は `skipped` に `{ noteId, reason: "notFound" }` として積まれる |
| TC-note-442 | requestBulkNoteOperation: 存在しない ID と権限のない ID を混ぜて指定する — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `skipped` に `notFound` と `permissionDenied` がそれぞれ対応する `noteId` とともに積まれ、残りだけが登録される |
| TC-note-443 | requestBulkNoteOperation: `skipped` の形と `reason` の語彙 — `requestBulkExport` / `requestBackup` と比べる | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 3 経路とも `{ noteId, reason }[]` で揃い、「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う |
| TC-note-444 | requestBulkNoteOperation: すべて権限がない — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `BusinessRuleError(AccessDenied)` が投げられる |
| TC-note-445 | requestBulkNoteOperation: ハンドル未設定で公開への変更を要求する — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられ、1 件も登録されない |
| TC-note-446 | requestBulkNoteOperation: ワークスペースから個人へ移動したノート（`createdBy` は別人）で公開への変更を要求する — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 所有者 `owner.userId` の公開ハンドルで検査される（`createdBy` は用いない） |
| TC-note-447 | requestBulkNoteOperation: 移動先の viewer である — 移動を要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-448 | requestBulkNoteOperation: 移動で閲覧できなくなる利用者が出る — 移動を要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `warnings` にその旨が含まれる |
| TC-note-449 | requestBulkNoteOperation: 移動先にないタグが付いている — 移動を要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `warnings` に外れるタグ名が含まれる |
| TC-note-450 | requestBulkNoteOperation: 対象が 1 件のみ — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | ジョブとして登録される（経路を分けない） |
| TC-note-451 | requestBulkNoteOperation: 未知の操作を指定する — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `ValidationError("INVALID_OPERATION")` が投げられる |
| TC-note-452 | requestBulkNoteOperation: `addTag` / `removeTag` を要求した — 親子の `kind` と `payload` を確認する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `kind: "bulkTag"`、`payload: { kind: "bulkTag", action: "add" \| "remove", tagName }` が親子で同じ値になる |
| TC-note-453 | requestBulkNoteOperation: `changeVisibility` / `move` / `trash` / `purge` を要求した — 親子の `kind` と `payload` を確認する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | それぞれ `bulkVisibility` / `bulkMove` / `bulkDelete` に畳み込まれ、`trash` と `purge` の区別は `payload.mode` が持つ |
| TC-note-454 | requestBulkNoteOperation: 個人所有のノートだけを要求した — 親ジョブの `scope` を確認する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る |
| TC-note-455 | requestBulkNoteOperation: 参加ワークスペース所有のノートだけを要求した（要求者は owner ではないメンバー） — 親ジョブの `scope` を確認する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない） |
| TC-note-456 | requestBulkNoteOperation: — — 親ジョブと子ジョブの `scope` を比べる | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 親子で一致する |
| TC-note-457 | requestBulkNoteOperation: ワークスペース所有のノートを個人へ移す `move` を要求した — 親ジョブの `scope` を確認する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 移動**元**の `{ type: "workspace", workspaceId }` で固定される（移動先で取り直すと移動元の文脈のキャンセル網から外れるため） |
| TC-note-458 | requestBulkNoteOperation: source scope と異なるノートIDを混ぜて要求する — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 異なるIDは存在を漏らさず `notFound` でskipされ、指定scope以外のDOは呼ばれない |
| TC-note-459 | requestBulkNoteOperation: 指定時は混在しているが、権限の絞り込みのあとに残る所有文脈が 1 つになる — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 判定は手順 2 の絞り込みのあとに行うため成功する |
| TC-note-460 | requestBulkNoteOperation: 混在で全体が中止された — ジョブ一覧を確認する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | 子ジョブが部分的に残らない |
| TC-note-461 | requestBulkNoteOperation: `emptyTrash` が 500 件ごとに分割した `purge` — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | どの分割も入力source scopeをJob scopeとして使う |
| TC-note-462 | requestBulkNoteOperation: 入力source scopeと異なるNoteIdを混ぜる — 要求する | spec/testcases/note/requestBulkNoteOperation.md#テストケース-requestbulknoteoperation | route一括検証で`notFound`にし、指定scope DOだけを呼ぶ |
| TC-note-463 | restoreNote: ゴミ箱にある公開だったノート — 復元する | spec/testcases/note/restoreNote.md#テストケース-restorenote | `lifecycle: "active"` になり、公開ステータスが復活する |
| TC-note-464 | restoreNote: ゴミ箱にある限定公開だったノート — 復元する | spec/testcases/note/restoreNote.md#テストケース-restorenote | 同じ共有リンクで再び到達できる |
| TC-note-465 | restoreNote: ゴミ箱にあるノート — 復元する | spec/testcases/note/restoreNote.md#テストケース-restorenote | タグの付与が復活する |
| TC-note-466 | restoreNote: ゴミ箱にないノート — 復元する | spec/testcases/note/restoreNote.md#テストケース-restorenote | `ValidationError("NOTE_NOT_TRASHED")` が投げられる |
| TC-note-467 | restoreNote: viewer である — 復元する | spec/testcases/note/restoreNote.md#テストケース-restorenote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-468 | restoreNote: 復元後 — 一覧を開く | spec/testcases/note/restoreNote.md#テストケース-restorenote | そのノートが現れる |
| TC-note-469 | restoreNote: 所属ワークスペースが削除済み — 復元する | spec/testcases/note/restoreNote.md#テストケース-restorenote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-470 | restoreNoteRevision: 版が複数あるノート — 過去の版を指定して戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 本文・タイトル・スタイルがその版の内容になる |
| TC-note-471 | restoreNoteRevision: 戻した後 — 版の一覧を確認する | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 戻す直前の内容が `reason: "restore"` で記録されている |
| TC-note-472 | restoreNoteRevision: 他のノートの版 ID を指定する — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | `NotFoundError("REVISION_NOT_FOUND")` が投げられる |
| TC-note-473 | restoreNoteRevision: 存在しない版 ID — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | `NotFoundError("REVISION_NOT_FOUND")` が投げられる |
| TC-note-474 | restoreNoteRevision: viewer である — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-475 | restoreNoteRevision: 公開中のノート — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 公開ステータスと共有リンクは変わらない |
| TC-note-476 | restoreNoteRevision: タグが付いたノート — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | タグは変わらない |
| TC-note-477 | restoreNoteRevision: 他者が先に更新した — 古い `expectedVersion` で戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-478 | restoreNoteRevision: 版を復元した — 保存までの経路を確認する | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 版の HTML を `HtmlProcessor.process` に通してから `Note.updateBody` に渡す（`NoteRevision` は HTML しか持たず、`updateBody` は `ProcessedHtml` を要求する） |
| TC-note-479 | restoreNoteRevision: 版を復元した — 復元後の `excerpt` / `headings` を確認する | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 復元した本文から作り直されている（復元前の値が残らない） |
| TC-note-480 | restoreNoteRevision: 取り込み**前**の版に戻す（取り込みは版を作らないため、直近の版は取り込み前のものになる） — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 本文の参照が外部 URL に戻り、`data-imported-stylesheet` だった痕跡が `data-stylesheet-href` に戻る |
| TC-note-481 | restoreNoteRevision: 同上 — 復元後のジョブを確認する | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 内部を指さない参照が 1 件以上あるため参照取り込みジョブが登録される（本文に未取得の参照が残ったまま誰も取りに行かない状態を作らない） |
| TC-note-482 | restoreNoteRevision: 同上 — 復元後の取得記録を確認する | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | `ReferenceAttempt` の行は消えない（記録は URL ごとの「最後に試したときどうだったか」であり、本文が巻き戻っても事実は変わらない。再取り込みが走れば同じ鍵で上書きされる） |
| TC-note-483 | restoreNoteRevision: 復元後の本文に外部参照がない — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 参照取り込みジョブは登録されない |
| TC-note-484 | restoreNoteRevision: 同じノートに未終端の `referenceImport` ジョブがある — 戻す | spec/testcases/note/restoreNoteRevision.md#テストケース-restorenoterevision | 新しいジョブは登録されない（`updateNoteBody` と同じ重複防止） |
| TC-note-485 | runBulkExport: 子ジョブが全件終端し、成功が 1 件以上ある — `updateBatchProgress` を処理する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 親は終端化されず `job.readyToAssemble` が発行され、購読ハンドラーが親ジョブをキューへ送る |
| TC-note-486 | runBulkExport: `job.readyToAssemble` で起動した親ジョブ（子は全件成功） — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `Job.beginAssembly` で組み立ての実行権を取り、ZIP が生成・保管され、親ジョブが `succeeded` になり、7 日の期限が付く |
| TC-note-487 | runBulkExport: 全子が終端し `running` のままの親ジョブ — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | run 系の共通規則の対象外のため `Job.start` は呼ばれない（呼べば「リース有効な `running`」に必ず該当して組み立てられない）。再入防止は `Job.beginAssembly` が担う |
| TC-note-488 | runBulkExport: 子ジョブに未終端のものが残っている — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 何もせず終わる（子の再試行などで進行中に戻っている。組み立ては次の全子終端で `updateBatchProgress` が改めて `job.readyToAssemble` を発行して起動される） |
| TC-note-489 | runBulkExport: 一部の子ジョブが失敗している — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 成功分を含む ZIP が作られ、失敗した対象の一覧がテキストとして同梱される |
| TC-note-490 | runBulkExport: すべての子ジョブが失敗している（成功 0 件） — 全子が終端する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `job.readyToAssemble` は発行されず `runBulkExport` は起動しない。`updateBatchProgress` が他 kind と同じ規則で親を `failed` にする |
| TC-note-491 | runBulkExport: すべての子ジョブが取り消された（成功 0 件） — 全子が終端する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 同様に起動せず、親は `canceled` になる |
| TC-note-492 | runBulkExport: ファイル名が重複する対象がある — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 連番が付いて衝突しない |
| TC-note-493 | runBulkExport: 実行中に対象ノートが削除された — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | そのノートは除外され、処理は続行される |
| TC-note-494 | runBulkExport: 組み立てに時間がかかる — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `Job.renewAssemblyLease(parent, now, leaseUntil)` を保存して組み立てリースを 15 分先へ延長する（`Job.reportProgress` は使わない。組み立て中の親の期限を動かせるのは実行権を持つこのワーカーだけ） |
| TC-note-495 | runBulkExport: 組み立て中に、遅れて届いた・重複配送された子の終了報告で `updateBatchProgress` の `reportProgress` が走る（組み立て中は `retryFailedChildren` が `AssemblyInProgress` で弾かれるため、子の再試行では起こらない） — 親のリースを確認する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 進捗だけが作り直され、`leaseExpiresAt` は延びない（死んだ組み立てワーカーのリースを子側の報告が延ばし続ける事態を防ぐ） |
| TC-note-496 | runBulkExport: 組み立て権を持たないワーカーが `renewAssemblyLease` を呼ぶ（`attempts === 0`、`target.type !== "batch"`、`kind !== "bulkExport"` のいずれか） — 直接呼ぶ | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `BusinessRuleError(InvalidTarget)` で拒否される |
| TC-note-497 | runBulkExport: ZIP の保管が失敗する — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 親ジョブが `failed("storageError")` になる |
| TC-note-498 | runBulkExport: 既に `succeeded` の親ジョブ — `job.readyToAssemble` を再度受け取る | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 何もせず終わり、生成物は増えない（冪等） |
| TC-note-499 | runBulkExport: 親ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） — `job.readyToAssemble` を受け取る | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 何もせず返る（手順 1。不在の扱いは run 系共通規則の判定 1 と同じ） |
| TC-note-500 | runBulkExport: 別のワーカーが組み立て中（`attempts >= 1` かつ組み立てリースが有効） — `job.readyToAssemble` の重複配送を受け取る | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `Job.beginAssembly` が `BusinessRuleError(LeaseActive)` になり、それを吸収して何もせず返る（ZIP は 1 つしか作られない） |
| TC-note-501 | runBulkExport: 全子終端後に `job.readyToAssemble` が同時に 2 回配送される — 2 つのワーカーが実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 手順 1・2 は両方が通過するが、`beginAssembly` の実行権で一方だけが組み立てる（親は終端しておらず子は全件終端のため、終端判定と全子終端判定だけでは重複を排除できない） |
| TC-note-502 | runBulkExport: `beginAssembly` の保存が `ConflictError` になる — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | ジョブを読み直し、終端済みまたは組み立て中（`attempts >= 1` かつリース有効）なら何もせず返る |
| TC-note-503 | runBulkExport: `beginAssembly` で `attempts` が上限を超える — 実行する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 組み立てを始めず `expire` の結果（`failed`、`reason: "timeout"`）を保存して終える。`beginAssembly` はリースを張り直さず、受け取った親（リース失効のまま）に `expire` を適用する（`Job.start` と同じ順序。先に張り直すと `expire` が `LeaseActive` で拒否され、上限超過の回収経路が成立しない） |
| TC-note-504 | runBulkExport: 組み立て中にワーカーが停止した — 組み立てリースが失効する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | 再配送された `job.readyToAssemble` が `beginAssembly` を取り直して引き継ぐ。再配送が来なければ `reapExpiredJobs` が `failed("timeout")` として回収し、手動 `retry` で組み立てからやり直せる |
| TC-note-505 | runBulkExport: 組み立て中に親が外部から強制終端された（`cancelJob` など） — `Job.succeed(artifact)` を保存する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `ConflictError` になるためジョブを読み直し、終端済みなので生成した ZIP を破棄して成功として返す。ジョブは書き換えず、保管済みの artifact は期限付き保管の自動回収に委ねる |
| TC-note-506 | runBulkExport: — — 生成物の保管記録を確認する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `purpose: "artifact"`、`noteId` / `noteVersion` は `null`、`uploadedBy` は要求者、`owner` は要求者の個人 subject |
| TC-note-507 | runBulkExport: 親ジョブの `job.enqueued` が発行された — ディスパッチハンドラーが処理する | spec/testcases/note/runBulkExport.md#テストケース-runbulkexport | `target.type === "batch"` はキューへ送られず、親の実行経路は `job.readyToAssemble` の 1 本だけになる |
| TC-note-508 | runBulkExportItem: 待機中の子ジョブ（`payload.format: "html"`） — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | 自己完結 HTML が生成・保管され、ジョブが `succeeded` になる |
| TC-note-509 | runBulkExportItem: `payload.format: "markdown"` — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | HTML から変換された Markdown が生成・保管される |
| TC-note-510 | runBulkExportItem: `payload.format: "pdf"`、`styleMode: "preserve"` のノート — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | 既定スタイルの当たらない PDF が生成される |
| TC-note-511 | runBulkExportItem: 生成に成功した — 保管記録を確認する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `purpose: "artifact"`、対象の `noteId` と生成時点の版 `noteVersion` が付き、期限は 7 日（ZIP と同じに揃え、親の組み立て・子の再試行の間も生存させる） |
| TC-note-512 | runBulkExportItem: 生成に成功した — 保管記録とジョブの保存の境界を確認する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `StoredFile.registerEphemeral`（手順 4）と `Job.succeed(artifact)`（手順 5）が**同一 UoW** で保存される。「保管済みだが `Job.succeed` 前」の子を作らないためで、これがないと強制終端の後始末（`succeeded` の子で絞る回収）から漏れて、アクセス権を失った利用者の手元に本文を含む生成物が 7 日残る |
| TC-note-513 | runBulkExportItem: 手順 4 の UoW がロールバックした — 保管の状態を確認する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `ObjectStorage.put` 済みの実体はメタデータのない孤児オブジェクトとして残るが、参照されないため害はない（削除順序と同じ整理） |
| TC-note-514 | runBulkExportItem: `format: "pdf"` で生成した直後 — 同じノートを `exportNote` で PDF ダウンロードする | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | 同版で残りの保持期間も十分にあるため再利用され、ジョブは登録されない。再利用側が課すのは残りの保持期間の**下限**（`expiresAt >= now + 35 分`）だけで上限はなく、EX-01 の 24 時間は保持期間の下限の約束のため、7 日残る生成物を単体エクスポートに返しても約束に反しない |
| TC-note-515 | runBulkExportItem: ジョブが `succeeded` になった — 親の進捗を確認する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `job.succeeded` を購読する `updateBatchProgress` が親の進捗を進める |
| TC-note-516 | runBulkExportItem: 対象ノートが削除済み — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `failed("targetMissing")` になる |
| TC-note-517 | runBulkExportItem: 対象ノートがゴミ箱にある — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `failed("targetMissing")` になる |
| TC-note-518 | runBulkExportItem: 本文が `ready` でない — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `failed("targetMissing")` になる |
| TC-note-519 | runBulkExportItem: 実行時に要求者が閲覧権限を失っている — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `failed("permissionRevoked")` になる |
| TC-note-520 | runBulkExportItem: 生成がタイムアウトする — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `failed("timeout")` になる |
| TC-note-521 | runBulkExportItem: 保管が失敗する — 実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `failed("storageError")` になる |
| TC-note-522 | runBulkExportItem: 既に `succeeded` の子ジョブ — 再度実行する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | 何もせず終わり、生成物は増えない（冪等） |
| TC-note-523 | runBulkExportItem: 子ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） — 配送で受け取る | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | 何もせず成功として返る（run 系共通規則の判定 1） |
| TC-note-524 | runBulkExportItem: リースが有効な `running` の子ジョブ — 再配送で受け取る | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | 何もせず終わる（他のワーカーが実行中） |
| TC-note-525 | runBulkExportItem: リースが失効した `running` の子ジョブ — 再配送で受け取る | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | 引き継いで再開し、`attempts` が加算される |
| TC-note-526 | runBulkExportItem: 実行中に子ジョブが外部から強制終端された（親の `cancelJob` など） — `Job.succeed` の保存が `ConflictError` になる | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | ジョブを読み直し、終端済みのため生成物を破棄して成功として返す。ジョブは書き換えず、保管済みの artifact は期限付き保管の自動回収に委ねる（run 系共通規則の判定 4） |
| TC-note-527 | runBulkExportItem: 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） — 結果を保存する | spec/testcases/note/runBulkExportItem.md#テストケース-runbulkexportitem | `ConflictError` をそのまま投げて再配送に委ねる |
| TC-note-528 | runBulkNoteOperationItem: 待機中の子ジョブと有効な対象 — タグ追加（`addTag`）を実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | タグが付き、ジョブが `succeeded` になる |
| TC-note-529 | runBulkNoteOperationItem: 既にタグが付いている — `addTag` を実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 成功として扱われ、重複した付与は作られない |
| TC-note-530 | runBulkNoteOperationItem: そのタグが付いた対象 — タグ削除（`removeTag`）を実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 付与が外れ、ジョブが `succeeded` になる |
| TC-note-531 | runBulkNoteOperationItem: そのタグが付いていない対象 — `removeTag` を実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 既に目的の状態のため成功として扱われる（冪等） |
| TC-note-532 | runBulkNoteOperationItem: 対象ノートの所有文脈のスコープに同名のタグが存在しない — `removeTag` を実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `TagRepository.findByScopeAndName` が `tagId` を返さないため `unassignTag` を呼ばず、成功として扱われる（冪等） |
| TC-note-533 | runBulkNoteOperationItem: `removeTag` を実行する — `unassignTag` に渡す引数を確認する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `payload` の `tagName` を `TagScope.fromNoteOwner(note.owner)` と `TagRepository.findByScopeAndName` で `tagId` に解決してから渡す（`userId` は `job.requestedBy`） |
| TC-note-534 | runBulkNoteOperationItem: アクティブなノート — `trash` を実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `trashNote` に `excludingJobId: jobId`（この子ジョブ自身の ID）を渡して呼び、ノートがゴミ箱に移り、この子ジョブは `succeeded` になる |
| TC-note-535 | runBulkNoteOperationItem: 同上 — 取り消されたジョブを確認する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 同じノートを対象とする他の未終端ジョブ（変換・再生成・PDF 書き出し・別の一括操作の子）は通常どおり取り消されるが、呼び出し元であるこの子ジョブ自身だけは `trashNote` の手順 2 の対象から外れる |
| TC-note-536 | runBulkNoteOperationItem: `excludingJobId` を渡さずに `trash` を呼んだ場合（退行） — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 子ジョブ自身が `Job.cancel` され、手順 4 の `Job.succeed` が `ConflictError` になり、全件正常に移動できたのに親が `canceled` として集計される（この退行を防ぐための引数。「共通: ユースケースを合成するときの副作用の範囲」） |
| TC-note-537 | runBulkNoteOperationItem: 既にゴミ箱にあるノート — `trash` を実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 既に目的の状態のため成功として扱われる（冪等） |
| TC-note-538 | runBulkNoteOperationItem: 対象ノートが削除済み — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `failed("targetMissing")` になる |
| TC-note-539 | runBulkNoteOperationItem: 実行時に権限を失っている — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `failed("permissionRevoked")` になる |
| TC-note-540 | runBulkNoteOperationItem: 本文が空のノートに公開への変更を実行する — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `failed("unknown")` になり、理由が `detail` に記録される |
| TC-note-541 | runBulkNoteOperationItem: 既に `succeeded` のジョブ — 再度実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 何もせず終わる |
| TC-note-542 | runBulkNoteOperationItem: ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） — 配送で受け取る | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 何もせず成功として返る（run 系共通規則の判定 1） |
| TC-note-543 | runBulkNoteOperationItem: リースが有効な `running` の子ジョブ — 再配送で受け取る | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 何もせず終わる（他のワーカーが実行中） |
| TC-note-544 | runBulkNoteOperationItem: リースが失効した `running` の子ジョブ — 再配送で受け取る | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 引き継いで再開し、`attempts` が加算される |
| TC-note-545 | runBulkNoteOperationItem: 実行中に子ジョブが外部から強制終端された（親の `cancelJob` など） — `Job.succeed` / `Job.fail` の保存が `ConflictError` になる | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | ジョブを読み直し、終端済みのため生成物を破棄して成功として返す。ジョブは書き換えない（run 系共通規則の判定 4） |
| TC-note-546 | runBulkNoteOperationItem: ジョブ保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） — 結果を保存する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `ConflictError` をそのまま投げて再配送に委ねる |
| TC-note-547 | runBulkNoteOperationItem: ノートの版が競合する — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 1 度読み直して再適用し、成功する |
| TC-note-548 | runBulkNoteOperationItem: ノートの版の競合が続く — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `failed("unknown")` になる |
| TC-note-549 | runBulkNoteOperationItem: 移動を実行する — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | タグ・保管ファイル・使用量の付け替えも行われる |
| TC-note-550 | runBulkNoteOperationItem: `move` の移動先ワークスペースが登録から実行までの間に削除された — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `moveNote` が返す `NotFoundError("WORKSPACE_NOT_FOUND")` を `Job.fail("targetMissing")` に写す（`unknown` にはしない。この経路の想定内の分岐であるため） |
| TC-note-551 | runBulkNoteOperationItem: 個人 → ワークスペースの一括移動で移動先が削除された — ジョブが取り消されるかを確認する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `bulkMove` の `scope` は移動**元**の文脈で固定されるため移動先ワークスペースの削除・除名によるキャンセル網には載らず、実行時に対象不在（`targetMissing`）として分岐する |
| TC-note-552 | runBulkNoteOperationItem: ゴミ箱のノートに `purge` を実行する — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | 完全削除され、ジョブが `succeeded` になる |
| TC-note-553 | runBulkNoteOperationItem: ゴミ箱にないノートに `purge` を実行する — 実行する | spec/testcases/note/runBulkNoteOperationItem.md#テストケース-runbulknoteoperationitem | `failed("unknown")` になり、理由が `detail` に記録される |
| TC-note-554 | runNoteExport: 本文のあるノートと待機中のジョブ — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | PDF が生成・保管され、ジョブが `succeeded` になり、生成物が 24 時間の期限を持つ |
| TC-note-555 | runNoteExport: 生成に成功した — 保管記録を確認する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | `purpose: "artifact"`、対象の `noteId` と描画時点の版 `noteVersion` が付く |
| TC-note-556 | runNoteExport: サインイン済みの要求から登録されたジョブ — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | artifact の `uploadedBy` が要求者、`owner` は要求者の個人 subject になる |
| TC-note-557 | runNoteExport: 匿名の要求から登録されたジョブ（`requestedBy: null`） — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | artifact の `uploadedBy` が `null`、`owner` はノートの所有文脈になる |
| TC-note-558 | runNoteExport: 既に `succeeded` のジョブ — 再度実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | 何もせず終わり、生成物は増えない |
| TC-note-559 | runNoteExport: ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） — 配送で受け取る | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | 何もせず成功として返る（run 系共通規則の判定 1） |
| TC-note-560 | runNoteExport: リースが有効な `running` のジョブ — 再配送で受け取る | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | 何もせず終わる（他のワーカーが実行中） |
| TC-note-561 | runNoteExport: リースが失効した `running` のジョブ — 再配送で受け取る | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | 引き継いで再開し、`attempts` が加算される |
| TC-note-562 | runNoteExport: 実行中にジョブが外部から強制終端された（`cancelJob` など） — `Job.succeed` の保存が `ConflictError` になる | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | ジョブを読み直し、終端済みのため生成した PDF を破棄して成功として返す。ジョブは書き換えず、保管済みの artifact は期限付き保管の自動回収に委ねる（run 系共通規則の判定 4） |
| TC-note-563 | runNoteExport: 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） — 結果を保存する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | `ConflictError` をそのまま投げて再配送に委ねる |
| TC-note-564 | runNoteExport: ノートが削除済み — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | ジョブが `failed("targetMissing")` になる |
| TC-note-565 | runNoteExport: 本文が `processing` のノート — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | ジョブが `failed("targetMissing")` になる |
| TC-note-566 | runNoteExport: 描画がタイムアウトする — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | ジョブが `failed("timeout")` になる |
| TC-note-567 | runNoteExport: 保管が失敗する — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | ジョブが `failed("storageError")` になる |
| TC-note-568 | runNoteExport: `styleMode: "default"` のノート — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | 既定スタイルが当たった PDF になる |
| TC-note-569 | runNoteExport: `styleMode: "preserve"` のノート — 実行する | spec/testcases/note/runNoteExport.md#テストケース-runnoteexport | 既定スタイルが当たらない PDF になる |
| TC-note-570 | searchNotes: 個人ノートが 5 件ある — 条件なしで検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 5 件が更新日時の降順で返る |
| TC-note-571 | searchNotes: 個人scopeを検索する — query先を確認する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | ownerから決めた1つのscope DOの `LocalNoteQueryService` だけを呼び、global D1や他scopeへfan-outしない |
| TC-note-572 | searchNotes: workspace scopeを検索する — query先を確認する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | workspace objectでmembershipを確認してから同じobjectのlocal FTSを読む |
| TC-note-573 | searchNotes: ノートが 0 件 — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 空配列と `count: 0` が返る |
| TC-note-574 | searchNotes: 本文に「設計」を含むノートがある — 「設計」で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返り、`highlightedExcerpt` に一致区間を `<mark>` で囲んだ抜粋が入る（FTS5 の `snippet()` / `highlight()` は使わない。それらが返すのは前処理済みの `title_fts` / `text_fts`、つまりビグラム列であり利用者に見せられない） |
| TC-note-575 | searchNotes: 同上 — ハイライトの求め方を確認する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 一致位置は読み取りモデルの生テキスト（`note_search.excerpt`、なければ `text` から窓を切り出す）に対し、検索語と同じ NFKC 正規化 + 小文字化だけ（ビグラム化はしない）を双方に適用した部分一致で求める |
| TC-note-576 | searchNotes: 本文に「ＡＢＣ」（全角）を含み、`excerpt` にも現れる — 「abc」で検索し、`highlightedExcerpt` の中身を確認する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 照合が検索と同じ正規化を通るため一致し、返る文字列は正規化済みテキストではなく**元テキストの一部**（「ＡＢＣ」のまま）になる（NFKC は文字数を変えうるため、正規化後の位置 → 元テキストの位置の写像で切り出しとハイライトの区間を決める） |
| TC-note-577 | searchNotes: 一致がタイトルまたはタグ名にしかない — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 行はヒットするが `highlightedExcerpt` は `null` になり、画面は素の `excerpt` を出す（一致位置は生テキストの `excerpt` / `text` からしか求めない。既知の限界） |
| TC-note-578 | searchNotes: 「日本。本語」を含む行が「日本語」で偽陽性ヒットした — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 生テキストに一致区間が現れないため `highlightedExcerpt` は `null` になる（FTS のヒットとハイライトは必ずしも一致しない） |
| TC-note-579 | searchNotes: キーワードを指定しない — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | `highlightedExcerpt` は `null` になる |
| TC-note-580 | searchNotes: 本文に `<script>` のような記号を含む — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | `highlightedExcerpt` は HTML エスケープ済みの文字列に `<mark>` を入れたものになる（標識を入れる側がエスケープまで責任を持つ。素の `excerpt` は平文のまま） |
| TC-note-581 | searchNotes: `highlightedExcerpt` が非 `null` の行と `null` の行が混ざる — 一覧を描画する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 非 `null` の行は HTML 断片として描き（含まれるタグは `<mark>` のみ）、`null` の行は素の `excerpt` を**平文として**描く。HTML の枝と平文の枝を取り違えない（[domains/note.md](../domains/note.md) の `NoteSummary` の描画契約） |
| TC-note-582 | searchNotes: 日本語の本文がある — 単語区切りのない語で部分一致検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る |
| TC-note-583 | searchNotes: 本文に「東京都」を含むノートがある — 「東京」（2 文字）で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る（bigram 方式で 2 文字から有効） |
| TC-note-584 | searchNotes: — — 1 文字で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 検索語は無視され、全件が返る |
| TC-note-585 | searchNotes: 本文に「ＡＢＣ」（全角）を含むノートがある — 「abc」（半角小文字）で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る（NFKC 正規化と小文字化） |
| TC-note-586 | searchNotes: 本文に「ｶﾀｶﾅ」（半角カナ）を含むノートがある — 「カタカナ」（全角）で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る（NFKC 正規化） |
| TC-note-587 | searchNotes: 本文に「佐々木」を含むノートがある — 「佐々」で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る（`々` は CJK として扱い分断しない） |
| TC-note-588 | searchNotes: 本文に「日本。本語」を含むノートがある — 「日本語」で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | ヒットしてよい（句読点・空白の境界をまたぐ既知の偽陽性。関連度で下位に沈む） |
| TC-note-589 | searchNotes: 本文に「Cloudflare」を含むノートがある — 「cloud」で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る（英数字トークンは前方一致） |
| TC-note-590 | searchNotes: 本文に「Cloudflare」を含むノートがある — 「flare」で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 返らなくてよい（英単語の中間一致は引けない既知の限界） |
| TC-note-591 | searchNotes: タグ A と B を持つノート、A のみのノートがある — A と B の両方で絞り込む | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 両方を持つノートだけが返る |
| TC-note-592 | searchNotes: 「日本」タグのノートと「日本語」タグのノートがある — タグ「日本」で絞り込む | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 「日本」タグのノートだけが返り、「日本語」タグのノートは返らない（絞り込みは `note_search_tags.normalized` への JOIN による完全一致で行うため。`tag_names` / `tag_names_fts` への MATCH では bigram が前方一致して偽陽性になる。ADR 011） |
| TC-note-593 | searchNotes: 「本」「AI」のような 1〜2 文字のタグ名が付いたノートがある — そのタグ名で絞り込む | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る（絞り込みは FTS を経ないため、キーワード検索の 2 文字下限や 1 文字の `QUERY_TOO_SHORT` の制約を受けず、1 文字のタグでも引ける） |
| TC-note-594 | searchNotes: 表示名が「Design」のタグが付いたノートがある — 「ｄｅｓｉｇｎ」（全角・大文字混じり）で絞り込む | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 該当ノートが返る（入力の `tagNames` を `TagName` の正規化規則 — 小文字化・全角英数の半角化・連続空白の畳み込み — で正規化してから正規化名で照合する） |
| TC-note-595 | searchNotes: 表示名が「Design」のタグが付いたノートがある — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | `NoteSummary.tagNames` には表示名の「Design」が返る（正規化名の `design` ではない） |
| TC-note-596 | searchNotes: 2 月作成のノートがある — 2 月で絞り込む（タイムゾーン指定あり） | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 利用者のタイムゾーンで 2 月に入るノートだけが返る |
| TC-note-597 | searchNotes: 条件に一致しない — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 空配列が返る |
| TC-note-598 | searchNotes: ワークスペースの viewer — そのワークスペースを対象に検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 一覧が返る |
| TC-note-599 | searchNotes: 非メンバー — そのワークスペースを対象に検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-600 | searchNotes: ワークスペースの viewer — `lifecycle: "trashed"` で検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-note-601 | searchNotes: 変換処理中のノートがある — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 一覧に含まれ、`contentStatus: "processing"` が返る |
| TC-note-602 | searchNotes: `limit` を 101 にする — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | `ValidationError("INVALID_PAGINATION")` が投げられる |
| TC-note-603 | searchNotes: `limit` を 100 にする — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 成功する（境界値） |
| TC-note-604 | searchNotes: 検索が長時間かかる — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | `SystemError(TimeoutError)` が投げられる |
| TC-note-605 | searchNotes: タイトル順を指定する — 検索する | spec/testcases/note/searchNotes.md#テストケース-searchnotes | 日本語を含むタイトルでも安定した順序で返る |
| TC-note-606 | searchPublicNotes: 複数の利用者の公開ノートがある — キーワードで検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 該当する公開ノートが関連度順で返る |
| TC-note-607 | searchPublicNotes: 全体検索 — query先を確認する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | global D1の `public_note_search*` だけを読み、scope DOへfan-outしない |
| TC-note-608 | searchPublicNotes: move前scopeの遅延eventがある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | route/source version条件により旧ownerの行が復活しない |
| TC-note-609 | searchPublicNotes: 非公開・限定公開のノートがある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | それらは含まれない |
| TC-note-610 | searchPublicNotes: ゴミ箱の公開ノートがある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | それは含まれない |
| TC-note-611 | searchPublicNotes: 公開から外されたノートがある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | それは含まれない |
| TC-note-612 | searchPublicNotes: `ownerHandle` を指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | その利用者の公開ノートだけが返る |
| TC-note-613 | searchPublicNotes: `workspaceSlug` を指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | その公開ワークスペースの公開ノートだけが返る |
| TC-note-614 | searchPublicNotes: 存在しないハンドルを指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `NotFoundError("OWNER_NOT_FOUND")` が投げられる |
| TC-note-615 | searchPublicNotes: 非公開ワークスペースのスラッグを指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `NotFoundError("OWNER_NOT_FOUND")` が投げられる |
| TC-note-616 | searchPublicNotes: キーワードが 1 文字でタグも期間も未指定、`ownerFilter` も未指定 — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 転送境界で `keyword` が `null` に落とされた結果 条件が 1 つも残らず、`ValidationError("QUERY_TOO_SHORT")` が投げられる（下限違反そのものはエラーにしない。`searchNotes` と同じ落とし方） |
| TC-note-617 | searchPublicNotes: キーワードが 1 文字で `ownerHandle` を指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `keyword` は `null` に落ちるが `ownerFilter` があるため `QUERY_TOO_SHORT` にはならず、その利用者の公開ノートの一覧が返る |
| TC-note-618 | searchPublicNotes: キーワードが 101 文字 — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `ValidationError`（転送境界の 100 文字上限） |
| TC-note-619 | searchPublicNotes: `tagNames` を 11 件指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `ValidationError`（最大 10 件） |
| TC-note-620 | searchPublicNotes: `updatedFrom > updatedTo` — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `ValidationError("INVALID_DATE_RANGE")` が投げられる |
| TC-note-621 | searchPublicNotes: `limit` に 0 または 101 を指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `ValidationError("INVALID_PAGINATION")` が投げられる |
| TC-note-622 | searchPublicNotes: `ownerHandle` を指定し、キーワードもタグも期間も指定しない — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `QUERY_TOO_SHORT` にはならず、その利用者の公開ノートの一覧が返る（公開ページの条件なし一覧） |
| TC-note-623 | searchPublicNotes: `workspaceSlug` を指定し、キーワードもタグも期間も指定しない — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `QUERY_TOO_SHORT` にはならず、その公開ワークスペースの公開ノートの一覧が返る |
| TC-note-624 | searchPublicNotes: キーワードなしでタグのみ指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 該当ノートが返る |
| TC-note-625 | searchPublicNotes: 「日本」タグの公開ノートと「日本語」タグの公開ノートがある — タグ「日本」で絞り込む | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 「日本」タグのノートだけが返り、「日本語」タグのノートは返らない（絞り込みは `note_search_tags.normalized` への JOIN による完全一致で行うため。`tag_names` / `tag_names_fts` への MATCH では bigram が前方一致して偽陽性になる。ADR 011） |
| TC-note-626 | searchPublicNotes: 「本」「AI」のような 1〜2 文字のタグ名が付いた公開ノートがある — そのタグ名で絞り込む | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 該当ノートが返る（絞り込みは FTS を経ないため、キーワード検索の 2 文字下限や 1 文字の `QUERY_TOO_SHORT` の制約を受けず、1 文字のタグでも引ける） |
| TC-note-627 | searchPublicNotes: 表示名が「Design」のタグが付いた公開ノートがある — 「ｄｅｓｉｇｎ」（全角・大文字混じり）で絞り込む | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 該当ノートが返る（入力の `tagNames` を `searchNotes` と同じ `TagName` の正規化規則で正規化してから正規化名で照合する） |
| TC-note-628 | searchPublicNotes: 表示名が「Design」のタグが付いた公開ノートがある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `PublicNoteSummary.tagNames` には表示名の「Design」が返る（正規化名の `design` ではない） |
| TC-note-629 | searchPublicNotes: 本文に「東京都」を含む公開ノートがある — 「東京」（2 文字）で検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 該当ノートが返る（bigram 方式で 2 文字から有効） |
| TC-note-630 | searchPublicNotes: 本文に「ＡＢＣ」（全角）を含む公開ノートがある — 「abc」（半角小文字）で検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 該当ノートが返る（NFKC 正規化と小文字化） |
| TC-note-631 | searchPublicNotes: 本文に「日本。本語」を含む公開ノートがある — 「日本語」で検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | ヒットしてよい（句読点・空白の境界をまたぐ既知の偽陽性。関連度で下位に沈む） |
| TC-note-632 | searchPublicNotes: 所属先の異なる同名タグがある — そのタグ名で検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | どちらの所属先のノートも返る（正規化名で一致させる） |
| TC-note-633 | searchPublicNotes: `updatedFrom` と `updatedTo` の両方を指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `updatedWithin: DateRange` に解決され、`from` は `updatedFrom` の 0 時、`toExclusive` は `updatedTo` の翌日 0 時になる。絞り込みの基準列は読み取りモデルの更新日時（`note_search.updated_at`） |
| TC-note-634 | searchPublicNotes: `updatedTo` に指定した日に更新されたノートがある — その日を `updatedTo` にして検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 含まれる（`toExclusive` を翌日 0 時に取ることで指定日を含める） |
| TC-note-635 | searchPublicNotes: `toExclusive`（`updatedTo` の翌日 0 時）ちょうどに更新されたノートがある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 含まれない（`DateRange` の規約どおり `from` 以上 `toExclusive` 未満。境界値） |
| TC-note-636 | searchPublicNotes: `from`（`updatedFrom` の 0 時）ちょうどに更新されたノートがある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 含まれる（下端は包含。境界値） |
| TC-note-637 | searchPublicNotes: `updatedFrom` だけを指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 欠けた側が範囲の端で埋められ、`toExclusive` は十分先の未来になる（それ以降に更新されたノートも返る） |
| TC-note-638 | searchPublicNotes: `updatedTo` だけを指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 欠けた側が範囲の端で埋められ、`from` は epoch になる（それ以前に更新されたノートも返る） |
| TC-note-639 | searchPublicNotes: 境界の解決 — タイムゾーンを確認する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | UTC で解決される（サインイン不要の経路で閲覧者のタイムゾーンを持てないため。`searchNotes` の `createdWithin` が利用者のタイムゾーンで解決するのとは対になる） |
| TC-note-640 | searchPublicNotes: 作成日時は範囲内だが更新日時は範囲外のノートがある — 期間を指定して検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 含まれない（基準列は更新日時であり、`searchNotes` の作成日時基準とは異なる） |
| TC-note-641 | searchPublicNotes: キーワードもタグも `ownerFilter` も指定せず期間だけを指定する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `QUERY_TOO_SHORT` にはならず、その期間に更新された公開ノートが返る |
| TC-note-642 | searchPublicNotes: `ownerHandle` と期間を組み合わせる — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | その利用者の公開ノートのうち期間に該当するものだけが返る |
| TC-note-643 | searchPublicNotes: 短時間に大量に検索する — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `ValidationError("RATE_LIMITED")` が投げられる |
| TC-note-644 | searchPublicNotes: 一致が 0 件 — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 空配列が返る |
| TC-note-645 | searchPublicNotes: 2page以上の結果がある — `nextCursor`で続ける | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 各shardのkeyset位置から続き、既出Noteを重複せず返す。page番号やexact countは返さない |
| TC-note-646 | searchPublicNotes: NoteId hash shardが32個ある — 1page検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | 同時6接続のwaveで各shard最大`limit`候補だけを読み、深いpageでもworkがpage番号に比例しない |
| TC-note-647 | searchPublicNotes: keyword検索でshardごとのFTS統計が異なる — mergeする | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | shard内rankのReciprocal Rank Fusionと`updatedAt, noteId` tie-breakを使い、global bm25同値ではなく明示した安定順位を返す |
| TC-note-648 | searchPublicNotes: shard追加のdual-read中に同じNoteが旧新へある — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | NoteIdで重複排除し、cursorのshard generationに従って次pageも同じ集合を読む |
| TC-note-649 | searchPublicNotes: cursorの検索条件・署名・shard generationが一致しない — 検索する | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | `ValidationError("INVALID_PAGINATION")` を返す |
| TC-note-650 | searchPublicNotes: 1page目の後に対象NoteのupdatedAtが変わる — 同じcursorで続ける | spec/testcases/note/searchPublicNotes.md#テストケース-searchpublicnotes | cursor時点のsnapshot isolationは保証しない。page内/dual-read重複は除くが、更新結果を確実に見るには先頭から再検索する |
| TC-note-651 | setSharePassword: 限定公開のノート — 8 文字以上のパスワードを設定する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | `hasSharePassword: true` になり、`shareLink.password` が `{ hash, updatedAt: now }` になる |
| TC-note-652 | setSharePassword: — — 7 文字のパスワードを設定する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | `BusinessRuleError(WeakPassword)` が投げられる |
| TC-note-653 | setSharePassword: — — 8 文字のパスワードを設定する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | 成功する（境界値） |
| TC-note-654 | setSharePassword: パスワード設定済み — 別のパスワードに変更する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | `shareLink.password.updatedAt` が変更時刻に更新され、`hash` も差し替わる |
| TC-note-655 | setSharePassword: パスワード設定済み — `null` を指定して解除する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | `hasSharePassword: false` になり、`shareLink.password` が `null` になる（ハッシュと更新時刻が同時に消える） |
| TC-note-656 | setSharePassword: 非公開のノート — 設定する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | `BusinessRuleError(NotUnlisted)` が投げられる |
| TC-note-657 | setSharePassword: 公開ノート — 設定する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | `BusinessRuleError(NotUnlisted)` が投げられる |
| TC-note-658 | setSharePassword: 通過済みの閲覧者がいる — パスワードを変更する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | その閲覧者は再度パスワードを求められる（通過証の `passwordUpdatedAt` が `shareLink.password.updatedAt` と食い違う） |
| TC-note-659 | setSharePassword: 通過済みの閲覧者がいる — パスワードを解除する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | その閲覧者はパスワードなしで閲覧できる（`shareLink.password` が `null` のため `passwordRequired` にならない） |
| TC-note-660 | setSharePassword: — — 設定後に応答を確認する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | パスワードの値もハッシュも含まれない |
| TC-note-661 | setSharePassword: viewer である — 設定する | spec/testcases/note/setSharePassword.md#テストケース-setsharepassword | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-662 | trashNote: 削除権限のあるノート — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | `lifecycle: "trashed"` になり、`purgeAfter` が 30 日後になる |
| TC-note-663 | trashNote: 公開ノート — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 公開 URL が「見つかりません」になる |
| TC-note-664 | trashNote: 限定公開のノート — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 共有リンクが「見つかりません」になる |
| TC-note-665 | trashNote: 変換処理中のノート — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 実行中のジョブがキャンセルされてから削除される |
| TC-note-666 | trashNote: `excludingJobId: null`（画面からの呼び出し） — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | `listActiveByTarget` を `limit: 100` で引き、返った未終端ジョブがすべて `Job.cancel` される（除外すべきジョブが存在しないため） |
| TC-note-667 | trashNote: 網が 100 件を返した — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 同じ UoW で継続要求 `job.terminationContinued { origin: { path: "trashNote", noteId, excludingJobId } }` を積む。1 ノートの網なので実際には達しないが、達しないことは規模の見積もりであって型の保証ではないため、規則は経路ごとに省かない |
| TC-note-668 | trashNote: 継続要求の `origin` — 内容を確認する | spec/testcases/note/trashNote.md#テストケース-trashnote | `excludingJobId` を必ず運ぶ。落とすと 2 巡目で除外規約（「共通: ユースケースを合成するときの副作用の範囲」）が黙って外れ、`runBulkNoteOperationItem` が自分自身を取り消す |
| TC-note-669 | trashNote: `excludingJobId` に一括操作の子ジョブの ID を渡す（`runBulkNoteOperationItem` からの呼び出し） — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 一致する 1 件だけが強制終端から外れ、同じノートを対象とする他のジョブ（変換・再生成・PDF 書き出し・別の一括操作の子）は通常どおり取り消される（取り消すべき理由は呼び出し経路によらない。「共通: ユースケースを合成するときの副作用の範囲」） |
| TC-note-670 | trashNote: `excludingJobId` に、そのノートを対象としないジョブの ID を渡す — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 除外は起きず、`listActiveByTarget` が返したジョブがすべて取り消される（除外は ID の一致する 1 件だけに効く） |
| TC-note-671 | trashNote: 本文が `processing` のまま変換ジョブを強制終端した — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が適用され、本文が `failed(canceled)` になる（`restoreNote` で戻したときに `processing` のまま固定されない） |
| TC-note-672 | trashNote: 同上 — 適用順を確認する | spec/testcases/note/trashNote.md#テストケース-trashnote | `Note.markConversionFailed` を `Note.trash` より**先に**適用する（`markConversionFailed` は `ActiveNote` しか受け取らない）。ジョブの取り消し・本文の回復・ゴミ箱への移動はすべて同一 UoW で保存される |
| TC-note-673 | trashNote: 実行中のジョブが `kind: "regeneration"` — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | ジョブは取り消されるが本文は `ready` のまま変更されない（後始末の本文回復は `conversion` のみ） |
| TC-note-674 | trashNote: 取り消したジョブ — 破棄された生成物を確認する | spec/testcases/note/trashNote.md#テストケース-trashnote | 回収の対象は空になる。「共通: 強制終端の後始末」の 2 が回収するのは batch 親の**既に成功した子**の artifact だけで、`listActiveByTarget({ type: "note", noteId })` が返すのは未終端かつ `target.type === "note"` のジョブ（＝ batch 親ではない）に限られるためである |
| TC-note-675 | trashNote: そのノートに対する匿名の PDF 書き出しジョブが実行中 — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | `listActiveByTarget` は要求者を問わないため匿名ジョブも取り消される（ADR 010）。未終端なので artifact はまだ存在せず、回収するものはない |
| TC-note-676 | trashNote: そのノートの成功済みの PDF 書き出し（匿名を含む）の artifact が期限内に残っている — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 終端させる集合が未終端のジョブだけであるため破棄されず、期限（`expiresAt`）の経過による `collectExpiredArtifacts` の自動回収に委ねられる |
| TC-note-677 | trashNote: 既にゴミ箱にある — 再度ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | 変更なしで成功する |
| TC-note-678 | trashNote: viewer である — ゴミ箱に入れる | spec/testcases/note/trashNote.md#テストケース-trashnote | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-679 | trashNote: ゴミ箱に入れた後 — 一覧を開く | spec/testcases/note/trashNote.md#テストケース-trashnote | そのノートは一覧に現れない |
| TC-note-680 | trashNote: ゴミ箱に入れた後 — ゴミ箱を開く | spec/testcases/note/trashNote.md#テストケース-trashnote | そのノートが現れる |
| TC-note-681 | trashNote: 他者が先に更新した — 古い `expectedVersion` で削除する | spec/testcases/note/trashNote.md#テストケース-trashnote | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-682 | updateNoteBody: 編集権限のあるノート — 有効な HTML で保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 本文が更新され、直前の内容が版として記録される |
| TC-note-683 | updateNoteBody: `script` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `script` が除去され、`removed` に理由つきで含まれる |
| TC-note-684 | updateNoteBody: `noscript` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去され、`removed` に含まれる（内容の解釈規則が実行環境で分かれ、パーサーによってはサニタイズを経ずに DOM へ復活するため） |
| TC-note-685 | updateNoteBody: `onclick` 属性を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 属性が除去され、`removed` に含まれる |
| TC-note-686 | updateNoteBody: `javascript:` の URL を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | URL が除去され、`removed` に含まれる |
| TC-note-687 | updateNoteBody: `vbscript:` / `file:` / `blob:` の URL を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | いずれも許可スキームでないため除去され、`removed` に含まれる |
| TC-note-688 | updateNoteBody: `iframe` / `frame` / `frameset` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 要素ごと除去され、`removed` に含まれる（本文の内側に別文書を埋め込めない） |
| TC-note-689 | updateNoteBody: `<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 要素と `srcdoc` 属性の両方が除去され、属性値の中の HTML が残らない（要素単位の除去だけでは属性値の中の第二の HTML 文書を見られないため、`srcdoc` は属性としても単独で非許可） |
| TC-note-690 | updateNoteBody: 許可される要素に `srcdoc` 属性を付けた HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 属性が除去され、`removed` に含まれる（`srcdoc` は要素に依らず非許可） |
| TC-note-691 | updateNoteBody: `object` / `embed` / `applet` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | いずれも除去され、`removed` に含まれる（プラグイン・外部データの埋め込み） |
| TC-note-692 | updateNoteBody: `form` / `input` / `button` / `select` / `textarea` などのフォーム系要素を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | いずれも除去され、`removed` に含まれる（正規ドメイン上の公開ページに資格情報の入力欄を置けないようにする） |
| TC-note-693 | updateNoteBody: `base` 要素を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去され、`removed` に含まれる（本文中のすべての相対 URL の解決先をまとめて外部へ向け直せるため） |
| TC-note-694 | updateNoteBody: `<meta http-equiv="refresh" content="0;url=...">` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `meta` ごと除去され、`removed` に含まれる（公開ページに自動遷移を仕込めないようにする） |
| TC-note-695 | updateNoteBody: `<link rel="stylesheet" href="...">` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去され、`removed` に含まれる（`ExternalFetchPolicy` を通らない外部取得経路になるため。装飾の保持は `importExternalReferences` による `<style>` へのインライン化で代替する） |
| TC-note-696 | updateNoteBody: 同上 — 保存後の本文を調べる | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去した位置に空の `<style data-stylesheet-href="元の URL">` が残る（カスケード順を保つため。[domains/note.md](../domains/note.md) の `HtmlProcessor`） |
| TC-note-697 | updateNoteBody: 同上 — `importReferences: true` で保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 痕跡が `extractExternalReferences` に外部参照として現れるため、参照取り込みジョブが登録される（手順 8 の登録条件を満たす） |
| TC-note-698 | updateNoteBody: 同上 — `importReferences: false` で保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | **痕跡はそのまま残る**（`data-stylesheet-href` のまま。要素ごと落としも属性の付け替えもしない）。ジョブは登録されないので装飾は当たらない |
| TC-note-699 | updateNoteBody: `importReferences: false` で保存した本文 — あとで `importReferences: true` で保存し直す | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 残っていた痕跡が抽出に現れ、参照取り込みジョブが登録される（取り込み直せる） |
| TC-note-700 | updateNoteBody: `importReferences` を省略する — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 既定の真として扱われ、取り込む場合と同じ結果になる |
| TC-note-701 | updateNoteBody: 取り込み済みの痕跡（`<style data-imported-stylesheet="...">…CSS…</style>`）を含む本文 — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 痕跡はそのまま残り、`extractExternalReferences` には現れない。したがって参照取り込みジョブは登録されない（`data-stylesheet-href` だけが抽出対象） |
| TC-note-702 | updateNoteBody: 取得できなかった痕跡（`<style data-stylesheet-unavailable="...">`）を含む本文 — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 同じく残り、抽出にも現れない（再登録ループを起こさない） |
| TC-note-703 | updateNoteBody: `template` 要素を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去され、`removed` に含まれる（内容がパースされずに保持され、後段の走査とサニタイズの見え方がずれるため） |
| TC-note-704 | updateNoteBody: 許可リストにない未知の要素・属性を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 列挙にないものはすべて除去される（許可リスト方式のため、非許可の列挙に載っていなくても残らない） |
| TC-note-705 | updateNoteBody: `<style>` に `position: fixed` の宣言を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | その宣言だけが除去され、`removed` に CSS 由来の除去として含まれる。同じ規則の他の宣言と、`style` 要素そのものは残る（宣言単位で落とす。要素ごと捨てると 1 つの違反で本文全体の装飾が消える） |
| TC-note-706 | updateNoteBody: `<style>` に `@import url(...)` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | その規則だけが除去され、`removed` に含まれる（`ExternalFetchPolicy` を通らない外部取得経路であり、`ExternalReference` の属性ベースの抽出にも乗らないため） |
| TC-note-707 | updateNoteBody: `style` 属性に `position: fixed` を指定した HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 同じくその宣言だけが除去され、他の宣言は残る |
| TC-note-708 | updateNoteBody: `position: sticky`（およびベンダー接頭辞付きの同義の指定） — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 同じく除去される（ビューポート基準の配置を許さない） |
| TC-note-709 | updateNoteBody: `position: absolute` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去されずに残る（本文のホスト要素を包含ブロックにすることで、絶対配置の基準を本文の内側に閉じられるため） |
| TC-note-710 | updateNoteBody: `<style>` と `style` 属性を含み、非許可の宣言がない HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | どちらもそのまま残る（ADR 007 の `preserve` モードが装飾の保持のために必要とするため、全面禁止にはしない） |
| TC-note-711 | updateNoteBody: `data:image/png;base64,...` を `img` の `src` に指定した HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 残る（リソース参照の `data:` はラスタ画像の MIME に限って許可される） |
| TC-note-712 | updateNoteBody: `data:text/html,...` / `data:image/svg+xml,...` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去される（どちらもスクリプトを運べるため） |
| TC-note-713 | updateNoteBody: `data:` の URL を `a` の `href`（ナビゲーション）に指定した HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去される（`data:` を許可するのはリソース参照のみ） |
| TC-note-714 | updateNoteBody: 見出し・段落・リスト・表・`details` / `figure` / ルビなど、許可リストの内側の文書要素だけからなる HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去されずにそのまま保存され、`removed` が空になる |
| TC-note-715 | updateNoteBody: `class` / `id` / `data-*` / `aria-*` を持つ HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | いずれも残る（スクリプトのない環境では不活性で、取り込んだ装飾のセレクタが依存するため） |
| TC-note-716 | updateNoteBody: `autofocus` のように振る舞いを持つグローバル属性 — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 除去される（不活性な属性だけを許可する線引き） |
| TC-note-717 | updateNoteBody: `<a target="_blank">` を含む HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `rel="noopener noreferrer"` が付与された形に正規化される（`window.opener` 経由で遷移元を書き換えられる経路を残さない） |
| TC-note-718 | updateNoteBody: `script` / `foreignObject` / 外部を指す `href` を含むインライン `<svg>` — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `svg` の描画要素の部分集合だけが残り、それらは除去される（本文中のインライン `svg` と保管する SVG ファイルで同じ部分集合を使う） |
| TC-note-719 | updateNoteBody: 除去が複数の分類にまたがる HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `removed` に要素・属性・URL スキーム・CSS 由来の除去がそれぞれ分類つきで積まれ、画面が分類ごとに畳める形で返る |
| TC-note-720 | updateNoteBody: 壊れた HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 補正された結果が保存され、例外にならない |
| TC-note-721 | updateNoteBody: サニタイズ後が 800,000 バイトを超える — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `BusinessRuleError(ContentTooLarge)` が投げられる |
| TC-note-722 | updateNoteBody: サニタイズ後がちょうど 800,000 バイト — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 保存できる（境界値。上限は D1 の行サイズ 2,000,000 バイトから逆算した値） |
| TC-note-723 | updateNoteBody: 見出しが 200 件を超える HTML — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 先頭 200 件だけが `headings` に残り、超過分は捨てられる（本文の保存自体は成功する） |
| TC-note-724 | updateNoteBody: サニタイズ前が 2 MB を超える — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `ValidationError` が投げられる（転送境界での制限） |
| TC-note-725 | updateNoteBody: 版が 20 件ある — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 最古の版が削除され、20 件が保たれる |
| TC-note-726 | updateNoteBody: viewer である — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-727 | updateNoteBody: ゴミ箱のノート — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `BusinessRuleError(NoteIsTrashed)` が投げられる |
| TC-note-728 | updateNoteBody: 実行中の変換ジョブがある — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `BusinessRuleError(NoteLockedByJob)` が投げられる |
| TC-note-729 | updateNoteBody: 実行中の再生成ジョブがある（本文は `ready` のまま） — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `BusinessRuleError(NoteLockedByJob)` が投げられる |
| TC-note-730 | updateNoteBody: 終端した変換・再生成ジョブしかない — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 成功する（実行中のジョブだけが編集を拒む） |
| TC-note-731 | updateNoteBody: 他者が先に更新した — 古い `expectedVersion` で保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |
| TC-note-732 | updateNoteBody: 保存時に除名されている — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-733 | updateNoteBody: 新しい外部参照を含み `importReferences: true` — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 参照取り込みジョブが登録され、`referenceImportJobId` が返る |
| TC-note-734 | updateNoteBody: 外部参照がなく `importReferences: true` — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | ジョブは登録されず、`referenceImportJobId: null` が返る |
| TC-note-735 | updateNoteBody: 取り込み済みで、本文の参照がすべてサービス内のストレージを指す — `importReferences: true` で保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | ジョブは登録されない。`extractExternalReferences` は内部の URL も返すため、`StorageUrlPolicy.isInternal` で絞ってから件数を判定する（絞らないと取り込むものがないのに保存のたびにジョブが登録される） |
| TC-note-736 | updateNoteBody: 同じノートに未終端の `referenceImport` ジョブがある — 新しい外部参照を含む本文を `importReferences: true` で保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 保存は成功し、新しいジョブは登録されず、既存の `referenceImportJobId` が返る（自動保存の間隔ごとにジョブが増えない） |
| TC-note-737 | updateNoteBody: 同上 — 例外の有無を確認する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `BusinessRuleError(DuplicateJob)` は投げない。`JobConcurrencyPolicy.ensureNoDuplicate` は使わず、`listActiveByTarget` の結果を `kind` で絞るだけである（重複は利用者の誤りではなく自動保存の副作用なので、保存を失敗させない） |
| TC-note-738 | updateNoteBody: 同じノートの `referenceImport` ジョブが終端している — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 新しいジョブが登録される（未終端のものだけが重複とみなされる） |
| TC-note-739 | updateNoteBody: 個人所有のノートで参照取り込みジョブが登録された — ジョブの `scope` を確認する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る |
| TC-note-740 | updateNoteBody: 参加ワークスペース所有のノートを他のメンバーが編集して参照取り込みジョブが登録された — ジョブの `scope` を確認する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | `{ type: "workspace", workspaceId }` が入る（基準は所有者であり、`createdBy` でも編集した `userId` でもない） |
| TC-note-741 | updateNoteBody: `reason: "wysiwygConversion"` — 保存する | spec/testcases/note/updateNoteBody.md#テストケース-updatenotebody | 版の記録理由が `wysiwygConversion` になる |
| TC-note-742 | verifySharePassword: パスワード保護された限定公開ノート — 正しいパスワードを送る | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | 通過証が返り、`passwordUpdatedAt` がノート側と一致する |
| TC-note-743 | verifySharePassword: — — 誤ったパスワードを送る | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `ValidationError("INVALID_SHARE_PASSWORD")` が投げられる |
| TC-note-744 | verifySharePassword: 連続して失敗している — 再度失敗する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `ValidationError("THROTTLED")` が投げられる（待機とロックを畳んでいる） |
| TC-note-745 | verifySharePassword: — — レート制限の鍵を確認する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `LoginAttemptKey.forSharePassword(tokenHash, clientKey)` で `share:{共有トークンのハッシュ}:{clientKey}` の形に組み立てられる。材料は `TokenHash` であり、素の共有トークンを鍵に残さない |
| TC-note-746 | verifySharePassword: — — 判定と記録の順序を確認する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `signInWithPassword` と同じ順序（`LoginAttemptStore.get` →（`null` なら `initial`）→ `LoginThrottlePolicy.evaluate` → 失敗なら `recordFailure` / 成功なら `clear`）に従う |
| TC-note-747 | verifySharePassword: 照合に失敗した — 記録を確認する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `LoginAttemptStore.recordFailure(key, now, attemptTtlMs)` が呼ばれ、TTL は 24 時間になる。戻り値は加算後の `LoginAttempt` |
| TC-note-748 | verifySharePassword: 同じ鍵に対して失敗が並行して 10 件届く — すべて処理する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `failureCount` が 10 になる（1 件も取りこぼさない）。加算が原子的でないと、要求を並列化するだけで施錠を回避できる |
| TC-note-749 | verifySharePassword: 加算後の記録がしきい値に達した — 応答を確認する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | 返ってきた加算後の値を `evaluate` し、待機・ロックに当たるなら `THROTTLED` に切り替える（ロックも同じコードに畳む） |
| TC-note-750 | verifySharePassword: 照合に成功した — 記録を確認する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `LoginAttemptStore.clear(key)` が呼ばれる |
| TC-note-751 | verifySharePassword: 同じ共有リンクに別の `clientKey` から失敗する — 照合する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | 鍵が異なるため別の行になり、互いの待機・ロックに影響しない |
| TC-note-752 | verifySharePassword: 同じ端末が別の共有リンクで失敗している — 照合する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `tokenHash` が異なるため別の行になる |
| TC-note-753 | verifySharePassword: 同じ利用者がパスワードサインインで失敗している — 照合する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | 名前空間が `share:` と `signIn:` で分かれているため同じ行に集まらず、互いのロックを誘発しない |
| TC-note-754 | verifySharePassword: 待機中・ロック中と判定された — 照合する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `PasswordHasher.verify` に進まずに `THROTTLED` を返す（ロック中も同じコード。閲覧者に解除のための次の一手がないため区別しない） |
| TC-note-755 | verifySharePassword: `LoginAttemptStore` への書き込み — トランザクションの境界を確認する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `signInWithPassword` と同じく Unit of Work には入れない。書き込みの失敗は記録して継続し、照合の結果は変えない |
| TC-note-756 | verifySharePassword: パスワードが設定されていない限定公開ノート — 照合する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-757 | verifySharePassword: 存在しない共有トークン — 照合する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-note-758 | verifySharePassword: 通過証を取得した後に所有者がパスワードを変更した — その通過証で閲覧する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | 再度パスワードが求められる |
| TC-note-759 | verifySharePassword: 通過証を取得した後に所有者がパスワードを解除した — その通過証で閲覧する | spec/testcases/note/verifySharePassword.md#テストケース-verifysharepassword | パスワードなしで閲覧できる |
| TC-storage-001 | collectExpiredArtifacts: 期限が過ぎた PDF がある — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 削除され、`collectedCount` に数えられる |
| TC-storage-002 | collectExpiredArtifacts: 期限が過ぎた PDF がある — 実行後にイベントを確認する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | `deleteFiles` と同じ手順を通るため、件ごとに `storage.fileDeleted`（`objectKey` を含む）が発行される |
| TC-storage-003 | collectExpiredArtifacts: `storage.fileDeleted` が発行された — 購読側を確認する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 実体の回収は `deleteStoredObjects` が行う（本ユースケースはオブジェクトストレージを直接触らない） |
| TC-storage-004 | collectExpiredArtifacts: 回収の前後 — 使用量を確認する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 容量クォータは変化しない（`artifact` はクォータに算入しないため `applyStorageDelta` の減算対象外） |
| TC-storage-005 | collectExpiredArtifacts: `uploadedBy: null` の匿名 PDF の artifact の期限が過ぎている — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 通常の artifact と同じく回収される（要求者が存在しなくても対象になる） |
| TC-storage-006 | collectExpiredArtifacts: 一括ダウンロードの ZIP（`noteId: null` / `noteVersion: null`）の期限が過ぎている — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 回収される |
| TC-storage-007 | collectExpiredArtifacts: 一部の削除が失敗する — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 個々の失敗は記録して残りの回収を続ける |
| TC-storage-008 | collectExpiredArtifacts: 期限内の PDF がある — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 削除されない |
| TC-storage-009 | collectExpiredArtifacts: 期限のちょうど 1 ミリ秒前 — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 削除されない（境界値） |
| TC-storage-010 | collectExpiredArtifacts: 対象が `limit` を超える — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | `limit` 件だけ削除される |
| TC-storage-011 | collectExpiredArtifacts: 対象が `limit` を超える — Alarm設定を確認する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 同じscopeのtaskが直後へ再設定され、残件がなくなると次の `expiresAt` に合う |
| TC-storage-012 | collectExpiredArtifacts: 最初のephemeral fileを登録する — taskを確認する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 当該scopeだけに期限回収taskが作られ、global Cronはscopeを列挙しない |
| TC-storage-013 | collectExpiredArtifacts: `persistent` のファイルがある — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 対象にならない |
| TC-storage-014 | collectExpiredArtifacts: 対象が 0 件 — 実行する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | `collectedCount: 0` が返る |
| TC-storage-015 | collectExpiredArtifacts: 削除後 — 履歴を確認する | spec/testcases/storage/collectExpiredArtifacts.md#テストケース-collectexpiredartifacts | 生成物が「期限切れ」として表示される |
| TC-storage-016 | collectOrphanMedia: 作成から 31 日が経過し、本文から参照されていないメディア — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 削除される |
| TC-storage-017 | collectOrphanMedia: 作成から 31 日が経過しているが、本文から参照されているメディア — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 削除されない（2 条件の AND） |
| TC-storage-018 | collectOrphanMedia: 作成から 29 日で、本文から参照されていないメディア — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 削除されない（境界値。参照が外れた時刻ではなく作成時刻で判定する） |
| TC-storage-019 | collectOrphanMedia: 作成からちょうど 30 日のメディア — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 走査の起点（`now - 30 日`）に含まれる（境界値） |
| TC-storage-020 | collectOrphanMedia: 走査の方法を確認する — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 所有者を絞らない全体走査のため `listByPurposeOlderThan("media", now - 30 日, limit)` を使う（所有者を必須とする `listByOwner` は使わない） |
| TC-storage-021 | collectOrphanMedia: 走査対象のメディア — 所属ノートの解決方法を確認する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | `FileProvenance.noteId`（`media` では必須）からノートを引き、`HtmlProcessor.extractExternalReferences` で本文に URL が現れるかを調べる。本文の逆引きで所属を探すことはしない |
| TC-storage-022 | collectOrphanMedia: `noteId` の指す所属ノートが既に削除済みのメディア — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 削除対象として扱う |
| TC-storage-023 | collectOrphanMedia: 所属ノート（`noteId`）の本文からは参照が外れているが、別のノートの本文が同じ URL を参照している — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 判定は所属ノートの本文だけで行うため削除される |
| TC-storage-024 | collectOrphanMedia: `purpose` が `media` でないファイル — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 対象にならない（走査は `media` に限る） |
| TC-storage-025 | collectOrphanMedia: 対象が `limit` を超える — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | `limit` 件だけ削除される |
| TC-storage-026 | collectOrphanMedia: scopeに最初のmediaを登録する — taskを確認する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 当該scopeの日次taskが自己登録される |
| TC-storage-027 | collectOrphanMedia: 対象が `limit` を超える — Alarm設定を確認する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 残件用taskを直後に設定し、完了後は翌日へ戻る |
| TC-storage-028 | collectOrphanMedia: 1 件の削除が失敗する — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | 記録して継続する |
| TC-storage-029 | collectOrphanMedia: 対象が 0 件 — 実行する | spec/testcases/storage/collectOrphanMedia.md#テストケース-collectorphanmedia | `collectedCount: 0` が返る |
| TC-storage-030 | deleteFiles: 3 件のファイルがある — まとめて削除する | spec/testcases/storage/deleteFiles.md#テストケース-deletefiles | メタデータが削除され、`storage.fileDeleted` が 3 件発行される |
| TC-storage-031 | deleteFiles: 一部が既に削除済み — 削除する | spec/testcases/storage/deleteFiles.md#テストケース-deletefiles | 無視して継続し、残りが削除される |
| TC-storage-032 | deleteFiles: 空の配列を渡す — 削除する | spec/testcases/storage/deleteFiles.md#テストケース-deletefiles | `deletedCount: 0` が返る |
| TC-storage-033 | deleteFiles: 削除後 — 使用量を確認する | spec/testcases/storage/deleteFiles.md#テストケース-deletefiles | 保存容量が減っている |
| TC-storage-034 | deleteFiles: 削除後 — オブジェクトストレージを確認する | spec/testcases/storage/deleteFiles.md#テストケース-deletefiles | 実体は `storage.fileDeleted` を購読する `deleteStoredObjects` が削除する（メタデータの削除と同一トランザクションにできないため後追いになる） |
| TC-storage-035 | deleteFiles: 発行した `storage.fileDeleted` — payload を確認する | spec/testcases/storage/deleteFiles.md#テストケース-deletefiles | `objectKey` を含む（購読側がファイルの行を引き直さずに実体を消せるようにするため） |
| TC-storage-036 | deleteFiles: 同じファイル ID を 2 回削除する — 2 回実行する | spec/testcases/storage/deleteFiles.md#テストケース-deletefiles | 二重に減算されない |
| TC-storage-037 | deleteFilesByOwner: 利用者が 120 件のファイルを持ち `batchSize: 50` — 実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 50 件を削除して同じscopeのcontinuation taskを1件だけ積み、次のAlarm turnで続ける |
| TC-storage-038 | deleteFilesByOwner: 対象が `batchSize`（既定 100 件）ちょうど — 実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 全件が削除され、継続要求は積まれない（境界値） |
| TC-storage-039 | deleteFilesByOwner: 継続が要る — 積まれたイベントを確認する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | `deletionOperationId`を保持した購読者1件の`storage.ownerDeleteContinued`だけを積み、受け取った削除eventは再投入しない |
| TC-storage-040 | deleteFilesByOwner: 継続要求を受け取る — 処理する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 残っているものを先頭から `batchSize` 件読んで続きを削除する（カーソルは持たない） |
| TC-storage-041 | deleteFilesByOwner: 対象が残っているのにそのバッチで 1 件も削除できなかった — 実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 継続要求を積まず、失敗として返る（キューの再試行と DLQ に委ねる） |
| TC-storage-042 | deleteFilesByOwner: 継続要求が重複配送され 2 系列が並走する — 実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 両系列とも「残っているものを読んで消す」だけなので結果は変わらず、対象が 0 件になった系列から順に継続をやめる |
| TC-storage-043 | deleteFilesByOwner: 1 バッチを処理する — 件数に比例した往復を要求しないことを確認する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 列挙は 1 回だけ。削除できたファイル 1 件につき `storage.fileDeleted` が 1 件。どちらも `batchSize` の件数に比例した追加の往復を要求しない（バックエンドが発行する文の数はここでは約束しない — [ADR 056](../adr/056-performance-budget-placement.md)） |
| TC-storage-044 | deleteFilesByOwner: `deleteNotesForOwner` の継続 — 形を比べる | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 同一である（1 バッチ処理して残りがあれば専用の継続要求を 1 件積む） |
| TC-storage-045 | deleteFilesByOwner: ワークスペースのファイルがある — ワークスペースを対象に実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | そのワークスペースのファイルだけが削除される |
| TC-storage-046 | deleteFilesByOwner: 対象が 0 件 — 実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | `deletedCount: 0` が返る |
| TC-storage-047 | deleteFilesByOwner: 1 件の削除が失敗する — 実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 記録して継続する |
| TC-storage-048 | deleteFilesByOwner: 同じ要求を 2 回実行する — 2 回実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 結果が変わらない |
| TC-storage-049 | deleteFilesByOwner: アイコンや生成物も所有している — 実行する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 用途によらずすべて削除される |
| TC-storage-050 | deleteFilesByOwner: 実行後 — 発行されたイベントを確認する | spec/testcases/storage/deleteFilesByOwner.md#テストケース-deletefilesbyowner | 1 件ごとに `storage.fileDeleted` が発行される（所有者単位の一括削除メソッドは持たず、`listByOwner` + `deleteFiles` の反復で行い、Usage の減算と実体の回収を 1 件ずつつなぐ） |
| TC-storage-051 | deleteFilesForNote: 元ファイル 1 件・メディア 2 件・取り込んだ外部参照 1 件を持つノートが完全削除された — `note.purged` を処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | 4 件すべてのメタデータが削除され、1 件ごとに `storage.fileDeleted` が発行され、`deletedCount: 4` が返る |
| TC-storage-052 | deleteFilesForNote: 同じノート由来の artifact（PDF エクスポートの生成物）もある — `note.purged` を処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | artifact は削除の対象にならず残る（期限の経過時に `collectExpiredArtifacts` が回収する） |
| TC-storage-053 | deleteFilesForNote: 他のノートのメディアがある — `note.purged` を処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | `listByNote(noteId)` に現れないため削除されない |
| TC-storage-054 | deleteFilesForNote: 所有者のアイコン（`purpose: "avatar"`）がある — `note.purged` を処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | ノートに属さない（`noteId: null`）ため削除されない |
| TC-storage-055 | deleteFilesForNote: 削除後 — 使用量を確認する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | `storage.fileDeleted` を購読する `applyStorageDelta` によって保存容量が返る |
| TC-storage-056 | deleteFilesForNote: 削除後 — オブジェクトストレージを確認する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | 実体は `storage.fileDeleted` を購読する `deleteStoredObjects` が削除する |
| TC-storage-057 | deleteFilesForNote: 対象のファイルが 1 件もない（元ファイルのないノート） — `note.purged` を処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | 何もせず成功し、`deletedCount: 0` が返る |
| TC-storage-058 | deleteFilesForNote: deletable fileが250件ある — 処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | 100件ずつ`storage.noteDeleteContinued`で再開し、各taskが同じ`deletionOperationId`を保持する |
| TC-storage-059 | deleteFilesForNote: personal account deletion由来のtoken — 処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | personal scopeのcommit済み`applied_operations` receiptと照合して通し、workspace専用portを要求しない |
| TC-storage-060 | deleteFilesForNote: workspace deletion由来の別operation ID — 処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | manifest owner不一致として削除を拒否する |
| TC-storage-061 | deleteFilesForNote: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | 削除済みのファイルは `listByNote` に現れず、2 回目は `deletedCount: 0` で終わる（冪等） |
| TC-storage-062 | deleteFilesForNote: 一部のファイルが既に不在 — 処理する | spec/testcases/storage/deleteFilesForNote.md#テストケース-deletefilesfornote | 無視して継続し、残りが削除される |
| TC-storage-063 | deleteStoredObjects: `storage.fileDeleted` を 3 件まとめて受け取る — 処理する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | `ObjectStorage.deleteMany` が 3 件の `objectKey` で呼ばれ、`deletedCount: 3` が返る |
| TC-storage-064 | deleteStoredObjects: 受け取ったイベント — 鍵の解決方法を確認する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | イベントの `objectKey` をそのまま使い、`StoredFileRepository` を引き直さない（メタデータは既に削除済みのため引けない） |
| TC-storage-065 | deleteStoredObjects: 実体が既に存在しない鍵 — 処理する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | 成功として扱われ、`failed` に積まれない |
| TC-storage-066 | deleteStoredObjects: 3 件のうち 1 件の削除が失敗する — 処理する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | 失敗した鍵が `failed` に積まれ、残り 2 件の削除は続き、`deletedCount: 2` が返る |
| TC-storage-067 | deleteStoredObjects: 1 件でも失敗が残った — 処理後の扱いを確認する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | イベントを未処理として返し、再配送に委ねる（次の配送で残りの鍵を消し直す） |
| TC-storage-068 | deleteStoredObjects: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | 2 回目は鍵が既にないため成功として扱われ、結果は変わらない（鍵を指定した削除は本質的に冪等） |
| TC-storage-069 | deleteStoredObjects: 重複配送の扱い — `IdempotencyStore` の利用を確認する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | `markProcessed` を呼ばない（`applyStorageDelta` のような加算・減算を伴う購読者とは事情が異なる） |
| TC-storage-070 | deleteStoredObjects: 削除に失敗したイベントが再配送される — 処理する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | 処理済みの記録がないため弾かれず、再試行できる（外部ストレージへの書き込みは UoW に入れられないため、先に記録すると実体が永久に残る） |
| TC-storage-071 | deleteStoredObjects: 削除に失敗し続けた実体 — オブジェクトストレージを確認する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | 孤児オブジェクトとして残るが、メタデータが存在せず参照されないため害はない |
| TC-storage-072 | deleteStoredObjects: オブジェクトストレージの通信・権限が失敗する — 処理する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | `SystemError(ExternalServiceError)` が投げられ、再配送に委ねられる |
| TC-storage-073 | deleteStoredObjects: イベントが 0 件 — 処理する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | `deletedCount: 0` が返り、`ObjectStorage.deleteMany` を呼ばない |
| TC-storage-074 | deleteStoredObjects: 同じ `storage.fileDeleted` を `applyStorageDelta` も購読している — 本ユースケースが未処理として返した後に再配送される | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | 重複排除は `(consumer, eventId)` 単位のため、`applyStorageDelta` 側は処理済みとして弾かれ、容量が二重に減らない |
| TC-storage-075 | deleteStoredObjects: `deleteFiles` / `deleteFilesForNote` / `deleteFilesByOwner` / `collectExpiredArtifacts` が削除した — 実体の回収経路を確認する | spec/testcases/storage/deleteStoredObjects.md#テストケース-deletestoredobjects | いずれも `storage.fileDeleted` を発行するだけで、実体の削除は本ユースケースに委ねられる |
| TC-storage-076 | importExternalReferences: 外部画像を 3 件参照する `queued` のジョブ — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `Job.start` で `running` になり、参照の件数（3）が `total` に入り、3 件が保管され、本文の参照先が差し替わって `succeeded` になる |
| TC-storage-077 | importExternalReferences: 参照を集め終えた — `Job.start` の呼び出しを確認する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `Job.start(job, total, now, leaseUntil)` の 4 引数で呼ばれ、`total` は本文から集めた参照の件数、`leaseExpiresAt` は `leaseUntil` になる（他の run 系と同じ骨格） |
| TC-storage-078 | importExternalReferences: 取り込みに成功した — 保管記録を確認する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `purpose: "reference"`、対象の `noteId`、`uploadedBy: userId` が入っている |
| TC-storage-079 | importExternalReferences: 既に `succeeded` のジョブ — 再度実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 何もせず終わる（run 系の共通規則） |
| TC-storage-080 | importExternalReferences: 既に `failed` のジョブ — 再度実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 何もせず終わる（終端状態） |
| TC-storage-081 | importExternalReferences: ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） — 配送で受け取る | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 何もせず成功として返る（判定 1・2 は先頭で行うため、`Job.start` の後ろ倒しの影響を受けない） |
| TC-storage-082 | importExternalReferences: リースが有効な `running` のジョブ — 再配送で受け取る | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 何もせず終わる（他のワーカーが実行中） |
| TC-storage-083 | importExternalReferences: リースが失効した `running` のジョブ — 再配送で受け取る | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 引き継いで再開し、`attempts` が加算され、`progress` が集め直した参照件数で作り直される |
| TC-storage-084 | importExternalReferences: リース失効の引き継ぎで `attempts` が上限を超える — 再配送で受け取る | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 再開せず `failed("timeout")` になり、手動 `retry` の余地が残る |
| TC-storage-085 | importExternalReferences: 対象ノートが削除済み — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `Job.fail("targetMissing")` になる |
| TC-storage-086 | importExternalReferences: 参照が 0 件の本文 — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 何も取り込まず、`total: 0` で `succeeded` に終端する |
| TC-storage-087 | importExternalReferences: 取り込みに時間がかかる — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `Job.reportProgress` で進捗が更新され、リースが延長される |
| TC-storage-088 | importExternalReferences: 404 を返すリソース参照がある — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | その参照は元の URL のまま残り、`failed` に `kind: "resource"` として記録される |
| TC-storage-089 | importExternalReferences: タイムアウトするリソース参照がある — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 元の URL のまま残り、記録される |
| TC-storage-090 | importExternalReferences: 内部アドレスを指す参照がある — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 取得されず、記録される |
| TC-storage-091 | importExternalReferences: ループバックアドレスを指す参照がある — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 取得されず、記録される |
| TC-storage-092 | importExternalReferences: 既にサービス内のストレージを指すリソース参照 — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 差し替えられず `skipped` に数えられる |
| TC-storage-093 | importExternalReferences: リソース参照が 201 件ある — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 200 件まで取り込まれ、以降は打ち切られる |
| TC-storage-094 | importExternalReferences: 合計 101 MB になる参照がある — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 上限に達した時点で打ち切られ、成功として返る |
| TC-storage-095 | importExternalReferences: 相対パスの参照がある — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 同時にアップロードされたファイル群から解決を試み、見つからなければ残る |
| TC-storage-096 | importExternalReferences: 本文が `ready` でない — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 参照は 0 件として扱われ、何も取り込まず `succeeded` に終端する |
| TC-storage-097 | importExternalReferences: 本文の保存が競合する — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 1 度読み直して再適用する |
| TC-storage-098 | importExternalReferences: 再適用しても競合する — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `ConflictError` が投げられる |
| TC-storage-099 | importExternalReferences: 同じジョブを 2 回実行する — 2 回実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 2 回目は終端状態として何もせず終わり、結果が変わらない（仮に再実行されても差し替え済みの参照は `skipped` になる） |
| TC-storage-100 | importExternalReferences: 外部スタイルシートの痕跡（`<style data-stylesheet-href="https://…/theme.css">`）を 1 件持つ本文 — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `extractExternalReferences` が `{ url, attribute: "data-stylesheet-href", elementName: "style" }` として他の外部参照と同じ形で返し、`total` に 1 件として数えられる |
| TC-storage-101 | importExternalReferences: 痕跡の CSS の取得に成功する — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `inlineStylesheets` が取得した CSS を痕跡の中身として書き戻し、**属性が `data-imported-stylesheet` に付け替わる**。`inlinedStylesheetCount` が 1 増える。`ObjectStorage.put` も `StoredFile.register` も呼ばれず、`purpose: "reference"` の保管ファイルは作られない |
| TC-storage-102 | importExternalReferences: 痕跡の CSS の取得に成功する — 本文の要素の並びを確認する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `<style>` は元の `<link>` があった位置に残る（カスケード順が `<link>` の並びに依存するため） |
| TC-storage-103 | importExternalReferences: 取り込みに成功した本文を再度保存する — `updateNoteBody` を呼ぶ | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `data-imported-stylesheet` は `extractExternalReferences` の抽出対象ではないため外部参照として現れず、同じ参照取り込みジョブが登録され続けない |
| TC-storage-104 | importExternalReferences: 痕跡の CSS が 404 を返す — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `failed` に `{ url, kind: "stylesheet", reason }` として記録され、`inlineStylesheets` が痕跡の**属性を `data-stylesheet-unavailable` に付け替えて空のまま残す**。要素ごと取り除きはしない（装飾を失った事実の唯一の記録になるため）。元の URL を `<link>` として戻すこともしない |
| TC-storage-105 | importExternalReferences: 痕跡の CSS がタイムアウトする / 内部アドレスを指す — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 同じく `kind: "stylesheet"` として記録され、痕跡が `data-stylesheet-unavailable` になる（その装飾は失われる） |
| TC-storage-106 | importExternalReferences: 痕跡の CSS の取得に失敗した本文を再度保存する — `updateNoteBody` を呼ぶ | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `data-stylesheet-unavailable` は抽出対象ではないため外部参照として現れず、同じ参照取り込みジョブが登録され続けない |
| TC-storage-107 | importExternalReferences: 取得した CSS が `position: fixed` / `position: sticky` を含む — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 手順 7 の `HtmlProcessor.process` がその宣言だけを落とし、残りの宣言はインライン化されたまま本文に入る。落ちた宣言は `removed`（`kind: "css"`）に現れ、**プロパティ名ごとに件数へ畳んで `ReferenceImportSummary.removedCss` に書かれる**（ジョブの `detail` には書かない。`detail` は運用者向けであり、成功したジョブは `failure` を持たない） |
| TC-storage-108 | importExternalReferences: 取得した CSS が `@import url(...)` を含む — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | その規則だけが除去され、`@import` 先は取得も保管もされない。残りの規則は本文に入り、成功として扱われる |
| TC-storage-109 | importExternalReferences: 1 件の違反を含む CSS を取り込む — 本文の装飾を確認する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 違反した宣言・規則だけが落ち、そのスタイルシート全体も本文全体の装飾も捨てられない |
| TC-storage-110 | importExternalReferences: 取得した CSS が `url(./bg.png)` のような相対 URL を含む — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 取得元のスタイルシートの URL（`finalUrl` を含む取得元）を基準に絶対 URL へ解決してから書き戻される（インライン化で相対 URL の基準が本文の文書へ移るため） |
| TC-storage-111 | importExternalReferences: 取得した CSS が背景画像・フォントを `url()` で参照する — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 絶対 URL に解決されるだけで取得も保管も差し替えもされず、外部 URL のまま残る（`ExternalReference` が属性ベースで宣言値の中を指せないため）。件数・合計サイズの予算にも数えない |
| TC-storage-112 | importExternalReferences: 外部スタイルシートを持つ本文（変換時点で `styleMode: "preserve"`） — 取り込みに成功する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `styleMode` は `preserve` のまま変わらない（`Note.updateBody` は `content` だけを更新し、手順 7 の `hasDecoration` は使わない） |
| TC-storage-113 | importExternalReferences: 外部スタイルシートを持つ本文で、スタイルシートの取得にすべて失敗する — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 装飾が何も残らなくても `styleMode` は `preserve` のままで、既定スタイルは自動で当て直されない（利用者が `changeStyleMode` で `default` にできる） |
| TC-storage-114 | importExternalReferences: 利用者が `changeStyleMode` で `default` にしたノート — 取り込みに成功する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `default` のまま押し戻されない |
| TC-storage-115 | importExternalReferences: 既にサービス内のストレージを指す URL の痕跡 — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `skipped` にはせず取得へ進む（飛ばしても本文に空の `<style>` が残るだけで装飾にならないため） |
| TC-storage-116 | importExternalReferences: 外部画像 2 件と外部スタイルシート 1 件を持つ本文 — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `total` が 3 になり、画像は保管して `rewriteReferences` で差し替え、スタイルシートは `inlineStylesheets` でインライン化される。`importedCount: 2`, `inlinedStylesheetCount: 1` になる |
| TC-storage-117 | importExternalReferences: 予算（`maxCount` / `maxTotalBytes`）を使い切ったあとに痕跡が残っている — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | その痕跡は取得に至らないまま `data-stylesheet-unavailable` になり、成功として返る（取得に失敗した場合と同じ扱い。抽出対象から外れるので決着しない参照が残らない） |
| TC-storage-118 | importExternalReferences: 取り込みを実行した — 取得記録を確認する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 扱った参照 1 件につき `ReferenceAttempt` が 1 件書かれる。成功したリソースは `imported`（`fileId` つき）、成功したスタイルシートは `inlined`、失敗は `failed`（`reason` つき）、予算超過で試行しなかったものは `notAttempted` |
| TC-storage-119 | importExternalReferences: 取り込みを実行した — 保存の単位を確認する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 本文の保存・取得記録の書き込み・`Job.succeed` が同一の `UnitOfWorkProvider.run` で確定する |
| TC-storage-120 | importExternalReferences: 前回の実行で `failed` を記録した URL が、今回の実行の対象に含まれない — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | その行は消えない（`saveAttempts` は今回扱った `(noteId, url)` だけを上書きする。前回の理由が失われてはならない） |
| TC-storage-121 | importExternalReferences: 取り込みを実行した — `Job.succeed` の引数を確認する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | `notices` は空配列で渡される（取り込みの結果は `notices` に載せない。[ADR 014](../adr/014-import-result-provenance.md)） |
| TC-storage-122 | importExternalReferences: `skipped` の判定を確認する — 実行する | spec/testcases/storage/importExternalReferences.md#テストケース-importexternalreferences | 手順 3 で `StorageUrlPolicy.isInternal` が真の参照は対象から外れる。`extractExternalReferences` はサービス内の URL も返すため、この絞り込みは呼び出し側が行う |
| TC-storage-123 | issueDownloadUrl: 自分が所有するファイル — URL を発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | 期限つきの URL とファイル名が返る |
| TC-storage-124 | issueDownloadUrl: ワークスペースの viewer — そのワークスペースのファイルの URL を発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | 発行できる（`downloadNote` は viewer に許される） |
| TC-storage-125 | issueDownloadUrl: 非メンバー — URL を発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | `NotFoundError("STORED_FILE_NOT_FOUND")` が投げられる |
| TC-storage-126 | issueDownloadUrl: 期限切れの生成物 — URL を発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | `NotFoundError("ARTIFACT_EXPIRED")` が投げられる |
| TC-storage-127 | issueDownloadUrl: 期限内の生成物 — URL を発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | 発行できる |
| TC-storage-128 | issueDownloadUrl: 存在しないファイル ID — URL を発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | `NotFoundError("STORED_FILE_NOT_FOUND")` が投げられる |
| TC-storage-129 | issueDownloadUrl: 入力storage scopeとfileのscopeが違う — URLを発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | 指定scope以外を探索せず`STORED_FILE_NOT_FOUND` |
| TC-storage-130 | issueDownloadUrl: workspace fileに正しいstorage scopeを添える — URLを発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | その1つのworkspace scopeだけでmembershipを再確認する |
| TC-storage-131 | issueDownloadUrl: 発行された URL — 期限経過後にアクセスする | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | アクセスできない |
| TC-storage-132 | issueDownloadUrl: 匿名の閲覧者が公開ノートの PDF 生成物を取得しようとする — — | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | 本ユースケースは対象にしない（入力に `userId` を要する）。匿名のダウンロードは Note 側の `downloadExportArtifact`（ExportTicket 経由）が担う |
| TC-storage-133 | issueDownloadUrl: 匿名の PDF エクスポートで作られた artifact（`uploadedBy: null`） — 所有者本人が URL を発行する | spec/testcases/storage/issueDownloadUrl.md#テストケース-issuedownloadurl | ノートの所有文脈で所有者判定が通り、発行できる |
| TC-storage-134 | relocateFilesForNote: source/media/referenceを持つNote — `snapshotSource` | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | current source scopeから3件のportable metadataを返し、まだ削除しない |
| TC-storage-135 | relocateFilesForNote: artifactもある — snapshotする | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | artifactは含めずJob scopeに残す |
| TC-storage-136 | relocateFilesForNote: targetをstageする — `stageTarget` | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | 同じR2 object keyを指すmetadataをtarget ownerで登録し、R2 copyを行わない |
| TC-storage-137 | relocateFilesForNote: 同じmigration IDでstageを再実行 — 実行する | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | `applied_operations` により二重metadataを作らない |
| TC-storage-138 | relocateFilesForNote: route switch前にstageが失敗 — 読み取る | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | active routeはsourceのためstaged metadataは利用者から見えない |
| TC-storage-139 | relocateFilesForNote: route switch後 — `retireSource` | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | source metadataを消すがR2 delete eventは出さない |
| TC-storage-140 | relocateFilesForNote: retire応答を失う — 再実行する | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | target参照を保ったまま冪等にsourceだけを掃除する |
| TC-storage-141 | relocateFilesForNote: avatarがある — snapshotする | spec/testcases/storage/relocateFilesForNote.md#テストケース-relocatefilesfornote | Noteに属さないため対象外 |
| TC-storage-142 | startBulkUpload: 対応形式のファイルを 5 件指定する — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 親ジョブが作られ、5 件が `accepted` になる |
| TC-storage-143 | startBulkUpload: 101 件を指定する — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `ValidationError("TOO_MANY_FILES")` が投げられる |
| TC-storage-144 | startBulkUpload: 100 件を指定する — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 成功する（境界値） |
| TC-storage-145 | startBulkUpload: 合計 501 MB を指定する — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `ValidationError("UPLOAD_TOO_LARGE")` が投げられる |
| TC-storage-146 | startBulkUpload: 未対応形式を含む — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | それらは `rejected` に理由つきで入り、他は `accepted` になる |
| TC-storage-147 | startBulkUpload: すべて未対応形式 — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `ValidationError("NO_ACCEPTABLE_FILE")` が投げられる |
| TC-storage-148 | startBulkUpload: 保存容量の残りが足りない — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `BusinessRuleError(StorageQuotaExceeded)` が投げられる |
| TC-storage-149 | startBulkUpload: ワークスペースの viewer — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-storage-150 | startBulkUpload: LLM を要するファイルを含み未連携 — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `llmRequiredCount` と `llmAvailable: false` が返り、受け付けは成功する |
| TC-storage-151 | startBulkUpload: `conversionPreference: "machineOnly"` で LLM を要するファイルを 2 件含む — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `llmRequiredCount: 2` が返り（`conversionPreference` に依らず数える）、「LLM なしでは取り込めない見込みの件数」として警告に使われる。受け付けは成功する |
| TC-storage-152 | startBulkUpload: `conversionPreference: "machineOnly"` で OpenRouter 連携済み — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `llmRequiredCount` は連携の有無で変わらず、`llmAvailable: true` が返る |
| TC-storage-153 | startBulkUpload: 対応形式のファイルを 5 件指定する — 親ジョブの `progress` を確認する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `total: 5`（`accepted` の件数）で作られ、以後 `total` は変わらない |
| TC-storage-154 | startBulkUpload: 親ジョブを作った — `Job.enqueueBatch` の引数と結果を確認する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `kind: "conversion"`、`payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }`、`target: { type: "batch" }` で即 `running` になり、リースが張られる |
| TC-storage-155 | startBulkUpload: 親ジョブを作った — 子（`storeUpload` の変換ジョブ）の `payload` と比べる | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 親と子で同じ `kind` / `payload` になる |
| TC-storage-156 | startBulkUpload: `ownerType: "user"` で開始する — 親ジョブの `scope` を確認する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 取り込み先の所有文脈から `{ type: "user", userId }` が入る |
| TC-storage-157 | startBulkUpload: 参加ワークスペースを取り込み先に指定する（要求者は owner ではないメンバー） — 親ジョブの `scope` を確認する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `{ type: "workspace", workspaceId: ownerWorkspaceId }` が入る（要求者からは導かない） |
| TC-storage-158 | startBulkUpload: 親ジョブを作った — 子（`storeUpload` の変換ジョブ）の `scope` と比べる | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 子も同じ `ownerType` / `ownerWorkspaceId` から導くため親子で一致する |
| TC-storage-159 | startBulkUpload: 取り込み先の所有者を1つだけ受け取る — scopeを確認する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | その所有文脈を親子Jobのscopeに使う。一括ID経路もsource ScopeKeyを必須にする |
| TC-storage-160 | startBulkUpload: `accepted` に変換不能な見込みのファイルを含む — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | それらも `accepted` に含めて `total` に数える（確定判定は `storeUpload` / `runConversion` が行い、子ジョブとして結果が記録される） |
| TC-storage-161 | startBulkUpload: 受け付け後に呼び出し側が `storeUpload` を途中で止めた — 親ジョブを確認する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 子が `total` に届かないためリースが延長されず、`reapExpiredJobs` が `failed("timeout")` として回収する |
| TC-storage-162 | startBulkUpload: ファイルを受け付けた — `accepted` の `format` / `requiresLlm` と `llmRequiredCount` を確認する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 宣言 MIME・拡張子から導いた暫定値である（このユースケースは内容（head）を読まない） |
| TC-storage-163 | startBulkUpload: 暫定判定と内容に基づく判定が食い違うファイル — `storeUpload` まで進める | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 確定判定は `storeUpload` / `runConversion` の `FormatDetector.detect` が行い、暫定値と食い違ってよい |
| TC-storage-164 | startBulkUpload: ハンドル未設定で `visibility: "public"` を指定する — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる |
| TC-storage-165 | startBulkUpload: 音声 200 MB のファイルを含む — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | 受け付けられる（形式別の上限の境界値） |
| TC-storage-166 | startBulkUpload: 音声 201 MB のファイルを含む — 開始する | spec/testcases/storage/startBulkUpload.md#テストケース-startbulkupload | そのファイルが `rejected` になる |
| TC-storage-167 | storeAvatar: 本人 — 自分のアイコンをアップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | 保管され、URL が返る |
| TC-storage-168 | storeAvatar: ワークスペースの owner — ワークスペースのアイコンをアップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | 保管される |
| TC-storage-169 | storeAvatar: ワークスペースの editor — ワークスペースのアイコンをアップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-storage-170 | storeAvatar: 他人の利用者 ID を指定する — アップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-storage-171 | storeAvatar: — — 6 MB の画像をアップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | `BusinessRuleError(FileTooLarge)` が投げられる |
| TC-storage-172 | storeAvatar: — — 5 MB の画像をアップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | 成功する（境界値） |
| TC-storage-173 | storeAvatar: — — GIF をアップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | `BusinessRuleError(UnsupportedMimeType)` が投げられる |
| TC-storage-174 | storeAvatar: 既にアイコンがある — 新しいアイコンをアップロードする | spec/testcases/storage/storeAvatar.md#テストケース-storeavatar | 古いアイコンが削除対象になる |
| TC-storage-175 | storeMedia: 編集できるノート — PNG をアップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | 保管され、配信用の URL が返る |
| TC-storage-176 | storeMedia: — — SVG をアップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `HtmlProcessor.process` と同じ規則でサニタイズされてから保管される（本文中のインライン `svg` と保管する SVG ファイルで同じ部分集合を使う） |
| TC-storage-177 | storeMedia: `script` / `foreignObject` / `on*` 属性 / 外部を指す `href`・`xlink:href` を含む SVG — アップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | それらが除去されたうえで保管され、配信された SVG でスクリプトが実行されない |
| TC-storage-178 | storeMedia: 図形・パス・テキスト・グラデーション・同一文書内を指す `use` だけからなる SVG — アップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | 除去されずにそのまま保管される |
| TC-storage-179 | storeMedia: — — 未対応の形式をアップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `BusinessRuleError(UnsupportedMimeType)` が投げられる |
| TC-storage-180 | storeMedia: — — 21 MB の画像をアップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `BusinessRuleError(FileTooLarge)` が投げられる |
| TC-storage-181 | storeMedia: — — 20 MB の画像をアップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | 成功する（境界値） |
| TC-storage-182 | storeMedia: — — 201 MB の動画をアップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `BusinessRuleError(FileTooLarge)` が投げられる |
| TC-storage-183 | storeMedia: 保存容量の残りが足りない — アップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `BusinessRuleError(StorageQuotaExceeded)` が投げられる |
| TC-storage-184 | storeMedia: viewer である — アップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-storage-185 | storeMedia: 存在しないノート — アップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-storage-186 | storeMedia: move直後に旧routeを読む — アップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | scope miss後にprimaryで1回引き直し、target scopeへだけ保存する |
| TC-storage-187 | storeMedia: routeが`purging` — アップロードする | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `NOTE_NOT_FOUND`となり、R2にもmetadataにも保存しない |
| TC-storage-188 | storeMedia: アップロード後 — 保管記録を確認する | spec/testcases/storage/storeMedia.md#テストケース-storemedia | `purpose: "media"`、挿入先の `noteId`、`uploadedBy: userId` が入っている（`collectOrphanMedia` の孤児判定と `deleteFilesForNote` の回収の手がかりになる） |
| TC-storage-189 | storeMedia: アップロード後 — 使用量を確認する | spec/testcases/storage/storeMedia.md#テストケース-storemedia | 保存容量が増えている |
| TC-storage-190 | storeUpload: 対応形式の Markdown ファイル — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | ファイルが保管され、ノートが `processing` で作られ、変換ジョブが登録される |
| TC-storage-191 | storeUpload: 画像ファイルで OpenRouter 未連携 — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | ノートが `awaitingIntegration` で作られ、変換ジョブも登録される（終端化は `runConversion` が行う） |
| TC-storage-192 | storeUpload: 画像ファイルで OpenRouter 連携済み — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | ノートが `processing` で作られ、変換ジョブが登録される |
| TC-storage-193 | storeUpload: 未対応の拡張子 — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `BusinessRuleError(UnsupportedMimeType)` が投げられる |
| TC-storage-194 | storeUpload: 拡張子と内容が食い違う — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 内容から判定した形式が使われる |
| TC-storage-195 | storeUpload: 51 MB の PDF — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `BusinessRuleError(FileTooLarge)` が投げられる |
| TC-storage-196 | storeUpload: 50 MB の PDF — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 成功する（境界値） |
| TC-storage-197 | storeUpload: パスワード保護された PDF — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | ノートが作られ、`content` が `failed(passwordProtected)` になる |
| TC-storage-198 | storeUpload: `planConversionForUpload` が `initialContent` を返した — ノートの作成を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 返された `InitialContentState` をそのまま `Note.createFromUpload` の `initialContent` に渡し、状態と理由をここで組み立て直さない（`awaitingIntegration` と `failed` の区別も再判定しない） |
| TC-storage-199 | storeUpload: 方針が `processing` になる Markdown ファイル — 出力を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `contentStatus: "processing"`、`contentFailureReason: null` が返る |
| TC-storage-200 | storeUpload: 画像ファイルで OpenRouter 未連携 — 出力を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `contentStatus: "awaitingIntegration"`、`contentFailureReason: null` が返る |
| TC-storage-201 | storeUpload: `conversionPreference: "machineOnly"` で画像ファイル — 出力を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `contentStatus: "failed"`、`contentFailureReason: "machineExtractionUnavailable"` が返り、画面は `auto` での取り込み直しを案内する |
| TC-storage-202 | storeUpload: 内容の判定で未対応形式と分かったファイル — 出力を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `contentStatus: "failed"`、`contentFailureReason: "unsupportedFormat"` が返り、画面は形式が対象外である旨を案内する |
| TC-storage-203 | storeUpload: パスワード保護された PDF — 出力を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `contentStatus: "failed"`、`contentFailureReason: "passwordProtected"` が返る |
| TC-storage-204 | storeUpload: 3 種の `failed` を返す取り込み — 画面の案内を比べる | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `contentFailureReason` で案内が分かれる（`machineExtractionUnavailable` / `unsupportedFormat` / `passwordProtected`） |
| TC-storage-205 | storeUpload: 保存容量の残りが足りない — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `BusinessRuleError(StorageQuotaExceeded)` が投げられる |
| TC-storage-206 | storeUpload: LLM 実行回数の残りがない画像 — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `BusinessRuleError(LlmQuotaExceeded)` が投げられる。LLM 必須形式のため `machineOnly` での再取り込みは案内せず、翌月まで待つ案内になる |
| TC-storage-207 | storeUpload: LLM 実行回数の残りがない Word ファイル、OpenRouter 連携済み — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `BusinessRuleError(LlmQuotaExceeded)` が投げられ、`conversionPreference: "machineOnly"` での再取り込みが案内される（機械的変換で取り込める形式） |
| TC-storage-208 | storeUpload: LLM 実行回数の残りがなく、方針が LLM を要さない Markdown ファイル — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | LLM 回数の検査は方針決定の後に行われるため掛からず、取り込みが成功する |
| TC-storage-209 | storeUpload: LLM 実行回数の残りがなく、未対応の拡張子 — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 形式の検査が先に働き、`BusinessRuleError(UnsupportedMimeType)` が投げられる |
| TC-storage-210 | storeUpload: `conversionPreference: "machineOnly"` で Word ファイル、OpenRouter 連携済み — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 連携があっても `capability.llm: "declined"` として扱われ、機械的変換（`textExtraction`）の方針になる |
| TC-storage-211 | storeUpload: `conversionPreference: "machineOnly"` で Word ファイル、LLM 実行回数の残りがない — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 方針が LLM を要さないため検査に掛からず、取り込みが成功する |
| TC-storage-212 | storeUpload: `conversionPreference: "machineOnly"` で画像ファイル — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `unavailable(machineExtractionUnavailable)` の方針になり、ノートが `failed(machineExtractionUnavailable)` で作られる（`awaitingIntegration` にはしない） |
| TC-storage-213 | storeUpload: `conversionPreference: "machineOnly"` で画像ファイル、OpenRouter 連携済み — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 連携があっても結果は同じ `failed(machineExtractionUnavailable)` で、連携を促す案内は出ない |
| TC-storage-214 | storeUpload: `conversionPreference: "auto"`（既定）で Word ファイル、OpenRouter 連携済み — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `textExtractionThenStructuring` の方針になる |
| TC-storage-215 | storeUpload: Drive の自動バックアップが有効 — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | バックアップジョブも登録される |
| TC-storage-216 | storeUpload: 自動バックアップが無効 — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | バックアップジョブは登録されない |
| TC-storage-217 | storeUpload: ワークスペースの viewer — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-storage-218 | storeUpload: 公開ハンドル未設定の個人所有で `visibility: "public"` を指定する — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる。検査は保管を始める前に行われるため、オブジェクトストレージへの `put` もノートの作成も起きない |
| TC-storage-219 | storeUpload: 公開スラッグ未設定のワークスペース所有で `visibility: "public"` を指定する — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 同じく保管前に `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる（検査の基準は所有者であり `createdBy` ではない） |
| TC-storage-220 | storeUpload: 公開ハンドル未設定で `visibility: "unlisted"` を指定する — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 公開ハンドルを要さないため成功する |
| TC-storage-221 | storeUpload: 実バイト長が 3 MB の画像ファイル — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 保管する型は先頭バイトの署名、サイズは実バイト長から決まる（`AcceptedUpload`）。宣言 MIME・宣言サイズを渡す経路は入力 DTO に無い |
| TC-storage-222 | storeUpload: オブジェクトストレージが失敗する — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `SystemError(ExternalServiceError)` が投げられ、ノートは作られない |
| TC-storage-223 | storeUpload: 同名ファイルを 2 回アップロードする — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 別のノートが 2 件作られる |
| TC-storage-224 | storeUpload: 同一内容のファイルを 2 回アップロードする — 保管記録を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | チェックサムによる重複保管の回避は行わず、ノートごとに別の `StoredFile` が作られる |
| TC-storage-225 | storeUpload: 取り込みに成功した — 保管記録を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `purpose: "source"`、作られたノートの `noteId`、`uploadedBy: userId` が入っている |
| TC-storage-226 | storeUpload: 変換ジョブを登録した — ジョブの `target` と `payload` を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `target: { type: "note", noteId }`、`payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }` が入る |
| TC-storage-227 | storeUpload: Drive の自動バックアップが有効 — バックアップジョブの `target` と `payload` を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `target: { type: "storedFile", fileId }`、`payload: { kind: "driveBackup" }` が入る |
| TC-storage-228 | storeUpload: 個人所有として（`ownerType: "user"`）アップロードする — 変換ジョブの `scope` を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 取り込み先の所有文脈から `{ type: "user", userId }` が入る |
| TC-storage-229 | storeUpload: 参加ワークスペース所有としてアップロードする（要求者は owner ではないメンバー） — 変換ジョブの `scope` を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `{ type: "workspace", workspaceId: ownerWorkspaceId }` が入る（要求者からは導かない） |
| TC-storage-230 | storeUpload: Drive の自動バックアップが有効 — 変換ジョブとバックアップジョブの `scope` を比べる | spec/testcases/storage/storeUpload.md#テストケース-storeupload | どちらも取り込み先の所有文脈から導かれるため一致する（ノートの `NoteOwner` と元ファイルの `StorageOwner` が同じ所有者のため） |
| TC-storage-231 | storeUpload: `startBulkUpload` が返した `parentJobId` を指定する — 親子の `scope` を比べる | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 親が同じ `ownerType` / `ownerWorkspaceId` から導いた値と一致し、親子の `scope` が一致するという不変条件を満たす |
| TC-storage-232 | storeUpload: `startBulkUpload` が返した `parentJobId` を指定する — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 変換ジョブが `parentId: parentJobId` の子として作られる |
| TC-storage-233 | storeUpload: `parentJobId` つきで登録した — 親子の `payload` を比べる | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 子は親（`Job.enqueueBatch` が作った `{ kind: "conversion", requestedVisibility, conversionPreference }`）と同じ `kind` / `payload` を持ち、`target` だけが対象 1 件を指す |
| TC-storage-234 | storeUpload: `parentJobId` つきの変換ジョブが終端した — 親ジョブの進捗を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `updateBatchProgress` によって親の進捗に数えられる |
| TC-storage-235 | storeUpload: `parentJobId` つきで方針が `unavailable`（未対応形式・要 LLM 連携・`machineOnly` の LLM 必須形式） — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | いずれも変換ジョブが子として登録され、親の `total` と子の件数が一致する |
| TC-storage-236 | storeUpload: `parentJobId` つきで受理した全 5 件をアップロードする — 親ジョブを確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 子が 5 件登録され、全子終端で親が終端する（変換不能な子があっても親は「処理中」のまま残らない） |
| TC-storage-237 | storeUpload: 方針が `unavailable(unsupportedFormat)` — 出力を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | `conversionJobId` が `null` にならない（変換ジョブは方針にかかわらず登録される） |
| TC-storage-238 | storeUpload: `parentJobId` を指定しない — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 変換ジョブは `parentId: null` の単独ジョブとして作られる |
| TC-storage-239 | storeUpload: `visibility: "unlisted"` を指定する — アップロードする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | ノートは非公開で作られ、変換成功後に限定公開になる |
| TC-storage-240 | storeUpload: 変換が失敗した — 結果を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 公開ステータスは非公開のまま残る |
| TC-storage-241 | storeUpload: クォータの検査 — 呼び出し先を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | Usage の**ユースケース** `ensureUploadAllowed` を呼ぶ。Usage のドメインサービス `QuotaEnforcement` やリポジトリを直接触らない（Storage ドメインは Usage に依存しない） |
| TC-storage-242 | storeUpload: LLM を要する方針と判定した — 消費の有無を確認する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | このユースケースは `consumeLlmCall` を呼ばない。残量の事前確認だけを行い、消費は `runConversion` が行う |
| TC-storage-243 | storeUpload: Note route予約後にupload処理が失敗する — 再試行する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 対象scopeにNoteがなければreservationを解放し、active routeを残さない |
| TC-storage-244 | storeUpload: scope-local file / Note / Job commit後にactivation応答を失う — recoveryを実行する | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 同じoperation IDでrouteをactiveにし、file・Note・Jobを二重登録しない |
| TC-storage-245 | storeUpload: scope SQLite使用率が60%以上 — bulk uploadする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | sharding完了まで新規bulkを抑制し、削除・export・security cleanupは継続する |
| TC-storage-246 | storeUpload: scope SQLite使用率が70%以上 — 新規uploadする | spec/testcases/storage/storeUpload.md#テストケース-storeupload | 容量エラーで拒否し、hard limit到達前に書込みを止める |
| TC-tag-001 | assignTag: 編集できるノート、同名タグなし — タグを付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | タグが新規作成され付与され、`created: true` が返る |
| TC-tag-002 | assignTag: 同じスコープに同名タグがある — タグを付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | 既存のタグが使われ、`created: false` が返る |
| TC-tag-003 | assignTag: 既に同じタグが付いている — 再度付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | 重複した付与は作られず成功する |
| TC-tag-004 | assignTag: — — 前後に空白のあるタグ名を指定する | spec/testcases/tag/assignTag.md#テストケース-assigntag | 空白が除去されて保存される |
| TC-tag-005 | assignTag: 全角英数字のタグ名がある — 半角で同じ名前を指定する | spec/testcases/tag/assignTag.md#テストケース-assigntag | 同一とみなされ、新規作成されない |
| TC-tag-006 | assignTag: 大文字のタグ名がある — 小文字で同じ名前を指定する | spec/testcases/tag/assignTag.md#テストケース-assigntag | 同一とみなされる |
| TC-tag-007 | assignTag: — — 空文字列のタグ名を指定する | spec/testcases/tag/assignTag.md#テストケース-assigntag | `BusinessRuleError(InvalidTagName)` が投げられる |
| TC-tag-008 | assignTag: — — 50 文字のタグ名を指定する | spec/testcases/tag/assignTag.md#テストケース-assigntag | 成功する（境界値） |
| TC-tag-009 | assignTag: — — 51 文字のタグ名を指定する | spec/testcases/tag/assignTag.md#テストケース-assigntag | `BusinessRuleError(InvalidTagName)` が投げられる |
| TC-tag-010 | assignTag: 既に 50 個のタグが付いている — さらに付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | `BusinessRuleError(TooManyTags)` が投げられる |
| TC-tag-011 | assignTag: 既に 49 個のタグが付いている — さらに付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | 成功する（境界値） |
| TC-tag-012 | assignTag: viewer である — 付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-tag-013 | assignTag: ゴミ箱のノート（所有者本人） — 付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | `BusinessRuleError(NoteIsTrashed)` が投げられる。処理フローの手順 1 で `canEdit` の確認とは**別に**ゴミ箱在籍を検査するため、`NoteAccessPolicy` が所有者に `canEdit: true` を返しても付与に進まない |
| TC-tag-014 | assignTag: ゴミ箱のノート（ワークスペースの owner / editor で `viewTrash` を持つ） — 付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | 同じく `BusinessRuleError(NoteIsTrashed)` が投げられる（権限判定を通過しても検査に掛かる） |
| TC-tag-015 | assignTag: 個人ノートとワークスペースのノートに同名タグを付ける — それぞれに付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | スコープごとに別のタグが作られる |
| TC-tag-016 | assignTag: move直後にreplicaが旧routeを返す — 付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | scope miss後にprimary routeを1回引き直し、target scopeだけに付与する |
| TC-tag-017 | assignTag: routeが`purging` / `tombstone` — 付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | `NOTE_NOT_FOUND`で、どのTagも変更しない |
| TC-tag-018 | assignTag: 同名タグを同時に 2 つの要求が作成する — 並行して付ける | spec/testcases/tag/assignTag.md#テストケース-assigntag | 片方は `ConflictError("TAG_NAME_ALREADY_USED")` になり、読み直して再試行すれば成功する |
| TC-tag-019 | assignTag: 付与に成功した — 読み取りモデルを確認する | spec/testcases/tag/assignTag.md#テストケース-assigntag | `tag.assigned` を受けた `projectNoteChanges` が完全snapshotを置換し、`tag_names` / `note_search_tags` / `tag_display_names` とFTS `tag_names_fts`を同一バッチで更新する |
| TC-tag-020 | assignTag: 大文字・全角英数字を含むタグ名を付ける — 読み取りモデルを確認する | spec/testcases/tag/assignTag.md#テストケース-assigntag | `tag_names` / `tag_names_fts` / `note_search_tags.normalized` には正規化名が、`tag_display_names` には入力どおりの表示名が入る |
| TC-tag-021 | assignTag: 既にタグが付いているノートにもう 1 つ付ける — 読み取りモデルを確認する | spec/testcases/tag/assignTag.md#テストケース-assigntag | ノートのタグ集合が丸ごと入れ替わり、既存のタグと新しいタグの両方が 3 列と FTS 索引のすべてに載る |
| TC-tag-022 | assignTag: 既に同じタグが付いている（`created: false`、付与は増えない） — 読み取りモデルを確認する | spec/testcases/tag/assignTag.md#テストケース-assigntag | イベントが発行されないため読み取りモデルは変化せず、内容も変わらない |
| TC-tag-023 | deleteAssignmentsForNote: 完全削除されたノートに 5 件のタグが付いていた — `note.purged` を処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | 5 件の付与が削除され、`deletedCount: 5` が返る |
| TC-tag-024 | deleteAssignmentsForNote: 処理後 — タグ本体を確認する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | タグは削除されず、使用件数 0 のタグとして残る（削除は `deleteUnusedTags` の責務） |
| TC-tag-025 | deleteAssignmentsForNote: 同じタグが他のノートにも付いている — 処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | 他のノートの付与は削除されない |
| TC-tag-026 | deleteAssignmentsForNote: 処理後 — 発行されたイベントを確認する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | `tag.unassigned` は発行されない（local/public読み取りモデルの行は `note.purged` を処理する各projection writerが消すため） |
| TC-tag-027 | deleteAssignmentsForNote: 付与が450件ある — 処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | 200件ずつ`tag.noteDeleteContinued`で再開し、各turnでdeletion ownerを再確認する |
| TC-tag-028 | deleteAssignmentsForNote: personal account deletion由来 — 処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | `ScopeCleanupAdmissionStore`がpersonal receiptの同一operation IDを確認して通す |
| TC-tag-029 | deleteAssignmentsForNote: 対象ノートに付与が 1 件もない — 処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | 何もせず `deletedCount: 0` で成功として返る |
| TC-tag-030 | deleteAssignmentsForNote: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | 2 回目は削除対象がなく `deletedCount: 0` で終わり、結果は変わらない（冪等） |
| TC-tag-031 | deleteAssignmentsForNote: 同じ削除で `deleteTagsForScope` が先にタグごと消していた — 処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | 付与は既にないため 0 件削除で無害に終わる（順序によらず結果は同じ） |
| TC-tag-032 | deleteAssignmentsForNote: 書き込みが失敗する — 処理する | spec/testcases/tag/deleteAssignmentsForNote.md#テストケース-deleteassignmentsfornote | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる |
| TC-tag-033 | deleteTag: 3 件のノートに付いたタグ — 削除する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | `affectedNotes: null`, `status: "pending"`とoperation IDが返り、Alarm完了照会で3件と確定する |
| TC-tag-034 | deleteTag: 10,000 件のノートに付いたタグ — 削除する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | operation lock後、付与を最大200件ずつ50 turnに分け、1 transactionのCPU・revision bump・task数を有界にする |
| TC-tag-035 | deleteTag: 各pageを処理する — 保存境界を確認する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | assignment削除、各Noteのprojection revision bump、個別`projection.reprojectRequested`を同じscope-local UoWで保存する |
| TC-tag-036 | deleteTag: 同じpageに200 Noteがある — task IDを確認する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | `tagOperationId + plane + noteId + projectionRevision`由来の決定的IDでlocal task/public outboxが別々に保存され、同一pageの再実行では増殖しない |
| TC-tag-037 | deleteTag: page commit後・public Queue処理前にNoteがmoveする — public requestを処理する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | consumerがcurrent routeを解決して移動先を再投影し、旧scope snapshotを書かない |
| TC-tag-038 | deleteTag: page間に同じタグを付与/renameしようとする — 実行する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | operation lockにより競合として拒否され、新規付与が削除処理の後ろへ入り込まない |
| TC-tag-039 | deleteTag: page commit後にworkerが停止する — 再開する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | 同じoperation IDで残るassignmentの先頭から再開し、二重revision bumpせず完了する |
| TC-tag-040 | deleteTag: 削除後 — 発行されたイベントを確認する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | `tag.deleted` も発行されるが用途は監査のみで、読み取りモデルは各pageの`projection.reprojectRequested`が更新済みである |
| TC-tag-041 | deleteTag: 削除後 — ノートを確認する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | ノート自体は残り、そのタグだけが外れている |
| TC-tag-042 | deleteTag: 使用件数 0 のタグ — 削除する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | bounded workerの最初のturnで0件を確認して削除され、完了照会で`affectedNotes: 0`になる |
| TC-tag-043 | deleteTag: 存在しないタグ ID — 削除する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | `NotFoundError("TAG_NOT_FOUND")` が投げられる |
| TC-tag-044 | deleteTag: 他スコープのタグ — 削除する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | `NotFoundError("TAG_NOT_FOUND")` が投げられる |
| TC-tag-045 | deleteTag: ワークスペースの viewer — 削除する | spec/testcases/tag/deleteTag.md#テストケース-deletetag | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-tag-046 | deleteTag: 削除後 — そのタグで絞り込む | spec/testcases/tag/deleteTag.md#テストケース-deletetag | 結果が 0 件になる |
| TC-tag-047 | deleteTagsForScope: 退会処理中の利用者の個人スコープに 10 件のタグがある — account deletionのpersonal cleanup commandを処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | 個人スコープの 10 件が削除され、`deletedCount: 10` が返る |
| TC-tag-048 | deleteTagsForScope: 削除されるタグに付与がある — 処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | assignmentを200件ずつ先に削除し、0件になってからtagを最大100件ずつ消す |
| TC-tag-049 | deleteTagsForScope: 削除されたワークスペースのスコープに 4 件のタグがある — `workspace.deleted` を処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | そのワークスペーススコープの 4 件だけが削除される |
| TC-tag-050 | deleteTagsForScope: 同じ利用者が別のワークスペースにもタグを持つ — `workspace.deleted` を処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | 別スコープのタグは削除されない |
| TC-tag-051 | deleteTagsForScope: 退会者が参加していたワークスペースのタグがある — account deletionのpersonal cleanup commandを処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | ワークスペーススコープのタグは削除されない（対象は個人スコープのみ） |
| TC-tag-052 | deleteTagsForScope: 処理後 — 発行されたイベントを確認する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | イベントは発行しない（読み取りモデルの行は同じ削除イベントを購読する `deleteNotesForOwner` が消すため） |
| TC-tag-053 | deleteTagsForScope: `note.purged` 経由の `deleteAssignmentsForNote` が先に付与を消していた — 処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | タグの削除は成功し、結果は変わらない（順序・重複によらず同じ） |
| TC-tag-054 | deleteTagsForScope: 対象スコープにタグが 1 件もない — 処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | 何もせず `deletedCount: 0` で成功として返る |
| TC-tag-055 | deleteTagsForScope: 同じイベントを 2 回受け取る — 2 回処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | 2 回目は削除対象がなく `deletedCount: 0` で終わり、結果は変わらない（冪等） |
| TC-tag-056 | deleteTagsForScope: 書き込みが失敗する — 処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる |
| TC-tag-057 | deleteTagsForScope: 250件のtagがある — workspace削除で処理する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | `deletionOperationId`を保持したtaskで100件ずつ3 Alarm turnに分け、各turnでowner一致を検査する |
| TC-tag-058 | deleteTagsForScope: 1 tagに10,000 assignmentがある — scope削除する | spec/testcases/tag/deleteTagsForScope.md#テストケース-deletetagsforscope | assignmentを200件/turnで回収し、Tag DELETEのFK CASCADEへ一括で渡さない |
| TC-tag-059 | deleteUnusedTags: 使用件数 0 のタグが 4 件ある — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | operationを開始し、完了時に4件が削除される |
| TC-tag-060 | deleteUnusedTags: 使用中のタグがある — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | それらは削除されない |
| TC-tag-061 | deleteUnusedTags: 使用件数 0 のタグがない — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | `deletedCount: 0` が返る |
| TC-tag-062 | deleteUnusedTags: ワークスペースの viewer — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-tag-063 | deleteUnusedTags: 個人スコープで実行する — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | ワークスペースのタグは削除されない |
| TC-tag-064 | deleteUnusedTags: 削除の経路 — 発行する処理を確認する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | `deleteUnusedInScope(scope, 200)` とAlarm continuationを使い、1 turnのrow/event payloadを200件以下にする |
| TC-tag-065 | deleteUnusedTags: 使用件数 0 のタグが 3,000 件ある — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | 15 turn以上に分けて全件を削除し、途中停止後も同じoperation IDで再開する |
| TC-tag-066 | deleteUnusedTags: 削除された — 発行イベントを確認する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | 1page最大200 IDの `tag.unusedBatchDeleted` を1件発行し、3,000個の個別eventを一度に作らない |
| TC-tag-067 | deleteUnusedTags: 実行の直前に 1 件が別の要求で削除された — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | 集合削除の対象に現れないだけで、残りの削除は成立する。`deletedCount` は実際に消えた行数を返す |
| TC-tag-068 | deleteUnusedTags: 画面に件数を出したあと、削除の直前に 1 件へ付与が付いた — 実行する | spec/testcases/tag/deleteUnusedTags.md#テストケース-deleteunusedtags | そのタグは削除されない。未使用かどうかの判定を削除の副問い合わせが削除の時点で行うため、列挙から削除までの窓が存在しない（`TagQueryService.listWithUsage` は画面表示用であって削除の根拠ではない） |
| TC-tag-069 | getTagOperation: deleteTag operationが進行中 — 進捗を取得する | spec/testcases/tag/getTagOperation.md#テストケース-gettagoperation | `pending`、現在の`processedCount`、`affectedCount: null`が返る |
| TC-tag-070 | getTagOperation: operationが完了した — 取得する | spec/testcases/tag/getTagOperation.md#テストケース-gettagoperation | `completed`と確定`affectedCount`が返り、UIが一覧を再読込できる |
| TC-tag-071 | getTagOperation: taskがretry上限を超えた — 取得する | spec/testcases/tag/getTagOperation.md#テストケース-gettagoperation | `failed`と表示用error codeが返る |
| TC-tag-072 | getTagOperation: operationを処理前に中止済み — 取得する | spec/testcases/tag/getTagOperation.md#テストケース-gettagoperation | 終端状態`aborted`が返り、同じabort要求にも同じ結果を返せる |
| TC-tag-073 | getTagOperation: 別scopeのoperation ID — 取得する | spec/testcases/tag/getTagOperation.md#テストケース-gettagoperation | `NotFoundError("TAG_OPERATION_NOT_FOUND")`になる |
| TC-tag-074 | getTagOperation: workspace viewer — 取得する | spec/testcases/tag/getTagOperation.md#テストケース-gettagoperation | `BusinessRuleError(InsufficientRole)`になる |
| TC-tag-075 | listTagsForNotes: 3 件のノートにそれぞれタグが付いている — まとめて引く | spec/testcases/tag/listTagsForNotes.md#テストケース-listtagsfornotes | ノート ID ごとにタグの配列が返る |
| TC-tag-076 | listTagsForNotes: タグが付いていないノートを含む — 引く | spec/testcases/tag/listTagsForNotes.md#テストケース-listtagsfornotes | そのノートは空配列になる |
| TC-tag-077 | listTagsForNotes: ノート ID を 1 件も渡さない — 引く | spec/testcases/tag/listTagsForNotes.md#テストケース-listtagsfornotes | 空のマップが返る |
| TC-tag-078 | listTagsForNotes: 存在しないノート ID を含む — 引く | spec/testcases/tag/listTagsForNotes.md#テストケース-listtagsfornotes | そのノートは空配列になり、エラーにならない |
| TC-tag-079 | listTagsForNotes: 異なるスコープのノートを混ぜて渡す — 引く | spec/testcases/tag/listTagsForNotes.md#テストケース-listtagsfornotes | それぞれのスコープのタグが返る |
| TC-tag-080 | listTagsWithUsage: タグが 5 件ある — 使用件数順で一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | 5 件が件数の降順で返る |
| TC-tag-081 | listTagsWithUsage: 使用件数 0 のタグがある — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | 含まれ、`usageCount: 0` になる |
| TC-tag-082 | listTagsWithUsage: タグが 0 件 — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | 空配列が返る |
| TC-tag-083 | listTagsWithUsage: キーワードを指定する — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | 名前に一致するタグだけが返る |
| TC-tag-084 | listTagsWithUsage: 最終使用日時順を指定する — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | 最後に付与された順で返る |
| TC-tag-085 | listTagsWithUsage: 一度も付与されていないタグ — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | `lastUsedAt: null` になる |
| TC-tag-086 | listTagsWithUsage: ワークスペースの viewer — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | 一覧が返り、`canManage: false` になる |
| TC-tag-087 | listTagsWithUsage: ワークスペースの editor — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | `canManage: true` になる |
| TC-tag-088 | listTagsWithUsage: 非メンバー — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-tag-089 | listTagsWithUsage: 個人スコープ — 一覧する | spec/testcases/tag/listTagsWithUsage.md#テストケース-listtagswithusage | ワークスペースのタグは含まれない |
| TC-tag-090 | mergeTags: タグ A（3 件）とタグ B（2 件）が同じスコープにある — A を B に統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | operation IDとpendingが返り、Alarm完了後にBの使用件数が5、Aが削除済みになる |
| TC-tag-091 | mergeTags: 同じノートに A と B の両方が付いている — 統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | 重複せず 1 件の付与になる |
| TC-tag-092 | mergeTags: 同じタグ同士を指定する — 統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | `BusinessRuleError(CannotMergeIntoItself)` が投げられる |
| TC-tag-093 | mergeTags: 異なるスコープのタグを指定する — 統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | `BusinessRuleError(ScopeMismatch)` が投げられる |
| TC-tag-094 | mergeTags: 存在しないタグ ID を指定する — 統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | `NotFoundError("TAG_NOT_FOUND")` が投げられる |
| TC-tag-095 | mergeTags: ワークスペースの viewer — 統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-tag-096 | mergeTags: 10,000件のsource付与 — 統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | `reassignBatch`を最大200件ずつ処理し、各pageでrevision bumpと完全snapshot再投影taskを原子的に保存する |
| TC-tag-097 | mergeTags: 統合後 — 読み取りモデルを確認する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | pageごとの個別再投影により、tag列とFTSが完全snapshotで更新される |
| TC-tag-098 | mergeTags: 統合後 — 統合元のタグ名で確認する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | 統合元の名前が 3 列と FTS 索引のすべてから消え、統合先の名前だけが残る（同じノートに両方が付いていた場合も重複しない） |
| TC-tag-099 | mergeTags: 使用件数 0 のタグを統合する — 統合する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | workerの最初のturnで完了し、完了照会で`affectedNotes: 0`になる |
| TC-tag-100 | mergeTags: source/targetの両方が同じNoteに付いている — page処理する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | source行だけ削除し、targetを重複させず、そのNoteのrevisionを1回進める |
| TC-tag-101 | mergeTags: page間にsource/targetを変更しようとする — 実行する | spec/testcases/tag/mergeTags.md#テストケース-mergetags | 両tagのoperation lockで拒否される |
| TC-tag-102 | relocateAssignmentsForNote: sourceにTag assignmentがある — `snapshotSource` | spec/testcases/tag/relocateAssignmentsForNote.md#テストケース-relocateassignmentsfornote | 表示名・正規化名・assignedByをportable snapshotへ含め、source行を残す |
| TC-tag-103 | relocateAssignmentsForNote: targetに同名Tagがある — `stageTarget` | spec/testcases/tag/relocateAssignmentsForNote.md#テストケース-relocateassignmentsfornote | 正規化名で解決してtarget Tagへ付与する |
| TC-tag-104 | relocateAssignmentsForNote: targetに同名Tagがない — stageする | spec/testcases/tag/relocateAssignmentsForNote.md#テストケース-relocateassignmentsfornote | 新規Tagを作らずdropとして記録する |
| TC-tag-105 | relocateAssignmentsForNote: 大文字小文字だけ違うTag — stageする | spec/testcases/tag/relocateAssignmentsForNote.md#テストケース-relocateassignmentsfornote | 正規化して同一Tagへ付与する |
| TC-tag-106 | relocateAssignmentsForNote: 同じmigration IDを2回stage — 実行する | spec/testcases/tag/relocateAssignmentsForNote.md#テストケース-relocateassignmentsfornote | assignmentを二重作成しない |
| TC-tag-107 | relocateAssignmentsForNote: route切替後 — `retireSource` | spec/testcases/tag/relocateAssignmentsForNote.md#テストケース-relocateassignmentsfornote | source assignmentを削除する |
| TC-tag-108 | relocateAssignmentsForNote: tagが0件 — 各phaseを実行する | spec/testcases/tag/relocateAssignmentsForNote.md#テストケース-relocateassignmentsfornote | 0件で冪等に成功する |
| TC-tag-109 | renameTag: 同名タグのない状態 — 名前を変更する | spec/testcases/tag/renameTag.md#テストケース-renametag | タグ名が更新され、付いているすべてのノートの表示に反映される |
| TC-tag-110 | renameTag: 同じスコープに同名タグがある、`confirmMerge: false` — 変更する | spec/testcases/tag/renameTag.md#テストケース-renametag | 変更されず `mergeRequired: true` が返る |
| TC-tag-111 | renameTag: 同じスコープに同名タグがある、`confirmMerge: true` — 変更する | spec/testcases/tag/renameTag.md#テストケース-renametag | 統合operationが受理され、`merged: true`、統合先tagId、operation ID/statusが返る。pendingならUIは整理中を表示する |
| TC-tag-112 | renameTag: 統合の経路 — `mergeTags` の呼び出しを確認する | spec/testcases/tag/renameTag.md#テストケース-renametag | 手順の複製ではなくユースケースの呼び出し。`renameTag` は手順 5 までに書き込みを行わないため末尾呼び出しになり、`run` の入れ子も部分確定も生じない |
| TC-tag-113 | renameTag: 大文字小文字だけが違う名前にする — 変更する | spec/testcases/tag/renameTag.md#テストケース-renametag | 正規化名が変わらないため衝突とみなされず、`Tag.rename` で表示名だけが更新される（統合は起きない） |
| TC-tag-114 | renameTag: — — 空文字列にする | spec/testcases/tag/renameTag.md#テストケース-renametag | `BusinessRuleError(InvalidTagName)` が投げられる |
| TC-tag-115 | renameTag: — — 空白のみにする | spec/testcases/tag/renameTag.md#テストケース-renametag | `BusinessRuleError(InvalidTagName)` が投げられる |
| TC-tag-116 | renameTag: — — 51 文字にする | spec/testcases/tag/renameTag.md#テストケース-renametag | `BusinessRuleError(InvalidTagName)` が投げられる |
| TC-tag-117 | renameTag: 他スコープのタグ ID を指定する — 変更する | spec/testcases/tag/renameTag.md#テストケース-renametag | `NotFoundError("TAG_NOT_FOUND")` が投げられる |
| TC-tag-118 | renameTag: ワークスペースの viewer — 変更する | spec/testcases/tag/renameTag.md#テストケース-renametag | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-tag-119 | renameTag: 正規化名の変わる名前に変更した後 — 読み取りモデルを確認する | spec/testcases/tag/renameTag.md#テストケース-renametag | `tag.renamed` が対象ノートごとにlocal task/public outboxを積み、各consumerの完全snapshot置換で`tag_names` / `note_search_tags` / `tag_display_names`とFTS `tag_names_fts`を同一バッチで更新する |
| TC-tag-120 | renameTag: 大文字小文字だけを変えて変更した後 — 読み取りモデルを確認する | spec/testcases/tag/renameTag.md#テストケース-renametag | `tag_display_names` だけが新しい表示名になり、`tag_names` / `tag_names_fts` / `note_search_tags.normalized` は正規化名のまま変化しない |
| TC-tag-121 | renameTag: 大文字小文字だけを変えて変更した後 — 旧・新どちらの表記でも検索する | spec/testcases/tag/renameTag.md#テストケース-renametag | どちらでもヒットする（`tag_names_fts` が変わらないため関連度も変わらない） |
| TC-tag-122 | retryTagOperation: retry上限でfailed、100件処理済み — retryする | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | 同じoperation ID・lock・task payloadのままpendingへ戻り、残集合から再開する |
| TC-tag-123 | retryTagOperation: failed operationをretryし応答を失う — 同じ要求を再送する | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | 既存taskのupsertとなり、operation系列やtaskが増殖しない |
| TC-tag-124 | retryTagOperation: 100件処理済みのfailed operation — abortする | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | `ConflictError("TAG_OPERATION_PARTIALLY_APPLIED")`。lockを保持し、retryだけを許す |
| TC-tag-125 | retryTagOperation: 0件処理のfailed operation — abortする | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | taskを削除してlockを解放し、`aborted`が返る |
| TC-tag-126 | retryTagOperation: aborted operationのabort応答を失う — 同じactionを再送する | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | operation rowから`aborted`を返し、NOT_FOUNDや二重解放にならない |
| TC-tag-127 | retryTagOperation: running/completed operation — retryまたはabortする | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | `ConflictError("TAG_OPERATION_NOT_FAILED")` |
| TC-tag-128 | retryTagOperation: 別scopeのoperation ID — retryする | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | `NotFoundError("TAG_OPERATION_NOT_FOUND")` |
| TC-tag-129 | retryTagOperation: workspace viewer — retryする | spec/testcases/tag/retryTagOperation.md#テストケース-retrytagoperation | `BusinessRuleError(InsufficientRole)` |
| TC-tag-130 | suggestTags: タグが 10 件ある — 空の `prefix` で候補を求める | spec/testcases/tag/suggestTags.md#テストケース-suggesttags | 使用頻度の高い順に `limit` 件が返る |
| TC-tag-131 | suggestTags: 「設」で始まるタグが 2 件ある — 「設」で候補を求める | spec/testcases/tag/suggestTags.md#テストケース-suggesttags | その 2 件が返る |
| TC-tag-132 | suggestTags: 一致するタグがない — 候補を求める | spec/testcases/tag/suggestTags.md#テストケース-suggesttags | 空配列が返る |
| TC-tag-133 | suggestTags: 大文字で入力する — 候補を求める | spec/testcases/tag/suggestTags.md#テストケース-suggesttags | 正規化されて一致する |
| TC-tag-134 | suggestTags: ワークスペースのスコープ — 候補を求める | spec/testcases/tag/suggestTags.md#テストケース-suggesttags | 個人のタグは含まれない |
| TC-tag-135 | suggestTags: 非メンバー — 候補を求める | spec/testcases/tag/suggestTags.md#テストケース-suggesttags | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-tag-136 | unassignTag: タグが付いたノート — 外す | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | 付与が削除され、`tag.unassigned` が発行される |
| TC-tag-137 | unassignTag: 付いていないタグ — 外す | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | 何もせず成功する |
| TC-tag-138 | unassignTag: 外した後 — タグ自体を確認する | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | タグは残る（使用件数が減るだけ） |
| TC-tag-139 | unassignTag: viewer である — 外す | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-tag-140 | unassignTag: 存在しないノート — 外す | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | `NotFoundError("NOTE_NOT_FOUND")` が投げられる |
| TC-tag-141 | unassignTag: move直後のstale route — 外す | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | primaryで1回引き直し、target scopeだけを変更する |
| TC-tag-142 | unassignTag: routeが`purging` — 外す | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | `NOTE_NOT_FOUND`で付与を変更しない |
| TC-tag-143 | unassignTag: 外した後 — 読み取りモデルを確認する | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | `tag.unassigned` を受けた `projectNoteChanges` が完全snapshotを置換し、外したタグを`tag_names` / `note_search_tags` / `tag_display_names`とFTS `tag_names_fts`から同一バッチで除く |
| TC-tag-144 | unassignTag: 外した後、同じノートに他のタグが残っている — 読み取りモデルを確認する | spec/testcases/tag/unassignTag.md#テストケース-unassigntag | 完全snapshotのタグ集合に含まれる残りのタグは3列とFTS索引のすべてに残る |
| TC-usage-001 | applyStorageDelta: local fileStored event — current scopeで処理する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | current scopeの消費量だけを加算する |
| TC-usage-002 | applyStorageDelta: local fileDeleted event — 処理する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | current scopeから減算し、0未満にしない |
| TC-usage-003 | applyStorageDelta: artifact event — 処理する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | quotaに算入しない |
| TC-usage-004 | applyStorageDelta: note.created / note.purged — 処理する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | current scopeのNote件数を増減する |
| TC-usage-005 | applyStorageDelta: move snapshotが100 bytesを含む — sourceDebitを処理する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | source scopeで100 bytesとNote 1件を減算する |
| TC-usage-006 | applyStorageDelta: 同じmove — targetCreditを処理する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | target scopeで100 bytesとNote 1件を加算する。上限超過でもmoveを拒否しない |
| TC-usage-007 | applyStorageDelta: 同じmigration ID + phaseを2回処理 — 実行する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | current scopeの処理済み記録により二重増減しない |
| TC-usage-008 | applyStorageDelta: targetCreditの応答を失う — 再実行する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | 2回目は保存済み結果を返し二重加算しない |
| TC-usage-009 | applyStorageDelta: targetCredit後・route switch前 — upload判定を確認する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | sourceは未減算、targetは加算済みで安全側の二重計上になる |
| TC-usage-010 | applyStorageDelta: route switch後・sourceDebit前 — recoveryする | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | sourceは過剰計上のままで、新規uploadを過剰に許可しない。sourceDebitを冪等に再試行する |
| TC-usage-011 | applyStorageDelta: quota行のないtarget — targetCredit | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | 初期値をinsertして加算する |
| TC-usage-012 | applyStorageDelta: quota削除済みsource — sourceDebit | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | quota行を復活させず成功する |
| TC-usage-013 | applyStorageDelta: 処理済み記録後にquota更新が失敗 — 処理する | spec/testcases/usage/applyStorageDelta.md#テストケース-applystoragedelta | 同じscope-local UoWで両方rollbackし再試行できる |
| TC-usage-014 | consumeLlmCall: 残りが 10 回 — 1 回消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 消費が 1 増え、`headroom: 9` が返る |
| TC-usage-015 | consumeLlmCall: 残りが 1 回 — 1 回消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 通り、`headroom: 0` になる（境界値） |
| TC-usage-016 | consumeLlmCall: 残りが 0 回 — 1 回消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | `BusinessRuleError(LlmQuotaExceeded)` が投げられる |
| TC-usage-017 | consumeLlmCall: 当月の記録がない — 消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 初期値で作られてから消費される |
| TC-usage-018 | consumeLlmCall: 前月の記録がある — 当月に消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 当月の新しい記録が作られ、前月は変わらない |
| TC-usage-019 | consumeLlmCall: 消費後に変換が失敗した — 結果を確認する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 消費は戻らない |
| TC-usage-020 | consumeLlmCall: 変換の実行前に判明した失敗 — 結果を確認する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 消費されていない |
| TC-usage-021 | consumeLlmCall: 版が競合する — 消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 読み直して再適用され、成功する |
| TC-usage-022 | consumeLlmCall: 上限を超えた — 消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | `usage.llmExceeded` が発行される |
| TC-usage-023 | consumeLlmCall: `calls` に 0 を指定する — 消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | `BusinessRuleError(InvalidDelta)` が投げられる（境界値。仕様のエラー表の「`calls` が 1 未満」） |
| TC-usage-024 | consumeLlmCall: `calls` に負の値を指定する — 消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | `BusinessRuleError(InvalidDelta)` が投げられる |
| TC-usage-025 | consumeLlmCall: `calls` に 1 を指定する — 消費する | spec/testcases/usage/consumeLlmCall.md#テストケース-consumellmcall | 通る（`calls` の下限の境界値） |
| TC-usage-026 | deleteQuota: 利用者のクォータがある — 利用者を対象に実行する | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | クォータと LLM の記録が削除される |
| TC-usage-027 | deleteQuota: ワークスペースのクォータがある — ワークスペースを対象に実行する | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | クォータが削除される（LLM の記録は利用者に紐づくため対象外） |
| TC-usage-028 | deleteQuota: 既に削除済み — 実行する | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | 成功として返る |
| TC-usage-029 | deleteQuota: 同じイベントを 2 回受け取る — 2 回実行する | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | 結果が変わらない |
| TC-usage-030 | deleteQuota: 複数月の LLM 記録がある — 利用者を対象に実行する | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | すべての月の記録が削除される |
| TC-usage-031 | deleteQuota: workspace行削除後のcleanup — `deletionOperationId`付きで実行する | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | manifest owner一致時だけquotaを削除し、欠落・別IDは拒否する |
| TC-usage-032 | deleteQuota: LLM利用月が250件ある — 利用者を対象に実行する | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | 100件ずつ3回に分け、`usage.userCleanupContinued`で再開して100件未満のpage後にだけ完了ackする |
| TC-usage-033 | deleteQuota: 100件削除後に応答を失う — recoveryする | spec/testcases/usage/deleteQuota.md#テストケース-deletequota | 同じoperation IDで再実行し、既に消えた月を復活させず残件から続ける |
| TC-usage-034 | ensureUploadAllowed: 残量が十分 — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | 例外を投げず通る |
| TC-usage-035 | ensureUploadAllowed: 残量とちょうど同じサイズ — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | 通る（境界値） |
| TC-usage-036 | ensureUploadAllowed: 残量より 1 バイト大きい — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | `BusinessRuleError(StorageQuotaExceeded)` が投げられる |
| TC-usage-037 | ensureUploadAllowed: LLM 実行回数の残りが 1、`llmCalls: 1` — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | 通る（境界値） |
| TC-usage-038 | ensureUploadAllowed: LLM 実行回数の残りが 0、`llmCalls: 1` — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | `BusinessRuleError(LlmQuotaExceeded)` が投げられる |
| TC-usage-039 | ensureUploadAllowed: LLM の記録がなく `llmCalls: 1` — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | 初期値で判定され、通る |
| TC-usage-040 | ensureUploadAllowed: クォータのレコードがない — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | 初期値で判定される |
| TC-usage-041 | ensureUploadAllowed: `llmCalls: 0` で LLM の記録がない — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | 通る |
| TC-usage-042 | ensureUploadAllowed: ワークスペースを主体に指定する — 検査する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | ワークスペースの上限で判定される |
| TC-usage-043 | ensureUploadAllowed: 既に上限を超えている主体 — 呼び出し元を確認する | spec/testcases/usage/ensureUploadAllowed.md#テストケース-ensureuploadallowed | 検査されるのは取り込み時（`startBulkUpload` / `storeUpload` / `storeMedia`）だけで、ノートの移動や所有者の付け替えからは呼ばれない（強制は取り込み時のみ。超過は警告表示と新規アップロードの拒否で扱う） |
| TC-usage-044 | getUsageSnapshot: 個人の消費が 1 GB、上限 5 GB — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | 消費・上限・件数と `level: "none"` が返る |
| TC-usage-045 | getUsageSnapshot: 消費が上限の 80 % — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `level: "warning"` が返る（境界値） |
| TC-usage-046 | getUsageSnapshot: 消費が上限の 79 % — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `level: "none"` が返る |
| TC-usage-047 | getUsageSnapshot: 消費が上限を超えている — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `level: "exceeded"` が返る |
| TC-usage-048 | getUsageSnapshot: owner のワークスペースが 2 件ある — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | それぞれの使用量が返る |
| TC-usage-049 | getUsageSnapshot: editor として参加しているワークスペースがある — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | 含まれる（対象は `owner` と `editor`） |
| TC-usage-050 | getUsageSnapshot: owner のワークスペースと editor のワークスペースが 1 件ずつある — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `workspaces` に 2 件とも返る |
| TC-usage-051 | getUsageSnapshot: editor として参加するワークスペースが 45 件ある — 先頭ページを引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | workspace RPC は20件以下、同時実行は6以下で、`nextWorkspaceCursor` が返る |
| TC-usage-052 | getUsageSnapshot: 先頭ページのうち1 scopeが一時的に応答しない — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | その要素だけ `{ state: "unavailable" }`、他は `{ state: "available" }` で返り、要求全体は成功する |
| TC-usage-053 | getUsageSnapshot: `nextWorkspaceCursor` を指定する — 次ページを引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | 前ページと重複せず最大20件を返す |
| TC-usage-054 | getUsageSnapshot: viewer としてのみ参加しているワークスペース — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | 含まれない |
| TC-usage-055 | getUsageSnapshot: どのワークスペースにも参加していない — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `workspaces` は空になる |
| TC-usage-056 | getUsageSnapshot: 個人のクォータのレコードがまだない — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `StorageQuota.initialize` の値が返り、レコードは作られない |
| TC-usage-057 | getUsageSnapshot: 当月の LLM 実行回数が 100 回 — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `consumedCalls: 100` と当月の期間が返る |
| TC-usage-058 | getUsageSnapshot: LLM を一度も使っておらず当月の記録がない — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | `LlmUsage.initialize` の値（`consumedCalls: 0`）が返り、レコードは作られない |
| TC-usage-059 | getUsageSnapshot: ゴミ箱にノートがある — 引く | spec/testcases/usage/getUsageSnapshot.md#テストケース-getusagesnapshot | 使用量に数えられている |
| TC-usage-060 | initializeQuota: 利用者が作られた — 実行する | spec/testcases/usage/initializeQuota.md#テストケース-initializequota | 既定のクォータでレコードが作られる |
| TC-usage-061 | initializeQuota: ワークスペースが作られた — 実行する | spec/testcases/usage/initializeQuota.md#テストケース-initializequota | ワークスペースの既定のクォータでレコードが作られる |
| TC-usage-062 | initializeQuota: 既にレコードがある — 実行する | spec/testcases/usage/initializeQuota.md#テストケース-initializequota | 何もせず成功する |
| TC-usage-063 | initializeQuota: 同じイベントを 2 回受け取る — 2 回実行する | spec/testcases/usage/initializeQuota.md#テストケース-initializequota | レコードは 1 件のまま |
| TC-usage-064 | initializeQuota: 同時に 2 つの要求が作成する — 並行して実行する | spec/testcases/usage/initializeQuota.md#テストケース-initializequota | 重複は既存として扱われ、成功する |
| TC-usage-065 | recalculateStorageUsage: 集計がずれている — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | 実データの合計に置き換わる |
| TC-usage-066 | recalculateStorageUsage: `purpose: "artifact"` の生成物を所有している — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | 合計から除外され、`consumedBytes` に含まれない（増分集計の `applyStorageDelta` と同じ除外規則） |
| TC-usage-067 | recalculateStorageUsage: artifact 以外のファイルがなく artifact だけがある — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | `consumedBytes: 0` になる |
| TC-usage-068 | recalculateStorageUsage: ファイルが 0 件 — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | `consumedBytes: 0` になる |
| TC-usage-069 | recalculateStorageUsage: ゴミ箱のノートがある — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | ノート件数に数えられる |
| TC-usage-070 | recalculateStorageUsage: クォータのレコードがない — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | 作られてから値が入る |
| TC-usage-071 | recalculateStorageUsage: 2 回続けて実行する — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | 結果が変わらない |
| TC-usage-072 | recalculateStorageUsage: ワークスペースを対象にする — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | そのワークスペースの分だけが計算される |
| TC-usage-073 | recalculateStorageUsage: user 主体が実行者と一致しない — 再計算する | spec/testcases/usage/recalculateStorageUsage.md#テストケース-recalculatestorageusage | `BusinessRuleError(InsufficientRole)` が投げられ、`StorageQuota` は書き換わらない |
| TC-workspace-001 | acceptInvitation: activeなinvitation routeがある — preview/acceptする | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `resolveActive`で1つのworkspace scopeだけを解決する |
| TC-workspace-002 | acceptInvitation: local受諾とmembership edge activationが完了 — 完了する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `consume`でrouteがrevokedになり、同じtokenは再利用できない |
| TC-workspace-003 | acceptInvitation: consumeの応答を失う — recoveryする | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | 同じoperation IDで再試行し、既にrevokedなら成功する |
| TC-workspace-004 | acceptInvitation: 有効な保留中の招待、サインイン済み — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `Membership` が作られ、招待が `accepted` になり、指定ロールが付く |
| TC-workspace-005 | acceptInvitation: 招待されたメールと異なるアカウントでサインイン中 — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | 受諾が成功する（リンクを認可の根拠とする） |
| TC-workspace-006 | acceptInvitation: 存在しないトークン — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる |
| TC-workspace-007 | acceptInvitation: 期限切れの招待 — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `BusinessRuleError(InvitationExpired)` が投げられる |
| TC-workspace-008 | acceptInvitation: 取り消し済みの招待 — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `ValidationError("INVITATION_NOT_PENDING")` が投げられる |
| TC-workspace-009 | acceptInvitation: 既にメンバー — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | 招待は `accepted` になり、既存のロールは変更されない |
| TC-workspace-010 | acceptInvitation: ワークスペースが削除済み — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる |
| TC-workspace-011 | acceptInvitation: 同じ招待で 2 つの要求が同時に走る — 両方が受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | `Membership` は 1 件だけ作られる |
| TC-workspace-012 | acceptInvitation: 受諾後 — そのワークスペースのノート一覧を開く | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | ロールに応じた操作が可能になる |
| TC-workspace-013 | acceptInvitation: invitation token — routeを確認する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | global `invitation_routes` からworkspace scopeを解決し、正データはそのDOで読む |
| TC-workspace-014 | acceptInvitation: Userがdeleting — 受諾する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | pending membership reservationを作らず拒否する |
| TC-workspace-015 | acceptInvitation: pending edgeを予約後、account deletionがprepare lockを取得した — activationをclaimする | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | UserId shardの条件付き更新が拒否し、workspaceへlocal commitしない |
| TC-workspace-016 | acceptInvitation: activation claim後・workspace commit前にaccount deletionが始まる — 両Sagaを継続する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | account deletionはactivating edgeの解決を待ち、acceptがactiveへ収束した後にそのworkspaceをmanifestへ固定する |
| TC-workspace-017 | acceptInvitation: activation claim後にworkerが停止してleaseが切れる — recoveryする | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | operation IDでworkspace正データを照合し、commit済みならactive、未commitならabandonedへ100件以下で収束する |
| TC-workspace-018 | acceptInvitation: account deletion開始とactivation claimが同時 — 実行する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | UserId shardで直列化され、activation成功→削除がactive edgeを固定、または削除成功→activation拒否のどちらかになる |
| TC-workspace-019 | acceptInvitation: pending edge作成後にlocal commit失敗 — recoveryを実行する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | edgeを解放しInvitationはpendingのまま |
| TC-workspace-020 | acceptInvitation: local commit後にactivation応答を失う — 再試行する | spec/testcases/workspace/acceptInvitation.md#テストケース-acceptinvitation | 同じoperation IDでedgeをactiveにしMembershipを二重作成しない |
| TC-workspace-021 | changeMemberRole: owner で、対象が editor — viewer に変更する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | ロールが変わり、`membership.roleChanged` が旧ロールつきで発行される |
| TC-workspace-022 | changeMemberRole: owner が 1 名で、その owner を対象にする — editor に変更する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる |
| TC-workspace-023 | changeMemberRole: owner が 2 名で、片方を対象にする — editor に変更する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 変更が成功する |
| TC-workspace-024 | changeMemberRole: 自分自身を対象にする — 変更する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `BusinessRuleError(CannotChangeOwnRole)` が投げられる |
| TC-workspace-025 | changeMemberRole: editor である — 他人のロールを変更する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-026 | changeMemberRole: 他のワークスペースのメンバーシップ ID — 変更する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる |
| TC-workspace-027 | changeMemberRole: — — 未知のロールを指定する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `BusinessRuleError(InvalidRole)` が投げられる |
| TC-workspace-028 | changeMemberRole: 同じロールを指定する — 変更する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 変更もイベントも起きず成功する（ジョブの取り消しも起きない） |
| TC-workspace-029 | changeMemberRole: 対象を editor から viewer にした後 — 対象がノートを編集する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 編集が拒否される |
| TC-workspace-030 | changeMemberRole: 対象（editor）が要求した、そのワークスペースのノートの `conversion` / `regeneration` / `referenceImport` の未終端ジョブがある — viewer に降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `listActiveByRequesterAndKinds(memberUserId, disallowedKinds, 100)` が最終述語をDBで適用し、該当Jobだけをcancelする |
| TC-workspace-031 | changeMemberRole: 網が 100 件を返した — 降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 降格と同じ UoW で継続要求 `job.terminationContinued { origin: { path: "changeMemberRole", workspaceId, memberUserId, nextRole } }` を積む。続きは `continueForcedTermination` が引き受ける |
| TC-workspace-032 | changeMemberRole: 継続要求の `origin` — `kind` の絞り込みの出どころを確認する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `kind` の並びを焼き付けず `nextRole` だけを運ぶ。続きは下表を引き直して導く — 表を変えたときに配送中のメッセージだけが古い規則で動くのを防ぐ |
| TC-workspace-033 | changeMemberRole: 対象が要求した `bulkMove` / `bulkVisibility` / `bulkTag` / `bulkDelete` の未終端ジョブがある — viewer に降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | いずれも editor を要する kind のため取り消される |
| TC-workspace-034 | changeMemberRole: 対象が要求した `driveBackup` / `bulkBackup` の未終端ジョブがある — viewer に降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | いずれも editor を要する kind（[ADR 004](../adr/004-workspace-roles.md) のロール表）のため取り消される。バックアップはノートに紐づく共有状態（`BackupRecord`）を書き換え、`downloadNote` の範囲を超えるため |
| TC-workspace-035 | changeMemberRole: 対象が要求した `pdfExport` / `bulkExport` の未終端ジョブがある — viewer に降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | viewer でも実行できる kind（`downloadNote`）のため取り消されない。要求者個人に帰属する生成物を作るだけでノート側に何も書かない |
| TC-workspace-036 | changeMemberRole: 対象が owner で、editor に降格する — 降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 取り消しは 1 件も起きない（owner だけに許される操作に対応する `JobKind` が存在しないため） |
| TC-workspace-037 | changeMemberRole: 対象が viewer で、editor に昇格する — 昇格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 取り消しは起きない（降格の場合だけ対象を集める） |
| TC-workspace-038 | changeMemberRole: 他のメンバーが要求した実行中ジョブが同じワークスペースにある — 降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `requestedBy` が一致しないため触れられない |
| TC-workspace-039 | changeMemberRole: そのワークスペースのノートに対する匿名の PDF 書き出しジョブが実行中 — 降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `requestedBy: null` は対象と一致せず、そもそも viewer でも実行できる kind のため取り消されない |
| TC-workspace-040 | changeMemberRole: 対象が自分の個人ノートに対して持つ未終端ジョブがある — 降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | queryはcurrent workspace scopeに束縛されるため現れず、取り消されない |
| TC-workspace-041 | changeMemberRole: 取り消し対象のワーカーがリース有効で実行中 — 降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | `Job.cancel` はリースを検査せず終端化するため、ワーカーの生存を待たずに取り消される |
| TC-workspace-042 | changeMemberRole: ジョブの取り消しとロールの変更 — 保存の境界を確認する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | すべて同一 UoW で保存される（ロールだけが下がってジョブが走り続ける中間状態を作らない） |
| TC-workspace-043 | changeMemberRole: 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま — 降格する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる |
| TC-workspace-044 | changeMemberRole: 取り消したジョブ — 破棄された生成物を確認する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | 「共通: 強制終端の後始末」の 2 を規則どおり適用するが、この経路の回収対象は実際には空になる。取り消すのは editor を要する `kind` だけで、生成物（`purpose: "artifact"`）を持つのは viewer でも実行できる `pdfExport` / `bulkExport` だからである（降格した利用者は閲覧・ダウンロードの権限を保つため、生成済みの ZIP・PDF が手元に残っても差し支えない）。取り消し対象に `bulkBackup` の batch 親が含まれる場合も、規則 2 が引く成功済みの子（`runBackup`）は Drive 上にファイルを作るだけで `artifact` を持たないため回収対象は空のままである |
| TC-workspace-045 | changeMemberRole: role変更eventがdirectoryへ順不同に届く — 更新する | spec/testcases/workspace/changeMemberRole.md#テストケース-changememberrole | source versionが最大のroleだけが残り、古い降格/昇格eventで戻らない |
| TC-workspace-046 | changeWorkspaceSlug: owner で非公開のワークスペース — 未使用のスラッグに変更する | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | スラッグが更新され、`workspace.slugChanged` が旧スラッグつきで発行される |
| TC-workspace-047 | changeWorkspaceSlug: 公開中のワークスペース — スラッグを `null` にする | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | `BusinessRuleError(PublishedWorkspaceRequiresSlug)` が投げられる |
| TC-workspace-048 | changeWorkspaceSlug: 非公開のワークスペース — スラッグを `null` にする | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | 成功する |
| TC-workspace-049 | changeWorkspaceSlug: 他のワークスペースが使用中のスラッグ — 変更する | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | `ConflictError("SLUG_ALREADY_USED")` が投げられる |
| TC-workspace-050 | changeWorkspaceSlug: 自分と同じスラッグ — 同じ値に変更する | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | 変更もイベントも起きず成功する |
| TC-workspace-051 | changeWorkspaceSlug: owner でない — 変更する | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-052 | changeWorkspaceSlug: 公開中でスラッグを変更した — 旧スラッグの公開ページを開く | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | 「見つかりません」が返る |
| TC-workspace-053 | changeWorkspaceSlug: 新slug予約後にlocal更新が失敗 — 変更する | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | 新reservationを解放し、旧slugを維持する |
| TC-workspace-054 | changeWorkspaceSlug: local更新後にglobal切替応答を失う — recoveryを実行する | spec/testcases/workspace/changeWorkspaceSlug.md#テストケース-changeworkspaceslug | operation IDで新slugをactiveにしてから旧slugを解放する |
| TC-workspace-055 | createWorkspace: ワークスペースを 0 件所有 — 名前とスラッグを指定して作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | 非公開のワークスペースが作られ、作成者が owner の `Membership` を持つ |
| TC-workspace-056 | createWorkspace: — — スラッグを省略して作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | 作成が成功し、`slug: null` になる |
| TC-workspace-057 | createWorkspace: 既に使われているスラッグ — 作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | `ConflictError("SLUG_ALREADY_USED")` が投げられる |
| TC-workspace-058 | createWorkspace: — — 予約語（`new`）をスラッグに指定する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | `BusinessRuleError(SlugReserved)` が投げられる |
| TC-workspace-059 | createWorkspace: — — 2 文字のスラッグを指定する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | `BusinessRuleError(InvalidSlug)` が投げられる |
| TC-workspace-060 | createWorkspace: — — 名前を空文字列にして作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | `BusinessRuleError(InvalidName)` が投げられる |
| TC-workspace-061 | createWorkspace: — — 81 文字の名前で作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | `BusinessRuleError(InvalidName)` が投げられる |
| TC-workspace-062 | createWorkspace: ワークスペースを 19 件所有 — 作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | 成功する（上限の境界値） |
| TC-workspace-063 | createWorkspace: ワークスペースを 20 件所有 — 作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | `BusinessRuleError(WorkspaceQuotaExceeded)` が投げられる |
| TC-workspace-064 | createWorkspace: 作成直後 — 公開状態を確認する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | `publication: "private"` になっている |
| TC-workspace-065 | createWorkspace: 同じスラッグで 2 つの要求が同時に走る — 両方が作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | 片方は成功、もう片方は `ConflictError("SLUG_ALREADY_USED")` になる |
| TC-workspace-066 | createWorkspace: slug / membership reservation後にworkspace commitが失敗 — 作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | operation IDでglobal reservationを解放し、directoryにactive workspaceを残さない |
| TC-workspace-067 | createWorkspace: local commit後にglobal activation応答を失う — recoveryを実行する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | 同じoperation IDでedge / slug / directoryをactiveにし、Workspaceを二重作成しない |
| TC-workspace-068 | createWorkspace: pending workspaceを含め所有数20件 — 作成する | spec/testcases/workspace/createWorkspace.md#テストケース-createworkspace | quota回避を防ぐため `WorkspaceQuotaExceeded` |
| TC-workspace-069 | deleteMembershipsForUser: account deletionが3 workspace edgeを列挙 — 各scope commandを実行する | spec/testcases/workspace/deleteMembershipsForUser.md#テストケース-deletemembershipsforuser | 1 commandは指定された1 workspaceだけを処理し、3 scopeが独立にackする |
| TC-workspace-070 | deleteMembershipsForUser: targetが唯一のowner — commandを処理する | spec/testcases/workspace/deleteMembershipsForUser.md#テストケース-deletemembershipsforuser | local transactionの再検査で `LastOwnerCannotLeave`、membershipを削除しない |
| TC-workspace-071 | deleteMembershipsForUser: ownerが他にもいる — commandを処理する | spec/testcases/workspace/deleteMembershipsForUser.md#テストケース-deletemembershipsforuser | 本人のactive Job終端・著者投影置換・membership削除を同じscopeのtask列で完了する |
| TC-workspace-072 | deleteMembershipsForUser: 他利用者のmembership / Jobがある — 処理する | spec/testcases/workspace/deleteMembershipsForUser.md#テストケース-deletemembershipsforuser | 触れない |
| TC-workspace-073 | deleteMembershipsForUser: 同じoperation IDを2回配送 — 処理する | spec/testcases/workspace/deleteMembershipsForUser.md#テストケース-deletemembershipsforuser | `applied_operations` により保存済み結果を返す |
| TC-workspace-074 | deleteMembershipsForUser: local ack後にglobal更新が失敗 — recoveryを実行する | spec/testcases/workspace/deleteMembershipsForUser.md#テストケース-deletemembershipsforuser | local権限は既に失われ、directory edgeだけをoperation IDで削除する |
| TC-workspace-075 | deleteMembershipsForUser: pending edgeでlocal membershipがない — commandを処理する | spec/testcases/workspace/deleteMembershipsForUser.md#テストケース-deletemembershipsforuser | 0件でackし、global pending edgeを削除できる |
| TC-workspace-076 | deleteWorkspace: owner である — 正しいワークスペース名を入力して削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | operation IDとacceptedが返り、manifest/cleanup完了後にワークスペースが削除されてoperation ID付き`workspace.deleted`が発行される |
| TC-workspace-077 | deleteWorkspace: `beginDeletion`をcommitする — acceptedを返す | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 同じUoWで最初の`workspace.deletionLocalContinued { operationId }`が保存され、accepted後に停止してもAlarmから開始できる |
| TC-workspace-078 | deleteWorkspace: — — 誤った名前を入力して削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `ValidationError("CONFIRMATION_MISMATCH")` が投げられ、削除されない |
| TC-workspace-079 | deleteWorkspace: editor である — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-080 | deleteWorkspace: 実行中の変換ジョブがある — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | ジョブがキャンセルされてから削除される |
| TC-workspace-081 | deleteWorkspace: 取り消し対象の収集 — 引くクエリを確認する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `JobRepository.listActiveByScope({ type: "workspace", workspaceId })` だけを `limit: 100` で引き、返ったすべてに `Job.cancel` を適用する（要求者では絞らない） |
| TC-workspace-082 | deleteWorkspace: 網が 100 件を返した — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 100 件を終端させ、`origin: { path: "deleteWorkspace", workspaceId, deletionOperationId }`の継続を積む |
| TC-workspace-083 | deleteWorkspace: 網が 40 件を返した — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 40 件を終端させ、継続要求は積まない |
| TC-workspace-084 | deleteWorkspace: 継続要求の `origin` — 内容を確認する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 選択用workspaceIdに加えてadmission用deletionOperationIdを運び、各turnでowner一致を確認する |
| TC-workspace-085 | deleteWorkspace: 他のメンバーが要求した、そのワークスペースのノートの実行中ジョブ — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `scope` が一致するため `listActiveByScope` で拾われて取り消される |
| TC-workspace-086 | deleteWorkspace: そのワークスペースの公開ノートに対する匿名の PDF 書き出しジョブが実行中 — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `requestedBy: null` でも `scope` が一致するため `listActiveByScope` で拾われて取り消される |
| TC-workspace-087 | deleteWorkspace: メンバーが自分の個人ノートを対象に要求した実行中ジョブ — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `scope` が `user` のため `listActiveByScope({ type: "workspace" })` には現れず、取り消されない |
| TC-workspace-088 | deleteWorkspace: 取り消し対象のワーカーがリース有効で実行中 — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `Job.cancel` はリースを検査せず終端化するため、ワーカーの生存を待たずに取り消される |
| TC-workspace-089 | deleteWorkspace: 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存される（対象ノートごと消える経路のため結果的に無意味だが、規則を経路ごとに分けない） |
| TC-workspace-090 | deleteWorkspace: 取り消した batch 親（一括ダウンロードなど）に、既に成功した子がある — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 「共通: 強制終端の後始末」の 2 に従い、`JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact だけが `deleteFiles` で破棄され、ワークスペースの削除と同一 UoW で保存される |
| TC-workspace-091 | deleteWorkspace: 取り消した単体ジョブ（batch 親ではない） — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 生成物の回収は起きない。`Job.cancel` が受け取るのは `QueuedJob \| RunningJob` で、`artifact` を持つのは `succeeded` のジョブだけだからである |
| TC-workspace-092 | deleteWorkspace: 公開ノートを持つ — 削除後にそのノートの URL を開く | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 「見つかりません」が返る |
| TC-workspace-093 | deleteWorkspace: メンバーが 3 名いる — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 全員がそのワークスペースにアクセスできなくなる |
| TC-workspace-094 | deleteWorkspace: ゴミ箱にノートがある — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | ゴミ箱の内容も削除される |
| TC-workspace-095 | deleteWorkspace: メンバーシップと招待がある — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | userId/tokenHash/local IDをmanifestへ固定し、local edgeを100件ずつ消してからRESTRICT下でWorkspaceを最後に消す |
| TC-workspace-096 | deleteWorkspace: ノート・タグ・ファイル・クォータがある — 削除後に関連データを確認する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `workspace.deleted` の購読ユースケース（`deleteNotesForOwner` / `deleteTagsForScope` / `deleteFilesByOwner` / `deleteQuota`）によって後始末される |
| TC-workspace-097 | deleteWorkspace: ワークスペース所有ノートのタグが個人スコープのタグと同名 — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `deleteTagsForScope` はワークスペーススコープのタグと付与だけを消し、個人スコープの同名タグは残る |
| TC-workspace-098 | deleteWorkspace: ワークスペース所有ノートのバックアップ記録がある — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `workspace.deleted` は購読されず、`deleteNotesForOwner` が 1 件ずつ発行する `note.purged` を購読する `deleteBackupRecordsForNote` が削除する（`backup_records` は owner 列を持たない） |
| TC-workspace-099 | deleteWorkspace: 削除後 — 同じスラッグで新しいワークスペースを作る | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 作成できる |
| TC-workspace-100 | deleteWorkspace: directory tombstoneを保存する — rowを確認する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `slug = null`・表示PII redactedであり、tombstone確定後にslug reservationをreleaseする |
| TC-workspace-101 | deleteWorkspace: workspaceを削除する — 物理境界を確認する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | Job終端・Workspace/Membership/Invitation削除・cleanup task登録は1つのworkspace DOで複数bounded UoWに分ける |
| TC-workspace-102 | deleteWorkspace: local削除後にglobal更新が遅延 — 公開slugを開く | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `workspace_directory` tombstoneによりnot foundとなり、旧scopeへ権限を与えない |
| TC-workspace-103 | deleteWorkspace: directory cleanupの応答を失う — recoveryを実行する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | local manifestのuserId/tokenHashとoperation IDでslug / invitation route / membership edgesを冪等に削除する |
| TC-workspace-104 | deleteWorkspace: メンバー・招待が数千件ある — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | manifest作成/local削除/global cleanupを100件pageで継続し、Workspace親DELETEへ一括CASCADEしない |
| TC-workspace-105 | deleteWorkspace: 最後のlocal edge削除後・Workspace削除前に停止する — recoveryする | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | manifestのlocal ackから再開して子0件を確認し、Workspaceとeventを1回だけ保存する |
| TC-workspace-106 | deleteWorkspace: Workspace行削除後にlocal cleanup taskが再開する — taskを処理する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | payloadの削除operation IDがcompleted前のmanifest ownerと一致する場合だけcontinuationを受理する |
| TC-workspace-107 | deleteWorkspace: Workspace行削除後に通常writeまたは別operation IDのcleanupが届く — 処理する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | manifest header/tombstoneにより`WORKSPACE_DELETING`またはoperation不一致として拒否する |
| TC-workspace-108 | deleteWorkspace: deletionを受理してmanifestを構築中 — 招待発行・受諾、member変更、Note/Job作成を試す | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 永続`deleting(operationId)` admissionにより全て`WORKSPACE_DELETING`で拒否され、cursor後方へ新規対象が入らない |
| TC-workspace-109 | deleteWorkspace: manifest page commit後にworkerが停止する — recoveryする | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 保存済みcursorと同じoperation IDから再開し、workspaceをactiveへ戻さない |
| TC-workspace-110 | deleteWorkspace: manifest buildまたはlocal edge削除が100件で続く — taskを確認する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | page/cursor/ackと次の`workspace.deletionLocalContinued`を同じUoWで保存する |
| TC-workspace-111 | deleteWorkspace: global reservation直後にdeletingへ切り替わる — invite/acceptのlocal commitを試す | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 2回目のadmission検査で拒否し、確保済みreservationをabandonする |
| TC-workspace-112 | deleteWorkspace: global directoryをreshard中 — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | manifestの各route keyを旧新generationへdeleteし、ack後にだけmanifestを消す |
| TC-workspace-113 | deleteWorkspace: local/global ack済みmanifest itemが101件ある — 縮約する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 100件を消して`workspace.deletionManifestCompactContinued`を再登録し、残り1件の後にheaderをcompletedにする |
| TC-workspace-114 | deleteWorkspace: ack済みmanifest itemが数千件ある — 縮約する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 各Alarm turnのDELETEは100件以下で、header遷移に全item削除を同居させない |
| TC-workspace-115 | deleteWorkspace: 最終100件削除の応答を失う — recoveryする | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | 同じoperation IDでitem 0件を確認し、completed tombstoneを1回だけ保存する |
| TC-workspace-116 | deleteWorkspace: workspace内ノートの移動がstage済み、または切替後の後処理中である — 削除する | spec/testcases/workspace/deleteWorkspace.md#テストケース-deleteworkspace | `WorkspaceOperationLockStore.hasActiveMove` が競合を検出し、移動を完了またはabortするまで `ConflictError("WORKSPACE_MOVE_IN_PROGRESS")` で削除を拒否する |
| TC-workspace-117 | getInvitationPreview: 有効な保留中の招待 — トークンで引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | ワークスペース名・説明・ロール・招待者名が返り、`state: "acceptable"` になる |
| TC-workspace-118 | getInvitationPreview: 期限切れの招待 — 引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | `state: "expired"` が返る |
| TC-workspace-119 | getInvitationPreview: 取り消し済みの招待 — 引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | `state: "revoked"` が返る |
| TC-workspace-120 | getInvitationPreview: 受諾済みの招待 — 引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | `state: "accepted"` が返る |
| TC-workspace-121 | getInvitationPreview: ワークスペースが削除済み — 引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | `state: "workspaceMissing"` が返る |
| TC-workspace-122 | getInvitationPreview: サインイン中で既にメンバー — 引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | `state: "alreadyMember"` が返る |
| TC-workspace-123 | getInvitationPreview: 未サインインで有効な招待 — 引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | `state: "acceptable"` が返る（サインインは受諾時に求める） |
| TC-workspace-124 | getInvitationPreview: 存在しないトークン — 引く | spec/testcases/workspace/getInvitationPreview.md#テストケース-getinvitationpreview | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる |
| TC-workspace-125 | getPublicWorkspace: 公開中のワークスペース — スラッグで引く | spec/testcases/workspace/getPublicWorkspace.md#テストケース-getpublicworkspace | 名前・説明・アイコンが返る |
| TC-workspace-126 | getPublicWorkspace: 非公開のワークスペース — スラッグで引く | spec/testcases/workspace/getPublicWorkspace.md#テストケース-getpublicworkspace | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる |
| TC-workspace-127 | getPublicWorkspace: 存在しないスラッグ — 引く | spec/testcases/workspace/getPublicWorkspace.md#テストケース-getpublicworkspace | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる |
| TC-workspace-128 | getPublicWorkspace: 形式が不正なスラッグ — 引く | spec/testcases/workspace/getPublicWorkspace.md#テストケース-getpublicworkspace | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる（バリデーションエラーにしない） |
| TC-workspace-129 | getPublicWorkspace: 削除済みのワークスペース — 引く | spec/testcases/workspace/getPublicWorkspace.md#テストケース-getpublicworkspace | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる |
| TC-workspace-130 | getPublicWorkspace: — — 引く | spec/testcases/workspace/getPublicWorkspace.md#テストケース-getpublicworkspace | 応答にメンバーの情報が含まれない |
| TC-workspace-131 | inviteMember: owner である — 未参加のメールアドレスを editor で招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | `PendingInvitation` が作られ、招待メールが送られ、招待 URL が返る |
| TC-workspace-132 | inviteMember: owner である — owner ロールで招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | 招待が作られる |
| TC-workspace-133 | inviteMember: editor である — 招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-134 | inviteMember: 既にメンバーのメールアドレス — 招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | `ConflictError("ALREADY_MEMBER")` が投げられる |
| TC-workspace-135 | inviteMember: 同じメールアドレスに保留中の招待がある — 再度招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | `resendInvitation` を呼ぶ末尾呼び出しになり、トークンと期限が更新される。`inviteMember` は手順 5 までに書き込みを行わないため `run` の入れ子は生じず、新しい招待行は作られない |
| TC-workspace-136 | inviteMember: 保留中の招待が editor で、owner を指定して再度招待する — 再度招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | ロールは editor のまま変わらない（変えたい場合は取り消してから招待し直す）。返る `role` も既存の招待の値 |
| TC-workspace-137 | inviteMember: — — 形式が不正なメールアドレスで招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | `BusinessRuleError(InvalidEmail)` が投げられる |
| TC-workspace-138 | inviteMember: — — 未知のロールで招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | `BusinessRuleError(InvalidRole)` が投げられる |
| TC-workspace-139 | inviteMember: 直近 24 時間に 49 件招待済み — 招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | 招待が成立する（上限 50 件の境界値） |
| TC-workspace-140 | inviteMember: 直近 24 時間に 50 件招待済み — 招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | `ValidationError("INVITATION_LIMIT_REACHED")` が投げられる（境界値。レート制限ではなくクォータであり、解除までの時間は添えない） |
| TC-workspace-141 | inviteMember: 上限に達した状態で招待が 1 件受諾される — 招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | 未処理の件数が減るため成功する（時間の経過を待たずに枠が空く） |
| TC-workspace-142 | inviteMember: メール送信基盤が失敗する — 招待する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | 招待は成立し、送信失敗が記録される |
| TC-workspace-143 | inviteMember: 招待作成直後 — 有効期限を確認する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | 発行から 14 日後になっている |
| TC-workspace-144 | inviteMember: 新規招待 — route処理を確認する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | global reserved → local Invitation commit → global activeの順で、active後にメールを送る |
| TC-workspace-145 | inviteMember: route予約後にlocal commitが失敗する — 再試行する | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | reservationをabandonし、Invitationもメールも残らない |
| TC-workspace-146 | inviteMember: local commit後にactivate応答を失う — recoveryする | spec/testcases/workspace/inviteMember.md#テストケース-invitemember | 同じoperation IDでactive化し、Invitationを二重作成しない |
| TC-workspace-147 | leaveWorkspace: editor として参加している — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | directory edgeを`removing`にしてから`Membership`を削除する |
| TC-workspace-148 | leaveWorkspace: 唯一の owner である — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる |
| TC-workspace-149 | leaveWorkspace: owner が 2 名いるうちの 1 人 — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 脱退が成功する |
| TC-workspace-150 | leaveWorkspace: 参加していない — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる |
| TC-workspace-151 | leaveWorkspace: 脱退後 — そのワークスペースのノートを開く | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 「見つかりません」が返る |
| TC-workspace-152 | leaveWorkspace: 自分が作成したノートがある — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | ノートはワークスペースに残る |
| TC-workspace-153 | leaveWorkspace: 自分が要求した、そのワークスペースのノートの変換・再生成・バックアップジョブが実行中 — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | `removeMember` の手順 4 と同じ規則で `limit: 100` の網を引き、脱退者が要求した分だけが `Job.cancel` される |
| TC-workspace-154 | leaveWorkspace: 網が 100 件を返した — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 脱退と同じ UoW で継続要求 `job.terminationContinued { origin: { path: "leaveWorkspace", workspaceId, memberUserId } }` を積む（`memberUserId` は脱退者自身）。続きは `continueForcedTermination` が引き受け、`removeMember` と同じ絞り込みを保つ |
| TC-workspace-155 | leaveWorkspace: 他のメンバーが要求した実行中ジョブが同じワークスペースにある — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 触れられず、実行が続く |
| TC-workspace-156 | leaveWorkspace: そのワークスペースのノートに対する匿名の PDF 書き出しジョブが実行中 — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | `requestedBy: null` は脱退者と一致しないため取り消されない |
| TC-workspace-157 | leaveWorkspace: 脱退者が自分の個人ノートに対して持つ実行中ジョブがある — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | `scope` が `user` のため対象に入らず、取り消されない |
| TC-workspace-158 | leaveWorkspace: 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる |
| TC-workspace-159 | leaveWorkspace: 取り消した `kind: "regeneration"` のジョブ — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 本文は `ready` のまま変更されない |
| TC-workspace-160 | leaveWorkspace: 取り消した batch 親（脱退者が要求した一括ダウンロード）に、既に成功した子がある — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 「共通: 強制終端の後始末」の 2 に従い、`JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact だけが `deleteFiles` で破棄される（脱退後もワークスペースのノート本文を含む中間生成物が手元に残らない） |
| TC-workspace-161 | leaveWorkspace: 取り消した単体ジョブ（batch 親ではない） — 脱退する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 生成物の回収は起きない（`Job.cancel` が受け取るのは未終端のジョブで、`artifact` を持つのは `succeeded` だけ。`removeMember` と同じ） |
| TC-workspace-162 | leaveWorkspace: 脱退した — 取り消しの契機を確認する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 取り消しは本ユースケースの手順内で行われる（`workspace.membership.removed` の購読で後から行うのではない） |
| TC-workspace-163 | leaveWorkspace: 脱退後 — `listUserWorkspaces` を呼ぶ | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | そのワークスペースが一覧に現れない |
| TC-workspace-164 | leaveWorkspace: 脱退後 — `resolveWorkspaceAccess` を呼ぶ | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | `role: null` が返る（再参加には新しい招待の受諾が必要） |
| TC-workspace-165 | leaveWorkspace: 脱退後 — 保留中の招待なしで `acceptInvitation` を試みる | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | 有効な招待トークンがないため `NotFoundError("INVITATION_NOT_FOUND")` が投げられる |
| TC-workspace-166 | leaveWorkspace: local脱退commit後にdirectory更新が失敗 — 再試行する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | scopeでは既に権限なしで、global edgeはoperation IDで後から削除される |
| TC-workspace-167 | leaveWorkspace: Membership削除後にJob履歴正データまたはBackupRecordが残る — cleanupを確認する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | edgeは`removing`のまま、scope Alarmでresidueを削除し `job.removed` を発行する |
| TC-workspace-168 | leaveWorkspace: residue cleanupがackした — directoryを確認する | spec/testcases/workspace/leaveWorkspace.md#テストケース-leaveworkspace | edgeを削除し、以後account deletionがこのscopeを列挙しなくても利用者所有データは残らない |
| TC-workspace-169 | listMembers: owner で 3 名のメンバーがいる — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | 3 件が表示名・メール・ロール・参加日つきで返り、`canManage: true` になる |
| TC-workspace-170 | listMembers: viewer である — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | メンバー一覧が返り、`canManage: false` になる |
| TC-workspace-171 | listMembers: 非メンバーである — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-172 | listMembers: owner が 2 名いる — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | `ownerCount: 2` が返る |
| TC-workspace-173 | listMembers: メンバーが `limit` を超える — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | `limit` 件と総件数が返る |
| TC-workspace-174 | listMembers: ページング値が範囲外 — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | `ValidationError("INVALID_PAGINATION")` が投げられる（一覧系ユースケース共通の規約） |
| TC-workspace-175 | listMembers: 削除済みの利用者がメンバーに残っている — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | その行は表示名を解決できない旨を示して返る（エラーにしない） |
| TC-workspace-176 | listMembers: 1pageの100メンバーが32 User shardへ分散する — 一覧する | spec/testcases/workspace/listMembers.md#テストケース-listmembers | UserIdでgroupingし、最大6接続のwaveで現在の利用者表示を解決する |
| TC-workspace-177 | listPendingInvitations: owner で保留中の招待が 2 件ある — 一覧する | spec/testcases/workspace/listPendingInvitations.md#テストケース-listpendinginvitations | 2 件が返る |
| TC-workspace-178 | listPendingInvitations: 受諾済み・取り消し済みの招待がある — 一覧する | spec/testcases/workspace/listPendingInvitations.md#テストケース-listpendinginvitations | それらは含まれない |
| TC-workspace-179 | listPendingInvitations: 期限切れの保留中の招待がある — 一覧する | spec/testcases/workspace/listPendingInvitations.md#テストケース-listpendinginvitations | 含まれ、`expired: true` になる |
| TC-workspace-180 | listPendingInvitations: editor である — 一覧する | spec/testcases/workspace/listPendingInvitations.md#テストケース-listpendinginvitations | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-181 | listPendingInvitations: 保留中の招待が 0 件 — 一覧する | spec/testcases/workspace/listPendingInvitations.md#テストケース-listpendinginvitations | 空配列と `count: 0` が返る |
| TC-workspace-182 | listPendingInvitations: — — 一覧する | spec/testcases/workspace/listPendingInvitations.md#テストケース-listpendinginvitations | 応答に招待トークンが含まれない |
| TC-workspace-183 | listPublicWorkspaces: 公開ワークスペースが 3 件ある — 列挙する | spec/testcases/workspace/listPublicWorkspaces.md#テストケース-listpublicworkspaces | 3 件のスラッグと更新日時が返る |
| TC-workspace-184 | listPublicWorkspaces: 非公開のワークスペースがある — 列挙する | spec/testcases/workspace/listPublicWorkspaces.md#テストケース-listpublicworkspaces | それは含まれない |
| TC-workspace-185 | listPublicWorkspaces: 削除済みのワークスペースがある — 列挙する | spec/testcases/workspace/listPublicWorkspaces.md#テストケース-listpublicworkspaces | それは含まれない |
| TC-workspace-186 | listPublicWorkspaces: 公開ワークスペースが 0 件 — 列挙する | spec/testcases/workspace/listPublicWorkspaces.md#テストケース-listpublicworkspaces | 空配列、`nextCursor: null`、`hasMore: false` が返る |
| TC-workspace-187 | listPublicWorkspaces: 件数が `limit` を超える — 列挙する | spec/testcases/workspace/listPublicWorkspaces.md#テストケース-listpublicworkspaces | `limit` 件と署名opaque `nextCursor`が返り、総件数の全shard countは行わない |
| TC-workspace-188 | listPublicWorkspaces: 公開workspaceが32 shardへ分散する — 列挙する | spec/testcases/workspace/listPublicWorkspaces.md#テストケース-listpublicworkspaces | 同時6接続のwaveで全体最大200件へmergeする |
| TC-workspace-189 | listPublicWorkspaces: reshard中に同じworkspaceが旧新へ存在する — 列挙する | spec/testcases/workspace/listPublicWorkspaces.md#テストケース-listpublicworkspaces | WorkspaceIdで重複排除し、大きいsourceVersionを採る |
| TC-workspace-190 | listUserWorkspaces: 3 つのワークスペースに参加している — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | 3 件が参加日時降順・WorkspaceId tie-breakで返り、それぞれ自分のロールが含まれる |
| TC-workspace-191 | listUserWorkspaces: どこにも参加していない — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | 空配列が返る |
| TC-workspace-192 | listUserWorkspaces: viewer として参加している — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | そのワークスペースも含まれ、`role: "viewer"` になる |
| TC-workspace-193 | listUserWorkspaces: 除名された直後 — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | そのワークスペースは含まれない |
| TC-workspace-194 | listUserWorkspaces: ワークスペースが削除された — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | そのワークスペースは含まれない |
| TC-workspace-195 | listUserWorkspaces: 数千workspaceにviewerとして参加している — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | 1page最大20件とopaque nextCursorを返し、全件取得・名前sortを行わない |
| TC-workspace-196 | listUserWorkspaces: page内20 workspaceが複数directory shardへ分散する — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | WorkspaceIdでgroupingして最大6接続で表示を解決する |
| TC-workspace-197 | listUserWorkspaces: 同名workspaceが複数ある — 2page以上を読む | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | createdAt/WorkspaceId keysetにより欠落・重複せず返る |
| TC-workspace-198 | listUserWorkspaces: 1page目の後にworkspace名が変わる — 続きを読む | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | 並び順が名前に依存しないためcursorが無効化されず、対象を飛ばさない |
| TC-workspace-199 | listUserWorkspaces: directoryをreshard中 — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | routing generationに従って旧新を読み、WorkspaceId/versionで重複排除する |
| TC-workspace-200 | listUserWorkspaces: page内1 workspaceのdirectory shardだけ障害 — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | 他itemはactiveで返し、当該itemは`status: unavailable`とretryAfterを持つ |
| TC-workspace-201 | listUserWorkspaces: directory tombstoneを解決する — 一覧する | spec/testcases/workspace/listUserWorkspaces.md#テストケース-listuserworkspaces | `state: deleted`としてitemを落とし、unavailableとは区別する |
| TC-workspace-202 | publishWorkspace: owner、スラッグ設定済み、非公開 — 公開する | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | `publication: "published"` になり、`workspace.published` が発行され、公開ページの URL が返る |
| TC-workspace-203 | publishWorkspace: スラッグ未設定 — 公開する | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | `BusinessRuleError(SlugRequiredToPublish)` が投げられる |
| TC-workspace-204 | publishWorkspace: 公開ノートが 0 件 — 公開する | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | 公開は成功し、`publicNoteCount: 0` が返る（公開ページが空であることを画面が案内するために返す） |
| TC-workspace-205 | publishWorkspace: 公開ノートが 3 件ある — 公開する | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | `NoteQueryService.searchPublic` で数えた `publicNoteCount: 3` が返る |
| TC-workspace-206 | publishWorkspace: 出力の形 — `unpublishWorkspace` と比べる | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | 公開側だけが `publicNoteCount` を返す（取り下げ側の出力には含まれない） |
| TC-workspace-207 | publishWorkspace: 既に公開中 — 公開する | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | 変更もイベントも起きず成功する |
| TC-workspace-208 | publishWorkspace: editor である — 公開する | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-209 | publishWorkspace: 公開後 — 非公開のノートを外部から開く | spec/testcases/workspace/publishWorkspace.md#テストケース-publishworkspace | 「見つかりません」が返る（ワークスペースの公開はノートの公開範囲を変えない） |
| TC-workspace-210 | removeMember: owner で、対象が editor — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `Membership` が削除され、`membership.removed` が発行される |
| TC-workspace-211 | removeMember: owner が 1 名で、その owner を対象にする — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる |
| TC-workspace-212 | removeMember: owner で、自分自身のメンバーシップを対象にする（owner は 2 名いる） — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `BusinessRuleError(CannotRemoveSelf)` が投げられ、`leaveWorkspace` の利用を案内される |
| TC-workspace-213 | removeMember: editor である — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-214 | removeMember: 除名後 — 対象がそのワークスペースのノートを開く | spec/testcases/workspace/removeMember.md#テストケース-removemember | 「見つかりません」が返る |
| TC-workspace-215 | removeMember: 除名対象が作成したノートがある — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | ノートはワークスペースに残る |
| TC-workspace-216 | removeMember: 除名対象がノートを編集中 — 除名後に保存する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 保存が拒否される |
| TC-workspace-217 | removeMember: 除名対象が要求した、そのワークスペースのノートの変換・再生成・バックアップジョブが実行中 — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | current workspace scopeで `listActiveByRequester(memberUserId, 100)` を引き、対象だけが `Job.cancel` される |
| TC-workspace-218 | removeMember: cleanupが完了していない — directoryを確認する | spec/testcases/workspace/removeMember.md#テストケース-removemember | edgeは `removing` のまま残り、Job正データ・BackupRecord・security cleanupのack後だけ削除される |
| TC-workspace-219 | removeMember: 網が 100 件を返した — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 除名と同じ UoW で継続要求 `job.terminationContinued { origin: { path: "removeMember", workspaceId, memberUserId } }` を積む。続きは `continueForcedTermination` が引き受ける |
| TC-workspace-220 | removeMember: 継続要求の `origin` — 内容を確認する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `memberUserId` を必ず運ぶ。スコープだけを運ぶ形では、続きが他のメンバーのジョブと匿名ジョブまで取り消してしまい、上の 2 行（「触れられず、実行が続く」「取り消されない」）を 2 巡目で破る |
| TC-workspace-221 | removeMember: 他のメンバーが要求した実行中ジョブが同じワークスペースにある — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 触れられず、実行が続く |
| TC-workspace-222 | removeMember: そのワークスペースのノートに対する匿名の PDF 書き出しジョブが実行中 — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `requestedBy: null` は除名対象と一致しないため取り消されない |
| TC-workspace-223 | removeMember: 除名対象が自分の個人ノートに対して持つ実行中ジョブがある — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `scope` が `user` のため対象に入らず、取り消されない |
| TC-workspace-224 | removeMember: 除名対象が別のワークスペースで持つ実行中ジョブがある — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `scope` が異なるため取り消されない |
| TC-workspace-225 | removeMember: 取り消し対象のワーカーがリース有効で実行中 — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `Job.cancel` はリースを検査せず終端化するため、ワーカーの生存を待たずに取り消される |
| TC-workspace-226 | removeMember: 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる（ワークスペースに残るノートが「変換中」の表示で固定されない） |
| TC-workspace-227 | removeMember: 取り消した `kind: "regeneration"` のジョブ — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 本文は `ready` のまま変更されない |
| TC-workspace-228 | removeMember: 取り消した batch 親（除名対象が要求した一括ダウンロード）に、既に成功した子がある — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 「共通: 強制終端の後始末」の 2 に従い、`JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact だけが `deleteFiles` で破棄される（回収しないと、アクセス権を失った利用者の個人ストレージにワークスペースのノート本文を含む一括ダウンロードの生成物が 7 日残る） |
| TC-workspace-229 | removeMember: 取り消した単体ジョブ（batch 親ではない） — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 生成物の回収は起きない。`Job.cancel` が受け取るのは `QueuedJob \| RunningJob` で、`artifact` を持つのは `succeeded` のジョブだけだからである |
| TC-workspace-230 | removeMember: 除名対象が既に組み立て終えた ZIP や成功済みの PDF が期限内に残っている — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 終端させる集合が未終端のジョブだけであるため破棄されず、期限の経過による `collectExpiredArtifacts` の自動回収に委ねられる |
| TC-workspace-231 | removeMember: 除名した — 取り消しの契機を確認する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 取り消しは本ユースケースの手順内で行われる（`workspace.membership.removed` の購読で後から行うのではない） |
| TC-workspace-232 | removeMember: 存在しないメンバーシップ ID — 除名する | spec/testcases/workspace/removeMember.md#テストケース-removemember | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる |
| TC-workspace-233 | removeMember: 除名と対象者Job終端 — transactionを確認する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 同じworkspace DOのlocal transactionで成立し、他workspaceのJobを触らない |
| TC-workspace-234 | removeMember: local commit後にdirectory更新が遅延 — 対象者が操作する | spec/testcases/workspace/removeMember.md#テストケース-removemember | 一覧に一時表示されてもworkspace scopeのMembership再確認で拒否される |
| TC-workspace-235 | removeMember: 古いrole eventが後着 — directoryを更新する | spec/testcases/workspace/removeMember.md#テストケース-removemember | source version条件により削除済みedgeを復活させない |
| TC-workspace-236 | resendInvitation: owner で保留中の招待がある — 再送する | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | トークンと期限が更新され、メールが再送される |
| TC-workspace-237 | resendInvitation: 再送後 — 古い招待リンクを開く | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | 「無効です」として扱われる |
| TC-workspace-238 | resendInvitation: 受諾済みの招待 — 再送する | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | `ValidationError("INVITATION_NOT_PENDING")` が投げられる |
| TC-workspace-239 | resendInvitation: 取り消し済みの招待 — 再送する | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | `ValidationError("INVITATION_NOT_PENDING")` が投げられる |
| TC-workspace-240 | resendInvitation: 期限切れの招待 — 再送する | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | 新しい期限で再送される |
| TC-workspace-241 | resendInvitation: 他のワークスペースの招待 ID を指定する — 再送する | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる |
| TC-workspace-242 | resendInvitation: editor である — 再送する | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-243 | resendInvitation: 新token予約後にlocal commitが失敗する — 再送する | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | 新reservationをabandonし、旧tokenは引き続き有効 |
| TC-workspace-244 | resendInvitation: local commit後にroute切替応答を失う — recoveryする | spec/testcases/workspace/resendInvitation.md#テストケース-resendinvitation | 同じoperation IDで旧route revoked / 新route activeを原子的に完了し、新tokenだけが到達可能 |
| TC-workspace-245 | resolveWorkspaceAccess: owner として参加している — 解決する | spec/testcases/workspace/resolveWorkspaceAccess.md#テストケース-resolveworkspaceaccess | `role: "owner"` とワークスペース名が返る |
| TC-workspace-246 | resolveWorkspaceAccess: editor として参加している — 解決する | spec/testcases/workspace/resolveWorkspaceAccess.md#テストケース-resolveworkspaceaccess | `role: "editor"` が返る |
| TC-workspace-247 | resolveWorkspaceAccess: viewer として参加している — 解決する | spec/testcases/workspace/resolveWorkspaceAccess.md#テストケース-resolveworkspaceaccess | `role: "viewer"` が返る |
| TC-workspace-248 | resolveWorkspaceAccess: 参加していない — 解決する | spec/testcases/workspace/resolveWorkspaceAccess.md#テストケース-resolveworkspaceaccess | `role: null` が返る（エラーにしない） |
| TC-workspace-249 | resolveWorkspaceAccess: ワークスペースが存在しない — 解決する | spec/testcases/workspace/resolveWorkspaceAccess.md#テストケース-resolveworkspaceaccess | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる |
| TC-workspace-250 | resolveWorkspaceAccess: ワークスペースが削除済み — 解決する | spec/testcases/workspace/resolveWorkspaceAccess.md#テストケース-resolveworkspaceaccess | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる |
| TC-workspace-251 | resolveWorkspaceAccess: 除名された直後 — 解決する | spec/testcases/workspace/resolveWorkspaceAccess.md#テストケース-resolveworkspaceaccess | `role: null` が返る |
| TC-workspace-252 | revokeInvitation: owner で保留中の招待がある — 取り消す | spec/testcases/workspace/revokeInvitation.md#テストケース-revokeinvitation | `status: "revoked"` になり、`invitation.revoked` が発行される |
| TC-workspace-253 | revokeInvitation: 取り消し後 — その招待リンクを開く | spec/testcases/workspace/revokeInvitation.md#テストケース-revokeinvitation | 取り消し済みとして扱われる |
| TC-workspace-254 | revokeInvitation: 受諾済みの招待 — 取り消す | spec/testcases/workspace/revokeInvitation.md#テストケース-revokeinvitation | `ValidationError("INVITATION_NOT_PENDING")` が投げられる |
| TC-workspace-255 | revokeInvitation: 存在しない招待 ID — 取り消す | spec/testcases/workspace/revokeInvitation.md#テストケース-revokeinvitation | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる |
| TC-workspace-256 | revokeInvitation: editor である — 取り消す | spec/testcases/workspace/revokeInvitation.md#テストケース-revokeinvitation | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-257 | revokeInvitation: 取り消し後 — 同じメールアドレスに再度招待する | spec/testcases/workspace/revokeInvitation.md#テストケース-revokeinvitation | 新しい招待が作られる |
| TC-workspace-258 | revokeInvitation: local revoke後にglobal応答を失う — recoveryする | spec/testcases/workspace/revokeInvitation.md#テストケース-revokeinvitation | local正データは即時にacceptを拒否し、同じoperation IDでrouteをrevokedへ収束させる |
| TC-workspace-259 | unpublishWorkspace: owner、公開中 — 非公開に戻す | spec/testcases/workspace/unpublishWorkspace.md#テストケース-unpublishworkspace | `publication: "private"` になり、`workspace.unpublished` が発行される |
| TC-workspace-260 | unpublishWorkspace: 非公開に戻した — 出力を確認する | spec/testcases/workspace/unpublishWorkspace.md#テストケース-unpublishworkspace | `workspaceId` と `publication` だけが返り、`publicNoteCount` は含まれない（取り下げ後の公開ページは存在せず、数えても画面で使い道がないため） |
| TC-workspace-261 | unpublishWorkspace: 公開中にスラッグを設定していた — 非公開に戻す | spec/testcases/workspace/unpublishWorkspace.md#テストケース-unpublishworkspace | スラッグは残り、再公開すると同じ URL に戻せる（スラッグの解除は `changeWorkspaceSlug` が担う） |
| TC-workspace-262 | unpublishWorkspace: 非公開に戻した後 — 公開ページの URL を開く | spec/testcases/workspace/unpublishWorkspace.md#テストケース-unpublishworkspace | 「見つかりません」が返る |
| TC-workspace-263 | unpublishWorkspace: 非公開に戻した後 — 公開ステータスのノートの URL を直接開く | spec/testcases/workspace/unpublishWorkspace.md#テストケース-unpublishworkspace | ノート自体は引き続き閲覧できる |
| TC-workspace-264 | unpublishWorkspace: 既に非公開 — 非公開に戻す | spec/testcases/workspace/unpublishWorkspace.md#テストケース-unpublishworkspace | 変更もイベントも起きず成功する |
| TC-workspace-265 | unpublishWorkspace: owner でない — 非公開に戻す | spec/testcases/workspace/unpublishWorkspace.md#テストケース-unpublishworkspace | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-266 | updateWorkspaceProfile: owner である — 名前と説明を更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | 値が更新される |
| TC-workspace-267 | updateWorkspaceProfile: editor である — 更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-268 | updateWorkspaceProfile: viewer である — 更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-269 | updateWorkspaceProfile: 非メンバーである — 更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | `BusinessRuleError(InsufficientRole)` が投げられる |
| TC-workspace-270 | updateWorkspaceProfile: 公開中のワークスペース — 名前を更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | 公開状態は保たれる |
| TC-workspace-271 | updateWorkspaceProfile: ワークスペース所有のノートがある — 名前を更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | `workspace.profileUpdated` が発行され、`projectNoteChanges` が読み取りモデルのワークスペース名を更新する |
| TC-workspace-272 | updateWorkspaceProfile: ワークスペース所有のノートがある — 名前は変えず説明だけを更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | `workspace.profileUpdated` は発行されず、読み取りモデルは更新されない |
| TC-workspace-273 | updateWorkspaceProfile: — — 名前を空文字列にする | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | `BusinessRuleError(InvalidName)` が投げられる |
| TC-workspace-274 | updateWorkspaceProfile: 同時に別の要求が更新した — 更新する | spec/testcases/workspace/updateWorkspaceProfile.md#テストケース-updateworkspaceprofile | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる |

