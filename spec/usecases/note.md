# ユースケース: Note

ドメインの詳細は [domains/note.md](../domains/note.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## 共通: 閲覧者コンテキストの解決

ノートに触れるすべてのユースケースは、先頭で次を行う。

1. `NoteId.create(input.noteId)` を構築する
2. global D1 primary の `NoteRouteStore.resolve` を1点参照し、`active` または `moving` の route が指す scope DO を呼ぶ。`reserved` / `purging` / `tombstone` / 不在なら `NotFoundError("NOTE_NOT_FOUND")`
3. 対象scopeに束縛された `NoteRepository.findById` で引く。不在なら `NotFoundError("NOTE_NOT_FOUND")`
4. ノートの所有者がワークスペースなら同じ workspace scope の `resolveWorkspaceAccess`（Workspace）でロールを引き、`NoteViewer` を組み立てる
5. `NoteAccessPolicy.evaluate(note, viewer, credential, now)` を呼び、必要な権限がなければ `NotFoundError("NOTE_NOT_FOUND")`（存在を漏らさない）

以下の各ユースケースでは、この手順を「閲覧者コンテキストを解決する」と記す。

`moving` は route switch 前の source scope を指すため読み取りに使える。switch 後は同じ route が target scope を指す。scope miss / stale route versionならprimaryから1回だけ引き直す。route/reservationはprimaryまたは直前writeのsession bookmark、public projection/searchだけread replicaを許す。したがって詳細・共有・エクスポートの読み取りは移動の前後で全scope走査せず、常に D1 1点参照 + scope DO 1点参照で完結する。

Note本体の投影対象状態を変える全UoWは、正データ保存と同じtransactionで`NoteProjectionRevisionStore.bump(noteId)`を行い、そのrevisionをeventへ載せる。TagAssignment側も同じ規則に従う。public consumerはevent値そのものではなく、Note・tag集合・revisionのatomic snapshotを読み直す。

## 共通: 共有トークンの発行と解決

共有トークンは `base64url(NoteId).secret` の canonical form とする。`secret` は `SecureTokenGenerator.issue` が生成する 256 ビット以上の乱数である。

- 発行時は NoteId を含む canonical token を組み立て、その全体を `SecureTokenGenerator.hashOf` でハッシュし、`ShareTokenProtector.protect` で暗号化する。`ShareLink` には hash と暗号文を保存し、平文は応答の `shareUrl` にだけ載せる
- 既存リンクを所有者へ再表示するときだけ、権限確認後に `ShareTokenProtector.reveal` を呼ぶ
- 閲覧時は separator が1つであること、locator が canonical base64url で復号できること、`NoteId.create` を通ることを検証する。得た NoteId を `NoteRouteStore` で解決して対象scopeの NoteをIDで引き、入力トークン全体の hash と保存済み `ShareLink.tokenHash` を定数時間比較する
- parse、route、Note、visibility、hash のいずれが不正でも `NotFoundError("NOTE_NOT_FOUND")` に畳む。locator は秘密ではなく、NoteId を知っても secret がなければ共有アクセスは得られない

この形式により共有トークン用の global directory や scope 横断検索は不要になる。ノート移動では NoteId と ShareLink を snapshot に含めるため URL は変わらず、route switch だけで新しいscopeへ到達する。

## 共通: ExportTicket

PDF エクスポートの要求者（匿名の閲覧者を含む）が、進捗照会と結果ダウンロードに到達するための証（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。`exportNote` が発行し、`getExportStatus` / `downloadExportArtifact` が受け取る。

ドメインの値オブジェクトではなく**アプリケーション層の型**として `application/export/` に置く。Note の不変条件に一切関与せず、発行はユースケース、署名と検証は presentation 層の責務であってドメインが関わる余地がない。加えて `JobId` を参照するため、Note ドメインに置くと Note → Job の依存が生まれ、既にある Job → Note と循環する（[domains/index.md](../domains/index.md)、[ADR 008](../adr/008-domain-boundaries.md)）。

```
ExportTicket = {
  target:
    | { kind: "job";  jobId: JobId }           // 生成中: 進捗照会の対象
    | { kind: "file"; fileId: StoredFileId }   // 生成済み: ダウンロードの対象
  noteId: NoteId
  issuedAt: Date
}
```

- **バリデーション**: 判別子と ID の組が揃っていること
- **有効期間**: 発行から 30 分（`issuedAt + 30 分 <= now` で失効）。PDF 生成の実行時間の上限に余裕を足した値であり、これより長く持たせても再到達手段が増えるわけではない。失効しても `exportNote` の再実行で再発行できる（実行中ジョブへの相乗り、または期限内の既存 artifact の再利用で同じ結果に再到達する）
- **保持方法**: SharePass（[domains/note.md](../domains/note.md)）と同じく署名付きの値としてクライアントに持たせる。サーバー側には保存しない。改ざん検知は presentation 層の責務
- チケットはノートアクセスをバイパスする能力証明ではない。進捗照会・ダウンロードのたびに `NoteAccessPolicy.evaluate`（shareToken / SharePass / userId はリクエストから取得）を再実行し、拒否されたら結果に到達できない

## 共通: ユースケースを合成するときの副作用の範囲

ユースケースが別のユースケースを呼んで合成するとき（`runBulkNoteOperationItem` の手順 3、`emptyTrash` の同期削除）、**呼ばれる側の副作用が呼び出し元自身の実行に及んではならない**。対象ノートだけを書き換えるユースケースは無条件にこの規約を満たすが、対象を鍵にして周辺を巻き込む副作用を持つユースケースは、除外対象を引数で受け取る。

ノート側でこれに当たるのは `trashNote` だけである（`JobRepository.listActiveByTarget` で引いたジョブをすべて強制終端するため、同じノートを対象とする実行中のジョブ — つまり自分を呼んでいる一括操作の子ジョブ自身 — を巻き込む）。そこで `trashNote` は入力 DTO に `excludingJobId: string | null` を持ち、次のように渡す。

- ジョブワーカーから呼ぶとき（`runBulkNoteOperationItem`）は**自分の `jobId`** を渡す。渡さないと、子ジョブは手順 1 の `Job.start` で `running` / `target: { type: "note", noteId }` になっているため `trashNote` の手順 2 に自分自身が現れて `Job.cancel` され、手順 4 の `Job.succeed` が `ConflictError`（run 系の共通規則の判定 4 で「終端済み」と読み直される）になる。全件正常にゴミ箱へ移ったのに親が `canceled` として集計される、という結果になる
- 転送境界（画面）から呼ぶときは `null` を渡す。取り消すべきでないジョブは存在しない

`purgeNote` はジョブを終端させない（`note.purged` の購読者にも終端させる受け手はいない）ため、`emptyTrash` の同期削除と `{ kind: "purge" }` の子ジョブはこの規約の対象外である。

## createBlankNote

### 概要

白紙のノートを作る（ED-01）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string` | — | `ownerType === "workspace"` のとき必須（2 つは相関する 1 つの入力なので、転送境界の schema も `ownerType` で判別する直和にする） |
| `title` | `string \| null` | — | `NoteTitle` の規則 |

### 出力DTO

`noteId`, `title`, `ownerType`, `ownerId`, `visibility`, `styleMode`, `createdAt`

### 処理フロー

1. `NoteOwner` を組み立てる。ワークスペースなら `WorkspaceAuthorization.ensureCan(role, "createNote")`
2. `title` が空なら `NoteTitle.auto("無題")`、指定があれば `NoteTitle.manual(title)`
3. Note IDとoperation IDを採番し、global D1の `NoteRouteStore.reserveCreate(noteId, scope, createdBy: userId, operationId)` で `reserved` routeを作る
4. 対象scope DOのlocal transactionで `Note.createBlank` を保存してeventを収集する
5. commit後に `activateCreate` を呼んでrouteを公開する。local commit失敗時はreservationを解放し、activation応答喪失時は同じoperation IDで再試行する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ワークスペースの権限不足 | `BusinessRuleError(InsufficientRole)` |
| ワークスペース不在 | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| タイトルの違反 | `BusinessRuleError(InvalidTitle)` |

## getNote

### 概要

ノート詳細を表示するために、ノート本体と権限を引く（OR-11）。

### 入力DTO

`noteId: string`, `userId: string | null`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `noteId` | `string` |
| `title` | `string` |
| `version` | `number` |
| `content` | `{ status: "processing" \| "awaitingIntegration" \| "failed" \| "ready"; html: string \| null; failureReason: string \| null }` |
| `styleMode` | `"default" \| "preserve"` |
| `visibility` | `"private" \| "unlisted" \| "public"` |
| `hasSharePassword` | `boolean` |
| `shareUrl` | `string \| null` |
| `ownerType`, `ownerId` | `string` |
| `createdBy` | `string` |
| `sourceFileId` | `string \| null` |
| `headings` | `{ level: number; text: string; anchorId: string }[]` |
| `references` | `ReferenceReport`（下記） |
| `permissions` | `{ canEdit: boolean; canDelete: boolean; canChangeVisibility: boolean }` |
| `createdAt`, `updatedAt` | `Date` |

`version` は編集画面が握る OCC トークンである。`updateNoteBody` / `applyTextNodeEdits` / `renameNote` / `changeNoteStyleMode` / `restoreNoteRevision` / `trashNote` / `restoreNote` はいずれも `expectedVersion` を要求するので、その最初の値を与える読み取りが要る。

```
ReferenceReport = {
  imported: { fileId: string; url: string | null }[]              // 保管して差し替えたリソース
  inlinedStylesheets: { url: string }[]                           // 本文に埋め込んだ外部スタイルシート
  unavailableStylesheets: { url: string; reason: string | null }[] // 取得できず装飾を失ったもの
  unresolved: { url: string; reason: string | null }[]             // 本文に外部 URL のまま残っている参照
  removedCss: { property: string; count: number }[]                // 直近の取り込みでサニタイズが落とした宣言
}
```

### 処理フロー

1. 閲覧者コンテキストを解決する
2. `content.status === "ready"` なら `content.headings` をそのまま射影に含める（保存時に算出済み）
3. `shareUrl` は `canChangeVisibility` が真、かつ `visibility === "unlisted"` のときだけ含める。有効な `ShareLink` は権限確認後に `ShareTokenProtector.reveal` で復号して組み立てる。休眠リンクは再び限定公開にする処理でだけ復号し、private / public の詳細には表示しない。匿名・閲覧専用の経路では復号しない
4. `references` を合成する（下記）

### `references` の合成

[ADR 014](../adr/014-import-result-provenance.md) の割り当てに従い、**構造は本文が、理由は Storage の記録が**供給する。[ADR 008](../adr/008-domain-boundaries.md) の「ノート詳細はアプリケーション層で Note / Tag / Job / Storage のクエリポートを合成する読み取りになる」にそのまま乗る。

| フィールド | 供給元 |
| --- | --- |
| `imported` | `StoredFileRepository.listByNote(noteId)` を `purpose: "reference"` で絞る。元の URL は取得記録の `imported` の行から引く（記録が消えていれば `null`） |
| `inlinedStylesheets` | 本文の `<style data-imported-stylesheet="…">` を数える |
| `unavailableStylesheets` | 本文の `<style data-stylesheet-unavailable="…">` を数え、理由を取得記録から引く |
| `unresolved` | `HtmlProcessor.extractExternalReferences(html)` のうち `StorageUrlPolicy.isInternal` が偽のもの（`data-stylesheet-href` の痕跡を含む）。理由は取得記録から引く |
| `removedCss` | `ReferenceImportRecordRepository.findSummaryByNote(noteId)` の `removedCss` |

- **理由が引けなくても構造は必ず出る**。取得記録が消えている（あるいは一度も試行されていない）場合、`reason` は `null` になる。「まだ取りに行っていない」と「取りに行って失敗した」の区別は記録の有無が与える（[domains/storage.md](../domains/storage.md)）
- **本文に現れない URL の記録は出さない**。突き合わせの向きが本文からなので、利用者が参照を消したあとに古い記録が残っていても表示に出ない。記録側に掃除の規則が要らないのはこのためである
- ジョブは引かない。取り込みの結果をジョブに載せない理由（要求者本人にしか見えず、退会で消える）は ADR 014 にある
- `content.status !== "ready"` のときは全フィールドが空になる（本文がないので突き合わせる対象がない）

**公開経路（`getPublicNote` / `getSharedNote`）はこのフィールドを含めない**。取り込みの状態は本文をこれから直す人のための情報であり、読みに来た匿名の閲覧者には意味を持たない。痕跡の URL は本文そのものに載って公開ページにも出るため隠せないが（ADR 014 の「影響」）、**取得記録の理由まで匿名に渡す必要はない**。射影する側で落とす。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 不在・権限なし・ゴミ箱（他人） | `NotFoundError("NOTE_NOT_FOUND")` |

## getSharedNote

### 概要

共有リンクからノートを引く（SH-05 / SH-06）。

### 入力DTO

`shareToken: string`, `userId: string | null`, `pass: { tokenHash: string; passwordUpdatedAt: Date; issuedAt: Date } | null`

### 出力DTO

`getNote` と同じ形に加えて `passwordRequired: boolean`。ただし `references` は含めない（下記）。

### 処理フロー

1. 共通の共有トークン解決で locator の NoteId → `NoteRouteStore` → 対象scope DO の順にたどり、NoteをIDで引いて token hashを照合する。不正なら `NotFoundError("NOTE_NOT_FOUND")`
2. `ShareCredential` を組み立てる
3. `NoteAccessPolicy.evaluate` を呼ぶ
   - `passwordRequired` → 本文もタイトルも含めず `passwordRequired: true` だけを返す
   - `denied` → `NotFoundError("NOTE_NOT_FOUND")`
   - `granted` → 射影を返す
4. サインイン済みで編集権限を持つ場合は `permissions.canEdit` を真にする

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・再発行済み・非公開化・削除 | `NotFoundError("NOTE_NOT_FOUND")`（区別しない） |

## verifySharePassword

### 概要

共有リンクのパスワードを照合し、通過証を発行する（SH-06）。

### 入力DTO

`shareToken: string`, `password: string`, `clientKey: string`

### 出力DTO

`pass: { tokenHash: string; passwordUpdatedAt: Date; issuedAt: Date }`

### 処理フロー

1. `SecureTokenGenerator.hashOf(shareToken)` を求め、`LoginAttemptKey.forSharePassword(tokenHash, input.clientKey)` で鍵を組み立てる（[domains/identity.md](../domains/identity.md)。素のトークンではなくハッシュを材料にするため、`login_attempts.key` に共有の秘密が平文で残らない）
2. `LoginAttemptStore.get(key)` を引き（`null` なら `LoginThrottlePolicy.initial(key)`）、`LoginThrottlePolicy.evaluate` で待機・ロックを判定する。`delay` / `locked` なら以降の照合を行わずに `ValidationError("THROTTLED")`（下記のとおりロックも同じコードに畳む）
3. 共通の共有トークン解決で対象scopeの NoteをIDで引き、限定公開かつ token hash が一致し、パスワードが設定されていることを確認する
4. `PasswordHasher.verify` が偽なら、`LoginAttemptStore.recordFailure(key, now, LoginThrottlePolicy.attemptTtlMs)` で失敗を**原子的に**記録して `ValidationError("INVALID_SHARE_PASSWORD")`。返ってきた加算後の記録を `evaluate` し、次が待機・ロックに当たるなら `ValidationError("THROTTLED")` に切り替える
5. `LoginAttemptStore.clear(key)` で失敗の記録を消し、`NoteAccessPolicy.issuePass(shareLink, now)` の結果を返す

鍵の名前空間（`share:`）がサインインの記録（`signIn:`）と分かれているため、共有リンクの照合失敗がサインインのロックを誘発することはない。読み書きの順序は `LoginThrottlePolicy` の「読み書きの分担」に従う（`signInWithPassword`（[usecases/identity.md](./identity.md)）と同じ）。

**手順 4 の加算が原子的であることは、この施錠が意味を持つための前提である**。手順 2 の `get` は古い値を読みうるが、判定が緩む方向に外れてもその試行の失敗は手順 4 で必ず数えられるため、施錠は追いつく。逆に手順 4 が「読んでから書く」形だと、要求を並列化するだけで失敗回数がほとんど増えず、施錠を丸ごと回避できる。

**待機とロックを 1 つのコードに畳む**。`signInWithPassword` は `THROTTLED` と `LOCKED` を分けるが、こちらは同じ `LoginThrottlePolicy` を使いながら両方を `THROTTLED` として返す。閲覧者に**解除のための次の一手がない**ためである — サインインのロックは「パスワードを再設定すれば解ける」という導線を伴うが、共有リンクの閲覧者はそのノートの所有者ではなく、待つ以外にできることがない。区別しても示せる違いがないので、畳んで「しばらく待つ」1 つの案内に寄せる（P-45 の画面状態も 1 つである）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| パスワード相違 | `ValidationError("INVALID_SHARE_PASSWORD")` |
| 連続失敗（待機・ロックとも） | `ValidationError("THROTTLED")` |
| トークン不在・パスワード未設定 | `NotFoundError("NOTE_NOT_FOUND")` |

## getPublicNote

### 概要

公開ノートを誰でも読める形で引く（SH-07 / DS-06）。

### 入力DTO

`noteId: string`, `userId: string | null`

### 出力DTO

`getNote` と同じ形に加えて、著者（`handle` / `displayName` / `avatarUrl`）とワークスペース（`slug` / `name`）、メタ情報（`description`, `canonicalUrl`）。ただし `references` は含めない（下記）。

### 処理フロー

1. `NoteRepository.findById` で引き、次の順で応答を確定する
   - 不在（完全削除後、またはそもそも存在しない `noteId`） → `NotFoundError("NOTE_NOT_FOUND")`
   - `visibility.status !== "public"`（非公開・限定公開。公開だったものを非公開・限定公開に戻した場合を含む） → `NotFoundError("NOTE_NOT_FOUND")`
   - `visibility.status === "public"` かつ `lifecycle !== "active"`（ゴミ箱在籍中で公開状態を保持している） → `NotFoundError("NOTE_GONE")`（検索エンジンへのインデックス削除を促す応答に写す）
   - 公開かつ `active` → 手順 2 へ進む
2. 著者を `getPublicProfile` 相当で、ワークスペースを `getPublicWorkspace` 相当で解決する。作成者が解決できない場合（退会済み。`USER_NOT_FOUND` になる場合を含む）は `{ displayName: "退会した利用者", handle: null }` を用い、著者ページへのリンクは出さない（R-59。読み取りモデル側の既定値 `projectNoteChanges` / `rebuildNoteProjection` と同じ文言に揃える）。ノート自体は公開のまま読める — 退会で消えるのは個人所有ノートだけで、退会者が作成したワークスペース所有ノートは残る（AC-09）
3. `description` は `excerpt` から生成する

**410 を返す範囲を最小にした理由**。公開を取り下げた URL に 410 を返すと、その `noteId` を知る相手に「そのノートは存在したが今は取得できない」と伝えることになり、公開を取り下げた事実そのものを漏らす。この設計は `getSharedNote` で「トークン不在・再発行済み・非公開化・削除を区別しない」という**存在を漏らさない**原則を既に置いており、公開ページ側だけ区別を設けるのは一貫しない。そこで 410 は「公開状態のままゴミ箱に入っている」状態、つまり所有者がまだ公開を取り下げておらず、復元すれば同じ URL で再び読める状態に限り、それ以外はすべて 404 に寄せる。

**既知の限界**。完全削除後は行そのものが消えるため公開されていた事実を判定できず、410 を返せない（下のエラーケース表の 1 行目）。したがって検索エンジンからの削除は 404 の応答と、読み取りモデル・サイトマップ（`listSitemapEntries`）から当該ノートが消えることに依存する。公開されたことのある `noteId` の削除記録（tombstone）を残せば完全削除後も 410 を返せるが、専用のテーブルに加えて保持期間と掃除の設計が要り、得られるのはインデックス削除がわずかに早まることだけなので、今回は採らない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 不在（完全削除後・存在しない `noteId`） | `NotFoundError("NOTE_NOT_FOUND")` |
| 非公開・限定公開（公開だったものを戻した場合を含む） | `NotFoundError("NOTE_NOT_FOUND")` |
| 公開されたことがない | `NotFoundError("NOTE_NOT_FOUND")` |
| ゴミ箱在籍中で公開状態を保持している | `NotFoundError("NOTE_GONE")` |

## searchNotes

### 概要

現在の文脈のノートを検索・絞り込みして一覧する（OR-01 / OR-02 / OR-03 / OR-04 / OR-05 / OR-10）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string` | — | `ownerType === "workspace"` のとき必須（2 つは相関する 1 つの入力なので、転送境界の schema も `ownerType` で判別する直和にする） |
| `lifecycle` | `"active" \| "trashed"` | ○ | 既定は `active` |
| `keyword` | `string \| null` | — | 2 文字未満は `null` に落とす |
| `tagNames` | `string[]` | — | 各 50 文字以内、最大 10 件 |
| `month` | `{ year: number; month: number } \| null` | — | `month` は 1〜12 |
| `timeZone` | `string` | ○ | 不正な値は `"UTC"` に落とす |
| `sort` | `NoteSortKey` | ○ | 既定は `keyword` があれば `relevance`、なければ `updatedDesc` |
| `page`, `limit` | `number` | ○ | `limit` は 1〜100 |

### 出力DTO

`items: NoteSummary[]`, `count: number`

### 処理フロー

1. `NoteOwner` を組み立て、ワークスペースなら `viewNote`（`lifecycle === "trashed"` なら `viewTrash`）の権限を確認する
2. `month` があれば `TimeZoneResolver.monthRange` で `DateRange` に解決する
3. 入力の `tagNames` を `TagName` の正規化規則（小文字化・全角英数の半角化・連続空白の畳み込み）で正規化してから渡す。読み取りモデルのタグ絞り込みは正規化名で照合するため、利用者が入力した表示ゆれをここで吸収する
4. owner から ScopeKey を導き `LocalNoteQueryService.search` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー・権限不足 | `BusinessRuleError(InsufficientRole)` |
| 検索のタイムアウト | `SystemError(TimeoutError)` |
| ページング値の範囲外 | `ValidationError("INVALID_PAGINATION")` |

## listNotes

### 概要

現在の文脈の active なノートを、絞り込みなしで一覧する（OR-01）。`searchNotes` の代役で、読み取りモデルではなく `NoteRepository.listByOwner` を直接引く。`searchNotes` と同じ owner 対（`ownerType` / `ownerWorkspaceId`）を取るので、**読み取りモデルが揃った時点でこの節ごと `searchNotes` に置き換わる**。

### 入力DTO

`userId`, `ownerType`（既定は `"user"`）, `ownerWorkspaceId`（`ownerType === "workspace"` のとき必須）, `page`（既定 1）, `limit`（既定 50・上限 100）

### 出力DTO

`items: { noteId, title, version, visibility, contentStatus, createdAt, updatedAt }[]`, `count: number`

`version` は行の OCC トークンである。一覧からの削除（ED-09）は**一覧メンバーシップの変更**なので実行するのは一覧側であり、`trashNote` が要求する `expectedVersion` は行と一緒に届いていなければならない。サーバー側で引き直すと、自分で読んだ値と突き合わせるだけの恒真な検査になる。

### 処理フロー

1. `NoteOwner` を組み立て、ワークスペースなら `resolveWorkspaceAccess` でロールを引いて `viewNote` を確認する（全ロールが通るので、ここで弾かれるのは非メンバーだけ）
2. owner から ScopeKey を導き `NoteRepository.listByOwner(owner, "active", { page, limit })` を引く

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー | `BusinessRuleError(InsufficientRole)` |
| ワークスペース不在 | `NotFoundError("WORKSPACE_NOT_FOUND")` |

## listTrashedNotes

### 概要

現在の文脈のゴミ箱を一覧する（ED-10）。`searchNotes` の `lifecycle: "trashed"` の代役で、`listNotes` と同じ立場にある。

`listNotes` の引数にせず別のユースケースにするのは、**門と行の形が両方とも違う**ためである。権限は `viewNote` ではなく `viewTrash`（ワークスペースの viewer はゴミ箱そのものに触れない）で、行は復元・完全削除に渡す `version` と残り日数を出す `purgeAfter` を必ず持つ。1 本にまとめると、引数で意味の変わる門と、active な行すべてに載る「必ず `null` の保持期限」を抱えることになる。

### 入力DTO

`listNotes` と同じ。

### 出力DTO

`items: { noteId, title, version, trashedAt, purgeAfter }[]`, `count: number`

### 処理フロー

1. `NoteOwner` を組み立て、ワークスペースなら `resolveWorkspaceAccess` でロールを引いて `viewTrash` を確認する
2. owner から ScopeKey を導き `NoteRepository.listByOwner(owner, "trashed", { page, limit })` を引く

並び順は `listByOwner` の `updatedAt DESC, id DESC` をそのまま使う。ゴミ箱に入っている間はノートを更新できる経路が無いので、trashed な行の `updatedAt` は削除の瞬間そのもので、P-14 が要求する「削除日時の新しい順」と一致する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー・viewer | `BusinessRuleError(InsufficientRole)` |
| ワークスペース不在 | `NotFoundError("WORKSPACE_NOT_FOUND")` |

## searchPublicNotes

### 概要

全利用者の公開ノートを横断して検索する（DS-05）。公開ページ内の検索にも使う（DS-04 / WS-09）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `keyword` | `string \| null` | — | 2 文字未満は `null` に落とす（`searchNotes` と同じ規則）。100 文字以内 |
| `tagNames` | `string[]` | — | 各 50 文字以内、最大 10 件 |
| `ownerHandle` | `string \| null` | — | `Handle` の文字種・長さの規則 |
| `workspaceSlug` | `string \| null` | — | `WorkspaceSlug` の文字種・長さの規則 |
| `updatedFrom`, `updatedTo` | `Date \| null` | — | 両方あるとき `updatedFrom <= updatedTo` |
| `cursor` | `string \| null` | — | 直前の同じ公開検索条件で返したopaque cursorのみ |
| `limit` | `number` | ○ | 1〜100 |

`keyword` の 2 文字下限は転送境界で `null` に落とす形で効かせる。エラーにはしない — 落とした結果として条件が 1 つも残らなければ、処理フローの手前で `QUERY_TOO_SHORT`（`ownerFilter` 未指定のとき）になる。bigram 方式では 2 文字から検索が成立する（[ADR 011](../adr/011-bigram-search.md)）ため、この下限は「1 文字では母集合が絞れない」ことに由来する上限側の防御であり、`searchNotes` と同じ値・同じ落とし方に揃える。

期間の絞り込みは**更新日時**に対する範囲で、`updatedTo` は指定日を含む（境界の解決は処理フロー 3）。

### 出力DTO

`items: PublicNoteSummary[]`, `nextCursor: string | null`, `hasMore: boolean`

### 処理フロー

1. `ownerHandle` があれば利用者を、`workspaceSlug` があれば公開ワークスペースを解決して `ownerFilter` を組み立てる
2. `tagNames` は `searchNotes` と同じく `TagName` の正規化規則で正規化してから渡す
3. `updatedFrom` / `updatedTo` のどちらかがあれば `updatedWithin: DateRange` に解決する。基準列は読み取りモデルの更新日時（`note_search.updated_at`）で、`from` は `updatedFrom` の 0 時、`toExclusive` は `updatedTo` の翌日 0 時（指定日を含める）。`searchNotes` と違い閲覧者のタイムゾーンを持てない（サインイン不要の経路）ため、境界は UTC で解決する。片方だけの指定は、欠けた側を範囲の端（`from` は epoch、`toExclusive` は十分先の未来）で埋める
4. global public shard reader の `PublicNoteQueryService.searchPublic` を呼ぶ。cursorにはquery fingerprint、shard generation、各shardのkeyset位置/絶対rankを含め（認証はしない。[ADR 063](../adr/063-public-cursor-not-authenticated.md)）、1pageで各shardから読む候補を`limit`件に固定する。dual-read中はNoteIdで重複排除する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ハンドル・スラッグの不在 | `NotFoundError("OWNER_NOT_FOUND")` |
| 検索語が 2 文字未満かつタグも期間も未指定（`ownerFilter` 未指定のとき） | `ValidationError("QUERY_TOO_SHORT")` |
| `updatedFrom > updatedTo` | `ValidationError("INVALID_DATE_RANGE")` |
| ページング値の範囲外 | `ValidationError("INVALID_PAGINATION")` |
| レート制限 | `ValidationError("RATE_LIMITED")` |

`ownerFilter` が指定されている場合（公開ページ内の一覧・検索）は条件なしを許し、`QUERY_TOO_SHORT` にしない — 公開ページの条件なし一覧はこの経路で成立する。

期間の基準を更新日時に採るのは、結果に出す日時が更新日時であり（DS-05 / P-41）、公開行を絞れる索引が `note_search_public_updated_idx` / `note_search_owner_public_updated_idx`（いずれも `updated_at DESC` の部分索引。[database/index.md](../database/index.md)）だけだからである。公開検索では絞り込む列と並べ替える列が同じなので、この 2 索引が両方を 1 本で賄う。個人向けの `searchNotes` が作成日時（`createdWithin`）を基準にするのとは基準列が異なり、あちらは範囲列（`created_at`）と既定のソート列（`updated_at`）が食い違うため、`note_search_owner_lifecycle_created_idx` が担うのは母集合の切り出しまでで、並べ替えは別に要る（[domains/note.md](../domains/note.md)、[database/index.md](../database/index.md)）。

## countNotesByCreationDate

### 概要

ノートが存在する月の一覧と、指定した期間の日ごとの作成件数を引く（OR-02 のカレンダー表示と OR-05 の月セレクターが使う）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `month: { year; month }`, `timeZone: string`

### 出力DTO

`availableMonths: { year; month }[]`, `days: { day: string; count: number }[]`

### 処理フロー

1. 権限を `viewNote` で確認する
2. `TimeZoneResolver.monthRange` で範囲を解決する
3. owner の scope で `LocalNoteQueryService.listMonthsWithNotes` と `countByDay` を呼ぶ

### エラーケース

`searchNotes` と同じ。

## updateNoteBody

### 概要

HTML / WYSIWYG エディタからの保存を適用する（ED-03 / ED-04 / ED-08）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `noteId`, `userId` | `string` | ○ | — |
| `rawHtml` | `string` | ○ | 2 MB 以内（サニタイズ前） |
| `expectedVersion` | `number` | ○ | 楽観ロックのために必須 |
| `reason` | `"manualEdit" \| "wysiwygConversion"` | ○ | 版の記録理由 |
| `importReferences` | `boolean` | — | 新規の外部参照を取り込むか。**省略時は真**（下記） |

### 出力DTO

`noteId`, `version`, `removed: { kind; name; reason }[]`, `referenceImportJobId: string | null`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する。`TrashedNote` なら `BusinessRuleError(NoteIsTrashed)`
2. `JobRepository.listActiveByTarget({ type: "note", noteId })` を引き、実行中の変換・再生成ジョブ（`kind: "conversion" | "regeneration"`）があれば `BusinessRuleError(NoteLockedByJob)`（[domains/note.md](../domains/note.md) の「再生成中は編集拒否」）
3. `HtmlProcessor.process(rawHtml)` を呼ぶ
4. 現在の本文が `ready` なら `NoteRevision.capture(reason)` を作る
5. `Note.updateBody` を適用する
6. `UnitOfWorkProvider.run` で版とノートを保存し、イベントを収集する
7. `NoteRevisionRepository.deleteOlderThanNewest(noteId, 20)` を呼ぶ
8. `importReferences` が真なら参照取り込みジョブを登録する。登録は次の 2 つをどちらも満たすときだけ行う。
   - `HtmlProcessor.extractExternalReferences` の結果のうち、`StorageUrlPolicy.isInternal`（[domains/storage.md](../domains/storage.md)）が偽のものが 1 件以上ある
   - 同じノートを対象とする未終端の `referenceImport` ジョブがない。手順 2 で引いた `JobRepository.listActiveByTarget` の結果を `kind === "referenceImport"` で絞るだけでよく、**`JobConcurrencyPolicy.ensureNoDuplicate` は使わない** — あれは `BusinessRuleError(DuplicateJob)` を投げるものであり、利用者が明示的に要求した操作（`requestRegeneration`）を拒むためのものである。ここでの重複は利用者の誤りではなく自動保存の副作用なので、**保存自体は成功させ、既存の `jobId` を `referenceImportJobId` として返す**

   登録する場合は `Job.enqueue({ target: { type: "note", noteId }, payload: { kind: "referenceImport" }, scope, kind: "referenceImport", requestedBy: userId, parentId: null })`。`scope` は対象ノートの所有文脈から導出する（個人所有なら `{ type: "user", userId: owner.userId }`、ワークスペース所有なら `{ type: "workspace", workspaceId: owner.workspaceId }`。[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。ノートを編集した本人が要求者だが、`scope` の基準は所有者であり `createdBy` でも `userId` でもない — ワークスペースのノートに他のメンバーが参照を取り込ませたジョブは、そのワークスペースの削除・除名でキャンセルされなければならない

### `importReferences` の既定と、偽を選んだときの本文

**省略時は真**とする。取り込み経路（`runConversion` / `runRegeneration`）は利用者の選択なしに参照を取り込むため、既定を偽にすると「同じ HTML をファイルとして取り込めば装飾が残り、エディタに貼ると失われる」という非対称が生まれる。既定を真にすればこの差は消え、明示的に偽を選んだ場合だけが例外になる。

**偽のときは本文中の痕跡に手を触れない**。外部スタイルシートの痕跡（`<style data-stylesheet-href="…">`。[domains/note.md](../domains/note.md)）はそのまま残り、CSS が入らないので装飾は当たらない。落とさない理由は 2 つある。

- 痕跡を落とすと、後から取り込み直す道が永久に閉じる。本文に `<link>` はもう残っておらず、URL を持っているのはこの痕跡だけだからである。残しておけば、次に `importReferences` を真にして保存した時点で取り込まれる
- 空の痕跡が禁じられていた理由（残すと保存のたびに同じ参照取り込みジョブが登録され続ける）は、偽のときはジョブを登録しないので発生しない。真のときも手順 8 の重複防止が効く

`removed` には `link` の除去が現れる（初回の保存時）ので、装飾が当たらないことは利用者に伝わる。既定スタイルを当て直す導線は表示スタイルの切り替え（ED-11）にある。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| ゴミ箱のノート | `BusinessRuleError(NoteIsTrashed)` |
| 実行中の変換・再生成ジョブがある | `BusinessRuleError(NoteLockedByJob)` |
| サニタイズ後が 800,000 バイト超 | `BusinessRuleError(ContentTooLarge)` |
| 版の競合（他者が更新） | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## applyTextNodeEdits

### 概要

ビジュアルエディタの編集を、構造を保ったまま適用する（ED-02）。

### 入力DTO

`noteId`, `userId`, `edits: { path: string; expected: string; text: string }[]`, `expectedVersion: number`

### 出力DTO

`noteId`, `version`, `skipped: { path: string; reason: string }[]`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `JobRepository.listActiveByTarget({ type: "note", noteId })` を引き、実行中の変換・再生成ジョブ（`kind: "conversion" | "regeneration"`）があれば `BusinessRuleError(NoteLockedByJob)`
3. 現在の本文が `ready` でなければ `BusinessRuleError(CannotCaptureEmptyContent)`
4. `HtmlProcessor.editTextNodes(html, edits)` を呼ぶ
5. 手順 4 の `html` を `HtmlProcessor.process` に通して `ProcessedHtml` を得る（下記）
6. `NoteRevision.capture("manualEdit")` を作る
7. `Note.updateBody` に手順 5 の `ProcessedHtml` を渡して保存する

**編集結果を `process` に通す**。`editTextNodes` が返すのは `EditTextNodesResult`（`html` と `skipped`）であって `ProcessedHtml` ではなく、`Note.updateBody` は `ProcessedHtml` を要求する（[domains/note.md](../domains/note.md)）ため、この一手が要る。派生情報（`text` / `excerpt` / `headings`）もテキストの書き換えで変わるので、作り直さないと読み取りモデルへの投影が古いまま残る。

サニタイズの観点でも要る。`editTextNodes` は `<style>` の子テキストノードに経路を割り当てない（[domains/note.md](../domains/note.md)）ため CSS を書き換える経路は塞がっているが、それはポートの契約であって、契約を満たさない実装や将来の変更に対する保険にはならない。保存前に必ず `process` を通すことで、本文が常に [ADR 013](../adr/013-html-sanitization-policy.md) の規則を満たしている状態を保つ。

### エラーケース

`updateNoteBody` と同じ。加えて、すべての編集が `skipped` になった場合も成功として返す（版は作らない）。`<style>` の中身を指す編集は経路が割り当たらないため `pathNotFound` として `skipped` に落ちる。

## renameNote

### 概要

タイトルを変更する（ED-07）。

### 入力DTO

`noteId`, `userId`, `title: string`, `expectedVersion: number`

### 出力DTO

`noteId`, `title`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する。`TrashedNote` なら `BusinessRuleError(NoteIsTrashed)`
2. `Note.rename` を適用して保存する（由来は `manual`）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| ゴミ箱のノート | `BusinessRuleError(NoteIsTrashed)` |
| 200 文字超 | `BusinessRuleError(InvalidTitle)` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## changeNoteStyleMode

### 概要

既定スタイルの適用を切り替える（ED-11）。

### 入力DTO

`noteId`, `userId`, `styleMode: "default" | "preserve"`, `expectedVersion: number`

### 出力DTO

`noteId`, `styleMode`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する。`TrashedNote` なら `BusinessRuleError(NoteIsTrashed)`
2. `Note.changeStyleMode` を適用して保存し、`note.styleModeChanged` を収集する（読み取りモデルの `style_mode` はこのイベント経由の `projectNoteChanges` でのみ更新される）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未知の値 | `BusinessRuleError(InvalidStyleMode)` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| ゴミ箱のノート | `BusinessRuleError(NoteIsTrashed)` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## moveNote

### 概要

ノートの所属先を移す（OR-12）。

### 入力DTO

`noteId`, `userId`, 移動先（`{ targetOwnerType: "user" }` または `{ targetOwnerType: "workspace"; targetWorkspaceId: string }` の直和 — `targetWorkspaceId` は `targetOwnerType === "workspace"` のときだけ存在し、転送境界の schema も `targetOwnerType` で判別する）, `expectedVersion: number | null`（版を持たない呼び出し元は `null` を渡し、版の検査を省く）

### 出力DTO

`noteId`, `ownerType`, `ownerId`, `droppedTagNames: string[]`, `version`

### 処理フロー

1. `NoteRouteStore.resolve(noteId)` で source scope / routeVersion を解決し、source object で閲覧者コンテキストと `canEdit` を確認してactorとMembership versionを得る
2. target ScopeKey を組み立てる。workspace なら target object で実在と `createNote` 権限を確認し、Membership versionを得る
3. source object で `NoteOwnershipPolicy.ensureMovable` を呼び、`TagRelocationPolicy.plan` で外れるタグ名を確定する
4. `migrationId` を採番し、NoteId hashのnote coordination shardで operation 行と route の claim を 2 段で作る。まず global 面の unit of work で `distributed_operations` を開き、次に `note_routes.state = moving` を expected routeVersion の compare-and-swap で取る。同じnoteにoperationがあれば再開する。**引き直した行が終端していたら、最初の phase へ進む前に `running` へ開き直す**（下記）。routeとoperationを別shardへ分けない。claim の直前に route を読み直し、その scope が operation payload の source と一致しないなら claim せずに `ConflictError("STALE_SCOPE_ROUTE")` を返す — CAS が比べるのは routeVersion だけなので、この間に移動したノートは新しい route の上で claim され、以後の全 phase は payload が凍結した旧 scope を相手にし続けることになる（凍結が空を見て `NOTE_NOT_FOUND` に化ける）。掴んだまま誰も使わない `moving` を残さないためでもある

route の claim が operation と同じ transaction に入らないのは、route store が UoW の外に置かれた atomic store だからである（[ADR 023](../adr/023-two-plane-unit-of-work.md)。ノートの現在地は所有 scope をまたいで解決される鍵であり、どちらの面の UoW にも属さない）。したがって「operation は `running` だが route は掴めていない」中間状態が存在しうる。この状態は次の同一要求が再開する — `requestKey` は「ノート・**要求した actor**・移動先・出発点の routeVersion」から決まり、失敗した試行は routeVersion を動かさないので、同じ移動の再試行は必ず同じ operation を replay する（一方、かつて住んでいた scope へ戻す移動は別の鍵になり、完了済みの operation の receipt を引き継いで staging を空振りさせない）。actor が鍵に入るのは、replay される plan が認可そのものだからである — 各 phase が読み直す Membership の版も、move authorization lock の主体も、payload の `actorUserId` を名指しする。actor を鍵から外すと、別のメンバーの要求が最初の要求の operation を再開し、「まだ確定してよいか」の検査が別人について行われる。返ってきた operation が自分の `requestKey` と違えば別の移動が進行中なので、前進せず `ConflictError("NOTE_MOVE_IN_PROGRESS")` を返す。route の claim に失敗した operation はその場で `rejected` へ落とす — `running` のまま残すと、このノートの以後の移動がすべて止まるためである。同じ場で route も返す: claim が commit したのに応答だけを失った場合、`moving` を掴んだままの route が残り、別の actor も別の移動先も進めなくなる。route を読み直し、この migration の下で `moving` であるときだけ返す（掴んでいなければ何もしない）。**返し方は裸の `abortMove` ではなく手順 4〜6 の補償そのもの**である — 初回の試行なら staged 行が無いので route を戻すだけで済むが、**再開された試行は前の試行の staged 複製・credit・receipt と両 scope の move lock を引き継いでいる**。それらを残したまま route だけ戻すと、利用者が次に**別の移動先**を選んだ瞬間に `routeVersion` が進んで `requestKey` を二度と導出できなくなり、期限も所有者も持たない move lock が両 workspace に永久に残る（削除とメンバー変更が恒久的に拒否される）
5. actorとsource Membership versionを渡して`freezeSource`を呼ぶ。再認可し、source move lockを保存して、active Jobを終端し、Note・tags・projectionRevisionをsnapshotへ固定する。この時点ではsource Usageを減らさない
6. actorとtarget Membership versionを渡してtargetへstaged importする。snapshot revisionを復元してowner変更分を1増やし、move authorization lock保存とtargetCreditを同じlocal transactionで行う。**receipt が既に立っていて staging を飛ばす再開では、staged 複製を今回 freeze した版へ引き上げる** — route が `moving` のあいだも source は書き込み可能（move lock が止めるのはメンバー変更と scope 削除であって編集ではない）なので、2 つの試行のあいだに着地した編集は snapshot に入り staged 複製に入らない。引き上げる対象は Note 本体・版・**Revision** で、**ファイル metadata は引き継がない**（target へ渡らなかった行は source に残り、手順 8 でも retire されない）。Revision は版と一緒には判定しない — 版が動かないまま Revision だけが増える書き込みがありうるので、版が一致して Note 行を書き直さない場合でも Revision は snapshot の集合へ同期し直す。手順 8 が source の Revision を無条件に消すのは、この同期があるからである
7. D1 route を source → target へ1文で切り替える。これが利用者から見える所属変更の唯一の切替点である
8. target を有効化してauthorization lockを解放し、その後sourceをtombstoneにしてUsageの`sourceDebit`を適用する。source の Note 行と全 Revision は**無条件に**消す（ファイル metadata と使用量の減算は逆で、target が実際に受け取った集合だけを対象にする）。無条件にできるのは手順 6 の引き上げがあるからで、staged 複製を古い版のまま残したままここへ来ると、2 つの試行のあいだの編集が switch の瞬間に消える。停止中は最大でsource/targetへ二重計上され、過少計上にはならない。local projection、tag assignment、file metadata、backup recordはroute switch前に準備済みである
9. `note.moved` を global projection Queue に送り、public projection を current route から再構築する。手順7以降の失敗は operation recovery Cron / scope Alarm が再開し、API は route switch 完了後なら成功を返してよい。**最後に operation を `completed` へ落とす失敗は利用者へ返さない** — 利用者が求めたことはすべて commit 済みなので、失敗として返すのは利用者が行動できない偽であり、しかも再送は `running` の operation に合流して `NOTE_MOVE_IN_PROGRESS` で拒否される。記録して view を返し、残る `running` 行の回収は手順 7 以降の停止と同じ扱いにする

手順4〜6で失敗したら、まず `abortMove`（「この migration の下で今も `moving`」の compare-and-swap）で route を active source へ戻し、**それが通ったときにだけ**補償へ進む。順序は入れ替えられない — switch が commit した瞬間から staged 行がノートの唯一の複製になるので、解体してよいのは route がまだ source の同じ世代を指しているあいだだけである。CAS が拒否された場合（応答を失ったときは route を読み直して判定する）は switch が既に着地しているとみなし、**何も補償せず**その場で停止して migration ID と両 scope を記録する。停止した移動を前進させる駆動口は本スライスに無い。

**この停止では operation を終端させず `running` のまま残す。** switch は着地しているが手順 8 は走っていないので両 scope に move lock が残り、lock は lease も期限も持たず `migrationId` を握る呼び出し元しか解放できない。ここで `rejected` に落とすと `beginOrResume` は次の要求に新しい operation を作り、その `migrationId` を持つ主体が二度と現れず、両ワークスペースが削除とメンバー管理を恒久的に失う（route は既に次の世代なので `requestKey` も導出できない）。`running` のままなら停止は記録として残り、再開の駆動口（本スライスの外）が走査できる。手順 8 以降で落ちた場合に残る状態と同じであり、同じ物理状態を 2 つの経路が別々に終端しないためでもある。

**「switch 前の到達点はすべて `rejected`」には、operation を開く呼び出し自体が応答を失った場合も含まれる。** その呼び出しは補償の内側に置き、失敗したら同じ入力で `beginOrResume` をもう一度 best-effort で呼んで（`requestKey` に対して冪等なので、commit 済みなら同じ行が返る）、返った行が自分のものであれば `rejected` で閉じる。応答喪失で失われるのは行の `id` だけで `requestKey` から引き直せる、というのがこの修復が成立する理由である。閉じずに `running` を残すと、別の編集者は別の `requestKey` を導くのに store がその要求を先の行へ合流させるため、**このノートは以後どの移動要求も受け付けなくなる**。

**ただし終端表 2 行目の「まだ何も掴んでいない」は前提であって観測ではない。** `beginOrResume` は `requestKey` について冪等で state を問わず同じ行を返すので、引き直した行が**前の試行の staged 複製・credit・両 scope の move lock を引き継いでいる**ことがありうる。したがって閉じる前に route を読み、この migration の下で `moving` を掴んでいれば手順 4〜6 の補償を通してから `rejected` にし、route が既に target を指している（switch 済み）なら**終端させず** `running` のまま停止として記録する（switch 後の停止と同じ扱いにする）。route の読み自体が失敗したときは何も終端せずログだけ残す — 掴んでいるかもしれない行を閉じない側に倒れる。

**終端表の 1 行目と 2 行目が、route を読めなかったときに逆へ倒れるのは意図である。** 1 行目（claim の失敗）へ至った要求は、保持されうるものを作った当人であり、その行を `running` で残すと**以後このノートのあらゆる移動要求が拒否される**（`beginOrResume` が後続を死んだ行へ合流させる）ので、閉じる側に倒す。2 行目（operation を開く呼び出し自体の失敗）へ至った要求は、引き直した行が**前の試行や並行する同一 requestKey の要求のもの**でありうるので、閉じると両 scope の move lock を解放できる唯一の主体を終端することになり、閉じない側に倒す。どちらの経路でも `"switched"` — route が既に target を指している — と判明した場合だけは共通で終端させない（switch 後の停止と同じ扱い）。

**サガは必ず `running` な行の上で走る。** `beginOrResume` は `requestKey` について冪等で state を問わず同じ行を返すので、一度失敗して `rejected` で閉じた移動を同じ actor が同じ移動先へやり直すと（失敗は `routeVersion` を動かさないので鍵は一致する）、引き直されるのは終端した行そのものである。その上でサガを駆動すると switch 後の停止が行き場を失う — 停止の経路は記録するだけなので行は `rejected` のまま残り、両 scope の move lock を解放できる主体が二度と現れない（route は既に target を指しているので、再要求は「移動先が同じ」の no-op 成功に落ちて何も直さない）。したがって claim より前に `running` へ開き直す。開き直せなければその場で諦める — まだどの phase も走っていないので、次の再試行が同じ鍵でやり直せる。

**開き直しは「partition ごとに running は 1 件」に従う。** 自分の行が終端しているあいだは別の `requestKey` が新しい operation を作れるので、開き直しは走行中の別 migration と衝突しうる。この一意性を持つのは store であって呼び出し元ではないため、store が拒否し（`DISTRIBUTED_OPERATION_ALREADY_RUNNING`）、`moveNote` はそれを `ConflictError("NOTE_MOVE_IN_PROGRESS")` に写す — `beginOrResume` が別の走行中 operation へ合流させたときと同じ答えである。

operation の終端はしたがって次の 5 通りだけである。

| 到達点 | operation の状態 | 補償 |
| --- | --- | --- |
| route の claim に失敗（手順 4） | `rejected`（route を読めなくても閉じる） | claim を保持していれば手順 4〜6 の補償で返す |
| operation を開く呼び出し自体の失敗（手順 4 の 1 段目） | `rejected`（route を読めなければ閉じない） | 「まだ何も掴んでいない」ことを確かめてから閉じる（下記） |
| switch 前の中止（手順 5〜6 の失敗） | `rejected` | 補償する |
| switch 後の停止（中止の CAS 拒否・手順 8 以降の失敗） | `running` のまま | 何もしない（前進のみ） |
| 成功（手順 9 まで） | `completed` | — |

補償へ進んだときは target creditを逆仕訳し、stageと両scopeのmove lockを削除し、sourceをthawする。**完全**とは target scope にこの migration の痕跡を残さないことで、消した行を「適用済み」と主張する `applied_operations` の記録も同じ transaction で消す（`clearApplied`）。target へ receipt を書く相は自分の鍵を申告する — ノート本体・ファイル metadata に加え、tag の seam も staged 分の鍵を型として宣言し、abort はそれらをまとめて消す。申告のない相が receipt を残すと、再開した手順6がその鍵で空振りする。各応答喪失は同じmigration IDで再試行するため、記録が残っていると再開した手順6が空のtargetへ素通りし、手順7がそこへrouteを切り替えてしまう。abort自体はstaged Noteの存在で冪等にし、自前のcommand keyは持たない。補償が消すのは attempt の snapshot ではなく target を列挙した結果である — 手順5に到達しなかった試行も、前の試行が staged した行を戻さなければならない。switch後はabortせず必ず前進する。

**補償自体が失敗した場合に何が残るか。** 補償は **3 つの独立な half**（target の `releaseMove` / target の解体 / source の `releaseMove`）に割り、どの half の失敗も他の 2 つを道連れにしない。とくに**どちらの lock 解放も解体と同じ transaction に置かない** — lock は lease も期限も持たずこの migration しか解放できないうえ、直後に operation が `rejected` で閉じるので、道連れにした取り残しはそのまま恒久化し、そのワークスペースは削除もメンバー管理も恒久的に失う。target の解放を解体より**先**に打てるのは、thaw が既に route を source へ戻しており、pre-switch の staged 複製へ route から到達する経路がもう無いからである。

解体だけが落ちたときに残るのは **staged 複製・staged file metadata・credit・`applied_operations` の記録**で、**move lock は両 scope とも残らない**。そしてこの残留物には**回収の駆動口が無い** — 本スライスの外に置いた移動の recovery が走査するのは `running` な operation であり、この経路は直後に `rejected` で終端するのでその網に掛からない。同じ actor が同じ requestKey を導ける間だけ再試行が引き継げる。

呼び出し元へ返るのは補償の失敗ではなく**ここへ至った元の失敗**である（補償は診断を置き換えない）。ただし cause を 1 つに絞ることで消える情報は残す — 解体の cause に負けた lock 解放の失敗は、`migrationId` と両 scope を添えてログに 1 行残す。「そのワークスペースがなぜ削除できないのか」を辿れるのはその行だけだからである。

外れるタグ名は手順3で固定した operation payload から返し、再開時に計算し直さない。

移動先の容量クォータは検査しない（意図的な設計）。クォータの強制は取り込み時のみで、超過は警告表示と新規アップロードの拒否で扱う。Usageは `note.moved` eventでは付け替えない。targetCredit → route switch → sourceDebit の順に、**サガの各 phase の transaction の中で直接** `StorageQuota` を加減算する（`applyStorageDelta` の購読経路は通らない）。二重増減を防ぐのはその phase 自身の `AppliedOperationStore`（`migrationId` + command key）で、加減算はその記録と同じ transaction に入るため、応答喪失の再試行が二重に効くことはない。switch前のupload判定はsource消費を維持し、target credit済みなら過剰拒否にだけ倒れる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 移動元の権限不足（操作中に除名されていた場合を含む） | `NotFoundError("NOTE_NOT_FOUND")`（存在を漏らさない） |
| 移動先のワークスペースが存在しない（削除済みを含む） | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| 移動先の権限不足 | `BusinessRuleError(InsufficientRole)` |
| 変換処理中 | `BusinessRuleError(CannotMoveWhileProcessing)` |
| 移動先が同じ | 変更もイベントもなく成功として返す |
| 同じノートの移動が進行中 | 既存 operation を再開し、その結果を返す |
| 同じノートで**別の**移動が進行中（要求が進行中 operation のものと一致しない） | `ConflictError("NOTE_MOVE_IN_PROGRESS")`。走行中 operation の plan は自分の要求ではないため、合流して前進させない。終端した自分の行を開き直そうとして store に拒否された場合も同じ（partition ごとに running は 1 件） |
| route が途中で変わった | route を1回引き直して既存 operation を再開。再度競合したら `ConflictError("STALE_SCOPE_ROUTE")` |
| claim 時点の route が operation payload の source を指していない（間に別の移動が着地した） | `ConflictError("STALE_SCOPE_ROUTE")`。claim せずに返すので、掴んだまま使われない `moving` は残らない |
| 確定する transaction の中で actor の Membership の版が動いていた（降格・除名以外の更新を含む） | 移動元なら `NotFoundError("NOTE_NOT_FOUND")`（行が消えていた場合）、それ以外は `ConflictError("STALE_MEMBERSHIP")` |
| どちらかの scope が削除を受理済み | `ConflictError("WORKSPACE_DELETING")` |
| 同じ migration ID の move authorization lock が別の actor を指している | `ConflictError("MOVE_AUTHORIZATION_LOCK_CONFLICT")` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## changeNoteVisibility

### 概要

公開ステータスを変更する（SH-01 / SH-02）。

### 入力DTO

`noteId`, `userId`, `visibility: "private" | "unlisted" | "public"`, `expectedVersion: number`

### 出力DTO

`noteId`, `visibility`, `shareUrl: string | null`, `hasSharePassword: boolean`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canChangeVisibility` を確認する
2. `public` に変える場合、個人所有なら `UserRepository.findById(owner.userId)` で所有者の公開ハンドルを、ワークスペース所有なら所有ワークスペースの公開スラッグを調べ、未設定なら `ValidationError("PUBLIC_HANDLE_REQUIRED")`。検査の基準は所有者であり、作成者（`createdBy`）ではない
3. `unlisted` に変えるとき、休眠リンクがなければ共通の共有トークン発行で新しい `ShareLink` を作る。休眠リンクがあれば権限確認後にその `protectedToken` を復号して同じ URL を返す
4. `Note.makePrivate` / `makeUnlisted` / `makePublic` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 本文が空 | `BusinessRuleError(CannotPublishEmptyNote)` |
| 公開ハンドル未設定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## setSharePassword

### 概要

共有リンクのパスワードを設定・変更・解除する（SH-03）。

### 入力DTO

`noteId`, `userId`, `password: string | null`, `expectedVersion: number`

### 出力DTO

`noteId`, `hasSharePassword`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canChangeVisibility` を確認する
2. `password` が非 `null` なら `PlainPassword.create` と `PasswordHasher.hash` を実行する
3. `Note.setSharePassword` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 限定公開でない | `BusinessRuleError(NotUnlisted)` |
| パスワード強度の違反 | `BusinessRuleError(WeakPassword)` |

## reissueShareLink

### 概要

共有リンクを再発行して古いリンクを無効にする（SH-04）。

### 入力DTO

`noteId`, `userId`, `expectedVersion: number`

### 出力DTO

`noteId`, `shareUrl`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canChangeVisibility` を確認する
2. 共通の共有トークン発行で NoteId を locator に含む新しいトークンと `ShareLink` を作る
3. `Note.reissueShareLink` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 限定公開でない | `BusinessRuleError(NotUnlisted)` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## trashNote

### 概要

ノートをゴミ箱に移す（ED-09）。

### 入力DTO

`noteId`, `userId`, `expectedVersion: number`, `excludingJobId: string | null`

`excludingJobId` は手順 2 の強制終端から外すジョブ（「共通: ユースケースを合成するときの副作用の範囲」）。画面から呼ぶ経路は `null`、`runBulkNoteOperationItem` から呼ぶ経路は自分の `jobId` を渡す。転送境界には露出しない引数で、`serverAction` の `inputValidator` は受け付けない。

### 出力DTO

`noteId`, `trashedAt`, `purgeAfter`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canDelete` を確認する
2. `JobRepository.listActiveByTarget({ type: "note", noteId }, limit: 100)` を引き、`excludingJobId` に一致するものを除いたすべてを `Job.cancel` する。100 件に達していれば同じ UoW で継続要求 `job.terminationContinued { origin: { path: "trashNote", noteId, excludingJobId } }` を積む（[usecases/job.md](./job.md) の「共通: 強制終端の後始末」）。1 ノートの網なので実際には達しないが、規則は経路ごとに省かない
3. 「共通: 強制終端の後始末」（[usecases/job.md](./job.md)）に従う。`kind: "conversion"` のジョブを止めた結果、対象ノートの `content.status` が `processing` のままなら `Note.markConversionFailed("canceled", now)` を適用する。生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を `deleteFiles`（[usecases/storage.md](./storage.md)）で回収する — ただし対象（`target.type === "note"`）で引くこの経路は batch 親を返さないため、回収対象は実際には空になる。規則は経路ごとに省かず同じ形で適用する
4. `Note.trash` を適用して保存し、イベントを収集する
5. 同じ transaction で `NoteRepository.findNextPurgeDeadline()` を引き直し、その期限へ scope の保持期限回収 task（`purgeExpiredTrash` の行）を upsert する。行は scope に 1 つなので、いま捨てたノートの `purgeAfter` をそのまま書くと、より古いノートの期限を捨てるたびに押し出してしまう。同じ transaction の内側で引き直すことが、いま保存したノートを答えに含める条件でもある。ゴミ箱が空（`null`）になることはこの経路では起こらない

手順 3 は手順 4 より**先**に適用する — `Note.markConversionFailed` は `ActiveNote` しか受け取らないため、`Note.trash` を先に当てると回復の手立てがなくなる。

ジョブの取り消し・本文の回復・ノートの更新・保持期限回収 task の張り替えは同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する（手順 2 の `listActiveByTarget` と手順 5 の `findNextPurgeDeadline` も UoW の内側で引く）。

手順 2 の除外は、`excludingJobId` に一致する 1 件だけを取り除く。同じノートを対象とする他のジョブ（変換・再生成・PDF 書き出し・別の一括操作の子）は、呼び出し元が一括操作の子であっても通常どおり取り消す — 取り消すべき理由（ノートがゴミ箱に入る）は呼び出し経路によらないためである。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 既にゴミ箱 | 変更なしで成功として返す |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## restoreNote

### 概要

ゴミ箱のノートを元に戻す（ED-10）。

### 入力DTO

`noteId`, `userId`, `expectedVersion: number`

### 出力DTO

`noteId`, `visibility`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canDelete` を確認する
2. `Note.restore` を適用して保存し、イベントを収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ゴミ箱にない | `ValidationError("NOTE_NOT_TRASHED")` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## purgeNote

### 概要

ノートを完全に削除する（ED-10）。

### 入力DTO

`{ kind: "userRequest"; noteId; userId; expectedVersion } | { kind: "scopeCleanup"; noteId; expectedVersion; scope: ScopeKey; deletionOperationId: string } | { kind: "retention"; noteId; expectedVersion; scope: ScopeKey }`

`scope` は**内部専用**。scopeを名指しできる呼び出し元は、routeが置いていない文脈からノートを消せてしまう。`scopeCleanup` / `retention` の2つは actor を名指ししないので、どちらの面（request / worker）からでも駆動できる。

### 出力DTO

なし。

### 処理フロー

1. `userRequest`はprimary routeと対象scopeで閲覧者・Membership version・`canDelete`・trashed lifecycle・expected Note versionを確認する。`scopeCleanup`は`ScopeCleanupAdmissionStore.assertOwner(deletionOperationId)`とrouteのscope/Note ownerが入力`scope`に一致すること、expected Note versionだけを確認し、削除中User・削除済みMembership/Workspace・active Noteを許す。`retention`は誰の要求でもなく削除も走っていないので`assertOwner`も閲覧者解決も持たず、列挙が既に立てた主張だけ — routeのscope/Note ownerが入力`scope`に一致すること、expected Note version — を確認する。列挙と transaction の間に復元されたノートは版が動いているので競合として弾かれる。いずれも判定材料をoperation payloadへ固定する
2. `scopeCleanup`なら`sha256("ownerPurge:" + deletionOperationId + ":" + noteId)`、`retention`なら`sha256("trashExpiry:" + noteId)`を内部operation IDとし、`userRequest`なら新規採番する。sweepは自分のoperationを持たずturnが自由に再実行されるため、`retention`の内部operation IDは派生でなければならない（重なった2つのturnは1つのpurgeを再開する）。ただしrouteが既に`purging`なら新規採番せず保存済みoperation ID/phaseを返してforward recoveryを再開する。`NoteRouteStore.beginPurge`をrouteVersion CASで呼んでrouteを`purging`にする
3. 対象scopeのlocal transactionで、`userRequest`はactor/Membership・expected Note version・trashed lifecycleを再確認する。`scopeCleanup`はcleanup owner・scope/owner一致・expected Note versionだけを再確認し、actor/Membership/trashed lifecycleは要求しない。競合してNoteが残る場合はlocal変更をせず`abortPurge`でrouteをactiveへ戻し、元の競合/権限エラーを返す。abort応答喪失はrecoveryが同じoperation IDで再試行する。**abort するのは再検査が「削除しない」と決めた拒否だけで**（版・foreign scope・cleanup ownership・書き込み障壁の競合、権限を潰した形の不在、`NOTE_NOT_TRASHED`）、それ以外の判定不能な失敗では abort せず route を `purging` のまま残して記録する。**commit 後に応答を失った場合もこちら側に入る** — 応答を失った commit と、そもそも走らなかった transaction は外から同じ形をしており、`purging` の route は同じコマンドの再送で再開できるが、消えた Note の上で開き直した route は永久に解決不能になるためである
4. 再確認が通ればNoteを削除し、内部operation ID・cleanup入力の`deletionOperationId`（userRequestはnull）・routeVersion・削除時projectionRevisionを含む`note.purged`を収集する。ここから先はabortせずforward recoveryする
5. `note.purged` の購読者が後始末を担う
   - Tag の `deleteAssignmentsForNote` — タグ付与の削除
   - Storage の `deleteFilesForNote` — 保管ファイル（`source` / `media` / `reference`）の回収
   - Integration の `deleteBackupRecordsForNote` — バックアップ記録の削除
   - Note の `projectNoteChanges` — 読み取りモデルからの除去
   - Usage の `applyStorageDelta` — 件数の減算
6. **手順 4 の local transaction が commit したあと、このユースケース自身が続けて**NoteId hashで決まるnote coordination shardの`PublicNoteProjectionWriter.removeForPurge`を呼び、同じshardにco-locateしたpublic 3表の削除を1 transactionで確定する。削除は世代を比較せずend stateで冪等になり、別途のack行は持たない。その削除の確定後だけ`finishPurge`で30日tombstoneにする。手順 5 の購読者に混ぜないのは、**「public 削除の確定後だけ tombstone」という順序を守る主体を 1 か所に置く**ためで、`moveNote` が route saga の全 phase を要求経路で駆動するのと同じ形になる。ここで失敗した場合はabortせず、routeを`purging`のまま（＝到達不能のまま）残してrecoveryに委ねる

recoveryはpayloadに固定したactor/Membership version、scope、expected Note version、routeVersion、projectionRevisionを使う。Noteが残り再検査不能ならabort、Noteが消えていればpublic remove以降を再開する。利用者入力を読み直さない

### エラーケース

`restoreNote` と同じ。

## emptyTrash

### 概要

現在の文脈のゴミ箱をすべて完全削除する（ED-10）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `mode` | `"purged" \| "scheduled"` |
| `purgedCount` | `number` |
| `jobIds` | `string[]` |

`purgedCount` の意味は `mode` で変わる。`"purged"`（同期削除）では**削除し終えた件数**、`"scheduled"`（ジョブ登録）では**削除を予約した対象件数**で、返した時点ではまだ 1 件も消えていない。画面は `mode` で文言を分ける — `"purged"` は「N 件を完全に削除しました」、`"scheduled"` は「N 件の削除を開始しました（処理履歴で進捗を確認できます）」とし、後者では `jobIds` を処理履歴への導線に使う。`mode` を持たずに件数だけを返すと、後者で「削除しました」という虚偽の完了通知になる。`jobIds` は `"purged"` では空配列。

### 処理フロー

1. 権限を `deleteNote`（ワークスペースの場合）で確認する
2. `NoteRepository.countByOwner(owner, "trashed")` で件数を数え、次のどちらか一方だけを行う
   - **50 件以下** → 同期削除。`NoteRepository.listByOwner(owner, "trashed", pagination)` でゴミ箱のノートを取り、1 件ずつ `purgeNote` を**呼ぶ**（下記「同期削除は `purgeNote` の呼び出しである」）。`mode: "purged"`、`purgedCount` は削除し終えた件数、`jobIds` は空
   - **50 件超** → `listByOwner(owner, "trashed", pagination)` でゴミ箱をページごとに列挙し、対象を500件ごとに分割して、各分割をsource ScopeKey付き `requestBulkNoteOperation` の `{ kind: "purge" }` として登録する。**列挙は手順 2 で数えた総数が導くページ数（`ceil(総数 / ページ幅)`）までで打ち切る** — 1 要求の逐次読みは、その要求が既に支払って知っている数で束縛する（[platform/index.md](../platform/index.md) の「実行予算と分割単位」）。満たないページを引いた時点で早く抜けるのは従来どおり。数えたあとにゴミ箱へ入ったノートは次の要求の持ち分で、追いかけない。`mode: "scheduled"`、`purgedCount` は登録対象件数、`jobIds` は親Job ID

**同期削除のしきい値が 50 で、ジョブの分割単位が 500 なのはなぜか**。前者はHTTP要求の中で開始・完了を待つpurge operation数、後者は**1つの親ジョブ**が受け持つ件数である。同期削除はroute/DO/D1投影をまたぐため応答時間とevent fan-outを50件に止める。子ジョブは1件ずつ別実行なので親は500件を持てる。scope-local SQLにD1 query予算は適用しない。値の正典は [platform/index.md](../platform/index.md) の「実行予算と分割単位」。

**同期削除は `purgeNote` の呼び出しである**。複製ではなく合成であり、「共通: ユースケースを合成するときの副作用の範囲」と [usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」に従う。

- このユースケース自身は `UnitOfWorkProvider.run` を開かない。`purgeNote` が 1 件ごとに自分の UoW を開いて確定する。50 件を 1 トランザクションに束ねないのは、`note.purged` の購読者が結果整合で後始末する設計（[ADR 008](../adr/008-domain-boundaries.md)）である以上、まとめても得られる保証が増えないためである。途中で失敗しても既に消えたノートは戻らないが、ゴミ箱を空にする操作は部分的に進んでも矛盾しない
- `purgeNote` が要求する `expectedVersion` は**呼び出し側が渡す**。値の出所は手順 2 の `listByOwner` で引いた各ノートのその時点の `version` である（規約の「対象の版を持たない呼び出し元は、呼ぶ直前に自分で対象を引いてそのときの版を渡す」に当たる）
- 版が競合した（`ConflictError`）ノートは**読み直さずに飛ばし**、`purgedCount` に数えない。列挙から削除までの間に版が動くのは、そのノートが `restoreNote` でゴミ箱から出された場合がほとんどで、読み直して再適用すると利用者が戻したばかりのノートを消してしまう。同じ理由で `NOTE_NOT_TRASHED`・不在（既に他の経路で消えた・戻された）も飛ばして続ける
- **飛ばせるのはこの 3 つだけで、それ以外の失敗は要求ごと失敗する**。3 つはいずれも「このノートはもうこの要求の持ち分ではない」という 1 件についての事実だが、scope が応答しない・不変条件が壊れたといった失敗は、たまたま当たったノートについて何も語らない。全件がそれで落ちた要求を成功として返すと、画面は「0 件を完全に削除しました」という誤った完了通知を出す。途中で失敗しても既に確定した purge は戻らないが、これはこの操作が部分的に進んでも矛盾しないという上の性質そのものである
- `purgeNote` が周辺を巻き込む副作用（ジョブの強制終端など）を持たないため、`trashNote` のような除外引数は要らない（本文冒頭の「共通: ユースケースを合成するときの副作用の範囲」）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 同期削除の途中で個々のノートの版が競合・既に削除済み（`ConflictError` / `ValidationError("NOTE_NOT_TRASHED")` / `NotFoundError`） | そのノートを飛ばして続ける（`purgedCount` に数えない） |
| 同期削除の途中の上記以外の失敗 | そのまま送出して要求ごと失敗する。既に確定した purge は戻らない |

## purgeExpiredTrash

### 概要

保持期限を過ぎたゴミ箱のノートを回収する。trash時にscope-local `scheduled_tasks`へ最小の`purgeAfter`をupsertし、そのscopeのAlarmから呼ぶ。

### 入力DTO

`scope: ScopeKey`, `limit: number`（既定 100、上限 100）

`scope` は**内部専用**。回収は scope ローカルで、Alarm が鳴った scope そのものを名指しする。誰の要求でもないので actor は持たず、要求面・worker 面のどちらからでも駆動できる（`purgeNote` の `retention` と同じ）。

### 出力DTO

`purgedCount: number`

### 処理フロー

1. `NoteRepository.listPurgeable(now, limit)` を引く。`now` は turn の頭で 1 度だけ読み、`purgeAfter <= now` が判定のすべてである — turn の途中でゴミ箱に入ったノートを早く回収しない
2. 1 件ずつ内部purge commandを開始し、routeを閉じてからlocal delete・public remove・tombstoneまで進める。1 件の失敗はtaskへ記録して他に影響させない
3. 結果で task 行を次の 3 通りに決着させる

| turn の結果 | 決着 |
| --- | --- |
| 対象が 1 件以上あり、1 件も削除できなかった | task を backoff させる（直後の再予定はしない） |
| 満ページだった、または一部が削除できずに残った | task を直後へ再予定する |
| 期限の来た対象が無かった | `findNextPurgeDeadline` の返す期限へ task を移し、ゴミ箱が空（`null`）のときだけ task を完了する |

`limit` の既定100は1 Alarm turnのCPUとevent fan-outを有界にする。**進捗ゼロだけを backoff に落とす**のは、恒久的に失敗する 1 件で直後の再予定が spin し続けるのを避けるためで、一部でも消えた turn は残りを直後に片づける。逆に、削除を拒まれたノートを残したまま行を次の期限へ動かすと、そのノートは次に誰かがゴミ箱へ何かを捨てるまで放置される。

**期限が来ていないことは、残っていないことと同じではない**。したがって task を完了できるのはゴミ箱が空の turn だけである。Alarm はゴミ箱の唯一の駆動主体なので、まだ数えている最中のノートを残したまま行を完了すると、そのノートは永久に回収されない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の削除の失敗 | 記録して継続 |

## deleteNotesForOwner

### 概要

scope cleanup commandに従って、そのscopeのNoteを完全削除する。workspace deletionはlocal event、account deletionはpersonal scope commandから呼び、継続はlocal Alarmで行う。

### 入力DTO

`deletionOperationId`, `scope: ScopeKey`, `batchSize: number`（既定・最大100）

### 出力DTO

`purgedCount: number`

### 処理フロー

1. 入力`scope`から`NoteOwner`を組み立てる。個人の退会で消えるのは個人所有ノートだけで、退会者が作成したワークスペース所有ノートには触れない（AC-09）
2. `NoteRepository.listByOwner(owner, "all", pagination)` を `batchSize` 件ずつ読み、ゴミ箱かどうかを問わず1件ずつ`purgeNote({ kind: "scopeCleanup", noteId, expectedVersion, scope, deletionOperationId })`で内部purge operationを開始する。各Noteはrouteを`purging`にしてからlocal削除・public remove・30日tombstoneへ進み、1件の失敗はoperation recoveryへ残して次へ進む
3. タグ付与・保管ファイル・バックアップ記録・読み取りモデル・件数の後始末は `note.purged` の購読者（`purgeNote` の手順 4 と同じ受け手）に委ねる
4. 各pageのUoW前に`ScopeCleanupAdmissionStore.assertOwner(deletionOperationId)`を呼ぶ。`batchSize` 件を処理してまだ残りがあれば、**継続要求 `note.ownerPurgeContinued { scope, deletionOperationId }` を 1 件だけ**、そのバッチの最後の削除と同じ scope-local `UnitOfWorkProvider.run` の中で `scheduled_tasks` に積み、Alarm を再設定する。この継続要求の実行者は本ユースケースだけである
5. ただし**対象が残っているのにそのバッチで 1 件も削除できなかった場合は新しい継続要求を積まない**。現在taskをbackoffし、上限到達時は `failed` + global運用通知とする。恒久的に失敗する 1 件が新しい継続を無限に増やすのを防ぐ。**対象が 0 件だった場合はこれに当たらない** — 仕事が尽きた正常な終端なので、継続を積まずに成功として返る（[domains/index.md](../domains/index.md) の「継続要求」）

**カーソルは持たない**。対象は処理するそばから消えるため、「残っているものを先頭から `batchSize` 件読む」だけで必ず前に進む。重複配送で 2 系列が並走しても、両方が残りを読んで消し、対象が 0 件になった系列から順に止まる。

`deletionOperationId`はscope cleanupのadmission tokenであり、Noteごとの内部purge operation IDとは別である。各continuationは前者を保持し、個別Note purgeは親operation ID+NoteIdから導出した後者で冪等化する。通常要求の再送はrouteに保存済みのoperation IDを再利用する。

**継続の媒体を専用の要求にした理由**。以前は受け取ったのと同じ `identity.user.deleted` / `workspace.deleted` を再投入して継続していたが、これらは購読者を 8 つ / 4 つ持つため、残作業がある間じゅう購読者全員にコピーが配られ、outbox とキューを水増しした。購読者 1 件の要求に分ければ 1 系列 1 件で済む。継続の媒体としてジョブを使わない理由（`JobKind` にこの後始末に当たる種別がなく、退会した本人には処理履歴が見えない）は変わらない。`deleteFilesByOwner`（[usecases/storage.md](./storage.md)）も同じ形になったため、両者の継続の仕方の違いは解消した。

`batchSize` の既定 100 は、1 Alarm turn の CPU と `note.purged` event fan-out を一定に抑えるための作業量上限である。scope-local SQL に D1 の 500 query 予算は適用しない。正典は [platform/index.md](../platform/index.md) の「実行予算と分割単位」。

イベントを発行せず owner 単位の一括 DELETE で消す方式は採らない。ドメインをまたぐ参照（タグ付与・保管ファイル・バックアップ記録）は外部キーを持たずイベント駆動で後始末する規約であり（database 設計の共通規約）、特にバックアップ記録は owner 列を持たないため、ノートを消した後では `noteId` 経由でしか対象を解決できない。1 件ずつ `note.purged` を発行して既存の受け手に委ねるのが、新しいポートや列を増やさない最も単純な設計になる。イベント量は 1 バッチ `batchSize` 件（既定 100）に上限があり、受け手はすべて冪等に設計されている。

冪等性: `listByOwner`に現れないが`purging`のoperationが未完了なNoteもあるため、scope cleanupの完了ackは開始件数ではなく全purge operationがtombstoneへ到達したことを確認して返す。同じoperation IDの再実行は保存済みphaseから再開する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象のノートが 1 件もない | 何もせず成功として返る |
| 個々の削除の失敗 | 記録して継続（再配送・継続要求でやり直す） |

## listNoteRevisions

### 概要

版の一覧を引く（ED-08）。

### 入力DTO

`noteId`, `userId`

### 出力DTO

`revisions: { revisionId; createdAt; createdBy; createdByName; reason; excerpt }[]`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `NoteRevisionRepository.listByNote(noteId, 20)` を引く
3. 最大20件の作成者IDを`UserBatchReader.resolveMany`でUserId shard別に最大6接続で解決する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## restoreNoteRevision

### 概要

過去の版に本文を戻す（ED-04 / IM-06 の「元に戻す」）。

### 入力DTO

`noteId`, `userId`, `revisionId`, `expectedVersion: number`

### 出力DTO

`noteId`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `NoteRevisionRepository.findById` を引き、`noteId` の一致を確認する
3. 現在の本文から `NoteRevision.capture("restore")` を作る
4. 版の HTML を `HtmlProcessor.process` に通して `ProcessedHtml` を得る（下記）
5. 手順 4 の `ProcessedHtml` とタイトル・スタイルで `Note.updateBody` と `Note.changeStyleMode`、必要なら `Note.rename` を適用して保存する
6. 復元後の本文に外部参照があれば参照取り込みジョブを登録する。条件と形は `updateNoteBody` の手順 8 と同じ（内部を指さない参照が 1 件以上あり、かつ同じノートを対象とする未終端の `referenceImport` がない）

版の追加とノートの更新は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する（`updateNoteBody` の手順 6 と同じ）。

**版の HTML も `process` に通す**。`NoteRevision` が持つのは HTML だけで（[domains/note.md](../domains/note.md)）、`Note.updateBody` は `ProcessedHtml` を要求するため。派生情報を作り直さないと、復元後の抜粋・見出し・読み取りモデルが復元前のままになる。

**復元は参照の状態を巻き戻す**。取り込みは版を作らない（[usecases/storage.md](./storage.md) の `importExternalReferences`）ため、直近の版は取り込み**前**の本文である。これを復元すると、取り込み済みだった内部 URL が外部 URL に戻り、`data-imported-stylesheet` になっていた痕跡が `data-stylesheet-href` に戻る。手順 6 で取り込みを登録し直すのはこのためで、これがないと本文に未取得の参照が残ったまま誰も取りに行かない状態になる。

Storage 側の取得記録（[domains/storage.md](../domains/storage.md) の `ReferenceAttempt`）は復元で消さない。記録は URL ごとの「最後に試したときどうだったか」であり、本文が巻き戻っても事実は変わらないからである。再取り込みが走れば同じ鍵で上書きされる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 版が不在・他ノートのもの | `NotFoundError("REVISION_NOT_FOUND")` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| ゴミ箱のノート | `BusinessRuleError(NoteIsTrashed)` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## exportNote

### 概要

ノートを 1 件ダウンロードする（EX-01 / EX-04）。所有者からも閲覧者からも呼ばれる。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `noteId` | `string \| null` | — | 所有者・公開ページからの要求 |
| `shareToken` | `string \| null` | — | 共有リンクからの要求 |
| `userId` | `string \| null` | — | サインイン中なら指定 |
| `pass` | `SharePass \| null` | — | パスワード通過証 |
| `format` | `"html" \| "markdown" \| "pdf"` | ○ | 既知の値 |

`noteId` と `shareToken` はどちらか一方が必須。

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `kind` | `"immediate" \| "job" \| "file"` |
| `fileName` | `string` |
| `mimeType` | `string` |
| `body` | `Uint8Array \| null`（`kind === "immediate"` のとき） |
| `jobId` | `string \| null`（`kind === "job"` のとき） |
| `fileId` | `string \| null`（`kind === "file"` のとき） |
| `ticket` | `string \| null`（`format === "pdf"` のとき必ず返す。署名済み `ExportTicket`。冒頭の「共通: ExportTicket」） |

`kind: "job"` は生成中（`getExportStatus` で進捗を照会する）、`kind: "file"` は生成済み（`downloadExportArtifact` でダウンロードする）を表す。

### 処理フロー

1. `shareToken` があれば共通の共有トークン解決で locator から対象scopeの NoteをIDで引いて hash を照合し、なければ `noteId` の route から対象scopeの `findById` で引く
2. 閲覧者コンテキストを解決し、`granted` でなければ `NotFoundError("NOTE_NOT_FOUND")`。`passwordRequired` なら `ValidationError("SHARE_PASSWORD_REQUIRED")`
3. 本文が `ready` でなければ `ValidationError("NOTE_CONTENT_NOT_READY")`
4. `format` による分岐
   - `html` → `NoteExportComposer.composeSelfContainedHtml` で 1 ファイルにまとめて即時に返す。`resolveAsset` はサービス内のストレージを指す参照だけを解決する。`styleMode === "default"` のときだけ既定スタイルを埋め込む。解決できなかった参照は元の URL のまま残す
   - `markdown` → `MarkdownRenderer.toMarkdown(html)` の結果を即時に返す
   - `pdf` → 次の順に解決する（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。外側の手順との取り違えを避けるため、この分岐の中は **4-a / 4-b / 4-c** と呼ぶ
     - **4-a**: `StoredFileRepository.findArtifactByNoteAndVersion(noteId, note.version, "application/pdf", now)` で期限内・同版の生成物を引く。得られた artifact の残りの保持期間が `ExportTicket` の有効期間（30 分）に余裕を足した長さ以上（`expiresAt >= now + 35 分`）であれば再利用し、`kind: "file"` として `{ kind: "file", fileId }` の `ExportTicket` を発行して返す（ジョブは登録しない）。この下限を満たさないものは再利用せず 4-b へ進む — 発行したチケットが有効なうちに artifact のほうが先に失効し、ダウンロードが `ARTIFACT_EXPIRED` で落ちるため
     - **4-b**: なければ `JobRepository.listActiveByTarget({ type: "note", noteId })` から未終端の `pdfExport` ジョブを探す。あれば新規登録せず、そのジョブへの `{ kind: "job", jobId }` の `ExportTicket` を発行して返す（相乗り。描画は実行時点の版に対して行われる）。複数存在した場合は最も新しい 1 件に相乗りする — 4-b の探索と 4-c の登録は同一トランザクションではないため、同時要求では未終端の `pdfExport` が一時的に複数並びうるが、いずれも同じノートの同じ版から同じ PDF を作るだけなので害はない
     - **4-c**: どちらもなければ `Job.enqueue({ target: { type: "note", noteId }, payload: { kind: "pdfExport" }, scope, kind: "pdfExport", requestedBy, parentId: null })` を登録する。`requestedBy` はサインイン済みなら `userId`、匿名なら `null`（型は `pdfExport` かつ親なしに限られる）。`scope` は要求者ではなく対象ノートの所有文脈から導出する（個人所有なら `{ type: "user", userId: owner.userId }`、ワークスペース所有なら `{ type: "workspace", workspaceId: owner.workspaceId }`。[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。`kind: "job"` とし、`{ kind: "job", jobId }` の `ExportTicket` を発行して返す
5. ファイル名は `NoteTitle` から生成し、使えない文字を置き換える。空になればノート ID を使う

匿名（サインインしていない閲覧者）からの要求のレート制限（IP・ノート単位）は transport 層で行う（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。チケットが失効しても、本ユースケースの再実行で再発行できる（相乗りと再利用により同じ結果に再到達する）。

**`JobConcurrencyPolicy.ensureNoDuplicate` は呼ばない**（手順 4-b）。同じ `kind`・`target` の未終端ジョブを `BusinessRuleError(DuplicateJob)` で弾く振る舞いは、既存ジョブに合流させる相乗りと両立しない（弾いた時点で要求元に返す `jobId` がなくなる）。`requestBackup` / `requestRegeneration` のように「本人の多重要求を業務エラーにしてよい」経路とは要件が違い、こちらは匿名を含む任意の閲覧者が同時に同じノートを要求してよい。したがって未終端ジョブが高々 1 件であることは保証されず、ADR-010 が相乗りに期待する増幅の抑止は最善努力である。同時要求が正確に何倍のレンダリングを起こしうるかを縛るのは transport 層のレート制限と PDF レンダラーの同時実行上限（運用）であり、相乗りはその手前で大半を吸収する層として置く。

**再利用の範囲**（手順 4-a）。EX-01（[scenario/export.md](../scenario/export.md)）の「生成した PDF は一定期間（24 時間）保持し、その間は再生成せずに再ダウンロードできる」は保持期間の**下限**の約束である。したがって再利用に上限（残りの保持期間が短いものだけを返す条件）を課す必要はない — 一括ダウンロードの子（`runBulkExportItem`、TTL 7 日）が作った PDF を返しても、利用者から見た保持期間が約束より長くなるだけで、「その間は再ダウンロードできる」に違反しないためである。以前は `expiresAt <= now + 24 時間` を追加条件にしていたが、これは EX-01 の 24 時間を保持期間の**上限**と読み違えたもので、守る必要のない制約だった。

代わりに課すのは**下限**である。残りの保持期間が `ExportTicket` の有効期間（30 分）に余裕を足した長さ以上（`expiresAt >= now + 35 分`）ある artifact だけを再利用する。上限しか見ていなかったときは、再利用の対象が「残りの保持期間が短いもの」に絞られ、残り数分で失効する artifact まで含まれてしまう。その場合、有効期間 30 分のチケットを返した直後にダウンロードが `ARTIFACT_EXPIRED` で落ちる。しかもこれは 7 日 TTL の子を経由する場合に限らず、通常の 24 時間 TTL の artifact でも生成から 23:30〜24:00 の間に来た要求では必ず起きる。下限はこの窓を塞ぐためのもので、余裕の 5 分は**ダウンロード URL の有効期間**（`ObjectStorage.createDownloadUrl` の `expiresInMs`。正典は [platform/index.md](../platform/index.md) の「転送境界」）と時刻のずれを吸収する。この 2 つは独立に選べない — URL の有効期間を伸ばすなら、この下限も同じだけ伸ばす。代償として、TTL 24 時間の artifact は生成から 23 時間 25 分を過ぎた要求では再利用されず作り直しになる — EX-01 の「再生成せずに」を文字どおり読めばこの末尾 35 分は外れるが、利用者が受け取るのは「少し待って同じ PDF を得る」結果であって失敗ではない。下限を置かなければ同じ窓で「チケットを受け取った直後にダウンロードが失効で落ちる」ことになり、そちらのほうが約束から遠いため、この交換を選ぶ。

条件を満たす artifact が見つからなければ 4-b・4-c に進んで新しいジョブを登録するだけなので、取りこぼしても結果は変わらない（同版の PDF が高々 1 回余分に描画される）。

一方、**要求者をまたぐ再利用は意図した挙動**である。artifact はノートの版だけから決まる純粋な生成物で（本文もスタイルも版が決まれば決まる。`changeNoteStyleMode` も版を進める）、他の利用者が作った PDF を匿名閲覧者に返しても内容は同じものになる。アクセスは要求のたびに `NoteAccessPolicy.evaluate` で再評価されるため、再利用が権限をバイパスすることもない。artifact は容量クォータに算入されない（`sumSizeByOwner` は `purpose: "artifact"` を除外する）ので、他者の所有として保管された行を配っても消費量の帰属は狂わない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| パスワード未通過 | `ValidationError("SHARE_PASSWORD_REQUIRED")` |
| 本文が空（処理中・要 LLM 連携・失敗） | `ValidationError("NOTE_CONTENT_NOT_READY")` |
| 匿名の要求のレート制限（transport 層） | `ValidationError("RATE_LIMITED")` |

## runNoteExport

### 概要

PDF 生成ジョブの本体（EX-01 / EX-04）。ジョブワーカーから呼ばれる。

### 入力DTO

`jobId`, `noteId`

### 出力DTO

`fileId`, `expiresAt`

### 処理フロー

1. ジョブを引き、run 系の共通規則（[usecases/job.md](./job.md)）の判定 1〜3 に従う — 終端状態なら何もせず返す。リース有効な `running` なら何もせず返す。`Job.start` を保存する（リース失効の `running` は引き継いで再開し、`attempts` が上限を超えたら `expire` の結果を保存して終了する）
2. ノートを引く。不在・本文が `ready` でなければ `Job.fail("targetMissing")`
3. `PdfRenderer.render`（Note ドメインのポート）で本文を PDF にする。`styleMode` に従ってスタイルを当てる
4. `ObjectStorage.put` と `StoredFile.registerEphemeral(ttl: 24 時間)` で保管する。`purpose: "artifact"` とし、`noteId` と描画時点の版 `noteVersion` を付ける。`uploadedBy` は `job.requestedBy`（匿名なら `null`）。`owner` はサインイン済みの要求では要求者の個人 subject、匿名ではノートの所有文脈（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）
5. `Job.succeed(artifact)` を保存する。保存が `ConflictError` になったときの扱いは run 系の共通規則の判定 4 に従う

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート不在・本文が空 | `Job.fail("targetMissing")` |
| 描画の失敗・タイムアウト | `Job.fail("unknown")` / `Job.fail("timeout")` |
| 保管の失敗 | `Job.fail("storageError")` |
| 実行中に外部から強制終端された | 保存が `ConflictError` になる。読み直して終端済みなら生成物を破棄して成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる（run 系の共通規則の判定 4） |

## getExportStatus

### 概要

PDF エクスポートの進捗を照会する（EX-01 / EX-04）。`ExportTicket` を提示して呼ばれ、サインインの有無を問わない（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `ticket` | `ExportTicket` | ○ | 署名検証済み（改ざん検知は presentation 層の責務） |
| `userId` | `string \| null` | — | サインイン中なら指定 |
| `shareToken` | `string \| null` | — | 共有リンク経由の閲覧なら指定 |
| `pass` | `SharePass \| null` | — | パスワード通過証 |

### 出力DTO

`status: "queued" | "running" | "succeeded" | "failed" | "canceled"`, `progress: { completed; total } | null`, `failureReason: string | null`, `ticket: string`（`succeeded` のとき `{ kind: "file", fileId }` へ差し替えた新しい署名済みチケット。それ以外は据え置き）

### 処理フロー

1. チケットの有効期間（発行から 30 分）を確認する。失効なら `ValidationError("TICKET_EXPIRED")`（`exportNote` の再実行で再発行できる旨を返す）
2. `ticket.noteId` でノートを引き、閲覧者コンテキストを解決する。`granted` でなければ `NotFoundError("NOTE_NOT_FOUND")` — チケットはアクセスをバイパスしないため、非公開化・削除・リンク再発行はここで遮断される。`passwordRequired` なら `ValidationError("SHARE_PASSWORD_REQUIRED")`
3. `ticket.target` で分岐する
   - `{ kind: "file" }` → 生成済み。`StoredFileRepository.findById(fileId)` で引き、不在・`noteId` がチケットと不一致・期限切れ（`StoredFile.isExpired`）なら `ValidationError("ARTIFACT_EXPIRED")`（`exportNote` の再実行で再生成できる旨を返す。`downloadExportArtifact` の手順 3 と同じ扱いに揃える）。生きていれば `status: "succeeded"` と同じチケットを返す（`downloadExportArtifact` に進める）
   - `{ kind: "job" }` → `JobRepository.findById` で引く。不在なら `NotFoundError("EXPORT_NOT_FOUND")`（`exportNote` の再実行を促す）。`succeeded` なら artifact の `fileId` を **`{ kind: "file" }` の分岐と同じ手順で確かめてから**（`StoredFileRepository.findById` で引き、不在・`noteId` がチケットと不一致・期限切れなら `ValidationError("ARTIFACT_EXPIRED")`）、新しい `{ kind: "file" }` のチケットを発行して返す。それ以外は `status`（`running` なら `progress` も）を返す

**artifact の生死は 2 つの分岐のどちらでも確かめる。** `exportNote` の手順 4-a が課す下限は**チケット発行時点の**保証にすぎず、発行後に artifact が保持期限を迎える、あるいは強制終端の後始末（[usecases/job.md](./job.md) の「共通: 強制終端の後始末」）や所有者の削除（`deleteFilesByOwner`。[usecases/storage.md](./storage.md)）で回収されることはありうる。確かめずに返すと「完了しました」と表示した直後にダウンロードが `ARTIFACT_EXPIRED` で落ちる。

この確認を `{ kind: "job" }` の側にも置くのは、**そちらが新しい 30 分のチケットを発行する側だから**である。`runNoteExport` が artifact を保管してから `Job.succeed` するまでは同一 UoW なので保持期限（24 時間）がチケットに負けることはないが、期限以外の回収経路がある — たとえばワークスペース所有の公開ノートに対する匿名の書き出しでは、`deleteFilesByOwner` と `deleteNotesForOwner` がどちらも 1 バッチ 100 件ずつ `events` キューで進むため、artifact だけが先に回収されてジョブ行が残る窓が開く。この窓で確認を省くと、`succeeded` を表示したうえで到達できないチケットを配ることになる。エラー表の `ARTIFACT_EXPIRED` は両分岐から返りうる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| チケットの失効 | `ValidationError("TICKET_EXPIRED")`（`exportNote` の再実行へ誘導する） |
| ノート不在・権限なし・非公開化・削除 | `NotFoundError("NOTE_NOT_FOUND")` |
| パスワード未通過 | `ValidationError("SHARE_PASSWORD_REQUIRED")` |
| ジョブ不在（履歴の削除後） | `NotFoundError("EXPORT_NOT_FOUND")`（`exportNote` の再実行へ誘導する） |
| artifact の期限切れ・不在・`noteId` の不一致 | `ValidationError("ARTIFACT_EXPIRED")`（`exportNote` の再実行へ誘導する） |

## downloadExportArtifact

### 概要

生成済みの PDF をダウンロードする（EX-01 / EX-04）。`{ kind: "file" }` の `ExportTicket` を提示して呼ばれ、サインインの有無を問わない（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。

### 入力DTO

`getExportStatus` と同じ。ただし `ticket.target` は `{ kind: "file" }` であること。

### 出力DTO

`url: string`（有効期間つきのダウンロード URL）, `fileName: string`, `mimeType: string`

### 処理フロー

1. チケットの有効期間を確認する。失効なら `ValidationError("TICKET_EXPIRED")`。`ticket.target.kind !== "file"` なら `ValidationError("INVALID_TICKET")`
2. `ticket.noteId` でノートを引き、閲覧者コンテキストを解決する。`granted` でなければ `NotFoundError("NOTE_NOT_FOUND")`（毎回の再評価。非公開化・削除・リンク再発行はここで遮断される）。`passwordRequired` なら `ValidationError("SHARE_PASSWORD_REQUIRED")`
3. `StoredFileRepository.findById(fileId)` で引く。不在、`noteId` がチケットと不一致、または期限切れ（`StoredFile.isExpired`）なら `ValidationError("ARTIFACT_EXPIRED")`（`exportNote` の再実行で再生成できる旨を返す）
4. `ObjectStorage.createDownloadUrl` で URL を発行して返す。`expiresInMs` は **5 分**（正典は [platform/index.md](../platform/index.md) の「転送境界」）。この値は独立に選べない — `exportNote` の再利用の下限（`expiresAt >= now + 35 分`）が「`ExportTicket` の 30 分 + この 5 分」として導かれているため、伸ばすなら下限も同じだけ伸ばす

### エラーケース

| 条件 | 種類 |
| --- | --- |
| チケットの失効 | `ValidationError("TICKET_EXPIRED")`（`exportNote` の再実行へ誘導する） |
| チケットの対象が `file` でない | `ValidationError("INVALID_TICKET")` |
| ノート不在・権限なし・非公開化・削除 | `NotFoundError("NOTE_NOT_FOUND")` |
| パスワード未通過 | `ValidationError("SHARE_PASSWORD_REQUIRED")` |
| artifact の期限切れ・不在 | `ValidationError("ARTIFACT_EXPIRED")`（`exportNote` の再実行へ誘導する） |

## requestBulkExport

### 概要

複数のノートをまとめてダウンロードするジョブを登録する（EX-02）。

### 入力DTO

`userId`, `sourceScopeType: "user" | "workspace"`, `sourceScopeId: string`, `noteIds: string[]`, `format: "html" | "markdown" | "pdf"`

### 出力DTO

`jobId`, `targetCount: number`, `skipped: { noteId: string; reason: string }[]`

`skipped` の**構造**（`{ noteId, reason }[]`）は `requestBulkNoteOperation` / `requestBackup`（[usecases/integration.md](./integration.md)）と揃える。対象を ID の並びで受け取る 3 経路は、どれも「一部だけが対象から外れる」ことが常態なので、件数だけでなく**どれがなぜ外れたか**を返す。揃えるのは構造だけで `reason` の**語彙は経路ごとに固有**である（`requestBackup` の `noSourceFile` のように他経路に存在しない値がある）。ただし「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う。本経路の `reason` は `notFound`（`listByIds` の結果に現れなかった ID）/ `permissionDenied`（閲覧権限がない）/ `contentNotReady`（本文が `ready` でない）のいずれか。

### 処理フロー

1. 件数が 500 を超えれば `ValidationError("TOO_MANY_TARGETS")`
2. 入力からsource ScopeKeyを作り、`NoteRouteStore.resolveMany(noteIds)`で全routeを一括解決する。入力scopeと一致する`active` routeだけを対象とし、不在・別scope・`moving` / `purging`は存在を漏らさず`notFound`へ積む
3. その1つのscope DOの `NoteRepository.listByIds` で引き、閲覧できるものだけに絞る。`listByIds` は存在しない ID を単に返さない契約（[domains/note.md](../domains/note.md)）なので、入力の `noteIds` と結果を突き合わせ、引けなかった ID は `reason: "notFound"` として `skipped` に積む。閲覧できないものは `reason: "permissionDenied"`、本文が `ready` でないものは `reason: "contentNotReady"` として `skipped` に積み、対象から外す。指定scope以外のDOへfan-outしない
4. 合計サイズの見積もりが 1 GB を超えれば `ValidationError("EXPORT_TOO_LARGE")`
5. operation ID を採番し、global D1 の `JobSlotStore.reserve(userId, "bulkExport", operationId, 30分)` を呼ぶ。`false` なら `BusinessRuleError(BulkExportInProgress)`。この条件付き INSERT が、異なる workspace scope から同時に要求された場合も利用者につき1件に直列化する
6. 対象 scope の `ScopeUnitOfWorkProvider.run` で、親ジョブ `Job.enqueueBatch(kind: "bulkExport", payload: { kind: "bulkExport", format }, requestedBy: userId, scope, total)` と、対象ノートごとの子ジョブを作って保存する。親子の `scope` は入力の source ScopeKey に固定し、指定scope以外のIDは手順2で `notFound` へ落ちているため混在判定やDO fan-outは行わない

親ジョブと全子ジョブの保存は同じ scope DO の1トランザクションで行い、`job.enqueued` をまとめて収集する。commit 後に `JobSlotStore.attach(operationId, parentJobId)` を呼ぶ。scope-local commit が失敗したら operation ID で slot を解放し、attach の応答を失った場合は同じ operation ID で再試行する。Job の終端 event は Job ID で slot を冪等に解放する。stale reservation は recovery Cron が回収するため、D1 と DO の二重書きに原子性を要求しない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数・サイズの上限超過 | `ValidationError("TOO_MANY_TARGETS")` / `ValidationError("EXPORT_TOO_LARGE")` |
| 対象が 0 件 | `ValidationError("NO_EXPORTABLE_TARGET")` |
| 一括ダウンロードが既に実行中 | `BusinessRuleError(BulkExportInProgress)` |

## runBulkExportItem

### 概要

一括ダウンロードの子ジョブ 1 件 — 1 ノートを指定の形式で書き出す（EX-02）。ジョブワーカーから呼ばれる（[ADR 012](../adr/012-job-execution-resilience.md)）。

### 入力DTO

`jobId`, `noteId`（ジョブの `target` から）, `format: "html" | "markdown" | "pdf"`（`payload.format` から）

### 出力DTO

`outcome: "succeeded" | "failed"`, `fileId: string | null`

### 処理フロー

1. ジョブを引き、run 系の共通規則（[usecases/job.md](./job.md)）の判定 1〜3 に従う — 終端状態なら何もせず返す。リース有効な `running` なら何もせず返す。`Job.start` を保存する（リース失効の `running` は引き継いで再開し、`attempts` が上限を超えたら `expire` の結果を保存して終了する）
2. ノートを引き、要求者の権限を再確認する。不在・ゴミ箱・本文が `ready` でなければ `Job.fail("targetMissing")`、権限を失っていれば `Job.fail("permissionRevoked")`
3. `payload.format` で分岐して生成する
   - `html` → `NoteExportComposer.composeSelfContainedHtml`（`exportNote` の同期分岐と同じ規則）
   - `markdown` → `MarkdownRenderer.toMarkdown(html)`
   - `pdf` → `PdfRenderer.render`（`styleMode` に従う）
4. `ObjectStorage.put` と `StoredFile.registerEphemeral(ttl: 7 日)` で保管する（ZIP と同じ期限に揃え、親の組み立て・子の再試行の間も生存させる）。`purpose: "artifact"` とし、`noteId` と生成時点の版 `noteVersion` を付ける。`uploadedBy: job.requestedBy`、`owner` は要求者の個人 subject。この 7 日保持の artifact は `exportNote` の再利用の対象になる — 再利用側が課すのは残りの保持期間の**下限**だけであり、EX-01 の 24 時間は保持期間の下限の約束なので、それより長く残る生成物を単体エクスポートに返しても約束に反しないためである（`exportNote` の「再利用の範囲」）
5. `Job.succeed(artifact)` を保存する。保存が `ConflictError` になったときの扱いは run 系の共通規則の判定 4 に従う。親の進捗更新は `job.succeeded` を購読する `updateBatchProgress` が行う

手順 4 の `StoredFile.registerEphemeral` と手順 5 の `Job.succeed` は**同一の `UnitOfWorkProvider.run`** で保存する。artifact の行が存在することと子が `succeeded` であることを同時に確定させるためで、これがないと「保管済みだが `Job.succeed` 前」の子が生まれ、強制終端の後始末が `succeeded` で絞る回収（[usecases/job.md](./job.md) の「共通: 強制終端の後始末」の 2）から漏れる — 除名・脱退でアクセス権を失った利用者の手元に、ワークスペースのノート本文を含む生成物が 7 日残ることになる。オブジェクトストレージへの `ObjectStorage.put` だけは UoW の外で先に行い、UoW がロールバックした場合はメタデータのない孤児オブジェクトとして残る（参照されないため害はない。[domains/storage.md](../domains/storage.md) の削除順序と同じ整理）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート不在・ゴミ箱・本文が空 | `Job.fail("targetMissing")` |
| 権限を喪失 | `Job.fail("permissionRevoked")` |
| 生成の失敗・タイムアウト | `Job.fail("unknown")` / `Job.fail("timeout")` |
| 保管の失敗 | `Job.fail("storageError")` |
| 実行中に外部から強制終端された（親のキャンセルなど） | 保存が `ConflictError` になる。読み直して終端済みなら生成物を破棄して成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる（run 系の共通規則の判定 4） |

## runBulkExport

### 概要

一括ダウンロードの親ジョブの実行体 — すべての子の終了後に ZIP を組み立てる（EX-02 / EX-03）。全子終端時に `updateBatchProgress` が発行する `job.readyToAssemble` の購読ハンドラーが親ジョブをキューへディスパッチして起動する（親ジョブの完了経路はこの 1 本のみ。[ADR 012](../adr/012-job-execution-resilience.md)）。組み立てだけをやり直す `retryJob` の `Job.reopenBatch`（全子終端・成功 1 件以上のとき）も同じイベントを発行し、同じ経路で起動する。

本ユースケースは run 系の共通規則（[usecases/job.md](./job.md)）の**対象外**で、同じ文書の「共通: batch 親の組み立て規則」に従う。親は `enqueueBatch` の時点で既にリース付きの `running` であり、`Job.start` を呼ぶ余地がない（共通規則をそのまま当てると「リース有効な running」に必ず該当して ZIP が組み立てられない）。再入防止は下記手順 3 の `Job.beginAssembly` が担う。

### 入力DTO

`parentJobId`

### 出力DTO

`fileId`, `expiresAt`, `includedCount`, `failedCount`

### 処理フロー

1. 親ジョブを引き、終端状態（`succeeded` / `failed` / `canceled`）なら何もせず返す（再配送の重複、および組み立て完了後の再配送）
2. `JobRepository.summarizeChildren` を引く。未終端の子が残っていれば何もせず返す（子の再試行などで進行中に戻っている。組み立ては次の全子終端で改めて起動される）。成功した子が 0 件なら何もせず返す（`updateBatchProgress` が他 kind と同じ規則で親を `failed` / `canceled` にする）
3. `Job.beginAssembly(parent, now, leaseUntil)` を適用して保存し、組み立ての実行権を取る（[domains/job.md](../domains/job.md)）。`attempts` を 1 増やして組み立てのリースを張り直し、これ以降の重複配送を弾く。手順 1・2 だけでは全子終端後の重複配送を排除できない（親は終端しておらず、子はすべて終端しているため両方の判定を通過してしまう）ので、この手順が親の再入防止の本体になる
   - `attempts >= 1` かつリースが有効なら別のワーカーが組み立て中のため `BusinessRuleError(LeaseActive)` になるので、何もせず返す
   - 加算後に再試行上限を超えた場合、`beginAssembly` は `expire` の結果（`failed`、`reason: "timeout"`）を返すので、それを保存して終了する
   - 保存が `ConflictError` になったらジョブを読み直し、終端済みまたは組み立て中（`attempts >= 1` かつリース有効）なら何もせず返す。同時配送はここで一方だけが実行権を得る
4. 成功した子の生成物（artifact）を集め、ZIP に詰める。ファイル名が重複する場合は連番を付ける。組み立てが長引く間は `Job.renewAssemblyLease(parent, now, leaseUntil)` を適用して保存し、組み立てのリースを延長する（`Job.reportProgress` ではない。組み立て中の親（`attempts >= 1`）の期限を動かせるのは実行権を持つこのワーカーだけである。[domains/job.md](../domains/job.md) の「組み立て中の親のリース」）
5. 失敗した対象の一覧をテキストとして同梱する
6. `ObjectStorage.put` と `StoredFile.registerEphemeral(ttl: 7 日)` で保管する。`purpose: "artifact"` とし、単一ノート由来でないため `noteId` / `noteVersion` は `null`。`uploadedBy: job.requestedBy`、`owner` は要求者の個人 subject
7. `Job.succeed(artifact)` を保存する。保存が `ConflictError` になったときの扱いは run 系の共通規則の判定 4 と同じ（読み直して終端済みなら生成物を破棄して成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる）
8. 実行中に削除されたノートは除外して続行する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未終端の子が残っている | 何もせず返す（次の全子終端で `updateBatchProgress` が改めて `job.readyToAssemble` を発行する） |
| 成功した子が 0 件 | 何もせず返す（`updateBatchProgress` が他 kind と同じ規則で親を `failed` / `canceled` にするため、通常は起動しない） |
| 別のワーカーが組み立て中 | 何もせず返す（`Job.beginAssembly` の `BusinessRuleError(LeaseActive)` を吸収する） |
| 実行権の取得が版の競合 | ジョブを読み直し、終端済みまたは組み立て中なら何もせず返す |
| 組み立ての再試行が上限に達した | `Job.beginAssembly` が返す `expire` の結果（`failed`、`reason: "timeout"`）を保存して終了する |
| 組み立て中に外部から強制終端された | `Job.succeed` の保存が `ConflictError` になる。読み直して終端済みなら生成物を破棄して成功として返す（run 系の共通規則の判定 4） |
| 組み立て中のワーカーの停止 | 組み立てリースが失効し、再配送された `job.readyToAssemble` を `Job.beginAssembly` が引き継ぐ。届かなければ `reapExpiredJobs` が `failed`（`timeout`）として回収し、手動の `retry`（`retryJob` の `reopenBatch` 分岐）で組み立てからやり直せる |
| ZIP 生成・保管の失敗 | `Job.fail("storageError")` |

## requestBulkNoteOperation

### 概要

複数のノートに対する一括操作を登録する（OR-09）。タグ・公開ステータス・移動・削除を扱う。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `sourceScopeType` / `sourceScopeId` | `string` | ○ | 操作元の1文脈 |
| `noteIds` | `string[]` | ○ | 1〜500 件 |
| `operation` | `BulkOperation` | ○ | 下記の判別ユニオン |

```
BulkOperation =
  | { kind: "addTag"; tagName: string }
  | { kind: "removeTag"; tagName: string }
  | { kind: "changeVisibility"; visibility: "private" | "unlisted" | "public" }
  | { kind: "move"; targetOwnerType: "user" | "workspace"; targetWorkspaceId: string | null }
  | { kind: "trash" }
  | { kind: "purge" }        // ゴミ箱の完全削除。emptyTrash が 500 件を超える場合に使う内部専用の値（転送境界に露出しない。手順 3）
```

### 出力DTO

`jobId`, `targetCount: number`, `skipped: { noteId: string; reason: string }[]`, `warnings: string[]`

### 処理フロー

1. 件数の上限を確認する
2. 入力source scopeを組み立て、`NoteRouteStore.resolveMany(noteIds)`で全routeを一括確認する。不在・別scope・`moving` / `purging`は`notFound`とし、その1つのscope DOの `NoteRepository.listByIds` で操作に必要な権限（`canEdit` / `canChangeVisibility` / `canDelete`）を確認する。指定scope以外のDOへfan-outしない
3. 操作ごとの事前検査を行う
   - `purge` → ゴミ箱在籍の事前検査は行わない。`{ kind: "purge" }` は `emptyTrash` からの委譲専用で、**転送境界には露出しない**（`BulkOperation` のうち画面から選べるのは `addTag` / `removeTag` / `changeVisibility` / `move` / `trash` の 5 つで、`serverAction` の `inputValidator` は `purge` を受け付けない）。対象は `emptyTrash` が `listByOwner(owner, "trashed", …)` で集めた行に限られ、実行時には `runBulkNoteOperationItem` から呼ぶ `purgeNote` がゴミ箱在籍を検査して `ValidationError("NOTE_NOT_TRASHED")` を返す
   - `changeVisibility: "public"` → 各ノートの所有文脈で検査する（個人所有は `owner.userId` の利用者の公開ハンドル、ワークスペース所有は所有ワークスペースの公開スラッグ。`createdBy` は用いない）。未設定なら全体を中止して `ValidationError("PUBLIC_HANDLE_REQUIRED")`
   - `move` → 移動先の権限を確認し、移動で閲覧できなくなる利用者が出る場合と外れるタグがある場合を `warnings` に載せる。移動先の容量クォータは `moveNote` と同じく検査しない（クォータの強制は取り込み時のみ。意図的な設計）
4. 親ジョブ `Job.enqueueBatch(kind, payload, requestedBy: userId, scope, total)` と、対象ノートごとの子ジョブ（`Job.enqueue`。親と同じ `kind` / `payload`、`target: { type: "note", noteId }`、`parentId` は親、`scope` は下記）を作って保存する。`kind` と `payload` は `operation.kind` から決まる（[domains/job.md](../domains/job.md) の登録経路と `kind` / `payload` の対応。`addTag` / `removeTag` → `bulkTag`、`changeVisibility` → `bulkVisibility`、`move` → `bulkMove`、`trash` / `purge` → `bulkDelete`。`BulkOperation` で失われる区別は `payload` が持つ）
5. 親子の `scope` は入力の source ScopeKey に固定する。指定scope以外のIDは手順2で `notFound` へ落ちているため混在判定やDO fan-outは行わない。`move` でも Job scope は移動元に固定する
6. 対象が 1 件だけの場合もジョブとして扱い、経路を 1 本にする

親ジョブと全子ジョブの保存は `requestBulkExport` と同じく同一の `UnitOfWorkProvider.run` で行い、`job.enqueued` をまとめて収集する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数の上限超過 | `ValidationError("TOO_MANY_TARGETS")` |
| 対象が 0 件（すべて権限外） | `BusinessRuleError(AccessDenied)` |
| 公開ハンドル未設定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")` |
| 未知の操作 | `ValidationError("INVALID_OPERATION")` |

## runBulkNoteOperationItem

### 概要

一括操作の子ジョブ 1 件を実行する（OR-09）。ジョブワーカーから呼ばれる。

### 入力DTO

`jobId`, `noteId`（ジョブの `target` から）, `userId`（要求者）, `operation: BulkOperation`（`payload` から）

キューが運ぶのは `jobId` と `kind` だけなので、`noteId` / `userId` / `operation` は呼び出し側（ジョブのディスパッチャー）が `JobRepository.findById(jobId)` で引いた行から取る — `noteId` は `job.target`（`{ type: "note", noteId }`）、`userId` は `job.requestedBy`（一括操作は匿名ジョブになりえないため必ず非 `null`。[domains/job.md](../domains/job.md) の `JobAttribution`）、`operation` は `job.payload`。手順 2 の権限の再確認も、手順 3 で呼ぶ各ユースケース（いずれも `userId` を必須で取る）に渡す要求者も、この `job.requestedBy` であって実行時点の誰かではない（`importExternalReferences`（[usecases/storage.md](./storage.md)）と同じ扱い）。

### 出力DTO

`outcome: "succeeded" | "failed"`, `failureReason: string | null`

### 処理フロー

1. ジョブを引き、run 系の共通規則（[usecases/job.md](./job.md)）の判定 1〜3 に従う — 終端状態なら何もせず返す。リース有効な `running` なら何もせず返す。`Job.start` を保存する（リース失効の `running` は引き継いで再開し、`attempts` が上限を超えたら `expire` の結果を保存して終了する）
2. ノートを引き、要求者（`userId`）の権限を再確認する。失っていれば `Job.fail("permissionRevoked")`
3. 操作に応じて `assignTag` / `unassignTag`（Tag）、`changeNoteVisibility`、`moveNote`、`trashNote`、`purgeNote` を、要求者を `userId` として呼ぶ。`removeTag` だけは引数の解決が要る — `payload` が持つのは `tagName` だが `unassignTag` が取るのは `tagId` なので、対象ノートの所有文脈から `TagScope.fromNoteOwner(note.owner)` でスコープを導き、`TagName.create(tagName)` の正規化名で `TagRepository.findByScopeAndName(scope, normalized)` を引いて `tagId` を解決する（`assignTag` は `tagName` を取るため `addTag` にこの解決は要らない）。そのスコープに同名のタグがなければ外すべき付与も存在しないため、`unassignTag` を呼ばず成功として扱う（手順 5 の冪等の扱いと同じ）。`trash` では `trashNote` に `excludingJobId: jobId`（この子ジョブ自身の ID）を渡す — 渡さないと `trashNote` の手順 2 が自分自身を `Job.cancel` し、成功した操作が `canceled` として集計される（「共通: ユースケースを合成するときの副作用の範囲」）。`move` で `moveNote` が `NotFoundError("WORKSPACE_NOT_FOUND")` を返した場合は `Job.fail("targetMissing")` に写す。`bulkMove` の `scope` は移動**元**の文脈で固定される（`requestBulkNoteOperation` の手順 5）ため、個人 → ワークスペースの一括移動は移動先ワークスペースの削除・除名によるキャンセル網に載らない。登録から実行までの間に移動先が消えているのはこの経路の想定内の分岐であり、`unknown` ではなく対象不在として扱う
4. `Job.succeed` または `Job.fail` を保存する。保存が `ConflictError` になったときの扱いは run 系の共通規則の判定 4 に従う（読み直して終端済みならジョブを書き換えず成功として返す。操作は適用済みだが、外部からの強制終端が優先される）
5. 既に目的の状態になっている場合は成功として扱う（同じジョブを 2 回受け取っても結果が変わらない）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが削除済み | `Job.fail("targetMissing")` |
| `move` の移動先ワークスペースが存在しない | `Job.fail("targetMissing")`（`moveNote` の `NotFoundError("WORKSPACE_NOT_FOUND")` を写す） |
| 権限を喪失 | `Job.fail("permissionRevoked")` |
| ドメインの規則違反（本文が空で公開など） | `Job.fail("unknown")`（理由を `detail` に記録） |
| ノートの版の競合 | 1 度だけ読み直して再適用し、それでも競合すれば `Job.fail("unknown")` |
| ジョブ保存の版の競合（実行中に外部から強制終端された） | 読み直して終端済みならジョブを書き換えず成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる（run 系の共通規則の判定 4） |

## listSitemapEntries

### 概要

サイトマップ用に公開ノートを列挙する（DS-06）。利用者とワークスペースの公開ページは `listPublicProfiles`（Identity）と `listPublicWorkspaces`（Workspace）が列挙する。

### 入力DTO

`cursor: string | null`, `limit: number`

### 出力DTO

`entries: { noteId; updatedAt }[]`, `nextCursor: string | null`

### 処理フロー

1. global D1 の `PublicNoteQueryService.listPublicSitemapEntries` を呼ぶ。cursorはpublic shard generationと各shardのkeysetを含むopaque値で、最大32 shardを同時6接続のwaveで読み全体limitへmergeする

### エラーケース

`SystemError(DatabaseError)`

## projectNoteChanges

### 概要

ドメインイベントを受け取って読み取りモデルを更新する（[ADR 009](../adr/009-read-models.md)）。`target: "local"` は event を生んだ scope DO の Alarm task、`target: "public"` は global projection Queue から呼ばれる。

書き手はplaneごとに1つである。localは各scope DO、publicはnote coordination shard writerだけが書き、route/Note/tag/author/workspaceの世代ベクトルで古い配送とread-write競合を拒否する。

### 入力DTO

`target: "local" | "public"`, `scope: ScopeKey | null`, `event: NoteEvent | TagEvent | IdentityEvent | WorkspaceEvent | ProjectionRequest`

```ts
type ProjectionRequest =
  | { type: "projection.reprojectRequested"; noteId: NoteId; expectedRouteVersion?: number }
  | { type: "projection.tagFanOutContinued"; tagId: TagId; afterNoteId: NoteId | null }
  | { type: "projection.authorRefreshRequested"; userId: UserId; identityVersion: number; afterNoteId: NoteId | null }
  | { type: "projection.authorRouteFanOutContinued"; userId: UserId; identityVersion: number; cursor: string }
  | { type: "projection.workspaceRouteFanOutContinued"; workspaceId: WorkspaceId; workspaceVersion: number; cursor: string }
  | { type: "projection.authorRedactionRequested"; noteId: NoteId; userId: UserId; redactionVersion: number; operationId: string };
```

これらはドメインイベントではなく、投影処理への要求である。継続要求の規約は [domains/index.md](../domains/index.md) に従う。`projection.reprojectRequested` は `rebuildNoteProjection` とタグのファンアウトが積み、`projection.tagFanOutContinued` はタグのファンアウトが自分の続きとして積む。`projection.authorRedactionRequested` はaccount deletionがfinalize前の消去ackを得るために積む。

### 出力DTO

なし。

### 処理フロー

1. plane を検証する。`local` は `scope` 必須で、その scope object の repository / writer だけを使う。`public` は `scope = null` とする。NoteIdを持つnote-scoped event/requestだけが`NoteRouteStore`でcurrent scopeを解決してsnapshotを読む。Identity/Workspace eventとroute fan-out continuationは先に下記reader分岐へ入り、NoteId解決を要求しない。note-scoped routeが`purging` / `tombstone`、またはsnapshotがprivate / trashed / purgedならpublic行を削除する
2. イベントの種別で分岐する
   - `note.created` / `note.contentUpdated` / `note.conversionFailed` / `note.awaitingIntegration` / `note.renamed` / `note.styleModeChanged` / `note.visibilityChanged` / `note.moved` / `note.trashed` / `note.restored` → current routeと全sourceのcurrent versionを読み、local/publicとも世代ベクトル付き`replaceSnapshotIfNewer`で置換する
   - `note.purged` → `deletionOperationId`が非nullのlocal処理は`ScopeCleanupAdmissionStore.assertOwner`を通す。localはremove、publicはpayloadの内部operation ID / routeVersion / projectionRevisionで`removeForPurge`を呼び、public 3表の削除をatomicにする（ack行は契約しない）。move元の遅延eventはrouteVersion不一致で無視する
   - `tag.assigned` / `tag.unassigned` → Note・タグ・projectionRevisionを同じscope read transactionで引き直す。publicは完全snapshotをrevision条件付きで置換する
   - `tag.renamed` → 対象ノートを `TagAssignmentRepository.listByTag(tagId, { afterNoteId: null, limit: 200 })` で1ページだけ列挙し、1件につき決定的IDのlocal `projection.reprojectRequested`と、routeVersionを持たないpublic `publicProjection.reprojectRequested` outboxを同じscope UoWへ積む。200件なら `projection.tagFanOutContinued` を積む
   - `tag.merged` / `tag.deleted` / `tag.unusedBatchDeleted` → 完了監査だけなので投影しない。merge/delete operationは各200件pageでassignment変更・projection revision bump・個別再投影taskを同一UoWへ保存済みである
   - `projection.tagFanOutContinued` → 上と同じ列挙を `{ afterNoteId, limit: 200 }` で続きから行う。**tag assignmentを処理する継続の中でこの経路だけがカーソルを持つ**。再投影要求を積んでも対象行が検索結果から外れず、先頭から読み直すと同じページを永遠に読むためである。カーソルは**キーセット**であって `OFFSET` ではない（[domains/tag.md](../domains/tag.md) の `listByTag`、[domains/index.md](../domains/index.md) の「継続要求」）
     - **0 件で返ったら継続を積まずに成功として返る。** 付与の件数がちょうど 200 の倍数のとき最後のページが空になるのが正常な終わり方であり、これを「進捗がないから失敗させる」と扱うと、正常完了を task failure として通知してしまう（[domains/index.md](../domains/index.md) の「継続要求」）。カーソルを持つこの経路では、空ページは失敗ではなく終端の合図である
     - ファンアウトの進行中にタグそのものが削除された場合も同じ経路で止まる。`deleteTag` は付与を FK CASCADE で消すため、次のページが 0 件になって継続が終わる
   - `projection.reprojectRequested` → current route、Note/tag、version付きIdentity/Workspace current stateを読み、local/publicとも `replaceSnapshotIfNewer` 1回で投影を作り直す。public requestに`expectedRouteVersion`がある場合だけcurrent routeとの不一致を古い要求として捨てる。tag pageのようにscope UoW内でrouteVersionを得られない要求はこれを省略し、global consumerが配送時のcurrent routeを解決してcurrent scope snapshotを投影する。旧scopeの遅延要求も移動先のcurrent stateを再投影するだけなので退行しない。writerが`incomparable`を返したら全sourceを読み直して1回再試行する
   - `projection.authorRedactionRequested` → current routeを再解決する。purged/tombstoneならその結果を確認してuser coordination shardへackする。存続Noteでは`createdBy = userId`を確認し、著者を `{ displayName: "退会した利用者", handle: null }`、authorVersionを`redactionVersion`とした完全snapshotをlocal/publicのwriterで先に確定する。writer成功応答後にだけ別requestでuser coordination shardへplane別ackする。ack応答を失った場合は同じ要求を再実行し、保存済みredactionVersion以上なら投影writeをno-opにしてackを再送する。ack先行やcross-shard transactionは要求しない。move中やrouteVersion不一致はcurrent routeへ再配送し、別作成者なら不正要求として失敗させる

`tag.renamed` の各ページでは、対象NoteごとのprojectionRevision bump、local再投影task、public Queueへrelayするoutbox requestを同じscope-local transactionで行う。merge/deleteは各operation page自身が同じことを行う。local/publicのtask IDはいずれも生成元operation/event ID・NoteId・projectionRevisionから決定的に導出し、kindが異なるため互いに衝突しない。

**タグのファンアウトが投影を直接書かないのはなぜか。** 1 つのタグに付いたノート数に上限はなく、直接投影すると1 Alarm turn の CPU時間と event fan-out が対象件数に比例する。1ページ200件で local task を継続し、public 対象だけを個別Queue messageへ渡すことで、scope 間の並列性を保ったまま各実行の仕事量を一定にする。
   - `identity.user.handleChanged` / `identity.user.profileUpdated` / `identity.user.deleted` → `NoteRouteFanOutReader.listByCreatedBy(userId, opaqueCursor, 200)`で全note shard合計200 routeを読む。各Noteへpublic `projection.reprojectRequested` を送り、同じpage内のscopeを重複排除して最大6 RPC並行でlocal `projection.authorRefreshRequested` を送る。次cursorがあればglobal continuationへ載せる。membership離脱済みworkspaceもrouteから発見できる。deleted Identityはversion付きtombstoneの「退会した利用者」を解決する
   - `projection.authorRouteFanOutContinued` → payloadのopaque cursorを`listByCreatedBy`へ渡し、上と同じpage処理を続ける。nextCursorがなくなるまで同じidentityVersionを運ぶ
   - local `projection.authorRefreshRequested` → current scopeの `note_search_created_by_note_idx` を200件ずつキーセットで読み、各Noteへlocal再投影taskを積む。200件なら同じscopeのcontinuationを積む。identityVersion以下の重複commandはno-opにする
   - `workspace.slugChanged` / `workspace.published` / `workspace.unpublished` / `workspace.profileUpdated` → `NoteRouteFanOutReader.listByScope(scope, opaqueCursor, 200)`で全note shard合計200件ずつ読み、各Noteへpublic再投影、workspace scopeへlocal再投影pageを積む。payloadの表示値ではなくversion付きcurrent Workspace snapshotを使う
   - `projection.workspaceRouteFanOutContinued` → payloadのopaque cursorを`listByScope`へ渡し、上と同じpage処理を続ける。nextCursorがなくなるまで同じworkspaceVersionを運ぶ
   - `workspace.created` は購読しない。`createWorkspace` はノートを 1 件も作らず個別再投影の対象routeが0件だからである。同じ理由で `identity.user.created` も購読しない
   - 上記に現れない Note のイベント（`note.published` / `note.shareLinkReissued` / `note.sharePasswordChanged`）は購読しない。`note.published` は `note.visibilityChanged` と必ず併発するため投影は後者だけで足り、それ自身は監査用に残る（サイトマップも読み取りモデルから引くため専用の受け手を持たない。`listSitemapEntries`）。残る 2 つは投影列を 1 つも変えない
3. どの分岐もcurrent routeとatomic snapshotを読む。重複・逆順・move前scopeの遅延配送はprocessed eventと世代ベクトルでno-opになる。ベクトルがincomparableなら再読込するため、Note/tagとIdentity/Workspaceの並行更新も退行しない

`note_search` 本体・タグ表・FTS 索引の同期は writer adapter の責務で、local は DO の `transactionSync()`、public は `replaceSnapshotIfNewer` の D1 `batch()` でアトミックに書く。本体・タグ・著者・workspaceを別writerへ分けない（[domains/note.md](../domains/note.md)、[database/index.md](../database/index.md)）。

本文状態（`content_status`）とスタイル（`style_mode`）は `upsert` でしか更新されない。`note.awaitingIntegration` / `note.styleModeChanged` を購読しないと、`runConversion` が `processing → awaitingIntegration` に遷移させても投影は `processing` のまま残り、`countByContentStatus` を根拠とする `completeIntegrationOAuth`（[usecases/integration.md](./integration.md)）の「要 LLM 連携の N 件」の案内が常に 0 件になる。ED-11 のスタイル切り替えも一覧に反映されない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象が既に削除済み | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## rebuildNoteProjection

### 概要

読み取りモデルを書き込みモデルから作り直す運用操作。local plane は指定した1つの scope object、public plane は global D1 の route 台帳を入口にする。全 Durable Object を列挙するAPIには依存しない。

### 入力DTO

`plane: "local" | "public"`, `scope: ScopeKey | null`, `batchSize: number`（既定 100）, `sweepOrphans: boolean`（既定 `true`）

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `requestedCount` | `number` |
| `sweptCount` | `number` |

`requestedCount` は再投影を要求した件数である。local の進捗は scope の `scheduled_tasks`、public の進捗は global projection Queue で見る。

### 処理フロー

1. `plane = "local"` は `scope` 必須。`ScopeRouter` で対象 object を呼び、`NoteRepository.listByOwner(scope, "all", pagination)` を読む。NoteId ごとの local `projection.reprojectRequested` を `scheduled_tasks` に積む
2. `plane = "public"` は `scope = null`。global D1 の `note_routes` を NoteId のキーセットカーソルで読み、active route ごとに `expectedRouteVersion` 付きの public `projection.reprojectRequested` を Queue へ積む。対象 DO が移動中でも consumer が current route を再解決する
3. `sweepOrphans` が真なら、local は対象 scope の local projectionだけを正データと突合する。public は `public_note_search` を `note_routes` と突合し、route がない・tombstone・route version が古い行を削除する

投影の実体は `projectNoteChanges` が担う。local/publicとも本体・tags・FTS・version付き表示contextをまとめる `replaceSnapshotIfNewer` で再構築する。

FTS 表そのものを作り直す場合（前処理関数を変えたときなど）は、先に表を再作成してから本ユースケースを走らせる。`INSERT INTO note_search_fts(note_search_fts) VALUES('rebuild')` は contentless 構成では使えない（[ADR 017](../adr/017-content-size-budget.md)）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の失敗 | 記録して継続 |
