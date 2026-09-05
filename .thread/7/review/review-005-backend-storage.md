# レビュー 005 — backend-storage

対象: `packages/core/src/domain/storage/`、`packages/core/src/application/storage/`、`packages/core/src/application/usage/`、両バックエンドの `storedFileRepository`、`adapters/conformance/storedFileRepository.ts`、`apps/web/app/routes/storage.$.tsx` と配信経路、`spec/domains/storage.md` / `spec/usecases/storage.md` / `spec/testcases/storage/` / `spec/database/index.md`。

`.thread/7/review/triage-keys.md` の判定済みキー（`[W-003] routes/storage.$.tsx:GET` の Range 非対応、`[W-006] storeMedia.ts:resolveEditableNote`、`[W-006] spec/domains/storage.md:273`、`[W-009] application/usage/`、`[W-003] spec/adr/013:163`）は再掲しない。

### backend-storage

#### Blockers

**[B-001]** `domain/storage/services/uploadValidationPolicy.ts:MEDIA_SVG_MAX_BYTES` — 128 KB の有界性の根拠が成立していない。整形式な XML でも parse5 は要素を複製し、実測で 86 倍に膨らむ

- 場所（共通原因 1 件に集約）:
  - `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:33-41`（`MEDIA_SVG_MAX_BYTES` の JSDoc「For a well-formed document the HTML parser duplicates no element … the only growth left is character escaping, at most six bytes for one」）
  - `packages/core/src/application/storage/storeMedia.ts:178-184`（`sanitizeSvg` の JSDoc「no input this policy accepts can serialize into a value the body's invariant refuses, so an oversized SVG is refused as `FileTooLarge` in Storage's own vocabulary rather than as a note that is too long」）
  - `spec/domains/storage.md:197` / `spec/domains/storage.md:199`（「1 バイトが増えるのは最大 6 倍」「整形式であることを受理の条件に置くと複製そのものが起きなくなり、残る膨張は文字のエスケープだけになる」）
  - `spec/usecases/storage.md:149`（「壊れた markup をサニタイザーへ渡すと…二乗に膨らみ」— 膨張を「壊れた入力」に限定している）

- **反例（すべて整形式・すべてのタグが閉じ・入れ子は 63 段で `MEDIA_SVG_MAX_DEPTH` 以内）**:

  ```
  <svg><table><b a="0">…<b a="61">  (b を 62 段、属性は全部違う)
    <tr>X</tr> を 13,018 回
  </b>…</b></table></svg>
  ```

- 実測（本レビュー中に一時テストを置いて実コードを通し、確認後に削除済み）:
  - `readSvgDocument(src)` → **non-null**（受理）
  - `UploadValidationPolicy.ensureAcceptable({ purpose: "media", body })` → **`image/svg+xml` として受理**（100,856 バイトの版で確認）
  - `createHtmlProcessor().process(src)` → **`BusinessRuleError` / `code: "NOTE_CONTENT_TOO_LARGE"` / `"Note HTML exceeds 800000 bytes"`**
  - 入出力の実測（parse5 8.0.1 単体、`table`/`tbody`/`tr`/`td`/`b` はいずれも `allowList.ts:47,52,54,56,70` の許可集合にあるのでサニタイズ後も残る）:

    | 入力 | 出力 | 倍率 | 所要 |
    |---|---|---|---|
    | 131,064 B（k=62, m=13,018） | 11,300,523 B | **86.2×** | 886 ms |
    | 131,066 B（k=60, m=13,021） | 10,938,511 B | 83.5× | 772 ms |
    | 131,066 B（k=10, m=13,091） | 1,832,911 B | 14.0× | 247 ms |

- 機構: `<table>` / `<b>` はどちらも foreign content の breakout tag なので、parse5 は `<svg>` を pop して HTML の "in body" / "in table" に戻る。`<tr>` は "clear the stack back to a table context" を走らせ、foster parent された `<b>` を **open elements からは pop するが active formatting elements のリストからは外さない**。次の `<tr>` 直下のテキストは "in table text" → "in body" の規則で処理され、その先頭が "reconstruct the active formatting elements" なので、**行ごとに k 個の `<b>` が作り直される**。属性 `a` を全部違えることで Noah's Ark clause（同一要素 3 個の上限）を回避し、テキストを `<td>` ではなく `<tr>` 直下に置くことで `<td>` が挿入する marker（reconstruct を止める）を回避している。**閉じていないタグも食い違いも一切要らない**ので、`readSvgDocument` の整形式判定は素通りする。
- 帰結は 2 つ:
  1. **語彙の破れ** — 受理された SVG が Note の `NOTE_CONTENT_TOO_LARGE` で落ちる。これは TC-storage-251 / TC-storage-267 が「もう起きない」と書いている失敗そのもの（`storeMedia.test.ts:479` のコメント「used to fail as `NOTE_CONTENT_TOO_LARGE` — Note's invariant, for a Storage intake」）。
  2. **増幅 DoS** — 編集権のある利用者が 128 KB を投げるだけで 1 リクエストあたり約 11 MB の文字列と 60 万超のノードが作られ、CPU は 0.9 秒。最終形の Cloudflare Workers（メモリ 128 MB / CPU 予算）では数本の同時アップロードで scope を落とせる。しかも `ensureUploadAllowed` の容量判定より**後**、オブジェクト書き込みより**前**なので、容量ゼロの利用者でも到達する。
- 既存テストが取り逃がす理由: TC-storage-267（`storeMedia.test.ts:730`）が試すのは `<b><p>` / `<em><p>` / `<b><i><p>` の**閉じない**反復のみで、これは `readSvgDocument` が整形式でないとして弾く経路。閉じた入力での複製は 1 件も無い。
- 直し方の候補（安い順）:
  - `readSvgDocument` の受理条件に **HTML breakout tag（`b` / `table` / `p` / `font` / `nobr` ほか、HTML 仕様の foreign content breakout 集合）の要素名を拒む**を足す。これらは `ALLOWED_SVG_ELEMENTS` の部分集合に元々 1 つも残らないので、拒んで失うものは無く、foster parenting の経路ごと消える
  - あるいは長さではなく**要素数**にも上限を置く（複製は `深さ × 要素数` に効くので、`MEDIA_SVG_MAX_DEPTH × 要素数 ≤ 定数` が本当の有界条件）
  - あるいは `MEDIA_SVG_MAX_BYTES` を実際の上界 `800,000 / MEDIA_SVG_MAX_DEPTH ≈ 12 KB` まで下げる（実用に耐えないので上 2 つが本線）
- いずれにせよ **JSDoc 2 か所と `spec/domains/storage.md:197-199` の「6 倍」の議論は、いま書かれているままでは偽**なので、根拠の書き換えが直しとセットで要る。

#### Warnings

**[W-001]** `application/storage/storeMedia.ts:252-261` — 容量判定がサニタイズ**前**のバイト長で行われ、行に載る値・容量に効く値と食い違う

- `ensureUploadAllowed` に渡すのは `accepted.size`（受け取ったバイト列の長さ）だが、`StoredFile.register` に載るのは `stored.size`（サニタイズ後）で、容量デルタもそちらから出る。同ファイル 268-271 のコメントが「The stored bytes are what fills the subject's capacity and what the row records」と書いているのに、容量の門だけがその値を見ていない。
- SVG は膨らむ側にも縮む側にも動くので、(a) 残容量ぎりぎりの subject が 1 回のアップロードで最大 128 KB 弱を超過でき、(b) 逆にサニタイズで縮んで収まるはずの SVG が拒否されうる。上限が 128 KB なので影響は小さいが、`spec/usecases/storage.md:153`（手順 5）は食い違いを**事実として記すだけ**で、なぜ許容できるのかを書いていない。
- 直しは、(i) 手順 5 のサイズ再測定と同じ位置で容量を測り直す、または (ii) SVG では `MEDIA_SVG_MAX_BYTES` を上界として容量を判定する、のどちらか。どちらも取らないなら「超過は 128 KB で有界なので許容する」を spec に明記したい。

**[W-002]** `application/storage/collectOrphanMedia.ts:442-509` — 1 turn の本文解析（最大 105 本 × 800,000 バイト）が scope の UoW トランザクションの**内側**で走る

- `sweepOnce` は `scopeUnitOfWorkProvider.run(input.scope, …)` のコールバックの中で `readNoteReferences`（286-312）を呼び、その中で `container.htmlProcessor.extractExternalReferences(html)` を回す。`ORPHAN_MEDIA_NOTE_BUDGET = 5` × `NoteRevision.RETENTION + 1` で最大 105 本、本文は `NoteHtml` の上限まで許されるので最悪 80 MB 超の HTML を 1 トランザクション内で parse5 に通すことになる。
- 同ファイル 356-359 の JSDoc は「Deciding and deleting are separate transactions」と削除側だけを分けているが、重い側は**判定**で、それが 1 本の長いトランザクションに入っている。Cloudflare の scope = Durable Object では、この間その scope へのあらゆる要求が待たされる（`spec/platform/index.md`「実行予算と分割単位」の趣旨に反する）。
- ポートが UoW 経由でしか触れない以上、読み取り自体は中に置くほかないが、**本文の文字列を集めるところまでをトランザクション内に、解析（純関数）を外に**出せば同じ判定が保てる。`htmlProcessor` は 175-180 の `OrphanMediaContainer` で「pure computation なので外で読む」と宣言されているのに、実際の呼び出しだけが中に残っている形でもある。

#### テスト保証

担保できているもの:

- **キーセット述語の 3 点一致**（今ラウンドの重点）— 一致している。ポート JSDoc（`domain/storage/ports/storedFileRepository.ts:77-101`）が `createdBefore` 包含 / `after` 排他 / `(createdAt asc, id asc)` の全順序を契約として書き、memory（`adapters/memory/repositories/storedFileRepository.ts:24-32` の `isPastCursor`、88-109）と cloudflare（`adapters/cloudflare/do/repositories/storedFileRepository.ts:442-497`、SQL の行値 `(created_at, id) > (?, ?)` と、session バッファ側の `matches` 述語 488-494）が同じ述語を表している。索引 `stored_files_purpose_created_idx (purpose, created_at, id)`（`do/schema.ts:303-304`）が行値の seek 下界になり、`spec/database/index.md:476` の記述とも一致。
- **conformance がその契約を実効的に押さえている** — `adapters/conformance/storedFileRepository.ts:254`（境界包含・purpose 分離・limit 0・古い cutoff）、`:302`（同時刻 3 件を跨ぐ厳密前進、カーソル行を削除しても位置が解ける）、`:364`（instant を先に比べる — 独立に比べる実装なら落ちる）。3 本とも memory（`memory/__tests__/conformance.test.ts:77`）と cloudflare（`cloudflare/__tests__/conformance/scopeBusiness.test.ts:15`）の両方が同じスイートを通る。`conformanceCoverage.test.ts` が呼び出し漏れを textual に固定。
- **孤児掃引の予算と失敗 turn の位置保持**（今ラウンドの重点）— 担保されている。`collectOrphanMedia.test.ts:731`（TC-storage-259: ノート予算で打ち切り、判定済みの最後の行から継続）、`:660` / `:694`（TC-storage-258: turn 全体の失敗で日次に張り直し、**開始位置を保持**）、`:470` / `:502`（TC-storage-254: 全件参照済みの満ページの後ろにある孤児に到達する）、`:558`（TC-storage-255: 読めない payload は先頭から）、`:581`（runner 経由で掃き切るまで再開される）。コード側も `sweepOnce:462-501` が `break` の前に `judgedThrough` を進めないので、予算で止めた行は次 turn で読み直される。
- **メディア受理の形式判定** — `domain/storage/__tests__/storage.test.ts:297`（7 形式をバイト列から読む）、`:325`（`<html><body><svg/>`・コメント内の `<svg/>`・`ftyp` + `heic`・EBML + `matroska`・PDF を拒む — 署名だけでは通らないことを実際に突いている）、`:348` / `:355`（20 MB / 128 KB の両境界と、SVG だけ別上限であること）。
- **SVG の XML 整形式判定**（受理時・サニタイズ後の両側）— `storeMedia.test.ts:534`（`</svg>` の後ろの内容）、`:554`（`trim()` は空白と呼ぶが XML は呼ばない文字）、`:572`（XML の `S` 4 文字は許す）、`:607`（属性値中の `</svg>` 様の文字列）、`:623`（U+00A0 → `&#160;`）、`:641`（`<desc>` 配下で HTML 解析が再開する経路）、`:665`（C0 制御文字・閉じないタグ・`&nbsp;`・生の `<`）、`:679`（コメント内の `&`）、`:696`（64 段 / 65 段の境界 + `RangeError` 経路）。
- **配信経路** — `apps/web/app/routes/__tests__/storage.delivery.test.ts:106` が `FILE_PURPOSES` の**補集合**を走査して非公開 purpose が 404 になることを確かめており、purpose が増えたときにこのファイルを編集しなくても落ちる形になっている。`:90` が `nosniff` + `sandbox; default-src 'none'` を固定。
- **ドキュメント整合** — TC-storage-251〜268 の 18 件すべてが `spec/inventory/test.md` に登録済み。`spec/usecases/storage.md` の `storeMedia` 手順 1〜7 / `collectOrphanMedia` 手順 1〜3 とエラーケース表は実装と一致（手順 6 のオブジェクト巻き戻しも `storeMedia.ts:327-341` に実在）。`spec/domains/storage.md` の `publicUrl` 節の 3 か所（ポート JSDoc / `storage.$.tsx:20-23` / spec）が同じ集合 `["avatar","media"]` を持つ。
- **記述の衛生** — `packages/core/src/` / `apps/web/app/` / `spec/` のいずれにも `.thread/` への参照は無い（grep 済み）。

担保できていないもの:

- **整形式な入力による parser 側の複製** — [B-001]。TC-storage-267 は閉じない整形要素だけを試しており、閉じた入力（`<table>` + foster parenting 経路）を突くケースが 1 件も無い。直しに合わせて「整形式でも breakout tag を含む SVG は拒否される」ケースが要る。
- **容量判定とサニタイズ後サイズの食い違い** — [W-001]。`storeMedia.test.ts:859`（TC-storage-189）は「保管したバイト数が容量に効く」を確かめるが、**PNG**（サニタイズで長さが変わらない形式）で確かめているため、SVG で判定対象と記録対象がずれる経路は未検証。
- **孤児掃引の判定トランザクションの長さ** — [W-002]。予算（件数）は押さえられているが、1 トランザクションが保持される時間・解析総バイト数を観測するテストは無い（性質上ユニットテストでは押さえにくく、指摘は設計側）。

#### カバレッジ

読んだファイル（差分内・担当分）:

- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/application/storage/storeMedia.ts`
- `packages/core/src/application/storage/collectOrphanMedia.ts`
- `packages/core/src/application/storage/deleteFilesForNote.ts`
- `packages/core/src/application/storage/relocateFilesForNote.ts`
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/relocateFilesForNote.test.ts`
- `packages/core/src/application/usage/ensureUploadAllowed.ts`
- `packages/core/src/application/usage/__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/schema.ts`（`stored_files` の定義と索引）
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/conformance/backend.ts`（`storedFileRepository` の宣言）
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts` / `cloudflare/__tests__/conformance/scopeBusiness.test.ts` / `cloudflare/__tests__/ports/scopeBusiness.ts` / `adapters/__tests__/conformanceCoverage.test.ts`（storage 分の配線）
- `packages/core/src/application/workers/scopeTaskRunner.ts`（`ORPHAN_MEDIA_TASK_KIND` / `NOTE_FILE_DELETE_TASK_KIND` の配線）
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `spec/domains/storage.md` / `spec/usecases/storage.md` / `spec/database/index.md`
- `spec/testcases/storage/collectOrphanMedia.md` / `deleteFilesForNote.md` / `storeMedia.md`
- `spec/inventory/adapter.md` / `spec/inventory/test.md`（storage 行）

差分外で参照したもの（判断に必要だったため）:

- `packages/core/src/adapters/html/htmlProcessor.ts`（parse5 の `parseFragment` / `serialize` と `NoteHtml.create` の位置）
- `packages/core/src/adapters/html/allowList.ts`（`table` / `tbody` / `tr` / `td` / `b` が許可集合にあること）
- `packages/core/src/domain/note/valueObject.ts`（`CONTENT_MAX_BYTES = 800_000`）
- `packages/core/src/domain/storage/valueObject.ts`（`StoredFileId.create` の検証範囲）
- `packages/core/src/application/note/moveNote.ts`（`stageTarget` がノート行と storage 行を同一トランザクションで置くこと＝孤児掃引が移動中のメディアを回収しないことの確認）
- `packages/core/src/application/note/noteRevision.ts` 相当の `NoteRevision.RETENTION`

スキップしたファイル: なし（担当範囲のうち差分に現れたものはすべて読んだ）。担当外として読んでいないのは note / tag / integration / frontend の各担当分。
