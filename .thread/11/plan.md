# 実装計画 — Issue #11: Cloudflare D1・Durable Objects・R2 アダプターを追加する

**Issue:** #11
**作成日:** 2026-08-26
**規模:** 通常
**実装方針:** steps.md

---

## 目的

in-memory 実装と同じポート契約を満たす Cloudflare D1・Durable Objects・R2 アダプターと物理スキーマを追加する。

## 受け入れ基準

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | 実装チェックリスト全行の実装（Issue #11 本文参照。スタブ・仮実装不可） | Issue 本文「実装チェックリスト」「完了条件」 | 1–12 |
| AC-2 | D1・Durable Objects・R2 の全アダプターが in-memory と同一の共有ポート適合スイート（`packages/core/src/adapters/conformance/` の 30 スイート）を全件パスする | Issue 本文「完了条件」「検証」。対象シナリオがない永続バックエンド追加のため、シナリオレベル基準の代わりに置く | 11 |
| AC-3 | 適合スイートは実バインディング（workerd / miniflare 上の D1・DO・R2）に対して走る。in-memory への読み替えやモックで代替していない | Issue 本文「検証」1 行目、`docs/test.md` の fake 方針 | 1, 11 |
| AC-4 | transaction・再試行・冪等性・lease 回収を、D1 / DO / R2 を使う統合テストで確認する（適合スイートが観測できない driver 固有の性質 — SQL 制約違反、bound parameter 上限、D1 batch の原子性、DO alarm の再入、R2 の同一 key 並行 write）を含む | Issue 本文「検証」2 行目、`docs/test.md:26` | 12 |
| AC-5 | `deleteFilesByOwner` の「列挙 1 ＋ 多行 DELETE 1 ＋ 多行 outbox INSERT 1 の 3 文」を D1 / DO 実装で実測し、満たせるなら満たす。満たせないなら `spec/platform/index.md` の `## 実行予算と分割単位` → `### Scope DO` の当該行を実測値へ改める（`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例しない」は動かさない） | Issue コメント1（tuanemuy, 2026-08-16）、[ADR 056](../../spec/adr/056-performance-budget-placement.md) | 8, 12 |
| AC-6 | `ScopeTaskScheduler` の settle（`complete` / `backoff` / `schedule`）に fencing token が要るかを決着させる。「`leaseMs` を十分に取る運用で足りる」か「claim token を契約へ足す」かを選び、根拠と結論を adr.md に、契約を変えるならポート JSDoc・適合スイート・`spec/domains/` にも反映する。1 scope に複数 writer を実配備する前に決着していること | Issue コメント2（tuanemuy, 2026-08-23） | 9, 12 |
| AC-7 | 既存の Node 参照ランタイムが緑のまま。`pnpm typecheck` / `pnpm lint` / `pnpm test`（既存 76 ファイル・978 件）が通り、`pnpm dev:node` が起動する。memory バックエンドと Node entry の振る舞いを変更していない | [ADR 025](../../spec/adr/025-single-reference-runtime.md)、CLAUDE.md「Reference runtime」 | 1, 13 |
| AC-8 | 契約と実装が食い違った場合の解決が [ADR 046](../../spec/adr/046-port-contract-divergence.md) に従っている。適合スイートにケースを足したなら memory バックエンドも同じケースを通り、`spec/inventory/adapter.md` の ADP 行と食い違わない | [ADR 026](../../spec/adr/026-port-contract-and-conformance.md) / 046 / 052 / 058 | 11, 13 |
| AC-9 | 新規に決めた物理スキーマ（列名・索引・`_occ_guard` の形）と、spec の持ち分を変えた決定が `spec/database/index.md` / `spec/platform/index.md` に反映されている。反映しない差分は adr.md に理由とともに残っている | CLAUDE.md「Design canon」 | 13 |

## スコープ

### 含まれないもの

- **Cloudflare への本番配備一式** — `apps/web/app/server.cloudflare.ts`、`apps/web/vite.config.cloudflare.ts`、本番 `wrangler.jsonc`、Workers Assets での静的配信、`deploy` script。Issue のチェックリストは「アダプターと物理スキーマ」までで、完了条件も適合スイートの全件成功に置かれている。配備は Node 側の同種課題（#15）と対になる別スライス。
- **Queue consumer / Cron ハンドラの実装** — `spec/platform/index.md` の Queue 構成（`jobs` / `global-events` / `events-public-projection`）と Global Cron 表。ワーカー本体（`processOutboxEvents` / `runDueScopeTasks` / `pruneOutbox`）はランタイム非依存で既存のものを使うため、Cloudflare 側で要るのは「ハンドラの外枠」だけであり、配備一式と一緒に動く。`RelayTrigger` / `EventDispatcher` の Cloudflare 実装もここに含めない。
- **未実装ドメインのアダプター** — `spec/database/index.md` は Workspace / Tag / Job / Integration の表を定めているが、コードにポートが無い（`packages/core/src/domain/{workspace,job}/` は値オブジェクトのみ、`ports/` を持たない）。実装対象は**今日ポートが存在する 30 の適合スイートの範囲**に限る。#3〜#10 のスライスがポートを足したとき、その Cloudflare 実装は各スライスの担当になる。
- **物理 shard（`note coordination shard` / `user coordination shard` / 32 shard の wave 読み）** — `spec/platform/index.md` の D1 節が定める最終形。`WorkerContainer.routingGenerations` は既に単一世代のまま複数世代を受けられる形になっているので、単一 D1（単一 generation）で契約を満たし、shard 化は容量閾値に触れた時点の別作業とする。
- **`adapters/memory/` に同居している暗号 / Intl アダプターの分離** — `passwordHasher`(scrypt) / `secureTokenGenerator` / `shareTokenProtector` / `timeZoneResolver` / `mailSender`。[ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md) が「2 つ目のバックエンドが実在する時点で再検討する」と書いた対象だが、`node:crypto` の scrypt(N=16384) は `nodejs_compat` 下の workerd で実測 38ms で動くため本 Issue の完了に必要ない。再検討の起票だけ行う。
- **`localNoteQueryService` / `publicNoteQueryService` の relevance 順の契約強化** — memory はスコアリング索引を持たず `updatedDesc` へフォールバックしている。D1 / DO 側は FTS5 の `bm25` を持つため観測順が変わりうるが、契約を強めるのは適合スイート側の変更であり、**両バックエンドが同じスイートを通ることだけ**を本 Issue の基準とする。

## リスクと注意点

- **規模が最大のリスク。** 実装対象は 35 のポート実装（内訳は steps.md 冒頭）。参照バックエンドだけで 5,602 行、適合スイートが 6,885 行あり、SQL 版はこれを上回る。ステップは並列委譲できる束に割ってあるが、束をまたぐ土台（ステップ 2 の UoW 実行機構）が全束の前提になるので、ここを先に単独で通し切ること。
- **D1 には interactive transaction が無く、DO の `transactionSync` は await を跨げない。** `GlobalUnitOfWorkProvider.run(fn)` / `ScopeUnitOfWorkProvider.run(scope, fn)` は任意の await を含むコールバックを取り、適合スイート `unitOfWork.ts` が「失敗時の全ロールバック」「並行 run が半端な状態を観測しない」を要求する。素朴な「即時 write + 失敗時に補償」では通らない。解決の枠組みは adr.md ADR-001 / ADR-002。
- **`ScopeTaskQueue.listDue` は全 scope 横断の読み取りを要求するが、DO は列挙できない。** ポート JSDoc は「空配列を返すバックエンドは実装したことにならない」と明示し、適合スイート `scopeTaskScheduler.ts` は claim 直後の不可視化とリース失効後の再出現まで観測する。一方 `spec/platform/index.md` の Global Cron 節は「Cron は scope object を全列挙しない」。両立させる手は global D1 側の due index 表しかなく、これは `spec/database/index.md` の物理配置表に無い新表になる（ADR-003）。
- **適合スイートは「毎テスト fresh backend」を要求する（`conformance/backend.ts` の JSDoc）が、`@cloudflare/vitest-plugin` の分離ストレージは*ファイル単位*である（実測: 同一ファイル内の別テストは R2 の書き込みを共有し、ファイルをまたぐと消える）。** factory 呼び出しごとの名前空間分離を factory 側で作らないと、30 スイートを 1 ファイルに並べた瞬間に相互汚染で落ちる（ADR-004）。
- **FTS5 + bigram（[ADR 011](../../spec/adr/011-bigram-search.md)）は memory に一切存在しない。** memory は `title/text` の素朴な部分一致で適合スイートを通している。`bm25` と bigram トークナイズを入れると、memory が通しているケースを FTS 版が落とす可能性がある（1 文字キーワード、トークン境界をまたぐ部分一致、`relevance` 順）。落ちた場合の解決は [ADR 046](../../spec/adr/046-port-contract-divergence.md) に従い「振る舞いの正本がどちらにあるか」で倒す — スイートを直したら memory 側も同じスイートを通ること。
- **D1 の bound parameter 上限 100 と `resolveMany` の 500 件がぶつかる。** `noteRouteStore.resolveMany`（最大 500）/ `userBatchReader.resolveMany`（最大 100）は `?` を並べたら即上限超過。`spec/database/index.md` の「共通の規約」が定める JSON 1 value + `json_each` 展開に必ず落とすこと。多行 INSERT / DELETE も同じ形。
- **`_occ_guard` は `spec/database/index.md:29,33` の物理配置表に名前だけあり、列定義の節が無い。** D1 batch は条件付き UPDATE が 0 行でも batch 全体を失敗させないので、OCC 違反を batch 内で中断させる仕掛けがここに要る。形を決めたら spec に節を足す（AC-9）。
- **workers pool では `TZ` を設定できない**（実測: `process.env.TZ` は `undefined`、`getTimezoneOffset()` は 0）。既存 node プロジェクトの `TZ=Asia/Tokyo` ピン（`docs/test.md` の Determinism）は node 側に残し、TZ を弁別材料にするテスト（`domain/usage/__tests__/`）を workers プロジェクトへ移さないこと。
- **`wrangler`（〜4.125）がリポジトリ初の重量級 devDependency になる。** インストール時間と CI 時間が伸びる。`@cloudflare/vitest-pool-workers` ではなく後継の `@cloudflare/vitest-plugin`（1.0.0、peer `vitest ^4.1.0`）を使う — 本リポジトリの vitest 4.1.10 と実測で互換。
- **既存の `pnpm test` を割らないこと**（AC-7）。root `vitest.config.ts` を `projects` へ書き換えるのは既存 978 件を一度に赤にしうる変更なので、CF アダプターのコードを書く前に「node プロジェクトだけの `projects` 構成で 978 件が緑」を確認してから進む。
- **Issue コメント2 の fencing 未決着を引きずったまま複数 writer を配備しないこと。** 実害は「継続の鎖が止まる」に留まらず、personal cleanup の継続が止まると `accountDeletionBarrier` が開いたまま User が `deleting` で残り、参照ランタイムに自動復旧経路が無い。

## テスト方針

- **共有ポート適合スイート（AC-2 / AC-3）** — `packages/core/src/adapters/cloudflare/__tests__/conformance.test.ts` を `adapters/memory/__tests__/conformance.test.ts` と同型で置き、同じ 30 の `describeXxxContract(name, makeBackend)` を `makeCloudflareConformanceBackend` で呼ぶ。スイート本体は 1 行も変更しない（変更が要ると判明したら AC-8 の手続きへ）。実行は `@cloudflare/vitest-plugin` の workers プロジェクトで、実バインディング（D1 / DO / R2）に対して行う。
- **バックエンド固有テスト** — memory 側の `unitOfWork.test.ts` に相当する Cloudflare 固有の観測（write-set の適用順、D1 batch の原子性、`transactionSync` の巻き戻し、DO alarm の再入と再スケジュール、`ScopeTaskQueue` due index の commit 後可視性）は `adapters/cloudflare/__tests__/` のバックエンド固有ファイルに置く。適合スイートには入れない（バックエンド非依存の契約ではないため）。
- **統合テスト（AC-4）** — transaction / 再試行 / 冪等性 / lease 回収。具体的には (a) D1 batch 中断時に一部だけ残らないこと、(b) 応答喪失を模した同一 operation の再実行が冪等であること（`applied_operations` / `processed_events` / outbox `id` 衝突の no-op — [ADR 042](../../spec/adr/042-outbox-save-id-collision.md)）、(c) `scheduled_tasks` の lease 失効後に別 writer が再 claim でき `due_at` / `attempts` / `priority` / `payload` が claim 前のまま保たれること、(d) R2 の同一 key 並行 write と `deleteMany` の不在許容。
- **性能上の約束の実測（AC-5）** — `deleteFilesByOwner` の 1 バッチが発行する SQL 文数を計数して記録する。「件数に比例しない」はバックエンド共通の契約なので適合スイート側で担保済み。ここで測るのは `spec/platform/index.md` の設計目標との一致だけ。
- **既存 Node 側（AC-7）** — 変更しない。`vitest run --project node` が既存 76 ファイル・978 件緑であること、および `pnpm test` が両プロジェクトを回して緑であることを、CF アダプター着手前と完了時の 2 回確認する。
- **カバレッジの基準** — `docs/test.md` の「Adapters: per conformance-suite case」に従う。契約の穴を見つけたらバックエンド固有テストではなく共有スイートにケースを足す（AC-8）。
