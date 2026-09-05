### frontend

#### Blockers

- **[B-001]** 自動保存のタイマーが呼ぶ `commit` は、`importReferences`（外部参照を取り込むか）を**効果を登録した描画の閉包**から読む。1.5 秒のデバウンスのあいだに利用者が「取り込まない」へ切り替えても、発火する `commit` は切り替え前の描画が捕まえた `true` で `updateNoteBody` / `createNoteWithBody` を送る。前ラウンドが `liveRef` に寄せた 4 値（`title` / `mode` / `body` / `baseline`）に `importReferences` が入っておらず、自動保存 effect の依存にも無い（依存は `dirty, editable, busy, status.kind, title, body, visualDirty, visualEditSeq`）ので、ラジオの切り替えはタイマーを張り直しもしない。「往復をまたぐ関数はここからしか読まない」「`commit` が読む値を並べてある」（biome-ignore の説明）は、この 1 値について成り立っていない
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:660-661`（`importing` が state の `importReferences` を読む）、`editor.tsx:1049-1074`（自動保存 effect の依存に `importReferences` が無い）、`editor.tsx:340-348`（`liveRef` の 4 値）、`editor.tsx:2340-2344`（`ImportChoice` は `editable` のあいだ常に有効）
  - 理由: 到達は素直である — HTML / WYSIWYG モードで外部参照を含む本文を貼る（`body` が動いてタイマーが張られる）→ 1.5 秒以内に「取り込まない」を選ぶ → 発火した保存が `importReferences: true` で走り、取り込みジョブが登録される。TC-34 手順 4「同じ本文を貼り付け、取り込まないことを選んで保存する」の操作順そのもので、貼ってから選ぶまでが 1.5 秒を切れば再現する。逆向き（先に「取り込まない」にしてから打鍵し、1.5 秒以内に「取り込む」へ戻す）は保存し直せば回復するが、`true` で走った取り込みは `src` の差し替えとスタイルシートの埋め込みを本文に起こし、AC-3「外部参照の取り込み可否を選べ」を利用者の操作と逆の結果にする。前ラウンドが消した「欠陥のクラス」（描画が捕まえた値を往復が読む）と同じ原因で、閉じ忘れた材料が 1 つ残っている形である
  - 提案: `liveRef` に `importReferences` を足し、`commit` の `importing` はそこから読む（`liveRef` の JSDoc「材料が増えたときに書き換える箇所を 1 か所に閉じる」のとおり）。効果の依存に足す案でも塞がるが、それは「閉包の問題を依存の列挙で追う」形で、ラウンド 012 の提案が退けた向きである。手順書 TC-34 に「本文を貼ってから 1.5 秒以内に『取り込まない』を選ぶ」を 1 行足し、`/jobs` に取り込みジョブが登録されないことを期待結果にする

#### Warnings

- **[W-001]** 「未保存の変更があります → 保存して切り替える」の継続は `await` の後に state の `pendingMode` を直読みする（`enterMode(pendingMode)`）。同じ Alert の「取りやめ」は `busy` で無効化されていないので、保存の往復中に取りやめを押すと `pendingMode` は `null` になって Alert は消えるが、往復が終わった継続は捕まえていた値でモードを切り替える。修正側の「`await` の後に state 識別子を直読みする箇所がゼロ」はこの 1 か所で成り立たない（`grep` で `await` 22 か所を追った結果、他は ref か引数か応答しか読んでいない）
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:2151-2156`（`if (saved === true) enterMode(pendingMode)`）、`editor.tsx:2161-2167`（「取りやめ」に `disabled` が無い）
  - 理由: 影響は「取りやめたはずの切り替えが起きる」に留まる（保存は通っているので内容は失われない）が、`runExclusive` で直列にした 2 往復のあいだに利用者の取り消しが挟まる窓であり、他の Alert（競合・WYSIWYG 警告・退避の復元）が主ボタンを `busy` で落としているのと不揃いである
  - 提案: 「取りやめ」にも `disabled={busy}` を置く（主ボタンと同じ扱い）か、継続の前に `const next = pendingMode` を取って `await` の後は `next` を使い、`pendingMode` が動いていたら切り替えない（`pendingModeRef` を 1 つ置く）。前者が最小

- **[W-002]** `readLatest` / `seedLatest` への分割で、権限喪失を `blocked` に落とす位置は `seedLatest` へ移ったが、それを指す 2 か所の記述が `reseedFromServer` のままである
  - 場所: `apps/web/app/routes/notes/-action.tsx:258`（「島は偽なら面を凍らせる（`reseedFromServer`）」）、`apps/web/app/components/note/NoteEditor/editor.tsx:1462-1464`（`resolveConflict` の「（`reseedFromServer` と同じ理由）」— 理由は `seedLatest` の JSDoc にある）
  - 理由: `reseedFromServer` は「読んで載せる」の 3 行の入口になり、凍らせる判断も理由もそこには無い。読み手が指された関数を開いても該当の行が無い
  - 提案: どちらも `seedLatest` に直す

- **[W-003]** 手順書 TC-04 手順 5 の括弧書き「往復のあとに正本を載せ直すかどうかの判定は本文とタイトルの両方を見るため、どちらかに打鍵があれば載せ直さず」は、その手順では走らない仕組みを理由に挙げている。手順 4〜5 は経路単位の保存で `skipped` が 0 件なので `needsReseed` は偽のままで、載せ直しの門（`reseedIfUnchanged`）は評価されない。打ったタイトルが消えないのは `confirm` の関数型 `setTitle` が打たれた入力欄を書き戻さないためである。門が効く経路は手順 7（退避の復元後の丸ごと保存）で、そちらの括弧書きは正しい
  - 場所: `spec/manual-tests/editing.md:89`
  - 理由: 期待結果そのものは現在の実装で PASS するが、理由の文が実装と食い違う。ラウンド 012 が「TC-04 手順 5 は `needsReseed` 偽の往復しか踏まない」と指摘したのに対し、手順 7 を足した側だけが直り、手順 5 の理由が残った（既存の記述で、本ラウンドの変更起因ではない）
  - 提案: 手順 5 の括弧書きを「確定は送った値にしか掛からず、往復のあいだに打たれた入力欄は書き戻さないため」に差し替える

- **[W-004]** `failed` の `stashed` は「実際に端末へ退避できたか」（`saveStatus.ts` の JSDoc）と定義されているが、`commit` の `catch` は `writeDraft` の成否を見ずに `stashed: true` を立てる。`preferences.ts` の `write` は `localStorage` が投げる端末（プライベートウィンドウ・サイトデータの遮断）で黙って握り潰すので、その端末では退避していないのに「内容はこの端末に退避したので、次に開いたときに復元できます」と告げる — `SaveStatus` の JSDoc 自身が「退避していないのに『退避した』と告げると、利用者はそれを信じて画面を離れる」と退けている形になる。あわせて `FAILED_HINT.save`（「内容はまだこの端末に退避していません」）は既存ノートでは到達しない
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:794-800`、`apps/web/app/components/note/NoteEditor/preferences.ts:48-54`（`write` が `void`）、`apps/web/app/components/note/NoteEditor/saveStatus.ts:51-57, 148`
  - 提案: `write` / `writeDraft` を `boolean` にして、`stashed` はその戻り値で決める。そうすると `FAILED_HINT.save` が実際に出る経路（退避できない端末）を持つ

#### 検証メモ（指摘にしなかったもの）

- `await` の後の読み取り: 22 か所の `await` を持つ閉包（`commit` / `reseedIfUnchanged` / `applyMode` / `readLatest` / `reseedFromServer` / `reloadFromServer` / `resolveConflict` / `openRevisions` / `restore` / `upload` / 自動保存 effect / `submitSave` / 保存して切り替える）を追い、後続で読んでいるのは `liveRef` / `confirmedRef` / `identityRef` / `activityRef` / `wysiwygRef` / `visualCurrent` / 引数 / 応答 / `target`（プロップ）のみ。例外は [W-001] の `pendingMode` 1 か所。[B-001] は `await` の後ではなく閉包の捕まえ方の問題で、同じ原因の別の面である
- 「古い値を読むべき箇所が生きた値を読んでいないか」: `commit` の `needsReseed = liveRef.current.mode === "visual"`（`saveBody` の後）と `confirm` の `if (liveRef.current.mode === "visual") setBody(...)` は「送った時点のモード」を読むべき箇所だが、`setMode` を呼ぶ 8 経路（既定の復元 effect・`applyMode`・`reloadFromServer`・`resolveConflict`・`restore`・`acknowledgeWysiwyg`・退避の復元・`enterMode`）はすべて `runExclusive` の内側か `busy` で落ちるボタンからしか入れず、保存の往復中にモードは動かない。同値だが、`sent.visual !== null` で書けば「送った写し」から決まる形になる（指摘にはしない）
- 門を fetch の後へ動かした効果: `reseedIfUnchanged` が偽を返す新しい経路は「fetch の RTT 中の打鍵」だけで、面が写しのままなら `takeSnapshot()`（`liveRef` + `visualCurrent`）は `sent` と一致する（`composeEditedHtml` は同じ `baseline` と同じ経路表から決定的に同じ文字列を作り、`pathwise` は `confirm` 後の `confirmedRef.visual.pathwise = sent.visual.pathwise`）。タイトルは `confirm` が打たれていない入力欄を正規化後の値へ書き戻すので、`sent.title` か `confirmed.title` に等しければ未操作、の 2 値判定で正しい。偽になったときは `dropPathwise` → 次の保存が丸ごと送る枝 → その保存の後にもう一度門、で収束する（連続入力中は丸ごと保存が続くが、打鍵が止まれば 1 回で `pathwise` が立ち直る）
- 版の更新: `rememberIdentity` は 7 か所（作成・rename・経路単位・丸ごと・`seedLatest`・`resolveConflict`・`restore`）。`readLatest` は覚えない。門で見送った正本の版を捨てるのは正しい — 保存の応答で自分の版はもう覚えており、他者の更新で進んだ版だけを捨てるので、次の保存は競合として出る
- 復元の 1 往復: `restoreNoteRevision` は `processed.html`（保存した形そのもの）と `next.title` を返し、島は `seedMode(surfaceModeFor(...), restored.title, restored.html)` で `confirmed` / 面 / 版を同期処理で揃える。落ちれば `catch` より前に何も動いていない。`<style>` を持つ版を WYSIWYG から復元すると HTML へ倒れて警告が立ち（TC-06 手順 7）、「了解して進む」は `dirty` 偽なので `applyMode(next, true)` で正本を引き直す — 引き直した本文は復元した本文と同じである
- `failed` 5 種と「`confirmed` はサーバーの姿」: `save` は `catch` が通った rename だけを確定させる（本文は落ちたので確定しない）。`mode` / `reload` は `readLatest` の失敗で何も動かない。`conflict` は `readEditState` の失敗で何も動かない。`revision` は 1 往復になったので何も動かない。応答だけが失われる形（サーバーは保存済み・画面は未確定）は `save` に残るが、次の再試行が競合として出るので黙って上書きはしない（TC-11 手順 7 の注記と同じ扱い）
- `FAILED_LABEL` は閉じた `Record<RetryTarget["kind"], string>` で、`saveStatus.test.ts` が 5 種の相異と「`save` 以外に『保存』を含まない」を固定している。`describeFailure` の `reload` の案内は破棄だけを指すので `UNCHANGED_HINT` で正しい
- `liveRef.current = {...}` を描画中に書く形は `leaveConfirmRef` と同じで、捨てられる描画が書いた値も committed の値より古くはならない（state の更新は失われない）。React 19 の `startTransition(async …)` は `await` 後の更新をトランジションにしないので、`confirm` の `setTitle` 等は緊急更新として同期に描画される
- `spec/pages/index.md` P-12 の 3 行（「保存失敗」「WYSIWYG 警告」「ビジュアル不可」）と P-11「操作実行中」「削除直後」、P-14 の状態列を実装と突き合わせた。「正本の引き直しは『破棄』と同じ」「上部バーの短い表示も同じ規則」「了解して進むとき、面に未保存の内容が載っていれば正本を引き直さず面だけを差し替える」はいずれも現在のコードで真。`spec/presentation/index.md` の差分は「ストレージの配信元」行の削除 1 件で、`StorageUrlPolicy` が `ObjectStorage.publicUrl` から取る形と整合
- 手順書: TC-04 手順 7、TC-06 手順 2 / 7 / 11 / 12、TC-08 手順 6 / 7、TC-10 手順 6〜10、TC-11 手順 5〜7、TC-21 手順 8、TC-23 手順 6 / 7、TC-24 手順 4、TC-32 手順 3 をコードの活性条件・遷移と突き合わせ、いずれも現在の実装で PASS する形になっている（TC-04 手順 5 の理由の文だけが [W-003]）
- 記述の衛生: 担当範囲のソース・spec・手順書に経緯を語る記述（「以前は」「〜するようになった」「前ラウンド」）は無い。`ADR 007` / `ADR 013` / `ADR 014` / `ADR 022` の参照は `spec/adr/` に実在し、`adrReference.test.ts` が `.thread/` の不引用とともに機械で見張っている（web プロジェクト 28 ファイル 244 件 green を実行して確認）
- スコープトークンの `canWrite`: ワークスペース文脈で `AppShell` に `scope` を渡す 3 ルート（`notes/index` / `notes/trash` / `settings/route`）はいずれも loader が `role` から `canWrite` を組んで渡している。省略しているルートは無い

#### テスト保証

- `classifySaveFailure` の 2 集合と優先順（`saveStatus.ts:classifySaveFailure` / `BLOCKING_ERROR_CODES` / `TRANSIENT_ERROR_KINDS`）— 守っているテスト: `NoteEditor/__tests__/saveStatus.test.ts` の `classifySaveFailure` 全ケース
- `RetryTarget` 5 種の見出し・案内・上部バーのラベルが往復ごとに分かれる（`saveStatus.ts:describeFailure` / `FAILED_TITLE` / `FAILED_LABEL`）— 守っているテスト: `saveStatus.test.ts:names each failed roundtrip apart…`、`labels the bar by the roundtrip that fell…`、`tells every roundtrip but the save that nothing moved`（`satisfies` で 5 種の網羅を型に見張らせている）
- 自動保存が利用者の取り込み選択で送る（`editor.tsx:commit` の `importing`）— 守られていない → [B-001]
- 保存して切り替えるの取りやめ（`editor.tsx` の `pendingMode` Alert）— 守られていない → [W-001]
- `failed.stashed` が実際の退避と一致する（`editor.tsx:commit` の `catch` / `preferences.ts:write`）— 守られていない → [W-004]
- `reseedIfUnchanged` の門が本文・タイトル・経路表の 3 つで効く（`editor.tsx:reseedIfUnchanged` / `takeSnapshot`）— 守っているテスト: 無し（手動 TC-04 手順 7）。今回のコード読みでは穴なし
- 復元が 1 往復で面・版・確定値を揃える（`editor.tsx:restore`、`restoreNoteRevision.ts`）— 守っているテスト: 無し（手動 TC-11 手順 3〜7、TC-06 手順 7）。応答の形は `packages/core/src/application/note/__tests__/restoreNoteRevision.test.ts` の担当
- `retryFailed` 5 分岐が一次経路の入口をそのまま呼ぶ（`editor.tsx:retryFailed`）— 守られていない（島の中。手動 TC-10 手順 10 / TC-11 手順 7）。今回のコード読みでは回帰なし
- 破棄・版の復元で同じ文字列でも面が組み直される（`surfaces.tsx` の `seed`）— 守っているテスト: 無し（手動 TC-10 手順 8・9、TC-11 手順 6）
- `diffTextNodeEdits` の向き・欠け・空文字（`textNodes.ts`）— 守っているテスト: `textNodes.test.ts` 6 ケース
- `parseDraft` / `isExpired`（`preferences.ts`）— 守っているテスト: `preferences.test.ts` 全ケース
- `tokenizeHtml` の無損失性と `sameMarkupStructure`（`highlight.ts`）— 守っているテスト: `highlight.test.ts` 全ケース
- 編集 / ゴミ箱のエラー文言と HTTP 写像（`errorDisplay.ts` / `errorResponse.ts`）— 守っているテスト: `presentation/__tests__/errorDisplay.test.ts` の `EDITING_CODES`（タイトル上限は `NoteTitle` から探索して辞書の数字を照合）、`errorResponse.test.ts:keeps the editing and trash codes on their kind mapping`
- 転送境界の本文上限（`schema.ts`）— 守っているテスト: `note/__tests__/schema.test.ts:the note body transport bound` 3 件
- `/storage/$` の公開 purpose（`routes/storage.$.tsx:PUBLICLY_SERVED_PURPOSES`）— 守っているテスト: `routes/__tests__/storage.delivery.test.ts` 4 件（補集合は `FILE_PURPOSES` から走査）
- ADR 番号の実在と `.thread/` の不引用（`__tests__/adrReference.test.ts`）— 守っているテスト: 同ファイル 3 件
- 一覧・詳細・ゴミ箱の版と `router.invalidate()` の突き合わせ（`NoteList/board.tsx` / `NoteDetail/detail.tsx` / `TrashList/board.tsx`）— 守っているテスト: 無し（手動 TC-09 手順 4、TC-12、TC-13、TC-33）

#### カバレッジ

- 確認: `apps/web/app/__tests__/adrReference.test.ts`, `apps/web/app/components/layout/ScopeToken/index.tsx`, `apps/web/app/components/layout/ScopeToken/listing.ts`, `apps/web/app/components/note/NoteBody/index.tsx`, `apps/web/app/components/note/NoteDetail/detail.tsx`, `apps/web/app/components/note/NoteDetail/index.tsx`, `apps/web/app/components/note/NoteDetail/menu.tsx`, `apps/web/app/components/note/NoteEditor/__tests__/highlight.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/preferences.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/saveStatus.test.ts`, `apps/web/app/components/note/NoteEditor/__tests__/textNodes.test.ts`, `apps/web/app/components/note/NoteEditor/editor.tsx`, `apps/web/app/components/note/NoteEditor/frame.tsx`, `apps/web/app/components/note/NoteEditor/highlight.ts`, `apps/web/app/components/note/NoteEditor/index.tsx`, `apps/web/app/components/note/NoteEditor/preferences.ts`, `apps/web/app/components/note/NoteEditor/saveStatus.ts`, `apps/web/app/components/note/NoteEditor/skeleton.tsx`, `apps/web/app/components/note/NoteEditor/surfaces.tsx`, `apps/web/app/components/note/NoteEditor/textNodes.ts`, `apps/web/app/components/note/NoteList/board.tsx`, `apps/web/app/components/note/NoteList/index.tsx`, `apps/web/app/components/note/TrashList/action.ts`, `apps/web/app/components/note/TrashList/board.tsx`, `apps/web/app/components/note/TrashList/index.tsx`, `apps/web/app/components/note/__tests__/schema.test.ts`, `apps/web/app/components/note/schema.ts`, `apps/web/app/presentation/__tests__/errorDisplay.test.ts`, `apps/web/app/presentation/__tests__/errorResponse.test.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/routes/__tests__/storage.delivery.test.ts`, `apps/web/app/routes/notes/$noteId_.edit.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/new.tsx`, `apps/web/app/routes/notes/trash.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/$noteId_.edit.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/new.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/trash.tsx`, `apps/web/app/routes/workspaces/$workspaceId/settings/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/settings/route.tsx`, `docs/frontend_implementation_example.md`, `docs/test.md`, `spec/manual-tests/editing.md`, `spec/pages/index.md`, `spec/presentation/index.md`
- 差分外で参照（判断材料。担当外）: `packages/core/src/application/note/restoreNoteRevision.ts`、`packages/core/src/application/note/view.ts`（`RestoredNoteRevisionView`）、`spec/usecases/note.md`（`restoreNoteRevision` の出力 DTO）、`spec/scenario/editing.md`（ED-03 の取り込み選択）
- スキップ: `apps/web/app/routeTree.gen.ts` — 生成物（ルート 6 本は各ルートファイルで確認）
- スキップ: `packages/core/**`, `packages/core/package.json`, `pnpm-lock.yaml` — バックエンド担当（上記の参照を除く）
- スキップ: `spec/adr/013-html-sanitization-policy.md`, `spec/database/**`, `spec/domains/**`, `spec/inventory/**`, `spec/platform/index.md`, `spec/testcases/**`, `spec/usecases/**`（上記の参照を除く）, `docs/backend_implementation_example.md` — ドメイン / ユースケース / アダプター担当
