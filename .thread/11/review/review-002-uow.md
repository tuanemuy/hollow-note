### UoW / 実行機構・SQL 土台

#### 前提と読み方

判定基準は `CLAUDE.md`、`spec/platform/index.md`、`spec/database/index.md`、[ADR 023](../../../spec/adr/023-two-plane-unit-of-work.md) / [024](../../../spec/adr/024-in-memory-adapter-as-first-class-backend.md) / [026](../../../spec/adr/026-port-contract-and-conformance.md)、`.thread/11/plan.md` の AC-1 / AC-3 / AC-7、および `.thread/11/adr.md`（ADR-001〜ADR-055）。前ラウンドの結論は前提にせず、コードから読み直した。

良い点を先に置く。

- **write-set + 原子適用の骨格は締まっている。** `execution/writeSet.ts` + `sql/session.ts` の 1 機構に両平面が乗り、適用先だけが D1 `batch()` / DO `transactionSync` に差し替わる。「失敗時の全ロールバック」「並行 run が半端な状態を観測しない」「commit 後だけの kick」「入れ子禁止」が `__tests__/unitOfWork.test.ts` と `__tests__/durability.test.ts` で**実バインディングに対して**観測されている（AC-3）。特に durability 側が「batch の途中文が拒否されたとき前の文が残らない」を**読み戻して**確かめ、さらに「先にコミット済みの write-set は巻き添えにしない」まで見ているのは良い。
- **`_occ_guard` の穴が塞がっている。** `claimDue` は `opaque(occGuard(claimGuardStatement(...)))` を各 claim の直前に積み（`do/repositories/scopeTaskScheduler.ts:201-219`）、`__tests__/lease.test.ts:164` が「2 つの `claimDue` のうち行を返すのはちょうど 1 つ」を API レベルで観測している。scope 平面の guard 翻訳（DO の RPC 境界を制約名が越えること）も `__tests__/unitOfWork.test.ts:457` が実バインディングで固定した。条件付き UPDATE を持つリポジトリで guard を積んでいないものは、横断で見た限り無い。
- **上限系が実装と spec の両方に落ちている。** `assertBindable` が `createD1Executor` / `createStorageExecutor` / `createScopeStubExecutor` の 3 経路すべてに掛かり（scope 平面も含む）、`MAX_STATEMENTS_PER_COMMIT` は境界値の 2 ケースで固定されている。`json_each` 規約は `support.test.ts` が 500 / 100 件の実測で担保。
- **alarm turn の再入・有界化が実バインディングで観測されている。** 重み付きラウンドロビン、ハンドラ例外の backoff、CPU 予算で切られた claim 済み行の release（backoff ではなく release であること、`due_at` が動かないこと）、`nextWakeAt` の 2 候補、レジストリが空なら claim も武装もしないこと、リース満了での再入 — `__tests__/alarm.test.ts` の 10 ケースが個別に押さえている。
- **cursor は不透明性と非 capability 性が契約側と一致している。** `after` は必ず束縛値として渡り（`publicNoteQueryService.ts:126`、`noteRouteFanOutReader.ts:96-98`）、SQL へ埋め込まれる箇所は無い。ADR-048 でポート JSDoc 側を実装に寄せた判断も筋が通っている。
- **AC-9（spec 追随）は担当範囲では済んでいる。** `spec/database/index.md` に `_occ_guard` / `scope_task_due_index` / `_scope_identity` の 3 節、`spec/platform/index.md` に「1 scope に対する同時 writer は Alarm turn 1 本」と「run の lease は fencing である」が入った。
- **AC-7** — 担当範囲で `adapters/memory/` と Node entry には一切触れていない（差分に memory 配下のファイルは 0 件）。

そのうえで、二平面 UoW の契約に対して**確かに破れている経路が 1 つ**ある。

---

#### Blockers

- **[B-001]** commit 済みの scope UoW が、commit 後の後始末の失敗で「失敗」として呼び出し元へ返る
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:85-99`（`applyWriteSet`）、伝播先は `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts:89-95`
  - 理由:

    ```ts
    async applyWriteSet(scopeKey, statements, touchedTables): Promise<void> {
      const scope = await this.bind(scopeKey);
      await this.sql.apply(statements);          // ← ここで commit 完了（transactionSync）
      if (touchedTables.includes(SCHEDULED_TASKS_TABLE)) {
        await rescheduleAlarm(this.ctx.storage); // ← 落ちうる
        await this.publishDueIndex(scope);       // ← D1 への write。落ちうる
      }
    }
    ```

    `publishDueIndex` は `createD1Executor(this.env.GLOBAL_DB).apply(...)` で、DO から **global D1 へ出て行くネットワーク書き込み**である。D1 の overloaded / 5xx / タイムアウトは実運用で起きる。ここで throw すると `applyWriteSet` 全体が reject し、`scopeUnitOfWork.ts:92-94` の `catch` が `throwTranslated("the scope unit of work", cause)` を通して `SystemError(DatabaseError)` にして呼び出し元へ返す。

    呼び出し元から見ると `run` は失敗したのに、**scope 側のデータと outbox 行は既にコミット済み**である。結果として:

    1. [ADR 023](../../../spec/adr/023-two-plane-unit-of-work.md) と適合スイート `conformance/unitOfWork.ts` が要求する「失敗＝全ロールバック」が観測上破れる。呼び出し元は「書かれていない」前提で再試行し、同じ operation が二重に適用される（OCC 版が動いていれば `OPTIMISTIC_LOCK_FAILURE`、動いていなければ二重書き）。
    2. `scopeUnitOfWork.ts:96-101` の 2 つの kick が飛ぶ。**outbox 行はコミット済みなのに relay は蹴られず、`scheduled_tasks` に積んだ継続は runner に知らされない。** plan.md の「リスクと注意点」が最悪ケースとして挙げた「継続の鎖が止まる」がまさにこの形で起きる。
    3. `rescheduleAlarm` が先に落ちた場合は `publishDueIndex` にも到達しないので、**alarm も武装されず due index にも載らない**。`do/dueIndex.ts` の JSDoc が言う「drift は次の alarm turn が治す」は、その alarm 自体が武装されていないので成立しない。自己治癒は「次に誰かが同じ scope へ `scheduled_tasks` を書く」まで来ない。

    そしてこれは設計判断ではなく**非対称な書き漏らし**である。まったく同じ「commit 後の due index publish」を行う autocommit 側は、`do/repositories/scopeTaskScheduler.ts:113-121` で明示的に逆の方針を採っている:

    ```ts
    try { await publishDueIndex(); } catch (cause) {
      // The scope-side write has landed, so reporting a failure here
      // would invite the caller to retry a settle that already took
      // effect. The index is derived data, not the authority ...
      logger.warn("scope task due index publish failed", { cause });
    }
    ```

    ADR-020 は「index publish の呼び出し順序が 2 箇所に現れる」ことをトレードオフとして認めているが、**2 箇所で失敗時の扱いが違う**ことは述べていない。`scopeObject.ts:93-95` のコメントも「arming を先にする」という順序の話に終始していて、この経路の失敗が呼び出し元へどう見えるかには触れていない。

    現状これを観測するテストは無い（`durability.test.ts:161` は commit **前**の拒否だけを見ている）。

  - 提案:
    1. `applyWriteSet` の post-commit ブロックを `try / catch` で囲み、`scopeTaskScheduler.write` と同じ方針（derived data の drift は許容し、log に落とす）に揃える。`rescheduleAlarm` と `publishDueIndex` はそれぞれ独立に囲む — arming が落ちても index publish は試すべきで、逆も同じ。
    2. arming が落ちたときの自己治癒経路を 1 つ確保する。`publishDueIndex` が成功していれば中央 runner の `listDue` が拾えるので、**publish を先・arm を後**に入れ替えるか、あるいは arm 失敗時に publish を必ず通す形にする（現在の順序は「D1 が落ちても arm は生きる」を狙っているが、arm 側が落ちる場合の対称な保険が無い）。
    3. `__tests__/durability.test.ts` に「commit は通り post-commit の publish が落ちた turn」のケースを足す（`GLOBAL_DB` を差し替えられないなら、`publishDueIndex` を注入可能にするのが素直）。観測すべきは「`run` が resolve すること」「scope 側の行が残ること」「due index に載っていなくても次の alarm turn で載ること」。

---

#### Warnings

- **[W-001]** `alarm()` が turn の例外で後始末ごと落ち、object が武装されないまま残る
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:101-115`
  - 理由: `runScopeAlarmTurn` はハンドラ例外を内側で `try / catch` するが（`do/alarm.ts:191-206`）、それ以外 — claim の `transactionSync`、`backoffStatement` / `releaseStatement` の直接 exec、候補読み — は素通しで throw する。throw すると `alarm()` の残り 2 行（`rescheduleAlarm` / `publishDueIndex`）に到達せず、**alarm が張り直されない**。workerd の alarm 再試行が尽きた時点でその scope の継続は止まり、`do/alarm.ts` の JSDoc が言う「訪問しなかった行はリース満了まで再開できない」よりさらに悪い、無期限の停止になる。B-001 と同じ「後始末は失敗しても必ず通す」という規律の問題で、修正も同じ形（`try / finally`）で済む。
  - 提案: `runScopeAlarmTurn` の呼び出しを `try / finally` に入れ、`finally` で `rescheduleAlarm` + `publishDueIndex` を必ず通す（それぞれ独立に catch する）。turn 自体の失敗は log に落として alarm 側の再試行に任せる。

- **[W-002]** commit 後の 2 つの kick が、開いた UoW の `AsyncLocalStorage` 文脈の**内側**で走る
  - 場所: `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts:96-101`、`packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts:97-99`、機構は `execution/nesting.ts:16-30`
  - 理由: `runInUnitOfWork(plane, fn)` は `openUnit.run(plane, fn)` で、`fn` の中で作られた promise / 継続はすべてこの store を継承する。`relayTrigger?.kick()` と `scopeTaskTrigger?.kick()` は `fn` の中（commit 後だが `openUnit.run` の内側）で呼ばれているので、**kick 実装が同期的に始めた仕事はすべて「UoW が開いている」文脈を引き継ぐ**。Cloudflare で `bindRelayTrigger` に `ctx.waitUntil(processOutboxEvents(...))` のようなインライン実装を渡すと（`application/di/runtime.ts:12-14` はまさにその形の runner を想定している）、その中の `globalUnitOfWorkProvider.run` が `Unit-of-work nesting is forbidden` で reject する。`waitUntil` の中なので誰も catch せず、relay が黙って止まる。

    memory バックエンドは ALS を持たないので、この壊れ方は **CF でだけ**起きる。配備一式が本 Issue の範囲外（ADR-005）なので今日は誰も踏まないが、踏むのは次のスライスの先頭であり、そのとき原因は自明ではない。ADR-001 / ADR-002 のどちらもこの含意に触れていない。
  - 提案: kick を `runInUnitOfWork` の外へ出す。`runInUnitOfWork` は値と「kick すべきか」を返し、呼び出し側（`run` の本体）が `openUnit.run` の解決後に kick する形にすれば 5 行で済む。少なくとも `nesting.ts` の JSDoc に「`fn` の中で始めた非同期処理はこの文脈を継承する。commit 後のフックから UoW を開く実装を渡さないこと」を明記すること。

- **[W-003]** `readRows` の `LIMIT` ガードが「削除」しか見ておらず、「述語から外れる更新」を素通しする
  - 場所: `packages/core/src/adapters/cloudflare/sql/session.ts:128-155`
  - 理由: ガードは `staged.includes(null)`、つまり**このユニットが削除した行**だけを検出する（`session.ts:133-141`）。ところが直後のマージは、`staged[index] !== undefined` の行を `stored` から落としたうえで、オーバーレイ側の寄与を `spec.matches` で絞る:

    ```ts
    const merged = stored
      .filter((_, index) => staged[index] === undefined)
      .concat(writeSet.stagedRows(spec.table).map(([, row]) => row).filter(spec.matches));
    ```

    したがって「このユニットが `upsert` した結果 `matches` を満たさなくなった行」も、削除とまったく同じく結果から消える。`stored.length === limit` の満杯ページでこれが起きると、storage 側に控えていた n+1 件目は繰り上がらず、**短いページが静かに返る** — ADR-035 が「拒む」と決めたその状態が、ガードを通り抜けて実現する。ADR-035 の Context は穴を 2 つ挙げているが、この 3 つ目には触れていない。

    形の上で最も近い呼び出しは `authTokenRepository.findPendingByUserAndPurpose`（`limit: 1`、`matches` は `status = 'pending'`）で、同一 UoW 内で当該 token を pending 以外へ `save` した後に呼ぶとこの経路に入る。実害は「pending は実質 1 件」という前提に救われていて今日は出ないが、その前提はスキーマではなくコメント（`authTokenRepository.ts:131-134`）にしか無い。

    **逆方向（正当な使い方の誤検出）は確認した限り無い。** ガードが撃たれる条件は「SQL の `LIMIT` が満杯 かつ その中に同一ユニットの削除行が含まれる」で、`limit` を渡す `readRows` と staged 削除が同居する経路は現状 0 件（掃引系の `deleteExpiredPage` / `deleteBoundedByKey` は `session.query` を使うので対象外、`sessionRepository.deleteById` の呼び出し元 `signOut` / `authenticateSession` は autocommit の reader 経由）。`limit: 1` の主キー相当の読み（`sessionRepository.findByTokenHash` など）については、同一 UoW で消してから引くと `null` ではなく `SystemError` になるので、そういう順序を書くならガードのほうを見直す必要がある — 今は誰も書いていない。
  - 提案: ガードの条件を「`stored` のうち結果へ残らなかった行が 1 件でもあるか」へ広げる。`staged.includes(null)` を `stored.some((row, i) => staged[i] !== undefined && !spec.matches(staged[i]))` と併せて判定すれば、削除と「述語から外れる更新」が 1 つの条件で閉じる。メッセージも「deleted」ではなく「dropped」に寄せる。

- **[W-004]** `globalMaintenanceRunStore.ts` に **生の NUL バイト**が埋まっていて、ファイルがテキストとして扱われない
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/globalMaintenanceRunStore.ts:761`、`:782`
  - 理由: cursor のキーセット位置を `` `${intOrNull(last, "expires_at") ?? 0}<NUL>${text(last, "run_id")}` `` と組み立て、分解側も `after.indexOf("<NUL>")` で切っているが、どちらも**エスケープ `\u0000` ではなく U+0000 のリテラル**が書かれている。結果:

    - `file(1)` はこのファイルを `data` と判定する。CF アダプター配下 41 ファイル中、これ 1 つだけ。
    - `grep` は既定でバイナリとみなして**マッチを出さない**。実際、`grep -rln occGuard` にこのファイルは現れず、`_occ_guard` を使っているのに使っていないように見える（`grep -a` で 9 箇所ヒットする）。レビューでも将来の改修でも、このファイルは検索から消えている。
    - 同じ用途の正規の道具が既に `sql/row.ts:114` に `compositeKey` としてあり、その JSDoc は「**the escape sequence (not a raw byte) keeps call sites greppable**」と、まさにこの事故を名指しで避けるよう書いている。しかも同ファイルは `:119` で `compositeKey` を別の鍵に使っている。

    動作としては壊れていない（JS の文字列としては同じ 1 文字で、`JSON.stringify` も `\u0000` に符号化する）。壊れているのは可読性と道具立てのほうだが、`grep` から消えるファイルは実質レビュー不能である。
  - 提案: 2 箇所を `compositeKey(...)` / `"\u0000"` に置き換える。ついでに `compositeKey` 側に対応する分解関数を置くと、区切り文字の知識が 1 箇所に閉じる。CI に「ソースに制御文字を入れない」チェックを足すのも安い（`git grep -Il '' -- '*.ts'` との差分で足りる）。

- **[W-005]** `userBatchReader.resolveMany` だけが駆動エラーを翻訳せず、D1 のエラーを application へ素通しする
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/userBatchReader.ts:44-52`
  - 理由: ADR-034 は「`session.query` / `readRow` / `readRows` / `write` を**直接**呼ぶ地点だけを `try / catch` で包む」と決めており、CLAUDE.md の「adapter → application: adapters catch driver-specific errors and translate them」も同じことを言う。`resolveMany` は `session.readRows` を直接呼んでいて、`try / catch` を持たない。CF アダプター配下で `session.*` を直接叩きながら翻訳を持たないのはこのファイルだけである（`scopeRouter.ts` はポート再利用なので ADR-034 の通り正しく持たない、`publicNoteProjection.ts` は `snapshotWriter` に委譲、`projection/{noteSearchRow,viewerCalendar}.ts` は純粋関数、`cursor.ts` は自前の `ValidationError`）。

    実害は「D1 の生 `Error` が usecase を素通りして presentation の unknown 分岐へ落ちる」ことで、`SystemError(DatabaseError)` として扱われない。`membership_directory` からのユーザー一括解決という、public ページの表示経路に乗る読みなので、失敗の分類が変わる意味は小さくない。
  - 提案: 他 18 ファイルと同じ形で `readRows` を `try { … } catch (cause) { throwTranslated(\`${TABLE} batch read\`, cause); }` に包む。`ids.length > MAX_BATCH` の自前 throw は `try` の外に置いたまま（ADR-034 の Consequences が言う「自分のエラーを投げる分岐を try に入れない」）。

- **[W-006]** 1 commit の文数上限が autocommit 経路には掛かっていない
  - 場所: `packages/core/src/adapters/cloudflare/sql/session.ts:103-105`（`createAutocommitSession.write`）、`packages/core/src/adapters/cloudflare/sql/statement.ts:35-50`
  - 理由: ADR-036 は「1 commit = 1 `batch()` = 文数ぶんの query」を根拠に `MAX_STATEMENTS_PER_COMMIT = 250` を置いたが、検査は `execution/globalUnitOfWork.ts:87` にしか無い。`createAutocommitSession.write(mutations)` も `executor.apply(...)` を通って**同じ 1 batch** になるので、同じ予算を同じ形で消費するのに番人がいない。`identitySupport.deleteExpiredPage` / `deleteBoundedByKey` は呼び出し側の `limit` ぶんの `DELETE` 文をそのまま 1 batch に積む形で、今日は `PAGE_LIMIT = 100`（`application/identity/pruneExpiredAuthState.ts:28`）に収まっているが、その 100 は adapter 側からは見えない値である。ADR-036 が謳う「バッチ上限を上げた変更が静かに予算を割ることがない」は、UoW 経由の commit にしか当てはまっていない。
  - 提案: 検査を `createD1Executor.apply` の入口へ下ろす（そこなら UoW / autocommit の両方が通り、`assertBindable` と同じ位置になる）。下ろさないなら ADR-036 の Decision に「autocommit の 1 write は検査対象外である」ことと、その安全性が呼び出し側の `limit` に依存していることを明記する。

- **[W-007]** 機構の JSDoc に、実体と食い違う記述が 2 箇所残っている
  - 場所: `packages/core/src/adapters/cloudflare/do/schema.ts:9`、`packages/core/src/adapters/cloudflare/sql/session.ts:19-26`
  - 理由:
    - `do/schema.ts:9` は「`applyScopeSchema` は冪等で、object の起動ごとに走る」と書くが、`applyScopeSchema` という識別子はリポジトリに存在しない（実体は `SCOPE_SCHEMA_STATEMENTS` を `ScopeObject` の constructor が回す形）。読み手は無い関数を探すことになる。
    - `sql/session.ts` の `ALL_ROWS` の JSDoc は「a missing predicate and a deliberately absent one look identical **once `matches` is optional**」と書くが、ADR-035 の決定どおり `matches` は既に必須になっている（`RowsRead` の型定義、`session.ts:51`）。`ALL_ROWS` が存在する理由の説明としては読めるものの、前提が現状と逆になっている。
  - 提案: 前者は `SCOPE_SCHEMA_STATEMENTS` を名指しする。後者は「`matches` は必須なので、全表読みも述語を書かねばならない。その述語が `ALL_ROWS` である」という順接に直す。

---

#### AC に対する所見（担当範囲）

- **AC-1（スタブ・仮実装不可）** — 担当範囲に仮実装は無い。前ラウンドで挙がっていた未接続 export（`markTouched` / `createStorageExecutor` / `scopeColumnsFromName`）はすべて解消され、`registerScopeTaskHandler` もテストから駆動される実経路を持つ。
- **AC-3（実バインディング）** — 満たしている。`__tests__/{unitOfWork,durability,alarm,lease,sessionOverlay,support,harness,globalConcurrency,idempotency,deleteFilesByOwner}.test.ts` はすべて `cloudflare:test` の `env` 経由で D1 / DO / R2 を叩き、in-memory への読み替えもモックも無い。`runInDurableObject` / `runDurableObjectAlarm` を使って object の内側から観測している点も、この層のテストとして正しい形。
- **AC-7（Node 参照ランタイムが緑のまま）** — 担当範囲では `adapters/memory/` と Node entry に触れていない。`application/di/runtime.ts` は `AppRuntime` の型抽出のみで、memory 側は構造的部分型に任せている。
- **スコープ逸脱** — 担当範囲では見当たらない。`scope_task_due_index` の新設は ADR-003 で正当化され spec に反映済み、物理 shard 化にも手を出していない。

---

#### カバレッジ

- 確認: `.thread/11/adr.md`（ADR-001 / 002 / 003 / 008 / 009 / 013 / 019 / 020 / 034 / 035 / 036 / 044 / 045 / 046 / 047 / 048）, `.thread/11/plan.md`, `.thread/11/review/review-001-uow.md`, `.thread/11/review/triage-keys.md`（4）
- 確認: `packages/core/src/adapters/cloudflare/execution/{writeSet,nesting,globalUnitOfWork,scopeUnitOfWork}.ts`（4）
- 確認: `packages/core/src/adapters/cloudflare/sql/{errors,executor,json,occGuard,row,session,statement}.ts`（7）
- 確認: `packages/core/src/adapters/cloudflare/cursor.ts`, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`（2）
- 確認: `packages/core/src/adapters/cloudflare/do/{alarm,dueIndex,scheduledTasks,schema,scopeName,scopeObject,scopeStub}.ts`, `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`（8）
- 確認: `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`_occ_guard` / `scope_task_due_index` の DDL）（2）
- 確認（土台の使われ方として横断）: `packages/core/src/adapters/cloudflare/d1/repositories/{identitySupport,userBatchReader,globalMaintenanceRunStore,identityUniqueDirectory,sessionRepository,authTokenRepository,identityRemovalReceiptStore,noteRouteFanOutReader,publicNoteQueryService,publicNoteProjection}.ts` — `readRow` / `readRows` / `limit` / `occGuard` / エラー翻訳 / cursor の呼び出し形を検査（10）
- 確認: `packages/core/src/adapters/cloudflare/__tests__/{unitOfWork,durability,alarm,lease,sessionOverlay,support,harness,globalConcurrency,idempotency,deleteFilesByOwner}.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/worker.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformance/unitOfWork.test.ts`（12）
- 確認: `packages/core/src/application/di/cloudflareRuntime.ts`（UoW / session / trigger の配線部分）, `packages/core/src/application/di/runtime.ts`（2）
- 確認: `spec/platform/index.md`, `spec/database/index.md`（`_occ_guard` / `scope_task_due_index` / `_scope_identity` / 実行予算の節）（2）
- スキップ: `.thread/11/{foundation,progress,steps,testing}.md`, `.thread/11/review/triage.md`, `.thread/11/review/review-001-{composition,identity,routing,scope}.md`, `.thread/11/review/review-001.md` — 実装記録と他観点の前ラウンド記録で、判定の正本は plan.md / adr.md / triage-keys.md で足りる（10）
- スキップ: `.github/workflows/ci.yml`, `docs/test.md`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json` — ツーリング / 依存関係で、UoW・SQL 土台の契約に関わらない（12）
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformance/{directory,identity,projection,route,scopeBusiness,scopeInfra}.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/cloudflare/__tests__/env.d.ts`, `packages/core/src/adapters/cloudflare/__tests__/ports/{deps,directory,identity,projection,route,scopeBusiness,scopeInfra}.ts` — 適合ハーネスの配線とスイート網羅性の検査で、テスト構成観点の担当（16）
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{r2,routeGuard,runtimeComposition,searchEdges}.test.ts` — R2 / routing guard / DI 合成 / 検索エッジで、それぞれ別観点の担当（4）
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,distributedOperationStore,idempotencyStore,identityRepository,loginAttemptStore,noteRouteStore,oauthStateStore,outboxRepository,userRepository}.ts` — 個別ポートの契約実装で identity / routing 観点の担当。土台の使われ方（`occGuard` の有無、`readRow` / `readRows` の形）だけ横断で確認済み（9）
- スキップ: `packages/core/src/adapters/cloudflare/do/repositories/{appliedOperationStore,llmUsageRepository,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,scopeCleanupAdmissionStore,storageQuotaRepository,storedFileRepository}.ts` — 同上、scope 観点の担当（9）
- スキップ: `packages/core/src/adapters/cloudflare/projection/{noteSearchRow,searchClauses,snapshotWriter,viewerCalendar}.ts`, `packages/core/src/adapters/cloudflare/search/{bigram,highlight}.ts`, `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`, `packages/core/src/adapters/cloudflare/scopeRouter.ts` — 投影 / 検索 / オブジェクトストレージ / routing で観点外。エラー翻訳の有無だけ横断で確認済み（8）
- スキップ: `packages/core/src/domain/note/ports/{localNoteQueryService,publicNoteQueryService}.ts` — ポート JSDoc の文言改訂（ADR-048）で、契約観点の担当（2）

計: 確認 53 + スキップ 70 = **123**（変更ファイル一覧の 123 行と 1 対 1）
