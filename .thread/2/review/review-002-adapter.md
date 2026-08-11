### Adapter / Infrastructure

#### Blockers

なし

ゼロベースで確認した結果、ポート契約とアダプター実装の整合・適合テストの実効性・DI の env 経路・dev IdP の production 漏れ防止は、いずれも実際に動かして裏が取れた。

- `pnpm dev`（`OAUTH_DEV_MODE=true`）: 起動成功。`/dev/oauth/authorize` は到達可能（search param 検証まで進む）。
- `pnpm start` 相当（`dist/server/server.node.js` + `scripts/listen.node.ts`、`.env` に `OAUTH_DEV_MODE=true`）: `ZodError` で起動拒否。メッセージは `OAUTH_DEV_MODE=true cannot be combined with NODE_ENV=production`。`listen.node.ts` の `process.env.NODE_ENV ??= "production"` が dotenv より前に置かれているので `.env` からは下げられない。
- 同ビルドを Google 資格情報で起動: `/` は 200、`/dev/oauth/authorize` は **HTTP 404**、`/storage/foo` も 404。AC-6 の「`OAUTH_DEV_MODE` が偽のときは 404」はステータスコードまで成立している。
- `pnpm test:unit`: 72 files / 862 passed / 3 skipped（skip は Google の exchange 半分のみ）。

#### Warnings

- **[W-001]** `docs/runtime_node.md` の Worker runner 表と env 表が本 PR の変更を反映していない
  - 場所: `docs/runtime_node.md:88-97`（Worker runner 表）, `docs/runtime_node.md:58-70`（env 表）
  - 理由: Consumer 行は依然 "`InMemoryQueueDispatcher` — currently a no-op handler: no event subscriber exists in the walking-skeleton slice" だが、AC-32 で `server.node.ts:103` が `dispatchDomainEvent` に置き換わっている。Pruner 行も "24-hour `setInterval` running `pruneOutbox` only" のままだが、実際は `pruneAccountDeletionManifests` と removal receipt sweep も同じ tick で回る（`apps/web/app/worker/node/runner.ts:123-181`）。scope task ランナー（既定 1 秒 + commit kick、ADR-023）の行そのものが表に無い。env 表には `DELETION_TICKET_KEY` が無い（`.env.example` には追加済み）。この doc は「Node ランタイムの運用の正典」なので、ここが古いと配備者が consumer / 保持期限回収の存在を知れない。
  - 提案: Worker runner 表に Scope tasks 行を足し、Consumer / Pruner 行を実装に合わせる。env 表に `DELETION_TICKET_KEY`（未設定 = プロセス毎の鍵、再起動で発行済み ticket が読めなくなる）を追加する。

- **[W-002]** dev サーバーの再ロードで worker runner が多重起動する（ランタイム singleton だけがガードされている）
  - 場所: `apps/web/app/server.node.ts:88-115`, `apps/web/app/server.node.ts:162-174`, `packages/core/src/application/di/serverNode.ts:200-227`
  - 理由: `initNodeRuntime` の JSDoc 自身が「`vite dev` が `boot()` を再実行する」前提で書かれており（同じ env なら singleton を維持する）、`server.node.ts` も ALS を `import.meta.hot.data` に退避してモジュール再評価を想定している。ところが `bootPromise` はモジュールスコープなので再評価で `null` に戻り、`boot()` は毎回 **新しい** `createNodeWorkerRunner(...)` を作って `start()` する。前のランナーは `stop()` されないので、relay / prune / scopeTask の `setInterval` と `process.on("SIGTERM"/"SIGINT")` がそのまま残り、同じシングルトン backend に対して 2 本目以降の tick が走る。relay は lease で守られるが、`ScopeTaskScheduler.claimDue` はリースを持たず「scope は single writer」を前提にしているだけなので（`packages/core/src/application/ports/scopeTaskScheduler.ts:34-39`）、2 本のラウンドが同じ turn を同時に実行しうる。`deleteFilesByOwner` の場合、後から入った側は `page.items.length > 0 && deletedCount === 0` に落ちて `backoffOrSchedule` するため、進んでいるのに指数バックオフが掛かる。加えてリスナー累積で `MaxListenersExceededWarning` が出る。
  - 提案: ランタイム singleton と同じ規律をランナーにも掛ける。`boot()` の入口で `globalThis` / `import.meta.hot.data` に保持した前回のランナーを `await previous.stop()` してから新しいものを `start()` する（もしくは runner 自体を singleton にする）。

- **[W-003]** `identity_removal_receipts` の回収経路が二重化し、コメントが事実と食い違っている
  - 場所: `apps/web/app/worker/node/runner.ts:139-159`
  - 理由: JSDoc は「The store is a plain keyset sweep rather than a maintenance-run lane, so the bound lives here」と書くが、実際には同じ表が `AuthStateTable` に追加され（`packages/core/src/application/di/types.ts:196-201`）、`authStateSweeps.identity_removal_receipts` として `WorkerContainer` に載り（`packages/core/src/application/di/memoryRuntime.ts:275`）、`pruneExpiredAuthState` の lane として掃かれる（`packages/core/src/application/identity/pruneExpiredAuthState.ts:64-68, 477-481`）。memory backend の `DEFAULT_MAINTENANCE_TABLES.authStatePrune` にも登録済み。つまりコメントの前提が成り立っておらず、`pruneExpiredAuthState` に cron が付く時点（Issue #15）で同一の表を bookkeeping 有り / 無しの 2 系統が別々の上限で掃くことになる。
  - 提案: runner 側の独自 sweep を落として `pruneExpiredAuthState` の lane に一本化する（本 Issue では cron が無いので、runner が `pruneExpiredAuthState` を呼ぶ形に寄せる）。残すならコメントを実態に合わせ、二重化を意図として明記する。

- **[W-004]** prune tick が起動時に一度も走らず、保持期限の回収が短命プロセスで永久に行われない
  - 場所: `apps/web/app/worker/node/runner.ts:220-227`
  - 理由: relay は `start()` で `track(runRelayTick())` の即時ドレインを持ち、scope task も `scopeTaskTrigger.kick()` を打つのに、prune だけは `setInterval(…, 24h)` の登録のみ。本 PR でこの tick に「manifest terminal prune（120 日保持の terminal header + control plane 行の回収）」と「removal receipt sweep（30 日）」という個人データの保持期限回収が 2 件乗った。デプロイ間隔が 24 時間より短い配備、および `pnpm dev` の再起動では、これらが一度も実行されない。
  - 提案: relay と同じく `start()` で 1 回 `track(runPruneTick())` を打つ（起動直後の実行が重い場合は短いランダム遅延を挟む）。

- **[W-005]** ハンドラー未登録の scope task が毎 tick（既定 1 秒）警告ログを出し続ける
  - 場所: `packages/core/src/application/workers/scopeTaskRunner.ts:116-123`
  - 理由: 未知の kind は「leaving it due」で放置され backoff もされないので、`listDue` に毎回返り、`logger.warn` が 1 秒に 1 回、プロセスが生きている間ずっと出る。`dueAt` 昇順で並ぶため、古い未知行は常に先頭に来て毎ラウンド budget も消費する。「可視な停滞のほうが良い」という設計判断は妥当だが、可視性の代償が定常的なログ洪水になっている。`scopeTaskRunner.test.ts:125-146` は 1 ラウンドしか回さないので、この性質はテストで固定されていない。
  - 提案: 警告をレート制限する（同一 `(kind, operationId)` は初回と一定間隔のみ）か、`backoff` させたうえで `failed` に落とさない扱いにする。少なくとも「未知 kind が毎 tick ログを出す」ことを JSDoc に明記する。

- **[W-006]** `beginRelease` の「`reserved` 行は no-op」が契約に書かれておらず、適合スイートにも無い
  - 場所: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:44-56`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:119-138`
  - 理由: memory 実装は `row.state === "reserved"` を明示的に no-op にしているが、ポートの JSDoc は「A missing row or a row held by another user is a no-op」としか書いていない。`reserved` を releasing に再キーする実装も契約違反にならず、その場合は続く `release(operationId)` が**別オペレーションの進行中予約を削除する**（`release` は reserved / releasing の両方を消す）。ADR-026 の「契約の正本はポート定義に置き、適合スイートだけが規定する振る舞いを残さない」に照らして、いま欠けているのはポート文とスイートの両方。追加された 5 ケース（`ADP-identity-009` 群）は active / 非所有者 / 不在 / 冪等は押さえているが、`reserved` 行は 1 件も触っていない。
  - 提案: ポート JSDoc に「まだ `reserved` の行には触れない（durable な claim の解体だけを扱う）」を書き、適合スイートに「`reserve` 直後の行に `beginRelease` + `release` をしても予約が残る」ケースを 1 本足す。

- **[W-007]** 新設 `ScopeTaskScheduler` / `ScopeTaskQueue` が `spec/database` の `scheduled_tasks` から `priority` を落としているが、縮退として記録されていない
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:1-77`, `packages/core/src/application/ports/scopeTaskQueue.ts:26-28`, 対比: `spec/database/index.md#scheduled_tasks`
  - 理由: spec は `priority` 列と `(priority, due_at, kind, operation_id)` の索引を定め、「Alarm turn は priority ごとの最低枠を確保する weighted round-robin で処理し、低 priority の大量 task が security cleanup を飢餓させない」と明示している。実装のポートは `dueAt` 昇順のみで priority を持たず、`status` も spec の `pending / running / failed` に対し `pending / failed`（`running` を持たない＝リース無し）。後者はポート JSDoc が「scope は single writer」として意図を書いているが、priority については plan.md の縮退節にも `.thread/2/adr.md` にも記載が無い。本 Issue が初めてこの表を作る以上、ここで凍結した署名が #11 の D1/DO 実装の前提になる。
  - 提案: priority を落とした判断を縮退（または ADR）として記録し、#11 への引き継ぎに載せる。将来足す前提なら `claimDue` / `listDue` の並び順契約に「今は `dueAt` のみ」と明記しておく。

- **[W-008]** Google アダプターのエラー翻訳がほぼ無検証
  - 場所: `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts:11-44`, 対象: `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts:145-170`
  - 理由: 共有スイートの exchange 半分は Google では**常に** skip される設計なので（`packages/core/src/adapters/oauth/__tests__/conformance.test.ts:52-58`）、Google 固有の翻訳規則を守るのはこのローカルテストだけ。ところが実装されているのはタイムアウト 1 ケースのみで、4xx → `ValidationError("OAUTH_CODE_INVALID")`、5xx → `SystemError(EXTERNAL_API_ERROR)`、`id_token` 欠落 / JSON 破損 / `sub`・`email` 欠落の各分岐は 1 つもテストされていない。これらは「ドライバー固有エラーを共有のエラー契約へ翻訳する」というアダプター層の中心的責務で、間違えると利用者に 4xx/5xx が逆に出る。既存テストが `vi.stubGlobal("fetch", …)` を使えている以上、テストできない事情も無い。
  - 提案: `fetch` スタブで 400 / 500 / `id_token` 欠落 / 壊れた JSON の 4 ケースを足す。

- **[W-009]** 継続イベントに購読者が 1 つも無い状態が型でもテストでも検出できない
  - 場所: `packages/core/src/application/workers/subscribers.ts:40-140`, `packages/core/src/application/workers/__tests__/subscribers.test.ts:83-88`
  - 理由: `dispatchDomainEvent` は購読者 0 件を warn して ack する（ドメインイベントには正しい判断で、JSDoc もそう書いている）。だが `IdentityContinuationEvent` は `continuations.ts:13-17` が「exactly one subscriber」と定めるもので、登録漏れは**削除チェーンの無言の停止**になる（AC-29 の「継続が黙って消えて止まらないか」がまさにここ）。`subscribers` は `readonly EventSubscriber[]` なので網羅性の型制約が無く、テストも `consumerName` の一意性しか固定していない。
  - 提案: 継続イベント型の集合をレジストリが覆っていることを 1 本のテストで固定する（`IdentityContinuationEvent["type"]` のリテラル集合と `subscribers.map(s => s.eventType)` の差集合が空）。型レベルで縛るなら継続イベント専用のレジストリを `Record<ContinuationType, Subscriber>` にする。

- **[W-010]** `apps/web/app/worker/node/runner.ts` にテストが 1 本も無い
  - 場所: `apps/web/app/worker/node/runner.ts`（`apps/web` 配下のテストは `app/presentation/__tests__/` のみ）
  - 理由: 本 PR でこのファイルに「scope task の 1 秒 interval + 起動時 kick + `unref`」「`stop()` での 2 トリガーのドレイン」「receipt sweep のページ上限とカーソル送り」「prune tick の 3 本立てと相互の例外隔離」が追加された。AC-29 の「プロセスを落として再起動しても未完の継続を拾って完走する」はコア側の `scopeTaskRunner.test.ts:100-123` が列挙の側を担保しているが、それを周期的に駆動し停止時にドレインする側は無検証で、W-002 / W-004 のような欠落もテストでは落ちない。
  - 提案: fake timer と記録用 logger で、`start()` が scope task を即座に 1 回駆動すること・`stop()` が in-flight を待つこと・`runPruneTick` の 3 本が互いの例外で止まらないことを固定する（コンテナは `createTestHarness` の `workerContainer` を流用できる）。

- **[W-011]** `prunePersonalCleanupBarriers` の継続分岐が memory では構造的に到達不能で、実際に無検証
  - 場所: `packages/core/src/application/cleanup/personalCleanup.ts:97-108`
  - 理由: `removed === PERSONAL_BARRIER_PRUNE_PAGE_SIZE`（100）のときに同じ `asOf` で task を再登録する分岐は、spec/database の「Alarm pruner は `expires_at <= asOf` を最大 100 件ずつ消し、100 件なら同じ固定 `asOf` の task を再登録する」に対応する。ところが 1 scope が持つ barrier receipt は最大 1 件で、適合スイート自身が「one scope holds at most one receipt, so no page cap can bind」と書いている（`packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts:158-160`）。つまりこの分岐は memory バックエンドではどのテストからも通らない「緑だが無検証」のコードで、`deleteAccount.terminalPrune.test.ts` も到達していない。
  - 提案: 到達不能であることを JSDoc に明記して #11（scope が複数 receipt を持ちうるバックエンド）へ引き継ぐか、`pruneCompleted` の返り値を注入できる形にしてページ継続だけを単体で固定する。

#### カバレッジ

一覧 250 件に 1 対 1 で対応（確認 102 + スキップ 148 = 250）。

- 確認:
  - `apps/web/.env.example`
  - `apps/web/app/components/settings/IdentityList/action.ts`
  - `apps/web/app/components/settings/ProfileForm/action.ts`
  - `apps/web/app/components/settings/UsagePanel/action.ts`
  - `apps/web/app/presentation/deletionTicket.ts`
  - `apps/web/app/presentation/devOAuth.ts`
  - `apps/web/app/presentation/oauthStateBinding.ts`
  - `apps/web/app/presentation/oauthStateCookie.ts`
  - `apps/web/app/routes/__root.tsx`
  - `apps/web/app/routes/auth/-action.tsx`
  - `apps/web/app/routes/dev/-action.tsx`
  - `apps/web/app/routes/dev/oauth/authorize.tsx`
  - `apps/web/app/routes/settings/-action.tsx`
  - `apps/web/app/routes/storage.$.tsx`
  - `apps/web/app/server.node.ts`
  - `apps/web/app/worker/node/runner.ts`
  - `apps/web/scripts/listen.node.ts`
  - `docs/runtime_node.md`
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
  - `packages/core/src/adapters/memory/__tests__/conformance.test.ts`
  - `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`
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
  - `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`
  - `packages/core/src/adapters/oauth/__tests__/googleSignInOAuthClient.test.ts`
  - `packages/core/src/adapters/oauth/devSignInOAuthClient.ts`
  - `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`
  - `packages/core/src/adapters/oauth/pkce.ts`
  - `packages/core/src/adapters/oauth/signInOAuthClient.ts`
  - `packages/core/src/application/__tests__/helpers.ts`
  - `packages/core/src/application/cleanup/participants.ts`
  - `packages/core/src/application/cleanup/personalCleanup.ts`
  - `packages/core/src/application/di/__tests__/serverNode.test.ts`
  - `packages/core/src/application/di/memoryRuntime.ts`
  - `packages/core/src/application/di/serverNode.ts`
  - `packages/core/src/application/di/types.ts`
  - `packages/core/src/application/execution/__tests__/eventId.test.ts`
  - `packages/core/src/application/execution/eventId.ts`
  - `packages/core/src/application/execution/unitOfWork.ts`
  - `packages/core/src/application/identity/continuations.ts`
  - `packages/core/src/application/identity/identityRemovalRelease.ts`
  - `packages/core/src/application/identity/pruneExpiredAuthState.ts`
  - `packages/core/src/application/identity/startOAuthFlow.ts`
  - `packages/core/src/application/identity/uniqueness.ts`
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
  - `packages/core/src/application/storage/deleteFilesByOwner.ts`
  - `packages/core/src/application/storage/deleteStoredObjects.ts`
  - `packages/core/src/application/usage/recalculateStorageUsage.ts`
  - `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
  - `packages/core/src/application/workers/__tests__/subscribers.test.ts`
  - `packages/core/src/application/workers/eventRelayWorker.ts`
  - `packages/core/src/application/workers/scopeTaskRunner.ts`
  - `packages/core/src/application/workers/subscribers.ts`
  - `packages/core/src/domain/common/event.ts`
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`
  - `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`
  - `packages/core/src/domain/identity/ports/signInOAuthClient.ts`
  - `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`
  - `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`
  - `packages/core/src/domain/storage/ports/storedFileRepository.ts`
  - `packages/core/src/domain/usage/ports/llmUsageRepository.ts`
  - `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`

- スキップ:
  - `.thread/2/**`（12 件: `adr.md`, `plan.md`, `progress.md`, `steps.md`, `testing.md`, `review/review-001.md`, `review/review-001-adapter.md`, `review/review-001-domain-usecase.md`, `review/review-001-frontend.md`, `review/review-001-security.md`, `review/review-001-test.md`, `review/triage.md`）— 計画・レビュー記録の文書でアダプター/インフラの実装ではない（`plan.md` は契約として参照済み）
  - `apps/web/app/components/**` の action 3 本を除く全 27 件（`auth/OAuthButton`, `auth/OAuthCallbackPanel`, `auth/ResendVerificationForm/{action,index}`, `auth/ResetPasswordPanel/{action,index}`, `auth/SignInForm`, `auth/SignUpForm`, `auth/VerifyEmailPanel`, `auth/schema.ts`, `dev/DevConsentForm`, `layout/AccountMenu/{action,index}`, `layout/AppShell`, `layout/SettingsTabs`, `settings/AddPasswordForm`, `settings/ChangePasswordForm`, `settings/DeleteAccountPanel`, `settings/IdentityList/{board,index}`, `settings/IdentityListSkeleton`, `settings/ProfileForm/{editor,index}`, `settings/ProfileFormSkeleton`, `settings/UsagePanel/index`, `settings/UsagePanelSkeleton`, `settings/panelStyles.ts`）— UI コンポーネント/三層ミューテーションでフロントエンド観点
  - `apps/web/app/presentation/__tests__/{deletionTicket,devOAuth,oauthStateBinding}.test.ts` と `apps/web/app/presentation/errorDisplay.ts`（4 件）— 転送境界の署名・文言でセキュリティ/フロントエンド観点（実装側の `deletionTicket.ts` / `devOAuth.ts` / `oauthStateBinding.ts` は確認済み）
  - `apps/web/app/routeTree.gen.ts`（1 件）— 生成物
  - `apps/web/app/routes/{callback.$provider.tsx, notes/index.tsx, reset-password.tsx, settings/{auth,danger,index,profile,route,usage}.tsx}`（9 件）— 画面ルートでフロントエンド観点（server function 登録の副作用 import は `__root.tsx` 側で確認済み）
  - `packages/core/src/application/identity/__tests__/**`（31 件）— ユースケース挙動の検証でドメイン/ユースケース観点
  - `packages/core/src/application/identity/` の未確認実装 29 件（`addPasswordIdentity`, `authResidueCleanup`, `changePassword`, `checkHandleAvailability`, `completeOAuthCallback`, `completeOAuthSignIn`, `deleteAccount/**` 10 件, `eventDecoders`, `getAccountDeletionStatus`, `getProfile`, `linkOAuthIdentity`, `listIdentities`, `removeIdentity`, `requestPasswordReset`, `resendVerificationEmail`, `resetPassword`, `signOut`, `signOutOtherSessions`, `updateProfile`, `view`）— ユースケース観点（継続イベントの生成側だけ `continuations.ts` として確認）
  - `packages/core/src/application/note/__tests__/createBlankNote.test.ts`（1 件）— ユースケース観点
  - `packages/core/src/application/storage/{__tests__/deleteFiles.test.ts, __tests__/deleteFilesByOwner.test.ts, __tests__/storeAvatar.test.ts, deleteFiles.ts, eventDecoders.ts, storeAvatar.ts, view.ts}`（7 件）— ユースケース観点
  - `packages/core/src/application/usage/{__tests__ 3 件, deleteQuota.ts, getUsageSnapshot.ts, view.ts}`（6 件）— ユースケース観点
  - `packages/core/src/application/workers/__tests__/outboxPrune.test.ts`（1 件）— 既存 relay/prune の回帰で本 PR の差分は保持期限の呼び出し側のみ
  - `packages/core/src/domain/identity/{__tests__/policies.test.ts, errorCode.ts, services/accountDeletionRetryPolicy.ts, services/identityPolicy.ts, services/sameOriginPolicy.ts, valueObject.ts}`（6 件）— ドメイン観点
  - `packages/core/src/domain/storage/{__tests__/storage.test.ts, errorCode.ts, events.ts, services/uploadValidationPolicy.ts, storedFile.ts, valueObject.ts}`（6 件）— ドメイン観点
  - `packages/core/src/domain/usage/{__tests__ 2 件, errorCode.ts, events.ts, llmUsage.ts, services/quotaEnforcement.ts, storageQuota.ts, valueObject.ts}`（8 件）— ドメイン観点
