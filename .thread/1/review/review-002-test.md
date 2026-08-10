# Review 002 — Test（網羅性・テスト設計・適合ハーネス・TC カバレッジ）

対象: PR #12（`issue/1/account-to-blank-note-skeleton` vs `main`）
契約: `.thread/1/plan.md` / `docs/test.md` / `spec/inventory/{test,adapter}.md` / `spec/testcases/`
台帳: `.thread/1/review/triage.md`（判定済み Key は再審議しない）

## ラウンド1 指摘の修正確認

前回この観点で出した 7 件（台帳 W-008..W-014）はいずれも修正が入っている。

| 台帳 Key | 内容 | 判定 |
| --- | --- | --- |
| W-008 | verifyEmail の TC ID 付与 | **済**。9 ケースが `TC-identity-294..304` を名乗り、`spec/inventory/test.md:433-443` の期待結果（23h59m/24h 境界・purpose 違い・stale epoch・並行消費の勝敗と consumed 1 回）と 1 行ずつ一致する。302/303/304 は 1 ケースに束ねているが assert が 3 行分ある（勝者 1 / 敗者 alreadyVerified・session 0 / consumed 1 件・user active） |
| W-009 | UoW 契約の適合スイート化 | **済**。`adapters/conformance/unitOfWork.ts` に `describeUnitOfWorkContract` を新設し、旧 memory ローカル 7 ケースを欠落なく移設。`ConformanceBackend` に `globalUnitOfWork` / `scopeUnitOfWork` / `relayKickCount()` を追加し JSDoc で「factory がカウント式 RelayTrigger を両 provider に配線する」と明文化。ただし移設に伴う新規問題 → **B なし / W-001** |
| W-010 | TC-229 の stale get 注入 | **済**。`signInWithPassword.test.ts:97` で `get` だけ `failureCount: 0` を返すスタブを注入し、実 store が施錠閾値にある状態で `LOCKED` + `failureCount: 11` + 後続も `LOCKED` を assert。TC-214 と識別可能になった |
| W-011 | TC-171 の同時接続上限 assert | **済**。`claimLanes` を spy して claim limit 列と claimed lane の high-water mark を計測し、`peakActiveLanes <= 6` / `max(claimLimits) <= 6` を assert。32 lane（16 shard × 2 generation）の形も維持 |
| W-012 | membership ケースの偽 pass | **済**。`accountDeletionManifestStore.ts:221-227` が `ctx.skip()` で明示 skip。早期 return の guard はこの 1 箇所のみで漏れなし |
| W-013 | resolveMany 上限ケース | **済**。`userBatchReader` に 100/101、`noteRouteStore` に 500/501 のケースを追加し、上限ちょうどは成功・超過は reject を契約化。ただし 2 つの契約が食い違う → **W-002**、同種の上限が残る → **W-003** |
| W-014 | fast-check / docs 残骸 | **済（一部）**。`packages/core/package.json` から fast-check を削除（lockfile 反映済み）、`docs/test.md` の Property-based 節を削除、`CLAUDE.md:34` を `pnpm test` / `pnpm test:unit`（`test` は `test:unit` の別名）へ更新。`README.md` が未更新 → **W-008** |

ラウンド1 修正で追加されたテスト 4 件も確認した。

- **signIn の version 再検査**（`signInWithPassword.test.ts:161`）: `verify` の中で identity の version を進める racing スタブを注入し、`INVALID_CREDENTIALS` + セッション 0 件を assert。`spec/usecases/identity.md:31`「password sign-inは照合に使ったPasswordIdentityのversionも再検査する。…各ユースケースの認証・削除中エラーへ戻す」の直接検証で、実装の写しではない。対応する TC 行は inventory に存在しないため TC ID なしで妥当。
- **prune の lane 解放**（`pruneExpiredAuthState.test.ts:507`）: 32 lane × 4 表 = 128 コマンドで 100 コマンド予算を破らせ、`continued: true` かつ全 run の `status === "claimed"` が 0 件であることを assert。「claimLanes は claimed を返さず、同一 owner の cron は lease を更新するため claimed のまま残ると恒久的に詰まる」という理由もコメントで根拠づけられている。
- **ダミー verify 回数**（`signInWithPassword.test.ts:135`）: 未登録メールでも verify が 1 回走ることを spy で assert。片側のみの検証 → **W-006**。
- **scrypt 改竄ハッシュ**（`cryptoAdapters.test.ts:36`）: N 上限超過・非 2 冪・r/p 上限超過・salt 長不一致の 4 方向を forge し、いずれも throw でなく `false`。改竄していないハッシュが引き続き検証できる対照も置いてあり、guard で全部落ちる退行を検出できる。

## 機械照合（系統的検証の結果）

- **TC カバレッジ**: テスト名から TC ID を全抽出（複合名 `TC-identity-164 / TC-identity-166` 形式も分解）して plan.md の実装対象と突き合わせた。`TC-identity-008..016 / 150..178 / 213..237 / 247..255,259,261..263`、`TC-note-054,058..065 / 165,168..173,176..178,187` は**全行がテスト名に存在**し、見送り確定行（TC-note-055..057,066 / 166,167,174,175 / 179..186 / 188,189、TC-identity-256..258,260）は**1 件も混入していない**。glue の verifyEmail 294..304 が加わったのみ。実装 ∪ 見送り = `TC-note-054..066` ∪ `TC-note-165..189` ∪ 対象 identity 全域で、チェックリストに穴なし。
- **ADP カバレッジ**: 適合スイートとメモリローカルテストから ADP ID を全抽出（`ADP-common-012..025` の range 宣言と `ADP-note-037/038/039` の複合を展開）。`ADP-common-001..039` / `ADP-identity-001..032,035..038` / `ADP-note-008..049` は**欠落ゼロ**、見送り確定分（ADP-identity-033/034、ADP-note-001..007,050..054）の混入も**ゼロ**。`OutboxRepository` スイートに ADP ID が無いのは inventory に対応行が無いためで正しい。
- **期待値の照合**: createBlankNote（TC-note-054,058..065）と getNote（165,168..173,176..178,187）を `spec/inventory/test.md:973-1108` と全行突き合わせ、文言どおり。`shareUrl` の `/s/:token` 形も `spec/pages/index.md:25` のルート表由来で、実装からの逆算ではない。
- **実行**: `pnpm test:unit` → 23 files / 395 tests 全緑、2.51s。再実行でも同一。
- **状態リーク・決定性**: `createTestHarness()` / `makeMemoryConformanceBackend()` はテストごとに新しい `MemoryBackend` + `TestClock` + `FakeIdGenerator` を作る。モジュールレベル可変状態は `getNote.test.ts` の `seedCounter`（ID 採番のみ）と、新規に増えた `signInWithPassword.ts` の `dummyHash`（→ W-006）。実時間参照は `getNote.test.ts` の 2 箇所のみ（→ W-005）。

## Blockers

なし

## Warnings

- **[W-001]** 共有 UoW スイートが「全コールバックの直列化」という移植不能な契約を固定している — 場所: `packages/core/src/adapters/conformance/unitOfWork.ts:136-162`（`concurrent unit of works serialize instead of interleaving`）/ 理由: 並行 2 本の `globalUnitOfWork.run` に対し `["first:start","first:end","second:start","second:end"]` という**厳密な順序配列**を assert している。これは memory アダプターがプロセス内 async mutex（`backend.transactions.run`）で全 UoW を直列化している実装特性であって、`spec/domains/index.md:118-120` の UoW 契約は「1 scope object の repository と local outbox だけを公開する」「入れ子にしない」しか要求していない。global 平面は D1 で、D1 には対話型トランザクションが無くバッチ flush になるため、Issue #11 のバックエンドはコールバックの実行を交錯させても仕様上正しいのにこのケースで落ちる。W-009 の修正でローカルテストから共有スイートへ移した結果、バックエンド差し替え契約に紛れ込んだ / 提案: 共有スイートには観測可能な原子性（両方の commit が確定し、途中状態が他方から観測されず、relay kick が各 1 回）を残し、実行順序そのものの assert は memory ローカルテストへ戻す。
- **[W-002]** `resolveMany` の上限超過契約が 2 ポートで食い違い、ポート JSDoc にも書かれていない — 場所: `packages/core/src/adapters/memory/repositories/userBatchReader.ts:22`（`SystemError(DatabaseError)`）/ `packages/core/src/adapters/memory/repositories/noteRouteStore.ts:82`（`ConflictError("NOTE_ROUTE_BATCH_TOO_LARGE")`）/ 対応ケース `conformance/userBatchReader.ts:37` と `conformance/noteRouteStore.ts:227` / 理由: 構造的に同一の違反（呼び出し側のバッチサイズ超過）に対して片方は 500 系、片方は 409 系にマップされる別種の例外を返す契約が、共有スイートで**両方とも凍結**された。`NOTE_ROUTE_BATCH_TOO_LARGE` は spec のどこにも存在しない新規コードであり、`ConflictError` は presentation で 409 になるので「並行状態の衝突」を意味してしまう。加えて `application/ports/noteRouteStore.ts:34-36` と `domain/identity/ports/userBatchReader.ts:12` の `Error contract:` 行のどちらも上限超過に触れていないため、D1 実装者がポート定義だけを読んでこの契約に到達する経路が無い。`progress.md:65` に spec-sync 候補として記録済みなのは良いが、記録は食い違いを解消しない / 提案: D1 バックエンドが実装に入る前にどちらか一方（呼び出し側のプログラミングエラーとして `SystemError` に寄せるのが自然）へ統一し、両ポートの `Error contract:` 行に 1 行足す。
- **[W-003]** 100 件ページ上限の切り詰め挙動が適合スイートで未検証（W-013 が閉じたのと同種の穴） — 場所: `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts` 全ケース（`appendMembershipPage` / `claimPending` / `compactItems` / `pruneTerminal` に渡す limit が最大 100 で、上限ちょうど・超過が無い）、実装側は `adapters/memory/repositories/accountDeletionManifestStore.ts:148,254,386,454` の `Math.min(Math.max(0, limit), PAGE_LIMIT)` / 理由: `spec/domains/index.md:127` は「membership pageは…最大100件固定」「各remote commandは…最大100件保存する」「100件ずつ縮約」と上限を仕様値として持つが、共有スイートは 1 件・100 件しか渡さないため、呼び出し側の limit をそのまま尊重する（= 上限を無視する）バックエンドが緑で通る。`GlobalMaintenanceRunStore.pruneCompleted` / `ScopeCleanupAdmissionStore.pruneCompleted` も同様 / 提案: W-013 で `resolveMany` に入れたのと同じ形で、上限超過の limit を渡して返却件数が上限で頭打ちになることを 1 ケースずつ足す。
- **[W-004]** `apps/web` に自動テストが 1 件も無く、AC-15 の純関数契約が手動テストにしか支えられていない — 場所: `apps/web/app/presentation/errorResponse.ts:105-133`（`HTTP_STATUS_BY_CODE` と `httpStatusFor`）/ `apps/web/app/presentation/errorResponse.ts:88`（`redactForClient`）/ `apps/web/app/presentation/auth.ts:23`（`safeRedirectPath`）/ 理由: `docs/test.md:54` が Frontend を最小限とする根拠は「server function の wire 型境界と UI ロジックはフレームワークのプリミティブが広く覆う」だが、この 3 つはフレームワークが一切関与しない純関数で、しかも spec 由来の**閉じたリスト**（`UNAUTHENTICATED`→401 / `THROTTLED|LOCKED|RATE_LIMITED`→429 / `NOTE_GONE`→410、`spec/presentation/index.md#コードによる例外`）とセキュリティガード（オープンリダイレクト）を実装している。現状の検証は `.thread/1/testing.md` の項目9・エッジ3 の目視のみで、`HTTP_STATUS_BY_CODE` から 1 行落としても `system`/`unknown` の redaction を外しても、全自動検証が緑のまま通る / 提案: `apps/web/app/presentation/__tests__/errorResponse.test.ts` 相当を 1 ファイル足し、kind×code のマッピング表・redaction・`safeRedirectPath`（`//evil`、`\\`、スキーム付き、相対パス、`undefined`）を固定する。docs/test.md の Frontend 節にも「presentation の純関数は例外」と一行書く。
- **[W-005]** TestClock 規律を破る実時刻参照が 2 箇所ある — 場所: `packages/core/src/application/note/__tests__/getNote.test.ts:162,174`（TC-note-172/173 の `const now = new Date()`）/ 理由: `docs/test.md:10,27` は「Time is controlled through the shared `TestClock`」を規律として明文化しており、スイート全体でこの 2 行だけが壁時計を読む。ハーネスの clock は 2026-01-01 固定なので、`trashedAt` / `purgeAfter` が clock 上は 7 か月「未来」の値として seed されている。今は getNote 側が purge 窓を見ないため無害だが、`NoteAccessPolicy` に purge 期限の判定が入った瞬間に、実行日に依存して壊れる（あるいは静かに別経路を通る）テストになる / 提案: `h.clock.now()` に置き換える。
- **[W-006]** タイミング均等化の検証が片側のみで、かつ被検体にプロセス寿命のキャッシュが入った — 場所: `packages/core/src/application/identity/__tests__/signInWithPassword.test.ts:135-159` / `packages/core/src/application/identity/signInWithPassword.ts:52-57`（`let dummyHash: Promise<PasswordHash> | null`）/ 理由: (a) 均等化は「未登録経路と登録済み経路の verify 回数が**等しい**」という比較命題なのに、テストは未登録側が 1 回であることしか assert していない。登録済み失敗経路が 2 回 verify するようになる退行は緑のまま通り、均等化は破れる。(b) `dummyHash` はモジュールレベルの `let` で、`createTestHarness()` が毎テスト新しいコンテナを作ってもプロセス内で共有され続ける。現状は全テストが同一の memory scrypt hasher を使うため実害は無いが、`passwordHasher` を差し替えるフォールト注入テストが 1 本入ると、先に走ったテストの hasher で作られたハッシュが後続へ持ち越される（テスト順序依存の芽）/ 提案: 同じ spy で登録済み失敗経路も計測し `expect(unregistered).toBe(registered)` の形にする。キャッシュはコンテナ（`RequestContainer` 生成時）へ寄せるか、少なくとも per-hasher の `WeakMap` にする。
- **[W-007]** `adapters/memory/store.ts` に生の NUL バイトが残っており、メモリバックエンドの中核 406 行が diff で読めない — 場所: `packages/core/src/adapters/memory/store.ts:251`（JSDoc 中の `` `${userId}\0${edgeKey}` ``）/ 理由: 台帳 W-025 で `identityUniqueDirectory.ts` の生 NUL は `\u0000` エスケープへ直したが、同じ欠陥が隣のファイルに残っている。`file` はこのファイルを `data` と判定し、`git diff` は `Binary files ... differ` として中身を出さない — つまり適合スイート・usecase テストすべてが依存するストア実装が、この PR のレビューで一度も差分として提示されていない。加えてこの JSDoc が説明する `${userId}\0${edgeKey}` というキー形式は実装と一致していない: 適合ハーネス側は `adapters/memory/__tests__/conformanceBackend.ts:107` で半角スペース区切り、読み出し側は `repositories/accountDeletionManifestStore.ts:152-155` でキーでなく `edge.userId` フィールドで絞り込む / 提案: `\u0000` エスケープへ置換し（W-025 と同じ処置）、ついでに JSDoc のキー形式の記述を実装に合わせる。
- **[W-008]** integration ランナー削除の残骸がリポジトリ入口とテスト設定に残っている — 場所: `README.md:113-117`（`pnpm test # unit + integration` / `pnpm test:integration` / `build:cf` / `build:aws` / `build:gcp` / `start:cf`）と `vitest.config.ts:19`（`exclude: [... "**/*.integration.test.ts"]`）/ 理由: (a) W-014 の修正は `CLAUDE.md` と `docs/test.md` に限られ、README は未更新。この PR が `package.json` から当該スクリプトを全削除しているので、README のコマンド表は**存在しないコマンド**を案内している。(b) integration 用 config を両方削除したのに、唯一残った `vitest.config.ts` は `*.integration.test.ts` を除外し続けている。この suffix は docs/test.md の Naming 節（`**/__tests__/<target>.test.ts`）にもう記載が無いため、将来この名前でファイルが置かれると `pnpm test` からも CI からも**無言で漏れる** / 提案: README のコマンド表を現状（`pnpm test` = `pnpm test:unit`、build/start は node のみ）へ更新する。exclude は削るか、Issue #11 で再導入する前提であることを docs/test.md の Naming 節に一行残す。

## 良かった点（記録）

- ラウンド1 で指摘した 7 件がいずれも「指摘の字面」ではなく**根本**に対応している。特に W-010 は TC-229 の仕様文（「判定が緩む方向に外れても手順4 で必ず数えられる」）そのものを注入で再現しており、W-011 は claim limit と in-flight lane 数の両方を測っている。
- W-009 の適合スイート化で `relayKickCount()` を `ConformanceBackend` の正式メンバーとして JSDoc 付きで公開し、「commit 後にのみ kick」をバックエンド差し替え可能な形で契約化した点は、当初の指摘（UoW 検証を D1 側がゼロから書き直す）を正しく解いている。
- 見送り行の混入ゼロ・実装対象の欠落ゼロが 2 ラウンド連続で機械照合で確認できる状態（TC ID / ADP ID がテスト名と range 宣言に一貫して載っている）は、この規模のスライスとしては例外的に良い。
- フォールト注入が一貫して「本物の副作用を残してから失敗させる」形（activate 済みで応答喪失、commit 失敗、sweep 失敗、mail 失敗、session delete 失敗、identity version の横入り）で、モックの自己満足になっていない。
- 境界値が等号込みで揃っている（`expiresAt <= now` の 0ms/±1ms、254/255 字、200/201 字、800,000/800,001 バイト、23h59m/24h、29日/30日、100/101、500/501）。

## カバレッジ（変更ファイル一覧 387 行との対応）

### 確認（41 ファイル）

- 契約・規約: `.thread/1/plan.md`、`.thread/1/testing.md`、`.thread/1/progress.md`（見送り一覧・spec-sync 集約）、`.thread/1/review/triage.md`、`.thread/1/review/review-001-test.md`、`docs/test.md`、`CLAUDE.md`（test コマンド部）
- 適合スイート: `packages/core/src/adapters/conformance/` 全 26 ファイル（`unitOfWork` / `userBatchReader` / `noteRouteStore` / `accountDeletionManifestStore` / `backend` はラウンド2 差分を全読、他 21 はケース名全確認 + `loginAttemptStore` / `idempotencyStore` / `oauthStateStore` / `outboxRepository` / `scopeRouter` / `noteRouteFanOutReader` / `noteRevisionRepository` / `asserts` / `fixtures` / `testClock` を全読）
- memory ローカル: `adapters/memory/__tests__/` 全 4 ファイル（`conformance.test` / `conformanceBackend` / `cryptoAdapters.test` / `miscAdapters.test`）。ラウンド1 の `unitOfWork.test.ts` は共有スイートへ移設・削除されたことを確認
- usecase テスト: `application/identity/__tests__/` 全 6（`signInWithPassword` / `pruneExpiredAuthState` / `verifyEmail` を全読、`authenticateSession` / `signUpWithPassword` / `authFlowHelpers` はケース名 + ラウンド2 差分）、`application/note/__tests__/` 全 3（`createBlankNote` / `getNote` を全読、`listNotes` はケース名 — spec に対応 TC 行なし・AC-18 の glue で妥当）、`application/workers/__tests__/` 全 2、`application/__tests__/helpers.ts` と `fakes/fakeIdGenerator.ts`（状態リーク・決定性）
- domain テスト: `domain/identity/__tests__/` 全 5、`domain/note/__tests__/` 全 3（ケース名全確認 + 境界ケース抜粋）
- 被検体のうちラウンド2 で変更された実装: `signInWithPassword.ts`、`pruneExpiredAuthState.ts`、`noteAccessPolicy.ts`、`passwordHasher.ts`、`identityUniqueDirectory.ts`、`memory/store.ts`、`memory/repositories/{userBatchReader,noteRouteStore,accountDeletionManifestStore}.ts`、`memory/globalUnitOfWork.ts`、`di/memoryRuntime.ts`
- テスト実行基盤: `vitest.config.ts`、`.github/workflows/ci.yml`、`package.json`、`packages/core/package.json`、`pnpm-lock.yaml`（fast-check 削除の反映）、`README.md`
- spec 側: `spec/inventory/test.md`（対象 TC 全行）、`spec/inventory/adapter.md`（ADP-common/identity/note の対象範囲）、`spec/domains/index.md`（UoW / ScopeKey / 各 store の契約）、`spec/domains/{identity,note}.md`（resolveMany 上限）、`spec/usecases/identity.md`（signInWithPassword フロー・認証資格発行の直列化）、`spec/pages/index.md`（ルート表）、`spec/testcases/note/getNote.md`

### スキップ

- **削除ファイル群（`D` 行 118 件すべて）** — 旧 todo テスト（`domain/todo/__tests__/` 4、`application/todo/__tests__/` 2）、旧 d1/libsql `__tests__/` 12、worker integration テスト 2、`di/serverCloudflare.test.ts`、`vitest.config.integration*.ts` 2、および非テスト資産（`adapters/{d1,libsql,aws,cloudflare,gcp}/` 実装、`apps/web/{server,worker,scripts,vite.config,wrangler,drizzle}` の他ランタイム分、`infra/{aws,cloudflare,gcp}/`、`docs/runtime_{cloudflare,aws,gcp}.md`）: 削除は plan AC-14 / ADR-004 の契約どおりで、置き換え先（memory 適合スイート + usecase テスト）を上記で検証済み。個別 diff は不要と判断。
- **`apps/web/app/components/**`・`routes/**`・`styles/**`・`routeTree.gen.ts`・`server.node.ts`・`worker/node/runner.ts`** — フロントエンド実装。テスト資産なし。`presentation/` のうちテスト対象にすべき純関数は W-004 で指摘済みで、それ以外（`serverFragment.tsx` / `errorResponseMiddleware.ts` / `session.ts` / `clientKey.ts` / `serverErrorLog.ts` / `validator.ts` / `pagination.ts` / `appServerErrorAdapter.ts`）はフレームワーク結合が強く単体化の費用対効果が低いため、`.thread/1/testing.md` の手動項目に委ねる判断を妥当と見なした。
- **`packages/core/src/domain/**`（`__tests__` 以外）・`application/**`（usecase・ports・di・errors・execution）・`adapters/memory/**`（上記の変更分を除く実装 30 ファイル）** — テストの被検体。契約適合はテスト経由で検証済み（実装レビューは domain / usecase-adapter 観点の担当）。
- **`.thread/1/{adr,steps}.md`・`.thread/1/review/review-001-*.md`（test 以外）** — 他観点の成果物。
- **`docs/backend_implementation_example.md`・`docs/frontend_implementation_example.md`・`docs/runtime_node.md`・`biome.json`・`apps/web/.env.example`・`apps/web/package.json`・`apps/web/vite.config.node.ts`・`pnpm-workspace.yaml`** — テスト設計に非関与（`progress.md` の spec-sync 集約に改訂候補として既に記録あり）。
