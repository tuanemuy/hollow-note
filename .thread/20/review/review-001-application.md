# Application

## 総評

ポート契約の変更（条件付き `take`）は、内側から外側へ一貫して波及している。`take` の第 2 引数はユースケース 4 本すべてで `secureTokenGenerator.hashOf(input.stateBinding)` として渡され、取りこぼしは無い（`grep` で `oauthStateStore.take` の呼び出しは適合スイート・memory アダプター・`completeOAuthCallback` / `completeOAuthSignIn` / `linkOAuthIdentity` / `abandonOAuthFlow` の 4 ユースケースに閉じている）。`OAuthFlowState` を組み立てる箇所も 9 ファイルすべてが追随済み。

観点ごとの結論:

- **UoW**: `abandonOAuthFlow` は `run` を張らず、原子的な専用ポート（`OAuthStateStore.take`）1 回だけで完結している。CLAUDE.md の「UoW の外に置く書き込みは専用の atomic ポートを通す」に正しく乗っており、ネストも無い。既存の 3 ユースケースも `take` の位置は不変
- **DTO の秘密露出**: `StartOAuthFlowView` から `state` が落ち、代わりに載る `stateBinding` は転送境界で `HttpOnly` Cookie に焼かれるだけで、`startOAuthSignInFn` / `startOAuthLinkFn` のいずれもクライアント応答には `authorizationUrl` しか返していない。`AbandonOAuthFlowView.abandoned` も `abandonOAuthFlowFn` が `null` に潰していて、外へ出る oracle にはなっていない
- **digest の扱い**: 比較は memory アダプター内の `!==`（非定数時間）だが、比較対象は平文ではなく SHA-256 digest で、既存の `sessionRepository` / `authTokenRepository` の `tokenHash === tokenHash` と同じ形。digest を知っても原像は作れないので、ここは指摘しない
- **ログ**: OAuth 系ユースケースは `logger` を一切呼んでおらず、`errorResponseMiddleware` も入力 `data` を記録しない。`stateBinding` がログへ出る経路は無い
- **テストの実効性**: `startOAuthFlow.test.ts` の TC-identity-336 は肯定 1 本＋否定 2 本で「`state` から導けない」を実際に落とせる形になっている（`saved?.stateBindingHash` の optional chaining は先行する肯定アサーションが `undefined` を弾くので形骸化しない）。`completeOAuthCallback.test.ts` の TC-identity-337 は「不一致 → 行が残る → 正しい束縛で完了できる」まで通しており、消費されていないことを結果で確かめている。配線テストが `take` を実アダプターに委譲したまま `vi.fn` で包んだ判断（ADR-010）も、AC-1 の主体をモックから実装へ戻していて妥当
- **コメント**: 弁明・修正経緯の残骸は無い。`abandonOAuthFlow.ts` の `UC-identity-025, spec/usecases/identity.md#abandonoauthflow` は ADR 番号ではなく、`createBlankNote.ts` / `requestPasswordReset.ts` と同じ既存の書式なので問題無い

Blocker は無い。以下は契約の記述精度（Issue #20 の引き継ぎ元がまさに「JSDoc の過剰主張」だったので、同じ轍を踏んでいないかを厳しく見た結果）に関わる 4 件。

## Blockers

なし

## Warnings

- **[W-001]** 契約に新しく規範として書いた「一致すれば期限切れでも削除する」象限を、適合スイートが 1 つも検証していない
  - 場所: `packages/core/src/application/ports/oauthStateStore.ts:38-40` / `packages/core/src/adapters/conformance/oauthStateStore.ts:68-74`
  - 理由: JSDoc は 4 象限すべてを規範として決着させたと宣言している（「settles all four quadrants」）が、適合スイートで観測されるのは「一致 × 期限内」「不一致 × 期限内」の 2 つだけ。期限切れのケース（68-74 行）は `take` が `null` を返すことしか見ておらず、**行が削除されたか**を見ていない。ADR-009 は「観測差として現れるのは『不一致では消費されない』だけ」を根拠にケース追加を不要としているが、同じ ADR 自身が「『行が消えたか』は `deleteExpired` の件数として同じポートから観測できる」と認めており、根拠が自己矛盾している。実際、`DELETE … WHERE state = ? AND binding_hash = ? AND expires_at > ?` と書いた将来のバックエンドは、書かれた契約に違反したまま適合スイートを全部通る。CLAUDE.md「Adding a contractual behaviour means touching both the port JSDoc and the suite」に照らすと、規範だけが増えて実行形が増えていない状態
  - 提案: 68-74 行のケースの末尾に「行が残っていないこと」を足す（`take` の直後に `deleteExpired(now, null, 10)` を呼んで `deleted === 0` を期待する。同じポートだけで観測できる）。それを入れないのであれば、JSDoc から「settles all four quadrants」と「On a match it is deleted even if expired」を規範ではない実装ノート側へ降ろし、契約の主張を実際に強制できる範囲（不一致は消費しない）に揃える

- **[W-002]** 契約の 4 象限が、同じ PR で書いた下流の正典と 2 か所で食い違っている
  - 場所: `spec/usecases/identity.md:378`（`abandonOAuthFlow` の処理フロー手順 2）、`spec/adr/034-oauth-callback-browser-binding.md`（「影響」の「消費済みでも Cookie が残るケース」）
  - 理由: ポート契約は「一致 × 期限切れ」で行を**削除する**と決めたが、`spec/usecases/identity.md` の `abandonOAuthFlow` 手順 2 は「`null`（束縛不一致・行が無い・**期限切れ**）なら `{ abandoned: false }` で、**行は残したままにする**」と書いており、期限切れ × 一致の象限で正典どうしが正面から矛盾する。同じ象限は消費経路にもあり、ADR 034 の「消費済みでも Cookie が残るケースがある（provider 不一致・`integration` intent）」という列挙も、期限切れ一致（行は消えるが `OAUTH_STATE_INVALID` なので Cookie は残る）を落としている。契約の記述精度がこの Issue の主題なので、新しく書いた文がその主題で緩んでいるのは残せない
  - 提案: 手順 2 を「`null`（束縛不一致・行が無い）なら行を残したまま `{ abandoned: false }`。期限切れの行は束縛が一致していれば解放されるが、同じく `{ abandoned: false }`」の形に直す。ADR 034 の列挙にも「期限切れ」を足す

- **[W-003]** `abandonOAuthFlow` の「エラーケース: なし」が、ポートが宣言する `SystemError(DatabaseError)` を無視している。しかも唯一の呼び出し元がページの loader で、この例外を吸収していない
  - 場所: `spec/usecases/identity.md:381`（エラーケース）/ `packages/core/src/application/identity/abandonOAuthFlow.ts:24` / `apps/web/app/routes/auth/callback.$provider.tsx:30`
  - 理由: `OAuthStateStore` の error contract は `SystemError(DatabaseError)` で、`abandonOAuthFlow` はそれを一切畳まずそのまま投げる。他のユースケース節（`completeOAuthSignIn` は `SystemError(ExternalApiError)` を列挙）と比べて、この節だけが伝搬するシステムエラーを書いていない。実害の側面もある — 変更前の破棄は `clearBoundOAuthStateCookie`（Cookie 操作だけ、I/O 無し）で**原理的に失敗しえなかった**のに、いまはストアへの書き込みになり、`callback.$provider.tsx:30` は `await abandonOAuthFlowFn(...)` を裸で呼んでいるので、後始末の失敗がコールバック画面そのものの描画失敗（loader の reject）に化ける。参照ランタイム（memory）では起きないが、D1 バックエンドでは「取り残し Cookie の掃除に失敗したせいで、利用者がキャンセル理由の画面すら見られない」になる。CLAUDE.md がベストエフォートの掃除に許している形（per-row tolerance）とも合わない
  - 提案: 仕様側は「エラーケース: `SystemError(DatabaseError)`（ストアの契約をそのまま伝える）」に直す。実装側は、後始末をベストエフォートに保つなら `callback.$provider.tsx` の loader 呼び出しを境界の `try / catch` で包み、失敗しても画面は描く（この 1 か所は CLAUDE.md が許す「明示的な境界」に当たる）

- **[W-004]** UC 台帳のうち、同じ変更を受けた 4 行だけが旧記述のまま（AC-6 未達）
  - 場所: `spec/inventory/usecase.md:18,19,38,39`（UC-identity-006 / 007 / UC-integration-001 / 002）
  - 理由: AC-6 は `spec/inventory/` の各行が実装と一致することを求めている。UC-identity-005 / 024 は「束縛が一致したときだけ消費する」に更新されたのに、同じ `take` を呼ぶ UC-identity-006 / 007 と UC-integration-002 は「OAuth state を単回消費し」のまま。とくに UC-integration-001 は、`spec/usecases/integration.md` の出力 DTO が `authorizationUrl` から `authorizationUrl, stateBinding` へ変わったのに台帳の説明が「認可 URL を返す」のままで、UC-identity-005 に対して施した修正と非対称になっている（`progress.md` に残件として記録されているが、AC-6 の観点では未達のまま）
  - 提案: 4 行の説明文に束縛の条件を足す。UC-integration-001 は出力に束縛の秘密が加わったことまで書く（本文が変わった以上、台帳は生成物として追随する）

- **[W-005]** 契約の実装ノートが、正典の表に存在しない列名を指している
  - 場所: `packages/core/src/application/ports/oauthStateStore.ts:45` / `spec/domains/index.md:241` / `packages/core/src/adapters/memory/repositories/oauthStateStore.ts:28`
  - 理由: 3 か所とも `DELETE … WHERE state = ? AND binding_hash = ? RETURNING *` と書いているが、`spec/database/index.md:601` が定義した列は `state_binding_hash` で、同ファイル 608 行の SQL も `state_binding_hash` を使っている。plan.md のリスク欄が避けようとしていた「正典どうしの食い違い」（`WHERE` に使う列が表定義に無い）が、列を足した後も列名の不一致として残っている。将来のバックエンド実装者がそのまま写すと通らない SQL
  - 提案: 3 か所を `state_binding_hash` に揃える（表の側が 1 対 1 写しの正典なので、そちらに合わせる）

## 受け入れ基準の検証（自観点分）

| AC | 判定 | 根拠 |
|---|---|---|
| AC-1（ユースケース層の分） | 満たす | `completeOAuthCallback.test.ts` TC-identity-337 が `OAUTH_STATE_INVALID` と行の残存、その後の完了までを固定 |
| AC-2 | 概ね満たす（W-001） | 「不一致では消費されない」は JSDoc・適合スイート双方にある。ただし同時に足した「一致 × 期限切れ」の規範は JSDoc だけにある |
| AC-3 | 満たす | 一致時の単回消費と完了は `completeOAuthCallback` / `completeOAuthSignIn` / `linkOAuthIdentity` の既存テスト群が新入力で通している |
| AC-5 | 満たす | `abandonOAuthFlow.test.ts` の TC-identity-338/339 が「一致で行が消える」「不一致で行が残る」を直接観測 |
| AC-6（usecase / ports 関連分） | 未達（W-002 / W-004 / W-005） | 上記 3 件 |
| AC-8 | 満たす | `StartOAuthFlowView` から `state` が消え、TC-identity-336 が否定アサーション 2 本を持つ |

## スコープ逸脱

無し。`spec/usecases/integration.md` の更新は「実装はしないが正典が偽になる記述は残せない」として plan.md が明示的にスコープ内としたもので、Integration スライスの実装コードは 1 行も入っていない（`grep` で `startIntegrationOAuth` / `completeIntegrationOAuth` の実装ファイルは存在しないことを確認）。

## カバレッジ

- 確認: `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/identity/__tests__/abandonOAuthFlow.test.ts`, `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts`, `packages/core/src/application/identity/__tests__/authFlowHelpers.ts`, `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`, `packages/core/src/application/identity/__tests__/resetPassword.test.ts`, `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/oauthStateBinding.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`, `spec/usecases/identity.md`, `spec/usecases/integration.md`, `spec/domains/index.md`, `spec/domains/identity.md`, `spec/database/index.md`, `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/inventory/usecase.md`, `spec/inventory/test.md`, `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/testcases/identity/abandonOAuthFlow.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/startOAuthFlow.md`, `.thread/20/plan.md`, `.thread/20/adr.md`, `.thread/20/steps.md`, `.thread/20/progress.md`
- スキップ: `.thread/20/testing.md` — ブラウザーでの手動動作確認手順書で、ユースケース／ポート契約の判断材料を含まない

（確認 45 + スキップ 1 = 46。変更ファイル一覧と 1 対 1。）

## 差分外で参照したファイル

`packages/core/src/domain/identity/ports/secureTokenGenerator.ts`, `packages/core/src/domain/identity/valueObject.ts`, `packages/core/src/adapters/memory/secureTokenGenerator.ts`, `packages/core/src/application/types.ts`, `packages/core/src/adapters/memory/__tests__/conformance.test.ts`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/presentation/errorResponse.ts`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `packages/core/src/adapters/memory/repositories/sessionRepository.ts`, `packages/core/src/adapters/memory/repositories/authTokenRepository.ts`, `spec/testcases/identity/linkOAuthIdentity.md`（step 11 が名指ししたが変更不要だったことを確認）
