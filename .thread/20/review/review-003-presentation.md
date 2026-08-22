# レビュー R003 — Presentation

対象: PR #34 / Issue #20（OAuth 束縛 Cookie を `state` から独立した乱数にする）

### Presentation

#### Blockers

なし

#### Warnings

なし

#### 検証したこと

**Cookie 属性の退行なし（AC-3）**

`setOAuthStateCookie` は `httpOnly: true` / `sameSite: "lax"` / `path: "/"` / `secure: !isDevelopment()` / `expires = now + OAUTH_STATE_TTL_MS`、`clearOAuthStateCookie` は同じ `httpOnly` / `sameSite` / `path` / `secure` で `Max-Age=0`。差分で変わったのは値の出所（`await deriveOAuthStateBinding(state)` → 引数の `stateBinding`）と `async` が取れたことだけで、属性は 1 つも触られていない。破棄側の `Path` / `Secure` が生成側と一致しているので実際に消える。

Cookie に載る値は `secureTokenGenerator.issue()` の base64url（32 バイト）なので、`;` / `,` / 空白を含まず Cookie の区切りと衝突しない。

**束縛の秘密がクライアントへ出ていない（AC-8）**

`stateBinding` / `hollow_oauth_state` の出現箇所を `apps/web/app` 全体で走査した結果、値が触れるのは `setOAuthStateCookie` の `Set-Cookie`、`readOAuthStateCookie` / `requireOAuthStateCookie` の読み出し、ユースケース入力の 3 か所だけ。2 つの開始 server function はどちらも `{ authorizationUrl }` しか返さず、`abandonOAuthFlowFn` は `null` 固定、`completeOAuthCallbackFn` は intent 付き判別共用体で、いずれにも束縛も `state` も乗らない。`StartOAuthFlowView` から `state` が消えたので、`setOAuthStateCookie(view.state)` のまま型が通る退行経路も無い。

ログ経路も確認した。`abandonOAuthFlowFn` の `container.logger.error("Abandoning the OAuth flow failed", { cause })` が渡すのはストア由来の例外だけで、束縛は入っていない。`errorResponseMiddleware` の `logServerError` はシリアライズ済みエラーしか受け取らず、`validateInput` の `fieldErrors` は転送された入力（`provider` / `state` / `code`）だけを対象にする — 束縛は Cookie から来るので validator を通らない。リダイレクト URL は `authorizationUrl` のみ。

**2 つの開始経路が同じ掛け方（AC-3 / plan.md の追随対象）**

`routes/auth/-action.tsx:38`（`startOAuthSignInFn`）と `routes/settings/-action.tsx:315`（`startOAuthLinkFn`）はどちらも `stateCookie.setOAuthStateCookie(view.stateBinding, container.clock.now())` の 1 行で、引数・時計・返り値の絞り方まで一致している。

**`abandonOAuthFlowFn` の `try / catch`（`routes/auth/-action.tsx:65-88`）**

Cookie 不在は `try` の前に `return null` で抜けるので、ユースケースもコンテナ取得も走らない。`try` が覆うのは `loadServerDeps` / `abandonOAuthFlow` / `clearOAuthStateCookie` の 3 つで、いずれも「失敗しても Cookie と `state` 行が残る」＝安全な向きに倒れる。飲み込んではいけないものは通っていない（この経路には `redirect` / `notFound` を投げる要素が無く、`validateInput` の失敗はハンドラーの外なので畳まれない）。JSDoc の「畳む対象にはコンテナの取得も含める。取得自体が失敗したときは記録先の logger も無いので、記録は残らず画面だけが生き残る」は `container?.logger.error(...)` の実装そのままで、齟齬は無い。呼び出し元（`routes/auth/callback.$provider.tsx:30`）が loader から裸で `await` している以上、ここで畳むのは妥当。

**Cookie の破棄条件が安全な向きに倒れている（AC-5）**

`completeOAuthCallbackFn` の catch は `serializeError(error)` の `kind === "validation" && code === "OAUTH_STATE_INVALID"` という**構造判定**で残す／捨てるを決めており、`instanceof` ではない（動的 import でモジュールグラフが分かれても取りこぼしが「捨てる」側へ倒れる、というコメントの理由と実装が一致）。`OAUTH_STATE_INVALID` は `take` が `null` を返した＝行が残っている答えなので、残す判断が「他人の進行中フローを壊さない」向きに正しく効く。

なお `completeOAuthCallback` は `take` 成功後にも provider 不一致と `integration` intent で `oauthStateInvalid()` を投げるため、理屈のうえでは「行は消えたのに Cookie が残る」組み合わせがある。ただし前者はコールバック URL を改竄しない限り起きず、後者は当該 intent の行をこのアプリがまだ発行しない。取り残された Cookie も寿命が `state` 行と同じで、次のフロー開始で上書きされる。実害が無いので指摘には起こさない。

**配線テストのアサーションが実体を見ている（AC-1 / AC-4 / AC-5）**

`pnpm exec vitest run apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts` は 8 件すべて緑。Cookie の読み書きはモックせず、実 `Cookie` ヘッダーと `response.headers.getSetCookie()` で観測している。各ケースが実際に落とせる退行を持つことを確認した。

- 生成: `Set-Cookie` に `BINDING` が載り、`STATE` も `sha256(STATE)` も含まない ＋ `HttpOnly` / `SameSite=Lax` / `Path=/`
- 照合（Cookie 不在）: `OAUTH_STATE_INVALID` ＋ `take` 未呼び出し ＋ `backend.oauthStates` に行が残る — 転送境界で畳んでいることを未呼び出しで観測
- 照合（`state` だけを知る第三者）: `STATE` / `sha256(STATE)` / 任意文字列の 3 通りをループし、毎回 `OAUTH_STATE_INVALID` ＋ 行が残る ＋ `Set-Cookie` が出ない
- 照合（一致）: 行が消え、`OAUTH_EMAIL_UNVERIFIED`（交換をスタブで決定的に失敗させたもの）で `Max-Age=0` の破棄が出る — 「`OAUTH_STATE_INVALID` 以外は捨てる」を実際に踏んでいる
- 破棄 3 経路: 一致で Cookie と行の両方が落ち、不一致は `take` が 1 回呼ばれたうえで両方残り、Cookie 不在では `take` 未呼び出しで `setCookie` が空

`take` は `vi.fn(store.take)` で参照アダプターに委譲したままなので、条件付き消費がテスト側に移っていない。`toBeInstanceOf(TypeError)` の 1 本は harness 由来の応答エラーを見ているが、畳むのをやめるとストアの失敗が `AppServerError` として投げ返るため退行を区別できる（同ケースの本体は `logger.error` の引数一致）。

**削除物の参照残り無し**

`oauthStateBinding` / `deriveOAuthStateBinding` / `assertOAuthStateBinding` / `assertOAuthStateCookie` / `clearBoundOAuthStateCookie` をコード・`spec/` 全文で検索した結果、ヒットは `.thread/` の作業記録のみ。配線テストの `sha256` はテストローカルの `node:crypto` ヘルパーに置き換わっている。

**残す必要のない記述**

差分に入ったコメント・JSDoc はいずれも理由（why）を書いており、修正の経緯・弁明・ADR 番号の引用は無い。

#### カバレッジ

- 確認: `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/oauthStateBinding.ts`（削除）, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`（削除）, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`, `packages/core/src/application/identity/view.ts`（転送境界へ出る DTO）, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`（境界が呼ぶ契約と `OAUTH_STATE_INVALID` の出所）
- 参照（差分外）: `apps/web/app/presentation/errorResponse.ts`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `apps/web/app/presentation/serverAction.ts`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `packages/core/src/adapters/memory/secureTokenGenerator.ts`
- スキップ: `.thread/20/`（adr.md / plan.md / progress.md / steps.md / testing.md）— 作業記録と契約で、レビュー対象コードではない
- スキップ: `packages/core/src/adapters/`（conformance/oauthStateStore.ts, memory/repositories/oauthStateStore.ts）— ポート契約と参照バックエンドで Adapter 観点
- スキップ: `packages/core/src/application/ports/oauthStateStore.ts` — ポート契約の正本で Adapter / Application 観点
- スキップ: `packages/core/src/application/identity/`（completeOAuthSignIn.ts, linkOAuthIdentity.ts）— 転送境界に露出しないユースケース内部で Application 観点
- スキップ: `packages/core/src/application/identity/__tests__/`（abandonOAuthFlow / addPasswordIdentity / authFlowHelpers / completeOAuthCallback / completeOAuthSignIn / linkOAuthIdentity / pruneExpiredAuthState / removeIdentity / requestPasswordReset / resetPassword / startOAuthFlow）— ユースケース層の単体テストで Application / Test 観点
- スキップ: `spec/`（adr/034, adr/index.md, database/index.md, domains/identity.md, domains/index.md, inventory/{adapter,domain,test,usecase}.md, manual-tests/account.md, testcases/identity/{abandonOAuthFlow,completeOAuthCallback,completeOAuthSignIn,startOAuthFlow}.md, usecases/identity.md, usecases/integration.md）— 設計正典の追随で Spec 観点
