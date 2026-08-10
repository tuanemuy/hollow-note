# Review 001 — Use Case / Adapter

対象: PR #12（`issue/1/account-to-blank-note-skeleton` vs `origin/main`）
観点: アプリケーションロジック / ユースケース責務 / 二平面 UoW / outbox / in-memory アダプター契約準拠 / DI 配線
基準: CLAUDE.md、spec/usecases/{identity,note}.md、spec/domains/index.md、.thread/1/plan.md、.thread/1/adr.md（ADR-014〜022）

### Use Case / Adapter

#### Blockers

なし

主要な受け入れ基準（AC-1, 8〜14）に対応する契約は確認した範囲ですべて満たされている。特に以下は spec どおりであることを確認した:

- 二平面 UoW（`GlobalUnitOfWorkProvider` / `ScopeUnitOfWorkProvider.run(scope, fn)`）、ネスト禁止の ALS 検査（両平面共有）、mutex 直列化、undo ログの逆順ロールバック、EventId の `collectEvents` 時採番、outbox flush の同一トランザクション内実行、`relayTrigger.kick` の commit 後限定（ADR-014 どおり。`packages/core/src/adapters/memory/store.ts` / `globalUnitOfWork.ts` / `scopeUnitOfWork.ts`）。undo ログの抜けは見つからなかった: UoW 外ポート（`IdentityUniqueDirectory` / `NoteRouteStore` / `LoginAttemptStore` / `OAuthStateStore` / outbox claim / expiry sweep）はいずれも別 async 文脈から直接適用され、UoW 文脈内から呼ぶ経路は現行ユースケースに存在しない。flush（`save`）後・commit 前に throw しうるコードもなく「flush 済みだが巻き戻る」窓はない。
- `signUpWithPassword` の reserve→UoW→activate サガ、commit 失敗時 release、activate 応答喪失時の User 再読 + 同一 sub-operation ID での収束（`signUpWithPassword.ts` の `activateWithReconciliation`）、既存メールの応答同一（decoy userId — ADR-021）、メール失敗の記録・継続。
- `signInWithPassword` の `get`→`evaluate`→原子的 `recordFailure`→加算後再 `evaluate` による THROTTLED/LOCKED 昇格、`login_attempts` の UoW 外書き込みと失敗時の記録・継続、最終 UoW 内での User status/epoch 再読（W-001 の識別だけ除く）。`recordFailure` は同期 read-modify-write で原子（`loginAttemptStore.ts`）。
- `verifyEmail` の条件付き更新（`AuthTokenRepository.save(consumed)` が pending 行への条件付き更新 — `authTokenRepository.ts:42-55`）と、`AUTH_TOKEN_ALREADY_CONSUMED` 時に Session insert ごとロールバックして `alreadyVerified` へ縮退する形（spec 手順 6 どおり）。
- `authenticateSession` の読み取り専用性（成功経路無書き込み・期限/epoch 不一致行の best-effort delete は spec 手順 3/5 が明示的に認める例外で、`SessionReader` の `Pick` に `deleteById` を載せた ADR-019 の形とも一致）。全失敗の `UNAUTHENTICATED` 収斂。
- `createBlankNote` の route reserve→scope UoW（`assertWritable`/`assertActorWritable`→`bump`→`Note.createBlank(projectionRevision)` — ADR-011/018/022）→activate、commit 失敗時 abandon、activate 喪失時の同一 operation ID 再試行、`reserved` 期限切れの `recoverBlankNoteCreation`。タイトル検証はサガ前（空文字は `NoteTitle` が placeholder に落とすため事前 `manual()` 検証は長さ違反のみを弾く — 正しい）。workspace 分岐の `WORKSPACE_NOT_FOUND` 縮退。
- `getNote` の route→scope→`NoteAccessPolicy` 経路、`NOTE_NOT_FOUND` 収斂（`scopeRouter.resolveNote` は reserved/purging/期限切れ tombstone を不在扱い — `noteRouteStore.ts:readableRow`）、unlisted 所有者のみの `shareTokenProtector.reveal`。
- `pruneExpiredAuthState` の 3 入力分岐、lane claim / checkpoint / shard ack + 次 claim、lease owner 検査、`completed:false` の cursor 保持解放、全 sweep 失敗時のみ `SystemError(DatabaseError)`、`asOf` の cron 時固定（continuation は payload 値のみ）。`advanceOrAck` の別 shard auto-claim を解放して `claimLanes` で取り直す形は ADR-020 どおり。
- ドメインエラーの透過: `BusinessRuleError` を usecase 境界で再翻訳している箇所はない（`signInWithPassword` の `PlainPassword` catch は「WeakPassword を INVALID_CREDENTIALS に潰す」spec 要求の実装であり再翻訳ではない）。
- アダプターのエラー翻訳: memory アダプターは共有契約（`ConflictError("OPTIMISTIC_LOCK_FAILURE")` / `"EMAIL_ALREADY_USED"` / `"STALE_SCOPE_ROUTE"` / `"AUTH_TOKEN_ALREADY_CONSUMED"` / `SystemError(DatabaseError)`）のみを投げ、driver 例外の漏れなし。
- DI 配線の一貫性: `memoryRuntime.ts` が唯一の composition root で、`serverNode.ts` は `globalThis` シンボル pin（SSR/RSC グラフ分裂対策）越しに同一 backend を共有。`RequestContainer` の `Pick` による読み取り面の型的縮小と UoW 外書き込みポートの明示列挙は ADR-019 どおり。テストハーネス（`application/__tests__/helpers.ts`）は本番配線 `createMemoryRuntime` をそのまま使う。relay trigger の late-bind（`bindNodeRelayTrigger`）も runner 構築後に一度だけ結線されている（`server.node.ts`）。
- レイヤー依存方向: `application/scope.ts` / `application/ports/`（ADR-010）、decoder の application 配置（ADR-013）、adapters→application/domain の内向きのみ。`di/memoryRuntime.ts` の adapters import は composition root として許容（ADR-019 明記）。
- `IdempotencyStore.markProcessed(consumer, eventId)` へのシグネチャ変更は spec/domains/index.md の形と一致し、memory 実装は同期 check-and-set で原子。

#### Warnings

- **[W-001]** `signInWithPassword` の最終 UoW が PasswordIdentity の version を再検査していない — 場所: `packages/core/src/application/identity/signInWithPassword.ts:141-163` / 理由: spec/usecases/identity.md「認証資格発行と削除開始の直列化」は「password sign-inは照合に使ったPasswordIdentityのversionも再検査する」と明記するが、実装は User の status/epoch のみ再読して Session を insert する。照合〜insert の間に changePassword が確定した場合、旧パスワードで新セッションが発行される。本スライスでは changePassword が存在せず競合相手がいないため実害はなく、AC-9 の TC-identity-213..237 にも該当行がない（Blocker としない根拠）。/ 提案: `identityRepository` を `GlobalUnitOfWorkContext` 経由で再読し、照合に使った identity の version 一致を確認してから insert する形へ。少なくとも changePassword を実装するスライスまでに必須である旨をコード（JSDoc）か Issue コメントに残すこと。
- **[W-002]** `pruneExpiredAuthState` の cron 実行は、予算切れ・sweep 失敗以外の経路で claim したまま放置した lane を in-process では回収できない — 場所: `packages/core/src/application/identity/pruneExpiredAuthState.ts:242-247, 378-382`（budget break で `laneQueue` に残る claimed lane）、`packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts:154-178`（`claimLanes` は `pending` のみ返す）/ 理由: budget 到達時、`claimLanes` 済みで未処理の lane は `claimed` のまま `advanceOrAck(completed:false)` されずに関数が返る。次の cron は同一プロセス定数 `PRUNE_LEASE_OWNER` で `beginOrResumeKind`→`resumed` となり lease を**毎回更新**するため lease 失効による回復も起きず、`claimLanes` は pending しか返さないので当該 lane は永久に未処理となり run が完了しない。ADR-020 の回復モデル（continuation 入力の再送）は queue 配線がある前提で、本スライスの Node には配線がない（plan スコープ外として明示）。/ 提案: cron 経路で return する前に、未処理のまま `laneQueue` に残った lane を `advanceOrAck(completed:false)` で解放する（失敗経路と同じ形）。1 行の対称性の問題であり配線スライスを待つ必要はない。
- **[W-003]** Node runner の consumer role が no-op ハンドラーの前で UoW 外の `markProcessed` を呼ぶ — 場所: `apps/web/app/worker/node/runner.ts:71-82` / 理由: `IdempotencyStore` の契約（spec/domains/index.md、および本 PR が書いた `application/ports/idempotencyStore.ts` の JSDoc 自身）は「非可換な購読者だけが使い、記録と本処理は同一 UoW」。現状は購読者が存在しない no-op に対して記録だけが単独で確定する形で、契約のどちらの条件も満たさない。旧テンプレートの残骸だが、最初の実 consumer がこのパターンを写す危険がある。/ 提案: consumer が no-op の間は `markProcessed` 呼び出しを外す（冪等 consumer は使わない側）か、「実 consumer 導入時に UoW 同居へ置き換える」旨のコメントを契約参照つきで残す。
- **[W-004]** 暗号系アダプター（`passwordHasher` / `secureTokenGenerator` / `shareTokenProtector` / `timeZoneResolver`）が `adapters/memory/` に同居している — 場所: `packages/core/src/adapters/memory/{passwordHasher,secureTokenGenerator,shareTokenProtector,timeZoneResolver,timeZone}.ts` / 理由: これらは memory バックエンドの永続化契約と無関係な Node crypto / Intl 実装（`createNodeSecureTokenGenerator` と名前自体が示す）で、CLAUDE.md の「adapters はプロバイダーごとのグループ」の切り方から外れる。CF スライス（#11）が同じ実装を再利用する際、`adapters/memory` からの import は誤解を招く。/ 提案: `adapters/node/`（または `adapters/crypto/`）へ移すか、ADR に配置根拠を一行追記する。挙動上の問題はない。

#### カバレッジ

- 確認（精読）:
  - `packages/core/src/application/execution/unitOfWork.ts`, `application/scope.ts`, `application/errors.ts`(diff), `application/ports/idempotencyStore.ts`(diff), `application/workers/eventRelayWorker.ts`(diff), `application/__tests__/helpers.ts`
  - `application/di/{types,memoryRuntime,serverNode}.ts`
  - `application/identity/{signUpWithPassword,signInWithPassword,verifyEmail,authenticateSession,pruneExpiredAuthState}.ts`
  - `application/note/{createBlankNote,getNote,listNotes,accessControl}.ts`, `application/note/eventDecoders.ts`(スキム)
  - `packages/core/src/adapters/memory/{store,globalUnitOfWork,scopeUnitOfWork,support,scopeRouter}.ts`
  - `adapters/memory/repositories/{noteRouteStore,loginAttemptStore,identityUniqueDirectory,oauthStateStore,outboxRepository,idempotencyStore,authTokenRepository,sessionRepository,scopeCleanupAdmissionStore,globalMaintenanceRunStore}.ts`
  - `adapters/conformance/backend.ts`
  - `apps/web/app/server.node.ts`(diff), `apps/web/app/worker/node/runner.ts`(diff)
  - 契約照合のための spec: `spec/domains/index.md` 全文、`spec/usecases/identity.md`（共通の約束 / signUp / verifyEmail / signIn / authenticateSession / prune）、`spec/usecases/note.md`（共通節 / createBlankNote / getNote）、`spec/testcases/identity/signInWithPassword.md`
  - 判定に必要な差分外参照: `domain/note/{note,valueObject}.ts`（ADR-022 の検証）
- スキップ:
  - `adapters/memory/repositories/{userRepository,identityRepository,noteRepository,noteRevisionRepository,noteProjection,accountDeletionManifestStore,noteRouteFanOutReader,userBatchReader,localNoteQueryService,publicNoteQueryService}.ts`, `adapters/memory/{cursor,mailSender,passwordHasher,secureTokenGenerator,shareTokenProtector,timeZone,timeZoneResolver}.ts` — 精読した `support.ts`（OCC ヘルパー / keyset sweep）と `store.ts`（MemTable）の共通基盤の上の定型実装。重い 2 ストア（manifest / maintenance のうち後者は精読済み）の残り 1 つは ADR-017 で契約確定済み + 適合スイートが実行形（W-004 のみ配置の指摘に含む）
  - `adapters/conformance/*`（backend.ts 以外の適合スイート本体）、`adapters/memory/__tests__/*`、`application/{identity,note,workers,di}/__tests__/*` — テスト層は別観点レビューの担当。ハーネスが本番配線を共有すること（AC 前提）のみ確認
  - `application/ports/{accountDeletionManifestStore,globalMaintenanceRunStore,mailSender,noteMovePort,noteRouteFanOutReader,noteRouteStore,oauthStateStore,scopeCleanupAdmissionStore,scopeRouter,shareTokenProtector,timeZoneResolver}.ts`, `application/{identity,note}/view.ts`, `application/identity/eventDecoders.ts`, `application/types.ts` 由来の変更, `packages/core/src/config.ts` — シグネチャは spec/domains/index.md と実装側から相互照合（個別精読なし）
  - `packages/core/src/domain/**`（identity / note / workspace / storage / conversion / job の追加・削除、common/{pagination,time}.ts, conversion/valueObject.ts） — ドメイン層観点の担当（usecase 契約に関わる箇所のみ targeted read）
  - 削除ファイル群: `application/todo/**`, `adapters/{libsql,d1,aws,cloudflare,gcp}/**`, `di/server{Aws,Cloudflare,Gcp}.ts` + そのテスト, `apps/web/app/worker/{aws,cloudflare,gcp}/**`, `apps/web/app/server.{aws,cloudflare,gcp}.ts`, `apps/web/{scripts,drizzle*,wrangler*,vite.config.{aws,cloudflare,gcp}.ts,Dockerfile.gcp}`, `infra/**`, `vitest.config.integration*.ts`, `docs/runtime_{aws,cloudflare,gcp}.md` — ADR-004/009 が根拠の削除。参照切れの検出は typecheck / CI（AC-20）に委譲
  - `apps/web/app/{components,routes,presentation,styles}/**`, `routeTree.gen.ts`, `__root.tsx`, `index.tsx`, `vite.config.node.ts` — presentation / frontend 観点の担当
  - `.github/workflows/ci.yml`, `biome.json`, `package.json`(root/web/core), `pnpm-{lock,workspace}.yaml`, `vitest.config.ts`, `docs/*.md`, `apps/web/.env.example`, `.thread/1/*` — ツーリング / ドキュメント（usecase・adapter 契約に影響する差分なしを diff 一覧で確認）
