### Routing / outbox / scope インフラ

ゼロベースで再点検した。前ラウンドの結論は前提にせず、`NoteRouteStore` の 5 状態機械・CAS・`readableRow`・keyset、`OutboxRepository` の lease / id 衝突 / quarantine / staged 拒否 / サイズ上限 / 件数取得、`claimDue` の per-row 排他とエラー契約、`armAndPublish` の `Upkeep` 分岐と `SCOPE_TASK_LEASE_MS`、`ScopeTaskQueue.listDue` と due index の同期・有界化・並び順、`ScopeCleanupAdmissionStore` の書き込みバリア・所有権検査・component ack を、実装・ポート JSDoc・物理 schema・canon（`spec/platform/index.md`「routing」「Queue 構成」「Alarm と Cron」、`spec/database/index.md#note_routes` / `#scheduled_tasks` / `#scope_task_due_index` / `#outbox_events`）の 4 方向から突き合わせた。

`triage-keys.md` の `wont-fix` / `defer`（#16 / #47〜#56、および `armAndPublish` の合流無し・`CLAUDE.md` の追随・`spec/inventory/frontend.md` の同期日）に該当する論点は再提起していない。Round 003〜007 で「再審議しないこと」と決着した付随判断も再提起していない。

#### Blockers

なし。

#### Warnings

なし。

#### 検証したことの要点（記録用）

- **`NoteRouteStore` の 5 状態機械と `routeVersion` の CAS** — 9 メソッドすべてが「読んだ行像の全列書き戻し ＋ 行同一性 `_occ_guard`」で閉じる。guard の同定タプル `(note_id, state, route_version, operation_id, migration_id)` は網羅的で、実装が持つどの遷移も 5 列の少なくとも 1 つを動かす（`switchMove` は `route_version` と `state`、`beginMove` / `abortMove` は `state` と `migration_id`、`beginPurge` / `abortPurge` / `finishPurge` は `state`、`activateCreate` は `state`、`reserveCreate` の奪取は `operation_id`）。canon が `switchMove` の CAS 述語に挙げる `scope_type` / `scope_id` を guard が持たない点は安全側で、scope を動かす遷移は `switchMove` だけであり同時に `route_version` を進めるため guard が素通りする経路が無い。`migration_id` / `last_migration_id` は canon どおり CHECK を持たず状態機械だけが動かし、`switchMove` の応答喪失再試行は `state = active ∧ route_version = expected + 1 ∧ last_migration_id = migrationId` の 3 条件で stale 要求と分離されている。物理 schema の相関 CHECK 5 本（`target_*` ⟺ `moving`、`reservation_expires_at` ⟺ `reserved`、`tombstone_expires_at` ⟺ `tombstone`、`operation_id` は 3 状態で非 NULL）は、`active` へ至る全経路が `operation_id` を保持するのでどの遷移でも破れない。
- **`readableRow` の安全側フィルタ** — `reserved` / `purging` を落とし、`tombstone` は `tombstone_expires_at` を clock と比較して期限まで返す。`resolve` / `resolveMany` の両方が同じ述語を通り、`ScopeRouter.resolveNote` はそこから `NOTE_NOT_FOUND` を組む。`NoteRouteFanOutReader` は逆にポート JSDoc どおり `reserved` だけを落とす（`moving` / `purging` を含む）ので、account deletion manifest から Note が落ちる経路が無い。
- **keyset の正しさ** — `OFFSET` を使わず `note_id > ?` の 1 本、`state <> 'reserved'` は残余述語、索引 `note_routes_created_by_idx` / `note_routes_scope_idx` が `(key, note_id)` なので keyset 順が索引から出る。`probe = limit + 1` で次カーソルの有無を追加クエリ無しに決め、cursor は query fingerprint を持つので走査をまたいだ再生は `INVALID_PAGINATION`。cursor が認証されないことは ADR 063 と `cursor.ts` の JSDoc で明示され、`after` は開始位置しか決めず可視性述語は毎回適用される。
- **`OutboxRepository`** — `save` は `insertRowsFromJson(..., conflict: "ignore")` の 1 文で、`?` を件数ぶん並べず（`json_each` 1 バインド）、ADR 042 の「保存済み id は行を触らず no-op」をそのまま SQL にしている（`idempotency.test.ts` が payload の非置換まで観測）。`claimPending` は `UPDATE … WHERE id IN (SELECT … ORDER BY created_at, id LIMIT ?) RETURNING` の 1 文で per-row 排他を作り、`RETURNING` の順不同を JS 側で FIFO へ戻す。quarantine は `finalize` の `next_attempt_at IS NULL → failed_at` と `claimPending` の `failed_at IS NULL` で閉じ、成功・失敗が 1 原子ステップに乗る。`claimPending` / `pruneProcessed` は `session.staged` を見て UoW 内実行を拒み（`routeGuard.test.ts` が両方を観測）、`save` / `finalize` はステージされる側という非対称が正しく実装されている。サイズ上限（1 MB）は `TextEncoder` の実測バイト数で判定し、超過は `SystemError` として driver に届く前に落とす。件数取得は `writeCounted` → D1 の `meta.changes` で、`RETURNING` に落とさない理由が JSDoc にある。バインド順（`SET` 節の `?` → `FROM json_each(?)`）も 3 文すべてで一致。
- **`claimDue` の per-row 排他とエラー契約** — `claimGuardStatement`（`occGuard`）＋ 条件付き `claimStatement` の対で、候補選択は overlay を意図的に混ぜない。負けた writer は `OPTIMISTIC_LOCK_FAILURE` で中断し、`lease.test.ts` が autocommit 経路と staged（UoW）経路の両方で「1 人だけが行を受け取り、もう 1 人は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` で拒まれる」ことを実バインディングで固定している。ポート JSDoc の「staged backend は commit で撃つので caller 側が吸収する」と `runDueScopeTasks` の分岐（`OPTIMISTIC_LOCK_FAILURE` だけ skip、他の `ConflictError` は再送出）が一致し、`scopeTaskRunner.test.ts` が両分岐を観測。
- **`runDueScopeTasks` の耐性** — scope 単位の重複排除、残 budget を超えて claim しない（＝claim した行は必ずその round で訪問する）、handler 欠落は `dueAt` 付きで警告して行を due のまま残す、handler の throw は `backoff` して round を続ける、`backoff` 自体の失敗も握り潰してログのみ。すべて対応するテストがある。
- **`armAndPublish` の `Upkeep` 分岐** — `commit` は `armForStoredRows`（足すだけ）、`turnExit` だけが `rescheduleAlarm`（消せる）。`armAndPublishNow` は「先に武装 → publish → 失敗なら `armNoLaterThan(now + 10s)`」の順で、`deleteAlarm` 後・publish 完了前のクラッシュ窓が構造的に無い。`upkeep` 鎖は `this.upkeep` を同期的に張り替えるので取りこぼしが無く、`catch(() => {})` で毒されない（＝`applyWriteSet` が upkeep 由来で失敗しない）。`alarm.test.ts` が「commit は再試行 alarm を消さない」「rebuild は消さない」「turn の出口だけが消す」「重なった publish で古いスライスが後着しない」を実バインディングで観測している。
- **`SCOPE_TASK_LEASE_MS` の読み取り（AC-6 の前提）** — `ScopeObjectEnv.SCOPE_TASK_LEASE_MS` を `alarm()` が turn ごとに読み、未設定 / 空文字は定数、正の整数ミリ秒でない値は `dataIntegrityError` で turn ごと落とす。`spec/platform/index.md`「Scope Alarm」の「未設定なら既定値、正の整数のミリ秒でない値は turn を落とす」と 1 対 1。`alarm.test.ts` の 3 ケース（設定値・既定値・不正値で 1 行も claim されない）が全分岐を押さえ、不正値ケースは後始末で env と行を戻すのでファイル内の後続ケースを汚さない。AC-6 の決着自体（fencing token を足さない）は `.thread/11/adr.md` ADR-019 / ADR-085 / ADR-094 にあり、ポート JSDoc の「The lease is advisory…」段落、`scopeTaskScheduler.ts` の `## Fencing` 節、canon の driver 別場合分けが揃っている。
- **`ScopeTaskQueue.listDue` と due index の同期・有界化・並び順** — index の候補述語（`lease_expires_at IS NULL` ⟺ `pending`）は scope schema の `CHECK ((status = 'running') = (lease_expires_at IS NOT NULL))` に支えられて厳密。スライスは `PARTITION BY priority ORDER BY COALESCE(lease_expires_at, due_at)` で優先度ごと 25 行 ＝ 全体 100 行、`status <> 'failed'` を除外し、canon の「次に取れる時刻の早い 25 行」と一致。`listDue` 側は同じ `selectDueRows` を共有し、SQL の `ORDER BY` に `scope_type, scope_id` を含めた上で scope を持たない `compareRows` の安定ソートで tie を保つ。溢れた行は全置換 publish で settle のたびに繰り上がる。commit RPC は publish を終えてから応答するので `run` 解決時点で索引が新しい。
- **`ScopeCleanupAdmissionStore`** — 全メソッドが「読んだ行から決めて、その条件を繰り返す `_occ_guard` を同じ write-set に置く」形。`assertWritable` / `assertActorWritable` は receipt の存在だけで閉じ、`requireOwner` は「行が無い / operation が違う / `running` でない」を一律 `CLEANUP_OPERATION_MISMATCH` に倒す。component ack は `json_set` で可換に書き、overlay 像も同じ結果を持つ。`markCompleted` は配備が宣言した集合（`requiredComponents`、既定は enum 全体＝停止する安全側、ADR 039）だけを見る。`completedFor` による late duplicate の no-op、`pruneCompleted` の「`running` は `expires_at IS NULL` なので永久に対象外」も canon どおり。overlay の `matches`（`kind = 'accountDeletionBarrier'`）が同じ表の `AppliedOperationStore` 行（`kind = 'command'`）を混ぜないことも確認した（ADR 045）。
- **セキュリティ / パフォーマンス** — cursor は capability でなく（ADR 063）、`resolveMany` の 500 件上限は `SystemError(DatabaseError)`、全リスト系クエリが `json_each` 1 バインド（`MAX_BOUND_PARAMETERS = 100` は `assertBindable` が RPC 前後の両方で検査）、D1 の 1 原子書き込みは `MAX_STATEMENTS_PER_COMMIT = 250` で頭打ち、due index スライスと outbox の JSON バインドはどちらも有界。`json_extract` / `json_set` に渡る動的な値は列名・enum 由来の定数だけで、外部入力がパス式へ入る経路は無い。
- **コメント** — 差分内の CF アダプター・ワーカー・DI に、指摘への弁明・修正の経緯・ラウンド番号を残す記述は無い（`grep -niE "round [0-9]|レビュー|指摘|previously|no longer|修正|以前は|TODO|FIXME"` で当たるのはいずれも仕様説明としての "no longer" のみ）。

#### カバレッジ

一覧 192 行との対応。

- 確認:
  - `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteStore.ts`, `.../noteRouteFanOutReader.ts`, `.../outboxRepository.ts`, `.../idempotencyStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`
  - `packages/core/src/adapters/cloudflare/scopeRouter.ts`, `.../scopeTaskQueue.ts`, `.../cursor.ts`
  - `packages/core/src/adapters/cloudflare/do/alarm.ts`, `.../do/dueIndex.ts`, `.../do/scheduledTasks.ts`, `.../do/scopeObject.ts`, `.../do/scopeName.ts`, `.../do/scopeStub.ts`, `.../do/schema.ts`
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`, `.../do/repositories/scopeCleanupAdmissionStore.ts`
  - `packages/core/src/adapters/cloudflare/sql/session.ts`, `.../sql/executor.ts`, `.../sql/occGuard.ts`, `.../sql/errors.ts`, `.../sql/json.ts`, `.../sql/statement.ts`（担当範囲が依存する契約の確認として）
  - `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `.../execution/scopeUnitOfWork.ts`（`touchedTables` → publish / 再武装の連結の確認として）
  - `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`, `.../lease.test.ts`, `.../routeGuard.test.ts`, `.../idempotency.test.ts`, `.../durability.test.ts`（scope write-set のロールバックと publish 抑止のケース）
  - `packages/core/src/adapters/cloudflare/__tests__/conformance/route.test.ts`, `.../conformance/scopeInfra.test.ts`, `.../conformanceBackend.ts`, `.../ports/route.ts`, `.../ports/scopeInfra.ts`, `.../ports/deps.ts`
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`, `.../ports/noteRouteFanOutReader.ts`（＋差分外の `ports/{noteRouteStore,outboxRepository,scopeTaskQueue,scopeCleanupAdmissionStore}.ts` を契約確認のため参照）
  - `packages/core/src/application/workers/scopeTaskRunner.ts`, `.../workers/__tests__/scopeTaskRunner.test.ts`
  - `packages/core/src/application/di/cloudflareRuntime.ts`
  - `spec/platform/index.md`（routing / Queue 構成 / Alarm と Cron）, `spec/database/index.md`（`note_routes` / `scheduled_tasks` / `scope_task_due_index` / `outbox_events` / `applied_operations`）
  - `.thread/11/plan.md`, `.thread/11/review/triage-keys.md`, `.thread/11/adr.md`（AC-6 の決着箇所）

- スキップ:
  - `.thread/11/{foundation,progress,steps,testing}.md`, `.thread/11/review/review-00{1..7}-*.md`, `.thread/11/review/triage.md` — 進行記録・過去ラウンドの成果物で、本ラウンドの観点対象ではない（`triage-keys.md` と `plan.md` と `adr.md` のみ参照）
  - `.github/workflows/ci.yml`, `README.md`, `docs/runtime_node.md`, `docs/test.md`, `package.json`, `packages/core/package.json`, `packages/core/tsconfig*.json`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts` — ビルド / テスト基盤（composition 観点）
  - `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,globalMaintenanceRunStore,identityRemovalReceiptStore,identityRepository,identitySupport,identityUniqueDirectory,loginAttemptStore,oauthStateStore,sessionRepository,userBatchReader,userRepository}.ts` — identity / directory 観点
  - `packages/core/src/adapters/cloudflare/d1/repositories/{publicNoteProjection,publicNoteQueryService}.ts`, `.../projection/*.ts`, `.../search/*.ts` — projection / 検索観点
  - `packages/core/src/adapters/cloudflare/do/repositories/{appliedOperationStore,llmUsageRepository,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,storageQuotaRepository,storedFileRepository}.ts` — scope 業務データ観点（`appliedOperations` 表の鍵分離だけは barrier 側から確認済み）
  - `packages/core/src/adapters/cloudflare/execution/{globalUnitOfWork,nesting}.ts`, `.../r2/objectStorage.ts` — UoW / storage 観点
  - `packages/core/src/adapters/cloudflare/__tests__/{deleteFilesByOwner,env.d.ts,globalConcurrency,harness,projectionConcurrency,r2,runtimeComposition,searchEdges,sessionOverlay,support,unitOfWork,worker}.*`, `.../ports/{directory,identity,projection,scopeBusiness}.ts`, `.../conformance/{directory,identity,projection,scopeBusiness,unitOfWork}.test.ts`, `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — それぞれ identity / projection / UoW / composition 観点
  - `packages/core/src/application/{cleanup/participants.ts,cleanup/personalCleanup.ts,errors.ts,identity/*.ts,storage/__tests__/deleteFilesByOwner.test.ts,di/runtime.ts}`, `packages/core/src/domain/**` — usecase / domain 観点
  - `spec/adr/**`, `spec/domains/**`, `spec/inventory/**`, `spec/testcases/**`, `spec/usecases/**` — canon のうち本観点が参照した `spec/platform` / `spec/database` 以外は他観点の持ち分（ADR 021 / 039 / 040 / 041 / 042 / 045 / 047 / 053 / 056 / 063 は本文の該当段落のみ参照）
