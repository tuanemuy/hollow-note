# レビュー 003 — Application 観点

### Application

#### Blockers

- なし

#### Warnings

- なし

#### 所見（指摘ではない確認結果）

ゼロベースで以下を検証し、いずれも実装と一致していた。

- **ポート契約の JSDoc**（`packages/core/src/application/ports/oauthStateStore.ts`）— 「束縛が一致したときだけ削除」「一致すれば期限切れでも削除して `null`」「不一致は常に行を残して `null`」の 4 象限すべてが、memory アダプター（`adapters/memory/repositories/oauthStateStore.ts:27-40`）の実装と一致する。判断順を非規範と明記し、`WHERE` に期限を混ぜないことだけを規範として残す書き方は、過剰主張ではなくバックエンドが守れる最小限になっている。適合スイート（`adapters/conformance/oauthStateStore.ts`）が 4 象限を実行形で押さえており（期限切れ×一致は `deleteExpired` の `deleted: 0`、期限切れ×不一致は `deleted: 1` で行の残存を観測）、契約テキストと執行形の対応に穴が無い。実行して 7 ケースの通過を確認した。
- **`abandonOAuthFlow` の責務・エラー契約・戻り値** — 他の identity ユースケースと同じ `ServiceArgs<Input> → View` の形。束縛不一致を失敗ではなく `abandoned: false` で返す設計は、`spec/usecases/identity.md#abandonOAuthFlow` の記述・UC-identity-025 の台帳行・TC-338/339/340 と一致する。`OAUTH_STATE_INVALID` を投げないことは意図的（後始末の失敗でコールバック画面を落とさない）で、spec 側にも書かれている。
- **Unit of Work** — 束縛の照合と `state` の消費は `OAuthStateStore.take` という単一の原子操作に閉じており、UoW の `run` は使っていない。CLAUDE.md の「UoW 外の書き込みは専用の atomic ポート経由」に沿った配置で、ネストも発生しない。`completeOAuthCallback` は `take` を 1 回だけ行い `*ForFlow` へ渡すので、二重消費も無い。
- **DTO 射影**（`application/identity/view.ts`）— `StartOAuthFlowView` から `state` が落ち、露出するのは束縛の平文だけになった。`AbandonOAuthFlowView.abandoned` の JSDoc は「一致したが期限切れの行は解放されるが `false` を返す」という縮退まで正直に書いており、実装（`take` が `null` を返す）と一致する。過剰な露出も、実装と食い違う記述も無い。
- **秘密と digest の扱い** — 束縛は `SecureTokenGenerator.issue()` で `state` / `codeVerifier` と独立に払い出され、行に載るのは `hash` だけ。比較対象は平文ではなく digest で、これはセッショントークン（`authenticateSession` / `signOut` ほか）と同じ既存の照合様式。identity ユースケース内に束縛の平文・digest をログへ出す経路は無い（`logger.*` の呼び出しを全走査して確認）。
- **テストの実効性** — 署名変更への機械的追随（`stateBinding` の受け渡し）は検証を弱めていない。新規の 4 本はいずれも実装を差し替えると落ちる形になっている: TC-337 は不一致後に行が残ることを `h.backend.oauthStates` で直接観測したうえで、正しい束縛での完了まで続けて確認する（不一致で削除する実装に退行すると落ちる）。TC-336 は `stateBindingHash === hashOf(stateBinding)` の同一性に加え、`stateBinding !== state` と `stateBindingHash !== hashOf(state)` の否定 2 本で旧導出への退行を捕まえる。TC-338/339 は戻り値と行の生死を対で見ている。`pruneExpiredAuthState.test.ts` の `take` 追随も、掃かれなかった行が正しい束縛で取り出せることを確認する形を保っている。
- **スコープ** — application 層の差分は Issue #20 の範囲内で、無関係な変更は混入していない。`spec/usecases/integration.md` の追随は未実装スライスの正典を偽にしないための記述変更のみで、実装の先取りは無い。
- **弁明・経緯の残留** — 変更されたユースケース／view／ポートの JSDoc に修正の経緯や弁明は無く、いずれも「なぜその形か」を述べている。`abandonOAuthFlow.ts` の UC id ＋ spec パス参照は既存ユースケース（`signOut.ts` / `linkOAuthIdentity.ts` ほか）と同じ様式で、CLAUDE.md が禁じる ADR 番号の引用ではない。
- **実行確認** — `pnpm exec vitest run packages/core/src/application/identity`（32 files / 292 tests）と OAuthStateStore 適合スイート（7 tests）がいずれも通過。

#### カバレッジ

- 確認: `packages/core/src/application/ports/oauthStateStore.ts`
- 確認: `packages/core/src/application/identity/abandonOAuthFlow.ts`
- 確認: `packages/core/src/application/identity/completeOAuthCallback.ts`
- 確認: `packages/core/src/application/identity/completeOAuthSignIn.ts`
- 確認: `packages/core/src/application/identity/linkOAuthIdentity.ts`
- 確認: `packages/core/src/application/identity/startOAuthFlow.ts`
- 確認: `packages/core/src/application/identity/view.ts`
- 確認: `packages/core/src/application/identity/__tests__/abandonOAuthFlow.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/authFlowHelpers.ts`
- 確認: `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/resetPassword.test.ts`
- 確認: `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`
- 確認: `packages/core/src/adapters/conformance/oauthStateStore.ts` — ポート契約の執行形として確認
- 確認: `packages/core/src/adapters/memory/repositories/oauthStateStore.ts` — 契約 JSDoc が実振る舞いを述べているかの照合のため確認
- 確認: `spec/usecases/identity.md`, `spec/usecases/integration.md` — ユースケースの入出力 DTO・エラー契約と実装の突き合わせ
- 確認: `spec/testcases/identity/abandonOAuthFlow.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/startOAuthFlow.md` — TC 行とテスト実体の対応確認
- 確認: `spec/inventory/usecase.md`, `spec/inventory/test.md` — UC/TC の採番とコード内 id の一致確認
- スキップ: `apps/web/app/presentation/` 配下（`oauthStateBinding.ts` 削除、`oauthStateBinding.test.ts` 削除、`oauthStateBindingWiring.test.ts`、`oauthStateCookie.ts`）と `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx` — 転送境界の実装で presentation 観点の担当（application 契約との整合のみ参照した）
- スキップ: `.thread/20/` 配下（`adr.md`, `plan.md`, `progress.md`, `steps.md`, `testing.md`） — 作業記録であり実装成果物ではない
- スキップ: `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/manual-tests/account.md` — 設計正典・台帳の整合は spec 観点の担当
