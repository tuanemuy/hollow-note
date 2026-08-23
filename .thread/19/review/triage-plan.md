# Round 1 修正方針

統合後 20 件 — fix 18 / wont-fix 2 / defer 0。

統合したもの（以降 1 件として扱う）:

- **Port W-001 + Adapter W-002** — どちらも「リース失効境界（`leaseExpiresAt <= now`）がポート JSDoc から読めない」
- **Port W-003 + Spec W-002** — どちらも `spec/platform/index.md:177` の `scheduled_tasks(...)` 行タプルに `lease_expires_at` / `status` が無い
- **Runtime W-001 + Spec W-006** — どちらも `docs/runtime_node.md` の環境変数表に `SCOPE_TASK_LEASE_MS` の行が無い

## 判定一覧

| ID | Key（ファイル:シンボル/カテゴリ） | 判定 | 理由 |
| --- | --- | --- | --- |
| Port B-001 | `adapters/conformance/scopeTaskScheduler.ts`: `running` 行への `backoffOrSchedule` が未拘束 | wont-fix | 事実誤認。`:400-426`「backs off a row that does not exist yet by minting it」の後半が、**claim 済み（`running`）の行**へ `backoffOrSchedule` を撃ち、`advance(2 * BACKOFF_BASE)` だけで `attempt: 2` の行が claim できることを要求している。リースを張ったままの実装では行は候補に戻らず（既定リース 5 分 > 2 秒）`(await claim(10))[0]?.attempt` が `undefined` になって落ちる。つまり「lease released + `state = pending`」の両方が既に実行形で拘束されている（Adapter レビュアーも独立に同じ結論に到達している）。AC-9 / AC-12 は未達ではない |
| Port W-001 + Adapter W-002 | `application/ports/scopeTaskScheduler.ts:60-67`: リース失効境界 | fix | 同一 JSDoc 内で pending 側だけ `dueAt <= now` と閉区間を明示し、running 側は "lapsed" 止まり。スイート（`:245-246,255`）と `spec/database:972` は包含境界を要求しており、正本 3 つのうちポートだけが緩い。ADR 026 §1 の「スイートだけが規定している振る舞い」に当たる。1 語の修正 |
| Port W-002 | `adapters/conformance/scopeTaskScheduler.ts:249-268`: reclaim の attempt / priority assert に teeth が無い | fix | 対象行が `schedule` 直後の新品（`attempt = 0` / 既定 priority）なので、reclaim 時にリセットする実装でも緑になる。ADR-004（失効 reclaim は attempt を焼かない）が実行形で拘束されていない |
| Port W-003 + Spec W-002 | `spec/platform/index.md:177`: 行タプルに `lease_expires_at` / `status` が無い | fix | 同一文が「この表はこの 5 列を持つ」と述べた直後に 6 列目（と `status` 判定）から起床時刻を導いている。ADR-008 が platform も直した動機（「片方だけ読む経路が現実にある」）と同じ齟齬が 1 文の中に残る |
| Adapter W-001 | `adapters/conformance/scopeTaskScheduler.ts:249-268`: reclaim が新しいリースを取ることが未拘束 | fix | 「失効行を返すがリースを張り直さない」バックエンドが緑で通り、次 tick（既定 1 秒）で同じ行が二重配布される。リースが存在する理由そのものが実行形から抜けている。2 行の追加で足りる |
| Adapter W-003 | `adapters/conformance/scopeTaskScheduler.ts`: `(kind, operationId)` タイブレークのケース不在 | fix | 実ファイルを確認: priority 系ケースはすべて `dueAt` をずらしてあり、同 `(priority, dueAt)` で順序を決める局面が 1 件も無い。ADR-001 が返却**順**と返却**集合**まで凍結した判断が実行形で担保されていない |
| Adapter W-004 | `adapters/memory/__tests__/unitOfWork.test.ts:96-106`: claim の kick 非発火が空表由来 | fix | 空の `scheduledTasks` に `claimDue` するので `kicks === 0` は claim の性質ではない。本 PR は `claimDue` を読み取りから書き込みへ変えた変更であり、追随すべき箇所そのもの。ロールバックケース追加も同 UoW の実行形になる |
| Adapter W-005 | `application/ports/scopeTaskQueue.ts:26-32`: scope 横断で順序キーが全順序でない | fix（JSDoc のみ） | 別 scope が同じ `(kind, operationId)` を持てば 4 つ組が同値になり、memory は Map 挿入順、D1 は行順にフォールバックする。契約文が「一意に定まる」と読めるのは誤り。**採る側**: 「同値のときどの scope が載るかは未規定」と明示する。**採らない側**: 比較子へ scope キーを足す案（`selectDueScopeTasks` の構造的中立性を崩し、実害ゼロの局面のためにバックエンド間順序を新たに凍結する。必要になれば #11 が契約変更として扱えばよい） |
| Adapter W-006 | `adapters/conformance/scopeTaskScheduler.ts:236-247,472-496`: AC-6(b) が単一 scope でしか実行されていない | fix | scope 横断の `listDue` が「claim 済みの scope を候補から落とす」ことが未拘束。runner が毎 tick 通る形（scope A 全リース中 / scope B に低 priority 1 件）が実行形に無い。既存ケースへ 1〜2 行 |
| Adapter W-007 | `application/ports/scopeTaskScheduler.ts:85-91`: 遷移表に `failed` 始点が無い | fix（JSDoc のみ） | 実装は `failed` 行にも `backoff` / `backoffOrSchedule` を適用して `attempt` を上限超えで増やし続ける。AC-9 が「5 操作すべてについて明記」を要求する表に始点の穴が残る。**採る側**: 表に `/ failed`（結果は `failed` のまま）を書き足して現行実装を規定する。**採らない側**: 実装を no-op へ変える案（`failed` 行は claim されず `attempt` は観測不能なので振る舞いの差が無く、コード変更の риск だけが増える） |
| Adapter W-008 | `adapters/memory/repositories/scopeTaskScheduler.ts:79-93`: `Date` を素通し | wont-fix | 呼び出し側を確認: `ScopeTask.dueAt` / `leaseExpiresAt` を読む本番経路は無く（handler は kind / operationId / payload / scope のみ）、適合スイートも比較しかしない。加えて memory アダプターは表全体で「`payload` は `clone`、`Date` は素通し」の一貫した先例（`repositories/outboxRepository.ts:19` ほか、`new Date(row.*)` は 1 件も無い）で書かれており、この 1 か所だけ規律を変えると不整合が増える。理論上の懸念に留まる過度に防御的な提案 |
| Runtime W-001 + Spec W-006 | `docs/runtime_node.md:58-71`: `SCOPE_TASK_LEASE_MS` の行が無い | fix（表への 1 行追加のみ） | ADR-010 が「配備側が選べること」を契約の柱に据えた変数が、配備側向け正本に 1 行も無い。`OUTBOX_LEASE_MS` は `.env.example` と両方に載っている先例がある。**採らない側**: ポート JSDoc から env 変数名を追い出す提案（当該文は "That runtime chooses …" と参照ランタイム限定で書かれており、ADR 025 のとおり実行時配線は 1 本しか無い。契約の漏れではなくポインタなので残す） |
| Runtime W-002 | `application/di/env.ts:21,34`: zod の issue path が両方 `leaseMs` | fix | `OUTBOX_LEASE_MS` と `SCOPE_TASK_LEASE_MS` の拒否メッセージが boot ログ上で区別できない（`listen.node.ts` は cause をそのまま出す）。変数が 2 つになった時点で生じた劣化で、メッセージに変数名を入れる 1 行で解消する |
| Runtime W-003 | `application/di/serverNode.ts:133-135`: 空文字が「不正値」として boot を落とす | fix | 既存の慣行を実際に確認: `DELETION_TICKET_KEY` は schema 側が `value === ""` を明示的に許し（`:77`）、射影側は `nonEmpty()` で未設定として扱う（`:183`）。`docs/runtime_node.md:81` も「empty values are ordinary in container manifests」とリポジトリ自身が認めている。`nonEmpty` は同ファイルに既にある述語で、`nodeServerEnvToTuningEnv` の 5 変数を揃えるだけの機械的な修正。`OUTBOX_*` の 4 変数も同じ式なので同時に揃える（1 つだけ直すと穴が 4 か所残り、かえって読めなくなる） |
| Spec B-001 | `spec/database/index.md:35`: Alarm 導出が `due_at` 索引だけのまま | fix | :972 と `spec/platform:177,184` が「pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方」へ揃った一方、同ファイルの要約段落が取り残されている。#11 が `scheduled_tasks` を最初に知る位置であり、ADR-008 が名指しした実害（`due_at` だけで Alarm を張り、失効した `running` 行を誰も起こさない）が spec の内部で再現している。AC-14(b) の「全出現」に対する未達 |
| Spec B-002 | `spec/platform/index.md:184,186`: yield 残件がリース期間ぶん停止する帰結が spec に無い | fix（spec 追記のみ・コード変更なし） | **設計上の実害ではないことを確認した**。`workers/scopeTaskRunner.ts:147-167` は `claimDue({ limit: budget })` の直後に同じ `budget` を 1 件ずつ減らして回すので `claimed.length <= budget` が算術的に保たれ、CPU 時間による yield も存在しない。参照ランタイムで「claim したまま未処理」は起き得ず、削除処理が 5 分止まることはない。ただしこの不変条件は `:158-160` の WHY コメントにしか無く、**#11 が実装する DO の turn（100 行 / CPU 2 秒で yield）では実際に起こりうる**。spec に 1 句足して #11 へ渡すのが正しい扱い |
| Spec W-001 | `spec/database/index.md:972`: 「`due_at` は状態によらず」が `failed` を含む | fix | 文の目的は「claim が `due_at` を押し出さない」宣言なのに射程が `failed` まで及び、参照実装（`failed` から `dueAt` を落とした判別共用体）と意味論が逆になる。`pending` / `running` へ限定しても他の記述は壊れない |
| Spec W-003 | `spec/database/index.md:976`: Alarm 時刻用索引が `status` を持たない | fix | 本 PR が起床規則を「**pending の**最小 `due_at`」へ変えた帰結として生じた非対称。`failed` 行は `schedule` で蘇生されるまで残り `due_at` は過去なので索引の先頭に溜まり続ける。リース側に部分索引を新設した以上、pending 側も `WHERE status = 'pending'` へ揃えるのが `jobs_*_idx` の体裁と一致する（spec 1 行） |
| Spec W-004 | `spec/database/index.md:976`: 索引の命名（用途名と物理名の混在） | fix | 既存記法を確認: `jobs`(`:668-676`) と `public_note_search`(`:947-950`) は物理名、`workspaces`(`:76`) と `job_history`(`:922`) と `scheduled_tasks` の既存 2 本は用途名で、**表ごとにどちらもある**。ただし `:976` は 1 行の中で用途名 2 本 + 物理名 1 本が混在しており、そこは実際に不整合。**採る側**: 新設分に用途名を添えて「リース失効走査用 `scheduled_tasks_lease_idx` (`lease_expires_at`) WHERE …」とする。**採らない側**: 物理名を落とす提案（ADR-008 が `jobs_lease_idx` との同型性を根拠に名前を選んでおり、対応が読めなくなる） |
| Spec W-005 | `spec/platform/index.md:186` / `spec/database:972`: 既定リース 5 分と priority 0 の age 1 分 SLO の関係が無い | fix | ポート JSDoc は `leaseMs` の**下限**（最悪ケースの turn）しか規定せず、上限（SLO）を誰も引き受けていない。既定 5 分は SLO の 5 倍で、1 回のクラッシュ回収が構造的に SLO 違反を含む。#11 が `leaseMs` を選ぶとき両側を見られるように 1 文残す（spec のみ。既定値そのものは ADR-005 / ADR-010 の決着どおり変えない） |

**defer は 0 件。** 全指摘が本 PR の担当ファイル内で完結し、D1 / Durable Object 実装（Issue #11）へ踏み込むものは 1 件も無い。

## 実行計画

4 計画。担当ファイルは互いに素で、並列実行できる。

### 計画A: ポート JSDoc の契約を閉じる

- 担当する指摘ID: Port W-001 + Adapter W-002 / Adapter W-005 / Adapter W-007
- 対象ファイル:
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`
  - `packages/core/src/application/ports/scopeTaskQueue.ts`
- 方針:
  1. **リース失効境界**（W-001+W-002）— 候補述語の文（`:65-67`）を「`pending` with `dueAt <= now` or `running` with `leaseExpiresAt <= now`」へ揃える。pending 側と同じ不等号記法にするだけで、保存表現には触れない（ADR 026 §3 に抵触しない）。`spec/database:972` と適合スイート `:245-246,255` が既に包含境界なので、正本 3 つが一致する
  2. **遷移表の `failed` 始点**（Adapter W-007）— `backoff` / `backoffOrSchedule` の from に `failed` を足し、結果が「`failed` のまま・`attempt` は増えるが claim されないので観測されない」ことを 1 語で書く。**実装は変えない**（no-op 化案は採らない — 観測可能な差が無く、変更リスクだけが増える）。「Only `schedule` brings a `failed` row back」の既存文と矛盾しない書き方にすること
  3. **scope 横断のタイブレーク**（Adapter W-005）— `scopeTaskQueue.ts:31-32` の「which scope carries the reserved row follows from `(dueAt, kind, operationId)`」を、**同値のときどの scope が載るかは未規定**と明示する形へ改める。比較子へ scope キーを足す案は採らない（`selectDueScopeTasks` がバックエンドの行の形を知らないでいられる ADR-011 の構図を崩し、実害ゼロの局面のために新しい全順序をバックエンド間へ凍結することになる）
  4. Runtime W-001 のうち「ポート JSDoc から `SCOPE_TASK_LEASE_MS` の名前を追い出す」提案は**採らない**。当該文（`:127-129`）は "That runtime chooses …" と参照ランタイム限定で書かれており、ADR 025 のとおり実行時配線は 1 本しか無い。ここは触らない

### 計画B: 適合スイート / UoW テストを契約の実行形にする

- 担当する指摘ID: Adapter W-001 / Port W-002 / Adapter W-003 / Adapter W-006 / Adapter W-004
- 対象ファイル:
  - `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`
  - `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`
- 方針:
  1. **reclaim ケースの強化**（`:249-268`。Adapter W-001 + Port W-002 は同一ケースなので必ず同時に直す）— (a) reclaim 前に 1 度 `backoff` を通して `attempt = 1` を作り、既定と異なる priority（例 `expiryCollection`）で仕込んでから、reclaim 後に `attempt` / `priority` が**動いていない**ことを assert する。(b) reclaim 後の行が**新しいリースを取る**ことを assert する（`leaseExpiresAt` が `now + SCOPE_TASK_LEASE_MS` であること、および同じ `now` での再 claim が `[]` であること）。(b) が無いと二重配布するバックエンドが緑で通る
  2. **`(kind, operationId)` タイブレーク**（Adapter W-003）— 同 priority・同 `dueAt` で `kind` 違い 2 件・`operationId` 違い 2 件を積み、`claim(10)` の返却順が `(kind, operationId)` 昇順であることを assert するケースを 1 本足す。`limit` を絞った assert も併せると返却**集合**の一意性（ADR-001）まで拘束できる
  3. **scope 横断のリース不可視**（Adapter W-006）— `:472-496`（"reserves a slot across scopes…"）を拡張し、scope 1 側を claim してから `listDue` を呼んで scope 2 の行だけが載ることを assert する
  4. **UoW の追随**（Adapter W-004）— `:96-106` を「先に `schedule` で 1 行 commit（kick 1 回）→ 別 UoW で `claimDue` を呼んで実際に 1 行 claim させ、`kicks` が 1 のままであること」へ書き換える。あわせて「claim した UoW が throw したら行が `pending` へ戻る」ロールバックケースを 1 本足す（本 PR で claim が undo ログに乗ったことの実行形）
  5. Port B-001 は **wont-fix**。`:400-426` が `running` 行への `backoffOrSchedule` を既に拘束しているので、ケースを足さない

### 計画C: env 配線の入力境界を揃える

- 担当する指摘ID: Runtime W-002 / Runtime W-003
- 対象ファイル:
  - `packages/core/src/application/di/env.ts`
  - `packages/core/src/application/di/serverNode.ts`
- 方針:
  1. **空文字＝未設定**（W-003）— `nodeServerEnvToTuningEnv`（`serverNode.ts:119-137`）の 5 つの条件を `!== undefined` から同ファイルの `nonEmpty(...)` へ変える。`SCOPE_TASK_LEASE_MS` だけでなく `OUTBOX_*` の 4 変数も同時に揃える（同じ 1 つの式が 5 回並んでいるだけで、1 つだけ直すと穴が 4 か所残る）。根拠は同ファイルの `DELETION_TICKET_KEY`（`:77` / `:183`）と `docs/runtime_node.md:81`。スキーマ側（`nodeServerEnvSchema`）は `z.string().optional()` のままでよい
  2. **拒否メッセージの識別**（W-002）— `scopeTaskTuningSchema.leaseMs` に変数名入りのメッセージを与える（`.positive("SCOPE_TASK_LEASE_MS must be a positive integer (ms)")` 相当）。`relayTuningSchema.leaseMs` にも同型のメッセージを添えて、どちらの env でも boot ログから変数名が読めるようにする。スキーマのキー名を env 変数名へ変える案は採らない（`RelayTuning` / `ScopeTaskTuning` の型名が呼び出し側に露出しており、射影を挟むぶん配線が増える）
  3. 新しいテストは足さない（plan.md「テスト方針」の AC-17 — `OUTBOX_*` の先例が専用テストを持たない方針に揃える）

### 計画D: spec / 運用ドキュメントを揃える

- 担当する指摘ID: Spec B-001 / Spec B-002 / Spec W-001 / Spec W-003 / Spec W-004 / Spec W-005 / Port W-003 + Spec W-002 / Runtime W-001 + Spec W-006
- 対象ファイル:
  - `spec/database/index.md`
  - `spec/platform/index.md`
  - `docs/runtime_node.md`
- 方針:
  1. **`spec/database/index.md:35`**（Spec B-001）— 「`due_at` 索引で次の Alarm を決める」を改める。要約段落なので列名を挙げず「次の Alarm 時刻は下記 `scheduled_tasks` の規則で決める」と下流へ委ねる形を採る（:972 が既に「規則の正本は platform の Scope Alarm 節」と委譲しているので、導出式の正本が platform 1 か所に閉じる）
  2. **`spec/database/index.md:972`**（Spec W-001）— 「`due_at` は状態によらず実行予定時刻」を「`pending` / `running` のどちらでも実行予定時刻を意味し、claim は書き換えない」へ限定する（`failed` は候補述語からも起床規則からも既に外れている）
  3. **`spec/database/index.md:976`**（Spec W-003 / W-004。同一行なので同時に直す）— Alarm 時刻用索引に `WHERE status = 'pending'` を足し（失敗行・running 行が索引の先頭に溜まり続ける非対称の解消）、新設索引に用途名を添えて「リース失効走査用 `scheduled_tasks_lease_idx` (`lease_expires_at`) WHERE `status = 'running'`」と 3 本の記法を揃える。**物理名は落とさない**（ADR-008 が `jobs_lease_idx` との同型性を根拠にしている）
  4. **`spec/platform/index.md:177`**（Port W-003 + Spec W-002）— 行タプルの列挙をやめ、「`scheduled_tasks`（列は [database](../database/index.md) を正本とする）」へ落とす（`status` / `lease_expires_at` / `last_error` を足す案よりも、略記が再び古びる経路を閉じられる）
  5. **`spec/platform/index.md:184` または `:186`**（Spec B-002）— 1 turn 規則に 1 句足す:「1 turn は claim した行をその turn で settle しきる件数だけ claim する（yield 時に未処理の claim を残さない）。残した行は `lease_expires_at` まで再開できない」。**コードは変更しない** — 参照ランタイムはこの不変条件を `claimDue({ limit: budget })` と budget の減算で既に守っており（`scopeTaskRunner.ts:147-167`、CPU 時間 yield も無い）、直すべき対象は #11 が読む spec 側だけである
  6. **`spec/platform/index.md:186` の SLO 文**（Spec W-005）— 「リース窓は priority 0 の回復遅延の下限になる」旨を 1 文足し、`leaseMs` に下限（最悪ケースの turn）と上限（SLO）の両方があることを #11 が読めるようにする。既定 5 分そのものは変えない（ADR-005 / ADR-010 の決着）
  7. **`docs/runtime_node.md:58-71`**（Runtime W-001 + Spec W-006）— `OUTBOX_LEASE_MS` の直後に 1 行足す: `| SCOPE_TASK_LEASE_MS | no | 300000 | Lease window (ms) a scope-task claim holds its whole batch for; must outlast the worst-case turn. |`
