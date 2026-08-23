# レビュー 003 — Adapter（memory 実装 + 適合スイート）

ゼロベースで再レビューした。memory 実装（`scopeTaskSelection.ts` / `repositories/scopeTaskScheduler.ts` / `scopeTaskQueue.ts` / `store.ts`）は境界条件を手トレースしても正しく、指摘は 0 件。前ラウンドの適合スイート指摘（`complete` on running / `listDue` のリース失効復帰 / `leaseMs` 引数）は**ミューテーションで実際に赤になることを確認**した（下記「前ラウンド指摘の実効性確認」）。

残る問題は、**`attempt` と `failed` の会計**を規定する 2 つの契約文が、スイートを通っても一切検証されないことに集中している。どちらも本 PR がポート JSDoc の遷移表として新たに書き下ろした契約であり、Issue の目的（「#11 が D1 / DO を書く前提となる契約を確定させる」）に直接掛かる。指摘はすべてコードを一時的に壊して赤/緑を確認済みで、作業ツリーは元に戻してある（`git status` clean）。

## Adapter

### Blockers

- **[B-001]** `schedule` が `attempt` を `0` に戻すことを、スイートが**まったく拘束していない**。しかも「拘束しているように読める」ケースが 2 本ある
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:371`（"re-arms a running row on schedule…" の `expect(claimed[0]?.attempt).toBe(0)`）/ `:524-526`（"parks a task as failed…" の `// Rescheduling revives a failed row as a fresh attempt.`）。契約側は `packages/core/src/application/ports/scopeTaskScheduler.ts:108`（`schedule | … | pending, dueAt = input.dueAt, attempt = 0, …`）と `:116-117`（"Only `schedule` brings a `failed` row back, and **it resets `attempt` to `0`**"）
  - 理由: `:371` の assert が見ている行は「schedule → claim」しか経ておらず `attempt` は元から `0` なので、リセットが起きても起きなくても `0` になる。`:524-526` は `failed` 行（`attempt = 8`）を `schedule` で復活させるが、claim できることしか見ておらず `attempt` を読まない。**実測: memory の `schedule` を `attempt: table.get(key)?.attempt ?? 0`（既存 `attempt` を温存）に変えると、`packages/core/src` + `apps/web` が 953 passed / 0 failed で全緑**。つまりリポジトリ全体のどのテストもこの契約を見ていない。
    この形は #11 が最も踏みやすい: `INSERT … ON CONFLICT DO UPDATE SET status='pending', due_at=?, priority=?, payload=?` から `attempts = 0` を落とすのは 1 語の抜けで、型でも lint でも捕まらない。帰結は 2 つあり、どちらも復旧経路が無い。(1) `failed` 行を `schedule` で復活させても `attempt` が上限のままなので、最初の `backoff` で即 `failed` へ戻る＝**契約が唯一の復帰経路と定めた `schedule` が機能しない**。(2) reference runtime でも到達する: `deleteFilesByOwner` / `deleteQuota` は 1 ページごとに `schedule` で次の継続を積むので、削除全体を通じて transient 失敗が累計 8 回起きた時点で行が恒久 `failed` になり、`ports/scopeTaskScheduler.ts:148-150` が自ら書くとおり account が `deleting` のまま残る。本来は「ページが 1 枚進むたび attempt はリセットされる」という設計。
    ADR 026 §1 が名指しした失敗モード（liveness に関わる状態遷移がポート定義にしか無く、実行形が無い）そのもの。
  - 提案: `:524-526` の復活ケースで `attempt` を読む。`await schedule("op-1", -MINUTE_MS); const revived = await claim(10); expect(revived[0]?.attempt).toBe(0);` の 1 行で足りる（現在の `toHaveLength(1)` は `revived` 経由で保てる）。`:371` の assert は「元から 0」なので残しても害は無いが、実質の拘束は復活ケース側に置くこと

- **[B-002]** 「`failed` 行を戻せるのは `schedule` だけ」の**`backoffOrSchedule` 側が拘束されていない**。`backoffOrSchedule` が `failed` 行を `pending` へ蘇らせる実装でも、スイートは全緑で通る
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:499-527`（"parks a task as failed once the attempt cap is reached"）。契約側は `packages/core/src/application/ports/scopeTaskScheduler.ts:112`（`backoffOrSchedule | absent / pending / running / **failed** | … then backs off as above`）と `:116`（"Only `schedule` brings a `failed` row back"）
  - 理由: `:517-522` で追加されたのは `backoff` の 1 本だけで、`backoffOrSchedule` を `failed` 行へ撃つ経路はスイートのどこにも無い。**実測: memory の `backoffOrSchedule` を「既存行が `failed` なら不在扱いにして mint し直す」に変えると `packages/core/src` は 884 passed / 0 failed で全緑**。
    この分岐は #11 で「最も自然な SQL」がそのまま踏む: `backoffOrSchedule` を `INSERT … ON CONFLICT DO UPDATE SET status='pending', attempts=attempts+1, due_at=?` と 1 文で書けば、`failed` 行は無条件に `pending` へ戻る。帰結は poison 行が永久に retry し続けること — `ports/scopeTaskScheduler.ts:124-126` が `SCOPE_TASK_MAX_ATTEMPTS` を置いた理由（"one permanently failing target must not breed continuations forever"）が失われる。
    本番到達性もある: `backoffOrSchedule` は「operation の最初の command が task ではなく event で来る」経路の受け口（同 `:131-134`）なので、`failed` 行が残っている同じ `(kind, operationId)` に対して event 経由で `deleteFilesByOwner` が再入すれば、この分岐に入る。
  - 提案: B-001 と同じケースの `:522` 直後に 1 本足す。`await scheduler.backoffOrSchedule({ kind: "usage.userCleanupContinued", operationId: "op-1", priority: ScopeTaskPriority.securityCleanup, payload: {}, now: backend.clock.now() }); backend.clock.advance(365 * 24 * 60 * MINUTE_MS); expect(await claim(10)).toEqual([]);`。B-001 の復活 assert はその後ろに置けば 1 ケースで両方を拘束できる

### Warnings

- **[W-001]** `backoffOrSchedule` が mint 時に `input.priority` を使うことが拘束されていない
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:471-497`（契約は `packages/core/src/application/ports/scopeTaskScheduler.ts:112` の "mints the row with `input.priority`, `input.payload` and `dueAt = input.now` when absent"）
  - 理由: mint を見る唯一のケースが `ScopeTaskPriority.securityCleanup`（= `0`）で mint し、しかも claim 後に `priority` を読まない。**実測: memory の mint を `priority: 0` 決め打ちに変えても適合スイートは 270 passed / 0 failed で全緑**。`payload` と `dueAt` は同ケースが押さえている（`:479-485`）のに `priority` だけ穴が残っている。本 PR の主題が priority である以上、5 操作のうち 1 つで priority の入力経路が実行形を持たないのは中途半端。本リポジトリの `backoffOrSchedule` 呼び出しは `deleteFilesByOwner.ts:95` の 1 か所で `securityCleanup` 固定なので実害は無く、掛かるのは #11 側
  - 提案: `:472-478` の mint を `ScopeTaskPriority.expiryCollection` に変え、`:484` の近くに `expect(claimed[0]?.priority).toBe(ScopeTaskPriority.expiryCollection)` を足す（既存 assert はそのまま通る）。`:488-496` の「既存行は backoff される」半分は priority 非依存なので影響しない

- **[W-002]** `listDue` のリース失効復帰（B-002 として前ラウンドで追加された liveness 契約）が、別の名前のケースの末尾に同居している
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:555-605`（"reserves a slot across scopes, so a scope holding only low priority is still listed"）
  - 理由: このケースは名前が謳う (1) scope 横断の予約枠に加えて、(2) リース中の行が `listDue` から消えること、(3) **リース失効後に再び載ること**の 3 性質を順に見る。(3) は「停止した writer の scope を中央 runner が再発見する唯一の経路」（`ports/scopeTaskQueue.ts:22-26`）で、スイート中ここにしか無い。ところが (1) の assert（`:574-577`）が落ちるとケースはそこで止まり、(3) は実行すらされない。名前も失敗レポートも「予約枠」としか言わないので、`listDue` の復帰契約が壊れたときに何が壊れたのか読み取れない。前ラウンドの修正が既存ケースへの追記で行われた結果、1 ケースの焦点が 3 つに散っている
  - 提案: `:590-604`（`advance(SCOPE_TASK_LEASE_MS)` 以降）を独立したケースへ切り出す（例: "lists a scope again once the lease on its rows lapses"）。claim までの前提は数行なので重複コストは小さい

## 前ラウンド指摘の実効性確認（ミューテーション）

いずれも memory 実装を一時的に壊し、`pnpm exec vitest run packages/core/src/adapters` の赤/緑を実測した。作業ツリーは毎回 `git checkout` で復元済み。

| ミューテーション | 結果 | 対応する前ラウンド指摘 |
| --- | --- | --- |
| `complete` を running 行に対する no-op にする | **1 failed**（"completes and backs off a running row by key alone"） | 002 B-001 修正済み — `:389` の `advance(SCOPE_TASK_LEASE_MS)` が効いている |
| `listDue` の述語を `pending && dueAt <= now` に落とす | **1 failed**（"reserves a slot across scopes…"） | 002 B-002 修正済み |
| `claimDue` が `leaseMs` 引数を捨てて定数を使う | **1 failed**（"holds a claimed row for the leaseMs it was given…"） | 002 W-001 修正済み |
| `backoff` が running 行のリースを解放しない（`running` のまま `dueAt` だけ動かす） | **2 failed**（"backs off the same row exponentially…" / "backs off a row that does not exist yet by minting it"） | `complete` 側の修正で `advance(LEASE)` が入っても、backoff 側の拘束は別ケースが保っている。穴なし |
| `schedule` が既存 `attempt` を温存する | **0 failed / 953 passed（全リポジトリ）** | B-001 |
| `backoffOrSchedule` が `failed` 行を mint し直す | **0 failed / 884 passed** | B-002 |
| `backoffOrSchedule` の mint priority を `0` 決め打ちにする | **0 failed / 270 passed** | W-001 |

## 指摘に至らなかった確認結果

- **選択アルゴリズム（`scopeTaskSelection.ts:32-53`）**: 手トレースで契約と一致。`ordered` が `(priority, dueAt, kind, operationId)` 昇順なので同 priority が連続し、`reservedPriority` に直前の priority だけを持つ 1 パスは「各クラスの最小行を 1 件ずつ」と厳密に等価。`reservedPriority` の初期値 `null` は priority `0` と `===` で衝突しない。境界を個別に確認: `limit <= 0` → 早期 `[]`；`limit` < クラス数（p0..p3 各 1 件・`limit: 2`）→ 予約ループが打ち切られ厳密 priority 順の `[p0, p1]`；1 クラスのみ（p0 × 10・`limit: 10`）→ 予約 1 + 充填 9 = 10 件で予約枠が上限にならない；p0 × 5 + p3 × 1・`limit: 3` → `[p0-0, p0-1, p3]`；p0 に `dueAt` 違い 2 件 + p3 1 件・`limit: 2` → `[p0-early, p3]` で返却集合が一意。返却は `ordered.filter(…)` なので `Set` の挿入順ではなく必ず比較子順。計算量は 1 ソート + 3 走査
- **判別共用体（`store.ts:324-342`）**: `pending = dueAt` / `running = dueAt + leaseExpiresAt` / `failed = 時刻なし` で illegal state を型で排除。`schedule` / `claimDue` / `backedOff` の全分岐が spread ではなくフィールド列挙で、`failed` に `dueAt` / `leaseExpiresAt` が残留する経路は無い。`repositories/scopeTaskScheduler.ts:125-128` の WHY コメント（excess property check を spread が擦り抜ける）は非自明な制約の記録で妥当
- **`scopeTaskQueue.ts`**: 書き込みゼロ。scheduler と同一の述語 `isScopeTaskDue` と同一の `selectDueScopeTasks` を借りるだけで、`limit <= 0` も共有関数 1 か所に集約されている（AC-10 の「1 つの純粋関数」を満たす）。読み取り専用であること自体もスイートが拘束している（`:546-552` で `listDue` 2 連発、`:573-582` で `listDue` の後に `claim(10)` が 3 件返る）
- **リース / reclaim**: 失効判定は `leaseExpiresAt <= now`（`repositories/scopeTaskScheduler.ts:29`）で `spec/database/index.md` の追記および `pending` 側の `dueAt <= now` と非対称でない。境界はスイート `:253-259` が `leaseMs - 1` / `leaseMs` の両側で拘束。reclaim は `attempt` / `dueAt` / `priority` / `payload` を持ち越して新しいリースだけ張り直す（`:80-93`）
- **clock のポート化**: 3 ファイルとも `Date.now()` / 引数なし `new Date()` を持たない（grep 済み）。`new Date(now.getTime() + leaseMs)` は引数由来の算術のみ
- **UoW ロールバック**: claim の書き戻しは `MemTable.set`（`store.ts:114-128`）経由で undo ログに乗る。`__tests__/unitOfWork.test.ts:112-133` の追加ケースが「claim した UoW が throw → 行が `pending` へ戻り再 claim できる」まで見ており、実効的。kick が claim で増えないことも `scopeUnitOfWork` の観測ラッパーが `schedule` にしか被っていない設計と 1 対 1
- **スイートが memory の実装詳細に依存していないか**: 生行を覗くケースは無く、観測は返る/返らない/順序/`attempt`/`payload`/`priority`/`leaseExpiresAt` に閉じている（ADR 026 §3 適合）。scope 横断の tie は `ports/scopeTaskQueue.ts:32-36` が未規定と明示し、ケースは tie を避けて組んである
- **kind → priority の割り当て**: `storage.ownerDeleteContinued`（`deleteFilesByOwner.ts:98,113`）/ `usage.userCleanupContinued`（`deleteQuota.ts:78`）/ `identity.personalCleanupHandoverContinued`（`scopeTaskRunner.ts:63`）= `securityCleanup`、`identity.personalBarrierPruneContinued`（`personalCleanup.ts:65,107`）= `expiryCollection`。plan.md の分類どおり
- **spec と実装の整合**: `spec/database/index.md` の追記（候補述語 2 分岐・再 claim の保存項目・`due_at` の意味・部分索引 3 本）はいずれも memory 実装と一致
- **`SCOPE_TASK_MAX_BACKOFF_MS` の上限がスイートで拘束されていない**点は認識したが、本 PR は backoff の計算に触れておらず main 時点からの既存の穴なので指摘に数えない
- **コメント**: 担当範囲のコード・テストに、修正の経緯・レビューへの弁明・「Round N で追加」の類は無い。適合スイートに増えたコメントはいずれも「このケースが何を弁別するか」を書いたもので、`packages/core/src/adapters/conformance/scopeTaskScheduler.ts:237-239, 263-265, 305-307, 324-325, 386-388, 590-592` はすべて非自明な WHY に該当する
- **スコープ逸脱**: 担当ファイル内に plan.md の「含まれないもの」を越える変更は無い（`last_error`・attempt 上限の運用イベント・D1/DO 実装はいずれも未着手のまま）

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`（後 2 者は契約の正本として通読。ポート設計そのものの評価は port-application 観点の持ち分）
- 参考読み（契約整合の判断に必要だった差分外／担当外ファイル）: `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `spec/adr/026-port-contract-and-conformance.md`, `docs/test.md`
- スキップ: `.thread/19/**` — このPRの計画・レビュー足場（Phase 7 で削除）。カバレッジ対象外
- スキップ: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts` — ランタイム / env 配線で runtime 観点の持ち分
- スキップ: `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — application 層のテストで application 観点の持ち分（ミューテーションの波及範囲確認にのみ使用）
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — spec 観点の持ち分（memory 実装との整合確認のためリース節のみ読了）
