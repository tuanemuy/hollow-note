# PR Review #001 — fix(identity): 一意性 claim の観測と条件付き取り壊しで予約消失を塞ぐ

**PR:** #41
**Date:** 2026-08-24
**Round:** 1回目

## Summary

- Blockers: 1
- Warnings: 16（重複を除くと 13）
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Domain: review-001-domain.md（B: 0 / W: 4）
- Use Case: review-001-usecase.md（B: 0 / W: 3）
- Adapter: review-001-adapter.md（B: 0 / W: 4）
- Spec Canon: review-001-spec.md（B: 1 / W: 5）

## カバレッジ

- 確認申告ゼロのファイル: なし（`.thread/21/*` は計画成果物のため全員スキップ・対象外）

## 指摘一覧

- [B-001] `spec/database/index.md:identity_unique_reservations` — 契約に足した `claimToken` を供給できる列が無い（Spec Canon）
- [W-001] `domain/ports/identityUniqueDirectory.ts:claimToken/型安全` — 素の `string` で観測していないトークンの引用が型で塞がれていない（Domain W-001 / Adapter W-002）
- [W-002] `application/identity/identityRemovalRelease.ts:JSDoc/非対称の根拠` — 「壊す鍵は event payload・判定は受領」の根拠がコードに残っていない（Domain W-003 / Use Case W-002）
- [W-003] `linkOAuthIdentity.ts,completeOAuthSignIn.ts:findOAuth/順序のテスト` — `ensureAddable` より前という load-bearing な順序を拘束するテストがない（Domain W-004 / Use Case W-001）
- [W-004] `domain/ports/identityUniqueDirectory.ts:claimToken/一意性の射程` — トークン一意性が同一鍵内に閉じ、鍵をまたいだ衝突を許す（Domain W-002）
- [W-005] `adapters/conformance/identityUniqueDirectory.ts:beginRelease/行なしの鍵` — 「行なしの鍵への `beginRelease` は no-op」が未拘束（Adapter W-001）
- [W-006] `adapters/memory/store.ts:nextClaimToken/不透明の意味` — 「不透明」が「推測不能」と読まれうるが memory は `claim-N` の単調カウンタ（Adapter W-003）
- [W-007] `adapters/conformance/identityUniqueDirectory.ts:expect.any(String)/形骸化` — 型が既に保証する内容の反復（Adapter W-004）
- [W-008] `spec/adr/060:影響/globalCleanup` — `releasing` 回収の一本化で `deleteAccount/globalCleanup` も孤児を拾えなくなるが影響欄が `updateProfile` しか挙げていない（Use Case W-003）
- [W-009] `spec/adr/index.md:前提依存マップ/ADR054` — ADR 054 が ADR 060 の前提から抜けている（Spec W-001）
- [W-010] `spec/adr/060:影響/ワーカー経路の収束` — 隔離・受領保持期限切れの但し書きが canon から落ちている（Spec W-002）
- [W-011] `spec/usecases/identity.md:removeIdentity手順4/release の射程` — 「観測が null でも `release` を必ず呼ぶ」が `keep` 判定を含んで読める（Spec W-003）
- [W-012] `spec/adr/038,060:却下理由・影響/時制` — 「当初の理由は古びた」等の経緯・時制が canon に混入（Spec W-004）
- [W-013] `spec/adr/060:題,spec/adr/index.md:一覧/第2の決定` — `findOAuth` による治癒が題と索引に表れていない（Spec W-005）
