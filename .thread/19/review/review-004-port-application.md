# レビュー 004 — Port Contract & Application

### Port Contract & Application

#### Blockers

なし

4 ラウンド目としてゼロベースで読み直した。今ラウンドの主眼である「再構成で契約の事実が落ちていないか」「到達不能 `break` の削除が安全か」を含め、実害のある欠陥は見つからなかった。検算した点を以下に残す。

**1. ポート JSDoc の再構成で契約の事実は落ちていない（ADR 026 §1 の粒度を維持している）**

Round 3 の指摘（W-001 / W-003 / W-004）の適用後、`ports/scopeTaskScheduler.ts` を「別バックエンドを実装するのに必要な事実」の観点で棚卸しした。以下がすべて揃っている:

- 行の同一性 = `(kind, operationId)` の upsert（`:60-64`）
- 状態集合（`pending` / `running` / `failed`）と 5 操作 × 全 from の遷移（`:102-108` の表）
- 候補述語 = `pending` かつ `dueAt <= now`、または `running` かつ `leaseExpiresAt <= now`（`:82-83`）
- 選択規則（予約 → 充填）・返却順・**返却件数上限**（`:80-96`。W-001 の "budget" は `limit` に統一され、"neither returns more than `limit` rows" が明記された）
- 排他の要求と、対話的トランザクションを持たないバックエンド向けの実現手段（`:72-78`）
- リースが advisory であること・fencing token が無いこと・`leaseMs` の帯（下限＝最悪ケース turn / 上限＝age SLO）（`:134-149`）
- 入力境界（`limit <= 0` / `leaseMs` が正）（`:151-153`）とエラー契約（`:155`）
- reclaim が attempt を消費せず `dueAt` を動かさないこと（`:117-120`）

削られたのは重複記述のみで、契約でない散文（旧 `:32-40` の「turn が `complete` / `schedule` / `backoffOrSchedule` のどれで settle するか」「throw した turn は runner が backoff する」）は `workers/scopeTaskRunner.ts:127-139` に移っており、バックエンド実装者が必要とする事実ではない。表と散文の突き合わせも行ったが（`backoff` の指数式・`failed` 化の閾値・reclaim の不変量・`schedule` のリース解放）、矛盾は無い。W-004 の保存表現（`status` / `due_at` / `lease_expires_at`）は述語がポート語彙へ書き直され、列名も spec への参照も残っていない。

**2. 到達不能 `break` の削除は安全（`claimed.length <= limit` は契約でも実装でも成立する）**

- 契約側: `:81` が "neither returns more than `limit` rows" と明記したので、上限は memory 実装の性質ではなく契約になった。
- 実装側: `adapters/memory/scopeTaskSelection.ts:42-51` の両ループとも `add` の前に `if (selected.size >= limit) break;` を置いており、`selected` は同一 Set なので `size <= limit` が保たれる。`limit <= 0` は先頭で早期 return。
- 呼び出し側: `runDueScopeTasks` は外側ループで `budget > 0` を確認してから `claimDue({ limit: budget })` を呼ぶので、内側ループの反復回数 `claimed.length <= budget` により `budget` は負に振れない。
- しかも `break` を消したことで、仮に非適合バックエンドが `limit` 超を返しても**全行が訪問される**（リースを握ったまま捨てられる行が出ない）方向に変わっており、削除前より安全側になっている。

**3. 適合スイートは実効的（ミューテーションで確認）**

`scopeTaskSelection.ts` を 2 か所壊して赤になることを確認し、作業ツリーは clean に戻した:

- 返却順のソートを外す（`ordered.filter(...)` → `[...selected]`）→ 1 件赤（AC-2 の返却順が拘束されている）
- 予約ループを「先頭 1 件だけ予約」に退化させる → 3 件赤（`reserves a slot for a low priority…` / `reserves the earliest row of each priority…` / `reserves a slot across scopes…`）。予約枠が下限として働くこと・予約が取る 1 件がクラス内最小であること・scope 横断でも同じ規則が効くことが、それぞれ別ケースで弁別されている。

application 層側も AC-11 / AC-13 が観測可能な形で拘束されている（`scopeTaskRunner.test.ts:209-242` / `:244-282`。後者はリース中の生行を `toEqual(claimed)` で丸ごと固定しているので `attempt` / `dueAt` の変化が漏れない）。

**4. 呼び出し側の追随と priority の値**

`personalCleanup.ts:65,107` = `expiryCollection`(3)、`deleteFilesByOwner.ts:98,113` / `deleteQuota.ts:78` / `scopeTaskRunner.ts:63` = `securityCleanup`(0)。plan.md の分類（`identity.personalBarrierPruneContinued` のみ 3、他 3 kind は 0）と一致。`ScopeTaskPriority` は `as const` 由来の `0 | 1 | 2 | 3` に閉じており、値域外は型で落ちる（AC-1）。

**5. UoW の 2 プレーン分離（ADR 023）**

`claimDue` の scope `run`、handler 内の scope `run`、`settleCleanupTurn` → `handOverPersonalCleanup` の global `run` はいずれも逐次で、ネストは無い。`scopeUnitOfWork.ts:62-70` の kick ラッパは `schedule` だけを観測しており、`claimDue` の書き込みでは kick しない（`memory/__tests__/unitOfWork.test.ts:103-114` が拘束）。ロールバック時に claim が pending へ戻ることも同テストで押さえられている。

**6. 回帰**

`pnpm exec vitest run packages/core/src/application packages/core/src/adapters` = 691 passed / 3 skipped で緑（AC-16 の該当分）。

#### Warnings

なし

補足（指摘には数えない）: `runDueScopeTasks` はラウンド開始時の `now` を全 scope の `claimDue` に使い回すため、ラウンド後半に claim される scope の実効リースは `leaseMs - 経過時間` になる。ポート JSDoc の `leaseMs` 下限は「the whole claimed batch, not one row」と 1 回の claim 単位で述べているので、厳密にはラウンド全体を覆う必要がある分だけ控えめな表現になっている。ただし参照ランタイムでは tick が `InProcessRelayTrigger` で直列化され（`adapters/node/inProcessRelayTrigger.ts:36-49`）、同一ラウンド内では `claimedScopes` により同じ scope を再 claim しないので、二重実行に至る経路は現状存在しない。実配備でラウンド構成が変わる #11 の再評価事項として置いておけば足り、本 PR で直す必要は無いと判断した。

スコープ越えの変更も確認したが、担当範囲に見当たらなかった。

#### カバレッジ

- 確認: `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/execution/unitOfWork.ts`, `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/memory/store.ts`（`ScheduledTaskRow` / `MemTable` のみ）, `packages/core/src/adapters/node/inProcessRelayTrigger.ts`（tick 直列化の確認のみ）, `apps/web/app/server.node.ts` / `apps/web/app/worker/node/runner.ts`（AC-17 の 1 本道の確認のみ）
- スキップ: `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts` — Adapter 観点の担当（ただし ADR 023 の kick / rollback 拘束としてのみ参照した）
- スキップ: `apps/web/.env.example`, `docs/runtime_node.md` — 運用ドキュメントで Runtime 観点の担当
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — Spec 観点の担当
- スキップ: `.thread/19/**` — このPRの計画・レビュー足場（Phase 7 で削除）
