# PR Review #004 — fix(identity): 保守スイープの表順を run.tables に一本化する

**PR:** #45
**Date:** 2026-08-25
**Round:** 4回目

## Summary

- Blockers: 1
- Warnings: 0
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Use Case / ポート契約: review-004-usecase.md（B: 0 / W: 0）
- Adapter / 適合スイート: review-004-adapter.md（B: 1 / W: 0）
- Spec canon: review-004-spec.md（B: 0 / W: 0）

## カバレッジ

- 確認申告ゼロのファイル: 過去ラウンドのレビュー記録（`.thread/16/review/review-00*.md`）のみ。Phase 7 で削除される中間成果物のため追加レビュアーは立てない

## 指摘一覧

- [B-001] `conformance/globalMaintenanceRunStore.ts:513-557 / 適合スイートの実効性` — 契約1の適合ケースが `setMaintenanceTables` を no-op にしても緑（差し替えが効いたことを観測する assertion が無い）（adapter）

## 観点の休止

- Use Case / ポート契約 → 休止（fix ゼロ）
- Spec canon → 休止（fix ゼロ）
- Adapter / 適合スイート → 継続
