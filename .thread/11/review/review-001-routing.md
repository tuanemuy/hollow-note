### Routing / outbox / scope インフラ

観点: `note_routes` の状態機械と CAS、outbox の lease / 冪等 / quarantine、`IdempotencyStore`、`ScopeRouter` / `ScopeTaskQueue` / `ScopeTaskScheduler` / `ScopeCleanupAdmissionStore`、due index と Alarm turn、AC-6（fencing 決着）の前提検証。

総評として、状態機械の分岐・遷移条件・冪等再試行の判別（`lastMigrationId` / `operation_id`）は memory 実装と 1 対 1 で写っており、`resolveMany` 500 件も `json_each` 1 binding で上限を守っている。`readableRow` 相当（`isReadable`）も memory と同じく `reserved` / `purging` を落とし、期限切れ tombstone だけを追加で落とす形で一致している。spec 改訂（`_occ_guard` / `_scope_identity` / `scope_task_due_index` / `distributed_operations` の kind 込み索引 / `membership_directory`）も実装と整合しており AC-9 はおおむね満たされている。

一方で、**同時実行が起きたときにだけ現れる 3 つの穴**が残っている。いずれも適合スイートが逐次呼び出ししか行わないため緑のまま通り抜けている。

---

#### Blockers

- **[B-001]** `NoteRouteStore` / `OutboxRepository` / `IdempotencyStore` / `NoteRouteFanOutReader` / `ScopeTaskQueue` / `ScopeRouter` が駆動エラーを一切翻訳していない。`_occ_guard` の発火が生の D1 エラーとして application 層へ抜ける
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteStore.ts:196-206`（`commit`）、`:334`（`abandonCreate`）、`packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts:70,101,140,194`、`packages/core/src/adapters/cloudflare/d1/repositories/idempotencyStore.ts:34`、`packages/core/src/adapters/cloudflare/d1/repositories/noteRouteFanOutReader.ts:81`、`packages/core/src/adapters/cloudflare/scopeTaskQueue.ts:53`、`packages/core/src/adapters/cloudflare/scopeRouter.ts:63`
  - 理由: この束の 6 ファイルは `throwTranslated` / `classifySqlError` を import すらしていない（同じステップの `scopeTaskScheduler.ts` / `scopeCleanupAdmissionStore.ts` / identity 束は全て翻訳している）。`NoteRouteStore` は設計上 UoW の外（autocommit セッション）で呼ばれるので、`createGlobalUnitOfWorkProvider` の `throwTranslated`（`execution/globalUnitOfWork.ts`）に拾われる経路が無い。したがって `unchangedGuard` / `absentGuard` が同時実行で発火すると、`ConflictError("OPTIMISTIC_LOCK_FAILURE")` ではなく `CHECK constraint failed: _occ_guard_conflict` という生の `Error` が usecase → presentation まで素通りする。presentation の `SerializedError` は `kind` タグ付きのクラス階層を前提にしているので、これは 500 になるだけでなく「楽観ロック敗北を呼び出し地点で捕らえて分岐する usecase」（ADR-025 の Consequences が挙げている `updateProfile` 型の分岐）を静かに壊す。
    しかも `noteRouteStore.ts:96-101` の JSDoc は「an `_occ_guard` staged ahead of the write turns a concurrent change into a conflict rather than a lost update … surfaces as `ConflictError("OPTIMISTIC_LOCK_FAILURE")`（ADR 008）」と明言しており、**コメントが実装と食い違っている**。ADR-015 が「同時実行の砦」として置いた仕掛けが、砦として機能していない。
    outbox / idempotency / fan-out / queue / router 側は guard を持たないので実害は「ドライバ例外がそのまま出る」に留まるが、ポート JSDoc の error contract は 6 つとも `SystemError(DatabaseError)` を約束しており、CLAUDE.md の「adapter → application: adapters catch driver-specific errors and translate them」にも反する。
  - 提案: `noteRouteStore.ts` の `commit` / `abandonCreate` の `session.write` を `try / catch` で包み `throwTranslated("note_routes row " + noteId, cause)` へ倒す（guard の翻訳先が既定の `OPTIMISTIC_LOCK_FAILURE` でよいことは ADR-013 / ADR-015 が確認済み）。残り 5 ファイルも同じく `session.query` / `session.readRows` / `session.write` を翻訳する。あわせて B-001 を再発させないため、`noteRouteStore` に「2 つの `commit` が同じ行を掴んで後着が `ConflictError` になる」バックエンド固有テストを 1 件足すこと（W-006 も同時に閉じる）。

- **[B-002]** `ScopeTaskScheduler.claimDue` が原子的でない。並行する 2 つの `claimDue` が同じ行を両方に配ってしまう
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts:155-187`（`claimDue`）、`packages/core/src/adapters/cloudflare/do/scheduledTasks.ts:160-175`（`claimStatement`）
  - 理由: `claimDue` は (1) `session.query(dueCandidatesStatement)` で候補を読み、(2) `claimStatement` の条件付き `UPDATE` を `upsert` として積み、(3) **UPDATE が何行に当たったかを一切見ずに** `selected.map(toScopeTask)` を返す。`claimStatement` の述語は確かに候補判定を繰り返しているが、0 行更新は SQLite ではエラーではなく、この経路には `_occ_guard` が積まれていない（同じ PR の `authTokenRepository` / `noteRouteStore` / `idempotencyStore` / `scopeCleanupAdmissionStore` はいずれも ADR-008 の二段構えを取っているのに、claim だけが取っていない）。
    結果、A と B が同時に `claimDue` を呼ぶと、両方が同じ候補を読み、A の UPDATE が通り、B の UPDATE は 0 行の no-op として**成功裏に commit され**、B もその `ScopeTask` を受け取る。staged（scope UoW 経由 = 実配備の全経路）でも autocommit でも同じである。
    ポート JSDoc（`application/ports/scopeTaskScheduler.ts:70-77）は「Claiming is exclusive per row: choosing a candidate and moving it to `running` is one atomic step, so two `claimDue` calls running at once never hand out the same row」と無条件に約束しており、memory バックエンドは全 UoW 直列化でこれを満たしている。つまりこれは**契約を実装都合で狭めた食い違い**で、ADR 046 / AC-8 の手続き（正本のある側へ倒す・memory も同じスイートを通す）を経ていない。`scheduledTasks.ts:157` の「gets the port's per-row exclusivity」というコメントも、SQL 文単体については正しいがポートの観測としては誤りである。
    実害は継続要求の二重実行である。`deleteFilesByOwner` / `deleteQuota` が同じ operation で 2 本走り、片方が `complete` した直後にもう片方が `backoff` / `schedule` を撃つ — AC-6 が問題にしていた「settle が別 writer の行を消す」状況そのものが、fencing token 以前に **claim の段階で**発生する。
  - 提案: `claimStatement` の直前に `occGuard(SELECT 1 FROM scheduled_tasks WHERE kind = ? AND operation_id = ? AND <CANDIDATE_PREDICATE>)` を `opaque` で積む（ADR-008 の形をそのまま適用）。敗者は commit 時に中断して `OPTIMISTIC_LOCK_FAILURE` になり、ポート JSDoc の「offering one row to two runners costs no more than a claim one of them loses」と一致する。`do/alarm.ts` の turn 側は読みと `transactionSync` のあいだに `await` が無く DO が単一スレッドなので現状でも安全だが、同じ文を共有する以上そちらにも入って構わない。あわせて `claimDue` を 2 本並行に呼ぶバックエンド固有テストを足すこと。

- **[B-003]** 合成されたランタイムが 1 つの scope に対して writer を 2 本用意しており、AC-6 / ADR-019 が「実配備の前に fencing を設計し直せ」と書いた構成そのものになっている。しかも Alarm 側のハンドラ表は空なので、Alarm turn が全行を lease ぶん占有して中央 runner を飢餓させる
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:75-77,81-95`、`packages/core/src/adapters/cloudflare/do/alarm.ts:36,52,129-137`、`packages/core/src/application/di/cloudflareRuntime.ts:398`
  - 理由: ADR-019 の決着（契約を変えない）は「1 scope に対する同時 writer は object 自身の Alarm turn 1 本」という前提の上に立っており、改訂された `spec/platform/index.md:196` もそう明記している。ところがこの PR は両方を同時に出荷している。
    1. `ScopeObject.applyWriteSet` は `touchedTables` に `scheduled_tasks` が含まれれば**無条件に** `rescheduleAlarm` する。scope UoW は `writeSet.touchedTables()` をそのまま渡すので、実配備の `schedule` は必ず alarm を武装する。
    2. `createWorkerContainer()` は `scopeTaskQueue` を配線する（`cloudflareRuntime.ts:398`）。`application/workers/scopeTaskRunner.ts` の `runDueScopeTasks` はこれを `listDue → claimDue` で回す既存の実装であり、ADR-003 の due index はまさにこの中央 runner のために新設された表である。
    つまり「中央 runner を scope の Alarm と併走させる配備」が既定の合成になっている。前提は担保されていない。
    さらに悪いことに、`do/alarm.ts:36` の `handlers` は module スコープの空 `Map` で、`registerScopeTaskHandler` を呼ぶコードはリポジトリ内に 1 箇所も無い（`grep` で定義のみ）。したがって Alarm turn は行を claim し → ハンドラが無いので `unhandled` として `running` のまま放置し → `nextWakeAt` が `lease_expires_at` を返すので**リース満了ちょうどに再武装**する。中央 runner の `listDue` はリース中の行を候補から外すので、実質的に DO が毎回先に取り直し、継続要求は永久に進まない。`runScopeAlarmTurn` のハンドラ型 `(task, scope) => Promise<void>` は `scopeTaskHandlers` の `(container, task) => Promise<void>` と噛み合わないので、配備スライスが単純に橋渡しすることもできない。
    「ハンドラを持たない kind は running のまま待つ」は確かに `spec/platform/index.md:190` が定める安全側の既定だが、それは**特定の kind** が未実装である場合の話であって、レジストリ全体が空の状態で武装することまでは正当化しない。
  - 提案: どちらかに倒して、倒した側を spec とコードの両方で固定すること。(a) 本 Issue の範囲では DO の Alarm を継続要求の driver にしない — `runScopeAlarmTurn` の呼び出しを `alarm()` から外すか、レジストリが空のときは claim せず `rescheduleAlarm` だけ行う（`nextWakeAt` は保つので Alarm 自体の配線は残る）。(b) 逆に Alarm を正とするなら `createWorkerContainer` から `scopeTaskQueue` を外し、`listDue` は回復用の read に限る旨を spec に書く。いずれにせよ「両方を出荷したまま配備スライスに判断を丸投げする」状態は、ADR-019 が「再訪の引き金」と呼んだものを既定で踏んでいるので受け入れられない。最低でも `runtimeComposition.test.ts` に「合成されたランタイムで scope task が実際に 1 度だけ処理される」ケースが要る。

---

#### Warnings

- **[W-001]** Alarm turn に per-task の `try / catch` と backoff が無い
  - 場所: `packages/core/src/adapters/cloudflare/do/alarm.ts:129-137`、`packages/core/src/adapters/cloudflare/do/scopeObject.ts:81-95`
  - 理由: `spec/platform/index.md:187`「Alarm handler は次を守る … 3. 失敗 task は backoff して再予定し、上限超過を `global-events` へ通知する」を満たしていない。ハンドラが throw すると turn 全体が抜け、`publishDueIndex` も `rescheduleAlarm` も走らない。CLAUDE.md の「worker → root: workers wrap per-row processing in try / catch for partial-failure tolerance」にも反する（中央 runner の `runDueScopeTasks` は正しく 1 行ずつ隔離して `backoff` している）。`runScopeAlarmTurn` の戻り値 `{claimed, handled, unhandled}` も `alarm()` で捨てられており、未処理の可視化に使われていない。
  - 提案: `for (const task of claimed)` を 1 件ずつ `try / catch` し、失敗は `backoffStatement` を撃つ。`unhandled > 0` は少なくともログへ落とす。

- **[W-002]** `publishDueIndex` が失敗すると alarm が武装されず、ADR-003 の「drift は次の alarm が治す」という自己修復の前提が崩れる
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:75-77`
  - 理由: `applyWriteSet` は `publishDueIndex`（global D1 への書き込み）→ `rescheduleAlarm` の順で await する。D1 側が落ちると例外が呼び出し元へ返り、**alarm は武装されないまま** scope 側の commit だけが残る。この scope はもう index にも載っておらず、自分を起こす alarm も持たないので、次に誰かが同じ scope の `scheduled_tasks` を触るまで継続が停止する。ADR-003 / spec の新節はどちらも「当該 scope の Alarm が書き直して治す」と書いているが、その Alarm が存在しない経路がここにある。
  - 提案: `rescheduleAlarm` を先に（または `finally` で）行う。alarm の再武装は D1 の可用性に依存させない。

- **[W-003]** `leaseMs` の下限を担保しているのは turn の budget ではない
  - 場所: `packages/core/src/adapters/cloudflare/do/alarm.ts:61,95-137`
  - 理由: AC-6 / ADR-019 は「`leaseMs` の下限 = 1 回の claim バッチ全体を処理し切る最悪時間」を前提に置き、「CF 配備では 1 turn = `SCOPE_ALARM_CPU_BUDGET_MS`（2 秒）+ 外部 I/O が上限」と書いている。しかし `while (remaining > 0 && elapsedMs() < cpuBudgetMs)` が打ち切るのは**次のチャンクの claim** だけで、既に claim した最大 `CLAIM_CHUNK`（10）件のハンドラ実行は budget の外側にある。ハンドラが外部 I/O を待てば turn の所要時間に上限は無く（Alarm の壁時計 15 分だけ）、既定の `SCOPE_TASK_LEASE_MS`（5 分）を超えうる。前提が「実測で大きく上回る」と言い切れる形になっていない。
  - 提案: ハンドラ実行の前後でも budget を見て、超過したら残りの claim 済み行を `backoff`（あるいは lease を返す）して turn を終える。あるいは ADR-019 の当該行を「claim の打ち切りは 2 秒、turn 全体の上限はハンドラ側の責務」と正確に書き直す。

- **[W-004]** `lease.test.ts` の「gives a contested row to exactly one of two writers」が、名前どおりの性質を観測できていない
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts:150-183`
  - 理由: 2 つの writer が `applyWriteSet([claimStatement(...)])` を並行に撃ち、最後に「行の `lease_expires_at` が 2 つのうちどちらかである」ことだけを確認している。`applyWriteSet` は `void` を返すので、**両方が claim に成功したと信じた**かどうかはこの形では観測できない。B-002 が素通りしたのはこのためである。「行が 1 つの lease を持つ」ことは SQL の性質であって、ポートが約束しているのは「2 つの `claimDue` が同じ行を配らない」ことである。
  - 提案: ポート（`ScopeTaskScheduler.claimDue`）を 2 本並行に呼び、返ってきた `ScopeTask` の合計が 1 件であること（あるいは片方が `ConflictError` で落ちること）を観測する形へ変える。

- **[W-005]** `claimPending` / `pruneProcessed` が staged セッションを渡されたとき、黙って write-set を素通りして即時実行する
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts:101-139,194-205`
  - 理由: ADR-016 の Consequences が「この 2 つは relay worker が UoW の外からしか呼ばない（ポート JSDoc）」として意図的に許した挙動だが、`SqlSession.staged` は「Repositories that must refuse to run outside one (or vice versa) check this rather than guessing」と JSDoc に書かれており、まさにこのために置かれている。誤って UoW 内から呼ばれると、ロールバックされるはずの unit の中で claim / prune だけが確定するという最も見つけにくい壊れ方をする。
  - 提案: `if (session.staged) throw ...` で明示的に拒否する（`idempotencyStore` が同じフラグで分岐しているので一貫する）。

- **[W-006]** `NoteRouteStore` の `_occ_guard` を発火させるテストが 1 件も無い
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/`（該当ファイル無し）、`packages/core/src/adapters/conformance/noteRouteStore.ts`
  - 理由: 適合スイートは全て逐次呼び出しで、分岐側の判定（`STALE_SCOPE_ROUTE` / `NOTE_ROUTE_STATE_VIOLATION` / `NOTE_NOT_FOUND`）が先に捕まえるため guard が一度も撃たれない。ADR-015 が「同時実行の砦」と位置づけた 10 遷移ぶんの仕掛けが完全に未検証で、B-001（翻訳漏れ）もそのせいで表に出ていない。`docs/test.md` の「Adapters: per conformance-suite case」を満たしていても、バックエンド固有の性質としてここは埋める価値がある（plan.md「テスト方針」も固有テストの置き場所を用意している）。
  - 提案: `beginMove` / `switchMove` / `finishPurge` のいずれかで、読み込み後・commit 前に別経路が行を進める状況を作り、`ConflictError("OPTIMISTIC_LOCK_FAILURE")` が返ることを固定する。

- **[W-007]** due index の行に名前空間が乗らないので、ADR-004 の factory ごとの分離が `scope_task_due_index` だけ効かない
  - 場所: `packages/core/src/adapters/cloudflare/do/dueIndex.ts:34-38`、`packages/core/src/adapters/cloudflare/do/scopeObject.ts:97-104`
  - 理由: DO は `${ns}/${ScopeKey.serialize(scope)}` で名前空間分離されるが、`publishDueIndex` が書く `scope_type` / `scope_id` は `_scope_identity` 由来の**素の** ScopeKey なので、名前空間 A の object と B の object が同じ `ScopeKey` を使うと index 上は同一行になる。factory 先頭の D1 全表 wipe は「同一ファイル内で先に作られた object の alarm が後から発火して index を書き戻す」経路までは塞げない。現在の適合スイートは `scopeTaskScheduler` を autocommit（＝ alarm 非武装、ADR-020）で叩くので顕在化しないが、UoW 経由で `scheduled_tasks` を触るテストを同じファイルへ足した瞬間に不安定化する。
  - 提案: `dueIndexStatements` に名前空間を渡して PK に混ぜる（production は空文字）か、ADR-004 に「due index だけは分離できない」制約として明記し、UoW 経由の scope task を同一ファイルへ並べないことをテスト側の規約として残す。

- **[W-008]** 1 binding にスライス全体 / バッチ全体を詰める書き方が、値サイズの上限に対して無防備
  - 場所: `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts:72-76`（`dueIndexRowsStatement`）、`packages/core/src/adapters/cloudflare/do/dueIndex.ts:44-58`、`packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts:70-99`（`save`）
  - 理由: `assertBindable` が守っているのは**個数**（100）であって**サイズ**ではない。`spec/platform/index.md`「実上限」は 1 値 2,000,000 バイトを定めているが、`dueIndexRowsStatement()` は LIMIT を持たず当該 scope の非 `failed` 行を全て 1 つの JSON へ直列化し、しかもそれを settle のたびに撃つ（`complete` 1 回でスライス全体を DELETE + 再 INSERT）。outbox の `save` も 1 UoW 分のイベントを 1 binding に畳むので、payload の大きいイベントが並ぶと同じ上限に触れる。memory バックエンドにはこの制約が無いため、バックエンド間で観測が分かれうる。
  - 提案: 少なくとも `dueIndexRowsStatement` に上限（例: `spec/platform/index.md` の 1 turn 100 行に合わせる）を入れ、超過時の扱いを決める。`save` 側は当面 `assertBindable` にサイズ検査を足して「静かに壊れる」代わりに `SystemError` で落とす形にする。

- **[W-009]** `scopeTaskScheduler.write()` が、scope 側 commit 成功後の D1 失敗を「書き込み失敗」として呼び出し元へ返す
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts:91-99`
  - 理由: `session.write(mutations)` と `publishDueIndex()` が同じ `try` の中にあり、後者だけが失敗したケースも `throwTranslated(CONTEXT, cause)` で `SystemError(DatabaseError)` になる。呼び出し元（autocommit で settle する中央 runner）は「settle が失敗した」と読んで再試行しうるが、実際には scope 側は確定している。ADR-003 が言うとおり index の drift は許容できるのだから、ここは失敗を握って警告に留めるほうが契約に忠実である。
  - 提案: `publishDueIndex` を独立した `try / catch` に分け、失敗はログに落として `write` は成功として返す。

- **[W-010]** `spec/database/index.md` の `scope_task_due_index` の節が autocommit 経路の publish を書いていない（AC-9 の取りこぼし）
  - 場所: `spec/database/index.md`（`#### scope_task_due_index` の「更新の主体は scope object 自身である」）
  - 理由: 実装では更新主体が 2 つある。UoW 経由は `ScopeObject.applyWriteSet` が、UoW の外は `ScopeTaskScheduler`（`scopeTaskScheduler.ts:86-90`）が自分で global D1 を書く。後者は ADR-020 として `.thread/11/adr.md` にしか無く、spec だけを読むと「scope 平面のポートが global D1 を直接書く」という驚きが説明されない。CLAUDE.md「Design canon」の「spec に書かれていることはコードについて真である」に照らして片肺になっている。
  - 提案: 当該節に 1 行足す（「UoW の外で `scheduled_tasks` を触る経路では、`ScopeTaskScheduler` 実装が書き込み直後に自分のスライスを置き換える。alarm の再武装は object の持ち分であり、この経路では行わない」）。

---

#### 確認したが問題なしと判断した点

- `resolveMany` の 500 件上限と `json_each` 展開（`noteRouteStore.ts:76-104`）、上限超過が `SystemError(DatabaseError)` である点は memory と一致。`assertBindable` が 100 binding の最後の砦になっている。
- `isReadable` は memory の `readableRow` と同値（`reserved` / `purging` を落とし、期限切れ tombstone のみ追加で落とす）。`ScopeRouter.resolveNote` が未期限の tombstone を解決するのはポート型定義（`tombstone` marks a completed purge **until its expiry**）どおりで、memory と同じ。
- `note_routes` の相関 CHECK 5 本に対し、全列書き戻し（ADR-015）が全遷移で整合している（`reserved` ⇔ `reservation_expires_at`、`tombstone` ⇔ `tombstone_expires_at`、`moving` ⇔ `target_scope_*`、`reserved/moving/purging` ⇒ `operation_id`）。`activateCreate` が `reservation_expires_at` を null にする 1 箇所が全ての後続遷移の前提になっている点も追えた。
- `unchangedGuard` の `operation_id IS ?` / `migration_id IS ?` は NULL 比較として正しく、ADR-015 の「5 列で行の同一性は足りる」も遷移表と突き合わせて成立している。
- `claimPending` の候補述語（`processed_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now AND (claimed_at IS NULL OR claimed_at <= now - leaseMs)`）とポートの 4 条件が一致。quarantine は `finalize` の `nextAttemptAt === null → failed_at = now` で入り、以後候補から外れる。`RETURNING` の順序非保証を JS 側で `created_at, id` に並べ直しているのも正しい。
- `save` の `ON CONFLICT (id) DO NOTHING`（ADR 042）と、`idempotency.test.ts` の「folds a re-saved outbox id onto the stored row」が payload の据え置きまで観測している点は良い。`claimPending` の並行テストも、二重 claim なら 4 件になるので検知力がある。
- `IdempotencyStore.markProcessed` の staged 経路は `readRow`（overlay）→ 不在 guard → INSERT で、同一 UoW 内の二重呼び出しと別 UoW との競合の双方を塞げている。二重否定（`NOT EXISTS (SELECT 1 WHERE NOT EXISTS (...))`）も意図どおり。
- `ScopeCleanupAdmissionStore` は memory 実装と分岐が一致しており、`requiredComponents ?? ALL_COMPONENTS` による ADR 039 の安全側既定、`assertOwner` が completed で false になる点、`acknowledgePersonalComponent` の completed 後 no-op、`pruneCompleted` が running（`expires_at IS NULL`）に触れない点、`json_set` の component がバインド値である点まで確認した。`applied_operations` を `AppliedOperationStore`（`kind='command'`、digest 鍵）と共有する分離も、overlay の `keyOf` / `matches` の両方で破綻しない。
- `selectDueRows` の予約ロジック（優先度ごと 1 枠 → 埋め）は、`dueCandidatesStatement` の `ROW_NUMBER() OVER (PARTITION BY priority)` による候補集合の取り方も含めてポート JSDoc の 2 段規則を正しく写している。`backoffStatement` の SQL 側 backoff（`BASE * (1 << MIN(attempts,30))`、上限 `MAX_BACKOFF`）と `backedOffImage` の JS 側算術も一致。
- `ScopeObject.bind` による `_scope_identity` の固定と全 RPC での照合は、名前空間 prefix を行に漏らさない形になっている（`scopeStub` が `ScopeKey.serialize` と object 名を別々に渡す設計）。
- `runInUnitOfWork` の `AsyncLocalStorage` による入れ子禁止は両方向・同一平面ともカバーしている。`scopeTaskScheduler` が `session.staged` のとき D1 に触れないので、scope UoW から global 平面へ抜ける経路も塞がっている（ADR 023）。
- コメントは全て WHY を述べており、指摘への弁明や修正経緯の記述は見つからなかった。ただし B-001 / B-002 で挙げた 2 箇所は、記述内容そのものが実装と食い違っている。

---

#### カバレッジ

- 確認: `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteStore.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteFanOutReader.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/idempotencyStore.ts`, `packages/core/src/adapters/cloudflare/scopeRouter.ts`, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`, `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/cloudflare/do/repositories/scopeCleanupAdmissionStore.ts`, `packages/core/src/adapters/cloudflare/do/repositories/appliedOperationStore.ts`, `packages/core/src/adapters/cloudflare/do/alarm.ts`, `packages/core/src/adapters/cloudflare/do/dueIndex.ts`, `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts`, `packages/core/src/adapters/cloudflare/do/scopeName.ts`, `packages/core/src/adapters/cloudflare/do/scopeObject.ts`, `packages/core/src/adapters/cloudflare/do/scopeStub.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`, `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/nesting.ts`, `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `packages/core/src/adapters/cloudflare/sql/errors.ts`, `packages/core/src/adapters/cloudflare/sql/executor.ts`, `packages/core/src/adapters/cloudflare/sql/json.ts`, `packages/core/src/adapters/cloudflare/sql/occGuard.ts`, `packages/core/src/adapters/cloudflare/sql/session.ts`, `packages/core/src/adapters/cloudflare/sql/statement.ts`, `packages/core/src/adapters/cloudflare/cursor.ts`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `packages/core/src/adapters/cloudflare/d1/migrations/0003_membership_directory.sql`, `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/idempotency.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformance/route.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeInfra.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformance/unitOfWork.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/ports/route.ts`, `packages/core/src/adapters/cloudflare/__tests__/ports/scopeInfra.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`, `packages/core/src/application/di/runtime.ts`, `spec/database/index.md`, `spec/platform/index.md`, `.thread/11/plan.md`, `.thread/11/adr.md`
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,globalMaintenanceRunStore,identityRemovalReceiptStore,identityRepository,identitySupport,identityUniqueDirectory,loginAttemptStore,oauthStateStore,publicNoteProjection,publicNoteQueryService,sessionRepository,userBatchReader,userRepository}.ts` — Identity / directory / projection 束であり routing・outbox・scope インフラの観点外（他観点の担当）
- スキップ: `packages/core/src/adapters/cloudflare/do/repositories/{llmUsageRepository,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,storageQuotaRepository,storedFileRepository}.ts` — scope business データの担当で、scope インフラ（task / admission / identity 固定）に触れない
- スキップ: `packages/core/src/adapters/cloudflare/{projection/*,search/*,r2/objectStorage.ts,sql/row.ts}` — 投影・全文検索・オブジェクトストレージ・値エンコードで観点外（`sql/row.ts` は型ヘルパーのみ）
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{conformanceBackend.ts,conformance/directory.test.ts,conformance/identity.test.ts,conformance/projection.test.ts,conformance/scopeBusiness.test.ts,deleteFilesByOwner.test.ts,durability.test.ts,env.d.ts,harness.test.ts,pendingPorts.ts,ports/deps.ts,ports/directory.ts,ports/identity.ts,ports/projection.ts,ports/scopeBusiness.ts,r2.test.ts,runtimeComposition.test.ts,support.test.ts,unitOfWork.test.ts,worker.ts}` — ハーネス／他束の適合入口／AC-5 実測で、担当観点の振る舞いを直接固定していない（`conformanceBackend.ts` と `ports/deps.ts` は W-007 の判断のため名前空間まわりのみ横断確認済み）
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイート呼び出し集合の一致検査（AC-2 の担保であり他観点）
- スキップ: `packages/core/{package.json,tsconfig.json,tsconfig.cloudflare.json,vitest.workers.config.ts,wrangler.test.jsonc}`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `docs/test.md` — ビルド／テスト基盤の設定で観点外
- スキップ: `.thread/11/{foundation,progress,steps,testing}.md` — 作業記録であり契約・設計判断は `plan.md` / `adr.md` で確認済み
