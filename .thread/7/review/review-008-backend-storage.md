# レビュー 008 — backend-storage

### backend-storage

#### Blockers

##### [B-001] spec/domains/storage.md:197 / domain/storage/services/uploadValidationPolicy.ts:25-57 — `MEDIA_SVG_MAX_BYTES` の根拠が実測と食い違い、`NOTE_CONTENT_TOO_LARGE` を出さない約束の余裕が 1.74% しか無い

canon は 128 KB の**唯一の**根拠として次を置いている。

> `process` は解析後の木を**入力長の 4 倍**（下限 262,144 バイト）で打ち切るので、131,072 バイトの入力が直列化しうる長さは 524,288 バイトを超えられず、本文の 800,000 バイトの内側に必ず収まる — 入力がどんな形であってもである。（spec/domains/storage.md:197）

同じ文が `uploadValidationPolicy.ts:36-40` の JSDoc にもある。**これは偽である。**

実測（本レビューで作成し削除済みのプローブ）:

```
input:  <svg xmlns="http://www.w3.org/2000/svg"><text transform='"""…"'/></svg>
        （生の `"` で 131,072 バイトちょうどに詰める。単一引用符の属性値なので XML として整形式）
ensureAcceptable({ purpose: "media", body }) → { mimeType: "image/svg+xml", size: 131072 }  受理される
htmlProcessor.process(src).html                → 786,073 バイト
```

524,288 の 1.5 倍、`NoteHtml` の 800,000 バイト上限まで残り **13,927 バイト（1.74%）**。原因は 2 つあり、どちらも「木の大きさ＝直列化長」という前提の破れである。

1. **メーターはエスケープ前の長さを課金する。** `createElement` は `attribute.value.length` を、`insertText` は `text.length` をそのまま引くが（`adapters/html/htmlProcessor.ts:838-856`）、parse5 の直列化は属性値の `"` を `&quot;` に、`&` を `&amp;`、nbsp を `&nbsp;` に展開する。生の `"` は 1 課金 → 6 出力で、**倍率 6**。ADR 013:185 の表の「解析後の木の大きさ（**直列化したときの長さで測る**）」という記述自体がここで不正確になっている。
2. **単位が揃っていない。** `expansionAllowance(html.length)` は UTF-16 code unit で数え、`NoteHtml.create` は `exceedsUtf8Bytes` で UTF-8 バイトを数える（`domain/note/valueObject.ts:88`）。同じ「524,288」が両側で別の量を指している。

結果として、`spec/testcases/storage/storeMedia.md` の TC-storage-251 が明示的に置いた約束

> 128 KB を超える SVG をアップロードする → `BusinessRuleError(FileTooLarge)`（**本文の上限に触れて `NOTE_CONTENT_TOO_LARGE` になることはない**）

を支えているのは、canon に書かれていない別の議論だけになっている。実際に成立させているのは (a) サニタイザーが `<svg>` 配下で複製されうる HTML の整形要素（`a` / `font` / `b` …）をすべて許可リストから落とすため adoption agency の複製が直列化まで生き残らないこと、(b) parse5 のエスケープ倍率の最大が 6 であること、の 2 つで、6 × 131,072 = 786,432 < 800,000 という**偶然 1.7% だけ内側**の関係である。128 KB を上げる、`NoteHtml` の上限を下げる、許可リストに整形要素を 1 つ足す、parse5 のエスケープ集合が広がる — いずれも約束を静かに壊す。

直すべきは値ではなく根拠である。

- ADR 013:185 の計測単位の記述を実装（エスケープ前・UTF-16 code unit）に合わせる
- spec/domains/storage.md:197 と `uploadValidationPolicy.ts:36-40` の導出を、実際に成立している (a)(b) の議論へ差し替える（あるいは `processSvg` 側で結果長を独立に押さえて導出への依存を切る → W-001）
- 実測の境界（6 倍・786 KB）を回帰として固定する。今のテスト群には「受理された SVG の直列化長がどこまで届くか」を測る行が 1 つも無い

#### Warnings

##### [W-001] application/storage/storeMedia.ts:194-207 `processSvg` — 翻訳が 1 コードだけで、網羅性が B-001 の（偽の）導出に依存している

`processSvg` は `HTML_PROCESSOR_TOO_COMPLEX` だけを `FileTooLarge` へ翻訳する。しかし `HtmlProcessor.process` が Note の語彙で投げうるコードはもう 1 つある — `NoteHtml.create` / `PlainTextContent.create` の `NoteErrorCode.ContentTooLarge`（`domain/note/valueObject.ts:122,140`、`adapters/html/htmlProcessor.ts:1025-1027`）。今日これが到達不能であることは B-001 のとおり「6 × 131,072 < 800,000」という 1.7% の余裕にしか支えられておらず、しかもその論証は canon のどこにも書かれていない。

境界の約束（「Storage の語彙でしか失敗しない」）を導出から独立させるには、`catch` を `NoteErrorCode.ContentTooLarge` にも広げて同じ `FileTooLarge` へ落とすのが最も安い。翻訳先も自然で、サニタイズ後の実バイト長で測り直す手順 4 と同じ答えになる。あわせて spec/usecases/storage.md の手順 3 のエラー表（「サニタイズが資源の上限を超える SVG」の行）に 2 コード目を書く。

##### [W-002] apps/web/app/routes/storage.$.tsx:21-24 / spec/domains/storage.md:357 — 「失効の時点は purge」が、実体の回収に失敗した鍵をカバーしていない

`media` を公開配信に載せた判断と、その帰結（capability URL、purge まで読める）は canon に書かれた。ただし配信口は `StoredFile` の行を見ず**オブジェクトストレージだけ**を引くので、失効が実際に効くのは行の削除ではなく `storage.fileDeleted` の購読者が実体を消したときである。

`deleteStoredObjects` は恒久的に失敗した鍵を「何からも参照されない孤児」として残すことを明示的に許している（TC-storage-071、`__tests__/deleteFiles.test.ts` の該当行）。その孤児は行が消えたあとも**鍵を知っている閲覧者に永久に配られ続ける**。domains/storage.md:357 は「行と実体はノートの完全削除まで残る」としか書いておらず、実体だけが残る経路に触れていない。P-25（削除の約束）を根拠に `Cache-Control: private` を選んでいる以上、この窓は canon 側に明記されるべきである（実装を変えるなら配信口が行を引く必要があるが、鍵から scope が引けないため安くはない — だからこそ「書く」ほうを推す）。

##### [W-003] spec/testcases/storage/collectOrphanMedia.md:17 / spec/inventory/test.md:1811 — `limit` の意味が同じファイルの冒頭と表で食い違う

同ファイル冒頭は本ラウンドで「1 turn は『読む行数』（`limit`）と『本文を読むノート数』の 2 つで有界」と直された。しかし表の TC-storage-025 の行は旧文言「対象が `limit` を超える → **`limit` 件だけ削除される**」のまま残っている。`limit` はもう削除件数の上限ではなく、削除されるのは読んだページ中の孤児だけである（`collectOrphanMedia.ts:529-560` の `candidates` → `decideOrphans` → `orphans`）。台帳 `spec/inventory/test.md:1811` も同じ旧文言。

##### [W-004] spec/inventory/usecase.md:112 — UC-storage-010 の台帳行が本ラウンドの設計変更を反映していない

行の要約は「current scope で作成から 30 日超の media を最大 100 件ずつ調べ、所属 note 本文から参照されない、または note 不在の files を削除して日次・即時継続を設定する」のまま。本ラウンドで入った 4 つの設計判断がどれも載っていない。

- キーセットカーソル（`after` / `nextCursor`。継続条件が「回収できたか」から「まだ検査していない行が残っているか」へ変わった）
- 1 turn が本文を読むノート数の上限（`ORPHAN_MEDIA_NOTE_BUDGET = 5`）
- 参照元に**保持中の版の本文**を数えること（`NoteRevision.RETENTION`）
- turn 全体の失敗を throw せず翌日へ張り直すこと

同じラウンドで ADP-storage-007 / ADP-storage-010 の台帳行（spec/inventory/adapter.md:178,181）は契約の変更を反映して書き直されており、usecase 台帳だけが取り残されている。UC-storage-012 の行も `describePersonalCleanup`（完了済み障壁を通す）への変更が反映されていない。

#### テスト保証

本ラウンドで担保が実効的に増えている点。

- **受理判定（`UploadValidationPolicy`）** — `domain/storage/__tests__/storage.test.ts:50-172` が 7 形式の実バイト判定を 1 テーブルで押さえ、`ftyp` のブランド（HEIC を弾く）、EBML の DocType（Matroska を弾く）、SVG のプロローグ走査、SVG だけ別の上限（128 KB / 20 MB の対比）、breakout tag の 5 つの形（整形要素・table・block・void・大文字綴り）と `font` の条件付き所属（`color` / `face` / `size` を持つときだけ）を個別に検証する。`<a>`・裸の `<font>` が受理されることまで裏側から押さえていて、「名前へ丸めていない」ことが実際にテストされている。
- **境界翻訳（今ラウンドの主眼）** — `application/storage/__tests__/storeMedia.test.ts` の TC-storage-272 が、コメント `<!-->` と処理命令 `<?a>` に隠した breakout tag で **gate を実際に素通りさせたうえで**（`ensureAcceptable(...).mimeType === "image/svg+xml"` を明示的に assert）、`FileTooLarge` で返り、オブジェクトも行も残らないことを確認する。「gate は完全でなくてよい / 約束は翻訳が担保する」という本ラウンドの設計判断が、そのままテストの形になっている。対になる TC-storage-269（breakout tag あり → `UnsupportedMimeType`）と TC-storage-270（同形から breakout tag だけ除く → 128 KB で成功）が、gate と上限の役割分担を両側から固定している。
- **保管する実体の再検査** — TC-storage-256 / 261 / 262 / 263 は、いずれも「サニタイザーの出力がそのままでは単体の `.svg` にならない」ことを `htmlProcessor.process(...)` の結果を直接 assert して先に示してから、`storeMedia` が拒む／書き換えることを確認している。`trim()` が空白と呼ぶだけの文字（BOM / EM SPACE / LINE SEPARATOR）を内容として扱う物差しの違いまで行になっている。
- **測る値の 1 本化** — TC-storage-271 が縮む SVG（`<script>` 落ち）と膨らむ SVG（U+00A0 → `&#160;`）の両方向で、上限・容量・行に載る値がサニタイズ後の 1 つの長さに揃っていることを `recalculateStorageUsage` の実測と突き合わせて確認する。片方向だけのテストでは検出できない誤りを塞いでいる。
- **ポート契約** — `adapters/conformance/storedFileRepository.ts:226-390` が `listDeletableByNote` の `id` 昇順・`limit` ちょうどの切り方・`limit: 0`、`listByPurposeOlderThan` の `createdBefore` 包含・oldest-first（id 順とは逆になる並びで固定）・カーソルの排他性・**カーソル行を削除しても位置が解決すること**・`(createdAt, id)` を独立に比べたら落ちる 2 ケースを押さえる。memory / cloudflare の両方が同じスイートを通る。
- **掃引の前進** — TC-storage-254 が「本文から参照され続けている media が満ページ並び、その後ろに孤児」という、回収数で継続条件を作ると永久に到達できない配置を 2 turn 実行で押さえている。TC-storage-259（ノート数予算）、TC-storage-255（読めない payload）、TC-storage-258（turn 全体の失敗で位置を保つ）も個別にある。
- **配信境界** — `apps/web/app/routes/__tests__/storage.delivery.test.ts:3374-3405` が `FILE_PURPOSES` の差分から「載せていない purpose は 404」を走査で押さえ、`PUBLICLY_SERVED_PURPOSES` を**テスト側に書き写した定数と突き合わせる**形にしている。ルートを読み直すだけの自己言及テストになっていない。

`pnpm vitest run --project node packages/core/src/application/storage packages/core/src/application/usage packages/core/src/domain/storage packages/core/src/adapters/memory/__tests__/conformance.test.ts` を実行して 13 files / 635 tests green を確認した。

#### カバレッジ

**確認したファイル（差分）**

- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/application/storage/storeMedia.ts`
- `packages/core/src/application/storage/collectOrphanMedia.ts`
- `packages/core/src/application/storage/deleteFilesForNote.ts`
- `packages/core/src/application/storage/relocateFilesForNote.ts`
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/relocateFilesForNote.test.ts`
- `packages/core/src/application/usage/ensureUploadAllowed.ts`
- `packages/core/src/application/usage/__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/conformance/backend.ts`（storage 分）
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/adapters/cloudflare/do/schema.ts`（`stored_files` 分）
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `spec/usecases/storage.md`
- `spec/domains/storage.md`
- `spec/database/index.md`
- `spec/testcases/storage/storeMedia.md`
- `spec/testcases/storage/collectOrphanMedia.md`
- `spec/testcases/storage/deleteFilesForNote.md`
- `spec/inventory/adapter.md` / `spec/inventory/test.md` / `spec/inventory/usecase.md`（storage 分）
- `spec/adr/013-html-sanitization-policy.md`（`storeMedia` が依存する節）

**判断のために差分外で読んだファイル**

`domain/note/ports/htmlProcessor.ts`、`adapters/html/htmlProcessor.ts`（メーター・直列化）、`adapters/html/allowList.ts`（SVG 部分集合）、`domain/note/valueObject.ts`（`NoteHtml` / `PlainTextContent` / `Excerpt`）、`application/cleanup/notePurgeFanOut.ts`、`application/note/jobs.ts`（`storageUrlPolicyOf`）、`application/workers/scopeTaskRunner.ts`、`application/workers/subscribers.ts`、`adapters/memory/support.ts`。

**スキップしたファイル**

担当外（note / tag / integration / identity / frontend / DI / ルーティング）のため本ラウンドでは読んでいない。

- `apps/web/app/components/**`（22 ファイル）、`apps/web/app/routes/**` のうち `storage.$.tsx` と `__tests__/storage.delivery.test.ts` 以外（12 ファイル）、`apps/web/app/presentation/**`（3 ファイル）、`apps/web/app/routeTree.gen.ts`
- `packages/core/src/domain/{note,tag,integration}/**`（17 ファイル）
- `packages/core/src/application/{note,tag,integration,identity,cleanup,execution,di,scope.ts}/**`（`notePurgeFanOut.ts` / `jobs.ts` は参照のみ、指摘対象外）（41 ファイル）
- `packages/core/src/adapters/{memory,cloudflare,conformance}/**` のうち storedFileRepository / conformance backend 以外（19 ファイル）
- `packages/core/src/adapters/html/{htmlProcessor,allowList,css}.ts` と `__tests__/htmlProcessor.test.ts` — B-001 の検証に必要な範囲だけ読み、サニタイズ規則そのもののレビューは backend-note の担当
- `spec/` のうち storage 以外（note / tag / integration / pages / presentation / manual-tests / platform / domains-index）（20 ファイル）
- `packages/core/package.json`、`pnpm-lock.yaml`

**検証用に作成した一時ファイル**: `packages/core/src/domain/storage/__tests__/zzprobe.test.ts`（B-001 の実測に使用）。**削除済み**（`git status` clean を確認）。
