### frontend

対象: `7-round-005.files`（190 行）のうち `apps/web/app/` の 38 ファイル全部と、`spec/pages/index.md` / `spec/manual-tests/editing.md` / `spec/presentation/index.md` との整合。ゼロベースで読み直した（差分ではなく現物のファイルを読み、行番号は現物のもの）。

`.thread/7/review/triage-keys.md` の判定済みキー（`[W-006] NoteEditor/editor.tsx` の取り込み先セレクター、`[W-003] routes/storage.$.tsx:GET`、`[W-008] ScopeToken/listing.ts:canWrite`、`[W-008] spec/pages/index.md:361`、`[W-010] NoteList/board.tsx:canMove` ほか）は再掲しない。

今ラウンドの 4 つの重点について先に結論を置く。

- **`EditorSnapshot` / `takeSnapshot()`**: 版を進めうる往復の入口（`commit` 505、退避 646-652、ダウンロード 1294、競合の上書き 890）はすべて写しを読む形になっており、「いまの値を確定させる」経路は**残っていない**。`settleSaved`（674-689）が受け取るのも写しだけである。ただし逆向き — 写しではなく**面の現在値を捨てる**経路が 1 本残っている（W-002）。加えて写しの確定がサーバーの `skipped` を無視している（W-001）。
- **`NoteIdentity`**: sentinel は消えた。`identityRef` / `rememberIdentity`（233-237）が唯一の書き戻し口で、`expectedVersion` を作る 5 経路（`commit` 566/570/593/604、`restore` 944）はすべて `identityRef.current` の `existing` 枝からしか値を取らない。`version` を描画側へ出していない（239 行のコメントどおり）ことも確認した。
- **`busy` の粒度**: `busy = activity.kind !== "idle" || isSubmitting || uploading`（710）から `isSideBusy` が外れ、書式バー・メディア挿入・版一覧の取得が保存中も生きる形になった（TC-08 手順 6 と一致）。版を進めうる往復 4 種はすべて `runExclusive`（318-331）の中からしか呼ばれないことを呼び出し元まで辿って確認した（`commit` の 4 か所 693 / 735 / 1316 / 1379、`applyMode` 786、`resolveConflict` 891、`restore` 937）。**エディタ内の排他は緩んでいない。** 緩んでいるのは同じ問題を持つ隣の島（`NoteDetail/detail.tsx`）のほうである（W-006）。
- **`scrubForSurface`**: 3 経路とも通っている（`surfaces.tsx:133` / `267` / `456`）。しかし落とす集合に `style` 要素が無く、3 つのうち WYSIWYG だけが shadow root ではなく**本文書**なので、本文の `<style>` が編集画面全体へ漏れる（B-001）。`on*` と `javascript:` の取りこぼしそのものは、シード時点については見当たらなかった。シード**後**に面へ入る markup は素通りする（W-005）。

#### Blockers

- **[B-001]** WYSIWYG の面だけが shadow root の外にあり、**本文の `<style>` が編集画面全体に効く**
  - 場所: `apps/web/app/components/note/NoteEditor/surfaces.tsx:128-138`（`surface.innerHTML = next`）と `148-169`（面は素の `<div>`。`editorSurfaceClass` は 28-29 で `contain` を持たない）、`209-219`（`UNSAFE_PREVIEW_ELEMENTS` に `style` が無い）、`199-203`（「面の外へ出られないことはホスト側の `contain` が担保する」という JSDoc の断言）
  - 理由: `scrubForSurface` が落とすのは `script` / `iframe` / `object` / `embed` / `link` / `meta` / `base` / `form` / `noscript` と `on*` / `javascript:` だけで、`style` 要素は残る。そして `<style>` は**サニタイズが意図して残す要素**である（`packages/core/src/adapters/html/allowList.ts:101` が `ALLOWED_ELEMENTS` に載せており、ED-03 の「スタイルシートは本文に埋め込みます」がそれを要求している）。他の 2 面は shadow root（`VisualSurface` は `surfaces.tsx:435` の `attachShadow`、HTML のプレビューは `NoteBody` が `NoteBody/index.tsx:95-96` で `attachShadow`）なので `<style>` の適用範囲がそこで閉じるが、`WysiwygSurface` は `<main>` 直下の素の `div` に `innerHTML` を入れる。HTML の `<style>` は挿入位置に関わらず**文書全体**に効くので、本文が持っているセレクターがそのまま編集画面の上部バー・保存ボタン・警告 Alert に当たる。
  - `contain` は 2 重に効かない。(1) `editorSurfaceClass`（28-29）に `contain` は無い（付いているのは HTML プレビューのホスト `388` だけ）。(2) そもそも `contain: layout paint` はレイアウトと描画の閉じ込めであって**セレクターの到達範囲は閉じない** — `packages/core/src/adapters/html/css.ts:5` の JSDoc が「Shadow DOM scopes selectors but not layout」と書いているとおり、ADR 013 の CSS 方針は「セレクターは Shadow DOM が閉じる」ことを前提に**宣言レベルの除去を `position` と `@import` の 2 つに絞っている**。その前提が成り立たない面が 1 つあるので、`position: absolute` + `z-index` や `* { display: none }`、`button { opacity: 0 }` といった、保存側が意図して通している宣言がそのまま編集画面の UI を覆う・消す。
  - 到達経路（ED-04 の主動線そのもの）: `<style>` を含む本文を保存したノートは `sourceFileId === null` かつ `styleMode === "default"` になりうるので `mayLoseDecoration` が偽（`NoteEditor/index.tsx:100-101`）→ 編集画面は**警告も出さずいきなり WYSIWYG で開く**（`editor.tsx:271-272`）→ 本文の CSS が編集画面へ適用される。取り込み由来のノート（TC-06 の動線）でも、警告を了解して WYSIWYG へ入った時点で同じことが起きる。共有ワークスペースでは他のメンバーが書いた本文が自分の編集画面を壊せる。
  - 直し方: (1) `scrubForSurface` に `style` を足す（面の innerHTML が保存の元値になるので、WYSIWYG に入った時点でスタイルシートが落ちることになる。ED-04 の警告は「取り込んだ外部スタイルシートも失われうる」と既に告げているので筋は通る）、(2) 面ごと shadow root に載せる、(3) シード時に `<style>` の中身を面のホストへスコープし直す、のいずれか。あわせて 199-203 行の JSDoc から `contain` が担保しているという断言を実態に合わせること — この断言があるかぎり、次にこの面を触る人は同じ判断を繰り返す。

#### Warnings

- **[W-001]** サーバーが `skipped` で拒んだ経路まで「送って通った」基準に取り込むので、その経路が**再読み込みまで永久に保存できなくなる**
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:589-599`（`applied.skipped` を `nextSkipped` に落とすだけ）と `674-689`（`settleSaved` の 682 行 `visualOriginal.current = sent.textNodes;`）
  - 理由: `applyTextNodeEdits` は経路ごとに `pathNotFound` / `contentChanged` で個別に落とし、落ちた経路はサーバー側で**一切適用されていない**。ところが確定は成否を問わず `sent.textNodes` 丸ごとを新しい基準にするので、落ちた経路の「新しい文字列」が `visualOriginal` に入る。次にその経路を編集すると `diffTextNodeEdits` が組む `expected` は**一度も適用されていない文字列**になり、サーバーが持つ旧値と一致しないので再び `contentChanged` で落ちる。以後その経路は何度打っても保存されない。画面は「反映できなかった編集があります…画面を読み直してからやり直してください」（1420-1429）と告げるので黙って壊れるわけではないが、告げているのは 1 回目の失敗だけで、2 回目以降は同じ経路が同じ理由で落ち続ける。
  - round-004 の B-001 の直しでこの点まで畳む想定だった（当時の指摘文にも「`skipped` に落ちた経路まで基準に取り込んでいる点も同じ 1 か所で直る」とある）が、`settleSaved` は無条件に取り込んでいる。
  - 直し方: `settleSaved` に適用できなかった経路を渡し、`visualOriginal` からその経路だけ**旧値のまま**残す（`nextSkipped` は既に手元にある）。あるいは `skipped.length > 0` のときは面ごと `reseedFromServer` する（620 行の丸ごと保存後と同じ扱い）。

- **[W-002]** ビジュアルモードの「丸ごと送る」保存が、往復のあいだの打鍵を**黙って捨てる**
  - 場所: `editor.tsx:616-624`（`if (mode === "visual") { await reseedFromServer(mode); … }`）と `855-868`（`replaceBody` が `setVisualDirty(false)` と `visualCurrent.current = new Map()` を行う）
  - 理由: 写しの規則は「送った値を確定させる」だが、この枝だけは確定ではなく**面ごと載せ直す**。`VisualSurface` は保存中も凍らない（`editable` は `locked` / `blocked` でしか降りない）ので、往復のあいだに打った文字は `visualCurrent` に入っているが、`replaceBody` がそれを捨てて `visualDirty` を落とす。HTML / WYSIWYG の枝が `settleSaved` で `body !== savedBody` を残して次の自動保存へ渡すのと非対称で、B-001 の直しが守ろうとしたまさにその性質（往復中の打鍵を失わない）がここだけ破れている。
  - 到達経路は狭い（ビジュアルモードで `body !== savedBody` になるのは退避の「復元する」1194-1244 と競合の「自分の内容で上書きする」903-912 のあと）が、どちらも「利用者が明示的に選んだ内容」を扱う枝なので、そこで打った文字が消えるのは重い。`spec/manual-tests/editing.md` の TC-11 手順 5（版の復元で未保存が消える）と TC-10（破棄）は明示的に文書化された喪失だが、この枝は文書のどこにも無い。
  - 直し方: 載せ直す前に `visualCurrent` の差分を退避して載せ直したあとの経路表へ当て直すか、この枝のあいだだけ面を凍らせる（`editable` とは別の「保存中は入力を受けない」枠を持つ）。

- **[W-003]** 新規作成の初回保存が失敗したとき、**していない退避を「した」と告げる**
  - 場所: `editor.tsx:642-654`（`if (failed.kind === "existing" && next.kind === "failed")` のときだけ `writeDraft`）と `1306-1326`（`failed` の Alert が無条件に「内容はこの端末に退避したので、次に開いたときに復元できます。」と書く）
  - 理由: 退避の鍵は `noteId`（`preferences.ts:76`）なので、ノートがまだ無い `/notes/new` では退避が成立しない。ところが Alert は `status.kind === "failed"` だけを見るので、通信断で初回保存が落ちた新規ノートでも同じ文言が出る。利用者はその案内を信じて画面を離れ、書いたものは戻らない。`spec/pages/index.md#P-12` の状態表は「保存失敗 | 通信エラー（ローカル退避と再試行）」であり、退避が無い状態を持っていないので、**文言のほうを状態に合わせる**しかない。
  - 併せて 1323-1324 行は `{status.message}` の直後に改行だけ挟んで次の文が続くので、描画上は 2 文がスペース無しで連結される。
  - 直し方: `SaveStatus` の `failed` に `stashed: boolean` を持たせ（退避したかどうかは `writeDraft` を呼んだ側が知っている）、文言と「次に開いたときに復元できます」を分岐させる。新規ノートでは代わりに「内容をダウンロード」を出すのが素直（`blocked` が既に持っている 1290-1299）。

- **[W-004]** `createNoteWithBodyFn` が冪等でなく、再試行が**白紙ノートを増やす**
  - 場所: `apps/web/app/routes/notes/-action.tsx:377-444`（`createBlankNote` → `getNote` → `updateNoteBody` の 3 段）と `editor.tsx:514-556`（応答を受け取るまで `identityRef` は `new` のまま）
  - 理由: `createBlankNote` が成功したあと `updateNoteBody` が落ちる／応答が届かないと、サーバーにはノートが 1 件残るのに画面は `identity.kind === "new"` のままである。`failed` の「再試行」（1315-1317）は `commit(true)` を呼び直すので `opening.kind === "new"` の枝に再び入り、**2 つ目の白紙ノートを作る**。押すたびに増える。自動保存は `failed` から自力で再開しないので暴走はしないが、1 回の再試行につき 1 件の孤児が残る。
  - JSDoc（358-376）は「読み直しと保存のあいだに他者が割り込む窓」には触れているが、この窓には触れていない。
  - 直し方: 画面から冪等鍵（`useId` などの安定した値）を運んで同じ鍵の再送を同じノートに畳むか、最低限、応答が返らなかったときに `identityRef` を進める術が無い以上「再試行」を新規作成では出さず「もう一度保存」ではなく「内容をダウンロード」へ倒す。

- **[W-005]** WYSIWYG の面は**シードのときだけ** scrub され、あとから入る markup は素通りする
  - 場所: `editor.tsx:1847-1857`（`createLink` が `window.prompt` の生の文字列をそのまま `document.execCommand("createLink", …)` へ渡す）、`974-993`（`insertMarkup` の `execCommand("insertHTML")`）、`surfaces.tsx:128-138`（scrub が走るのは `baseline` が変わったときだけ）
  - 理由: `scrubForSurface` は面を組み直す入口にしか無い。`createLink` は `url.length > 0` しか見ないので `javascript:alert(1)` がそのまま `<a href>` になり、**アプリのオリジンで動く live DOM に script URL のリンクが残る**（保存時のサニタイズは通るので永続化はされないが、その面をクリックすればセッション内で実行される）。貼り付け（`paste`）で入る markup も同様に scrub を通らない。`surfaces.tsx:190-207` の JSDoc は「未保存の本文が面へ入る経路は実在する（退避データの『復元する』）」と経路を 1 つだけ名指しているが、実際にはシード以外に少なくとも 3 つ（`execCommand("createLink")`・`execCommand("insertHTML")`・貼り付け）ある。
  - 自分が打った URL である以上被害は自分に閉じるが、「編集画面に貼ってください」の一手で成立する自己 XSS であり、面の入口が 1 つだという JSDoc の前提のほうが誤っている。
  - 併せて `NoteBody/index.tsx:29-32` の「どちらもクライアントでは `shadowRoot.innerHTML` から入るので、本文の `<script>` はそこで実行されない」は、SSR 経路（`<template shadowrootmode>` を HTML パーサーが読む `155` 行の枝）を勘定に入れていない。宣言的 Shadow DOM の中の `<script>` は実行される。現状はどちらの呼び出し元も `script` を落としてから渡すので穴は無いが、断言としては 1 経路ぶん足りない。
  - 直し方: `createLink` の URL を `http` / `https` / `mailto` に限る（少なくとも `javascript:` / `data:` を弾く）。あわせて JSDoc の「入る経路」を実態に揃える。

- **[W-006]** `NoteDetail` の島は、**同じ版を握る 3 つの往復に排他が無い**
  - 場所: `apps/web/app/components/note/NoteDetail/detail.tsx:96-125`（`saveTitle`）、`130-136`（自動保存の effect に `isSaving` のガードが無い）、`138-160`（`onStyleMode`）、`162-184`（`onTrash`）— いずれも `versionRef.current`（83）を読んで `expectedVersion` にする
  - 理由: 3 つとも同じ `useTransition`（94）を使うが、`useTransition` は**直列化しない**。タイトルの自動保存タイマー（800ms）は `isSaving` を見ないので、表示スタイルの切替やゴミ箱への移動が飛んでいる最中にも発火する。両者は同じ `versionRef.current` を送るため、後着が必ず `OPTIMISTIC_LOCK_FAILURE` になり、画面には競合の生の文言（`displayError`）が出てタイトルが巻き戻る（113 行）。エディタ側がこの問題を `EditorActivity` / `runExclusive` で構造的に潰したのと同じ欠陥が、同じ PR の隣の島に残っている。
  - メニューのボタンは `disabled={busy}`（`menu.tsx:67`）で守られているが、守れないのは**タイマー側**である。到達は「タイトルを打つ → 800ms 以内にメニューから表示スタイルを切り替える」で足りる。
  - 直し方: エディタと同じ形（占有 ref 1 つ）を持たせるか、最小限として自動保存の effect に `if (isSaving) return;` を足し、`onStyleMode` / `onTrash` の直前で保留中のタイトル保存を先に流す。

- **[W-007]** 退避した本文が `localStorage` に**無期限で、サインアウトでも消えずに**残る
  - 場所: `apps/web/app/components/note/NoteEditor/preferences.ts:98-100`（`writeDraft`）、`102-104`（`clearDraft` は保存成功・明示破棄のときだけ）、`editor.tsx:631`（成功時の `clearDraft`）
  - 理由: 退避に入るのはノート本文そのもの（最大 2 MB）で、鍵は `hollow.noteEditor.draft.{noteId}` である。保存に成功しないかぎり消える契機が無く、サインアウト経路にも掃除は無い（`apps/web/app` 内で `localStorage` を触るのは `preferences.ts` の 3 関数だけ）。共用端末で A がサインアウトしたあと、B は `localStorage` を列挙するだけで A の未保存の本文を読める。`spec/scenario/editing.md` ED-08 は退避を要求しているが、保持期間や消去の契機は定めていない。
  - 直し方: `savedAt` を根拠に期限（たとえば 7 日）を切って `readDraft` の側で捨てるか、サインアウトの経路で `hollow.noteEditor.draft.` 前置きの鍵を一掃する。

- **[W-008]** 権限喪失時の唯一の逃げ道であるダウンロードが、**Blob URL を同期で失効させる**
  - 場所: `editor.tsx:1932-1945`（`anchor.click()` の直後に `URL.revokeObjectURL(url)`）
  - 理由: `click()` はダウンロードの**開始**しか保証しない。同じタスクの中で `revokeObjectURL` すると、ブラウザーによってはフェッチが始まる前に URL が無効になり、ダウンロードが黙って失敗する。これは ED-08 の「権限喪失（内容のダウンロードを提供）」と `spec/manual-tests/editing.md` TC-24 手順 4 の唯一の実現手段で、失敗しても画面には何も出ない（`blocked` の Alert がそのまま残るだけ）。
  - 直し方: `setTimeout(() => URL.revokeObjectURL(url), 0)` 相当へ落とすか、`anchor` を DOM へ挿してから `click()` → 次のタスクで撤去する定型に合わせる。

- **[W-009]** サニタイズ通知の `key` が一意でなく、**同じ除去が 2 件出ると React の key が重複する**
  - 場所: `editor.tsx:1409-1416`（`key={`${entry.kind}:${entry.name}:${entry.reason}`}`）
  - 理由: `HtmlProcessor` の `report` は出現ごとに 1 件を積むだけで重複を畳まない（`packages/core/src/adapters/html/htmlProcessor.ts` の `report(...)` 呼び出しはどれも `Set` を通さない）。`<script>` が 2 つあれば `{element, script, 同じ理由}` が 2 件来るので、3 列を連結した鍵は必ず衝突する。`spec/manual-tests/editing.md` TC-16 手順 6 は複数種の要素をまとめて貼る手順なので、実機でも普通に踏む。
  - 直し方: 配列の添字を鍵に混ぜる（この一覧は並べ替えも部分更新も起きない派生値なので `noArrayIndexKey` の例外理由は `surfaces.tsx:336` と同じ）。

- **[W-010]** `readNoteEditStateFn` が返す `canEdit` を**誰も読んでいない**ので、載せ直した面が権限を失ったまま書ける
  - 場所: `apps/web/app/routes/notes/-action.tsx:266-271`（応答に `canEdit` を載せる）と `editor.tsx:812-822`（`reseedFromServer` は `version` / `title` / `html` しか使わない）
  - 理由: モード切替・競合の解決・版の復元は必ず正本を引き直すので、権限喪失を**その往復で**知る機会がある。ところが `canEdit` は捨てられ、`status` は 798-802 行で `idle` に戻されるため、面はふつうに書ける状態で載る。実際に落ちるのは次の保存で、そこまでに書いた分は `blocked` になってからダウンロードするしか残らない。転送境界を渡っているのに誰も読まないフィールドは、契約としても遊んでいる。
  - 同じ「権限を失ったあとも版を進めうる操作が残る」枝として、`blocked` のとき「破棄」（1165-1172、`disabled={!dirty || busy}`）だけが押せる。押すと `applyMode` → `readEditState` へ 1 往復して失敗し、`classify` が `blocked` を上書きするだけなので実害は小さいが、TC-24 手順 4 の「本文・タイトル・メディア挿入・モード切替はいずれも操作できない」という期待とは揃っていない。
  - 直し方: `reseedFromServer` が `canEdit === false` を見たら `status` を `blocked` にする。`blocked` / `locked` のとき「破棄」も落とす。

#### テスト保証

対象は `apps/web/app/presentation/__tests__/` と `apps/web/app/components/note/__tests__/` の純関数テスト、および `apps/web/app/routes/__tests__/`（`docs/test.md`「Frontend: the bare minimum」の方針どおり、新規のコンポーネントテストが無いことは指摘しない）。

守れているもの:

- `components/note/__tests__/schema.test.ts:78-129` — 転送上限 2 MB の境界を `updateNoteBodySchema` / `createNoteWithBodySchema` の両方で押さえたうえで、107-129 行が**両側突き合わせ**になっている。生 HTML 1.2 MB（`<script>` 400 KB + 本文 400 K 文字）が転送を通り、実物の `createHtmlProcessor().process` が `NOTE_CONTENT_TOO_LARGE` を投げることまで見るので、`schema.ts:37-49` が主張する「転送枠はドメイン上限より緩い」という設計が実効的に固定されている。fake を挟まずアダプター本体を呼んでいるのも正しい。
- `presentation/__tests__/errorDisplay.test.ts:99-125` — 11 コードについて「辞書に載っている」ことを、文言の写経ではなく **kind の共通文言と異なること**で判定する。文言の書き換えでは落ちず、辞書から落ちたときだけ落ちる。`OPTIMISTIC_LOCK_FAILURE` をこの形で判定できない理由を明示して除外している点も良い。127-136 行（`NOTE_LOCKED_BY_JOB` が「待って」を含み「もう一度お試しください」を含まない）と 138-150 行（共有ストレージコードが 2 用途・2 上限を名指しする）は、共通文言へ倒れた瞬間に落ちる性質の検査になっている。
- `presentation/__tests__/errorResponse.test.ts:53-72` — 新コードが例外表に**入っていない**ことを 422 / 404 / 409 で固定する。「足さなかった」という判断はふつうテストに残らないので価値がある。
- `routes/__tests__/storage.delivery.test.ts` — ルートの GET ハンドラーを実物の memory `ObjectStorage` に対して回す。TC-storage-175 / 176 に加え、`FILE_PURPOSES` の**補集合**を走査して 404 を確認する 106-136 行が効く（鍵空間に purpose が増えたとき、このファイルを編集しなくても「載せる / 載せない」の判断を強制する唯一の場所）。110 行で `PUBLICLY_SERVED_PURPOSES` を読まずに正典を書き直しているのも、対にすべき片側として正しい。

守られていない範囲（次に足すならここ、の意味で）:

- `applyTextNodeEditsSchema`（`schema.ts:81-105`）が丸ごと素通り。`textNodePath` の `/^\d+(\.\d+)*$/` は `NoteEditor/textNodes.ts` の経路規約と `adapters/html/htmlProcessor.ts:717-743` の `resolveTextNode` に一致していないと編集が全件落ちる境界そのもので、`TEXT_NODE_EDITS_TOTAL_MAX` の `superRefine`（93-104）はこのファイルで唯一の手書き規則である。どちらも 1 ケースずつで固定できる。round-004 で同じ指摘があり、未着手のままである。
- `NoteEditor/textNodes.ts` の 3 つの純関数（`collectEditableTextNodes` / `hasEditableTextNode` / `diffTextNodeEdits`）と `NoteEditor/highlight.ts` の `tokenizeHtml` は DOM を要さない（`diffTextNodeEdits` と `tokenizeHtml` は完全に純粋）にもかかわらず 1 ケースも無い。とくに `tokenizeHtml` は `findTagEnd` / `TAG_REST` という手書きの走査を 2 つ持ち、`HIGHLIGHT_MAX_LENGTH` の分岐（`surfaces.tsx:311-314`）まで含めてテストしやすい。
- `scrubForSurface`（`surfaces.tsx:231-247`）— B-001 の集合そのものが検査されていない。`node` プロジェクトに DOM が無いので `ParentNode` を渡す形では回らないが、落とす集合（`UNSAFE_PREVIEW_ELEMENTS` / `URL_ATTRIBUTES`）を定数として切り出せば、保存側の `allowList.ts` との包含関係（JSDoc が主張する「保存時のサニタイズの部分集合」）は純関数として突き合わせられる。
- `noteMediaUploadSchema`（`schema.ts:141-148`）の `file.size > 0` と 256 MB 上限、`emptyTrashSchema` / `trashNoteSchema` などの新スキーマの否定ケースが無い。
- `errorDisplay` の辞書が、画面が実際に分類するコード（`editor.tsx:434-450` の `switch`）や `NoteErrorCode` / `StorageErrorCode` / `UsageErrorCode` と結ばれていない。`EDITING_CODES` は人手で維持された文字列の並びなので、ドメイン側のコードが改名されても辞書と一緒に静かに古くなる。列挙を import して突き合わせる形にできる。
- `storage.$.tsx:91-95` の `downloadName`（ヘッダーに置けない文字を落とす唯一の手書き関数）が未検査。

#### カバレッジ

`7-round-005.files` のうち担当分（`apps/web/app/` の 38 ファイル）を全部確認した。差分だけでなく現物を読んだファイルには ✔ を付ける。

- `components/layout/ScopeToken/index.tsx` ✔ / `components/layout/ScopeToken/listing.ts` ✔
- `components/note/NoteBody/index.tsx` ✔
- `components/note/NoteDetail/index.tsx` ✔ / `detail.tsx` ✔ / `menu.tsx` ✔
- `components/note/NoteEditor/index.tsx` ✔ / `editor.tsx` ✔（全 1945 行）/ `frame.tsx` ✔ / `highlight.ts` ✔ / `preferences.ts` ✔ / `skeleton.tsx` ✔ / `surfaces.tsx` ✔ / `textNodes.ts` ✔
- `components/note/NoteList/index.tsx` ✔ / `board.tsx`（差分）
- `components/note/TrashList/index.tsx` ✔ / `action.ts` ✔ / `board.tsx` ✔
- `components/note/schema.ts` ✔ / `components/note/__tests__/schema.test.ts` ✔
- `presentation/errorDisplay.ts`（差分）/ `presentation/__tests__/errorDisplay.test.ts`（差分）/ `presentation/__tests__/errorResponse.test.ts`（差分）
- `routes/notes/-action.tsx` ✔ / `routes/notes/$noteId_.edit.tsx` ✔ / `routes/notes/new.tsx` ✔ / `routes/notes/trash.tsx` ✔
- `routes/storage.$.tsx` ✔ / `routes/__tests__/storage.delivery.test.ts` ✔
- `routes/workspaces/$workspaceId/-action.tsx` ✔ / `notes/$noteId_.edit.tsx` ✔ / `notes/new.tsx` ✔ / `notes/trash.tsx` ✔ / `notes/index.tsx`（差分）
- `routes/workspaces/$workspaceId/settings/-action.tsx`（差分）/ `settings/route.tsx`（差分）
- `routeTree.gen.ts` — 生成物。新しい 6 ルート（`/notes/new`、`/notes/trash`、`/notes/$noteId_/edit` と対応するワークスペース版）が過不足なく載っていることだけ確認した（103-109、163、187-194、223）。**内容のレビューはしていない。**

差分外で判断のために読んだファイル: `packages/core/src/adapters/html/{allowList.ts, css.ts, htmlProcessor.ts}`（B-001 / W-001 / W-009 の裏取り）、`packages/core/src/application/note/view.ts`、`packages/core/src/domain/storage/services/uploadValidationPolicy.ts`、`spec/pages/index.md`、`spec/manual-tests/editing.md`。

スキップしたファイル: なし（`routeTree.gen.ts` は上記のとおり生成物として存在確認のみ）。

補足（指摘に立てるほどではないもの）:

- `editor.tsx:1618-1619` のコメントだけが英語で、同ファイルの他 60 件超はすべて日本語。`spec/manual-tests/editing.md` の TC-08 手順 7 が同じ内容を日本語で持っているので、揃えたい。
- 初回保存が `router.navigate` で `/notes/:noteId/edit` へ置き換わる（`editor.tsx:534-554`）と島が別ルートで再マウントされるため、直後に出ていた「保存済み」と「最終保存 HH:MM」が消える。`savedAt` は state なので引き継げない。ED-08 の状態表示としては 1 拍だけ抜けるが、次の自動保存で戻る。
- `NoteEditor/index.tsx:56-74`（処理中・取り込み失敗）と `76-86`（権限なし）の終端は `spec/manual-tests/editing.md` TC-28 手順 3 / TC-29 の期待どおりで、`spec/pages/index.md#P-12` の状態表とも一致している。
- `spec/pages/index.md:259` の改訂（viewer に表示スタイルを出さない）と実装（`detail.tsx:218` が `canEdit && trashed === null` でメニューごと落とす）は一致している。
- `ScopeToken` の「ゴミ箱」を描く 3 つの loader（`notes/index.tsx:70`、`notes/trash.tsx:66`、`settings/route.tsx:76`）はすべて `canWrite` を渡していることを確認した（TC-32 手順 3）。
