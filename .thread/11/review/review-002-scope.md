### Scope business / 投影・全文検索 / R2

#### Blockers

- **[B-001]** `replaceSnapshotIfNewer` / `removeIfNewer` が read-compare-write のままで、世代ベクトルの**条件付き書き込み**になっていない。public plane は並行度 4 の consumer が同じ Note を同時に処理しうるので、(a) 古い snapshot が新しい行を上書きし、(b) contentless FTS へ**索引に入っていない値の `'delete'`** が撃たれて索引が壊れる
  - 場所: `packages/core/src/adapters/cloudflare/projection/snapshotWriter.ts:155-190`（`replace` / `remove` が `stored` を材料に mutation を組むだけで guard を積まない）、`packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts:34-75`
  - 理由:
    - `replaceSnapshotIfNewer` は `readStored()` → `compareVectors()`（JS 上の比較）→ `writer.replace()` の 3 段で、`replace` が積むのは `[ftsDelete(stored), body upsert, tag delete, tag insert, ftsInsert]` の 5 文だけ。**`_occ_guard` も条件付き `UPDATE` も無い**。読みと batch のあいだに別の consumer が commit しても誰も気づかない。
    - public writer のセッションは `createAutocommitSession(createD1Executor(env.GLOBAL_DB))`（`__tests__/conformanceBackend.ts:110-112`、本番は `application/di/cloudflareRuntime.ts`）なので、読みは batch の外にある。`spec/platform/index.md`「Queue 構成」は `events-public-projection` を **concurrency 4** と定め、その根拠として「public projection は…**世代ベクトル条件付き書き込み**で競合を吸収する」「public D1 書き込みは…世代ベクトル**条件付き** batch にまとめる」と 2 か所で明記している。今の実装はその「条件付き」を持たない。
    - 具体的な失敗: 停まっている行が rev4、A が rev5、B が rev6 の snapshot を持ち、両者が rev4 を読む。B が commit（`'delete'` rev4 トークン → rev6 トークン挿入）、続いて A が commit すると、A の `ftsMutation("delete", stored=rev4)` は**索引に存在しない rev4 トークン**を取り消す。contentless FTS5 の `'delete'` は旧値が実際に入っていることを前提にした差分適用なので、これは索引の恒久的な破損になる。しかも本文行は rev5 に落ちる（lost update）。
    - 復旧経路が無いのが効く。ADR 017 は contentless では `'rebuild'` が使えないと定めており、壊れた索引を直すには FTS 表の再作成 + 全件再投影しかない。`integrity-check` は `note_search` との一致を検査しない。
    - memory バックエンドは同じ形（read → compare → write）だが JS が単一スレッドなので read-compare-write が原子になり、この競合が構造的に起きない。したがって**共有適合スイートでは絶対に観測できない**種類の欠陥であり、AC-2 が緑であることは反証にならない。
    - 同じ穴は `removeIfNewer` / `remove()` にもある（読んだ行を材料に FTS を取り消してから消す）。local plane は「1 scope に writer 1 本」という前提（本 PR が `spec/platform/index.md` に足した段落と adr.md ADR-019）に守られているが、public plane にはその前提が無い。
  - 提案: `snapshotWriter.replace` / `remove` に、読んだ行像に対する `occGuard` を積む。本 PR には既に同型の前例が 2 つある — `noteProjection.ts:104-117`（`bump` の「存在しない」/「revision = 読んだ値」の 2 分岐）と `snapshotWriter.redactAuthor`（adr.md ADR-050 がまさに「読んだときの判定が commit 時に崩れていれば unit ごと中断する」ために guard へ寄せた）。ここも
    - `stored === null` のとき: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM <table> WHERE note_id = ?)`
    - `stored !== null` のとき: `SELECT 1 FROM <table> WHERE note_id = ? AND projection_revision = ? AND author_version = ? AND workspace_version = ?`（public は `route_version = ?` も）

    を mutation の**先頭**に置けば、負けた側は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` になり、at-least-once の再配送が新しい行を読み直して `stale` に落ちる（`redactAuthor` と同じ収束の形）。あわせて `__tests__/` に、同じ note へ 2 本の `replaceSnapshotIfNewer` を並走させて (i) 新しい方が残ること (ii) `INSERT INTO <fts>(<fts>) VALUES('integrity-check')` が通ること を実バインディングで観測するバックエンド固有テストを足す。契約側（ポート JSDoc / 適合スイート）は動かさなくてよい — これはバックエンド固有の原子性の話で、ADR 046 の手続きには掛からない。

#### Warnings

- **[W-001]** FTS へ渡す bigram 文字列は 1 バインド値 2,000,000 バイトの上限に対して無防備で、最大サイズの本文で実際に触れうる
  - 場所: `packages/core/src/adapters/cloudflare/projection/snapshotWriter.ts:73-78`（`bigramIndexText(text(row, "text"))` を bound value にする）、`packages/core/src/adapters/cloudflare/search/bigram.ts:92-95`
  - 理由: `note_search.text` は `PlainTextContent` = 最大 800,000 バイト（ADR 017）。純粋な日本語（3 バイト/文字）では bigram 化で `7n/3n ≒ 2.33` 倍に膨らむので 1,866,000 バイト — 上限 2,000,000 の **93%** で、余裕が 7% しかない。さらに NFKC は縮む変換だけではない: `㍿` は 1 文字 3 バイトから CJK 4 文字へ展開し、bigram 3 個 ≒ 21 バイト（**7 倍**）になる。CJK 互換文字（U+3300–33FF の角書きカナ、`㈱` 等）を多く含む最大級の本文では 2,000,000 バイトを確実に超える。超えると `replaceSnapshotIfNewer` が `SystemError(DatabaseError)` で落ち、その Note は投影 task の再試行を経て quarantine へ行き、**永久に検索に出ない**。
    ADR 017 の予算は「行」に対して引かれており、contentless 化で行の問題は消えたが、**同じ 2,000,000 という上限が bound value にも掛かる**ことは引き直されていない。このアダプタは同種の上限を認識しており、`d1/repositories/outboxRepository.ts:124-127` では `MAX_SAVE_BINDING_BYTES` を明示的に検査している。最大の bound value であるここだけが素通しになっている。`assertBindable` は**個数**しか見ない。
  - 提案: `bigramIndexText` の戻り値のバイト長を測り、上限に触れるなら (a) 本文だけ前方 N 文字で打ち切って索引する（ハイライトが既に 4,000 文字で打ち切っている前例と同型で、`spec/database/index.md`「既知の限界」に 1 行足せば済む）か、(b) 少なくとも `outboxRepository` と同じく名前のついた `SystemError` にして「どこで切れたか」を読めるようにする。あわせて 800,000 バイトの CJK 本文 1 件を投影して通ることを固定するテストを 1 本。

- **[W-002]** 本 PR が `spec/platform/index.md` から消した「3 文の設計目標」を、コード側のコメントが 3 か所でまだ現行の canon として引いている。うち 1 か所は「spec が実測値を持っている」と書いているが、改訂後の spec は ADR 056 決定 3 に従って**実測値を置かないと明記している**
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts:52-55`（"states a design goal of **three** statements … and this file is the measurement that goal is held against"）、同 `:320-322`（"`spec/platform/index.md` carries the measured figure instead"）、`packages/core/src/adapters/cloudflare/sql/json.ts:18-19`（"which is also what keeps a bulk delete to the three statements `spec/platform/index.md` の「実行予算と分割単位」 asks for"）
  - 理由: 改訂後の当該段落が約束するのは「書き込みを件数によらず 1 回の原子適用にまとめる」だけで、3 文の目標も 4n+3 の実測値も無い。「実測値と内訳は各アダプターの持ち分で、予算文書には置かない（ADR 056 決定 3）」と明示されている。つまり 3 つのコメントはいずれも**存在しない spec 文を引いている**。加えて `:320-322` の「The design goal … is not met; spec が実測値を持っている」は、レビュー指摘に対する弁明・改訂の経緯そのもので、CLAUDE.md「Default to no comments」の対象。測っている数（`reads` 22 / `commitStatements` 21）は改訂後の spec が約束する性質（commit 1 回、outbox 1 文、読みは件数に比例）と矛盾しないので、**テストの検証内容は正しい**。直すのは文言だけ。
  - 提案: 3 か所とも改訂後の文（「書き込みは件数によらず 1 回の原子適用」「読み側と 1 turn の文数は件数に比例する」）を引く形に直し、`:320` の it は「経緯」ではなく「今の実測値をここで固定する」だけを述べる。`packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:389` にも同じ古い文言（"The spec's 'three statements whatever the count'"）が残っている（差分外だが同じ改訂の巻き添え）。

- **[W-003]** 適合ハーネスの JSDoc が、本 PR が決着させた scope 検証の線と正面から食い違う
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts:18-20`
  - 理由: 「Every port here gets `deps.scope` and owes the `scope 検証` rule … `owner_type` / `owner_id` must match the object's own `ScopeKey` on both restore and save」と書いてあるが、(a) `deps.scope` を受け取るのは `noteRepository` だけ（同ファイル 39-42 行 vs 43-56 行）、(b) 本 PR は `spec/database/index.md`「共通の規約」を改訂して `stored_files` / `storage_quotas` / `llm_usages` を検査対象外と明記し、adr.md ADR-024 がその理由を述べ、`storedFileRepository.ts:223-231` / `storageQuotaRepository.ts:107-113` の JSDoc もそう書いている。この束の JSDoc だけが旧規約のまま残っている。
  - 提案: 「scope 鍵を持つのは `notes` だけで、他は会計上の帰属列であり検査しない。物理分離は `_scope_identity` の pin が担保する」に書き換える。

- **[W-004]** 「cursor は署名されていない」へ契約語を寄せた決着（adr.md ADR-048）が、`spec/` 側の 3 か所に届いていない
  - 場所: `spec/database/index.md:115`（`note_routes` の「署名cursorはgenerationと各shardのkeysetを保持し」）、`spec/database/index.md:978`（`workspace_directory` の「全体200件の署名cursorでscatter-gather」）、`spec/adr/021-scope-sharded-data-plane.md:41`（「全体200件の署名cursorでshard別keysetを持ち」）
  - 理由: ADR-048 は `domain/note/ports/publicNoteQueryService.ts` の JSDoc から "signed" / "tampering" を落とし、`adapters/cloudflare/cursor.ts:16-21` に「**not authenticated**、capability として扱ってはならない」と明記した。ADR-048 の Consequences は memory 側 `cursor.ts` の文言追随だけを保留として挙げているが、canon 側の 3 か所には触れていない。`spec/database/index.md` は本 PR で改訂済みのファイルなので、AC-9 の「spec の持ち分を変えた決定は反映する」に掛かる。放置すると次の読者が「署名 cursor はもう実装されている / 実装すべき契約だ」と読む。
  - 提案: 3 か所を「opaque cursor（query fingerprint と shard generation を運ぶ。認証はしない）」へ直すか、少なくとも ADR-048 の結論へのリンクを 1 本張る。物理 shard 化の時点で署名を入れる判断が残るなら、その旨をそこに書く。

#### カバレッジ

- 確認:
  - `packages/core/src/adapters/cloudflare/cursor.ts`
  - `packages/core/src/adapters/cloudflare/search/bigram.ts`, `packages/core/src/adapters/cloudflare/search/highlight.ts`
  - `packages/core/src/adapters/cloudflare/projection/noteSearchRow.ts`, `.../projection/searchClauses.ts`, `.../projection/snapshotWriter.ts`, `.../projection/viewerCalendar.ts`
  - `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`
  - `packages/core/src/adapters/cloudflare/do/repositories/localNoteQueryService.ts`, `.../noteProjection.ts`, `.../noteRepository.ts`, `.../noteRevisionRepository.ts`, `.../storedFileRepository.ts`, `.../storageQuotaRepository.ts`, `.../llmUsageRepository.ts`, `.../appliedOperationStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts`, `.../publicNoteQueryService.ts`
  - `packages/core/src/adapters/cloudflare/do/schema.ts`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（projection 節）
  - `packages/core/src/adapters/cloudflare/sql/errors.ts`, `.../sql/executor.ts`, `.../sql/json.ts`, `.../sql/occGuard.ts`, `.../sql/session.ts`, `.../sql/statement.ts`, `.../execution/writeSet.ts`（投影経路の原子性・オーバーレイ・上限検査の判断材料として）
  - `packages/core/src/domain/note/ports/localNoteQueryService.ts`, `packages/core/src/domain/note/ports/publicNoteQueryService.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/searchEdges.test.ts`, `.../__tests__/r2.test.ts`, `.../__tests__/deleteFilesByOwner.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/ports/projection.ts`, `.../__tests__/ports/scopeBusiness.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/conformance/projection.test.ts`, `.../__tests__/conformance/scopeBusiness.test.ts`
  - `spec/database/index.md`, `spec/platform/index.md`（差分全量）
  - `.thread/11/plan.md`, `.thread/11/review/triage-keys.md`, `.thread/11/adr.md`（ADR-021 / 023 / 024 / 025 / 048 / 049 / 050 / 051）
  - 差分外の参照: `packages/core/src/domain/note/ports/{localNoteProjectionWriter,publicNoteProjectionWriter}.ts`, `packages/core/src/application/ports/objectStorage.ts`, `packages/core/src/domain/storage/valueObject.ts`, `packages/core/src/adapters/memory/repositories/{localNoteQueryService,publicNoteQueryService,noteProjection}.ts`, `packages/core/src/adapters/conformance/localNoteQueryService.ts`, `spec/adr/{006,011,013,017,027,033,049,050,056}.md`, `spec/testcases/storage/deleteFilesByOwner.md`

- スキップ:
  - `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,globalMaintenanceRunStore,idempotencyStore,identityRemovalReceiptStore,identityRepository,identitySupport,identityUniqueDirectory,loginAttemptStore,oauthStateStore,sessionRepository,userBatchReader,userRepository}.ts` — Identity / directory / maintenance 観点の持ち分
  - `packages/core/src/adapters/cloudflare/d1/repositories/{noteRouteFanOutReader,noteRouteStore,outboxRepository}.ts` — routing / outbox 観点の持ち分（`outboxRepository` は W-001 の対照として bind サイズ検査だけ参照）
  - `packages/core/src/adapters/cloudflare/do/repositories/{scopeCleanupAdmissionStore,scopeTaskScheduler}.ts`, `.../do/{alarm,dueIndex,scheduledTasks,scopeName,scopeObject,scopeStub}.ts`, `.../scopeRouter.ts`, `.../scopeTaskQueue.ts` — scope infra / alarm / routing 観点の持ち分
  - `packages/core/src/adapters/cloudflare/execution/{globalUnitOfWork,nesting,scopeUnitOfWork}.ts` — UoW 観点の持ち分
  - `packages/core/src/adapters/cloudflare/sql/row.ts` — 型変換ヘルパー。投影経路で使う関数の意味だけ呼び出し側から確認済み
  - `packages/core/src/application/di/{cloudflareRuntime,runtime}.ts` — composition 観点の持ち分（R2 の `publicBaseUrl` 配線だけ参照）
  - `packages/core/src/adapters/cloudflare/__tests__/{alarm,durability,globalConcurrency,harness,idempotency,lease,routeGuard,runtimeComposition,sessionOverlay,support,unitOfWork}.test.ts` — 対応する実装が観点外
  - `packages/core/src/adapters/cloudflare/__tests__/{conformanceBackend.ts,env.d.ts,worker.ts}`, `.../__tests__/ports/{deps,directory,identity,route,scopeInfra}.ts`, `.../__tests__/conformance/{directory,identity,route,scopeInfra,unitOfWork}.test.ts` — ハーネス / 他束の配線（`conformanceBackend.ts` は public writer のセッション種別の確認にだけ参照）
  - `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイート本数の固定。composition 観点の持ち分
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（projection 以外の節） — Identity / directory / infrastructure 表は他観点の持ち分
  - `.github/workflows/ci.yml`, `docs/test.md`, `package.json`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts` — ビルド / テスト実行基盤。composition 観点の持ち分
  - `.thread/11/{foundation.md,progress.md,steps.md,testing.md}`, `.thread/11/review/{review-001.md,review-001-composition.md,review-001-identity.md,review-001-routing.md,review-001-scope.md,review-001-uow.md,triage.md}` — 作業記録・前ラウンドの結果（ゼロベースの前提として意図的に読まない。`triage-keys.md` のみ既出判定のため参照）
