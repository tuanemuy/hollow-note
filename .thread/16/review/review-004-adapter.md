# レビュー 004 — Adapter / 適合スイート

## Adapter / 適合スイート

### Blockers

- **[B-001] 契約 1 の適合ケースは `setMaintenanceTables` を no-op にしただけで緑を保つ（拘束が空振りする）**
  - **場所:** `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:513-557`（`ADP-common-029: an ack walks the table set the run was created with, not the deployment's current one, across a resume`）、`packages/core/src/adapters/conformance/backend.ts:124-135`（`setMaintenanceTables` の JSDoc）
  - **問題:** このケースは `setMaintenanceTables("authStatePrune", ["t9","t8","t7"])` を呼んだあと、run が **旧い集合**（`t1` / `t2`）どおりに歩くことだけを検査する。`setMaintenanceTables` が実際に配備の表集合を差し替えたかを観測する assertion が 1 つも無いため、**この呼び出しが何もしなくても全アサーションが通る**。実際に `adapters/memory/__tests__/conformanceBackend.ts:158-169` の本体を `void kind; void tables;` に置き換えて実行すると、`GlobalMaintenanceRunStore conformance [memory]` は **17 件すべて緑のまま**（`Tests 17 passed | 221 skipped`）だった（確認後、作業ツリーは元に戻し `git status` がクリーンであることを確認済み）。
  - **理由:** `backend.ts` の JSDoc は「Required: it is the only way the suite can pin the run's snapshot ... so a backend without it would report "conformant" having never verified contract 1」と、この必須メンバーの存在理由を「契約 1 に実行形を与えるため」と明言している。ところが**空実装のメンバーを持つバックエンドも同じく「契約 1 を一度も検証しないまま conformant を名乗る」**ため、必須化が目的を果たしていない。しかも空実装はスタブとして最も書きやすい形（配備の表集合を実行時に差し替えにくいバックエンドほど、そこへ倒れる）で、対象は本 PR がまさに想定している Issue #11 の D1 実装者である。ADR 026（契約の正本はポート定義、検証は共有スイート）と ADR 046（契約の記述が実行形にしかない状態を作らない）に照らすと、契約 1 — 本 Issue の主題そのもの — だけが実効性の担保を欠いた状態で全バックエンドへ配られる。
  - **提案:** 同じケースの末尾に「差し替えが効いていること」を 1 度だけ観測する。run-1 を完走させてから新しい run を始め、その lane が新しい集合の先頭表に立つことを見れば足りる（no-op 実装ならここで落ちる）。例:

    ```ts
    // The replacement really landed: the *next* run — created after the
    // deploy — starts on the new set. Without this, a backend whose
    // `setMaintenanceTables` does nothing passes this case having never
    // exercised contract 1.
    await completeLane("run-1", "owner-a", secondShard.generation, secondShard.shardId);
    const afterDeploy = await begin("run-3", "owner-a");
    expect(afterDeploy.result).toBe("started");
    const fresh = await store.claimLanes(afterDeploy.runId, "owner-a", 6);
    expect(fresh.map((lane) => lane.table)).toEqual(["t9", "t9"]);
    ```

    （`secondShard` は `afterShard.next` を受けて claimed になっている lane。上の形にするなら現行の `afterShard.next?.table` の assertion の直後に足す。）あわせて `backend.ts` の JSDoc の「Required」の根拠を、空実装では契約 1 が検証されないままになる点まで含めて書くか、上の観測が入ることで初めて成立する記述に直す。

### Warnings

なし

### カバレッジ

- 確認: `.thread/16/adr.md`, `.thread/16/plan.md`, `.thread/16/review/triage-keys.md`, `.thread/16/steps.md`, `.thread/16/testing.md`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/platform/index.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`
- スキップ: `.thread/16/review/review-001-adapter.md`, `.thread/16/review/review-001-spec.md`, `.thread/16/review/review-001-usecase.md`, `.thread/16/review/review-001.md`, `.thread/16/review/review-002-adapter.md`, `.thread/16/review/review-002-spec.md`, `.thread/16/review/review-002-usecase.md`, `.thread/16/review/review-002.md`, `.thread/16/review/review-003-adapter.md`, `.thread/16/review/review-003-spec.md`, `.thread/16/review/review-003-usecase.md` — 過去ラウンドのレビュー記録。今回は**ゼロベース**で見る指示のため、前回の指摘を前提にしないよう意図的に読まなかった
- スキップ: `.thread/16/review/triage.md` — 既出判定の元台帳。判定結果は `triage-keys.md`（`wont-fix` / `defer` の薄いビュー）で足り、そちらは確認済み

### 検証メモ（変異で潰した観点）

memory 実装に次の変異を入れ、いずれも適合スイートが赤くなることを実測した（すべて確認後に復元、`git status` クリーン）。

| 変異 | 結果 |
| --- | --- |
| `beginOrResumeKind` の resume 分岐で `tables` を配備の設定から取り直す | 赤（契約 1） |
| `toLane` の `asOf` を `run.asOf` → `clock.now()` | 赤（4 件、契約 2） |
| `checkpointLane` が入力の `asOf` で run 行の `asOf` を上書き | 赤（契約 2） |
| 別 shard 自動 claim で `commandKey` を再 mint | 赤（契約 3(b)） |
| 別 shard 自動 claim で `tableIndex` を 0 に戻す | 赤（契約 2） |
| `claimLanes` が `commandKey` を再 mint | 赤（契約 3(b)） |
| 同一 lane の次表で `cursor` を引き継ぐ | 赤（契約 2） |
| 解放（`completed: false`）が pending lane を claim して返す | 赤（契約 2・AC-8） |
| 引き渡す pending が無いとき `runCompleted` を常に true | 赤（3 件、契約 2） |
| `checkpointLane` の表不一致ガードを外す | 赤（ADP-common-028） |
| `setMaintenanceTables` を no-op | **緑（→ B-001）** |

そのほか確認した点（いずれも問題なし）:

- ポート JSDoc の契約 1〜4 と適合スイートの対応は両方向とも埋まっている。スイートが拘束していて JSDoc に無い挙動、JSDoc にあってスイートが拘束していない挙動は、B-001 を除いて見つからなかった。
- `advanceOrAck` の応答形状変更による他の呼び出し元への波及: `terminalPrune.runCron` は `release(advanced.next)` を構造的部分型のまま維持し、自動 claim 済み lane を即座に解放して返す挙動が変わっていない（`deleteAccount.terminalPrune.test.ts` 7 件緑）。`outboxPrune.test.ts` のスタブ（`next: null`）も緑。
- 未知表 skip 経路の claimed lane の後始末: `inFlight = null` と `laneQueue.push(advanced.next)` の順序により、budget 打ち切り・throw のどちらでも `finally` の一括解放が拾う。契約 4（返った lane は claimed）を cron 経路が破っていない。
- 冪等性・at-least-once: `commandKey` の mint 主体の分岐（store が作った position は導出キー一致、既存 position は永続化済みキーをそのまま）が Queue の重複排除を畳める形で契約・スイート・memory 実装の 3 つで一致している。
- コード・コメントに指摘への弁明や修正経緯の痕跡は無い。`conformanceBackend.ts` の「値スロットを書き換え可能に保つのが load-bearing」と `backend.ts` の「Required の理由」は、いずれも why / why-not として妥当な範囲。
- リポジトリ全体: `grep -rn "SWEEP_ORDER" packages apps` は 0 件、`npx vitest run` は 76 files / 978 passed / 3 skipped（`testing.md` の期待値どおり）。
