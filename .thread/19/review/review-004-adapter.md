# レビュー 004 — Adapter（memory 実装 + 適合スイート）

ゼロベースで再レビューした。遷移表の 5 操作 × from-state × 観測属性を自分で列挙し直し、各セルを拘束しているケースを 1 件ずつ突き合わせた（下記「セル照合」）。前ラウンドの Blocker 2 件 / Warning 2 件はいずれも実際に閉じている（`revives a failed task on schedule` / `keeps a failed task failed through either retry variant` / mint priority の assert / `lists a scope again once the lease on its rows lapses` の独立ケース化）。

照合の結果、前ラウンドが申告した弱点（`backoffOrSchedule` × `pending`）**以外にもう 1 セル**、リポジトリのどのテストからも拘束されていない属性が残っていた。ミューテーションで実証済み。memory 実装そのもの（選択アルゴリズム・判別共用体・リース / reclaim・UoW ロールバック）は境界条件を手でトレースしても正しく、指摘は無い。

ミューテーションは毎回 `git checkout` で戻し、最終状態が clean であること・適合スイートが 224 passed に戻ることを確認済み。

## Adapter

### Blockers

- なし

### Warnings

- **[W-001]** `schedule` が**既存の `pending` 行**の `dueAt` / `priority` を上書きすることを、リポジトリのどのテストも拘束していない
  - 場所: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts:348-365`（"upserts on (kind, operationId)…" — 2 回目の `schedule` が 1 回目と同じ `dueAt`・同じ priority なので上書きが起きても起きなくても同じ結果）。契約側は `packages/core/src/application/ports/scopeTaskScheduler.ts` の遷移表 `schedule | absent / **pending** / running / failed | pending, dueAt = input.dueAt, …, priority = input.priority`（AC-9 の「`schedule` = 上書き」）
  - 理由: `schedule` の上書き属性を実際に弁別しているのは `:367-390`（"re-arms a **running** row on schedule…"）だけで、`pending` 側は「payload が置き換わる」ことしか見ていない。`attempt = 0` は `:556-567`（failed からの復活）が押さえているので、穴は `dueAt` と `priority` の 2 つ。
    **実測: memory の `schedule` を「既存行が `pending` なら `dueAt` と `priority` を温存する」に変えると、`packages/core/src` が 888 passed / 0 failed で全緑**（適合スイート 224 も全緑）。つまり `pending` 行の再アームだけは実行形を持たない。
    #11 が踏む形は「`ON CONFLICT DO UPDATE` に `WHERE status <> 'pending'` / `status = 'running'` の類を付ける」または「行が無いときだけ INSERT し、既存行は payload だけ touch する」実装。帰結は `pending` 行の再アームが効かないこと — 再アームした継続が呼び出し側が意図的に動かした時刻ではなく古い `dueAt`（`backoff` 直後なら最大 `SCOPE_TASK_MAX_BACKOFF_MS` = 1 時間先）で走り、priority も古いままになる。`running` 側は拘束されているので "backend が半分だけ正しい" 状態で緑になる
  - 提案: `:367` の直前に `running` 版と対になる 1 ケースを足す。以下は**現行実装で緑・上記ミューテーションで赤**になることを実測済み（他 224 ケースはミューテーション下でも緑のままなので、この 1 本だけが穴を塞ぐ）

    ```ts
    it("re-arms a pending row on schedule, taking the new dueAt and priority", async () => {
      await schedule("op-1", -MINUTE_MS);

      await schedule(
        "op-1",
        MINUTE_MS,
        "usage.userCleanupContinued",
        { cursor: "next" },
        ScopeTaskPriority.expiryCollection,
      );
      expect(await claim(10)).toEqual([]);

      backend.clock.advance(MINUTE_MS);
      const claimed = await claim(10);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.priority).toBe(ScopeTaskPriority.expiryCollection);
      expect(claimed[0]?.payload).toEqual({ cursor: "next" });
    });
    ```

## 前ラウンドが残した弱点の判定 — 許容できる

対象: `backoffOrSchedule` × 既存 `pending` 行の「`attempt + 1` / `dueAt` 押し出し」が独立ケースを持たず、`running` 経由（`:509-518`）でのみ拘束されている件。

**結論: 許容できる。** 根拠は 3 点で、いずれも実測または経路追跡で確かめた。

1. **同じケースが状態依存の分岐を既に弁別している**。`:413-444`（"keeps the priority and payload of an existing row when backoffOrSchedule stalls it"）は既存 `pending` 行に対して `input.priority` / `input.payload` を無視することを拘束している。「既存行を mint し直す」「`pending` だけ別扱いにする」実装の大半はここで赤くなる。素通りするのは「`pending` のときだけ何もしない」という限定的な形だけ
2. **memory バックエンドには実行形がある**。**実測: `backoffOrSchedule` を「既存行が `pending` なら no-op」に変えると適合スイートは 274 passed で全緑、`packages/core/src` は `application/storage/__tests__/deleteFilesByOwner.test.ts:324`（`expect(tasks(h)[0]?.attempt).toBe(1)`）の 1 件だけが赤**。契約の実行形としては不足だが、reference runtime の回帰は捕まる
3. **仮に別バックエンドが踏んでも自己修復する**。`pending` 行に対する `backoffOrSchedule` は「operation の最初の command が event で来る」経路でしか起きず（runner は必ず先に claim するので runner 経路では常に `running`）、抜けた場合の帰結は「1 tick ぶん即座に再実行される / attempt が 1 回ぶん進まない」。次の tick で runner が claim すれば `running` 側の拘束された経路に入る。W-001 の帰結（最大 1 時間の遅延が恒久化）とは深刻度が 1 段違う

なお W-001 の修正でこのファイルを触るなら、`:413-444` の末尾に `expect(claimed[0]?.attempt).toBe(1)` を 1 行足すだけでこの穴も閉じる（`backoffOrSchedule` 後に `advance(SCOPE_TASK_BACKOFF_BASE_MS)` して claim している時点で `dueAt` 押し出しも同時に拘束される）。必須ではない。

## セル照合（遷移表 × 観測属性を自分で列挙し直した結果）

`packages/core/src/application/ports/scopeTaskScheduler.ts` の遷移表 5 行を from-state 別に展開し、各属性を拘束しているケースを対応させた。行番号は `adapters/conformance/scopeTaskScheduler.ts`。

| 操作 × from | 属性 | 拘束しているケース |
| --- | --- | --- |
| `schedule` × absent | pending 化 / `dueAt` / `attempt=0` / `priority` / `payload` | `:69`, `:102`（priority が入力由来） |
| `schedule` × pending | payload 上書き | `:348` |
| `schedule` × pending | **`dueAt` / `priority` 上書き** | **なし → W-001** |
| `schedule` × running | `dueAt` / `priority` / `payload` / リース解放 | `:367` |
| `schedule` × failed | `attempt = 0` で復活 | `:556` |
| `claimDue` × pending(due) | running 化 / `leaseExpiresAt = now + 引数 leaseMs` / 境界 `<=` | `:69`, `:248`（`leaseMs - 1` と `leaseMs` の両側） |
| `claimDue` × pending(未 due) | 候補外 | `:69` |
| `claimDue` × running(リース有効) | 候補外（2 度目の claim / `listDue` から不可視） | `:248`, `:274`, `:652` |
| `claimDue` × running(リース失効) | reclaim / `dueAt`・`attempt`・`priority`・`payload` 不変 / 新リース | `:274` |
| `claimDue` × failed | 候補外（`claimDue` と `listDue` の両方） | `:521` |
| `claimDue` 選択規則 | priority 優先 / 返却順 / 予約枠が下限 / 上限でない / limit < クラス数の縮退 / 予約行はクラス内最小 / tie は (kind, operationId) | `:102`, `:132`, `:158`, `:182`, `:196`, `:219`, `:326` |
| `claimDue` 入力境界 | `limit <= 0`（claim / listDue 両方） | `:92` |
| `claimDue` 副作用範囲 | limit 超過分の行はリースを取らない | `:326`（2 回目の claim が残り 2 件を返す） |
| `complete` × pending | 行削除 | `:446` |
| `complete` × running | 行削除（リース跨ぎで観測） | `:392` |
| `complete` × failed | 行削除 → キー解放 | `:569` |
| `complete` × absent | no-op | `:446` |
| `backoff` × pending | `attempt + 1` / `dueAt` 指数（×2）/ `priority`・`payload` 不変 | `:462`, `:274`（priority 3・payload を backoff 経由で持ち越し） |
| `backoff` × running | `attempt + 1` / `dueAt` 押し出し / **リース解放** | `:462` の 2 回目（claim 済み行への backoff を `advance(BASE)` 2 回で弁別）、`:392` |
| `backoff` × failed | failed のまま | `:532` |
| `backoff` × absent | no-op | `:446` |
| `backoff` 上限 | `SCOPE_TASK_MAX_ATTEMPTS` で failed / 両 read から不可視 | `:521` |
| `backoffOrSchedule` × absent | `input.priority` / `input.payload` / `dueAt = input.now` で mint → backoff | `:489` |
| `backoffOrSchedule` × pending | 既存 `priority` / `payload` を保つ | `:413` |
| `backoffOrSchedule` × pending | `attempt + 1` / `dueAt` 押し出し | なし（上記「弱点の判定」で許容） |
| `backoffOrSchedule` × running | `attempt + 1` / `dueAt` 押し出し / リース解放 | `:489` 後半（`advance(2 * BASE)` はリース 5 分より短いので解放も同時に拘束） |
| `backoffOrSchedule` × failed | failed のまま | `:532` |
| `listDue` | scope 横断の priority 順 / 予約枠 / リース不可視 / 失効後の復帰 / `limit` / `limit <= 0` | `:590`, `:616`, `:652`, `:92` |

前ラウンドが「`backoff` × `running` のリース解放は `:462` が押さえている」と記録した点は、自分でトレースし直しても正しい（`:473` の claim で行が `running` になり、その行に対する 2 回目の `backoff` の後 `advance(BASE)` で `[]`・もう 1 回で 1 件、という並びがリース保持実装を弾く）。

## ミューテーション実測

いずれも memory 実装を一時的に壊して赤/緑を実測し、毎回 `git checkout` で復元した。

| ミューテーション | 結果 | 意味 |
| --- | --- | --- |
| `schedule` が既存 `pending` 行の `dueAt` / `priority` を温存する | **0 failed / 888 passed（`packages/core/src` 全体）** | W-001 の実証 |
| 上記 + W-001 の提案ケースを追加 | **1 failed（提案ケースのみ）/ 224 passed** | 提案が最小で効くことの実証 |
| `backoffOrSchedule` が既存 `pending` 行に対して no-op | 適合スイート **0 failed / 274 passed**、`packages/core/src` は **1 failed**（`deleteFilesByOwner.test.ts:324`） | 前ラウンド申告の弱点の範囲確定 |

（実行中に他セッションのミューテーションが一時的に作業ツリーへ現れたが、当該実行時には既に復元されており、上記の測定はいずれも自分のミューテーションのみが載った状態で取っている。最終確認時点で `git status` は tracked ファイル差分ゼロ。）

## 指摘に至らなかった確認結果

- **選択アルゴリズム（`adapters/memory/scopeTaskSelection.ts:32-53`）**: `ordered` が `(priority, dueAt, kind, operationId)` 昇順で同 priority が連続するので、直前の priority だけを持つ 1 パス（`reservedPriority`）は「各クラスの最小行を 1 件ずつ」と厳密に等価。初期値 `null` は priority `0` と `===` で衝突しない。境界を個別にトレース: `limit <= 0` → 早期 `[]`；`limit` < クラス数 → 予約ループが途中で打ち切られ厳密 priority 順に縮退；1 クラスのみ → 予約 1 + 充填で `limit` 全部；充填ループは既選択行を `add` し直しても `size` が増えないので二重計上が無い；返却は `ordered.filter` なので `Set` 挿入順ではなく必ず比較子順。`compareStrings`（`support.ts:127`）は素の符号位置比較で、SQL の BINARY 照合と一致する
- **判別共用体（`adapters/memory/store.ts:324-342`）**: `pending = dueAt` / `running = dueAt + leaseExpiresAt` / `failed = 時刻なし`。`schedule` / `claimDue` / `backedOff` の全分岐がフィールド列挙で、spread による残留フィールドの経路は無い（`repositories/scopeTaskScheduler.ts:125-128` の WHY コメントが excess property check の穴を記録している）。`DueScheduledTaskRow = Extract<…, { dueAt: Date }>` は述語 `isScopeTaskDue` と組で使われ、`toScopeTask` は `running` 行しか受け取らない型なので、リース未設定の行から `ScopeTask` を作る経路が型で塞がれている
- **`scopeTaskQueue.ts`**: 書き込みゼロ。scheduler と同一の述語 `isScopeTaskDue` と同一の `selectDueScopeTasks` を借りるだけで、`limit <= 0` も共有関数 1 か所に集約（AC-10 の「1 つの純粋関数」を満たす）。read-only であること自体もスイートが拘束している（`:616` で `listDue` の後に `claim(10)` が 3 件返る）
- **リース / reclaim**: 失効判定は `leaseExpiresAt <= now` で `pending` 側の `dueAt <= now` と非対称でなく、`spec/database/index.md` の追記とも一致。境界は `:248` が `leaseMs - 1` / `leaseMs` の両側で拘束。reclaim は `attempt` を消費せず `dueAt` も動かさない（`repositories/scopeTaskScheduler.ts:80-93` は元行のフィールドをそのまま持ち越し、`leaseExpiresAt` だけ張り直す）
- **clock のポート化**: 対象 3 ファイルに `Date.now()` / 引数なし `new Date()` は無い（grep 済み）。`new Date(now.getTime() + leaseMs)` は引数由来の算術のみ
- **UoW ロールバック**: claim の書き戻しは `MemTable.set`（`store.ts:114-128`）の undo ログに乗り、行は不変スナップショットとして扱われるので前参照の復元で十分。`__tests__/unitOfWork.test.ts` の新ケースが「claim した UoW が throw → 行が `pending` へ戻り、次の UoW が再 claim できる」まで見ていて実効的。claim が kick を増やさないことも、観測ラッパーが `schedule` にしか被っていない設計（`scopeUnitOfWork.ts:62-70`）と 1 対 1 で対応している
- **スイートのバックエンド中立性**: 生行を覗くケースは 1 件も無く、観測は「返る / 返らない / 順序 / `attempt` / `payload` / `priority` / `leaseExpiresAt`」に閉じている（ADR 026 §3 適合）。scope 横断の tie は `ports/scopeTaskQueue.ts` が未規定と明記し、ケースは tie を避けて組んである。生行を読むのは memory ローカルの `__tests__/unitOfWork.test.ts` だけで、これは実装特性のローカルテストとして正しい置き場所
- **`dueAt == now` を due とする境界**が適合スイートに独立ケースを持たない点は認識した（`:69` は ±1 分、application 側の runner テストが `dueAt: now` を通している）。ただし `dueAt` は必ず過去に置かれて実クロックが進むため、厳密不等号の実装で行が滞留する経路が作れず、指摘には数えない
- **kind → priority の割り当て**: `storage.ownerDeleteContinued` / `usage.userCleanupContinued` / `identity.personalCleanupHandoverContinued` = `securityCleanup`、`identity.personalBarrierPruneContinued` = `expiryCollection`。plan.md の分類どおり
- **コメント**: 担当範囲に修正の経緯・指摘への弁明・メタ情報の類は無い。適合スイートに増えたコメントはいずれも「そのケースが何を弁別するか」を書いた WHY で、`:249-251`, `:275-277`, `:317-319`, `:336-337`, `:371-373`, `:404-406`, `:537-539`, `:561-563`, `:574-576`, `:641-642`, `:659-661` はすべて非自明な理由の記録に該当する
- **スコープ逸脱**: 担当ファイル内に plan.md の「含まれないもの」を越える変更は無い（`last_error`・attempt 上限の運用イベント・D1/DO 実装はいずれも未着手のまま）

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskSelection.ts`, `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`, `packages/core/src/adapters/memory/scopeTaskQueue.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/support.ts`, `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/memory/__tests__/unitOfWork.test.ts`, `packages/core/src/adapters/memory/__tests__/conformance.test.ts`, `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeTaskQueue.ts`（後 2 者は契約の正本として通読。ポート設計そのものの評価は port-application 観点の持ち分）
- 参考読み（契約整合の判断に必要だった担当外ファイル）: `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `spec/adr/026-port-contract-and-conformance.md`, `docs/test.md`, `.thread/19/plan.md`
- スキップ: `.thread/19/**` — このPRの計画・レビュー足場（Phase 7 で削除）。カバレッジ対象外
- スキップ: `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/application/di/env.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts` — ランタイム / env 配線で runtime 観点の持ち分
- スキップ: `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — application 層のテストで application 観点の持ち分（ミューテーションの波及範囲確認にのみ使用）
- スキップ: `spec/database/index.md`, `spec/platform/index.md` — spec 観点の持ち分（memory 実装との整合確認のためリース節・索引節のみ読了）
