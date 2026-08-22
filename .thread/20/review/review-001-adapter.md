# レビュー 001 — Adapter 観点

## Adapter

### Blockers

- **[B-001]** ポート契約に新設した「束縛が一致すれば**期限切れでも削除する**」が適合スイートで一切検証されていない
  - 場所: `packages/core/src/application/ports/oauthStateStore.ts:36-46` / `packages/core/src/adapters/conformance/oauthStateStore.ts:68-74`
  - 理由: 今回 JSDoc に「削除の条件は 4 象限を 1 本のルールで決める」と normative に書き足した（`spec/domains/index.md` にも同文）。そのうち **(一致 × 期限切れ) = 行を削除して `null`** を観測するケースが適合スイートに無い。既存の "an expired state is not returned" は戻り値が `null` であることしか見ておらず、**行が消えたか**を見ていない。実際に memory の `take` を「期限切れなら削除せず `null`」に書き換えて `packages/core/src/adapters/memory/__tests__/conformance.test.ts` を回したところ 204 件すべて緑のままだった（確認後リバート済み）。つまり将来の D1 / DO バックエンドが `DELETE … WHERE state = ? AND binding_hash = ? AND expires_at > ?` と書いても契約違反を検出できず、CLAUDE.md「Port contracts and conformance」の「契約的振る舞いを足すならポート JSDoc と適合スイートの両方を触る」に反する。台帳（ADP-common-037 / DOM-common-038）の説明文も「不一致は行を残して `null`」までしか書いておらず、この象限は本文にしか存在しない
  - 提案: 適合スイートに「一致する束縛の期限切れ `take` は `null` を返し、**行はもう無い**」ケースを足す。行の不在はポートだけで観測できる — `take` の後に `deleteExpired(遠い未来, null, 10)` を呼んで `deleted` が 0 であることを見る（実装内部に触らないので他バックエンドでもそのまま通る）。あわせて ADP-common-037 / DOM-common-038 の説明文にもこの象限を書き足す

### Warnings

- **[W-001]** (不一致 × 期限切れ) の象限が適合スイートに無い
  - 場所: `packages/core/src/adapters/conformance/oauthStateStore.ts:49-57`
  - 理由: 不一致ケースは生存中の行でしか試していない。契約は「不一致は**常に**行を残す」と言い切っているので、期限切れ行に対する不一致 `take` が行を消してしまう実装（`WHERE state = ? AND (binding_hash = ? OR expires_at <= ?)` 相当の書き間違い）を検出できない。B-001 ほど実害は大きくない（期限切れ行はいずれ `deleteExpired` が掃く）が、「4 象限を 1 本のルールで決める」と宣言した以上、検証は 4 象限に対応させたい
  - 提案: `put` → `clock.advance(TTL_MS)` → 不一致 `take` が `null` → `deleteExpired` が 1 件回収する（＝行はまだ在った）、の 1 ケースを足す。B-001 のケースと合わせれば 4 象限が 1 対 1 で埋まる
- **[W-002]** 例示 SQL の列名が正典どうしで食い違う
  - 場所: `packages/core/src/application/ports/oauthStateStore.ts:45` / `spec/domains/index.md`（`DELETE … WHERE state = ? AND binding_hash = ? RETURNING *`）と `spec/database/index.md:601`（列は `state_binding_hash`）
  - 理由: 列定義の正典は `spec/database/index.md` で、そこでは `state_binding_hash`。ポート JSDoc と `spec/domains/index.md` の例示 SQL だけ `binding_hash` になっている。D1 バックエンドを書く人が最初に読むのは後者なので、無用な突き合わせが発生する
  - 提案: 例示 SQL 側を `state_binding_hash` に揃える（`spec/database/index.md` に足した 1 文はすでに `state_binding_hash` なので、そちらが基準）

### 確認して指摘しないと判断した点

- **memory 実装の原子性**: `take` は `get → 比較 → delete` の間に `await` が 1 つも無く、`MemTable` は同期 API なので単一イベントループ上で不可分。適合スイートの concurrent ケースも非 `null` がちょうど 1 つであることを固定している。`table.delete` を期限判定より前に置いているのも契約どおり
- **比較のタイミング安全性**: 比較しているのは平文ではなく SHA-256 digest で、一致させるには原像が必要（`SecureTokenGenerator.issue()` は 256bit）。本リポジトリの他の hash 突き合わせ（session / auth token は hash をキーにした行引き）も定数時間ではなく、D1 版も `WHERE binding_hash = ?` になるため、ここだけ定数時間比較にしても防御にならない
- **保存構造の追随**: `MemoryBackend.oauthStates` の行型は `value: OAuthFlowState` を丸ごと持つので、`stateBindingHash` の追加で `adapters/memory/store.ts` 側に追随は要らない。`put` / `take` とも `clone`（`structuredClone`）を通しており branded string もそのまま往復する
- **適合スイートの移植性**: 追加ケースは `backend.oauthStateStore` と `backend.clock`（`ConformanceBackend` の公開面）しか触っておらず、memory の内部構造には依存していない。ケース名の `ADP-common-0xx:` 接頭も `spec/inventory/adapter.md` の規約どおり
- **`deleteExpired` との整合**: 期限判定の境界は `take`（`expiresAt <= now` を期限切れ）と `deleteExpiredPage`（`expiresAt > now` を残す）で一致。`deleteExpired` は束縛を見ずに掃くという契約のままで、intent 横断のページングケースも維持されている
- **配線テストが参照アダプターを差している点**: `oauthStateBindingWiring.test.ts` は `MemoryBackend` + `createMemoryOAuthStateStore` + `createNodeSecureTokenGenerator` を実物のまま使い、`take` は数えるためだけに `vi.fn(store.take)` で包んでいる。条件付き消費がモックで再現されていないので、「不一致では消費されない」の検証がテスト側に移っていない
- **弁明・経緯コメント**: 追加されたコメントは「なぜ不一致で行を消さないか」「なぜ Cookie を無条件に捨てないか」の理由のみで、修正の経緯や ADR 番号の引用は無い

### スコープ

`plan.md` の受け入れ基準のうち Adapter に関わるのは AC-2（不一致では消費されない性質がポート JSDoc と適合スイートの双方にある）と AC-6（`spec/domains/index.md` のポート定義・`spec/database/index.md` の表定義・台帳行）。AC-2 は「不一致」象限については満たされているが、同じ JSDoc 段落に足した期限切れ象限が片側（JSDoc のみ）に留まっている（B-001）。AC-6 のアダプター関連分（ポート定義・列追加・ADP-common-037 / DOM-common-038 の説明文と最終同期日）は満たされている。アダプター層にスコープ外の変更は混入していない（`adapters/` の差分は適合スイートと memory の `take` だけ）。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/application/ports/oauthStateStore.ts`, `spec/domains/index.md`, `spec/database/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`（参照アダプターの差し方の妥当性としてのみ）, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`（`deleteExpired` / `take` の新署名との整合としてのみ）
- 参照（差分外）: `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/adapters/memory/secureTokenGenerator.ts`, `packages/core/src/adapters/memory/__tests__/conformance.test.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/domain/identity/valueObject.ts`, `packages/core/src/domain/identity/ports/secureTokenGenerator.ts`
- スキップ: `.thread/20/*`（作業記録。`plan.md` のみ契約として参照）
- スキップ: `apps/web/app/presentation/oauthStateBinding.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx` — 転送境界（Presentation 観点）
- スキップ: `packages/core/src/application/identity/`（`abandonOAuthFlow.ts`, `completeOAuthCallback.ts`, `completeOAuthSignIn.ts`, `linkOAuthIdentity.ts`, `startOAuthFlow.ts`, `view.ts` と `__tests__/` の各ファイル）— ポートの呼び出し側（Usecase / Test 観点）。`take` の新引数に渡している値が `secureTokenGenerator.hashOf(plaintext)` であることだけ整合確認済み
- スキップ: `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/domains/identity.md`, `spec/usecases/identity.md`, `spec/usecases/integration.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/*` — ADR / ユースケース / テストケースの正典（Spec / Usecase 観点）
