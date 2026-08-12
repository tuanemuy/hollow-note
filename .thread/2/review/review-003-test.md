# レビュー 003 — Test

## 機械照合（先に結論）

- Issue #2 のチェックリスト 366 行のうち TC 行は 287。plan.md の見送り TC 82 行を差し引いた **実装 TC 行は 205 行**。
- テストコード内の TC ID を全走査した結果、**205 行すべてがテスト名に存在**（取りこぼし 0）。
- **見送り 82 行の先取りは 0 件**。`TC-identity-052` だけがコード中に現れるが、`domain/identity/__tests__/policies.test.ts:232` の「この行は #3」という注記コメントであり、テスト名には冠していない（規律どおり）。
- 見送りの PAGE 行 3 件 / UC 行 3 件に対応するテストも無い（workspace / job / integration の application ファイル自体が変更に含まれない）。
- `pnpm test:unit`: 75 files / 891 passed / 3 skipped。skip は Google OAuth の code-exchange 半分のみ（資格情報ゲート、AC-6 どおり）。
- 定義済み適合スイート 31 本はすべて 1 度ずつ登録済み（memory 30 + `describeSignInOAuthClientContract` は `adapters/oauth/__tests__/conformance.test.ts`）。**死んだスイートは無い**。

全体として、期待結果の欠落をテスト名に書き出す規律（`TC-identity-090 (without the retry-time record)` / `TC-storage-043 (without the statement-count promise)`）が徹底されており、縮退が台帳（progress.md / adr.md）と一致している。並行系も「UoW の外で読んでから UoW に入る」実装（例: `verifyEmail.ts:45` の read → `:67` の run）のおかげで memory の直列化 mutex に潰されておらず、勝者 1 / 敗者 1 が実際に競合分岐で決まっている。以下は残った実害のある穴のみ。

## Blockers

- **[B-001]** `TC-identity-026` の期待結果のうち「セッションが発行される」が検証されていない
  - 場所: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts:151-167`
  - 理由: spec/testcases/identity/completeOAuthSignIn.md の当該行は「既存の利用者に `OAuthIdentity` が追加され、**セッションが発行される**」。テストは `created` / `userId` / identity の kind / directory 行しか見ておらず、`view.sessionToken` も `h.backend.sessions` も見ていない。`completeOAuthSignIn.ts` はセッション発行を分岐ごとに 3 箇所（`signInLinkedUser` / `createUser` / `attachToExistingUser`）で行っており、この TC が担当する `attachToExistingUser` の `sessionRepository.insert`（`completeOAuthSignIn.ts:332-341`）だけが落ちても全 891 テストが緑のまま。実害は「Google で入ったのに次のリクエストで未認証に戻る」で、ユニットテストからは見えない。
  - 提案: TC-024 / TC-025 と同様に `expect(h.backend.sessions.values().filter((s) => s.userId === userId)).toHaveLength(n)` と `expect(view.sessionToken.length).toBeGreaterThan(0)` を足す。

- **[B-002]** `TC-identity-265` の「**current** `userAuthEpoch`」が既定値と区別できない形でしか検証されていない
  - 場所: `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts:50-60`（`expect(stored?.userAuthEpoch).toBe(0)`）
  - 理由: 対象利用者は `signUpVerified` 直後で `authEpoch` が 0 なので、実装が `userReader.findById` を読まず定数 `0`（あるいは `null` → 0 相当）を書いても通る。`userAuthEpoch` を検証に使うのは `linkOAuthIdentity` の epoch 照合だが、対になる TC-identity-123 は「フロー開始後に epoch を進めて不一致になる」形なので、これも定数 0 実装で通ってしまう。つまりリポジトリ全体で「保存される epoch が利用者の現世代に追従する」ことを固定しているテストが 1 つも無い（`userAuthEpoch` を見るアサーションは `startOAuthFlow.test.ts:59` / `completeOAuthCallback.test.ts:144` / `pruneExpiredAuthState.test.ts:104` の 3 箇所だけで、いずれも 0）。回帰したときの実害は「パスワード変更・パスワード再設定・他端末サインアウトを 1 度でも行った利用者は以後 Google を追加できない」で、これは常用経路。
  - 提案: `signOutOtherSessions` か `bumpEpochTo` で epoch を 2 まで進めてから `startOAuthFlow` を呼び、`stored?.userAuthEpoch` が 2 になることを見る（1 ケース追加で閉じる）。

## Warnings

- **[W-001]** Node ワーカーランナーのテストが prune ロールしか固定していない（AC-29 / AC-32 の配線が無防備）
  - 場所: `apps/web/app/worker/node/__tests__/runner.test.ts:27-95`
  - 理由: 4 ケースすべて観測点が `[outbox] pruned` のログ行数と start/stop の冪等性・シグナル listener の解除だけ。`start()` の `track(runRelayTick())`（クラッシュ残骸の relay ドレイン）と `scopeTaskTrigger.kick()` + 1 秒の `scopeTaskTimer`（ADR-023、`runner.ts:227-242`）を消してもすべて緑になる。3 つ目のケースは `scopeTaskIntervalMs: 60_000` を渡して scope task tick を**黙らせて**いる。AC-29 の「`pnpm dev` 上で `deleteAccount` が受理から `completed` まで完走する」を支える唯一の駆動主体がここなのに、自動テストの守りがマニュアルテストだけになっている。
  - 提案: fake timer 下で「期限到来の scope タスクを 1 件仕込んで既定 tuning で `start()` → 1.5 秒進めると処理済みになる」ケースと、「未処理 outbox 行が `start()` 直後に 1 度ドレインされる」ケースを足す。

- **[W-002]** `deleteFilesByOwner` の `batchSize` 上限 100 が未検証
  - 場所: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`（`batchSize` を渡すのは 50 / 10 のみ）、実装は `deleteFilesByOwner.ts:56-59`
  - 理由: AC-25 は「`batchSize` 既定 / **最大 100**」を要求している。既定 100 と「ちょうど 100」（TC-storage-038）は固定されているが上限クランプは一度も踏まれず、`Math.min(..., OWNER_DELETE_BATCH_SIZE)` を外しても緑（境界の外側が無い）。1 回の turn で発行するイベント数を抑える上限なので、外れると barrier 後の 1 turn が青天井になる。
  - 提案: `batchSize: 101` で 150 件を仕込み、削除が 100 件で止まって継続が 1 件積まれることを見る。

- **[W-003]** `TC-identity-126` の敗者の分岐が特定されていない
  - 場所: `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts:240-256`
  - 理由: memory の UoW は直列化されるので、この `Promise.allSettled` は実質 TC-125 と同じ逐次経路に落ちる。それ自体は結果が同じなので許容だが、アサーションが `fulfilled が 1 件` / `identity 8 件` / `directory 1 行`のみで、**敗者の理由を見ていない**。予約の取り合いで落ちても、無関係な例外で落ちても通る。同じファイルの TC-125 は `IdentityLimitExceeded` をコードで確認しているので、ここだけ緩い。
  - 提案: 敗者が `BusinessRuleError(IdentityLimitExceeded)` であることと、残った directory 行が `active` であることを追加する。

- **[W-004]** `ScopeTaskQueue.listDue` の適合ケースが、ポートの JSDoc が明示的に許した実装を落とす
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:174-196` と `packages/core/src/application/ports/scopeTaskQueue.ts:19-22`
  - 理由: ポートは「各 scope が自分で起きる（Durable Object alarm）ランタイムは空配列を返す。それはスタブではなく完全な実装」と書いているのに、適合スイートは無条件登録で `due.map(...)` の内容と順序を要求する。#11 の DO 実装は契約どおりに作っても落ちる。`seedMembershipEdges` のように `ConformanceBackendOptions` のゲートが無い。
  - 提案: どちらかに寄せる。ゲートを足して「中央列挙を持つバックエンドのみ登録」にするか、ポート JSDoc の逃げ道を消して listDue を必須契約にするか。今のままだと #11 のスライスが「契約の解釈」から始めることになる。

- **[W-005]** manifest item key の**文字列表現**を契約にしている
  - 場所: `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts:140-142`, `:471`, `:487`（`"authorRoute:note-001"` / `"membership:edge-a"`）
  - 理由: ポート型は `key: string` としか言っておらず、この符号化は memory アダプター内部（`adapters/memory/repositories/accountDeletionManifestStore.ts:217`）。application 側は `item.key` を往復させるだけで組み立てない（`deleteAccount/authorRedaction.ts:87-88`）。別の符号化を採る D1 実装が、観測可能な結果ではなく内部表現で落ちる。docs/test.md の「契約化するのは観測可能な結果だけ」に反する。
  - 提案: 件数・一意性・同一ページ再送で重複しないこと（＝冪等 append の本題）を見る形に置き換える。

- **[W-006]** 「completed 後の `acknowledgePersonalComponent` は no-op」が状態で確認されていない
  - 場所: `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts:105-113`
  - 理由: plan のテスト方針が求める ADR-018 の追加分のうち、completed 後の ack について「投げないこと」だけを見ており、後続の確認が `assertWritable()` が `ACCOUNT_DELETING` で落ちることだけ。これは `running` でも成立するので、ack が receipt を `running` に巻き戻すバックエンド（＝`pruneCompleted` が永久に回収しなくなる）でも通る。
  - 提案: `:110` の後に `expect((await store.describePersonalCleanup("op-1"))?.status).toBe("completed")` を足す。

- **[W-007]** 「継続タスクを削除と同一 UoW で再登録する」が固定されていない
  - 場所: `packages/core/src/application/usage/__tests__/deleteQuota.test.ts:143`（TC-usage-032 / 033）、`packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:174`（TC-storage-037）
  - 理由: AC-24 が「`LlmUsage` を 100 件ずつ削除して継続タスクを**同一 UoW で**再登録」を要求しているが、削除と `scopeTaskScheduler.schedule` の間で例外を注入するテストが無く、schedule を別トランザクションに出しても緑。ここが割れると「ページは消えたが継続が積まれていない」＝ barrier が永久に running になる。
  - 提案: `scopeTaskScheduler.schedule` の直後に例外を投げる override を挟み、ロールバック後に削除も戻っている（＝件数が変わらない）ことを 1 ケース見る。

- **[W-008]** `assertWritable` / `assertActorWritable` の 2 本呼び出しが個別に固定できていない
  - 場所: `packages/core/src/application/storage/storeAvatar.ts:97-98`、`packages/core/src/application/usage/recalculateStorageUsage.ts:64-65`
  - 理由: AC-19 / AC-22 は「2 本を呼ぶ」を明示要件にしているが、本 Issue には `scope.actorLocks` を埋める経路が無い（`adapters/memory/repositories/scopeCleanupAdmissionStore.ts:76` が読むだけ）ため両者は同じ receipt 行で同じ `ACCOUNT_DELETING` を投げる。どちらか片方を消しても全テストが緑で、TC-identity-045 は残った 1 本で通る。
  - 提案: 本 Issue 単独では閉じられない（actorLock を立てる membership prepare wave が #3）。適合スイート側に「actorLock を立てるバックエンド向けのゲート付きケース」を置くか、#3 引き継ぎとして縮退に 1 行足す。今の状態は「AC の 2 本要求が構造的に検証不能」であることが台帳から読めない。

- **[W-009]** `testTimeout: 30_000` が docs/test.md の記述と矛盾し、値の根拠も実測と合わない
  - 場所: `vitest.config.ts:15-18`、`docs/test.md`（"Timeout / flakiness" 節の "The configs use Vitest's default timeouts"）
  - 理由: 同じ PR で片方だけ変わり、ドキュメントが実態と食い違ったまま。またコメントは「change-password の 1 ケースが scrypt 7 連鎖で 5 秒既定を超える」としているが、`--reporter=verbose` で測った最遅テストは 238ms（スイート全体 6 秒）。既定の 6 倍の猶予は、`deletionHarness.buildDeletionManifest` の `for(;;)` のような無限ループ系が顕在化するまでの時間を伸ばすだけになっている。
  - 提案: 実測に見合う値（例: 10s）へ下げるか、根拠のコメントを実測に合わせて書き直したうえで、docs/test.md の当該行を更新する。

- **[W-010]** テストのコメントが「注入した障害」を誤って説明している（共通チェック）
  - 場所: `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts:178-180`
  - 理由: 「Re-delivering **the sessions turn** must not walk back … it deletes nothing and **re-emits the same switch**」とあるが、実際に配送しているのは `table: "authTokens"` の turn（`:172-176`）で、1 回目は old world の authToken 行を実際に削除しており、継続の再発行も `expect(continuations(h)).toHaveLength(0)` で「積まれない」ことを確認している。テスト自体は TC-identity-042 の期待結果（保存済み table から再開し session phase へ戻らない）を正しく検証しているので、誤っているのはコメントだけ。後から読む人が別の障害を検証していると誤解する。
  - 提案: 「authTokens phase の turn を二重配送しても sessions へ巻き戻らず、継続も増えない」と書き直す。

- **[W-011]** 「再起動しても拾う」ケースの片方のアサーションが自明に成立する
  - 場所: `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts:109-119`
  - 理由: `const restarted = createTestHarness()` は**別のバックエンド**を作るので、`expect(await runDueScopeTasks(restarted.workerContainer)).toEqual({ processed: 0 })` は「空の DB には期限到来タスクが無い」しか言っていない。再起動を模していない。ケースの実質（`listDue` がテーブルから読む / 同じバックエンドで 1 件処理される）は次の 2 行が担っているので害は小さいが、この 1 行はテスト名の主張を支えていない。
  - 提案: 同じ `h.backend` の上に新しいコンテナだけを組み直す形にするか、この行を落とす。

- **[W-012]** `TC-identity-081` の「全 plane の ack 前は finalize しない」が receipt 側だけで成立している
  - 場所: `packages/core/src/application/identity/__tests__/deleteAccount.redaction.test.ts:203-209`
  - 理由: `finalizeAccountDeletion` を呼ぶ時点で `header.receipts` が空なので、`allRequiredAcknowledged` は receipt 集合の条件だけで false になる。item ack 側の門（`adapters/memory/repositories/accountDeletionManifestStore.ts:121-128` の AND）を外しても、このケースは通る。item ack 側はポート適合スイート（`adapters/conformance/accountDeletionManifestStore.ts:194-210`）で押さえられているので Warning 止まり。
  - 提案: receipt を先に 3 つ揃えたうえで redaction item を 1 件残し、それだけで finalize が待つことを見る。

## カバレッジ

確認 77 / スキップ 197 = 274。実装ファイルは「Test」観点の判定に必要な範囲で読んだ（`adapters/memory/store.ts` の直列化 mutex、`completeOAuthSignIn.ts` / `startOAuthFlow.ts` / `verifyEmail.ts` の read/UoW 境界、`storeAvatar.ts` / `deleteFilesByOwner.ts` / `recalculateStorageUsage.ts` の門、`worker/node/runner.ts`、各ポートの JSDoc 契約）が、レビュー対象の帰属は他観点なのでスキップ側に数えている。

- 確認（77）:
  - 適合スイート 16: `packages/core/src/adapters/conformance/` の `accountDeletionManifestStore.ts`, `appliedOperationStore.ts`, `authTokenRepository.ts`, `backend.ts`, `distributedOperationStore.ts`, `identityRemovalReceiptStore.ts`, `identityUniqueDirectory.ts`, `llmUsageRepository.ts`, `noteProjection.ts`, `objectStorage.ts`, `outboxRepository.ts`, `scopeCleanupAdmissionStore.ts`, `scopeTaskScheduler.ts`, `signInOAuthClient.ts`, `storageQuotaRepository.ts`, `storedFileRepository.ts`
  - `packages/core/src/adapters/memory/__tests__/` 3: `conformance.test.ts`, `conformanceBackend.ts`, `unitOfWork.test.ts`
  - `packages/core/src/adapters/oauth/__tests__/` 2: `conformance.test.ts`, `googleSignInOAuthClient.test.ts`
  - `packages/core/src/application/identity/__tests__/` 31（`deleteAccount.*` 8 本、`deletionDriver.ts` / `deletionHarness.ts` / `authFlowHelpers.ts` を含む）
  - `packages/core/src/application/{storage,usage,workers,di,execution,note}/__tests__/` 12
  - `packages/core/src/application/__tests__/helpers.ts`
  - `packages/core/src/domain/{usage,storage,identity}/__tests__/` 4
  - `apps/web/app/presentation/__tests__/` 4、`apps/web/app/worker/node/__tests__/runner.test.ts`、`apps/web/app/components/auth/__tests__/passwordStrength.test.ts`
  - `vitest.config.ts`, `docs/test.md`
- スキップ（197）:
  - `.thread/2/**`（17） — 計画・ADR・過去レビューの記録で、テストコードではない
  - `apps/web/**`（`__tests__` を除く 64: components 36 / routes 17 / `presentation/*.ts` 7 / `server.node.ts` / `worker/node/runner.ts` / `scripts/listen.node.ts` / `.env.example`） — docs/test.md の方針どおりフロントエンドのテスト対象は `presentation/` の純関数のみで、それらは確認側に含めた。UI・ルート・エントリー実装そのものは frontend / adapter 観点（`runner.ts` は W-001 の判定材料として読んだ）
  - `docs/runtime_node.md`（1） — 運用ドキュメント
  - `packages/core/src/adapters/memory/**`（18） / `packages/core/src/adapters/oauth/*.ts`（4）（いずれも `__tests__` を除く） — アダプター実装本体は adapter 観点
  - `packages/core/src/application/**`（`__tests__` を除く 64） — usecase / ポート実装本体は domain-usecase 観点
  - `packages/core/src/domain/**`（`__tests__` を除く 29） — ドメイン実装本体は domain-usecase 観点
