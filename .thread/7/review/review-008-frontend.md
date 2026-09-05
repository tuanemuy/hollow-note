# レビュー 008 — frontend

### frontend

#### Blockers

**[B-001] `apps/web/app/components/note/NoteEditor/editor.tsx:547-574` `classify` — 決定的な業務拒否の集合が閉じておらず、答えの変わらない失敗に「再試行」と端末退避を出す**

本ラウンドで `spec/pages/index.md:317` に「保存できません（内容の拒否）」の行が入り、決定的な拒否は**再試行のボタンも端末への退避も出さない**と定めた。`classify` の `rejected` 枝（564-568）はその集合を 4 つ（`NOTE_CONTENT_TOO_LARGE` / `NOTE_INVALID_TITLE` / `NOTE_INVALID_STYLE_MODE` / `INVALID_INPUT`）に固定しているが、この画面が実際に受け取る決定的な拒否はそれで尽きていない。

- **`NOTE_HTML_TOO_COMPLEX`** — `updateNoteBody` は本文を必ず `htmlProcessor.process()` に通し（`packages/core/src/application/note/updateNoteBody.ts:82`）、資源メーターの上限超過は `adapters/html/htmlProcessor.ts:784,823` が `HTML_PROCESSOR_TOO_COMPLEX`（= `NoteErrorCode.HtmlTooComplex`）で投げる。したがって HTML モードに深い入れ子の本文を貼れば `default` 枝に落ち、`{ kind: "failed" }` になる。
- **`REVISION_NOT_FOUND`** — `restore()`（1330-1361）の `catch` も同じ `classify` を通る。保持 20 版から溢れた版を復元しようとした結果は `notFound` で、再送しても永久に同じ答えである。
- **`NOTE_CANNOT_CAPTURE_EMPTY_CONTENT`** — `application/note/applyTextNodeEdits.ts:29-33` が投げる。

結果として、
1. `失敗` Alert（1725-1772）が **成功しえない「再試行」ボタン**を出す、
2. `commit` の `catch`（794-801）が **800 KB まで許される本文を `localStorage` へ書く**（`rejected` 枝を作った理由がまさにこれ。174-179 の JSDoc）、
3. 文言が「内容はこの端末に退避したので、次に開いたときに復元できます。」になり、直せば通ることを伝えない、

の 3 つが同時に起きる。`presentation/errorDisplay.ts:97-102` は `NOTE_HTML_TOO_COMPLEX` について「同じ本文を送れば必ず同じ結果になる」「共通文言は実行不能な助言になる」と明記し、`presentation/__tests__/errorDisplay.test.ts:137-146` がその文言を固定しているのに、その文言を包む Alert のほうが「もう一度お試しください」の枠で出ている。辞書とその外側の枠が同じエラーについて逆のことを言っている。

`classify` を「拒否コードの列挙」ではなく `spec/pages/index.md:317` の集合と 1 対 1 に対応させるか、少なくとも上記 3 コードを `rejected` へ寄せること。あわせて `spec/pages/index.md:317` の括弧内の列挙（「本文の上限超え・タイトルの上限超え・表示スタイルの不正・転送境界の形の違反」）にも `NOTE_HTML_TOO_COMPLEX` が漏れているので、canon 側も同時に直す。

**[B-002] `apps/web/app/components/note/NoteEditor/editor.tsx:1043` — コードから `.thread/7/adr.md` の ADR 番号を引いている**

```
    // 取りこぼさない側へ倒す判断で、ADR-104 の走査側と向きを揃えてある。
```

`ADR-104` は `.thread/7/adr.md:2591` にしか存在しない。`spec/adr/` は `065-conditional-write-tool-and-guard-loss.md` までで、104 番は canon に無い。`CLAUDE.md` の「`.thread/{number}/` は canon ではない」節は **「Never cite it from code, `spec/`, or `docs/`: its ADR numbering collides with `spec/adr/`, and the link dies when the issue closes」** と明示的に禁じている。Issue #7 が閉じればこの参照は宙に浮き、しかも読み手は `spec/adr/104` を探しに行く（存在しないか、将来別の決定に割り当てられる）。

理由そのものをその場に書くこと。`NoteEditor/index.tsx:142-147` の `hasStyleElement` は同じ判断を ADR 番号なしで書けているので、そこを指すか同趣旨を 1 行で置けばよい。なお `apps/web/app/` 全体でこの 1 か所だけが該当し、他の ADR 参照（007 / 013 / 029 / 032 / 037）はすべて `spec/adr/` に実在する。

#### Warnings

**[W-001] `apps/web/app/components/note/NoteEditor/editor.tsx:2078-2085` — 面ごと凍っている状態でも版の「復元」だけが押せる**

各版の復元ボタンは `disabled={busy}` だけで、`editable`（= `locked` / `blocked` でない）を見ていない。同じファイルの「破棄」（1585-1592）は `disabled={!dirty || busy || !editable}` にしたうえで、

```
{/* 破棄も版を進めうる往復（正本の引き直し）なので、面ごと凍って
    いるあいだは落とす。押せると、権限を失ったノートで唯一操作
    できるボタンとして残ってしまう。 */}
```

と理由まで書いている。版の復元は破棄よりさらに強い「版を進める往復」（`runExclusive({kind:"restoring"})`）なので、同じ判断が要る。権限を失った（`blocked`）ノートでも「版を復元」（2105-2113 も `noteId === null || isSideBusy` のみ）→ 各行の「復元」が押せてしまい、サーバーの拒否で `blocked` に戻るだけの空振りになる。`spec/manual-tests/editing.md` TC-24 手順 4 は「本文・タイトル・メディア挿入・モード切替はいずれも操作できない」と 4 つしか数えていないので、手動テストでも落ちない。

**[W-002] `apps/web/app/components/note/NoteEditor/editor.tsx:1614-1646` / `1804-1817` — 退避の復元が立てた ED-04 の門を「了解して進む」で抜けると、いま復元した未保存の内容が正本で置き換わる**

門そのものに素通りする経路は無い（下の「カバレッジ」参照）。問題は門を**了解したあと**である。退避の復元は

```
switchMode(surfaceModeFor(mode, draftOffer.html, false));
loadSurface(draftOffer.title, draftOffer.html);
setStatus({ kind: "dirty" });
```

なので、門に掛かると面は HTML へ倒れ、`pendingMode = "wysiwyg"` / `wysiwygWarning = true` のまま**未保存の退避内容が面に載っている**状態になる。ここで「了解して進む」は `applyMode("wysiwyg", true)`（1814）で、既存ノートなら必ず `reseedFromServer` → `readEditState` → `seedMode(…, latest.title, latest.html)` を通る（1133-1153）。つまり復元したばかりの本文はサーバーの正本で丸ごと置き換わる。

他の 3 経路（版の復元・競合の解決・保存後）はいずれも「面に未保存の内容が無い」ことが前提なので `applyMode` の引き直しが正しく、退避の復元だけが `dirty` のまま門へ入る唯一の経路である。実際に到達するのは「HTML モードで `<style>` を書く → 通信断で退避 → 再読み込み（`<style>` を持たない保存済み本文なので WYSIWYG で開く）→ 復元」。1.5 秒の自動保存が先に通れば救われるし、`clearDraft` を呼んでいないので `[noteId, confirmed.body]` の effect が提案を出し直す（485-491）ため恒久的な喪失ではないが、利用者から見ると「復元した内容が了解と同時に消えて、また復元を勧められる」挙動になる。`requestMode` が `dirty` のときに `pendingMode` の確認を挟んでいるのと同じ扱い（保存してから切り替える／未保存を面に残したまま面だけ差し替える）をここにも通すこと。

**[W-003] `apps/web/app/components/note/NoteEditor/editor.tsx:1160-1168` `switchMode` — 門の逃げ先（強制された `html`）まで端末の既定モードとして書き込む**

`switchMode` は無条件に `writePreferredMode(next)` を呼ぶ。`surfaceModeFor`（1061-1070）が門に掛かって返す `"html"` もこの経路を通るので、`reseedFromServer`（1146）・`resolveConflict`（1297 / 1306）・退避の復元（1639）で門が立つたびに、利用者が選んでいない `html` が端末の既定として保存される。たとえば WYSIWYG で作業中に `<style>` を持つ版を復元すると、以後どのノートを開いても既定が HTML になる。

ED-05 / `spec/pages/index.md:295` は「**選んだ**モードは利用者の端末に保持し、次に既存ノートの編集を開くときの既定にする」であって、門の逃げ先は選択ではない。`switchMode` から永続化を分け、利用者の操作（モードのラジオ・「了解して進む」）に由来する切替だけが書くようにするのが素直。

**[W-004] `apps/web/app/components/note/NoteEditor/editor.tsx:872-896` / `apps/web/app/components/note/NoteEditor/surfaces.tsx:333-338` — 「保存後の載せ直し」を門の 4 経路の 1 つと書いているが、その経路で門は原理的に立たない**

`reseedIfUnchanged` の JSDoc は「モードは変わらないが、引き直した正本が面に無い `<style>` を持っていれば装飾はここで落ちる（`needsWysiwygWarning`）」と書き、`surfaces.tsx:337-338` も「保存後の載せ直しを含む」と数えている。しかし呼び出しは 2 か所しかなく、どちらも**ビジュアルモード限定**である。

- 739: `if (sent.visual?.pathwise)` の中。`takeSnapshot`（620-641）が `visual` を非 `null` にするのは `mode === "visual"` のときだけ
- 761: `if (mode !== "visual" || !(await reseedIfUnchanged(sent)))` — 明示的に visual 限定

`needsWysiwygWarning` は `next !== "wysiwyg"` で即 `false` を返すので、`reseedIfUnchanged` 経由で門が立つことはない。WYSIWYG / HTML モードの保存後には載せ直し自体が起きない（意図どおり — caret を飛ばさないため）。門に穴があるわけではないが、コメントが実在しない経路を数えているので、次に読む人が「ここも守られている」と誤読する。実際に門を通る 3 経路（版の復元・競合の解決の 2 枝・退避の復元）に書き直すこと。

**[W-005] `apps/web/app/components/note/NoteEditor/editor.tsx:1725-1762` — `failed` の「再試行」が、失敗した往復ではなく常に本文の保存を実行する**

`classify` は保存・モード切替（`applyMode` 1109）・競合の解決（`resolveConflict` 1275）・版の復元（`restore` 1356）の 4 つの `catch` で共有されている。一方、`failed` Alert の「再試行」は無条件に `runExclusive({kind:"saving"}, () => commit(true))`（1757）である。版の復元が通信エラーで落ちたあと「再試行」を押すと、復元ではなく本文の保存が走る。1736-1739 のコメントは「モード切替・競合の解決・版の復元が通信エラーで落ちたときは退避が無いまま `failed` になる — そこは既存のノートなので、再試行こそが逃げ道である」と書いているが、その「再試行」が指す操作が失敗した操作と一致していない。`SaveStatus.failed` に「何が落ちたか」を持たせるか、保存以外の往復は専用の状態で提示すること。

**[W-006] `spec/pages/index.md:319` — WYSIWYG 警告の「きっかけ」が本ラウンドの門の拡張に追随していない**

状態表の行はいまも `WYSIWYG 警告 | WYSIWYG へ切り替え（了解 / 取りやめ）` で、きっかけをモード切替に限っている。実装は本ラウンドで「面へ載る本文と面が持つ本文の差」を問う形へ変わり、モードを変えない載せ直し（版の復元 / 競合の解決 / 退避の復元）でも警告が立つ（`editor.tsx:1009-1048` の JSDoc、`surfaces.tsx:321-344`）。`spec/manual-tests/editing.md` TC-06 手順 7 / 9 は新しい挙動を書いているのに、ページの正典だけが古い。`CLAUDE.md` は `spec/` を「what is written there is meant to be true of the code」と定めているので、状態表側も直すこと。

**[W-007] `spec/manual-tests/editing.md:222`（TC-13 手順 7）— 本スライスでは実行できない手順のまま**

手順 7 は「手順 5 に示された処理の ID から処理履歴（P-15）を開く」だが、P-15 は本スライスの外で、`components/note/TrashList/board.tsx:39-51` の JSDoc も「処理履歴（P-15）はまだ無いので導線は張れない」と明言している（実装は ID を文字列として出すだけ）。AC-13 は TC-04〜TC-34 の PASS を求めるので、このままでは手順 7 が必ず FAIL する。224 行の**確認ポイント**は 500 件分割の観測不能性しか読み替えを与えていない。P-15 未実装を前提とした読み替え（「示された ID が `emptyTrash` の応答と一致することを確認する」等）を確認ポイントに足すこと。`spec/pages/index.md:365` の「登録した処理の ID を示して処理履歴（P-15）への導線を出す」は ADR 039 の趣旨で残してよいが、手順書側は実行可能でなければならない。

#### テスト保証

対象は `presentation/` と `components/note/__tests__/` の純関数テスト（`docs/test.md`「Frontend: the bare minimum」）。

- `presentation/__tests__/errorDisplay.test.ts` — 本スライスが到達する 12 コードが辞書に載っていること（119-125）を「kind の共通文言と異なる」形で押さえており、辞書に足し忘れると落ちる。`NOTE_LOCKED_BY_JOB` / `NOTE_HTML_TOO_COMPLEX` は文言の性質（「待って」を含む・「もう一度お試しください」を含まない）まで固定していて実効性が高い。`OPTIMISTIC_LOCK_FAILURE` をこの形の判定から外した理由もコメントで明示されている。生メッセージ非漏洩（52-67）と `Object.prototype` 由来キー（69-82）も維持。
  - ただし **B-001 はこのテストでは落ちない**。辞書の文言は正しく、誤っているのは `editor.tsx` の `classify` 側（純関数だが `NoteEditorIsland` の内側に閉じているので現状テストできない形）である。`classify` の写像を `SaveStatus` を返すモジュールスコープの純関数へ出せば、`spec/pages/index.md:317` の集合との一致をここと同じ形で固定できる。
- `presentation/__tests__/errorResponse.test.ts:56-72` — P-12 / P-14 の新コードが「例外表に入っていないこと」を積極的に固定している（否定の性質をテストにした点がよい）。`conflict` が 409 で届くことも押さえてあり、`classify` の `OPTIMISTIC_LOCK_FAILURE` 分岐の前提が守られる。
- `components/note/__tests__/schema.test.ts:101-129` — 転送上限（2 MB）とドメインの 800 KB を**別の数にしてある理由**を、実際に `createHtmlProcessor()` を通して `NOTE_CONTENT_TOO_LARGE` が返ることまで確かめている。両側突き合わせとして効いている数少ないテスト。`createNoteWithBodySchema` にも同じ上限が掛かることを 87-99 で押さえたのも正しい（初回保存だけ緩い、を防ぐ）。
- `routes/__tests__/storage.delivery.test.ts:106-136` — `PUBLICLY_SERVED_PURPOSES` を「restated rather than read from the route」で二重化し、補集合を `FILE_PURPOSES` から導いている。purpose が増えたときに 404 側が自動で覆われる形になっており、意図どおり。

不足（新規のコンポーネントテストが無いこと自体は指摘対象外）:

- `NoteEditor/textNodes.ts`（`collectEditableTextNodes` / `hasEditableTextNode` / `diffTextNodeEdits`）と `NoteEditor/highlight.ts`（`tokenizeHtml`）は DOM を要するが**純関数**で、`components/note/__tests__/` の例外枠に収まる。とくに前者は「アダプターの `resolveTextNode` と経路が一致しないと編集が全件 `pathNotFound` に落ちる」（`textNodes.ts:8-9`）という壊れ方をするのに、一致を固定するテストがどちらの側にも無い。`packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts` と同じ入力表を両側から通す形が、この PR でいちばん費用対効果が高い追加になる。
- `NoteEditor/surfaces.tsx` の `willDropStyleElements` と `NoteEditor/index.tsx` の `hasStyleElement` は **or で使う前提**（`surfaces.tsx:349-352`）だが、走査側が取りこぼさない側へ倒れていること（`<style` を含む文字列で必ず `true`）を固定するものが無い。ED-04 の門の材料なので、片方が緩むと装飾が警告なしに落ちる。

#### カバレッジ

**ED-04 の門（本ラウンドの焦点）— 素通りする経路は見つからなかった。**

`setMode` を動かすのは `switchMode` だけ（1160-1168）で、その呼び出しは 3 か所、面へ本文を載せる `loadSurface` の呼び出しは 4 か所。全経路が `needsWysiwygWarning` / `surfaceModeFor` を通ることを確認した。

| 面へ本文が入る経路 | 門 | 材料 |
|---|---|---|
| 開いた直後の既定（`initialMode`） | 347-348 で `mayLoseDecoration` なら WYSIWYG に入らない | サーバー側 `hasStyleElement` ∨ `sourceFileId` ∨ `styleMode` |
| 端末の既定モードの復元（effect 453-473） | 466 `needsWysiwygWarning` | `confirmedRef.current.body` |
| モードのラジオ（`requestMode` → `enterMode`） | 1075 | `confirmedRef.current.body` |
| 正本の引き直し（`reseedFromServer`） | 1146 `surfaceModeFor` | `latest.html` |
| 版の復元（`restore` → `reseedFromServer(mode, false)`） | 同上（`acknowledged` を立てない、1351） | `latest.html` |
| 破棄（`discard` → `applyMode(mode)` → `reseedFromServer`） | 同上 | `latest.html` |
| 競合の解決・破棄（1305） | `surfaceModeFor(mode, latest.html, false)` | `latest.html` |
| 競合の解決・上書き（1295） | `surfaceModeFor(mode, local.body, false)` | `local.body`（面から取った写しなので恒に不成立 — 正しい） |
| 退避の復元（1639） | `surfaceModeFor(mode, draftOffer.html, false)` | `draftOffer.html` |
| 保存後の載せ直し（`reseedIfUnchanged`） | visual 限定で到達しない → W-004 |

競合の解決・上書きの `reseed(latest.title, latest.html)` → `loadSurface(local.title, local.body)` の 2 連（1296-1298）は、`latest.html` が一瞬 `baseline` に入る形に見えるが、React 19 の自動バッチングで `await` 後の連続更新も 1 回の描画に畳まれるため `WysiwygSurface` の effect は `local.body` しか見ない。門を通さない `latest.html` が面に載ることはない。

**その他の確認範囲**

- **契約の両側突き合わせ** — `routes/notes/-action.tsx` の 12 本と `application/note/view.ts` / `application/storage/view.ts` の DTO を照合。`UpdatedNoteBodyView.removed`（`RemovedNodeView{kind,name,reason}`）↔ `RemovedEntry`、`AppliedTextNodeEditsView.skipped[].path`、`RenamedNoteView.title/version`、`NoteStyleModeView.styleMode/version`、`TrashedNoteView.version`、`RestoredNoteView.version`、`EmptyTrashView{mode,purgedCount,jobIds}`、`StoredMediaView{url,mimeType,size}`、`NoteRevisionView{createdAt,createdByName,reason,excerpt}`、`TrashedNoteListItemView{version,trashedAt,purgeAfter}` すべて一致。`REVISION_REASON_LABEL` を `Record<RevisionReason,string>` で受けているので理由が増えれば型で落ちる。
- **転送境界** — `components/note/schema.ts` の 11 スキーマはすべて `validateInput` 経由で server function に付いている。`storeNoteMediaFn` の FormData→schema の手組みバリデーター（337-342）も `File` 実体と `noteId` を両方通す。`serverData`（`TrashList/action.ts`）には外部入力を流していない。
- **性質** — 面に入る未保存本文は 3 面とも `scrubForSurface`（`on*` 剥がし・`javascript:` URL・script 相当の除去）を通っており、WYSIWYG だけ `dropStyleElements` が追加で走る。挿入マークアップは `escapeAttribute` / `escapeText` で組み、`createLink` は `isSafeLinkUrl`（制御文字・空白を落としてからスキーム判定）で絞っている。`String.replace` の置換値は関数で渡しており（1421）`$&` / `$'` 注入は塞がっている。`ScopeToken` のゴミ箱導線は `canWrite === true` のときだけ描き、`canWrite` を渡す 3 ルート（notes / trash / settings）すべてで `WorkspaceRole.atLeast(role, "editor")` から導いている。`TrashList` は viewer に一覧そのものを出さない。`/storage/$` は `PUBLICLY_SERVED_PURPOSES` + `nosniff` + `sandbox; default-src 'none'` で閉じている。
- **再レンダー・往復** — 版を進める往復は `runExclusive` の 1 本に直列化され、版を進めない往復（メディア保管・版一覧）は `startSide` で並行を許している。自動保存は `busy` で待ち、`failed` / `conflict` / `rejected` からは自力で再開しない。初回保存の URL 置換は `dirty` と `busy` が下りてから、かつ `selfNavigateRef` で自分の blocker を素通りさせる形になっており、往復中の打鍵が新しい画面で消える窓は塞がれている。
- **ドキュメント整合** — `spec/pages/index.md` の P-12 状態表（新規 / 読み込み中 / 保存中・保存済み・未保存 / 保存失敗 / 保存できません / 復元の提案 / WYSIWYG 警告 / サニタイズ通知 / 競合 / 処理中 / 権限喪失 / メディア / ビジュアル不可）は W-006 を除いて実装と対応。P-14 の状態も `TrashBoard` に揃っている（`purged` / `scheduled` の文言分けを含む）。`spec/pages/index.md:298` の取り込み先セレクターは triage 済み（ラウンド 001 [W-006] defer、#1 の持ち分）なので再掲しない。
- **既出判定** — `triage-keys.md` の `[W-010] NoteList/board.tsx:canMove`（wont-fix）、`[W-008] ScopeToken/listing.ts:canWrite`（wont-fix）、`[W-003] routes/storage.$.tsx:GET`（defer）、`[W-006] NoteEditor/editor.tsx`（defer）、`[W-007] spec/pages/index.md:298`（wont-fix）、`[W-008] spec/pages/index.md:361`（wont-fix）はいずれも新事実が無いので再掲していない。
- **記述の衛生** — `apps/web/app/` に `.thread/` へのパス参照は無い。ADR 番号の参照は B-002 の 1 件を除き `spec/adr/` に実在する（007 / 013 / 029 / 032 / 037）。

**確認したファイル**（担当分は全量）: `apps/web/app/components/layout/ScopeToken/{index.tsx,listing.ts}` / `apps/web/app/components/note/NoteBody/index.tsx` / `apps/web/app/components/note/NoteDetail/{detail.tsx,index.tsx,menu.tsx}` / `apps/web/app/components/note/NoteEditor/{editor.tsx,frame.tsx,highlight.ts,index.tsx,preferences.ts,skeleton.tsx,surfaces.tsx,textNodes.ts}` / `apps/web/app/components/note/NoteList/{board.tsx,index.tsx}` / `apps/web/app/components/note/TrashList/{action.ts,board.tsx,index.tsx}` / `apps/web/app/components/note/schema.ts` / `apps/web/app/components/note/__tests__/schema.test.ts` / `apps/web/app/presentation/errorDisplay.ts` / `apps/web/app/presentation/__tests__/{errorDisplay.test.ts,errorResponse.test.ts}` / `apps/web/app/routeTree.gen.ts` / `apps/web/app/routes/__tests__/storage.delivery.test.ts` / `apps/web/app/routes/notes/{-action.tsx,$noteId_.edit.tsx,new.tsx,trash.tsx}` / `apps/web/app/routes/storage.$.tsx` / `apps/web/app/routes/workspaces/$workspaceId/-action.tsx` / `apps/web/app/routes/workspaces/$workspaceId/notes/{$noteId_.edit.tsx,index.tsx,new.tsx,trash.tsx}` / `apps/web/app/routes/workspaces/$workspaceId/settings/{-action.tsx,route.tsx}` / `spec/pages/index.md` / `spec/manual-tests/editing.md` / `spec/presentation/index.md`

**スキップしたファイル**: なし（`packages/core/` 配下と `spec/{domains,usecases,testcases,database,platform,inventory,adr}` は backend 担当の持ち分のため対象外）
