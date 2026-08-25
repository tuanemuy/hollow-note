# ADR — Issue #16: 保守スイープの表順が二重正本になっている

昇格対象（`spec/adr/` へ起票するもの）: ADR-001 → 061、ADR-002 → 062。
昇格しないもの:

- ADR-003 — 結論が「新設しない（既に成立しているため）」で canon として拘束するものが無い。非自明で読者を助ける一点（`MaintenanceLane.generation` は routing 世代であって表構成の世代ではない）は `MaintenanceLane` 型の JSDoc 1 行で伝わるので、ADR 一覧と前提依存マップの面積に見合わない。昇格の要否は Phase 7 の昇格ゲートで判定する。
- ADR-004 — ADR-001 の契約 3 に畳んだため独立した判断として残らない。
- ADR-005 / ADR-006 — 本 Issue で扱わない残存条件で、記述場所はコードのコメントと usecase JSDoc。

なお `.thread` は canon ではなく実際に掃除されるので、**ここの ADR 番号（ADR-001..006）をコードのコメントや JSDoc から引かない**。昇格したものだけ `spec/adr/061` / `062` として引く。

## ADR-001: 表順の正本を run のスナップショットに一本化し、`advanceOrAck` が進めた先の position を返す

### Context

保守スイープの表順は 2 か所にある。`GlobalMaintenanceRunStore` が run 生成時に固定する `run.tables`（lane は `tableIndex` で位置を持つ）と、`pruneExpiredAuthState.ts` の `SWEEP_ORDER_HINT` 定数。両者が独立しているため、表構成を変えるデプロイをまたいで run を resume すると順序がずれ、hint が次の表を名指せない状態（`nextTable === undefined`）になる。

根本原因は定数の存在そのものではなく、**ポートの応答形状**にある。`advanceOrAck` は lane を進める操作でありながら、進めた先を `next: { generation, shardId } | null` としてしか返さない。呼び出し側は「同じ lane の次の表は何か」を自力で名指す必要があり、そのために 2 本目の正本が生まれた。同じ欠落は別の迂回も生んでいる — 別 shard が自動 claim されて返ってきたとき、その表 / cursor / commandKey が応答から読めないため、usecase はいったん `advanceOrAck(completed: false)` で解放して `claimLanes(1)` で取り直している（往復 2 回と、その間に他ワーカーへ取られる窓）。

選択肢:

- (a) `advanceOrAck` の `next` を `MaintenanceLane`（`generation` / `shardId` / `table` / `cursor` / `asOf` / `commandKey`）にする
- (b) `beginOrResumeKind` が run の `tables` を返し、usecase は hint の代わりにそれで次表を名指す
- (c) `describeLane(runId, generation, shardId)` のような読み取りをポートに足し、ack 後に位置を引き直す
- (d) 現状維持（Issue #1 の暫定対応のまま、二重正本を残す）

### Decision

(a) を採る。`advanceOrAck` の応答を `{ next: MaintenanceLane | null; runCompleted: boolean }` にし、`SWEEP_ORDER_HINT` を廃する。ポート JSDoc に次を契約として書く。

1. 表の走査順は **run 生成時に固定した順序付きの表集合**が唯一の正本。run 行はその集合を持ち、lane の position はその集合へのインデックスであって、resume 中に配備の設定が変わってもこの集合は動かない。呼び出し側は表順を持たない。
2. `advanceOrAck` は進めた先の lane を position ごと返す。同一 lane の次表へ進んだ場合の `cursor` は `null`（新しい表は先頭から）。別 shard を自動 claim した場合は、その lane の**永続化済みの位置**（解放済み lane が保持していた表と cursor）をそのまま返す。**`completed: false`（解放）のときと run が完了したときは `next` が必ず `null`** — 解放は lane を pending に戻すだけで、他に pending な lane があっても新しい lane を claim しない。
3. `commandKey` は **position を作った側が mint する**。
   - (a) store が**新しい position を作った**とき（同一 lane を次表へ進めたとき）に返す `commandKey` は、その position から呼び出し側が導けるキー（`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`）と一致する。
   - (b) store が**既存の position を返す**とき（別 shard の自動 claim）は、その lane に永続化されている `commandKey` をそのまま返す。store は再 mint しない。その値の出どころは呼び出し側が `checkpointLane` に渡した `nextCommandKey` であり、規則を知っているのは呼び出し側だからである。
4. `next` が非 null のとき、その lane は claimed である。**lane を駆動する呼び出し側**（cron 経路）は、それを処理するか解放する責務を負う。単発の継続 turn については ADR-006。

(b) を採らない理由: 表順の「データ」は 1 本になるが、**歩き方の実装が store と usecase の 2 か所に残る**。`tableIndex + 1` を進めるのは store で、次表を名指すのは usecase、という分担が続くかぎり、両者がずれる余地は消えない。正本を 1 つにするとは「進める権威が 1 つ」であることで、順序の配列を配ることではない。加えて (b) は別 shard 自動 claim の迂回を残す。

(c) を採らない理由: ack のたびに往復が 1 回増え、ack と読み取りの間に lane の状態が動きうる。進める操作が結果を返せば足りるところに、新しいポート面を増やす。

(d) を採らない理由: Issue の対象そのもの。

### Consequences

- 良い点: 表順の正本が run のスナップショット 1 本になる。`SWEEP_ORDER_HINT` と、hint が次表を名指せないときの暫定分岐（Issue #1 の応急処置）がまとめて消える。
- 良い点: 別 shard 自動 claim の「解放 → 再 claim」の迂回が消え、往復 2 回と lane を横取りされる窓が無くなる。
- 良い点: 表構成を変えるデプロイをまたいだ resume で、位置は常に store 側の 1 本の権威から来る。デプロイ境界が lane の進行に影響しない。
- トレードオフ: ポートの応答形状の変更なので、全バックエンドに課される要件になる（現状は memory のみ。Issue #11 の D1 実装が同じ契約を負う）。ポート JSDoc と適合スイートの両方を同時に更新して、ADR 046 の「JSDoc とスイートで解釈が割れる」状態を作らないことが前提。
- トレードオフ: 契約 1 は応答形状より重い**スキーマ要件**を全バックエンドに課す — run 行が「生成時に固定した順序付き表集合」を持つこと。`spec/database/index.md` の `global_maintenance_runs` は現在 generation / shard ごとの position・table・cursor しか定めておらず、run レベルの表集合が無い。ここを書かないまま契約だけを足すと、D1 実装者は「進めた先の表」を advance 時に**配備の設定から**引くしかなく、本 Issue が消したはずの二重正本がバックエンド側で再生する（resume 中の順序ずれも戻る）。spec/database の改訂を本 Issue の必須作業に含める。改訂は表集合を**足すだけ**にしない — 同じ行が lane 側に独立した「table」列を並べているため、足すだけでは「lane が表名を持つ」と「lane は集合へのインデックスを持つ」が同じ文に併存し、スキーマ canon の側で二重表現になる。**lane が持つのは run の表集合への position（インデックス）であり、表名は `run.tables[position]` から導出される読み取り面の値**（memory の `MaintenanceLaneRow.tableIndex` / `toLane` と一致する）と決め切ったうえで書く。
- トレードオフ: 契約 3 を (a) / (b) に分けないと、契約 2（既存 position をそのまま返す）と両立しない。既存の適合ケース ADP-common-028 は `nextCommandKey: "command-2"` という規則外の文字列を checkpoint に渡しており、その lane が自動 claim されれば「導出キーと一致する」は偽になる。分けずに書くと、D1 実装者が自動 claim 時にキーを再 mint し、**checkpoint 時に Queue へ載せた継続要求のキーと食い違って重複排除が畳めなくなる**。既存の ADP-common-027「a lane's commandKey matches the key its position re-derives」も store が mint した lane にしか適用していないので、この分割が既存の canon と整合する。
- トレードオフ: 契約 4（返った lane を処理か解放する責務）は義務だけを書くので、契約 2 に**解放時は `next` が null** を明記しないと片側に穴が残る。リポジトリ内の解放呼び出しは 3 か所（`releaseLane` 経由の `finally` 一括解放、sweep 失敗と budget 枯渇の直接呼び出し、`terminalPrune.release`）とも戻り値を捨てており、適合スイートも `completed: false` の戻り値を拘束していない（ADP-common-027 / 028 とも無視）。つまり「解放は次の lane を claim しない」は現在どこにも書かれていない実装依存の前提である。D1 実装者が「解放は capacity を空けるので次の pending を返してよい」と読めば、返った lane は claimed になり全呼び出し元がそれを捨てるため、**リース失効まで誰も駆動しない lane** が生まれる — 本 ADR が塞ぎに来た漏れ経路そのもので、しかも memory バックエンドしか観測しない usecase テストでは検出されない。契約 2 の 1 文と適合スイートの 1 ケースを対で入れる（CLAUDE.md「契約に振る舞いを足すならポート JSDoc と conformance の両方を触る」）。
- 引き継ぎ: 返った lane に対する方針は、同じポートの 2 つの呼び出し元で**正反対になる**。`pruneExpiredAuthState.runCron` は返った lane をそのまま処理し続ける（表が複数あり lane あたりの仕事が小さく、chain したほうが往復が減る）。`terminalPrune.runCron` は単一表 kind で 1 invocation の予算を claim した 6 lane に閉じているため、自動 claim された lane を即座に解放して返す。どちらも妥当だが、根拠を残さないと将来「片方に揃える」リファクタで静かに壊れる。**この引き継ぎは昇格先の `spec/adr/061` の「影響」節へそのまま持ち込む**（`.thread` は canon ではないので、要約に畳んで落とすと根拠が canon から消える）。
- トレードオフ: `next` が claimed な lane を指すという責務が、応答形状から読み取りにくくなる（`MaintenanceLane` 単体には状態が出ない）。JSDoc の契約 4 で明示して補う。`claimLanes` の戻り値も同じ性質なので、新種の責務ではない。

---

## ADR-002: この配備が sweep を持たない表は ack で飛ばす

### Context

`SWEEP_ORDER_HINT` を廃しても、「表構成を変えるデプロイをまたいだ resume」の残り半分が残る — run のスナップショットが、この配備には sweep の無い表を名指しているケース（表が**減る**デプロイ）。現在の `pruneExpiredAuthState` は `isAuthStateTable(lane.table)` が偽のとき lane を `advanceOrAck(completed: false)` で解放し、`failures += 1` と `workRemains = true` を立てる。漏れ（lane が claimed のまま残る）は起きないが、次の cron も同じ lane を取って同じ判定に戻るため、**その run は永久に完走しない**。`beginOrResumeKind` は running run がある限り新 run を作らないので、以後この kind のスイープ全体が止まる。

ただし「この配備が sweep を持たない表」の原因は 1 つではない。

1. **デプロイ境界越えの resume** — 旧い表集合で作られた run を、表を減らした配備が resume した。次の run はこの配備の表集合で作られるので、この表は 1 run 分で現れなくなる。
2. **同一配備内の表集合ドリフト** — `run.tables` の供給元（`MemoryBackendOptions.maintenanceTablesByKind`、型は `readonly string[]` と緩い）と sweep の供給元（`authStateSweeps: Readonly<Record<AuthStateTable, ExpirySweep>>`）は別レジストリで、同じ配備の中でもずれうる（表名を `DEFAULT_MAINTENANCE_TABLES` に足して `AuthStateTable` に足し忘れる、綴りを誤る）。この場合、**次の run にも同じ表が現れる**。

skip だけを入れると 2 の帰結が変わる。現在は「うるさい故障」（run が止まる）だったものが、**恒久的に、静かに、掃かれない表**になる — `identity_removal_receipts` の 30 日保持を含む期限切れ認証状態が、error ログを誰も見ていなければ永久に回収されない。`AuthStateTable` の JSDoc はまさにこの失敗モードを名指して union を置いている（"this union is what makes a missing registration a type error rather than a table that is never collected"）。skip を入れるということは、その union が型で捕まえていた失敗を実行時の静かな取りこぼしへ戻すことを意味する。

選択肢:

- (a) `advanceOrAck(completed: true)` で表を飛ばして前進させる（原因 1 / 2 を区別しない）
- (b) 現状どおり解放して停滞させ、運用が気づいて手で run を消す
- (c) 未知表を検出したら run 全体を失敗させる（`SystemError`）

### Decision

(a) を採る。未知の表は error ログに記録したうえで `advanceOrAck(completed: true)` で前進させ、返った lane を通常どおり処理キューに載せる。`failures` には数えない。ack 1 回を 1 command として予算に数える。

ログ payload は `table`（飛ばした表名）に加えて `runId` / `generation` / `shardId`。変更後、このログが「その run でその表が掃かれなかった」唯一の痕跡になる。**run の表集合は載せない** — usecase が run について知れるのは `beginOrResumeKind` の戻り値 `{ runId, asOf, result }` と lane だけで、表集合を返すポートメソッドは無く、足すことは ADR-001 が棄却した選択肢 (b)（表集合を呼び出し側へ配る）に戻ることを意味する。飛ばした表名と run / lane の特定子があれば痕跡としては足り、run の表集合は `runId` から後で引ける。

`failures` に数えない理由: 「削除の失敗」ではないため。数えると、表集合が全部未知の run が `failures > 0 && successes === 0` の条件に当たって `SystemError(DatabaseError)` を投げ、DB 障害と区別できなくなる。

原因 1 と原因 2 を実行時に区別しない。区別できる情報が lane にも run にも無く、区別しても取りうる行動（掃く手段が無い表を飛ばす）は同じだからである。原因 2 が残す穴は下の残存条件に書く。

### Consequences

- 良い点: **原因 1（デプロイ境界越えの resume）は解消する。** 表が減るデプロイをまたいでも run が完走し、次の run はこの配備の表集合で作られるので、停滞は 1 run 分で自然に消える。本 ADR が主張する効果はここまで。
- 良い点: 未知表を検出したときに「掃けないのに止める」という無意味な状態を作らない。この配備には掃く手段が無いので、run を止めても行は掃けない。
- トレードオフ: 飛ばした表の行は、その run では掃かれないまま run が `completed` になる。ただし掃く手段が無い以上、これは (b) でも同じで、(a) は停滞を足さないぶんだけ良い。
- **残存条件（原因 2 は解消しない）**: 同一配備内で `maintenanceTablesByKind` と `authStateSweeps` がずれた場合、その表は次の run にも現れる。skip を入れる前は「うるさい故障」（run が止まる）だったものが、**恒久的に、静かに、掃かれない表**になる — error ログを誰も見ていなければ、期限切れ認証状態が永久に回収されない。これは `AuthStateTable` の union が型で捕まえていた失敗モード（"a table that is never collected"）を実行時の静かな取りこぼしへ戻すことを意味する。本 ADR はこれを**解決しない**。
- 残存条件を本 Issue で塞がない理由: 塞ぐ手段は composition root の起動時検査だが、参照ランタイムではこの配備を作れない（`maintenanceTablesByKind` は `MemoryBackendOptions` のオプションで、`nodeServerEnvToRuntimeOptions` は `oauth` と `deletionTicketKeyRing` しか返さないため、本番経路は常に `DEFAULT_MAINTENANCE_TABLES`）。到達不能な失敗モードに対して composition root の持ち分・述語の export・新規テストファイル・将来の全バックエンドへの引き継ぎを足すのは、本 Issue（`run.tables` を唯一の正本にする）の主張に対して重い。ガードを入れるなら別 Issue で、その配備が現実に作れるようになる時点（環境変数から表集合を渡す、バックエンドが増える）と合わせて判断する。
- トレードオフ: 表集合が全部未知なら、lane は表数ぶん ack を繰り返してから done になる。予算に数えることで 1 invocation 内で無制限に回ることは防ぐが、run 完走までの invocation は増えうる。表数は高々数個なので実害は無い。
- (c) を採らない理由: 未知表は障害ではなく配備の状態で、`SystemError(DatabaseError)` の意味（DB 障害）と衝突する。エラーの種別を曖昧にする。

---

## ADR-003: run に明示的な世代（generation）列を新設しない

### Context

Issue は検討の方向として「表構成の変更を run の世代（generation）で表現し、旧世代の run は完走させてから新世代へ移す」を挙げている。`MaintenanceRun` に世代列を足し、表集合が変わったら世代を上げる案。

### Decision

新設しない。この振る舞いは**既に成立している**ため。

- `beginOrResumeKind` は kind ごとに running run を 1 つだけ許し、完了後にだけ candidate run を新規作成する。つまり「旧世代の run を完走させてから新世代へ移す」は現行の規則そのもの。
- `MaintenanceRunRow.tables` は run 生成時のスナップショットで、resume してもこの run の表集合は動かない。表構成のバージョンは run 自身が持っている。

したがって世代列は、同じ事実を 2 つ目の場所に書くことになる — 本 Issue が解消しようとしている二重正本と同じ構造。

なお `MaintenanceLane.generation` は**別のもの**で、UserId ルーティングの reshard 世代（`WorkerContainer.routingGenerations` 由来、旧新を別 lane として処理する）。表構成の世代ではない。同じ語を 2 つの意味で使うと混同を招くので、この点でも表構成の世代という語を持ち込まない。

### Consequences

- 良い点: ポートのデータモデルが増えない。表構成の版は run の同一性そのもの（`run.tables` のスナップショット）で表され、二重に持たれない。
- 良い点: `generation` という語が routing 世代の意味だけを保つ。
- トレードオフ: 「この run はどの表構成で始まったか」を運用が知りたいとき、明示的な版番号ではなく `run.tables` の中身を読むことになる。表集合そのものが答えなので情報は失われない。
- トレードオフ: 表構成を変えたデプロイの直後は、旧構成の run が完走するまで新構成での掃除が始まらない（最大でリース長 + run 完走まで）。これは現行の「running run は 1 つ」の帰結で、世代列を足しても変わらない。
- 昇格しない理由: 決定の中身が「新設しない（既に成立しているため）」で、canon として拘束するものが無い。非自明で読者を助けるのは `MaintenanceLane.generation` が routing 世代であって表構成の世代ではないという一点だけなので、記述先は `MaintenanceLane` 型の JSDoc 1 行にする。ADR 一覧と前提依存マップに 2 行を足す面積には見合わない。昇格の要否は Phase 7 の昇格ゲートで判定する。

---

## ADR-004: `checkpointLane` の `nextCommandKey` は呼び出し側 mint のまま残す

### Context

Queue の重複排除キー（`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`）は、store（lane 生成時 / 表 advance 時）と呼び出し側（checkpoint 時）の両方が mint する。ADR-001 で `advanceOrAck` が返す lane にも commandKey の契約を広げるなら、`checkpointLane` の `nextCommandKey` も store 側の mint に寄せて入力から落とす案がありうる。

### Decision

寄せない。`nextCommandKey` は入力のまま残す。

checkpoint は「次にどの cursor から続けるか」を呼び出し側が決める操作で、cursor が呼び出し側から来る以上、その position から導けるキーも呼び出し側が持っている。store 側に寄せると、store は「渡された cursor からキーを作る」だけになり、責務は増えるのに正本は 1 本にならない（cursor の権威は依然として呼び出し側）。

ADR-001 の契約 3 を (a) / (b) に分けたことで、この分担は例外ではなく規則になった — **position を作った側がその position のキーを mint する**。store が新しい position を作れば store が mint し、呼び出し側が cursor を決めれば呼び出し側が mint し、store は既存 position のキーをそのまま返す。したがってこの判断は ADR-001 の契約 3 の一部であり、独立した ADR として `spec/adr/` へ昇格させる必要はない。

### Consequences

- 良い点: 本 Issue の変更が「進める操作が進めた先を返す」という 1 つの主張に収まり、レビュー可能な大きさに保たれる。
- 良い点: キー生成規則が 2 か所に残ることが、恣意的な重複ではなく「position を作った側が mint する」という 1 本の規則の帰結として説明できる。
- トレードオフ: 規則の食い違いはテストでしか検出されない。適合スイートが store 側の mint と呼び出し側の再導出の一致（ADP-common-027 / 029）を拘束し続けることが前提（`adapters/conformance/globalMaintenanceRunStore.ts` の `commandKeyOf`）。
- 引き継ぎ: 将来 Queue 側の重複排除設計を触るときは、この分担を先に決める。

---

## ADR-005: ADR-039 の残存条件（`PRUNE_LEASE_OWNER` がプロセス定数）は本 Issue で扱わない

### Context

`.thread/1/adr.md` の ADR-039 が受容した残存条件 — `PRUNE_LEASE_OWNER` がプロセス定数のため、プロセスが生き続けるかぎり自分の cron がリースを延長し続け、`releaseLane` に失敗した lane はリース失効回収の二段目に拾われない。Issue #16 の本文は「同じ領域にある」としつつ「恒久対策は cron まわりの設計とセットで検討するのが妥当」と明示している。

### Decision

本 Issue では扱わない。`releaseLane` の失敗時に `workRemains = true` を立てて報告を正直に保つ現在の実装をそのまま残す。

### Consequences

- 良い点: 本 Issue の変更は「表順の正本」に閉じ、cron / リース所有者の設計という別軸の判断を巻き込まない。
- 副次的な改善: `releaseLane`（解放失敗をログに落として `workRemains` を立てるヘルパー）を通る経路は、現在の 2 つ（hint が名指せないときの解放、`finally` の一括解放）から**`finally` の一括解放 1 つ**に減る。未知表・sweep 失敗・budget 枯渇の解放はいずれも `releaseLane` ではなく `advanceOrAck` の直接呼び出しで、失敗すれば throw する経路であり、この残存条件を通らない。残存条件が顕在化する機会自体は減るが、条件そのものは消えない。
- 引き継ぎ: 恒久対策（解放失敗時の明示的なリース放棄、または解放専用の再試行）は cron 配線のスライスで扱う。本 Issue のテストは、この条件が**残っている**ことを引き続き固定する（解放失敗時に lane が claimed のまま残ることを検証するテストを残す）。

---

## ADR-006: 返った lane を処理するか解放する責務は、lane を駆動する呼び出し側に限る

### Context

ADR-001 の契約 4 を「`next` が非 null なら呼び出し側が処理するか解放する」と無条件のポート義務として書くと、その瞬間にリポジトリ内へ契約違反の呼び出し元が 2 つ生まれる。

- `pruneExpiredAuthState.ts` の `runContinuation`（182-189 行）— `advanceOrAck(completed: true)` の結果を `advanced.next !== null` として `continued` に畳むだけで、返った lane を処理も解放もしない。
- `deleteAccount/terminalPrune.ts` の `runContinuation`（123-130 行）— 同じ形。

現在のポート JSDoc はこの責務を書いていないので「未記述の既知挙動」で済んでいるが、契約側に書けば「実装が契約違反」と読めてしまう。ADR 046 が禁じた「契約の記述が実行形にしかない」の裏返しで、害は同じ（Issue #11 の D1 実装者が、契約と呼び出し元のどちらが正しいか判断できない）。

事実確認: この advance 分岐を観測しているテストは無い。TC-identity-174 が固定しているのは同じ `runContinuation` の **`checkpointLane` 側**の分岐（150 件を 100 件で切って cursor を残す）であって、この分岐ではない。また `identity.authStatePruneContinued` / `identity.accountDeletionManifestPruneContinued` を enqueue する producer はリポジトリに存在せず（grep 0 件）、テストが直接呼ぶ経路しかない。したがって現時点で実害のある滞留は起きていない。

選択肢:

- (a) 契約 4 の主体を「lane を駆動する呼び出し側」に限定し、継続 turn の扱いを usecase JSDoc に残す
- (b) 契約 4 はそのままにし、継続分岐を「Queue 配線が入るまでの残存条件」として記録する
- (c) 両 `runContinuation` に解放を足して契約 4 を無条件に満たす

### Decision

(a) を採る。契約 4 を「`next` が非 null のとき、その lane は claimed である。**lane を駆動する呼び出し側**（cron 経路）は、それを処理するか解放する」と主体を限定して書く。単発の継続 turn は返った lane を claimed のまま次の継続へ引き渡す設計であり、その選択と現状（引き渡す先の producer が無いため lane は滞留し、リース失効回収で戻る）を両 usecase の JSDoc の Runtime wiring note に 1 行ずつ残す。

(b) を採らない理由: 契約文が実装より広いままになる。読む側は「違反している実装がある」と受け取るしかなく、D1 実装者がどちらに合わせるべきかが決まらない。残存条件として書けるのは実装の側の話であって、契約の側を過大に書いてよい理由にはならない。

(c) を採らない理由: 継続 turn の責務（次の turn へ引き渡す）と逆の挙動を、引き渡す先の producer が無いまま先に入れることになる。Queue 配線のスライスで、継続を発行する側と合わせて決めるべき判断であり、本 Issue の要件（表順の正本）とも無関係。

### Consequences

- 良い点: 契約の記述とリポジトリ内の全呼び出し元が、変更後も食い違わない。
- 良い点: cron 経路（駆動する側）と継続経路（引き渡す側）の責務の違いが、ポート契約と usecase JSDoc の両方から読める。
- トレードオフ: Queue 配線が入るまでは、継続 turn が最終表を ack すると自動 claim された lane がリース失効まで滞留する。producer が無いため今は到達しないが、配線を入れる側はこの引き渡しを同時に実装する必要がある。
- 引き継ぎ: Queue 配線のスライスで、継続要求を発行する producer と「引き渡された lane を誰が次に駆動するか」を決める。そのとき契約 4 の主体限定を見直す。
- 昇格しない理由: これは Queue 配線が入るまでの過渡的な取り決めで、`spec/adr/` が持つ「現在有効な設計判断」としては短命。契約 4 の主体限定はポート JSDoc に、継続 turn の扱いは usecase JSDoc に、それぞれ記述される。
