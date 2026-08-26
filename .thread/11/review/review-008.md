# PR Review #008 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 8回目（確認ラウンド）

## Summary

- Blockers: 0
- Warnings: 0
- Verdict: **APPROVED**（Blocker ゼロ・fix ゼロ）

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-008-uow.md（B: 0 / W: 0）
- Routing / outbox / scope インフラ: review-008-routing.md（B: 0 / W: 0）
- 合成・スキーマ・テストハーネス・spec/docs: review-008-composition.md（B: 0 / W: 0）
- Identity / directory / operation: **休止**（Round 007 で fix ゼロ）
- Scope business / 投影・全文検索 / R2: **休止**（Round 006 で fix ゼロ）

## カバレッジ

- 確認申告ゼロのファイル: なし（192 ファイルすべてに 1 体以上の「確認」申告あり）

## 受け入れ基準の充足（composition が全項目を実測）

| # | 判定 | 実測 |
|---|---|---|
| AC-1 | 満たす | CF アダプター全域に `TODO` / `FIXME` / 未実装マーカー 0 件。35 ポートすべてが実体を持つ |
| AC-2 | 満たす | `--project workers` = 22 ファイル / 368 passed / 0 skipped / 0 failed。`conformanceCoverage.test.ts` が 30 スイートと memory との集合一致を固定 |
| AC-3 | 満たす | `cloudflareTest()` 経由で workerd 上の実 D1 / DO / R2 に対して実行。読み替え防止は factory 識別子検査が固定 |
| AC-4 | 満たす | batch 原子性 / 冪等 / lease 回収 / R2 競合の 8 ケース＋ support の 4 ケースが全数実在・緑 |
| AC-5 | 満たす | `AC-5:` 4 ケース実在。実測 `4n + 3` が `spec/platform/index.md` に反映済み、契約側テストケースは無変更 |
| AC-6 | 満たす | 「claim token を足さない」で決着。ポート JSDoc・`spec/platform`「Scope Alarm」・`scopeObject.ts` の 3 か所が同じ帯を述べ、`alarm.test.ts` 3 ケースが実物で観測 |
| AC-7 | 満たす | node 77 ファイル / 984 passed / 3 skipped（skip は oauth 資格情報未設定）。typecheck / lint / format:check / `install --frozen-lockfile` / `build:node` すべて成功。`adapters/memory` と `apps/web` は差分 0 |
| AC-8 | 満たす | `adapters/conformance/` は 1 行も変更されておらず、契約文の改訂はポート JSDoc と `spec/domains/` を同時に動かしている |
| AC-9 | 満たす | `_occ_guard` / `scope_task_due_index` とも spec に節があり DDL と列・制約名まで一致。migration は `0001` 1 本のみ、22 表が `d1/schema.ts` と 1 対 1 |

## 補足の実測

- 両プロジェクト同時実行 = 99 ファイル / 1352 passed / 3 skipped
- CI は 2 テストジョブ（node / workers）＋ 既存 build
- 名前空間分離は D1（factory 先頭で全消し）/ DO（object 名）/ R2（key prefix）の 3 面で成立
- 本番ソース・spec・docs から `.thread/11/adr.md` への参照は 0 件。CF 内の `ADR NNN` 15 種はすべて実在する `spec/adr/`
- `.thread/11/adr.md` は ADR-001〜098 が欠番・重複なし
- `testing.md` の全コマンド・ファイルパス・ケース名・行番号参照が最終状態と一致

## 指摘一覧

なし
