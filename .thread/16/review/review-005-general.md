# レビュー結果 — Issue #16 / PR #45 / Round 5（確認ラウンド）

## General Review

### Blockers

なし

### Warnings

なし

### 受け入れ基準の確認

- AC-1: 満たしている — `advanceOrAck` の戻り値は `Promise<Readonly<{ next: MaintenanceLane | null; runCompleted: boolean }>>`（`application/ports/globalMaintenanceRunStore.ts:147`）。ポート JSDoc の契約 1 に「the **ordered table set fixed when the run was created** is the single source of truth」「Callers hold no table order of their own」が書かれている。
- AC-2: 満たしている — `grep -rn "SWEEP_ORDER" packages apps` は 0 件（`.thread` と `apps/web/dist` を除きリポジトリ全体でも 0 件）。順序を持つ配列は `DEFAULT_MAINTENANCE_TABLES`（アダプター側）だけに残り、usecase 側に残るのは順序を持たない述語 `isAuthStateTable` と `commandKeyOf`（`checkpointLane` 用途、シグネチャ不変）のみ。
- AC-3: 満たしている — 適合スイートが store 生成 position の 2 種類を拘束する。同一 lane の次表（`nextTable.commandKey === commandKeyOf("run-1", nextTable)`、`table: "t2"` / `cursor: null` / `asOf: started.asOf`）と、run 生成時の先頭 position（`virgin.commandKey === commandKeyOf(...)`）。
- AC-4: 満たしている — `"...auto-claims a released lane at the table it reached, not the run's first"` が、事前に t2 / `cursor-77` / 規則外キー `"command-off-rule"` で checkpoint → 解放した lane を自動 claim させ、3 値がそのまま返ることを拘束する。既存 position の再 mint は落ちる形になっている（規則外文字列を使っているため）。memory 実装も `toLane(run, { ...nextPending, status: "claimed" })` で再 mint しない。
- AC-5: 満たしている — TC-identity-347（`authStatePrune: ["identity_removal_receipts", "sessions"]`）が 1 回の cron で `continued: false` / run `completed` / セッション実削除 / claimed lane 0 件を主張する。
- AC-6: 満たしている — 未知表分岐は `advanceOrAck(completed: true)` で前進し、`failures` を加算せず、`logger.error("[pruneExpiredAuthState] unknown sweep table", { table, runId, generation, shardId })` を出す。TC-identity-349 が `stale-run`（`["job_tombstones","sessions"]`）と `all-unknown-run`（`["job_tombstones"]`）の 2 段で、完走・ログ payload・`SystemError` 非送出を観測する。
- AC-7: 満たしている — 別 shard 自動 claim の「解放 → `claimLanes` 取り直し」経路は削除され、`laneQueue.push(advanced.next)` に一本化された。TC-identity-348（8 shard）が `advanceOrAck(completed: false)` の呼び出し回数 0 を観測する。
- AC-8: 満たしている — ADP-common-029 は 7 ケースに分かれ、同一 lane 次表と別 shard 自動 claim の両方について `table` / `cursor` / `asOf` / `commandKey` を検証し、直後の `claimLanes` が 0 件であることで claimed も検証する。解放については `"a release hands back no position even while another lane is pending"` が `{ next: null, runCompleted: false }` と「他方 shard が pending のまま」を同時に拘束し、同じ拘束がポート JSDoc の契約 2 にある。
- AC-9: 満たしている — `spec/domains/index.md` の署名と散文、`spec/database/index.md` の `global_maintenance_runs`（run 単位の順序付き表集合／lane は表集合への position／checkpoint は「現在 position の keyset cursor と次 command key」で表を進めない）、`spec/inventory/domain.md` DOM-common-030、`spec/inventory/adapter.md` ADP-common-029、`spec/inventory/usecase.md` UC-identity-021、`spec/usecases/identity.md` 手順 2 とエラーケース表がいずれも新契約と一致する。
- AC-10: 満たしている — `spec/adr/061-maintenance-sweep-order-authority.md` / `062-unknown-sweep-table-skip.md` が起票され、`spec/adr/index.md` の一覧と前提依存マップに 2 行ずつ載る。061 は ADR 026 / 046、062 は 061 / 025 を前提として明記。061 の「影響」に 2 つの呼び出し元の正反対の方針の引き継ぎも入っている。
- AC-11: 満たしている — `spec/testcases/identity/pruneExpiredAuthState.md` に 3 行追加、`spec/inventory/test.md` に TC-identity-347..349 を末尾採番で追加。TC-identity-165 は本文 20 行と同一の新文言に更新済み（本文・台帳の片側だけ直しになっていない）。
- AC-12: 満たしている — ポート JSDoc に契約 2 / 3(a) / 3(b) / 4 があり、契約 4 の主体は "The caller that **drives** lanes — the cron path" に限定されている。`MaintenanceLane` 型 JSDoc に `generation` が routing reshard 世代である旨の記述がある。`pruneExpiredAuthState` / `terminalPrune` 双方の Runtime wiring note に、ack で返った lane の扱い（引き渡し口が無く、リース失効まで claimed のまま）が 1 段落ずつ入っている。
- AC-13: 満たしている — `pnpm typecheck` 成功、`pnpm lint` は info 2 件のみで fix なし、`pnpm test` は 76 files / 978 passed / 3 skipped。`conformance.test.ts` は 238 passed、`GlobalMaintenanceRunStore conformance [memory]` は 17 ケース（`.thread/16/testing.md` の期待値と一致）。

### 追加で確認した観点

- **契約・実装・スイート・spec canon の四者整合**: 契約 3(b) が名指す「既存 position を返す全経路」は自動 claim（新ケース）と `claimLanes`（ADP-common-028 の `"command-2"` 保持）の双方が拘束済みで、片側だけの記述になっていない。`spec/domains/index.md:152` の散文はポート JSDoc の契約 1〜3 と語彙・分岐の切り方まで一致する。
- **`pruneExpiredAuthState` の lane 駆動ループ**: 前進は単調（`tableIndex` 増加または lane `done`）で、未知表 ack も `commands += 1` で予算に数えるため無限ループにならない。`advanced.next` が push される全経路（既知表 ack / 未知表 ack）と、budget 打ち切り・throw の全脱出経路が `finally` の重複除去付き一括解放でカバーされ、claimed のまま漏れる lane が無い。未知表分岐の `inFlight = null` も残っており、完走した run に余計な解放が飛ばない。
- **`advanced.next` の chain で同時 claim 上限が破れないこと**: memory 実装は自動 claim の前に当該 lane を `done` にするため active lane は 6 を超えない。usecase 側も 1 lane 取り出すごとに最大 1 lane しか増えない。
- **偽になった記述の残存**: `spec/platform/index.md:207` と `spec/usecases/job.md:551` の checkpoint 記述（旧「table/cursor/command key を checkpoint する」）は今回の position ベース canon に合わせて是正済み。`spec/` 全文を `advanceOrAck` / 表順 / 次表 / lane で走査したが、他に偽になる記述は無い。`docs/runtime_node.md` の「`pruneExpiredAuthState` は未スケジュール」も真のまま。
- **経緯・弁明の残存**: コード・コメント・spec に `.thread` ローカルの ADR 番号（ADR-001..006）や修正経緯の記述は無い。残っているコメントはいずれも WHY / WHY-NOT（`setMaintenanceTables` が必須である理由、値スロットを書き換え可能に保つ理由、`workRemains = true` が観測できない理由）で、CLAUDE.md のコメント方針に沿う。
- **スコープ逸脱**: `.thread/16/plan.md`「含まれないもの」に挙がった項目（ADR-039 の恒久対策、`runContinuation` の是正、`checkpointLane` の mint 移動、`TABLE` 定数、run の generation 列、`jobTombstonePrune` usecase、4 種表記の既存乖離、`AuthStateTable` レジストリ再設計、起動時ドリフトガード、cron 配線）はいずれも手つかずで、差分に混入していない。`terminalPrune` の挙動（自動 claim lane を即解放）も不変で、テスト 7 件緑のまま。
- **セキュリティ / パフォーマンス**: 追加のログ payload は `runId` / `generation` / `shardId` / 表名のみで、秘匿値を含まない。ack chain は往復を減らす方向の変更で、1 invocation の作業量は `MAX_COMMANDS_PER_INVOCATION` で従来どおり有界。

### カバレッジ

確認:
`packages/core/src/adapters/conformance/backend.ts`,
`packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`,
`packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`,
`packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`,
`packages/core/src/application/di/types.ts`,
`packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`,
`packages/core/src/application/identity/deleteAccount/terminalPrune.ts`,
`packages/core/src/application/identity/pruneExpiredAuthState.ts`,
`packages/core/src/application/ports/globalMaintenanceRunStore.ts`,
`spec/adr/061-maintenance-sweep-order-authority.md`,
`spec/adr/062-unknown-sweep-table-skip.md`,
`spec/adr/index.md`,
`spec/database/index.md`,
`spec/domains/index.md`,
`spec/inventory/adapter.md`,
`spec/inventory/domain.md`,
`spec/inventory/test.md`,
`spec/inventory/usecase.md`,
`spec/platform/index.md`,
`spec/testcases/identity/pruneExpiredAuthState.md`,
`spec/usecases/identity.md`,
`spec/usecases/job.md`,
`.thread/16/adr.md`,
`.thread/16/plan.md`,
`.thread/16/steps.md`,
`.thread/16/testing.md`,
`.thread/16/review/triage-keys.md`

スキップ:
`.thread/16/review/review-001.md`,
`.thread/16/review/review-001-adapter.md`,
`.thread/16/review/review-001-spec.md`,
`.thread/16/review/review-001-usecase.md`,
`.thread/16/review/review-002.md`,
`.thread/16/review/review-002-adapter.md`,
`.thread/16/review/review-002-spec.md`,
`.thread/16/review/review-002-usecase.md`,
`.thread/16/review/review-003-adapter.md`,
`.thread/16/review/review-003-spec.md`,
`.thread/16/review/review-003-usecase.md`,
`.thread/16/review/review-004.md`,
`.thread/16/review/review-004-adapter.md`,
`.thread/16/review/review-004-spec.md`,
`.thread/16/review/review-004-usecase.md`,
`.thread/16/review/triage.md`
— 過去ラウンドのレビュー記録そのもので、本ラウンドはゼロベース評価のため内容を前提にしない。既出判定に必要な `triage-keys.md` のみ読んだ。
