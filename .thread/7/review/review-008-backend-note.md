# レビュー 008 — backend-note

### backend-note

#### Blockers

**[B-001]** `TEMPLATE_SENSITIVE` の逃げ道が、`<template>` 包みで塞いだはずの二次コストをそのまま復活させる。攻撃者側の費用は 13 バイト。

- **場所**: `packages/core/src/adapters/html/htmlProcessor.ts:917`（`TEMPLATE_SENSITIVE`）、`:943-961`（`parseWrapped`）、`:963-973`（`parse` の振り分け）
- **理由**:
  - 実測（この worktree の Node、`createHtmlProcessor().process` を直接呼んだ値）:

    | 入力 | バイト数 | 経路 | 所要 |
    | --- | --- | --- | --- |
    | `"<br>".repeat(440_000)` | 1,760,000 | 包み | **364 ms** |
    | `"</template>" + "<br>".repeat(440_000)` | 1,760,011 | 素 | **16,477 ms** |
    | `"<form></form>" + "<br>".repeat(440_000)` | 1,760,013 | 素 | **82,347 ms** |

    3 つとも最後は `NoteHtml` の 800,000 バイトで `ContentTooLarge` になる。つまり **「必ず失敗すると分かっている入力」に 82 秒を払う**。生の `parseFragment` だけを測った値でも二次性は同じで、`<form></form>` 前置きの入力は n=200,000 で 9.7 秒 / n=400,000 で 58.6 秒（n が 2 倍で 6 倍）である。
  - 4 つの `HtmlProcessorLimit` はどれも掛からない。膨張は 1.0 倍（allowance は `min(4,000,000, 1,760,013×4)` = 4,000,000 に対し実費 `440,000×9 ≒ 3.96 MB`）、入れ子は 1 段、CSS は 0 歩。
  - これは canon と正面から矛盾する。`spec/adr/013-html-sanitization-policy.md`「サニタイズは資源で有界である」の「**4 上限をすべて満たす入力にも費用の上限がある**」節が「この費用は入力長に比例した範囲に収める必要があり、節点数の二乗になる経路…はそのままにしない」と書き、`spec/inventory/test.md:2621`（TC-note-826）が「その 1 回の `process` の費用が入力長に比例した範囲に収まる（節点数の二乗にならない）」を期待値に置いている。`<form` か `</template` を 1 つ混ぜるだけで両方とも偽になる。
  - 認可の壁は薄い。`updateNoteBody` は `resolveEditableNote` を通るので認証済み利用者に限られるが、**自分のノート 1 つ**あれば足りる。参照ランタイムは単一プロセス（ADR 025）なので、82 秒はサーバー全体の停止である。さらに実在の保存済み Web ページはほぼ必ず `<form>`（検索ボックス）を含むため、この逃げ道は攻撃者だけでなく **本来この最適化が効くべき入力そのもの**が通る道になっている。
  - なお包み自体の**正しさ**は疑わない（下記「テスト保証」参照）。問題は「素の経路へ落とす」という逃がし方が費用を無制限にしていることである。
- **提案**: 素の経路を「`parseFragment` に丸投げ」で終わらせない。どちらでもよい:
  - (a) `createMeteredTreeAdapter` に**最上位節点数**（解析根に append された子の数）の枠を足し、超えたら解析中に `HTML_PROCESSOR_TOO_COMPLEX` で打ち切る（B-002 の提案と 1 つの枠で足りる）。
  - (b) 常に包み、`TEMPLATE_SENSITIVE` に当たる入力だけ包みと素の 2 通を作って比較する（比較は線形で、二次より安い）。

  いずれにせよ、**素の経路の費用が入力長に比例することを示さないかぎり ADR 013 の当該節と TC-note-826 は成立しない**。直せないなら ADR 側の断言を撤回する必要がある。

**[B-002]** 解析**後**の 2 経路が節点数で有界でない。共通原因は `HtmlProcessorLimit` が**バイト数と深さ**しか縛らず、**節点数**を縛っていないこと。

- **場所**:
  - `packages/core/src/adapters/html/htmlProcessor.ts:602-605`（`collectHeadings` の重複 slug 解決ループ）
  - `packages/core/src/adapters/html/htmlProcessor.ts:424`（`sanitizeNodes` の `out.push(...sanitizeNode(...))`）
- **理由**:
  - **(1) `collectHeadings` が見出し数の二次**。同じ本文の k 個目の見出しが `a`, `a-2`, … `a-(k+1)` を順に試すので合計 O(n²)。実測（`process("<h1>a</h1>".repeat(n))`）:

    | n | 所要 |
    | --- | --- |
    | 1,000 | 45 ms |
    | 2,000 | 216 ms |
    | 4,000 | 402 ms |
    | 8,000 | 1,641 ms |
    | 16,000 | 7,367 ms |

    n を倍にすると 4 倍。n=120,000（1.2 MB、転送上限 2,000,000 の内側、膨張 1.0 倍・深さ 2・CSS 0 で 4 上限すべての内側）は 10 分待っても終わらなかった。この経路は `<form>` などの逃げ道すら要らない。
  - **増幅がある**。サニタイズ後の 1 見出しは `<h1 id="a-12345">a</h1>` ≒ 23 バイトなので、**800 KB の本文に約 34,000 見出しが保存できる**。保存は 1 回で済むが、その本文は以後
    - `applyTextNodeEdits`（`applyTextNodeEdits.ts:133` の `process` は**スコープの UoW の内側**）— 自動保存のたびに約 33 秒（外挿）スコープの書き込みを止める
    - `listNoteRevisions`（`listNoteRevisions.ts:74` が版 1 件につき `process`、最大 20 件）— 版一覧 1 回で約 11 分

    を毎回払う。1 回の保存が永続的な増幅器になる。
  - **(2) `sanitizeNodes` が素の `RangeError` を投げる**。未許可要素の unwrap が返す配列を `push(...)` で展開しているため V8 の引数上限に当たる。実測 `process("<foo>" + "<br>".repeat(n) + "</foo>")`: n=50,000 は成功、**n=130,000（520 KB）で `RangeError: Maximum call stack size exceeded`**。
    - ADR 013 は「**再帰は `RangeError` を投げない形にする** … どこにも `toSerialized()` を持たない例外は出ない」と書いている。`spec/testcases/note/updateNoteBody.md:46` と `spec/inventory/test.md:2612` も期待値に置いている。
    - `domain/note/ports/htmlProcessor.ts:131-142` の error contract は `SystemError(ExternalServiceError)` と `BusinessRuleError(HTML_PROCESSOR_TOO_COMPLEX)` の 2 つだけを認めている。したがって 520 KB の本文の保存が **`kind` を持たない fault（500）**になる。深さの上限（256 段）はこれを塞がない — 深さは 2 段だからである。
- **提案**:
  - `HtmlProcessorLimit` に節点数の上限を足し、`createMeteredTreeAdapter` の `createElement` / `insertText` で数える（B-001 の (a) と同じ枠で両方が閉じる）。
  - `collectHeadings` は `base → 次の連番` の `Map<string, number>` を持てば線形になる（`taken` / `claimed` の集合はそのまま使える）。
  - `sanitizeNodes` は `for (const child of sanitizeNode(...)) out.push(child)` に落とす（`adopt` 側の `[...children]` は配列リテラルの spread なので引数上限に当たらない）。
  - 直したうえで、TC-note-826 の兄弟として「大量の同一見出し」「未許可要素直下の大量の兄弟」を回帰に足す。

#### Warnings

**[W-001]** `inlineStylesheets` が取り込んだ CSS を `filterCss` に通していない。

- **場所**: `packages/core/src/adapters/html/htmlProcessor.ts:1062-1094`（とくに `:1085` の `adopt(element, [textNode(css.replace(/<\/style/gi, ""), element)])`）
- **理由**: 落とすのは `</style` だけで、`position: fixed` も `@import` もそのまま本文の `<style>` に入る。ADR 013 は「規則の正典を 1 か所に置く」の適用点の 1 つに `importExternalReferences`（取り込んだスタイルシートの `<style>` 化）を挙げており、この経路も「同じ 1 つの適用点」を通るはずである。呼び出し元は Issue #6 の持ち分でまだ存在しないが、**ポートの JSDoc（`domain/note/ports/htmlProcessor.ts:151-155`）にも「呼び出し元が `process` を通し直す責任を負う」とは書かれていない**ので、#6 の実装者はここを安全だと読む。
- **提案**: `filterCss` を通すか（`CssBudget` は 1 呼び出し 1 本で作る）、ポート JSDoc に責任の所在を明記する。

**[W-002]** TC-note-826 が守りたい性質（節点数の二乗にならない）を守れていない。

- **場所**: `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts:948-986`
- **理由**: 入力が `"<p>xxxxxxxx</p>".repeat(n)` だけで、B-001 の逃げ道（`<form` / `</template`）を通る入力を含まない。判定も壁時計比（`expect(wholeCost).toBeLessThan(Math.max(tenthCost, 1) * 20)`）で、**逃げ道が存在するかぎり「10 倍の節点数で 20 倍未満」は逃げ道を通らない入力についてしか言っていない**。回帰テストとしては、塞いだつもりの穴の外側だけを測っている。
- **提案**: B-001 を直したうえで、`<form></form>` 前置き版と `</template>` 前置き版を同じテーブルに足す。

**[W-003]** `listNoteRevisions` が版 1 件につき `process` を丸ごと 1 回走らせる費用が、spec に書かれていない。

- **場所**: `packages/core/src/application/note/listNoteRevisions.ts:74`
- **理由**: JSDoc（`:23-35`）は「最悪 20 × 800 KB の全サニタイズを同期で走らせる」と自覚的に書いており、そこは是としてよい。しかし `spec/usecases/note.md` の `listNoteRevisions` にはこの費用が一言も無く、`spec/` が正典である以上「実装だけが知っている取引」になっている。B-002 と掛け合わさると分単位になるため、B-002 を直した後でも「版一覧は本文 20 個分のサニタイズ」という事実は書き残す価値がある。
- **提案**: `spec/usecases/note.md#listNoteRevisions` に費用と、それを安くする 2 つの選択肢（`HtmlProcessor` にテキスト抽出専用の入口を足す / `NoteRevision` に抜粋を持たせる）が別スライスであることを 1 行で書く。

#### テスト保証

- **`<template>` 包みの挙動同値は、差分テストで積極的に確認した。** `parseFragment(html)` と `parseFragment("<template>"+html)` の `content` を、テキスト値・コメント・doctype・タグ名・名前空間・属性（prefix 込み）・`template` の `content` まで含めて構造比較した。
  - 無作為: 長さ 2〜8 のトークン列 × 39 万件（tag 語彙 110 種、属性 7 種、テキスト / コメント / doctype / CDATA 混在、seed 6 通り）— **差分 0**。
  - 全数: 「解析が分岐しうる」タグに絞った語彙（table 系 / `select` / `html` / `head` / `body` / `frameset` / `template` / `plaintext` / `xmp` / `style` / `script` / `textarea` / `svg` / `math` / `foreignObject` / `annotation-xml` / `nobr` / `marquee` ほか計 57 タグ、開閉 114 ＋ テキスト 3）で長さ 2（13,456 件）と長さ 3（**1,560,896 件**）を全数比較 — **差分 0**。
  - **語彙は許可リストではなく HTML のタグ全体で回した**。サニタイズは解析の**後**なので、許可リストに無い要素も解析結果を動かすからである（コード中のコメント「20,000 random markup fragments over the tag vocabulary of the allow list」はこの点で論拠が弱い）。
  - parse5 のソース側でも `tmplCount` に依存する分岐を全数（6 か所）当たり、素の断片解析と包みで**観測できる差**が出るのは `<form>` 開始タグ（`formStartTagInTable` / `formStartTagInBody`）と `</template>`（`templateEndTagInHead` / `eofInTemplate`）に限られることを確認した。`htmlStartTagInBody` の `adoptAttributes` は破棄される fake root に当たるので出力に出ない。**`</form>` 単独は正規表現に当たらず包みの経路へ行くが、`formElement` が null で `hasInScope($.FORM)` も偽なので両経路とも no-op** — 見落としではない。
  - 結論: **`TEMPLATE_SENSITIVE` の振り分けの「正しさ」に問題は無い**。問題は B-001 の「振り分けた先の費用」だけである。
- **`filterBlock` の `trim()` 除去は、過剰除去を生んでいない。** `filterCss(filterCss(x)) === filterCss(x)` を、bad-string を作る原子（`content:"a⏎` / `.o"a⏎` / `'` / `"` / `\`）と `url(x/*)` / `\70 osition:fixed` / `@import` / `!important` を混ぜた 3 万件で確認 — **不動点の破れ 0**。良性 CSS 9 種（`.a{color:red}` / `@media` 入れ子 / `url()` / `content:"x"` / `position:absolute` / `@font-face` / `var()`）は空白の畳み込み以外**無傷**。
- **`position:fixed` の除去は引き続き効いている。** 同じ 3 万件のうち出力に `position` が残った例を 20 件目視した。残っていたのはすべて (a) 許可値 `position:absolute`、(b) 規則の**前置き**（セレクタ）に現れたもの、(c) ブラウザ側でも bad-string を含む無効宣言として捨てられる位置 — のいずれかで、**ブラウザが適用する `position:fixed` が残った例は無かった**。TC-note-823 の 5 ケース（`\n` / `\r` / `\f` / 前置き / 行継続）と TC-note-824 も書き戻しまで押さえている。
- `NoteErrorCode.HtmlTooComplex` の経路は通っている: ドメイン定数（`domain/note/errorCode.ts:15`）→ ポートの別名（`ports/htmlProcessor.ts:17`）→ 表示辞書（`presentation/errorDisplay.ts:101`）→ 表示テストの網羅表（`presentation/__tests__/errorDisplay.test.ts:104,142`）。`storeMedia` 側の境界翻訳（`NOTE_HTML_TOO_COMPLEX` → `FileTooLarge`）も `storeMedia.test.ts:870` が「Note の語彙が漏れない」を明示的に押さえている。
- `TRASH_EXPIRY_BATCH_SIZE = 40` は canon と一致している（`spec/platform/index.md:148` の表、`:164` の 40 × 12 = 480 の算術）。`OWNER_PURGE_BATCH_SIZE = 40`（`deleteNotesForOwner.ts:43`）と同じ根拠を共有しており、`purgeExpiredTrash.ts:24-40` の JSDoc がその算術を再掲している。上限クランプ（`Math.min(Math.max(1, input.limit ?? 40), 40)`）も入力側から上げられない形になっている。
- ユースケース側のテストは実効的である（`toBeDefined()` 単独や `not.toBe(...)` 単独の判定は note 配下に無い。`deleteNotesForOwner.test.ts:201` の `toBeDefined()` は取り出した行に対する追加検証の前置きで、それ自体が唯一の判定にはなっていない）。`it()` 件数は trashNote 25 / purgeNote 26 / updateNoteBody 25 / emptyTrash 21 / deleteNotesForOwner 25 など。`it.skip` / `todo` は 0。
- コード・`spec/`・`docs/` に `.thread/` への参照は無い（grep 済み）。

#### カバレッジ

**読んだもの（全文）**

- `packages/core/src/adapters/html/htmlProcessor.ts`, `css.ts`
- `packages/core/src/adapters/html/allowList.ts`（要素・DROP_WITH_CONTENT 節を通読、属性表は差分で確認）
- `packages/core/src/application/note/` — `editing.ts` / `jobs.ts` / `applyTextNodeEdits.ts` / `updateNoteBody.ts` / `renameNote.ts` / `changeNoteStyleMode.ts` / `listNoteRevisions.ts` / `restoreNoteRevision.ts` / `listTrashedNotes.ts` / `trashNote.ts` / `restoreNote.ts` / `emptyTrash.ts` / `purgeExpiredTrash.ts`
- `packages/core/src/application/cleanup/notePurgeFanOut.ts`
- `packages/core/src/application/scope.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- 差分で確認: `domain/note/errorCode.ts` / `noteRevision.ts` / `ports/noteRepository.ts` / `services/noteAccessPolicy.ts`、`application/ports/noteRouteStore.ts` / `objectStorage.ts`、`application/workers/subscribers.ts`、`presentation/errorDisplay.ts`、`spec/adr/013-html-sanitization-policy.md`

**部分的に読んだもの**

- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts` — 資源上限節（`:859-988`）・CSS の bad-string / url-token 節（`:580-660`）・派生投影節（`:990-1030`）・`editTextNodes` 節（`:1186-1275`）と、テーブル全体の `title` / `tc` 一覧。許可リストの逐条テーブル本体（`:100-580` の大半）は目視していない。
- `spec/usecases/note.md` / `spec/domains/note.md` / `spec/testcases/note/*.md` / `spec/inventory/test.md` — 本ラウンドの論点（資源上限・`NOTE_HTML_TOO_COMPLEX`・バッチ件数・retention 20）に関わる節のみ。

**スキップしたもの（担当範囲内）**

- `packages/core/src/application/note/purgeNote.ts`（686 行）— route CAS / forward recovery はラウンド 001〜007 で重点的に見られており、本ラウンドの差分の焦点でもないため。`purgeExpiredTrash` / `emptyTrash` から呼ぶ側のインターフェース（`purgeNoteInternally` / `purgeNote` の入力）だけ確認した
- `packages/core/src/application/note/moveNote.ts`（1,579 行）、`deleteNotesForOwner.ts`（488 行、バッチ件数のみ確認）、`view.ts`、`getNote.ts`、`listNotes.ts`、`createBlankNote.ts`
- `packages/core/src/application/note/__tests__/` の各テスト本文（件数・`it.skip` / `toBeDefined()` の走査のみ）
- `packages/core/src/application/di/` / `execution/unitOfWork.ts` / `workers/scopeTaskRunner.ts` の note 該当部分（`subscribers.ts` を除く）
- `spec/testcases/note/` の各ファイル本文（該当行の grep のみ）、`spec/manual-tests/editing.md`
