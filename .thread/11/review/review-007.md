# PR Review #007 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 7回目

## Summary

- Blockers: 0
- Warnings: 4（重複を束ねると 3 件）
- Verdict: **APPROVED**（Blocker ゼロ）

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-007-uow.md（B: 0 / W: 1）
- Identity / directory / operation（D1 control plane）: review-007-identity.md（B: 0 / W: 0）
- Routing / outbox / scope インフラ: review-007-routing.md（B: 0 / W: 1）
- 合成・スキーマ・テストハーネス・spec/docs: review-007-composition.md（B: 0 / W: 2）
- Scope business / 投影・全文検索 / R2: **休止**（Round 006 で fix ゼロ）

## カバレッジ

- 確認申告ゼロのファイル: なし（187 ファイルすべてに 1 体以上の「確認」申告あり）

## 受け入れ基準の充足（composition が全項目を実測）

| # | 判定 | 実測 |
|---|---|---|
| AC-1 | 満たしている | チェックリスト 5 行すべて実体があり、CF アダプターと `cloudflareRuntime.ts` に TODO / 仮実装 0 件 |
| AC-2 | 満たしている | `pnpm test:workers` 22 ファイル / 366 passed / 0 skipped。`conformanceCoverage.test.ts` が 30 スイートと memory との集合一致を固定 |
| AC-3 | 満たしている | 適合入口 7 ファイルが `makeCloudflareConformanceBackend` のみを名乗り、`harness.test.ts` が実バインディング・両スキーマ・FTS5・`nodejs_compat` を実物で観測 |
| AC-4 | 満たしている | (a) D1 batch / `transactionSync` の原子性、(b) 冪等性、(c) lease 回収、(d) R2 の 4 点がそれぞれケースとして緑 |
| AC-5 | 満たしている | 実測 `4n + 3`（commit は件数によらず 1 回）を `spec/platform/index.md` へ反映済み。`spec/testcases/storage/deleteFilesByOwner.md` は不変 |
| AC-6 | 満たしている | 「運用（`leaseMs` の帯 + 単一 writer）で足りる」を選び、前提をポート JSDoc・`spec/platform/index.md`・`SCOPE_TASK_LEASE_MS` の注入点まで明文化。契約は変えていない |
| AC-7 | 満たしている | `git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web` が空。typecheck / lint / format:check / `test:node`（77 ファイル・984 passed）/ `pnpm test`（99 ファイル・1350 passed）/ `build:node` すべて exit 0 |
| AC-8 | 満たしている | `adapters/conformance/` の差分 0。倒した乖離はすべて JSDoc + spec 本文 + 台帳が同時に動いており ADR 046 に沿う |
| AC-9 | 満たしている | migration は `0001` 1 本、`_occ_guard` と `scope_task_due_index` が `spec/database/index.md` に節を持ち DDL と 1 対 1。`.thread/11/adr.md` への参照は本番ソース・spec・docs から全廃済み |

## 指摘一覧

### Blockers

なし

### Warnings

- [W-01] `do/scopeObject.ts:leaseMsOf` — `SCOPE_TASK_LEASE_MS` の不正値拒否と未設定→既定値の 2 分岐がどちらも観測されていない（`Number(raw) || DEFAULT` へ戻しても全テストが緑）。uow / routing の両方が独立に検出
- [W-02] `.thread/11/testing.md:確認項目4` — 「件数を変えても文数が変わらない」という確認ポイントが最終実測（`4n + 3`、文数は比例する）と矛盾し、Phase 4 が偽の赤を出す
- [W-03] `.thread/11/testing.md:確認項目6` — 期待する node プロジェクトの件数（76 ファイル・978 件）が実測（77 ファイル・984 passed / 3 skipped）とずれる
