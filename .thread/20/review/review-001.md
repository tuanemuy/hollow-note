# PR Review #001 — [security] OAuth 束縛 Cookie を state から独立した乱数にする

**PR:** #34
**Date:** 2026-08-22
**Round:** 1回目

## Summary

- Blockers: 4
- Warnings: 13
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Application: review-001-application.md（B: 0 / W: 5）
- Adapter: review-001-adapter.md（B: 1 / W: 2）
- Presentation: review-001-presentation.md（B: 0 / W: 3）
- Spec: review-001-spec.md（B: 3 / W: 3）

## カバレッジ

- 確認申告ゼロのファイル: なし（45 パスすべてに1体以上の確認申告あり）

## 指摘一覧

- [B-001] `adapters/conformance/oauthStateStore.ts:take/契約カバレッジ` — 「一致 × 期限切れでも削除」象限が適合スイートで未検証（memory を反対の実装に書き換えても 204 件全緑になることを実測）（Adapter）
- [B-002] `spec/database/index.md:oauth_flow_states/列名の不一致` — `state_binding_hash` と `binding_hash` で正典どうしが食い違い、`WHERE` に使う列が表定義に無い（Spec）
- [B-003] `spec/usecases/identity.md:abandonOAuthFlow/期限切れの記述` — 「期限切れなら行は残る」が確定した `take` 契約・実装に反する（Spec）
- [B-004] `spec/inventory/test.md:TC-identity-035/追随漏れ` — 同 PR で書き換えた生成元の文言に追随せず「最終同期: 2026-08-22」を偽にする（Spec）
- [W-001] `adapters/conformance/oauthStateStore.ts:take/不一致×期限切れ` — 象限のケースが無い（Adapter）
- [W-002] `ports/oauthStateStore.ts:実装ノート/列名` — 例示 SQL の列名が正典の表定義と食い違う（Application / Adapter 重複）
- [W-003] `abandonOAuthFlow.ts:エラー契約/SystemError` — 「エラーケース: なし」がポートの `SystemError(DatabaseError)` を無視。呼び出し元が loader の裸 await なので掃除の失敗が画面の描画失敗になる（Application）
- [W-004] `spec/inventory/usecase.md:UC-identity-006,007/UC-integration-001,002/説明文` — 旧記述のまま（Application / Spec 重複、progress.md で自己申告済み）
- [W-005] `routes/auth/-action.tsx:abandonOAuthFlowFn/障害耐性` — ストア障害が P-05 の loader ごと落とす。best-effort に倒すべき（Presentation）
- [W-006] `oauthStateBindingWiring.test.ts:163/空アサーション` — `not.toContain(sha256(STATE))` はどんな退行でも落ちない（Presentation）
- [W-007] `oauthStateBindingWiring.test.ts:242/別ブラウザーのケース` — 否定アサーションのみでユースケース未呼び出しの退行と区別できない（Presentation）
- [W-008] `spec/adr/034:59/影響の列挙漏れ` — 「消費済みでも Cookie が残るケース」に「一致 × 期限切れ」が抜けている（Spec）
- [W-009] `spec/testcases/identity/startOAuthFlow.md:TC-identity-264/TC とテストの対応` — 追記した「`state` は返さない / `stateBinding` を返す」を対応テストが検査していない（Spec）
