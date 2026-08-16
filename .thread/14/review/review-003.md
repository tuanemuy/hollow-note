# PR Review #003 — spec と実装の乖離を同期する（skeleton / アカウント管理スライス分）

**PR:** #22
**Date:** 2026-08-16
**Round:** 3回目（収束確認）

## Summary

- Blockers: **0**
- Warnings: 17
- Verdict: **APPROVED**（Blocker ゼロ。完了判定は台帳の fix ゼロで別途）

## レイヤー別ファイル

- ドメイン・ポート契約: review-003-domain.md（B: 0 / W: 3）— 収束判定「はい」
- ユースケース・シナリオ・テストケース: review-003-usecase.md（B: 0 / W: 5）— 収束判定「はい」
- 台帳（inventory）の整合性・ID 採番: review-003-inventory.md（B: 0 / W: 4）— 収束判定「はい」
- プレゼンテーション・画面・データモデル・プラットフォーム: review-003-presentation.md（B: 0 / W: 1）— 収束判定「はい」
- ADR・プロジェクトドキュメント・乖離台帳: review-003-docs.md（B: 0 / W: 4）— 収束判定「はい」

## カバレッジ

- 確認申告ゼロのファイル: なし

## R002 の修正の検証

- 正しく入っていた: 60 Key（観点別に domain 8 / usecase 13 / inventory 13 / presentation 5 / docs 26、重複含む）
- **反映漏れ 0 / 反映ミス 0 / 新たな矛盾 1**（docs:W-002 — `plan.md` の Phase 5 骨子が ADR 052 の確定と食い違う）
- M-79 のみ部分反映（元の指摘が「3 組」と過少計数で、実測は 11 組）
- 既存 ID の繰り下げ・付け替え: **0 件**（5 台帳 3663 行の ID → 要素写像を機械比較）
- `spec/` / `docs/` / `README.md` / `CLAUDE.md` の 259 ファイル: リンク切れ 0 件・見出しアンカー切れ 0 件
- TC ファイル ↔ 台帳: 全 9 ドメイン一致（計 2440 行）
- 品質ゲート: typecheck / lint / format / test（925 passed）/ build すべて緑

## 指摘一覧（すべて Warning）

- [W-001] .thread/14/steps.md:131,478:実測値 — R1 時点の値のまま（27→35 ファイル / 7→12 Issue / DOM 8→11 行）（docs）
- [W-002] .thread/14/plan.md:169,219:ADP ID 規約 — Phase 5 の起票骨子が `describe`/`it` 併記のままで ADR 052 の確定と食い違う（docs）
- [W-003] .thread/14/adr.md:1063,1261:到達不能 ID の計数 — `it` 名分は 20 本、21 本目はヘッダー由来（docs / domain 重複）
- [W-004] spec/usecases/note.md:847,977:改訂履歴 — 本 PR 非対象ファイルの既存分（docs）
- [W-001] spec/inventory/domain.md:316,317:DOM ↔ ADP 非対称 — 本 PR が新設した対（domain）
- [W-002] conformance/*.ts:ヘッダー範囲表記 — ADR-035 の全形規則が 5 ヘッダーに未適用（domain）
- [W-001] spec/inventory/test.md:新規 TC の到達性 — 32 行中コードから到達できるのは 4 行（usecase）
- [W-002] UC-identity-023/024:名乗るコードが無い（usecase）
- [W-003] spec/manual-tests/account.md:対応表 — `requestPasswordReset | レート制限` の行が無い（既存欠落）（usecase）
- [W-004] spec/testcases/storage/storeUpload.md:TC-storage-221 — 型レベルの言明で手で作れない（usecase）
- [W-005] deleteFilesByOwner.test.ts:358:it 名 — 改訂差分の言い回しが残る（usecase）
- [W-001] spec/inventory/{domain,adapter}.md:DOM ↔ ADP 非対称 8 組 — M-79 の同クラス残存（inventory）
- [W-002] conformance/signInOAuthClient.ts:41:ADP-identity-034 — 短縮連記で grep 0 件（inventory / domain W-002 と同根）
- [W-003] .thread/14/plan.md:AC-56 — 列挙 9 行に対し実測 11 行（inventory）
- [W-004] spec/inventory/frontend.md:PAGE-p21-001/002 — 台帳が本文を追い越した（inventory）
- [W-001] apps/web/app/start.ts:10:CSRF コメント — `Origin` 単独のままで M-38 の 3 ヘッダー順と割れている（presentation）
