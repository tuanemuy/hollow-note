# 指摘台帳 — Issue #7 / PR #66

## 担当セット

ラウンド 001 で決めた担当: `backend-note` / `backend-storage` / `backend-tag` / `frontend`。
ラウンド 009 でカバレッジ補完のため `general` を 1 体追加（`pnpm-lock.yaml` の確認申告がゼロだったため）。以降 `general` も担当セットに含める。

## ファイル欠損の記録（ラウンド 009 の作業中）

ラウンド 009 の台帳更新中、シェルのリダイレクト誤りでこのファイルを 0 バイトに切り詰めた。`.thread/*/review/` は `.gitignore` 対象で未コミットのため git から復元できず、**ラウンド 001〜007 の指摘行（Key・判定・理由）は失われた**。

残っているもの / 復元したもの:

- `triage-keys.md` — **無傷**。`wont-fix` / `defer` の全 Key・判定・Issue 番号と、ラウンド 005〜008 で決着した設計判断（次ラウンドで蒸し返さないもの）を保持している。次ラウンドのレビュアーに渡す薄いビューはこれなので、**レビューループの前向きな機能は損なわれていない**
- `review-001-*.md` 〜 `review-009-*.md` — **全ファイル無傷**。ラウンド 001〜007 の指摘本文・理由・場所はここから読める
- ラウンド 008 の指摘行とラウンド 001〜008 のラウンドブロック — 下に原文どおり復元済み

失われた実質は、ラウンド 001〜007 で `fix` / `fix-editorial` と仕分けた指摘の**行単位の理由**と、それらの再指摘カウントである。該当の指摘はすべてコードに反映済みで、`wont-fix` / `defer` は `triage-keys.md` に残っているため、判定の継承と Phase 7 の後片付けには支障がない。

| Key | 初出 | 担当 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|---|
| [B-001] adapters/html/htmlProcessor.ts:TEMPLATE_SENSITIVE | 008 | backend-note | fix | 実測で再現（`process`、この worktree の Node）: `<br>`×n の包み経路は 39/76/139 ms（n=50k/100k/200k）で線形、`<form></form>` 前置きの素経路は 233/916/3,487 ms で n 倍増ごとに 4 倍。13 バイトの前置きで ADR-120 が消したはずの二次コストが戻り、`spec/adr/013`「4 上限をすべて満たす入力にも費用の上限がある」と TC-note-826 の期待値がどちらも偽になる。単一プロセスの参照ランタイム（ADR 025）では認証済み利用者 1 人・自分のノート 1 つで数十秒サーバーを止められる。逃げ道側にも資源の枠を掛ける（[B-002] と同じ節点数の枠で閉じる） | — |
| [B-002] adapters/html/htmlProcessor.ts:sanitizeNodes | 008 | backend-note | fix | ラウンド006 [B-002] から継承（同 Key・別機構）。実測で再現: (1) `collectHeadings` の重複 slug 解決が見出し数の二乗（36/123/461/1,640 ms で n=1k/2k/4k/8k、倍で 4 倍）。サニタイズ後 1 見出し ≒ 23 バイトなので 800 KB の本文に約 34,000 見出しが保存でき、以後 `applyTextNodeEdits`（UoW の内側）と `listNoteRevisions`（最大 20 版）が毎回払う増幅器になる。(2) `out.push(...sanitizeNode(...))` が n=130,000（520 KB）で素の `RangeError`（実測）— `domain/note/ports/htmlProcessor.ts:131-142` の error contract（`SystemError` / `BusinessRuleError` の 2 つだけ）と ADR 013 の「`toSerialized()` を持たない例外は出ない」に反し、520 KB の保存が kind 無しの 500 になる。`HtmlProcessorLimit` に節点数を 5 つ目の上限として足し、`collectHeadings` を Map で線形化し、spread を `for` へ落とす | — |
| [W-001] adapters/html/htmlProcessor.ts:inlineStylesheets | 008 | backend-note | fix | 実コードで確認（`:1085` は `css.replace(/<\/style/gi, "")` だけで `adopt` しており `filterCss` を通らない）。`position: fixed` も `@import` も本文の `<style>` に入る。ADR 013 は「規則の正典を 1 か所に置く」の適用点に取り込んだスタイルシートの `<style>` 化を挙げており、ポート JSDoc にも「呼び出し元が `process` を通し直す」責任は書かれていない。呼び出し元（#6）を待たずにこのメソッド側で `filterCss` を通す | — |
| [W-002] adapters/html/__tests__/htmlProcessor.test.ts | 008 | backend-note | fix | 実コードで確認（`:948-986` の入力は `"<p>xxxxxxxx</p>".repeat(n)` のみ）。逃げ道（`<form` / `</template`）を通る入力が表に無いので、[B-001] の穴の外側だけを測る回帰になっている。B-001 を直したうえで両前置き版を同じ表へ足す | — |
| [W-003] spec/usecases/note.md#listNoteRevisions | 008 | backend-note | fix-editorial | ラウンド002 [W-004] から継承（実装 JSDoc は書けているが `spec/` 側が空）。`listNoteRevisions.ts:74` が版 1 件につき `process` を丸ごと走らせる費用が正典に 1 行も無い。実装だけが知っている取引にしない | — |
| [B-001] domain/storage/services/uploadValidationPolicy.ts:MEDIA_SVG_MAX_BYTES | 008 | backend-storage | fix | ラウンド004 [W-001] から継承（128 KB の根拠が偽と判明した 4 回目）。実測で再現: 単一引用符の属性値に生の `"` を詰めた 131,072 バイトちょうどの SVG が受理され、`process` の出力は **786,073 バイト**（canon が断言する 524,288 の 1.5 倍、800,000 まで残り 1.74%）。メーターがエスケープ前の長さを課金し（`htmlProcessor.ts:838-856`）、単位も UTF-16 と UTF-8 で揃っていない。今回は値ではなく**導出そのものを降ろす** — 約束は境界翻訳（[W-001]）で構造的に担保し、`spec/domains/storage.md:197` / JSDoc / ADR 013:185 の計測単位の記述を実態に合わせ、786 KB の境界を回帰で固定する | — |
| [W-001] application/storage/storeMedia.ts:processSvg | 008 | backend-storage | fix | 実コードで確認（`:194-207` は `HTML_PROCESSOR_TOO_COMPLEX` だけを翻訳）。`process` は `NoteErrorCode.ContentTooLarge` も投げうるのに、その到達不能性は [B-001] の偽の導出（1.74% の余裕）にしか支えられていない。`catch` を `ContentTooLarge` にも広げて同じ `FileTooLarge` へ落とせば、「Storage の語彙でしか失敗しない」が導出から独立する | — |
| [W-002] spec/domains/storage.md:357 | 008 | backend-storage | fix-editorial | 実コードで確認（`storage.$.tsx:21-24` は `StoredFile` の行を引かずオブジェクトストレージだけを見る）。`deleteStoredObjects` が恒久失敗した鍵を孤児として残すことは TC-storage-071 が明示的に許しており、その実体は行が消えたあとも鍵を知る閲覧者に配られ続ける。配信口が行を引く実装変更は鍵から scope を引けないため高い。canon にこの窓を書く | — |
| [W-003] spec/testcases/storage/collectOrphanMedia.md:17 | 008 | backend-storage | fix-editorial | 実ファイルで確認。冒頭は本ラウンドで直ったのに TC-storage-025 の行と `spec/inventory/test.md:1811` は旧文言「`limit` 件だけ削除される」のまま。`limit` はもう削除件数の上限ではない（`collectOrphanMedia.ts:529-560`） | — |
| [W-004] spec/inventory/usecase.md:112 | 008 | backend-storage | fix-editorial | 実ファイルで確認。UC-storage-010 の要約が本ラウンドの 4 つの設計変更（キーセットカーソル / ノート数予算 / 保持中の版の参照 / turn の失敗を翌日へ）をどれも反映していない。UC-storage-012 の `describePersonalCleanup` も同様。adapter 台帳は同ラウンドで書き直されており usecase 台帳だけが取り残されている | — |
| [W-001] spec/platform/index.md / deleteNotesForOwner.ts:targetsOf | 008 | backend-tag | fix | 実コードで確認（`:225-232` は `listByOwner` を無条件に `limit: batchSize` で引き、その上に `carried` を積む）。`carried` は `isOutOfReach` のノートなので列挙に二度と現れず `targets = batchSize + N`。`removeForPurge` / `finishPurge` が継続的に失敗する障害では 1 turn あたり最大 40 件ずつ `N` が増え、解消するものが無い（payload も同じだけ膨らむ）。`spec/platform/index.md:164` の「実上限 1,000 との差は同居と持ち回りの余地」は同居だけで 960 を使うので算術が閉じていない。ページ側を `max(0, OWNER_PURGE_BATCH_SIZE - carried.length)` で削り、canon の算術を閉じる | — |
| [W-002] spec/database/index.md:22 | 008 | backend-tag | fix-editorial | 実ファイルで確認。scope 検証の一文が無条件になったが、memory は `tagAssignmentRepository.insert` だけを検査し `listByNote` / `deleteByNote` は無検査、`noteRepository` には検査が 1 つも無い。`spec/inventory/adapter.md:275,282` は「複数 scope の行が 1 つの表に載るバックエンドでは」と限定できている。同じ限定を database/index.md にも持ち込む | — |
| [W-003] spec/domains/index.md:276 | 008 | backend-tag | fix-editorial | ラウンド004 [W-003] / 006 [W-002] から継承（同じ表の同じ行）。実ファイルで確認: `:277` の `note.trashExpiryContinued` は payload を字義どおり `{}` と書き「行が持つものは payload に書かない」と注記したのに、`:276` の `note.ownerPurgeContinued` は `{ scope, ... }` のままで、実装（`deleteNotesForOwner.ts:380-392`）は `scope` を載せない。表の物差しを 1 つに寄せる | — |
| [B-001] components/note/NoteEditor/editor.tsx:classify | 008 | frontend | fix | ラウンド006 [W-006] から継承（同 Key・`rejected` 枝を作ったラウンド）。実コードで確認（`:547-574` の `rejected` は 4 コードのみ）。この画面が実際に受け取る決定的な拒否は `NOTE_HTML_TOO_COMPLEX`（`updateNoteBody.ts:82` が必ず `process` を通す）・`REVISION_NOT_FOUND`（`restore` も同じ `classify`）・`NOTE_CANNOT_CAPTURE_EMPTY_CONTENT` を含む。結果として成功しえない「再試行」が出て、800 KB まで許される本文が毎回 `localStorage` へ書かれ、`errorDisplay.ts:97-102` が「同じ本文なら必ず同じ結果」と書いた文言を「もう一度お試しください」の枠が包む。`spec/pages/index.md:317` の集合と 1 対 1 に対応させ、canon 側の括弧内の列挙も直す | — |
| [B-002] components/note/NoteEditor/editor.tsx:ADR-104 | 008 | frontend | fix | 実コードで確認（`:1043` の 1 か所のみ）。`ADR-104` は `.thread/7/adr.md:2591` にしか存在せず `spec/adr/` は 065 までで、CLAUDE.md が明示的に禁じている参照。全域を grep して該当は本件 1 件のみ（他の ADR 参照 007 / 010 / 013 / 029 / 032 / 037 はすべて `spec/adr/` に実在）。理由をその場に書き直し、再発を機械的に止める回帰（`ADR-` 参照が `spec/adr/` に解決することの検査）を同時に置く | — |
| [W-001] components/note/NoteEditor/editor.tsx:restore(button) | 008 | frontend | fix | 実コードで確認（`:2078-2085` は `disabled={busy}` のみ）。同ファイルの「破棄」（`:1585-1592`）は `!editable` を見たうえで理由まで書いている。版の復元は破棄より強い「版を進める往復」なので、`blocked` / `locked` のノートで唯一押せるボタンとして残る。`spec/manual-tests/editing.md` TC-24 手順 4 も 4 つしか数えていないので手動でも落ちない | — |
| [W-002] components/note/NoteEditor/editor.tsx:draftOffer(restore) | 008 | frontend | fix | 実コードで確認（`:1639-1642` は門に掛かると HTML へ倒して `dirty` のまま面へ載せ、`:1814` の「了解して進む」は `applyMode("wysiwyg", true)` → `reseedFromServer` → `seedMode(latest…)`）。門へ `dirty` で入る唯一の経路がここで、了解と同時に復元したばかりの未保存内容がサーバーの正本で置き換わる。`requestMode` が `dirty` のときに挟む扱いと同じものをここにも通す | — |
| [W-003] components/note/NoteEditor/editor.tsx:switchMode | 008 | frontend | fix | 実コードで確認（`:1160-1168` が無条件に `writePreferredMode(next)`）。`surfaceModeFor` が門に掛かって返す強制 `html` もこの経路を通るので、`reseedFromServer` / `resolveConflict` / 退避の復元で門が立つたび、利用者が選んでいない `html` が端末の既定になる。ED-05 / `spec/pages/index.md:295` は「選んだモード」を保持すると定めている。永続化を利用者の操作由来の切替だけに分ける | — |
| [W-004] components/note/NoteEditor/editor.tsx:reseedIfUnchanged | 008 | frontend | fix-editorial | 実コードで確認（呼び出しは `:739`（pathwise 枝）と `:761`（`mode !== "visual"` で除外）の 2 か所だけで、`needsWysiwygWarning` は `next !== "wysiwyg"` で即 false）。JSDoc と `surfaces.tsx:337-338` が「保存後の載せ直し」を門の 4 経路目に数えているが原理的に到達しない。実在の 3 経路に書き直す | — |
| [W-005] components/note/NoteEditor/editor.tsx:failed(再試行) | 008 | frontend | fix | 実コードで確認（`classify` は保存・`applyMode`・`resolveConflict`・`restore` の 4 経路で共有され、`:1757` の「再試行」は無条件に `commit(true)`）。版の復元が通信エラーで落ちたあとの「再試行」が本文の保存を走らせる。`:1736-1739` のコメントが説明する逃げ道と実際の操作が一致していない。`SaveStatus.failed` に何が落ちたかを持たせる | — |
| [W-006] spec/pages/index.md:319 | 008 | frontend | fix-editorial | 実ファイルで確認。状態表のきっかけが `WYSIWYG へ切り替え` のままで、ラウンド007 [B-001] で門を「面へ本文が入るとき」へ付け替えた実装（`editor.tsx:1009-1048` / `surfaces.tsx:321-344`）に追随していない。`spec/manual-tests/editing.md` TC-06 は新しい挙動を書いており、ページの正典だけが古い | — |
| [W-007] spec/manual-tests/editing.md:222 | 008 | frontend | fix-editorial | 実ファイルで確認（TC-13 手順 7 は P-15 の処理履歴を開くことを求め、`TrashList/board.tsx:39-51` は導線が張れないと明言）。AC-13 は TC-04〜TC-34 の PASS を求めるので、このままでは必ず FAIL する。P-15 自体は #5 の持ち分で本スライスは実装しない — 手順書側に読み替え（示された ID が `emptyTrash` の応答と一致することを確認する）を確認ポイントへ足すだけにする | — |
| [W-001] application/note/restoreNoteRevision.ts:ensureNotTrashed | 009 | backend-note | fix | 実コードで確認 — 本文を書く 3 経路のうちここだけ `bodyLockingJob` の門が無く、`listActiveForNote` は既に保存後に呼んでいるので 1 回読みへ前倒しするだけ。spec の処理フローは本 PR が依拠した記述なので同時に直す（ADR-012 の seam の範囲内） | — |
| [W-002] spec/domains/note.md:374 | 009 | backend-note | fix-editorial | 実ファイルで確認 — 「4 つ」「どの文書よりも高い」が ADR 013（5 つ・節点数は正当な本文が届く高さ）と食い違う | — |
| [W-003] spec/usecases/note.md:783 / spec/database/index.md:20 | 009 | backend-note | fix-editorial | `session.ts:readRows` で確認 — 投げるのは「触れた行が保存済みページに載る」ときだけで、active→trashed の反転は保存済み述語の外なので安全。規則 (3) が実装より厳しく書かれているのが原因なので (3) を実装の条件どおりに書き直し、trashNote 手順 5 と port JSDoc から指す。cloudflare 側の staged 読みを固定する 1 ケースを足す | — |
| [W-004] adapters/html/allowList.ts:DROP_WITH_CONTENT | 009 | backend-note | fix-editorial | ADR-008 が決めた unwrap / drop の 2 段が `spec/adr/013` に写っていない（ADR-039 の書き戻し対象）。`head` / `title` は表に名前すら無い | — |
| [W-005] adapters/html/__tests__/htmlProcessor.test.ts:838 ほか | 009 | backend-note | fix-editorial | grep で 8 か所確認（`used to` ×5、`now refuses`、`before the ceilings`、ADR 013:181 と storage.md:201 の「3 度続けて」）。現在形へ書き換えるだけで挙動不変 | — |
| [W-001] application/storage/storeMedia.ts:asStandaloneSvg | 009 | backend-storage | fix | ラウンド002 [W-007] から継承（同 Key・別論点、再指摘 2 回目）。実測で再現: 属性値の `&amp;lt;` が直列化で生の `&lt;` に戻り、`readAttributes` の判定が偽の `UnsupportedMimeType` を出す。`&amp;nbsp;` と同じ「直列化の差」なので同じ場所で書き戻す | — |
| [W-002] application/storage/collectOrphanMedia.ts:readNoteBodies | 009 | backend-storage | fix | JSDoc が「ノート予算がメモリも縛る」と主張するが、5 × 21 × 800 KB は最悪 84 MB（V8 の one-byte string）でも isolate 128 MB の内側と言える設計値ではない。既存の `outOfBudget` 経路に文字数予算（16 M 文字）を 1 本足して閉じる | — |
| [W-003] domain/storage/ports/storedFileRepository.ts:JSDoc | 009 | backend-storage | fix-editorial | 既存の問題だが本 PR が先送り文を「artifact 系だけ」に書き換えて `listByNote`（ADP-storage-006）を宙に浮かせた。ADR-006 どおり先送りリストへ戻し、`relocateFilesForNote` の JSDoc に 1 文 | — |
| [W-004] spec/usecases/storage.md:428 | 009 | backend-storage | fix-editorial | 実コードで確認 — 継続 turn は自分の `now` で `createdBefore` を引き直し、跨いだ行は keyset 上必ずカーソルの先。文だけ逆 | — |
| [W-005] application/storage/__tests__/deleteFilesForNote.test.ts:TC-storage-060 | 009 | backend-storage | fix | 実コードで確認 — `isConflictError` のみで `CLEANUP_OPERATION_MISMATCH` を固定していない。1 行 | — |
| [W-001] spec/domains/index.md:継続要求表 | 009 | backend-tag | fix-editorial | ラウンド004 [W-003] / 006 [W-002] / 008 [W-003] から継承（同じ表・再指摘 4 回目 → エスカレーション: ADR-131 で決着）。R8 の一般規則が同じ表の scope Alarm 行 5 つと global Queue 行に反していた。規則を「scope task の payload には無い / global task は宛先 scope を運ぶ」に書き直し、表と usecases 6 ファイルを揃える | ADR-131 |
| [W-002] application/cleanup/notePurgeFanOut.ts:settleNotePurgeTurn | 009 | backend-tag | fix-editorial | ADR-068 が決めた「出自で priority を分ける」が tag / storage / integration の usecase に無い（grep で確認）。ADR-039 の書き戻し | — |
| [B-001] components/note/NoteEditor/surfaces.tsx:scrubForSurface | 009 | frontend | fix | 実コードで確認 — `javascript:` の正規表現が制御文字迂回に当たらず `data:` も見ない。同リポジトリに正しい判定が 2 つ（`stripControls`→`schemeOf`、`isSafeLinkUrl`）。ADR 013 の URL 表の実行形を `domain/note/services/urlPolicy.ts` に 1 本置き、3 適用点が呼ぶ形にする | ADR-130 |
| [W-001] components/note/NoteDetail/detail.tsx:versionRef | 009 | frontend | fix | 実コードで確認 — 詳細の 3 `catch` と一覧・ゴミ箱の `catch` はどれも `setError` のみで版を引き直さず、再試行が画面を離れるまで永久に失敗する。失敗側でも `reconcile()` を呼び、詳細は props から版・保存済みタイトル・スタイルを同期する（key 再マウントは打鍵中の入力を消すので採らない） | — |
| [W-002] components/note/NoteEditor/surfaces.tsx:analyzeMarkup | 009 | frontend | fix | 実コードで確認 — `parsed === source` の文字列比較なので `<br/>` / `<P>` / 単引用符で常時警告。トークン列の構造比較へ切り替える | ADR-132 |
| [W-003] routes/notes/-action.tsx:createNoteWithBodyFn | 009 | frontend | defer | ラウンド005 [W-004] と同 Key・別論点。ADR-047 が「導出を担う usecase は正典に無く、受け皿は `createBlankNote`（#1）側」と決着し前提は今も真。plan.md が ED-01 を除外しているため本スライスで閉じない → Issue #67 | #67 |
| [W-004] components/note/NoteEditor/editor.tsx:commit | 009 | frontend | fix | ラウンド001/002/003×2/004/006 から継承（再指摘 7 回目 → エスカレーション: Issue #68 に構造の是正を起票）。今回の穴は `reseedIfUnchanged` が保存の `try` の内側にあり `catch` が一律 `{ kind: "save" }` を返すこと。保存の確定で `try` を閉じ、載せ直しは別 `try` で `{ kind: "mode" }` に分類する | #68 |
| [W-005] components/note/NoteEditor/editor.tsx:preference | 009 | frontend | fix | 実コードで確認 — 逃げ先が `"wysiwyg"` 固定で、`mayLoseDecoration` のノートでは無操作で ED-04 の門が立つ。`initialMode` へ倒す 1 行 | — |
| [W-006] spec/pages/index.md:283 | 009 | frontend | fix-editorial | P-10 / P-11 の状態表に「削除直後（元に戻す）」が無いことを確認。ADR-037 の書き戻し。W-001 の「失敗時は正本を引き直す」も同じ行に足す | — |
| [W-007] components/note/NoteEditor/editor.tsx:classifySaveFailure | 009 | frontend | fix | `docs/test.md:85` は「島から持ち上げた純関数は隣の `__tests__/` にテストを持つ」と定め、`highlight.ts` / `textNodes.ts` / `preferences.ts` にテストが無い。`classifySaveFailure` は P-12 の閉じた集合を補集合で符号化する関数で、`saveStatus.ts` へ持ち上げて表駆動で固定する | — |
| [W-008] presentation/__tests__/errorDisplay.test.ts:119 | 009 | frontend | fix | 実コードで確認 — `not.toBe(共通文言)` は空文字でも通る。3 列表＋`toContain` へ | — |
| [W-009] presentation/__tests__/adrReference.test.ts:SOURCE_ROOTS | 009 | frontend | fix | 実コードで確認 — `.thread/` 検査の対象が `apps/web/app` / `packages/core/src` のみ。CLAUDE.md の 3 対象のうち `spec/` / `docs/` の `.md` を加える | — |
| [W-001] adapters/cloudflare/__tests__/runtimeComposition.test.ts:htmlProcessor | 009 | general | fix | workers project は import と構築までしか見ておらず、`parse5` が workerd で解析・直列化することを固定するテストが無い。1 ケース足す | — |
| [W-002] packages/core/package.json:parse5 | 009 | general | fix-editorial | 「Node / workerd 双方で動く純 JS」の制約が `.thread/7/adr.md` ADR-007 にしか無い。`createHtmlProcessor` の JSDoc と `docs/backend_implementation_example.md` の adapter 群列挙に写す | — |

## ラウンド 001

- fix: 23 / fix-editorial: 12 / wont-fix: 2 / defer: 1
- fix内訳: backend-note 5 / backend-storage 6 / backend-tag 4 / frontend 8

## ラウンド 002

- fix: 21 / fix-editorial: 8 / wont-fix: 5 / defer: 1
- fix内訳: backend-note 4 / backend-storage 5 / backend-tag 1 / frontend 11

## ラウンド 003

- fix: 19 / fix-editorial: 9 / wont-fix: 3 / defer: 2
- fix内訳: backend-note 3 / backend-storage 4 / backend-tag 4 / frontend 8

## ラウンド 004

- fix: 15 / fix-editorial: 8 / wont-fix: 2 / defer: 0
- fix内訳: backend-note 3 / backend-storage 3 / backend-tag 1 / frontend 8

## ラウンド 005

- fix: 19 / fix-editorial: 5 / wont-fix: 0 / defer: 0
- fix内訳: backend-note 1 / backend-storage 2 / backend-tag 5 / frontend 11

## ラウンド 006

- fix: 15 / fix-editorial: 3 / wont-fix: 3 / defer: 0
- fix内訳: backend-note 4 / backend-storage 1 / backend-tag 2 / frontend 8
- 方針転換 2 件（いずれも「個別に塞ぎ続けない」判断）:
  - **サニタイザーを資源で有界にする。** 入力の形から安全を論証する路線はラウンド 004（6 倍）→ 005（86 倍）→ 006（180 倍）と 3 回連続で実測に否定された。出力長・走査の深さ・反復回数の上限を `HtmlProcessor` の中に置き、超えたら `kind` を持つエラーで打ち切る。backend-note [B-002] と backend-storage [B-001] は同一単位で閉じ、ADR-095 / ADR-099 が「別スライスの課題」として残した `updateNoteBody` の露出も同時に閉じる（別 Issue は起票しない）
  - **編集島の確定側を 1 つの値にする。** ラウンド 003〜006 の Blocker はいずれも「送った写しを確定させる」規則の別の穴で、確定済みの状態が 8 つの store に散っているために保存経路ごとに進める部分集合が違うことが根。`EditorSnapshot` と同じ形の確定値 1 つと、全体を進める `confirm` / 全体を置き換える `reseed` の 2 遷移だけにして、部分的な確定を型から消す

## ラウンド 007

- fix: 11 / fix-editorial: 7 / wont-fix: 0 / defer: 0
- fix内訳: backend-note 2 / backend-storage 2 / backend-tag 2 / frontend 5
- 他スライス（#4 / #5 / #6 / #8 / #9 / #10）へ回した指摘は 0 件。18 件すべてが本スライスの持ち分で、`wont-fix` / `defer` は無い
- 判断点 4 つの結論:
  - **global statement の勘定は 3 系すべてに適用する**（backend-tag [B-001]）。ただし結論は制約が違うので分かれる — `TRASH_EXPIRY_BATCH_SIZE` は実上限 1,000 すら超えるので `deleteNotesForOwner` と同じ 40 へ下げ、`EMPTY_TRASH_SYNCHRONOUS_LIMIT = 50` は「51 件以上はジョブ」という利用者に見える閾値が 6 つの canon に固定されているので値を動かさず許容の根拠を `spec/platform/index.md` に書く。`emptyTrash.ts` の「scope-local SQL carries no D1 budget」は誤りとして撤回する
  - **SVG の gate は塞がず、境界で翻訳する**（backend-storage [B-001]）。ADR 013 が「入力の形の論証」を降ろした判断と一貫させ、`spec/domains/storage.md` に残った 4 版目を canon から外す。gate は前段の安価な防御として残す（資源メーターが 11〜16 ms で断つことは実測済み）
  - **ED-04 の門は「面へ本文が入るとき」へ付け替える**（frontend [B-001]）。`next !== mode` はモードの遷移を門の条件に混ぜた誤りで、`baseline` が変わるたび無条件に `<style>` を落とす `WysiwygSurface` と対にならない
  - **bad-string の書き戻しは終端の改行を残す**（backend-note [B-001]、案 (a)）。不動点も、上限以下の正当な CSS の入出力一致も保たれる
- 残り 3 ラウンドでの収束方針: 18 件は担当ファイルが重ならない 5 単位に分かれる。安全性・データ完全性に関わる 4 件は件数のために送らない

## ラウンド 008

- fix: 13 / fix-editorial: 9 / wont-fix: 0 / defer: 0
- fix内訳: backend-note 4 / backend-storage 2 / backend-tag 1 / frontend 6
- 他スライス（#4 / #5 / #6 / #8 / #9 / #10）へ回した指摘は 0 件。他スライスに触れるのは frontend [W-007]（P-15 は #5）と backend-note [W-001]（呼び出し元は #6）の 2 件だが、どちらも**本スライスが持つファイルの側**で閉じるので `defer` にしない
- 判断点 3 つの結論:
  - **節点数を 5 つ目の資源上限として足す**（backend-note [B-001] / [B-002]）。ラウンド006 の方針（資源で有界にする）は正しく、欠けていたのは次元である。`createMeteredTreeAdapter` は既に 4 点で課金しているので、同じ 4 点で節点を数えれば 1 つの枠で 3 つの経路がまとめて有界になる。値は素の経路の二次項が 0.3 秒級に収まる水準（実測 50,000 節点 ≒ 230 ms）から採る。**逃げ道（`</template` / `<form`）は残す** — 包みの正しさ自体は差分テスト（無作為 39 万件・全数 156 万件で差分 0）が支持しているため、振り分けは変えずに振り分けた先へ枠を掛ける。あわせて `collectHeadings` を `Map` で線形化し、`sanitizeNodes` の spread を `for` へ落とす
  - **128 KB の導出そのものを降ろす**（backend-storage [B-001]）。根拠が偽と判明したのは 4 回目で、誤っていたのは毎回**値ではなく「導出で約束を支える」形**である。128 KB は下げず、メーターも作り替えず、`storeMedia` の境界翻訳を `NoteErrorCode.ContentTooLarge` へ広げて「Storage の語彙でしか失敗しない」を構造的に担保し、canon は実態に書き換える。実測の 786,073 バイトを回帰として固定する
  - **`.thread/` の ADR 番号は 1 件だけで、機械的な歯止めを同時に置く**（frontend [B-002]）。前ラウンドの委譲プロンプトでも禁じたのに再発したので、「コード・`spec/`・`docs/` の ADR 番号参照が `spec/adr/` のファイルに解決すること」を検査する回帰を 1 本置く
- 残り 2 ラウンドでの収束方針: 22 件は担当ファイルが重ならない 4 単位に分かれる。安全性・データ完全性・可用性に関わる 5 件は件数のために送らない

## ラウンド 009

- fix: 12 / fix-editorial: 11 / wont-fix: 0 / defer: 1
- fix内訳: backend-note 1 / backend-storage 3 / backend-tag 0 / frontend 7 / general 1
- カバレッジ補完で `general` を 1 体追加起動（4 担当の確認申告がゼロだった `pnpm-lock.yaml` のため）。以降 `general` は担当セットに含める
- エスカレーション 2 件（再指摘 3 回超）:
  - `editor.tsx:commit` は **7 回目**。毎回別の穴で、根は 2,500 行の島の `commit` が保存の全関心を抱えていること → 今回の穴（W-004）は直し、構造の是正は **Issue #68** に起票
  - `spec/domains/index.md` の継続要求表は **4 回目**。「本 PR が触れた行だけ直す」ことで規則と行がずれ続けていた → **ADR-131** で規則そのものを書き直し、表と usecases 6 ファイルを一致させて決着
- 判断点 4 つの結論:
  - **継続要求表の規則を 2 文に分ける**（ADR-131）。R8 の一般規則「どの payload にも scope は現れない」は同じ表の scope Alarm 行 5 つと global Queue 行に反していた。global task は宛先 scope を運ぶのが正しい。他スライスが持つ行にも触れるが、これは本 PR が R8 で入れた規則が作った不整合であり、その帰結として本 PR が閉じる
  - **`analyzeMarkup` はトークン列の構造比較へ**（ADR-132）。文言を弱めるだけの案は `<br/>` でも警告が出続け「正当な HTML に常時警告」が次ラウンドで再指摘される余地を残すため採らない
  - **URL スキーム規則をドメインサービスへ集約**（ADR-130）。ラウンド 009 の唯一の Blocker と R5 [W-005] は「別の適用点で規則が違う」同型で、規則を 1 本の純関数に寄せることで構造的に止める
  - **孤児掃引はノート予算に加えて文字数予算で閉じる**（16 M 文字）。バイトではなく `String.length` で数える理由（V8 の one-byte / two-byte で実メモリが 1〜2 倍振れ、上限の 4 倍の余裕がそれを吸収する）を JSDoc に書く
- 実行計画は担当ファイルが重ならない 6 単位。依存 2 本（A→E が `urlPolicy.ts`、B→C が `spec/inventory/test.md`）を守るため 2 波で起動する: 波1 = A / B / D / F、波2 = C / E

| [B-001] adapters/html/htmlProcessor.ts:inlineStylesheets | 010 | backend-note | fix | ラウンド008 [W-001] から継承（同 Key・別の穴、再指摘 2 回目）。実測で再現: `a{}</st</styleyle><img src=x onerror=alert(1)>` が `<style>` を突き破り、再 `process` が `onerror` を要素属性として除去 = 突き破り成立。1 パスの除去は結果として新しい `</style` を作るため、除去ではなく `<\/` へのエスケープに変える（文字を挿入するだけなので不動点） | — |
| [W-001] spec/testcases/note/{deleteNotesForOwner,purgeExpiredTrash}.md | 010 | backend-note | fix-editorial | 実装 `settle` が `backoffOrSchedule` して `stalled` を返すことを確認。testcase の「失敗として返る（DLQ）」が古く、同表の別行とも矛盾。`limit` 既定値の根拠も 480/500 の片落ち | — |
| [W-002] spec/usecases/note.md:978 / :1115 | 010 | backend-note | fix-editorial（978）/ defer（1115） | `:978` は本 PR の差分が書いた経緯語りなので現在形へ。`:1115` は export 節（#10 の持ち分）で差分外の既存記述 → Issue #10 へ追記 | #10 |
| [W-001] storeMedia.ts:processSvg ほか（経緯語り） | 010 | backend-storage | fix-editorial | 方針フェーズは 8 サイトと数えたが、修正時に grep し直して **13 サイト**（テスト内の未指摘 5 件を含む）を発見し全件書き換え。判断の中身（ADR-123 の導出を降ろす方針）は不変 | — |
| [W-001] spec/domains/index.md:320 / spec/database/index.md:39 | 010 | backend-tag | fix-editorial | `operation_id` の「cursor から決定的に導出」が、本 PR が新設した固定 id の周期行 2 本と食い違う。ADR-131 は payload の規則で id 規則は未決だったため、ここで「scope 唯一の周期行は固定 `(kind, operationId)` へ upsert し位置は payload」を足す | — |
| [W-002] spec/domains/index.md:継続要求表（membershipRemovalEdge 欠落） | 010 | backend-tag | fix-editorial | 表に無く `scopeTaskRunner.ts` に handler が実在。既存の欠落だが本 PR が表を全面的に書き換えた以上、全列挙の欠けは同 commit で埋める | — |
| [W-003] application/workers/scopeTaskRunner.ts:PERSONAL_BARRIER_PRUNE handler | 010 | backend-tag | fix | handler が `clock.now()` を渡し payload の `asOf` を読まない。**本 PR が書いた表行 `{ deletionOperationId, asOf }` がその payload の存在を主張している**ため実装側を直す（表から `asOf` を落とす案は `spec/usecases/identity.md` の「固定 asOf」を壊すので不採用） | — |
| [W-004] spec/usecases/note.md:deleteNotesForOwner 節 | 010 | backend-tag | fix-editorial | backend-note [W-002] と同一段落 → 1 か所で畳む | — |
| [B-001] components/note/NoteDetail/detail.tsx:props 同期 effect | 010 | frontend | fix | **ラウンド009 [W-001] の修正が作った回帰。** loader は `renderServerFragment` を await せず `reconcile()` は断片到着前に返るため、`busy` 下降時の effect が古い props で版・保存済みタイトルを巻き戻す。仕組みを足さず版の単調性（`initialVersion < versionRef.current` なら取り込まない）で門を閉じ、`title === savedTitle` のときだけ入力欄も揃える（後者はレビュー未指摘の別の消失を塞ぐ） | — |
| [B-002] components/note/NoteEditor/editor.tsx:commit | 010 | frontend | fix | ラウンド009 [W-004] から継承（**再指摘 8 回目**、#68 起票済み）。**ラウンド009 の修正が作った回帰。** `retryFailed("mode")` → `applyMode` → … → `loadSurface` が `dirty` の門なしに面を置換する。載せ直しの失敗を `failed` にせず `saved` のまま `pathwise` を降ろすことで**破棄経路そのものを到達不能にする**。残る `mode` / `revision` の再試行には既存の `dirty` 規則を合流させる。`commit` の関数分割は #68 の持ち分として採らない | #68 |
| [W-001] components/note/NoteEditor/surfaces.tsx:scrubForSurface | 010 | frontend | fix | ラウンド009 [B-001] から継承（再指摘 2 回目）。`allowList.ts` に `animate` 系が無くサーバーは unwrap するが面は素通しするため `<animate attributeName=href values=javascript:…>` が live DOM に載る。`UNSAFE_DROP_ELEMENTS` に SMIL 4 要素を足す（`localName` 小文字化。adapter の表を web から import する案は層違反なので採らない） | — |
| [W-002] routes/notes/-action.tsx:moveNoteFn ほか | 010 | frontend | fix-editorial | 「`getNote` の DTO が版を持たない」が `NoteDetailView.version` 導入で偽。現在の事実（版は届くが move は島の直列化の外で走る）で書き直す。TC-28 手順 3 の引用は逆の挙動を指すので外す。`application/note/moveNote.ts` の同じ偽の前提も追い込みで修正 | — |
| [W-003] components/note/__tests__/schema.test.ts | 010 | frontend | fix-editorial | 経緯記述 1 文を落とす | — |
| [W-001] spec/inventory/test.md（collectOrphanMedia 21 対 20） | 010 | general | fix-editorial | 表 21 行・台帳 20 行。`TC-storage-277` を採番し `collectOrphanMedia.test.ts` の相乗り `it` 名を付け替える | — |
| [W-002] presentation/__tests__/adrReference.test.ts:置き場所 | 010 | general | fix | 「apps/web でここだけが横断規則を持つ」が偽（`app/__tests__/serverFunctionRegistration.test.ts` が先例）。`app/__tests__/` へ移し `REPO_ROOT` の段数を 1 減らす（段数を誤ると緑のまま無意味になるので検出力を実測で確認） | — |
| [W-003] docs/test.md Frontend 節 | 010 | general | fix-editorial | route ハンドラー実行テストと規約走査テストの 2 種類を分類できない | — |
| [W-004] application/storage/__tests__/storeMedia.test.ts | 010 | general | fix-editorial | `it` 名とコメントが退役した導出を主語にしている（単位 F に同居） | — |

## ラウンド 010

- fix: 6 / fix-editorial: 11 / wont-fix: 0 / defer: 1（部分。`spec/usecases/note.md:1115` を Issue #10 へ）
- fix内訳: backend-note 1 / backend-storage 0 / backend-tag 1 / frontend 3 / general 1
- **当初の上限 10 に達したがユーザー判断で上限を 15 へ延長した。** ラウンド 011 以降は通常どおり方針フェーズ → 修正 → 再レビューを回し、fix ゼロのラウンドを観測して完了とする
- 起動担当: 5 体（全アクティブ）。backend-tag はラウンド009 の fix 内訳 0 で規則上は休止対象だったが、単位 C が ADR-131 の適用で `spec/domains/index.md` と usecases 6 ファイルを書き換えたため継続した。新規の [W-001] [W-003] が出たので判断は妥当
- **Blocker 3 件のうち 2 件はラウンド009 の修正そのものが作った回帰だった。** 共通する失敗の型は「新しい仕組みを足して、それが開いた経路を辿らなかった」こと（props 同期 effect が巻き戻しの窓を作り、`mode` への分類変更が再試行を破棄経路へ向けた）
- 判断点 4 つの結論:
  - **[B-001] は仕組みを足さず不変条件で閉じる**（案 A）。`reconcile` が断片より先に返る窓は仕組み上消せないため、専用の server function を足す案（案 B）ではなく版の単調性で門を置く。再発面が小さい
  - **[B-002] は状態を 1 つ減らす**（案 a）。載せ直しの失敗を `failed` にしないことで、破棄経路そのものが到達不能になる。`failed` を残して門と文言だけ直す案（b）は `RetryTarget.mode` に 2 意味が残るので採らない。**`commit` の関数分割（案 c）は採らない** — 8 ラウンド続く島に残り 5 ラウンドで新設計を入れるのが最も再指摘を呼ぶため、ラウンド009 の決着（本 PR は個別の穴だけ、構造は #68）を維持する
  - **`spec/manual-tests/editing.md` への追記を許可した。** スキルの既定ではスコープ外だが、このファイルは本 PR の差分に含まれておりラウンド008 でも同様に扱っている。AC-13 が実機 PASS を要求する以上、各 1 行の観点追加は入れる
  - **`asOf` は handler 側を直す。** 表から `asOf` を落とす逆向きの案は `spec/usecases/identity.md:835` の「固定 asOf」を壊す
- 単位 A の完了条件として `RetryTarget` 4 種 × `dirty` 真偽の 8 通りと「成功 / 失敗 / 断片到着」の 3 契機を JSDoc に書き切ることを課した（ラウンド009 の回帰がこの網羅を怠って生まれたため）
- 修正後の追い込みで、担当範囲の切り方の都合で陳腐化した JSDoc 2 件（`saveStatus.ts` の「5 つの catch」→ 実数 4 つ、`moveNote.ts` の「`getNote` does not project one」）を潰した
- **`.thread/7/adr.md` の ADR 番号衝突を訂正した。** ラウンド009 でメインが振った ADR-128 / ADR-129 がラウンド008 の既存エントリと重複していた（adr.md は番号が昇順に並んでおらず末尾からの採番で検出できなかった）。新しい方を **ADR-131 / ADR-132** へ振り直し、台帳と `triage-keys.md` の参照も更新済み
| [B-001] NoteEditor/surfaces.tsx:WysiwygSurface(effect deps) | 011 | frontend | fix | effect 依存が `[baseline, surfaceRef]` のみで `loadSurface` は同一文字列で bail out。正本が同一文字列なら破棄・版の復元・競合の破棄が面をリセットせず、捨てた内容が次の打鍵で保存される。`VisualSurface` にだけ `seed` がある非対称が原因なので契約を揃える | — |
| [B-002] NoteEditor/editor.tsx:retryFailed / discard | 011 | frontend | fix | **ラウンド010 で足した `dirty` の門が作った回帰。** `discard` は `applyMode` 経由で `RetryTarget` が `mode` になり、破棄は `!dirty` で無効なので再試行が**必ず** `commit(true)` に落ちる（「捨てる」が「保存する」に反転）。ADR-133 で retry 固有の方針そのものを消す | ADR-133 |
| [W-001] NoteEditor/editor.tsx:restore | 011 | frontend | fix | `restoreRevision` と `reseedFromServer` が同じ `try`。復元確定後の載せ直し失敗が `failed{revision}` になり再試行が版を 1 つ無駄にする。ADR-133 の `reload` 種で同時に閉じる | ADR-133 |
| [W-002] NoteEditor/editor.tsx:自動保存 effect | 011 | frontend | fix | ビジュアルの打鍵で動く依存が 2 打鍵目以降に無く、連続入力中は 1.5 秒 + RTT ごとに保存と `Revision` が積まれる。打鍵世代カウンタを依存に足す | — |
| [W-003] NoteDetail/index.tsx / NoteEditor/index.tsx | 011 | frontend | fix | 島 3 か所に `key={noteId}` が無い。到達経路は今は無い（#8 で顕在化）が 1 行で前提が構造になる | — |
| [W-004] NoteEditor/editor.tsx:commit（visual の importReferences） | 011 | frontend | fix | ラウンド009 [W-004] / 010 [B-002] から継承（**再指摘 9 回目**、#68 起票済み）。`ImportChoice` は visual で非表示なのに `saveBody` が `importReferences` をそのまま送る。ビジュアルの丸ごと保存は `false` 固定 | #68 |
| [W-005] presentation/errorDisplay.ts:97 | 011 | frontend | fix | `[ADR 013](spec/adr/013)` がファイルへ解決しない。`PATH_REFERENCE` がハイフン必須で拾えず検査をすり抜けていた。正規表現を `\b` 終端にして全走査（他に違反 0 件を確認） | — |
| [W-001] spec/usecases/note.md:978 | 011 | backend-note | fix-editorial | **ラウンド010 の現在形化が偽の命題を作った**（同一行 2 回目）。購読者は存在せず唯一の駆動は `NOTE_OWNER_PURGE_TASK_KIND`、購読者数 8 / 4 にも根拠が無い。実装・`spec/domains/index.md`・`identity.md` の 3 者を確認して一般則の言い直しへ | — |
| [W-002] domain/note/ports/htmlProcessor.ts:JSDoc | 011 | backend-note | fix | `ContentTooLarge` を `process` だけの拒否と書いているが `NoteHtml.create` は 4 か所にあり `editTextNodes` / `inlineStylesheets` / `rewriteReferences` も投げる。JSDoc を「`NoteHtml` を組む全メソッド」に広げテスト 2 件 | — |
| [W-003] application/note/emptyTrash.ts:isSkippableRefusal | 011 | backend-note | fix | `isConflictError` 全体を飛ばすため `ACCOUNT_DELETING` / `WORKSPACE_DELETING` の障壁下で 50 件が黙って飛び「0 件を完全に削除しました」になる。`OPTIMISTIC_LOCK_FAILURE` に絞る | — |
| [W-001] spec/domains/index.md:298 / spec/database/index.md:39 | 011 | backend-tag | fix-editorial | **同じ表・規則の 6 回目**（004/006/008/009/010/011）→ エスカレーション: ADR-134 で例外列挙をやめ多重度の 4 分類へ書き直す。表 40 行すべてが分類に収まることを実数で確認（13+21+4+2=40） | ADR-134 |
| [W-002] application/note/deleteNotesForOwner.ts:readOwnerPurgeTurn | 011 | backend-tag | fix | 要素単位の `continue` で破損を黙殺し、`carried=[]` かつ列挙空なら `settle` が `note` 成分を ack して `complete` — 取り消せない誤 ack。reader 4 本で方針が 3 通りに割れているのが根なので、破損 payload の方針を規約として canon に置く | — |
| [W-003] spec/database/index.md:21 / cloudflare noteRepository.ts:delete | 011 | backend-tag | fix | 「削除経路でも scope 鍵を検査する」と規則を広げた（本 PR が書いた文）が `readForUpdate` は version しか見ない。`ensureRowInScope` を抽出して `restore` と共用（`restore` 側の既存 guard も未テストだったのでテストを追加） | — |
| [W-004] spec/usecases/identity.md:801,811 | 011 | backend-tag | fix-editorial | 入力 DTO が `{ scope, asOf }` のままで表・実装と食い違う。`{ scope, operationId, asOf }` へ | — |
| [W-001] domain/storage/services/uploadValidationPolicy.ts:MEDIA_SVG_MAX_DEPTH | 011 | general | fix | **ラウンド010 の現在形化が偽の主張を作った。** 「素の再帰で 1,000 段なら `RangeError`」は偽で、実測では 256 段から `NOTE_HTML_TOO_COMPLEX`。TC-storage-266 の 3 本目は `<b>` が breakout 要素のため depth gate に検出力ゼロ（門を外しても緑のままであることを確認）。方針値として言い切り、fixture を `<g>` 入れ子へ | — |
| [W-002] application/workers/subscribers.ts:246 | 011 | general | fix-editorial | 「unordered too」が同 JSDoc の「registration order」とテスト名に矛盾。失われるのは完了の保証 | — |
| [W-003] spec/usecases/usage.md:69 | 011 | general | fix-editorial | `ensureUploadAllowed` の呼び出し元を `storeUpload` だけと書くが `storeMedia` も呼ぶ | — |
| [W-004] docs/frontend_implementation_example.md:213 | 011 | general | fix-editorial | 「`NoteList` / `NoteDetail` render read-only markup」が偽（島が rename / trash / restore を持つ） | — |

## ラウンド 011

- fix: 13 / fix-editorial: 5 / wont-fix: 0 / defer: 0
- fix内訳: backend-note 2 / backend-storage 休止 / backend-tag 2 / frontend 7 / general 2
- backend-storage はラウンド010 の fix 内訳 0 のため**休止**。担当範囲（storage / usage / integration）は general が引き継ぎ、実際に general [W-001]（ラウンド010 の書き換えが偽の主張を作った件）を拾った
- **編集島の Blocker が 4 ラウンド連続**（008 / 009 / 010 / 011）。ラウンド011 [B-002] はラウンド010 で足した `dirty` の門そのものが作った回帰
- 判断点 — **編集島の方針として選択肢 Z を採用**（ADR-133）:
  - **X（対症・`RetryTarget` に `discard` を足す）** — retry 固有の方針が残るため表を 10 行に増やしても同じ型の穴が空く
  - **Y（#68 全体の取り込み・`commit` の分割）** — 今回の 2 件はどちらも `commit` の外（面の契約と `retryFailed`）にあり**この案では防げない**。2,600 行の島の中核を書き換えるとレビューが新規コードの全面再検査になり収束を遠ざける
  - **Z（採用）** — `retryFailed` を「一次経路の入口を呼ぶだけ」にし、retry 固有の判断を消す。`RetryTarget` を一次経路と 1 対 1 に。`commit` 本体は触らない。**B-002 と W-001 は Z なら構造的に防げた**（再試行が別の方針を持てないため反転が書けない）。#68 には「再試行の宛先の半分を本 PR で閉じた」旨を追記済み
- 単位 A の完了条件として「一次経路 5 つ × 落ちる位置（往復前 / 確定後）の全組み合わせを JSDoc に書き切る」「TC-10 の 7 手順を WYSIWYG で机上追跡する」を課した
- ラウンド010 の現在形化が**偽の主張を 2 件**作っていた（backend-note [W-001]・general [W-001]）。以後の文言修正は「書く前に実装で裏を取る」ことを委譲プロンプトに明記する
| [W-001] spec/domains/note.md:741（HtmlTooComplex 列挙欠落） | 012 | backend-note | fix-editorial | 本 PR が足した `HtmlTooComplex` が正典の列挙に無く、4 か所が存在しないコード名を参照。列挙に足し名前形へ統一 | — |
| [W-002] domain/note/ports/noteRepository.ts:findNextPurgeDeadline（同一 UoW の反転行） | 012 | backend-note | fix | 「`save` で `active→trashed` に反転させた行を同じ UoW の答えに含める」を JSDoc・inventory・database/index.md が契約と宣言しているのに、それを主張するテストがどこにも無い（1 件目で `null` を返す実装でも緑）。ADP-note-057 にケースを足し TC-note-793 を 2 本。cloudflare でも緑、`matches` を潰す変異で赤になることを実測 | — |
| [W-003] spec/inventory/test.md:1081,1748 | 012 | backend-note | fix-editorial | 前ラウンドで testcases を `OPTIMISTIC_LOCK_FAILURE` に絞ったが台帳 2 行が旧文言のまま | — |
| [W-001] spec/domains/index.md:333 / deleteNotesForOwner.ts:readOwnerPurgeTurn | 012 | backend-tag | fix-editorial | 「fault した行は `dueAt` を保ったまま backoff で残る」は偽。runner は `backoff` に落とし `dueAt` は前へ進み上限で `failed` に駐車。**ラウンド011 の修正が提案文をそのまま canon に写した結果の偽** | — |
| [W-002] collectOrphanMedia.ts:readOrphanMediaSweepTurn | 012 | backend-tag | fix | 規約「再開位置 fallback は warn を残す」に対し orphan reader は黙って `null`、barrier prune の warn はテストが見ておらず検出力ゼロ。reader を `{ cursor, fromPayload }` 形に揃え、鍵があるのに読めないときだけ warn | — |
| [W-003] spec/usecases/{tag,storage,integration}.md / note.md:954 DTO | 012 | backend-tag | fix-editorial | 継続鍵 `operationId` と `scope`、`stuckPurges?` が入力 DTO に無い（ラウンド011 [W-004] の identity と同型の残り 4 か所） | — |
| [W-004] spec/domains/index.md:323 | 012 | backend-tag | fix-editorial | 参照先の節に式が無い（式は `database/index.md` の物理配置直後）。参照側だけ直し式は動かさない | — |
| [B-001] NoteEditor/editor.tsx:takeSnapshot（stale closure） | 012 | frontend | fix | `takeSnapshot` が `title` / `mode` / `body` / `baseline` を描画時の閉包から読むため `sameSnapshot` のタイトル比較が恒真になり、往復中に打ったタイトルが門をすり抜けて載せ直しで消える。**門を足すのではなく「閉包から読む」クラスを消す**（ADR-136）。完了条件を grep で検証可能にした | ADR-136 |
| [W-001] NoteEditor/editor.tsx:restore / reloadFromServer | 012 | frontend | fix | ラウンド011 [W-001] から継承（再指摘 2 回目・新事実あり）。崩れていたのは ADR-133 の前提ではなく Decision 3 点目（`restore` の `try` を分け後者を `reload` に分類）。**第 2 往復そのものを消す**（ADR-135）— 応答が `title` / `html` を運び 2 段目を同期化。集約を戻すのではなく完成させる | ADR-135 |
| [W-002] NoteEditor/editor.tsx:SaveIndicator | 012 | frontend | fix | `failed` を `retry.kind` によらず一律の文言で出す。閉じた `Record` を `saveStatus.ts` に置く | — |
| [W-001] spec/inventory/test.md:1860（TC-storage-074） | 012 | general | fix-editorial + defer | 前提の購読者 `applyStorageDelta` は **Issue #6 のチェックリスト**（UC-usage-003）の持ち分。本 PR は「`markProcessed` を呼ばない」まで（TC-storage-069/070）を固定し、handoff を JSDoc と describe に宣言。#6 にコメント済み | #6 |
| [W-002] spec/usecases/usage.md:69 | 012 | general | fix-editorial | 呼び出し元の列挙が同ファイル `:16` と食い違う（**ラウンド011 の修正が `startBulkUpload` を落とした**）。再指摘 2 回目・同一行 | — |

## ラウンド 012

- fix: 5 / fix-editorial: 7 / wont-fix: 0 / defer: 1（部分。TC-storage-074 のテスト本体を Issue #6 へ）
- fix内訳: backend-note 1 / backend-storage 休止 / backend-tag 1 / frontend 3 / general 0
- **収束の転換点。** 指摘総数 17（R010）→ 18（R011）→ **12**、Blocker 3 → 2 → **1**。
  **4 ラウンド続いた「前ラウンドの修正が次の Blocker を作る」連鎖が止まった** — 今回の [B-001] は
  `takeSnapshot` の stale closure で、ADR-133 の構造変更とは独立の穴
- 前ラウンドの修正はレビュアーの独立検証を通過: 継続要求表の 4 分類は 40 行すべて収まり漏れゼロ（backend-tag が自分で数え直し）、
  `MEDIA_SVG_MAX_DEPTH` の書き換えは実装と一致し新 fixture は検出力あり（general が実測）、サニタイズの迂回なし（迂回入力 90 種の実走）
- 判断点 3 つの結論:
  - **frontend [W-001] は案 (a)「第 2 往復そのものを消す」**（ADR-135）。崩れていたのは ADR-133 の**前提**ではなく **Decision の 3 点目**で、
    分けた結果「確定は済んだが手元の確定値は古い」状態が生まれ、破棄の失敗（何も動いていない）と同じ種に載ったため違いが型から消えていた。
    退けた案: `failed { reload }` に印を足す（ADR-133 が消した「再試行固有の門」そのもの）／2 段目を `revision` に戻す（R011 [W-001] が戻る）
  - **`reseedIfUnchanged` の門を置き換えの直前へ動かす**（レビュー未指摘だが採用）。ref で [B-001] を塞いだ後に残る窓（fetch の RTT 中の打鍵が上書きされる）は
    次ラウンドで同じ見出しで挙がる形なので先回りする。新しい門ではなく既存の門の評価時点を揃えるだけ
  - **TC-storage-074 は #6 へ handoff。** 前提の `applyStorageDelta` が #6 のチェックリストなので、本 PR はコード側に宣言を置くに留める
- ラウンド010 / 011 の修正が**偽の主張を作った件が今回も 2 件**（backend-tag [W-001]・general [W-002]）。
  以後の文言修正には「書く前に実装で裏を取る」を委譲プロンプトの必須条件にしている
| [B-001] NoteEditor/editor.tsx:commit(importing) | 013 | frontend | fix | `commit` が `importReferences` を閉包から読み、自動保存 effect の依存にも無い。1.5 秒のデバウンス中に切り替えた「取り込まない」が無視される。**ADR-136 で消したはずのクラスの消し残し** — 完了条件を 4 識別子の grep に絞ったため ref に載せ忘れた state が検査を素通りした。完了条件を計算へ変える（ADR-137） | ADR-137 |
| [W-001] NoteEditor/editor.tsx:保存して切り替える(pendingMode) | 013 | frontend | fix | `await` の後に state `pendingMode` を直読み。同じクラス。「取りやめ」は `disabled` を付けず ref 読みで塞ぐ（往復中の取りやめは効いてよい操作） | ADR-137 |
| [W-002] routes/notes/-action.tsx:258 / editor.tsx:1462 | 013 | frontend | fix-editorial | `blocked` へ落とすのは `seedLatest` なのに `reseedFromServer` を指す記述が 2 か所残る（ラウンド012 の分割が残した） | — |
| [W-003] spec/manual-tests/editing.md:89（TC-04 手順 5） | 013 | frontend | fix-editorial | 括弧書きの理由が偽。経路単位の枝は手順 5 では偽で、タイトルが残るのは `confirm` の関数型 `setTitle` による。同一行 2 回目 | — |
| [W-004] editor.tsx:commit catch / preferences.ts:write | 013 | frontend | fix | `write` が `void` で `setItem` の例外を黙殺し `commit` は無条件に `stashed: true`。`localStorage` が投げる端末で「退避した」と偽る。`boolean` 化して戻り値で決める | — |
| [W-001] spec/inventory/test.md:2614（TC-note-819 経緯語り） | 013 | backend-note | fix-editorial | 台帳だけが「従来は 26 秒焼いて」を持つ。単位 D の写し直しに吸収 | — |
| [W-002] spec/testcases/note/{trashNote,restoreNoteRevision}.md | 013 | backend-note | fix-editorial | テストが主張している契約に testcases の行が無い 2 件（ラウンド012 / ADR-135 が足したテストに行が付いていない）。TC-note-831 / 832 を採番 | — |
| [W-003] spec/domains/note.md:439 | 013 | backend-note | fix-editorial | ポート節の `findNextPurgeDeadline` に「同一 UoW で反転させた行を答えに含める」節が無い（他 4 か所は持つ） | — |
| [W-001] application/cleanup/notePurgeFanOut.ts:readNotePurgeTurn | 013 | backend-tag | fix | `deletionOperationId: ""` を黙って `null` に読み替え、admission を飛ばし priority を格下げする。`""` を生む書き手は無い（decoder が `z.string().min(1)` で拒否）。canon の「仕事を名指す欄が読めなければ fault」の唯一の例外だったので `corrupt` へ | — |
| [W-002] 記述の衛生（tag.md / subscribers.test.ts / ADP-tag-019） | 013 | backend-tag | fix-editorial | 経緯語り 2 件と、ADP-tag-019 が限定子を落として memory に対し偽（memory は scope ごとの表なので保存側だけで性質が立つ設計）。ADP-tag-012 と同じ限定子を付ける | — |
| [W-001] spec/inventory/test.md × spec/testcases/*（37 行） | 013 | general | fix + defer | 台帳が「testcases から生成」と自称しながら 37 行が食い違う（36 行が本 PR 起因）。**同種の指摘は 3 回目（R010 / R012 / R013）で、行ごとに直してきたため再発している** → 行ではなく手順を直す: 19 ファイルを全行写し直し、ヘッダーに同期の手順を書く。範囲外の 56 行は方向を行ごとに判断する必要があるため Issue #69 へ | #69 |
| [W-002] spec/testcases/storage/collectOrphanMedia.md:23 | 013 | general | fix-editorial | ラウンド012 で足した warn の規則をテストは主張しているが TC 行が書いていない | — |

## ラウンド 013

- fix: 5 / fix-editorial: 7 / wont-fix: 0 / defer: 1（範囲外の台帳 56 行を Issue #69 へ）
- fix内訳: backend-note 0 / backend-storage 休止 / backend-tag 1 / frontend 3 / general 1
- general はラウンド012 の fix が 0 で規則上は休止対象だったが、**休止すると storage / usage / integration が丸ごと無レビューになり、カバレッジ規則で結局レビュアーを 1 体足すことになる**ため継続した
- **指摘総数 12（前ラウンドと同数）、Blocker 1。** 編集島の Blocker が「前ラウンドの修正が作った回帰」ではない状態は 2 ラウンド続いている
- 前ラウンドの修正はレビュアーの独立検証を通過: 継続まわりの JSDoc / canon / 実装が一致し reader 4 本の方針も揃う（backend-tag）、conformance の新ケースは cloudflare を変異させると赤（backend-note）、TC 1,030 / ADP 203 すべて台帳に行あり（general）
- 判断点 3 つの結論:
  - **規約の完了条件を「列挙」から「計算」へ変える**（ADR-137）。ラウンド012 の [B-001] を「クラスを消す」形で直したのは正しかったが、完了条件を識別子 4 つの grep と書いたため、`liveRef` に載せ忘れた state が検査の対象語に入らず素通りした。`liveReads.test.ts` が AST で F（`useState` の束縛名 ∪ 派生 const）と G（`await` を持つ関数からの到達集合）を**計算**し、G の中の式位置の F が 0 件であることを主張する。**同じ失敗の型は継続要求表でも起きており**（例外の列挙が 6 ラウンド漏れ続け ADR-134 で分類に書き直した）、列挙をやめて計算・分類にするのがこのループで繰り返し効いている形
  - **`liveRef` に載せるのは「島の全 state」ではなく「往復をまたぐ関数が読む値すべて」**（7 値）。全 state を載せても保証は増えず（保証はテストが担う）、未使用フィールドが増えるだけ。範囲は人が列挙するのではなくテストが強制する
  - **台帳は行ではなく手順を直す。** 同種の指摘が 3 回目なので、19 ファイルを全行写し直してヘッダーに同期の手順（鍵の形・写す列・リンクの書き換え・testcases が正）を書く。生成スクリプトは置かない（台帳は spec の文書で、手順を書けば「生成元」の主張は真になる。スクリプトを足すとその検出力自体がレビュー対象に増える）
- `typescript` を `apps/web` の devDependencies に追加（hoist で解決できてはいるが未宣言の import は pnpm 的に不健全）
| [W-001] NoteEditor/__tests__/liveReads.test.ts:F/G の計算 | 014 | frontend | fix | **レビュアーが独立 runner を作って実測**し、4 形（参照渡しで後から走る局所関数・`useMemo` / `useTransition` の描画値・props・局所関数経由の派生値）が違反 0 で素通り、仮引数の名前衝突で偽陽性と判明。ADR-137 の判断（列挙をやめ計算にする）は正しく、誤っていたのは**計算の定義域**。定義域を広げ、陽性 9 本 + 陰性 1 本を置き、主張を定義域とセットで述べる（ADR-138）。方針フェーズが試作して「広げても現ツリーで赤くなるのは props の読み 2 行だけ」を実測済み | ADR-138 |
| [W-002] NoteEditor/editor.tsx:「保存して切り替える」 | 014 | frontend | fix | `commit(true)` の後 `enterMode(next)` を直接呼び、`dirty` の門（`requestMode` にしかない）を通らない。往復中の打鍵が確認なしに消える。`liveRef.current.dirty` で門を掛ける（`requestMode` を呼ぶ案は描画閉包の `dirty` を読む経路になり `liveReads` が赤になるので不採用） | — |
| [W-001] adapters/conformance/{tagAssignmentRepository,backupRecordRepository}.ts | 014 | backend-tag | fix | ポート JSDoc と ADP-tag-010 / ADP-integration-008 が `SystemError(DatabaseError)` を名指すのにスイートは `isSystemError` しか pin していない。`scopeGuards.test.ts` の先例と同形に（検出力だけの問題で両バックエンドは正しい値を返す） | — |
| [W-001] docs/test.md:Convention scans | 014 | general | fix-editorial | `adrReference.test.ts` の番号解決は `apps/web/app` / `packages/core/src` のみ（`spec/` / `docs/` は作業ログ引用検査だけ）なのに 4 ルートすべてと書いている。「Two of them」も 3 本が正しい。**テストは広げず docs を実態に合わせる**（広げると新しい検出力の検証がこのラウンドで増える） | — |
| [W-002] spec/usecases/note.md:888 ほか（TC-note-779） | 014 | general | fix-editorial | 「従来どおり」という経緯記述が canon の 3 か所に残る。台帳はヘッダーの手順どおり testcases から写し直す | — |
| [W-003] spec/inventory/{adapter,usecase}.md:3 | 014 | general | fix-editorial | 本 PR が行を足しているのに「最終同期: 2026-08-30」のまま（`test.md` だけ更新済み） | — |

## ラウンド 014

- fix: 3 / fix-editorial: 3 / wont-fix: 0 / defer: 0
- fix内訳: backend-note 休止 / backend-storage 休止 / backend-tag 1 / frontend 2 / general 0
- **Blocker が初めてゼロ**（010 3 → 011 2 → 012 1 → 013 1 → **014 0**）。指摘総数も 6 件（013 は 12 件）
- backend-note も前ラウンドの fix ゼロで休止。backend-storage と合わせて general が範囲を引き継いだ
- 前ラウンドの修正はレビュアーの独立検証を通過: 台帳の写し直しは本 PR の testcases 20 ファイルで**食い違い 0**（general が手順どおりのスクリプトで再照合）、`findNextPurgeDeadline` の契約は spec / port JSDoc / `session.readRows` / conformance の 4 者一致、継続まわりは全項目通過
- 判断点 3 つの結論:
  - **frontend [W-001] は「両方」**（定義域を広げ、かつ主張をその定義域に合わせる）。**主張だけ直して穴を残す案は採らない** — レビュアーは独立 runner を持っており次ラウンドでも同じ 4 形を流すのが確実で、文言を限定しても「陽性ケースが無い」「4 形が素通り」は事実として残る。偽陽性のリスクは方針フェーズが試作で潰した（F は 30 → 62 語に増えるが違反は props の 2 行だけ、仮引数の偽陽性は `isShadowed` を `fn` まで上げると消える）。**表に載せるのはフックの意味論だけ**（4 つ）で state 名の表ではないため「列挙に戻した」ことにはならない
  - **[W-002] の門の材料は `liveRef.current.dirty`。** 写し比較（`sameSnapshot`）案はタイトル正規化の分岐を複製することになり、かえって指摘を呼ぶ
  - **general [W-001] はテストを広げない。** `DOC_FILES` を番号解決にも掛けると、新しい検出力をこのラウンドで検証する仕事が増える
- このループで繰り返し効いている形: **「列挙をやめて計算・分類にする」**（継続要求表 → 多重度の 4 分類 / 完了条件 → 禁止集合の計算）に加え、今回**「計算の定義域も明示する」**まで到達した
