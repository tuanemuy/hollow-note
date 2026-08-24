# PR Review #003 — fix(identity): 一意性 claim の観測と条件付き取り壊しで予約消失を塞ぐ

**PR:** #41
**Date:** 2026-08-24
**Round:** 3回目

## Summary

- Blockers: 0
- Warnings: 1
- Verdict: **APPROVED**（Blocker ゼロ。唯一の指摘は `fix-editorial`）

## レイヤー別ファイル

- Domain: review-003-domain.md（B: 0 / W: 0）
- Use Case: review-003-usecase.md（B: 0 / W: 0）
- Adapter: review-003-adapter.md（B: 0 / W: 0）
- Spec Canon: review-003-spec.md（B: 0 / W: 1）

## カバレッジ

- 確認申告ゼロのファイル: なし

## 指摘一覧

- [W-001] `spec/domains/identity.md,ports/identityUniqueDirectory.ts:claimToken/「書き込みごとの UUID」の例示` — 適合機構の例示が直前の「claim 生存中は不変」と字義どおり両立しない（Spec Canon）

## 変異注入による検証（3観点が独立に実施）

Domain 観点は 8 種、Use Case 観点は 3 種、Adapter 観点は複数の変異注入を行い、いずれも対応するテストが red 化することを実証した。確認された拘束:

- 観測を判定 UoW の後ろへ移す → TC-identity-342 が落ちる
- 観測が null のとき早期 return する → TC-identity-345 が落ちる
- `observeActiveUniqueKey` の所有者比較を削る → TC-identity-346 が落ちる
- `ensureAddable` を `findOAuth` の前へ戻す → TC-identity-343 / 344 が落ちる
- `beginRelease` のトークン比較を削る / `releasing` 行の奪取を許す → ADP-identity-041 系が落ちる
- `claimToken` を `operationId` から導く / 冪等 `activate` で再採番する → ADP-identity-042 系が落ちる
- 行キーから `kind` を落とす → ADP-identity-042 の kind 区別ケースが落ちる
- `findOAuth` の `providerAccountId` 比較を削る → 6 件が落ちる

変異はすべて復元済み。全量スイートは 76 files / 970 passed / 3 skipped で green。
