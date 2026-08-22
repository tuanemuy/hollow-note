# レビュー 003 — Adapter（永続化アダプター・ポート適合スイート）

対象: PR #34 / Issue #20（ベース: main）
差分: `scratchpad/diff/20-round-003.diff`

## Adapter

### Blockers

なし。

`OAuthStateStore` の契約変更（条件付き `take`）は、ポート JSDoc・適合スイート・memory 実装・spec（`domains/index.md` / `database/index.md` / `inventory/adapter.md` / `inventory/domain.md`）がすべて同じ 1 本のルールを述べており、食い違いは見つからなかった。

検証したこと:

- **契約とスイートの 1 対 1** — JSDoc が畳んだ 4 象限（束縛一致/不一致 × 生存/期限切れ）がスイートの 4 ケースに正確に対応している。
  - 一致 × 生存 → 削除して flow を返す（`ADP-common-036/037: put then take with the matching binding …`）
  - 一致 × 期限切れ → 削除して `null`（`ADP-common-037/038: an expired take with the matching binding …`。後続 `deleteExpired` が 0 件であることで「削除された」を観測）
  - 不一致 × 生存 → 行を残して `null`（続けて正しい束縛で取れる）
  - 不一致 × 期限切れ → 行を残して `null`（後続 `deleteExpired` が 1 件で「残った」を観測）
  過剰主張（JSDoc にない性質の要求）も、抜けている条件も無い。
- **ケースの実効性** — memory 実装に対する 3 通りの反対実装を机上で当てて、すべて赤になることを確認した。(a) 束縛判定を落として常に削除 → 不一致ケースの 2 本目が `signInState` を返して落ちる。(b) 不一致でも削除して `null` を返す → 不一致ケースと不一致×期限切れの `swept.deleted` が落ちる。(c) 期限判定を削除より前に置く（一致×期限切れで行を残す）→ `swept.deleted` が `1` になって落ちる。「反対の実装でも緑」になるケースは無い。
- **バックエンド非依存性** — スイートはポートの公開 API（`put` / `take` / `deleteExpired` / `ConformanceBackend.clock`）だけを触っており、memory の内部構造（`backend.oauthStates` 等）に一切依存していない。`toEqual` による構造比較なので、行を再構築して返す D1 / DO 実装でもそのまま通る。`TokenHash` は分岐付きの値ではなくただのブランド付き文字列なので、fixture の `TokenHash.create("binding-hash-1")` も任意のバックエンドで成立する。
- **memory 実装の原子性** — `take` の本体に `await` が 1 つも無く、`get → compare → delete → 期限判定` が同一タスク内で完結している。単一スレッドの event loop 上では不可分で、適合スイートの並行ケースも通る（実行して 7 ケース緑を確認）。
- **D1 実装ノート** — `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` → 返った行の `expires_at` を見て期限切れなら `null`、という手順は 4 象限をすべて正しく満たす。「`WHERE` に期限を混ぜない」理由（混ぜると一致×期限切れの行が残る）も書かれており、`spec/database/index.md` の記述と一字一句の齟齬が無い。
- **束縛 digest の扱い** — 保存されるのは `SecureTokenGenerator.issue()` の `hash`（SHA-256 hex）で、照合は `hashOf(平文)` との等値比較。`hashOf` は任意文字列に対して全域（空文字でも 64 桁の hex を返すので `TokenHash.create` の非空検証にも掛からない）なので、攻撃者由来の Cookie 値がストアの手前で `SystemError` になる経路は無い。digest 同士の非定数時間比較は、攻撃者が平文を逆算できない以上、実害のある側路にはならない。
- **TTL 掃除との整合** — 一致した消費は期限切れでも行を落とすので prune に残らず、不一致で残った行は `expires_at` によって `deleteExpired` が回収する。取り残しの経路は無い。`pruneExpiredAuthState` 側の契約は変わっていない。
- **呼び出し側の追随** — `take` を呼ぶ 4 か所（`completeOAuthCallback` / `completeOAuthSignIn` / `linkOAuthIdentity` / `abandonOAuthFlow`）がすべて `hashOf(input.stateBinding)` を渡しており、`OAuthFlowState` を構築する全箇所（本番 1・テスト 3）が `stateBindingHash` を埋めていることを grep で確認した。
- **不要な記述** — memory 実装・ポート JSDoc・spec のいずれにも、弁明や修正の経緯にあたる記述は無い。コメントはいずれも WHY（不一致で消さない理由、`WHERE` に期限を混ぜない理由）を述べている。

### Warnings

- **[W-001]** ポート JSDoc が挙げる第 2 の実装形「read → compare → delete → expiry check」に、原子性の但し書きが付いていない
  - 場所: `packages/core/src/application/ports/oauthStateStore.ts:43-47`
  - 理由: 直前に「`take` は**原子的でなければならない**」と書いてあるので全体を読めば誤読はしないが、この一文だけを実装ノートとして読むと、D1 のような文単位でしか原子性を持たないバックエンドで `SELECT` → 比較 → `DELETE` の read-modify-write を書いてよい、と読めてしまう。その実装は並行 2 要求で両方に flow を返し得るのに、適合スイートの並行ケース（同一プロセス内の `Promise.all`）では運次第で緑になり得るため、契約違反がスイートをすり抜ける余地が残る。この形が成立しているのは memory バックエンドが単一スレッドで判定列を不可分に走らせているからで、そこは実装側のコメント（`repositories/oauthStateStore.ts:27-29` の「atomic on this backend」）にしか書かれていない。
  - 提案: 「or, where the runtime makes the whole sequence indivisible（memory バックエンドのような単一スレッド実行）, as read → compare → delete → expiry check」程度に条件を 1 句足す。契約本体は変わらないので、既存のスイートも spec も追随不要。

### カバレッジ

- 確認: `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/view.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `spec/domains/index.md`, `spec/database/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `.thread/20/plan.md`
- 差分外で参照: `packages/core/src/adapters/memory/secureTokenGenerator.ts`, `packages/core/src/domain/identity/ports/secureTokenGenerator.ts`, `packages/core/src/domain/identity/valueObject.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/memory/__tests__/conformance.test.ts`
- スキップ: `.thread/20/adr.md`, `.thread/20/progress.md`, `.thread/20/steps.md`, `.thread/20/testing.md` — 作業記録であってレビュー対象の成果物ではない
- スキップ: `apps/web/app/presentation/oauthStateBinding.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts` — 削除された転送境界の純関数で、永続化ポートに関わらない
- スキップ: `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx` — server function の配線で Presentation 観点
- スキップ: `packages/core/src/application/identity/__tests__/` 配下 11 ファイル — ユースケース単体テストで Application / Test 観点（`OAuthFlowState` を直接 `put` / `set` する箇所が `stateBindingHash` を埋めていることだけ grep で確認済み）
- スキップ: `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/domains/identity.md`, `spec/inventory/usecase.md`, `spec/manual-tests/account.md`, `spec/testcases/identity/` 配下 4 ファイル, `spec/usecases/identity.md`, `spec/usecases/integration.md` — ADR / ユースケース / テストケースの正典で Spec・Application 観点
