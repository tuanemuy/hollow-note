# レビュー R3 — Adapter / 適合スイート

対象: PR #45 / ベース `main` / 差分 `16-round-003.diff`（36 ファイル）

## Adapter / 適合スイート

### Blockers

- **[B-001]** 契約 1 のうち「resume 中に配備の設定が変わっても run の表集合は動かない」半分が、適合スイートに実行形を持たない。memory 実装の `beginOrResumeKind` の resume 分岐で表集合を再スナップショットしても、適合スイートは 17 件すべて緑のまま通る
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:1609`（`ADP-common-029: an ack walks the table set the run was created with, not the deployment's current one`）／契約側は `packages/core/src/application/ports/globalMaintenanceRunStore.ts:48-52`
  - 理由: ポート JSDoc の契約 1 は「the run row holds that set, ... and **the set does not move while the run is resumed** even if the deployment's configuration changed in between」と明記し、スイートの冒頭 JSDoc も「`setMaintenanceTables` を必須メンバーにしたのは contract 1 を検証するため。無ければ backend は contract 1 未検証のまま conformant を名乗る」と書いている。しかし唯一 `setMaintenanceTables` を使うこのケースは、`begin` → `claimLanes` → `setMaintenanceTables` → `advanceOrAck` と**同じ lease の中で ack するだけ**で、`beginOrResumeKind` の resume 経路を一度も通らない。実際に memory 実装を次のように変異させて確認した:

    ```ts
    // beginOrResumeKind の resume 分岐
    table.set(running.runId, {
      ...running,
      tables: backend.maintenanceTablesByKind[input.kind], // ← 再スナップショット
      leaseOwner: input.leaseOwner,
      ...
    ```

    この変異で `GlobalMaintenanceRunStore` 適合スイートは **17 passed**（赤にならない）。`packages/core` 全体を回して初めて `TC-identity-349`（usecase テスト）1 件だけが落ちる。つまりこの契約を守らせているのは memory バックエンドにしか当たらない usecase テストであり、**D1 実装者は契約 1 の半分を破ったまま「適合」を名乗れる**。しかもその半分は Issue #16 の見出しのシナリオそのもの（表構成を変えるデプロイをまたいで次の cron が run を resume する）で、破れば lane の `tableIndex` が別の表を指し、cursor が別 keyset の途中を指す静かな取りこぼしになる。CLAUDE.md「契約に振る舞いを足すならポート JSDoc と conformance の両方を触る」／ADR 026・046 に反する状態が、まさに「対で置く」と宣言した契約の中に残っている
  - 提案: 当該ケースの `setMaintenanceTables` の直後に resume を 1 回挟む。`const resumed = await begin("run-2", "owner-a"); expect(resumed.runId).toBe("run-1"); expect(resumed.result).toBe("resumed");` を入れてから `advanceOrAck` すれば、上の変異は赤になる（同一 owner・lease 内の resume なので claim は保たれ、既存のアサーションはそのまま使える）。ADR 061 の Consequences が挙げるスキーマ要件も、この 1 ケースで実行形を得る

### Warnings

- **[W-001]** 契約 2 に新設した `asOf` の 3 つの主張のうち、拘束されているのは `advanceOrAck` 経路の 1 つだけ。残り 2 つ（`claimLanes` が返す lane の `asOf`、`checkpointLane` の `asOf` 入力が run の境界を上書きしないこと）はどちらも変異させてリポジトリ全体が緑のまま
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:53-58`（契約）／`packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:126`（ADP-common-027）・`:183`（ADP-common-028）
  - 理由: JSDoc は「`asOf` is the **run's own boundary, fixed on the run row when the run was created**: **every lane of a run carries that one value**, and neither the wall clock at claim / ack time nor **`checkpointLane`'s `asOf` input** overwrites it」と書き、`spec/domains/index.md` も「runのどのlaneも同じ値を運び、claim / ack時の壁時計も`checkpointLane`の`asOf`入力もこれを上書きしない」と主語を全 lane に取っている。確認した変異は次の 2 つ:
    1. `claimLanes` の戻り値だけ `asOf: new Date(clock.now() + 987654)` に差し替え → 適合スイート **17 passed**（ADP-common-027 は `table` / `cursor` / `commandKey` は見るが `asOf` を一切見ない）
    2. `checkpointLane` が `run.asOf` を `input.asOf` で上書き → `packages/core` 全体 **909 passed**（既存ケースはどれも `lane.asOf` / `started.asOf` をそのまま渡すので、上書きしても値が変わらない）

    `advanceOrAck` 側は R3 で `backend.clock.advance(MINUTE_MS)` を入れたおかげで実効的になっている（`toLane` の `asOf: run.asOf` を `clock.now()` に変異させると 3 件赤）ので、抜けているのは残り 2 経路だけ。lane が run と違う境界を運ぶと別 keyset を掃く、という被害は JSDoc 自身が書いているとおりで、拘束しないと D1 実装者が lane 行に `as_of` 列を持って checkpoint 入力で更新する実装を書ける
  - 提案: (1) ADP-common-027 に `backend.clock.advance(MINUTE_MS)` を足したうえで `expect(lane.asOf).toEqual(started.asOf)` を 1 行。(2) ADP-common-029 の staged lane の `checkpointLane` に渡す `asOf` を `new Date(started.asOf.getTime() + MINUTE_MS)` のように**ずらし**、自動 claim で返る lane の `asOf` がなお `started.asOf` であることを見る（fixture の追加は不要で、既に checkpoint を打っているケースが 2 つある）

### 実効性の確認（変異テスト）

R3 で追加・変更された適合ケースについて、memory 実装を変異させて赤くなることを実測した。**作業ツリーは全変異とも即時に `git checkout --` で復元済み**（最終確認: `git status --short` に本 PR 由来の変更なし）。

| 変異（memory `globalMaintenanceRunStore.ts`） | 結果 |
|---|---|
| 次表 step 時に `commandKey` を再 mint しない | 赤 3 件（ADP-common-027 派生 / 029 / 029 表集合） |
| 自動 claim で `commandKey` を再 mint する | 赤 2 件（029 / 029 released lane） |
| `toLane` の `asOf` を `clock.now()` にする | 赤 3 件 |
| 解放（`completed: false`）が pending lane を claim して返す | 赤 1 件（029 release） |
| 走査を `run.tables` でなく配備の設定で行う | 赤 1 件（029 表集合） |
| 自動 claim が `tableIndex: 0` に巻き戻す | 赤 1 件（029 released lane） |
| step した lane を `pending` のままにする | 赤 9 件 |
| 自動 claim した lane を `claimed` にしない | 赤 3 件 |
| pending 不在を無条件に `runCompleted: true` とする | 赤 1 件（029 no-pending）＋ 031 の 2 件 |
| step 時に cursor を引き継ぐ（`cursor: null` にしない） | 赤 1 件（029） |
| resume 時に表集合を再スナップショットする | **緑（B-001）** |
| `claimLanes` の `asOf` を別値にする | **緑（W-001）** |
| `checkpointLane` の `asOf` 入力で run の境界を上書きする | **緑（W-001）** |

R2 で問題になった「assert はあるが変異させても緑」の形骸化は、上表のとおり **`advanceOrAck` の応答形状（契約 2・3(a)・3(b)・4）については解消している**。特に `backend.clock.advance(MINUTE_MS)` の導入で `asOf` のアサーションが実効化し、規則外の `command-off-rule` を staged lane に置く fixture で 3(b) が実効化している。残る緑は上の B-001 / W-001 の 3 件。

### その他の確認（指摘なし）

- **`setMaintenanceTables` の必須メンバー化**: 枠組みとして妥当。`seedMembershipEdges?` の「実装できない backend はケースを skip」パターンと違い、skip を許すと「契約 1 未検証のまま conformant」を許すことになるため、必須化の判断は正しい。D1 でも表集合はストア生成時の設定として注入される想定（`MemoryBackendOptions.maintenanceTablesByKind` と同型）なので、可変な保持箱を conformance backend 側に置けば実装できる。値スロットを書き換えるだけで既存 run 行のスナップショットに触れない、という memory 実装も契約どおり（`beginOrResumeKind` が新規 run のときだけ読む）。なお B-001 を直しても `setMaintenanceTables` の署名・必須性は変えなくてよい
- **memory 実装の分岐ごとの lane**: 次表 step は `cursor: null` ＋ 再 mint、自動 claim は `tableIndex` / `cursor` / `commandKey` を保持、解放は `pending` に戻して `null`、pending 不在は `runCompleted = every done` — すべて契約 2 / 3 / 4 と一致
- **並行性・冪等性・at-least-once**: ack の応答で lane を chain する変更後も、invocation が落ちた lane は lease 失効 → `beginOrResumeKind` の `reclaimLapsedLanes` で回収される経路が維持されている。自動 claim が `commandKey` を保つので、checkpoint 時に Queue へ載せた継続要求との重複排除も畳める（3(b) は ADP-common-028 と 029 の両方で拘束されている）。`MAX_ACTIVE_LANES` は ack が「1 件 done ＋ 1 件 claim」で active 数を増やさないため不変
- **`terminalPrune`**: `advanced.next` を `MaintenanceLane` に広げても即時解放の挙動は不変（`release` は `{ generation, shardId }` しか見ない）。ADR 061 の Consequences に 2 呼び出し元の方針差の根拠が残されている
- **コメント**: 弁明・修正経緯の残骸は見当たらない。`clock.advance` の意図、staged fixture の意図、`workRemains = true` が観測できない理由はいずれも非自明な WHY で、計画の「引き継ぐ」指示どおり

### カバレッジ

一覧ファイル `16-names-003.txt` の実エントリは **36 件**（37 行目は空行）。以下で 36 件すべてを対応させる。

- 確認: `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/di/types.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/platform/index.md`
- スキップ: `.thread/16/adr.md` — 作業スレッドの検討記録で、ポート契約・適合スイートの正本ではない
- スキップ: `.thread/16/plan.md` — 受け入れ基準として参照はしたが、レビュー対象の成果物ではない
- スキップ: `.thread/16/steps.md` — 実装手順の作業記録で観点外
- スキップ: `.thread/16/testing.md` — 動作検証の観測記録で観点外
- スキップ: `.thread/16/review/review-001.md` — 過去ラウンドのレビュー記録（ゼロベース評価のため前提にしない）
- スキップ: `.thread/16/review/review-001-adapter.md` — 同上
- スキップ: `.thread/16/review/review-001-spec.md` — 同上
- スキップ: `.thread/16/review/review-001-usecase.md` — 同上
- スキップ: `.thread/16/review/review-002.md` — 同上
- スキップ: `.thread/16/review/review-002-adapter.md` — 同上
- スキップ: `.thread/16/review/review-002-spec.md` — 同上
- スキップ: `.thread/16/review/review-002-usecase.md` — 同上
- スキップ: `.thread/16/review/triage.md` — 既出判定の作業記録
- スキップ: `.thread/16/review/triage-keys.md` — 既出判定として参照したが、レビュー対象の成果物ではない
- スキップ: `spec/inventory/test.md` — テストケース台帳の文言更新で、ポート契約・適合スイートの主張を含まない（台帳規約は spec 観点）
- スキップ: `spec/inventory/usecase.md` — UC 行の文言更新で usecase 観点
- スキップ: `spec/testcases/identity/pruneExpiredAuthState.md` — usecase のテストケース定義で usecase 観点
- スキップ: `spec/usecases/identity.md` — usecase の処理フロー / エラー表で usecase 観点
- スキップ: `spec/usecases/job.md` — 同上（`jobTombstonePrune` の記述で、本 PR にポート実装の変更なし）
