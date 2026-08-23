# 実装手順 — Issue #19

## 設計

内側から: ポート契約 → 適合スイート → memory アダプター → 呼び出し側（usecase / worker）→ ランタイム配線 → テスト追随 → spec の改訂。ドメイン層と UI 層への影響は無い（scope task は application 平面の継続要求の運搬手段であり、エンティティでも画面でもない）。

**ステップ 1 で署名を変えた時点から、ステップ 10 で全呼び出し側とテストを追随させるまで `pnpm typecheck` / `pnpm test` は赤のままである。** 契約先行の順序として正しく、途中の赤は想定内なので、ステップ 1〜10 は分割不能な 1 単位（1 コミット / 1 PR）として扱う。

### ポート契約（`application/ports/`）

これが本 Issue の主眼。確定させる 4 点は adr.md（ADR-001..009）に根拠がある。契約には**観測可能な振る舞いだけ**を書き、保存表現（何列でどう持つか）は書かない（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) §3）。

#### 1. priority の値域

```ts
/** `spec/database/index.md#scheduled_tasks` の分類。小さいほど先。 */
export const ScopeTaskPriority = {
  /** membership / account security cleanup, lease reaping */
  securityCleanup: 0,
  outboxRelay: 1,
  projection: 2,
  expiryCollection: 3,
} as const;

export type ScopeTaskPriority =
  (typeof ScopeTaskPriority)[keyof typeof ScopeTaskPriority];
```

`schedule` / `backoffOrSchedule` の入力に `priority: ScopeTaskPriority` を**必須**で足す（既定値なし）。

#### 2. 選択規則（`claimDue` / `listDue` 共通）

候補は「`pending` かつ `dueAt <= now`」または「`running` かつリース失効済み」。そこから:

1. **予約枠** — priority 昇順に、各 priority の候補のうち `(dueAt, kind, operationId)` が最小の 1 件を budget が尽きるまで取る
2. **充填** — 残り budget を、残りの候補から `(priority, dueAt, kind, operationId)` 昇順で取る
3. 返却順も `(priority, dueAt, kind, operationId)` 昇順

予約枠が取る 1 件をクラス内の全順序で決めるので、`limit` がクラス内候補数を下回っても返却**集合**が一意に定まる（ADR-001）。

予約は下限であって上限ではない（他クラスが空なら 1 クラスが `limit` を占めてよい）。`limit` がクラス数未満なら 1. が途中で切れ、厳密 priority 順に縮退する。

#### 3. 状態遷移とリース

`dueAt` は状態によらず「実行予定時刻」を意味する（ADR-002）。リース期限は別の値として持ち、claim が返す `ScopeTask.leaseExpiresAt` として観測できる。

| 操作 | 前 | 後の状態 / `dueAt` / `attempt` | `priority` |
| --- | --- | --- | --- |
| `schedule` | 無 / pending / running / failed | pending, `dueAt = input.dueAt`, `attempt = 0`, リース解除 | `input.priority` で上書き |
| `claimDue` | pending（due）/ running（リース失効） | running, `dueAt` 不変, `attempt` 不変, `leaseExpiresAt = now + leaseMs` | 不変 |
| `complete` | 任意（無を含む） | 行削除（no-op 可） | — |
| `backoff` | pending / running | pending, `attempt + 1`, `dueAt = now + delay`, リース解除。`attempt` が `SCOPE_TASK_MAX_ATTEMPTS` に達したら failed。行が無ければ no-op | 不変 |
| `backoffOrSchedule` | 無 / pending / running | 行が無ければ `input.priority` / `dueAt = input.now` で mint してから `backoff` と同じ | 既存行は**不変**（mint 時のみ `input.priority`） |

`failed` から戻す手段は `schedule` だけ。リース失効による再 claim は attempt を消費せず、`dueAt` も動かさない（ADR-002 / ADR-004）ので、回収された行は同 priority 内の位置を保つ。settle は fencing しない — リースは助言的で、`leaseMs` は最悪ケースの turn（＝ claim バッチ全体の処理時間）を上回るよう配備側が選ぶ（ADR-005）。

#### 4. 署名と入力境界

```ts
export const SCOPE_TASK_LEASE_MS = 5 * 60 * 1000;

export type ScopeTask = Readonly<{
  kind: string;
  operationId: string;
  priority: ScopeTaskPriority;
  payload: ScopeTaskPayload;
  /** 実行予定時刻。claim を跨いで不変。 */
  dueAt: Date;
  /** このクレームの期限。過ぎた行は他の writer が回収できる。 */
  leaseExpiresAt: Date;
  attempt: number;
}>;

claimDue(
  args: Readonly<{ now: Date; limit: number; leaseMs: number }>,
): Promise<readonly ScopeTask[]>;
```

`claimDue` は引数 3 つになるのでオブジェクト引数へ（`OutboxRepository.claimPending` の `ClaimPendingArgs` と同型）。`ScopeTaskQueue.listDue(now, limit)` の署名は変えない（読み取り専用でリースを取らないため）。

入力境界を JSDoc に書く（CLAUDE.md「Validate at the boundaries」）:

- `limit <= 0` は空配列を返す（適合スイートで拘束する）
- `leaseMs` は正の値であること。0 / 負値を渡すと claim した瞬間に失効した行ができ、同じ round 内で二重 claim されうる
- `leaseMs` が最悪ケースの turn を下回った場合の実害を 1 行で書く: リースを超過した writer の settle が、その間に再 claim した writer の武装し直した行を消し、継続の鎖が止まる。personal cleanup ならアカウント削除が恒久停止する（reference runtime に自動復旧 cron は無い）
- `leaseMs` は配備側が選ぶ値である。参照ランタイムでは `SCOPE_TASK_LEASE_MS` 環境変数（既定 `SCOPE_TASK_LEASE_MS` 定数）で選ぶ（ステップ 9 / ADR-010）

`ScopeTaskQueue` 側の JSDoc は「順序は `dueAt` 昇順」を上記の選択規則へ差し替え、リース中の行が見えないことを書く。`DueScopeTask` は `{ scope, kind, operationId }` のまま（runner は scope の dedup にしか使わない）。

### ユースケース / アプリケーションロジック

- 継続を積む 6 か所が `priority` を渡す。kind → 分類は `spec/database/index.md:969` に従う:
  - `storage.ownerDeleteContinued` / `usage.userCleanupContinued` / `identity.personalCleanupHandoverContinued` → `securityCleanup`
  - `identity.personalBarrierPruneContinued` → `expiryCollection`
- `runDueScopeTasks` は `claimDue({ now, limit: budget, leaseMs })` を呼ぶ。`RunDueScopeTasksOptions` に `leaseMs?: number`（既定 `SCOPE_TASK_LEASE_MS`）を足す。この口はテストがリース失効を操作するためと、参照ランタイムが env で選んだ値を渡すための両方に使う（ステップ 9 / ADR-010）
- 参照ランタイムの配線（`application/di/env.ts` の `TuningEnv` → `NodeServerEnv` → runner tuning → `runDueScopeTasks`）は `OUTBOX_LEASE_MS` の 1 本道をそのまま写す（ステップ 9）
- runner の「ハンドラ未登録の kind は毎 tick 戻ってくる」JSDoc を、リース周期で戻る性質へ更新する
- runner の budget 配分（先頭 scope に残 budget を丸ごと渡す）は変更しない（ADR-007）
- 新しいユースケースは追加しない。ドメイン層は無変更

### アダプター / 永続化

- `ScheduledTaskRow` を**状態の判別共用体**にし、状態に属さない列を型から消す（CLAUDE.md「Make illegal states unrepresentable at the type level」）:

```ts
type ScheduledTaskBase = Readonly<{
  kind: string;
  operationId: string;
  payload: ScopeTaskPayload;
  priority: ScopeTaskPriority;
  attempt: number;
}>;

export type ScheduledTaskRow =
  | (ScheduledTaskBase & Readonly<{ state: "pending"; dueAt: Date }>)
  | (ScheduledTaskBase &
      Readonly<{ state: "running"; dueAt: Date; leaseExpiresAt: Date }>)
  | (ScheduledTaskBase & Readonly<{ state: "failed" }>);
```

  `leaseExpiresAt` は `running` にしか無く、`failed` は意味を持たない `dueAt` を持たない。これで「pending 行のリース期限」「failed 行の実行予定時刻」という表現可能な違法状態が消える。
- ただし**共用体は「読めない」ことしか保証しない**。`{ ...row, state: "failed" }` のような spread は excess property check を素通りするので、実行時の値には `dueAt` や `leaseExpiresAt` が残り、型エラーにもならない。**状態を跨ぐ遷移は spread せず、`state` と全フィールドを明示構築する**（ステップ 6）。これで CLAUDE.md「Make illegal states unrepresentable at the type level」が値のレベルまで届く
- 行の形が `spec/database` の列（`due_at` / `lease_expires_at` / `status`）と揃うのは偶然ではなく、「実行予定時刻とリースを分ける」という ADR-002 の原則を両者が共有するため。ただし memory は D1 のミラーではない（[ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md)）ので、列と 1:1 であること自体は契約ではない
- 選択規則は `claimDue` と `listDue` で同一なので、純粋関数として 1 か所に置き両方から使う（`adapters/memory/scopeTaskSelection.ts`）。入力は「候補になれる行」＝ `{ priority, dueAt, kind, operationId }` を持つものに構造的に制約する。候補判定（`state === "pending" ? dueAt <= now : state === "running" ? leaseExpiresAt <= now : false`）は呼び出し側で行い、純粋関数は選択と順序だけを持つ
- `claimDue` は選択した行を `{ state: "running", leaseExpiresAt: now + leaseMs }` で書き戻す（`dueAt` はそのまま）。書き込みは呼び出し元の scope UoW トランザクション内
- `listDue` は書かない。候補述語と選択規則だけを共有する
- D1 / Durable Object は本 Issue のスコープ外（plan.md「含まれないもの」）

### UI / プレゼンテーション

影響なし。

---

## 実装ステップ

### 1. `ScopeTaskScheduler` ポートを確定させる

- **対象ファイル:** `packages/core/src/application/ports/scopeTaskScheduler.ts`
- **変更内容:** 上の設計 1〜4 をそのまま反映する。`ScopeTaskPriority`（const object + union 型）、`SCOPE_TASK_LEASE_MS`、`ScopeTask` への `priority` / `leaseExpiresAt` の追加（`dueAt` は据え置き）、`schedule` / `backoffOrSchedule` 入力への `priority`、`claimDue` のオブジェクト引数化。JSDoc を書き直し、**選択規則・状態遷移表（priority 列を含む）・リースと reclaim（`dueAt` を動かさないこと）・attempt を消費しないこと・fencing しないこと・入力境界**を規定する。**縮退記述は現行 32-38 行の 3 文をまとめて置き換える**（AC-15）:
  - 32-34「Claiming is a scope transaction: a scope object has a single writer, so `claimDue` reads the due, non-failed rows in `dueAt` order …」— **single writer 前提への依存そのものが Issue の解消対象**なので、リースが前提を代替する旨（claim は `leaseExpiresAt` まで行を掴み、失効すれば他の writer が回収できる）へ置き換える
  - 34-36「`dueAt` is the whole of the order — there is no priority class here …」— 設計 §2 の選択規則へ置き換える
  - 36-38「Adding a priority (and the lease a multi-writer backend needs) is deferred to the runtime that first deploys more than one writer per scope.」— 削除する（確定した契約が本文になる）
- **注意:** 保存表現（`lease_expires_at` 列を足す / `claimed_at` にする / 別テーブルにする）は書かない。書くのは「`leaseExpiresAt` を過ぎるまで候補から外れる」までの観測語彙（ADR 026 §3、adr.md ADR-002）
- **理由:** ADR 026 の「契約の正本はポート定義」。#11 はここだけを読んで D1 / DO を書けなければならない

### 2. `ScopeTaskQueue` ポートの並び順契約を揃える

- **対象ファイル:** `packages/core/src/application/ports/scopeTaskQueue.ts`
- **変更内容:** `listDue` の順序契約を「`dueAt` 昇順」から scheduler と同一の選択規則（scope 横断・予約枠つき）へ差し替える。リース中の行は期限まで返さないこと、依然として書き込まない（claim は scope トランザクション内の `claimDue` の役目）ことを明記する。あわせて「予約枠が保証するのは priority の**クラス**が 1 件載ることであって、特定の scope が載ることではない」も書く。**入力境界も `claimDue` と同文で書く: `limit <= 0` は空配列を返す**（AC-10）
- **注意:** 境界を片側だけに書かない。選択規則はステップ 5 の `selectDueScopeTasks(candidates, limit)` を両ポートが共有する以上、`limit <= 0` の扱いも実際には両方で同じになる。契約文だけが `claimDue` 側にある状態は、規則が共有されていることを契約から読めなくする。実装・スイートの追加作業は発生しない（境界の実装はステップ 5 の 1 か所）
- **理由:** 枠取りを claim 側だけに入れると、低 priority しか持たない scope が `listDue` に載らず訪問されない（ADR-007）

### 3. 適合スイートに priority / lease / reclaim のケースを足す

- **対象ファイル:** `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`
- **変更内容:** 既存 8 ケースを新署名へ追随させたうえで、plan.md「テスト方針」の適合スイート項（**AC-2〜AC-10** に対応。AC-12 が拘束対象として名指しする範囲）を追加する。ヘルパ `schedule(...)` に priority 引数を足し、claim は `claimDue({ now, limit, leaseMs })` で呼ぶ。リース失効は `backend.clock.advance(...)` で作る。assert は「どの行が返る / 返らない / どの順で返る」だけに閉じ、生行を覗かない。AC-5 には**予約枠のクラス内順序**のケースを含める（priority 0 に `dueAt` 違いの 2 件 + priority 3 に 1 件、`limit: 2` で priority 0 側は `dueAt` 最小の行が返る = 返却集合が一意）
- **注意:** **AC-11 はここではなくステップ 10（application 層）の担当**。適合スイートは「ハンドラ未登録の kind」という概念を持たない（ハンドラ登録簿は application 層のもの）。スイートで表現できるのは AC-7 / AC-8 の「claim した行はリース中見えず、失効後に位置を保って戻る」までで、それを未登録 kind の文脈で観測するのが AC-11 になる。ハンドラの概念をスイートへ持ち込まない
- **理由:** ADR 026 §2 — スイートが契約の実行形であり、#11 の D1 / DO は同じスイートを通す

### 4. memory の行を判別共用体にする

- **対象ファイル:** `packages/core/src/adapters/memory/store.ts`
- **変更内容:** `ScheduledTaskRow` を設計「アダプター / 永続化」の 3 メンバー共用体へ置き換える（`priority` 追加、`running` に `leaseExpiresAt`、`failed` から `dueAt` を落とす）
- **理由:** `spec/database#scheduled_tasks` の `priority` 列・3 値 `status`・`lease_expires_at` に対応させつつ、状態依存の列を型で閉じる

### 5. 選択規則を純粋関数として実装する

- **対象ファイル:** `packages/core/src/adapters/memory/scopeTaskSelection.ts`（新規）
- **変更内容:** `selectDueScopeTasks(candidates, limit)` を実装する。2 段選択（予約枠 → 充填）と `(priority, dueAt, kind, operationId)` の比較子を持たせ、返却順も同じ比較子に揃える。`limit <= 0` は空配列。`compareStrings`（`adapters/memory/support.ts`）を使う
- **理由:** scheduler と queue の 2 実装で規則がずれるのを型と共有で防ぐ。純粋なのでバックエンド固有の事情を持ち込まない

### 6. memory の `ScopeTaskScheduler` を更新する

- **対象ファイル:** `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`
- **変更内容:** `schedule` / `backoffOrSchedule` が priority を ADR-009 の規則で扱う（`schedule` は上書き、`backoffOrSchedule` は mint 時のみ）。候補判定（pending は `dueAt <= now`、running は `leaseExpiresAt <= now`）を書き、ステップ 5 の関数で選び、選んだ行を `{ state: "running", leaseExpiresAt: now + leaseMs }`（`dueAt` は保存）で書き戻してから `toScopeTask` へ写す。`complete` は現行どおり削除
- **注意:** **状態を跨ぐ遷移は `{ ...row, state: … }` で作らず、`state` と全フィールドを明示構築する**。共用体化しても spread は excess property check を素通りするため、`backedOff` が現行どおり `{ ...row, attempt, state: "failed" }` で failed を作ると、値には `dueAt`（running から来たなら `leaseExpiresAt` も）が残ったまま型エラーにならない。逆に `state` を書かない分岐（`{ ...row, attempt, dueAt: … }`）は、入力が `failed` 行のときに `state: "failed"` を持ち込んだまま `dueAt` を載せた行を作れる（現行の分岐条件では到達しないが型は止めない）。`backedOff` は **pending 側（`state: "pending"`、`leaseExpiresAt` を持たない）も failed 側（`dueAt` / `leaseExpiresAt` を持たない）も同じ強さで明示構築する**
- **理由:** 参照バックエンドが契約を満たす（ADR 024）。CLAUDE.md「Make illegal states unrepresentable」を値のレベルまで届かせる

### 7. memory の `ScopeTaskQueue` を更新する

- **対象ファイル:** `packages/core/src/adapters/memory/scopeTaskQueue.ts`
- **変更内容:** 全 scope 分の候補（ステップ 6 と同じ判定）をまとめた後、ステップ 5 の関数へ通す。書き込みは行わない
- **理由:** AC-6 / ADR-007

### 8. 呼び出し側で priority を渡し、runner がリースを取る

- **対象ファイル:** `packages/core/src/application/usage/deleteQuota.ts`、`packages/core/src/application/storage/deleteFilesByOwner.ts`、`packages/core/src/application/cleanup/personalCleanup.ts`、`packages/core/src/application/workers/scopeTaskRunner.ts`
- **変更内容:** 6 か所の `schedule` / `backoffOrSchedule` に `priority` を渡す（分類は設計「ユースケース / アプリケーションロジック」の対応表）。`runDueScopeTasks` は `claimDue({ now, limit: budget, leaseMs })` を呼び、`RunDueScopeTasksOptions.leaseMs`（既定 `SCOPE_TASK_LEASE_MS`）を追加する。`scopeTaskHandlers` の JSDoc（未登録 kind は毎 tick 戻る = standing log line、の記述）を「リース周期で戻る／停滞の検知はログ頻度ではなく最古 task age に拠る」へ直す。あわせて `runDueScopeTasks` に **WHY コメントを 1 行**残す: claim した行はこの round で必ず処理しきる（claim 件数 ≤ 処理件数）— 破ると行がリース期間ぶん放置される
- **理由:** AC-1 / AC-7 / AC-11。runner は claim の唯一の呼び出し元

### 9. 参照ランタイムに `leaseMs` を選ぶ経路を通す

- **対象ファイル:** `packages/core/src/application/di/env.ts`、`packages/core/src/application/di/serverNode.ts`、`apps/web/app/worker/node/runner.ts`、`apps/web/app/server.node.ts`、`apps/web/.env.example`
- **変更内容:** `OUTBOX_LEASE_MS` の 1 本道をそのまま写して `SCOPE_TASK_LEASE_MS` を露出する。
  - `env.ts` — `TuningEnv` に `SCOPE_TASK_LEASE_MS?: string | undefined` を足し、`scopeTaskTuningSchema`（`leaseMs: z.coerce.number().int().positive().default(SCOPE_TASK_LEASE_MS)`）と `readScopeTaskTuning(env)` を `readRelayTuning` / `readPruneTuning` と同じ形で置く
  - `serverNode.ts` — `NodeServerEnv` に同名フィールド（`z.string().optional()`）を足し、`nodeServerEnvToTuningEnv` の射影に 1 分岐を加える
  - `runner.ts` — `NodeWorkerRunnerTuning` に `scopeTaskLeaseMs?: number` を足し、`runScopeTaskTick` を `runDueScopeTasks(container, { leaseMs })` へ（未設定なら既定のまま `runDueScopeTasks(container)` 相当）
  - `server.node.ts` — `boot()` の `tuning` に `scopeTaskLeaseMs: readScopeTaskTuning(tuningEnv).leaseMs` を渡す
  - `.env.example` — 「Optional: outbox / worker tuning」節の末尾に、既定値と「1 回の claim バッチ全体を覆う長さであること」を 2 行コメントで添えて `#SCOPE_TASK_LEASE_MS=300000` を載せる
- **理由:** AC-17 / ADR-010。ADR-005 は `leaseMs` を「配備側が選ぶ」ことを契約の柱にしたので、参照ランタイムにその口が無いまま契約文だけを書くと、実害の重い既定値へ黙って賭ける形になる

### 10. 既存テストを新契約へ追随させ、同時実行の回帰テストを足す

- **対象ファイル:** priority を渡す必要がある**直接の `schedule` 呼び出しは 6 か所**（`unitOfWork.test.ts:75` / `deleteAccount.terminalPrune.test.ts:289` / `deleteFilesByOwner.test.ts:306` / `scopeTaskRunner.test.ts:208, 232, 266`）。`deleteQuota.test.ts:67` と `deleteFilesByOwner.test.ts:174` は `withLostCommitAfterSchedule` の**素通しデコレーター**（`schedule: async (input) => { await ctx.scopeTaskScheduler.schedule(input); throw … }`）で、`input` はポートの入力型から文脈的に型付けされて素通しされるだけなので **priority を足す引数が無い。触ると余計な差分になる**
  - `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts` — `schedule`（75 行）に priority、`claimDue`（93 行）をオブジェクト引数へ
  - `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts` — 直接 `schedule` する 3 か所（208 / 232 / 266 行）に priority。204-225 の「未処理 kind は due のまま」を AC-11 の形へ更新。`listDue` の結果を assert する 136 / 147 / 186 / 223 / 284 / 295 行は claim 前 / settle 後の観測なので通るはずだが、リース導入で「claim 済みの行が `listDue` から消える」影響を受ける群なので 1 件ずつ確認し、変更不要なら理由を残す
  - `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts` — 289 行の `schedule` に priority。342-345 行の生行 `dueAt` 読みは判別共用体化で `state` 絞りが要る（値自体は pending 行なので不変）。348 行の `listDue` 観測を確認
  - `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts` — 126 行が `pruneTasks(h, userId)[0]?.dueAt` を `barrier?.retainUntil` と比較する。**pending 行なので値は不変**だが、判別共用体化で `state` 絞りが要る。確認して結論を残す（誤って書き換えない）
  - `packages/core/src/application/usage/__tests__/deleteQuota.test.ts` — **直接の `schedule` 呼び出しは無い**（67 行はデコレーター、無変更）。触るのは 103-107 行の `tasks` ヘルパの生行観測だけで、読むのは `kind` と件数（184 / 191 / 196 / 215 行）に限られる。`dueAt` を読まないので判別共用体化の影響を受けない見込み — 確認して変更不要なら理由を残す
  - `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — **306 行の `schedule` にだけ priority**（174 行はデコレーター、無変更）。生行観測は 200-204 行の `tasks` ヘルパ経由で、274 行（`kind` / `operationId` / `payload`）・319 / 352 行（`attempt`）は共用体化の影響を受けず、**353 行の `dueAt` 読みだけ `state` 絞りが要る**
- **変更内容:** 上記の追随に加えて **AC-13**: `RunDueScopeTasksOptions.handlers` に「呼ばれた回数を数えるだけで settle しないハンドラ」を注入し、その kind の行に対して同じ clock で `runDueScopeTasks` を 2 回続けて実行 → (1) カウント 1、(2) 2 本目の `processed` が 0、(3) 生行の `attempt` / `dueAt` が 1 本目の claim 直後から不変、を assert する。対で `clock.advance(SCOPE_TASK_LEASE_MS)` 後の 3 本目でカウントが 2 になることも置く（AC-8 の application 層側の裏取り）
- **注意:** 実装済み 4 kind の継続経路（`deleteFilesByOwner` / `prunePersonalCleanupBarriers` など）は自分の turn の中で `schedule({ dueAt: now })` を撃って同じ行を再武装するため、リースはその時点で解除される。素の既存ハンドラで「2 回目は走らない」を書くとテストが落ちるか、逆に「complete して行が消えたから 1 回」というリースと無関係な理由で緑になる。settle しないハンドラを注入するのはそのため
- **理由:** Issue の「同時実行」の影響（負けた側が空振りして不要な backoff を掛ける）を、症状（attempt / dueAt が焼かれない）ごと application 層で押さえる

### 11. `spec` にリース列・リース索引・lease 込みの Alarm 起床規則を書く

- **対象ファイル:** `spec/database/index.md`（`#### scheduled_tasks` 節、956-973 行）、`spec/platform/index.md`（「Scope Alarm」節、177 行の `setAlarm()` 文と 184 行の Alarm handler 規則 4）
- **変更内容（`spec/database`）:** 列表に `lease_expires_at`（integer, `status='running'` のとき NOT NULL / 他状態では NULL — `jobs.lease_expires_at`（636 行）と同じ体裁）を足し、注記を 4 点加える。(1) `status='running'` の行は `lease_expires_at` までクレーム中で、`lease_expires_at <= now` になった行は再 claim 可能。`due_at` / `attempts` / `priority` / `payload` は claim 前のまま保つ、(2) 候補は `status='pending' AND due_at <= now` または `status='running' AND lease_expires_at <= now`、(3) `due_at` は状態によらず実行予定時刻を意味する（`spec/platform/index.md:186` の「priority 0 の最古 task age 1 分」SLO がこれに依存する）、(4) Alarm 起床時刻は pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方（規則の正本は `spec/platform` の Scope Alarm 節）。**索引行（973 行）に 1 本足す**: `scheduled_tasks_lease_idx` (`lease_expires_at`) WHERE `status='running'` — リース失効行の回収と Alarm 起床時刻の導出用。既存の値域・分類・順序・`status` 3 値・既存 2 索引の記述には触れない
- **変更内容（`spec/platform`）:** 177 行の「…の最小 `due_at` を `setAlarm()` する」と 184 行の規則 4「最後に次の最小 `due_at` を Alarm へ設定する」を、**どちらも「pending の最小 `due_at` と running の最小 `lease_expires_at` のうち小さい方」**へ広げる。1 句ずつの追加で、`scheduled_tasks` の列名を使う以外に新しい語彙は持ち込まない。181 行の WRR 規定・186 行の SLO と 1 turn 100 行 / CPU 2 秒には触れない
- **あわせて確認（AC-14(b)）:** Alarm 起床を述べる spec の出現は `spec/platform` の 2 か所だけではない。`spec/adr/021-scope-sharded-data-plane.md:88` も「各 scope object は `scheduled_tasks` に … 回収予定を保存し、**最も早い時刻に 1 つの alarm を設定する**」と書いており、CLAUDE.md が `spec/adr/` を「いま有効な設計判断」の正本とする以上、#11 がここから入る経路も現実にある。**改訂は不要**（「最小 `due_at`」ではなく「最も早い時刻」としか書いておらず列名を挙げないので、リース失効時刻を含む導出と矛盾しない）が、AC-14(b) が「spec 内で矛盾しない」を基準にしている以上、**「ADR 021:88 は列名を挙げていないので改訂不要」と 1 行の結論を残す**（残す先は本ステップの作業記録＝ ADR-008 Decision の末尾か、`spec/platform` 改訂時のコミットメッセージ）。これで基準の検証が全出現に対して行われたことになる
- **注意:** `spec/database` 側だけを直すと、同じ振る舞いについて 2 つの spec ファイルが違うことを言う状態が残る。実害は #11 に落ちる — `spec/platform` だけを読んだ実装者は Alarm を `due_at` だけで張り、**リース失効した `running` 行を誰も起こさない**（参照ランタイムは 1 秒 tick のポーリングなので露見しないが、DO は Alarm 駆動）
- **理由:** AC-14 / adr.md ADR-002・ADR-008。リースの保存表現はポート契約の外にあり、`spec/database` が D1 / DO スキーマの正本・`spec/platform` が Alarm 規則の正本。両方に置かないと #11 は「列はあるが誰も起こさない」実装に着地しうる

### 12. 仕上げ

- **対象ファイル:** リポジトリ全体
- **変更内容:** `pnpm typecheck && pnpm lint:fix && pnpm format` を通し、`pnpm test` を緑にする。ポート JSDoc に**縮退記述 3 文（single writer 前提 / `dueAt` が並び順の全て / priority と lease は先送り。ステップ 1 の列挙）がいずれも残っていないこと**、コメントが CLAUDE.md の方針（WHY だけ）に沿っていることを確認する。#11 へ引き継ぐ 4 点（plan.md「含まれないもの」）が spec / ポート JSDoc に残っているかを確認し、ポート JSDoc に載らない②（fencing を未決着のまま複数 writer を配備しない）と④（round 内 budget 配分は未変更）を #11 のコメントとして投稿する
- **理由:** AC-15 / AC-16
