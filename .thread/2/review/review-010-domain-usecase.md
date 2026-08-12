### Domain / Use Case

**ラウンド 10（最終）/ ゼロベース**。`CLAUDE.md`・`spec/adr/`・`spec/domains/`・`spec/usecases/`・`.thread/2/plan.md` を読んだうえで、変更ファイル一覧 311 件のうち Domain / Use Case 観点に関わる `packages/core/src/domain/` 全 33 件と `packages/core/src/application/` 全 108 件を差分ではなく実ファイルで通読し、判定に必要な範囲で memory アダプター 3 件を裏取りした。`git status` はクリーン（実装の書き換えは一切していない）。

決着済みの Key 4 件（`recalculateStorageUsage` の駆動主体不在 / `requestPasswordReset` の送信間隔 / #21・#19・#20 / `authResidueCleanup` の UoW 外 receipt・`updateProfile` の OCC 抑止条件）は再指摘していない。

#### Blockers

なし。

以下は今回あらためて追跡し、問題が無いことを確認した主要な不変条件（記録として残す）。

- **UoW のネスト無し**: `run(...)` を呼ぶ全経路（`admitAccountDeletion` → barrier、`dispatchAccountDeletionCleanup` → `readProgress` → 各 command、`settleCleanupTurn` → handover、`storeAvatar`、`terminalPrune`）はすべて逐次であり、コールバック内から他プレーンの `run` を開くものは無い。共有手続き（`deleteStoredFiles` / `completePersonalCleanupIfDone`）は `ScopeUnitOfWorkContext` を受け取る形で、自前で `run` を開いていない。
- **同一 UoW 要件**: `removeIdentity`（row 削除 + receipt + `identity.identity.removed`）、`admitAccountDeletion`（`beginOrResume` + `beginDeletion`）、`resetPassword` / `changePassword`（identity + epoch bump + `refreshAuthEpoch` + 継続イベント）、`deleteQuota` / `deleteFilesByOwner`（`markApplied` + 削除 + 継続 task）はいずれも 1 トランザクションに収まっている。
- **`authEpoch` バンプ 4 経路**: `resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount`(`beginDeletion`) がすべて `User.advanceAuthEpoch`（または `beginDeletion`）＋ `IdentityContinuations.userAuthResidueCleanup` を同一 UoW で積む。共有コンシューマー `authResidueCleanup` は先頭で `versioned.entity.authEpoch !== authEpoch` を stale として弾き、削除は `deleteOlderEpochByUser(userId, authEpoch, …)` の厳密不等号のみ。「現世代を消さない」は型ではなくこの 2 点で担保されており、両方にテストがある。
- **一意性予約サガ 3 kind**: `email` / `handle` / `providerAccount` すべてが `reserveUniqueKeys` → 権威 UoW → `activateUniqueKeys` の 1 実装を通る。失敗時の解放順序は `updateProfile`（OCC 敗北時だけ解放しない）・`linkOAuthIdentity` / `completeOAuthSignIn`（全失敗経路で解放）とも spec の意図どおりで、`activateUniqueKeys` の `confirmOnce` により多鍵オペレーションが「半分 activate・半分 release」になり得ない。
- **削除オーケストレーション**: 継続入力は `(phase, cursor)` で 1 ターンを完全記述し、`mintEventIdFor` の `continuationKey` で決定的 EventId になるため再投入がチェーンを分岐させない。barrier は global commit 後に scope 側トランザクションで取り、uniqueness 解放は finalize より前（receipt が自分を待つ循環を避けるため）。compaction が `markCompleted` を最後に打つので `completed` ヘッダーは常に「回収済み」を意味する。`deletionDriver.ts` が実 relay + 実 subscriber レジストリで駆動しているため、この連鎖はテストで実際に通っている。
- **`DeletingUser` / `DeletedUser` の倒れ方**: `signInLinkedUser` / `completeOAuthSignInForFlow` / `linkOAuthIdentity` / `startOAuthFlow` / `requestPasswordReset` / `resetPassword` / `updateProfile` / `getProfile` / `addPasswordIdentity` のいずれも、最終 UoW の中で `status` を読み直してから書いている（`ACCOUNT_UNAVAILABLE` / `USER_NOT_FOUND` / `AUTH_TOKEN_NOT_FOUND` / `UNAUTHENTICATED` の使い分けも spec どおり）。
- **Cross-layer catch policy**: `domain` / `application` の `try` は 47 箇所すべてがサガ補償・メール送信の許容・ワーカーの行単位隔離・オブジェクトストア巻き戻しという明示的境界に限られ、ユースケース本体を包む広い `catch` は無い。ドメインエラーを usecase 境界で再翻訳している箇所も見つからなかった。
- **入力バリデーション 2 点**: usecase 内の検証はすべて VO 構築（`Email` / `Handle` / `PlainPassword` / `AvatarUrl` / `UserId` / `ObjectKey` …）か明示的な業務判定であり、形状 / DoS 検証を application に持ち込んでいる箇所は無い（`requireRequestId` の UUID 検査だけは制御プレーンの request key という内部不変条件なので application 側で妥当）。
- **ドメインに置くべきロジックの漏れ / 逆方向**: `IdentityPolicy.isRemovable`（画面と `ensureRemovable` の乖離防止）、`SameOriginPolicy`（avatar URL と redirectTo の同一述語化）、`AccountDeletionRetryPolicy`（しきい値と窓をストアから引き剥がし）、`UploadValidationPolicy`（申告ではなくバイト列から MIME とサイズを決める）はいずれもドメイン側が正しい置き場所。逆に `uniqueness.ts` / `participants.ts` / `personalCleanup.ts` は「2 つのストアを順序づける手続き」であって業務判断を持たないので application に置くのが正しい。
- **コード / コメントの残渣**: レビュー弁明・修正経緯・過去の指摘番号といった残す必要のない記述は、`domain` / `application` の実装コードには 1 件も見つからなかった（`#3` / `#9` / `#21` 等の引き継ぎ先注記は plan.md が明示的に要求しているものなので対象外）。

#### Warnings

- **[W-001]** OAuth 連携で「identity 行は入ったが `activate` が最後まで通らなかった」状態から再連携すると、同一 provider account の identity 行が二重に生える / 場所: `packages/core/src/application/identity/linkOAuthIdentity.ts:143`（同型の欠落が `packages/core/src/application/identity/completeOAuthSignIn.ts:350`）/ 理由: `linkOAuthIdentityForFlow` は入口で `identityUniqueDirectory.resolve` が `null` を返した場合に「まだ誰も claim していない」と判断して `reserve` → UoW → `Identity.createOAuth` + `insert` へ進むが、最終 UoW の中で `listByUserId` を読んでいるにもかかわらず「その利用者が既に同じ `providerAccountId` の identity を持っていないか」を見ていない。`IdentityRepository` は `(provider, providerAccountId)` の一意性を担保しない（spec-sync で「一意性は directory、応答は usecase」と確定済み・memory 実装も投げない）ので、directory 側の claim が `active` になっていない窓では二重挿入を止めるものが無い。到達経路は「UoW は commit したが `activateUniqueKeys` が `confirm()` 込みで 2 度失敗した / その直後にプロセスが落ちた」→ `reserved` 行が `UNIQUE_RESERVATION_TTL_MS`（10 分）で lapse →利用者が同じ Google アカウントで再連携、という順序。結果は identity 一覧に同じ Google が 2 行出て、8 件上限の枠を 1 つ余分に食う（`identityRemovalRelease` の `stillClaimed` ガードがあるため予約の取り違えや権限昇格には至らない）。`updateProfile` が同型の「commit 済みだが claim が無い」状態に `reclaim` という回復経路を用意しているのに対し、こちらは再実行が回復ではなく重複生成になる点が非対称。/ 提案: 最終 UoW で既に読んでいる `identities` を使い、`IdentityPolicy.ensureAddable(identities)` の直後に「同じ `provider` + `providerAccountId` の行が既にあればそれを返して挿入しない」1 分岐を足す（`existingLinkId` と同じ判定をトランザクション内で行う形）。`completeOAuthSignIn` の `attachToExistingUser` も同じ 1 行で閉じる。確率は低いので本 Issue で閉じずに `#21`（directory の compare-and-set を扱う引き継ぎ先）へ寄せる判断でも妥当だが、その場合は縮退として記録されたい。

#### カバレッジ

**確認（144 件）**

*ドメイン層（33 件・全ファイル通読）*

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

*アプリケーション層（108 件。実装ファイルは全件通読。テストは `__tests__/deletionDriver.ts` / `__tests__/deletionHarness.ts` / `deleteAccount.recovery.test.ts` を通読し、残りはテスト名と対象 TC ID の突合レベルで確認）*

- `packages/core/src/application/__tests__/helpers.ts`
- `packages/core/src/application/cleanup/participants.ts`
- `packages/core/src/application/cleanup/personalCleanup.ts`
- `packages/core/src/application/di/__tests__/serverNode.test.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/di/serverNode.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/execution/__tests__/eventId.test.ts`
- `packages/core/src/application/execution/eventId.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
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
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts`
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
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/application/storage/__tests__/storeAvatar.test.ts`
- `packages/core/src/application/storage/deleteFiles.ts`
- `packages/core/src/application/storage/deleteFilesByOwner.ts`
- `packages/core/src/application/storage/deleteStoredObjects.ts`
- `packages/core/src/application/storage/eventDecoders.ts`
- `packages/core/src/application/storage/storeAvatar.ts`
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/usage/__tests__/deleteQuota.test.ts`
- `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts`
- `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts`
- `packages/core/src/application/usage/deleteQuota.ts`
- `packages/core/src/application/usage/getUsageSnapshot.ts`
- `packages/core/src/application/usage/recalculateStorageUsage.ts`
- `packages/core/src/application/usage/view.ts`
- `packages/core/src/application/workers/__tests__/outboxPrune.test.ts`
- `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/application/workers/eventRelayWorker.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`

*判定の裏取りに読んだ memory アダプター（3 件）*

- `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`
- `packages/core/src/adapters/memory/repositories/authTokenRepository.ts`
- `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`

**スキップ（167 件）**

*`.thread/2/` のレビュー記録・計画ドキュメント（52 件）— ラウンド 10 はゼロベース指示のため過去レビューは読まない。`plan.md` / `progress.md` / `adr.md` は契約・決着済み事実として参照済み（レビュー対象としての指摘はしない）*

- `.thread/2/adr.md`
- `.thread/2/plan.md`
- `.thread/2/progress.md`
- `.thread/2/review/review-001-adapter.md`
- `.thread/2/review/review-001-domain-usecase.md`
- `.thread/2/review/review-001-frontend.md`
- `.thread/2/review/review-001-security.md`
- `.thread/2/review/review-001-test.md`
- `.thread/2/review/review-001.md`
- `.thread/2/review/review-002-adapter.md`
- `.thread/2/review/review-002-domain-usecase.md`
- `.thread/2/review/review-002-frontend.md`
- `.thread/2/review/review-002-security.md`
- `.thread/2/review/review-002-test.md`
- `.thread/2/review/review-003-adapter.md`
- `.thread/2/review/review-003-domain-usecase.md`
- `.thread/2/review/review-003-frontend.md`
- `.thread/2/review/review-003-security.md`
- `.thread/2/review/review-003-test.md`
- `.thread/2/review/review-004-adapter.md`
- `.thread/2/review/review-004-domain-usecase.md`
- `.thread/2/review/review-004-frontend.md`
- `.thread/2/review/review-004-security.md`
- `.thread/2/review/review-004-test.md`
- `.thread/2/review/review-005-adapter.md`
- `.thread/2/review/review-005-domain-usecase.md`
- `.thread/2/review/review-005-frontend.md`
- `.thread/2/review/review-005-security.md`
- `.thread/2/review/review-005-test.md`
- `.thread/2/review/review-006-adapter.md`
- `.thread/2/review/review-006-domain-usecase.md`
- `.thread/2/review/review-006-frontend.md`
- `.thread/2/review/review-006-security.md`
- `.thread/2/review/review-006-test.md`
- `.thread/2/review/review-007-adapter.md`
- `.thread/2/review/review-007-domain-usecase.md`
- `.thread/2/review/review-007-frontend.md`
- `.thread/2/review/review-007-security.md`
- `.thread/2/review/review-007-test.md`
- `.thread/2/review/review-008-adapter.md`
- `.thread/2/review/review-008-domain-usecase.md`
- `.thread/2/review/review-008-frontend.md`
- `.thread/2/review/review-008-security.md`
- `.thread/2/review/review-008-test.md`
- `.thread/2/review/review-009-adapter.md`
- `.thread/2/review/review-009-domain-usecase.md`
- `.thread/2/review/review-009-frontend.md`
- `.thread/2/review/review-009-security.md`
- `.thread/2/review/review-009-test.md`
- `.thread/2/review/triage.md`
- `.thread/2/steps.md`
- `.thread/2/testing.md`

*`apps/web/`（72 件）— プレゼンテーション / フロントエンド観点の担当。本観点からは `presentation/` 経由の usecase 呼び出し境界のみ間接確認*

- `apps/web/.env.example`
- `apps/web/app/components/auth/OAuthButton/index.tsx`
- `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`
- `apps/web/app/components/auth/PasswordStrengthMeter/index.tsx`
- `apps/web/app/components/auth/ResendVerificationForm/action.ts`
- `apps/web/app/components/auth/ResendVerificationForm/index.tsx`
- `apps/web/app/components/auth/ResetPasswordPanel/action.ts`
- `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`
- `apps/web/app/components/auth/SignInForm/action.ts`
- `apps/web/app/components/auth/SignInForm/index.tsx`
- `apps/web/app/components/auth/SignUpForm/action.ts`
- `apps/web/app/components/auth/SignUpForm/index.tsx`
- `apps/web/app/components/auth/VerifyEmailPanel/action.ts`
- `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`
- `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`
- `apps/web/app/components/auth/passwordStrength.ts`
- `apps/web/app/components/auth/schema.ts`
- `apps/web/app/components/dev/DevConsentForm/index.tsx`
- `apps/web/app/components/layout/AccountMenu/action.ts`
- `apps/web/app/components/layout/AccountMenu/index.tsx`
- `apps/web/app/components/layout/AppShell/index.tsx`
- `apps/web/app/components/layout/SettingsTabs/index.tsx`
- `apps/web/app/components/note/NoteBody/index.tsx`
- `apps/web/app/components/settings/AddPasswordForm/index.tsx`
- `apps/web/app/components/settings/ChangePasswordForm/index.tsx`
- `apps/web/app/components/settings/DeleteAccountPanel/__tests__/ticketStorage.test.ts`
- `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`
- `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`
- `apps/web/app/components/settings/IdentityList/action.ts`
- `apps/web/app/components/settings/IdentityList/board.tsx`
- `apps/web/app/components/settings/IdentityList/index.tsx`
- `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`
- `apps/web/app/components/settings/ProfileForm/action.ts`
- `apps/web/app/components/settings/ProfileForm/editor.tsx`
- `apps/web/app/components/settings/ProfileForm/index.tsx`
- `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`
- `apps/web/app/components/settings/UsagePanel/action.ts`
- `apps/web/app/components/settings/UsagePanel/index.tsx`
- `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`
- `apps/web/app/components/settings/panelStyles.ts`
- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`
- `apps/web/app/presentation/__tests__/devOAuth.test.ts`
- `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`
- `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`
- `apps/web/app/presentation/deletionTicket.ts`
- `apps/web/app/presentation/devOAuth.ts`
- `apps/web/app/presentation/errorDisplay.ts`
- `apps/web/app/presentation/oauthStateBinding.ts`
- `apps/web/app/presentation/oauthStateCookie.ts`
- `apps/web/app/presentation/session.ts`
- `apps/web/app/presentation/verificationSession.ts`
- `apps/web/app/routeTree.gen.ts`
- `apps/web/app/routes/__root.tsx`
- `apps/web/app/routes/auth/-action.tsx`
- `apps/web/app/routes/auth/callback.$provider.tsx`
- `apps/web/app/routes/dev/-action.tsx`
- `apps/web/app/routes/dev/oauth/authorize.tsx`
- `apps/web/app/routes/notes/index.tsx`
- `apps/web/app/routes/reset-password.tsx`
- `apps/web/app/routes/settings/-action.tsx`
- `apps/web/app/routes/settings/auth.tsx`
- `apps/web/app/routes/settings/danger.tsx`
- `apps/web/app/routes/settings/index.tsx`
- `apps/web/app/routes/settings/profile.tsx`
- `apps/web/app/routes/settings/route.tsx`
- `apps/web/app/routes/settings/usage.tsx`
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/verify-email.tsx`
- `apps/web/app/server.node.ts`
- `apps/web/app/worker/node/__tests__/runner.test.ts`
- `apps/web/app/worker/node/runner.ts`
- `apps/web/scripts/listen.node.ts`

*アダプター実装・適合スイート（40 件）— Adapter 観点の担当*

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
- `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`
- `packages/core/src/adapters/memory/globalUnitOfWork.ts`
- `packages/core/src/adapters/memory/objectStorage.ts`
- `packages/core/src/adapters/memory/repositories/appliedOperationStore.ts`
- `packages/core/src/adapters/memory/repositories/distributedOperationStore.ts`
- `packages/core/src/adapters/memory/repositories/identityRemovalReceiptStore.ts`
- `packages/core/src/adapters/memory/repositories/llmUsageRepository.ts`
- `packages/core/src/adapters/memory/repositories/noteProjection.ts`
- `packages/core/src/adapters/memory/repositories/outboxRepository.ts`
- `packages/core/src/adapters/memory/repositories/scopeCleanupAdmissionStore.ts`
- `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`
- `packages/core/src/adapters/memory/repositories/storageQuotaRepository.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/memory/scopeTaskQueue.ts`
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts`
- `packages/core/src/adapters/memory/store.ts`
- `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`
- `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts`
- `packages/core/src/adapters/oauth/devSignInOAuthClient.ts`
- `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`
- `packages/core/src/adapters/oauth/pkce.ts`
- `packages/core/src/adapters/oauth/signInOAuthClient.ts`

*ドキュメント・ルート設定（3 件）*

- `docs/runtime_node.md`
- `docs/test.md`
- `vitest.config.ts`
