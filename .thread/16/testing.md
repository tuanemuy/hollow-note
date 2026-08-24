# 動作確認計画 — Issue #16: 保守スイープの表順が二重正本になっている

**Issue:** #16
**作成日:** 2026-08-25

---

## 確認環境

このIssueの変更を確認するために必要な手順のみ記載（依存パッケージのインストール等、プロジェクト全体のセットアップは省略）。

### この Issue は画面を持たない（実機観測の可否を先に確定させる）

本 Issue の変更対象は `GlobalMaintenanceRunStore` のポート契約・memory アダプター・適合スイート・`pruneExpiredAuthState` ユースケースで、ルート / コンポーネント / server function は 1 つも触らない（steps.md「UI / プレゼンテーション: 影響なし」）。`grep -rn "maintenance" apps/web/app/routes apps/web/app/components` は 0 件で、保守スイープを表示・操作する画面は存在しない。

さらに、**本 Issue の主対象である `pruneExpiredAuthState` は参照ランタイムのどこからも駆動されていない**。実際に確認した 3 点:

- `docs/runtime_node.md` の Worker runner 表（99 行）— 「`pruneExpiredAuthState` is implemented and tested but **not scheduled** here — its cron / queue wiring is Issue #15」
- 同「Known limitations」（141 行）— 「**No auth-state prune scheduling.** `pruneExpiredAuthState` runs only from tests」
- `apps/web/app/worker/node/runner.ts:156-161` の JSDoc — 「nothing schedules that usecase in this runtime yet (its cron wiring is Issue #15)」

`grep -rn "pruneExpiredAuthState" apps packages --include="*.ts"`（テスト除く）でも、呼び出しているのは JSDoc の言及と usecase 自身だけで、`apps/web/scripts/` は `listen.node.ts` 1 本のみ、ルートからの呼び出しも 0 件。**したがって、この配備で保守スイープの run を実機で回して観測する手段は存在しない**（cron の発火口も、管理画面も、CLI も無い）。これは調査で確定した事実であり、未確認事項ではない。

その結果、本計画の確認項目は**すべて `api`**（テストランナーとコマンドの出力で機械的に判定する形）になる。ブラウザーで確認できるのは、同じポートのもう 1 つの呼び出し元 `terminalPrune`（`pruneAccountDeletionManifests` として `runner.ts` の prune tick に配線済み）を通るアカウント削除フローだけで、これは受け入れ基準ではなく既存機能の退行確認なので「既存機能への影響確認」に置く。

### 検証環境の起動

すべてリポジトリルートで実行する。

| 用途 | コマンド | 出典（実ファイルで確認） |
| --- | --- | --- |
| 型検査 | `pnpm typecheck` | root `package.json` の `scripts.typecheck`（`tsgo && pnpm -r typecheck`）/ `CLAUDE.md`「After changes」 |
| Lint（自動修正） | `pnpm lint:fix` | root `package.json` の `scripts.lint:fix`（`biome check --write`）。検査のみは `pnpm lint`（`biome lint`） |
| 整形 | `pnpm format` | root `package.json` の `scripts.format`（`biome format --write`）。検査のみは `pnpm format:check` |
| 単体テスト・適合スイート | `pnpm test:unit`（`pnpm test` は別名） | root `package.json` の `scripts.test:unit`（`vitest run`）/ `README.md`「Development commands」。設定は root `vitest.config.ts`（`spec/**` を除外、`TZ=Asia/Tokyo`、`testTimeout: 10_000`） |
| テストの部分実行 | `pnpm exec vitest run <パス> --reporter=verbose` | `vitest` は root `package.json` の devDependency。本計画の作成時に実際に実行して出力を確認済み |
| 開発サーバー（既存機能の退行確認のみ） | `pnpm dev` | root `package.json` の `scripts.dev` → `@repo/web` の `dev:node`（`vite dev --config vite.config.node.ts`）。現在の `apps/web/.env` は `APP_URL=http://localhost:3100` なので待ち受けは **`http://localhost:3100`**（`vite.config.node.ts` が `APP_URL` の port を `server.port` に渡す） |

このリポジトリのテスト名は `TC-identity-347: ...` / `ADP-common-029: ...` のように**台帳 ID を先頭に持つ**ので、`--reporter=verbose` の出力から狙ったケースの存在と合否を機械的に判定できる。

### マイグレーション・シード

**不要。** 永続化は in-memory アダプターのみで、`package.json`（root / `apps/web` / `packages/core`）に `db:*` に相当するスクリプトは 1 つも無い（`CLAUDE.md`「Persistence is in-memory, so there is no database to provision and no migration script.」）。

### デプロイ方法

**なし。** 参照ランタイムは Node.js + in-memory アダプターの 1 本だけ（`CLAUDE.md`「Reference runtime」/ ADR 025）。CI（`.github/workflows/ci.yml`）は `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test:unit` と `pnpm build:node` を回すので、確認項目 6 が通れば CI も通る。

### 実行前の基準値（本計画の作成時に実測）

| 検査 | 結果 |
| --- | --- |
| `pnpm lint` | 緑（Checked 434 files / Found 2 infos） |
| `pnpm format:check` | 緑（Checked 446 files / No fixes applied） |
| `pnpm test:unit` | **Test Files 76 passed / Tests 970 passed, 3 skipped（973）** |
| `grep -rn "SWEEP_ORDER" packages apps` | **3 件**（`pruneExpiredAuthState.ts` の 380 / 381 / 475 行） |

ファイル単位の内訳（変更対象 4 ファイル、合計 275 件）:

| ファイル | 実行前の件数 |
| --- | --- |
| `packages/core/src/adapters/memory/__tests__/conformance.test.ts` | 232（うち `GlobalMaintenanceRunStore conformance [memory]` は **11 件**: ADP-common-026 / 027×3 / 028 / 029 / 030×3 / 031×2） |
| `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts` | **32** |
| `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts` | 7 |
| `packages/core/src/application/workers/__tests__/outboxPrune.test.ts` | 4 |

完了後の期待値は「**テストファイル数は 76 のまま**（ステップ 5・7 はいずれも既存ファイルへの追加で、新規テストファイルを作らない）／**テスト件数は 970 より増える**（TC-identity-347/348/349 の 3 件 + 適合スイートの追加ケース）／skipped は 3 のまま」。

### 実機で観測しない受け入れ基準

- **AC-9 / AC-10 / AC-11**（spec / ADR / テストケース台帳の改訂）— 文書側の基準で、コマンドではなくレビューで確認する。対象は `spec/domains/index.md`、`spec/database/index.md`、`spec/inventory/{domain,adapter,usecase,test}.md`、`spec/usecases/identity.md`、`spec/testcases/identity/pruneExpiredAuthState.md`、新規 `spec/adr/061-*.md` / `062-*.md`、`spec/adr/index.md`（steps.md ステップ 2・3）。
- **AC-12 と AC-1 の後半（ポート JSDoc の契約記述）**— JSDoc の文面はテスト出力に出ない。`packages/core/src/application/ports/globalMaintenanceRunStore.ts`（契約 1〜4 と `MaintenanceLane` / `generation` の JSDoc）、`pruneExpiredAuthState.ts` / `deleteAccount/terminalPrune.ts` の Runtime wiring note をレビューで確認する。**契約 2 / 3 / 4 の振る舞い側**は確認項目 2・3 が適合スイートで拘束する。
- **AC-8 の JSDoc 側**も同上。振る舞い側は確認項目 3。

## 確認項目

### 1. `SWEEP_ORDER_HINT` がリポジトリから消え、型が通る

- **対応する受け入れ基準:** AC-2、AC-1（応答形状の型側）
- **検証手段:** api
- **目的:** 表順の 2 本目の正本が定数ごと消えたこと、および `advanceOrAck` の戻り値を `MaintenanceLane` へ広げた変更が全呼び出し元（`pruneExpiredAuthState` / `terminalPrune` / `outboxPrune.test.ts` のスタブ）に型として波及して破綻していないことを確かめる
- **手順:**
  1. リポジトリルートで `grep -rn "SWEEP_ORDER" packages apps`
  2. `pnpm typecheck`
- **期待結果:**
  - 手順 1 の出力が **0 行**（実行前は 3 行: `pruneExpiredAuthState.ts:380` / `:381` / `:475`）で、終了コードは 1（grep のノーマッチ）
  - 手順 2 が成功で終了する
- **確認ポイント:**
  - 定数だけ消して `SWEEP_ORDER_HINT` 相当の配列リテラルが別名で残っていないこと。`grep -rn "AuthStateTable\[\]" packages/core/src/application/identity/pruneExpiredAuthState.ts` で、表順を持つ配列が usecase に残っていないかも合わせて見る（`isAuthStateTable` の述語は残ってよい — 述語は順序を持たない）。
  - `pnpm typecheck` は `terminalPrune.ts` の `release(advanced.next)`（`{ generation, shardId }` しか読まない）が構造的部分型で通ることの担保でもある。ここが落ちるなら、`terminalPrune` に不要な変更を入れている疑い（steps.md ステップ 8 は「変更しないのが正解」）。

### 2. ack が進めた先の position を返し、キーの mint 主体が分岐で正しい

- **対応する受け入れ基準:** AC-1（応答）、AC-3、AC-4
- **検証手段:** api
- **目的:** 「表順の正本は run のスナップショット」という契約の実行形が適合スイートに載り、(a) 新しい position を作ったときは呼び出し側が導けるキーと一致し、(b) 既存 position を返すとき（別 shard の自動 claim）は永続化済みのキーを再 mint しないことが、memory バックエンドに対して拘束されていることを確かめる
- **手順:**
  1. リポジトリルートで次を実行する

     ```
     pnpm exec vitest run packages/core/src/adapters/memory/__tests__/conformance.test.ts --reporter=verbose
     ```

  2. 出力を `GlobalMaintenanceRunStore conformance [memory]` で絞って読む
- **期待結果:**
  - `Test Files 1 passed` / 失敗 0 で終了する
  - `ADP-common-029` を含む ✓ 行が存在し、そのケースが次を主張していることをテストコードで確認できる:
    - 表を進めた `next` が `{ table: "t2", cursor: null, asOf: run の asOf }` を持つ
    - その `commandKey` がファイル冒頭の `commandKeyOf(runId, next)`（`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`）と一致する（AC-3）
    - 別 shard を自動 claim して返した `next` が、**事前に checkpoint しておいた cursor と表**をそのまま保ち、`commandKey` が checkpoint 時に渡した文字列（規則から外れた `"command-2"` のような値）と**一致する**（AC-4）
    - 返った `next` が claimed である（直後の `claimLanes` がその shard を返さない）
  - `GlobalMaintenanceRunStore conformance [memory]` の ✓ 行は **11 行以上**（実行前が 11 行。ケースを既存行に相乗りさせるだけなら 11 行のまま、独立ケースを足したなら増える）
- **確認ポイント:**
  - **AC-4 の主張は「規則外の `commandKey` を渡した lane」で書かれていること。** 規則どおりのキーを渡す形だと、store が再 mint しても一致してしまい「再 mint していない」が観測できない。
  - `asOf` が `run の asOf`（resume 元の固定値）であり、`clock.now()` ではないこと。ここが `now` に倒れると、スイープ境界が invocation ごとに動く。
  - 既存 11 ケースが 1 つも消えていないこと（特に ADP-common-030 の 3 件 — lapsed lease からの lane 回収は、本 Issue が塞ぐ「誰も駆動しない claimed lane」の最後の受け皿）。

### 3. 解放（`completed: false`）は lane を返さない

- **対応する受け入れ基準:** AC-8（振る舞い側）
- **検証手段:** api
- **目的:** 「解放は pending に戻すだけで、他に pending lane があっても新しい lane を claim しない」という契約 2 が適合スイートで拘束されていることを確かめる。リポジトリ内の解放呼び出しは 3 か所とも戻り値を捨てているので、この 1 ケースが無いと別バックエンドが「解放時に次の pending を返す」実装を書き、誰も駆動しない claimed lane が再生する
- **手順:**
  1. 確認項目 2 と同じコマンドを実行する

     ```
     pnpm exec vitest run packages/core/src/adapters/memory/__tests__/conformance.test.ts --reporter=verbose
     ```

  2. `ADP-common-028` の行と、そのケースの本体（`packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`）を読む
- **期待結果:**
  - `ADP-common-028` を含む ✓ 行が存在し、そのケースが `advanceOrAck({ completed: false })` の戻り値について `{ next: null, runCompleted: false }` を主張している
  - その主張が、**他方の shard が pending のまま残っている状態**で行われている（既存 fixture は 2 shard のうち 1 本だけを claim して解放する形なので、fixture の追加なしにこの状態になる）
- **確認ポイント:**
  - **`runCompleted` だけでなく `next` を assert していること。** `next` を見ない assert では契約 2 の主張が落ちる。
  - fixture が 1 shard 構成に書き換わっていないこと。1 shard だと「他に pending が無いから null」と読めてしまい、主張が弱まる。
  - スイート冒頭 JSDoc（「suite pins the lane topology」の段落）に、解放が position を返さないことが書かれていること。

### 4. 表構成が違う配備でも 1 回の cron で run が完走する

- **対応する受け入れ基準:** AC-5
- **検証手段:** api
- **目的:** hint を廃して `advanced.next` をそのまま処理する形にしたことで、run の表集合が usecase の既定順と違っても順序ずれで停滞せず、claimed のまま残る lane が出ないことを確かめる（本 Issue が Issue 本文で名指された停滞そのもの）
- **手順:**
  1. リポジトリルートで次を実行する

     ```
     pnpm exec vitest run packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts --reporter=verbose
     ```

  2. 出力から `TC-identity-347` を含む行を読む
- **期待結果:**
  - `Test Files 1 passed` / 失敗 0 で終了する
  - `TC-identity-347` を含む ✓ 行が存在し、そのケースが `maintenanceTablesByKind: { authStatePrune: ["identity_removal_receipts", "sessions"] }`（既定順と違う表集合）で **1 回の cron** を回し、`continued: false` / run が `completed` / 対象セッションが消える / claimed のまま残る lane が 0 件、を主張している
  - 実行前に存在した `"a lane whose next table the sweep order cannot name is released, not left claimed"` という名前の ✓ 行が**消えている**（このテストが TC-identity-347 へ作り替わったことの確認）
- **確認ポイント:**
  - **「解放される」ではなく「完走する」を主張していること。** 元のテストは「名指せないから解放する」を固定していたので、期待だけ残して名前を変えた形だと本 Issue が要求した振る舞いを測っていない。
  - cron を 2 回以上回して完走させる形になっていないこと。基準は「1 回で完走」。
  - 期限切れセッションが実際に消えていること（run が `completed` になるだけなら、表を全部飛ばした実装でも通ってしまう）。

### 5. 同時 claim 上限を超える shard 数でも解放して取り直す往復が消えている

- **対応する受け入れ基準:** AC-7
- **検証手段:** api
- **目的:** 別 shard が自動 claim された経路で `advanced.next` をそのまま処理キューに載せるようになり、「解放 → `claimLanes` で取り直す」迂回（往復 2 回と、その間に他ワーカーへ取られる窓）が無くなったことを確かめる
- **手順:**
  1. 確認項目 4 と同じコマンドを実行する

     ```
     pnpm exec vitest run packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts --reporter=verbose
     ```

  2. 出力から `TC-identity-348` を含む行を読む
- **期待結果:**
  - `TC-identity-348` を含む ✓ 行が存在し、そのケースが **8 shard**（同時 claim 上限 6 を超える）の配備で 1 回の cron を回し、run が `completed` になり、その間 `advanceOrAck(completed: false)` が **1 度も呼ばれない**ことを store ラッパーで主張している
- **確認ポイント:**
  - 観測が **`advanceOrAck(completed: false)` の呼び出し回数**で行われていること。`claimLanes` の呼び出し回数に依存する形にすると、TC-identity-171（reshard 32 lane、`claimLimits.length > 0` を見る）の観測と干渉する。
  - `advanceOrAck` 全体ではなく `completed: false` だけを数えていること（`completed: true` は正常な前進なので当然呼ばれる）。
  - 同じ実行で `TC-identity-171`（active lane ≤ 6）と `TC-identity-174`（lapsed lease からの回復）が ✓ のままであること。

### 6. 品質ゲート（全体）

- **対応する受け入れ基準:** AC-13
- **検証手段:** api
- **目的:** ポート応答形状の変更が全レイヤーへ波及した状態で、リポジトリ全体の型検査・lint・整形・テストが緑であることを確かめる
- **手順:**
  1. リポジトリルートで `pnpm typecheck`
  2. `pnpm lint:fix`
  3. `pnpm format`
  4. `pnpm test:unit`
- **期待結果:**
  - 4 つすべてが成功で終了する
  - `pnpm test:unit` は **Test Files 76 passed**（実行前と同じ）、**Tests は 970 より多い passed / 3 skipped**
  - `pnpm lint:fix` / `pnpm format` が差分を書き戻していないこと（書き戻したなら、その差分を commit に含める）
- **確認ポイント:**
  - テストファイル数が 76 から増えていたらスコープ逸脱（ステップ 5・7 はいずれも既存ファイルへの追加）。
  - テスト件数が 970 を**下回っていたら**、既存ケースを消している（ステップ 7 は 2 件を「作り替え / 載せ替え」であって削除ではない）。
  - `pnpm lint` の infos が 2 件から増えていないこと。

## エッジケース・異常系

### 1. 飛ばした未知表が run の最終表だったとき（`next === null`）

- **対応する受け入れ基準:** AC-6
- **検証手段:** api
- **目的:** この配備が sweep を持たない表を ack で飛ばす経路で、飛ばした先が run の終端だった場合に `inFlight` を消し忘れず、完走した run に対して `finally` が余計な解放を打たないことを確かめる（打つと `MAINTENANCE_LANE_NOT_CLAIMED` → 余計な error ログ → `workRemains = true` で、完走した run に `continued: true` を返す）
- **手順:**
  1. リポジトリルートで次を実行する

     ```
     pnpm exec vitest run packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts --reporter=verbose
     ```

  2. 出力から `TC-identity-349` を含む行を読み、そのケースの本体を読む
- **期待結果:**
  - `TC-identity-349` を含む ✓ 行が存在し、そのケースが次を主張している:
    - `h.backend.maintenanceRuns` に、この配備が sweep を持たない表を含む表集合（例 `["job_tombstones", "sessions"]`）の running run 行を**直接置き**（lease は失効させて resume させる）、cron を 1 回回す
    - `SystemError` が投げられず、run が `completed` になり、期限切れセッションが消える
    - 未知表が `failures` に数えられない
    - error ログに `[pruneExpiredAuthState] unknown sweep table` 相当の記録が残り、payload に `runId` / `generation` / `shardId` / `table`（飛ばした表名）が載っている
  - 出力に `[pruneExpiredAuthState] lane release failed` / `MAINTENANCE_LANE_NOT_CLAIMED` が**現れない**
- **確認ポイント:**
  - **置く run 行の `asOf` が、撒く期限切れ行の `expiresAt` 以降であること。** `beginOrResumeKind` は resume 時に置いた行の `asOf` をそのまま返し、それが sweep の境界（`expiresAt <= asOf`）になるので、`asOf` を先に置くと対象が 0 件になり「セッションが消える」の主張が黙って落ちる（`clock.now()` と同値で足りる）。
  - **fixture が `maintenanceTablesByKind` で未知表を混ぜる形になっていないこと。** その形が再現するのは「同一配備内のドリフト」（本 Issue が解決しない残存条件）であって、AC-6 が拘束したい「旧い表集合の run を新しい配備が resume する」ではない。テストが名乗るシナリオと実際に置く状況がずれる。
  - `failures` に数えていないことを、view の `failures` が 0 であることで主張していること。数えていると、全表未知の run が `SystemError(DatabaseError)` になって DB 障害と区別できなくなる。

### 2. 解放そのものが失敗したとき（throw が勝ち、lane は claimed のまま）

- **対応する受け入れ基準:** AC-13（既存ケースを消さないこと）
- **検証手段:** api
- **目的:** hint 廃止で前提が消えた既存テスト `"a failing lane release is logged rather than thrown, ..."` が、削除ではなく別の fixture へ載せ替えられ、`releaseLane` の「解放失敗はログに落として throw しない」挙動が引き続き拘束されていることを確かめる
- **手順:**
  1. 確認項目 4 と同じコマンドを実行する

     ```
     pnpm exec vitest run packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts --reporter=verbose
     ```

  2. 出力の ✓ 行の総数と、解放失敗を扱うケースの本体を読む
- **期待結果:**
  - このファイルの `Tests` が **32 より多い**（実行前 32。TC-identity-347 は既存 1 件の作り替えなので ±0、348 / 349 の追加で +2、載せ替えは ±0 → **34 件**が想定値）
  - 解放失敗を扱うケースが `checkpointLane` が投げる fixture（`maintenanceShardIds: ["shard-0".."shard-3"]`）の上に `advanceOrAck(completed: false)` も投げる設定を重ねた形になっており、次を主張している:
    - 元の throw（`"checkpoint down"`）がそのまま伝播する（解放失敗が元のエラーを飲み込まない）
    - 解放失敗が `[pruneExpiredAuthState] lane release failed` としてログに出る
    - lane が claimed のまま残る（この fixture は 4 lane を claim するので **4 件**。元テストの 1 件ではない）
- **確認ポイント:**
  - **テストの説明コメントから「hint が次表を名指せない経路」への言及が落ち、代わりに「なぜ `releaseLane` の `workRemains = true` が観測できないのか」（usecase 自体が throw して view を返さないため）の説明が引き継がれていること。** これが消えると、次の読者が `workRemains = true` をデッドコードとして消しうる。
  - テストコメントに `.thread` ローカルの ADR 番号（ADR-039 等）が書かれていないこと。`.thread` は canon ではなく掃除されるので参照が宙に浮く（条件そのものを本文で書く）。
  - このケースが `it.skip` になっていないこと（skipped は 3 のまま、が確認項目 6 の基準）。

## 既存機能への影響確認

- **`terminalPrune`（アカウント削除の終端 prune）** — 同じ `advanceOrAck` のもう 1 つの呼び出し元で、**参照ランタイムで実際に走る唯一の経路**（`runner.ts:10` が `pruneAccountDeletionManifests` を import し、prune tick が boot 時と 24 時間ごとに呼ぶ）。挙動を変えないことが要件なので、`pnpm exec vitest run packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts` が **7 件緑のまま**（増減なし）であることを見る。特に「自動 claim された lane を即座に解放して返す」挙動が維持されていること — ここを `pruneExpiredAuthState` 側に揃えるリファクタを混ぜると、単一表 kind の invocation 予算の考え方が壊れる。
- **実機のアカウント削除フロー（唯一ブラウザーで踏める `advanceOrAck` 経路）** — `pnpm dev` を起動し（`http://localhost:3100`）、`/signup` で新規登録 → ターミナルの `mail.sent` の `actionUrl` でメール確認 → サインイン → `/settings/danger` でメールアドレスを入力して削除を実行し、進捗表示が終端（削除完了）に達すること、起動ターミナルに `[runner.node] manifest prune threw` が出ていないことを確認する。ポート応答形状の変更が実機のワーカー経路を壊していないことの、テスト以外の唯一の担保。
- **`outboxPrune` のスタブ実装** — `advanceOrAck` を実装している場所は「memory アダプター + `workers/__tests__/outboxPrune.test.ts:59` の `vi.fn(async () => ({ next: null, runCompleted: false }))`」の 2 つだけ。`next: null` なので新しい型でもコンパイルは通るが、`pnpm exec vitest run packages/core/src/application/workers/__tests__/outboxPrune.test.ts` が **4 件緑のまま**であることを見る。
- **`pruneExpiredAuthState` の既存挙動（TC-identity-150..178）** — 挙動不変が要件。確認項目 4・5 と同じ実行で、特に TC-identity-171（reshard・active lane ≤ 6）、TC-identity-174（lapsed lease からの回復）、TC-identity-165（全 sweep 失敗で `SystemError(DatabaseError)`）、および `"a budget-exhausted cron releases every claimed lane before returning"` が ✓ のままであることを見る。budget 枯渇時の全 lane 解放は、`advanceOrAck` の直接呼び出しへ組み替わる経路なので特に見る。
- **適合スイート全体** — `advanceOrAck` の応答形状変更は全バックエンドへの要件になる（Issue #11 の D1 実装者が同じ契約を実装する）。確認項目 2・3 の実行で `conformance.test.ts` が **232 件以上**緑であること、`GlobalMaintenanceRunStore conformance [memory]` の 11 ケースが 1 つも消えていないことを見る。
- **本番ビルド** — CI の `build` ジョブと同じ検査として `pnpm build`（→ `build:node`）が通ること。本 Issue はアプリのエントリーを触らないが、`@repo/core` は `.ts` を直接 export しているので型エラーがビルドに出る経路がある。
- **プロセス再起動でデータが消える** — 永続化は in-memory なので、既存機能の browser 確認を途中で中断するとアカウントも削除マニフェストも消える（仕様どおり）。上記のアカウント削除フローは 1 つの `pnpm dev` プロセス内で通す。
