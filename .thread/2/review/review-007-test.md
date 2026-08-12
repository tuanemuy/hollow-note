### Test

#### Blockers

- **[B-001]** `TC-identity-081` の期待結果「全 local/public ack 前は finalize しない」が空振り検証になっている（アイテム ack ゲートを単独で固定するテストがコード全体に 1 本も無い） / 場所: `packages/core/src/application/identity/__tests__/deleteAccount.redaction.test.ts:201-209`、`packages/core/src/adapters/conformance/accountDeletionManifestStore.ts:198-217` / 理由: 当該テストは 250 件中 100 件だけ ack した状態で `finalizeAccountDeletion` を叩き `status === "deleting"` を主張するが、この時点の manifest は receipt を 1 つも持っていない。`allRequiredAcknowledged`（`packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts:124-131`）は「membership item 全 ack ∧ authorRoute item 全 ack ∧ 宣言 receipt 全 ack」の連言なので、receipt 側が 0 件である以上、**author route の 150 件を連言から丸ごと落としても同じアサーションが通る**。適合スイート側も同様で、`ADP-common-019/021/023` は item も receipt も未 ack の状態から始めるため false の原因を切り分けられず、今ラウンド追加された `ADP-common-019/021: every declared receipt is required, one missing at a time` は逆に **item を全 ack してから receipt を 1 つずつ欠く**構成なので、item ack 連言の判別性は増えていない。`deleteAccount.finalize.test.ts` の TC-102/103/再配送ケースはいずれも `redactAll` → `grantReceipts` の順で全部揃えてから叩くため、「receipt は揃っているが item が残っている」配置はどこにも無い。適合スイートは将来の D1/DO バックエンドの受け入れゲートなので、item 連言を落とした実装がスイート緑のまま通り、AC-27 の author redaction が finalize を止めなくなる / 提案: `describeAccountDeletionManifestStoreContract` に補集合の 1 ケース（`markBuilt` → **receipt を全部 ack** → item は未 ack のまま `allRequiredAcknowledged` が false・`markCompleted` が conflict、item を ack して初めて true）を足す。ユースケース側でも TC-identity-081 の中途 finalize の直前に 3 receipt を付与しておけば、同じ 1 行で「item だけが止めている」ことを主張できる。

#### Warnings

- **[W-001]** `TC-identity-041` の「AuthToken 残件 0 確認後**だけ** receipt を ack する」の否定側が恒真アサーションになっている / 場所: `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts:137-141` / 理由: sessions フェーズ完了直後の「まだ ack していない」を `allRequiredAcknowledged("deletion-1")` で見ているが、このテストは `personalCleanup` / `uniquenessRelease` を一度も付与しないので、`authResidue` の有無に関わらず必ず false になる。さらに authTokens の 1 ページ目（残件 1 件、`:143-147`）には receipt のアサーションが無い。結果として、フェーズ切替時点や非終端ページで `authResidue` を先に ack してしまう実装がこのテストを素通りする / 提案: `expect(h.backend.manifestHeaders.get("deletion-1")?.receipts).not.toContain("authResidue")` を sessions 完了後と authTokens 1 ページ目の後に置く（終端後の `toContain` は既にある）。
- **[W-002]** `TC-storage-047`「1 件の削除が失敗する — 記録して継続する」の両半とも未検証 / 場所: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:400-412` / 理由: アサーションは `deletedCount === 4` / 残 1 件 / event 4 件のみ。(1)「記録」に当たる観測点が実装に無い（`packages/core/src/application/storage/deleteFiles.ts:29-31` は消えた行を無言で `continue` する。JSDoc で意図は書かれているが、TC が求める「記録」は満たさない）。(2)「継続」も未主張で、`turn.status`（この配置では `"continued"`）と、そのターンが積む継続タスクの本数を見ていない。また arrange が「delete が失敗する」ではなく「行が消えている」の代替になっているため、真に delete が失敗するケース（OCC 衝突・ストレージ障害）では現実装はターンごと巻き戻り、TC の期待結果と逆になる / 提案: 最低限 `expect(turn).toMatchObject({ status: "continued" })` と `expect(tasks(h)).toHaveLength(1)` を足す。「記録」を落とす判断なら plan.md の縮退（Issue コメント）に `TC-storage-047` の欠落要素として 1 行で残す。
- **[W-003]** `TC-storage-039`「受け取った削除 event は再投入しない」が未検証 / 場所: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:257-270` / 理由: `storage.ownerDeleteContinued` の scope タスクが 1 件であることと payload は固定されているが、outbox に元の削除コマンド event が積み直されていないことは見ていない。ヘルパー `deletionEvents` は `storage.fileDeleted` しか拾わないので、受領コマンドを outbox へ再 collect する実装が緑のまま通る / 提案: そのターンの outbox 行を type ごとに数え、`storage.fileDeleted` 以外の増分が無いことを 1 行で主張する。
- **[W-004]** `TC-identity-110` の「最大 100 件ずつ回収する」バッチ上限が実行されていない事実が、コード JSDoc にはあるが plan.md の縮退記録に無い / 場所: `packages/core/src/application/cleanup/personalCleanup.ts:86-90`（該当テストは `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts:299-331`） / 理由: memory アダプターは 1 scope に barrier receipt を 1 件しか持てないため full-page 分岐が構造的に到達不能で、そこは JSDoc で #11 へ引き継がれている。ただし AC-27 は `TC-identity-110` をチェック対象行として数えており、plan.md「縮退」節の記載形式（どの ID のどの要素を欠いたか）に該当するのにその 1 行が無い。120 日境界そのものは両側とも検証済み（`deleteAccount.cleanup.test.ts:341-347`） / 提案: 縮退に「`TC-identity-110` — ページ上限 100 の分岐は memory バックエンドでは到達不能なため未検証 / 引き継ぎ先 #11」を 1 行足す。
- **[W-005]** `UsageWarningLevel.of` の `limit <= 0 → "exceeded"` 分岐が未検証 / 場所: `packages/core/src/domain/usage/__tests__/valueObject.test.ts:123-131`（実装は `packages/core/src/domain/usage/valueObject.ts:105`） / 理由: docs/test.md がドメイン層は ~100% を目安と定めており、`LlmCallQuota.create(0)` は同ファイル `:78` が正当な状態として通しているので、0 除算回避のこの分岐は到達可能な合法状態から入る。79/80/99/100/101 の境界は両側とも押さえられている / 提案: `UsageWarningLevel.of(0, 0)` の 1 行を足す。
- **[W-006]** `TC-identity-268` の期待結果 `BusinessRuleError(InvalidProvider)` のコード名が満たされておらず、spec-sync 候補にも載っていない / 場所: `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts:116-127`（期待結果は `spec/inventory/test.md:407`、`spec/usecases/identity.md:230`） / 理由: テストは `IdentityErrorCode.InvalidProviderAccount`（`IDENTITY_INVALID_PROVIDER_ACCOUNT`）を主張している。`BusinessRuleError` であること・state が積まれないことは検証済みなので実害は無いが、`InvalidProvider` はドメインのエラーコード union（`spec/domains/identity.md:523`、`packages/core/src/domain/identity/errorCode.ts:15`）に存在しない幽霊名で、spec 側の誤りである可能性が高い。plan.md のステップ 34 が集める spec-sync 候補にこの行が無い（`TC-integration-170` も同じ幽霊名を持つ） / 提案: 縮退ではなく spec-sync 候補として「`spec/usecases/identity.md:230` / `spec/inventory/test.md:407,613` の `InvalidProvider` は `InvalidProviderAccount` の誤り」を記録する。

#### カバレッジ

- 確認: `.thread/2/plan.md`, `docs/test.md`, `vitest.config.ts`,
  `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`,
  `apps/web/app/presentation/__tests__/deletionTicket.test.ts`,
  `apps/web/app/presentation/__tests__/devOAuth.test.ts`,
  `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`,
  `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`,
  `apps/web/app/worker/node/__tests__/runner.test.ts`,
  `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`,
  `packages/core/src/adapters/conformance/appliedOperationStore.ts`,
  `packages/core/src/adapters/conformance/authTokenRepository.ts`,
  `packages/core/src/adapters/conformance/backend.ts`,
  `packages/core/src/adapters/conformance/distributedOperationStore.ts`,
  `packages/core/src/adapters/conformance/identityRemovalReceiptStore.ts`,
  `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`,
  `packages/core/src/adapters/conformance/llmUsageRepository.ts`,
  `packages/core/src/adapters/conformance/noteProjection.ts`,
  `packages/core/src/adapters/conformance/objectStorage.ts`,
  `packages/core/src/adapters/conformance/outboxRepository.ts`,
  `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`,
  `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`,
  `packages/core/src/adapters/conformance/signInOAuthClient.ts`,
  `packages/core/src/adapters/conformance/storageQuotaRepository.ts`,
  `packages/core/src/adapters/conformance/storedFileRepository.ts`,
  `packages/core/src/adapters/memory/__tests__/conformance.test.ts`,
  `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`,
  `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`,
  `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`,
  `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`,
  `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts`,
  `packages/core/src/application/__tests__/helpers.ts`,
  `packages/core/src/application/di/__tests__/serverNode.test.ts`,
  `packages/core/src/application/di/serverNode.ts`,
  `packages/core/src/application/execution/__tests__/eventId.test.ts`,
  `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts`,
  `packages/core/src/application/identity/__tests__/authFlowHelpers.ts`,
  `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts`,
  `packages/core/src/application/identity/__tests__/changePassword.test.ts`,
  `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`,
  `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts`,
  `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.admission.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.globalCleanup.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.manifestBuild.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.recovery.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.redaction.test.ts`,
  `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`,
  `packages/core/src/application/identity/__tests__/deletionDriver.ts`,
  `packages/core/src/application/identity/__tests__/deletionHarness.ts`,
  `packages/core/src/application/identity/__tests__/getAccountDeletionStatus.test.ts`,
  `packages/core/src/application/identity/__tests__/getProfile.test.ts`,
  `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`,
  `packages/core/src/application/identity/__tests__/listIdentities.test.ts`,
  `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`,
  `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`,
  `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`,
  `packages/core/src/application/identity/__tests__/resendVerificationEmail.test.ts`,
  `packages/core/src/application/identity/__tests__/resetPassword.test.ts`,
  `packages/core/src/application/identity/__tests__/signOut.test.ts`,
  `packages/core/src/application/identity/__tests__/signOutOtherSessions.test.ts`,
  `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`,
  `packages/core/src/application/identity/__tests__/updateProfile.test.ts`,
  `packages/core/src/application/identity/__tests__/verifyEmail.test.ts`,
  `packages/core/src/application/note/__tests__/createBlankNote.test.ts`,
  `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`,
  `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`,
  `packages/core/src/application/storage/__tests__/storeAvatar.test.ts`,
  `packages/core/src/application/storage/deleteFiles.ts`,
  `packages/core/src/application/usage/__tests__/deleteQuota.test.ts`,
  `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts`,
  `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts`,
  `packages/core/src/application/workers/__tests__/outboxPrune.test.ts`,
  `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`,
  `packages/core/src/application/workers/__tests__/subscribers.test.ts`,
  `packages/core/src/domain/identity/__tests__/policies.test.ts`,
  `packages/core/src/domain/storage/__tests__/storage.test.ts`,
  `packages/core/src/domain/usage/__tests__/quota.test.ts`,
  `packages/core/src/domain/usage/__tests__/valueObject.test.ts`
  （81 件）
- スキップ: 残り 213 件 — テスト観点の対象外。内訳は (a) `.thread/2/` の計画・進捗・過去レビュー記録 36 件（本レビューはゼロベースのため plan.md 以外は参照しない）、(b) `apps/web/app/{components,routes,presentation}/` の実装・UI・ルート 60 件（フロントエンド観点）、(c) `packages/core/src/{domain,application,adapters}/` の実装本体 111 件（ドメイン・ユースケース／アダプター観点。ただし判定に必要な範囲で `deleteFiles.ts` / memory の `accountDeletionManifestStore.ts` / `serverNode.ts` / `cleanup/personalCleanup.ts` は読んだ）、(d) `apps/web/{.env.example,scripts,app/server.node.ts,app/routeTree.gen.ts,app/worker/node/runner.ts}` と `docs/runtime_node.md` 6 件（ランタイム配線）。

#### 機械照合

- plan.md の AC 表が「通る」と宣言する TC 行を展開すると **205 行**（TC-identity 168 / TC-storage 19 / TC-usage 18）。全 205 行が `it(...)` / `test(...)` の**テスト名**に TC ID として出現する（コメント内出現は数えていない）。取りこぼし 0。
- 見送り 89 行の先取りは無し。`TC-identity-052` だけがコード中に現れるが `packages/core/src/domain/identity/__tests__/policies.test.ts:233` の「rejected 経路は #3」という why-not コメントで、テスト名ではない。
- `pnpm test:unit`: 75 files / 915 passed / 3 skipped。skip 3 件は `SignInOAuthClient code exchange [google]` の 3 ケースで、AC-6 が要求する「登録行は残し理由つきで skip」に一致（`packages/core/src/adapters/conformance/signInOAuthClient.ts:55-71`。`describe.skip` の body が握る minter は throw するので、ゲートを誤って広げたら空振りせず落ちる）。適合スイート内の `ctx.skip()` 3 箇所は `seedMembershipEdges` を持たないバックエンド向けのガードで、memory では実行される。
- 新規 9 スイートは `packages/core/src/adapters/memory/__tests__/conformance.test.ts`（8 件）と `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`（`signInOAuthClient`）に全て登録済み。既存 3 スイートの宣言集合への一般化（`scopeCleanupAdmissionStore` / `accountDeletionManifestStore` / `identityUniqueDirectory`）も入っている。
- コード・コメントに指摘への弁明や修正の経緯は見当たらない（`レビュー` / `指摘` / `以前は` / `変更前` / `TODO` / `FIXME` の全走査で、残っているのは仕様由来の記述のみ）。
