# PR Review #010 — [account] アカウント管理と認証手段

**PR:** #17
**Date:** 2026-08-12
**Round:** 10回目（最終・確認ラウンド）

## Summary

- Blockers: 0
- Warnings: 7
- Verdict: **APPROVED**（Blocker ゼロ。完了判定は台帳の fix ゼロ）

## レイヤー別ファイル

- Domain / Use Case: review-010-domain-usecase.md（B: 0 / W: 1）
- Adapter / Infrastructure: review-010-adapter.md（B: 0 / W: 0）
- Frontend: review-010-frontend.md（B: 0 / W: 2）
- Security: review-010-security.md（B: 0 / W: 0）
- Test: review-010-test.md（B: 0 / W: 4）

## カバレッジ

確認申告ゼロのファイル: なし。5 観点の確認申告の和が変更ファイル一覧 311 件を覆っている（各観点が確認＋スキップを 311 件で 1 対 1 に申告済み）。

## 指摘一覧

- [W-001] `identity/{linkOAuthIdentity,completeOAuthSignIn}.ts:最終 UoW/同一 providerAccount の二重 insert` — activate 喪失 + TTL lapse 後の再連携で identity 行が二重に生える（Domain）
- [W-002] `SignInForm/index.tsx:PhaseAlert/再送先が入力欄の現在値`（Frontend）
- [W-003] `IdentityList/board.tsx:onAddPassword/listError 未クリア`（Frontend）
- [W-004] `completeOAuthSignIn.test.ts:TC-identity-030/勝者 claim の残存`（Test）
- [W-005] `deleteFilesByOwner.test.ts:TC-storage-040/カーソル不在`（Test）
- [W-006] `deleteAccount.terminalPrune.test.ts:TC-identity-105/固定 asOf の判別性`（Test）
- [W-007] `deleteAccount.manifestBuild.test.ts:TC-identity-100/item の routeVersion`（Test）

## 完了判定

台帳（`triage.md`）の最終ラウンドブロック:

> R10: 新規 7 / 継承 0 / **fix 0** / fix-editorial 0 / wont-fix 6 / defer 1（方針フェーズ: 実施）
> 観点別 fix 件数: domain-usecase 0 / adapter 0 / frontend 0 / security 0 / test 0

**全 5 観点が揃った確認ラウンドで `fix` ゼロを観測したため、レビューループは収束。**

Adapter と Security は本ラウンドで指摘ゼロ。Domain の 1 件は plan.md が #21 への縮退として既に記録している帰結で、到達経路を 1 本追記して defer。Frontend 2 件と Test 4 件は、いずれも AC 未達でもアクセシビリティ / セキュリティ問題でもなく、うち 3 件は「担保が無い」という事実主張自体が他テスト・型・実装で否定された（詳細は台帳の理由欄）。

R1〜R10 の推移と反映件数は台帳末尾の「レビューループの総括」を参照。
