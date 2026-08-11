# レビュー 002 — Test 観点

対象: PR #17 / `issue/2/account-management-and-auth`（ベース `main`、変更 250 ファイル）
検証: `pnpm test:unit` = 72 files / 862 passed / 3 skipped（skip は Google OAuth の code exchange 3 件のみ、AC-6 の設計どおり）

TC カバレッジの機械照合結果（Issue #2 チェックリスト 287 行の TC 行 − 見送り 82 行 = **実装 205 行**）:

- 205 行すべてについて、TC ID をテスト名に含むテストが存在する（**欠落 0**）。
- 見送り 82 行のうち **1 行（TC-identity-052）だけ**が TC ID 付きのテスト名で存在する（W-001）。

以下は「ID はあるが期待結果が検証されていない」行の洗い出し。

## Test

### Blockers

- **[B-001]** TC-identity-090 の期待結果 3 節のうち「再試行時刻を記録する」が実装も検証もされておらず、plan.md の縮退にも ID 単位で記録されていない
  - 場所: `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts:103` / 実装 `packages/core/src/application/identity/deleteAccount/finalize.ts:42-54`
  - 理由: `spec/testcases/identity/deleteAccount.md` の当該行（inventory `TC-identity-090`）の期待結果は「Userは`deleting`のままでPIIを削除せず、**再試行時刻を記録する**」。テストが検証しているのは前 2 節（`status === "deleting"` / email・identity が残る / operation が `running`）と、`logger` に `"finalize is still waiting"` が出ることだけで、再試行時刻に相当する状態は一切見ていない。実装も `allRequiredAcknowledged` が偽なら `logger.info` して `return` するだけで、`next_attempt_at` 相当を書かない（`DistributedOperationStore` に該当フィールドが無い）。つまりログ 1 行を期待結果の代替に据えており、TC ID を冠したまま期待結果の 1/3 が形骸化している。plan.md 148 行目付近の縮退「受理応答 / barrier ack を落としたときの再駆動主体を置かない」は**機構**の不在を散文で書いているが、plan.md 自身が定めた記録規律「**チェックを付ける行の一部を欠く縮退は、どの ID のどの要素を欠いたかまで書く**」（plan.md「縮退」節冒頭）を TC-identity-090 について満たしていない。このままステップ 34 でチェックを付けると、検証されていない節が「実装済み」として台帳に載る。
  - 提案: どちらかを行う。(a) finalize が待たされたことを観測可能な状態として残す（`DistributedOperationStore` に最終試行時刻を書く、あるいは manifest header に `lastFinalizeAttemptAt` を持たせる）うえでテストで検証する。(b) 実装しない判断を維持するなら、plan.md の縮退節と Issue コメント（ステップ 34）に「`TC-identity-090` — 期待結果のうち『再試行時刻を記録する』を欠いてチェック（`DistributedOperationStore` に `next_attempt_at` を持たないため。引き継ぎ先: recovery Cron を持つスライス）」を 1 行で追記し、テスト名も `TC-identity-090（再試行時刻の記録を除く）` のように欠落を明示する。ログ assert を期待結果の代替として残すのは不可。

- **[B-002]** TC-storage-043 の期待結果「件数によらず 3 文」が検証されないどころか実装で成立せず、テストが期待値を実装側に合わせて書き換えている
  - 場所: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:285-316`（特にコメント 311-313 行）
  - 理由: inventory `TC-storage-043` の期待結果は「列挙 1 文 + 多行 DELETE 1 文 + 多行 outbox INSERT 1 文で、**件数によらず 3 文**」。テストが検証しているのは `listByOwner` の呼び出しが 1 回であることと `storage.fileDeleted` が 40 件出ることだけで、DELETE / INSERT の文数は見ていない。しかも実装は ADR-022 の決定により 1 件ずつ `findById` → `delete(id, expectedVersion)` を回すので、40 件で 40 往復＝期待結果は**そもそも成立しない**。テスト内コメント「The per-row `findById` the OCC contract requires is a property of this adapter, not of the turn: what the turn promises is a single enumeration and one deletion event per file (ADR-022)」は、spec の期待結果を実装に合わせて再定義した記述そのもの（「実装を読んで期待値を書いた形跡」）。ADR-022 の Consequences には「削除が 1 件ずつの読み書きになる（… D1 では 1 バッチ 100 往復）」とトレードオフが書かれているが、plan.md の縮退節には TC-storage-043 の名も欠落要素も無く、AC-25 は当該行を「通る」対象として列挙している。
  - 提案: plan.md の縮退節と Issue コメントに「`TC-storage-043` — 期待結果のうち『件数によらず 3 文』を欠いてチェック（ADR-022 で削除を `findById` + `delete` の OCC 経由に固定したため。引き継ぎ先: 一括削除 API を持つアダプターを足すスライス）」を 1 行で追記し、テスト名を欠落が分かる形（例: `TC-storage-043（列挙 1 回とファイル 1 件 1 イベントのみ。文数は ADR-022 で対象外）`）に改める。テスト内コメントは「spec のこの節は本 Issue では検証しない」と言い切る形にし、期待結果を言い換える書き方をやめる。

### Warnings

- **[W-001]** 見送り行 TC-identity-052 が TC ID 付きのテスト名で存在し、台帳上「検証済み」に見える
  - 場所: `packages/core/src/domain/identity/__tests__/policies.test.ts:224`
  - 理由: plan.md の見送り表は `TC-identity-051, 052`（唯一 owner による rejected とその再要求）を #3 送りとし、縮退節でも「根拠行 `TC-identity-052` も見送り。本 Issue で検証するのは**ドメイン単体テスト（7 / 8 / 9 の境界）**と `countTerminalSince` の適合スイートまでで、**行としての検証は #3**」と明記している。ドメイン単体テストを書くこと自体は計画どおりだが、テスト名に `TC-identity-052:` を冠したことで AC-33 の照合（見送り 89 行はチェックされていないこと）が機械的に取れなくなり、ステップ 34 で誤ってチェックされる余地が残る。実際、見送り 82 TC 行のうち TC ID 付きテストがあるのはこの 1 行だけ。
  - 提案: テスト名から TC ID を落とし（例: `AccountDeletionRetryPolicy admits the ninth attempt only while fewer than 8 terminal rows are retained`）、TC-identity-052 との関係は JSDoc に「行としての検証は #3」と書く。

- **[W-002]** `codeOf` ヘルパーが「投げなかった」と「別種のエラーを投げた」を区別できないまま、正常系の assert に使われている
  - 場所: `packages/core/src/domain/usage/__tests__/quota.test.ts:16-23`（用例 `:100`, `:135`, `:152-160`, `:183-193`）、`packages/core/src/domain/identity/__tests__/policies.test.ts:224-234`
  - 理由: `codeOf` は `catch` で `isBusinessRuleError(error) ? error.code : null` を返すので、`TypeError` などが飛んでも `null` を返す。`expect(codeOf(() => StorageQuota.ensureCanStore(quotaOf(900), 100))).toBeNull()` や `expect(codeOf(() => AccountDeletionRetryPolicy.ensureRetryable(7))).toBeNull()` は「境界内なので通る」ことを主張しているのに、実際には「BusinessRuleError 以外で落ちた」場合も緑になる。DOM-usage-006/007/008 の許容側境界（headroom ちょうど / 残 60 回ちょうど）がここに集中しており、境界の片側が事実上無検証になりうる。
  - 提案: 許容側は `expect(() => …).not.toThrow()` を使うか、`codeOf` を「BusinessRuleError 以外は再 throw する」実装に変える（`if (!isBusinessRuleError(error)) throw error;`）。後者なら既存の呼び出しをそのまま強化できる。

- **[W-003]** `pruneExpiredAuthState` に追加した 5 つ目の掃除対象 `identity_removal_receipts` に、実際に行を消す検証が 1 件も無い
  - 場所: `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts:279`, `:300`, `:566`, `:598`
  - 理由: 追加された assert は `identityRemovalReceipts: 0`（空の場合）と、レーン分割テストで対象表名として並べるだけ。期限切れの `IdentityRemovalReceipt` を積んで sweep で消える／期限内は残ることを見ているテストが無いので、`authStateSweepers` への登録が抜けている・別表を掃いているといった配線ミスが緑のまま通る。`IdentityRemovalReceiptStore.deleteExpired` 自体は適合スイート（`identityRemovalReceiptStore.ts:91`）が押さえているので、抜けているのはユースケース側の配線だけ。AC-14 の receipt 保持（30 日）が実際に回収されるかを担保しているのはこの経路のみ。
  - 提案: 期限切れ 1 件 + 期限内 1 件を仕込み、`cron(h)` 後に `identityRemovalReceipts: 1` と残存 1 件を assert するケースを 1 本足す（既存の `sessions` 用ケースと同型で書ける）。

- **[W-004]** `StoredFileRepository` 適合スイートが JSDoc で ADP-storage-003（`save`）を契約範囲に含めているのに、`save` を一度も呼ばない
  - 場所: `packages/core/src/adapters/conformance/storedFileRepository.ts:27-31`（「ADP-storage-001..005, 011, 012」）
  - 理由: スイート内で検証しているのは `insert` / `findById` / `delete` / `listByIds` / `listByOwner` / `sumSizeByOwner` で、`save(entity, expectedVersion)` の OCC 契約（`ConflictError("OPTIMISTIC_LOCK_FAILURE")`）は 1 ケースも無い。memory 実装は共有の `createOccRepository` 由来なので今は他スイートで間接的に守られるが、適合スイートは「他バックエンドを差し替えたときに契約を守らせる」ためのものなので、SQL アダプターを足した時点で無検証の穴になる。同種の `StorageQuotaRepository` / `LlmUsageRepository` は ADP-usage-003 / 008 として `save` を明示的に検証しており、ここだけ非対称。
  - 提案: 姉妹スイートと同じ形で `save` の 1 ケースを足す（stale トークンで `OPTIMISTIC_LOCK_FAILURE`、有効トークンで値が反映される）。実装しないなら JSDoc の範囲表記から `003` を外す。

- **[W-005]** `.thread/2/` の作業記録（`steps.md` / `plan.md` / `progress.md`）を指すコメントが出荷コード・テストに残っている
  - 場所: `packages/core/src/adapters/conformance/identityRemovalReceiptStore.ts:11`（`steps.md step 1`）、`packages/core/src/application/di/__tests__/serverNode.test.ts:58`（`コード確認に留まる（progress.md に記録）`）、`packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts:82`（`plan.md 縮退: …`）
  - 理由: これらは Issue #2 の進行記録であって、コードを読む人が参照できる恒久ドキュメントではない。特に `serverNode.test.ts:58` の「ルート loader が偽で `notFound()` を投げる 1 行はコード確認に留まる（progress.md に記録）」はレビュー進行の弁明そのもので、Issue が閉じた時点で意味を失う。参考までに、コード中の `ADR-0xx` 参照（`ADR-047` など）も現状 `.thread/2/adr.md` にしか存在せず、`spec/adr/` の別番号と衝突しうる。
  - 提案: `steps.md` / `plan.md` / `progress.md` への参照は削除するか、恒久ドキュメント（`spec/` または昇格後の `spec/adr/`）を指す形に書き換える。`serverNode.test.ts:58` の「どこまでを自動検証にしたか」は、進行記録ではなく「404 ガードの判定はこのフラグに閉じている」という設計の説明だけを残す。

### カバレッジ

確認（71 件）:

- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`
- `apps/web/app/presentation/__tests__/devOAuth.test.ts`
- `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`
- `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`
- `packages/core/src/adapters/conformance/appliedOperationStore.ts`
- `packages/core/src/adapters/conformance/authTokenRepository.ts`
- `packages/core/src/adapters/conformance/backend.ts`
- `packages/core/src/adapters/conformance/distributedOperationStore.ts`
- `packages/core/src/adapters/conformance/identityRemovalReceiptStore.ts`
- `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`
- `packages/core/src/adapters/conformance/llmUsageRepository.ts`
- `packages/core/src/adapters/conformance/noteProjection.ts`
- `packages/core/src/adapters/conformance/objectStorage.ts`
- `packages/core/src/adapters/conformance/outboxRepository.ts`
- `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`
- `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`
- `packages/core/src/adapters/conformance/signInOAuthClient.ts`
- `packages/core/src/adapters/conformance/storageQuotaRepository.ts`
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts`
- `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`
- `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts`
- `packages/core/src/application/__tests__/helpers.ts`
- `packages/core/src/application/di/__tests__/serverNode.test.ts`
- `packages/core/src/application/execution/__tests__/eventId.test.ts`
- `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts`
- `packages/core/src/application/identity/__tests__/authFlowHelpers.ts`
- `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts`
- `packages/core/src/application/identity/__tests__/changePassword.test.ts`
- `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`
- `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts`
- `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.admission.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.globalCleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.manifestBuild.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.recovery.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.redaction.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`
- `packages/core/src/application/identity/__tests__/deletionDriver.ts`
- `packages/core/src/application/identity/__tests__/deletionHarness.ts`
- `packages/core/src/application/identity/__tests__/getAccountDeletionStatus.test.ts`
- `packages/core/src/application/identity/__tests__/getProfile.test.ts`
- `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`
- `packages/core/src/application/identity/__tests__/listIdentities.test.ts`
- `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`
- `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`
- `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`
- `packages/core/src/application/identity/__tests__/resendVerificationEmail.test.ts`
- `packages/core/src/application/identity/__tests__/resetPassword.test.ts`
- `packages/core/src/application/identity/__tests__/signOut.test.ts`
- `packages/core/src/application/identity/__tests__/signOutOtherSessions.test.ts`
- `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`
- `packages/core/src/application/identity/__tests__/updateProfile.test.ts`
- `packages/core/src/application/identity/__tests__/verifyEmail.test.ts`
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/application/storage/__tests__/storeAvatar.test.ts`
- `packages/core/src/application/usage/__tests__/deleteQuota.test.ts`
- `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts`
- `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts`
- `packages/core/src/application/workers/__tests__/outboxPrune.test.ts`
- `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/domain/identity/__tests__/policies.test.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/domain/usage/__tests__/quota.test.ts`
- `packages/core/src/domain/usage/__tests__/valueObject.test.ts`

スキップ（179 件、ディレクトリ単位）:

- `.thread/2/**`（12 件） — 計画・レビュー記録。テスト実装ではない（plan.md / adr.md / testing.md は判断材料として読了）
- `docs/runtime_node.md`（1 件）, `apps/web/.env.example`（1 件） — 実行ドキュメント・設定。テスト観点外
- `apps/web/app/components/**`（30 件） — UI コンポーネント。ユニットテストが無く AC-30 のマニュアルテスト範囲（Frontend 観点）
- `apps/web/app/routes/**`（15 件） — ルート・server function 実装。TC-identity-048 の入力境界のみ `settings/-action.tsx` を参照確認したが、テスト対象コードなので観点外
- `apps/web/app/presentation/*.ts`（5 件、テスト以外） — `deletionTicket.ts` / `devOAuth.ts` / `oauthStateBinding.ts` / `oauthStateCookie.ts` / `errorDisplay.ts` の実装本体（テスト側で挙動を確認済み）
- `apps/web/` のその他（4 件） — `server.node.ts` / `worker/node/runner.ts` / `scripts/listen.node.ts` / `routeTree.gen.ts`。実装・生成物
- `packages/core/src/adapters/**`（22 件、適合スイート以外） — memory アダプター実装・OAuth アダプター実装。Adapter 観点
- `packages/core/src/application/ports/**`（10 件） — ポート定義。契約は適合スイート側で確認
- `packages/core/src/application/**`（54 件、テスト以外） — ユースケース・DI・ワーカー実装。Domain / Usecase 観点（`finalize.ts` / `cleanupDispatch.ts` / `pruneExpiredAuthState.ts` は指摘の根拠として参照）
- `packages/core/src/domain/**`（25 件、テスト以外） — エンティティ・VO・ポリシー・ポート定義。Domain 観点（`storedFileRepository.ts` / `objectStorage.ts` は W-004 の根拠として参照）
