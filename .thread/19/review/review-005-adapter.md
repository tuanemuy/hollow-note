# レビュー 005 — Adapter（memory 実装 + 適合スイート）

ゼロベースで再レビューした。ポート JSDoc の遷移表 5 操作 × from-state × 観測属性を自分で列挙し直し、拘束しているケースを 1 セルずつ突き合わせた（下記「セル照合」）。Round 4 の W-001（`schedule` × 既存 `pending` 行の `dueAt` / `priority` 上書き）は実効的に閉じている — ミューテーションで実証済み。

memory 実装そのもの（選択アルゴリズム・判別共用体・リース / reclaim・UoW ロールバック・read-only な `listDue`）は境界条件を手でトレースしても正しく、指摘は無い。

残った未拘束セルは 1 つ、`ScopeTaskQueue.listDue` の**負の `limit`** だけ。ミューテーションで実証したので Warning として挙げるが、深刻度は低く修正は 1 行。

ミューテーションは 3 本走らせ、いずれも実行後に元へ戻した。最終確認時点で `git status` / `git diff --stat` ともに差分ゼロ、`pnpm exec vitest run packages/core/src` が 889 passed / 3 skipped。

## Adapter

### Blockers

- なし

### Warnings

- **[W-001]** `ScopeTaskQueue.listDue` の「`limit <= 0` は空配列」のうち、**負の `limit`** をどのテストも拘束していない
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:92-100`（"returns nothing for a limit of zero or less"）。契約側は `packages/core/src/application/ports/scopeTaskQueue.ts` の「Input bounds: `limit <= 0` returns an empty array.」（AC-10 が `claimDue` と `listDue` の両方に要求）
  - 理由: このケースは `claim(0)` / `claim(-1)` / `listDue(…, 0)` の 3 本を assert しているが、`listDue` 側だけ **0 しか通していない**。ケース名は "zero or less" と両方を名乗っているので、読んだだけでは穴に見えない。
    **実測: `adapters/memory/scopeTaskQueue.ts` の `listDue` を「`limit < 0` なら全件返す」に変えても `packages/core/src` は 889 passed / 0 failed で全緑**（`claim(-1)` は共有関数側の `limit <= 0` に当たるので赤くならない）。memory は AC-10 のとおり `selectDueScopeTasks` 1 本に集約しているため 0 のケースが負も兼ねてしまうが、**この等価性はバックエンドの実装特性であって契約ではない** — #11 の D1 / DO は `claimDue` と `listDue` が別クエリになる。
    #11 が踏む形は SQLite / D1 の `LIMIT -1` が「無制限」を意味すること。`LIMIT ?` に負値を素通しした実装は `listDue(…, 0)` のケースを自然に通り（`LIMIT 0` は 0 件）、負値だけがバックログ全件を返す。現在の呼び出し側（`runDueScopeTasks` は `budget` が 0 以下になる前に break する）は負値を渡さないので実害は今日は無く、Blocker には数えない
  - 提案: `:99` の `listDue(…, 0)` の直後に 1 行足すだけでよい（上記ミューテーション下で赤、現行実装で緑）

    ```ts
    expect(
      await backend.scopeTaskQueue.listDue(backend.clock.now(), -1),
    ).toEqual([]);
    ```

## Round 4 で追加されたケースの判定 — 実効的、かつ既存ケースを濁していない

対象: `adapters/conformance/scopeTaskScheduler.ts:367-388`「re-arms a pending row on schedule, taking the new dueAt, priority and payload」。

**実測: memory の `schedule` を「既存行が `pending` なら `dueAt` と `priority` を温存する」に変えると、`packages/core/src/adapters/memory` の 247 ケース中この 1 件だけが赤**。Round 4 が「このミューテーションで全緑」と記録した状態から、狙いどおり 1 本だけで穴が閉じたことを確認した。

焦点のぼやけについても問題無し。

- 隣接する `:348-365`（"upserts on (kind, operationId)…"）とは見ている属性が重ならない。あちらは「行が増えない・payload が最後の書き込みになる」、こちらは「`dueAt` / `priority` が入力で置き換わる」
- `:390-413`（running 版）と対になっており、`pending` / `running` のどちらか片方だけ正しいバックエンドが緑にならない
- ケース内のコメント `:370-373` は「なぜ `dueAt` を未来へ動かすのか」（過去のままだと上書きの有無を弁別できない）という非自明な WHY で、修正の経緯や指摘への弁明ではない

## セル照合（遷移表 × 観測属性を自分で列挙し直した結果）

行番号は `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`。

| 操作 × from | 属性 | 拘束しているケース |
| --- | --- | --- |
| `schedule` × absent | pending 化 / `dueAt` / `attempt = 0` / `priority` / `payload` | `:69`, `:102` |
| `schedule` × pending | `dueAt` / `priority` / `payload` 上書き | `:367`（Round 4 追加）, `:348`（payload） |
| `schedule` × running | `dueAt` / `priority` / `payload` / リース解放 | `:390` |
| `schedule` × failed | `attempt = 0` で復活 | `:579` |
| `claimDue` × pending(due) | running 化 / `leaseExpiresAt = now + 引数 leaseMs` / 境界 `<=` | `:69`, `:248`（`leaseMs - 1` と `leaseMs` の両側） |
| `claimDue` × pending(未 due) | 候補外 | `:69` |
| `claimDue` × running(リース有効) | 候補外（再 claim / `listDue` の双方から不可視） | `:248`, `:274`, `:639` |
| `claimDue` × running(リース失効) | reclaim / `dueAt`・`attempt`・`priority`・`payload` 不変 / 新リース張り直し | `:274` |
| `claimDue` × failed | 候補外（両 read） | `:544` |
| 選択規則 | priority 優先 / 返却順 / 予約枠が下限 / 上限でない / limit < クラス数の縮退 / 予約行はクラス内最小 / tie は (kind, operationId) | `:102`, `:132`, `:158`, `:182`, `:196`, `:219`, `:326` |
| 選択の副作用範囲 | limit 超過分はリースを取らない | `:326`（2 回目の claim が残り 2 件を返す） |
| 入力境界 | `claimDue` の `limit = 0` / `limit < 0`、`listDue` の `limit = 0` | `:92` |
| 入力境界 | **`listDue` の `limit < 0`** | **なし → W-001** |
| `complete` × pending | 行削除 | `:469` |
| `complete` × running | 行削除（リース跨ぎで観測） | `:415` |
| `complete` × failed | 行削除 → キー解放（mint し直せる） | `:592` |
| `complete` × absent | no-op | `:469` |
| `backoff` × pending | `attempt + 1` / 指数（×2）/ `priority`・`payload` 不変 | `:485`, `:274` |
| `backoff` × running | `attempt + 1` / `dueAt` 押し出し / リース解放 | `:485` の 2 回目, `:415` |
| `backoff` × failed | failed のまま（`attempt` は上限超えで登り続けるが観測不能） | `:555` |
| `backoff` × absent | no-op | `:469` |
| `backoff` 上限 | `SCOPE_TASK_MAX_ATTEMPTS` で failed / 両 read から不可視 | `:544` |
| `backoffOrSchedule` × absent | `input.priority` / `input.payload` / `dueAt = input.now` で mint → backoff | `:512` |
| `backoffOrSchedule` × pending | 既存 `priority` / `payload` を保つ | `:436` |
| `backoffOrSchedule` × running | `attempt + 1` / `dueAt` 押し出し / リース解放 | `:512` 後半（`advance(2 * BASE)` はリース 5 分より短いので解放も同時に拘束） |
| `backoffOrSchedule` × failed | failed のまま | `:555` |
| `listDue` | scope 横断の選択規則 / 予約枠 / リース不可視 / 失効後の復帰 / `limit` | `:613`, `:639`, `:675` |

`backoff` × running のリース解放は Round 4 の記録を鵜呑みにせずミューテーションで再確認した（下表 2 行目）。

## ミューテーション実測

いずれも memory 実装を一時的に壊して赤/緑を実測し、毎回 Edit で復元した（最終 `git status` 差分ゼロ）。

| ミューテーション | 結果 | 意味 |
| --- | --- | --- |
| `schedule` が既存 `pending` 行の `dueAt` / `priority` を温存する | `adapters/memory` **1 failed / 246 passed**（赤は `:367` のみ） | Round 4 追加ケースが実効的で、かつ最小 |
| `backoff` / `backoffOrSchedule` が `running` 行のリースを解放しない（`running` のまま `attempt` だけ進める） | 適合スイート **2 failed**（`:485`「backs off the same row exponentially」/ `:512`「backs off a row that does not exist yet」） | `backoff` × running のリース解放は拘束済み。Round 4 の記録は正しい |
| `listDue` が `limit < 0` を「無制限」と読む | `packages/core/src` **0 failed / 889 passed** | W-001 の実証 |

## 指摘に至らなかった確認結果

- **選択アルゴリズム（`adapters/memory/scopeTaskSelection.ts:32-53`）**: `ordered` が `(priority, dueAt, kind, operationId)` 昇順なので同 priority が連続し、直前 priority だけを保持する 1 パス（`reservedPriority`）は「各クラスの最小行を 1 件ずつ」と厳密に等価。初期値 `null` は priority `0` と `===` で衝突しない。境界を個別にトレース: `limit <= 0` → 早期 `[]`；`limit` < クラス数 → 予約ループが打ち切られ厳密 priority 順へ縮退（p0..p3 各 1 件・`limit: 2` → p0, p1）；1 クラスのみ → 予約 1 + 充填で `limit` 全部（p0 × 10・`limit: 10` → 10 件）；p0 × 5 + p3 × 1・`limit: 3` → 予約 {p0-0, p3} のあと充填で p0-1 が入り `[p0-0, p0-1, p3]`；充填ループは既選択行を `add` し直しても `size` が増えないので二重計上が無い；返却は `ordered.filter` なので `Set` の挿入順ではなく必ず比較子順。`compareStrings`（`support.ts:127-128`）は素の符号位置比較で SQL の BINARY 照合と一致する。`Set<T>` の同一性はオブジェクト参照だが、候補は `MemTable.values()` のコピー（`claimDue`）か毎回 `map` で作る新規オブジェクト（`listDue`）なので重複参照が生じない
- **判別共用体（`adapters/memory/store.ts:324-342`）**: `pending = dueAt` / `running = dueAt + leaseExpiresAt` / `failed = 時刻なし`。`schedule`（`:60-68`）/ `claimDue`（`:81-90`）/ `backedOff`（`:129-149`）/ `backoffOrSchedule` の合成行（`:111-119`）の全分岐がフィールド列挙で、spread による残留フィールドの経路は無い。`repositories/scopeTaskScheduler.ts:125-128` の WHY コメントが excess property check の穴を記録している。`backoffOrSchedule` が合成する仮の `pending` 行の `dueAt: input.now` も `backedOff` を通って捨てられるので残留しない。`toScopeTask` は `Extract<…, { state: "running" }>` しか受け取らないので、リース未設定の行から `ScopeTask` を作る経路が型で塞がれている
- **`scopeTaskQueue.ts`**: 書き込みゼロ（`table.set` / `delete` の呼び出し無し）。scheduler と同一の述語 `isScopeTaskDue` と同一の `selectDueScopeTasks` を借りるだけ。read-only であること自体もスイートが拘束している（`:639` で `listDue` の後に `claim(10)` が 3 件返る）
- **リース / reclaim**: 失効判定は `leaseExpiresAt <= now`（`repositories/scopeTaskScheduler.ts:22-30`）で `pending` 側の `dueAt <= now` と対称。境界は `:248` が `leaseMs - 1` / `leaseMs` の両側で拘束。reclaim は元行のフィールドをそのまま持ち越して `leaseExpiresAt` だけ張り直すので `attempt` を消費せず `dueAt` も動かさない（`:274` が両方を assert）。`leaseMs` が引数由来であることは `:248` が既定値以外（2 分）で claim して拘束している
- **clock のポート化**: `scopeTaskSelection.ts` / `repositories/scopeTaskScheduler.ts` / `scopeTaskQueue.ts` に `Date.now()` も引数なし `new Date()` も無い。生成されるのは `new Date(now.getTime() + leaseMs)` と `new Date(now.getTime() + backoffDelayMs(attempt))` の 2 か所だけで、どちらも引数由来
- **UoW ロールバック**: claim の書き戻しは `MemTable.set`（`store.ts:114-128`）の undo ログに乗り、行は不変スナップショットとして扱われるので前参照の復元で十分。`__tests__/unitOfWork.test.ts` の新ケース（「claim した UoW が throw → 行が `pending` へ戻り、次の UoW が再 claim できる」）が実効的で、生行の `state` を覗くのも memory ローカルテストとして正しい置き場所。claim が scope-task トリガーを増やさないことも、観測ラッパーが `schedule` にしか被っていない設計（`scopeUnitOfWork.ts:62-70`）と 1 対 1 で対応している
- **スイートのバックエンド中立性**: 適合スイートに生行を覗くケースは 1 件も無く、観測は「返る / 返らない / 順序 / `attempt` / `payload` / `priority` / `leaseExpiresAt`」に閉じている（ADR 026 §3 適合）。`leaseExpiresAt` の厳密一致 assert は `now` がポート引数なので backend 中立。scope 横断の tie は `ports/scopeTaskQueue.ts` が「未規定」と明記し、ケースは tie を避けて組んである（`:639` は dueAt が -10 分 / -1 分で衝突しない）
- **`dueAt == now` を due とする境界**が適合スイートに独立ケースを持たない点は Round 4 と同じく認識した。`:274` の `schedule("op-early", 0)` が `backoff` 経由で過去へ押し出されるため厳密不等号実装を弾く保証にはならないが、`dueAt` は必ず過去に置かれて実クロックが進むので滞留する経路が作れず、指摘には数えない
- **コメント**: 担当範囲に修正の経緯・指摘への弁明・メタ情報の類は無い。適合スイート `:249-251`, `:275-277`, `:306-307`, `:317-319`, `:336-337`, `:370-373`, `:395-397`, `:405-407`, `:427-429`, `:513-515`, `:548-549`, `:558-562`, `:584-586`, `:597-599`, `:664-665`, `:682-684` はいずれも「そのケースが何を弁別するか」の WHY。`repositories/scopeTaskScheduler.ts:13-15` / `:125-128`、`store.ts:326-331`、`scopeTaskSelection.ts:21-31` も同様
- **スコープ逸脱**: 担当ファイル内に plan.md の「含まれないもの」を越える変更は無い（`last_error`・attempt 上限の運用イベント通知・D1 / DO 実装はいずれも未着手のまま）
- **既出判定**: triage-keys.md の 2 件（`running` 行への `backoffOrSchedule` 未拘束 / `Date` の防御コピー）は蒸し返していない。W-001 はどちらとも別セル（`listDue` の入力境界）

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`（後 2 者は契約の正本として通読。ポート設計そのものの評価は port-application 観点の持ち分）
- 参考読み（契約整合の判断に必要だった担当外ファイル）: `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `spec/adr/026-port-contract-and-conformance.md`, `docs/test.md`, `.thread/19/plan.md`, `.thread/19/review/triage-keys.md`, `.thread/19/review/review-004-adapter.md`
- スキップ: `.thread/19/**` — このPRの計画・レビュー足場（Phase 7 で削除）。カバレッジ対象外
- スキップ: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts` — ランタイム / env 配線で runtime 観点の持ち分
- スキップ: `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — application 層のテストで application 観点の持ち分（ミューテーションの波及範囲確認にのみ使用）
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — spec 観点の持ち分（memory 実装との整合確認のためリース節・索引節のみ読了）
