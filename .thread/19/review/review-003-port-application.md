# レビュー 003 — Port Contract & Application

### Port Contract & Application

#### Blockers

なし

3 ラウンド目としてゼロベースで差分を読み直した結果、契約・呼び出し側・budget 会計・UoW 分離のいずれにも実害のある欠陥は見つからなかった。特に検算した点:

- **budget × リースの不変条件は成立している。** `claimDue({ limit: budget })` の直後に同じ `budget` を 1 行 1 減算するため、`claimed.length <= budget` が保たれる限り内側ループは全行を訪問し、リース中のまま取り残される行は出ない（算術的に `budget - i > 0`、`i < claimed.length <= budget`）。
- **settle 漏れ経路は無い。** `deleteFilesByOwner` / `deleteQuota` / `prunePersonalCleanupBarriers` の全分岐が `complete` / `schedule` / `backoffOrSchedule` のいずれかでリースを解放する。唯一 settle しない `alreadyApplied` 分岐は `commandKey` を渡す初回コマンド経路専用で、task 駆動の handler からは到達しない（`scopeTaskRunner.ts:93-114` は `commandKey` を渡さない）。handler が throw した場合も runner の `backOff` が pending へ戻す。
- **UoW の 2 プレーン分離に違反していない。** `claimDue` の `run` と handler 側の `run` は逐次で、ネストしていない。`settleCleanupTurn` → `handOverPersonalCleanup` の global プレーン呼び出しも scope の `run` の外。
- **priority の割り当ては spec の分類どおり。** security cleanup = `storage.ownerDeleteContinued` / `usage.userCleanupContinued` / `identity.personalCleanupHandoverContinued`、期限回収 = `identity.personalBarrierPruneContinued`。
- **適合スイートは AC-2〜AC-10 を観測可能な結果だけで拘束している。** リース境界（`leaseMs - 1` で不可視 / `+1` で claim 可）まで pin されており、`leaseMs` を既定値から外した値で試しているので引数を無視するバックエンドは落ちる。保存表現の凍結は無い。

#### Warnings

- **[W-001]** `claimDue` の返却件数上限が契約文として明示されていない
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:85-101`
  - 理由: 選択規則は「until the budget runs out」を 2 回使うが、この "budget" という語はどこでも定義されておらず、`limit` の同義語であることは後続の散文（"a single priority takes the whole `limit`"）から逆算するしかない。`ScopeTaskQueue.listDue` 側は "never more than `limit`" と明示しているので、2 つのポートで同じ規則を述べているのに片方だけ上限が言い切られていない非対称になっている。しかもこの上限は文章の綺麗さの問題ではなく、`scopeTaskRunner.ts:158-163` の安全性がまさに `claimed.length <= limit` に依存している（超えた瞬間に取り残された行がリース期間ぶんロックされる）。契約の正本はポート定義（ADR 026 §1）なので、#11 が「budget」を CPU 予算と読み違える余地を残すべきではない。
  - 提案: "budget" を `limit` に統一し、選択規則の直前か直後に「`claimDue` returns at most `limit` rows」を 1 文で明記する。

- **[W-002]** runner の WHY コメントが「claim した行は必ず処理される」と言い切っており、10 行下の no-handler 分岐と食い違う
  - 場所: `packages/core/src/application/workers/scopeTaskRunner.ts:158-160`
  - 理由: コメントは "what keeps every claimed row **processed** in this round" と書くが、直後の `handle === undefined` 分岐は行を claim したまま `continue` し、意図的にリース満了まで放置する（`scopeTaskHandlers` の JSDoc がそう規定している）。`spec/platform/index.md` 側は「budget 内で必ず**訪問**する件数までしか claim しない」と訪問で言っており、そちらが正しい。処理と訪問を混同したコメントは、#11 が「claim したら settle しなければならない」と読む余地を作る。
    加えて、内側ループの `if (budget <= 0) break;` は上記の算術から到達不能だが、万一バックエンドが `limit` を超えて返した場合はここで**黙って**行を捨て、その行がリース期間ロックされる — コメントが守ろうとしている性質が破れる唯一の場所が無言なのは惜しい。
  - 提案: "processed" を "visited" に直す（spec の語に揃う）。`break` 側は、到達したら `logger.error` を 1 行残すか、そもそも `claimed` を `slice(0, budget)` せずに全件訪問する形にして分岐自体を消す。

- **[W-003]** ポート JSDoc の同内容が 2〜3 か所に重複しており、110 行のうち相当量が言い換えになっている
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:66-126, 139-157`
  - 理由: 自己矛盾は見つからなかったが（遷移表と散文の `backoff` / `failed` / reclaim の記述は突き合わせても整合していた）、同じ事実の反復が目立つ:
    - fencing token を持たない＝リースは advisory、という中核の注意が `:80-83`（"Exclusivity stops at the claim — settling carries no fencing token (see `leaseMs` below)…"）と `:139-142`（"The lease is advisory: settling addresses a row by `(kind, operationId)` alone and carries no fencing token…"）で 2 回述べられ、前者が後者を前方参照している。
    - `backoff` の指数バックオフと `SCOPE_TASK_MAX_ATTEMPTS` での `failed` 化が、遷移表 `:111` と直後の散文 `:121-126` で二重に規定されている。
    - claim がリースを取り `dueAt` / `attempt` / `priority` / `payload` を保つことが `:68-71`、`:109`（表）、`:115-119` の 3 か所にある。
    契約の正本である以上冗長側に倒すのは妥当だが、遷移表を導入した時点で表が規範・散文が理由、という役割分担にできるはず。今の形は「表を読んでから散文でもう一度同じ規則を読む」構成になっており、3 ラウンドの積み増しがそのまま層になって見える。
  - 提案: 遷移表を規範の唯一の置き場にし、散文側は表から読み取れない *理由* だけ残す（`backoff` 散文は「なぜ `failed` で止めるか」「zero targets は `complete`」だけにする、`:80-83` は fencing の話を `leaseMs` 段落へ寄せて "Exclusivity stops at the claim." の 1 文に縮める）。

- **[W-004]** ポート契約に特定バックエンドの列名が埋め込まれている
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:76-80`
  - 理由: 排他の説明が `WHERE status = 'pending' AND due_at <= ?` / `WHERE status = 'running' AND lease_expires_at <= ?` という SQL 断片で書かれている。`status` / `due_at` / `lease_expires_at` は `spec/database/index.md#scheduled_tasks`（= #11 の D1 / DO スキーマ）の列名であって、ポートの語彙（`pending` / `running`、`dueAt`、`leaseExpiresAt`）ではない。memory バックエンドには `status` 列は存在しない。ADR 026 は「契約の正本はポート定義」としつつ §3 で実現手段を契約から外すよう求めており、条件付き更新という**手法**の提示は §1 の趣旨に合うが、そこに 1 つのバックエンドの保存表現まで載せると、スキーマ変更が application 層の編集を要求する向きの結合が生まれる。
  - 提案: 述語をポートの語彙で書く（例: "a conditional update whose predicate repeats the candidate test — still `pending` and due, or still `running` with a lapsed lease — so that only the writer whose predicate matches takes the row"）。列名まで示したいなら `spec/database` への参照 1 本に置き換える。

#### カバレッジ

- 確認: `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`（`ScheduledTaskRow` の判別共用体のみ）, `spec/database/index.md` / `spec/platform/index.md`（ポート JSDoc の主張が spec の記述と一致するかの突き合わせのみ）, `apps/web/app/server.node.ts` / `apps/web/app/worker/node/runner.ts`（AC-17 の 1 本道が `TuningEnv` → `NodeServerEnv` → runner tuning → `runDueScopeTasks` まで繋がっていることの確認のみ）
- スキップ: `apps/web/.env.example`, `docs/runtime_node.md` — 運用ドキュメントで Runtime 観点の担当
- スキップ: `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts` — memory アダプター内部の直列化テストで Adapter 観点の担当
- スキップ: `.thread/19/**` — このPRの計画・レビュー足場（Phase 7 で削除）

補足（指摘には数えない）: スコープ越えの有無も確認した。`nodeServerEnvToTuningEnv` の空値ドロップが既存 4 変数（`OUTBOX_*`）にも及ぶのは AC-17 の文面を超える挙動変更（空文字が「boot 拒否」から「未設定」へ変わる）だが、`SCOPE_TASK_LEASE_MS` だけ別扱いにするほうが害が大きく、`DELETION_TICKET_KEY` の既存解釈にも揃うので妥当と判断した。ほかに範囲外の変更は見当たらない。
