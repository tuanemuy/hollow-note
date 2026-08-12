# レビュー R3 — Security

PR #17 / base `main` / branch `issue/2/account-management-and-auth`
観点: Security（認証・認可・トークン・セッション・OAuth・アップロード・CSRF・暗号）

## Security

### Blockers

なし

### Warnings

- **[W-001]** 一意性予約の `operationId` に正規化キー（メールアドレス・ハンドル・provider account id）がそのまま埋め込まれ、その値が失敗経路でアプリケーションログに出る
  - 場所: `packages/core/src/application/identity/uniqueness.ts:64`（`reservationOperationId`）、出力箇所は同ファイル `:119-122` と `:208-211`
  - 理由: `reservationOperationId` は `` `${parentOperationId}:${key.kind}:${key.normalizedKey}` `` なので、`kind: "email"` の予約 ID は末尾に生のメールアドレスを含む。この ID が `logger.error("[uniqueness] reservation release failed", { operationId })` と `logger.error("[uniqueness] activate response lost; reconciling", { operationId })` に載る。`completeOAuthSignIn` の `createUser`（email + providerAccount の 2 予約）と `signUpWithPassword` は、directory への `reserve` / `activate` が一時障害を起こすたびにこの経路を通るので、ストア障害が 1 回起きるだけで登録試行中の利用者のメールアドレスがログへ流れる。`main` では予約 ID が `idGenerator.next()` の乱数だったため、この露出は本 PR で新しく入ったもの。ログは DB と保持期間も権限境界も別なので（転送・集約基盤に出ていく）、「directory 行に同じ値がある」ことは緩和にならない。
  - 提案: 決定性は composition のままでよいので、**ログに出す値だけ** PII を含まない識別子にする（`{ parentOperationId, kind }` だけを載せる、あるいは `normalizedKey` 部分をハッシュ化した派生 ID を別途持って log 用にする）。同じ理由で `updateProfile` の `handleReleaseOperationId`（ハンドルを含む）も将来ログに載せない規律を JSDoc に残しておくと安全側に倒る。

## 確認した主な点（いずれも問題なし）

- **主体の取得**: `apps/web/app/routes/settings/-action.tsx` / `auth/-action.tsx` / `components/*/action.ts` の全 server function が主体を Cookie セッション（`requireSession()` / `readSessionToken()`）から取り、`userId` / `subjectId` / `currentSessionToken` を要求本文から受け取っていない。`removeIdentityFn` の `identityId` はユースケース側で `listByUserId(userId)` に対して所有確認され、他人の ID は `IDENTITY_NOT_FOUND` に畳まれる。`getDeletionStatusFn` だけがセッションを要求しないが、`operationId` を検証済み ticket からしか取らないので ticket が示す 1 件以外は読めない（TC-identity-048）。
- **OAuth の state 束縛**: 生成（`startOAuthSignInFn` / `startOAuthLinkFn`）・照合（`assertOAuthStateCookie` を `oauthStateStore.take` より**前**に実行）・破棄（照合直後 + 消費 POST が起きない往復の `abandonOAuthFlowFn`）の 3 経路すべてが揃っている。Cookie は `state` そのものではなく SHA-256、`HttpOnly` / `SameSite=Lax` / `Path=/` / prod で `Secure`。`oauthStateBindingWiring.test.ts` が「照合前に `take` を呼ばない」「他ブラウザーの callback で被害者の Cookie を消さない」まで固定している。intent は `state` 行だけが決め（`completeOAuthCallback`）、`linkIdentity` は `userAuthEpoch` を UoW 内で再検査する。PKCE は S256 固定、`redirectTo` / dev の `redirect_uri` はどちらも同一オリジン検査（`SameOriginPolicy` / `resolveDevRedirectUri`）を通る。Google の `id_token` は `iss` / `aud` / `exp` / `sub` / `email` を検証し、`email_verified` は `AccountLinkingPolicy` が未確認なら自動リンク・新規作成の双方を拒否する。
- **dev IdP の production 遮断（実測）**: `pnpm build && pnpm start` を実際に実行して確認した。`scripts/listen.node.ts` が dotenv より前に `process.env.NODE_ENV ??= "production"` を置くため `.env` で降格できず、`OAUTH_DEV_MODE=true`（コマンドラインでも `.env` 経由でも）で boot が ZodError で失敗する。Google 資格情報で起動した production バンドルでは `/dev/oauth/authorize?...`（正しいクエリー付き）が **404**、`submitDevConsentFn` も `container.oauthDevMode` で `NotFoundError` に倒れる。
- **削除 status ticket**: HMAC-SHA256、鍵は composition root 供給（未設定時は `randomBytes(32)` のプロセス鍵）、`crypto.subtle.verify` による定数時間比較、期限判定は署名検証の**後**、鍵版は署名対象文字列に含まれるので差し替えできない。claims は `operationId` と期限だけで、`getAccountDeletionStatus` は `{ operationId, status }` しか返さず一覧・スキャン経路を持たない。`sessionStorage` 退避は保存時の主体 (`userId`) を持ち、別利用者がサインインしたタブでは復元しない。
- **アップロード / 配信**: `UploadValidationPolicy.ensureAcceptable` は MIME もサイズも**実バイト**（マジックバイト + `byteLength`）から決め、宣言値を使わない。転送境界 8 MB、`listen.node.ts` が全要求に 12 MB の本文上限（`Content-Length` と chunked の両方）を掛ける。`ObjectKey.create` が `..` / 先頭 `/` を禁止し、memory ObjectStorage は Map なのでファイルシステムに触れない。`/storage/$` は `ObjectKey.purposeOf(key) !== "avatar"` を 404 に倒すので avatar 以外の鍵空間（source / media / artifact）は読めず、`nosniff` + `Content-Security-Policy: sandbox; default-src 'none'` + `private` キャッシュ、`Content-Disposition` のファイル名は鍵から再生成した安全文字のみ。
- **セッション / 一括失効**: `HttpOnly` / `SameSite=Lax` / `Path=/` / `Domain` なし / prod `Secure`、寿命は `Session.ttlMs`。`resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount` の 4 経路が `authEpoch` バンプで O(1) 失効し、`authResidueCleanup` は現世代を消さない。サインアウトは POST のみ（GET 経路なし）で Cookie を破棄し、フル遷移でルーターキャッシュごと捨てる。
- **列挙耐性**: `resendVerificationEmail` / `requestPasswordReset` は全分岐で同一の空応答（View 型自体が `Record<string, never>`）、`signUpFn` は重複メールでも確認待ち Cookie を無条件に焼く、`removeIdentity` は他人の ID を不在と同一視、`/storage/$` は形式違反も 404。エラー文言は辞書引き（`renderErrorMessage`）でサーバー `message` を反射しない。応答**時間**の非等時性は plan の縮退（Issue #18）どおりで、本 PR の契約内。
- **CSRF**: `apps/web/app/start.ts` が `createCsrfMiddleware({ filter: handlerType === "serverFn" })` を再登録しており、実装は `Sec-Fetch-Site: same-origin` / `Origin` 一致 / `Referer` 同一オリジンのいずれかを要求し、どれも無い要求は既定で 403（`allowRequestsWithoutOriginCheck` は未指定）。`FormData` を受ける唯一の入口 `uploadAvatarFn` もここを通る。状態変更 GET は無い。
- **暗号 / 乱数**: パスワードは scrypt（`createScryptPasswordHasher`）、PKCE / ticket / state 束縛は `node:crypto` / `crypto.subtle`、鍵と `requestId` フォールバックは `randomBytes` / `getRandomValues`。
- **残す必要のない記述**: 差分中のコメントは仕様・不変条件・WHY に限られており、指摘への弁明や修正経緯の記述は見当たらなかった。

## カバレッジ

確認 96 件 / スキップ 178 件 = 274 件。

### 確認

- `.thread/2/plan.md`
- `apps/web/.env.example`
- `apps/web/app/components/auth/OAuthButton/index.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `apps/web/app/components/auth/ResendVerificationForm/action.ts`, `apps/web/app/components/auth/ResetPasswordPanel/action.ts`, `apps/web/app/components/auth/SignInForm/action.ts`, `apps/web/app/components/auth/SignUpForm/action.ts`, `apps/web/app/components/auth/VerifyEmailPanel/action.ts`, `apps/web/app/components/auth/passwordStrength.ts`, `apps/web/app/components/auth/schema.ts`
- `apps/web/app/components/dev/DevConsentForm/index.tsx`, `apps/web/app/components/layout/AccountMenu/action.ts`, `apps/web/app/components/layout/AccountMenu/index.tsx`, `apps/web/app/components/layout/AppShell/index.tsx`
- `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/settings/IdentityList/action.ts`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/components/settings/ProfileForm/editor.tsx`, `apps/web/app/components/settings/UsagePanel/action.ts`
- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`, `apps/web/app/presentation/__tests__/devOAuth.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/deletionTicket.ts`, `apps/web/app/presentation/devOAuth.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/presentation/oauthStateBinding.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/verificationSession.ts`
- `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/reset-password.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/auth.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/routes/settings/index.tsx`, `apps/web/app/routes/settings/profile.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/settings/usage.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/routes/verify-email.tsx`
- `apps/web/app/server.node.ts`, `apps/web/scripts/listen.node.ts`
- `packages/core/src/adapters/memory/objectStorage.ts`
- `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts`, `packages/core/src/adapters/oauth/devSignInOAuthClient.ts`, `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`, `packages/core/src/adapters/oauth/pkce.ts`, `packages/core/src/adapters/oauth/signInOAuthClient.ts`
- `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/di/memoryRuntime.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/types.ts`
- `packages/core/src/application/identity/addPasswordIdentity.ts`, `authResidueCleanup.ts`, `changePassword.ts`, `checkHandleAvailability.ts`, `completeOAuthCallback.ts`, `completeOAuthSignIn.ts`, `deleteAccount/admission.ts`, `deleteAccount/index.ts`, `deleteAccount/input.ts`, `getAccountDeletionStatus.ts`, `getProfile.ts`, `identityRemovalRelease.ts`, `linkOAuthIdentity.ts`, `listIdentities.ts`, `removeIdentity.ts`, `requestPasswordReset.ts`, `resendVerificationEmail.ts`, `resetPassword.ts`, `signOut.ts`, `signOutOtherSessions.ts`, `startOAuthFlow.ts`, `uniqueness.ts`, `updateProfile.ts`, `view.ts`
- `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/storage/deleteStoredObjects.ts`, `packages/core/src/application/storage/storeAvatar.ts`
- `packages/core/src/application/usage/getUsageSnapshot.ts`, `packages/core/src/application/usage/recalculateStorageUsage.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `packages/core/src/domain/identity/user.ts`, `packages/core/src/domain/identity/valueObject.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`, `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`, `packages/core/src/domain/storage/valueObject.ts`

### スキップ

- `.thread/2/adr.md`, `.thread/2/progress.md`, `.thread/2/review/*`（12 件）, `.thread/2/steps.md`, `.thread/2/testing.md` — 計画・レビュー記録であってコードではない（16 件）
- `apps/web/app/components/auth/{PasswordStrengthMeter,ResendVerificationForm,ResetPasswordPanel,SignInForm,SignUpForm,VerifyEmailPanel}/index.tsx`, `apps/web/app/components/auth/__tests__/passwordStrength.test.ts` — 表示と入力保持だけで、資格情報の判断はすべて対の `action.ts` 側にある（7 件）
- `apps/web/app/components/layout/SettingsTabs/index.tsx`, `apps/web/app/components/note/NoteBody/index.tsx`, `apps/web/app/components/settings/{AddPasswordForm,ChangePasswordForm,IdentityList/board.tsx,IdentityList/index.tsx,IdentityListSkeleton,ProfileForm/index.tsx,ProfileFormSkeleton,UsagePanel/index.tsx,UsagePanelSkeleton,panelStyles.ts}` — 主体・認可の判断を持たない表示層（12 件）
- `apps/web/app/routeTree.gen.ts` — 生成物（1 件）
- `apps/web/app/worker/node/runner.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts` — 転送境界も資格情報も扱わないワーカー駆動（2 件）
- `docs/runtime_node.md`, `docs/test.md` — 運用文書（2 件）
- `packages/core/src/adapters/conformance/*`（16 件）, `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`（1 件） — ポート適合スイートの定義で、攻撃面を持たない（17 件）
- `packages/core/src/adapters/memory/**`（`objectStorage.ts` を除く 20 件） — in-memory の参照実装。永続化・鍵・パスの取り扱いを持たず、配備物ではない（20 件）
- `packages/core/src/application/__tests__/helpers.ts`, `application/cleanup/{participants,personalCleanup}.ts`, `application/execution/{eventId.ts,unitOfWork.ts,__tests__/eventId.test.ts}`, `application/identity/continuations.ts`, `application/identity/pruneExpiredAuthState.ts`, `application/identity/deleteAccount/{authorRedaction,cleanupDispatch,compaction,finalize,globalCleanup,manifestBuild,terminalPrune}.ts`, `application/identity/eventDecoders.ts`, `application/storage/{deleteFiles,eventDecoders,view}.ts`, `application/usage/{deleteQuota,view}.ts`, `application/workers/{eventRelayWorker,scopeTaskRunner}.ts` — ワーカー平面の継続処理・射影で、外部入力も主体判定も持たない（23 件）
- `packages/core/src/application/identity/__tests__/*`（31 件）, `application/note/__tests__/createBlankNote.test.ts`, `application/storage/__tests__/*`（3 件）, `application/usage/__tests__/*`（3 件）, `application/workers/__tests__/*`（3 件）, `domain/identity/__tests__/policies.test.ts`, `domain/usage/__tests__/*`（2 件）, `vitest.config.ts` — 本観点で重要な挙動のテストは「確認」側（`oauthStateBindingWiring` / `deletionTicket` / `devOAuth` / `googleSignInOAuthClient` / `storage`）で個別に確認済み（45 件）
- `packages/core/src/application/ports/*`（10 件）, `domain/identity/ports/*`（3 件）, `domain/note/ports/*`（4 件）, `domain/storage/ports/storedFileRepository.ts`, `domain/usage/ports/*`（2 件） — 型契約のみ（20 件）
- `packages/core/src/domain/common/event.ts`, `domain/identity/errorCode.ts`, `domain/identity/services/accountDeletionRetryPolicy.ts`, `domain/note/valueObject.ts`, `domain/storage/{errorCode,events,storedFile}.ts`, `domain/usage/{errorCode,events,llmUsage,storageQuota,valueObject}.ts`, `domain/usage/services/quotaEnforcement.ts` — 資格情報にも外部入力にも触れない値・イベント定義（13 件）
