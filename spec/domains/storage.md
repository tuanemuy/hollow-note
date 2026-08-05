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
| ReferenceAttempt | 取得試行 | 本文中の外部参照 1 件を取りにいった結果の記録。ノートと URL の組で 1 件 |

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

### ReferenceAttempt

本文中の外部参照 1 件を取りにいった結果（[ADR 014](../adr/014-import-result-provenance.md)）。

```
ReferenceAttemptOutcome =
  | { status: "imported"; fileId: StoredFileId }        // リソース参照。保管して差し替えた
  | { status: "inlined" }                                // スタイルシート。本文に埋め込んだ
  | { status: "failed"; reason: ReferenceFailureReason }
  | { status: "notAttempted"; reason: "budgetExceeded" }

ReferenceFailureReason = "notFound" | "timeout" | "tooLarge" | "refusedUrl" | "unreadable" | "unknown"

ReferenceAttempt = Readonly<{
  noteId: NoteId;
  url: string;                                           // 取得を試みた元の URL
  kind: "resource" | "stylesheet";
  outcome: ReferenceAttemptOutcome;
  attemptedAt: Date;
}>
```

- **バリデーション**: `url` は空文字列不可。`kind: "stylesheet"` の `outcome.status` は `imported` にならない（スタイルシートは保管しない）。`kind: "resource"` の `outcome.status` は `inlined` にならない
- 集約ではない。不変条件は 1 件の中で閉じており、版も持たない。`importExternalReferences` が本文の保存と同一の Unit of Work で書く

**この記録が語るのは「なぜ」だけである**。「どの参照が未解決か」「どのスタイルシートが埋め込まれ、どれが失われたか」は本文自身が語る（[domains/note.md](./note.md) の `HtmlProcessor` の痕跡の 3 状態）。読み取り側は本文と記録を突き合わせ、**本文にその URL がもう現れない記録は表示しない**。これにより古い記録を掃除する規則が要らなくなる。

**「記録に行があるか」が「試行済みか未試行か」を分ける**。本文の上では、取得に失敗したリソース参照・一度も試行していない参照・予算超過で打ち切られた参照がいずれも「外部 URL がそのまま残っている」という同じ姿になり区別できない。記録の有無がその区別を与える。

行数は 1 ノートあたり `FetchBudget.maxCount`（200）で上界が決まる。取得を試みた参照だけが記録されるため、予算を超えて打ち切られた分（`notAttempted`）を含めても 1 回の実行で増えるのはその上限までである。

### ReferenceImportSummary

直近の取り込み 1 回分の要約。ノートにつき 1 件。

```
ReferenceImportSummary = Readonly<{
  noteId: NoteId;
  removedCss: readonly { property: string; count: number }[];   // 分類ごとに畳んだ形
  completedAt: Date;
}>
```

`removedCss` は、取り込んだ CSS を本文へ書き戻したあとのサニタイズで宣言・規則の単位に落ちたもの（`position: fixed` / `position: sticky` / `@import`）を、プロパティ名ごとに件数へ畳んだ値である（[ADR 013](../adr/013-html-sanitization-policy.md) の「利用者に提示する件数が従来より増えるため、除去の一覧は分類ごとに畳める形が要る」）。生の一覧を持たないのは、取り込んだ第三者のスタイルシートが `position: fixed` を多用していれば宣言が数百件落ちうるためで、畳めば要素数は落とす対象の種類数（現在は 3）で頭打ちになる。

利用者が書いた CSS の除去はここに入らない。それは保存操作への応答（`updateNoteBody` の出力 DTO の `removed`）が担う。この要約が持つのは**利用者が書いていない内容が黙って変わった**分だけである。

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
| `relocateForMove` | `file: StoredFile, owner: StorageOwner, now: Date` | `StoredFile` | move snapshotをtarget scopeで復元するときだけ使う。通常のeventは発行せず、migration operationがUsage deltaを担う |
| `isExpired` | `file: StoredFile, now: Date` | `boolean` | `EphemeralFile` のみ真になりうる |

削除はユースケースが `StorageEvents.fileDeleted` を直接発行する。

application層は `registerEphemeral` の保存と同じscope-local UoWで最小`expiresAt`のartifact cleanup taskをupsertする。`register`で`purpose: "media"`を初めて保存するときも日次orphan-media taskを自己登録する。これらはStoredFile集約の状態遷移ではなくscope Alarmの起動責務なので、ドメインメソッドのeventへ暗黙に含めない。

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
| `ensureFetchable` | `url: string` | `void` | スキームが `http` / `https` 以外、ホストが private / loopback / link-local / メタデータ用アドレスに解決される、`StorageUrlPolicy.isInternal` が真、のいずれかなら `BusinessRuleError(RefusedUrl)` |
| `budget` | `—` | `FetchBudget` | 1 ノートあたりの取り込み上限。`ensureWithinBudget` の判定基準であり、`RemoteResourceFetcher.fetch` に渡す 1 件あたりの `limits` の出どころでもある（[usecases/storage.md](../usecases/storage.md) の `importExternalReferences`） |
| `ensureWithinBudget` | `state: FetchState, nextSize: ByteSize` | `void` | `budget()` に対して件数またはバイト数が上限を超えるなら `BusinessRuleError(FetchBudgetExceeded)` |

```
FetchBudget = Readonly<{ maxCount: number; maxTotalBytes: number; perItemTimeoutMs: number }>;
FetchState  = Readonly<{ fetchedCount: number; fetchedBytes: number }>;
```

既定値は `{ maxCount: 200, maxTotalBytes: 100 * 1024 * 1024, perItemTimeoutMs: 10_000 }`。

外部スタイルシートもこの予算に等しく数える。ただし取得した CSS は本文に `<style>` としてインライン化されるだけで保管しないため（[usecases/storage.md](../usecases/storage.md) の `importExternalReferences`）、`StoredFile` にはならず容量クォータ（[usage.md](./usage.md)）にも算入されない。この予算が抑えるのは 1 ノートあたりの外部取得そのものであって、保管量ではない。

予算を超えて取得に至らなかった参照は、リソース参照なら本文に元の URL のまま残り、スタイルシートなら痕跡が `data-stylesheet-unavailable` になる（[domains/note.md](./note.md)）。どちらも**再試行の主体を持たない** — 打ち切りは成功として終端するため `Job.retry` の対象にならず、次に本文を保存したときに改めて参照取り込みジョブが登録されるまで手つかずのまま残る。この状態は `ReferenceAttempt` の `outcome.status: "notAttempted"` として記録され、ノート詳細が「上限に達したため打ち切られた」と示す根拠になる。

**依存するポート**: `DnsResolver`（ホスト名からアドレスを解決して private 判定を行う）、`StorageUrlPolicy`

### StorageUrlPolicy

**責務**: URL がサービス内のストレージを指すかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `isInternal` | `url: string` | `boolean` | 配信元がサービス自身のストレージなら真 |

`ExternalFetchPolicy.ensureFetchable` の複合条件から**この 1 つだけを切り出した**ものである。切り出す理由は 2 つある。

- `ensureFetchable` は `DnsResolver` に依存し、ホスト名を解決して private / loopback / メタデータ用アドレスを弾く。読み取り経路（ノート詳細で「未解決の参照はどれか」を求める）で呼ぶには重すぎるうえ、I/O を伴う
- 同じ判定を `importExternalReferences` の `skipped` の判定、参照取り込みジョブの登録条件（[usecases/note.md](../usecases/note.md) の `updateNoteBody`、[usecases/conversion.md](../usecases/conversion.md) の `runConversion` / `runRegeneration`）、`collectOrphanMedia` の参照判定、そしてノート詳細の合成が使う。1 か所に置かないと規則が分岐する

判定材料（配信元のホストや URL の前置き）は構成に依存するため、値は `AppConfig`（[presentation/index.md](../presentation/index.md)）から供給する。`ensureFetchable` は引き続きこの判定を内部で使い、内部を指す URL を `RefusedUrl` として弾く。

**依存するポート**: なし

## ポート

### StoredFileRepository

repository は現在の ScopeKey に束縛される。Note 由来のfile metadataはNoteと同じscope、Job生成物はJobと同じscopeに置く。fileId単独ではscopeを復元できないため、外部入口はNote route、JobId、または明示的なstorage ScopeKeyのいずれかを先に受ける。`StorageOwner`は物理shardを上書きしない。

```ts
interface StoredFileRepository extends TransactionalRepository<StoredFile, StoredFileId> {
  listByIds(ids: readonly StoredFileId[]): Promise<readonly StoredFile[]>;
  listByNote(noteId: NoteId): Promise<readonly StoredFile[]>;
  listDeletableByNote(noteId: NoteId, limit: number): Promise<readonly StoredFile[]>;
  findArtifactByNoteAndVersion(noteId: NoteId, noteVersion: number, mimeType: MimeType, now: Date): Promise<EphemeralFile | null>;
  listExpired(now: Date, limit: number): Promise<readonly EphemeralFile[]>;
  listByPurposeOlderThan(purpose: FilePurpose, createdBefore: Date, limit: number): Promise<readonly StoredFile[]>;
  sumSizeByOwner(owner: StorageOwner): Promise<number>;
  listByOwner(owner: StorageOwner, purpose: FilePurpose | null, pagination: Pagination): Promise<PaginationResult<StoredFile>>;
}
```

チェックサムによる重複保管の回避は行わない。`StoredFile` は `FileProvenance` で所属ノートと由来を持つため、同一内容でもノートごとに別の行が要る（1 行を複数ノートで共有すると `note.purged` 後の回収と所有者の付け替えが成立しない）。実体の共有はメタデータと blob を分ける設計を要し、本設計の範囲外とする。所有者単位の一括削除（`deleteFilesByOwner`）も、1 件ごとに `storage.fileDeleted` を発行して Usage の減算と実体の回収につなげる必要があるため、`listByOwner` + `deleteFiles` の反復で行い一括削除のメソッドは持たない。

`listByNote` はcurrent scopeで `noteId` が一致する全ファイルを引く。moveでは `source` / `media` / `reference` metadataをsnapshotへ含め、target scopeへ同じR2 keyで復元する。artifactはJob scopeに残し `expiresAt` で回収する。`listByPurposeOlderThan` の所有者に依らない走査もcurrent scope内に限り、全DO走査ではない。`sumSizeByOwner` はartifactを除外する。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`ConflictError("OBJECT_KEY_ALREADY_USED")`、`SystemError(DatabaseError)`

### ReferenceImportRecordRepository

**目的**: 外部参照の取得結果を保持する（[ADR 014](../adr/014-import-result-provenance.md)）。

```ts
interface ReferenceImportRecordRepository {
  saveAttempts(attempts: readonly ReferenceAttempt[]): Promise<void>;
  putSummary(summary: ReferenceImportSummary): Promise<void>;
  listAttemptsByNote(noteId: NoteId): Promise<readonly ReferenceAttempt[]>;
  findSummaryByNote(noteId: NoteId): Promise<ReferenceImportSummary | null>;
  deleteByNote(noteId: NoteId, limit: number): Promise<number>;
}
```

- `saveAttempts` は `(noteId, url)` を鍵に上書きする。1 回の取り込みが試みた参照だけを渡し、触れなかった URL の記録は残る（前回失敗した参照に今回手が届かなかった場合、その理由が消えてはならない）
- `putSummary` はノートにつき 1 件を上書きする
- `TransactionalRepository` を継承しない。集約ではなく版も持たないため、`Versioned<T>` も楽観ロックも要らない。ただし書き込みは本文の保存と同一の Unit of Work に載る
- `deleteByNote` は外部参照attemptとsummaryを合わせて最大`limit`件だけ削除し、`note.purged` を購読する `deleteFilesForNote`（[usecases/storage.md](../usecases/storage.md)）が呼ぶ。専用の購読者は置かない
- 読み取り（`listAttemptsByNote` / `findSummaryByNote`）はノート詳細の合成が呼ぶ。**ノートを読める者すべてが読める** — この記録はノートに帰属し、要求者に帰属しない（ジョブとの違いは ADR 014）

**エラーケース**: `SystemError(DatabaseError)`

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

`createDownloadUrl` の `expiresInMs` は**呼び出し側が渡す**が、値そのものは配備で変わらない設計上の決定なので正典を 1 か所に置く — [platform/index.md](../platform/index.md) の「転送境界」に **5 分**として記す。この値は独立に選べない: `exportNote` が既存の生成物を再利用してよい下限（`expiresAt >= now + 35 分`。[usecases/note.md](../usecases/note.md)）は「`ExportTicket` の有効期間 30 分 + ダウンロード URL の有効期間」として導かれており、URL の有効期間を伸ばすなら下限も同じだけ伸びる。

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
| `storage.fileDeleted` | `{ fileId, owner, purpose, size, objectKey, deletionOperationId: string | null }` | Usage の減算、オブジェクト実削除。scope cleanup由来ならadmission tokenも運ぶ |

`fileStored` / `fileDeleted` が `purpose` を運ぶのは、artifactをUsageから除外するためである。scope間moveはowner change eventを発行せず、migration snapshotのbytes合計をsource / targetのlocal commandで1回ずつ適用する。

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
