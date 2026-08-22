# レビュー 004 — Spec 観点

PR #34 / Issue #20 / 4 周目（ゼロベース）

## Spec

### Blockers

なし

### Warnings

なし

### 検証内容（要点）

- **ADR 034 の自己整合**: 前文（束縛の digest をフロー状態に持たせ、運搬と不在判定は転送境界）・決定 1〜5・決定リスト後の 4 段落（照合と消費の同一原子性 / 無条件破棄を避ける理由 / `state` を Cookie に載せない理由 / 連携にも同じ束縛）・検討した代替案 4 件・影響 7 件を通しで読み、旧決定（`sha256(state)`・転送境界での照合・「照合をユースケースに置く案の却下」）の残滓が無いことと、却下案「消費した後に照合する」が現行の条件付き `take` を巻き込まない書き方になっていることを確認。タイトルから「転送境界で」が落ち、`spec/adr/index.md` の一覧行・前提依存マップ（前提に原子性と ADR 026、境界に層の分担を併記）も追随済み。
- **正典どうしの整合**: `spec/domains/index.md` の `take(state, stateBindingHash)`＋4 象限を決める 1 本のルール、`spec/database/index.md` の `state_binding_hash NOT NULL` 列と条件付き `DELETE … RETURNING`（`WHERE` に期限を混ぜない理由付き）、`spec/usecases/identity.md` / `integration.md` の入出力 DTO・処理フロー・エラーケースが相互に矛盾しないことを確認。ポート JSDoc（`application/ports/oauthStateStore.ts`）と `spec/domains/index.md` の契約文が同義であることも確認。
- **spec の記述がコードについて真か**（差分外の実コードで確認）:
  - memory アダプターの `take` は「引く → 束縛比較（不一致は削除せず `null`）→ 削除 → 期限判定」で、正典の「一致すれば期限切れでも削除、不一致は常に行を残す」と一致。
  - `startOAuthFlow` は `issue()` を 3 本呼び `binding.hash` を保存、view は `stateBinding` のみ（`state` 非露出）。`spec/usecases/identity.md` の手順 3〜5・出力 DTO・その直下の本文段落と一致。
  - 消費 3 経路（`completeOAuthCallback` / `completeOAuthSignIn` / `linkOAuthIdentity`）が `hashOf(input.stateBinding)` を渡す。転送境界は Cookie 不在をユースケース前に `OAUTH_STATE_INVALID` へ畳み、`OAUTH_STATE_INVALID` 以外でだけ Cookie を捨てる（ADR 034 決定 2/3/4 と一致）。
  - `abandonOAuthFlow` は一致時のみ行を解放し、`abandoned` を外へ返さない。ストア失敗は転送境界で logger に落として `null` を返す（`spec/usecases/identity.md#abandonOAuthFlow` のエラーケース末尾の記述と一致）。
  - `spec/` 全体に `deriveOAuthStateBinding` / `assertOAuthStateCookie` / `clearBoundOAuthStateCookie` / 「Cookie は `state` の SHA-256」といった旧実装の記述が残っていないことを grep で確認。`spec/presentation/index.md`・`spec/pages/index.md` P-05・`spec/inventory/frontend.md` は本変更で偽になる記述を持たない（束縛 Cookie の属性表は presentation 文書に無く、P-05 の状態列挙は不変）。
- **台帳**: TC ID の重複・欠番なし（identity は 1..341 が連番で全埋まり、全ドメイン群も同様）。`spec/testcases/identity/*.md` の表行数と `spec/inventory/test.md` の行数が全 25 ファイルで 1 対 1 一致（abandonOAuthFlow 3 行含む）。UC 台帳は identity 1..25 が連番で、`spec/domains/identity.md` のユースケース列挙 25 件・`spec/usecases/identity.md` の見出し 25 件と完全一致。DOM-common-038 / ADP-common-037 の説明文が同文で更新済み、4 台帳の「最終同期」が 2026-08-22。生成元が動いていない `frontend.md` の日付を据え置いているのも正しい。
- **TC とテストコードの対応**: TC-identity-336/337/338/339/340/341 が `startOAuthFlow.test.ts` / `completeOAuthCallback.test.ts` / `abandonOAuthFlow.test.ts` / `completeOAuthSignIn.test.ts` の `it` 名に 1 対 1 で存在し、旧 TC-264 のアサーション（`view.state`）の置き換え先が TC-336 になっていることを確認。`vitest run packages/core/src/application/identity packages/core/src/adapters/memory/__tests__ apps/web/app/presentation` は 43 ファイル / 570 件が全緑で、TC が主張する振る舞い（不一致で消費されない・後から完了できる）が実装の性質として成立している。
- **経緯・代替案・進捗の混入**: `spec/` 側に Issue 番号・レビュー記録・改訂履歴の混入なし。検討した代替案は ADR の定型節に収まっており、判断の経緯は `.thread/20/adr.md` 側にある。
- **スコープ**: 差分は AC-1〜AC-8 の範囲内。`spec/usecases/integration.md`（未実装スライス）の追随は「同じポートを共有するため正典が偽になる」という plan.md の明示スコープに含まれる。`.thread/20/plan.md` / `steps.md` / `testing.md` と実装結果の食い違いは見つからなかった（steps.md 11 が挙げた `spec/testcases/identity/linkOAuthIdentity.md` は、既存行に本変更で偽になるものが無いため無変更で正しい。束縛不一致の TC を同ユースケースへ足すかは契約側＝適合スイートと 2 つの姉妹 TC で覆われており、指摘には上げない）。

### カバレッジ

- 確認: `.thread/20/plan.md`, `.thread/20/steps.md`, `.thread/20/adr.md`, `.thread/20/testing.md`, `.thread/20/progress.md`, `.thread/20/review/triage-keys.md`, `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/domains/index.md`, `spec/domains/identity.md`, `spec/database/index.md`, `spec/usecases/identity.md`, `spec/usecases/integration.md`, `spec/testcases/identity/abandonOAuthFlow.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/inventory/usecase.md`, `spec/inventory/test.md`, `spec/inventory/frontend.md`, `spec/manual-tests/account.md`, `spec/presentation/index.md`, `spec/pages/index.md`, `spec/index.md`, `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/application/identity/{startOAuthFlow,completeOAuthCallback,completeOAuthSignIn,linkOAuthIdentity,abandonOAuthFlow,view}.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`, `packages/core/src/application/identity/__tests__/*`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`
- スキップ: `.thread/20/review/review-00*.md`, `.thread/20/review/triage.md` — レビュー作業の記録であり本観点の対象外
- スキップ: 削除ファイル `apps/web/app/presentation/oauthStateBinding.ts` と `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts` — 削除内容の妥当性は確認したが、spec 側に参照が残っていないことの確認に還元した
