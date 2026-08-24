# ADR — Issue #19: ScopeTaskScheduler の priority と lease

## ADR-001: 枠取りは「各 priority へ最低 1 枠 + 残りは厳密 priority 順」とする

### Context

`spec/database/index.md#scheduled_tasks` は priority の値域（0..3）と「同 priority 内は `due_at, kind, operation_id` 順」を定め、飢餓回避を「weighted round-robin」とだけ書く。重みの与え方は複数ありうる:

- (a) 比率予約: `limit × w_p / Σw` を priority ごとに予約する（例 40/30/20/10）
- (b) 最低 1 枠: priority ごとに 1 件だけ予約し、残りは priority 昇順で埋める
- (c) 枠取りをせず厳密 priority 順のみ

ただし `spec/platform/index.md:181` に「1 turn で**各 priority へ最低 1 枠**を確保する weighted round-robin」と、すでに規定がある。

### Decision

(b) を採る。契約を次の 3 段で規定する（`claimDue` / `listDue` 共通）。

1. 候補 = 「`pending` かつ `dueAt <= now`」または「`running` かつリース失効済み」
2. 予約枠: priority 昇順に、各 priority の候補のうち **`(dueAt, kind, operationId)` が最小の 1 件**を budget が尽きるまで取る
3. 残り枠: 残りの候補を `(priority, dueAt, kind, operationId)` 昇順で埋める。**返却順も同じ**

2. の「1 件」をクラス内の全順序で閉じるのは、返却**順**だけを凍結しても返却**集合**が決まらないためである。priority 0 に A(`dueAt` 1) / B(`dueAt` 2)、priority 3 に C があって `limit: 2` のとき、予約枠が A と B のどちらを取るかで結果は `[A, C]` / `[B, C]` に分かれる。クラス内順序は `spec/database/index.md:969`（同 priority 内は `due_at`, `kind`, `operation_id` 順）と同一なので新しい規則ではないが、ADR-001 が返却順まで凍結する強い契約を選んだ以上、集合のほうを未定義に残さない。

`limit` が priority クラス数を下回る場合は 2. が途中で打ち切られ、実質「厳密 priority 順」に縮退する。予約は**上限ではなく下限**なので、他クラスが空なら 1 クラスが `limit` 全部を取る。

重みの数値をここで発明しないので、spec に新しい定数を持ち込まずに済む。

### Consequences

- 良い点: spec の記述（platform）をそのまま契約にでき、比率という新しい語彙を spec に追加しなくてよい。D1 実装は「priority ごとに `LIMIT 1` の 4 本 + 残りを 1 本」で書け、DO の Alarm turn でも同じ形になる
- 良い点: 低 priority の大量滞留があっても priority 0 は必ず取られ、逆に priority 0 の大量滞留があっても低 priority が 1 turn 1 件は進む
- 良い点: 予約枠が取る 1 件までクラス内順序で決まるので、`limit` がクラス内候補数を下回る局面でも返却集合が一意に定まり、バックエンド間で観測がぶれない（適合スイートに 1 ケースとして落とす）
- トレードオフ: 「最低 1 枠」が保証する下限は薄い。**priority 0 の候補が budget を埋め尽くした最悪ケース**では、budget 100 に対して低 priority に保証される前進は 1 turn 1 件だけになる。これは下限であって上限ではない（予約枠は上限にならない — 上記 Decision / AC-4）ので、priority 0 が budget を埋め尽くさない限り低 priority は充填パスで何件でも進む。実装済み 4 kind では priority 0 が 100 件溜まる状況自体が稀なので、通常 `identity.personalBarrierPruneContinued` が 1 件に切られるわけではない。この**保証**の水準で期限回収が足りるかは #11 の実配備で再評価する
- トレードオフ: 素朴な `ORDER BY ... LIMIT` の 1 クエリでは実装できず、どのバックエンドも 2 段の選択になる
- トレードオフ: **返却順まで契約に凍結するので、#11 が比率型 WRR へ寄せる余地をここで閉じる**。実配備で「1 turn 1 件では足りない」と判明した場合、緩めるには本 ADR と適合スイートの両方を改訂する必要がある（＝契約変更として明示的に扱う）。保証（各 priority ≥ 1 枠）だけを凍結して充填順を自由にする案もあったが、順序が観測可能である以上バックエンド間で暗黙にばらつくほうが害が大きいと判断した

---

## ADR-002: リース期限は `dueAt` と別に持つ（`dueAt` は実行予定時刻のまま据え置く）

### Context

`spec/database/index.md#scheduled_tasks` の列は `kind` / `operation_id` / `due_at` / `payload` / `attempts` / `last_error` / `priority` / `status` で、**リース期限を置く列が無い**。`status = 'running'` だけが定義されている。リースの表し方は:

- (a) claim 時に `due_at` を `now + leaseMs` へ押し出し、`status = 'running'` の行は `due_at <= now` で回収可能とする（列を足さない）
- (b) `lease_expires_at` を 1 列足し、`due_at` は実行予定時刻のまま据え置く
- (c) outbox 先例に倣い `claimed_at`（+ `claimed_by`）を足し、失効を `claimed_at <= now - leaseMs` で判定する
- (d) リースを持たず single writer 前提のままにする（現状）

同 repo には先例がある。`OutboxRepository.claimPending` は再試行時刻（`next_attempt_at`）とリース（`claimed_at`）を**別列**に持ち、`claimed_at <= now - leaseMs` で回収する（`adapters/memory/repositories/outboxRepository.ts`）。つまり既存のポート群は「いつ実行したいか」と「いま誰が掴んでいるか」を混ぜていない。

### Decision

(b) を採る。**`dueAt` は状態によらず「実行予定時刻」を意味し、claim はこれを書き換えない。** claim は `status = 'running'` と `leaseExpiresAt = now + leaseMs` を同じ scope トランザクションで書き、`leaseExpiresAt` を過ぎた `running` 行は再 claim 可能になる。回収された行は `dueAt` / `payload` / `priority` / `attempt` をすべて claim 前のまま保つ。

(a) を退けた理由が決定的である。`spec/platform/index.md:186` は「priority 0 の最古 task age は 1 分」を SLO とし、超過を global 運用イベントへ送ると定める。`scheduled_tasks` に `created_at` は無いので task age は `due_at` からしか導けない。claim のたびに `due_at` を `now + leaseMs` へ押し出すと、**settle されないまま reclaim を繰り返す行の age が永久に `leaseMs` 以下に見える**。ADR-004（失効 reclaim は attempt を消費しない）と組み合わさると、ハンドラ未登録の行やプロセスごと落ちる poison task — SLO が検知すべき筆頭のケース — が構造的に検知不能になる。SLO を測れない設計は spec の持ち分を黙って壊している。

(c)（`claimed_at` + `leaseMs` 判定）は先例そのものだが、`scheduled_tasks` は outbox と駆動方式が違う。DO は「次に起きるべき時刻」を `setAlarm()` に**保存済みデータだけから**決める必要があり、`claimed_at` 方式では失効時刻が実行時パラメータ `leaseMs` に依存するため表から導けない。`lease_expires_at` は絶対時刻なので、Alarm は「pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方」で決まる。先例から採るのは**「実行予定時刻とリースを分ける」という原則**であって、列の形ではない。

なお**この決定はポート契約には書かない**。ポートが規定するのは観測可能な振る舞い（claim した行は `leaseExpiresAt` まで `claimDue` / `listDue` に現れない・失効後に `dueAt` / `payload` / `priority` / `attempt` を保って戻る）だけで、それを何列でどう保存するかはバックエンドの自由である（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) §3）。列の形は `spec/database`（D1 / DO のスキーマ正本）と memory アダプターの実装にそれぞれ属する。

### Consequences

- 良い点: `due_at` が単一の意味を保つので、`spec/platform` の「priority 0 の最古 task age 1 分」SLO が `MIN(due_at) WHERE priority = 0` で素直に測れる。reclaim を繰り返す行ほど age が伸び、SLO が本来検知すべきケースが検知できる
- 良い点: 同 priority 内の並び順（`due_at` 順）が claim を跨いで安定する。リース失効で戻った行が「今さっき予定されたばかりの行」として列の末尾へ回らない
- 良い点: `ScopeTask` が `dueAt` と `leaseExpiresAt` の両方を出せるので、「reclaim が位置を保つ」ことを適合スイートが**ポート越しに**assert できる（生行を覗く backend-local テストにしなくて済む）
- 良い点: 状態によって意味が変わる列が無くなるので、memory の行を直接読む既存テスト（`deleteAccount.cleanup.test.ts:126` / `deleteAccount.terminalPrune.test.ts:345` / `deleteFilesByOwner.test.ts:353`）が読み違える余地が消える
- トレードオフ: `spec/database/index.md#scheduled_tasks` に列が 1 つ増える。spec の改訂が本 Issue の作業に入る（ADR-008）
- トレードオフ: 候補述語が 2 分岐になる（`pending AND due_at <= now` / `running AND lease_expires_at <= now`）。Alarm 起床時刻も 2 列の最小値になる。索引は dequeue 用 `(priority, due_at, kind, operation_id)` がそのまま効くが、`lease_expires_at` を見る経路には既存 2 索引のどちらも効かないので、`spec/database` に索引を 1 本足す（ADR-008）。Alarm 起床規則そのものが `spec/platform` 側の記述でもあるため、そちらの改訂も同じ ADR-008 の持ち分に含める
- トレードオフ: 「1 本の述語・1 本の索引」という (a) の簡潔さは失う。SLO 測定可能性と引き換えとして受け入れる

---

## ADR-003: `ScopeTask` に `leaseExpiresAt` を足し、`dueAt` は残す

### Context

ADR-002 により claim 済みの行は「実行予定時刻」と「リース期限」の 2 つの時刻を持つ。ポートが外へ出す `ScopeTask` をどう作るかで:

- (a) `dueAt` を `leaseExpiresAt` へ改名する（＝実行予定時刻を外へ出さない）
- (b) `dueAt` を残し、`leaseExpiresAt` を足す
- (c) 時刻を一切出さない

現在 `ScopeTask.dueAt` を読む呼び出し側は 1 つも無い（handler は kind / operationId / payload / scope しか使わない）。

### Decision

(b)。`ScopeTask = { kind, operationId, priority, payload, dueAt, leaseExpiresAt, attempt }` とする。`dueAt` は claim を跨いで不変の「実行予定時刻」、`leaseExpiresAt` は「このクレームがいつまで有効か」＝ turn が settle を終えるべき期限。

(a) は ADR-002 が (a) 案（`due_at` 兼用）だったときの帰結であり、その前提が消えた以上動機も消える。(c) は「reclaim が位置を保つ」を適合スイートがポート越しに検証できなくなるので採らない。

### Consequences

- 良い点: 破壊的変更にならない（`dueAt` の意味は不変のまま `leaseExpiresAt` が増えるだけ）。既存の読み手が居ないことに依存しない
- 良い点: 長い turn が `leaseExpiresAt` を見て残り時間で打ち切る余地が残る
- トレードオフ: `ScopeTask` のフィールドが 2 つ増える（`priority` / `leaseExpiresAt`）。いずれも観測可能で契約に属する値なので、増やす価値がある

---

## ADR-004: リース失効による再 claim は attempt を消費しない

### Context

失効したリースを回収するとき attempt を増やすかどうかで 2 案:

- (a) 増やす: プロセスごと落ちるような poison task が上限で `failed` に落ちる。ただし「ハンドラ未登録の行」も再 claim のたびに attempt を焼き、やがて静かに `failed` になる。これを避けるには running → pending をペナルティ無しで戻す `release` メソッドが要る（ポート 6 メソッド化）
- (b) 増やさない: attempt は「settle された失敗」（`backoff`）だけを数える。ハンドラ未登録の行は現状どおり永久に停滞し続け、ログに立ち続ける

### Decision

(b)。attempt の意味を「backoff で settle された失敗の回数」に一本化し、リース失効は「書き手を見失った」ことしか意味しないので回収を優先する。ポートは 5 メソッドのまま。

### Consequences

- 良い点: ハンドラ未登録の行が「見えるまま停滞」を保つ（`failed` に落ちて静かに消えない）。#2 が JSDoc に書いた設計意図を維持できる
- 良い点: ADR-002 と組み合わさって、停滞した行の `dueAt` が過去のまま伸び続ける。SLO（priority 0 の最古 task age）がまさにこの行を検知する
- 良い点: runner 側の変更が要らない（`release` を呼ぶ判断を持たずに済む）
- トレードオフ: プロセスごと殺す task は無限に再駆動される。ハンドラ内の例外は runner が捕まえて backoff するので、この経路に落ちるのは OOM / プロセス強制終了級だけであり、そのときは行より先にプロセスが可視の障害になっている
- トレードオフ: 未処理 kind の再来周期が「毎 tick（1 秒）」から「リース失効ごと（既定 5 分）」へ伸び、**警告ログの頻度が 300 分の 1 になる**。`workers/scopeTaskRunner.ts` の JSDoc は「standing log line（毎 tick 立ち続けること）」を可視性の担保として明記していたので、この根拠は成立しなくなる。JSDoc を「未登録 kind が存在する限りリース周期で立ち続ける」性質へ書き直し（ステップ 8）、監視は**ログ頻度ではなく `dueAt` から測る最古 task age**に拠るべきことを #11 への引き継ぎに残す

---

## ADR-005: settle は fencing しない（リース超過時の取り違えを許容する）

### Context

リースを取っても、settle（`complete` / `backoff` / `schedule`）は行キー `(kind, operationId)` だけで撃たれる。リースを超過した writer A の settle が、その間に再 claim した writer B の武装し直した行を消しうる。厳密にやるなら claim が返す claim token を settle が要求する（fencing）。

しかし本設計では settle するのは runner ではなく**ユースケース自身**（`deleteQuota` / `deleteFilesByOwner` / `prunePersonalCleanupBarriers` が自分の UoW で `complete` / `schedule` を呼ぶ）である。token を要求すると runner → ユースケース入力 → UoW へ token を通す配管が要り、ユースケースの入力型が駆動方式に汚染される。

`OutboxRepository.finalize` も同じく fencing を持たない（処理済み ID を渡すだけ）ので、既存のポート群の姿勢とも揃う。

### Decision

fencing token は導入しない。ポート JSDoc に「リースは助言的であり、`leaseMs` は最悪ケースの turn 所要時間を上回るように配備側が選ぶ」と明記し、**上回らなかったときに何が壊れるか**（下記 Consequences の実害）も 1 行で書く。既定値は outbox の `DEFAULT_LEASE_MS` に合わせて 5 分とし、1 回の claim バッチ（最大 100 行）全体を覆えることを条件として書く。

「配備側が選ぶ」を契約に書く以上、参照ランタイムにも選ぶ経路を実際に用意する（ADR-010）。契約文だけが責務を負わせて配線が既定値固定のままだと、この ADR の実害の重さを黙って既定値に賭ける形になる。

### Consequences

- 良い点: ユースケースの入力型が駆動方式から独立したままになる。ポート面も増えない
- 良い点: 既存 outbox ポートと同じ保証レベルで揃う
- トレードオフ: リース超過時に「B が武装した継続を A が complete する」窓が残る。**実害は「継続の鎖が止まる」で終わらない** — 止まるのが personal cleanup の継続なら、`accountDeletionBarrier` が開いたまま・User が `deleting` のまま残る。reference runtime には global recovery cron（`spec/platform` の `*/5` reservation / operation recovery）が実装されていないので、**自動復旧経路が無く、アカウント削除が恒久停止する**
- したがって #11 への引き継ぎは「要否を再判定する」ではなく「**複数 writer を実配備する前に fencing の要否を決着させること（未決着のまま配備しない）**」の強さで残す

---

## ADR-006: priority は `schedule` の必須入力とし、kind との対応は呼び出し側に置く

### Context

priority をどこで決めるか:

- (a) ポートが kind → priority の表を持つ
- (b) `schedule` / `backoffOrSchedule` の必須入力にする（呼び出し側が名前付き定数を渡す）
- (c) 任意入力にして既定値（例 2）を持つ

(a) は、kind 定数が `application/cleanup/participants.ts` / `personalCleanup.ts` / `workers/scopeTaskRunner.ts` に分散しているため、ポートがそれらを import する（依存が外向きに反転する）か、逆輸入で循環する。

### Decision

(b)。値域は名前付き const object + union 型で `0 | 1 | 2 | 3` に閉じる（`ScopeTaskPriority.securityCleanup` など）。`spec/database` の分類語をそのままキー名にする。既定値は置かない — 新しい継続 kind を足す人に必ず 1 度考えさせるため。

### Consequences

- 良い点: 値域が型で閉じ、`spec/database` の 4 分類以外は書けない
- 良い点: ポートは機械的な永続化のままで、分類の知識はアプリケーション層に残る
- トレードオフ: 同じ kind を 2 か所から別 priority で `schedule` しうる（型では防げない）。実害は並び順が変わるだけで、現状の 4 kind はいずれも同一ファイル内の隣接行から積まれるためレビューで足りる
- トレードオフ: 本リポジトリで実際に使われるのは `securityCleanup`(0) と `expiryCollection`(3) だけで、`outboxRelay`(1) / `projection`(2) は利用者ゼロのまま入る。この 2 分類は `spec/platform` では scope Alarm が担う仕事だが、本リポジトリの outbox relay は global の `eventRelayWorker` が持ち、private projection は scope task として存在しない。値域を spec のまま写す（4 値で閉じる）ほうが、後から分類を発明するより安い

---

## ADR-007: `listDue` にも同じ枠取りを課す。ただし round 全体の配分は本 Issue では変えない

### Context

`ScopeTaskQueue.listDue` は「どの scope に仕事があるか」を返す scope 横断の読みで、runner はその結果を scope で dedup してから scope ごとに `claimDue` する。枠取りを `claimDue` だけに入れると、priority 0 の行が多数の scope に散っている間、priority 3 しか持たない scope は `listDue` の `limit` に入れず**そもそも候補に載らない**。scope 内の WRR では埋め合わせられない。

一方で `workers/scopeTaskRunner.ts:135-148` は、`listDue` の結果を dedup したあと**先頭の scope に残 budget を丸ごと渡す**（`claimDue(now, budget)`）。priority 0 の行を 100 件持つ scope が先頭に来ると budget はそこで尽き、`listDue` が予約枠で載せた priority 3 の scope はその round では訪問されない。

### Decision

`listDue` にも `claimDue` と同一の選択規則を課す（予約枠は scope 横断で priority ごとに 1 件）。Issue の範囲 1 も「`claimDue` / `listDue` の並び順契約」と両方を名指ししている。

**runner の round 内 budget 配分は本 Issue では変更しない。** 理由は 3 つ:

1. spec が飢餓回避を課しているのは **scope Alarm の 1 turn**（＝ 1 scope object の中）であり（`spec/platform/index.md:181`）、`claimDue` の枠取りがそれを厳密に満たす。scope 横断の配分は spec が要求していない
2. 最終プラットフォームには中央 runner が存在しない（各 scope DO が自分の Alarm を回す — [ADR 021](../../spec/adr/021-scope-sharded-data-plane.md)）。round 内配分の問題は reference runtime の中央 runner に固有の産物であり、#11 が持ち込まない
3. 直すには「scope 間の公平性ポリシー」を新たに発明する必要があり（均等割り？ scope 数で割る？）、spec に根拠が無い

### Consequences

- 良い点: **`listDue` の段で低 priority しか持たない scope が候補から落ちなくなる**（実際に訪問されるかは runner の budget 配分次第）。これが `listDue` に枠取りを課したことで得られる保証のすべてであり、「飢餓回避が scope 選択の段でも成立する」わけではない
- 良い点: 契約文が 1 つで済み、適合スイートも同じ規則を 2 面に当てるだけになる
- トレードオフ: 予約枠は「priority 3 の**クラス**が 1 件載る」であって「priority 3 を持つ特定の scope が載る」ではない。priority 3 を持つ scope が複数あれば、どれが載るかは `(dueAt, kind, operationId)` 順で決まる
- トレードオフ: **AC-2〜AC-4 はポート単体の性質であり、runner の 1 ラウンド全体では予約枠は保証されない**。priority 0 で埋まった scope が先頭に来た round では、他 scope は次の tick（既定 1 秒後）まで待つ。plan.md のリスク節に残課題として明記し、ラウンド配分は #11 の実配備で再評価する

---

## ADR-008: `spec/database` に lease 列とリース索引を足し、`spec/platform` の Alarm 起床規則を lease 込みへ揃える

### Context

「spec の持ち分を変える判断か」の照合結果:

- priority の値域・分類・同 priority 内の順序 → `spec/database/index.md` のとおりに実装する（変更なし）
- 枠取り = 各 priority 最低 1 枠 → `spec/platform/index.md:181` のとおり（変更なし）
- `status` の 3 値 → `spec/database` のとおり（変更なし）
- priority 0 の最古 task age 1 分 SLO（`spec/platform/index.md:186`）→ ADR-002 で `due_at` を据え置いたので測定可能なまま（変更なし）
- **リース期限の置き場所（ADR-002）→ spec が列を定義していない空白であり、`lease_expires_at` を 1 列足す判断になる**
- **Alarm 起床規則 → ADR-002 が候補述語を 2 分岐にしたことで、起床時刻が「pending の最小 `due_at`」だけでは足りなくなる**
- `leaseMs` の既定値、`ScopeTask.leaseExpiresAt`、fencing 非採用、priority の遷移規則（ADR-009）→ いずれも spec に記述が無く、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) により**ポート定義が正本**の領分

Alarm 起床規則は `spec/database` ではなく `spec/platform` に書かれている。`spec/platform/index.md:177` は「…の最小 `due_at` を `setAlarm()` する」、同 :184（Alarm handler 規則 4）は「最後に次の最小 `due_at` を Alarm へ設定する」で、どちらもリース列を知らない。`scheduled_tasks` 節にだけ「小さい方へ設定する」と書くと、同じ振る舞いについて 2 つの spec ファイルが違うことを言う状態が残る。実害は #11 に落ちる — `spec/platform` だけを読んだ実装者は Alarm を `due_at` だけで張り、**リース失効した `running` 行を誰も起こさない**（reference runtime は 1 秒 tick のポーリングなので露見しないが、DO は Alarm 駆動）。ADR-002 が (c) `claimed_at` 案を棄却した柱は「`lease_expires_at` は絶対時刻なので Alarm が保存済みデータだけから起床時刻を決められる」であり、その根拠が効く場所は platform の Alarm 規則そのものである。

索引にも同じ空白がある。`scheduled_tasks` の現行索引は Alarm 時刻用 (`due_at`, `priority`, `kind`, `operation_id`) と dequeue 用 (`priority`, `due_at`, `kind`, `operation_id`) の 2 本（`spec/database/index.md:973`）で、どちらも `lease_expires_at` を先頭に持たない。`spec/database` はアクセスパスごとに索引を書き分ける体裁であり、同型の前例もある（`spec/database/index.md:674` の `jobs_lease_idx` (`lease_expires_at`) WHERE `status='running'` — リーパーの `listExpiredRunning` 用）。選択肢は:

- (a) 索引を 1 本足す
- (b) 足さず、足さない理由を書く（`running` 行は 1 回の claim バッチ＝最大 100 行に上限され、scope object 内の走査で足りる）

### Decision

本 Issue で spec を 3 か所改訂する（steps.md ステップ 11。仕上げのステップ 12 ではない）。

**`spec/database/index.md#scheduled_tasks`**:

1. 列 `lease_expires_at`（integer, `status='running'` のとき NOT NULL / 他状態では NULL）
2. 「`status='running'` の行は `lease_expires_at` までクレーム中。`lease_expires_at <= now` になった行は再 claim 可能で、`due_at` / `attempts` / `priority` / `payload` は claim 前のまま保つ」
3. 「候補は `status='pending' AND due_at <= now` または `status='running' AND lease_expires_at <= now`」
4. 「`due_at` は状態によらず実行予定時刻を意味する」（`spec/platform` の task age SLO がここに依存する）
5. 索引 1 本 `scheduled_tasks_lease_idx` (`lease_expires_at`) WHERE `status='running'`

**`spec/platform/index.md`**:

6. :177 の `setAlarm()` 文 — 起床時刻を「pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方」へ広げる
7. :184 の Alarm handler 規則 4 — 同じ導出へ揃える

Alarm 起床を述べる spec の出現はこの 2 か所だけではない。`spec/adr/021-scope-sharded-data-plane.md:88` も「最も早い時刻に 1 つの alarm を設定する」と書いており、#11 がここから入る経路もある。ただし**改訂は不要**である — 「最小 `due_at`」ではなく「最も早い時刻」とだけ書いて列名を挙げていないので、リース失効時刻を含む導出と矛盾しない。AC-14(b) の「spec 内で Alarm の記述が矛盾しない」は、この 1 行の結論をもって全出現に対して検証されたことにする。

索引は (a) を採る。Alarm 起床時刻の導出が「表からの最小値 2 本」になった以上、片方に索引が無いと DO が毎 turn 全走査で起床時刻を決めることになる。(b) の「1 バッチ最大 100 行」は 1 回の claim に掛かる上限であって `running` 行の総数を縛らない — settle されない行は失効まで残り、複数バッチが重なりうる。`jobs_lease_idx` と同型なので spec に新しい語彙も持ち込まない。

これ以外の spec は変更しない。ポート契約に属する決定（ADR-001 / 003 / 004 / 005 / 006 / 009 / 010）はポート JSDoc と適合スイートが正本であり、#11 はそちらを読む。

なお `ScopeTaskScheduler` / `ScopeTaskQueue` は spec 全域に 1 件も現れず（`spec/domains/` に節が無く、`spec/inventory/adapter.md` に ADP 行も無い）、#2 の新設時点から spec 未記載である。この欠落自体は本 Issue の要件（priority / lease）とは独立なので spec-sync の持ち分として残す。

### Consequences

- 良い点: #11 が `spec/database` だけを読んでも `lease_expires_at` と索引に行き着き、`spec/platform` だけを読んでも失効した `running` 行を起こす Alarm を張る。どちらの入口からでも同じ振る舞いに到達する
- 良い点: spec が自己矛盾しない。`scheduled_tasks` だけ直して platform を放置すると、spec-sync が後で拾う負債を自分で作ることになる（CLAUDE.md「Design canon」— spec に書かれていることはコードについて真であるという前提）
- 良い点: ADR-002 の決定が `.thread/19/adr.md`（Issue 完了後は残らない足場）だけに置かれる状態を避けられる
- トレードオフ: spec の改訂が本 Issue のスコープに入る。ただし列 1 つ・索引 1 本・注記 4 文・platform の 2 句で、既存の値域・分類・枠取り・`status` 3 値・SLO には触れない
- トレードオフ: 書き込み側の索引更新が 1 本ぶん増える（claim と settle のたび）。`jobs` が同じ形の索引を持っているので、コストの水準は spec 内で既知
- トレードオフ: memory アダプターの行の形が `spec/database` の列と 1:1 である必要は無い（[ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md) の参照バックエンドは D1 のミラーではない）。両者が揃うのは偶然ではなく「実行予定時刻とリースを分ける」原則を共有するからだ、という点は steps.md のアダプター節に書く

---

## ADR-009: `priority` は `schedule` だけが上書きし、`backoffOrSchedule` は既存行の priority を保つ

### Context

ADR-006 で `schedule` / `backoffOrSchedule` の両方が `priority` を必須入力に取る。既存行があるときに入力の priority をどう扱うかが決まっていないと、`deleteFilesByOwner` のように同じ行へ継続時 `schedule` / 停滞時 `backoffOrSchedule` を撃ち分ける経路で挙動が読めない。

- (a) どちらも上書きする
- (b) `schedule` は上書き、`backoffOrSchedule` は mint 時のみ使用（既存行は不変）
- (c) どちらも mint 時のみ

### Decision

(b)。5 操作すべてについて遷移表に明記する:

| 操作 | `priority` |
| --- | --- |
| `schedule` | `input.priority` で上書き |
| `backoffOrSchedule` | 行が無ければ `input.priority` で mint。**既存行は不変** |
| `backoff` | 不変 |
| `claimDue` | 不変 |
| `complete` | 行削除 |

`schedule` は「この仕事をこう予定する」という宣言なので入力が勝つ。`backoffOrSchedule` は「進捗 0 だったので後ろへずらす」であって分類のやり直しではないので、既存行の分類を書き換えない。

### Consequences

- 良い点: 停滞のたびに priority が書き戻される経路が無くなり、claim 順が stall の有無で揺れない
- 良い点: 適合スイートで「stall した行を別 priority で `backoffOrSchedule` しても claim 順が変わらない」を 1 ケースで拘束できる
- トレードオフ: `schedule` と `backoffOrSchedule` で入力 priority の効き方が非対称になる。遷移表に明記することで契約から読めるようにする
- トレードオフ: 既存行の priority を意図的に変えたい呼び出し側は `schedule` を使うしかない。現状そのような要求は無い

---

## ADR-010: `leaseMs` は参照ランタイムでも配備側が選べるようにする（env へ露出する）

### Context

ADR-005 は fencing を採らない代わりに「`leaseMs` は最悪ケースの turn 所要時間を上回るように**配備側が選ぶ**」を契約の柱に据え、外したときの実害を「アカウント削除が恒久停止する」まで引き上げた。ところが `SCOPE_TASK_LEASE_MS` をポートの定数に置くだけでは、参照ランタイム（`apps/web/app/worker/node/runner.ts:133` の `runDueScopeTasks(container)`）は既定値のまま呼び続ける。`RunDueScopeTasksOptions.leaseMs` はテストがリース失効を作るための口でしかなく、**配備側が選ぶ手段が存在しないまま契約文だけが配備側に責務を負わせる**状態になる。

- (a) `OUTBOX_LEASE_MS` に倣って env に露出する
- (b) 配線は #11 の持ち分と割り切り、ポート JSDoc を「参照ランタイムは既定に固定する」へ改める

先例は 1 ファイル隣にある。outbox のリースは `TuningEnv.OUTBOX_LEASE_MS`（`application/di/env.ts:12,19`）→ `NodeServerEnv`（`application/di/serverNode.ts:24,80,122`）→ `readRelayTuning` → `NodeWorkerRunnerTuning.relayOptions` → `processOutboxEvents` の 1 本道で通り、`apps/web/.env.example:69-70` に既定値つきで載っている。

ただし**逆向きの先例も同じ `NodeWorkerRunnerTuning` の中にある**。`scopeTaskIntervalMs`（`apps/web/app/worker/node/runner.ts:35`）は scope task 側の tuning でありながら env 経路を持たず、`server.node.ts:105-107` の `tuning` からも渡されていない（露出しているのは `relayOptions` と `outboxRetentionMs` の 2 つだけ）。つまり「scope task の tuning は env に出さない」という近い先例が実在し、outbox 側だけを引くのは片面的である。両者を分けるのは**外したときの実害の重さ**である: `scopeTaskIntervalMs` のズレは次 tick で回復する（しかも commit kick が主経路で、interval は取りこぼし用の安全網にすぎない）のに対し、`leaseMs` の不足は ADR-005 のとおりアカウント削除の恒久停止へ落ち、参照ランタイムには自動復旧経路が無い。露出するかどうかを分けるのは「scope task かどうか」ではなく、この実害の重さである。

### Decision

(a)。`SCOPE_TASK_LEASE_MS` を同じ経路で露出する。`TuningEnv` へ 1 変数、`readScopeTaskTuning`（`z.coerce.number().int().positive().default(SCOPE_TASK_LEASE_MS)`）、`NodeServerEnv` の 1 フィールドと `nodeServerEnvToTuningEnv` の射影、`NodeWorkerRunnerTuning.scopeTaskLeaseMs` から `runDueScopeTasks(container, { leaseMs })` まで、既存 outbox 変数の写経で通す。`.env.example` の「outbox / worker tuning」節に既定値つきコメントで載せる。

(b) を退けたのは、契約文と参照ランタイムの実態がずれた状態が一番危ないからである。ADR-005 の実害の重さを踏まえると、黙って既定値に賭ける形は取れない。

### Consequences

- 良い点: 「配備側が選ぶ」がポート JSDoc の宣言で終わらず、参照ランタイムで実効を持つ。#11 は同じ形（env → container → options）の先例を 2 本読める
- 良い点: 正の整数であることを boot 時の zod が強制するので、`leaseMs <= 0`（ポート JSDoc の入力境界）は参照ランタイムでは到達不能になる。適合スイートが拘束する `limit <= 0`（AC-10）とは別物であり、スイート側の責務は変わらない
- トレードオフ: env 面が 1 つ増え、同じ名前が `TuningEnv` / `NodeServerEnv` / runner tuning / `.env.example` の 4 か所に並ぶ。outbox の 4 変数と同じ形なので追随コストは低い
- トレードオフ: 値が実際に最悪ケースの turn を上回るかは依然として配備側の判断で、型でも zod でも縛れない。ADR-005 の「複数 writer を配備する前に fencing の要否を決着させる」引き継ぎはそのまま残る

---

## ADR-011: 候補述語は memory の scheduler に置き、`scopeTaskQueue` がそれを import する

### Context

選択規則は `scopeTaskSelection.ts` の純粋関数に置いた（steps.md ステップ 5）が、「どの行が候補か」は行の判別共用体（`pending` は `dueAt <= now`、`running` は `leaseExpiresAt <= now`、`failed` は候補外）に依存するので純粋関数には入らない。しかし述語は `claimDue` と `listDue` の両方が要る。置き場所の候補:

- (a) `scopeTaskSelection.ts` に置く（純粋関数の中立性が崩れる — 行の形はバックエンド固有）
- (b) `store.ts` に置く（行型の隣だが、`store.ts` は今のところ型と MemTable 機構だけで述語を持たない）
- (c) `repositories/scopeTaskScheduler.ts` に `isScopeTaskDue` として置き、`scopeTaskQueue.ts` が import する

### Decision

(c)。`scopeTaskKey` と同じく「この表の読み書き規則」を持つファイルに述語を置き、scope 横断側がそれを借りる。述語の戻り型は `row is DueScheduledTaskRow`（`Extract<ScheduledTaskRow, { dueAt: Date }>`）とし、`selectDueScopeTasks` の構造的制約（`priority` / `dueAt` / `kind` / `operationId`）を型で満たす。

### Consequences

- 良い点: 規則の重複が消え、`claimDue` と `listDue` が候補集合でずれない（ADR-007 の前提）
- 良い点: `scopeTaskSelection.ts` がバックエンドの行の形を知らないままでいられる
- トレードオフ: `adapters/memory/scopeTaskQueue.ts` が `adapters/memory/repositories/` を 1 本 import する。どちらも memory アダプター内部なので層の依存方向には触れない

---

## ADR-012: 判別共用体の絞り込みは `.filter()` を 2 段に分ける

### Context

生行を読む既存テスト（`deleteAccount.cleanup.test.ts` / `deleteAccount.terminalPrune.test.ts`）は `kind` で絞ってから `dueAt` を読む。`ScheduledTaskRow` を共用体にしたので `state` でも絞る必要があるが、`filter((task) => task.kind === K && task.state === "pending")` は **`dueAt` が存在しない**という型エラーのままになる。tsgo の推論型述語（TS 5.5 の inferred type predicates）が `&&` で結んだ 2 条件の述語からは絞り込みを導かないため。

### Decision

`.filter((task) => task.kind === K).filter((task) => task.state === "pending")` と 2 段に分ける。1 条件の `filter` は推論型述語が効くので `state` 側で共用体が絞れ、明示的な型述語関数もキャストも要らない。

### Consequences

- 良い点: テストが型で守られたまま生行を読める（キャストを入れると共用体化の目的が消える）
- トレードオフ: 2 つの条件を 1 つの `filter` にまとめ直すと型エラーが戻る。エラーとして必ず露見するので黙って壊れることはない
