# ユースケース: Storage

ドメインの詳細は [domains/storage.md](../domains/storage.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

クォータの検査は **Usage のユースケース `ensureUploadAllowed`** を呼んで行う（[usecases/usage.md](./usage.md)）。Usage のドメインサービス `QuotaEnforcement` やリポジトリを Storage のユースケースから直接触ることはしない — Storage ドメインは Usage に依存しない（[domains/index.md](../domains/index.md) の依存表）ので、他ドメインの集約を読む必要のある判定はそのドメインのユースケース越しに行う。同じ理由で、`storeUpload` は消費（`consumeLlmCall`）を行わない。ここでの検査は受け付け時の事前確認にとどまり、実際の消費は `runConversion` / `runRegeneration` が行う。

生成物（`artifact`）の `StoredFile.registerEphemeral` は Note 側のエクスポート系ユースケース（`runNoteExport` / `runBulkExport` など）が行う。その帰属は [domains/storage.md](../domains/storage.md) の `StorageOwner` / `FileProvenance` の規則に従う: サインイン済みの要求では要求者の個人 subject、匿名の PDF エクスポートでは対象ノートの所有文脈に帰属し、`uploadedBy` は匿名時のみ `null`（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。

## startBulkUpload

### 概要

複数ファイルのアップロードを開始し、親ジョブを作る（IM-02）。実際の保管と変換は、ファイルごとに `storeUpload` が担う。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string \| null` | — | — |
| `files` | `{ fileName: string; declaredMimeType: string; size: number }[]` | ○ | 1〜100 件 |
| `visibility` | `"private" \| "unlisted" \| "public"` | ○ | 既定は `private` |
| `conversionPreference` | `"auto" \| "machineOnly"` | ○ | 既知の値。既定は `auto` |

### 出力DTO

`parentJobId: string`, `accepted: { index: number; fileName: string; format: string; requiresLlm: boolean }[]`, `rejected: { index: number; fileName: string; reason: string }[]`, `llmRequiredCount: number`, `llmAvailable: boolean`

このユースケースはファイルの内容（head）を読まない。`accepted` の `format` / `requiresLlm` と `llmRequiredCount` は宣言 MIME・拡張子から導いた**暫定値**であり、内容に基づく確定判定は `storeUpload` / `runConversion`（`FormatDetector.detect`）が行う。暫定値と確定判定が食い違うことがある。

`llmRequiredCount` は `conversionPreference` に依らず「LLM 構造化を要する見込みの件数」を数える。`auto` では「N 件は連携が必要です」の事前警告に、`machineOnly` では「N 件は機械的変換では取り込めません」の事前警告に使う（P-13）。`machineOnly` でも暫定判定にすぎないため受け付けは中止せず、確定判定と結果の記録は `storeUpload` / `runConversion` に委ねる。

### 処理フロー

1. 件数が 100 を超えれば `ValidationError("TOO_MANY_FILES")`、合計サイズが 500 MB を超えれば `ValidationError("UPLOAD_TOO_LARGE")`
2. 所有者を組み立て、ワークスペースなら `createNote` の権限を確認する
3. 各ファイルについて `UploadValidationPolicy.ensureAcceptable` を試し、通らないものを `rejected` に積む
4. `ensureUploadAllowed`（Usage のユースケース）を `llmCalls: 0` で呼び、受理したファイルの合計サイズに対する容量の残量を検査する（LLM 実行回数の検査はファイルごとの方針が決まる `storeUpload` 手順 7 で行う。ここでの `llmRequiredCount` は宣言 MIME からの暫定値にすぎず、回数の予約にも使わない）
5. OpenRouter 連携の有無を調べて `llmAvailable` とし、宣言 MIME・拡張子から LLM 構造化を要するファイルの件数を暫定的に数えて `llmRequiredCount` とする（未連携でも `machineOnly` でも受け付ける）
6. `Job.enqueueBatch(kind: "conversion", payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }, requestedBy: userId, scope, total: accepted.length)` で親ジョブを作って保存する。子の `storeUpload` は同じ payload の変換ジョブを作る（[domains/job.md](../domains/job.md) の `JobPayload`）
7. 呼び出し側は `accepted` の各ファイルを `storeUpload` に `parentJobId` と `conversionPreference` つきで送る。`storeUpload` は受理した 1 件につき変換ジョブを必ず 1 件作るため、子の件数は `total` と一致する（[domains/job.md](../domains/job.md) の batch 親の子ジョブ登録規則）

`scope` は手順 2 で組み立てた**取り込み先の所有文脈**から導出する（`ownerType === "user"` なら `{ type: "user", userId }`、`ownerType === "workspace"` なら `{ type: "workspace", workspaceId: ownerWorkspaceId }`。[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。要求者からは導かない — 参加ワークスペースへ取り込むアップロードの `scope` は `workspace` になる。このユースケースは取り込み先の所有者を入力として 1 つだけ受け取るため、対象を ID の並びで受け取る登録（`requestBulkExport` / `requestBulkNoteOperation` / `requestBackup`）と違って所有文脈が構造的に混在せず、`ValidationError("MIXED_OWNER_SCOPE")` の検査は要らない（[domains/job.md](../domains/job.md) の「batch 親の `scope` は単一である」）。子の `storeUpload` も同じ `ownerType` / `ownerWorkspaceId` を受け取るため、親子の `scope` は一致する。

親の `total` は登録後に変えない。子が `total` に届かないのは呼び出しが中断された場合（`storeUpload` 自体が失敗した、クライアントが離脱した）だけで、この異常系は親のリース失効による回収（`reapExpiredJobs` → `failed("timeout")`）に委ねる。既に取り込めたノートは子ジョブの結果として残る。

`visibility` が `public` の場合、公開ハンドル／スラッグが未設定なら `ValidationError("PUBLIC_HANDLE_REQUIRED")` として全体を中止する。取り込み後の公開ステータスの適用は、変換完了時に `changeNoteVisibility` 相当の処理として行う。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数・合計サイズの上限超過 | `ValidationError("TOO_MANY_FILES")` / `ValidationError("UPLOAD_TOO_LARGE")` |
| すべてのファイルが受け付け不可 | `ValidationError("NO_ACCEPTABLE_FILE")` |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| ワークスペースの権限不足 | `BusinessRuleError(InsufficientRole)` |
| 公開ハンドル未設定で公開を指定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")` |

## storeUpload

### 概要

アップロードされたファイルを保管し、ノートを作って変換ジョブを登録する（IM-01 / IM-02）。1 ファイルにつき 1 回呼ばれる。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string \| null` | — | `ownerType === "workspace"` のとき必須 |
| `fileName` | `string` | ○ | `FileName` の規則 |
| `declaredMimeType` | `string` | ○ | `MimeType` の規則 |
| `size` | `number` | ○ | `ByteSize` の規則 |
| `body` | `ReadableStream<Uint8Array>` | ○ | — |
| `parentJobId` | `string \| null` | — | `startBulkUpload` が返した親ジョブの ID |
| `visibility` | `"private" \| "unlisted" \| "public"` | ○ | 既定は `private` |
| `conversionPreference` | `"auto" \| "machineOnly"` | ○ | 既知の値。既定は `auto`。`machineOnly` は LLM 構造化を使わずに取り込む |

### 出力DTO

`noteId`, `fileId`, `contentStatus: string`, `contentFailureReason: string | null`, `conversionJobId: string`, `backupJobId: string | null`

`contentStatus` / `contentFailureReason` は作られたノートの `content` をそのまま写す。`failed` の理由を併せて返すのは、`machineExtractionUnavailable`（`auto` での取り込み直しを案内）と `unsupportedFormat`（形式が対象外）と `passwordProtected` で画面の案内が異なるため（P-13）。

### 処理フロー

1. 所有者を組み立て、ワークスペースなら `WorkspaceAuthorization.ensureCan(role, "createNote")` を呼ぶ。`visibility` が `public` なら公開に必要な所有文脈も併せて検査する — 個人所有は `owner.userId` の公開ハンドル、ワークスペース所有は公開スラッグ。未設定なら保管を始める前に `ValidationError("PUBLIC_HANDLE_REQUIRED")` を返す（`startBulkUpload` と同じ事前検査。単体アップロードの経路でも、バイト列を預けてから公開できないと分かる事態を避ける）
2. `UploadValidationPolicy.ensureAcceptable({ purpose: "source", mimeType, size })` を呼ぶ
3. `ensureUploadAllowed`（Usage のユースケース）を `llmCalls: 0` で呼び、容量の残量を確認する（LLM 回数の検査は方針が決まる 7 で行う）
4. `IdGenerator.next()` で `fileId` を採番し、`ObjectKey.build` で鍵を作る
5. `ObjectStorage.put` で保管し、実サイズとチェックサムを得る。宣言サイズと実サイズが食い違う場合は実サイズを採用する。あわせて**流したストリームの先頭 8192 バイトを退避**し、手順 6 の `head` に渡す。`StoredFile` の登録は手順 8 なので、この時点では `FileContentReader.readHead(fileId, 8192)` で読み直せない（読む範囲は `runConversion` / `requestRegeneration` の `readHead` と同じ 8192 バイトに揃える。[usecases/conversion.md](./conversion.md)）
6. `ConversionCapability` の `llm` を決める — `conversionPreference === "machineOnly"` なら `"declined"`、そうでなければ `ExternalConnectionRepository.findByUserAndProvider(userId, "openrouter")` の有無で `"available"` / `"unavailable"`。これを手順 5 で退避した `head` とともに `planConversionForUpload`（Conversion）に渡し、形式・方針（`ConversionPlan`）・本文の初期値（`InitialContentState`）を得る
7. 方針が LLM を要する場合（`ConversionPlan.requiresLlm(plan)` が真）、`ensureUploadAllowed` を `llmCalls: 1` で呼び、LLM 実行回数の残量を確認する
8. `StoredFile.register` と `Note.createFromUpload` を作る。`FileProvenance` は `{ purpose: "source", noteId, uploadedBy: userId }`（[domains/storage.md](../domains/storage.md)）。`initialContent` には 6 で得た `initialContent` をそのまま渡す — 状態と理由が 1 つの値に閉じているため、`failed(machineExtractionUnavailable)` と `failed(unsupportedFormat)` と `failed(passwordProtected)` は取り違えようがなく、`awaitingIntegration` との区別もここで再判定しない
9. 方針にかかわらず `Job.enqueue({ target: { type: "note", noteId }, payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }, scope, kind: "conversion", requestedBy: userId, parentId })` を作る。`parentJobId` があれば `parentId` に設定する
10. Drive の自動バックアップが有効なら `Job.enqueue({ target: { type: "storedFile", fileId }, payload: { kind: "driveBackup" }, scope, kind: "driveBackup", requestedBy: userId, parentId: null })` も作る
11. `UnitOfWorkProvider.run` でファイル・ノート・ジョブを保存し、すべてのイベントを収集する

**手順 9 の `requestedVisibility`**。`visibility` が `private` 以外でも、本文がまだないため保管の時点では適用できない。指定は手順 9 の変換ジョブの payload（`requestedVisibility`）として引き継ぎ、変換の成功後に `runConversion` の手順 14 が適用する（`changeNoteVisibility` ユースケースの呼び出しではなく、その手順の複製である。[usecases/conversion.md](./conversion.md) の「手順 14 は複製であって呼び出しではない」）。変換に失敗した場合は非公開のまま残す。手順 1 の事前検査（公開ハンドル／スラッグ）は、この後追いの適用が権限不足で失敗しないようにするためのものである。

**手順 9・10 の `scope`**。どちらも手順 1 で組み立てた**取り込み先の所有文脈**から導出する（`ownerType === "user"` なら `{ type: "user", userId }`、`ownerType === "workspace"` なら `{ type: "workspace", workspaceId: ownerWorkspaceId }`。[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。要求者からは導かない。手順 8 で作るノートの `NoteOwner` と元ファイル（`purpose: "source"`）の `StorageOwner` はいずれもこの所有者そのものなので、`note` を対象とする変換ジョブと `storedFile` を対象とするバックアップジョブは同じ `scope` になる。`parentJobId` があるとき（一括アップロードの子）は、親の `startBulkUpload` が同じ `ownerType` / `ownerWorkspaceId` から導出した値と一致し、親子の `scope` が一致するという不変条件を満たす。

方針が `unavailable`（`integrationRequired` / `machineExtractionUnavailable` / `unsupportedFormat`）でも変換ジョブを作り、終端化は `runConversion` に委ねる。理由:

- 一括アップロードの親ジョブの `total` は `startBulkUpload` が受理件数で確定させるため、子を省くと全子終端の判定が成立しなくなる。親の `total` を後から減らす案（子ジョブ側から親を書き換える）は、UoW の境界を跨ぐうえに並行する `storeUpload` が同じ親行を奪い合って競合を量産するので採らない
- 取り込めなかった事実がジョブ 1 行として処理履歴（JB-01）に現れ、原因の解消後に再試行（JB-02）できる
- 方針の判定が `runConversion` の 1 箇所に寄る。ここでの判定は head しか読まない暫定判定なので、内容に基づく確定判定で結果が変わりうる（`initialContent` は待たせないための暫定表示にすぎない）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未対応の MIME・拡張子 | `BusinessRuleError(UnsupportedMimeType)` |
| サイズ超過 | `BusinessRuleError(FileTooLarge)` |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| LLM 実行回数の上限到達 | `BusinessRuleError(LlmQuotaExceeded)`。機械的変換でも取り込める形式なら `conversionPreference: "machineOnly"` での再取り込みを案内する。LLM 必須形式では `machineOnly` にしても `machineExtractionUnavailable` になるため、翌月まで待つ案内のみとする |
| ワークスペースの権限不足 | `BusinessRuleError(InsufficientRole)` |
| 公開ハンドル未設定で公開を指定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")`（保管前に検出する） |
| `conversionPreference: "machineOnly"` で LLM 必須形式 | ノートは作り、`content` を `failed(machineExtractionUnavailable)` にする（`auto` での取り込み直しを案内する） |
| パスワード保護の検出 | ノートは作り、`content` を `failed(passwordProtected)` にする |
| オブジェクトストレージの失敗 | `SystemError(ExternalServiceError)`。ノートは作らない |
| 保管後にノート作成が失敗 | 保管したオブジェクトは孤児として回収対象にする |

## storeMedia

### 概要

エディタから挿入する画像・動画を保管する（ED-06）。

### 入力DTO

`userId`, `noteId`, `fileName`, `declaredMimeType`, `size`, `body`

### 出力DTO

`fileId`, `url: string`, `mimeType`, `size`

### 処理フロー

1. ノートを引き、`NoteAccessPolicy` で `canEdit` を確認する
2. `UploadValidationPolicy.ensureAcceptable({ purpose: "media", ... })` を呼ぶ
3. `ensureUploadAllowed`（Usage のユースケース）で容量を確認する
4. SVG の場合は `HtmlProcessor.process` と同じサニタイズ規則を適用してから保管する
5. `ObjectStorage.put` し、`StoredFile.register` を保存する。`FileProvenance` は `{ purpose: "media", noteId, uploadedBy: userId }`。永続化した `noteId` が、孤児判定（`collectOrphanMedia`）と `note.purged` 後の回収（`deleteFilesForNote`）の手がかりになる
6. 配信用の URL を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未対応の形式・サイズ超過 | `BusinessRuleError(UnsupportedMimeType)` / `BusinessRuleError(FileTooLarge)` |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| ノート不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## storeAvatar

### 概要

利用者・ワークスペースのアイコンを保管する（AC-07 / WS-07）。

### 入力DTO

`userId`, `subjectType: "user" | "workspace"`, `subjectId`, `fileName`, `declaredMimeType`, `size`, `body`

### 出力DTO

`fileId`, `url: string`

### 処理フロー

1. ワークスペースの場合は `manageWorkspace` の権限を確認する。利用者の場合は本人であることを確認する
2. `UploadValidationPolicy.ensureAcceptable({ purpose: "avatar", ... })` を呼ぶ
3. `ObjectStorage.put` し、`StoredFile.register` を作る。`FileProvenance` は `{ purpose: "avatar", noteId: null, uploadedBy: userId }`
4. `UnitOfWorkProvider.run` で新しいアイコンを保存し、既存のアイコンがあれば**同じ UoW で**「保管ファイルの削除手順」（下記 `deleteFiles`）を実行する。イベントはまとめて収集する。差し替えの前後で消費量が二重に計上されたまま残る状態を作らないため

**クォータを検査しないこと**。このユースケースは `ensureUploadAllowed`（Usage）を呼ばない。一方でアイコンは容量の集計に算入される（除外されるのは `purpose: "artifact"` だけ。[domains/usage.md](../domains/usage.md)）ため検査と算入が非対称になるが、意図的な扱いである。アイコンは 5 MB 上限（[domains/storage.md](../domains/storage.md) の `UploadValidationPolicy`）で、差し替えのたびに手順 4 が旧アイコンを消すため主体あたり 1 枚しか積み上がらず、際限なく増えていく取り込み（`storeUpload` / `storeMedia`）とは性質が違う。逆に検査すると、容量が上限に達した利用者は消費量を増やさない差し替えまで塞がれる。算入するのは、増分集計と棚卸し（`recalculateStorageUsage` の `sumSizeByOwner`）が同じ除外条件で一致している必要があるためで、算入しない側に倒すと除外条件が 2 つに増える。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 形式・サイズの違反 | `BusinessRuleError` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 容量の上限到達 | 検査しない（上記） |

## issueDownloadUrl

### 概要

保管ファイル（元ファイル・生成物）の期限付きダウンロード URL を発行する。本人（または所有ワークスペースで権限を持つメンバー）の取得だけを扱う。匿名の閲覧者による生成物のダウンロードは、Note 側の `downloadExportArtifact`（ExportTicket 経由。[usecases/note.md](./note.md)、[ADR 010](../adr/010-anonymous-export-and-ticket.md)）が担う。

### 入力DTO

`userId`, `fileId`, `expiresInMs: number`

### 出力DTO

`url: string`, `fileName: string`, `expiresAt: Date`

### 処理フロー

1. `StoredFileRepository.findById` で引く
2. 所有者が利用者本人か、所有ワークスペースで `downloadNote` の権限があるかを確認する
3. `EphemeralFile` で期限を過ぎていれば `NotFoundError("ARTIFACT_EXPIRED")`
4. `ObjectStorage.createDownloadUrl` を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ファイル不在・権限なし | `NotFoundError("STORED_FILE_NOT_FOUND")` |
| 生成物の期限切れ | `NotFoundError("ARTIFACT_EXPIRED")` |

## importExternalReferences

### 概要

本文中の外部リソースを取得して保管し、参照先を差し替える（IM-05）。参照取り込みジョブ（`kind: "referenceImport"`、`target: { type: "note", noteId }`）から呼ばれる。

このユースケースはジョブを登録しない。`referenceImport` ジョブを登録するのは `updateNoteBody`（[usecases/note.md](./note.md)）と `runConversion` / `runRegeneration`（[usecases/conversion.md](./conversion.md)）で、いずれも `scope` を**対象ノートの所有文脈**から導出する（[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。ここで保管する参照ファイル（`purpose: "reference"`）の `StorageOwner` も同じノートの所有文脈になるため、ジョブの `scope` と保管ファイルの帰属は一致する。`scope` は登録時点で決まり、このユースケースは書き換えない。

run 系の共通規則（[usecases/job.md](./job.md)）の判定順に対する唯一の例外である。`Job.start` は `total`（取り込む参照の件数）を要求するが、その件数は本文を読んで参照を抽出するまで確定しない。そのため判定 1・2（終端済み・リース有効の除外）は先頭で行い、判定 3 の `Job.start` だけを本文の抽出後（手順 4）へ後ろ倒しする。他の run 系ユースケースは `total` を入力か登録時の payload から得られるためこの例外を要さない。

### 入力DTO

`noteId`, `userId`, `jobId`

キューが運ぶのは `jobId` と `kind` だけなので、`noteId` と `userId` は呼び出し側（ジョブのディスパッチャー）が `JobRepository.findById(jobId)` で引いた行から取る — `noteId` は `job.target`（`{ type: "note", noteId }`）、`userId` は `job.requestedBy`（`referenceImport` は匿名ジョブになりえないため必ず非 `null`。[domains/job.md](../domains/job.md) の `JobAttribution`）。保管する参照ファイルの `uploadedBy` に入るのはこの要求者であり、実行時点の誰かではない。

### 出力DTO

`importedCount: number`, `failed: { url: string; reason: string }[]`, `skipped: number`

### 処理フロー

1. `JobRepository.findById` で引く。終端状態なら何もせず返す（同じジョブを 2 回受け取っても結果が変わらない）。リース有効の `running` も何もせず返す（run 系の共通規則。[usecases/job.md](./job.md)）
2. ノートを引く。不在なら `Job.fail(reason: "targetMissing")` として終了する
3. 本文が `ready` なら `HtmlProcessor.extractExternalReferences(html)` で参照を集める（`ready` でなければ 0 件として扱う）
4. 参照の件数を `total` として `Job.start(job, total, now, leaseUntil)` を保存する（0 件なら何も取り込まず 9 の `Job.succeed` で終端する）
5. 各参照について
   - 既にサービス内のストレージを指すものは飛ばす
   - `ExternalFetchPolicy.ensureFetchable(url)` と `ensureWithinBudget` を呼ぶ
   - `RemoteResourceFetcher.fetch` で取得し、`ObjectStorage.put` と `StoredFile.register` で保管する。`limits` は `ExternalFetchPolicy.budget()` から作る（`timeoutMs` は `perItemTimeoutMs`、`maxBytes` は `maxTotalBytes` の残り）。`FileProvenance` は `{ purpose: "reference", noteId, uploadedBy: userId }`
   - 失敗した参照は元の URL のまま残し、理由を記録する
6. `HtmlProcessor.rewriteReferences(html, replacements)` で本文を書き換える
7. `Note.updateBody` を適用して保存する（版は作らない）
8. 進捗は `Job.reportProgress` で更新する（リースの延長を兼ねる）
9. `Job.succeed` を保存する。本文の保存とジョブの更新は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが不在 | `Job.fail("targetMissing")` |
| 個々の取得失敗（404・タイムアウト・認証必要） | 記録して継続 |
| 拒否された URL（内部アドレス等） | 記録して継続 |
| 予算超過 | 以降の取得を打ち切り、件数を記録して成功として返す |
| 本文の保存で版が競合 | 1 度だけ読み直して再適用し、それでも競合すれば `ConflictError` |
| ジョブ保存の版の競合（実行中に外部から強制終端された） | 読み直して終端済みなら、本文の書き換えごと同一 UoW でロールバックされているため取り込み結果を破棄して成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる（run 系の共通規則の判定 4）。保管済みの参照ファイルは本文から参照されないまま残り、ノートの完全削除時に `deleteFilesForNote` が回収する |

## deleteFiles

### 概要

保管ファイルのメタデータを削除し、実体の回収をイベントに委ねる。

### 入力DTO

`fileIds: string[]`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `UnitOfWorkProvider.run` を開き、その中で下記の**保管ファイルの削除手順**を実行する
2. 実体の削除は `storage.fileDeleted` を購読する `deleteStoredObjects` に委ねる

### 共有手順: 保管ファイルの削除

削除そのものは、UoW のコンテキストを引数に取り自分では `UnitOfWorkProvider.run` を開かない**共有手順**として定義する（[usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」）。

1. `StoredFileRepository.listByIds(fileIds)` で引く（既に不在のものは結果に現れないだけで、エラーにしない）
2. 各件を削除し、`StorageEvents.fileDeleted` を収集する（`objectKey` を含める）

`deleteFiles` ユースケースは「UoW を開いてこの手順を実行するだけ」の薄い入口であり、他の書き込みと同一トランザクションで消したい呼び出し元は、`deleteFiles` を呼ばずに自分の UoW の中でこの手順を実行する。

- ジョブの強制終端の後始末（[usecases/job.md](./job.md) の「共通: 強制終端の後始末」。共有手順 `finalizeTerminatedJobs` がこの手順を自分の `ctx` で実行する）。ジョブの終端・`processing` のノートの回復と同一 UoW で生成物を破棄する必要があるため、必ずこの形になる。各経路の「`deleteFiles` で回収する（同一 UoW）」という記述はこの手順の実行を指す
- batch 親を開き直すときの ZIP の破棄（[usecases/job.md](./job.md) の「親を開き直すときの生成物の破棄」。`retryFailedChildren` / `retryJob` が `Job.reopenBatch` と同一 UoW で実行する）
- `storeAvatar`（新しいアイコンの保存と旧アイコンの削除）

自分の UoW を持たない呼び出し元（`collectExpiredArtifacts` / `collectOrphanMedia` / `deleteFilesForNote` / `deleteFilesByOwner`）は `deleteFiles` ユースケースをそのまま呼んでよい。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 一部が既に不在 | 無視して継続 |

## deleteStoredObjects

### 概要

`storage.fileDeleted` を購読し、オブジェクトストレージ上の実体を回収する。メタデータの削除とオブジェクトの削除を同一トランザクションにできないため、メタデータを先に消して実体を後から消す（[domains/storage.md](../domains/storage.md)）。イベント購読ワーカーから呼ばれる。

### 入力DTO

`events: { fileId: string; objectKey: string }[]`（1 回の配送で受け取った `storage.fileDeleted` のまとまり。`fileId` は記録用）

### 出力DTO

`deletedCount: number`, `failed: { objectKey: string; reason: string }[]`

### 処理フロー

1. イベントから `objectKey` を集める
2. `ObjectStorage.deleteMany(keys)` を呼ぶ。実体が既にない鍵は成功として扱う
3. 失敗した鍵は記録して残りを続け、`failed` に積む。1 件でも失敗が残ればイベントを未処理として返し、再配送に委ねる

このユースケースは `IdempotencyStore` による重複排除を行わない。鍵を指定した削除は本質的に冪等（存在しない鍵の削除は成功）であり、加算・減算を伴う集計の購読者（`applyStorageDelta`）とは事情が異なる。むしろ外部ストレージへの書き込みは UoW に入れられないため、先に処理済みを記録すると削除に失敗したイベントが再配送で弾かれ、実体が永久に残る。重複配送で 2 回消えても結果は変わらないので、記録を持たないほうが安全側に倒れる。

削除に失敗し続けた実体は孤児オブジェクトとして残るが、メタデータが存在しないため参照されず、害はない（[domains/storage.md](../domains/storage.md)）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 実体が既に不在 | 成功として扱う |
| 一部の鍵の削除が失敗 | 記録して残りを続け、イベントを未処理として返す（再配送で再試行される） |
| オブジェクトストレージの通信・権限の失敗 | `SystemError(ExternalServiceError)`（再配送に委ねる） |

## collectExpiredArtifacts

### 概要

期限を過ぎた生成物を回収する。定期ワーカーから呼ばれる。

### 入力DTO

`limit: number`

### 出力DTO

`collectedCount: number`

### 処理フロー

1. `StoredFileRepository.listExpired(now, limit)` を引く
2. `deleteFiles` を呼んで削除する

### エラーケース

個々の失敗は記録して継続。

## collectOrphanMedia

### 概要

作成から 30 日が経過し、本文から参照されていないメディアを回収する。定期ワーカーから呼ばれる。参照が外れた時刻は保持しないため、起点は作成時刻に取る（[domains/storage.md](../domains/storage.md) の `FilePurpose`）。

### 入力DTO

`limit: number`

### 出力DTO

`collectedCount: number`

### 処理フロー

1. `StoredFileRepository.listByPurposeOlderThan("media", now - 30 日, limit)` で走査する。所有者を絞らない全体走査のため、所有者を必須とする `listByOwner` ではなくこのクエリを使う（`stored_files_purpose_created_idx` に対応）
2. 各ファイルの `noteId` から所属ノートを引き、本文に当該ファイルの URL が現れるかを `HtmlProcessor.extractExternalReferences` で調べる（`media` の `FileProvenance` は `noteId` を必須で持つため、所属の解決に本文の逆引きは要らない）
3. 現れないものを `deleteFiles` で削除する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `noteId` の指す所属ノートが既に削除済み | 削除対象として扱う |
| 個々の失敗 | 記録して継続 |

## relocateFilesForNote

### 概要

ノートの移動に追随して、その保管ファイルの所有者を移す（`note.moved` の購読）。保存容量の帰属を移動先へ付け替えるために必要。

### 入力DTO

`noteId`, `previousOwner: { type; id }`, `currentOwner: { type; id }`

### 出力DTO

`relocatedCount: number`

### 処理フロー

1. `StoredFileRepository.listByNote(noteId)` で `purpose` が `source` / `media` / `reference` のファイルを列挙する。`artifact` は対象にしない（`deleteFilesForNote` の手順 1 と同じ絞り込み）。生成物は容量クォータに算入されないため付け替える意味がなく、付け替えると `storage.fileOwnerChanged` が発行されて `applyStorageDelta` が加算されていない容量を旧主体から減算してしまう（[domains/storage.md](../domains/storage.md)）。保有期間の管理も所属ノートではなく `expiresAt` で行い、`collectExpiredArtifacts` が回収する
2. 所有者が既に移動先と一致するものは飛ばす
3. 残りに `StoredFile.changeOwner` を適用して保存し、`storage.fileOwnerChanged` を収集する
4. 同じイベントを 2 回受け取っても、2 の判定によって結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象のファイルがない（ノートが既に完全削除済みなど） | 何もせず成功として返る |
| 版が競合する | 読み直して再適用し、それでも競合すれば `ConflictError`（再配送に委ねる） |

## deleteFilesForNote

### 概要

ノートの完全削除に伴って、そのノートに属する保管ファイルを回収する（`note.purged` の購読）。

### 入力DTO

`noteId`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `StoredFileRepository.listByNote(noteId)` で `purpose` が `source` / `media` / `reference` のファイルを列挙する。`artifact` は対象にしない（期限（`expiresAt`）の経過時に `collectExpiredArtifacts` が回収する）
2. `deleteFiles` を呼んで削除する（各件について `storage.fileDeleted` が収集され、実体の回収は `deleteStoredObjects` が行う）
3. 削除済みのファイルは `listByNote` に現れないため、同じイベントを 2 回受け取っても結果は変わらない（冪等）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象のファイルが 1 件もない | 何もせず成功として返る |
| 一部が既に不在 | 無視して継続 |

## deleteFilesByOwner

### 概要

利用者・ワークスペースの削除に伴って、その所有ファイルをすべて回収する（`identity.user.deleted` / `workspace.deleted` の購読）。

### 入力DTO

`ownerType`, `ownerId`, `batchSize: number`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `StoredFileRepository.listByOwner` を `batchSize` ずつ読み、`deleteFiles` を繰り返す
2. 1 回の呼び出しで消し切れなければ自身を再登録し、対象が 0 件になるまで続ける

冪等性: `IdempotencyStore` は使わない。削除済みのファイルは `listByOwner` に現れないため、同じイベントを 2 回受け取っても 2 回目は 0 件で終わる（`deleteFilesForNote` と同じ根拠。[domains/index.md](../domains/index.md) の「使わない」分類）。

自己再登録があるため、重複配送では同じ所有者に対して 2 系列が並走しうる。並走しても結果は変わらない — 両系列とも「残っているものを読んで消す」だけで、同じファイルを両方が拾った場合は先に消したほうだけが `deleteFiles` の `listByIds` に載せ、遅れたほうは対象が消えているので 0 件で終わる（`storage.fileDeleted` も 1 件につき 1 回しか出ない）。終了条件も系列ごとに独立で、対象が 0 件になった系列から順に再登録をやめる。

### エラーケース

個々の失敗は記録して継続。再実行しても結果は変わらない。
