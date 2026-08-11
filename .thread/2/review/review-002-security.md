# レビュー 002 — Security

対象: PR #17 / `issue/2/account-management-and-auth`（ベース `main`、変更 250 ファイル）
観点: 認証・認可 / 列挙耐性 / トークン / セッション / OAuth / dev IdP / 削除 ticket / アップロード / CSRF / 暗号

## Security

### 実機で確認したこと（コードリーディングだけで済ませていない項目）

`pnpm build` 済みの `apps/web/dist` に対して `scripts/listen.node.ts` を起動し、以下を実測した。

- **dev IdP の production ガードは `pnpm start` 経路で実際に発火する。** `listen.node.ts:20` の `process.env.NODE_ENV ??= "production"` が dotenv より前に走るため、`.env` の `OAUTH_DEV_MODE=true` は起動時に `ZodError`（`OAUTH_DEV_MODE=true cannot be combined with NODE_ENV=production`）で落ちる。`readNodeServerEnv` は `process.env` オブジェクトごと受け取るので vite の `process.env.NODE_ENV` 畳み込みに影響されず、ランタイム env を読む。
- **`/dev/oauth/authorize` は production 配備で 404。** Google 資格情報 + `OAUTH_DEV_MODE=false` で起動し、正規のクエリー付きで GET → `404`。
- **Cookie の `Secure` は production ビルドで固定 `true`。** `dist/server/rsc/assets/session-*.js` で `var isProduction = () => true;` に畳み込まれており、`oauthStateCookie` も同じ。
- **CSRF ミドルウェアは効いている。** server function エンドポイントへ `Origin` なし / `Origin: https://evil.test` で POST → いずれも `403 Forbidden`、同一 Origin のみ通過。
- **`/storage/$` はパストラバーサルしない。** `../../../etc/passwd`、`users/x/avatar/../../../../etc/passwd`、`%2e%2e%2f…` いずれも `404`。`purpose !== "avatar"` の鍵（`users/x/source/y.txt`）も `404`。

主要な防御線（Cookie 束縛による OAuth login CSRF 対策 / ticket の HMAC と one-operation 制約 / `assertWritable`+`assertActorWritable` の 2 本 / scrypt + `timingSafeEqual` / 256bit CSPRNG トークンの SHA-256 保存 / `authEpoch` による O(1) 一括失効）はいずれも正しく組まれており、**要求本文の `userId` を主体として信用している server function は 1 本も無かった**（`/settings/-action.tsx` は全ハンドラーが `requireSession()` を通し、`storeAvatar` は `subjectId` にセッションの `userId` を積む）。`serverData` は RPC スタブを作らない素の関数なので、`userId` 引数を持っていても転送境界にはならない。

#### Blockers

なし。

#### Warnings

- **[W-001]** OAuth 束縛 Cookie に破棄経路が 1 本しか無く、失敗・キャンセル・中断では 10 分間残る
  - 場所: `apps/web/app/presentation/oauthStateCookie.ts:51`, `apps/web/app/routes/auth/-action.tsx:76,81`
  - 理由: `clearOAuthStateCookie()` は `completeOAuthCallbackFn` の**成功パスからしか**呼ばれない。プロバイダーが `error=access_denied` を返した場合（`OAuthCallbackPanel` は POST を出さない）、交換が失敗した場合、利用者が同意画面を閉じた場合のいずれでも `hollow_oauth_state`（`Path=/`）が `OAUTH_STATE_TTL_MS` = 10 分残る。結果として (a) 2 つ目のフローを開始すると Cookie が上書きされ、1 つ目のコールバックは恒久的に `OAUTH_STATE_INVALID` になる（2 タブ・戻るボタン後の再試行という現実的な操作で壊れる）、(b) 束縛照合は `oauthStateStore.take()` **より前**に落ちるので、その `state` 行は消費されずに TTL まで生き残る — one-shot 性が「1 回だけ」から「TTL 内なら開始ブラウザーから何度でも」に緩む。`state` は 256bit CSPRNG で推測不能なので直ちに悪用可能ではないが、束縛 Cookie のライフサイクルとしては 3 経路（生成・照合・破棄）のうち破棄だけが片肺。
  - 提案: `completeOAuthCallbackFn` のハンドラーを `try/finally` にして照合を通った時点で必ず破棄する（束縛の役目は `take` の直前で終わる）。あわせて `OAuthCallbackPanel` の `cancelled` / `failed` 遷移でも破棄用の server function を叩くか、少なくとも `state` を `take` してから投げる形に寄せて、失敗時にも one-shot を成立させる。

- **[W-002]** この PR で最も重要な 2 つの不変条件（束縛の配線・dev ルートの 404）に、振る舞いを守るテストが無い
  - 場所: `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts:53-58`
  - 理由: `oauthStateBinding.test.ts` は純関数（ハッシュの決定性・不一致・Cookie 不在）を丁寧に検証しているが、**「`startOAuthSignInFn` / `startOAuthLinkFn` が Cookie を焼く」「`completeOAuthCallbackFn` が `completeOAuthCallback` より先に `assertOAuthStateCookie` を通す」という配線そのものは 1 行もテストされていない**。この 2 行を消しても全テストが緑のまま通る。`assertOAuthStateCookie` の JSDoc が「ユースケースを呼ぶ前に通すこと」と警告しているのは、まさにこの順序が壊れやすいからで、順序が壊れた瞬間に login CSRF が復活する。`/dev/oauth/authorize` の 404 ガードも同様で、DI テストが自ら「ルート loader が偽で `notFound()` を投げる 1 行はコード確認に留まる」と明記している（今回は実機で 404 を確認したが、回帰は誰も検出しない）。
  - 提案: `oauthStateCookie` / `session` をモックした薄いハンドラーテストを 1 本置き、(1) 開始 fn が `setOAuthStateCookie` を呼ぶ、(2) 束縛が不一致なら `oauthStateStore.take` が **呼ばれない**（呼び出し順序の検証）、の 2 点だけ固定する。dev ルートは loader を直接呼んで `notFound` が投げられることを検証すれば足りる。

- **[W-003]** アバターアップロードの上限検査は multipart を全量メモリに展開した**後**に走り、その手前に本文サイズの上限が無い
  - 場所: `apps/web/app/routes/settings/-action.tsx:155-174`, `apps/web/scripts/listen.node.ts:142-164`
  - 理由: `validator` は `input instanceof FormData ? input.get("file") : undefined` で受けるため、`file.size <= AVATAR_UPLOAD_MAX_BYTES`（8 MB）の判定に到達した時点でフレームワークは本文全体を `File` に実体化し終えている。`listen.node.ts` の fetch ラッパーにも `server.node.ts` にも本文サイズの上限が無く、`@hono/node-server` も既定では制限しない。CSRF ミドルウェアが見るのは `Origin` ヘッダーだけなので、`Origin: https://<app>` を手で付けた**未認証**のクライアント（`requireSession()` は validator の後）が数百 MB の multipart を投げ、プロセスにそれを丸ごとバッファさせられる。単一プロセスにリクエスト平面とワーカー平面（削除の継続駆動を含む）が同居する Node ランタイムでは、これが落ちると進行中のアカウント削除も止まる。
  - 提案: fetch ハンドラーの手前で `Content-Length` / ストリーム長の上限（例: 12 MB）を切って `413` を返す。`AVATAR_UPLOAD_MAX_BYTES` はドメイン側の 5 MB を越えた分をきれいなエラーに落とすための「二段目」として残してよい。

- **[W-004]** アバターの配信が `public, max-age=31536000, immutable` なので、アカウント削除後も最大 1 年キャッシュから読める
  - 場所: `apps/web/app/routes/storage.$.tsx:43-54`
  - 理由: P-25 は「アイコンなどのアップロード済みファイル」を削除対象として利用者に約束し、実際 `deleteFilesByOwner` → `storage.fileDeleted` → `deleteStoredObjects` でオリジンからは消える。しかし応答が `Cache-Control: public` かつ 1 年 immutable なので、前段に CDN / 共有プロキシがある配備では削除済み利用者の顔写真が最長 1 年間その URL で取得可能なまま残る。鍵は UUIDv7 由来で推測不能だが、URL は公開ページや他人のブラウザー履歴に残りうるので「知っている人には消えていない」。あわせて `Content-Disposition` が無く、`nosniff` + CSP sandbox + マジックバイト由来の MIME で実害は塞がれているものの、防御が 1 枚薄い。
  - 提案: `private` に倒す（鍵が不変なのでブラウザーキャッシュだけでも効果は同じ）か、`max-age` を数分〜数時間にして削除が伝播する窓を作る。あわせて `Content-Disposition: inline; filename="…"` を付ける。

- **[W-005]** `recalculateStorageUsage` は subject と actor を結ぶ認可を一切持たない
  - 場所: `packages/core/src/application/usage/recalculateStorageUsage.ts:33-55`
  - 理由: 入力は `userId`（actor）と `subjectType` / `subjectId`（対象）で、対象側の scope で `assertWritable()` と `assertActorWritable(actorUserId)` を呼ぶだけ。この 2 本が見るのは「その scope が削除 barrier で閉じていないか」「その actor が解除準備でロックされていないか」であって、**actor がその subject を操作してよいか**は誰も確かめていない。`subjectType: "user"` で他人の `subjectId` を渡せば、他人の scope の `storage_quota` 行を書き換えられる（`storeAvatar` は同じ位置に `input.subjectId !== userId` の判定を持っている — つまり本来あるべき形は隣に実装済み）。現在この UC を呼ぶ server function は存在しないので**到達不能**であり Blocker にはしないが、JSDoc が「`userId` is the actor, not the subject」と明言して呼び出し側に subject の自由を与えているため、#3 / #6 で転送境界に露出した瞬間にクロス scope write になる。
  - 提案: `subjectType === "user"` のときは `subjectId === userId` を要求し（`storeAvatar` と同じ `BusinessRuleError(InsufficientRole)`）、workspace 主体は `WorkspaceAuthorization` が入るまで `storeAvatar` と同様に拒否する。

- **[W-006]** Google の `id_token` を `iss` / `aud` / `exp` を検証せずに読んでいる
  - 場所: `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts:47-79`
  - 理由: JSDoc は「OIDC Core §3.1.3.7 が署名検証の省略を認める唯一のケース」と説明していて、その主張自体は正しい。しかし §3.1.3.7 が省略を認めているのは**署名検証だけ**で、`iss` の一致・`aud` に自分の `client_id` が含まれること・`exp` は依然として必須の検証項目である。現状 `sub` と `email` の型しか見ておらず、`claims.sub` をそのまま `providerAccountId` に、`claims.email` をそのまま自動リンクの鍵にしている。TLS 越しに自分の `client_secret` で叩いたトークンエンドポイントの応答なので実運用上のリスクはほぼ無い（だから Blocker ではない）が、「provider account id とメールアドレスは identity の一意鍵そのもの」という位置づけの値を、プロバイダー応答の形式検証だけで受け入れている点は認証アダプターとしては薄い。
  - 提案: `iss` が `https://accounts.google.com` / `accounts.google.com` のいずれか、`aud` が `credentials.clientId` と一致、`exp` が未来であることの 3 点を `readIdTokenClaims` に足し、失敗は `SystemError(ExternalApiError)` に倒す。JSDoc も「署名検証のみ省略できる」と書き直す。

#### 確認したこと（指摘に至らなかったが検証した論点）

- **主体の取り方**: `/settings/-action.tsx` の 12 本すべてが `requireSession()` を通し、`userId` / `subjectId` / `currentSessionToken` を要求本文から取らない。`changePasswordFn` / `signOutOtherSessionsFn` は Cookie から `readSessionToken()` する（クライアントに送り返させない）。`removeIdentityFn` は `identityId` のみ受け、`removeIdentity` が `listByUserId(userId)` の中から探すので他人の identity は `IDENTITY_NOT_FOUND` に畳まれる。
- **`getDeletionStatusFn` だけがセッション非依存**だが、`operationId` は検証済み ticket からしか取らず（`readDeletionTicket` の戻り値のみ使用）、`getAccountDeletionStatus` は `findByOperationId` の読み取りビュー 1 本で列挙も走査も持たない。ticket の中身は `{o, e}` の 2 フィールドのみで、権限を広げる材料が入っていない（`deletionTicket.test.ts` が claims 全体の等値比較でこれを固定している）。期限は署名検証の**後**に見ており、鍵版は署名対象文字列に含まれるので差し替え不能。
- **OAuth 束縛**: `completeOAuthSignIn` / `linkOAuthIdentity` の単独エントリーポイントはどの server function にも配線されておらず、コールバックの入口は束縛照合を通る `completeOAuthCallbackFn` の 1 本だけ（grep で確認）。intent は `state` 行のみが決め、`flow.provider !== input.provider` も照合。`linkIdentity` は `userAuthEpoch` を UoW 内で再照合する。`redirectTo` は `SameOriginPolicy.isSameOriginPath`（`//`・`\`・C0 制御の 3 形を排除）を通り、`AvatarUrl` も同じ述語を共有する。dev IdP の `redirect_uri` はサーバー側で appUrl オリジンに限定（`devOAuth.test.ts` が外部オリジン・非 URL を検証）。PKCE は両アダプター共通の S256 純関数で、dev アダプターも `codeChallenge` を検証する。
- **`email_verified`**: Google アダプターは `claims.email_verified === true` の厳密判定、`AccountLinkingPolicy.decide` は未確認なら既存利用者の状態によらず必ず `refuse`。`linkOAuthIdentity` が `emailVerified` を見ないのは、リンクの鍵が `providerAccountKey` であってメールアドレスに信頼を置いていないため正しい。
- **列挙耐性**: `resendVerificationEmail` / `requestPasswordReset` は全経路で同一の空成功、`signUpWithPassword` は `reserve` の `EMAIL_ALREADY_USED` まで decoy 応答に畳む。`hollow_pending_verification` は重複メールでも無条件に書かれる。エラー辞書に追加された文言に内部状態は出ていない。`checkHandleAvailability` はハンドルが公開 URL であることを根拠に許容されており、かつ認証必須。
- **秘密のログ出力**: `logServerError` は `kind` / `code` / `message` / `cause` のみで、`toSerialized()` は `cause` を含まないためクライアントにも出ない。値オブジェクトの例外メッセージに入力値は入らない（`PlainPassword` は固定文言）。`MEMORY_MAIL_LOG_ACTION_URL` は既定 off で、`.env.example` が「ログを読めた者はアカウントを乗っ取れる」と明記。新規イベント payload にメールアドレスは無い。
- **暗号**: scrypt N=16384/r=8/p=1、保存ハッシュ由来のパラメーターに上限、比較は `timingSafeEqual`。トークンは `randomBytes(32)` + SHA-256 保存で locator 単独では認証不能。ticket は HMAC-SHA-256 で版付き鍵リング、鍵は composition root 供給（`DELETION_TICKET_KEY` は設定時のみ長さ検証、未設定はプロセス毎ランダム）。
- **一意性の解放**: `beginRelease` は行が別 user のものなら no-op（memory 実装で確認）、`release` は `reserved` / `releasing` のみ削除して `active` を消さない。`reservationOperationId` の合成規則にセグメント衝突は作れない。
- **計画に記録済みの縮退 2 件**は今回も同じ形で残っていることを確認した（`addPasswordIdentity` が再認証を求めない＝`.thread/2/plan.md:141`、認証系メールの応答時間を等時化していない＝同 142 / Issue #18）。どちらも契約上宣言済みなので新規指摘としては挙げない。
- **弁明・修正経緯の残留**: コード・コメントを走査したが、レビュー指摘への言い訳やラウンドの経緯を記した記述は見つからなかった。

#### カバレッジ

確認（100 件）:

`.thread/2/plan.md`,
`apps/web/.env.example`,
`apps/web/app/components/auth/OAuthButton/index.tsx`,
`apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`,
`apps/web/app/components/auth/ResendVerificationForm/action.ts`,
`apps/web/app/components/auth/ResetPasswordPanel/action.ts`,
`apps/web/app/components/auth/ResetPasswordPanel/index.tsx`,
`apps/web/app/components/auth/SignInForm/index.tsx`,
`apps/web/app/components/auth/SignUpForm/index.tsx`,
`apps/web/app/components/auth/schema.ts`,
`apps/web/app/components/dev/DevConsentForm/index.tsx`,
`apps/web/app/components/layout/AccountMenu/action.ts`,
`apps/web/app/components/layout/AccountMenu/index.tsx`,
`apps/web/app/components/settings/DeleteAccountPanel/index.tsx`,
`apps/web/app/components/settings/IdentityList/action.ts`,
`apps/web/app/components/settings/IdentityList/index.tsx`,
`apps/web/app/components/settings/ProfileForm/action.ts`,
`apps/web/app/components/settings/ProfileForm/editor.tsx`,
`apps/web/app/components/settings/ProfileForm/index.tsx`,
`apps/web/app/components/settings/UsagePanel/action.ts`,
`apps/web/app/components/settings/UsagePanel/index.tsx`,
`apps/web/app/presentation/__tests__/deletionTicket.test.ts`,
`apps/web/app/presentation/__tests__/devOAuth.test.ts`,
`apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`,
`apps/web/app/presentation/deletionTicket.ts`,
`apps/web/app/presentation/devOAuth.ts`,
`apps/web/app/presentation/errorDisplay.ts`,
`apps/web/app/presentation/oauthStateBinding.ts`,
`apps/web/app/presentation/oauthStateCookie.ts`,
`apps/web/app/routes/__root.tsx`,
`apps/web/app/routes/auth/-action.tsx`,
`apps/web/app/routes/auth/callback.$provider.tsx`,
`apps/web/app/routes/dev/-action.tsx`,
`apps/web/app/routes/dev/oauth/authorize.tsx`,
`apps/web/app/routes/reset-password.tsx`,
`apps/web/app/routes/settings/-action.tsx`,
`apps/web/app/routes/settings/auth.tsx`,
`apps/web/app/routes/settings/danger.tsx`,
`apps/web/app/routes/settings/index.tsx`,
`apps/web/app/routes/settings/profile.tsx`,
`apps/web/app/routes/settings/route.tsx`,
`apps/web/app/routes/settings/usage.tsx`,
`apps/web/app/routes/storage.$.tsx`,
`apps/web/app/server.node.ts`,
`apps/web/app/worker/node/runner.ts`,
`apps/web/scripts/listen.node.ts`,
`packages/core/src/adapters/memory/objectStorage.ts`,
`packages/core/src/adapters/memory/repositories/distributedOperationStore.ts`,
`packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`,
`packages/core/src/adapters/memory/repositories/scopeCleanupAdmissionStore.ts`,
`packages/core/src/adapters/oauth/devSignInOAuthClient.ts`,
`packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`,
`packages/core/src/adapters/oauth/pkce.ts`,
`packages/core/src/adapters/oauth/signInOAuthClient.ts`,
`packages/core/src/application/cleanup/participants.ts`,
`packages/core/src/application/di/__tests__/serverNode.test.ts`,
`packages/core/src/application/di/memoryRuntime.ts`,
`packages/core/src/application/di/serverNode.ts`,
`packages/core/src/application/di/types.ts`,
`packages/core/src/application/identity/addPasswordIdentity.ts`,
`packages/core/src/application/identity/authResidueCleanup.ts`,
`packages/core/src/application/identity/changePassword.ts`,
`packages/core/src/application/identity/checkHandleAvailability.ts`,
`packages/core/src/application/identity/completeOAuthCallback.ts`,
`packages/core/src/application/identity/completeOAuthSignIn.ts`,
`packages/core/src/application/identity/deleteAccount/admission.ts`,
`packages/core/src/application/identity/deleteAccount/globalCleanup.ts`,
`packages/core/src/application/identity/deleteAccount/input.ts`,
`packages/core/src/application/identity/getAccountDeletionStatus.ts`,
`packages/core/src/application/identity/getProfile.ts`,
`packages/core/src/application/identity/identityRemovalRelease.ts`,
`packages/core/src/application/identity/linkOAuthIdentity.ts`,
`packages/core/src/application/identity/listIdentities.ts`,
`packages/core/src/application/identity/pruneExpiredAuthState.ts`,
`packages/core/src/application/identity/removeIdentity.ts`,
`packages/core/src/application/identity/requestPasswordReset.ts`,
`packages/core/src/application/identity/resendVerificationEmail.ts`,
`packages/core/src/application/identity/resetPassword.ts`,
`packages/core/src/application/identity/signOut.ts`,
`packages/core/src/application/identity/signOutOtherSessions.ts`,
`packages/core/src/application/identity/startOAuthFlow.ts`,
`packages/core/src/application/identity/uniqueness.ts`,
`packages/core/src/application/identity/updateProfile.ts`,
`packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`,
`packages/core/src/application/storage/deleteFiles.ts`,
`packages/core/src/application/storage/deleteFilesByOwner.ts`,
`packages/core/src/application/storage/deleteStoredObjects.ts`,
`packages/core/src/application/storage/storeAvatar.ts`,
`packages/core/src/application/usage/deleteQuota.ts`,
`packages/core/src/application/usage/getUsageSnapshot.ts`,
`packages/core/src/application/usage/recalculateStorageUsage.ts`,
`packages/core/src/application/workers/eventRelayWorker.ts`,
`packages/core/src/application/workers/subscribers.ts`,
`packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`,
`packages/core/src/domain/identity/services/identityPolicy.ts`,
`packages/core/src/domain/identity/services/sameOriginPolicy.ts`,
`packages/core/src/domain/identity/valueObject.ts`,
`packages/core/src/domain/storage/events.ts`,
`packages/core/src/domain/storage/services/uploadValidationPolicy.ts`,
`packages/core/src/domain/storage/valueObject.ts`

差分外だが判断に使った参照: `apps/web/app/start.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/serverAction.ts`, `apps/web/app/presentation/validator.ts`, `apps/web/app/presentation/serverErrorLog.ts`, `packages/core/src/adapters/memory/passwordHasher.ts`, `packages/core/src/adapters/memory/secureTokenGenerator.ts`, `packages/core/src/adapters/memory/mailSender.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/domain/identity/services/accountLinkingPolicy.ts`, `packages/core/src/application/identity/signUpWithPassword.ts`, `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/lib/error.ts`, `packages/core/src/application/errors.ts`, ビルド成果物 `apps/web/dist/server/**`

スキップ（150 件）:

- `.thread/2/adr.md`, `.thread/2/progress.md`, `.thread/2/steps.md`, `.thread/2/testing.md`, `.thread/2/review/review-001-adapter.md`, `.thread/2/review/review-001-domain-usecase.md`, `.thread/2/review/review-001-frontend.md`, `.thread/2/review/review-001-security.md`, `.thread/2/review/review-001-test.md`, `.thread/2/review/review-001.md`, `.thread/2/review/triage.md`（11 件）— 前回ラウンドの記録・計画補助文書で、ゼロベース指示によりコードの検証対象外
- `apps/web/app/components/auth/ResendVerificationForm/index.tsx`, `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`, `apps/web/app/components/layout/AppShell/index.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`, `apps/web/app/components/settings/AddPasswordForm/index.tsx`, `apps/web/app/components/settings/ChangePasswordForm/index.tsx`, `apps/web/app/components/settings/IdentityList/board.tsx`, `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`, `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`, `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`, `apps/web/app/components/settings/panelStyles.ts`（11 件）— 表示・入力の島とスケルトン / スタイル定数。認可判断も秘密の取り扱いも持たず、対応する server function 側（`-action` 群）で境界を確認済み
- `apps/web/app/routeTree.gen.ts`, `apps/web/app/routes/notes/index.tsx`（2 件）— 自動生成のルート木と、本 PR では導線追加のみのノート一覧
- `docs/runtime_node.md`（1 件）— 運用ドキュメント（ガードの実挙動は実機で直接確認したため文書は検証源にしない）
- `packages/core/src/adapters/conformance/**` 16 件 + `packages/core/src/adapters/memory/__tests__/conformance.test.ts` / `conformanceBackend.ts` / `globalUnitOfWork.ts`（計 19 件、変更一覧 72〜90 行）— ポート適合スイートと UoW 配線。契約の網羅性はアダプター観点の担当で、セキュリティ判断に効く 2 点（`beginRelease` の所有者一致、`assertActorWritable` の barrier 判定）は memory 実装本体で直接確認済み
- `packages/core/src/adapters/memory/repositories/{accountDeletionManifestStore,appliedOperationStore,authTokenRepository,identityRemovalReceiptStore,llmUsageRepository,noteProjection,outboxRepository,scopeTaskScheduler,storageQuotaRepository,storedFileRepository}.ts`, `packages/core/src/adapters/memory/{scopeTaskQueue,scopeUnitOfWork,store}.ts`（13 件）— 参照実装のストレージ層。鍵・トークン・認可判断を持たない CRUD で、秘密を扱う 3 本（`passwordHasher` / `secureTokenGenerator` / `oauthStateStore`）は差分外だが別途確認した
- `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`, `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts`（2 件）— アダプター適合テスト（AC-6 の skip 条件はテスト観点の担当）
- `packages/core/src/application/__tests__/helpers.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/execution/__tests__/eventId.test.ts`, `packages/core/src/application/execution/eventId.ts`, `packages/core/src/application/execution/unitOfWork.ts`（5 件）— テストハーネスと継続イベント ID の決定性・UoW 型。主体判定を持たず、削除の到達可能性はドメイン / ユースケース観点の担当
- `packages/core/src/application/identity/__tests__/**`（31 件、変更一覧 124〜154 行）— ユースケーステスト。セキュリティ観点で必要な「実効的テストの有無」は W-002 に集約した
- `packages/core/src/application/identity/continuations.ts`, `deleteAccount/{authorRedaction,cleanupDispatch,compaction,finalize,index,manifestBuild,terminalPrune}.ts`, `identity/eventDecoders.ts`（9 件）— 削除サガの内部段。外部入力を受けず、受理境界（`admission.ts`）と鍵解放（`globalCleanup.ts`）で信頼境界を確認済み
- `packages/core/src/application/identity/view.ts`, `packages/core/src/application/note/__tests__/createBlankNote.test.ts`（2 件）— DTO 射影（秘密フィールドを含まないことは各ユースケースの戻り値で確認済み）とノートのテスト
- `packages/core/src/application/ports/{accountDeletionManifestStore,appliedOperationStore,distributedOperationStore,identityRemovalReceiptStore,objectStorage,outboxRepository,scopeTaskQueue,scopeTaskScheduler,scopeTaskTrigger}.ts`（9 件）— ポート型定義。認可規約を持つ `scopeCleanupAdmissionStore` のみ確認対象に含めた
- `packages/core/src/application/storage/__tests__/{deleteFiles,deleteFilesByOwner,storeAvatar}.test.ts`（3 件）— ストレージのユースケーステスト
- `packages/core/src/application/storage/eventDecoders.ts`, `packages/core/src/application/storage/view.ts`（2 件）— イベント復号と DTO
- `packages/core/src/application/usage/__tests__/{deleteQuota,getUsageSnapshot,recalculateStorageUsage}.test.ts`（3 件）— 使用量のユースケーステスト
- `packages/core/src/application/usage/view.ts`（1 件）— DTO
- `packages/core/src/application/workers/__tests__/{outboxPrune,scopeTaskRunner,subscribers}.test.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`（4 件）— ワーカーの駆動とテスト。外部入力の境界ではなく、購読者レジストリ本体（`subscribers.ts`）は確認済み
- `packages/core/src/domain/common/event.ts`, `packages/core/src/domain/identity/__tests__/policies.test.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/{authTokenRepository,signInOAuthClient}.ts`, `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`（6 件）— イベント基底 / エラーコード列挙 / ポート型 / 到達不能な再試行ポリシー（計画に縮退として記録済み）
- `packages/core/src/domain/note/ports/{localNoteProjectionWriter,publicNoteProjectionWriter}.ts`, `packages/core/src/domain/storage/__tests__/storage.test.ts`, `packages/core/src/domain/storage/errorCode.ts`, `packages/core/src/domain/storage/ports/storedFileRepository.ts`, `packages/core/src/domain/storage/storedFile.ts`（6 件）— 投影ポート型・ドメイン単体テスト・エラーコード・集約。アップロード検証の要は `uploadValidationPolicy.ts` / `valueObject.ts` で確認済み
- `packages/core/src/domain/usage/**`（10 件、変更一覧 241〜250 行）— Usage ドメインの VO / 集約 / ポート / 単体テスト。認証・認可・秘密を扱わず、数量制限のドメイン規則はドメイン観点の担当
