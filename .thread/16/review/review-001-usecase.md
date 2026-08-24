# レビュー 001 — Issue #16 / PR #45

## Use Case / ポート契約

観点: `advanceOrAck` の新しい応答形状と契約 1〜4 の一貫性（JSDoc / memory 実装 / 適合スイート / 全呼び出し元）、`pruneExpiredAuthState` の lane 駆動ループの漏れ・停滞・無限ループ、at-least-once と `commandKey` 重複排除、`terminalPrune` の挙動不変、テストの実効性。

### Blockers

- **[B-001]** AC-6 の「未知表を `failures` に数えない」が、どのテストでも観測されていない（テスト内のコメントは観測していると読める）
  - 場所: `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts:683-685`
  - 理由: TC-identity-349 の fixture は `tables: ["job_tombstones", "sessions"]` で、`sessions` の sweep が成功するため `successes = 1` になる。`SystemError` の発火条件は `failures > 0 && successes === 0`（`pruneExpiredAuthState.ts:432`）なので、**`failures += 1` を元に戻しても TC-identity-349 は緑のまま通る**。つまり AC-6 が名指した「数えたままだと全表未知の run が `SystemError(DatabaseError)` を投げ、DB 障害と区別できなくなる」という退行を、このテストは一切拘束していない。にもかかわらず直前のコメントは「Skipping is not a delete failure: an entirely unknown table set must not read as a database outage.」と、実際には測っていない主張を掲げており、次の読者に「ここで守られている」と誤読させる（アサーションの形骸化）。
    さらに `.thread/16/testing.md` のエッジケース 1 は「`failures` に数えていないことを、**view の `failures` が 0 であること**で主張していること」を確認ポイントに挙げているが、`PruneExpiredAuthStateView` に `failures` フィールドは無い（`view.ts` / `toView` は各表の件数と `continued` のみ）。`failures` は外から観測できないので、**唯一の観測手段は「全表が未知の run で `SystemError` が投げられないこと」**であり、そこを突く fixture が無い限り AC-6 は未検証のまま。
  - 提案: TC-identity-349 に、表集合が**全部未知**の run（例 `tables: ["job_tombstones"]`、lane 1 本）を resume させるケースを 1 つ足す（既存ケースの派生で数行）。`await expect(cron(h)).resolves.toMatchObject({ continued: false })` と、その run が `completed` になること、`isSystemError` な throw が起きないことを assert すれば、`failures += 1` の復活が赤くなる（`successes === 0` になるため）。あわせて 683-684 行のコメントを、実際に測っている主張（`workRemains` を立てない ＝ `continued: false`）と新ケースの主張に合わせて書き直す。`.thread/16/testing.md` の「view の `failures` が 0」も実在しないフィールドを指しているので、同時に直す。

### Warnings

- **[W-001]** 契約 2 の `next: null` の列挙が不完全 — 「lane の最終表を ack したが pending lane が 1 本も無く、run はまだ完了していない」ケースが契約から抜けている
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:57-62`
  - 理由: JSDoc は「Acking a lane's last table auto-claims another pending lane and returns *that lane's persisted position*」と無条件に書き、`next: null` になるのは「解放」と「run 完了」の 2 つだけだと列挙している。しかし memory 実装（`adapters/memory/repositories/globalMaintenanceRunStore.ts:275-303`）には第 3 の経路があり、acked lane を `done` にしたあと pending が無く、かつ他 lane が `claimed` のまま（＝ `runCompleted: false`）なら `{ next: null, runCompleted: false }` を返す。これは 6 lane 並走の cron では**日常的に起きる正常系**（1 invocation が claim した 6 本のうち最初に終わった lane 以外）。
    害は 2 方向にある。(1) 別バックエンドの実装者は、この状態で何を返すべきかを契約から決められない（「auto-claim できないときは？」の答えが無い）。(2) 呼び出し側は列挙をそのまま読むと `next === null ⟹ 解放したか run が終わった` と誤読でき、`runCompleted` を見ずに完了扱いする実装を書ける。適合スイートも `completeLane` が最後の lane で `{ next: null, runCompleted: true }` を assert しているだけで、この第 3 経路を 1 ケースも拘束していない。
    加えて同じ文の「the table and cursor it was released with」は、**一度も claim されていない pending lane**（run 生成時のまま tableIndex 0 / cursor null）を auto-claim する場合を言い当てていない。直前の「*that lane's persisted position*」で足りているので、この従属句が却って狭い。
  - 提案: 契約 2 に 1 文足す — 「`completed: true` で lane の最終表を ack したとき、claim できる pending lane が無ければ `next` は `null` で、`runCompleted` が run 全体の終了を別に答える（`next === null` は run 完了を意味しない）」。同じ状態を適合スイートで 1 ケース拘束する（2 shard を両方 claim した状態で片方を最後まで ack すれば、fixture 追加なしに `{ next: null, runCompleted: false }` が観測できる）。「the table and cursor it was released with」は削って「persisted position」に寄せる。

- **[W-002]** 本 PR の中心主張である契約 1（表順の正本は run 生成時のスナップショットで、resume 中に配備の設定が変わっても動かない）に、実行形（適合ケース）が 1 つも無い
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:47-53`（backend fixture）/ `packages/core/src/application/ports/globalMaintenanceRunStore.ts:48-52`
  - 理由: 適合スイートは `makeBackend({ maintenanceTablesByKind: { authStatePrune: ["t1","t2"] } })` で表集合を**構築時に固定**し、以後変えないまま全ケースを回す。したがって、`advanceOrAck` が「進めた先の表」を run 行のスナップショットから引く実装も、**その都度その配備の設定から引く実装**も、まったく同じように全ケースを通る。つまり plan.md「リスクと注意点」が明示的に警戒した失敗モード（「D1 実装者が『進めた先の表』を配備の設定から引く実装を書き、本 Issue が消したはずの二重正本がバックエンド側で再生する」）に対して、実行形の防具はゼロで、防具は JSDoc と `spec/database/index.md` の散文だけ。ADR 026 が「契約の実行形が適合スイート」と定め、ADR 061 自身が「ポート JSDoc と適合スイートを同時に更新して ADR 046 の状態を作らない」を前提に挙げている以上、契約 1 だけがその原則の外にある。
  - 提案: 現状の `ConformanceBackend` では表集合を run 生成後に差し替えられないので、選択肢は 2 つ。(a) `ConformanceBackend` に「この kind の表集合を差し替える」フックを 1 つ足し、run を begin → 表集合を差し替え → `advanceOrAck` が**元の**集合の順に進むことを 1 ケースで拘束する（契約 1 の直接の実行形になる）。(b) それが重いなら、スイート冒頭 JSDoc に「契約 1 はこのスイートでは実行形を持たない（fixture が表集合を構築時に固定するため）。バックエンド実装者は run 行のスナップショットから表を引くこと」を明記し、拘束の穴を canon 側に見えるようにする。少なくとも (b) は必須。

- **[W-003]** 未知表 skip（ADR 062）が cron 経路にしか無く、継続 turn 側には対応する経路も記述も無い
  - 場所: `packages/core/src/application/identity/pruneExpiredAuthState.ts:154-160`（`runContinuation`）/ `spec/adr/062-unknown-sweep-table-skip.md`
  - 理由: 本 PR 以降、run の表集合には「この配備が sweep を持たない表」が正当に含まれうる（それが ADR 062 の前提）。`runCron` は `isAuthStateTable(lane.table)` で受け止めて ack で飛ばすが、`runContinuation` は同じ状況を扱う経路を持たず、`container.authStateSweeps[input.table].deleteExpired(...)` を直に叩く。`PruneExpiredAuthStateInput.table` が `AuthStateTable` に型付けされているので今日は transport 境界で弾かれるが、その帰結は「継続要求が拒否される（DLQ 行き）」であって「表を飛ばして run を完走させる」ではなく、ADR 062 が主張する効果（原因 1 の解消）は継続経路では成立しない。Queue 配線（Issue #15）が入った瞬間、cron と継続で未知表の扱いが割れる。
    ADR 062 は「決定」でも「影響」でも駆動経路の限定に触れておらず、`pruneExpiredAuthState` の JSDoc の新しい 1 段落（108-109 行）も「A table the run names but this deployment has no sweep for is acked past」と経路を限定せずに書いている。
  - 提案: ADR 062 の「影響」と usecase JSDoc に、この skip が **cron（駆動側）経路の振る舞い**であり、継続 turn は未知表を受け取らない（transport 境界で `AuthStateTable` に閉じている）ことを 1 行明記する。Queue 配線のスライスで「未知表 lane から継続要求を発行しない／発行された場合どう畳むか」を決める必要があることも引き継ぎとして残す。挙動変更は本 Issue のスコープ外でよい。

### 契約・実装・スイートの一貫性（確認できたこと）

- 契約 3(a)（store が新 position を作ったときのキー）: memory は `commandKeyOf(run.runId, stepped, run.tables[stepped.tableIndex])`（`cursor` は `null` にリセット済み）で mint し、適合スイートが `expect(nextTable.commandKey).toBe(commandKeyOf("run-1", nextTable))` で呼び出し側の再導出規則と byte 一致を拘束している。AC-3 は満たされている。
- 契約 3(b)（既存 position の再 mint 禁止）: memory は `nextPending` を `status` だけ変えて `toLane` に通しており、`commandKey` / `cursor` / `tableIndex` は不変。適合スイートが**規則外の文字列** `"command-off-rule"` を checkpoint に仕込んでからその lane を auto-claim させ、`expect(secondShard.commandKey).toBe("command-off-rule")` で再 mint を落とす形になっている。規則内のキーでは検出できない差分を突いており、AC-4 の観測として実効的。Queue 重複排除（checkpoint 時に載せた継続要求のキーと ack で返るキーが同一）の前提は壊れていない。
- 契約 2 の解放側: memory の `completed: false` 分岐は `next: null` 固定、ADP-common-028 が「他方の shard が pending のまま」の状態で `expect(released).toEqual({ next: null, runCompleted: false })` を assert している。AC-8 の振る舞い側は満たされている。
- 返った lane が claimed であること: 3(b) 側は `expect(await store.claimLanes(...)).toHaveLength(0)`、3(a) 側は新設の `ADP-common-029: the position an ack returns is still claimed` が拘束。どちらも「store が pending のまま返した」実装で赤くなる。
- lane 駆動ループの停滞・無限ループ: 未知表 skip は `commands += 1` を必ず消費し、外側 `while` の先頭で `commands >= MAX_COMMANDS_PER_INVOCATION` を検査してから lane を取り出すので、全表未知の run でも 1 invocation 内で有界に終わる。`advanced.next === null` の 3 経路（解放・run 完了・pending 無し）はいずれも `laneQueue` に何も積まず `inFlight = null` に落ちる。budget break と throw の双方で `finally` の一括解放（`generation shardId` で重複排除）が in-flight + 残キューを掃くので、claimed のまま宙に浮く lane は残らない。skip 分岐が `inFlight = null` を ack の**後**に置いている点も、未知表が最終表だった場合に `finally` が done の lane へ解放を打って `MAINTENANCE_LANE_NOT_CLAIMED` を起こす経路を塞いでいる（steps.md ステップ 6 の指摘どおり）。
- リース失効・`MAX_ACTIVE_LANES`: `advanceOrAck` の auto-claim は acked lane を `done` にしてから pending を 1 本 claim するので active 数は増えず、上限 6 は store 側で保たれる。usecase 側が `claimLanes(1)` の往復をやめても上限は維持される。TC-identity-171 の `peakActiveLanes <= 6` が引き続きこれを固定している。
- `terminalPrune` の挙動不変: `advanced.next` は `release()`（`{ generation, shardId }` のみ参照）と `!== null` にしか使われず、`MaintenanceLane` へ広げても構造的部分型で通る。単一表 kind なので `tableIndex + 1 < tables.length` は常に偽で、`advanced.next` は必ず「別 shard の auto-claim」＝即解放という既存の設計どおり。`runContinuation` の `continued: advanced.next !== null` も意味が変わらない。挙動変更なし。
- AC-2: `grep -rn "SWEEP_ORDER" packages apps` は 0 件。表順を持つ配列リテラルの残存も無く、`isAuthStateTable`（順序を持たない述語）と `commandKeyOf`（`checkpointLane` の `nextCommandKey` 用途のみ、シグネチャ不変）だけが残っている。
- AC-7: TC-identity-348 は 8 shard（上限 6 超）で `advanceOrAck(completed: false)` の呼び出し回数を数え `0` を assert しており、解放 → 再 claim の迂回が復活すれば赤くなる。`claimLanes` の回数に依存していないので TC-identity-171 の観測とも干渉しない。
- AC-5: TC-identity-347 は「解放される」ではなく「1 回の cron で `completed`・セッションが実際に消える・claimed 0 件」を主張する形に作り替えられており、既定順と逆順の表集合で `SWEEP_ORDER_HINT` 相当の実装が復活すれば（`identity_removal_receipts` の次を名指せず）赤くなる。
- 解放失敗テストの載せ替え: `checkpointLane` throw に `advanceOrAck(completed: false)` throw を重ねる形で、元の throw が勝つ / 解放失敗はログ / lane 4 本が claimed のまま、を保っている。`releaseLane` の `workRemains = true` が観測できない理由もコメントに引き継がれており、デッドコードとして消される事故を防いでいる。plan.md「テストを黙って削らない」の要求を満たしている。
- セキュリティ: 新設の error ログ payload は `table` / `runId` / `generation` / `shardId` のみで、cursor（`login_attempts` の keyset に利用者識別子が乗りうる）や秘匿値を含まない。認証・認可面の変更なし（ワーカー経路で外部入力を受けない）。継続入力の検証境界（`AuthStateTable` union）も変更なし。
- パフォーマンス: 別 shard auto-claim ごとの「解放 + `claimLanes(1)`」の往復 2 回が消え、N shard の run で最大 N-6 回のラウンドトリップ削減。lane を横取りされる窓も閉じる。N+1 や不要な再計算の混入は無い。
- スコープ: plan.md「含まれないもの」への越境なし。`terminalPrune` の `TABLE` 定数、`checkpointLane` の `nextCommandKey`、`releaseLane` の `workRemains` / 警告ログ、`AuthStateTable` union / `authStateSweeps`、起動時ドリフトガード、cron 配線はいずれも未変更。`spec/usecases/identity.md` の改訂も「本 Issue が偽にする文」（手順 2 とエラーケース表）に限定されており、`identityRemovalReceipts` 欠落や他の「4 種」表記には手を入れていない。
- 残す必要のない記述: コード・コメント・JSDoc に指摘への弁明や修正経緯の痕跡は見当たらない。`.thread` ローカルの ADR 番号がコード側から引かれていないことも確認済み（引かれているのは `spec/adr/061` / `062` のみ）。

### カバレッジ

- 確認: `.thread/16/plan.md`, `.thread/16/adr.md`, `.thread/16/steps.md`, `.thread/16/testing.md`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`
- スキップ: なし
