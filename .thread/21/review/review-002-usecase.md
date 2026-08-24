# レビュー 002 — Use Case 観点

## Use Case

### Blockers

なし。

急所として指定された 4 点はいずれも正しく実装されており、**実際に変異を入れて実行し、テストが落ちることを確認した**。

| 検証項目 | 実装 | 変異注入の結果 |
|---|---|---|
| 観測の位置（判定 UoW より前か） | `identityRemovalRelease.ts:51` の `observeActiveUniqueKey` が `globalUnitOfWorkProvider.run`（同 57）より前 | 観測を `releaseObservedUniqueKey` の直前へ移すと TC-identity-342 が `directoryRow(...)` = `undefined` で落ちる |
| CAS 失敗が例外でなく no-op | `memory/repositories/identityUniqueDirectory.ts:143-150` が early return、ポート JSDoc も no-op と明記。`releaseObservedUniqueKey` は返り値を見ない | — |
| 「解放する」判定時は CAS の結果によらず必ず `release(operationId)` | `uniqueness.ts:211-220`（`beginRelease` だけが条件付き、`release` は無条件） | `if (params.observed === null) return;` を足すと TC-identity-345 が `releasing` 行の残留で落ちる |
| `ensureAddable` より前の `findOAuth` | `linkOAuthIdentity.ts:148-165` / `completeOAuthSignIn.ts:362-370` | `ensureAddable` を `findOAuth` の前に戻すと TC-identity-343 が `IdentityLimitExceeded` で落ちる |

そのほか確認して問題を認めなかった点:

- **二平面 UoW**: `identityRemovalRelease` の `run` は 1 本きり。観測（鍵 shard の読み）は UoW の**外**にあり、`spec/usecases/identity.md#identity-uniqueness-の物理shard境界` の「User row と uniqueness shard を同一 transaction にしない」を守っている。`linkOAuthIdentity` / `attachToExistingUser` の治癒分岐は既存 UoW の中で `listByUserId` の結果に述語を当てるだけで、リポジトリの追加も `run` のネストもない。イベントは従来どおり `ctx.collectEvents` のみ。
- **治癒時の状態遷移**: 治癒分岐は identity の insert と `collectEvents` だけを飛ばし、`committedVersion` を返して `activateUniqueKeys` に到達させるので claim が `active` に復旧する。`identity.added` を再送しないのは正しい（残骸を生んだサガは UoW を commit 済みで、イベントは既に一度 outbox に載っている）。`completeOAuthSignIn` 側は Session insert が `if (existing === null)` の**外**にあるのでサインイン自体は成立し、`linkOAuthIdentity` は既存行の ID を返す。
- **`release(operationId)` の巻き添え**: `removalOperationId` は `removeIdentity:${identityId}`、予約は `${parent}:${kind}:${key}` で名前空間が交わらないので、無条件 `release` が進行中の予約行を落とす経路はない。
- **冪等性**: E1（旧 removal）が遅れて再配送され、そのあいだに再連携 → 再削除 → 再連携が起きた列を追ったが、`stillClaimed`（keep）と claimToken の CAS（no-op）が二重に守っており、現行の claim を壊す到達列は見つからなかった。
- **セキュリティ**: `findOAuth` はいずれの経路でも `listByUserId(自分)` の結果にしか当たらないので、他人の identity 行に触れる経路は増えていない。`linkOAuthIdentity` の所有者判定（`owner !== userId` → `PROVIDER_ACCOUNT_ALREADY_LINKED`）と `reserve` の競合検出も従来どおり。
- **Cross-layer catch policy**: 新たな `try / catch` は入っていない。既存のサガ補償（予約解放）とワーカーの部分失敗許容だけで、ユースケースがエラーを再翻訳・直列化している箇所はない。
- **不要な記述**: コード・コメントに弁明や修正経緯の残骸は見つからなかった。`identityRemovalRelease` / `uniqueness.ts` に足されたコメントはいずれも「なぜその順序か」「なぜ無条件か」を述べる WHY で、CLAUDE.md のコメント方針に沿う。`existingLinkId` の `#21` 参照も解消済み。
- **スコープ**: 差分に計画の「含まれないもの」を越える変更は見当たらない。`completeOAuthSignIn.test.ts` の `plantOAuthIdentities` 抽出はテストヘルパーの再利用で、TC-identity-027 の意味は変わっていない（実行して green を確認）。
- **AC-6 の回帰**: `pnpm vitest run packages/core/src/application/identity/__tests__ packages/core/src/adapters/memory` → 36 files / 550 tests all green。`deleteAccount.globalCleanup.test.ts:167` の `beginRelease` 差し替えは `observeActiveUniqueKey` の追加で空振りしうるが、当該テストは `rejects.toThrow()` を主張しているので空振りすれば落ちる形になっており、green なので `beginRelease` に到達している（無効化されていない）。

### Warnings

- **[W-001]** TC-identity-344 の「セッションが発行される」主張が実効的でない
  - 場所: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts:382`
  - 理由: `expect(view.sessionToken.length).toBeGreaterThan(0)` は空振りする。`session` は `secureTokenGenerator.issueForUser` が UoW に入る**前**に作る値で、Session insert が行われたかどうかとは独立に必ず非空になる。実際に `attachToExistingUser` の `sessionRepository.insert` を `if (existing === null)` ブロックの**中**へ移す変異を入れて `completeOAuthSignIn.test.ts` を実行したところ、18 テストすべて green のままだった（＝治癒経路でセッションが発行されなくなっても誰も落ちない）。plan.md AC-5 は `completeOAuthSignIn` 側の追加条件として明示的に「セッションが発行される」を挙げており、その 1 点だけが拘束されていない。同ファイルの兄弟ケース（`:140` / `:172` / `:213`）はいずれも `h.backend.sessions.values()` を数えているので、書き方の前例もある。
  - 提案: `const before = base.backend.sessions.values().length;` を再サインインの前に取り、後で `expect(base.backend.sessions.values()).toHaveLength(before + 1)` を主張する（あるいは `sessions` の中に `tokenHash` が `view.sessionToken` に対応する行があることを見る）。`view.sessionToken.length` の行は残しても害はないが、それだけでは AC-5 を満たさない。

- **[W-002]** `keep` 分岐が `release(operationId)` を呼ばない理由がコードにもテストにも残っていない
  - 場所: `packages/core/src/application/identity/identityRemovalRelease.ts:83-89`
  - 理由: AC-8 が「孤児 `releasing` 行の唯一の回収経路」と位置づけた `release(operationId)` は、`decision.outcome === "release"` の枝にしかない。今日これが安全なのは、`beginRelease` 済みで `releasing` になった鍵に対して 3 つの keep 理由がいずれも**到達不能**だからである（`identityStillPresent`: 削除済み identity 行は戻らない / `providerAccountRelinked`: `releasing` 行が `reserve` を弾くので再連携が identity 行を作れない / `noReceipt`: 30 日保持の受領が消える前に outbox の再配送か隔離のどちらかが先に起きる）。この 3 点は `releaseObservedUniqueKey` の JSDoc が主張する「観測 null でも `release` を呼ぶから回収できる」の前提そのものだが、`identityRemovalRelease` 側には一言も書かれておらず、テストも `release` 判定の列（TC-identity-345）しか通らない。将来 keep 理由が 1 つ増えたとき、それが `releasing` 状態で真になりうるかを誰も検査しないまま鍵が恒久的に固まる。
  - 提案: `keep` 分岐に「keep 理由はいずれも `releasing` 行の上では成立しないので、この early return が孤児を取り残すことはない」という趣旨の 1 行 WHY を置く（ADR 060 / ADR-004 への参照付き）。もしくは `release(operationId)` を判定の外へ出して常に呼ぶ形にすれば、この前提そのものが不要になる（`release` は自 operation の `reserved` / `releasing` 行しか落とさないので、keep の列で呼んでも副作用はない）。

### カバレッジ

- 確認: `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `spec/usecases/identity.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/removeIdentity.md`
- スキップ: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts` — 適合スイートの内容はアダプター観点の担当（ユースケースが依存する契約の存在だけポート JSDoc 側で確認）
- スキップ: `packages/core/src/adapters/memory/store.ts` — `DirectoryRow.claimToken` の採番位置はアダプター観点の担当
- スキップ: `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/index.md` — ADR の整合は spec 観点の担当
- スキップ: `spec/database/index.md`, `spec/domains/identity.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md` — ドメイン / アダプター / spec 観点の担当
- スキップ: `.thread/21/adr.md`, `.thread/21/plan.md`, `.thread/21/steps.md`, `.thread/21/testing.md`, `.thread/21/review/review-001-adapter.md`, `.thread/21/review/review-001-domain.md`, `.thread/21/review/review-001-spec.md`, `.thread/21/review/review-001-usecase.md`, `.thread/21/review/review-001.md`, `.thread/21/review/triage.md` — 計画・レビューの成果物でレビュー対象コードではない（契約として `plan.md` / `adr.md` は読了）
