### Security

#### Blockers

なし

#### Warnings

- **[W-001]** Cookie の `Secure` 属性が、ADR-109 が「配備側の申告を信用できない」として捨てたはずの `NODE_ENV === "production"` denylist 判定のまま残っている / 場所: `apps/web/app/presentation/session.ts:32`（利用箇所 44 / 54 / 72 / 85 行）、`apps/web/app/presentation/oauthStateCookie.ts:23`（利用箇所 33 / 55 行） / 理由: ADR-109 は「`NODE_ENV=`（空文字）は `NODE_ENV=$UNSET_VAR` を書いたコンテナマニフェストで普通に起こる」「`??=` は空文字を nullish と見なさないので `listen.node.ts:20` の既定値も効かない」と**実測つきで**認め、dev IdP のガードだけを allowlist へ反転した。しかし同じ `NODE_ENV` 分類は Cookie の `Secure` にも効いていて、そちらは反転していない。攻撃シナリオ: 配備者が `NODE_ENV=staging`（あるいは `NODE_ENV=$UNSET_VAR` による空文字）で `pnpm start` する。`OAUTH_DEV_MODE` は付けていないので `nodeServerEnvSchema` は通り、Google 資格情報で**正常に起動する**（ADR-109 の allowlist は `OAUTH_DEV_MODE=true` のときしか発火しない）。この配備は HTTPS で公開されているが、`isProduction()` が偽なので `hollow_session` / `hollow_oauth_state` / `hollow_pending_verification` が `Secure` なしで焼かれる。同一 LAN / 経路上の攻撃者は、被害者に任意の `http://<同ホスト>/…` サブリソース（`<img src>` で足りる）を踏ませるだけで平文の要求に `hollow_session` を載せさせ、セッショントークンを丸ごと取得できる。`SECURITY_HEADERS`（`apps/web/app/server.node.ts:69`）に `Strict-Transport-Security` は無いので緩和も無い。`.env.example` にも `docs/runtime_node.md` にも「`NODE_ENV` は `production` 以外にするな」とは書かれておらず、`NODE_ENV` は本 PR が新たに読むようになった変数なので、誤設定は起こりうる。/ 提案: 判定を `session.ts` / `oauthStateCookie.ts` から 1 本の共有述語に括り、`NODE_ENV === "development"` **だけ**を `Secure` 免除にする（ADR-109 と同じ allowlist の向き。免除の理由は「dev の平文 http」であって「production ではない」ではないので、意味的にもこちらが正しい）。合わせて `withSecurityHeaders` に `Strict-Transport-Security` を足すか、少なくとも `.env.example` / `docs/runtime_node.md` に `NODE_ENV` の許容値を明記する。
- **[W-002]** `/auth/callback/$provider` の loader が、クロスサイトからの単なる GET で被害者の進行中フローの束縛 Cookie を破棄させられる / 場所: `apps/web/app/routes/auth/callback.$provider.tsx:28`（`abandonOAuthFlowFn` の呼び出し）、`apps/web/app/routes/auth/-action.tsx:45` / 理由: ADR-099 は「照合に**失敗した**ときは捨てない。不一致の Cookie は別のブラウザー（＝正規の利用者）が進行中のフローのものなので、攻撃者のコールバック URL を踏ませるだけで被害者のフローを壊せてしまう」と明記しているが、`deps.consumable === false`（`error` 付き、または `state` / `code` の欠落）の経路はまさにその「踏ませるだけ」で無条件に `clearOAuthStateCookie()` に到達する。攻撃シナリオ: 被害者が「Google で続ける」を押し、同意画面に居る（`hollow_oauth_state` が 10 分の TTL で存在する）あいだに、攻撃者ページの `<img src="https://app.example/auth/callback/google?error=x">` を読み込ませる。サーバーはこれをドキュメント要求として SSR し、loader が `abandonOAuthFlowFn` を叩いて `hollow_oauth_state` を失効させる `Set-Cookie` を応答に載せる（サブリソース応答の `Set-Cookie` はブラウザーが適用する。`SameSite` は送信条件であって設定条件ではない）。被害者が同意を終えて戻ると照合が落ち、`OAUTH_STATE_INVALID` で「認可の手続きが途中で切れました」になる。**認証状態は変わらないので可用性のみの影響**で、被害者はサインインからやり直せば通る。ただしタイミングは 10 分窓で、CSRF ミドルウェアも `SameSite=Lax` も止めない（GET ナビゲーション扱いのため）。/ 提案: 破棄の入口を「消費 POST が起きない往復」から「自分が焼いた Cookie だと確認できた往復」に狭める。具体的には loader ではなく島（`OAuthCallbackPanel`）のマウント後に、`state` が付いている組では照合つきで、`state` すら無い組では破棄しない（TTL 10 分に委ねる）形にするか、`abandonOAuthFlowFn` に `state` を渡して `deriveOAuthStateBinding` 一致時のみ破棄する。後者なら ADR-099 の「照合と対で置く」という設計意図がキャンセル経路でも保たれる。

#### 所見（指摘に至らなかった確認事項）

ゼロベースで見て、下記はいずれも実効的に閉じていることをコードで確認した。再指摘しないための記録。

- **主体は必ず Cookie セッション**。`/settings/*` の 12 本の server function はすべて `requireSession()` の戻り `user.userId` を使い、`userId` / `subjectId` を要求本文から取らない（`routes/settings/-action.tsx`）。RSC フラグメント（`renderIdentityList` / `renderProfileForm` / `renderUsagePanel`）も同じ。例外は `getDeletionStatusFn` だけで、権限は署名済み ticket が持ち、読む `operationId` は**検証済み claims からしか**取らない（TC-identity-048）。
- **ticket**: HMAC-SHA256、`crypto.subtle.verify` による定数時間照合、鍵版は平文で先頭・鍵は composition root 供給、期限判定は**署名検証の後**、claims は `operationId` + 期限のみ。改竄・別鍵・未知鍵版・非 ticket 文字列・期限の 6 ケースが `deletionTicket.test.ts` で固定。`sessionStorage` 退避は `{ ticket, userId }` で、サインイン中の別主体には復元しない（ADR-095）。
- **OAuth**: `state` の intent のみが分岐根拠で `take` は原子的単回消費、パスの `:provider` は `flow.provider` と照合、束縛 Cookie の照合は**ユースケースより前**、PKCE は両アダプターとも S256、`redirectTo` は `SameOriginPolicy` 経由、自動リンクは `AccountLinkingPolicy` が `emailVerified` を最優先で見る、`linkIdentity` は `flow.userAuthEpoch` を最終 UoW で再検査。Google の `id_token` は `iss` / `aud` / `exp` / `sub` / `email` を検証し、署名検証の省略は OIDC Core §3.1.3.7 の条件（TLS 直取得）を満たす。
- **dev IdP**: 起動ガード（allowlist）・ルート loader の 404・`submitDevConsentFn` の `NotFoundError` の 3 枚。`redirect_uri` は `resolveDevRedirectUri` が appUrl オリジンに限定し、`code` は無署名だが PKCE challenge を封筒に載せて `exchangeCode` が照合する。
- **アップロード**: MIME はバイト列の署名（PNG / JPEG / RIFF+WEBP）、サイズは実バイト長。転送 12 MB（`listen.node.ts`）→ schema 8 MB → ドメイン 5 MB の三段。`ObjectKey` は `..` / 先頭 `/` を禁じ、`purposeOf` が 4 セグメント固定なので `/storage/$` は avatar 以外を配信しない。配信は `nosniff` + `CSP: sandbox; default-src 'none'` + `Content-Disposition` の `filename` サニタイズ + `Cache-Control: private`。
- **ログ**: 変更ファイル内の 30 箇所すべてを確認し、`userId` / `operationId` / `kind` / `eventId` などの識別子と `cause` だけで、メールアドレス・トークン・ハンドル・鍵は出ない（`updateProfile` の release operationId は「directory 呼び出しの中に閉じてログに出ない」と JSDoc で担保、ADR-101）。`envDigest` は `globalThis` に置くだけでエラーメッセージにも載らない。
- **列挙耐性**: `resendVerificationEmail` / `requestPasswordReset` の View は `Record<string, never>`、`removeIdentity` は他人の identity を `IDENTITY_NOT_FOUND` に畳む、`/storage/$` は形式違反も 404。応答**時間**の非等時性は plan.md に縮退として記録済み（→ #18）なので再指摘しない。
- **CSRF**: `start.ts` が `createCsrfMiddleware` を明示再登録済み。Cookie を触る経路（`signOutFn` / `resetPasswordFn` / `completeOAuthCallbackFn` / `deleteAccountFn` / `abandonOAuthFlowFn`）はすべて POST。
- **経緯・弁明の残骸**: 変更ファイルのコメント・JSDoc に「レビュー指摘 B-00x を受けて」型の記述は無い。plan.md / adr.md に記録済みの縮退（`addPasswordIdentity` の再認証なし、束縛 Cookie が `sha256(state)` 止まり → #20、`identityRemovalRelease` の TOCTOU → #21、`recalculateStorageUsage` の workspace 主体、応答時間の等時化 → #18）は決着済みとして扱い、再指摘していない。

#### カバレッジ

変更ファイル 299 件 = 確認 80 + スキップ 219。

**確認**（80 件）:

- `.thread/2/adr.md`
- `.thread/2/plan.md`
- `.thread/2/progress.md`
- `apps/web/.env.example`
- `apps/web/app/components/auth/OAuthButton/index.tsx`
- `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`
- `apps/web/app/components/auth/ResetPasswordPanel/action.ts`
- `apps/web/app/components/dev/DevConsentForm/index.tsx`
- `apps/web/app/components/layout/AccountMenu/action.ts`
- `apps/web/app/components/note/NoteBody/index.tsx`
- `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`
- `apps/web/app/components/settings/IdentityList/action.ts`
- `apps/web/app/components/settings/IdentityList/index.tsx`
- `apps/web/app/components/settings/ProfileForm/action.ts`
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
- `apps/web/app/routes/auth/-action.tsx`
- `apps/web/app/routes/auth/callback.$provider.tsx`
- `apps/web/app/routes/dev/-action.tsx`
- `apps/web/app/routes/dev/oauth/authorize.tsx`
- `apps/web/app/routes/reset-password.tsx`
- `apps/web/app/routes/settings/-action.tsx`
- `apps/web/app/routes/settings/auth.tsx`
- `apps/web/app/routes/settings/index.tsx`
- `apps/web/app/routes/settings/route.tsx`
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/verify-email.tsx`
- `apps/web/app/server.node.ts`
- `apps/web/scripts/listen.node.ts`
- `packages/core/src/adapters/oauth/devSignInOAuthClient.ts`
- `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`
- `packages/core/src/adapters/oauth/pkce.ts`
- `packages/core/src/adapters/oauth/signInOAuthClient.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/di/serverNode.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/identity/addPasswordIdentity.ts`
- `packages/core/src/application/identity/authResidueCleanup.ts`
- `packages/core/src/application/identity/changePassword.ts`
- `packages/core/src/application/identity/checkHandleAvailability.ts`
- `packages/core/src/application/identity/completeOAuthCallback.ts`
- `packages/core/src/application/identity/completeOAuthSignIn.ts`
- `packages/core/src/application/identity/deleteAccount/admission.ts`
- `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`
- `packages/core/src/application/identity/deleteAccount/input.ts`
- `packages/core/src/application/identity/eventDecoders.ts`
- `packages/core/src/application/identity/getAccountDeletionStatus.ts`
- `packages/core/src/application/identity/getProfile.ts`
- `packages/core/src/application/identity/identityRemovalRelease.ts`
- `packages/core/src/application/identity/linkOAuthIdentity.ts`
- `packages/core/src/application/identity/listIdentities.ts`
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
- `packages/core/src/application/storage/storeAvatar.ts`
- `packages/core/src/application/usage/getUsageSnapshot.ts`
- `packages/core/src/application/usage/recalculateStorageUsage.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/domain/identity/services/sameOriginPolicy.ts`
- `packages/core/src/domain/identity/user.ts`
- `packages/core/src/domain/identity/valueObject.ts`
- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/valueObject.ts`

**スキップ**（219 件）:

- `.thread/2/review/review-00{1..7}-*.md` / `.thread/2/review/triage.md`（37 件） — 依頼どおりゼロベースで行うため過去のレビュー記録は読まない。
- `.thread/2/steps.md`, `.thread/2/testing.md`（2 件） — 手順書。判断根拠は plan.md / progress.md / adr.md で足りる。
- テスト・適合スイート（71 件、`**/__tests__/**` と `adapters/conformance/*`） — 本観点で確認した挙動が実効的なテストで守られているかは、`presentation/__tests__/{deletionTicket,devOAuth,oauthStateBinding,oauthStateBindingWiring}.test.ts` の 4 本（確認済み）と `di/__tests__/serverNode.test.ts` の存在で判定した。残りは機能正当性の担保でセキュリティ判断の材料にならない。
- `docs/runtime_node.md`, `docs/test.md`, `vitest.config.ts`, `apps/web/app/routeTree.gen.ts`（4 件） — ドキュメント・テスト設定・自動生成物。
- 下記 105 件 — セキュリティ境界（認証・認可・秘密・転送境界・配信）に触れない層。表示専用の島・スケルトン・スタイル、ポート型定義とその memory 実装、削除オーケストレーションの継続駆動（すべて worker 平面で外部入力を受けない）、Usage / Storage のドメイン計算。ポートと memory 実装については、認可判断を持つ 2 つ（`ScopeCleanupAdmissionStore` の `assertWritable` / `assertActorWritable`、`IdentityUniqueDirectory` の所有者一致解放）は呼び出し側（`storeAvatar` / `recalculateStorageUsage` / `globalCleanup` / `identityRemovalRelease`）で確認済み。なおこのうち 9 件（`components/auth/schema.ts`, `components/auth/ResendVerificationForm/action.ts`, `components/auth/SignInForm/action.ts`, `components/auth/SignUpForm/action.ts`, `components/auth/VerifyEmailPanel/action.ts`, `routes/settings/danger.tsx`, `adapters/memory/objectStorage.ts`, `application/storage/deleteFilesByOwner.ts`, `application/storage/deleteStoredObjects.ts`）は境界に触れないことを差分・本体の通読で確かめたうえでスキップ側に残した。

  - `apps/web/app/components/auth/PasswordStrengthMeter/index.tsx`
  - `apps/web/app/components/auth/ResendVerificationForm/action.ts`
  - `apps/web/app/components/auth/ResendVerificationForm/index.tsx`
  - `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`
  - `apps/web/app/components/auth/SignInForm/action.ts`
  - `apps/web/app/components/auth/SignInForm/index.tsx`
  - `apps/web/app/components/auth/SignUpForm/action.ts`
  - `apps/web/app/components/auth/SignUpForm/index.tsx`
  - `apps/web/app/components/auth/VerifyEmailPanel/action.ts`
  - `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`
  - `apps/web/app/components/auth/passwordStrength.ts`
  - `apps/web/app/components/auth/schema.ts`
  - `apps/web/app/components/layout/AccountMenu/index.tsx`
  - `apps/web/app/components/layout/AppShell/index.tsx`
  - `apps/web/app/components/layout/SettingsTabs/index.tsx`
  - `apps/web/app/components/settings/AddPasswordForm/index.tsx`
  - `apps/web/app/components/settings/ChangePasswordForm/index.tsx`
  - `apps/web/app/components/settings/IdentityList/board.tsx`
  - `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`
  - `apps/web/app/components/settings/ProfileForm/editor.tsx`
  - `apps/web/app/components/settings/ProfileForm/index.tsx`
  - `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`
  - `apps/web/app/components/settings/UsagePanel/index.tsx`
  - `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`
  - `apps/web/app/components/settings/panelStyles.ts`
  - `apps/web/app/routes/__root.tsx`
  - `apps/web/app/routes/notes/index.tsx`
  - `apps/web/app/routes/settings/danger.tsx`
  - `apps/web/app/routes/settings/profile.tsx`
  - `apps/web/app/routes/settings/usage.tsx`
  - `apps/web/app/worker/node/runner.ts`
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
  - `packages/core/src/application/cleanup/participants.ts`
  - `packages/core/src/application/cleanup/personalCleanup.ts`
  - `packages/core/src/application/execution/eventId.ts`
  - `packages/core/src/application/execution/unitOfWork.ts`
  - `packages/core/src/application/identity/continuations.ts`
  - `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
  - `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
  - `packages/core/src/application/identity/deleteAccount/compaction.ts`
  - `packages/core/src/application/identity/deleteAccount/finalize.ts`
  - `packages/core/src/application/identity/deleteAccount/index.ts`
  - `packages/core/src/application/identity/deleteAccount/manifestBuild.ts`
  - `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`
  - `packages/core/src/application/identity/pruneExpiredAuthState.ts`
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
  - `packages/core/src/application/storage/view.ts`
  - `packages/core/src/application/usage/deleteQuota.ts`
  - `packages/core/src/application/usage/view.ts`
  - `packages/core/src/application/workers/eventRelayWorker.ts`
  - `packages/core/src/application/workers/scopeTaskRunner.ts`
  - `packages/core/src/domain/common/event.ts`
  - `packages/core/src/domain/identity/errorCode.ts`
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`
  - `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`
  - `packages/core/src/domain/identity/ports/signInOAuthClient.ts`
  - `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`
  - `packages/core/src/domain/identity/services/identityPolicy.ts`
  - `packages/core/src/domain/note/ports/htmlProcessor.ts`
  - `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`
  - `packages/core/src/domain/note/ports/localNoteQueryService.ts`
  - `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`
  - `packages/core/src/domain/note/valueObject.ts`
  - `packages/core/src/domain/storage/errorCode.ts`
  - `packages/core/src/domain/storage/events.ts`
  - `packages/core/src/domain/storage/ports/storedFileRepository.ts`
  - `packages/core/src/domain/storage/storedFile.ts`
  - `packages/core/src/domain/usage/errorCode.ts`
  - `packages/core/src/domain/usage/events.ts`
  - `packages/core/src/domain/usage/llmUsage.ts`
  - `packages/core/src/domain/usage/ports/llmUsageRepository.ts`
  - `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`
  - `packages/core/src/domain/usage/services/quotaEnforcement.ts`
  - `packages/core/src/domain/usage/storageQuota.ts`
  - `packages/core/src/domain/usage/valueObject.ts`
