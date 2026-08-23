# Round 3 修正方針

Round 1・2 台帳（`triage.md`）と Key が完全一致する指摘は無し（既出判定の継承なし）。統合 1 組。

## 判定一覧

| ID | Key（ファイル:シンボル/カテゴリ） | 判定 | 理由 |
| --- | --- | --- | --- |
| Port W-001 | `ports/scopeTaskScheduler.ts:85-101 / 契約文の上限` | fix | `claimDue` の返却件数上限が言い切られていない。runner の budget 会計がこの上限に依存しており、`listDue` 側とも非対称。計画A で「表が規範」への再構成と同時に閉じる |
| Port W-002 | `workers/scopeTaskRunner.ts:158-160 / コメントと実装の不一致` | fix | **実装のバグではない**（下記「Port W-002 の判定根拠」）。コメントの語（processed）が誤りで、加えて到達不能な `break` が「黙って行を捨てる」唯一の分岐として残っている。語の是正と分岐の削除で閉じる |
| Port W-003 | `ports/scopeTaskScheduler.ts:66-157 / JSDoc の重複` | fix | 3 ラウンドの積み増しが層になっている。表を規範の唯一の置き場にし、散文は表から読めない理由だけに削る（足さずに整理する） |
| Port W-004 | `ports/scopeTaskScheduler.ts:76-80 / 保存表現の漏れ` | fix | ADR-002 が「列の形はポート契約に書かない。`spec/database` と memory 実装にそれぞれ属する」と明記済み。`status` / `due_at` / `lease_expires_at` は D1 スキーマの列名でポートの語彙ではないので違反。`spec/database` への参照に置き換えるのではなく、述語をポートの語彙で書き直す |
| Adapter B-001 | `conformance/scopeTaskScheduler.ts:524-526 / schedule × failed の attempt リセット` | fix | ミューテーションで全リポジトリ 953 passed（穴が実証済み）。契約が唯一の復帰経路と定めた `schedule` が機能しなくなる帰結で、参照ランタイムでも到達する |
| Adapter B-002 | `conformance/scopeTaskScheduler.ts:499-527 / backoffOrSchedule × failed` | fix | 同上（884 passed）。poison 行が永久に retry する帰結。`SCOPE_TASK_MAX_ATTEMPTS` を置いた理由が失われる |
| Adapter W-001 | `conformance/scopeTaskScheduler.ts:471-497 / mint の input.priority` | fix | 同上（270 passed）。本 PR の主題が priority である以上、5 操作のうち 1 つで priority の入力経路に実行形が無いのは中途半端。既存ケースの mint priority を変えるだけで閉じる |
| Adapter W-002 | `conformance/scopeTaskScheduler.ts:555-605 / 1 ケース 3 焦点` | fix | Round 2 の追記で 1 ケースが 3 性質を抱えた。先頭 assert が落ちるとリース失効復帰（唯一の拘束）が実行されない。切り出しは数行 |
| Runtime W-001 | `docs/runtime_node.md:102,131 + scopeTaskRunner.ts:81-91 / 実行できない運用指示` | fix | 「最古 task age で測れ」を観測面のあるものに置き換える。ログ payload に `dueAt` を 1 語足して測れる側だけを残し、測れない範囲は docs から削る |
| Runtime W-002 / Spec W-003 | `apps/web/.env.example:78-81 + docs/runtime_node.md:69 / 既定値の根拠` | fix（**統合**） | 同一の問題を 2 観点が別 ID で挙げたもの。参照ランタイムに存在しない「別 writer による再武装」を唯一の根拠にしている。起こりえない危険ではなく、実際に起きること（未 settle 行が次に拾われるまでの遅延）を根拠にする |
| Spec W-001 | `spec/platform/index.md:186 / 因果の逆転と段落の肥大` | fix | 「ため」の接続が下限の根拠を上限の根拠にすり替えている。加えて 1 段落が 7 件の規則を抱えている。規則ごとに分節する |
| Spec W-002 | `spec/database/index.md:976 / 失効 running 行が選択順の索引を失う` | fix | Round 2 の部分索引化が持ち込んだ。契約は「候補全体の中で priority ごとの最小 1 件」まで凍結しているので、失効行を選択順に取れない索引構成のままだと #11 の返却集合がスイートと食い違う |

fix 12 / wont-fix 0 / defer 0（統合後 12 件）。

### Port W-002 の判定根拠（実装のバグか否か）

`scopeTaskRunner.ts:140-190` を読んだ結論は **コメントの問題であって実装のバグではない**。

- 内側ループ入口の budget を B とすると、契約上 `claimed.length <= limit = B`。反復 i（0 起点）では `budget = B - i` かつ `i < claimed.length <= B` なので `budget > 0` が常に成り立ち、`if (budget <= 0) break;` は到達不能。claim した行がリースを握ったまま捨てられる経路は現状存在しない。
- `handle === undefined` の `continue` は行を settle せずリース満了まで残すが、これは `scopeTaskHandlers` の JSDoc と `spec/platform:186`（「ハンドラを持たない kind の行だけは訪問しても settle せず」）が規定した意図どおりの振る舞い。したがって不一致はコメントの "processed" が spec の「訪問」とずれていることに限られる。
- ただし「守ろうとしている性質が破れる唯一の場所が無言」という指摘は妥当。**採る側**は分岐そのものの削除（`claimed` を必ず全件訪問し、不変条件を算術依存から構造依存に変える）。**採らない側**は `logger.error` の追加 — 到達不能な分岐に防御ログを足す形は CLAUDE.md の「過度に防御的な runtime チェックより型・構造で閉じる」に反する。

## 実行計画

計画は担当ファイルが重ならないように分割してある（並列実行可）。計画B と計画D は Runtime W-001 を分担するが、触るファイルは重ならない。両者の接点は「ログ payload に足すフィールド名は `dueAt`（`task.dueAt` をそのまま）」の 1 点だけで、この名前は本書で固定する。

### 計画A: ポート JSDoc を「表が規範・散文が理由」へ再構成する

- 担当する指摘ID: Port W-001, Port W-003, Port W-004
- 対象ファイル: `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`
- 方針:
  - **原則: 足さずに削る。** 現在 110 行の JSDoc は「遷移表を読んでから散文で同じ規則をもう一度読む」構成になっている。遷移表を規範の唯一の置き場とし、散文には**表から読み取れない理由だけ**を残す。ADR 026 §1 の「ポート定義だけを読んで必要な振る舞いに到達できる」は保つので、契約の事実そのものは 1 つも落とさない — 落とすのは同じ事実の 2 度目・3 度目の記述である。
  - 具体的に畳む重複（Port W-003）:
    - fencing 非採用の注意が `:80-83` と `:139-142` に 2 回。前者は "Exclusivity stops at the claim." の 1 文に縮め、fencing の説明は `leaseMs` 段落（後者）へ一本化する。
    - `backoff` の指数バックオフと `SCOPE_TASK_MAX_ATTEMPTS` での `failed` 化が表 `:111` と散文 `:121-126` に二重。散文側は表から読めない理由だけ（なぜ `failed` で止めるか / 「zero targets left」は `complete` であって `backoff` ではないこと）に削る。指数の式（`BASE × 2^(attempt-1)`、`MAX_BACKOFF_MS` で頭打ち）は表のセルに寄せるか散文に残すかを 1 か所に決め、両方には書かない。
    - claim が `dueAt` / `attempt` / `priority` / `payload` を保つことが `:68-71` / `:109`（表）/ `:115-119` の 3 か所。表のセルを正とし、`:68-71` はリースを取るという事実だけに縮め、`:115-119` は「reclaim が attempt を消費しない → 停滞行の age が伸び続ける」という表から読めない帰結だけを残す。
  - Port W-001: 選択規則の "budget" を `limit` に統一し、「`claimDue` は多くとも `limit` 件を返す」を選択規則の直前か直後に 1 文で明記する。`ScopeTaskQueue.listDue` の "never more than `limit`" と語を揃えること。この上限は文体の問題ではなく `scopeTaskRunner.ts` の budget 会計が依存する契約なので、削る対象ではなく**明記する対象**である。
  - Port W-004: `:76-80` の SQL 断片（`WHERE status = 'pending' AND due_at <= ?` / `WHERE status = 'running' AND lease_expires_at <= ?`）を削り、述語をポートの語彙で書く（例: 候補判定を繰り返す条件付き更新 — まだ `pending` で due か、まだ `running` でリースが失効しているか — により、述語が一致した書き手だけが行を取る）。**列名の提示も `spec/database` への参照リンクも足さない**: ADR-002 が「列の形はポート契約に書かない」と決着しており、参照 1 本でも application 層が特定バックエンドのスキーマを名指しする結合は残る。条件付き更新という*手法*の提示は ADR 026 §1 の趣旨に合うので残す。
  - `scopeTaskQueue.ts` は選択規則を `ScopeTaskScheduler` へ委譲しつつ本文でも再掲している。委譲文だけ残して再掲を削るか、再掲を残して委譲文を削るかを決め、`limit` の言い回しを scheduler 側と揃える。ここでも足さない。
  - 契約の意味を変えないこと。表のセル・入力境界・`leaseMs` の両側の帯（下限 = 最悪ケース turn / 上限 = age SLO を持ち行が writer より長生きする配備に掛かる）はすべて残す。既定値 5 分の妥当性は ADR-005 / ADR-010 と Round 2 で決着済みなので蒸し返さない。

### 計画B: runner のコメントと停滞の観測面を実態へ合わせる

- 担当する指摘ID: Port W-002, Runtime W-001（コード側）
- 対象ファイル: `packages/core/src/application/workers/scopeTaskRunner.ts`
- 方針:
  - Port W-002（採る側）: `:158-160` のコメントの "processed" を「訪問（visited）」の語へ直し、`spec/platform:186` の「budget 内で必ず訪問する件数までしか claim しない」と語を揃える。あわせて内側ループの `if (budget <= 0) break;`（到達不能かつ、到達したら黙って行をリースごと捨てる唯一の分岐）を**削除**し、`claimed` を必ず全件訪問する形にする。これで「claim した行は必ず訪問される」が算術依存ではなく構造として成立し、コメントは「なぜ claim を残 budget に抑えるか」（訪問せず残した行は次 tick ではなくリース満了まで戻らない）だけを述べる WHY になる。外側ループの `budget <= 0` はそのまま残す（budget が負に振れてもラウンドはそこで閉じる）。
  - Port W-002（採らない側）: 到達不能な分岐への `logger.error` 追加。防御ログを足すのではなく分岐を消す方向で閉じる。
  - Runtime W-001（コード側）: `[scope-tasks] no handler for …` の payload に `dueAt: task.dueAt` を足す（1 行）。これが参照ランタイムで停滞の age を実際に読み取れる唯一の面になる。`scopeTaskRunner.test.ts:224-227` は `entry.message` しか見ていないので回帰しない。
  - `scopeTaskHandlers` の JSDoc（`:81-91`）末尾の「What measures it is the age of the oldest task…」は、この runtime に最古 task age を出す面が無い以上そのままでは実行不能。「リース周期で立ち続ける」性質と「その行の `dueAt` がログに出る」ことに書き直し、`spec/platform` の age SLO の話（＝ task が writer より長生きする配備の話）はここでは述べない。**足すのではなく、測れない主張を削って測れる事実に置き換える。**

### 計画C: 適合スイートを遷移表のセル単位で網羅させる

- 担当する指摘ID: Adapter B-001, Adapter B-002, Adapter W-001, Adapter W-002
- 対象ファイル: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`
- 方針:
  - **個別ケースを足す前に、遷移表の全セルを機械的に照合する。** Round 2 でも同種の穴を塞いだのに新しい穴が出続けているのは、穴を 1 件ずつ見つけて塞いでいるからである。`ports/scopeTaskScheduler.ts` の遷移表（5 操作 × from = absent / pending / running（リース有効・失効）/ failed）を軸に、各セルが規定する観測可能な属性（`attempt` / `dueAt` / `priority` / `payload` / リースの解放 / claim 可能性）ごとに「拘束しているケース名」を突き合わせ、空欄をすべて洗い出してから埋める。既知の空欄は次の 3 つだが、照合はこの 3 つで打ち切らず全セルに対して行うこと:
    - `schedule` × `failed`（および × `pending` / `running`）の `attempt = 0` — 現在 `:371` の assert は元から `0` の行を見ており拘束になっていない（Adapter B-001）
    - `backoffOrSchedule` × `failed`（`failed` のまま留まること） — 経路がスイートのどこにも無い（Adapter B-002）
    - `backoffOrSchedule` の mint が `input.priority` を使うこと（Adapter W-001）
  - 埋め方は既存ケースへの assert 追加を優先し、ケースの焦点が 3 つ以上に散る場合だけ新ケースへ切り出す（Adapter W-002 と同じ判断基準を適用する）。B-001 / B-002 は `:499-527`「parks a task as failed once the attempt cap is reached」の 1 ケースに両方収まる（`failed` 行へ `backoffOrSchedule` → 1 年進めても claim されない → `schedule` で復活 → `attempt` が `0`）。W-001 は `:471-497` の mint を `ScopeTaskPriority.expiryCollection` に変えて claim 後の `priority` を読むだけで足りる（既存 assert は影響を受けない）。
  - Adapter W-002: `:590-604`（`advance(SCOPE_TASK_LEASE_MS)` 以降）を独立ケースへ切り出す。名前はそのケースが弁別する性質を言うこと（例: リースが失効した scope が再び `listDue` に載る）。切り出し後、元ケースは「scope 横断の予約枠」と「リース中は載らない」の 2 焦点に収める。
  - **追加した assert は 1 つずつミューテーションで赤になることを確認する。** memory 実装を 1 か所だけ壊して `pnpm exec vitest run packages/core/src/adapters` が赤になること、戻して緑になることを確認し、作業ツリーを clean に戻す。緑のまま通る assert は拘束になっていないので書き直す。
  - ADR 026 §3 のとおり観測可能な結果だけを assert する（生行を覗かない・保存表現を凍結しない）。
  - スコープ外: `SCOPE_TASK_MAX_BACKOFF_MS` の上限（main 時点からの既存の穴で本 PR は backoff の計算に触れていない）、D1 / DO 実装（#11）。

### 計画D: 運用ドキュメントの根拠を参照ランタイムの実態へ付け替える

- 担当する指摘ID: Runtime W-002 / Spec W-003（統合）, Runtime W-001（docs 側）
- 対象ファイル: `apps/web/.env.example`, `docs/runtime_node.md`
- 方針:
  - **原則: 起こりえない危険を根拠にしない。参照ランタイムで実際に何が起きるかだけを書き、書けない話は削って `spec/platform` へ渡す。**
  - `SCOPE_TASK_LEASE_MS` の根拠の付け替え（`docs/runtime_node.md:69` の表の行 / `.env.example:78-81`）: 現在の唯一の根拠「turn がリースを超過すると別 writer が再武装した行を settle してしまう」は、1 プロセス 1 runner・tick が `ScopeTaskTrigger` で直列化・store がプロセスと運命を共にする本 runtime では構造上発生しない。この runtime で値が実際に効くのは **「settle されなかった行（ハンドラ未登録の kind、backoff 自体が失敗した行）が次に拾われるまでの遅延」** だけなので、それを先に置く（`docs/runtime_node.md:102` が既に正しく説明している内容と一本化する）。
  - 既定 5 分と `spec/platform` の priority 0 age SLO 1 分の関係は、**運用者が読んで判断できる形で 1 か所に**書く: 参照ランタイムはクラッシュした writer の行が残らず age SLO も持たないので上限側が噛まず、既定のままでよい。値を選び直すのは task が writer より長生きする配備で、そこでの帯（下限 = 最悪ケース turn 所要、上限 = age SLO。priority 0 は 1 分）は `spec/platform` を見る。**既定値そのものは変えない** — 引き下げは Round 2 で ADR-005 / ADR-010 に照らして不採用と判定済みで、覆す新事実は出ていない。
  - 2 か所（表の行と `.env.example` のコメント）に同じ説明を並べない。`.env.example` は「この runtime で観測できる効果 + 既定のままでよいこと」を短く、詳細は `docs/runtime_node.md` の表の行を正本にする。**今より長くしないこと。**
  - Runtime W-001（docs 側）: `:102` / `:131` の「最古 task の `dueAt` age で測れ」は、この runtime に age を出す面が無いまま指示だけが残っている状態。計画B がログ payload に `dueAt` を足すので、`:131` のログ行の説明を「`dueAt` を載せるので、その kind の行がいつから期限を過ぎているかはこの行から読める」に直し、`:102` は「ログ頻度は目安にならない」ことと合わせて**ログ行から読める範囲に限定**する。ハンドラ未登録以外の停滞（turn が落ちた行）を出す面はこの runtime に無いので、それを測る話は `spec/platform` / #11 の領分として 1 句で渡し、指示としては書かない。

### 計画E: spec の 2 正本を分節し、索引を claim の候補述語に合わせる

- 担当する指摘ID: Spec W-001, Spec W-002
- 対象ファイル: `spec/platform/index.md`, `spec/database/index.md`
- 方針:
  - Spec W-001（`spec/platform/index.md:186`）: 因果の是正と分節を同時に行う。
    - 因果: 「リース期間は…回復遅延の下限でもある**ため**、下限は最悪ケースの turn 所要時間で決める」を 2 文に割る。下限の根拠は「これを下回ると turn 中に別 writer が同じ行を掴む」だけであり、「リース期間 = 落ちた writer の task の回復遅延」は**上限側**の根拠である。ポート JSDoc（`ports/scopeTaskScheduler.ts` の `leaseMs` 段落）が両側を正しく分離しているので、そちらと同じ切り分けに揃える。
    - 分節: 現在 1 段落が「turn 予算 / claim 規則 / 小分け claim / 未登録 kind の例外 / SLO / リース帯 / 飢餓回避」の 7 件を抱えている（3 ラウンドの積み増し）。**規則ごとに段落を割る**（少なくとも「turn 予算と claim 規則」「SLO」「リース帯」「飢餓回避」）。Alarm handler 規則 4 とリース帯が同じ節にあること自体は妥当なので、節の移動はしない。**内容を足さない** — 割るだけで、規則の数も数値も変えない。
  - Spec W-002（`spec/database/index.md:976`）: dequeue 用索引の述語を `status = 'pending'` から **`status <> 'failed'`** に変える（採る側 = 提案 (a)）。これで `pending` と失効 `running` が 1 本の索引に選択順（`priority`, `due_at`, `kind`, `operation_id`）で並び、契約が凍結した「候補全体の中で priority ごとに `(due_at, kind, operation_id)` 最小の 1 件」を 1 本の走査から取れる。部分索引化の狙い（dequeue されない `failed` 行を積み上げない）は保たれる。あわせて本文の「claim の候補も 2 分岐に対応して 2 本に分かれ…併合する」を、1 本の走査に候補述語（`pending` かつ due / `running` かつリース失効）を掛ける形へ書き直す。走査がリース有効な `running` 行を読み飛ばすことになるが、その件数は同 scope の in-flight な claim に限られる旨を 1 句添える。
    - 採らない側 = 提案 (b)（3 本を維持して「失効行は全件引いて併合」と明記）: ADR-008 自身が「1 バッチ最大 100 行は `running` 行の総数を縛らない」と書いており、「失効行は少数」という前提を spec 側に持てない。前提の無い全件読みを契約として書くより、索引の述語を候補述語に合わせるほうが根拠が閉じる。
    - Alarm 時刻用（`due_at`, `priority`, `kind`, `operation_id`）WHERE `status = 'pending'` と `scheduled_tasks_lease_idx` (`lease_expires_at`) WHERE `status = 'running'` は起床時刻の 2 候補用としてそのまま残す。起床時刻の導出（`spec/platform` が正本）は変えない。
  - 値域・分類・枠取り・`status` 3 値・SLO の数値・既定リース値には触れない（plan.md「含まれないもの」/ ADR-008）。
