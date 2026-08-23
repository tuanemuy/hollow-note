# PR Review #006 — feat(core): ScopeTask に priority と lease を入れる

**PR:** #40
**Date:** 2026-08-24
**Round:** 6回目（Adapter 観点のみ）

## Summary

- Blockers: 0
- Warnings: 0
- Verdict: **APPROVED**（Blocker ゼロ・fix ゼロ）

## レイヤー別ファイル

- Adapter: review-006-adapter.md（B: 0 / W: 0）

Port Contract & Application / Runtime Wiring & Spec 整合性は Round 4 で fix ゼロだったため休止中。Round 5・6 の修正は適合スイート（`adapters/conformance/scopeTaskScheduler.ts`）へのテストケース追加のみで、休止中の観点の担当範囲に触れていない。

## カバレッジ

- 確認申告ゼロのファイル: なし

## 指摘一覧

なし。

## 収束の根拠

Adapter レビュアーが遷移表（5操作 × absent / pending / running / failed）と観測属性・入力境界を列挙し直し、適合スイートに空きセルが無いことを確認。実効性の確認として **18件のミューテーションを実際に当てて17件が赤**になることを実測した（`claimDue` が `leaseMs` を無視 / claim が `attempt` をリセット / `backoff`・`schedule` がリースを解放しない / `complete` が running 行に no-op / 予約枠の削除 / リースと `dueAt` の境界を `<` に / attempt 上限の off-by-one / 負の `limit` を無制限扱い、ほか）。

生き残った1件（`listDue` が失効リース行を `leaseExpiresAt` で並べる変異）は指摘に上げていない — `listDue` の順序は runner の scope 発見順にしか効かず、選択は scope 内の `claimDue` がやり直すため実害が無く、`spec/database` の dequeue 索引が単一走査に確定しているため #11 の D1/DO がこの経路を踏む筋道も無い。

## ラウンド推移

| Round | Blockers | Warnings | fix | 観点 |
| --- | --- | --- | --- | --- |
| 1 | 3 | 20 | 18 | 4観点 |
| 2 | 3 | 13 | 14 | 4観点 |
| 3 | 2 | 11 | 12 | 4観点 |
| 4 | 0 | 1 | 1 | 3観点（Runtime と Spec を統合） |
| 5 | 0 | 1 | 1 | Adapter のみ |
| 6 | 0 | 0 | 0 | Adapter のみ |
