### Identity / directory / operation（D1 control plane）

#### Blockers

なし

#### Warnings

- **[W-001]** `pruneTerminal` の keyset は `operation_id` 単独だが、canon 4 か所は `(retainUntil, operationId)` の複合 keyset だと書いている
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts:768-780`（`ORDER BY operation_id` / `AND operation_id > ?` / `nextCursor = text(last, "operation_id")`）、`packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql:267-269`、`spec/database/index.md:180`、`spec/database/index.md:207`、`spec/usecases/identity.md:827`、`spec/testcases/identity/deleteAccount.md:70`
  - 理由: 実装（memory 側も同じ）は `retain_until <= asOf` を**絞り込みの述語**として使い、順序と cursor は表キー `operation_id` だけで決めている。これは本 PR が新設した「有界な掃引 / 削除」（`spec/database/index.md:12`）の形そのもので、正しく前進もするし冪等でもある。ところが `account_deletion_manifests` 節は `(retain_until, operation_id) … が回収の走査順`（:180）、進行の記述は `(retain_until, operation_id) index から … 回収し`（:207）、usecase は「lane は `(retainUntil, operationId)` cursor を持ち」（:827）、テストケースは「`(retainUntil, operationId)` keyset の 100+1 件で回収し」（deleteAccount.md:70）と、4 か所すべてが複合 keyset を約束したままになっている。しかも本 PR はこの 4 行のうち 3 行を書き換えており（`expires_at` → `retain_until`、header status の 5 値化）、同じ改訂で identity 系の索引だけは「期限切れ集合への絞り込みに使う（回収の順序は上記「有界な掃引 / 削除」）」へそろえた（:290 の `sessions`、:307 の `auth_tokens`、:230 の `identity_removal_receipts`、:319 の `login_attempts`、:701 の `oauth_flow_states`）のに、`account_deletion_manifests` だけ旧い言い回しが残っている。付随して DDL の `account_deletion_manifests_terminal_idx (retain_until, operation_id)` は、この問い合わせの `ORDER BY operation_id` を供給できない索引になっている（走査順としては使われず、PK 索引を歩いて `retain_until` を残余述語で評価する形になる）。AC-9 が求める「物理スキーマの決定が spec に反映されている」に対して、索引の存在理由が実装と食い違って残っている状態。
  - 提案: **spec を実装へ倒す**（実装側は「有界な掃引 / 削除」の規約と一致しているので動かさない）。`spec/database/index.md:180` を `(retain_until, operation_id) WHERE status IN ('completed','rejected')` は**terminal かつ期限到達済みの集合への絞り込みに使う。回収の順序は `operation_id`（上記「有界な掃引 / 削除」）**へ、:207 の「index から … 回収し」も同じ言い回しへ。`spec/usecases/identity.md:827` の「`(retainUntil, operationId)` cursor」と `spec/testcases/identity/deleteAccount.md:70` の「`(retainUntil, operationId)` keyset」は `operationId` keyset（`retainUntil <= asOf` は絞り込み）へ。逆向き（実装を複合 keyset へ）を採ると `AccountDeletionManifestStore.pruneTerminal` の cursor 表現が memory 側と適合スイートまで連れてくるので、収束ラウンドで開く範囲ではない。

#### 確認して問題なしと判断した点（今回の観点の中心）

- **cursor 節の文組み立て（`identitySupport.deleteExpiredPage:78` / `accountDeletionManifestStore:336, 768` / `globalMaintenanceRunStore:747`）** — 4 か所とも「cursor が null なら節を出さない・非 null なら節を足す」だけの分岐で、`ORDER BY` は分岐の外にあり両経路で同一。バインドの並びも `params` の三項が SQL の `?` 出現順と 1 対 1（`[asOf, size+1]` / `[asOf, cursor, size+1]`、`[userId]` / `[userId, afterEdgeKey]`、`[asOf]` / `[asOf, cursor]`、`[asOf]` / `[asOf, afterExpiresAt, afterExpiresAt, afterRunId]`）。`pruneCompleted` だけが複合 keyset で、`(expires_at > ? OR (expires_at = ? AND run_id > ?))` は `ORDER BY expires_at, run_id` と整合し、`spec/domains/index.md:145` の `(expiresAt, runId)` とも一致する。ページ境界は全経路 `LIMIT n+1` → `slice(0, n)` → 「余りがあったときだけ最終行を cursor にする」で、`n` 件ちょうどのときに偽の cursor を返さない。
- **有界削除が選択述語を DELETE へ持ち越した件（`identitySupport.ts:100-107, 129-136`）** — 返す件数の意味は「選んで試みた行数」へ寄ったが、壊れてはいない。(a) 救われた行は同じ述語で次回も選ばれないので無限ループにならない。(b) `authResidueCleanup.ts:47` は `deleted === AUTH_RESIDUE_PAGE_SIZE` で継続を積むだけなので、過大報告は空回りの 1 ラウンドに留まる。(c) `pruneExpiredAuthState.ts:185,367` は `page.deleted` を計数にしか使わず、前進は `nextCursor` が決める。過小報告の経路は無い。`globalConcurrency.test.ts:297`（epoch 更新に救われた session）と `:320`（TTL 延長に救われた login attempt）が、救われる側の振る舞いを実バインディングで観測している。
- **guard 敗北の翻訳と読み直し** — `writeHeader`（着地した status が求めた status なら成功）、`activateLoss`（同一 operation の並行 replay を成功へ）、`beginRelease`（読み経路が no-op になる条件と同じなら沈黙）、`translateReserve`（`operation_id` の UNIQUE だけは `heldByAnother` に写さず fault のまま）、`beginOrResumeKind` / `recoverLease`（`leased` / `false`）のいずれも、「読み経路が先に負けていたら返したはずの答え」に一致している。`globalConcurrency.test.ts:137,179,225,255,342,360,373,395,427,449,495,550` が各分岐を実バインディングで観測。
- **一意性予約の CAS / 応答喪失 / 予約消失** — `reserve` の guard `NOT EXISTS (… AND (state <> 'reserved' OR expires_at IS NULL OR expires_at > ?))` は「失効した reserved 行だけ奪える」を正しく表す。`claim_token` は行を **INSERT する経路でしか**採番されず、`activate` / `beginRelease` の UPDATE は既存値を引き継ぐ（ADR 060）。`beginRelease` の operation_id 付け替えは `state = 'active' AND user_id = ? AND claim_token = ?` の CAS 付き。`release` は `reserved` / `releasing` だけを消し、`active` を落とす経路が無い。
- **`AccountDeletionManifestStore`** — `acknowledge` が `${column} IS NULL` を条件にするので二重 ack は no-op、`claimPending` の `COALESCE(command_key, ? || key)` で再 claim が同じ決定的 key を返す、`appendMembershipPage` の cursor は `membership_directory.operation_id`（= edge key）で `membership_directory_user_edge_idx (user_id, operation_id)` が支える。ページ取りこぼしは `LIMIT n+1` 方式で塞がれている。item の多行書きが `opaque`（write-set へステージしない）であることは class JSDoc に明記済み。
- **`GlobalMaintenanceRunStore`** — `runIdentityGuard` が `(run_id, status, lease_owner, lease_until)` を、`laneIdentityGuard` が `(run_id, generation, shard_id, status, table_index, cursor)` を、それぞれ書き込みの直前に repeat する二重の fencing。`reclaimLapsedLanes` が発火するのは lease が失効した経路だけ（heartbeat では発火しない）で、position と cursor を動かさないので新 owner が同じ keyset から再開する。`advanceOrAck` の `runCompleted` は「自分以外が全部 completed」で、`active` が残っていれば false になる。lane は表名ではなく `table_index` を持ち、現在表は必ず run 行の `tables` から引く（ADR 061）。
- **`LoginAttemptStore`** — `recordFailure` は `INSERT … ON CONFLICT DO UPDATE … RETURNING` の 1 文で、書く値が読んだ値に依存しない（失効行を 1 へ戻す `CASE` も `?2 = now` だけを見る）。しきい値の規則は SQL に無い。アカウント列挙（ADR 028）への露出は無い — 行は `LoginAttemptKey` の名前空間付き鍵だけを持ち、`get` は失効行を `null` として返し、存在の有無で分岐する応答はこの層に無い。共有側の鍵材料が `TokenHash` である点も `spec/database/index.md:328` どおり。
- **`OAuthStateStore.take`** — `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` で、期限を `WHERE` に混ぜず返り行で判定する（`spec/database/index.md:704`）。束縛不一致は行を消さずに `null` を返すので、他人の state を焼く経路にならない。`session.query` 経由の即時実行だが、`OAuthStateStore` / `LoginAttemptStore` は `di/types.ts:181-182` のとおり RequestContainer 側にしか置かれておらず、UoW 内から呼ばれる配線が無い（`cloudflareRuntime.ts:352-353` は autocommit session）。
- **`0001_global_schema.sql` の Identity / directory 部** — `users` / `identities` / `auth_tokens` / `oauth_flow_states` / `identity_removal_receipts` / `membership_directory` / `distributed_operations` / `account_deletion_manifests(_items)` / `global_maintenance_runs(_lanes)` の列・CHECK・索引が `spec/database/index.md` の各節と一致。`auth_tokens` に部分 UNIQUE を置いていないこと、`identities` に件数 trigger を置いていないことは、それぞれ spec:230 と spec:289 に理由付きで明文化されている。FK 不在も冒頭コメントと spec:10 が対応。
- **`findPendingByUserAndPurpose` の未定義幅** — ポート JSDoc（「どの行が返るかは未定義」）・`spec/domains/identity.md:482`・`spec/database/index.md:230`・D1 実装（`ORDER BY created_at DESC, id DESC`）の 4 者がそろっている。`compare` は SQL の `ORDER BY` と同じ順序を再現している。
- **コメント** — 担当範囲のコメントはすべて WHY（planner の挙動、guard の位置、`opaque` を選ぶ理由、契約の非対称）か library JSDoc で、指摘への弁明・修正経緯の記述は見当たらない。

#### カバレッジ

- 確認:
  - `packages/core/src/adapters/cloudflare/cursor.ts`
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`
  - `packages/core/src/adapters/cloudflare/d1/schema.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/authTokenRepository.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/distributedOperationStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/globalMaintenanceRunStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/idempotencyStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identityRemovalReceiptStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identityRepository.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identityUniqueDirectory.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/loginAttemptStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/oauthStateStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/sessionRepository.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/userBatchReader.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/userRepository.ts`
  - `packages/core/src/adapters/cloudflare/sql/{errors,executor,json,occGuard,row,session,statement}.ts`（担当リポジトリの読み書きの土台として全読）
  - `packages/core/src/adapters/cloudflare/__tests__/support.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/idempotency.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/ports/deps.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/ports/directory.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/ports/identity.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/conformance/identity.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/conformance/directory.test.ts`
  - `packages/core/src/application/di/cloudflareRuntime.ts`（Identity / directory / maintenance の配線と session 種別のみ）
  - `packages/core/src/application/errors.ts`
  - `packages/core/src/application/identity/requestPasswordReset.ts`
  - `packages/core/src/application/identity/resendVerificationEmail.ts`
  - `packages/core/src/application/ports/noteRouteFanOutReader.ts`（cursor 契約の文言のみ）
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`
  - `spec/database/index.md`
  - `spec/domains/identity.md`
  - `spec/domains/index.md`（Identity / directory / operation の節のみ）
  - `spec/usecases/identity.md`
  - `spec/testcases/identity/deleteAccount.md`
  - `spec/testcases/identity/listPublicProfiles.md`
  - `spec/adr/063-public-cursor-not-authenticated.md`
  - 差分外の参照: `packages/core/src/adapters/conformance/{accountDeletionManifestStore,authTokenRepository,loginAttemptStore}.ts`、`packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`、`packages/core/src/domain/common/pagination.ts`、`packages/core/src/domain/identity/ports/{loginAttemptStore,sessionRepository}.ts`、`packages/core/src/application/ports/accountDeletionManifestStore.ts`、`packages/core/src/application/identity/{authResidueCleanup,pruneExpiredAuthState}.ts`、`packages/core/src/application/di/types.ts`
- スキップ:
  - `.thread/11/**`（`plan.md` / `triage-keys.md` は入力として読了。`adr.md` は W-001 の関連 ADR 確認のみ。他のレビュー記録・進行記録は成果物ではない）
  - `packages/core/src/adapters/cloudflare/do/**`、`projection/**`、`search/**`、`r2/**`、`scopeRouter.ts`、`scopeTaskQueue.ts`、`execution/**` — scope / routing / UoW / projection 観点の担当
  - `packages/core/src/adapters/cloudflare/d1/repositories/{noteRouteStore,noteRouteFanOutReader,outboxRepository,publicNoteProjection,publicNoteQueryService}.ts` — routing / projection 観点の担当
  - `packages/core/src/adapters/cloudflare/__tests__/{alarm,deleteFilesByOwner,durability,harness,projectionConcurrency,r2,routeGuard,runtimeComposition,searchEdges,sessionOverlay,unitOfWork}.test.ts`、`__tests__/{env.d.ts,worker.ts,conformanceBackend.ts,ports/{projection,route,scopeBusiness,scopeInfra}.ts}`、`__tests__/conformance/{projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts` — 対応するポート群が観点外
  - `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — composition 観点の担当
  - `packages/core/src/application/{cleanup/*,workers/*,storage/__tests__/*,ports/scopeTaskScheduler.ts,di/runtime.ts}`、`packages/core/src/domain/note/ports/*` — scope / composition 観点の担当
  - `spec/{platform/index.md,adr/021,adr/056,adr/index.md,domains/note.md,domains/workspace.md,inventory/*,testcases/note/*,usecases/note.md}` — note / routing / composition 観点の担当
  - `.github/workflows/ci.yml`、`README.md`、`docs/*`、`package.json`、`packages/core/package.json`、`packages/core/tsconfig*.json`、`packages/core/vitest.workers.config.ts`、`packages/core/wrangler.test.jsonc`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`vitest.config.ts`、`vitest.shared.ts` — ビルド / CI / 文書で composition 観点の担当
