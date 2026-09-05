### frontend

対象: `apps/web/app/` の全変更（175 行の一覧のうち 37 ファイル）と、`spec/pages/index.md` / `spec/manual-tests/editing.md` / `spec/scenario/editing.md` / `spec/design/pages/P12-editor.html` との整合。
`pnpm --filter @repo/web typecheck` はクリーン（実行済み）。

前ラウンドの `.thread/7/review/triage-keys.md` にある `[W-006] components/note/NoteEditor/editor.tsx`（`/notes/new` の取り込み先セレクター、defer）は再掲しない。

前ラウンドの指摘は次のとおり解消を確認した（再掲しない）: 破棄の再シード（`baselineSeed` の導入と `discard` → `applyMode` の正本引き直し、TC-10 手順 4・5 に対応）、`locked` / `blocked` での面の凍結（`contentEditable={editable}` / `readOnly={!editable}` / span の `contenteditable="false"`）、既定モード復元が `needsWysiwygWarning` を通ること、`visualAvailable` の 500 ms デバウンスと `hasEditableTextNode` の早期打ち切り、プレビュー文言と `[contain:layout_paint]`、`draftOffer` の従属化、タイトル正規化値の持ち回り（`appliedTitle`）、複数ドロップの挿入位置（`insertAtRef`）、スケルトンの上部バー、`removed` / `skipped` の畳み直し、設定シェルの `canWrite`。

#### Blockers

- **[B-001]** ビジュアルモードで、面の外から入った本文が**一度もサーバーへ送られないまま「保存済み」**になる
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx` の `commit`（`mode === "visual"` 分岐と直後の `settleSaved(appliedTitle, currentBody)`）、`draftOffer` の「復元する」ハンドラー、`resolveConflict(true)`
  - 理由: ビジュアルモードの保存は経路単位の書き換えなので、`commit` は `diffTextNodeEdits(visualOriginal, visualCurrent)` だけを送り、**`body` と `savedBody` の差はいっさい見ない**。それなのに分岐の直後で `settleSaved(appliedTitle, currentBody)` を無条件に呼ぶので、`body` が経路表と無関係に動いていても `savedBody = body` に進み、`status` が `saved` になる。`body` を面の外から動かす経路は 2 つある。
    1. **退避の復元**（`setTitle` / `setBody` / `setBaseline(draftOffer.html)`）。ビジュアルモードで押すと `VisualSurface` は退避 HTML で組み直され、`onReady` が `visualOriginal` と `visualCurrent` を**同じ値**で埋めるので差分は 0 件。次の自動保存は 1 件も送らずに `settleSaved` へ抜け、退避の内容は消えて「保存済み」が出る。`skipped` の警告も出ない（`edits.length === 0` の枝は `setSkipped([])`）ので**完全に無言**である。到達経路: 既定モードは端末ごと・ノート横断（ED-05）なので、「ノート X の HTML モードで保存に失敗して退避が書かれる」→「別のノートでビジュアルへ切り替える（`writePreferredMode("visual")`）」→「ノート X を開き直すと既定復元でビジュアルに入り、退避の提案が出る」で成立する。
    2. **競合の「自分の内容で上書きする」**（`resolveConflict(true)`）。`rememberSaved(latest.title, latest.html)` の一方で `visualOriginal` / `visualCurrent` は競合**前**の木のままなので、送られる `expected` は現在の本文と一致せず全件 `contentChanged` に落ちる。落ちてなお `settleSaved` が「保存済み」を出す。
    ED-08 の「保存済み / 未保存」の表示が実態と食い違い、1 は利用者が明示的に選んだ復元の内容を失う。
  - 提案: `commit` のビジュアル分岐を「経路表で説明できない `body` の差があるか」で分ける。`currentBody !== savedBody` なら経路編集では表せないので、`updateNoteBody` へ落とす（そのうえで `applyMode` 相当の再シードを掛ける）か、`復元する` / `resolveConflict(true)` の側でビジュアルモードから抜ける（`seedMode("html" | "wysiwyg", …)`）。少なくとも「何も送っていない保存」を `saved` にしないこと。

- **[B-002]** 自動保存の停止条件が `isSaving` しか見ておらず、**破棄・明示保存・版の復元と同時に走る**。破棄の往復中に走ると、破棄したはずの内容がそのまま保存される
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx` の自動保存 `useEffect`（`if (!dirty || !editable || isSaving || uploading) return;` と依存配列）、`discard` / `applyMode` / `restore` / `resolveConflict`（`startBusy`）、`submitSave`（`useActionState`）
  - 理由: 版を進めうる往復は 3 つの transition に分かれている（`startSaving` = `isSaving`、`startBusy` = `isBusy`、`useActionState` = `isSubmitting`）のに、自動保存が見るのは `isSaving` だけで、`isBusy` / `isSubmitting` は**ガードにも依存配列にも入っていない**。
    - **破棄**: 「破棄」ボタンは `dirty` のときだけ押せる。つまり押した時点で自動保存タイマーは必ず生きている（最後の変更から 1.5 秒未満）。`discard` → `applyMode` は `startBusy` の中で `readNoteEditStateFn` を待つが、この往復が残りタイマーより長いと、待っている間に `startSaving(commit(false))` が発火して**破棄対象の本文をサーバーへ書き込む**。そのあと戻ってきた `seedMode(next, latest.title, latest.html)` が「いま保存された内容」を正本として載せ直すので、画面上も破棄は起きない。`spec/manual-tests/editing.md` TC-10 手順 2〜3・手順 5 が遅い回線で FAIL する。さらに `versionRef.current = latest.version` を GET の応答で上書きするため、保存と GET の着順によっては版が巻き戻り、次の保存が偽の競合になる。
    - **明示保存**: `commit(true)` は先頭で `setStatus({kind:"saving"})` を呼ぶ。`status.kind` は依存配列にあるので effect が張り直され、`dirty` はまだ下りていないため**新しいタイマーが 1 本増える**。往復が 1.5 秒を超えると同じ `versionRef.current` で 2 本目の保存が飛び、後着が `OPTIMISTIC_LOCK_FAILURE` を返して、他者が誰もいないのに「競合しました」が出る。
    - **版の復元**: `restore` は `dirty` を要件にしていないので、未保存のまま「復元」を押せる。`startBusy` の 2 往復（`restoreNoteRevision` → `readNoteEditStateFn`）の最中に自動保存が入ると、復元前の内容が復元後の版の上に書かれる。
  - 提案: 「版を進めうる往復が 1 つでも走っているか」を 1 つの値にまとめ（`busy` は既に定義済み）、自動保存のガードと依存配列の両方をそれで置き換える。あわせて `discard` / `restore` / `resolveConflict` の入口で保留中のタイマーを明示的に落とす（タイマー ID を ref に持つ）。版の所有者が 1 か所であることは、その 1 か所の中で往復が直列であって初めて意味を持つ。

#### Warnings

- **[W-001]** 打鍵 1 つで「保存失敗」「競合」の状態が消え、自動保存が勝手に再開する
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（タイトル `input` の `onChange`、`WysiwygSurface` / `HtmlSurface` / `VisualSurface` の `onChange`、いずれも `setStatus({ kind: "dirty" })`）と自動保存 effect の `status.kind === "conflict" || status.kind === "failed"` ガード
  - 理由: 自動保存の JSDoc は「失敗・競合のあとは自分から再開しない。……再開は利用者の『再試行』か競合の解決が起点になる」と明記しているが、`failed` / `conflict` のあとに 1 文字打つだけで `status` が `dirty` に上書きされ、ガードが外れて 1.5 秒後に再送が始まる。結果、(a) 通信断では利用者が書き続ける限り 1.5 秒ごとにサーバーを叩き続ける、(b) 競合では `versionRef` が古いまま再送されて必ず失敗するうえ、「自分の内容で上書きする / 破棄する」の 2 ボタンが打鍵のたびに画面から消えるので、解決操作に手が届きにくい。ED-08 / AC-8 の「競合・権限喪失・通信エラーはそれぞれ専用の状態として提示される」に対して、競合は「提示されては消える」状態になっている。
  - 提案: 入力ハンドラーの `setStatus({kind:"dirty"})` を「`idle` / `saved` / `dirty` / `new` からのみ `dirty` へ遷移する」形に絞る（`failed` / `conflict` / `locked` / `blocked` は保持する）。`dirty` かどうかは既に導出値（`title !== savedTitle || …`）で持っているので、`status` に二重に持たせている分だけを直せばよい。

- **[W-002]** ビジュアルモードでは「保存失敗 → ローカル退避」が**編集を 1 文字も退避しない**
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`commit` の `catch` にある `writeDraft(noteId, { html: currentBody, … })`）
  - 理由: `currentBody = readBody()` はビジュアルモードでは `body` state をそのまま返し、`body` は経路編集では動かない（動くのは `visualCurrent` の Map だけ）。したがって退避される HTML は**編集前の本文**そのもので、`draft.html !== savedBody` も成立しないため復元の提案すら出ない。ED-08「通信エラーで自動保存に失敗した場合、……内容をブラウザに退避して再試行する。復帰時に復元を提案する」と `spec/manual-tests/editing.md` TC-23 が、ビジュアルモードでは成立しない（再試行ボタンを押さずに画面を離れると編集は消える）。
  - 提案: ビジュアルモードでは、退避に `visualCurrent` の内容を反映した HTML を書く（差し込んだ span を経路どおりに当てて組み直す）か、`LocalDraft` に経路表を持てる形（`{ kind: "html" } | { kind: "textNodes"; edits }`）を足す。どちらも取らないなら、ビジュアルモードでは `failed` の文言から「端末に退避した」を落とすこと（今は嘘になっている）。

- **[W-003]** ゴミ箱にあるノートが P-11 / P-12 でそのまま開け、編集・削除メニューまで出る
  - 場所: `apps/web/app/components/note/NoteDetail/index.tsx` / `detail.tsx`、`apps/web/app/components/note/NoteEditor/index.tsx`（`content.status !== "ready"` と `!note.permissions.canEdit` の 2 つしか終端状態を持たない）
  - 理由: `NoteAccessPolicy` の所有者経路はゴミ箱の壁より手前で `canEdit: true` / `canDelete: true` を返し、`getNote` にもゴミ箱の除外は無い（`spec/usecases/note.md#getNote` の出力 DTO にゴミ箱状態のフィールドが無い）。そのため削除後に `/notes/:noteId` を開き直す・ブックマークから `/notes/:noteId/edit` を開くと、ゴミ箱のノートが通常どおり描かれ、タイトルのインライン編集も「削除...」も出る。`spec/pages/index.md#P-11` の状態表は「見つかりません | 不在・**削除済み**・権限なし」と定めており、この状態に到達する経路が無い。編集画面に至っては、利用者が書けてしまい、最初の保存が `NOTE_IS_TRASHED` で落ちて初めて `blocked` に落ちる（P-12 の状態表にゴミ箱用の状態は無いので、`blocked`＝権限喪失に相乗りしている）。
  - 理由の所在は画面ではなく契約側にある — 画面はゴミ箱かどうかを知る手段を持たない。
  - 提案: `getNote` の出力にゴミ箱状態（`trashedAt: Date | null` など）を足して `spec/usecases/note.md` を改訂し、`NoteDetail` / `NoteEditor` の入口で `NotFoundState` に落とす。契約を動かさない判断を採るなら、P-11 の状態表から「削除済み」を外して理由を書くこと（今は spec 側だけが正しいことを言っている）。

- **[W-004]** 自動保存のたびに編集ルートの loader を再実行し、`getNote` 込みの断片を取り直して捨てている
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`reconcile()` を `commit` の成功枝で毎回呼ぶ）と `apps/web/app/routes/notes/$noteId_.edit.tsx` の `loader`
  - 理由: `NoteEditorIsland` は `target` を state の初期値としてしか読まないので、`router.invalidate()` が持ち帰る新しい `html` / `version` / `mayLoseDecoration` は**必ず捨てられる**（島は同じ位置・同じ型なので再マウントもしない）。編集画面で無効化される loader はこの画面自身の 1 本だけなので、1.5 秒ごとの自動保存 1 回につき「保存 1 往復（＋rename）」に加えて「`getNote` を含む RSC 断片 1 往復」が乗る。CLAUDE.md の「Every mutation reconciles with `router.invalidate()`」は一覧・親の state を戻すための規則で、ここは戻す先が無い。
  - 提案: 自動保存では `reconcile()` を呼ばず、画面を離れる契機（ノート作成直後の `navigate`、明示保存、破棄、版の復元、競合の解決）に限る。断片を取り直す必要が実際にあるのは、島が props を読み直す形にしたときだけである。

- **[W-005]** 「元に戻す」に要る版の求め方が 2 通りあり、片方は追加の往復、片方は `+1` の推測になっている
  - 場所: `apps/web/app/components/note/NoteDetail/detail.tsx#onTrash` / `#onRestore`、`apps/web/app/components/note/NoteList/board.tsx#onTrash`
  - 理由: `TrashedNoteView` は `noteId` / `trashedAt` / `purgeAfter` しか返さないので、削除のたびに `readNoteEditStateFn`（= `getNote` 一式）をもう 1 往復投げて版を取り直している。一方 `RestoredNoteView` も版を返さないので、`onRestore` は `versionRef.current = restoreVersion + 1` と**実装の内側を推測**している。`restoreNote` は今日たしかに `save` を 1 回しか行わないが、それは DTO が保証していることではなく、増えた瞬間に詳細画面のタイトル自動保存が古い版を送り始める（`restoreNoteRevision` は同じ問題を避けるために `version` を返す形になっており、ここだけ非対称）。
  - 提案: `TrashedNoteView` / `RestoredNoteView` に `version` を足す（`spec/usecases/note.md#trashNote` / `#restoreNote` の出力 DTO の改訂）。1 行で追加の往復と推測の両方が消え、`RestoredNoteRevisionView` と形が揃う。

- **[W-006]** サニタイズ通知が「直近の保存結果」にならない保存経路が 1 つ残っている
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`commit` の `else if (currentBody !== savedBody)`）
  - 理由: `skipped` はビジュアル分岐で `edits.length === 0` でも無条件に畳むのに、`removed` は「本文が変わった保存」でしか置き換わらない。タイトルだけを変えて保存すると、前回の保存で出た「保存時に N 件を取り除きました」がそのまま残り、何も除去していない保存の結果として読める。`spec/pages/index.md#P-12` の「サニタイズ通知 | 保存時に除去が発生」は直近の保存を指す。
  - 提案: 本文を送らなかった保存でも `setRemoved([])` を通す（`skipped` と同じ扱いにする）。

- **[W-007]** `spec/scenario/editing.md` ED-04 と実装・`spec/manual-tests/editing.md` TC-06 が正面から食い違ったまま残っている
  - 場所: `spec/scenario/editing.md:87`（「警告は『今後表示しない』を選べる。設定画面から再表示に戻せる」）と `apps/web/app/components/note/NoteEditor/editor.tsx#needsWysiwygWarning` / `preferences.ts` の JSDoc、`spec/manual-tests/editing.md` TC-06 手順 1（「『今後表示しない』の選択肢は無い」）
  - 理由: 「戻し口が無いので一方通行の抑止は置かない」という判断そのものは妥当だが、**その判断が canon に書かれていない**。改訂されたのは手順書だけで、要件の正典であるシナリオは今も反対のことを要求している。CLAUDE.md は「`spec/` はいま効力のある要求と設計の正典……決定が変わったら改訂する」「`.thread/` は canon ではなく、コード・`spec/`・`docs/` から参照してはならない」と定めており、`.thread/7/adr.md` に理由を書いても要件の食い違いは残る。次にこのシナリオを読む者は、実装が ED-04 を満たしていないと判断する。
  - 提案: `spec/scenario/editing.md` ED-04 の該当行を改訂する（抑止と再表示を設定画面の実装と同じスライスへ送る旨を書く）か、`spec/adr/` に決定として置いて ED-04 から参照する。

- **[W-008]** P-14 の状態表が「処理履歴（P-15）への導線を出す」を要求したまま、実装は ID の提示だけで導線を持たない
  - 場所: `spec/pages/index.md:361`（本ラウンドで改訂された行）、`apps/web/app/components/note/TrashList/board.tsx`（`EmptyOutcome` の `scheduled` 枝）、`spec/manual-tests/editing.md` TC-13 手順 7
  - 理由: 改訂で「登録した処理の ID を示して」が**足された**が、「処理履歴（P-15）への導線を出す」は残っている。実装は `jobIds` を文字列として並べるだけで、`board.tsx` の JSDoc 自身が「処理履歴（P-15）はまだ無いので導線は張れない」と書いている。手順書側は「手順 5 に示された処理の ID から処理履歴（P-15）を開く」に書き換わっており、3 者の言うことが揃っていない。P-15 が別スライスであることは正しいが、それは spec の要求文がそう書かれていて初めて「満たしている」と言える。
  - 提案: P-14 の状態表から「導線を出す」を落とし、ID の提示までを本スライスの要求として書き切る（P-15 が着地したら導線を足す旨は、必要ならそこに 1 文で添える）。

- **[W-009]** `NoteBody` の JSDoc が脅威モデルを逆に述べており、しかもこのラウンドで**未保存の HTML** を通す部品になった
  - 場所: `apps/web/app/components/note/NoteBody/index.tsx` の JSDoc（「本文の安全はサニタイズ（後続スライス）と CSP が担い、本スライスで届く本文は白紙由来のみ」）、呼び出し元 `apps/web/app/components/note/NoteEditor/surfaces.tsx#HtmlSurface`
  - 理由: 本スライスで `adapters/html/htmlProcessor.ts` が着地して「後続スライス」は解消し、さらに `HtmlSurface` のプレビューが**保存前の、`scrubForPreview` という部分集合しか通っていない HTML** を同じ `NoteBody` へ渡すようになった。`scrubForPreview` が安全側の部分集合であることは `surfaces.tsx` 側に正しく書かれているが、受け取る側の JSDoc は「届く本文は白紙由来のみ」と書いたままで、次にこの部品を再利用する者に逆の前提を渡す。差分に入っていないファイルだが、意味を変えたのは本 PR である。
  - 提案: `NoteBody` の JSDoc を実態に合わせる（「本文は `HtmlProcessor` を通ったものか、`HtmlSurface` の部分集合スクラブを通った未保存のものである」と、`innerHTML` 経路では `<script>` が走らないこと・したがって落とすべきは属性ハンドラーであることを書く）。

- **[W-010]** 「削除」を出す条件が一覧と詳細で別々の判定になっている
  - 場所: `apps/web/app/components/note/NoteList/board.tsx`（`canMove = owner.kind === "personal" || owner.canWrite` を移動と削除の両方に使う）と `apps/web/app/components/note/NoteDetail/detail.tsx`（`canDelete={note.permissions.canDelete}`）
  - 理由: `NoteListItemView` に権限が無いため、一覧は「ワークスペースが editor 以上か」で削除を出している。今日は `WorkspaceAuthorization` の `editNote` / `deleteNote` がどちらも `editor` なので一致するが、`NoteAccessPolicy.ensureCanDelete` の JSDoc は「`WorkspaceAuthorization` が `deleteNote` と `editNote` に別の最小ロールを与えた瞬間に 2 つの権限は分かれる」と、まさにその分岐を前提に置かれている。分かれた瞬間、一覧だけが出してはいけない操作を出す。
  - 提案: `NoteListItemView` に `canDelete`（もしくは `permissions`）を足すか、一覧の削除も「詳細を開いてから」に寄せる。前者なら `spec/usecases/note.md#listNotes` の出力 DTO の改訂を伴う。

#### テスト保証

`docs/test.md` の方針どおり新規のコンポーネントテストは無く、対象は `apps/web/app/presentation/` の純関数と `components/note/__tests__/` / `routes/__tests__/` の純関数テストのみ。以下は「何を確認したか」であり、テストが無い行は実装読解による。

- 本文の転送上限が 2 MB で、ドメインの 800 KB より**緩い**こと — `components/note/__tests__/schema.test.ts:"takes a raw body of exactly the ceiling and refuses one past it"` / `"applies the same ceiling to the first save of a new note"`。境界値の両側（ちょうど / +1）で見ているので、`NOTE_HTML_TRANSPORT_MAX` を動かすと落ちる。
- その 2 MB が実際に ED-03 の中核要件を通すこと — 同ファイル `"lets an oversized body reach NOTE_CONTENT_TOO_LARGE, not INVALID_INPUT"`。転送スキーマを通した同じ入力を `createHtmlProcessor().process` に流し、`NoteErrorCode.ContentTooLarge` が返ることまで見る**両側突き合わせ**になっており、転送とドメインのどちらを動かしても落ちる。このスライスで一番効いているテスト。
- `renderErrorMessage` が本スライスの到達コード全 11 件に固有文言を持つ — `presentation/__tests__/errorDisplay.test.ts:"has a dictionary entry for every editing / trash code the slice reaches"`。既定文言との**不一致**で判定するので辞書から 1 行落とせば落ちる。`OPTIMISTIC_LOCK_FAILURE` を意図的に除いた理由もコメントにある。
- `NOTE_LOCKED_BY_JOB` が再試行ではなく待機を案内する — 同ファイル `"tells the reader to wait rather than retry while a job holds the note"`。`toContain("待って")` と `not.toContain("もう一度お試しください")` の両側で見ており、共通文言へ落ちた瞬間に落ちる。
- 共有ストレージコードがアイコンとメディアの双方を名指しする — 同ファイル `"names both upload purposes in the shared storage codes"`。`5 MB` / `200 MB` / `SVG` の文字列の存在で見る。**上限値そのものが正典と一致しているかは検証していない**が、今回は手で `domain/storage/services/uploadValidationPolicy.ts` の `AVATAR_MAX_BYTES` / `MEDIA_IMAGE_MAX_BYTES` / `MEDIA_SVG_MAX_BYTES` / `MEDIA_VIDEO_MAX_BYTES` と突き合わせ、5 MB / 20 MB / 128 KB / 200 MB が一致することを確認した。
- 追加コードの HTTP ステータス写像が `kind` 写像のままであること — `presentation/__tests__/errorResponse.test.ts:"keeps the editing and trash codes on their kind mapping"`。例外表に紛れ込ませたら落ちる形で、`409`（競合）だけを別に固定しているのも妥当。
- `/storage/$` が `avatar` / `media` を配信し、`FILE_PURPOSES` の残り全部を 404 で拒む — `routes/__tests__/storage.delivery.test.ts`。許可集合を**テスト側に書き直して**突き合わせ、拒否側は `FILE_PURPOSES` の差分から自動で作るので、purpose が増えたときも編集なしで覆う。SVG の `nosniff` と `sandbox; default-src 'none'` も押さえている。配信面の回帰は捕まる。
- `moveNoteSchema` の判別共用体と `WORKSPACE_ID_MAX_LENGTH` の境界 — 既存分。維持されている。
- **テストで守られていない挙動**（いずれも上の B/W を立てた）: ビジュアルモードで面の外から入った本文の扱い（B-001）、自動保存と他の往復の同時実行（B-002）、`failed` / `conflict` からの自動再開（W-001）、ビジュアルモードの退避内容（W-002）、ゴミ箱ノートの入口判定（W-003）、`removed` のライフサイクル（W-006）。`docs/test.md` がコンポーネントテストを課さない以上、ここは `spec/manual-tests/editing.md` の TC-06 / TC-10 / TC-12 / TC-23 / TC-24 の実機実行でしか守られない。B-002 は TC-10 手順 2〜3・手順 5 が遅い回線でだけ FAIL する形なので、ローカルの実機実行では緑になりうる点に注意。

#### カバレッジ

確認（差分を読んだうえで、必要に応じて worktree の現物・呼び出し先・`packages/core` 側の契約まで追った）:

- `apps/web/app/components/layout/ScopeToken/index.tsx` — 個人／ワークスペースのゴミ箱導線。viewer で消す形は L-01 と TC-32 に一致
- `apps/web/app/components/layout/ScopeToken/listing.ts` — `canWrite?: boolean` の追加と「省略＝出さない」の定義。`scope` を組む 3 か所（`notes/index.tsx` / `notes/trash.tsx` / `settings/route.tsx`）が全て渡していることを確認
- `apps/web/app/components/note/NoteDetail/detail.tsx` — 版の単一所有、タイトル自動保存、`useOptimistic` による表示スタイル、ゴミ箱移動と「元に戻す」（→ W-003 / W-005）
- `apps/web/app/components/note/NoteDetail/index.tsx` — 読み取りと終端状態のみを持ち、操作を島へ寄せた形。`Intl` をサーバー側に閉じる判断も妥当（→ W-003）
- `apps/web/app/components/note/NoteDetail/menu.tsx` — 編集・表示スタイル・移動・削除の 4 つ。版を要する操作を島へ委譲し、移動だけ自分で持つ切り分けは JSDoc の根拠どおり
- `apps/web/app/components/note/NoteEditor/editor.tsx` — P-12 の全 13 状態、三層ミューテーション、版の単一所有、`useBlocker` による離脱確認（→ B-001 / B-002 / W-001 / W-002 / W-004 / W-006）
- `apps/web/app/components/note/NoteEditor/frame.tsx` — 枠と `BackLink` の 4 分岐。`"use client"` を付けない理由も妥当
- `apps/web/app/components/note/NoteEditor/highlight.ts` — トークナイザ。`HIGHLIGHT_MAX_LENGTH` の打ち切りと同種トークンの結合まで含めて読んだ。問題なし
- `apps/web/app/components/note/NoteEditor/index.tsx` — サーバー側の終端状態（`content.status !== "ready"` / `!canEdit`）。TC-28 手順 3 / TC-29 の改訂と一致。正規 URL への送り直しを持たない判断も二重化回避として妥当（→ W-003）
- `apps/web/app/components/note/NoteEditor/preferences.ts` — `localStorage` の 2 値と全経路の握り潰し。`readDraft` の形検証もある（→ W-002 / W-007）
- `apps/web/app/components/note/NoteEditor/skeleton.tsx` — `backTo` を取って上部バーごと描く形に直っており、4 ルートすべてが正しい `BackTarget` を渡している
- `apps/web/app/components/note/NoteEditor/surfaces.tsx` — 3 つの面、`scrubForPreview`（`script` / `iframe` / `object` / `embed` / `link` / `meta` / `base` / `form` / `noscript` の除去、`on*` と `javascript:` URL の除去。SVG 内の `script` も `querySelectorAll("*")` の `localName` で当たることを確認）、`[contain:layout_paint]` による `position: fixed` の封じ込め、Shadow DOM 上のビジュアル面（→ W-009）
- `apps/web/app/components/note/NoteEditor/textNodes.ts` — 経路規約を `adapters/html/htmlProcessor.ts#resolveTextNode` と再度突き合わせた。`childNodes` 基準・`style` / `script` の不割り当て（両側とも SVG 名前空間を除外）・空白ノードの落とし方・`template` 文脈でのパースまで一致
- `apps/web/app/components/note/NoteList/board.tsx` — 削除を一覧（親）が所有する形は CLAUDE.md の所有権規則どおり。楽観除去→失敗時の巻き戻し→`router.invalidate()` の順序も正しい（→ W-005 / W-010）
- `apps/web/app/components/note/NoteList/index.tsx` — `version` / `isPublished` の投影。`NoteListItemView` と一致（→ W-010）
- `apps/web/app/components/note/TrashList/action.ts` — `cache()` + `serverData` の引数形。`serverData` へ渡すのは検証済みの `userId` / `workspaceId` のみ
- `apps/web/app/components/note/TrashList/board.tsx` — P-14 の 9 状態が全て到達可能であることを確認（空のとき「ゴミ箱を空にする」を並べない形は TC-30 手順 2 の改訂と一致）。`scheduled` で一覧を空にしない扱いも spec どおり（→ W-008）
- `apps/web/app/components/note/TrashList/index.tsx` — viewer の「権限なし」を断片内で畳む形、残り日数を `purgeAfter` から数える形
- `apps/web/app/components/note/schema.ts` — 転送境界のスキーマ 12 本。2 MB への引き上げと `NOTE_HTML_SANITIZED_MAX` を枠にした `TEXT_NODE_EDITS_TOTAL_MAX`、`textNodePath` の正規表現、`excludingJobId` を境界に出さない判断まで確認。問題なし
- `apps/web/app/components/note/__tests__/schema.test.ts` / `apps/web/app/presentation/errorDisplay.ts` / `__tests__/errorDisplay.test.ts` / `__tests__/errorResponse.test.ts` / `apps/web/app/routes/__tests__/storage.delivery.test.ts` — 上の「テスト保証」参照
- `apps/web/app/routes/notes/-action.tsx` — 断片 3 本 + ミューテーション 12 本。全て `validateInput` を通し、`requireSession` / `requireSessionOrRedirect` を挟み、文脈を取らない設計が `noteId` で対象が定まることに根拠を持つ。`createNoteWithBodyFn` が作成→読み直し→本文保存を 1 往復に束ねる理由も確認（空本文の枝で `getNote` を 2 度書いている重複は好みの範囲なので指摘にしない）
- `apps/web/app/routes/notes/$noteId_.edit.tsx` / `notes/new.tsx` / `notes/trash.tsx` — ルート定義、`shouldReload`、`errorComponent` の分岐、スケルトンへの `backTo`
- `apps/web/app/routes/storage.$.tsx` — `media` の公開配信。`purpose === null` を弾く形、`nosniff` + `sandbox` CSP、`Cache-Control: private`
- `apps/web/app/routes/workspaces/$workspaceId/-action.tsx` — ワークスペース版の断片 3 本。ゴミ箱だけワークスペース自身を読む理由づけ、`foldScopeSelectionForUnavailable` の畳み方が一覧と揃っていること
- `apps/web/app/routes/workspaces/$workspaceId/notes/{index,new,trash,$noteId_.edit}.tsx` — 個人側と同じコンポーネントを文脈プロップで共有する形。1 コンポーネント 2 文脈から外れていないことを確認
- `apps/web/app/routes/workspaces/$workspaceId/settings/{route.tsx,-action.tsx}` — `canWrite` の伝播（TC-32 手順 3）
- 参照のみ（差分外）: `application/note/view.ts`・`getNote.ts`・`restoreNote.ts`、`domain/note/services/noteAccessPolicy.ts`、`domain/workspace/services/workspaceAuthorization.ts`、`domain/storage/services/uploadValidationPolicy.ts`、`adapters/html/htmlProcessor.ts#resolveTextNode`、`components/note/NoteBody`、`components/ui/{Alert,Deferred}`、`presentation/serverFragment.tsx`、`spec/scenario/editing.md`、`spec/usecases/note.md`

スキップ:

- `apps/web/app/routeTree.gen.ts` — TanStack Router の自動生成物。手で読む対象ではないため差分は精読していない。新 4 ルートの登録整合は `pnpm --filter @repo/web typecheck`（クリーン）で担保した
