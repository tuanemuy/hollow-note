# レビュー 003 — Spec canon

対象: PR #45 / ベース `main` / 差分 `16-round-003.diff`（変更ファイル 36 件。指示にあった 37 件は `16-names-003.txt` の実測と一致せず、本レビューは一覧の 36 件と 1 対 1 で対応させた）

## Spec canon

### Blockers

- **[B-001]** ADR 061 の契約 4 の最後の一文が、同じ契約を定めるポート JSDoc・両 usecase の実装と食い違っている
  - 場所: `spec/adr/061-maintenance-sweep-order-authority.md:24`（「単発の継続 turn は、返った lane を claimed のまま次の継続へ引き渡す」）
  - 理由: この一文は「継続 turn が返った lane を次の継続へ引き渡す」ことを現在有効な契約として述べているが、実装はそうなっていない。`packages/core/src/application/ports/globalMaintenanceRunStore.ts:92-99` は同じ契約 4 を「単発の継続 turn は driver ではなく、最終 ack の lane を次の turn へ引き渡すことは**今日は不可能**（position が usecase の外へ出ない）。その lane はリース失効まで claimed のまま置かれ、cron が回収する」と書いている。実装も同じで、`pruneExpiredAuthState.ts:198-206` と `deleteAccount/terminalPrune.ts:128-135` の継続経路はいずれも `advanced.next` を `!== null` の真偽にしか使わず、lane を捨てている（本 PR で両 usecase の Runtime wiring note にその旨を 1 行ずつ追記している）。`.thread/16/plan.md:39` も「引き渡し先を決められるのは Queue 配線のスライス」としてスコープ外と明言している。
    さらに、ポート JSDoc は契約 1–4 の出典として `spec/adr/061` を名指している（`globalMaintenanceRunStore.ts:53` の `(Contracts 1–4: spec/adr/061.)`）。CLAUDE.md が定めるとおり `spec/` は「コードに対して真であることを意図した canon」であり、ADR 026 / 046 の前提の下では、参照元（JSDoc）と参照先（ADR）が契約 4 で割れている状態は、D1 実装者にとって「継続 turn は lane を引き渡す」と読める最悪の側に倒れる。この PR が塞ぎに来た「誰も駆動しない claimed lane」の入口そのものである。
  - 提案: 契約 4 の最終文を、ポート JSDoc と同じ現状記述へ揃える。例: 「**lane を駆動する呼び出し側**（cron 経路）は、それを処理するか解放する責務を負う。単発の継続 turn は driver ではなく、返った lane を次の継続へ引き渡す手段を今日は持たない（position が usecase の外に出ず、view は `continued` しか運ばない）。その lane はリース失効まで claimed のまま残り、後続の cron が回収する — これを引き渡しへ変えるのは Queue producer の配線と対で行う」。加えて `spec/adr/index.md:128` の 061 行の「設計上の境界」欄は契約 4 に触れていないため、そちらの修正は不要。

### Warnings

- **[W-001]** 契約 2 に新しく入った「run のどの lane も run 行の `asOf` を運ぶ」が、`claimLanes` 経路については適合スイートに実行形を持たない
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:55-60` / `spec/adr/061-maintenance-sweep-order-authority.md:22` / `spec/domains/index.md:152`、対応するスイートは `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:126-176`
  - 理由: 本 PR は「`asOf` は run 生成時に run 行へ固定された run 自身の境界で、**run のどの lane も同じ値を運ぶ**。claim / ack 時の壁時計も `checkpointLane` の `asOf` 入力もこれを上書きしない」を 3 か所（ポート JSDoc・ADR 061・domains）に canon として追加した。スイート側は ADP-common-029 の 3 ケースで `advanceOrAck` が返す lane の `asOf` を `started.asOf` と突き合わせており（そのために `backend.clock.advance(MINUTE_MS)` まで入れている）、`advanceOrAck` 経路は拘束されている。一方 ADP-common-027 の `claimLanes` ケース（`:126-139`）は `generation` / `table` / `cursor` / `commandKey` を見るだけで `asOf` を見ていない。claim 時に `now()` をスタンプするバックエンドは今のスイートを通過してしまう。CLAUDE.md の「契約に振る舞いを足すならポート JSDoc と conformance の両方を触る」（ADR 026）に対して、この一文だけ片側が薄い。同じ文が `claimLanes` を含む全 lane に及ぶことは domains 152 行が「runのどのlaneも同じ値を運び」と明示している以上、解釈の余地はない。
  - 提案: ADP-common-027 の claim ループに `expect(lane.asOf).toEqual(started.asOf)` を 1 行足す（`begin()` の戻り値を受け、`claimLanes` の前に `backend.clock.advance(MINUTE_MS)` を置けば ADP-common-029 と同じ強度になる）。

- **[W-002]** ADR 062 の「前提」節と `spec/adr/index.md` の前提依存マップが食い違っている
  - 場所: `spec/adr/062-unknown-sweep-table-skip.md:16` と `spec/adr/index.md:129`
  - 理由: マップの 062 行は依存する前提を「表集合のスナップショットが run 単位で resume 中も動かないこと（061）、**参照ランタイムが 1 つであること（025）**」と書くが、ADR 本文の「前提」節は 061 しか挙げていない。既存 ADR（例: 060 の本文「前提」節とマップ 127 行、046 の本文とマップ 113 行）はいずれも本文の前提節とマップの列が 1 対 1 に対応しており、この PR の 061 も対応している。062 だけが非対称で、マップだけを読む読者と ADR 本文だけを読む読者で前提集合が変わる。なお 025 が前提であること自体は本文の「影響」節（残存条件を塞がない根拠）が実際に依拠しているので、直す向きは本文側。
  - 提案: 062 の「前提」節に 025 を足す。例: 「表集合のスナップショットが run 単位で、resume 中も動かないこと（[ADR 061](./061-maintenance-sweep-order-authority.md)）。参照ランタイムが Node + in-memory の 1 つであること（[ADR 025](./025-single-reference-runtime.md)）— 残存条件を塞ぐ起動時ガードが到達不能な失敗モードへの防具になる根拠がここにある。」

### 受け入れ基準の確認（spec 関連のみ）

- AC-9: `spec/domains/index.md:138`（署名）/ `:152`（本文）、`spec/database/index.md:159-161`（run 行が順序付き表集合を持ち、lane は index、checkpoint は「表は進めない」position ベース）、`spec/inventory/domain.md:38` DOM-common-030、`spec/inventory/adapter.md:37` ADP-common-029、`spec/inventory/usecase.md:33` UC-identity-021、`spec/usecases/identity.md:879` 手順 2 と `:893` エラーケース表 — すべて新契約と一致。**充足**。
- AC-10: 061 / 062 が起票され、`spec/adr/index.md` の一覧（66-67 行）と前提依存マップ（128-129 行）の両方に登録済み。026 / 046 との前提関係も記述あり。ただし 062 の前提記述に W-002 の非対称がある。**条件付きで充足**。
- AC-11: `spec/testcases/identity/pruneExpiredAuthState.md` に 3 行（34-36 行）追加、`spec/inventory/test.md` に TC-identity-347..349（488-490 行）を identity 群の末尾に採番（ADR 052 の「ID は行位置ではない」に適合）。TC-identity-165 の写しも本文 20 行と同じ新しい文言へ更新済みで、本文と台帳の片側だけを直していない。本文 32 行 = 台帳 32 行で 1 対 1。テストコード側の `it` 名も TC ID を名乗っている（ADR 058 は推奨、要求ではない）。**充足**。
- AC-12（spec 側の帰結）: `MaintenanceLane.generation` が routing 世代であることの型 JSDoc、両 usecase の Runtime wiring note の 1 行が入っている。ただし契約 4 の記述と ADR の記述の一致は B-001 のとおり破れている。
- スコープ逸脱: 無し。`spec/usecases/identity.md` の「4 種」表記や出力 DTO の既存乖離は `.thread/16/plan.md:44` の線引きどおり手つかずで、本 PR が偽にした文（手順 2 / エラーケース表 / testcases 20 行）だけを直している。`triage-keys.md` の `wont-fix` を蒸し返してもいない。

### 変更されなかった spec の残存偽記述の網羅走査

`spec/` 全文に対して `advanceOrAck` / `表順` / `次表` / `次table` / `table/cursor` / `cursor/command key` / `command key` / `maintenance` / `lane` / `SWEEP_ORDER` を走査した。

- `spec/usecases/job.md:551` と `spec/platform/index.md:207` は本ラウンドで是正済み（checkpoint が position ベースになり、ack が返す position をそのまま処理する記述に更新）。
- `spec/testcases/job/pruneJobHistory.md:31` / `spec/inventory/test.md:858`（TC-job-175）は「次cursor/command key と Queue outbox を保存する」としか書いておらず、表を進める主体に触れていないため偽にならない。
- `spec/inventory/{domain,adapter}.md` の checkpointLane 行（DOM-common-029 / ADP-common-028）も同様に「cursor と次 command key」だけで、表に触れていない。
- `spec/domains/index.md:298,300` の継続要求 payload（`{ runId, generation, shardId, table, cursor, asOf }`）は継続入力の形であって表順の正本ではなく、実装（`identity.authStatePruneContinued`）と一致。
- `spec/testcases/identity/pruneExpiredAuthState.md:29` / TC-identity-174 の「同じrun/table/cursor position」はリース回復の話で、run 側の position を保つ主張なので新契約と整合。
- `docs/`（`runtime_node.md` / `test.md`）に表順・ack 応答形状に依存する記述は無い。
- `grep -rn "SWEEP_ORDER" packages apps` は 0 件（AC-2）。

### コード JSDoc から spec を引いている箇所の照合

- `packages/core/src/application/ports/globalMaintenanceRunStore.ts:65` → `spec/adr/061`: 契約 1 / 2 / 3(a)(b) は ADR と一致。**契約 4 のみ不一致（B-001）**。
- `packages/core/src/application/identity/pruneExpiredAuthState.ts:115`（usecase JSDoc）と `:315`（実装コメント）→ `spec/adr/062`: 「未知表は ack で飛ばす・失敗に数えない・ログが唯一の痕跡・継続 turn は前進せず後続 cron が同じ skip で回収」はいずれも ADR 062 の決定・影響と一致。実装（`:316-334` のログ payload `table` / `runId` / `generation` / `shardId`、`commands += 1`、`completed: true`、`failures` に加算しない、返った position を `laneQueue` に載せる）とも一致。
- `packages/core/src/application/di/types.ts:201-207` → `spec/adr/062`: 「union は呼び出し箇所で型エラーにするが、run の表集合から届く表は実行時 skip」は ADR 062 の影響 2 番目の bullet と一致。
- ADR 061 影響の「引き継ぎ」（2 つの呼び出し元で方針が正反対）は実コードと一致（`pruneExpiredAuthState` は `laneQueue.push(advanced.next)` で chain、`terminalPrune` は `release(advanced.next)`）。
- ADR 061 契約 3(a) の「run 生成時に各 lane が立つ先頭 position」は memory 実装（`beginOrResumeKind` が `commandKeyOf(candidateRunId, lane, tables[0])`）と、スイートの `virgin.commandKey === commandKeyOf(...)` で対になっている。契約 3(b) は `claimLanes` 側（ADP-common-028 の `resumedLane.commandKey === "command-2"`）と自動 claim 側（`"command-off-rule"`）の両方で拘束されている。
- 契約 1 は `ConformanceBackend.setMaintenanceTables` を必須メンバーにしたうえで「run 生成後に表集合を差し替えても走査順が動かない」ケースで拘束されており、ADR 061 契約 1 に実行形がある。

## カバレッジ

- 確認: `.thread/16/plan.md`, `.thread/16/review/triage-keys.md`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/platform/index.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`
- スキップ: `.thread/16/adr.md` — 検討の作業記録で、canon は `spec/adr/061` `062` 側にある（そちらは確認済み）
- スキップ: `.thread/16/steps.md` — 実装手順書。spec の canon ではない
- スキップ: `.thread/16/testing.md` — 動作検証の観測記録。spec の canon ではない
- スキップ: `.thread/16/review/review-001.md` — 過去ラウンドのレビュー記録（ゼロベース方針により前提にしない）
- スキップ: `.thread/16/review/review-001-adapter.md` — 同上
- スキップ: `.thread/16/review/review-001-spec.md` — 同上
- スキップ: `.thread/16/review/review-001-usecase.md` — 同上
- スキップ: `.thread/16/review/review-002.md` — 同上
- スキップ: `.thread/16/review/review-002-adapter.md` — 同上
- スキップ: `.thread/16/review/review-002-spec.md` — 同上
- スキップ: `.thread/16/review/review-002-usecase.md` — 同上
- スキップ: `.thread/16/review/triage.md` — 既出判定の詳細版。既出除外は `triage-keys.md` で足りる

（確認 24 件 + スキップ 12 件 = 36 件、変更ファイル一覧と 1 対 1）
