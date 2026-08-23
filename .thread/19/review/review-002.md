# PR Review #002 — feat(core): ScopeTask に priority と lease を入れる

**PR:** #40
**Date:** 2026-08-24
**Round:** 2回目

## Summary

- Blockers: 3
- Warnings: 13
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Port Contract & Application: review-002-port-application.md（B: 1 / W: 3）
- Adapter: review-002-adapter.md（B: 2 / W: 3）
- Runtime Wiring: review-002-runtime.md（B: 0 / W: 3）
- Spec 整合性: review-002-spec.md（B: 0 / W: 4）

## カバレッジ

- 確認申告ゼロのファイル: なし

## 指摘一覧

- [B-001] ports/scopeTaskScheduler.ts:59-63 / port-contract — claimDue の相互排除が契約に無く、scopeTaskQueue が削除済みの "serialization rule" を参照（Port）
- [B-001] conformance/scopeTaskScheduler.ts:361-377 / 適合スイートの拘束力 — complete が running 行を消すことが未拘束（Adapter）
- [B-002] conformance/scopeTaskScheduler.ts:525-559 / 適合スイートの拘束力 — 「リース失効後に listDue へ戻る」が未拘束（Adapter）
- [W-001] ports/scopeTaskScheduler.ts:92 / port-contract — backoffOrSchedule の payload の扱いが未規定（Port）
- [W-002] ports/scopeTaskScheduler.ts:43-44,122-132 / contract-completeness — 既定5分が spec/platform の age SLO 1分に反する（Port）
- [W-003] conformance/scopeTaskScheduler.ts:54-55 / test-coverage — leaseMs を非既定値で呼ぶテストが皆無（Port）
- [W-001] conformance/scopeTaskScheduler.ts:54-55 / leaseMs — 同上（Adapter）
- [W-002] ports/scopeTaskScheduler.ts:91 / 遷移表 — 「failed 行への backoff は failed のまま」が未拘束（Adapter）
- [W-003] conformance/scopeTaskScheduler.ts:146-168 / テストの実効性 — 予約枠のケースが原理的に予約枠を検証できない（Adapter）
- [W-001] di/serverNode.ts:118-144 / scope-creep + test-coverage — 「空文字 = 未設定」が既存 OUTBOX_* 4変数にも及びテストが無い（Runtime）
- [W-002] apps/web/app/server.node.ts:137-138 / consistency — PORT / HOSTNAME が逆の読みのまま（Runtime）
- [W-003] docs/runtime_node.md:90-129 / docs — 未処理 kind の再来周期 1秒→5分が運用ドキュメントに未追随（Runtime）
- [W-001] spec/platform/index.md:186 / 契約と実装の不一致 — 「yield 時に未処理の claim を残さない」が AC-11 の挙動と字義上両立しない（Spec）
- [W-002] spec/platform/index.md:186 / 既定値との不整合 — リース選定の帯の上限を既定5分が満たしていない（Spec）
- [W-003] spec/database:972 ↔ spec/platform:177,184 / 正本の重複 — Alarm 起床式が2ファイル3か所に平文で並ぶ（Spec）
- [W-004] spec/database/index.md:976 / 索引の非対称 — dequeue 用索引だけ無述語で failed 行が積もる（Spec）
