### Domain / Use Case

ゼロベースで、ドメイン層（identity / storage / usage）とユースケース層（identity 20 本 + storage 3 本 + usage 3 本 + cleanup / workers / execution）を独立に検証した。
`pnpm test:unit` は全緑（903 passed / 3 skipped）。

#### Blockers

- **[B-001]** finalize の必須 receipt 集合が先頭 1 件に切り詰められており、`authResidue` / `uniquenessRelease` を待たずに削除が完了しうる / 場所: `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts:65-66` /
  理由: 現在の実装は

  ```ts
  const requiredReceipts =
    (options.requiredFinalizeReceipts ?? ALL_FINALIZE_RECEIPTS).slice(0, 1);
  ```

  で、composition root が渡す宣言集合（`REQUIRED_FINALIZE_RECEIPTS` = `personalCleanup` / `authResidue` / `uniquenessRelease`）を `["personalCleanup"]` に落とす。直上の JSDoc（「Defaults to every non-rollback receipt — the strictest reading」）とも、ADR-017 / AC-31（「必須集合は宣言集合ベース」）とも矛盾し、`.slice` を正当化するコメントもテストも無い。
  実害の経路: `allRequiredAcknowledged` が `personalCleanup` だけで true を返すため、`finalizeAccountDeletion` が `uniquenessRelease` 未 ack のまま PII を落として tombstone 化し、続く `compactAccountDeletionManifest` が header を `completed` へ移す。`runAccountDeletionGlobalCleanup` は先頭で `header.status !== "built"` なら即 return するので（`deleteAccount/globalCleanup.ts:672-677`）、**email / handle / providerAccount の active 予約が永久に解放されない** — AC-26 の「削除後の同一メール / 同一 provider account での再登録」が成立しなくなる。同様に `startAuthResidueCleanup` は `status !== "deleting"` で return するため、旧世代の `sessions` / `auth_tokens` 物理行も回収されない。
  到達条件は珍しくない: `cleanup` phase イベントには購読者が 2 本（`identity.accountDeletionCleanup` → `identity.accountDeletionGlobalCleanup`）並び、前者が `personalCleanup` receipt と `redaction` 継続を同一 UoW でコミットしてから後者が走る。前者のコミット後・後者の実行前にプロセスが落ちると、`cleanup` は再配送される一方で `redaction` 行は既に耐久化済みなので、`redaction` → `finalize:redaction` が先に走りうる。宣言集合が正しければここで finalize は待つ（それが `uniquenessRelease` を必須 receipt に置いた理由そのもの）が、切り詰められていると通ってしまう。
  なお、この行は**作業ツリー未コミットの変更**で `git diff origin/main...HEAD` には含まれない（`git status` に `M` として出る）。このままコミットされると上記が入るので、マージ前に revert すること。
  提案: `.slice(0, 1)` を削除して `options.requiredFinalizeReceipts ?? ALL_FINALIZE_RECEIPTS` に戻す。あわせて W-001 のテストを足し、同じ切り詰めが二度と CI をすり抜けないようにする。

#### Warnings

- **[W-001]** 「宣言された receipt の一部が欠けたら finalize は進まない」を実効的に検証しているテストが無い / 場所: `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts:199-216`, `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts:102-120` /
  理由: 適合スイートの該当ケースは「item 未 ack の状態で false」→「宣言外 receipt を足しても false」→「`finalizeAll()` で item も receipt も全部 ack して true」という順で、**item は全部 ack 済み・宣言 receipt は真部分集合**という状態を一度も作らない。ユースケース側の TC-identity-090 も receipt を 1 件も与えないので、先頭の `personalCleanup` さえ必須なら通る。結果として「宣言集合より**少なく**要求するバックエンド」は検出できない（多く要求する側は検出できる）。実際 B-001 の切り詰めを入れた状態でも 903 テストが全緑だった。
  提案: 適合スイートに「全 item ack + 宣言 receipt のうち 1 件だけ欠く → `allRequiredAcknowledged === false` かつ `markCompleted` が `ConflictError`」を、欠く receipt を宣言集合の各要素で回す形で追加する。ADR-017 が導入した「宣言集合」という自由度に対する唯一の防波堤なので、契約側に置くのが妥当。

- **[W-002]**（低）`updateProfile` が `OPTIMISTIC_LOCK_FAILURE` の全てを「同一ハンドルへの並行試行」とみなして予約を解放しない / 場所: `packages/core/src/application/identity/updateProfile.ts:222-232` /
  理由: 解放を抑止する根拠として書かれているのは「同じ operationId の別試行が行を所有している」だが、条件はエラーコードだけを見ている。`fresh.entity.version !== observedVersion` は**ハンドルを触らない並行更新**（自己紹介だけの保存、別タブからのアバター更新）でも成立するので、その場合は誰も所有していない `reserved` 行が TTL（10 分）まで残り、その間そのハンドルは他の利用者が取得できない。所有者自身は決定的 operationId で取り直せるので自己回復はする。
  提案: 抑止条件を「今回の試行が予約行を新規に作っていない場合」に限るか、`reserve` の戻り値で「既存行を再利用したか」を返して判断材料にする。既知の縮退（旧ハンドル解放の再駆動不在 → #9）と同じ引き継ぎ先に載せてもよい。

#### 所見（指摘ではない）

- 削除オーケストレーションの中核（受理の順序、barrier→manifest build、宣言 participant による cleanup wave、`AppliedOperationStore` による初回コマンドの重複排除、scope task による継続、`ScopeTaskRunner` の hand-over 行、redaction の turn 番号付け、finalize 再試行の producer 別 cursor、compaction→terminal prune）は spec/usecases/identity.md 手順 2〜5 と整合しており、UoW のネストも無い（scope UoW と global UoW は常に逐次）。
- `authEpoch` バンプ 4 経路（`resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount`）は 1 実装の `authResidueCleanup` を共有し、`versioned.entity.authEpoch !== authEpoch` で世代追い越しを止め、`refreshAuthEpoch` で現世代を残す。`deleteOlderEpochByUser` の境界も「現世代を消さない」テストで守られている。
- 一意性予約サガ 3 kind（email / handle / providerAccount）は `reserve → shard commit → activate` の順序と、失敗時の解放・`activate` 応答喪失時の `confirm` 1 回評価が共通化されている。`PROVIDER_ACCOUNT_RELEASE_PENDING` は `signInLinkedUser`（最終 UoW 内で identity 行を確認）と `linkOAuthIdentity.existingLinkId` の両経路で共有され、両方にテストがある（`removeIdentity.test.ts:176-228`）。`errorDisplay.ts` にも文言がある。
- `DeletingUser` / `DeletedUser` に対する倒れ方は signIn(OAuth) / link / passwordReset / resetPassword / updateProfile / addPassword / changePassword / signOutOtherSessions / storeAvatar / recalculateStorageUsage のいずれも確認した。`removeIdentity` / `listIdentities` だけは user status を見ないが、いずれもセッション認証（epoch 検査）を通らないと到達しないので実害は無い。
- コード・コメントにレビュー経緯や弁明の残骸は見当たらない（`review` / `指摘` / `R1` 等の grep で該当なし）。
- 全量実行中に `ADP-common-009/010` が 1 度だけ失敗したが、これは B-001 の編集がテスト実行中にディスクへ着地したことによるモジュールグラフの不整合で、単体・再実行いずれも安定して緑。指摘には含めない。

#### カバレッジ

**確認: 105 件 / スキップ: 184 件 / 合計 289 件**

##### 確認（105 件）

- `.thread/2/plan.md`
- `apps/web/app/routes/settings/-action.tsx`
- `packages/core/src/application/__tests__/helpers.ts`
- `packages/core/src/application/cleanup/participants.ts`
- `packages/core/src/application/cleanup/personalCleanup.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/di/serverNode.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/execution/eventId.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.recovery.test.ts`
- `packages/core/src/application/identity/__tests__/deletionDriver.ts`
- `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`
- `packages/core/src/application/identity/addPasswordIdentity.ts`
- `packages/core/src/application/identity/authResidueCleanup.ts`
- `packages/core/src/application/identity/changePassword.ts`
- `packages/core/src/application/identity/checkHandleAvailability.ts`
- `packages/core/src/application/identity/completeOAuthCallback.ts`
- `packages/core/src/application/identity/completeOAuthSignIn.ts`
- `packages/core/src/application/identity/continuations.ts`
- `packages/core/src/application/identity/deleteAccount/admission.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
- `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
- `packages/core/src/application/identity/deleteAccount/compaction.ts`
- `packages/core/src/application/identity/deleteAccount/finalize.ts`
- `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`
- `packages/core/src/application/identity/deleteAccount/index.ts`
- `packages/core/src/application/identity/deleteAccount/input.ts`
- `packages/core/src/application/identity/deleteAccount/manifestBuild.ts`
- `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`
- `packages/core/src/application/identity/eventDecoders.ts`
- `packages/core/src/application/identity/getAccountDeletionStatus.ts`
- `packages/core/src/application/identity/getProfile.ts`
- `packages/core/src/application/identity/identityRemovalRelease.ts`
- `packages/core/src/application/identity/linkOAuthIdentity.ts`
- `packages/core/src/application/identity/listIdentities.ts`
- `packages/core/src/application/identity/pruneExpiredAuthState.ts`
- `packages/core/src/application/identity/removeIdentity.ts`
- `packages/core/src/application/identity/requestPasswordReset.ts`
- `packages/core/src/application/identity/resendVerificationEmail.ts`
- `packages/core/src/application/identity/resetPassword.ts`
- `packages/core/src/application/identity/signOut.ts`
- `packages/core/src/application/identity/signOutOtherSessions.ts`
- `packages/core/src/application/identity/startOAuthFlow.ts`
- `packages/core/src/application/identity/uniqueness.ts`
- `packages/core/src/application/identity/updateProfile.ts`
- `packages/core/src/application/identity/view.ts`
- `packages/core/src/application/ports/accountDeletionManifestStore.ts`
- `packages/core/src/application/ports/appliedOperationStore.ts`
- `packages/core/src/application/ports/distributedOperationStore.ts`
- `packages/core/src/application/ports/identityRemovalReceiptStore.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/ports/outboxRepository.ts`
- `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`
- `packages/core/src/application/ports/scopeTaskQueue.ts`
- `packages/core/src/application/ports/scopeTaskScheduler.ts`
- `packages/core/src/application/ports/scopeTaskTrigger.ts`
- `packages/core/src/application/storage/deleteFiles.ts`
- `packages/core/src/application/storage/deleteFilesByOwner.ts`
- `packages/core/src/application/storage/deleteStoredObjects.ts`
- `packages/core/src/application/storage/eventDecoders.ts`
- `packages/core/src/application/storage/storeAvatar.ts`
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/usage/deleteQuota.ts`
- `packages/core/src/application/usage/getUsageSnapshot.ts`
- `packages/core/src/application/usage/recalculateStorageUsage.ts`
- `packages/core/src/application/usage/view.ts`
- `packages/core/src/application/workers/eventRelayWorker.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/domain/common/event.ts`
- `packages/core/src/domain/identity/__tests__/policies.test.ts`
- `packages/core/src/domain/identity/errorCode.ts`
- `packages/core/src/domain/identity/ports/authTokenRepository.ts`
- `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`
- `packages/core/src/domain/identity/ports/signInOAuthClient.ts`
- `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`
- `packages/core/src/domain/identity/services/identityPolicy.ts`
- `packages/core/src/domain/identity/services/sameOriginPolicy.ts`
- `packages/core/src/domain/identity/user.ts`
- `packages/core/src/domain/identity/valueObject.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`
- `packages/core/src/domain/note/ports/localNoteQueryService.ts`
- `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`
- `packages/core/src/domain/note/valueObject.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/domain/storage/errorCode.ts`
- `packages/core/src/domain/storage/events.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/storedFile.ts`
- `packages/core/src/domain/storage/valueObject.ts`
- `packages/core/src/domain/usage/__tests__/quota.test.ts`
- `packages/core/src/domain/usage/__tests__/valueObject.test.ts`
- `packages/core/src/domain/usage/errorCode.ts`
- `packages/core/src/domain/usage/events.ts`
- `packages/core/src/domain/usage/llmUsage.ts`
- `packages/core/src/domain/usage/ports/llmUsageRepository.ts`
- `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`
- `packages/core/src/domain/usage/services/quotaEnforcement.ts`
- `packages/core/src/domain/usage/storageQuota.ts`
- `packages/core/src/domain/usage/valueObject.ts`

##### スキップ（184 件）

- `.thread/2/adr.md` — 計画外の進行記録（plan.md のみ契約として確認）
- `.thread/2/progress.md` — 計画外の進行記録（plan.md のみ契約として確認）
- `.thread/2/review/review-001-adapter.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-001-domain-usecase.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-001-frontend.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-001-security.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-001-test.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-001.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-002-adapter.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-002-domain-usecase.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-002-frontend.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-002-security.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-002-test.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-003-adapter.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-003-domain-usecase.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-003-frontend.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-003-security.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-003-test.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-004-adapter.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-004-domain-usecase.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-004-frontend.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-004-security.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-004-test.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-005-adapter.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-005-domain-usecase.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-005-frontend.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-005-security.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/review-005-test.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/review/triage.md` — 過去ラウンドのレビュー記録（指示によりゼロベース、参照しない）
- `.thread/2/steps.md` — 計画外の進行記録（plan.md のみ契約として確認）
- `.thread/2/testing.md` — 計画外の進行記録（plan.md のみ契約として確認）
- `apps/web/.env.example` — ランタイム設定 / 生成物の担当
- `apps/web/app/components/auth/OAuthButton/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/PasswordStrengthMeter/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/ResendVerificationForm/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/auth/ResendVerificationForm/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/ResetPasswordPanel/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/auth/ResetPasswordPanel/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/SignInForm/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/auth/SignInForm/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/SignUpForm/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/auth/SignUpForm/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/VerifyEmailPanel/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/auth/VerifyEmailPanel/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/auth/__tests__/passwordStrength.test.ts` — フロントエンド観点の担当
- `apps/web/app/components/auth/passwordStrength.ts` — フロントエンド観点の担当
- `apps/web/app/components/auth/schema.ts` — フロントエンド観点の担当
- `apps/web/app/components/dev/DevConsentForm/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/layout/AccountMenu/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/layout/AccountMenu/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/layout/AppShell/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/layout/SettingsTabs/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/note/NoteBody/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/AddPasswordForm/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/ChangePasswordForm/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/DeleteAccountPanel/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/IdentityList/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/settings/IdentityList/board.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/IdentityList/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/IdentityListSkeleton/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/ProfileForm/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/settings/ProfileForm/editor.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/ProfileForm/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/UsagePanel/action.ts` — フロントエンド観点の担当
- `apps/web/app/components/settings/UsagePanel/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx` — フロントエンド観点の担当
- `apps/web/app/components/settings/panelStyles.ts` — フロントエンド観点の担当
- `apps/web/app/presentation/__tests__/deletionTicket.test.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/__tests__/devOAuth.test.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/deletionTicket.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/devOAuth.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/errorDisplay.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/oauthStateBinding.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/oauthStateCookie.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/session.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/presentation/verificationSession.ts` — presentation 観点の担当（ticket / state 束縛はセキュリティ観点）
- `apps/web/app/routeTree.gen.ts` — ランタイム設定 / 生成物の担当
- `apps/web/app/routes/__root.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/auth/-action.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/auth/callback.$provider.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/dev/-action.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/dev/oauth/authorize.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/notes/index.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/reset-password.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/settings/auth.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/settings/danger.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/settings/index.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/settings/profile.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/settings/route.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/settings/usage.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/storage.$.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/routes/verify-email.tsx` — フロントエンド / セキュリティ観点の担当
- `apps/web/app/server.node.ts` — ランタイム配線の担当（継続の駆動有無だけ grep で確認）
- `apps/web/app/worker/node/__tests__/runner.test.ts` — ランタイム配線の担当（継続の駆動有無だけ grep で確認）
- `apps/web/app/worker/node/runner.ts` — ランタイム配線の担当（継続の駆動有無だけ grep で確認）
- `apps/web/scripts/listen.node.ts` — ランタイム設定 / 生成物の担当
- `docs/runtime_node.md` — ドキュメント観点の担当
- `docs/test.md` — ドキュメント観点の担当
- `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/appliedOperationStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/authTokenRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/backend.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/distributedOperationStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/identityRemovalReceiptStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/identityUniqueDirectory.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/llmUsageRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/noteProjection.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/objectStorage.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/outboxRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/scopeTaskScheduler.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/signInOAuthClient.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/storageQuotaRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/conformance/storedFileRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/globalUnitOfWork.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/objectStorage.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/appliedOperationStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/authTokenRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/distributedOperationStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/identityRemovalReceiptStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/llmUsageRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/noteProjection.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/outboxRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/scopeCleanupAdmissionStore.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/storageQuotaRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/scopeTaskQueue.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/memory/store.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/oauth/__tests__/conformance.test.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/oauth/devSignInOAuthClient.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/oauth/pkce.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/adapters/oauth/signInOAuthClient.ts` — アダプター観点の担当（B-001 に関係する `accountDeletionManifestStore` の必須集合ロジックのみ例外的に確認）
- `packages/core/src/application/di/__tests__/serverNode.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/execution/__tests__/eventId.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/authFlowHelpers.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/changePassword.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/deleteAccount.admission.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/deleteAccount.globalCleanup.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/deleteAccount.manifestBuild.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/deleteAccount.redaction.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/deletionHarness.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/getAccountDeletionStatus.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/getProfile.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/listIdentities.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/resendVerificationEmail.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/resetPassword.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/signOut.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/signOutOtherSessions.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/updateProfile.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/identity/__tests__/verifyEmail.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/storage/__tests__/storeAvatar.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/usage/__tests__/deleteQuota.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/workers/__tests__/outboxPrune.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `packages/core/src/application/workers/__tests__/subscribers.test.ts` — ユースケーステスト（`it()` 名の全量走査と `pnpm test:unit` 全緑で担保を確認したが、本文は未読）
- `vitest.config.ts` — ビルド / テスト設定の担当
