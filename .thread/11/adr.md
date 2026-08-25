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

## ADR-027: `membership_directory` は `operation_id` を edge key とし、`membership_id` を NULL 可にする

### Context

`AccountDeletionManifestStore.appendMembershipPage` は「所有 User の active / removing / pending edge を edge key 順に最大 100 件」ページングする契約で、適合スイートは `seedMembershipEdges` を持つバックエンドに対してのみページ内容を検査する（持たなければ 3 ケースを skip する）。土台のステップは `membership_directory` を作っておらず、Workspace ドメインにポートが無いのでリポジトリも無い。

`spec/database/index.md#membership_directory` の列定義は `operation_id` PK・`membership_id` NOT NULL・`role` NOT NULL・索引は (`user_id`, `state`, `created_at` DESC, `workspace_id`) と (`workspace_id`, `state`, `user_id`)。ところが

- 適合スイートの `MembershipEdgeSeedInput.membershipId` は `string | null` で、`pending` edge に `null` を渡す。spec 自身も `reserveAndClaimActivation` を「pending INSERT → 同 shard の Active User 検査 → activating 化」と定めており、pending 時点で workspace-local Membership はまだ存在しない
- spec の 2 本の索引はどちらも「edge key 昇順の keyset」を走れない

### Decision

`0003_membership_directory.sql` で表を足し、spec から 2 点だけ離れる。

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

`0003_membership_directory.sql` で 2 本を `DROP INDEX` して kind 込みで作り直す（`(kind, partition_key, request_key)` と `(kind, partition_key) WHERE state NOT IN (...)`）。あわせて `countTerminalSince` が使う terminal 索引にも kind を入れ、partition 走査用の `(kind, partition_key, id)` を足す。0001 は編集しない — migration は追記のみで進める。

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
