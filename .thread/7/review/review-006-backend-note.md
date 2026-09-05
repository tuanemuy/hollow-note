### backend-note

#### Blockers

**[B-001]** CSS の文字列字句が改行で終わらないため、`position: fixed` のオーバーレイがサニタイズを素通りする

- 場所: `packages/core/src/adapters/html/css.ts:80-97`（`skipString`。閉じ引用符だけを終端とし、見つからなければ `:96` で入力末尾まで進む）。契約側は `spec/adr/013-html-sanitization-policy.md:127`（「宣言の切り出しは、ブラウザと同じ字句規則で行う」）と `css.ts:29-38` のモジュール JSDoc
- 理由: CSS Syntax の consume-a-string-token は改行（LF / CR / FF）で **bad-string-token** を返し、改行を reconsume する。したがってブラウザは `content:"a⏎;position:fixed;` を「壊れた `content` 宣言」＋「`position:fixed` 宣言」の 2 つに切り、後者を**適用する**。本実装は閉じ引用符が現れないまま入力末尾まで走るので `;` を失い、全体を 1 つの `content` 宣言として通す。ADR 013 のコンテキスト 3 が名指しする「`<style>` 1 個で公開ページ全面を覆えるオーバーレイ」がそのまま成立する。実機で確認済み（`createHtmlProcessor().process`）:
  - 入力 `<style>.o{content:"a⏎;position:fixed;top:0;left:0;width:100%;height:100%;background:red}</style>` → 出力は**入力と同一**、`removed` は `[]`
  - `style` 属性でも同じ（`<p style="content:'a⏎;position:fixed">`）。`\r` / `\f` でも成立する
  - ブロック境界でも成立する（`div{content:"a⏎} .x{position:fixed}`、`@media screen{...}` 内側も同様）
  - `removed` が空なので、ADR 013 の「除去した内容は利用者に提示する」も同時に空振りする
- 到達経路: `updateNoteBody`（HTML モード）→ `htmlProcessor.process` → `filterCss`。保存した本文をそのまま公開ページ（P-44）で描画できる。`applyTextNodeEdits` / `restoreNoteRevision` / `listNoteRevisions` の再サニタイズも同じ穴を通す
- 提案: `skipString` に bad-string 規則を足す。`\` は既に `readEscape` を通っているので行継続（`\`＋改行）は自然に維持され、素の改行だけを終端にすればよい:
  ```ts
  if (char === "\n" || char === "\r" || char === "\f") {
    return i; // bad-string-token: 改行は次の字句として読み直される
  }
  ```
  不動点は保たれる（1 回目で `content:"a;` を書き戻し、2 回目は改行が無いので終端が見つからず終端子を補わない）。合わせて **ADR 013:127 の「コメント・文字列・エスケープの 3 つ」に、文字列が改行で壊れる規則を書く**（正典が 4 つ目・5 つ目の規則を持たないままだと、次に走査を足す人が同じ穴を開ける。ADR 自身がそう書いている）。テストは `htmlProcessor.test.ts` の `sanitizeCases` に改行入り文字列の行を足す（現状この表に改行のケースが 1 件も無い）

**[B-002]** `HtmlProcessor.process` が入れ子の深さに対して無制限に再帰し、22 KB の入力で `RangeError`、40 KB の入力で数秒の CPU を焼く

- 場所: 同一原因の 2 か所。
  - `packages/core/src/adapters/html/htmlProcessor.ts:405-413`（`sanitizeNodes`）↔ `:426-485`（`sanitizeNode`、再帰は `:414` と `:483`）
  - `packages/core/src/adapters/html/css.ts:398-446`（`filterCss` がブロックごとに `:443` で自己再帰）＋ `:306-330`（`findBlockEnd` が階層ごとに残り全体を走査し直す＝ O(n×深さ)）
  - 転送境界の許容量は `apps/web/app/components/note/schema.ts:46` の `NOTE_HTML_TRANSPORT_MAX = 2_000_000`。ここと parser のあいだに深さの番人が 1 つも無い
- 理由: 実測（`createHtmlProcessor().process`、この worktree の Node）:

  | 入力 | 大きさ | 結果 |
  | --- | --- | --- |
  | `<div>` × 2,000 の入れ子 | 22 KB | 30 ms で `RangeError: Maximum call stack size exceeded` |
  | `<div>` × 50,000 | 550 KB | 15.1 s 焼いてから `RangeError` |
  | `<style>@media a{` × 2,000 | 20 KB | 0.9 s（正常終了） |
  | `<style>@media a{` × 6,000 | 60 KB | 7.3 s 焼いてから `RangeError` |
  | `<style>@media a{` × 12,000 | 120 KB | 18.4 s 焼いてから `RangeError` |

  スタックのフレームは `sanitizeNodes` (`htmlProcessor.ts:410`) ↔ `sanitizeNode` (`:483`) の相互再帰で、parse5 自体は同じ入力を問題なく解析している（`parseFragment` は成功する）。CSS 側は深さが線形に効くだけでなく `findBlockEnd` の再走査で **二乗**になるため、`RangeError` に届かない深さ（〜4,000＝40 KB）に調整すれば 1 リクエストあたり数秒を確実に焼ける。2 MB の予算には同じ塊を 50 個並べられるので、1 リクエストで分単位の CPU になる
  - 影響は 2 つある。**(a) 可用性**: 参照ランタイムは単一 Node プロセスで HTTP と worker を兼ねる（CLAUDE.md「Reference runtime」）ので、これは 1 認証ユーザーによるサービス全体のイベントループ停止である。目標プラットフォームでは scope が単一スレッドの Durable Object（`spec/platform/index.md`）なので、同じ scope への他の書き込みが全部詰まる。とくに `applyTextNodeEdits` は **scope のトランザクションを開いたまま** `process` を 2 回走らせる設計で（`applyTextNodeEdits.ts` の JSDoc が「800,000 bytes の parse → serialize → parse → serialize」と見積もっているが、実コストは深さに対して二乗である）、`spec/platform/index.md:67` の「Alarmは100行またはCPU 2秒まで」を単発で踏み抜く
  - **(b) エラー契約**: `RangeError` は `CodedError` ではないので `toSerialized()` を持たず、`kind` による構造的な直列化（CLAUDE.md「Error handling」）に乗らない。`domain/note/ports/htmlProcessor.ts` の JSDoc は「The shipped adapter … is backed by a total HTML5 fragment parser and therefore never reaches that branch」と宣言しているが、実際には宣言のどの分岐にも属さない例外が出る
- 提案: 深さの上限を 1 つ置き、両方の走査でそれを守る。
  - `sanitizeNode` / `sanitizeNodes` に `depth` を通し、上限（`spec/adr/013` に書ける定数、たとえば 256）を超えた部分木は `RemovedNode` として報告のうえ落とす（本文の表現力としてこの深さは要らない。落とすなら利用者に見える）
  - `filterCss` に同じ `depth` を通し、上限を超えたブロックは本文ごと 1 つの statement として素通しする（＝再帰しない）。`findBlockEnd` の結果を再帰先で使い回して二乗の再走査も畳む
  - どちらの上限も ADR 013 に行を足して正典化し、`htmlProcessor.test.ts` に「上限を超える入れ子が `RangeError` ではなく `RemovedNode` になる」ケースを足す

#### Warnings

**[W-001]** `readUrlToken` の過剰マッチが、宣言 1 つの除去で同じ規則の残りの装飾を巻き添えにする

- 場所: `packages/core/src/adapters/html/css.ts:174-215`（`readUrlToken`。JSDoc は「over-matched … only ever makes the scan see a terminator the browser hides — never the reverse」と安全側の方向だけを論じている）
- 理由: 安全側の主張自体は正しい（過剰マッチは分割を増やす方向にしか効かない）。だが分割が増えた結果、除去された側が閉じ括弧を持ち去ることがある。実測:
  - `.a{background:myurl(a(b);position:fixed);color:red}` → `.a{background:myurl(a(b);color:red}`
  - ブラウザから見ると `myurl(a(b);color:red}` は閉じない関数トークンなので、規則の残り（`color:red`）ごと飲まれる。ADR 013 が「違反した宣言だけを落とす。要素ごと捨てると、1 つの違反で本文全体の装飾が消える」と決めた性質が、宣言単位ではなく規則単位で破れている
- 提案: url-token を `)` ではなく**括弧の対応**で閉じる（`readUrlToken` の末尾走査に深さを持たせる）か、除去した statement が括弧の均衡を崩す場合はその statement を丸ごと素通しせず、少なくとも均衡を保った形で書き戻す。深刻度は低い（不正な CSS でのみ起き、機密性・可用性には影響しない）が、B-001 / B-002 の修正で `css.ts` を開くついでに畳める

**[W-002]** `scopeOfNoteOwner` の集約が半分で、`editing.ts` の別名を経由する経路が残っている

- 場所: `packages/core/src/application/note/editing.ts:58`（`export { scopeOfNoteOwner as scopeOfOwner } from "../scope";`）、利用側は `packages/core/src/application/note/purgeNote.ts:25,631`。逆向きの写像 `ownerOfScope` は `packages/core/src/application/note/deleteNotesForOwner.ts:474` にローカルのまま
- 理由: 振る舞いは変わっていない（`NoteOwner` と `ScopeKey` は同じ 2 ケースの直和で、`scope.ts:65-68` の分岐は置換前の各所と同型。7 箇所すべてを確認した）。問題は集約の理由書きのほうで、`scope.ts` の JSDoc は「Keeping the mapping here rather than in each caller is what makes "a note lives in its owner's scope object" one decision instead of one per usecase」と言っているのに、名前が 2 つ・import 経路が 2 つ残っている。`scopeOfNoteOwner` で grep すると `purgeNote.ts` が落ちる
- 提案: `purgeNote.ts` を `../scope` から直接 import して `editing.ts:58` の re-export を消す。`ownerOfScope` も逆写像として `scope.ts` に置くと、`deleteNotesForOwner` が「scope から owner を起こす」判断をローカルに持たなくなる

**[W-003]** 「書かれなかったこと」を `not.toBe(...)` / `toBeDefined()` だけで確かめているケースがある

- 場所: `packages/core/src/application/note/__tests__/renameNote.test.ts:161`、`packages/core/src/application/note/__tests__/deleteNotesForOwner.test.ts:229`
- 理由: `renameNote.test.ts:161` の `expect(storedNote(h, noteId)?.title.value).not.toBe("ゴミ箱の中で改名")` は、タイトルが空になっても・別の値に化けても・行ごと消えても通る。TC-note-785 が主張しているのは「拒否され、かつ書かれていない」なので、後半が検証になっていない。`deleteNotesForOwner.test.ts:229`（TC-note-071）はこの `toBeDefined()` 1 本だけがアサーションで、`view.purgedCount`（ワークスペースノート 1 件が消えたこと）を確認していない
- 提案: 前者は `toBe(<作成時のタイトル>)` に、後者は `purgedCount` と個人ノートの `lifecycle` を足す。他のノート系テストは軒並み肯定形で状態を固定できており、この 2 件だけが例外

#### テスト保証

- **担保できているもの。** `htmlProcessor.test.ts` の `sanitizeCases` は ADR 013 の表をテーブル駆動で持ち、TC-note-682〜724 を実アサーション（`toBe` / `toContain` / `not.toContain` / `toContainEqual`）で押さえている。とくにコメント・エスケープ・url-token の相互作用は網羅的で、`position/**/:fixed`・`\66 ixed`・`@\69 mport`・`\75 rl(`・`url(x/*)`・`url("x/*")`・`url(a;b)`・`url(a\);…)` まで個別に行がある。`filterCss(filterCss(x)) === filterCss(x)` は `sanitizeCases` 全入力＋壊れた CSS 9 種を回す独立の `describe` で押さえている。ポート契約側も両側突き合わせができている — `beginPurge` の「操作単位の冪等が CAS より先」は `adapters/conformance/noteRouteStore.ts` の ADP-note-043 2 ケースが memory / cloudflare 双方に効き、`findNextPurgeDeadline` と `listPurgeable` の順序は ADP-note-013 / 057 が同様。`note.purged` の 3 購読者（storage / tag / integration）は `workers/subscribers.ts` に個別登録され、`purgeNote.test.ts` / `deleteNotesForOwner.test.ts` が中断・再送・回収の窓を実アダプター委譲のラッパーで突いている。`spec/testcases/note/listNotes.md` / `listTrashedNotes.md` の行はテスト名と 1:1 で対応する（listNotes 6 行 / 6 テスト、listTrashedNotes 12 行 / 12 テスト）。担当分のテストは全 green（node プロジェクト 21 ファイル・587 テスト）
- **担保できていないもの。** B-001 の穴は `sanitizeCases` に**改行を含む CSS 文字列の行が 1 件も無い**ために素通りしている。不動点の入力集合にも改行入りの壊れた CSS は無い。B-002 の深さは、`process` の入力側の上限として `TC-note-721 / 722`（800,000 バイト）だけがあり、**入れ子の深さについてのケースは 0 件**。`applyTextNodeEdits` が UoW の中で `process` を 2 回走らせるコストについても、深さに対する上限を確認するテストは無い

#### カバレッジ

- **読んだもの（差分＋必要な差分外）**: `packages/core/src/adapters/html/css.ts`、`packages/core/src/adapters/html/htmlProcessor.ts`（1-560 と export 末尾）、`packages/core/src/adapters/html/allowList.ts`（`style` / `DROP_WITH_CONTENT` / `GLOBAL_ATTRIBUTES` 周辺）、`packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`、`packages/core/src/application/scope.ts`、`packages/core/src/application/note/{updateNoteBody,applyTextNodeEdits,renameNote,changeNoteStyleMode,editing,trashNote,restoreNote,listNoteRevisions,restoreNoteRevision,listTrashedNotes,emptyTrash,purgeExpiredTrash,purgeNote,deleteNotesForOwner,jobs,getNote,listNotes,view}.ts`、`packages/core/src/application/cleanup/notePurgeFanOut.ts`、`packages/core/src/application/workers/{subscribers,scopeTaskRunner}.ts`、`packages/core/src/application/di/{types,memoryRuntime}.ts`、`packages/core/src/application/execution/unitOfWork.ts`、`packages/core/src/application/ports/{noteRouteStore,objectStorage}.ts`、`packages/core/src/domain/note/{noteRevision,services/noteAccessPolicy,ports/htmlProcessor,ports/noteRepository}.ts`、`packages/core/src/adapters/conformance/{noteRepository,noteRouteStore}.ts`、`packages/core/src/adapters/memory/repositories/{noteRepository,noteRouteStore}.ts`、`packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`、`packages/core/src/adapters/cloudflare/d1/repositories/noteRouteStore.ts`、`packages/core/src/application/note/__tests__/`（アサーション監査全ファイル＋`renameNote` / `deleteNotesForOwner` / `purgeNote` / `listNotes` / `listTrashedNotes` の該当箇所）、`apps/web/app/components/note/schema.ts`（到達性確認）、`spec/adr/013-html-sanitization-policy.md`、`spec/domains/note.md`（差分）、`spec/usecases/note.md`（`getNote` / `listNotes` / `listTrashedNotes` / `emptyTrash` / `trashNote` の差分）、`spec/inventory/usecase.md`（差分）、`spec/testcases/note/{listNotes,listTrashedNotes}.md`、`spec/platform/index.md`（実行予算・scope task の該当行）
- **スキップしたもの（担当範囲内）**: `packages/core/src/application/note/moveNote.ts`（差分は `scopeOfNoteOwner` への置換 1 行のみで、置換の同型性は確認済み。本体 1,579 行は未読）、`packages/core/src/application/note/createBlankNote.ts`（同じく置換 2 行のみ確認）、`packages/core/src/application/note/__tests__/` の本文（`purgeNote.test.ts` / `trashNote.test.ts` / `emptyTrash.test.ts` / `updateNoteBody.test.ts` / `applyTextNodeEdits.test.ts` / `editingHarness.ts` はアサーション監査と抜き取りのみで全読していない）、`spec/testcases/note/` の `listNotes` / `listTrashedNotes` 以外の差分、`spec/manual-tests/editing.md`、`packages/core/src/application/di/cloudflareRuntime.ts`、`packages/core/src/adapters/cloudflare/do/schema.ts`、`packages/core/src/adapters/cloudflare/__tests__/` 一式（workers プロジェクトは未実行）
- **担当範囲外（他レビュアーの持ち分として意図的に読んでいない）**: `apps/web/app/{components,routes,presentation}/`、`packages/core/src/{domain,application,adapters}` の storage / tag / integration / usage 系、`pnpm-lock.yaml`、`apps/web/app/routeTree.gen.ts`
- **既知の残存露出として指摘していないもの**: `updateNoteBody` の HTML モードが境界のない markup を再帰的サニタイザーに渡す件（別 Issue 判定済み）、および `.thread/7/review/triage-keys.md` の `wont-fix` / `defer` 16 行
- **記述の衛生**: `packages/core/src`・`apps/web/app`・`spec/`・`docs/` に `.thread/` への参照は 0 件（grep 済み）
