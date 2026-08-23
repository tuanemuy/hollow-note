# Spec 整合性

## 総評

`spec/database/index.md#scheduled_tasks` の列・候補述語・注記・索引と、`spec/platform/index.md` の Alarm 起床規則 2 か所は、ポート JSDoc / memory 実装 / 適合スイートと**語のレベルまで一致している**（`lease_expires_at <= now` の等号、`due_at` / `attempts` / `priority` / `payload` の保存、pending / running の 2 分岐、返却順）。priority の 4 分類・同 priority 内の順序・`status` 3 値・SLO・1 turn の上限には手を入れておらず、`spec/usecases/storage.md:413`（orphan media = 期限回収 3）とも整合する。経緯・Issue 番号・進捗ログの混入もない。スコープ超過の spec 変更も無い（改訂は plan の宣言どおり 2 ファイル・列 1 / 索引 1 / 注記 1 段落 / platform 2 句）。`spec/index.md` はリンク索引なので更新不要、`spec/testcases/*` の「実装ステータス」列はリポジトリ全体で空運用なので TC-identity-070 / TC-job-198 への追記義務も無い。

ただし **AC-14(b) が基準に据えた「spec 内で Alarm の記述が矛盾しない」が満たしきれていない**。改訂対象として数え上げたのは `spec/platform` の 2 か所と `spec/adr/021:88` だけで、`spec/database/index.md:35` の Alarm 導出文が取り残されている。加えて、リース導入が `spec/platform` の 1 turn budget 規則へ及ぼす帰結が spec に反映されていない。

## Blockers

- **[B-001]** Alarm 起床の導出を述べる spec の出現が 1 か所取り残されている（`due_at` 索引だけで次の Alarm を決める、と今も書いてある）
  - 場所: `spec/database/index.md:35`（改訂した `spec/database/index.md:972` / `spec/platform/index.md:177,184` と同一の話題）
  - 理由: 972 行と 177 / 184 行が「pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方」へ揃った一方、同じファイルの 35 行は「`scheduled_tasks` は (`kind`, `operation_id`) を一意にし、**`due_at` 索引で次の Alarm を決める**」のまま。これは `.thread/19/adr.md` ADR-008 が「片方だけ直すと spec が自己矛盾する」「`spec/platform` だけを読んだ実装者は Alarm を `due_at` だけで張り、リース失効した `running` 行を誰も起こさない」と書いた実害そのものが、`spec/database` の中で再現している状態である。35 行は「scope DO の infrastructure 表」直後の要約段落で、#11 が `scheduled_tasks` の存在を最初に知る位置にあるため、972 行の詳細まで読まずに索引 1 本で Alarm を組む経路が実在する。AC-14(b) は「Alarm 起床を述べる spec の**全出現**が勘定に入っていること」を明示的に要求しており、`spec/adr/021:88`（列名を挙げないので改訂不要）については結論が残っているのに、同じ改訂ファイル内のこの行は数え上げ自体から漏れている
  - 提案: 35 行を「`due_at` 索引と `scheduled_tasks_lease_idx` から次の Alarm を決める」あるいは「次の Alarm 時刻は下記 `scheduled_tasks` の規則で決める」へ改める（要約段落なので列名を挙げず下流へ委ねる形でもよい）。あわせて、972 行が platform の規則を複製している構造そのものが今回の drift の再生産源なので、972 行の Alarm 文は「起床時刻の規則は platform の Scope Alarm 節に従う」まで薄め、導出式の正本を 1 か所に閉じることを検討する

- **[B-002]** リース導入が `spec/platform` の 1 turn budget 規則（100 行 / CPU 2 秒で yield）に与える帰結が spec に無く、「yield した残りは次 Alarm で即継続」という従来の性質が黙って壊れる
  - 場所: `spec/platform/index.md:184`（規則 4）と `spec/platform/index.md:186`（1 turn の上限）
  - 理由: 改訂前は、turn が処理しきれなかった due な行は `pending` のまま `due_at` が過去なので、規則 4 の「最小 `due_at`」は過去時刻＝ Alarm 即再発火となり、残件は直後の turn で継続した。リース導入後、handler が `claimDue` で行を掴んだ状態（`status='running'`）で budget / CPU 上限に当たって yield すると、掴んだまま未処理の行は `lease_expires_at` まで候補に戻らず、規則 4 の起床時刻もその行については `lease_expires_at`（既定 5 分後）になる。つまり **`1 turnは合計100行またはCPU 2秒でyieldする` の継続遅延が「次 tick」から「リース期間」へ跳ね上がる**。参照ランタイム側はこの不変条件を `packages/core/src/application/workers/scopeTaskRunner.ts:155-157` の WHY コメント（claim は残 budget 以下 = claim した行は必ずこの round で処理する）で守っているが、その知識はコード側にしか無く、**#11 が読む spec 側には 1 語も無い**。ADR-008 の判定基準（「`spec/platform` だけを読んだ実装者が正しい実装に着地するか」）に照らすと、着地しない。plan.md 自身もこれを「代償が『次 tick で拾い直し』から『リース期間ぶん放置』へ跳ね上がる」とリスクに挙げており、spec へ渡す価値の判断が抜けている
  - 提案: `spec/platform/index.md:186` の 1 turn 規則に 1 句足す。例:「1 turn は claim した行をその turn で settle しきる件数だけ claim する（yield 時に未処理の claim を残さない）。残すとその行は `lease_expires_at` まで再開できない」。規則 4 の側に「掴んだままの行があるなら次の起床は `lease_expires_at`」と書く形でも同じ意図に届く

## Warnings

- **[W-001]** 「`due_at` は状態によらず実行予定時刻を意味する」が `failed` 行まで含む書き方になっており、参照バックエンドの行型と食い違う
  - 場所: `spec/database/index.md:972` / `packages/core/src/adapters/memory/store.ts:324-337`
  - 理由: この文の目的は「claim が `due_at` を押し出さない（＝ pending と running で意味が変わらない）」ことの宣言だが、「状態によらず」は `failed` も射程に入る。一方、実装は同じ改訂で `ScheduledTaskRow` を判別共用体にし、`failed` から `dueAt` を**落とした**うえで「a `failed` row has no run to be due for」と JSDoc に書いている。`spec/database` の列は `due_at` NOT NULL のままなので保存表現の差は ADR 024 / 046 の範囲で許容だが、**「失敗した行の `due_at` に実行予定時刻としての意味があるか」という意味論の点で spec と参照実装が逆のことを言っている**。#11 が「失敗行も `due_at` を保つ」と読んで Alarm 候補や age 計測へ混ぜると、B-001 とは別経路で誤りに落ちる
  - 提案: 「`due_at` は `pending` / `running` のどちらでも実行予定時刻を意味し、claim は書き換えない」へ限定する（`failed` は候補述語からも起床規則からも既に外れているので、射程を狭めても他の記述は壊れない）

- **[W-002]** Alarm 起床規則を述べる文が、同じ文の中で列挙している `scheduled_tasks` の列構成に `lease_expires_at` を含めていない
  - 場所: `spec/platform/index.md:177`
  - 理由: 「各 scope object は `scheduled_tasks(due_at, priority, kind, payload, attempts)` を持つ。… running の最小 `lease_expires_at` のうち小さい方を `setAlarm()` する」と、1 文の中で「持っていない列」を根拠に起床時刻を決めている。この括弧書きは元から `status` / `last_error` を落とした略記だったが、`status` を知らない略記に `running` の判定を載せると、略記であることさえ読み取れなくなる
  - 提案: 括弧の列挙に `status` と `lease_expires_at` を足すか（`scheduled_tasks(due_at, priority, kind, payload, attempts, status, lease_expires_at)`）、逆に列挙をやめて「`scheduled_tasks`（列は [database](../database/index.md) を正本とする）」にする

- **[W-003]** 「Alarm 時刻用」索引が `status` を持たないまま起床規則だけ `pending` 限定になり、失敗行が索引の先頭に恒久的に居座る
  - 場所: `spec/database/index.md:976`（既存の Alarm 時刻用 (`due_at`, `priority`, `kind`, `operation_id`)）と `spec/platform/index.md:177,184`
  - 理由: 改訂前の起床規則は状態を問わない「最小 `due_at`」だったので、この索引の先頭 1 行がそのまま答えだった。改訂後は「**pending の**最小 `due_at`」になったのに、索引側には `status` が無い。`failed` 行は `schedule` で蘇生されるまで恒久的に残り、`due_at` は失敗時刻（過去）なので**索引の先頭に溜まり続ける**。running 行も同様に読み飛ばし対象になる。リース側には `WHERE status = 'running'` の部分索引を新設した一方で、pending 側の非対称が残っており、「アクセスパスごとに索引を書き分ける」という `spec/database` の体裁（`jobs` の `jobs_lease_idx` が先例）とも噛み合わない
  - 提案: Alarm 時刻用索引を `WHERE status = 'pending'` の部分索引にする、または `status` を先頭に含める。少なくとも「pending 以外を読み飛ばす前提でよい」根拠（失敗行の件数が有界であること）を 1 文残す

- **[W-004]** 索引 1 行の中で命名規約が混在している
  - 場所: `spec/database/index.md:976`
  - 理由: 同じ文の中で既存 2 本は用途名（「Alarm 時刻用」「dequeue 用」）、新設 1 本だけが物理名（`scheduled_tasks_lease_idx`）になっている。`jobs`（674 行）は全索引が物理名の箇条書きなので、どちらの体裁にも寄り切っていない
  - 提案: 「リース失効走査用 (`lease_expires_at`) WHERE `status = 'running'`」と用途名へ揃える（`jobs_lease_idx` との対応は必要なら括弧で添える）

- **[W-005]** 既定リース 5 分と `spec/platform` の「priority 0 の最古 task age 1 分」SLO の関係が spec に書かれていない
  - 場所: `spec/platform/index.md:186` / `packages/core/src/application/ports/scopeTaskScheduler.ts`（`SCOPE_TASK_LEASE_MS` と `leaseMs` の選び方を書いた JSDoc）
  - 理由: ポート JSDoc は `leaseMs` の**下限**（最悪ケースの turn ＝ claim バッチ全体を上回ること）だけを規定し、上限には触れていない。しかし spec 側には priority 0 の age 1 分 SLO があり、writer が落ちた priority 0 の行の回復には必ず `leaseMs` かかる。既定 5 分は SLO の 5 倍で、**1 回のクラッシュ回収が構造的に SLO 違反を含む**。ADR-002 が「reclaim を繰り返す行ほど age が伸びるので SLO が検知できる」と書いた検知側は成立しているが、回復側の遅延と SLO の関係は誰も引き受けていない
  - 提案: `spec/platform` の SLO 文か `spec/database` のリース注記に、「リース窓は priority 0 の回復遅延の下限になる」旨を 1 文残す。#11 が `leaseMs` を選ぶとき、下限（turn 所要時間）と上限（SLO）の両方を見られる状態にする

- **[W-006]** 新設 env 変数 `SCOPE_TASK_LEASE_MS` が `docs/runtime_node.md` の環境変数表に無い
  - 場所: `docs/runtime_node.md:58-71`（`OUTBOX_LEASE_MS` などが並ぶ表）
  - 理由: spec 本体ではないが、CLAUDE.md が `docs/runtime_node.md` を「操作する側の正本」と位置づけており、この表は boot が受理する変数の一覧として書かれている。AC-17 が要求したのは `.env.example` だけなので受け入れ基準は満たしているが、**ADR-010 が「配備側が選べること」を契約の柱に据えた変数が、配備側向けドキュメントに 1 行も無い**のは、その ADR の趣旨と噛み合わない（`OUTBOX_LEASE_MS` は `.env.example` と runtime_node.md の両方に載っているという先例もある）
  - 提案: 表に 1 行足す（`SCOPE_TASK_LEASE_MS` / no / `300000` / Lease window (ms) a scope-task claim holds its rows for; must cover a whole claim batch）

## 指摘しなかったが確認した点

- `spec/adr/021-scope-sharded-data-plane.md:88`（「最も早い時刻に 1 つの alarm を設定する」）— 列名を挙げていないので新しい導出と矛盾しない。改訂不要という steps.md / ADR-008 の結論に同意する
- `spec/domains/index.md:322` / `spec/usecases/job.md:615`（attempt と `dueAt` を指数 backoff で更新し上限で `failed`）— 新しい遷移表と整合。リース失効の再 claim が attempt を消費しないことと衝突しない
- `spec/usecases/storage.md:413`（orphan media は priority 3）/ `spec/platform/index.md:67`（過負荷時に priority 2/3 だけ抑制）— `ScopeTaskPriority` の 4 値と整合
- `spec/testcases/identity/deleteAccount.md:36`（TC-identity-070）/ `spec/inventory/test.md:211,873` — 「priority 0 の最低枠で先行する」という既存のテストケースが、今回の適合スイート（低 priority 大量滞留下で priority 0 が取れる / 逆向きも 1 件取れる）で初めて実体を得た。`実装ステータス` 列はリポジトリ全体で空運用なので追記義務は無い
- `spec/index.md` — リンク索引のみで、列や規則を要約していないため更新不要
- `spec/domains/` / `spec/inventory/adapter.md` に `ScopeTaskScheduler` / `ScopeTaskQueue` の行が無いこと — #2 の新設時からの状態で、plan.md が spec-sync の持ち分として明示的に除外している。本 PR の欠落ではない
- `.thread/19/adr.md` の各 ADR が `spec/adr/` に昇格していないこと — 昇格判定は後フェーズの持ち分として指摘しない

## カバレッジ

- 確認: `spec/database/index.md`, `spec/platform/index.md`, `.thread/19/plan.md`, `.thread/19/adr.md`, `.thread/19/steps.md`, `.thread/19/testing.md`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/.env.example`
- 確認（差分外・照合のため）: `spec/index.md`, `spec/adr/021-scope-sharded-data-plane.md`, `spec/adr/index.md`, `spec/domains/index.md`, `spec/usecases/storage.md`, `spec/usecases/job.md`, `spec/testcases/identity/deleteAccount.md`, `spec/inventory/test.md`, `spec/inventory/adapter.md`, `docs/runtime_node.md`
- スキップ: `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — 新署名と判別共用体への型追随のみで、spec の記述に対応する主張を持たない（観点外）
