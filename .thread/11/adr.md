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
- （Round 004）読み方を ADR 側に置いたままにすると `.thread/` を読まない者に届かないため、決定文を「共通の規約」の外部キー項目へ 1 文として落とした（`ON DELETE CASCADE` / `RESTRICT` は所有関係の宣言であり `FOREIGN KEY` 宣言を要求しない、列表の `FK → …` も同じ宣言である）。列表の「制約」列は動かしていない。

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

---

## ADR-012: `login_attempts` の失敗加算は「期限切れなら 1 へ戻す」1 文にする

### Context

`spec/database/index.md#login_attempts` は `recordFailure` を単一の upsert として提示している。その SQL は無条件に `failure_count + 1` する。

一方、`LoginAttemptStore` の JSDoc と適合スイートは「期限切れの記録は不在として読め、次の失敗は 1 から数え直す」ことを要求する（`get` が期限切れで `null` を返し、その直後の `recordFailure` が `failureCount: 1` を返す）。参照バックエンド（memory）もそう振る舞う。spec の SQL をそのまま写すと、この 1 件が落ちる。

行の物理削除は `deleteExpired` の掃引に委ねられているので、「期限切れの行が残っている」状態は正常であり、加算側で扱わなければならない。

### Decision

`ON CONFLICT DO UPDATE` の代入を条件式にする。

```sql
failure_count = CASE WHEN login_attempts.expires_at <= ?now THEN 1
                     ELSE login_attempts.failure_count + 1 END
```

`?now` は呼び出し側が渡す `now`（`lastFailedAt` に書くのと同じ値）で、しきい値ではない。したがって `LoginAttemptStore` の「書き込む値が読んだ値に依存しない＝単一文で原子的」という性質も、`LoginThrottlePolicy` の規則を SQL に持ち込まない方針も崩れていない。

適合スイートは 1 行も変更していない。`spec/database/index.md` の当該 SQL 断片は実装と食い違ったままなので、ステップ 13 で本文へ反映する（AC-9）。

### Consequences

- 良い点: 期限切れ行が掃引前に残っていても、ロックの判定材料が古い失敗回数に汚染されない。
- 良い点: 原子性が保たれるので、TC-identity-227（10 並列で必ず 10）は 1 文のまま通る。
- トレードオフ: spec の SQL 断片と実装が一時的にずれる。ステップ 13 での spec 改訂が必須。

## ADR-013: 固有のコンフリクト符号は「ステージ時の読みで決め、guard は同時実行の砦として残す」

### Context

`AuthTokenRepository.save(ConsumedAuthToken)` は `pending` 行への条件付き更新であり、0 行なら `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` を返す契約になっている。一方 `_occ_guard`（ADR-008）が発火したときの既定の翻訳は `throwTranslated` による `OPTIMISTIC_LOCK_FAILURE` で、符号が違う。UoW の中では commit 時に `globalUnitOfWork` が既定の翻訳を適用するため、guard だけに頼ると符号を選べない。

### Decision

2 段構えにする。

1. **ステージ時**: `readRow`（overlay 対応）で当該行を読み、`pending` でなければその場で `AUTH_TOKEN_ALREADY_CONSUMED` を投げる。単独呼び出しでも UoW の中でも、同じ判断が同じ符号で返る。
2. **適用時**: `occGuard(SELECT 1 … AND status = 'pending')` を更新の直前に積む。両者が同時に `pending` を読んだ場合、後着の batch はここで中断する。autocommit 経路では `classifySqlError(e) === "occGuard"` を見て `AUTH_TOKEN_ALREADY_CONSUMED` へ翻訳する。

### Consequences

- 良い点: 「ちょうど 1 人が成功する」が実バインディング上で成立し、敗者の符号も契約どおりになる。
- トレードオフ: staged セッション（UoW 内）で敗者になった場合、commit 時の翻訳は既定の `OPTIMISTIC_LOCK_FAILURE` になる。同一 UoW 内での二重消費はステージ時の読みが先に捕まえるので実害はないが、「別の UoW と競って commit で負けた」ケースだけ符号が異なる。契約はこの区別を要求していない。
- トレードオフ: 読み 1 回ぶん往復が増える。

## ADR-014: 期限切れ掃引と件数上限つき削除は束内の共有ヘルパーに畳む

### Context

`sessions` / `auth_tokens` / `login_attempts` / `oauth_flow_states` / `identity_removal_receipts` の 5 つが同形の `deleteExpired(now, cursor, limit)` を持ち、`sessions` / `auth_tokens` はさらに同形の「述語つき・件数上限つき削除」を 3 か所持つ。どれも「主キー順の keyset で 1 ページ、`expiresAt <= now` は順序ではなくフィルタ」という同じ規則で、素朴に写すと 8 か所の重複になる。

### Decision

`d1/repositories/identitySupport.ts` に `deleteExpiredPage` / `deleteBoundedByKey` / `createTableWriter` / `writeTranslated` を置き、Identity 束の 8 ファイルから使う。`limit + 1` 件読んで `hasMore` を決め、削除は主キーごとの `remove` mutation として積む（`opaque` の多行 DELETE にすると write-set の overlay に残らず、同一 UoW の後続読みが消えたはずの行を見てしまうため）。

置き場所を束内にしたのは、ステップ 5〜10 が並列に進んでおり、束をまたぐ共有ファイルを新設すると衝突するからである。同形のヘルパーは他の束にも要るので、全束が揃った時点で `sql/` 直下へ引き上げるのが自然な後始末になる。

### Consequences

- 良い点: keyset の規則が 1 か所にあり、`nextCursor` の意味（「まだ期限切れが残っているときだけ非 null」）がずれない。
- 良い点: read-your-writes が掃引後も正しい。
- トレードオフ: 1 ページの削除が件数ぶんの文になる。ページ上限は 100 件で D1 の batch 上限（1,000 query）には余裕があるが、`?` を並べない規約が求める「1 文」ではない。件数に比例しない形が要求されるのは `deleteFilesByOwner`（AC-5、ステップ 8）だけで、本束の掃引は対象外。
- トレードオフ: 他の束が同じものを再実装する可能性がある。上記のとおり後で引き上げる前提。

## ADR-015: `NoteRouteStore` の遷移は「読んだ行像の全列書き戻し」+ 行同一性 guard で実装する

### Context

`note_routes` は 5 状態（`reserved`/`active`/`moving`/`purging`/`tombstone`）の状態機械で、遷移は 10 メソッドある。素直に書けば遷移ごとに「触る列だけを更新する条件付き UPDATE」を 1 文ずつ書くことになるが、この表は `spec/database/index.md#note_routes` 由来の相関 CHECK を 5 本持つ（`(state='moving') = (target_scope_* IS NOT NULL)`、`(state='reserved') = (reservation_expires_at IS NOT NULL)`、…）。差分 UPDATE では「新しい state で NULL に戻すべき列」を遷移ごとに数え上げることになり、1 つ落とすと CHECK 違反という形でしか現れない。

さらに write-set のオーバーレイ（ADR-009）は `upsert` に行像を要求する。差分 UPDATE を書くと、SQL の SET 句と JS 側の行像を二重に書き、ずれれば read-your-writes だけが静かに壊れる。

### Decision

遷移は 1 か所（`nextRow`）で「読んだ行像に patch を重ね、`updated_at` を今にする」だけを行い、書き込みは常に全 14 列の `INSERT … ON CONFLICT (note_id) DO UPDATE SET <全列> = excluded.<全列>` 1 文にする。SQL の param 列と overlay の行像は同じオブジェクトから生成されるので、定義上ずれない。

同時実行の砦は ADR-013 の 2 段構えを踏襲するが、guard の条件を「この行が読んだときと同じか」— `note_id` / `state` / `route_version` / `operation_id` / `migration_id` の一致 — に統一する。遷移ごとに guard を書き分けない。新規予約だけは「行が存在しないこと」を主張する別の guard を使う。

### Consequences

- 良い点: 10 個の遷移が「JS の分岐 + 共通の書き戻し」に畳まれ、CHECK を満たす責任が `nextRow` の呼び出し 1 か所に集まる。
- 良い点: 契約固有のエラー符号（`STALE_SCOPE_ROUTE` / `NOTE_ROUTE_STATE_VIOLATION` / `NOTE_NOT_FOUND`）は読んだ値から決まるので、memory 実装と同じ分岐がそのまま写る。
- トレードオフ: 1 列だけ変える遷移でも 14 個の binding を送る。上限 100 に対しては余裕があり、`note_routes` は 1 行が小さいので実害はない。
- トレードオフ: guard が見るのは 5 列であって行全体ではない。`created_by` / `scope_*` は遷移が動かさないか、動かす遷移では `route_version` が一緒に動くので、この 5 列で行の同一性は足りる。

## ADR-016: outbox の claim / prune は `RETURNING` 1 文、finalize は `UPDATE … FROM json_each` 1 文にする

### Context

`OutboxRepository.claimPending` は「原子的に claim して返す」契約で、`finalize` は「成功と失敗が片方だけ残らない」ことを要求する。D1 には interactive transaction が無く、`SELECT` してから `UPDATE` する二段構えでは、二人の worker が同じ行を候補として見た後で両方が claim してしまう。

`finalize` の失敗行は 1 行ごとに `error` と `nextAttemptAt` が異なるので、素直に書けば失敗件数ぶんの UPDATE 文が並ぶ。件数は claim の limit に比例する。

### Decision

- `claimPending`: `UPDATE outbox_events SET claimed_at=?, claimed_by=? WHERE id IN (SELECT id FROM outbox_events WHERE <候補述語> ORDER BY created_at, id LIMIT ?) RETURNING …` の 1 文。候補選択と lease 取得が同一文なので、後着は候補述語（`claimed_at IS NULL OR claimed_at <= now - leaseMs`）に外れて 0 行を持ち帰る。`RETURNING` の行順は保証されないので、FIFO は `created_at` を一緒に返して JS で並べ直す。
- `pruneProcessed`: `DELETE … RETURNING id` の 1 文。件数のための `COUNT(*)` を別に撃たない。
- `finalize`: 成功行を `inJsonList` の 1 文、失敗行を `UPDATE … FROM json_each(?) AS failure WHERE outbox_events.id = json_extract(failure.value,'$.id')` の 1 文にし、両方を 1 回の `session.write` に積む。autocommit では 1 batch、UoW 内では commit と同一原子単位になる。

### Consequences

- 良い点: 「claim 済みの行が並行 worker に見えない」がバインディング上で成立する（適合スイートが観測する）。
- 良い点: finalize が失敗件数に比例しない。100 binding 上限にも触れない。
- トレードオフ: `UPDATE … FROM`（SQLite 3.33+）と `RETURNING`（3.35+）に依存する。D1 と DO の `ctx.storage.sql` はどちらも満たすことを実測で確認したが、SQL としては素朴な形より新しい。
- トレードオフ: `claimPending` / `pruneProcessed` は `session.query` を通る。staged セッションで呼ぶと write-set を素通りして即時に効いてしまうが、この 2 つは relay worker が UoW の外からしか呼ばない（ポート JSDoc）。

## ADR-017: `IdempotencyStore.markProcessed` は `session.staged` で経路を分ける

### Context

ポート JSDoc は 2 つを同時に要求する。(a) 原子的に記録し、並行呼び出しはちょうど 1 つだけ `true` を観測する。(b) 記録と本処理は同一平面の同一 UoW に入り、片方だけ commit されない。

autocommit では (a) は `INSERT … ON CONFLICT DO NOTHING RETURNING` の 1 文で満たせるが、staged セッションでは書き込みが commit まで実行されないので `RETURNING` を待てない。逆に staged で「先に読んで無ければ true」とすると、(a) の原子性が commit まで宙に浮く。

### Decision

`SqlSession.staged` を見て分ける（このフラグはまさにこのために置かれている）。

- **autocommit**: `INSERT … ON CONFLICT (consumer, event_id) DO NOTHING RETURNING event_id` の 1 文。返った行数が答え。
- **staged**: `readRow`（overlay 対応）で既存を見て、有れば `false`。無ければ「まだ無いこと」を主張する `_occ_guard` と INSERT を積んで `true` を返す。別の UoW と競って負けた側は commit 時に guard で中断し、二重に効果を commit することはない。

### Consequences

- 良い点: 「ちょうど 1 つが true」が両方の文脈で成立する。
- 良い点: 同一 UoW 内での二重呼び出しは overlay 読みが先に捕まえる。
- トレードオフ: staged 経路で負けた側が受け取るのは `false` ではなく commit 時の `OPTIMISTIC_LOCK_FAILURE` である。契約は「重複は `false`」と書いているが、これは呼び出しが完了した場合の話であり、UoW ごと巻き戻る側は効果も記録も残さないので契約違反にはならない。
- トレードオフ: 分岐が 1 つ増える。`session.staged` を見る実装はこの束ではここだけ。

## ADR-018: `ScopeRouter.forScope` が返す handle に scope 側 executor を載せる

### Context

`ScopeHandle` は `{ scope, key }` だけを portable と定め、「中身はアダプター定義」と明記している。memory 実装は 2 フィールドをそのまま返しているが、Cloudflare では scope の実体は Durable Object であり、名前から stub を得る手順（`scopeObjectName` + `idFromName` + `get`）はアダプターの内側にある。handle が名前しか運ばないと、受け取った側がもう一度同じ導出をやり直すことになる。

### Decision

`CloudflareScopeHandle = ScopeHandle & { executor: ScopeSqlExecutor }` を返す。`ScopeRouter` としては `ScopeHandle` を満たすので、契約は変わらない。名前空間（ADR-004、production は空文字）は `forScope` の引数ではなく factory の設定として通す。

### Consequences

- 良い点: handle が「scope の入口」として実際に使える。ステップ 13 の DI 合成が名前の再導出を持たずに済む。
- 良い点: ポート定義・適合スイートには一切手が入らない。
- トレードオフ: `forScope` の 1 回ごとに stub を 1 つ作る。`idFromName` / `get` はネットワークを伴わないので安いが、遅延生成にはしていない。

## ADR-019: `ScopeTaskScheduler` の settle に fencing token を足さず、`leaseMs` の運用下限で決着させる

plan.md AC-6 / Issue #11 コメント2 の決着。

### Context

`claimDue` はリースを取るが、`complete` / `backoff` / `schedule` は行キー `(kind, operationId)` だけで撃たれ、claim token を要求しない。リースを超過した writer の settle が、その間に別 writer が再 claim し武装し直した行を消しうる。実害は継続の鎖の停止に留まらず、personal cleanup の継続が止まれば `accountDeletionBarrier` が開いたまま User が `deleting` で残り、参照ランタイムに自動復旧経路が無い。

決着の材料は 3 つある。

1. **最終プラットフォームでは 1 scope = 1 Durable Object であり、単一 writer は構造的性質である。** DO は単一スレッドで、alarm ハンドラの多重起動は無い。`spec/platform/index.md` の Global Cron は scope object を列挙せず、scope-local な周回は必ず自分の Alarm で起動する（[ADR 021](../../spec/adr/021-scope-sharded-data-plane.md)）。したがって「リースを超過した旧 writer」が生き残るには isolate が生き残っている必要があるが、退避・再起動は isolate ごと落とす。本 Issue が実装するアダプター群の到達先では、fencing token が守る競合そのものが起きにくい。
2. **リースが守る対象は競合ではなく喪失である。** ポート JSDoc が既に「リースは助言的」「`leaseMs` は最悪ケースの turn（claim バッチ全体）を上回るよう配備が選ぶ」と規定し、`spec/platform/index.md` が下限（最悪 turn）と上限（oldest-task-age SLO）の帯を持つ。決着に要るのはこの帯を配備が守ることであって、契約の変更ではない。
3. **claim token を契約へ足すと application 層まで波及する。** `complete` を呼ぶのは runner ではなくユースケース本体である（`application/usage/deleteQuota.ts:90`、`application/cleanup/personalCleanup.ts:116`、`application/storage/deleteFilesByOwner.ts:128`）。これらは claim した `ScopeTask` を手元に持たず、継続要求の payload から key を復元して settle する。token を通すには継続要求の payload（[ADR 040](../../spec/adr/040-continuation-transport.md) の transport）とユースケース入力の双方に token を足すことになり、`spec/domains/` の継続要求の定義・適合スイート・memory 実装・Node runner まで同時に動く。しかも token を運ぶ payload 自体が「応答喪失後に同じ key で再駆動される」ことを前提にしているので、再駆動された turn が持つ token は必ず陳腐化する — 素朴に足すと回復経路（[ADR 040](../../spec/adr/040-continuation-transport.md)）を塞ぐ。

### Decision

**契約を変えない。**「`leaseMs` を十分に取る運用で足りる」を採り、前提を明文化する。

- **`leaseMs` の下限** — 1 回の claim バッチ全体を処理し切る最悪時間を上回ること。CF 配備では 1 turn = 1 scope で `SCOPE_ALARM_CPU_BUDGET_MS`（2 秒）+ ハンドラの外部 I/O が上限なので、既定の `SCOPE_TASK_LEASE_MS`（5 分）はこれを大きく上回る。
- **`leaseMs` の上限** — oldest-task-age SLO を持つ配備では、クラッシュ 1 回の回復がその SLO を食い潰さない値。帯は `spec/platform/index.md` が正本。
- **writer 多重度** — 1 scope に対する同時 writer は「DO 自身の alarm turn」1 本を既定とする。中央 runner（`listDue` → `claimDue`）を併走させる配備では、runner と alarm turn が同じ scope を同時に触りうるので、この既定が崩れる。**その構成を実配備する前に本 ADR を再訪すること。** 再訪の引き金は「1 scope に複数 writer」であって「複数 worker プロセス」ではない — scope が分かれていれば writer も分かれる。
- ポート JSDoc・適合スイート・`spec/domains/` は変更しない。ポート JSDoc は既にこの前提（リースは助言的、`leaseMs` は配備の選択）を書いており、本 ADR はそれを「決着済み」として確定させるもの。

### 検討した代替案

**claim token を契約へ足す。** `claimDue` が返す `ScopeTask` に token を持たせ、`complete` / `backoff` / `schedule` が token 一致を条件にする。競合を型と述語で潰せるので最も強い。採らなかったのは (a) 上の 3 の波及範囲、(b) 再駆動された turn の token が必ず陳腐化するため、token 不一致を「無視して settle」にするなら fencing にならず、「拒否」にするなら [ADR 040](../../spec/adr/040-continuation-transport.md) の回復経路を塞ぐ、という二律背反があるため。fencing を入れるなら token だけでなく「継続要求の再駆動が token をどう取り直すか」まで設計する必要があり、本 Issue（アダプター追加）の範囲を超える。

### Consequences

- 良い点: ポート契約・適合スイート・memory 実装・application 層に一切手が入らない。AC-8（[ADR 046](../../spec/adr/046-port-contract-divergence.md)）の手続きも発生しない。
- 良い点: CF 配備では単一 writer が構造的に成り立つので、残るリスクは中央 runner を併走させる構成に限定される。
- トレードオフ: 安全性が運用値（`leaseMs`）と配備形態の選択に依存する。型では守られない。上の 3 つの前提はレビューで議論の余地を残してある。
- トレードオフ: 中央 runner を実配備する判断が出た時点で、この ADR の再訪が必須の作業として残る。

## ADR-020: autocommit 経路の due index 反映はリポジトリが行い、alarm は再武装しない

### Context

[ADR 003](#adr-003-scopetaskqueuelistdue-は-global-d1-の-due-index-表で実装する) の due index は、scope object の `applyWriteSet(scopeKey, statements, touchedTables)` が `touchedTables` に `scheduled_tasks` を含むときに publish される。ところが UoW の外（autocommit）では `createAutocommitSession` が `executor.apply(statements)` を呼び、`createScopeStubExecutor.apply` は `touchedTables` を空で渡す。つまり UoW の外で `scheduled_tasks` を触っても index が更新されない。

これは実配備で効く経路である。中央 runner の `claimDue` / `backoff` / `complete` は scope UoW を開いて呼ぶ経路と開かない経路の両方があり、適合スイート `scopeTaskScheduler.ts` は `backend.forScope(scope).scopeTaskScheduler`（= autocommit）で schedule した行が `listDue` に現れることを観測する。

`touchedTables` を autocommit からも渡す（`createAutocommitSession` が mutation の表名を集めて `applyWriteSet` を呼ぶ）ことも考えたが、`applyWriteSet` は index publish と **alarm の再武装** を同じフラグで駆動している。適合スイートは偽クロック（2026-01-01 固定）で `due_at` を過去に置くので、alarm を武装すると workerd が即座に配送し、実クロックで走る alarm turn がテストの観測対象の行を横取りして `running` にする（`__tests__/alarm.test.ts` が同じ理由で武装を既定 off にしている）。

### Decision

`ScopeTaskScheduler` の実装が、`session.staged` が偽のときだけ、書き込み後に自分で index を publish する（`dueIndexRowsStatement` で自 scope の行を読み、`dueIndexStatements` を global D1 へ適用する）。規則そのものは `do/dueIndex.ts` / `do/scheduledTasks.ts` の共有関数のままで、繰り返すのは呼び出しの順序だけ。

alarm の再武装は行わない。武装は object の持ち分であり、object は「コミットされた write-set が `scheduled_tasks` を名指したとき」と「turn の終わり」に必ず行う。UoW の中で行われる `schedule`（実配備の全経路）はそちらを通るので、武装が落ちる経路は無い。

### Consequences

- 良い点: `sql/session.ts` / `do/scopeObject.ts` という束をまたぐ共有ファイルに手を入れずに済む。並列で進む他の束への影響が無い。
- 良い点: 偽クロックの適合スイートが実クロックの alarm turn と競合しない。
- トレードオフ: index publish の呼び出し順序が 2 箇所（object の `publishDueIndex` と本リポジトリ）に現れる。適用する文は共有関数のままなので規則は 1 つだが、「いつ publish するか」は 2 箇所で読む必要がある。
- トレードオフ: autocommit の 1 操作あたり RPC 1 往復（自 scope の行の読み）と D1 書き込み 1 回が増える。行数は 1 scope 分に限られる。

## ADR-021: contentless FTS の rowid は束縛値ではなく本体表からの `SELECT` で解決する

### Context

`note_search_fts` / `public_note_search_fts` は contentless（`content=''`）なので、行の取り消しには「挿入したときと同じ列値」と「対応する rowid」の両方が要る（`spec/database/index.md#note_search_fts`）。列値は生テキスト列に `bigramIndexText` を再適用すれば求まる（前処理は純関数）が、rowid は `note_search.rowid` であり本体行が存在して初めて決まる。

ところが ADR-001 の write-set 方式では、`replaceSnapshotIfNewer` が文を組み立てる時点で本体行がまだ storage に無いことがある。同じ UoW の中で 1 つのノートを 2 回投影する経路（作成 → タグ付けなど）では、2 回目の FTS 取り消しが必要とする rowid は「1 回目のステージした INSERT が commit 時に採番する値」であって、ステージ時には知りようがない。

選択肢:

1. **rowid を読み取って束縛する。** 素直だが上記のとおりステージ時には存在しないことがある。read-your-writes のオーバーレイにも rowid は無い（`snapshotRow` が作る行像は表の列だけ）。
2. **本体表に `fts_rowid` 列を足してアダプターが採番する。** 共有ファイル `do/schema.ts` と global migration の両方に列が増え、採番規則（衝突しない整数の払い出し）を新たに持つことになる。
3. **rowid を SQL の中で解決する。** FTS の取り消し / 挿入を `INSERT INTO fts(...) SELECT rowid, ?, ?, ? FROM <本体表> WHERE note_id = ?` の形にし、rowid は適用時に決める。

### Decision

3 を採る。取り消しは `INSERT INTO <fts>(<fts>, rowid, title_fts, text_fts, tag_names_fts) SELECT 'delete', rowid, ?, ?, ? FROM <本体表> WHERE note_id = ?`、挿入は同じ形の `SELECT rowid, ?, ?, ?` とする。FTS5 の特殊コマンドが `INSERT … SELECT` の形で動くことは workerd 上の D1 に対して実測して確認した。

write-set 内の文の順序は「取り消し → 本体 upsert → タグ入れ替え → 挿入」に固定する。取り消しは旧行の rowid を、挿入は新行の rowid を読むので、`remove` では取り消しを本体 DELETE より前に置く必要がある。

### Consequences

- 良い点: 同一 UoW で同じノートを複数回投影しても FTS が壊れない。1 回目のステージ結果を 2 回目が正しく取り消せる。
- 良い点: 共有スキーマ（`do/schema.ts` / global migration）に列を足さずに済み、並列で進む他の束に影響しない。
- 良い点: 本体行が無いとき `SELECT` が 0 行になるので、取り消しが自然に no-op になる。存在検査の分岐が要らない。
- トレードオフ: FTS の 2 文がどちらも本体表への相関副問い合わせを含む。`note_id` は主キーなので 1 行の索引探索で済む。
- 補足: 本束の適合スイート 23 件は FTS5 + bigram 実装で**一度も memory と食い違わなかった**（`ADR 046` の手続きに入る場面が無かった）。スイート本体は 1 行も変更していない。

## ADR-022: `removeForPurge` は無条件削除で冪等を満たし、専用の ack 表を作らない

### Context

`spec/usecases/note.md:743` は `removeForPurge` を「public 3 表の削除と operation の `projectionRemoved` ack を 1 transaction で確定する」と書いており、memory バックエンドは `publicPurgeAcks` という表に `(operationId, noteId)` を書いている。しかしその表を読む経路はコード全体に存在せず（`grep` で書き込み 1 箇所のみ）、`DistributedOperationStore` にも段階 ack を読み書きするメソッドは無い。適合スイート ADP-note-032 が観測するのは「同じ入力で 2 回呼んでも失敗せず、結果が同じ」ことだけである。

### Decision

`removeForPurge` は `public_note_search` / `public_note_search_tags` / FTS の行を無条件に削除するだけとし、global 側に ack 表を新設しない。既に消えた行を消すのは自然に no-op なので、再配送に対する冪等は削除の性質そのもので満たされる。

ack を実際に読む経路（`finishPurge` が ack 後にだけ tombstone 化する、という手順）が実装されるスライスで、その読み手と一緒に表を決める。

### Consequences

- 良い点: 誰も読まない派生表を global D1 に増やさない。migration も増えない。
- 良い点: 削除の冪等性が表の状態ではなく操作の性質から出るので、ack 行の保持期間・prune という新しい責務が生じない。
- トレードオフ: spec が言う「削除 + ack を 1 transaction」のうち ack 側が未実装のまま残る。読み手が現れた時点で、本メソッドと同じ transaction に足す必要がある（`spec/domains/note.md:668` が「同じ NoteId shard へ置く」と定めているので、後から足しても原子性は満たせる）。
- トレードオフ: memory バックエンドとの実装差になるが、ポートから観測できる振る舞いは同一なので契約の食い違いではない。

## ADR-023: 公開検索のページングは `note_id` キーセットで行い、bm25 ランクのカーソルにしない

### Context

`PublicSearchCriteria` には並び順の指定が無く、`PublicSearchPage` は正確な件数もページ番号も返さない。一方 ADR 011 は関連度順を `bm25` で求めると定めており、`spec/domains/note.md` のポート JSDoc は cursor を「shard generation + per-shard keyset / rank」と書いている。

`bm25` はスコアが浮動小数で、しかも索引の内容（他の行の挿入・削除）で変動する。これをカーソルに載せると、(a) 浮動小数の往復で境界行が飛ぶ・重複する、(b) ページ間で索引が変わるとスコアが動きキーセットの単調性が崩れる、という 2 つの壊れ方をする。物理 shard 化後は shard ごとのスコアを突き合わせる必要も出る。

なお plan.md のスコープは「`localNoteQueryService` / `publicNoteQueryService` の relevance 順の契約強化」を**含まない**と明記している。

### Decision

`searchPublic` / `listPublicSitemapEntries` / `listPublicAuthors` はいずれも `note_id`（authors は `owner_id`）の昇順キーセットでページングする。キーワードがあるときも FTS は母集合の選択にだけ使い、並べ替えには使わない。カーソルはクエリ条件の fingerprint を運び、条件が変われば `INVALID_PAGINATION` になる（`cloudflare/cursor.ts`）。

scope-local 側の `search` は事情が異なり、`sort` を明示的に受け、ページ番号ベースの `LIMIT/OFFSET` なので `relevance` を `bm25` 昇順でそのまま実装している。

### Consequences

- 良い点: ページ境界が安定する。索引が動いても同じカーソルが同じ位置を指す。
- 良い点: memory バックエンドと同じ並び（noteId 昇順）になり、適合スイートが両者で同じ結果を観測する。
- トレードオフ: 公開検索の結果が関連度順にならない。関連度順を公開検索の契約に入れるなら、カーソルの形（ランク + tie-break キー）とスコアの安定化をポート契約側で決める必要があり、それは適合スイートの変更を伴う別作業になる。

## ADR-024: scope 検証は「その列が本当に scope 鍵であるか」で決め、`stored_files` / `storage_quotas` には掛けない

### Context

`spec/database/index.md` の「共通の規約」は「scope table の `owner_type / owner_id` または `scope_type / scope_id` は object 自身の ScopeKey と一致しなければならない。adapter が復元・保存の両方で検査する」と定める。steps.md のステップ 8 もこれをそのまま担当項目に挙げている。

ところが適合スイートは、この検査を掛けると落ちるケースを意図的に持っている。

- `conformance/storedFileRepository.ts` は `scopeOf(1)` の repository へ `StorageOwner.user(userId(2))` のファイルを insert し、`listByOwner(otherOwner)` と `sumSizeByOwner(otherOwner)` がそれを返すことまで観測する。
- `conformance/storageQuotaRepository.ts` は `scopeOf(1)` の repository へ `QuotaSubject.workspace("w1")` の quota を insert し、`listBySubjects` がそれを返すことを観測する。

これは偶然ではない。`StoredFileRepository` のポート JSDoc が「`StorageOwner` records who the bytes count against and **never overrides the physical scope**」と明示しており、匿名の書き出しが作る artifact（[ADR 010](../../spec/adr/010-anonymous-export-and-ticket.md)）のように所有者と物理 scope が一致しない行が設計として存在する。

一方 `notes.owner_type / owner_id` は事情が違う。routing は NoteId から `note_routes` を引いて「その owner の scope object」へ到達するので、owner と物理 scope は定義上一致する。適合スイートも一致しない note を一度も作らない。

### Decision

scope 検証は**列が本当に scope 鍵であるとき**に掛ける。

- **掛ける**: `_scope_identity`（`ScopeObject.bind` が全 RPC で検査済み）、`notes.owner_type / owner_id`（`noteRepository` が insert / save と復元の両方で検査する）
- **掛けない**: `stored_files.owner_type / owner_id`、`storage_quotas.subject_type / subject_id`。これらは会計上の帰属であって物理 scope ではない

物理 scope の分離そのものは検査を省いても失われない。scope 側リポジトリの読み書きは必ず当該 DO の RPC を通り、`ScopeObject.bind` が呼び出しごとに ScopeKey の一致を検査する。掛けない列について守られなくなるのは「行の owner が object の名前と一致する」という**追加の**主張だけである。

[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) / [ADR 046](../../spec/adr/046-port-contract-divergence.md) の「正本のある側へ倒す」に従い、この振る舞いの正本はポート JSDoc と適合スイートにあると判断した。

### Consequences

- 良い点: memory と Cloudflare が同じ適合スイートを同じ結果で通る。契約を実装都合で狭めていない。
- 良い点: 「scope 検証」が何を守る規約なのかが一段はっきりする — 物理配置の分離は object 境界が担い、列の一致は「その列が scope 鍵である表」だけの不変条件になる。
- トレードオフ: `spec/database/index.md` の「共通の規約」の字面と実装が食い違う。規約が言う `owner_type / owner_id` は「scope 鍵として使っている列」を指すと読む、というのが本 ADR の定めである。
- トレードオフ: `stored_files` に owner の取り違えがあっても DB は教えてくれない。取り違えは usecase 側の誤りとして現れる。

## ADR-025: `deleteFilesByOwner` の 1 turn は「commit 1 回・SQL 文 4n + 3」であり、3 文の設計目標は取り下げる（AC-5）

### Context

`spec/platform/index.md` の「実行予算と分割単位」→「Scope DO」は、scope-local の一括削除について「1 turn の SQL 文数がバッチ件数に比例しない形で実装する（SQL バックエンドなら列挙 1 ＋ 多行 DELETE 1 ＋ 多行 outbox INSERT 1 の 3 文）」を**設計目標**として掲げていた。plan.md AC-5 はこれを実測し、満たせないなら実測値へ改めることを求めている。

実測は `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`。`application/storage/deleteFilesByOwner.ts` の storage 部分（`listByOwner` の列挙 → `deleteStoredFiles` → outbox flush）を、scope 実行器を数える wrapper で包んだ scope UoW の上で走らせている。outbox は設計目標が前提する形（`json_each` の多行 INSERT 1 文）で積んでいるので、stand-in のせいで悲観的になってはいない。

バッチ n 件あたりの実測値:

| 内訳 | 文数 |
| --- | --- |
| 列挙（ページ + `COUNT(*)`） | 2 |
| 1 件あたりの読み（`findById` + `delete` の版確認） | 2n |
| 1 件あたりの commit 内文（`_occ_guard` + `DELETE`） | 2n |
| outbox 多行 INSERT | 1 |
| **合計** | **4n + 3** |

commit そのものは件数によらず **1 回**（DO への RPC 1 往復 = `transactionSync` 1 回）である。

3 文が成立しない理由は SQL の書き方ではなく契約にある。

1. **一括削除メソッドが無い。** `spec/domains/storage.md` は「所有者単位の一括削除も 1 件ごとに `storage.fileDeleted` を発行して Usage の減算と実体の回収につなげる必要があるため、`listByOwner` + `deleteFiles` の反復で行い一括削除のメソッドは持たない」と定める。リポジトリは 1 件ずつしか消せない。
2. **OCC の版トークンは `findById` でしか採れない。** `TransactionalRepository` の JSDoc が「read with intent to write goes through `findById`」を型で強制している。多行 DELETE 1 文へ畳むと版トークンを捨てることになる。
3. **`listByOwner` は `PaginationResult` を返す。** 「full page と末尾を取り違えない」ための `count` が要るので、列挙は最初から 2 文である。

1 件あたり読みが 2 回になっているのは、`delete` が [ADR 008](#adr-008-_occ_guard-は「違反されるための表」として条件付き更新の直前に積む-1-文で実装する) の二段構え（ステージ時に読んだ値で先に判定して固有のエラーを投げ、guard は同時実行に対する砦）を取っているためである。この読みを省くと、UoW の中では版の不一致が `save` / `delete` の呼び出し地点ではなく commit で初めて現れる。`application/identity/updateProfile.ts` のように `OPTIMISTIC_LOCK_FAILURE` を呼び出し地点で捕らえて分岐する usecase があるので、省けない。

### Decision

`spec/platform/index.md` の当該行を実測値へ改める。約束するのは「**書き込みは件数によらず 1 回の原子適用**」であって「SQL 文数が件数に比例しない」ではない。

`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例した追加の往復を要求しない」は**動かさない**。あれは全バックエンドに課す観測可能な契約（列挙は 1 回、削除できた 1 件につき event 1 件）であり、バックエンドが発行する文の数を約束していない（[ADR 056](../../spec/adr/056-performance-budget-placement.md)）。

1 件あたりの読み 2 回を 1 回へ落とすことは可能だが、それには unit 内の版キャッシュか `findById` の一括読みが要る。[ADR 002](#adr-002-scope-uow-のコールバックは-worker-側で実行し確定だけを-1-回の-rpc-で-do-へ渡す) が「バッチ読み・プリロードによる削減は最適化であり、契約を満たしてから行う」と置いた通り、本 Issue の範囲外とする。

### Consequences

- 良い点: spec が実装の正本に戻る。達成されていない目標が canon に残らない。
- 良い点: 本当に守られている性質（commit が 1 回の原子適用であること）が明示され、テストがそれを固定する。
- トレードオフ: 既定バッチ 100 件では 1 turn が 403 文・203 往復になる。DO ローカル SQL に D1 の query 予算は掛からないものの、`spec/platform/index.md` の foreground p95 SLO に対する余裕は読み往復の削減で作ることになる。削減余地（1 件あたり読み 2 → 1、さらに `listByIds` による一括読みで n → 1）は残っている。
- トレードオフ: 実測値は `deleteStoredFiles` の実装形状に依存する。application 側が 1 件ずつ読む形をやめれば数は変わるので、本 ADR の数字は「今の application コードと今のポート契約の下での実測」である。

## ADR-026: 欠番

採番だけ消費し、本文は書かれていない。番号を詰めると既存の相互参照がずれるので空けたまま残す。本ファイルから ADR-026 を参照している箇所は無い。

## ADR-027: `membership_directory` は `operation_id` を edge key とし、`membership_id` を NULL 可にする

### Context

`AccountDeletionManifestStore.appendMembershipPage` は「所有 User の active / removing / pending edge を edge key 順に最大 100 件」ページングする契約で、適合スイートは `seedMembershipEdges` を持つバックエンドに対してのみページ内容を検査する（持たなければ 3 ケースを skip する）。土台のステップは `membership_directory` を作っておらず、Workspace ドメインにポートが無いのでリポジトリも無い。

`spec/database/index.md#membership_directory` の列定義は `operation_id` PK・`membership_id` NOT NULL・`role` NOT NULL・索引は (`user_id`, `state`, `created_at` DESC, `workspace_id`) と (`workspace_id`, `state`, `user_id`)。ところが

- 適合スイートの `MembershipEdgeSeedInput.membershipId` は `string | null` で、`pending` edge に `null` を渡す。spec 自身も `reserveAndClaimActivation` を「pending INSERT → 同 shard の Active User 検査 → activating 化」と定めており、pending 時点で workspace-local Membership はまだ存在しない
- spec の 2 本の索引はどちらも「edge key 昇順の keyset」を走れない

### Decision

`0001_global_schema.sql` に表を足し、spec から 2 点だけ離れる（当初は `0003_membership_directory.sql` として足したが、ADR-041 で 0001 へ畳んだ）。

1. `membership_id` を NULL 可にし、`CHECK (state NOT IN ('active','removing') OR membership_id IS NOT NULL)` で settled edge にだけ要求する。
2. keyset 用に `(user_id, operation_id)` の索引を足す。`operation_id` が account deletion manifest のページングする edge key である。

spec の 2 本の索引と recovery 用の部分索引はそのまま作る。表を読むのは現時点で `appendMembershipPage` だけで、書くのは適合ハーネスの `seedMembershipEdges` だけ。Workspace スライスがポートを足すときに `role` の値域や `deletion_prepare_*` の使い方を決めることになる。

### Consequences

- 良い点: skip されていた 3 ケース（ページ内容・100 件上限・cleanup lane）が実行対象になり、`appendMembershipPage` の契約が本当に検証される。
- 良い点: 正本（spec）の列名・状態・索引をそのまま使うので、Workspace スライスが表を再設計せずに済む。
- トレードオフ: spec の列定義と 2 点食い違う。`spec/database/index.md` 側を改める（`membership_id` の NULL 可と keyset 索引）のがステップ 13 の追随作業に入る。
- トレードオフ: `d1/schema.ts` の `GLOBAL_TABLES` / `GLOBAL_TABLES_IN_WIPE_ORDER` に 1 行ずつ足す必要がある。足さないと適合バックエンドの wipe から漏れ、同一ファイル内の別テストへ seed が漏れる。

## ADR-028: `distributed_operations` の 2 本の一意索引は `kind` を含める

### Context

migration 0001 は `UNIQUE(partition_key, request_key)` と `UNIQUE(partition_key) WHERE state NOT IN ('completed','rejected')` を作っている。一方 `DistributedOperationStore` の適合スイートは「同じ partition key を共有する kind どうしを分ける」ケースを持ち、`accountDeletion` が running のまま同じ partition・同じ request key で `noteMove` を始めて、両者が別 operation になることを要求する。0001 の索引ではどちらの制約違反にもなる。

`spec/database/index.md#distributed_operations` は `UNIQUE(partition_key) WHERE kind = 'accountDeletion' AND ...` と書いており、正本は kind を含む側にある。

### Decision

2 本を kind 込みで張る（`(kind, partition_key, request_key)` と `(kind, partition_key) WHERE state NOT IN (...)`）。あわせて `countTerminalSince` が使う terminal 索引にも kind を入れ、partition 走査用の `(kind, partition_key, id)` を足す。当初は `0003_membership_directory.sql` で `DROP INDEX` してから作り直したが、ADR-041 で 0001 へ畳み、`0001_global_schema.sql` が最終形だけを張る。

spec が `kind = 'accountDeletion'` に限っているのは accountDeletion の説明の文脈だからで、ポート契約は全 kind に対して同じ規則（partition ごとに running は 1 件）を要求している。実装は全 kind へ一般化した形を採る。

### Consequences

- 良い点: 「partition ごとに running 1 件」を DB 制約として持ったまま、kind をまたぐ操作が共存できる。
- トレードオフ: 索引の作り直しが migration 3 に入るので、0001 だけを読んだ人には現在の索引形が見えない。spec 側の記述を全 kind へ一般化する改訂がステップ 13 に入る。

## ADR-029: manifest のページ書き込みは `json_each` の 1 文にし、write-set のオーバーレイに載せない

### Context

`AccountDeletionManifestStore` のページはどれも最大 100 件（membership append / author route append / claim の command key 付与 / ack / compaction / prune）。`spec/database/index.md` の共通の規約は「ID の並びで引く / 消す / 入れるクエリは `?` を件数ぶん並べない」と定め、バインド変数の上限は 100 なので、1 行 1 文にすると 100 行 × 数列で即座に超える。

一方 `RowMutation` で行像をオーバーレイへ残せるのは `upsert` / `remove` の単一行だけで、多行の 1 文は `opaque` にしかできない。`opaque` はオーバーレイに寄与しないので、同一 UoW 内で「ページを append した直後に同じページを読み返す」ことができない。

### Decision

item 側の書き込みはすべて `json_each` の 1 文（`opaque`）にする。header 側は単一行なので `upsert` のままオーバーレイに載せる。item の読みは `readRows` ではなく `query` を使う — item にはオーバーレイが一切載らないと決めた以上、`matches` を持たない `readRows` が他 operation のステージ行を拾う余地を残す理由が無い。

### Consequences

- 良い点: 1 ページ = 1 文。`spec/platform/index.md` の実行予算にそのまま収まり、バインド変数上限に触れない。
- トレードオフ: 同一 UoW 内で append 直後の item を読み返せない。現在のユースケースは page を積む transaction と読む transaction が別なので契約上は問題にならないが、将来「積んで数えて分岐する」UoW を書くときはここが効く。
- トレードオフ: header と item でオーバーレイの扱いが非対称になる。リポジトリ内で読み分けが要る。

## ADR-030: ランタイム合成の 4 メソッドを `AppRuntime` として抽出し、CF 版はその実装として置く

### Context

`memoryRuntime.ts` の `MemoryRuntime` は `bindRelayTrigger` / `bindScopeTaskTrigger` / `createRequestContainer` / `createWorkerContainer` の 4 メソッドに加えて `backend` / `mailSender` というランタイム固有の値を持つ。Cloudflare 版を足すにあたり、この 4 メソッドを共通インターフェイスとして抽出するか、CF 版を独立した型として定義するかを決める必要がある（steps.md ステップ 13）。

制約として **`memoryRuntime.ts` と `serverNode.ts` には触れない**（AC-7）。したがって「抽出して両者に `implements` を書く」ことはできない。

### Decision

`application/di/runtime.ts` に `AppRuntime`（4 メソッドのみ）を置き、`CloudflareRuntime = AppRuntime` とする。`MemoryRuntime` には注釈を足さない — TypeScript は構造的なので、`MemoryRuntime` は既に `AppRuntime` を満たしている。その事実は `adapters/cloudflare/__tests__/runtimeComposition.test.ts` の 1 ケース（`asAppRuntime(memoryRuntime)`）で型として固定した。注釈は memoryRuntime.ts に触れてよいスライスが足す。

`backend` / `mailSender` は `AppRuntime` に入れない。エントリポイントがバックエンドを名指しせずに依存してよい部分だけを型にする。

CF 版が memory 版と形を変えた点は 3 つ。

1. **保持する状態が無い。** memory 版は `MemoryBackend` を 1 つ抱えるが、CF ではバインディング自体が状態なので、`createCloudflareRuntime(options)` は `env` の薄い包みでよい。`serverNode.ts` の `globalThis` シングルトンに相当する仕掛けは要らない。
2. **`mailSender` を必須オプションにした。** Cloudflare 版の `MailSender` アダプターは本 Issue のスコープ外で存在しない。既定でログ出力の stand-in へ落とすと、検証メールが黙って無効になる配備を型が許してしまう。合成根で必ず渡させることで穴を可視にした。
3. **暗号 / トークン系は `adapters/memory/` のものをそのまま使う。** `createScryptPasswordHasher`（`node:crypto`、`nodejs_compat` 下で動作）/ `createNodeSecureTokenGenerator` / `createWebCryptoShareTokenProtector`。これらが `memory/` に同居しているのは [ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md) が「2 つ目のバックエンドが実在する時点で再検討する」と書いた対象そのもので、本 Issue では移さず別 Issue の起票候補とする。鍵束の既定生成だけは `node:crypto` の `randomBytes` ではなく `crypto.getRandomValues` を使う。

### 検討した代替案

**CF 版を独立した型として定義する。** 抽出しないぶん変更が最小になる。採らなかったのは、4 メソッドが「合成根とは何か」の定義そのものであり、2 つ目が現れた時点で名前を与えないと、3 つ目（MCP server / CLI）が微妙に違う形を持ち込むのを型で止められないため。抽出のコストは新規ファイル 1 つで、memory 側に一切触れない。

**`packages/core/src/adapters/cloudflare/runtime.ts` へ置く。** ファイルが CF プログラム（`tsconfig.cloudflare.json`）に自然に入る。採らなかったのは、合成根は adapters 層ではなく application 層の持ち分であり、`memoryRuntime.ts` と並べて読めることに価値があるため。代わりに `tsconfig.json` の `exclude` と `tsconfig.cloudflare.json` の `include` に当該 1 ファイルを明記して、プログラムの割り当てだけを移した。

### Consequences

- 良い点: `serverNode.ts` / `memoryRuntime.ts` に一切触れずに済み、AC-7 が保たれる。
- 良い点: エントリポイントが `AppRuntime` だけに依存できるので、配備スライスの Worker entry がバックエンドを名指ししない。
- トレードオフ: `MemoryRuntime` が `AppRuntime` を満たすことはテスト 1 ケースでしか固定されていない。`memoryRuntime.ts` に注釈を足すまでは、そのケースを消すと乖離が静かに通る。
- トレードオフ: `application/di/cloudflareRuntime.ts` が 2 つの tsconfig にまたがる例外になる。ファイルを増やすときは両方を更新する必要がある。

---

## ADR-031: 適合スイートの入口は束ごとの 7 ファイルのままにし、呼び出し集合の一致は node 側のテストで固定する

### Context

steps.md ステップ 11 は Cloudflare 側の入口を `adapters/cloudflare/__tests__/conformance.test.ts` という単一ファイルに置く想定だった。実際には ADR-011（束ごとに独立して回せること）を満たすため、`__tests__/conformance/{identity,directory,route,scopeBusiness,scopeInfra,projection,unitOfWork}.test.ts` の 7 ファイルに分かれている。

分割そのものは問題ないが、単一ファイルなら memory 側の `conformance.test.ts` と目視で並べられた「30 スイートを両バックエンドが同じだけ呼んでいる」という性質が、7 ファイルに散ると見えなくなる。適合スイートの間引きは緑のまま起きるので、これは AC-2 の中身が静かに空になる経路になる。

### Decision

7 ファイルの分割は残す。そのうえで `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`（node プロジェクト）を置き、次の 2 つをテストとして固定する。

1. memory 側 `memory/__tests__/` の呼び出し集合と Cloudflare 側 `cloudflare/__tests__/conformance/` の呼び出し集合が**完全に一致する**
2. `adapters/conformance/` が export している `describe…Contract` のうち、`adapters/**/__tests__/**/*.test.ts` のどこからも呼ばれていないものが**無い**

判定はソースの走査であってスイートの import ではない（import すればスイートが走ってしまう）。行頭の呼び出しだけを数えるので、コメントアウトは削除と同じだけ目に見える。

実測（本ステップ完了時点）: 両バックエンドとも 30 スイート・**適合スイート由来 238 ケース**で一致。`describeSignInOAuthClientContract` だけがどちらの永続バックエンドからも呼ばれていないが、これは `adapters/oauth/__tests__/conformance.test.ts` が 2 実装に対して呼んでおり、そもそも永続バックエンドのポートではないので正当。2 の検査が `adapters/` 全体を走査するのはこのため。

### 検討した代替案

**7 ファイルを 1 つに統合する。** steps.md の当初案どおりになる。採らなかったのは ADR-011 の分離要件（束ごとに独立して回せること）が実装中の生産性そのものであり、統合すると 1 束の修正のたびに 238 ケースを回すことになるため。

**報告に件数を書くだけにする。** 実装時点の一致は示せるが、次に誰かがスイートを 1 本外したときに何も鳴らない。適合スイートは契約の正本（ADR 026）なので、その呼び出し集合は人間の注意力ではなくテストで守る。

### Consequences

- 良い点: 束の分割を保ったまま、AC-2 の「間引きで達成していない」がテストとして残る。
- 良い点: 新しい適合スイートを書いて配線し忘れると 2 の検査が落ちる。
- トレードオフ: 判定がテキスト走査なので、呼び出しを行頭以外（関数で包む、ループで回す）に書くと検知できない。両バックエンドの入口ファイルが平坦な呼び出しの並びである限り成立する。
- トレードオフ: この検査は node プロジェクトにある。Cloudflare 側のファイルを読むが実行はしないので、workers プールに置く理由が無い。

---

## ADR-032: `databaseError` は cause が無いときメッセージに `: undefined` を継ぎ足さない

### Context

`sql/errors.ts` の `databaseError(context, cause?)` は `cause` を任意にしながら、メッセージを常に `` `${context}: ${messageOf(cause)}` `` で組んでいた。cause を渡さない呼び出しは 2 箇所ある — `sql/json.ts` の `assertBindable`（bound parameter 上限超過）と `d1/repositories/loginAttemptStore.ts` の「`RETURNING` が行を返さなかった」— いずれもドライバの失敗ではなくアダプター自身の異常で、cause が存在しない。結果、上限超過は `"Statement binds 101 parameters…: undefined"` で落ちていた（plan.md エッジケース 1 の当該メッセージ）。

### Decision

`databaseError` を `cause === undefined` のとき `context` のみをメッセージにするよう直す。呼び出し側（`assertBindable` / `loginAttemptStore`）は変えない — 署名が `cause?` を許している以上、破綻していたのは組み立て側である。

固定は `__tests__/support.test.ts` の「refuses a statement that would exceed the driver's binding limit」で、アンカー付き正規表現によりメッセージ全体を突き合わせる（部分一致だと末尾の `: undefined` が復活しても通ってしまう）。

### Consequences

- 良い点: cause の無い DatabaseError が、失われた原因を持っているかのように読めなくなる。
- 良い点: 上限超過のメッセージが件数と対処（`json_each`）だけを述べる形に戻り、呼び出し元の特定に使える。
- トレードオフ: `databaseError` に分岐が 1 つ増える。cause を必須にして専用のコンストラクタを分ける手もあるが、呼び出し 18 箇所のうち 2 箇所のために型を割る価値は無いと判断した。

---

## ADR-033: outbox `save` の 1 binding サイズ上限は `assertBindable` ではなくリポジトリ側で見る

### Context

`OutboxRepository.save` は 1 UoW ぶんのイベントを `jsonRows` で 1 つの binding に畳む。`assertBindable` が守っているのは binding の**個数**（100）だけで、値の**サイズ**（1 値 2,000,000 バイト、`spec/platform/index.md` 実上限）は誰も見ていない。payload の大きいイベントが並ぶと、静かに上限へ触れる。

### Decision

`d1/repositories/outboxRepository.ts` に `MAX_SAVE_BINDING_BYTES = 1_000_000` を置き、`save` が直列化した JSON のバイト数を測って超過を `SystemError(DatabaseError)` で落とす。`sql/json.ts` の `assertBindable` は触らない。

- **置き場所**: サイズ超過は「この呼び出しが渡した件数と payload」の問題なので、件数を添えたメッセージを出せるのは呼び出し側だけである。汎用の `assertBindable` に足すと、どの binding が大きいのかを言えない検査になる。`do/dueIndex.ts` 側の同種の上限（routing W-008 のもう半分）も同じ理由でそれぞれの生成地点が持つ。
- **上限値**: 実上限の半分。`spec/platform/index.md` が D1 query 数（実上限 1,000 に対し設計上限 500）で採っているのと同じ取り方で、残りはドライバ自身の framing の余地とする。
- **分割ではなく失敗**: サイズで chunk に割ると 1 commit の文数が増え、ADR-008 の「`_occ_guard` で文数が最大 2 倍」と同じ予算を押す。イベント payload は識別子を運ぶ設計で 1MB に達するのは異常事態なので、静かに壊れる代わりに落とす側へ倒す。

固定は `__tests__/routeGuard.test.ts`「refuses a batch too large for one bound value…」。

### Consequences

- 良い点: 上限に触れる経路が呼び出し地点で落ち、メッセージが件数とバイト数を名指しする。
- トレードオフ: 1MB を超える正当なバッチは保存できない。到達したら分割ではなくイベント設計（payload に本文を載せていないか）を疑う合図として扱う。
- トレードオフ: サイズ検査が 1 箇所に集約されていないので、新しい「1 binding に畳む」書き方を足す実装者は自分で上限を置く必要がある。

---

## ADR-034: 駆動エラーの翻訳はドライバを直接叩く地点にだけ置き、ポートを再利用する側では包まない

### Context

routing 束の 6 ファイルが `throwTranslated` を持っていなかった（`_occ_guard` の発火が生の `CHECK constraint failed` として application 層へ抜ける）。埋めるにあたり `scopeRouter.ts` の扱いが問題になった。`ScopeRouter.resolveNote` は自分で SQL を撃たず、`NoteRouteStore.resolve` を呼ぶだけである。

### Decision

`session.query` / `readRow` / `readRows` / `write` を**直接**呼ぶ地点だけを `try / catch` で包む。`scopeRouter.ts` は翻訳を持たない。

`throwTranslated` は cause を `classifySqlError` で分類し、`occGuard` 以外を `SystemError(DatabaseError)` にする。すでに翻訳済みの `ConflictError` / `NotFoundError` を通すと `unknown` に分類され、`NOTE_NOT_FOUND` が `DatabaseError` に化ける。ポートを再利用する側で包むのは、翻訳の二度掛けであり実害がある。

### Consequences

- 良い点: 翻訳が「ドライバに触れる 1 箇所」に限られ、CLAUDE.md「adapter → application」と同じ形になる。
- 良い点: `scopeRouter` は `noteRouteStore` の翻訳を通じて契約を満たす。ファイルを見ると翻訳が無いように見えるが、SQL を撃っていないので正しい。
- トレードオフ: リポジトリ内でも「自分のエラーを投げる分岐」を `try` の中に入れると同じ事故が起きる。本 PR の実装は分岐を `try` の外に出す形で揃えてある。

## ADR-035: `readRows` のオーバーレイは「補正できない読み」を静かに返さず拒む

### Context

ADR-009 の `readRows` は「SQL の結果からこの unit が触れた行を除き、ステージ済み行を足し、`limit` で切る」という形で read-your-writes を作る。この機構には、規律だけで支えられている穴が 2 つあった。

1. **`matches` が optional だった。** 省略すると当該表のステージ済み行が `WHERE` と無関係に全部混ざる。JSDoc は「全表読みのときだけ省いてよい」と書いていたが、書き忘れと意図的な省略が型の上で同じ形になる。
2. **`limit` と同一 unit 内の削除が両立しない。** オーバーレイは SQL が既に返した集合から引くことしかできない。`LIMIT n` が満杯で返り、そのうち 1 件がこの unit の削除に当たると、結果は n-1 件になる。storage 側に控えている n+1 件目は繰り上がらない。`limit + 1` 件読んで `hasMore` を決めるページングと組むと `hasMore` が false 側へ誤る。

どちらも現時点で踏んでいる呼び出し元は無い（`readRows` の全呼び出しが `matches` を渡し、`limit` と staged 削除が同居する経路も無い）。

### Decision

- `matches` を必須にし、全表読みは `ALL_ROWS` という名前の述語を明示的に渡す。省略と「全部通す」が別の字面になる。
- staged session の `readRows` は、`limit` が指定され、SQL の結果が `limit` に達して打ち切られており、かつその中にこの unit が削除した行が含まれるとき、`databaseError` で**拒む**。短いページを返すことも、storage へ読み直しに行くこともしない。
- `opaque` は `table` を名乗れる形（`opaque({ table, statement })`）にし、名乗った表は `touchedTables()` に入る。`WriteSet.markTouched` は撤去する。

### Consequences

- 良い点: 「補正できない読み」が呼び出し地点で落ちる。`assertBindable` と同じ位置づけ — 起きたらアダプターのバグであって実行時条件ではない。
- 良い点: `opaque` で `scheduled_tasks` を触っても due index publish と alarm 再武装が飛ばなくなる。規約を JSDoc ではなく `stage` の分岐が担う。
- トレードオフ: `opaque` の `table` は依然 optional である。OCC guard のように書く表に commit 時フックが無い statement のほうが多く、必須化は 44 箇所の呼び出し元を書き換える。「名乗れる形にして `markTouched` を消す」ところまでで止め、必須化は行っていない。
- トレードオフ: 同一 UoW 内で掃引しながらページングしたくなったら、`readRows` ではなく `query`（素通し）を選ぶ必要がある。ADR-014 の `deleteExpiredPage` は既にそうなっている。

## ADR-036: 1 commit の文数上限は global 平面にだけ置く

### Context

`spec/platform/index.md`「実行予算と分割単位」→ Global D1 は 1 Worker invocation あたりの D1 query を 500（実上限 1,000 の半分）と定める。1 commit = 1 `batch()` = 文数ぶんの query なので、write-set の大きさはそのまま予算の消費である。ADR-008 の `_occ_guard` により 1 commit の文数は最大 2 倍になる。ところが `assertBindable` が「1 文あたりの binding」を守っているのに対し、「1 commit あたりの文数」は誰も見ていなかった。

同じ節の Scope DO は「scope-local SQL に D1 の query count は掛からない」と明記し、代わりに 1 turn あたりの**行数**（50 notes / 100 rows / 200 assignments …）で有界化している。ADR-025 の実測どおり scope 平面の commit 内文数は `2n + 1` で件数に比例するが、その有界性は行数上限が既に与えている。

### Decision

`MAX_STATEMENTS_PER_COMMIT = 250`（500 の半分）を置き、global 平面の commit だけがこれを検査する。超過は `databaseError` で、文数と上限を名指しして落とす。scope 平面には置かない。

250 の半分という取り方は、1 invocation が「write-set を作った読み」と「その commit」の両方を賄うことによる。guard による 2 倍は 250 の**内側**で数える。

### Consequences

- 良い点: 予算超過が本番の overage ではなく commit 地点の例外として現れる。バッチ上限を上げた変更が静かに予算を割ることがない。
- 良い点: 上限が置かれていない平面（scope）について「なぜ置かないか」が型ではなく spec の別軸（行数）に紐づくと明示される。
- トレードオフ: 250 は根拠のある切り方だが実測ではない。global 平面の最大 commit は現状 outbox の多行 INSERT 1 文 + 実体書き込みで、余裕は大きい。将来 shard 化で 1 commit が複数 shard へ散るようになれば、平面ではなく shard 単位で数え直す必要がある。

## ADR-037: maintenance run の guard 敗北は、その呼び出しが読みで出したのと同じ答えへ倒す

### Context

`GlobalMaintenanceRunStore` の D1 実装だけが `_occ_guard` を 1 つも積んでおらず、「10 分 lease の保持者だけが進める」というポート JSDoc の契約を、`requireLeasedRun` の**読み**しか支えていなかった。読みと適用のあいだに別 owner が lease を奪っても、先行 writer の `checkpointLane` / `advanceOrAck` はそのまま着地する。

run 行を書く 4 か所（`beginOrResumeKind` の resume 分岐と新規作成、`recoverLease`、`advanceOrAck` の run 完了）と lane 行を書く全経路に guard を前置するところまでは他の store（ADR-008 の二段構え）と同じでよい。決めるべきは**敗北の翻訳先**である。レビューの提案は一律 `ConflictError("MAINTENANCE_LEASE_HELD")` だった。

### Decision

guard が外れたときは、**同じ条件を読みで観測していたらその呼び出しが返したはずの値**へ倒す。

- `beginOrResumeKind`: `{ result: "leased" }`。ポートは「live な foreign owner が持つ run」を戻り値で表現しており、呼び出し側（`pruneExpiredAuthState`）はそれを見て静かに降りる。新規作成分岐にも「この kind に running が無い」guard を足したので、同時 start の敗者もここへ落ちる。
- `recoverLease`: `false`。読み経路が live な foreign lease に対して返すのと同じ値。
- `claimLanes` / `checkpointLane` / `advanceOrAck`: `foreignLease`（`MAINTENANCE_LEASE_HELD`）。これらは読み経路でも同じ `ConflictError` を投げる。

lane の guard は `NoteRouteStore` と同じ行同一性（`status` / `table_index` / `cursor IS ?`）で、run の guard は読んだ `status` / `lease_owner` / `lease_until` そのもの。

### Consequences

- 良い点: 敗者の答えが「直列に実行されていたら得たはずの答え」と一致する。cron が並走しても `beginOrResumeKind` から例外が出ず、`ConflictError` を握る呼び出し側を新設せずに済む。
- 良い点: 奪われた旧 owner の checkpoint が着地しない（cursor の巻き戻し・table_index の二重進行が起きない）ことを `__tests__/globalConcurrency.test.ts` が実バインディングで観測する。
- トレードオフ: `beginOrResumeKind` の guard は「lease を奪われた」以外に「その run が完了した」でも外れる。後者でも `leased` を返すので、直後の 1 回は空振りする。次の cron が新しい run を立てるので停止はしない。
- トレードオフ: レビューの提案（一律 `foreignLease`）から外れている。ポートが戻り値で表現している状態を例外へ格上げしない、という理由で倒した。

## ADR-038: 同じ hour bucket の完了済み run は「作り直し」て `started` を返す

### Context

`candidateRunId` は `authStatePrune:${hourBucket}:${generations}` と決定的で、完了した run は 30 日保持される。同じ bucket 内で run が完走したあとに cron / 手動再駆動が入ると、`readRunningRun` は null（completed なので）を返し、素の `INSERT` が run_id の PK 違反を起こして `SystemError(DatabaseError)` になっていた。memory は `table.set(candidateRunId, …)` で完了行を上書きして `started` を返す。ポート JSDoc は "only after completion does a candidate run start fresh (`started`)" なので正本は memory 側にある（ADR 046 の手続き）。

### Decision

run 行を `ON CONFLICT (run_id) DO UPDATE SET status='running', tables=…, as_of=…, lease_owner=…, lease_until=…, completed_at=NULL, expires_at=NULL` にする。lane は `DELETE FROM … WHERE run_id = ?` の後に入れ直す — memory が lanes 配列ごと差し替えるのと同じ形にし、shard 構成が縮んだときに前の run の lane が残って完了不能になる経路を塞ぐ。

作り直しに倒すと「同時に 2 人が start する」が上書きで通ってしまうので、この分岐にも `SELECT 1 WHERE NOT EXISTS (running run of this kind)` の guard を前置する（敗者は ADR-037 のとおり `leased`）。

### Consequences

- 良い点: 両バックエンドの観測が揃う。DB 障害と区別できない `SystemError` が再駆動で出なくなる。
- トレードオフ: 完了行の `completed_at` / `expires_at` が消えるので、同じ bucket の前回 run の完了時刻は追えなくなる。`pruneCompleted` の対象からも外れる（次の完了で入り直す）。
- トレードオフ: lane の DELETE が run 作成のたびに 1 文増える（1 時間に 1 回の経路なので予算上は無視できる）。

## ADR-039: pending auth token の読みは新しい順に固定し、部分 UNIQUE は置かない

### Context

`spec/database/index.md#auth_tokens` は「pending token は (`user_id`, `purpose`) で部分 UNIQUE とし最大 1 件」と定める。一方、適合スイート ADP-identity-024 は同一 `(userId, 'email_verification')` の pending token を 2 件 insert するので、この索引を張るとスイートが落ちる。実装は索引を置かない側（ポート契約側）に倒っていたが、その判断がどこにも残っていなかった。実害は `findPendingByUserAndPurpose` が `ORDER BY` 無しの `LIMIT 1` なので、pending が複数あると戻り値が SQLite の走査順まかせになる点にある。ポート JSDoc はこの読みを「トークンが最後に発行された時刻の唯一の読み取り」と位置づけ、再送間隔の判定材料にしている。

### Decision

部分 UNIQUE は置かない（最大 1 件は usecase 側が `deleteByUserAndPurpose` で保つ）。あわせて `findPendingByUserAndPurpose` を `ORDER BY created_at DESC, id DESC` にし、write-set のオーバーレイ側にも同じ `compare` を渡して、複数 pending 時の戻り値を「いちばん新しい発行」に固定する。

memory は挿入順の `find` なので複数 pending 時の観測は D1 と揃わないが、適合スイートに複数 pending を観測するケースは無く、契約としては未定義の領域にある。memory を触らずに済む側（AC-7）を採った。

### Consequences

- 良い点: 再送間隔の判定が非決定でなくなる。DESC を採ったので、複数 pending が生まれても間隔判定は保守側（直近の発行を基準）に倒れる。
- トレードオフ: 「1 件しかない」を DB が保証しない。`deleteByUserAndPurpose` を撃ち忘れた経路があれば静かに複数溜まる。
- 宿題: `spec/database/index.md#auth_tokens` の当該記述を「DB 制約としては置かない」へ改める（束 7）。複数 pending 時の戻り値を契約にするなら適合スイートに 1 ケース足す話になるが、それは別 Issue。

## ADR-040: `reserve` の unique 違反は PK 衝突と `operation_id` 衝突を区別する

### Context

`identity_unique_reservations` は PK `(kind, normalized_key)` に加えて `operation_id` に UNIQUE を持つ。`reserve` の INSERT は `ON CONFLICT (kind, normalized_key) DO UPDATE` を積んでいるので PK 衝突は例外にならず、この文が上げうる unique 違反は**実質 `operation_id` 側だけ**である。ところが `translateReserve` は `unique` を無条件に `heldByAnother`（`EMAIL_ALREADY_USED` など）へ翻訳していた。1 つの operation ID で 2 鍵を予約する呼び出しが現れると、**空いている鍵に対して「使われています」と返す**。

`activate` の「複数行を全部か無かで publish する」というコメントも、`operation_id UNIQUE` の下では `readByOperation` が 0/1 件しか返さないので成立しない。

### Decision

`translateReserve` は unique 違反のメッセージが `identity_unique_reservations.operation_id` を名指すかを見て、名指す場合は `databaseError` に倒す（呼び出し側の契約違反であって、鍵の奪い合いではない）。成立しないコメントは削り、「1 operation = 最大 1 行」という物理スキーマ側の前提をファイル JSDoc に 1 行で残す。

「1 operation = 何行か」をポート JSDoc・memory の `rowsByOperation`・D1 スキーマの三者でそろえる話は本 PR では倒さない（別 Issue へ defer）。

### Consequences

- 良い点: 空いている鍵を「使われている」と誤って拒む経路が消える。
- トレードオフ: 列名でのメッセージ照合が `classifySqlError` の外に 1 つ増える。`classifySqlError` は制約の**種別**しか返さないので、どの索引かを知るにはここで見るしかない。索引名を変えたらこの照合も追随が要る。
- 残る乖離: ポート JSDoc の `activate` / `release` は複数行に対する操作として書かれたままで、memory も複数行を許す。今日の呼び出し側は鍵ごとに別 operation ID を導出するので実害は無い。

## ADR-041: 未適用の global D1 schema は 0001 に畳み、migration version 定数は置かない

### Context

`0003` が `0001` の張った `distributed_operations` の索引を `DROP INDEX` して kind 込みで作り直しており、`0002` は一度も存在しなかった。append-only の規律は「どこかに適用済みだから書き換えられない」ことに由来するが、この schema はまだどの配備にも当たっていない（本番配備一式は本 Issue のスコープ外）。加えて `GLOBAL_MIGRATION_VERSION` / `SCOPE_MIGRATION_VERSION` はどこからも読まれず、global 側は `0003` の追加後も 1 を名乗ったままだった。

### Decision

`0003` の内容（`membership_directory` と kind 込みの索引）を `0001_global_schema.sql` へ畳み、`0003` を削除する。global D1 の migration はふたたび 1 ファイルになる。2 つの migration version 定数は削除し、`do/schema.ts` の「両平面は同じ migration version を共有する」という一文も、値を持たない以上は主張を弱める。

### Consequences

- 良い点: 索引が 2 世代あるように見える状態と欠番が同時に消え、`spec/database/index.md` の「両者は同じ migration version」も 1 対 1 で真になる。
- トレードオフ: append-only を今から始めるなら、最初の配備の直前にこの規律へ切り替える判断が別途要る。
- 追随が要る箇所: ADR-027 / ADR-028 が `0003_membership_directory.sql` を名指していた 2 箇所は、本 ADR の決定に合わせて書き換え済み。

## ADR-042: 2 つの vitest プロジェクトの境界は 1 箇所に置く

### Context

`node` は `packages/core/src/adapters/cloudflare/**` を丸ごと exclude し、`workers` は `src/adapters/cloudflare/**/__tests__/**/*.test.ts` を include していた。集合は交わらないが**和集合が全体を覆っておらず**、`adapters/cloudflare/` 直下や `d1/` 直下の `.test.ts` はどちらのプロジェクトも拾わない。`pnpm test` は緑のままそのファイルを走らせない。

### Decision

境界の綴りをリポジトリ直下の `vitest.shared.ts` に 1 つだけ置き、`node` の exclude と `workers` の include の両方をそこから導く。`workers` の include はディレクトリ全体（`**/*.{test,spec}.ts`）へ広げ、`node` が除外する範囲と一致させる。

### Consequences

- 良い点: 片方だけ広げても他方が自動で狭まるので、窓が開かない。
- トレードオフ: ルートの vitest config が `packages/*` の下のファイルではなくルートの共有モジュールに依存する（config 同士が循環しないための向き）。

## ADR-043: 適合スイートの本数は絶対値で固定する

### Context

`conformanceCoverage.test.ts` の 2 つの検査はどちらも集合の相対比較で、スイート本体と 2 つの呼び出し行を同時に消せば両方とも通ったまま契約が 1 本消える。

### Decision

`exported.size` と `memoryCalls.size` を絶対数（31 / 30）で固定する。数値を書き換えることが「契約を 1 本増減させた」という宣言になる。

### Consequences

- 良い点: スイートごと消す—間引きの一番素直な形—が赤くなる。
- トレードオフ: ポートを 1 つ足すたびにこの 2 つの数字も更新する。意図した増減なら 1 行、そうでなければ検知したかった事象そのもの。

## ADR-044: `claimDue` の per-row 排他は `_occ_guard` で閉じる

### Context

`ScopeTaskScheduler.claimDue` は候補を読み、条件付き `UPDATE`（述語は候補判定の再掲）をステージし、適用結果を見ずに候補全件を `ScopeTask` として返していた。SQLite は 0 行更新をエラーにしないので、候補読みと commit のあいだに別の writer が同じ行を取ると、敗者の `UPDATE` は no-op として成功裏に commit され、**敗者も勝者と同じ行を受け取る**。ポート JSDoc は「two `claimDue` calls running at once never hand out the same row」と無条件に約束しており、memory は UoW 直列化でこれを満たしている。契約を変えた記録は無く、単なる実装漏れだった。

DO 経由の commit は `applyWriteSet` が `void` を返すため、`RETURNING` / `meta.changes` で「実際に当たった行」を取り出す経路が無い。

### Decision

`claimStatement` の直前に、候補述語を `(kind, operation_id)` で絞った `occGuard` を `opaque` で積む（ADR-008 の形をそのまま適用）。敗者の commit は CHECK 違反で中断し、`ConflictError("OPTIMISTIC_LOCK_FAILURE")` になる。

同じ文を実行する alarm turn 側にも同じ guard を積む。turn は候補読みと `transactionSync` のあいだに `await` を持たないので現状は guard 無しでも安全だが、その安全性はコードから読み取れず、`await` を 1 つ足した瞬間に同じ壊れ方をする。

共有適合スイート（`adapters/conformance/scopeTaskScheduler.ts`）には並行 claim ケースを**足さない**。両バックエンドの契約変更にあたり、偽クロック下の並行ケースは memory の直列化と観測が噛み合わない。CF 側は `__tests__/lease.test.ts` のバックエンド固有ケースで閉じ、共有スイートへの追加は別 Issue に送る。

### Consequences

- 良い点: 2 つの runner に提示された 1 行が 2 度配られなくなり、継続要求の二重実行が消える。実バインディング上で「2 本の `claimDue` のうち行を返すのはちょうど 1 本、もう 1 本は `OPTIMISTIC_LOCK_FAILURE`」が観測できるようになった（`_occ_guard` の CHECK 名は Durable Object の RPC 境界を越えても保たれることが実測で確認できた）。
- トレードオフ: 1 回の `claimDue` が複数行を掴むとき、1 行でも競合すれば batch 全体が中断して 0 件になる。ポート JSDoc が「offering one row to two runners costs no more than a claim one of them loses」と budget している範囲であり、runner は次 tick で取り直す。
- 同一 UoW 内で `claimDue` を 2 回呼ぶと、2 回目は 1 回目のステージ済み claim に guard が外れて中断する。契約は同一 UoW 内の二重 claim を要求していない（候補読みは意図的にオーバーレイを通らない）ので、これは正しい振る舞いとして受け入れる。

## ADR-045: scope object が継続を駆動するのは、ハンドラレジストリが空でないときだけ

### Context

`ScopeObject.applyWriteSet` は `scheduled_tasks` を触れば無条件に alarm を武装し、`alarm()` は無条件に turn を回していた。同時に `createWorkerContainer` は `scopeTaskQueue` を配線しており、中央 runner（`runDueScopeTasks`）も同じ scope の行を claim する。ADR-019 の「契約を変えない」という決着は「1 scope に対する writer は 1 本」という前提の上に立っているのに、既定の合成が 2 writer 併走になっていた。

さらに `registerScopeTaskHandler` の呼び出しはリポジトリ内に 0 件で、レジストリは常に空だった。空のまま武装すると turn は行を claim し、ハンドラが無いので `running` のまま放置し、`nextWakeAt` が lease 満了を返して再武装する。中央 runner の `listDue` はリース中の行を候補から外すので、継続要求は永久に進まない。

### Decision

**レジストリが空なら、object は継続の driver ではない**とみなす。すなわち turn は 1 行も claim せず、`rescheduleAlarm` は alarm を武装せずに削除する。レジストリに 1 つでもハンドラがあれば、従来どおり object が driver になり、alarm を武装して turn を回す。

対案 (b)（`createWorkerContainer` から `scopeTaskQueue` を外す）は採らない。ADR-003 の due index は中央 runner の `listDue` のために新設した表であり、ポート契約が `listDue` の実装を要求しているため。

レビューの対案 (a) は「claim せず `rescheduleAlarm` だけ行う」だったが、そのままでは過去の `due_at` に対して alarm を武装し続け、何もしない turn が即座に再配送される tight loop になる。武装まで止めるのがこの決定の要点である。

### Consequences

- 良い点: 「どちらが writer か」がレジストリという 1 つの事実から決まり、既定の合成で 2 writer が併走しなくなる。配備スライスはハンドラを登録するだけで object 側へ倒せる。
- due index の publish はレジストリの有無にかかわらず行う。中央 runner が driver である配備では、これが唯一の可視化経路になる。
- `registerScopeTaskHandler` は解除関数を返す。テストが登録をリセットできるようにするための形で、テスト専用 export を置かずに済む。
- `runScopeAlarmTurn` はハンドラ表を引数でも受け取る（既定はモジュールレジストリ）。これでハンドラ経路（成功 / 失敗 / 予算切れ）を実バインディング上でテストできる。

## ADR-046: alarm turn は失敗を backoff し、予算切れの claim 済み行は release する

### Context

`runScopeAlarmTurn` の `await handle(task, scope)` には `try / catch` が無く、ハンドラが投げると turn 全体が中断していた。その chunk で claim 済みの残り行は訪問されないまま `running` で残り（turn 自身の JSDoc が「訪問しない行を claim してはならない」と書いている状態そのもの）、失敗した行は `backoff` されないので `attempts` が 0 のまま `SCOPE_TASK_MAX_ATTEMPTS` に永久に届かない。参照実装の `application/workers/scopeTaskRunner.ts` は同じ位置に `try / catch` + `backOff` を持っている。

CPU budget（`while (remaining > 0 && elapsedMs() < cpuBudgetMs)`）が打ち切るのは次チャンクの claim だけで、claim 済み最大 10 件のハンドラ実行は budget の外側にあった。AC-6 の `leaseMs` 下限論拠（1 turn = 2 秒 + 外部 I/O）が担保されていない。

### Decision

- ハンドラ実行を 1 件ずつ `try / catch` で囲み、失敗した行は turn 内で `backoffStatement` を撃つ（alarm 内なのでローカル適用）。turn は残りの行を訪問し続ける。
- ハンドラ実行の**前**にも budget を見る。超過したら、その chunk の未訪問行を `releaseStatement`（`status='pending'`, `lease_expires_at=NULL`、`due_at` と `attempts` は据え置き）で返して turn を終える。backoff ではなく release にするのは、誰も試していない仕事に attempt を払わないため。
- `ScopeAlarmTurnResult` に `failed` / `released` を足し、`unhandled > 0` は `Logger` へ落とす。

### Consequences

- 良い点: 恒久的に失敗する継続が attempt を積んで `failed` に park するようになり、ポート JSDoc の attempt ceiling が成立する。予算切れで claim 済みの行が 1 リース期間ぶん不可視になる経路も消えた。
- `releaseStatement` はポートの状態遷移表に無い内部遷移である。turn の内側だけで使い、claim した本人がリースを返す形なので、他の writer との競合は起きない。
- トレードオフ: 失敗が 1 件でも `attempts` が進むので、外部要因（D1 の一時障害など）で連続失敗すると ceiling に早く届く。これは中央 runner の既存の振る舞いと同じで、バックエンド間の非対称は生まない。

## ADR-047: `ScopeObject` は束縛済み ScopeKey をメモ化し、due index スライスは有界にする

### Context

`ScopeObject.bind` は RPC のたびに `INSERT INTO _scope_identity … ON CONFLICT DO NOTHING` と `SELECT` を撃っていた。`query` も `applyWriteSet` も毎回これを通るので、読み 1 回が 3 文になり、読み専用の RPC が（衝突して no-op でも）暗黙の書き込みトランザクションを開いていた。AC-5 の計測ハーネスは executor の呼び出し回数を数えていたので、この分は「実測」に入っていなかった。

`dueIndexRowsStatement` は `status <> 'failed'` の全行を LIMIT 無しで読み、`dueIndexStatements` がそれを 1 つの JSON バインディングに畳んでいた。scope のタスク総数に対して無界で、1 値 2,000,000 バイトの上限に無防備だった。

### Decision

- 束縛済み ScopeKey をインスタンスに保持する。constructor の `blockConcurrencyWhile` で `_scope_identity` を 1 回読み、以後 `bind` は文字列比較だけになる。まだ pin されていない object だけが INSERT + 読み戻しを 1 度行う。
- 解析と列変換は `do/scopeName.ts` の `scopeColumns` / `scopeColumnsFromName` / `scopeFromColumns` に寄せ、`scopeObject.ts` と `scopeTaskScheduler.ts` のインライン再実装を消す。
- `ScopeObject` の SQL は `createStorageExecutor` を通す。scope 平面でも `assertBindable`（bound parameter 100）が効くようになり、`createScopeStubExecutor` も送信前に同じ検査を掛ける。
- `dueIndexRowsStatement` は優先度ごと 25 行（4 優先度で最大 100 行）に有界化する。フラットな `LIMIT` ではなく優先度ごとにするのは、`listDue` が優先度ごとに 1 枠予約する規則を持つため、ある優先度の滞留が別の優先度を索引から丸ごと押し出さないようにするため。

### Consequences

- **AC-5 の実測値（`bind` メモ化後）**: `deleteFilesByOwner` の 1 turn で scope object が実際に実行する SQL 文数は **`4n + 3`**。n=10 で 43 文、n=40 で 163 文。内訳は読み `2n + 2` 文（`2n + 2` 回の RPC 往復、1 往復 1 文）と、1 回の commit に入る `2n + 1` 文。`__tests__/deleteFilesByOwner.test.ts` は executor 呼び出し数と **object の内側で実行された文数**の両方を数え、両者が一致することを固定した。したがって `4n + 3` は「executor 呼び出し数」ではなく DO 内の実文数として引用してよい。
- 読み経路から書き込み文が消えた。読み専用 RPC が暗黙の書き込みトランザクションを開くこともなくなる。
- due index のスライスは scope のタスク総数によらず最大 100 行になる。溢れた行は索引に載らないが、載っている行が settle されるたびにスライスが再公開されるので順に現れる。scope 自身の alarm turn は `scheduled_tasks` を直接読むので、この打ち切りの影響を受けない。
- **残る制約**: due index の行は素の `ScopeKey` を持ち、テスト名前空間 prefix を持たない（prefix は production のデータに漏れてはならない列に入る）。ADR-004 の factory ごとの分離が届かない唯一の表であり、UoW 経由で scope task を触るテストを同一ファイルに並べると相互汚染しうる。制約として `do/dueIndex.ts` の JSDoc に明記した。ADR-045 により既定ではレジストリが空＝ alarm が武装されないので、「先に作られた object の alarm が後から index を書き戻す」経路は実際には塞がっている。

## ADR-048: 公開カーソルは署名しない — 契約語のほうを実装へ寄せる

### Context

`PublicNoteQueryService` のポート JSDoc は「Cursors are **signed** opaque values … condition changes, **tampering**, and retired generations surface as `ValidationError("INVALID_PAGINATION")`」と書いていた。実装は memory も Cloudflare も base64url した JSON で、載っているのは criteria から決定的に計算できる fingerprint だけである。fingerprint を作り直せば `after` は任意に動かせるので、契約語の「署名」「改竄検出」は両バックエンドとも満たしていない。

### Decision

[ADR 046](../../spec/adr/046-port-contract-divergence.md) の「正本のある側へ倒す」に従い、**実装ではなくポート JSDoc を直す**。cursor は「opaque かつ query fingerprint 付き。認証はされていない」と書き、あわせて「cursor はページの開始位置だけを決め、内容は決めない。可視性の述語は cursor によらず毎回掛かるので、cursor を capability として扱ってはならない」を契約として明記した。

HMAC を入れる側に倒さなかった理由:

- 両バックエンドが同じ振る舞いなので、実装を変えるなら memory も同時に変わる。AC-7 が「memory バックエンドの振る舞いを変更していない」を求めており、本 PR のスコープを越える。
- 鍵の出所（DI・ローテーション・世代跨ぎの検証）を決める必要があり、それは物理 shard 化で `shard generation` を cursor に載せる時点の判断と一体である。
- 守るべきものが cursor 側に無い。`searchPublic` / `listPublicSitemapEntries` / `listPublicAuthors` はいずれも `visibility = 'public' AND lifecycle = 'active'` を必ず掛けるので、位置を飛ばしても非公開行には届かない。

### Consequences

- 変更したのは `domain/note/ports/publicNoteQueryService.ts` の JSDoc と、`adapters/cloudflare/cursor.ts` の JSDoc・拒否メッセージ（"Tampered or retired" → "Unreadable or retired"）だけ。適合スイートは 1 行も変えていない（`ADP-note-025` が実際に観測しているのは「読めない cursor」と「条件が変わった cursor」で、どちらも fingerprint 検査で落ちる）。
- memory 側の `cursor.ts` の JSDoc とメッセージには同じ文言が残っている。振る舞いは同じなので緑のままだが、文言の追随は memory を触ってよい機会に回す。
- 将来 cursor を認証するなら、契約を強める変更として両バックエンド + 適合スイートを同時に動かすこと。

## ADR-049: 検索の 1 ページは本文を運ばない — ハイライトは 2 文目で前方 4,000 文字だけを見る

### Context

`note_search` / `public_note_search` の `text` は投影された本文で、1 行あたり最大 800,000 バイト（ADR 017）。`NoteSummary` / `PublicNoteSummary` にこの列から作るフィールドは無く、使うのはハイライトが「excerpt に一致が無かったとき」だけである。にもかかわらず読みは `SELECT ns.*` で全行の本文を引いていた。limit 20 のページが最悪 16 MB を DO の RPC や D1 の応答に載せる形で、Workers の 128 MB という実上限に対して素直でない。

`mapPositions` は写像を作るために 1 文字ずつ NFKC を掛けていたが、NFKC は合成を含むので文字単位の適用は文字列全体の適用と等しくない。本文が結合列（`か` + U+3099）で保存されていると、索引側（`bigramIndexText` は文字列全体に掛ける）は `が` を入れて FTS はヒットするのに、ハイライト側の needle が見つからず `highlightedExcerpt` が `null` に落ちていた。

### Decision

- ページの投影を `summaryColumns()` にする（`text` 以外の全列）。
- ハイライトが本文を要るのは「keyword があり、かつ excerpt に一致が無かった行」だけなので、その note_id だけを対象に 2 文目を撃つ（`bodyHighlights`）。列は `substr(text, 1, 4000)`。
- 写像は書記素クラスタ単位で正規化して作る（`Intl.Segmenter`）。合成はクラスタの内側で閉じるので、結合列も文字列全体の NFKC と一致する。

### Consequences

- 1 ページが運ぶ本文は最悪 `limit × 4,000` 文字になり、キーワード無しの検索では 1 文字も運ばない。文数は「keyword があり excerpt 不一致の行がある」ページでのみ +1。
- 前方 4,000 文字より後ろにしか一致が無い本文はハイライトが `null` になる。行自体は従来どおりヒットし、view は素の excerpt へ落ちる — ADR 011「既知の限界」がすでに「title だけで一致した行」「トークン境界を跨いだ一致」に対して認めている落ち方と同じで、memory バックエンドは元々 excerpt しか見ないので契約上の差にもならない。`spec/database/index.md`「既知の限界」へこの 1 行を足すのは束 7 の持ち分。
- 書記素クラスタ単位でも、クラスタを跨ぐ文脈依存の小文字化（ギリシャ語の語末シグマなど）は文字列全体の結果と一致しない。その場合はハイライトが `null` に落ちるだけで、誤った位置には決してならない。
- `highlightExcerpt(excerpt, text, keyword)` は `highlightExcerpt(excerpt, keyword)` と `highlightBody(text, keyword)` の 2 本に割れた。「excerpt を優先し、無ければ本文の窓」という順序は呼び出し側（クエリサービス）が持つ。

## ADR-050: `redactAuthor` は条件付き UPDATE ではなく guard で決める

### Context

ポート JSDoc は「A missing row, a row created by someone else, and a row already at that generation or later are all no-ops … Returns whether a row changed」。実装は読んだ行から 3 つの no-op を判定したうえで、`UPDATE … WHERE note_id = ? AND created_by = ? AND author_version < ?` を積み、無条件に `true` を返して overlay にも赤字化した行を置いていた。並行更新でこの UPDATE が 0 行に当たっても戻り値は `true` のままで、同じ UoW の後続の `readStored` は storage が受け取らなかった値を返す。

### Decision

条件を `occGuard` に移し、UPDATE 自体は `WHERE note_id = ?` の無条件更新にする。guard は「期待が成り立たないときだけ実行され、実行されれば必ず CHECK に反する」文なので、読んだときの判定が commit 時に崩れていれば unit ごと中断する。

### Consequences

- 戻り値 `true` は「行が変わった」と一致する。当たらなかった場合は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が出て、赤字化の fan-out は at-least-once なので再配送で読み直し、そのときは新しい行を見て `false` の no-op に落ちる（収束は変わらない）。
- overlay に置く行が storage の結果と食い違わなくなる（食い違うなら commit しない）。
- guard は両平面の `_occ_guard` に載る。D1 の batch も DO の `transactionSync` も同じ形で中断する。

## ADR-051: scope の読みは「件数に比例しない」ところまで絞る

### Context

`listMonthsWithNotes` は所有者の active ノート全件（`SELECT DISTINCT created_at`）を Worker のメモリへ引き上げていた。`created_at` はミリ秒なので実質 1 ノート 1 行で、10 GB まで伸びる scope では 1 RPC が数万〜数十万行を返す。`spec/platform/index.md`「Scope DO」の分割単位表は他の全経路に 50〜200 行の上限を置いており、ここだけ無界だった。`noteRevisionRepository` は削除・件数判定のためだけに `html` を含む全列（1 ノート 20 版 × 800,000 バイト）を読んでいた。`ObjectStorage.deleteMany` は R2 の 1 回 1,000 key の上限を見ていなかった。

### Decision

- `listMonthsWithNotes` は UTC 日でまとめ、日ごとの `MIN(created_at)` / `MAX(created_at)` だけを返す。1 日は 1 か月より短いので、その日のどのノートも「最古の instant の月」か「最新の instant の月」のどちらかに属する。よってこの 2 つで、その日に現れる月は漏れなく尽きる。SQL に IANA タイムゾーンを持ち込まずに済み、行数は「書き込みのあった日数」に落ちる。
- `noteRevisionRepository` の削除・保持判定は `SELECT id, created_at` に絞る。`listByNote` は `LIMIT` を SQL に落とす。
- `ObjectStorage.deleteMany` は 1,000 key ずつに切って順に消す。不在許容なので途中で落ちても再実行できる。

### Consequences

- 削除は依然 1 行 1 文（`deleteRowsFromJson` の 1 文にしていない）。`remove` mutation は同時に「この unit が消した行を後続の読みに見せない」overlay の項目でもあり、`RowMutation` には文を伴わない overlay 専用の形が無いためで、保持不変条件が 1 ノート 20 行に抑えている。文を 1 本にするなら `RowMutation` 側に overlay 専用の形を足す変更が要る。
- `listMonthsWithNotes` の行数は「書き込みのあった日数」であって定数上限ではない。scope の寿命に対して線形（10 年で最大 3,650 行、1 行 3 整数）で、ノート件数からは切れている。定数上限にするには月境界の instant を JS で列挙して `json_each` + `EXISTS` に落とす形になるが、DST を含むタイムゾーン境界の算術を自前で持つことになるので採らなかった。
- R2 の上限行を `spec/platform/index.md` の R2 表へ足すのは束 7 の持ち分。

## ADR-052: 本番ソースから `.thread/11/adr.md` への参照を全廃し、理由そのものをその場に置く

### Context

`packages/core` と `spec/` の 24 箇所が、この作業ファイルを「ADR 001」「ADR 003」「ADR 004」といった番号で参照していた。`spec/adr/001-authentication-strategy.md` 〜 `004-workspace-roles.md` は実在するので、同じファイルの中で「ADR NNN」が 2 つの名前空間を指すことになり、リンクを踏まない読み手は取り違える。加えて CLAUDE.md「Design canon」は canon を `spec/` に限っており、`.thread/` は Issue が閉じれば参照が死ぬ作業ディレクトリである。このリポジトリで本番ソースが `.thread/` を指すのは本 PR が初めてだった。

### Decision

本番コード・`spec/`・`docs/` から `.thread/11/adr.md` への参照を 24 箇所すべて外す。番号の付け替えではなく、**判断の理由そのものを 1〜2 行でその場に書く**。CLAUDE.md「コメントは既定で書かない。WHY が自明でないときだけ」に照らせば、必要なのは参照ではなく理由である。

- 参照先の JSDoc が既に理由を述べていた箇所（`writeSet.ts` の「どちらの実行基盤もコールバック形を取れない」、`scopeStub.ts` の「コールバックは RPC を越えられない」など）は、括弧の引用を落とすだけで内容が残る。
- 理由が引用にしか無かった箇所は書き足す（`scopeObject.ts` の `GLOBAL_DB`、`noteRouteStore.ts` の guard、`scopeTaskScheduler.ts` の fencing と alarm 非再武装）。
- `spec/adr/` の既存 ADR への参照はそのまま残す。canon であり番号空間も 1 つである。
- 番号空間を明示する書き方（`.thread/11/adr.md ADR-003` など）へ統一する案は採らない。作業ファイルへの参照が本番ソースに残ること自体が、Issue の完了とともに切れるリンクを作る。

### Consequences

- 良い点: `grep -rn "\.thread" packages apps spec docs` が 0 件になり、番号の衝突が構造的に消える。
- 良い点: 理由が読む場所にある。ADR を開かないと分からない記述が本番ソースから無くなる。
- トレードオフ: 検討した代替案・棄却理由といった長い経緯は本ファイルにしか無い。読み手が要求と判断の背景まで辿りたい場合の入口が 1 つ減る。恒久的に要る背景は `spec/adr/` への昇格で持ち上げるべきで、その候補は本 Issue の報告に挙げる。

## ADR-053: `identity_unique_reservations` は `user_version` を残し、`(user_id, kind)` 索引を落とす

### Context

どちらも `spec/database/index.md` の列表・索引に無く、実装だけが持っていた。`user_version` は `activate(operationId, expectedUserVersion)` が受けた版を書くが読み手が無い。`(user_id, kind)` 索引も `user_id` で引くクエリが無い。memory バックエンドは `DirectoryRow.userVersion` を同じく持ち、索引という概念は持たない。

### Decision

- `user_version` は**残し、spec の列表へ足す**。`spec/database/index.md#identity_unique_reservations` は「応答喪失は operation payload の全 key と現在の User/Identity version を確認して all-activate または all-release へ再開する」と定めており、活性化時に観測した版を行が持っていることがその照合の材料になる。memory も同じ値を持つので、両バックエンドの行像も揃う。
- `(user_id, kind)` 索引は**落とす**。読み手が無い索引は D1 の write コストにそのまま乗り、必要になった時点で足せる。

### Consequences

- `identity_unique_reservations` の書き込みが索引 1 本ぶん軽くなる。
- `user_id` で予約を列挙する経路が現れたら索引を足す判断が要る。今日そういうポートメソッドは無い。

## ADR-054: `identities` の 8 件上限に DB トリガーを置かない

### Context

`spec/database/index.md#identities` は「UserId shard の最終 UoW で current 件数を検査し、`BEFORE INSERT` trigger も同じ `user_id` が既に 8 件なら abort する」と多層防御を定めていた。実装はアプリ側検査（`IdentityPolicy`）だけを持つ。

### Decision

トリガーは置かない。`spec/database/index.md` の当該行を、置かない旨と理由を述べる形へ改める。

`IdentityRepository` の契約は件数を制約しておらず、適合スイートもこれを観測しない。そのうえ SQLite のトリガーが abort した結果はドライバのエラーとしてしか届かず、アダプターはそれを `SystemError(DatabaseError)` にしか翻訳できない — `IdentityLimitExceeded` は業務規則の符号であって、駆動エラーからは復元できない。したがってトリガーは多層防御にならず、上限違反を不透明な障害の裏へ隠すだけになる。[ADR 054](../../spec/adr/054-provider-account-uniqueness-owner.md) が provider account の一意性について採った「契約が要求しない制約は、ドメインの符号を壊さない範囲でだけ置く」と同じ立場である。

### Consequences

- 上限を決める場所がドメインの `IdentityPolicy` ひとつになる。
- 直接 SQL で行を足す運用操作は上限を越えられる。ポート経由でない書き込みは元より契約の外なので、これは新しい穴ではない。

## ADR-055: `account_deletion_manifests` / `global_maintenance_runs` の spec 節をポート契約側へ寄せる

### Context

物理表を 2 つ（`account_deletion_manifest_items` / `global_maintenance_run_lanes`）足すにあたり、header 側の列を spec に書き下ろすと既存の記述と食い違うことが分かった。spec は header の状態を 9 値（`buildingMemberships` … `compactingRejected`）とし、`request_key` 列と `UNIQUE(user_id, request_key)` を持つとしていたが、`AccountDeletionManifestHeader` は 5 値（`building` / `built` / `rollingBack` / `completed` / `rejected`）で `requestKey` を持たない。`global_maintenance_runs` も `state` ではなく `status`、`expires_at` の索引条件も同じ綴りの食い違いがある。

### Decision

ポート契約側へ寄せ、spec の当該節を書き直す（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)：永続化ポートの正本はポート定義と JSDoc）。

- header の status は 5 値。縮約の進み具合は item 行の残数が持つので、`compacting` / `compactingRejected` に相当する状態を header に足さない。
- header は `request_key` を持たない。同じ要求の再生を弾くのは `distributed_operations` の `UNIQUE(kind, partition_key, request_key)` であり、要求鍵の正本を 2 つ置かない。
- 2 表分割そのものの理由も spec に書く（item は 100 件ずつ伸びるので header 行に畳めない、lane は 1 行ずつ条件付き更新するので run 行の版を奪い合わせない）。

### Consequences

- `spec/database/index.md` の当該 2 節がポートと 1 対 1 になる。
- account deletion の状態機械を語る `spec/usecases/identity.md` 側に 9 値の名前が残っていれば、そちらの追随が別途要る（本 Issue では確認していない）。

## ADR-056: `claimDue` の競合はポート契約に「投げうる失敗」として書き、耐えるのは runner

### Context

[ADR 044](#adr-044-claimdue-の-per-row-排他は-_occ_guard-で閉じる) が `claimDue` に `_occ_guard` を積んだ結果、敗者の commit は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` になる。しかしポート JSDoc のエラー契約は `SystemError(DatabaseError)` の 1 行のままで、CF バックエンドは契約を満たさない実装として出荷される形になっていた。

実害も残っていた。`runDueScopeTasks` は `claimDue` を `try` の外で呼んでおり、1 scope の競合がその tick の残り全 scope を巻き添えにする。staged セッションでは guard が write-set の commit 時に発火するため、アダプターが「0 件の batch」へ畳み直す地点が存在しない — 競合は必ず呼び出し側へ届く。

### Decision

**契約へ「投げうる失敗」として書き、耐性は呼び出し側に置く。**

- ポート JSDoc のエラー契約行に `ConflictError("OPTIMISTIC_LOCK_FAILURE")` を足す。条件（候補読みと claim 適用のあいだに別 writer が同じ行を取った）、結果（batch 全体が 0 件になり次ラウンドで取り直す）、そして「staged なバックエンドは commit で初めて発火するのでアダプターでは握れない」まで書く。
- 契約を**弱めない**追記である。「投げうる」であって「投げねばならない」ではないので、UoW の直列化で排他を得ている memory はこの経路で決して投げず、追記後も契約を満たす。memory 実装と共有適合スイートは変更しない（AC-7 / ADR 044 の「並行 claim ケースは共有スイートへ足さない」を踏襲）。
- `runDueScopeTasks` は `claimDue` を per-scope の `try / catch` で囲み、**`ConflictError` に限って** その scope を skip して round を続ける。それ以外は再送出する。

### 検討した代替案

**アダプター内で競合を空 batch へ畳む。** 呼び出し側が何も知らずに済むので契約は動かない。採らなかったのは、staged 経路では guard が write-set の commit 時に発火し、その commit を待つのは `claimDue` の呼び出しフレームではなく UoW の `run` だから — アダプターに畳む場所が無い。autocommit 経路だけ畳むと、同じポートが配備によって違う失敗形を持つことになる。

### Consequences

- 良い点: 契約の正本（ポート JSDoc）と CF 実装の振る舞いが一致し、AC-8 の食い違いが消える。
- 良い点: 競合した scope の行は claim されないまま残る（`due_at` も `attempt` も動かない）ので、次 tick が取り直す。at-least-once と冪等性の前提はどちらも動かない。
- トレードオフ: skip の対象は契約行が名指した `ConflictError("OPTIMISTIC_LOCK_FAILURE")` の 1 コードに限る（[ADR-072](#adr-072-claimdue-の-skip-は-optimistic_lock_failure-の-1-コードに限る)）。別コードの `ConflictError` はその tick を落とすので、契約へ失敗形を足すときは runner の条件も一緒に広げる必要がある。
- 観測は application 層の `scopeTaskRunner.test.ts` に置いた（1 scope の claim だけを `ConflictError` に差し替え、同じ round の別 scope が処理され切ることを固定する）。runner の耐性はバックエンド非依存の性質なので、実バインディング上の競合の観測（staged 経路で guard が発火すること）は `__tests__/lease.test.ts` 側の担当のまま。

## ADR-057: control-plane store の「集合」と「状態機械」で原子化の道具を変える

### Context

D1 の control-plane store は「読んで判定 → 書く」を D1 への別 round trip で行うため、判定と適用のあいだに別 writer が入る。Round 002 で 3 か所が残っていた。

- `accountDeletionManifestStore.acknowledgeReceipt` — receipts を JSON 配列の read-modify-write で積んでいた。receipt を積むのは互いに独立した継続の鎖（`authResidue` / `uniquenessRelease` / `personalCleanup`）で、どれも terminal turn を通過済みなので二度と ack を撃たない。後勝ちで 1 件消えれば `allRequiredAcknowledged` が永久に false になり、account deletion が恒久停止する。
- `accountDeletionManifestStore.writeHeader` — 状態機械を持つ D1 store で唯一 `_occ_guard` を 1 つも積まない形だった。
- `identityUniqueDirectory.activate` — guard が User の版しか見ず、UPDATE が `(kind, normalized_key)` だけで当たるため、失効予約を奪った別 operation の行を active 化しうる。同ファイルの他 3 メソッドは予約行の同一性を述語に持つ CAS になっており、非対称だった。

### Decision

**書き込みの意味が「集合への追加」なら guard を積まず文自体を冪等にし、「状態遷移」なら読んだ行像に対する CAS にする。**

- `acknowledgeReceipt` は `CASE WHEN EXISTS (SELECT 1 FROM json_each(receipts) WHERE value = ?) THEN receipts ELSE json_insert(receipts, '$[#]', ?) END` の 1 文にする。receipts は可換な集合なので、交差した ack はどちらも残るのが正しい答えであって、敗者を作る理由が無い。早期 return は round trip 節約として残すが、正しさはそこに依存しない。
- `writeHeader` は「読んだ `status` と一致すること」の guard を前置し、UPDATE の `WHERE` にも同じ条件を足して、外れたら既存の `stateViolation` へ翻訳する。`acknowledgeReceipt` はこの経路から外す — status 遷移と ack は独立で、ack の最中に `markBuilt` が着地しただけで ack が落ちるのは偽の失敗になる。
- `activate` は他の 3 メソッドと同じ形へそろえる。guard を「予約行の同一性（kind / normalized_key / operation_id / `state <> 'active'`）と User の版」を 1 文で見る `JOIN` にし、UPDATE に `AND operation_id = ?` を足す。
- guard 敗北時の翻訳は、読み経路をもう一度撃って**その答えへ倒す**。`activate` は `readByOperation` が空なら `UNIQUE_RESERVATION_NOT_FOUND`、残っていれば `OPTIMISTIC_LOCK_FAILURE`。`globalMaintenanceRunStore.beginOrResumeKind` の新規作成分岐も同じ規律で、敗北時に `readRunningRun(kind)` を撃ち直して**実在する run** の `runId` / `asOf` を `leased` に載せる（勝者が別の `candidateRunId` で立てている場合があるため）。

### 検討した代替案

**`activate` の guard を「予約行」と「User の版」の 2 本に分ける。** 述語ごとに翻訳を変えられそうに見えるが、`classifySqlError` はどちらの guard も `occGuard` としか答えないので区別できない。敗北経路 1 クエリの再読みのほうが安い。

**`acknowledgeReceipt` にも status guard を積む。** store の形は完全にそろうが、可換な集合への追加に敗者を作ることになり、B-001 が閉じたはずの「ack が落ちる」経路を別の顔で戻すだけになる。

### Consequences

- 良い点: 状態機械を持つ D1 store で guard 0 の store が無くなった。`identityUniqueDirectory` の JSDoc が宣言する「Every transition is a compare-and-set」がファイル全体で真になった。
- 良い点: `beginOrResumeKind` の `leased` が常に実在の run を名乗るようになり、ポート JSDoc の "a run leased by a live foreign owner" と一致する。
- トレードオフ: `writeHeader` は commit ごとに 1 文増える（`MAX_STATEMENTS_PER_COMMIT = 250` に対して無視できる）。`activate` / `beginOrResumeKind` の敗北経路は読みが 1 本増えるが、敗者だけが払う。
- 契約（ポート JSDoc / 共有適合スイート）は 1 行も動かない。memory は UoW を直列化するのでこの分岐に到達しない。観測は `__tests__/globalConcurrency.test.ts` の実バインディングに置く（`interposeOnce` で読みと適用のあいだに対抗 writer を割り込ませる形）。`acknowledgeReceipt` と `activate` はこの決定と同時に置き、`writeHeader` の status guard は [ADR-073](#adr-073-guard-敗北の翻訳は、その呼び出しの読み経路が返す答えへそろえる) の 2 ケースで初めて覆われた。

## ADR-058: `pruneCompleted` の keyset 区切りを生 NUL からエスケープ表記へ

### Context

`globalMaintenanceRunStore.ts` の cursor 組み立てと分解に **U+0000 のリテラル**が 2 か所埋まっていた。動作は壊れていない（JS 文字列としては同じ 1 文字）が、`file(1)` がこのファイルを `data` と判定し、`grep` が既定でバイナリとみなしてマッチを出さない。`_occ_guard` を 9 か所使っているのに `grep -rln occGuard` に現れず、レビューでも将来の改修でもこのファイルは検索から消えていた。同じ用途の正規の道具が `sql/row.ts` に `compositeKey` としてあり、その JSDoc は「the escape sequence (not a raw byte) keeps call sites greppable」とまさにこの事故を名指しで避けるよう書いている。

### Decision

**組み立ては `compositeKey(...)`、分解は `"\u0000"` のエスケープ表記にする。** 区切り文字は変えない（既存 cursor の互換を動かす理由が無い）。変えたのはソース上の表現だけで、ファイルは UTF-8 テキストへ戻り `grep` に現れるようになった。

### Consequences

- 分解側だけ区切りの知識をローカルに持つ。`compositeKey` に対の分解関数を置けば知識は 1 か所に閉じるが、`sql/row.ts` は本ラウンドの別束の担当ファイルなので触っていない。宿題として残す。

## ADR-059: 2 つの vitest project の境界は「ディレクトリ 1 つ」と「vitest 既定の include」の 2 定数で表す

### Context

`node` project は `packages/core/src/adapters/cloudflare/**` を**拡張子によらず**丸ごと exclude し、`workers` project はそのディレクトリを include する。この 2 つが「disjoint かつ和集合が全体」であることは `vitest.shared.ts` の JSDoc と `docs/test.md` が明示的に謳っている性質だが、`workers` の include だけが `**/*.{test,spec}.ts` と手書きで、vitest の既定 include（`**/*.{test,spec}.?(c|m)[jt]s?(x)`）より狭かった。当該ディレクトリに `.test.tsx` / `.test.mts` / `.test.js` を置くとどちらの project にも属さず、`pnpm test` は緑のまま走らない。実測で 0 件だったので実害は無いが、文面が config の実力を上回っていた。

### Decision

**拡張子パターンを手書きせず、vitest の既定 include をディレクトリで前置して組み立てる。**

- `vitest.shared.ts` に `testFilesIn(directory)` を置き、`configDefaults.include`（`vitest/config`）の各パターンへディレクトリを前置して返す。
- `workers` の include は `testFilesIn(CLOUDFLARE_ADAPTER_DIR)`。`node` は既定 include のまま（ディレクトリ exclude だけを持つ）。
- 境界は「ディレクトリ 1 つ」と「両 project が同じ既定 include を見ていること」の 2 点だけで表され、拡張子の綴りはどちらの config にも現れない。

### 検討した代替案

**`TEST_FILE_GLOB` を文字列定数として持つ**（triage の当初案）。1 か所化はできるが、その綴りが vitest の既定と一致していることは誰も検査しない。`node` は既定を使うので、vitest 側が既定を広げた日に再び非対称が生まれる。導出にすれば片側だけが取り残される形が構造的に作れない。

**`node` にも同じ include を明示する。**対称にはなるが、既存 project に include を新設する変更になり AC-7 の「node 側の実行範囲を動かさない」から遠い。exclude がディレクトリ単位で拡張子を見ない以上、`node` は既定のままで足りる。

### Consequences

- 良い点: `.test.mts` を当該ディレクトリへ置いて `vitest list` で確認したところ、`workers` が拾い `node` が拾わない（変更前はどちらも拾わなかった）。境界の主張が config の実力と一致した。
- 良い点: vitest が既定 include を変えても両 project が同時に追随する。
- トレードオフ: `vitest.shared.ts` が `vitest/config` に依存する（従来は文字列定数のみ）。root tsconfig の型検査対象なので破綻は typecheck で出る。

## ADR-060: scope object の commit 後の後始末は必ず通し、その失敗は呼び出し元へ返さない

### Context

`ScopeObject.applyWriteSet` は `transactionSync` で確定したあとに `rescheduleAlarm` → `publishDueIndex` を裸で await していた。`publishDueIndex` は DO から global D1 へ出て行くネットワーク書き込みで、overloaded / 5xx / タイムアウトは実運用で起きる。ここで throw すると `execution/scopeUnitOfWork.ts` の catch が `SystemError(DatabaseError)` に翻訳し、**scope 側は確定しているのにユースケースには「トランザクションが失敗した」と見える**。ADR-023 と適合スイート `unitOfWork.ts` の「失敗＝全ロールバック」が観測上破れ、commit 済みの outbox 行に対して relay kick も飛ばない。

まったく同じ「commit 後の due index publish」を行う autocommit 側（`do/repositories/scopeTaskScheduler.ts` の `write`）は逆の方針を明示的に採っており（warn に落とす）、非対称は設計判断ではなく書き漏らしだった。

`alarm()` も同型の欠陥を持っていた。`runScopeAlarmTurn` はハンドラ例外だけを内側で捕まえ、claim の `transactionSync` や `release` / `backoff` の直接 exec は素通しで throw する。throw すると後続 2 行に到達せず、**object が武装されないまま残る** — 「訪問しなかった行はリース満了まで再開できない」より悪い、無期限の停止になる。

加えて ADR-045 でレジストリが空なら `rescheduleAlarm` が `deleteAlarm` するようにしたため、あとからハンドラを登録しても既に積まれている行は誰にも武装されない。武装が起きるのは「`scheduled_tasks` を名指した write-set の commit」か「turn の終わり」だけで、後者は最初の alarm が要るという循環になっていた。

### Decision

- 後始末を `armAndPublish` の 1 メソッドに畳み、`rescheduleAlarm` と `publishDueIndex` を**それぞれ独立に** try/catch する。失敗は `Logger.warn` に落とし、RPC は成功で返す。倒し方は autocommit 側（`scopeTaskScheduler.write`）に揃える — **例外を投げるのではなく warn に落とす**。根拠は「後始末が追いかけている書き込みは既に確定しており、失敗を報告することは効果済みの処理の再試行を誘うこと」で、index も alarm も派生状態だから。
- 独立に握り潰すのは、どちらの失敗も後続の経路が吸収するから。index にだけ載った余分な行へは中央 runner が到達でき、失敗する claim 1 回で消える。索引に載らなかった行の回復は [ADR-070](#adr-070-due-index-の-publish-失敗は-scope-object-自身が-alarm-を張って治す) が publish 失敗時の再試行 alarm として与える（レジストリが空の既定配備では「武装できた object が次の turn で書き直す」が成り立たないため、この 2 方向は非対称である）。順序は arm が先（D1 が落ちても武装は生きる）。
- `alarm()` は `runScopeAlarmTurn` を `try / finally` に入れ、`finally` で `armAndPublish` を必ず通す。turn 自体の失敗は**握り潰さず伝播させる** — ランタイムの alarm 再配送に任せるためで、握り潰すと過去の `due_at` に武装した object が backoff 無しで即再配送される。
- 既存行の再武装は `ScopeObject` の constructor（`blockConcurrencyWhile` 内）で 1 度通して閉じる。pin 済みの object にだけ行う（新品の object に `scheduled_tasks` の行は無い）。**この地点は「張るだけ」で、Alarm を消さない**（[ADR-081](#adr-081-scope-object-の-constructor-は-alarm-を張るだけで決して消さない)）— レジストリが空なら何もしない。Alarm を消す地点は turn の出口（`rescheduleAlarm`）1 か所に限る。

### Consequences

- 良い点: commit 済みの scope UoW が commit 後の失敗で「失敗」として返る経路が消えた。`__tests__/alarm.test.ts` が「due index 表を退避して publish を落とした commit」で `applyWriteSet` が解決し、scope 側の行が残り、object は武装されており、次の publish で drift が治ることを実バインディングで固定している。
- 良い点: turn が投げても object は必ず武装される。
- トレードオフ: 後始末の失敗はログにしか出ない。index drift の検知は運用側の責務になる。
- （Round 004）constructor の再武装を `rescheduleAlarm` で行う形は [ADR-081](#adr-081-scope-object-の-constructor-は-alarm-を張るだけで決して消さない) が置き換えた。`armForStoredRows` は既存行のためにだけ武装し、消す判断を持たない。ADR-070 の再試行 alarm が cold start を跨いで生き残るのはこの置き換えによる。
- **束 7 へ渡す**: 「レジストリ有りの配備へ切り替えるときは中央 runner を止める手当てが同時に要る」を ADR-045 の Consequences へ。`createWorkerContainer` は今も `scopeTaskQueue` を無条件に配線しており、その受け渡しは配備スライスの担当（本 Issue の範囲外、ADR-005）。

## ADR-061: claim した chunk は予算切れでも最低 1 行訪問する

### Context

ADR-046 で「ハンドラ実行の前にも budget を見て、超過したら未訪問行を release する」と決めたが、判定が `index === 0` にも掛かっていた。候補読み + claim の `transactionSync`（最大 10 行）自体が予算を食い切ると、ハンドラループの最初の判定で 1 行も訪問せずに break し、claim した行を全部 release して turn を終える。`release` は `due_at` も `attempts` も据え置くので、直後の `rescheduleAlarm` は過去の `due_at` で `setAlarm` し、workerd は即座に再配送する。claim → 全 release → 即再配送、が進捗ゼロで閉じる。`SCOPE_ALARM_CPU_BUDGET_MS` は 2 秒と短めなので、負荷時に claim が食い切る可能性はゼロではない。

### Decision

予算判定を `index > 0` と AND する。claim した chunk は予算が何を言おうと最低 1 行はハンドラに渡す。

### Consequences

- 良い点: 「claim したのに 0 件処理して再武装する」ループが構造的に消える。turn は必ず 1 行ぶん前進するか、その 1 行を backoff する。
- トレードオフ: 1 turn が予算を最大でハンドラ 1 本ぶん超過しうる。ADR-046 が置いた「1 turn = 2 秒 + 外部 I/O」の `leaseMs` 下限論拠は 1 本ぶんの余裕を含んでいるので、下限は動かない。
- 予算判定が 1 度呼ばれなくなったぶん `elapsedMs` の呼び出し回数が変わるため、`__tests__/alarm.test.ts` の予算切れケースは「最初の 1 行は測られない」前提で数え直した。

## ADR-062: commit 後のトリガは UoW の async 文脈が閉じてから叩く

### Context

`runInUnitOfWork(plane, fn)` は `AsyncLocalStorage.run(plane, fn)` である。`fn` の中で始めた仕事はすべてこの store を継承するので、`fn` の末尾に置かれていた `relayTrigger.kick()` / `scopeTaskTrigger.kick()` は「UoW が開いている」文脈の内側で走っていた。kick 実装が `ctx.waitUntil(processOutboxEvents(...))` のようにインラインで UoW を開く形（`application/di/runtime.ts` が想定するランナー）だと、その `run` が nesting 判定で reject する。`waitUntil` の中なので誰も catch せず relay が黙って止まる。memory は ALS を持たないので CF でだけ壊れる。

### Decision

両平面の `run` を `async` にし、`runInUnitOfWork` には値と「どのトリガを叩くか」を組にして返させる。kick は `await` の**後**、つまり呼び出し元の async 文脈へ戻ってから叩く。`nesting.ts` の JSDoc に「`fn` が始めた仕事はこの文脈を継承する。commit 後のフックから UoW を開くなら `runInUnitOfWork` の解決後に呼ぶこと」を明記する。

### Consequences

- 良い点: トリガ実装が UoW を開いてよいものになった。ADR-001 / ADR-002 が触れていなかった含意が型と JSDoc の両方に載る。
- 良い点: kick は今も `run` が resolve する前に同期的に走るので、「commit 後に必ず 1 回」の観測（`__tests__/unitOfWork.test.ts` の kick 計数）は変わらない。
- トレードオフ: `run` の内側が `T` ではなく `{ value, flushedEvents, armedTasks }` を返すようになり、戻り値の組み立てが 1 段増えた。トリガの本数だけフラグが増える形なので、3 本目を足すときは組の形を見直すこと。

## ADR-063: 1 batch の文数上限は executor の入口で数え、件数だけ要る書きは駆動の affected-row count で受ける

### Context

ADR-036 は「1 commit = 1 `batch()` = 文数ぶんの query」を根拠に `MAX_STATEMENTS_PER_COMMIT` を置いたが、検査は `globalUnitOfWork` の commit 直前にしかなかった。`createAutocommitSession.write` も同じ `executor.apply` を通って同じ 1 batch になるのに番人がいない（`identitySupport.deleteExpiredPage` は呼び出し側の `limit` ぶんの `DELETE` をそのまま積む）。

同じころ `outboxRepository.pruneProcessed` が、件数を数えるためだけに `DELETE … RETURNING id` で全削除行を materialize していることが分かった。ADR-016 の「1 文で済ませる」は動かせるものではないが、その根拠は原子性と文数であって応答サイズを量っていない。ポートに limit が無いので keyset 分割は契約変更になる。

### Decision

- 文数の検査を `createD1Executor.apply` の入口へ下ろす。`assertBindable` と同じ位置になり、UoW の commit と autocommit の write が同じ 1 か所を通る。global 平面にだけ置く（= `createD1Executor` にだけ置く）という ADR-036 の決定自体は動かさない。
- `SqlExecutor` に **optional** な `applyCounted(input): Promise<number>` を足し、`SqlSession` に `writeCounted(input)` を足す。`pruneProcessed` は `RETURNING` をやめてこれで件数を取る。

`applyCounted` を optional にしたのは、affected-row count がドライバの応答の性質であって seam の性質ではないから。D1 は `meta.changes` を常に返すが、scope 平面は RPC の向こうの `transactionSync` で、`applyWriteSet` は何も返さない。必須にすると `ScopeSqlExecutor` を組み立てる全地点（`do/scopeStub.ts` と テストの装飾 executor）が答えようのないメソッドを持つことになる。staged session と非対応 executor はどちらも `databaseError` で落ちる。

### Consequences

- 良い点: 「バッチ上限を上げた変更が静かに予算を割ることがない」という ADR-036 の謳い文句が、UoW 経由でない書きにも初めて当てはまる。
- 良い点: prune の応答が保持期間ぶんの id ではなく 1 つの数になる。文数は 1 のまま。
- トレードオフ: 文数超過の例外が `executor.apply` の内側で起きるようになったため、global UoW ではこれが `throwTranslated("the global unit of work", …)` を一度通る。`kind` は `SystemError(DatabaseError)` のまま変わらないが、メッセージが 1 段入れ子になる。
- トレードオフ: `applyCounted` が optional なので、対応していない executor で `writeCounted` を呼ぶと実行時に落ちる。今日この経路を持つポートは `pruneProcessed` だけで、`refuseStaged` により global 平面の autocommit session からしか呼べない。

## ADR-064: `readRows` の `LIMIT` ガードは「結果から落ちた stored 行」で判定する

### Context

ADR-035 は `limit` と同一 unit 内の削除が両立しないことを見て、ガードを `staged.includes(null)`（この unit が削除した行）で書いた。ところが直後のマージは、この unit が触れた stored 行をいったん全部落としたうえで、オーバーレイ側の寄与を `spec.matches` で絞る。つまり「`upsert` した結果 `matches` を満たさなくなった行」も削除とまったく同じく結果から消える。`stored.length === limit` の満杯ページでこれが起きると、storage 側の n+1 件目は繰り上がらず短いページが静かに返る — ADR-035 が拒むと決めた状態そのものがガードを通り抜ける。

### Decision

ガードの条件を「`stored` のうち結果へ残らなかった行が 1 件でもあるか」に広げる（`row === null || (row !== undefined && !spec.matches(row))`）。削除と「述語から外れる更新」が 1 条件で閉じる。メッセージも "deleted" ではなく "dropped from the result — deleted, or updated out of the predicate" に寄せる。

### Consequences

- 良い点: ガードの条件がマージの条件と同じ材料（`spec.matches`）で書かれるようになり、片方だけ直して穴が空く形が消えた。
- トレードオフ: 満杯ページのときだけ `spec.matches` を staged 行ぶん追加で回す。`limit` 付きの `readRows` は現状すべて件数が小さい。

## ADR-065: 投影スナップショットの書きは「読んだ世代ベクトル」を `_occ_guard` で留める

### Context

`replaceSnapshotIfNewer` / `removeIfNewer` は read → JS 上の `compareVectors` → `writer.replace` の 3 段で、書きの側に条件が一つも無かった。public 平面の consumer は並行度 4 で同じ Note を同時に掴みうるので、読みと batch のあいだに別の consumer が commit すると古い snapshot が新しい行を上書きする。

本体行の lost update より重いのは索引側だった。FTS5 は contentless なので取り消しは「入れたときと同じトークン」を撃つ差分適用であり、`ftsMutation("delete", stored, …)` は**読んだ行**からトークンを再導出する。負けた側がそのまま撃つと、既に取り消し済みのトークンをもう一度取り消し、勝った側のトークンは索引に残ったまま本体行だけが敗者の内容になる。[ADR 017](../../spec/adr/017-content-size-budget.md) が contentless を選んだ結果 `'rebuild'` が使えないので、この破損に復旧経路が無い。

実バインディングで guard を外して観測すると、rev4 → rev6 → rev5 の交差で本体行は rev5、`found("六月")` は rev5 の行を返し、`found("四月")` は空、`integrity-check` は **PASS** した。索引の構造は自己整合しているので `integrity-check` はこの食い違いを検出しない。

### Decision

**読んだ行像を `_occ_guard` で commit 時まで留める。** `redactAuthor` が既に取っている形（[ADR 050](#adr-050-投影の-author-差し替えは条件付き-update-ではなく-occ-guard-で留める)）へ揃える。

- 本体行を書くすべての経路（`replace` / `remove`）の mutation 先頭に guard を置く。`stored === null` なら `NOT EXISTS`、そうでなければ `projection_revision` / `author_version` / `workspace_version`（public は `route_version` も）の一致。
- `remove` は自分で読み直さず、**判定に使った行像を引数で受ける**。`removeIfNewer` は読み → 比較 → 削除の 3 段なので、削除の直前にもう一度読むと「比較が承認していない行」を guard が留めてしまう。
- 条件付き `UPDATE` にはしない。D1 batch も DO の `transactionSync` も 0 行更新では中断しないので、負けたことを呼び出し側が知る手段が guard 以外に無い。負けた側は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` になり、at-least-once の再配送が読み直して `stale` に落ちる。
- ポート JSDoc と共有適合スイートは動かさない。単一スレッドの memory ではこの交差が構造的に起きず、契約の変更ではなくバックエンド固有の原子性の話だから（[ADR 046](../../spec/adr/046-port-contract-divergence.md) の手続きには掛からない）。

### Consequences

- 良い点: 「public 投影は世代ベクトル**条件付き**書き込みで競合を吸収する」という `spec/platform/index.md` の 2 か所の記述が、初めて実装の性質になった。
- 良い点: 敗者が撃つはずだった偽の `'delete'` が消える。復旧経路の無い破損なので、ここは検出ではなく発生の防止でしか閉じられない。
- トレードオフ: `removeForPurge` も guard を通る。世代の比較はしないままだが、読みと取り消しのあいだに行が動いていれば中断するようになった。冪等性は保たれる（再配送が読み直し、行が無ければ `NOT EXISTS` が成立して no-op で着地する）。ポート JSDoc のエラー契約行はこの 1 件ぶん狭いままで、束 7 の持ち分として残る。
- トレードオフ: 投影 1 回あたり commit の文数が 1 増える。`MAX_STATEMENTS_PER_COMMIT` は guard を内数として数えると宣言しているので予算の解釈は変わらない。

## ADR-066: bigram 索引テキストは上限で打ち切り、投影を失敗させない

### Context

FTS へ渡す bigram 文字列は 1 バインド値 2,000,000 バイトの上限に対して無防備だった。`note_search.text` は `PlainTextContent` の上限 800,000 バイト（ADR 017）で、純日本語（3 バイト/文字）の bigram 化は約 2.33 倍に膨らむので 1,866,000 バイト — 上限の 93%。NFKC は縮む変換だけではなく、`㍿` は 1 文字から CJK 4 文字へ展開するので、CJK 互換文字を多く含む最大級の本文は上限を越える。

越えたときの振る舞いが悪い。`replaceSnapshotIfNewer` が `SystemError(DatabaseError)` で落ち、その Note は投影 task の再試行を経て quarantine へ行き、**永久に検索に出ない**。ADR 017 の予算は「行」に対して引かれており、同じ 2,000,000 がバインド値にも掛かることは引き直されていなかった。

なお local D1 も miniflare の DO SQLite もこの上限を強制しないため、上限超過は実バインディングのテストからは観測できない。

### Decision

**`bigramIndexText` にバイト予算（1,800,000）を持たせ、越える分のトークンを落とす。** ハイライトが本文を 4,000 文字で打ち切っているのと同型の割り切りで、「頭から引ける」を「まったく引けない」より上に置く。

- 打ち切りはトークン列を組みながらの 1 パスで、追加のバイト長は算術で数える。大きな中間文字列を作らない。
- 関数は純のまま。contentless 索引の取り消しは「入れたトークンの再導出」なので、同じ本文が常に同じ文字列を返すことがこの実装の前提条件になる。打ち切りが本文の純関数である限り、insert と delete は同じ点で切れる。
- 名前付き `SystemError` で落とす案（`outboxRepository` の `MAX_SAVE_BINDING_BYTES` と同型）は採らない。あちらは呼び出し側が batch を割れるが、こちらは 1 件の Note の本文なので分割の余地が無く、落とせば検索から消える。

### Consequences

- 良い点: 最大サイズの CJK 本文が投影でき、頭から検索に出る。
- トレードオフ: 予算を越えた本文は末尾が索引に入らない。既知の限界として `spec/database/index.md` へ 1 行要る（束 7 の持ち分）。
- トレードオフ: 予算を変えると既存の索引行のトークンが二度と綴れなくなる。ファイル冒頭の「ここを変えると全索引が無効になる」という注意書きの適用範囲がこの定数にも及ぶ。

## ADR-067: 署名 cursor の撤回は `spec/adr/063` への昇格で canon へ着地させ、範囲は観測したポートに限る

### Context

[ADR-048](#adr-048-公開カーソルは署名しない--契約語のほうを実装へ寄せる) はポート JSDoc を「認証しない」へ書き換えたが、判断そのものは `.thread/11/adr.md` にしか無く、`spec/` 側は `署名cursor` のまま残っていた。`spec/adr/021` は在force の ADR で、その本文にも同じ語がある。

倒し方は 2 つあった。(a) `spec/adr/021` の当該語を直接書き換える。(b) ADR-048 を `spec/adr/063` として昇格し、021 の該当記述をその参照で上書きする。

### Decision

**(b) を採る。** 在force の ADR 本文を直接書き換えると「なぜ変えたか」が消え、`spec/adr/index.md` の前提依存マップにも載らない。昇格すれば、決定が canon に着地していないという指摘（composition B-001）ごと閉じられる。

範囲は **本 PR が実装し観測したポートに限る** — `PublicNoteQueryService` の 3 メソッドと `NoteRouteFanOutReader` の 2 メソッド。この 2 ポートに連なる記述（`spec/domains/note.md` / `spec/domains/index.md` / `spec/database/index.md` / `spec/platform/index.md` / `spec/usecases/{note,identity}.md` / 3 台帳 / 該当テストケース）はすべて「opaque cursor（認証しない）」へそろえた。

workspace directory 族（`UserWorkspaceDirectory.listActiveByUser` / `PublicWorkspaceDirectoryReader.listPublished`、および `spec/database/index.md` の `workspace_directory` 節）は**据え置く**。ポートがリポジトリに存在せず、実装も観測も無いため、「署名しない」を canon として宣言する根拠がこちらには無い。triage の一覧は `spec/database/index.md:978` を含んでいたが、この 1 行だけを動かすと同じ族の 6 か所と食い違うので外した。据え置いた事実は `spec/adr/063` の影響節に残存条件として書いてある。

`UserBatchReader` などが使う「署名済み routing generation」は cursor ではないので対象外。

### Consequences

- 良い点: `grep 署名 spec/ | grep cursor` の残りが workspace directory 族だけになり、残っている理由が ADR 本文から読める。
- トレードオフ: 台帳に 2 つの言い回しが同居する（ADP-note-025 は opaque、ADP-workspace-005 は署名）。[ADR 059](../../spec/adr/059-ledger-row-asymmetry.md) の「片側にしか無い主張は本文に由来するときだけそろえる」に照らすと、この非対称は本文（`spec/domains/{note,workspace}.md`）の非対称に由来するので台帳側で埋めない。
- 適合スイートのケース名（`ADP-note-025: a tampered or condition-changed cursor is rejected`）は "tampered" のまま。スイート本体は本 PR で変更しない対象で、観測している振る舞い（読めない値の拒否）は契約と一致している。memory の `cursor.ts` のメッセージも ADR-048 の判断どおり据え置き。

## ADR-068: 投影 writer のエラー契約に `OPTIMISTIC_LOCK_FAILURE` を足す

### Context

[ADR-065](#adr-065-投影スナップショットの書きは読んだ世代ベクトルを-_occ_guard-で留める) が `replace` / `remove` に guard を積んだ結果、負けた側は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` になる。ポート JSDoc のエラー契約行は `SystemError(DatabaseError)` の 1 行のままで、CF バックエンドは契約を満たさない実装として出荷される形が残っていた（ADR-065 自身が束 7 の持ち分として送っている）。

guard は `projection/snapshotWriter.ts` を共有する local（DO）と public（D1）の両平面に掛かるので、対象は `LocalNoteProjectionWriter` と `PublicNoteProjectionWriter` の両方である。

### Decision

**バックエンド非依存の契約として妥当と判断し、両ポートのエラー契約行へ「投げうる失敗」として足す。** 形は同じ PR の [ADR-056](#adr-056-claimdue-の競合はポート契約に投げうる失敗として書き耐えるのは-runner)（`claimDue`）に揃える。

- 「投げうる」であって「投げねばならない」ではない。単一スレッドで read-compare-write が原子になる memory はこの経路で決して投げず、追記後も契約を満たす。memory 実装と共有適合スイートは変更しない。
- 呼び出し側に補償は要らない。負けた側は at-least-once の再配送が読み直して `stale` か no-op に落ちるので、失敗を再配送まで通すことだけが呼び出し側の仕事である。この「通す」も契約行に書く。
- **アダプター内で `stale` へ畳めない理由**まで書く。contentless FTS の取り消しは「読んだ行から再導出したトークン」を撃つ差分適用なので、負けた側が `stale` を名乗って着地すると勝者のトークンを取り消してしまう。`claimDue` の「staged では commit で発火するので畳む場所が無い」と同じく、畳めない理由が契約の一部になる。

### Consequences

- 良い点: ADR-065 が残した「エラー契約行が 1 件ぶん狭い」が閉じ、`spec/platform/index.md` の「世代ベクトル条件付き書き込み」と契約が一致した。
- トレードオフ: `removeForPurge` は世代を比較しないまま guard を通るので、契約行の「every write」がこのメソッドも含む。冪等性は保たれる（再配送が読み直し、行が無ければ `NOT EXISTS` が成立して no-op で着地する）。

## ADR-069: 物理スキーマと spec の差分は、項目ごとに正本のある側へ倒す

### Context

AC-9 の突き合わせで、物理スキーマと `spec/database/index.md` の差分が 4 件残っていた。差分は 1 つの向きへまとめて倒せる性質のものではなかった。

### Decision

[ADR 046](../../spec/adr/046-port-contract-divergence.md) の「正本のある側へ倒す」を列・索引の単位で適用する。

- **`distributed_operations.request_key` は実装（全 kind で NOT NULL）が正本** → spec を直す。再送の重複排除は `UNIQUE(kind, partition_key, request_key)` が担い、SQLite は NULL 同士を相異なるものとして扱うので、NULL を許した行は索引の重複排除から外れる。「accountDeletion の userRequest でだけ NOT NULL」という旧記述は、その kind 以外の再送を素通しにする。
- **`distributed_operations.terminal_at` / `note_routes.migration_id` / `note_routes.last_migration_id` は実装が正本** → spec の列表へ足す。いずれも現役の読み書き経路（`countTerminalSince` / `deleteTerminal`、`switchMove` の応答喪失再試行）が鍵にしている。`last_migration_id` は契約側に対応物が無い純粋な物理列なので、何を判定するための列かを本文に 1 文で書く。
- **`sessions_user_token_idx` は spec が正本** → 実装から落とす。`sessions.token_hash` は既に UNIQUE で、`findByTokenHash(userId, tokenHash)` はその 1 本で 1 行に絞れる。選択度は上がらず session 作成ごとの index write が 1 本増えるだけで、同型のクエリを持つ `auth_tokens` は token_hash の UNIQUE だけで引いている。2 表で判断を割らない側へ倒した。
- **`identity_removal_receipts` の 2 索引は実装が正本** → spec の当該段落へ索引行を足す。`findByOperationId` / `deleteExpired` に対応する妥当な索引で、当該段落が索引を 1 本も挙げていなかった。
- **`attempts` / `next_attempt_at` / `expires_at`（未駆動の 3 列）は spec が正本** → 列は残し、動かす主体を本文へ書く。「今のアダプターが書かない」は実装の進捗であって設計ではないので、spec には書かない。

### Consequences

- 良い点: `0001_global_schema.sql` の全列・全索引が `spec/database/index.md` から読めるようになった。
- `sessions_user_token_idx` の削除は未配備の migration に対する変更なので、適用済み配備との整合を考える必要が無い。
- トレードオフ: 未駆動の 3 列は宣言だけが残る。駆動する主体（recovery Cron / accountDeletion の terminal transaction）が spec に書かれているので、次のスライスが拾える形にはなっている。

## ADR-070: due index の publish 失敗は scope object 自身が alarm を張って治す

### Context

ADR-060 は `armAndPublish` の 2 つの失敗を独立に warn へ倒し、その根拠を「両者が互いの保険」に置いた。だが ADR-045 でレジストリが空の配備（`registerScopeTaskHandler` の呼び出しが production に 0 件なので、これが既定）では `rescheduleAlarm` が必ず `deleteAlarm` するため、保険の片側 —「武装できた object が次の turn で index を書き直す」— が存在しない。

drift の 2 方向は非対称である。索引に残った余分な行は `listDue` が claim に失敗して 1 回無駄足を踏むだけで済む（ポート JSDoc が予算に入れている）。一方**索引に載らなかった行**は、`listDue` が索引しか読まないため中央 runner から永久に見えない。回復するのは「同じ scope の `scheduled_tasks` を名指す別の write-set が commit されたとき」だけで、継続要求はその 1 本で駆動されるので実質「次が無い」。plan.md が挙げた最悪ケース（personal cleanup の継続が止まり `accountDeletionBarrier` が開いたまま User が `deleting` で残る）にそのまま乗る。

### Decision

`publishDueIndex` が失敗したら、`getAlarm()` と比べて早い方を残す形で `Date.now() + DUE_INDEX_REPUBLISH_DELAY_MS`（10 秒）に武装する（`do/alarm.ts` の `armNoLaterThan`）。`alarm()` はレジストリが空なら `runScopeAlarmTurn` が `EMPTY_TURN` を返して即座に `finally` の `armAndPublish` へ入るので、既存機構だけで publish の再試行が閉じる。武装は `rescheduleAlarm` の**あと**に置く — 先に置くと `deleteAlarm` が再試行を消す。

対案 (b)「publish を write-set と同じ原子単位に入れる」は「D1 と scope DO を 1 transaction に含めない」（`spec/database/index.md`）に反するため採らない。対案 (c)「drift を `ScopeTaskQueue.listDue` 側で検出して治す」は、欠落した scope の検出に DO の全列挙が要り、`spec/platform/index.md`「Global Cron は scope object を全列挙しない」に反する — そもそも due index という表が存在する理由がそれである。

再試行を固定間隔（指数 backoff なし）にしたのは、backoff の状態を持つには DO storage に回数を永続化する必要があり、派生状態の後始末に本体データと同じ耐久性を持ち込むことになるため。10 秒は「一時障害で継続が長く止まらない」と「分単位の障害でも 1 scope あたり数回の再試行に収まる」の折衷。

### Consequences

- 良い点: 欠落方向の drift が既定配備（レジストリ空）でも自己修復する。ADR-060 が選んだ「arm 先行」の順序は動かない。
- 良い点: 再試行の turn はレジストリが空なら 1 行も触らないので、ADR-045 の「レジストリ空の object は writer ではない」は保たれる。publish だけが走る。
- トレードオフ: D1 が長時間落ちている間、行を持つ scope object は 10 秒ごとに起きて publish を試みる。alarm 1 本と D1 書き込み 1 本ぶんのコストが、障害中は scope 数に比例して発生する。
- `do/repositories/scopeTaskScheduler.ts` の autocommit publish は同じ手当てを持たない。あちらは caller の isolate から D1 へ直接書くので object の alarm に触れず、また production の合成（`di/cloudflareRuntime.ts`）は必ず staged session 上に建てるため `publishDueIndex` が no-op になる。到達するのは適合スイートとテストだけなので、そのままにした。
- `spec/database/index.md#scope_task_due_index` の drift 節（「当該 scope の Alarm が自分の `scheduled_tasks` を正として書き直して治す」）は、この決定で初めて既定配備でも真になる。何が治すのかを「publish 失敗が張り直す alarm」と書き足した。
- （Round 004）この再試行が object の作り直しで失われる経路が 1 つ残っていた（constructor の `rescheduleAlarm`）。[ADR-081](#adr-081-scope-object-の-constructor-は-alarm-を張るだけで決して消さない) が塞いだ。

## ADR-071: `compare` 付きの `readRows` は「書き換えた stored 行」も `LIMIT` と合成しない

### Context

[ADR 064](#adr-064-readrows-の-limit-ガードは「結果から落ちた-stored-行」で判定する) はガードを「`stored` のうち結果へ残らなかった行」まで広げたが、マージの後段にはもう 1 つ補正できない経路が残っていた。順序は `spec.compare` が決め、`compare` は**オーバーレイの新しい値**を読む。したがって `matches` を満たしたままの更新でも、その行をページ境界の外へ動かせる。

`ORDER BY x LIMIT 2`、storage が x=1,2,3、この unit が x=1 の行を x=10 に更新した場合、正しいページは [2,3] だが、オーバーレイは storage の 3 行目を持っていないので [2,10] を返す。短いページではなく**中身の違うページ**が静かに返るので、ADR-035 が拒むと決めた状態のうち最も見つけにくい形になる。

### Decision

`limit` があり statement が満杯で返ったとき、`compare` を持つ読みでは「この unit が書き換えた stored 行が 1 件でもあれば」拒む。`matches` を満たしているかは問わない。

どの列を比較子が読むかは `RowsRead` からは分からないので、順序が実際に動いたかは判定できない。安全側へ倒して一律に拒む。`compare` が無い読みは順序を約束していないので、条件は ADR-064 のまま据え置く。メッセージは 3 つの落ち方（`deleted` / `updated out of the predicate` / `updated in a way the ORDER BY may move past the page boundary`）を呼び分け、どれで落ちたかが呼び出し地点から読めるようにする。

### Consequences

- 良い点: `RowsRead` の JSDoc が数え上げる落ち方とガードの条件が再び一致する。JSDoc 側にも順序の項を足した。
- 現行の `compare` + `limit` の 6 箇所（`noteRevisionRepository.listByNote` / `noteRepository.listPurgeable` / `llmUsageRepository.deleteByUser` / `accountDeletionManifestStore` の prune / `authTokenRepository.findPending` / `noteRouteFanOutReader`）はいずれも誤爆しない。前 5 者は読んでから書く（書いた行を同じ unit で読み直さない）か、書く行が statement の返した stored 行に含まれない。最後の 1 つは autocommit session なのでガード自体を通らない。
- トレードオフ: 比較子が触れていない列だけを更新して同じ満杯ページを読み直す、という正当な使い方も拒まれる。避けるには `query`（素通し）を選ぶ。
- トレードオフ: 細かく判定するには `RowsRead` にソートキーを宣言させる必要があり、全呼び出し地点にフィールドが 1 つ増える。満杯ページかつ同一 unit の書き換えという条件が既に狭いので、そこまでは払わなかった。

## ADR-072: `claimDue` の skip は `OPTIMISTIC_LOCK_FAILURE` の 1 コードに限る

### Context

[ADR 056](#adr-056-claimdue-の競合はポート契約に「投げうる失敗」として書き、耐えるのは-runner) は `runDueScopeTasks` の catch を「`ConflictError` に限って skip」と決め、その Consequences で「将来別の理由の `ConflictError` も同じく skip される」ことをトレードオフとして自ら名指していた。

ポート JSDoc が `claimDue` に許した追加の失敗は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` の 1 コードだけである。実装は `isConflictError`（= `instanceof`）で受けており、コードを見ていない。skip が安全なのは「その行には勝者がいて、勝者が処理する」からであって、`ConflictError` であること自体からは何も出てこない。別コードが届いたとき、その scope は毎ラウンド同じ理由で飛ばされ、継続の鎖が warn 1 行だけで無言停止する。

### Decision

catch の条件を `isConflictError(cause) && cause.code === "OPTIMISTIC_LOCK_FAILURE"` に絞り、それ以外は再送出する。ADR-056 の決定のうち「耐性は呼び出し側に置く」は動かさず、耐える対象を契約が名指した 1 コードへ狭めるだけの改訂である。

### Consequences

- 良い点: ポート JSDoc のエラー契約と runner の耐性が同じ失敗を指すようになった。契約行に新しいコードを足すときは runner も一緒に読むことになる。
- 良い点: 勝者のいない競合は round を止めて表に出る。無言の停止より大声の失敗を選ぶ、というこのリポジトリの既定に揃う。
- トレードオフ: 将来 `claimDue` が別コードの `ConflictError` を投げるバックエンドが現れると、1 scope の失敗がその tick 全体を落とす。契約へ足したうえで runner の条件も広げる、という 2 手が要る。それが狙いである。
- ADR-056 の Consequences の当該トレードオフ行はこの決定で失効する。書き直しは canon 追随の束の持ち分。
- 観測は `application/workers/__tests__/scopeTaskRunner.test.ts` に 1 本足した（`ConflictError("STATE_VIOLATION")` を注入し、round が reject し、handler が 1 度も走らず、"claim lost the race" の warn も出ないことを固定）。

## ADR-073: guard 敗北の翻訳は、その呼び出しの読み経路が返す答えへそろえる

### Context

ADR-013 が「符号はステージ時の読みで決め、guard は同時実行の砦として残す」を、ADR-037 が maintenance run について「guard が外れたら読みで観測していたら返したはずの値へ倒す」を決めていた。ADR-057 は同じ規律を `identityUniqueDirectory.activate` へ適用したが、control-plane store 全体には行き渡っていなかった。Round 003 で 4 か所が残っていた。

- `identityUniqueDirectory.beginRelease` — ポート JSDoc が「不在 / `reserved` / `releasing` / 別 user / token 不一致はすべて no-op」と列挙で契約しており、読み経路はそのとおり早期 return する。しかし読みと適用のあいだに相手が着地すると `throwTranslated` が `OPTIMISTIC_LOCK_FAILURE` を投げる。呼び出し側 `identityRemovalRelease` は outbox consumer で、これを捕まえないので負け続ければ event が quarantine されうる。
- `identityUniqueDirectory.activate` — guard の述語が `state <> 'active'` を含むため、**同じ operation の並行リプレイ**（継続配送は at-least-once）に負けただけでも外れる。読み経路の答えは「活性化すべき行が無い」＝成功だが、`OPTIMISTIC_LOCK_FAILURE` に倒れていた。
- `distributedOperationStore.beginOrResume` — この表は 2 本の一意索引を持つ。`(kind, partition_key, request_key)` が外れることは「勝者がこのリクエスト自身」を意味し、読み経路は `{ resumed: true }` を返す。ところが `unique` を一律 `DISTRIBUTED_OPERATION_ALREADY_RUNNING` に倒していた。ADR-040 が `reserve` について「どの索引が外れたかで翻訳を分ける」と決めたのと同じ論点。
- `accountDeletionManifestStore.writeHeader` — ADR-057 が足した status guard の翻訳が一律 `stateViolation` だった。4 つの呼び出し側（`markBuilt` / `beginRollback` / `markCompleted` / `markRejected`）はいずれも「すでに目的の status」を no-op 成功として扱うので、**自分が望んだ遷移そのものに負けた**ケースまで失敗になっていた。

### Decision

**guard 敗北の翻訳は、その呼び出しの読み経路がその条件で返す答えへそろえる。** 敗北経路でだけ読みを 1 本撃ち直し、答えを再導出する。

- `beginRelease`: `occGuard` なら `resolveClaim` 相当を撃ち直し、観測した claim（`active` かつ `expectedUserId` かつ `expectedClaimToken`）がもう無ければ **return**。残っていれば `throwTranslated`。
- `activate`: `activateLoss` を 3 分岐にする。再読が空なら `UNIQUE_RESERVATION_NOT_FOUND`、全行が `state = 'active'` かつ `user_version = expectedUserVersion` なら **`null`（成功）**、それ以外は `OPTIMISTIC_LOCK_FAILURE`。`user_version` を読むために `Reservation` に `userVersion` を足した。
- `beginOrResume`: `occGuard` / `unique` のいずれでも `inPartition` を撃ち直し、同じ request key の行があれば `{ operation, resumed: true }`、無ければ `DISTRIBUTED_OPERATION_ALREADY_RUNNING`。どちらの索引が外れたかを索引名で見分ける必要はない — 読み直した答えが自動的に区別する（ADR-040 のメッセージ照合を増やさずに済む）。
- `writeHeader`: `occGuard` なら header を読み直し、`status` が**この呼び出しの遷移先**と一致すれば return、それ以外は `stateViolation`。遷移先を知る必要が出たので、`writeHeader` の引数を `(current, next, terminal?)` に変え、SET 句と行像を `next` から組み立てる（4 呼び出し側にあった SQL 断片と列名の二重記述が消える）。

### 検討した代替案

**`beginOrResume` で索引名を照合して分ける（ADR-040 と同じ形）。** `classifySqlError` は種別しか返さないので `identity_unique_reservations.operation_id` のようなメッセージ照合が要る。ここでは読み直しがそのまま答えになるので、索引名への依存を増やす理由が無い。

**`writeHeader` の guard 敗北を一律成功に倒す。** UPDATE の `WHERE` にも同じ status 条件があるので 0 行更新は静かに成功しうるが、`markCompleted` が `beginRollback` に負けた場合まで成功にすると、`rollingBack` の header に対して呼び出し側が「completed になった」と信じて進む。遷移先の一致を見る必要がある。

### Consequences

- 良い点: 敗者の答えが直列実行時の答えと一致する、という規律が control-plane store の全メソッドで真になった。ADR-013 / 037 / 057 が個別に出していた結論が 1 つの規律に畳まれた。
- 良い点: `beginRelease` が quarantine を招く経路が消え、`activate` の誤検知ログ（`activateUniqueKeys` の `logger.error` + `confirm()` + 再 `activate`）が並行リプレイでは出なくなった。
- 良い点: `writeHeader` の呼び出し側から SQL の SET 句が消え、列名の綴りが 1 か所になった。
- トレードオフ: 敗北経路が読み 1 本ぶん重くなる。払うのは敗者だけで、勝者の往復は変わらない。
- トレードオフ: staged セッション（UoW 内）で敗者になった場合の翻訳は commit 時の既定（`OPTIMISTIC_LOCK_FAILURE`）のままで、ここの再読みは通らない。ADR-013 が同じトレードオフを引き受けている。
- 到達範囲: 再読みが走るのは `session.write` が投げたとき、すなわち **autocommit セッションの形だけ**である。4 か所のうち `beginRelease` / `activate` は `uniqueness.ts` / `signUpWithPassword.ts` が container（autocommit）から呼ぶので配備でも効くが、`writeHeader` / `beginOrResume` の呼び出し側（`manifestBuild.ts` / `compaction.ts` / `admission.ts`）はすべて `globalUnitOfWorkProvider.run` 経由なので、今日の配線では commit 時の既定翻訳しか起きない。それでも死んだコードではない — `SqlSession` の契約は「同じリポジトリコードが staged と autocommit の両方で走る」であり、`ConformanceBackend` は両形でポートを呼ぶ。消せばこの ADR が閉じた乖離が autocommit の形で再び開く。この限定は `__tests__/globalConcurrency.test.ts` の冒頭 JSDoc にも書いた。
- 残る課題: staged 経路でも読み経路の答えへそろえるには、UoW の commit が「どの mutation の guard が外れたか」をポートへ返す仕掛けが要る。ADR-001（write-set は commit 時に 1 度だけ適用する）の範囲を越えるので別 Issue へ送る。
- 観測: `__tests__/globalConcurrency.test.ts` に 5 本足した（`activate` の並行リプレイ、`beginRelease` の敗北、`beginOrResume` の同一 request key、`writeHeader` の同一遷移敗北、`markCompleted` が `beginRollback` に負ける）。前の 4 本は修正前の実装で赤になることを実測した。ADR-057 の Consequences が言う「観測は `globalConcurrency.test.ts` に置いた」が `writeHeader` についても成立した。
- 契約（ポート JSDoc / 共有適合スイート）は 1 行も動かない。いずれも「読み経路が返す答え」に寄せた変更なので、直列実行しか到達しない memory は元から同じ答えを返している。

## ADR-074: keyset の順序を索引から取り、不等値の述語は残余に置く

### Context

`note_routes` の 2 索引は `(created_by, state, note_id)` / `(scope_type, scope_id, state, note_id)` だった。一方 `NoteRouteFanOutReader` の 2 走査が撃つのは `WHERE created_by = ? AND state <> 'reserved' AND note_id > ? ORDER BY note_id LIMIT ?` で、`state` が**等値ではなく不等値**である。SQLite は不等値の前置列を越えて後続列の順序を保てないので、`note_id` 順は索引から出ず、`created_by` 一致ぶんを全部読んでから並べ替えることになる。keyset の意味（前方の削除で位置がずれない）は残るが、1 page のコストが「その著者の route 総数」に比例し、page を進めても下がらない。account deletion の author route 固定は 100 件 page を繰り返すので、多作な利用者ほど効く。

同じ形の非対称が `outbox_events` にもあった。global 平面は pending / processed の 2 索引、scope 平面は pending の 1 本だけ。両平面は同一の `OutboxRepository` 実装を共有し、`pruneProcessed` は `WHERE processed_at IS NOT NULL AND processed_at < ?` を撃つ。今日は scope outbox が `save` にしか使われていないので実害は無いが、relay / prune を配線する次のスライスがそのまま全表走査を踏む。

### Decision

**索引の前置列は等値で当たる列だけにし、keyset 列をその直後に置く。不等値の述語は残余に残す。**

- `note_routes` の 2 索引を `(created_by, note_id)` / `(scope_type, scope_id, note_id)` へ改める。`state <> 'reserved'` は SQL に残したまま残余述語として評価される。1 page が読む行数は「page ぶん + 飛ばした `reserved` 行」になり、著者の route 総数から切り離される。走査側の SQL とポート契約はどちらも動かない。
- scope 平面の `outbox_events` に global と同じ部分索引 `outbox_events_processed_idx`（`(processed_at) WHERE processed_at IS NOT NULL`）を足し、両平面を対称にする。「2 つの `outbox_events` は同じ形で、リポジトリは渡されたセッションの側で組み立てる」という DI 側の記述が索引まで含めて真になる。

### 検討した代替案

**走査を `state IN ('active','moving','purging','tombstone')` の等値集合に書き換える。** 索引の形は変えずに済むが、SQLite の `IN` は索引に対する繰り返しループで、後続列の順序は全体としては揃わないため `ORDER BY note_id` の並べ替えは消えない。加えて state の列挙が増えるたびに走査側を直す必要が生まれ、「`reserved` だけを飛ばす」というポート契約の言い方から遠ざかる。

**`(created_by, note_id, state)` のように `state` を末尾へ回す。** 順序は索引から取れるうえ `reserved` 行を表に触れずに落とせるが、走査は残る列を全部読むので利得は飛ばした行ぶんだけで、索引 1 本ぶんの幅が増える。canon の索引行が担う意味（fan-out の走査鍵）も薄まるので採らない。

**scope 側に processed 索引を置かない。** 1 scope 分の outbox は小さい、という理由は立つが、その上限は設計のどこにも書かれておらず、リポジトリ実装が両平面で 1 つである以上「片方だけ索引が無い」は次の読み手に判断を引き直させる。

### Consequences

- 良い点: fan-out の 1 page のコストが page サイズに比例する形になり、account deletion の author route 固定が著者の作成数に対してスケールする。
- 良い点: 両平面の `outbox_events` が索引まで同形になり、scope 側の relay / prune を配線するスライスが索引の判断を引き直さずに済む。
- トレードオフ: `state` が索引に入らないので、`reserved` が多い著者では飛ばした行ぶんだけ表を触る。`reserved` は予約の有効期限で刈られる短命な状態なので、定常状態では page サイズに対して小さい。
- migration は未適用の 1 ファイル（`0001_global_schema.sql`）なので、追記の規律は掛からず既存行をその場で直した。
- `spec/database/index.md` の `note_routes` indexes 行（`state` を含む形）と、両平面共通の `outbox_events` / `processed_events` の節は canon 追随の束の持ち分。

## ADR-075: 索引テキストの予算は run ではなく「unicode61 が切る語」の粒度で当てる

### Context

ADR-066 の予算（1,800,000 バイト）はトークン単位で積みながら当てているが、`bigramIndexText` の「トークン」は CJK run だけが 2 文字ビグラムで、非 CJK run は **run 全体が 1 単位**だった。空白自体が非 CJK なので、CJK に挟まれない限り本文全体が 1 run になる（英文の本文なら丸ごと）。この 1 単位が単独で予算を越えると最初の反復で打ち切りが返り、その列の索引テキストは**空文字列**になる。

到達しうる。`PlainTextContent` の上限は 800,000 バイトだが NFKC は展開する — U+FDFA（`ﷺ`、3 バイト）は空白入りの 18 文字（33 バイト）へ展開するので、上限の 2 割ほどの本文で 1 run が予算を越える。ADR-066 が「頭からは引ける」を「まったく引けない」より上に置いたのに、この経路だけその約束が成り立たなかった（title / tag 由来のヒットは残るので投影は成功し、検索だけが静かに欠ける）。

### Decision

**非 CJK run は空白で区切り、1 語を 1 単位として積む。**

- `unicode61` はどのみち空白で切るので、**索引に入るトークン列は 1 つも変わらない**。既存の索引行の取り消し互換性は保たれ、ファイル冒頭の「ここを変えると全索引が無効になる」には抵触しない。
- これは `spec/database/index.md#bigram-前処理` の手順 4「非 CJK は空白区切りでそのまま」の文言どおりであり、実装を canon へ寄せる向きの変更でもある。
- `bigramMatchExpression` は run をフレーズにまとめる現行のまま。フレーズは隣接トークン列に一致するので、索引側の刻み方とは独立している。
- さらに細かく `NON_WORD`（`[^\p{L}\p{N}_]+`）で切る案は採らない。トークン列は同じだが、canon の文言は空白区切りであり、句読点まで落とすと索引テキストが `note_search.text` から目視で追えなくなる。

残る縁は「空白を 1 つも含まない 1 語が単独で予算を越える」場合（`ﷲ` U+FDF2 は空白なしで 2.67 倍に展開するので、675,000 バイトの本文で到達する）。その語は索引に入らないが、1.8MB の 1 トークンは前方一致でも実質引けないので、入れても得られるものが無い。同じ本文に他の語があればそれらは頭から入る。

### Consequences

- 良い点: 非 CJK が支配的な本文でも「前方から入る」が成り立ち、ADR-066 の約束がすべての本文に掛かる。
- 良い点: 索引の内容が変わらないので、再投影も表の作り直しも要らない。
- `spec/database/index.md`「既知の限界」の予算の行は、打ち切りの粒度（CJK は 2 文字ビグラム、非 CJK は空白区切りの 1 語）と、予算を単独で越える 1 語は丸ごと落ちることを言っておくのが正確（canon 追随の束の持ち分）。

## ADR-076: public 検索の並び順は canon を正本のまま残し、契約強化を別 Issue へ送る

### Context

`spec/domains/note.md` の `searchPublic` は「keyword なしは `updatedAt DESC, noteId`、keyword ありは shard 内 FTS 順位の Reciprocal Rank Fusion に `updatedAt, noteId` を tie-break」と定める。実装は**両バックエンドとも** `note_id` 昇順の keyset で、`bm25` を計算しない。本 PR の退行ではない — `PublicSearchCriteria` に sort 相当の入力が無く、現行ポートでは順序を表現できないためで、memory も同型である。

本 PR は cursor の署名撤回のために `spec/domains/note.md` と `spec/platform/index.md` の**まさにその段落**を書き換えたので、AC-8 / AC-9 の「倒さないなら理由を残す」が掛かる。

### Decision

**canon（RRF の記述）を実装へ寄せる書き換えはしない。契約強化を別 Issue（#54）へ送り、理由をここに残す。**

RRF は物理 shard 化（ADR 021）まで生きる設計意図であり、実装が追いつくまでのあいだ canon を `noteId` keyset へ弱めると、あとで引き直す根拠そのものが消える。倒すにはポート（`PublicSearchCriteria` と cursor）・両バックエンド・共有適合スイートが同時に動く必要があり、plan.md「含まれないもの」の「relevance 順の契約強化」を越える。

### Consequences

- canon と実装の食い違いが 1 件、意図的に残る。読み手が突き当たったときの手掛かりは #54 と本項である。
- 契約を強めるときは ADR 046 の手続き（ポート定義 → 共有適合スイート → 全バックエンド）を踏む。順序は cursor が運ぶ内容も変えるので、shard generation を載せ直す判断と同時に行うのが自然である。

## ADR-077: spec の「制約」列には DB が実際に守るものだけを書く

### Context

`spec/database/index.md` の列表に、表にも migration にも無い制約が「制約」列で宣言されていた — `note_routes.migration_id`（同じ節の本文は「CHECK を持たない」と書いている）、`distributed_operations` / `account_deletion_manifests` の terminal 系、`scope_task_due_index.lease_expires_at`（この表に `status` 列は存在せず、由来表 `scheduled_tasks` の状態を指していた）。

同じ PR が `note_routes` に相関 CHECK 5 本、`membership_directory` に 3 本、`users` / `identities` に 4 本ずつを実装しているため、読み手は「制約列に書いてあるものは DB が守る」と読む。どれが実効でどれが状態機械の約束かを列から判別できない状態は、次の改修に誤った前提を与える。

### Decision

**「制約」列は DDL と 1 対 1 にする。** DB が守らない約束は列の説明として書き、「DB 制約は置かず状態機械が守る」と明記する。他表の列を指す条件は、その**表名を名指す**（`scheduled_tasks.status = 'running'` のように）。

### Consequences

- 良い点: 列表が migration の読み替えとして使える。CHECK を足す / 落とす変更が spec の差分として現れる。
- トレードオフ: 状態機械の約束は列表からは「NULL 可」にしか見えなくなる。節の本文が引き受ける。

## ADR-078: 在force の ADR を引く文は、その決定の適用範囲を越えない

### Context

canon 側で 2 か所、引用が決定より広く効いていた。

- `spec/adr/021:41` は cursor から「署名」の語を落としたが、[ADR 063](../../spec/adr/063-public-cursor-not-authenticated.md) の決定は `PublicNoteQueryService` の 3 メソッドと `NoteRouteFanOutReader` の 2 メソッドに限られ、その影響節は「workspace directory 側は今も署名 cursor のまま」と明言している。021 だけが公開 workspace 一覧まで巻き込んで倒れ、063 が述べた事実を同じ PR が反証していた。
- `spec/platform/index.md` の `### Scope DO` は「実測値は予算文書に置かない」の根拠に [ADR 056](../../spec/adr/056-performance-budget-placement.md) 決定 3 を引いていた。決定 3 が追い出しているのは「**どのバックエンドが届かないか**」であり、実測値については決定 2 が「予算文書に、表の直後の段落として、上限ではなく設計目標として置く」と逆を定めている。

### Decision

**引用は決定の範囲へ戻す。** 021 は公開 workspace 一覧を分離して「署名cursor のまま」と書き、063 の影響節は動かさない（両者が同じことを言えばよく、未実装ポートの記述を先に倒す理由が無い）。platform は引用を決定 2 へ替え、実測値（1 turn `4n + 3` 文・commit 1 回）を段落に載せて設計目標であることを明記する。

在force の ADR の決定を**反転**させたいなら、`spec/adr/` に新しい ADR を起こして参照を張る（ADR 063 を昇格させたのと同じ手順）。参照文の言い換えでそれを行わない。

### Consequences

- 良い点: AC-5 が求めた実測値が canon 側に着地し、`.thread/` にしか無い状態が解消した。
- 良い点: 公開読みモデルの cursor について、canon の 2 か所が同じ範囲を指すようになった。workspace directory のポートを実装するスライスが、同じ問いを自分で引き直せる。

## ADR-079: 未到達の分岐は「待っている Issue」ではなく「到達に必要な契約変更」で説明する

### Context

`application/cleanup/personalCleanup.ts` の full-page 分岐（`pruneCompleted` が 1 ページを埋めて continuation を積む枝）は「複数の barrier receipt を保持できるバックエンドが現れるまで未テスト — #11」と書かれていた。#11 が着地したのでこの参照は直す必要があるが、`review-004-composition.md` の W-004 は「CF の `ScopeCleanupAdmissionStore` は 1 scope に複数の terminal receipt を持てるので前提はもう満たされている」を理由に挙げていた。

実装を読むと満たされていない。CF 実装の `receipt()` は `kind = 'barrier'` を読んで `rows[0]` を返し、`pruneCompleted` はその 1 行だけを消して `1` を返す（`do/repositories/scopeCleanupAdmissionStore.ts:102,331`）。memory 実装も単一キー `RECEIPT_KEY` で同じ形（`memory/repositories/scopeCleanupAdmissionStore.ts:171`）。適合スイートも「one scope holds at most one receipt」を前提に書かれている（`conformance/scopeCleanupAdmissionStore.ts:176`）。物理表が `operation_id` を PK に持つことと、ポートが複数 receipt を約束することは別である。

### Decision

**コメントは「どの Issue を待つか」ではなく「到達に何が要るか」を書く。** 当該コメントは「全バックエンドが 1 scope あたり 1 receipt しか持たず、適合スイートもそれを固定しているので、この枝を観測するにはポート契約とスイートを変える（[ADR 046](../../spec/adr/046-port-contract-divergence.md)）ことが要る」とした。Issue 番号は入れない。

理由は 2 つ。番号は着地した瞬間に嘘になる（今回がそれ）。そして「複数 receipt を許すか」はポート契約の設計判断であって、特定スライスの副産物として自然に満たされるものではない。

### Consequences

- 良い点: 次にこの枝へ触る人は、テストを足す前にポート契約を変える必要があると読める。バックエンド固有テストで埋めようとする誤りを防ぐ。
- トレードオフ: 「いつ直すか」の手掛かりがコメントから消える。契約変更が要る以上、追跡は Issue 側の持ち分になる。
- **canon の追随（束 6 で反映済み）**: 「1 personal scope が持つ barrier receipt は 1 件」という前提が canon のどこにも書かれておらず、`spec/database/index.md` の `applied_operations` と `spec/usecases/identity.md` の prune 分岐だけが「最大 100 件・100 件なら再登録」の有界形を書いていた。両所に前提を 1 文足し、枠が埋まらないことを明示した。有界形そのものは共通の pruner に合わせた形なので残す。

## ADR-080: `removeForPurge` の ack は契約から落とし、guard の割り込みはバックエンド固有テストで観測する

### Context

2 つの食い違いが同じ束で出た。

- `PublicNoteProjectionWriter.removeForPurge` のポート JSDoc は「Idempotent purge-side removal, acknowledged under the operation」と書いているが、ack を読む経路はリポジトリ全体に無い。D1 実装は `operationId` / `routeVersion` / `projectionRevision` の 3 引数をどれも使わず行を消すだけで、memory は `publicPurgeAcks` に受領行を書くがその表を読む者がいない（`store.ts:422` の宣言と `noteProjection.ts:219` の書き込みのみ）。適合スイート ADP-note-032 が観測するのも「2 回呼んでも失敗しない」だけである。ADR-022 はアダプター側で ack 表を作らないと決めていたが、契約側の語が残っていた。
- OCC guard を持つ投影経路のうち `snapshotWriter.redactAuthor` と `NoteProjectionRevisionStore.bump` の 2 つに、読みと適用のあいだの割り込みを観測するテストが無かった。guard を外しても全テストが緑のまま通る状態だった。

### Decision

**ack は契約から落とす。** ポート JSDoc を「冪等は end state（行が消えていること）で満たし、operation への acknowledgement は契約しない」へ改める。読み手が 0 件である以上、正本を実態へ寄せるのが ADR 046 の手続きに沿う。D1 実装側の JSDoc は契約の再掲を落とし、アダプター固有の点（3 引数を使わない理由と、writer が持つ guard はその比較ではない旨）だけを残す。

memory の `publicPurgeAcks` は本 PR では触らない。AC-7 が memory バックエンドの振る舞いを変えないことを求めており、ポートから観測できる振る舞いは今も両者で同一なので、死んだ表の除去は独立に安全に行える。別 Issue へ送る。

**割り込みは `projectionConcurrency.test.ts` に足す。** 適合スイートには足さない。memory は単一スレッドで read-compare-write が原子になるので、この割り込みを原理的に観測できない。既存の `interposeOnce`（次の `write` の直前に対抗 writer を 1 度だけ通す）をそのまま使い、`redactAuthor` は D1 セッションで、`bump` は scope object セッション（`createScopeStubExecutor` + autocommit）で、それぞれ敗者が `ConflictError` になることと勝者の値が残ることを観測する。`bump` は guard の 2 分岐（行なし / 既存行）を 2 ケースで通す。

### Consequences

- 良い点: 契約語・memory の表・D1 の非実装という三者不整合のうち、正本側の語が実態と一致した。新バックエンドが ack を実装すべきかを迷わない。
- 良い点: ADR-050（`redactAuthor` は条件付き UPDATE ではなく guard）と ADR-027 の revision 採番が、guard を外すと赤になるテストで支えられた。実際に両 guard を一時的に外して 3 ケースが赤になることを確認している。
- トレードオフ: memory に読まれない表が残る。ポートから観測できる差ではないので契約の食い違いではないが、次に `noteProjection.ts` を読む者には無駄な行に見える。
- トレードオフ: 観測がバックエンド固有テストに乗るので、将来の第 3 のバックエンドは自前で同じ形を書くことになる。適合スイートは単一スレッドのバックエンドも通す必要があるため、ここは共有できない。
- **canon の追随（束 6 で反映済み）**: `spec/usecases/note.md` の 2 か所（purge 手順 6 と `note.purged` 消費）と `spec/domains/note.md` の物理分割の段落から ack の語を落とし、「削除を 1 transaction で確定し、冪等は end state で満たす」へそろえた。`spec/inventory/{adapter,domain}.md` の ADP-note-032 / DOM-note-048 は「purge operation の public 削除を冪等に完了する」のままで語を変えずに済んだ。

## ADR-081: scope object の constructor は alarm を張るだけで、決して消さない

### Context

ADR-070 は「due index の publish が失敗したら 10 秒後に alarm を張る」を、索引に載らなかった行の**唯一の**回復経路として置いた（`listDue` は索引しか読まないので、載らなかった scope は誰も探しに来ない）。

ところが ADR-060 が閉じたもう 1 つの循環 —「既存行の再武装を constructor の `blockConcurrencyWhile` で 1 度通す」— が、その回復経路を消していた。constructor は `stored !== null` なら必ず `rescheduleAlarm` を呼び、ADR-045 によりハンドラレジストリが空の配備（`registerScopeTaskHandler` の production 呼び出しは 0 件＝既定）では `rescheduleAlarm` は `nextWakeAt` を読まずに `storage.deleteAlarm()` する。alarm は DO storage の耐久状態なので object が evict されても残るが、evict 後に**任意の RPC（読み取りでよい）**が届けば constructor が走り、そこで消える。しかも 10 秒アイドルは evict 閾値そのものなので、再試行の配送自体が cold start になる経路が通常経路になりうる。

実バインディングで再現を確認した: alarm を張った object に `state.abort()` を掛け、次の RPC のあと `getAlarm()` が `null` になる。

選択肢:

1. **constructor で due index と自分のスライスを突き合わせ、欠けていれば張る。** `spec/platform/index.md`「外部要求」が「DO transaction / `blockConcurrencyWhile` の中で external I/O を待たない」と明示しており、constructor の再武装はその中にある。
2. **再試行の意思を DO storage に永続化する。** alarm 自体が既に DO の耐久状態であり、消していたのは自分のコードだけなので、同じ耐久性を二重に持つだけ。`_scope_identity` への列追加は schema と `spec/database/index.md` の追随（AC-9）まで連れてくる。
3. **constructor を「張るだけ」にする。**

### Decision

3 を採る。`do/alarm.ts` に `armForStoredRows(storage)` を置き、constructor はこれを呼ぶ。`scopeAlarmDrivesTasks()` が偽なら何もしない。真なら `nextWakeAt` を読み、非 null のときだけ `armNoLaterThan` で武装する。constructor から `deleteAlarm` へ至る経路は無くなる。

constructor が持っていた役目 —「駆動する配備が、駆動しない配備の残した行を拾う」— は `armNoLaterThan(nextWakeAt)` で保たれる。`armNoLaterThan` は早い方を残すので、既に張られている再試行 alarm を遅らせることもない。

駆動しない配備に残った古い alarm は、配送されれば `alarm()` → `EMPTY_TURN` → `finally` の `armAndPublish` → `rescheduleAlarm` が自分で落とす。したがって constructor が落とす必要は元々無かった。

### Consequences

- 良い点: ADR-070 の再試行が cold start を跨いで生き残る。既定配備（レジストリ空）でこそ効く。
- 良い点: 「alarm を消してよいのは turn の出口だけ」という 1 つの規則へ寄る。ただし本決定が閉じたのは constructor 経路だけで、規則が実装と 1 対 1 になるのは commit 経路も消さなくなった ADR-090 の後である。
- トレードオフ: 駆動しない配備で古い alarm が 1 度だけ余分に配送されうる（その turn が自分で落とす）。ADR-045 の「レジストリ空の object は writer ではない」は保たれる — turn は 1 行も claim しない。
- `__tests__/alarm.test.ts` の「keeps the republish retry alarm across a rebuild of the object」が、`state.abort()` で object を作り直したあとも `getAlarm()` が同じ値であることを実バインディングで固定する。既存の「republishes a slice whose publish failed on its own next alarm」は live インスタンスへ alarm を撃つだけなのでこの経路を観測していなかった。
- **canon の追随（束 6 で反映済み）**: `spec/platform/index.md`「Scope Alarm」の起動時の張り直しの段落を「足すだけで消さない。消す地点は turn の出口 1 か所」へ直した。ADR-060 の Decision / Consequences も本決定で置き換わったことを明記した。

## ADR-082: scope object は due index の publish を自分の中で直列化する

### Context

`ScopeObject.applyWriteSet` は `this.sql.apply()`（storage 操作＝ input gate が閉じる）のあと `armAndPublish` で **global D1 への `await`** に入る。D1 呼び出しは当該 object の storage 操作ではないので input gate が開き、次の `applyWriteSet` が配送されうる。`publishDueIndex` は「`scheduled_tasks` を同期 SELECT → D1 へ `DELETE + INSERT`」の read-modify-write で排他が無いため、A のスライス（B の行を含まない）が B のスライスのあとに着地すると、B が積んだ行が索引から消える。落ちるのは ADR-070 と同じ**欠落方向**で、しかも publish は成功しているので再試行 alarm は張られず、既定配備では回復経路が無い。

実バインディングで再現を確認した: object の `GLOBAL_DB` を包んで最初の batch だけ 50ms 遅らせ、同一 scope へ `applyWriteSet` を 2 本並行に投げると、着地順が `[2, 1]` になり索引は `['op-a']` だけになる（object 側は 2 行を持っている）。

選択肢:

1. **スライスに単調な世代（object 側の連番）を載せ、古い世代の `DELETE`/`INSERT` を効かせない。** `scope_task_due_index` に列を足すので `spec/database/index.md` の追随（AC-9）と D1 側の条件付き削除まで連れてくる。
2. **publish を write-set と同じ原子単位に入れる。** ADR-070 が既に却下している（「D1 と scope DO を 1 transaction に含めない」）。
3. **object インスタンスの中で publish を直列化する。**

### Decision

3 を採る。`ScopeObject` に `private upkeep: Promise<void>` を持ち、`armAndPublish` はその鎖に繋いだ promise を返す。**読み（`scheduled_tasks` の SELECT）も鎖の中**に入れる — 読みが鎖の外にあると A の読みと B の読みが交差する経路が残るため。鎖は `catch` で継いで、1 本の失敗が次の write-set の後始末を止めないようにする（`armAndPublishNow` は失敗を warn に落とすので今日は投げないが、鎖の生存を実装の内部事情に依存させない）。

スライスは全置換なので、順序さえ保てば最後の publish が正しい。直列化は object 内の数行で閉じ、`spec/database/index.md` の「D1 と scope DO を 1 transaction に含めない」にも触れない。

production の合成では `do/repositories/scopeTaskScheduler.ts` の autocommit publish は staged 判定で no-op になる（ADR-020 / ADR-070）ため、object 内の直列化で writer は 1 本に揃う。

### Consequences

- 良い点: 「全置換だから収束する」が順序の保証を伴って初めて真になる。ADR-003 が置いた「index は派生データ」の前提が、並行 commit の下でも崩れない。
- 良い点: `alarm()` の `finally` の後始末も同じ鎖に乗るので、turn の publish と write-set の publish が交差する経路も同時に消える。
- トレードオフ: 同一 scope へ並行に届いた write-set は、後始末の D1 往復ぶんだけ直列に待つ。commit 自体は待たない（`transactionSync` は既に終わっている）ので、待つのは呼び出し元が索引の可視性を得るまでの時間だけ。ただし待ちは鎖に並んだ数ぶん積み上がり、N 本目の呼び出し元は D1 往復 N 回ぶん遅れる。**合流（まだ `scheduled_tasks` を読み始めていない末尾の publish に相乗りする）は入れない** — 正しさに要るのは「自分の書きより後に読み始めた publish が 1 回ある」ことだけなので合流しても順序は保てるが、今日 production から `applyWriteSet` を叩く呼び出し元が無く（配備一式は plan.md のスコープ外）、同時実行数も D1 RTT も測れない。観測できない改善のために alarm 周りの唯一の順序保証を複雑にはしない。引き直すのは配備スライスが実測してからである。
- `__tests__/alarm.test.ts` の「does not let an overlapping publish land an older slice」が、object の `GLOBAL_DB` を包んで最初の batch を止めるという**仕込んだレース**で観測する（`projectionConcurrency.test.ts` の `interposeOnce` と同じ方針 — 起きるのを待たない）。着地順が `[1, 2]` であることを見るので、仕込みが空振りしたときは緑にならない。
- **canon の追随（束 6 で反映済み）**: `do/dueIndex.ts` の JSDoc に加え、`spec/database/index.md#scope_task_due_index` に「publish はスライスの全置換であり、収束は順序の性質なので scope object が読みごと直列化する」の 1 項目を足した。

## ADR-083: ハイライトの位置写像は ASCII の連なりを segmenter ごと飛ばす

### Context

`search/highlight.ts` の `mapPositions` は書記素クラスタ 1 つずつ `normalize("NFKC").toLowerCase()` を掛けていた。`bodyHighlights` は `substr(text, 1, 4000)` を limit 件ぶん見るので、未認証で叩ける `searchPublic` の 1 ページで最大 16 万回の呼び出しになる（W-004）。

実測したところ**主項は正規化ではなく `Intl.Segmenter` の反復**だった。4,000 文字の英文 1 行で写像全体が 1.30 ms、うち segmenter を回すだけで 1.09 ms（約 85%）、クラスタごとの `normalize` + `toLowerCase` は 0.16 ms。指摘が提案したクラスタ単位の ASCII 速路（`segment.length === 1 && < 0x80` なら `normalize` を呼ばない）だけでは 13% しか減らない。

### Decision

**速路の単位を「単独クラスタになると保証できる ASCII の連なり」にし、その区間は segmenter を通さず `slice().toLowerCase()` で一括に写す。**

- 連なりの条件は「各 UTF-16 単位が `< 0x80` かつ CR ではなく、次の単位も ASCII（または文字列末尾）」。UAX #29 でクラスタを伸ばすもの — Extend / ZWJ / SpacingMark / Hangul jamo / Regional Indicator / Prepend — はすべて ASCII の外にあるので、この条件を満たす単位は必ず単独クラスタになる。唯一の例外が CR × LF なので CR だけ外す。
- ASCII 符号位置は NFKC 不変で、小文字化しても 1 単位のまま（0–127 を全数確認）。文脈依存の小文字化（語末シグマ等）は ASCII に存在しないので、区間を一括で `toLowerCase` した結果は 1 文字ずつ掛けた結果と一致する。
- **16 単位未満の連なりは速路に載せない。** segmenter へ戻るには残りの `slice` が要るため、字種が交互に来る本文でそれを 1 文字ごとに払わせない。判定は窓の末尾（`at + 15`）の単位が ASCII かを先に見て O(1) で落とす（その長さの連なりなら必ず ASCII のはずなので、必要条件として使える）。
- 16 単位未満の ASCII クラスタには、指摘どおりのクラスタ単位速路をそのまま残す。

### Consequences

- 4,000 文字 1 行あたり: 英文 1.30 ms → 0.04 ms（約 36 倍）。非 ASCII を 1 文字含む英文 1.30 → 0.06。日本語 1.43 → 1.48、混在 1.25 → 1.24 で横ばい（O(1) の事前判定を入れる前は混在が 2 割悪化していた）。limit 20 の 1 ページなら英文本文で約 26 ms → 1 ms。
- 遅路との一致は 235,280 ケースの差分実行で確認した（ASCII 全 128×128 対、ASCII × 結合文字 / ZWJ / 地域表示記号 / Prepend / サロゲートペア / CRLF / 互換文字の全組合せ、ランダム 20 万本）。不一致 0。
- CR を連なりから外す条件は、公開 API からは観測できない。needle は `searchRunsOf` が非 CJK run を trim して作るので空白で始まらず終わらず、CR / LF の位置の写像は読まれないためである。写像を遅路と厳密に一致させるための防御として残す。
- テストは `__tests__/searchEdges.test.ts` に遅路（segmenter をクラスタごとに回す旧実装）の参照を置き、`highlightExcerpt` / `highlightBody` が付ける `<mark>` が参照の切り出しと一致することを見る。`asciiRunEnd` の 2 条件・一括写像・クラスタ単位速路のどれを壊しても赤になることを変異で確認した。`<mark>` 以外の HTML エスケープを固定するケースも同じ describe に置いた。
- **canon の追随（束 6 で反映済み）**: `spec/database/index.md`「ハイライトと抜粋の生成」の写像の箇条書きに「単独クラスタと保証できる ASCII の連なりは一括で写す」を 1 行足した。振る舞いも「既知の限界」も変わらない。

## ADR-084: `claimDue` は 1 unit of work につき 1 回、と契約側で限る

### Context

`do/repositories/scopeTaskScheduler.ts` の `queryCandidates` は `session.query`（オーバーレイ非参照）なので、同一 unit で `claimDue` を 2 度呼ぶと 1 度目に staged した claim は候補読みに見えず、同じ行が 2 度返る。memory はトランザクション内の table を直接書き換えるので 2 度目は候補にならない。コメントは逆に「staged 済みの claim は 2 度選ばれない」と、コードの持たない性質を主張していた。

契約の正本（ポート JSDoc と `conformance/scopeTaskScheduler.ts`）を当たると、割れているのが契約違反かどうかは決まらない。

- 適合スイートの「holds a claimed row for the leaseMs it was given, hiding it from a second claim」は `ConformanceBackend.forScope`（autocommit）で走る。CF もこの形では緑で、割れるのは staged セッションの中だけである。
- ポート JSDoc の排他の記述は「同時に走る 2 つの `claimDue`」を対象にしており、UoW 内の可視性には触れていない。候補規則も store の状態として書かれていて、どの読みからそう見えるかを定めていない。
- 乖離は片側だけではない。CF は「同一 unit で schedule した行」を候補にせず、memory は候補にする。memory へ寄せる（候補読みを `readRows` にする）と、claim guard が「他の writer から見えている行」を争う前提そのものが崩れる。

### Decision

**実装は動かさず、契約側で「`claimDue` は 1 unit of work につき 1 回」と限る。** ポート JSDoc の排他の段落の直後に、理由（staged バックエンドは commit 済み行から候補を選ぶ）込みで 1 行置く。アダプターのコメントは前半（候補は commit 済みで他の writer から見えている行でなければならない）だけを残し、成り立っていない後半を落として実態を書く。

memory も共有適合スイートも動かないので AC-7 / AC-8 の手続きには触れない。唯一の呼び出し側 `runDueScopeTasks` は元から 1 unit 1 回で、契約を満たしている。

### 検討した代替案

**staged セッションのとき、この unit が claim 済みの key をローカル集合で除外する。** 2 度目の `claimDue` だけは memory と同じ答えになるが、「schedule → claim」の向きの乖離は残るので割れは閉じない。しかも autocommit ではリース失効後の再 claim を殺さないよう分岐が要り、`limit` を SQL に渡したあとで絞るので候補が短くなる経路も増える。契約が要求していない性質のために実装を重くする。

**候補読みを `readRows` にしてオーバーレイと合成する。** memory と完全に揃うが、`_occ_guard` による claim の排他は「候補が他の writer にも見えている commit 済み行である」ことに乗っている（ADR-044）。自分の未 commit の行を候補にすると、guard が争う相手のいない行を claim することになる。

### Consequences

- 良い点: コメントの主張と実装が一致し、割れている前提が契約の外（呼び出し側の前提条件）として明示された。次に `claimDue` を 2 度呼ぼうとする者はポート JSDoc で止まる。
- 良い点: 候補は commit 済み行、という CF 側の設計判断が理由ごと残る。ADR-044 の前提を壊さない。
- トレードオフ: バックエンド間の振る舞いの差そのものは残る。適合スイートは autocommit の形しか到達できないので、この差は実行では観測されない。契約で禁じた呼び方をした場合にだけ現れる。
- 観測は足していない。実装の振る舞いを変えていないうえ、契約が禁じた呼び方を固定するテストは書く意味がない。

## ADR-085: 単一 writer 前提は driver ごとに書き分け、settle の fencing は AC-6 の結論のまま据える

### Context

`spec/platform/index.md`「Scope Alarm」は AC-6 の決着（settle に fencing token を足さず `leaseMs` の運用下限で閉じる — [ADR-019](#adr-019-scopetaskscheduler-の-settle-に-fencing-token-を足さずleasems-の運用下限で決着させる)）を canon に残す段落で、その根拠を 2 つの文で述べていた。どちらも成り立っていなかった。

- 「引き金は『1 scope に複数 writer』であって『複数 worker プロセス』ではない — scope が分かれていれば writer も分かれる」。中央 runner は `scopeTaskQueue.listDue`（全 scope 共有の due index）で scope を選ぶので、runner の起動が 2 本並走すれば両方が同じ scope を掴みうる。`runDueScopeTasks` の `claimedScopes` は 1 ラウンド内の重複排除にすぎず起動をまたがない。scope ごとに writer が分かれるのは object の Alarm が driver の配備だけである。
- 根拠の参照先が `spec/domains/index.md` の `ScopeTaskScheduler` 節だが、その節は存在しない（同ファイルに語が 1 度も現れない）。settle の鍵と選択規則の canon は `spec/database/index.md` の `scheduled_tasks` / `scope_task_due_index` にある。

### Decision

**決着そのもの（fencing token を足さない）は動かさず、前提が何に支えられているかを driver で場合分けして書く。** object の Alarm が driver の配備では worker プロセスの多重度は引き金にならない。中央 runner が driver の配備では「runner の起動が重ならないこと（1 配備あたり同時 1 起動）」が単一 writer 前提そのものであり、配備はそれを保つ手段を持たなければならない、と明記する。実配備（Queue consumer / Cron ハンドラ）は本 Issue の範囲外（[ADR-005](#adr-005-本-issue-の出口をアダプター群--適合ハーネス--di-ランタイム合成に置き配備一式を含めない)）なので、閉じるのは記述だけである。

**参照先は `spec/database/index.md` の `scheduled_tasks` / `scope_task_due_index` へ差し替える。** `spec/domains/index.md`「新設する横断的ポート」に `ScopeTaskScheduler` / `ScopeTaskQueue` の節を起こす案は採らない — その節は `spec/inventory/adapter.md` の ADP 行欠落（#52）の受け皿と重なり、片方だけを本 PR で起こすと #52 が二重管理から始まる。

### Consequences

- 良い点: AC-6 が canon に着地する。「複数プロセスは引き金ではない」という誤った安心を読み手に与えない。
- 良い点: 配備スライスが持つべき要件（runner の同時 1 起動）が、設計文の側から名指しで渡る。
- トレードオフ: `ScopeTaskScheduler` の契約は今も `spec/domains/` に節を持たず、`spec/database/` と ポート JSDoc に分かれたままである。統合は #52 の持ち分。

## ADR-086: 本文ハイライトの窓はコードポイント境界へ内側に丸める

### Context

`highlightBody` の窓は `first[0] - WINDOW_LEAD` と `from + WINDOW_LENGTH` で、いずれも UTF-16 コード単位のオフセットである。一致点の 40 単位手前・160 単位先がサロゲートペアの中に当たると、`render` の `slice` が対を割り、返す HTML の端に対にならないサロゲートが載る（W-003）。表示は U+FFFD に落ちるだけだが、返る文字列は well-formed でなくなり、モジュール JSDoc と `spec/database/index.md` の「返す文字列は常に元テキストの一部」という主張から外れる。JSON へ載せる／保存する下流でも壊れうる。`highlightExcerpt` の窓は `[0, excerpt.length]` なので影響を受けない。

### Decision

**窓の両端を、境界がサロゲートペアの中に落ちたときだけ 1 単位ずつ内側へ寄せる。** 近端は `+1`（孤立した下位サロゲートを捨てる）、遠端は `-1`（孤立した上位サロゲートを捨てる）。

- 丸める単位はコードポイント境界であって書記素クラスタ境界ではない。クラスタを跨いで切ることは既定の振る舞い（窓は「文字数ぶんの文脈」でしかない）で、`render` の `Math.max(start, from)` / `Math.min(end, to)` は `<mark>` を窓へ切り詰める前提で書かれている。壊れるのは「対にならないサロゲート」だけなので、閉じるのもそこだけにする。
- 外側ではなく内側へ丸める。外側だと遠端が `text.length` を越えうる（元テキスト自体が孤立サロゲートで終わる場合）ため、境界検査が 1 つ増える。内側なら窓は元の範囲に収まり、近端は必ず `first[0]` 以下に留まる（一致点はクラスタ境界なので、割れているなら厳密に手前）。
- 遠端は丸める前の近端から数える。近端が 1 単位ずれても窓長を数え直さない — 窓長は表示上の目安で、1 単位の差に意味は無い。

### Consequences

- 返る断片は常に well-formed な元テキストの一部になる。`<mark>` の位置と HTML エスケープは変わらない。
- 窓は最悪 2 単位短くなる。表示上の差は無い。
- `__tests__/searchEdges.test.ts` の「cuts the body window on code point boundaries」が、両端がそれぞれ絵文字の対の中に落ちる本文で、出力にコードポイント単位の孤立サロゲートが 1 つも無いことを見る。丸めを外すと 0xDE00 と 0xD83D の 2 つが観測されて赤になることを確認した。
- canon への追随は不要。`spec/database/index.md`「返す文字列は常に元テキストの一部」は元から真であるべき主張で、実装がそれに追いついただけである。

## ADR-087: object 駆動配備での autocommit scheduler の拒否は、publish 地点ではなく `write` の入口に置く

### Context

ADR-020 は autocommit 経路の `ScopeTaskScheduler` を「due index は自分で publish し、alarm は張らない」と決めた。中央 runner が唯一の writer である既定配備では、索引に載れば `listDue` が拾うので足りる。しかし `registerScopeTaskHandler` を使う配備（`scopeAlarmDrivesTasks()` が真 ＝ ADR-045、その配備では中央 runner を併走させない ＝ ADR-085）でこの経路が使われると、行は索引にしか載らず、索引を読む者がいないので継続が誰にも起こされない。Round 005 の判定は「その配備では `databaseError` で拒む」だった。

拒否をどこに置くかで振る舞いが変わる。`publishDueIndex` の入口に置くと、`write` の 2 つ目の `try / catch` が拾って `logger.warn` に落ちる（ADR-070 の「commit 済みの書きを失敗として返さない」ための catch）。つまり呼び出し元には何も届かず、行だけが起こされないまま残る — 指摘そのものが残る。

### Decision

`write` の**入口**、`session.write` より前に置く。`session.staged` が偽かつ `scopeAlarmDrivesTasks()` が真なら `databaseError` を投げ、scope 側の書き込み自体を起こさない。

読み（`readRow` / `queryCandidates`）は拒まない。索引に載らない行が生まれるのは書きだけで、読みを塞いでも防げるものが無い。

### Consequences

- 良い点: 呼び出し元が落ちるので、その配備で autocommit の settle を書いた瞬間に気づける。静かなドリフトが観測不能な故障ではなくなる。
- 良い点: 拒否が書き込みの前なので、落ちたときに scope 側へ半端な行が残らない。
- トレードオフ: 「拒む条件」が `write` に、「publish するかの条件」が `publishDueIndex` にと 2 か所に分かれる。どちらも `session.staged` を見るが、意味が違う（前者は禁止、後者は分岐）ので畳まない。
- production では発火しない（`registerScopeTaskHandler` の呼び出しは 0 件）。適合ハーネス（`__tests__/ports/scopeInfra.ts` 経由の `forScope`）もハンドラを登録しないので発火しない。
- `__tests__/alarm.test.ts` の「refuses a write outside a unit of work where the object drives tasks」が両側を観測する — レジストリが空なら同じ `schedule` が通って索引に載り alarm は張られない、登録後は拒まれて行も残らない。

## ADR-088: keyset の cursor 節は述語ではなく文の組み立てで出し入れする

### Context

D1 の掃引・ページングが 4 か所で `AND (? IS NULL OR key > ?)` の形をとっていた。1 本の SQL で「先頭ページ」と「続き」を兼ねられるので素直に見えるが、SQLite は**束縛値を見ずに計画する**ので `? IS NULL` を列への制約に落とせない。この `OR` 項は残余述語としてしか評価されず、cursor は「読み飛ばし」になって走査の開始位置を動かさない。1 ページ 100 件を P ページ回すと p ページ目が p×100 行を読み直し、全体が O(P²) になる。

効く先は定常経路である。`identitySupport.deleteExpiredPage` は `sessions` / `auth_tokens` / `login_attempts` / `oauth_flow_states` / `identity_removal_receipts` の 5 表を兼ねており、いずれも行数が利用者数に比例する。`globalMaintenanceRunStore.pruneCompleted` は `(expires_at > ? OR (expires_at = ? AND run_id > ?))` と正しい複合 keyset を組み立てながら、前置した `? IS NULL OR` が `global_maintenance_runs_expiry_idx` の利用ごと潰していた。`accountDeletionManifestStore` の `appendMembershipPage` / `pruneTerminal` も同じ形。

### Decision

**cursor が無いときは cursor 節そのものを SQL に出さない。** 節の文字列と params 配列を `cursor === null` で分岐させ、`statement(...)` の可変長引数ではなく `{ sql, params }` を直に組む。cursor があるときだけ `AND key > ?`（複合なら `AND (a > ? OR (a = ? AND b > ?))`）が現れるので、索引のレンジ制約になる。

### 検討した代替案

**型ごとの番兵で `coalesce` へ落とす**（text 鍵なら `key > coalesce(?, '')`、integer なら下限値）。文が 1 本で済み計画も安定するが、鍵の型ごとに番兵を選ぶ知識が `deleteExpiredPage` のような表非依存のヘルパーへ入り込む。空文字列が正当な鍵になりうる表が将来出たときに静かに壊れる形でもあるので採らない。

### Consequences

- 良い点: 掃引の 1 ページのコストがページサイズに比例する形になった。`identitySupport` の 1 か所で 5 表に効く。
- 良い点: `pruneCompleted` の複合 keyset が意図どおり `(expires_at, run_id)` の索引へ乗るようになった。
- トレードオフ: 同じ SELECT に 2 つの形ができる。分岐は 1 行の三項に閉じており、params の並びも同じ順序なので読み違えは起きにくい。
- 契約（ポート JSDoc / 共有適合スイート）は 1 行も動かない。返る行も `nextCursor` の意味も同じで、変わったのは計画だけである。適合スイートの cursor ケース（先頭ページ / 続き / 尽きたら null）がそのまま両分岐を通る。
- canon への追随は不要。`spec/database/index.md` の「共通の規約」は `?` を件数ぶん並べないことを定めているだけで、cursor 節の出し入れには触れていない。

## ADR-089: 有界削除は選択述語を DELETE へ持ち越す（1 行 1 文は維持する）

### Context

[ADR-014](#adr-014-期限切れ掃引と件数上限つき削除は束内の共有ヘルパーに畳む) の `deleteExpiredPage` / `deleteBoundedByKey` は、`expires_at <= ?` や `user_id = ? AND auth_epoch < ?` で**選んだ**行を `WHERE key = ?` だけで**消して**いた。読みと書きは D1 への別 round trip なので、そのあいだに行が条件から外れても消える。

実害に届く。`SessionRepository.refreshAuthEpoch` は現在 session を新しい auth epoch へ引き上げる唯一の口で、`authResidueCleanup` の `deleteOlderEpochByUser` と競合する。旧世代として選ばれた直後に refresh が着地すると、いま使っている session が消えて利用者が強制サインアウトされる。`login_attempts` でも、選ばれた直後に `recordFailure` が `expires_at` を延ばした行を掃引が消し、失敗回数が 0 に戻ってスロットルが緩む。memory は同期区間で読み書きするのでこの窓を持たず、適合スイートには観測できない乖離である。

### Decision

**SELECT の述語をそのまま DELETE の `WHERE` へ足す。** `DELETE FROM t WHERE key = ? AND <選択述語>` の形にし、`deleteBoundedByKey` は受け取った `where` 断片を SQL・params とも再利用する。**1 行 1 文は維持する** — `remove()` mutation を鍵ごとに積む形は ADR-014 のまま変えない。

### 検討した代替案

**`json_each` の多行 DELETE 1 文へ畳む**（`DELETE FROM t WHERE <述語> AND <inJsonList(key)>`）。述語の持ち越しと文数の削減が同時に片づくが、`opaque` になるので write-set のオーバーレイに消去が見えなくなる。今日の呼び出し形（`requestPasswordReset` / `resendVerificationEmail` は削除→発行の順、`authResidueCleanup` は件数だけを見る）では代償が出ないものの、read-your-writes が呼び出し側の順序に依存する形を新たに作ることになる。「`?` を件数ぶん並べない」という `spec/database/index.md` の規約は**バインド変数の本数**に掛かる規約で、1 文 1 パラメータの DELETE を積むこの形はそれに触れていない。ページ上限 100 は `MAX_STATEMENTS_PER_COMMIT = 250` に収まる。

### Consequences

- 良い点: 強制サインアウトとスロットル緩和の窓が閉じた。UoW 内で呼ばれて窓が UoW 全体に広がる場合も、同じ述語が commit 時の DELETE に付いている。
- 良い点: 「何で選んだか」と「何を消すか」が 1 か所に並び、片方だけ直して静かにずれる形が消えた。
- トレードオフ: 返す件数は**選んだ件数**であって消えた件数ではない。競合した行のぶんだけ過大に申告する。呼び出し側はどちらも「まだ残っているか」の目安にしか使っておらず、次のページで実際の残りを見るので実害は無い。ポート JSDoc は件数の意味を規定していないので契約も動かない。**その一文をポート JSDoc へ足すことは本 PR では採らない** — 件数の意味は `PrunePage`（`domain/common/pagination.ts`）と 3 つの domain ポート・2 つの application ポートに跨るので、束 6 の担当範囲である `application/ports/` にだけ書くと canon が半分だけ述べられた状態になる。加えて競合窓は共有適合スイートから観測できないので、片側だけに載る契約文を新たに作ることになり、ADR-092 が同じ理由で落とした形をもう 1 つ増やす。足すなら 6 ファイルを一度に動かす別 Issue。
- トレードオフ: `remove()` のオーバーレイは、DELETE が述語で空振りしても消えたことにする。同一 UoW でその表を読み戻す呼び出し側は今日 1 つも無い。
- 契約（ポート JSDoc / 共有適合スイート）は 1 行も動かない。直列実行しか到達しない memory は元から同じ答えを返す。
- 観測: `__tests__/globalConcurrency.test.ts` に 2 本足した（`interposeOnce` で読みと DELETE のあいだに `refreshAuthEpoch` / `recordFailure` を割り込ませる）。述語の持ち越しを外すと 2 本とも赤になることを実測した。

## ADR-090: commit 経路の後始末は alarm を足すだけにし、消すのは turn の出口に限る

### Context

ADR-081 は constructor から `deleteAlarm` へ至る経路を閉じたが、`rescheduleAlarm` の呼び出し地点はもう 1 つあった。`ScopeObject.applyWriteSet` は `scheduled_tasks` に触れた write-set のたびに `armAndPublish` → `armAndPublishNow` を通り、そこが `rescheduleAlarm` を呼ぶ。`rescheduleAlarm` は `scopeAlarmDrivesTasks()` が偽（`registerScopeTaskHandler` の production 呼び出しは 0 件＝既定配備）なら `nextWakeAt` を読まずに `storage.deleteAlarm()` する。

したがって既定配備では、`scheduled_tasks` を触る commit のたびに、**前回の publish 失敗が `armNoLaterThan` で張った再試行 alarm が先に消える**。ADR-070 はその alarm を「索引に載らなかった行の唯一の回復経路」と置いており（`listDue` は索引しか読まない）、`spec/database/index.md#scope_task_due_index` も同じ向きを「自然回復しない」と名指している。非クラッシュ経路では直後の全置換 publish が回復させるが、`deleteAlarm` 成功後・`publishDueIndex` 完了前に isolate が落ちると、索引に載らない行と唯一の回復経路が同時に失われる。復旧はその scope への次の書き込みだけになる。

`spec/platform/index.md`「Scope Alarm」が置いた「Alarm を消す地点は turn の出口 1 か所に限る」とも正面から食い違っていた。

### Decision

**後始末を「種類」で分ける。** `armAndPublish(scope, upkeep)` の `upkeep` は `"commit"` か `"turnExit"` で、`"commit"` は `armForStoredRows`（張るだけ・決して消さない）、`"turnExit"` だけが `rescheduleAlarm`（行が無くなったので消す、を含む）を通る。publish 失敗時の `armNoLaterThan` は両方で従来どおり。

武装を後ろへ倒す（＝行が無くなったから消す）必要があるのは turn の出口だけである。commit 経路が要求するのは前倒しの武装だけで、消す権能を持つ理由が無い。

### 検討した代替案

**`rescheduleAlarm` を publish の後ろへ動かす**（arm → publish → 失敗時に再 arm、の順序を publish → reschedule へ）。1 か所の並べ替えで済むが、`armAndPublishNow` の「Arming first keeps the object's self-healing independent of D1」を壊す。D1 の往復中に isolate が落ちると、駆動する配備で行が武装されないまま残る。窓を別の窓と取り替えるだけなので採らない。

**spec を弱める**（「起動時の張り直しは消さない」と限定する）。上記のクラッシュ窓が残るので、canon を実装の側へ寄せる向きの解にならない。

### Consequences

- 良い点: 「alarm を消してよいのは turn の出口だけ」が実装と 1 対 1 になった。ADR-081 と本決定で、消す地点は `alarm()` の `finally` と未 bind 時の早期 return だけになる。
- 良い点: `deleteAlarm` 成功後・publish 完了前のクラッシュ窓が構造的に消えた。回復経路を張った当人以外が消すことはもう無い。
- トレードオフ: 最後の行が消えた commit の直後は、行が 1 つも無いのに alarm が 1 度だけ残る。その turn が `EMPTY_TURN` → `rescheduleAlarm` で自分で落とすので、余分な空 turn 1 回で収まる。
- `__tests__/alarm.test.ts` が「publish を落として張った再試行 alarm が、`scheduled_tasks` を触る成功 commit のあとも残る」を実バインディングで固定する。
- canon の追随: `do/dueIndex.ts` の「再試行を誰も取り上げない」段落へ commit 経路を含めた。`spec/platform/index.md`「Scope Alarm」は ADR-081 の時点で既にこの形なので動かさない。

## ADR-091: autocommit publish の構造的な移送は配備スライスへ送り、本 PR は拒否で閉じる

### Context

ADR-087 は「object 駆動配備で autocommit の `ScopeTaskScheduler` を `databaseError` で拒む」を決め、その**置き場所**（`write` の入口）を記録した。拒否そのものを選んだ理由 — なぜレビュアーが挙げた構造的な移送を採らなかったか — は記録していない。

移送案はこうである。`RowMutation` は既に `table` を持つので、`createAutocommitSession.write` が touched tables を集め、executor が `ScopeSqlExecutor` なら `apply` ではなく `applyWriteSet(statements, tables)` を呼ぶ。そうすれば autocommit の書きも object の `armAndPublish` 鎖を通り、publish は object の 1 本に寄り、scheduler から `publishDueIndex` / `logger` / `db` 依存が落ち、拒否そのものが不要になる。設計としてはこちらが素直である。

### Decision

**本 PR では拒否で閉じ、移送は配備スライスの持ち分とする。**

理由は範囲である。移送は `sql/session.ts` / `sql/executor.ts` / `do/scopeStub.ts` / scheduler の依存 / `di/cloudflareRuntime.ts` / 適合ハーネスまで連鎖し、autocommit セッションの意味（「executor へ素通しする」）そのものを変える。Blocker 0 の収束ラウンドで開く範囲としては大きい。一方で拒否はレジストリを読む 3 行で、閉じる穴は同じ — 「索引にしか載らない行を誰も起こさない」配備でその経路が使われることを防ぐ。

今日 production の呼び出し元は 0 件（`cloudflareRuntime.ts` は scheduler を `buildRepositories` の中でしか組み立てず、`runDueScopeTasks` は claim も settle も UoW の中で行う）なので、移送しても取り除ける実害は今日ゼロである。指摘の本体は「配備スライスが Queue consumer から UoW を開かずに settle した瞬間に穴が開き、そのとき気づける仕掛けが無い」だった。拒否はまさにその瞬間に気づかせる。

### Consequences

- 良い点: 穴が開く瞬間に呼び出し元が落ちる。移送を先送りしても、先送りが静かな故障に化けない。
- 良い点: 収束ラウンドで実行機構の意味を変えずに済む。
- トレードオフ: autocommit 経路の publish は object の直列化（ADR-082）の外に残る。並行 settle が古いスライスを着地させうる形は残るが、その形へ到達できるのは object 駆動でない配備で UoW を開かずに settle する呼び出し元だけで、今日は存在しない。
- 移送を実際に行うのは配備スライス（Worker entry / Queue consumer / Cron。plan.md「含まれないもの」）である。そこで autocommit の settle が要ると決まったら、拒否ではなく移送へ倒す。

## ADR-092: タグ名重複の契約文はポート JSDoc から落とし、実装側の WHY に残す

### Context

Round 001 は D1 の検索が `COUNT(DISTINCT tag) = tagNames.length` で数えるため、同じタグ名を 2 度渡すと 1 件も一致しなくなる取りこぼしを見つけた。実装は修正した（`projection/searchClauses.ts` の `tagFilterBindings` が `new Set` で重複を除いて `COUNT(DISTINCT …)` と釣り合わせる）が、同時に `LocalNoteQueryService` / `PublicNoteQueryService` の `tagNames` へ «a repeated name filters no differently from one» という**契約文**を足していた。

ところが共有適合スイートに重複タグを渡すケースは 1 件も無く、`spec/domains/note.md` の型注釈も据え置きのままだった。CLAUDE.md「Port contracts and conformance」と AC-8 は「契約上の振る舞いを足すならポート JSDoc と適合スイートの両方に触れる」と定めるので、片側だけに載った状態は解消が要る。

### Decision

**契約文をポート JSDoc から落とす。** 適合スイート・`adapters/memory/`・`spec/domains/note.md` は 1 行も触らない。

本 PR は「適合スイート本体を変更しない」を通しており（AC-7、#48 も同じ理由）、スイートを足す側へ倒すと両バックエンドの再検証まで開く。両バックエンドが今日同じ答えを返す以上（memory は `every` の再評価で自然に満たし、CF は重複除去で釣り合う）、収束ラウンドでその手続きを開く価値が無い。取りこぼしを防ぐ WHY は実装側（`tagFilterBindings`）に既にあり、そこが正しい置き場所である。

### Consequences

- 良い点: 「ポート JSDoc に書いてあるがスイートが観測しない契約」が 1 つ減った。ADR 026 の「契約の正本はポート定義、その実行形が共有スイート」が両側で揃う。
- トレードオフ: 重複タグの扱いは契約として未定義に戻る。今日は両バックエンドが一致するが、退行を捕まえる仕掛けは無い。
- 契約化したいなら、適合スイートに 2 ポートぶんのケースを足し、両バックエンドで緑を確認し、`spec/domains/note.md` の型注釈にも同じ一文を添える別 Issue になる。

## ADR-093: `spec/inventory/frontend.md` の最終同期日は動かさない

### Context

本 PR は `PAGE-p41-002` の要点欄を「署名 cursor」→「opaque cursor」へ改めた（ADR-067 の撤回範囲）。同じ改訂で `adapter.md` / `domain.md` / `test.md` / `usecase.md` の 4 本は最終同期日を `2026-08-26` へ上げているのに、`frontend.md` だけ `2026-08-16` のまま据わっている。Round 004 でも同じ形が指摘され、除外と判定されている。

### Decision

**動かさない。** 判定は Round 004 のまま継承する。

台帳の「最終同期」は「その日付時点で**生成元**と一致している」という主張である。`frontend.md` の生成元は `spec/pages/` で、本 PR はそこを 1 行も変えていない（`grep cursor spec/pages/` → 0 件）。訂正した要点欄は、生成元に対応物を持たない記述が台帳側にだけ存在していたものの修正であって、突き合わせの結果ではない。日付を上げると「していない照合をした」と主張することになる。

### Consequences

- 良い点: 同期日が「照合した日」の意味を保つ。台帳を再生成するとき、どこまでが実際に突き合わせ済みかを日付から読める。
- トレードオフ: 「行を触ったのに日付が古い」という見た目は残り、同じ指摘が再び上がりうる。本 ADR と `review/triage-keys.md` の該当行がその答えになる。
