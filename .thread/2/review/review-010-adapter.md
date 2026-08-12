# レビュー R10 — Adapter / Infrastructure

対象: PR #17 (`issue/2/account-management-and-auth` ← `main`) / 変更 311 ファイル
前提: 作業ツリーは `git status` クリーンな状態で確認（実装の書き換えは一切行っていない）。

## Adapter / Infrastructure

### Blockers

なし

### Warnings

なし

### 所見（指摘ではない確認結果）

ゼロベースで観点の全域を追ったが、実害のある問題は見つからなかった。主な確認点:

- **ポート契約とアダプター実装の整合**: 新設 10 ポート（`ScopeTaskScheduler` / `ScopeTaskQueue` / `ScopeTaskTrigger` / `AppliedOperationStore` / `DistributedOperationStore` / `IdentityRemovalReceiptStore` / `ObjectStorage` / `StoredFileRepository` / `StorageQuotaRepository` / `LlmUsageRepository`）と改訂 3 ポート（`IdentityUniqueDirectory.beginRelease` / `ScopeCleanupAdmissionStore.describePersonalCleanup` + 宣言集合 / `AccountDeletionManifestStore.describe` + `pruneTerminal` の戻り値）について、JSDoc の宣言と memory 実装の振る舞いが一致していることを 1 メソッドずつ突き合わせた。食い違いは無い。`beginRelease` の「`reserved` 行は触らない」「所有者不一致は no-op」「`release` は `reserved`/`releasing` だけ落とす」は実装・スイート双方で一致。
- **適合テストの実効性**: `scopeCleanupAdmissionStore` / `accountDeletionManifestStore` の両スイートが、**列挙の真部分集合**を宣言としてバックエンドに渡し「宣言外の ack では完了しない」「宣言のどれか 1 つを欠けば完了しない」を撃つ形になっており、full-enum をハードコードした実装はここで落ちる。`outboxRepository` の id 衝突契約（既存行を一切乱さない・batch の他行は保存される・quarantine / processed の状態を戻さない）も 3 ケースで固定済み。skip は `SignInOAuthClient code exchange [google]` の 3 件のみで、スイート名に理由（`unverifiable: …`）が出るうえ、skip 側の `mintCode` は呼ばれたら throw する形なのでゲートを誤って広げれば失敗する。認可要求側（S256 導出 / URL 構築）は両アダプターで常に実行される。
- **Retry / エラー翻訳**: Google アダプターは 4xx→`ValidationError("OAUTH_CODE_INVALID")`、transport / 5xx / 壊れた応答 / timeout→`SystemError(EXTERNAL_API_ERROR)` に畳み、provider ネイティブなエラーを外へ出さない。`exchangeCode` を再試行しない理由（認可コードは単回使用）も JSDoc にある。`googleSignInOAuthClient.test.ts` が 12 ケースでこの表を全行押さえている。
- **OAuth 配線**: dev IdP の選択は env スキーマの `superRefine` に閉じ、`NODE_ENV=development` の allowlist（unset / 空 / `staging` / `production` は全て起動失敗）。`MemoryRuntimeOptions.oauth` に既定値が無いので「誰も決めなかった」が dev に落ちない。`/dev/oauth/authorize` は loader と consent server function の**両方**が `RequestContainer.oauthDevMode` を見る（env 直読み無し）。PKCE は `deriveCodeChallengeS256` の 1 実装を両アダプターが共有し、dev の `exchangeCode` も challenge 照合を行う。`id_token` は `iss` / `aud`（配列可） / `exp` / `sub` / `email` を検証し、署名検証を省く根拠（OIDC Core §3.1.3.7）が JSDoc にある。
- **DI / composition root**: `WorkerContainer` / `RequestContainer` / 両 UoW コンテキストに AC-31 の全ポートが載っており、「適合テストからしか触れないポート」は残っていない（`idempotencyStore` は購読者から到達可能、`claimDue` の未使用は progress.md 記録済み）。runtime singleton は未初期化 throw / 別 env throw / 同一 env 再入は保持で、`di/__tests__/serverNode.test.ts` の 3 ケースが固定している。
- **ワーカーランタイム**: relay / scope task の tick はどちらも `createInProcessRelayTrigger` 経由で直列化＋kick 併合、全 timer が `unref()`、`stop()` は timer 解除 → signal listener 解除 → trigger 停止 → `pendingSweeps` のドレイン → cleanup の順で、`runner.test.ts` が「start で prune 1 回」「二重 start 無視」「stop 後は刻まない」「listener が累積しない」を押さえる。dev 再ロードは `server.node.ts` の boot slot が前の boot を `shutdown()` してから作り直す。prune tick は 3 sweep が相互に try/catch で隔離。本文 12MB 上限は `Content-Length` 宣言と chunked の実測の 2 経路で、業務上限（アバター転送境界 8MB / ポリシー 5MB）との関係も docs と一致。
- **継続タスクの claim → 実行 → settle**: turn が自分の行を `complete` / `schedule` / `backoffOrSchedule` で決着させ、throw した turn だけをランナーが `backoff` する分担が実装・JSDoc・テストで揃っている。`deleteFilesByOwner` は `page.count > deletedCount` で継続を判断し、「対象あり・削除 0」は継続を積まず backoff するので spin しない。未知 kind は due のまま warn（無音完了しない）。barrier を閉じた turn の scope→global 引き渡しは専用の継続行（ADR-106）で駆動され、`scopeTaskRunner.test.ts` が「引き渡しを落としてから再駆動して完走する」を実際に走らせている。
- **決定的 EventId と outbox の id 衝突**: `mintEventIdFor` は `payload.continuationKey` があるときだけ id を導出し、`continuationKey` は `type:operationId:phase:cursor` でターンごとに変わる。finalize の 3 producer はそれぞれ自分を名乗る cursor を持ち、最後に確定した receipt と同じ UoW で継続を積むので、必ずどれか 1 本が全 receipt 確定後に配送される。memory の `save` は既存 id をスキップし、その契約（保存済み行を乱さない／保持期間が replay 窓を上回る必要がある）はポート JSDoc と適合スイートの両方にある。
- **コメント**: 確認した範囲に、指摘への弁明やレビュー修正の経緯を残す記述は見当たらなかった。残っているのは縮退の理由と引き継ぎ先（`ScopeTaskScheduler` の priority / lease 欠落 → #19、`identity_removal_receipts` の二重 sweep → #15、`identityRemovalRelease` の TOCTOU → #21、OAuth 束縛 Cookie の一方向性 → #20）で、いずれも plan.md / progress.md の縮退記録と一致する why コメント。
- **既知だが指摘しない事項**: memory の `AuthTokenRepository` は `(user_id, purpose) WHERE status='pending'` の部分ユニーク制約を強制しない。ただし `docs/test.md` が「SQL 制約など memory が証明できない性質は #11 の実バックエンド実行に委ねる」と明示しており、実コードは全経路で delete → insert なので現時点の実害は無い。

### カバレッジ

- 件数: **確認 113 + スキップ 198 = 311**（変更ファイル一覧と一致）

#### 確認（113）

- `apps/web/.env.example`
- `apps/web/app/presentation/deletionTicket.ts`
- `apps/web/app/presentation/devOAuth.ts`
- `apps/web/app/presentation/oauthStateBinding.ts`
- `apps/web/app/presentation/oauthStateCookie.ts`
- `apps/web/app/presentation/session.ts`
- `apps/web/app/presentation/verificationSession.ts`
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
- `packages/core/src/application/identity/continuations.ts`
- `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
- `packages/core/src/application/identity/requestPasswordReset.ts`
- `packages/core/src/application/identity/resendVerificationEmail.ts`
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
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`
- `packages/core/src/domain/note/ports/localNoteQueryService.ts`
- `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/valueObject.ts`
- `packages/core/src/domain/usage/ports/llmUsageRepository.ts`
- `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`
- `vitest.config.ts`

#### スキップ（198）

**`.thread/2/**`（52）** — レビュー記録・計画メモそのもの。R10 はゼロベース指定のため過去のレビューファイルは読まず、`plan.md` / `progress.md` / `adr.md` は「決着済みの事実」の参照元として使用（レビュー対象としては採点しない）。

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

**フロントエンド（57）** — components / routes / routeTree / errorDisplay / presentation のテスト。Frontend・Security 観点の担当。ただし OAuth と削除の配線に触れる `presentation/{oauthStateBinding,oauthStateCookie,devOAuth,deletionTicket}.ts` と `routes/{dev/*,storage.$,settings/-action}` は Adapter 側で確認済み（上の確認欄）。

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
- `apps/web/app/presentation/errorDisplay.ts`
- `apps/web/app/routeTree.gen.ts`
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

**ドメイン層（20）** — エンティティ / VO / ポリシー / イベント定義。Domain-Usecase 観点の担当。ポート定義・`storage/valueObject.ts`・`uploadValidationPolicy.ts` はアダプター契約に直結するため確認済み。

- `packages/core/src/domain/identity/__tests__/policies.test.ts`
- `packages/core/src/domain/identity/errorCode.ts`
- `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`
- `packages/core/src/domain/identity/services/identityPolicy.ts`
- `packages/core/src/domain/identity/services/sameOriginPolicy.ts`
- `packages/core/src/domain/identity/user.ts`
- `packages/core/src/domain/identity/valueObject.ts`
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

**ユースケース層（69）** — identity / usage の usecase 本体とそのテスト。Domain-Usecase・Test 観点の担当。なお継続イベントの発行地点（`authResidueCleanup.ts` / `deleteAccount/{manifestBuild,globalCleanup,authorRedaction}.ts`）は決定的 EventId の衝突可否を確かめるため該当箇所のみ横断参照したが、ユースケースとしての採点は行っていない。

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
- `packages/core/src/application/identity/deleteAccount/admission.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
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
- `packages/core/src/application/identity/resetPassword.ts`
- `packages/core/src/application/identity/signOut.ts`
- `packages/core/src/application/identity/signOutOtherSessions.ts`
- `packages/core/src/application/identity/startOAuthFlow.ts`
- `packages/core/src/application/identity/uniqueness.ts`
- `packages/core/src/application/identity/updateProfile.ts`
- `packages/core/src/application/identity/view.ts`
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts`
- `packages/core/src/application/usage/__tests__/deleteQuota.test.ts`
- `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts`
- `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts`
- `packages/core/src/application/usage/deleteQuota.ts`
- `packages/core/src/application/usage/getUsageSnapshot.ts`
- `packages/core/src/application/usage/recalculateStorageUsage.ts`
- `packages/core/src/application/usage/view.ts`
