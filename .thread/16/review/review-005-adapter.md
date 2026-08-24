# レビュー 005 — Adapter / 適合スイート

### Adapter / 適合スイート

#### Blockers

なし

#### Warnings

なし

#### 変異検証（実際に memory 実装を壊して赤くなるか確認した）

作業ツリーは各検証後に `git checkout --` で復元済み（最終確認: `git status --porcelain` が空、`pnpm test` 978 passed、`pnpm typecheck` Done）。

| # | 変異（`adapters/memory/repositories/globalMaintenanceRunStore.ts`） | 結果 |
|---|---|---|
| A | 別 shard 自動 claim 時に `commandKey` を再 mint する（契約 3(b) 違反） | 赤 2 件。`ADP-common-029: ...auto-claims a released lane at the table it reached...` が `'run-1:g1:s2:t2:cursor-77'` vs `'command-off-rule'` で落ちる |
| B | `toLane` の `asOf` を `run.asOf` から `backend.clock.now()` に変える（契約 2 の境界固定違反） | 赤 4 件（ADP-common-027 / 029 の 3 ケース） |
| C | 解放（`completed: false`）で pending lane を自動 claim して返す（契約 2 の「解放は null」違反） | 赤 5 件。`a release hands back no position even while another lane is pending` を含む |
| D | resume 時に run 行の `tables` を配備の設定で取り直す（契約 1 違反） | 赤 1 件。`an ack walks the table set the run was created with...` が刺さる |
| E | 次表へ進めた lane を `pending` のまま返す（契約 4 違反） | 赤 9 件。`the position an ack returns is still claimed` を含む |

契約 1〜4 のいずれも、実装を規約どおり壊すと適合スイートが落ちる。形骸化したアサーションは見つからなかった。

- 契約 1: `setMaintenanceTables` で live run の下に表集合を差し替え、(i) 旧 run が旧集合を歩き切る (ii) 次の run が新集合を取る、の両方を 1 ケースで観測している。(ii) が無いと `setMaintenanceTables` が no-op のバックエンドでも通るという JSDoc の主張は正しく、実際に `["t9","t9"]` のアサーションがその半分を担っている。
- 契約 3 の (a)/(b) 分割は、(a) を `commandKeyOf` の再導出一致（run 生成時の先頭 position / 次表 position）、(b) を規則外文字列 `"command-off-rule"` の素通しで別々に拘束しており、無条件に一致を要求する誤読を排除できている。
- 契約 4 は「返った position が claimed」を、進めた先（`the position an ack returns is still claimed`）と自動 claim 先（各ケース末尾の `claimLanes(...)` が 0 件）の両方で観測している。

#### ポート JSDoc と適合スイートの対応

`application/ports/globalMaintenanceRunStore.ts` の契約 1 / 2 / 3(a) / 3(b) / 4 は、いずれも `adapters/conformance/globalMaintenanceRunStore.ts` に対応する実行形を持つ。逆向き（スイートにしかない拘束）も確認したが、`ADP-common-029` 群の新規ケースはすべて JSDoc の該当文に紐づいており、契約に無い挙動を拘束しているものは無い。`spec/domains/index.md` のポート署名、`spec/inventory/adapter.md` ADP-common-029、`spec/inventory/domain.md` DOM-common-030 も新しい応答形状に更新されている。

#### memory 実装

- `advanceOrAck` の 3 経路（次表へ進める / 別 shard 自動 claim / 進み先なし）が、それぞれ契約 2・3・4 のとおり。次表 position は `cursor: null` + 再 mint、既存 position は `status` だけ差し替えて `toLane` で返し、キーを触らない。
- `toLane` が現在表を `run.tables[lane.tableIndex]` からのみ引くので、表名の正本が run 行 1 本に収まっている。`beginOrResumeKind` の resume 経路は `tables` に触れない。
- 自動 claim は「done 1 本 ↔ claimed 1 本」なので `MAX_ACTIVE_LANES = 6` を跨がない。8 shard 配備（TC-identity-348）で `advanceOrAck(completed: false)` が 0 回になることも実測で緑。
- `ConformanceBackend` 実装は memory 1 つだけで、`setMaintenanceTables` の追加による未実装バックエンドは無い。`advanceOrAck` のスタブは `workers/__tests__/outboxPrune.test.ts` の 1 か所のみで、新しい応答形状に適合している。

#### 並行性・冪等性・at-least-once

- 解放が新しい lane を claim しないことが契約とスイートの両方に入ったので、「戻り値を捨てる 3 つの解放呼び出し元」が誰も駆動しない claimed lane を生む経路は塞がっている。
- `commandKey` の再 mint 禁止（契約 3(b)）により、checkpoint 時に Queue へ載せた継続要求と自動 claim 後のキーが食い違う余地が無い。`runCron` / `runContinuation` / `terminalPrune` の導出規則は store の mint 規則と同一文字列。
- lapsed lease 回収（`reclaimLapsedLanes`）は `tableIndex` / `cursor` / `commandKey` を保持したままなので、resume した owner が同じ keyset から再開する性質は維持されている。
- 継続 turn の最終 ack が返す lane がリース失効まで claimed のまま残る点は、ポート JSDoc の契約 4 と両 usecase の Runtime wiring note に残存条件として明記されている（本 Issue のスコープ外として plan.md に記載済み）。

#### 経緯・弁明の残留

変更されたアダプター / 適合 / ポートの各ファイルを `previously` / `used to` / `no longer` / `review` / `指摘` / `以前` で走査したが 0 件。追加されたコメントはいずれも「なぜこの拘束が要るか」「なぜこの書き分けが必要か」であり、修正の経緯を語るものは無い。

#### カバレッジ

- 確認: `.thread/16/plan.md`, `.thread/16/review/triage-keys.md`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`
- スキップ: `.thread/16/adr.md` — 計画時の ADR 草案。確定版は `spec/adr/061` / `062` で確認済み
- スキップ: `.thread/16/review/review-001-adapter.md`, `.thread/16/review/review-001-spec.md`, `.thread/16/review/review-001-usecase.md`, `.thread/16/review/review-001.md`, `.thread/16/review/review-002-adapter.md`, `.thread/16/review/review-002-spec.md`, `.thread/16/review/review-002-usecase.md`, `.thread/16/review/review-002.md`, `.thread/16/review/review-003-adapter.md`, `.thread/16/review/review-003-spec.md`, `.thread/16/review/review-003-usecase.md`, `.thread/16/review/review-004-adapter.md`, `.thread/16/review/review-004-spec.md`, `.thread/16/review/review-004-usecase.md`, `.thread/16/review/review-004.md`, `.thread/16/review/triage.md` — 過去ラウンドのレビュー記録。今回はゼロベースで見る指示のため参照しない
- スキップ: `.thread/16/steps.md`, `.thread/16/testing.md` — 実装ステップ / 動作検証の作業記録で、アダプター契約の判断材料にならない
- スキップ: `spec/inventory/test.md`, `spec/testcases/identity/pruneExpiredAuthState.md` — テストケース台帳 / 本文。テスト観点の担当
- スキップ: `spec/inventory/usecase.md`, `spec/usecases/identity.md`, `spec/usecases/job.md` — ユースケース台帳 / 本文。ユースケース観点の担当
- スキップ: `spec/platform/index.md` — プラットフォーム設計。spec 観点の担当
