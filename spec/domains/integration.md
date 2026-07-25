# Integration

外部サービスとの連携状態と資格情報を保つ。方針は [ADR 002](../adr/002-llm-provider-integration.md) に従う。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| Connection | 連携 | ある利用者とある外部サービスの結びつき |
| Credential | 資格情報 | 連携で得た鍵。暗号化して保管する |
| BackupSetting | バックアップ設定 | Google Drive の保存先と自動化の有無 |
| BackupRecord | バックアップ記録 | ある元ファイルが Drive のどこに置かれたか |
| ModelPreference | モデル設定 | 用途ごとに使う LLM モデル |
| Reauthorization | 再連携 | 失効した資格情報を取り直すこと |

## 値オブジェクト

### ConnectionId / BackupRecordId

- **バリデーション**: 空白のみは不可。`BusinessRuleError(IntegrationErrorCode.InvalidId)`

### ProviderKind

- **フィールド**: `value: "openrouter" | "googleDrive"`

### EncryptedSecret

- **フィールド**: `cipherText: string`, `keyVersion: number`
- **バリデーション**: `cipherText` は空文字列不可。生成は `SecretCipher` ポートのみ
- **等価性**: 比較しない（ログ・シリアライズ禁止）

### DriveFolderRef

- **フィールド**: `folderId: string`, `folderName: string`
- **バリデーション**: `folderId` は空文字列不可

### ModelPreference

- **フィールド**: `structuring: string`, `vision: string`, `transcription: string`
- **バリデーション**: 各値は 1〜200 文字。空文字列は不可
- **既定値**: `ModelPreference.default()` がサービス既定のモデルを返す

### ExternalFileRef

- **フィールド**: `externalFileId: string`, `webViewUrl: string`
- **バリデーション**: 両方とも空文字列不可

## エンティティ

### ExternalConnection（集約ルート）

```
ConnectionBase = {
  id: ConnectionId
  userId: UserId
  provider: ProviderKind
  accountLabel: string | null       // 連携先アカウントを示す文字列（メールアドレス等）。取得できなければ null
  version: number
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
}

ActiveConnection = ConnectionBase & {
  status: "active"
  accessToken: EncryptedSecret
  refreshToken: EncryptedSecret | null
  accessTokenExpiresAt: Date | null
  settings: ConnectionSettings
}

ExpiredConnection = ConnectionBase & {
  status: "expired"                 // 鍵の失効を検出した状態。再連携が必要
  settings: ConnectionSettings
  expiredAt: Date
}

ExternalConnection = ActiveConnection | ExpiredConnection

ConnectionSettings =
  | { provider: "openrouter"; models: ModelPreference }
  | { provider: "googleDrive"; folder: DriveFolderRef | null; autoBackup: boolean }
```

`ExpiredConnection` は資格情報を保持しない。失効を検出した時点で破棄する。

**不変条件**

- `(userId, provider)` は一意（1 利用者につき 1 プロバイダー 1 件）
- `settings.provider` は `provider` と一致する
- `ExpiredConnection` は変換にもバックアップにも使えない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `connect` | `params: { id: string; userId: UserId; provider: ProviderKind; accountLabel: string \| null; accessToken: EncryptedSecret; refreshToken: EncryptedSecret \| null; accessTokenExpiresAt: Date \| null; settings: ConnectionSettings }, now: Date` | `WithEventDrafts<ActiveConnection, IntegrationEvent>` | `settings.provider !== provider` なら `BusinessRuleError(SettingsProviderMismatch)`。`integration.connected` を発行 |
| `reconnect` | `connection: ExternalConnection, params: { accountLabel: string \| null; accessToken: EncryptedSecret; refreshToken: EncryptedSecret \| null; accessTokenExpiresAt: Date \| null }, now: Date` | `WithEventDrafts<ActiveConnection, IntegrationEvent>` | 既存の `settings` を保ったまま資格情報を差し替え、`status` を `active` に戻す。`integration.reconnected` を発行 |
| `refreshAccessToken` | `connection: ActiveConnection, params: { accessToken: EncryptedSecret; accessTokenExpiresAt: Date \| null }, now: Date` | `ActiveConnection` | イベントは発行しない |
| `markExpired` | `connection: ActiveConnection, now: Date` | `WithEventDrafts<ExpiredConnection, IntegrationEvent>` | 資格情報を破棄し `status` を `expired` に。`integration.expired` を発行 |
| `touch` | `connection: ActiveConnection, now: Date` | `ActiveConnection` | `lastUsedAt` を更新 |
| `updateModels` | `connection: ExternalConnection, models: ModelPreference, now: Date` | `WithEventDrafts<ExternalConnection, IntegrationEvent>` | `provider !== "openrouter"` なら `BusinessRuleError(ProviderMismatch)` |
| `updateBackupSetting` | `connection: ExternalConnection, params: { folder?: DriveFolderRef \| null; autoBackup?: boolean }, now: Date` | `WithEventDrafts<ExternalConnection, IntegrationEvent>` | `provider !== "googleDrive"` なら `BusinessRuleError(ProviderMismatch)`。`autoBackup` を真にする際に `folder` が `null` なら `BusinessRuleError(BackupFolderRequired)` |
| `isTokenExpired` | `connection: ExternalConnection, now: Date` | `boolean` | `ActiveConnection` かつ `accessTokenExpiresAt !== null` のとき `accessTokenExpiresAt <= now` |

解除はユースケースが `IntegrationEvents.disconnected` を直接発行する。

### BackupRecord（集約ルート）

```
BackupRecord = {
  id: BackupRecordId
  userId: UserId
  noteId: NoteId
  sourceFileId: StoredFileId
  external: ExternalFileRef
  checksum: Checksum
  version: number
  backedUpAt: Date
  updatedAt: Date
}
```

**不変条件**

- `(noteId, sourceFileId)` は一意
- `checksum` は保管ファイルの内容ハッシュと一致する。一致しない記録は再アップロードの対象

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `record` | `params: { id: string; userId: UserId; noteId: NoteId; sourceFileId: StoredFileId; external: ExternalFileRef; checksum: Checksum }, now: Date` | `WithEventDrafts<BackupRecord, IntegrationEvent>` | `integration.backupCompleted` を発行 |
| `updateExternalRef` | `record: BackupRecord, external: ExternalFileRef, now: Date` | `WithEventDrafts<BackupRecord, IntegrationEvent>` | 保存先フォルダの再作成などで参照が変わった場合に使う |
| `matches` | `record: BackupRecord, checksum: Checksum` | `boolean` | 同一内容が既にバックアップ済みかの判定 |

## ドメインサービス

### CredentialResolver

**責務**: 連携から、外部呼び出しに使える平文の資格情報を取り出す。必要ならトークンを更新する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `resolve` | `connection: ExternalConnection, now: Date` | `Promise<ResolvedCredential>` | `ExpiredConnection` なら `BusinessRuleError(ReauthorizationRequired)`。`isTokenExpired` が真で `refreshToken` があれば `TokenRefresher.refresh` を呼び、なければ `BusinessRuleError(ReauthorizationRequired)`。成功したときは `touch` を適用した連携を `updated` に載せる |

```
ResolvedCredential = Readonly<{
  accessToken: string;
  updated: ActiveConnection | null;    // トークン更新または lastUsedAt の更新が起きた場合、保存すべき新しい連携
}>;
```

呼び出し側は `updated` が `null` でなければ保存する。これにより `lastUsedAt` が実際の利用に追随する。

**依存するポート**: `SecretCipher`, `TokenRefresher`

### BackupPlanner

**責務**: ある元ファイルをバックアップすべきかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `decide` | `existing: BackupRecord \| null, checksum: Checksum` | `BackupDecision` | 記録がなければ `upload`、あって `matches` が真なら `skip`、偽なら `replace` |

```
BackupDecision = { kind: "upload" } | { kind: "replace"; recordId: BackupRecordId } | { kind: "skip" }
```

**依存するポート**: なし

## ポート

### ExternalConnectionRepository

```ts
interface ExternalConnectionRepository extends TransactionalRepository<ExternalConnection, ConnectionId> {
  findByUserAndProvider(userId: UserId, provider: ProviderKind): Promise<Versioned<ExternalConnection> | null>;
  listByUser(userId: UserId): Promise<readonly ExternalConnection[]>;
  deleteByUser(userId: UserId): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("CONNECTION_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### BackupRecordRepository

```ts
interface BackupRecordRepository extends TransactionalRepository<BackupRecord, BackupRecordId> {
  findByNoteAndFile(noteId: NoteId, sourceFileId: StoredFileId): Promise<Versioned<BackupRecord> | null>;
  listByNotes(noteIds: readonly NoteId[]): Promise<readonly BackupRecord[]>;
  deleteByNote(noteId: NoteId): Promise<number>;
  deleteByUser(userId: UserId): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

### SecretCipher

**目的**: 資格情報の暗号化と復号。

```ts
interface SecretCipher {
  encrypt(plain: string): Promise<EncryptedSecret>;
  decrypt(secret: EncryptedSecret): Promise<string>;
  currentKeyVersion(): number;
}
```

**エラーケース**: `SystemError(ExternalServiceError)`（鍵の取得・暗号処理の失敗）、`SystemError(DataIntegrityError)`（未知の `keyVersion`）

### IntegrationOAuthClient

**目的**: OpenRouter と Google Drive の認可フロー。

```ts
interface IntegrationOAuthClient {
  buildAuthorizationUrl(params: { provider: ProviderKind; state: string; codeChallenge: string; redirectUri: string; scopes: readonly string[] }): string;
  exchangeCode(params: { provider: ProviderKind; code: string; codeVerifier: string; redirectUri: string }): Promise<IssuedCredential>;
  revoke(params: { provider: ProviderKind; accessToken: string }): Promise<void>;
}

type IssuedCredential = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  grantedScopes: readonly string[];
  accountLabel: string | null;
}>;
```

**エラーケース**: `ValidationError("OAUTH_CODE_INVALID")`、`ValidationError("OAUTH_SCOPE_INSUFFICIENT")`、`ValidationError("OAUTH_REFRESH_TOKEN_MISSING")`、`SystemError(ExternalServiceError)`

### TokenRefresher

```ts
interface TokenRefresher {
  refresh(params: { provider: ProviderKind; refreshToken: string }): Promise<IssuedCredential>;
}
```

**エラーケース**: `ValidationError("REFRESH_TOKEN_REJECTED")`（再連携が必要）、`SystemError(ExternalServiceError)`

### ConnectionProbe

**目的**: 連携直後と設定変更時の疎通確認。

```ts
interface ConnectionProbe {
  probe(params: { provider: ProviderKind; accessToken: string }): Promise<ProbeResult>;
}

type ProbeResult = Readonly<{ ok: boolean; accountLabel: string | null; failureReason: string | null }>;
```

**エラーケース**: `SystemError(ExternalServiceError)`

### LlmModelCatalog

**目的**: 選択できるモデルの一覧を取得する。

```ts
interface LlmModelCatalog {
  list(params: { accessToken: string }): Promise<readonly LlmModelInfo[]>;
}

type LlmModelInfo = Readonly<{
  id: string;
  displayName: string;
  supportsImage: boolean;
  supportsAudio: boolean;
}>;
```

取得に失敗した場合はユースケース側で既定モデルのみを提示する。

**エラーケース**: `SystemError(ExternalServiceError)`

### CloudDriveClient

**目的**: Google Drive 上のフォルダとファイルの操作。

```ts
interface CloudDriveClient {
  ensureFolder(params: { accessToken: string; folder: DriveFolderRef | null; defaultName: string }): Promise<DriveFolderRef>;
  listFolders(params: { accessToken: string; parentId: string | null }): Promise<readonly DriveFolderRef[]>;
  upload(params: { accessToken: string; folderId: string; fileName: FileName; mimeType: MimeType; body: ReadableStream<Uint8Array> }): Promise<ExternalFileRef>;
  download(params: { accessToken: string; externalFileId: string }): Promise<ReadableStream<Uint8Array>>;
  headFile(params: { accessToken: string; externalFileId: string }): Promise<{ size: ByteSize; mimeType: MimeType } | null>;
}
```

`ensureFolder` は指定フォルダが存在しなければ作り直し、その参照を返す。

**エラーケース**: `ValidationError("DRIVE_PERMISSION_DENIED")`、`ValidationError("DRIVE_QUOTA_EXCEEDED")`、`NotFoundError("DRIVE_FILE_NOT_FOUND")`、`SystemError(ExternalServiceError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `integration.connected` | `{ connectionId, userId, provider }` | 「要 LLM 連携」ノートへの案内、監査 |
| `integration.reconnected` | `{ connectionId, userId, provider }` | 監査 |
| `integration.expired` | `{ connectionId, userId, provider }` | 実行中ジョブの失敗処理、UI への「要再連携」表示 |
| `integration.disconnected` | `{ connectionId, userId, provider }` | 実行中ジョブのキャンセル |
| `integration.backupCompleted` | `{ recordId, userId, noteId, sourceFileId }` | ノートのバックアップ状態表示 |
| `integration.backupSettingChanged` | `{ connectionId, userId, autoBackup }` | 監査 |

## エラーコード

```
IntegrationErrorCode =
  | "InvalidId" | "InvalidModelPreference" | "InvalidFolderRef"
  | "ProviderMismatch" | "SettingsProviderMismatch"
  | "BackupFolderRequired" | "ReauthorizationRequired"
```

## ユースケース（概要）

`startIntegrationOAuth`, `completeIntegrationOAuth`, `listConnections`, `disconnectIntegration`, `listAvailableModels`, `updateModelPreference`, `listDriveFolders`, `updateBackupSetting`, `requestBackup`, `runBackup`, `fetchBackupForRegeneration`, `listBackupStates`

詳細は [usecases/integration.md](../usecases/integration.md)。
