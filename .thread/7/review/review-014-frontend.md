### frontend

#### Blockers

なし

#### Warnings

- **[W-001]** `liveReads.test.ts` の禁止集合の計算は、ラウンド 013 の 2 件（`await` 後の state 直読み・インライン閉包）は捕まえるが、**同じクラスの 4 つの書き方を素通りさせ、逆に 1 つの正しい書き方を偽陽性で落とす**。検査を独立した runner に写し（`ISLAND` をコピー先に向けただけ。F 30 語 / G 33 関数 / 違反 0 を再現）、`editor.tsx` のコピーへ次の 1〜2 行を足して実測した
  - 場所: `apps/web/app/components/note/NoteEditor/__tests__/liveReads.test.ts:133-144`（F の種が `useState` のみ）、`:160-180`（派生 const の閉包）、`:224-241`（G の到達が `CallExpression` の名前呼びのみ）、`:316-322`（`isShadowed` が `root = fn.body` で止まり、関数自身の仮引数を見ない）、`docs/test.md`「Convention scans」末尾（「A computed set makes both additions land inside the check with no edit to the test」）
  - 理由: 実測の結果（違反 0 = すり抜け）
    - **参照渡しで後から走る局所関数** — `const later = () => { if (dirty) … }` を島直下に置き、`commit` の中で `window.setTimeout(later, 0)` / `Promise.resolve().then(later)` / `requestAnimationFrame(fnA)`（`fnA` が `fnB()` を名前呼びし `fnB` が `dirty` を読む 2 段）の 3 形。いずれも**違反 0**。G の到達が `node.expression` が識別子の `CallExpression` に限られ、引数位置の識別子を辿らないため。検査の JSDoc 自身が「往復の途中で張られたタイマーの中」を対象と書いているが、捕まるのはインラインの矢印関数（`setTimeout(() => { … dirty … })` は行 683 で検出）だけである
    - **`useState` 以外のフックが返す描画値** — `const canSend = useMemo(() => dirty && editable, [dirty, editable])` を `commit` の `await` 後で読んでも**違反 0**（`isAnyHookCall` が閉包から外す）。`useTransition` の `isSideBusy` を読んでも**違反 0**（seed が `useState` のみ）。`useActionState` の state / `useOptimistic` の値 / `useDeferredValue` も同じ扱いになる
    - **props** — `target.mayLoseDecoration` を `await` 後で読んでも**違反 0**。島の仮引数は F に入らない。現在の `needsWysiwygWarning`（G に属する）が `target.mayLoseDecoration` を読んでいるのは、`willDropStyleElements(nextBody)` との or と `sourceFileId` の不変性で実害が無い形だが、それは検査ではなく人が確かめている
    - **局所関数を経由した派生値** — `const describeDirty = () => (dirty ? "d" : "c"); const dirtyLabel = describeDirty();` を島直下に置き `dirtyLabel` を `await` 後で読んでも**違反 0**。初期化子が参照するのは `describeDirty`（関数なので F 外）だけで、`dirty` に到達しない
    - **偽陽性** — `const applyMode2 = async (mode: EditorMode) => { await …; console.log(mode); }` は仮引数 `mode` の読みが `editor.tsx:429 mode` として**違反**になる。`isShadowed` が `fn.body` で打ち切り、関数自身の仮引数を局所名に数えないため。いま G にある関数の仮引数（`next` / `sent` / `latest` / `revisionId` …）が F と衝突していないだけで、衝突する名前を付けた瞬間に正しいコードが赤になり、直す側が除外条件を広げる誘因になる
    - 現在の `editor.tsx` にはこれら 4 形の**実例は無い**（`.then(` / `setTimeout(` / `requestAnimationFrame(` を G の中で参照渡ししている箇所は無く、`useMemo` / `useOptimistic` は使っておらず、`isSideBusy` / `isSubmitting` は JSX と `busy` の材料でしか読まれない）ので、利用者に見える欠陥は無い。問題は **ADR-137 と `docs/test.md` が「計算だから足しても漏れない」と言い切っている保証が、この 4 形については成り立っていない**ことである。列挙をやめたのは正しいが、計算の定義域が「名前呼び」「`useState`」に狭く、その外は列挙と同じく「誰かが覚えている名前」に戻っている
    - あわせて、テストの主張は `size > 10` と `violations === []` の 2 本だけで、**検出力を証明する陽性ケースが無い**。今回の実測は手元の写しで行ったもので、検査を弱める変更（たとえば `walk` を関数境界で止める）を入れても緑のままである
  - 提案: 定義域を「島のスコープに現れる束縛すべて」へ広げ、除外を性質で書く
    - **F** = 島の仮引数（分割代入の全名）∪ 島直下の変数束縛の全名 − 初期化子が関数リテラルのもの − `useRef` の結果。派生 const の閉包計算は不要になる（束縛はすべて描画が捕まえた値と見なす）。`useState` の setter・`useTransition` の `start*`・`useServerFn` の結果は関数なので、**呼び出し位置（`CallExpression.expression === id`）の識別子を読みに数えない**規則で外れる。残る `router`（`useRouter`）・`titleId`（`useId`）は「描画を跨いで同一性が変わらないフックの結果」として JSDoc 付きの小さな閉じた表で外す — これは島の state ではなくフックの意味論に対する表なので、state を足すたびに漏れる種類の列挙にはならない
    - **G** = `await` を持つ関数 ∪ G の本体に**値位置の識別子として現れる**局所関数（呼び出しだけでなく引数・プロパティ値・JSX 属性を含む）の閉包。これで `setTimeout(later)` / `.then(later)` / `requestAnimationFrame(fnA)` → `fnB` が全部 G に入る
    - **シャドウ** — `isShadowed` の走査を `fn.body` ではなく `fn` まで上げ、関数自身の仮引数を局所名に数える
    - **陽性ケース** — 解析をソース文字列を受け取る関数に切り出し、上の 4 形 + 直読み + インライン閉包の 6 本を「検出する」側の `it.each` として同じファイルに置く。今回の実測をそのまま固定できる
    - `docs/test.md` の末尾の一文は、計算の定義域（何を束縛・到達と見なすか）を書いたうえで言い切る形に直す（定義域の外は計算でも漏れる、が事実である）

- **[W-002]** 「未保存の変更があります → 保存して切り替える」は、保存が通ったあと `enterMode(next)` を直接呼び、モードのラジオが持つ未保存の門（`requestMode` の `if (dirty)`）を通らない。保存の往復中に面へ打った文字（`confirm` が「送っていない打鍵」として残した分）は、続く `applyMode` → `reseedFromServer` → `loadSurface` が**確認なしに正本で上書き**する
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:2265-2275`（`const next = liveRef.current.pendingMode; if (saved === true && next !== null) enterMode(next);`）、`:1181-1192`（`requestMode` の門）、`:1420-1431`（`loadSurface` が `setBody` / `setTitle` で面を置き換える）
  - 理由: 面は保存中も書ける設計（`editable` は `locked` / `blocked` でしか下りず、TC-04 手順 4〜5・TC-06 手順 2 は往復中の打鍵を前提にしている）。`commit` は往復中の打鍵を捨てないよう `confirm` と `reseedIfUnchanged` の門で守っているのに、この経路だけは保存が通った直後に `dirty` を見ずに載せ直しへ進む。往復が終わった描画では `dirty` が真に戻っているので自動保存のタイマーは張られるが、`applyMode` の `runExclusive` が先に占有を取って `busy` になり、タイマーは effect の cleanup で落ちる — 打鍵はどこにも送られずに消える。Alert の文言「いまの内容は保存済みの状態に戻ります」は押した時点の内容への同意であって、押したあとに打った分への同意ではない。ラジオ経由なら同じ状況で確認がもう一度出る（一次経路の門）
  - 提案: `await` の後に `liveRef.current.dirty` を見て、真なら `enterMode` を呼ばずに戻る（`pendingMode` は残っているので同じ Alert がそのまま出直し、利用者はもう一度「保存して切り替える」か「取りやめ」を選べる）。`requestMode(next)` を呼ぶ形にすると、その `requestMode` は往復を始めた描画の閉包で `dirty` を読むので `liveReads.test.ts` が赤にする — 門の材料は `liveRef` から取ること。手順書 TC-07 に「通信を低速にし、確定を押してから往復が終わるまでに 1 文字打つ → 切り替わらず確認が出直し、打った文字は面に残る」を 1 行足す

#### 検証メモ（指摘にしなかったもの）

- ラウンド 013 の 5 件の修正はいずれも現在のツリーで真: `commit` の `importing` は `liveRef.current.importReferences` を読み TC-34 手順 9 が加わった（B-001）。「保存して切り替える」は `liveRef.current.pendingMode` を往復の後に読み、`saved === true && next !== null` で `runExclusive` の `null`（占有を取れなかった）と `false`（失敗）を切り替えない側に倒している（W-001）。`-action.tsx:258` と `resolveConflict` の注記は `seedLatest` を指す（W-002）。TC-04 手順 5 の括弧書きは `confirm` の関数型 `setTitle` を理由にしている（W-003）。`write` / `writeDraft` は `boolean` を返し、`writeDraft` の呼び出しは `commit` の `catch` の 1 か所だけで戻り値が `stashed` になる。`writePreferredMode` だけが戻り値を捨てるのは JSDoc（「読みと既定のモードは握り潰す」）どおり（W-004）
- 「取りやめ」に `disabled` を付けない判断（ラウンド 013 で決着）: 往復中に押すと `pendingMode` は `null` になり、往復後の継続は `next === null` で切り替えない。往復中に `pendingMode` が別の値へ動く経路は無い（ラジオは `busy` で無効、`applyMode` / `reloadFromServer` は `runExclusive` の内側でしか `setPendingMode` を呼ばず、既定モードの復元 effect は 1 回きり）。押した後に自動保存が走っても `pendingMode` は関与しない。不整合は [W-002] の「取りやめを押さなかった側」にだけある
- `liveRef` へ寄せて古い値を読むべき箇所が生きた値を読んでいないか: `commit` の `needsReseed = liveRef.current.mode === "visual"`（`saveBody` の後）と `confirm` の `liveRef.current.mode === "visual"` は「送った時点のモード」を読むべき箇所だが、`setMode` を呼ぶ全経路（`applyMode` / `reloadFromServer` / `resolveConflict` / `restore` / `acknowledgeWysiwyg` / 退避の復元 / `enterMode` / 既定の復元 effect）は `runExclusive` の内側か `busy` で落ちるボタンからしか入れず、`saving` の占有中にモードは動かない。`takeSnapshot` を `await` の後に呼ぶ `reseedIfUnchanged` は意図して生きた値を読む（門は置き換えの直前で下す）。`attachVisualPaths` の `liveRef.current.baseline` は `onReady` の commit と同じ描画の値で、面が組まれた `baseline` と一致する
- `commit` の `boolean` 化: 戻り値を読むのは「保存して切り替える」だけで、`submitSave` / 自動保存 / `retryFailed` は捨てている（切り替えの後続を持たないので正しい）。初回作成の枝で `true` を返した後に `enterMode` → `applyMode` へ進むと `identityRef` はもう `existing` なので正本を引き直し、その後 `createdNote` の effect が編集 URL へ移る — 載せ直しは無駄になるが内容は失われない
- `readNoteEditStateFn` の応答（`version` / `title` / `html` / `canEdit`）と `readLatest` の利用、`RestoredNoteRevisionView`（`noteId` / `version` / `title` / `html`）と `restore` の利用、`createNoteWithBodyFn` の `title` を `confirm` が確定値に使う形は一致している。`updateNoteBodySchema.importReferences: z.boolean()` に `commit` が渡す `importing` は常に boolean
- 手順書との突き合わせ: TC-06 手順 2（了解して進むは `busy` で無効）、TC-08 手順 6（書式バー・メディア挿入は `!editable` のみ、「版を復元」は `isSideBusy || !editable`、各版の「復元」は `busy`）、TC-10 手順 6（破棄・保存・ラジオが `busy`）、TC-24 手順 4（`blocked` → `editable` 偽で本文・タイトル・メディア・ラジオ・保存・破棄・版が全部落ちる）、TC-34 手順 9（`liveRef.importReferences`）はいずれも現在のコードの活性条件と一致する。TC-07 だけは [W-002] の 1 行が足りない
- `spec/pages/index.md` P-12 の「保存失敗」「保存できません」「WYSIWYG 警告」「ビジュアル不可」の各行と P-11「操作実行中」「削除直後」、P-14 の状態列を実装と照合し、記述はすべて現在のコードで真。`spec/presentation/index.md` の差分は「ストレージの配信元」行の削除 1 件で、`storage.$.tsx` が `ObjectStorage.publicUrl` の形に閉じている実装と整合。`docs/frontend_implementation_example.md` の差分は実在するコンポーネント名への言い換え 1 文で正しい。`docs/test.md`「Convention scans」の実装の記述（`useState` bindings / reach by name）は正確だが、末尾の一般化は [W-001] のとおり
- 記述の衛生: 担当範囲のソース・spec・手順書に「以前は」「〜するようになった」「前ラウンド」は無い。ADR 参照 12 種（004 / 006 / 007 / 010 / 013 / 014 / 022 / 029 / 037 / 046 / 047 / 055）はすべて `spec/adr/` に実在し、`ADR-13x`（作業ログの番号）はコード・spec・docs のどこにも無い。`apps/web` の vitest 29 ファイル 248 件は green（実行して確認）
- `apps/web/package.json` の `typescript` は `liveReads.test.ts` の `import ts from "typescript"` のための devDependency で、ルートに hoist 済みの同じ版（6.0.3）を指す

#### テスト保証

- 往復をまたぐ関数が描画の値を読まない（`editor.tsx` 全体）— 守っているテスト: `NoteEditor/__tests__/liveReads.test.ts:reads no render-captured value from a function that crosses a roundtrip`（直読み・インライン閉包・オブジェクト経由は検出。参照渡しの局所関数・props・`useState` 以外のフック・局所関数経由の派生値は検出しない → [W-001]）
- `liveReads.test.ts` 自身の検出力 — 守られていない（陽性ケースが無い）→ [W-001]
- 「保存して切り替える」が往復中の打鍵を捨てない（`editor.tsx` の `pendingMode` Alert）— 守られていない → [W-002]
- 「保存して切り替える」の取りやめが往復中でも効く（`editor.tsx` の `pendingMode` Alert / `liveRef.pendingMode`）— 守っているテスト: 無し（`liveReads.test.ts` が state 直読みへの退行だけは捕まえる。手動 TC-07）
- `failed.stashed` が実際の退避と一致する（`editor.tsx:commit` の `catch` / `preferences.ts:writeDraft`）— 守っているテスト: `preferences.test.ts:writeDraft` 2 件（書けた / 投げた）、`saveStatus.test.ts:promises the local stash only once it has actually been written`
- 自動保存が利用者の取り込み選択で送る（`editor.tsx:commit` の `importing`）— 守っているテスト: `liveReads.test.ts`（`importReferences` を直読みすれば赤）。値の伝搬そのものは手動 TC-34 手順 9
- `classifySaveFailure` の 2 集合と優先順（`saveStatus.ts`）— 守っているテスト: `saveStatus.test.ts:classifySaveFailure` 全ケース
- `RetryTarget` 5 種の見出し・案内・ラベル（`saveStatus.ts:describeFailure` / `FAILED_LABEL`）— 守っているテスト: `saveStatus.test.ts:describeFailure` 全ケース（`satisfies` で網羅を型に見張らせている）
- `diffTextNodeEdits` の向き・欠け・空文字（`textNodes.ts`）— 守っているテスト: `textNodes.test.ts` 6 ケース
- `parseDraft` / `isExpired`（`preferences.ts`）— 守っているテスト: `preferences.test.ts` 全ケース
- `tokenizeHtml` の無損失性と `sameMarkupStructure`（`highlight.ts`）— 守っているテスト: `highlight.test.ts` 全ケース
- 編集 / ゴミ箱のエラー文言と HTTP 写像（`errorDisplay.ts` / `errorResponse.ts`）— 守っているテスト: `presentation/__tests__/errorDisplay.test.ts` の `EDITING_CODES`、`errorResponse.test.ts:keeps the editing and trash codes on their kind mapping`
- 転送境界の本文上限（`schema.ts`）— 守っているテスト: `note/__tests__/schema.test.ts:the note body transport bound` 3 件
- `/storage/$` の公開 purpose（`routes/storage.$.tsx`）— 守っているテスト: `routes/__tests__/storage.delivery.test.ts` 4 件
- ADR 番号の実在と `.thread/` の不引用（`__tests__/adrReference.test.ts`）— 守っているテスト: 同ファイル 3 件
- 破棄・版の復元で同じ文字列でも面が組み直される（`surfaces.tsx` の `seed`）— 守っているテスト: 無し（手動 TC-10 手順 8・9、TC-11 手順 6）
- 一覧・詳細・ゴミ箱の版と `router.invalidate()` の突き合わせ（`NoteList/board.tsx` / `NoteDetail/detail.tsx` / `TrashList/board.tsx`）— 守っているテスト: 無し（手動 TC-09 手順 4、TC-12、TC-13、TC-33）

#### カバレッジ

- 確認: `apps/web/app/__tests__/adrReference.test.ts`, `apps/web/app/components/layout/ScopeToken/index.tsx`, `apps/web/app/components/layout/ScopeToken/listing.ts`, `apps/web/app/components/note/NoteBody/index.tsx`, `apps/web/app/components/note/NoteDetail/detail.tsx`, `apps/web/app/components/note/NoteDetail/index.tsx`, `apps/web/app/components/note/NoteDetail/menu.tsx`, `apps/web/app/components/note/NoteEditor/__tests__/highlight.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/liveReads.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/preferences.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/saveStatus.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/textNodes.test.ts`, `apps/web/app/components/note/NoteEditor/editor.tsx`, `apps/web/app/components/note/NoteEditor/frame.tsx`, `apps/web/app/components/note/NoteEditor/highlight.ts`, `apps/web/app/components/note/NoteEditor/index.tsx`, `apps/web/app/components/note/NoteEditor/preferences.ts`, `apps/web/app/components/note/NoteEditor/saveStatus.ts`, `apps/web/app/components/note/NoteEditor/skeleton.tsx`, `apps/web/app/components/note/NoteEditor/surfaces.tsx`, `apps/web/app/components/note/NoteEditor/textNodes.ts`, `apps/web/app/components/note/NoteList/board.tsx`, `apps/web/app/components/note/NoteList/index.tsx`, `apps/web/app/components/note/TrashList/action.ts`, `apps/web/app/components/note/TrashList/board.tsx`, `apps/web/app/components/note/TrashList/index.tsx`, `apps/web/app/components/note/__tests__/schema.test.ts`, `apps/web/app/components/note/schema.ts`, `apps/web/app/presentation/__tests__/errorDisplay.test.ts`, `apps/web/app/presentation/__tests__/errorResponse.test.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/routes/__tests__/storage.delivery.test.ts`, `apps/web/app/routes/notes/$noteId_.edit.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/new.tsx`, `apps/web/app/routes/notes/trash.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/$noteId_.edit.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/new.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/trash.tsx`, `apps/web/app/routes/workspaces/$workspaceId/settings/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/settings/route.tsx`, `apps/web/package.json`, `docs/frontend_implementation_example.md`, `docs/test.md`, `spec/manual-tests/editing.md`, `spec/pages/index.md`, `spec/presentation/index.md`
- 差分外で参照（判断材料。担当外）: `packages/core/src/application/note/view.ts`（`RestoredNoteRevisionView`）、`.thread/7/adr.md`（ADR-136 / 137 の主張。canon ではなく照合の材料としてのみ）
- スキップ: `apps/web/app/routeTree.gen.ts` — 生成物（ルート 6 本は各ルートファイルで確認）
- スキップ: `packages/core/**`, `packages/core/package.json`, `pnpm-lock.yaml` — バックエンド担当（上記の参照を除く）
- スキップ: `spec/adr/013-html-sanitization-policy.md`, `spec/database/**`, `spec/domains/**`, `spec/inventory/**`, `spec/platform/index.md`, `spec/testcases/**`, `spec/usecases/**`, `docs/backend_implementation_example.md` — ドメイン / ユースケース / アダプター担当
