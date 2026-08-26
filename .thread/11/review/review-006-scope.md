### Scope business / 投影・全文検索 / R2

ゼロベースで再レビューした。前ラウンドの結論は前提にしていない。

#### Blockers

なし

#### Warnings

なし

#### 検証した論点（結論だけ）

以下はいずれも「問題なし」と判断した根拠である。指摘ではない。

**`highlightBody` の窓のコードポイント境界丸め（`splitsSurrogatePair`）**

- 窓が `text.length` を越えない: `to = Math.min(text.length, from + WINDOW_LENGTH)` で上から抑えられ、`splitsSurrogatePair` は `at >= source.length` で必ず `false` を返すので、`to === text.length` のときは丸めが走らない。
- 近端: `from` が上位/下位サロゲートの間にあるとき `from + 1` へ動く（対の後ろ）。遠端: `to - 1`（上位サロゲートの手前）。どちらも窓を**狭める**向きで、片割れが切り出しに入らない。丸めた両端はコードポイント境界なので `render` の `Math.max(start, from)` / `Math.min(end, to)` によるクランプも境界を割らない。
- 窓が潰れる余地はない: `from > 0` になるのは `first[0] > WINDOW_LEAD` のときだけで、そのとき `to - from >= 40`。丸めは各端 1 単位しか動かさない。
- `to` は丸め**前**の `from` から計算されるので、丸めが起きた回だけ窓が 159 単位になる。`spec/database/index.md:968` の「窓は 160 文字」に対する ±1 で、同節の主張（「それより後ろにしか一致が無い行は `null`」）を変えない。
- `<mark>` 以外の HTML エスケープは壊れていない: `render` は非標識区間・標識内容の両方を `escapeHtml` に通し、`&` を先に置換している。`searchEdges.test.ts` の "escapes everything but its own marks" が `<b>` / `&` / `"` / `'` / `<script>` を実際に固定している。境界丸め自体も "cuts the body window on code point boundaries" が孤立サロゲート 0 件を観測しており、実効的なテストがある。

**ASCII 速路（`asciiRunEnd` / `MIN_ASCII_RUN`）が遅路と一致するか**

- `asciiRunEnd` は「次が非 ASCII の ASCII 単位」の**手前**で止まるので、結合マークの基底になりうる ASCII 単位は速路が食わず、必ず Segmenter 側へ落ちる。CR も除外されるので CRLF クラスタが割れない。速路の終端も再開点もクラスタ境界。
- 内側ループの break は `start > base` でしか起きない（`base` では外側の判定が既に偽）ので無限ループにならない。
- 正しさが `searchEdges.test.ts` の 12 ケース × cluster-by-cluster オラクル（`referenceMap` / `referenceSlice`）で押さえられている。加えて「ASCII 128 文字すべてで `normalizeForSearch(u) === u.toLowerCase()` かつ長さ 1」「CR+LF 以外の ASCII 2 連は必ず 2 クラスタ」を全数で検査しており、速路の前提そのものがテストになっている。`spec/database/index.md:951` に同じ前提が canon として降りている。

**`viewerCalendar.formatterFor` のメモ化**

- 不正 TZ の扱いは変わらない。`buildOrFallback` が UTC へ倒し、その UTC formatter を不正キーで cache するだけなので、2 回目以降も UTC。`adapters/memory/timeZone.ts` の非メモ化版と同じ結果で、`TimeZoneResolver` の JSDoc（"invalid values fall back to `UTC` — there are no error cases"）とも整合する。
- キーが呼び出し側の任意文字列である risk は 32 件上限＋`clear()` で有界。最悪ケース（33 種以上を巡回）でも「毎回 clear → 毎回 build」に退化するだけで、これはメモ化前のコストと同じ。メモリは伸びない。

**`sha256Of` を view 直接へ渡す変更**

- `crypto.subtle.digest` は `BufferSource` の `byteOffset` / `byteLength` を尊重するので `subarray` の範囲が正しく効く。`ByteSize.create(body.byteLength)` も同じ範囲。
- `r2.test.ts` の "measures a view by its own range, not by its backing buffer" が `subarray(8, 21)` と独立配列の checksum 一致・格納バイト一致を実測しており、退行したら落ちる。

**bigram 前処理の共有と予算の粒度**

- `bigramIndexText` / `bigramMatchExpression` / `searchRunsOf` / `normalizeForSearch` が単一モジュールにあり、書き込み側・クエリ側・ハイライトの照合が同じ純関数を通る（ADR 011 / `spec/database/index.md#bigram-前処理`）。CJK 範囲は spec の表と 1 行ずつ一致（Ext B を含めないことも含めて）。
- 予算は 1 FTS 列あたり 1,800,000 バイトで、これは bound value の実上限（2,000,000）と同じ粒度。行サイズ予算（`spec/platform/index.md`「行サイズの予算」）は `note_search` 本体の話で、FTS の索引書き込みには掛からない。打ち切り単位（CJK はビグラム、非 CJK は空白区切り 1 語）も `spec/database/index.md:969` と一致し、`searchEdges.test.ts` が `㍿`×100,000（CJK 側）と `ﷺ`×60,000（非 CJK 単一 run 側）の両方で上限内であること・頭は引けて末尾は引けないこと・**置換後も contentless 索引が壊れないこと**（同じ切り詰めトークン集合が再導出される）を観測している。
- 純関数性が取り消しの前提なので、`replace` / `remove` が `stored` 行の生テキスト列から再導出する形も正しい。

**contentless FTS5 の rowid 解決と `bm25` の列重み**

- `'delete'` / insert とも `SELECT rowid FROM <table> WHERE note_id = ?` で解決し、bound value にしていない。同一 write-set 内で本体行が後から入る場合でも apply 時に解決される。順序も正しい（withdrawal → 本体 upsert → tags → insert、`remove` では withdrawal → 本体 DELETE）。
- `bm25(fts, 5.0, 1.0, 3.0)` は列順 `title_fts, text_fts, tag_names_fts` に対して title 5 > tag_names 3 > text 1 で、`spec/database/index.md:911` の「タイトル > タグ名 > 本文」と一致。bm25 は負値で小さいほど良いので `ASC` も正しく、`ranked` は `match !== null` のときだけ立つので `MATCH` 無しで `bm25()` を呼ぶ経路がない。
- `note_search_fts` / `public_note_search_fts` の DDL（`do/schema.ts` と `0001_global_schema.sql`）は spec の SQL と列名・`content=''`・`tokenize='unicode61'` まで一致。

**OCC（`version` 列 / 複合キー）と失敗経路**

- `noteRepository` / `storedFileRepository` / `storageQuotaRepository` / `llmUsageRepository` はいずれも「読んで比較 → `optimisticLockFailure`」＋「`occGuard` を同じ write-set の先頭に積む」の二段構え。複合キー側（`storage_quotas` の `(subject_type, subject_id)`、`llm_usages` の `(user_id, period_year, period_month)`）も guard 述語とオーバーレイキー（`compositeKey`）が同じ列で組まれている。
- `snapshotWriter.vectorGuard` は `stored === null` のとき `NOT EXISTS`、それ以外は世代ベクトル（public は `route_version` 込み）の等値。負けたときは commit ごと中断して `ConflictError` になり、`stale` へ畳まない — contentless 索引の取り消しが「読んだ行のトークン」を名指す以上これが正しい向きで、ポート JSDoc・`spec/domains/note.md:617 付近`の両方に同じ理由が降りている（AC-8 の四者整合が取れている）。
- `redactAuthor` は無条件 `UPDATE` ＋ guard の形で、3 つの no-op 判定が commit 時にも真であることを guard が保つ。
- 割り込みの実効テストがある: `projectionConcurrency.test.ts` が `interposeOnce` で「読みと apply の間に rival が commit する」を**確定的に**起こし、`replaceSnapshotIfNewer` / `removeIfNewer` / 初回投影 / `redactAuthor` / `bump` の 5 経路すべてで `ConflictError` と「勝者の状態が残る」「再配送が `stale` / `false` へ収束する」を観測。さらに `integrity-check` と 3 世代ぶんのキーワード検索で FTS 索引が壊れていないことまで見ている（`'rebuild'` が使えない以上これが唯一の観測手段）。

**`ObjectStorage`（R2）**

- `put` は実測の `byteLength` / SHA-256 を返し、`meta` の申告値を返さない（ポート JSDoc の要求どおり）。
- `deleteMany` は 1,000 key チャンク。空配列でループが 0 周するので R2 へ空 delete を投げない。`r2.test.ts` が 1,001 key で `[1000, 1]` を実測している。
- `publicUrl` は `${publicBaseUrl}/${prefix}${key}` で URL エンコードしないが、これは memory バックエンド（`/storage/{key}`）と同型で本 PR の退行ではない。パストラバーサルは `ObjectKey.create` が `..` と先頭 `/` を弾く時点で閉じている（ADR 049 が「鍵の形を知っているのは値オブジェクト」と定めた配置）。
- `keyPrefix` による分離は `r2.test.ts` の "keeps two prefixed storages from reaching each other's keys" が観測しており、適合スイートの「毎テスト fresh backend」要求（ADR-004）を実際に満たしている。

**AC-5（`deleteFilesByOwner` の実測 `4n + 3`）**

- 実測と記述が一致している。`deleteFilesByOwner.test.ts` は n=10 で reads 22 / commitStatements 21 / 合計 43、n=40 で 163 を固定し、さらに `state.storage.sql` を wrap して**オブジェクトが実際に実行した文数**が送った数と一致することまで見ている（「executor 呼び出し数」ではなく「SQL 文数」として引用できる根拠）。
- `spec/platform/index.md`「Scope DO」は「書き込みは件数によらず 1 回の原子適用」を設計目標に残したうえで、「1 turn の SQL 総数と読み側 RPC は件数比例」「Cloudflare 実測は `4n + 3`（読み `2n + 2` ＋ commit 内 `2n + 1`）」を明記。`spec/adr/056` のコンテキストが「どのバックエンドが届かないか」を引き受け、platform 側には書かないという 決定 3 の分担も守られている。`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例した追加の往復を要求しない」は動いておらず、platform 側に「ここでの往復はポート呼び出しの追加往復であって RPC 往復とは別の量」という曖昧さ解消の 1 文が足されている。
- `application/storage/__tests__/deleteFilesByOwner.test.ts` のコメントも「三文」から「1 回の原子適用」へ追随済み。

**その他**

- `resolveKeyword` の `MIN_KEYWORD_LENGTH = 2` は `raw.length`（UTF-16 コード単位）で、ADR 033 の「文字数は UTF-16 コード単位」と単位が揃っている。
- `bigramMatchExpression` は run をすべて二重引用符フレーズに包む（`"` は `""` 倍化）ので、FTS5 演算子が無力化されキーワードがクエリ言語にならない。`NON_WORD` で `\p{L}\p{N}_` 以外を落としてから前方一致 `*` を付ける形も `unicode61` の分割規則と整合する。
- 公開検索の可視性述語（`visibility = 'public' AND lifecycle = 'active'`）は cursor の有無にかかわらず `conditions` へ必ず積まれる。ADR 063 が「cursor は位置だけを決め、内容は決めない」と定めた要求を実装が満たしている。`bodyHighlights` の 2 本目の文も、可視ページから得た `note_id` だけを引くので漏洩経路にならない。
- `tagFilterBindings` の `Set` による重複除去は `COUNT(DISTINCT …)` との整合で必要なもので、local / public 両方に対する実効テスト（`searchEdges.test.ts` の "filters by a repeated tag name exactly as by a single one"）がある。Round 005 の決定どおり契約文はポート JSDoc から落ちており（`grep` で 0 件確認）、実装コメント側に残っている。
- `listMonthsWithNotes` の「UTC 日でグループ化して MIN/MAX の 2 点だけを見る」は、1 日 (<25h) がまたげるローカル月が高々 2 つであることから正しい。UTC 日境界が月境界をまたぐケースを `searchEdges.test.ts` が Asia/Tokyo と UTC の両方で観測している。
- write-set のステージ像はすべて全列（`snapshotRow` / 各 `toRow` / `{...stored, …}`）で組まれており、`RowsRead` の JSDoc が要求する不変条件を破っていない。`note_search_tags` と FTS への書き込みは `opaque` だが、同一 UoW で読み戻す経路が無い（クエリサービスは `ScopePlaneRepositories` に居ない）ので正しい選択。`touchedTables` の消費先も `SCHEDULED_TASKS_TABLE` の 1 か所だけで、表名を名乗らないことが影響しない。
- コメントに指摘への弁明・修正の経緯・レビュー履歴の類は見当たらない。長いものはすべて WHY（contentless 索引の制約、guard を条件付き UPDATE にしない理由、1 文 1 行 DELETE を選ぶ理由、ASCII 速路の前提）を書いている。

#### カバレッジ

- 確認: `packages/core/src/adapters/cloudflare/cursor.ts`, `packages/core/src/adapters/cloudflare/search/bigram.ts`, `packages/core/src/adapters/cloudflare/search/highlight.ts`, `packages/core/src/adapters/cloudflare/projection/noteSearchRow.ts`, `packages/core/src/adapters/cloudflare/projection/searchClauses.ts`, `packages/core/src/adapters/cloudflare/projection/snapshotWriter.ts`, `packages/core/src/adapters/cloudflare/projection/viewerCalendar.ts`, `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`
- 確認: `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts`, `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteQueryService.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/{appliedOperationStore,llmUsageRepository,localNoteQueryService,noteProjection,noteRepository,noteRevisionRepository,scopeCleanupAdmissionStore,storageQuotaRepository,storedFileRepository}.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/schema.ts`, `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`public_note_search` / `_tags` / `_fts` の節のみ）
- 確認（依存として契約を読んだもの）: `packages/core/src/adapters/cloudflare/sql/occGuard.ts`, `packages/core/src/adapters/cloudflare/sql/row.ts`, `packages/core/src/adapters/cloudflare/sql/session.ts`, `packages/core/src/adapters/cloudflare/execution/writeSet.ts`, `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`, `packages/core/src/adapters/cloudflare/scopeRouter.ts`
- 確認: `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`, `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`, `packages/core/src/domain/note/ports/publicNoteQueryService.ts`
- 確認（テスト）: `packages/core/src/adapters/cloudflare/__tests__/searchEdges.test.ts`, `.../projectionConcurrency.test.ts`, `.../r2.test.ts`, `.../deleteFilesByOwner.test.ts`, `.../conformance/projection.test.ts`, `.../conformance/scopeBusiness.test.ts`, `.../ports/projection.ts`, `.../ports/scopeBusiness.ts`, `.../ports/scopeInfra.ts`, `.../ports/route.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`
- 確認（canon）: `spec/database/index.md`（`note_search` / `note_search_tags` / タグ列の同期契約 / `note_search_fts` / bigram 前処理 / クエリ構築 / ハイライトと抜粋の生成 / 再構築 / 既知の限界 / `public_note_search*`）, `spec/platform/index.md`（R2 上限行・行サイズの予算・実行予算と分割単位）, `spec/adr/{011,017,021,027,033,049,056,063}.md`, `spec/adr/index.md`, `spec/domains/note.md`, `spec/testcases/note/{searchPublicNotes,projectNoteChanges}.md`
- スキップ: `.thread/11/**`（`plan.md` / `triage-keys.md` は契約・既出判定として読んだ。`adr.md` / `steps.md` / `progress.md` / `foundation.md` / `testing.md` / `review-00{1..5}-*.md` / `triage.md` は前ラウンドの記録でゼロベース判断の材料にしない）
- スキップ: `.github/workflows/ci.yml`, `README.md`, `docs/runtime_node.md`, `docs/test.md`, `package.json`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `vitest.config.ts`, `vitest.shared.ts`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` — ビルド / CI / ツール構成で composition 観点
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,globalMaintenanceRunStore,idempotencyStore,identityRemovalReceiptStore,identityRepository,identitySupport,identityUniqueDirectory,loginAttemptStore,noteRouteFanOutReader,noteRouteStore,oauthStateStore,outboxRepository,sessionRepository,userBatchReader,userRepository}.ts`, `packages/core/src/adapters/cloudflare/d1/schema.ts`, `0001_global_schema.sql` の identity / routing / infrastructure 節 — identity / routing 観点の持ち分
- スキップ: `packages/core/src/adapters/cloudflare/do/{alarm,dueIndex,scheduledTasks,scopeName,scopeObject,scopeStub}.ts`, `do/repositories/scopeTaskScheduler.ts`, `execution/{globalUnitOfWork,nesting,scopeUnitOfWork}.ts`, `sql/{errors,executor,json,statement}.ts` — UoW / routing 観点の持ち分
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/{alarm,durability,globalConcurrency,harness,idempotency,lease,routeGuard,runtimeComposition,sessionOverlay,support,unitOfWork}.test.ts`, `__tests__/conformance/{directory,identity,route,scopeInfra,unitOfWork}.test.ts`, `__tests__/{conformanceBackend.ts,env.d.ts,worker.ts,ports/deps.ts,ports/directory.ts,ports/identity.ts}` — 対応するアダプター群と同じ観点（uow / identity / routing / composition）
- スキップ: `packages/core/src/application/{cleanup/participants,cleanup/personalCleanup,errors,identity/requestPasswordReset,identity/resendVerificationEmail,ports/noteRouteFanOutReader,ports/scopeTaskScheduler,workers/scopeTaskRunner}.ts`, `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`, `packages/core/src/application/di/{cloudflareRuntime,runtime}.ts`, `packages/core/src/domain/identity/ports/authTokenRepository.ts` — identity / uow / composition 観点
- スキップ: `spec/domains/{identity,index,workspace}.md`, `spec/inventory/{adapter,domain,frontend,test,usecase}.md`, `spec/usecases/{identity,note}.md`, `spec/testcases/identity/{deleteAccount,listPublicProfiles}.md` — 台帳と identity / usecase 側の記述で composition / identity 観点

#### AC 検証（担当範囲内）

- **AC-1**: 投影・全文検索・R2・scope business のポート実装にスタブや仮実装は無い。未実装の残しは `assertActorWritable` の membership 側だけで、これはポートが存在しない表（`membership_removal_locks`）待ちであることが理由付きでコメントされ、memory と同じ振る舞いに揃っている。
- **AC-2 / AC-3**: `conformance/{projection,scopeBusiness}.test.ts` が共有スイートを実バインディング（`makeCloudflareConformanceBackend`）に対して呼び、スイート本体は 1 行も変わっていない。
- **AC-5**: 上記のとおり実測と `spec/platform/index.md` / `spec/adr/056` が整合。
- **AC-8**: 本ラウンドのポート JSDoc 変更（`OPTIMISTIC_LOCK_FAILURE` の追記、`removeForPurge` の ack 契約撤回、cursor の「署名」撤回）はいずれも**契約を弱める / 許可を足す**向きで、memory 側の振る舞い変更も適合スイートへのケース追加も要求しない。`spec/domains/note.md` と `spec/adr/063` に同じ決定が降りており、ポート・spec・実装・スイートの四者に食い違いは無い。
