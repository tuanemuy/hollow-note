# レビュー 001 — Adapter / 適合スイート

## Adapter / 適合スイート

memory 実装そのものは新契約を正しく満たしている。`advanceOrAck` の 3 分岐（解放 / 同一 lane の次表 / 別 shard 自動 claim）はいずれも `toLane(run, row)` を通して run のスナップショットから position を組み立てており、次表分岐だけが `commandKeyOf` で再 mint し、自動 claim 分岐は `nextPending.commandKey` をそのまま持ち越す。claimed 状態の遷移も cap（`MAX_ACTIVE_LANES`）を破らない。指摘はすべて**適合スイート側の拘束力**と**ポート JSDoc と適合スイートの対応の粗さ**に集中している。

以下の Blocker / Warning のうち B-001・W-001 は、memory 実装に変異を入れてスイートが緑のままであることを実際に確認している（確認後、作業ツリーは元に戻してある）。

### Blockers

- **[B-001]** ADP-common-029 が、別 shard 自動 claim で返る lane の `asOf` を検証していない。AC-8 が両分岐について `table` / `cursor` / `asOf` / `commandKey` の検証を要求しているのに、`asOf` は同一 lane の次表分岐（`expect(nextTable.asOf).toEqual(lane.asOf)`）にしか無い。
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:292-301`
  - 理由: 自動 claim 分岐は「永続化済みの行を読み直して返す」経路で、`asOf` を run 行から引かずにその場の時刻で埋める実装がもっとも起きやすい場所にあたる。実際に memory 側で `return { next: { ...toLane(run, claimed), asOf: new Date(0) }, runCompleted: false }` と変異させても、`GlobalMaintenanceRunStore conformance` 12 件は全緑のまま通った。run の `asOf` は「resume しても保持境界がずれない」という設計の要（`beginOrResumeKind` が最古の `asOf` を返す既存契約と対）であり、ここが lane 単位でずれると、この lane から作られる継続要求が別の境界で sweep を回す。現在の 2 つの呼び出し元がどちらも `begin.asOf` を使っていて `next.asOf` を読まないため、usecase テストでも検出されない — スイートだけが唯一の防具になる。
  - 提案: `expect(secondShard.asOf).toEqual(lane.asOf);` を 1 行足す。あわせて `expect(secondShard.generation).toBe(lane.generation);`（同一 generation・別 shard であることの明示）も入れておくと、`shardId` だけの `not.toBe` より意図が読める。

### Warnings

- **[W-001]** 契約 1（表順の正本は run 生成時のスナップショットで、resume 中に配備の設定が変わっても動かない）に実行形が無い。ADR 061 が「これを書かないと D1 実装者が配備の設定から表を引き、二重正本がバックエンド側で再生する」と名指した失敗モードが、スイートを 1 件も落とさずに通る。
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:48-52` / `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:22-38`
  - 理由: memory 側で `toLane` の `run.tables[lane.tableIndex]` を `backend.maintenanceTablesByKind[run.kind][lane.tableIndex]` に変異させても 12 件全緑だった。つまり本 Issue の主張そのもの（進める権威は run の 1 本）は、現状 `spec/database/index.md` の散文にしか無い。CLAUDE.md の「契約に振る舞いを足すならポート JSDoc と conformance の両方を触る」に対して、契約 2 / 3 / 4 は対で入っているのに契約 1 だけが片肺になっている。plan の AC-9 が記述先を spec/database に割り当てているのは理解できるが、ADR 046 が禁じる形（解釈が割れる余地）が正本の側に残る。
  - 提案: 現在の `ConformanceBackend` は `seedMembershipEdges?` で「バックエンドが対応できなければスイートがそのケースを飛ばす」任意フックの前例を持っている。同じ形で任意フック（例: `setMaintenanceTables?(kind, tables): Promise<void> | void`）を足し、「run を begin → 配備の表集合を差し替え → 同じ run を resume して ack すると、返る `table` は**古い**集合から来る」1 ケースを置くのが素直。フックを増やさない選択を採るなら、せめて適合スイートの JSDoc に「契約 1 はこのスイートでは拘束できない — 表集合の固定性は実装レビューで確認すること」と明記して、別バックエンド実装者が「スイートが緑＝契約を満たした」と読まないようにしてほしい。

- **[W-002]** 契約 3(a) の書き方が、適合スイートが実際に拘束している範囲より狭い。加えて、ADP-common-029 の fixture 追加によって「一度も checkpoint されていない lane を自動 claim する」経路の被覆が入れ替わりで消えた。
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:64-70` / `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:134-140, 235-258`
  - 理由: 契約 3(a) は store が新しい position を作る場合として「stepping a lane to its next table」だけを列挙しているが、run 生成時に作られる position も store が作ったものであり、ADP-common-027 の `expect(lane.commandKey).toBe(commandKeyOf("run-1", lane))` はまさにそれを拘束している。契約に書かれていない拘束がスイート側にある = 本 Issue が塞ぎに来た「実行形にしか無い契約」の逆向きの例。さらに、今回の staging（s2 を claim → checkpoint → 解放してから自動 claim させる）によって、変更前に ADP-common-029 が偶然覆っていた「virgin な lane（`beginOrResumeKind` が mint したキーを持つ pending lane）が自動 claim で返る」ケースが無くなった。ADP-common-031 は 6 本を先に claim してしまうので自動 claim を通らず（コメントにもそう書いてある）、いま virgin lane の自動 claim を通る適合ケースは 1 件も無い。TC-identity-348 が示すとおり、実運用で自動 claim されるのは大半がこの virgin lane のほうである。
  - 提案: 契約 3(a) の主語を「store が position を作ったとき（run 生成時の初期 position と、lane を次表へ進めた position の両方）」に広げる。スイート側は、既存の staged ケースを残したまま、virgin な lane が自動 claim で返るケース（3 shard 構成にする、または staged を作らない別ケースを 1 件足す）で `commandKey === commandKeyOf(runId, next)` と `cursor === null` を拘束すると、3(a) と 3(b) の境目が両側から固定される。

- **[W-003]** 契約 2 の「`next` が null になる場合」の列挙が不完全で、その抜けた場合を拘束する適合ケースも無い。
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:54-62` / `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:416-431`
  - 理由: JSDoc は「解放と run 完了が `next: null`」と書き、ack については「Acking a lane's last table auto-claims another pending lane」と無条件に読める形で書いている。しかし実際にはもう 1 つ、**pending lane が無いが他の lane がまだ claimed で run は未完了**という場合があり、memory はここで `{ next: null, runCompleted: false }` を返す。この戻り値は両呼び出し元にとって load-bearing で、`pruneExpiredAuthState.runCron` はこれを `laneDone` の判定に、`terminalPrune` は `continued` の判定に使っている。にもかかわらず、ack から `{ next: null, runCompleted: false }` が返ることを観測する適合ケースは 1 件も無い（ADP-common-031 の `completeLane` は戻り値を捨てており、コメントで「`next` never re-claims here」と述べているだけ）。別バックエンドが `runCompleted` を「pending lane が無くなったか」で計算すると、他 owner の lane が claimed のまま run が completed になる — 現状これは ADP-common-031 が後続の `completeLane` で ConflictError を踏んで**偶然**落ちるだけで、意図した拘束にはなっていない。
  - 提案: 契約 2 に「引き渡せる pending lane が無いときも `next` は null で、その場合 `runCompleted` は**全 lane が done か**で決まる（claimed が残っていれば false）」を 1 文足す。スイートには、2 本とも先に claim した状態で 1 本目の最終表を ack し `{ next: null, runCompleted: false }` を等値で拘束するケースを 1 件（ADP-common-029 として）足す。ADP-common-031 の fixture がそのまま使えるので追加の作り込みは要らない。

- **[W-004]** `advanceOrAck` の契約（解放は position を返さない）の実行形が、ADP-common-028（`checkpointLane` のケース）の中に置かれている。
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:207-219`
  - 理由: `spec/inventory/adapter.md` は ADP-common-028 を「cursor と次 command key を原子的に checkpoint する」、ADP-common-029 を「lane を進め、進めた先の position と shard / run 完了を返す」と定めており、台帳が本文からの生成物である（ADR 052 / 058）以上、行の主張と実行形の置き場所はそろっているべき。plan の AC-8 も「ADP-common-029 が …（中略）… あわせて解放が `{ next: null, runCompleted: false }` を返すことを 1 ケースで拘束し」と、置き場所を 029 に指定している。いま「解放が新しい lane を claim しない」という契約の執行形を探す別バックエンド実装者は、ADP-common-029 を読んでも見つけられない。
  - 提案: アサーションを ADP-common-029 側のケースへ移す（テスト方針が言うとおり fixture の作り込みは要らない — W-003 で足すケースか、既存の 029 で staged lane を解放している箇所の戻り値を拘束すれば同じ観測が得られる）。028 に残すなら、`it` のタイトルに 029 の ID も併記して台帳との対応を切らないこと。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `spec/inventory/adapter.md`, `spec/domains/index.md`, `spec/database/index.md`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `.thread/16/plan.md`, `.thread/16/adr.md`
- スキップ: `.thread/16/steps.md` — 実装手順書で、契約と実行形の対応は plan / adr / 実コードで判定できるため
- スキップ: `.thread/16/testing.md` — 手動動作検証の記録で、ポート適合の観点に関わらないため
- スキップ: `spec/adr/index.md` — ADR 索引行と前提依存マップの追記のみで、アダプター契約の内容を持たないため
- スキップ: `spec/inventory/domain.md` — DOM 行の文言更新のみで、ADP 行（`spec/inventory/adapter.md`）側で同じ主張を確認済みのため
- スキップ: `spec/inventory/test.md` — TC 台帳行で、テスト観点のレビュー担当のため
- スキップ: `spec/inventory/usecase.md` — UC 行の文言更新のみで、ユースケース観点のレビュー担当のため
- スキップ: `spec/testcases/identity/pruneExpiredAuthState.md` — usecase のテストケース定義で、ポート適合ケース（ADP 行）を含まないため
- スキップ: `spec/usecases/identity.md` — usecase の処理フローとエラーケースで、ユースケース観点のレビュー担当のため
