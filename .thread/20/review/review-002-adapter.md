# レビュー 002 — Adapter 観点 / PR #34（Issue #20）

## Adapter

### Blockers

なし。

条件付き `take` は memory 実装で原子的に成立しており（`get → compare → delete → expiry` が同期区間に閉じている）、ポート JSDoc が宣言する 4 象限と適合スイートのケースが 1 対 1 で対応している。実効性は変異試験で確認した — 束縛比較を削ると 2 ケース、`table.delete` を期限判定の後ろへ動かすと 1 ケースが落ちる（いずれも `pnpm exec vitest run packages/core/src/adapters` で確認後、作業ツリーは復元済み）。`adapters/memory/store.ts` の `OAuthStateRow` は `value: OAuthFlowState` を丸ごと持つ形なので追随は不要（新フィールドは型で自動的に載る）。`spec/database/index.md` に `state_binding_hash` 列が足され、`state` が PK なので `DELETE … WHERE state = ? AND state_binding_hash = ?` は PK 参照で済み、`oauth_flow_states_expires_idx` の設計も変わらない。束縛 digest の比較は `TokenHash`（branded string）の値比較で、`sessionRepository` / `authTokenRepository` の既存 tokenHash 比較と同じ形。攻撃者が制御できるのは digest ではなく原像なので、タイミング差から得られるものは無く、ここを constant-time にする必要はない。

### Warnings

- **[W-001]** 適合スイートが `take` の「`state` で引く」ことを 1 ケースも拘束していない。束縛だけで引くバックエンドが全ケース緑のまま通る
  - 場所: `packages/core/src/adapters/conformance/oauthStateStore.ts:39-97`
  - 理由: 今回 `take` に第 2 引数が入り、D1 実装は `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` になる。この `WHERE` から `state = ?` が抜ける（あるいは列名を取り違える）のは、まさに今回追加される述語まわりで起こりうる写し間違いだが、現行スイートはそれを検出できない。実際に「`state` を無視して束縛だけで引く」実装を想定すると、6 ケースすべてが緑になる — ケース 1/3 は行が 1 本しかなく、ケース 2/5 は `OTHER_BINDING_HASH` に一致する行がそもそも無いので `null` が返り、ケース 4 は束縛一致で消えるのが期待どおり、ケース 6 は `deleteExpired` しか触らない（`state-b` を `OTHER_BINDING_HASH` で `put` しているのに、その行を `take` するケースが 1 つも無い）。結果として、同一デプロイで 2 つのフローが並行しているとき、ブラウザー A の束縛でブラウザー B の行が消費される実装がポート契約に適合していると判定されてしまう
  - 提案: 2 行以上を置いた状態で「別の `state` を指す `take` は、束縛が他方の行に一致していても `null` を返し、どちらの行も消えない」を 1 ケース足す。既存の `signInState` / `integrationState`（`BINDING_HASH` / `OTHER_BINDING_HASH`）をそのまま使えば追加の fixture は要らない。ついでに「保存されていない `state` の `take` は `null`」も同じケースに畳める

- **[W-002]** 「束縛が一致すれば期限切れでも削除して `null`」という象限を契約に載せた結果、`take` の戻り値が「期限切れで解放した」と「そもそも無かった」を畳んでしまい、`AbandonOAuthFlowView.abandoned` の JSDoc が偽になる
  - 場所: `packages/core/src/application/ports/oauthStateStore.ts:52-55`（畳み込みの発生源）／`packages/core/src/application/identity/view.ts:96-99`, `packages/core/src/application/identity/abandonOAuthFlow.ts:24-28`
  - 理由: `view.ts` は「`abandoned` says the binding matched and the flow row was released」と書いているが、`abandonOAuthFlow` は `flow !== null` を返すだけなので、束縛が一致した**期限切れ**の行では「一致して解放された」のに `abandoned: false` になる。`spec/inventory/usecase.md` の UC-identity-025 も「一致すれば期限切れでも解放し、不一致・不在は行に触れず `abandoned: false`」と書いており、解放された経路が `false` に落ちることは読み取れない。この象限はポート JSDoc・`spec/domains/index.md`・適合スイート（`ADP-common-037/038: an expired take with the matching binding…`）で規範として固めた側なので、その規範と消費側 JSDoc が食い違っている状態になっている。実害は小さい（Cookie の寿命は `state` 行と同じなので、行が期限切れなら Cookie も普通は届かない）が、正しくない断定が契約ドキュメントに残る。`abandonOAuthFlow` の単体テスト（TC-identity-338/339/340）にもこの象限は無い
  - 提案: 最小の直しは `AbandonOAuthFlowView` の JSDoc を実際の意味（「有効な行を束縛一致で取り出せた」）に合わせ、期限切れ一致では `false` になることを 1 文添える。行が解放されたかを転送境界に伝える必要が本当にあるなら、`take` の戻り値ではなく `abandonOAuthFlow` 側で表現する（ポートの戻り型を広げると 4 象限に畳んだ契約の単純さが崩れるので、そちらは勧めない）

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/identity/__tests__/abandonOAuthFlow.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/__tests__/authFlowHelpers.ts`, `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `spec/domains/index.md`, `spec/database/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/domains/identity.md`, `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`
  - 差分外の追随確認: `packages/core/src/adapters/memory/store.ts`（`OAuthStateRow` は `OAuthFlowState` を丸ごと保持するので変更不要）, `packages/core/src/adapters/memory/__tests__/conformance.test.ts` / `conformanceBackend.ts`（登録済み・署名変更の影響なし）, `packages/core/src/adapters/memory/secureTokenGenerator.ts`（`hashOf` = SHA-256 hex）, `packages/core/src/application/di/memoryRuntime.ts`（配線変更なし）
- スキップ: `.thread/20/`（`adr.md` / `plan.md` / `progress.md` / `steps.md` / `testing.md` / `review/*`）— レビュー作業と計画の記録そのもの。`plan.md` と `triage-keys.md` は判定材料として読んだが成果物ではない
- スキップ: `apps/web/app/presentation/oauthStateBinding.ts`(D), `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`(D), `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx` — 転送境界の Cookie 運搬で Presentation 観点。削除した純関数への参照がソースツリーに残っていないことだけ横断確認した（ヒットは未追跡の `apps/web/dist/` のビルド成果物のみ）
- スキップ: `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `requestPasswordReset.test.ts`, `resetPassword.test.ts`, `startOAuthFlow.test.ts` — ヘルパー経由の入力追随とユースケース出力の検証で、ポート契約に触れない
- スキップ: `spec/testcases/identity/`（`abandonOAuthFlow.md` / `completeOAuthCallback.md` / `completeOAuthSignIn.md` / `startOAuthFlow.md`）, `spec/usecases/identity.md`, `spec/usecases/integration.md` — ユースケース／テストケースの正典で Spec・Usecase 観点（W-002 に関わる UC-identity-025 の記述だけ `spec/inventory/usecase.md` 側で確認済み）
