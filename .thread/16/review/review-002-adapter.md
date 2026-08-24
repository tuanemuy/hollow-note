# レビュー 002 — Adapter / 適合スイート

対象: PR #45 / ベース `main` / 差分 `16-round-002.diff`（32 ファイル）

## Adapter / 適合スイート

### Blockers

- **[B-001]** ADP-common-029 の `asOf` アサーションが同じコードパスの出力どうしを比べていて、契約を 1 つも拘束していない
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:280,303-306,370`
  - 理由: `expect(nextTable.asOf).toEqual(lane.asOf)` / `expect(secondShard.asOf).toEqual(lane.asOf)` / `expect(virgin.asOf).toEqual(lane.asOf)` は、いずれも**左辺と右辺の両方が同じ store の同じ変換**（memory では `toLane`）から出てくる。右辺の `lane` は `claimLanes` の戻り値であって、run 側から独立に得た値ではない。加えて `TestClock` はこのケースの中で一度も進まないので、`run.asOf` と `clock.now()` が同値のままである。実測: memory アダプターの `toLane` の `asOf: run.asOf` を `backend.clock.now()` に変えても、さらに `new Date(0)` に変えても、**リポジトリ全体（908 件）が緑のまま**通る。303-306 行のコメントは「the run's asOf, read back from the run row — not the wall clock at auto-claim time. A lane carrying a different boundary would sweep a different keyset than the run it belongs to.」と、このアサーションが区別できると明言しているが、実際には区別していない。ADR 026 の言う「契約の実行形」がここで空になっている。
  - あわせて契約側にも穴がある。ポート JSDoc の契約 2 は「`advanceOrAck` hands back the lane with its `table` / `cursor` / `asOf` / `commandKey`」と列挙するだけで、**`asOf` がどこから来る値なのか（run 行の固定 `asOf` であること）をどこにも書いていない**。`MaintenanceLane` の型 JSDoc（`packages/core/src/application/ports/globalMaintenanceRunStore.ts:6-12`）も `generation` の説明はあるが `asOf` には触れていない。`spec/domains/index.md` の追記も同じく列挙だけ。現在 `lane.asOf` を読む呼び出し元は 1 つも無い（両 usecase とも `begin.asOf` を使う）ので、D1 実装者にとってこれは**契約にも実行形にも根拠が無いフィールド**になる。
  - 提案: (1) ポート JSDoc の契約 2 に「`asOf` は run 行に固定された run の `asOf` であり、claim / ack のいずれの時刻でもない」を 1 文足す（`spec/domains/index.md` の同じ段落も対で更新）。(2) スイートは `begin` の戻り値を独立の正本として使い、間にクロックを進める。例:
    ```ts
    const started = await begin("run-1", "owner-a");
    const [lane] = await store.claimLanes("run-1", "owner-a", 1);
    backend.clock.advance(MINUTE_MS); // lease は生きたまま now !== run.asOf にする
    ...
    expect(nextTable.asOf).toEqual(started.asOf);
    ```
    `lane.asOf` との比較は残しても構わないが、それだけでは何も拘束しない。

- **[B-002]** 「次表へ進めた position の `cursor` は `null`」という契約 2 の節を、スイートが一度も拘束していない
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:262-281`（契約側は `packages/core/src/application/ports/globalMaintenanceRunStore.ts:57-58`）
  - 理由: `expect(nextTable.cursor).toBeNull()` は通るが、**進める前の lane の cursor がそもそも `null`** なので、cursor を持ち越す実装でも同じく通る。スイート内で cursor を持った lane を次表へ進めるケースは 1 つも無い（ADP-common-028 は checkpoint → 解放 → 再 claim、ADP-common-027 の 2 本目は checkpoint 無しで advance、ADP-common-029 の staging は checkpoint → 解放で、いずれも「表を跨ぐ」経路を通らない）。`commandKey` のアサーションも救いにならない — `commandKeyOf("run-1", nextTable)` は返ってきた `nextTable.cursor` から導くので、cursor が持ち越されていれば**両辺が同じように壊れて一致する**。実測: memory の step から `cursor: null` を落としても ADP-common-029 を含む適合スイート 16 件は全緑（usecase テスト 1 件だけが落ちるが、それは memory バックエンド経由の観測であって、別バックエンドには効かない）。
  - 影響: この節を落とした D1 実装は、次表の掃除を**別の表の keyset の途中から**始める。DELETE は述語に対して冪等でも、先頭側の行は永久に掃かれない。ADR 061 が正本を 1 本にして塞ぎに来た「静かに掃かれない行」がそのまま再生する。
  - 提案: ADP-common-029 の 1 本目で、`lane` を ack する**前に** `checkpointLane(table: "t1", cursor: "cursor-9", nextCommandKey: ...)` を挟む。そのうえで `expect(nextTable.cursor).toBeNull()` と `expect(nextTable.commandKey).toBe(commandKeyOf("run-1", nextTable))` を見れば、両方が初めて実効になる（memory は現状のまま通る）。

- **[B-003]** 「自動 claim は *その lane の永続化済みの表* を返す」という契約 2 の節も拘束されていない — staging した lane が t1 のままなので、run の先頭表を返す実装と区別できない
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:237-260, 298-306`（契約側は `.../ports/globalMaintenanceRunStore.ts:58-62`「the checkpointed table and cursor for one already worked and released」）
  - 理由: staging は s2 を claim → `checkpointLane(table: "t1", cursor: "cursor-77")` → 解放、で終わっている。`checkpointLane` は表を進めないので、**staging 後の s2 の `tableIndex` は 0 のまま**。したがって `expect(secondShard.table).toBe("t1")` は「永続化済みの表」と「run の先頭表」を区別しない。実測: memory の自動 claim 分岐で `tableIndex: 0` を強制（＝表位置を捨てて cursor だけ持ち越す）しても、リポジトリ全体 908 件が緑のまま通る。
  - 影響: これは B-002 と同じ「表と cursor の組が食い違う」故障で、しかもより静かである。t2 の cursor を持ったまま t1 の先頭から掃き直す（重複だが冪等）ではなく、**t1 を t2 の cursor 位置から掃く**ので、t1 の先頭側が丸ごと落ちる。契約が明示的に言っている節なので、実行形が無いのは ADR 026 / ADR 046 の禁じる状態そのもの。
  - 提案: 「すでに次表まで進んで解放された lane」を staging する専用ケースを 1 本足す。s2 を claim → `advanceOrAck(completed: true)`（t2 へ進む）→ `checkpointLane(table: "t2", cursor: "cursor-77", nextCommandKey: "command-off-rule")` → 解放。そのうえで s1 の最終 ack が返す position が `table: "t2"` / `cursor: "cursor-77"` / `commandKey: "command-off-rule"` であることを見る。既存の 1 本目に混ぜる場合は、`completeLane` が「2 回 ack」を前提にしている（t2 まで進んだ lane には 1 回で足りる）点に注意が要るので、独立した `it` にするほうが安全。

### Warnings

- **[W-001]** `setMaintenanceTables?` を任意フックにしたことで、この Issue の主題である契約 1 だけが「実装しなければ検証されない」節になっている
  - 場所: `packages/core/src/adapters/conformance/backend.ts:138-147`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:420-427`
  - 理由: ケース自体は実効である（memory の `toLane` / step 判定を `run.tables` から `backend.maintenanceTablesByKind[run.kind]` に差し替えると、16 件中このケースだけが落ちる — 確認済み）。問題は、フックを実装しないバックエンドが**契約 1 を一度も検証せずに「適合」と報告できる**こと。CLAUDE.md は「Every backend imports the same suites and must pass them identically」と書いており、任意フックはその例外を作る。前例の `seedMembershipEdges?` は「Workspace ドメインがまだ存在しない」ための一時的な足場で、性質が違う（ドメインができれば消える）。こちらは恒久的な逃げ道になる。
  - なお、逃げ道を塞ぐコストはほぼゼロである。`ConformanceBackendOptions.maintenanceTablesByKind` は既に必須級の前提で、これを無視するバックエンドは ADP-common-027（`lane.table === "t1"`）で落ちる。構築時に表集合を受け取れるバックエンドが構築後に差し替えられない理由は無い。
  - 提案: `setMaintenanceTables` を `ConformanceBackend` の**必須メンバー**にし、スイート側の `ctx.skip()` 分岐を落とす。必須にできない判断をするなら、`seedMembershipEdges?` の前例に合わせて (a) テスト名に条件付きであることの印を付ける（前例は `(seeded backend)` を付けている。今回のケース名には印が無く、名前だけ見て条件付きと分からない）、(b) 戻り型を前例と揃える（前例は `Promise<void>`、今回は `Promise<void> | void`）の 2 点は最低限そろえたい。

- **[W-002]** フックの唯一の実装が、production の `MemoryBackend` の設定レコードを書き換えられることに依存している
  - 場所: `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts:158-163`, `packages/core/src/adapters/memory/store.ts:402`
  - 理由: `backend.maintenanceTablesByKind[kind] = tables` が通るのは、`readonly maintenanceTablesByKind: Record<MaintenanceKind, readonly string[]>` の**プロパティだけが readonly で、レコードの値が可変**だからである。CLAUDE.md の「Adapter classes are fine when they encapsulate a single external resource and keep mutable state internal」／「illegal states unrepresentable」に照らすと、構築時に確定するはずの設定が外から書けるのは意図した affordance には見えない。誰かが型を `Readonly<Record<...>>` に締めた瞬間にフックが壊れ、その時「なぜ締められないのか」が型にも JSDoc にも残っていない。
  - 提案: `MemoryBackend` 側に意図を明示する。設定の差し替えを 1 メソッド（例 `replaceMaintenanceTables(kind, tables)`）として生やし、「run はスナップショットを持つので、これは*次に作られる* run にだけ効く」という why を JSDoc に 1 行置く。フック実装はそれを呼ぶだけにする。

- **[W-003]** 契約 3(b) の書きぶりが「自動 claim された lane」に限定されていて、スイートが `claimLanes` にも同じ拘束を掛けている事実と幅がずれている
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:78-83` / `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:222-227`
  - 理由: ADP-common-028 は解放後の再 claim で `resumedLane.commandKey === "command-2"`（checkpoint 時に渡された規則外の文字列）を拘束している。つまり「既存 position を返すときは再 mint しない」は `claimLanes` にも掛かっている。しかし契約 3(b) は「the store hands back an **existing** position — the auto-claimed lane above —」と自動 claim だけを名指している。見出しの「minted by whichever side created the position」から導けはするが、(b) を字面で読んだ実装者が `claimLanes` で再 mint する余地が残る（幸いスイートが落とすので実害は小さいが、契約と実行形の幅が違うのは ADR 046 が正そうとしている状態そのもの）。
  - 提案: (b) の括弧書きを「the auto-claimed lane above, and every lane `claimLanes` hands back」に広げる。`spec/domains/index.md` の対応文も同じ幅にする。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/di/types.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/platform/index.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`, `.thread/16/plan.md`, `.thread/16/review/triage-keys.md`
- スキップ: `.thread/16/adr.md` — 計画側の判断記録で、正本は `spec/adr/061` / `062` に出ているのでそちらで確認した
- スキップ: `.thread/16/steps.md` — 実装手順の作業記録であり、成果物はコード側で確認した
- スキップ: `.thread/16/testing.md` — 手動動作検証の記録で、ポート契約・適合スイートの観点に無関係
- スキップ: `.thread/16/review/review-001.md` — 前ラウンドのレビュー記録（ゼロベース指示のため参照しない）
- スキップ: `.thread/16/review/review-001-adapter.md` — 同上
- スキップ: `.thread/16/review/review-001-spec.md` — 同上
- スキップ: `.thread/16/review/review-001-usecase.md` — 同上
- スキップ: `.thread/16/review/triage.md` — 前ラウンドの選別結果（既出判定は `triage-keys.md` のみ参照した）

（確認 24 + スキップ 8 = 32）

### 補足（指摘には数えない確認結果）

- **実効だった追加アサーション**: 契約 3(b) の `commandKey` 非再 mint（`"command-off-rule"`）、契約 2 の「解放は `next: null`、他に pending があっても claim しない」（解放後 `claimLanes` が 2 本返る）、「pending が無い ack は `next: null` かつ `runCompleted: false`」（claimed の他 lane を run 完了と誤読する実装を落とす）、「返った position は claimed」（step 後の lane が `claimLanes` に出てこない）、契約 1（`setMaintenanceTables` ケース。表集合を配備設定から引く実装を単独で落とす）。いずれも意図どおり拘束している。
- **memory 実装**: 各分岐が返す lane（step は新 position、自動 claim は永続化済み position、解放と run 完了は `null`）、`commandKey` の再 mint / 非再 mint の振り分け、`MAX_ACTIVE_LANES` の維持（ack は done → claimed で純増しない）、リース失効時の claimed → pending 回収は契約どおり。`toLane` の `MAINTENANCE_LANE_EXHAUSTED` は本 PR 以前からある分岐で、新経路では index 境界チェックにより到達しない。
- **両呼び出し元の `commandKey` 導出**が、ポート JSDoc に新しく明記された規則（`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`）とバイト単位で一致していることを確認した（`pruneExpiredAuthState.ts:70-75` / `deleteAccount/terminalPrune.ts:39-44`）。
- **コード・コメントの残置物**: 弁明や修正経緯にあたる記述は見つからなかった。`releaseLane` の `workRemains = true` が観測できない理由を引き継いだコメント（テスト側）は、計画が明示的に要求した why-not なので残置物ではない。
- **検証手順**: 上記の「実測」はすべて memory アダプターに一時的な変異を入れて `npx vitest run packages/core/src` を回した結果で、確認後にファイルを復元し、作業ツリーがクリーンかつ全件緑であることを確認済み。
