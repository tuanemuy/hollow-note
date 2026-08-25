### UoW / 実行機構・SQL 土台

#### 前提と読み方

判定基準は `CLAUDE.md`、`spec/platform/index.md`、`spec/database/index.md`、[ADR 023](../../../spec/adr/023-two-plane-unit-of-work.md) / [024](../../../spec/adr/024-in-memory-adapter-as-first-class-backend.md) / [026](../../../spec/adr/026-port-contract-and-conformance.md)、および `.thread/11/plan.md` の AC-1 / AC-3 / AC-7 と `.thread/11/adr.md`（ADR-001〜ADR-032）。

まず良い点を先に置く。**二平面 UoW の中核（ADR-001 / ADR-002 / ADR-008）はこの規模の変更としては非常によく通っている。**

- 「write-set をステージして 1 回で原子適用する」が両平面で 1 つの機構（`execution/writeSet.ts` + `sql/session.ts`）に収まり、適用先だけが D1 `batch()` / DO `transactionSync` に差し替わる形になっている。適合スイートが要求する (a) 全ロールバック (b) 半端な状態の不可視 (c) commit 後だけの kick が、`__tests__/unitOfWork.test.ts` と `__tests__/durability.test.ts` で**実バインディングに対して**観測されている（AC-3 の要求どおり、in-memory への読み替えは無い）。特に durability 側の「batch の途中文が拒否されたとき、その前の文が残らないこと」を**読み戻して**確かめている点は、この種のテストで一番省略されがちなところを省略していない。
- `_occ_guard`（ADR-008）は「行を持たない、違反されるための表」という発想が明快で、`OCC_GUARD_CONSTRAINT` を DDL と `classifySqlError` の両方が 1 つの定数から引くので DDL と分類が乖離しない。ADR-013 の二段構え（ステージ時の読みで固有符号、guard は同時実行の砦）も筋が通っている。
- `readRow` / `readRows` / `query` の 3 分岐（ADR-009）は「この読みは自分の書き込みを見る必要があるか」をコード上の選択として残す設計で、実際に**全 18 箇所の `readRows` が `matches` を渡しており、全 20 箇所の `readRow` が主キー読みになっている**ことを確認した。ADR-009 が自ら挙げた危険（述語のずれ）は、現時点では 1 件も踏んでいない。
- spec 側の追随（AC-9）も、私の担当範囲については済んでいる — `_occ_guard`、`scope_task_due_index`、`_scope_identity` の 3 節が `spec/database/index.md` に足され、`spec/platform/index.md` に単一 writer 前提の明文化が入っている。

そのうえで、契約に対して**確かに破れている経路が 1 つ**ある。

---

#### Blockers

- **[B-001]** `claimDue` が「掴めなかった行」も掴んだものとして返す — ポートが明示する per-row 排他が成立していない
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts:163-188`（`claimDue`）、同旨で `packages/core/src/adapters/cloudflare/do/alarm.ts:104-127`
  - 理由:
    `claimDue` は候補を読み（163 行、`session.query` = DO への RPC）、選ばれた各行に対して条件付き `UPDATE`（`claimStatement`、述語は候補述語の再掲）をステージし、**適用結果を一切見ずに** `selected` 全件を `ScopeTask` として返している（188 行）。

    ```ts
    const candidates = await queryCandidates(now, limit);
    const selected = selectDueRows(candidates, limit);
    ...
    await write(selected.map((row) => upsert({ ..., statement: claimStatement(...) })));
    return selected.map((row) => toScopeTask(row, leaseExpiresAt));   // ← 無条件
    ```

    候補読みの RPC と commit の RPC のあいだに別の writer が同じ行を claim すると、後着の `UPDATE` は述語に外れて 0 行になる。SQLite は 0 行更新をエラーにしない（まさに `_occ_guard` が存在する理由）ので commit は成功し、**敗者も勝者と同じ `ScopeTask` を受け取る**。

    これはポート JSDoc が名指しで禁じている振る舞いである（`packages/core/src/application/ports/scopeTaskScheduler.ts:71-77`）:

    > Claiming is exclusive per row: choosing a candidate and moving it to `running` is one atomic step, so two `claimDue` calls running at once never hand out the same row. … a backend without interactive transactions builds it from a conditional update whose predicate repeats the candidate test … **so that only the writer whose predicate still matches takes the row.**

    条件付き `UPDATE` は書いてあるが、「述語が成り立った writer だけが行を取る」という結論部分が実装されていない。

    影響は理論上のものではない。`ScopeTaskQueue.listDue` の JSDoc（`packages/core/src/application/ports/scopeTaskQueue.ts:16-20`）は「1 行を 2 つの runner へ提示してもコストは claim を 1 つ落とすだけ」と書いており、**その安全性を `claimDue` の排他に丸ごと預けている**。`application/workers/scopeTaskRunner.ts:159-190` はまさにその形（`listDue` → scope UoW を開いて `claimDue` → ハンドラ実行）で、2 つの runner プロセスが同じ行を掴むと継続ハンドラが二重に走る。`spec/platform/index.md` が新たに書いた単一 writer 前提（「複数 worker プロセス」は許し「1 scope に複数 writer」だけを禁じる）も、`listDue` が同じ scope を 2 プロセスへ提示しうる以上この経路を救わない。

    ADR-019 は「契約を変えない」と決めた。契約を変えないなら実装が契約を満たす必要がある — ここは AC-8 / [ADR 046](../../../spec/adr/046-port-contract-divergence.md) の手続きにも入っていない、単なる実装漏れである。

    なお `__tests__/lease.test.ts:75-107`（"gives a contested row to exactly one of two writers"）はこの欠陥を**通してしまう**。観測しているのが `claimStatement` を直接 2 本走らせたときの**格納された lease 値**（`expect([leaseA, leaseB]).toContain(row.lease_expires_at)`）だけで、「どちらの呼び出しが成功と答えたか」を一度も見ていないため、API レベルの排他が壊れていても緑になる。タイトルが主張していることをテストが検証していない。

  - 提案:
    1. ステージ時に、各 claim 文の**直前**に `occGuard(候補述語 AND kind = ? AND operation_id = ?)` を積む（ADR-008 のそのままの適用）。敗者の commit は guard で中断し、UoW ごと巻き戻る。runner は次 tick で取り直すので継続は止まらない。batch 全体が落ちる粒度で困るなら、`claimDue` を 1 行ずつの UoW に割るか、autocommit 経路では `RETURNING` / `meta.changes` で実際に更新できた行だけを返す形に分ける。
    2. `do/alarm.ts:119` の `claimed.push(task)` も同じく無条件だが、こちらは候補読み（106 行）と `transactionSync`（110 行）のあいだに `await` が無く、DO が単一スレッドである以上他の RPC は割り込めないので**現状は安全**。ただしその安全性は「この区間に await が入らないこと」だけに依存していて、コードからは読み取れない。await を 1 つ足した瞬間に B-001 と同じ壊れ方をするので、その旨をコメントに残すか、同じ guard を積んで機構を 1 つに揃えるのが望ましい。
    3. `lease.test.ts` の当該ケースを「2 つの `claimDue` 呼び出しのうち、行を返したのはちょうど 1 つ」を観測する形へ書き直す。さらに [ADR 026](../../../spec/adr/026-port-contract-and-conformance.md) / AC-8 に従い、`adapters/conformance/scopeTaskScheduler.ts` に「並行 `claimDue` は同じ行を 2 度渡さない」ケースを足すのが本筋である（memory は autocommit の claim が同期 JS なので、そのまま通るはず）。現在この性質を観測する適合ケースは 1 つも無い（`grep concurrent|Promise.all` で 0 件）ので、契約の穴がそのまま検証の穴になっている。

---

#### Warnings

- **[W-001]** alarm turn にハンドラ失敗の耐性が無く、`attempts` が永遠に増えない
  - 場所: `packages/core/src/adapters/cloudflare/do/alarm.ts:129-137`
  - 理由:
    `for (const task of claimed) { ... await handle(task, input.scope); handled += 1; }` は `try / catch` を持たない。ハンドラが投げると turn 全体が中断し、(a) 同じ chunk で claim 済みの残り行が**訪問されないまま `running` で残る** — `runScopeAlarmTurn` 自身の JSDoc が「訪問しない行を claim してはならない、リース 1 期間ぶんの遅延になる」と書いているまさにその状態 — (b) 失敗した行は `backoff` されないので `attempts` が 0 のまま、`SCOPE_TASK_MAX_ATTEMPTS` に永久に届かない。ポート JSDoc の「Parking a row as `failed` is the point of the attempt ceiling: one permanently failing target must not breed continuations forever」が成立しない。

    参照実装にあたる `application/workers/scopeTaskRunner.ts:176-189` は同じ位置で `try / catch` + `backOff` を持っており、その JSDoc は「the runner is then the only one left to back it off, and without that a permanently failing target would be re-driven every tick with `attempt` frozen at zero」と、この失敗の形を名指しで説明している。CF では alarm が runner の役割を持つ（`spec/platform/index.md`「scope-local cleanup は必ず Alarm で起動する」）ので、同じ義務が alarm turn 側に移っているはずである。CLAUDE.md の「worker → root: workers wrap per-row processing in try / catch for partial-failure tolerance」にも反する。

    さらに、`handlers` レジストリ（`do/alarm.ts:33`）を埋める `registerScopeTaskHandler` の呼び出しがリポジトリ全体で **0 件**なので、`await handle(...)` に到達する経路が今日は存在せず、`__tests__/alarm.test.ts` も 6 ケースすべてが "no handler" 経路しか通っていない。**alarm turn の主経路（ハンドラを実行する経路）にテストが 1 件も無い。** 配備一式が本 Issue の範囲外（ADR-005）である以上「今すぐ壊れる」わけではないが、alarm ハンドラは ADR-005 が明示的に**内側**へ入れたものなので、失敗経路の実装とテストもここに属する。

  - 提案: `await handle(...)` を `try / catch` で包み、失敗時に当該行を `backoffStatement` で settle する（alarm 内なのでローカル適用でよい）。`runScopeAlarmTurn` に注入可能な handler 集合（引数）を足せば、成功・失敗・部分失敗の 3 ケースをテストできる。モジュールレベルの可変 `Map` レジストリは isolate 全体で共有される暗黙の状態でもあり、テストからのリセット手段が無い点も引数化で解消する。

- **[W-002]** scope 平面の `_occ_guard` 翻訳が一度も検証されていない — RPC 越しにエラーメッセージが残ることに依存している
  - 場所: `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts:76-80`、`packages/core/src/adapters/cloudflare/sql/errors.ts:35-42`
  - 理由:
    `classifySqlError` は `message.includes("_occ_guard_conflict")` という**文字列一致**で判定する。global 平面は D1 のエラーが呼び出し元と同じ isolate に返るので `__tests__/unitOfWork.test.ts:296-320` が実バインディングで検証している。ところが scope 平面では、CHECK 違反は DO の `transactionSync` の中で発生し、**Durable Object RPC の境界を越えて**呼び出し元へ運ばれる。ここで制約名が落ちる／置き換わると、`throwTranslated("the scope unit of work", cause)` は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` ではなく `SystemError(DatabaseError)` を投げ、`OPTIMISTIC_LOCK_FAILURE` で分岐する usecase（`application/identity/updateProfile.ts` など）が競合を取り逃がす。

    そして scope 側リポジトリ（`noteRepository` / `storedFileRepository` / `storageQuotaRepository` / `noteProjection` / `llmUsageRepository` / `scopeCleanupAdmissionStore`）は全部 `occGuard` を積んでいる。にもかかわらず、`grep OPTIMISTIC_LOCK_FAILURE` で scope 平面の commit 由来の翻訳を観測するテストは **1 件も無い**（唯一のヒットは global 平面の `unitOfWork.test.ts:319`）。ADR-013 の二段構えにより、ステージ時の読みが単独実行では先に捕まえてしまうので、guard の発火は**真の同時実行でしか起きず、適合スイートも到達しない**。機構全体の最後の砦が未検証で残っている。
  - 提案: `__tests__/unitOfWork.test.ts` に scope 平面版の occ guard ケースを 1 つ足す（`_occ_guard` へ確実に当たる write-set を 2 本、`Promise.all` で同じ scope へ commit し、敗者が `code: "OPTIMISTIC_LOCK_FAILURE"` で落ちることを観測する）。文字列一致に依存し続けるなら、この 1 ケースが workerd の RPC エラー伝播の回帰検知そのものになる。

- **[W-003]** bound parameter 上限 100 の検査が scope 平面では丸ごと効いていない
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:157-161`、`packages/core/src/adapters/cloudflare/do/scopeStub.ts:30-44`、`packages/core/src/adapters/cloudflare/sql/executor.ts:77-92`
  - 理由:
    `assertBindable` は `createD1Executor`（`executor.ts:45`）と `createStorageExecutor`（`executor.ts:81`）にしか置かれていない。ところが `createStorageExecutor` は**リポジトリ全体で 0 箇所からしか参照されていない**（`grep` で定義と JSDoc のみ）。実際に scope 平面の SQL を実行しているのは `ScopeObject.exec`（`scopeObject.ts:157`）で、`this.ctx.storage.sql.exec(input.sql, ...input.params)` を直接叩いており検査を通らない。`createScopeStubExecutor` も statements をそのまま RPC へ流すだけである。

    `spec/platform/index.md:78-79` は scope DO 側にも同じ上限（SQL 文 100,000 バイト / bound parameters **100**）を定めており、`sql/statement.ts:27-33` の JSDoc も「Both planes cap positional bindings at 100」と書いている。つまり守るべき規約は両平面にあるのに、検査は片平面にしか無い。現状は全リポジトリが `json_each` 規約を守っているので実害は出ていないが、`__tests__/support.test.ts` が「上限違反はアダプタのバグであり、呼び出し地点を特定できるメッセージで落とす」という価値を主張している以上、その価値が scope 側で得られないのは非対称である。
  - 提案: `ScopeObject.exec` を `createStorageExecutor` 経由にするか、`exec` の先頭で `assertBindable(input)` を呼ぶ。ついでに `createScopeStubExecutor` の送信前にも掛けると、上限違反が RPC を跨ぐ前の呼び出し地点で落ちる。死んでいる `createStorageExecutor` はそれで生き返る。

- **[W-004]** `ScopeObject.bind()` が全 RPC で書き込みを起こし、かつ `scopeName.ts` の解析／直列化を再実装している
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:126-155`、`packages/core/src/adapters/cloudflare/do/scopeName.ts:49-57`
  - 理由:
    `bind` は呼び出しのたびに `INSERT INTO _scope_identity ... ON CONFLICT DO NOTHING` を撃ち、続けて `boundScope()` の `SELECT` を撃つ。`query`（58 行）も `applyWriteSet`（67 行）も毎回これを通るので、**1 回の読み RPC が 3 文（INSERT + SELECT + 本体）になる**。ADR-002 が「1 UoW あたりの読みの回数だけ RPC 往復が発生する。素朴に書くと往復が積み上がる」「foreground p95 500ms の SLO を実測で確認する必要がある」と自ら挙げたコストに、さらに定数倍が掛かっている。しかも DO SQLite では INSERT が（衝突して no-op でも）暗黙の書き込みトランザクションを開くので、読み専用の RPC が書き込み経路を通ることになる。ADR-025 の実測（`deleteFilesByOwner` で 203 往復）はこの分を数えていない。

    実装面では、`bind` が `scopeKey.indexOf(":")` による解析と `` `user:${bound.userId}` `` による直列化を手書きしている。同じ解析は `scopeName.ts:49` の `scopeColumnsFromName` として export されているが、**呼び出し元が 1 つも無い**（完全な死にコード）。同じく `scopeColumns`（`scopeName.ts:31`）も export されているのに、`scopeObject.ts:99-102`・`do/repositories/scopeTaskScheduler.ts:78-81`・`do/repositories/noteRepository.ts:104` の 3 箇所でインラインに再実装されている。`ScopeKey.serialize` の形式が将来変わったとき、直る場所と直らない場所が混在する。
  - 提案: 束縛済み ScopeKey をインスタンス変数へキャッシュし、2 回目以降は照合だけにする（object が生きているあいだ ScopeKey は不変なので安全。`blockConcurrencyWhile` の中で `boundScope()` を 1 回読めば constructor で済む）。解析と列変換は `scopeName.ts` の 3 関数へ寄せ、インラインの重複を消す。

- **[W-005]** due index の再公開が scope の全タスク数に比例し、上限を持たない
  - 場所: `packages/core/src/adapters/cloudflare/do/dueIndex.ts:32-65`、`packages/core/src/adapters/cloudflare/do/scopeObject.ts:97-107`、`packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts:84-89`
  - 理由:
    `publishDueIndex` は `dueIndexRowsStatement()`（`status <> 'failed'` の**全行**）を読み、`dueIndexStatements` が「当該 scope を全削除 + JSON 1 バインディングで全行 INSERT」を作る。`scheduled_tasks` に触れた commit のたびにこれが走るので、タスクを 1 件足すだけでも n 行を書き直す。`spec/database/index.md` の各所は「1 turn 最大 100 件」「1 page 100 件」という有界化を徹底しているのに、この派生索引だけが scope のタスク総数に対して無界である。継続要求が積み上がる scope（personal cleanup、`applied_operations` に残る command 由来の再駆動など）では、1 commit あたりの D1 書き込み行数と JSON バインディングのサイズが単調に増える。`spec/database/index.md:17` の行サイズ上限 2,000,000 バイトはバインディング値にも掛かるので、数千件で現実的な壁に触れうる。

    「全 slice 置き換え」を選んだ理由（2 つの更新経路が収束する）は `dueIndex.ts` の JSDoc に書かれており妥当だが、有界性とのトレードオフは書かれていない。
  - 提案: 少なくとも JSDoc に「行数に比例する。scope あたりのタスク数が有界であることに依存している」と前提を明記する。可能なら差分反映（触れた `(kind, operation_id)` だけを upsert / delete）へ寄せ、全置換は alarm turn 末尾の drift 治癒だけに限る — 収束の役割は alarm 側の全置換 1 本で足りる。

- **[W-006]** `readRows` のオーバーレイは `LIMIT` と組み合わせると件数を取りこぼす。`matches` が optional であることも含め、型で守られていない
  - 場所: `packages/core/src/adapters/cloudflare/sql/session.ts:100-130`
  - 理由:
    staged 経路は「SQL の結果（既に `LIMIT` 済み）から自 unit が触れた行を除き、ステージ済み行を足し、再度 `limit` で切る」。同一 UoW 内で `LIMIT n` の集合読みの対象行を削除していると、`stored` は n 件しか取ってきていないのに 1 件抜けて n-1 件になり、**storage 側に控えていた n+1 件目が繰り上がらない**。`limit + 1` 件読んで `hasMore` を決めるページング（`d1/repositories/identitySupport.ts:85-116` の形）と組み合わさると、`hasMore` が false 側に誤る。

    また `matches` は optional で、省略すると当該表のステージ済み行が `WHERE` と無関係に全部混ざる。JSDoc は「Omit it only when the statement selects a whole table」と書いているが型は何も強制しない。ADR-009 自身が「ずれれば read-your-writes が静かに壊れる」と認めているとおり、これは規律だけで支えられている。

    **現時点で踏んでいる箇所は無い**ことは確認した（`readRows` 全 18 箇所が `matches` を渡し、`limit` を渡す箇所と staged 削除が同居する経路も見当たらない）。指摘は将来の踏み外しに対するものである。
  - 提案: `matches` を必須にし、全表読みは明示的な `matches: ALL_ROWS` のような番人を通す。`limit` については「ステージ済み削除がある場合に SQL の `LIMIT` を補正できない」ことを JSDoc の制約として明記する（現在の JSDoc は "limit repeats the statement's LIMIT, applied after the merge" としか言っておらず、この非対称に触れていない）。
    - 併せて: ADR-014 は `deleteExpiredPage` の利点として「read-your-writes が掃引後も正しい」と書いているが、実装（`identitySupport.ts:85`）は掃引対象の読みに `session.query` を使っており、同一 UoW 内で 2 回掃引すると同じ行を再度数える。`remove` mutation により**他の**読みが正しくなるのは確かなので、ADR の書きぶりのほうを狭めるのが正確。

- **[W-007]** 出荷された機構の中に、呼び出し元の無い export が 6 つ残っている
  - 場所: `execution/writeSet.ts:83`（`markTouched`）/ `:111`（`stagedDeletions`）/ `:133`（`isEmpty`）、`sql/executor.ts:77`（`createStorageExecutor`）、`do/alarm.ts:45,52`（`registerScopeTaskHandler` / `scopeTaskHandlerFor`）、`do/scopeName.ts:49`（`scopeColumnsFromName`）
  - 理由:
    単なる未使用コードではなく、いずれも「この機構はこう拡張できる」という主張を型で置いたまま実体が無い状態になっている。特に危ないのが `markTouched` で、`WriteSet.stage` は `opaque` mutation の `table` を `touched` に**入れない**（`writeSet.ts:69-76`）。つまり将来 `scheduled_tasks` へ `opaque`（多行 DELETE など）で書くと、`scopeUnitOfWork.ts:82` の `touched.includes(SCHEDULED_TASKS_TABLE)` も `ScopeObject.applyWriteSet` の due index publish / alarm 再武装も**静かに飛ぶ**。その穴を埋めるために `markTouched` が用意されているのに、誰も呼んでいないので穴があること自体が見えない。

    `createStorageExecutor` の不在は ADR-002 の「write-set 機構は『適用先』を差し替えられる形にしておき、alarm 経路ではローカル適用にする」という約束が未達であることも意味する。型の上でも達成不能で、`ScopeUnitOfWorkOptions.openScope` は `ScopeSqlExecutor`（`applyWriteSet` を持つ）を要求するのに `createStorageExecutor` が返すのは素の `SqlExecutor` なので、そのままでは差し替えられない。この結果、alarm ハンドラが scope UoW を開こうとすると自分自身へ RPC を投げることになり、DO の自己呼び出しという別の危険を踏む。
  - 提案: `markTouched` は「`opaque` で `scheduled_tasks` を触る mutation を作る側が必ず呼ぶ」という規約を型で表現する（`opaque` に `table?` を持たせて `stage` 側で `touched` に入れる、が素直）。`createStorageExecutor` は W-003 の修正で `ScopeObject` から使うか、`ScopeSqlExecutor` を満たす形へ広げて alarm 経路のローカル適用を実装するか、どちらも今やらないなら削除して ADR-002 の当該行を「配備スライスの宿題」として書き直す。`scopeColumnsFromName` は W-004 の統合で使うか消す。

- **[W-008]** staged セッションの `claimDue` は候補読みがオーバーレイを通らない
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts:96-102`（`queryCandidates`）、`:163`
  - 理由: `session.query` は staged でも素通しなので、同一 UoW の中で `schedule` した行は `claimDue` から見えず、逆に同一 UoW の中で 2 回 `claimDue` を呼ぶと同じ行が 2 度選ばれる（ステージ済みの `running` 化がオーバーレイに載っているのに候補読みが読まない）。`backoff` / `backoffOrSchedule` はわざわざ `readRow`（オーバーレイ対応）を通しているので、同じリポジトリ内で読みの一貫性が割れている。ポート契約が同一 UoW 内の schedule → claim を要求していないため契約違反ではないが、ADR-009 が「`query` を選んだ箇所は意図的に素通しだと読める」と言う以上、その意図をコメントに残すべき箇所である。
  - 提案: `queryCandidates` に「候補読みは意図的に素通し。同一 UoW 内で schedule した行は候補にならない」という 1 行を足す。あるいは `readRows` + `matches`（候補述語の再掲）へ寄せて他の読みと揃える。

- **[W-009]** 1 つの UoW がステージできる文数に上限が無い
  - 場所: `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts:83`、`packages/core/src/adapters/cloudflare/sql/executor.ts:37-53`
  - 理由: `spec/platform/index.md` は 1 invocation あたりの D1 query 予算を 500 と定め、ADR-008 は「`_occ_guard` により 1 commit あたりの文数が最大 2 倍になるので、予算はこの倍率込みで読む」と書いている。ところが `WriteSet` にも `createD1Executor.apply` にも件数の番人が無い。`assertBindable` が「1 文あたりのバインディング」を守っているのと対照的に、「1 batch あたりの文数」は誰も見ていない。ADR-025 の実測が示したとおり、`deleteFilesByOwner` のようなバッチ処理は commit 内文数が件数に比例する（`4n + 3` のうち `2n + 1`）ので、バッチ上限の設定次第で静かに予算を超える。
  - 提案: `apply` の入口に上限チェック（超過は `databaseError` で呼び出し地点を名指し）を置くか、少なくとも `WriteSet` の JSDoc に「1 commit = 1 batch であり、D1 の invocation 予算に対する見積もりは呼び出し側の責任」と明記する。

- **[W-010]** （担当境界の外側に半分掛かる）`createCloudflareRuntime` の鍵束の既定値が isolate ごとに変わる
  - 場所: `packages/core/src/application/di/cloudflareRuntime.ts:143-147`（`ephemeralKeyRing`）、`:181-184`
  - 理由: `shareTokenKeyRing` / `deletionTicketKeyRing` を省略すると `crypto.getRandomValues` で毎回新しい鍵束が作られる。コメントは「Both rings must outlive a single request」と書いているが、Cloudflare Workers では**リクエストごとに別の isolate**（別 colo、別マシン）が担当しうるので、リクエストを跨いだ時点で version 1 が別の鍵を指す。共有リンクの protect / reveal と deletion ticket が isolate 境界で黙って壊れる。memory ランタイムでは `globalThis` シングルトンが 1 プロセス内で保証していた性質が、CF では保証されない。
  - 提案: `mailSender` と同じ扱い（必須オプション）にして、合成根で必ず渡させる。ADR-030 が `mailSender` について述べた「既定でスタンドインへ落とすと、黙って無効になる配備を型が許してしまう」がそのまま当てはまる。
  - 注: DI 合成は別レビュー観点と重なる可能性があるので、重複していたら片方に寄せてよい。

---

#### AC に対する所見（担当範囲）

- **AC-1（スタブ・仮実装不可）** — UoW / SQL 土台に仮実装は無い。ただし W-007 の 6 つの未使用 export は「機構の一部として置かれたが実体が繋がっていない」状態で、特に `createStorageExecutor`（ADR-002 の alarm ローカル適用）と `registerScopeTaskHandler`（alarm のハンドラ経路）は**約束された機構が未接続**という意味で AC-1 の縁にある。配備スライスへ送るならその旨を ADR に残すべき。
- **AC-3（実バインディング）** — 満たしている。`__tests__/{unitOfWork,durability,alarm,lease,harness,support}.test.ts` はすべて `cloudflare:test` の `env` 経由で D1 / DO / R2 の実バインディングを叩いており、in-memory への読み替えもモックも無い。`harness.test.ts` がバインディングの存在・両平面の schema 適用・`json_each`・`nodejs_compat` を明示的に固定しているのは良い。
- **AC-7（Node 参照ランタイムが緑のまま）** — 担当範囲では `packages/core/src/adapters/memory/` と Node entry に一切触れていないことを確認した（差分に memory 配下のファイルは 1 つも無い）。`application/di/runtime.ts` の `AppRuntime` 抽出も `memoryRuntime.ts` に注釈を足さない形（ADR-030）で、構造的部分型に任せている。
- **スコープ逸脱** — 担当範囲では見当たらない。`scope_task_due_index` の新設は plan.md の「含まれないもの」に触れず、ADR-003 で正当化され spec にも反映済み。物理 shard 化にも手を出していない。

---

#### カバレッジ

- 確認: `.thread/11/adr.md`, `.thread/11/plan.md`, `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/durability.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/harness.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/support.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/worker.ts`, `packages/core/src/adapters/cloudflare/cursor.ts`, `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`_occ_guard` / `scope_task_due_index` の DDL のみ）, `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/do/alarm.ts`, `packages/core/src/adapters/cloudflare/do/dueIndex.ts`, `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts`, `packages/core/src/adapters/cloudflare/do/scopeName.ts`, `packages/core/src/adapters/cloudflare/do/scopeObject.ts`, `packages/core/src/adapters/cloudflare/do/scopeStub.ts`, `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/nesting.ts`, `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`, `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`, `packages/core/src/adapters/cloudflare/sql/errors.ts`, `packages/core/src/adapters/cloudflare/sql/executor.ts`, `packages/core/src/adapters/cloudflare/sql/json.ts`, `packages/core/src/adapters/cloudflare/sql/occGuard.ts`, `packages/core/src/adapters/cloudflare/sql/row.ts`, `packages/core/src/adapters/cloudflare/sql/session.ts`, `packages/core/src/adapters/cloudflare/sql/statement.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`, `spec/database/index.md`, `spec/platform/index.md` — 計 35
- スキップ: `.thread/11/{foundation,progress,steps,testing}.md` — 実装の記録であって規約の正本ではなく、判定は plan.md と adr.md で足りる（4）
- スキップ: `docs/test.md`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json` — ツーリング / 依存関係で、UoW・SQL 土台の契約に関わらない（10）
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイート呼び出し集合の一致検査で、テスト網羅性の観点（別担当）（1）
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/conformance/{directory,identity,projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts`, `conformanceBackend.ts`, `pendingPorts.ts`, `env.d.ts`, `ports/{deps,directory,identity,projection,route,scopeBusiness,scopeInfra}.ts` — 適合ハーネスの配線で、機構そのものではない（18）
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{deleteFilesByOwner,idempotency,r2,runtimeComposition}.test.ts` — 性能実測 / 冪等 / R2 / DI 合成で、それぞれ別観点の担当（4）
- スキップ: `packages/core/src/adapters/cloudflare/d1/migrations/0003_membership_directory.sql`, `packages/core/src/adapters/cloudflare/d1/repositories/*`（`identitySupport.ts` を除く 18 ファイル） — 個別リポジトリの SQL / 契約実装で、リポジトリ観点の担当。土台の使われ方だけ `readRow` / `readRows` / `occGuard` の呼び出し形として横断確認済み（19）
- スキップ: `packages/core/src/adapters/cloudflare/do/repositories/*`（`scopeTaskScheduler.ts` を除く 9 ファイル）, `packages/core/src/adapters/cloudflare/do/schema.ts` — 同上（10）
- スキップ: `packages/core/src/adapters/cloudflare/projection/*`（4）, `search/*`（2）, `r2/objectStorage.ts`, `scopeRouter.ts` — 投影 / 検索 / オブジェクトストレージ / routing で観点外（8）
- スキップ: `packages/core/src/application/di/runtime.ts` — `AppRuntime` の型定義のみで、DI 合成観点の担当（1）

計: 確認 35 + スキップ 74 = **109**
