### Identity / directory / operation（D1 control plane）

ゼロベースで再レビューした。ポート契約（JSDoc）・適合スイート・memory 実装・`spec/` の 4 者を突き合わせ、SQL がそれを満たすかを見た。

契約面は堅い。`_occ_guard` による CAS、guard 敗北時の読み直し、一意性予約の claim token（ADR 060）、lane の position 権威（ADR 061）、`login_attempts` の期限切れ再開（memory・適合スイートと一致）、`OAuthStateStore.take` の「束縛は `WHERE`、期限は戻り行で判定」——いずれも契約どおりで、`__tests__/globalConcurrency.test.ts` の `interposeOnce` による三者競合ケースが実効的に守っている。Blocker は無い。

以下は性能と spec 追随に関する指摘。

#### Blockers

なし

#### Warnings

- **[W-001]** cursor の null ガードを `OR` で書いたため keyset がレンジ述語にならず、ページングが二次オーダーになる
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts:84`、`packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts:336`（`appendMembershipPage`）、`packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts:767`（`pruneTerminal`）、`packages/core/src/adapters/cloudflare/d1/repositories/globalMaintenanceRunStore.ts:747`（`pruneCompleted`）
  - 理由: 4 か所とも `AND (? IS NULL OR key > ?)` の形をとる。`? IS NULL` は列に対する制約ではないので、SQLite はこの `OR` 項をインデックスのレンジ制約に落とせず、**残余述語としてしか評価できない**。結果として cursor は「読み飛ばし」にしかならず、走査の開始位置を動かさない。1 ページ 100 件の掃引を P ページ回すと、p ページ目が p×100 行を走査し直すので全体 O(P²×100) になる。`deleteExpiredPage` の 5 表（`sessions` / `auth_tokens` / `login_attempts` / `oauth_flow_states` / `identity_removal_receipts`）はいずれも行数が利用者数に比例して伸びる表であり、掃引が最も要る規模でこの性質が効く。`globalMaintenanceRunStore.pruneCompleted` はせっかく `(expires_at > ? OR (expires_at = ? AND run_id > ?))` と正しい複合 keyset を組み立てているのに、その前に付いた `? IS NULL OR` が `global_maintenance_runs_expiry_idx` の利用ごと潰している。`appendMembershipPage` も同様で、`membership_directory_user_edge_idx (user_id, operation_id)` は `user_id` の等値までしか使えない
  - 提案: null ガードを述語の中で解決せず、文の組み立てで解決する。`cursor === null` のときは cursor 節を落とした SQL を、非 null のときは `AND key > ?` を付けた SQL を組む（`identitySupport` は 1 か所直せば 5 表に効く）。文を分けたくないなら型ごとに番兵で `coalesce` へ落とす（text 鍵なら `key > coalesce(?, '')`、integer なら下限値）。どちらでも索引のレンジ制約になる

- **[W-002]** 期限索引の役割についての `spec/database/index.md` の記述が、ポート契約が定める掃引の順序と食い違う（AC-9）
  - 場所: `spec/database/index.md:309`（`identity_removal_receipts_expires_idx` — 本 PR で追加された行）、`spec/database/index.md:325` / `341` / `354` / `697`、および `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql:83,95,112,121,138`
  - 理由: spec は `(expires_at, key)` の索引を「期限切れの100件ずつの回収に使う」「同一expiryを安定keysetで回収する」「旧世代/期限切れを100件ずつ削除する」と書いている。しかし `PrunePage` の契約（`packages/core/src/domain/common/pagination.ts`、memory の `adapters/memory/support.ts:deleteExpiredPage`、本 PR の `identitySupport.ts:70` の JSDoc）は揃って「`expiresAt <= now` は**フィルタであって順序ではない**。行は表キーだけで順序付け・ページングする」と定めている。実際に発行される SQL も `ORDER BY key` である。この索引は expired 集合への絞り込みには使えても**順序は与えられない**ので、毎ページ expired 集合全体のソートが入り、cursor は W-001 のとおり残余述語にしかならない。spec が言う「安定keysetでの回収」はどの表でも成立していない
  - 提案: 正本はポート契約（ADR 026 / 046）側にあるので、spec の 5 行を実態に合わせて改める — 「掃引は表キー順の keyset で進み、`expires_at` は絞り込みの述語である。`(expires_at, key)` 索引は期限切れ集合への絞り込みに効く」。逆に `(expires_at, key)` keyset を本当に採るなら `PrunePage` の cursor 意味論・memory・適合スイートが同時に動くので、それは AC-7 / AC-8 の手続きが要る別 Issue として起票する

- **[W-003]** 有界削除が選択述語を削除文へ持ち越さず、1 行 1 文で発行している
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts:103`（`deleteExpiredPage`）、`packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts:149`（`deleteBoundedByKey`）
  - 理由: 2 点ある。
    (1) **述語の欠落**。`SELECT` は `expires_at <= ?` や `user_id = ? AND auth_epoch < ?` で選ぶのに、`DELETE` は `WHERE id = ?` だけで撃つ。読みと書きのあいだに行が条件から外れても消える。`SessionRepository.refreshAuthEpoch` は現在 session の `auth_epoch` を新世代へ引き上げる唯一の口で、`authResidueCleanup` の `deleteOlderEpochByUser` と競合しうる — 旧世代として選ばれた直後に refresh が着地すると、現在の session が消えて利用者が強制サインアウトされる。`login_attempts` でも、選ばれた直後に `recordFailure` が `expires_at` を延ばした行を掃引が消し、失敗回数が 0 に戻る（スロットルの緩和）。UoW 内で呼ばれた場合は `session.query` の読みが staged overlay を通らないぶん、窓が UoW 全体に広がる。memory は同期区間で読み書きするのでこの窓を持たず、適合スイートには観測できない乖離である。
    (2) **文の本数**。`spec/database/index.md` の「共通の規約」は「ID の並びで引く / 消す / 入れるクエリは `?` を件数ぶん並べない。JSON 配列を 1 つのバインド変数として渡し、`json_each` で展開する。多行 INSERT も同じ形で 1 文にまとめる」と定め、本 PR の他の D1 リポジトリ（`accountDeletionManifestStore.pruneTerminal` / `compactItems`、`globalMaintenanceRunStore.pruneCompleted`）はすべて `deleteRowsFromJson` を使っている。ここだけが limit 件ぶんの `DELETE` を積み、`MAX_STATEMENTS_PER_COMMIT = 250` のうち最大 100 を 1 呼び出しで使う
  - 提案: どちらも 1 文で閉じる。`DELETE FROM t WHERE <SELECT と同じ述語> AND ${inJsonList(keyColumn)}` を `opaque` で 1 本積む形にすれば、述語の持ち越しと文数の両方が同時に片づく。`remove()` を 1 行ずつ積んでいるのは write-set overlay に消去を見せるためだが、この 2 関数はいずれも自分で読み戻さず、呼び出し側（`requestPasswordReset` / `resendVerificationEmail` は削除→発行の順、`authResidueCleanup` は件数だけを見る）も削除後に同じ表を読まないので、overlay を捨てる代償は今日の呼び出し形では発生しない。捨てたくないなら `remove()` の積み上げは残したまま、各 `DELETE` に述語だけ足す（(1) は閉じ、(2) は残る）

- **[W-004]** `globalConcurrency.test.ts` の `beforeEach` が手書きの部分 wipe になっている
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts:116-128`
  - 理由: `d1/schema.ts` は「a table added to `GLOBAL_TABLES` cannot be left out of the wipe」を目的に `GLOBAL_WIPE_STATEMENTS` を導出しており、`conformanceBackend.ts:79` と `projectionConcurrency.test.ts:136` はそれを使っている。このファイルだけが 6 表を名指しで消しており、同じ観点の表である `account_deletion_manifest_items` が漏れている。今日は items を書くケースが無いので通るが、`appendMembershipPage` / `appendAuthorRoutePage` を使うケースを 1 つ足した瞬間に、テスト間で items が残って `allRequiredAcknowledged` / `compactItems` の結果が実行順に依存する。導出された正本があるのに手書きの副本を置いている形そのものが、`d1/schema.ts` の JSDoc が塞いだはずの穴を開け直している
  - 提案: `executor.apply(GLOBAL_WIPE_STATEMENTS.map(statement))` に置き換える。同じ形の部分 wipe は `idempotency.test.ts` / `lease.test.ts` にもあるので併せて揃えるとよい

#### 確認した点（指摘に至らなかったもの）

- **guard 敗北の読み直しと 3 者競合**: `writeHeader` / `activateLoss` / `beginRelease` / `beginOrResumeKind` の再読みは、いずれも「勝者の書きが先に着地していたら読み経路が返したはずの答え」へ畳んでおり、`globalConcurrency.test.ts` の `interposeOnce` が読みと書きのあいだに第三者を差し込んで観測している（`settles a crossed header transition on the status that landed` / `treats a concurrent replay of the same activation as done` / `stays silent when a teardown loses the claim it observed` / `refuses to activate a lapsed reservation another operation took over`）。staged 経路で catch に到達しない件は #55 として起票済みなので蒸し返さない
- **`acknowledgeReceipt` の `json_each` 冪等追加**: `receipts` は `AccountDeletionReceipt` の閉じた 6 値集合で、`json_insert(receipts, '$[#]', ?)` は `EXISTS (SELECT 1 FROM json_each(receipts) WHERE value = ?)` で守られているので上限も二重追加も生じない。順序は着地順だが、契約・適合スイート（`arrayContaining`）とも順序を要求していない。交差する 2 つの ack が両方残ることは `keeps both receipts when two finalize acks cross` が観測している
- **一意性予約の CAS / 応答喪失 / 予約消失**: `claim_token` は行を**挿入する**経路（新規 INSERT と lapsed 行の `DO UPDATE` 乗っ取り）でだけ採番され、`activate` / `beginRelease` の `UPDATE` では持ち越される（ADR 060）。`release` は `state IN ('reserved','releasing')` だけを消し `active` を落とさない。`operation_id UNIQUE` 違反を `translateReserve` が「鍵の衝突」から分離して fault に落とす扱いも ADR 048 の sub-operation ID 体系と整合している
- **`GlobalMaintenanceRunStore`**: ADR 061 の契約 1〜4 を逐条で照合した。表順は run 行の `tables` 由来（`tableAt` / `projectLane`）、command key は「新しい position は導出、既存 position は永続値をそのまま」（`advanceOrAck` の次表 / 自動 claim / `claimLanes` の 3 経路で正しく分岐）、解放は `next: null` で新規 claim をしない、`asOf` は run 行固定。lease は `runIdentityGuard`（`lease_until` の等値まで含む）で fencing され、`reclaimLapsedLanes` は失効時だけ走る
- **`LoginAttemptStore`**: `INSERT … ON CONFLICT DO UPDATE … RETURNING` の 1 文で原子的。期限切れ行を 1 から数え直す `CASE` は memory 実装と一致し、適合スイート（`an expired record reads as absent and restarts at 1`）が両バックエンドで観測している。ADR 028 の列挙耐性はユースケース層の責務と明記されており、この store は鍵の名前空間分離以上のことを負っていない
- **`OAuthStateStore.take`**: `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` の 1 文。束縛不一致は行を残し、期限切れは戻り行で判定して行は消す — 適合スイートの 4 ケースがこの非対称を直接観測している
- **schema ↔ spec の 1 対 1**: 状態語彙 5 値（`account_deletion_manifests.status`）、`membership_directory.membership_id` の settled-state 限定 CHECK と 3 本の索引、`distributed_operations` の kind 込み一意性・`terminal_at` / `expires_at` / `attempts` の「この配備では既定値のまま」注記、`identity_unique_reservations.user_version`、`auth_tokens` の部分 UNIQUE 撤回とポート JSDoc / ADP-039 / DOM-060 の同時改訂、外部キーを物理制約として要求しない旨の追記、`_scope_identity` / `scope_task_due_index` / `account_deletion_manifest_items` / `global_maintenance_run_lanes` の物理配置表への追加 — いずれも DDL と一致していた。`spec/inventory/{adapter,domain,test,usecase}.md` の最終同期日も 2026-08-26 へ更新済み。`GLOBAL_TABLES` と migration の双方向一致は `harness.test.ts:52,70` が検査している
- **`identities_user_password_uq`**: ポート契約に無い DB 制約だが、ADR 054 の影響節が「identity 行のバックエンド実装者は一意性制約を DB 側に置いてもよい」と明示的に許しており、`spec/database/index.md` も宣言している。適合スイートは同一 user へ 2 件の password identity を入れないので破綻しない
- **コメント**: 担当範囲に、指摘への弁明・修正の経緯・レビュー往復の痕跡にあたる記述は見当たらなかった。残っているのはいずれも WHY / WHY-NOT（`opaque` を選んだ理由、guard を前に置く理由、FK を張らない理由、`ORDER BY` を明示する理由）で、canon への参照も生きている

#### カバレッジ

- 確認:
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `packages/core/src/adapters/cloudflare/d1/schema.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts`, `.../authTokenRepository.ts`, `.../distributedOperationStore.ts`, `.../globalMaintenanceRunStore.ts`, `.../idempotencyStore.ts`, `.../identityRemovalReceiptStore.ts`, `.../identityRepository.ts`, `.../identitySupport.ts`, `.../identityUniqueDirectory.ts`, `.../loginAttemptStore.ts`, `.../oauthStateStore.ts`, `.../sessionRepository.ts`, `.../userBatchReader.ts`, `.../userRepository.ts`
  - `packages/core/src/adapters/cloudflare/sql/errors.ts`, `.../executor.ts`, `.../json.ts`, `.../occGuard.ts`, `.../row.ts`, `.../session.ts`, `.../statement.ts`（上記 SQL の意味を決める土台として読了）
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`, `.../harness.test.ts`, `.../support.test.ts`, `.../idempotency.test.ts`, `.../lease.test.ts`（担当ポートを守っているケースの有無）
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `packages/core/src/application/errors.ts`, `packages/core/src/application/identity/requestPasswordReset.ts`, `packages/core/src/application/identity/resendVerificationEmail.ts`
  - `packages/core/src/application/di/cloudflareRuntime.ts`（担当ポートへ autocommit session が渡ることの確認）
  - `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/usecases/identity.md`, `spec/testcases/identity/deleteAccount.md`, `spec/testcases/identity/listPublicProfiles.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/inventory/frontend.md`
  - 差分外の参照: `packages/core/src/adapters/conformance/{accountDeletionManifestStore,identityRepository,sessionRepository,loginAttemptStore,oauthStateStore,identityUniqueDirectory}.ts`, `packages/core/src/adapters/memory/repositories/{loginAttemptStore,identityUniqueDirectory,accountDeletionManifestStore}.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/domain/identity/ports/{identityUniqueDirectory,sessionRepository}.ts`, `packages/core/src/domain/common/pagination.ts`, `spec/adr/{028,054,061}.md`
- スキップ:
  - `.thread/11/`（`adr.md` / `foundation.md` / `plan.md` / `progress.md` / `steps.md` / `testing.md` / `review/*` の 24 ファイル） — 作業記録。`plan.md` と `review/triage-keys.md` はレビュー入力として読んだが、レビュー対象の成果物ではない
  - `.github/workflows/ci.yml`, `README.md`, `docs/runtime_node.md`, `docs/test.md`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc` — ビルド / CI / テスト実行基盤。composition 観点の持ち分
  - `packages/core/src/adapters/cloudflare/do/`（`alarm.ts`, `dueIndex.ts`, `scheduledTasks.ts`, `schema.ts`, `scopeName.ts`, `scopeObject.ts`, `scopeStub.ts`, `repositories/*` の 16 ファイル） — scope plane。scope 観点の持ち分
  - `packages/core/src/adapters/cloudflare/execution/`（4 ファイル） — UoW / write-set。uow 観点の持ち分（`writeSet` の `opaque` / `upsert` / `remove` の意味だけ `sql/session.ts` 経由で確認）
  - `packages/core/src/adapters/cloudflare/projection/`（4 ファイル）, `.../search/`（2 ファイル）, `.../r2/objectStorage.ts` — 投影 / 検索 / R2。projection 観点の持ち分
  - `packages/core/src/adapters/cloudflare/cursor.ts`, `.../scopeRouter.ts`, `.../scopeTaskQueue.ts` — routing / cursor。routing 観点の持ち分（`pruneCompleted` が使う `encode/decodeOpaqueCursor` の呼び出し形だけ確認）
  - `packages/core/src/adapters/cloudflare/d1/repositories/{noteRouteFanOutReader,noteRouteStore,outboxRepository,publicNoteProjection,publicNoteQueryService}.ts` — note route / outbox / 公開投影。routing・projection 観点の持ち分
  - `packages/core/src/adapters/cloudflare/__tests__/` の残り（`alarm.test.ts`, `conformance/*` の 7 ファイル, `conformanceBackend.ts`, `deleteFilesByOwner.test.ts`, `durability.test.ts`, `env.d.ts`, `ports/*` の 7 ファイル, `projectionConcurrency.test.ts`, `r2.test.ts`, `routeGuard.test.ts`, `runtimeComposition.test.ts`, `searchEdges.test.ts`, `sessionOverlay.test.ts`, `unitOfWork.test.ts`, `worker.ts`） — 担当ポート以外のバックエンド固有検証。scope / uow / composition 観点の持ち分（`conformanceBackend.ts` は wipe 経路のみ確認）
  - `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — スイート網羅の検査。composition 観点の持ち分
  - `packages/core/src/application/cleanup/participants.ts`, `.../cleanup/personalCleanup.ts`, `.../di/runtime.ts`, `.../ports/noteRouteFanOutReader.ts`, `.../ports/scopeTaskScheduler.ts`, `.../storage/__tests__/deleteFilesByOwner.test.ts`, `.../workers/scopeTaskRunner.ts`, `.../workers/__tests__/scopeTaskRunner.test.ts` — cleanup 参加者宣言 / scope task / storage。scope・uow 観点の持ち分
  - `packages/core/src/domain/note/ports/`（4 ファイル） — note 投影・検索の契約。note 観点の持ち分
  - `spec/adr/021-scope-sharded-data-plane.md`, `spec/adr/063-public-cursor-not-authenticated.md`, `spec/adr/index.md`, `spec/domains/note.md`, `spec/domains/workspace.md`, `spec/platform/index.md`, `spec/testcases/note/projectNoteChanges.md`, `spec/testcases/note/searchPublicNotes.md`, `spec/usecases/note.md` — cursor 認証 / note / platform 予算。routing・note 観点の持ち分（identity 系の記述と衝突しないことだけ確認）
