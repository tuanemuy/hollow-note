# Storage

バイト列を預かり、保管先と参照可能性を保証する。形式の判定や変換は行わない（[ADR 008](../adr/008-domain-boundaries.md)）。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| StoredFile | 保管ファイル | オブジェクトストレージに置かれた 1 件のバイト列とそのメタデータ |
| Purpose | 用途 | そのファイルが何のために保管されているか |
| Ephemeral | 一時的 | 期限を過ぎたら回収される保管ファイル |
| ObjectKey | オブジェクトキー | オブジェクトストレージ上の位置を示す文字列 |
| Checksum | チェックサム | 同一内容の重複保管を避けるための内容ハッシュ |

## 値オブジェクト

### StoredFileId

- **バリデーション**: 空白のみは不可。`BusinessRuleError(StorageErrorCode.InvalidId)`

### ObjectKey

- **フィールド**: `value: string`
- **バリデーション**: 1〜1024 文字。`..` を含まない。先頭が `/` でない
- **生成**: `ObjectKey.build(owner: StorageOwner, purpose: FilePurpose, fileId: StoredFileId, extension: string \| null): ObjectKey`。所有者・用途で階層を分けることで、所有者単位の一括削除ができる

### FileName

- **フィールド**: `value: string`
- **バリデーション**: 前後の空白を除去して 1〜255 文字。パス区切り（`/`, `\`）と制御文字は不可。違反時は安全な文字へ置換し、空になれば `"file"` とする（例外を投げない）

### MimeType

- **フィールド**: `value: string`
- **バリデーション**: `type/subtype` の形式。未知の型は `application/octet-stream` に落とす

### ByteSize

- **フィールド**: `value: number`
- **バリデーション**: 0 以上の整数。違反時 `BusinessRuleError(InvalidByteSize)`
- **補助**: `ByteSize.exceeds(limit: ByteSize): boolean`

### Checksum

- **フィールド**: `algorithm: "sha256"`, `value: string`
- **バリデーション**: `value` は 64 文字の 16 進数

### FilePurpose

- **フィールド**: `value: "source" | "media" | "reference" | "artifact" | "avatar"`

| 値 | 意味 | 回収 |
| --- | --- | --- |
| `source` | アップロードされた元ファイル | ノートの完全削除時 |
| `media` | 編集中に挿入した画像・動画 | 本文から参照が外れて 30 日後 |
| `reference` | 本文から取り込んだ外部リソース | ノートの完全削除時 |
| `artifact` | 生成物（PDF / ZIP） | `expiresAt` の経過時 |
| `avatar` | 利用者・ワークスペースのアイコン | 差し替え時 |

### StorageOwner

```
StorageOwner =
  | { type: "user"; userId: UserId }
  | { type: "workspace"; workspaceId: WorkspaceId }
```

容量の帰属先を表す。個人のノートに属するファイルは `user`、ワークスペースのノートに属するファイルは `workspace`。

## エンティティ

### StoredFile（集約ルート）

```
StoredFileBase = {
  id: StoredFileId
  owner: StorageOwner
  uploadedBy: UserId
  purpose: FilePurpose
  objectKey: ObjectKey
  fileName: FileName
  mimeType: MimeType
  size: ByteSize
  checksum: Checksum
  version: number
  createdAt: Date
  updatedAt: Date
}

PersistentFile = StoredFileBase & { retention: "persistent" }
EphemeralFile  = StoredFileBase & { retention: "ephemeral"; expiresAt: Date }
StoredFile = PersistentFile | EphemeralFile
```

**不変条件**

- `objectKey` はサービス全体で一意
- `purpose === "artifact"` のファイルは必ず `EphemeralFile`
- `EphemeralFile` の `expiresAt > createdAt`

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `register` | `params: { id: string; owner: StorageOwner; uploadedBy: UserId; purpose: FilePurpose; objectKey: ObjectKey; fileName: string; mimeType: string; size: number; checksum: Checksum }, now: Date` | `WithEventDrafts<PersistentFile, StorageEvent>` | 用途が `artifact` なら `BusinessRuleError(ArtifactMustBeEphemeral)`。`storage.fileStored` を発行 |
| `registerEphemeral` | `params: 同上, ttlMs: number, now: Date` | `WithEventDrafts<EphemeralFile, StorageEvent>` | `expiresAt = now + ttlMs`。`storage.fileStored` を発行 |
| `changeOwner` | `file: StoredFile, owner: StorageOwner, now: Date` | `WithEventDrafts<StoredFile, StorageEvent>` | ノートの移動に追随する。`storage.fileOwnerChanged`（旧所有者とサイズを含む）を発行 |
| `isExpired` | `file: StoredFile, now: Date` | `boolean` | `EphemeralFile` のみ真になりうる |

削除はユースケースが `StorageEvents.fileDeleted` を直接発行する。

## ドメインサービス

### UploadValidationPolicy

**責務**: 受け入れてよいアップロードかを、保管前に判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureAcceptable` | `params: { purpose: FilePurpose; mimeType: MimeType; size: ByteSize }` | `void` | 用途ごとの許可 MIME と上限に反すれば `BusinessRuleError(UnsupportedMimeType)` / `BusinessRuleError(FileTooLarge)` |
| `limitFor` | `purpose: FilePurpose, mimeType: MimeType` | `ByteSize` | 下表の上限 |

| 用途 | 許可する MIME | 上限 |
| --- | --- | --- |
| `source` | 取り込み対応形式（`text/html`, `text/markdown`, `text/plain`, Office 3 種, `application/pdf`, `image/*`, `audio/*`） | 音声 200 MB、その他 50 MB |
| `media` | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `video/mp4`, `video/webm` | 画像 20 MB、動画 200 MB |
| `reference` | 任意（取得できたもの） | 1 件 20 MB |
| `artifact` | `application/pdf`, `application/zip`, `text/html`, `text/markdown` | 1 GB |
| `avatar` | `image/png`, `image/jpeg`, `image/webp` | 5 MB |

**依存するポート**: なし

### ExternalFetchPolicy

**責務**: 本文中の外部参照を取得してよいかを判定する（IM-05）。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureFetchable` | `url: string` | `void` | スキームが `http` / `https` 以外、ホストが private / loopback / link-local / メタデータ用アドレスに解決される、既にサービス内のストレージを指す、のいずれかなら `BusinessRuleError(RefusedUrl)` |
| `budget` | `—` | `FetchBudget` | 1 ノートあたりの取り込み上限 |
| `ensureWithinBudget` | `state: FetchState, nextSize: ByteSize` | `void` | 件数またはバイト数が上限を超えるなら `BusinessRuleError(FetchBudgetExceeded)` |

```
FetchBudget = Readonly<{ maxCount: number; maxTotalBytes: number; perItemTimeoutMs: number }>;
FetchState  = Readonly<{ fetchedCount: number; fetchedBytes: number }>;
```

既定値は `{ maxCount: 200, maxTotalBytes: 100 * 1024 * 1024, perItemTimeoutMs: 10_000 }`。

**依存するポート**: `DnsResolver`（ホスト名からアドレスを解決して private 判定を行う）

## ポート

### StoredFileRepository

```ts
interface StoredFileRepository extends TransactionalRepository<StoredFile, StoredFileId> {
  listByIds(ids: readonly StoredFileId[]): Promise<readonly StoredFile[]>;
  findByOwnerAndChecksum(owner: StorageOwner, checksum: Checksum): Promise<StoredFile | null>;
  listExpired(now: Date, limit: number): Promise<readonly EphemeralFile[]>;
  sumSizeByOwner(owner: StorageOwner): Promise<number>;
  listByOwner(owner: StorageOwner, purpose: FilePurpose | null, pagination: Pagination): Promise<PaginationResult<StoredFile>>;
  deleteByOwner(owner: StorageOwner): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("OBJECT_KEY_ALREADY_USED")`、`SystemError(DatabaseError)`

### ObjectStorage

**目的**: オブジェクトストレージへの読み書き。

```ts
interface ObjectStorage {
  put(key: ObjectKey, body: ReadableStream<Uint8Array> | Uint8Array, meta: ObjectMeta): Promise<PutResult>;
  get(key: ObjectKey): Promise<ObjectBody | null>;
  head(key: ObjectKey): Promise<ObjectMeta | null>;
  delete(key: ObjectKey): Promise<void>;
  deleteMany(keys: readonly ObjectKey[]): Promise<void>;
  createDownloadUrl(key: ObjectKey, params: { fileName: FileName; expiresInMs: number }): Promise<string>;
}

type ObjectMeta = Readonly<{ mimeType: MimeType; size: ByteSize; checksum: Checksum | null }>;
type ObjectBody = Readonly<{ stream: ReadableStream<Uint8Array>; meta: ObjectMeta }>;
type PutResult = Readonly<{ size: ByteSize; checksum: Checksum }>;
```

**エラーケース**: `SystemError(ExternalServiceError)`（通信・権限）、`ValidationError("OBJECT_TOO_LARGE")`（宣言サイズ超過）、`NotFoundError("OBJECT_NOT_FOUND")`

### RemoteResourceFetcher

**目的**: 本文中の外部 URL を取得する（IM-05）。

```ts
interface RemoteResourceFetcher {
  fetch(url: string, limits: { maxBytes: number; timeoutMs: number }): Promise<FetchedResource>;
}

type FetchedResource = Readonly<{
  body: Uint8Array;
  mimeType: MimeType;
  size: ByteSize;
  finalUrl: string;
}>;
```

**エラーケース**: `SystemError(ExternalServiceError)`（通信失敗・タイムアウト）、`NotFoundError("REMOTE_RESOURCE_NOT_FOUND")`（404）、`ValidationError("REMOTE_RESOURCE_TOO_LARGE")`

### DnsResolver

```ts
interface DnsResolver {
  resolve(hostname: string): Promise<readonly string[]>;   // IP アドレスの文字列
}
```

**エラーケース**: `SystemError(ExternalServiceError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `storage.fileStored` | `{ fileId, owner, purpose, size }` | Usage の加算 |
| `storage.fileOwnerChanged` | `{ fileId, previousOwner, currentOwner, size }` | Usage の付け替え |
| `storage.fileDeleted` | `{ fileId, owner, purpose, size, objectKey }` | Usage の減算、オブジェクトの実削除 |

オブジェクトストレージ上の実体の削除は `storage.fileDeleted` を購読するワーカーが行う。メタデータの削除とオブジェクトの削除を同一トランザクションにできないため、メタデータを先に消して実体を後から回収する（孤児オブジェクトは残るが、参照されないため害がない）。

## エラーコード

```
StorageErrorCode =
  | "InvalidId" | "InvalidObjectKey" | "InvalidByteSize"
  | "UnsupportedMimeType" | "FileTooLarge"
  | "ArtifactMustBeEphemeral" | "RefusedUrl" | "FetchBudgetExceeded"
```

## ユースケース（概要）

`startBulkUpload`, `storeUpload`, `storeMedia`, `storeAvatar`, `issueDownloadUrl`, `importExternalReferences`, `deleteFiles`, `collectExpiredArtifacts`, `collectOrphanMedia`, `relocateFilesForNote`, `deleteFilesByOwner`

詳細は [usecases/storage.md](../usecases/storage.md)。
