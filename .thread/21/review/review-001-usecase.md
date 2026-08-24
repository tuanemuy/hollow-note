# レビュー 001 — Use Case 観点

### Use Case

#### Blockers

なし

急所として指定された 4 点は、いずれも実装・テストの両方で満たされていることを**変異試験で確認した**（詳細は各項）。

- **観測の位置**: `identityRemovalRelease` は `observeActiveUniqueKey` を `globalUnitOfWorkProvider.run` の**前**で呼んでいる（`packages/core/src/application/identity/identityRemovalRelease.ts:48-52`）。観測を `releaseObservedUniqueKey` の直前へ移す変異を入れると TC-identity-342 が `directoryRow(...)` → `undefined` で落ちることを実行して確認した。順序制約は目視ではなくテストで拘束されている。
- **CAS 失敗の no-op 化**: `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:143-150` は条件不一致で早期 `return`。例外を投げないので再配送カウントが進まない。CAS 条件（`state !== "active"` / トークン不一致）を旧条件へ戻す変異で適合ケース 2 件（`beginRelease quoting a superseded token…` / `a releasing row is not taken over…`）が落ちることを確認した。
- **`release(operationId)` の無条件呼び出し**: `packages/core/src/application/identity/uniqueness.ts:204-221` で `beginRelease` は観測がある場合のみ、`release` は常に呼ばれる。`if (params.observed === null) return;` を足す変異で TC-identity-345 が落ちる（`releasing` 行が残る）ことを確認した。孤児 `releasing` 行の唯一の回収経路が実行形で守られている。
- **治癒経路の順序**: `linkOAuthIdentity.ts:147-165` / `completeOAuthSignIn.ts:354-384` はいずれも `IdentityPolicy.findOAuth` → `ensureAddable` の順。ただしこの順序自体はテストで拘束されていない（W-001）。
- **二平面 UoW**: 観測・`beginRelease` / `release` はすべて UoW の外。`run` のネストは無い。TC-identity-342 の割り込みは `realProvider.run(fn)` が解決した**後**に走るのでネストにならない（`dispatchDomainEvent` は自前で `run` しないため、ラッパーが捕まえる最初の `run` が判定 UoW であることも確認済み）。
- **Cross-layer catch policy**: 新規の `try/catch` はゼロ。ドメインエラーの再翻訳も無い。
- **セキュリティ**: `observeActiveUniqueKey` は `claim.userId !== params.expectedUserId` で null に倒すので、他人の claim を観測することも壊すこともできない。治癒判定はいずれも `listByUserId(自分)` の集合内に閉じており、他人の identity には届かない。ログに出るのは `{ operationId, reason }` だけで、`operationId` は `removeIdentity:${identityId}`、観測値・生鍵はどこにも出ない（ADR 048 と整合）。
- **冪等性**: 同一 event の並行 2 配送を辿っても、`beginRelease` の再キー付けにより後続の `release(operationId)` が新しい claim の行（別 operationId）に当たらないため、二重解放にならない。

#### Warnings

- **[W-001]** `findOAuth` を `ensureAddable` より前に置く順序が、どのテストでも拘束されていない
  - 場所: `packages/core/src/application/identity/linkOAuthIdentity.ts:163-165`, `packages/core/src/application/identity/completeOAuthSignIn.ts:360-370`
  - 理由: `spec/domains/identity.md` の追記が「順序は load-bearing である — 逆にすると 8 件を持つ利用者が自分の既存 identity を治癒できない」と明言し、plan.md のリスク欄も同じことを書いている。にもかかわらず TC-identity-343 / 344 が使う利用者は認証手段 1〜2 件なので、順序を逆にしても両ケースは通る。実際に `linkOAuthIdentity` で `ensureAddable` を `findOAuth` の**前**へ移す変異を入れて `packages/core/src/application/identity` 全 297 テストを走らせたところ **すべて green** だった。ADR 026 の「契約の判断は実行形で担保する」に照らすと、この load-bearing な順序だけが散文にしか無い状態になっている。
  - 提案: TC-identity-343 に「8 件（上限）を持つ利用者の残骸を治癒する」枝を足すか、別ケースとして起こす。`addPasswordIdentity` + 7 件の OAuth で埋めてから同じ注入を行えば、順序が逆の実装は `BusinessRuleError(IdentityLimitExceeded)` で落ちる。`completeOAuthSignIn` 側も同型。

- **[W-002]** 「壊す鍵は event payload、判定の材料は受領」という非対称の根拠がコード側に残っていない
  - 場所: `packages/core/src/application/identity/identityRemovalRelease.ts:9-37`（JSDoc）, 同 `:48-52` と `:65-73`
  - 理由: 観測は `event.payload.providerAccountKey` / `event.payload.userId` で取り、`stillClaimed` の判定は `receipt.providerAccountKey` / `receipt.userId` で行う。`ReleaseDecision` の release 分岐から鍵と利用者が落ちたので、「判定した鍵と取り壊す鍵が同じである」ことはもはや型からも読み取れず、`removeIdentity` が受領と event を同一トランザクションで同じローカル変数から書いていること（`removeIdentity.ts:95-114`）だけが根拠になっている。この前提は本 PR の adr.md ADR-008 が「`identityRemovalRelease` 側のコメントに 1 行残す」と自ら要求したものだが、JSDoc には入っていない。将来受領と event が別トランザクションへ分かれたとき、静かに壊れる種類の依存である。
  - 提案: JSDoc に 1 行足す。例: 「観測は event payload の鍵で取り、判定は受領で行う。両者は `removeIdentity` の同一トランザクションで同じ値から書かれるので食い違わない（`removeIdentity` の JSDoc が根拠）」。

- **[W-003]** `releasing` 行の回収経路の一本化で `deleteAccount/globalCleanup` も救済能力を失うが、ADR 060 の影響欄は `updateProfile` しか挙げていない
  - 場所: `spec/adr/060-conditional-unique-claim-teardown.md`（影響）, `packages/core/src/application/identity/deleteAccount/globalCleanup.ts:79-84`
  - 理由: 変更前の `beginRelease` は no-op 条件が「行なし / 別利用者 / `reserved`」だったので、所有者が一致すれば**別 operation が残した `releasing` 行を再キー付けして落とせた**。変更後は `state !== "active"` で弾かれ、`releaseActiveUniqueKey` 側も観測 null → `beginRelease` を呼ばないため、globalCleanup は「その利用者の鍵に他 operation の孤児 `releasing` 行が乗っている」状態を回収できない。`identityRemovalRelease` が `beginRelease` 済み・`release` 前で落ち、その outbox 行が `maxAttempts` 超過で隔離されると、利用者が退会してもその provider account 鍵は恒久的に parked のまま残る（旧実装なら globalCleanup が拾えた列）。ADR-007 / ADR 060 影響欄は同じ帰結を `updateProfile` についてだけ書いており、この列は記録されていない。
  - 提案: ADR 060 の影響欄（および plan.md のスコープ「`releasing` 行への期限の導入」）に、`deleteAccount/globalCleanup` も他 operation の孤児を拾えなくなることを 1 行足す。振る舞いの変更自体は ADR-007 の決定の範囲なので、記録を揃えるだけでよい。

#### カバレッジ

- 確認: `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `spec/usecases/identity.md`, `spec/domains/identity.md`, `spec/testcases/identity/removeIdentity.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/inventory/usecase.md`, `spec/inventory/test.md`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/index.md`
- スキップ: `spec/inventory/adapter.md` — 台帳の ADP 行はアダプター観点の担当で、ユースケースの振る舞いを規定しない（記述の整合は目視した）
- スキップ: `spec/inventory/domain.md` — 台帳の DOM 行はドメイン観点の担当で、ユースケースの振る舞いを規定しない（記述の整合は目視した）
- スキップ: `.thread/21/plan.md`, `.thread/21/adr.md`, `.thread/21/steps.md`, `.thread/21/testing.md` — 計画成果物でレビュー対象コードではない（契約として参照）

#### 検証方法

- `pnpm vitest run packages/core/src/application/identity packages/core/src/adapters` — 578 passed / 3 skipped
- `pnpm typecheck` — packages/core・apps/web ともに通過（`expectedClaimToken` の必須化が型として効いている＝ AC-1）
- 変異試験 4 本（観測位置の後退 / CAS 条件の除去 / トークン導出を `operationId` 由来に / 観測 null での早期 return）でそれぞれ TC-identity-342・ADP-identity-041 の 2 ケース・ADP-identity-042 の再取得ケース・TC-identity-345 が落ちることを確認。変更はすべて `git checkout` で復元済み。
