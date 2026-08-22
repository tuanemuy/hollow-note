# 実装手順 — Issue #20

## 設計

設計判断の経緯は adr.md（ADR-001..009）にある。ここは結果としての形だけを書く。

### ドメインモデルへの影響

ドメインの変更は無い。束縛の秘密は `SecureTokenGenerator`（`domain/identity/ports/secureTokenGenerator.ts`）が既に持つ「`issue()` で `token` を渡し `hash: TokenHash` を持つ」形をそのまま使う。新しい暗号プリミティブも新しい鍵も導入しない。

### ポート契約（`application/ports/oauthStateStore.ts`）

内側で最初に決まるのはここ。

```ts
export type OAuthFlowState = Readonly<{
  provider: string;
  codeVerifier: string;
  redirectTo: string | null;
  intent: "signIn" | "linkIdentity" | "integration";
  userId: UserId | null;
  userAuthEpoch: number | null;
  /** 束縛の秘密の digest。intent を問わず必須。 */
  stateBindingHash: TokenHash;
}>;

export interface OAuthStateStore {
  put(state: string, value: OAuthFlowState, ttlMs: number): Promise<void>;
  take(state: string, stateBindingHash: TokenHash): Promise<OAuthFlowState | null>;
  deleteExpired(now: Date, cursor: string | null, limit: number): Promise<PrunePage>;
}
```

契約（JSDoc に書く内容。適合スイートがその実行形）:

- `take` は get + delete の原子操作である（現状どおり）
- **削除するのは束縛が一致したときだけ。一致すれば期限切れでも削除して `null` を返す。不一致は常に行を残して `null` を返す**
- `stateBindingHash` は不透明な digest であり、ストアはその由来も運搬手段も知らない

削除条件のこの 1 本のルールで 4 象限（一致／不一致 × 期限内／期限切れ）がすべて決まる。判定の順序は契約ではなく実装ノート — memory は「引く → 束縛比較 → 削除 → 期限判定」、D1 は `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *`（`WHERE` に期限を混ぜない）で削除してから返った行の `expires_at` を見て期限切れなら `null`。どちらもこのルールをそのまま満たす。4 象限は行が残るかどうかの差として（`deleteExpired` の件数として）観測できるので、適合スイートも 4 象限とケースを 1 対 1 に対応させる。

`state` を握っただけの要求で行が消費されないことを、呼び出し側の順序ではなく 1 回の原子操作の性質にする。引数として束縛を必ず渡すことは型が保証するが、「Cookie が無い要求を弾く」のは転送境界の `requireOAuthStateCookie()` の役目で、ポート側ではない。

### ユースケース / アプリケーションロジック

- `startOAuthFlow` — `secureTokenGenerator.issue()` をもう 1 本呼び（`state` / `codeVerifier` に続いて 3 本目）、`hash` を `stateBindingHash` として `put` し、`token` を view で返す。`StartOAuthFlowView` は `{ state, authorizationUrl }` → `{ stateBinding, authorizationUrl }`（`state` は転送境界へ出さない）
- `completeOAuthCallback` — 入力に `stateBinding: string` が加わり、`take(input.state, secureTokenGenerator.hashOf(input.stateBinding))` を呼ぶ。以降の分岐は不変
- `completeOAuthSignIn` / `linkOAuthIdentity`（単体の入口）— 同じく入力に `stateBinding` が加わり、同じ形で `take` する。`*ForFlow`（消費済み flow を受け取る内部関数）は不変
- `abandonOAuthFlow`（新規, UC-identity-025）— `{ state, stateBinding }` を受け、`take(state, hashOf(stateBinding))` の結果が非 `null` なら `{ abandoned: true }`。放棄された行をその場で解放し、転送境界に「この Cookie は自分が焼いたものだ」と答える唯一の経路になる
- 照合そのもの（digest 比較）はユースケースには無い。ユースケースがするのは「Cookie 由来の平文を `hashOf` に通してポートへ渡す」ことだけ

### アダプター / 永続化

- `adapters/memory/repositories/oauthStateStore.ts` — `take` を条件付きに。行を引き、`row.value.stateBindingHash !== stateBindingHash` なら**削除せず** `null`。一致したら削除し、期限切れなら `null`、そうでなければ `clone(row.value)`。同期の get → 比較 → delete なのでこのバックエンドでは原子的（現状の `take` と同じ根拠）
- `adapters/memory/store.ts` — `OAuthStateRow` は `value: OAuthFlowState` を丸ごと持つので**変更不要**（実装時に確認する）
- `adapters/conformance/oauthStateStore.ts` — fixture に `stateBindingHash` を足し、全ケースを新署名へ。4 象限（一致／不一致 × 期限内／期限切れ）にケースを 1 対 1 で対応させる
- 将来の D1 実装は `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` で削除し、返った行の `expires_at` を見て期限切れなら `null` を返す形で満たせる（spec/domains/index.md に書く）

### UI / プレゼンテーション

画面・ルーティングに変更は無い（`callback.$provider.tsx` と `OAuthCallbackPanel` は無変更）。変わるのは server function の中の配線だけ。

- `presentation/oauthStateBinding.ts` は**削除**する。`state` からの導出も転送境界での digest 比較も無くなり、残るのは Cookie の運搬だけ
- `presentation/oauthStateCookie.ts` — `setOAuthStateCookie(stateBinding, now)` / `readOAuthStateCookie(): string | null` / `requireOAuthStateCookie(): string`（不在は `ValidationError("OAUTH_STATE_INVALID")`）/ `clearOAuthStateCookie()`。`clearBoundOAuthStateCookie` は廃止（判定材料が転送境界に無い）。Cookie 属性・寿命は現状のまま
- `routes/auth/-action.tsx`
  - `startOAuthSignInFn`: `setOAuthStateCookie(view.stateBinding, clock.now())`
  - `completeOAuthCallbackFn`: Cookie を読み（不在なら即 `OAUTH_STATE_INVALID`）、`stateBinding` を入力に足して usecase を呼ぶ。破棄は「`OAUTH_STATE_INVALID` 以外なら捨てる」（境界の `try / catch` 1 つ）
  - `abandonOAuthFlowFn`: Cookie を読み、不在なら何もしない。`abandonOAuthFlow` が `abandoned: true` を返したときだけ `clearOAuthStateCookie()`。**応答は現行どおり `null`** で、`abandoned` を転送境界の外へは出さない
- `routes/settings/-action.tsx` — `startOAuthLinkFn`（P-22「ログイン方法を追加」の入口）も `startOAuthFlow` を呼び束縛 Cookie を焼いているので、`setOAuthStateCookie(view.stateBinding, container.clock.now())` に揃える。連携の往復にも同じ束縛を掛ける（`startOAuthFlow` の呼び出し元はこの 2 本）
- `OAUTH_STATE_INVALID` かどうかの判定は `serializeError(error)`（`apps/web/app/presentation/errorResponse.ts`）で `kind === "validation" && code === "OAUTH_STATE_INVALID"` を見る構造判定にする。`instanceof` 系の述語（`isValidationError`）は使わない
- Cookie 値の検証は空判定だけ（`session.ts` の `readSessionToken` と同じ扱い）。転送境界の schema 検査はクライアントが送る本文にかかるもので、Cookie はここを通らない

## 実装ステップ

### 1. 設計正典を先に更新する（ADR 034 / ポート定義）

- **対象ファイル:** `spec/adr/034-oauth-callback-browser-binding.md`、`spec/adr/index.md`、`spec/domains/index.md`、`spec/database/index.md`
- **変更内容:**
  - ADR 034: H1 タイトルから「転送境界で」を落とす（照合が転送境界から `take` の原子操作へ移るため。ファイル名 `034-oauth-callback-browser-binding.md` は依然正しいので変えない）。前提に「照合が消費と同一の原子操作であること」を足す。決定 1 を「束縛 Cookie の値は `state` と独立した一回限りの乱数（その digest をフロー行が持つ）」に、決定 2 を「消費は束縛が一致したときだけ起きる条件付きの原子操作で行い、Cookie の不在は転送境界で畳む」に、決定 5 を「Cookie の運搬（焼く・読む・捨てる）は転送境界、値の照合は消費と同じ原子操作」に書き換える。決定 3/4 は破棄の条件を「`OAUTH_STATE_INVALID` 以外なら捨てる／`OAUTH_STATE_INVALID` では捨てない」に具体化する。**番号付きリストの外にある本文も同時に直す** — 決定の見出し直後の前文「[ADR 029] と同じ分担で**転送境界に閉じる**。フロー状態にもユースケースにもブラウザー束縛の概念を入れない。」は改訂後の決定 1 / 2 と正面から矛盾するので、「束縛の秘密の digest だけをフロー状態に持たせ、Cookie の運搬と不在判定は転送境界に残す」旨へ書き換える（読み手が最初に受け取る宣言文なので、ここを残すと改訂後の正典が自己矛盾する）。リスト後の理由段落は 2 つが対象 — 「照合を消費より先に置くのは…」は「照合が消費と同一の原子操作なので、通っていない `state` は消費されない」へ、「Cookie に `state` そのものではなくハッシュを載せるのは…照合に必要なのは同値性だけなので、束縛の強さは変わらない」は末尾の一文（Issue #20 が誤りと判定した主張そのもの）を落とし、前半の理由（`Path=/` の Cookie に単回消費の資格情報を常時運ばせない）を残したうえで「だから Cookie に載せるのは `state` と独立した一回限りの秘密にする」へ書き直す。この前半は改訂後も生きており、検討した代替案で `state` を Cookie 値の digest にする案（`state = sha256(nonce)`）を却下する根拠でもあるので、段落と代替案の記述を対応させる。無条件破棄にしない理由の段落は現在も有効なので維持する。検討した代替案の「フロー状態の行にブラウザー識別子を持たせる」を、採らなかった 2 案（`state` の鍵付き MAC / `state` を Cookie 値の digest にする）に差し替える。同じく検討した代替案の「照合をユースケースの中に置く」は、却下対象を「**消費した後に照合する（`take` の後で比較する）**」形へ限定して書き直す — 改訂後の決定 2 が採るのは照合が消費と同一の原子操作になる条件付き `take` であって、却下されるのは消費が先に走る形だけである（この限定をしないと、却下したはずの案を決定として採っていると読める）。影響から「Cookie に載せるのは `state` の SHA-256」を前提にした記述を落とし、「`state` 単体でも Cookie 単体でも完了できない」を足す。あわせて影響に「消費済みでも Cookie が残るケースがある（provider 不一致・`integration` intent。`OAUTH_STATE_INVALID` は消費の有無と 1 対 1 でないため、安全側に倒して捨てない）。行が消えている以上その Cookie はもう何も通せず、寿命は `state` 行と同じで次の開始が上書きする」を書き足す
  - `spec/adr/index.md`: 一覧行（034 のリンクテキスト）からも「転送境界で」を落とす。前提依存マップの 034 の行は、依存している前提に「照合と消費が同一の原子操作であること」とポート契約・適合スイート（026）を足す。設計上の境界（3 列目）は現在の「認可の完了は開始したブラウザーに束縛する」を**置き換えず併記**する — 「認可の完了は開始したブラウザーに束縛する。運搬と不在判定は転送境界、照合は消費と同じ原子操作」。本 Issue はこの不変条件を初めて成立させる変更なので、層の分担で置き換えると索引から性質そのものが消え、029 行の「認証状態の変更は要求元ブラウザーに束縛する」との対応も崩れる
  - `spec/domains/index.md#OAuthStateStore`: `OAuthFlowState` に `stateBindingHash` を、`take` に第 2 引数を足し、契約をポート JSDoc と同じ 1 本のルールで書く — 「削除するのは束縛が一致したときだけ。一致すれば期限切れでも削除して `null` を返す。不一致は常に行を残して `null` を返す」。実装ノートとして「D1 では `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *`（`WHERE` に期限を混ぜない）で削除し、返った行の `expires_at` を見て期限切れなら `null` を返す」を添える
  - `spec/database/index.md#oauth_flow_states`: 列に `state_binding_hash | text | NOT NULL` を足す。この表は `OAuthFlowState` の列を 1 対 1 で写した正典なので、必須フィールドを 1 つ増やしたことがここに出ないと、同じステップで `spec/domains/index.md` に足す `DELETE … WHERE state = ? AND state_binding_hash = ?` が「`WHERE` に使う列が表定義に無い」正典どうしの矛盾になる。intent と `user_id` / `user_auth_epoch` の CHECK と `oauth_flow_states_expires_idx` は変わらない（束縛は intent を問わず必須で、期限の回収経路も変えないため）。表の下に「`take` は束縛が一致したときだけ削除する条件付き `DELETE … RETURNING` になる」を 1 行添える
- **理由:** spec/ は現在有効な設計の正典で、ADR 034 の決定 1 は本 Issue の変更後は偽になる。コードより先に正典を確定させ、以降のステップはそれに従う

### 2. ポート契約を変える

- **対象ファイル:** `packages/core/src/application/ports/oauthStateStore.ts`
- **変更内容:** `OAuthFlowState.stateBindingHash: TokenHash` を追加（`domain/identity/valueObject` から型 import）。`take(state, stateBindingHash)` に変更。JSDoc に上の契約を書く — 「削除するのは束縛が一致したときだけ。一致すれば期限切れでも削除して `null` を返す。不一致は常に行を残して `null` を返す」を規範として明示し、4 象限すべてを決着させる。判定の順序は規範に含めず、実装ノートとして添えるに留める。`stateBindingHash` の JSDoc には値の由来（`SecureTokenGenerator.issue()` の `hash`）と、運搬手段をストアが知らないことを書く
- **理由:** 契約の正本はポート定義。ここを起点に外側へ広げる（ADR 026）

### 3. memory アダプターを追随させる

- **対象ファイル:** `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`（`packages/core/src/adapters/memory/store.ts` は確認のみ）
- **変更内容:** `take` を「引く → 束縛比較（不一致なら削除せず `null`）→ 削除 → 期限判定」の順に（契約の削除条件をこの順序で満たす。順序そのものは契約ではなく実装ノート）。「不一致で削除しない」理由（踏ませるだけで他人の進行中フローを焼き切れる経路になる）をコメントで残す
- **理由:** 参照バックエンドは契約の実装であって fake ではない（ADR 024）

### 4. 適合スイートに契約を書き足す

- **対象ファイル:** `packages/core/src/adapters/conformance/oauthStateStore.ts`
- **変更内容:** fixture（`signInState` / `integrationState`）に `stateBindingHash` を追加。既存 4 ケースを新署名へ。ケース追加は 4 象限とケースが 1 対 1 になるように — 「束縛が一致しない `take` は `null` を返し、行を消費しない（続けて正しい束縛で `take` すると flow が返る）」「一致 × 期限切れは `null` を返し、行を削除する」「不一致 × 期限切れは `null` を返し、行を残す」。あわせて「`take` の鍵は `state` と束縛の両方で、他の行を消費しない」を足す。並行 `take` のケースは同じ束縛で行い、非 `null` がちょうど 1 つを維持
- **理由:** 契約的振る舞いを足したらスイートも触る（CLAUDE.md「Port contracts and conformance」）。「不一致では消費されない」の検証はここが正本

### 5. `startOAuthFlow` と view を変える

- **対象ファイル:** `packages/core/src/application/identity/startOAuthFlow.ts`、`packages/core/src/application/identity/view.ts`
- **変更内容:** `const binding = secureTokenGenerator.issue()` を足し、`flowState.stateBindingHash = binding.hash` として `put`。返り値を `{ stateBinding: binding.token, authorizationUrl }` に。`StartOAuthFlowView` の `state` を `stateBinding` へ置き換え、JSDoc を「フローを開始したブラウザーにだけ渡す一回限りの秘密。転送境界がこれを Cookie で運び、消費時に突き合わせる」に書き換える
- **理由:** 束縛の秘密の発行元はフローを作るユースケース。`state` を転送境界へ出す理由（Cookie 値の導出）が消えるので DTO からも落とす

### 6. 消費側のユースケースを追随させ、放棄の受け皿を作る

- **対象ファイル:** `packages/core/src/application/identity/completeOAuthCallback.ts`、`completeOAuthSignIn.ts`、`linkOAuthIdentity.ts`、新規 `abandonOAuthFlow.ts`、`view.ts`
- **変更内容:**
  - 3 つの入力 DTO に `stateBinding: string` を足し、`take(input.state, container.secureTokenGenerator.hashOf(input.stateBinding))` に差し替える。`completeOAuthCallback` の JSDoc に「束縛が一致しない要求では `state` は消費されない」を足す
  - `abandonOAuthFlow.ts`: `AbandonOAuthFlowInput = { state, stateBinding }`、`AbandonOAuthFlowView = { abandoned: boolean }`。`take` の結果が非 `null` なら `true`。JSDoc に「消費 POST が起きずに終わる往復の後始末。束縛が一致したときだけ行を解放し、転送境界はその結果でだけ Cookie を捨ててよい（無条件に捨てると、コールバック URL を踏ませるだけで他人の進行中フローを壊せる）」
- **理由:** 照合材料は原子的な消費でしか読めない場所にあるので、放棄の判定も内側に受け皿が要る（adr.md ADR-004）

### 7. コア側のテストを追随させる

- **対象ファイル:**（`packages/core/src/application/identity/__tests__/` 配下。この一覧が追随対象の確定形）
  - `authFlowHelpers.ts` — `StartedOAuthFlow` に `stateBinding` を足す本体
  - `startOAuthFlow.test.ts` — TC-identity-264 が `expect(view.state).toBe(state)` を直接検査しており、view から `state` を落とすと落ちる
  - `completeOAuthCallback.test.ts` / `completeOAuthSignIn.test.ts` / `linkOAuthIdentity.test.ts`
  - `removeIdentity.test.ts` — `completeOAuthSignIn` / `linkOAuthIdentity` に `input: { state: flow.state, code }` を直接組んで渡している 6 か所
  - `addPasswordIdentity.test.ts` — 同上 1 か所
  - `requestPasswordReset.test.ts` / `resetPassword.test.ts` — ローカルの `signUpWithGoogle` が `startOAuthFlow` を直に呼び `authorizationUrl` から `state` を読み戻して消費する。`stateBinding` は URL に載らないので、view から拾い直す書き換えが要る（機械的な追随で済まない唯一のケース）
  - `pruneExpiredAuthState.test.ts` — 直接 `put` している
  - 新規 `abandonOAuthFlow.test.ts`
- **変更内容:** `StartedOAuthFlow` に `stateBinding` を足し（`beginOAuthFlow` は `state` を `authorizationUrl` から読み戻す現在の形のまま）、消費するヘルパー／テストへ渡す。`requestPasswordReset.test.ts` / `resetPassword.test.ts` のローカル `signUpWithGoogle` も同じ形（view から `stateBinding` を受け取って消費へ渡す）に揃える — 寄せられるなら `authFlowHelpers.signUpWithGoogle` へ統合してもよい。直接 `put` している箇所に `stateBindingHash` を足す。追加テスト: `completeOAuthCallback` の束縛不一致 →`OAUTH_STATE_INVALID`＋その後に正しい束縛で完了できる、`abandonOAuthFlow` の一致（行が消える）／不一致（行が残る）。`startOAuthFlow` は「保存された `stateBindingHash` が返した `stateBinding` の `hashOf` と一致する」に加えて、束縛が `state` から導けないことを否定アサーション 2 本で書き下す — `expect(view.stateBinding).not.toBe(state)` と `expect(saved.stateBindingHash).not.toBe(secureTokenGenerator.hashOf(state))`（`state` は `authorizationUrl` から読む）。この 2 本が `expect(view.state).toBe(state)`（TC-identity-264、`startOAuthFlow.test.ts:35` の 1 アサーション）の置き換え先であり、旧実装への差し戻しを内側だけで落とす正本になる。テスト名には対応する TC id を入れる（ステップ 11 で採番）
- **理由:** ユースケース層のテストは spec の TC 行のチェックリスト（docs/test.md）

### 8. 転送境界の Cookie モジュールを組み直す

- **対象ファイル:** `apps/web/app/presentation/oauthStateCookie.ts`、削除: `apps/web/app/presentation/oauthStateBinding.ts` と `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`
- **変更内容:** `setOAuthStateCookie(stateBinding, now)` / `readOAuthStateCookie()` / `requireOAuthStateCookie()` / `clearOAuthStateCookie()` の 4 本にする。`clearBoundOAuthStateCookie` を廃止。モジュール JSDoc を書き換え、「Cookie に載るのは `state` と独立した一回限りの秘密で、`state` を知るだけでは再現できない」「照合は消費と同じ原子操作の中で行われるので、ここは運搬と不在判定だけを持つ」を書く（ADR 番号は引かず理由そのものを書く）
- **理由:** 転送境界に残す責務が「運搬」だけになる。導出関数が残っていると、もう使われない照合経路が読み手に見える
- **注意:** 現在の配線テストは `deriveOAuthStateBinding` を import して Cookie を組み立てている。削除を「テストが使っているから」で止めないよう、ステップ 10 では `sha256(STATE)` をテストローカルの `node:crypto` ヘルパーで計算する（本番コードに導出関数を残さない）

### 9. server function 3 経路を配線し直す

- **対象ファイル:** `apps/web/app/routes/auth/-action.tsx`、`apps/web/app/routes/settings/-action.tsx`
- **変更内容:**
  - `startOAuthSignInFn`: `setOAuthStateCookie(view.stateBinding, container.clock.now())`
  - `startOAuthLinkFn`（`routes/settings/-action.tsx`）: 同じく `setOAuthStateCookie(view.stateBinding, container.clock.now())`。`startOAuthFlow` の 2 つ目の呼び出し元で、連携の往復にも同じ束縛が掛かる
  - `completeOAuthCallbackFn`: `requireOAuthStateCookie()` → usecase 呼び出し（`stateBinding` 付き）→ 成功なら `clearOAuthStateCookie()`。`catch` では `OAUTH_STATE_INVALID` のときだけ捨てずに再 throw し、それ以外は捨ててから再 throw。判定は `serializeError(error)` の `kind === "validation" && code === "OAUTH_STATE_INVALID"`（`components/note/NoteDetail/index.tsx` と同じ構造判定の形）で行い、`isValidationError` の `instanceof` には依らせない。コメントは「照合を通らなかったと言い切れない限り捨てない — 他人のブラウザーの進行中フローを落とせる経路を作らないため」の理由そのものを書く
  - `abandonOAuthFlowFn`: Cookie を読み（不在なら `null` を返して終わり）、`abandonOAuthFlow` を呼び、`abandoned` のときだけ `clearOAuthStateCookie()`。**応答は現行どおり `null` のまま**で、`abandoned` を転送境界の外へは出さない
- **理由:** 束縛の成否は「Cookie を焼く行」と「照合する行」の順序そのもの（ADR 034）。ここが配線の本体

### 10. 配線テストを書き直す

- **対象ファイル:** `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`
- **変更内容:** 1 リクエスト分の実行文脈で実ヘッダーを観測する既存の骨格（`callServerFn`）はそのまま使う。
  - コンテナのモックに `oauthStateStore` と `secureTokenGenerator` を**実アダプター**で差す — `new MemoryBackend({ clock })` ＋ `createMemoryOAuthStateStore(backend)` ＋ `createNodeSecureTokenGenerator()`。`take` を手書きモックにしない（条件付き消費を再現するのがモックだと、AC-1 を満たしているのがモックになる）。準備はテスト側で `put(STATE, { …, stateBindingHash: gen.hashOf(BINDING) }, TTL)` するだけでよい。`startOAuthFlow` のモックはそのまま
  - 束縛が一致すると `completeOAuthCallback` は `take` の先へ進み、`completeOAuthSignIn.ts` が `config.appUrl` と `signInOAuthClient` に触る。コンテナへ `config: { appUrl }` と `signInOAuthClient: { exchangeCode: async () => { throw new ValidationError("OAUTH_EMAIL_UNVERIFIED", …) } }`（実在するエラーコード）を明示的に足し、この経路の失敗を**決定的**にする。足さないと未定義依存の `TypeError` が `kind: "unknown"` として Cookie 破棄分岐へ落ち、アサーションは通るのに通る理由が設計の意図と違う状態になる。サインイン完了まで通す形は採らない（`userReader` / `identityUniqueDirectory` / `globalUnitOfWorkProvider` / `idGenerator` / セッション発行まで一式のモックが要り、このステップの分量を超える）
  - `startOAuthFlow` のモックは `{ stateBinding: BINDING, authorizationUrl }` を返す
  - `sha256(STATE)` はテストローカルの `node:crypto` ヘルパーで計算する（`presentation/oauthStateBinding.ts` はステップ 8 で消えるので import しない）
  - ケース: 生成（`Set-Cookie` の値が `BINDING` であり、`STATE` も `sha256(STATE)` も含まない／属性は現状どおり）、照合（Cookie 不在 → `OAUTH_STATE_INVALID`／`state` だけを知る第三者の Cookie＝`STATE` と `sha256(STATE)` → `OAUTH_STATE_INVALID` で、`backend.oauthStates` に行が残る＝**AC-1**／正しい束縛 → 行が消え、`OAUTH_STATE_INVALID` でない失敗なので Cookie が落ちる。交換の成否はここでは見ない — サインイン／連携が完了できることの担保はステップ 7 のユースケース単体テスト）、破棄（`OAUTH_STATE_INVALID` では Cookie を落とさない／`abandon` は一致で Cookie と行を落とし、別ブラウザーのフローでは両方残す／**束縛 Cookie が無い `abandon` はユースケースを呼ばず `Set-Cookie` も出さず、`backend.oauthStates` に行が残る**＝ AC-1 の後半。この分岐は `requireOAuthStateCookie()` ではなく `readOAuthStateCookie()` の `null` で終わる別経路なので、消費経路の Cookie 不在ケースでは覆えない）
- **理由:** 受け入れ基準がこのファイルでの固定を求めている。`sha256(STATE)` を明示的に不合格にすることで、旧実装へ戻す変更がここで落ちる。実アダプターを差すことで「不一致では消費されない」を転送境界のテストからも直接観測でき、AC-1 がモックの忠実さに依存しない

### 11. spec の下流成果物と台帳を追随させる

- **対象ファイル:** `spec/domains/identity.md`、`spec/usecases/identity.md`、`spec/usecases/integration.md`、`spec/testcases/identity/{startOAuthFlow,completeOAuthSignIn,completeOAuthCallback,linkOAuthIdentity}.md` と新規 `abandonOAuthFlow.md`、`spec/inventory/{domain,adapter,usecase,test}.md`、`spec/manual-tests/account.md`
- **変更内容:**
  - `spec/domains/identity.md`: 「ユースケース（概要）」の列挙（現在 24 件＝ UC-identity-001..024）に `abandonOAuthFlow` を足す。台帳はこの本文からの生成物なので、ここを直さないと UC 台帳との整合も崩れる
  - `spec/usecases/identity.md`: `startOAuthFlow` の出力 DTO を `stateBinding` / `authorizationUrl` に置き換え、出力 DTO 表の直下にある「`state` は `authorizationUrl` が既に運んでいるが…別に露出する」の**本文 1 段落**を「束縛の秘密だけを露出する」旨に書き換える（表だけ直すとこの段落が残って偽になる）。手順 3/4 に束縛の秘密の発行と保存を追記。`completeOAuthSignIn` / `completeOAuthCallback` / `linkOAuthIdentity` の入力 DTO に `stateBinding` を足し、手順 1 を「束縛が一致したときだけ取り出して削除する。不一致・不在は `OAUTH_STATE_INVALID`（行は消費しない）」に。`abandonOAuthFlow` の節を新設（概要・入出力 DTO・処理フロー・エラーケース）
  - `spec/usecases/integration.md`（実装はしないが、記述が偽になるので正典として直す）: `startIntegrationOAuth` の手順 2 に束縛の秘密の発行と `stateBindingHash` の保存を書き、出力 DTO（現在 `authorizationUrl: string` のみ）に束縛の秘密を足す。`completeIntegrationOAuth` の手順 1「`OAuthStateStore.take(state)` で取り出す」を「束縛が一致したときだけ取り出して削除する」に直し、入力 DTO（現在 `userId`, `state`, `code`）に束縛を足す
  - `spec/testcases/identity/`: 既存表の該当行の期待結果を更新し、行を追加（束縛不一致で消費されない、`stateBindingHash` が保存される、放棄の一致／不一致）。とくに `startOAuthFlow.md` の 1 行目「応答は `authorizationUrl` と併せて保存した `state` も返す（転送境界がフローを開始したブラウザーへ束縛するため）」＝ TC-identity-264 は名指しで書き換える。新規 `abandonOAuthFlow.md`
  - 台帳: DOM-common-038 と ADP-common-037 の説明を「束縛が一致したときだけ state を原子的に取得・削除する」に。UC-identity-005 / UC-identity-024 の説明を更新し、`abandonOAuthFlow` を **UC-identity-025** として追加。TC 行は `spec/inventory/test.md` の identity 節へ **TC-identity-336 以降**で追加（採番は追加時点の最大 +1 を再確認する）。**TC-identity-264 の行**（`spec/inventory/test.md`）も同じ文言で書き換える。ADP / DOM は行＝ポートメソッドなので採番は増えない。`spec/inventory/{domain,adapter,usecase,test}.md` 冒頭の「最終同期」日付（現在 2026-08-16）を作業日へ進める
  - `spec/manual-tests/account.md`: 「ユースケースエラーケース対応表」も本文の下流成果物なので、増えたエラーケース（`completeOAuthSignIn` / `completeOAuthCallback` の束縛不一致、新規 `abandonOAuthFlow` のストア障害）の行を足す。いずれも手作業で再現できないので `対象外` と理由を 1 行添える形（既存の `対象外` 行と同じ様式）。TC-40 の手順は利用者から見える振る舞いが変わらないので改訂不要で、`spec/manual-tests/index.md` の集計も動かない
- **理由:** 台帳は本文からの生成物で、1 行 = 1 ポートメソッド／1 ユースケース／1 テストケース（ADR 052 / 058）。ユースケースを増やしたら UC / TC の行も増える

### 12. 仕上げ

- **対象ファイル:** なし（コマンド実行）
- **変更内容:** `pnpm typecheck && pnpm lint:fix && pnpm format` と `pnpm test`。落ちた箇所は該当ステップへ戻す。最後に AC-6 が列挙する spec 成果物と実装（Cookie 値・照合の置き場所・破棄の条件）を読み合わせ、目視で確認する — `spec/adr/034` の**タイトル**と本文（決定セクションの**前文**・決定リスト・リスト後の**理由段落**・**検討した代替案**・影響）、`spec/adr/index.md` の一覧行と前提依存マップ、`spec/domains/index.md`、`spec/database/index.md` の `oauth_flow_states` 表、`spec/domains/identity.md` の「ユースケース（概要）」の列挙、`spec/usecases/identity.md` と `spec/usecases/integration.md`、`spec/testcases/identity/`、`spec/inventory/` の各行と「最終同期」日付、`spec/manual-tests/account.md` のユースケースエラーケース対応表
- **理由:** CLAUDE.md の「After changes」
