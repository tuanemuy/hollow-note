# PR Review #001 — feat(core): ScopeTask に priority と lease を入れる

**PR:** #40
**Date:** 2026-08-24
**Round:** 1回目

## Summary

- Blockers: 3
- Warnings: 20
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Port Contract & Application: review-001-port-application.md（B: 1 / W: 3）
- Adapter: review-001-adapter.md（B: 0 / W: 8）
- Runtime Wiring: review-001-runtime.md（B: 0 / W: 3）
- Spec 整合性: review-001-spec.md（B: 2 / W: 6）

## カバレッジ

- 確認申告ゼロのファイル: なし

## 指摘一覧

- [B-001] conformance/scopeTaskScheduler.ts:326 / port-conformance — running 行への backoffOrSchedule が未拘束（Port）
- [B-001] spec/database/index.md:35 / Alarm 起床規則 — 「due_at 索引で次の Alarm」が改訂から取り残され同ファイル内で矛盾（Spec）
- [B-002] spec/platform/index.md:184-186 / budget × lease — yield 残件が「次 Alarm で即継続」から「リース期間ぶん停止」に変わる帰結が spec に無い（Spec）
- [W-001] ports/scopeTaskScheduler.ts:61-67 / contract-self-sufficiency — リース失効境界が JSDoc から読めない（Port）
- [W-002] conformance/scopeTaskScheduler.ts:249-272 / test-strength — reclaim の attempt/priority assert が既定値と同値で無力（Port）
- [W-003] spec/platform/index.md:177 / spec-consistency — 行タプルに lease_expires_at が無い（Port）
- [W-001] conformance/scopeTaskScheduler.ts:249-268 / 適合スイート — reclaim 行が新リースを取ることを未拘束（Adapter）
- [W-002] ports/scopeTaskScheduler.ts:60-67 / 契約とスイートの乖離 — 失効境界の包含性が JSDoc に無い（Adapter）
- [W-003] conformance/scopeTaskScheduler.ts / カバレッジ欠落 — kind/operationId タイブレークが未拘束（Adapter）
- [W-004] memory/__tests__/unitOfWork.test.ts:96-106 / テストの実効性 — claim が空表で自明成立、ロールバックケース無し（Adapter）
- [W-005] ports/scopeTaskQueue.ts:26-32 / 契約 — listDue の順序が scope 横断で全順序でない（Adapter）
- [W-006] conformance/scopeTaskScheduler.ts:236-247 / カバレッジ欠落 — リース不可視性が単一 scope のみ（Adapter）
- [W-007] ports/scopeTaskScheduler.ts:85-91 / 遷移表の穴 — failed 始点の backoff 系が表に無い（Adapter）
- [W-008] memory/repositories/scopeTaskScheduler.ts:79-93 / 防御コピー — Date インスタンスを素通し（Adapter）
- [W-001] docs/runtime_node.md:58-71 / documentation — SCOPE_TASK_LEASE_MS が env 表に無い（Runtime）
- [W-002] di/env.ts:33-35 / operability — zod issue path が leaseMs で OUTBOX と区別不能（Runtime）
- [W-003] di/serverNode.ts:133-135 / env-boundary — 空文字が「不正値」扱いで既存の慣行と非対称（Runtime）
- [W-001] spec/database/index.md:972 / due_at の意味論 — 「状態によらず」が failed まで含み行型と矛盾（Spec）
- [W-002] spec/platform/index.md:177 / 列挙 — status / lease_expires_at が列挙に無い（Spec）
- [W-003] spec/database/index.md:976 / 索引 — Alarm 時刻用索引が status を持たず failed 行が溜まる（Spec）
- [W-004] spec/database/index.md:976 / 命名 — 用途名 2 本と物理名 1 本の混在（Spec）
- [W-005] spec/platform/index.md:186 / lease と SLO — 既定 5 分と age 1 分 SLO の関係が spec に無い（Spec）
- [W-006] docs/runtime_node.md:58-71 / env 表 — SCOPE_TASK_LEASE_MS が配備側ドキュメントに未記載（Spec）
