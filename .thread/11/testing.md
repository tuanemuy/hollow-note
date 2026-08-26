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
  （`--project workers` は本 Issue のステップ 1 が root `vitest.config.ts` に足す vitest project。ステップ 1 完了前は存在しない）
- 既存 Node ランタイムの確認: `pnpm exec vitest run --project node --reporter=verbose`
- 両方まとめて: `pnpm test`（= `vitest run`）
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
- **期待結果:** 失敗 0 / skip 0 で終了する。`packages/core/src/adapters/cloudflare/__tests__/conformance/*.test.ts`（7 ファイル）が実行され、memory 側 `packages/core/src/adapters/memory/__tests__/conformance.test.ts` が呼んでいる `describeXxxContract` と同じスイート群がすべて緑になる。集合の一致そのものは `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` が固定する
- **確認ポイント:** 呼ばれているスイート名の集合が memory 側と一致すること（片方だけ呼ばれていないスイートがないこと）。`todo` / `skip` / `it.skipIf` で回避されたケースが 0 件であること。バインディングが実物であること（出力に miniflare / workerd 由来の起動があり、in-memory 実装へ読み替えられていないこと）

### 2. 適合スイート呼び出し集合の一致（スタブ・部分実装の検出）

- **対応する受け入れ基準:** AC-1 / AC-2
- **検証手段:** api
- **目的:** 「全件パス」がスイートの間引きで達成されていないことを確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --project node --reporter=verbose` の出力から、Cloudflare 側と memory 側それぞれの適合スイート由来の describe 名とケース数を数える
  2. 実装側に `throw new Error("not implemented")` / `TODO` / `FIXME` / 空実装が残っていないことを `packages/core/src/adapters/cloudflare/` に対して確認する
- **期待結果:** Cloudflare 側と memory 側の適合スイート由来のケース数が一致する。未実装マーカーが 0 件
- **確認ポイント:** ポート単位で欠落がないか（plan.md の 35 ポート）。適合スイート本体（`packages/core/src/adapters/conformance/`）に差分があるなら、その差分は memory 側も通していること

### 3. transaction / 再試行 / 冪等性 / lease 回収の統合確認

- **対応する受け入れ基準:** AC-4
- **検証手段:** api
- **目的:** 適合スイートが観測できない driver 固有の性質（D1 batch の原子性、`transactionSync` の巻き戻し、同一 operation の再実行の冪等性、リース失効後の再 claim）を実バインディングで確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose` の出力から、`packages/core/src/adapters/cloudflare/__tests__/` 配下のバックエンド固有テスト（unitOfWork / durability / alarm / r2 等）の結果を読む
- **期待結果:** 次の 4 点がそれぞれケースとして存在し、緑であること — (a) D1 batch を途中で失敗させたとき一部だけ残らない、(b) 応答喪失を模した同一 operation の再実行が冪等（`applied_operations` / `processed_events` / outbox `id` 衝突が no-op）、(c) `scheduled_tasks` のリース失効後に別 writer が再 claim でき `due_at` / `attempts` / `priority` / `payload` が claim 前のまま保たれる、(d) R2 の同一 key 並行 write と `deleteMany` の不在許容
- **確認ポイント:** (a) が「例外を投げた」だけで終わらず、失敗後にストアを読み直して残骸が無いことまで観測しているか

### 4. `deleteFilesByOwner` の SQL 文数の実測

- **対応する受け入れ基準:** AC-5
- **検証手段:** api
- **目的:** `spec/platform/index.md` の「列挙 1 ＋ 多行 DELETE 1 ＋ 多行 outbox INSERT 1 の 3 文」という設計目標に対する実測値を確定させる
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose` の出力から、文数を計数しているケースの結果を読む
  2. 実測値が 3 文でなかった場合、`spec/platform/index.md` の該当行が実測値に改められているかを確認する
- **期待結果:** 実測値が記録されており、spec の記述と一致している。`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例しない」は変更されていない
- **確認ポイント:** 件数を変えても文数が変わらないこと（比例していないこと）を観測しているか

### 5. `ScopeTaskScheduler` の fencing 決着が記録されている

- **対応する受け入れ基準:** AC-6
- **検証手段:** api
- **目的:** settle（`complete` / `backoff` / `schedule`）に fencing token が要るかの結論と根拠が残っていることを確認する
- **手順:**
  1. `.thread/11/adr.md` に該当の判断エントリがあることを確認する
  2. 「claim token を契約へ足す」を選んだ場合は、ポート JSDoc（`packages/core/src/application/ports/scopeTaskScheduler.ts`）・適合スイート（`packages/core/src/adapters/conformance/scopeTaskScheduler.ts`）・`spec/domains/` の該当箇所に反映されていることを確認する
  3. `pnpm exec vitest run --project node --project workers --reporter=verbose` が両バックエンドで緑であることを確認する
- **期待結果:** 結論・根拠が adr.md にあり、契約を変えた場合は 3 箇所すべてに反映され、両バックエンドが同じスイートを通っている
- **確認ポイント:** 「運用で足りる」を選んだ場合、その前提（`leaseMs` の下限、writer 多重度）が明文化されているか

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
- **期待結果:** 1 は既存 76 ファイル・978 件が失敗 0 で通る（本 Issue が適合スイートにケースを足した場合はその増分だけ増える）。2 は node / workers 両プロジェクトを回して失敗 0。3・4・5 はエラー 0
- **確認ポイント:** `packages/core/src/adapters/memory/` と `apps/web/` に振る舞いの変更が入っていないこと（`git diff origin/main...HEAD --stat` で確認）。`--project node` の TZ ピン（`Asia/Tokyo`）が維持されていること

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
  1. `pnpm exec vitest run --project workers --reporter=verbose` の出力から、上限件数（500 / 100）での `resolveMany` ケースの結果を読む
- **期待結果:** `too many SQL variables` 相当のエラーが出ず、全件解決される。多行 INSERT / DELETE も同様
- **確認ポイント:** JSON 1 value + `json_each` 展開に落ちているか（`?` を件数分並べていないか）

### 2. 適合スイート間の相互汚染（fresh backend 契約）

- **検証手段:** api
- **目的:** `@cloudflare/vitest-plugin` の分離ストレージがファイル単位であるのに対し、適合スイートが要求する「毎テスト fresh backend」が満たされていることを確認する
- **手順:**
  1. `pnpm exec vitest run --project workers --reporter=verbose` を 2 回連続で実行する
  2. `pnpm exec vitest run --project workers --reporter=verbose --sequence.shuffle` のようにケース順を変えて実行する（vitest のシャッフルオプションが使えない場合は 1 回目の結果と 2 回目の結果が同一であることの確認に留める）
- **期待結果:** どの実行でも同じ結果（失敗 0）になる。実行順や実行回数で結果が変わらない
- **確認ポイント:** factory 呼び出しごとに名前空間が分かれているか（前のケースが書いた D1 行・R2 オブジェクト・DO ストレージが次のケースから見えないこと）

### 3. 全文検索（FTS5 + bigram）と memory 実装の契約差

- **検証手段:** api
- **目的:** memory が素朴な部分一致で通しているケースを FTS 版が落としていないことを確認する
- **手順:**
  1. `pnpm exec vitest run --project node --project workers --reporter=verbose` を実行し、`localNoteQueryService` / `publicNoteQueryService` の適合スイートが両バックエンドで緑であることを確認する
- **期待結果:** 両バックエンドが同じスイートを通る。1 文字キーワード・トークン境界をまたぐ部分一致・`relevance` 順のケースが片方だけ落ちることはない
- **確認ポイント:** スイートを変更した場合、その変更が memory 側も通るものになっているか（[ADR 046](../../spec/adr/046-port-contract-divergence.md) の手続きに従っているか）

## 既存機能への影響確認

- **既存の自動テスト（978 件）** — 確認項目 6 の手順 1 で確認する。root `vitest.config.ts` の `projects` 化が既存のテスト収集を取りこぼしていないか、ファイル数・ケース数を変更前と突き合わせる
- **`pnpm typecheck`** — tsconfig を 4 つ目（`tsconfig.cloudflare.json`）に増やすため、既存 3 つの型検査範囲が狭まっていないことを確認する（確認項目 6 の手順 3）
- **開発サーバーの起動と主要動線** — 確認項目 7 で確認する。`wrangler` を devDependency に足すことでの実行時への漏れ出しがないこと
- **ビルド** — `pnpm build:node` が通ること。CI が別ジョブで回している
