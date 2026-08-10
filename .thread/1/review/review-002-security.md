# Review 002 — PR #12 (issue/1/account-to-blank-note-skeleton)

### Security

#### Blockers

なし

AC-15 のコア要件は 2 巡目でも維持されている（再確認した事実のみ列挙）:

- Cookie 属性: `HttpOnly` / `SameSite=Lax` / `Path=/` / `Expires = now + Session.ttlMs`、`Secure` は production のみ（dev http の縮退は plan.md 記載どおり） — `apps/web/app/presentation/session.ts:31-48`
- CSRF 規律: ミューテーション（signUp / signIn / verifyEmail / signOut / createBlankNote）はすべて JSON POST の server function。`FormData` を受ける経路は無く、状態変更 GET も無い。`sessionUserFn` / `renderNoteList` / `renderNoteDetail` は読み取り専用（`authenticateSession` の best-effort delete は「すでに無効な行」限定で、GET から悪用できる状態変更ではない — `authenticateSession.ts:41-66`）
- オープンリダイレクト: `safeRedirectPath` が `/` 始まり・`//` 拒否・`\` 拒否。`beforeLoad` の `location.href`（同一オリジンのパス）と `/signin?redirect=`（zod max 2048 → `safeRedirectPath`）の双方を通す — `presentation/auth.ts:23-33`, `routes/signin.tsx:11-13,43`
- セッション固定: サインイン・メール確認とも新規トークンを発行して Cookie を上書きするため固定化不能。サインアウトは POST 限定（理由コメントあり） — `AccountMenu/action.ts:10-16`
- 認可: `getNote` は route→scope→`NoteAccessPolicy.evaluate` で不在・他人の非公開・権限なしが `NOTE_NOT_FOUND` に収斂。`scopeRouter.resolveNote` の不在も同じ `NOTE_NOT_FOUND` を投げるため経路差が出ない — `adapters/memory/scopeRouter.ts:26-31`
- ステータスマッピング: `UNAUTHENTICATED`→401 / `THROTTLED|LOCKED|RATE_LIMITED`→429 / `NOTE_GONE`→410 — `presentation/errorResponse.ts:117-129`
- DoS 面: transport 境界の zod（email≤254 / password≤128 / displayName≤50 / token≤512 / noteId≤128 / redirect≤2048）、`listNotes` の limit clamp（≤100）、`AuthToken` の単回消費が条件付き更新（`authTokenRepository.ts:42-55`）

##### 1 巡目指摘の修正検証

- **W-021（RSC 断片の redaction boundary）— 修正済み。** `renderServerFragment` は `render()` を **plain async 関数として自分で await する**ため、(a) 同期 throw、(b) 非 Error 値（`extractSerializedError` → `serializeError` → `kind:"unknown"` に落ちる）、(c) reject した promise のすべてを 1 か所で捕まえ、`isRedirect` / `isNotFound` だけ素通しし、system/unknown は生ペイロードで `logServerError` に流してから `redactForClient` 済みの `AppServerError` を投げ直す — `presentation/serverFragment.tsx:28-49`。`-action.tsx` の 2 経路とも `requireSession()` はハンドラー内（= middleware の守備範囲）、断片本体だけがこのラッパーの内側という配置で正しい。
  カバー範囲の限界（**現状は穴になっていない**）: 捕捉できるのは fragment root が await した仕事だけで、返した JSX の中にさらに async server component を置いたり promise を client の `use()` へ渡したりすると再び外へ抜ける。`NoteList` / `NoteDetail` は子がすべて同期コンポーネント（`CreateNoteButton` は client、`NoteBody` は client + props のみ）であることを確認済み。この制約は JSDoc に明記されているので、後続スライスで断片をネストするときの遵守事項として残る。
- **W-022（ShareTokenKeyRing の寿命）— 修正済み。** 鍵束の生成が `createMemoryRuntime` 直下へ移り（`memoryRuntime.ts:83`）、`createRequestContainer` は同じ `keyRing` を共有する。`memoryRuntime()` 自体が `globalThis` の `Symbol.for` スロットに固定された **プロセス単位シングルトン**（`serverNode.ts:71-80`）なので、SSR / RSC の別モジュールグラフ・HMR 再読み込みをまたいでも「版 1 → 同じ鍵」が保たれる。protect/reveal の版→鍵写像は成立する。
- **W-023（未登録メールのタイミング列挙）— 修正済み（残件は W-202）。** ゲートの位置が正しい: 早期 return は 4 分岐（user 不在 / deleted / password identity 無し / 入力が `PlainPassword` 規則違反）すべてが `verifyAgainstDummy` を通り、以降は共通の `recordAndClassifyFailure` に合流する（`signInWithPassword.ts:113-141`）。scrypt 呼び出し回数は成功・失敗・未登録のいずれも 1 回で、テストが verify 回数 1 を assert している（`__tests__/signInWithPassword.test.ts` の "timing equalization"）。`DUMMY_PASSWORD = "timing-equalizer-0nly"` は `PlainPassword` の規則（8..128 / 英字 / 数字）を満たすので `create` が投げることはない（確認済み）。キャッシュは promise 単位で、2 回目以降は `hash()` を再実行しない = 定常状態での追加コストなし（プロセス最初の 1 回だけ hash+verify の 2 回分になるが、単発なのでオラクルにならない）。
- **W-024（scrypt パラメータ上限）— 修正済み。** `n >= 2` かつ 2 冪かつ `<= 2^17`、`1 <= r <= 16`、`1 <= p <= 4`、salt 長 16 一致、key 長 32 一致（`passwordHasher.ts:85-103`）。正規ハッシュ（N=16384=2^14 / r=8 / p=1 / salt 16B / key 32B）は全条件を満たし、テストが「改竄版は false / 正規版は true」を両方 assert している。誤検知なし。
  残件として記録（新規指摘には挙げない）: 上限は N と r が乗算で効くため、`N=2^17 × r=16` の改竄行は依然 `maxmem` 約 512MB を要求できる。ただしこの経路は DB 書き込み権限が前提で、その権限があればハッシュ自体を差し替えて成りすませるため、追加の攻撃価値は DoS のみ。将来 `n * r` の積で締めるなら安いが、本 PR のブロック要因ではない。
- **サインアウトのフル遷移化 — 妥当。** `await signOut({})` が解決した時点で `Set-Cookie`（`Max-Age=0`、name / path / httpOnly / sameSite / secure が発行時と一致 — `session.ts:41-48`）は同一オリジン fetch の応答としてブラウザに適用済みで、その後の `window.location.assign("/")` は必ず未認証状態で走る。router インスタンスごと破棄されるので `staleTime: Infinity` のキャッシュ残留も断てる（`AccountMenu/index.tsx:38-52`）。失敗時は遷移せずエラー表示に倒れる。なおセッション行自体の削除は UC-identity-009 として plan.md で明示的に見送られており（ADR-008）、Cookie 破棄のみである以上「盗まれたトークンの失効」はこのスライスでは成立しない — これは記録済みの縮退であって新規の欠陥ではない。

#### Warnings

- **[W-201]** サインアップに W-023 と同型のタイミング列挙が残っている — 場所: `packages/core/src/application/identity/signUpWithPassword.ts:74-95` vs `99` / 理由: 既登録メールの経路は `identityUniqueDirectory.resolve` → `existingAccountNotice` 送信 → decoy userId 返却で終わり、**`passwordHasher.hash` を一度も通らない**。新規メールの経路は line 99 で scrypt（N=16384、実測で数十 ms 級）を実行する。応答本文・ステータスを decoy userId まで作って揃えている（そこは正しい）のに、所要時間だけが「このメールは登録済みか」を素で漏らす。sign-in 側を W-023 で塞いだいま、同じオラクルが sign-up に開いたまま残るのは非対称。しかも sign-up にはスロットル（`LoginAttemptStore`）が掛かっておらず、レート制限も CF スライス送りなので、sign-in より測定が容易。/ 提案: `passwordHasher.hash(password)` を `existingUserId` の分岐より **前**（line 74 の直前）へ移すのが最小修正 — 両経路が必ず 1 回だけ scrypt を通り、捨てるハッシュも発生しない（既存経路では使わないだけ）。ダミーハッシュを足すより素直で、`PlainPassword.create` の検証順序も変わらない。
- **[W-202]** ダミーハッシュの reject がプロセス寿命でキャッシュされ、列挙オラクルが再出現しうる — 場所: `packages/core/src/application/identity/signInWithPassword.ts:52-57` / 理由: `dummyHash ??= hasher.hash(...)` はスロットに **promise を** 入れるので、`hash()` が一度でも reject（scrypt はメモリ逼迫時に error コールバックを呼ぶ）するとその rejected promise が恒久的に居座る。以後 `verifyAgainstDummy` は毎回 throw し、未登録メール・password identity なし・弱パスワード入力だけが `INVALID_CREDENTIALS`(422) ではなく system error(500) を返すようになる — W-023 で塞いだはずの「登録済みか否か」が**ステータスコードで**露出する形に反転し、しかも再起動まで直らない。`hasher.verify` の throw も同様に上へ抜ける。/ 提案: `verifyAgainstDummy` を「失敗しても必ず false を返す」契約にする（`try { … } catch { dummyHash = null; }` で失敗時はスロットを空に戻して `false` を返す）。タイミング均一化は best-effort な防御であって、認証判定を壊してよい根拠にはならない。
- **[W-203]** 認証済み応答に `Cache-Control` が無い — 場所: `apps/web/app/server.node.ts:50-70`（`SECURITY_HEADERS`）/ 理由: 既定ヘッダーは `X-Content-Type-Options` / `Referrer-Policy` / CSP の 3 つだけで、キャッシュ指示が一切無い。利用者固有のデータは `/notes` の SSR HTML と、**GET の server function**（`sessionUserFn` / `renderNoteList` / `renderNoteDetail`）の応答として返る。GET + Cookie 認証 + freshness ヘッダー皆無という組み合わせは、前段に CDN / 逆プロキシ / 企業プロキシが入った瞬間に他人の応答を配ってしまう典型形（Node 直結の現状では中間キャッシュが無いため実害は出ていない）。/ 提案: `SECURITY_HEADERS` に `["Cache-Control", "private, no-store"]` を足す（静的アセットは framework 側が自前の `Cache-Control` を付けるので、既存値を上書きしない現在の `if (!headers.has(name))` 実装のままで共存する）。公開閲覧スライスで公開ノートだけ緩める、が素直な進化。
- **[W-204]** サインアップの「応答同一化」に競合窓の穴がある — 場所: `packages/core/src/application/identity/signUpWithPassword.ts:107-113` / `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:21-28,49-67` / 理由: `resolve` は `reserved` 行を返さない（同ファイル 46 行、意図どおり）ため、直前のサインアップが UoW 失敗で `reserved` を残した場合、同じメールの後続サインアップは decoy 経路に入らず `reserve` まで進んで `ConflictError("EMAIL_ALREADY_USED")` を**そのまま透過**する。reservation TTL は 10 分（`EMAIL_RESERVATION_TTL_MS`）。結果、200 + 一律応答のはずが 409 になって「このメールは使用中」が分かる。加えて `heldByAnother` のメッセージは `Unique key already held: email <正規化済みメール>` で、`conflict` kind は `redactForClient` の対象外なのでこの文字列がクライアントまで届く（今回は要求者自身のメールなので情報量はないが、conflict メッセージに識別子を載せる慣行自体が広がると危ない）。同時実行 2 本でも同じ分岐に入る。/ 提案: `signUpWithPassword` で `reserve` の `EMAIL_ALREADY_USED` を捕捉し、既登録メール経路（`existingAccountNotice` + decoy userId）と同じ応答へ倒す。docstring が「登録済みメールでも応答は同一」と保証を明言している以上、例外窓は塞ぐか docstring 側に明記するかのどちらかが要る。

#### カバレッジ

変更ファイル一覧（387 行、`scratchpad/changed-files-r2.txt`）との対応。D（削除）行は削除の事実のみ確認し内容レビュー対象外。

確認（読解または `git diff origin/main...HEAD` 精査）:

- `.thread/1/plan.md`（AC-15 とスコープ外記載）、`.thread/1/review/{triage.md,review-001-security.md}`（再審議回避の台帳）
- `apps/web/app/presentation/`: `serverFragment.tsx`(新規・W-021 検証) / `serverErrorLog.ts`(新規) / `errorResponseMiddleware.ts` / `errorResponse.ts` / `session.ts` / `auth.ts` / `clientKey.ts` / `validator.ts` / `errorDisplay.ts`(変更外だが redaction 経路として) / `appServerErrorAdapter.ts`(diff) / `pagination.ts`(diff — コメント文言のみ) / `serverAction.ts`(変更外だが依存先として)
- `apps/web/app/components/auth/`: `SignInForm/{action.ts,index.tsx}` / `SignUpForm/action.ts` / `VerifyEmailPanel/{action.ts,index.tsx}` / `schema.ts`
- `apps/web/app/components/layout/AccountMenu/{action.ts,index.tsx}`（サインアウト経路の再検証）、`layout/AppShell/index.tsx`
- `apps/web/app/components/note/`: `CreateNoteButton/{action.ts,index.tsx}` / `NoteList/{action.ts,index.tsx}` / `NoteDetail/{action.ts,index.tsx}` / `NoteBody/index.tsx`（Shadow DOM への `innerHTML` 経路 — 本スライスで届く本文は白紙由来のみ、サニタイズは後続スライスとコメントに明記）
- `apps/web/app/routes/`: `__root.tsx`(diff) / `index.tsx` / `signin.tsx` / `signup.tsx` / `verify-email.tsx` / `notes/{index.tsx,$noteId.tsx,-action.tsx}`
- `apps/web/app/server.node.ts`(diff — セキュリティヘッダー)、`apps/web/.env.example`(diff — 秘密情報の残骸なし)
- `packages/core/src/adapters/memory/`: `passwordHasher.ts`(W-024 検証) / `shareTokenProtector.ts` / `secureTokenGenerator.ts` / `mailSender.ts` / `scopeRouter.ts` / `repositories/{sessionRepository,authTokenRepository,loginAttemptStore,identityUniqueDirectory}.ts`
- `packages/core/src/application/identity/`: `signInWithPassword.ts`(W-023 検証) / `signUpWithPassword.ts` / `verifyEmail.ts` / `authenticateSession.ts` / `pruneExpiredAuthState.ts`(到達経路と定数のみ)
- `packages/core/src/application/note/`: `getNote.ts` / `listNotes.ts` / `createBlankNote.ts` / `accessControl.ts`
- `packages/core/src/application/di/`: `memoryRuntime.ts`(W-022 検証) / `serverNode.ts`
- `packages/core/src/application/errors.ts`(diff — `ValidationError` の直列化形)、`packages/core/src/config.ts`(diff — 秘密情報の混入なし)
- `packages/core/src/domain/identity/`: `session.ts`（TTL / reconstruct 検証）/ `valueObject.ts`（`PlainPassword` 規則・`LoginAttemptKey` 構成）/ `services/loginThrottlePolicy.ts`（閾値・ロック導出）
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`(diff — W-003 の定数時間比較)、`domain/note/valueObject.ts`（`ShareLink` / `ProtectedShareToken` の該当節）
- `packages/core/src/application/identity/__tests__/signInWithPassword.test.ts`(diff) / `adapters/memory/__tests__/cryptoAdapters.test.ts`(diff) — W-023 / W-024 の回帰固定を確認する目的で読解

スキップ（理由つき）:

- `.thread/1/{adr,progress,steps,testing}.md`、`.thread/1/review/review-001-*.md`（security 以外）、`CLAUDE.md`、`docs/*`、`biome.json`、`package.json`(root/web/core)、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`vitest.config*.ts`、`.github/workflows/ci.yml`、`apps/web/vite.config.node.ts` — ドキュメント / ビルド・CI 設定でセキュリティ境界に非関与
- 削除ファイル全件（todo 参照実装、`server.{aws,cloudflare,gcp}.ts`、`apps/web/Dockerfile.gcp`、`worker/{aws,cloudflare,gcp}/*`、`adapters/{libsql,d1,aws,cloudflare,gcp}/*`、`di/server{Aws,Cloudflare,Gcp}.ts`、`infra/*`、drizzle/wrangler/scripts、`domain/todo/*`、`application/todo/*` ほか一覧の D 行すべて） — 削除のみで新規攻撃面なし。攻撃面の縮小方向であることのみ確認
- `apps/web/app/components/layout/{AuthLayout,LegalPage,PublicShell}/index.tsx`、`components/auth/formStyles.ts`、`components/note/{NoteDetailSkeleton,NoteListSkeleton}/index.tsx`、`components/ui/{Alert,BrandMark,ErrorState,Skeleton}/index.tsx` — 表示専用マークアップ / スタイル定数（動的 HTML 挿入が無いことを import 面で確認）
- `apps/web/app/routes/{privacy,terms}.tsx`、`routeTree.gen.ts`、`app/styles/*` — 静的ページ / 生成物 / CSS
- `apps/web/app/worker/node/runner.ts`、`packages/core/src/application/workers/*`、`application/execution/unitOfWork.ts`、`application/scope.ts`、`application/__tests__/helpers.ts` — 外部入力に直接晒されない内部オーケストレーション（エラー契約は `errorResponse.ts` 側で検証済み。1 巡目からの変更も UoW 解放・ログ文言の修正で境界に非関与）
- `packages/core/src/adapters/conformance/*`、`adapters/memory/__tests__/{conformance,conformanceBackend,miscAdapters}.*`、`application/{identity,note,workers}/__tests__/*`（上記 2 件を除く）、`domain/{identity,note}/__tests__/*` — テスト資産
- `packages/core/src/adapters/memory/`（上記以外: `store.ts` / `support.ts` / `cursor.ts` / `globalUnitOfWork.ts` / `scopeUnitOfWork.ts` / `timeZone*.ts` / `repositories/{accountDeletionManifestStore,globalMaintenanceRunStore,idempotencyStore,identityRepository,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,noteRouteFanOutReader,noteRouteStore,oauthStateStore,outboxRepository,publicNoteQueryService,scopeCleanupAdmissionStore,userBatchReader,userRepository}.ts`） — 適合テストで契約検証されるプロセス内ストアで、認可判定は application / domain 側（検証済み）に置かれている
- `packages/core/src/application/identity/{eventDecoders,view}.ts`、`application/note/{eventDecoders,view}.ts`、`application/ports/*`、`application/di/types.ts` — 型定義 / デコーダー / DTO 射影
- `packages/core/src/domain/`（上記以外: `identity/{identity,user,authToken,events,errorCode}.ts`・`identity/ports/*`・`identity/services/{accountLinkingPolicy,identityPolicy}.ts`、`note/{note,noteRevision,events,errorCode}.ts`・`note/ports/*`・`note/services/noteOwnershipPolicy.ts`、`workspace/*`、`common/*`、`conversion/valueObject.ts`、`job/valueObject.ts`、`storage/valueObject.ts`） — 純粋ドメイン。セキュリティ判断に効く箇所（TTL・正規化・アクセスポリシー・スロットル境界・トークン単回消費）は確認済みの usecase / policy / adapter 経由で検証済み
