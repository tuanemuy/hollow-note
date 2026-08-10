# レビュー 005 — Domain / Use Case / Adapter（収束判定ラウンド）

対象: PR #12 / `issue/1/account-to-blank-note-skeleton` → `main`
契約: `.thread/1/plan.md`
既出指摘: `.thread/1/review/triage.md`（ラウンド1〜4、Key 一致は再審議しない）

## Domain / Use Case / Adapter

### Blockers

なし

### Warnings

**問題点ゼロ**

出荷を止めるべき欠陥（誤った値の書き込み・返却、不変条件の破壊、データ損失、セキュリティ上の実害、受け入れ基準の未達、ラウンド4修正による退行）は検出されなかった。

参考として、本ラウンドで確認した検証コマンドの結果:

- `pnpm test:unit` — 28 files / 466 tests 全緑
- `pnpm typecheck` — `packages/core` / `apps/web` ともに Done

## 重点検証対象（ラウンド4の修正）— 判定

### 1. `IdentityUniqueDirectory.activate` の条件付き更新化 — 退行なし

- `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:79-116`：全行を先に検証してから書くので all-or-nothing。`state === "active"` の行は書き込みループでスキップされるため、同一 operationId の再実行は冪等のまま。
- 呼び出し側 `signUpWithPassword.ts:231-264` の復旧経路は健全。初回は `user.version`（= `Version.initial()` = 0）を渡し、`createOccRepository.insert` は version を書き換えないので初回 activate は素通りする（無駄な reconcile は発生しない）。失敗時は `userReader.findById` で**現在の** version を読み直して再 activate するため、間に `verifyEmail` 等で version が進んでいても収束する。
- 適合スイート `adapters/conformance/identityUniqueDirectory.ts:134-159` が「version 不一致で `OPTIMISTIC_LOCK_FAILURE` かつ予約は無傷」「正しい version で活性化」を pin。`beforeEach` で予約主体の user 行を seed する変更も整合。

### 2. `NoteRouteStore.switchMove` の `lastMigrationId` 門番 — 退行なし

- `adapters/memory/repositories/noteRouteStore.ts:206-234`：`state === "active" && routeVersion === expected + 1 && lastMigrationId === migrationId` の三条件が揃った場合のみ lost-response 再送として同じ行を返す。
- サガの他の遷移への影響を個別に追跡し、いずれも壊れていないことを確認:
  - `beginMove`（同一 migrationId の冪等復帰・`active` からの新規 move）
  - `abortMove`（switch 後は `migrationId === null` で必ず拒否）
  - switch 後の再 `beginMove`（別世代の move として正しく通る）
  - `beginPurge` / `abortPurge` / `finishPurge`（`lastMigrationId` を参照しない）
- 適合スイート `adapters/conformance/noteRouteStore.ts:185-221` が「同一 migration の再送は同じ route」「同じ version を引用する**別** migration は conflict」を両側から pin。
- `reserveCreate` は `lastMigrationId: null` を明示的に初期化しており、`NoteRouteRow` の必須化による構築漏れは typecheck 緑で確認済み。

### 3. `commandKeyOf` の書式統一 — 一致、既存 run も壊れない

- usecase 側 `application/identity/pruneExpiredAuthState.ts:67-72` = `${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`
- アダプター側 `adapters/memory/repositories/globalMaintenanceRunStore.ts:27-32` = 同一書式（table 名ベース。table **index** ではない）
- 適合スイート `adapters/conformance/globalMaintenanceRunStore.ts:15-16, 126-161` が独立に同じ式を持ち、`beginOrResumeKind` 直後と `advanceOrAck` でのテーブル前進後の両方で `lane.commandKey === commandKeyOf(...)` を assert。
- `advanceOrAck` は `run.runId`、`beginOrResumeKind` は `input.candidateRunId` を使うが、両者は同一値なので不整合なし。usecase が `laneQueue` に自前で積む合成レーン（`pruneExpiredAuthState.ts:386-401`）の key もストアが保存した値と byte 一致する。
- `checkpointLane` は呼び出し側の `nextCommandKey` をそのまま保存するため、進行中の run の key が書式変更で不整合になる経路もない（in-memory は再起動で消えるので永続 run も存在しない）。

### 4. `Note.reconstruct` の必須列拒否 — 正当なデータを拒否しない

- `domain/note/note.ts:722-744`：`null` / `undefined` のみ拒否し、空文字は通す。
- 白紙ノートの実値を全て確認: `NoteHtml.empty()` → `""`、`PlainTextContent.create("")` → 長さ検査のみ、`Excerpt.fromText("")` → `Excerpt.create("")`（`length > 200` のみ拒否）、`NoteTitle.create("無題", "auto")` → 上限のみ。よって `createBlank` が作るノートは全列が空文字で reconstruct を通過する。
- `headings` は `?? []` で欠落を許容（`ready` の必須列ではない）という設計と一致。
- 実行経路への影響もゼロ: memory の `NoteRepository` は `createOccRepository` によるエンティティ直保存で `reconstruct` を通さないため、本スライスで `reconstruct` を叩くのはドメイン単体テストのみ。

### 5. `markConversionFailed` / `markAwaitingIntegration` の visibility ガード — 正当な遷移を塞いでいない

- `domain/note/note.ts:96-103, 300-334`：`ensurePrivate` は `visibility.status !== "private"` を拒否。
- 型上、`content` を非 `ready` に落とせるのはこの2メソッドだけで、`makeUnlisted` / `makePublic` は `ensureReady` を通る。したがって「共有済み × 非 ready 本文」は両側から到達不能になり、不変条件が対称に閉じている。
- 塞がれ得る正当な遷移が存在しないことを spec 側からも確認: `markConversionFailed` の呼び出し元（`spec/inventory/test.md` の TC-identity-077 / TC-integration-054 / TC-integration-075 / TC-job-009 / ADR-012）は全て「`processing` のまま残ったノートの回復」であり、`processing` は `createFromUpload` の初期状態としてしか生じず、その時点の visibility は必ず `private`。`runRegeneration` は本文を触らない（`markConversionFailed` を呼ばない）と spec に明記。
- 本スライスに呼び出し元は存在しない（grep で確認）ため、実行経路上の退行はそもそも生じ得ない。

### 6. `pruneExpiredAuthState` の `releaseLane` 失敗時 `workRemains` — 正しく効く

- `application/identity/pruneExpiredAuthState.ts:234-259`：catch 内で `workRemains = true`。
- 制御フローを確認: `finally`（438-454）は `return toView(counts, workRemains || pruneContinued)`（463）より**前**に実行されるため、finally 内で立てたフラグは戻り値に反映される。
- レーンの二重解放も起きない。`inFlight` は各経路（未知テーブル / sweep 失敗 / 予算切れ / 同一シャード前進 / 別シャード再claim）で解放後に `null` 化され、`finally` 側も `generation + shardId` で dedupe している。
- 回帰テスト `application/identity/__tests__/pruneExpiredAuthState.test.ts:584-631` が「`advanceOrAck(completed:false)` を落として `continued === true` + エラーログ + claimed レーンが実際に1本残る」まで assert しており、空振りしていない。

## カバレッジ

### 確認

ドメイン:

- `packages/core/src/domain/note/note.ts` / `valueObject.ts` / `services/noteAccessPolicy.ts` / `ports/noteRepository.ts`
- `packages/core/src/domain/identity/user.ts` / `authToken.ts` / `session.ts` / `valueObject.ts` / `ports/identityUniqueDirectory.ts` / `services/identityPolicy.ts` / `services/accountLinkingPolicy.ts` / `services/loginThrottlePolicy.ts`
- `packages/core/src/domain/common/pagination.ts`

ユースケース / アプリケーション:

- `packages/core/src/application/identity/signUpWithPassword.ts` / `signInWithPassword.ts` / `verifyEmail.ts` / `authenticateSession.ts` / `pruneExpiredAuthState.ts` / `view.ts`
- `packages/core/src/application/note/createBlankNote.ts` / `getNote.ts` / `listNotes.ts` / `accessControl.ts` / `view.ts`
- `packages/core/src/application/execution/unitOfWork.ts` / `errors.ts` / `ports/idempotencyStore.ts` / `ports/noteRouteStore.ts` / `ports/noteRouteFanOutReader.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/workers/eventRelayWorker.ts` / `packages/core/src/config.ts`

アダプター:

- `packages/core/src/adapters/memory/store.ts` / `support.ts` / `cursor.ts` / `globalUnitOfWork.ts` / `scopeUnitOfWork.ts` / `scopeRouter.ts` / `mailSender.ts` / `passwordHasher.ts` / `secureTokenGenerator.ts` / `shareTokenProtector.ts`
- `packages/core/src/adapters/memory/repositories/` — `identityUniqueDirectory.ts` / `noteRouteStore.ts` / `noteRouteFanOutReader.ts` / `globalMaintenanceRunStore.ts` / `noteRepository.ts` / `noteRevisionRepository.ts` / `noteProjection.ts` / `localNoteQueryService.ts` / `authTokenRepository.ts` / `sessionRepository.ts` / `identityRepository.ts` / `userRepository.ts` / `userBatchReader.ts` / `loginAttemptStore.ts` / `oauthStateStore.ts` / `idempotencyStore.ts` / `outboxRepository.ts` / `scopeCleanupAdmissionStore.ts`
- `packages/core/src/adapters/conformance/identityUniqueDirectory.ts` / `noteRouteStore.ts` / `globalMaintenanceRunStore.ts` / `accountDeletionManifestStore.ts`（ラウンド4差分） / `packages/core/src/adapters/memory/__tests__/conformance.test.ts`

### スキップ

- `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts` / `publicNoteQueryService.ts`、`adapters/memory/timeZone.ts` / `timeZoneResolver.ts` — 本スライスに実行経路がなく、契約はラウンド1〜4で判定済み（適合スイートの緑を根拠に採用）
- `packages/core/src/adapters/conformance/` の残りスイート（`asserts.ts` / `backend.ts` / `fixtures.ts` / `testClock.ts` / `unitOfWork.ts` ほか各ポートスイート） — テスト観点はラウンド1〜4（W-009 / R2-UA-W-002 / R3-TS-W-001 ほか）で判定済み
- `packages/core/src/**/__tests__/` 全般 — 466 件緑を実行確認したうえで、個別レビューはラウンド1〜4のテスト担当判定に委譲
- `domain/identity/{identity,events,errorCode}.ts` と `ports/` の残り、`domain/note/{noteRevision,events,errorCode}.ts` と `ports/` の残り、`domain/{conversion,job,storage,workspace}/*`、`domain/common/time.ts` — 型・契約定義のみでラウンド1〜4判定済み
- `application/{identity,note}/eventDecoders.ts`、`application/scope.ts`、`application/ports/` の残り、`application/di/{types,serverNode}.ts`、`application/__tests__/helpers.ts` — ラウンド1〜4判定済み（typecheck 緑で整合を確認）
- 削除ファイル群（`adapters/{aws,cloudflare,gcp,d1,libsql}/*`、`application/di/server{Aws,Cloudflare,Gcp}.ts`、`application/todo/*`、`domain/todo/*`） — 削除のみで新規リスクなし（AC-14）
- `apps/web/` 配下すべて、`infra/`、ルート設定、`docs/`、`.thread/` — 本レビューの担当外（frontend / security / test 担当）
