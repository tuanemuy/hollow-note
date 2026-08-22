# 実装計画 — Issue #20: [security] OAuth 束縛 Cookie を state から独立した乱数にする

**Issue:** #20
**作成日:** 2026-08-22
**規模:** 通常
**実装方針:** steps.md

---

## 目的

OAuth の認可往復に付ける束縛 Cookie を `sha256(state)` から `state` と独立した一回限りの乱数に変え、その digest をフロー状態が持つことで、束縛を「攻撃者が被害者のブラウザーへ持ち込めない」だけでなく「`state` を握った第三者にも再現できない」双方向のものにする。

## 受け入れ基準

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | `hollow_oauth_state` の値が `state` から計算できない独立した乱数になっている。`state` だけを知る第三者が用意できる値（`state` そのもの・`sha256(state)`・任意の文字列）を Cookie に載せた消費要求は `ValidationError("OAUTH_STATE_INVALID")` になる。これを `oauthStateBindingWiring.test.ts` が実 `Cookie` ヘッダーで固定する。あわせて、ユースケース層でも束縛不一致が `OAUTH_STATE_INVALID` になり、かつ `state` が消費されない（＝正しい束縛で後から完了できる）ことを `completeOAuthCallback` の単体テストが固定する。**束縛 Cookie が無い**消費要求も、ユースケースを呼ぶ前に `OAUTH_STATE_INVALID` になり `state` 行は消費されない（`requireOAuthStateCookie()` が転送境界で畳む）。`abandonOAuthFlowFn` も Cookie 不在では何もしない。これも同じ配線テストが `backend.oauthStates` に行が残ることまで含めて固定する | Issue 本文「対応案」「受け入れ基準」「成立している保護」 | 1, 2, 3, 5, 6, 7, 8, 9, 10 |
| AC-2 | 束縛が一致しない消費要求では `state` 行が消費されない（後から正しい束縛で消費できる）。この性質がポート契約の JSDoc と適合スイートの双方に書かれている | Issue 本文「影響範囲」＋ CLAUDE.md「Port contracts and conformance」＋ ADR 034 決定 2 | 1, 2, 3, 4 |
| AC-3 | 束縛が一致した消費要求は従来どおり `state` を単回消費し、サインイン／連携を完了できる。完了までを担保するのは**ステップ 7 のユースケース単体テスト**（配線テストが見るのは行が消えることと Cookie の破棄までで、交換の成否は見ない）。`Set-Cookie` の属性（`HttpOnly` / `SameSite=Lax` / `Path=/`、寿命は `state` 行と同じ）は現状のまま | 既存の ADR 034 決定 1、退行防止 | 4, 5, 6, 7, 9, 10 |
| AC-4 | 生成・照合・破棄の 3 経路が `oauthStateBindingWiring.test.ts` に残り、実 `Set-Cookie` / `Cookie` ヘッダーで検証されている | Issue 本文「受け入れ基準」 | 9, 10 |
| AC-5 | 束縛が一致しない `state` を指した破棄要求（`abandonOAuthFlowFn`）は、Cookie も `state` 行も落とさない。逆に束縛が一致した破棄要求は `state` 行を解放し（TTL を待たない）、Cookie を落とす | ADR 034 決定 3/4 の維持＋放棄経路の新しい振る舞い | 6, 7, 9, 10 |
| AC-6 | `spec/` が実装と一致している — `spec/adr/034` のタイトルと本文（決定セクションの**前文**・決定リスト・リスト後の**理由段落**・**検討した代替案**・影響）、`spec/adr/index.md` の一覧行と前提依存マップ、`spec/domains/index.md` のポート定義、`spec/database/index.md` の `oauth_flow_states` テーブル定義、`spec/domains/identity.md` の「ユースケース（概要）」の列挙、`spec/usecases/identity.md` の入出力 DTO と処理フロー、`spec/usecases/integration.md` の `startIntegrationOAuth` / `completeIntegrationOAuth` の記述、`spec/testcases/identity/` と `spec/inventory/` の各行（「最終同期」日付を含む） | CLAUDE.md「spec/ は現在有効な設計の正典」 | 1, 11 |
| AC-7 | `pnpm typecheck && pnpm lint:fix && pnpm format` と `pnpm test` が通る | CLAUDE.md 開発コマンド | 12 |
| AC-8 | `startOAuthFlow` の出力は束縛の秘密だけを露出し、`state` を転送境界へ出さない（`StartOAuthFlowView` に `state` は無い）。`startOAuthFlow` の単体テストが `view.stateBinding !== state` と `saved.stateBindingHash !== hashOf(state)` の 2 本で、束縛が `state` から導けないことを固定する | adr.md ADR-003（`state` を残すと単回消費の資格情報が転送境界へ出続け、`setOAuthStateCookie(view.state)` のままでも型が通る退行経路が残る） | 5, 7, 11 |

紐づけは双方向で閉じている — 全 AC が 1 つ以上のステップを指し、steps.md の 12 ステップはすべてどれかの AC から参照されている（孤立ステップは無い）。

## スコープ

### 含まれないもの

- **Integration スライス（`startIntegrationOAuth` / `completeIntegrationOAuth`）の実装** — 同じポートを共有するので `OAuthFlowState` の新フィールドは intent を問わず必須にするが、未実装のユースケース自体はこの Issue で作らない
- **`state` の TTL・単回消費・PKCE の設計変更** — この Issue で塞ぐのは「Cookie 値が `state` から導出できる」点だけで、Issue 本文どおりそれらはこの経路を止められないという評価も変えない
- **セッション Cookie・確認待ち Cookie（ADR 029）への波及** — 値が往復しない（`userId` / セッショントークン）ので同じ弱点を持たない
- **束縛 Cookie を複数本にしてフローの並行開始を許すこと** — ADR 034 が受容した縮退のままにする
- **`OAUTH_STATE_INVALID` の細分化** — 原因を区別しても利用者の取れる行動は変わらない（ADR 034 決定 2 の畳み込みを維持）

## リスクと注意点

- **`take` の署名変更は 3 か所の呼び出しと単体テスト群に波及する** — `completeOAuthCallback` / `completeOAuthSignIn` / `linkOAuthIdentity`、および `authFlowHelpers.ts` を経由する identity のテスト。取りこぼすと型エラーで落ちるので検出はできるが、変更量は最大の箇所
- **転送境界からは「不一致では消費されない」を観測できない** — 配線テストの `oauthStateStore` は手書きモックにせず memory の参照アダプターを差し、条件付き消費を本物にする。行が残ることは `backend.oauthStates` から直接観測する。契約そのものの検証は引き続き適合スイートが正本
- **破棄経路の意味が変わる** — `abandonOAuthFlow` は Cookie を捨てるだけでなく `state` 行を消費するようになる。loader から呼ばれる経路なので、「束縛 Cookie を持つ本人しか壊せない」ことを崩さない（無条件破棄にしない）
- **消費経路の Cookie 破棄条件が変わる**（`OAUTH_STATE_INVALID` のときは捨てない）。`OAuthCallbackPanel` の「もう一度試す（exchange）」は要求がサーバーに届いていないときだけ出るので、この変更で再試行導線は壊れない。ここは退行に気づきにくいので配線テストで固定する
- **`OAuthFlowState` に必須フィールドが増える** — テストが直接 `put` している箇所（`completeOAuthCallback.test.ts` の integration intent、`pruneExpiredAuthState.test.ts`）が追随対象
- **`StartOAuthFlowView` から `state` を落とす**ため、view を読む箇所が追随する — サインイン開始（`apps/web/app/routes/auth/-action.tsx` の `startOAuthSignInFn`）と**連携開始**（`apps/web/app/routes/settings/-action.tsx` の `startOAuthLinkFn`）の 2 か所、および `startOAuthFlow.test.ts` / 配線テスト。`state` を**追加ではなく改名**（`stateBinding` へ置き換え）するので、取りこぼしは typecheck が検出する（AC-7）。配線テストが実値で押さえるのはサインイン開始の 1 経路で、連携開始（`startOAuthLinkFn`）の追随はこの型エラーに委ねる
- **spec の追随漏れ** — ADR 034 のタイトルと本文（決定・検討した代替案・影響）をそのままにすると、「Cookie の値は `state` の SHA-256」「照合は転送境界」「照合をユースケースの中に置く案は却下」という現在有効でない記述が正典に残る。`abandonOAuthFlow` を足す以上 `spec/domains/identity.md` のユースケース列挙も偽になる。`spec/database/index.md` の `oauth_flow_states` 表は `OAuthFlowState` の列を 1 対 1 で写した正典なので、`state_binding_hash` を足さないと `spec/domains/index.md` に書く `WHERE … binding_hash = ?` と正典どうしで食い違う。台帳（DOM-common-038 / ADP-common-037 / UC / TC）の説明文と「最終同期」日付も同時に直す。未実装の Integration スライスも同じポートを共有するので `spec/usecases/integration.md` が追随対象に入る（実装はしないが、正典が偽になる記述は残せない）

## テスト方針

- **ポート適合スイート**（`adapters/conformance/oauthStateStore.ts`）— 契約の実行形。既存 4 ケースを新署名へ移し、次を足す
  - 束縛が一致すれば 1 回だけ flow を返す（既存 ADP-common-036/037 の移設）
  - 束縛が一致しなければ `null` を返し、**行は残る**（続けて正しい束縛で `take` すると flow が返る）
  - 期限切れは束縛が一致しても `null`
  - 同じ束縛での並行 `take` は非 `null` がちょうど 1 つ
- **ユースケース単体テスト**（`application/identity/__tests__/`）— TC id を名前に持つ既存テストを新入力へ追随させ、次を足す
  - `completeOAuthCallback`: 束縛不一致は `OAUTH_STATE_INVALID` で、その後も正しい束縛なら完了できる（＝消費されていない）
  - `startOAuthFlow`: 保存された flow の `stateBindingHash` が返した `stateBinding` の `hashOf` と一致し、`state`（`authorizationUrl` 上の値）からは導けない — 後者は `view.stateBinding !== state` と `saved.stateBindingHash !== hashOf(state)` の否定アサーション 2 本で書き下す（AC-8）
  - `abandonOAuthFlow`: 一致で消費して `true`、不一致は行を残して `false`
- **配線テスト**（`apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`）— 1 リクエスト分の実行文脈で実ヘッダーを観測する既存の形を保ち、3 経路を維持したうえで、コンテナには memory の参照アダプター（`MemoryBackend` ＋ `createMemoryOAuthStateStore` ＋ `createNodeSecureTokenGenerator`）を差す
  - 生成: `Set-Cookie` の値が usecase の返した `stateBinding` であり、`state` からも `sha256(state)` からも一致しない
  - 照合: `state` だけを知る第三者の Cookie（`state` / `sha256(state)`）では `OAUTH_STATE_INVALID` で、`backend.oauthStates` に行が残る（AC-1）
  - 照合: 正しい束縛なら行が消え、`OAUTH_STATE_INVALID` でない失敗として Cookie が落ちる（交換の成否はここでは見ない。`config.appUrl` と `signInOAuthClient.exchangeCode` のスタブを置いて失敗を決定的にする）
  - 破棄: 一致した束縛の消費要求は Cookie を落とし、`OAUTH_STATE_INVALID` では落とさない
  - 破棄: 別ブラウザーのフローを指す `abandon` は Cookie も行も落とさない。一致した `abandon` は両方落とす
  - 破棄: 束縛 Cookie が無い `abandon` はユースケースを呼ばず、`Set-Cookie` も出さず、行も残る（AC-1）
  - `sha256(STATE)` の計算元はテストローカルの `node:crypto` ヘルパー（削除する `oauthStateBinding.ts` には依存しない）
- **削除**: `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts` — 対象の純関数（`state` からの導出）が無くなるため。覆っていた性質は適合スイートと配線テストへ移る
- 実行は `pnpm test`（`pnpm exec vitest run packages/core/src/application/identity` と `apps/web/app/presentation` で絞り込みながら進めてよい）
