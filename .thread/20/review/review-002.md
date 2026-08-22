# PR Review #002 — [security] OAuth 束縛 Cookie を state から独立した乱数にする

**PR:** #34
**Date:** 2026-08-22
**Round:** 2回目

## Summary

- Blockers: 2
- Warnings: 11
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Adapter: review-002-adapter.md（B: 0 / W: 2）
- Presentation: review-002-presentation.md（B: 1 / W: 2）
- Spec: review-002-spec.md（B: 1 / W: 6）
- General（カバレッジ補充）: review-002-general.md（B: 0 / W: 1）

Application は R1 の fix 内訳ゼロ（全指摘が他観点と重複統合）のため休止。

## カバレッジ

- 確認申告ゼロのファイル: `__tests__/{removeIdentity,requestPasswordReset,resetPassword,startOAuthFlow}.test.ts` の4件 → General Review 1体で追跡し解消
- `.thread/20/review/*` はレビュー作業の記録そのものなのでメインが対象から除外

## 指摘一覧

- [B-001] `routes/auth/-action.tsx:133/コメントと実装の不一致` — 消費経路の Cookie 破棄条件のコメントが実装と ADR 034 決定 3/4 の逆の規則を書いている（Presentation）
- [B-002] `.thread/20/progress.md:残存課題/解消済み` — 「残存課題」の1件が既に解消済みで記述が成果物と食い違う（Spec）
- [W-001] `adapters/conformance/oauthStateStore.ts:take/state 述語の非拘束` — `take` が `state` で引くことを1ケースも拘束しておらず、束縛だけで引く実装が全ケース緑で通る（Adapter）
- [W-002] `application/identity/view.ts:AbandonOAuthFlowView.abandoned/JSDoc` — 「一致すれば期限切れでも削除して `null`」で戻り値が畳まれ、JSDoc が偽になる（Adapter）
- [W-003] `oauthStateBindingWiring.test.ts:285/形骸化アサーション` — `expect(outcome.error).not.toBe(failure)` は常に真（Presentation）
- [W-004] `routes/auth/-action.tsx:68/loadServerDeps の位置` — `try` の外にあり、JSDoc が防ぐと言う巻き添え失敗が残る（Presentation）
- [W-005] `spec/adr/034:17/前提の循環` — 決定2と同じ命題を自分の「前提」に書いている（Spec）
- [W-006] `spec/database/index.md:608/D1 実装ノートの不足` — `DELETE … RETURNING *` 1文では「一致すれば期限切れでも `null`」を満たせず、返った行の期限判定が書き落とされている（Spec）
- [W-007] `spec/usecases/identity.md:277,322/エラーケース表` — 消費系に「束縛の不一致」が無く、UC-identity-024 の台帳説明文が生成元より進んでいる（Spec）
- [W-008] `spec/manual-tests/account.md:535/追随漏れ` — 手順書のエラーケース対応表に `abandonOAuthFlow` の行が無く、AC-6 の追随リストにも `spec/manual-tests/` が入っていない（Spec）
- [W-009] `spec/testcases/identity/startOAuthFlow.md:5/TC の重複` — 追加行の前提条件×操作が既存行と同一で、TC-identity-264 と TC-336 の台帳「テストケース」列が完全一致（Spec）
- [W-010] `.thread/20/steps.md:40,57/計画と実装の齟齬` — 「適合スイートに象限ごとのケースは要らない」が ADR-009 の訂正・実装と矛盾。列名も `binding_hash` のまま（Spec）
- [W-011] `startOAuthFlow.test.ts:48/否定アサーションの射程` — 「`state` から導けない」を宣言しつつ固定しているのは特定2値の否定だけ（General）
