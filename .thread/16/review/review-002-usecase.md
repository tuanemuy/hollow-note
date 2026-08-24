# レビュー 002 — Issue #16 / PR #45

## Use Case / ポート契約

### Blockers

- **[B-001]** 返る lane の `asOf` の出どころが契約に書かれておらず、適合スイートの `asOf` アサーションも失敗を検出できない（形骸化）
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:280,306,370` / `packages/core/src/application/ports/globalMaintenanceRunStore.ts:55`
  - 理由: 契約 2 は「`advanceOrAck` は lane を `table` / `cursor` / `asOf` / `commandKey` ごと返す」とだけ書き、**`asOf` が run 行の固定値であること**を一言も定めていない。`MaintenanceLane` の型 JSDoc も `generation` の意味だけを説明して `asOf` には触れず、一方で `checkpointLane` は `asOf` を**入力に取る**ので、JSDoc だけを読む別バックエンドの実装者には「lane 側に checkpoint 時の `asOf` を持つ／ack 時に `now()` を打つ」も自然な読みになる。`asOf` は sweep の境界（`expiresAt <= asOf`）そのものなので、ここがずれると lane ごとに違うキーセットを掃き、「resume は最古の `asOf` を保つ」という run の中核不変条件が lane 経由で破れる。
    そして適合スイートはこれを捕まえない。ADP-common-029 のどのケースも `begin()`（`candidateAsOf = clock.now()`）以降に `backend.clock.advance()` を呼ばないため `run.asOf === clock.now()` が全期間で成立し、`toEqual(lane.asOf)` は「壁時計を打つ実装」と区別できない。実測で確認した: memory adapter の `toLane` を `asOf: backend.clock.now()` に差し替えても `packages/core/src/adapters/memory/__tests__` の 259 件が全緑のまま通る。plan の AC-8（返る lane の `asOf` を検証する）は文字面としては満たされているが、実効としては満たされていない。
  - 提案: (1) 契約 2 に「`asOf` は run 行に固定された値で、lane ごとに持たず、checkpoint の `asOf` 入力でも壁時計でも上書きしない」を 1 文足す（`MaintenanceLane` の型 JSDoc に置いてもよい）。(2) ADP-common-029 の `begin()` 直後に `backend.clock.advance(MINUTE_MS)`（`LEASE_MS` 未満なので lease は生きたまま）を入れ、`asOf` 系 3 件のアサーションが壁時計実装で落ちるようにする。

### Warnings

- **[W-001]** 契約 1 の唯一の実行形が任意フックに依存しており、次のバックエンドは検証せずに緑で通せる
  - 場所: `packages/core/src/adapters/conformance/backend.ts:144` / `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:421-426`
  - 理由: 本 PR の主目的である契約 1（走査順の正本は run のスナップショットであり、配備の設定ではない）を拘束するケースは `setMaintenanceTables` を**任意**メソッドにし、無ければ `ctx.skip()` する。CLAUDE.md / ADR 026 は「すべてのバックエンドが同じスイートを import し、同一に通る」ことを契約の実行形の条件にしており、任意フックはその線を緩める。しかもこの契約が書かれた相手は Issue #11 の D1 実装であり、D1 側が hook を実装しなければ「run の表集合ではなく配備の設定から次表を引く」実装がスイート全緑のまま通る — 本 Issue が消しに来た二重正本のバックエンド側での再生が、まさに検出されない。ADR 061 の「影響」にもこの残存条件は書かれていない（残っているのはスイートの JSDoc だけ）。
  - 提案: `setMaintenanceTables` を `ConformanceBackend` の必須メソッドにする（memory は既に実装済みで、バックエンドは自分の fixture を作る側なので実装コストは小さい）。任意のまま残すなら、ADR 061 の「影響」に「契約 1 の適合検証は hook を実装したバックエンドでしか走らない」を残存条件として明記する。

- **[W-002]** 「claimed のまま残った lane がいずれ回収されるか」について、同じ PR 内の記述が正反対になっている
  - 場所: `packages/core/src/application/identity/pruneExpiredAuthState.ts:121` / `packages/core/src/application/identity/deleteAccount/terminalPrune.ts:70` ↔ `packages/core/src/application/identity/pruneExpiredAuthState.ts:265` / `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts:733`
  - 理由: 新設した Runtime wiring note は「such a lane sits until its lease lapses and **the next cron reclaims it**」と書く。一方 `releaseLane` の catch コメントと、本 PR で書き換えたテストコメントは「`PRUNE_LEASE_OWNER` is a process constant, so this process's next cron renews its own lease and the lapsed-lease reclaim **never fires**」と書く。どちらも同じ機構（プロセス定数の owner ＋ `beginOrResumeKind`）を説明していて、結論が逆になっている。実際の分岐は `beginOrResumeKind` の `lapsed = leaseUntil <= now` で、**同一 owner でも lease が失効していれば `reclaimLapsedLanes` が走る**（`packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts:120,134`）。cron が hour bucket 単位（lease 10 分）である以上、次の cron の時点で lease は失効しており wiring note のほうが正しい。ADR-039 の残存条件の記録として読者が参照する箇所なので、片方が偽のまま残ると次の読者の判断を誤らせる。
  - 提案: どちらかに寄せる。`releaseLane` の catch とテストコメントを「cron の間隔が lease より短い場合にだけ回収が起きない」条件付きの表現に直すか、wiring note 側に同じ条件を書く。

- **[W-003]** 継続 turn の「返った lane を次の継続へ引き渡す」は、返り値の型上そもそも実行不能なのに、事実として書かれている
  - 場所: `packages/core/src/application/identity/pruneExpiredAuthState.ts:119-122` / `packages/core/src/application/identity/deleteAccount/terminalPrune.ts:68-71`
  - 理由: 契約 4 は「単発の継続 turn は返った lane を claimed のまま次の turn へ引き渡す」とし、両 usecase の wiring note も同じ言い方をする。しかし `runContinuation` は `advanced.next` を `!== null` のブール判定にしか使わず、`PruneExpiredAuthStateView` / `AccountDeletionTerminalPruneView` は `continued: boolean` しか持たない — **position（`generation` / `shardId` / `table` / `cursor` / `commandKey`）は返り値から完全に落ちる**。Queue 配線を書く実装者が wiring note を読むと「ack の戻りを次の継続要求に載せればよい」と読めるが、載せる値が usecase の出力に無いので、実際には `advanceOrAck` の戻りを usecase の外へ出す変更が必要になる。挙動としては scope 外（producer が無い）で問題ないが、記述が「今そうなっている」形なのは実態と食い違う。
  - 提案: wiring note を「返った lane は現状 view に載らないので引き渡す手段が無く、lease 失効まで claimed のまま残る（引き渡しは Queue 配線のスライスで position を出力へ載せる時に成立する）」と、未成立であることが分かる形に直す。契約 4 の「単発の継続 turn は……引き渡す」も同様に、義務ではなく将来の想定であることを明示する。

### 確認したこと（指摘なし）

- `advanceOrAck` の応答形状・契約 1〜4 と memory 実装・適合スイート・`runCron` の呼び出しは、`asOf`（B-001）を除いて一貫している。契約 2 の「解放と『pending lane が無い ack』は必ず `next: null`」「`next === null` は run 完了を意味しない」は実装（`globalMaintenanceRunStore.ts:250-303`）と新規適合ケース 2 件に対で入っている。契約 3(a)/(b) の分割も、`beginOrResumeKind` の head position（`virgin.commandKey === commandKeyOf(...)`）と自動 claim の `"command-off-rule"` そのまま返し、の両方で拘束されている。
- lane 駆動ループに漏れ・停滞・無限ループの経路は見つからなかった。未知表 skip は `commands += 1` を伴うので `MAX_COMMANDS_PER_INVOCATION` で有界、`inFlight` は ack 前に設定され ack 後に null 化されるので throw 経路でも `finally` の一括解放が拾う、`advanced.next` は必ず `laneQueue` に入るので budget break でも解放される、claimed lane 数は「ack で 1 本 done ＋ 1 本 claim」の差し引きゼロなので `MAX_ACTIVE_LANES` を超えない。`laneQueue` に同じ lane が二重に入る経路も無い（自動 claim の対象は pending lane のみ）。
- 未知表 skip が `failures` にも `successes` にも入らないことは、TC-identity-349 の「全表未知の run」ケースで実効的に拘束されている（数えていれば `SystemError(DatabaseError)` で reject する）。ログ payload の `runId` / `generation` / `shardId` / `table` も `toMatchObject` で拘束されている。
- `terminalPrune` は挙動不変。`advanced.next` を `{ generation, shardId }` としてしか使わず、単一表 kind での「自動 claim を即解放」は維持されている（失敗ログの meta が `...lane` の spread で `table` / `cursor` / `commandKey` まで含むようになるが、`claimed` 由来の呼び出しは元から full lane を spread しており、PII も含まない）。
- at-least-once / 冪等性 / `commandKey` 重複排除: checkpoint 側の `nextCommandKey` の mint 規則は呼び出し側に残り（ADR-004 のとおり）、store が既存 position を返すときに再 mint しないことが `"command-off-rule"` で拘束されている。cron 経路は継続要求を発行しないので、この PR が Queue の重複排除を壊す経路は無い。
- AC-2 の `grep -rn "SWEEP_ORDER" packages apps` は 0 件。表順の配列はアダプターの `DEFAULT_MAINTENANCE_TABLES` にしか残っていない。
- 該当テストは実行して全緑（`pruneExpiredAuthState.test.ts` ＋ memory 適合 293 件）。skip されたケースも無い（memory は hook を実装済み）。
- 指摘への弁明・修正経緯のようなコメントは残っていない。テストコメントの「`releaseLane` の `workRemains = true` がここでは観測できない理由」は plan が引き継ぎを明示した why コメントで、残すのが正しい。

### カバレッジ

- 確認: `.thread/16/plan.md`, `.thread/16/review/triage-keys.md`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/platform/index.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`
- スキップ: `.thread/16/adr.md` — 判断の正本は `spec/adr/061` / `062` に出ており、`.thread` 側は作業記録なので契約観点の対象外
- スキップ: `.thread/16/review/review-001.md` — 前ラウンドのレビュー記録。ゼロベース判定のため参照しない
- スキップ: `.thread/16/review/review-001-adapter.md` — 同上
- スキップ: `.thread/16/review/review-001-spec.md` — 同上
- スキップ: `.thread/16/review/review-001-usecase.md` — 同上
- スキップ: `.thread/16/review/triage.md` — 既出判定は `triage-keys.md` の薄いビューで足りるため
- スキップ: `.thread/16/steps.md` — 実装手順の作業記録で、契約・振る舞いの正本ではない
- スキップ: `.thread/16/testing.md` — 手動動作検証の手順書で、Use Case / ポート契約の観点外
