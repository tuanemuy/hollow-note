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
- **バリデーション**: サニタイズ済みであることが前提。**800,000 バイト**（UTF-8）を超える場合 `BusinessRuleError(ContentTooLarge)`
- **生成経路**: `HtmlProcessor.process` / `rewriteReferences` / `editTextNodes` の結果、および空の本文を作る `NoteHtml.empty()` のみ
- **等価性**: 文字列として一致

上限が 800,000 バイトなのは、scope DO の SQLite に置く `notes` の 1 行が D1 / DO 共通の行サイズ上限（2,000,000 バイト）に収まることを設計として示せるようにするためである（[ADR 017](../adr/017-content-size-budget.md)）。本文とその派生（平文・見出し・抜粋）は同じ行に載るため、合計の予算から逆算した値になる。予算の内訳は [platform/index.md](../platform/index.md) の「行サイズの予算」。

### PlainTextContent

- **フィールド**: `value: string`
- **バリデーション**: 800,000 バイト（UTF-8）以内。本文からの抽出はタグの除去・実体参照の解決・空白の畳み込みだけを行いバイト数を増やさないため、構造上 `NoteHtml` の上限を超えない。明示の上限としても同値を置く

### Excerpt

- **フィールド**: `value: string`
- **バリデーション**: 200 文字以内。`Excerpt.fromText(text, 200)` で切り出す

### NoteHeading

- **フィールド**: `level: number`（1〜6）, `text: string`, `anchorId: string`
- **バリデーション**: `level` は 1〜6 の整数、`anchorId` は空文字列不可、`text` は 100 文字以内（超過分は切り捨てる）
- **生成**: `HtmlProcessor.process` の結果からのみ構築する。本文の保存時に算出して保持し、取得のたびに再計算しない
- **件数**: 1 ノートあたり 200 件まで。超えた見出しは捨てる（目次の網羅性より行サイズの保証を優先する。[ADR 017](../adr/017-content-size-budget.md)）

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
  protectedToken: ProtectedShareToken
  password: { hash: PasswordHash; updatedAt: Date } | null   // updatedAt はパスワードを設定・変更した時刻
  issuedAt: Date
}
```

- **バリデーション**: `tokenHash` と `protectedToken.cipherText` は空文字列不可。`protectedToken.keyVersion` は正の整数
- **等価性**: `tokenHash` が一致
- パスワードのハッシュと更新時刻は常に対で持つ。片方だけが存在する状態は型で表現できない
- 利用者へ渡すトークンは `base64url(NoteId).secret` の形を取り、`secret` は 256 ビット以上の乱数とする。前半は scope を引くための locator であって秘密ではなく、アクセス能力は後半の秘密と `tokenHash` の一致が与える
- `protectedToken` は所有者へ同じ共有 URL を再表示するための暗号文である。平文トークンは保存せず、閲覧要求では復号せずに入力全体のハッシュを定数時間比較する

```
ProtectedShareToken = {
  cipherText: string
  keyVersion: number
}
```

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

サニタイズ規則の正典は [ADR 013](../adr/013-html-sanitization-policy.md)（許可する要素・属性・URL スキームの列挙、CSS の内容制約）であり、`HtmlProcessor` はその唯一の適用点である。取り込み・編集・メディア挿入・SVG ファイルの保管（[usecases/storage.md](../usecases/storage.md) の `storeMedia`）はいずれもこのポートを通す。

```ts
interface HtmlProcessor {
  process(rawHtml: string): ProcessedHtml;
  extractExternalReferences(html: NoteHtml): readonly ExternalReference[];
  rewriteReferences(html: NoteHtml, replacements: ReadonlyMap<string, string>): NoteHtml;
  inlineStylesheets(html: NoteHtml, contents: ReadonlyMap<string, string>, unavailable: ReadonlySet<string>): NoteHtml;
  editTextNodes(html: NoteHtml, edits: readonly TextNodeEdit[]): EditTextNodesResult;
}

type ProcessedHtml = Readonly<{
  html: NoteHtml;
  text: PlainTextContent;
  excerpt: Excerpt;
  hasDecoration: boolean;                     // style 要素 / stylesheet / 意味のある style 属性の有無
  headings: readonly { level: number; text: string; anchorId: string }[];
  removed: readonly RemovedNode[];            // サニタイズで除去した要素・属性・URL・CSS
}>;

type RemovedNode = Readonly<{ kind: "element" | "attribute" | "url" | "css"; name: string; reason: string }>;
type ExternalReference = Readonly<{ url: string; attribute: string; elementName: string }>;
type TextNodeEdit = Readonly<{ path: string; expected: string; text: string }>;
```

`TextNodeEdit.path` は本文のルートからテキストノードまでの経路を、各階層の 0 始まりの子ノード索引をドット区切りで並べた文字列で表す（例: `"2.0.1"`）。`process` が返す HTML に対して安定しており、ビジュアルエディタ（ED-02）は表示時に同じ規則で経路を割り当てる。

`expected` は編集前にそのノードが持っていた文字列。`editTextNodes` は経路が解決できない、または現在の文字列が `expected` と一致しない場合、その編集だけを適用せず `SkippedEdit` として返す。要素の追加・削除・並べ替えは行わない。空文字列への更新はノードを削除せず空のまま残す。

**`<style>` の子テキストノードには経路を割り当てない**。`<style>` の中身はテキストノードなので、経路を与えるとビジュアルエディタから CSS を直接書き換えられ、[ADR 013](../adr/013-html-sanitization-policy.md) の内容制約（`position: fixed` / `sticky` / `@import` の除去）を迂回して再注入できてしまう。ビジュアルモードは「テキストノードのみを書き換える」（[ADR 006](../adr/006-html-content-model.md)）が、その「テキスト」は読み物としての文字列を指し、スタイルシートの中身は含まない。経路が割り当たらないため、この位置を指す編集は `pathNotFound` として `skipped` に落ちる。呼び出し側は結果を `process` に通してから保存する（[usecases/note.md](../usecases/note.md) の `applyTextNodeEdits`）。

```ts
type EditTextNodesResult = Readonly<{ html: NoteHtml; skipped: readonly SkippedEdit[] }>;
type SkippedEdit = Readonly<{ path: string; reason: "pathNotFound" | "contentChanged" }>;
```

`editTextNodes` の戻り値は `EditTextNodesResult`。

`removed` は許可リスト方式の報告であり、危険と名指しされたものだけでなく、**許可リストから外れたために除去された要素・属性**も対象になる。`kind` の内訳は、`element`（列挙にない要素、および `script` / `iframe` などの非許可要素）、`attribute`（列挙にない属性、`on*`、`srcdoc`）、`url`（許可しないスキーム）、`css`（`<style>` 要素とインライン `style` 属性から宣言・規則の単位で落とした `position: fixed` / `position: sticky` / `@import`）である。`name` は要素名・属性名・スキーム名・プロパティ名を、`reason` は除去理由を表す。

`hasDecoration` は `StyleMode` の自動判定に使う（[ADR 007](../adr/007-default-style-isolation.md)）。判定はサニタイズで除去する前の入力に対して行うため、許可リストから外れる `link rel=stylesheet` も装飾の痕跡として数える。

**外部スタイルシートの痕跡**

`process` は `<link rel="stylesheet" href="…">` を除去して `removed` に報告すると同時に、**同じ位置に空の `<style data-stylesheet-href="元の URL">` を残す**。`style` 要素と `data-*` 属性はいずれも許可リストの内側にある（[ADR 013](../adr/013-html-sanitization-policy.md)）。除去したうえで痕跡を残すのは、外部スタイルシートを `<style>` としてインライン化するという ADR 013 の決定を実行可能にするためである — サニタイズは取り込み時に走り、参照を取得する `importExternalReferences`（[usecases/storage.md](../usecases/storage.md)）はそのあとに走るので、痕跡がなければ元の URL がその間に失われる。元の位置に置くのは CSS のカスケード順が `<link>` の並びに依存するためである。

痕跡は `data-*` 属性に URL を持つ通常の要素なので、`extractExternalReferences` は `{ url, attribute: "data-stylesheet-href", elementName: "style" }` として**他の外部参照と同じ形**で返す。`ExternalReference` の形は変わらない。

**痕跡の 3 状態**（[ADR 014](../adr/014-import-result-provenance.md)）

取得の結果を痕跡の属性名で表し、**抽出の対象を `data-stylesheet-href` だけに限定する**。

| 状態 | 本文中の表現 | `extractExternalReferences` が拾うか |
| --- | --- | --- |
| 未取り込み（未試行、または利用者が取り込まないと選んだ） | `<style data-stylesheet-href="URL">`（空） | ○ |
| 取り込み済み | `<style data-imported-stylesheet="URL">…CSS…</style>` | × |
| 取得できなかった（失敗・予算超過） | `<style data-stylesheet-unavailable="URL">`（空） | × |

`inlineStylesheets(html, contents, unavailable)` が痕跡を遷移させる。`contents` の鍵は `data-stylesheet-href` の値、値は取得した CSS で、この痕跡は `data-imported-stylesheet` に属性を付け替えて中身に CSS を書き戻す。`unavailable` に含まれる URL の痕跡は `data-stylesheet-unavailable` に付け替え、中身は空のまま残す。どちらにも現れない痕跡は手を触れない（`data-stylesheet-href` のまま残り、次に取り込みを選んだ保存で対象になる）。

**取得できなかった痕跡を要素ごと取り除かない**のは、それが「この URL のスタイルシートを取り込めず装飾を失った」という事実の唯一の記録になるからである。当初は取り除く決定だったが、その根拠は「空の痕跡を残すと以後の保存のたびに同じ参照取り込みジョブが登録され続ける」という再登録ループ 1 つだけであり、抽出の対象を `data-stylesheet-href` に限定した時点で失効している。

書き戻した CSS も本文の一部として ADR 013 の内容制約（`position: fixed` / `sticky` / `@import` の除去）を受けるため、呼び出し側は結果を `process` に通してから保存する。`process` は 3 つの属性をいずれも許可リストの内側の `data-*` としてそのまま通し、痕跡の状態を巻き戻さない（`data-imported-stylesheet` を `data-stylesheet-href` に戻すことはない）。`rewriteReferences` は URL を URL に写す差し替えであって内容の埋め込みには使えず、`editTextNodes` は要素を追加しないため、この操作は独立したメソッドとして持つ。

これらの属性は**利用者が HTML モードで手書きできる**。本文は利用者が書き換えられる領域なので、痕跡は「本文に記録された取り込み元」であって監査記録ではない。再取得・認可・監査の入力に使ってはならない（ADR 014）。

**内部参照の判定**

`extractExternalReferences` は「外部」参照だけを返すのではなく、**本文中の属性ベースの URL 参照をすべて返す**。サービス内のストレージを指す URL も含まれる — `collectOrphanMedia`（[usecases/storage.md](../usecases/storage.md)）は保管済みメディアの URL が本文に現れるかを調べるのにこのポートを使っており、内部の URL が除外されると参照中のメディアを孤児と誤判定してしまう。

内部と外部の切り分けは呼び出し側が行う。判定は `StorageUrlPolicy.isInternal`（[domains/storage.md](./storage.md)）を使う。参照取り込みジョブを登録するかどうかも、抽出結果のうち内部を指さないものが 1 件以上あるかで判定する。

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
  listByIds(ids: readonly NoteId[]): Promise<readonly Note[]>;
  listPurgeable(now: Date, limit: number): Promise<readonly TrashedNote[]>;
  countByOwner(owner: NoteOwner, lifecycle: "active" | "trashed" | "all"): Promise<number>;
  listByOwner(owner: NoteOwner, lifecycle: "active" | "trashed" | "all", pagination: Pagination): Promise<PaginationResult<Note>>;
}
```

- `listByOwner` の `lifecycle` は `countByOwner` と同じ 3 値を取る。ゴミ箱だけを対象にする `emptyTrash`、生死を問わない `deleteNotesForOwner` / `rebuildNoteProjection` がそれぞれ別の値で呼ぶため、件数と一覧で絞り込みの語彙を揃える
- repository は現在の ScopeKey に束縛され、scope をまたぐ全件走査を提供しない。local projection の再構築は `listByOwner(currentScope, "all", ...)`、public projection の再構築は global D1 の `note_routes` を入口にする

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

### LocalNoteQueryService / PublicNoteQueryService

**目的**: 一覧・検索・タイムラインの読み取り。読み取りモデル（[ADR 009](../adr/009-read-models.md)）に対して問い合わせる。キーワード検索は書き込み時前処理による bigram 方式で、2 文字以上のクエリが有効（前処理・クエリ構築の詳細は [ADR 011](../adr/011-bigram-search.md) と database 設計）。

```ts
interface LocalNoteQueryService {
  search(criteria: NoteSearchCriteria): Promise<PaginationResult<NoteSummary>>;
  listMonthsWithNotes(owner: NoteOwner, timeZone: string): Promise<readonly YearMonth[]>;
  countByDay(owner: NoteOwner, range: DateRange, timeZone: string): Promise<readonly { day: string; count: number }[]>;
  countByContentStatus(owner: NoteOwner, status: "processing" | "awaitingIntegration" | "failed" | "ready"): Promise<number>;
}

interface PublicNoteQueryService {
  searchPublic(criteria: PublicSearchCriteria): Promise<PublicSearchPage>;
  listPublicSitemapEntries(cursor: string | null, limit: number): Promise<ShardPage<SitemapEntry>>;
  listPublicAuthors(cursor: string | null, limit: number): Promise<ShardPage<PublicAuthorEntry>>;
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
  cursor: string | null;                  // shard generation・各shard keyset/rankを含む署名opaque cursor
  limit: number;
}>;

type PublicSearchPage = Readonly<{
  items: readonly PublicNoteSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

type ShardPage<T> = Readonly<{ items: readonly T[]; nextCursor: string | null }>;

public検索はexact countとpage番号を返さない。物理shard後も1要求のworkを固定するため、最大32 shardから各`limit`件までを同時6接続で読み、opaque cursorのshard別位置から続きをmergeする。keywordなしは`updatedAt DESC, noteId`、keywordありはshard内FTS順位のReciprocal Rank Fusionに`updatedAt, noteId`をtie-breakとして使う。cursorはquery fingerprintとshard generationを含み、条件変更・改ざん・retired generationは`INVALID_PAGINATION`にする。

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

`LocalNoteQueryService` は owner の scope DO、`PublicNoteQueryService` は global D1 の public projection だけを読む。個人向け `search` は作成日時、公開 `searchPublic` は結果に表示する更新日時を期間軸にする。公開 projection の索引は `public_note_search_updated_idx` / `public_note_search_owner_updated_idx`。境界は `from` 以上 `toExclusive` 未満で、private は利用者の time zone、public は UTC で解決する。

`highlightedExcerpt` は**生テキスト由来**である。`search` / `searchPublic` の一致判定は bigram 前処理済みの FTS 列で行うが、その列は「東京 京都 都庁」のようなビグラム列なので表示に使えない（[ADR 011](../adr/011-bigram-search.md)）。ハイライトは読み取りモデルの生テキスト（`note_search.excerpt`、なければ `text`）に対し、検索語と同じ NFKC 正規化 + 小文字化を適用した照合で一致位置を求めて組み立てる（[database/index.md](../database/index.md) の「ハイライトと抜粋の生成」）。`keyword` 未指定のときと、生テキストに一致が現れないとき（タイトル・タグ名だけで一致した行など）は `null` を返し、画面は素の `excerpt` を出す。

**`excerpt` と `highlightedExcerpt` の描画契約は正反対である**。同じ DTO に平文と HTML 断片が並ぶため、契約を型の隣に明記する。

- `excerpt` / `title` / `tagNames` は**平文**。表示側がテキストとして描く（React なら素の文字列として渡す）
- `highlightedExcerpt` は**HTML 断片**。生成側が生テキストを HTML エスケープしてから一致区間を `<mark>` … `</mark>` で囲むため、含まれるタグは `<mark>` だけであることが保証される。表示側はこの値だけを `dangerouslySetInnerHTML` で描いてよい
- エスケープの責任を生成側（クエリポートの実装＝アダプター）に置くのは、標識を入れる側でなければ「どこがエスケープすべき本文で、どこが自分が入れたタグか」を区別できないためである（[database/index.md](../database/index.md) の「ハイライトと抜粋の生成」）。表示側で後からエスケープすると `<mark>` ごと無害化され、生成側でエスケープしないと本文中の `<script>` がそのまま描かれる
- `null` のときに素の `excerpt` へフォールバックする経路は、**平文としての描画に切り替える**。HTML として描く枝と平文として描く枝を取り違えない

`listPublicAuthors` は**所有者基準**で列挙する — `owner_type = 'user'` の公開かつ有効なノートを 1 件以上持つ利用者について、その利用者の当該ノートの最新更新時刻を添えて `userId` の昇順で返す。著者基準（`created_by`）ではない。母集合は `/@:handle` の一覧（`searchPublic` の `ownerFilter: { type: "user", userId }`）と一致しなければならないためで、ハンドルは読み取りモデルが所有者の列として持たないので呼び出し側が `UserBatchReader.resolveMany` で解決する（[usecases/identity.md](../usecases/identity.md) の `listPublicProfiles`）。sitemap/authorsのcursorも署名opaque値で、shard generationと各shardのkeyset位置を持つ。最大32 shardを同時6接続のwaveで読み、全体limit件へmergeする。authorsは各shard headの同じUserIdをすべて消費してupdatedAtの最大を1件だけemitしてから次のUserIdへ進むため、同一利用者のNoteが複数shardに散ってもpage境界で再出現しない。cutover中は旧新generationを読み、NoteIdまたはUserIdで重複排除する。

**エラーケース**: `SystemError(DatabaseError)`、`SystemError(TimeoutError)`（検索のタイムアウト）

### LocalNoteProjectionWriter / PublicNoteProjectionWriter

**目的**: 読み取りモデルを更新する。イベント購読側（プロジェクション）から呼ばれる。本体・タグ・FTS・著者・workspace表示をノート単位の完全snapshotとして置換する（[ADR 011](../adr/011-bigram-search.md) / [ADR 017](../adr/017-content-size-budget.md)、詳細は database 設計）。著者やworkspaceの一括行更新は提供しない。

bigram 前処理済みのテキストは**どこにも保存されない**（FTS5 は contentless 構成。[ADR 017](../adr/017-content-size-budget.md)）。索引を書き換えるときの旧値は、`note_search` の生テキスト列に前処理関数を再適用して求める。前処理は純関数なので同じ値が必ず得られる。

local writer は対象 scope の scheduled task / Alarm から呼ばれる。orderingはNote entity versionだけでなく、Note本体/tag集合の `projectionRevision`、Identityの `authorVersion`、Workspaceの `workspaceVersion` を持つ世代ベクトルで判定する。

```ts
interface LocalNoteProjectionWriter {
  replaceSnapshotIfNewer(entry: NoteProjectionEntry, tags: readonly ProjectedTagName[], version: ProjectionVersion): Promise<"written" | "stale" | "incomparable">;
  remove(noteId: NoteId): Promise<void>;
}

interface PublicNoteProjectionWriter {
  replaceSnapshotIfNewer(entry: NoteProjectionEntry, tags: readonly ProjectedTagName[], version: ProjectionVersion & { routeVersion: number }): Promise<"written" | "stale" | "incomparable">;
  removeIfNewer(noteId: NoteId, routeVersion: number, projectionRevision: number): Promise<boolean>;
  removeForPurge(input: { noteId: NoteId; operationId: string; routeVersion: number; projectionRevision: number }): Promise<void>;
}

interface NoteProjectionSnapshotReader {
  read(noteId: NoteId): Promise<{ entry: NoteProjectionEntry; tags: readonly ProjectedTagName[]; projectionRevision: number } | null>;
}

interface NoteProjectionRevisionStore {
  bump(noteId: NoteId): Promise<number>;
}

type ProjectionVersion = Readonly<{
  projectionRevision: number;
  authorVersion: number;
  workspaceVersion: number; // personal noteは0
}>;

type ProjectedTagName = Readonly<{ name: string; normalized: string }>;   // TagName の表示名と正規化名

type NoteProjectionEntry = Readonly<{
  noteId: NoteId;
  owner: NoteOwner;
  createdBy: UserId;
  author: Readonly<{ displayName: string; handle: string | null; version: number }>;
  workspace: Readonly<{ name: string; slug: string | null; published: boolean; version: number }> | null;   // owner.type === "workspace" のとき必須、user のとき null
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

`NoteProjectionSnapshotReader.read`はcurrent scopeのNote・tag集合・projection revisionを1つのSQLite read transactionで返す。呼び出し側はglobal Identityのcurrent versionと、workspace noteなら同じscopeのWorkspace versionを解決して完全snapshotを作る。Note本体の投影対象変更、TagAssignmentの作成/削除/rename fan-out起点は、正データ変更と同じlocal transactionで`bump`し、そのrevisionをoutbox eventに載せる。

同じroute/scope世代の中では、writerは入力ベクトルの全成分が保存値以上で、少なくとも1成分が大きいときだけ置換する。全成分が保存値以下なら`stale`、大小が混在するなら`incomparable`を返す。public writerはまずrouteVersionを比較し、大きければowner contextが切り替わった新世代としてprojection/author/workspaceの保存値をリセットして入力snapshotを受理し、同値のときだけ残り3成分を比較し、小さければstaleにする。これによりworkspace→personalでworkspaceVersionが0へ下がる場合や、versionの小さい別workspaceへ移る場合も永久にincomparableにならない。local targetはstage時にsourceの`note_search`行をコピーせず、activate transactionで既存staged行を消して新規rowとして投影する。source rowはretire時にremoveするため、local比較も同じscope世代内だけである。

`incomparable`は同一route内の「新しいNoteと古い著者」などのread-write競合なので、consumerは全sourceを読み直して1回再試行し、なお競合すればQueue/Alarm再試行へ委ねる。これによりprofile更新後の遅延Note snapshotや退会後の旧PIIが表示列を巻き戻さない。

`author` は `createdBy` の利用者、`workspace` は所有ワークスペースの表示情報で、投影のたびにversion付きcurrent stateを解決する。退会した作成者はIdentity tombstoneのversionと `{ displayName: "退会した利用者", handle: null }` を使う。対象行はページングした個別再投影で更新し、無制限の `updateAuthor` / `updateWorkspace` は行わない（[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）。

`contentStatus` / `styleMode` は `upsert` でしか更新されない。したがって本文状態とスタイルを変える振る舞いはすべてイベントを発行しなければならない — `applyConversionResult` / `updateBody`（`note.contentUpdated`）、`markConversionFailed`（`note.conversionFailed`）、`markAwaitingIntegration`（`note.awaitingIntegration`）、`changeStyleMode`（`note.styleModeChanged`）。1 つでも欠けると読み取りモデルが恒久的に古くなり、`countByContentStatus` を根拠とする案内（`completeIntegrationOAuth` の「要 LLM 連携の N 件」）と一覧の表示が実体とずれる。

**タグ列の分掌**

タグは読み取りモデルの 3 か所 — 関連度用の `note_search.tag_names`、一覧の表示名用の `note_search.tag_display_names`、絞り込み用の `note_search_tags` — と、FTS 索引の `tag_names_fts` 列に投影される（[database/index.md](../database/index.md) の「タグ列の同期契約」）。書き分けは次のとおり。

- `replaceSnapshotIfNewer` はノート本体とタグ集合を丸ごと入れ替え、3 か所と FTS 索引を同一transaction/batchで更新する。関連度用の列と `note_search_tags.normalized` には `normalized` を、一覧に載る表示名の `tag_display_names` には `name` を用いる
- `remove` は `note_search` の行・FTS 索引の行・`note_search_tags` の当該ノートの行をすべて消す

**エラーケース**: `SystemError(DatabaseError)`

### NoteRouteStore / NoteMovePort（application ports）

```ts
interface NoteRouteStore {
  resolve(noteId: NoteId): Promise<NoteRoute | null>;
  resolveMany(noteIds: readonly NoteId[]): Promise<ReadonlyMap<NoteId, NoteRoute>>;
  reserveCreate(input: { noteId: NoteId; scope: ScopeKey; createdBy: UserId; operationId: string; expiresAt: Date }): Promise<NoteRoute>;
  activateCreate(input: { noteId: NoteId; operationId: string }): Promise<NoteRoute>;
  abandonCreate(input: { noteId: NoteId; operationId: string }): Promise<void>;
  beginMove(input: { noteId: NoteId; expectedRouteVersion: number; target: ScopeKey; migrationId: string }): Promise<NoteRoute>;
  abortMove(input: { noteId: NoteId; migrationId: string; expectedRouteVersion: number }): Promise<NoteRoute>;
  switchMove(input: { noteId: NoteId; migrationId: string; expectedRouteVersion: number }): Promise<NoteRoute>;
  beginPurge(input: { noteId: NoteId; scope: ScopeKey; expectedRouteVersion: number; operationId: string }): Promise<NoteRoute>;
  abortPurge(input: { noteId: NoteId; operationId: string; expectedRouteVersion: number }): Promise<NoteRoute>;
  finishPurge(input: { noteId: NoteId; operationId: string; expiresAt: Date }): Promise<NoteRoute>;
}

interface NoteRouteFanOutReader {
  listByCreatedBy(userId: UserId, cursor: string | null, limit: number): Promise<ShardPage<NoteRoute>>;
  listByScope(scope: ScopeKey, cursor: string | null, limit: number): Promise<ShardPage<NoteRoute>>;
}

interface ShareTokenProtector {
  protect(token: string): Promise<ProtectedShareToken>;
  reveal(token: ProtectedShareToken): Promise<string>;
}

type NoteRoute = Readonly<{
  noteId: NoteId;
  scope: ScopeKey;
  createdBy: UserId;
  routeVersion: number;
  state: "reserved" | "active" | "moving" | "purging" | "tombstone";
  target: ScopeKey | null;
  migrationId: string | null;
}>;

interface NoteMovePort {
  freezeSource(input: { migrationId: string; noteId: NoteId; source: ScopeKey; target: ScopeKey; actorUserId: UserId; sourceMembershipVersion: number | null; excludingJobId: JobId | null }): Promise<NoteMoveSnapshot>;
  stageTarget(input: { migrationId: string; target: ScopeKey; actorUserId: UserId; targetMembershipVersion: number | null; nextRouteVersion: number; snapshot: NoteMoveSnapshot }): Promise<void>;
  activateTarget(input: { migrationId: string; target: ScopeKey; routeVersion: number }): Promise<void>;
  retireSource(input: { migrationId: string; source: ScopeKey; routeVersion: number }): Promise<void>;
  abortBeforeSwitch(input: { migrationId: string; source: ScopeKey; target: ScopeKey }): Promise<void>;
}
```

`reserved` route は作成途中、`purging` は完全削除中なので外部readに解決しない。完全削除は`beginPurge`で到達を閉じる。local再認可・expected Note version/lifecycleが競合した場合、削除前なら同じoperation IDの`abortPurge`だけが`purging → active`へ戻せる。local削除後はabortせずpublic removeと`tombstone`へforward recoveryする。物理分割後もroute・notePurge operation・public 3表を同じNoteId shardへ置き、`removeForPurge`の削除+ack transactionを維持する。

`resolveMany`は最大500 NoteIdをNoteId hashでshard別にgroupingし、最大32 shardを同時6接続のwaveでbatch queryする。cutover中は旧新generationを読み、routeVersionが大きい行をNoteIdごとに1件へ重複排除する。bulk系は入力source scopeと一致するactive routeだけを選び、別scope / moving / purgingは`notFound`へ積んで、その1つのscope DOだけを呼ぶ。

`NoteRouteFanOutReader`はNoteId hash配置に対する二次キー走査の唯一のportである。`limit`は全shard合計で最大200。最大32 shardを同時6接続で読み、NoteId昇順へmergeする。署名opaque cursorはquery kind/fingerprint、shard generation、旧新各shardの`afterNoteId`を持つ。reshard中は旧新を読み、NoteIdで重複排除して大きいrouteVersionを採用する。空shardを含め全shardの位置を進めるため、createdBy/scope fan-out、account deletionの固定、workspace表示refreshはいずれも漏れなく有界に再開できる。

moveはroute switch前だけabortでき、switch後は必ずforward recoveryする。`abortBeforeSwitch`はtarget creditの逆仕訳、staged Note/metadataの破棄、move authorization lock解放、source thawをmigration IDで冪等に行う。完了後に`abortMove`が同じmigration IDの`moving → active(source)`をCASする。routeが既にtargetならabortを拒否する。

`ShareTokenProtector` は版付き鍵で共有トークンを暗号化する application port である。新規暗号化には現行版、復号には `keyVersion` が指す旧版を含む鍵束を使う。鍵はデータベースへ置かず、供給とローテーションはアダプターの責務とする。復号は所有者に共有 URL を返す経路だけで使い、共有リンクからの読み取りでは使わない。

`NoteMoveSnapshot` は Note / Revision、tag の表示名・正規化名、source / media / reference の StoredFile metadata、BackupRecord、Usage deltaを含む。R2 bytes は移動しない。同じ migration ID の再適用は保存済み result を返す。source / target command は actor と期待Membership versionをlocal transactionで再検査し、target prepareはmove authorization lockを保持する。対象Membershipの除名・降格はlockと競合し、activate / abortで解放する。

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `note.created` | `{ noteId, owner, createdBy, sourceFileId, projectionRevision }` | 読み取りモデルの投影、Usage の集計。以下の投影対象eventも同じrevisionを持つ |
| `note.contentUpdated` | `{ noteId }` | 読み取りモデルの投影 |
| `note.conversionFailed` | `{ noteId, reason }` | 読み取りモデルの投影 |
| `note.awaitingIntegration` | `{ noteId }` | 読み取りモデルの投影（`content_status` の反映。`countByContentStatus` による「要 LLM 連携の N 件」の案内が依存する） |
| `note.renamed` | `{ noteId, title }` | 読み取りモデルの投影 |
| `note.styleModeChanged` | `{ noteId, styleMode }` | 読み取りモデルの投影（`style_mode` の反映） |
| `note.visibilityChanged` | `{ noteId, previous, current }` | 読み取りモデル、サイトマップ |
| `note.published` | `{ noteId }` | 監査（サイトマップは読み取りモデルから引くため専用の購読者はない） |
| `note.shareLinkReissued` | `{ noteId }` | 監査 |
| `note.sharePasswordChanged` | `{ noteId }` | 監査 |
| `note.moved` | `{ noteId, previousOwner, currentOwner, routeVersion }` | target scope local projectionとglobal public projectionの更新。Tag / Storage metadata / Backup / Usageはmove snapshotで既に移送済みのため別consumerで付け替えない |
| `note.trashed` | `{ noteId, owner }` | 読み取りモデル、サイトマップからの除去 |
| `note.restored` | `{ noteId, owner }` | 読み取りモデル、サイトマップ |
| `note.purged` | `{ noteId, owner, sourceFileId, operationId, deletionOperationId: string | null, routeVersion, projectionRevision }` | local後始末とpublic remove ack。scope cleanup由来ならadmission tokenも運ぶ |

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
