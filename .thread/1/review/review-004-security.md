# レビュー 004 — Security

観点: 認証・認可・セッション・CSRF・入力バリデーション・機密情報・トークン取り扱い
対象: PR #12 / `issue/1/account-to-blank-note-skeleton` ← `main`
既出 Key（`.thread/1/review/triage.md` ラウンド1〜3）は再審議していない。

## Security

### Blockers

なし。

R3-SC-B-301（verify-email の login CSRF）は**塞がっている**。判定の根拠は下の「ADR-038 の検証」に実測込みで残した。

### Warnings

- **[W-401]** server function が cross-site から FormData で起動でき、`Origin` / `Sec-Fetch-Site` 検証が一切入っていない — 場所: `apps/web/app/start.ts`（本 PR の変更対象外だが、本 PR が初めて認証状態を持ち込んだことで初めて意味を持つ）+ 影響先は `apps/web/app/components/**/action.ts` の全 server function / 理由:

  TanStack Start の server-fn ハンドラーは、アプリが FormData 経路を作ったかどうかに関係なく、**すべての** server function について `multipart/form-data` と `application/x-www-form-urlencoded` を受理して `data` に `FormData` を渡す（`@tanstack/start-server-core/dist/esm/server-functions-handler.js` の `FORM_DATA_CONTENT_TYPES`）。この 2 つは CORS の safelisted content-type なので、クロスサイトの `<form method=POST>` から preflight なしで到達する。つまり AC-15 の「`FormData` を受ける経路を作る場合は `Origin` 検証必須」の条件は**既に成立しており**、必須とされた検証が無い。

  フレームワークはこれを想定して `createCsrfMiddleware`（`Sec-Fetch-Site` → `Origin` → `Referer` の順に同一オリジンを検証し、外れたら 403）を同梱し、`createStart` を**呼んでいない**アプリには既定で挿入する。ところが `createStartHandler.js:238` は `requestMiddleware: hasStartInstance ? startOptions.requestMiddleware : [defaultCsrfMiddleware]` であり、本アプリは `start.ts` で `createStart(() => ({ serializationAdapters: [...] }))` と Start インスタンスを作っているため **既定の CSRF ミドルウェアが外れ、`requestMiddleware` は空**になる。dev では `warnMissingCsrfMiddlewareOnce()` が「server functions are not protected by the CSRF middleware」と警告を出す状態。

  実測（`pnpm build:node` → `pnpm start`、`PORT=3111`）:
  - 存在しない fn id へ `Sec-Fetch-Site: cross-site` + `Origin: https://evil.example` で POST → **403 ではなく 500**。CSRF ミドルウェアが噛んでいれば id 解決前に 403 が返る。
  - `signOutFn` / `createBlankNoteFn` / `signUpFn` へクロスサイト multipart POST → ミドルウェア + validator + handler の**パイプラインは走る**。`x-tsr-serverFn` ヘッダーが無いため応答の組み立てだけが失敗して 500 になり、`Set-Cookie` は落ちる。

  現時点で成立する攻撃は無い。ただし塞いでいるのは 3 つの**偶発的な**壁であって、AC-15 が要求した検証ではない:
  1. 要求側 — `SameSite=Lax` によりクロスサイト POST にセッション Cookie が乗らない（`createBlankNoteFn` は 401 に倒れる）。
  2. ペイロード側 — `validateInput` の zod object スキーマが `FormData` を「全項目 undefined」として弾く（`signUpFn` / `verifyEmailFn` が届かない）。実測でもサーバーログに `mail.sent` が 1 件も出ず、ユーザーは作られていない。
  3. 応答側 — `x-tsr-serverFn` が無いと framework が応答を作れず、`signOutFn` の Cookie 破棄が victim に届かない（＝ ADR-008 が「POST に限定したから防げる」と書いた強制サインアウトは、実際には POST 限定ではなくこの偶然が防いでいる）。

  加えて **ADR-038 の前提記述が事実と食い違っている**: 「ミューテーションが JSON POST の server function（`FormData` 経路なし）という AC-15 の規律が、そのままこの防御の前提になっている」— `FormData` 経路はフレームワークが無条件に開けている。防御が成立している理由が ADR に書かれた理由と違う以上、validator を持たない／`z.coerce` や FormData 対応を足した server function を後で 1 つ足しただけで、確認待ち Cookie の植え付け（= login CSRF の復活）や強制サインアウトが成立しうる。

  / 提案: `apps/web/app/start.ts` に framework 同梱のミドルウェアを登録する（`requestMiddleware: [createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })]`）。これで AC-15 の「`Origin` 検証必須」が偶然ではなく不変条件になり、ADR-038 の前提記述も実態と一致する。あわせて ADR-038 の Consequences の当該行を「FormData 経路はフレームワークが常に開けているので、CSRF ミドルウェアによる同一オリジン検証が前提」に直すこと。修正は数行で、既存の呼び出し側（`useServerFn` 経由は常に同一オリジン）に影響しない。

### ADR-038 の検証（R3-SC-B-301 の再審査）

指示された 5 点をすべて追った。結論: **login CSRF は塞がっている**。

1. **確認待ち Cookie の属性・寿命** — `apps/web/app/presentation/session.ts:59-80`。`httpOnly` / `sameSite:"lax"` / `path:"/"` / `secure: isProduction()` / `expires = now + AuthTokenPurpose.ttlMs("email_verification")`（= 24h、`packages/core/src/domain/identity/valueObject.ts:229-231`）。ADR-038 決定 1 と一致。`Domain` 属性なし。`secure` は `process.env.NODE_ENV === "production"` 判定だが、`pnpm start` が `NODE_ENV` を立てないのが気になったので実際のビルド成果物を確認した — Vite が SSR チャンクでも定数畳み込みしており `dist/server/rsc/assets/session-*.js` は `var isProduction = () => true;` になる。production ビルドでは実行時の env に関係なく `Secure` が付く（plan.md の「dev のみ無効化」の縮退どおり）。問題なし。

2. **無条件に焼いているか** — `apps/web/app/components/auth/SignUpForm/action.ts:31`。`signUpWithPassword` の戻り値を受けた直後に条件分岐なしで `setPendingVerificationCookie(view.userId, ...)`。既登録メール経路（`packages/core/src/application/identity/signUpWithPassword.ts:41-62`）も同じ `SignUpView` を返し、`userId` は `idGenerator.next()` の decoy（既存ユーザーの実 id ではない）。Cookie の有無・長さ・形が新規/既登録で変わらないので列挙オラクルにならない。ADR-038 決定 1 の「常に」を満たす。

3. **照合と攻撃シナリオ** — `apps/web/app/components/auth/VerifyEmailPanel/action.ts:36-46`。`readPendingVerificationUserId() === view.userId` かつ `view.sessionToken !== null` のときだけ `setSessionCookie` + `clearPendingVerificationCookie`。不一致でも `verifyEmail`（`packages/core/src/application/identity/verifyEmail.ts`）は既に走り終わっているのでトークン消費と active 化は成立し、UI は `verifiedSignInRequired` に倒れる（決定 3）。攻撃シナリオを追うと:

   - 攻撃者が自分のメールでサインアップ → 攻撃者のブラウザーにだけ `hollow_pending_verification = <攻撃者 userId>` が焼かれ、トークン `T` を得る。
   - 被害者に `https://<app>/verify-email?token=T` を踏ませる（トップレベル GET なので `SameSite=Lax` は素通り）。ページはマウント後に `verifyEmailFn` を POST する。
   - 被害者のブラウザーの確認待ち Cookie は `null`（未サインアップ）か被害者自身の `userId`。`view.userId` は攻撃者の id なので **必ず不一致** → `sessionToken` は捨てられ、`Set-Cookie` は出ない。被害者は「メールアドレスを確認しました。サインインしてください」に着地するだけで、攻撃者のアカウントにサインインしない。空文字 Cookie は `readPendingVerificationUserId` が `null` に正規化するので `null === string` の偽陽性も無い。
   - 唯一の回避路は「攻撃者が被害者のブラウザーに攻撃者の pending Cookie を植える」こと。植えられるのは `signUpFn` の応答だけで、(a) JSON POST はクロスサイトで preflight に阻まれ、(b) FormData POST は zod が弾く（W-401 の実測 2 — `mail.sent` 0 件でユーザーも作られない）。よって現状は成立しない。ただしこの (b) は AC-15 が要求した `Origin` 検証ではなく偶然の壁なので W-401 として別立てにした。

4. **新たな攻撃面** — 洗ったが実害のあるものは無し。
   - Cookie 固定: 値は常に `view.userId` で、攻撃者が任意値を選べる経路が無い。`HttpOnly` で JS からも書けない。
   - decoy userId: ランダム UUID。既存ユーザーの実 id を漏らさないし、`verifyEmail` のトークン所有者と一致することもない。
   - Cookie 破棄漏れ: 一致してセッションを発行したときだけ破棄する。不一致時に残すのは正しい（被害者自身の確認リンクを後から開ける）。サインイン成功時にも残るが、値は自分の userId / decoy で、24h で失効する。実害なし。
   - 複数サインアップ: Cookie 1 本なので後勝ち。ADR-038 Consequences の記載どおりで、先のリンクは `verifiedSignInRequired` に倒れるだけ。
   - サインイン済みの利用者が他人の確認リンクを踏んでもセッションを失わない（`setSessionCookie` を呼ばないため）。R3 の指摘にあった「既存セッションの上書き」も同時に解消。

5. **ラウンド3 の他修正**
   - `MEMORY_MAIL_LOG_ACTION_URL`: `packages/core/src/adapters/memory/mailSender.ts:38-40,56` で既定 false の opt-in。`options.logActionUrl ?? (process.env.MEMORY_MAIL_LOG_ACTION_URL === "true")` で、テストは明示注入。`apps/web/.env.example` にも「ログを読める者がアカウントを乗っ取れる」旨つきでコメントアウト記載。修正済み。
   - `safeRedirectPath` の制御文字: `apps/web/app/presentation/redirect.ts:6-16` で U+0000..U+001F と U+007F を弾く。`__tests__/redirect.test.ts` に `\n` / `\t` / `\r` / DEL / NUL のケースあり。修正済み。
   - `clientKey`: `apps/web/app/presentation/clientKey.ts` の JSDoc に、リバースプロキシ配下では全クライアントが 1 つの key に潰れて「既知メールに 10 回失敗させて 15 分ロック」を誰でも反復できる、という反転攻撃と `docs/runtime_node.md` 参照が明記された。文書化として妥当。

### その他 確認して問題なしとしたもの

- 認可: `createBlankNoteFn` / `renderNoteList` / `renderNoteDetail` はハンドラー内で `requireSession()` を呼ぶ（route guard とは独立の二重化）。`getNote` は route → scope → `NoteAccessPolicy.evaluate` の順で、不在・他人の非公開・権限なしがすべて `NOTE_NOT_FOUND` に収斂。`shareUrl` の復号は `canChangeVisibility` かつ unlisted のときだけ。
- 認証: `requireSession` は読み取り専用（無効 Cookie を消さない = GET で認証状態を変えない）。`sessionUserFn` は GET だが副作用なし。
- スロットル: `signInWithPassword` は評価 → 認証 → `recordFailure` の順で、未登録メール・identity 不在・弱パスワードのいずれもダミー hash 検証で時間を揃える。ダミー hash は失敗時にメモを削除するので rejected 恒久キャッシュにならない。
- 秘密の扱い: scrypt パラメータに上限（`MAX_SCRYPT_N/R/P`）、比較は `timingSafeEqual`。共有トークンのハッシュ比較は `constantTimeHashEquals`。トークンは `base64url(userId).secret`（32byte CSPRNG）で、保存は全体の SHA-256 なので locator だけでは認証できない。`ShareTokenKeyRing` は runtime 寿命。
- 転送: 既定応答に `X-Content-Type-Options` / `Referrer-Policy` / `Cache-Control: private, no-store` / CSP（frame-ancestors・form-action・object-src・base-uri）。実測でも server-fn 応答に載っていた。
- エラー露出: `errorDisplay.ts` は `kind` / `code` だけを読む閉じた辞書で、`Object.hasOwn` で prototype 汚染を弾く。`NOTE_ACCESS_DENIED` と `NOTE_NOT_FOUND` は同一文言。`serverFragment.tsx` がストリーミング断片の redaction 境界を張る。
- 入力検証: 境界は route の `validateSearch` と server-fn の `validator` の 2 点のみ。`serverData` は内部専用で外部入力を通していない。

## カバレッジ

### 確認

- `apps/web/app/presentation/`: `session.ts` / `auth.ts` / `redirect.ts` / `clientKey.ts` / `validator.ts` / `serverAction.ts` / `serverFragment.tsx` / `serverErrorLog.ts` / `errorResponse.ts` / `errorResponseMiddleware.ts` / `appServerErrorAdapter.ts` / `errorDisplay.ts` / `__tests__/redirect.test.ts`
- `apps/web/app/components/auth/`: `SignUpForm/{action.ts,index.tsx}` / `SignInForm/{action.ts,index.tsx}` / `VerifyEmailPanel/{action.ts,index.tsx}` / `schema.ts`
- `apps/web/app/components/layout/AccountMenu/{action.ts,index.tsx}`
- `apps/web/app/components/note/`: `CreateNoteButton/action.ts` / `NoteDetail/{action.ts,index.tsx}` / `NoteList/action.ts` / `NoteBody/index.tsx`
- `apps/web/app/routes/`: `signin.tsx` / `verify-email.tsx` / `notes/index.tsx` / `notes/$noteId.tsx` / `notes/-action.tsx`
- `apps/web/app/router.tsx` / `apps/web/app/server.node.ts`
- `apps/web/vite.config.node.ts` / `apps/web/package.json` / `package.json` / `apps/web/.env.example` / `.github/workflows/ci.yml`
- `packages/core/src/application/identity/`: `signUpWithPassword.ts` / `signInWithPassword.ts` / `verifyEmail.ts`
- `packages/core/src/application/note/`: `getNote.ts` / `accessControl.ts`
- `packages/core/src/application/di/`: `memoryRuntime.ts` / `serverNode.ts`
- `packages/core/src/domain/note/services/noteAccessPolicy.ts` / `packages/core/src/domain/identity/valueObject.ts`（トークン・キー生成部）
- `packages/core/src/adapters/memory/`: `passwordHasher.ts` / `secureTokenGenerator.ts` / `shareTokenProtector.ts` / `mailSender.ts` / `repositories/{authTokenRepository,sessionRepository}.ts`
- `packages/core/src/config.ts`
- 一覧外だが検証に必要だったもの: `apps/web/app/start.ts`（W-401 の場所）、`node_modules` の `@tanstack/start-server-core` server-fn ハンドラーと `@tanstack/start-client-core` の `createCsrfMiddleware`、および `pnpm build:node` の成果物 `dist/server/rsc/assets/session-*.js`

### スキップ

- `.thread/1/**`（`adr.md` の ADR-038 / `plan.md` / `triage.md` は読了、他のレビュー成果物は入力であって審査対象ではない）
- `CLAUDE.md` / `README.md` / `docs/**` — 文書。セキュリティ言明を含む `docs/runtime_node.md` の clientKey 節のみ W-401 判断の文脈として参照
- `packages/core/src/domain/{identity,note,workspace,job,storage,common,conversion}/**` のうち上記以外（エンティティ・値オブジェクト・イベント・ポート定義・単体テスト）— 資格情報・トークン・認可の判定を含まない純粋な型と遷移。domain レビュー観点
- `packages/core/src/adapters/conformance/**` と `packages/core/src/adapters/memory/**` のうち上記以外（note / outbox / idempotency / scope / maintenance 系のリポジトリと store、`__tests__/**`）— 認証情報を扱わない永続化契約。usecase-adapter / test レビュー観点
- `packages/core/src/application/` のうち上記以外（`note/{createBlankNote,listNotes,view,eventDecoders}.ts`、`identity/{authenticateSession,pruneExpiredAuthState,view,eventDecoders}.ts` の細部、`ports/**`、`execution/`、`workers/**`、`__tests__/**`、`errors.ts`、`scope.ts`）— 認可判定を含む `authenticateSession` は `session.ts` 経由の呼び出し契約として確認済み。残りは機密の取り扱いを含まない
- `apps/web/app/components/ui/**`、`components/layout/{AppShell,AuthLayout,LegalPage,PublicShell}`、`components/note/{NoteList,NoteDetailSkeleton,NoteListSkeleton}/index.tsx`、`routes/{index,privacy,terms,signup,__root}.tsx`、`app/styles/**`、`routeTree.gen.ts` — 表示のみ。frontend レビュー観点
- `apps/web/app/worker/node/runner.ts`、`packages/core/src/application/workers/**` — 外部入力を受けない内部ワーカー
- 削除ファイル群（`infra/aws/**`、`infra/cloudflare/**`、`infra/gcp/**`、`packages/core/src/adapters/{d1,libsql,aws,gcp,cloudflare}/**`、`apps/web/app/{server.aws,server.cloudflare,server.gcp}.ts`、`apps/web/app/worker/{aws,cloudflare,gcp}/**`、`apps/web/scripts/migrate.*`、`wrangler*`、`drizzle*`、`vite.config.{aws,cloudflare,gcp}.ts`、`vitest.config.integration*.ts`、`apps/web/app/components/todo/**`、`apps/web/app/routes/todo/**`、`packages/core/src/{domain,application}/todo/**`）— 削除のみで新たな攻撃面を作らない。残存参照が無いことは `.github/workflows/ci.yml` と `package.json` の差分で確認
- `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `biome.json` / `packages/core/package.json` — 依存とツール設定。新規の実行時依存追加なし
