# Review 001 — Test（網羅性・テスト設計・適合ハーネス・TC カバレッジ）

対象: PR #12（`issue/1/account-to-blank-note-skeleton` vs `main`）
契約: `.thread/1/plan.md` / `docs/test.md` / `spec/inventory/test.md` / `spec/inventory/adapter.md`

## TC カバレッジの機械照合（系統的検証の結果）

テストファイル内の `TC-*` ID を全抽出し、plan.md の実装対象リストと突き合わせた。

- **実装対象 TC（usecase）**: TC-identity-008..016 / 150..178 / 213..237 / 247..255,259,261..263、TC-note-054,058..065 / 165,168..173,176..178,187 — **全行がテスト名に存在し、対象外の余分な TC ID もゼロ**。plan の実装対象と 1:1 一致。
- **期待値の照合**: `spec/inventory/test.md` の該当 92 行の期待結果とテスト本体を突き合わせた。signIn（境界: 3回目 THROTTLED+待機秒 / 10回目 LOCKED+解除時刻 / 15分経過で成功 / 解錠直後の再ロック / 鍵の正規化・名前空間分離 / UoW 外書き込み / recordFailure 失敗時続行）、signUp（decoy 応答同一・並行 1 勝・reservation release・activate 応答喪失収束）、authenticateSession（29日/30日/1ms前の三点境界・削除失敗でも拒否維持）、prune（`expiresAt <= now` の等値/1ms 境界・100件 yield・cursor 冪等再実行・lease 回復・固定 asOf・tie-break keyset 101件）、createBlankNote（無題/manual/201字/WORKSPACE_NOT_FOUND/recovery 3経路）、getNote（NOT_FOUND 収斂・shareUrl reveal・匿名 public）— いずれも仕様の文言どおりで、実装の写しではなく仕様側の値（TTL 定数・境界の等号・エラーコード）を検証している。
- **ADP 行（適合テスト）**: `adapters/conformance/` の 21 スイート + memory ローカルの crypto/misc/UoW テストを読み、ヘッダの range 宣言（例 `ADP-common-012..025`）と個別ケースを突き合わせた。対象の ADP-common-001..002,004..039 / ADP-identity-001..032,035..038 / ADP-note-008..049 は全メソッドがケースで実行されている。見送り確定分（ADP-identity-033/034、ADP-note-001..007,050..054）は不在で正しい。ADP-common-003（UoW）のみ共有スイート外（→ W-002）。
- **フォールト注入の妥当性**: 「apply してから応答を失う」二重呼び出しスタブ（activate 系）、UoW commit 失敗、sweep 失敗、mail 失敗、session delete 失敗 — いずれも本物の副作用を残した上で失敗させており、モックの自己満足になっていない。並行性は `Promise.all`/`allSettled` + 原子操作の勝者 1 検証で決定的。
- **状態リーク・決定性**: `createTestHarness()` / `makeMemoryConformanceBackend()` はテストごとに新しい `MemoryBackend` + `TestClock` + `FakeIdGenerator` を作る。モジュールレベルの可変状態は `seedCounter`（ID 採番のみ、挙動へ影響なし）だけ。実時間・実乱数への依存は crypto アダプターの乱数のみで、これは値でなく形式・往復を assert している。決定性に問題なし。

## Blockers

なし

## Warnings

- **[W-001]** verifyEmail のテストが spec TC ID を名乗っていない — 場所: `packages/core/src/application/identity/__tests__/verifyEmail.test.ts` / 理由: 9 ケースは内容的に TC-identity-294..304（23h59m/24h 境界、purpose 違い、stale epoch、並行消費の勝敗）と一致するが、docs/test.md が定める「TC ID をテスト名に含めて機械的に追跡可能にする」規約から外れ、本レビューのような機械照合で glue 扱いのまま漏れる。plan は verifyEmail を AC-17 の glue とし TC リスト（実装∪見送り）に 294..304 を載せていないため契約違反ではないが、テストが現に存在する以上 ID を付与するのが一貫する / 提案: テスト名に TC-identity-294..304 を付け、plan または Issue コメントの対象リストに追記する。
- **[W-002]** UoW 契約（ADP-common-003）が適合スイートの差し替え契約に入っていない — 場所: `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts` / `packages/core/src/adapters/conformance/backend.ts` / 理由: commit/rollback（イベントバッファ含む）、ネスト禁止（同平面・平面横断）、scope 束縛、直列化はバックエンド差し替えでこそ壊れる契約だが、`ConformanceBackend` は UoW provider を公開しておらず memory ローカルテストのみ。Issue #11 の D1/DO バックエンドは共有スイートを import しても UoW 検証をゼロから書き直すことになる / 提案: `describeUnitOfWorkContract(name, makeBackend)` へ抽出し、backend factory に両 UoW provider を追加する。
- **[W-003]** TC-identity-229 のテストが「stale な get」を注入していない — 場所: `packages/core/src/application/identity/__tests__/signInWithPassword.test.ts:86`（TC-214 と同一ケースに相乗り） / 理由: 仕様行の本質は「手順 2 の get が古い値を返して判定が緩んでも、手順 4 の recordFailure で施錠が追いつく」こと。現状は通常経路の失敗計上を再確認しているだけで、TC-214 と識別できる検証がない / 提案: `get` だけ古い値（例: failureCount 0）を返すスタブを注入し、ロック相当の store 状態下でも失敗が加算されることを assert する。
- **[W-004]** TC-identity-171 の「同時 6 接続」上限が未検証 — 場所: `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts:434` / 理由: generation 混在なし・lane 数 16 は assert しているが、active lane ≤ 6（および最大 32 shard）の並行度上限はどこにも assert がなく、上限を外す実装変更が緑のまま通る / 提案: claimLanes 呼び出しの limit もしくは同時 in-flight lane 数を計測する spy を入れて上限を assert する。
- **[W-005]** seed 不能バックエンドで membership ページのケースが「成功」として通る — 場所: `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts:221`（`seedMembershipEdges === undefined` で早期 `return`） / 理由: ADP-common-013/017/020 の実内容ケースが、seed 未提供のバックエンドでは skip でなく pass として報告され、D1/DO 側で契約未検証が緑に見える / 提案: vitest の `ctx.skip()`（または `it.skipIf`）で明示的に skip 報告にする。
- **[W-006]** 入力上限の適合ケース欠落 — 場所: `packages/core/src/adapters/conformance/userBatchReader.ts` / `packages/core/src/adapters/conformance/noteRouteStore.ts` / 理由: `UserBatchReader.resolveMany` の「最大 100」（ADP-identity-005）と `NoteRouteStore.resolveMany` の「最大 500」（ADP-note-036）はインベントリに明記された契約だが、上限到達・超過時の挙動を検証するケースがない / 提案: 上限ちょうど＋超過（切り詰め or エラーのどちらが契約か明文化して）を共有スイートに追加する。
- **[W-007]** テスト系ドキュメント・依存の残骸 — 場所: `CLAUDE.md`（Development Commands の `pnpm test:integration`）/ `packages/core/package.json:19`（fast-check）/ `docs/test.md`（Property-based 節） / 理由: PR は `vitest.config.integration*.ts` と root の integration スクリプトを削除したが CLAUDE.md は未更新でコマンドが存在しない。また todo の `.property.test.ts` を全削除した結果 property テストは 0 件になったのに fast-check 依存と docs の節は残っており、新規 26 VO（Email 254 字・NoteHtml の UTF-8 バイト数など random input が効く対象）には適用されていない / 提案: CLAUDE.md のコマンド表を更新し、fast-check は「使う」（VO 数件に property を足す）か「外す」（docs の節も削る）かを揃える。

## 良かった点（記録）

- 適合スイートは `describeXxxContract(name, makeBackend)` の差し替え契約が徹底しており、factory ごとの fresh backend・TestClock 前提が backend.ts の JSDoc に明文化されている。
- 境界値の扱いが一貫して等号込み（`expiresAt <= now` の 0ms/±1ms、254/255 字、800,000/800,001 バイト、23h59m/24h、29日/30日）。
- TC-identity-236（UoW 外書き込み）を「UoW run 回数 0 なのに記録が残る」で検証する設計、TC-note-063〜065 のサガ recovery 3 経路、TC-identity-173 の「固定 asOf が途中失効セッションを守る」検証は、実装の写しでない仕様検証の好例。

## カバレッジ（変更ファイル一覧との対応）

### 確認（テスト規約・契約・テスト本体、38 ファイル）

- `.thread/1/plan.md`（契約）、`docs/test.md`
- `packages/core/src/adapters/conformance/` 全 25 ファイル（backend / asserts / fixtures / testClock 含む。fixtures・asserts は他スイート経由で内容確認）
- `packages/core/src/adapters/memory/__tests__/` 全 5 ファイル（conformance.test / conformanceBackend / cryptoAdapters / miscAdapters / unitOfWork）
- `packages/core/src/application/identity/__tests__/`: authenticateSession / signInWithPassword / signUpWithPassword / pruneExpiredAuthState 各 test（全読）、verifyEmail.test（テスト名＋spec 照合）、authFlowHelpers（helpers 経由で参照確認）
- `packages/core/src/application/note/__tests__/`: createBlankNote / getNote 各 test（全読）、listNotes.test（テスト名確認 — spec/testcases に listNotes 行は存在せず AC-18 の glue、TC 不要で妥当）
- `packages/core/src/application/workers/__tests__/`: eventDecoderRegistry.test / outboxPrune.test（テスト名＋構成確認）
- `packages/core/src/domain/identity/__tests__/` 全 5 ファイル、`packages/core/src/domain/note/__tests__/` 全 3 ファイル（テスト名全確認＋Handle 予約語・VO 境界・policy 本体を抜粋確認）
- `packages/core/src/application/__tests__/helpers.ts`（状態リーク・決定性）
- `vitest.config.ts`、`.github/workflows/ci.yml`（test 実行部）、`package.json` / `packages/core/package.json`（scripts・fast-check）
- spec 側: `spec/inventory/test.md`（対象 92 行）、`spec/inventory/adapter.md`（全 347 行中 ADP-common/identity/note の対象範囲）、`spec/testcases/identity/signInWithPassword.md`

### スキップ（テスト観点の対象外、理由つき）

- 削除ファイル群（`D` 行すべて）: 旧 todo テスト（`domain/todo/__tests__/`・`application/todo/__tests__/`）、旧 d1/libsql `__tests__/`、worker integration テスト、`vitest.config.integration*.ts`、di/serverCloudflare.test — 削除自体は plan AC-14/ADR-004 の契約どおりで、置き換え先（memory 適合＋usecase テスト）を上記で検証済み。個別 diff は不要と判断。
- `apps/web/app/components/**`・`apps/web/app/routes/**`・`apps/web/app/presentation/**`・`apps/web/app/server.node.ts`・`apps/web/app/worker/node/runner.ts`・styles・routeTree.gen — フロントエンド実装。docs/test.md が「Frontend: bare minimum（framework primitives に委ねる）」と定めており、テスト追加義務なし。テスト観点の検証対象外。
- `packages/core/src/domain/**`（`__tests__` 以外の実装 60 ファイル）・`application/**`（usecase・ports・di 実装）・`adapters/memory/`（`__tests__` 以外の実装 32 ファイル） — テストの被検体。契約適合はテスト経由で検証（実装レビューは別観点）。
- `infra/aws/**`・`infra/cloudflare/**`・`infra/gcp/**`・wrangler/drizzle/Dockerfile/vite.config.{aws,cloudflare,gcp}・scripts — ランタイム削除の一部、テスト資産なし。
- `.thread/1/{adr,progress,steps,testing}.md`・`docs/backend_implementation_example.md`・`docs/frontend_implementation_example.md`・`docs/runtime_node.md`・`biome.json`・`.env.example`・`pnpm-lock.yaml`・`pnpm-workspace.yaml`・`apps/web/package.json`・`apps/web/vite.config.node.ts` — テスト設計に非関与（CLAUDE.md の integration コマンド残骸のみ W-007 で指摘）。
