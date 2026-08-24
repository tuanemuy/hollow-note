# api 検証の観測結果 — Issue #16

**実行日:** 2026-08-25
**ブランチ:** issue/16/sweep-table-order-single-source
**コミット:** 3c40f50

## 項目 1: `SWEEP_ORDER_HINT` がリポジトリから消え、型が通る

**手順:**
- `grep -rn "SWEEP_ORDER" packages apps; echo "exit=$?"`
- `pnpm typecheck`
- `grep -rn "AuthStateTable\[\]" packages/core/src/application/identity/pruneExpiredAuthState.ts; echo "exit=$?"`

**期待結果:**
- 手順1の出力が 0 行、終了コード 1
- 手順2 が成功で終了
- 手順3: 表順を持つ配列が usecase に残っていないこと（`isAuthStateTable` の述語は残ってよい）

**観測:**
- 手順1: 出力 0 行。`exit=1`
- 手順2: 出力

```
$ tsgo && pnpm -r typecheck
Scope: 2 of 3 workspace projects
packages/core typecheck$ tsgo
packages/core typecheck: Done
apps/web typecheck$ tsgo
apps/web typecheck: Done
```

  シェル終了コード `exit=0`
- 手順3: 出力 0 行。`exit=1`

## 項目 2: ack が進めた先の position を返し、キーの mint 主体が分岐で正しい

**手順:**
- `pnpm exec vitest run packages/core/src/adapters/memory/__tests__/conformance.test.ts --reporter=verbose`

**期待結果:**
- `Test Files 1 passed` / 失敗 0
- `ADP-common-029: advanceOrAck walks tables, then shards, then completes the run` の ✓ 行が存在する
- `GlobalMaintenanceRunStore conformance [memory]` の ✓ 行が **17 行**（実行前は 11 行）
- 実行前の 11 ケース（特に ADP-common-030 の 3 件）が消えていない

**観測:**
- シェル終了コード `exit=0`
- サマリ行:

```
 Test Files  1 passed (1)
      Tests  238 passed (238)
```

- `GlobalMaintenanceRunStore conformance [memory]` に属する ✓ 行（全17行、テスト名そのまま）:

```
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-026: starts a run, resumes it with the original asOf, reports live foreign leases 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-027: claimLanes hands out pending lanes with their sweep table, command key and the run's asOf 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-027: a lane's commandKey matches the key its position re-derives 6ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-027: only the lease owner may claim 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-028: checkpointLane persists the keyset cursor for the lane's current table 10ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: advanceOrAck walks tables, then shards, then completes the run 1ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: the position an ack returns is still claimed 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: acking a lane's last table auto-claims a lane never claimed before, at the head of its first table 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: acking a lane's last table auto-claims a released lane at the table it reached, not the run's first 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: an ack with no pending lane to hand over returns no position and leaves the run running 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: a release hands back no position even while another lane is pending 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: an ack walks the table set the run was created with, not the deployment's current one, across a resume 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-030: recoverLease reclaims only a lapsed foreign lease 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-030: a lapsed lease returns the previous owner's claimed lanes to the claimable pool 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-030: recoverLease also returns the lapsed owner's claimed lanes 0ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-031: pruneCompleted reclaims runs after the 30-day retention, by keyset 1ms
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-031: pruneCompleted caps a page at 100 runs (spec/domains/index.md 最大100件) 2ms
```

  （`grep -n "GlobalMaintenanceRunStore conformance" /tmp/conformance.out` の該当行数: 17）

## 項目 3: 解放（`completed: false`）は lane を返さない

**手順:**
- 項目2の出力の中の `ADP-common-029: a release hands back no position even while another lane is pending` の ✓ 行
- `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts` の該当ケースを Read

**期待結果:**
- その ✓ 行が存在する
- ケースが `advanceOrAck({ completed: false })` の戻り値について `{ next: null, runCompleted: false }` を主張している（`runCompleted` だけでなく `next` も assert している）
- その主張が、他方の shard が pending のまま残っている状態で行われている

**観測:**
- ✓ 行:

```
✓ ... > GlobalMaintenanceRunStore conformance [memory] > ADP-common-029: a release hands back no position even while another lane is pending 0ms
```

- ケース本体（globalMaintenanceRunStore.ts:494-514）:

```ts
it("ADP-common-029: a release hands back no position even while another lane is pending", async () => {
  await begin("run-1", "owner-a");
  const [lane] = await store.claimLanes("run-1", "owner-a", 1);
  if (lane === undefined) {
    throw new Error("expected a claimed lane");
  }

  // The other shard is pending and the release frees capacity, but a
  // release must still claim nothing: every call site drops this
  // return value, so a lane handed back here would stay claimed with
  // nobody driving it until the lease lapses.
  const released = await store.advanceOrAck({
    runId: "run-1",
    leaseOwner: "owner-a",
    generation: lane.generation,
    shardId: lane.shardId,
    completed: false,
  });
  expect(released).toEqual({ next: null, runCompleted: false });
  expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(2);
});
```

- fixture の shard 構成（同ファイル内 `maintenanceShardIds`）: `["s1", "s2"]`（この describe ブロックで使用される固定 fixture）

## 項目 4: 表構成が違う配備でも 1 回の cron で run が完走する

**手順:**
- `pnpm exec vitest run packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts --reporter=verbose`
- `TC-identity-347` を含む行を grep
- ケース本体を Read

**期待結果:**
- `Test Files 1 passed` / 失敗 0
- `TC-identity-347` を含む ✓ 行が存在する
- ケースが既定順と違う表集合で 1 回の cron を回し、`continued: false` / run が `completed` / 対象セッションが消える / claimed のまま残る lane が 0 件、を主張している
- 実行前に存在した `"a lane whose next table the sweep order cannot name is released, not left claimed"` という名前の ✓ 行が消えている

**観測:**
- シェル終了コード `exit=0`
- サマリ行:

```
 Test Files  1 passed (1)
      Tests  34 passed (34)
```

- `TC-identity-347` の ✓ 行:

```
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > TC-identity-347: a run whose table set differs from this deployment's order still completes in one cron 2ms
```

- ケース本体（pruneExpiredAuthState.test.ts:593-615）:

```ts
it("TC-identity-347: a run whose table set differs from this deployment's order still completes in one cron", async () => {
  // A run snapshotted under a table order this deployment no longer
  // uses — what a table-set change looks like across a deploy
  // boundary. Every position comes from the run itself, so the order
  // difference cannot stall the walk.
  const h = createTestHarness({
    maintenanceTablesByKind: {
      authStatePrune: ["identity_removal_receipts", "sessions"],
    },
  });
  seedSession(h, new Date(h.clock.now().getTime() - 1));

  const view = await cron(h);
  expect(view.sessions).toBe(1);
  expect(view.continued).toBe(false);
  expect(h.backend.sessions.size).toBe(0);
  expect(h.backend.maintenanceRuns.values()[0]?.status).toBe("completed");
  for (const run of h.backend.maintenanceRuns.values()) {
    expect(
      run.lanes.filter((lane) => lane.status === "claimed"),
    ).toHaveLength(0);
  }
});
```

- 使っている表集合: `["identity_removal_receipts", "sessions"]`（cron 呼び出しは `await cron(h)` の 1 回のみ）
- 旧テスト名 `"a lane whose next table the sweep order cannot name is released, not left claimed"` の grep 結果: `grep -n "sweep order cannot name" /tmp/prune.out` → 出力 0 行、`exit=1`

## 項目 5: 同時 claim 上限を超える shard 数でも解放して取り直す往復が消えている

**手順:**
- 項目4と同じ出力の中の `TC-identity-348` を grep
- ケース本体を Read

**期待結果:**
- `TC-identity-348` を含む ✓ 行が存在する
- ケースが 8 shard の配備で 1 回の cron を回し、run が `completed` になり、その間 `advanceOrAck(completed: false)` が 1 度も呼ばれないことを store ラッパーで主張している
- 観測が `advanceOrAck(completed: false)` の呼び出し回数で行われている（`claimLanes` の回数ではない）
- 同じ実行で `TC-identity-171` と `TC-identity-174` が ✓ のまま

**観測:**
- ✓ 行:

```
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > TC-identity-348: more shards than the concurrent-claim cap are drained from the ack's next lane, without a release round-trip 0ms
```

- ケース本体（pruneExpiredAuthState.test.ts:617-647）:

```ts
it("TC-identity-348: more shards than the concurrent-claim cap are drained from the ack's next lane, without a release round-trip", async () => {
  const h = createTestHarness({
    maintenanceShardIds: Array.from({ length: 8 }, (_, i) => `shard-${i}`),
  });
  const realStore = h.workerContainer.maintenanceRunStore;
  let releases = 0;
  const container = {
    ...h.workerContainer,
    maintenanceRunStore: {
      ...realStore,
      async advanceOrAck(
        input: Parameters<typeof realStore.advanceOrAck>[0],
      ) {
        if (!input.completed) {
          releases += 1;
        }
        return realStore.advanceOrAck(input);
      },
    },
  };

  const view = await pruneExpiredAuthState({
    container,
    input: { type: "cron" },
  });
  expect(view.continued).toBe(false);
  expect(h.backend.maintenanceRuns.values()[0]?.status).toBe("completed");
  // The shards past the cap arrive through the ack itself, so nothing
  // is ever handed back to be claimed again.
  expect(releases).toBe(0);
});
```

- shard 数: 8（`Array.from({ length: 8 }, (_, i) => \`shard-${i}\`)`）
- 数えている対象（コードそのまま）: `if (!input.completed) { releases += 1; }`（`advanceOrAck` 呼び出しをラップし `completed: false` の呼び出し回数を数える。`claimLanes` の回数は数えていない）
- `TC-identity-171` / `TC-identity-174` の ✓ 行:

```
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > TC-identity-171: resharded generations are processed with at most 6 active lanes and no cursor mixing 3ms
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > TC-identity-174: after a lapsed lease the next cron reclaims the abandoned lane at its position and completes the run 4ms
```

## 項目 6: 品質ゲート（全体）

**手順:**
- `pnpm typecheck`
- `pnpm lint:fix`
- `pnpm format`
- `git status --short`
- `pnpm test:unit`

**期待結果:**
- 4 つのコマンドすべてが成功で終了
- `pnpm test:unit` が Test Files 76 passed / Tests 978 passed, 3 skipped（実行前は 970 passed / 3 skipped）
- `pnpm lint:fix` / `pnpm format` が差分を書き戻していない（`git status --short` が空）
- `pnpm lint` の infos が 2 件から増えていない

**観測:**
- `pnpm typecheck`: `exit=0`

```
$ tsgo && pnpm -r typecheck
Scope: 2 of 3 workspace projects
packages/core typecheck$ tsgo
packages/core typecheck: Done
apps/web typecheck$ tsgo
apps/web typecheck: Done
```

- `pnpm lint:fix`: `exit=0`。末尾出力:

```
Checked 446 files in 699ms. No fixes applied.
Found 2 infos.
```

  （infos の内容は biome.json のスキーマバージョン不一致と `recommended` フィールド非推奨の2件、コード側の指摘ではない）

- `pnpm format`: `exit=0`

```
$ biome format --write
Formatted 446 files in 123ms. No fixes applied.
```

- `git status --short`: 出力なし（空）

- `pnpm test:unit`: `exit=0`

```
 RUN  v4.1.10 /Users/hikaru/github.com/tuanemuy/hollow

 Test Files  76 passed (76)
      Tests  978 passed | 3 skipped (981)
   Start at  04:54:42
   Duration  8.19s (transform 9.16s, setup 0ms, import 23.62s, tests 18.64s, environment 6ms)
```

## エッジケース 1: 飛ばした未知表が run の最終表だったとき（`next === null`）

**手順:**
- 項目4と同じ出力の中の `TC-identity-349` を grep
- ケース本体を Read

**期待結果:**
- `TC-identity-349` を含む ✓ 行が存在する
- ケースが、この配備が sweep を持たない表を含む表集合の running run 行を `h.backend.maintenanceRuns` に直接置き（lease 失効させて resume させる）、cron を 1 回回して、`SystemError` が投げられず run が `completed` になり、期限切れセッションが消えることを主張している
- error ログに `[pruneExpiredAuthState] unknown sweep table` 相当の記録が残り、payload に `runId` / `generation` / `shardId` / `table` が載っている
- 続けて、表集合が全部未知の run 行（`tables: ["job_tombstones"]`、lane 1 本）でも cron が throw せず `continued: false` を返し run が `completed` になることを主張している
- 出力に `[pruneExpiredAuthState] lane release failed` / `MAINTENANCE_LANE_NOT_CLAIMED` が現れない
- 置く run 行の `asOf` が、撒く期限切れ行の期限以降になっている
- fixture が `maintenanceTablesByKind` で未知表を混ぜる形になっていない

**観測:**
- ✓ 行:

```
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > TC-identity-349: a table this deployment cannot sweep is skipped so the run still completes 0ms
```

- ケース本体（pruneExpiredAuthState.test.ts:649-727）:

```ts
it("TC-identity-349: a table this deployment cannot sweep is skipped so the run still completes", async () => {
  const h = createTestHarness();
  const now = h.clock.now();
  seedSession(h, new Date(now.getTime() - 1));
  // A run created before this deployment dropped the sweep for one of
  // its tables, its lease already lapsed so this cron resumes it. The
  // stored `asOf` is what the resumed sweep uses as its boundary, so
  // it has to sit at or after the rows seeded above.
  h.backend.maintenanceRuns.set("stale-run", {
    runId: "stale-run",
    kind: "authStatePrune",
    status: "running",
    asOf: now,
    leaseOwner: "gone",
    leaseUntil: new Date(now.getTime() - 1),
    tables: ["job_tombstones", "sessions"],
    lanes: [
      {
        generation: "gen-1",
        shardId: "shard-0",
        status: "pending",
        tableIndex: 0,
        cursor: null,
        commandKey: "stale-run:gen-1:shard-0:job_tombstones:",
      },
    ],
    expiresAt: null,
  });

  const view = await cron(h);
  expect(view.sessions).toBe(1);
  expect(h.backend.sessions.size).toBe(0);
  expect(h.backend.maintenanceRuns.get("stale-run")?.status).toBe(
    "completed",
  );
  // The skip left nothing behind: the single cron drove the resumed run
  // to the end rather than deferring the table it could not sweep.
  expect(view.continued).toBe(false);
  const skipped = h.logger
    .byLevel("error")
    .find((entry) => entry.message.includes("unknown sweep table"));
  expect(skipped?.meta).toMatchObject({
    table: "job_tombstones",
    runId: "stale-run",
    generation: "gen-1",
    shardId: "shard-0",
  });

  // Skipping is not a delete failure. The run above still swept
  // `sessions`, so only a run whose tables are *all* unknown can
  // observe that: with no successful delete to offset a counted skip,
  // the invocation would throw `SystemError(DatabaseError)` and an
  // older table set would be indistinguishable from a database outage.
  h.backend.maintenanceRuns.set("all-unknown-run", {
    runId: "all-unknown-run",
    kind: "authStatePrune",
    status: "running",
    asOf: now,
    leaseOwner: "gone",
    leaseUntil: new Date(now.getTime() - 1),
    tables: ["job_tombstones"],
    lanes: [
      {
        generation: "gen-1",
        shardId: "shard-0",
        status: "pending",
        tableIndex: 0,
        cursor: null,
        commandKey: "all-unknown-run:gen-1:shard-0:job_tombstones:",
      },
    ],
    expiresAt: null,
  });

  await expect(cron(h)).resolves.toMatchObject({ continued: false });
  expect(h.backend.maintenanceRuns.get("all-unknown-run")?.status).toBe(
    "completed",
  );
});
```

- run 行の置き方: `h.backend.maintenanceRuns.set("stale-run", {...})` で `status: "running"`, `leaseUntil: new Date(now.getTime() - 1)`（失効済み）を直接セット。表集合は `maintenanceTablesByKind` のオーバーライドではなく run 行自身の `tables: ["job_tombstones", "sessions"]` フィールドで未知表を混在させている（`createTestHarness()` はデフォルト設定のまま）
- ログ payload のフィールド: `expect(skipped?.meta).toMatchObject({ table: "job_tombstones", runId: "stale-run", generation: "gen-1", shardId: "shard-0" })`
- `asOf` の設定: `asOf: now`、撒いた期限切れセッションは `new Date(now.getTime() - 1)`（`asOf` 以前 = `asOf` が期限以降）
- `grep -n "\"unknown sweep table\"" /tmp/prune.out` および `grep -n "lane release failed\|MAINTENANCE_LANE_NOT_CLAIMED" /tmp/prune.out`: いずれも vitest reporter の標準出力には現れない（`exit=1`、0 行）。ログ文字列はテストコード内で `h.logger.byLevel("error")` を介してアサートされており、reporter の標準出力には印字されない

## エッジケース 2: 解放そのものが失敗したとき（throw が勝ち、lane は claimed のまま）

**手順:**
- 項目4と同じ出力を使用
- 解放失敗を扱うケース（`lane release` / `checkpoint down` で検索）の本体を Read

**期待結果:**
- このファイルの `Tests` が 34 件（実行前 32）
- 解放失敗を扱うケースが `checkpointLane` が投げる fixture（`maintenanceShardIds: ["shard-0".."shard-3"]`）の上に `advanceOrAck(completed: false)` も投げる設定を重ねた形で、次を主張している:
  - 元の throw（`"checkpoint down"`）がそのまま伝播する
  - 解放失敗が `[pruneExpiredAuthState] lane release failed` としてログに出る
  - lane が claimed のまま残る（4 件。元テストの 1 件ではない）
- テストコメントに `.thread` ローカルの ADR 番号（ADR-039 等）が書かれていない
- このケースが `it.skip` になっていない（skipped は 3 のまま）

**観測:**
- `Tests` 行: `Tests  34 passed (34)`
- 解放失敗を扱うケース名: `"a failing lane release is logged rather than thrown, and leaves the lanes claimed with the run still unfinished"`（`TC-identity-` 番号は付与されていない）。✓ 行:

```
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > a failing lane release is logged rather than thrown, and leaves the lanes claimed with the run still unfinished 1ms
```

- ケース本体（pruneExpiredAuthState.test.ts:729-784）:

```ts
it("a failing lane release is logged rather than thrown, and leaves the lanes claimed with the run still unfinished", async () => {
  // The release runs on the way out, including out of a throw whose own
  // cause makes the release fail too, so it must not rethrow — the
  // original failure is what has to reach the caller. What it must not
  // do is hide the consequence: the lanes stay `claimed`, and
  // `PRUNE_LEASE_OWNER` being a process constant means that for as long
  // as crons arrive within the lease this process keeps renewing its
  // own, so the lapsed-lease reclaim never fires for them.
  // `releaseLane`'s `workRemains = true` cannot be
  // observed here because the usecase throws instead of returning a
  // view; it is kept for a future call site that returns one.
  const h = createTestHarness({
    maintenanceShardIds: ["shard-0", "shard-1", "shard-2", "shard-3"],
  });
  const past = new Date(h.clock.now().getTime() - 1);
  // More than one page, so the first lane reaches `checkpointLane`.
  for (let i = 0; i < 150; i += 1) {
    seedAuthToken(h, past);
  }
  const realStore = h.workerContainer.maintenanceRunStore;
  const container = {
    ...h.workerContainer,
    maintenanceRunStore: {
      ...realStore,
      async checkpointLane(): Promise<void> {
        throw new Error("checkpoint down");
      },
      async advanceOrAck(
        input: Parameters<typeof realStore.advanceOrAck>[0],
      ) {
        if (!input.completed) {
          throw new Error("release down");
        }
        return realStore.advanceOrAck(input);
      },
    },
  };

  await expect(
    pruneExpiredAuthState({ container, input: { type: "cron" } }),
  ).rejects.toThrow("checkpoint down");
  expect(
    h.logger
      .byLevel("error")
      .some((entry) =>
        entry.message.includes("[pruneExpiredAuthState] lane release failed"),
      ),
  ).toBe(true);
  // The lanes really are stuck — the report is what has to stay honest.
  expect(
    h.backend.maintenanceRuns
      .values()
      .flatMap((run) => run.lanes)
      .filter((lane) => lane.status === "claimed"),
  ).toHaveLength(4);
});
```

- fixture: `maintenanceShardIds: ["shard-0", "shard-1", "shard-2", "shard-3"]`（4 shard）、`checkpointLane` が常に `"checkpoint down"` を throw、`advanceOrAck` は `completed: false` のときのみ `"release down"` を throw
- assert: `.rejects.toThrow("checkpoint down")`（元の throw が伝播）、`h.logger.byLevel("error").some(...includes("[pruneExpiredAuthState] lane release failed"))` が `true`、`claimed` の lane 数が `toHaveLength(4)`
- `.thread` / ADR 番号の grep: `grep -n "\.thread\|ADR-0" packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts` → 出力 0 行
- `it.skip` の grep: `grep -n "it\.skip" packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts` → 出力 0 行
- ファイル内 `it(` の総数: `grep -c "^ *it(" ...` → 34

## 既存機能への影響確認（コマンドで観測できる分）

**手順:**
1. `pnpm exec vitest run packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`
2. `pnpm exec vitest run packages/core/src/application/workers/__tests__/outboxPrune.test.ts`
3. 項目2の実行結果から `conformance.test.ts` の総件数
4. 項目4の実行結果から `TC-identity-165` と `"a budget-exhausted cron releases every claimed lane before returning"` の ✓ 行の有無
5. `pnpm build`

**期待結果:**
- 1: 7 件緑（増減なし）
- 2: 4 件緑
- 3: 238 件（実行前 232）
- 4: 両方の ✓ 行が存在する
- 5: 成功で終了

**観測:**
- 1: `exit=0`

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- 2: `exit=0`

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- 3: `Tests  238 passed (238)`（項目2の出力より）
- 4: ✓ 行

```
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > TC-identity-165: when every sweep of the invocation fails the cursor survives and SystemError(DatabaseError) is thrown 0ms
✓ packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts > pruneExpiredAuthState > a budget-exhausted cron releases every claimed lane before returning 1ms
```

- 5: `exit=0`。末尾出力:

```
dist/server/assets/Match-Pajnmx6c.js                       104.60 kB │ gzip:  24.70 kB
dist/server/server.node.js                                 355.57 kB │ gzip:  83.59 kB
dist/server/assets/server-Ch8W-hBn.js                      548.96 kB │ gzip: 111.51 kB

✓ built in 469ms
```
