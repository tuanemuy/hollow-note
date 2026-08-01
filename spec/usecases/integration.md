# ユースケース: Integration

ドメインの詳細は [domains/integration.md](../domains/integration.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

連携用の認可フロー状態は `OAuthStateStore`（サインイン用と共有の横断ポート）に載るため、期限切れの回収は Identity の [`pruneExpiredAuthState`](./identity.md) がまとめて行う。Integration が持つ他の行（連携・バックアップ記録）は期限で自動的に消えるものではない（失効した連携は再連携のために残す）ので、このドメインに定期掃除のユースケースは置かない。

## startIntegrationOAuth

### 概要

OpenRouter または Google Drive の認可 URL を作る（IN-01 / IN-04）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `provider` | `string` | ○ | `ProviderKind` の規則 |
| `redirectTo` | `string \| null` | — | 同一オリジンの相対パスのみ |

### 出力DTO

`authorizationUrl: string`

### 処理フロー

1. `ProviderKind.create` を構築する
2. `state` と `codeVerifier` を作り、`OAuthStateStore.put` に 10 分で保存する
3. プロバイダーごとのスコープを決める（Drive は「このアプリが作成したファイル」に限るスコープ、Google SSO 済みでも別途要求する）
4. Google Drive の場合、`IdentityRepository.listByUserId` から `provider: "google"` の `OAuthIdentity` を探し、あればその `providerEmail` を `loginHint` に渡してアカウント選択を省略する（IN-04: SSO 済みアカウントの引き継ぎ）。なければ `loginHint: null`
5. `IntegrationOAuthClient.buildAuthorizationUrl` を返す。Drive は `loginHint` の有無にかかわらず毎回 `prompt=consent` を伴い、リフレッシュトークンを確実に得る

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未知のプロバイダー | `BusinessRuleError(InvalidProvider)` |
| `redirectTo` が外部 URL | `ValidationError("INVALID_REDIRECT")` |

## completeIntegrationOAuth

### 概要

認可コードを交換して連携を成立させる（IN-01 / IN-04）。

### 入力DTO

`userId`, `state`, `code`

### 出力DTO

`connectionId`, `provider`, `accountLabel`, `redirectTo: string | null`, `reconnected: boolean`, `awaitingIntegrationCount: number | null`

### 処理フロー

1. `OAuthStateStore.take(state)` で取り出す。`null` なら `ValidationError("OAUTH_STATE_INVALID")`
2. `IntegrationOAuthClient.exchangeCode` で資格情報を得る
3. 必要なスコープが揃っていなければ `ValidationError("OAUTH_SCOPE_INSUFFICIENT")`
4. Drive で `refreshToken` が得られなければ `ValidationError("OAUTH_REFRESH_TOKEN_MISSING")`
5. `ConnectionProbe.probe` で疎通確認する。失敗なら連携を成立させず `ValidationError("CONNECTION_PROBE_FAILED")`
6. `SecretCipher.encrypt` でトークンを暗号化する
7. `ExternalConnectionRepository.findByUserAndProvider` を引く。あれば `ExternalConnection.reconnect`、なければ `connect`（既定の `settings` つき）を保存する
8. OpenRouter を新規に連携した場合、`NoteQueryService.countByContentStatus({ type: "user", userId }, "awaitingIntegration")`（Note）で「要 LLM 連携」のノート件数を取得し、`awaitingIntegrationCount` として応答に含める（1 件以上なら案内を表示する）。それ以外の場合は `null`

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `state` の不一致・期限切れ | `ValidationError("OAUTH_STATE_INVALID")` |
| コード交換の失敗 | `ValidationError("OAUTH_CODE_INVALID")` |
| スコープ不足 | `ValidationError("OAUTH_SCOPE_INSUFFICIENT")` |
| リフレッシュトークンなし | `ValidationError("OAUTH_REFRESH_TOKEN_MISSING")` |
| 疎通確認の失敗 | `ValidationError("CONNECTION_PROBE_FAILED")` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## listConnections

### 概要

連携の状態を一覧する（IN-08）。

### 入力DTO

`userId`

### 出力DTO

`connections: { provider; status; accountLabel; lastUsedAt; settings }[]`

### 処理フロー

1. `ExternalConnectionRepository.listByUser` を引く
2. 資格情報は射影に含めない。`settings` はプロバイダーごとの形をそのまま返す
3. 未連携のプロバイダーは `status: "disconnected"` として補って返す

### エラーケース

`SystemError(DatabaseError)`

## disconnectIntegration

### 概要

連携を解除して資格情報を破棄する（IN-03 / IN-09）。

### 入力DTO

`userId`, `provider`

### 出力DTO

`canceledJobs: number`

### 処理フロー

1. 連携を引く。不在なら何もせず成功として返す
2. `ActiveConnection` なら `CredentialResolver.resolve` を呼び、`resolved` なら平文で `IntegrationOAuthClient.revoke` を試みる（失敗しても続行する）。`reauthorizationRequired` なら取り消し要求を省いて続行する（`expired` は直後に連携ごと削除するため保存しない）
3. その連携に依存する実行中ジョブを終端化する。対象の選び方は `failActiveJobsForExpiredIntegration` の手順 1〜2 と同じ — `JobRepository.listActiveByRequester(userId)` を `provider` に依存する `kind`（OpenRouter なら `conversion` / `regeneration`、Google Drive なら `driveBackup` / `bulkBackup`）の未終端ジョブ（`queued` / `running`）に絞り、batch 親（`target.type === "batch"`）は直接は終端させず子の終端化の集計（`updateBatchProgress`）に委ねる。異なるのは適用する遷移と後始末の理由だけで、失効ではなく利用者自身の操作による解除のため `Job.fail("providerAuthFailed")` ではなく `Job.cancel` を使う（履歴には「取り消された」として残る。IN-03 / IN-09）。終端させたジョブには [usecases/job.md](./job.md) の「共通: 強制終端の後始末」に従う（`kind: "conversion"` の対象ノートが `processing` なら `Note.markConversionFailed("canceled")`、生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を `deleteFiles` で回収。`regeneration` は本文を変更しない）
4. `UnitOfWorkProvider.run` で連携を削除し、手順 3 のジョブ・ノート・生成物の更新とあわせて保存し、`IntegrationEvents.disconnected` と手順 3 のイベントを収集する

生成物の回収は、この経路では規則どおり適用しても実際には空になる。終端させる `kind` は `provider` に依存するもの（`conversion` / `regeneration` / `driveBackup` / `bulkBackup`）に限られ、`Job.succeed(artifact)` で生成物を持つのは `pdfExport` / `bulkExport` だけだからである（[domains/job.md](../domains/job.md)、[usecases/note.md](./note.md) の `runNoteExport` / `runBulkExportItem` / `runBulkExport`）。それでも記述を省かないのは、後始末を経路ごとの例外なく同じ規則として読めるようにするため。`failActiveJobsForExpiredIntegration` も同じ絞り込みなので同じことが言える（`kind` で絞る経路だけが持つ性質で、`trashNote` / `deleteWorkspace` / `deleteAccount` / `removeMember` / `leaveWorkspace` / `cancelJob` のように `kind` を絞らずダウンロード系を含む経路では回収が実際に効く）。

手順 3 の 3 つの規則を姉妹ユースケースと揃える理由は同じである。`kind` を明示しないと「Drive ならバックアップ」が `driveBackup` だけか `bulkBackup` を含むか読めない。batch 親を直接取り消すと、後から終端する子の `job.succeeded` が行き場を失い、親 `canceled` / 子 `succeeded` の食い違った履歴が残る。`processing` のノートを戻さないと、変換ジョブが消えたあともノートが「変換中」の表示のまま固定され、編集も移動もできなくなる。ノート側の理由が姉妹ユースケースの `providerAuthFailed` ではなく `canceled` なのは、本文を作れなかった原因が資格情報の喪失ではなく利用者自身の操作であり、示す次の一手が「取り込み直す・再試行する」に定まるためである（`canceled` は `NoteFailureReason` にだけ加わる値で、変換の実行が返す `ConversionFailureReason` には含まれない。[domains/conversion.md](../domains/conversion.md) / [usecases/job.md](./job.md) の「共通: 強制終端の後始末」）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 失効の取り消し要求が失敗 | 記録して継続 |
| ジョブ取り消し時の版の競合（ワーカーが同時に終端化した） | 該当ジョブを読み直し、既に終端なら取り消しの対象から外す（`failActiveJobsForExpiredIntegration` と同じ） |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## listAvailableModels

### 概要

選択できるモデルを用途別に返す（IN-02）。

### 入力DTO

`userId`

### 出力DTO

`structuring: LlmModelInfo[]`, `vision: LlmModelInfo[]`, `transcription: LlmModelInfo[]`, `current: ModelPreference`, `catalogAvailable: boolean`

### 処理フロー

1. OpenRouter の連携を引く。なければ `NotFoundError("CONNECTION_NOT_FOUND")`
2. `CredentialResolver.resolve` を呼ぶ。`reauthorizationRequired` なら、`expired` が非 `null` のときそれを `UnitOfWorkProvider.run` で保存してイベントを収集したうえで `BusinessRuleError(ReauthorizationRequired)`（[domains/integration.md](../domains/integration.md) の `CredentialResolver`）
3. `LlmModelCatalog.list` を呼ぶ。失敗したら既定モデルのみを返し `catalogAvailable: false` とする
4. 用途ごとに `supportsImage` / `supportsAudio` で絞り込む

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未連携 | `NotFoundError("CONNECTION_NOT_FOUND")` |
| 失効 | `BusinessRuleError(ReauthorizationRequired)` |
| 一覧の取得失敗 | 既定モデルのみを返して成功とする |

## updateModelPreference

### 概要

用途別のモデルを保存する（IN-02）。

### 入力DTO

`userId`, `structuring: string`, `vision: string`, `transcription: string`

### 出力DTO

更新後の `ModelPreference`。

### 処理フロー

1. OpenRouter の連携を引く
2. `ModelPreference.create` を構築し、`ExternalConnection.updateModels` を保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未連携 | `NotFoundError("CONNECTION_NOT_FOUND")` |
| 値の違反 | `BusinessRuleError(InvalidModelPreference)` |
| プロバイダー不一致 | `BusinessRuleError(ProviderMismatch)` |

## listDriveFolders

### 概要

バックアップ先の候補を一覧する（IN-05）。

### 入力DTO

`userId`, `parentId: string | null`

### 出力DTO

`folders: { folderId; folderName }[]`

### 処理フロー

1. Drive の連携を引き、`CredentialResolver.resolve` を呼ぶ。`reauthorizationRequired` なら、`expired` が非 `null` のときそれを `UnitOfWorkProvider.run` で保存してイベントを収集したうえで `BusinessRuleError(ReauthorizationRequired)`
2. `CloudDriveClient.listFolders` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未連携 | `NotFoundError("CONNECTION_NOT_FOUND")` |
| 失効 | `BusinessRuleError(ReauthorizationRequired)` |
| 権限不足 | `ValidationError("DRIVE_PERMISSION_DENIED")` |

## updateBackupSetting

### 概要

バックアップ先フォルダと自動バックアップの有無を保存する（IN-05）。

### 入力DTO

`userId`, `folderId: string | null`, `folderName: string | null`, `autoBackup: boolean | null`

### 出力DTO

更新後の設定。

### 処理フロー

1. Drive の連携を引く
2. `folderId` が指定されていれば `CloudDriveClient.ensureFolder` で存在と書き込み権限を確かめる
3. `ExternalConnection.updateBackupSetting` を適用し、`UnitOfWorkProvider.run` で保存して `integration.backupSettingChanged` を収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| フォルダ未指定で自動バックアップを有効化 | `BusinessRuleError(BackupFolderRequired)` |
| 書き込み権限なし | `ValidationError("DRIVE_PERMISSION_DENIED")` |
| プロバイダー不一致 | `BusinessRuleError(ProviderMismatch)` |

## requestBackup

### 概要

元ファイルのバックアップをジョブとして登録する（IN-06）。

### 入力DTO

`userId`, `noteIds: string[]`

### 出力DTO

`jobId: string`, `targetCount: number`, `skipped: { noteId: string; reason: string }[]`

`skipped` の**構造**（`{ noteId, reason }[]`）は `requestBulkNoteOperation` / `requestBulkExport`（[usecases/note.md](../usecases/note.md)）と揃える。対象を ID の並びで受け取る 3 経路は、どれも「一部だけが対象から外れる」ことが常態なので、件数だけでなく**どれがなぜ外れたか**を返す。揃えるのは構造だけで `reason` の**語彙は経路ごとに固有**である（`noSourceFile` は本経路にしかない）。ただし「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う。本経路の `reason` は `notFound`（`listByIds` の結果に現れなかった ID）/ `permissionDenied`（編集権限がない）/ `noSourceFile`（元ファイルがない）のいずれかで、画面はノート名を挙げて理由ごとに案内する（P-23）。

### 処理フロー

1. Drive の連携を引く。未連携なら `NotFoundError("CONNECTION_NOT_FOUND")`
2. `NoteRepository.listByIds` で各ノートを引き、`NoteAccessPolicy` で `canEdit` を確認し、`sourceFileId` の有無を調べる。`listByIds` は存在しない ID を単に返さない契約（[domains/note.md](../domains/note.md)）なので、入力の `noteIds` と結果を突き合わせ、引けなかった ID は `reason: "notFound"` として `skipped` に積む（突き合わせを省くと存在しない ID が無言で落ち、どれが無かったのかが利用者に返らない）。編集できないものは `reason: "permissionDenied"`、元ファイルがないものは `reason: "noSourceFile"` として `skipped` に積み、対象から外す。バックアップに `downloadNote`（viewer）ではなく `editNote`（editor）を要するのは、`runBackup` がノートに紐づく共有状態（`BackupRecord`）を書き、既存記録が別のメンバーのものなら所有者ごと付け替えるためである（`BackupPlanner.decide` の `replace`。この記録が再生成時にどのメンバーの Drive から元ファイルを取るかを決める。[ADR 004](../adr/004-workspace-roles.md) のロール表、[usecases/workspace.md](./workspace.md) の `changeMemberRole` の kind→要ロール表）
3. 残った対象の所有文脈を集め、2 つ以上あれば全体を中止して `ValidationError("MIXED_OWNER_SCOPE")`（[domains/job.md](../domains/job.md) の「batch 親の `scope` は単一である」）。単一の所有文脈を `scope` とする（個人所有なら `{ type: "user", userId }`、ワークスペース所有なら `{ type: "workspace", workspaceId }`。要求者からは導かない）
4. 1 件なら `Job.enqueue({ target: { type: "storedFile", fileId }, payload: { kind: "driveBackup" }, scope, kind: "driveBackup", requestedBy: userId, parentId: null })`（親なし）、複数なら親ジョブ `Job.enqueueBatch(kind: "bulkBackup", payload: { kind: "bulkBackup" }, requestedBy: userId, scope, total)` と、対象ファイルごとの子ジョブ（`kind: "bulkBackup"`、`payload` と `scope` は親と同じ、`target: { type: "storedFile", fileId }`、`parentId` は親）を作る（[domains/job.md](../domains/job.md) の登録経路と `kind` / `payload` / `requestedBy` / `scope` の対応）
5. `JobConcurrencyPolicy.ensureNoDuplicate` で多重実行を防ぐ

元ファイル（`purpose: "source"`）の `StorageOwner` は取り込み先ノートの所有文脈と一致するため、`scope` はノート側から導いても同じ値になる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未連携 | `NotFoundError("CONNECTION_NOT_FOUND")` |
| 対象が 0 件 | `ValidationError("NO_BACKUPABLE_TARGET")` |
| 対象に個人所有とワークスペース所有が混在 | `ValidationError("MIXED_OWNER_SCOPE")` |
| 同じ対象のジョブが実行中 | `BusinessRuleError(DuplicateJob)` |

## runBackup

### 概要

バックアップジョブの本体（IN-06）。ジョブワーカーから呼ばれる。

### 入力DTO

`jobId`, `fileId`

### 出力DTO

`recordId: string | null`, `outcome: "succeeded" | "skipped" | "failed"`

### 処理フロー

バックアップの実行主体はジョブの `requestedBy` であり、実行者自身の Drive に保存して記録も実行者に紐づける（[ADR 010](../adr/010-anonymous-export-and-ticket.md)、[domains/integration.md](../domains/integration.md) の `BackupRecord` の帰属契約）。

1. ジョブを引き、run 系の共通規則（[usecases/job.md](./job.md)）の判定 1〜3 に従って `Job.start(job, 1, now, leaseUntil)` を保存する: 終端状態なら何もせず返す。リース有効な `running` なら他のワーカーが実行中のため何もせず返す。`queued` またはリース失効の `running` なら開始する（[domains/job.md](../domains/job.md) の `Job.start`、[ADR 012](../adr/012-job-execution-resilience.md)）
2. `StoredFileRepository.findById` でファイルを引き、`StoredFile.noteId` からノートを解決する。どちらかが不在なら `Job.fail("targetMissing")`
3. 実行者（`requestedBy`）の Drive 連携を引き、`CredentialResolver.resolve` を呼ぶ。`reauthorizationRequired` なら、`expired` が非 `null` のときそれを `Job.fail("providerAuthFailed")` と同一 Unit of Work で保存してイベントを収集し、終了する（[domains/integration.md](../domains/integration.md) の `CredentialResolver`）
4. `BackupRecordRepository.findByNoteAndFile` を引き、`BackupPlanner.decide(existing, checksum, requestedBy)` で判定する。`skip` なら成功として終える。既存記録が別のメンバーのものなら `replace`（実行者自身の Drive へ上げ直し、記録を付け替える。IN-07 の記録所有者失効時の復旧経路）
5. `CloudDriveClient.ensureFolder` で保存先を確かめ、消えていれば作り直す。新しいフォルダは連携に反映する — **`updateBackupSetting` ユースケースは呼ばず**、`ExternalConnection.updateBackupSetting` を適用して自分の `UnitOfWorkProvider.run` で保存し、`integration.backupSettingChanged` を収集する（下記「手順 5 は複製であって呼び出しではない」）
6. `ObjectStorage.get` の内容を `CloudDriveClient.upload` に流す
7. `upload` なら実行者の `userId` で `BackupRecord.record` を保存する。`replace` なら `BackupRecord.replace(record, { userId: requestedBy, external, checksum }, now)` で既存記録の所有者・外部参照・内容ハッシュを差し替えて保存する（`(noteId, sourceFileId)` は変わらないため一意条件に触れない。保存先フォルダの再作成などで参照だけが変わった場合は `updateExternalRef`）。付け替えの後も、元の所有者の Drive に残るファイルは削除しない（IN-09 と同じ整理）。あわせて `Job.succeed` を保存する。保存が `ConflictError` になったときの扱いは run 系の共通規則の判定 4 に従う（読み直して終端済みならジョブを書き換えず成功として返す）

**手順 5 は複製であって呼び出しではない**。`updateBackupSetting` ユースケースを呼ぶと、その手順 2 が `CloudDriveClient.ensureFolder` を再び呼んで Drive への往復が二重になる — 手順 5 で作り直した直後のフォルダに対する確認であり、得られるものがない。加えて `updateBackupSetting` の入力は利用者の設定操作を想定した `folderId` / `folderName` / `autoBackup` の組で、`autoBackup` を変えないことを `null` で表す必要があり、ワーカーからの「フォルダ ID だけを差し替える」用途に対して形が合わない。連携の書き換えは 1 集約に閉じるので、`ExternalConnection.updateBackupSetting` をこのユースケースの中で適用する。

この保存は手順 7 の UoW とは**別の UoW** で、作り直した直後に確定させる。以降のアップロード（手順 6）が失敗しても新しいフォルダ ID は残り、次の試行が同じフォルダを作り直さずに済む。呼ばれた側だけが確定していても矛盾しない（[usecases/identity.md](./identity.md) の規約）関係にあたる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 実行者の連携が失効（`resolve` が `reauthorizationRequired`） | `Job.fail("providerAuthFailed")`。`resolve` が返した `expired`（`markExpired` を適用した連携と `integration.expired` の草稿）は同一 Unit of Work で保存する |
| 保存先フォルダが消えている | 手順 5 で作り直し、新しいフォルダ ID を連携に保存して続行する（ジョブは失敗させない） |
| Drive の容量不足 | `Job.fail("quotaExceeded")` |
| 権限不足 | `Job.fail("permissionRevoked")` |
| 通信の失敗 | `Job.fail("unknown")`（再試行可能） |
| ファイル・ノートの不在 | `Job.fail("targetMissing")` |

## fetchBackupForRegeneration

### 概要

再生成のために Drive 上の元ファイルを取り出す（IN-07）。

### 入力DTO

`userId`, `noteId`

### 出力DTO

`stream: ReadableStream<Uint8Array>`, `fileName`, `mimeType`

### 処理フロー

Drive からの取得は記録所有者（`BackupRecord.userId`）の連携トークンで行い、再生成を要求した利用者の連携は使わない（[ADR 010](../adr/010-anonymous-export-and-ticket.md)、[domains/integration.md](../domains/integration.md) の `BackupRecord` の帰属契約）。

1. `BackupRecordRepository.findByNoteAndFile` を引く。不在なら `NotFoundError("BACKUP_NOT_FOUND")`
2. 記録所有者（`BackupRecord.userId`）の Drive 連携を `ExternalConnectionRepository.findByUserAndProvider` で引き、`CredentialResolver.resolve` を呼ぶ。連携がない（解除済み・退会済み）なら `NotFoundError("CONNECTION_NOT_FOUND")`。`reauthorizationRequired` なら、`expired` が非 `null` のときそれを `UnitOfWorkProvider.run` で保存してイベントを収集したうえで `BusinessRuleError(ReauthorizationRequired)`
3. `CloudDriveClient.headFile` で存在を確かめ、`download` の結果を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 記録が不在 | `NotFoundError("BACKUP_NOT_FOUND")` |
| 記録所有者が未連携（解除済み・退会済み） | `NotFoundError("CONNECTION_NOT_FOUND")`（記録所有者には再連携を、他のメンバーには自分の Drive への再バックアップ（IN-06）を経た再生成を案内する。IN-07） |
| 記録所有者の連携が失効 | `BusinessRuleError(ReauthorizationRequired)`（案内は上と同じ） |
| Drive 上のファイルが削除・移動済み | `NotFoundError("DRIVE_FILE_NOT_FOUND")` |
| 通信の失敗 | `SystemError(ExternalServiceError)` |

## listBackupStates

### 概要

ノート一覧・詳細に表示するため、バックアップの有無をまとめて引く。

### 入力DTO

`noteIds: string[]`

### 出力DTO

`statesByNote: Record<string, { backedUp: boolean; webViewUrl: string | null; backedUpAt: Date | null }>`

### 処理フロー

1. `BackupRecordRepository.listByNotes` を引いてノートごとにまとめる

権限の判定は呼び出し元が済ませている前提。

### エラーケース

`SystemError(DatabaseError)`

## deleteBackupRecordsForNote

### 概要

ノートの完全削除に伴い、バックアップ記録を消す（`note.purged` の購読）。

### 入力DTO

`noteId`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `BackupRecordRepository.deleteByNote(noteId)` を実行する
2. Drive 上のファイルは消さない。バックアップは利用者自身の Drive にあり、その扱いは利用者に委ねる（IN-09 と同じ整理）
3. 同じイベントを 2 回受け取っても、2 回目は削除対象が既にないため 0 件削除で終わり、結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## failActiveJobsForExpiredIntegration

### 概要

連携の失効に伴い、その連携に依存する実行中のジョブを失敗させる（`integration.expired` の購読）。

### 入力DTO

`connectionId`, `userId`, `provider`

### 出力DTO

`failedCount: number`

### 処理フロー

1. `JobRepository.listActiveByRequester(userId)` を引き、`provider` に依存する `kind` に絞る。OpenRouter なら `conversion` / `regeneration`、Google Drive なら `driveBackup` / `bulkBackup`
2. batch 親（`target.type === "batch"`）は直接は失敗させず、子の終端化の集計（`updateBatchProgress`）に委ねる
3. `UnitOfWorkProvider.run` で対象の未終端ジョブ（`queued` / `running`）に `Job.fail(reason: "providerAuthFailed")` を適用して保存し、イベントを収集する
4. 終端させたジョブについて [usecases/job.md](./job.md) の「共通: 強制終端の後始末」に従い、同一 UoW で併せて保存する。`kind: "conversion"` の対象ノートが `processing` のままなら `Note.markConversionFailed(providerAuthFailed)`（この経路だけ理由が `canceled` ではなく `providerAuthFailed` になる。`runConversion` の失敗時と同じ表示に揃えるため。`regeneration` は本文を変更しない）。生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を `deleteFiles`（[usecases/storage.md](./storage.md)）で回収する — ただし対象の `kind` を `provider` に依存するものへ絞るこの経路では、`disconnectIntegration` と同じ理由で回収対象は実際には空になる（生成物を持つのは `pdfExport` / `bulkExport` だけ）。規則は経路ごとに省かず同じ形で適用する
5. 同じイベントを 2 回受け取っても、対象は既に終端のため `listActiveByRequester` の結果に現れず、結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ジョブ更新時の版の競合（ワーカーが同時に終端化した） | 該当ジョブを読み直し、既に終端なら何もしない |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## deleteIntegrationsForUser

### 概要

利用者の退会に伴って、連携とバックアップ記録をすべて削除し、トークンを破棄する（`identity.user.deleted` の購読）。

### 入力DTO

`userId`

### 出力DTO

`deletedConnections: number`, `deletedRecords: number`

### 処理フロー

1. `ExternalConnectionRepository.listByUser(userId)` を引き、`ActiveConnection` それぞれについて `CredentialResolver.resolve` を呼び、`resolved` なら平文で `IntegrationOAuthClient.revoke` を試みる（`disconnectIntegration` の手順 2 と同じ。`reauthorizationRequired` なら取り消し要求を省き、`expired` も保存しない。失敗しても続行する）
2. `UnitOfWorkProvider.run` で `ExternalConnectionRepository.deleteByUser(userId)` と `BackupRecordRepository.deleteByUser(userId)` を呼ぶ。暗号化済みの資格情報とバックアップ設定（`ConnectionSettings`）は連携行に格納されているため、行の削除が保存側のトークン破棄と設定の削除を兼ねる
3. Drive 上のバックアップファイルは消さない（IN-09。`deleteBackupRecordsForNote` と同じ整理）
4. イベントは発行しない（`integration.disconnected` は監査のためのイベントであり、実行中ジョブの取り消しは `deleteAccount` の手順 3 で済んでいる）

冪等性: 削除は対象がなければ 0 件で終わるため、同じイベントを 2 回受け取っても結果は変わらない。取り消し要求の再送は、既に無効なトークンへの要求が失敗として記録されるだけで無害。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 連携が 1 件もない | 何もせず成功として返す |
| 失効の取り消し要求が失敗 | 記録して継続 |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |
