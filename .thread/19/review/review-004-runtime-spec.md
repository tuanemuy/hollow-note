# レビュー 004 — Runtime Wiring & Spec 整合性

### Runtime Wiring & Spec 整合性

#### Blockers

なし

#### Warnings

なし

#### 検証したこと（指摘に至らなかったもの）

観点の指示にある確認項目について、実際にコード・spec・実行結果と突き合わせた結果を残す。

**`SCOPE_TASK_LEASE_MS` の 1 本道**

`di/env.ts:16`（`TuningEnv`）→ `di/serverNode.ts:31`（`NodeServerEnv`）/ `:84`（zod schema）/ `:142`（`nonEmpty` 射影）→ `di/env.ts:65 readScopeTaskTuning` → `apps/web/app/server.node.ts:109` → `worker/node/runner.ts:37,137` → `workers/scopeTaskRunner.ts:145` → `claimDue({ leaseMs })` まで途切れなく繋がっている。`createNodeWorkerRunner` / `runDueScopeTasks` を production から呼ぶ経路は `server.node.ts` の 1 か所だけ（grep 済み、他は `__tests__`）なので、配線の抜け道もない。`OUTBOX_LEASE_MS` と同形（`TuningEnv` の 1 フィールド + `read*Tuning` + `nonEmpty` 射影）で、先例から逸脱していない。

**「空文字 = 未設定」テストの実効性**

`readNodeServerEnv` は `z.string().optional()` なので空文字を落とさずに通す。よって `serverNode.test.ts:151` の `expect(tuning).toEqual({})` は射影が実際に空文字を落としたことしか成立させない（1 つでも残れば `{ SCOPE_TASK_LEASE_MS: "" }` になる）。続く `readScopeTaskTuning(tuning).leaseMs === SCOPE_TASK_LEASE_MS` が「落とさなければ boot が落ちる」側を押さえており、`:164` が設定値の転送を押さえている。実効的。

**エラーメッセージの全経路**

`leaseMsField` を repo の zod 4.4.3 でそのまま実行して確認した:

| 入力 | 結果 |
| --- | --- |
| 未設定 | `300000`（既定） |
| `""` | `SCOPE_TASK_LEASE_MS must be a positive integer (ms)` |
| `"abc"` | 同上 |
| `"1.5"` | 同上 |
| `"0"` / `"-1"` | 同上 |
| `"60000"` | `60000` |

`z.coerce.number(error).int(error).positive(error)` の 3 段すべてに同じ文言を渡してあるので、どの経路から落ちても変数名が出る。`ZodDefault` が `undefined` を coerce 前に短絡するため既定値も期待どおり。

**`.env.example` / `docs/runtime_node.md` の根拠が参照ランタイムの実態と合っているか**

書き直された根拠は 2 つの主張に依存している。どちらも成立する。

- 「下限が噛まない = 2 人目の writer がいない」— scope task の tick は interval・commit kick とも `scopeTaskTrigger`（`inProcessRelayTrigger.ts:36-49`）を通り、in-flight は常に 1 本、重なった kick は 1 回の再走に畳まれる。`claimDue` を呼ぶ本番経路は `runDueScopeTasks` だけ。よってリースを短く取っても同一 round 内で二重 claim は起きない。
- 「上限が噛まない = クラッシュした writer の行が残らない」— store はプロセス内（`memoryRuntime`）で、`docs/runtime_node.md` の *Persistence model* どおりプロセスと運命を共にする。

さらに「the turn did not settle した行だけが影響を受ける」が実際に成り立つかを、runner から到達する全ハンドラ経路で確認した。`deleteFilesByOwner` / `deleteQuota` の `alreadyApplied` 早期 return は `commandKey` を渡す経路（event 駆動の初回 command）だけで発生し、runner のハンドラは `commandKey` を渡さない。`prunePersonalCleanupBarriers` / `handOverPersonalCleanup` は全 return 経路で `schedule` か `complete` を呼ぶ。throw した場合は runner が `backoff` してリースを解放する（memory の `backedOff` は `pending` を明示構築するので `leaseExpiresAt` が残らない）。よって「settle しない行」は ①ハンドラ未登録 ②`backoff` 自体が失敗、の 2 つだけで、docs の記述と一致する。

**`[scope-tasks] no handler for …` の `dueAt`**

`scopeTaskRunner.ts:169-176` が `{ kind, operationId, dueAt: task.dueAt }` を載せている。`claimDue` は `dueAt` を書き換えず（ポート契約 / 適合スイート `reclaims a row whose lease lapsed…` で拘束）、reclaim でも保たれるので、docs の「how far past its time that row has drifted reads off the line」は成立する。ログの反復周期がリース期間になる点も、reclaim → 再ログの経路どおり。

**`spec/database#scheduled_tasks` とポート契約**

`lease_expires_at`（`status='running'` のとき NOT NULL）、候補述語の 2 分岐、再 claim が `due_at` / `attempts` / `priority` / `payload` を保つこと、`due_at` が状態によらず実行予定時刻であること — いずれもポート JSDoc の遷移表と一致している。`status` の 3 値は既存記述のままで、今回ようやく実装が `running` を持った形。

**dequeue 索引 `WHERE status <> 'failed'` が claim の 2 分岐を賄えるか**

賄える。

- 候補の両分岐（`pending` かつ due / `running` かつリース失効）はどちらも `status <> 'failed'` に含まれるので、部分索引から漏れる候補は無い。旧述語（`pending` 限定）のままでは失効 `running` 行が索引に載らず 2 分岐目を賄えなかったので、この改訂は必要な修正になっている。
- 枠取りの `priority` ごと `LIMIT 1` は `priority` 等値 + `due_at` 範囲で索引前置が効く。`running` 行は claim 時点で `due_at <= now` であり、claim も reclaim も `due_at` を書き換えないため、候補は例外なく `due_at <= now` の範囲に収まる。つまり「`due_at > now` で走査を打ち切る」が候補を取りこぼさない。
- 残る `lease_expires_at` の判定だけは索引外の行参照になるが、spec は「走査はリース有効な `running` 行を読み飛ばす」と明記していて、隠していない。
- 3 本とも部分索引で `failed` を除外している点も、各述語（`status='pending'` / `<> 'failed'` / `='running'`）から実際に成立する。
- 起床時刻の 2 候補（Alarm 時刻用の先頭 = pending の最小 `due_at`、リース失効走査用の先頭 = running の最小 `lease_expires_at`）が `spec/platform` の起床規則と 1 対 1 で対応している。

**Alarm 起床時刻の導出規則の一貫性**

`spec/platform/index.md:177`（`setAlarm()` 文）と `:184`（handler 規則 4）が両方とも「pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方」に揃っている。`spec/database:972` は導出の正本を platform へ委譲し、`:976` が材料（2 索引の先頭行）を与える。委譲先が実際に規則を述べているので鎖は閉じており、循環も宙吊りも無い。`spec/` 全体を `scheduled_tasks` / `alarm` / `lease_expires_at` / `setAlarm` で grep した結果、起床時刻を述べる第 3 の箇所は `spec/adr/021-scope-sharded-data-plane.md:88` のみで、そこは列名を挙げず「最も早い時刻に 1 つの alarm を設定する」と書いているためリース込みの導出と矛盾しない（改訂不要の結論も残っている）。他の `scheduled_tasks` 言及（`spec/usecases/{job,note,storage,workspace,identity}.md`、`spec/domains/index.md:272,315,322`、`spec/inventory/test.md`、`spec/testcases/**`）は継続要求の積み方の話で、priority / lease / status に触れておらず取り残しは無い。

**`spec/platform` の分節で規則が落ちていないか**

改訂前の 1 段落にあった 3 文（「1 turn は合計 100 行または CPU 2 秒で yield」「priority 0 = 1 分 / outbox = 5 分 / projection = 15 分の SLO」「低 priority が継続補充されても飢餓させない」）は、分節後の `:186` / `:188` / `:192` にすべて残っている。落ちた規則は無い。追加された「budget を超えて claim しない」は `scopeTaskRunner.ts:158-163`（`limit: budget` と、claim 直後に全件を訪問するループ）と一致し、リース帯 `:190` はポート JSDoc の `leaseMs` 節・`SCOPE_TASK_LEASE_MS` 定数の JSDoc・`docs/runtime_node.md` の表と同じ 2 つの境界を述べている。

**その他**

- `spec/index.md` は platform / database を正本として指すだけで、列や規則を再掲していないため更新不要。
- AC-14 / AC-15 / AC-17 は上記のとおり満たされている。スコープ外の変更（`last_error`、運用イベント通知、round 内 budget 配分）が紛れ込んでいないことも差分で確認した。
- `npx vitest run packages/core/src/application/di packages/core/src/application/workers apps/web/app/worker` = 6 files / 41 tests green。

#### カバレッジ

- 確認: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `spec/database/index.md`, `spec/platform/index.md`
- 確認（差分外・突き合わせのため）: `spec/adr/021-scope-sharded-data-plane.md`, `spec/index.md`, `spec/domains/index.md`, `spec/usecases/{job,note,storage,workspace,identity}.md` の `scheduled_tasks` 言及, `packages/core/src/adapters/node/inProcessRelayTrigger.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`
- スキップ: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts` — 差分は読んで spec / ポート契約との整合だけ確認したが、選択アルゴリズムと行表現の妥当性はアダプター観点の担当
- スキップ: `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `.../deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/{storage/deleteFilesByOwner,usage/deleteQuota,cleanup/personalCleanup}.ts` の `priority` 付与 — 既存テストの状態絞り込みと priority の分類妥当性はポート / ユースケース観点の担当
- スキップ: `.thread/19/**` — Phase 7 で削除される足場
