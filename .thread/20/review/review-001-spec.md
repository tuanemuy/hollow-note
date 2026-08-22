# レビュー 001 — Spec

対象: PR #34（Issue #20）/ ベース: main
契約: `.thread/20/plan.md`（AC-6 が spec 追随の基準）

## Spec

### Blockers

- **[B-001]** `oauth_flow_states` の束縛列名が正典どうしで食い違っている（`state_binding_hash` vs `binding_hash`）
  - 場所: `spec/database/index.md:601`, `spec/database/index.md:608` と `spec/domains/index.md:241`
  - 理由: `spec/database/index.md` は列定義の正典で、追加した列は `state_binding_hash`、条件付き削除の記述も `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` になっている。一方 `spec/domains/index.md:241` の実装ノートは同じクエリーを `DELETE … WHERE state = ? AND binding_hash = ? RETURNING *` と書いており、`WHERE` に使う列が表定義に存在しない名前になっている。plan.md「リスクと注意点」が名指しで避けようとした「正典どうしの食い違い」がそのまま残っている（AC-6 未達）。同じ名前が `packages/core/src/application/ports/oauthStateStore.ts:45` の JSDoc と `packages/core/src/adapters/memory/repositories/oauthStateStore.ts:28` のコメントにも波及している
  - 提案: 列名を `state_binding_hash` に統一する（`spec/domains/index.md:241`、ポート JSDoc、memory アダプターのコメントの 3 か所を直す）。逆向きに倒すなら `spec/database/index.md` の表と追記文を `binding_hash` に揃えるが、他の列が `code_verifier` / `user_auth_epoch` とフィールド名をそのまま写している以上、`state_binding_hash` 側に寄せるのが表の規約に合う

- **[B-002]** `abandonOAuthFlow` の処理フローが「期限切れなら行は残る」と書いており、確定した `take` の契約と実装に反する
  - 場所: `spec/usecases/identity.md:377`
  - 理由: 「`null`（束縛不一致・行が無い・期限切れ）なら `{ abandoned: false }` で、行は残したままにする」と書いてあるが、本 PR が確定させた契約は `spec/domains/index.md:241`（およびポート JSDoc）の「**削除するのは束縛が一致したときだけ。一致すれば期限切れでも削除して `null` を返す**」で、`packages/core/src/adapters/memory/repositories/oauthStateStore.ts:41-47` も「比較 → 削除 → 期限判定」の順にそう実装している。したがって「束縛が一致 × 期限切れ」では行は削除されるのに `abandoned: false` が返る。この 1 文はコードについて偽であり、かつ同じ PR が書いた `spec/domains/index.md` の 1 本のルールと正典どうしで矛盾する。同じ節の他 3 ユースケース（`spec/usecases/identity.md:264` / `:313` / `:344`）は「不一致・不在では行を消費しない」と正しく限定しているので、ここだけが過剰
  - 提案: 「`null`（束縛不一致・行が無い・期限切れ）なら `{ abandoned: false }`。行が残るのは束縛が一致しなかったときで、一致した行は期限切れでも解放される」の形に直す

- **[B-003]** TC 台帳の `TC-identity-035` が、同じ PR で書き換えた生成元の行に追随していない
  - 場所: `spec/inventory/test.md:176`（生成元は `spec/testcases/identity/completeOAuthSignIn.md:16`）
  - 理由: 生成元の期待結果は「…（**束縛が一致したときに**取り出しと同時に削除される）」へ更新されたのに、台帳の行は旧文「（取り出しと同時に削除される）」のまま。台帳は「1 行 = 1 テストケース」で生成元の写しであり、冒頭に「最終同期: 2026-08-22」と宣言している以上、この行はその宣言を偽にする。`spec/testcases/identity/` の全行を突き合わせた結果、文言が食い違うのはこの 1 行だけ（他の差分は ADR リンクの相対パス深さの違いのみ）
  - 提案: `TC-identity-035` の期待結果を生成元と同じ文言に揃える

### Warnings

- **[W-001]** ADR 034 の「消費済みでも Cookie が残るケース」の列挙が、同じ ADR が決めた 4 象限規則を取りこぼしている
  - 場所: `spec/adr/034-oauth-callback-browser-binding.md:59`
  - 理由: 「消費済みでも Cookie が残るケースがある（provider 不一致・`integration` intent）」と括弧で列挙しているが、確定した契約では「束縛が一致 × 期限切れ」も行を削除したうえで `OAUTH_STATE_INVALID` になり、転送境界は Cookie を捨てない（`apps/web/app/routes/auth/-action.tsx` の破棄条件）。第 3 のケースが列挙から漏れている。無害な縮退ではあるが、この bullet は「なぜ安全側に倒すか」の根拠を列挙で支えているので、抜けがあると根拠の強さが読み取れない
  - 提案: 「（provider 不一致・`integration` intent・期限切れの一致）」のように 3 つ目を足すか、列挙をやめて「`OAUTH_STATE_INVALID` は消費の有無と 1 対 1 でないため」だけで言い切る

- **[W-002]** UC 台帳の説明文が 4 行だけ旧記述のまま（`progress.md` で自己申告済み）
  - 場所: `spec/inventory/usecase.md:18`（UC-identity-006）、`:19`（UC-identity-007）、`:36`（UC-integration-001）、`:37`（UC-integration-002）
  - 理由: UC-identity-024 は「state は束縛が一致したときだけ消費し」へ更新されたのに、同じ `take` を呼ぶ UC-identity-006 / 007 は「OAuth state を単回消費し」のまま。UC-integration-001 は出力を「認可 URL を返す」とだけ書くが、`spec/usecases/integration.md:23` の出力 DTO は `authorizationUrl` に加えて `stateBinding` を返すことになった。いずれも偽ではないが、生成元が変わったのに「最終同期: 2026-08-22」と宣言した台帳の中で同じ性質の記述が不揃いに残っている（AC-6 は `spec/inventory/` の各行を対象に挙げている）
  - 提案: 4 行の説明文に「束縛が一致したときだけ消費する」「束縛の秘密を返す」を足す。台帳の 1 行は本文の要約なので、UC-identity-024 と同じ粒度に揃えれば足りる

- **[W-003]** `TC-identity-264` の期待結果に足した「`state` は返さない」を、対応するテストが検査していない
  - 場所: `spec/inventory/test.md:405` / `spec/testcases/identity/startOAuthFlow.md:5` ↔ `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts:24-46`
  - 理由: TC-264 の期待結果は「応答は `authorizationUrl` と束縛の秘密（`stateBinding`）を返し、`state` は返さない」に書き換えられたが、TC-264 のテスト本体は `authorizationUrl` と保存行だけを見ており、`view.stateBinding` にも「`state` を返さない」ことにも触れていない（後者は型でのみ担保）。TC-336 が `view.stateBinding` を見るので実質の穴は小さいが、TC 行とテストの対応は 1 対 1 が前提なので、書いた期待が読める形で検査されていない
  - 提案: TC-264 に `expect(view.stateBinding.length).toBeGreaterThan(0)` 相当を 1 本足すか、期待結果の「`state` は返さない」を TC-336 側の行へ寄せる

### カバレッジ

- 確認: `.thread/20/plan.md`, `.thread/20/steps.md`, `.thread/20/adr.md`, `.thread/20/progress.md`, `.thread/20/testing.md`
- 確認: `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`
- 確認: `spec/usecases/identity.md`, `spec/usecases/integration.md`
- 確認: `spec/testcases/identity/abandonOAuthFlow.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/startOAuthFlow.md`
- 確認: `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`
- 確認（spec 記述の真偽を突き合わせた実コード）: `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/view.ts`
- 確認: `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/oauthStateBinding.ts`（削除）, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`
- 確認（TC 行との対応）: `packages/core/src/application/identity/__tests__/abandonOAuthFlow.test.ts`, `.../startOAuthFlow.test.ts`, `.../completeOAuthCallback.test.ts`, `.../completeOAuthSignIn.test.ts`, `.../authFlowHelpers.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`（削除）
- 確認（差分外・追随漏れの探索）: `spec/presentation/index.md`, `spec/pages/index.md`, `spec/manual-tests/account.md`, `spec/manual-tests/integration.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/integration/*.md`, `spec/inventory/frontend.md` — いずれも本改訂で偽になる記述は無し（ADR 034 を参照するファイルは全数が今回の変更対象に含まれている）
- スキップ: `packages/core/src/application/identity/__tests__/{addPasswordIdentity,linkOAuthIdentity,pruneExpiredAuthState,removeIdentity,requestPasswordReset,resetPassword}.test.ts` — `take` / 入力 DTO の署名変更に伴う機械的な追随のみで、新規・変更された TC 行を持たず spec との対応関係が動かないため
