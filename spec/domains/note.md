# Note

ノートの本文・所属・公開範囲とその変遷を保つ。本文モデルは [ADR 006](../adr/006-html-content-model.md)、所属は [ADR 003](../adr/003-note-ownership-model.md)、スタイルは [ADR 007](../adr/007-default-style-isolation.md)、読み取りは [ADR 009](../adr/009-read-models.md) に従う。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| Note | ノート | HTML 断片を本文として持つ 1 件の文書 |
| Owner | 所有者 | ノートが属する先。個人またはワークスペース |
| Content | 本文 | ノートの中身。未生成・処理中・失敗・生成済みのいずれかの状態を取る |
| Visibility | 公開ステータス | 非公開 / 限定公開 / 公開 |
| ShareLink | 共有リンク | 限定公開のノートに到達するための、推測できない秘密 |
| StyleMode | 表示スタイル | 既定スタイルを当てるか、元の装飾のみにするか |
| Revision | 版 | 保存のたびに記録される過去の本文 |
| Trash | ゴミ箱 | 削除されたが完全削除前のノートが置かれる状態 |

## 値オブジェクト

### NoteId / RevisionId

- **バリデーション**: 空白のみは不可。`BusinessRuleError(NoteErrorCode.InvalidId)`

### NoteTitle

- **フィールド**: `value: string`, `origin: "auto" | "manual"`
- **バリデーション**: 前後の空白を除去して 200 文字以内。空になった場合は `"無題"` に置き換える（例外を投げない）
- **等価性**: `value` が一致（`origin` は等価性に関与しない）
- `origin` はタイトルの由来。アップロード時のファイル名や変換結果からの自動命名は `auto`、利用者が入力したものは `manual`。`auto` のタイトルだけが変換結果によって上書きされる
- **補助**: `NoteTitle.auto(value: string)`, `NoteTitle.manual(value: string)`, `NoteTitle.isAuto(title): boolean`

### NoteHtml

- **フィールド**: `value: string`
- **バリデーション**: サニタイズ済みであることが前提。1 MB（UTF-8 バイト数）を超える場合 `BusinessRuleError(ContentTooLarge)`
- **生成経路**: `HtmlProcessor.process` / `rewriteReferences` / `editTextNodes` の結果、および空の本文を作る `NoteHtml.empty()` のみ
- **等価性**: 文字列として一致

### PlainTextContent

- **フィールド**: `value: string`
- **バリデーション**: なし（本文から抽出したテキスト。検索と抜粋の元）

### Excerpt

- **フィールド**: `value: string`
- **バリデーション**: 200 文字以内。`Excerpt.fromText(text, 200)` で切り出す

### NoteHeading

- **フィールド**: `level: number`（1〜6）, `text: string`, `anchorId: string`
- **バリデーション**: `level` は 1〜6 の整数、`anchorId` は空文字列不可
- **生成**: `HtmlProcessor.process` の結果からのみ構築する。本文の保存時に算出して保持し、取得のたびに再計算しない

### StyleMode

- **フィールド**: `value: "default" | "preserve"`
- **バリデーション**: 既知の値のみ

### NoteOwner

```
NoteOwner =
  | { type: "user"; userId: UserId }
  | { type: "workspace"; workspaceId: WorkspaceId }
```

- **バリデーション**: 判別子と ID の組が揃っていること
- **等価性**: `type` と ID が一致
- **補助**: `NoteOwner.equals(a, b): boolean`

### ShareLink

```
ShareLink = {
  tokenHash: TokenHash
  password: { hash: PasswordHash; updatedAt: Date } | null   // updatedAt はパスワードを設定・変更した時刻
  issuedAt: Date
}
```

- **バリデーション**: `tokenHash` は空文字列不可
- **等価性**: `tokenHash` が一致
- パスワードのハッシュと更新時刻は常に対で持つ。片方だけが存在する状態は型で表現できない

### SharePass

閲覧者の端末が保持する「パスワードを通過済み」の証。

```
SharePass = {
  tokenHash: TokenHash
  passwordUpdatedAt: Date       // 通過した時点の ShareLink.password.updatedAt
  issuedAt: Date
}
```

- **バリデーション**: `tokenHash` は空文字列不可
- **有効期間**: 発行から 24 時間
- **保持方法**: 署名付きの値としてクライアントに持たせる。改ざん検知は presentation 層の責務

PDF エクスポートの結果到達に使う `ExportTicket`（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）も SharePass と同型の署名付きの値だが、Note の不変条件に一切関与せず `JobId` を参照するため、ドメインではなくアプリケーション層の型として定義する（[usecases/note.md](../usecases/note.md) の「共通: ExportTicket」）。これにより Note → Job の依存は生じない。

### ConversionFailureReason（Conversion ドメインからの参照）

変換の失敗理由は [Conversion](./conversion.md) が定義する。Note の本文が保持する `NoteFailureReason` は、そこから `integrationRequired` を除き `canceled` を足したものである — `integrationRequired` は `failed` ではなく `awaitingIntegration` が担うことを型で表す。原因の詳細文字列は Job 側が持つ。

`machineExtractionUnavailable` は `NoteFailureReason` に含まれる。利用者が `conversionPreference: "machineOnly"` を選んだ結果 LLM 必須形式を取り込めなかった状態であり、「連携すれば本文を作れる」`awaitingIntegration` とは区別する（案内は連携ではなく方針の変更を指す）。

`canceled`（「処理が取り消されました」）は、実行中の変換ジョブがワーカーの生存を待たずに終端させられたときに、`processing` のまま残る本文を回復させるために付ける理由である（[usecases/job.md](../usecases/job.md) の「共通: 強制終端の後始末」。連携の失効による一括失敗だけは、実行時の失敗と表示を揃えるため `providerAuthFailed` を使う）。`ConversionFailureReason` には足さない — 変換の実行がこの理由を返すことはなく、外から止められたことだけを表す値だからである。`unknown` に畳まないのは、利用者に示す次の一手が「取り込み直す・再試行する」と一意に定まるため。

取り込み時の本文の初期値も同じく Conversion が `InitialContentState`（`NoteContent` から `ready` を除いた 3 状態）として決める。`Note.createFromUpload` はこれを直接受け取り、状態と理由を組み立て直さない — `ready` のノートを取り込みから作れないことが型で保たれる。

## エンティティ

### Note（集約ルート）

```
NoteFailureReason = Exclude<ConversionFailureReason, "integrationRequired"> | "canceled"

NoteContent =
  | { status: "processing" }
  | { status: "awaitingIntegration" }
  | { status: "failed"; reason: NoteFailureReason }
  | { status: "ready"; html: NoteHtml; text: PlainTextContent; excerpt: Excerpt; headings: readonly NoteHeading[] }

NoteVisibility =
  | { status: "private";  dormantShareLink: ShareLink | null }
  | { status: "unlisted"; shareLink: ShareLink }
  | { status: "public";   publishedAt: Date; dormantShareLink: ShareLink | null }

NoteBase = {
  id: NoteId
  owner: NoteOwner
  createdBy: UserId
  title: NoteTitle
  content: NoteContent
  visibility: NoteVisibility
  styleMode: StyleMode
  sourceFileId: StoredFileId | null
  version: number
  createdAt: Date
  updatedAt: Date
}

ActiveNote  = NoteBase & { lifecycle: "active" }
TrashedNote = NoteBase & { lifecycle: "trashed"; trashedAt: Date; purgeAfter: Date }
Note = ActiveNote | TrashedNote
```

`unlisted` は `shareLink` を必ず持ち、`private` / `public` は休眠中の共有リンクを保持しうる。これにより「限定公開なのにリンクがない」状態を型で排除しつつ、非公開に戻したあと再び限定公開にすると同じリンクが復活する要件を満たす。

**再生成中は編集拒否**

`content.status === "processing"` は**初回変換がまだ終わっていない**ことだけを表す。再生成（IM-06 / IN-07）の実行中は本文を `ready` のまま保ち、失敗しても元の本文が壊れない。対象ノートに実行中の変換・再生成ジョブがあるとき、本文編集は `BusinessRuleError(NoteLockedByJob)` で拒否される。この判定は Job ドメイン側に実行中のジョブが存在するか（`JobRepository.listActiveByTarget`）で行い、Note は関知しない（[usecases/note.md](../usecases/note.md) の `updateNoteBody` / `applyTextNodeEdits` の手順 2）。

**不変条件**

- `content.status !== "ready"` のノートは公開・限定公開にできない
- `public` のノートはパスワード保護を持たない（`dormantShareLink.password` は常に `null`）
- `TrashedNote` に対する本文・公開設定・所属の変更はできない
- `purgeAfter = trashedAt + 30 日`

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `createFromUpload` | `params: { id: string; owner: NoteOwner; createdBy: UserId; title: string; sourceFileId: StoredFileId; initialContent: InitialContentState; styleMode: StyleMode }, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 非公開・`lifecycle: "active"` で生成。`initialContent` は Conversion の `InitialContentState`（`ready` を含まない）をそのまま `content` に据える。`note.created` を発行 |
| `createBlank` | `params: { id: string; owner: NoteOwner; createdBy: UserId; title: string }, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 本文は空の `ready`（`html` は `""`）で生成。`styleMode` は `default`。`note.created` を発行 |
| `applyConversionResult` | `note: ActiveNote, result: { html: NoteHtml; text: PlainTextContent; excerpt: Excerpt; headings: readonly NoteHeading[]; styleMode: StyleMode; title: NoteTitle \| null }, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | `content` を `ready` にする。`title` が渡され、かつ `NoteTitle.isAuto(note.title)` が真のときだけタイトルを差し替える。`note.contentUpdated` を発行（タイトルが変わった場合は `note.renamed` も併発） |
| `markConversionFailed` | `note: ActiveNote, reason: NoteFailureReason, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | `content` を `failed` にする。`note.conversionFailed` を発行 |
| `markAwaitingIntegration` | `note: ActiveNote, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | `content` を `awaitingIntegration` にする。初回変換の結果としてのみ呼ばれる。`note.awaitingIntegration` を発行 |
| `updateBody` | `note: ActiveNote, processed: ProcessedHtml, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 編集による本文差し替え。`content` を `ready` に更新。`note.contentUpdated` を発行 |
| `rename` | `note: ActiveNote, title: string, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | `NoteTitle.create` で正規化。`note.renamed` を発行 |
| `changeStyleMode` | `note: ActiveNote, mode: string, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | `StyleMode.create` で検証して更新。`note.styleModeChanged` を発行 |
| `moveTo` | `note: ActiveNote, owner: NoteOwner, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 同じ所有者なら変更もイベントもなし。異なれば更新し `note.moved`（旧所有者を含む）を発行 |
| `makePrivate` | `note: ActiveNote, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 現在の共有リンクを休眠として保持したまま `private` へ。`note.visibilityChanged` を発行 |
| `makeUnlisted` | `note: ActiveNote, newLink: ShareLink \| null, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | `content.status !== "ready"` なら `BusinessRuleError(CannotPublishEmptyNote)`。休眠リンクがあれば復活させ、なければ `newLink` を使う。どちらもなければ `BusinessRuleError(ShareLinkRequired)`。`note.visibilityChanged` を発行 |
| `makePublic` | `note: ActiveNote, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | `content.status !== "ready"` なら `BusinessRuleError(CannotPublishEmptyNote)`。共有リンクのパスワードを解除して休眠させる。`note.visibilityChanged` と `note.published` を発行 |
| `reissueShareLink` | `note: ActiveNote, newLink: ShareLink, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 限定公開でなければ `BusinessRuleError(NotUnlisted)`。既存のパスワードは維持したままトークンを差し替える。`note.shareLinkReissued` を発行 |
| `setSharePassword` | `note: ActiveNote, passwordHash: PasswordHash \| null, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 限定公開でなければ `BusinessRuleError(NotUnlisted)`。`passwordHash` が `null` でなければ `shareLink.password` を `{ hash: passwordHash, updatedAt: now }` に差し替え、既存の通過証をすべて失効させる。`null` なら `shareLink.password = null` にする（解除）。`note.sharePasswordChanged` を発行 |
| `trash` | `note: ActiveNote, now: Date` | `WithEventDrafts<TrashedNote, NoteEvent>` | `trashedAt = now`、`purgeAfter = now + 30 日`。`note.trashed` を発行 |
| `restore` | `note: TrashedNote, now: Date` | `WithEventDrafts<ActiveNote, NoteEvent>` | 公開ステータス・共有リンク・スタイルはそのまま復元。`note.restored` を発行 |

完全削除は後継エンティティを持たないため、ユースケースが `NoteEvents.purged` を直接発行する。

**ライフサイクル**

`createFromUpload` / `createBlank` → `ActiveNote` → `trash` → `TrashedNote` → `restore` で戻るか、`purgeAfter` 経過後に完全削除。

### NoteRevision（集約ルート）

```
NoteRevision = {
  id: RevisionId
  noteId: NoteId
  html: NoteHtml
  title: NoteTitle
  styleMode: StyleMode
  createdBy: UserId
  createdAt: Date
  reason: RevisionReason
}

RevisionReason = "manualEdit" | "regeneration" | "wysiwygConversion" | "restore"
```

不変（作成後に変更されない）ため OCC は持たない。

**不変条件**

- 1 つのノートにつき最新 20 件のみを保持する。超過分は古いものから削除される

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `capture` | `params: { id: string; note: ActiveNote; createdBy: UserId; reason: RevisionReason }, now: Date` | `NoteRevision` | 現在の本文が `ready` でなければ `BusinessRuleError(CannotCaptureEmptyContent)` |

## ドメインサービス

### NoteAccessPolicy

**責務**: ある閲覧者があるノートに対して何をできるかを判定する。

```
NoteViewer =
  | { kind: "anonymous" }
  | { kind: "user"; userId: UserId; workspaceRole: WorkspaceRole | null }

ShareCredential = {
  tokenHash: TokenHash | null      // 提示された共有トークンのハッシュ
  pass: SharePass | null            // 端末が保持している通過証
}

NoteAccess =
  | { kind: "granted"; canEdit: boolean; canDelete: boolean; canChangeVisibility: boolean }
  | { kind: "passwordRequired" }
  | { kind: "denied" }
```

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `evaluate` | `note: Note, viewer: NoteViewer, credential: ShareCredential, now: Date` | `NoteAccess` | 下表の順に判定する |
| `ensureCanEdit` | `note: Note, viewer: NoteViewer` | `void` | 編集不可なら `BusinessRuleError(AccessDenied)` |
| `isPassValid` | `link: ShareLink, pass: SharePass \| null, now: Date` | `boolean` | `pass` が `null`、`link.password` が `null`、`tokenHash` が不一致、発行から 24 時間経過、`pass.passwordUpdatedAt` が `link.password.updatedAt` と異なる、のいずれかなら偽 |
| `issuePass` | `link: ShareLink, now: Date` | `SharePass` | パスワード照合に成功した直後に発行する |

判定順:

1. **所有関係による判定**（この経路だけがゴミ箱のノートに到達できる）
   - `owner.type === "user"` かつ `viewer.userId === owner.userId` → `granted { canEdit: true, canDelete: true, canChangeVisibility: true }`
   - `owner.type === "workspace"` かつ `viewer.workspaceRole !== null` → `note.lifecycle === "trashed"` かつ `WorkspaceAuthorization.can(role, "viewTrash")` が偽なら `denied`。それ以外は `WorkspaceAuthorization.can(role, action)` に従って各権限を決め `granted`（`viewer` ロールは 3 つとも `false`）
   - どちらでもなければ 2 へ進む
2. **ゴミ箱の遮断**: `note.lifecycle === "trashed"` なら `denied`（1 で決着しなかった閲覧者はゴミ箱のノートに到達できない。ワークスペースのメンバーで `viewTrash` を持たない者は 1 で既に `denied` になっており、ここへは来ない）
3. `visibility.status === "public"` → `granted { canEdit: false, canDelete: false, canChangeVisibility: false }`
4. `visibility.status === "unlisted"` かつ `credential.tokenHash` が `shareLink.tokenHash` と一致
   - `shareLink.password !== null` かつ `isPassValid(shareLink, credential.pass, now)` が偽 → `passwordRequired`
   - それ以外 → `granted { canEdit: false, canDelete: false, canChangeVisibility: false }`
5. いずれにも当たらない → `denied`

1 で `granted` になった閲覧者がゴミ箱のノートを開いた場合、`canEdit` は返るが Note の振る舞い側で `TrashedNote` に対する更新が型として拒まれる（`updateBody` などは `ActiveNote` のみを受け取る）。

**依存するポート**: なし（`WorkspaceAuthorization` はドメインサービスとして注入する）

### NoteOwnershipPolicy

**責務**: 所属先の移動が許されるかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureMovable` | `note: Note, from: NoteAccess, to: TargetOwnerAccess` | `void` | 移動元で編集不可、または移動先で作成不可なら `BusinessRuleError(AccessDenied)`。`note.content.status` が `processing` なら `BusinessRuleError(CannotMoveWhileProcessing)` |

```
TargetOwnerAccess = { owner: NoteOwner; canCreate: boolean }
```

**依存するポート**: なし

## ポート

### HtmlProcessor

**目的**: 生の HTML をサニタイズし、保存に必要な派生情報を 1 度の走査で取り出す。

```ts
interface HtmlProcessor {
  process(rawHtml: string): ProcessedHtml;
  extractExternalReferences(html: NoteHtml): readonly ExternalReference[];
  rewriteReferences(html: NoteHtml, replacements: ReadonlyMap<string, string>): NoteHtml;
  editTextNodes(html: NoteHtml, edits: readonly TextNodeEdit[]): EditTextNodesResult;
}

type ProcessedHtml = Readonly<{
  html: NoteHtml;
  text: PlainTextContent;
  excerpt: Excerpt;
  hasDecoration: boolean;                     // style 要素 / stylesheet / 意味のある style 属性の有無
  headings: readonly { level: number; text: string; anchorId: string }[];
  removed: readonly RemovedNode[];            // サニタイズで除去した要素・属性
}>;

type RemovedNode = Readonly<{ kind: "element" | "attribute" | "url"; name: string; reason: string }>;
type ExternalReference = Readonly<{ url: string; attribute: string; elementName: string }>;
type TextNodeEdit = Readonly<{ path: string; expected: string; text: string }>;
```

`TextNodeEdit.path` は本文のルートからテキストノードまでの経路を、各階層の 0 始まりの子ノード索引をドット区切りで並べた文字列で表す（例: `"2.0.1"`）。`process` が返す HTML に対して安定しており、ビジュアルエディタ（ED-02）は表示時に同じ規則で経路を割り当てる。

`expected` は編集前にそのノードが持っていた文字列。`editTextNodes` は経路が解決できない、または現在の文字列が `expected` と一致しない場合、その編集だけを適用せず `SkippedEdit` として返す。要素の追加・削除・並べ替えは行わない。空文字列への更新はノードを削除せず空のまま残す。

```ts
type EditTextNodesResult = Readonly<{ html: NoteHtml; skipped: readonly SkippedEdit[] }>;
type SkippedEdit = Readonly<{ path: string; reason: "pathNotFound" | "contentChanged" }>;
```

`editTextNodes` の戻り値は `EditTextNodesResult`。

`hasDecoration` は `StyleMode` の自動判定に使う（[ADR 007](../adr/007-default-style-isolation.md)）。

**エラーケース**: `SystemError(ExternalServiceError)`（パース不能）。壊れた HTML は例外にせず、補正した結果を返す

### PdfRenderer

**目的**: 本文を PDF にする（EX-01）。

```ts
interface PdfRenderer {
  render(params: { html: NoteHtml; title: NoteTitle; styleMode: StyleMode; timeoutMs: number }): Promise<Uint8Array>;
}
```

`styleMode === "default"` のときだけ既定スタイルを当てる。外部リソースの取得は行わず、埋め込み済みの参照だけを描画する。

**エラーケース**: `SystemError(TimeoutError)`、`SystemError(ExternalServiceError)`

### NoteExportComposer

**目的**: 1 ファイルの HTML を組み立てる（EX-01）。

```ts
interface NoteExportComposer {
  composeSelfContainedHtml(params: {
    html: NoteHtml;
    title: NoteTitle;
    styleMode: StyleMode;
    resolveAsset: (url: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  }): Promise<string>;
}
```

`resolveAsset` が `null` を返した参照は元の URL のまま残す。

**エラーケース**: `SystemError(ExternalServiceError)`

### NoteRepository

```ts
interface NoteRepository extends TransactionalRepository<Note, NoteId> {
  findByShareToken(tokenHash: TokenHash): Promise<Note | null>;
  listByIds(ids: readonly NoteId[]): Promise<readonly Note[]>;
  listPurgeable(now: Date, limit: number): Promise<readonly TrashedNote[]>;
  countByOwner(owner: NoteOwner, lifecycle: "active" | "trashed" | "all"): Promise<number>;
  listByOwner(owner: NoteOwner, lifecycle: "active" | "trashed" | "all", pagination: Pagination): Promise<PaginationResult<Note>>;
  listAll(cursor: NoteId | null, limit: number): Promise<readonly Note[]>;
}
```

- `listByOwner` の `lifecycle` は `countByOwner` と同じ 3 値を取る。ゴミ箱だけを対象にする `emptyTrash`、生死を問わない `deleteNotesForOwner` / `rebuildNoteProjection` がそれぞれ別の値で呼ぶため、件数と一覧で絞り込みの語彙を揃える
- `listAll` は所有者を問わない全件走査。読み取りモデルの全体再構築（`rebuildNoteProjection` の owner 未指定）だけが使う運用向けのメソッドで、`NoteId` の昇順で返し `cursor` より後ろを `limit` 件ずつ読む（総件数を数えないため `PaginationResult` を返さない）。通常の一覧経路から呼んではならない

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

### NoteRevisionRepository

```ts
interface NoteRevisionRepository {
  insert(revision: NoteRevision): Promise<void>;
  listByNote(noteId: NoteId, limit: number): Promise<readonly NoteRevision[]>;
  findById(id: RevisionId): Promise<NoteRevision | null>;
  deleteOlderThanNewest(noteId: NoteId, keep: number): Promise<number>;
  deleteByNote(noteId: NoteId): Promise<number>;
}
```

**エラーケース**: `SystemError(DatabaseError)`

### NoteQueryService

**目的**: 一覧・検索・タイムラインの読み取り。読み取りモデル（[ADR 009](../adr/009-read-models.md)）に対して問い合わせる。キーワード検索は書き込み時前処理による bigram 方式で、2 文字以上のクエリが有効（前処理・クエリ構築の詳細は [ADR 011](../adr/011-bigram-search.md) と database 設計）。

```ts
interface NoteQueryService {
  search(criteria: NoteSearchCriteria): Promise<PaginationResult<NoteSummary>>;
  searchPublic(criteria: PublicSearchCriteria): Promise<PaginationResult<PublicNoteSummary>>;
  listMonthsWithNotes(owner: NoteOwner, timeZone: string): Promise<readonly YearMonth[]>;
  countByDay(owner: NoteOwner, range: DateRange, timeZone: string): Promise<readonly { day: string; count: number }[]>;
  countByContentStatus(owner: NoteOwner, status: "processing" | "awaitingIntegration" | "failed" | "ready"): Promise<number>;
  listPublicSitemapEntries(cursor: NoteId | null, limit: number): Promise<readonly SitemapEntry[]>;
  listPublicAuthors(cursor: string | null, limit: number): Promise<readonly PublicAuthorEntry[]>;
}

type NoteSearchCriteria = Readonly<{
  owner: NoteOwner;
  lifecycle: "active" | "trashed";
  keyword: string | null;                 // 2 文字以上のとき有効。1 文字以下は呼び出し側が null にする
  tagNames: readonly string[];            // すべてを持つノート（AND）。`TagName` の正規化規則を適用済みの名前で渡す
  createdWithin: DateRange | null;        // 月の絞り込みは、利用者のタイムゾーンで解決した範囲として渡す
  sort: NoteSortKey;
  pagination: Pagination;
}>;

type DateRange = Readonly<{ from: Date; toExclusive: Date }>;

type PublicSearchCriteria = Readonly<{
  keyword: string | null;
  tagNames: readonly string[];            // 同じく正規化済みの名前
  ownerFilter: NoteOwner | null;          // 公開ページ内の検索で使う
  updatedWithin: DateRange | null;        // `note_search.updated_at`（結果に表示する日時と同じ軸）に対する範囲。UTC で解決した範囲として渡す
  pagination: Pagination;
}>;

type NoteSortKey = "updatedDesc" | "updatedAsc" | "createdDesc" | "createdAsc" | "titleAsc" | "titleDesc" | "relevance";

type NoteSummary = Readonly<{
  id: string;
  title: string;
  excerpt: string;                        // 平文。表示側がエスケープして描く
  highlightedExcerpt: string | null;      // HTML 断片（エスケープ済みの本文に <mark> のみ）。keyword 指定時のみ。生テキスト（excerpt / text）由来。一致がなければ null
  visibility: "private" | "unlisted" | "public";
  contentStatus: "processing" | "awaitingIntegration" | "failed" | "ready";
  styleMode: "default" | "preserve";
  ownerType: "user" | "workspace";
  ownerId: string;
  createdBy: string;
  tagNames: readonly string[];            // 表示名（正規化前）。絞り込みの照合は正規化名で行う
  hasSourceFile: boolean;
  createdAt: Date;
  updatedAt: Date;
  trashedAt: Date | null;
  purgeAfter: Date | null;
}>;

type PublicNoteSummary = NoteSummary & Readonly<{
  authorHandle: string | null;
  authorDisplayName: string;
  workspaceSlug: string | null;
  workspaceName: string | null;
}>;

type YearMonth = Readonly<{ year: number; month: number }>;   // month は 1〜12。timeZone で解釈した暦月
type SitemapEntry = Readonly<{ noteId: string; updatedAt: Date }>;
type PublicAuthorEntry = Readonly<{ userId: string; updatedAt: Date }>;   // 個人所有の公開・有効ノートを 1 件以上持つ利用者
```

期間の絞り込みは、個人向けの `search` が**作成日時**（`createdWithin`。OR-05 の月セレクターとカレンダーが作成日を軸にするため）、横断・公開ページ向けの `searchPublic` が**更新日時**（`updatedWithin`）と、基準列が異なる。公開検索が更新日時を採るのは、**結果に表示する日時と同じ軸で絞れる**ことが利用者から見た前提であり（DS-05 / P-41 は一覧に更新日時を出す。絞り込んだ範囲と並んでいる日時が一致しないと結果が読めない）、公開行を絞る索引が `note_search_public_updated_idx` / `note_search_owner_public_updated_idx`（いずれも `updated_at DESC` の部分索引）だけだからで、作成日時を基準にすると同じ絞り込みを支える索引がない。境界はどちらも `DateRange` の規約どおり `from` 以上 `toExclusive` 未満。`createdWithin` は利用者のタイムゾーンで解決した範囲を受け取るが、`updatedWithin` は閲覧者のタイムゾーンを持てない（サインイン不要の経路）ため UTC で解決した範囲を受け取る（[usecases/note.md](../usecases/note.md) の `searchPublicNotes`）。

`highlightedExcerpt` は**生テキスト由来**である。`search` / `searchPublic` の一致判定は bigram 前処理済みの FTS 列で行うが、その列は「東京 京都 都庁」のようなビグラム列なので表示に使えない（[ADR 011](../adr/011-bigram-search.md)）。ハイライトは読み取りモデルの生テキスト（`note_search.excerpt`、なければ `text`）に対し、検索語と同じ NFKC 正規化 + 小文字化を適用した照合で一致位置を求めて組み立てる（[database/index.md](../database/index.md) の「ハイライトと抜粋の生成」）。`keyword` 未指定のときと、生テキストに一致が現れないとき（タイトル・タグ名だけで一致した行など）は `null` を返し、画面は素の `excerpt` を出す。

**`excerpt` と `highlightedExcerpt` の描画契約は正反対である**。同じ DTO に平文と HTML 断片が並ぶため、契約を型の隣に明記する。

- `excerpt` / `title` / `tagNames` は**平文**。表示側がテキストとして描く（React なら素の文字列として渡す）
- `highlightedExcerpt` は**HTML 断片**。生成側が生テキストを HTML エスケープしてから一致区間を `<mark>` … `</mark>` で囲むため、含まれるタグは `<mark>` だけであることが保証される。表示側はこの値だけを `dangerouslySetInnerHTML` で描いてよい
- エスケープの責任を生成側（クエリポートの実装＝アダプター）に置くのは、標識を入れる側でなければ「どこがエスケープすべき本文で、どこが自分が入れたタグか」を区別できないためである（[database/index.md](../database/index.md) の「ハイライトと抜粋の生成」）。表示側で後からエスケープすると `<mark>` ごと無害化され、生成側でエスケープしないと本文中の `<script>` がそのまま描かれる
- `null` のときに素の `excerpt` へフォールバックする経路は、**平文としての描画に切り替える**。HTML として描く枝と平文として描く枝を取り違えない

`listPublicAuthors` は**所有者基準**で列挙する — `owner_type = 'user'` の公開かつ有効なノートを 1 件以上持つ利用者について、その利用者の当該ノートの最新更新時刻を添えて `userId` の昇順で返す。著者基準（`created_by`）ではない。母集合は `/@:handle` の一覧（`searchPublic` の `ownerFilter: { type: "user", userId }`）と一致しなければならないためで、ハンドルは読み取りモデルが所有者の列として持たないので呼び出し側が `UserRepository.listByIds` で解決する（[usecases/identity.md](../usecases/identity.md) の `listPublicProfiles`）。`cursor` は最後に読んだ `userId`。

**エラーケース**: `SystemError(DatabaseError)`、`SystemError(TimeoutError)`（検索のタイムアウト）

### NoteProjectionWriter

**目的**: 読み取りモデルを更新する。イベント購読側（プロジェクション）から呼ばれる。各メソッドは `note_search` 本体（bigram 前処理済み列を含む）・タグの正規化表（`note_search_tags`）・FTS 索引の同期まで、自分が触れる範囲について責任を持つ（[ADR 011](../adr/011-bigram-search.md)、詳細は database 設計）。ただし `updateAuthor` / `updateWorkspace` は FTS 対象列（タイトル・本文・タグ名）に触れないため FTS 更新は不要。

```ts
interface NoteProjectionWriter {
  upsert(entry: NoteProjectionEntry): Promise<void>;
  updateTags(noteId: NoteId, tags: readonly ProjectedTagName[]): Promise<void>;
  updateAuthor(userId: UserId, displayName: string, handle: string | null): Promise<void>;
  updateWorkspace(workspaceId: WorkspaceId, name: string, slug: string | null, published: boolean): Promise<void>;
  remove(noteId: NoteId): Promise<void>;
}

type ProjectedTagName = Readonly<{ name: string; normalized: string }>;   // TagName の表示名と正規化名

type NoteProjectionEntry = Readonly<{
  noteId: NoteId;
  owner: NoteOwner;
  createdBy: UserId;
  author: Readonly<{ displayName: string; handle: string | null }>;
  workspace: Readonly<{ name: string; slug: string | null; published: boolean }> | null;   // owner.type === "workspace" のとき必須、user のとき null
  title: string;
  text: string;
  excerpt: string;
  visibility: "private" | "unlisted" | "public";
  contentStatus: "processing" | "awaitingIntegration" | "failed" | "ready";
  styleMode: "default" | "preserve";
  hasSourceFile: boolean;
  lifecycle: "active" | "trashed";
  createdAt: Date;
  updatedAt: Date;
  trashedAt: Date | null;
  purgeAfter: Date | null;
}>;
```

`author` は `createdBy` の利用者、`workspace` は所有ワークスペースの表示情報（`note_search` の `author_*` / `workspace_*` 列に対応）で、`upsert` の呼び出し側が投影のたびに解決して渡す。`updateAuthor` が更新するのは `createdBy` がその利用者であるすべての行の著者表示 — ワークスペース所有ノートでも作成者を表示する。退会した作成者の行は削除せず、`updateAuthor(userId, "退会した利用者", null)` で埋める（[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）。

`contentStatus` / `styleMode` は `upsert` でしか更新されない。したがって本文状態とスタイルを変える振る舞いはすべてイベントを発行しなければならない — `applyConversionResult` / `updateBody`（`note.contentUpdated`）、`markConversionFailed`（`note.conversionFailed`）、`markAwaitingIntegration`（`note.awaitingIntegration`）、`changeStyleMode`（`note.styleModeChanged`）。1 つでも欠けると読み取りモデルが恒久的に古くなり、`countByContentStatus` を根拠とする案内（`completeIntegrationOAuth` の「要 LLM 連携の N 件」）と一覧の表示が実体とずれる。

**タグ列の分掌**

タグは読み取りモデルの 4 か所 — 関連度用の `note_search.tag_names` / `tag_names_fts`、一覧の表示名用の `note_search.tag_display_names`、絞り込み用の `note_search_tags` — に投影される（[database/index.md](../database/index.md) の「タグ列の同期契約」）。書き分けは次のとおり。

- `upsert` はタグの 4 か所に**一切触れない**（`NoteProjectionEntry` にタグのフィールドがないのはこのため）。ノート本体の投影でタグが消えることはなく、逆にノート本体の投影だけでタグを再構築することもできない。タグを伴う再構築は `upsert` と `updateTags` の 2 呼び出しで行う
- `updateTags` はノートのタグ集合を丸ごと入れ替え、4 か所を同一バッチで更新する。関連度用の列と `note_search_tags.normalized` には `normalized` を、一覧に載る表示名（`NoteSummary.tagNames`）の `tag_display_names` には `name` を用いる。`NoteSearchCriteria.tagNames` / `PublicSearchCriteria.tagNames` は正規化名で照合するため、絞り込みは表示ゆれの影響を受けない
- `remove` は `note_search` の行・FTS 索引の行・`note_search_tags` の当該ノートの行をすべて消す

**エラーケース**: `SystemError(DatabaseError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `note.created` | `{ noteId, owner, createdBy, sourceFileId }` | 読み取りモデルの投影、Usage の集計 |
| `note.contentUpdated` | `{ noteId }` | 読み取りモデルの投影 |
| `note.conversionFailed` | `{ noteId, reason }` | 読み取りモデルの投影 |
| `note.awaitingIntegration` | `{ noteId }` | 読み取りモデルの投影（`content_status` の反映。`countByContentStatus` による「要 LLM 連携の N 件」の案内が依存する） |
| `note.renamed` | `{ noteId, title }` | 読み取りモデルの投影 |
| `note.styleModeChanged` | `{ noteId, styleMode }` | 読み取りモデルの投影（`style_mode` の反映） |
| `note.visibilityChanged` | `{ noteId, previous, current }` | 読み取りモデル、サイトマップ |
| `note.published` | `{ noteId }` | 監査（サイトマップは読み取りモデルから引くため専用の購読者はない） |
| `note.shareLinkReissued` | `{ noteId }` | 監査 |
| `note.sharePasswordChanged` | `{ noteId }` | 監査 |
| `note.moved` | `{ noteId, previousOwner, currentOwner }` | Tag の付け替え（`relocateAssignmentsForNote`）、Storage の保管ファイルの所有者付け替え（`relocateFilesForNote`）、読み取りモデルの投影（`projectNoteChanges`）、Usage の付け替え（`applyStorageDelta`） |
| `note.trashed` | `{ noteId, owner }` | 読み取りモデル、サイトマップからの除去 |
| `note.restored` | `{ noteId, owner }` | 読み取りモデル、サイトマップ |
| `note.purged` | `{ noteId, owner, sourceFileId }` | Storage の保管ファイル回収（`deleteFilesForNote`）、Tag の付与削除（`deleteAssignmentsForNote`）、Integration のバックアップ記録削除（`deleteBackupRecordsForNote`）、読み取りモデルの行削除（`projectNoteChanges` → `remove`）、Usage の減算（`applyStorageDelta`） |

## エラーコード

```
NoteErrorCode =
  | "InvalidId" | "InvalidTitle" | "ContentTooLarge" | "InvalidStyleMode" | "InvalidOwner"
  | "CannotPublishEmptyNote" | "NotUnlisted" | "ShareLinkRequired"
  | "CannotCaptureEmptyContent" | "CannotMoveWhileProcessing"
  | "AccessDenied" | "NoteIsTrashed" | "NoteLockedByJob"
```

## ユースケース（概要）

`createBlankNote`, `getNote`, `getSharedNote`, `getPublicNote`, `searchNotes`, `searchPublicNotes`, `countNotesByCreationDate`, `updateNoteBody`, `applyTextNodeEdits`, `renameNote`, `changeNoteStyleMode`, `moveNote`, `changeNoteVisibility`, `setSharePassword`, `reissueShareLink`, `verifySharePassword`, `trashNote`, `restoreNote`, `purgeNote`, `emptyTrash`, `purgeExpiredTrash`, `deleteNotesForOwner`, `listNoteRevisions`, `restoreNoteRevision`, `exportNote`, `runNoteExport`, `getExportStatus`, `downloadExportArtifact`, `requestBulkExport`, `runBulkExportItem`, `runBulkExport`, `requestBulkNoteOperation`, `runBulkNoteOperationItem`, `listSitemapEntries`, `projectNoteChanges`, `rebuildNoteProjection`

詳細は [usecases/note.md](../usecases/note.md)。
