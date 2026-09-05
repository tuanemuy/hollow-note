# レビュー 001 — backend-storage

対象: PR #66 / round 001。担当は `domain/storage` / `application/storage` / `application/usage` / 各バックエンドの `storedFileRepository` / `adapters/conformance` の storage 分 / `spec/{domains,usecases}/storage.md`。

## backend-storage

### Blockers

- **[B-001]** 保管した `media` の配信 URL がどこからも読めない。`storeMedia` が返す URL は 404 になる
  - 場所: `packages/core/src/application/storage/storeMedia.ts:273`（`url: objectStorage.publicUrl(objectKey)`）、`apps/web/app/routes/storage.$.tsx:35`（`if (ObjectKey.purposeOf(key) !== "avatar") return notFound();`）、`packages/core/src/application/ports/objectStorage.ts:35-39`
  - 理由: `ObjectStorage.publicUrl` の契約 JSDoc は「Use it only for objects that really are public — today, avatars」、`spec/domains/storage.md:317` も「使ってよいのは公開してよい用途に限る（現時点では `avatar`）」と定めている。参照実行環境（ADR 025 の Node + memory）で `publicUrl` を実際に読める唯一の経路である `/storage/$` は `purpose !== "avatar"` を 404 で弾く。したがって `storeMedia` が返した URL を `mediaMarkup(stored.url, ...)`（`apps/web/app/components/note/NoteEditor/editor.tsx:627`）で本文に挿し込んでも、画像・動画は必ず壊れたまま表示される。AC-6（ED-06「完了すると保存先 URL を参照する要素が本文に挿入される」）と `spec/manual-tests/editing.md` TC-08 手順 4「保存してノート詳細を開く → 画像が表示される」は現状の実装では成立しない（AC-13 も落ちる）。加えて `collectOrphanMedia` の参照判定（`collectOrphanMedia.ts:179` の `objectStorage.publicUrl(objectKey)` と本文中 URL の突き合わせ）が、本文に載ることのない住所を正としているため、回収規則そのものが配信経路の決定に依存したまま宙に浮いている
  - 提案: 配信側を先に決めること。(a) `media` を公開鍵空間として扱うなら `/storage/$` の許可 purpose を広げ、`ObjectStorage.publicUrl` の JSDoc と `spec/domains/storage.md:317` の「現時点では avatar」を同時に改訂する（SVG を同一オリジンから配るので、既存の `X-Content-Type-Options` / `Content-Security-Policy: sandbox; default-src 'none'` が media にも掛かることを合わせて確認する）。(b) 公開にしないなら `storeMedia` の戻り値を `createDownloadUrl` 相当の別経路に変え、`collectOrphanMedia` の突き合わせもその住所に合わせる。いずれにせよ「ポート JSDoc / 配信ルート / `storeMedia`」の 3 点が同じ答えを言う状態にしてから着地させる

- **[B-002]** SVG の実効上限が 800 KB で、超えると**ノート本文のエラー**が返る。ポリシー表・spec・画面文言が宣言する 20 MB と食い違う
  - 場所: `packages/core/src/application/storage/storeMedia.ts:138-156`（`sanitizeSvg` → `htmlProcessor.process(...).html`）、`packages/core/src/adapters/html/htmlProcessor.ts:767`（`NoteHtml.create(serialize(fragment))`）、`packages/core/src/domain/note/valueObject.ts:77,121-126`（`CONTENT_MAX_BYTES = 800_000` → `BusinessRuleError(NoteErrorCode.ContentTooLarge)`）、`packages/core/src/domain/storage/services/uploadValidationPolicy.ts:21-29`（`"image/svg+xml": MEDIA_IMAGE_MAX_BYTES`）
  - 理由: `HtmlProcessor.process` は**ノート本文の値オブジェクト**を返すので、サニタイズ後 800 KB を超えた時点で `NOTE_CONTENT_TOO_LARGE` を投げる。1 MB 級の SVG（作図ツール書き出しでは珍しくない）をアップロードすると、`errorDisplay.ts:95-96` の「内容が上限を超えています。分割してからもう一度お試しください。」が出る一方、同じ画面の `STORAGE_FILE_TOO_LARGE`（`errorDisplay.ts:144-145`）は「画像は 20 MB まで」と案内する。`spec/domains/storage.md` の上限表と `UploadValidationPolicy` の `MEDIA_LIMIT_BYTES` も 20 MB と書いており、実装だけが 800 KB。ドメイン境界の観点でも、Storage の入口が Note の本文サイズ不変条件で失敗するのは責務の漏れ（`spec/adr/008-domain-boundaries.md` の分割に反する）
  - 提案: どちらかに寄せる。(a) `image/svg+xml` の行に到達可能な上限（サニタイズ後に 800 KB を割る値）を与え、spec の表・画面文言・`spec/manual-tests/editing.md` TC-25 を揃える。(b) `HtmlProcessor` に単体文書用の入口（戻り値が `NoteHtml` ではない）を足し、`storeMedia` はそちらを通して `UploadValidationPolicy` の上限だけで判定する。いずれの場合も、サニタイズ後のバイト長を `UploadValidationPolicy.limitFor` に対して測り直すこと（現状は `ObjectStorage.put` が測るだけで、どの上限とも突き合わせていない）。なお `NoteHtml` の 800 KB がある間はサニタイズ後にバイト数が増えても上限を超えられないため、**容量判定の順序（手順 3 が申告前サイズ）自体は安全側**で、`spec/usecases/storage.md#storeMedia` 手順 5 の但し書きどおりで問題ない — この Blocker が直ると同時に「増えうる」経路が開くので、その時点で測り直しが必須になる

- **[B-003]** `collectOrphanMedia` が先頭ページで詰まる。30 日超の media を 100 件以上抱える scope では、101 件目以降の孤児が永久に回収されない
  - 場所: `packages/core/src/application/storage/collectOrphanMedia.ts:252`（`const hasMoreNow = scan.scanned === limit && collectedCount > 0;`）、契約側は `packages/core/src/domain/storage/ports/storedFileRepository.ts`（`listByPurposeOlderThan` にカーソルが無い）
  - 理由: 走査は毎回「30 日より古い media を古い順に `limit` 件」の**先頭ページだけ**を読み、残す判断をした行はそのまま残る。したがって先頭 100 件がすべて本文から参照されている（= ごく普通の稼働中 scope）と `collectedCount === 0` になり、翌日も同じ 100 件を読み直す。101 件目以降は 1 度も検査されないので、そこにある孤児は無期限に保管され続ける。`spec/usecases/storage.md#collectOrphanMedia` は「`limit` 件に達したときは残件を先に処理するため直後にも継続 task を設定し、完了後に日次へ戻す」と定めており、`collectedCount > 0` の追加条件は spec からの逸脱（spec は改訂されていない）。テスト `TC-storage-027: a full page of files the bodies still reference goes back to the next day rather than spinning` はこの取りこぼしを**期待値として固定**してしまっている
  - 提案: `listByPurposeOlderThan` に排他カーソル（`(createdAt, id)` の組。順序は既に全順序で契約済み）を足し、ポート JSDoc → `adapters/conformance/storedFileRepository.ts` → memory / cloudflare の 3 点で同時に定義する（ADR 026）。1 turn の予算内でカーソルを進めながら読み、ページを読み切ったら日次へ戻す形にすれば「進捗があったか」に依存せず前進する。実装を変えたら `spec/usecases/storage.md#collectOrphanMedia` の継続規則も併せて改訂すること

### Warnings

- **[W-001]** 日次掃引の起動条件が「この scope に media が 1 件も無い」で、`relocateFilesForNote` で流入した media がそれを永久に潰す
  - 場所: `packages/core/src/application/storage/collectOrphanMedia.ts:112-136`（`armOrphanMediaSweepOnFirstMedia`）、`packages/core/src/application/storage/relocateFilesForNote.ts:104-127`（`stageTarget` が target scope へ media 行を insert する）
  - 理由: 掃引行を持っているかどうかの判定に「media 行の有無」を代用している。ノートを個人 → ワークスペースへ移動すると target scope に media 行だけが現れ、その scope の掃引 task は登録されない。以後その scope で `storeMedia` が呼ばれても `existing.length > 0` で早期 return するため、**その scope の孤児 media は二度と回収されない**。`schedule` が `(kind, operationId)` で `dueAt` を上書きする以上、毎回 arm できないという判断自体は正しいが、代用している述語が等価でない
  - 提案: 掃引行そのものの有無で判断する（`ScopeTaskScheduler` に「無ければ積む」入口を足すか、`scheduled_tasks` を読む）。あるいは `relocateFilesForNote` の `stageTarget` でも media が 1 件でも移ったら arm する。前者のほうが「起動条件はこの 1 行の存在」と言い切れて安全

- **[W-002]** `deleteFilesForNote` が spec の完了条件の半分だけで task を完了する。先送りがコードにもどこにも書かれていない
  - 場所: `packages/core/src/application/storage/deleteFilesForNote.ts:63-77`
  - 理由: `spec/usecases/storage.md#deleteFilesForNote` 手順 3-4 は「100 件未満になった turn から `ReferenceImportRecordRepository.deleteByNote(noteId, 100)` で取得記録と要約を消し、**両集合が 100 件未満になったときだけ完了する**」と定める。実装はファイル側だけを見て `scopeTaskScheduler.complete` を呼ぶ。`ReferenceImportRecordRepository` は取り込みスライス（#6）の持ち分でまだ存在しないので今スライスで実装しないこと自体は妥当だが、JSDoc も spec も何も言っていないため、コードは「完成した実装」に読める。`spec/inventory/usecase.md:114` の UC-storage-012 の説明（"reference import records を各 100 件ずつ削除・継続し"）も現状と食い違う
  - 提案: `deleteFilesForNote` の JSDoc に「参照取り込み記録の回収は取り込みスライスが追加する（`spec/usecases/storage.md#deleteFilesForNote` 手順 3）」と 1 行残す。spec 側を触るなら「取り込みスライス到着まではファイル集合のみで完了する」と明記する

- **[W-003]** `MEDIA_ALLOWED_MIME_TYPES` は「エディタ側の対」と JSDoc で宣言しながら、エディタが同じ 7 形式を文字列リテラルで二重に持っている
  - 場所: `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:31-33`、`apps/web/app/components/note/NoteEditor/editor.tsx:1335-1336`（`"image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/webm"`）
  - 理由: `AVATAR_ALLOWED_MIME_TYPES` は `ProfileForm/editor.tsx:317` / `WorkspaceGeneralForm/editor.tsx:293` の `accept` が実際に参照しており、media だけ規約が割れている。`MEDIA_ALLOWED_MIME_TYPES` は現状どこからも import されていない（実質デッドエクスポート）。`RULES` が正典だと `errorDisplay.ts:139-141` のコメントまで書いているのに、表を増減させても `accept` は追随しない
  - 提案: `accept={MEDIA_ALLOWED_MIME_TYPES.join(",")}` にする。使わないなら export を落とす

- **[W-004]** `opensAsSvg` の BOM 分岐が到達しない。TC-storage-176 の BOM ケースは別経路で通っている
  - 場所: `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:144`（`const head = decoded.charCodeAt(0) === BOM ? decoded.slice(1) : decoded;`）
  - 理由: `new TextDecoder()` は `ignoreBOM` 既定 false、すなわち UTF-8 BOM を**復号時に取り除く**。よって `decoded` の先頭が `U+FEFF` になることはなく、`slice(1)` は実行されない。`spec/domains/storage.md` の判定表が「BOM とプロローグを読み飛ばして」と書いている以上、意図した防御は効いている（BOM は復号側が食う）が、コードは効いていない分岐を持ち、テストはその分岐を検証していない
  - 提案: 分岐を削って「BOM は `TextDecoder` が落とす」と 1 行の理由コメントにするか、`new TextDecoder("utf-8", { ignoreBOM: true })` にして分岐を生かす。どちらでもよいが、両方が同時に正しいことはない

- **[W-005]** `ensureUploadAllowed`（UC-usage-002）が自前のテストなしで入り、`llmCalls > 0` の枝には呼び出し元もテストも無い
  - 場所: `packages/core/src/application/usage/ensureUploadAllowed.ts:55-66`
  - 理由: 実装は `spec/usecases/usage.md#ensureUploadAllowed` の手順 1-3 と一致しているが、担保しているのは `storeMedia` 経由の user subject / storage 枝だけ（TC-storage-183 の 2 件）。workspace subject の上限（TC-usage-042）、LLM 枝（TC-usage-037〜039, 041）、記録不在の初期値判定（TC-usage-040）はいずれも通っていない。`llmCalls` は本スライスで常に 0 なので、`BillingPeriod.of(now)` を含む枝は 1 度も実行されない
  - 提案: 本スライスの担保としては `application/usage/__tests__/ensureUploadAllowed.test.ts` に最低限「workspace subject」「記録不在」「LLM 枝」の 3 本を足す。TC-usage-034〜043 全量が Usage スライスの持ち分なら、そのことを分かる形で残す

- **[W-006]** `spec/domains/storage.md:273` が、ポート表に存在しない `listByNote` を説明している（**既存の問題（本 PR の変更起因ではない）**が、本 PR が当該メソッドを実装した回）
  - 場所: `spec/domains/storage.md:262,273`
  - 理由: ポート表の宣言は `listDeletableByNote(noteId, limit)` なのに、直後の本文が「`listByNote` はcurrent scopeで `noteId` が一致する全ファイルを引く」と別名・別意味（全 purpose を引く）で書いている。実装は `NOTE_DELETABLE_PURPOSES` の 3 種に限っており、artifact は引かない。移動の説明（`source` / `media` / `reference` を snapshot に含める）は `relocateFilesForNote` が `listByOwner` + note フィルタで実現しているので、この段落は 2 つの読み方を許してしまう
  - 提案: `listByNote` を `listDeletableByNote` に直し、「artifact は含まない」「移動は `listByOwner` を使う（`relocateFilesForNote` の JSDoc と同じ理由）」まで書き切る

### テスト保証

- `media の 7 形式をバイト列から判定する（uploadValidationPolicy.ts:identifyContentType）` — 守っているテスト: `packages/core/src/domain/storage/__tests__/storage.test.ts:TC-storage-175 / TC-storage-176: reads every accepted media format out of its own bytes`
- `SVG プロローグ（BOM / 宣言 / コメント / doctype）の読み飛ばし（uploadValidationPolicy.ts:opensAsSvg）` — 守っているテスト: `storage.test.ts:TC-storage-176: walks an SVG prologue …`（ただし BOM 分岐は到達しない → W-004）
- `似て非なるバイト列の拒否（ftyp/heic・EBML/matroska・HTML 中の svg 文字列）` — 守っているテスト: `storage.test.ts:TC-storage-179: refuses bytes that merely resemble an accepted format`
- `画像 20 MB / 動画 200 MB の上限と境界（uploadValidationPolicy.ts:ensureAcceptable）` — 守っているテスト: `storage.test.ts:TC-storage-181 / TC-storage-180`, `TC-storage-182`
- `SVG 上限が実際には 800 KB で ContentTooLarge になる（storeMedia.ts:sanitizeSvg）` — 守られていない → [B-002]
- `avatar が SVG / GIF / 動画を拒み続ける（RULES に行が無い purpose は署名判定に入らない）` — 守っているテスト: `storage.test.ts:describe("UploadValidationPolicy: avatar")`（既存ケースが `UnsupportedMimeType` を確認）
- `SVG をサニタイズしてから保管する（storeMedia.ts:sanitizeSvg）` — 守っているテスト: `application/storage/__tests__/storeMedia.test.ts:TC-storage-176: an SVG is stored as HtmlProcessor.process leaves it, not as it was uploaded`, `TC-storage-177: script, foreignObject, on* and outward-pointing href / xlink:href do not survive an SVG`
- `サニタイズを迂回する保管経路が無い（storeMedia が唯一の media 入口）` — 守っているテスト: 直接のテストは無いが、`storeNoteMediaFn`（`apps/web/app/routes/notes/-action.tsx:331`）が唯一の呼び出し元で、`avatar` 側は `RULES.avatar` に `image/svg+xml` を持たない。SVG が入る経路は `storeMedia` 1 本に閉じている（`allowList.ts` の `ALLOWED_SVG_ELEMENTS` と `htmlProcessor.ts` の「svg 名前空間の未許可要素は内容ごと落とす」により `foreignObject` 経由の HTML 混入も無い）
- `名前空間の復元（storeMedia.ts:asStandaloneSvg）` — 守っているテスト: `storeMedia.test.ts:TC-storage-176: the stored SVG declares the namespaces it needs to stand on its own`, `TC-storage-176: no xlink namespace is declared when no xlink attribute survives`
- `保管前の容量判定（storeMedia.ts → ensureUploadAllowed）` — 守っているテスト: `storeMedia.test.ts:TC-storage-183`（超過で 1 バイトも書かない / ちょうどは通る）
- `型・サイズは実測値を返し、行にも同じ値が載る（storage/view.ts:StoreMediaView）` — 守っているテスト: `storeMedia.test.ts:TC-storage-175`, `TC-storage-176`（`view.size === 実バイト長 === file.size`）
- `編集権限のない閲覧者・不在ノート・purging route は NOT_FOUND で、何も書かない` — 守っているテスト: `storeMedia.test.ts:TC-storage-184 / 185 / 187`
- `route 解決と scope 読みの間に移動したノートは移動先 scope にだけ保管される（storeMedia.ts:resolveEditableNote）` — 守っているテスト: `storeMedia.test.ts:TC-storage-186`
- `transaction 失敗時にオブジェクトを消す（storeMedia.ts の catch）` — 守っているテスト: `storeMedia.test.ts:rolls the stored object back when the transaction fails`
- `保管バイトが容量に効く（storage.fileStored → recalculateStorageUsage）` — 守っているテスト: `storeMedia.test.ts:TC-storage-189`
- `配信 URL が実際に読めること` — 守られていない → [B-001]（`storage.$.tsx` の avatar 限定ガードを突く結合テストも手動手順も無い）
- `30 日 + 未参照の 2 条件で回収する（collectOrphanMedia.ts:isOrphan）` — 守っているテスト: `collectOrphanMedia.test.ts:TC-storage-016 / 017 / 018 / 019`
- `所有者に依らず scope 全体を走査する（listByPurposeOlderThan）` — 守っているテスト: `collectOrphanMedia.test.ts:TC-storage-020`
- `所属ノートの本文だけで判断する（provenance の noteId）` — 守っているテスト: `collectOrphanMedia.test.ts:TC-storage-021`, `TC-storage-023`
- `ノート不在は回収対象 / 本文が ready でなければ温存` — 守っているテスト: `collectOrphanMedia.test.ts:TC-storage-022`（2 本）
- `初回 media で日次 task を arm し、2 回目以降は dueAt を押し出さない` — 守っているテスト: `collectOrphanMedia.test.ts:TC-storage-026`
- `移動で流入した media がある scope でも掃引が arm される` — 守られていない → [W-001]
- `満杯ページの継続と、走査が尽きたときの日次復帰` — 守っているテスト: `collectOrphanMedia.test.ts:TC-storage-027`（3 本）。ただし「参照されている満杯ページ」の取りこぼしを期待値として固定している → [B-003]
- `個々の削除失敗を記録して継続する` — 守っているテスト: `collectOrphanMedia.test.ts:TC-storage-028`
- `purge 後に source / media / reference だけを回収し、artifact と avatar と他ノートを残す（deleteFilesForNote.ts）` — 守っているテスト: `deleteFilesForNote.test.ts:TC-storage-051 / 052 / 053 / 054`
- `100 件ずつの継続と最終 turn の complete、cleanup token の引き継ぎ` — 守っているテスト: `deleteFilesForNote.test.ts:TC-storage-058`（2 本）, `TC-storage-059`
- `他人の cleanup token を拒む（cleanupAdmission.assertOwner）` — 守っているテスト: `deleteFilesForNote.test.ts:TC-storage-060`
- `再配送が no-op（削除済み行は listDeletableByNote に現れない）` — 守っているテスト: `deleteFilesForNote.test.ts:TC-storage-061`
- `参照取り込み記録の回収まで含めた完了条件` — 守られていない → [W-002]
- `listDeletableByNote の purpose 絞り込み・id 順・limit 境界・limit<=0（ポート契約）` — 守っているテスト: `adapters/conformance/storedFileRepository.ts:ADP-storage-007`（memory / cloudflare 両方が同一スイートを通る）
- `listByPurposeOlderThan の古い順・境界の包含・purpose 絞り込み・limit<=0（ポート契約）` — 守っているテスト: `adapters/conformance/storedFileRepository.ts:ADP-storage-010`
- `ページング用カーソル（前進保証）` — 守られていない → [B-003]（ポートに概念が無いのでスイートにも無い）
- `ensureUploadAllowed の workspace subject / LLM 枝 / 記録不在` — 守られていない → [W-005]

### カバレッジ

- 確認: `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`, `packages/core/src/domain/storage/services/storageUrlPolicy.ts`, `packages/core/src/domain/storage/ports/storedFileRepository.ts`, `packages/core/src/domain/storage/__tests__/storage.test.ts`, `packages/core/src/application/storage/storeMedia.ts`, `packages/core/src/application/storage/collectOrphanMedia.ts`, `packages/core/src/application/storage/deleteFilesForNote.ts`, `packages/core/src/application/storage/relocateFilesForNote.ts`, `packages/core/src/application/storage/view.ts`, `packages/core/src/application/storage/__tests__/storeMedia.test.ts`, `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`, `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`, `packages/core/src/application/usage/ensureUploadAllowed.ts`, `packages/core/src/adapters/conformance/storedFileRepository.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`, `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`, `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`（stored_files 索引の該当分）, `packages/core/src/application/di/types.ts`（`htmlProcessor` / `objectStorage` の配線）, `packages/core/src/application/workers/scopeTaskRunner.ts`・`subscribers.ts`（storage ハンドラー分）, `spec/domains/storage.md`, `spec/usecases/storage.md`, `spec/inventory/usecase.md`（storage 行）, `spec/presentation/index.md`
- 差分外で参照: `apps/web/app/routes/storage.$.tsx`, `apps/web/app/routes/notes/-action.tsx`（`storeNoteMediaFn`）, `apps/web/app/components/note/schema.ts`（`noteMediaUploadSchema`）, `apps/web/app/components/note/NoteEditor/editor.tsx`（`MEDIA_ACCEPT` / 挿入マークアップ）, `apps/web/app/presentation/errorDisplay.ts`, `packages/core/src/adapters/html/allowList.ts`・`htmlProcessor.ts`（SVG 部分集合と名前空間扱い）, `packages/core/src/application/ports/objectStorage.ts`, `packages/core/src/application/storage/deleteFiles.ts`, `packages/core/src/domain/note/valueObject.ts`（`CONTENT_MAX_BYTES`）, `spec/usecases/usage.md`, `spec/inventory/adapter.md`, `spec/manual-tests/editing.md`
- スキップ: `apps/web/app/components/note/{NoteDetail,NoteEditor,NoteList,TrashList}/**`, `apps/web/app/routes/**`（上記の storage 関連 2 本を除く）, `apps/web/app/routeTree.gen.ts`, `apps/web/app/presentation/__tests__/**` — フロントエンド担当の範囲
- スキップ: `packages/core/src/application/note/**`, `packages/core/src/application/cleanup/**`, `packages/core/src/application/identity/**`, `packages/core/src/application/integration/**`, `packages/core/src/application/tag/**`, `packages/core/src/domain/{note,tag,integration}/**` — note / tag / integration 担当の範囲（`note.purged` の fan-out は storage の追随分のみ確認）
- スキップ: `packages/core/src/adapters/{memory,cloudflare}/**` の `noteRepository` / `tagAssignmentRepository` / `backupRecordRepository` と対応する conformance スイート — storage 以外のポート
- スキップ: `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts` の本文サニタイズ表（TC-note-682〜741） — HtmlProcessor 担当の範囲。SVG 部分集合と「svg 名前空間の未許可要素は内容ごと落とす」規則のみ B-002 / テスト保証の判断材料として確認
- スキップ: `pnpm-lock.yaml`, `packages/core/package.json` — parse5 追加の妥当性は HtmlProcessor 担当の判断
