# レビュー R001 — Presentation（転送境界・server function・Cookie 配線）

対象: PR #34 / round 001（`.thread/20/plan.md` を契約として判定）

## Presentation

### Blockers

なし。

Cookie を扱う中核の安全条件は、コードとテストの両方で成立していることを確認した（下記「検証したこと」参照）。

### Warnings

- **[W-001]** 破棄経路がユースケース呼び出しになったことで、ストア障害がコールバック画面そのものを落とす
  - 場所: `apps/web/app/routes/auth/-action.tsx:55-75`（呼び出し元は `apps/web/app/routes/auth/callback.$provider.tsx:28-33`）
  - 理由: `abandonOAuthFlowFn` はルートの **loader** から `await` されている。変更前の実体は Cookie 値の比較だけで、実質的に throw しない純粋な転送境界処理だった。変更後は DI コンテナのロード + `OAuthStateStore.take()` を伴い、ポート契約上 `SystemError(DatabaseError)` を投げうる。これが loader を抜けると、P-05 は「キャンセルされました」「やり直してください」を描く代わりにルートのエラー境界（SSR では 500）に落ちる。破棄は best-effort な後始末であり、そもそも「往復が失敗した後」の画面なので、ここで画面ごと落とすのは割に合わない。同じルートの `validateSearch` が `.catch(undefined)` でプロバイダー由来の壊れた入力を握り潰しているのと防御姿勢が揃っていない。参照バックエンドが in-memory の現状では顕在化しないが、D1 バックエンドでは普通に起きる
  - 提案: loader 側で best-effort に倒す（`await abandonOAuthFlowFn(...).catch(() => null)`）。転送境界の `try / catch` を増やしたくないなら loader の 1 行で足り、CLAUDE.md の「明示的な境界」の範囲に収まる

- **[W-002]** 生成経路の否定アサーション `not.toContain(sha256(STATE))` は、どんな退行でも落ちない
  - 場所: `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts:163`（同 162 行も準じる）
  - 理由: `startOAuthFlow` は `{ stateBinding: BINDING, authorizationUrl }` を返すモックで、転送境界には `state` が渡らず、`sha256` を計算するコードも presentation から消えている（`oauthStateBinding.ts` を削除したため）。したがって `Set-Cookie` に `sha256(STATE)` が載る経路は存在せず、このアサーションは実装が何であっても真になる。AC-1 が言う「Cookie 値が `state` から計算できない」を実際に固定しているのは `startOAuthFlow.test.ts`（AC-8）であって、この行ではない。162 行の `not.toContain(STATE)` は「`authorizationUrl` をパースして焼く」退行だけを弱く覆うので完全な空振りではないが、意味は AC-1 が期待するものより狭い
  - 提案: この 1 行は落とすか、コメントで「実際の担保は `startOAuthFlow.test.ts`」と明示して意図を残す。代わりにこのケースで固定する価値があるのは属性側で、AC-3 が「現状のまま」と書いている `Secure` と `Expires`（寿命 = `state` 行）は現在どのアサーションも見ていない。`expect(header).toContain("Secure")` と `Expires`（もしくは `Max-Age`）の存在確認を足すほうが、Cookie 属性の退行検知として実利がある

- **[W-003]** 破棄経路の「別ブラウザーのフロー」ケースが、単体では「ユースケースを一度も呼ばない」退行と区別できない
  - 場所: `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts:242-253`
  - 理由: このケースの主張は `bindingHeader === undefined` と `storedState() !== undefined` の 2 つの否定だけで、ハンドラーが何もしなかった場合にもそのまま通る。直後の「Cookie が無いときは何もしない」ケース（255-266）は `expect(take).not.toHaveBeenCalled()` を持つので、両者は「呼んだか」の軸で対になっていない。実際に `abandonOAuthFlowFn` を常に早期 return させて実行したところ、落ちたのは 229 行のケースだけで、このケースは緑のまま通った（＝スイート全体としては退行を捕まえるが、このケース自身は不一致の扱いを観測していない）
  - 提案: `expect(take).toHaveBeenCalledTimes(1)` を足す。`take` は既に実アダプターを包んだ `vi.fn` なので追加コストはゼロで、「不一致は転送境界ではなく条件付き `take` が弾いている」という設計の主張がテストの側にも現れる。同様に `completeOAuthCallbackFn` の「Cookie 無し」ケース（171-184）にも、破棄側と対称に `expect(outcome.setCookie).toHaveLength(0)` を足しておくと、`requireOAuthStateCookie()` の throw より前に `Set-Cookie` を出さないことが観測になる

### 検証したこと（Blocker なしの根拠）

- **Cookie 属性の退行なし**: `setOAuthStateCookie` / `clearOAuthStateCookie` のオプション（`httpOnly` / `sameSite: "lax"` / `path: "/"` / `secure: !isDevelopment()` / `expires = now + OAUTH_STATE_TTL_MS`）は差分で一切触られていない。変わったのは値の出所（`await deriveOAuthStateBinding(state)` → 引数の `stateBinding`）と `async` が取れたことだけ。実ヘッダーも `hollow_oauth_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` を確認した
- **束縛の秘密が外へ出ない**: `startOAuthSignInFn` / `startOAuthLinkFn` はどちらも `{ authorizationUrl }` だけを返し、`stateBinding` は `Set-Cookie`（`HttpOnly`）にしか載らない。`abandonOAuthFlowFn` の応答は `null` 固定で `abandoned` を外に出さない。`completeOAuthCallbackFn` の応答は intent / redirectTo / created のみ。`state` は `StartOAuthFlowView` から消え、転送境界に到達しない（AC-8 の presentation 側は満たされている）
- **開始経路 2 本の対称性**: `routes/auth/-action.tsx:37` と `routes/settings/-action.tsx:315` がどちらも `setOAuthStateCookie(view.stateBinding, container.clock.now())` で同一。片方だけの取りこぼしは無い
- **構造判定**: 破棄条件は `serializeError(error)` の `kind === "validation" && code === "OAUTH_STATE_INVALID"` で、`isValidationError`（`instanceof` 系）に依存していない。`serializeError` → `isSerializableError` も `packages/core/src/lib/error.ts:13` の構造判定で、モジュールグラフ分割に影響されない。CLAUDE.md の「presentation layer serializes structurally」に沿う
- **`try / catch` の使い方**: `completeOAuthCallbackFn` の catch は server function 境界にあり、範囲は usecase 呼び出し 1 本、判定後に `throw error` で再送出して `errorResponseMiddleware` の直列化・秘匿・ステータス付与をそのまま通す。CLAUDE.md の cross-layer catch policy と整合
- **入力バリデーション**: 本文は `validateInput(callbackSchema / abandonSchema)` で転送境界検証、Cookie は空判定のみ（`session.ts:readSessionToken` と同じ扱い）。`stateBinding` の実質的な検証は `hashOf` → `take` の同値比較で、二重検証を足していない
- **配線テストの実効性（mutation で確認）**: (1) catch の `OAUTH_STATE_INVALID` ガードを外す → 186 行のケースが落ちる。(2) `abandon` の `view.abandoned` ガードを外して常時破棄にする → 242 行のケースが落ちる。(3) `abandon` を常に早期 return させる → 229 行のケースが落ちる。安全側の 3 条件はいずれもテストに効いている
- **削除物の参照残り無し**: `oauthStateBinding` / `deriveOAuthStateBinding` / `assertOAuthStateBinding` / `clearBoundOAuthStateCookie` / `assertOAuthStateCookie` はコード・`spec/` のどこからも参照されていない（残るのは `.thread/` の作業ログのみ）
- **コメント**: 追加された JSDoc / コメントはいずれも現在の理由を述べており、ADR 番号の引用も修正の経緯・弁明も含まれていない
- **スコープ**: presentation 側の差分は `-action.tsx` 2 本と `oauthStateCookie.ts` に閉じており、スコープ外の変更は混ざっていない
- `pnpm exec vitest run apps/web/app/presentation` は 7 files / 49 tests green

## カバレッジ

- 確認: `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/oauthStateBinding.ts`(削除), `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`(削除), `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `spec/adr/034-oauth-callback-browser-binding.md`, `spec/usecases/identity.md`
  - 差分外の参照: `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `apps/web/app/presentation/errorResponse.ts`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `apps/web/app/presentation/session.ts`, `packages/core/src/lib/error.ts`, `spec/presentation/index.md`
- スキップ: `.thread/20/*.md`（adr / plan / progress / steps / testing） — 作業ログ。plan.md は契約として参照したがレビュー対象外
- スキップ: `packages/core/src/adapters/conformance/oauthStateStore.ts` — ポート適合スイートはアダプター観点
- スキップ: `packages/core/src/application/identity/__tests__/`（abandonOAuthFlow / addPasswordIdentity / authFlowHelpers / completeOAuthCallback / completeOAuthSignIn / linkOAuthIdentity / pruneExpiredAuthState / removeIdentity / requestPasswordReset / resetPassword / startOAuthFlow） — ユースケース／テスト観点
- スキップ: `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/inventory/*.md`, `spec/testcases/identity/*.md`, `spec/usecases/integration.md` — 台帳・ドメイン／DB／TC 側の正典で spec 観点（`spec/adr/034` と `spec/usecases/identity.md` の転送境界に関わる記述だけ突き合わせ済み）
