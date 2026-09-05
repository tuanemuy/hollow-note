### backend-storage

対象: `packages/core/src/domain/storage/`、`packages/core/src/application/storage/`、`packages/core/src/application/usage/`、両バックエンドの `storedFileRepository`、`adapters/conformance/storedFileRepository.ts`、`apps/web/app/routes/storage.$.tsx` と配信経路、`spec/domains/storage.md` / `spec/usecases/storage.md` / `spec/testcases/storage/` / `spec/database/index.md`。

ゼロベースで読み直した。差分の読解に加えて、(1) `npx vitest run --project node`（storage / usage / domain-storage / conformance / storage.delivery = 14 files / 625 tests、全 green）、(2) `HtmlProcessor.process` に SVG の攻撃・境界ベクタを通す使い捨てプローブ、(3) その出力を `xmllint --noout` に通す XML 適合検査、(4) `sqlite3` の `EXPLAIN QUERY PLAN` で新しい索引とキーセット述語の噛み合いを実測した（プローブは削除済み、`git status` はクリーン）。

前ラウンドからの修正の確認:

- **W-007（索引）は解消**。`stored_files_purpose_created_idx` は `(purpose, created_at, id)` になり、`spec/database/index.md:476` も追随している。ただし索引だけでは前進しない（W-002）
- **W-004（`:xmlns`）は解消**。`htmlProcessor.ts:72-75` の `attributeName` が空 prefix を prefix 無しとして扱うようになり、`ALLOWED_SVG_ATTRIBUTES` から `xmlns` も消えた。実測でも除去一覧に `:xmlns` は出ない
- **W-005（ゴミ箱ノートへのアップロード）は解消**。`storeMedia.ts:120` が `ensureNotTrashed` を通し、TC-storage-260 が押さえている
- **W-002（孤児掃引の予算）は方向としては解消**。`ORPHAN_MEDIA_NOTE_BUDGET` が入り、失敗 turn が位置を保つようになった。取りこぼし・spin・無限ループは無い（後述）。ただし 1 パス全体の費用は悪化している（W-002）
- **W-001（`trim()`）は「ルートの外」については解消**。`XML_WHITESPACE_ONLY` は正しく XML の `S` 4 文字だけを見る。しかし**ルートの内側は誰も見ていない**（B-001）

#### Blockers

**[B-001]** 「単体の 1 文書である」判定がルートの**外側の形**しか見ていないため、XML として致命的に壊れた markup が `image/svg+xml` として保管される

- 場所: `packages/core/src/application/storage/storeMedia.ts:175-220`（`findSvgRoot`）、`:241-254`（`asStandaloneSvg`）、`:278-292`（`sanitizeSvg`）
- 契約: `spec/usecases/storage.md#storeMedia` 手順 4 — 「サニタイズ後の markup が単体の 1 文書であること」「そのまま保管すると `image/svg+xml` として 1 ドットも描かれない」。`findSvgRoot` の JSDoc（`storeMedia.ts:158-174`）も同じことを約束している
- 実装が見ているのは「最初の要素が `svg` の開始タグか」「入れ子が閉じるか」「ルートの外が XML の `S` だけか」の 3 つだけで、**ルートの内側が XML として読めるかは 1 つも見ていない**。`HtmlProcessor.process` が返すのは parse5 の **HTML 直列化**であり、HTML の直列化と XML の文法は一致しない。実測（`process` の出力に `xmlns` を足して `xmllint --noout` に通した結果）:

  | 入力 | `process` の出力 | `findSvgRoot` | `xmllint` |
  | --- | --- | --- | --- |
  | `<svg …><text>a{U+00A0}b</text></svg>` | `<text>a&nbsp;b</text>` | **通す** | `Entity 'nbsp' not defined` |
  | `<svg …><rect data-x="a{U+00A0}b"/></svg>` | `data-x="a&nbsp;b"` | **通す** | 同上 |
  | `<svg …><desc><img src="a.png"></desc><rect/></svg>` | `<desc><img src="a.png"></desc>` | **通す** | `Opening and ending tag mismatch: img` |
  | `<svg …><desc>a<br/>b</desc><rect/></svg>` | `<desc>a<br>b</desc>` | **通す** | `Opening and ending tag mismatch: br` |
  | `<svg …><desc>a{U+0001}b</desc><rect/></svg>` | 制御文字がそのまま残る | **通す** | `PCDATA invalid Char value 1` |

  いずれも `storeMedia` は成功を返し、`StoredFile` の行が立ち、容量を消費し、エディタは `<img src="…">` を本文に挿す。ブラウザは XML の致命的エラーで**1 ドットも描かない** — 前ラウンドの B-001 と全く同じ症状が、位置を「ルートの外」から「ルートの内」に移しただけで残っている。
- 原因は 2 つあり、どちらもこのラウンドの変更が見ていない:

  1. **parse5 の直列化は XML の実体参照集合を守らない。** U+00A0 は `&nbsp;` に直列化されるが、XML が事前定義するのは `lt / gt / amp / apos / quot` の 5 つだけで、DTD の無い `.svg` では未定義実体＝致命的エラーになる。皮肉なことに `storeMedia.ts:50-60` の JSDoc は「Only U+00A0 escapes into `&nbsp;` on the way out of the sanitizer」と**この事実を書いたうえで、ルートの外側にだけ使っている**。SVG のテキストに `&nbsp;` / `&#160;` を含む書き出し（Illustrator / Figma / 手書きいずれも普通にある）はすべてこれに当たる
  2. **`<desc>` / `<title>` は HTML の integration point なので、その配下では HTML 解析が再開する。** `ALLOWED_SVG_ELEMENTS`（`allowList.ts:268-293`）は ADR 013 の表どおり `desc` / `title` を許すが、その中身は SVG の部分集合ではなく `ALLOWED_ELEMENTS` 全部になる。結果、void 要素（`img` / `br` / `hr` / `wbr` / `col` / `source`）が閉じタグ無しで直列化されて XML を壊す。実測で確認済み
- **同じ穴が ADR 013 の SVG 部分集合そのものも迂回する**（副次だが同根）。`<svg><style>…</style></svg>` は正しく除去されるのに、`<svg><desc><style>rect{fill:red}</style></desc></svg>` は `<style>` が残る。保管された `.svg` を XML として読むとこの `<style>` は **SVG 名前空間の `style` 要素**になり、文書全体に CSS が効く。`<a href>` も同様に SVG のリンク要素として残る。`spec/adr/013-html-sanitization-policy.md:66-88` は「インラインの `<svg>` と保管する `.svg` の両方が同じ表を使う」と書いているが、integration point の存在をどこも勘定していない
- 修正の方向は 2 つで、どちらか（あるいは両方）が要る:
  - サニタイズ結果を **XML として直列化し直す**（parse5 の `serializeOuter` ではなく XML 直列化を通す、あるいは保管前に `DOMParser`/`XMLSerializer` 相当で往復させて、開けないものは `UnsupportedMimeType` にする）。「保管される実体が本当に XML として開ける」ことは、いま誰も検証していない性質そのものなので、往復検査を 1 本置くのが一番確実
  - SVG を保管する経路では `desc` / `title` の配下を **SVG の部分集合に限る**（integration point を通さない）。ADR 013 側にも「`desc` / `title` は HTML integration point なので配下も SVG 部分集合に閉じる」を明記する
- テストは `storeMedia.test.ts` に「保管したバイト列が XML として開ける」ケース（上表の 5 行）を足せば回帰も押さえられる。いまの TC-storage-176〜178 / 251〜256 はどれも**文字列の形**しか見ていないので、この穴を素通りしている

#### Warnings

**[W-001]** SVG の受理判定が「先頭バイトの形」だけで、サニタイザーの膨張率と費用を入力の**構造**で有界にしていない。結果、`spec/domains/storage.md:197` が「どんな入力に対しても」成り立つと書いた前提が実際には破れる

- 場所: `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:22-38`（`MEDIA_SVG_MAX_BYTES` の JSDoc）、`:159-193`（`opensAsSvg`）、`packages/core/src/application/storage/storeMedia.ts:270-276`（`sanitizeSvg` の JSDoc）
- 症状 1 — **上限の根拠が Note の不変条件を守れていない**。spec と JSDoc の論拠は「HTML の直列化で 1 バイトが増えるのは最大 6 倍（`"` → `&quot;`）で 131,072 × 6 = 786,432 < 800,000」だが、この見積もりは**文字のエスケープしか数えていない**。parse5 は解析の段階でも構造を増やす — 省略タグの補完（`<table><col>` → `<table><colgroup><col></colgroup>`）と、adoption agency による整形要素の複製である。実測（受理される 128 KB ちょうどの SVG、`<svg …><desc>` + 単位の反復）:

  | 単位 | 結果 |
  | --- | --- |
  | `<b><p>` × N | 出力 764,311 バイト（5.83 倍）— 800,000 まで 4.5% しか残っていない |
  | `<em><p>` × N | **`BusinessRuleError(NoteErrorCode.ContentTooLarge)` "Note HTML exceeds 800000 bytes"** |
  | `<b><em><p>` × N | 同上 |
  | `<b><i><p>` × N | 同上 |

  `spec/testcases/storage/storeMedia.md:14` と `spec/inventory/test.md:2037`（TC-storage-251）は「本文の上限に触れて `NOTE_CONTENT_TOO_LARGE` になることはない」と明記しており、`sanitizeSvg` の JSDoc も「no input this policy accepts can serialize into a value the body's invariant refuses」と書いている。**受理された SVG のアップロードが Note の語彙のエラーで落ちる**という、128 KB という値を選んだ理由そのものが実際には成立していない。
- 症状 2 — **サニタイザーが深い入れ子でスタックを溢れさせる**。`htmlProcessor.ts` の `sanitizeNodes`（:406）/ `sanitizeNode`（:467）/ `walkElements`（:117-127）はいずれも素の再帰で、入れ子 1,000 段で `RangeError: Maximum call stack size exceeded` になる。実測では `<svg …><desc>` + `<b><i>` × 1,000 = **わずか 6,044 バイト**で再現する。`opensAsSvg` はこれを `image/svg+xml` として受理し、`ensureAcceptable` も通すので、`storeMedia` は `CodedError` ですらない `RangeError` を投げる（`toSerialized()` を持たないため、表示層は素性の分からない 500 になる）。`updateNoteBody` の HTML モードも同じ経路を通る
- 両方とも根は 1 つ — **入口が「バイト列の先頭の形」だけを見て受理し、そのあと構造に対して無制限のパーサーへ渡している**。手当ての方向は入口側で構造にも上限を置くこと（入れ子の深さ、要素数）か、`process` を再帰から明示スタックに直したうえで膨張の見積もりを「エスケープのみ」から「解析の補完・複製込み」に取り直すこと。少なくとも `spec/domains/storage.md:197` の「6 倍」の論拠は現状のままでは正しくない
- 症状 2 の実体は `adapters/html/htmlProcessor.ts` にあるので、note 側の HtmlProcessor 担当が同じものを挙げていれば 1 件に集約してよい。ここでは `storeMedia` の受理境界から到達できる事実として記録する

**[W-002]** 孤児掃引は取りこぼしも spin もしないが、1 パス全体の費用が行数の二乗に効く。新しい索引はその半分しか直していない

- 場所: `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts:469-480`、`packages/core/src/adapters/cloudflare/do/schema.ts:298-303`、`packages/core/src/application/storage/collectOrphanMedia.ts:78`（`ORPHAN_MEDIA_NOTE_BUDGET`）/ `:523`
- 前進の正しさ自体は確認した。`outOfBudget` の `break`（`:465-472`）は `judgedThrough` を更新する**前**に抜けるので判定前の行は取りこぼされず、予算 5 に達するには最低 5 件を判定済みなので毎 turn 必ず 5 件以上前進する。カーソルは厳密に前進し、失敗 turn は開始位置を保つ（`:402-404`）。無限ループも取りこぼしも無い
- 問題は費用。**継続条件の述語が索引で解けない**。`stored_files_purpose_created_idx` を `(purpose, created_at, id)` にしたのは正しいが、SQL 側の継続条件は `(created_at > ? OR (created_at = ? AND id > ?))` の OR 形のままで、SQLite はこれを**範囲制約として索引に押し込めない**。実測（sqlite 3.51、同じ索引・同じ述語）:

  ```
  OR 形     : SEARCH stored_files USING COVERING INDEX … (purpose=? AND created_at<?)
  行値形    : SEARCH stored_files USING COVERING INDEX … (purpose=? AND (created_at,id)>(?,?) AND created_at<?)
  ```

  つまり毎 turn `purpose` の先頭までシークして、掃引済みの前置きを全部読み直しながら OR をフィルタとして評価する。`(created_at, id) > (?, ?)` の**行値**に書き換えれば下限シークになる（SQLite 3.15+、D1 は満たす）。`spec/domains/storage.md:281-289` と port の JSDoc がキーセットである理由を丁寧に書いている以上、実装がシークになっていないのは契約と実効の乖離になる。
- そこへ `ORPHAN_MEDIA_NOTE_BUDGET = 5` が乗る。1 ページ 100 件でもノートが散っていれば 1 turn で判定するのは 5 件なので、**実効ページ長が 20 分の 1 になる**。scope の media が N 件・ノートがほぼ 1 対 1 なら、1 パスは `N/5` turn（＝ `N/5` 回の Alarm）で、各 turn が前置きを読み直すので索引読みは概ね `N²/10`。N=10,000 で 2,000 turn / 1,000 万索引読み。予算の JSDoc（`:61-77`）は「ページは普通 1 つのノートの画像」を前提に置いているが、その前提が外れたときの費用は turn 数の側にも出る、という点は書かれていない
- 手当て: SQL を行値形に直す（1 行）。それだけで前置きの読み直しは消え、予算による turn 数の増加も線形コストに収まる。予算の JSDoc に「予算に当たるページが続くと turn 数が `limit / budget` 倍になる」ことを 1 行足すと、次にこの値を触る人が判断できる

**[W-003]** ドキュメントの取り残し 1 件 — `spec/usecases/storage.md#deletefilesfornote` のページ長が実装と食い違う

- `spec/usecases/storage.md` の `deleteFilesForNote` 手順 1 / 3 / 4 と `spec/testcases/storage/deleteFilesForNote.md` は「最大 100 件」「100 件ずつ」で、実装（`application/storage/deleteFilesForNote.ts:18` の `NOTE_FILE_DELETE_BATCH_SIZE = 100`）と一致している。一方 `deleteFilesForNote.test.ts:302` の TC-storage-058 は「reclaims 250 rows a page at a time」と書きつつ 100 件ページで 3 turn 回している。テスト名の「250」は**総行数**であってページ長ではないので実害は無いが、`spec/testcases/storage/deleteFilesForNote.md` の該当行が「deletable fileが250件ある → 100件ずつ」と読ませる形なのに対し、テスト名だけが 250 をページ長のように見せる。テスト名を「250 rows, a hundred at a time」等に直すのが安い
- （既存の問題）同ファイルの「workspace deletion由来の別operation ID」行は今回「personal barrier の receipt と一致しない operation ID」に書き換わって解消済み。`spec/testcases/integration/deleteBackupRecordsForNote.md` 側に同種の文言が残っているが、これは integration 担当の持ち分

#### テスト保証

担保できているもの:

- **`storeMedia`（21 ケース）** — 受理表の 7 形式それぞれをバイト列から判定すること、SVG の境界（128 KB ちょうど＝ TC-storage-253、サニタイズで伸びる入力＝ 252、`</svg>` の後ろに内容が残る 3 形＝ 256、`trim()` だけが空白と呼ぶ文字＝ 256、属性値中の `</svg>`）、サニタイズ後のバイト長で上限・行・容量が揃うこと、ゴミ箱ノートの拒否（TC-storage-260）、容量・権限・`purging` route・移動窓（実際の `moveNote` を `resolveNote` の中で走らせる）、transaction 失敗時のオブジェクト巻き戻し。**アサートの対象が view ではなく `objectStorage.get` で読み戻した実バイト列**なので、保管された実体そのものを押さえている
- **`collectOrphanMedia`（22 ケース）** — 30 日境界の包含・除外、参照あり／なし、版の本文を参照元に数えること（TC-storage-257）と数えたうえで回収されること、所属ノート不在・本文不読、別ノートの参照では助からないこと、`limit`、初回流入での自己登録（保管・移動の両方）と 2 回目に `dueAt` を押し出さないこと、満ページでの継続と走査し切りでの日次復帰、`runDueScopeTasks` 経由で 2 turn 回してカーソルの先の孤児に到達すること（TC-storage-254）、payload 不読（255）、turn 全体の失敗と**位置の保持**（258）、**ノート予算での打ち切りと直後の継続**（259）。259 は `extractExternalReferences` のラッパーで解析回数が 5 回で止まることを直接数えており、予算が実効であることを押さえている。干渉は `docs/test.md` どおり UoW / `htmlProcessor` の薄いラッパーで、実装側に分岐は足していない
- **`deleteFilesForNote`（12 ケース）** — 対象 purpose の切り分け、ページング（同一 `deletionOperationId` の持ち回り）、`running` の障壁・`completed` の障壁・不一致 token の 3 分岐、冪等、列挙と削除のあいだで行が消える窓
- **ポート契約 → conformance → 両実装** — ADP-storage-007 / 010 が `adapters/conformance/storedFileRepository.ts:302-362` に入り、memory と cloudflare の両 `conformanceBackend.ts` が同じスイートを回す。カーソルが**厳密に**前進すること（同時刻の同僚が戻らない）と、**カーソルを採った行を消しても位置が解決する**ことの 2 つを直接押さえていて、port JSDoc / `spec/domains/storage.md:281-289` / `spec/inventory/adapter.md` の ADP-storage-010 と一致している
- **配信** — 公開 purpose の集合を `FILE_PURPOSES` の補集合と突き合わせて「載せていない purpose は 404」を走査で押さえるので、purpose を増やしたスライスがこのテストを編集せずに落とせる。`nosniff` と CSP も実アサート
- **`ensureUploadAllowed`（6 ケース）** — 行の無い subject を初期値で判定して行を書かないこと、workspace の上限、LLM 枠が要求者側であること

担保できていないもの（B-001 / W-001 が素通りしている箇所）:

- **保管した SVG が実際に XML として開けること**を検査するテストが 1 本も無い。TC-storage-176〜178 / 251〜256 はすべて出力**文字列**への `toContain` / `not.toContain` / 長さの検査で、その文字列が XML の文法に載るかは誰も見ていない。B-001 の 5 パターンはここを素通りする
- **`<desc>` / `<title>` の配下**を通る入力が 1 件も無い。ADR 013 の SVG 部分集合が integration point で迂回されることも、そこから来る void 要素も、テストの視界に入っていない
- **サニタイザーの入力を構造で振ったケース**が無い（深い入れ子、整形要素の反復）。W-001 の 2 症状はどちらもここ
- 新設のドメインサービス `domain/storage/services/storageUrlPolicy.ts` に直接の単体テストが無く、`collectOrphanMedia` / note 側の経由でしか通っていない。`appUrl` / `deliveryBaseUrl` の組み合わせ（アプリ相対の配信パス／公開ドメイン、解決できない URL）は契約表に 2 行あるのに、そこを直接突いたケースが無い
- 配信ルートの `downloadName`（ヘッダーに置けない文字の除去）と `Content-Length` / `Content-Disposition` / `Cache-Control` の値に対するテストが無い

#### カバレッジ

確認したファイル:

- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/valueObject.ts`（差分外・判断のため）
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/application/storage/storeMedia.ts`
- `packages/core/src/application/storage/collectOrphanMedia.ts`
- `packages/core/src/application/storage/deleteFilesForNote.ts`
- `packages/core/src/application/storage/relocateFilesForNote.ts`
- `packages/core/src/application/storage/deleteFiles.ts`（差分外・判断のため）
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/relocateFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/usage/ensureUploadAllowed.ts`
- `packages/core/src/application/usage/__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/cleanup/notePurgeFanOut.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`（storage の購読分）
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/schema.ts`（`stored_files` の索引）
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`（B-001 / W-001 の根拠。差分レビュー自体は note 担当）
- `packages/core/src/adapters/html/allowList.ts`（同上）
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `spec/domains/storage.md`
- `spec/usecases/storage.md`
- `spec/database/index.md`（`stored_files` の索引行）
- `spec/testcases/storage/storeMedia.md`
- `spec/testcases/storage/collectOrphanMedia.md`
- `spec/testcases/storage/deleteFilesForNote.md`
- `spec/adr/013-html-sanitization-policy.md`
- `spec/inventory/adapter.md`（ADP-storage 行）
- `spec/inventory/test.md`（TC-storage 行）
- `spec/platform/index.md`（「実行予算と分割単位」「outbox relay」）
- `.thread/7/plan.md`（AC-6 とスコープ）、`.thread/7/review/triage-keys.md`

スキップしたファイル（担当外。note / tag / integration / frontend / 共通基盤の担当が見る分）:

- `apps/web/app/components/**`、`apps/web/app/routes/notes/**`、`apps/web/app/routes/workspaces/**`、`apps/web/app/routeTree.gen.ts`、`apps/web/app/presentation/**`
- `packages/core/src/application/note/**`、`packages/core/src/application/tag/**`、`packages/core/src/application/integration/**`、`packages/core/src/application/identity/**`、`packages/core/src/application/cleanup/participants.ts`、`packages/core/src/application/execution/unitOfWork.ts`、`packages/core/src/application/di/{types,memoryRuntime,cloudflareRuntime}.ts`、`packages/core/src/application/ports/{noteMovePort,noteRouteStore}.ts`
- `packages/core/src/domain/note/**`、`packages/core/src/domain/tag/**`、`packages/core/src/domain/integration/**`
- `packages/core/src/adapters/html/css.ts`、`packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`（SVG 節は B-001 / W-001 の根拠として実挙動をプローブで確認したが、ファイル自体の差分レビューは note 担当へ）
- `packages/core/src/adapters/{memory,cloudflare}/repositories/{noteRepository,tagAssignmentRepository,backupRecordRepository}.ts`、`packages/core/src/adapters/conformance/{noteRepository,noteRouteStore,tagAssignmentRepository,backupRecordRepository,backend}.ts`、`packages/core/src/adapters/memory/{scopeUnitOfWork,store}.ts`、`packages/core/src/adapters/cloudflare/__tests__/**`、`packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `spec/domains/{note,tag,integration}.md`、`spec/usecases/{note,tag,integration}.md`、`spec/testcases/{note,tag,integration}/**`、`spec/pages/index.md`、`spec/presentation/index.md`、`spec/manual-tests/editing.md`、`spec/inventory/usecase.md`
- `packages/core/package.json`、`pnpm-lock.yaml`
