# ユースケース: Integration

ドメインの詳細は [domains/integration.md](../domains/integration.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

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
4. `IntegrationOAuthClient.buildAuthorizationUrl` を返す。Drive は毎回 `prompt=consent` を伴い、リフレッシュトークンを確実に得る

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

`connectionId`, `provider`, `accountLabel`, `redirectTo: string | null`, `reconnected: boolean`

### 処理フロー

1. `OAuthStateStore.take(state)` で取り出す。`null` なら `ValidationError("OAUTH_STATE_INVALID")`
2. `IntegrationOAuthClient.exchangeCode` で資格情報を得る
3. 必要なスコープが揃っていなければ `ValidationError("OAUTH_SCOPE_INSUFFICIENT")`
4. Drive で `refreshToken` が得られなければ `ValidationError("OAUTH_REFRESH_TOKEN_MISSING")`
5. `ConnectionProbe.probe` で疎通確認する。失敗なら連携を成立させず `ValidationError("CONNECTION_PROBE_FAILED")`
6. `SecretCipher.encrypt` でトークンを暗号化する
7. `ExternalConnectionRepository.findByUserAndProvider` を引く。あれば `ExternalConnection.reconnect`、なければ `connect`（既定の `settings` つき）を保存する
8. OpenRouter を新規に連携した場合、`awaitingIntegration` のノートがあることを利用者に知らせるための情報を応答に含める

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
2. `ActiveConnection` なら `CredentialResolver.resolve` で平文を得て `IntegrationOAuthClient.revoke` を試みる（失敗しても続行する）
3. その連携に依存する実行中ジョブ（OpenRouter なら変換・再生成、Drive ならバックアップ）を `JobRepository.listActiveByRequester` から選び、`Job.cancel` する
4. `UnitOfWorkProvider.run` で連携を削除し、`IntegrationEvents.disconnected` を収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 失効の取り消し要求が失敗 | 記録して継続 |
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
2. `CredentialResolver.resolve` で平文を得る
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

1. Drive の連携を引き、`CredentialResolver.resolve` で平文を得る
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
3. `ExternalConnection.updateBackupSetting` を保存する

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

`jobId: string`, `targetCount: number`, `skipped: number`

### 処理フロー

1. Drive の連携を引く。未連携なら `NotFoundError("CONNECTION_NOT_FOUND")`
2. 各ノートを引き、`canEdit` の確認と `sourceFileId` の有無を調べる。元ファイルがないものは対象から外す
3. 1 件なら `Job.enqueue(kind: "driveBackup")`、複数なら `Job.enqueueBatch(kind: "bulkBackup")` と子ジョブを作る
4. `JobConcurrencyPolicy.ensureNoDuplicate` で多重実行を防ぐ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未連携 | `NotFoundError("CONNECTION_NOT_FOUND")` |
| 対象が 0 件 | `ValidationError("NO_BACKUPABLE_TARGET")` |
| 同じ対象のジョブが実行中 | `BusinessRuleError(DuplicateJob)` |

## runBackup

### 概要

バックアップジョブの本体（IN-06）。ジョブワーカーから呼ばれる。

### 入力DTO

`jobId`, `fileId`

### 出力DTO

`recordId: string | null`, `outcome: "succeeded" | "skipped" | "failed"`

### 処理フロー

1. ジョブを引き、終端状態なら何もせず返す。`Job.start` を保存する
2. ファイルとノートを引く。不在なら `Job.fail("targetMissing")`
3. Drive の連携を引き、`CredentialResolver.resolve` で平文を得る
4. `BackupRecordRepository.findByNoteAndFile` を引き、`BackupPlanner.decide` で判定する。`skip` なら成功として終える
5. `CloudDriveClient.ensureFolder` で保存先を確かめ、消えていれば作り直して `updateBackupSetting` に反映する
6. `ObjectStorage.get` の内容を `CloudDriveClient.upload` に流す
7. `BackupRecord.record`（または `updateExternalRef`）と `Job.succeed` を保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 連携が失効 | `Job.fail("providerAuthFailed")` と `ExternalConnection.markExpired` |
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

1. `BackupRecordRepository.findByNoteAndFile` を引く。不在なら `NotFoundError("BACKUP_NOT_FOUND")`
2. Drive の連携を引き、`CredentialResolver.resolve` で平文を得る
3. `CloudDriveClient.headFile` で存在を確かめ、`download` の結果を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 記録が不在 | `NotFoundError("BACKUP_NOT_FOUND")` |
| Drive 上のファイルが削除・移動済み | `NotFoundError("DRIVE_FILE_NOT_FOUND")` |
| 連携が失効 | `BusinessRuleError(ReauthorizationRequired)` |

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
