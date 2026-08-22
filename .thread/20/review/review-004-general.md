# レビュー 004 — General（Adapter / Presentation / Application を統合）

収束確認ラウンド。ゼロベースで差分を読み、契約（`.thread/20/plan.md`）の受け入れ基準・スコープと突き合わせた。

## General

#### Blockers

なし

#### Warnings

なし

### 確認した論点

- **ポート契約と適合スイートの 1 対 1** — `application/ports/oauthStateStore.ts` の `take` JSDoc は「削除は束縛一致のときだけ」「一致すれば期限切れでも削除して `null`」「不一致は必ず行を残して `null`」の 4 象限を 1 つの規範文で閉じており、`adapters/conformance/oauthStateStore.ts` に 4 象限すべてのケースがある（一致×生存 / 不一致×生存 / 一致×期限切れ / 不一致×期限切れ）。期限切れ側は `deleteExpired` の掃除数（0 件 / 1 件）で「行が消えたか」を実測しており、`take` の戻り値だけでは区別できない差を捕まえている。過剰主張（未検証の性質）は見当たらない。
- **条件付き `take` の実効性** — 反対の実装（不一致でも削除する / 束縛だけで引く / 期限切れを `WHERE` に混ぜる）はいずれかのケースで落ちる。特に「`state` と束縛の両方でキーされる」ケースは、他行の束縛で `take` して `null`、その後正しい組で両行が取れることまで見ており、束縛のみで検索する実装を弾く。memory 実装は `await` を挟まない get → compare → delete なので単一プロセス上で原子的。
- **Cookie の扱い** — `HttpOnly` / `SameSite=Lax` / `Path=/` / dev 以外 `Secure` / `expires = now + OAUTH_STATE_TTL_MS` は従来どおり（AC-3）。値は `state` と独立した 256bit の `secureTokenGenerator.issue()` 由来で、行が持つのは digest のみ。束縛の平文は `Set-Cookie` 以外（応答本文・URL・ログ）に出ていない。`abandonOAuthFlowFn` の応答は `null` 固定で、一致有無を答える口になっていない。
- **転送境界の `try / catch`** — 2 か所とも境界に限定されている。`completeOAuthCallbackFn` は「Cookie を捨ててよいか」の判定のためだけに捕まえて再送出し、判定は `instanceof` ではなく `serializeError` の `kind` / `code` で行っており、CLAUDE.md の「構造的にシリアライズする」方針と一致。`abandonOAuthFlowFn` は loader から呼ばれる後始末なので畳んで `logger.error` に落とす方針が JSDoc に理由付きで書かれており、配線テストが「畳むのをやめると落ちる」形で固定している。
- **`abandonOAuthFlow` の責務** — 単一の原子操作（条件付き `take`）だけを行い、エラーは投げずに `abandoned: boolean` を返す。ドメインイベントも複数集約の更新も無いので UoW を張らないのは、`completeOAuthSignIn` などの既存の `take` 呼び出しと同じ扱いで一貫している。期限切れ行を一致で解放したときに `false` を返す縁は `AbandonOAuthFlowView` の JSDoc が明示している。
- **テストの実効性** — TC-identity-336..341 はいずれも否定・肯定を対で置いており（不一致 → `OAUTH_STATE_INVALID` かつ行が残る → 正しい束縛で完了できる）、形骸化したアサーションは無い。配線テストはモックではなく memory の参照アダプターを差しているので、「不一致では消費されない」を満たすのがテスト側に寄っていない。`spec/inventory/test.md` の TC 行と実装テストの名前は 1 対 1 で対応していた。
- **スコープ** — 差分のコードは Issue #20 の射程内（ポート・memory アダプター・identity ユースケース群・束縛 Cookie の運搬・2 つの開始経路）に収まっており、越境した変更は無い。Integration スライスは型の追随のみで実装されていない（契約どおり）。
- **残す必要のない記述** — コード・コメントに弁明や修正の経緯は残っていない。削除された `oauthStateBinding.ts` / その単体テストへの参照も残っていない。
- `pnpm exec vitest run packages/core/src/application/identity packages/core/src/adapters/memory apps/web/app/presentation` は 43 ファイル / 570 件すべて green。

#### カバレッジ

- 確認: `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/oauthStateBinding.ts`（削除）, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`（削除）, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/identity/__tests__/abandonOAuthFlow.test.ts`, `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/authFlowHelpers.ts`, `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`, `packages/core/src/application/identity/__tests__/resetPassword.test.ts`
- スキップ: `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/manual-tests/account.md`, `spec/testcases/identity/*.md`, `spec/usecases/identity.md`, `spec/usecases/integration.md` — spec 観点の担当（TC id と実装テストの対応、ポート JSDoc との整合だけは参照して確認した）
- スキップ: `.thread/20/*`（`adr.md` / `plan.md` / `progress.md` / `steps.md` / `testing.md` / `review/*`）— レビュー作業の記録でコードではない
