# Round 6 — Adapter

## Adapter

### Blockers

なし

### Warnings

なし

### 所見

ゼロベースで、ポート JSDoc の遷移表（5 操作 × `absent / pending / running / failed`）と観測属性
（`kind` / `operationId` / `priority` / `payload` / `dueAt` / `leaseExpiresAt` / `attempt` / 返却順 / 返却集合）、
および入力境界（`limit <= 0`、`leaseMs`）を列挙し直して適合スイートと突き合わせた。空きセルは無い。

- 遷移表の全セルに対応ケースがある。`complete` は absent / pending / running / failed の 4 状態すべて、
  `backoff` は absent / pending / running / failed、`backoffOrSchedule` は mint / pending / running / failed、
  `schedule` は absent / pending / running / failed（`failed` からの復活で `attempt = 0` まで）。
- `spec/platform` の枠取り規定（下限であって上限でない・`limit` がクラス数未満なら厳密 priority 順）と
  `spec/database` の同 priority 内順序（`due_at, kind, operation_id`）は、返却**順**だけでなく返却**集合**まで
  拘束されている（`limit` が切る位置にケースを置いてある）。
- `scopeTaskQueue.ts` は読み取り専用で、候補述語（`isScopeTaskDue`）も選択関数（`selectDueScopeTasks`）も
  scheduler と同一のものを import している。重複実装は無い。
- `selectDueScopeTasks` は memory 固有の状態表現に触れず、候補判定を呼び出し側に委ねている。
  スイート側も保存表現を assert しておらず、別バックエンドで落ちる実装詳細依存は見当たらない
  （唯一の例外候補だった `values()` の挿入順は `(priority, dueAt, kind, operationId)` が scope 内で
  全順序になるため効かない。scope 跨ぎの完全同値時の不定性はポート JSDoc が明示している）。
- clock はポート経由。memory アダプターは `new Date()` を一切呼ばず、`leaseExpiresAt` は引数の `now` から導く。
- UoW ロールバックで claim の書き戻しが巻き戻ることは `MemTable` の undo ログで成立し、
  `adapters/memory/__tests__/unitOfWork.test.ts` に memory ローカルテストとして置かれている
  （契約ではなく実装特性なので、スイートではなくローカルという置き場所も ADR 026 の 3 に沿う）。
- 判別共用体は `失敗行は dueAt を持たない` / `lease は running だけが持つ` を型で閉じており、
  遷移は spread ではなく明示構築。`toScopeTask` が `running` 行だけを受ける形になっているのも良い。
- コメントは全て WHY（ケースが何を弁別するか / なぜ spread ではないか）。経緯・メタ記述は無い。

### ミューテーション検証

適合スイートが実効的かを確かめるため、18 件のミューテーションを実際に当てて実行し、すべて元に戻した
（`git status` クリーン、`pnpm test` = 958 passed / 3 skipped）。17 件が赤になった。

| # | 壊した内容 | 結果 |
|---|---|---|
| A | `claimDue` が呼び出し側の `leaseMs` を無視して定数を使う | 1 failed |
| B | `backoffOrSchedule` が既存行の `priority` を上書き | 1 failed |
| C | 比較子から `kind` のタイブレークを削除 | 1 failed |
| D | claim が `attempt` を 0 にリセット | 5 failed |
| E | `schedule` が既存行の `priority` を温存 | 2 failed |
| F | `listDue` から予約枠を削除（純 priority 順） | 1 failed |
| G | 失効リースを再 claim しない | 3 failed |
| H | 予約枠が各 priority の**最後**の行を取る | 7 failed |
| I | `complete` が running 行に対して no-op | 1 failed |
| J | claim が `dueAt` を `now` で打ち直す | 1 failed |
| K | `backoff` がリースを解放しない | 2 failed |
| L | `schedule` がリースを解放しない | 1 failed |
| M | `listDue` がリース中の行を返す | 3 failed |
| N | リース失効判定を `<` に（境界） | 3 failed |
| O | `dueAt` 到来判定を `<` に（境界） | 6 failed |
| S | attempt 上限を off-by-one | 1 failed |
| T | 初回 backoff 遅延を 2 倍に | 4 failed |
| U | リースを `dueAt` 起点で張る | 4 failed |
| V | 負の `limit` を無制限として扱う | 1 failed |

**生き残り 1 件**: `listDue` が失効リース行を `dueAt` ではなく `leaseExpiresAt` で並べる変異は緑のまま通る。
指摘には上げない — (1) `listDue` の順序は runner の scope 発見順にしか効かず、実際の選択は scope 内の
`claimDue` がやり直すので観測可能な害が無い、(2) `spec/database` の dequeue 索引が
`(priority, due_at, kind, operation_id)` の 1 本走査に候補 2 分岐を述語として掛ける形で確定しているため、
#11 の D1 / DO 実装がこの経路を踏む筋道が無い。指摘の 2 条件（実害 / 別バックエンドが確実に踏む）を満たさない。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`
- 差分外の参照: `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`
- スキップ: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md` — ランタイム配線で Adapter 観点外
- スキップ: `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts` — env → tuning の配線で Adapter 観点外
- スキップ: `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — application 層の呼び出し側
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — spec 観点
- スキップ: `.thread/19/**` — Phase 7 で削除される足場
