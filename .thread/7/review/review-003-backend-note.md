### backend-note

#### Blockers

**[B-001]** `purgeNote` が「route を他人の operation が握っている」を「もう完全削除済み」と同一視するため、`deleteNotesForOwner` がノートを消さないまま削除済みと数え、アカウント削除の `note` 成分を ack して終端する

- 場所: `packages/core/src/application/note/purgeNote.ts:2086-2126`（`resumeInternal` の `catch` が `isConflictError` でも `null` を返す）→ `purgeNote.ts:1920-1929`（`purgeNoteInternally` が `null` を無投げで `return`）→ `packages/core/src/application/note/deleteNotesForOwner.ts:335-363`（`purgeEachNote` が投げなかった呼び出しを `purgedCount += 1` と数える）→ `deleteNotesForOwner.ts:365-425`（`settle` が `remaining > purgedCount` でないので `acknowledgePersonalComponent("note")` + `complete`）
- 理由: `resolve` は `purging` な route を隠すので、停止した purge のノートは `resumeInternal` に落ちる。そこで `beginPurge` に番兵世代を渡すが、**他人の operationId で `purging` になっている行は state で拒まれて `ConflictError`** になる（`adapters/conformance/noteRouteStore.ts` の ADP-note-043 が「foreign operation は state で、どの世代でも拒む」ことを契約として固定している）。`resumeInternal` はこれを `null` ＝「このコマンドにやることは無い」に畳むが、それが正しいのは tombstone と route 消失（＝ノートが実在しない）の 2 つだけで、**他人が握っている route は「ノートが消えた」ことを何も意味しない**。

  同じ `deletionOperationId` の継続同士は同一の派生 operation ID（`ownerPurge:…`）を持つので冪等分岐に入り、この経路には落ちない。落ちるのは**別の operation が停止して `purging` を残した場合**で、`purgeNote` の JSDoc 自身が「`userRequest` の purge は operation ID を採番するうえ `resolve` が隠すので再送で再開できない／回収ドライバーは本スライス外」と明記している。つまり停止した user purge は**恒久的に**この状態で残る。

  実機で再現した（memory backend・本番 DI、`deleteNotesForOwner` を素で 1 回呼ぶだけ）:

  ```
  // route を "stuck-user-purge" で beginPurge しておく（応答喪失した user purge の再現）
  view        = { status: "settled", personalCleanupCompleted: false, purgedCount: 1 }
  notesLeft   = 1          // 本文ごとノート行が残っている
  acknowledged= ["note"]   // 削除の note 成分は ack 済み
  outbox      = ["note.created"]   // note.purged は 1 件も出ていない
  tasks       = []         // 継続タスクも張られない
  errors      = []         // ログにも残らない
  ```

  結果として、アカウント削除が完走したあとに **本文つきの Note 行・その `note_revisions`・`note.purged` が回収するはずのタグ付与 / 保管ファイル / バックアップ記録がすべて残る**。障壁は閉じているので同じ cleanup を再実行しても `assertOwner` に弾かれ、`spec/usecases/note.md#deleteNotesForOwner` が要求する「scope の全ノートを消す」も UC-identity の削除完了の意味も満たさない。`purgeExpiredTrash` 側は同じ `null` を `purgedCount` に数えて行を次の期限へ動かすだけなので自己修復するが、こちらは不可逆である。
- 提案: `resumeInternal` で `isNotFoundError`（route 行が無い＝ノートも無い）と `isConflictError`（他人が握っている）を分ける。前者だけ `null` を返し、後者は投げる — そうすれば `purgeEachNote` が数えず、`settle` は `remaining > purgedCount` で継続を張り、全滅なら `backoffOrSchedule` で駐車して削除が `running` のまま可視化される（`spec/usecases/note.md#purgeExpiredTrash` の「進捗ゼロだけを backoff に落とす」と同じ形）。あわせて `resumeInternal` の JSDoc から「a route somebody else holds …. None of them leaves this command anything to do」を落とし、`spec/testcases/note/deleteNotesForOwner.md` に「対象ノートの route が別 operation の `purging` のまま停止している — 削除を進める」＝「そのノートは purge されず、`purgedCount` に数えず、成分を ack しない」を 1 行足す（`spec/inventory/test.md` にも採番）。

#### Warnings

**[W-001]** 本 PR が新しく仕様に足した振る舞いのうち、テストケース台帳の行を得たのは `emptyTrash` / `purgeNote` だけで、残りは台帳行も（`NoteIsTrashed` は）テストも無い

- 場所: `spec/usecases/note.md`（`renameNote` / `changeNoteStyleMode` / `restoreNoteRevision` に足した「ゴミ箱のノート → `BusinessRuleError(NoteIsTrashed)`」、`#purgeExpiredTrash` の 3 分岐 settle 表、`#trashNote` の手順 5、新規節 `#listNotes` / `#listTrashedNotes`）／ `spec/testcases/note/`（`renameNote.md` / `changeNoteStyleMode.md` / `restoreNoteRevision.md` / `purgeExpiredTrash.md` / `trashNote.md` は無改変、`listNotes.md` / `listTrashedNotes.md` は不在）／ `spec/inventory/test.md`（新規 TC-note 行は 760-780 の moveNote / emptyTrash / purgeNote だけ）
- 理由: 共通原因は 1 つ — ユースケース仕様と実装は同じラウンドで動いたのに、テストケース台帳がその一部にしか追随していない。個別に見ると:
  - `ensureNotTrashed` は `updateNoteBody` / `applyTextNodeEdits` / `renameNote` / `changeNoteStyleMode` / `restoreNoteRevision` の 5 経路にあるが、ゴミ箱拒否のテストは `updateNoteBody.test.ts:171`（TC-note-727）の 1 本だけ。残り 4 経路は**仕様に新設した拒否が 1 度も実行されない**（`grep -rn "NoteIsTrashed" packages/core/src/application/note/__tests__` の結果が 1 件）。
  - `purgeExpiredTrash` の backoff / 部分失敗の再武装 / `findNextPurgeDeadline` への張り替えはテストが 3 本あるが、`tc` ラベルが `UC-note-021` か無ラベルで、台帳に対応行が無い。`trashNote` 手順 5（保持期限アラームの張り替え）も同様。
  - `listTrashedNotes` は `spec/inventory/usecase.md` に UC-note-038 として採番されたのに `spec/testcases/note/` にファイルが無く、テストは `PAGE-p14-001` を名乗る。
  `spec/index.md` はテストケースを `spec/testcases/` の正典とし、本 PR 自身が `emptyTrash.md` / `purgeNote.md` にはきちんと行を足しているので、これは方針の不統一であって「台帳を使わない」設計判断ではない。
- 提案: (1) 4 経路のゴミ箱拒否テストを足す（各 1 本、`reseedNote` で `lifecycle` を作る必要はなく `trashNote` を通せばよい）。(2) `purgeExpiredTrash.md` に settle 3 分岐、`trashNote.md` にアラーム張り替えの行を足し、`listNotes.md` / `listTrashedNotes.md` を新設して `spec/inventory/test.md` の末尾に採番する。

**[W-002]** `HtmlProcessor.process` が不動点ではない — `</style>` に切られて閉じていない CSS 文字列があると、1 回通すたびに `;` が 1 つ増える

- 場所: `packages/core/src/adapters/html/css.ts:1504-1527`（`pushStatement` が分類できなかった文をそのまま `${text};` で押す）
- 理由: 実測（実装をそのまま呼んだ）:

  ```
  in  : <style>.a{content:"</style><img src=x onerror=alert(1)>"}</style>
  1回 : <style>.a{content:";}</style><img src="x">"}
  2回 : <style>.a{content:";};}</style><img src="x">"}
  ```

  `</style>` は raw text を切るので `<style>` の中身は `.a{content:"` という**閉じていない文字列**になり、`filterCss` はそれを 1 statement とみなして `;` を足す。差分外の 17 例で確認した限り他はすべて不動点だった（属性 `style`・`@media`・`srcset`・見出し id 付与・`target=_blank` の `rel` 正規化を含む）ので、穴はこの 1 形だけ。

  実害が出るのは、すでにサニタイズ済みの本文をもう一度 `process` に通す 3 か所である: `applyTextNodeEdits.ts:124`（自動保存のたび）、`restoreNoteRevision.ts:2549`、`listNoteRevisions.ts:1294`（版一覧を開くたび）。ビジュアルモードの自動保存が回るあいだ本文が 2 バイトずつ伸び続け、増分は `removed` にも載らないので画面には何も出ない。
- 提案: `pushStatement` で、分類にも `@` にも当たらずかつ末尾が `;` で終端していない文（`scanTo` が `-1` を返した最後の断片）は `;` を足さずにそのまま押す。テストは `htmlProcessor.test.ts` の表に「`process(process(x)) === process(x)`」を確かめる 1 ケースとして足すのが安い。

**[W-003]** ADR 013 が `<style>` / `style` 属性の `url()` の穴について「CSP の `style-src` / `img-src` / `font-src` を併用する」と明記しているが、配備されているヘッダーにその 3 指令が無い（**既存の問題**だが、本文に任意の CSS を書けるようにしたのは本 PR である）

- 場所: `spec/adr/013-html-sanitization-policy.md:163` と `spec/presentation/index.md:168` が要件を置く。実際のヘッダーは `apps/web/app/server.node.ts:73-76` の `"frame-ancestors 'self'; form-action 'self'; object-src 'none'; base-uri 'self'"` のみ（差分外）
- 理由: `filterCss` は `position` と `@import` しか落とさないので、`<p style="background:url(https://attacker/log)">` も `<style>body{background:url(...)}</style>` も素通りする（実測で確認、`removed` は空）。これは ADR 013 が**承知のうえで**サニタイザーの外に出した穴なので、サニタイザー側の欠陥ではない。問題は受け皿の側が存在しないことで、`ExternalReference` は属性ベース（`src` / `srcset` / `poster` / `data-stylesheet-href`）なので `url()` は取り込みにも乗らず、利用者が「取り込む」を選んでも外部参照のまま恒久的に残る。ワークスペースの他メンバーや共有先が本文を開いた時点で、閲覧者の IP / UA / Referer が第三者に飛ぶ。Issue #7 の前は利用者が本文に CSS を入れる経路が無かったため、この穴が到達可能になったのは本 PR からである。
- 提案: 本 PR で直す必要はない（`server.node.ts` は差分外で、コメントも公開閲覧スライスへの先送りを宣言している）。ただし ADR 013 の当該行が依存している前提が今は未成立であることを、`spec/presentation/index.md` の当該節か公開閲覧スライスの Issue に「`img-src` / `style-src` / `font-src` が入るまで、本文由来の外部参照は無制限」と書き残す。frontend / 公開閲覧スライスの持ち分。

**[W-004]** `applyTextNodeEdits` は scope の transaction の内側で本文を 2 回フルパースするが、`updateNoteBody` は「サニタイズは transaction の外」を JSDoc で明示的に主張している — 分岐した理由がどこにも無い

- 場所: `packages/core/src/application/note/applyTextNodeEdits.ts:98`（`editTextNodes`）と `:124`（`process`）がいずれも `scopeUnitOfWorkProvider.run` の内側。対する `updateNoteBody.ts:2826-2846` の JSDoc:「The body is sanitized *before* the transaction opens — it is a pure computation over a string this request has not yet decided to keep」
- 理由: 分岐自体は避けられない（`editTextNodes` の入力は claim 後の現在の本文なので、外へは出せない）。問題は、同じファイル群で正反対の方針が根拠なしに並んでいることと、その代償が書かれていないこと: ビジュアルモードの自動保存 1 回につき、最大 800 KB の本文を parse → serialize → parse → serialize する時間だけ scope の transaction が開く。最終形（`spec/platform/index.md`）では scope は Durable Object の単一スレッドなので、この時間はその scope の他のすべての書き込みを止める。
- 提案: `applyTextNodeEdits` の JSDoc に「`updateNoteBody` と違ってサニタイズが transaction の内側に来るのは、`editTextNodes` の入力が claim 後の本文だからである」ことと、その CPU が transaction 内に載ることを 1 段落で書く。実装を変える必要は無い。

**[W-005]** `spec/usecases/note.md#purgeExpiredTrash` の settle 3 分岐表の 3 行目が、実装が実際にその枝へ入る条件を書いていない

- 場所: `spec/usecases/note.md`（「期限の来た対象が無かった」の行）と `packages/core/src/application/note/purgeExpiredTrash.ts:1584-1625`
- 理由: 実装の 3 番目の枝は `!(targets > 0 && purged === 0)` かつ `!full` かつ `purged === targets` で入る。つまり「**満ページでない対象をすべて削除できた**」turn — 対象が 1 件以上あった turn — もここへ来る。表を 3 分岐の網羅として読むと、この turn がどの行にも当たらないように見える。実装の挙動（短いページはもう期限の来た対象が無いことの証明なので次の期限へ移す）は正しいので、直すのは表の側。
- 提案: 3 行目の条件を「満ページでなく、期限の来た対象が残らなかった（0 件だった場合を含む）」に書き換える。

#### テスト保証

- 完全削除サガの中断窓が実際に押さえられている: route claim 前の restore（TC-note-350）、local delete 前の除名（TC-note-351）、abort 応答喪失（TC-note-352）、local delete と public remove の間の停止（TC-note-353）、tombstone 応答喪失（TC-note-355）、そして本ラウンドで足された「commit 後の応答喪失は abort せず `purging` を残す」（TC-note-780、user 経路と cleanup 経路の 2 本）。
- 内部 operation ID の決定性が両方向で確認されている: 再配送が同じ ID を導くこと（TC-note-360）と、ID が deletion と note の両方に束縛されること（同 TC の 2 本目）。
- `beginPurge` の「operation 単位の冪等が routeVersion CAS より先に効く」順序が、ポート JSDoc・`spec/domains/note.md`・conformance（ADP-note-043、番兵世代で自分の行だけ読み戻せること／他人の行はどの世代でも拒まれること／`active` な行は番兵世代を拒むこと）の 3 点セットで固定され、memory と cloudflare が同じスイートを通っている。
- `emptyTrash` の飛ばす／飛ばさないの境界が両側から押さえられている: 競合・`NOTE_NOT_TRASHED`・不在は飛ばして続ける（TC-note-111/113/114）、それ以外は要求ごと失敗して既に確定した purge は戻さない（TC-note-778 の 2 本）。ジョブ経路の列挙が数えた総数で束縛されることも（TC-note-779）。
- `trashNote` の 3 つの書き込みが 1 transaction であることが、commit 喪失でどちらも残らないことを見る形で確認されている（TC-note-672 の 2 本目）。強制終端の除外が「id 1 件だけ」であることも 3 方向（TC-note-669/670/675）。
- 保持期限アラームの張り替えが、最も早い期限を選ぶこと・turn がそれを次の期限へ動かすこと・まだ数えているノートがあるあいだは完了しないことの 3 本で押さえられている（`purgeExpiredTrash.test.ts` の UC-note-021 群）。
- `note.purged` の追随者が「登録されていること自体」をアサートするテストを持ち（未購読イベントが warn だけで ack される穴を塞ぐ）、workspace 所有ノートで `scopeOfNoteOwner` の workspace 枝が到達し、個人 scope が無傷であることまで見ている（TC-integration-022）。再配送が no-op であることも outbox 件数で確認。
- `dispatchDomainEvent` が「兄弟の失敗で後続を飛ばさず、最初の失敗で配送を落とす」ことが、呼び出し順とログ 2 本の両方で確認されている。
- サニタイズ表がテーブル駆動で 50 例あり、ラウンド 002 の `var()` 迂回（`position:var(--x)` / `VAR()` / `var(--x,fixed)` / `env()` / カスタムプロパティ経由のオーバーレイ）と、コメント・識別子エスケープ経由の迂回が全部入っている。値を許可リストで判定する形なので、列挙していない間接（将来の `attr()`）も自動的に落ちる — 差分外で `expression()` / `-moz-binding` / `@media` 内の `position` / 大文字 `@IMPORT` を当ててみて、いずれも規則どおりの結果だった。
- `NoteRevision.RETENTION` が書き手の刈り込みと読み手の上限の両方から使われ、20 版を超えた行が読み取られない／作られないことが `updateNoteBody`（TC-note-725）と `listNoteRevisions`（TC-note-221）の両側で確認されている。

#### カバレッジ

確認（差分を読み、必要に応じて実装を実行して検証）:

- `packages/core/src/adapters/html/allowList.ts`
- `packages/core/src/adapters/html/css.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`
- `packages/core/src/adapters/memory/repositories/noteRepository.ts`
- `packages/core/src/adapters/conformance/noteRepository.ts`
- `packages/core/src/adapters/conformance/noteRouteStore.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/di/memoryRuntime.ts`（note 関連の追加のみ）
- `packages/core/src/application/di/cloudflareRuntime.ts`（note 関連の追加のみ）
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/ports/noteRouteStore.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
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
- `packages/core/src/application/note/__tests__/editingHarness.ts`
- `packages/core/src/domain/note/noteRevision.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/noteRepository.ts`
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`
- `packages/core/src/domain/note/__tests__/noteAccessPolicy.test.ts`
- `spec/adr/013-html-sanitization-policy.md`
- `spec/domains/note.md`
- `spec/usecases/note.md`
- `spec/testcases/note/emptyTrash.md`
- `spec/testcases/note/purgeNote.md`

確認（全 `it` 名・断定パターンの走査・実際の実行で確認。本文は該当箇所の抜粋のみ読んだ）:

- `packages/core/src/application/note/__tests__/applyTextNodeEdits.test.ts`
- `packages/core/src/application/note/__tests__/changeNoteStyleMode.test.ts`
- `packages/core/src/application/note/__tests__/deleteNotesForOwner.test.ts`
- `packages/core/src/application/note/__tests__/emptyTrash.test.ts`
- `packages/core/src/application/note/__tests__/listNoteRevisions.test.ts`
- `packages/core/src/application/note/__tests__/listNotes.test.ts`
- `packages/core/src/application/note/__tests__/listTrashedNotes.test.ts`
- `packages/core/src/application/note/__tests__/purgeExpiredTrash.test.ts`
- `packages/core/src/application/note/__tests__/purgeNote.test.ts`
- `packages/core/src/application/note/__tests__/renameNote.test.ts`
- `packages/core/src/application/note/__tests__/restoreNote.test.ts`
- `packages/core/src/application/note/__tests__/restoreNoteRevision.test.ts`
- `packages/core/src/application/note/__tests__/trashNote.test.ts`
- `packages/core/src/application/note/__tests__/updateNoteBody.test.ts`

スキップ（理由つき）:

- `packages/core/src/application/cleanup/notePurgeFanOut.ts` / `packages/core/src/application/cleanup/participants.ts` — ラウンド 001/002 と同じく backend-tag の担当。B-001 の説明で `scopeOfNoteOwner` / `readNotePurgeTurn` の呼び出し側としてだけ参照した
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts` / `packages/core/src/adapters/memory/store.ts` — 追加は `tagAssignmentRepository` / `backupRecordRepository` の配線で、backend-tag の担当
- `packages/core/src/adapters/cloudflare/do/schema.ts` / `.../repositories/{tagAssignmentRepository,backupRecordRepository,storedFileRepository}.ts` / `adapters/conformance/{tagAssignmentRepository,backupRecordRepository,storedFileRepository}.ts` — tag / integration / storage の担当
- `packages/core/src/application/{storage,tag,integration,usage}/**` — backend-storage / backend-tag の担当
- `packages/core/src/application/identity/**` — 本スライスの変更は削除サガ側で、backend-tag が追っている範囲
- `apps/web/**`（`components/note/**`・`routes/**`・`presentation/**` を含む） — frontend の担当
- `spec/{pages,presentation,platform}/index.md`・`spec/manual-tests/editing.md`・`spec/domains/{storage,tag,integration}.md`・`spec/usecases/{storage,tag,integration}.md`・`spec/testcases/{storage,tag,integration}/**` — 他担当。W-003 の裏取りのため `spec/presentation/index.md:166-168` だけ読んだ
- `spec/inventory/{adapter,test,usecase}.md` — 全量は読まず、note 行と本 PR が足した TC-note 行だけを確認（W-001 の根拠）
- `packages/core/package.json` / `pnpm-lock.yaml` — `parse5` の追加のみ
