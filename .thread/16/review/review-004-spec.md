# レビュー 004 — Spec canon

## Spec canon

#### Blockers

なし

#### Warnings

なし

### 検証したこと（指摘に至らなかったが確認済みの項目）

- **AC-2（`SWEEP_ORDER` の消滅）**: `grep -rn "SWEEP_ORDER" packages apps spec docs` が 0 件。
- **AC-9（正本と写しの一致）**: `spec/domains/index.md:138` のポート署名（`next` に `table` / `cursor` / `asOf` / `commandKey`）、同 152 行の散文、`spec/database/index.md` の `global_maintenance_runs`（run 単位の順序付き表集合・lane は position（index）・checkpoint は「表を進めない」）、`spec/platform/index.md`（checkpoint を position ベースへ）、`spec/usecases/identity.md` 手順 2 とエラーケース表、`spec/usecases/job.md` 手順 0、`spec/inventory/{domain,adapter,usecase,test}.md` の該当行が、ポート JSDoc / 実装と食い違わないことを 1 行ずつ突き合わせた。`spec/domains/index.md` の `next: null` の 3 分岐は memory 実装（解放・自動 claim 無し・run 完了）と一致する。ポート JSDoc は同じ事実を「2 つの状況」（解放／引き渡せる pending が無い ack）として畳んでいるが、後者が「run 完了」と「他 lane が claimed」を包含する記述になっており、矛盾ではない。
- **ADR 061 / 062 とポート JSDoc・適合スイート・実装の一致**: 契約 1〜4 の 4 点がポート JSDoc に同じ粒度で書かれ、契約 2（解放・引き渡し無しの ack は `next: null`）・契約 3(a)/(b)（store が作った position は導出キー、既存 position は永続化キーをそのまま）・契約 4（駆動側の義務、継続 turn は駆動側でない）が `adapters/conformance/globalMaintenanceRunStore.ts` の ADP-common-029 群に executable form を持つことを確認。契約 3(a) の「run 生成時の先頭 position」も "auto-claims a lane never claimed before" ケースの `commandKey === commandKeyOf(...)` で拘束されている。memory 実装（`toLane` が `run.asOf` を返し、自動 claim が `commandKey` を再 mint しない）とも一致。
- **ADR 061 の「引き継ぎ」記述**: `pruneExpiredAuthState.runCron` が返った lane を chain し、`deleteAccount/terminalPrune.runCron` が自動 claim された lane を即解放する、という記述が実コード（`pruneExpiredAuthState.ts:404` / `terminalPrune.ts:216-219`）と一致する。
- **ADR 062 の事実主張**: 未知表を `advanceOrAck(completed: true)` で飛ばす・`failures` に数えない・ack 1 回を 1 command として予算に数える・ログ payload が `table` / `runId` / `generation` / `shardId`、がすべて `pruneExpiredAuthState.ts:309-334` と一致。残存条件の根拠（`nodeServerEnvToRuntimeOptions` が `oauth` と `deletionTicketKeyRing` しか返さず本番経路は常に `DEFAULT_MAINTENANCE_TABLES`）も `application/di/serverNode.ts:184-199` と `adapters/memory/store.ts:376-386` で裏取り済み。
- **ADR 一覧・前提依存マップ（AC-10）**: `spec/adr/index.md` の一覧に 061 / 062 が末尾採番で載り、前提依存マップに 061（前提: 026 / 046）と 062（前提: 061 / 025）が登録されている。両 ADR ともステータス「承認済み」で、既存 ADR と同じ節構成（コンテキスト / 前提 / 決定 / 検討した代替案 / 影響）を持ち、現在有効な判断として書かれている。
- **台帳と実体の対応（AC-11）**: TC-identity-347..349 が `spec/testcases/identity/pruneExpiredAuthState.md` の新 3 行と 1 対 1 で、実テスト（`pruneExpiredAuthState.test.ts` の同名 `it`）の観測内容とも一致する。TC-identity-165 は本文（20 行目）と台帳の**両方**が同じ新文言に更新されている。ADP-common-029 / DOM-common-030 の説明も同一文言でそろっている（ADR 059 の非対称規則に反しない）。
- **コード JSDoc からの ADR 参照**: `spec/adr/061` / `spec/adr/062` を引く 4 箇所（`ports/globalMaintenanceRunStore.ts:53`、`di/types.ts:206`、`pruneExpiredAuthState.ts:115,315`）の主張が参照先 ADR の記述と一致。`.thread` の ADR-001..006 番号をコードから引いている箇所は無い。
- **変更されなかった spec に偽が残っていないか**: `advanceOrAck` / `maintenance` / `表順` / `lane` / `claimLanes` / `解放して取り直` を spec 全体に grep し、本 PR で偽になった未修正の記述は見つからなかった。`docs/` 側（`runtime_node.md` / `test.md` / `backend_implementation_example.md`）にも本変更で偽になる記述は無い（`ConformanceBackend` のメソッド一覧を写している箇所は無く、`setMaintenanceTables` の追加は写しを持たない）。
- **スコープ**: 差分中の spec 変更はいずれも AC-9 / AC-10 / AC-11 が要求する範囲で、`spec/usecases/identity.md` の「4 種」表記など plan が spec-sync 管轄と切った既存乖離には手を入れていない（triage-keys.md の `wont-fix` と整合）。`spec/testcases/identity/pruneExpiredAuthState.md:17,18` に残る「4 種」も本 PR が偽にした文ではなく、同じ既存乖離。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/platform/index.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`, `.thread/16/plan.md`, `.thread/16/adr.md`, `.thread/16/review/triage-keys.md`
- スキップ: `.thread/16/steps.md` — 実装手順の作業記録で canon ではなく、成果物の真偽は spec / コード側で検証済み
- スキップ: `.thread/16/testing.md` — 動作検証の観測記録で canon ではない
- スキップ: `.thread/16/review/review-001.md`, `.thread/16/review/review-001-adapter.md`, `.thread/16/review/review-001-spec.md`, `.thread/16/review/review-001-usecase.md`, `.thread/16/review/review-002.md`, `.thread/16/review/review-002-adapter.md`, `.thread/16/review/review-002-spec.md`, `.thread/16/review/review-002-usecase.md`, `.thread/16/review/review-003-adapter.md`, `.thread/16/review/review-003-spec.md`, `.thread/16/review/review-003-usecase.md`, `.thread/16/review/triage.md` — 過去ラウンドのレビュー記録。本ラウンドはゼロベースで見る指示のため意図的に読まない（既出判定は `triage-keys.md` のみ参照）

### 参照した差分外ファイル

`CLAUDE.md`, `spec/adr/046-port-contract-divergence.md`, `spec/index.md`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/di/serverNode.ts`, `docs/test.md`, `docs/runtime_node.md`, `docs/backend_implementation_example.md`
