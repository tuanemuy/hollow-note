# レビュー 004 — Use Case / ポート契約

対象: PR #45 / ベース `main` / 差分 `16-round-004.diff`（ゼロベース）

### Blockers

なし

### Warnings

なし

---

## 検証したこと（指摘なしの根拠）

指摘が 0 件なので、何を確かめて 0 件と判断したかを残す。

### `advanceOrAck` の応答形状と契約 1〜4 の一貫性

- **型**: ポート `advanceOrAck` は `Promise<Readonly<{ next: MaintenanceLane | null; runCompleted: boolean }>>`。`spec/domains/index.md:138` の署名、`spec/inventory/domain.md` DOM-common-030、`spec/inventory/adapter.md` ADP-common-029 の要約と一致。
- **契約 1（run のスナップショットが唯一の正本）**: memory 実装は `run.tables` と `lane.tableIndex` のみで現在表を導出し（`toLane`）、`beginOrResumeKind` の resume 経路は `run.tables` を読み直さない。適合スイートの `setMaintenanceTables` → resume ケースが「配備の設定を読み直す実装」を落とせる形になっており、実行形がある。呼び出し側から表順定数は消えた（`grep -rn "SWEEP_ORDER" packages apps` は dist を除き 0 件）。
- **契約 2（進めた先の position を返す / `next: null` の条件）**: 実装は (a) 同一 lane の次表 → `cursor: null` + 再 mint した key、(b) 別 shard 自動 claim → 永続化済み行をそのまま `toLane`、(c) 解放 → 即 `{ next: null, runCompleted: false }`、(d) pending 無し → `{ next: null, runCompleted }`。`asOf` はどの経路も `run.asOf` 由来で、`checkpointLane` は `asOf` を書かない（cursor と commandKey のみ）。適合スイートは (a)〜(d) をすべて拘束し、`backend.clock.advance(MINUTE_MS)` と `offBoundary` の checkpoint で「壁時計を押した実装」「checkpoint の `asOf` で境界を動かす実装」を落とせるようにしてある。JSDoc が「two situations」、ADR 061 / `spec/domains/index.md` が「3 つ」と数え方が違うが、JSDoc 側は 2 つ目に「run 完了の ack」と「他 lane が claimed の ack」を明示的に畳み込んでおり集合は同一。矛盾ではない。
- **契約 3（key を mint する側）**: (a) run 生成時の先頭 position（`beginOrResumeKind`）と次表へ進めた position（`advanceOrAck`）は `${runId}:${gen}:${shard}:${table}:${cursor ?? ""}` を mint し、呼び出し側 2 か所（`pruneExpiredAuthState.commandKeyOf` / `terminalPrune.commandKeyOf`）の導出と byte 一致。(b) 自動 claim と `claimLanes` は永続化済みの key をそのまま返す。適合スイートは (b) を規則外文字列 `"command-off-rule"`（ADP-common-029）と `"command-2"`（ADP-common-028）で拘束しており、再 mint する実装は落ちる。Queue 重複排除の前提は保たれている。
- **契約 4（返った lane は claimed / 駆動側が処理か解放）**: 適合スイートに「ack が返した position は claimed のまま」の独立ケースがあり、駆動側 2 経路（`pruneExpiredAuthState.runCron` は `laneQueue` へ push、`terminalPrune.runCron` は `release`）はどちらも義務を果たしている。継続 turn（`runContinuation` 2 本）が返り値を捨てる点は契約 4 が主体を「駆動する呼び出し側」に限定したうえで、ポート JSDoc・両 usecase の Runtime wiring note・ADR 061 の残存条件に同じ内容で記録されている（記述と実態が一致）。

### `pruneExpiredAuthState` の lane 駆動ループ

漏れ・停滞・無限ループの経路を全通り追った。

- **無限ループ無し**: 外側ループの先頭で `commands >= MAX_COMMANDS_PER_INVOCATION` を判定するため、lane を pop するたび必ず 1 command 以上消費する（未知表 skip も `commands += 1`）。内側ループは `laneDone` か予算で必ず抜ける。
- **claimed 漏れ無し**: lane が到達しうる終端は ①処理完了で ack（返った lane は push）②sweep 失敗で解放 ③予算切れで解放 ④未知表 skip で ack（返った lane は push）⑤`finally` の一括解放（`inFlight` + `laneQueue`、`generation shardId` で重複排除）。未知表 skip 経路は `inFlight = null` を ack 成功後に置いており、ack が投げれば `finally` が同じ lane を解放する。ack 経路で押し込んだ lane も、直後に予算 break しても `laneQueue` 経由で解放される。
- **停滞無し**: 別 shard 自動 claim の「解放 → `claimLanes` 取り直し」の迂回が消え、`claimLanes` は cron あたり 1 回。TC-identity-348（8 shard、上限 6）が `advanceOrAck(completed: false)` 0 回で run 完走を観測している。表順ずれ由来の停滞は TC-identity-347、表が減る側は TC-identity-349 が拘束。

### at-least-once・冪等性・`commandKey` 重複排除

- lane 位置から決定的に導く key の規則は変わっていない。store が mint する 2 つの position（run 先頭・次表）と呼び出し側の checkpoint 由来 key の使い分けが契約 3(a)/(b) として分岐で書かれており、既存 position の再 mint を適合スイートが禁じている。
- `checkpointLane` の表不一致は `ConflictError("MAINTENANCE_LANE_TABLE_MISMATCH")` のまま。DELETE と checkpoint がトランザクションを共有しない前提（同じ入力 cursor から冪等再実行）も変わっていない。
- 未知表 skip は `failures` に数えず `successes` にも数えないため、`failures > 0 && successes === 0` の `SystemError(DatabaseError)` 条件の意味が保たれている。`spec/usecases/identity.md` のエラーケース表・TC-identity-165（本文と `spec/inventory/test.md` の両方）が同じ言い回しに更新されている。

### `terminalPrune` の挙動不変

`pruneAccountDeletionManifests` はソース上 JSDoc 追記のみ。`advanced.next` の使い方は `release(advanced.next)` のままで、`MaintenanceLane` へ広がっても構造的に適合する（`pnpm typecheck` 緑）。単一表 kind なので自動 claim された lane を即解放する方針も維持。`deleteAccount.terminalPrune.test.ts` は無変更で緑。

### 記述と実装の食い違い（このラウンドで新たに入ったずれ）

- `releaseLane` の catch コメントと予算切れ解放のコメントが「この process の次の cron が自分のリースを更新するので失効回収は決して発火しない」から「`LEASE_MS` 以内に cron が来る限り」へ直っている。`LEASE_MS = 10 分`・cron は hour bucket なので、実際には次の cron 時点でリースは失効している。修正後の記述のほうが事実に合う。ポート JSDoc 契約 4 と両 usecase の Runtime wiring note の「リース失効まで claimed のまま、後続 cron が回収する」も同じ理解で整合。
- `di/types.ts` の `AuthStateTable` JSDoc（型エラーになるのは union を通る呼び出しだけで、run の表集合経由の表は実行時 skip）は ADR 062 と実装（`isAuthStateTable` ガード）に一致。
- `spec/database/index.md` / `spec/platform/index.md` / `spec/usecases/job.md` の checkpoint 記述が position ベースへ揃い、「表を進めるのは `advanceOrAck` 側」が実装（`checkpointLane` は cursor と commandKey のみ更新）と一致。`spec/usecases/job.md` は本 PR が偽にした文だけを直しており、`jobTombstonePrune` usecase の実装には踏み込んでいない（スコープ内）。
- `spec/usecases/identity.md` 手順 2 の ack 応答の列挙が `table` / `cursor` / `commandKey` で `asOf` を含まないが、usecase は sweep 境界に `begin.asOf` を使い lane の `asOf` を読まないので、usecase 視点の列挙として正しい。ポート面の正本は `spec/domains/index.md` 側にあり、そちらには `asOf` がある。

### 不要な記述

コード・コメントに指摘への弁明や修正の経緯は見当たらない。残っている非自明なコメントはいずれも why / hidden constraint 型（`conformanceBackend.setMaintenanceTables` の「値スロットを書き換え可能に保つのが load-bearing」、`releaseLane` の「今は防御的」、適合スイートの「壁時計を run 境界からずらす理由」）で、CLAUDE.md のコメント方針の範囲内。

### 受け入れ基準とスコープ

AC-1〜AC-12 は上記のとおり満たされている。AC-13 はこのレビュー中に実測して確認した。

- `pnpm typecheck` 緑
- `pnpm test` 緑（Test Files 76 passed / Tests 978 passed, 3 skipped）
- `pnpm lint` 緑（Found 2 infos — biome の設定移行案内で、本 PR とは無関係の既存状態）
- `pnpm format:check` 緑（No fixes applied）

スコープ越えの変更は見当たらない。`spec/platform/index.md` / `spec/usecases/job.md` / `di/types.ts` の変更はいずれも本 PR が偽にした記述の是正に限定されている。plan.md「含まれないもの」（`checkpointLane` の key mint 移譲、`terminalPrune` の `TABLE` 定数、run の明示 generation 列、`AuthStateTable` union の再設計、起動時ドリフト検査、cron 配線）はいずれも手つかずのまま。

## カバレッジ

- 確認: `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/platform/index.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`, `.thread/16/plan.md`, `.thread/16/review/triage-keys.md`
- スキップ: `.thread/16/adr.md`, `.thread/16/steps.md`, `.thread/16/testing.md`, `.thread/16/review/review-001.md`, `.thread/16/review/review-001-adapter.md`, `.thread/16/review/review-001-spec.md`, `.thread/16/review/review-001-usecase.md`, `.thread/16/review/review-002.md`, `.thread/16/review/review-002-adapter.md`, `.thread/16/review/review-002-spec.md`, `.thread/16/review/review-002-usecase.md`, `.thread/16/review/review-003-adapter.md`, `.thread/16/review/review-003-spec.md`, `.thread/16/review/review-003-usecase.md`, `.thread/16/review/triage.md` — 進行管理の作業記録（過去ラウンドの指摘と判定の履歴）であり、契約・実装の正本ではない。ゼロベースのレビューでは前ラウンドの指摘を前提にしないため内容を判断材料にせず、`plan.md`（受け入れ基準）と `triage-keys.md`（既出判定）だけを読んだ。`testing.md` は動作確認計画として冒頭のみ通読し、本観点の判断には使っていない。
