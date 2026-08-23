# Port Contract & Application

観点: ポート契約の自足性 / 保存表現の漏れ / 型による違法状態の排除 / 呼び出し側の追随 / runner の budget × リース / 2 プレーン分離 / テストの実効性。

総評: 契約の書き直し（選択規則・遷移表・リース・入力境界）は #11 が実装を読まずに書ける粒度に到達しており、`ScopeTask` / `ScheduledTaskRow` の型設計（`leaseExpiresAt` を optional にせず `running` にだけ持たせる判別共用体）は CLAUDE.md の原則を値のレベルまで届かせている。priority の付与 6 か所も分類どおり。budget 会計とリースの相互作用も破れていない（下記「検証したが問題なし」）。残る指摘は**契約に書いた振る舞いのうち適合スイートが拘束していないもの**に集中する。

## Blockers

- **[B-001]** `running` 行に対する `backoffOrSchedule` の遷移が適合スイートで一切拘束されていない。本番経路がここを通るのに、契約はポート JSDoc の表にしか存在しない
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:326`（`keeps the priority of an existing row when backoffOrSchedule stalls it` — この行は claim されておらず `pending` のまま）、契約は `packages/core/src/application/ports/scopeTaskScheduler.ts:91`
  - 理由: ポート JSDoc の遷移表は `backoffOrSchedule` の from に **`running` を明記**し、「then backs off as above」＝ `lease released` を含意している。そして `packages/core/src/application/storage/deleteFilesByOwner.ts:94-101` の stall 分岐は、**runner が claim した（＝ `running` の）自分の行に対して** `backoffOrSchedule` を撃つ唯一の本番経路である。ところがスイートが `running` 行に対して撃つのは `schedule`（:290）・`complete` / `backoff`（:308）の 3 つだけで、`backoffOrSchedule` は claim を挟まないケースしかない。結果、`UPDATE ... SET attempts, due_at WHERE ...` だけを書いて `status`/`lease_expires_at` を戻さない D1 実装がスイートを緑で通過し、**stall のたびに行がリース満了（既定 5 分）まで不可視**になる。これは #19 が潰そうとしている「1 tick で拾い直せるはずの行が 5 分ロックされる」症状そのもので、ADR 026 §1（「適合スイートだけが規定している振る舞いを残さない」の裏返しで、ここは*どこも*実行形で規定していない）に反する。plan.md「テスト方針」も `running 行に対する schedule / backoff / backoffOrSchedule / complete の遷移（AC-9）` を明示的に列挙しており、AC-9 / AC-12 が 1 ケース分未達である
  - 提案: `keeps the priority of an existing row when backoffOrSchedule stalls it` の前に `await claim(10)` を挟むか、独立ケースを 1 本足す。`schedule` → `claim` → `backoffOrSchedule` → `clock.advance(SCOPE_TASK_BACKOFF_BASE_MS)` → `claim` で `attempt: 1` の行が返ること（＝ リースが解除され、かつ backoff の delay 分だけ待たされること）を assert すれば、観測可能な結果だけで両方を拘束できる

## Warnings

- **[W-001]** リース失効の境界（`leaseExpiresAt <= now` か `< now` か）がポート JSDoc から読めず、適合スイートだけが決めている
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:61-67`（"until the deadline passes" / "`running` with a lapsed lease"）、拘束しているのは `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:236-247, 249-262`（`advance(SCOPE_TASK_LEASE_MS - 1)` は不可視 / `advance(SCOPE_TASK_LEASE_MS)` は再 claim 可）
  - 理由: 同じ文の中で pending 側は `dueAt <= now` と**閉区間を明示**しているのに、running 側は「lapsed」としか書かれていない。`lease_expires_at < now` で書いた実装はスイートで初めて落ちる＝ ADR 026 §1 が名指しした「スイートだけが規定している振る舞い」に当たる。同 repo の先例 `application/ports/outboxRepository.ts:76` は `claimed_at <= now - leaseMs` と境界まで書いており、こちらだけ緩い
  - 提案: 候補述語の文を `` `running` whose `leaseExpiresAt <= now` `` へ揃える（保存表現ではなく観測可能な境界なので ADR 026 §3 には触れない）

- **[W-002]** reclaim の適合ケースが `attempt` / `priority` を「既定値と同じ値」に対して assert しているため、保存ではなくリセットしていても緑になる
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:249-272`
  - 理由: このケースの主張は AC-8 の「リース失効による再 claim は attempt を消費しない / priority を変えない」だが、対象行は `schedule` 直後の新品なので `attempt` は元から `0`、`priority` は `schedule` ヘルパ既定の `securityCleanup` である。再 claim 時に `attempt = 0` / `priority = securityCleanup` へ**書き戻す**実装でも `expect(reclaimed[0]?.attempt).toBe(0)` と `toBe(first?.priority)` は通る。`dueAt` と返却位置の assert には値が動く余地があるので teeth があるが、attempt / priority の 2 行は現状ほぼ無検証
  - 提案: reclaim 前に 1 度 `backoff` を通して `attempt = 1` の状態を作る（＋ `expiryCollection` など既定と異なる priority で仕込む）。ADR-004 の「失効 reclaim は attempt を焼かない」が実際に拘束される

- **[W-003]** `spec/platform` の Alarm 節が、同じ文の中で `lease_expires_at` から起床時刻を導きながら、直前の行タプルにその列を含めていない
  - 場所: `spec/platform/index.md:177`（`scheduled_tasks(due_at, priority, kind, payload, attempts)` を持つ → …running の最小 `lease_expires_at` のうち小さい方を `setAlarm()` する）
  - 理由: AC-14(b) は「spec 内で Alarm の記述が矛盾しない」ことを基準にしている。同一文が「この表はこの 5 列を持つ」と述べた直後に 6 列目から起床時刻を導いており、`spec/platform` だけを入口にした #11 の実装者に一拍の齟齬を残す（`spec/database` を読めば解消するが、ADR-008 が platform 側も直した動機は「片方だけ読む経路が現実にある」ことだった）
  - 提案: タプルに `lease_expires_at`（または `status`, `lease_expires_at`）を足すか、タプル列挙を「`scheduled_tasks`（列は [database](../database/index.md#scheduled_tasks)）」へ落とす

## 検証したが問題なし（判断の記録）

- **budget 会計 × リース**: `application/workers/scopeTaskRunner.ts:163-167` は `claimDue({ limit: budget })` の直後に同じ `budget` を 1 件ずつ減らして回すので `claimed.length <= budget` が算術的に保たれ、`if (budget <= 0) break` は claim 済み行を取り残さない。リース導入で代償が跳ね上がる不変条件に WHY コメント（:158-160）が付いており、CLAUDE.md の「Default to no comments」に照らしても WHY のみで経緯・弁明は混ざっていない
- **未登録 kind**: claim → リース保持 → `continue`（settle しない）で、`scopeTaskHandlers` の JSDoc（:81-91）が「ログ頻度は停滞の尺度ではなく、`dueAt` から測る最古 task age が尺度」へ正しく書き換わっている。ADR-004 の帰結と一致
- **指数バックオフ**: `backedOff`（`adapters/memory/repositories/scopeTaskScheduler.ts:129-149`）は `attempt` 起点のままでリース導入の影響を受けない。`running` → `pending` / `failed` の両分岐とも明示構築で、`leaseExpiresAt` / `dueAt` の残留が値レベルで消えている
- **2 プレーン分離**: `claimDue` の書き戻しは `scopeUnitOfWorkProvider.run(row.scope, …)` の内側だけ（`scopeTaskRunner.ts:161-164`）。`MemTable.set` が undo ログを積むのでロールバックも効く。`listDue` は無書き込みのまま（`adapters/memory/scopeTaskQueue.ts`）で、global 平面への越境なし。commit kick は `schedule` ラップだけが立てる設計が保たれており、`adapters/memory/__tests__/unitOfWork.test.ts:96-105` が「claimDue だけの UoW は kick しない」を新署名で守り続けている
- **型による違法状態の排除**: `ScopeTask.leaseExpiresAt` は optional ではなく必須（`claimDue` は claim 済み行しか返さないので常に存在する）、`toScopeTask` は `Extract<ScheduledTaskRow, { state: "running" }>` しか受けない、`ScheduledTaskRow` は `failed` から `dueAt` を、`pending` から `leaseExpiresAt` を落としている。`ScopeTaskPriority` は const object + union で 4 値に閉じ、既定値なし
- **保存表現の漏れ**: ポート JSDoc は列名（`lease_expires_at` / `status`）を一切出さず、`pending` / `running` / `failed` という論理状態と観測可能な結果だけで書かれている。`spec/database` 側に列と索引が置かれ、ADR 026 §3 の切り分けどおり
- **priority の付与 6 か所**: `deleteQuota.ts:78` / `deleteFilesByOwner.ts:98,113` / `scopeTaskRunner.ts:63` = `securityCleanup`(0)、`personalCleanup.ts:65,107` = `expiryCollection`(3)。plan.md の対応表と一致し、漏れは型が保証している
- **選択規則の実装**: `adapters/memory/scopeTaskSelection.ts` の 2 段選択は、ソート済み配列上で priority が連続することを使って「各 priority の `(dueAt, kind, operationId)` 最小の 1 件」を正しく取る。予約が下限（AC-3/AC-4）・`limit` 未満での厳密 priority 縮退（AC-5）・返却集合の一意性（AC-5 後段）いずれも成立し、`limit <= 0` の境界が `claimDue` / `listDue` で 1 か所に集約されている（AC-10）
- **AC-13 / 影響②**: `workers/__tests__/scopeTaskRunner.test.ts` の `hands a claimed row to one round only, …` が「ハンドラ 1 回 / 2 本目 `processed: 0` / 行が claim 直後から不変 / リース失効後に 2 回目」を実際に assert しており、`toEqual(claimed)` は行オブジェクトが差し替われば deep 比較で落ちるので空振りではない。負けた側が `attempt` を焼かないことは、この「行が不変」で押さえられている
- **AC-17 の配線**: `TuningEnv`(env.ts:16) → `readScopeTaskTuning`(env.ts:55) → `NodeServerEnv`(serverNode.ts:27,84) → `nodeServerEnvToTuningEnv`(serverNode.ts:133) → `server.node.ts:109` → `NodeWorkerRunnerTuning.scopeTaskLeaseMs` → `runDueScopeTasks(container, { leaseMs })` の 1 本道が繋がっており、`z.coerce.number().int().positive()` が `0` / `abc` / `""` を boot で弾く。`.env.example:78-81` に既定値つきの記載あり
- **スコープ逸脱なし**: runner の round 内 budget 配分は未変更、D1/DO 実装なし、`last_error` / 運用イベント通知の持ち込みなし、`spec/` の改訂は lease 列・索引・注記と Alarm 起床規則 2 か所に限られている

## カバレッジ

- 確認: `.thread/19/adr.md`, `.thread/19/plan.md`, `.thread/19/steps.md`, `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `spec/database/index.md`, `spec/platform/index.md`
- スキップ: `.thread/19/testing.md` — 実機の手動確認手順書で、ポート契約・アプリケーション層のコードを規定しない（手順の妥当性は動作確認観点の持ち分）
