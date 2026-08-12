# レビュー R9 — Security

対象: PR #17 / ブランチ `issue/2/account-management-and-auth` / ベース `main`
前提: `git status` クリーン（HEAD `e2004dd`）。配備時の挙動の主張は `pnpm build` を実行し直した `apps/web/dist` の成果物で確認した。

## Security

### Blockers

なし。

到達可能な認証・認可の穴、トークンの誤用、セッションの取り違え、dev IdP の production 漏れ、削除 ticket の権限拡大、アップロード経路の型・サイズ詐称、オープンリダイレクトはいずれも見つからなかった。成果物で否定した項目は「確認したが問題なしと判断した点」に列挙する。

### Warnings

- **[W-001]** `requestPasswordReset` の `passwordResetUnavailable` 分岐だけ発行間隔の判定を通らず、未認証の攻撃者が任意回数のメール送信を起こせる / 場所: `packages/core/src/application/identity/requestPasswordReset.ts:61-78`（間隔判定は同ファイル `88-97` の Global UoW 内にしかない）/ 理由: `requestPasswordResetFn`（`apps/web/app/components/auth/ResetPasswordPanel/action.ts`）は未認証 POST で、CSRF ミドルウェアは攻撃者自身のスクリプトからの直接送信を止めない。攻撃者が「Google だけで登録している利用者のメールアドレス」を知っている場合（OAuth のみのアカウントは珍しくなく、住所自体は名刺・GitHub・過去の漏洩などから容易に得られる）、`{ email }` を投げるたびに `IdentityPolicy.findPassword(identities) === null` の分岐へ入り、`mailSender.send({ kind: "passwordResetUnavailable" })` が**毎回**走る。トークン発行側は `findPendingByUserAndPurpose` + `REQUEST_INTERVAL_MS`（60 秒）で守られているのに、この分岐には対応する記録も判定も無いので、1 秒間に数百通の案内メールを被害者の受信箱へ流し込める（mail bombing、送信ドメインのレピュテーション毀損、送信従量課金の増大）。`spec/usecases/identity.md#requestpasswordreset` のエラー表は「レート制限 → 何もせず成功として返す」を要求しており、実装はその要求を片方の分岐でしか満たしていない。テスト側も `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts` の TC-identity-192（`throttles a second request inside the interval`）がトークン分岐だけを固定していて、TC-identity-188（案内メール）には連投のケースが無いため、この非対称は自動テストで守られていない。**現配備の実害はログ止まり**（`MailSender` が memory のままという記録済みの縮退）だが、実 `MailSender` を挿した時点で有効になる。/ 提案: 案内メール経路にも「直近送信からの最小間隔」を掛ける。ただし現在この分岐には利用者ごとの送信記録が無く（`AuthToken` を作らないことが TC-identity-188 の期待結果なので、トークン行を間隔マーカーに流用するのは筋が悪い）、正しい形は「認証系メールの送信間隔を経路によらず一律にする」横断的関心事になる。既に同じ 2 経路の**応答時間**の等時化が Issue #18 へ送られているので、**#18 に「送信間隔も全経路一律（案内メールを含む）」を追記して同じ変更でまとめて閉じる**のが素直。本 Issue で閉じないなら、少なくとも progress.md の縮退節に「案内メール経路は無制限」を 1 行足して、実 `MailSender` を入れるスライスが必ず拾えるようにすること。

## 確認したが問題なしと判断した点（再指摘の抑制のため記録）

成果物・コードで否定した経路を残す。次ラウンドはここを再掘りしないこと。

- **`isDevelopment()` の畳み込み**: 再ビルドした `apps/web/dist/server/rsc/assets/oauthStateCookie-odwS_pPs.js` は `var isDevelopment = () => false;` になっており、`process.env.NODE_ENV` は `apps/web/dist` 全体に 1 箇所も残らない（`grep -rl 'process\.env\.NODE_ENV' apps/web/dist` が空）。session cookie 側も同じ chunk 構成。ADR-110 のとおり production 成果物で `Secure` は常に立つ。
- **dev IdP の production 漏れ**: `di/serverNode.ts:84-105` が `OAUTH_DEV_MODE=true` を `NODE_ENV === "development"` の allowlist でしか許さず、`scripts/listen.node.ts:14` が dotenv より前に `process.env.NODE_ENV ??= "production"` を宣言する。ルート `/dev/oauth/authorize` は `container.oauthDevMode`（`memoryRuntime.ts:225` = `oauth.mode === "dev"`）で 404 に倒れ、`submitDevConsentFn` も同じフラグで `NotFoundError` を投げる（ルート 404 を迂回して server function を直叩きしても承認コードは作れない）。`__root.tsx` が `@/routes/dev/-action` を無条件 import しているのは server function 登録のためで、ガードは実行時フラグ側にある。
- **削除 status ticket**: HMAC-SHA-256 / `crypto.subtle.verify`（定数時間比較）/ 期限は署名検証の**後**にだけ見る（`deletionTicket.ts:158-162`）/ claims は `operationId` と期限のみ / 鍵は composition root 供給（未設定時は `randomBytes(32)`、不正値は起動失敗）。`getDeletionStatusFn` は要求本文の `operationId` を一切見ず、検証済み ticket が返した値だけを `getAccountDeletionStatus` に渡すので、ticket が名指す 1 件以外は読めない。応答も `{ operationId, status }` だけ。`__tests__/deletionTicket.test.ts` の 7 ケース（claims 差し替え・失効後の偽造・別鍵・未知バージョン・非 ticket・30 分境界）が固定している。
- **OAuth 束縛 Cookie の運用**: `assertOAuthStateCookie` → `clearOAuthStateCookie` → usecase の順序で、照合はユースケースより前。照合前の `take` は起きない。破棄は束縛が一致した Cookie に限る（`clearBoundOAuthStateCookie`、ADR-099）。`__tests__/oauthStateBindingWiring.test.ts` が実 `Cookie` / `Set-Cookie` ヘッダーで 6 ケース固定していて、「照合前に state を消費しない」「他人の Cookie を捨てない」「成否によらず Cookie が残らない」が実効的に守られている。`sha256(state)` である点の限界は Issue #20 で決着済み。
- **PKCE / id_token**: 両アダプターが `deriveCodeChallengeS256`（RFC 7636 §4.2、43 文字 base64url）を共有し、認可 URL に `code_challenge_method=S256` を必ず載せる。Google の `readIdTokenClaims` は署名検証を省くが `iss` / `aud`（配列 aud も含む）/ `exp` を検証しており、トークンエンドポイントから TLS 直取得した応答である以上 OIDC Core §3.1.3.7 の許容範囲。`email_verified` は `AccountLinkingPolicy.decide` が「未確認なら常に拒否」で一次判定する。dev の承認コードは無署名だが、`codeChallenge` を封入して `exchangeCode` で verifier と突き合わせるので、コードを盗んでも verifier 無しでは使えない。
- **セッション / 一括失効**: `HttpOnly` / `SameSite=Lax` / `Path=/` / `Domain` 無し / `Expires` = 行の期限。`authenticateSession` は `status !== "active"` と epoch 不一致を等しく `UNAUTHENTICATED` に畳み、GET 経路では Cookie を書き換えない。`changePassword` / `resetPassword` / `signOutOtherSessions` / `deleteAccount` の 4 経路がすべて `User.advanceAuthEpoch` を最終 UoW 内で打ち、現セッションを残す経路だけ `refreshAuthEpoch` を同一 transaction で打つ。`signOut` は不在・不正トークンを区別しない。
- **主体の取り方**: `/settings/*` の server function はすべて `requireSession()` の戻り値から `userId` を取り、要求本文から主体を受け取らない（`renderIdentityList` / `renderProfileForm` / `renderUsagePanel` / `updateProfileFn` / `checkHandleAvailabilityFn` / `uploadAvatarFn` / `addPasswordFn` / `changePasswordFn` / `removeIdentityFn` / `startOAuthLinkFn` / `signOutOtherSessionsFn` / `deleteAccountFn`）。`getDeletionStatusFn` だけが例外で、その根拠は ticket。`startOAuthLinkFn` は intent を `linkIdentity` に、`startOAuthSignInFn` は `signIn` に固定していて、転送境界から intent を選べない。分岐根拠も `OAuthFlowState.intent` だけ（`completeOAuthCallback.ts:31-56`、`take` は原子的な get+delete）。
- **`assertWritable` / `assertActorWritable`**: `storeAvatar`（`storeAvatar.ts:97-98`）と `recalculateStorageUsage`（`recalculateStorageUsage.ts:64-65`）の 2 本とも呼んでいる。`storeAvatar` はバイト列を先に置くが、UoW が落ちれば `objectStorage.deleteMany` で巻き戻すので barrier 後の書き込みが残らない。両者を撃ち分けられないこと（`scope.actorLocks` を立てる経路が本 Issue に無い）は progress.md に記録済み。
- **アップロード**: MIME は申告値ではなくバイト署名（PNG / JPEG / RIFF+WEBP）で決め、サイズは `body.byteLength` で測る（`UploadValidationPolicy.ensureAcceptable`）。転送境界は 8 MB（DoS 上限、業務上限 5 MB より広いのは意図的）、`scripts/listen.node.ts` が本文 12 MB を宣言値/実長の両方で切る。`ObjectKey.create` は `..` と先頭 `/` を拒否し、`ObjectKey.build` はファイル名ではなく `fileId` で鍵を作るので、`data.file.name` はパスに入らない（`FileName.create` が制御文字 / `/` / `\` も `_` へ置換）。
- **配信ルート `/storage/$`**: `purposeOf(key) !== "avatar"` を 404 に倒して鍵空間の残りを塞ぎ、`Content-Type` は書き込み側がポリシーで確定した 3 種のみ、`X-Content-Type-Options: nosniff` と `Content-Security-Policy: sandbox; default-src 'none'`、`Cache-Control: private`（共有キャッシュに載せない）、`Content-Disposition` の filename は `[^A-Za-z0-9._-]` を除去。形式違反も不在も同じ 404。
- **オープンリダイレクト**: 復帰先は `SameOriginPolicy.isSameOriginPath`（`//` / `\` / C0 制御文字を全部落とす）を通した相対パスだけが `OAuthFlowState.redirectTo` に入り、`AvatarUrl.create` も同じ述語を共有する。dev IdP の `redirect_uri` は `resolveDevRedirectUri` が `appUrl` のオリジン一致を要求し、判定はクライアントに渡さない。`window.location.assign` に渡る値はすべてサーバー生成。
- **列挙耐性**: `resendVerificationEmail` / `requestPasswordReset` は全経路で同一の空成功（`UNIFORM_RESPONSE`）、`removeIdentity` は他人の identity を不在と同じ `IDENTITY_NOT_FOUND` に畳む、`signOut` は不在を区別しない、確認待ち Cookie は重複メールでも無条件に焼く。応答時間の非対称は Issue #18 で決着済み。
- **ログ**: `logger.*` の呼び出しをリポジトリ全体で洗った（`packages/core/src` + `apps/web/app`、47 箇所）。トークン・パスワード・セッション・ticket・メールアドレス・ハンドルを載せている箇所は無い。載っているのは `userId` / `operationId` / `authEpoch` / `objectKey` / `eventId` / `cause` で、`updateProfile` の handle を含む operationId は `handleReleaseOperationId` としてディレクトリ呼び出しの中に閉じている（同ファイルの JSDoc が明記）。
- **入力バリデーション 2 点 / DoS 上限**: 新設 server function の zod スキーマはすべて長さ上限つき（provider 32 / state 512 / code 4096 / token 512 / password `PASSWORD_MAX_LENGTH` / email 254 / handle 31 / avatarUrl 2048 / ticket 1024 / requestId 64 / identityId 128）。業務不変条件は値オブジェクト側にあり二重定義されていない。`requestId` の UUID 判定は `requireRequestId` が持つ。
- **CSRF**: `start.ts` が `createStart` で置き換わる既定の `requestMiddleware` に `createCsrfMiddleware` を明示再登録している。`signOutFn` は POST 限定（ADR-030）。GET の server function は読み取りのみで、状態変更 GET は無い。
- **弁明・経緯コメント**: 新規・変更ファイルのコメントに「レビュー指摘への対応」「R7 で直した」といった経緯記述は見当たらなかった。`identityRemovalRelease.ts` / `oauthStateBinding.ts` / `ports/scopeTaskScheduler.ts` の「閉じていない窓」の記述は、引き継ぎ先 Issue 番号つきの現時点の契約説明であり、残す価値のある why にあたる。

## カバレッジ

一覧 304 件 = **確認 101 件 + スキップ 203 件**。

### 確認（101 件）

**転送境界・presentation（35）**: `apps/web/.env.example`, `apps/web/app/presentation/{deletionTicket,devOAuth,errorDisplay,oauthStateBinding,oauthStateCookie,session,verificationSession}.ts`, `apps/web/app/presentation/__tests__/{deletionTicket,devOAuth,oauthStateBinding,oauthStateBindingWiring}.test.ts`, `apps/web/app/routes/{__root.tsx,reset-password.tsx,verify-email.tsx,storage.$.tsx}`, `apps/web/app/routes/auth/{-action.tsx,callback.$provider.tsx}`, `apps/web/app/routes/dev/{-action.tsx,oauth/authorize.tsx}`, `apps/web/app/routes/settings/{-action.tsx,route.tsx,index.tsx,auth.tsx,profile.tsx,usage.tsx,danger.tsx}`, `apps/web/app/server.node.ts`, `apps/web/scripts/listen.node.ts`, `apps/web/app/components/auth/{schema.ts,SignInForm/action.ts,SignInForm/index.tsx,SignUpForm/action.ts,SignUpForm/index.tsx,VerifyEmailPanel/action.ts,ResendVerificationForm/action.ts,ResetPasswordPanel/action.ts}`

**認可・秘密を扱うクライアント島（8）**: `apps/web/app/components/auth/{OAuthButton,OAuthCallbackPanel}/index.tsx`, `apps/web/app/components/dev/DevConsentForm/index.tsx`, `apps/web/app/components/layout/AccountMenu/{action.ts,index.tsx}`, `apps/web/app/components/settings/{DeleteAccountPanel/index.tsx,IdentityList/board.tsx,ProfileForm/editor.tsx}`

**サーバー側データ読み出し口（3）**: `apps/web/app/components/settings/{IdentityList,ProfileForm,UsagePanel}/action.ts`

**既存の XSS 経路の再確認（1）**: `apps/web/app/components/note/NoteBody/index.tsx`

**OAuth アダプター・composition root（8）**: `packages/core/src/adapters/oauth/{signInOAuthClient,googleSignInOAuthClient,devSignInOAuthClient,pkce}.ts`, `packages/core/src/adapters/memory/objectStorage.ts`, `packages/core/src/application/di/{serverNode,memoryRuntime,types}.ts`

**Identity ユースケース（26）**: `packages/core/src/application/identity/{startOAuthFlow,completeOAuthCallback,completeOAuthSignIn,linkOAuthIdentity,addPasswordIdentity,changePassword,resetPassword,requestPasswordReset,resendVerificationEmail,removeIdentity,identityRemovalRelease,listIdentities,getProfile,checkHandleAvailability,updateProfile,signOut,signOutOtherSessions,authResidueCleanup,getAccountDeletionStatus,pruneExpiredAuthState}.ts`, `packages/core/src/application/identity/deleteAccount/{index,input,admission,manifestBuild,globalCleanup,finalize}.ts`

**Storage / Usage / worker（8）**: `packages/core/src/application/storage/{storeAvatar,deleteFiles,deleteFilesByOwner,deleteStoredObjects}.ts`, `packages/core/src/application/usage/{getUsageSnapshot,recalculateStorageUsage}.ts`, `packages/core/src/application/workers/subscribers.ts`, `packages/core/src/application/cleanup/participants.ts`

**ドメイン（6）**: `packages/core/src/domain/identity/{valueObject.ts,user.ts,services/sameOriginPolicy.ts,services/identityPolicy.ts}`, `packages/core/src/domain/storage/{valueObject.ts,services/uploadValidationPolicy.ts}`

**テスト（1）**: `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`（W-001 の裏取り）

**契約（3）**: `.thread/2/plan.md`, `.thread/2/progress.md`, `.thread/2/adr.md`（決着済み判断の照合に参照）

### スキップ（203 件）

- `.thread/2/**` の過去レビュー記録・`steps.md` / `testing.md` / `triage.md`（**44 件**）— ゼロベース指示により未読。`plan.md` / `progress.md` / `adr.md` は確認側。
- `__tests__/` 配下のユースケース・ドメイン・ワーカーテストと `adapters/conformance/` の適合スイート（**70 件**）— Test 観点の担当。本観点が確認した挙動（ticket 署名・state 束縛・dev IdP ガード・一様応答・throttle）を守るテストだけを確認側に入れた。
- `docs/runtime_node.md`, `docs/test.md`, `vitest.config.ts`, `apps/web/app/routeTree.gen.ts`（**4 件**）— 運用ドキュメントと生成物。
- UI 島・スケルトン・スタイル・ページ（**17 件**）— `components/auth/{PasswordStrengthMeter/index.tsx,ResendVerificationForm/index.tsx,ResetPasswordPanel/index.tsx,VerifyEmailPanel/index.tsx,passwordStrength.ts}`, `components/layout/{AppShell,SettingsTabs}/index.tsx`, `components/settings/{AddPasswordForm,ChangePasswordForm,IdentityList,IdentityListSkeleton,ProfileForm,ProfileFormSkeleton,UsagePanel,UsagePanelSkeleton}/index.tsx`, `components/settings/panelStyles.ts`, `routes/notes/index.tsx` — 認可判断も秘密の運搬も持たず、呼び出す server function 側で確認済み。
- memory アダプター / UoW / store / Node ランナー（**18 件**）— `adapters/memory/{globalUnitOfWork,scopeUnitOfWork,scopeTaskQueue,store}.ts`, `adapters/memory/repositories/*`（13 件）, `apps/web/app/worker/node/runner.ts` — Adapter 観点の担当。認可・トークン判断を持たない永続化／駆動実装で、ログの PII は横断 sweep 側で確認済み。
- ポート定義（**20 件**）— `application/ports/*`（10 件）, `domain/identity/ports/*`（3 件）, `domain/note/ports/*`（4 件）, `domain/storage/ports/storedFileRepository.ts`, `domain/usage/ports/*`（2 件）— 型と JSDoc のみ。
- ドメイン本体・VO・イベント・エラーコード（**13 件**）— `domain/common/event.ts`, `domain/identity/{errorCode.ts,services/accountDeletionRetryPolicy.ts}`, `domain/note/valueObject.ts`, `domain/storage/{errorCode,events,storedFile}.ts`, `domain/usage/{errorCode,events,llmUsage,storageQuota,valueObject,services/quotaEnforcement}.ts` — Domain 観点の担当。認証・認可の判断を持たない。
- ワーカー平面の内部・削除オーケストレーションの継続処理・DTO（**17 件**）— `application/cleanup/personalCleanup.ts`, `application/execution/{eventId,unitOfWork}.ts`, `application/identity/{continuations,eventDecoders,uniqueness,view}.ts`, `application/identity/deleteAccount/{authorRedaction,cleanupDispatch,compaction,terminalPrune}.ts`, `application/storage/{eventDecoders,view}.ts`, `application/usage/{deleteQuota,view}.ts`, `application/workers/{eventRelayWorker,scopeTaskRunner}.ts` — 転送境界から主体入力を受け取らずワーカー平面からのみ到達する。入口（`deleteAccount/index.ts` が `userRequest` variant しか受けないこと）と出口（`subscribers.ts` のレジストリ、`participants.ts` の宣言集合）を確認側で押さえた。
