# 手動テスト実行結果 (issue/11/cloudflare-d1-do-r2-adapters)

実行日: 2026-08-26
ブランチ: issue/11/cloudflare-d1-do-r2-adapters (チェックアウト済み、`git status --short` は空)

---

### 項目 1. Cloudflare アダプターが共有ポート適合スイートを全件パスする

**実行したコマンド:**
```
pnpm exec vitest run --project workers --reporter=verbose
```

**exit code:** 0

**観測した出力（要約せずそのまま。長い場合は関連部分を抜粋し、抜粋であることを明記）:**

最終サマリー行（そのまま）:
```
 Test Files  22 passed (22)
      Tests  368 passed (368)
   Start at  13:37:21
   Duration  7.82s (transform 2.90s, setup 0ms, import 14.40s, tests 18.14s, environment 1ms)
```

`conformance/` 配下で実行された 7 ファイル（`grep -oP` でユニーク抽出、そのまま列挙）:
```
directory.test.ts
identity.test.ts
projection.test.ts
route.test.ts
scopeBusiness.test.ts
scopeInfra.test.ts
unitOfWork.test.ts
```

実行された全 22 ファイル一覧（`|workers|` プレフィックス付きの行から抽出、ユニーク・ソート済み）:
```
src/adapters/cloudflare/__tests__/alarm.test.ts
src/adapters/cloudflare/__tests__/conformance/directory.test.ts
src/adapters/cloudflare/__tests__/conformance/identity.test.ts
src/adapters/cloudflare/__tests__/conformance/projection.test.ts
src/adapters/cloudflare/__tests__/conformance/route.test.ts
src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts
src/adapters/cloudflare/__tests__/conformance/scopeInfra.test.ts
src/adapters/cloudflare/__tests__/conformance/unitOfWork.test.ts
src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts
src/adapters/cloudflare/__tests__/durability.test.ts
src/adapters/cloudflare/__tests__/globalConcurrency.test.ts
src/adapters/cloudflare/__tests__/harness.test.ts
src/adapters/cloudflare/__tests__/idempotency.test.ts
src/adapters/cloudflare/__tests__/lease.test.ts
src/adapters/cloudflare/__tests__/projectionConcurrency.test.ts
src/adapters/cloudflare/__tests__/r2.test.ts
src/adapters/cloudflare/__tests__/routeGuard.test.ts
src/adapters/cloudflare/__tests__/runtimeComposition.test.ts
src/adapters/cloudflare/__tests__/searchEdges.test.ts
src/adapters/cloudflare/__tests__/sessionOverlay.test.ts
src/adapters/cloudflare/__tests__/support.test.ts
src/adapters/cloudflare/__tests__/unitOfWork.test.ts
```

`todo` / `skipped` 件数: サマリー行に `todo` / `skipped` の表記はなし（`368 passed (368)` のみ）。`grep -c "skip\|todo"`（大文字小文字問わず、`✓`/`stdout` 行を除外）でヒットしたのはサマリー行の `skipped`/`todo` 文字列を含む行のみで、いずれも 0 件だった。

`|workers|` プロジェクト名の付与: 全結果行に `✓ |workers| ...` の形式で付与されていることを確認（上記抜粋を参照）。

`harness.test.ts` の各ケース名と結果（該当行すべて、そのまま）:
```
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > exposes the D1, R2 and Durable Object bindings 0ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > applies the global schema, including the contentless FTS5 table 2ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > leaves no migrated table out of the wipe 1ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > expands a list through json_each rather than one binding per id 0ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > creates the scope schema on first contact with an object 5ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > refuses a scope object addressed as a scope it is not bound to 7ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > provides the Node built-ins the adapters rely on 0ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > offers the optional membership-edge seed the suites need 7ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > hands out backends that cannot see one another on any plane 29ms
```
(9件。10件目に相当する「creates the scope schema...」等含め全件 `✓`。)

**期待結果との対応:**
- 22 ファイル / 368 passed / 0 skipped / 0 failed（exit 0） → `Test Files 22 passed (22)` / `Tests 368 passed (368)` / exit=0。skipped/todo の明示的カウント行は出力に存在しない。
- `conformance/` の 7 ファイルが実行される → 上記 7 ファイル名を確認。
- `|workers|` プロジェクト名の付与 → 確認できた。

---

### 項目 2. 適合スイート呼び出し集合の一致

**実行したコマンド (1):**
```
pnpm exec vitest run --project workers --project node --reporter=verbose
```

**exit code:** 0

**観測した出力（末尾抜粋、そのまま）:**
```
 Test Files  99 passed (99)
      Tests  1352 passed | 3 skipped (1355)
   Start at  13:38:43
   Duration  14.54s (transform 7.41s, setup 0ms, import 30.07s, tests 37.74s, environment 8ms)

exit=0
```

`conformanceCoverage.test.ts` のケース名と結果（同出力から抜粋、そのまま）:
```
 ✓ |node| packages/core/src/adapters/__tests__/conformanceCoverage.test.ts > port-conformance suite coverage > runs the same suites against the memory and Cloudflare backends 4ms
 ✓ |node| packages/core/src/adapters/__tests__/conformanceCoverage.test.ts > port-conformance suite coverage > hands each backend's suites that backend's own factory 1ms
 ✓ |node| packages/core/src/adapters/__tests__/conformanceCoverage.test.ts > port-conformance suite coverage > has every harness offer every optional backend member 1ms
 ✓ |node| packages/core/src/adapters/__tests__/conformanceCoverage.test.ts > port-conformance suite coverage > leaves no suite unwired to a backend 1ms
```

**実行したコマンド (2):**
```
git diff origin/main...HEAD --stat -- packages/core/src/adapters/conformance/
```

**exit code:** 0

**観測した出力:**
```
(空)
```

**実行したコマンド (3):**
```
grep -rn "not implemented\|TODO\|FIXME" packages/core/src/adapters/cloudflare/ --include='*.ts' --include='*.sql'
```

**exit code:** 0（grep がマッチを検出したため 0）

**観測した出力（そのまま、1件ヒット）:**
```
packages/core/src/adapters/cloudflare/scopeTaskQueue.ts:31: * backend answering with an empty array has not implemented it. The
```

**期待結果との対応:**
- コマンド(2)の出力が空であること → 空出力を観測した（期待通り）。
- コマンド(3)が0件であること → 1件ヒットした（`scopeTaskQueue.ts:31`、コメント文中の "not implemented" という語句）。0件ではなかった。
- `conformanceCoverage.test.ts` のケース → 上記4ケースすべて `✓` で緑。

---

### 項目 3. transaction / 再試行 / 冪等性 / lease 回収の統合確認

項目1の出力（`--project workers --reporter=verbose`）から該当ケースを抜粋。

**durability.test.ts:**
```
 ✓ |workers| src/adapters/cloudflare/__tests__/durability.test.ts > cloudflare atomicity under a refused statement > keeps no part of a D1 batch whose middle statement is refused 8ms
 ✓ |workers| src/adapters/cloudflare/__tests__/durability.test.ts > cloudflare atomicity under a refused statement > keeps no part of a global unit of work whose commit is refused 5ms
 ✓ |workers| src/adapters/cloudflare/__tests__/durability.test.ts > cloudflare atomicity under a refused statement > rolls a scope write-set back inside transactionSync and publishes no index 16ms
```

**idempotency.test.ts:**
```
 ✓ |workers| src/adapters/cloudflare/__tests__/idempotency.test.ts > cloudflare replay of an operation whose response was lost > tells only the first caller of an applied operation that it was first 151ms
 ✓ |workers| src/adapters/cloudflare/__tests__/idempotency.test.ts > cloudflare replay of an operation whose response was lost > marks an event processed once however often the consumer replays 14ms
 ✓ |workers| src/adapters/cloudflare/__tests__/idempotency.test.ts > cloudflare replay of an operation whose response was lost > folds a re-saved outbox id onto the stored row instead of replacing it 7ms
 ✓ |workers| src/adapters/cloudflare/__tests__/idempotency.test.ts > cloudflare replay of an operation whose response was lost > hands a claimed outbox row to exactly one of two racing relays 5ms
```
（`applied_operations` に関するケースは "tells only the first caller of an applied operation that it was first"、`processed_events` に関するケースは "marks an event processed once however often the consumer replays" に対応すると見られる。指定された「折りたたむ」ケースは "folds a re-saved outbox id onto the stored row instead of replacing it" として実在し緑。）

**lease.test.ts:**
```
 ✓ |workers| src/adapters/cloudflare/__tests__/lease.test.ts > cloudflare scheduled-task lease reclaim > lets a second writer reclaim a lapsed lease without moving the row 50ms
```

**r2.test.ts:**
```
 ✓ |workers| src/adapters/cloudflare/__tests__/r2.test.ts > cloudflare R2 object storage > leaves one whole object behind when two writes race for a key 10ms
 ✓ |workers| src/adapters/cloudflare/__tests__/r2.test.ts > cloudflare R2 object storage > treats a delete of absent keys as done 3ms
 ✓ |workers| src/adapters/cloudflare/__tests__/r2.test.ts > cloudflare R2 object storage > spends the 1,000-key delete limit in chunks 12ms
```

**期待結果との対応:**
- 指定された全ケース名（`durability.test.ts` 3件、`idempotency.test.ts` の該当ケース、`lease.test.ts` 1件、`r2.test.ts` 3件）が実在し、いずれも `✓` で観測された。

---

### 項目 4. `deleteFilesByOwner` の SQL 文数の実測

項目1の出力から `deleteFilesByOwner.test.ts` の `AC-5:` で始まるケース（4件）を抜粋:
```
 ✓ |workers| src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner statement budget [cloudflare] > AC-5: the turn commits once, whatever the batch size 846ms
 ✓ |workers| src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner statement budget [cloudflare] > AC-5: enumeration and the outbox flush are constant, the per-row work is not 1047ms
 ✓ |workers| src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner statement budget [cloudflare] > AC-5: records the measured totals of one turn 387ms
 ✓ |workers| src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts > deleteFilesByOwner statement budget [cloudflare] > AC-5: the object executes exactly the statements it was sent 1326ms
```

**実行したコマンド:**
```
grep -n "4n + 3\|4n+3" spec/platform/index.md
```

**exit code:** 0

**観測した出力（そのまま）:**
```
155:一方で **1 turn の SQL 文の総数と、読み側の RPC 往復は件数に比例する**。所有者単位の一括削除メソッドを持たない設計（[domains/storage.md](../domains/storage.md)。1 件ごとに `storage.fileDeleted` を出すため `listByOwner` + `deleteFiles` の反復で行う）と、OCC の版トークンを `findById` でしか採れない契約から、読みは 1 件につき往復を持つ。Cloudflare 実装の実測は 1 turn `4n + 3` 文（`n` 件に対し読み `2n + 2` ＋ commit 内 `2n + 1`）で、commit は件数によらず 1 回である。これも上限ではなく実装が満たすべき設計目標として置く（[ADR 056](../adr/056-performance-budget-placement.md) 決定 2）。どのバックエンドがこの数に届かないかは同 ADR のコンテキストが持ち、この節には書かない（同 決定 3）。
```

**期待結果との対応:**
- 4件の `AC-5:` ケースが実在し緑 → 確認した。
- `spec/platform/index.md` に `4n + 3` の記述があること → 155行目に確認できた。

---

### 項目 5. `ScopeTaskScheduler` の fencing 決着が記録されている

**実行したコマンド (1):**
```
grep -n '^## ADR-019\|^## ADR-085\|^## ADR-094' .thread/11/adr.md
```

**exit code:** 0

**観測した出力（そのまま）:**
```
457:## ADR-019: `ScopeTaskScheduler` の settle に fencing token を足さず、`leaseMs` の運用下限で決着させる
1957:## ADR-085: 単一 writer 前提は driver ごとに書き分け、settle の fencing は AC-6 の結論のまま据える
2160:## ADR-094: object 駆動 turn の `leaseMs` は env から読み、既定値は定数のままにする
```

**実行したコマンド (2):**
```
grep -n "fencing\|leaseMs\|SCOPE_TASK_LEASE_MS" packages/core/src/application/ports/scopeTaskScheduler.ts
```

**exit code:** 0

**観測した出力（そのまま）:**
```
34:  leaseMs: number;
52:export const SCOPE_TASK_LEASE_MS = 5 * 60 * 1000;
107: * | `claimDue` | pending (due) / running (lapsed lease) | running, `leaseExpiresAt = now + leaseMs`; `dueAt`, `attempt`, `priority` and `payload` unchanged |
137: * `(kind, operationId)` alone and carries no fencing token, so a writer
139: * re-armed. `leaseMs` is the deployment's to choose and must exceed the
150: * reference runtime chooses the value with the `SCOPE_TASK_LEASE_MS`
153: * Input bounds: `limit <= 0` returns an empty array, and `leaseMs` must
```

**実行したコマンド (3):**
```
grep -n "SCOPE_TASK_LEASE_MS\|leaseMsOf" packages/core/src/adapters/cloudflare/do/scopeObject.ts
```

**exit code:** 0

**観測した出力（そのまま）:**
```
3:import { SCOPE_TASK_LEASE_MS } from "../../../application/ports/scopeTaskScheduler";
61:   * Lease an alarm turn grants, in milliseconds; the `SCOPE_TASK_LEASE_MS`
68:  SCOPE_TASK_LEASE_MS?: string;
71:const leaseMsOf = (raw: string | undefined): number => {
73:    return SCOPE_TASK_LEASE_MS;
80:      `SCOPE_TASK_LEASE_MS must be a positive integer (ms), got ${JSON.stringify(raw)}`,
166:        leaseMs: leaseMsOf(this.env.SCOPE_TASK_LEASE_MS),
```

**実行したコマンド (4):**
```
git diff origin/main...HEAD --stat -- packages/core/src/adapters/conformance/ spec/domains/
```

**exit code:** 0

**観測した出力（そのまま）:**
```
 spec/domains/identity.md  |  4 ++--
 spec/domains/index.md     |  8 ++++----
 spec/domains/note.md      | 14 ++++++++------
 spec/domains/workspace.md |  2 +-
 4 files changed, 15 insertions(+), 13 deletions(-)
```

項目1の出力から `alarm.test.ts` の `SCOPE_TASK_LEASE_MS` 関連と見られる3ケース（環境変数によるlease設定に関するケース、そのまま）:
```
 ✓ |workers| src/adapters/cloudflare/__tests__/alarm.test.ts > scope alarm > grants the lease the deployment configured 63ms
 ✓ |workers| src/adapters/cloudflare/__tests__/alarm.test.ts > scope alarm > grants the built-in lease when the deployment configures none 51ms
 ✓ |workers| src/adapters/cloudflare/__tests__/alarm.test.ts > scope alarm > refuses the turn and claims nothing when the configured lease is not a positive integer 35ms
```
（`SCOPE_TASK_LEASE_MS` という文字列そのものを含むケース名は `alarm.test.ts` 内に見つからなかった。上記3件はケース内容から `SCOPE_TASK_LEASE_MS` の運用に関するテストと判断されるものとして転記。）

**期待結果との対応:**
- ADR-019 / ADR-085 / ADR-094 の見出しが `.thread/11/adr.md` に存在すること → 3件とも観測できた。
- `scopeTaskScheduler.ts` に `fencing` / `leaseMs` / `SCOPE_TASK_LEASE_MS` の記述があること → 観測できた。
- `scopeObject.ts` に `SCOPE_TASK_LEASE_MS` / `leaseMsOf` の実装があること → 観測できた。
- `conformance/` の差分が空であること → 空出力を観測した。`spec/domains/` は差分ありを観測した（4ファイル、+15/-13）。

---

### 項目 6. 既存 Node 参照ランタイムの回帰（自動テスト・静的検査）

**実行したコマンド (1):**
```
pnpm exec vitest run --project node --reporter=verbose
```

**exit code:** 0

**観測した出力（末尾、そのまま）:**
```
 Test Files  77 passed (77)
      Tests  984 passed | 3 skipped (987)
   Start at  13:37:38
   Duration  6.18s (transform 4.88s, setup 0ms, import 14.72s, tests 16.08s, environment 5ms)
```

3 skipped のケース名（`↓` プレフィックスで検出、そのまま）:
```
 ↓ |node| packages/core/src/adapters/oauth/__tests__/conformance.test.ts > SignInOAuthClient code exchange [google] (unverifiable: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set) > rejects a malformed authorization code with OAUTH_CODE_INVALID
 ↓ |node| packages/core/src/adapters/oauth/__tests__/conformance.test.ts > SignInOAuthClient code exchange [google] (unverifiable: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set) > exchanges a code for the provider profile and propagates emailVerified
 ↓ |node| packages/core/src/adapters/oauth/__tests__/conformance.test.ts > SignInOAuthClient code exchange [google] (unverifiable: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set) > rejects a code whose PKCE challenge does not match the verifier
```

**実行したコマンド (2):**
```
pnpm test
```

**exit code:** 0

**観測した出力（末尾、そのまま。途中に stderr の uncaught exception ログが多数出力されるが、これらはエラーパスのテストが意図的に発生させた例外のログと見られる）:**
```
 Test Files  99 passed (99)
      Tests  1352 passed | 3 skipped (1355)
   Start at  13:38:06
   Duration  14.39s (transform 8.23s, setup 0ms, import 30.77s, tests 36.39s, environment 6ms)
```

**実行したコマンド (3):**
```
pnpm typecheck
```

**exit code:** 0

**観測した出力（そのまま）:**
```
$ tsgo && pnpm -r typecheck
Scope: 2 of 3 workspace projects
packages/core typecheck$ tsgo && tsgo -p tsconfig.cloudflare.json
packages/core typecheck: Done
apps/web typecheck$ tsgo
apps/web typecheck: Done
```

**実行したコマンド (4):**
```
pnpm lint
```

**exit code:** 0

**観測した出力（そのまま）:**
```
$ biome lint
biome.json:2:14 deserialize ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  i The configuration schema version does not match the CLI version 2.5.5

    1 │ {
  > 2 │   "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",
      │              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

  i   Expected:                     2.5.5
      Found:                        2.4.15


  i Run the command biome migrate to migrate the configuration file.


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


Checked 530 files in 289ms. No fixes applied.
Found 2 infos.
```

**実行したコマンド (5):**
```
pnpm format:check
```

**exit code:** 0

**観測した出力（そのまま）:**
```
$ biome format
Checked 543 files in 102ms. No fixes applied.
```

**実行したコマンド (6):**
```
git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web
```

**exit code:** 0

**観測した出力:**
```
(空)
```

**実行したコマンド (7):**
```
grep -n 'TZ' vitest.config.ts vitest.shared.ts
```

**exit code:** 0

**観測した出力（そのまま）:**
```
vitest.config.ts:38:          // CI is. The workers pool cannot set `TZ` at all, which is why
vitest.config.ts:40:          env: { TZ: "Asia/Tokyo" },
```
（`vitest.shared.ts` からのヒットはなかった。）

**期待結果との対応:**
- (1) 77 ファイル・984 passed / 3 skipped → `Test Files 77 passed (77)` / `Tests 984 passed | 3 skipped (987)` を観測。件数は一致。3件のスキップ名も観測できた。
- (2) 99 ファイル・1352 passed / 3 skipped → `Test Files 99 passed (99)` / `Tests 1352 passed | 3 skipped (1355)` を観測。件数は一致。
- (3)〜(5) いずれも exit=0 で観測。lint は「2 infos」（biome.json のスキーマバージョン不一致・非推奨フィールドの情報メッセージ）を出力しているが、エラー・警告ではない。
- (6) 空出力 → 観測した通り空。
- (7) `TZ` の設定箇所 → `vitest.config.ts:40` に `env: { TZ: "Asia/Tokyo" }` を確認。

---

### 項目 8. 新規に決めた物理スキーマと spec の一致

**実行したコマンド (1):**
```
git diff origin/main...HEAD --stat -- spec/
```

**exit code:** 0

**観測した出力（そのまま）:**
```
 spec/adr/021-scope-sharded-data-plane.md        |   2 +-
 spec/adr/056-performance-budget-placement.md    |   2 +-
 spec/adr/063-public-cursor-not-authenticated.md |  42 +++++
 spec/adr/index.md                               |   2 +
 spec/database/index.md                          | 231 +++++++++++++++++++++---
 spec/domains/identity.md                        |   4 +-
 spec/domains/index.md                           |   8 +-
 spec/domains/note.md                            |  14 +-
 spec/domains/workspace.md                       |   2 +-
 spec/inventory/adapter.md                       |  10 +-
 spec/inventory/domain.md                        |  10 +-
 spec/inventory/frontend.md                      |   2 +-
 spec/inventory/test.md                          |  18 +-
 spec/inventory/usecase.md                       |   6 +-
 spec/platform/index.md                          |  27 ++-
 spec/testcases/identity/deleteAccount.md         |   8 +-
 spec/testcases/identity/listPublicProfiles.md    |   2 +-
 spec/testcases/note/projectNoteChanges.md        |   4 +-
 spec/testcases/note/searchPublicNotes.md         |   2 +-
 spec/usecases/identity.md                       |  16 +-
 spec/usecases/note.md                           |   8 +-
 21 files changed, 329 insertions(+), 91 deletions(-)
```

**実行したコマンド (2):**
```
grep -n '_occ_guard' spec/database/index.md | head -20
```

**exit code:** 0

**観測した出力（そのまま）:**
```
30:| global D1: infrastructure | `outbox_events`, `processed_events`, `_occ_guard`, `scope_task_due_index` |
34:| scope DO: infrastructure | `_scope_identity`, `outbox_events`, `processed_events`, `_occ_guard`, `scheduled_tasks`, `tag_operations`, `tag_operation_locks`, `job_removal_manifests`, `scope_job_admission_leases`, `move_authorization_locks`, `applied_operations` |
1074:#### _occ_guard
1080:| `id` | integer | PK, `CONSTRAINT _occ_guard_conflict CHECK (id <> 0)` |
1087:INSERT INTO _occ_guard (id) SELECT 0 WHERE NOT EXISTS (<期待が成り立つときだけ行を返す SELECT>);
```

**実行したコマンド (3):**
```
grep -n 'scope_task_due_index' spec/database/index.md | head -20
```

**exit code:** 0

**観測した出力（そのまま）:**
```
30:| global D1: infrastructure | `outbox_events`, `processed_events`, `_occ_guard`, `scope_task_due_index` |
1094:#### scope_task_due_index
```

**実行したコマンド (4):**
```
grep -c 'CREATE TABLE' packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql
```

**exit code:** 0

**観測した出力（そのまま）:**
```
21
```

**実行したコマンド (5):**
```
ls packages/core/src/adapters/cloudflare/d1/migrations/
```

**exit code:** 0

**観測した出力（そのまま）:**
```
0001_global_schema.sql
```

**期待結果との対応:** （本項目は判定なし。事実のみ記録済み）

---

### エッジケース 1. D1 の bound parameter 上限

項目1の出力から `support.test.ts` の該当ケースを抜粋（そのまま）:
```
 ✓ |workers| src/adapters/cloudflare/__tests__/support.test.ts > cloudflare resolveMany at its input cap > resolves all 500 note routes in one statement 1121ms
 ✓ |workers| src/adapters/cloudflare/__tests__/support.test.ts > cloudflare resolveMany at its input cap > resolves all 100 users in one statement 61ms
 ✓ |workers| src/adapters/cloudflare/__tests__/support.test.ts > cloudflare adapter primitives > inserts, reads and deletes a list well past the binding limit in one statement each 7ms
 ✓ |workers| src/adapters/cloudflare/__tests__/support.test.ts > cloudflare adapter primitives > refuses a statement that would exceed the driver's binding limit 1ms
```

**期待結果との対応:**
- 指定4ケースすべてが実在し `✓` で観測された。

---

### エッジケース 2. 適合スイート間の相互汚染

**実行したコマンド:**
```
pnpm exec vitest run --project workers
```
（項目1に続く2回目の実行）

**exit code:** 0

**観測した出力（末尾、そのまま）:**
```
 Test Files  22 passed (22)
      Tests  368 passed (368)
   Start at  13:39:41
   Duration  8.91s (transform 3.50s, setup 0ms, import 16.68s, tests 21.72s, environment 1ms)
```

項目1（1回目）の最終サマリー: `Test Files 22 passed (22)` / `Tests 368 passed (368)`。2回目も `Test Files 22 passed (22)` / `Tests 368 passed (368)`。件数（22 passed / 368 passed）は同一。Duration・Start at の時刻は異なる（1回目 13:37:21・7.82s、2回目 13:39:41・8.91s）。

項目1の出力から `harness.test.ts` の該当2ケースを抜粋（そのまま）:
```
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > hands out backends that cannot see one another on any plane 29ms
 ✓ |workers| src/adapters/cloudflare/__tests__/harness.test.ts > cloudflare test harness > leaves no migrated table out of the wipe 1ms
```

**期待結果との対応:**
- 2回目の最終サマリーが項目1と同一であること → 件数（Test Files / Tests の passed 数）は同一。Duration・Start at は当然異なる。
- `harness.test.ts` の指定2ケース → 両方とも `✓` で観測された。

---

### エッジケース 3. 全文検索と memory 実装の契約差

項目2手順(1)（`--project workers --project node --reporter=verbose`）の出力から `LocalNoteQueryService` / `PublicNoteQueryService` の適合スイート由来 describe を抜粋。

memory バックエンド（`|node|`、そのまま）:
```
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > LocalNoteQueryService conformance [memory] > ADP-note-021: search returns empty results with a zero count on an empty projection 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > LocalNoteQueryService conformance [memory] > ADP-note-021: search filters by lifecycle, keyword, and tags with a total count 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > LocalNoteQueryService conformance [memory] > ADP-note-021: highlightedExcerpt escapes the projection's markup 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > LocalNoteQueryService conformance [memory] > ADP-note-021: sort keys and pagination behave deterministically 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > LocalNoteQueryService conformance [memory] > ADP-note-022: listMonthsWithNotes groups active notes by viewer-local month 13ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > LocalNoteQueryService conformance [memory] > ADP-note-023: countByDay aggregates a half-open range in the viewer time zone 1ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > LocalNoteQueryService conformance [memory] > ADP-note-024: countByContentStatus counts by body state 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > PublicNoteQueryService conformance [memory] > ADP-note-025: searchPublic pages by opaque cursor without exact counts 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > PublicNoteQueryService conformance [memory] > ADP-note-025: a tampered or condition-changed cursor is rejected 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > PublicNoteQueryService conformance [memory] > ADP-note-026: listPublicSitemapEntries enumerates public notes only 0ms
 ✓ |node| packages/core/src/adapters/memory/__tests__/conformance.test.ts > PublicNoteQueryService conformance [memory] > ADP-note-027: listPublicAuthors emits each owner once with the max updatedAt 0ms
```

cloudflare バックエンド（`|workers|`、そのまま）:
```
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > LocalNoteQueryService conformance [cloudflare] > ADP-note-021: search returns empty results with a zero count on an empty projection 30ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > LocalNoteQueryService conformance [cloudflare] > ADP-note-021: search filters by lifecycle, keyword, and tags with a total count 99ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > LocalNoteQueryService conformance [cloudflare] > ADP-note-021: highlightedExcerpt escapes the projection's markup 53ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > LocalNoteQueryService conformance [cloudflare] > ADP-note-021: sort keys and pagination behave deterministically 68ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > LocalNoteQueryService conformance [cloudflare] > ADP-note-022: listMonthsWithNotes groups active notes by viewer-local month 173ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > LocalNoteQueryService conformance [cloudflare] > ADP-note-023: countByDay aggregates a half-open range in the viewer time zone 58ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > LocalNoteQueryService conformance [cloudflare] > ADP-note-024: countByContentStatus counts by body state 44ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > PublicNoteQueryService conformance [cloudflare] > ADP-note-025: searchPublic pages by opaque cursor without exact counts 13ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > PublicNoteQueryService conformance [cloudflare] > ADP-note-025: a tampered or condition-changed cursor is rejected 11ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > PublicNoteQueryService conformance [cloudflare] > ADP-note-026: listPublicSitemapEntries enumerates public notes only 14ms
 ✓ |workers| src/adapters/cloudflare/__tests__/conformance/projection.test.ts > PublicNoteQueryService conformance [cloudflare] > ADP-note-027: listPublicAuthors emits each owner once with the max updatedAt 15ms
```

**期待結果との対応:**
- `LocalNoteQueryService` / `PublicNoteQueryService` の適合スイート由来 describe が両バックエンド（memory / cloudflare）で実行され緑であること → 両方とも同一の ADP-note-021〜027 ケース群が `✓` で観測された。

---

### 既存機能への影響確認

**実行したコマンド:**
```
pnpm build:node
```

**exit code:** 0

**観測した出力（末尾、そのまま）:**
```
dist/server/assets/NoteDetail-safVmF2y.js                    6.14 kB │ gzip:   2.58 kB
dist/server/assets/react-dom-Cy0VVNVI.js                     6.67 kB │ gzip:   1.96 kB
dist/server/assets/RawStream-MsN4f0hP.js                     8.34 kB │ gzip:   2.47 kB
dist/server/assets/-action-CtSnNDsR.js                       8.86 kB │ gzip:   3.95 kB
dist/server/assets/atom-CsoqP4gV.js                          9.65 kB │ gzip:   2.51 kB
dist/server/assets/SignUpForm-K46rGNpW.js                   10.21 kB │ gzip:   2.68 kB
dist/server/assets/VerifyEmailPanel-FwZoA9_G.js             10.23 kB │ gzip:   2.77 kB
dist/server/assets/SignInForm-Duq8_0Lt.js                   10.72 kB │ gzip:   3.55 kB
dist/server/assets/OAuthCallbackPanel-DypSsxZh.js           10.75 kB │ gzip:   3.20 kB
dist/server/assets/errorResponseMiddleware-Bokv9Qtr.js      11.52 kB │ gzip:   4.06 kB
dist/server/assets/ResetPasswordPanel-yR72otZR.js           13.18 kB │ gzip:   3.37 kB
dist/server/assets/redirect-G7U2dj3U.js                     14.54 kB │ gzip:   4.90 kB
dist/server/assets/useStore-DLd_FExK.js                     15.37 kB │ gzip:   5.07 kB
dist/server/assets/head-BsWyGSuk.js                         15.42 kB │ gzip:   4.07 kB
dist/server/assets/react-Ce_sGTXc.js                        15.75 kB │ gzip:   4.30 kB
dist/server/assets/link-BhcNClbA.js                         16.03 kB │ gzip:   4.39 kB
dist/server/assets/DeleteAccountPanel-D-8U3osQ.js           16.06 kB │ gzip:   5.44 kB
dist/server/assets/router-B-cOLzxM.js                       19.21 kB │ gzip:   6.57 kB
dist/server/assets/ProfileForm-BcJ0a1NK.js                  19.55 kB │ gzip:   6.11 kB
dist/server/assets/IdentityList-BBE1H6wr.js                 25.18 kB │ gzip:   6.38 kB
dist/server/assets/request-response-6-GcH2nL.js             35.75 kB │ gzip:   9.77 kB
dist/server/assets/ClientOnly-DBfotMSA.js                   37.63 kB │ gzip:   9.73 kB
dist/server/assets/transformer-AQNQUFHn.js                  49.19 kB │ gzip:  12.54 kB
dist/server/assets/server-2fBcX7dn.js                       79.76 kB │ gzip:  18.15 kB
dist/server/assets/Match-Pajnmx6c.js                       104.60 kB │ gzip:  24.70 kB
dist/server/server.node.js                                 356.51 kB │ gzip:  83.95 kB
dist/server/assets/server-Ch8W-hBn.js                      548.96 kB │ gzip: 111.51 kB

✓ built in 407ms
```

**期待結果との対応:** （本項目は判定なし。exit=0、`✓ built in 407ms` を観測）

