### Adapter / Infrastructure

#### Blockers

- なし

#### Warnings

- なし

#### 検証した論点（結論つき）

ゼロベースで下記を独立に検証し、いずれも実害のある不整合は見つからなかった。

- **ポート契約 ⇔ 実装の整合**: `ScopeTaskScheduler` / `ScopeTaskQueue` / `AppliedOperationStore` / `DistributedOperationStore` / `IdentityRemovalReceiptStore` / `ObjectStorage` / `StoredFileRepository` / `StorageQuotaRepository` / `LlmUsageRepository` の JSDoc の記述（upsert 鍵、`dueAt` 昇順、`attempt` の起点と `SCOPE_TASK_MAX_ATTEMPTS` での `failed` 化、`backoff` の no-op 条件、`beginRelease` の re-key、`terminalAt` の追従、`deleteTerminal` の `ConflictError`、`put` が実体から測った値を返す、`sumSizeByOwner` の `artifact` 除外）を memory 実装と 1 つずつ突き合わせた。契約化されているのは観測可能な結果のみで、内部表現（`scopeTaskKey` の NUL 連結、`appliedOperationId` の sha256 折り畳み、`storageQuotaKey`）はいずれもポートに漏れていない。`ScopeTaskScheduler` の priority / lease 欠落は JSDoc に縮退として明記済み（#19）。
- **適合テストの実効性**: 新設 9 スイート＋改訂 3 スイートを `conformanceBackend` 経由で全て登録済み（`memory/__tests__/conformance.test.ts` に 30 本）。`scopeCleanupAdmissionStore` / `accountDeletionManifestStore` は**列挙の真部分集合**を宣言として渡し、「宣言外の ack が宣言分の代わりにならない」「宣言分を 1 つずつ欠いたときに finalize が通らない」まで検証しているので、全列挙をハードコードするバックエンドはここで落ちる。`accountDeletionManifestStore` の既存ケースからは `"authorRoute:note-001"` 等のバックエンド固有キー前提が除かれ、`noteId` / `membershipId` / 「prepare が ack した item を cleanup が見る」という観測可能な形に置き換わっている（移植性の改善）。
- **skip の正当性**: `describeSignInOAuthClientContract` は「認可要求（純関数）」と「code 交換」に分割され、前者は dev / Google 両方で実行、後者は `kind: "unverifiable"` の Google だけ `describe.skip`。skip 側の `mintCode` は throw するダミーなので、ゲートを誤って広げれば静かに通らず失敗する。Google の交換経路は `oauth/__tests__/googleSignInOAuthClient.test.ts` が `fetch` スタブで 12 ケース（タイムアウト / 4xx→`OAUTH_CODE_INVALID` / 5xx・不正 JSON・`id_token` 欠落 / `iss`・`aud`（配列含む）・`exp`・`sub`/`email` の claim 検証）を実行しており、「skip だから未検証」という穴はない。
- **Retry / エラー翻訳**: Google アダプターは 4xx を `ValidationError("OAUTH_CODE_INVALID")`、通信・5xx・整形不良・タイムアウトを `SystemError(EXTERNAL_API_ERROR)` に翻訳し、プロバイダー固有エラーを漏らさない。認可コードが single-use のため再試行しない判断も JSDoc に理由つきで残っている（`AbortSignal.timeout` の予算 10s）。
- **dev IdP の production 漏れ**: `NODE_ENV === "development"` の allowlist 化は `di/serverNode.ts` の zod `superRefine` 1 箇所に閉じており、`serverNode.test.ts` が production / staging / test / 空文字 / 未設定の 5 値を denylist では抜ける値として明示的に押さえている。実行時の第 2 の関門として `RequestContainer.oauthDevMode`（env 直読みなし）を同意画面ルートと `submitDevConsentFn` の両方が見ており、後者は `devOAuth.test.ts` が実リクエスト文脈で 404 を確認している。`vite` の `loadEnvPlugin` が `.env` を `process.env` へ流し込み、`vite dev` は `process.env.NODE_ENV = "development"` を立てる一方、`scripts/listen.node.ts` は dotenv より前に `NODE_ENV ??= "production"` を宣言するので、`.env` に `NODE_ENV` を書いても `pnpm start` を dev IdP に倒せない。PKCE は両アダプターとも共有の `deriveCodeChallengeS256`（43 文字 base64url）で、dev の `exchangeCode` も verifier ↔ challenge を照合する。
- **DI / composition root**: `RequestContainer` / `WorkerContainer` の全ポートが `memoryRuntime` で実体に結線され、`createTestHarness` も同じ `createMemoryRuntime` を通る（宣言集合 `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` / `REQUIRED_FINALIZE_RECEIPTS` がテストと本番で同一）。`MemoryRuntimeOptions.oauth` に既定値が無いので「誰も決めなかった」が dev IdP に解決しない。ランタイム singleton は未初期化での `create*Container` を throw、別 env での再初期化を throw、同一 env の再入で同一インスタンスを保持し、3 本のテストが押さえている。
- **ワーカーランタイム**: relay / scope task とも `createInProcessRelayTrigger` で「同時に 1 tick・kick は 1 回に畳む」が保証され、`start()` は relay / scope task / prune の初回ラウンドを即実行、3 本のタイマーは全て `unref()`、`stop()` はタイマー解除＋自前のシグナルリスナー解除＋両トリガーのドレイン＋追跡中の sweep 待ちを行う。`server.node.ts` は boot を `globalThis` / `import.meta.hot.data` に固定して dev リロード時に前の boot を retire してから再 boot するので、runner の多重起動は起きない（`runner.test.ts` が二重 `start()` とリスナー累積を検証）。scope task は `listDue` → scope UoW 内 `claimDue` → turn が自分の行を決着 → throw した turn だけランナーが `backoff` という順で、ハンドラー未登録の kind は due のまま警告、恒久失敗は 8 回で `failed` に落ちる（いずれもテスト済み）。prune tick は outbox / manifest terminal / removal receipt の 3 sweep を相互に隔離して回す。転送境界の 12MB 上限は `Content-Length` 宣言時に本文を 1 バイトも読まずに 413、chunked は `TransformStream` で実測打ち切り＋413 差し替えで、`pnpm start` 限定である旨も `docs/runtime_node.md` に明記されている。
- **`identity.personalCleanupHandoverContinued` の駆動**: barrier を閉じた turn が引き渡し行を**先に**積んでから global 側 ack を試み、receipt が入ってから `complete` する構造になっており、`scopeTaskRunner.test.ts` が「引き渡しを落として再起動しても完走する」を実際に検証している。塞げていない窓（barrier commit と引き渡し行 commit のあいだの死）は plan の縮退に記載済み。
- **決定的 EventId と outbox の id 衝突契約**: `attachEventIds` が draft を受け取る形になり、`mintEventIdFor` が `continuationKey` を持つ draft だけ決定的 ID にする。`OutboxRepository.save` の「先着行をそのまま残す no-op」は JSDoc（payload / attempts / 再試行スケジュール / claim / processed・quarantined の全てを保持）と適合テスト 3 本（同一バッチ内で他行を巻き込まない / attempts と再試行予定を保つ / processed 行を線に戻さない）が一致。継続イベントの key は `(type, operationId, phase, cursor)` から作られ、finalize の複数生産者は producer 名を cursor に置いて別イベントになる。
- **memory 固有性への依存**: 適合スイート側にバックエンド内部表現への依存は残っていない。`prunePersonalCleanupBarriers` の full-page 分岐が memory では到達不能である点は JSDoc に「#11 まで未検証で持ち越す」と明記されている。

#### カバレッジ

確認 100 件 / スキップ 194 件（計 294 件）。

**確認（100）**

- `apps/web/.env.example`, `docs/runtime_node.md`, `docs/test.md`, `vitest.config.ts`
- `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `apps/web/scripts/listen.node.ts`
- `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/components/dev/DevConsentForm/index.tsx`, `apps/web/app/presentation/devOAuth.ts`, `apps/web/app/presentation/__tests__/devOAuth.test.ts`
- `packages/core/src/adapters/conformance/` の 16 件: `accountDeletionManifestStore.ts`, `appliedOperationStore.ts`, `authTokenRepository.ts`, `backend.ts`, `distributedOperationStore.ts`, `identityRemovalReceiptStore.ts`, `identityUniqueDirectory.ts`, `llmUsageRepository.ts`, `noteProjection.ts`, `objectStorage.ts`, `outboxRepository.ts`, `scopeCleanupAdmissionStore.ts`, `scopeTaskScheduler.ts`, `signInOAuthClient.ts`, `storageQuotaRepository.ts`, `storedFileRepository.ts`
- `packages/core/src/adapters/memory/__tests__/` の 3 件: `conformance.test.ts`, `conformanceBackend.ts`, `unitOfWork.test.ts`
- `packages/core/src/adapters/memory/` の 5 件: `globalUnitOfWork.ts`, `objectStorage.ts`, `scopeTaskQueue.ts`, `scopeUnitOfWork.ts`, `store.ts`
- `packages/core/src/adapters/memory/repositories/` の 13 件: `accountDeletionManifestStore.ts`, `appliedOperationStore.ts`, `authTokenRepository.ts`, `distributedOperationStore.ts`, `identityRemovalReceiptStore.ts`, `identityUniqueDirectory.ts`, `llmUsageRepository.ts`, `noteProjection.ts`, `outboxRepository.ts`, `scopeCleanupAdmissionStore.ts`, `scopeTaskScheduler.ts`, `storageQuotaRepository.ts`, `storedFileRepository.ts`
- `packages/core/src/adapters/oauth/` の 6 件: `devSignInOAuthClient.ts`, `googleSignInOAuthClient.ts`, `pkce.ts`, `signInOAuthClient.ts`, `__tests__/conformance.test.ts`, `__tests__/googleSignInOAuthClient.test.ts`
- `packages/core/src/application/di/` の 4 件: `memoryRuntime.ts`, `serverNode.ts`, `types.ts`, `__tests__/serverNode.test.ts`
- `packages/core/src/application/execution/` の 3 件: `eventId.ts`, `unitOfWork.ts`, `__tests__/eventId.test.ts`
- `packages/core/src/application/cleanup/participants.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/__tests__/helpers.ts`
- `packages/core/src/application/ports/` の 10 件: `accountDeletionManifestStore.ts`, `appliedOperationStore.ts`, `distributedOperationStore.ts`, `identityRemovalReceiptStore.ts`, `objectStorage.ts`, `outboxRepository.ts`, `scopeCleanupAdmissionStore.ts`, `scopeTaskQueue.ts`, `scopeTaskScheduler.ts`, `scopeTaskTrigger.ts`
- `packages/core/src/application/workers/` の 6 件: `eventRelayWorker.ts`, `scopeTaskRunner.ts`, `subscribers.ts`, `__tests__/outboxPrune.test.ts`, `__tests__/scopeTaskRunner.test.ts`, `__tests__/subscribers.test.ts`
- `packages/core/src/application/identity/continuations.ts`, `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`
- `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/storage/deleteStoredObjects.ts`, `packages/core/src/application/storage/storeAvatar.ts`
- `packages/core/src/domain/common/event.ts`
- `packages/core/src/domain/identity/ports/` の 3 件: `authTokenRepository.ts`, `identityUniqueDirectory.ts`, `signInOAuthClient.ts`
- `packages/core/src/domain/note/ports/` の 4 件: `htmlProcessor.ts`, `localNoteProjectionWriter.ts`, `localNoteQueryService.ts`, `publicNoteProjectionWriter.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/usage/ports/llmUsageRepository.ts`, `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`

**スキップ（194）**

- `.thread/2/` の 37 件（`adr.md`, `plan.md`, `progress.md`, `steps.md`, `testing.md`, `review/review-00*-*.md` 30 件, `review/triage.md`）— 契約・設計記録。`plan.md` / `adr.md` は判定の根拠として参照したがレビュー対象の実装ではない。過去ラウンドのレビュー記録は指示によりゼロベース判定のため読まない
- `apps/web/app/components/auth/` の 16 件（`OAuthButton`, `OAuthCallbackPanel`, `PasswordStrengthMeter`, `ResendVerificationForm/{action,index}`, `ResetPasswordPanel/{action,index}`, `SignInForm/{action,index}`, `SignUpForm/{action,index}`, `VerifyEmailPanel/{action,index}`, `__tests__/passwordStrength.test.ts`, `passwordStrength.ts`, `schema.ts`）— フロントエンド観点。dev IdP 配線に触れる `DevConsentForm` のみ確認済み
- `apps/web/app/components/layout/` の 4 件（`AccountMenu/{action,index}`, `AppShell/index`, `SettingsTabs/index`）と `apps/web/app/components/note/NoteBody/index.tsx` — フロントエンド観点
- `apps/web/app/components/settings/` の 15 件 — フロントエンド観点
- `apps/web/app/presentation/` の 9 件（`__tests__/deletionTicket.test.ts`, `__tests__/oauthStateBinding.test.ts`, `__tests__/oauthStateBindingWiring.test.ts`, `deletionTicket.ts`, `errorDisplay.ts`, `oauthStateBinding.ts`, `oauthStateCookie.ts`, `session.ts`, `verificationSession.ts`）— 署名 ticket・OAuth state 束縛・Cookie はセキュリティ観点の担当（束縛 Cookie の一方向性は #20 として決着済み）
- `apps/web/app/routeTree.gen.ts` — 生成物
- `apps/web/app/routes/` の 13 件（`__root.tsx`, `auth/-action.tsx`, `auth/callback.$provider.tsx`, `notes/index.tsx`, `reset-password.tsx`, `settings/{-action,auth,danger,index,profile,route,usage}.tsx`, `verify-email.tsx`）— フロントエンド / セキュリティ観点。アダプター配線に触れる `dev/*` と `storage.$.tsx` のみ確認済み
- `packages/core/src/application/identity/` のユースケース本体・テスト 62 件（`__tests__/` 31 件と `addPasswordIdentity.ts` 〜 `view.ts` の 31 件。確認済みの `continuations.ts` / `deleteAccount/cleanupDispatch.ts` / `deleteAccount/terminalPrune.ts` を除く）— ドメイン・ユースケース観点
- `packages/core/src/application/storage/` の 6 件（`__tests__/{deleteFiles,deleteFilesByOwner,storeAvatar}.test.ts`, `deleteFiles.ts`, `eventDecoders.ts`, `view.ts`）と `packages/core/src/application/usage/` の 7 件 — ユースケース観点
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts` の 1 件 — ユースケース観点
- `packages/core/src/domain/` の 22 件（`identity/{__tests__/policies.test.ts,errorCode.ts,services/*,user.ts,valueObject.ts}` 7 件, `note/valueObject.ts` 1 件, `storage/{__tests__/storage.test.ts,errorCode.ts,events.ts,services/uploadValidationPolicy.ts,storedFile.ts,valueObject.ts}` 6 件, `usage/{__tests__/*,errorCode.ts,events.ts,llmUsage.ts,services/quotaEnforcement.ts,storageQuota.ts,valueObject.ts}` 8 件）— ドメイン観点。ポート定義のみアダプター観点で確認済み
