# ユースケース: Storage

ドメインの詳細は [domains/storage.md](../domains/storage.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

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

### 出力DTO

`parentJobId: string`, `accepted: { index: number; fileName: string; format: string; requiresLlm: boolean }[]`, `rejected: { index: number; fileName: string; reason: string }[]`, `llmRequiredCount: number`, `llmAvailable: boolean`

### 処理フロー

1. 件数が 100 を超えれば `ValidationError("TOO_MANY_FILES")`、合計サイズが 500 MB を超えれば `ValidationError("UPLOAD_TOO_LARGE")`
2. 所有者を組み立て、ワークスペースなら `createNote` の権限を確認する
3. 各ファイルについて `UploadValidationPolicy.ensureAcceptable` を試し、通らないものを `rejected` に積む
4. `QuotaEnforcement.ensureUploadAllowed` で合計サイズを検査する
5. OpenRouter 連携の有無を調べ、LLM を要するファイルの件数を数える（未連携でも受け付ける）
6. `Job.enqueueBatch(kind: "conversion", total: accepted.length)` で親ジョブを作って保存する
7. 呼び出し側は `accepted` の各ファイルを `storeUpload` に `parentJobId` つきで送る

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

### 出力DTO

`noteId`, `fileId`, `contentStatus`, `conversionJobId: string | null`, `backupJobId: string | null`

### 処理フロー

1. 所有者を組み立て、ワークスペースなら `WorkspaceAuthorization.ensureCan(role, "createNote")` を呼ぶ
2. `UploadValidationPolicy.ensureAcceptable({ purpose: "source", mimeType, size })` を呼ぶ
3. `QuotaEnforcement.ensureUploadAllowed`（Usage）で容量と LLM 回数の残量を確認する
4. `IdGenerator.next()` で `fileId` を採番し、`ObjectKey.build` で鍵を作る
5. `ObjectStorage.put` で保管し、実サイズとチェックサムを得る。宣言サイズと実サイズが食い違う場合は実サイズを採用する
6. `FormatDetector.detect`（Conversion）で形式を判定する
7. `ExternalConnectionRepository.findByUserAndProvider(userId, "openrouter")` の有無から `ConversionCapability` を作り、`ConversionPlanner.plan` で方針を決める
8. `ConversionPlanner.initialContentStatusFor(plan)` で初期の本文状態を決める
9. `StoredFile.register` と `Note.createFromUpload` を作る
10. 方針が `unavailable` でなければ `Job.enqueue(kind: "conversion", target: { type: "note", noteId })` を作る
11. Drive の自動バックアップが有効なら `Job.enqueue(kind: "driveBackup", target: { type: "storedFile", fileId })` も作る
12. `UnitOfWorkProvider.run` でファイル・ノート・ジョブを保存し、すべてのイベントを収集する
13. `visibility` が `private` 以外の場合、本文がまだないため即座には適用できない。指定を変換ジョブに引き継ぎ、変換の成功後に `changeNoteVisibility` と同じ手順で適用する。変換に失敗した場合は非公開のまま残す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未対応の MIME・拡張子 | `BusinessRuleError(UnsupportedMimeType)` |
| サイズ超過 | `BusinessRuleError(FileTooLarge)` |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| LLM 実行回数の上限到達 | `BusinessRuleError(LlmQuotaExceeded)`（機械的変換で取り込むよう案内する） |
| ワークスペースの権限不足 | `BusinessRuleError(InsufficientRole)` |
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
3. `QuotaEnforcement.ensureUploadAllowed` で容量を確認する
4. SVG の場合は `HtmlProcessor.process` と同じサニタイズ規則を適用してから保管する
5. `ObjectStorage.put` し、`StoredFile.register(purpose: "media")` を保存する
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
3. `ObjectStorage.put` し、`StoredFile.register(purpose: "avatar")` を保存する
4. 既存のアイコンがあれば削除対象として `deleteFiles` に渡す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 形式・サイズの違反 | `BusinessRuleError` |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |

## issueDownloadUrl

### 概要

保管ファイル（元ファイル・生成物）の期限付きダウンロード URL を発行する。

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

本文中の外部リソースを取得して保管し、参照先を差し替える（IM-05）。参照取り込みジョブから呼ばれる。

### 入力DTO

`noteId`, `userId`, `jobId`

### 出力DTO

`importedCount: number`, `failed: { url: string; reason: string }[]`, `skipped: number`

### 処理フロー

1. ノートを引き、本文が `ready` でなければ何もせず返す
2. `HtmlProcessor.extractExternalReferences(html)` で参照を集める
3. 各参照について
   - 既にサービス内のストレージを指すものは飛ばす
   - `ExternalFetchPolicy.ensureFetchable(url)` と `ensureWithinBudget` を呼ぶ
   - `RemoteResourceFetcher.fetch` で取得し、`ObjectStorage.put` と `StoredFile.register(purpose: "reference")` で保管する
   - 失敗した参照は元の URL のまま残し、理由を記録する
4. `HtmlProcessor.rewriteReferences(html, replacements)` で本文を書き換える
5. `Note.updateBody` を適用して保存する（版は作らない）
6. 進捗は `Job.reportProgress` で更新する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の取得失敗（404・タイムアウト・認証必要） | 記録して継続 |
| 拒否された URL（内部アドレス等） | 記録して継続 |
| 予算超過 | 以降の取得を打ち切り、件数を記録して成功として返す |
| 本文の保存で版が競合 | 1 度だけ読み直して再適用し、それでも競合すれば `ConflictError` |

## deleteFiles

### 概要

保管ファイルのメタデータを削除し、実体の回収をイベントに委ねる。

### 入力DTO

`fileIds: string[]`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `StoredFileRepository.listByIds` で引く
2. `UnitOfWorkProvider.run` で削除し、各件について `StorageEvents.fileDeleted` を収集する
3. 実体の削除は `storage.fileDeleted` を購読するワーカーが `ObjectStorage.deleteMany` で行う

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 一部が既に不在 | 無視して継続 |

## collectExpiredArtifacts

### 概要

期限を過ぎた生成物を回収する。定期ワーカーから呼ばれる。

### 入力DTO

`limit: number`

### 出力DTO

`collectedCount: number`

### 処理フロー

1. `StoredFileRepository.listExpired(now, limit)` を引く
2. `deleteFiles` と同じ手順で削除する

### エラーケース

個々の失敗は記録して継続。

## collectOrphanMedia

### 概要

本文から参照が外れて 30 日を過ぎたメディアを回収する。定期ワーカーから呼ばれる。

### 入力DTO

`limit: number`

### 出力DTO

`collectedCount: number`

### 処理フロー

1. `purpose === "media"` かつ作成から 30 日以上経過したファイルを `listByOwner` で走査する
2. 所属ノートの本文に URL が現れるかを `HtmlProcessor.extractExternalReferences` で調べる
3. 現れないものを `deleteFiles` で削除する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 所属ノートが既に削除済み | 削除対象として扱う |
| 個々の失敗 | 記録して継続 |

## relocateFilesForNote

### 概要

ノートの移動に追随して、その保管ファイルの所有者を移す（`note.moved` の購読）。保存容量の帰属を移動先へ付け替えるために必要。

### 入力DTO

`noteId`, `previousOwner: { type; id }`, `currentOwner: { type; id }`

### 出力DTO

`relocatedCount: number`

### 処理フロー

1. 対象のノートを引き、`sourceFileId` と、本文から参照されているメディア・取り込んだ参照リソースのファイル ID を集める
2. `StoredFileRepository.listByIds` で保管ファイルを引く
3. 所有者が既に移動先と一致するものは飛ばす
4. 残りに `StoredFile.changeOwner` を適用して保存し、`storage.fileOwnerChanged` を収集する
5. 同じイベントを 2 回受け取っても、3 の判定によって結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが既に削除済み | 何もせず成功として返る |
| 一部のファイルが不在 | 無視して継続する |
| 版が競合する | 読み直して再適用し、それでも競合すれば `ConflictError`（再配送に委ねる） |

## deleteFilesByOwner

### 概要

利用者・ワークスペースの削除に伴って、その所有ファイルをすべて回収する（`identity.user.deleted` / `workspace.deleted` の購読）。

### 入力DTO

`ownerType`, `ownerId`, `batchSize: number`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `StoredFileRepository.listByOwner` を `batchSize` ずつ読み、`deleteFiles` を繰り返す
2. すべて消えるまで自身を再登録する

### エラーケース

個々の失敗は記録して継続。再実行しても結果は変わらない。
