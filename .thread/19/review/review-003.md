# PR Review #003 — feat(core): ScopeTask に priority と lease を入れる

**PR:** #40
**Date:** 2026-08-24
**Round:** 3回目

## Summary

- Blockers: 2
- Warnings: 11
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Port Contract & Application: review-003-port-application.md（B: 0 / W: 4）
- Adapter: review-003-adapter.md（B: 2 / W: 2）
- Runtime Wiring: review-003-runtime.md（B: 0 / W: 2）
- Spec 整合性: review-003-spec.md（B: 0 / W: 3）

## カバレッジ

- 確認申告ゼロのファイル: なし

## 指摘一覧

- [B-001] conformance/scopeTaskScheduler.ts:371,524-526 / 契約未拘束 — schedule が attempt を 0 に戻すことが未拘束（Adapter）
- [B-002] conformance/scopeTaskScheduler.ts:499-527 / 契約未拘束 — 「failed を戻せるのは schedule だけ」の backoffOrSchedule 側が未拘束（Adapter）
- [W-001] ports/scopeTaskScheduler.ts:85-101 / 契約の自足性 — claimDue の返却件数上限が未定義語 "budget" に依存（Port）
- [W-002] workers/scopeTaskRunner.ts:158-160 / コメントと実装の不一致 — 「claim した行は必ず processed」が no-handler 分岐と矛盾（Port）
- [W-003] ports/scopeTaskScheduler.ts:66-157 / JSDoc 重複 — fencing 注意が2か所、backoff/failed 規則が遷移表と散文で二重、claim 不変条件が3か所（Port）
- [W-004] ports/scopeTaskScheduler.ts:76-80 / 保存表現の漏れ — D1 スキーマの列名がポート契約に埋め込まれている（Port）
- [W-001] conformance/scopeTaskScheduler.ts:471-497 / 契約未拘束 — backoffOrSchedule の mint が input.priority を使うことが未拘束（Adapter）
- [W-002] conformance/scopeTaskScheduler.ts:555-605 / テストの焦点 — listDue のリース失効復帰が別ケースの末尾に同居（Adapter）
- [W-001] docs/runtime_node.md:102 / docs-vs-implementation — 「最古 dueAt age で測れ」が観測面の無いこの runtime で実行不能（Runtime）
- [W-002] .env.example:78-81 + docs:69 / ツマミ説明の実効性 — 単一プロセスで起こり得ない危険だけを根拠にし、効く配備の数字が無い（Runtime）
- [W-001] spec/platform/index.md:186 / spec 文言 — リース帯の下限の因果が入れ替わり、同段落が7件の規則を抱える（Spec）
- [W-002] spec/database/index.md:976 / 索引 — 失効 running 側が選択順の索引を失い「併合する」だけでは導けない（Spec）
- [W-003] docs/runtime_node.md:69 + .env.example:76-81 / 既定値の説明 — 参照ランタイムで起こりえない再武装を根拠に据えている（Spec）
