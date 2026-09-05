### backend-storage

対象: `packages/core/src/domain/storage/`、`packages/core/src/application/storage/`、`packages/core/src/application/usage/`、両バックエンドの `storedFileRepository`、`adapters/conformance/storedFileRepository.ts`、`apps/web/app/routes/storage.$.tsx` と配信経路、`spec/domains/storage.md` / `spec/usecases/storage.md` / `spec/testcases/storage/`。

検証は差分の読解に加え、`pnpm vitest --project node`（storage / usage / domain-storage / storage.delivery = 13 files / 198 tests）と `--project workers`（24 files / 549 tests）を実行し、`HtmlProcessor.process` に SVG 攻撃ベクタ 17 種を通す使い捨てプローブで実挙動を確認した。

#### Blockers

**[B-001]** SVG の「受理条件」と「保管される文書」が食い違い、`</svg>` の後ろに付いた任意のマークアップがそのまま `image/svg+xml` として保管・配信される

- 場所: `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:opensAsSvg` と `packages/core/src/application/storage/storeMedia.ts:sanitizeSvg` / `asStandaloneSvg`
- 理由:
  - `opensAsSvg` が見るのは**根要素が `<svg` で始まること**だけで、文書全体が 1 つの `svg` ルートで閉じているかは見ない。`sanitizeSvg` は `htmlProcessor.process()` の戻り値（本文断片）をそのまま保管し、`asStandaloneSvg` は最初の `<svg` に名前空間を差し込むだけで、ルート外に残った内容には触れない。
  - 実測（`createHtmlProcessor().process()` に直接投入）:
    - 入力 `<svg xmlns="…"><rect/></svg>trailing text<p>and a paragraph</p>`
    - 出力 `<svg><rect></rect></svg>trailing text<p>and a paragraph</p>`
    この 7 バイト目以降がそのまま `.svg` として `ObjectStorage.put` され、`/storage/$` が `Content-Type: image/svg+xml` で配信する。XML はルート要素の後ろの文字データを**致命的エラー**として扱うので、この文書はどのブラウザでも 1 ドットも描画されない（`<img>` 埋め込みでもエディタのプレビューでも壊れる）。
  - `spec/usecases/storage.md#storeMedia` 手順 4 は「**単体の `.svg` として開けるよう**…付け直す」と書いており、実装はその契約を受理した入力に対して満たしていない。さらに ADR 050（受理判定は実体から）の趣旨に照らしても、行に載る `mimeType: image/svg+xml` が中身を記述していない状態になる。
  - セキュリティ影響は現状は限定的（`nosniff` + `Content-Security-Policy: sandbox; default-src 'none'` が効くうえ、残るマークアップは許可リスト通過済みで `script` / `on*` は落ちている。プローブでも `onload` / `xlink:href="javascript:"` / `<use href="https://evil…">` / `<style>@import>` / `foreignObject` / `<animate>` はすべて除去されることを確認した）。ただし「アプリ自身のオリジンから、宣言した型と異なる攻撃者由来の HTML を配る」状態そのものが ADR 013 / ADR 050 が閉じたはずの穴であり、配信先が R2 公開ドメインに移った時点（`spec/platform/index.md`）で CSP は付かなくなる。
  - テストは無い。`TC-storage-179` は `<html><body><svg /></body></html>` を「根要素が svg でない」として拒否することは見ているが、`<svg/>…余計なもの` の側は 1 件も突いていない。
- 提案: どちらかに寄せる。(a) `opensAsSvg` を「根要素が `svg` で、かつルート外に非空白の内容が無い」に強める、または (b) `asStandaloneSvg` を「最初の `<svg` から対応する `</svg>` までを切り出して返す」に変え、切り出せなければ `UnsupportedMimeType` で拒否する。いずれにせよ `spec/testcases/storage/storeMedia.md` に「`</svg>` の後ろに内容がある入力」の行を足し、`storeMedia.test.ts` に TC を 1 件足すこと。

#### Warnings

**[W-001]** 版（`NoteRevision`）が参照するメディアは孤児判定の対象外で、30 日後に回収されて版復元が壊れる

- 場所: `packages/core/src/application/storage/collectOrphanMedia.ts:isOrphan` / `spec/usecases/storage.md#collectOrphanMedia` 手順 2
- 理由: `isOrphan` は所属ノートの**現在の本文**（`content.html`）だけを見る。`packages/core/src/domain/note/noteRevision.ts:36` のとおり版は `html: NoteHtml` を保持しており、本スライスは `restoreNoteRevision`（AC-8「直近 20 版から復元できる」）を同時に実装している。回収の起点は**作成時刻**なので、「挿入 → 翌日に本文から外す → 29 日後に回収」の順で、まだ生きている版が指すメディアが消える。復元しても画像は 404 になる。20 版という保持数は数か月をまたぐことがあり、稀なケースではない。
- 提案: 判定を「現在の本文 ∪ 保持している版の本文」に広げるか、少なくとも `spec/usecases/storage.md#collectOrphanMedia` と `spec/testcases/storage/collectOrphanMedia.md` に「版の参照は救わない（復元時に画像が失われうる）」ことを明示的な決定として書く。今は spec にも ADR にも記述が無く、判断が行われた形跡がない。

**[W-002]** `TC-storage-253` に対応するテストが存在せず、その spec 行は同じ表の別行と条件付きでしか両立しない

- 場所: `spec/testcases/storage/storeMedia.md`（本 PR 追加の 3 行）、`spec/inventory/test.md:2002`、`packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- 理由: `TC-storage-251` / `TC-storage-252` は名前に ID を持つテストがあるが、`TC-storage-253`（128 KB ちょうどの SVG は成功する）は `grep -rn "TC-storage-253" packages apps` が 0 件。近いのは `domain/storage/__tests__/storage.test.ts` の `TC-storage-181 / TC-storage-180` で、しかもこれは `svgBody(...).subarray(0, bytes)` で**途中切断した** SVG を `UploadValidationPolicy` に直接渡すポリシー単体の検証であり、`storeMedia` 経路の境界ではない。
  加えて内容自体が不正確で、「128 KB ちょうどの SVG → 成功する」は無条件には成り立たない。同じ表の次行が定める「サニタイズ後の測り直し」があるため、131,072 バイトでも直列化で膨らむ入力（属性値中の `"` など）は `FileTooLarge` になる。2 行が矛盾して読める。
- 提案: `TC-storage-253` の行を「サニタイズ後も 128 KB 以内に収まる 128 KB ちょうどの SVG」に限定し、`storeMedia.test.ts` にその ID を持つテストを 1 件足す（`docs/test.md`「Naming」）。

**[W-003]** 掃引行が `failed` に落ちた scope は二度と孤児回収されないが、再武装の経路が無い

- 場所: `packages/core/src/application/storage/collectOrphanMedia.ts:armOrphanMediaSweepOnFirstMedia`
- 理由: 武装は「scope に media が 1 件も無い」ときだけ行う。`readOrphanMediaSweepTurn` の JSDoc は「読めない payload で失敗させると上限で `failed` に駐車し、掃引は自分を張り直せない」と、この危険を正しく認識して payload だけを手当てしている。しかし駐車の原因は payload に限らない（一過性でないリポジトリ障害、`isOrphan` が読む本文が毎回同じ例外を出す等）。いったん `failed` になると media は既に存在するので `armOrphanMediaSweepOnFirstMedia` は何もせず、その scope の回収は永久に止まる。テスト側も `sweepRow()` が `state === "failed"` で throw する作りで、この状態から抜ける道は検証されていない。
- 提案: `armOrphanMediaSweepOnFirstMedia` の判定を「media が無い」から「掃引行が pending として存在しない」に変える（`ScopeTaskScheduler` に存在確認が要る）か、`spec/usecases/storage.md#collectOrphanMedia` に「駐車したら運用で張り直す」ことを明記する。現状はどちらの記述も無い。

**[W-004]** 公開 purpose に `media` を足した帰結（ゴミ箱移動・非公開化のあともメディア URL は purge まで配信され続ける）がどこにも書かれていない

- 場所: `apps/web/app/routes/storage.$.tsx:PUBLICLY_SERVED_PURPOSES`、`spec/domains/storage.md`（`publicUrl` の節）
- 理由: 配信口はセッションも `StoredFile` 行の存在も見ず、鍵の形（`users/{id}/media/{fileId}.ext`）だけで通す。ノートをゴミ箱へ移しても `StoredFile` 行とオブジェクトは残るので（消えるのは `purgeNote` → `deleteFilesForNote` → `storage.fileDeleted` が回った後、既定で 30 日後）、本文を見たことがある閲覧者は削除後もメディアを読み続けられる。AC-9 の「削除後は公開・共有 URL からアクセスできなくなる」はノート URL の話なのでこれ自体は違反ではないが、`spec/domains/storage.md` に加えられた根拠（「読める条件は鍵を知っていること」）はこの帰結まで書き切っていない。
- 提案: `spec/domains/storage.md` の `publicUrl` の節に「非公開化・ゴミ箱移動はメディア URL を失効させない。失効は purge のとき」の 1 文を足す。実装変更は不要（capability URL の設計を選んだ以上の帰結）。

**[W-005]** 許可 purpose 集合の型が緩く、`FilePurpose` の増減に追随しない

- 場所: `apps/web/app/routes/storage.$.tsx:13`（`const PUBLICLY_SERVED_PURPOSES: readonly string[]`）、`apps/web/app/routes/__tests__/storage.delivery.test.ts:105`
- 理由: JSDoc は「`ObjectStorage.publicUrl` の契約 / `spec/domains/storage.md` / このルートの 3 か所を同時に動かす」と宣言しているのに、3 か所のうち唯一機械が守れる箇所（型）を `string[]` に落としているため、`FilePurpose` に purpose が増えても、綴りを間違えても何も気付かない。テスト側の拒否リストも `["source","reference","artifact"]` のハードコードなので、新しい purpose は自動では覆われない。
- 提案: `readonly FilePurpose[]` に型付けし、テストは `FILE_PURPOSES`（あるいは `isFilePurpose` の元集合）から許可集合を引いた差分をループする形にする。

**[W-006]** `resolveEditableNote` の引き直しが spec の「scope miss は 1 回だけ引き直す」より広い

- 場所: `packages/core/src/application/storage/storeMedia.ts:resolveEditableNote`（`const resolved = (await read()) ?? (await read());`）
- 理由: `spec/usecases/storage.md#storeMedia` 手順 1 は「scope miss は primary で 1 回だけ引き直す」。実装は `read()` が `null` を返す**あらゆる**理由（存在しないノート ID を含む）で 2 回目を走らせるので、存在しない ID を投げるだけで route 解決 + scope 読みが常に 2 倍になる。認証済みユーザーからの探索でしか踏めないので危険度は低いが、契約より広い挙動である。
- 提案: 「1 回目で route が解決できたのに scope 側が空だった」ケースに絞る（`resolveNote` の結果を持って比較する）か、spec を実装に合わせて「ノートが読めなければ 1 回だけ引き直す」に書き換える。

**[W-007]** `asStandaloneSvg` の開始タグ抽出が属性値中の `>` で切れる

- 場所: `packages/core/src/application/storage/storeMedia.ts:asStandaloneSvg`（`markup.indexOf(">", root.index)`）
- 理由: parse5 の直列化は属性値中の `>` をエスケープしない（プローブで `<svg data-x="a>b"><rect></rect></svg>` を確認済み）。したがって `openTag` は `<svg data-x="a` で切れ、`openTag.includes(" xmlns=")` のガードが誤判定しうる。今は `xmlns` がサニタイズで必ず落ちる（parse5 が XMLNS 名前空間を付けるため `attributeName()` が突き合わせに失敗する）ので実害は無いが、`allowList.ts:ALLOWED_SVG_ATTRIBUTES` には `"xmlns"` が載っており、属性の突き合わせがローカル名基準に変わっただけで `xmlns` が二重宣言され、XML 致命エラーで SVG が描画されなくなる。ガードが機能していないこと自体はテストでも見えない。
- 提案: 開始タグの終端は `>` の素朴な検索ではなく、直列化直後の文字列に対して属性境界を意識した走査にするか、そもそも `xmlns` は「必ず落ちる」前提を明示して `openTag` を見ない形にする（`ALLOWED_SVG_ATTRIBUTES` の `"xmlns"` が到達不能なら ADR 013 側から外す）。

**[W-008]** ドキュメントの取り残し 2 件（本 PR で隣接記述を更新しているのに未追随）

- 場所:
  - `spec/inventory/usecase.md:105`（UC-storage-003）— 「型は**先頭バイトの署名**から」のまま。本 PR は `spec/domains/storage.md` の同じ記述を「**バイト列そのもの**から」に改め、SVG は署名を持たず先頭 4096 バイトの復号で判定する形にした。台帳だけが古い。
  - `spec/testcases/storage/deleteFilesForNote.md`（冪等の行）— 「削除済みのファイルは `listByNote` に現れず」。実装とポートは `listDeletableByNote` で、`listByNote`（ADP-storage-006）はこの経路では使わない。同ファイルは本 PR で編集されている。
- 理由: いずれも `spec/` を正典として読む次のスライスが誤った前提を引く。
- 提案: 2 行とも実装側の語彙へ揃える。

**[W-009]（既存の問題）** `StorageQuota` の加算経路が実在せず、`ensureUploadAllowed` の容量ゲートは実行時には作動しない

- 場所: `packages/core/src/application/usage/`（`applyStorageDelta` が未実装）、`packages/core/src/application/workers/subscribers.ts:156-220`
- 理由: `spec/inventory/usecase.md:132` の UC-usage-003 `applyStorageDelta`（`storage.fileStored` / `fileDeleted` を購読して `consumedBytes` を加減算する）はファイルが存在せず、`domainEventSubscribers` にも `storage.fileStored` の購読者は 1 件も無い。`recalculateStorageUsage` は実装済みだが呼び出し側がテスト以外に無い。したがって稼働中のランタイムでは `consumedBytes` は永久に 0 のままで、AC-6 の「容量不足は弾かれ」は end-to-end では到達不能である。`TC-storage-183` が緑なのは、テストが `seedPersonalQuota` で行を直接仕込んでいるため。
- 本 PR が壊したものではない（`storeAvatar` も同じ状態で、`applyStorageDelta` は Usage スライスの持ち分）。ただし本スライスが初めて容量ゲートを AC に載せた以上、`.thread/7/plan.md` の「含まれないもの」か Issue 側に「容量ゲートは `applyStorageDelta` が来るまで実測値では作動しない」ことを 1 行残すのが妥当。

#### テスト保証

確認できた主要な挙動（`--project node` / `--project workers` とも green、198 + 549 tests）。

- 受理判定は 7 形式すべてをバイト列から決める。PNG / JPEG / GIF(87a,89a) / WebP(RIFF+WEBP) / MP4(`ftyp`+ブランド集合) / WebM(EBML+DocType) / SVG(プロローグ走査) — `domain/storage/__tests__/storage.test.ts`「reads every accepted media format out of its own bytes」。
- 似て非なるものを拒否する。`<html><body><svg/></body></html>` / コメント内の `<svg/>` / `ftyp` + `heic` ブランド / EBML + `matroska` DocType / PDF — 同ファイル `TC-storage-179`。
- SVG の上限はラスタと別（128 KB、境界の ±1 バイト）で、動画は 200 MB、画像は 20 MB。同ファイル `TC-storage-181/180/182`。
- SVG は保管前にサニタイズされ、保管されるのはサニタイザ出力そのもの。`script` / `foreignObject` / `on*` / 外向き `href`・`xlink:href` が消え、図形・パス・グラデーション・同一文書内 `use` は残る — `storeMedia.test.ts` `TC-storage-176/177/178`。プローブでも `<style>@import>`、`<animate>`、`<image href=…>` の除去を独立に確認した。
- 名前空間の付け直しは `xmlns` を必ず 1 回、`xlink:` が残ったときだけ `xmlns:xlink` を 1 回（`split(...)` の長さで重複も検証している）— 同 `TC-storage-176` 3 件。
- サニタイズ後の測り直しで拒否され、**オブジェクトも行も残らない** — `TC-storage-251` / `TC-storage-252`（`&` が `&amp;` に膨らむ入力で実際に膨張を作っている）。
- 保管トランザクション失敗時にオブジェクトがロールバックされる — 「rolls the stored object back when the transaction fails」。
- 権限・存在・move 窓・`purging` route の 4 経路がすべて `NOTE_NOT_FOUND` に畳まれ、`purging` では 1 バイトも書かない — `TC-storage-184/185/186/187`。
- 配信口は `avatar` / `media` を 200 で返し、`source` / `reference` / `artifact` と未知の鍵・別形の鍵を 404 にする。SVG は `nosniff` + `sandbox; default-src 'none'` を伴う — `apps/web/app/routes/__tests__/storage.delivery.test.ts` 4 件。本文が持つ住所（`publicUrl`）と配信経路が同じ鍵を見ることも同テストで通っている。
- `listByPurposeOlderThan` のキーセットが契約どおり: 古い順（`id` 順とは逆になる並びで検証）、`createdBefore` 包含、`limit<=0` は空、`after` は**厳密に**先へ進む、カーソル行を削除しても位置は解決する — `adapters/conformance/storedFileRepository.ts` の `ADP-storage-010` 2 件を memory / cloudflare の両バックエンドが同一に通過。
- `listDeletableByNote` は `source`/`media`/`reference` だけを id 順・`limit` 丁度で切り、`artifact` と他ノート・avatar を除く — 同 `ADP-storage-007`。
- 掃引が spin しないこと・満ページの先へ進むことが**ワーカー面から**実証されている。参照され続ける 100 件の後ろに置いた `file-100` を 2 turn 目が回収し、3 turn 目は due が無い — `collectOrphanMedia.test.ts` `TC-storage-254` 2 件。継続条件が「回収数」ではなく「ページが満ちたか」であることも 0 件回収の turn で押さえている。
- 掃引行の武装が「初めての保管」ではなく「初めての流入」で、2 回目以降は `dueAt` を押し出さない — `TC-storage-026`（`storeMedia` 側 1 件 + `relocateFilesForNote` 側 3 件）。
- 読めない payload は失敗させず先頭から — `TC-storage-255`。
- `deleteFilesForNote` が 250 行を 100 件ずつ同じ token で継続し、完了済み障壁でも通り、他 operation の token は拒否し、再配送は 0 件で終わる — `deleteFilesForNote.test.ts` `TC-storage-051`〜`062`。

守られていない挙動は B-001 / W-001 / W-002 に立てた。

#### カバレッジ

確認（27 件）:

- `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `apps/web/app/routes/storage.$.tsx`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/relocateFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- `packages/core/src/application/storage/collectOrphanMedia.ts`
- `packages/core/src/application/storage/deleteFilesForNote.ts`
- `packages/core/src/application/storage/relocateFilesForNote.ts`
- `packages/core/src/application/storage/storeMedia.ts`
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/usage/__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/usage/ensureUploadAllowed.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `spec/domains/storage.md`
- `spec/testcases/storage/collectOrphanMedia.md`
- `spec/testcases/storage/deleteFilesForNote.md`
- `spec/testcases/storage/storeMedia.md`
- `spec/usecases/storage.md`

判断のために差分外も参照（レビュー対象一覧には含まれないもの）: `packages/core/src/adapters/html/allowList.ts`、`packages/core/src/adapters/html/htmlProcessor.ts`（実行プローブを含む）、`packages/core/src/application/storage/deleteFiles.ts`、`packages/core/src/application/cleanup/notePurgeFanOut.ts`、`packages/core/src/domain/storage/valueObject.ts`、`packages/core/src/application/ports/idGenerator.ts`、`packages/core/src/domain/note/valueObject.ts`、`packages/core/src/domain/note/noteRevision.ts`、`packages/core/src/application/note/moveNote.ts`、`packages/core/src/application/usage/recalculateStorageUsage.ts`、`apps/web/app/components/note/schema.ts`、`apps/web/app/routes/notes/-action.tsx`、`spec/inventory/{adapter,test,usecase}.md`。

スキップ（144 件 — storage 分担外。note / tag / integration / identity / cleanup / DI / フロントエンドのエディタとゴミ箱・共通アダプター基盤・他ポートの conformance など、他レビュアーの持ち分）:

- `apps/web/app/components/layout/ScopeToken/index.tsx`
- `apps/web/app/components/layout/ScopeToken/listing.ts`
- `apps/web/app/components/note/NoteDetail/detail.tsx`
- `apps/web/app/components/note/NoteDetail/index.tsx`
- `apps/web/app/components/note/NoteDetail/menu.tsx`
- `apps/web/app/components/note/NoteEditor/editor.tsx`
- `apps/web/app/components/note/NoteEditor/frame.tsx`
- `apps/web/app/components/note/NoteEditor/highlight.ts`
- `apps/web/app/components/note/NoteEditor/index.tsx`
- `apps/web/app/components/note/NoteEditor/preferences.ts`
- `apps/web/app/components/note/NoteEditor/skeleton.tsx`
- `apps/web/app/components/note/NoteEditor/surfaces.tsx`
- `apps/web/app/components/note/NoteEditor/textNodes.ts`
- `apps/web/app/components/note/NoteList/board.tsx`
- `apps/web/app/components/note/NoteList/index.tsx`
- `apps/web/app/components/note/schema.ts`
- `apps/web/app/components/note/TrashList/action.ts`
- `apps/web/app/components/note/TrashList/board.tsx`
- `apps/web/app/components/note/TrashList/index.tsx`
- `apps/web/app/presentation/__tests__/errorDisplay.test.ts`
- `apps/web/app/presentation/__tests__/errorResponse.test.ts`
- `apps/web/app/presentation/errorDisplay.ts`
- `apps/web/app/routes/notes/-action.tsx`
- `apps/web/app/routes/notes/$noteId_.edit.tsx`
- `apps/web/app/routes/notes/new.tsx`
- `apps/web/app/routes/notes/trash.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/$noteId_.edit.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/new.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/trash.tsx`
- `apps/web/app/routeTree.gen.ts`
- `packages/core/package.json`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts`
- `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/backupRecordRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts`
- `packages/core/src/adapters/cloudflare/do/schema.ts`
- `packages/core/src/adapters/conformance/backend.ts`
- `packages/core/src/adapters/conformance/backupRecordRepository.ts`
- `packages/core/src/adapters/conformance/noteRepository.ts`
- `packages/core/src/adapters/conformance/noteRouteStore.ts`
- `packages/core/src/adapters/conformance/tagAssignmentRepository.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`
- `packages/core/src/adapters/html/allowList.ts`
- `packages/core/src/adapters/html/css.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts`
- `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/memory/repositories/backupRecordRepository.ts`
- `packages/core/src/adapters/memory/repositories/noteRepository.ts`
- `packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts`
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts`
- `packages/core/src/adapters/memory/store.ts`
- `packages/core/src/application/cleanup/notePurgeFanOut.ts`
- `packages/core/src/application/cleanup/participants.ts`
- `packages/core/src/application/di/cloudflareRuntime.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
- `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
- `packages/core/src/application/integration/__tests__/deleteBackupRecordsForNote.test.ts`
- `packages/core/src/application/integration/deleteBackupRecordsForNote.ts`
- `packages/core/src/application/note/__tests__/applyTextNodeEdits.test.ts`
- `packages/core/src/application/note/__tests__/changeNoteStyleMode.test.ts`
- `packages/core/src/application/note/__tests__/deleteNotesForOwner.test.ts`
- `packages/core/src/application/note/__tests__/editingHarness.ts`
- `packages/core/src/application/note/__tests__/emptyTrash.test.ts`
- `packages/core/src/application/note/__tests__/listNoteRevisions.test.ts`
- `packages/core/src/application/note/__tests__/listNotes.test.ts`
- `packages/core/src/application/note/__tests__/listTrashedNotes.test.ts`
- `packages/core/src/application/note/__tests__/purgeExpiredTrash.test.ts`
- `packages/core/src/application/note/__tests__/purgeNote.test.ts`
- `packages/core/src/application/note/__tests__/renameNote.test.ts`
- `packages/core/src/application/note/__tests__/restoreNote.test.ts`
- `packages/core/src/application/note/__tests__/restoreNoteRevision.test.ts`
- `packages/core/src/application/note/__tests__/trashNote.test.ts`
- `packages/core/src/application/note/__tests__/updateNoteBody.test.ts`
- `packages/core/src/application/note/applyTextNodeEdits.ts`
- `packages/core/src/application/note/changeNoteStyleMode.ts`
- `packages/core/src/application/note/deleteNotesForOwner.ts`
- `packages/core/src/application/note/editing.ts`
- `packages/core/src/application/note/emptyTrash.ts`
- `packages/core/src/application/note/getNote.ts`
- `packages/core/src/application/note/jobs.ts`
- `packages/core/src/application/note/listNoteRevisions.ts`
- `packages/core/src/application/note/listTrashedNotes.ts`
- `packages/core/src/application/note/moveNote.ts`
- `packages/core/src/application/note/purgeExpiredTrash.ts`
- `packages/core/src/application/note/purgeNote.ts`
- `packages/core/src/application/note/renameNote.ts`
- `packages/core/src/application/note/restoreNote.ts`
- `packages/core/src/application/note/restoreNoteRevision.ts`
- `packages/core/src/application/note/trashNote.ts`
- `packages/core/src/application/note/updateNoteBody.ts`
- `packages/core/src/application/note/view.ts`
- `packages/core/src/application/ports/noteMovePort.ts`
- `packages/core/src/application/ports/noteRouteStore.ts`
- `packages/core/src/application/tag/__tests__/deleteAssignmentsForNote.test.ts`
- `packages/core/src/application/tag/deleteAssignmentsForNote.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/domain/integration/__tests__/valueObject.test.ts`
- `packages/core/src/domain/integration/backupRecord.ts`
- `packages/core/src/domain/integration/errorCode.ts`
- `packages/core/src/domain/integration/ports/backupRecordRepository.ts`
- `packages/core/src/domain/integration/valueObject.ts`
- `packages/core/src/domain/note/__tests__/noteAccessPolicy.test.ts`
- `packages/core/src/domain/note/noteRevision.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/noteRepository.ts`
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`
- `packages/core/src/domain/tag/__tests__/valueObject.test.ts`
- `packages/core/src/domain/tag/errorCode.ts`
- `packages/core/src/domain/tag/ports/tagAssignmentRepository.ts`
- `packages/core/src/domain/tag/tagAssignment.ts`
- `packages/core/src/domain/tag/valueObject.ts`
- `pnpm-lock.yaml`
- `spec/adr/013-html-sanitization-policy.md`
- `spec/domains/integration.md`
- `spec/domains/note.md`
- `spec/domains/tag.md`
- `spec/inventory/adapter.md`
- `spec/inventory/test.md`
- `spec/inventory/usecase.md`
- `spec/manual-tests/editing.md`
- `spec/pages/index.md`
- `spec/platform/index.md`
- `spec/presentation/index.md`
- `spec/testcases/integration/deleteBackupRecordsForNote.md`
- `spec/testcases/note/emptyTrash.md`
- `spec/testcases/tag/deleteAssignmentsForNote.md`
- `spec/usecases/integration.md`
- `spec/usecases/note.md`
- `spec/usecases/tag.md`
