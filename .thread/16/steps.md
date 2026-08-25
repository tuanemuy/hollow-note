# 実装手順 — Issue #16

## 設計

### ドメインモデルへの影響

なし。保守スイープの run / lane は `application/ports/globalMaintenanceRunStore.ts` の application port で、`domain/` には型もルールも持たない。エンティティ・値オブジェクト・ドメインサービスは一切変わらない。

### ポート契約（内側の起点）

問題は 1 点に集約する。**`advanceOrAck` は lane を進める操作なのに、進めた先を呼び出し側に伝えない。** 応答が `next: { generation, shardId } | null` しか持たないため、呼び出し側は「同じ lane の次の表は何か」を自分で名指すしかなく、それが `SWEEP_ORDER_HINT` という 2 本目の正本になっている。

決定: **進める操作が、進めた先の position を返す。**

```ts
advanceOrAck(input: Readonly<{
  runId: string; leaseOwner: string; generation: string; shardId: string; completed: boolean;
}>): Promise<Readonly<{ next: MaintenanceLane | null; runCompleted: boolean }>>;
```

`MaintenanceLane` は既に `{ generation, shardId, table, cursor, asOf, commandKey }` を持ち、`claimLanes` が返している型そのもの。これを `advanceOrAck` の応答にも使うことで、

- 表順の正本は run のスナップショット（`run.tables`）だけになり、呼び出し側は表順を知らなくてよくなる（`SWEEP_ORDER_HINT` 廃止）
- 別 shard が自動 claim された経路で「解放 → `claimLanes` で取り直す」という迂回が要らなくなる（往復 2 回と、その間に他ワーカーへ取られる窓が消える）
- 表構成を変えたデプロイをまたいだ resume でも、位置は常に store 側の 1 本の権威から来る

契約として JSDoc に書き足すこと:

1. 表の走査順は **run 生成時に固定した順序付きの表集合**が唯一の正本。run 行はその集合を持ち、lane の position はその集合へのインデックスであって、resume 中に配備の設定が変わってもこの集合は動かない。呼び出し側は表順を持たない。
2. `advanceOrAck` は進めた先の lane を position（`table` / `cursor` / `asOf` / `commandKey`）ごと返す。同一 lane の次表へ進んだ場合の `cursor` は `null`（新しい表は先頭から）。別 shard を自動 claim した場合は**その lane の永続化済みの位置**（解放済み lane が保持していた表と cursor）をそのまま返す。**`completed: false`（解放）のときと run が完了したときは `next` が必ず `null`。解放は lane を pending に戻すだけで、たとえ他に pending な lane があっても新しい lane を claim しない。** この 1 文が無いと契約 4 が「解放呼び出しにも lane が返りうる」と読め、リポジトリ内の解放呼び出しは 3 か所とも戻り値を捨てているため、誰も駆動しない claimed lane が別バックエンドで生まれる。
3. `commandKey` は **position を作った側が mint する**。
   - (a) store が**新しい position を作った**とき（同一 lane を次表へ進めたとき）に返す `commandKey` は、その position から呼び出し側が導けるキー（`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`）と一致する。Queue の重複排除が store 側の mint と呼び出し側の再導出の両方を同じキーで畳めることが、この一致の目的（既に `claimLanes` について成立している契約を広げる）。
   - (b) store が**既存の position を返す**とき（別 shard の自動 claim）は、その lane に永続化されている `commandKey` をそのまま返す。**store は再 mint しない。** その値は呼び出し側が `checkpointLane` に渡した `nextCommandKey` であり、再 mint すると checkpoint 時に Queue へ載せた継続要求のキーと食い違って重複排除が畳めなくなる（既存の適合ケース ADP-common-028 は規則外の `"command-2"` を渡している）。
4. `next` が非 null のとき、その lane は claimed である。**lane を駆動する呼び出し側**（cron 経路）は、それを処理するか解放する責務を負う。単発の継続 turn は、返った lane を claimed のまま次の継続へ引き渡す（ADR-006。引き渡し先の producer が入るまでの扱いは各 usecase の JSDoc に書く）。

`checkpointLane` の `nextCommandKey` は入力のまま（契約 3 の規則そのもの。ADR-004）。

### ユースケース / アプリケーションロジック

`pruneExpiredAuthState.ts` の `runCron` から、表順の知識を 3 か所とも抜く。

**(a) 同一 lane の次表（現 372-410 行）** — hint での名指しをやめ、`advanced.next` をそのまま `laneQueue` に載せる。`nextTable === undefined` の分岐（Issue #1 の暫定対応）は、名指す必要が無くなるので**分岐ごと消える**。

**(b) 別 shard の自動 claim（現 411-425 行）** — 解放 → `claimLanes(1)` の往復をやめ、`advanced.next` をそのまま `laneQueue` に載せる。lane の総数は store が `MAX_ACTIVE_LANES` で抑えるので、上限は従来どおり守られる。

**(c) この配備が sweep を持たない表（現 291-306 行）** — 現状は `failures += 1` と解放 + `workRemains = true` で、次の cron も同じ位置に戻るため run が完走しない（表が減るデプロイをまたいだ resume がこの経路）。**`advanceOrAck(completed: true)` で表を飛ばして前進させる**。返った `next` は同じく `laneQueue` に載せる。**`next` が `null` のとき（未知表が run の最終表で、かつ他に pending lane が無い＝ `runCompleted: true`）は何も載せず、`inFlight = null` にして次の lane へ進むだけにする。`workRemains` は立てない**（run は完走しているので、立てると完走した run に `continued: true` を返すことになる）。(a) (b) には既存コードに `advanced.next === null → laneDone` の分岐があるが、(c) はその分岐より前の位置なので参照先が無い。

- 飛ばす判断の根拠: この配備には掃く sweep がそもそも無いので、run を止めても行は掃けない。一方 run を完走させれば、次の run はこの配備の表集合で作られ、以後この表は現れない。
- `failures` には数えない（削除の失敗ではないので、全表未知の run が `SystemError(DatabaseError)` になってはいけない）。
- error ログには残す。payload は `table`（飛ばした表名）に加えて `runId` / `lane.generation` / `lane.shardId` を載せる — この分岐は `failures` にも view にも出ないので、このログが「その run でその表が掃かれなかった」唯一の痕跡になる。**run の表集合は載せない**: usecase が run について知れるのは `beginOrResumeKind` の戻り値 `{ runId, asOf, result }` と lane だけで、表集合を返すポートメソッドは無く、足すことは ADR-001 が棄却した選択肢 (b) に戻ることを意味する。飛ばした表名と run / lane の特定子があれば痕跡としては足りる（run の表集合は `runId` から後で引ける）。
- ack 1 回を 1 command として `commands` に数え、1 invocation 内で無制限に回らないようにする。

(a) (b) (c) はいずれも「`advanced.next` を処理キューに載せる」という同じ形になるので、`laneQueue.push(advanced.next)` に集約できる。`commandKeyOf` の呼び出し元は `checkpointLane` の `nextCommandKey` 用途だけになる（**シグネチャは変えない**）。

`releaseLane`（解放失敗をログに落として `workRemains` を立てる）と `finally` の一括解放は**そのまま残す**。`.thread/1/adr.md` の ADR-039 の残存条件はスコープ外で、budget 枯渇と throw の経路では今も解放が必要。なおこの変更後、`releaseLane` ヘルパーを通るのは `finally` の一括解放だけになる（未知表・sweep 失敗・budget 枯渇の解放はいずれも `advanceOrAck` の直接呼び出し）。

`isAuthStateTable` は usecase 内部の述語のまま（export しない）。同一配備内の表集合ドリフトを起動時に落とすガードは**本 Issue のスコープ外**で、その帰結（ドリフト由来の未知表は次の run にも現れ、恒久的に静かに掃かれない表になる）は ADR-002 の残存条件として記録するだけにとどめる。

`terminalPrune.ts` は `advanced.next !== null` と `release(advanced.next)`（`{ generation, shardId }` を要求）でしか使っておらず、`MaintenanceLane` へ広げても構造的に適合する。**挙動も型も変えない**（自動 claim された lane を即座に解放して返す設計は、単一表 kind の invocation 予算の考え方によるもので、本 Issue は触らない）。同ファイルの `TABLE` 定数もそのまま（単一表 kind で `checkpointLane` の表照合が不一致を弾くため、二重正本による停滞が起きない）。

### アダプター / 永続化 / 外部連携

`adapters/memory/repositories/globalMaintenanceRunStore.ts` の `advanceOrAck` だけ。既に `toLane(run, laneRow)` が `run.tables[tableIndex]` から表名を引いて `MaintenanceLane` を組む helper を持っているので、返り値をそれに差し替える。

- 表を進めた分岐（257-276 行）: 進めた後の lane row を `toLane` に通して返す。`commandKey` は既に同じ分岐で再 mint 済み（契約 3(a)）。
- 別 shard 自動 claim の分岐（281-291 行）: claimed にした `nextPending` を `toLane` に通して返す。永続化済みの `tableIndex` / `cursor` / `commandKey` がそのまま乗る（契約 3(b) — ここで再 mint してはいけない）。
- `completed: false`（解放）と run 完了の分岐は `next: null` のまま。

`MaintenanceRunRow` / `MaintenanceLaneRow` のスキーマは変えない。`DEFAULT_MAINTENANCE_TABLES` も変えない。

### UI / プレゼンテーション

影響なし。保守スイープはワーカー経路のみで、ルート・コンポーネント・server function を持たない。

## 実装ステップ

### 1. ポート契約を変える

- **対象ファイル:** `packages/core/src/application/ports/globalMaintenanceRunStore.ts`
- **変更内容:**
  - `advanceOrAck` の戻り値を `Readonly<{ next: MaintenanceLane | null; runCompleted: boolean }>` にする。
  - インターフェース JSDoc に「設計」節の契約 1〜4 を追記する。契約 2 には**解放（`completed: false`）と run 完了のとき `next` が必ず `null` であること**（他に pending lane があっても解放は新しい lane を claim しない）を明記する。契約 3 は (a) / (b) を分けて書く。契約 4 は主体を「lane を駆動する呼び出し側」に限定して書く。既存の記述（single running run / lease / lapsed lease の lane 回収 / 30 日保持）は削らない。
  - 契約 2 の解放側は**ステップ 5 の適合ケースと対で入れる**（CLAUDE.md「契約に振る舞いを足すならポート JSDoc と conformance の両方を触る」）。片側だけを足すと、本 Issue が新たに ADR 046 の禁じる状態を作る。
  - `MaintenanceLane` 型の JSDoc に、これが `claimLanes` と `advanceOrAck` が共有する「lane の現在位置」であることを書く。あわせて `generation` が **UserId ルーティングの reshard 世代**であって表構成の世代ではないことを 1 行書く（ADR-003 が `spec/adr/` へ昇格しない代わりの記述先。番号は引かず理由を本文で書く）。
- **理由:** 契約の正本はポート定義（ADR 026）。ここを起点にしないと、下流の実装とスイートが何に従うのかが決まらない。AC-12 の JSDoc 側の本体でもある。

### 2. spec を新しい契約に合わせる

- **対象ファイル:** `spec/domains/index.md`（134-141 行の署名 / 152 行の散文）、`spec/database/index.md`（159-161 行 `global_maintenance_runs`）、`spec/inventory/domain.md`（38 行 DOM-common-030）、`spec/inventory/adapter.md`（37 行 ADP-common-029）、`spec/inventory/usecase.md`（33 行 UC-identity-021）、`spec/usecases/identity.md`（879 行 手順 2 / 893 行 エラーケース表）、`spec/testcases/identity/pruneExpiredAuthState.md`、`spec/inventory/test.md`（306 行 TC-identity-165 の更新 ＋ 末尾に TC-identity-347..349 の追加）
- **対象外（確認済み）:** `spec/platform/index.md` 207 行。実際に読むと「table/shard完了時にackと次の未claim shard取得を原子的に行い、kind全体のactive laneを6以下に保つ」「全position ackでcompleted」までで、**応答形状にも表順の権威にも触れていない**。未知表 skip も ack で position を進めるので「全 position ack で completed」は真のまま。本 Issue で偽になる文が無いので触らない。
- **変更内容:**
  - `spec/domains/index.md` の `advanceOrAck` 署名を `next: { generation; shardId; table; cursor: string | null; asOf: Date; commandKey: string } | null` に更新。152 行の `GlobalMaintenanceRunStore` の箇条書きに「表の走査順は run 生成時に固定した順序付き表集合が唯一の正本で、ack は進めた先の position を返す。command key は position を作った側が mint する」を足す。
  - `spec/database/index.md` の `global_maintenance_runs` に、run 行が**生成時に固定した順序付きの表集合**を持つこと、resume 中に配備の設定が変わってもこの集合は動かないことを書く。**この行が無いと D1 実装者は「進めた先の表」を配備の設定から引くしかなく、本 Issue が消した二重正本がバックエンド側で再生する。**
  - 同じ 161 行の lane 側の列挙は現在「generation/shardごとの`unclaimed | active | completed` position、**table**、keyset cursor、active command key」。ここへ run の表集合を**足すだけ**にすると、同じ文の中に「lane が表名を持つ」と「lane は集合へのインデックスを持つ」が併存し、スキーマ canon の側で二重表現になる。**決め切る: lane が持つのは run の表集合への position（インデックス）であって表名ではない**（memory 実装の `MaintenanceLaneRow.tableIndex` と一致し、`MaintenanceLane.table` は `run.tables[tableIndex]` から導出される読み取り面の値）。lane 側の列挙から独立した「table」を落として position 側の表現に畳み、「lane の現在表は run の表集合から引く。配備の設定から引いてはならない」を 1 文添える。
  - **同じ段落の後半に残る表名ベースの checkpoint 記述も同時にそろえる。** 161 行には「target shardのDELETE成功後、routing catalog shardで**次table**/cursor/command keyのcheckpointと次Queue outboxを同じtransactionに保存する」という文があり、列挙だけを position 表現へ畳むと、同一段落内で「lane は集合へのインデックスを持つ」と「checkpoint は table を保存する」が併存して、ADR-001 の Consequences が警戒した二重表現がスキーマ canon 側に残る。checkpoint が保存するのは**現在 position の keyset cursor と次 command key**（表は進めない — 表を進めるのは shard ack 側）である事実に合わせ、この文からも表名の権威を落とす。同じ段落の「shard完了ackと次position claim」は既に position 表現なので触らない。
  - `spec/inventory/domain.md` の DOM-common-030（`GlobalMaintenanceRunStore.advanceOrAck`）の要点を「lane を進め、**進めた先の position** と shard / run 完了を返す」に更新。本文（`spec/domains/index.md` の署名）が変わるので、ADR 059 の「片側にしか無い主張は本文由来のときだけそろえる」に照らして DOM / ADP 両台帳をそろえるケースに当たる。
  - `spec/inventory/adapter.md` の ADP-common-029 の要点を同じ文言に更新。
  - `spec/inventory/usecase.md` の UC-identity-021（`pruneExpiredAuthState`）の要点欄を**更新する**。現行は「固定 as-of と maintenance run により全 routing generation の session、auth token、login attempt、OAuth state を shard・表ごとに 100 件ずつ冪等回収し、部分失敗を隔離して継続・完了管理する」。未知表 skip は「部分失敗の隔離」ではなく（失敗に数えない）本文に新設される観測可能な挙動なので、ADR 052 の「既存の 1 行が全振る舞いを畳んでいる単位に振る舞いが増えたら、行を足さず要点欄で追随させる」に当たる。**末尾に「この配備が掃けない表は飛ばして完走させる」相当の 1 句を足すだけ**にし、表名の列挙（4 種表記）は触らない — そちらは本 Issue が偽にする文ではなく spec-sync の管轄で、ステップ 2 全体の線引き（「偽になる文だけ」）と同じ。
  - `spec/usecases/identity.md` 手順 2 の「100件未満なら次表、全4表完了なら run store へ shard ack して未 claim shard を1件取得する」を、run の表集合を正本とし ack が次 position を返す表現へ直す。あわせて**新しい振る舞い**を書く: 「run の表集合にこの配備が sweep を持たない表が含まれる場合は、その表を ack で飛ばして前進させ、記録は error ログに残すが失敗には数えない」。
  - `spec/usecases/identity.md` のエラーケース表 893 行「4 つすべての削除が失敗 → `SystemError(DatabaseError)`」を run の表集合ベースの表現に直し、**未知表はこの判定の分子にも分母にも入らない**ことを明示する（明示しないと、spec だけを読んだ D1 実装者が全表未知の run を DB 障害として扱う実装を書ける）。
  - `spec/testcases/identity/pruneExpiredAuthState.md` の 20 行「あるshardの4表すべてが失敗する」を run の表集合ベースの表現に直し、未知表がこの判定の分子にも分母にも入らないことを揃える（エラーケース表と同じ事実を述べている行なので、片方だけ直すと文書間で食い違う）。**17 / 18 行の「4 種とも対象が 0 件」「2 回目は 4 種とも 0 件」は触らない** — 件数の話であって本 Issue が偽にする文ではなく、同じ文書に残る他の 4 表表記（概要・入力 DTO の union）と同じく spec-sync の管轄。ここまでで線を引くほうが、スコープの境界が読者に見える。
  - `spec/testcases/identity/pruneExpiredAuthState.md` に 3 行追加: (1)「run の表集合が現行コードの既定順と違う（表構成を変えたデプロイをまたいで resume する）」→「run のスナップショットの順に最後まで進み、順序ずれで停滞しない」、(2)「shard 数が同時 claim 上限（6）を超える」→「ack が返す次 lane をそのまま処理し、解放して取り直す往復をしない」、(3)「run の表集合にこの配備が sweep を持たない表が含まれる」→「その表を飛ばして run を完走させ、飛ばした事実を run / lane を特定できる形でログに残し、失敗には数えない」。
  - `spec/inventory/test.md` の 306 行 **TC-identity-165** を、テストケースファイル 20 行の新しい文言に合わせて更新する。この行（要素欄「あるshardの4表すべてが失敗する」／要点欄「cursorを失わず再試行し、上限超過時はDLQと運用通知へ送る」）は 20 行の**写し**であり、台帳は本文からの生成物（ADR 052 / 058 / 059）。本文だけを直すと、スコープ節が明示的に是正対象に含めた「4 表すべてが失敗」という**本 Issue が偽にした文が台帳側にそのまま残る**。エラーケース表を直す判断とも整合しない。なお 303 / 304 行（TC-identity-162 / 163 の「4 種とも 0 件」）はテストケースファイル 17 / 18 行と同じく件数の話で偽にならないので**据え置く**。
  - `spec/inventory/test.md` の identity 群の末尾に `TC-identity-347`〜`TC-identity-349` として採番して追加する（ADR 052: 行位置ではなく末尾採番。現在の最大は 346）。
- **理由:** ポート署名は `spec/domains/index.md`、スキーマは `spec/database/index.md` にそれぞれ canon として載っており、`spec/` は「コードについて真であること」を書く場所。契約を変えて spec を放置すると 2 つ目の二重正本を作る。未知表 skip は表現の言い換えではなく観測可能な挙動の変更なので、台帳に 1 行足すだけでは足りない（ADR 052 / 058 の「本文が正本・台帳は生成物」が逆転する）。

### 3. ADR を `spec/adr/` へ昇格する

- **対象ファイル:** `spec/adr/061-*.md`（新規）、`spec/adr/062-*.md`（新規）、`spec/adr/index.md`
- **変更内容:**
  - `.thread/16/adr.md` の ADR-001 を `spec/adr/061-maintenance-sweep-order-authority.md`（表順の正本を run のスナップショットに一本化し、`advanceOrAck` が進めた先の position を返す。command key は position を作った側が mint する）として起票する。
  - 061 の「影響」節に、ADR-001 の Consequences が持つ**引き継ぎを必ず含める** — 同じポートの 2 つの呼び出し元で返った lane の扱いが**正反対**であること（`pruneExpiredAuthState.runCron` は返った lane をそのまま処理し続ける／`terminalPrune.runCron` は単一表 kind で invocation 予算を claim 済みの 6 lane に閉じているため自動 claim された lane を即座に解放して返す）と、その根拠（表の数と invocation 予算の考え方の違い）。ADR-001 自身が「根拠を残さないと将来『片方に揃える』リファクタで静かに壊れる」と書いており、`.thread` は canon ではない以上、要約に畳んで落とすとこの根拠が canon から消える。あわせて契約 2 の**解放時は `next` が null** も 061 の決定に含める（適合スイートと対の canon 記述）。
  - ADR-002 を `spec/adr/062-unknown-sweep-table-skip.md`（run が名指す表をこの配備が掃けないときは ack で飛ばして run を完走させる。同一配備内のドリフトは検出されないまま残る既知の残存条件）として起票する。
  - `spec/adr/index.md` の一覧に 2 行、前提依存マップに 2 行を足す。依存する前提として少なくとも: 061 は ADR 026（契約の正本はポート定義、検証は共有スイート）と ADR 046（乖離は正本のある側へ倒す）、062 は 061（表集合スナップショットが run 単位であること）を挙げる。
  - 昇格しないもの（ADR-003 / ADR-004 / ADR-005 / ADR-006）は `.thread/16/adr.md` の冒頭に理由つきで残す。特に **ADR-003 は昇格しない** — 結論が「新設しない（既に成立しているため）」で canon として拘束するものが無く、非自明で読者を助ける一点（`MaintenanceLane.generation` は routing 世代であって表構成の世代ではない）はステップ 1 の型 JSDoc 1 行で伝わる。ADR 一覧と前提依存マップの面積に見合わないので `.thread` に留め、昇格の要否は Phase 7 の昇格ゲートで判定する。
- **理由:** CLAUDE.md は `spec/adr/index.md` を「現在有効な非自明な設計判断の索引」と定め、「コードで驚くところには ADR がある」ことを前提にしている。特に「行が掃かれないまま run が completed になる」（062）は、実装を読んだ人が必ず理由を探す挙動そのもの。`.thread` は canon ではないので、ここを飛ばすと判断が canon から消える。

### 4. memory アダプターを契約に合わせる

- **対象ファイル:** `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`
- **変更内容:** 「アダプター / 永続化」節のとおり、`advanceOrAck` の 2 つの非 null 分岐を `toLane(run, laneRow)` の結果で返す。`toLane` に渡す `run` は `replaceLane` 後の最新スナップショットであること（表 index / cursor / commandKey が更新後の値であること）に注意する。別 shard 自動 claim の分岐では `commandKey` を再 mint しない。
- **理由:** 参照バックエンドが契約の実行可能な基準（ADR 024 / 025）。

### 5. 適合スイートで契約を拘束する

- **対象ファイル:** `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`
- **変更内容:**
  - ADP-common-029 の既存ケースで、表を進めた `next` が `{ table: "t2", cursor: null, asOf: run の asOf }` を持ち、`commandKey === commandKeyOf(runId, next)` であることを検証する（ファイル冒頭の `commandKeyOf` helper をそのまま使う）。
  - 別 shard 自動 claim の `next` について、**その shard を事前に checkpoint して解放しておき**、ack で返った lane がその cursor と表を保っていること、`commandKey` が checkpoint 時に渡したキー（規則から外れた文字列でもそのまま）と一致することを検証する。規則外の文字列を使うことで「store が再 mint していない」ことが実際に落ちる形になる。
  - 返った `next` が claimed であること（直後の `claimLanes` がその shard を返さないこと）を検証する。
  - **解放が lane を返さないことを 1 ケースで拘束する**（契約 2 / AC-8）。`advanceOrAck({ completed: false })` の戻り値が `{ next: null, runCompleted: false }` であること、しかも**他に pending な shard がある状態でそうであること**を検証する。既存 ADP-common-028 は 2 shard のうち 1 本だけ claim して解放する形（199-206 行）なので、その解放の戻り値を受けて assert するだけでよく、**fixture の追加は不要**。ケース名の ADP ID は既存行に相乗りさせる（ADR 052: 適合ケースには採番しない）。
  - スイート冒頭 JSDoc の「suite pins the lane topology」の説明に、ack が position を返す契約と、キーの mint 主体が分岐で違うこと、**解放は position を返さないこと**を含める。
- **理由:** CLAUDE.md「契約に振る舞いを足すならポート JSDoc と conformance の両方を触る」。ここを飛ばすと ADR 046 が禁じた「JSDoc とスイートの解釈が割れる」状態になる。

### 6. usecase から表順の知識を抜く

- **対象ファイル:** `packages/core/src/application/identity/pruneExpiredAuthState.ts`
- **変更内容:**
  - `SWEEP_ORDER_HINT` 定数（475-481 行）を削除する。
  - 同一 lane の次表の分岐（372-410 行）と別 shard 自動 claim の分岐（411-425 行）を、`laneQueue.push(advanced.next)` に統合する。`nextTable === undefined` の暫定分岐は削除する。
  - 未知の表の分岐（291-306 行）を `advanceOrAck(completed: true)` に変え、返った `next` を `laneQueue` に載せる。**`next` が `null` のときは `laneQueue` に載せず（`laneQueue: MaintenanceLane[]` なので載せれば typecheck が落ちる）、`inFlight = null` にして次の lane へ進むだけ**にする。`failures` には**数えない**（現在の `failures += 1` を落とす）。`commands += 1` で予算に数える。error ログの payload は `table` に加えて `runId` / `lane.generation` / `lane.shardId`（run の表集合は取得できないので載せない）。`workRemains` はこの分岐では立てない（`next` が非 null なら前進しており、`null` なら run が完走しているため。どちらの場合も残りは通常の budget / queue の判定に任せる）。
  - 同じ分岐の `inFlight = null` を**落とさない**。未知表が run の最終表だった場合、ack は lane を done にして別 shard を自動 claim するため、`inFlight` を消し忘れると `finally` が done の lane に `advanceOrAck(completed: false)` を打ち、memory アダプターが `MAINTENANCE_LANE_NOT_CLAIMED` を投げ、`releaseLane` が余計な error ログを出したうえで `workRemains = true` を立てる（run が完走したのに `continued: true` を返す）。`laneQueue.push(advanced.next)` の直前後で `inFlight` の扱いを確認する。
  - `commandKeyOf` の呼び出し元が `checkpointLane` の `nextCommandKey` 用途だけになることを確認する（**シグネチャは変えない** — 契約変更の PR に判定不能な任意リファクタを混ぜない）。
  - usecase の JSDoc「Contract highlights」に、表順が run のスナップショット由来であること（usecase は表順を持たない）を 1 行足す。
  - usecase の JSDoc「Runtime wiring note」に、継続 turn（`runContinuation`）が ack で返った lane を claimed のまま次の継続へ引き渡す設計であること、その producer がまだ無いためリース失効回収まで滞留することを 1 行足す（契約 4 の主体限定と対になる記述）。
  - **JSDoc / コメントに `.thread` ローカルの ADR 番号（ADR-001..006）を書かない。** `.thread` は canon ではなく実際に掃除される（commit 22d7830 で `.thread/1/review/` が削除済み）ため、参照が宙に浮く。理由は本文で書き、canon 化するものだけ `spec/adr/061` / `062` として引く。
- **理由:** AC-2 / AC-5 / AC-6 / AC-7 / AC-12 の本体。二重正本の解消と、そこから派生していた 2 つの迂回・停滞経路の解消。

### 7. usecase テストを作り替える / 足す

- **対象ファイル:** `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`
- **変更内容:**
  - 既存 `"a lane whose next table the sweep order cannot name is released, not left claimed"`（592-616 行）を **TC-identity-347** に作り替える。fixture（`authStatePrune: ["identity_removal_receipts", "sessions"]`）は活かし、期待を「1 回目の cron で `continued: false` / run が `completed` / 対象セッションが消える / claimed lane 0 件」に変える。
  - **TC-identity-348** を新規追加。`maintenanceShardIds` を 8 個（同時 claim 上限 6 を超える）にして 1 回の cron を回し、run が `completed` になること、その間 `advanceOrAck(completed: false)` が 1 度も呼ばれないことを store ラッパーで観測する。claim 回数には依存させない（TC-identity-171 の観測を壊さないため）。
  - **TC-identity-349** を新規追加。`h.backend.maintenanceRuns` に、この配備が sweep を持たない表を含む表集合（例 `["job_tombstones", "sessions"]`）で作られた running run 行を直接置き（lease は失効させて resume させる）、期限切れセッションを撒いて cron を 1 回回す。**置く run 行の `asOf` と撒く行の期限の関係を外さないこと** — `beginOrResumeKind` は resume 時に**置いた行の `asOf` をそのまま**返し、それが sweep の境界（`expiresAt <= asOf`）になる。撒くセッションの `expiresAt` が `asOf` より後だと対象が 0 件になり「セッションが消える」の期待が落ちるので、run 行の `asOf` は撒く行の期限以降（`clock.now()` と同値で足りる）にする。なお `maintenanceTablesByKind: { authStatePrune: ["job_tombstones", "sessions"] }` でも未知表を含む run は作れる（`maintenanceTablesByKind` は `readonly string[]` なので未知表名を受ける）が、**そちらは採らない** — それが再現するのは ADR-002 の原因 2（同一配備内のドリフト＝本 Issue が解決しない残存条件）であって、AC-6 が拘束したい原因 1（旧い表集合の run を新しい配備が resume する）ではない。fixture は軽くなるが、テストが名乗るシナリオと実際に置く状況がずれる。`SystemError` を投げずに run が `completed` になり、セッションが消え、`failures` に数えられず、error ログに未知表の記録（`runId` / `generation` / `shardId` / `table`）が残ることを検証する。run 行を直接置くのが、このシナリオ（旧い表集合の run を新しい配備が resume する＝デプロイ境界越え）の忠実な再現になる。
  - 既存 `"a failing lane release is logged rather than thrown, ..."`（618-670 行）を、`checkpointLane` が投げる fixture（561-590 行と同じ形、`maintenanceShardIds: ["shard-0".."shard-3"]`）に `advanceOrAck(completed: false)` も投げる設定を重ねた形へ載せ替える。期待は「元の throw（`"checkpoint down"`）がそのまま伝播する」「解放失敗が `[pruneExpiredAuthState] lane release failed` としてログに出る」「lane が claimed のまま残る（この fixture は 4 lane を claim するので **4 件**。元テストの 1 件ではない）」。テストの説明コメントから、消えた「hint が次表を名指せない経路」への言及を落とし、**なぜ `releaseLane` の `workRemains = true` が観測できないのか**（usecase 自体が throw して view を返さないため）の説明を引き継ぐ。`.thread/1/adr.md` の ADR-039 の残存条件をテストで固定し続けるのが目的なので、説明が消えると次の読者がデッドコードとして消しうる（**テストコメントにも `.thread` ローカルの ADR 番号は書かず、条件そのものを本文で書く**）。
  - 他の既存テストは変更しない。
- **理由:** hint 廃止でテストの前提が消える 2 件を、消すのではなく Issue が要求する振る舞い（デプロイをまたいだ resume で完走する）を拘束するテストへ移す。AC-5 / AC-6 / AC-7 / AC-11 の観測。

### 8. 同じポートの他の呼び出し元・実装を棚卸しする

- **対象ファイル:** `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`、`packages/core/src/application/identity/pruneExpiredAuthState.ts`（`runContinuation`）、`packages/core/src/application/workers/__tests__/outboxPrune.test.ts`
- **変更内容:**
  - `terminalPrune.runCron`: 型が通ることと挙動が変わらないことを確認する。`advanced.next` を `release()` に渡す箇所（211-214 行）は `{ generation, shardId }` しか読まないので**変更しない**のが正解（構造的部分型で通る）。
  - `terminalPrune.runContinuation`（123-130 行）: `advanced.next !== null` を `continued` に写すだけで処理も解放もしない。契約 4 の主体限定により契約違反ではないが、その扱いを JSDoc の Runtime wiring note に 1 行残す（`pruneExpiredAuthState` 側と同じ扱い。ステップ 6 と対、AC-12 の対象）。**挙動は変えない。** ここでも `.thread` ローカルの ADR 番号は書かず、扱いそのものを本文で書く。
  - `pruneExpiredAuthState.runContinuation`（182-189 行）: 同上。ステップ 6 で JSDoc を足す対象。
  - `workers/__tests__/outboxPrune.test.ts` 59 行の `advanceOrAck: vi.fn(async () => ({ next: null, runCompleted: false }))`: `advanceOrAck` を実装している場所は「memory アダプター + このスタブ」の 2 つ。`next: null` なので新しい型でもコンパイルは通るが、棚卸し対象として確認する。
- **理由:** ポート応答形状の変更が、意図しない挙動変更を別 usecase に波及させていないことの確認。契約 4 を書いたときに「契約の記述に従わない呼び出し元がある」状態を無記述で残さないこと（ADR 046 の裏返しを作らない）。JSDoc の追記そのものが AC-12 の一部。

### 9. 検証

- **対象ファイル:** なし（コマンド実行）
- **変更内容:** `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test` を実行し、`grep -rn "SWEEP_ORDER" packages apps` が 0 件であることを確認する。
- **理由:** AC-2 / AC-13。
