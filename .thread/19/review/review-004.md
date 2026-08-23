# PR Review #004 — feat(core): ScopeTask に priority と lease を入れる

**PR:** #40
**Date:** 2026-08-24
**Round:** 4回目

## Summary

- Blockers: 0
- Warnings: 1
- Verdict: **APPROVED**（Blocker ゼロ。完了判定は台帳の fix ゼロ待ち）

## レイヤー別ファイル

- Port Contract & Application: review-004-port-application.md（B: 0 / W: 0）
- Adapter: review-004-adapter.md（B: 0 / W: 1）
- Runtime Wiring & Spec 整合性: review-004-runtime-spec.md（B: 0 / W: 0）

※ Round 3 まで独立していた Runtime Wiring と Spec 整合性は、残る論点が `.env.example` / `docs` / `spec` の記述と実装の一致に収束したため1観点に統合した。

## カバレッジ

- 確認申告ゼロのファイル: なし

## 指摘一覧

- [W-001] conformance/scopeTaskScheduler.ts:348-365 / 適合スイートのカバレッジ — schedule が既存 pending 行の dueAt / priority を上書きすることが未拘束（Adapter・ミューテーション実証済み）

## 前ラウンドからの持ち越しの判定

- Round 3 が「弱点として残した」と申告した `backoffOrSchedule` × `pending`（attempt+1 / dueAt 押し出し）は、Round 4 の Adapter レビューが**許容と判定**した。根拠: 同ケースが priority / payload の状態依存分岐を既に弾くこと、`deleteFilesByOwner.test.ts:324` が実行形を持つこと（ミューテーションで実測）、runner は必ず先に claim するため抜けても次 tick で拘束済みの `running` 経路に入り自己修復すること
