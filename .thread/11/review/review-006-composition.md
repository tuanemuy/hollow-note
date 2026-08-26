# レビュー Round 006 — 合成・スキーマ・テストハーネス・spec/docs

### 合成・スキーマ・テストハーネス・spec/docs

#### Blockers

なし。

以下を実行して確認した（すべて緑）。

- `git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web` → **空**（AC-7）
- `grep -rn "\.thread" packages apps spec docs README.md CLAUDE.md` → **0 件**
- `pnpm typecheck`（root `tsgo` + `@repo/core` の 2 program + `apps/web`）→ エラー 0
- `pnpm lint` / `pnpm format:check` → エラー 0（`biome.json` の schema 版ずれ info 2 件は本 PR 由来ではない）
- `pnpm test:node` → 77 files / 983 passed, 3 skipped（skip は memory が `seedMembershipEdges` を持たない ADP-common-013 系 3 件）
- `pnpm test:workers` → 22 files / 363 passed, **skip 0**

#### Warnings

- **[W-001]** 適合ハーネスが `ConformanceBackend` の**任意メンバー**を落としても、`conformanceCoverage.test.ts` は緑のまま通る
  - 場所: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts:84-108`、`packages/core/src/adapters/conformance/backend.ts:133`、`packages/core/src/adapters/conformance/accountDeletionManifestStore.ts:410-415`
  - 理由: 本テストが固定しているのは (a) 呼ばれるスイート名の集合が両バックエンドで一致すること、(b) 各入口が自分の factory を渡していること、(c) 全 31 スイートがどこかから呼ばれていることの 3 つで、**ケース数は固定していない**。`seedMembershipEdges` は `ConformanceBackend` で任意（`?`）であり、スイートは `if (seed === undefined) { ctx.skip(); }` の実行時分岐で 3 ケースを飛ばす。したがって CF ハーネスからこのメンバーが落ちた場合、workers 側は 3 ケースを静かに skip したまま緑になり、AC-2 の「全件パス」が本テストでは崩れない。今日は CF が実装しているので実害は無い（workers 実行の skip は 0 件を確認済み）が、守っているのは慣習だけで、`testing.md` 確認項目 1 の「skip 0」も手動確認に留まっている
  - 提案: `__tests__/harness.test.ts` に 2 行足して塞ぐのが最小。`const backend = await makeCloudflareConformanceBackend(); expect(backend.seedMembershipEdges).toBeDefined();`（意図は「memory がまだ実装できない任意能力を、実バインディング側は必ず持つ」）。ケース数そのものを絶対値で固定する案は `.thread/11/adr.md` ADR-043 が「本数は絶対値、ケースは固定しない」と決着済みなので採らない。収束ラウンドの判断として次スライス送りでも構わない

- **[W-002]** `.thread/11/testing.md` 確認項目 1 の期待結果が、存在しないファイルを名指ししている
  - 場所: `.thread/11/testing.md:37`（`plan.md:55` / `steps.md:141` も同文）
  - 理由: `packages/core/src/adapters/cloudflare/__tests__/conformance.test.ts` は 7 ファイル（`__tests__/conformance/{identity,directory,route,scopeBusiness,scopeInfra,projection,unitOfWork}.test.ts`）へ分割されており、単一ファイルは存在しない。手順そのもの（`vitest run --project workers`）は動くので検証は成立するが、期待結果を字義どおり照合しようとすると空振りする。**分割の判断と、それによって失われた「目視で 30 スイートを並べられる」性質の代替手段は `.thread/11/adr.md` ADR-031 に記録済み**なので、記録の欠落ではなく参照の追随漏れ
  - 提案: `testing.md:37` の当該パスを `__tests__/conformance/*.test.ts`（7 ファイル）へ改め、「集合の一致は `adapters/__tests__/conformanceCoverage.test.ts` が固定する」を 1 行添える。`plan.md` / `steps.md` は計画時点の記録なので動かさなくてよい

#### 観点ごとの確認結果

**AC-7（既存 Node 参照ランタイムが緑・memory / apps/web 不変）** — 満たしている。`origin/main...HEAD` の memory / apps/web 差分は空。vitest の 2 プロジェクト境界は `vitest.shared.ts` の 2 定数（`CLOUDFLARE_ADAPTER_DIR` と `testFilesIn`）に集約され、node の `exclude` に `packages/core/src/adapters/cloudflare/**`、workers の `include` に `src/adapters/cloudflare/{vitest 既定の include パターン}` が入る。**disjoint**（一方がディレクトリ全体を除外し、他方がそのディレクトリだけを含む）かつ**和集合が全体**（workers 側の include を `configDefaults.include` から導いているため、拡張子の取りこぼしで両プロジェクトから漏れる経路が無い）。`TZ=Asia/Tokyo` は node プロジェクトに残っており、`domain/usage/__tests__/` は移動していない。

**spec の改訂が実装と 1 対 1 か** — 依頼された 4 点を含め、突き合わせた範囲では一致している。

- (a) `spec/adr/056` — 変更は**コンテキスト段落 1 本のみ**（`@@ -8,7 +8,7 @@`）。決定 1〜3・代替案・影響は無改訂で、「契約側に文数を書かない」「バックエンド依存の数値は予算文書へ」「どのバックエンドが届かないかは ADR のコンテキストに残す」はそのまま。追記は「今日ある 2 つのバックエンドはいずれも届かない」という事実と `4n + 3` の実測値で、これは決定 3 が「コンテキストに残す」と指定した置き場そのものである。**決定は変わっていない。** 対になる `spec/platform/index.md` の改訂も決定 2（上限表に足さず直後の段落へ、上限ではなく設計目標と明記）に従っており、`spec/testcases/storage/deleteFilesByOwner.md` は無改訂（AC-5 の指示どおり）。実測は `__tests__/deleteFilesByOwner.test.ts` が `reads = 2n + 2` / `commitStatements = 2n + 1` / `commits = 1` を n=10 / 40 の 2 点で固定しており、n を変えても `commits` が動かないことまで観測している
- (b) `spec/database/index.md` の「有界な掃引 / 削除」新設項 — 実装と一致。`d1/repositories/identitySupport.ts:70-119` の `deleteExpiredPage` は `WHERE expires_at <= ?` を**絞り込み**、`ORDER BY {keyColumn}` を**順序**、cursor を表キー値として使う。`deleteBoundedByKey`（同 126-164）も同型。spec が索引欄をすべて「絞り込みに使う（順序は上記の節）」へ書き換えたのは、`sessions_expires_idx (expires_at, id)` などが順序を与えないという実装の事実に合わせたもので、逆向きの捏造ではない。`nextCursor` は `keys.length > size` のときだけ返り、選択述語を `DELETE` 側へ持ち越す形（Round 005 の ADR-089 決定）も維持されている
- (c) `scope_task_due_index` — spec（`spec/database/index.md`「両 plane 共通の infrastructure table」）の 8 項目すべてが実装に対応する。物理配置表の infrastructure 行に追加済み。列・PK・索引は `d1/migrations/0001_global_schema.sql:424-436` と完全一致。「1 回の publish は優先度ごとに 25 行・全体で最大 100 行」は `do/scheduledTasks.ts:77` の `DUE_INDEX_ROWS_PER_PRIORITY = 25` × 4 優先度で厳密に一致し、`dueIndexRowsStatement` の `ROW_NUMBER() OVER (PARTITION BY priority)` が `rn <= 25` で切る。「`lease_expires_at IS NULL` が `pending` を写す」「`failed` 行は載せない」は `WHERE status <> 'failed'` と `scopeTaskQueue.ts:22` の `CANDIDATE_PREDICATE` の両側で成り立つ。「スライスの全置換」「object 内で直列化」「publish 失敗は object 自身が 10 秒後の alarm で治す」「drift の 2 方向は非対称」も `do/dueIndex.ts:7-65` の JSDoc と実装に 1 対 1
- (d) `do/schema.ts` の scope 検証の範囲 — spec「共通の規約」の書き換え（scope 鍵は `notes.owner_type / owner_id` と `_scope_identity` に限り、`stored_files` / `storage_quotas` / `llm_usages.user_id` は会計上の帰属なので対象外）は、`do/schema.ts:43-53` のコメントおよび `_scope_identity` の DDL（`id integer PRIMARY KEY CHECK (id = 0)`）と一致する。物理分離を `_scope_identity` の pin が担保していることは `harness.test.ts:100-122`（別 scope として叩いた object が `bound to …` で拒否される）が実バインディングで観測している。`spec/database` の scope DO infrastructure 行にも `_scope_identity` が追加済み

**ADR-063 昇格の網羅性** — `spec/` 全体を `署名cursor` / `署名 cursor` / `署名opaque` / `署名generation` で走査したところ、残っているのは (1) workspace directory 側（`spec/database/index.md:992`、`spec/domains/workspace.md:245,247`、`spec/platform/index.md:90`、`spec/usecases/workspace.md:605`、`spec/inventory/{test,usecase}.md`）と (2) `ExportTicket` / 削除チケットの署名済みトークン、および (3) `UserBatchReader` の署名済み routing generation だけ。3 つとも ADR-063 が「範囲外」「別物」と明示した対象で、`spec/adr/021:41` にも「公開workspace一覧は署名cursorのままで、ポートを実装する時点で同じ問いを引き直す」と接続が書かれている。ポート JSDoc 側（`publicNoteQueryService.ts` / `noteRouteFanOutReader.ts` / `application/errors.ts`）も「改竄」を落として「読めない値」へ揃っており、`INVALID_PAGINATION` の 3 意味が 4 か所で一致する。

**`.thread/11/adr.md` の採番** — `## ADR-NNN` 見出しは **001〜093 の連番で、欠落・重複ゼロ**（スクリプトで検証）。ADR-026 は本文の代わりに「欠番。採番だけ消費し、本文は書かれていない。番号を詰めると既存の相互参照がずれるので空けたまま残す。本ファイルから ADR-026 を参照している箇所は無い」と明記され、後者の主張も grep で成立する。`spec/adr/052`（ID は行位置ではなく識別子）の考え方と同型で、扱いとして妥当。

**`conformanceCoverage.test.ts` が AC-2 / AC-3 の保証として十分か** — おおむね十分。3 つの検査はいずれも**閉じる方向に壊れる**。ループや関数で包んだ呼び出しは行頭正規表現に当たらず名前が集合から欠けて赤、CF 側の入口ディレクトリを動かせばパスフィルタが空集合になって赤、スイートを増やして配線し忘れれば `ALL_SUITES` の絶対値で赤。Round 003 で足された factory 同定検査（`makeCloudflareConformanceBackend` 以外を渡していない）が「名前は一致するが中身が memory」を塞いでいる。残る穴は W-001 の 1 点のみ。AC-3 側（実バインディング）は、ハーネス配下（`conformanceBackend.ts` + `ports/*.ts`）に `throw new Error` / `Proxy` / `stub` / `mock` / `TODO` が **1 件も無い**ことと、`harness.test.ts` が 3 バインディングの実在・両平面の DDL 適用・FTS5・`json_each`・`nodejs_compat` の `node:async_hooks` を実物で観測していることで担保されている。

**適合ハーネスの名前空間分離が D1 / DO / R2 の 3 面で効いているか** — 効いている。DO は `scopeObjectName(scope, namespace)` が名前に接頭辞を混ぜるので factory 呼び出しごとに別 object（消し忘れが構造的に起きない）、D1 は `GLOBAL_WIPE_STATEMENTS` で factory の先頭に全表 wipe、R2 は `objectKeyPrefix` で分離。`GLOBAL_TABLES_TO_WIPE` を `Object.values(GLOBAL_TABLES)` から**導出**しているうえ、`harness.test.ts:62-71` が `sqlite_master` と両方向で突き合わせる（migration が足した表が wipe から漏れない／wipe が実在しない表を消そうとしない）ので、schema と定数のドリフトが赤で出る。`harness.test.ts:138-169` が 3 面すべてを 2 backend で実測している。既知の例外（`scope_task_due_index` は素の `ScopeKey` を持つため namespace 越しに 1 スライスを共有する）は `do/dueIndex.ts:58-64` に明記されており、ハンドラレジストリが空のハーネスでは object が alarm を張らないので実害が出ない。

**migration が `0001` 1 本であること／本番 D1 での適用順・冪等性** — `d1/migrations/` は `0001_global_schema.sql` の 1 本のみ。`CREATE TABLE`（`IF NOT EXISTS` なし）は migration runner の管理下では正しい形で、`wrangler d1 migrations apply` / `applyD1Migrations` はどちらも `d1_migrations` 表で適用済みを飛ばす。ハーネス側は `migrateOnce()`（isolate ごとの promise memo）と、`harness.test.ts` / `runtimeComposition.test.ts` の `beforeAll` からの直接呼び出しが同居するが、runner 側の冪等性で二重適用が no-op になり実測で緑。scope 側の DDL は全文 `IF NOT EXISTS` で `ScopeObject` の activation ごとに走る形（`do/schema.ts:34-41`）で、「object の外から DDL を撃てない」という制約に対する妥当な分岐。FK 非宣言の理由（適合スイートが未登録 User に対する Identity を挿す＝ADR 046 で契約側が正本）が migration 冒頭に書かれており、`spec/database/index.md` の「共通の規約」側にも `FK → …` が論理的宣言であって DDL を要求しない旨が追記されて 1 対 1 になっている。

**CI の 2 ジョブ構成** — 妥当。`lint-typecheck-unit`（10 分）が lint / format / typecheck / `test:node`、`unit-tests-workers`（20 分）が `test:workers`、`build`（15 分）が Node build。分離理由がコメントで述べられており（workerd の isolate/ファイルのコストを node ジョブの予算に混ぜると、退行がテスト失敗ではなくタイムアウトとして出る）、`pnpm test:unit`（= 両プロジェクト）を CI から外して 2 本に割ったので、どちらが落ちたかがジョブ名で分かる。`pnpm-workspace.yaml` の `allowBuilds: workerd: true` が両ジョブの `pnpm install --frozen-lockfile` に効く。`pnpm-lock.yaml` は **+601 / -0** の純増で、既存依存の版が動いていない。

**本番ソース・spec・docs から `.thread/11/adr.md` への参照** — 全廃されている（0 件）。置き換え記述を `cloudflare/` 全体・`application/di/`・`spec/`・`docs/` に対して「Round」「レビュー」「指摘」「以前は」「previously」「Issue #11」で走査したが、経緯や弁明の混入は無い。`cleanup/participants.ts` の `"#11 / the slice adding a scope outbox read side"` → `"the slice adding a scope outbox read side"`、`personalCleanup.ts` の「#11 まで未テスト」→「到達には**ポート契約と適合スイートを同時に動かす変更**が要る」（ADR 046 への言い換え）、`docs/runtime_node.md` の `Cloudflare (Issue #11)` → `Cloudflare` はいずれも「待っている Issue」を「到達に必要な契約変更」へ置き換える方向で、`.thread/11/adr.md` ADR-079 の意図どおり。

**ドキュメント（README / docs/test.md / docs/runtime_node.md）** — 実装と一致。`docs/test.md` の 2 プロジェクト表・境界の説明・`--project` の必要性・fake 方針の workers 版（「適合スイートが触るポートは 1 つも stub しない」／backend-local テストが範囲外ポートに置く stand-in は触ると投げる）・Determinism の TZ 注記・timeout 30s は、すべて実際の設定と挙動に対応する。README の Development commands / Directory layout / Reference runtime も追随済み。`CLAUDE.md` の追随は triage-keys.md の wont-fix 判定どおり本レビューでは扱わない。

**担当範囲のセキュリティとパフォーマンス** — 新たな指摘なし。`wrangler.test.jsonc` はテスト専用で `database_id` が固定文字列（miniflare のローカル D1、実アカウントの ID ではない）。`CloudflareRuntimeOptions` は `oauth` / `mailSender` / `shareTokenKeyRing` / `deletionTicketKeyRing` を**既定値なしの必須**にしており、「誰も決めなかった」が dev IdP やプロセスごとのランダム鍵へ落ちない（isolate 跨ぎで share link / 削除チケットが壊れる問題を含め、理由が JSDoc に書かれている）。`scope_task_due_index` の行が namespace 接頭辞を含まない（本番データに漏らさない）判断も妥当。性能面では due index の publish が優先度ごと 25 行・全体 100 行で有界、`listDue` の候補集合が `4 × limit` で有界、R2 `deleteMany` が 1,000 key ごとにバッチ（`spec/platform` の新規上限行と一致）。

**確認した挙動が実効的なテストで守られているか** — 守られている。`runtimeComposition.test.ts` は型レベル（`assertNoUnlistedPort<Exclude<keyof Container, 列挙>>` — コンテナに足したポートを列挙し忘れると**型エラー**になる）と実行時（両コンテナの全ポートが定義済み、UoW の commit が read view から見える、両トリガが配線先へ届く、commit RPC の中で due index が更新済み）を両方押さえており、「型が通るだけの配線」を許さない形になっている。`DEFAULT_MAINTENANCE_TABLES.authStatePrune` と `authStateSweeps` のキー集合の一致もここで固定されている（#16 の正本統合までの暫定として triage 済み）。

#### カバレッジ

**確認**

- `.github/workflows/ci.yml`
- `README.md`, `docs/test.md`, `docs/runtime_node.md`
- `package.json`, `packages/core/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`（差分統計と純増であることのみ）
- `vitest.shared.ts`, `vitest.config.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`
- `packages/core/src/application/di/runtime.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`
- `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`
- `packages/core/src/adapters/cloudflare/do/dueIndex.ts`, `packages/core/src/adapters/cloudflare/do/scopeName.ts`, `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts`（due index / 次 alarm の 2 文）, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`
- `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`（`deleteMany` の 1,000 key バッチのみ）, `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts`（有界掃引 / 有界削除のみ）
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `.../worker.ts`, `.../env.d.ts`, `.../harness.test.ts`, `.../runtimeComposition.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/ports/{deps,directory,identity,projection,route,scopeBusiness,scopeInfra}.ts`（`deps.ts` は全文、他 6 本は stub / mock / 未実装マーカーの走査）
- `packages/core/src/adapters/cloudflare/__tests__/conformance/{directory,identity,projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`（AC-5 の計数部分）
- `packages/core/src/application/cleanup/{participants,personalCleanup}.ts`, `packages/core/src/application/errors.ts`, `packages/core/src/application/identity/{requestPasswordReset,resendVerificationEmail}.ts`, `packages/core/src/application/ports/{noteRouteFanOutReader,scopeTaskScheduler}.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`（いずれも spec 改訂との 1 対 1 の観点で差分全文）
- `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `packages/core/src/domain/note/ports/{localNoteProjectionWriter,publicNoteProjectionWriter,publicNoteQueryService}.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
- `spec/adr/021-scope-sharded-data-plane.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/063-public-cursor-not-authenticated.md`, `spec/adr/index.md`
- `spec/database/index.md`, `spec/platform/index.md`
- `spec/domains/{identity,index,note,workspace}.md`
- `spec/inventory/{adapter,domain,frontend,test,usecase}.md`
- `spec/testcases/identity/{deleteAccount,listPublicProfiles}.md`, `spec/testcases/note/{projectNoteChanges,searchPublicNotes}.md`
- `spec/usecases/{identity,note}.md`
- `.thread/11/{plan,adr,progress,testing}.md`, `.thread/11/review/triage-keys.md`

**スキップ**

- `packages/core/src/adapters/cloudflare/d1/repositories/*.ts`（20 本、`identitySupport.ts` を除く）— global 平面のリポジトリ実装。物理スキーマとの整合は migration 側から確認済みで、SQL の中身は identity / routing / uow 観点の担当
- `packages/core/src/adapters/cloudflare/do/repositories/*.ts`（10 本）— scope 平面のリポジトリ実装。同上、scope 観点の担当
- `packages/core/src/adapters/cloudflare/do/{alarm,scopeObject,scopeStub,scheduledTasks}.ts`（`scheduledTasks.ts` は due index / 次 alarm の 2 文だけ確認）— alarm turn と RPC 境界の挙動は scope / uow 観点の担当
- `packages/core/src/adapters/cloudflare/execution/*.ts`（4 本）— write-set と二平面 UoW の実装。uow 観点の担当
- `packages/core/src/adapters/cloudflare/sql/*.ts`（7 本）— セッション / executor / guard / 行変換。uow 観点の担当（`occGuard.ts` の DDL は `do/schema.ts` 経由で確認）
- `packages/core/src/adapters/cloudflare/projection/*.ts`（4 本）, `packages/core/src/adapters/cloudflare/search/*.ts`（2 本）, `packages/core/src/adapters/cloudflare/cursor.ts`, `packages/core/src/adapters/cloudflare/scopeRouter.ts` — 投影 / 検索 / cursor の実装。routing 観点の担当（cursor の「認証しない」契約は spec とポート JSDoc 側から確認済み）
- `packages/core/src/adapters/cloudflare/__tests__/{alarm,durability,globalConcurrency,idempotency,lease,projectionConcurrency,r2,routeGuard,searchEdges,sessionOverlay,support,unitOfWork}.test.ts`（12 本）— バックエンド固有テスト。全件緑であることと、workerd の `uncaught exception` ログ 2 種が意図した拒否ケース（`durability.test.ts:45` の CHECK 違反、`harness.test.ts` の scope 不一致）由来であることだけ確認し、中身は各観点の担当
- `.thread/11/{foundation,steps}.md`, `.thread/11/review/review-00{1,2,3,4,5}*.md`（30 本）, `.thread/11/review/triage.md` — 過去ラウンドの記録。ゼロベースでレビューする指示に従い、`triage-keys.md`（既出判定）と `plan.md`（契約）と `adr.md`（採番検証と決着の所在）だけを読んだ
