# レビュー 002 — Presentation（転送境界・server function・Cookie 配線）

対象: PR #34 / Issue #20 / ベース `main`

## Presentation

### Blockers

- **[B-001]** 消費経路の Cookie 破棄条件を説明するコメントが、実装（および ADR 034 決定 3/4）と**逆の規則**を書いている
  - 場所: `apps/web/app/routes/auth/-action.tsx:133-136`
  - 理由: 実装は `serializeError(error)` が `validation` / `OAUTH_STATE_INVALID` **のときだけ残し、それ以外はすべて捨てる**。ところが 133 行の「照合を通らなかったと言い切れない限り捨てない」は「照合失敗と言い切れるときだけ捨てる」＝ちょうど反対の規則になっている。同じコメントの 3 文目「判定を `instanceof` で書くと…取りこぼしが『捨てる』側へ倒れる」は実装どおりの挙動（判別に失敗すると捨てる側に落ちる）を危険として書いているので、コメント内部でも矛盾している。ADR 034 の決定 3 は「消費要求が『state 不正』**以外**で終わったとき」に捨てる、決定 4 は「『state 不正』で終わったときは捨てない」と書いており、正典と一致しているのはコードの側。ここはセキュリティ修正の中心にある分岐で、コメントの規則どおりに条件を書き直すと `OAUTH_STATE_INVALID`（＝他人のブラウザーの進行中フローを指した消費要求）のときにこそ Cookie を落とすことになり、「踏ませるだけで他人のフローを壊せる」経路が復活する。ADR 034 が「安全側に倒して捨てない」と言っているのは行が消えたか判らないケースの話で、`instanceof` を避けた理由（判別漏れが「捨てる」側へ倒れる）と合わせて読むと、書きたかったのは「照合失敗と言い切れるときだけ残す」のはず
  - 提案: 1 文目を実装と正典に合わせる（例: 「`OAUTH_STATE_INVALID` と言い切れるときだけ残す — それが『別のブラウザーの進行中フロー』だと判る唯一の答えで、判らないものを残すと消費済みの Cookie が取り残される」）。`instanceof` を避ける理由の文はそのままで整合する

### Warnings

- **[W-001]** 後始末失敗テストの `expect(outcome.error).not.toBe(failure)` は実装が何であっても真になる。コメントが主張する「ストアの失敗が呼び出し側へ漏れない」を観測していない
  - 場所: `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts:285-287`
  - 理由: `errorResponseMiddleware` は捕まえた throw を必ず `new AppServerError(...)` に詰め替えて投げ直すので、`try/catch` を外しても呼び出し側に届くのは `failure` そのものではない（同一性比較は常に不一致）。加えて、この harness では abandon の応答 `null` が必ず `TypeError: Cannot read properties of null (reading 'context')` になる（コンパイル前の `createServerFn` は client 経路を通り、`next(null)` が `userCtx.context` を読む）ため、`outcome.error` は常にその `TypeError` で埋まる。実測で確認済み。catch を消したときにこのテストを落としているのは 288 行の `logger.error` アサーションだけで、287 行は何も守っていない。「主張は『例外が無い』ではなく…に置く」というコメントは、実際には観測できていない性質を宣言している
  - 提案: `expect(outcome.error).toBeInstanceOf(TypeError)` にすれば「投げ返っているのは harness 由来のものだけ＝ストアの失敗は throw に化けていない」を実際に観測できる（catch を外すと `AppServerError` になって落ちる）。そこまで踏み込まないなら 287 行とコメントの後半は削り、`logger.error` の 1 本に主張を寄せる

- **[W-002]** `abandonOAuthFlowFn` の `loadServerDeps` が `try` の外にあり、JSDoc が防ぐと言っている「コールバック画面が落ちる」経路が残っている
  - 場所: `apps/web/app/routes/auth/-action.tsx:68-81`
  - 理由: 55-57 行の JSDoc は「後始末の失敗はここで畳んで記録する。投げ返すと『失敗した往復の理由』を描く画面そのものが落ちる」と書いているが、畳んでいるのはユースケース呼び出しだけ。`loadServerDeps`（コンテナ取得＋ユースケースモジュールの動的 import）が投げると、`routes/auth/callback.$provider.tsx:30` の裸の `await abandonOAuthFlowFn(...)` がそのまま reject し、loader ごとコールバック画面が落ちる。参照ランタイムでは起きにくいが、防ぎたい失敗の種類（後始末は best-effort）としては同類
  - 提案: `loadServerDeps` の呼び出しを `try` の中に入れる（Cookie 不在の早期 return は今のまま `try` の外でよい）

### 確認した性質（指摘ではない）

- **Cookie 属性の退行なし**: `setOAuthStateCookie` は `httpOnly` / `sameSite: "lax"` / `path: "/"` / `secure: !isDevelopment()` / `expires = now + OAUTH_STATE_TTL_MS`、`clearOAuthStateCookie` は同じ属性で `Max-Age=0`。差分で変わったのは値の出所（`await deriveOAuthStateBinding(state)` → 引数の `stateBinding`）と `async` が取れたことだけで、AC-3 の「属性は現状のまま」を満たす。破棄側の `Path` / `Secure` が生成側と一致しているので実際に消える
- **秘密の露出なし**: `startOAuthSignInFn` / `startOAuthLinkFn` の戻り値は `{ authorizationUrl }` だけで `stateBinding` はクライアントへ返らない（`StartOAuthFlowView` から `state` も落ちた）。束縛値はエラーメッセージ（`requireOAuthStateCookie` / `oauthStateInvalid` はいずれも固定文）にもリダイレクト URL にも載らず、`logger.error("Abandoning the OAuth flow failed", { cause })` は Logger ポートの `cause` 規約どおりで束縛値を含まない
- **`instanceof` 依存なし**: 破棄条件は `serializeError` の構造（`kind` / `code`）で判定しており、`isSerializableError` が duck typing なのでモジュールグラフが分かれても判定が変わらない
- **2 つの開始経路が同形**: `routes/auth/-action.tsx:37` と `routes/settings/-action.tsx:315` はどちらも `setOAuthStateCookie(view.stateBinding, container.clock.now())` の 1 行で、掛け方に差が無い（配線テストが実値で押さえるのはサインイン側だけだが、`stateBinding` への改名は typecheck が取りこぼしを検出する — `pnpm typecheck` は通過）
- **catch の広さ**: `abandonOAuthFlowFn` の catch はユースケース呼び出しと Cookie 破棄だけを囲み、validator / CSRF の失敗（middleware 側）は飲み込まない。この経路のユースケースは redirect / notFound を投げないので、`errorResponseMiddleware` のような除外は不要。`completeOAuthCallbackFn` の catch は判定して**投げ直す**ので、握り潰しではない。CLAUDE.md の「境界に限る」に収まっている
- **削除物の参照残り無し**: `oauthStateBinding` / `deriveOAuthStateBinding` / `assertOAuthStateBinding` / `assertOAuthStateCookie` / `clearBoundOAuthStateCookie` はコード・`spec/` のどこからも参照されていない（残るのは `.thread/` の作業ログのみ）。配線テストは `node:crypto` のローカル `sha256` に置き換わっている
- **GET で行が消える点**: 破棄は loader（GET）から走るが、`SameSite=Lax` により `<img>` 等のサブリソース要求には束縛 Cookie が乗らず、Cookie が無ければユースケースを呼ばずに return する。ADR 034 決定 3 の範囲内
- **弁明・経緯コメント無し**: コード側のコメントはいずれも WHY で、ADR 番号の引用も無い

### カバレッジ

- 確認: `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/oauthStateBinding.ts`（削除）, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`（削除）, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`, `packages/core/src/application/identity/view.ts`（転送境界へ出る DTO / AC-8）, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`（境界が呼ぶ契約と `OAUTH_STATE_INVALID` の出所）, `spec/adr/034-oauth-callback-browser-binding.md`（決定 3/4 と実装の照合）
- 差分外の参照: `apps/web/app/presentation/errorResponse.ts`, `errorResponseMiddleware.ts`, `session.ts`, `serverAction.ts`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `packages/core/src/application/ports/logger.ts`, `packages/core/src/lib/error.ts`
- スキップ: `.thread/20/**` — 計画・レビュー作業の記録（`plan.md` / `triage-keys.md` は判定基準として参照）
- スキップ: `packages/core/src/application/identity/startOAuthFlow.ts`, `completeOAuthSignIn.ts`, `linkOAuthIdentity.ts`, `packages/core/src/application/identity/__tests__/**` — 転送境界に露出しない応用層（Application 観点）
- スキップ: `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts` — ポート契約・アダプター観点
- スキップ: `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/**`, `spec/inventory/**`, `spec/testcases/**`, `spec/usecases/**` — spec 観点（AC-6）
