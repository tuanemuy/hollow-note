### Scope business / 投影・全文検索 / R2

#### Blockers

なし。

本ラウンドの中心である `search/highlight.ts` の ASCII 速路について、遅路との一致を次のとおり検証した（いずれも欠陥なし）。

- **クラスタ境界**: `asciiRunEnd` は「`code >= 0x80`」「`code === CR`」「次のユニットが非 ASCII」の 3 条件で run を切る。UAX #29 で ASCII ユニットが単独クラスタにならない結合規則は **GB3 (CR × LF)** と **GB9b (Prepend × 任意)** の 2 つだけで、Extend / ZWJ / SpacingMark / Hangul jamo / Regional Indicator / Indic linker はすべて U+0300 以上（Prepend の最小は U+0600）。CR は明示除外、Prepend は「非 ASCII が先行する」形なので run に含まれえない（run に入るには当該ユニット自身が ASCII である必要があり、Prepend の直後の ASCII は「前のユニットが非 ASCII」で run の起点にならない — 前の run は `charCodeAt(end+1) >= 0x80` で 1 つ手前で切れる）。3 条件は必要十分である
- **run 端が常にクラスタ境界であること**: 起点 `at` は 0 / 前の `runEnd` / セグメンターの `index` のいずれかで、いずれも真の境界。終点 `runEnd` は EOS・CR の直前・非 ASCII の 1 つ手前のいずれかで、これも境界。したがって `source.slice(base)` に対する再セグメントは全体をセグメントした場合と同じ境界を返す（RI パリティと GB11 の左文脈は真の境界でリセットされる）
- **ASCII の NFKC 恒等性と 1:1 の小文字化**: ASCII 符号位置に互換分解はなく、`toLowerCase` は A–Z のみを 1 ユニット→1 ユニットで写す。境界をまたぐ合成も起きない — 正準合成の第 2 要素になりうる文字（結合文字・Hangul V/T）に ASCII は 1 つも無いため、run の直前の非 ASCII クラスタと run 先頭が合成することはない。`searchEdges.test.ts:433-454` が 0x00–0x7F を全走査してこの 2 性質（`normalizeForSearch(unit) === unit.toLowerCase()` と長さ 1、および CR+LF 以外の全 ASCII ペアが 2 クラスタ）を固定している
- **速路／遅路の一致**: `searchEdges.test.ts:300-431` が「クラスタ 1 つずつ写す」参照実装を oracle に置き、長い ASCII 連なり・1 文字だけ非 ASCII で割れる連なり・閾値未満の run・結合マーク・サロゲートペア・ZWJ 列・CRLF・全角・Prepend・NFKC 展開の 12 ケースで `highlightExcerpt` / `highlightBody` の標識位置が oracle と一致することを観測している。これは実効的なテストである
- **XSS**: `render` が `<mark>` の内外いずれも `escapeHtml`（`& < > " '`）に通し、`ELLIPSIS` 以外にリテラルの markup を混ぜない。速路は写像だけを短絡し `render` を通らないので、経路によるエスケープの差は無い。`searchEdges.test.ts:456-465` が `<b>` / `&` / `"` / `'` / `<script>` を含む本文で固定している

あわせて次も確認し、問題を認めなかった。

- **bigram の単一実装共有**: 書き込み側 `bigramIndexText` とクエリ側 `bigramMatchExpression`、ハイライトの `searchRunsOf` がいずれも `splitRuns(normalizeForSearch(...))` を通る。CJK 文字クラスは ADR 011 の 7 レンジ（U+3005–3006 / 3040–309F / 30A0–30FF / 31F0–31FF / 3400–4DBF / 4E00–9FFF / F900–FAFF）と 1 対 1。予算 `MAX_INDEX_TEXT_BYTES` の打ち切りはトークン単位で決定的なので、contentless 索引の取り消しが「入れたときと同じトークン」を再導出できる性質を壊さない（`searchEdges.test.ts:171-269` が CJK 側・非 CJK 側の両方で打ち切りと再導出を観測）
- **contentless FTS5 の rowid 解決と列重み**: `snapshotWriter.ts:96-109` が `'delete'` / INSERT の双方で `SELECT rowid FROM <table> WHERE note_id = ?` により rowid を適用時に解決し、`replace` は withdrawal → body upsert → tag → insert の順、`remove` は withdrawal → body delete の順で、いずれも rowid が生きている時点で撃たれる。`bm25(fts, 5.0, 1.0, 3.0)` は `spec/database/index.md:910` / ADR 011 の「タイトル > タグ名 > 本文」と列順（`title_fts`, `text_fts`, `tag_names_fts`）どおり
- **完全 snapshot writer が唯一の書き手**: `note_search*` / `public_note_search*` の 3 表 + FTS を書くのは `createNoteSnapshotWriter` だけで、両 plane がこれを共有する。`redactAuthor` だけが列限定の `UPDATE` だが、FTS 索引の外の列なのでトークンには触れない
- **世代ベクトルの `occGuard`**: `vectorGuard` が「行が無い」「読んだベクトル（public は `route_version` 込み）と一致する」を適用時点で再検査し、敗北時は `_occ_guard` の CHECK 違反で単位ごと中断する。`projectionConcurrency.test.ts` が rival の割り込みを `interposeOnce` で決め打ちし、`replaceSnapshotIfNewer` / `removeIfNewer` / 初回投影 / `redactAuthor` / `bump` の 5 経路で「敗者は書かない」「勝者のトークンが残る」「再配送が `stale` か no-op へ収束する」を `integrity-check` と 3 世代ぶんのキーワード検索で観測している
- **AC-5**: `deleteFilesByOwner.test.ts` が実バインディング上で `reads = 2n + 2` / `commitStatements = 2n + 1` を測り、DO 内部で実際に走った文数（`state.storage.sql.exec` をラップして計数）と一致することまで固定している。`spec/platform/index.md` の当該行は「書き込みは件数によらず 1 回の原子適用」「1 turn の SQL 総数と読み側の RPC は件数に比例し、実測 `4n + 3`」へ改訂され、実測と 1 対 1。`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例しない」は動かしておらず、`application/storage/__tests__/deleteFilesByOwner.test.ts` のコメントも新しい表現へ追随している
- **`spec/` の改訂**: purge ack の撤回（`publicNoteProjectionWriter.removeForPurge` の JSDoc / `spec/domains/note.md:670`）、OCC 失敗を `stale` へ畳まない理由（両 writer の JSDoc / 同 620）、ハイライトの ASCII 一括写像（`spec/database/index.md:950`）、新しい「既知の限界」3 行（本文前方 4,000 文字・索引テキストのバイト予算・クラスタを跨ぐ文脈依存小文字化）はいずれも実装と 1 対 1。ADR 011「既知の限界」との重複も矛盾しない
- **ObjectStorage**: `put` は宣言された `meta` ではなく実測した `byteLength` と実測 SHA-256 を返す。`deleteMany` は 1,000 key 単位で分割し、空入力では呼び出しを起こさない。`publicUrl` は `publicBaseUrl` を実装内に閉じる（ADR 049）。パストラバーサルは `ObjectKey.create` が `..` と先頭 `/` を拒む（値オブジェクト側の境界検証）。`r2.test.ts` が同一 key の並行 write・不在 key の削除・1,000 + 1 の分割・prefix 分離を実バケットで観測している
- **cursor**: 署名の撤回は ADR 063 で決着済みのため再審議しない。fingerprint 不一致・復号不能をいずれも `ValidationError("INVALID_PAGINATION")` に倒す実装と、`spec/domains/note.md` / `spec/testcases/note/searchPublicNotes.md` の改訂は一致している。読み側が `PUBLISHED` 述語を cursor と無関係に毎回掛けている点も確認した
- **コメント**: `adapters/cloudflare/` 配下に TODO / FIXME / レビュー経緯・弁明の類は 1 件も無い

#### Warnings

- **[W-001]** `Intl.DateTimeFormat` を行ごとに構築している
  - 場所: `packages/core/src/adapters/cloudflare/projection/viewerCalendar.ts:15-26`（呼び出し側は `do/repositories/localNoteQueryService.ts:186,211`）
  - 理由: `formatterFor` は毎回 `new Intl.DateTimeFormat(...)` を作る。`countByDay` は返った行ごとに `dayKeyOf` を呼ぶので構築回数が行数に比例し、`listMonthsWithNotes` は行あたり 2 回呼ぶ。`Intl.DateTimeFormat` の構築は ICU のロケール／タイムゾーン解決を伴うため、`format` の呼び出しに比べて 1 桁以上高い。範囲に数千件ある利用者のカレンダーで、純粋に無駄な CPU が DO の turn に載る。さらに `timeZone` が不正な場合は「throw してから UTC で作り直す」ので、行ごとに 2 回構築＋2 回の例外になる。呼び出し 1 回のあいだ `timeZone` は不変なので、この構築は完全に外へ括り出せる
  - 提案: `formatterFor` を time zone をキーにした `Map` でメモ化する（`viewerCalendar.ts` 内のモジュールスコープで十分）。あるいは `wallClockOf` / `dayKeyOf` を「フォーマッタを受け取る」形にし、`countByDay` / `listMonthsWithNotes` が 1 回だけ作る。なお現状 `LocalNoteQueryService` を呼ぶ usecase はまだ無いので、実害が出るのは利用側スライスが入ってからである

- **[W-002]** `sha256Of` が本文全体を複製しており、その根拠として書かれた理由が事実と違う
  - 場所: `packages/core/src/adapters/cloudflare/r2/objectStorage.ts:51-62`
  - 理由: コメントは「view は大きなバッファへの窓かもしれず、そのままでは誤ったバイトを digest する」と述べるが、`crypto.subtle.digest` は `BufferSource` を受け取り、仕様上 view の `byteOffset` / `byteLength` が示す範囲だけをコピーして使う。`Uint8Array` をそのまま渡して誤った範囲が digest されることはない。したがってこの複製は不要で、代わりにアップロード本文ぶんの `ArrayBuffer` を余計に確保する — Workers の 128MB メモリ制約の下で、大きなファイルの `put` が本文を 2 部持つことになる。「WHY が非自明なときだけコメントを置く」という規約からすると、誤った WHY が残っているのはコメントが無いより悪い
  - 提案: `crypto.subtle.digest("SHA-256", body)` に直し、コメントを落とす。どうしても複製を残すなら（SharedArrayBuffer 由来の view を弾くため等）、実際に成立する理由へ書き換える

- **[W-003]** 本文ハイライトの窓が UTF-16 ユニット境界で切られ、サロゲートペアを割りうる
  - 場所: `packages/core/src/adapters/cloudflare/search/highlight.ts:237-248`
  - 理由: `from = first[0] - WINDOW_LEAD` と `to = from + WINDOW_LENGTH` は UTF-16 コードユニットのオフセットで、書記素クラスタどころかコードポイントの境界にも揃っていない。一致点の 40 ユニット手前がサロゲートペアの途中に当たると、返る HTML の先頭に対になっていないサロゲートが載る（末尾側も同様）。表示は U+FFFD になるだけで安全側には倒れるが、モジュール JSDoc の「返す断片は利用者が実際に書いたテキストの一部である」という主張と、`spec/database/index.md` の「返す文字列は常に元テキストの一部」からは外れる。`highlightExcerpt` は窓が `[0, excerpt.length]` なので影響を受けず、影響は `highlightBody` の経路だけ
  - 提案: `from` / `to` を決めたあと、`from` が下位サロゲート・`to` が上位サロゲートに当たっていたら 1 ユニットずらす。位置写像 `map.starts` / `map.ends` は既にクラスタ境界を持っているので、窓を「最も近いクラスタ境界」へ丸める形でも良い

#### カバレッジ

**確認（自分の観点の中心）**

- `packages/core/src/adapters/cloudflare/search/bigram.ts`, `packages/core/src/adapters/cloudflare/search/highlight.ts`
- `packages/core/src/adapters/cloudflare/projection/noteSearchRow.ts`, `.../projection/searchClauses.ts`, `.../projection/snapshotWriter.ts`, `.../projection/viewerCalendar.ts`
- `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`, `packages/core/src/adapters/cloudflare/cursor.ts`
- `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts`, `.../d1/repositories/publicNoteQueryService.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/noteProjection.ts`, `.../do/repositories/localNoteQueryService.ts`, `.../do/repositories/noteRepository.ts`, `.../do/repositories/noteRevisionRepository.ts`, `.../do/repositories/storedFileRepository.ts`, `.../do/repositories/storageQuotaRepository.ts`, `.../do/repositories/llmUsageRepository.ts`, `.../do/repositories/appliedOperationStore.ts`, `.../do/repositories/scopeCleanupAdmissionStore.ts`
- `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`, `.../localNoteQueryService.ts`, `.../publicNoteProjectionWriter.ts`, `.../publicNoteQueryService.ts`
- `packages/core/src/adapters/cloudflare/__tests__/searchEdges.test.ts`, `.../projectionConcurrency.test.ts`, `.../r2.test.ts`, `.../deleteFilesByOwner.test.ts`, `.../support.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformance/projection.test.ts`, `.../conformance/scopeBusiness.test.ts`, `.../conformanceBackend.ts`, `.../ports/projection.ts`, `.../ports/scopeBusiness.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`

**確認（判断のために読んだ差分外・周辺）**

- `packages/core/src/adapters/cloudflare/sql/occGuard.ts`, `.../sql/session.ts`, `.../sql/json.ts`, `.../sql/row.ts`, `.../execution/writeSet.ts`（投影・business 群が依存する overlay / 束縛上限 / guard の意味論の確認）
- `packages/core/src/adapters/cloudflare/do/schema.ts`, `.../d1/migrations/0001_global_schema.sql`（`note_search*` / `public_note_search*` の DDL・索引・contentless FTS5 の宣言）
- `packages/core/src/application/di/cloudflareRuntime.ts`, `packages/core/src/application/di/runtime.ts`（投影 writer / R2 の本番配線と `keyPrefix = ""` の確認）
- `packages/core/src/domain/storage/valueObject.ts`（`ObjectKey` の境界検証）
- `spec/database/index.md`（scope 側の表・`#bigram-前処理`・FTS 各表・ハイライトと抜粋・既知の限界・`_occ_guard`）、`spec/platform/index.md`（実上限表・実行予算と分割単位）、`spec/domains/note.md`、`spec/adr/011-bigram-search.md`, `spec/adr/021-scope-sharded-data-plane.md`, `spec/adr/063-public-cursor-not-authenticated.md`
- `spec/testcases/note/searchPublicNotes.md`, `spec/testcases/note/projectNoteChanges.md`, `spec/testcases/identity/deleteAccount.md`, `spec/testcases/identity/listPublicProfiles.md`, `spec/domains/workspace.md`
- `.thread/11/plan.md`, `.thread/11/review/triage-keys.md`

**スキップ**

- `.thread/11/{adr,foundation,progress,steps,testing}.md`, `.thread/11/review/review-00{1,2,3,4}*.md`, `.thread/11/review/triage.md` — 作業記録・過去ラウンドの結果。ゼロベース指示のため参照しない（`plan.md` と `triage-keys.md` のみ既出判定に使用）
- `.github/workflows/ci.yml`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.shared.ts`, `packages/core/vitest.workers.config.ts`, `packages/core/wrangler.test.jsonc`, `packages/core/tsconfig.json`, `packages/core/tsconfig.cloudflare.json`, `README.md`, `docs/runtime_node.md`, `docs/test.md` — ビルド／テスト基盤とドキュメント。composition 観点の持ち分
- `packages/core/src/adapters/cloudflare/d1/repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,globalMaintenanceRunStore,idempotencyStore,identityRemovalReceiptStore,identityRepository,identitySupport,identityUniqueDirectory,loginAttemptStore,oauthStateStore,outboxRepository,sessionRepository,userBatchReader,userRepository}.ts`, `packages/core/src/adapters/cloudflare/d1/schema.ts` — identity / directory / route / outbox 観点の持ち分（`d1/schema.ts` は `public_note_search*` の表名解決のみ参照）
- `packages/core/src/adapters/cloudflare/do/{alarm,dueIndex,scheduledTasks,scopeName,scopeObject,scopeStub}.ts`, `.../do/repositories/scopeTaskScheduler.ts`, `.../scopeRouter.ts`, `.../scopeTaskQueue.ts` — routing / scope infra 観点の持ち分
- `packages/core/src/adapters/cloudflare/execution/{globalUnitOfWork,nesting,scopeUnitOfWork}.ts`, `.../sql/{errors,executor,statement}.ts` — UoW 観点の持ち分
- `packages/core/src/adapters/cloudflare/__tests__/{alarm,durability,globalConcurrency,harness,idempotency,lease,routeGuard,runtimeComposition,sessionOverlay,unitOfWork}.test.ts`, `.../__tests__/conformance/{directory,identity,route,scopeInfra,unitOfWork}.test.ts`, `.../__tests__/ports/{deps,directory,identity,route,scopeInfra}.ts`, `.../__tests__/{env.d.ts,worker.ts}` — 上記各観点に対応するテスト
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — 適合スイート網羅のメタテスト。composition 観点の持ち分
- `packages/core/src/application/cleanup/{participants,personalCleanup}.ts`, `.../application/errors.ts`, `.../application/identity/{requestPasswordReset,resendVerificationEmail}.ts`, `.../application/ports/{noteRouteFanOutReader,scopeTaskScheduler}.ts`, `.../application/workers/scopeTaskRunner.ts`, `.../application/workers/__tests__/scopeTaskRunner.test.ts`, `.../domain/identity/ports/authTokenRepository.ts` — identity / worker 観点の持ち分
- `spec/adr/index.md`, `spec/domains/{identity,index}.md`, `spec/inventory/{adapter,domain,frontend,test,usecase}.md`, `spec/usecases/{identity,note}.md` — 台帳と他ドメインの正本。`spec/usecases/note.md` は投影・検索の記述を含むが本 PR の差分は cursor 語の置換のみで、同内容を `spec/domains/note.md` 側で確認済み
