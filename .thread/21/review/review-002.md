# PR Review #002 — fix(identity): 一意性 claim の観測と条件付き取り壊しで予約消失を塞ぐ

**PR:** #41
**Date:** 2026-08-24
**Round:** 2回目

## Summary

- Blockers: 1
- Warnings: 15（重複を除くと 13）
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Domain: review-002-domain.md（B: 1 / W: 3）
- Use Case: review-002-usecase.md（B: 0 / W: 2）
- Adapter: review-002-adapter.md（B: 0 / W: 4）
- Spec Canon: review-002-spec.md（B: 0 / W: 6）

## カバレッジ

- 確認申告ゼロのファイル: なし（`.thread/21/*` は計画・レビュー成果物のため全員スキップ・対象外）

## 指摘一覧

- [B-001] `application/identity/uniqueness.ts:observeActiveUniqueKey/所有者ガードのテスト` — 所有者比較を削っても全 green。変異注入で別利用者の claim を実際に奪えることを実測（Domain）
- [W-001] `adapters/conformance/identityUniqueDirectory.ts:not.toBe("")/契約超過` — 契約に無いトークン非空性を要求しており拘束価値ゼロ（Domain W-003 / Adapter W-002）
- [W-002] `spec/database/index.md:claim_token/状態遷移での引き継ぎ` — 「行を新規に書くたび採番」が `activate` の更新書き込みでの再採番まで許す読みを残す（Adapter W-003 / Spec W-006）
- [W-003] `domain/ports/identityUniqueDirectory.ts:claimToken/実装例` — 契約が挙げる row version / ETag は「張り直しで必ず変わる」を満たさない（Domain W-001）
- [W-004] `application/identity/identityRemovalRelease.ts:JSDoc/beginRelease の説明` — `beginRelease` を旧仕様（所有者だけ弾く）のまま説明しており同ファイル下段・ポート JSDoc と食い違う（Domain W-002）
- [W-005] `completeOAuthSignIn.test.ts:TC-344/セッション発行の主張` — 「セッションが発行される」主張が空振り（AC-5 の 1 点が無拘束）（Use Case W-001）
- [W-006] `application/identity/identityRemovalRelease.ts:keep分岐/release を呼ばない根拠` — 安全性の根拠がコードにもテストにも残っていない（Use Case W-002）
- [W-007] `adapters/conformance/identityUniqueDirectory.ts:kind/区別の欠落` — `rowKey` から `kind` を落とす変異で 21 ケース全通過（Adapter W-001）
- [W-008] `adapters/memory/store.ts:nextClaimToken/JSDoc の射程` — 「once per container」が実態（global UoW は `run` ごとにファクトリを呼ぶ）より緩い（Adapter W-004）
- [W-009] `spec/adr/060:Issue番号・進捗記述/canon-purity` — GitHub Issue 番号（#11 / #19）と「持ち越す」という進捗ログ的記述が canon に混入（Spec W-001）
- [W-010] `spec/inventory/*.md:最終同期日/ledger-header` — 「最終同期: 2026-08-22」が据え置きで 08-24 の同期と食い違う（Spec W-002）
- [W-011] `spec/adr/038:却下理由/adr-consistency` — 「ポート・適合スイートの変更に波及し」が ADR 060 で実際に払ったコストと食い違う（Spec W-003）
- [W-012] `spec/usecases/identity.md:deleteAccount/globalCleanup` — 「全 providerAccount reservation を release する」が無条件のままで ADR 060 の影響と矛盾（Spec W-004）
- [W-013] `spec/adr/060:現行実装の記述/canon-present-tense` — 「現行の実装は 2 件目の identity 行を生やし」が本 PR 後は偽（Spec W-005）
