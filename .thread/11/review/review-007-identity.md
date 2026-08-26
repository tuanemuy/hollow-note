### Identity / directory / operation（D1 control plane）

#### Blockers

なし

#### Warnings

なし

Blocker ゼロ / Warning ゼロ。以下は「粗探しをしなかった」のではなく、**指摘候補として検討して落とした**もの。次ラウンドのために根拠を残す。

- **`appendMembershipPage` / `appendAuthorRoutePage` に `status = 'building'` の occGuard が無い**（`accountDeletionManifestStore.ts:326-329,411-417`）。同ファイルの `writeHeader` が全遷移を guard で守っているのに対し、この 2 つは read-then-branch のみ。到達可能な最悪ケース（`markBuilt` / `beginRollback` と交差した stale append）を辿ったが、item の INSERT は `ON CONFLICT DO NOTHING`、cursor は build 中しか読まれず、後から増えた item は `claimPending("cleanup")` / `compactItems` が必ず拾う（`allRollbackReleased` は `prepare_dispatched_at IS NOT NULL` で絞るので新 item は判定を止めない）。自己修復するので指摘にしない。
- **`pruneTerminal` / `pruneCompleted` の DELETE が選択述語を持ち越さない**（`accountDeletionManifestStore.ts:794-808`、`globalMaintenanceRunStore.ts:782-790`）。`identitySupport.ts` の `deleteExpiredPage` / `deleteBoundedByKey` は Round 5 の決定どおり述語を各 DELETE へ持ち越しているので非対称に見えるが、両者とも**行が集合から出られない**。manifest header の terminal（`completed` / `rejected`）は終端で、`begin` が `ON CONFLICT DO NOTHING` なので蘇生しない。run 行は `beginOrResumeKind` の `ON CONFLICT (run_id) DO UPDATE SET status='running'` で蘇生しうるが、candidate run id は `hourBucketOf(now)`（`pruneExpiredAuthState.ts:77-81,233`）が UTC 時刻を丸ごと含むので、`expires_at = completed_at + 30日` を過ぎた行の id が再び採番されることはない。到達不能。
- **`pruneCompleted` の `splitKeyset` が区切り文字なしの `after` を検査しない**（`globalMaintenanceRunStore.ts:799-805`）。`decodeOpaqueCursor` は fp と型しか見ないので、細工した cursor で `Number(NaN)` がバインドされうる。ただしこの cursor は Cron 継続の payload にしか載らず外部入力の経路が無く、ADR 063 のとおり cursor は capability ではない（読みは自前の可視性述語を必ず掛ける）。実害が構成できないので落とす。

#### 確認した契約と挙動

- **ポート契約 ⇄ SQL**: `_occ_guard` の二重否定（`occGuard(SELECT 1 WHERE NOT EXISTS(...))` の入れ子）を `identityUniqueDirectory.reserve` / `distributedOperationStore.beginOrResume` / `globalMaintenanceRunStore.beginOrResumeKind` / `idempotencyStore`（staged 経路）の 4 か所で展開して検証。いずれも「期待が崩れたときだけ CHECK 違反」の向きで正しい。`occGuard.ts` / `errors.ts` の形は `spec/database/index.md#_occ_guard` と 1 対 1。
- **keyset の正しさ**: `deleteExpiredPage`（`identitySupport.ts:70-119`）は `expires_at <= now` を絞り込み、順序と cursor は表キーのみ。`LIMIT size + 1` の n+1 で `nextCursor` を決めるので、ページ境界に穴も重複も出ない。`pruneTerminal` は `operation_id` 単独 keyset（`accountDeletionManifestStore.ts:766-793`）で `spec/database/index.md:180,207` と `spec/testcases/identity/deleteAccount.md` の改訂文に一致。`pruneCompleted` だけが `(expires_at, run_id)` の複合 keyset だが、これは `spec/database/index.md:166,228` が「回収の走査順」として別に定めている側で、共通規約 (`:16`) が列挙する 4 メソッドには入らない。矛盾なし。
- **cursor 節の出し入れ**: `? IS NULL OR` を避けて cursor 節を SQL 文字列に織り込む形が `deleteExpiredPage` / `appendMembershipPage` / `pruneTerminal` / `pruneCompleted` の 4 か所で一貫。params の並びも各分岐で追跡して一致を確認。
- **guard 敗北の翻訳と読み直し**: `writeHeader`（着地した status が目的地なら成功）、`activateLoss`（同一 operation の並行 replay を成功へ畳む）、`beginRelease`（読み経路の no-op 条件と同じ沈黙）、`translateReserve`（`operation_id` の UNIQUE だけは「使用中」に翻訳しない）を確認。`globalConcurrency.test.ts:137-570` が 4 経路すべてを実バインディング上で観測している。
- **一意性予約の CAS / 応答喪失 / 予約消失**: `claim_token` が `reserve` の INSERT でだけ採番され `activate` / `beginRelease` の UPDATE では引き継がれること（ADR 060、`spec/database/index.md:60`）をコードで確認。`release(operationId)` が `reserved` / `releasing` の両方を落とすこと、`activate` が commit 後（UoW 外）に呼ばれる（`signUpWithPassword.ts:239-263` / `uniqueness.ts:265-300`）ので `USERS` を JOIN する guard が未 commit の版を読む窓が無いことも確認。
- **`AccountDeletionManifestStore`**: 二重 ack は `${column} IS NULL` で先着が勝つ、`claimPending` の command key は SQL 側 `COALESCE(..., ? || key)` と JS 側の再導出が同一綴り、receipts は `json_insert` の read-modify-write 回避。`ALL_FINALIZE_RECEIPTS` の既定（宣言なし＝全 enum で停止）は ADR 039 の厳しい側で正しい。
- **`GlobalMaintenanceRunStore`**: ADR 061 の契約 1〜4 を 1 つずつ突き合わせ。lane は `table_index` のみ保持し現在表は run 行の `tables` から引く、自動 claim は永続化済み position をそのまま返す（`commandKey` を再 mint しない）、解放は `next: null`、`next === null` と `runCompleted` が独立。`reclaimLapsedLanes` が lapsed のときだけ走ること、`recoverLease` が heartbeat では lane を返さないことも確認。`globalMaintenanceRunStore` は `GlobalPlaneRepositories` に含まれない（`conformanceBackend.ts:147-163`）ので、`reclaimLapsedLanes` が `opaque` であることによる read-your-writes の穴は成立しない。
- **`LoginAttemptStore`**: `recordFailure` は `spec/database/index.md:358-368` の SQL と文字どおり同一（バインド順 `key, at, at+ttl, at` が `?1,?2,?3,?2` に対応）。単一文なので ADR 028 の「しきい値規則を SQL へ持ち込まない」も守られ、列挙耐性はユースケース側の責務のまま。10 並行の適合ケース（TC-identity-227）が実 D1 で走る。
- **`OAuthStateStore.take`**: `DELETE ... WHERE state = ? AND state_binding_hash = ? RETURNING *` で束縛不一致は行を残し、期限は返った行で判定。適合スイートの 6 ケース（不一致で残す / 期限切れかつ一致で消す / 期限切れかつ不一致で残す / 並行 take で 1 件）を実装が満たすことを確認。
- **`spec/` の改訂と実装の 1 対 1**: 共通規約「有界な掃引 / 削除」（`:16`）と、identity 系 5 表 + `identity_removal_receipts` + `account_deletion_manifests` の索引の役割文を DDL と突き合わせ、索引名・列順・部分索引の述語まで一致。`distributed_operations` の 5 本、`membership_directory` の 5 本、`global_maintenance_run*` の 3 本も同様。`auth_tokens` の部分 UNIQUE 撤回がポート JSDoc / `spec/domains/identity.md:482` / `spec/usecases/identity.md:495` / `requestPasswordReset.ts` / `resendVerificationEmail.ts` の 5 か所で揃っていることも確認。
- **コメント**: `d1/` / `sql/` / `cursor.ts` に修正の経緯・弁明・TODO の類は 0 件（grep 済み）。残っているのはすべて WHY か library-level JSDoc。

#### カバレッジ

- 確認: `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts`, `.../authTokenRepository.ts`, `.../distributedOperationStore.ts`, `.../globalMaintenanceRunStore.ts`, `.../idempotencyStore.ts`, `.../identityRemovalReceiptStore.ts`, `.../identityRepository.ts`, `.../identitySupport.ts`, `.../identityUniqueDirectory.ts`, `.../loginAttemptStore.ts`, `.../oauthStateStore.ts`, `.../sessionRepository.ts`, `.../userBatchReader.ts`, `.../userRepository.ts`
- 確認: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/cursor.ts`
- 確認: `packages/core/src/adapters/cloudflare/sql/{errors,executor,json,occGuard,row,session,statement}.ts`, `packages/core/src/adapters/cloudflare/execution/{globalUnitOfWork,writeSet}.ts` — guard の翻訳地点と staged/autocommit の読み分けが担当範囲の正しさの前提になるため
- 確認: `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `.../__tests__/ports/{identity,directory}.ts`, `.../__tests__/conformance/{identity,directory}.test.ts`, `.../__tests__/globalConcurrency.test.ts`, `.../__tests__/support.test.ts`, `.../__tests__/sessionOverlay.test.ts`, `.../__tests__/idempotency.test.ts`
- 確認: `packages/core/src/domain/identity/ports/authTokenRepository.ts`（差分）、および差分外の `identityRepository.ts` / `identityUniqueDirectory.ts` / `loginAttemptStore.ts` / `sessionRepository.ts` / `userBatchReader.ts` / `userRepository.ts`、`packages/core/src/application/ports/{accountDeletionManifestStore,globalMaintenanceRunStore}.ts`, `packages/core/src/application/execution/unitOfWork.ts`, `packages/core/src/domain/common/pagination.ts`
- 確認: `packages/core/src/application/identity/{requestPasswordReset,resendVerificationEmail}.ts`、差分外の `pruneExpiredAuthState.ts` / `signUpWithPassword.ts` / `uniqueness.ts`（`activate` の呼び出し位置の検証のため）
- 確認: 差分外の適合スイート `packages/core/src/adapters/conformance/{accountDeletionManifestStore,globalMaintenanceRunStore,identityUniqueDirectory,loginAttemptStore,oauthStateStore}.ts`
- 確認: `spec/database/index.md`（共通の規約・Identity 節・directory / operation 節・`_occ_guard`）, `spec/domains/identity.md`, `spec/usecases/identity.md`, `spec/testcases/identity/{deleteAccount,listPublicProfiles}.md`, `spec/adr/{028,038,048,053,054,060,061,062}.md`, `spec/adr/063-public-cursor-not-authenticated.md`
- スキップ: `.thread/11/**`（`plan.md` / `adr.md` / `triage-keys.md` を除く 40 ファイル） — 過去ラウンドのレビュー記録・進捗ログで、レビュー対象の成果物ではない
- スキップ: `packages/core/src/adapters/cloudflare/do/**`（15 ファイル）, `.../projection/**`（4）, `.../search/**`（2）, `.../r2/objectStorage.ts`, `.../scopeRouter.ts`, `.../scopeTaskQueue.ts`, `.../execution/{nesting,scopeUnitOfWork}.ts` — scope 平面 / 投影 / 検索 / ルーティングの担当観点
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/{noteRouteFanOutReader,noteRouteStore,outboxRepository,publicNoteProjection,publicNoteQueryService}.ts` — route / 投影 / outbox の担当観点
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{alarm,deleteFilesByOwner,durability,lease,projectionConcurrency,r2,routeGuard,runtimeComposition,searchEdges,unitOfWork}.test.ts`, `.../__tests__/conformance/{projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts`, `.../__tests__/harness.test.ts`, `.../__tests__/ports/{deps,projection,route,scopeBusiness,scopeInfra}.ts`, `.../__tests__/{env.d.ts,worker.ts}` — 上記のスキップ範囲に対応するテスト
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイート全体の網羅検査で composition 観点
- スキップ: `packages/core/src/application/{cleanup/participants.ts,cleanup/personalCleanup.ts,di/cloudflareRuntime.ts,di/runtime.ts,errors.ts,ports/noteRouteFanOutReader.ts,ports/scopeTaskScheduler.ts,workers/scopeTaskRunner.ts}` と対応するテスト 2 件 — composition / scope の担当観点（`DEFAULT_MAINTENANCE_TABLES` のみ ADR 061 の検証のために参照）
- スキップ: `packages/core/src/domain/note/ports/{localNoteProjectionWriter,publicNoteProjectionWriter,publicNoteQueryService}.ts` — Note 投影の担当観点
- スキップ: `spec/domains/{index,note,workspace}.md`, `spec/usecases/note.md`, `spec/testcases/note/*.md`, `spec/inventory/*.md`, `spec/platform/index.md`, `spec/adr/{021,056,index}.md` — Note / scope / 台帳 / platform の担当観点
- スキップ: `.github/workflows/ci.yml`, `README.md`, `docs/{runtime_node,test}.md`, `package.json`, `packages/core/package.json`, `packages/core/tsconfig*.json`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts` — ビルド / CI / 依存の配線で composition 観点
