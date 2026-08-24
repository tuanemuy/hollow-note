# api 項目の観測結果 — Issue #21

**実行日:** 2026-08-25
**ブランチ:** issue/21/identity-claim-cas
**コミット:** a43db83

## 項目 7: ポート契約と適合スイート

**コマンド:** `pnpm exec vitest run packages/core/src/adapters/memory/__tests__/conformance.test.ts --reporter=verbose`

**観測（Test Files / Tests 行）:**
```
 Test Files  1 passed (1)
      Tests  232 passed (232)
```

**観測（`ADP-identity-042` を含む行、全 5 行）:**
```
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-042: resolveClaim answers with owner and token for an active claim only 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-042: the same normalized key is a separate claim per kind 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-042: the token stays the same for as long as the claim lives 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-042/ADP-identity-041: a re-taken claim carries a different token 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-042/ADP-identity-006: resolve is a projection of resolveClaim in every state 0ms
```

**観測（`ADP-identity-041` を含む行、全 9 行）:**
```
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-042/ADP-identity-041: a re-taken claim carries a different token 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041: beginRelease quoting a superseded token leaves the current claim intact 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041: a releasing row is not taken over by another operation 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041/ADP-identity-009: beginRelease then release frees an activated claim for another user 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041/ADP-identity-007: a releasing key stays blocked for another user until release 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041/ADP-identity-009: beginRelease and release are idempotent for the same operation 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041: beginRelease by a non-owner leaves the claim intact 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041: beginRelease leaves a still-reserved row alone 0ms
 ✓ packages/core/src/adapters/memory/__tests__/conformance.test.ts > IdentityUniqueDirectory conformance [memory] > ADP-identity-041: beginRelease on an unknown key is a no-op 0ms
```
（`grep -c` による件数: `ADP-identity-042` = 5、`ADP-identity-041` = 9）

**期待結果との突き合わせ材料:**
- `Test Files 1 passed` / 失敗 0 → 上記の `Test Files 1 passed (1)` / `Tests 232 passed (232)` に対応。失敗を示す行（✗/×）は出力中に無し。
- `ADP-identity-042` の 4 ケース対応:
  - claim の観測 → `resolveClaim answers with owner and token for an active claim only`
  - 同じ operationId で張り直した claim の観測値不一致 → `a re-taken claim carries a different token`（`ADP-identity-042/ADP-identity-041` のタグ付き行）
  - 4 状態での resolve と resolveClaim の一致 → `resolve is a projection of resolveClaim in every state`（`ADP-identity-042/ADP-identity-006` のタグ付き行）
  - 冪等な activate を挟んでも観測値が不変 → `the token stays the same for as long as the claim lives`
- `ADP-identity-041` は 9 行（期待の「6 行 + 2 行追加」に対して +3 になっている）。新規と見られる行:
  - `beginRelease quoting a superseded token leaves the current claim intact`（古い観測値の beginRelease が現行 claim を壊さない、に対応）
  - `a releasing row is not taken over by another operation`（releasing 行が別 operation の beginRelease に奪われない、に対応）
  - `a re-taken claim carries a different token`（`ADP-identity-042/ADP-identity-041` の複合タグ、こちらは 042 のケースにも数えている）
  既存 6 行と見られるもの: `beginRelease then release frees an activated claim for another user`、`a releasing key stays blocked for another user until release`、`beginRelease and release are idempotent for the same operation`、`beginRelease by a non-owner leaves the claim intact`、`beginRelease leaves a still-reserved row alone`、`beginRelease on an unknown key is a no-op`

## 項目 8: 経路 1（判定 → beginRelease の窓）と孤児 releasing 行の回収

**コマンド:** `pnpm exec vitest run packages/core/src/application/identity/__tests__/removeIdentity.test.ts --reporter=verbose`

**観測（Test Files / Tests 行）:**
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

**観測（全テスト名）:**
```
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-179: deletes the identity and emits identity.identity.removed 42ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-180: refuses to remove the last identity 34ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-181: another user's identity is not found 63ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-182: an unknown id is not found 32ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-184: the released provider account can be linked by somebody else 33ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > refuses to sign in with the provider account of a removed identity before the release lands 32ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > tells the owner the claim is being released when re-linking before it lands 33ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-185: a re-sent removal answers from the receipt and releases under the same operation id 32ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-186: two concurrent removals leave one identity standing 34ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > keeps the re-linked claim when the removal event is redelivered 65ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-342: a re-link landing right after the decision keeps its claim 33ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-345: a redelivery collects the releasing row an interrupted teardown left 67ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > TC-identity-346: a redelivery leaves a stranger's claim on the released account alone 66ms
 ✓ packages/core/src/application/identity/__tests__/removeIdentity.test.ts > removeIdentity > keeps the claim when no receipt backs the removal event 33ms
```

**観測（`TC-identity-342` / `TC-identity-345` / `TC-identity-346` を含む行）:** 上記一覧中にそれぞれ ✓ 行が存在する（342・345・346 いずれも 1 行ずつ）。

**テストコードの読み取り — `TC-identity-342` の割り込み位置（`packages/core/src/application/identity/__tests__/removeIdentity.test.ts` 357–392 行目）:**

```ts
const realProvider = h.workerContainer.globalUnitOfWorkProvider;
let interfered = false;
const interleaved: WorkerContainer = {
  ...h.workerContainer,
  globalUnitOfWorkProvider: {
    run: async (fn) => {
      const result = await realProvider.run(fn);
      if (!interfered) {
        interfered = true;
        // The decision has committed and its transaction is closed:
        // an earlier delivery completes the release, and the owner
        // then takes the same account again.
        await drainRemovalEvents(h);
        await relinkGoogleAccount(h, userId);
      }
      return result;
    },
  },
};
```

割り込み（`drainRemovalEvents` / `relinkGoogleAccount`）は `realProvider.run(fn)` の呼び出しの**直後**（`globalUnitOfWorkProvider.run` のラッパー内、コミット完了後）に置かれている。コード中のコメントは「The decision has committed and its transaction is closed」と明記している。`beginRelease` の直前という記述箇所はテストコード中に見当たらない。

**テストコードの読み取り — `TC-identity-345` の assert 文（394–445 行目、そのまま列挙）:**

```ts
await expect(drainRemovalEvents(h, interrupted)).rejects.toSatisfy(
  isSystemError,
);
expect(directoryRow(h, "google:google-account-1")?.state).toBe("releasing");

await drainRemovalEvents(h);

expect(directoryRow(h, "google:google-account-1")).toBeUndefined();
...
expect(directoryRow(h, "google:google-account-1")).toMatchObject({
  state: "active",
  userId: stranger.userId,
});
```

## 項目 9: 経路 2（activate 喪失 + reserved の TTL 失効）の治癒

**コマンド:** `pnpm exec vitest run packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts --reporter=verbose`

**観測（Test Files / Tests 行）:**
```
 Test Files  2 passed (2)
      Tests  29 passed (29)
```

**観測（`TC-identity-343` / `TC-identity-344` を含む行）:**
```
stdout | packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts > completeOAuthSignIn > TC-identity-344: re-signing in heals an identity whose claim was lost mid-saga
 ✓ packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts > completeOAuthSignIn > TC-identity-344: re-signing in heals an identity whose claim was lost mid-saga 34ms
stdout | packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts > linkOAuthIdentity > TC-identity-343: re-linking heals an identity whose claim was lost mid-saga
 ✓ packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts > linkOAuthIdentity > TC-identity-343: re-linking heals an identity whose claim was lost mid-saga 34ms
```

**テストコードの読み取り — `TC-identity-343` の assert 文（`packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts` 282–331 行目、そのまま列挙）:**

```ts
expect(view.identityId).toBe(stranded?.id);
expect(identitiesOf(h, userId)).toHaveLength(8);
expect(
  identitiesOf(h, userId).filter(
    (row) =>
      row.kind === "oauth" && row.providerAccountId === "google-link-1",
  ),
).toHaveLength(1);
expect(
  await h.container.identityUniqueDirectory.resolve(
    "providerAccount",
    "google:google-link-1",
  ),
).toBe(userId);
```

（このブロックの手前で `expect(stranded).toBeDefined()` / `expect(identitiesOf(h, userId)).toHaveLength(8)` / `expect(directoryRows(h).map((row) => row.state)).toEqual(["reserved"])` という TTL 失効前の中間 assert もある。）

**テストコードの読み取り — `TC-identity-344` の assert 文（`packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts` 348–406 行目、そのまま列挙）:**

```ts
expect(isSystemError(error)).toBe(true);
expect(
  base.backend.identities.values().filter((row) => row.userId === userId),
).toHaveLength(8);
expect(
  directoryRows(base, "providerAccount").map((row) => row.state),
).toEqual(["reserved"]);

expect(view.userId).toBe(userId);
expect(view.sessionToken.length).toBeGreaterThan(0);
const sessions = base.backend.sessions.values();
expect(sessions).toHaveLength(sessionsBefore + 1);
expect(sessions.map((session) => session.tokenHash)).toContain(
  base.container.secureTokenGenerator.hashOf(view.sessionToken),
);
expect(
  base.backend.identities.values().filter((row) => row.userId === userId),
).toHaveLength(8);
expect(
  base.backend.identities
    .values()
    .filter(
      (row) =>
        row.kind === "oauth" &&
        row.providerAccountId === "google-account-1",
    ),
).toHaveLength(1);
expect(
  await base.container.identityUniqueDirectory.resolve(
    "providerAccount",
    "google:google-account-1",
  ),
).toBe(userId);
```

**テストコードの読み取り — `TC-identity-344` で provider が返す email と既存利用者の account email が一致しているか:**

- 348–352 行目のコメント: 「The provider address matches the existing account, so the flow lands on the `linkToExisting` branch rather than creating a user.」
- 352 行目: `const { userId } = await signUpVerified(base, "user@example.com");`（既存ユーザーの account email）
- 367 行目: `const error = await signInWithOAuth(h, { email: "user@example.com" }).catch(...)`（signInWithOAuth に渡す grant の email。同ファイル 57–64 行目の `codeFor` ヘルパーがこの `email` を認可コードの provider email として埋め込む: `email: grant.email ?? "oauth-user@example.com"`）
- `packages/core/src/application/identity/completeOAuthSignIn.ts` 150–172 行目で `decision.kind` が `"linkToExisting"` のとき `attachToExistingUser(container, { userId: decision.userId, ... })` に分岐している（該当コード）:
```ts
case "linkToExisting":
  return attachToExistingUser(container, {
    userId: decision.userId,
    accountKey,
    profile,
    flow,
  });
```

## 項目 10: 品質ゲート（全体）

**コマンド 1:** `pnpm typecheck`
**終了状態:** 成功（exit code 0）
**最後の数行:**
```
$ tsgo && pnpm -r typecheck
Scope: 2 of 3 workspace projects
packages/core typecheck$ tsgo
packages/core typecheck: Done
apps/web typecheck$ tsgo
apps/web typecheck: Done
```

**コマンド 2:** `pnpm lint:fix`
**終了状態:** 成功（exit code 0）
**最後の数行:**
```
$ biome check --write
biome.json:2:14 deserialize ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  i The configuration schema version does not match the CLI version 2.5.5
  ...
biome.json:25:13 deserialize  DEPRECATED  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ...
Checked 446 files in 440ms. No fixes applied.
Found 2 infos.
```
`Found N infos` の数値: **2**

**コマンド 3:** `pnpm format`
**終了状態:** 成功（exit code 0）
**最後の数行:**
```
$ biome format --write
Formatted 446 files in 81ms. No fixes applied.
```

**コマンド 4:** `pnpm test:unit`
**終了状態:** 成功（exit code 0）
**最後の数行:**
```
 RUN  v4.1.10 /Users/hikaru/github.com/tuanemuy/hollow


 Test Files  76 passed (76)
      Tests  970 passed | 3 skipped (973)
   Start at  00:34:02
   Duration  6.18s (transform 4.72s, setup 0ms, import 14.50s, tests 16.12s, environment 5ms)
```

**`pnpm lint:fix` / `pnpm format` がファイルを書き換えたか:**
`git status --short` を lint:fix 直前・lint:fix 後・format 後に実行。いずれの時点でも差分は空（`git status --short` の出力が 0 行）。両コマンドとも「No fixes applied.」と明記しており、書き換えは発生していない。

**テストコードの読み取り — `checkHandleAvailability.test.ts` の `beginRelease` 呼び出し箇所（62–80 行目、そのまま引用）:**

```ts
const observed = await h.container.identityUniqueDirectory.resolveClaim(
  "handle",
  "ichiro",
);
if (observed === null) {
  throw new Error("the claim to tear down was not observed");
}
await h.container.identityUniqueDirectory.beginRelease({
  kind: "handle",
  normalizedKey: "ichiro",
  expectedUserId: UserId.create(owner.userId),
  expectedClaimToken: observed.claimToken,
  operationId: "release-1",
});
```

渡しているトークン（`expectedClaimToken`）は `observed.claimToken`、すなわち直前の `resolveClaim("handle", "ichiro")` の観測値そのものであり、ダミー文字列ではない。

**期待結果との突き合わせ材料:**
- 4 コマンドすべて exit code 0（成功）。
- `pnpm test:unit`: 観測は `Test Files 76 passed (76)` / `Tests 970 passed | 3 skipped (973)`。期待の「`Test Files 76 passed`、`Tests` は 958 より多い passed / 3 skipped」に対し、passed 数は 970（958 より多い）、skipped は 3 で一致。
- `pnpm lint:fix` の infos は観測 2 件、期待の「2 件」と同じ数値。
- `checkHandleAvailability.test.ts` は `resolveClaim("handle", "ichiro")` の戻り値 `observed.claimToken` を `beginRelease` に渡している（上記引用の通り）。
