# Review 001 — PR #12 (issue/1/account-to-blank-note-skeleton)

### Security

#### Blockers

なし

AC-15 のコア要件は満たされている:

- Cookie 属性: `HttpOnly` / `SameSite=Lax` / `Path=/` / `Expires = now + Session.ttlMs`、`Secure` は production のみ（dev http の縮退は plan.md「縮退の記録」に明記済み） — `apps/web/app/presentation/session.ts:31-48`
- CSRF 規律: ミューテーション（signUp / signIn / verifyEmail / signOut / createBlankNote）はすべて JSON POST の server function。`FormData` を受ける経路は存在せず、状態変更 GET もない。verify-email は GET が描画のみ・トークン消費はマウント後の POST（ADR-007 どおり） — `apps/web/app/routes/verify-email.tsx` + `VerifyEmailPanel`。signOut も POST 限定でコメントに理由あり — `AccountMenu/action.ts`
- 読み取り GET（`sessionUserFn` / `renderNoteList` / `renderNoteDetail`）は完全に read-only。`requireSession` は不正 Cookie を GET で消さない設計コメントつき — `presentation/session.ts:60-79`
- オープンリダイレクト: `safeRedirectPath` が `/` 始まり・`//` 拒否・`\` 拒否で同一オリジンパスに限定。`/signin?redirect=` の消費側もこの関数を通す — `presentation/auth.ts:23-33`, `routes/signin.tsx:43`
- ステータスマッピング: `UNAUTHENTICATED`→401 / `THROTTLED|LOCKED|RATE_LIMITED`→429 / `NOTE_GONE`→410 — `presentation/errorResponse.ts:117-129`
- 認証失敗の共通文言: 未登録・パスワード不一致・削除済みが `INVALID_CREDENTIALS` に収斂（応答形状も同一）。`EMAIL_NOT_VERIFIED` / `ACCOUNT_DELETING` の分離は正しいパスワード検証成功後のみ露出 — `signInWithPassword.ts:119-132`。サインアップの登録済みメールも decoy userId で応答同一 — `signUpWithPassword.ts:74-95`
- スロットル/ロック: 事前 `evaluate` ゲート → 失敗時 atomic `recordFailure` → 再評価で THROTTLED/LOCKED へ昇格。`login_attempts` は UoW 外、書き込み失敗は判定を変えずログのみ — `signInWithPassword.ts:84-89,168-192`
- トークン取り扱い: セッション/確認トークンはサーバー側 SHA-256 ハッシュのみ保存、パスワードは scrypt(N=16384,r=8,p=1) + salt + `timingSafeEqual`、共有トークンは AES-256-GCM 版つき鍵束。確認メール URL 以外のトークンのログ出力なし（`mail.sent` の actionUrl は dev 用 in-memory MailSender の意図された挙動）
- セキュリティヘッダー: `X-Content-Type-Options: nosniff` / `Referrer-Policy: strict-origin-when-cross-origin` / CSP（frame-ancestors / form-action / object-src / base-uri）を既定応答に敷設 — `server.node.ts:50-70`。script-src の絞り込みは公開閲覧スライスへ意図的に先送り（コメントあり）
- 認可: `getNote` は route→scope→`NoteAccessPolicy.evaluate` で、不在・他人の非公開・権限なしが `NOTE_NOT_FOUND` に収斂。ゴミ箱は所有権パスのみ到達可。`shareUrl` の復号は `canChangeVisibility` かつ unlisted のみ — `application/note/getNote.ts`, `domain/note/services/noteAccessPolicy.ts`
- DoS 面: transport 境界の zod（email≤254 / password≤128 / displayName≤50 / token≤512 / noteId≤128 / redirect≤2048）、`listNotes` の limit clamp（≤100）が揃っている

#### Warnings

- **[W-001]** RSC ストリーミング断片のエラーが redaction boundary を通らない — 場所: `apps/web/app/routes/notes/-action.tsx:12-43` / `apps/web/app/presentation/errorResponseMiddleware.ts:27-51` / 理由: `renderNoteList` / `renderNoteDetail` は unresolved promise を返すため、`errorResponseMiddleware` はハンドラー戻り時点で終了しており、ストリーム中に reject した断片エラー（例: `SystemError` の内部 message、`accessControl.ts` の `WorkspaceAuthorization.* is not implemented` など）は `redactForClient` を経ずに Flight/seroval のシリアライズへ落ちる。UI は `ServerErrorState` で message を出さないが、ワイヤ上のペイロードに内部文言が乗り得るし、`logServerError` によるサーバー側記録も行われない。CLAUDE.md の「single redaction boundary」契約に対する穴。/ 提案: 断片コンポーネント（`NoteDetail` の catch と同様の位置）で system/unknown を捕捉して redacted な `AppServerError` に詰め替える共通ラッパーを敷くか、Deferred 経路のエラー変換を presentation に 1 か所用意する。少なくとも dev/production それぞれで実ペイロードを確認して記録すること。
- **[W-002]** ShareTokenProtector の鍵束がリクエストごとに新造される — 場所: `packages/core/src/application/di/memoryRuntime.ts:62-65,134-136` / 理由: `createRequestContainer` の `shareTokenKeyRing ?? ephemeralKeyRing()` は呼び出しごとに評価され、`server.node.ts` はリクエスト単位で request container を作るため、同じ「version 1」に毎回別の AES 鍵が割り当たる。あるリクエストで `protect` した値は別リクエストの `reveal` で必ず `SystemError(DataIntegrityError)` になる。本スライスでは `protect` を呼ぶ live 経路（makeUnlisted 系 UC）が未実装のため実害は潜在的だが、「版→鍵の写像」（spec/presentation/index.md）という鍵管理契約の破れであり、共有スライスが載った瞬間に顕在化する。/ 提案: 鍵束の生成を `createMemoryRuntime` 側（backend と同じ寿命）へ移し、request container はそれを共有する。
- **[W-003]** サインインのタイミング差でユーザー列挙が可能 — 場所: `packages/core/src/application/identity/signInWithPassword.ts:95-117` / 理由: 未登録メール・パスワード identity なしの場合は scrypt `verify`（数十 ms 級）を実行せず即 false になるため、応答文言を共通化していても応答時間で「登録済みかどうか」が識別できる。サインアップ応答の同一化（decoy userId まで作る徹底ぶり）と非対称。/ 提案: 該当分岐でダミーハッシュに対する `verify` を 1 回実行して所要時間を揃える（定番の dummy-hash 対策）。スロットルが試行回数自体は抑えるため優先度は中。
- **[W-004]** scrypt verify が保存ハッシュ由来のコストパラメータを無制限に受け入れる — 場所: `packages/core/src/adapters/memory/passwordHasher.ts:71-87` / 理由: `N` / `r` / `p` は整数チェックのみで上限がなく、`maxmem` も `128*n*r*2` と入力に比例して伸びる。ハッシュ文字列は自前の `hash()` しか書かないため通常経路では到達しないが、DB 内容を前提に検証する defense-in-depth としては、改竄・移行事故時に 1 レコードで巨大メモリ確保/CPU 消費が起きる形。salt 長の検証もない。/ 提案: `N ≤ 2^17`・`r ≤ 16`・`p ≤ 4`・salt 長一致程度の上限ガードを入れ、範囲外は `false` を返す。

#### カバレッジ

変更ファイル一覧（376 行、`scratchpad/changed-files.txt`）との対応。D（削除）は削除の事実のみ確認し内容レビュー対象外。

確認（読解または diff 精査）:

- `.thread/1/plan.md`（契約・AC-15 / 縮退記録）、`spec/presentation/index.md`（Cookie 属性・CSRF・ヘッダー・429 系の該当節）
- `apps/web/app/presentation/`: `auth.ts` / `session.ts` / `clientKey.ts` / `validator.ts` / `errorResponse.ts` / `errorResponseMiddleware.ts` / `appServerErrorAdapter.ts`(diff) / `pagination.ts`(diff)、既存の `serverAction.ts`（変更外だが依存先として読解）
- `apps/web/app/components/auth/`: `SignInForm/{action.ts,index.tsx}` / `SignUpForm/action.ts`・`index.tsx`(状態遷移の grep) / `VerifyEmailPanel/{action.ts,index.tsx}` / `schema.ts`
- `apps/web/app/components/layout/AccountMenu/{action.ts,index.tsx}`
- `apps/web/app/components/note/`: `CreateNoteButton/action.ts` / `NoteDetail/{action.ts,index.tsx}` / `NoteList/action.ts` / `NoteBody/index.tsx`
- `apps/web/app/routes/`: `__root.tsx`(diff) / `index.tsx`(diff) / `signin.tsx` / `signup.tsx` / `verify-email.tsx` / `notes/{index.tsx,$noteId.tsx,-action.tsx}`
- `apps/web/app/server.node.ts`(diff)、`apps/web/.env.example`(diff)
- `packages/core/src/adapters/memory/`: `passwordHasher.ts` / `secureTokenGenerator.ts` / `shareTokenProtector.ts` / `mailSender.ts` / `repositories/{loginAttemptStore.ts,sessionRepository.ts}` / `repositories/authTokenRepository.ts`（`save(Consumed)` 条件付き更新の該当箇所）
- `packages/core/src/application/identity/`: `signInWithPassword.ts` / `signUpWithPassword.ts` / `verifyEmail.ts` / `authenticateSession.ts`
- `packages/core/src/application/note/`: `getNote.ts` / `listNotes.ts` / `createBlankNote.ts` / `accessControl.ts`
- `packages/core/src/application/di/`: `memoryRuntime.ts` / `serverNode.ts`
- `packages/core/src/domain/identity/`: `session.ts`（TTL 定数）/ `valueObject.ts`（Email 正規化・長さ上限の grep）/ `authToken.ts`（TTL 発行箇所）
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`
- `packages/core/src/config.ts`(diff — 秘密情報の混入なし)

スキップ（理由つき）:

- `.thread/1/{adr,progress,steps,testing}.md`、`docs/*`、`biome.json`、`package.json`(root/web/core)、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`vitest.config*.ts`、`.github/workflows/ci.yml`、`apps/web/vite.config.node.ts` — ドキュメント / ビルド・CI 設定でセキュリティ境界に非関与
- 削除ファイル全件（todo 参照実装、`server.{aws,cloudflare,gcp}.ts`、`worker/{aws,cloudflare,gcp}/*`、`adapters/{libsql,d1,aws,cloudflare,gcp}/*`、`di/server{Aws,Cloudflare,Gcp}.ts`、`infra/*`、drizzle/wrangler/scripts、`domain/todo/*`、`application/todo/*` ほか一覧の D 行すべて） — 削除のみで新規攻撃面なし
- `apps/web/app/components/layout/{AppShell,AuthLayout,LegalPage,PublicShell}/index.tsx`、`components/auth/formStyles.ts`、`components/note/{CreateNoteButton/index.tsx,NoteDetailSkeleton,NoteListSkeleton}`、`components/ui/{Alert,BrandMark,ErrorState,Skeleton}` — 表示専用マークアップ / スタイル定数（動的 HTML 挿入なしを import 面で確認）
- `apps/web/app/routes/{privacy,terms}.tsx`、`routeTree.gen.ts`、`app/styles/*` — 静的ページ / 生成物 / CSS
- `apps/web/app/worker/node/runner.ts`、`packages/core/src/application/workers/*`、`application/execution/unitOfWork.ts`、`application/errors.ts`、`application/scope.ts`、`application/__tests__/helpers.ts` — 外部入力に直接晒されない内部オーケストレーション（エラー契約は `errorResponse.ts` 側で検証済み）
- `packages/core/src/adapters/conformance/*`、`adapters/memory/__tests__/*`、`application/{identity,note,workers}/__tests__/*`、`domain/{identity,note}/__tests__/*` — テスト資産（適合テストの存在は AC-6 の担保として認識）
- `packages/core/src/adapters/memory/`（上記以外: `store.ts` / `support.ts` / `cursor.ts` / `globalUnitOfWork.ts` / `scopeUnitOfWork.ts` / `scopeRouter.ts` / `timeZone*.ts` / `repositories/{accountDeletionManifestStore,globalMaintenanceRunStore,idempotencyStore,identityRepository,identityUniqueDirectory,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,noteRouteFanOutReader,noteRouteStore,oauthStateStore,outboxRepository,publicNoteQueryService,scopeCleanupAdmissionStore,userBatchReader,userRepository}.ts`） — 適合テストで契約検証されるプロセス内ストアで、認可判定は application/domain 側（検証済み）に置かれている
- `packages/core/src/application/identity/{pruneExpiredAuthState,eventDecoders,view}.ts` — pruneExpiredAuthState はランタイム未配線（plan.md 明記）で外部到達経路なし、他はデコーダー / DTO 射影
- `packages/core/src/application/note/{eventDecoders,view}.ts`、`application/ports/*`、`application/di/types.ts` — 型定義 / 射影のみ
- `packages/core/src/domain/`（上記以外: `identity/{identity,user,events,errorCode}.ts`・`identity/ports/*`・`identity/services/*`、`note/{note,noteRevision,valueObject,events,errorCode}.ts`・`note/ports/*`・`note/services/noteOwnershipPolicy.ts`、`workspace/*`、`common/*`、`conversion/valueObject.ts`、`job/valueObject.ts`、`storage/valueObject.ts`） — 純粋ドメイン。セキュリティ判断に効く箇所（TTL・正規化・アクセスポリシー・スロットル境界の呼び出し規約）は確認済みの usecase / policy 経由で検証
