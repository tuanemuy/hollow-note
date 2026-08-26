### 合成・スキーマ・テストハーネス・spec/docs

実測（このワークツリー、`262ac75`）:

- `git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web` → **空**（AC-7 の非改変条件を満たす）
- `grep -rn "\.thread" packages apps spec docs README.md` → **0 件**（本番ソース・spec・docs からの `.thread/11/adr.md` 参照は全廃されている）
- `pnpm test:node` → 77 ファイル / 983 passed + 3 skipped（`skip` 3 件は `seedMembershipEdges` を持たない memory 側の条件付きケースで、適合スイート本体は本 PR で未変更）
- `pnpm test:workers` → 22 ファイル / 356 passed（AC-2 / AC-3 が実バインディングで緑）
- `pnpm typecheck`（root `tsgo` + `packages/core` の 2 プログラム + `apps/web`）/ `pnpm lint` / `pnpm format:check` → いずれも緑

vitest の 2 プロジェクト境界は `vitest.shared.ts` の 1 文字列（`src/adapters/cloudflare`）から node の `exclude` と workers の `include` を導いており、include 側は `configDefaults.include` 由来なので拡張子の取りこぼしも無い。disjoint かつ和集合が全体という `docs/test.md:126` の主張はコードと 1 対 1 で一致する。migration は `0001` 1 本のみで、欠番も 2 本目も無い。CI は node / workers を別ジョブに割り、`build` を含めて 3 ジョブで両プロジェクトの和集合を回している。

#### Blockers

なし。

#### Warnings

- **[W-001]** DO 側スキーマのヘッダーコメントが、本 PR 自身が書き換えた `spec/database/index.md` の「scope 検証」規約と食い違う
  - 場所: `packages/core/src/adapters/cloudflare/do/schema.ts:43-46`
  - 理由: コメントは «Every scope table carries `owner_type`/`owner_id` (or `scope_type`/`scope_id`) and the adapter checks them against this row on both restore and save» と書いているが、本 PR が改めた `spec/database/index.md:22` は「`stored_files.owner_type / owner_id`、`storage_quotas.owner_type / owner_id`、`llm_usages.user_id` は**会計上の帰属**であって scope 鍵ではないので、この検査の対象外」と明記している。実装もそちら側で正しい（`d1... do/repositories/storedFileRepository.ts:231` が «no owner check is made here» と書き、`__tests__/ports/scopeBusiness.ts:25` も同旨）。さらに `llm_usages` はそもそも `owner_type` / `owner_id` 列を持たない（`user_id` / `period_year` / `period_month`）ので、「Every scope table carries …」自体が事実に反する。schema ファイルは次のバックエンド実装者が最初に読む場所で、ここだけが旧い規約を主張している
  - 提案: コメントを 2 文に割る。「scope 鍵として使う列（`notes.owner_type / owner_id` と `_scope_identity`）は復元・保存の両方で検査する」「`stored_files` / `storage_quotas` / `llm_usages` の帰属列は scope 鍵ではないので検査しない — 物理分離は `_scope_identity` の pin が担保する」。`spec/database/index.md` の「共通の規約」への参照はそのまま残す

- **[W-002]** `spec/platform/index.md` が「どのバックエンドが届かないか」を ADR 056 のコンテキストへ委譲したが、その ADR 056 が更新されていない
  - 場所: `spec/platform/index.md:796`（→ `spec/adr/056-performance-budget-placement.md:9,11`）
  - 理由: 新しい本文は «Cloudflare 実装の実測は 1 turn `4n + 3` 文 … どのバックエンドがこの数に届かないかは同 ADR のコンテキストが持ち、この節には書かない（同 決定 3）» と、参照先を明示して委譲している。ところが ADR 056 のコンテキストは今も (a) 目標値として「列挙 1 文 ＋ 多行 DELETE 1 文 ＋ 多行 outbox INSERT 1 文で、件数によらず **3 文**」を引用し、(b) 届かないバックエンドとして **in-memory だけ**を名指している。本 PR はその 3 文目標そのものを platform 側で取り下げ、Cloudflare 実装も届かないことを実測した。委譲先を辿った読み手は、撤回済みの数字と不完全な一覧に着地する。CLAUDE.md「Design canon」は `spec/adr/index.md` を「今も有効な判断」の索引と定めており、在force の ADR 本文が実装について偽を述べている状態はそこに反する。撤回の記録は `.thread/11/adr.md` の ADR-025 にあるが、`.thread/` は本 PR の方針どおり canon ではない
  - 提案: `spec/adr/056` のコンテキストへ 1〜2 文足す。「D1 / DO 実装も 1 件ごとの `findById` で版トークンを採る契約から `4n + 3` 文になり、3 文の目標は実測を経て `spec/platform/index.md` 側で `commit 1 回` へ改めた」。決定 3 が指す一覧はこれで両バックエンドを揃える。決定文（3 つの決定）は動かさない

- **[W-003]** ポート JSDoc に足した「タグ名の重複は 1 件と同じ」という契約が、適合スイートにも `spec/domains/note.md` にも降りていない
  - 場所: `packages/core/src/domain/note/ports/localNoteQueryService.ts:22-25`、`packages/core/src/domain/note/ports/publicNoteQueryService.ts:8`
  - 理由: 本 PR は両ポートの `tagNames` に «a repeated name filters no differently from one» という**契約文**を新設した（Round 001 で見つかった D1 の `COUNT(DISTINCT …) = tagNames.length` の取りこぼしに対する正本側の答え）。しかし `packages/core/src/adapters/conformance/{localNoteQueryService,publicNoteQueryService}.ts` に重複タグを渡すケースは 1 件も無く（`grep` で 0 件）、`spec/domains/note.md:471,507` の `tagNames: readonly string[]; // 同じく正規化済みの名前` も据え置きのまま。CLAUDE.md「Port contracts and conformance」は「contractual behaviour を足すならポート JSDoc と適合スイートの**両方**に触れる」と定め、AC-8 も同じ手続きを要求している。同じ PR で cursor の「署名」撤回のほうは JSDoc → `spec/domains/note.md` → `spec/inventory/{adapter,domain}.md` まで一貫して降ろしているので、この 1 件だけ扱いが非対称になっている。実害は今日ゼロ（memory は `every` で自然に満たし、CF は修正済み）だが、退行を捕まえる仕掛けが無い
  - 提案: `adapters/conformance/localNoteQueryService.ts` の既存のタグ絞り込みケース（`criteria({ tagNames: ["work"] })` の隣）に `tagNames: ["work", "work"]` が同じ結果を返すケースを 1 つ足し、`publicNoteQueryService.ts` にも同型で 1 つ足す。両バックエンドが通ることを確認したうえで、`spec/domains/note.md` の 2 つの型注釈にも同じ一文を添える。スイートを足さない判断を採るなら、JSDoc から契約文を落として実装コメントへ降ろすほうが ADR 026 と整合する

- **[W-004]** scope object の Alarm を消す地点が 1 か所ではなく、commit 経路にも存在する
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:112-121,177-184` → `do/alarm.ts:254-263`
  - 理由: 本 PR が書いた `spec/platform/index.md:202` は «**Alarm を消す地点は turn の出口 1 か所に限る。** due index の publish 失敗が張る再試行は Alarm 以外に居場所を持たないので、起動のたびに消す経路があるとそれが失われる» と無条件で宣言している。ところが `applyWriteSet` は `scheduled_tasks` に触れた write-set のたびに `armAndPublish` → `armAndPublishNow` → `rescheduleAlarm` を通り、`rescheduleAlarm` は `scopeAlarmDrivesTasks()` が偽なら常に `storage.deleteAlarm()` する。中央 runner が driver の配備（レジストリ空 = `scopeAlarmDrivesTasks()` が恒に偽）では、**commit のたびに未発火の再試行 Alarm が消える**。`armAndPublishNow` 自身のコメントはこの順序を 1 回の呼び出し内では意図的なもの（arm → publish → 失敗時に再 arm）として説明しているが、**前回の呼び出しが張った再試行を次の呼び出しが消す**ことは扱っていない。非クラッシュ経路では直後の publish が全置換なので回復するものの、`deleteAlarm()` 成功後・`publishDueIndex` 完了前に isolate が落ちると、索引に載らなかった行（`spec/database/index.md` が「自然回復しない」と名指した向き）と唯一の回復経路が同時に失われる。次にその scope へ commit が来るまで恒久的に不可視になる
  - 提案: commit 経路を「足すだけ」に倒す。`armAndPublishNow` の 1 行目を `rescheduleAlarm` から `armForStoredRows`（既に `do/alarm.ts:277` にあり、決して消さない）へ差し替えれば、Alarm を消すのは `alarm()` の `finally` と未 bind 時の早期 return だけになり、spec の宣言と 1 対 1 になる。武装を後ろへ倒す（＝行が無くなったので消す）必要があるのは turn の出口だけで、commit 経路が要求するのは前倒しの武装だけである。仕様側を弱める案（「起動時の張り直しは消さない」と限定する）は、上記のクラッシュ窓が残るので採らない

- **[W-005]** `.thread/11/adr.md` の ADR-026 が欠番のまま、その旨の注記も無い
  - 場所: `.thread/11/adr.md`（ADR-025 が `:616`、次が ADR-027 で `:659`）
  - 理由: 採番は 001〜085 の 84 本で、重複も順序の乱れも無い一方、026 だけが飛んでいる。これは Round 001 で指摘され `triage.md:90` で **fix** と判定され、`triage.md:228` にも「`.thread/11/adr.md`（… ADR-026 欠番の明記 …）」と修正対象として挙がっているが、ファイルには何も入っていない（`grep 欠番 .thread/11/adr.md` → 0 件）。fix と決めた項目が落ちている
  - 提案: ADR-025 の直後に 1 行入れる。「ADR-026 は欠番（草案を ADR-0XX へ畳んだため / 採番のみ消費）」。判定どおり 1 行で閉じる

- **[W-006]** `spec/inventory/frontend.md` だけ最終同期日が据え置き
  - 場所: `spec/inventory/frontend.md:3`（`最終同期: 2026-08-16`）
  - 理由: 本 PR は `PAGE-p41-002` の要点欄を「署名 cursor」→「opaque cursor」へ改めているのに、ヘッダーの同期日は動いていない。同じ改訂で `adapter.md` / `domain.md` / `test.md` / `usecase.md` の 4 本はいずれも `2026-08-25` → `2026-08-26` へ上げている。台帳の同期日は「この日付時点で生成元と一致している」という主張なので、行を触った台帳だけ日付が古いのは読み手に「この行はいつの主張か」を判断させる材料を欠く。なお生成元の `spec/pages/index.md` に cursor の記述は無く（`grep` で 0 件）、当該要点は `spec/domains/note.md` 由来の記述が台帳側にだけ存在していたものなので、行の修正自体は正しい
  - 提案: `spec/inventory/frontend.md:3` を `2026-08-26` へ上げる

#### 所見（指摘ではない）

- **AC-2 / AC-3 の保証としての `conformanceCoverage.test.ts` は十分**。(a) CF と memory の呼び出し集合の一致、(b) 呼び出し数の絶対値 30、(c) `conformance/` からの export 集合と全アダプターテストの呼び出し集合の一致（`ALL_SUITES = 31`）、(d) 各バックエンドが自分の factory だけを名指すこと、の 4 点を押さえている。スイートを両側から消す／片側だけ差し替える／別バックエンドの factory を渡す、のいずれも赤になる。実引数の識別子検査（Round 003 の決着）も入っている。CF 側の 7 ファイルの合計は directory 4 + identity 8 + projection 4 + route 5 + scopeBusiness 6 + scopeInfra 2 + unitOfWork 1 = 30 で、定数と一致する
- **適合ハーネスの名前空間分離は 3 面すべてで効いている**。`harness.test.ts` の «hands out backends that cannot see one another on any plane» が D1（wipe）・DO（名前に接頭辞）・R2（key 接頭辞）を 1 ケースで観測し、DO / R2 側は「前の backend の書き込みが残っていること」まで見て wipe と namespace の違いを弁別している。適合スイート 30 本はいずれも 1 テスト 1 回だけ `makeBackend()` を呼ぶので、D1 が共有 wipe であることが問題になる形にはならない
- **物理スキーマは改訂後の `spec/database/index.md` と 1 対 1**。突き合わせた範囲（`_occ_guard` / `scope_task_due_index` / `_scope_identity` / `account_deletion_manifests` + `_items` / `global_maintenance_runs` + `_lanes` / `distributed_operations` / `membership_directory` / `note_routes` / `identity_removal_receipts` / `auth_tokens` / `outbox_events` / `processed_events` / `public_note_search`）で、列・CHECK・索引・部分索引の述語がすべて一致した。`FOREIGN KEY` は global / scope とも 0 件で、`spec/database/index.md:14` の「`ON DELETE CASCADE` / `RESTRICT` は論理的な所有関係の宣言であり、物理制約としての `FOREIGN KEY` 宣言を要求しない」と整合する。`auth_tokens` の部分一意索引を置かない決定、`identities` の `BEFORE INSERT` trigger を置かない決定も spec 側で明示されており、実装と揃っている
- **fencing 決着文の driver 別の場合分けは成立している**。`spec/platform/index.md:194-212` が (i) 既定＝object の Alarm 1 本、(ii) 中央 runner 配備では due index が全 scope 共有なので「1 配備あたり同時 1 起動」が単一 writer 前提そのもの、(iii) どちらが writer かはハンドラレジストリが決める、の 3 段に分けて書いている。参照先の `spec/database/index.md` の `scheduled_tasks` / `scope_task_due_index` 節はいずれも実在し、後者は本 PR で新設された。Global Cron 側は逆に「lease は fencing である」と複数 writer 前提を明示し、対照が読める
- **purge ack の撤回は 5 か所で一貫**。`domain/note/ports/publicNoteProjectionWriter.ts`（JSDoc から acknowledgement を削除）、`spec/domains/note.md:670`、`spec/usecases/note.md:743,1354` が揃っており、`spec/inventory/{adapter,domain}.md` の当該行（ADP-note-032 / DOM-note-048）はもともと「public 削除を冪等に完了する」で ack に言及していないため追随不要。Round 004 の決定どおり memory の `publicPurgeAcks` は据え置き（#56）
- **「署名 cursor」の撤回範囲が ADR 063 の宣言と一致**。`grep` の残存は (a) workspace directory 系 4 か所（ADR 063 が明示的に範囲外と書き、`spec/adr/021:41` も「公開workspace一覧は署名cursorのままで、ポートを実装する時点で同じ問いを引き直す」と受けている）、(b) ExportTicket / deletion status ticket / `UserBatchReader` の署名済み routing generation（ADR 063 決定 3 が「別物」と明記）だけ。過剰にも過少にもなっていない
- **`docs/runtime_node.md:206` の書き換えは正確**。「アダプター群と DI 配線は入っており適合スイートを通る／配備側（Worker entry・本番 `wrangler.jsonc`・Queue consumer）は未着手」「`wrangler` 設定は `packages/core/wrangler.test.jsonc` だけ」の 3 点をこのワークツリーで確認した（`apps/web/app/` に `server.cloudflare.ts` は無く、`apps/web` に `wrangler*` も無い）。README:55 も同旨で揃っている
- **`tsconfig` の 2 プログラム分割は妥当**。`packages/core/tsconfig.json` が `src/adapters/cloudflare/**` と `src/application/di/cloudflare*.ts` を除外し、`tsconfig.cloudflare.json` が同じ 2 パターンを include する。`lib.dom` と `@cloudflare/workers-types` の衝突が理由であることがコメントに書かれており、`typecheck` script が両方を回している。`vitest.workers.config.ts` は前者の include に入っているので、どちらのプログラムからも落ちていない

#### カバレッジ

- 確認（設定 / ビルド）: `.github/workflows/ci.yml`, `package.json`, `packages/core/package.json`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`
- 確認（ドキュメント）: `README.md`, `docs/test.md`, `docs/runtime_node.md`
- 確認（DI 合成）: `packages/core/src/application/di/runtime.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`
- 確認（物理スキーマ）: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`
- 確認（テストハーネス）: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `.../__tests__/worker.ts`, `.../__tests__/env.d.ts`, `.../__tests__/harness.test.ts`, `.../__tests__/runtimeComposition.test.ts`, `.../__tests__/ports/{deps,directory,identity,projection,route,scopeBusiness,scopeInfra}.ts`, `.../__tests__/conformance/{directory,identity,projection,route,scopeBusiness,scopeInfra,unitOfWork}.test.ts`
- 確認（spec、全変更分）: `spec/adr/021-scope-sharded-data-plane.md`, `spec/adr/063-public-cursor-not-authenticated.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/{identity,index,note,workspace}.md`, `spec/inventory/{adapter,domain,frontend,test,usecase}.md`, `spec/platform/index.md`, `spec/testcases/identity/{deleteAccount,listPublicProfiles}.md`, `spec/testcases/note/{projectNoteChanges,searchPublicNotes}.md`, `spec/usecases/{identity,note}.md`（＋差分外の `spec/index.md`, `spec/adr/056-performance-budget-placement.md`, `spec/pages/index.md`, `spec/domains/workspace.md`, `spec/usecases/workspace.md` を判断材料として参照）
- 確認（契約文の変更、AC-8 / AC-9 の照合として差分読み）: `packages/core/src/application/errors.ts`, `packages/core/src/application/ports/{noteRouteFanOutReader,scopeTaskScheduler}.ts`, `packages/core/src/application/identity/{requestPasswordReset,resendVerificationEmail}.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `packages/core/src/domain/note/ports/{localNoteProjectionWriter,localNoteQueryService,publicNoteProjectionWriter,publicNoteQueryService}.ts`
- 確認（`spec/platform` の alarm 削除地点の照合として対象読み）: `packages/core/src/adapters/cloudflare/do/scopeObject.ts`（bind / applyWriteSet / alarm / armAndPublish 周辺）, `packages/core/src/adapters/cloudflare/do/alarm.ts`（`scopeAlarmDrivesTasks` / `rescheduleAlarm` / `armForStoredRows` / `armNoLaterThan`）
- 確認（`.thread/11/`）: `plan.md`（受け入れ基準・スコープ）, `review/triage-keys.md`, `adr.md`（採番・見出し 84 本の重複／順序／欠番検査、および ADR-025 / ADR-026 周辺）, `review/triage.md`（既出判定の裏取りとして grep）
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/*.ts`（18 本）— 個別ポートの SQL 実装で identity / routing / uow 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/do/repositories/*.ts`（11 本）, `do/{dueIndex,scheduledTasks,scopeName,scopeStub}.ts` — scope 平面のポート実装で scope 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/execution/*.ts`（4 本）, `sql/*.ts`（7 本）, `cursor.ts` — UoW 実行機構と SQL 基盤で uow 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/{projection/*.ts（4 本）,search/*.ts（2 本）,r2/objectStorage.ts,scopeRouter.ts,scopeTaskQueue.ts}` — 投影・検索・R2・ルーティングの実装で scope / routing 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{alarm,deleteFilesByOwner,durability,globalConcurrency,idempotency,lease,projectionConcurrency,r2,routeGuard,searchEdges,sessionOverlay,support,unitOfWork}.test.ts`（13 本）— バックエンド固有の統合テストで、各実装を担当する観点の持ち分（ハーネス自体の検証は `harness.test.ts` / `runtimeComposition.test.ts` として確認済み）
- スキップ: `packages/core/src/application/cleanup/{participants,personalCleanup}.ts` — cleanup 参加者宣言の変更で identity 観点の担当
- スキップ: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts` — 対応する実装を担当する観点の持ち分（AC-5 / AC-7 の緑は実行で確認済み）
- スキップ: `pnpm-lock.yaml` — 生成物。`pnpm install --frozen-lockfile` 相当が CI で回り、`packages/core/package.json` の宣言（`@cloudflare/vitest-plugin@1.0.0` / `@cloudflare/workers-types` / `wrangler@^4.125.0`）と `pnpm-workspace.yaml` の `allowBuilds.workerd` 追加だけを確認した
- スキップ: `.thread/11/{foundation,progress,steps,testing}.md`, `.thread/11/review/review-00{1,2,3,4}*.md`（24 本）— 過去ラウンドの作業記録・レビュー記録で、ゼロベース判定の前提にしない方針（既出判定は `triage-keys.md` / `triage.md` の該当行の裏取りにのみ使用）
