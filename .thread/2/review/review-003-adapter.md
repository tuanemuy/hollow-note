# レビュー 003 — Adapter / Infrastructure

対象 PR: #17（`issue/2/account-management-and-auth` → `main`）。ゼロベースで実施。

## Adapter / Infrastructure

### Blockers

なし。

観点ごとの実地確認の結果は以下のとおり。

- **dev IdP の production 漏れ**: `pnpm build` 成功後、手元の `.env`（`OAUTH_DEV_MODE=true`）のまま `pnpm start` を実行 → `ZodError: OAUTH_DEV_MODE=true cannot be combined with NODE_ENV=production` で起動失敗を確認。`OAUTH_DEV_MODE=false` + Google 資格情報（ダミー）+ `NODE_ENV=production`（`listen.node.ts` が `??=` で宣言）で起動し、`/dev/oauth/authorize?…` が **404**。`pnpm dev`（`OAUTH_DEV_MODE=true`）では同 URL が **200**。ルート loader も `submitDevConsentFn` も `RequestContainer.oauthDevMode` だけを読み、env を直読みしていない（`apps/web/app/routes/dev/-action.tsx:18,47`）。
- **ランタイム singleton と dev の HMR**: `pnpm dev` 起動 → `app/server.node.ts` を touch → ログは `worker runner started` / `retiring the previous boot` / `worker runner started` の順で、多重起動なし。`initNodeRuntime` の env digest ガード + `memoryRuntime()` の未初期化 throw は `di/__tests__/serverNode.test.ts` が 3 ケースで固定している。
- **転送境界の本文サイズ上限**: `Content-Length: 13MB` の POST が **413**（本文を 1 バイトも読まずに拒否）。chunked は「アプリが読んだ分だけ数える」実装なので、本文を読まないルートへの 13MB chunked POST は 200 になるが、これは「読まない＝バッファもしない」ケースであり実害はない。
- **継続タスクの無限ループ**: `runDueScopeTasks` は throw したタスクを自ら `backoff` し、`SCOPE_TASK_MAX_ATTEMPTS`(8) で `failed` に落ちる。`workers/__tests__/scopeTaskRunner.test.ts` の "backs a throwing task off…" が attempt 数まで含めて実際に固定している。ハンドラー未登録の kind は due のまま警告するだけだが、現在スケジュールされる 3 kind はすべて登録済みで到達不能。
- **Retry / エラー翻訳**: Google アダプターは 4xx→`ValidationError("OAUTH_CODE_INVALID")`、transport / 5xx / 壊れた応答 / timeout→`SystemError(ExternalApiError)` に統一し、`id_token` の `iss` / `aud`(配列可) / `exp` / `sub` / `email` を検証。`__tests__/googleSignInOAuthClient.test.ts` が 11 ケースで全分岐を押さえている。認可コードが単回使用なので再試行しない判断も JSDoc に理由つきで書かれている。
- **outbox の id 衝突契約**: memory `save` は「保存済み id はスキップ（行を一切触らない）」で、ポート JSDoc が attempts / retry schedule / processed の各不変条件を明示し、適合スイートに 3 ケース追加されている。ADR-019 の当初案（upsert して 1 度だけ再配送）より強い保証で、`execution/__tests__/eventId.test.ts` が `continuationKey` 由来の決定的 ID と通常イベントの区別を固定している。
- **適合スイートの実効性**: 新規 9 スイート + 既存 4 スイート改訂を確認。`describeSignInOAuthClientContract` は「認可要求の純粋な半分（常時実行）」と「コード交換の半分（`offline` harness のみ実行）」に分割され、skip 側でも minter が throw する形なのでゲートを誤って広げた瞬間に落ちる。`describeAccountDeletionManifestStoreContract` は必須 receipt 集合を**わざと真部分集合**にして駆動し、フルセットを焼き込んだ実装が落ちるようになっている。`pnpm test:unit` は 891 passed / 3 skipped（Google 交換の 3 ケースのみ）で緑。

### Warnings

- **[W-001]** scope 平面の commit kick（ADR-023）がどのテストからも実行されていない
  - 場所: `packages/core/src/adapters/memory/scopeUnitOfWork.ts:45-53,94-96` / `packages/core/src/application/di/memoryRuntime.ts:141-152`
  - 理由: `ScopeTaskScheduler.schedule` を包んで `scheduled` を立て、commit 後に `scopeTaskTrigger.kick()` する配線は、`MemoryUnitOfWorkOptions.scopeTaskTrigger` を渡す呼び出し側が `createMemoryRuntime` だけ。適合バックエンド（`adapters/memory/__tests__/conformanceBackend.ts:70-79`）も `createTestHarness` も `relayTrigger` しか渡さないので、`scheduled` フラグと kick の行は**テストスイート上は到達しない**。`ConformanceBackend` には `relayKickCount()` があるのに scope task 側には対応する観測点が無く、`spec/adr/026` の決定 4（「Unit of Work の実行境界とイベントの enqueue、リレーの起動回数は…適合バックエンドはこれらを観測可能にする」）が明示的に「壊れやすさ最大」と位置づけた性質の、ADR-023 が新設した完全な同型物が唯一無観測になっている。この行を消しても 891 テストは全部緑のままで、症状は「削除の 1 ターンごとに最大 `scopeTaskIntervalMs`(1s) 待つ」という遅延だけなので、回帰しても誰も気づかない。
  - 提案: `ConformanceBackend` に `scopeTaskKickCount()` を足し、`describeScopeTaskSchedulerContract` に「continuation を保存して commit した scope UoW は kick を 1 回だけ起こす / ロールバックした UoW は起こさない」の 2 ケースを追加する（`relayKickCount` と同じ形）。スイートに載せたくないなら最低限 memory ローカルのユニットテスト 1 本を `adapters/memory/__tests__/unitOfWork.test.ts` に足す。
- **[W-002]** `DistributedOperationStore.markState` のポート契約が「不正な遷移は `ConflictError`」と約束しているが、実装も適合スイートも遷移を一切拘束していない
  - 場所: `packages/core/src/application/ports/distributedOperationStore.ts:50-51` / `packages/core/src/adapters/memory/repositories/distributedOperationStore.ts:79-94` / `packages/core/src/adapters/conformance/distributedOperationStore.ts:134-152`
  - 理由: JSDoc の Error contract は `ConflictError`（unknown operation, **illegal transition**）と書くが、memory 実装は未知 ID しか弾かず、`completed` → `running` も通る（しかも `terminalAt` が `null` に戻るので `countTerminalSince` の計数からも `deleteTerminal` の対象からも外れる＝`AccountDeletionRetryPolicy` の根拠データが壊れる）。適合スイートも unknown ID のケースしか置いていない。`spec/adr/026` の決定 1 は「契約の正本はポート定義に置き、インターフェースと JSDoc だけを読んで実装者が必要な振る舞いに到達できること」なので、#11 の D1 実装者は「遷移を厳格に弾く」実装も「何でも通す」実装も書けてしまい、どちらもスイートを通る。今日は `compaction.ts:54-56` が `header.status === "completed"` で早期 return するため二重呼び出しが起きず実害は出ていないが、同じポートを再利用する #7（note move）で顕在化しうる。
  - 提案: 契約を実装側に寄せる（JSDoc から "illegal transition" を落とし、「状態は呼び出し側が決める」ことを明記する）か、スイート側に寄せる（terminal → running を `ConflictError` にする 1 ケースを `describeDistributedOperationStoreContract` に足し、memory 実装で弾く）かのどちらかに倒す。
- **[W-003]** `docs/test.md` の記述が本 PR の `vitest.config.ts` と矛盾している
  - 場所: `docs/test.md:37` / `vitest.config.ts:15-18`
  - 理由: 本 PR は `testTimeout: 30_000`（既定 5s の 6 倍）を追加したが、`docs/test.md` の「Timeout / flakiness」節は "The configs use Vitest's default timeouts; everything runs in-process with a controlled clock, so flakiness should be treated as a bug, not retried around." のまま。テストが遅い／落ちるときに最初に読む節が、実際の設定と逆のことを書いている。
  - 提案: 同節に「scrypt(N=16384) の派生を連鎖する password 系ケースのため `testTimeout` を 30s に引き上げている。時計は依然 `TestClock` で制御されているので、タイムアウトで落ちたら実装のバグとして扱う」旨を 1 文足す。

### カバレッジ

確認（98 件）:

- `apps/web/.env.example`（1）
- `apps/web/app/presentation/devOAuth.ts`（1）
- `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/storage.$.tsx`（3）
- `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `apps/web/scripts/listen.node.ts`（4）
- `docs/runtime_node.md`, `docs/test.md`（2）
- `packages/core/src/adapters/**` — 一覧 #90〜#132 の全件（43）
- `packages/core/src/application/__tests__/helpers.ts`（1）
- `packages/core/src/application/cleanup/participants.ts`, `.../personalCleanup.ts`（2）
- `packages/core/src/application/di/**` — #136〜#139（4）
- `packages/core/src/application/execution/**` — #140〜#142（3）
- `packages/core/src/application/identity/deleteAccount/compaction.ts`, `.../terminalPrune.ts`（2）
- `packages/core/src/application/ports/**` — #209〜#218（10）
- `packages/core/src/application/storage/{deleteFiles,deleteFilesByOwner,deleteStoredObjects,storeAvatar}.ts`（4）
- `packages/core/src/application/workers/**` — #236〜#240（5）
- `packages/core/src/domain/common/event.ts`（1）
- `packages/core/src/domain/identity/ports/**` — #244〜#246（3）
- `packages/core/src/domain/note/ports/**` — #252〜#255（4）
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`, `packages/core/src/domain/storage/valueObject.ts`（2）
- `packages/core/src/domain/usage/ports/**` — #269, #270（2）
- `vitest.config.ts`（1）

スキップ（176 件）:

- `.thread/2/**`（17 件、#1〜#17） — plan.md / adr.md は契約として通読したが、実装差分ではなくプロセス成果物。
- `apps/web/app/components/**`（37 件、#19〜#55） — UI コンポーネントとミューテーション三層の担当はフロントエンド観点。
- `apps/web/app/presentation/**`（#56〜#60, #62〜#66）と `apps/web/app/routes/**`（#67〜#70, #73〜#81, #83）（24 件） — 転送境界の検証・Cookie・エラー表示・ルート構成はフロントエンド / セキュリティ観点（`devOAuth.ts` とデバッグ IdP ルート・配信ルートのみ本観点で確認済み）。
- `packages/core/src/application/identity/**`（compaction.ts / terminalPrune.ts を除く 64 件、#143〜#189・#191〜#208） — ユースケースのオーケストレーションはドメイン / ユースケース観点。
- `packages/core/src/application/storage/__tests__/**`（3 件、#219〜#221） — ユースケーステスト。
- `packages/core/src/application/storage/eventDecoders.ts`, `.../view.ts`（2 件、#225, #227） — DTO / デコーダーはユースケース観点。
- `packages/core/src/application/usage/**`（7 件、#228〜#234） — ユースケース観点。
- `packages/core/src/application/workers/__tests__/outboxPrune.test.ts`（1 件、#235） — ランナー配線ではなく既存 prune ユースケース内部の追補。
- `packages/core/src/domain/identity/**`（ports を除く 7 件、#242, #243, #247〜#251） — ドメイン観点。
- `packages/core/src/domain/note/valueObject.ts`（1 件、#256） — ドメイン観点。
- `packages/core/src/domain/storage/**`（ports / valueObject を除く 5 件、#257〜#259, #261, #262） — ドメイン観点。
- `packages/core/src/domain/usage/**`（ports を除く 8 件、#264〜#268, #271〜#273） — ドメイン観点。

確認 98 + スキップ 176 = 274。
