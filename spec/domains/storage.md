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
- **バリデーション**: `value` は 64 文字の 16 進数。違反時 `BusinessRuleError(InvalidChecksum)`

### FilePurpose

- **フィールド**: `value: "source" | "media" | "reference" | "artifact" | "avatar"`

| 値 | 意味 | 回収 |
| --- | --- | --- |
| `source` | アップロードされた元ファイル | ノートの完全削除時 |
| `media` | 編集中に挿入した画像・動画 | 作成から 30 日が経過し、かつ現在の本文からも保持中の版の本文からも参照されていないとき |
| `reference` | 本文から取り込んだ外部リソース | ノートの完全削除時 |
| `artifact` | 生成物（PDF / ZIP） | `expiresAt` の経過時 |
| `avatar` | 利用者・ワークスペースのアイコン | 差し替え時 |

`source` / `reference` の「ノートの完全削除時」の回収と、`media` の孤児判定は、`StoredFile` の `noteId` で所属ノートを解決して行う（`note.purged` の購読と孤児メディアの走査）。`media` の回収の起点を「参照が外れた時刻」ではなく作成時刻に取るのは、本文から参照が外れた時刻を保持しないため。走査時点で本文に現れないことを確認してから消す（[usecases/storage.md](../usecases/storage.md) の `collectOrphanMedia`）。

**参照元には保持中の版（[note.md](./note.md) の `NoteRevision`、直近 20 版）の本文も数える**。版は `restoreNoteRevision` がそのまま書き戻せる生きた参照であり、回収の起点が作成時刻である以上、「挿入 → 翌日に本文から外す → 29 日後に回収」の順で復元可能な版が指すメディアが消える。20 版は数か月をまたぐので稀なケースではなく、復元しても画像が 404 になる状態は AC-8 の「直近 20 版から復元できる」を満たさない。

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

application層は `registerEphemeral` の保存と同じscope-local UoWで最小`expiresAt`のartifact cleanup taskをupsertする。scopeに`purpose: "media"`が初めて現れるときも日次orphan-media taskを自己登録する。**登録の起点は「初めての保管」ではなく「初めての流入」である** — `storeMedia`のほか、ノート移動の`relocateFilesForNote`（`stageTarget`）でもmediaがtarget scopeへ入るため、両方が同じ登録を行う（片方を欠くと、そのscopeの孤児mediaは二度と回収されない）。これらはStoredFile集約の状態遷移ではなくscope Alarmの起動責務なので、ドメインメソッドのeventへ暗黙に含めない。

## ドメインサービス

### UploadValidationPolicy

**責務**: 受け入れてよいアップロードかを、保管前に判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `limitFor` | `purpose: FilePurpose, mimeType: MimeType` | `ByteSize` | 下表の上限を引く |
| `ensureAcceptable` | `params: { purpose: FilePurpose; body: Uint8Array }` | `AcceptedUpload = { mimeType: MimeType; size: ByteSize }` | MIME は申告値ではなく**バイト列そのもの**から決め、サイズは実バイト長で測る。どの許可形式にも一致しなければ `BusinessRuleError(UnsupportedMimeType)`、`size.exceeds(limitFor(purpose, mimeType))` なら `BusinessRuleError(FileTooLarge)`。判定結果を返すので、呼び出し側は申告値を保管できない（[ADR 050](../adr/050-upload-acceptance-from-bytes.md)） |

| 用途 | 許可する MIME | 上限 |
| --- | --- | --- |
| `source` | 取り込み対応形式（`text/html`, `text/markdown`, `text/plain`, Office 3 種, `application/pdf`, `image/*`, `audio/*`） | 音声 200 MB、その他 50 MB |
| `media` | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `video/mp4`, `video/webm` | ラスタ画像 20 MB、`image/svg+xml` 128 KB、動画 200 MB |
| `reference` | 任意（取得できたもの） | 1 件 20 MB |
| `artifact` | `application/pdf`, `application/zip`, `text/html`, `text/markdown` | 1 GB |
| `avatar` | `image/png`, `image/jpeg`, `image/webp` | 5 MB |

**`image/svg+xml` だけがラスタ画像と別の上限を持つ。** SVG は保管前に書き換えられる唯一のメディアで、`storeMedia` が `HtmlProcessor.process` に通す（[usecases/storage.md](../usecases/storage.md) の手順 3）。`process` の戻り値は**本文の断片**であり、[domains/note.md](./note.md) の `NoteHtml` が持つ 800,000 バイトの上限に縛られる。したがってサニタイズ後にその上限を割れない値をここに置くと、Storage が受理すると言った形式が Note の不変条件で失敗する — 到達できない上限になる。

**128 KB は方針値であり、導出された値ではない。** エディタが挿せる図版の大きさの上限として、実際に届く図版より 1 桁大きく、この大きさの本文ならサニタイズが安く済む点に置いてある。**この値から何かを導いてはならない** — とくに「`process` は解析後の木を入力長の 4 倍で打ち切るので 131,072 バイトの入力は 524,288 バイトを超えられず、本文の 800,000 バイトの内側に収まる」という導出は**偽である**。木の上限が課金するのは節点の**エスケープ前**の長さを UTF-16 code unit で数えた量であり、直列化は属性値の `"` を `&quot;` に展開する（実測: 単一引用符の属性値に生の `"` を詰めた 131,072 バイトの SVG は 786,073 バイトに直列化する）。`NoteHtml` の 800,000 は UTF-8 バイトで測る別の量でもある（[ADR 013](../adr/013-html-sanitization-policy.md) の上限の表）。

この導出が担っていた約束 — **アップロードが Note の語彙で失敗しない** — は、導出ではなく `storeMedia` の境界翻訳が担保する。`HtmlProcessor.process` が Note の語彙で投げうるコードは資源の上限（`NOTE_HTML_TOO_COMPLEX`）と本文の長さの上限（`NOTE_CONTENT_TOO_LARGE`）の 2 つで、`storeMedia` はその集合を**すべて** Storage の語彙（`FileTooLarge`）へ翻訳する（[usecases/storage.md](../usecases/storage.md) の手順 3）。したがって 128 KB を動かしても、本文の上限を動かしても、許可リストに要素を足しても、この約束は静かに壊れない。サニタイズの**費用**のほうは、この定数の値によらず `HtmlProcessor` 自身の資源の上限が有界にする。さらに `storeMedia` は**サニタイズ後に実際に保管するバイト列**を 128 KB へ測り直す（保管するバイト列こそが容量に効き、行に載る値だから）。

**この見積もりを入力の形から論証してはならない。** 出力を桁で膨らませるのは foster parenting である — open elements のスタックから外れた整形要素が active formatting elements のリストには残り、後続の行ごとに作り直されるため、整形要素 `k` 個と行 `m` 個が `k × m` 個に化ける。**完全に整形式で、すべてのタグが閉じ、入れ子も 64 段以内の入力がこれに届く**（実測: `<svg><table><b a="0">…<b a="61">` の下に `<tr>X</tr>` を 13,018 回並べた 131,064 バイトが 11,300,523 バイト = 86 倍、886 ms）。しかも入口を要素名で数え上げる論証も成立しない（`<desc><template><tr>` は `table` の開始タグを介さずに table 系の挿入モードへ入る）。この種の論証はどれも成立せず、[ADR 013](../adr/013-html-sanitization-policy.md) は入力の形から論証する路線を採らずに資源で有界にする形を採っている。

そのうえで**受理判定は breakout tag の要素名を拒む**（HTML 仕様「foreign content 内のトークンの解析規則」が列挙する 44 の要素名 — `b` / `table` / `p` / `br` / `img` ほか — と、`color` / `face` / `size` のいずれかを持つ `font`。HTML のトークナイザーは名前を小文字化するので、XML が別物として扱う `<TABLE>` も同じ扱いにする）。これは**上限の根拠ではなく前段の安価な防御**である — もっとも安く膨張を作れる形を 1 パスの走査で断り、サニタイザーを 1 度も走らせない。完全ではない（この走査はコメントと処理命令を XML の終端で読み、HTML のトークナイザーは `<?a>` を最初の `>` で、`<!-->` を即座に終えるので、片方にだけ見える位置に breakout tag を置ける）。塞ぐのではなく、その先を資源の上限が受け止める。サニタイザーの SVG 部分集合にこれらの名前は 1 つも無いので、拒んで失う描画は無い。

加えて入れ子の深さを 64 で切る — サニタイザーが木を素の再帰で歩くため、深さがそのままスタックの深さになる。実在の図版は数段しか入れ子にならないので、両側に 1 桁の余裕がある（`HtmlProcessor` 側の走査の深さの上限は 256 段で、こちらが先に効く）。

`ensureAcceptable` が判定できるのは、`media` と `avatar` が許可する 7 形式である。判定は次の順に行い、**先頭バイトを比べるものを先に、本文を復号するものを最後に**置く。

| 形式 | 判定 |
| --- | --- |
| `image/png` | 先頭 8 バイトの署名 |
| `image/jpeg` | 先頭 3 バイトの署名 |
| `image/gif` | 先頭 6 バイトの署名（`GIF87a` / `GIF89a`） |
| `image/webp` | 先頭の `RIFF` と オフセット 8 の `WEBP`（コンテナの形まで見る） |
| `video/mp4` | オフセット 4 の `ftyp` と、オフセット 8 のブランドが許可集合にあること。**`ftyp` だけでは足りない** — HEIC / 3GP / QuickTime も同じボックスを自分のブランドで持ち、受け入れると `video/mp4` として配信できないファイルを保管することになる |
| `video/webm` | 先頭 4 バイトの EBML 署名と、先頭 64 バイト内の DocType `webm`。EBML 署名は Matroska と共有するのでこの走査が要る |
| `image/svg+xml` | **署名を持たない**。先頭 4096 バイトを復号し、BOM とプロローグ（`<!--…-->` / `<?…?>` / `<!…>`）を読み飛ばして根要素が `<svg` であることを確かめる。閉じないプロローグ、および内部サブセットを持つ doctype は、推測せずに拒否する。**そのうえで本文全体を「単体の 1 文書として開けるか」で判定する**（下記）。ただし**その purpose が SVG に与える上限**を超える長さのバイト列にはこの検査を行わない — どのみち次の段で `FileTooLarge` になり、サニタイザーへは渡らないので、縛る対象が無い。打ち切りの物差しは上限表から引く（`media` の 128 KB を直接名指さない）ので、SVG を許す purpose が別の上限で増えても、2 つの上限のあいだのバイト列が検査を免れることはない |

`image/svg+xml` の「単体の 1 文書として開けるか」は、次を**すべて**満たすことをいう。`.svg` は XML として解析され、そこでは整形式でないことが**致命的エラー**（1 ドットも描かれない）なので、満たさないものはブラウザも開けない — 受理を断っても失うものは無い。同じ述語を `storeMedia` が**保管の直前にもう一度**、サニタイズ後の実体に対して適用する（[usecases/storage.md](../usecases/storage.md) の手順 3）。

- 根要素が `svg` ひとつで、それが閉じ、その外には XML の `S`（空白・タブ・CR・LF）とプロローグ（コメント・処理命令・内部サブセットの無い doctype）しか無い
- 開始タグと終了タグが名前まで一致して入れ子が閉じる
- 要素名・属性名が XML の `Name` であり、属性値が引用され、その中に `<` が無い
- 実体参照が XML の定義済み 5 つ（`lt` / `gt` / `amp` / `apos` / `quot`）か数値参照であり、数値が XML の `Char` である（DTD を持たない `.svg` に `&nbsp;` は定義されていない）
- 文字が XML の `Char` である（タブ・CR・LF 以外の C0 制御文字は含まない）
- 入れ子の深さが 64 以内である
- **breakout tag の要素名を含まない**（XML の整形式性とは無関係な、前段の安価な防御。上限を与えるのはこの条件ではなく `HtmlProcessor` の資源の上限である。上の 128 KB の議論を参照）

`source` / `reference` / `artifact` にはまだ規則が無い。**これらの purpose を許可するスライスが、その入口の形を決める**（[ADR 050](../adr/050-upload-acceptance-from-bytes.md) が「そのスライスが判断を行う」と定めている）。規則を持たない purpose は署名判定にすら入らず、`UnsupportedMimeType` になる。

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
| `create` | `params: { appUrl: string; deliveryBaseUrl: string }` | `StorageUrlPolicy` | 2 つの構成値を焼き込んだ判定器を作る。値の組が不正なら投げる（業務規則違反ではなく配備の設定誤りなので `BusinessRuleError` にしない） |
| `isInternal` | `url: string` | `boolean` | `appUrl` を基準に解決した URL が `deliveryBaseUrl` で始まるなら真。**本文相対の URL も対象**（アプリ相対の配信パスを持つ配備ではこれが本題）。解決できない URL は投げずに偽 |

`ExternalFetchPolicy.ensureFetchable` の複合条件から**この 1 つだけを切り出した**ものである。切り出す理由は 2 つある。

- `ensureFetchable` は `DnsResolver` に依存し、ホスト名を解決して private / loopback / メタデータ用アドレスを弾く。読み取り経路（ノート詳細で「未解決の参照はどれか」を求める）で呼ぶには重すぎるうえ、I/O を伴う
- 同じ判定を `importExternalReferences` の `skipped` の判定、参照取り込みジョブの登録条件（[usecases/note.md](../usecases/note.md) の `updateNoteBody`、[usecases/conversion.md](../usecases/conversion.md) の `runConversion` / `runRegeneration`）、`collectOrphanMedia` の参照判定、そしてノート詳細の合成が使う。1 か所に置かないと規則が分岐する

`appUrl` は `AppConfig`（[presentation/index.md](../presentation/index.md)）から供給する。**`deliveryBaseUrl` は構成に持たず、`ObjectStorage.publicUrl` の答えから読み戻す** — 配信 URL の形はアダプターに閉じる（[ADR 049](../adr/049-object-storage-public-url.md)）ので、アプリ相対の配信パスも公開ドメインの URL も「共通の前置き」に畳める。`ensureFetchable` は引き続きこの判定を内部で使い、内部を指す URL を `RefusedUrl` として弾く。

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
  listByPurposeOlderThan(purpose: FilePurpose, createdBefore: Date, limit: number, after: StoredFilePurposeCursor | null): Promise<readonly StoredFile[]>;
  sumSizeByOwner(owner: StorageOwner): Promise<number>;
  listByOwner(owner: StorageOwner, purpose: FilePurpose | null, pagination: Pagination): Promise<PaginationResult<StoredFile>>;
}
```

チェックサムによる重複保管の回避は行わない。`StoredFile` は `FileProvenance` で所属ノートと由来を持つため、同一内容でもノートごとに別の行が要る（1 行を複数ノートで共有すると `note.purged` 後の回収と所有者の付け替えが成立しない）。実体の共有はメタデータと blob を分ける設計を要し、本設計の範囲外とする。所有者単位の一括削除（`deleteFilesByOwner`）も、1 件ごとに `storage.fileDeleted` を発行して Usage の減算と実体の回収につなげる必要があるため、`listByOwner` + `deleteFiles` の反復で行い一括削除のメソッドは持たない。

`listByNote` はcurrent scopeで `noteId` が一致する全ファイルを引く。moveでは `source` / `media` / `reference` metadataをsnapshotへ含め、target scopeへ同じR2 keyで復元する。artifactはJob scopeに残し `expiresAt` で回収する。`listByPurposeOlderThan` の所有者に依らない走査もcurrent scope内に限り、全DO走査ではない。`sumSizeByOwner` はartifactを除外する。

`listDeletableByNote` は `purpose` が `source` / `media` / `reference` の行を **`id` 昇順**で最大 `limit` 件引く（`limit <= 0` は 0 件）。順序はバックエンドの裁量ではなく契約である — `deleteFilesForNote` が 100 件ずつ削っては継続する形なので、途中の turn で残っている集合がバックエンド間で一致しないと観測が揃わない。読んだ行はその turn が消すため、全順序でありさえすれば前進は保証される。

`listByPurposeOlderThan` は**キーセットで前進する走査**である。順序は `createdAt` 昇順・同時刻は `id` 昇順の全順序で、`after` はその順序上の位置を**排他的に**指す（`null` は先頭から）。境界は `createdBefore` 側が包含（ちょうど `createdBefore` の行はページに入る）。

```ts
type StoredFilePurposeCursor = { createdAt: Date; id: StoredFileId };
```

カーソルは**行ではなく位置**である。カーソルを採った行がその後削除されていても位置は解決できる（掃引は読んだページの一部を消すのが常態なので、これは例外ではなく既定の状況にあたる）。offset ではなくキーセットにするのはそのためで、前方の行が消えても後方の行が走査から漏れない。

カーソルが契約に要るのは `collectOrphanMedia` のためである。この掃引は**残すと決めた行をそのまま残す**ので、毎 turn 先頭から読む形だと、scope の最古の `limit` 件がすべて本文から参照されている（稼働中の scope ではごく普通の状態）とき、その後ろにある孤児へ永久に到達できない。満ページを受け取った呼び出し側は、そのページ末尾の `(createdAt, id)` を次の turn の `after` に渡す。

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
  put(key: ObjectKey, body: Uint8Array, meta: ObjectMeta): Promise<PutResult>;
  get(key: ObjectKey): Promise<ObjectBody | null>;
  deleteMany(keys: readonly ObjectKey[]): Promise<void>;
  publicUrl(key: ObjectKey): string;
  createDownloadUrl(key: ObjectKey, params: { fileName: FileName; expiresInMs: number }): Promise<string>;
}

type ObjectMeta = Readonly<{ mimeType: MimeType; size: ByteSize; checksum: Checksum | null }>;
type ObjectBody = Readonly<{ bytes: Uint8Array; meta: ObjectMeta }>;
type PutResult = Readonly<{ size: ByteSize; checksum: Checksum }>;
```

`publicUrl` は公開配信するオブジェクトの読み取り先を組み立てる。**公開 URL の組み立てをポートに持たせ、配備ごとの形をアダプターに閉じる** — アプリ相対の配信パスを返す配備も、公開ドメインを持つストレージの URL を返す配備も、呼び出し側は戻り値をそのまま返すだけになる。**期限つき URL と公開 URL は別のメソッドとして型で分ける**（[ADR 049](../adr/049-object-storage-public-url.md)）。`createDownloadUrl` は短命なダウンロード用なので、プロフィールに埋め込むような長命な参照には流用できない。使ってよいのは公開してよい用途に限る — **`avatar` と `media` の 2 つ**である。

`media` を公開側に置くのは、本文に挿した画像・動画の URL が本文にそのまま載り、**公開ノートを匿名の閲覧者が読むときにも解決できなければならない**ため。読める条件は「鍵を知っていること」で、鍵は推測できないファイル ID を含み、鍵を列挙する経路も持たない（`avatar` と同じ扱い）。`source` / `reference` / `artifact` は同じストアを共有するので、**配信側がこの境界を自分で保つ**（`ObjectStorage.publicUrl` の JSDoc と `apps/web/app/routes/storage.$.tsx` の許可集合が同じ決定の適用点で、3 か所を同時に動かす）。配信するときは `X-Content-Type-Options: nosniff` と `Content-Security-Policy: sandbox; default-src 'none'` を付ける — SVG は保管時にサニタイズ済みだが、鍵空間に何が積まれても実行させないのは配信側の担保である。

`collectOrphanMedia` が本文と突き合わせる住所も `publicUrl` の戻り値なので、配信経路と回収規則は同じ 1 つの住所を見る。片方だけを動かすと、挿した直後のメディアが孤児として回収されるか、配信できない URL を本文に配ることになる。

**非公開化もゴミ箱への移動もメディア URL を失効させない**。配信口はセッションも `StoredFile` の行も見ず鍵だけで通し、行と実体はノートの完全削除（`purgeNote` → `deleteFilesForNote` → `storage.fileDeleted`、ゴミ箱の既定保持期間は 30 日）まで残るため、本文を見たことがある閲覧者はその間メディアを読み続けられる。失効の時点は公開範囲の変更ではない — capability URL を選んだことの帰結であり、ノート URL 自体は非公開化と同時に閉じる（AC-9）。

**失効させるのは行の削除ではなく実体の削除である**。配信口が引くのはオブジェクトストレージだけなので、鍵が読めなくなるのは `storage.fileDeleted` の購読者（`deleteStoredObjects`。[usecases/storage.md](../usecases/storage.md)）が実体を消したときで、`StoredFile` の行が消えた時点ではない。`deleteStoredObjects` は恒久的に失敗した鍵を孤児オブジェクトとして残すことを認めているため、**公開配信する purpose（`avatar` / `media`）では、行が消えたあとも鍵を知っている閲覧者に配られ続ける実体がありうる**。これは capability URL の窓が purge のあとへ伸びうるということであり、配信口が `Cache-Control: private` を選ぶ根拠にしている削除の約束（[pages/index.md](../pages/index.md) の P-25）が、実体については「消そうと試みる」ところまでしか届かない範囲を示している。孤児オブジェクトを回収できるのはオブジェクトストレージ側の列挙を持つ経路だけで、その列挙は `ObjectStorage` の契約に無い。

`put` が受けるのはバイト列だけで、ストリーム受け（`ReadableStream<Uint8Array>`）は契約に持たない。受理判定を実体から行う形（[ADR 050](../adr/050-upload-acceptance-from-bytes.md)）が「受理判定の時点で実体を握っていること」「ポートがバイト列だけを受ける形であること（ストリームを通す用途が現れた時点で、その要求とともに広げる）」を前提に置いているためで、**契約を弱めた側として責務の移転をここに残す**。**ストリームを入力に持つ要求元は設計上すでに実在する** — [usecases/storage.md](../usecases/storage.md) の `storeUpload` で、入力 DTO の `body: ReadableStream<Uint8Array>` と、**同ユースケース手順 2 の `UploadValidationPolicy.ensureAcceptable` 呼び出し**がそれに当たる（バイト列が手に入るのは手順 5 の `put` 以降なので、実体判定を手順 2 で行う形への手順の組み替えもそのスライスの仕事になる）。**この経路を実装するスライスが、上記の前提に従って `put` の入口を広げ、読み切る前に上限で切る形をそこで設計する。**

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
  | "InvalidId" | "InvalidChecksum" | "InvalidObjectKey" | "InvalidByteSize"
  | "UnsupportedMimeType" | "FileTooLarge"
  | "RefusedUrl" | "FetchBudgetExceeded"
```

## ユースケース（概要）

`startBulkUpload`, `storeUpload`, `storeMedia`, `storeAvatar`, `issueDownloadUrl`, `importExternalReferences`, `deleteFiles`, `deleteStoredObjects`, `collectExpiredArtifacts`, `collectOrphanMedia`, `relocateFilesForNote`, `deleteFilesForNote`, `deleteFilesByOwner`

詳細は [usecases/storage.md](../usecases/storage.md)。
