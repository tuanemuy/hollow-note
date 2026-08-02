# ユースケース: Note

ドメインの詳細は [domains/note.md](../domains/note.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## 共通: 閲覧者コンテキストの解決

ノートに触れるすべてのユースケースは、先頭で次を行う。

1. `NoteId.create(input.noteId)` を構築する
2. `NoteRepository.findById` で引く。不在なら `NotFoundError("NOTE_NOT_FOUND")`
3. ノートの所有者がワークスペースなら `resolveWorkspaceAccess`（Workspace）でロールを引き、`NoteViewer` を組み立てる
4. `NoteAccessPolicy.evaluate(note, viewer, credential, now)` を呼び、必要な権限がなければ `NotFoundError("NOTE_NOT_FOUND")`（存在を漏らさない）

以下の各ユースケースでは、この手順を「閲覧者コンテキストを解決する」と記す。

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
| `ownerWorkspaceId` | `string \| null` | — | `ownerType === "workspace"` のとき必須 |
| `title` | `string \| null` | — | `NoteTitle` の規則 |

### 出力DTO

`noteId`, `title`, `ownerType`, `ownerId`, `visibility`, `styleMode`, `createdAt`

### 処理フロー

1. `NoteOwner` を組み立てる。ワークスペースなら `WorkspaceAuthorization.ensureCan(role, "createNote")`
2. `title` が空なら `NoteTitle.auto("無題")`、指定があれば `NoteTitle.manual(title)`
3. `Note.createBlank` を作り、`UnitOfWorkProvider.run` で保存してイベントを収集する

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
3. `shareUrl` は `canChangeVisibility` が真の閲覧者にのみ含める
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

1. `SecureTokenGenerator.hashOf(shareToken)` を求め、`NoteRepository.findByShareToken` で引く。不在なら `NotFoundError("NOTE_NOT_FOUND")`
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
3. 手順 1 のハッシュで `NoteRepository.findByShareToken` を引き、限定公開かつパスワードが設定されていることを確認する
4. `PasswordHasher.verify` が偽なら、`LoginAttemptStore.recordFailure(key, now, LoginThrottlePolicy.attemptTtlMs)` で失敗を**原子的に**記録して `ValidationError("INVALID_SHARE_PASSWORD")`。返ってきた加算後の記録を `evaluate` し、次が待機・ロックに当たるなら `ValidationError("THROTTLED")` に切り替える
5. `LoginAttemptStore.clear(key)` で失敗の記録を消し、`NoteAccessPolicy.issuePass(shareLink, now)` の結果を返す

鍵の名前空間（`share:`）がサインインの記録（`signIn:`）と分かれているため、共有リンクの照合失敗がサインインのロックを誘発することはない。読み書きの順序は `LoginThrottlePolicy` の「読み書きの分担」に従う（`signInWithPassword`（[usecases/identity.md](./identity.md)）と同じ）。

**手順 4 の加算が原子的であることは、この施錠が意味を持つための前提である**（[ADR 020](../adr/020-coordination-state.md)）。手順 2 の `get` は古い値を読みうるが、判定が緩む方向に外れてもその試行の失敗は手順 4 で必ず数えられるため、施錠は追いつく。逆に手順 4 が「読んでから書く」形だと、要求を並列化するだけで失敗回数がほとんど増えず、施錠を丸ごと回避できる。

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
| `ownerWorkspaceId` | `string \| null` | — | — |
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
4. `NoteQueryService.search` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー・権限不足 | `BusinessRuleError(InsufficientRole)` |
| 検索のタイムアウト | `SystemError(TimeoutError)` |
| ページング値の範囲外 | `ValidationError("INVALID_PAGINATION")` |

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
| `page`, `limit` | `number` | ○ | `limit` は 1〜100 |

`keyword` の 2 文字下限は転送境界で `null` に落とす形で効かせる。エラーにはしない — 落とした結果として条件が 1 つも残らなければ、処理フローの手前で `QUERY_TOO_SHORT`（`ownerFilter` 未指定のとき）になる。bigram 方式では 2 文字から検索が成立する（[ADR 011](../adr/011-bigram-search.md)）ため、この下限は「1 文字では母集合が絞れない」ことに由来する上限側の防御であり、`searchNotes` と同じ値・同じ落とし方に揃える。

期間の絞り込みは**更新日時**に対する範囲で、`updatedTo` は指定日を含む（境界の解決は処理フロー 3）。

### 出力DTO

`items: PublicNoteSummary[]`, `count: number`

### 処理フロー

1. `ownerHandle` があれば利用者を、`workspaceSlug` があれば公開ワークスペースを解決して `ownerFilter` を組み立てる
2. `tagNames` は `searchNotes` と同じく `TagName` の正規化規則で正規化してから渡す
3. `updatedFrom` / `updatedTo` のどちらかがあれば `updatedWithin: DateRange` に解決する。基準列は読み取りモデルの更新日時（`note_search.updated_at`）で、`from` は `updatedFrom` の 0 時、`toExclusive` は `updatedTo` の翌日 0 時（指定日を含める）。`searchNotes` と違い閲覧者のタイムゾーンを持てない（サインイン不要の経路）ため、境界は UTC で解決する。片方だけの指定は、欠けた側を範囲の端（`from` は epoch、`toExclusive` は十分先の未来）で埋める
4. `NoteQueryService.searchPublic` を呼ぶ

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
3. `NoteQueryService.listMonthsWithNotes` と `countByDay` を呼ぶ

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

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `Note.rename` を適用して保存する（由来は `manual`）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
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

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `Note.changeStyleMode` を適用して保存し、`note.styleModeChanged` を収集する（読み取りモデルの `style_mode` はこのイベント経由の `projectNoteChanges` でのみ更新される）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未知の値 | `BusinessRuleError(InvalidStyleMode)` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## moveNote

### 概要

ノートの所属先を移す（OR-12）。

### 入力DTO

`noteId`, `userId`, `targetOwnerType: "user" | "workspace"`, `targetWorkspaceId: string | null`, `expectedVersion: number`

### 出力DTO

`noteId`, `ownerType`, `ownerId`, `droppedTagNames: string[]`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する。権限がなければ共通規約どおり `NotFoundError("NOTE_NOT_FOUND")`（存在を漏らさない）
2. 移動先の `NoteOwner` を組み立て、ワークスペースなら `WorkspaceRepository.findById` で実在を確かめてから `createNote` の権限を確認する。移動先が存在しなければ `NotFoundError("WORKSPACE_NOT_FOUND")`（移動先は要求者が選んだ先であり、隠す対象ではない）
3. `NoteOwnershipPolicy.ensureMovable` を呼ぶ（権限は手順 1・2 で確認済みのため、ここで表出するのは `CannotMoveWhileProcessing` のみ。`AccessDenied` には到達しない）
4. `Note.moveTo` を適用する
5. `UnitOfWorkProvider.run` でノートを保存し、`note.moved` を収集する
6. `note.moved` の購読者が後続を担う
   - Tag の `relocateAssignmentsForNote` — タグの付け替え
   - Storage の `relocateFilesForNote` — 保管ファイルの所有者の付け替え
   - Note の `projectNoteChanges` — 読み取りモデルの所有者・ワークスペース列の解決し直し
   - Usage の `applyStorageDelta` — ノート件数の付け替え

   外れるタグ名は移動前に `TagRelocationPolicy.plan` で算出して応答に含める

移動先の容量クォータは検査しない（意図的な設計）。クォータの強制は取り込み時のみで、超過は警告表示と新規アップロードの拒否で扱う。移動でクォータを超えた移動先は、以後の取り込みが拒否されるだけで、移動そのものは成功する。`applyStorageDelta` は `note.moved` を受けて消費量を付け替えるが、判定は行わない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 移動元の権限不足（操作中に除名されていた場合を含む） | `NotFoundError("NOTE_NOT_FOUND")`（存在を漏らさない） |
| 移動先のワークスペースが存在しない（削除済みを含む） | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| 移動先の権限不足 | `BusinessRuleError(InsufficientRole)` |
| 変換処理中 | `BusinessRuleError(CannotMoveWhileProcessing)` |
| 移動先が同じ | 変更もイベントもなく成功として返す |
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
3. `unlisted` に変えるとき、休眠リンクがなければ `SecureTokenGenerator.issue` で新しい `ShareLink` を作る
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
2. `SecureTokenGenerator.issue` で新しいトークンを作る
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
2. `JobRepository.listActiveByTarget({ type: "note", noteId })` を引き、`excludingJobId` に一致するものを除いたすべてを `Job.cancel` する
3. 「共通: 強制終端の後始末」（[usecases/job.md](./job.md)）に従う。`kind: "conversion"` のジョブを止めた結果、対象ノートの `content.status` が `processing` のままなら `Note.markConversionFailed("canceled", now)` を適用する。生成物（`purpose: "artifact"`）は同規則の「2. 保管済みの生成物を回収する」が定める対象集合を `deleteFiles`（[usecases/storage.md](./storage.md)）で回収する — ただし対象（`target.type === "note"`）で引くこの経路は batch 親を返さないため、回収対象は実際には空になる。規則は経路ごとに省かず同じ形で適用する
4. `Note.trash` を適用して保存し、イベントを収集する

手順 3 は手順 4 より**先**に適用する — `Note.markConversionFailed` は `ActiveNote` しか受け取らないため、`Note.trash` を先に当てると回復の手立てがなくなる。

ジョブの取り消し・本文の回復・ノートの更新は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する（手順 2 の `listActiveByTarget` も UoW の内側で引く）。

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

`noteId`, `userId`, `expectedVersion: number`

### 出力DTO

なし。

### 処理フロー

1. 閲覧者コンテキストを解決し、`canDelete` を確認する
2. ゴミ箱にない場合は `ValidationError("NOTE_NOT_TRASHED")`
3. `UnitOfWorkProvider.run` でノートを削除し、`NoteEvents.purged` を収集する。版（`note_revisions`）は DB の FK CASCADE で同時に消える
4. `note.purged` の購読者が後始末を担う
   - Tag の `deleteAssignmentsForNote` — タグ付与の削除
   - Storage の `deleteFilesForNote` — 保管ファイル（`source` / `media` / `reference`）の回収
   - Integration の `deleteBackupRecordsForNote` — バックアップ記録の削除
   - Note の `projectNoteChanges` — 読み取りモデルからの除去
   - Usage の `applyStorageDelta` — 件数の減算

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
   - **50 件超** → 対象を 500 件ごとに分割し、分割ごとに `requestBulkNoteOperation` の `{ kind: "purge" }` として一括削除ジョブ（`bulkDelete`）を登録する（51〜500 件なら 1 件、501 件以上なら複数）。`mode: "scheduled"`、`purgedCount` は登録した対象件数、`jobIds` は登録した親ジョブの ID。対象は 1 つの文脈のゴミ箱に限られるため、分割したどのジョブも所有文脈は単一で `MIXED_OWNER_SCOPE` には当たらない

**同期削除のしきい値が 50 で、ジョブの分割単位が 500 なのはなぜか**。前者は**1 回の実行**で消し切る件数、後者は**1 つの親ジョブ**が受け持つ件数で、掛かる制約が違う。同期削除は 1 件あたり `purgeNote` の約 5 クエリを 1 回の Worker 実行の中で発行するため、1 実行あたり 500 クエリという予算（[ADR 018](../adr/018-query-budget.md)）から 50 件が上限になる。ジョブの子は 1 件ずつ別の実行で処理されるので、この予算には掛からない。値の正典は [platform/index.md](../platform/index.md) の「クエリ予算」。

**同期削除は `purgeNote` の呼び出しである**。複製ではなく合成であり、「共通: ユースケースを合成するときの副作用の範囲」と [usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」に従う。

- このユースケース自身は `UnitOfWorkProvider.run` を開かない。`purgeNote` が 1 件ごとに自分の UoW を開いて確定する。50 件を 1 トランザクションに束ねないのは、`note.purged` の購読者が結果整合で後始末する設計（[ADR 008](../adr/008-domain-boundaries.md)）である以上、まとめても得られる保証が増えないためである。途中で失敗しても既に消えたノートは戻らないが、ゴミ箱を空にする操作は部分的に進んでも矛盾しない
- `purgeNote` が要求する `expectedVersion` は**呼び出し側が渡す**。値の出所は手順 2 の `listByOwner` で引いた各ノートのその時点の `version` である（規約の「対象の版を持たない呼び出し元は、呼ぶ直前に自分で対象を引いてそのときの版を渡す」に当たる）
- 版が競合した（`ConflictError`）ノートは**読み直さずに飛ばし**、`purgedCount` に数えない。列挙から削除までの間に版が動くのは、そのノートが `restoreNote` でゴミ箱から出された場合がほとんどで、読み直して再適用すると利用者が戻したばかりのノートを消してしまう。同じ理由で `NOTE_NOT_TRASHED`（既に他の経路で消えた・戻された）も飛ばして続ける
- `purgeNote` が周辺を巻き込む副作用（ジョブの強制終端など）を持たないため、`trashNote` のような除外引数は要らない（本文冒頭の「共通: ユースケースを合成するときの副作用の範囲」）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |
| 同期削除の途中で個々のノートの版が競合・既に削除済み | そのノートを飛ばして続ける（`purgedCount` に数えない） |

## purgeExpiredTrash

### 概要

保持期限を過ぎたゴミ箱のノートを回収する。定期ワーカーから呼ばれる（cron は 10 分ごと。[platform/index.md](../platform/index.md)）。

### 入力DTO

`limit: number`（既定 100）

### 出力DTO

`purgedCount: number`

### 処理フロー

1. `NoteRepository.listPurgeable(now, limit)` を引く
2. 1 件ずつ `UnitOfWorkProvider.run` で削除し、`note.purged` を収集する。1 件の失敗は他に影響させない

`limit` の既定 100 は 1 回の実行あたりのクエリ予算（500）から逆算した値である（1 件あたり約 3 クエリ）。残りは次の起動で拾うため、継続要求は積まない（[ADR 018](../adr/018-query-budget.md) の継続の 3 通りのうち「次の起動に任せる」）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の削除の失敗 | 記録して継続 |

## deleteNotesForOwner

### 概要

利用者・ワークスペースの削除に伴って、その所有ノートをすべて完全削除する（`identity.user.deleted` / `workspace.deleted` と、継続要求 `note.ownerPurgeContinued` の購読）。

### 入力DTO

`ownerType`, `ownerId`, `batchSize: number`（既定 100）

### 出力DTO

`purgedCount: number`

### 処理フロー

1. `NoteOwner` を組み立てる（`identity.user.deleted` → `{ type: "user", userId }`、`workspace.deleted` → `{ type: "workspace", workspaceId }`）。個人の退会で消えるのは個人所有ノートだけで、退会者が作成したワークスペース所有ノートには触れない（AC-09）
2. `NoteRepository.listByOwner(owner, "all", pagination)` を `batchSize` 件ずつ読み、ゴミ箱かどうかを問わず 1 件ずつ `UnitOfWorkProvider.run` で削除して `NoteEvents.purged` を収集する（`purgeNote` の手順 3 と同じ。版は FK CASCADE で同時に消える）。1 件の失敗は記録して次へ進む
3. タグ付与・保管ファイル・バックアップ記録・読み取りモデル・件数の後始末は `note.purged` の購読者（`purgeNote` の手順 4 と同じ受け手）に委ねる
4. `batchSize` 件を処理してまだ残りがあれば、**継続要求 `note.ownerPurgeContinued { ownerType, ownerId }` を 1 件だけ**、そのバッチの最後の削除と同じ `UnitOfWorkProvider.run` の中で outbox に積む（[ADR 019](../adr/019-owner-cleanup-continuation.md)）。次の配送で続きを処理する。この継続要求の購読者は本ユースケースだけである
5. ただし**そのバッチで 1 件も削除できなかった場合は継続要求を積まず、失敗として返す**。キューの再試行と、それを使い切ったあとの DLQ に委ねる。恒久的に失敗する 1 件が列の先頭に居座って継続が無限に回るのを防ぐ

**カーソルは持たない**。対象は処理するそばから消えるため、「残っているものを先頭から `batchSize` 件読む」だけで必ず前に進む。重複配送で 2 系列が並走しても、両方が残りを読んで消し、対象が 0 件になった系列から順に止まる。

**継続の媒体を専用の要求にした理由**。以前は受け取ったのと同じ `identity.user.deleted` / `workspace.deleted` を再投入して継続していたが、これらは購読者を 8 つ / 4 つ持つため、残作業がある間じゅう購読者全員にコピーが配られ、outbox とキューを水増しした。購読者 1 件の要求に分ければ 1 系列 1 件で済む。継続の媒体としてジョブを使わない理由（`JobKind` にこの後始末に当たる種別がなく、退会した本人には処理履歴が見えない）は変わらない。`deleteFilesByOwner`（[usecases/storage.md](./storage.md)）も同じ形になったため、両者の継続の仕方の違いは解消した。

`batchSize` の既定 100 は 1 回の実行あたりのクエリ予算（500）から逆算した値である（1 件あたり約 3 クエリ）。正典は [platform/index.md](../platform/index.md) の「クエリ予算」。

イベントを発行せず owner 単位の一括 DELETE で消す方式は採らない。ドメインをまたぐ参照（タグ付与・保管ファイル・バックアップ記録）は外部キーを持たずイベント駆動で後始末する規約であり（database 設計の共通規約）、特にバックアップ記録は owner 列を持たないため、ノートを消した後では `noteId` 経由でしか対象を解決できない。1 件ずつ `note.purged` を発行して既存の受け手に委ねるのが、新しいポートや列を増やさない最も単純な設計になる。イベント量は 1 バッチ `batchSize` 件（既定 100）に上限があり、受け手はすべて冪等に設計されている。

冪等性: 削除済みのノートは `listByOwner` に現れないため、同じイベントを 2 回受け取っても 2 回目は 0 件で終わり、結果は変わらない。

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
3. 作成者の表示名を `UserRepository.listByIds` で解決する

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

1. `shareToken` があれば `NoteRepository.findByShareToken`、なければ `findById` で引く
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

代わりに課すのは**下限**である。残りの保持期間が `ExportTicket` の有効期間（30 分）に余裕を足した長さ以上（`expiresAt >= now + 35 分`）ある artifact だけを再利用する。上限しか見ていなかったときは、再利用の対象が「残りの保持期間が短いもの」に絞られ、残り数分で失効する artifact まで含まれてしまう。その場合、有効期間 30 分のチケットを返した直後にダウンロードが `ARTIFACT_EXPIRED` で落ちる。しかもこれは 7 日 TTL の子を経由する場合に限らず、通常の 24 時間 TTL の artifact でも生成から 23:30〜24:00 の間に来た要求では必ず起きる。下限はこの窓を塞ぐためのもので、余裕の 5 分はダウンロード URL の有効期間と時刻のずれを吸収する。代償として、TTL 24 時間の artifact は生成から 23 時間 25 分を過ぎた要求では再利用されず作り直しになる — EX-01 の「再生成せずに」を文字どおり読めばこの末尾 35 分は外れるが、利用者が受け取るのは「少し待って同じ PDF を得る」結果であって失敗ではない。下限を置かなければ同じ窓で「チケットを受け取った直後にダウンロードが失効で落ちる」ことになり、そちらのほうが約束から遠いため、この交換を選ぶ。

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
   - `{ kind: "job" }` → `JobRepository.findById` で引く。不在なら `NotFoundError("EXPORT_NOT_FOUND")`（`exportNote` の再実行を促す）。`succeeded` なら artifact の `fileId` で `{ kind: "file" }` の新しいチケットを発行して返す。それ以外は `status`（`running` なら `progress` も）を返す

`{ kind: "file" }` で artifact の生死を確かめるのは、`exportNote` の手順 4-a が課す下限が**チケット発行時点の**保証にすぎず、発行後に artifact が保持期限を迎える、あるいは強制終端の後始末（[usecases/job.md](./job.md) の「共通: 強制終端の後始末」）や所有者の削除（`deleteFilesByOwner`。[usecases/storage.md](./storage.md)）で回収されることはありうるためである。確かめずに返すと「完了しました」と表示した直後にダウンロードが `ARTIFACT_EXPIRED` で落ちる。

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
4. `ObjectStorage.createDownloadUrl` で有効期間の短い URL を発行して返す

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

`userId`, `noteIds: string[]`, `format: "html" | "markdown" | "pdf"`

### 出力DTO

`jobId`, `targetCount: number`, `skipped: { noteId: string; reason: string }[]`

`skipped` の**構造**（`{ noteId, reason }[]`）は `requestBulkNoteOperation` / `requestBackup`（[usecases/integration.md](./integration.md)）と揃える。対象を ID の並びで受け取る 3 経路は、どれも「一部だけが対象から外れる」ことが常態なので、件数だけでなく**どれがなぜ外れたか**を返す。揃えるのは構造だけで `reason` の**語彙は経路ごとに固有**である（`requestBackup` の `noSourceFile` のように他経路に存在しない値がある）。ただし「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う。本経路の `reason` は `notFound`（`listByIds` の結果に現れなかった ID）/ `permissionDenied`（閲覧権限がない）/ `contentNotReady`（本文が `ready` でない）のいずれか。

### 処理フロー

1. 件数が 500 を超えれば `ValidationError("TOO_MANY_TARGETS")`
2. `NoteRepository.listByIds` で引き、閲覧できるものだけに絞る。`listByIds` は存在しない ID を単に返さない契約（[domains/note.md](../domains/note.md)）なので、入力の `noteIds` と結果を突き合わせ、引けなかった ID は `reason: "notFound"` として `skipped` に積む。閲覧できないものは `reason: "permissionDenied"`、本文が `ready` でないものは `reason: "contentNotReady"` として `skipped` に積み、対象から外す。突き合わせを省くと存在しない ID が無言で落ち、全件不在のときに `NO_EXPORTABLE_TARGET` になるだけで「どれが無かったのか」が利用者に返らない
3. 合計サイズの見積もりが 1 GB を超えれば `ValidationError("EXPORT_TOO_LARGE")`
4. `JobRepository.countActiveByKind(userId, "bulkExport")` で未終端の `bulkExport` ジョブ（親・子の両方）を数え、その件数を `runningBulkExports` として `JobConcurrencyPolicy.ensureBulkExportSlot(runningBulkExports)` に渡す
5. 親ジョブ `Job.enqueueBatch(kind: "bulkExport", payload: { kind: "bulkExport", format }, requestedBy: userId, scope, total)` と、対象ノートごとの子ジョブ（`Job.enqueue`。`kind: "bulkExport"`、`payload` は親と同じ、`target: { type: "note", noteId }`、`parentId` は親、`scope` は下記）を作って保存する（[domains/job.md](../domains/job.md) の登録経路と `kind` / `payload` の対応、および `JobScope` の導出規則）。子は `job.enqueued` の購読ハンドラーがキューへ送り、`runBulkExportItem` が実行する。batch 親はディスパッチ対象外で、実行は `job.readyToAssemble` の購読経由のみ（[ADR 012](../adr/012-job-execution-resilience.md)）
   - `scope` は対象ノートの所有文脈から導出し、親と子で同じ値にする（個人所有なら `{ type: "user", userId: owner.userId }`、ワークスペース所有なら `{ type: "workspace", workspaceId: owner.workspaceId }`）。要求者からは導かない — 参加ワークスペースのノートを書き出すジョブの `scope` は `workspace` になる
   - 手順 2 で絞り込んだあとの対象に個人所有とワークスペース所有が混ざっていれば、親の `scope` が 1 つに定まらないため全体を中止して `ValidationError("MIXED_OWNER_SCOPE")` とする（[domains/job.md](../domains/job.md) の「batch 親の `scope` は単一である」）。選択は 1 つの文脈のノート一覧で行うため通常の操作では起こらない

親ジョブと全子ジョブの保存は同一の `UnitOfWorkProvider.run` で行い、`job.enqueued` をまとめて収集する。子だけが残って親のない孤児になる状態、親の `total` と実在する子の件数がずれる状態のどちらも作らない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数・サイズの上限超過 | `ValidationError("TOO_MANY_TARGETS")` / `ValidationError("EXPORT_TOO_LARGE")` |
| 対象が 0 件 | `ValidationError("NO_EXPORTABLE_TARGET")` |
| 対象の所有文脈が混在 | `ValidationError("MIXED_OWNER_SCOPE")` |
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
2. `NoteRepository.listByIds` で引き、操作に必要な権限（`canEdit` / `canChangeVisibility` / `canDelete`）を持つものだけに絞る。外れたものは `reason: "permissionDenied"` として `skipped` に積む（引けなかった ID は `reason: "notFound"`）
3. 操作ごとの事前検査を行う
   - `purge` → ゴミ箱在籍の事前検査は行わない。`{ kind: "purge" }` は `emptyTrash` からの委譲専用で、**転送境界には露出しない**（`BulkOperation` のうち画面から選べるのは `addTag` / `removeTag` / `changeVisibility` / `move` / `trash` の 5 つで、`serverAction` の `inputValidator` は `purge` を受け付けない）。対象は `emptyTrash` が `listByOwner(owner, "trashed", …)` で集めた行に限られ、実行時には `runBulkNoteOperationItem` から呼ぶ `purgeNote` がゴミ箱在籍を検査して `ValidationError("NOTE_NOT_TRASHED")` を返す
   - `changeVisibility: "public"` → 各ノートの所有文脈で検査する（個人所有は `owner.userId` の利用者の公開ハンドル、ワークスペース所有は所有ワークスペースの公開スラッグ。`createdBy` は用いない）。未設定なら全体を中止して `ValidationError("PUBLIC_HANDLE_REQUIRED")`
   - `move` → 移動先の権限を確認し、移動で閲覧できなくなる利用者が出る場合と外れるタグがある場合を `warnings` に載せる。移動先の容量クォータは `moveNote` と同じく検査しない（クォータの強制は取り込み時のみ。意図的な設計）
4. 親ジョブ `Job.enqueueBatch(kind, payload, requestedBy: userId, scope, total)` と、対象ノートごとの子ジョブ（`Job.enqueue`。親と同じ `kind` / `payload`、`target: { type: "note", noteId }`、`parentId` は親、`scope` は下記）を作って保存する。`kind` と `payload` は `operation.kind` から決まる（[domains/job.md](../domains/job.md) の登録経路と `kind` / `payload` の対応。`addTag` / `removeTag` → `bulkTag`、`changeVisibility` → `bulkVisibility`、`move` → `bulkMove`、`trash` / `purge` → `bulkDelete`。`BulkOperation` で失われる区別は `payload` が持つ）
5. `scope` は `requestBulkExport` と同じ規則で決める（[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。対象ノートの所有文脈から導出して親と子で同じ値にし、手順 2 の絞り込みのあとに個人所有とワークスペース所有が混ざっていれば全体を中止して `ValidationError("MIXED_OWNER_SCOPE")` とする。`move` は所有文脈を変える操作だが、`scope` は**移動元**の文脈で固定する — 移動先で取り直すと、実行前にキャンセルすべきジョブが移動元の文脈のキャンセル網から外れる
6. 対象が 1 件だけの場合もジョブとして扱い、経路を 1 本にする

親ジョブと全子ジョブの保存は `requestBulkExport` と同じく同一の `UnitOfWorkProvider.run` で行い、`job.enqueued` をまとめて収集する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数の上限超過 | `ValidationError("TOO_MANY_TARGETS")` |
| 対象が 0 件（すべて権限外） | `BusinessRuleError(AccessDenied)` |
| 対象の所有文脈が混在 | `ValidationError("MIXED_OWNER_SCOPE")` |
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

1. `NoteQueryService.listPublicSitemapEntries` を呼ぶ

### エラーケース

`SystemError(DatabaseError)`

## projectNoteChanges

### 概要

ドメインイベントを受け取って読み取りモデルを更新する（[ADR 009](../adr/009-read-models.md)）。イベント購読ワーカーから呼ばれる。

**このユースケースは読み取りモデルの唯一の書き手であり、同時実行数 1 の専用キュー（`events-projection`）で直列に処理される**（[ADR 016](../adr/016-projection-single-writer.md)）。手順 2 の冪等性は重複配送と順序の入れ替わりに対するもので、**並行実行に対しては成り立たない** — 読み取りと書き込みの間に別の消費者が割り込めばロストアップデートが起き、恒久的に古い投影が残る。直列化はこの穴を塞ぐためのもので、配備の都合ではなく設計上の要件である。

### 入力DTO

`event: NoteEvent | TagEvent | IdentityEvent | WorkspaceEvent | ProjectionRequest`

```ts
type ProjectionRequest =
  | { type: "projection.reprojectRequested"; noteId: NoteId }
  | { type: "projection.tagFanOutContinued"; tagId: TagId; afterNoteId: NoteId | null };
```

継続要求（[domains/index.md](../domains/index.md) の「継続要求」）であってドメインイベントではない。`projection.reprojectRequested` は `rebuildNoteProjection` とタグのファンアウトが積み、`projection.tagFanOutContinued` はタグのファンアウトが自分の続きとして積む。

### 出力DTO

なし。

### 処理フロー

1. イベントの種別で分岐する
   - `note.created` / `note.contentUpdated` / `note.conversionFailed` / `note.awaitingIntegration` / `note.renamed` / `note.styleModeChanged` / `note.visibilityChanged` / `note.moved` / `note.trashed` / `note.restored` → `NoteRepository.findById` で現在の状態を読み、`author`（`createdBy` の利用者の表示名・ハンドル）と `workspace`（ワークスペース所有の場合は名前・スラッグ・公開状態、個人所有なら `null`）を解決して `NoteProjectionEntry` を組み立て、`NoteProjectionWriter.upsert` で上書きする。初回投影（`note.created`）と所有者の変わる `note.moved` も、この解決を経ることで著者・ワークスペース列が最初から埋まる。`createdBy` の利用者が解決できない場合（退会後に本文更新・移動が投影される場合）は `{ displayName: "退会した利用者", handle: null }` を既定値として埋める — `author_display_name` は NOT NULL であり、退会後の投影で旧表示名が復活してはならない
   - `note.purged` → `NoteProjectionWriter.remove`
   - `tag.assigned` / `tag.unassigned` → 対象ノートのタグを引き直し、表示名と正規化名の組（`{ name, normalized }`）で `updateTags`（タグ削除時は付与 1 件ごとに `tag.unassigned` が併発されるため、`tag.deleted` は購読しない）
   - `tag.renamed` / `tag.merged` → 対象ノートを `TagAssignmentRepository.listByTag` で**1 ページ（200 件）だけ**列挙し、1 件につき `projection.reprojectRequested` を積む。ここで投影そのものは行わない。続きがあれば `projection.tagFanOutContinued`（最後に見た `NoteId` をカーソルに持つ）を積む。`tag.merged` の対象は `targetTagId` で引く — merge の時点で `sourceTagId` の付与は `targetTagId` へ付け替え済み（衝突する行は削除済み）なので `sourceTagId` では 0 件になる。payload は両方の ID を運ぶ（[domains/tag.md](../domains/tag.md)）
   - `projection.tagFanOutContinued` → 上と同じ列挙をカーソルの続きから行う。対象のノートは削除されないため、この継続だけはカーソルを持つ（[domains/index.md](../domains/index.md) の「継続要求」）
   - `projection.reprojectRequested` → `NoteRepository.findById` で現在の状態を読み、`upsert` と `updateTags` の 2 呼び出しで投影を作り直す（`rebuildNoteProjection` の手順 2〜3 と同じ）。ノートが存在しなければ何もせず成功として返す

**タグのファンアウトが投影を直接書かないのはなぜか。** 1 つのタグに付いたノートの数に上限はなく、1 件の投影は約 12 クエリを要する。直接書くと 1 メッセージで発行するクエリ数が対象件数に比例し、1 回の実行あたり 1,000 クエリという D1 の上限を超える（[ADR 018](../adr/018-query-budget.md)）。列挙と要求の投入だけなら、件数によらず 2 クエリ（列挙 1 + 多行 outbox INSERT 1）で終わる。これにより投影キューのどのメッセージも一定のクエリ数で収まり、バッチのメッセージ数を予算から逆算できるようになる。
   - `identity.user.handleChanged` / `identity.user.profileUpdated` → `UserRepository.findById` で現在の状態を読み、表示名とハンドルの組を解決して `updateAuthor(userId, displayName, handle)` を呼ぶ。payload は変化の通知にとどまり投影に要る組を運ばないため、現在値はここで解決する（[domains/identity.md](../domains/identity.md)）。利用者が解決できない場合（退会と入れ替わった配送）は `identity.user.deleted` と同じ既定値 `updateAuthor(userId, "退会した利用者", null)` を書く
   - `identity.user.deleted` → `updateAuthor(userId, "退会した利用者", null)`。退会者が作成したワークスペース所有ノートは残るため（AC-09）、著者表示だけを退会後の姿に置き換える。行は消さない（個人所有ノートの行は `deleteNotesForOwner` が発行する `note.purged` 経由で消える）
   - `workspace.slugChanged` / `workspace.published` / `workspace.unpublished` / `workspace.profileUpdated` → `WorkspaceRepository.findById` で現在の状態を読み、名前・スラッグ・公開状態を解決して `updateWorkspace(workspaceId, name, slug, published)` を呼ぶ。こちらも payload は変化の通知にとどまるため、現在値はここで解決する（[domains/workspace.md](../domains/workspace.md)）。ワークスペースが解決できない場合（削除と入れ替わった配送）は何もせず返す — 対象行は `note.purged` 経由で消える
   - `workspace.created` は購読しない。`createWorkspace`（[usecases/workspace.md](./workspace.md)）はノートを 1 件も作らないため、作成直後のワークスペースには投影対象の行が存在せず、`updateWorkspace` は必ず 0 行更新になるためである。同じ理由で `identity.user.created` も購読しない（本ユースケースが購読する Identity のイベントは `identity.user.handleChanged` / `identity.user.profileUpdated` / `identity.user.deleted` の 3 つ）
   - 上記に現れない Note のイベント（`note.published` / `note.shareLinkReissued` / `note.sharePasswordChanged`）は購読しない。`note.published` は `note.visibilityChanged` と必ず併発するため投影は後者だけで足り、それ自身は監査用に残る（サイトマップも読み取りモデルから引くため専用の受け手を持たない。`listSitemapEntries`）。残る 2 つは投影列を 1 つも変えない
2. どの分岐も payload の値ではなく `findById` で読み直した現在の状態を書くため、同じイベントを 2 回受け取っても、配送順が入れ替わって古いイベントが後着しても結果は変わらない。`identity.user.deleted` も同じ値を書き込む上書きであり、`deleteNotesForOwner` との到着順にも依存しない（対象行が既に消えていれば 0 行更新で成功する）。**この冪等性は並行実行までは覆わない**（冒頭の直列化の要件）

`note_search` 本体・`note_search_tags`・FTS 索引の同期は `NoteProjectionWriter`（アダプター）の責務で、D1 の `batch()` による 1 バッチでアトミックに書く。ただし `updateAuthor` / `updateWorkspace` は FTS 対象列に触れないため FTS 更新は不要（[ADR 011](../adr/011-bigram-search.md)）。bigram 前処理済みのテキストは保存されないため、FTS の取り消しに渡す旧値は生テキスト列から再計算する（[ADR 017](../adr/017-content-size-budget.md)）。タグの 3 列（`note_search.tag_names` / `tag_display_names` と `note_search_tags`）を更新するのは `updateTags` だけで、`upsert` は触れない（[domains/note.md](../domains/note.md) の `NoteProjectionWriter`、[database/index.md](../database/index.md) の「タグ列の同期契約」）。

本文状態（`content_status`）とスタイル（`style_mode`）は `upsert` でしか更新されない。`note.awaitingIntegration` / `note.styleModeChanged` を購読しないと、`runConversion` が `processing → awaitingIntegration` に遷移させても投影は `processing` のまま残り、`countByContentStatus` を根拠とする `completeIntegrationOAuth`（[usecases/integration.md](./integration.md)）の「要 LLM 連携の N 件」の案内が常に 0 件になる。ED-11 のスタイル切り替えも一覧に反映されない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象が既に削除済み | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## rebuildNoteProjection

### 概要

読み取りモデルを書き込みモデルから作り直す。運用操作。

**このユースケースは読み取りモデルへ直接書かない。** 対象ノートを列挙して 1 件につき 1 件の再投影要求を投影キューへ積み、実際の書き込みは `projectNoteChanges` が行う。読み取りモデルの書き手を 1 つに保つためである（[ADR 016](../adr/016-projection-single-writer.md)）— 直接書くと、この運用操作と生きているイベント購読が並行し、単一ライターの前提が破れる。

### 入力DTO

`ownerType: "user" | "workspace" | null`, `ownerId: string | null`, `batchSize: number`（既定 100）, `sweepOrphans: boolean`（既定 `true`）

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `requestedCount` | `number` |
| `sweptCount` | `number` |

`requestedCount` は**再投影を要求した件数**であり、返った時点で投影は 1 件も終わっていない。進捗は投影キューの滞留で見る。

### 処理フロー

1. 対象の絞り込みに従って書き込みモデルを順に読む
   - `ownerType` の指定がある → `NoteRepository.listByOwner(owner, "all", pagination)` を `batchSize` 件ずつ読む（ゴミ箱のノートも読み取りモデルに載るため `"all"`）
   - `ownerType` が `null`（全件再構築） → `NoteRepository.listAll(cursor, batchSize)` を `NoteId` 順に読み進める。所有者を問わない全件走査はこのメソッドだけが担う（[domains/note.md](../domains/note.md) の `NoteRepository`）
2. 読んだ `NoteId` ごとに `projection.reprojectRequested` を outbox へ積む。1 バッチにつき多行 INSERT 1 文で書き、クエリ数を件数に比例させない（[ADR 018](../adr/018-query-budget.md)）
3. `sweepOrphans` が真なら、最後に**孤児行を掃除する**。書き込みモデルに対応するノートが存在しない `note_search` / `note_search_tags` / FTS 索引の行を削除する。投影の取りこぼしは `remove` の欠落としても現れるため、再投影だけでは読み取りモデルは正しくならない。全件再構築（`ownerType` が `null`）でないときは対象所有者の行に限る

投影の実体（著者・ワークスペースの解決、`upsert` + `updateTags` の 2 呼び出し、FTS 索引の同期）は `projectNoteChanges` の `projection.reprojectRequested` 分岐が担う。`upsert` はタグの 3 列に触れないため、投影の再構築が 2 呼び出しの組になる点は変わらない（[domains/note.md](../domains/note.md) の `NoteProjectionWriter`）。

FTS 表そのものを作り直す場合（前処理関数を変えたときなど）は、先に表を再作成してから本ユースケースを走らせる。`INSERT INTO note_search_fts(note_search_fts) VALUES('rebuild')` は contentless 構成では使えない（[ADR 017](../adr/017-content-size-budget.md)）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の失敗 | 記録して継続 |
