# 実装計画 — Issue #16: 保守スイープの表順が二重正本になっている

**Issue:** #16
**作成日:** 2026-08-25
**規模:** 通常
**実装方針:** steps.md

---

## 目的

保守スイープの表順の正本を `GlobalMaintenanceRunStore` が持つ run のスナップショット（`run.tables`）だけにし、`pruneExpiredAuthState` 側の `SWEEP_ORDER_HINT` を廃する。表構成を変えるデプロイをまたいで run を resume しても順序がずれず、lane が漏れず、run が必ず完走する状態にする。

## 受け入れ基準

「対応ステップ」は**その基準を成立させる実装ステップ**を指す。検証コマンドの実行はステップ 9 で一括して行うため、この列には書かない。

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | `advanceOrAck` の応答が進んだ先の lane を position ごと返す（`next: MaintenanceLane \| null`）。ポート JSDoc に「表順の正本は run 生成時に固定した順序付き表集合であり、呼び出し側は表順を持たない」ことが契約として書かれている | Issue「`claimLanes` が lane とともに表名を返し、`SWEEP_ORDER_HINT` を廃して `run.tables` を唯一の正本にする」。`claimLanes` は既に表名を返しており、欠けているのは `advanceOrAck` の応答側だけ（ADR-001） | 1, 4 |
| AC-2 | `SWEEP_ORDER_HINT` 定数がリポジトリから消え、`grep -rn "SWEEP_ORDER" packages apps` が 0 件になる | Issue 現状 | 6 |
| AC-3 | store が**新しい position を作った**とき（同一 lane の次表へ進めたとき）に返す lane の `commandKey` が、その position から呼び出し側が導くキー（`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`）と一致することを適合スイートが拘束する | Issue「Queue の重複排除キーの設計に踏み込む」（ADR-001 契約 3(a)） | 4, 5 |
| AC-4 | store が**既存の position を返す**とき（別 shard の自動 claim）は、その lane に永続化されている `table` / `cursor` / `commandKey` をそのまま返し、キーを再 mint しないことを適合スイートが拘束する | ADR-001 契約 3(b)。再 mint すると checkpoint 時に Queue へ載せた継続要求のキーと食い違い、重複排除が畳めなくなる | 4, 5 |
| AC-5 | run の表集合が usecase の既定順と違う配備でも、cron を 1 回回せば run が `completed` になり、claimed のまま残る lane が 0 件になる（表順ずれによる停滞が無い） | Issue「表構成を変えるデプロイをまたいで run を resume すると順序がずれる」 | 6, 7 |
| AC-6 | run の表集合に、この配備が sweep を持たない表が含まれていても、その表を飛ばして run が完走し、飛ばした事実が `runId` / `generation` / `shardId` / `table`（飛ばした表名）とともに error ログに残り、`failures` に数えられず、`SystemError` は投げられない | Issue「表構成を変えるデプロイをまたいで run を resume すると順序がずれる」の、表が**減る**側（hint を廃しても残る停滞。ADR-002） | 6, 7 |
| AC-7 | 別 shard が自動 claim された経路で、解放して `claimLanes` で取り直す迂回が無くなっている。同時 claim 上限（6）を超える shard 数の配備で cron を 1 回回したとき、`advanceOrAck(completed: false)` が 1 度も呼ばれないことをテストが観測する | AC-1 から導かれる同一原因の迂回 | 6, 7 |
| AC-8 | `adapters/conformance/globalMaintenanceRunStore.ts` の ADP-common-029 が、同一 lane の次表と別 shard 自動 claim の両方について返る lane の `table` / `cursor` / `asOf` / `commandKey` を検証し、返った lane が claimed であることも検証する。あわせて **`advanceOrAck(completed: false)`（解放）が、他に pending な shard があっても `{ next: null, runCompleted: false }` を返す**ことを 1 ケースで拘束し、同じ拘束が契約 2 としてポート JSDoc にも書かれている | CLAUDE.md「ポート契約を変えるならポート JSDoc と conformance の両方を触る」。解放が新しい lane を claim しないことはどこにも書かれていない実装依存の前提で、契約 4（返った lane を処理か解放する義務）だけを足すと、別バックエンドが解放時に pending lane を返し、3 つの解放呼び出し元がいずれも戻り値を捨てるため「誰も駆動しない claimed lane」が再生する | 1, 5 |
| AC-9 | `spec/domains/index.md` のポート署名、`spec/database/index.md` の `global_maintenance_runs`（run 単位の順序付き表集合、lane の position がその集合へのインデックスであること、**同じ段落の checkpoint 記述が表名ではなく position ベースになっていること**）、`spec/inventory/domain.md` の DOM-common-030、`spec/inventory/adapter.md` の ADP-common-029、`spec/inventory/usecase.md` の UC-identity-021、`spec/usecases/identity.md` の手順 2 とエラーケース表が新しい契約と一致している | CLAUDE.md「spec は現在有効な設計の canon」 | 2 |
| AC-10 | ADR-001 / ADR-002 が `spec/adr/061-*.md` / `062-*.md` として起票され、`spec/adr/index.md` の一覧と前提依存マップに載り、ADR 026（ポート契約と適合スイート）/ ADR 046（契約と実装の乖離）との前提関係が書かれている | CLAUDE.md「`spec/adr/index.md` は現在有効な非自明な設計判断の索引」 | 3 |
| AC-11 | 新しいテストケースが `spec/testcases/identity/pruneExpiredAuthState.md` と `spec/inventory/test.md`（TC-identity-347..349）に登録されている。あわせて、書き換えた `spec/testcases/identity/pruneExpiredAuthState.md` 20 行の写しである **`spec/inventory/test.md` の TC-identity-165 行**が同じ新しい文言に更新されている（本文と台帳の片側だけを直さない） | ADR 052 / 058 の台帳規約（台帳は本文からの生成物） | 2, 7 |
| AC-12 | ポート JSDoc に契約 2 / 3(a) / 3(b) / 4 が書かれ、契約 4 の主体が「lane を駆動する呼び出し側」に限定されている。`MaintenanceLane.generation` が routing 世代であって表構成の世代ではないことが型の JSDoc に 1 行ある。両 usecase の `runContinuation` の Runtime wiring note に、ack で返った lane を claimed のまま次の継続へ引き渡す扱いが 1 行ずつ記載されている | CLAUDE.md「契約に振る舞いを足すならポート JSDoc と conformance の両方を触る」／ADR-003・ADR-006 の記述先を `.thread` 外に残すため | 1, 6, 8 |
| AC-13 | `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test` がすべて通る | CLAUDE.md | 9 |

## スコープ

### 含まれないもの

- **`.thread/1/adr.md` の ADR-039 の残存条件（`PRUNE_LEASE_OWNER` がプロセス定数のため、解放に失敗した lane がリース失効回収に拾われない）の恒久対策。** Issue 本文が「恒久対策は cron まわりの設計とセットで検討するのが妥当」と明示している。本 Issue の変更は `releaseLane` を通る経路を `finally` の一括解放 1 つに減らすが、失敗経路自体は残るので条件は変わらず残存する（`releaseLane` の `workRemains = true` と警告ログもそのまま残す）。
- **両 usecase の `runContinuation` が、ack で返った lane を処理も解放もしない点の是正。** 契約 4 の主体を「lane を駆動する呼び出し側」に限定して記述と実態を一致させるだけにとどめる（ADR-006）。継続要求を発行する producer がリポジトリに無い（grep 0 件）以上、引き渡し先を決められるのは Queue 配線のスライス。
- **`checkpointLane` の `nextCommandKey` を store 側の mint に寄せること。** checkpoint は「次の cursor」を呼び出し側が決める操作で、キーもその position から呼び出し側が導ける。ADR-001 の契約 3 が定める「position を作った側が mint する」規則の一部であり、寄せる理由が無い（ADR-004）。
- **`terminalPrune.ts` の `TABLE = "account_deletion_manifests"` 定数。** 形は「呼び出し側が持つ表名」だが、単一表 kind であり、`checkpointLane` が表不一致を `ConflictError("MAINTENANCE_LANE_TABLE_MISMATCH")` で弾くため、静かにずれて停滞する余地が無い。二重正本ではないので残す。
- **run に明示的な世代（generation）列を持たせること。** `beginOrResumeKind` の「kind ごとに running run は 1 つ、完了後だけ新 run」という既定と `run.tables` のスナップショットで、旧世代 run を完走させてから新世代へ移す挙動は既に成立している（ADR-003）。
- **`jobTombstonePrune` kind の usecase 実装。** ポートとデフォルト表集合にはあるが usecase がまだ無く、本 Issue の対象外。
- **`spec/usecases/identity.md` の `pruneExpiredAuthState` 出力 DTO に `identityRemovalReceipts` が欠けている乖離と、概要・入力 DTO の「4 種」表記の修正。** 本 Issue の変更点と無関係な既存乖離で、spec-sync の管轄。是正するのは**本 Issue が実際に偽にする文だけ** — `spec/usecases/identity.md` の手順 2（「全 4 表完了なら shard ack」）とエラーケース表（「4 つすべての削除が失敗」）、および `spec/testcases/identity/pruneExpiredAuthState.md` の同じ事実を述べる行（AC-9 / AC-11）。それ以外の 4 表表記は同じ文書内に残るが、スコープの線を「偽になる文」に引くほうが読者にも実装者にも見える。
- **`AuthStateTable` union / `authStateSweeps` レジストリの再設計。** これは「表 → sweep ポート」の対応表で順序を持たず、表順の正本ではない。本 Issue では触らない。
- **同一配備内の表集合ドリフト（`maintenanceTablesByKind` と `authStateSweeps` のずれ）を起動時に検出するガード。** 参照ランタイムでは到達不能な失敗モード（`maintenanceTablesByKind` は `MemoryBackendOptions` のオプションで、`nodeServerEnvToRuntimeOptions` が返すのは `oauth` と `deletionTicketKeyRing` だけなので、本番経路は常に `DEFAULT_MAINTENANCE_TABLES` を使う）であり、入れれば composition root の持ち分と、`isAuthStateTable` の export・新規テストファイル・将来の全バックエンドへの引き継ぎが増える。本 Issue は `run.tables` を唯一の正本にすることに集中する。ガード不在で残る条件は「リスクと注意点」と ADR-002 の Consequences に残存条件として記録する。
- **リトライ・DLQ・cron 配線。** 参照ランタイムでは `pruneExpiredAuthState` を駆動するスケジューラがまだ無く（usecase JSDoc の Runtime wiring note）、本 Issue でも増やさない。

## リスクと注意点

- **ポートの応答形状変更は全バックエンドに課される要件になる。** 現在のバックエンドは memory 1 つだが、Issue #11 で D1 実装者が同じ契約を実装することになる。JSDoc と適合スイートの両方を同時に更新しないと、ADR 046 が禁じる「契約の記述が実行形にしかない」状態を作る。
- **契約 1 は応答形状より重いスキーマ要件を課す。** run 行が「生成時に固定した順序付き表集合」を持つことが前提であり、`spec/database/index.md` の `global_maintenance_runs` には現在それが無い。spec を放置すると、D1 実装者が「進めた先の表」を配備の設定から引く実装を書き、本 Issue が消したはずの二重正本がバックエンド側で再生する。さらに同じ行は lane 側に「table」列を並べているため、run の表集合を**足すだけ**では「lane が表名を持つ」と「lane は集合へのインデックスを持つ」が同じ文に併存し、スキーマ canon の側で二重表現を作る。lane 側の表現を決め切ってから足す（ステップ 2）。
- **契約 4（返った lane を処理か解放する義務）だけを足すと、解放側に穴が開く。** リポジトリ内の解放呼び出しは 3 か所（`releaseLane` 経由の `finally` 一括解放、sweep 失敗と budget 枯渇の直接呼び出し、`terminalPrune.release`）とも**戻り値を捨てている**。既存の適合スイートも `completed: false` の戻り値を拘束していない（ADP-common-027 / 028 とも無視）。つまり「解放は next を返さない」はどこにも書かれていない実装依存の前提のまま。D1 実装者が「解放は capacity を空けるので次の pending を返してよい」と読めば、返った lane は claimed になり全呼び出し元がそれを捨てるので、**リース失効まで誰も駆動しない lane** が生まれる — 本 Issue が塞ぎに来た漏れ経路そのもので、AC-7 のテストは memory バックエンドしか観測しないため検出されない。契約 2 に「解放と run 完了のとき `next` は必ず null」と書き、同じ拘束を適合スイートにも置く（AC-8）。
- **契約 3 を分岐で書き分けないと契約 2 と矛盾する。** 別 shard の自動 claim は永続化済みの `commandKey` をそのまま返すのが正しく、store は規則を知らない（既存の適合ケース ADP-common-028 は規則外の `nextCommandKey: "command-2"` を渡している）。ここを無条件に「導出キーと一致する」と書くと、D1 実装者が再 mint して Queue の重複排除が壊れる。
- **`terminalPrune.ts` が同じポートの別の呼び出し元。** `advanced.next` を `{ generation, shardId }` としてしか使っていないため `MaintenanceLane` へ広げても構造的に適合するはずだが、型が通ることを必ず確認する。ここで意図せず挙動が変わってはいけない（自動 claim された lane を即座に解放して返す挙動は維持する — 単一表 kind で invocation 予算の考え方が違うため。ADR-001 の引き継ぎ）。
- **既存テスト 2 件が「hint が次表を名指せない」経路に依存している。** `"a lane whose next table the sweep order cannot name is released, not left claimed"` と `"a failing lane release is logged rather than thrown..."` は、hint 廃止で前提そのものが消える。前者は「表構成が違っても完走する」テストへ作り替え、後者は解放失敗が観測できる別の fixture（`checkpointLane` が投げる既存パターン）へ載せ替える。テストを黙って削らない。載せ替え後も「なぜ `releaseLane` の `workRemains = true` が観測できないのか」の説明をコメントに引き継ぐ（引き継がないと次の読者がデッドコードとして消しうる）。
- **未知の表を ack で飛ばす判断（AC-6）は、その表の行が掃かれないまま run が完了することを意味する。** ただしこの配備には掃く手段が無く、run を止めても掃けない。飛ばした事実は error ログに出す。ログの payload に載せられるのは usecase が実際に持っている `runId` / `lane.generation` / `lane.shardId` / `lane.table` だけで、**run の表集合はポート面から取得できない**（`beginOrResumeKind` は `{ runId, asOf, result }` しか返さず、それを返すようにするのは ADR-001 が棄却した案そのもの）。飛ばした表名と run / lane の特定子があれば「その run でその表が掃かれなかった」痕跡としては足りる。
- **残存条件: 同一配備内の表集合ドリフトは検出されないまま残る。** 未知表 skip の原因は 2 つある。(1) デプロイ境界越えの resume（表が減る側）は 1 run で解消する。(2) 同一配備内で `maintenanceTablesByKind` と `authStateSweeps` がずれた場合（表を `DEFAULT_MAINTENANCE_TABLES` に足して `AuthStateTable` に足し忘れる等）は次の run にも同じ表が現れるため、skip は**恒久的に静かに掃かれない表**を作る。`AuthStateTable` の JSDoc が型で避けている失敗モードそのもので、本 Issue はこれを**解決しない**。起動時ガードは参照ランタイムでは到達不能な失敗モードへの防具なのでスコープ外とし（「含まれないもの」参照）、残存条件として ADR-002 の Consequences に記録する。ガードを入れるなら別 Issue。
- **未知表の ack 前進はループになりうる。** 表集合が全部未知なら lane は表数ぶん ack を繰り返す。1 回の ack を 1 command として予算（`MAX_COMMANDS_PER_INVOCATION`）に数え、1 invocation 内で無制限に回らないようにする。
- **`failures` / `successes` のカウント意味を壊さない。** 未知表は「削除の失敗」ではないので `failures` に数えない（現在は数えている。数えたままだと全表未知の run が `SystemError(DatabaseError)` を投げ、DB 障害と区別できなくなる）。
- **TC-identity-171（reshard 32 lane）の観測がスパイに依存している。** 別 shard 自動 claim 経路で `claimLanes` の呼び出し回数が減るため、`claimLimits.length > 0` は保つが、回数に依存した assertion を足さない。AC-7 の観測は claim 回数ではなく「`advanceOrAck(completed: false)` が呼ばれないこと」で行う。

## テスト方針

- **ポート適合（`adapters/conformance/globalMaintenanceRunStore.ts`）**
  - ADP-common-029 を拡張し、同一 lane の次表への advance が返す lane が `table: "t2"` / `cursor: null` / `asOf: run の asOf` / `commandKey` = position から導けるキー、であることを検証する（AC-3）。
  - 別 shard を自動 claim して返す経路で、その lane が**永続化済みの位置**（事前に checkpoint した cursor と表）と**永続化済みの `commandKey`**（checkpoint 時に渡した規則外の文字列でもそのまま）を保って返ることを検証する（AC-4）。
  - 返った lane が claimed であること（直後の `claimLanes` がそれを返さないこと）を検証する。
  - **解放（`completed: false`）が `{ next: null, runCompleted: false }` を返すこと**を検証する（AC-8）。既存の ADP-common-028 は 2 shard のうち 1 本だけを claim して解放しており、その時点で他方の shard は pending のまま。つまり「pending lane があっても解放は null を返す」がそのまま観測でき、fixture の追加は要らない。
- **usecase（`application/identity/__tests__/pruneExpiredAuthState.test.ts`）**
  - TC-identity-347: run の表集合が usecase の既定順と違う配備（`maintenanceTablesByKind: { authStatePrune: ["identity_removal_receipts", "sessions"] }`）で、1 回の cron が run を `completed` にし、対象行を消し、claimed の lane を残さない（AC-5。既存の「解放される」テストの作り替え）。
  - TC-identity-348: shard 数が同時 claim 上限を超える配備（8 shard）で 1 回の cron が run を `completed` にし、その間 `advanceOrAck(completed: false)` が 1 度も呼ばれない（AC-7。store ラッパーで観測する）。
  - TC-identity-349: 旧い表集合（この配備が sweep を持たない表を含む）で作られた running run を直接 backend に置いて resume させ、その表を飛ばして run が `completed` になり、error ログに `runId` / `generation` / `shardId` / `table` が残り、`failures` に数えられず、`SystemError` を投げない（AC-6）。run 行を直接置くのが、このシナリオ（デプロイ境界越えの resume＝旧い表集合の run を新しい配備が resume する）の忠実な再現になる。**直接置く run 行の `asOf` は、撒く期限切れ行の `expiresAt` 以降にする**（`beginOrResumeKind` は resume 時に置いた行の `asOf` をそのまま返し、それが sweep の境界 `expiresAt <= asOf` になる。`asOf` を先に置くと対象が 0 件になり「セッションが消える」の期待が落ちる）。`clock.now()` と同値にしておけば足りる。
  - 作り替え: 解放失敗が投げ返されずログに落ちることを、`checkpointLane` が投げる既存 fixture に `advanceOrAck(completed: false)` も投げる設定を重ねて検証する（元の throw が勝つ／解放失敗はログ／lane は claimed のまま）。この fixture は 4 shard を claim するので、claimed のまま残る lane は 1 件ではなく 4 件になる。
  - 既存 TC-identity-150..178 は挙動不変。特に TC-identity-171（reshard・active lane ≤ 6）、TC-identity-174（lapsed lease からの回復）、budget 枯渇時の全 lane 解放が緑のままであること。
- **回帰**: `terminalPrune` のテスト（`deleteAccount.terminalPrune.test.ts`）と `workers/__tests__/outboxPrune.test.ts`（`advanceOrAck` のスタブを持つ）が通ること。
- **コマンド**: `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test`。
