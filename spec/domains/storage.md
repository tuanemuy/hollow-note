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
- **補助**: `ByteSize.exceeds(limit: ByteSize): boolean`（`UploadValidationPolicy.ensureAcceptable` が上限との比較に使う。ユースケースからは直接呼ばない）

### Checksum

- **フィールド**: `algorithm: "sha256"`, `value: string`
- **バリデーション**: `value` は 64 文字の 16 進数

### FilePurpose

- **フィールド**: `value: "source" | "media" | "reference" | "artifact" | "avatar"`

| 値 | 意味 | 回収 |
| --- | --- | --- |
| `source` | アップロードされた元ファイル | ノートの完全削除時 |
| `media` | 編集中に挿入した画像・動画 | 作成から 30 日が経過し、かつ本文から参照されていないとき |
| `reference` | 本文から取り込んだ外部リソース | ノートの完全削除時 |
| `artifact` | 生成物（PDF / ZIP） | `expiresAt` の経過時 |
| `avatar` | 利用者・ワークスペースのアイコン | 差し替え時 |

`source` / `reference` の「ノートの完全削除時」の回収と、`media` の孤児判定は、`StoredFile` の `noteId` で所属ノートを解決して行う（`note.purged` の購読と孤児メディアの走査）。`media` の回収の起点を「参照が外れた時刻」ではなく作成時刻に取るのは、本文から参照が外れた時刻を保持しないため。走査時点で本文に現れないことを確認してから消す（[usecases/storage.md](../usecases/storage.md) の `collectOrphanMedia`）。

### StorageOwner

```
StorageOwner =
  | { type: "user"; userId: UserId }
  | { type: "workspace"; workspaceId: WorkspaceId }
```

容量の帰属先を表す。個人のノートに属するファイルは `user`、ワークスペースのノートに属するファイルは `workspace`。

生成物（`artifact`）の帰属は要求の文脈で決まる。サインイン済みの要求では要求者の個人 subject（`user`）、匿名の PDF エクスポートでは対応する利用者が存在しないため対象ノートの所有文脈に帰属させる。artifact は容量クォータに算入しない（[usage.md](./usage.md)）ため、この帰属の差異にクォータ上の副作用はない（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。

## エンティティ

### StoredFile（集約ルート）

```
FileProvenance =
  | { purpose: "source" | "media" | "reference"; noteId: NoteId; uploadedBy: UserId }
  | { purpose: "avatar"; noteId: null; uploadedBy: UserId }
  | { purpose: "artifact"; noteId: NoteId; noteVersion: number; uploadedBy: UserId | null }
  | { purpose: "artifact"; noteId: null; noteVersion: null; uploadedBy: UserId | null }

StoredFileBase = {
  id: StoredFileId
  owner: StorageOwner
  objectKey: ObjectKey
  fileName: FileName
  mimeType: MimeType
  size: ByteSize
  checksum: Checksum
  version: number
  createdAt: Date
  updatedAt: Date
}

PersistentFile = StoredFileBase & { retention: "persistent" } & Exclude<FileProvenance, { purpose: "artifact" }>
EphemeralFile  = StoredFileBase & { retention: "ephemeral"; expiresAt: Date } & FileProvenance
StoredFile = PersistentFile | EphemeralFile
```

`PersistentFile` から `artifact` の由来を除くことで、「生成物なのに期限を持たない」状態を型で表現できなくする（生成物は必ず `expiresAt` を持ち `collectExpiredArtifacts` が回収する）。`FileProvenance` を保持側の union に配ったのはこのためで、`StoredFileBase` は由来に依らない共通フィールドだけを持つ。

`noteId` は所属ノート（[note.md](./note.md) の `NoteId`）。`source` / `media` / `reference` はノートに従属するため必須で、`note.purged` 後の回収・孤児判定・ノート移動時の付け替えの手がかりになる。`artifact` は単一ノート由来の生成物（PDF エクスポート、一括ダウンロードの子）のときだけ `noteId` と生成元の版 `noteVersion`（生成時点の Note の `version`）を持ち、一括ダウンロードの ZIP では両方 null。`avatar` はノートに属さない。

**不変条件**

- `objectKey` はサービス全体で一意
- `EphemeralFile` の `expiresAt > createdAt`
- `uploadedBy === null` になるのは匿名の閲覧者による PDF エクスポートの artifact のみ（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `register` | `params: { id: string; owner: StorageOwner; objectKey: ObjectKey; fileName: string; mimeType: string; size: number; checksum: Checksum } & Exclude<FileProvenance, { purpose: "artifact" }>, now: Date` | `WithEventDrafts<PersistentFile, StorageEvent>` | `storage.fileStored` を発行。`artifact` は引数の型で弾かれるため実行時の検査を持たない |
| `registerEphemeral` | `params: { id: string; owner: StorageOwner; objectKey: ObjectKey; fileName: string; mimeType: string; size: number; checksum: Checksum } & FileProvenance, ttlMs: number, now: Date` | `WithEventDrafts<EphemeralFile, StorageEvent>` | `expiresAt = now + ttlMs`。`storage.fileStored` を発行。`artifact` を作れる唯一の経路 |
| `changeOwner` | `file: StoredFile, owner: StorageOwner, now: Date` | `WithEventDrafts<StoredFile, StorageEvent>` | ノートの移動に追随する。`storage.fileOwnerChanged`（旧所有者・用途・サイズを含む）を発行 |
| `isExpired` | `file: StoredFile, now: Date` | `boolean` | `EphemeralFile` のみ真になりうる |

削除はユースケースが `StorageEvents.fileDeleted` を直接発行する。

## ドメインサービス

### UploadValidationPolicy

**責務**: 受け入れてよいアップロードかを、保管前に判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `limitFor` | `purpose: FilePurpose, mimeType: MimeType` | `ByteSize` | 下表の上限を引く |
| `ensureAcceptable` | `params: { purpose: FilePurpose; mimeType: MimeType; size: ByteSize }` | `void` | 用途ごとの許可 MIME に反すれば `BusinessRuleError(UnsupportedMimeType)`、`size.exceeds(limitFor(purpose, mimeType))` なら `BusinessRuleError(FileTooLarge)` |

| 用途 | 許可する MIME | 上限 |
| --- | --- | --- |
| `source` | 取り込み対応形式（`text/html`, `text/markdown`, `text/plain`, Office 3 種, `application/pdf`, `image/*`, `audio/*`） | 音声 200 MB、その他 50 MB |
| `media` | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `video/mp4`, `video/webm` | 画像 20 MB、動画 200 MB |
| `reference` | 任意（取得できたもの） | 1 件 20 MB |
| `artifact` | `application/pdf`, `application/zip`, `text/html`, `text/markdown` | 1 GB |
| `avatar` | `image/png`, `image/jpeg`, `image/webp` | 5 MB |

`limitFor` はユースケースからは直接呼ばない。上限の表を引く責務を切り出して `ensureAcceptable` の実装に使うもので、外向きの入口は `ensureAcceptable` に限る。

**依存するポート**: なし

### ExternalFetchPolicy

**責務**: 本文中の外部参照を取得してよいかを判定する（IM-05）。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureFetchable` | `url: string` | `void` | スキームが `http` / `https` 以外、ホストが private / loopback / link-local / メタデータ用アドレスに解決される、既にサービス内のストレージを指す、のいずれかなら `BusinessRuleError(RefusedUrl)` |
| `budget` | `—` | `FetchBudget` | 1 ノートあたりの取り込み上限。`ensureWithinBudget` の判定基準であり、`RemoteResourceFetcher.fetch` に渡す 1 件あたりの `limits` の出どころでもある（[usecases/storage.md](../usecases/storage.md) の `importExternalReferences`） |
| `ensureWithinBudget` | `state: FetchState, nextSize: ByteSize` | `void` | `budget()` に対して件数またはバイト数が上限を超えるなら `BusinessRuleError(FetchBudgetExceeded)` |

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
  listByNote(noteId: NoteId): Promise<readonly StoredFile[]>;
  findArtifactByNoteAndVersion(noteId: NoteId, noteVersion: number, mimeType: MimeType, now: Date): Promise<EphemeralFile | null>;
  listExpired(now: Date, limit: number): Promise<readonly EphemeralFile[]>;
  listByPurposeOlderThan(purpose: FilePurpose, createdBefore: Date, limit: number): Promise<readonly StoredFile[]>;
  sumSizeByOwner(owner: StorageOwner): Promise<number>;
  listByOwner(owner: StorageOwner, purpose: FilePurpose | null, pagination: Pagination): Promise<PaginationResult<StoredFile>>;
}
```

チェックサムによる重複保管の回避は行わない。`StoredFile` は `FileProvenance` で所属ノートと由来を持つため、同一内容でもノートごとに別の行が要る（1 行を複数ノートで共有すると `note.purged` 後の回収と所有者の付け替えが成立しない）。実体の共有はメタデータと blob を分ける設計を要し、本設計の範囲外とする。所有者単位の一括削除（`deleteFilesByOwner`）も、1 件ごとに `storage.fileDeleted` を発行して Usage の減算と実体の回収につなげる必要があるため、`listByOwner` + `deleteFiles` の反復で行い一括削除のメソッドは持たない。

`listByNote` は `noteId` が一致する全ファイルを引く。`artifact` も `noteId` を持つため結果に混ざる。`note.purged` 後の回収（`deleteFilesForNote`）とノート移動時の所有者付け替え（`relocateFilesForNote`）はどちらも `source` / `media` / `reference` だけが対象なので、呼び出し側が `purpose` で絞る。生成物は所属ノートの都合ではなく `expiresAt` の経過で `collectExpiredArtifacts` が回収し、所有者も生成時の帰属のまま動かさない（容量クォータに算入されないため、付け替えても意味を持たない）。`findArtifactByNoteAndVersion` は期限内（`expiresAt > now`）の `artifact` を引き、`exportNote` の PDF 分岐での相乗り・再利用に使う（複数あれば最新の 1 件）。`listByPurposeOlderThan` は所有者に依らず用途と作成時刻だけで走査する（`createdAt < createdBefore` を `id` の昇順で `limit` 件）。孤児メディアの回収（`collectOrphanMedia`）は全体走査であり所有者を絞れないため、所有者を必須とする `listByOwner` では引けない。`sumSizeByOwner` は `purpose: "artifact"` を除外して合算する（生成物は容量クォータに算入しない。増分集計と同じ除外規則。[usage.md](./usage.md)）。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("OBJECT_KEY_ALREADY_USED")`、`SystemError(DatabaseError)`

### ObjectStorage

**目的**: オブジェクトストレージへの読み書き。

```ts
interface ObjectStorage {
  put(key: ObjectKey, body: ReadableStream<Uint8Array> | Uint8Array, meta: ObjectMeta): Promise<PutResult>;
  get(key: ObjectKey): Promise<ObjectBody | null>;
  deleteMany(keys: readonly ObjectKey[]): Promise<void>;
  createDownloadUrl(key: ObjectKey, params: { fileName: FileName; expiresInMs: number }): Promise<string>;
}

type ObjectMeta = Readonly<{ mimeType: MimeType; size: ByteSize; checksum: Checksum | null }>;
type ObjectBody = Readonly<{ stream: ReadableStream<Uint8Array>; meta: ObjectMeta }>;
type PutResult = Readonly<{ size: ByteSize; checksum: Checksum }>;
```

削除は複数鍵の `deleteMany` だけを置き、1 件用の `delete` は持たない。削除の唯一の経路が `storage.fileDeleted` のまとまりを受ける `deleteStoredObjects`（[usecases/storage.md](../usecases/storage.md)）で、1 件の削除も要素 1 個の配列で表せるため。実サイズとチェックサムは `put` の `PutResult` が返すので、保管後に問い合わせ直す `head` も持たない。

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
| `storage.fileStored` | `{ fileId, owner, purpose, size }` | Usage の加算（[`applyStorageDelta`](../usecases/usage.md)） |
| `storage.fileOwnerChanged` | `{ fileId, previousOwner, currentOwner, purpose, size }` | Usage の付け替え（`applyStorageDelta`） |
| `storage.fileDeleted` | `{ fileId, owner, purpose, size, objectKey }` | Usage の減算（`applyStorageDelta`）、オブジェクトの実削除（[`deleteStoredObjects`](../usecases/storage.md)） |

3 つのイベントがそろって `purpose` を運ぶのは、`artifact` が容量クォータに算入されない（[usage.md](./usage.md)）ため購読側が用途で除外できなければならないから。`fileOwnerChanged` だけ `purpose` を欠くと、加算されていない生成物の容量を旧主体から減算して新主体へ加算する経路ができ、集計が壊れる。現在この事故は `relocateFilesForNote` が `artifact` を対象外にすること（[usecases/storage.md](../usecases/storage.md)）で防いでいるが、除外は 1 か所の絞り込みに依存させず購読側でも効くようにしておく — 付け替えの経路が将来増えたとき、`applyStorageDelta` 側の 1 行で守れる。

オブジェクトストレージ上の実体の削除は `storage.fileDeleted` を購読する `deleteStoredObjects` が行う。メタデータの削除とオブジェクトの削除を同一トランザクションにできないため、メタデータを先に消して実体を後から回収する（孤児オブジェクトは残るが、参照されないため害がない）。イベントが `objectKey` を含むのはこのためで、購読側はファイルの行を引き直さずに削除できる。

## エラーコード

```
StorageErrorCode =
  | "InvalidId" | "InvalidObjectKey" | "InvalidByteSize"
  | "UnsupportedMimeType" | "FileTooLarge"
  | "RefusedUrl" | "FetchBudgetExceeded"
```

## ユースケース（概要）

`startBulkUpload`, `storeUpload`, `storeMedia`, `storeAvatar`, `issueDownloadUrl`, `importExternalReferences`, `deleteFiles`, `deleteStoredObjects`, `collectExpiredArtifacts`, `collectOrphanMedia`, `relocateFilesForNote`, `deleteFilesForNote`, `deleteFilesByOwner`

詳細は [usecases/storage.md](../usecases/storage.md)。
