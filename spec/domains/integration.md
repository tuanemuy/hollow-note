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
| `updateModels` | `connection: ExternalConnection, models: ModelPreference, now: Date` | `ExternalConnection` | `provider !== "openrouter"` なら `BusinessRuleError(ProviderMismatch)`。イベントは発行しない |
| `updateBackupSetting` | `connection: ExternalConnection, params: { folder?: DriveFolderRef \| null; autoBackup?: boolean }, now: Date` | `WithEventDrafts<ExternalConnection, IntegrationEvent>` | `provider !== "googleDrive"` なら `BusinessRuleError(ProviderMismatch)`。`autoBackup` を真にする際に `folder` が `null` なら `BusinessRuleError(BackupFolderRequired)`。`integration.backupSettingChanged` を発行 |
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

バックアップは記録した利用者（`userId`）の Drive に保存され、記録もその利用者に紐づく。ワークスペース所有のノートでも同じで、再生成（IN-07）での元ファイル取得は `userId` の連携トークンで行い、再生成を要求した利用者の連携は使わない。記録所有者の連携が解除・失効している、または退会している場合、取得は失敗する（記録所有者には再連携を、他のメンバーには自分の Drive への再バックアップを経た再生成を案内する。[scenario/integration.md](../scenario/integration.md) IN-06 / IN-07）。

**不変条件**

- `(noteId, sourceFileId)` は一意
- `checksum` は保管ファイルの内容ハッシュと一致する。一致しない記録は再アップロードの対象

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `record` | `params: { id: string; userId: UserId; noteId: NoteId; sourceFileId: StoredFileId; external: ExternalFileRef; checksum: Checksum }, now: Date` | `WithEventDrafts<BackupRecord, IntegrationEvent>` | 記録がまだない元ファイルに対して新しい記録を作る。`integration.backupCompleted` を発行 |
| `replace` | `record: BackupRecord, params: { userId: UserId; external: ExternalFileRef; checksum: Checksum }, now: Date` | `WithEventDrafts<BackupRecord, IntegrationEvent>` | 既存の記録の所有者・外部参照・内容ハッシュをまとめて差し替え、`backedUpAt` を `now` に更新する。`id` と `(noteId, sourceFileId)` は変えないため一意条件に触れない（新規作成では表せない更新のため `record` とは別の経路にする）。`integration.backupCompleted` を発行 |
| `updateExternalRef` | `record: BackupRecord, external: ExternalFileRef, now: Date` | `WithEventDrafts<BackupRecord, IntegrationEvent>` | 保存先フォルダの再作成などで参照だけが変わった場合に使う。所有者と `checksum` は変えない |
| `matches` | `record: BackupRecord, checksum: Checksum` | `boolean` | 同一内容が既にバックアップ済みかの判定 |

`replace` は 2 つの場面で使う — 同一利用者の元ファイルが差し替わった（`matches` が偽）場合の上げ直しと、記録所有者の連携が失われたときに別のメンバーが自分の Drive へ上げ直して記録を引き取る場合（IN-07 の復旧経路）である。付け替えの後も、元の所有者の Drive に残るファイルは削除しない。バックアップは利用者自身の Drive にあり、その扱いは利用者に委ねる（IN-09 と同じ整理。[usecases/integration.md](../usecases/integration.md) の `deleteBackupRecordsForNote`）。

## ドメインサービス

### CredentialResolver

**責務**: 連携から、外部呼び出しに使える平文の資格情報を取り出す。必要ならトークンを更新する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `resolve` | `connection: ExternalConnection, now: Date` | `Promise<CredentialResolution>` | `ExpiredConnection` なら `{ kind: "reauthorizationRequired", expired: null }`。`isTokenExpired` が真で `refreshToken` があれば `TokenRefresher.refresh` を呼び、なければ `{ kind: "reauthorizationRequired", expired: null }`。`refresh` が `ValidationError("REFRESH_TOKEN_REJECTED")` で拒否したときは `markExpired` を適用し、その結果を `expired` に載せた `reauthorizationRequired` を返す（下記）。資格情報を解決できたときは `touch` を適用した連携を `updated` に載せた `resolved` を返す |

```
CredentialResolution =
  | { kind: "resolved"; accessToken: string; updated: ActiveConnection | null }
  | { kind: "reauthorizationRequired"; expired: WithEventDrafts<ExpiredConnection, IntegrationEvent> | null };
```

`resolved` の `updated` が `null` でなければ呼び出し側が保存する（トークンの更新または `lastUsedAt` の更新が起きた場合）。これにより `lastUsedAt` が実際の利用に追随する。

再連携が必要なことは戻り値の分岐で表し、例外にはしない。`TokenRefresher.refresh` が `ValidationError("REFRESH_TOKEN_REJECTED")` で拒否したときはリフレッシュトークンごと失効しているため `resolve` が `markExpired` を適用するが、その結果（`ExpiredConnection` と `integration.expired` の草稿）は保存を要する状態変化であり、例外に載せて運ぶと保存の責務が型から見えなくなるためである。呼び出し側は `reauthorizationRequired` を受け取ったら、`expired` が非 `null` ならその連携と草稿を**global D1 の同一 Unit of Work で保存してから**、自分の文脈に応じた失敗（利用者の要求からの呼び出しなら `BusinessRuleError(ReauthorizationRequired)`、ジョブワーカーからの呼び出しなら scope-local の `Job.fail("providerAuthFailed")`）に変換する。connection と scope-local Job / Note を同じ UoW に入れない。scope-local 保存が競合しても、資格情報の更新・失効は正しいglobal状態なので巻き戻さず、ジョブの再試行が現在状態を読み直す。`expired` が `null` になるのは既に `expired` として保存済みの連携を渡した場合と、リフレッシュトークンを持たない失効の場合で、どちらも保存すべき変化はない。

戻り値が表すのは「解決できた」「再連携が必要」の 2 つだけである。`TokenRefresher.refresh` の通信失敗や `SecretCipher` の処理失敗（`SystemError(ExternalServiceError)`）は失効とみなさず、`CredentialResolution` には現れずに例外としてそのまま伝播する（判別ユニオンに畳むと、再試行すれば直る失敗が「再連携が必要」として恒久的な失敗に見えてしまう）。呼び出し側は再試行可能な失敗として扱う — 利用者の要求からの呼び出しならそのまま `SystemError` を返し、ジョブワーカーからの呼び出しなら `Job.fail("unknown")` として再試行に委ねる。

**依存するポート**: `SecretCipher`, `TokenRefresher`

### BackupPlanner

**責務**: ある元ファイルをバックアップすべきかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `decide` | `existing: BackupRecord \| null, checksum: Checksum, requestedBy: UserId` | `BackupDecision` | 記録がなければ `upload`。記録の `userId` が `requestedBy` と異なるときは `replace`（実行者自身の Drive へ上げ直し、記録を付け替える。IN-07 の記録所有者失効時の復旧経路）。同一利用者で `matches` が真なら `skip`、偽なら `replace` |

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
  deleteByUser(userId: UserId, limit: number): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("CONNECTION_ALREADY_EXISTS")`、`SystemError(DatabaseError)`

### BackupRecordRepository

```ts
interface BackupRecordRepository extends TransactionalRepository<BackupRecord, BackupRecordId> {
  findByNoteAndFile(noteId: NoteId, sourceFileId: StoredFileId): Promise<Versioned<BackupRecord> | null>;
  listByNotes(noteIds: readonly NoteId[]): Promise<readonly BackupRecord[]>;
  deleteByNote(noteId: NoteId, limit: number): Promise<number>;
  deleteByUser(userId: UserId, limit: number): Promise<number>;
}
```

`ExternalConnectionRepository` は global D1 に置き、利用者の provider credential を一意に管理する。`BackupRecordRepository` は対象 Note / source file と同じ scope DO に束縛し、scope をまたぐ `deleteByUser` は提供しない。どちらの`deleteByUser`も最大`limit`件だけを削除し、account deletion は directory で列挙した各 scope に削除commandを送る。

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

**鍵は単一ではなく版付きの束である**。`currentKeyVersion` が返すのは「これから暗号化するときに使う版」で、`EncryptedSecret.keyVersion` は「その値が暗号化されたときの版」である。両者が食い違いうるからこそ、復号は保存された版の鍵を引き当てられなければならない。鍵を交換したあとも**旧版の鍵を保持し続ける**必要があり、保持をやめた版で暗号化された行を復号しようとすると `SystemError(DataIntegrityError)` に落ちる。したがって「いつ旧版を捨ててよいか」は再暗号化が全行に行き渡ったかどうかで決まる運用上の判断であり、このポートの契約には含まれない。

**鍵の供給元はこのポートの関心事ではない**。版から鍵を引く写像も、現在の版も、アダプターが `AppConfig` から解決する。正典は [presentation/index.md](../presentation/index.md)。ドメインに供給元を書くと、鍵の管理を外部の鍵管理基盤に移すたびにドメイン文書を書き換えることになる。

**エラーケース**: `SystemError(ExternalServiceError)`（鍵の取得・暗号処理の失敗）、`SystemError(DataIntegrityError)`（未知の `keyVersion`。保持をやめた版で暗号化された行を読んだ場合を含む）

### IntegrationOAuthClient

**目的**: OpenRouter と Google Drive の認可フロー。

```ts
interface IntegrationOAuthClient {
  buildAuthorizationUrl(params: { provider: ProviderKind; state: string; codeChallenge: string; redirectUri: string; scopes: readonly string[]; loginHint: string | null }): string;
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

`buildAuthorizationUrl` は `loginHint` が与えられたとき、アカウント選択を省略するパラメータ（Google の `login_hint` 相当）を認可 URL に付与する（IN-04: SSO 済みアカウントの引き継ぎ）。Google Drive では、リフレッシュトークンを確実に得るための再同意パラメータ（`prompt=consent` 相当）を `loginHint` の有無にかかわらず維持する。

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
| `integration.connected` | `{ connectionId, userId, provider }` | 監査（「要 LLM 連携」ノートへの案内は購読ではなく `completeIntegrationOAuth` が同期的に返す `awaitingIntegrationCount` で行う） |
| `integration.reconnected` | `{ connectionId, userId, provider }` | 監査（購読者はない） |
| `integration.expired` | `{ connectionId, userId, provider }` | 実行中ジョブの失敗処理（`failActiveJobsForExpiredIntegration` が購読）、監査 |
| `integration.disconnected` | `{ connectionId, userId, provider }` | 監査（購読者はない。実行中ジョブの取り消しは `disconnectIntegration` の手順 3 が同期的に行う） |
| `integration.backupCompleted` | `{ recordId, userId, noteId, sourceFileId }` | 監査（ノートのバックアップ状態は `listBackupStates` が `BackupRecordRepository.listByNotes` を直接引くため専用の購読者はない） |
| `integration.backupSettingChanged` | `{ connectionId, userId, autoBackup }` | 監査（購読者はない） |

購読者を持つのは `integration.expired` だけで、残りはアウトボックス経由の記録（監査）のために発行する。このドメインには読み取りモデルへの投影がない — 連携の状態（未連携 / 連携済み / 要再連携）は `listConnections` が連携行の `status` を、バックアップの有無は `listBackupStates` が記録行を、それぞれ表示のたびに直接引くためである（IN-08）。

## エラーコード

```
IntegrationErrorCode =
  | "InvalidId" | "InvalidModelPreference" | "InvalidFolderRef"
  | "ProviderMismatch" | "SettingsProviderMismatch"
  | "BackupFolderRequired" | "ReauthorizationRequired"
```

## ユースケース（概要）

`startIntegrationOAuth`, `completeIntegrationOAuth`, `listConnections`, `disconnectIntegration`, `listAvailableModels`, `updateModelPreference`, `listDriveFolders`, `updateBackupSetting`, `requestBackup`, `runBackup`, `fetchBackupForRegeneration`, `listBackupStates`, `deleteBackupRecordsForNote`, `failActiveJobsForExpiredIntegration`, `deleteIntegrationsForUser`

詳細は [usecases/integration.md](../usecases/integration.md)。
