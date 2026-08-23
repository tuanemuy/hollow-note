# Round 2 修正方針

統合後 14 件 — fix 14 / wont-fix 0 / defer 0。

統合したもの（以降 1 件として扱う）:

- **Port W-002 + Spec W-002** — どちらも「既定リース 5 分が、本 PR が `spec/platform:186` に足した選定規則の上限側（priority 0 の age SLO = 1 分）を満たさない」
- **Port W-003 + Adapter W-001** — どちらも「適合スイートが `leaseMs` を一度も非既定値で呼ばず、引数を無視するバックエンドが緑で通る」

Round 1 台帳との照合: Key が完全一致する既出指摘は無い。近いものが 2 件あるが、いずれも Round 1 の**修正の帰結として新たに生じた**ものなので再審議ではない。

- Round 1 Spec W-005（「既定 5 分と SLO の関係が spec に無い」→ fix）で足した文が、今回の Port W-002 + Spec W-002 が指す矛盾を可視化した。Round 1 は「関係を書く」までで、「書いた帯を既定値が破っている」は新しい論点
- Round 1 Runtime W-003（`nonEmpty` を 5 変数へ揃える → fix / テストは足さない）に対し、今回の Runtime W-001 は「先例の**挙動を変えた**以上 plan.md のテスト方針は効かない」という新しい論拠を出している

## 判定一覧

| ID | Key（ファイル:シンボル/カテゴリ） | 判定 | 理由 |
| --- | --- | --- | --- |
| Port B-001 | `application/ports/scopeTaskScheduler.ts:59-63` / `scopeTaskQueue.ts:18`: `claimDue` の相互排除が未契約・"serialization rule" の指し先が消えている | fix | 参照切れは明白。相互排除の契約化も ADR-005 と矛盾しない — ADR-005 が fencing を退けたのは **settle**（`complete` / `backoff` / `schedule`）であって claim ではなく、「claim は 1 人しか勝たない」は ADR-005 の実害分析が前提として立てているもの。前提が契約に無いまま結論だけ書かれている状態で、ADR 026 §1（liveness に関わる状態遷移はポート定義に書く／スイートは単一スレッドなので拘束できない）に照らして正本はここしかない |
| Port W-001 | `application/ports/scopeTaskScheduler.ts:89,92` / `conformance:379-408`: `backoffOrSchedule` と `claimDue` の `payload` の扱いが遷移表に無い | fix | `priority` と同格の入力なのに片方だけ未規定。memory は「既存行の payload を保つ」で、これは ADR-009（`backoffOrSchedule` は分類のやり直しではない）と同じ理屈が payload にもそのまま効く。**採る側**: 現行挙動（既存行は `priority` と `payload` を保つ / `input.payload` は mint 時のみ）を契約化。**採らない側**: `input.payload` で上書きする実装へ寄せる案（呼び出し側 1 か所は毎回同じ payload を渡すので観測差が無く、変更リスクだけが増える） |
| Port W-002 + Spec W-002 | `spec/platform/index.md:186` ↔ `ports/scopeTaskScheduler.ts:44,122-132` / `docs/runtime_node.md:69`: 既定 5 分が spec の帯の上限側に反する | fix（**(b) + ポート / docs 側の補強。既定値は変えない**） | 下記「既定リース vs SLO の結論」参照 |
| Port W-003 + Adapter W-001 | `conformance/scopeTaskScheduler.ts:54-55`: `leaseMs` が非既定値で一度も呼ばれない | fix | ミューテーションで実証済み（引数を捨てて定数 5 分を使う実装で 951 passed / 0 failed）。`leaseMs` は本 Issue が新設し ADR-005 が契約の柱に据え ADR-010 が env 経路まで通した値そのもので、それが backend に効くかが実行形に無いのは ADR 026 の穴。**ヘルパの既定値は変えない**（他ケースが「1 秒進めても claim されない」＝ 5 分リースを前提にしている） |
| Adapter B-001 | `conformance/scopeTaskScheduler.ts:361-377`: `complete` が `running` 行を消すことを拘束していない | fix | ミューテーションで実証済み（`complete` を running 行への no-op にしても 882 passed / 0 failed）。落ちたときの帰結（リース失効後に同じ turn が永久再実行）は ADR 026 §1 が名指しした liveness 事故。最後の claim の前にリースを跨がせるだけで discriminating になる |
| Adapter B-002 | `conformance/scopeTaskScheduler.ts:525-559` ↔ `ports/scopeTaskQueue.ts:36-38`: リース失効後に `listDue` へ戻ることを拘束していない | fix | ミューテーションで実証済み（`listDue` の述語を pending 限定にしても適合スイートは 1 件も落ちない）。`listDue` は「どの scope に仕事があるか」を知る唯一の経路で、落ちれば停止した writer の scope が誰にも再発見されない（参照ランタイムに復旧 cron は無い — ADR-005） |
| Adapter W-002 | `conformance/scopeTaskScheduler.ts:481-497` ↔ `ports/scopeTaskScheduler.ts:91`: `failed` 行への `backoff` が `failed` のままであることを拘束していない | fix | この遷移表の一句は Round 1（Adapter W-007）で足したもので、ADR 026「契約的な振る舞いを足すならポート JSDoc とスイートの両方を触る」を片面で終えている。本番到達可能（usecase が stall → 既存 `failed` 行へ `backoffOrSchedule`）で、pending へ戻す実装は poison 行を永久 retry させる |
| Adapter W-003 | `conformance/scopeTaskScheduler.ts:146-168`: テスト名が謳う予約枠を原理的に検証していない | fix（**改名のみ**） | 実証済み（予約パスを丸ごと削っても緑）。assert 自体は正しい性質を見ているので**ケースは増やさない** — 予約枠の下限保証は `:120` が担っている。名前だけを実際に見ている性質へ寄せる |
| Runtime W-001 | `application/di/serverNode.ts:118-144`: 「空文字 = 未設定」への挙動変更が既存 4 変数に及びテストが無い | fix（**挙動は維持しテストを足す**） | 下記「Runtime W-001 の結論」参照 |
| Runtime W-002 | `application/di/serverNode.ts:118-125` の JSDoc / `apps/web/app/server.node.ts:137-138` の `PORT` / `HOSTNAME` | fix（**JSDoc の 1 句限定のみ**） | 下記「Runtime W-002 の結論」参照。`PORT` / `HOSTNAME` の読みを揃える提案は**採らない**（本 PR が持ち込んだ問題ではない既存の非対称で、AC-17 にも plan.md のスコープにも無い） |
| Runtime W-003 | `docs/runtime_node.md:90-104,122-129`: 未処理 kind の再来周期 1 秒 → 5 分が運用ドキュメントに反映されていない | fix | ADR-004 が「可視性の根拠がログ頻度から最古 task age へ移る」と決めた帰結で、`scopeTaskRunner.ts` の JSDoc は書き直されたのに運用者が読む正本だけ取り残されている。Round 1 の Runtime W-001 + Spec W-006（env 表への 1 行）と同じ「配備側が読む正本の追随」。1 文 |
| Spec W-001 | `spec/platform/index.md:186`「yield 時に未処理の claim を残さない」↔ AC-11 | fix（**spec の文言を直す。実装は変えない**） | 下記「Spec W-001 の結論」参照 |
| Spec W-003 | `spec/database/index.md:972` / `spec/platform/index.md:177,184`: Alarm 起床式が 2 ファイル 3 か所に平文で並ぶ | fix（**`spec/database:972` のみポインタ化**） | 過度な正規化にはしない。**採る側**: 「規則の正本は platform」と自ら断っている `spec/database:972` の式の再掲をポインタへ落とす（同一文の中で正本を譲りながら式を持つのが冗長そのもの）。**採らない側**: `spec/platform:177` と `:184` を 1 か所へ寄せる案 — ADR-008 が「`setAlarm()` 文から入る経路と Alarm handler 規則 4 から入る経路の両方がある」を根拠に意図的に 2 か所を揃えた。ここは正本側であって重複ではない |
| Spec W-004 | `spec/database/index.md:976`: dequeue 用索引だけ述語なし | fix | 本 PR が Round 1（Spec W-003）で Alarm 時刻用に `WHERE status = 'pending'` を足した帰結として生じた非対称で、同じ 1 行の中に残っている。候補述語が 2 分岐になった以上、pending 側を部分索引にして running 失効分を `scheduled_tasks_lease_idx` から併合するのが :976 の末尾がすでに述べている形と一致し、`jobs_lease_idx` の語彙とも揃う。`failed` 行に回収規定が無い（本 spec にも `last_error` 同様の運用規定が無い）以上、述語なしの索引には決して dequeue されない行が積み上がる |

**defer は 0 件。** 全指摘が本 PR の担当ファイル内で完結する。D1 / Durable Object 実装（Issue #11）へ踏み込む修正は 1 件も無い。

---

## 慎重に判定した 5 件の結論

### 既定リース vs SLO（Port W-002 + Spec W-002）

**結論: (b) を主、(a) は採らない。既定値 5 分は据え置き、spec の帯の書き方とポート / docs の説明を直す。**

事実確認:

- `spec/platform/index.md:186` の帯は「最悪ケースの turn 所要時間（下限）」と「priority 0 の age SLO = 1 分（上限）」の**両方を見て選ぶ**。上限側の根拠は「これを上回るとクラッシュ 1 回の回収が SLO 違反を含む」— つまり **writer がクラッシュしても行が状態として生き残り、リース失効で回収される**配備を前提にした規則である
- 参照ランタイムではこの前提が成り立たない。状態はプロセスヒープにあり（ADR 025 / `docs/runtime_node.md` の Persistence model）、writer のクラッシュ＝ストア全消失なので、**リース失効による回収経路そのものが存在しない**。加えて SLO 監視も global recovery cron も実装されていない（ADR-005 が自ら書いているとおり）。上限側の規則は参照ランタイムでは構造的に無効
- 既定 5 分は ADR-005 が「outbox の `DEFAULT_LEASE_MS` と対称」として明示的に決着させた値であり、それを覆すべき新事実は出ていない。下限側（1 バッチ最大 100 行・in-memory の turn はミリ秒オーダー）は 5 分で桁違いに満たされている
- したがって矛盾の所在は既定値ではなく、**帯が全配備に無条件で掛かるように読める spec の書き方**と、**下限しか書いていないポート JSDoc / `docs/runtime_node.md`** の側にある

採る修正（3 ファイル。計画 A / C / D に分かれるが、下の 3 点は同じ結論の 3 面なので文言を揃えること）:

1. `spec/platform/index.md:186` — 上限側を条件つきにする。「age SLO を持ち、かつクラッシュした writer の行が状態として生き残る配備では、リース期間が age SLO を上回るとクラッシュ 1 回の回収がそれだけで SLO 違反を含む」旨へ。下限側はそのまま
2. `ports/scopeTaskScheduler.ts` の `leaseMs` 段落（`:122-132`）— 上限側を 1 文足す。「長くするほどクラッシュした writer の行が戻るまでの遅延が伸び、age SLO を持つ配備ではその遅延が SLO に乗る」
3. `ports/scopeTaskScheduler.ts:43-44` の `SCOPE_TASK_LEASE_MS` の JSDoc — 「matching the outbox relay's own default」だけで終えず、**なぜ参照ランタイムにとってその値でよいか**を 1 句足す（状態がプロセスと運命を共にするので上限側が効かず、SLO 監視も自動復旧も無い。SLO を持つ配備は `spec/platform` の帯で選び直す）
4. `docs/runtime_node.md:69` の env 表 — 現在は下限側だけ。上限側を 1 句添える

採らない: 既定値を下げる（ADR-005 の決着を覆す新事実が無い。参照ランタイムでは上限側が無効で、下げても得るものが無い）。`.env.example:78-81` の追記（3 行のコメントに既に下限側が書かれており、配備側向けの正本は `docs/runtime_node.md` の表。ここを膨らませない）。

### Spec W-001

**結論: spec の文言を直す。実装は変えない。**

`scopeTaskRunner.ts:147-188` を実際に読んだ。runner は `claimDue({ limit: budget })` の直後に同じ `budget` を 1 件ずつ減らしながら claimed を回るので、**claim した行はすべてその round で訪問される**（`:158-160` の WHY コメントがこの不変条件を述べている）。ただしハンドラ未登録 kind の行は訪問されても settle されず、リース満了まで `running` に残る（`:169-175`）。これは ADR-004 / AC-11 が意図した契約で、`scopeTaskHandlers` の JSDoc（`:83-90`）にも明記されている。

つまり Round 1 で足した「yield 時に未処理の claim を残さない」は、「未処理 = 未訪問」なら実装と一致し、「未処理 = 未 settle」なら AC-11 と正面から食い違う。字義は後者に読めるので、**spec 側を「訪問」まで絞る**のが正しい。#11 に「未登録 kind の行は claim してはいけない／必ず release せよ」という、ポートに操作すら存在しない義務を読ませてはならない。

修正: `spec/platform/index.md:186` の当該句を「1 turn が claim するのはその turn の budget 内で必ず**訪問**する件数までとし、budget を超えて claim しない。ハンドラを持たない kind の行だけは settle されずリース満了まで待つ」へ。あわせて CPU 予算で切り上げる turn は小分けに claim する旨を 1 句添える（100 行を一度に claim する実装では claim 時点で訪問件数を知りようがない、という Round 2 の指摘に対応）。

### Port B-001

**結論: 両方 fix。ADR-005 とは矛盾しない。**

ADR-005 が fencing を退けたのは **settle 側**（`complete` / `backoff` / `schedule` が `(kind, operationId)` だけで撃たれること）であり、claim の相互排除はその議論の**前提**として置かれている（「リース超過した A が、B が武装し直した行を settle する」という実害の記述自体が「claim は 1 人しか勝たない」を仮定している）。前提を契約に書くことは結論を覆さない。ADR 026 §1（liveness に関わる状態遷移はポート定義に書く／適合スイートは単一スレッドなのでここを拘束できない）に照らして、JSDoc が唯一の正本になる。

修正 2 点:

1. `ports/scopeTaskScheduler.ts` の claim 段落に排他要求を 1〜2 文。「候補の選択と `running` への遷移は行単位で原子的でなければならない — 同時に走る 2 つの `claimDue` が同じ行を返してはならない。参照ランタイムは scope の unit of work がこれを与える。対話型トランザクションを持たないバックエンドは条件付き更新（`WHERE status='pending' AND due_at <= ?` / `WHERE status='running' AND lease_expires_at <= ?`）で同じ保証を作る」。settle が fencing を持たないこと（既存の "The lease is advisory" 段落）と衝突しない書き方にすること — 「claim は排他、settle は助言的」が両立して初めて ADR-005 の実害分析が読める
2. `ports/scopeTaskQueue.ts:18` の「the serialization rule (claim inside the scope transaction) is **unchanged**」— `unchanged` は #2 時点の文への参照で指し先が消えている。1 で書く排他規定への参照に書き換える

### 適合スイートの穴（Adapter B-001 / B-002 / W-002、Port W-003 + Adapter W-001）

**結論: 4 件とも fix。**いずれもミューテーションで「壊しても緑」が実証されており、ADR 026「スイートは契約の実行形」の穴として争う余地が無い。

`leaseMs` を非既定値で呼ぶケース（Port W-003 + Adapter W-001）について、他ケースの前提を壊さないかを確認した:

- ヘルパの既定値 `claim = (limit, leaseMs = SCOPE_TASK_LEASE_MS)` は**変えない**。`:361`（complete / backoff）や `:525`（scope 横断）など複数のケースが「1 秒進めても claim 済みの行は戻らない」＝ 5 分リースを前提にしており、既定を短くすると連鎖的に壊れる
- 非既定値を渡すのはリース系 2 ケース（`:236` / `:249`）の呼び出し**引数**だけにする。`beforeEach` でバックエンドが作り直されるのでケース間の干渉は無い
- `:236` は既に `advance(LEASE_MS - 1)` の構造を持つので、ここを非既定値（例 `2 * MINUTE_MS`）に変え、(a) `leaseExpiresAt` がその値で返る、(b) `advance(leaseMs - 1)` では claim されず `advance(1)` で戻る、を assert するのが最小。`:249` の reclaim ケースは既定のままでよい（Round 1 で attempt / priority / 新リースの assert を入れたばかりで、二重に触ると意図が読みにくくなる）

### Runtime W-001

**結論: `nonEmpty` の挙動は維持し、既存テストファイルに 2 ケース足す。変更を `SCOPE_TASK_LEASE_MS` だけに絞り戻す案は採らない。**

- 絞り戻すと `nodeServerEnvToTuningEnv` の中に同型の式が `!== undefined` 4 本と `nonEmpty` 1 本で並ぶことになる。Round 1 が 5 本揃えたのはまさにこれを避けるためで、片面へ戻すのは読みやすさの後退
- 一方で Round 2 の論拠は正しい。plan.md の「`OUTBOX_LEASE_MS` の先例が専用テストを持たないので新テストを足さない」は**先例の挙動を変えない**場合の理屈で、本 PR は先例を書き換えた。境界検証を緩める方向の変更（`Validate at the boundaries` の緩和）が JSDoc のコメントにしか存在しない状態は残せない
- `packages/core/src/application/di/__tests__/serverNode.test.ts` に `BASE` / `GOOGLE` のフィクスチャが既にあるので、新規ファイル不要で 2 ケース足せる: `OUTBOX_LEASE_MS: ""` / `SCOPE_TASK_LEASE_MS: ""` を含む env が `{}` を返すこと、値を入れたときは素通しであること（後者は AC-17 の 1 本道の一部も同時に拘束する）

### Runtime W-002

**結論: `PORT` / `HOSTNAME` は wont-fix（触らない）。JSDoc の一般化だけ 1 句限定する。**

- `PORT` / `HOSTNAME` の読みは本 PR が持ち込んだものではない既存の非対称で、`apps/web/app/server.node.ts` は AC-17 の配線（`scopeTaskLeaseMs` の受け渡し）以外に本 Issue の持ち分を持たない。plan.md のスコープを越える
- ただし Runtime W-002 が挙げたもう一方の選択肢 — 追加された JSDoc（`serverNode.ts:118-125`）が「空値 = 未設定」を repo 全体の読みとして宣言しているように読める点 — は、本 PR が触ったファイルの本 PR が足した文なので閉じられる。「この tuning 射影の 5 変数について」と射程を明示する 1 句限定にとどめる
- defer にはしない。`PORT` / `HOSTNAME` を揃えるべきかは本 Issue とは独立の判断で、必要なら別 Issue の持ち分

---

## 実行計画

4 計画。担当ファイルは互いに素で、並列実行できる。

Port W-001（ポート JSDoc + 適合スイート）と Port W-002 + Spec W-002（ポート JSDoc + spec + docs）は複数の計画にまたがる。**上の「慎重に判定した 5 件の結論」に書いた結論が正本**で、各計画はそこから自分のファイル分だけを実装すること。

### 計画A: ポート JSDoc の契約を閉じる

- 担当する指摘ID: Port B-001 / Port W-001（JSDoc 側） / Port W-002 + Spec W-002（ポート側）
- 対象ファイル:
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`
  - `packages/core/src/application/ports/scopeTaskQueue.ts`
- 方針:
  1. **claim の相互排除**（Port B-001）— claim 段落（`:59-63`）に「候補の選択と `running` への遷移は行単位で原子的／同時に走る 2 つの `claimDue` が同じ行を返さない」を 1〜2 文。参照ランタイムは scope の UoW がそれを与えること、対話型トランザクションを持たないバックエンドは条件付き更新で同じ保証を作ることを添える。既存の "The lease is advisory"（`:122-125`）と**衝突しない**書き方にすること — claim は排他 / settle は助言的、という対比が読めて初めて ADR-005 の実害分析が成立する
  2. **`scopeTaskQueue.ts:18` の参照切れ**（Port B-001）— 「the serialization rule … is unchanged」の `unchanged` は #2 時点の文への参照で、指し先は既に消えている。1 で書いた `ScopeTaskScheduler` の排他規定への参照へ書き換える
  3. **`payload` の遷移**（Port W-001）— 遷移表の `backoffOrSchedule` セル（`:92`）に「既存行は `priority` と `payload` を保ち、`input.payload` は mint 時のみ使う」を、`claimDue` セル（`:89`）の "unchanged" 列挙に `payload` を足す。**現行の memory 挙動を契約化する**（`input.payload` 上書きへ寄せる案は採らない）
  4. **`leaseMs` の上限側**（Port W-002 + Spec W-002）— `:122-132` の `leaseMs` 段落に上限側を 1 文（長くするほどクラッシュした writer の行が戻るまでの遅延が伸び、age SLO を持つ配備ではその遅延が SLO に乗る）。あわせて `:43-44` の `SCOPE_TASK_LEASE_MS` の JSDoc を「outbox relay の既定に合わせた」だけで終えず、**参照ランタイムでその値が妥当な理由**（状態がプロセスと運命を共にするので上限側が構造的に効かない・SLO 監視も自動復旧も無い）と「SLO を持つ配備は `spec/platform` の帯で選び直す」を 1 句ずつ足す。**既定値 5 分そのものは変えない**

### 計画B: 適合スイートを契約の実行形にする

- 担当する指摘ID: Adapter B-001 / Adapter B-002 / Adapter W-002 / Adapter W-003 / Port W-003 + Adapter W-001 / Port W-001（assert 側）
- 対象ファイル:
  - `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`
- 方針:
  1. **`complete` が running 行を消す**（Adapter B-001）— `:361-377` の最後の claim の前にリースを跨がせる（`backend.clock.advance(SCOPE_TASK_LEASE_MS)`）。跨いでも `op-backoff` の `dueAt`（= claim 時刻 + 1 秒）は過去・`attempt: 1`・リースは `backoff` が解放済みなので既存 assert はそのまま活き、`op-complete` が「消えた」のか「まだ running だった」のかが初めて区別できる
  2. **リース失効で `listDue` に戻る**（Adapter B-002）— `:525-559` の末尾（scope 1 の全行が claim 済みの状態がある）に `advance(SCOPE_TASK_LEASE_MS)` を足し、`listDue(now, 10)` に scope 1 の行が再び載ることを assert する。選択規則が効くので返却順は `(priority, dueAt, kind, operationId)` 昇順で決まる — 件数だけでなく載ることまで見ること
  3. **`leaseMs` を非既定値で呼ぶ**（Port W-003 + Adapter W-001）— **ヘルパ `claim` の既定値は変えない**（`:361` / `:525` など複数のケースが 5 分リースを前提にしている）。`:236` の呼び出し引数だけを非既定値（例 `2 * MINUTE_MS`）にし、(a) `leaseExpiresAt` がその値で返る、(b) `advance(leaseMs - 1)` では claim されず `advance(1)` で戻る、を assert する。ケースは増やさない。`:249` の reclaim ケースは既定のまま（Round 1 で入れた attempt / priority / 新リースの assert の意図を薄めない）
  4. **`failed` 行への `backoff`**（Adapter W-002）— `:493` の直後に `backoff` をもう 1 回（または `backoffOrSchedule` を 1 回）撃ち、時計をどれだけ進めても claim されないことを assert する。既存の「`schedule` が蘇生する」assert（`:495-496`）はその後に残すこと
  5. **予約枠テストの改名**（Adapter W-003）— `:146` の名前を実際に見ている性質へ（例 `puts a high priority ahead of an older low-priority backlog`）。**ケースは増やさない** — 予約枠の下限保証は `:120` が担っている
  6. **`payload` の保存**（Port W-001 の assert 側）— `:379-408`「keeps the priority of an existing row …」の `backoffOrSchedule` に既存行と別の payload を渡し、claim が返す payload が変わらないことを assert 1 行で足す。ケースは増やさない

### 計画C: env 配線のテストと運用ドキュメント

- 担当する指摘ID: Runtime W-001 / Runtime W-002 / Runtime W-003 / Port W-002 + Spec W-002（docs 側）
- 対象ファイル:
  - `packages/core/src/application/di/__tests__/serverNode.test.ts`
  - `packages/core/src/application/di/serverNode.ts`
  - `docs/runtime_node.md`
- 方針:
  1. **`nonEmpty` の実行形**（Runtime W-001）— 既存の `di/__tests__/serverNode.test.ts` に 2 ケース足す（新規ファイル不要。`BASE` / `GOOGLE` フィクスチャが既にある）。`nodeServerEnvToTuningEnv(readNodeServerEnv({ ...BASE, ...GOOGLE, OUTBOX_LEASE_MS: "", SCOPE_TASK_LEASE_MS: "" }))` が `{}` であること、値を入れたときは素通しであること。**挙動は変えない**（`SCOPE_TASK_LEASE_MS` だけ `!== undefined` に戻す案は採らない — 同型の式が 5 本並ぶ関数で 1 本だけ規律が違う状態に戻る）
  2. **JSDoc の射程限定**（Runtime W-002）— `serverNode.ts:118-125` の「空値 = 未設定」の宣言を「この tuning 射影の 5 変数について」と明示する 1 句限定。**`apps/web/app/server.node.ts` の `PORT` / `HOSTNAME` は触らない**（本 PR が持ち込んだ問題ではない既存の非対称で、plan.md のスコープ外）
  3. **未処理 kind の可視性**（Runtime W-003）— `docs/runtime_node.md` の Worker runner 節（`:90-104`）の Scope tasks 行か直後の段落に 1 文。「claim はリースを取るので、settle されなかった行（ハンドラ未登録を含む）は `SCOPE_TASK_LEASE_MS` が経つまで tick に現れない。停滞はログの頻度ではなく `dueAt` からの経過（最古 task age）で測る」。Logging and observability 節（`:122-129`）の Notable lines に `[scope-tasks] no handler for …` を 1 行足すかは任意 — 足すなら「リース周期で立つ」ことまで書くこと
  4. **env 表の上限側**（Port W-002 + Spec W-002 の docs 分）— `docs/runtime_node.md:69` の `SCOPE_TASK_LEASE_MS` 行は現在下限側だけ。上限側（長くするほどクラッシュした writer の行が戻るまでの遅延が伸びる）を 1 句添える。計画 A の 4 と同じ結論を短く言い直すこと
  5. `apps/web/.env.example` は**触らない**（3 行のコメントに下限側が既にあり、配備側向けの正本は上記の表）

### 計画D: spec を実装と揃える

- 担当する指摘ID: Spec W-001 / Spec W-003 / Spec W-004 / Port W-002 + Spec W-002（spec 側）
- 対象ファイル:
  - `spec/platform/index.md`
  - `spec/database/index.md`
- 方針:
  1. **1 turn の claim 規則**（Spec W-001）— `:186` の「1 turnがclaimするのはそのturnでsettleしきる件数までとし、yield時に未処理のclaimを残さない」を、実装と一致する「訪問」の水準へ絞る。例:「1 turn が claim するのはその turn の budget 内で必ず訪問する件数までとし、budget を超えて claim しない。ハンドラを持たない kind の行だけは settle されずリース満了まで待つ」。CPU 予算で切り上げる turn は小分けに claim する旨を 1 句添える。**コードは変えない**（`scopeTaskRunner.ts:147-188` は budget 会計で「claim した行はすべて訪問される」を既に保っており、未 settle で残るのは AC-11 / ADR-004 が意図した未登録 kind だけ）
  2. **リース期間の帯**（Port W-002 + Spec W-002 の spec 分）— 同じ `:186` の帯の上限側を条件つきにする。「age SLO を持ち、かつクラッシュした writer の行が状態として生き残る配備では、リース期間が age SLO を上回るとクラッシュ 1 回の回収がそれだけで SLO 違反を含む」旨へ。下限側（最悪ケースの turn 所要時間）はそのまま。**参照ランタイムの既定 5 分は spec 側の条件で説明がつくので、既定値は変えない**（計画 A の 4 と対で読めること）
  3. **Alarm 起床式のポインタ化**（Spec W-003）— `spec/database/index.md:972` 末尾の「Alarm起床時刻は pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方になる（規則の正本は platform …）」を、式の再掲をやめてポインタへ落とす（例:「Alarm 起床時刻の導出は [platform](../platform/index.md) の Scope Alarm 節を正本とし、本表の `due_at` / `lease_expires_at` がその材料になる」）。**`spec/platform:177` と `:184` は触らない** — ADR-008 が 2 つの入口の両方を揃えた正本側であり、寄せるのは過度な正規化
  4. **dequeue 索引の述語**（Spec W-004）— `:976` の dequeue 用 (`priority`, `due_at`, `kind`, `operation_id`) に `WHERE status = 'pending'` を足す。`running` の失効分は同行末尾が既に述べているとおり `scheduled_tasks_lease_idx` から取って併合する形になるので、その併合が claim 側にも掛かることが読めるよう末尾の説明を 1 句広げること。3 本の索引がすべて部分索引で揃い、`jobs_lease_idx` の語彙とも一致する
