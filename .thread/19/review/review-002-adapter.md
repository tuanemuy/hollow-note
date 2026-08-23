# レビュー 002 — Adapter（memory 実装 + 適合スイート）

memory 実装（`scopeTaskSelection.ts` / `repositories/scopeTaskScheduler.ts` / `scopeTaskQueue.ts` / `store.ts`）そのものは、手トレースでもミューテーションでも正しい。選択アルゴリズムは境界条件（`limit <= 0` / `limit` < priority クラス数 / 1 クラスのみ / 候補 ≤ limit）すべてで契約どおりに動き、返却順も同じ比較子、リース境界は `<=`、reclaim は attempt を消費せず `dueAt` を保つ。判別共用体の状態遷移も spread 残留なし、UoW ロールバックで claim が巻き戻ることも確認した。

問題は **適合スイート側の拘束力** に集中している。以下 2 件は、ADR 026 が「ポート定義に書き、スイートで実行形にする」と決めた liveness 契約が、**スイートを通っても検証されない**ケースである（本 Issue の目的は「#11 が D1 / DO を書く前提となる契約を確定させる」ことなので、memory が正しいことでは埋め合わせにならない）。指摘はすべてコードを一時的に壊して赤/緑を確認済み。作業ツリーは元に戻してある（`git status` clean）。

## Adapter

### Blockers

- **[B-001]** `complete` が `running` 行を消すことを、スイートが**まったく拘束していない**。名前が「completes … a running row」と謳っているテストが、`complete` を running 行に対する no-op にしても緑のまま通る
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:361-377`
  - 理由: このテストは claim 直後に `complete` し、`clock.advance(SCOPE_TASK_BACKOFF_BASE_MS)`（= 1 秒）してから `claim(10)` が `["op-backoff"]` だけを返すことを見ている。しかし `op-complete` の**リースは 5 分**残っているので、行が削除されていようが running のまま残っていようが、どのみち claim には現れない。assert は「complete が効いた」ことを一切区別していない。実測: `complete` を `if (row.state === "running") return;` に変えても `pnpm exec vitest run packages/core/src` は **882 passed / 0 failed**（スイートも application 層も全緑）。
    ポート JSDoc の遷移表（`application/ports/scopeTaskScheduler.ts:90` の `complete | any, including absent | row removed`）が要求する振る舞いのうち、`from = running` は本番の唯一の経路（runner は claim した行しか settle しない）であり、SQL バックエンドで `DELETE ... WHERE status = 'pending'` と書けば普通に落ちる種類の実装ミスである。落ちた場合の帰結は「リース失効後に同じ turn が永久に再実行される」で、まさに ADR 026 §1 が「スイートではなくポート定義に書け」と名指しした liveness 事故そのもの。もう一方の `backoff` 半分は（backoff が no-op なら 1 秒後の claim が空になるので）ちゃんと discriminating なので、穴は `complete` だけ。
  - 提案: 最後の claim の前にリースを跨がせる。`backend.clock.advance(SCOPE_TASK_LEASE_MS)` してから `claim(10)` すれば、`op-complete` が「消えた」のか「まだ running だった」のかが区別できる（backoff 側の `attempt: 1` / dueAt はリースを跨いでも保たれるので、既存 assert はそのまま活きる）。あるいは `listDue` 側で確認してもよい。

- **[B-002]** 「リースが失効した行は `listDue` に**戻ってくる**」がスイートで拘束されていない。`listDue` が running 行を一切候補にしない実装でも、共有スイートは全緑で通る
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:525-559`（契約文は `packages/core/src/application/ports/scopeTaskQueue.ts:36-38`「Rows under a live lease are not candidates and stay invisible here **until it lapses**」）
  - 理由: スイートが `listDue` について押さえているのは「リース中は見えない」だけで（`:241-243`, `:550-558`）、失効後に再び見えることは一度も assert していない。reclaim の検証は `claimDue` 側（`:249-299`）にしかない。実測: memory の `listDue` の述語を `isScopeTaskDue` から `row.state === "pending" && row.dueAt <= now` に差し替えると、**`ScopeTaskScheduler conformance [memory]` は 1 件も落ちず**、落ちるのは `application/workers/__tests__/scopeTaskRunner.test.ts:278` など memory 前提の application テスト 2 件だけだった。
    つまり #11 が同じスイートを import して緑にしても、この性質は検証されない。`listDue` は中央 runner が「どの scope に仕事があるか」を知る**唯一の経路**（`ports/scopeTaskQueue.ts:10-13`）なので、ここが落ちると停止した writer の scope は誰にも再発見されず、personal cleanup なら口座が `deleting` のまま永久に残る（同ファイル `:126-130` が自ら書いているとおり reference runtime に復旧 cron は無い）。
  - 提案: `:525` のテスト末尾（すでに全行 claim 済みの状態がある）に `backend.clock.advance(SCOPE_TASK_LEASE_MS)` を足し、`listDue(now, 10)` が scope 1 の行を再び載せることを assert する。B-001 と合わせて 1 ケースにまとめても良い。

### Warnings

- **[W-001]** `leaseMs` 引数が**どのテストからも非既定値で呼ばれていない**。`claimDue` が引数を無視して `SCOPE_TASK_LEASE_MS` 定数を使う実装でも、リポジトリ全体のテストが緑で通る
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:54-55`（`const claim = (limit: number, leaseMs = SCOPE_TASK_LEASE_MS) => …`）
  - 理由: この `leaseMs` 仮引数は**呼び出し側が 1 か所も渡していない**（`grep leaseMs` で確認）。実測: memory の `claimDue` を `new Date(now.getTime() + 5*60*1000)`（引数を捨てて定数を使う）に変えると `packages/core/src` + `apps/web` の **951 passed / 0 failed**。ポート JSDoc の `leaseExpiresAt = now + leaseMs`（`:89`）と、plan.md AC-17 が謳う「`SCOPE_TASK_LEASE_MS` 環境変数が `claimDue` まで届く」は、どちらも実行形の裏付けを持っていない。plan.md が「env 専用テストは足さない（`OUTBOX_LEASE_MS` の先例に揃える）」と決めたのは env 配線の話で、アダプターが引数を尊重するかは別問題（ただし `conformance/outboxRepository.ts:6` の `LEASE_MS` も既定値と同値なので、先例も同じ穴を持っている点は付記しておく）。
  - 提案: リース系の 2 ケース（`:236` / `:249`）だけでも既定と異なる `leaseMs`（例: `2 * SCOPE_TASK_LEASE_MS` あるいは `MINUTE_MS`）を渡し、`leaseExpiresAt` と「その値を跨いだときに初めて reclaim される」ことを assert する。使われない仮引数を残すくらいなら、そこを使い切るのが筋。

- **[W-002]** 遷移表に今回新設された「`failed` 行への `backoff` / `backoffOrSchedule` は `failed` のまま」がスイートで拘束されていない
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:91`（`… a row already 'failed' stays 'failed' with its 'attempt' still climbing past the ceiling`）に対して `conformance/scopeTaskScheduler.ts:481-497`
  - 理由: `:484` のループは `attempt` 0→8 まで回して**最後の 1 回で初めて `failed` になる**ので、「すでに `failed` の行を backoff する」経路は一度も通らない。この経路は本番で到達可能で（usecase が stall → 既存の `failed` 行に `backoffOrSchedule`）、バックエンドがここで pending に戻す実装をすると poison 行が永久に retry する。復帰経路が `schedule` だけであることは JSDoc の要（`:95-96`）なのに、実行形が無い。
  - 提案: `:493` の直後に `backoff` をもう 1 回（または `backoffOrSchedule` を 1 回）足し、時計をどれだけ進めても claim されないことを assert する。

- **[W-003]** 「reserves a slot for a high priority a backlog of low ones would delay」は、名前が謳う予約枠を**原理的に検証できない**テストになっている
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:146-168`
  - 理由: 候補が p3×5 + p0×1 で `limit: 2` の場合、予約枠が無くても充填パスだけで `(priority, dueAt, …)` 昇順の先頭 2 件は `[op-cleanup, op-expiry-0]` になる。最小 priority は常に充填パスで先頭に来るので、このシナリオで予約枠が効くことはあり得ない。実測: `selectDueScopeTasks` の予約パスを丸ごと削っても落ちるのは `reserves a slot for a low priority …` / `reserves the earliest row of each priority …` / `reserves a slot across scopes …` の 3 件だけで、このテストは緑のまま通る。assert 自体は正しい性質（priority 昇順）を見ているので害は無いが、契約の実行形としては「この名前のケースは押さえてある」と後続バックエンド作者を誤読させる。
  - 提案: 名前を実際に見ている性質（例: `puts a high priority ahead of an older low-priority backlog`）へ寄せる。予約枠の下限保証は `:120` のケースが担っているので、テストを増やす必要はない。

### 所見（指摘ではない）

- 選択アルゴリズムは手トレースで検証済み。ソート済み配列では同 priority が連続するため、`reservedPriority` に直前の priority だけを持つ 1 パスで「各クラスの `(dueAt, kind, operationId)` 最小行」を正しく取れる。`limit` 2 / 3 / 10、クラス数 4、候補ゼロのクラスありの各例で JSDoc の規定と一致した。計算量は `O(n log n)` の 1 ソート + 2 走査 + `Set` 参照で、`values()` のスナップショットコピー以外に不要なコピーは無い。
- `scopeTaskQueue.ts` は書き込みを一切持たず、scheduler と**同一の述語 `isScopeTaskDue` と同一の `selectDueScopeTasks`** を共有している（`limit <= 0` も共有関数側の 1 か所に集約）。AC-10 の「1 つの純粋関数で実装される」は満たされている。
- リースは `Clock` ポートから来た `now` にのみ依存し、アダプター内に `Date.now()` / `new Date()`（現在時刻取得）は無い。`new Date(now.getTime() + leaseMs)` は算術のみ。
- 判別共用体の遷移は `backedOff` / `claimDue` / `schedule` のいずれも明示構築で、spread による残留フィールドは無い。`store.ts:333-338` の JSDoc と `repositories/scopeTaskScheduler.ts:125-128` の WHY コメントが、その理由（excess property check を spread が擦り抜ける）を正しく残している。
- `adapters/memory/__tests__/unitOfWork.test.ts` の追加 2 ケースは実効的。claim を含む UoW が throw したとき行が `pending` に戻り、再 claim できることまで見ている（`MemTable` の undo ログ経由）。kick が 1 のままであることの assert も、`scopeUnitOfWork.ts:62-70` が `schedule` だけを観測している設計と 1 対 1 に対応している。
- スイートが memory の実装詳細に依存している箇所は見つからなかった。使っているのはポートと `backend.clock` / `backend.forScope` / `backend.scopeTaskQueue` だけで、保存表現は凍結していない（ADR 026 §3 に適合）。scope 横断の tie が未規定であることも `ports/scopeTaskQueue.ts:31-35` に明記され、テストは tie を避けて組んである。
- 修正の経緯・レビューへの弁明にあたるコメントは、担当範囲のコードにもテストにも無い。

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`（後 2 者は契約の正本として通読。ポート設計そのものの評価は port-application 観点の持ち分）
- スキップ: `.thread/19/**` — このPRのレビュー足場（Phase 7 で削除）。カバレッジ対象外
- スキップ: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts` — ランタイム / env 配線であり runtime 観点の持ち分（W-001 の根拠として `leaseMs` の到達経路のみ grep で確認）
- スキップ: `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts` — usecase / worker の呼び出し側で application 観点の持ち分
- スキップ: `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts` — application 層のテストで application 観点の持ち分（B-002 のミューテーションでどのテストが落ちるかの確認にのみ使用）
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — spec 観点の持ち分
