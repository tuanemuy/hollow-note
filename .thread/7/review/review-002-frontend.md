### frontend

対象: `apps/web/app/` の全変更（171 行の一覧のうち 34 ファイル）と、`spec/pages/index.md` / `spec/manual-tests/editing.md` / `spec/design/pages/P12-editor.html` / `P14-trash.html` との整合。
`pnpm --filter @repo/web typecheck` はクリーン（実行済み）。

前ラウンドの `.thread/7/review/triage-keys.md` にある `[W-006] components/note/NoteEditor/editor.tsx`（`/notes/new` の取り込み先セレクター、defer）は本ラウンドでも再掲しない。

#### Blockers

- **[B-001]** ビジュアルモードで「破棄」が何も破棄しない — 面が戻らず、捨てたはずの編集が次の自動保存でサーバーへ届く
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx` の `discard` / `replaceBody` / `commit`（ビジュアル分岐）と `apps/web/app/components/note/NoteEditor/surfaces.tsx` の `VisualSurface`
  - 理由: ビジュアルモードの保存は経路単位の書き換えなので、`commit` は `settleSaved(currentTitle, currentBody)` に**面を差し替える前の HTML**（`readBody()` は visual では `body` state をそのまま返す）を渡す。つまり `savedRef.current.body` と `baseline` はビジュアルモードにいるあいだ一度も進まない。その状態で「破棄」を押すと `replaceBody(savedRef.current.title, savedRef.current.body)` が走るが、
    1. `setBaseline(nextBody)` が**同じ文字列**なので `VisualSurface` の `useEffect([baseline])` が再実行されず、span の中身は編集したままになる（画面上は破棄されない）、
    2. `setVisualDirty(false)` で `dirty` だけが下りるのに `visualCurrent.current` は編集後の値を保持し続けるため、次に 1 文字でも打つと `diffTextNodeEdits(visualOriginal, visualCurrent)` が**破棄したはずの編集も含めて**返し、自動保存がそれを送る。
    結果として ED-08 の「明示保存・破棄ができ」と `spec/manual-tests/editing.md` TC-10 手順 2〜3（「最後に保存した状態に戻り」「変更前の内容になっている」）がビジュアルモードでは成立しない。HTML / WYSIWYG では `baseline` が実際に変わるので同じ経路が正しく動いており、ビジュアルだけが抜けている。
  - 提案: `discard` をモードで分ける。ビジュアルモードでは `applyMode` と同じく `readNoteEditStateFn` で正本を引き直して `versionRef` ごと更新し、`replaceBody` で `baseline` を新しい文字列に差し替える（引き直しが要るのは `applyMode` の JSDoc が書いているとおり、確定済みの本文を画面だけでは組み立てられないため）。少なくとも `visualOriginal.current` / `visualCurrent.current` を破棄時に再同期し、`VisualSurface` の再シードを `baseline` の同一性以外の鍵（世代カウンタなど）で起こせるようにする。

#### Warnings

- **[W-001]** 「処理中で編集できない」「権限喪失」でも本文の面は編集し続けられる
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`editable` の利用箇所）、`apps/web/app/components/note/NoteEditor/surfaces.tsx`（`WysiwygSurface` / `HtmlSurface`）
  - 理由: `editable` はタイトル入力・モード切替・書式バー・ドロップ・保存ボタン・自動保存を止めるが、`WysiwygSurface` の `contentEditable` な `div` と `HtmlSurface` の `textarea` には `disabled` / `readOnly` / `contentEditable={editable}` のいずれも渡っていない。`spec/pages/index.md#P-12` の「処理中で編集できない」は「保存が拒否される。……**編集を受け付けず**に完了を待つよう案内する」であり、実装は「書けるが絶対に保存されない」になっている。ジョブが長い場合、書いた内容がどこにも残らないまま失われる（`failed` と違いローカル退避も走らない）。
  - 提案: `WysiwygSurface` に `contentEditable={editable}`、`HtmlSurface` の `textarea` に `readOnly={!editable}` を渡す。権限喪失（`blocked`）だけは「内容をダウンロード」のために読み取り可能なままにしたいので、`readOnly` を選ぶ（選択・コピーは残る）。

- **[W-002]** 端末に覚えた既定モードが WYSIWYG のとき、ED-04 の警告と `wysiwygConversion` の版理由が丸ごと素通りする。「今後表示しない」に戻し口が無い
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`preferenceAppliedRef` の effect、`enterMode`、`seedMode`）、`apps/web/app/components/note/NoteEditor/preferences.ts`（`writeWysiwygWarningDismissed`）
  - 理由: 既定モードの復元は `setMode(preferred)` を直接呼び、`enterMode` を通らない。したがって HTML 由来のノート（`mayLoseDecoration`）を開いても警告は出ず、`wysiwygConversionRef` も立たないので最初の保存が `reason: "manualEdit"` で記録され、版一覧に「WYSIWYG への変換」が残らない。ED-05 の「切り替える場合は ED-04 と同じ警告」は文字どおりには切替のみを指すが、失われる装飾は同じで、`spec/manual-tests/editing.md` TC-06 の前提（警告 → 了解 → 版が残る）に到達しない経路が常用パスとして開いている。加えて ED-04 は「警告は『今後表示しない』を選べる。**設定画面から再表示に戻せる**」と定めるのに、`WYSIWYG_WARNING_KEY` を消す UI がどこにもなく、一度押すと永久に戻せない。
  - 提案: 既定モードの復元も `enterMode` を経由させる（`applyMode` の再読み込みは不要なら `seedMode` 直呼びでよいが、警告と `wysiwygConversionRef` の判定は共有する）。「今後表示しない」は、戻し口を出せるようになるまで出さないか、`spec/scenario/editing.md#ED-04` 側の該当行の扱いを本スライスで決める。

- **[W-003]** 「ビジュアル不可」の判定が打鍵のたびに本文全体を再パースして全テキストノードを収集する
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`visualAvailable` を出す `useEffect([body])`）
  - 理由: `template.innerHTML = body` に続けて `collectEditableTextNodes(template.content)` を走らせており、どちらも本文長に比例する。`body` は WYSIWYG の `onInput` と HTML の `onChange` が 1 打鍵ごとに更新するので、サニタイズ後 800 KB まで許される本文では入力そのものが詰まる。同じファイルの他の重い処理（`analyzeMarkup` は 500 ms デバウンス、`tokenizeHtml` は 60,000 文字で打ち切り）はいずれも上限や遅延を持っているのに、ここだけ素通しになっている。判定が要るのはモード切替ボタンの活性だけで、1 打鍵の粒度は必要ない。
  - 提案: `analyzeMarkup` と同じデバウンスに載せるか、`length > 0` を判定した時点で走査を打ち切る（`collectEditableTextNodes` に「1 件見つけたら止める」入口を足す）。

- **[W-004]** HTML モードのプレビューが「保存すると、下のプレビューの内容で保存されます」と言い切るが、実際に保存される形とは違う
  - 場所: `apps/web/app/components/note/NoteEditor/surfaces.tsx`（`scrubForPreview` / 補正アラートの本文 / 「プレビュー（補正後）」の見出し）
  - 理由: `scrubForPreview` が落とすのは危険要素・`on*`・`javascript:` URL だけで、`HtmlProcessor` の allow-list が落とす要素・属性・CSS 宣言（`position: fixed` / `sticky` / `@import` など、ADR 013）は残る。XSS の向きとしては安全側（保存時のサニタイズの部分集合）で、そこは JSDoc の主張どおり妥当だが、利用者に見せている文言は「プレビュー＝保存される内容」と読める。ED-03 の「除去された要素・属性・URL・CSS 宣言が保存後に一覧表示される」との関係も曖昧になる（保存前は落ちて見えず、保存後に初めて `removed` で知る）。`position: fixed` を残す点は、Shadow DOM がスタイルを隔離してもビューポート基準の配置は隔離しないため、プレビューが画面全体を覆う形も作れてしまう。
  - 提案: 文言を「保存時にさらにサニタイズが入る」と分かる形へ直す（例: 「補正した構文でプレビューしています。保存時にはさらに許可されていない要素・属性・CSS が取り除かれます」）。あわせて `scrubForPreview` に `position: fixed` / `sticky` の無効化を足すか、プレビューのホストに `contain: layout paint` を掛けて面の外へ出られないようにする。

- **[W-005]** 退避の提案（`draftOffer`）が保存成功後も消えず、押すと保存済みの内容を古い退避で上書きできる
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`draftOffer` の `useEffect([noteId, savedBody])` と「復元する」のハンドラー）
  - 理由: effect は `draft !== null` のときだけ `setDraftOffer(draft)` を呼び、`null` のときに `setDraftOffer(null)` へ戻さない。自動保存が失敗して退避が書かれ、提案が出たまま「再試行」で保存が通ると、`commit` が `clearDraft(noteId)` を呼んで退避は消えるのに提案の Alert は画面に残る。そこで「復元する」を押すと、いま保存したばかりの本文が古い退避で置き換わり `dirty` になり、次の自動保存でサーバーへ書き戻される。`readDraft` が `null` を返しているので、提案が指しているデータはもう存在しない。
  - 提案: effect を `setDraftOffer(draft !== null && draft.html !== savedBody ? draft : null)` にする（`draftOffer` を effect の従属値にして、退避が消えたら提案も消えるようにする）。

- **[W-006]** タイトルが正規化される保存で版と往復が 1 つ余分に消える
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`commit` の rename 分岐と直後の `settleSaved(currentTitle, currentBody)`）
  - 理由: `rename` の応答 `renamed.title` は `NoteTitle.manual` を通った値で、空なら「無題」、前後に空白があれば trim 済みになる。`commit` は `setSavedTitle(renamed.title)` を一度当てたあと `settleSaved(currentTitle, ...)` で **入力の生値**を確定済みタイトルとして上書きするので、`title`（= 正規化後）と `savedTitle`（= 生値）が食い違い、`dirty` が下りない。結果として同じタイトルをもう一度 `renameNote` し、版が 1 つ、Revision が 1 件、無意味に進む。他クライアントとの競合窓もその分広がる。同じ画面の `NoteDetail/detail.tsx#saveTitle` は `applied`（応答の値）で確定しており、そちらが正しい形になっている。
  - 提案: `commit` でも rename の応答を確定値として持ち回る（`settleSaved(appliedTitle, currentBody)`）。

- **[W-007]** ワークスペース設定配下ではスコープトークンから「ゴミ箱」が消える
  - 場所: `apps/web/app/components/layout/ScopeToken/listing.ts`（`canWrite?: boolean`）、`apps/web/app/routes/workspaces/$workspaceId/settings/-action.tsx#loadWorkspaceSettingsShell`
  - 理由: `canWrite` は省略可で「省略は出さないと読む」と定義されたが、`/workspaces/:workspaceId/settings/*` のシェルは `getWorkspaceSettings`（`role` を含む）を既に読んでいるのに `canWrite` を渡していない。そのため owner / editor が設定画面を開いているあいだだけ「ゴミ箱」の導線が消え、同じメニューに並ぶ「ワークスペース設定」「公開ページ」はロール判定なしで出続けるという非対称になる。`spec/pages/index.md#L-01` の到達性の規則（パレット以外に最低 1 つの視覚的導線）を満たす導線がこの画面では 0 になる。`invitations/-action.tsx` / `workspaces/-action.tsx` の scope も同様。
  - 提案: 設定シェルの loader が `canWrite: WorkspaceRole.atLeast(settings.role, "editor")` を返して渡す（ゴミ箱ルートの loader と同じ 1 行）。ロールを読まない経路が残るなら、そこは省略のままでよい。

- **[W-008]** HTML モードで複数ファイルを一度にドロップすると挿入位置が壊れる
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`uploadAll` → `upload` → `insertMarkup` の非 WYSIWYG 分岐）
  - 理由: `uploadAll` はループで `upload` を同期に呼び、`insertMarkup` は毎回 `textarea.selectionStart` / `selectionEnd` を読むが、あいだに再描画が入らないので全ファイルが同じ `start` / `end` を見る。`setBody((value) => value.slice(0, start) + markup + value.slice(end))` は 2 件目以降で「1 件目のプレースホルダーを含む新しい文字列」を古い `end` で切るため、選択範囲がある状態（`start < end`）では 1 件目の `<span data-hollow-upload=...>` が途中で切り落とされ、`settlePlaceholder` の正規表現にも当たらなくなる（キャレットが折り畳まれている場合は順序が逆になるだけで済む）。
  - 提案: `insertMarkup` を「複数まとめて挿入」できる形にするか、`upload` 側で挿入位置をローカルに進める（1 件挿すごとに `start += markup.length` を持ち回る）。

- **[W-009]** `NoteEditorSkeleton` の JSDoc が「上部バーはルート側が常に描く」と書いているが、どのルートも描いていない
  - 場所: `apps/web/app/components/note/NoteEditor/skeleton.tsx`、`apps/web/app/routes/notes/$noteId_.edit.tsx` / `notes/new.tsx` / `workspaces/$workspaceId/notes/{$noteId_.edit,new}.tsx`
  - 理由: 4 つのルートはいずれも `<Suspense fallback={<NoteEditorSkeleton />}><Deferred .../></Suspense>` だけを返し、シェルは島（`NoteEditorIsland`）と `EditorShell` の中にしかない。したがって P-12 の「読み込み中」ではバーごと消え、戻る導線が 1 つも無い時間ができる。コメントは実装と食い違っており、読んだ人が「バーはある」と誤解する。
  - 提案: スケルトンに `barClass` の枠（`BackLink` だけ）を含めるか、ルート側で `EditorShell` 相当を被せる。どちらにせよ JSDoc を実態に合わせる。

- **[W-010]** サニタイズ通知（`removed`）と「反映できなかった編集」（`skipped`）が消えない
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx`（`removed` / `skipped` の `setState` 箇所）
  - 理由: `skipped` はビジュアルモードで `edits.length > 0` のときだけ書き換わるので、一度出ると別モードへ移っても、以後の保存で 1 件も落ちなくても表示され続ける。`removed` も同様にモード切替・版の復元・競合解決で消えない。`spec/pages/index.md#P-12` の「サニタイズ通知」は「保存時に除去が発生」がきっかけの状態で、直近の保存結果を指すはずである。
  - 提案: `applyMode` / `replaceBody` / `resolveConflict` / `restore` で両方を空に戻し、`commit` の各保存でも「今回の結果」で必ず置き換える（ビジュアル分岐は `edits.length === 0` でも `setSkipped([])`）。

#### テスト保証

`docs/test.md` の方針どおり新規のコンポーネントテストは無く、`apps/web/app/presentation/` の純関数だけが対象。以下は「何を確認したか」であり、テストが無い行は実装読解による。

- `renderErrorMessage` が本スライスの到達コード全 11 件に固有文言を持つ — `presentation/__tests__/errorDisplay.test.ts:"has a dictionary entry for every editing / trash code the slice reaches"`。既定文言との**不一致**で判定するので辞書から 1 行落とせば落ちる（検出力あり）。`OPTIMISTIC_LOCK_FAILURE` を意図的に除いた理由もコメントに書かれている。
- `NOTE_LOCKED_BY_JOB` が再試行ではなく待機を案内する — 同ファイル `"tells the reader to wait rather than retry while a job holds the note"`。`toContain("待って")` と `not.toContain("もう一度お試しください")` の両側で見ており、共通文言へ落ちた瞬間に落ちる。
- 共有ストレージコードがアイコンとメディアの双方を名指しする — 同ファイル `"names both upload purposes in the shared storage codes"`。`5 MB` / `200 MB` / `SVG` を含むかで見るので、`UploadValidationPolicy` の表を変えて文言を直し忘れると落ちる。ただし**上限値そのものが正典と一致しているかは検証していない**（文字列の存在確認まで）。
- 追加コードの HTTP ステータス写像が `kind` 写像のままであること — `presentation/__tests__/errorResponse.test.ts:"keeps the editing and trash codes on their kind mapping"`。例外表に紛れ込ませたら落ちる形になっており、`409`（競合）だけを別に固定しているのも妥当。
- `/storage/$` が `media` を配信し、`source` / `reference` / `artifact` を 404 で拒む — `routes/__tests__/storage.delivery.test.ts`。SVG に `nosniff` と `sandbox; default-src 'none'` が載ることも押さえている。許可 purpose を 1 つ増やすと落ちるので、配信面の回帰は捕まる。
- **テストで守られていない挙動**（いずれも上の B/W を立てた）: ビジュアルモードの破棄（B-001）、`locked` / `blocked` での編集拒否（W-001）、WYSIWYG 警告の発火条件（W-002）、退避提案のライフサイクル（W-005）、タイトル正規化後の確定値（W-006）。`docs/test.md` がコンポーネントテストを課さない以上、ここは `spec/manual-tests/editing.md` の TC-06 / TC-10 / TC-15 / TC-24 / TC-29 の実機実行でしか守られない。B-001 と W-001 は現状その手順で FAIL する。

#### カバレッジ

確認（差分を読んだうえで、必要に応じて worktree の現物・呼び出し先まで追った）:

- `apps/web/app/components/layout/ScopeToken/index.tsx` — 個人／ワークスペースのゴミ箱導線。viewer で消す形は L-01 と TC-32 に一致（→ W-007）
- `apps/web/app/components/layout/ScopeToken/listing.ts` — `canWrite?: boolean` の追加と「省略＝出さない」の定義（→ W-007）
- `apps/web/app/components/note/NoteDetail/detail.tsx` — 版の単一所有、タイトル自動保存、`useOptimistic` による表示スタイル、ゴミ箱移動と「元に戻す」。`readNoteEditStateFn` で復元用の版を取り直す形は `NoteAccessPolicy` の所有者経路が trashed も granted にするので成立することを確認
- `apps/web/app/components/note/NoteDetail/index.tsx` — 読み取りと終端状態のみを持ち、操作を島へ寄せた形。`Intl` をサーバー側に閉じる判断も妥当
- `apps/web/app/components/note/NoteDetail/menu.tsx` — 編集・表示スタイル・移動・削除の 4 つ。版を要する操作を島へ委譲し、移動だけ自分で持つ切り分けは JSDoc の根拠どおり
- `apps/web/app/components/note/NoteEditor/editor.tsx` — P-12 の全状態、三層ミューテーション、版の単一所有、`useBlocker` による離脱確認（→ B-001 / W-001 / W-002 / W-003 / W-005 / W-006 / W-008 / W-010）
- `apps/web/app/components/note/NoteEditor/frame.tsx` — 枠と `BackLink` の 4 分岐。`"use client"` を付けない理由も妥当
- `apps/web/app/components/note/NoteEditor/highlight.ts` — トークナイザ。`HIGHLIGHT_MAX_LENGTH` の打ち切りと同種トークンの結合まで含めて読んだ。問題なし
- `apps/web/app/components/note/NoteEditor/index.tsx` — サーバー側の終端状態（`content.status !== "ready"` / `!canEdit`）。TC-28 手順 3 / TC-29 の改訂と一致。正規 URL への送り直しを持たない判断も二重化回避として妥当
- `apps/web/app/components/note/NoteEditor/preferences.ts` — `localStorage` の 3 値と全経路の握り潰し。`readDraft` の形検証もある（→ W-002）
- `apps/web/app/components/note/NoteEditor/skeleton.tsx` — （→ W-009）
- `apps/web/app/components/note/NoteEditor/surfaces.tsx` — 3 つの面、`scrubForPreview`、Shadow DOM 上のビジュアル面（→ W-001 / W-004、B-001 の再シード経路）
- `apps/web/app/components/note/NoteEditor/textNodes.ts` — 経路規約を `adapters/html/htmlProcessor.ts#resolveTextNode` と突き合わせた。`childNodes` 基準・`style` / `script` の不割り当て・SVG 除外・空白ノードの落とし方まで一致。パーサー文脈も両側 template で揃っている
- `apps/web/app/components/note/NoteList/board.tsx` — 削除を一覧（親）が所有する形は CLAUDE.md の所有権規則どおり。楽観除去→失敗時の巻き戻し→`router.invalidate()` の順序も正しい
- `apps/web/app/components/note/NoteList/index.tsx` — `version` / `isPublished` の投影。`NoteListItemView.version` と一致
- `apps/web/app/components/note/TrashList/action.ts` — `cache()` + `serverData` の引数形。`serverData` へ渡すのは検証済みの `userId` / `workspaceId` のみで、未検証の外部入力は通っていない
- `apps/web/app/components/note/TrashList/board.tsx` — P-14 の 9 状態。`scheduled` で一覧を空にしない扱い、`jobIds` の提示ともに改訂後の spec と一致
- `apps/web/app/components/note/TrashList/index.tsx` — viewer の「権限なし」を断片内で畳む形、残り日数を `purgeAfter` から数える形
- `apps/web/app/components/note/schema.ts` — 転送境界のスキーマ 12 本。ドメインより緩い上限を意図的に置く理由づけ、`excludingJobId` を境界に出さない判断、`textNodePath` の正規表現、`TEXT_NODE_EDITS_TOTAL_MAX` の根拠まで確認。問題なし
- `apps/web/app/presentation/errorDisplay.ts` / `__tests__/errorDisplay.test.ts` / `__tests__/errorResponse.test.ts` — 上の「テスト保証」参照
- `apps/web/app/routes/__tests__/storage.delivery.test.ts` — 同上
- `apps/web/app/routes/notes/-action.tsx` — 断片 2 本 + ミューテーション 11 本。全て `validateInput` を通し、`requireSession` を挟み、文脈を取らない設計が `noteId` で対象が定まることに根拠を持つ。`createNoteWithBodyFn` が作成→読み直し→本文保存を 1 往復に束ねる理由（`createBlankNote` が版を返さない）も確認
- `apps/web/app/routes/notes/$noteId_.edit.tsx` / `notes/new.tsx` / `notes/trash.tsx` — ルート定義、`shouldReload`、`errorComponent` の分岐（→ W-009）
- `apps/web/app/routes/storage.$.tsx` — `media` の公開配信。`purpose === null` を弾く形、`nosniff` + `sandbox` CSP、`Cache-Control: private`。鍵が推測不能である前提が `publicUrl` の契約と一致
- `apps/web/app/routes/workspaces/$workspaceId/-action.tsx` — ワークスペース版の断片 3 本。ゴミ箱だけワークスペース自身を読む理由づけ、`foldScopeSelectionForUnavailable` の畳み方が一覧と揃っていること
- `apps/web/app/routes/workspaces/$workspaceId/notes/{index,new,trash,$noteId_.edit}.tsx` — 個人側と同じコンポーネントを文脈プロップで共有する形。1 コンポーネント 2 文脈から外れていないことを確認
- 参照のみ（差分外）: `application/note/view.ts`・`getNote.ts`・`trashNote.ts`・`restoreNote.ts`・`renameNote.ts`、`domain/note/services/noteAccessPolicy.ts`、`domain/note/valueObject.ts#NoteTitle`、`domain/workspace/services/workspaceAuthorization.ts`、`adapters/html/htmlProcessor.ts#resolveTextNode`、`components/ui/Alert`、`components/note/NoteBody`、`components/layout/ReaderShell`、`components/settings/panelStyles`、`routes/workspaces/$workspaceId/settings/{route.tsx,-action.tsx}`、`spec/design/pages/P12-editor.html`

スキップ:

- `apps/web/app/routeTree.gen.ts` — TanStack Router の自動生成物。手で読む対象ではないため差分は精読していない。新 4 ルートの登録整合は `pnpm --filter @repo/web typecheck`（クリーン）で担保した
