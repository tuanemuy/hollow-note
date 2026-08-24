# api 項目の観測結果 — Issue #19

**実行日:** 2026-08-24
**ブランチ:** issue/19/scope-task-priority-lease

## 項目 4: 正でない SCOPE_TASK_LEASE_MS は boot を拒否する

### 手順 1（.env 設定）

```
APP_URL=http://localhost:3000
GOOGLE_OAUTH_CLIENT_ID=dummy
GOOGLE_OAUTH_CLIENT_SECRET=dummy
OUTBOX_LEASE_MS=300000
SCOPE_TASK_LEASE_MS=0
```

### 手順 2（pnpm build）

- 終了コード: `0`
- 観測した出力（末尾）:
  ```
  dist/server/server.node.js                                 352.31 kB │ gzip:  82.42 kB
  dist/server/assets/server-Bj4Wo-ix.js                      548.96 kB │ gzip: 111.51 kB

  ✓ built in 384ms
  ```

### 手順 3（SCOPE_TASK_LEASE_MS=0 のまま pnpm start）

- 終了コード: `1`
- `[listen.node] listening on` の有無: 出なかった
- 観測した出力（全文）:
  ```
  $ pnpm --filter @repo/web start
  $ pnpm start:node
  $ tsx scripts/listen.node.ts
  [listen.node] failed to start ZodError: [
    {
      "origin": "number",
      "code": "too_small",
      "minimum": 0,
      "inclusive": false,
      "path": [
        "leaseMs"
      ],
      "message": "SCOPE_TASK_LEASE_MS must be a positive integer (ms)"
    }
  ]
      at readScopeTaskTuning (/Users/hikaru/github.com/tuanemuy/hollow/apps/web/dist/server/server.node.js:5116:31)
      at boot (/Users/hikaru/github.com/tuanemuy/hollow/apps/web/dist/server/server.node.js:9995:22)
      at main (/Users/hikaru/github.com/tuanemuy/hollow/apps/web/scripts/listen.node.ts:201:24)
  [ELIFECYCLE] Command failed with exit code 1.
  /Users/hikaru/github.com/tuanemuy/hollow/apps/web:
  [ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @repo/web@0.0.0 start: `pnpm start:node`
  Exit status 1
  [ELIFECYCLE] Command failed with exit code 1.
  ```

### 手順 4（SCOPE_TASK_LEASE_MS=abc に変更して pnpm start 再実行）

- 終了コード: `1`
- `[listen.node] listening on` の有無: 出なかった
- 観測した出力（全文）:
  ```
  $ pnpm --filter @repo/web start
  $ pnpm start:node
  $ tsx scripts/listen.node.ts
  [listen.node] failed to start ZodError: [
    {
      "expected": "number",
      "code": "invalid_type",
      "received": "NaN",
      "path": [
        "leaseMs"
      ],
      "message": "SCOPE_TASK_LEASE_MS must be a positive integer (ms)"
    }
  ]
      at readScopeTaskTuning (/Users/hikaru/github.com/tuanemuy/hollow/apps/web/dist/server/server.node.js:5116:31)
      at boot (/Users/hikaru/github.com/tuanemuy/hollow/apps/web/dist/server/server.node.js:9995:22)
      at main (/Users/hikaru/github.com/tuanemuy/hollow/apps/web/scripts/listen.node.ts:201:24)
  [ELIFECYCLE] Command failed with exit code 1.
  /Users/hikaru/github.com/tuanemuy/hollow/apps/web:
  [ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @repo/web@0.0.0 start: `pnpm start:node`
  Exit status 1
  [ELIFECYCLE] Command failed with exit code 1.
  ```

### 手順 5（SCOPE_TASK_LEASE_MS の行を削除して pnpm start 再実行し、起動確認後に停止）

- `.env` はこの時点で以下（`SCOPE_TASK_LEASE_MS` 行を削除、`OUTBOX_LEASE_MS=300000` は残置）:
  ```
  APP_URL=http://localhost:3000
  GOOGLE_OAUTH_CLIENT_ID=dummy
  GOOGLE_OAUTH_CLIENT_SECRET=dummy
  OUTBOX_LEASE_MS=300000
  ```
- `[listen.node] listening on` の有無: 出た（起動を確認後、`pkill -f listen.node` / `pkill -f start:node` で停止した）
- 観測した出力（起動〜停止までに得られた分）:
  ```
  $ pnpm --filter @repo/web start
  $ pnpm start:node
  $ tsx scripts/listen.node.ts
  [server.node] worker runner started
  [outbox] pruned 0 processed event(s) {
    deleted: 0,
    retentionMs: 604800000,
    cutoff: '2026-08-16T18:12:19.919Z'
  }
  [listen.node] listening on http://0.0.0.0:3000
  ```
- 停止後の残存プロセス確認: `ps aux | grep -E "listen.node|start:node|tsx scripts"` で該当プロセスなし、`lsof -i :3000` も出力なし

## 項目 5: 静的検査が緑

### 手順 1（pnpm typecheck）

- 終了コード: `0`
- 観測した出力（全文）:
  ```
  $ tsgo && pnpm -r typecheck
  Scope: 2 of 3 workspace projects
  packages/core typecheck$ tsgo
  packages/core typecheck: Done
  apps/web typecheck$ tsgo
  apps/web typecheck: Done
  ```

### 手順 2（pnpm lint:fix）

- 終了コード: `0`
- 観測した出力（末尾。Biome の設定バージョン差異に関する info 2件のみ、fix 対象なし）:
  ```
  biome.json:25:13 deserialize  DEPRECATED  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    i The use of the recommended field has been deprecated, and will removed in the next major version of Biome. Use preset instead.

      23 │   },
      24 │   "assist": { "actions": { "source": { "organizeImports": "on" } } },
    > 25 │   "linter": {
         │             ^
    > 26 │     "enabled": true,
          ...
    > 52 │     }
    > 53 │   },
         │   ^
      54 │   "javascript": {
      55 │     "formatter": {

    i Migrate the configuration with the proper command

    $ biome migrate


  Checked 446 files in 354ms. No fixes applied.
  Found 2 infos.
  ```

### 手順 3（pnpm format）

- 終了コード: `0`
- 観測した出力（全文）:
  ```
  $ biome format --write
  Formatted 446 files in 84ms. No fixes applied.
  ```

### lint:fix / format 実行後の git status --short

```
(出力なし。差分ゼロ)
```

## 項目 6: 適合スイートと application 層のテストが緑

### 手順 1（pnpm test）

- 終了コード: `0`
- 観測した出力（サマリー全文）:
  ```
  $ pnpm test:unit
  $ vitest run

   RUN  v4.1.10 /Users/hikaru/github.com/tuanemuy/hollow


   Test Files  76 passed (76)
        Tests  958 passed | 3 skipped (961)
     Start at  03:12:51
     Duration  5.53s (transform 4.22s, setup 0ms, import 12.77s, tests 14.26s, environment 7ms)
  ```
- 落ちたケース: なし

### 補足: 対象テストファイルの含有確認（`npx vitest run --reporter=verbose` で再実行、終了コード `0`、サマリーは上と同一の `76 passed (76)` / `958 passed | 3 skipped (961)`）

以下、期待結果に列挙された各ファイルの該当行を原文のまま抜粋:

```
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > claims only tasks whose dueAt has passed 2ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > claims in dueAt order and respects the limit 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > returns nothing for a limit of zero or less 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > orders by priority before dueAt, and returns in that order 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > reserves a slot for a low priority a backlog of high ones would crowd out 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > puts a high priority ahead of an older low-priority backlog 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > lets one priority take the whole limit when it is the only one due 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > degrades to strict priority order when the limit is below the number of priorities 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > reserves the earliest row of each priority, so the claimed set is determined 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > holds a claimed row for the leaseMs it was given, hiding it from a second claim and from listDue 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > reclaims a row whose lease lapsed, with its dueAt, attempt and priority intact 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > breaks ties within a priority and dueAt on (kind, operationId) 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > upserts on (kind, operationId) so a replayed turn does not multiply tasks 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > re-arms a pending row on schedule, taking the new dueAt, priority and payload 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > re-arms a running row on schedule, releasing its lease and taking the new dueAt, priority and payload 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > completes and backs off a running row by key alone 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > keeps the priority and payload of an existing row when backoffOrSchedule stalls it 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > completes a task so it is never claimed again 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > backs off the same row exponentially instead of adding a task 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > backs off a row that does not exist yet by minting it from the input 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > parks a task as failed once the attempt cap is reached, hiding it from both reads 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > keeps a failed task failed through either retry variant 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > revives a failed task on schedule, as a fresh attempt 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > removes a failed task on complete, freeing its key 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > lists due tasks across scopes for the runner, in dueAt order 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > reserves a slot across scopes, so a scope holding only low priority is still listed 1ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > ScopeTaskScheduler conformance [memory] > lists a scope again once the lease on its rows lapses 1ms

 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > resumes a cleanup that outgrew its first turn and hands the completion to the manifest 107ms
 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > re-drives the turn whose hand-over to the manifest was lost, and reaches completion 108ms
 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > carries a deletion to completion across alternating relay and task rounds 63ms
 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > reads the due rows from the table, so a restarted process resumes them 52ms
 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > leaves a task whose kind has no handler under its lease, and has it back once the lease lapses 1ms
 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > hands a claimed row to one round only, and burns neither an attempt nor its dueAt while the lease holds 0ms
 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > isolates a failing task from the rest of the round 0ms
 ✓ packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts > runDueScopeTasks > backs a throwing task off, so a permanently failing one stops being re-driven 1ms

 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-084: every declared component acked completes the barrier, and only then is the receipt recorded 63ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-085: one declared component short leaves the barrier running 61ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-086: the final page stores its ack and leaves no continuation behind 56ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-087: a lost response after the barrier commit only re-records the receipt 62ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-089: a redelivered cleanup command is not applied twice and the turn resumes from its own task 51ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-044: a file write that committed before the barrier is collected by the owner scan 45ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-046: a running barrier has no expiry and survives a prune pass 73ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > drives itself from the relay: accepting is enough to run the deletion out 81ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts > deleteAccount personal cleanup > TC-identity-047: a completed barrier keeps its receipt for 120 days, no-ops duplicates and is then reclaimed 46ms

 ✓ packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts > deleteAccount terminal prune > TC-identity-104: 101 expired headers are reclaimed with their operations, running ones are kept 5ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts > deleteAccount terminal prune > TC-identity-109: the retention deadline is inclusive, one millisecond later is not 1ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts > deleteAccount terminal prune > TC-identity-105: a redelivered continuation resumes from the same asOf and cursor without gaps 1ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts > deleteAccount terminal prune > TC-identity-107: a lane that stopped before its checkpoint re-runs the same cursor and then checkpoints the next one 3ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts > deleteAccount terminal prune > TC-identity-106: an unfinished run is resumed with its original asOf, at most six lanes at a time 2ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts > personal barrier prune > TC-identity-110: the completed receipt is reclaimed at its deadline while a running barrier is left alone 1ms
 ✓ packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts > personal barrier prune > TC-identity-111: the prune task outlives a lost response, so the receipt is still reclaimed 1ms

 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-037: 120 files with batchSize 50 delete a page and arm exactly one continuation 9ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-037: losing the commit after the continuation is armed takes the deleted page back with it 4ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-038: exactly batchSize targets are all deleted without a continuation 6ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > a batchSize above the ceiling is clamped, so one turn never emits more than 100 events 3ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-039: the continuation is a single scope task carrying the deletion operation 1ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-040: a continuation turn reads the remaining files from the start, carrying no cursor 1ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-041: a batch that deletes nothing while targets remain backs off instead of continuing 1ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-042: two continuation chains on the same owner converge 1ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-041: a stall on the initial command leaves a backed-off task behind to drive the retry 4ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-043: one turn enumerates once and emits one event per file, whatever the count 5ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-045: a workspace subject loses only that workspace's files 2ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-046: an owner with no files settles with deletedCount 0 1ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-047: a single failing deletion is skipped and the rest of the batch continues 2ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-048: running the same request twice leaves the same result 2ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-049: icons and artifacts go too, whatever their purpose 1ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > TC-storage-050: every deleted file emits its own storage.fileDeleted carrying the object key 1ms
 ✓ packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner > suppresses a redelivered initial command through the applied-operation record 0ms

 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-026: a user subject loses its quota row and its LLM records 10ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-027: a workspace subject loses its quota row only, LLM records being the user's 1ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-028: a subject that is already gone still settles 2ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-029: receiving the same command twice changes nothing 1ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-030: every recorded month is removed 1ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-032: 250 months are removed in pages of 100, acknowledging only after the short page 3ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-032: losing the commit after the continuation is armed takes the deleted page back with it 6ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > TC-usage-033: a lost response after a page resumes from what is left 1ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > suppresses a redelivered initial command through the applied-operation record 2ms
 ✓ packages/core/src/application/usage/__tests__/deleteQuota.test.ts > deleteQuota > refuses a command whose operation does not own the scope 0ms

 ✓ packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts > memory global unit of work serialization (spec/adr/024) > runs concurrent unit of works one after another instead of interleaving 3ms
 ✓ packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts > memory scope unit of work commit kick (spec/adr/023) > kicks the scope-task runner once when a commit stored a continuation 1ms
 ✓ packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts > memory scope unit of work commit kick (spec/adr/023) > leaves the runner alone when the unit of work only claimed a task 1ms
 ✓ packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts > memory scope unit of work commit kick (spec/adr/023) > rolls a claim back to pending when the unit of work throws 1ms
 ✓ packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts > memory scope unit of work commit kick (spec/adr/023) > leaves the runner alone when the unit of work rolled back 0ms
```

```
 Test Files  76 passed (76)
      Tests  958 passed | 3 skipped (961)
   Start at  03:13:31
   Duration  6.03s (transform 4.43s, setup 0ms, import 14.08s, tests 15.19s, environment 6ms)
```

## 後片付け

- `apps/web/.env` の復元: バックアップから復元済み。復元後の内容:
  ```
  APP_URL=http://localhost:3100
  OAUTH_DEV_MODE=true
  MEMORY_MAIL_LOG_ACTION_URL=true
  ```
  （`diff` でバックアップファイルと完全一致を確認）
- 残存プロセス: なし（`ps aux | grep -E "listen.node|start:node|server.node"` に該当なし、`lsof -i :3000` も出力なし）
