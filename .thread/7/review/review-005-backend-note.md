### backend-note

#### Blockers

**[B-001]** `filterCss` の走査が `url(` の内側でもコメント（と文字列）を認識するため、`position: fixed` の除去をバイパスできる

- 場所: `packages/core/src/adapters/html/css.ts:157-172`（`readLexeme` — `url(` の内側かどうかを見ない）/ `:88-91`（`skipComment`）/ `:201-227`（`scanTo` の括弧深度）/ `:344`（宣言の切り出し）。適用点は `adapters/html/htmlProcessor.ts:338-347`（`style` 属性）と `:471-481`（`<style>` 要素）
- 理由: CSS Syntax の `consume-a-url-token`（§4.3.6）は、`url(` の直後が引用符でないとき**コード点をそのまま `)` まで読む**。コメントの解決は `consume-a-token` の入口でしか行われないので、**`url(` の内側の `/*` はブラウザにとってコメントではない**。ところが本モジュールは全走査を `readLexeme` に通すという設計上、`url(` の内側でも `/*` をコメントとして扱い、`*/` まで（無ければ入力末尾まで）読み飛ばす。結果として **`;` を見失い、宣言全体が 1 つの `background` 宣言として素通りする**。ADR 013 が CSS 節を置く理由そのもの（Shadow DOM はレイアウトを隔離しないので `<style>` 1 個で公開ページ全面を覆える）が成立しない。出荷アダプターの `process` を実際に走らせて確認した:

  | 入力 | `process` の出力 | `removed` | 不動点 |
  | --- | --- | --- | --- |
  | `<p style="background:url(x/*);position:fixed">x</p>` | 入力のまま | `[]` | true |
  | `<style>.a{background:url(x/*);position:fixed}</style>` | 入力のまま | `[]` | true |
  | `<p style="background:url(/*)*/;position:fixed">x</p>` | 入力のまま | `[]` | true |
  | `<style>.a{background:url(/*)*/;position:fixed;color:red}</style>` | 入力のまま | `[]` | true |
  | `<style>@media print{.a{background:url(y/*);position:fixed}}</style>` | 入力のまま | `[]` | true |

  ブラウザ側の読み方は次のとおりで、いずれも `position:fixed` が**適用される**。`url(x/*)` は url-token の値が `x/*` で `)` が閉じ、続く `;` が宣言を終端して次の `position:fixed` が独立した宣言になる。`url(/*)` も同様に値が `/*` で閉じ、残った `*/` で `background` 宣言だけが無効になり、`position:fixed` はそのまま効く。経路は ED-03（HTML モードの貼り付け）と ED-04 の保存で誰でも踏め、公開ページ（P-44）に載る
- 前ラウンドの B-001（エスケープ）を `readLexeme` へ一本化した修正自体は正しく、`content:\";position:fixed` などは塞がっている。今回の穴はその一本化が**逆向きに効いた**もので、「全走査が同じ 3 規則を知る」だけでは足りず、**`url(` の内側だけは 3 規則のうち 2 つが効かない**という 4 つ目の規則が要る
- 提案（両側）:
  - コード: `scanTo` / `findBlockEnd` / `canonicalize` が通る `readLexeme` に「直前の識別子が `url` である `(`」を検出したら、そこから**エスケープだけを尊重して次の `)` まで（または入力末尾まで）を 1 つの不透明な字句として返す」分岐を足す。`url(` の直後が空白を挟んで `"` / `'` のときだけは従来どおり関数トークンとして扱う（ブラウザと同じ分岐）。終端子の書き戻し規則（`pushStatement:290-315`）は変わらないので不動点も崩れない（上表はいずれも `filterCss(filterCss(x)) === filterCss(x)` を維持したまま除去される形になる）
  - 正典: `spec/adr/013-html-sanitization-policy.md:144` は「コメント・文字列・**エスケープ**の 3 つ」と書き切っているが、`url()` の内側で前 2 つが効かないことが**この節の主張の反例**になっている。3 つの列挙に「ただし引用符なしの `url(` の内側ではコメントも文字列も字句にならず、`)` までが 1 つのトークンである」を足し、「認識する場所は 1 か所」の条項をその 4 つ目も含む形に改める
  - 回帰: `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts` のサニタイズ表（エスケープ行は `:325-380`）に上表の 5 例を足し、不動点の入力一覧（`:629-640`）にも同じ 5 例を入れる

#### Warnings

**[W-001]** `purgeEachNote` の「行を狭めない」コメントが、同じ関数が実際に行う削除と食い違う

- 場所: `packages/core/src/application/note/deleteNotesForOwner.ts:280-285`（`pending` の seed に添えた「an entry leaves only by being purged, and an id the turn has not reached yet is still stuck」）vs `:310-314`（`isOutOfReach` が偽なら `pending.delete(key)`）
- 理由: 持ち回り中のエントリは **purge 成功以外にも抜ける** — route が再び resolve するようになった時点で削除される。安全性そのものは保たれている（resolve する route は `listByOwner` に現れるので、次の turn が通常の列挙で再会する）が、コメントが述べている根拠はその根拠ではない。この関数の安全性は「持ち回りは狭まらない」ではなく「持ち回りから抜けるのは、purge されたか、列挙で再会できるようになったときだけ」で成り立っている。B-002（前ラウンド）を閉じた不変条件そのものの説明なので、次に触る者が読む場所として正確でないと危ない
- 提案: コメントを「エントリが抜けるのは 2 通り — tombstone に到達したときと、route が再び resolve して列挙で再会できるようになったとき。どちらも次の turn がそのノートに到達できるので、行が狭まっても ack が ID を追い越さない」に直す

**[W-002]** 「検知した時点で行へ書く」という本ラウンドの中核の性質が、テストケースの正典に行を持っていない

- 場所: `spec/testcases/note/deleteNotesForOwner.md`（本 PR が足した 5 行。いずれも「payload に載る」までしか言わない）/ `spec/inventory/test.md:1752`（TC-note-782 の要点も同じ）vs `packages/core/src/application/note/__tests__/deleteNotesForOwner.test.ts:572`（"hands the stuck purge on even when the turn's own settle is lost" — TC-note-782 を再利用している）
- 理由: 実装側は `deleteNotesForOwner.ts:258-272` の JSDoc と `spec/usecases/note.md#deleteNotesForOwner` 手順 4 の 1 つ目の箇条書きで「検知した瞬間に書く／turn の終わりの transaction を失っても ack には至らない」を宣言しており、テストもその窓を突いている。しかしテストケースの表と台帳は「停止した purge の ID が payload に載る」までしか書いていないため、**「いつ書くか」を変える実装（settle にまとめる等）がテストケースの正典を 1 行も破らずに書ける**。ADR 052 / 058 は新しいテストケースに新 ID を末尾採番せよと定めており、既存 ID の再利用はその規約からも外れる
- 提案: `spec/testcases/note/deleteNotesForOwner.md` に「持ち回る対象を検知した turn の、最後の（行を精算する）transaction が失われる｜処理する｜検知時点で書いた行が残っているので ID は失われず、`note` 成分は ack されない」の 1 行を足し、`spec/inventory/test.md` に新しい TC-note-8xx を末尾採番する

#### テスト保証

- サニタイズ表が閉じていること: `htmlProcessor.test.ts` のテーブル駆動が要素・属性・URL・CSS の 4 種の除去を出力 HTML と `removed` の両方で押さえている。前ラウンドで欠けていた**エスケープ経路**（`content:\";position:fixed` / `background:url\(x;position:fixed` / `@import url\(a;.b{position:fixed}` の 5 例、`:325-380`）が入り、実際に除去されることを確認した
- **`process` が不動点であること**: `sanitizeCases` の全入力 + 見出し ID 生成 + `link rel=stylesheet` の痕跡 + `@media` 入れ子 + 未終端の文字列 / 括弧 / エスケープを `process(process(x)) === process(x)` で確認（`:628-640`）。終端子を補わない規則（`pushStatement`）が壊れていないことはここで担保されている
- ただし **B-001 の `url(` 経路はこの表にも不動点一覧にも 1 件も無い**。`url\(`（エスケープ）は入っているが、`url(` を**開いたまま**コメント記法を混ぜる形は無い
- `beginPurge` の「操作単位の冪等が CAS より先」: conformance ADP-note-043 の 2 ケースが、同一 operation の番兵世代（`-1`）による claim が通ること、`active` な route は番兵でも CAS で拒むこと、他人の operation は state / CAS のどちらでも拒まれることを両バックエンドで確認。ポート JSDoc（`application/ports/noteRouteStore.ts:90-108`）と順序の要求が一致している
- `listPurgeable` の `purgeAfter ASC, id ASC` と `findNextPurgeDeadline` の「`now` を見ない」性質: conformance ADP-note-013 / 057 が memory / cloudflare 双方で通る
- purge サガの中断窓: `purgeNote.test.ts` の TC-note-350〜355 / 780 が、claim 前の restore、local delete 前の除名、commit 後の応答喪失（route を `purging` に残す）、public remove 前の停止、tombstone 応答喪失をそれぞれ本物のアダプターに薄いラッパーを噛ませて確認。**`assertOwner` を `reclaim` の後ろへ移した効果**は `:495`（resume 時に所有を失っていても route を abort せず tombstone まで前進する）と `:523`（ノートが残っている場合は従来どおり route を `active` へ戻す）の 2 本が両向きから押さえている。認可の穴にはなっていない — `reclaim` が非 `null`（＝これから消す）を返す経路では必ず `assertOwner` が先に走り（`purgeNote.ts:575-577`）、`null` を返す経路は「ノートが既に無い」前進のみで、その route は同じ `operationId` の `purging` 行でしか claim できない（`RESUME_CLAIM` は他人の route を取れないことを ADP-note-043 が示している）
- 退会の持ち回り: `deleteNotesForOwner.test.ts` の TC-note-781 / 782 / 783 / 788 / 789 に加え、`:572` が**行を精算する transaction 自体を落として**「turn の最後の write の直前に行が既に ID を持っている」ことと、その後の worker round が tombstone まで運んで ack することを確認。前ラウンドの B-002 の窓は閉じている
- UoW の入れ子: `armStuckPurges`（`:342-367`）は `purgeNoteInternally` が throw して戻ったあと、どの `run` の内側でもない位置で自分の `run` を開く。`purgeEachNote` は `deleteNotesForOwner` の `run` 2 本の**外**で走る。`purgeNote.deleteLocally` も `admitInternal` の `assertOwner` 用 `run` を閉じてから開く。入れ子は無い
- spin しないこと: `settle`（`:421-453`）の 3 分岐と `ScopeTaskScheduler` の状態遷移表を突き合わせると、「新たに持ち回りが生まれた turn」だけが即時継続を積み、同じノートが 2 度「新たに」なることはないので（`:315-317` の `pending.has` ガード）、恒久的に失敗するノートは 2 turn 目から `backoffOrSchedule` に落ちて `SCOPE_TASK_MAX_ATTEMPTS` で駐車する。TC-note-783 がその落ち方を押さえている
- 編集系の commit gate: `updateNoteBody` / `applyTextNodeEdits` / `renameNote` / `changeNoteStyleMode` / `restoreNoteRevision` の全ユースケースに、entry gate 通過後の除名（`NOTE_NOT_FOUND`）・ゴミ箱拒否（TC-note-784〜787）・OCC 競合が揃っている
- 版の保持: `NoteRevision.RETENTION` の 1 か所化を、書き手（`deleteOlderThanNewest`）と読み手（`listNoteRevisions` / `moveNote.snapshotSource`）の両側から押さえている
- 保持期限アラーム: `purgeExpiredTrash.test.ts` の TC-note-790〜792 が backoff / 直後再予定 / 次期限への移動と `null` のときだけ `complete` を、`trashNote.test.ts` の TC-note-793 が「最も早い `purgeAfter` に張り替わる」を確認
- `note.purged` の fan-out: `subscribers.test.ts` が、兄弟 subscriber の 1 つが投げても残りが走り、最初の失敗が再送出されること（配送は失敗する）を呼び出し順とログの両方で確認
- 弱い assertion は実質無し。`toBeDefined()` は `deleteNotesForOwner.test.ts:201,229` の 2 件、`not.toBe(...)` / `not.toBeNull()` は `deleteNotesForOwner.test.ts:502`・`renameNote.test.ts:161`・`purgeNote.test.ts:244,413,534,635,638,702,735,750` だが、いずれも同じテスト内の等値 assertion（route の state、`purgedEvents` の件数、`acknowledged` の内容など）と併用されている
- `pnpm vitest run --project node packages/core/src/application/note packages/core/src/adapters/html` は 18 files / 493 tests green

#### カバレッジ

確認:

- `packages/core/src/adapters/html/allowList.ts`（ADR 013 の 4 表と 1 行ずつ突き合わせ）
- `packages/core/src/adapters/html/css.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`
- `packages/core/src/adapters/conformance/noteRepository.ts`
- `packages/core/src/adapters/conformance/noteRouteStore.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`
- `packages/core/src/adapters/memory/repositories/noteRepository.ts`
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts`（note 関連の配線）
- `packages/core/src/application/cleanup/notePurgeFanOut.ts`
- `packages/core/src/application/cleanup/participants.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
- `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
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
- `packages/core/src/application/note/__tests__/`（applyTextNodeEdits / changeNoteStyleMode / deleteNotesForOwner / editingHarness / emptyTrash / getNote / listNoteRevisions / listNotes / listTrashedNotes / purgeExpiredTrash / purgeNote / renameNote / restoreNote / restoreNoteRevision / trashNote / updateNoteBody）
- `packages/core/src/application/ports/noteRouteStore.ts`
- `packages/core/src/application/ports/noteMovePort.ts`
- `packages/core/src/application/ports/scopeTaskScheduler.ts`（`schedule` / `backoffOrSchedule` の状態遷移表を持ち回りの安全性の検証に使用）
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/domain/note/noteRevision.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/noteRepository.ts`
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`
- `packages/core/src/domain/note/valueObject.ts`（`NoteId.create` の失敗条件を `readOwnerPurgeTurn` の主張と突き合わせ）
- `packages/core/src/domain/note/__tests__/noteAccessPolicy.test.ts`
- `apps/web/app/worker/node/runner.ts`（scope task tick の直列性のみ確認）
- `spec/adr/013-html-sanitization-policy.md`
- `spec/domains/note.md`
- `spec/usecases/note.md`
- `spec/testcases/note/`（applyTextNodeEdits / changeNoteStyleMode / deleteNotesForOwner / emptyTrash / getNote / listNotes / listTrashedNotes / purgeExpiredTrash / purgeNote / renameNote / restoreNote / restoreNoteRevision / trashNote）
- `spec/inventory/test.md`（note 群の追加行）

スキップ（担当外）:

- `apps/web/**`（`worker/node/runner.ts` の tick 直列性を除く。frontend 担当）
- `packages/core/src/adapters/cloudflare/do/repositories/{backupRecordRepository,storedFileRepository,tagAssignmentRepository}.ts`、`cloudflare/do/schema.ts`（storage / tag 担当）
- `packages/core/src/adapters/memory/repositories/{backupRecordRepository,storedFileRepository,tagAssignmentRepository}.ts`、`memory/store.ts`（同上）
- `packages/core/src/adapters/conformance/{backend,backupRecordRepository,storedFileRepository,tagAssignmentRepository}.ts`、`adapters/__tests__/conformanceCoverage.test.ts`、`cloudflare/__tests__/{conformance/scopeBusiness.test.ts,conformanceBackend.ts,deleteFilesByOwner.test.ts,ports/scopeBusiness.ts,runtimeComposition.test.ts}`、`memory/__tests__/{conformance.test.ts,conformanceBackend.ts}`（同上）
- `packages/core/src/application/{integration,storage,tag,usage}/**` と対応する `__tests__`（storage / tag 担当）
- `packages/core/src/application/di/cloudflareRuntime.ts`（配線の形は memoryRuntime と同型で、note 側の追加は同じ 2 ポート。cloudflare 担当）
- `packages/core/src/application/identity/__tests__/deleteAccount.{cleanup,terminalPrune}.test.ts`（identity 担当。note 成分の ack は `deleteNotesForOwner.test.ts` 側で確認）
- `packages/core/src/application/ports/objectStorage.ts`、`packages/core/src/domain/{integration,storage,tag}/**`（storage / tag 担当）
- `spec/{database,platform,presentation,pages,manual-tests}/index.md`、`spec/domains/{index,integration,storage,tag}.md`、`spec/usecases/{integration,storage,tag}.md`、`spec/testcases/{integration,storage,tag}/**`、`spec/inventory/{adapter,usecase}.md`（他担当）
- `packages/core/package.json`、`pnpm-lock.yaml`（parse5 依存の追加のみ）
