# レビュー R3 — Use Case / ポート契約

対象: PR #45 / ベース `main` / 差分 `16-round-003.diff`（変更ファイル 36 件）

## Use Case / ポート契約

### Blockers

- **[B-001]** ADR 061 の契約 4 が「継続 turn は返った lane を次の継続へ引き渡す」と断定しているが、ポート JSDoc・両 usecase・実装はいずれも「引き渡せない（lane はリース失効まで claimed のまま残る）」と述べている。canon 側だけが偽。
  - 場所: `spec/adr/061-maintenance-sweep-order-authority.md:24`（`単発の継続 turn は、返った lane を claimed のまま次の継続へ引き渡す`）
  - 理由: 同じ契約 4 について、`packages/core/src/application/ports/globalMaintenanceRunStore.ts:93-100` は「A single continuation turn is not a driver, and **handing its final ack's lane on to the next turn is not possible today** … Such a lane sits claimed until its lease lapses and a cron reclaims it」と書き、`pruneExpiredAuthState.ts:199-206` / `deleteAccount/terminalPrune.ts:128-135` の `runContinuation` は `advanced.next` を `continued` の真偽にしか使わず position を捨てている（view が `continued` しか運ばないため引き渡す先が無い、というのが JSDoc と両 Runtime wiring note の説明）。つまり ADR の 1 文だけが実態と逆。しかもポート JSDoc は `(Contracts 1–4: spec/adr/061.)` と ADR を契約の出典として名指しているため、別バックエンド実装者は「契約 4 の正本」を読みに行って矛盾する 2 つの記述に当たる。ADR 046（乖離は正本のある側へ倒す）を前提に置いた ADR 自身が、記述と実装の乖離を新設している。plan.md:39 が「継続 turn の是正はスコープ外、契約 4 の主体を限定して**記述と実態を一致させるだけ**」と決めた線とも食い違う。
  - 提案: 契約 4 の当該文を実態に合わせる。例:「単発の継続 turn は駆動側ではない。返った lane を次の継続へ引き渡す口が今は無く（view は `continued` しか運ばない）、その lane はリース失効まで claimed のまま残る。引き渡しは Queue producer の配線と同時に決める」。あわせて「影響」に残存条件として 1 行足すと、ADR 062 の残存条件の書き方とそろう。

### Warnings

- **[W-001]** `setMaintenanceTables` を「任意フックではなく必須メンバーにした理由」が、宣言側と適合スイート冒頭の 2 か所にほぼ同文で置かれている。
  - 場所: `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:40-44`（`packages/core/src/adapters/conformance/backend.ts:137-144` と同趣旨）
  - 理由: どちらも「これが無いと契約 1 を検証しないまま conformant を名乗れる」という同じ主張で、片方は宣言の JSDoc、片方はスイートの説明。CLAUDE.md のコメント方針（非自明な WHY を 1 つ）に対して、同じ WHY が 2 か所に残ると片方だけ更新されて割れる。スイート側は「契約 1 は表集合を live run の下で差し替えて検証する」という**何を拘束しているか**だけで足り、必須にした理由の置き場は宣言側。
  - 提案: スイート冒頭の当該段落から「required member … not a hook a backend may leave out: without it …」の理由部分を落とし、`backend.ts` の JSDoc に一本化する。
- **[W-002]** 今回書き換えたコメント段落の中に、既定表集合の表数と合わない算術が残っている。
  - 場所: `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts:543`（`32 lanes x 4 tables = 128 commands`）
  - 理由: `DEFAULT_MAINTENANCE_TABLES.authStatePrune` は 5 表（`packages/core/src/adapters/memory/store.ts:377-383`）なので実際は 32 × 5 = 160 コマンド。結論（100 の予算を超えるので途中で切れる）は変わらないが、本 PR はこの同じコメントの後半（リース更新の説明）を書き換えており、同じ段落の前半が旧い表数のまま残った。「4 表」表記は spec 側では spec-sync 管轄の既知乖離（triage-keys の wont-fix）だが、こちらはテストの前提計算そのもの。
  - 提案: `32 lanes x 5 tables = 160 commands` に直す（あるいは表数を書かず「32 lane 分の走査は 100 コマンドの予算を超える」とする）。

### 確認した観点（Blocker/Warning に至らなかったもの）

- **契約 1〜4 と実装・呼び出し元・適合スイートの一貫性**: 契約 2 の `asOf`（run 行の固定値、claim/ack の壁時計でも `checkpointLane` の `asOf` でも上書きしない）は `toLane` が `run.asOf` を返す実装と一致し、適合スイートが `backend.clock.advance(MINUTE_MS)` で壁時計を run 境界から離してから `nextTable.asOf` / `secondShard.asOf` / `virgin.asOf` を検証しているので、`now()` を打つ実装は落ちる。契約 3(a)（store が作った position のキー = 呼び出し側の導出キー）は run 生成時の先頭 position と次表 position の両方で、3(b)（既存 position は永続化済みキーをそのまま）は規則外文字列 `command-off-rule` を checkpoint してから自動 claim させる形で、それぞれ拘束されている。契約 2 の「解放は `next` を返さない」「pending が無い ack も返さない（run 完了とは別物）」も専用ケースで拘束済み。JSDoc が null になる場面を 2 つ、ADR が 3 つと数えているのは分割の粒度差であって矛盾ではない。
- **lane 駆動ループの漏れ・停滞・無限ループ**: 外側ループは 1 反復ごとに必ず `commands` を 1 以上進める（未知表 skip も ack を 1 command に数える）ので、`MAX_COMMANDS_PER_INVOCATION` で必ず止まる。未知表が連続しても停滞せず前進する。claim を持ったまま抜ける経路は `finally` の一括解放が拾い、`inFlight` は解放・ack のたびに `null` に戻るので二重解放も起きない。sweep 失敗・予算枯渇の直接解放と `finally` の解放が二重に走る経路も無い。
- **at-least-once / 冪等性 / `commandKey` 重複排除**: `checkpointLane` の `nextCommandKey` は呼び出し側の導出のまま（plan の「含まれないもの」どおり）。store が mint するのは自分が作った position のキーだけで、既存 position の再 mint は memory 実装でもスイートでも禁じられているため、checkpoint 時に Queue へ載せたキーと自動 claim が返すキーが割れる経路は無い。DELETE の冪等性・cursor 保存の順序は本 PR で変わっていない。
- **`terminalPrune` の挙動不変**: コードは JSDoc 追記のみ。`advanced.next` は `{ generation, shardId }` としてしか使われず、自動 claim された lane を即解放して返す方針（ADR 061 の引き継ぎ）は維持。`release` のログ meta は `advanced.next` が `MaintenanceLane` に広がったぶん項目が増えるが、同じ `release` のもう 1 つの呼び出し元（`claimLanes` 由来の lane）は元から全項目を展開しており、揃った方向の変化で秘匿値も含まない。
- **テストの実効性**: TC-347 は表順の hint 相当が復活すれば `continued: false` で落ち、TC-348 は解放→再 claim の迂回が戻れば `releases > 0` で落ち、TC-349 の全表未知 run は `failures += 1` が戻れば `SystemError` で落ちる。差し替えた「解放失敗はログ」テストは `checkpointLane` throw の fixture に載せ替えられ、claimed のまま残る 4 lane を観測しており、`releaseLane` の `workRemains = true` が観測できない理由もコメントに引き継がれている。`npx vitest run pruneExpiredAuthState conformance` は 279 passed / 3 skipped で緑。
- **スコープ逸脱**: 差分に「含まれないもの」を越える変更は見当たらない（`SWEEP_ORDER_HINT` 廃止に伴う範囲、未知表 skip、spec / ADR / 台帳の同期に限られている）。`grep -rn "SWEEP_ORDER" packages apps` は 0 件（AC-2）。
- **弁明・経緯コメント**: W-001 以外に、修正の経緯や指摘への弁明を残した記述は見つからなかった。`memory/__tests__/conformanceBackend.ts` の「値スロットを書き換え可能に保つのが load-bearing」は将来 `Readonly<Record<…>>` 化で契約 1 の実行形が消えることを止める why-not として残す価値がある。

### カバレッジ

一覧は 36 行（依頼文の「37 件」は末尾空行を数えたもの）。確認 20 件 + スキップ 16 件 = 36 件。

- 確認: `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/domains/index.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/inventory/usecase.md`, `spec/inventory/test.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `.thread/16/plan.md`
- スキップ: `spec/adr/index.md` — ADR 索引・前提依存マップの登録で、ポート契約の主張を持たない（spec 観点）
- スキップ: `spec/database/index.md` — スキーマ canon の表現で、契約 1 のスキーマ要件は ADR 側で確認済み（spec 観点）
- スキップ: `spec/platform/index.md` — 実行基盤側の記述で、usecase / ポート契約の主張を持たない（spec 観点）
- スキップ: `.thread/16/adr.md` — 作業スレッドの ADR 草稿で、canon は `spec/adr/061,062`（レビュー対象の契約は spec 側で確認）
- スキップ: `.thread/16/steps.md` — 実装手順のメモで、契約でも実装でもない
- スキップ: `.thread/16/testing.md` — 動作検証の観測記録で、契約でも実装でもない
- スキップ: `.thread/16/review/review-001.md` — 過去ラウンドのレビュー記録（ゼロベース方針のため参照しない）
- スキップ: `.thread/16/review/review-001-adapter.md` — 同上
- スキップ: `.thread/16/review/review-001-spec.md` — 同上
- スキップ: `.thread/16/review/review-001-usecase.md` — 同上
- スキップ: `.thread/16/review/review-002.md` — 同上
- スキップ: `.thread/16/review/review-002-adapter.md` — 同上
- スキップ: `.thread/16/review/review-002-spec.md` — 同上
- スキップ: `.thread/16/review/review-002-usecase.md` — 同上
- スキップ: `.thread/16/review/triage.md` — 既出判定の台帳（`triage-keys.md` のみ既出判定に使用）
- スキップ: `.thread/16/review/triage-keys.md` — 既出判定の入力として読んだが、レビュー対象の成果物ではない
