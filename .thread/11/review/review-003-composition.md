### 合成・スキーマ・テストハーネス・spec/docs

実測で確認した受け入れ基準:

- **AC-7 = 満たす。** `git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web` は空。`pnpm typecheck` 緑（root `tsgo` + `@repo/core` の 2 tsconfig）。`pnpm test:node` = **77 files / 981 passed / 3 skipped**（main の 76 / 978 に対し、増分は新規 `conformanceCoverage.test.ts` の 2 件と `scopeTaskRunner.test.ts` の 1 件のみ。既存テストの脱落なし。skip 3 件は既存の `adapters/oauth` の資格情報未設定分）。
- **AC-2 / AC-3 = 満たす。** `pnpm test:workers` = **22 files / 328 passed / 0 skipped**。適合スイートの呼び出しは directory 4 + identity 8 + projection 4 + route 5 + scopeBusiness 6 + scopeInfra 2 + unitOfWork 1 = **30**、全て `makeCloudflareConformanceBackend` 経由で実 D1 / DO / R2 バインディングに当たる。`__tests__/harness.test.ts` が「バインディングが実在すること」「両平面の schema が当たること」「`json_each` / FTS5 / `nodejs_compat` が効くこと」「2 つの backend が 3 平面（D1 wipe / DO 名前空間 / R2 prefix）のどこでも見え合わないこと」を直接観測しており、名前空間分離は 3 面とも実効的。
- **AC-8** — 適合スイート本体（`adapters/conformance/`）は 1 行も変更されていない。契約を広げた箇所（`ScopeTaskScheduler.claimDue` / 両 projection writer の `OPTIMISTIC_LOCK_FAILURE`、`AuthTokenRepository.findPending*` の未定義化）はいずれもポート JSDoc・`spec/domains`・`spec/inventory` の 3 点が同時に動いており、memory 側が落ちないことも実行で確認済み。
- **AC-9** — migration の全表（22）が `spec/database/index.md` の物理配置表に存在し、逆も真（未実装ドメインの表は migration 冒頭のコメントで明示的に不在宣言）。`do/schema.ts` の全表も同様。索引は `sessions` / `auth_tokens` / `login_attempts` / `oauth_flow_states` / `membership_directory` / `note_routes` / `public_note_search` / `identity_removal_receipts` / `_occ_guard` / `scope_task_due_index` / `global_maintenance_run_lanes` を 1 対 1 で突き合わせて一致。`sessions_user_token_idx` の削除は spec の索引リスト（`sessions_user_epoch_idx` / `sessions_expires_idx` の 2 本）と整合しており、`token_hash` の UNIQUE が lookup を担うので走査路も失われていない。
- **`.thread` 参照** — `grep -rn "\.thread" packages apps spec docs README.md` は 0 件。置き換えの記述（`_occ_guard` 節、`scope_task_due_index` 節、`auth_tokens` の未定義宣言、`login_attempts` の条件式加算、port JSDoc）はいずれも「なぜこの形か」を述べる設計文であって、修正の経緯や指摘への弁明にはなっていない。
- **migration の本数** — `0001_global_schema.sql` 1 本のみ。単一ファイルなので `wrangler d1 migrations apply` の適用順・重複適用は問題にならない。
- **CI** — workers を別ジョブに分けた構成は妥当（timeout 20 分、`allowBuilds: workerd: true` の追加あり）。`pnpm typecheck` は node ジョブ側で `tsgo -p tsconfig.cloudflare.json` まで回るので、CF ツリーが型検査から漏れる穴は無い。

#### Blockers

なし

#### Warnings

- **[W-001]** `spec/adr/021` の書き換えが ADR 063 の適用範囲を越え、canon 内で自己矛盾している
  - 場所: `spec/adr/021-scope-sharded-data-plane.md:41` / `spec/adr/063-public-cursor-not-authenticated.md:42`
  - 理由: 021:41 の「公開検索、**公開workspace一覧**、Note routeのcreatedBy/scope二次キー走査は…**署名**cursorで…」から「署名」を落としたが、ADR 063 の決定は `PublicNoteQueryService` の 3 メソッドと `NoteRouteFanOutReader` の 2 メソッドに限定され、影響節は「workspace directory 側のカーソル（`UserWorkspaceDirectory.listActiveByUser` / `PublicWorkspaceDirectoryReader.listPublished`）は…**それらの記述は今も「署名 cursor」のまま**」と明言している。実際に `spec/database/index.md:990`・`spec/platform/index.md:90`・`spec/domains/workspace.md:245,247`・`spec/usecases/workspace.md:605`・`spec/inventory/{usecase,domain,test,adapter}.md` は「署名 cursor」のまま残っており、021 だけが片側へ倒れた。ADR 063 が自分の影響節で述べた事実を、同じ PR の 021 編集が反証している状態になる。
  - 提案: 021:41 の当該文で公開 workspace 一覧を分離して「署名」を残す（例: 「公開検索と Note route の二次キー走査は cursor…、公開workspace一覧は署名cursor…」）か、逆に ADR 063 の影響節を「021 の該当文からは語を落とし、workspace directory 側のポート仕様（`domains/workspace.md` ほか）は署名のまま残す」と実態に合わせる。どちらでもよいが、両方が同じことを言っている必要がある。

- **[W-002]** `CLAUDE.md` だけが README / docs と同じ主張を持ったまま古い
  - 場所: `CLAUDE.md`（Architecture > Adapters / Reference runtime / Development Commands）
  - 理由: README は「Its adapter group (`packages/core/src/adapters/cloudflare/`) and DI wiring are in place and pass the same port-conformance suites…what remains is the paired entry point and the deployment configuration」に直され、`docs/test.md` は 2 プロジェクト構成へ全面改訂された。一方 `CLAUDE.md` の「Reference runtime」末尾は今も「Reaching it means **adding** an adapter group under `packages/core/src/adapters/{provider}/` plus a paired entry point and DI wiring」と書き、Adapters 節は `memory/` と `conformance/` しか挙げず、Development Commands は `pnpm test`（「one vitest run at the root, spanning `apps/web` and `packages/core`」）だけで `test:node` / `test:workers` に触れない。同じ主張の 3 つ目の写しがここだけ取り残されており、CLAUDE.md 自身の「pointers only」方針からしても、事実が変わった以上ポインタ側を直すのが筋。
  - 提案: Adapters 節に `cloudflare/` を 1 語足し、Reference runtime 末尾を README と同文に揃え、Development Commands の test 行に `test:node` / `test:workers` を併記する。

- **[W-003]** 新設した spec の列表が、表自身にも migration にも無い制約を「制約」列に書いている
  - 場所: `spec/database/index.md:108`（`note_routes.migration_id`）, `:282` 付近（`scope_task_due_index.lease_expires_at`）, `distributed_operations` の `terminal_at` / `expires_at`, `account_deletion_manifests` の `terminal_at` / `retain_until`
  - 理由: 同じ文書内で `note_routes.migration_id` の制約列は「`state = 'moving'` のとき NOT NULL」と書き、3 行下の本文は「`migration_id` / `last_migration_id` は**CHECK を持たず**、対で状態機械だけが動かす」と書く。`scope_task_due_index.lease_expires_at` の制約列は「`status = 'running'` の行だけ NOT NULL」だが、この表に `status` 列は存在しない（実装コメントは「`lease_expires_at IS NULL` mirrors `status = 'pending'`」＝由来表 `scheduled_tasks` の状態を指す、と正しく書いている）。`distributed_operations` / `account_deletion_manifests` の terminal 系も制約列は NOT NULL 相当を宣言するが migration に CHECK は無い。同じ PR が `note_routes` に相関 CHECK 5 本、`membership_directory` に 3 本、`users` / `identities` に 4 本ずつを実装しているため、読み手は「制約列に書いてあるものは DB が守る」と読む蓋然性が高く、どれが実効でどれが状態機械の約束かを判別できない。
  - 提案: 実効でない項目は制約列を「状態機械が守る（DB 制約は置かない）」の書き方に統一し、`scope_task_due_index.lease_expires_at` は `status` ではなく由来表を名指す（例: 「`scheduled_tasks.status = 'running'` の行だけ NOT NULL」）。

- **[W-004]** scope 平面の `outbox_events` にだけ processed 索引が無く、非対称の理由がどこにも無い
  - 場所: `packages/core/src/adapters/cloudflare/do/schema.ts:249` / `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql:404`
  - 理由: global 側は `outbox_events_pending_idx` と `outbox_events_processed_idx` の 2 本、scope 側は pending の 1 本だけ。一方 `OutboxRepository` は両平面で**同一の実装**（`cloudflareRuntime.ts:233` と `conformanceBackend.ts:130` がどちらも「the two `outbox_events` tables are identically shaped, and the repository is built over whichever session it is handed」と明記）で、`pruneProcessed` は `WHERE processed_at IS NOT NULL AND processed_at < ?` を撃つ。今日は scope 側の outbox が `save` にしか使われていないので実害は無いが、scope outbox の relay / prune を配線する次のスライスがそのまま全表走査を踏む。`spec/database/index.md` は `outbox_events` / `processed_events` の列も索引も定義していないので、canon 側でも意図か漏れかを判定できない。
  - 提案: scope 側にも同じ部分索引を足すか、足さないなら `do/schema.ts` に「scope の outbox は 1 scope 分しか持たないので processed 索引を置かない」旨を 1 行残す。合わせて `spec/database/index.md` に両平面共通の `outbox_events` / `processed_events` の節を足せば、次のスライスが判断を引き直さずに済む。

- **[W-005]** `conformanceCoverage.test.ts` は「同じ 30 スイートを呼んでいる」ことは固定するが「Cloudflare 側が CF ファクトリーを渡している」ことは固定しない
  - 場所: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts:80`
  - 理由: 検査は呼び出し**名**の集合比較と絶対数（30 / 31）で、実引数を見ていない。`makeMemoryConformanceBackend` と `makeCloudflareConformanceBackend` はどちらも `MakeConformanceBackend` なので、CF の `conformance/*.test.ts` が誤って memory ファクトリーを渡しても型は通り、memory バックエンドは workerd 上でも動くためテストも緑のまま通る。そのとき AC-3（実バインディングに当てる）は静かに崩れるのに、このテストの名前（"runs the same suites against the memory and Cloudflare backends"）は満たされたように読める。`harness.test.ts` はファクトリー自体の健全性を証明するが、スイートがそれを使っていることは証明しない。
  - 提案: 既に textual な検査なので安価に閉じられる — CF 側のファイル群について、`describe...Contract(` の呼び出し行と同じファイル内で `makeCloudflareConformanceBackend` 以外のファクトリー識別子が引数に現れないことを 1 つ足す（あるいは各 `describe...Contract(BACKEND, X)` の `X` を抽出して `makeCloudflareConformanceBackend` に一致させる）。

#### カバレッジ

- 確認: `.github/workflows/ci.yml`, `README.md`, `docs/test.md`, `package.json`, `packages/core/package.json`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`
- 確認: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/worker.ts`, `.../env.d.ts`, `.../conformanceBackend.ts`, `.../harness.test.ts`, `.../runtimeComposition.test.ts`, `.../projectionConcurrency.test.ts`, `.../deleteFilesByOwner.test.ts`（AC-5 の計測部と stand-in 方針）, `.../ports/deps.ts`, `.../ports/identity.ts`, `.../ports/directory.ts`, `.../ports/route.ts`, `.../ports/projection.ts`, `.../ports/scopeBusiness.ts`, `.../ports/scopeInfra.ts`, `.../conformance/directory.test.ts`, `.../conformance/identity.test.ts`, `.../conformance/projection.test.ts`, `.../conformance/route.test.ts`, `.../conformance/scopeBusiness.test.ts`, `.../conformance/scopeInfra.test.ts`, `.../conformance/unitOfWork.test.ts`
- 確認: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `.../d1/schema.ts`, `.../do/schema.ts`, `.../do/scopeObject.ts`（schema 適用と scope pin の箇所のみ）
- 確認: `packages/core/src/application/di/runtime.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`
- 確認: `packages/core/src/application/errors.ts`, `.../application/identity/requestPasswordReset.ts`, `.../application/identity/resendVerificationEmail.ts`, `.../application/ports/noteRouteFanOutReader.ts`, `.../application/ports/scopeTaskScheduler.ts`, `.../application/workers/scopeTaskRunner.ts`, `.../application/workers/__tests__/scopeTaskRunner.test.ts`, `.../application/storage/__tests__/deleteFilesByOwner.test.ts`, `.../domain/identity/ports/authTokenRepository.ts`, `.../domain/note/ports/{localNoteProjectionWriter,localNoteQueryService,publicNoteProjectionWriter,publicNoteQueryService}.ts`
- 確認: `spec/adr/021-scope-sharded-data-plane.md`, `spec/adr/063-public-cursor-not-authenticated.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/platform/index.md`, `spec/domains/{identity,index,note}.md`, `spec/inventory/{adapter,domain,frontend,test,usecase}.md`, `spec/testcases/identity/{deleteAccount,listPublicProfiles}.md`, `spec/testcases/note/{projectNoteChanges,searchPublicNotes}.md`, `spec/usecases/{identity,note}.md`
- 確認: `.thread/11/plan.md`, `.thread/11/review/triage-keys.md`, `.thread/11/adr.md`（ADR-007 / ADR-041 / ADR-069 のみ）
- スキップ: `packages/core/src/adapters/cloudflare/{cursor.ts,scopeRouter.ts,scopeTaskQueue.ts}`, `.../d1/repositories/**`, `.../do/{alarm,dueIndex,scheduledTasks,scopeName,scopeStub}.ts`, `.../do/repositories/**`, `.../execution/**`, `.../projection/**`, `.../r2/**`, `.../search/**`, `.../sql/**` — 各ポート実装の中身は identity / routing / scope / uow 観点の持ち分。合成・スキーマ・ハーネスの観点からは、DI からの参照関係とスイート結線の有無だけを確認した
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{alarm,durability,globalConcurrency,idempotency,lease,r2,routeGuard,searchEdges,sessionOverlay,support,unitOfWork}.test.ts` — バックエンド固有の振る舞い検証で他観点の持ち分。ハーネス観点からは「適合スイートが触るポートを stub していないか」だけを横断確認した（違反なし。stand-in は `deleteFilesByOwner.test.ts` の throwing proxy と `runtimeComposition.test.ts` の `MailSender` のみで、どちらも `docs/test.md` が明示的に許した形）
- スキップ: `pnpm-lock.yaml` — 生成物。`pnpm install --frozen-lockfile` 相当が両プロジェクトの実行で通ることをもって確認に代えた
- スキップ: `.thread/11/{foundation,steps,progress,testing}.md`, `.thread/11/review/{review-001*,review-002*,triage}.md` — 過程の記録で、既出判定（triage-keys.md）以外は本ラウンドの判断材料にしない
