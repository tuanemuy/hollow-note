### frontend

対象: `7-round-006.files`（194 行）のうち `apps/web/app/` の 38 ファイル全部と、`spec/pages/index.md` / `spec/manual-tests/editing.md` / `spec/inventory/frontend.md` / `spec/design/` との整合。ゼロベースで読み直した（差分ではなく現物のファイルを読み、行番号は現物のもの）。判定済みキー（`triage-keys.md`）は再掲しない。

今ラウンドの 5 つの重点について先に結論を置く。

- **WYSIWYG の `<style>` 落とし**: 落とす操作そのもの（`surfaces.tsx:293-297`）と、シード・貼り付けの 2 経路（`130-141` / `166-177`）はどちらも通っている。**門のほうが漏れている** — `mayLoseDecoration` は断片を描いた時点の本文からしか作られず、面へ実際に載る本文（`reseedFromServer` が引き直す `latest.html`）を見ていない（B-002）。
- **「落とすのは保存で落ちるものの部分集合」**: 属性（`on*` / `javascript:` URL）は部分集合。要素は **`form` 1 つだけ破れている** — 保存は unwrap（子は残る）、面は subtree ごと `remove()`（子が消える）（W-001）。`style` は JSDoc どおり部分集合の外だが、それは門で担保する設計なので B-002 と同じ話に帰着する。
- **`reseedIfUnchanged(sent)` への集約**: 本文については「送った写しを確定させる」規則が全経路で保たれている。ただし**タイトルは守られていない** — 載せ直しが `replaceBody` で入力欄を無条件に上書きするので、往復中に打ったタイトルが黙って消える（B-001）。`skippedPaths` を基準に残す扱い（`settleSaved` の `708-733`）自体は正しく、`visualOriginal` へ拒否経路を戻す向きも合っている。
- **永久に保存できない経路**: `creationFailed`（`editor.tsx:781`）は意図的な閉鎖で逃げ道（ダウンロード）がある。`failed` / `conflict` / `locked` / `blocked` はいずれも再開の起点を持つ。**恒久的に詰む経路は無い**。ただし決定的な業務拒否（本文 800 KB 超）まで `failed` に畳んでいるので、成功しない「再試行」を勧める（W-006）。
- **`NoteDetail` の活性ユニオン + `runExclusive`**（`detail.tsx:48-...`）と **退避の 7 日期限**（`preferences.ts:88` / `121-135`）: どちらも指摘なし。版を送る 4 経路がすべて `runExclusive` の中からしか呼ばれないこと、期限切れの掃除が読み・鍵単位・前置き単位の 3 段で閉じていることを確認した。掃除の**頻度**だけが問題（W-004）。

#### Blockers

- **[B-001]** `apps/web/app/components/note/NoteEditor/editor.tsx:748-752` `reseedIfUnchanged` — **往復中に打ったタイトルが黙って捨てられる**（「送った写しを確定させる」規則の逆向きが本文にしか適用されていない）

  `reseedIfUnchanged` が比べるのは `takeSnapshot().body !== sent.body` の 1 本だけで、`title` を見ていない。載せ直し先の `replaceBody`（`930-943`）は `setTitle(nextTitle)`（`932`）で入力欄を**無条件に**上書きする。同じファイルの `commit` がタイトルを書き戻す 2 か所（`550` / `595`）はどちらも `setTitle((value) => value === sent.title ? applied : value)` と、往復中の打鍵を踏まないよう明示的に守ってあるので、規則が守られていないのは載せ直しの側だけである。

  再現: ビジュアルモードで本文を書き換える → 自動保存が走る（`619` か `643` の枝で `reseedIfUnchanged` に入る）→ 往復のあいだにタイトル欄へ 1 文字打つ → 往復が終わると `replaceBody(latest.title, latest.html)` が走り、打った文字が消える。しかも `savedTitle` も `latest.title` になるので `dirty` が下りて**未保存の表示すら出ない**（`353`）。`EditorSnapshot` の JSDoc（`83-102`）と `reseedIfUnchanged` の JSDoc（`735-747`）が「往復のあいだに打った文字をそのまま捨ててしまう — 写しの規則の逆向きである」と自ら書いている、まさにその事象がタイトルで起きている。

  直し方: `reseedIfUnchanged` の門を `takeSnapshot()` の `body` と `title` の両方にする（`sent` は両方を持っている）。ビジュアルの面は本文 state を動かさない都合で本文だけを見れば足りると読めるが、タイトルは面の外の素の `<input>` なので同じ守りが要る。

- **[B-002]** `apps/web/app/components/note/NoteEditor/editor.tsx:828-831` `needsWysiwygWarning` / `NoteEditor/index.tsx:106-109` `mayLoseDecoration` — **ED-04 の門が「断片を描いた時点の本文」でしか判定されず、面が実際に載せる本文を見ていない**

  `mayLoseDecoration` はサーバーコンポーネントが 1 度だけ作る値（`index.tsx:106-109`、`hasStyleElement` は `147`）で、島はそれを `target` プロップとしてしか読まない。一方 WYSIWYG の面が載せるのは `reseedFromServer`（`editor.tsx:884-897`）が引き直した `latest.html` であり、`dropStyleElements` はその本文から `<style>` を落とす。両者が指す本文がずれた瞬間、`surfaces.tsx:288-291` が約束している「`<style>` を持つ本文は `mayLoseDecoration` に入るので、この面は警告を了解しないかぎり開かない」が成り立たない。

  再現（ED-03 → ED-04 の素直な並び）: `<style>` を持たない既存ノートを開く（`mayLoseDecoration === false`）→ HTML モードでスタイルシート付きの Web ページを貼って**自動保存**する（`664` のとおり自動保存は `reconcile()` を呼ばないので断片は描き直されず、プロップは古いまま）→ WYSIWYG へ切り替える → 警告も出ず、`wysiwygConversion` の版理由も付かないまま `<style>` が面から落ち、次の保存でそのまま本文から消える。`updateNoteBody` は `styleMode` を動かさないので `styleMode === "preserve"` の枝でも拾えず、`sourceFileId` も `null` のままである。

  ついでに `TC-06` 手順 1（「装飾を失いうるノートは HTML モードで開かれる」）もこの経路では成立しない。

  直し方: 門の材料を「いま面へ載せようとしている本文」にする。`seedMode` / `applyMode` が持っている `nextBody`（= `latest.html` / `savedRef.current.body`）に対して `hasStyleElement` 相当を当てれば、`target.mayLoseDecoration` は「取り込み由来か」だけの判定に縮められ、両者の or で門が閉じる。`hasStyleElement` はサーバー専用の実装ではない（正規表現）ので島からも呼べる。

#### Warnings

- **[W-001]** `apps/web/app/components/note/NoteEditor/surfaces.tsx:237-247` `UNSAFE_PREVIEW_ELEMENTS` — `form` だけ「保存で落ちるものの部分集合」が破れており、貼り付けた本文が**面の側でだけ消える**

  面は `scrubForSurface`（`259-275`）で `UNSAFE_PREVIEW_ELEMENTS` の要素を `element.remove()` = subtree ごと落とす。保存側（`packages/core/src/adapters/html/allowList.ts`）は、`DROP_WITH_CONTENT`（`124-141`）に載っているものだけを subtree ごと落とし、**それ以外の未許可要素は unwrap（子を残す）**する（同ファイル `106-123` の JSDoc が「本文の散文を黙って消さない」ことを ADR 006 由来の要件として明記している）。`script` / `noscript` / `iframe` / `object` / `embed` は両側とも subtree ごとなので一致、`link` / `meta` / `base` は子を持たないので差が出ない。**残るのは `form` 1 つ**で、保存は `<form>` の中の散文を残し、面は散文ごと消す。

  WYSIWYG は DOM が本文の正本（`editor.tsx:502`）なので、これは表示だけの差では済まない — `<form>` に包まれた領域を Web ページから WYSIWYG へ貼ると（`surfaces.tsx:166-177` も `scrubForSurface` を通す）、その中の本文が**恒久的に**消えて次の保存でサーバーへ書き戻る。`spec/manual-tests/editing.md` TC-17 手順 6 の期待（`form` は「除去された旨が一覧される」= 保存側は unwrap して報告）とも噛み合わない。

  直し方: `form` を「要素だけ外して子を残す」扱いにする（`element.replaceWith(...element.childNodes)`）。`UNSAFE_PREVIEW_ELEMENTS` を「subtree ごと落とす集合」と「unwrap する集合」の 2 つに割るのが素直で、割り方の正典は `allowList.ts` の `DROP_WITH_CONTENT` になる。

- **[W-002]** `apps/web/app/components/note/NoteEditor/surfaces.tsx:133-140` / `166-177` / `311-322` — scrub の結果を**文字列へ戻して再パース**する経路が 2 本ある（mXSS の窓）。同じファイルに窓の無い書き方（`515`）がある

  3 つの面のうち、ビジュアルだけは `root.replaceChildren(style, template.content)`（`506-515`）で scrub 済みの**木をそのまま**渡していて、直列化と再パースを挟まない。残る 2 本は挟む。

  - WYSIWYG のシード: `template.innerHTML = baseline` → scrub → `surface.innerHTML = template.innerHTML`（`133-139`）
  - WYSIWYG の貼り付け: 同じ形で `document.execCommand("insertHTML", false, template.innerHTML)`（`170-175`）
  - HTML のプレビュー: `analyzeMarkup` が返す文字列を `NoteBody` へ渡し、`NoteBody/index.tsx:86` / `96` が `<style>…</style>` と連結して `shadowRoot.innerHTML` に入れる

  「サニタイズした木を直列化し、別の解析文脈で読み直す」は既知のサニタイザー迂回（mXSS）の形で、`<svg>` / `<math>` 由来の名前空間混同と `<style>` / `<title>` の raw text で属性境界が動くと、scrub 後に無かった `on*` が再パースで復活しうる。ここへ**未保存の他所由来 markup が入る経路は実在する** — WYSIWYG への貼り付けと、ED-03 の中核（保存済み Web ページを HTML モードへ貼る）である。

  直し方: WYSIWYG の 2 経路は `surface.replaceChildren(template.content)` / `range.insertNode(template.content)` にすれば窓ごと無くなる（`insertHTML` を使わない場合は caret と undo の扱いを別途決める必要はある）。HTML プレビューは `NoteBody` が文字列で受ける形なので、`<style>` を要素として作って fragment を append する分岐を足すか、この窓を承知のうえで残す旨を JSDoc へ書く（いまの JSDoc（`207-235`）は「`on*` を落とす」とだけ書いていて、落とした後に何が起きるかを扱っていない）。

- **[W-003]** `apps/web/app/components/note/NoteEditor/surfaces.tsx:220-227` / `549-558`、`components/note/NoteBody/index.tsx:154` — 「shadow root なのでセレクターの到達範囲はそこで閉じる」は `:host` に対しては成り立たない

  shadow tree の中の `:host { … !important }` は**ホスト要素**（light DOM 側の要素）に当たる。CSS Scoping の並び順は、通常宣言なら外側の木が勝つが、`!important` が付くと内側の木が勝つ。したがって本文の `<style>` に `:host { transform: scale(40) !important }` のような 1 行があると、ホストに掛けてある Tailwind の `relative`（`surfaces.tsx:557` / `NoteBody/index.tsx:154`）では止まらず、面・本文が編集画面や詳細画面を覆える。`position` だけは保存側の CSS フィルター（`packages/core/src/adapters/html/css.ts:53-69`）が static / relative / absolute に絞っているので固定配置は取れないが、`transform` / `width` / `margin` は絞られていない。

  HTML のプレビューだけは外側の `[contain:layout_paint]`（`surfaces.tsx:438`）が包含ブロックと描画のクリップを作るのでここが閉じている。**同じ包みがビジュアルの面と `NoteBody` に無い**のが非対称で、共有ワークスペースでは他のメンバーが書いた本文が閲覧者の画面を覆える（クリックの誘導も同じ形で作れる）。

  直し方: ビジュアルの面と `NoteBody` のホストを、HTML のプレビューと同じ `[contain:layout_paint]` の親で包む。ホスト自身に掛けても `:host` が当たる先はホストなので効かない（親に要る）。

- **[W-004]** `apps/web/app/components/note/NoteEditor/preferences.ts:121-135` `sweepExpiredDrafts` — 期限切れの掃除が**保存が通るたび**に走り、`localStorage` の全退避を本文ごと `JSON.parse` する

  `readDraft`（`137-146`）は先頭で必ず `sweepExpiredDrafts` を呼ぶ。その `readDraft` を呼ぶのは `editor.tsx:390-394` の effect で、依存は `[noteId, savedBody]` — `savedBody` は**保存が確定するたびに動く**（`rememberSaved`）。つまり自動保存 1 回ごとに、前置きの下にある退避すべて（1 件が最大で本文 1 つぶん＝ 800 KB 級）をメインスレッドで `JSON.parse` して回す。編集中に 1.5 秒間隔で走りうる仕事としては重い。

  掃除そのものの必要性（共用端末に本文を残さない）は妥当なので、起動を 1 回に絞ればよい — 島のマウント時に 1 回だけ掃く（`useRef` のガード）か、`sweepExpiredDrafts` を `readDraft` から外して呼び出し側で 1 回呼ぶ。鍵単位の期限判定（`139-144`）は今のまま毎回でよい（1 件しか読まない）。

- **[W-005]** `apps/web/app/components/note/NoteEditor/editor.tsx:649-651` — 載せ直しに入らない枝がビジュアルモードで面と `body` state の食い違いを直さないので、`dirty` が永久に下りない状態を作れる。`735-747` の JSDoc が約束する回復も、この枝を通ると起きない

  ビジュアルモードでは `body` state が面の編集で動かないので、退避の復元（`1300-1306`）や競合の上書き（`985-994`）のあとは `body !== savedBody` になり、`takeSnapshot` は丸ごと送る枝を選ぶ（`513`）。その保存で `reseedIfUnchanged` が偽（往復中に打鍵があった）を返すと `settleSaved(sent, appliedTitle)`（`644`）が走るが、`sent.textNodes === null` なので `settleSaved` は `setBody` を呼ばず（`714-730`）、`body` は古いまま `savedBody` だけが進む。

  ふつうはこの後の往復が新しい差分を送って `reseedIfUnchanged` が通り噛み合いが戻るが、往復中の打鍵が元の値へ戻された場合は次の `commit` が `sent.body === savedBody` となって `649` の枝へ落ちる。この枝は載せ直しを試みないので `body` は永久に古いままで、`dirty`（`353`）が下りず、自動保存の effect が 1.5 秒ごとに空回りし続ける（`busy` が毎周期トグルするので書式バーも明滅する）。`reseedIfUnchanged` の JSDoc「打鍵の無い往復が 1 回あれば載せ直しが通って噛み合いが戻る」は、この枝を通る限り成り立たない。

  同じ根から、`1527-1536` の skip 通知の文面「最新の本文で編集欄を読み直すので」も、`619` で `reseedIfUnchanged` が偽を返した回には嘘になる（読み直していない）。

  直し方: `649` の枝でも `mode === "visual"` なら載せ直しを試みる（`sent.body === savedBody` でも面と state はずれているため）か、`settleSaved` を「`mode === "visual"` なら常に `setBody(sent.body)`」に広げる。前者なら skip 通知の文面もそのまま正しくなる。

- **[W-006]** `apps/web/app/components/note/NoteEditor/editor.tsx:439-457` `classify` — 決定的な業務拒否まで `failed`（通信エラー）へ畳むので、成功しない「再試行」を勧め、上限超えの本文を毎回 `localStorage` へ書く

  `classify` の `default` 枝は「退避して再試行」を意味する `failed` である。ここへ落ちるのは通信エラーだけではない — `NOTE_CONTENT_TOO_LARGE`（ED-03 の「800 KB 超は拒否」）と `NOTE_INVALID_TITLE`、転送境界の `INVALID_INPUT` も同じ枝に来る。結果として `1402-1412` の「再試行」が出るが、同じ本文を送るかぎり必ず同じ拒否が返る。文言（`presentation/errorDisplay.ts:95`「分割してからもう一度お試しください」）は正しく分割を勧めているのに、隣のボタンが分割しない再送を勧める形になっている。あわせて `671-677` が 800 KB 超の本文を毎回 `writeDraft` するので、`localStorage` の quota を無駄に押す（例外は握り潰されるので実害は小さいが、退避できたと表示しうる）。

  直し方: `classify` に「利用者が内容を直すまで再試行が意味を持たない」枝を 1 つ足し（`SaveStatus` に `rejected` 相当）、そこでは退避と再試行を出さず文言だけを出す。`SaveStatus` は既に判別ユニオンなので追加の副作用は無い。

- **[W-007]** `spec/pages/index.md:298` — P-12 の「新規作成時は…取り込み先セレクターを表示する」が実装（と `spec/inventory/frontend.md:64`）と食い違ったまま残っている

  実装は `editor.tsx:1261-1277` で取り込み先を**読み取り専用のチップ**として出すだけで、個人文脈の `/notes/new` からワークスペースを選ぶ手段は無い。`spec/inventory/frontend.md:64`（PAGE-p12-002）は「current owner に private blank note を作り」と書いていて実装と一致するので、食い違っているのは `spec/pages/index.md` の 1 行だけである。本 PR は同じファイルの P-11 と P-14 を実装に合わせて改訂している（`spec/pages/index.md:259` / `364`）のに、この行だけ取り残されている。セレクターを作らない判断なら、`spec/` 側を「現在の文脈を取り込み先として示す」に直す。

#### テスト保証

対象は `presentation/` と `components/note/__tests__/` の純関数テスト（新規のコンポーネントテストが無いことは指摘しない）。

- `presentation/__tests__/errorDisplay.test.ts:101-149` — 計画のテスト方針が挙げた文言（`NOTE_IS_TRASHED` / `NOTE_LOCKED_BY_JOB` / `NOTE_CONTENT_TOO_LARGE` / `NOTE_INVALID_TITLE` / `NOTE_INVALID_STYLE_MODE` / `NOTE_NOT_TRASHED` / `REVISION_NOT_FOUND`）を全部押さえている。押さえ方が「kind の共通文言と**違う**こと」なので、辞書から行を消せば必ず落ちる — 文字列の丸写しより強い。`OPTIMISTIC_LOCK_FAILURE` をこの形で押さえられない理由（共通文言と同一で、それが正しい）が `113-115` に書いてあり、代わりに HTTP 側（`errorResponse.test.ts` の 409）で押さえている。生 message の非漏洩（`52-67`）と `Object.prototype` 由来の `code`（`69-82`）も残っている。
- `presentation/__tests__/errorResponse.test.ts:53-72` — 「例外表に**入っていない**こと」を固定する向きの検査で、うっかり 401/410 を足すと落ちる。効いている。
- `components/note/__tests__/schema.test.ts:78-129` — 転送上限（2 MB）とドメイン上限（サニタイズ後 800 KB）の**関係**そのものを検査している。`107-129` は実際に `createHtmlProcessor().process()` まで通して「転送は通り、ドメインが `ContentTooLarge` で拒む」を突き合わせており、両側の数を独立に動かすと落ちる。ここは本スライスで一番実効性の高いテスト。
- `routes/__tests__/storage.delivery.test.ts:296-326` — 公開してよい purpose の集合を、ルート側と `FILE_PURPOSES` の差分の両側から押さえている。purpose が増えたときに編集なしで 404 側が広がる形で、片側だけの固定になっていない。`280-294` は SVG の `nosniff` + `sandbox` を押さえていて、`storage.$.tsx:75-81` のヘッダーを消すと落ちる。

弱いところ: 本ラウンドの Blocker 2 件はどちらも DOM とサーバー往復が絡む島の中の遷移で、純関数テストの層では届かない。ただし `hasStyleElement`（`NoteEditor/index.tsx:147`）と `isSafeLinkUrl`（`editor.tsx:1952-1962`）、`diffTextNodeEdits` / `collectEditableTextNodes`（`textNodes.ts`）は**純関数として切り出されている**のにテストが無い。`docs/test.md` の「Frontend: the bare minimum」の例外（`presentation/` の純関数）の趣旨からすれば、経路づけ（アダプターの `resolveTextNode` と噛み合う必要がある）とリンクスキームの判定は同じ理由でテストに値する。今回の指摘には数えないが、次に触るときの候補として残す。

#### カバレッジ

読んだファイル（`apps/web/app/` 全 38 ファイル）:

- `components/layout/ScopeToken/index.tsx`（差分ハンク）, `components/layout/ScopeToken/listing.ts`
- `components/note/NoteBody/index.tsx`
- `components/note/NoteDetail/index.tsx`, `NoteDetail/detail.tsx`, `NoteDetail/menu.tsx`
- `components/note/NoteEditor/{index,editor,frame,skeleton,surfaces}.tsx`, `NoteEditor/{highlight,preferences,textNodes}.ts`
- `components/note/NoteList/board.tsx`, `NoteList/index.tsx`
- `components/note/TrashList/{index,board}.tsx`, `TrashList/action.ts`
- `components/note/schema.ts`, `components/note/__tests__/schema.test.ts`
- `presentation/errorDisplay.ts`, `presentation/__tests__/errorDisplay.test.ts`, `presentation/__tests__/errorResponse.test.ts`
- `routes/notes/-action.tsx`, `routes/notes/$noteId_.edit.tsx`, `routes/notes/new.tsx`, `routes/notes/trash.tsx`
- `routes/storage.$.tsx`, `routes/__tests__/storage.delivery.test.ts`
- `routes/workspaces/$workspaceId/-action.tsx`, `routes/workspaces/$workspaceId/notes/{index,new,trash,$noteId_.edit}.tsx`
- `routes/workspaces/$workspaceId/settings/-action.tsx`（差分ハンク）, `settings/route.tsx`（差分ハンク）
- `routeTree.gen.ts` — 生成物なので、6 本の新ルートが登録されていることの確認のみ

判断のために読んだ差分外のファイル: `packages/core/src/adapters/html/{allowList,css,htmlProcessor}.ts`（面の scrub が保存の部分集合かの突き合わせ）、`packages/core/src/application/note/view.ts`（`version` / `purgeAfter` の供給側）、`apps/web/app/styles/{tokens,theme}.css`（新規に使ったトークンの実在確認 — `--code-*` / `--bar-height` / `--list-max` / `--tracking-tighter` ほかすべて実在）、`spec/pages/index.md`、`spec/inventory/frontend.md`、`spec/manual-tests/editing.md`（差分全量）。

スキップしたファイル: なし（担当分は全量読んだ）。

記述の衛生: `apps/web/app/` 配下に `.thread/` への参照は無い（リポジトリ全体でも `spec/` / `docs/` / `packages/core/src/` を含めて 0 件）。コード内の参照先は `spec/` の節と ADR 番号に閉じている。
