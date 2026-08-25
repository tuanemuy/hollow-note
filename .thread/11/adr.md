# ADR — Issue #11: Cloudflare D1・Durable Objects・R2 アダプターを追加する

計画時点で決めた設計判断。実装フェーズで前提が崩れたら、番号の続きに「差し戻し」として追記する。

## ADR-001: 二平面 Unit of Work を「ステージした write-set の原子適用」で実装する

### Context

`GlobalUnitOfWorkProvider.run(fn)` / `ScopeUnitOfWorkProvider.run(scope, fn)` は**任意の await を含むコールバック**を取る。適合スイート `packages/core/src/adapters/conformance/unitOfWork.ts` が要求するのは、(a) コールバックが throw したら実体書き込みもバッファした event も全部巻き戻ること、(b) 並行する別の `run` が半端な状態を一度も観測しないこと（観測値は 0 か 2 のみ）、(c) コミットが成功したときだけ relay を 1 回 kick すること。

ところが両方の実行基盤に、この形をそのまま受ける機構が無い。

- **D1 に interactive transaction が無い。** 原子性を持つのは `db.batch(statements)` だけで、これは文の配列であってコールバックではない。しかも条件付き UPDATE が 0 行に当たっても batch 全体は失敗しない。
- **DO の `ctx.storage.transactionSync(cb)` は同期実行で await を跨げない。** コールバック内の `await` は原理的に置けない。

memory バックエンドは undo ログ（[ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md)）＋ 全 UoW の直列化で通しているが、これは同一プロセス内の Map だからできることで、SQL バックエンドには移せない。

選択肢:

1. **即時書き込み + 失敗時の補償**。実装は素直だが (a)(b) をどちらも満たさない。補償の途中でクラッシュすれば半端な状態が残り、並行 run はコミット前の書き込みを観測する。
2. **write-set をステージし、コミット時に 1 回で原子適用する**。読みは実 SQL + ステージ済み書き込みのオーバーレイ。適用は D1 なら `batch()`、DO なら `transactionSync`。throw ならバッファを捨てるだけ。
3. **1 コールバック = 1 SQL 文に制限する**。ポート契約を実装都合で狭める話であり、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) に反する。

### Decision

2 を採る。両平面で同じ write-set 機構を共有し、適用先だけを差し替える（D1: `db.batch()` / DO: `ctx.storage.transactionSync`）。

- **読み** は実ストレージへ問い合わせたうえで、同じ run がステージした書き込みを重ねて返す（read-your-writes）。
- **楽観ロック** は write-set に「この行を version = N で読んだ」という条件を持たせ、適用時に `UPDATE ... WHERE version = :expected` の影響行数で検査する。D1 の batch が 0 行更新で止まらない問題は `spec/database/index.md:29,33` の物理配置表が名前だけ挙げている `_occ_guard` を使って、条件不成立を batch 内で中断させる形で埋める。列と使い方は本 Issue で決めて spec に節を足す。
- **outbox flush** はコミットと同じ原子単位に入れる（memory の `globalUnitOfWork.ts` と同じ位置づけ）。
- **`kick`** は適用が成功して `run` を抜けた後にだけ撃つ。
- **入れ子の禁止** は `AsyncLocalStorage`（workerd の `nodejs_compat` で動作を実測済み）で現在の平面を持ち回り、同一平面・平面をまたぐ双方の入れ子を throw で弾く。

### Consequences

- 良い点: 適合スイートの (a)(b)(c) を素直に満たす。memory の undo ログと概念が対応しており、既存実装を読みながら移植できる。D1 / DO のどちらにも同じ機構が乗るので実装量が 2 倍にならない。
- 良い点: `spec/database/index.md:19`（「global D1 の非集約更新は単一 SQL 文、scope 内の複数更新は `transactionSync`」）と `spec/platform/index.md` の D1 query 予算（1 invocation 500）に自然に収まる。1 コミット = 1 batch なので query 数が見積もりやすい。
- トレードオフ: 読みがオーバーレイを通るぶん、リポジトリ実装が write-set を意識せざるを得ない。素の SQL を書くより層が 1 枚増える。
- トレードオフ: 分離レベルが「コミット時の条件付き適用」に依存する。D1 の read が別 run のコミット済み結果を途中で拾うこと自体は起こりうるが、適合スイートが禁じているのは**半端なコミットの観測**であって read の反復可能性ではないので契約は満たす。
- トレードオフ: `_occ_guard` の形を本 Issue で決めることになり、spec 側に節を足す義務が生じる（plan.md AC-9）。

## ADR-002: scope UoW のコールバックは Worker 側で実行し、確定だけを 1 回の RPC で DO へ渡す

### Context

ADR-001 で write-set 方式を採っても、「コールバックをどの isolate で走らせるか」がまだ決まらない。scope 平面のストレージは DO の中にあり、コールバックは呼び出し元（Worker、あるいは適合テスト）にあるクロージャである。

選択肢:

1. **コールバックを DO の中で走らせる。** DO クラスにアプリケーションコードを載せ、Worker はコマンド名と引数だけを送る。ストレージと同じ isolate なので読みも書きもローカル。ただし `run(scope, fn)` の `fn` は任意のクロージャなので、RPC で送れない。送れる形にするには「名前付きコマンドのレジストリ」を用意してユースケース側を書き換えることになり、application 層に手が入る。適合スイートはインラインのクロージャを渡してくるので、そもそもこの形では通らない。
2. **コールバックは呼び出し側で走らせ、読みは RPC、書きは write-set に貯めて最後の 1 回の RPC で適用する。** `fn` はどこにも送らない。DO は「読みの問い合わせ」と「write-set の適用」という 2 種類の RPC を受けるだけの汎用ストアになる。
3. **DO の transaction を複数 RPC にまたがって開いたままにする。** SQLite-backed DO にそういう API は無い。

### Decision

2 を採る。`ScopeUnitOfWorkProvider.run(scope, fn)` は呼び出し元の isolate で `fn` を実行し、scope 側リポジトリの読みは DO への RPC、書きは write-set へのステージとする。コミット時に write-set 全体を 1 回の RPC で DO へ渡し、DO の中で `ctx.storage.transactionSync` により原子適用する。

これは `spec/platform/index.md`「外部要求」の「DO transaction / `blockConcurrencyWhile` の中で external I/O を待たない。外部処理は Queue worker、**確定だけを scope RPC で行う**」と同じ形である。

適合テストでは `@cloudflare/vitest-plugin` の `runInDurableObject(stub, cb)` を使わず、production と同じ RPC 経路を通す。スイートが観測するのはポートの振る舞いだけなので、テスト専用の抜け道を作る理由が無い。

### Consequences

- 良い点: application / domain 層に一切手が入らない。`run(scope, fn)` の契約がそのまま成立する。
- 良い点: 適合スイートがインラインのクロージャを渡す形のまま通る。テスト用と production 用で経路が分かれない。
- 良い点: DO クラスが「汎用の scope ストア」に留まり、ユースケースを DO のバンドルへ引き込まずに済む。DO の再デプロイ理由がストレージ層の変更に限られる。
- トレードオフ: 1 UoW あたりの読みの回数だけ RPC 往復が発生する。`ScopeCleanupAdmissionStore.assertWritable` が全書き込み入口で呼ばれるので、素朴に書くと往復が積み上がる。`spec/platform/index.md` の「1 batch が異なる scope を含む場合も RPC は同時 6 本まで」に触れないことと、foreground p95 500ms の SLO を実測で確認する必要がある。バッチ読み・プリロードによる削減は最適化であり、契約を満たしてから行う。
- トレードオフ: DO 内で alarm ハンドラが動くときは同じ機構をローカル（RPC を挟まない）で使いたい。write-set 機構は「適用先」を差し替えられる形にしておき、alarm 経路ではローカル適用にする。

## ADR-003: `ScopeTaskQueue.listDue` は global D1 の due index 表で実装する

### Context

`packages/core/src/application/ports/scopeTaskQueue.ts` の JSDoc は強い言い方で「`listDue` は全バックエンドに必須であって任意の索引ではない。空配列を返すバックエンドはポートを実装したことにならない」と書いている。適合スイート `scopeTaskScheduler.ts` は、schedule 直後に行が現れること、claim 直後に消えること、リース失効後に再び現れることまで観測する。

一方 `spec/platform/index.md`「Global Cron」は「Cron は scope object を全列挙しない。scope-local cleanup は必ず Alarm で起動する」と定め、[ADR 021](../../spec/adr/021-scope-sharded-data-plane.md) も同じ立場を取る。そもそも Durable Objects に「全オブジェクトを列挙する」手段は無い（`listDurableObjectIds` はテスト専用ヘルパー）。

memory バックエンドは `backend.scopeEntries()` で全 scope を横断スキャンしてこれを満たしているが、この手は DO には無い。

選択肢:

1. **`scheduled_tasks` 自体を D1 に置く。** `spec/database/index.md:33` が scope DO の infrastructure 表として定めているので、物理配置の正本に反する。scope-local な continuation を本処理と同一 transaction に入れる要件（`application/execution/unitOfWork.ts` の JSDoc）も壊れる。
2. **global D1 に due index 表を置き、DO 側の `scheduled_tasks` の変化に追随させる。** 正データは DO のまま、index は「どの scope に仕事があるか」だけを持つ派生データ。
3. **契約を「任意の索引」に緩める。** ポート JSDoc が名指しで禁じている。[ADR 046](../../spec/adr/046-port-contract-divergence.md) の言う「正本のある側へ倒す」で、この振る舞いの正本はポート定義にある。

### Decision

2 を採る。global D1 に scope task due index 表を新設し、`(scope, kind, operationId)` を PK、`due_at` / `priority` / `lease_expires_at` を持たせて `listDue` の選択順（`ScopeTaskScheduler` の選択規則を scope をまたいで適用したもの）を再現する。

適合スイートが要求する**即時可視性**は、DO 側の transaction がコミットしたあと、その RPC が Worker へ応答を返す**前**に index を更新することで満たす。`run(scope, fn)` が解決した時点では index は既に新しい。D1 と DO を 1 transaction に入れないという `spec/database/index.md:19` の規約は守れる（順序の保証であってトランザクションの結合ではない）。

コミットと index 更新のあいだで落ちた場合の drift は、当該 scope の alarm が自分の `scheduled_tasks` を正として index を書き直すことで治す。index は正データではないので、遅れて直っても正しさは失われない — `listDue` を読む中央 runner は各行に対して改めて scope UoW を開き `claimDue` で取り直すため、余分な行を出しても「claim に失敗する 1 往復」で済む（ポート JSDoc が「1 行を 2 つの runner に渡してもコストは claim を 1 つ落とすだけ」と明示している）。

この表は `spec/database/index.md` の物理配置表（global D1: infrastructure）に無いので、**spec を改訂して足す**。

### Consequences

- 良い点: ポート契約を緩めずに DO の列挙不可能性を回避する。正データの置き場所（scope DO）は spec の物理配置どおりのまま。
- 良い点: 最終プラットフォームでは各 scope DO が自分の alarm を回すので、この index の本来の役割は「取りこぼしの救済」に縮む。参照ランタイムの中央 runner が必要とする横断読みも同じ表で満たせる。
- トレードオフ: scope task の schedule / claim / settle ごとに D1 への書き込みが 1 回増える。`spec/platform/index.md` の global 容量・write QPS の見積もりに新しい項が加わるので、見積もりの節も併せて改訂が要るか実装時に判断する。
- トレードオフ: 派生データが 1 つ増え、drift の治癒経路（alarm による書き直し）を実装・テストする責任が生じる。
- トレードオフ: spec の持ち分（物理配置表）を変えるので、`spec/database/index.md` の改訂が本 Issue の完了条件に入る。

## ADR-004: 適合スイートの「毎テスト fresh backend」は factory 側の名前空間分離で満たす

### Context

`packages/core/src/adapters/conformance/backend.ts:92-94` は「スイートは factory 経由で**毎テスト fresh な** backend を得るので、実装は factory 呼び出しをまたいで状態を共有してはならない」と契約している。実際 30 スイートすべてが `beforeEach(async () => { backend = await makeBackend(); })` を持つ。

`@cloudflare/vitest-plugin` の分離ストレージは**テストファイル単位**である（実測: 同一ファイル内では test A の R2 書き込みが test B から見え、ファイルをまたぐと R2 は空・D1 の表は消えている）。memory バックエンドと同じく 30 スイートを 1 ファイルに並べると、`beforeEach` が新しい `ConformanceBackend` を作っても下のストレージは前のテストの行を抱えたままになる。

選択肢:

1. **1 スイート 1 ファイルに割る。** 30 ファイルになり、`applyD1Migrations` が 30 回走る。それでも 1 ファイル内の複数 `it` で汚染が残るので解決になっていない。
2. **factory 呼び出しごとに名前空間を作る。** D1 は factory 呼び出しごとの連番を全表のキーに混ぜるか、`beforeEach` 相当のタイミングで全表を削除する。DO は `ScopeKey.serialize` から DO 名を導く関数に名前空間 prefix を挟み、呼び出しごとに別 object を掴む。R2 は key prefix を分ける。
3. **プールの分離設定を強める。** 1.0.0 のオプションは `main` / `remoteBindings` / `verbose` / `additionalExports` / `miniflare` / `wrangler` だけで、`isolatedStorage` / `singleWorker` は既に存在しない。手が無い。

### Decision

2 を採る。`makeCloudflareConformanceBackend` が呼び出しごとに単調増加の名前空間 ID を採り、

- **DO**: DO 名の導出を `${ns}/${ScopeKey.serialize(scope)}` にする。名前空間の注入点はアダプター内の 1 関数に閉じ、production は prefix 無しで通る。新しい名前 = 新しい object なので、scope 側のストレージは呼び出しごとに完全に空。
- **D1**: 表は 1 つのままとし、factory 呼び出しの先頭で全表を `DELETE` する（表は小さく、migration の再適用より速い）。
- **R2**: key prefix に名前空間を混ぜる。`publicUrl` の形は prefix を含んだまま返るが、契約は「配備の URL の形をアダプターに閉じる」（[ADR 049](../../spec/adr/049-object-storage-public-url.md)）なのでスイートの観測とは矛盾しない。

分離の責任を factory に置き、**適合スイート本体には一切手を入れない**。

### Consequences

- 良い点: memory と同じ「1 ファイルに 30 スイート」の形が保て、`conformance.test.ts` が両バックエンドで同型になる。migration の適用もファイルごと 1 回で済む。
- 良い点: DO 側は「新しい名前 = 新しい object」で本当に空になるので、消し漏れの心配が無い。
- トレードオフ: DO 名の導出に production では使わない注入点が 1 つ残る。テスト専用の分岐がアダプター内に入るのは望ましくないが、代替が無い。名前空間を**設定値として常に通す**（production は空文字）形にして、分岐ではなく引数にする。
- トレードオフ: D1 の全表 DELETE は表が増えるほど遅くなる。30 スイート × 各テストで効いてくるので、実測して遅ければ「表ごとに触ったかを記録して触った表だけ消す」へ寄せる。
- トレードオフ: 1 ファイルに 30 スイートを並べると、workers プロジェクトのテスト実行はファイル並列の恩恵を受けない。必要なら面ごと（D1 / DO / R2）に 3 ファイルへ割ることを検討する。

## ADR-005: 本 Issue の出口を「アダプター群 + 適合ハーネス + DI ランタイム合成」に置き、配備一式を含めない

### Context

Issue #11 のチェックリストは 5 行すべてが「アダプターと物理スキーマ」の言葉で書かれ、完了条件は「共有ポート適合テストが in-memory 実装と Cloudflare 実装の双方で全件成功すること」に置かれている。一方 [ADR 025](../../spec/adr/025-single-reference-runtime.md) の「影響」は「Cloudflare 一式（wrangler 設定、Workers 向けテストプールを含む）を組み直す工数はこの判断で消えず、後ろに移動しただけである」と書いており、この Issue がその工数だと読める。

ここで境界が問題になる。チェックリスト 3 行目は「Scope Durable Objects の永続化・**alarm**・transaction 境界」と言っており、alarm はアダプターの内側にも配備の外枠にも見える。一方で Worker entry・`wrangler.jsonc` の本番設定・Queue consumer・vite の CF ビルド・Workers Assets での静的配信は、チェックリストのどの行にも現れない。

### Decision

**ストレージのポート契約を満たすために要るもの**を内側、**要求とジョブを運ぶ経路**を外側として切る。

内側（本 Issue）: D1 / DO / R2 のアダプター群、両平面の UoW、migration、DO クラスとその `alarm()` ハンドラ、適合ハーネス、`di/cloudflareRuntime.ts`。DO の `alarm()` は `ScopeTaskScheduler` の契約（claim / lease / 再スケジュール）と不可分で、適合スイートと統合テストがそこを観測するので内側に入る。

外側（別スライス）: `apps/web/app/server.cloudflare.ts`、`vite.config.cloudflare.ts`、本番 `wrangler.jsonc`、`deploy` script、Queue consumer と Cron ハンドラの外枠、`RelayTrigger` / `EventDispatcher` の Cloudflare 実装、`clientKey` の `CF-Connecting-IP` 対応。Node 側の同種課題が #15 として独立しているのと対になる。

### Consequences

- 良い点: 完了判定が「適合スイート全件緑」という機械的に確かめられる 1 点に収まる。配備の成否（アカウント・バインディング・ドメイン）に完了が依存しない。
- 良い点: Issue の完了条件が禁じる「スタブ・仮実装・部分実装」を守れる。配備まで含めると、この規模ではどこかを仮で置くことになりかねない。
- トレードオフ: 本 Issue の完了時点で Cloudflare にデプロイできる状態にはならない。`CLAUDE.md` の「Reference runtime」は Node + in-memory のまま。ADR 025 は引き続き有効で、差し替えは配備スライスの仕事になる。
- トレードオフ: 外側スライスの Issue が未起票。本 Issue の片付け時に起票する。

## ADR-006: 物理スキーマに FOREIGN KEY を宣言しない

### Context

`spec/database/index.md` の「共通の規約」は「同じ database / domain の親子は原則 `ON DELETE CASCADE`」と定めており、`identities` / `note_revisions` / `note_projection_revisions` などは親への外部キーを持つ設計になっている。D1 は SQLite の外部キー強制を既定で有効にする。

ところが適合スイートは親行を作らずに子を挿入する。`conformance/identityRepository.ts` は `userId(1)` の User 行を一度も書かないまま `identityRepository.insert` を呼び、参照バックエンドはこれを受け入れる。`noteRevisionRepository` / `noteProjection` 系も同じ形である。外部キーを宣言すると、memory が通しているケースを D1 / DO 実装だけが落とす。

[ADR 046](../../spec/adr/046-port-contract-divergence.md) は食い違いを「振る舞いの正本がどちらにあるか」で倒せと言い、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) はポート定義とその JSDoc をポート契約の正本と定めている。どのポートの JSDoc も参照整合性を要求していない。plane をまたぐ後始末はイベントで行う設計（`spec/database/index.md`「リレーションと plane 境界」）であり、参照先が消えた行は「対象が存在しない」として扱うことが既に不変条件として書かれている。

### Decision

Cloudflare バックエンドの DDL に `FOREIGN KEY` / `REFERENCES` 句を置かない。親子の後始末はドメインイベントの購読者が行い、参照先が消えた行の扱いは spec の既存の規約どおりとする。

`spec/database/index.md` の `ON DELETE CASCADE` の記述は論理的な所有関係の宣言として読み、物理制約の指示としては読まない。移行時に子を先に消す `RESTRICT` の指示（Workspace→Membership、Job parent→children）は、それらの表を持つスライスがアプリケーション側の順序として守る。

### Consequences

- 良い点: memory と Cloudflare が同じ適合スイートを同じ結果で通る。契約を実装都合で狭めていない。
- 良い点: scope DO と D1 をまたぐ参照に外部キーが張れないこと（そもそも不可能）と、同一 plane 内の参照の扱いが揃う。「参照先が消えた行は対象が存在しないものとして扱う」という 1 つの規則で全体が説明できる。
- トレードオフ: 孤児行の検出が DB の仕事でなくなる。実際の掃除は既に `note.purged` などの購読者が担っているので追加の実装は要らないが、購読者を書き忘れた場合に DB は教えてくれない。
- トレードオフ: `spec/database/index.md` の該当記述と物理スキーマが字面では食い違う。本 ADR がその読み方を定める。

## ADR-007: scope 側の schema は DO のバンドルが運び、global 側だけ migration ファイルにする

### Context

`spec/database/index.md` は「両者の SQL schema は同じ migration version を共有する」と定める。global D1 の migration は `.sql` ファイル群で持ちたい — `wrangler d1 migrations apply` も、テストハーネスの `readD1Migrations()` も、ディスク上のファイルを読むためである。

一方 scope DO には migration runner が無い。`ctx.storage.sql` へ DDL を流せるのは object 自身だけで、外部から適用する API は存在しない。object の数に上限が無く、いつ生成されるかも事前に分からないため、「配備時に全 object へ適用する」という形も取れない。

### Decision

version は共有し、運び方を分ける。

- global D1: `adapters/cloudflare/d1/migrations/NNNN_*.sql`。`d1/schema.ts` は表名の目録だけを持つ
- scope DO: `adapters/cloudflare/do/schema.ts` の文字列配列。object の constructor が `blockConcurrencyWhile` の中で全文を実行する。全文が `IF NOT EXISTS` なので、活性化のたびに走っても no-op である

「触られたことのない object でも表が既にある」ことが配備手順抜きで成り立つのはこの形だけである。

### Consequences

- 良い点: object の生成タイミングを配備が知らなくてよい。scope が増えても運用作業が増えない。
- 良い点: scope schema の変更が DO のコード変更と同じ単位で配られる。バンドルと schema の版がずれない。
- トレードオフ: scope 側の schema 変更は「既存 object をどう進めるか」を自前で書く必要がある。今は `IF NOT EXISTS` の追加だけで足りるが、列の変更を伴う版が来たら `_scope_identity` に schema version 列を足して分岐する形へ広げる。
- トレードオフ: 2 つの plane の schema が別の形で書かれるので、「同じ version を共有する」ことをレビューで確かめるしかない。`GLOBAL_MIGRATION_VERSION` と `SCOPE_MIGRATION_VERSION` を並べて置き、目視で照合できるようにしてある。

## ADR-008: `_occ_guard` は「違反されるための表」として、条件付き更新の直前に積む 1 文で実装する

### Context

[ADR 001](#adr-001-二平面-unit-of-work-を「ステージした-write-set-の原子適用」で実装する) は `_occ_guard` を使って「条件不成立を batch 内で中断させる」と決めたが、列と使い方は実装フェーズに委ねていた。

制約は 3 つある。(a) D1 の `batch()` も DO の `transactionSync` も、0 行更新をエラーにしない。(b) 中断させられるのは「文がエラーを返すこと」だけである。(c) その文は、期待が成り立っているときには何もしてはならない。

### Decision

`_occ_guard (id integer PRIMARY KEY, CONSTRAINT _occ_guard_conflict CHECK (id <> 0))` を両 plane に置き、次の 1 文を条件付き更新の**直前**に積む。

```sql
INSERT INTO _occ_guard (id) SELECT 0 WHERE NOT EXISTS (<期待が成り立つときだけ行を返す SELECT>)
```

期待が成り立てば `SELECT` は 0 行を返し、`INSERT` は何も入れない。成り立たなければ `id = 0` を入れようとして `CHECK` に反し、単位ごと中断する。**この表は 1 行も持たない。** 制約名を固定してあるので、駆動側のエラーメッセージからこの中断だけを識別して `ConflictError("OPTIMISTIC_LOCK_FAILURE")` へ翻訳できる（`sql/errors.ts` の `classifySqlError`）。

直前に積むのは、1 つの単位の中で後続の文が先行文の効果を見るためである。更新のあとに置いた guard は自分が書いた版を読む。

### Consequences

- 良い点: 追加の列も、読み書きする状態も要らない。表の存在そのものが仕掛けである。
- 良い点: 楽観ロック以外の条件付き更新（route の CAS、uniqueness reservation の 3 分岐、`scheduled_tasks` の claim）にも同じ形が使える。翻訳先の誤りだけをアダプターが決める。
- トレードオフ: どの guard が発火したかを駆動側のメッセージから区別できない。実装は「ステージ時に読んだ値で先に判定して固有のエラーを投げ、guard は同時実行に対する最後の砦にする」という二段構えを取る。commit 時に発火した guard が返すのは一律 `OPTIMISTIC_LOCK_FAILURE` である。
- トレードオフ: 1 つの条件付き更新につき SQL 文が 1 つ増える。1 commit あたりの文数が最大 2 倍になるので、`spec/platform/index.md` の D1 query 予算（1 invocation 500）に対する見積もりはこの倍率込みで読む必要がある。

## ADR-009: リポジトリは駆動を直接触らず `SqlSession` を受け取る

### Context

[ADR 001](#adr-001-二平面-unit-of-work-を「ステージした-write-set-の原子適用」で実装する) は「読みは実 SQL + ステージ済み書き込みのオーバーレイ」と決めたが、その層をどこに置くかは決めていなかった。

同じリポジトリが 2 つの文脈で呼ばれる。UoW の中（書きはステージ、読みは read-your-writes）と、UoW の外（`LoginAttemptStore` / `OAuthStateStore` / `NoteRouteStore` など、設計が意図的に UoW の外へ置いた原子的ストアと、読み取り専用サービス）である。`ConformanceBackend` は両方の形を露出しており、スイートは同じポートを `run` の内と外の両方から呼ぶ。

### Decision

リポジトリは `SqlExecutor`（駆動）ではなく `SqlSession` を受け取る。session は 2 種類あり、どちらも同じインターフェイスを満たす。

- **staged**: UoW が開く。`write` は write-set へ積み、`readRow` / `readRows` はオーバーレイを重ねる
- **autocommit**: UoW の外。`write` は即座に、それ自体を 1 つの原子単位として適用する

読みは 3 つに分かれ、選択に意味を持たせる。`query` は素通し（集計・`RETURNING`・当該単位が触れていないことが確実な読み）、`readRow` は主キー読みで常にオーバーレイ対応、`readRows` は集合読みで**呼び出し側が渡す `matches` / `compare` が SQL の `WHERE` / `ORDER BY` を写している範囲でだけ**オーバーレイ対応する。

`write` は `RowMutation` の配列を取る。`upsert` / `remove` は行像をオーバーレイへ残し、`opaque` は SQL だけを積んでオーバーレイに寄与しない（guard、カウンタ加算、多行 DELETE）。

### Consequences

- 良い点: リポジトリのコードが 1 つで両方の文脈に効く。テスト専用の経路が生まれない。
- 良い点: 「この読みは自分の書き込みを見る必要があるか」がコード上の選択として現れる。`query` を選んだ箇所は意図的に素通しだと読める。
- トレードオフ: 集合読みのオーバーレイのために、`WHERE` と `ORDER BY` を SQL と述語の 2 か所に書くことになる。冗長であり、ずれれば read-your-writes が静かに壊れる。`readRows` の JSDoc がこの義務を明示し、ずれても素の SQL 結果は正しいまま（見落とすのは未 commit の自分の書き込みだけ）である点が緩和になっている。
- トレードオフ: `opaque` を選べば read-your-writes は効かない。多行 DELETE のように行像を列挙できない書き込みでは避けられないが、選択を型で強制はできない。

## ADR-010: ステップ 2 の出口条件は適合スイートではなくバックエンド固有テストで満たす

### Context

steps.md はステップ 2 の出口条件を「`conformance/unitOfWork.ts` だけを先に緑にすること」と書いていた。ところがそのスイートは `backend.userRepository` / `backend.forScope(s).noteRepository` / `backend.outboxRepository` を通じて観測するので、通すにはステップ 5・7・8 のリポジトリ実装が要る。ステップ 2 と 5–10 の並列委譲を両立させるには、この依存を切る必要がある。

### Decision

ステップ 2 の出口条件を、`adapters/cloudflare/__tests__/unitOfWork.test.ts` のバックエンド固有テストへ置き換える。観測するのは適合スイートと同じ性質 — 全部か無かの適用、失敗時の巻き戻し、並行 run が半端な状態を見ないこと、commit 後だけの kick、平面をまたぐ入れ子の禁止 — に加えて、スイートがバックエンド非依存でないために観測しないもの（`_occ_guard` の発火、DO への 1 往復 commit、due index の即時可視性）である。ポートの stand-in はテストファイル内に閉じる。

`conformance/unitOfWork.ts` 自体はステップ 11 で、他の 29 スイートと同時に通す。

### Consequences

- 良い点: ステップ 2 が単独で完了判定でき、5–10 の並列委譲がその上で始められる。
- 良い点: バックエンド固有の性質にテストが付く。これは適合スイートには入れられない（plan.md「テスト方針」）ので、いずれ書く必要があったものである。
- トレードオフ: ステップ 2 の時点では「契約を満たしている」とは言えず、「機構が動く」までしか言えない。契約の判定はステップ 11 に残る。
- トレードオフ: テストファイル内のポート stand-in が `as unknown as` を通る。UoW が触れないポートを埋めるためだけの型合わせであり、production コードには漏れていない。

## ADR-011: 未実装ポートは「投げる Proxy」で埋め、束ごとのファイルに分けて並列委譲する

### Context

適合スイートは `describeXxxContract(name, makeBackend)` の形で `ConformanceBackend` **全体**の factory を要求する。35 のポート実装が揃うまで factory を作れないなら、ステップ 5〜10 の担当者は誰も自分の実装をステップ 11 まで検証できない。

一方、欠けているポートを「それらしい値を返すもの」で埋めると、スイートが何も無いものに対して通ってしまう。Issue の完了条件が禁じる「スタブ・仮実装」がテスト側に入り込むかたちになる。

さらに 6 体が並列で作業するので、全員が同じファイルの同じ領域を編集する形にすると衝突が絶えない。

### Decision

3 つを組み合わせる。

1. **未実装ポートは全メソッドが throw する Proxy**（`__tests__/pendingPorts.ts` の `notImplementedPort`）。メッセージはポート名・メソッド名・外し方を含む。したがって赤の理由が「実装がまだ無い」か「契約に反している」かを、メッセージだけで区別できる。`then` と symbol キーだけは `undefined` を返す — テストフレームワークの thenable 判定や inspect フックによる**探り**を呼び出しと取り違えないため。
2. **未実装の名前は 1 箇所の配列**（`PENDING_PORTS`）に 1 行ずつ。担当は自分の行だけを消すので、git は互いに干渉しない hunk として併合できる。名前を消したのに factory を配線し忘れた場合は、backend 構築時に「PENDING_PORTS から外れたが factory が無い」と大きく失敗する — 黙ってスタブへ戻ることはない。
3. **束ごとに 1 ファイル**（`__tests__/ports/{identity,directory,route,scopeBusiness,scopeInfra,projection}.ts`）。担当が触るのは自分の束のファイルと `PENDING_PORTS` の自分の行だけで、`conformanceBackend.ts` は誰も編集しない。適合スイートの呼び出しも束ごとに `__tests__/conformance/{束}.test.ts` へ分け、各担当が自分のファイルだけを回せるようにする。

2 つの UoW provider は**この扱いに入れない**。実装済み（ステップ 2）だからであり、pending なのはそれが露出するリポジトリのほうである。

### Consequences

- 良い点: 6 束が着手初日から自分の適合スイートを回せる。完了判定が「自分のファイルが緑になる」まで縮む。
- 良い点: 初期状態が全赤であることに意味がある。「実装が無い」ことがテスト出力として可視化され、進捗が実測できる。
- 良い点: `conformanceBackend.ts` が安定するので、6 体の並列作業で衝突するのは `PENDING_PORTS` の行削除だけになる。
- トレードオフ: ステップ 5〜10 が終わるまで `pnpm test` は赤である。node プロジェクト（既存 978 件）は緑のままなので AC-7 は保たれるが、CI を通す運用にするならステップ完了まで workers プロジェクトを別ジョブにするか、赤を許容する必要がある。
- トレードオフ: `port()` の名前は文字列リテラルで、型で守られていない。綴りを誤ると「pending のまま」になるが、エラーメッセージが誤った名前をそのまま出すので発見は早い。
- トレードオフ: `seedMembershipEdges` を実装していない。`membership_directory` が Workspace ドメイン側（本 Issue 対象外）の表だからで、スイートは optional として当該ケースを skip する（実測 3 件）。ステップ 6 が必要と判断したら migration を 1 つ足して実装する。
