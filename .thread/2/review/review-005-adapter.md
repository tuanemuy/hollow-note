### Adapter / Infrastructure

#### Blockers

なし

#### Warnings

なし

#### 検証した論点（いずれも問題を検出せず）

- **ポート契約 ↔ アダプター実装**: 新設 10 ポート（`ScopeTaskScheduler` / `ScopeTaskQueue` / `ScopeTaskTrigger` / `AppliedOperationStore` / `DistributedOperationStore` / `IdentityRemovalReceiptStore` / `ObjectStorage` / `StoredFileRepository` / `StorageQuotaRepository` / `LlmUsageRepository`）と改訂 3 ポート（`IdentityUniqueDirectory` の `beginRelease`、`ScopeCleanupAdmissionStore` の宣言集合 + `describePersonalCleanup`、`AccountDeletionManifestStore` の `describe` / `pruneTerminal` の戻り値）を JSDoc と memory 実装の両方で突き合わせた。JSDoc が実装より強い／弱い箇所は見つからなかった。`removeIdentity` の `operationId` が `identityId` から決定的に導かれるため、`IdentityRemovalReceiptStore.record` の「operationId ごとに冪等」と memory の identityId キーは一致する。
- **適合テストの実効性**: 9 スイート新設 + 3 スイート改訂が `memory/__tests__/conformance.test.ts` に 1 行ずつ登録済み。`scopeCleanupAdmissionStore` は enum の真部分集合を宣言として渡し「宣言外の component が代役にならない」を実際に落とす形になっている。`ObjectStorage` は宣言 meta を誤らせて「測定値が勝つ」ことを検証。skip は Google OAuth の交換ケース 3 件のみで、`describe.skip` 側の minter が throw するため誤って有効化されても静かに緑にならない。`pnpm test:unit` は 901 passed / 3 skipped。
- **OAuth**: dev IdP は composition root（`OAuthRuntimeConfig` の判別共用体）でのみ選ばれ、`MemoryRuntimeOptions.oauth` に既定値が無い。`OAUTH_DEV_MODE=true` × `NODE_ENV=production` は env スキーマで起動失敗、`scripts/listen.node.ts` が dotenv より前に `NODE_ENV ??= "production"` を宣言。`/dev/oauth/authorize` は loader と mutation の両方で `container.oauthDevMode` を見て 404 / `NotFoundError`（env 直読み無し）。PKCE は共有 `deriveCodeChallengeS256` の 1 実装で、認可 URL に `code_challenge_method=S256`。Google は `id_token` の `iss` / `aud`（配列含む）/ `exp` / `sub` / `email` を検証し、署名検証省略の根拠も JSDoc に明記。4xx→`OAUTH_CODE_INVALID`、transport/5xx/不正形/タイムアウト→`EXTERNAL_API_ERROR` を単体テストで固定。
- **DI / composition root**: `initNodeRuntime` が env ダイジェスト付きの singleton を張り、未初期化のコンテナ生成と別 env での再初期化を両方 throw（テスト有り）。`RequestContainer` / `WorkerContainer` に AC-31 のポートが載り、適合テストからしか触れないポートは残っていない（`NoteRouteFanOutReader` だけは計画の `RequestContainer` ではなく `WorkerContainer` に載るが、唯一の呼び出し元が worker 平面の継続なので配置として正しく、types.ts に理由が明記されている）。
- **ワーカーランタイム**: scope task は interval も commit kick も `InProcessRelayTrigger` 経由なので重ならない（`claimDue` がリースを取らない以上これが必須）。relay は claim + リースで保護されるため直呼びで重なっても安全。`unref()`、SIGTERM/SIGINT の登録解除、`stop()` のドレインと冪等性、二重 `start()` の無視をテストで固定。dev 再ロードは `server.node.ts` の `globalThis` / `import.meta.hot.data` ピン留めで前の boot を retire してから起動。throw したタスクは runner が `backoff` し 8 回で `failed` に落ちる（テスト有り）。prune tick は起動時 1 回 + 24h で 3 掃引を相互隔離。`identity.personalCleanupHandoverContinued` は barrier を閉じたターンの前に行を積み receipt 後に消す形で駆動され、「引き渡しが落ちた」ケースの再駆動までテストされている。
- **転送境界 12MB**: `Content-Length` があれば本文を読まずに 413、chunked は `TransformStream` で打ち切り、打ち切りを検知して応答を 413 に差し替え。業務上限（アバター 8MB の転送境界 / 5MB のドメイン上限）より広い理由もコメント・docs に一致。
- **決定的 EventId / outbox 衝突契約**: `mintEventIdFor` は `payload.continuationKey` があるときのみ id を導出し、`OutboxRepository.save` は既存 id をスキップして行を一切変えない契約を JSDoc + 適合テスト（attempts / retry schedule / processed の各ケース）で固定。継続チェーンは全て turn ごとに key が変わる（`nextTurn` / phase / attempt 名）か、変えられない `userAuthResidueCleanupContinued` は意図的に `continuationKey` を持たず採番に倒す形になっている。
- **memory 依存の移植性**: 適合スイートは backend factory 越しにしか触らず、memory 固有の内部を読む assert は使っていない（`h.backend.*` を直接読むのはユースケーステスト側で、`docs/test.md` が認めている形）。
- **経緯コメント**: レビュー由来の弁明・修正履歴コメントは検出されなかった。

#### カバレッジ

確認 117 件 + スキップ 167 件 = 284 件（変更ファイル一覧の全量）。

- 確認（117）:
  - `apps/web/.env.example`
  - `apps/web/app/presentation/__tests__/deletionTicket.test.ts`
  - `apps/web/app/presentation/__tests__/devOAuth.test.ts`
  - `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`
  - `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`
  - `apps/web/app/presentation/deletionTicket.ts`
  - `apps/web/app/presentation/devOAuth.ts`
  - `apps/web/app/presentation/oauthStateBinding.ts`
  - `apps/web/app/presentation/oauthStateCookie.ts`
  - `apps/web/app/routes/dev/-action.tsx`
  - `apps/web/app/routes/dev/oauth/authorize.tsx`
  - `apps/web/app/routes/settings/-action.tsx`
  - `apps/web/app/routes/storage.$.tsx`
  - `apps/web/app/server.node.ts`
  - `apps/web/app/worker/node/__tests__/runner.test.ts`
  - `apps/web/app/worker/node/runner.ts`
  - `apps/web/scripts/listen.node.ts`
  - `docs/runtime_node.md`
  - `docs/test.md`
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
  - `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`
  - `packages/core/src/adapters/memory/repositories/appliedOperationStore.ts`
  - `packages/core/src/adapters/memory/repositories/authTokenRepository.ts`
  - `packages/core/src/adapters/memory/repositories/distributedOperationStore.ts`
  - `packages/core/src/adapters/memory/repositories/identityRemovalReceiptStore.ts`
  - `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`
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
  - `packages/core/src/application/identity/authResidueCleanup.ts`
  - `packages/core/src/application/identity/continuations.ts`
  - `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
  - `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
  - `packages/core/src/application/identity/deleteAccount/compaction.ts`
  - `packages/core/src/application/identity/deleteAccount/finalize.ts`
  - `packages/core/src/application/identity/deleteAccount/manifestBuild.ts`
  - `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`
  - `packages/core/src/application/identity/identityRemovalRelease.ts`
  - `packages/core/src/application/identity/pruneExpiredAuthState.ts`
  - `packages/core/src/application/identity/removeIdentity.ts`
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
  - `packages/core/src/application/usage/deleteQuota.ts`
  - `packages/core/src/application/workers/__tests__/outboxPrune.test.ts`
  - `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
  - `packages/core/src/application/workers/__tests__/subscribers.test.ts`
  - `packages/core/src/application/workers/eventRelayWorker.ts`
  - `packages/core/src/application/workers/scopeTaskRunner.ts`
  - `packages/core/src/application/workers/subscribers.ts`
  - `packages/core/src/domain/common/event.ts`
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`
  - `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`
  - `packages/core/src/domain/identity/ports/signInOAuthClient.ts`
  - `packages/core/src/domain/identity/services/sameOriginPolicy.ts`
  - `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`
  - `packages/core/src/domain/storage/ports/storedFileRepository.ts`
  - `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
  - `packages/core/src/domain/storage/valueObject.ts`
  - `packages/core/src/domain/usage/ports/llmUsageRepository.ts`
  - `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`
  - `vitest.config.ts`

- スキップ（167）:

  **計画・進捗・過去ラウンドのレビュー記録。ゼロベース方針によりレビュー対象外（27 件）**

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
  - `.thread/2/review/triage.md`
  - `.thread/2/steps.md`
  - `.thread/2/testing.md`

  **React コンポーネント。Frontend 観点の担当（37 件）**

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
  - `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`
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

  **ルート定義・server function。Adapter 観点で見たのは `dev/`・`storage.$`・`settings/-action`（アバター転送境界）のみ。残りは Frontend / Security 観点の担当（12 件）**

  - `apps/web/app/routes/__root.tsx`
  - `apps/web/app/routes/auth/-action.tsx`
  - `apps/web/app/routes/auth/callback.$provider.tsx`
  - `apps/web/app/routes/notes/index.tsx`
  - `apps/web/app/routes/reset-password.tsx`
  - `apps/web/app/routes/settings/auth.tsx`
  - `apps/web/app/routes/settings/danger.tsx`
  - `apps/web/app/routes/settings/index.tsx`
  - `apps/web/app/routes/settings/profile.tsx`
  - `apps/web/app/routes/settings/route.tsx`
  - `apps/web/app/routes/settings/usage.tsx`
  - `apps/web/app/routes/verify-email.tsx`

  **エラー表示辞書・セッション Cookie glue。Frontend / Security 観点の担当（3 件）**

  - `apps/web/app/presentation/errorDisplay.ts`
  - `apps/web/app/presentation/session.ts`
  - `apps/web/app/presentation/verificationSession.ts`

  **ルーター生成物（自動生成、レビュー対象外）（1 件）**

  - `apps/web/app/routeTree.gen.ts`

  **Identity ユースケースのテスト。Domain-Usecase / Test 観点の担当（31 件）**

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

  **Identity ユースケース本体。Adapter 観点では継続駆動・ポート搭載に関わる `deleteAccount/{cleanupDispatch,compaction,finalize,manifestBuild,terminalPrune,authorRedaction}`・`authResidueCleanup`・`identityRemovalRelease`・`continuations`・`pruneExpiredAuthState` のみ確認。残りは Domain-Usecase 観点の担当（23 件）**

  - `packages/core/src/application/identity/addPasswordIdentity.ts`
  - `packages/core/src/application/identity/changePassword.ts`
  - `packages/core/src/application/identity/checkHandleAvailability.ts`
  - `packages/core/src/application/identity/completeOAuthCallback.ts`
  - `packages/core/src/application/identity/completeOAuthSignIn.ts`
  - `packages/core/src/application/identity/deleteAccount/admission.ts`
  - `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`
  - `packages/core/src/application/identity/deleteAccount/index.ts`
  - `packages/core/src/application/identity/deleteAccount/input.ts`
  - `packages/core/src/application/identity/eventDecoders.ts`
  - `packages/core/src/application/identity/getAccountDeletionStatus.ts`
  - `packages/core/src/application/identity/getProfile.ts`
  - `packages/core/src/application/identity/linkOAuthIdentity.ts`
  - `packages/core/src/application/identity/listIdentities.ts`
  - `packages/core/src/application/identity/requestPasswordReset.ts`
  - `packages/core/src/application/identity/resendVerificationEmail.ts`
  - `packages/core/src/application/identity/resetPassword.ts`
  - `packages/core/src/application/identity/signOut.ts`
  - `packages/core/src/application/identity/signOutOtherSessions.ts`
  - `packages/core/src/application/identity/startOAuthFlow.ts`
  - `packages/core/src/application/identity/uniqueness.ts`
  - `packages/core/src/application/identity/updateProfile.ts`
  - `packages/core/src/application/identity/view.ts`

  **Usage / Storage ユースケース本体・ビュー・そのテスト。Adapter 観点では `deleteQuota` / `deleteFiles*` / `storeAvatar` / `deleteStoredObjects` のみ確認。残りは Domain-Usecase / Test 観点の担当（11 件）**

  - `packages/core/src/application/note/__tests__/createBlankNote.test.ts`
  - `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
  - `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`
  - `packages/core/src/application/storage/__tests__/storeAvatar.test.ts`
  - `packages/core/src/application/storage/view.ts`
  - `packages/core/src/application/usage/__tests__/deleteQuota.test.ts`
  - `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts`
  - `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts`
  - `packages/core/src/application/usage/getUsageSnapshot.ts`
  - `packages/core/src/application/usage/recalculateStorageUsage.ts`
  - `packages/core/src/application/usage/view.ts`

  **ドメインモデル（VO・エンティティ・イベント・ポリシー）とその単体テスト。Adapter 観点で見たのはポート定義と `storage/valueObject`・`uploadValidationPolicy`・`sameOriginPolicy` のみ。残りは Domain-Usecase 観点の担当（22 件）**

  - `packages/core/src/domain/identity/__tests__/policies.test.ts`
  - `packages/core/src/domain/identity/errorCode.ts`
  - `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`
  - `packages/core/src/domain/identity/services/identityPolicy.ts`
  - `packages/core/src/domain/identity/user.ts`
  - `packages/core/src/domain/identity/valueObject.ts`
  - `packages/core/src/domain/note/ports/htmlProcessor.ts`
  - `packages/core/src/domain/note/ports/localNoteQueryService.ts`
  - `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`
  - `packages/core/src/domain/note/valueObject.ts`
  - `packages/core/src/domain/storage/__tests__/storage.test.ts`
  - `packages/core/src/domain/storage/errorCode.ts`
  - `packages/core/src/domain/storage/events.ts`
  - `packages/core/src/domain/storage/storedFile.ts`
  - `packages/core/src/domain/usage/__tests__/quota.test.ts`
  - `packages/core/src/domain/usage/__tests__/valueObject.test.ts`
  - `packages/core/src/domain/usage/errorCode.ts`
  - `packages/core/src/domain/usage/events.ts`
  - `packages/core/src/domain/usage/llmUsage.ts`
  - `packages/core/src/domain/usage/services/quotaEnforcement.ts`
  - `packages/core/src/domain/usage/storageQuota.ts`
  - `packages/core/src/domain/usage/valueObject.ts`
