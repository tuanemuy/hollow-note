### Identity / directory / operation（D1 control plane）

Round 001 で指摘した `GlobalMaintenanceRunStore` の guard 欠落は、`runIdentityGuard` / `laneIdentityGuard` として正しく塞がっている。`run_id + status + lease_owner + lease_until` を丸ごと読んだ値で照合する形は fencing として実効的で、`globalConcurrency.test.ts` の 5 ケース（uniqueness の競り、`beginOrResume` の running 1 件、lapsed lease の奪い合い、奪われた owner の checkpoint 不着地、同一 hour bucket の作り直し）が敗者側の答えまで固定している。`interposeOnce` で「読みと適用のあいだ」を明示的に作る書き方は、`Promise.all` 頼みより observation として強い。`spec/platform/index.md` の「run の lease は fencing である」節と `spec/database/index.md` の `_occ_guard` / `global_maintenance_run_lanes` 節も実装と 1 対 1 で対応している。

同一 hour bucket の「作り直し」（`ON CONFLICT (run_id) DO UPDATE` + lane の DELETE→再 INSERT）については、進行中の run を壊す経路を探したが**見つからなかった**。`candidateRunId` は kind を含んで決定的なので、同じ `run_id` を持つ既存行は必ず同じ kind であり、前置した `SELECT 1 WHERE NOT EXISTS (running run of this kind)` guard が「running を上書きする」分岐を batch ごと落とす。lane の DELETE も `run_id` で閉じている。

以下は本ラウンドで新たに残った 3 点と、spec / 契約の突き合わせで出た差分である。

#### Blockers

- **[B-001]** `acknowledgeReceipt` が JSON 配列の read-modify-write で、並行 ack が静かに 1 件を落とす
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts:569-579`
  - 理由:
    - 実装は「header を読む → `[...current.header.receipts, receipt]` を JS 側で組む → `UPDATE … SET receipts = ?` を無条件で撃つ」である。読みと適用のあいだに guard も条件も無い。
    - receipt を積むのは**互いに独立した継続の鎖**である。`application/identity/authResidueCleanup.ts:92` が `authResidue`、`application/identity/deleteAccount/globalCleanup.ts:89` が `uniquenessRelease`、`application/identity/deleteAccount/cleanupDispatch.ts:94` が `personalCleanup` を、それぞれ別の outbox event / 別の UoW から ack する。CLAUDE.md が明記するとおり relay はリース下で**複数 worker が同時に**行を掴めるので、2 つの ack が同時に走るのは例外的な状況ではない。
    - 両者が `receipts = '[]'` を読んで `['authResidue']` と `['uniquenessRelease']` を書けば、後勝ちで片方が消える。消えた側の鎖はすでに terminal turn を通過しているので**二度と ack を撃たない**（`authResidueCleanup.ts` のコメント自身が「no 'receipt already there, skip' path exists here」＝再配送で取り直せる、と書いているが、それは *ack が落ちた* 場合であって *ack が上書きされた* 場合を救わない）。
    - 結果、`allRequiredAcknowledged` が永久に false になり、`markCompleted` は `finalize acks are incomplete` を投げ続ける。plan.md の「リスクと注意点」が名指した最悪経路そのもの — `accountDeletionBarrier` が開いたまま User が `deleting` で残り、参照ランタイムに自動復旧経路が無い。
    - memory は UoW を直列化するので適合スイートからは原理的に観測できず、`globalConcurrency.test.ts` にもこのケースは無い。緑であることは根拠にならない。
  - 提案: 1 文にして原子性を取り戻す。列を触らずに済む形がある。
    ```sql
    UPDATE account_deletion_manifests
       SET receipts = CASE
             WHEN EXISTS (SELECT 1 FROM json_each(receipts) WHERE value = ?1) THEN receipts
             ELSE json_insert(receipts, '$[#]', ?1)
           END
     WHERE operation_id = ?2
    ```
    早期 return（`includes` 判定）は round trip 節約として残してよいが、正しさをそこに依存させないこと。あわせて `globalConcurrency.test.ts` に「別々の receipt を `interposeOnce` で交差させると両方残る」を 1 ケース足す（B-001 が塞がったことを敗者側から観測できる形で）。

- **[B-002]** `IdentityUniqueDirectory.activate` だけが CAS になっておらず、予約が別 operation へ移った瞬間に「他人の予約を勝手に active 化する」
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/identityUniqueDirectory.ts:300-330`（guard は `:303-311`、UPDATE は `:322-328`）
  - 理由:
    - このファイルの JSDoc は「Every transition is a compare-and-set: the branch is decided from the row this call read, and an `occGuard` repeating that same predicate is staged in front of the write」と宣言している。`reserve` の 3 分岐も `beginRelease` も `release` も、実際に予約行の同一性（`operation_id` / `state` / `user_id` / `claim_token`）を述語に持っている。**`activate` だけが違う**。guard は `SELECT 1 FROM users WHERE id = ? AND version = ?` で User の版しか見ておらず、UPDATE の `WHERE` は `kind = ? AND normalized_key = ?` だけで、`operation_id` も `state` も入っていない。
    - 失敗のしかた:
      1. operation A が `handle:alice` を U1 のために予約（行: op=A, user=U1, reserved, expires=T, token=K1）。
      2. A の UserId shard 側の UoW は commit 済み。A は `activate("A", v)` を撃つ。`readByOperation` → op=A の行、`users.U1.version` → v。両方通る。
      3. A の write が着地する前に予約が失効し、operation B が同じ鍵を U2 のために予約する（`reserve` の lapsed 分岐が正しく機能して行を奪う。行: op=B, user=U2, reserved, token=K2）。
      4. A の batch が着地する。guard は `users.U1.version = v` なので**まだ成り立つ**。UPDATE は `(kind, normalized_key)` だけで当たるので、**B の行**が `state='active'` になる。
    - 事後の状態: `resolveClaim('handle','alice')` は `{ userId: U2, claimToken: K2 }` を返す。B の UoW がこのあと失敗して `release("B")` を撃っても、`release` は `reserved` / `releasing` しか消さないので**この行は誰にも解放できない**。A 側は自分の claim が立ったと信じて `users.U1.handle = 'alice'` を持つので、集約と directory が恒久的に食い違う。email 鍵で起きればそのアドレスは二度と登録できない。
    - 窓は狭いが「予約が失効している」は放置された saga の**通常状態**であり、`activate` は `readByOperation` → `users` の読み → write と D1 への round trip を 3 回跨ぐので、瞬間ではない。memory は同期実行なのでこの分岐に到達せず、適合スイートも観測しない。
  - 提案: 他の 3 メソッドと同じ形にそろえる。UPDATE に `AND operation_id = ?` を足し、guard を予約行の同一性まで含めた 1 文にする。
    ```sql
    SELECT 1 FROM identity_unique_reservations r JOIN users u ON u.id = r.user_id
     WHERE r.kind = ? AND r.normalized_key = ? AND r.operation_id = ?
       AND r.state <> 'active' AND u.version = ?
    ```
    guard が外れたときの翻訳は、読み経路が返す答え（`UNIQUE_RESERVATION_NOT_FOUND` / `OPTIMISTIC_LOCK_FAILURE`）へ倒せばよい。`globalConcurrency.test.ts` に「lapsed 予約が別 operation に奪われたあとの `activate` は着地しない」を 1 ケース。

- **[B-003]** `spec/database/index.md#auth_tokens` を「部分 UNIQUE は置かない」へ改訂した一方で、契約の正本であるポート JSDoc が旧記述のまま残っている（AC-8 / ADR 046）
  - 場所: `packages/core/src/domain/identity/ports/authTokenRepository.ts:22-29`、`packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql:111`
  - 理由:
    - 改訂後の spec は「`AuthTokenRepository`の契約は同じ組に複数のpendingが在ることを許しており（適合スイート ADP-identity-024）、部分UNIQUEを張るとポート契約に反する」と書く。倒す向き自体は正しい。
    - ところが `findPendingByUserAndPurpose` の JSDoc は今も「The at-most-one live token of the pair, **per the partial unique index on (`user_id`, `purpose`) over `status = 'pending'` (spec/database/index.md#auth_tokens)**」である。参照先の記述はこの PR が反転させたので、**ポート JSDoc は存在しない索引を根拠に不変条件を主張している**。
    - ADR 046 の決定は「どちらの向きでも、直したあとに『JSDoc だけを読んで実装したものがスイートを通る』が成立していることを確認する」と明記している。今の JSDoc だけを読んだ次のバックエンド実装者は部分 UNIQUE を張り、ADP-identity-024 で落ちる。AC-8 が求める手続きが片側（spec / adr.md）だけで止まっている。
    - あわせて、複数 pending 時の戻り値が D1（`ORDER BY created_at DESC, id DESC`）と memory（`values().find` ＝挿入順の先頭 ≒ 最古）で**逆**になる。`.thread/11/adr.md` ADR-039 はこれを「契約としては未定義の領域」と整理しているが、同じ JSDoc がこの読みを「the only reading of when a token was last issued」＝再送間隔の判定材料と位置づけている以上、値は未定義でよくない。改訂した spec が `ORDER BY created_at DESC, id DESC` を**明文で要求してしまった**ので、実装が spec より弱いバックエンドが 1 つ残っている状態でもある。
  - 提案: (a) JSDoc から「per the partial unique index …」を落とし、「最大 1 件は `deleteByUserAndPurpose` を撃つ呼び出し側の責務であり、複数 pending が在りうる」と、契約を弱めた事実と責務の移動先を明記する（ADR 046「正本が実装側にある場合」の書き方）。(b) 順序を契約にするなら、JSDoc に「最も新しい発行を返す」を足し、適合スイートに 1 ケース加え、memory も同じ順序へそろえる。契約にしないなら `spec/database/index.md` の `ORDER BY` 指定を「D1 実装の選択」と分かる書き方へ落とし、ADR-039 の「宿題」を Issue 化する。(a) だけでも Blocker は閉じる。

#### Warnings

- **[W-001]** `AccountDeletionManifestStore` が、本束で唯一 `_occ_guard` を 1 つも積まない store になっている
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts:226-248`（`writeHeader`）、`:428-459`（`markBuilt` / `beginRollback`）、`:638-696`（`markCompleted` / `markRejected`）
  - 理由: round 001 で `GlobalMaintenanceRunStore` が塞がった結果、状態機械を持つ D1 store のうち guard 皆無なのはここだけになった（`identityUniqueDirectory` 7 / `distributedOperationStore` 5 / `authTokenRepository` 3 / `noteRouteStore` 3 / `userRepository` 2 / `identityRepository` 2 / `idempotencyStore` 2 に対して 0）。すべての遷移が「読んで判定 → 無条件 `UPDATE … WHERE operation_id = ?`」である。`markCompleted` の `requiredAcknowledged()` は write とは別の round trip で評価されるので、判定と適用のあいだは無防備。今日実害が出ていないのは、`building` / `built` / `rollingBack` の事前条件が**呼び出し側の都合で**互いに排他になっているからであって、store の性質ではない。B-001 を 1 文化しても、この形自体は残る。
  - 提案: `writeHeader` に「読んだ `status` と一致すること」を条件にする guard を前置し（`occGuard(SELECT 1 FROM account_deletion_manifests WHERE operation_id = ? AND status = ?)`）、外れたら既存の `stateViolation` へ翻訳する。他の store と同じ二段構えになり、追加コストは commit ごとに 1 文。

- **[W-002]** `distributed_operations` の物理スキーマが spec の列表とずれたまま（AC-9）
  - 場所: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql:224`（`request_key text NOT NULL`）、`:231`（`terminal_at`）、`:227-228`（`attempts` / `next_attempt_at`）
  - 理由: 3 点ある。(1) spec の列表は `request_key` を「accountDeletionのuserRequestではNOT NULL」＝それ以外では NULL 可としているが、実装は全 kind で `NOT NULL` である。しかも改訂で入った `UNIQUE(kind, partition_key, request_key)` は SQLite が NULL を互いに相異なるものとして扱う以上、NULL を許すと再送の重複排除が効かない — つまり実装側が正しく、spec の列表が古い。(2) `terminal_at` は `countTerminalSince` と `deleteTerminal` が鍵にする**現役の列**なのに spec の列表に無い（本文が `expires_at = terminal_at + 120日` と参照しているだけ）。この PR は `identity_unique_reservations.user_version` と `identity_removal_receipts.kind` は spec へ反映したので、同じ基準ならここも対象。(3) 逆に `attempts` / `next_attempt_at` / `expires_at` は宣言だけで、アダプターは常に 0 / NULL を書いて一度も読まない。
  - 提案: `### distributed_operations` の列表を実装に合わせる — `request_key` を NOT NULL に改め kind ごとに閉じた一意性との関係を 1 行で説明し、`terminal_at` を列として立てる。未駆動の 3 列は「recovery Cron / manifest pruner を足すスライスが使う」と列表の備考へ書くか、`.thread/11/adr.md` に理由を残す。

- **[W-003]** spec に無い索引が 3 本あり、うち 1 本は既存の UNIQUE と重複している（AC-9）
  - 場所: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql:96`（`sessions_user_token_idx`）、`:82-83`（`identity_removal_receipts_operation_idx` / `_expires_idx`）
  - 理由: `sessions.token_hash` はすでに `UNIQUE` なので、`findByTokenHash(userId, tokenHash)` の `WHERE user_id = ? AND token_hash = ?` はその UNIQUE 索引 1 本で 1 行に絞れる。`(user_id, token_hash)` を重ねても選択度は上がらず、session 作成のたびに index write が 1 本増えるだけである。しかも `auth_tokens` は**同じ形のクエリ**（`authTokenRepository.ts:116`）を token_hash の UNIQUE だけで引いており、2 表で判断が割れている。`identity_removal_receipts` の 2 本は `findByOperationId` / `deleteExpired` に対応する妥当な索引だが、spec の当該段落は索引を 1 本も挙げていない。
  - 提案: `sessions_user_token_idx` は落とす（落とせない理由があるなら spec の索引一覧へ足し、`auth_tokens` にも同じ索引を張って判断をそろえる）。`identity_removal_receipts` の 2 本は spec の当該段落へ索引行を足す。

- **[W-004]** `beginOrResumeKind` が、新規作成分岐で競り負けたときに**存在しない run の ID** を返す
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/globalMaintenanceRunStore.ts:500-505`
  - 理由: resume 分岐の敗北は `leased(running.runId, running.asOf)` と、実在する run を指して返している。ところが新規作成分岐の敗北は `leased(input.candidateRunId, input.candidateAsOf)` で、この `runId` は guard が batch を落とした結果**作られなかった行**の ID である。勝った側が別の `candidateRunId`（generation 集合が違うなど）で立てていれば、返り値は実在しない run を名乗る。ポートは `leased` を「a run leased by a live foreign owner」と説明しており、識別子は実在する run のものであるべき。今日の唯一の呼び出し側（`pruneExpiredAuthState.ts:242`）は `leased` を見て即 return し `runId` を捨てるので実害は無いが、戻り値の意味としては壊れている。
  - 提案: guard 敗北時に `readRunningRun(input.kind)` を撃ち直し、見つかったらその `runId` / `asOf` を返す（見つからなければ完了直後なので今の値でよい）。1 クエリ増えるのは敗北経路だけ。`.thread/11/adr.md` ADR-037 の「同時 start の敗者もここへ落ちる」に、戻り値をどう決めるかの 1 行を足すこと。

- **[W-005]** 作業経緯を語るコメントが 1 か所残っている
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts:13-15`
  - 理由: 「it is scoped to this bundle only **because the bundles were implemented in parallel**. Merging it with the equivalents in the other D1 bundles is **a later tidy-up**.」— 前半は並列委譲という作業の経緯、後半は未実施の予定であって、CLAUDE.md の「WHY が自明でないときだけ」にも `.thread/11/adr.md` ADR-052（本番ソースから作業記録への参照を全廃する）の向きにも合わない。読者に要るのは「ここは Identity 束が使う共通の文の形である」だけ。
  - 提案: 2 文を削る。重複の統合が要るなら Issue に起こす。

#### その他の観察（対応不要と判断したもの）

- `runIdentityGuard` / `laneIdentityGuard` は `lease_until` まで述語に含むので、同一 owner が `recoverLease` で heartbeat した直後は自分の in-flight な `checkpointLane` も落ちる。現在の `pruneExpiredAuthState` は 1 invocation 内で heartbeat を撃たないので到達せず、落ちても `foreignLease` → 静かに降りるだけなので安全側。
- `pruneCompleted` の `DELETE FROM …runs WHERE run_id IN (…)` は `status = 'completed'` を条件に持たないが、`retain_until` が 30 日前である行と同一 hour bucket の再駆動は同時に成立しないので、running run を消す経路にはならない。
- `distributedOperationStore.countTerminalSince` が `session.query`（オーバーレイ素通し）なのは、「数えて → 判定して → はじめて作る」（ADR 044）の順序上、同一 UoW 内で自分が書いた terminal を数える必要が無いため妥当。
- `LoginAttemptStore.recordFailure` は spec の SQL 断片と 1 文で一致し、`?2` を `last_failed_at` と失効判定の両方に使う形も spec の説明どおり。ADR 028（アカウント列挙耐性）に対しては判定材料を返すだけなので影響しない。
- `OAuthStateStore.take` は `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` の 1 文で、期限は返った行で判定している。spec の `### oauth_flow_states` 末尾と ADR 034 の「照合が消費と同一の原子操作」に厳密に一致する。
- `DistributedOperationStore.beginOrResume` の 3 分岐（同一 request key → resumed / running あり → resumed / 新規）と、`(kind, partition_key) WHERE state NOT IN ('completed','rejected')` の部分ユニーク索引は kind ごとに閉じており、spec 改訂（kind 込みの一意性）と実装が一致している。`globalConcurrency.test.ts` が running 1 件を実バインディングで観測している。
- `AccountDeletionManifestStore` の取りこぼし / 二重 ack は塞がっている。`acknowledge` は `${column} IS NULL` を条件に持ち、`claimPending` は `COALESCE` で決定的 command key を保ち、`appendMembershipPage` は `(user_id, operation_id)` 索引の昇順 keyset で `operation_id` を cursor にしている（cursor の飛びは `conflict: "ignore"` の冪等 append と組で閉じている）。
- `json_each` 展開と `assertBindable` は本束の全リスト操作に徹底されており、bound parameter 上限 100 に触れる文は無い。`MAX_STATEMENTS_PER_COMMIT = 250` に対し、`deleteExpiredPage` の 1 ページ最大 100 文 + guard も収まる。
- 適合スイート（`packages/core/src/adapters/conformance/`）は 1 行も変更されておらず、AC-8 の「スイートを触ったら memory も同じケースを通す」手続きに抵触する変更は無い。
- `_scope_identity` / `scope_task_due_index` / `_occ_guard` / `global_maintenance_run_lanes` / `account_deletion_manifest_items` の spec 節はいずれも実装と一致し、`spec/platform/index.md` の「run の lease は fencing である」段落も `_occ_guard` による実装を名指しで説明している（round 001 W-002 / W-005 は解消）。

#### カバレッジ

- 確認: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/userRepository.ts`, `.../userBatchReader.ts`, `.../identityRepository.ts`, `.../sessionRepository.ts`, `.../authTokenRepository.ts`, `.../identityRemovalReceiptStore.ts`, `.../loginAttemptStore.ts`, `.../oauthStateStore.ts`, `.../identitySupport.ts`, `.../identityUniqueDirectory.ts`, `.../distributedOperationStore.ts`, `.../accountDeletionManifestStore.ts`, `.../globalMaintenanceRunStore.ts`, `packages/core/src/adapters/cloudflare/sql/errors.ts`, `.../sql/executor.ts`, `.../sql/json.ts`, `.../sql/occGuard.ts`, `.../sql/row.ts`, `.../sql/session.ts`, `.../sql/statement.ts`, `packages/core/src/adapters/cloudflare/cursor.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `.../__tests__/ports/deps.ts`, `.../__tests__/ports/identity.ts`, `.../__tests__/ports/directory.ts`, `.../__tests__/conformance/identity.test.ts`, `.../__tests__/conformance/directory.test.ts`, `.../__tests__/globalConcurrency.test.ts`, `spec/database/index.md`, `spec/platform/index.md`(Global Cron 節), `.thread/11/plan.md`, `.thread/11/adr.md`, `.thread/11/review/triage-keys.md`
- 差分外で照合したもの（変更なし）: `packages/core/src/domain/identity/ports/{identityUniqueDirectory,authTokenRepository}.ts`, `packages/core/src/application/ports/{globalMaintenanceRunStore,accountDeletionManifestStore}.ts`, `packages/core/src/adapters/memory/repositories/{identityUniqueDirectory,authTokenRepository,globalMaintenanceRunStore}.ts`, `packages/core/src/application/identity/{pruneExpiredAuthState,authResidueCleanup}.ts`, `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`, `packages/core/src/application/workers/eventRelayWorker.ts`, `spec/adr/046-port-contract-divergence.md`
- スキップ: `packages/core/src/adapters/cloudflare/do/**`（全 15 ファイル）— scope DO 平面。scope infra / business 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/{noteRouteStore,noteRouteFanOutReader,outboxRepository,idempotencyStore,publicNoteProjection,publicNoteQueryService}.ts` — route / infrastructure / projection 束
- スキップ: `packages/core/src/adapters/cloudflare/{execution,projection,search,r2}/**`, `scopeRouter.ts`, `scopeTaskQueue.ts` — UoW / FTS / R2 / cross-plane 束
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{alarm,deleteFilesByOwner,durability,harness,idempotency,lease,r2,routeGuard,runtimeComposition,searchEdges,sessionOverlay,support,unitOfWork}.test.ts`, `__tests__/{worker.ts,env.d.ts}`, `__tests__/ports/{projection,route,scopeBusiness,scopeInfra}.ts`, `__tests__/conformance/{projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts` — DO / UoW / projection / R2 観点の担当領域
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 30 スイートの網羅チェック。合成根 / テスト基盤観点
- スキップ: `packages/core/src/application/di/{cloudflareRuntime,runtime}.ts` — 合成根観点。`DEFAULT_MAINTENANCE_TABLES` の単一正本化は triage で #16 へ部分 defer 済み
- スキップ: `packages/core/src/domain/note/ports/{localNoteQueryService,publicNoteQueryService}.ts` — 検索 / projection 観点
- スキップ: `packages/core/{tsconfig.json,tsconfig.cloudflare.json,vitest.workers.config.ts,wrangler.test.jsonc,package.json}`, `package.json`, `vitest.config.ts`, `vitest.shared.ts`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, `docs/test.md` — ビルド / テスト基盤の構成。本観点外
- スキップ: `.thread/11/{foundation,progress,steps,testing}.md`, `.thread/11/review/{review-001.md,review-001-composition.md,review-001-identity.md,review-001-routing.md,review-001-scope.md,review-001-uow.md,triage.md}` — 作業記録・前ラウンドの結論。ゼロベース評価のため判断材料には使わず、既出判定として `triage-keys.md` のみ参照した
