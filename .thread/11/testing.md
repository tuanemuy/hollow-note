# 動作確認計画 — Issue #11: Cloudflare D1・Durable Objects・R2 アダプターを追加する

**Issue:** #11
**作成日:** 2026-08-26

---

## 確認環境

このIssueの変更を確認するために必要な手順のみ記載（プロジェクト全体のセットアップは省略）。

### 検証環境の起動

このIssueの本体（Cloudflare アダプター）はテストランナー上の実バインディング（workerd / miniflare）で確認する。ブラウザで触る画面は追加されないため、開発サーバーは既存 Node ランタイムの回帰確認にだけ使う。

- 依存の追加が入るため、まず `pnpm install`
- Cloudflare アダプターの確認: `pnpm exec vitest run --project workers --reporter=verbose`
  （`workers` は本 Issue が root `vitest.config.ts` に足した vitest project。素の別名は `pnpm test:workers`）
- 既存 Node ランタイムの確認: `pnpm exec vitest run --project node --reporter=verbose`（別名 `pnpm test:node`）
- 両方まとめて: `pnpm test`（= `vitest run`。2 プロジェクトの和）
- 静的検査: `pnpm typecheck` / `pnpm lint` / `pnpm format:check`
- 既存アプリのブラウザ回帰: `cp apps/web/.env.example apps/web/.env` の上で `APP_URL=http://localhost:3000` と `OAUTH_DEV_MODE=true` を設定し、`pnpm dev`

### デプロイ方法

なし（検証環境のみで確認できる）。Cloudflare への本番配備一式は plan.md のスコープ外で、本 Issue では `wrangler deploy` を行わない。

## 確認項目

### 1. Cloudflare アダプターが共有ポート適合スイートを全件パスする

- **対応する受け入れ基準:** AC-1 / AC-2 / AC-3
- **検証手段:** api
- **目的:** D1・Durable Objects・R2 の全アダプターが、in-memory と同一の適合スイートを実バインディングに対して全件通ることを確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose`
- **期待結果:** **22 ファイル / 368 passed / 0 skipped / 0 failed**（exit 0）。`packages/core/src/adapters/cloudflare/__tests__/conformance/*.test.ts`（`{directory,identity,projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts` の 7 ファイル）が実行され、memory 側 `packages/core/src/adapters/memory/__tests__/conformance.test.ts` が呼んでいる `describeXxxContract` と同じスイート群がすべて緑になる。集合の一致そのものは `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`（node プロジェクト側）が固定する
- **確認ポイント:** 呼ばれているスイート名の集合が memory 側と一致すること（片方だけ呼ばれていないスイートがないこと）。`todo` / `skip` / `it.skipIf` で回避されたケースが 0 件であること。バインディングが実物であること — 出力に vitest の `|workers|` プロジェクト名が付き、`harness.test.ts` の各ケース（`env.{GLOBAL_DB,OBJECT_STORAGE,SCOPE_OBJECT}` の実在、`applyD1Migrations` 後の `sqlite_master`、DO 初回接触でのスキーマ生成、`nodejs_compat`）が緑であること。in-memory 実装へ読み替えられていないことは確認項目 2 の識別子検査が固定する

### 2. 適合スイート呼び出し集合の一致（スタブ・部分実装の検出）

- **対応する受け入れ基準:** AC-1 / AC-2
- **検証手段:** api
- **目的:** 「全件パス」がスイートの間引きで達成されていないことを確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --project node --reporter=verbose` の出力から、Cloudflare 側と memory 側それぞれの適合スイート由来の describe 名とケース数を数える
  2. 実装側に `throw new Error("not implemented")` / `TODO` / `FIXME` / 空実装が残っていないことを `packages/core/src/adapters/cloudflare/` に対して確認する
- **期待結果:** Cloudflare 側と memory 側で呼ばれている適合スイートの**集合**が一致する。これは `conformanceCoverage.test.ts` が固定しており（`PERSISTENCE_SUITES = 30`、両側の呼び出し集合の一致、CF 入口が名乗る factory が `makeCloudflareConformanceBackend` の 1 種だけであること）、手順 1 の数え上げはその裏取りとして使う。ケース数の絶対値は意図的に固定していないので、数がスイート追加で動くこと自体は失敗ではない。未実装マーカーが 0 件
- **確認ポイント:** ポート単位で欠落がないか（plan.md の 35 ポート）。適合スイート本体（`packages/core/src/adapters/conformance/`）は本 Issue では 1 行も変更していない見込みなので、まず `git diff origin/main...HEAD -- packages/core/src/adapters/conformance/` が空であることを確認する。空でないなら、その差分は memory 側も通していること

### 3. transaction / 再試行 / 冪等性 / lease 回収の統合確認

- **対応する受け入れ基準:** AC-4
- **検証手段:** api
- **目的:** 適合スイートが観測できない driver 固有の性質（D1 batch の原子性、`transactionSync` の巻き戻し、同一 operation の再実行の冪等性、リース失効後の再 claim）を実バインディングで確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose` の出力から、`packages/core/src/adapters/cloudflare/__tests__/` 配下のバックエンド固有テスト（`durability` / `idempotency` / `lease` / `r2` / `alarm` / `unitOfWork` / `globalConcurrency` / `projectionConcurrency` / `routeGuard` / `sessionOverlay` / `searchEdges` / `support`）の結果を読む
- **期待結果:** 次の 4 点がそれぞれケースとして存在し、緑であること — (a) D1 batch を途中で失敗させたとき一部だけ残らない（`durability.test.ts` の `keeps no part of a D1 batch whose middle statement is refused` / `keeps no part of a global unit of work whose commit is refused` / `rolls a scope write-set back inside transactionSync and publishes no index`）、(b) 応答喪失を模した同一 operation の再実行が冪等（`idempotency.test.ts` の `applied_operations` / `processed_events` / `folds a re-saved outbox id onto the stored row instead of replacing it`）、(c) `scheduled_tasks` のリース失効後に別 writer が再 claim でき、行が claim 前のまま保たれる（`lease.test.ts` の `lets a second writer reclaim a lapsed lease without moving the row`）、(d) R2 の同一 key 並行 write と不在 key の delete 許容（`r2.test.ts` の `leaves one whole object behind when two writes race for a key` / `treats a delete of absent keys as done` / `spends the 1,000-key delete limit in chunks`）
- **確認ポイント:** (a) が「例外を投げた」だけで終わらず、失敗後にストアを読み直して残骸が無いことまで観測しているか

### 4. `deleteFilesByOwner` の SQL 文数の実測

- **対応する受け入れ基準:** AC-5
- **検証手段:** api
- **目的:** `spec/platform/index.md`「実行予算と分割単位」の設計目標（**書き込みはバッチ件数によらず 1 回の原子適用**）に対する実測値を確定させる
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose` の出力から、`packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts` の 4 ケース（`AC-5:` で始まる）の結果を読む
  2. 実測値が当初の目標（3 文）と違っていた場合、`spec/platform/index.md` の該当行が実測値に改められているかを確認する
- **期待結果:** 4 ケースが緑で、実測は 1 turn **`4n + 3` 文**（`n` 件に対し読み `2n + 2` ＋ 単一 commit 内 `2n + 1`）。`spec/platform/index.md:153-155` が同じ数（`4n + 3`、commit は件数によらず 1 回）を、上限ではなく設計目標として書いている。`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例した**往復**を要求しない」（＝ポート呼び出しの往復の話で、SQL 文数の話ではない）は変更されていない
- **確認ポイント:** **commit の回数が件数によらず 1 であること**（`counts.commits` が 10 件でも 40 件でも 1）と、列挙が定数 2 文・outbox flush が多行 INSERT 1 文であること。**SQL 文の総数と読み側の往復は件数に比例してよい** — 比例定数 `4n + 3` が spec の記述と一致していればよく、「文数が件数に比例しないこと」を期待してはいけない（旧目標の名残）

### 5. `ScopeTaskScheduler` の fencing 決着が記録されている

- **対応する受け入れ基準:** AC-6
- **検証手段:** api
- **目的:** settle（`complete` / `backoff` / `schedule`）に fencing token が要るかの結論と根拠が残っていることを確認する
- **手順:**
  1. `.thread/11/adr.md` に該当の判断エントリがあることを確認する（**決着は「`leaseMs` の帯 ＋ 単一 writer という運用で足りる」で、契約には claim token を足していない**）
  2. 前提の明文化を 3 か所で確認する — ポート JSDoc `packages/core/src/application/ports/scopeTaskScheduler.ts`（lease が advisory で fencing token を持たないこと、`leaseMs` の下限・上限）、`spec/platform/index.md`「Scope Alarm」（帯、単一 writer が driver ごとに何に支えられているか、レジストリが driver を決めること）、注入点 `packages/core/src/adapters/cloudflare/do/scopeObject.ts` の `ScopeObjectEnv.SCOPE_TASK_LEASE_MS` と `leaseMsOf`
  3. 契約を変えていないので、適合スイート（`packages/core/src/adapters/conformance/scopeTaskScheduler.ts`）と `spec/domains/` には差分が無いことを確認する（`git diff origin/main...HEAD -- packages/core/src/adapters/conformance/` が空）
  4. `pnpm exec vitest run --project node --project workers --reporter=verbose` が両バックエンドで緑であることを確認する
- **期待結果:** 結論・根拠が adr.md にあり、上の 3 か所が同じ帯・同じ前提を述べていて、契約（適合スイート）は無変更のまま両バックエンドが同じスイートを通っている
- **確認ポイント:** 「運用で足りる」の前提（`leaseMs` の帯、writer 多重度）が明文化されているだけでなく、**object 駆動配備がその帯から値を選べること自体がテストで観測されている**か — `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts` の 3 ケース（配備が設定した値を honour する / 未設定なら `SCOPE_TASK_LEASE_MS` 定数 / 正の整数でない値は turn を落として 1 行も claim しない）

### 6. 既存 Node 参照ランタイムの回帰（自動テスト・静的検査）

- **対応する受け入れ基準:** AC-7
- **検証手段:** api
- **目的:** Cloudflare アダプターの追加が既存の Node + in-memory ランタイムを壊していないことを確認する
- **手順:**
  1. `pnpm exec vitest run --project node --reporter=verbose`
  2. `pnpm test`
  3. `pnpm typecheck`
  4. `pnpm lint`
  5. `pnpm format:check`
- **期待結果:** 1 は **77 ファイル・984 passed / 3 skipped**、失敗 0（変更前は 76 ファイル・978 件。増分は適合スイート由来ではなく (a) 新設の `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` が node プロジェクトへ +1 ファイル・+4 ケース、(b) `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts` へ +2 ケース。3 skipped は資格情報の無い `adapters/oauth` の実 API ケースで、変更前から skip されている）。2 は node / workers 両プロジェクトの和で **99 ファイル・1352 passed / 3 skipped**、失敗 0（77+22 ファイル / 984+368 件で和が一致する＝二重実行も取りこぼしも無い）。3・4・5 はエラー 0
- **確認ポイント:** `packages/core/src/adapters/memory/` と `apps/web/` に**差分がゼロ**であること — `git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web` が空出力（AC-7 の本体はこれ）。`--project node` の TZ ピン（`Asia/Tokyo`）が `vitest.config.ts` に維持されていること

### 7. 既存 Node 参照ランタイムの回帰（アプリの起動と主要動線）

- **対応する受け入れ基準:** AC-7
- **検証手段:** browser
- **目的:** 依存追加と vitest / tsconfig 構成の変更が、実際のアプリの起動と主要動線を壊していないことを確認する
- **手順:**
  1. `cp apps/web/.env.example apps/web/.env` し、`APP_URL=http://localhost:3000` と `OAUTH_DEV_MODE=true` を設定する
  2. `pnpm dev` で開発サーバーを起動する
  3. ブラウザで `http://localhost:3000` を開く
  4. 開発用サインインでアカウントを作成し、サインインする
  5. ノートを 1 件新規作成し、開いて表示されることを確認する
- **期待結果:** サーバーが起動し、トップページが表示される。サインインが完了し、作成したノートが一覧と詳細の両方で表示される
- **確認ポイント:** 起動時のコンソールに `wrangler` / `workerd` / Cloudflare バインディング関連のエラー・警告が出ないこと（Cloudflare 依存が Node ランタイムの実行時に引き込まれていないこと）。ブラウザのコンソールに新規のエラーが出ないこと

### 8. 新規に決めた物理スキーマと spec の一致

- **対応する受け入れ基準:** AC-8 / AC-9
- **検証手段:** api
- **目的:** 実装で決めた物理スキーマ（`_occ_guard` の列定義、scope task の due index 表）と、spec の持ち分を変えた決定がドキュメントに反映されていることを確認する
- **手順:**
  1. `git diff origin/main...HEAD -- spec/` で spec の差分を読む
  2. `packages/core/src/adapters/cloudflare/` の DDL と `spec/database/index.md` の物理配置表を突き合わせる
  3. `spec/inventory/adapter.md` の ADP 行と、実際に追加したアダプターの粒度が食い違っていないことを確認する
- **期待結果:** `_occ_guard` と due index の列定義が `spec/database/index.md` に節として存在し、DDL と一致する。反映しなかった差分は `.thread/11/adr.md` に理由付きで残っている
- **確認ポイント:** spec に無い表・列を実装が勝手に持っていないか。逆に spec にあってポートが存在する表を実装が落としていないか

## エッジケース・異常系

### 1. D1 の bound parameter 上限（100）と大きな `resolveMany`

- **検証手段:** api
- **目的:** `noteRouteStore.resolveMany`（最大 500）/ `userBatchReader.resolveMany`（最大 100）が `?` の並べ書きで上限超過にならないことを確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose` の出力から、`packages/core/src/adapters/cloudflare/__tests__/support.test.ts` の `resolves all 500 note routes in one statement` / `resolves all 100 users in one statement` の結果を読む
- **期待結果:** `too many SQL variables` 相当のエラーが出ず、全件解決される。多行 INSERT / DELETE も同様（同ファイルの `inserts, reads and deletes a list well past the binding limit in one statement each`）。上限そのものの拒否は `refuses a statement that would exceed the driver's binding limit`
- **確認ポイント:** JSON 1 value + `json_each` 展開に落ちているか（`?` を件数分並べていないか）

### 2. 適合スイート間の相互汚染（fresh backend 契約）

- **検証手段:** api
- **目的:** `@cloudflare/vitest-plugin` の分離ストレージがファイル単位であるのに対し、適合スイートが要求する「毎テスト fresh backend」が満たされていることを確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose` を 2 回連続で実行する
  2. `pnpm exec vitest run --project workers --reporter=verbose --sequence.shuffle` のようにケース順を変えて実行する（vitest のシャッフルオプションが使えない場合は 1 回目の結果と 2 回目の結果が同一であることの確認に留める）
- **期待結果:** どの実行でも同じ結果（22 ファイル・368 passed / 0 skipped、失敗 0）になる。実行順や実行回数で結果が変わらない
- **確認ポイント:** factory 呼び出しごとに名前空間が分かれているか（前のケースが書いた D1 行・R2 オブジェクト・DO ストレージが次のケースから見えないこと）。実物での観測は `harness.test.ts` の `hands out backends that cannot see one another on any plane` と `leaves no migrated table out of the wipe`（DO は object 名、R2 は key prefix で分かれ、D1 だけが 1 DB 共有＋ factory 先頭で全消し）

### 3. 全文検索（FTS5 + bigram）と memory 実装の契約差

- **検証手段:** api
- **目的:** memory が素朴な部分一致で通しているケースを FTS 版が落としていないことを確認する
- **手順:**
  1. `pnpm exec vitest run --project node --project workers --reporter=verbose` を実行し、`localNoteQueryService` / `publicNoteQueryService` の適合スイートが両バックエンドで緑であることを確認する
- **期待結果:** 両バックエンドが同じスイートを通る。1 文字キーワード・トークン境界をまたぐ部分一致・`relevance` 順のケースが片方だけ落ちることはない
- **確認ポイント:** スイートを変更した場合、その変更が memory 側も通るものになっているか（[ADR 046](../../spec/adr/046-port-contract-divergence.md) の手続きに従っているか）

## 既存機能への影響確認

- **既存の自動テスト（変更前 76 ファイル・978 件 → 変更後 77 ファイル・984 passed / 3 skipped）** — 確認項目 6 の手順 1 で確認する。root `vitest.config.ts` の `projects` 化が既存のテスト収集を取りこぼしていないか、ファイル数・ケース数を変更前と突き合わせる（増分の内訳は確認項目 6 の期待結果）
- **`pnpm typecheck`** — tsconfig を 4 つ目（`tsconfig.cloudflare.json`）に増やすため、既存 3 つの型検査範囲が狭まっていないことを確認する（確認項目 6 の手順 3）
- **開発サーバーの起動と主要動線** — 確認項目 7 で確認する。`wrangler` を devDependency に足すことでの実行時への漏れ出しがないこと
- **ビルド** — `pnpm build:node` が通ること。CI が別ジョブで回している
