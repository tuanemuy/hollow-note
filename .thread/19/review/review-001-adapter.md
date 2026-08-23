# Adapter

観点: 適合スイートが契約を拘束しているか（ADR 026）、`selectDueScopeTasks` の選択アルゴリズム、判別共用体の設計と状態遷移、`scopeTaskQueue` の読み取り専用性、リース／reclaim、UoW ロールバック整合。

`pnpm vitest run adapters/memory/__tests__/conformance.test.ts unitOfWork.test.ts` は 223 件緑（手元で実行確認）。

## Blockers

なし。

選択アルゴリズムは手でトレースして正しさを確認した（詳細は末尾「検証メモ」）。判別共用体・明示構築・`scopeTaskQueue` の読み取り専用性・clock 非依存（`now` はすべて引数注入）・UoW ロールバック（`MemTable.set` の undo ログが claim の書き戻しも巻き戻す）はいずれも設計どおりに実装されている。

## Warnings

- **[W-001]** reclaim した行が**新しいリースを取ること**を適合スイートが拘束していない
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:249-268`（"reclaims a row whose lease lapsed…"）
  - 理由: このケースは失効後の `claim(10)` が行を返すことと `dueAt` / `attempt` / `priority` / `payload` が保たれることしか見ていない。**再 claim 後にその行が再びリース下に隠れるか**を誰も assert していないので、「失効行を返すが `lease_expires_at` を張り直さない」バックエンドがスイートを緑で通る。そのバックエンドは次の tick（既定 1 秒）で同じ行をもう一度配り、まだ走っている turn と二重実行になる — リースが存在する理由そのものが失われる。ポート JSDoc（`application/ports/scopeTaskScheduler.ts:88`）は `claimDue | pending (due) / running (lapsed lease) | running, leaseExpiresAt = now + leaseMs` と明記しているので、契約側は正しい。ADR 026 §2 の「スイート自体が契約の実行形」から見て、liveness/safety の中核が実行形から抜けている
  - 提案: 同ケースの末尾に 2 行足す。`expect(reclaimed[0]?.leaseExpiresAt).toEqual(new Date(backend.clock.now().getTime() + SCOPE_TASK_LEASE_MS))` と `expect(await claim(10)).toEqual([])`（同じ `now` での再 claim が空）。後者だけでも二重配布は落とせる

- **[W-002]** リース失効の境界（`leaseExpiresAt` ちょうど）をスイートが凍結しているのに、ポート JSDoc がその境界を書いていない
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:60-67` / 拘束側は `adapters/conformance/scopeTaskScheduler.ts:245-246, 255`
  - 理由: スイートは `advance(SCOPE_TASK_LEASE_MS - 1)` で claim されず、`advance(SCOPE_TASK_LEASE_MS)` で claim されることを要求する＝境界は**包含**（`leaseExpiresAt <= now`）。ところが JSDoc は「no reader sees that row again **until the deadline passes**」「running with a **lapsed** lease」としか書かない。同じ JSDoc が pending 側は `dueAt <= now` と不等号を明示しているのと非対称で、「passes」を素直に読んで `lease_expires_at < now` を書いた #11 の D1 実装はスイートで落ちる。これは ADR 026 §1 が名指しした失敗モード（スイートだけが規定していてポート定義から読み取れない振る舞い）そのもの。なお `spec/database/index.md`（本 PR で追加した節）は正しく `lease_expires_at <= now` と書いており、正本 3 つのうちポート JSDoc だけが緩い
  - 提案: `application/ports/scopeTaskScheduler.ts:67` の候補述語を「`pending` with `dueAt <= now` or `running` with `leaseExpiresAt <= now`」へ揃える（1 語の修正）

- **[W-003]** 同 `(priority, dueAt)` 内の `kind` / `operationId` タイブレークを拘束するケースが 1 つも無い
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts` 全体（該当ケース不在）
  - 理由: AC-2 は「返す順序も `(priority, dueAt, kind, operationId)` 昇順」、ADR-001 は「返却**集合**まで凍結する」ことを枠取りの根拠に置き、`spec/database/index.md:969` も同順を定めている。にもかかわらずスイートの priority 系ケースはすべて `dueAt` を互いにずらしてあり（`-10min` / `-5min` / `-1min`）、`kind` / `operationId` が実際に順序を決める局面が 1 件も無い。"upserts on (kind, operationId)…" ケースは同 `dueAt` の 2 行を作るが `toHaveLength(2)` と payload しか見ない。結果として `(priority, dueAt)` だけで並べ替えて残りを任意順に返すバックエンドがスイートを通る。ADR-001 が「順序が観測可能である以上バックエンド間で暗黙にばらつくほうが害が大きい」と明言して返却順を凍結した判断が、実行形では担保されていない
  - 提案: 同 priority・同 `dueAt` で `kind` 違い 2 件・`operationId` 違い 2 件を積んで `claim(10)` の順序を assert するケースを 1 本足す（`limit` を絞れば返却**集合**の一意性も同時に拘束できる）

- **[W-004]** `unitOfWork.test.ts` の追随が実効的でない — 「claim は継続の保存ではない」を実際には拘束していない
  - 場所: `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts:96-106`（"leaves the runner alone when the unit of work stored no continuation"）
  - 理由: このテストは新規 `MemoryBackend` の空の `scheduledTasks` に対して `claimDue` を呼ぶので、claim は 1 行も返さず**書き込みも起きない**。`kicks === 0` は claim の性質ではなく「表が空」から従うだけで、`createMemoryScopeUnitOfWorkProvider` の観測ラッパー（`scopeUnitOfWork.ts:62-70`）を将来 `claimDue` にも被せてしまった場合（＝毎 tick で runner を kick し続けるバグ）を捕まえられない。本 PR は `claimDue` を読み取りから**書き込み**へ変えた変更なので、ここは追随すべき箇所そのもの
  - 提案: 先に `schedule` で 1 行 commit（kick 1 回）→ 別 UoW で `claimDue` を呼んで実際に 1 行 claim させ、`kicks` が 1 のままであることを assert する。ついでに「claim した UoW が throw したら行が `pending` に戻る」ロールバックケースを 1 本足すと、本 PR で claim が undo ログに乗ったことも実行形になる（現在ロールバックを見ているのは `schedule` 経路のみ）

- **[W-005]** `listDue` の順序キー `(priority, dueAt, kind, operationId)` は scope 横断では全順序になっていない
  - 場所: `packages/core/src/application/ports/scopeTaskQueue.ts:26-32` / `packages/core/src/adapters/memory/scopeTaskQueue.ts:19-33`
  - 理由: JSDoc は「which scope carries the reserved row follows from `(dueAt, kind, operationId)`」と、scope をキーに含めずに一意性を主張している。しかし別 scope が同じ `(kind, operationId)` を持てば（`operationId` は operation ID 由来で scope に閉じていない）この 4 つ組は同値になり、memory では `scopeEntries()` の Map 挿入順＝プロセス内の scope 生成順にフォールバックする。D1 は行順で決まるので、同じ入力に対してバックエンド間で違う scope を返す。今の実装済み 4 kind では同 `(kind, operationId)` が 2 scope に同時に立つ経路は無いので実害は出ていないが、契約文が「一意に定まる」と読める以上、#11 が気づかず前提にしうる
  - 提案: JSDoc のタイブレークに scope を含める（例: 「ties break on the serialized scope key」）か、逆に「同値のときどの scope が載るかは未規定」と明示する。前者を採るなら memory 側の候補に scope キーを足して比較子へ入れ、適合スイートに 1 ケース

- **[W-006]** AC-6(b)「リース中の行は**どの scope のものも**結果に現れない」が単一 scope でしか実行されていない
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:236-247`
  - 理由: リース不可視性を見る唯一のケースは `scopeOf(1)` の 1 行だけを claim して `listDue` が空になることを確認する。scope 横断の `listDue` が「claim 済みの scope を候補から落とす」ことは、"reserves a slot across scopes…" ケース（`:472-496`）では claim を挟まないので拘束されていない。scope A の全行がリース中・scope B に低 priority が 1 件、という runner が毎 tick 通る形が実行形に無い
  - 提案: `:472-496` のケースを拡張し、scope 1 側を claim してから `listDue` を呼んで scope 2 の行だけが載ることを assert する（1 行追加で足りる）

- **[W-007]** ポート JSDoc の遷移表が `failed` を始点として書いていないが、実装は `failed` 行にも `backoff` / `backoffOrSchedule` を適用する
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:85-91` / `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts:129-149`
  - 理由: 表は `backoff | pending / running`、`backoffOrSchedule | absent / pending / running` と始点を列挙しているのに、memory の `backedOff` は `failed` 行を受けると `attempt` を上限超えでインクリメントし続けて `failed` のままにする。`failed` 行は claim されないので `attempt` は観測不能＝実害は無く、「Only `schedule` brings a `failed` row back」の一文とも矛盾しないが、AC-9 が「5 操作すべてについて明記」を要求している表に始点の穴が残っている。#11 が `WHERE status IN ('pending','running')` を付けるかどうかで `attempts` 列の値が分岐し、スイートは両方を通す
  - 提案: 表の 2 行に `/ failed`（結果は `failed` のまま、`attempt` の扱いを 1 語）を足すか、`failed` を no-op と規定して実装を揃える

- **[W-008]** `claimDue` が 1 バッチ分の `leaseExpiresAt` を単一 `Date` インスタンスで共有し、そのまま呼び出し側へ渡す
  - 場所: `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts:79-93`（`toScopeTask` の `dueAt` / `leaseExpiresAt` も同様）
  - 理由: `store.ts:96-100` は「Rows are treated as immutable snapshots」を undo ログが成立する根拠として明記している。`payload` は `clone()` で防御しているのに `Date` は素通しで、しかも `leaseExpiresAt` はバッチ全行＋返却値で同一インスタンスなので、呼び出し側が `setTime` すれば claim した全行の保存済みリースが同時に壊れる。`dueAt` の素通しは既存パターンなので本 PR 起因ではないが、`leaseExpiresAt` は本 PR で増えた面であり、しかもリースはロールバックでも直せない claim 状態そのもの
  - 提案: `toScopeTask` で `new Date(row.dueAt)` / `new Date(row.leaseExpiresAt)` を返す（`payload` の防御と同じ規律に揃える）。保存側は 1 インスタンス共有のままでよい

## 検証メモ（選択アルゴリズム）

`packages/core/src/adapters/memory/scopeTaskSelection.ts:32-53` を手でトレースした結果。

- **予約枠の正しさ**: `ordered` は `(priority, dueAt, kind, operationId)` 昇順なので同 priority の行は連続する。`reservedPriority` を「直前に見た priority」として `continue` する走査は、priority 昇順に各クラスの**先頭行**＝クラス内 `(dueAt, kind, operationId)` 最小を 1 件ずつ取ることと厳密に等価。ADR-001 の 2. と一致
- **`reservedPriority` 初期値**: `null`。priority 値域は `0 | 1 | 2 | 3` で `0 === null` は false なので、priority 0 が予約枠を落とす事故は起きない
- **`limit` < priority クラス数**: 予約ループが `selected.size >= limit` で打ち切られ、充填ループも即 break。結果は厳密 priority 昇順の先頭 `limit` 件（AC-5）。p0..p3 各 1 件・`limit: 2` → `[p0, p1]`（スイート `:184-205` と一致）
- **候補ゼロのクラス**: `ordered` に現れないので走査が自然にスキップする。分岐不要
- **`limit <= 0`**: 早期 return `[]`（AC-10）。`claimDue` / `listDue` の両方が同じ純粋関数を通るので 2 面で同一
- **候補が `limit` 以下**: 充填ループが全件を `Set` に入れ、最終 `filter` が `ordered` 全体を返す
- **返却順**: `ordered.filter((row) => selected.has(row))` なので、予約枠が挿入順を乱しても返却は必ず比較子と同一順（`Set` の挿入順ではない）。ここは正しく分けてある
- **具体トレース**
  - AC-5 の例（p0 に `dueAt` 1/2 の 2 件、p3 に 1 件、`limit: 2`）→ 予約 `[A(p0,due1), C(p3)]` → 充填は即 break → `[A, C]`。返却集合が一意（スイート `:207-234` と一致）
  - AC-3（p0 × 5 `-10min`、p3 × 1 `-1min`、`limit: 3`）→ 予約 `[p0-0, p3]` → 充填 `p0-1` → `[p0-0, p0-1, p3]`（スイート `:120-144` と一致）
  - AC-4（p0 のみ 10 件、`limit: 10`）→ 予約 1 件 + 充填 9 件 = 10 件。予約枠が上限にならない
- **計算量**: `[...candidates].sort()` の O(n log n) + 走査 3 本の O(n)。`Set` は参照同一性で、候補は表のキーごとに 1 行なので重複は生じない。防御コピーは 1 回だけで無駄なコピーは無い

## その他の確認結果（指摘に至らなかったもの）

- **判別共用体**: `store.ts:324-342` の 3 状態は `pending = dueAt`、`running = dueAt + leaseExpiresAt`、`failed = 時刻なし` で illegal states を型で排除できている
- **状態遷移の明示構築**: `schedule` / `claimDue` / `backedOff` の 4 分岐すべてが spread ではなくフィールド列挙。`failed` に `dueAt` / `leaseExpiresAt` が残留する経路は無い。`repositories/scopeTaskScheduler.ts:125-128` の WHY コメントは「spread は excess property check を通り抜ける」という非自明な制約の記録で、CLAUDE.md の「Default to no comments」の例外に該当する妥当なもの
- **`scopeTaskQueue.ts` の書き込み**: 無し。`isScopeTaskDue`（scheduler と同一述語）と `selectDueScopeTasks`（同一選択関数）を借りるだけで、リースも取らない。ADR-011 のとおり
- **clock のポート化**: `claimDue` / `listDue` / `backoff` はすべて `now` を引数で受け、memory アダプターは `backend.clock` を一切参照しない
- **UoW ロールバック**: `claimDue` の書き戻しは `MemTable.set`（`store.ts:114-128`）経由なので undo ログに乗り、scope UoW が throw すれば `running` → 元の `pending` へ戻る。`scopeUnitOfWork.ts:62-70` の観測ラッパーは `schedule` にしか被っていないので、claim が runner を空回しで kick することも無い（ただし W-004）
- **スイートが memory の実装詳細に依存していないか**: 生行を覗くケースは無く、すべてポート越しの観測（返る/返らない/順序/`attempt`/`payload`/`leaseExpiresAt`）に閉じている。ADR 026 §3 に適合
- **`schedule` の priority 上書き / `backoffOrSchedule` の priority 保持**（ADR-009）は `:289-306` / `:326-355` で拘束済み。`backoffOrSchedule` を **running 行**へ撃つ遷移（`deleteFilesByOwner` の stall 経路＝本番パス）も `:400-426` が実質的に拘束している（claim 済み行へ `backoffOrSchedule` → `advance(2s)` で claim できることが、リース解放と `state = pending` の両方を要求する）
- **`kind` → priority の割り当て**: `securityCleanup` = `storage.ownerDeleteContinued` / `usage.userCleanupContinued` / `identity.personalCleanupHandoverContinued`、`expiryCollection` = `identity.personalBarrierPruneContinued`。plan.md の分類どおり
- **`spec/database` の lease 節と memory 実装の整合**: 候補述語・再 claim 時の保存項目・`due_at` の意味がすべて一致
- **スコープ逸脱**: 担当ファイル内に plan.md の「含まれないもの」を越える変更は見当たらない（`last_error`・attempt 上限の運用イベント・D1/DO 実装はいずれも未着手のまま）

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `spec/database/index.md`, `spec/platform/index.md`, `spec/adr/026-port-contract-and-conformance.md`, `.thread/19/plan.md`
- 参考読み（担当外だがアダプター契約の整合確認のため）: `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/app/server.node.ts`, `apps/web/.env.example`
- スキップ: `.thread/19/adr.md`, `.thread/19/steps.md`, `.thread/19/testing.md` — 計画側の足場でアダプター実装の対象外（ADR-001/002/011/012 は根拠確認のため読了）
- スキップ: `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — 判別共用体化に伴う生行読みの形式追随のみで、アダプター契約を拘束しないユースケース層テスト（テスト観点の担当）
