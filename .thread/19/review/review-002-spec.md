# レビュー 002 — Spec 整合性

## Spec 整合性

### Blockers

なし

### Warnings

- **[W-001]** `spec/platform` に足した「1 turn がclaimするのはそのturnでsettleしきる件数まで／yield 時に未処理の claim を残さない」が、同じ PR が AC-11 として固定した「ハンドラ未登録 kind の行はリース失効まで戻らない」挙動と字義どおりには両立していない
  - 場所: `spec/platform/index.md:186`（対応する実装側の記述は `packages/core/src/application/workers/scopeTaskRunner.ts:83-90` の `scopeTaskHandlers` JSDoc、テストは `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts:209-218`）
  - 理由: この文の根拠節は「残した行は `lease_expires_at` まで再開できず、次の起床までの遅延がリース期間へ跳ね上がる」であり、まさにハンドラ未登録行に起きることを禁止の理由として挙げている。ところが本 PR は「claim → ハンドラ無し → settle せずリース満了まで放置」を意図した契約（AC-11 / adr.md ADR-004）として実装し、JSDoc にも「it comes back a lease apart (five minutes by default)」と明記している。spec は「コードについて真であること」を建前にしているので、この 1 文は #11 の実装者に「未登録 kind の行は claim してはいけない（あるいは claim したら必ず release する）」という、ポート契約に存在しない義務（release 操作自体が無い）を読ませうる。加えて 1 turn は「CPU 2 秒で yield」もするため、100 行を 1 度に claim する実装では claim 時点で「settle しきる件数」を知りようがなく、小分け claim を前提にしないと満たせない — その前提は spec に書かれていない
  - 提案: 意図は「claim 件数がその turn で**訪問**する件数を超えない（＝ budget を超えて claim しない）」ことなので、そこまでに絞る。例:「1 turn が claim するのはその turn の budget 内で必ず訪問する件数までとし、budget を超えて claim しない。ハンドラを持たない kind の行だけは settle されずリース満了まで待つ」。CPU 予算で切り上げる場合の扱い（小分け claim）も 1 句添えると #11 が迷わない

- **[W-002]** `spec/platform` が新しく定めたリース期間の選び方（上限側の目安 = priority 0 の最古 task age SLO = 1 分）を、同じ PR が入れた既定値 5 分が満たしていない
  - 場所: `spec/platform/index.md:186` ↔ `packages/core/src/application/ports/scopeTaskScheduler.ts` の `SCOPE_TASK_LEASE_MS = 5 * 60 * 1000` / `apps/web/.env.example:78` / `docs/runtime_node.md:69`
  - 理由: 追加した文は「リース期間は…最悪ケースの turn 所要時間（これを下回ると…）と priority 0 の age SLO（**これを上回るとクラッシュ 1 回の回収が SLO 違反を含む**）の両方を見て選ぶ」と、下限・上限の両側から帯を定めている。ところが実装済み 4 kind はすべて priority 0 か 3 で、priority 0 の既定リースは 5 分 = SLO の 5 倍。ポート JSDoc の既定値の根拠も「outbox relay の既定に合わせた」だけで、この帯には触れていない。spec だけを読んだ #11 は「既定 5 分」を素直に持ち込むと、自分で書いた SLO を既定値で破る配備になる
  - 提案: どちらかに寄せる。(a) spec 側の帯を「上限は各 priority の age SLO を見て決める。ただし SLO 監視を持たない配備はこの限りではない」と条件付きにする、(b) ポート JSDoc の既定値説明に「参照ランタイムには SLO 監視も自動復旧も無いため outbox の既定に揃えた値であり、SLO を持つ配備は `spec/platform` の帯で選び直す」を 1 文足す。少なくとも `docs/runtime_node.md` の行が「5 分は SLO 帯の外」と読めないままなのは避けたい

- **[W-003]** Alarm 起床時刻の導出式が spec 内に 3 回書かれ、`spec/database` は「正本は platform」と断りながら式そのものを再掲している
  - 場所: `spec/database/index.md:972` / `spec/platform/index.md:177` / `spec/platform/index.md:184`
  - 理由: 委譲の連鎖自体は閉じている（`spec/database:35`「下記 `scheduled_tasks` の規則で決める」→ `:972` → platform の Scope Alarm 節が実際に規則を述べる）ので宙に浮いた参照や循環は無い。ただし本 PR の狙いが「導出式の正本を 1 か所に集約する」ことだったのに対し、改訂後は同じ式が 2 ファイル 3 か所に平文で並ぶ状態になった。#11 でリースの扱いが 1 段変わったとき（例: 失効直前に先回りして起こす、失効行を別 Alarm に分ける）に、正本を直しても `spec/database:972` が古い式のまま残る形の劣化を招く。spec は「破棄された判断を持たない」建付けなので、同義の規範文が複数箇所にあること自体が負債になる
  - 提案: `spec/database:972` の末尾を式の再掲ではなくポインタに落とす（例:「Alarm 起床時刻の導出は [platform](../platform/index.md) の Scope Alarm 節を正本とし、本表の `due_at` / `lease_expires_at` がその材料になる」）。逆向き（database を正本にして platform:177 / 184 が参照する）でも構わないが、平文の式は 1 か所に限る

- **[W-004]** 索引の改訂が片側だけ — Alarm 時刻用には `WHERE status = 'pending'` が付いたのに、dequeue 用は述語なしのまま残っている
  - 場所: `spec/database/index.md:976`
  - 理由: 起床規則を支えられるかという点では問題ない（pending の最小 `due_at` は Alarm 時刻用、running の最小 `lease_expires_at` は `scheduled_tasks_lease_idx` から取れる）。気になるのは claim 側で、候補述語が `pending AND due_at <= now` / `running AND lease_expires_at <= now` の 2 分岐になったにもかかわらず、dequeue 用 (`priority`, `due_at`, `kind`, `operation_id`) はどの status も含む索引のままになっている。`failed` 行は `complete` / `schedule` が来ない限り消えない（本 spec にも回収規定が無い）ので、この索引には決して dequeue されない行が永久に積み上がり、claim のたびに読み飛ばす対象になる。同じ理由で Alarm 時刻用に述語を足した改訂と非対称であり、「なぜ片方だけか」が読み取れない
  - 提案: dequeue 用にも `WHERE status = 'pending'` を付け（`running` の失効分は本文が言うとおり `scheduled_tasks_lease_idx` から取って併合する）、あるいは付けない理由（`failed` 行が少数に留まる根拠など）を 1 句添える。`jobs` 側の `jobs_lease_idx` と同じく部分索引で揃えるほうが spec 内の語彙も揃う

## カバレッジ

- 確認（差分本文で読んだ変更ファイル）: `spec/database/index.md`, `spec/platform/index.md`, `docs/runtime_node.md`, `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `.thread/19/adr.md`, `.thread/19/plan.md`, `.thread/19/steps.md`, `.thread/19/testing.md`
- 確認（差分外の照合先）: `spec/adr/021-scope-sharded-data-plane.md:88`（「最も早い時刻に 1 つの alarm を設定する」— 列名を挙げていないのでリース込みの導出と矛盾せず、改訂不要という adr.md ADR-008 の結論に同意）, `spec/domains/index.md:272,322`（scope task と `scheduled_tasks` / Alarm の記述。priority / lease の追加と矛盾しない）, `spec/database/index.md:35,970,1001,1045`, `spec/platform/index.md:67,169,177-186`, `spec/index.md`（新規ドキュメントが増えていないため索引の更新は不要）, `spec/` 全体を `scheduled_tasks` / scope task / priority / lease / Alarm / `due_at` で grep（残存する古い「最小 `due_at`」記述は無し）, GitHub Issue #11 のコメント（#19 からの引き継ぎ 2 点 — fencing 未決着のまま複数 writer を配備しない / runner の round 内 budget 配分は未変更 — が投稿済みで、`.thread/` 消滅後も残る形になっている）
- 確認（受け入れ基準の照合）: AC-14(a)（`lease_expires_at` 列・再 claim 条件・`due_at` の意味・リース失効走査索引）、AC-14(b)（`spec/platform` の 2 か所 + ADR 021 の結論）、AC-15 の spec / JSDoc 側、AC-17 の `.env.example` / `docs/runtime_node.md` 記載はいずれも満たされている。spec の書き方（現在形・経緯や進捗ログを書かない）にも違反なし — `spec/` / `docs/` に「Issue #19」等の経緯記述は無い。plan.md「含まれないもの」を越える spec 変更も見当たらない
- スキップ: `.thread/19/review/review-001-adapter.md`, `.thread/19/review/review-001-port-application.md`, `.thread/19/review/review-001-runtime.md`, `.thread/19/review/review-001-spec.md`, `.thread/19/review/review-001.md`, `.thread/19/review/triage.md`, `.thread/19/review/triage-plan.md` — 本 PR のレビュー記録そのもの（Phase 7 で削除される足場）。指示によりカバレッジ対象外。`.thread/19/review/triage-keys.md` は既出判定の入力としてのみ参照
