# PR Review #001 — perf(web): ナビゲーションごとの RPC 3往復を削減する

**PR:** #36
**Date:** 2026-08-23
**Round:** 1回目

## Summary

- Blockers: 4
- Warnings: 21
- Verdict: **BLOCKED**

## レイヤー別ファイル

- 認証・セッション: review-001-auth.md（B: 1 / W: 6）
- ルーティング基盤・設定の受け渡し: review-001-routing.md（B: 1 / W: 7）
- ノート閲覧のフロントエンド体験・ドキュメント整合: review-001-note-docs.md（B: 2 / W: 8）

## カバレッジ

- 確認申告ゼロのファイル: なし（3体とも全13ファイルを確認申告。`.thread/13/` 配下は計画ドキュメントとして対象外）

## 指摘一覧

### 認証・セッション

- [B-001] spec/adr/030 + notes/index.tsx — セッション失効後のキャッシュ露出（canon 未改訂）
- [W-001] notes/index.tsx, $noteId.tsx:14-19 — コメントがブロッキング性を戻したと誤読させる
- [W-002] notes/-action.tsx + docs — 畳んだブリッジから 401 が出る経路は存在しない
- [W-003] router.tsx + appConfig.ts — AppConfig の SSR 露出、「秘密を入れない」前提が未明記
- [W-004] testing.md 手順10 — AC-7 検体 `/%0Aevil` の期待値が反転しうる
- [W-005] .thread/13/ — AC-6a/6b/7/11 の実行証跡が未取得
- [W-006] settings/-action.tsx:14-15 — 旧い二重化記述が残存

### ルーティング基盤・設定の受け渡し

- [B-001] settings/route.tsx:34-52 — タブのホバー（preload）だけで `/signin` へ実ナビゲート（実測）
- [W-001] notes/-action.tsx:14 — `redirect` の `.max(2048)` 超過で `/notes` が 500（実測）
- [W-002] plan.md:45 / testing.md:290,293 — AC-7 の検体が生の LF を `%0A` と誤記
- [W-003] appConfig.ts:22-29 — 型は `undefined` を許すのに実装は throw
- [W-004] docs:839 — redirect の所在記述が陳腐化
- [W-005] sessionGuard.ts — `requireSessionOrRedirect` に自動テストが無い
- [W-006] notes/{index,$noteId}, settings/route.tsx — 死んだ `staleTime` と長文コメントの複製
- [W-007] __root.tsx:42 — `<link rel="canonical">` が 2 本（既存不具合）

### ノート閲覧のフロントエンド体験・ドキュメント整合

- [B-001] docs:123 + notes/-action.tsx:9 — 「主体が無効 → 401」の系統は発火しない
- [B-002] docs:334 — `getContainer()` 直呼びの例外リストが旧構成のまま
- [W-001] docs:906-921 — `getRouter` 抜粋が同期のまま、新機構が未記載
- [W-002] docs:839 — redirect の所在に `auth.ts` が残存
- [W-003] notes/{index,$noteId}, settings/route.tsx — 死んだ `staleTime` の温存、生きた WHY コメントの潰し
- [W-004] notes/{index,$noteId}:17-19 — `/settings` 固有の但し書きのコピー
- [W-005] docs:127 — ローディングフォールバックの使い分けが実態と不一致
- [W-006] sessionGuard.ts, notes/-action.tsx — 自動テストが皆無
- [W-007] settings/route.tsx:35-52 — 未サインインでの `/settings/*` クライアント遷移が AC にも手順にも無い
- [W-008] CLAUDE.md — load-bearing files に `sessionGuard.ts` / `appConfig.ts` が未掲載
