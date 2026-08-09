# 実装手順 — Issue #1

## 設計

**レイヤーの内側から外側へ**。spec/（domains → usecases → presentation → pages）と CLAUDE.md を正とする。既存 todo 参照実装はパターンの参考（branded VO・判別共用体エンティティ・`WithEventDrafts`・`TransactionalRepository`・DI 形状・RSC 配線）としてのみ使い、todo 固有物は削除する。

### ドメインモデルへの影響

**共通（application 層の型だが domain の語彙を規定）**

- **Workspace 最小語彙の新設**: `domain/workspace/valueObject.ts` に `WorkspaceId` / `WorkspaceRole` の最小 VO を定義する（本体はスライス #3 で積まれる前提を JSDoc に明記）。`ScopeKey`・`AccountDeletionManifestStore` の Item 型・`NoteOwner`・`NoteViewer` が参照するため本スライスで必須。`WorkspaceAuthorization` は spec どおり Workspace ドメインのドメインサービスとして `domain/workspace/services/workspaceAuthorization.ts` に**インターフェース型のみ**定義し、実装はスライス #3（本スライスの呼び出しは常に personal 経路）。
- `ScopeKey`（`{type:"user";userId} | {type:"workspace";workspaceId}`）を新設。正規化名 `user:{id}` / `workspace:{id}`。
- Unit of Work を二平面化する:
  - `GlobalUnitOfWorkProvider.run<T>(fn)` — global 平面。context は `{ userRepository, identityRepository, sessionRepository, authTokenRepository, identityUniqueDirectory, collectEvents }`。
  - `ScopeUnitOfWorkProvider.run<T>(scope: ScopeKey, fn)` — scope 平面。context は `{ noteRepository, noteRevisionRepository, cleanupAdmission, collectEvents }`（後続スライスで tag / storage 等を追加）。
  - `run` のネスト禁止・共有手順は context を受け取る関数として切り出す、という usecases/identity.md「共通の約束」を JSDoc に明記。
  - 既存 `application/execution/unitOfWork.ts`（todoRepository 固定）は置き換え。
- `ScopeRouter`（`forScope` / `resolveNote`）。`resolveNote` は `NoteRouteStore` 経由で `{scope, routeVersion}` を返す。
- ストア系ポート: `ScopeCleanupAdmissionStore`（8メソッド）、`AccountDeletionManifestStore`（14メソッド + Item/Route 型 + ヘッダ状態機械）、`GlobalMaintenanceRunStore`（6メソッド、kind ごと running 1 run・lane/lease）— spec/domains/index.md#ScopeKey-と永続化境界 の契約をそのまま型に写す。
- 横断ポート: `application/ports/mailSender.ts`（`MailTemplate` 5種の判別共用体）、`application/ports/timeZoneResolver.ts`、`application/ports/oauthStateStore.ts`（`take` は原子的 get+delete）、`application/ports/idempotencyStore.ts` を `markProcessed(consumer, eventId): Promise<boolean>` へ変更。

**Identity（`packages/core/src/domain/identity/`）**

- `valueObject.ts`: UserId / IdentityId / SessionId / AuthTokenId / Email / Handle / DisplayName / Bio / PasswordHash / PlainPassword / TokenHash / OAuthProvider / AuthTokenPurpose（`ttlMs`: verification 24h, reset 1h）/ LoginAttemptKey（`forSignIn` / `forSharePassword`）。todo と同じ nominal 型 + `create()` パターン。
- `errorCode.ts`: `IdentityErrorCode`（InvalidId / InvalidEmail / InvalidHandle / HandleReserved / InvalidDisplayName / InvalidBio / WeakPassword / InvalidProviderAccount / TokenExpired / LastIdentityCannotBeRemoved / PasswordIdentityAlreadyExists + `IdentityLimitExceeded`。spec の enum に IdentityLimitExceeded が欠けているのは spec 側の記載漏れと判断し追加 — spec-sync 対象としてメモ）。
- `user.ts`: `User = PendingUser | ActiveUser | DeletingUser | DeletedUser`。`create` / `createVerified` / `verifyEmail` / `updateProfile` / `assignHandle` / `clearHandle` / `advanceAuthEpoch` / `beginDeletion` / `rejectDeletion` / `finalizeDeletion` / `reconstruct`。authEpoch 単調増加。
- `identity.ts`: `Identity = PasswordIdentity | OAuthIdentity`。`createPassword` / `createOAuth` / `changePassword` / `reconstruct`。
- `session.ts`: OCC なし。`ttlMs = 30日`（定数は domain 所有）、`create`（`expiresAt = now + ttlMs`、イベントなし）/ `isExpired`。
- `authToken.ts`: `PendingAuthToken | ConsumedAuthToken`。`issue` / `consume`（期限切れ→`TokenExpired`）/ `isExpired`。
- `services/identityPolicy.ts`（`maxIdentitiesPerUser = 8`）、`services/accountLinkingPolicy.ts`（`LinkDecision`）、`services/loginThrottlePolicy.ts`（`evaluate` / `initial`、lockThreshold 10・15分ロック・待機 `2^(n-2)`s 上限60s・TTL 24h、ロックは導出値）。
- `events.ts`: `identity.user.created` / `user.emailVerified` / `user.profileUpdated` / `user.handleChanged` / `user.deleted` / `identity.added` / `identity.removed` / `identity.passwordChanged` + decoder。
- `ports/`: userRepository（`extends TransactionalRepository<User, UserId>`）/ userBatchReader / identityUniqueDirectory（resolve / reserve / activate / release）/ identityRepository（+ listByUserId）/ sessionRepository（save なし・6メソッド）/ authTokenRepository（6メソッド、`save(Consumed)` は条件付き更新契約）/ passwordHasher / secureTokenGenerator（issue / issueForUser / locateUser / hashOf）/ signInOAuthClient / loginAttemptStore（`recordFailure` 原子性契約を JSDoc に明記）。

**Note（`packages/core/src/domain/note/`）**

- `valueObject.ts`: NoteId / RevisionId / NoteTitle（auto|manual、空→「無題」）/ NoteHtml（≤800,000 bytes、`empty()`）/ PlainTextContent / Excerpt / NoteHeading（≤200個は entity 側で切詰め）/ StyleMode / NoteOwner / ShareLink / ProtectedShareToken / SharePass / NoteFailureReason。
- `errorCode.ts`: `NoteErrorCode`（spec の 13 値）。
- `note.ts`: `Note = ActiveNote | TrashedNote`、`NoteContent`（4状態）、`NoteVisibility`（3状態）。本スライスで必要な遷移は `createBlank` が中心だが、エンティティの遷移群（createFromUpload / applyConversionResult / markConversionFailed / markAwaitingIntegration / updateBody / rename / changeStyleMode / moveTo / makePrivate / makeUnlisted / makePublic / reissueShareLink / setSharePassword / trash / restore）は DOM-note-013 の完了条件として全て実装する（純関数なのでコスト小、TC は後続スライス）。
- `noteRevision.ts`: `capture`（非 ready → `CannotCaptureEmptyContent`）。
- `services/noteAccessPolicy.ts`: `NoteViewer` / `ShareCredential` / `NoteAccess`、評価順序（所有→ゴミ箱→public→unlisted+token→denied）。`WorkspaceAuthorization` は「共通」節で定義する `domain/workspace/services/` のインターフェース型を注入する（実装はスライス #3。本スライスの呼び出しでは常に personal 経路）。
- `services/noteOwnershipPolicy.ts`: `ensureMovable`。
- `events.ts`: note.created / contentUpdated / conversionFailed / awaitingIntegration / renamed / styleModeChanged / visibilityChanged / published / shareLinkReissued / sharePasswordChanged / moved / trashed / restored / purged + decoder（projectionRevision を payload に含む設計は spec どおり。投影消費者は後続スライス）。
- `ports/`: htmlProcessor / pdfRenderer / noteExportComposer / noteRepository（+ listByIds / listPurgeable / countByOwner / listByOwner）/ noteRevisionRepository / localNoteQueryService / publicNoteQueryService / localNoteProjectionWriter / publicNoteProjectionWriter / noteProjectionSnapshotReader / noteProjectionRevisionStore / noteRouteStore（reserve→activate→abandon + move / purge 群、`NoteRoute` 5状態）/ noteRouteFanOutReader / shareTokenProtector / noteMovePort — spec/domains/note.md のシグネチャどおり定義。

### ユースケース / アプリケーションロジック

`packages/core/src/application/{identity,note}/` に `ServiceArgs` 形式で新設（todo の usecase 形式を踏襲）。DTO はプリミティブのみ。

- `identity/signUpWithPassword.ts` — terms 検査 → VO 構築 → `IdentityUniqueDirectory.resolve` で既存なら通知メール送信のみ（応答同一）→ email reserve → global UoW（User.create + Identity.createPassword + 未確認なら email_verification AuthToken を status/epoch 再検査つきで insert）→ commit 後 activate（失敗時 release、応答喪失は照合のうえ再 activate/release）→ commit 後 `MailSender.send`（失敗はログのみ）。invitation 分岐はスライス #3 まで「トークンが来ても通常サインアップ扱い」（spec 上も不正・期限切れ招待はエラーにしない）。
- `identity/verifyEmail.ts`（**glue**、spec/usecases/identity.md の該当節に従う）— token 解決（locateUser → findByTokenHash）→ consume（条件付き更新）→ User.verifyEmail → Session 発行。AC-01 e2e 成立に必須。
- `identity/signInWithPassword.ts` — LoginAttemptKey → get/evaluate（delay→THROTTLED、locked→LOCKED、照合せず）→ email 解決 → 照合 → 失敗は recordFailure（UoW 外・原子的）+ INVALID_CREDENTIALS（再 evaluate で次回ブロックなら格上げ）→ Pending→EMAIL_NOT_VERIFIED（記録しない）、Deleting→ACCOUNT_DELETING、Deleted→INVALID_CREDENTIALS → 成功で clear + Session 発行。
- `identity/authenticateSession.ts` — 完全読み取り専用。locateUser → findByTokenHash → isExpired → User 状態 + epoch 一致 → 出力 DTO。失敗は全て `ValidationError("UNAUTHENTICATED")`。
- `identity/pruneExpiredAuthState.ts` — 入力3種のタグ付き共用体。**本スライスはテストのみ**: Node runner へのスケジュール登録は行わない（runner の pruner 役は `pruneOutbox` のままで、consumer no-op のため continuation コマンドを回す先がない — 中途半端な配線を避け、ランタイム配線は後続スライスの CF cron で行う。Issue コメントの見送り一覧に記載）。cron: 共有 pruner タスク発行 + `beginOrResumeKind` → 最大6 lane claim。continuation: 1シャード1表の `deleteExpired(asOf, cursor, 100)` → `checkpointLane` / `advanceOrAck`。maintenanceRunPruneContinued: `pruneCompleted`。in-memory ランタイムでは「シャード」は論理値（generation/shardId は in-memory アダプターが単一シャードとして扱う）だが、契約とテストは複数シャード入力を受ける。
- `note/createBlankNote.ts` — NoteOwner 構築（workspace は `WORKSPACE_NOT_FOUND` 返却まで）→ NoteTitle → NoteId + operationId 採番 → `NoteRouteStore.reserveCreate` → `ScopeUnitOfWorkProvider.run(scope)` で `Note.createBlank` insert + collectEvents（`cleanupAdmission.assertWritable` / `assertActorWritable` を通す）→ `activateCreate`。失敗経路: commit 失敗 → `abandonCreate`、activate 応答喪失 → 同一 operationId 再試行、reserved 期限切れは回復関数（cron 配線は後続スライス、関数とテストは本スライス）。
- `note/getNote.ts` — 閲覧者コンテキスト解決（NoteRouteStore.resolve → scope 読み取り → NoteAccessPolicy。匿名 viewer の public 経路を含む）→ ready なら headings 投影 → shareUrl は canChangeVisibility ∧ unlisted のみ reveal（ShareTokenProtector で復号。TC-note-177 で検証）、公開ノートは匿名閲覧者にも本文を返し shareUrl は含めない（TC-note-178 で検証）→ references は全フィールド空（DTO 形は spec どおり用意）。空返却の根拠は二つ: (1) 本スライスは白紙ノートしか作れず本文由来の参照（`inlinedStylesheets` / `unavailableStylesheets` / `unresolved` — 供給元は本文 + `HtmlProcessor.extractExternalReferences`）が存在しない、(2) HtmlProcessor アダプター（ADP-note-001..007）見送り。テストで本文ありノートを seed する場合（TC-note-165 等）は references への assert を置かない。
- `application/identity/view.ts` / `application/note/view.ts` — DTO 投影（todo の `TodoView` パターン）。
- `workers/eventRelayWorker.ts` の `AllDomainEvents` / decoder registry を Identity + Note イベントへ書き換え（購読者はまだいないため dispatch は no-op 登録。outbox / relay の機構自体は保持）。

### アダプター / 永続化 / 外部連携

- **新設 `packages/core/src/adapters/memory/`**（正規アダプター群。テスト fake ではない）:
  - `store.ts` — プロセス内の平面別ストア（global テーブル群 + scope 別テーブル群を `Map` で表現、`MemoryBackend` として一括保持）。
  - `globalUnitOfWork.ts` / `scopeUnitOfWork.ts` — スナップショット + 差し替えのトランザクション模倣、OCC は version 比較で `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、commit 後に outbox 保存 + relayTrigger.kick（libsql 実装の流れを踏襲）。
  - `repositories/` — user / identity / session / authToken / note / noteRevision / identityUniqueDirectory / loginAttemptStore（単一 mutex 的逐次化で原子 increment）/ oauthStateStore / noteRouteStore（5状態サガ）/ scopeCleanupAdmissionStore / accountDeletionManifestStore / globalMaintenanceRunStore（lane / lease / keyset カーソル）/ outboxRepository / idempotencyStore / localNoteQueryService・projection 系（ADP-note-021..049 の最小契約実装: 空データでも契約どおり動く）。
  - `passwordHasher.ts`（Node `crypto.scrypt`）、`secureTokenGenerator.ts`（`crypto.randomBytes` + sha256、`base64url(UserId).secret`）、`shareTokenProtector.ts`（WebCrypto AES-GCM + キーリング）、`mailSender.ts`（送信記録をストアに保持 + logger 出力。dev では確認 URL をログで拾える）、`timeZoneResolver.ts`（`Intl.DateTimeFormat`、不正 TZ は UTC フォールバック）、`signInOAuthClient.ts` はポート**定義のみ**（ADP-identity-033/034 は見送り確定 — startOAuthFlow / completeOAuthSignIn が本スライス外で実行経路がなく、実装本体は OAuth プロトコル結合。ADR-006 の基準。Issue コメントの見送り一覧へ）。
- **ポート適合テスト**: `packages/core/src/adapters/conformance/` に `describeXxxContract(makeBackend)` 形式の共有スイートを新設し、`adapters/memory/__tests__/` から in-memory backend で実行。#11 で D1/DO backend が同じスイートを import する。ケースの根拠は spec/domains のポート契約 + `spec/inventory/adapter.md` の ADP 行。
- **削除**（ステップ1 に前倒し — ADR-004 改訂。完全な列挙はステップ1）: `adapters/{libsql,d1,aws,gcp,cloudflare}/` 全体、`domain/todo/`、`application/todo/`、todo / 削除ランタイム依存のテスト・スクリプト。`adapters/node/` は relayTrigger / queueDispatcher を Node ランタイム用に保持。
- **DI**: `application/di/serverNode.ts` を memory 配線に書き換え（`RequestContainer` に `globalUnitOfWorkProvider` / `scopeUnitOfWorkProvider` / `scopeRouter` / 各読み取りポート / `mailSender` / `passwordHasher` / `secureTokenGenerator` / `clock` / `idGenerator` / `logger` / `config`。`WorkerContainer` に outbox / idempotency / maintenanceRun 系）。`serverCloudflare/aws/gcp.ts` はステップ1 で削除済み。`di/types.ts` の container 型を更新。

### UI / プレゼンテーション

- `apps/web/app/presentation/session.ts` — Cookie 名・属性（HttpOnly / Secure(本番) / SameSite=Lax / Path=/ / expires=Session.expiresAt）、`setSessionCookie` / `clearSessionCookie` / `readSessionToken`。
- `apps/web/app/presentation/auth.ts` — `requireSession()`（server 側で authenticateSession を呼び、失敗は `UNAUTHENTICATED`）と、route `beforeLoad` 用ガード（未認証→ `/signin?redirect=<同一オリジンパスのみ>`）。
- `apps/web/app/presentation/clientKey.ts` — 接続元 IP の解決（Node runtime のヘッダ/ソケットから。`CF-Connecting-IP` は CF スライス）。
- `errorResponse.ts` の `httpStatusFor` にコード例外を追加: `validation:UNAUTHENTICATED`→401、`validation:THROTTLED|LOCKED|RATE_LIMITED`→429、`notFound:NOTE_GONE`→410。
- ルート構成（TanStack Router file-based）:
  - `routes/__root.tsx` — L-01/L-02/L-03 を包む root。todo action の副作用 import はステップ1 で除去済みなので、新 action 群（signup / signin / verify / createBlankNote / サインアウト）の side-effect import を**追加**する（ステップ9）。エラー/NotFound コンポーネント = P-46（存在と権限を区別しない共通表示、安全な再試行、トップ/一覧導線）。
  - `routes/index.tsx` — 未サインイン: 公開トップ最小（「はじめる」→ /signup）。サインイン済み: `/notes` へ redirect。
  - `routes/signup.tsx`（P-01, L-03）: email / password（強度メーター）/ 表示名 / 規約同意。項目エラーは入力中検出 + 送信抑止。送信完了状態「確認メールを送信しました」。
  - `routes/signin.tsx`（P-02, L-03): 認証失敗共通文言 / 未確認 / 待機中（待機秒表示）/ ロック中（解除時刻 + 再設定導線は文言のみ）状態。成功で redirect パラメータ or `/notes`。
  - `routes/verify-email.tsx`（glue、P-03 最小）: **GET はページ描画（「処理中」状態）のみで状態を変更しない**。マウント後にクライアントから server function（POST）へ token を送り、そこでトークン消費（verifyEmail）+ セッション Cookie 発行 → 成功で `/notes` へ。期限切れ / 使用済み / 無効は POST の応答で状態表示（状態変更 GET 禁止の CSRF 規律 — ADR-007）。
  - `routes/notes/index.tsx`（P-10 最小）: 認証ガード + 最小一覧（タイトル・更新時刻）、空状態 CTA、「新規作成」→ createBlankNote → `/notes/:noteId` へ遷移（PAGE-p10-005 / p10-015 相当の最小形）。RSC ストリーミング + Skeleton は todo 参照実装のパターン。
  - `routes/notes/$noteId.tsx`（P-11, PAGE-p11-001）: getNote を RSC で取得、本文は Declarative Shadow DOM で隔離描画（host に `position: relative`）、タイトル・visibility バッジ・見出しリスト（本文直前・折りたたみ）、読み込みスケルトン、`NOTE_NOT_FOUND` は P-46 表示。閲覧系のみ（操作メニューは後続スライス）。
  - `routes/terms.tsx` / `routes/privacy.tsx`（P-47, L-02）: 静的本文。nosniff / Referrer-Policy はレスポンスヘッダー設定（server.node.ts か route レベル）。
- ミューテーション配線: signup / signin / verify / createBlankNote は server function（`createServerFn({method:"POST"})` + `errorResponseMiddleware` + `validateInput(zod)`）。フォームは `useActionState` で pending / fieldErrors を表示（三層構造の徹底）。セッション Cookie の設定は server function 内で response header に付与。サインアウト glue も同列: `createServerFn({method:"POST"})` の JSON POST で `clearSessionCookie` を実行する（Cookie 破棄はサーバー行を変更しないが認証状態を変更する経路であり、GET リンクにすると SameSite=Lax 下で外部リンクからのログアウト強制が成立してしまう — ADR-008）。**CSRF 規律**（spec/presentation/index.md）: ミューテーションは JSON を受ける POST を既定とし、`FormData` を受ける server function を作る場合は `Origin` ヘッダー検証を必須にする。状態を変更する GET 経路は作らない。`useActionState` からの送信が FormData / JSON のどちらで届くかは実装時に確認し、FormData なら Origin 検証を実装する。

## 実装ステップ

依存方向の順。各ステップ末尾の ID 群がカバー範囲。

### 1. todo 参照実装・他ランタイムの削除と暫定スタブ化

- **対象ファイル（削除）:**
  - `packages/core/src/domain/todo/`、`application/todo/`、`adapters/{libsql,d1,cloudflare,aws,gcp}/`、`application/di/{serverCloudflare,serverAws,serverGcp}.ts`
  - todo / 削除ランタイム依存のテスト: `application/__tests__` の todo 依存分、`application/workers/__tests__/eventRelayWorker.integration.test.ts`（todo・libsql 依存）、`application/di/__tests__/serverCloudflare.test.ts`（削除対象 serverCloudflare のテスト — 「todo 系」の表現では拾えないため明記）
  - `apps/web/app/{server,worker}` の cf/aws/gcp 系（`server.{cloudflare,aws,gcp}.ts`、`worker/{cloudflare,aws,gcp}/`）
  - `apps/web/scripts/migrate.node.ts`（libsql migrator — memory 移行で不要）と `apps/web/app/worker/node/__tests__/runner.node.integration.test.ts`（libsql 依存。apps/web の tsconfig は `include: ["**/*"]` なので scripts / tests も typecheck 対象 — 残すと緑にならない）、`scripts/migrate.{aws,gcp}.ts`
  - `apps/web/app/routes/todo/`、`components/todo/`、`infra/` の不要分、root の `vitest.config.integration.ts`（cf 用）、wrangler / drizzle 設定（`wrangler*.toml` / `drizzle*.config.ts` / `vite.config.{cloudflare,aws,gcp}.ts`）
- **対象ファイル（暫定スタブへ書き換え）:**
  - `application/execution/unitOfWork.ts` — todo 固定 context を空 context に縮退
  - `application/di/{types,serverNode}.ts` — todo 配線を除去した最小形
  - `application/workers/eventRelayWorker.ts` — `@repo/core/domain/todo/events`（`AllDomainEvents = TodoEvent`）と `../todo/eventDecoders`（`defaultEventDecoderRegistry`）を import しているため、`AllDomainEvents = never` + 空 registry の暫定スタブに（Identity/Note への書き換えはステップ7）
  - `apps/web/app/server.node.ts` — `@repo/core/adapters/libsql/client` の直接 import（`createLibsqlClient / applyPragmas / getDatabase`）と `DATABASE_URL` 必須の boot を除去し、暫定 DI コンテナへ差し替え（memory 本配線はステップ8）。consumer no-op（`consumerHandler: async () => {}`）はここに在る — なお `worker/node/runner.ts` 自体に todo 依存はなく、ステップ1 でのスタブ化は不要（idempotencyStore の呼び出し追随はステップ2）
  - `routes/__root.tsx` — todo action の副作用 import 除去
  - `routes/index.tsx` — `<Link to="/todo">` の除去（最小スタブ）。あわせて checked-in の生成物 `routeTree.gen.ts` が todo ルートを import しているため、**ステップ1 内で再生成（dev/build を一回実行）**する — 再生成しないと `pnpm typecheck` 単独では緑にならない
- **npm scripts / 依存の整理（本ステップで実施 — 残すと削除直後から参照切れで壊れるため）:**
  - `apps/web/package.json`: `postinstall: "wrangler types"` を削除（wrangler 設定削除後は `pnpm install` 自体が落ちる）。cf/aws/gcp 系 scripts（`dev:cf` / `build:{cf,aws,gcp}` / `deploy:*` / `db:*` の cf/aws/gcp 分・`cf:types` 等）と依存（wrangler / `@cloudflare/*` / `@aws-sdk/*` / `@google-cloud/*` / `drizzle-*` / `@libsql/client` 等）を除去
  - root `package.json`: cf/aws/gcp 系委譲 scripts（`dev:cf` / `build:cf` 等）、`db:*`、`test:integration:cf`（`db:generate:cf` 前提）を削除。`test` / `test:integration` は暫定で `test:unit` のみに縮退し、node integration の最終形（`vitest.config.integration.node.ts` の要否）はステップ8 で確定する。ステップ1〜8 の間の検証は `pnpm test:unit` を使う
- **変更内容:** ADR-004 で確定済みの削除を最初に実施し、残す Node ランタイムが参照する箇所（unitOfWork / di / eventRelayWorker / server.node / root ルート / index ルート）は暫定スタブへ最小書き換えし、routeTree 再生成と scripts 整理まで本ステップで行う。**完了条件: `pnpm typecheck` と `pnpm build` が既知断なしで緑**（アプリは認証もノートもない空シェルとして起動する）。以降の全ステップは常に緑の上に積む。
- **理由:** CLAUDE.md「Pick one and delete the others」+ ADR-004（改訂: 削除の前倒し）。旧計画の「ステップ7 まで typecheck 断を温存」は、壊れる範囲が todo 系 usecase・DI 4 ファイル・libsql/d1 UoW・helpers に及び `pnpm dev` / `pnpm build` も落ちるため達成不可能だった。先に削除すれば各ステップの検証コマンド（AC-20）が最初から機能する。
- **カバー:** AC-14（削除側）

### 2. 共通ドメイン基盤（二平面 UoW・ScopeKey・横断ポート）

- **対象ファイル:** `packages/core/src/domain/workspace/valueObject.ts`（新設: WorkspaceId / WorkspaceRole 最小 VO）、`domain/workspace/services/workspaceAuthorization.ts`（インターフェース型のみ）、`packages/core/src/application/scope.ts`（ScopeKey）、`application/execution/unitOfWork.ts`（書き換え: 暫定スタブ → Global/Scope 二平面）、`application/ports/{scopeRouter,scopeCleanupAdmissionStore,accountDeletionManifestStore,globalMaintenanceRunStore,mailSender,timeZoneResolver,oauthStateStore,idempotencyStore}.ts`、`apps/web/app/worker/node/runner.ts`（呼び出し追随のみ）
- **変更内容:** 設計節のとおり型と契約（JSDoc に不変条件・原子性・ネスト禁止）を定義。`idempotencyStore` は `markProcessed(consumer, eventId): Promise<boolean>` へ変更。旧シグネチャの生き残り呼び出し元は `worker/node/runner.ts` の 1 箇所（consumer dispatch 内 `markProcessed(event.id)`、旧戻り値 `{alreadyProcessed}` 前提）なので、本ステップで `markProcessed("node-consumer", event.id)` + boolean 戻り値へ追随させる（runner の本配線はステップ8 のままで、ここは呼び出し 1 箇所の差分最小の追随のみ — 追随しないとステップ2〜8 の間 apps/web の typecheck が赤になる）。本ステップの application 共通型はステップ3 の `UserId`・ステップ4 の `NoteId` に型依存するため、**ステップ2〜4 は一体で扱い、完了条件は「ステップ4 完了時点で既知断なしで typecheck が通る」**とする。
- **理由:** すべての内側。後続ステップの型的土台。Workspace 最小 VO は本スライスの型が参照するため先頭で新設する（依存方向の逆転を作らない）。
- **カバー:** DOM-common-001..040

### 3. Identity ドメイン + ポート定義 + 単体テスト

- **対象ファイル:** `packages/core/src/domain/identity/{valueObject,errorCode,user,identity,session,authToken,events}.ts`、`domain/identity/services/*.ts`、`domain/identity/ports/*.ts`、`domain/identity/__tests__/*.test.ts`
- **変更内容:** 設計節のとおり。テストは VO 境界値（Email 254/255、Handle 予約語、PlainPassword 7/8/128/129・数字のみ）、User 状態機械、LoginThrottlePolicy（TC-identity-218..222,230,231 の根拠となる純関数部分）、AccountLinkingPolicy 全分岐。
- **理由:** ユースケースとアダプターの前提。
- **カバー:** DOM-identity-001..059

### 4. Note ドメイン + ポート定義 + 単体テスト

- **対象ファイル:** `packages/core/src/domain/note/{valueObject,errorCode,note,noteRevision,events}.ts`、`domain/note/services/*.ts`、`domain/note/ports/*.ts`、`domain/note/__tests__/*.test.ts`
- **変更内容:** 設計節のとおり。テストは NoteTitle（空→無題、200/201）、NoteHtml サイズ境界、createBlank の初期値（TC-note-058..060,062 の純関数部分）、NoteAccessPolicy 評価順序（所有者のゴミ箱閲覧可・他人 denied 等）。
- **理由:** 同上。
- **カバー:** DOM-note-001..070

### 5. ポート適合テストハーネス

- **対象ファイル:** `packages/core/src/adapters/conformance/{userRepository,identityRepository,sessionRepository,authTokenRepository,identityUniqueDirectory,loginAttemptStore,oauthStateStore,idempotencyStore,outboxRepository,noteRepository,noteRevisionRepository,noteRouteStore,scopeCleanupAdmissionStore,accountDeletionManifestStore,globalMaintenanceRunStore,…}.ts`
- **変更内容:** `describeXxxContract(name, makeBackend)` 形式（vitest の describe を内包、`makeBackend` が各バックエンドのセットアップを返す）。必須ケース: OCC 競合、`recordFailure` 並行10件、`take` 原子性、reserve→activate→release と応答喪失照合、AuthToken 条件付き consume、NoteRouteStore サガ（reserve/activate/abandon/期限切れ）、GlobalMaintenanceRunStore（run 再開・lease 失効回復・keyset 継続）、deleteExpired の境界（`expiresAt <= asOf`）。
- **理由:** Issue 目的「ポート適合テスト」。#11 の D1/DO アダプターが同じスイートで検証される土台。
- **カバー:** ADP 全行の検証手段（実装はステップ6）

### 6. in-memory アダプター実装

- **対象ファイル:** `packages/core/src/adapters/memory/**`（設計節のファイル群）、`adapters/memory/__tests__/*.test.ts`（適合スイートの実行 + memory 固有テスト）
- **変更内容:** 設計節のとおり。適合スイート全通過が完了条件。
- **理由:** walking skeleton の永続化層。
- **カバー:** ADP-common-001..039、ADP-identity-001..032,035..038、ADP-note-008..049（ADP-identity-033/034 と ADP-note-001..007,050..054 は見送り確定 — 基準は ADR-006）

### 7. ユースケース + TC ベースのテスト

- **対象ファイル:** `packages/core/src/application/identity/{signUpWithPassword,verifyEmail,signInWithPassword,authenticateSession,pruneExpiredAuthState,view,eventDecoders}.ts`、`application/note/{createBlankNote,getNote,view,eventDecoders}.ts`、`application/workers/eventRelayWorker.ts`（registry 書き換え）、`application/__tests__/`（in-memory コンテナのヘルパー）+ 各 usecase の `__tests__`
- **変更内容:** 設計節のとおり。テストは対象 TC 行を TC ID つきで実装（AC-8..13 の行）。`__tests__/helpers.ts` は memory バックエンドでコンテナを組む形へ書き換え。
- **理由:** アプリケーション層の完成。
- **カバー:** UC-identity-001,004,008,021（+ verifyEmail = UC-identity-002 の glue）、UC-note-001,002、TC-identity-008..016,150..178,213..237,247..255,259,261..263、TC-note-054,058..065,165,168..173,176..178,187

### 8. DI・ランタイム再配線（Node + memory）

- **対象ファイル:** `packages/core/src/application/di/{types,serverNode}.ts`（暫定スタブ → 本配線へ書き換え）、`packages/core/src/config.ts`（文言）、`apps/web/app/worker/node/runner.ts`
- **変更内容:** serverNode を memory 配線へ（設計節の RequestContainer / WorkerContainer 構成）。`worker/node/runner.ts` は relay / pruner（`pruneOutbox`）の役割を維持し consumer は no-op。**pruneExpiredAuthState は runner にスケジュールしない**（テストのみ — ステップ7 の記載どおり、配線は後続スライス）。`vitest.config.integration.node.ts` は memory アダプターに合わせて整理（適合テストは unit 側で走るため、不要なら削除）し、ステップ1 で暫定縮退させた root の `test` / `test:integration` scripts をここで最終形に確定する（integration 設定を削除するなら `test` = `test:unit` のまま）。`docs/test.md` / `docs/runtime_*.md` の記述を現状へ最小改訂。`pnpm typecheck` / `pnpm build` / `pnpm dev` を通す。
- **理由:** 削除はステップ1 で完了済み。ここは新ドメインの本配線のみ。
- **カバー:** AC-14（配線側）

### 9. プレゼンテーション基盤（セッション・ガード・エラー対応表・P-46/P-47）

- **対象ファイル:** `apps/web/app/presentation/{session,auth,clientKey}.ts`（新設）、`presentation/errorResponse.ts`（コード例外追加）、`routes/__root.tsx`（P-46 fallback + 新 action 群の side-effect import の**追加** — todo 分の除去はステップ1 で完了済み。"use client" island からのみ到達する server fn は root での side-effect import を欠くとビルド後 404 になる — plan.md リスク欄の gotcha）、`routes/{terms,privacy}.tsx`、`server.node.ts`（セキュリティヘッダー: nosniff / Referrer-Policy / CSP 最小）
- **変更内容:** 設計節のとおり。
- **理由:** ページ実装の前提。
- **カバー:** PAGE-p46-001..003、PAGE-p47-001、AC-15

### 10. 認証ページ（P-01 / P-02 / verify-email）

- **対象ファイル:** `apps/web/app/routes/{signup,signin,verify-email,index}.tsx`、`components/auth/{SignUpForm,SignInForm}/{index.tsx,action.ts}`、`components/auth/schema.ts`、`components/layout/AuthLayout`（L-03）
- **変更内容:** 設計節のとおり。P-01 の状態（入力/項目エラー/送信中/送信完了/全体エラー）、P-02 の状態（入力/認証失敗/未確認/待機中/ロック中/送信中）。Google ボタン・再送・再設定導線は出さない（見送り行）。
- **理由:** AC-01 / AC-04 の e2e。
- **カバー:** PAGE-p01-001,002,004、PAGE-p02-001,002,005、AC-16, AC-17

### 11. ノートページ（P-10 最小 / P-11）

- **対象ファイル:** `apps/web/app/routes/notes/{index,$noteId}.tsx` + `-action.tsx`、`components/note/{NoteList,NoteListSkeleton,CreateNoteButton,NoteDetail,NoteDetailSkeleton}/`、`components/layout/AppShell`（L-01 最小: トップバー・スコープトークン(個人固定)・アカウントメニュー(サインアウト含む)・パレットトリガー(未機能)）
- **変更内容:** 設計節のとおり。新規作成 → createBlankNote → 詳細遷移、詳細は Shadow DOM 描画 + 見出しリスト + スケルトン + NOT_FOUND。サインアウトは **Cookie 破棄のみの presentation 限定 glue で確定**（server function は `createServerFn({method:"POST"})` の JSON POST で `clearSessionCookie` のみ実行。GET リンクにはしない — 状態変更 GET 禁止の CSRF 規律。セッション行削除＝UC-identity-009 `signOut` の本体は行わず、部分実装の先取りを避ける — ADR-008）。
- **理由:** ED-01（最小）/ OR-11 の e2e 完結。
- **カバー:** PAGE-p10-005、PAGE-p11-001、AC-18

### 12. 仕上げ

- **対象ファイル:** 全体
- **変更内容:** `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test:unit`、`spec/manual-tests/{account,editing,organize}.md` の対象シナリオを `pnpm dev` で手動確認。**部分実行の既知の縮退**（plan.md テスト方針参照）: account.md TC-02 手順2 の空状態はアップロード導線を除いて判定、再サインアップ時の確認メール再送は行われない（spec 内部不整合 — usecase / TC-255 側を正とする）、editing.md は ED-01 の新規作成部分のみ、organize.md は OR-11 のみ。skip / 期待値変更した手順と見送り行の一覧・理由（LOCKED 再設定導線の文言化・dev の Secure 条件付与の縮退を含む）を Issue コメント用に整理（実装フェーズの成果物）。
- **カバー:** AC-20 + 完了条件の運用
