### frontend

#### Blockers

- **[B-001]** WYSIWYG の面は `baseline` の**文字列が変わったときしか**載せ直さないので、正本がいま面に載せた文字列と同じなら「破棄」「版の復元」「競合の破棄」が面をリセットしない。打鍵は contenteditable の DOM に残ったまま、`body` / `confirmed` は正本へ揃って `dirty` が下り「保存済み」になる。次の 1 打鍵で `onInput` が DOM 全体（＝破棄したはずの内容）を `body` に戻し、自動保存がそれをサーバーへ書く
  - 場所: `apps/web/app/components/note/NoteEditor/surfaces.tsx:142-152`（effect の依存が `[baseline, surfaceRef]` のみ）、`apps/web/app/components/note/NoteEditor/editor.tsx:1259-1270`（`loadSurface` は `baselineSeed` を進めるが WYSIWYG へは渡していない）、`editor.tsx:2068-2079`（`<WysiwygSurface baseline=… />` に `seed` も `key` も無い）
  - 理由: `loadSurface` → `setBaseline(nextBody)` は同じ文字列なら React が bail out するので effect が走らない。到達経路は少なくとも 3 つ — (1) 打鍵から 1.5 秒以内に「破棄」（自動保存前。`readEditState` の `html` は `target.html` と同一）、(2) 一度保存して打ち直し → 破棄 → さらに打ち直し → 2 回目の破棄（保存後は `baseline` が更新されず、破棄で `baseline` が正本に揃った後は同一）、(3) `failed` / `rejected` で自動保存が止まった状態からの破棄。同じ理由で、いま載せている版と同じ内容の版を「復元」しても面は変わらない。`VisualSurface` にだけ `seed` を足した JSDoc（`surfaces.tsx:584-589`「破棄はまさに同じ文字列へ戻す操作」）がこの問題を正確に言い当てているのに、WYSIWYG が同じ扱いになっていない。`spec/manual-tests/editing.md` TC-10 手順 2・3・7 と TC-11 手順 5 は WYSIWYG（素朴ノートの既定モード）ではこの経路で FAIL する
  - 提案: `WysiwygSurface` に `seed`（＝ `baselineSeed`）を渡し、effect の依存へ加える。`seed` が進んだ描画では `surface.innerHTML !== template.innerHTML` の短絡を通さず必ず `replaceChildren` する（HTML モードは controlled `textarea` なので影響なし）。手順書は TC-10 に「打鍵直後（自動保存前）に破棄」と「同じ内容へ戻る 2 回目の破棄」を足す

- **[B-002]** 前ラウンドで `retryFailed` の `mode` / `revision` に置いた `dirty` の門が、**破棄の再試行を保存に反転させる**。`discard` は `applyMode(mode)` を経由するので落ちたときの `RetryTarget` は `{ kind: "mode" }` になり、破棄は `dirty` が真でしか押せない（`disabled={!dirty || …}`）ので、失敗後の「再試行」は**必ず** `commit(true)` へ落ちる — 利用者が捨てると決めた内容が版と `Revision` 付きで保存され、そのあと面が「保存済みの内容」＝いま保存したものへ載せ直る。JSDoc の 8 行の表（`mode × 真`「打鍵が保存されてからモードが変わる」）はモード切替には正しいが、同じ `RetryTarget` を通る破棄には当てはまらない。もう 1 つの門（`revision × 真`）は、一次経路と食い違う: 版一覧の「復元」ボタンは `dirty` を見ずに未保存の内容を捨てる（TC-11 手順 5 が期待結果として固定）のに、その復元が落ちた後の「再試行」だけは先に保存する。同じ操作が初回と再試行で逆の方針になる
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:1281-1285`（`discard` → `applyMode(mode)`）、`editor.tsx:1597-1606`（`reseedAfterSaving`）、`editor.tsx:1641-1656`（`retryFailed`）、`editor.tsx:1619-1631`（表）、`apps/web/app/components/note/NoteEditor/saveStatus.ts:30-34`（`RetryTarget` に破棄が無い）、`spec/pages/index.md:319`（「モード切替と破棄・版の復元」に門を置くと書いてある）
  - 理由: ラウンド 010 までは `mode` の再試行が `applyMode` を再実行していたので破棄の意図は保たれていた。この門は「打鍵を黙って捨てない」を守るために足されたが、破棄は利用者が捨てることを選んだ操作であり、ED-08 手順 3「『破棄』を選ぶと、最後に保存した状態に戻る」の反対（保存する）を黙って行う回帰である。表示も噛み合わない — 破棄が落ちたときの Alert は「保存できませんでした … 内容はまだこの端末に退避していません。もう一度お試しください」で、`SaveIndicator` は「保存に失敗しました」を出す
  - 提案: `RetryTarget` に `{ kind: "discard" }` を足し、`discard` は `applyMode` を経由せず自分の `catch` でそれを渡す。`retryFailed` の `discard` は `discard()` を再実行する（門は置かない — 一次経路にも確認は無い）。`revision` の再試行は一次経路に揃えて `restore(target.revisionId)` を門なしで再実行する（保存してから復元させたいなら一次経路の「復元」ボタンにも同じ門を置き、TC-11 手順 5 を書き換える。どちらかに揃える）。`mode` の門はモード切替（一次経路が「保存して切り替える」を持つ）だけに残す。JSDoc の表と `spec/pages/index.md:319` を同じ形に直し、Alert の文言は `RetryTarget` の種類で分ける

#### Warnings

- **[W-001]** `restore` は `restoreRevision` と直後の `reseedFromServer` を**同じ `try`** に入れているので、復元がサーバーで通ったあとに `readEditState` だけが落ちると `failed { kind: "revision" }` になり、「再試行」が**復元をもう一度**走らせる（`rememberIdentity` は済んでいるので競合にはならず、同じ版を `restore` 理由でもう 1 版積む）。`dirty` なら先に `commit(true)` が走り、面に載ったままの**復元前の本文**を丸ごと保存してから再復元する（復元前本文の版がもう 1 つ増える）。`commit` 側は「保存が確定したあとの載せ直しの失敗は `failed` にしない」と決めた（`saveStatus.ts:26-28`、`spec/pages/index.md:319`）のに、復元だけがその規則の外にいる
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:1356-1387`
  - 理由: 「再試行が版と `Revision` を 1 つ無駄にする」は、`commit` の載せ直しで避けた失敗形そのもの
  - 提案: `catch` を `restoreRevision` の呼び出しだけに掛け、載せ直しの失敗は `commit` と同じ扱い（状態は `saved` のまま、`dropPathwise` 相当の降格）にする。少なくとも再試行の対象を「載せ直しだけ」に分ける

- **[W-002]** ビジュアルモードの自動保存は打鍵で**デバウンスされない**。`onChange` が動かすのは `visualCurrent`（ref）と `visualDirty`（真のまま）だけで、effect の依存 `[…, title, body, visualDirty]` は 2 打鍵目以降で変わらないため、タイマーは**最初の打鍵から 1.5 秒後**に発火し、打ち続けている最中でも保存が走る。以後は `busy` が下りるたびに 1.5 秒で再発火するので、連続入力中は「1.5 秒 + RTT」ごとに経路単位の保存と `Revision` が積まれる（直近 20 版が数十秒で入れ替わる）。HTML / WYSIWYG は `body` が打鍵ごとに変わるので意図どおり静止後に 1 回になる。`editor.tsx:968`「落ち着いてから 1 回だけ走らせる」はビジュアルでは偽
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:987-1002`、`editor.tsx:2101-2110`
  - 提案: `onChange` で打鍵世代（`visualEditSeq`）を 1 つ進めて依存に加える（`body` と同じ役目）。ラウンド 010 の「載せ直しを見送る」経路（`sameSnapshot` 不一致 → `dropPathwise`）が、往復中の打鍵が常態化することで不必要に頻発する点でも効く

- **[W-003]** 版の単調性の門は「島＝ノート 1 件」を前提にしているが、`NoteDetailIsland` / `NoteEditorIsland` は `noteId` で `key` されていない。TanStack Router はパラメーターだけの遷移でルートコンポーネントを再マウントしない（`remountDeps` 未設定）ので、`/notes/a` → `/notes/b` を画面内遷移で辿ると島の `versionRef` / `savedTitle` / `title` が a のまま残り、b の版が a より小さければ門が閉じて**永久に a の版・タイトルで b を描き**、タイトルの自動保存が必ず競合する。現在は詳細どうし・編集どうしを直接結ぶリンクが無いので顕在化しないが、#8（検索・コマンドパレット）が入ると即座に踏む
  - 場所: `apps/web/app/components/note/NoteDetail/index.tsx:73-87`、`apps/web/app/components/note/NoteEditor/index.tsx:220-243`、`apps/web/app/components/note/NoteDetail/detail.tsx:181-187`
  - 提案: `<NoteDetailIsland key={note.noteId} …>` / `<NoteEditorIsland key={note.noteId} …>`。1 行で前提が型ではなく構造で守られる

- **[W-004]** ビジュアルモードの「丸ごと送る枝」（`pathwise === false`）は `updateNoteBody` に `importReferences` を渡すが、ビジュアルでは `ImportChoice` が出ない（`mode === "visual" ? null`）ので値は既定の `true`（または前に別モードで選んだ値）になる。`updateNoteBody` はこの真で `requestReferenceImportIfNeeded` を呼ぶため、ED-02「テキストノードだけを書き換える」操作が #6 の着地後には外部参照の取り込みジョブ（`src` の差し替え・スタイルシートの埋め込み）を起こしうる。ED-03 が「取り込み可否を選べる」と定めたのは HTML モードであり、ビジュアルは選ばせていない
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:706-716`、`editor.tsx:2159-2170`；`packages/core/src/application/note/updateNoteBody.ts:118-126`（参照）
  - 提案: ビジュアルの丸ごと保存は `importReferences: false` を固定で送る（テキスト以外を動かさない枝であることを転送境界の値で表す）

- **[W-005]** `errorDisplay.ts:97` の `[ADR 013](spec/adr/013)` はファイルへ解決しない（実体は `spec/adr/013-html-sanitization-policy.md`）。`adrReference.test.ts` の `PATH_REFERENCE` は `spec/adr/(\d+)-` を要求するので拾わない。他 5 か所（`NoteBody` / `menu.tsx` / `NoteEditor/index.tsx` / `surfaces.tsx` / `textNodes.ts`）は正しい形
  - 場所: `apps/web/app/presentation/errorDisplay.ts:97`
  - 提案: フルパスに直す。ついでに `PATH_REFERENCE` を `spec\/adr\/(\d{1,4})\b` にして末尾のハイフンを要求しない（番号だけの参照も「実在の番号か」は検査できる）

#### 検証メモ（指摘にしなかったもの）

- `RetryTarget` 4 種 × `dirty` の 8 通り: `save × 偽` は到達しない（`failed { kind: "save" }` を作る `catch` は `dirty` を残す）が無害。`save × 真`・`conflict × 両`・`mode × 偽`（モード切替）は表どおり。`mode × 真` は**破棄で反転**（B-002）、`revision × 両` は一次経路と非対称（B-002）かつ復元成功後の載せ直し失敗を含む（W-001）
- 版の単調性の門（`detail.tsx:181-187`）: 成功直後（旧断片を弾く）・失敗直後（`versionRef` は送った版のまま → 正本 ≥ で通る）・断片到着（追いついた時点で通る）の 3 契機を辿り、島 1 件の前提の下では閉じるべきでない場合に閉じない。前提そのものが `key` で守られていない点だけ W-003
- `dropPathwise` の skip 経路: 降ろした後の丸ごと保存は「往復中に打鍵があった往復」ごとにしか起きず、面が静止した往復で載せ直しが通れば `onReady` が印を立て直す。無限に丸ごと保存を繰り返す経路は無い。ただし W-002 により、ビジュアルでは往復中の打鍵が常態になるので発生頻度は高い
- 載せ直しの失敗を握り潰した後の不整合: 面はサニタイズ前の内容、サーバーはサニタイズ後、表示は「保存済み」で `removed` の通知だけが出る。次の打鍵で丸ごと保存 → 静止すれば載せ直しで揃う。離脱時の確認は出ない（`dirty` 偽）が失われるものは無い。利用者が気づけない**恒久的な**不整合は残らない
- SMIL: `scrubForSurface` の `animate` / `set` / `animateTransform` / `animateMotion` は保存側（`ALLOWED_SVG_ELEMENTS` に無い → 除去）の部分集合。`localName.toLowerCase()` で `animateTransform` に当たることを確認。同種の「属性を後から書き換える」要素は他に無い（`animateColor` はブラウザーが未対応、`discard` は要素の除去のみ、`mpath` は `animateMotion` の子）。`<svg><style>` は面では `dropStyleElements`（WYSIWYG）/ shadow root（他 2 面）で閉じ、ビジュアルの経路づけは `isPathOpaque` が SVG を除外するがサーバーの `resolveTextNode` も同じ規則で、かつ `applyTextNodeEdits` は結果を `process` に通し直すので `svg > style` は保存で消える — 迂回にならない。`xlink:href` は HTML パーサーが `attribute.name` を `xlink:href` のまま保つので表に当たる
- `NoteBody` の `[contain:layout_paint]` 包み・`replaceChildren(styleElement, template.content)`、`storage.$` の `PUBLICLY_SERVED_PURPOSES`、`ScopeToken.canWrite` の省略＝非表示規則と 3 loader の供給、`TrashBoard` / `NoteListBoard` の所有権（一覧メンバーシップの変更は親が `useOptimistic` と server function を持つ）と `reconcile()` の成功・失敗両呼びは規則どおり
- `spec/presentation/index.md` から「ストレージの配信元」の行を落としたのは `StorageUrlPolicy.create` が `deliveryBaseUrl` を `ObjectStorage.publicUrl` から取る形と整合

#### テスト保証

- `classifySaveFailure` の 2 集合（`saveStatus.ts:classifySaveFailure` / `BLOCKING_ERROR_CODES` / `TRANSIENT_ERROR_KINDS`）— 守っているテスト: `NoteEditor/__tests__/saveStatus.test.ts` 全ケース（両側から固定、`unauthorized` + blocking code の優先順も含む）
- `RetryTarget` を `failed` に運ぶ（`saveStatus.ts:classifySaveFailure`）— 守っているテスト: `saveStatus.test.ts:carries the failed roundtrip so the retry button re-sends that one`
- `retryFailed` の 8 通り（`editor.tsx:retryFailed` / `reseedAfterSaving`）— 守られていない（島の中で純関数化されていない。手順書にも失敗後の再試行の行は無い）→ [B-002]
- 破棄・版の復元で WYSIWYG の面が正本へ戻る（`surfaces.tsx:WysiwygSurface` effect）— 守られていない（TC-10 / TC-11 は同一文字列へ戻る経路を踏まない）→ [B-001]
- 復元成功後の載せ直し失敗（`editor.tsx:restore`）— 守られていない → [W-001]
- ビジュアルの自動保存の静止判定（`editor.tsx` 自動保存 effect）— 守られていない → [W-002]
- 版の単調性の門（`detail.tsx` props 同期 effect）— 守っているテスト: 無し（手動 TC-09 手順 4 のみ）。島 1 件の前提は [W-003]
- `diffTextNodeEdits` の向き・欠け・空文字（`textNodes.ts:diffTextNodeEdits`）— 守っているテスト: `textNodes.test.ts` 6 ケース
- `collectEditableTextNodes` / `hasEditableTextNode` の経路規約（`textNodes.ts`）— 守っているテスト: 無し（DOM 依存。サーバー側 `resolveTextNode` との一致は手動 TC-04 のみ）。指摘にはしない（`docs/test.md`「Frontend: the bare minimum」の範囲内）
- `scrubForSurface` の SMIL 除去（`surfaces.tsx:UNSAFE_DROP_ELEMENTS`）— 守っているテスト: 無し（手動 TC-17 手順 11 のみ）
- `parseDraft` / `isExpired`（`preferences.ts`）— 守っているテスト: `preferences.test.ts` 全ケース（境界値・未来時刻を含む）
- `tokenizeHtml` の無損失性と `sameMarkupStructure` の直列化差の無視（`highlight.ts`）— 守っているテスト: `highlight.test.ts` 全ケース（ADR-132 の 6 種の直列化差と 5 種の補正）
- 編集 / ゴミ箱のエラー文言と HTTP 写像（`errorDisplay.ts` / `errorResponse.ts`）— 守っているテスト: `presentation/__tests__/errorDisplay.test.ts:says what each editing / trash code…` ほか 3 件、`errorResponse.test.ts:keeps the editing and trash codes on their kind mapping`
- 転送境界の本文上限が `NOTE_CONTENT_TOO_LARGE` に届く（`schema.ts:updateNoteBodySchema` / `createNoteWithBodySchema`）— 守っているテスト: `note/__tests__/schema.test.ts:the note body transport bound` 3 件
- `/storage/$` の公開 purpose（`routes/storage.$.tsx:PUBLICLY_SERVED_PURPOSES`）— 守っているテスト: `routes/__tests__/storage.delivery.test.ts` 4 件（`FILE_PURPOSES` の補集合を走査）
- ADR 番号の実在と `.thread/` の不引用（規約）— 守っているテスト: `app/__tests__/adrReference.test.ts`（ただしパス形の参照はハイフン付きしか拾わない → [W-005]）

#### カバレッジ

- 確認: `apps/web/app/__tests__/adrReference.test.ts`, `apps/web/app/components/layout/ScopeToken/index.tsx`, `apps/web/app/components/layout/ScopeToken/listing.ts`, `apps/web/app/components/note/NoteBody/index.tsx`, `apps/web/app/components/note/NoteDetail/detail.tsx`, `apps/web/app/components/note/NoteDetail/index.tsx`, `apps/web/app/components/note/NoteDetail/menu.tsx`, `apps/web/app/components/note/NoteEditor/__tests__/highlight.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/preferences.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/saveStatus.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/textNodes.test.ts`, `apps/web/app/components/note/NoteEditor/editor.tsx`, `apps/web/app/components/note/NoteEditor/frame.tsx`, `apps/web/app/components/note/NoteEditor/highlight.ts`（テスト経由・`sameMarkupStructure` の使用箇所）, `apps/web/app/components/note/NoteEditor/index.tsx`, `apps/web/app/components/note/NoteEditor/preferences.ts`, `apps/web/app/components/note/NoteEditor/saveStatus.ts`, `apps/web/app/components/note/NoteEditor/skeleton.tsx`, `apps/web/app/components/note/NoteEditor/surfaces.tsx`, `apps/web/app/components/note/NoteEditor/textNodes.ts`, `apps/web/app/components/note/NoteList/board.tsx`, `apps/web/app/components/note/NoteList/index.tsx`, `apps/web/app/components/note/TrashList/action.ts`, `apps/web/app/components/note/TrashList/board.tsx`, `apps/web/app/components/note/TrashList/index.tsx`, `apps/web/app/components/note/__tests__/schema.test.ts`, `apps/web/app/components/note/schema.ts`, `apps/web/app/presentation/__tests__/errorDisplay.test.ts`, `apps/web/app/presentation/__tests__/errorResponse.test.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/routes/__tests__/storage.delivery.test.ts`, `apps/web/app/routes/notes/$noteId_.edit.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/new.tsx`, `apps/web/app/routes/notes/trash.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/$noteId_.edit.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/new.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/trash.tsx`, `apps/web/app/routes/workspaces/$workspaceId/settings/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/settings/route.tsx`, `docs/test.md`, `spec/manual-tests/editing.md`, `spec/pages/index.md`, `spec/presentation/index.md`
- 差分外で参照（判断材料。担当外）: `packages/core/src/domain/note/services/urlPolicy.ts`, `packages/core/src/adapters/html/allowList.ts`, `packages/core/src/adapters/html/htmlProcessor.ts`（`resolveTextNode` / `editTextNodes`）, `packages/core/src/application/note/applyTextNodeEdits.ts`, `packages/core/src/application/note/updateNoteBody.ts`, `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- スキップ: `apps/web/app/routeTree.gen.ts` — 生成物（ルート 6 本の追加は各ルートファイルで確認）
- スキップ: `packages/core/**` — バックエンド担当（上記の参照 6 本を除く）
- スキップ: `spec/adr/013-html-sanitization-policy.md`, `spec/database/**`, `spec/domains/**`, `spec/inventory/**`, `spec/platform/index.md`, `spec/testcases/**`, `spec/usecases/**` — ドメイン / ユースケース / アダプター担当
- スキップ: `docs/backend_implementation_example.md`, `packages/core/package.json`, `pnpm-lock.yaml` — バックエンド担当
