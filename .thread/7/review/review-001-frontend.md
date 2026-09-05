### frontend

#### Blockers

- **[B-001]** 保存後にエディタが「サーバーが持っている本文」を引き直さないため、モードを切り替えると本文が巻き戻り、直後の自動保存がその巻き戻りをサーバーへ書き戻す（データ消失）
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:458`（`applyMode`）、`:304` / `:375`（`settleSaved`）、`:358`（visual 保存後）、`:892`（「保存して切り替える」）
  - 理由: 3 つの現れ方をするが、原因は 1 つ — **`savedBody` が「サーバーに保存された本文」ではない**のに、`applyMode` が `setBaseline(savedBody)` / `setBody(savedBody)` で面を再シードしている。
    1. **「保存して切り替える」（`:892`）は必ず巻き戻る。** `onClick={() => startSaving(async () => { await commit(true); enterMode(pendingMode); })}` の `enterMode` はクリック時のレンダーで作られた閉包であり、その先の `applyMode` が読む `savedBody` は **`commit` が `settleSaved` で更新する前の値**である。したがって `await commit(true)` でサーバーには新しい本文が入るのに、画面は編集前の本文へ戻る。戻った直後は `body(旧) !== savedBody(新)` なので `dirty` が立ち、自動保存の effect（`:409`、`status.kind === "saved"` は除外条件に入っていない）が 1.5 秒後に `commit(false)` を撃って**旧本文をサーバーへ保存し直す**。`spec/manual-tests/editing.md` TC-07 手順 2「保存されてからビジュアルモードで開かれ、同じ本文が表示される」が FAIL する。
    2. **ビジュアルモードで保存したあとの切り替えも巻き戻る。** visual の保存経路（`:344-360`）は `applyTextNodeEdits` を呼ぶだけで `savedBody` / `body` を一切更新しない（`settleSaved(currentTitle, currentBody)` の `currentBody` は編集前の HTML）。保存後に HTML / WYSIWYG へ切り替えると、`applyMode` が編集前の HTML を面に載せ、そこから保存すればテキストノードの編集が消える。
    3. **HTML / WYSIWYG の保存でも `savedBody` はサニタイズ前の生入力である。** `UpdatedNoteBodyView`（`packages/core/src/application/note/view.ts`）は `removed` は返すが保存後の HTML を返さないので、「除去しました」と告げた直後の面には除去対象がそのまま残り、次の保存でまた送られる。
  - 提案: 「保存が終わった時点の正本」を 1 か所に持つ。`commit` の成功時に `readNoteEditStateFn`（既に `-action.tsx:6812` 相当で用意済み）で `title` / `html` / `version` を引き直して `savedTitle` / `savedBody` と `baseline` を更新し（あるいは `updateNoteBody` / `applyTextNodeEdits` の DTO に保存後の HTML を足し）、その値を **ref** にも書く。`applyMode` は state ではなくその ref から面を再シードする（非同期 transition の中から呼ばれる以上、閉包の state は必ず古い）。少なくとも `enterMode(pendingMode)` は `commit` の戻り値を受け取る形にして、古い `savedBody` を読まないようにする。

- **[B-002]** ED-06 のメディア挿入が「本文へのドロップ」と「代替テキストの入力」を備えておらず、対応するマニュアルテストも更新されていない
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:1335-1388`（`MediaButton` / `mediaMarkup`）、`apps/web/app/components/note/NoteEditor/surfaces.tsx`（ドロップハンドラーなし）
  - 理由: `spec/scenario/editing.md:118`（ED-06 手順 1）は「ツールバーから『画像 / 動画を挿入』を選ぶ**か、ファイルを本文にドロップする**」、手順 4 は「画像は代替テキストを入力できる」と定める。実装は `<input type="file">` 経由だけで、`onDrop` / `dragover` は `apps/web/app/components/note/` 配下に 1 つも無く、`mediaMarkup` は `alt` をファイル名で固定して以後編集する導線が無い。結果として `spec/manual-tests/editing.md` の TC-08 手順 3（「代替テキストに `図 1` と入力する」）と TC-25 手順 1（「エディタに BMP 画像をドロップする」）は実行不能で、plan.md の AC-6 / AC-13 を満たさない。本 PR は同ファイルの他の手順（TC-06 / TC-09 / TC-11 / TC-12 / TC-13 / TC-24 / TC-28 / TC-30 / TC-32 / TC-33）を実装に合わせて更新しているので、この 2 件だけ取り残されている。
  - 提案: WYSIWYG 面と HTML 面（`textarea`）に `onDragOver` / `onDrop` を足して `upload(file)` へ流す（複数ファイルは 1 件ずつ）。代替テキストは、挿入後の `img` を選んだときに `alt` を編集できる小さな UI を足すか、挿入直後にプレースホルダーの隣で入力させる。どちらも本スライスで実装できないなら、`spec/scenario/editing.md` と `spec/manual-tests/editing.md` の該当行を先に改訂し、落とした理由を `spec/` 側に残す（stale な手順書は正しい実装を FAIL と判定する、と plan.md 自身が書いている）。

#### Warnings

- **[W-001]** アップロード一覧の `useOptimistic` が同じ要素を二重に積む（重複 key）
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:193`（`useOptimistic(uploads, ...)`）、`:618-619`
  - 理由: `addOptimisticUpload(entry)` の直後に同じ transition の中で `setUploads((list) => [...list, entry])` を呼んでいる。`useOptimistic` は保留中の action を**その時点の passthrough state**へ再適用するので、`uploads` が更新された後の描画では `entry` が 2 回並ぶ。同じ `entry.id` を `key` にしているため React の重複 key 警告が出て、アップロード中は「〜をアップロードしています...」の行が 2 本見える。楽観層は `setUploads` が同期に効く以上そもそも仕事をしていない（三層目は `useTransition` が担っている）。
  - 提案: `useOptimistic` を外して `uploads` をそのまま描くか、`setUploads` を成否が決まるまで遅らせて楽観層だけに任せるかのどちらかに寄せる。

- **[W-002]** 端末に保持したモードを復元するとき「ビジュアル不可」の判定を通していない
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:214-218`
  - 理由: `readPreferredMode()` が `"visual"` を返せば `visualAvailable` を見ずに `setMode("visual")` する。`requestMode` には `if (next === "visual" && !visualAvailable) return;` があるのに、この経路だけ迂回している。編集可能なテキストノードが無い本文（新規保存直後の空ノート、`<style>` だけのノートなど）を開くと、ラジオが disabled のままビジュアル面が表示され、編集欄が 1 つも無い画面になる。ED-05「編集可能なテキストノードがない本文ではビジュアルモードを選択できない」に反する。
  - 提案: 復元も `requestMode` / `enterMode` と同じ判定に通す（`visualAvailable` が確定してから適用する、または `preferred === "visual" && !visualAvailable` のとき `"wysiwyg"` へ落とす）。

- **[W-003]** WYSIWYG モードの保存がすべて `reason: "wysiwygConversion"` になり、版一覧の理由が誤表示になる
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:367`
  - 理由: `reason: mode === "wysiwyg" ? "wysiwygConversion" : "manualEdit"` は「WYSIWYG 面にいるか」で決めており、「WYSIWYG へ変換した保存か」ではない。ED-04 が版を残したいのは変換の 1 回目であって、その後の通常編集ではない。`REVISION_REASON_LABEL`（`:117`）が「WYSIWYG への変換」と描くので、TC-11 手順 2「作成者・日時・理由・抜粋つきで並ぶ」の理由列が全行同じ嘘になる。
  - 提案: 変換直後の最初の 1 回だけ `wysiwygConversion` を送る（`applyMode("wysiwyg")` でフラグを立て、`commit` 成功で下ろす）。

- **[W-004]** HTML モードのプレビューが未サニタイズの本文を live DOM に流し込む。コードのコメントが根拠に挙げる CSP は、実際にはインラインイベントハンドラーを止めていない
  - 場所: `apps/web/app/components/note/NoteEditor/surfaces.tsx:217-225`
  - 理由: `<NoteBody html={repaired ?? value} />` は `shadowRoot.innerHTML = ...` で描画するため、`<img onerror=...>` のような属性は実行される（Shadow DOM が隔離するのはスタイルだけで、コメント自身がそう書いている）。同じコメントは「実際の安全は保存時のサニタイズと CSP が担う」と続けるが、`apps/web/app/server.node.ts:75` の CSP は `frame-ancestors / form-action / object-src / base-uri` だけで **`script-src` を持たない**ので、この経路は現実に同一オリジンでスクリプトを走らせられる。攻撃としては自己 XSS（「この HTML を貼り付けてください」型の誘導）に限られるが、コメントの根拠が事実と食い違っている点は残る。
  - 提案: プレビューを `sandbox` 付き `iframe` に載せるか、クライアント側でも `on*` 属性と `<script>` を落としてから描く。少なくとも、CSP に `script-src` が無い現状を踏まえてコメントの根拠を書き直す。

- **[W-005]** `applyTextNodeEditsSchema` の DoS 上限が転送境界の役割を果たしていない
  - 場所: `apps/web/app/components/note/schema.ts:65-73`
  - 理由: `edits` は最大 20,000 件、各要素の `expected` / `text` はそれぞれ 800,000 文字。理論上の最大は 32 GB 相当で、Zod は本文を全部読んでから検証する。CLAUDE.md「Input validation」が転送境界に求めているのは形と **DoS 上限**なので、ここは実質的な上限になっていない。1 本文のテキストノード総量は本文の上限（サニタイズ後 800 KB）を超えないという不変条件が使える。
  - 提案: 個々の `text` / `expected` を現実的な長さ（例: 64 KB）に絞るか、`superRefine` で合計長を 800 KB で頭打ちにする。

- **[W-006]** `/notes/new`（個人文脈）に取り込み先セレクターが無い
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:700-716`（「取り込み先」の表示）
  - 理由: `spec/pages/index.md#P-12` は「新規作成時は WYSIWYG モードで開き、**取り込み先セレクターを表示する**」と定めるが、実装は「個人」/「このワークスペース」を読み取り専用のバッジで示すだけで、個人文脈から所属ワークスペースへ切り替える手段が無い。`createNoteWithBodySchema` は `workspaceId` を nullable で受けられるので、サーバー側の受け口は既にある。`spec/inventory/frontend.md:64`（PAGE-p12-002）は「current owner に private blank note を作り」としか書いていないため、どちらの読みも成り立つ。
  - 提案: `NoteMovePicker` と同じ選択 UI を初回保存前だけ出すか、`spec/pages/index.md#P-12` の「取り込み先セレクター」を「現在の文脈の表示」へ改訂して食い違いを消す。

- **[W-007]** ビジュアルモードの「構造は変えられない」案内が実装されておらず、TC-15 手順 1 が判定できない
  - 場所: `apps/web/app/components/note/NoteEditor/surfaces.tsx:241`（`VisualSurface`）
  - 理由: `contenteditable="plaintext-only"` の span に閉じることで**要素の追加・削除は構造的に不可能**になっており、そこは設計として正しい。ただし `spec/manual-tests/editing.md` TC-15 手順 1 の期待結果は「追加されず、**テキストの書き換えのみ行えることが案内される**」で、案内に当たる UI（面の上の説明文など）が無い。本 PR は同ファイルの他の手順を実装に合わせて改訂しているので、ここだけ手順書と実装が離れている。
  - 提案: ビジュアル面の上に 1 行の説明を出すか、TC-15 手順 1 の期待結果を「追加されない」だけに改訂する。

- **[W-008]** 「ゴミ箱を空にする」が 51 件以上のときに処理履歴への導線を出せていない
  - 場所: `apps/web/app/components/note/TrashList/board.tsx:191-195`
  - 理由: `spec/pages/index.md#P-14` は「削除を予約」状態に「処理履歴（P-15）への導線を出す」と書き、`spec/manual-tests/editing.md` TC-13 手順 7 は「手順 5 の導線から `/jobs` を開く」と要求する。実装の Alert は「処理の進みは処理履歴で確認できます」と文言で触れるだけで、`emptyTrash` が返す `jobIds` も捨てている。P-15 は Issue #5 の持ち分（plan.md「含まれないもの」/ ADR-002）なのでルートが無いこと自体は妥当だが、TC-13 手順 7 は現状 FAIL する。
  - 提案: `spec/manual-tests/editing.md` TC-13 手順 7 に「P-15 は Issue #5 で入るため本スライスでは導線を確認しない」と読み替えを明記する（TC-13 の「確認ポイント」に既に読み替えの前例がある）。

- **[W-009]** `downloadBody` がタイトルを未エスケープで `<title>` に埋めている
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:1394-1405`
  - 理由: `` `<!doctype html><meta charset="utf-8"><title>${title}</title>${html}` `` の `title` は入力欄の生値で、`</title><script>` を含めれば出力ファイルの構造を壊せる。権限喪失時の退避経路であり自分の端末に落ちるだけなので実害は小さいが、同じファイル内の `escapeText` / `escapeAttribute` を使っていないのは一貫性の欠落でもある。
  - 提案: `escapeText(title)` を通す。

- **[W-010]** （既存の問題、本 PR の変更起因ではない）`spec/pages/index.md#P-11` の「viewer に残るのは『ダウンロード』と表示スタイルのみ」と `spec/scenario/editing.md#ED-11` の「権限のない利用者には切り替え操作を出さず、表示のみとする」が食い違っている
  - 場所: `spec/pages/index.md:259`、`spec/scenario/editing.md`（ED-11 異常系の最終行）
  - 理由: 実装（`apps/web/app/components/note/NoteDetail/detail.tsx:222-223`）は `canEdit` が false ならメニューごと出さない ED-11 側に従っており、判断としては妥当。ただし P-11 の記述は viewer にも表示スタイルが残ると読めるため、どちらが正典か読み手に決められない。
  - 提案: 本 PR で ED-11 に寄せた以上、`spec/pages/index.md#P-11` の当該行を「viewer に残るのはダウンロードのみ（表示スタイルの切替は編集権限が要る）」へ改訂する。

#### テスト保証

- `renderErrorMessage が P-12 / P-14 の到達コード全件に固有文言を持つ（presentation/errorDisplay.ts:MESSAGE_BY_CODE）` — 守っているテスト: `apps/web/app/presentation/__tests__/errorDisplay.test.ts:"has a dictionary entry for every editing / trash code the slice reaches"`（既定文言との**不一致**で見るので、辞書から 1 行落とせば落ちる＝検出力あり）
- `NOTE_LOCKED_BY_JOB が「再試行」ではなく「待つ」を案内する（errorDisplay.ts）` — 守っているテスト: `errorDisplay.test.ts:"tells the reader to wait rather than retry while a job holds the note"`
- `STORAGE_* の共通コードがアイコンと本文メディアの両方の条件を述べる（errorDisplay.ts）` — 守っているテスト: `errorDisplay.test.ts:"names both upload purposes in the shared storage codes"`
- `編集・ゴミ箱の新コードが kind 既定の HTTP ステータスから外れない（presentation/errorResponse.ts:httpStatusFor）` — 守っているテスト: `apps/web/app/presentation/__tests__/errorResponse.test.ts:"keeps the editing and trash codes on their kind mapping"`（例外表に足したら落ちる＝ピンとして有効）
- `競合が 409 で届く（httpStatusFor / conflict）` — 守っているテスト: 同上（`OPTIMISTIC_LOCK_FAILURE` の行）
- `ビジュアルモードの経路採番がアダプターの resolveTextNode と一致する（NoteEditor/textNodes.ts:collectEditableTextNodes ↔ adapters/html/htmlProcessor.ts:resolveTextNode）` — 守られていない（フロント側に純関数テストが無い。`docs/test.md`「Frontend: the bare minimum」の範囲では書かないと決めているが、`textNodes.ts` は DOM 走査の純ロジックで、ずれると ED-02 が全件 `pathNotFound` に落ちる唯一の箇所。目視では `childNodes` の数え方・`style`/`script` の除外・SVG 例外が両側で一致していることを確認した）
- `保存後にモードを切り替えても本文が巻き戻らない（NoteEditor/editor.tsx:applyMode）` — 守られていない → [B-001]
- `ビジュアルモードで保存した編集が、その後の保存で消えない（NoteEditor/editor.tsx:commit）` — 守られていない → [B-001]
- `メディアをドロップで挿入できる / 代替テキストを入力できる（NoteEditor/editor.tsx:MediaButton）` — 守られていない → [B-002]
- `アップロード中の一覧が同じ要素を 1 度だけ描く（NoteEditor/editor.tsx:optimisticUploads）` — 守られていない → [W-001]
- `一覧からの削除・復元を一覧の島が所有する（NoteList/board.tsx:NoteListBoard）` — 守られていない（コンポーネントテストは方針上書かない）が、`useOptimistic(rows, withoutNote)` と server function が親にあり、失敗時は `setError` して transition 終了で行が戻る形になっていることを目視で確認した
- `ゴミ箱の復元・完全削除・空にするを一覧の島が所有する（TrashList/board.tsx:TrashBoard）` — 同上。`scheduled` のときだけ行を消さない分岐（P-14 状態表）も確認した
- `版（version）の所有者が画面ごとに 1 つである（NoteDetail/detail.tsx:versionRef、NoteEditor/editor.tsx:versionRef）` — 同上。詳細側はタイトル自動保存・表示スタイル・ゴミ箱移動が同じ `versionRef` を通り、メニュー（`menu.tsx`）は版を要する操作を自分で実行していないことを確認した
- `ConflictError を握り潰さない（NoteEditor/editor.tsx:classify）` — 同上。`OPTIMISTIC_LOCK_FAILURE` は `{kind:"conflict"}` へ写り、上書き / 破棄の両枝がどちらも `readNoteEditStateFn` で最新版を引き直してから進む
- `P-12 の状態表が全状態到達可能（NoteEditor/editor.tsx:SaveStatus ほか）` — 同上。新規（未保存）/ 読み込み中（`skeleton.tsx`）/ 編集中 / 保存中・保存済み・未保存 / 保存失敗 / 復元の提案 / WYSIWYG 警告 / サニタイズ通知 / 競合 / 処理中で編集できない / 権限喪失 / メディアアップロード中・失敗 / ビジュアル不可 の 13 状態すべてに到達経路があることを確認した
- `P-14 の状態表が全状態到達可能（TrashList/index.tsx, board.tsx）` — 同上。読み込み中 / 一覧 / 空 / エラー / 操作確認 / 操作実行中 / 完全削除の完了 / 削除を予約 / 権限なし をすべて確認した
- `転送境界で入力を検証している（components/note/schema.ts + routes/notes/-action.tsx）` — 守られていない（純関数テストなし）が、新規 12 本の server function すべてが `.validator(validateInput(schema))` を通り、`serverData` には検証済みの値しか渡っていないことを目視で確認した。上限の緩さは [W-005]

#### カバレッジ

- 確認: `apps/web/app/components/layout/ScopeToken/index.tsx`, `apps/web/app/components/layout/ScopeToken/listing.ts`, `apps/web/app/components/note/NoteDetail/detail.tsx`, `apps/web/app/components/note/NoteDetail/index.tsx`, `apps/web/app/components/note/NoteDetail/menu.tsx`, `apps/web/app/components/note/NoteEditor/editor.tsx`, `apps/web/app/components/note/NoteEditor/frame.tsx`, `apps/web/app/components/note/NoteEditor/highlight.ts`, `apps/web/app/components/note/NoteEditor/index.tsx`, `apps/web/app/components/note/NoteEditor/preferences.ts`, `apps/web/app/components/note/NoteEditor/skeleton.tsx`, `apps/web/app/components/note/NoteEditor/surfaces.tsx`, `apps/web/app/components/note/NoteEditor/textNodes.ts`, `apps/web/app/components/note/NoteList/board.tsx`, `apps/web/app/components/note/NoteList/index.tsx`, `apps/web/app/components/note/TrashList/action.ts`, `apps/web/app/components/note/TrashList/board.tsx`, `apps/web/app/components/note/TrashList/index.tsx`, `apps/web/app/components/note/schema.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/presentation/__tests__/errorDisplay.test.ts`, `apps/web/app/presentation/__tests__/errorResponse.test.ts`, `apps/web/app/routes/notes/$noteId_.edit.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/new.tsx`, `apps/web/app/routes/notes/trash.tsx`, `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/$noteId_.edit.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/new.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/trash.tsx`, `spec/manual-tests/editing.md`, `spec/presentation/index.md`
- 差分外で参照: `apps/web/app/components/note/NoteBody/index.tsx`, `apps/web/app/components/ui/Alert/index.tsx`, `apps/web/app/components/settings/panelStyles.ts`, `apps/web/app/presentation/serverFragment.tsx`, `apps/web/app/server.node.ts`, `apps/web/app/styles/tokens.css`, `packages/core/src/application/note/view.ts`, `packages/core/src/application/note/getNote.ts`, `packages/core/src/application/note/restoreNote.ts`, `packages/core/src/application/note/emptyTrash.ts`, `packages/core/src/application/storage/view.ts`, `packages/core/src/adapters/html/htmlProcessor.ts`, `packages/core/src/domain/note/services/noteAccessPolicy.ts`, `spec/pages/index.md`, `spec/scenario/editing.md`, `spec/inventory/frontend.md`, `docs/frontend_implementation_example.md`
- スキップ: `apps/web/app/routeTree.gen.ts` — 生成物。新規 6 ルートが登録されていることだけ確認し、内容はレビューしない
- スキップ: `packages/core/**`（78 ファイル） — ドメイン / ユースケース / アダプター層で他レビュアーの担当。フロントの契約突き合わせに必要な DTO・ユースケース・ポリシーだけ上記のとおり読んだ
- スキップ: `spec/domains/note.md`, `spec/domains/storage.md`, `spec/usecases/note.md`, `spec/usecases/storage.md`, `spec/inventory/usecase.md` — バックエンド側の設計ドキュメント（ED-06 / ED-11 の突き合わせに必要な範囲のみ参照）
- スキップ: `pnpm-lock.yaml`, `packages/core/package.json` — 依存追加（`parse5`）はアダプター層の担当
- スキップ: `.thread/7/*` — 作業ログで正典ではない
