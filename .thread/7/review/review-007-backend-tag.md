# レビュー 007 — backend-tag（完全削除の波及と横断の配線）

### backend-tag

#### Blockers

**[B-001] spec/platform/index.md:146-147,159-161 / application/note/{purgeExpiredTrash.ts:24-29, emptyTrash.ts:17-23} — global statement 予算の数え方は正しいが、同じ purge サガを駆動する 3 つのうち 1 つにしか適用されていない**

**数え方そのものは検証して正しい。** `spec/platform/index.md:159` が挙げる 1 件 11〜12 文の内訳を Cloudflare 実装で突き合わせた。

- `resolve` = `readRow` 1 文（`d1/repositories/noteRouteStore.ts:261-264`）
- `beginPurge` = `requireRow` 1 ＋ `commit(unchangedGuard, nextRow)` 2 = 3（同 `:461-478`）
- `finishPurge` = 同じ形で 3（同 `:492-513`）
- `removeForPurge` = `readStored` 1 ＋ `remove` の batch（`vectorGuard` 1 ＋ FTS withdraw 0〜1 ＋ body DELETE 1 ＋ tags DELETE 1）= 4〜5（`projection/snapshotWriter.ts:218-236`、`d1/repositories/publicNoteProjection.ts:86-88`）

合計 11〜12。`purgeNote.ts` が global に触るのも `:408` `resolve` / `:476`（`:515` は recovery）`beginPurge` / `:324` `removeForPurge` / `:330` `finishPurge` の 4 本だけで、幅を超える枝は `:672` の abort だけ。**40 × 12 = 480 も正しく、`deleteNotesForOwner` 単体は設計上限 500 の内側に収まる。**

問題は適用範囲である。**11〜12 文は `purgeNote` 1 件あたりの費用であって `deleteNotesForOwner` の費用ではない。** 同じ `purgeNoteInternally` / `purgeNote` を回す駆動系は本 PR に 3 つあり、残る 2 つは値も根拠も直っていない。

- **`purgeExpiredTrash.ts:29` の `TRASH_EXPIRY_BATCH_SIZE = 100`。** `purgeEachNote`（同 `:92-118`）が 1 件ずつ `purgeNoteInternally` を呼ぶので、1 turn は 100 × 11〜12 = **1,100〜1,200 文**。これは `spec/platform/index.md:161` が「100 × 12 = 1,200 で、500 query の設計上限どころか実上限 1,000 も超える」と名指しで**不可能と宣言した数そのもの**である。しかも同 `:24-27` の JSDoc は「The cap bounds the CPU of a single alarm turn and the `note.purged` fan-out it emits」とだけ書き、`deleteNotesForOwner.ts:22-29` が獲得した global の観点を持っていない。`spec/platform/index.md` の上表にはこの経路の行が無く、`spec/inventory/usecase.md:85`（UC-note-021）も「最大 100 件ずつ」のままである。
- **`emptyTrash.ts:23` の `EMPTY_TRASH_SYNCHRONOUS_LIMIT = 50`。** `emptyTrash.ts:116-126` が同期に `purgeNote` を 50 回呼ぶので 50 × 11〜12 = **550〜600 文**で、HTTP mutation 1 回が設計上限 500 を超える。ここは値以上に JSDoc が問題で、`emptyTrash.ts:19-21` は「The bound is about the response time and the `note.purged` fan-out of a single mutation, **not about query count — scope-local SQL carries no D1 budget**（`spec/platform/index.md`「実行予算と分割単位」）」と、`spec/platform/index.md:159` が今回書いたことの**逆を根拠付きで主張している**。`emptyTrash` は scope-local に閉じていない — 手順の複製ではなく `purgeNote` を呼ぶ設計（`spec/usecases/note.md:862` 以降、TC-note-112）だからこそ global サガを 50 回通る。`spec/platform/index.md:146` の行の根拠列も「HTTP mutation の CPU と response latency」のままである。

さらに**予算の単位も揃っていない**。`spec/platform/index.md:134` の 500 は「1 Worker invocation」の量だが、`:159-161` の勘定は「1 turn（＝ 1 task 行）」で閉じている。scope Alarm の 1 turn は `:197` が「合計 100 行」と定め、実装の `workers/scopeTaskRunner.ts:63` も `SCOPE_TASK_TICK_LIMIT = 100` なので、**1 回の起床が `note.ownerPurgeContinued`（480 文）と `note.trashExpiryContinued`（最大 1,200 文）を同じ invocation で処理しうる**。退会中の利用者のゴミ箱に期限切れが残っていれば実際に両方 due になる（`purgeExpiredTrash` は `trashNote` が `purgeAfter` に張る行、`deleteNotesForOwner` は cleanup が張る行で、どちらも同じ scope の `scheduled_tasks`）。`:161` の「持ち回る停止 purge はページの上に載るので 1 turn が一時的に 480 を超えることはあるが、実上限 1,000 との差がその分の余地」という文は、その余地を stuck purge だけが使う前提で書かれており、兄弟 task が同居する可能性を勘定に入れていない。

Node + memory の reference runtime では D1 予算が掛からないので実害は今日は無い。しかし本 PR は「global 予算が上限を決める」という判断を**新しく canon に書いた**うえで、その判断を 3 つの駆動系のうち 1 つにしか適用していない。取るべきはどれかで、

1. `TRASH_EXPIRY_BATCH_SIZE` / `EMPTY_TRASH_SYNCHRONOUS_LIMIT` を同じ算術で収まる値へ下げ、両 JSDoc と `spec/platform/index.md:146` の行・`spec/inventory/usecase.md:85` を揃える、あるいは
2. `emptyTrash` / `purgeExpiredTrash` がこの勘定に入らない理由を（入るはずなのに入らない根拠として）`spec/platform/index.md` に書く

のいずれかであり、少なくとも `emptyTrash.ts:19-21` の「scope-local SQL carries no D1 budget」は事実として誤りなので撤回が要る。あわせて `:161` の末尾「他の scope cleanup（storage / tag / integration）は scope-local に閉じるのでこの勘定に入らない」は**追随者しか数えていない** — 除外を列挙するなら、同じ節が `purgeNote` を回す 2 つを漏らしていることが読み手に見えてしまう。

#### Warnings

**[W-001] spec/usecases/storage.md:485-486 — 3 追随者のうち storage だけ、決着が `ScopeTaskScheduler.complete` を名指しせず、継続を決める「100 件」が列挙か削除かも書かれていない**

ラウンド 006 [W-002] の 3 つ目の項目で、`triage-keys.md` に行が無い（＝ `wont-fix` / `defer` ではない）。同 [W-002] の残り 2 項目 — 継続要求表（`spec/domains/index.md:276-278` に `note.trashExpiryContinued` / `storage.orphanMediaContinued` が追加）と ADP 台帳（`spec/inventory/adapter.md:273` / `:303` / `:275` / `:282` / `:309` / `:325`）— は本ラウンドで解消を確認したが、この 1 つだけ `spec/usecases/storage.md` が 1 文字も変わっていない。

- `spec/usecases/tag.md:368` と `spec/usecases/integration.md:394` は「limit 未満なら同じ UoW でその継続 task 行を `ScopeTaskScheduler.complete` する — これが継続の連鎖を止める唯一の手段」を得た。storage の手順 4（`:486`）は「両集合が100件未満になったときだけ**完了する**」のままで、`scopeTaskScheduler.complete` の呼び出しなのか単に処理が終わることなのかが読み分けられない。3 者は `application/cleanup/notePurgeFanOut.ts:149` の `settleNotePurgeTurn` という 1 つの関数を共有し、その JSDoc（同 `:126-129`）が `spec/usecases/{tag,integration,storage}.md` を根拠に挙げている以上、3 つのうち 1 つに根拠が無い状態が続いている。
- 手順 3（`:485`）の「100件なら」が**列挙したページ**なのか**削除できた件数**なのかも書かれていない。実装は前者を選んでおり（`application/storage/deleteFilesForNote.ts:76-84` のコメントが「2 つは食い違いうる」と明記して `files.length >= 100` を使う）、これはラウンド 006 で `deletedCount` 基準から**変えた**点である。tag / integration は行そのものを消すので両者が一致し曖昧さが無いが、storage は `listDeletableByNote` → `deleteStoredFiles` の 2 段なので一致しない。正典側に選択が無い。

**[W-002] adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:228-255 — scope 鍵の guard が破壊的な経路だけを素通しし、`note.purged` の fan-out が通るのは正にその経路である**

本ラウンドで `cloudflare/__tests__/scopeGuards.test.ts` が入り、ラウンド 006 [W-003]（cloudflare 側の guard が無検証）は解消した。`:96` が insert 側（`ensureScopeOf`、`tagAssignmentRepository.ts:114-121`）を、`:123` が restore 側（同 `:123-133`、`spec/database/index.md:22` の「復元」の唯一の実装）を実際に突いており、`workers` プロジェクトで 52 ケース green を実測した。

ただし 3 つ目のメソッドが残っている。`deleteByNote`（`:228-255`）は `rowsOfNote` が返した `SqlRow` をそのまま `remove` 文へ写像し、`restore` も `ensureScopeOf` も通らない。つまり repository が誤った object に束縛された場合、

- `insert` → `DataIntegrityError` で止まる
- `listByNote` → `DataIntegrityError` で止まる
- `deleteByNote` → **他 scope の行を黙って消す**

という配置になる。しかも `application/tag/deleteAssignmentsForNote.ts:54-57` が触る repository メソッドは `deleteByNote` **ただ 1 つ**なので、この PR が追加した唯一の tag 経路は guard の外側を通っている。同アダプターの JSDoc（`:98-107`）は「checked against the object's own `_scope_identity` pin **on both save and restore**」と書き、`spec/database/index.md:22` も「adapter が**復元・保存の両方で**検査する」と書くが、`deleteByNote` は復元でも保存でもない第 3 の書き込みで、どちらの語にも入っていない。

`memory` 側は scope object ごとに別テーブルなので構造的に起こらず（`memory/repositories/tagAssignmentRepository.ts:38-42` の `ofNote` はその scope の table しか見ない）、この穴は cloudflare 固有である。修正は `rowsOfNote` の各行に対して `restore` と同じ述語を当てるだけで足り、`listByNote` と同じ「報告して直さない」姿勢（`scopeGuards.test.ts:130-132`）を保てる。

既存の `cloudflare/do/repositories/noteRepository.ts:369-388` の `delete` も `readForUpdate`（同 `:298-310`）が版しか見ないため同じ形をしており、これは本 PR が作った穴ではない。ただし本 PR は (a) 同じ形の repository を新設し、(b) 「この guard を見る場所」を新設したので、いま揃える機会がある。

あわせて台帳側の指し先も一段ずれている。`scopeGuards.test.ts:123` は restore 側の検査を **ADP-tag-012** と名乗るが、`spec/inventory/adapter.md:275`（ADP-tag-012）は「ノートの assignment を `AssignmentId` 昇順で列挙する」だけで scope 鍵に触れず、pin の突き合わせは `:273`（ADP-tag-010 = `insert`）にしか書かれていない。guard の面（どのメソッドが検査するか）が、アダプター JSDoc・`spec/database/index.md:22`・ADP 台帳の 3 箇所のどこにも列挙されていないのが共通の原因である。

#### テスト保証

担保できているもの:

- **cloudflare の scope 鍵 guard**（本ラウンドの新規）— `cloudflare/__tests__/scopeGuards.test.ts` が scope object を毎テスト作り直し（`:39-54`）、`SqlSession` を直に叩いて他 scope の行を仕込んだうえで（`:70-86`）、insert の拒否・自 scope の insert の通過・`listByNote` の拒否と**行が残ること**まで主張する。「guard は報告するだけで直さない」を `:132` で固定しているのが良い — 修復に転ぶ実装が入れば赤くなる。memory 側（`memory/__tests__/scopeGuards.test.ts:21`）と JSDoc で対を宣言しており、なぜ memory に restore 側が無いかも書かれている。
- **conformance の両側実行と足し忘れの検知** — `describeTagAssignmentRepositoryContract` / `describeBackupRecordRepositoryContract` が memory（`memory/__tests__/conformance.test.ts:78-79`）と cloudflare（`cloudflare/__tests__/conformance/scopeBusiness.test.ts:30-37`）の双方に登録され、`adapters/__tests__/conformanceCoverage.test.ts:154` の `PERSISTENCE_SUITES` が 43 → 45。実測で node 45 ケース / workers 52 ケース green。
- **2 つの一意制約の別種写像** — `conformance/tagAssignmentRepository.ts:43-75` と `conformance/backupRecordRepository.ts:52-` が、ペアの重複は `ConflictError`、id の再利用は `SystemError` であることを両方向で突き、さらに**失敗した insert が行を残さない**ことまで主張する（`:71-74`）。cloudflare 側は pre-read（`clashOf`、`tagAssignmentRepository.ts:164-186`）と UNIQUE index の catch（`:214-219`、index 名で判別）の二段で同じ答えを出す。
- **順序契約が偶然通らない形** — 両スイートとも挿入順を崩したうえで昇順を要求し（`tagAssignmentRepository.ts:77-89`）、部分削除後の残余を id で主張する（同 `:105-108`）。`limit <= 0` は `0` と `-1` の両方（同 `:100-101`）。
- **fan-out の登録と冪等** — `workers/__tests__/subscribers.test.ts:330` が `note.purged` の consumerName 3 本を集合で固定（未購読は warn だけで ack されるので、この 1 本が無いと配線漏れが緑で通る）、`:343` が既定レジストリ越しに 3 集合が 0 になり、2 回目の配送で outbox が増えないことまで見る。`:379`（TC-integration-022）は personal / workspace の両 scope に residue を播き、**どちらの scope が掃かれたか**を主張するので `scopeOfNoteOwner`（`application/scope.ts:65`）の workspace 枝がここでしか通らない事実を補っている。
- **admission の fail-closed と completed 通過** — `deleteAssignmentsForNote.test.ts:240`（token を持つ barrier が存在しない）/ `:260`（completed でも通す）、`deleteBackupRecordsForNote.test.ts:193`（workspace scope に personal token）/ `:270` / `:286` が受理・拒否の両側を押さえる。`spec/usecases/{tag,integration,storage}.md` の「`assertOwner` を使わない理由」と実装（`notePurgeFanOut.ts:86-101` の JSDoc、`:110-117`）が同じ論拠で揃っている。
- **継続の駆動経路** — `deleteAssignmentsForNote.test.ts:207` / `deleteBackupRecordsForNote.test.ts:251` が `runDueScopeTasks` を実際に回す。`scopeTaskHandlers`（`workers/scopeTaskRunner.ts:191-210`）への登録漏れは warn ログで済むので、この形でないと検知できない。
- **corrupt payload** — `subscribers.test.ts:405` が `readNotePurgeTurn`（`notePurgeFanOut.ts:48-69`）の空白・非文字列 token を `SystemError(DataIntegrityError)` にすることを直接見る。`:433` は absent / null / 空文字が `null` に潰れることを見る。
- **退会サガへの `note` 昇格** — `deleteAccount.cleanup.test.ts:177` が ack 集合を `["note","storage","usage"]` と集合で主張し、`deleteAccount.terminalPrune.test.ts:284` は `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` を使うので participant 追加で壊れない。`PERSONAL_CLEANUP_COMMANDS`（`identity/deleteAccount/cleanupDispatch.ts:57-72`）は `Record<ActivePersonalCleanupComponent, …>` なので、participant を足して command を配線し忘れると型エラーになる。
- **DI の完全性** — `cloudflare/__tests__/runtimeComposition.test.ts` の `REQUEST_PORTS` / `WORKER_PORTS` が `publicNoteProjectionWriter` / `htmlProcessor` の追加と `noteRouteResolver` → `noteRouteStore` の差し替えを両面で固定する。

担保できていないもの:

- **[W-002] の `deleteByNote`。** cloudflare の guard 3 面のうち、テストが付いたのは 2 面。
- **2 つの駆動系が同じ継続行を同時に触る窓**（ラウンド 006 から未解消）。`(kind, operationId)` の行を、リレーの再配送（lease を取らない）と scope-task runner（lease を取る）が独立に駆動できる。解析上は `settleNotePurgeTurn` の `complete` が「そのノートの行が尽きた瞬間」にしか呼ばれず、余分に再武装された行も次の turn が 0 件で完了させるので取り零しは起きないが、この不変条件をテストが固定していない。`docs/test.md`「Injecting into a concurrency window」の形で `deleteByNote` の直後に別 turn を割り込ませる 1 本が欲しい。
- **リレー経由の end-to-end**。テストは `dispatchDomainEvent` を直接呼ぶので、`outbox_events` に落ちた `note.purged` が `note/eventDecoders.ts` の `strict()` デコーダを通って 3 追随者に届くところまでは通っていない。
- **[B-001] の予算そのもの**。1 turn / 1 invocation あたりの global statement 数は、性質としてどのテストも観測していない（memory backend は文を数えない）。値を変えても何も赤くならないので、`spec/platform/index.md` の記述だけが唯一の歯止めである。

#### カバレッジ

確認したファイル（差分または実体を読んだもの）:

- `packages/core/src/domain/tag/{errorCode.ts,valueObject.ts,tagAssignment.ts,ports/tagAssignmentRepository.ts}`
- `packages/core/src/domain/integration/{errorCode.ts,valueObject.ts,backupRecord.ts,ports/backupRecordRepository.ts}`
- `packages/core/src/application/tag/{deleteAssignmentsForNote.ts,__tests__/deleteAssignmentsForNote.test.ts}`
- `packages/core/src/application/integration/{deleteBackupRecordsForNote.ts,__tests__/deleteBackupRecordsForNote.test.ts}`
- `packages/core/src/application/cleanup/{notePurgeFanOut.ts,participants.ts}`
- `packages/core/src/application/workers/{subscribers.ts,scopeTaskRunner.ts,__tests__/subscribers.test.ts}`
- `packages/core/src/application/identity/deleteAccount/{authorRedaction.ts,cleanupDispatch.ts}`、`packages/core/src/application/identity/__tests__/{deleteAccount.cleanup.test.ts,deleteAccount.terminalPrune.test.ts}`
- `packages/core/src/application/di/{types.ts,memoryRuntime.ts,cloudflareRuntime.ts}`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/ports/{noteMovePort.ts,noteRouteStore.ts,objectStorage.ts}`、`packages/core/src/application/scope.ts`
- `packages/core/src/adapters/memory/{store.ts,scopeUnitOfWork.ts,repositories/tagAssignmentRepository.ts,repositories/backupRecordRepository.ts,__tests__/conformance.test.ts,__tests__/conformanceBackend.ts,__tests__/scopeGuards.test.ts}`
- `packages/core/src/adapters/cloudflare/do/{schema.ts,repositories/tagAssignmentRepository.ts,repositories/backupRecordRepository.ts}`
- `packages/core/src/adapters/cloudflare/__tests__/{scopeGuards.test.ts,conformanceBackend.ts,ports/scopeBusiness.ts,conformance/scopeBusiness.test.ts,deleteFilesByOwner.test.ts,runtimeComposition.test.ts}`
- `packages/core/src/adapters/conformance/{backend.ts,tagAssignmentRepository.ts,backupRecordRepository.ts}`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/package.json`、`pnpm-lock.yaml`（`parse5@8.0.1` の依存追加と lock 反映を確認）
- `spec/usecases/{tag,integration}.md`、`spec/domains/{tag,integration,index}.md`、`spec/platform/index.md`、`spec/database/index.md`、`spec/inventory/{adapter,test,usecase}.md`、`spec/testcases/{tag/deleteAssignmentsForNote.md,integration/deleteBackupRecordsForNote.md}`

判断のために差分外で読んだファイル: `application/note/{purgeNote.ts,deleteNotesForOwner.ts,purgeExpiredTrash.ts,emptyTrash.ts}`、`application/storage/deleteFilesForNote.ts`、`application/cleanup/personalCleanup.ts`、`application/ports/scopeTaskScheduler.ts`、`adapters/cloudflare/d1/repositories/{noteRouteStore.ts,publicNoteProjection.ts}`、`adapters/cloudflare/projection/snapshotWriter.ts`、`adapters/cloudflare/do/repositories/noteRepository.ts`、`spec/usecases/{note,storage}.md`（`#deletefilesfornote` / `#emptyTrash` / `#purgeExpiredTrash` の節）

実行した検証: `pnpm vitest run --project node`（`application/{tag,integration}` / `workers/__tests__/subscribers.test.ts` / `memory/__tests__/scopeGuards.test.ts` / `adapters/__tests__/conformanceCoverage.test.ts` → 45 ケース green）、`pnpm vitest run --project workers`（`cloudflare/__tests__/scopeGuards.test.ts` / `cloudflare/__tests__/conformance/scopeBusiness.test.ts` → 52 ケース green）。`grep -rn '\.thread/' packages spec docs apps` は 0 件で、コード・`spec/`・`docs/` から `.thread/` への参照は無い。

スキップしたファイル（担当外。他レビュアーの持ち分）:

- `apps/web/` 配下の全 39 ファイル（frontend）
- `packages/core/src/adapters/html/{allowList.ts,css.ts,htmlProcessor.ts,__tests__/htmlProcessor.test.ts}`（backend-note）
- `packages/core/src/application/note/` の新規・変更 24 ファイル（うち `purgeNote.ts` / `deleteNotesForOwner.ts` / `purgeExpiredTrash.ts` / `emptyTrash.ts` は [B-001] の判断のため参照のみ）、`packages/core/src/application/storage/` の 10 ファイル（`deleteFilesForNote.ts` は [W-001] の判断のため参照のみ）、`packages/core/src/application/usage/{ensureUploadAllowed.ts,__tests__/ensureUploadAllowed.test.ts}`
- `packages/core/src/domain/note/` の 5 ファイル、`packages/core/src/domain/storage/` の 4 ファイル、`packages/core/src/domain/{tag,integration}/__tests__/valueObject.test.ts`（契約面は本文で確認済み）
- `packages/core/src/adapters/{memory,cloudflare/do}/repositories/{noteRepository,storedFileRepository}.ts`（cloudflare の `noteRepository` のみ [W-002] の比較対象として参照）、`adapters/conformance/{noteRepository,storedFileRepository,noteRouteStore}.ts`
- `spec/adr/013-html-sanitization-policy.md`、`spec/domains/{note,storage}.md`、`spec/pages/index.md`、`spec/presentation/index.md`、`spec/manual-tests/editing.md`、`spec/testcases/note/*`（17 本）、`spec/testcases/storage/*`（3 本）
