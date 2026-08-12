# レビュー 005 — Security

対象: PR #17（`issue/2/account-management-and-auth`） / ベース `main` / 変更 284 ファイル
観点: 認証・認可、列挙耐性と情報漏洩、トークン、セッション、OAuth、dev IdP の本番混入、削除 status ticket、アップロード、入力バリデーション / DoS / CSRF / 暗号
実測: `pnpm build && pnpm start`（`.env` に `OAUTH_DEV_MODE=true`）、`npx vitest run apps/web/app/presentation packages/core/src/application/di packages/core/src/adapters/oauth`

## Security

### Blockers

なし。

### Warnings

- **[W-001]** `identityRemovalRelease` の「再連携済みなら解放しない」判定が、実際の解放と同じトランザクションに入っていない / 場所: `packages/core/src/application/identity/identityRemovalRelease.ts:37-80` / 理由: `globalUnitOfWorkProvider.run(...)` の中で receipt・identity 行・`listByUserId` を読んで `outcome: "release"` を決めた**あと**、`releaseActiveUniqueKey`（`beginRelease` → `release`）はトランザクションの外で走る。決定のコミットと `beginRelease` のあいだに同一利用者が同じ provider account を再連携し、その `activate` まで通ってしまうと、`beginRelease` は「所有者が一致する `active` 行」しか見ないので、新しく張られた claim を `releasing` に落として `release` で消す。結果として identity 行は残るのに `providerAccount` の一意性予約だけが消え、次に同じ外部アカウントでサインインすると `identityUniqueDirectory.resolve` が `null` を返し、メールが一致すれば同一 provider account の identity がもう 1 件生え、メールが違えば別アカウントが新規作成される。**権限昇格には至らない**（その外部アカウントを握っていない第三者は予約を取り直せない）ため Blocker にはしないが、「解除 → 再連携 → removal イベント再配送」で守られている不変条件が、同時実行に対しては守られていない（再配送のほうは `providerAccountRelinked` で正しく keep する）。Node ランタイムでは commit 後に relay が即 kick されるので窓はミリ秒だが、複数ワーカー配備（#11 / #19）では広がる。/ 提案: shard が違うため 1 つの UoW には入れられないので、(a) `beginRelease` に「行の `operationId` / `userVersion` が読んだときと同じであること」を条件として渡す形にポート契約を広げるか、(b) `releaseActiveUniqueKey` の直前で `identityRepository.listByUserId` を読み直して再連携を再確認する。テストは `removeIdentity` →（配送を止めたまま）`linkOAuthIdentity` → 止めていた `identityRemovalRelease` を流す順で、`resolve("providerAccount", key)` が新しい所有者を返し続けることを固定する（現行 `removeIdentity.test.ts` は逐次順序だけを固定している）。

### 確認できた主な点（記録）

- **dev IdP の本番混入**: `pnpm build && pnpm start` で実測。`scripts/listen.node.ts` が dotenv より前に `process.env.NODE_ENV ??= "production"` を置くので `.env` から降格できず、`OAUTH_DEV_MODE=true` との併用は `readNodeServerEnv()` の `superRefine` が ZodError で起動を止めた（観測済み）。`OAUTH_DEV_MODE` も Google 資格情報も無い env も起動失敗に倒れ、既定値で dev IdP が選ばれる経路は無い。`__root.tsx` が `@/routes/dev/-action` を無条件に副作用 import しているが、`submitDevConsentFn` も同意画面ルートも `container.oauthDevMode`（composition root 供給）で 404 に倒れる。
- **OAuth**: `state` は `secureTokenGenerator.issue()`、`take` が atomic な単回消費、分岐根拠は state 行の `intent` のみ（クエリーでもセッションでもない）、パスの `:provider` は照合専用。束縛 Cookie は消費前に照合してから破棄し、消費に至らない往復には `abandonOAuthFlowFn` という破棄口がある。PKCE は両アダプター共通の `deriveCodeChallengeS256` で `code_challenge_method=S256` 固定。`id_token` は `iss` / `aud` / `exp` / `sub` / `email` を検証し `email_verified === true` のみ真、自動リンクは `AccountLinkingPolicy` 経由で未確認メールと非 active 利用者を拒否。`redirectTo` は `SameOriginPolicy.isSameOriginPath`（`//`・バックスラッシュ・C0 制御を落とす）、dev の `redirect_uri` は `resolveDevRedirectUri` が origin 一致を要求。`linkIdentity` は state に凍結した `userId` + `userAuthEpoch` を最終 UoW で再検証する。
- **セッション**: `HttpOnly` / `SameSite=Lax` / `Path=/` / dev 以外 `Secure` / `Domain` 無し / `Expires` は行の TTL と同源。一括失効は `authEpoch` バンプ 1 本で、現セッションだけ `refreshAuthEpoch` で追随。`requireSession()` は read-only で、無効 Cookie を GET 経路で消さない。`deleteAccountFn` はユースケース成功後にだけ Cookie を破棄する。
- **削除 status ticket**: 鍵は `RequestContainer.deletionTicketKeyRing`（composition root 供給。presentation は `process.env` を読まない）、HMAC-SHA-256 + `crypto.subtle.verify`（定数時間）、期限判定は署名検証の**後**、`operationId` は検証済み claims からしか取らない。`getAccountDeletionStatus` は読み取りビュー経由で `{operationId, status}` だけを返し、一覧も走査も無い。`sessionStorage` 退避は `{ticket, userId}` で、現在の主体と一致しない限り復元しない。
- **アップロード**: MIME もサイズも実バイトから決まり（シグネチャ判定 + `byteLength`）、クライアント申告は記録にも使わない。転送境界 8 MB、`listen.node.ts` が `Content-Length` と chunked 実測の両方で 12 MB 超をハンドラー到達前に 413 で切る。`ObjectKey.create` が `..` と先頭 `/` を拒否し、配信ルートは `purposeOf(key) !== "avatar"` を 404、ファイル名をサニタイズし、`nosniff` + `Content-Security-Policy: sandbox; default-src 'none'` + `Cache-Control: private` を付ける。`storeAvatar` は scope の通常 write 入口として `assertWritable` / `assertActorWritable` を両方呼ぶ。
- **ログ**: worker の配送ログは `eventId` / `eventType` / `aggregateId` の識別子のみ。一意性予約の `operationId` は生キー（メール / ハンドル / provider account）を埋め込むため、`uniqueness.ts` の失敗ログは `parentOperationId` と `kind` しか出さない。`identityRemovalRelease` が出す `operationId` は `removeIdentity:{identityId}` で PII を含まない。`finalize` のログは receipt 名のみ。
- **CSRF / 主体**: `start.ts` が `createCsrfMiddleware`（`handlerType === "serverFn"`）を明示再登録。`/settings/*` の server function はすべてハンドラー内で `requireSession()` を通し、`userId` / `subjectId` / `currentSessionToken` を要求本文から取らない。セッションを要求しないのは `getDeletionStatusFn` だけで、主体は ticket（設計どおり）。`/settings/danger` を未認証で開ける緩和も、子ルートのローダーと server function が独立に 401 を返す二重化がある。
- **列挙耐性**: `resendVerificationEmail` / `requestPasswordReset` は全分岐で同一の空応答（view 型自体が `Record<string, never>`）。`checkHandleAvailability` は公開情報（URL）でありセッション必須。`DeletedUser` の tombstone はメール・表示名・自己紹介・ハンドル・アイコンを保持しない。
- **弁明コメント**: 差分の追加行に「レビュー指摘」「前回の修正」の類の記述は無い（`R2` のヒットは Cloudflare R2 の意）。

既決着として蒸し返さない項目（認証系メールの応答時間の等時化 = Issue #18、`addPasswordIdentity` の再認証 = spec-sync、OAuth 束縛 Cookie が `sha256(state)` である点 = Issue #20）は、plan.md の「縮退」と該当 JSDoc の記載が実装と一致していることだけ確認した。

## カバレッジ

確認 104 件 + スキップ 180 件 = 284 件（変更ファイル一覧 284 と一致）。

### 確認（104）

- `.thread/2/plan.md`
- `apps/web/.env.example`
- `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`
- `apps/web/app/components/auth/ResendVerificationForm/action.ts`
- `apps/web/app/components/auth/ResetPasswordPanel/action.ts`
- `apps/web/app/components/auth/SignInForm/action.ts`
- `apps/web/app/components/auth/SignUpForm/action.ts`
- `apps/web/app/components/auth/VerifyEmailPanel/action.ts`
- `apps/web/app/components/auth/schema.ts`
- `apps/web/app/components/layout/AccountMenu/action.ts`
- `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`
- `apps/web/app/components/settings/IdentityList/action.ts`
- `apps/web/app/components/settings/ProfileForm/action.ts`
- `apps/web/app/components/settings/ProfileForm/editor.tsx`
- `apps/web/app/components/settings/UsagePanel/action.ts`
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
- `apps/web/app/routes/__root.tsx`
- `apps/web/app/routes/auth/-action.tsx`
- `apps/web/app/routes/auth/callback.$provider.tsx`
- `apps/web/app/routes/dev/-action.tsx`
- `apps/web/app/routes/dev/oauth/authorize.tsx`
- `apps/web/app/routes/reset-password.tsx`
- `apps/web/app/routes/settings/-action.tsx`
- `apps/web/app/routes/settings/auth.tsx`
- `apps/web/app/routes/settings/danger.tsx`
- `apps/web/app/routes/settings/index.tsx`
- `apps/web/app/routes/settings/route.tsx`
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/verify-email.tsx`
- `apps/web/app/server.node.ts`
- `apps/web/app/worker/node/runner.ts`
- `apps/web/scripts/listen.node.ts`
- `packages/core/src/adapters/memory/objectStorage.ts`
- `packages/core/src/adapters/memory/repositories/authTokenRepository.ts`
- `packages/core/src/adapters/memory/repositories/distributedOperationStore.ts`
- `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`
- `packages/core/src/adapters/memory/repositories/scopeCleanupAdmissionStore.ts`
- `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`
- `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts`
- `packages/core/src/adapters/oauth/devSignInOAuthClient.ts`
- `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`
- `packages/core/src/adapters/oauth/pkce.ts`
- `packages/core/src/adapters/oauth/signInOAuthClient.ts`
- `packages/core/src/application/cleanup/participants.ts`
- `packages/core/src/application/cleanup/personalCleanup.ts`
- `packages/core/src/application/di/__tests__/serverNode.test.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/di/serverNode.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/execution/eventId.ts`
- `packages/core/src/application/identity/addPasswordIdentity.ts`
- `packages/core/src/application/identity/authResidueCleanup.ts`
- `packages/core/src/application/identity/changePassword.ts`
- `packages/core/src/application/identity/checkHandleAvailability.ts`
- `packages/core/src/application/identity/completeOAuthCallback.ts`
- `packages/core/src/application/identity/completeOAuthSignIn.ts`
- `packages/core/src/application/identity/continuations.ts`
- `packages/core/src/application/identity/deleteAccount/admission.ts`
- `packages/core/src/application/identity/deleteAccount/finalize.ts`
- `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`
- `packages/core/src/application/identity/deleteAccount/index.ts`
- `packages/core/src/application/identity/deleteAccount/input.ts`
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
- `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`
- `packages/core/src/application/storage/deleteFiles.ts`
- `packages/core/src/application/storage/deleteFilesByOwner.ts`
- `packages/core/src/application/storage/deleteStoredObjects.ts`
- `packages/core/src/application/storage/storeAvatar.ts`
- `packages/core/src/application/usage/getUsageSnapshot.ts`
- `packages/core/src/application/usage/recalculateStorageUsage.ts`
- `packages/core/src/application/workers/eventRelayWorker.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`
- `packages/core/src/domain/identity/services/sameOriginPolicy.ts`
- `packages/core/src/domain/identity/user.ts`
- `packages/core/src/domain/identity/valueObject.ts`
- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/valueObject.ts`

### スキップ（180）

本観点（認証・認可・秘密・トークン・入力境界）で判断に影響する記述を含まないと確認したうえで精読を省いたもの。

**レビュー記録・計画メモ（ゼロベースのため過去ラウンドの記録は参照しない。実装コードではない）（26）**

- `.thread/2/adr.md`
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

**ドキュメント・生成物・ツール設定（4）**

- `apps/web/app/routeTree.gen.ts`
- `docs/runtime_node.md`
- `docs/test.md`
- `vitest.config.ts`

**表示専用のクライアント島・スケルトン・スタイル・ルート枠（主体判定と秘密の取り扱いを持たない）（27）**

- `apps/web/app/components/auth/OAuthButton/index.tsx`
- `apps/web/app/components/auth/PasswordStrengthMeter/index.tsx`
- `apps/web/app/components/auth/ResendVerificationForm/index.tsx`
- `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`
- `apps/web/app/components/auth/SignInForm/index.tsx`
- `apps/web/app/components/auth/SignUpForm/index.tsx`
- `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`
- `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`
- `apps/web/app/components/auth/passwordStrength.ts`
- `apps/web/app/components/dev/DevConsentForm/index.tsx`
- `apps/web/app/components/layout/AccountMenu/index.tsx`
- `apps/web/app/components/layout/AppShell/index.tsx`
- `apps/web/app/components/layout/SettingsTabs/index.tsx`
- `apps/web/app/components/note/NoteBody/index.tsx`
- `apps/web/app/components/settings/AddPasswordForm/index.tsx`
- `apps/web/app/components/settings/ChangePasswordForm/index.tsx`
- `apps/web/app/components/settings/IdentityList/board.tsx`
- `apps/web/app/components/settings/IdentityList/index.tsx`
- `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`
- `apps/web/app/components/settings/ProfileForm/index.tsx`
- `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`
- `apps/web/app/components/settings/UsagePanel/index.tsx`
- `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`
- `apps/web/app/components/settings/panelStyles.ts`
- `apps/web/app/routes/notes/index.tsx`
- `apps/web/app/routes/settings/profile.tsx`
- `apps/web/app/routes/settings/usage.tsx`

**テスト（本観点で問う挙動は presentation / di / oauth のスイートを実行して確認済み）（51）**

- `apps/web/app/worker/node/__tests__/runner.test.ts`
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts`
- `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`
- `packages/core/src/application/__tests__/helpers.ts`
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

**適合スイート（ポート契約の検証用。実装ではない）（16）**

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

**memory アダプター（秘密・セッション・主体判定を持たない永続化）（13）**

- `packages/core/src/adapters/memory/globalUnitOfWork.ts`
- `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`
- `packages/core/src/adapters/memory/repositories/appliedOperationStore.ts`
- `packages/core/src/adapters/memory/repositories/identityRemovalReceiptStore.ts`
- `packages/core/src/adapters/memory/repositories/llmUsageRepository.ts`
- `packages/core/src/adapters/memory/repositories/noteProjection.ts`
- `packages/core/src/adapters/memory/repositories/outboxRepository.ts`
- `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`
- `packages/core/src/adapters/memory/repositories/storageQuotaRepository.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/memory/scopeTaskQueue.ts`
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts`
- `packages/core/src/adapters/memory/store.ts`

**ポート定義・イベント定義・エラーコード・DTO 投影（28）**

- `packages/core/src/application/identity/eventDecoders.ts`
- `packages/core/src/application/ports/accountDeletionManifestStore.ts`
- `packages/core/src/application/ports/appliedOperationStore.ts`
- `packages/core/src/application/ports/distributedOperationStore.ts`
- `packages/core/src/application/ports/identityRemovalReceiptStore.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/ports/outboxRepository.ts`
- `packages/core/src/application/ports/scopeTaskQueue.ts`
- `packages/core/src/application/ports/scopeTaskScheduler.ts`
- `packages/core/src/application/ports/scopeTaskTrigger.ts`
- `packages/core/src/application/storage/eventDecoders.ts`
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/usage/view.ts`
- `packages/core/src/domain/common/event.ts`
- `packages/core/src/domain/identity/errorCode.ts`
- `packages/core/src/domain/identity/ports/authTokenRepository.ts`
- `packages/core/src/domain/identity/ports/signInOAuthClient.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`
- `packages/core/src/domain/note/ports/localNoteQueryService.ts`
- `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`
- `packages/core/src/domain/storage/errorCode.ts`
- `packages/core/src/domain/storage/events.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/usage/errorCode.ts`
- `packages/core/src/domain/usage/events.ts`
- `packages/core/src/domain/usage/ports/llmUsageRepository.ts`
- `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`

**削除オーケストレーションの内部段（主体判定は admission / assertOwner が済ませたあとの継続処理）（5）**

- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
- `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
- `packages/core/src/application/identity/deleteAccount/compaction.ts`
- `packages/core/src/application/identity/deleteAccount/manifestBuild.ts`
- `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`

**ドメイン / ユースケースの計算ロジック（転送境界からの主体判定も秘密も扱わない）（10）**

- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/usage/deleteQuota.ts`
- `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`
- `packages/core/src/domain/identity/services/identityPolicy.ts`
- `packages/core/src/domain/note/valueObject.ts`
- `packages/core/src/domain/storage/storedFile.ts`
- `packages/core/src/domain/usage/llmUsage.ts`
- `packages/core/src/domain/usage/services/quotaEnforcement.ts`
- `packages/core/src/domain/usage/storageQuota.ts`
- `packages/core/src/domain/usage/valueObject.ts`

