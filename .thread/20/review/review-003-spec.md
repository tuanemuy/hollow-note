# レビュー 003 — Spec 観点（Issue #20 / PR #34）

3 周目。過去のレビュー結果は読まず、`.thread/20/plan.md` の受け入れ基準と `spec/` の正典性（書いてあることがコードについて真か）をゼロベースで検証した。

## Spec

### Blockers

なし。

改訂後の `spec/adr/034` は、前提 → 決定前文 → 決定 1〜5 → 理由段落 → 検討した代替案 → 影響 を通しで読んで自己矛盾が無いことを確認した。

- 決定前文の「転送境界に閉じる」→「digest だけをフロー状態に持たせ、運搬と不在判定は転送境界」への書き換えが、決定 1 / 2 / 5 と整合している
- 却下済みの代替案「フロー状態の行にブラウザー識別子を持たせる」が消え、代わりに実際に検討した 2 案（鍵付き MAC / `state = sha256(nonce)`）が入っている。改訂後の決定と正面から衝突する却下案は残っていない
- 「消費した後に照合する」の代替案が「却下するのは消費が先に走る形であって、条件付き `take` ではない」と限定されており、決定 2 が採る形と衝突しない
- 決定 3 / 4（`OAUTH_STATE_INVALID` では捨てない）と、影響の「消費済みでも Cookie が残ることがある」が同じ非対称を両側から述べていて矛盾しない。`apps/web/app/routes/auth/-action.tsx` の `serializeError` 判定・`requireOAuthStateCookie()` が投げる位置（`try` の外）とも一致する
- `spec/adr/index.md` の一覧行（「転送境界で」を落とす）と前提依存マップ（前提に原子性と ADR 026 を追加、境界列に分担を併記）が 034 の改訂に追随している

正典どうしの突き合わせも一致していた。

- `spec/domains/index.md` の `take(state, stateBindingHash: TokenHash)` と 4 象限 1 本ルール ＝ `packages/core/src/application/ports/oauthStateStore.ts` の JSDoc ＝ `adapters/conformance/oauthStateStore.ts` の 4 ケース ＝ `adapters/memory/repositories/oauthStateStore.ts` の実装（引く → 束縛比較 → 削除 → 期限判定）
- `spec/database/index.md` の `state_binding_hash text NOT NULL` と、`spec/domains/index.md` の `WHERE state = ? AND state_binding_hash = ?`（`WHERE` に期限を混ぜない）が同じ実装ノートで一致
- `spec/usecases/identity.md` の入出力 DTO・処理フロー・エラーケースが `startOAuthFlow.ts` / `completeOAuthCallback.ts` / `completeOAuthSignIn.ts` / `linkOAuthIdentity.ts` / `abandonOAuthFlow.ts` / `view.ts` の実体と一致（`StartOAuthFlowView` に `state` が無いことを含む）
- 台帳: DOM-common-038 / ADP-common-037 の説明が本文由来で一致（ADR 059）。UC-identity-025 は identity 群の末尾に採番（ADR 052）。TC-identity-336..340 は `spec/testcases/identity/` の増えた 5 行と 1 対 1 で、採番の重複・欠番なし。`spec/inventory/frontend.md` は生成元（`spec/pages/` / `spec/presentation/`）が無変更なので最終同期日が据え置きなのが正しい
- TC-336 / TC-337 / TC-338..340 は `startOAuthFlow.test.ts` / `completeOAuthCallback.test.ts` / `abandonOAuthFlow.test.ts` の同名 TC id を持つテストと対応している
- 経緯・代替案・進捗ログの `spec/` への混入なし（経緯は `.thread/20/adr.md` に閉じている）
- 削除した `presentation/oauthStateBinding.ts` への参照は `.thread/` の作業記録以外に残っていない

`pnpm exec vitest run packages/core/src/application/identity packages/core/src/adapters/memory/__tests__ apps/web/app/presentation` は 43 files / 569 tests 全緑。

### Warnings

- **[W-001]** `completeOAuthSignIn` に増えたエラーケース「束縛の不一致」だけ、テストケース表に対応行が無い
  - 場所: `spec/manual-tests/account.md:560`（`spec/usecases/identity.md:278` / `spec/testcases/identity/completeOAuthSignIn.md`）
  - 理由: `spec/usecases/identity.md` の `completeOAuthSignIn` エラーケース表に「束縛（`stateBinding`）の不一致」を足し、`spec/manual-tests/account.md` にも `対象外 | …自動テストで担保する` の行を足したが、`spec/testcases/identity/completeOAuthSignIn.md` には対応する行が無く、`completeOAuthSignIn.test.ts` にも束縛不一致のケースが無い（`grep stateBinding` で確認：渡しているだけで、不一致を作るテストは無い）。同じ表の既存の `対象外 | …自動テストで担保する` 行（`state` の不一致・期限切れ → TC-identity-034 / 035）はすべて `spec/testcases/` の行に裏打ちされているので、この 1 行だけが指す先の無い約束になっている。並びの `completeOAuthCallback` は同じエラーケースに TC-identity-337 を足しており、非対称が spec 側だけに残る
  - 提案: `spec/testcases/identity/completeOAuthSignIn.md` に 1 行足して TC を採番し（`completeOAuthCallback` の TC-337 と同じ形。実装も `beginFlow` の `stateBinding` を差し替えるだけで済む）、あるいは manual-test 表の備考を「`completeOAuthCallback` の同名ケース（TC-identity-337）と `OAuthStateStore` の適合スイートで担保する」に直して、担保先を明示する

## カバレッジ

- 確認（spec 正典）: `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/manual-tests/account.md`, `spec/testcases/identity/abandonOAuthFlow.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/usecases/identity.md`, `spec/usecases/integration.md`
- 確認（計画ドキュメント）: `.thread/20/plan.md`, `.thread/20/adr.md`, `.thread/20/steps.md`, `.thread/20/progress.md`, `.thread/20/testing.md`
- 確認（spec の記述が真かの突き合わせ先）: `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/view.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`
- 確認（TC 行との対応）: `packages/core/src/application/identity/__tests__/abandonOAuthFlow.test.ts`, `.../startOAuthFlow.test.ts`, `.../completeOAuthCallback.test.ts`, `.../completeOAuthSignIn.test.ts`, `.../linkOAuthIdentity.test.ts`, `.../authFlowHelpers.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`
- 確認（削除の追随）: `apps/web/app/presentation/oauthStateBinding.ts`（削除）, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`（削除）— 参照が `.thread/` 以外に残っていないことを全文検索で確認
- スキップ: `packages/core/src/application/identity/__tests__/{addPasswordIdentity,pruneExpiredAuthState,removeIdentity,requestPasswordReset,resetPassword}.test.ts` — `take` / 入力 DTO の署名変更に伴う機械的な追随のみで、TC 台帳・spec の記述に影響しない（差分は全件目視済み）
