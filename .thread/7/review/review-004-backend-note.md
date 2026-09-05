### backend-note

#### Blockers

**[B-001]** `filterCss` の走査がエスケープを見ないため、`position: fixed` / `sticky` の除去をバイパスできる

- 場所: `packages/core/src/adapters/html/css.ts:172-202`（`scanTo`）/ `:204-230`（`findBlockEnd`）。`skipString`（`:59-74`）と `canonicalize`（`:136-170`）は `\` を正しく扱っているのに、文・ブロックの分割側だけが扱っていない
- 理由: `scanTo` は `\` を素通りさせてから `"` / `'` / `(` を見るので、**ブラウザが「エスケープされた 1 文字」として読む引用符・括弧が、走査側では文字列／グループの開始になる**。開いたまま入力末尾に達するので `scanTo` は `-1` を返し、宣言全体が 1 文として扱われ、`disallowedPositionProperty` は先頭プロパティ（`content` など）しか見ない。結果として **後続の `position:fixed` が判定にかからないまま素通りする**。ADR 013 が CSS 節を置いている理由そのもの（Shadow DOM はレイアウトを隔離しないので `<style>` 1 個で公開ページ全面を覆える）が成立しない。実際に出荷アダプターを走らせて確認した:

  | 入力 | `process` の出力 | `removed` |
  | --- | --- | --- |
  | `<p style="content:\&quot;;position:fixed">x</p>` | `<p style="content:\&quot;;position:fixed">x</p>` | `[]` |
  | `<p style="content:\';position:fixed">x</p>` | 入力のまま | `[]` |
  | `<style>.a{content:\";position:fixed}</style>` | 入力のまま | `[]` |
  | `<p style="background:url\(x;position:fixed">x</p>` | 入力のまま | `[]` |
  | `<style>.a{background:url\(x;position:sticky}</style>` | 入力のまま | `[]` |

  CSS Syntax の consume-a-token では `\` + 改行以外は valid escape なので、`\"` は文字列の開始ではなく ident-like token になり、直後の `;` が宣言を終端する。つまり上の 4 例はいずれもブラウザ側では `position` 宣言として**適用される**。経路は ED-03（HTML モードの貼り付け）で誰でも踏める
- 同じ根が逆向きにも出る（装飾の取りこぼし）: `<style>@import url\(a;.b{position:fixed}</style>` は `<style></style>` になり、`@import` の除去 1 件だけを報告して `.b` の規則ごと消える。`filterCss` の「壊れた CSS は拒否せず運ぶ」という前提が、エスケープを見ないせいで「呑み込む」に変わっている
- 提案: `scanTo` / `findBlockEnd` のループ先頭に、コメント判定と同じ位置で `if (char === "\\") { i += 2; continue; }` を置く（`canonicalize:154` と同じ扱い）。エスケープは常に 2 文字を消費するだけなので、終端子の書き戻し規則（`pushStatement:267-297`）は変わらず、不動点も崩れない（`content:\";position:fixed` → `content:\";` を 2 度通しても同じ）。回帰は `htmlProcessor.test.ts` のテーブルに上の 5 例と、対応する fixed-point 入力を足す

**[B-002]** 止まった purge の ID が `settle` の transaction にしか残らず、その transaction が落ちると退会が消し残したまま終端する

- 場所: `packages/core/src/application/note/deleteNotesForOwner.ts:254-297`（`purgeEachNote` — 検知するが書かない）/ `:319-393`（`settle` — ここで初めて payload に載る）/ `packages/core/src/application/workers/scopeTaskRunner.ts:334`・`:341-357`（handler が投げると `backOff` するだけで、行の payload は既存のまま）
- 理由: 本ラウンドの主張は JSDoc（`deleteNotesForOwner.ts:157-176`）にある通り「列挙が尽き、かつ持ち回る対象が 1 件も残らなかった turn だけが ack する」だが、**持ち回る対象は turn の最後にまとめて 1 回書かれるだけ**である。`settle` 自身の `scopeUnitOfWorkProvider.run` が落ちれば（stuck purge を生む障害と同じ incident で十分ありうる）、その turn で見つけた ID はどこにも残らない。以後:
  1. local delete は commit 済みなので `listByOwner` に出ない
  2. route は `purging` なので `resolve` にも出ず、`purging` を列挙する手段はない
  3. 次の turn（同じ行の再駆動でも、`cleanupDispatch` からの再配送でも）は `stuckPurges` を持たない
  → 列挙が空 = scope が空と読んで `note` 成分を ack し、`markCompleted` まで進む。ack は取り消せない（以後の cleanup command は `assertOwner` で拒まれる）。**公開投影の行が残ったまま退会が完了する**（AC-9 / ED-10 の「削除後は公開・共有 URL からアクセスできなくなる」に反する）
- 最短の再現は初回 turn: `cleanupDispatch.ts:63-71` から呼ばれる 1 回目は既存の scope-task 行を持たないので、`settle` が落ちれば ID はどの行にも載らず、継続イベントの再配送が空の列挙を ack する。`deleteNotesForOwner.test.ts` の TC-note-782 / 788 / 789 はいずれも `settle` が成功する前提で、この窓を突いていない
- 提案: 検知した瞬間に永続化する。`purgeEachNote:284` で `isOutOfReach` が真になった時点で、その場で小さな `scopeUnitOfWorkProvider.run` を開いて `stuckPurges` の現在値で行を upsert（`schedule`）し、`settle` はそれを精算するだけにする。そうすれば `settle` の失敗は「行が既に持っている ID を書き直せなかった」で済み、ack には至らない。あわせて JSDoc の「acknowledges only once the enumeration is exhausted *and* nothing is left stuck」が無条件に真になる

#### Warnings

**[W-001]** `purgeNote` の commit gate が `assertOwner` を `reclaim` より先に置いているため、resume 経路で「local delete 済みのノートの route を abort する」が起きうる

- 場所: `packages/core/src/application/note/purgeNote.ts:545-556`（`deleteLocally` の順序）、`:130-134`（`isAbortableRefusal`）、`:302-312`（abort の分岐）
- 理由: `resumeInternal`（`:464-503`）が返す plan は「local delete が既に commit しているかもしれない」状態を表す。そこで `deleteLocally` に入ると **`reclaim` で「もう無い」と分かる前に** `assertOwner` が走る。cleanup の所有が失われていれば `ConflictError` → `isAbortableRefusal` が真 → `abortQuietly` が route を `active` に戻す。これは同じファイルの JSDoc（`:118-128`）が「commit 後に abort すると、消えたノートを指す route が永久に何も解決しない行として残る」と明示的に禁じている状態そのもの。しかも route が `active` に戻ると `isOutOfReach` が偽になり、次の turn は stuck と見なさず ack してしまう（B-002 と同じ終着点）
- 到達には「持ち回り中の stuck purge がある」かつ「列挙の `assertOwner` 通過後に所有が失われる」（`abortPersonalAccountDeletion` / 完了済みバリアへの遅延配送）の同時成立が要るので Blocker にはしないが、順序を入れ替えるだけで消える
- 提案: `reclaim` を先に呼び、`null`（＝既に purge 済み）なら `assertOwner` を飛ばして forward-only 経路に入る。ノートが実在した場合だけ `assertOwner` を問う

**[W-002]** `spec/usecases/note.md#deleteNotesForOwner` 手順 4 が、実装が守れない要求のまま残っている

- 場所: `spec/usecases/note.md`（`deleteNotesForOwner` 手順 4、本 PR で未変更）vs `packages/core/src/application/note/deleteNotesForOwner.ts:178-186`
- 理由: spec は継続要求を「そのバッチの最後の削除と同じ scope-local `UnitOfWorkProvider.run` の中で」積めと書くが、purge は 3 ストアに跨るサガで自分の transaction を持ち、`run` の入れ子は禁止なので実装は別 transaction（`settle`）で積む。実装側はこれを JSDoc で "Divergence from the spec's step 4" と明記しているが、CLAUDE.md は `spec/` を正典とし「そこに書かれていることはコードについて真であることを意図している」と定めている。判断が変わったのだから spec を直す側の話で、コードコメントに逃がす話ではない（B-002 の窓もこの手順 4 が成立しないことの帰結なので、spec に書けば窓も明示される）
- 提案: 手順 4 を「バッチ直後の別 transaction で積む。その間に応答を失うと行が張られないので、同じコマンドの再配送が回復経路である」に改める。手順 6 が持ち回りを要求している以上、「再配送では回復できない残余」（B-002）も同じ節に置く

**[W-003]** `purgeExpiredTrash` / `emptyTrash` には持ち回りが無く、止まった purge の残余が spec にも記録されていない

- 場所: `packages/core/src/application/note/purgeExpiredTrash.ts:100-121`（失敗は log するだけ）/ `:150-166`（`findNextPurgeDeadline` が `null` なら `complete`）、`packages/core/src/application/note/emptyTrash.ts` の同期経路
- 理由: 保持期限の掃除で local delete 後に停止すると、そのノートは `listPurgeable` にも `findNextPurgeDeadline` にも二度と現れない（行が消えているため）。したがって次の turn は「ゴミ箱が空」と読んで **task を `complete` する**。以後、公開投影の行を消すものは何も無い。`emptyTrash` の同期経路も同じ形（`userRequest` の operationId は採番なので再送で resume すらできない）。`purgeNote.ts:274-283` の JSDoc は「recovery driver は本スライスの外」と宣言しているが、`spec/usecases/note.md#purgeExpiredTrash` にも `spec/testcases/note/purgeExpiredTrash.md` にも、`spec/usecases/note.md#emptyTrash` にもこの残余は書かれていない。ED-09 の「削除後は公開・共有 URL からアクセスできなくなる」に触れる性質なので、少なくとも正典に残す必要がある
- 提案: 両ユースケースの節に「local delete 後に停止した purge を拾い直す駆動は本スライスに無い」ことと、それを閉じる予定（recovery driver / scope の route 走査）を明記する。`deleteNotesForOwner` が持ち回りで閉じた側との非対称も併記すると、次のスライスが何を足すべきかが読める

**[W-004]** `spec/testcases/note/purgeNote.md` の「FK CASCADE」の行が実装と食い違う（**既存の問題**、ただし本 PR が `purgeNote` を実装した回）

- 場所: `spec/testcases/note/purgeNote.md`（「完全削除後 | 版（`note_revisions`）を確認する | DB の FK CASCADE で同時に削除される」。本 PR の差分外の行）vs `packages/core/src/application/note/purgeNote.ts:566`（`ctx.noteRevisionRepository.deleteByNote` を明示的に呼ぶ）と同ファイル `:534-543` の JSDoc（「このリポジトリのどのスキーマも foreign key を宣言していない」）
- 理由: 観測結果（版が消える）は同じだが、期待結果が機構を名指ししており、その機構は存在しない。テストケースは実装の正典なので、読んだ人が FK に依存した実装を書ける
- 提案: 「purge の transaction が `deleteByNote` で明示的に消す（本リポジトリのどのスキーマも FK を宣言しない）」に置き換える

**[W-005]** `spec/adr/013` がメディア挿入を ED-07 と書いている（**既存の問題**）

- 場所: `spec/adr/013-html-sanitization-policy.md`（「取り込み・メディア挿入（ED-07）」と「- メディア挿入（ED-07）」。いずれも本 PR の差分外）vs `spec/scenario/editing.md:111`（ED-06 が「画像や動画をアップロードして本文に挿入する」、ED-07 は「タイトルを変更する」）
- 理由: ADR 013 は本スライスのサニタイズ規則の正典で、その適用点の一覧が別シナリオを指している
- 提案: 2 か所とも ED-06 に直す

#### テスト保証

- サニタイズ表が閉じていること: `htmlProcessor.test.ts` のテーブル駆動（TC-note-682〜720 ほか）が要素・属性・URL・CSS の 4 種の除去を出力 HTML と `removed` の両方で押さえている
- **`process` が不動点であること**: `sanitizeCases` の全入力 + 見出し ID 生成 + `link rel=stylesheet` の痕跡 + `@media` 入れ子を `process(process(x)) === process(x)` で確認（`htmlProcessor.test.ts:569-584`）。未終端の文字列・括弧・`</style>` 断片も入力に含まれる
- ただし **B-001 のエスケープ経路はこの表にもテーブルにも 1 件も無い**。`\66 ixed` / `\69 mport` のような「識別子のエスケープ」は網羅されているが、「引用符・括弧そのもののエスケープ」は無い
- `beginPurge` の操作単位冪等が CAS より先に効くこと: conformance ADP-note-043 の 2 ケースが、同一 operation の番兵世代 claim が通り、他人の operation は state / CAS のどちらでも拒まれることを両バックエンドで確認
- `listPurgeable` の `purgeAfter ASC, id ASC` と `findNextPurgeDeadline` の「`now` を見ない」性質: conformance ADP-note-013 / 057
- purge サガの中断窓: `purgeNote.test.ts` の TC-note-350〜355 / 780 が、claim 前の restore、local delete 前の除名、commit 後の応答喪失（route を `purging` に残す）、public remove 前の停止、tombstone 応答喪失をそれぞれ本物のアダプターに薄いラッパーを噛ませて確認。`note.purged` が二重に出ないことも押さえている
- 退会の持ち回り: `deleteNotesForOwner.test.ts` の TC-note-781 / 782 / 783 / 788 / 789 が、他人の operation が握る route を「削除済み」と畳まないこと、commit 後に止まった purge を payload で持ち回って tombstone まで運んでから ack すること、解消しない持ち回りが継続を増やさず backoff に落ちること、列挙が尽きても持ち回りが残る限り ack しないことを確認。**`settle` 自体が失敗する窓（B-002）は未検証**
- `note.purged` の fan-out: `subscribers.test.ts` が、兄弟 subscriber の 1 つが投げても残りが走り、最初の失敗が再送出されること（配送は失敗する）を呼び出し順とログの両方で確認
- 編集系の commit gate: `updateNoteBody` TC-note-732 / `applyTextNodeEdits` TC-note-015 / `renameNote` TC-note-404 などが、entry gate 通過後に除名されたケースを `NOTE_NOT_FOUND` に落とすことを確認。全編集ユースケースにゴミ箱拒否（TC-note-727 / 784〜787）と OCC 競合が揃っている
- 版の保持: `updateNoteBody` TC-note-725（新しい 20 件を残す）と `listNoteRevisions` TC-note-221（読み側も 20 件で頭打ち）が `NoteRevision.RETENTION` の 1 か所化を両側から押さえている
- 保持期限アラーム: `purgeExpiredTrash.test.ts` の UC-note-021 群が、`trashNote` が最も早い `purgeAfter` に張り替えること、期限が来ていなければ行を次の期限へ移すこと、ゴミ箱が空のときだけ `complete` することを確認
- 弱い assertion は実質無し（`toBeDefined()` は `deleteNotesForOwner.test.ts:200,228` の 2 件だが、いずれも他の等値 assertion と併用）。`not.toBe(...)` 単独は `:501`（`status` が `settled` でない）だが、同テストで `acknowledged` / `purgedCount` / 残件を等値で押さえている

#### カバレッジ

確認:

- `packages/core/src/adapters/html/allowList.ts`
- `packages/core/src/adapters/html/css.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`
- `packages/core/src/adapters/conformance/noteRepository.ts`
- `packages/core/src/adapters/conformance/noteRouteStore.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`
- `packages/core/src/adapters/memory/repositories/noteRepository.ts`
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts`（note 関連の配線）
- `packages/core/src/adapters/memory/store.ts`（ScopeStore の追加テーブル）
- `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/application/cleanup/notePurgeFanOut.ts`
- `packages/core/src/application/cleanup/participants.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/di/cloudflareRuntime.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
- `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`
- `packages/core/src/application/note/applyTextNodeEdits.ts`
- `packages/core/src/application/note/changeNoteStyleMode.ts`
- `packages/core/src/application/note/deleteNotesForOwner.ts`
- `packages/core/src/application/note/editing.ts`
- `packages/core/src/application/note/emptyTrash.ts`
- `packages/core/src/application/note/getNote.ts`
- `packages/core/src/application/note/jobs.ts`
- `packages/core/src/application/note/listNoteRevisions.ts`
- `packages/core/src/application/note/listTrashedNotes.ts`
- `packages/core/src/application/note/moveNote.ts`
- `packages/core/src/application/note/purgeExpiredTrash.ts`
- `packages/core/src/application/note/purgeNote.ts`
- `packages/core/src/application/note/renameNote.ts`
- `packages/core/src/application/note/restoreNote.ts`
- `packages/core/src/application/note/restoreNoteRevision.ts`
- `packages/core/src/application/note/trashNote.ts`
- `packages/core/src/application/note/updateNoteBody.ts`
- `packages/core/src/application/note/view.ts`
- `packages/core/src/application/note/__tests__/deleteNotesForOwner.test.ts`
- `packages/core/src/application/note/__tests__/editingHarness.ts`
- `packages/core/src/application/note/__tests__/`（applyTextNodeEdits / changeNoteStyleMode / emptyTrash / getNote / listNoteRevisions / listNotes / listTrashedNotes / purgeExpiredTrash / purgeNote / renameNote / restoreNote / restoreNoteRevision / trashNote / updateNoteBody の各 test.ts — ケース名と assertion 強度を確認）
- `packages/core/src/application/ports/noteMovePort.ts`
- `packages/core/src/application/ports/noteRouteStore.ts`
- `packages/core/src/application/ports/objectStorage.ts`（note が読む部分）
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/domain/note/noteRevision.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/noteRepository.ts`
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`
- `packages/core/src/domain/note/__tests__/noteAccessPolicy.test.ts`
- `spec/adr/013-html-sanitization-policy.md`
- `spec/domains/note.md`
- `spec/usecases/note.md`
- `spec/testcases/note/`（applyTextNodeEdits / changeNoteStyleMode / deleteNotesForOwner / emptyTrash / getNote / listNotes / listTrashedNotes / purgeExpiredTrash / purgeNote / renameNote / restoreNote / restoreNoteRevision / trashNote）
- `spec/inventory/adapter.md`（ADP-note-013 / 043 / 057 の行）

スキップ（担当外）:

- `apps/web/**`（frontend 担当）
- `packages/core/src/adapters/cloudflare/do/repositories/{backupRecordRepository,storedFileRepository,tagAssignmentRepository}.ts`、`do/schema.ts`（storage / tag 担当）
- `packages/core/src/adapters/memory/repositories/{backupRecordRepository,storedFileRepository,tagAssignmentRepository}.ts`（同上）
- `packages/core/src/adapters/conformance/{backend,backupRecordRepository,storedFileRepository,tagAssignmentRepository}.ts`、`cloudflare/__tests__/{conformance/scopeBusiness.test.ts,conformanceBackend.ts,deleteFilesByOwner.test.ts,ports/scopeBusiness.ts}`、`memory/__tests__/{conformance.test.ts,conformanceBackend.ts}`（同上）
- `packages/core/src/application/{integration,storage,tag,usage}/**`（storage / tag 担当）
- `packages/core/src/domain/{integration,storage,tag}/**`（同上）
- `spec/{database,platform,presentation,pages,manual-tests}/index.md`、`spec/domains/{integration,storage,tag}.md`、`spec/usecases/{integration,storage,tag}.md`、`spec/testcases/{integration,storage,tag}/**`、`spec/inventory/{test,usecase}.md`（他担当）
- `packages/core/package.json`、`pnpm-lock.yaml`（parse5 依存の追加のみ）
