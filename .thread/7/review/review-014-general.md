### general

ゼロベースで現在のツリーを検証した。手元で `pnpm typecheck`（両パッケージ green）、`pnpm lint`（違反 0、info 2 は Biome の設定移行案内のみ）、`pnpm test:node`（153 files、2532 passed / 3 skipped。skipped は既存の Google 資格情報ゲート）、`pnpm test:workers`（25 files、562 passed）を通した。

#### 台帳の写し直し（最重点）— 機械照合の結果

ヘッダーの手順（鍵 `<uc>: <前提> — <操作>`、写す列は `要素` と `要点`、`../../` → `../`）をそのままスクリプトにして、`spec/testcases/*/*.md` の全ファイルを `spec/inventory/test.md` と突き合わせた（多重集合として `要素` の過不足と、鍵一致行の `要点` の文字列一致を数える）。

| 範囲 | ファイル数 | 食い違い |
| --- | --- | --- |
| 本 PR の変更一覧にある testcases（note 15・storage 3・integration 1・tag 1） | 20 | **0** |
| それ以外（identity / job / moveNote / usage / workspace） | 23 ファイルに残存 | 99 単位（`要素` 過不足を 2 単位で数えて約 54 行。Issue #69 の持ち分） |

- **手順の再現性**: 手順どおりに写すと今の 20 ファイル分の行と完全一致する。相対リンクは台帳側 `](../…)` が `spec/inventory/` 起点で、testcases 側 `](../../…)` が各ファイル起点で、いずれも実在する（欠損 0）
- **範囲外への混入**: 台帳の差分（main 比・直近コミット比の両方）で変わった `| TC-… |` 行 84 行の `定義場所` はすべて上記 20 ファイルのアンカー。直近コミットで書き換えた 37 行 ＋ 新規 2 行も同じ。Issue #69 に切り出した identity / job / moveNote / usage / workspace 側の行には触れていない
- **TC-note-831 / 832 の 3 者一致**: 台帳 `test.md:2634-2635`（note 群の末尾、TC-note-830 の直後）↔ `spec/testcases/note/trashNote.md:27` / `restoreNoteRevision.md:6` ↔ `trashNote.test.ts:521` / `restoreNoteRevision.test.ts:103`。831 のテストは `scheduledTasks` に `TRASH_EXPIRY_TASK_KIND` の行が 1 件だけあり `dueAt === view.purgeAfter` を主張し（行の「反転させた行を答えに含める」を直接固定する — 含めなければ `deadline === null` で行が張られず `toEqual([...])` が落ちる）、832 は `getNote` の `title` / `content.html` と応答の一致と `onclick` の消失を主張する。付け替え前の ID（793 / 470）は元の行の内容に対応する別テスト（`trashNote.test.ts:539`、`restoreNoteRevision.test.ts:82,367`）が引き続き名乗っており、欠番も再利用も起きていない
- **書かれた行 ↔ テストの主張**（直近コミットで足した/直した行）: `updateNoteBody.md` の「2,000 段 = 22 KB / 50,000 段 = 550 KB」「深さの拒否は木ができる前」は `htmlProcessor.test.ts` の 2 本と一致。`collectOrphanMedia.md` の「位置を名指しながら読めない payload では `logger.warn` を 1 行、日次の payload では残さない」は `collectOrphanMedia.test.ts` の TC-storage-255 の 2 本目と `scopeTaskRunner.ts` の `!fromPayload` 分岐に一致。`restoreNoteRevision.md` の `NoteIsTrashed` / `NoteLockedByJob` の 2 行（TC-note-787 / 830）は `restoreNoteRevision.ts:66,72-78` の門と一致
- ID を名乗るテストが無い変更行は TC-note-790 / 792 / 795 / 801 の 4 行だが、いずれも別名のテストが同じ主張を固定している（`purgeExpiredTrash.test.ts:236` "backs the row off …"、同 `:253,284,313`、`listTrashedNotes.test.ts:139` PAGE-p14-002/003、`listNotes.test.ts`）。ADR 058 は `it` 名の TC ID を推奨に留めるので指摘にしない

#### 休止中 backend-storage / backend-note の範囲

- **`findNextPurgeDeadline` の「同一 UoW で反転させた行を含める」**（`spec/domains/note.md:439`）: `domain/note/ports/noteRepository.ts:34-43` の JSDoc、`spec/database/index.md:20` の (3)、`adapters/cloudflare/sql/session.ts:162-205` の `readRows`（保存ページに触れた行が載るときだけ拒否 → staged 行を `matches` で足して `compare` で並べ `limit` で切る）、`adapters/conformance/noteRepository.ts:138`（"includes a note the same unit of work trashed"、memory / cloudflare 両方 green）の 4 者が同じことを言っている。`trashNote.ts:armRetentionSweep` は `save` の後に同じ `ctx` で引く。`purgeExpiredTrash.ts:168` の同メソッドは書き込みのない UoW で引くので (3) の拒否条件に当たらない
- **storage / usage / integration**: `storeMedia`（受理 → SVG サニタイズ → サニタイズ後サイズで上限と容量を判定 → `put` → UoW で arm ＋ insert、失敗時は object を取り消す）、`ensureUploadAllowed`（UoW を開かず読みだけ、不在行は `initialize` の値、LLM 側は要求者の主体）、`collectOrphanMedia`（3 段構成、`limit` は読む行数、ノート数 5 / 文字数 16,000,000 の予算で打ち切って位置を前進、失敗 turn は位置保持で翌日）、`deleteFilesForNote` / `deleteBackupRecordsForNote` / `notePurgeFanOut`（personal receipt での受理、満ページ再 arm と `complete`、priority は turn の出自）は `spec/usecases/{storage,usage,integration}.md` の記述と一致。`notePurgeFanOut.readNotePurgeTurn` が空文字の `deletionOperationId` を `DataIntegrityError` にする直近の変更は `subscribers.test.ts:418-` が両方向（`""` / `"   "` は fault、absent / `null` は `null`）で固定している
- **note ドメイン / application**: `editing.ts` の入口門と commit 門（permission → trash → version の順）、`updateNoteBody` / `applyTextNodeEdits` / `restoreNoteRevision` / `renameNote` / `changeNoteStyleMode` はすべて `claimNoteForEdit` を通り、`restoreNoteRevision` の応答 `html` は `Note.updateBody` に渡した `processed.html` そのもの（`getNote` の `content.html` と同一）。`urlPolicy.ts` は純関数のみで、`RESOURCE_SCHEMES` / `NAVIGATION_SCHEMES` / `DATA_URL_MIME_TYPES` は ADR 013 の表と一致
- **台帳（機械照合）**: コード中の TC ID / ADP ID はすべて `spec/inventory/{test,adapter}.md` に行がある（逆向きの欠落 0）。`usecase.md` に足した UC 7 行（UC-note-021 / 022 / 037 / 038、UC-storage-003 / 010 / 012）は 7 つとも export が実在。`adapter.md` に足した ADP 行はすべて conformance に同 ID のケースがある。`PERSISTENCE_SUITES = 45` は memory / cloudflare 両 entry の登録数と一致

#### 横断的な整合

- **`typescript` の devDependency**（`apps/web/package.json:35`）: `^6.0.3` はルートの `typescript: ^6.0.3` と同じ範囲指定で、`pnpm-lock.yaml` の `apps/web` importer に `specifier: ^6.0.3 / version: 6.0.3` が 1 件足されただけ（他 importer に増減なし）。pnpm はワークスペースパッケージへ依存を公開 hoist しない（`pnpm-workspace.yaml` の public-hoist は `@types/*` のみ）ので、`liveReads.test.ts` の `import ts from "typescript"` には明示の宣言が要る。devDependencies のアルファベット順（`tsx` → `typescript` → `vite`）も守られている
- **ADR 参照**: `spec` / `docs` / `packages/core/src` / `apps/web/app` の `ADR nnn` / `ADR-nnn` / `spec/adr/nnn-` 参照を自前で走査し、`spec/adr/` に無い番号は 0。`.thread/` の引用は `adrReference.test.ts` 自身以外に 0
- **レイヤー / テストの配置**: `adrReference.test.ts` と `serverFunctionRegistration.test.ts` は `apps/web/app/__tests__/`（node project）、`liveReads.test.ts` は島の隣。`adapters/cloudflare/**` の新規テストは workers、それ以外は node（`vitest.shared.ts` の 1 文字列で排他）。`docs/test.md` の `liveReads` の説明（F = `useState` の束縛名 ∪ 派生 const、G = `await` を持つ関数 ∪ 名前呼びで到達する局所関数）はテスト冒頭の定義と一致
- **`docs/{backend,frontend}_implementation_example.md`**: `adapters/html/` の追加と "three small groups"、`NoteListBoard` / `NoteDetailIsland` の記述は実ファイルと一致

#### Blockers

なし

#### Warnings

- **[W-001]** `docs/test.md`「Convention scans」の記述が 2 点で実態と違う
  - 場所: `docs/test.md:93-98`（「Two of them run today」と `adrReference.test.ts` の項）、`apps/web/app/__tests__/adrReference.test.ts:32-36,108-118`
  - 理由: (a) 節は「`apps/web/app/`, `packages/core/src/`, `spec/` or `docs/` から引く `ADR <number>` はすべて `spec/adr/` に解決する」と書くが、テストの番号解決（`resolves every ADR number …`）は `SOURCE_FILES`（`apps/web/app` / `packages/core/src`）にしか掛からず、`spec/` / `docs/` は作業ログ引用の検査だけである（テスト自身のコメント「ADR 番号の解決は markdown なら相対リンクが担保するので、ここには作業ログの引用検査だけが掛かる」がそう言う）。`spec/` や `docs/` の裸の `ADR nnn` が dangling でもこのテストは緑のままなので、docs を信じた読み手は存在しない保証を受け取る。(b) 「Two of them run today」は同じファイルの Frontend 節が `serverFunctionRegistration` を「ソース走査で規約を見張るテスト」と呼び、実際に `routes/__root.tsx` の登録の必要集合をソースから計算している（`serverFunctionRegistration.test.ts:15-18`）ので 3 本ある
  - 提案: (a) は「`apps/web/app/` と `packages/core/src/` から引く番号が解決すること、およびその 2 つと `spec/` / `docs/` のいずれも作業ログを引かないこと」に書き直す（`spec/` / `docs/` の番号解決を保証したいなら、テストの `DOC_FILES` を番号解決の走査にも掛ける — markdown の相対リンク形 `spec/adr/nnn-` は `PATH_REFERENCE` が拾える）。(b) は `serverFunctionRegistration.test.ts` を 3 本目として列挙する

- **[W-002]** 経緯を語る記述「従来どおり」が canon（usecases / testcases / 台帳）に残っている
  - 場所: `spec/usecases/note.md:888`（「満たないページを引いた時点で早く抜けるのは従来どおり」）、`spec/testcases/note/emptyTrash.md:24`（同文）、写しの `spec/inventory/test.md:1755`（TC-note-779）
  - 理由: CLAUDE.md は `spec/` を「現在の姿だけを述べる」canon と定め、「従来」は以前の版を知らない読み手に意味を持たない。行の主張自体（満たないページで打ち切る）は `emptyTrash.ts` と一致しているので、直すのは文言だけ
  - 提案: 「満たないページを引いた時点で早く抜ける」に落とす。testcases が正なので `emptyTrash.md` を直してからヘッダーの手順で台帳の TC-note-779 を写し直す

- **[W-003]** `spec/inventory/adapter.md` / `usecase.md` の「最終同期」日付が本 PR の変更を反映していない
  - 場所: `spec/inventory/adapter.md:3`、`spec/inventory/usecase.md:3`（いずれも `最終同期: 2026-08-30`）
  - 理由: 本 PR は `adapter.md` に ADP 行を足し・書き換え（ADP-note-057、ADP-tag-019 ほか）、`usecase.md` に UC 行を 7 つ足しているのに、同じヘッダー規約の `test.md` だけを `2026-09-05` に更新した。3 台帳が同じ「生成元 / 最終同期」の形を取る以上、片方だけ古い日付は「この台帳は同期されていない」と読める
  - 提案: 両ファイルの日付を本 PR の同期日に揃える（editorial）

#### テスト保証

- `findNextPurgeDeadline` が同一 UoW で反転させた行を含める（`adapters/cloudflare/do/repositories/noteRepository.ts:findNextPurgeDeadline`、`adapters/memory/repositories/noteRepository.ts:findNextPurgeDeadline`） — 守っているテスト: `adapters/conformance/noteRepository.ts:ADP-note-057: findNextPurgeDeadline includes a note the same unit of work trashed`（memory は node、cloudflare は workers で両方 green）
- `trashNote` 手順 5 が空のゴミ箱の 1 件目で `purgeAfter` にアラームを張る（`application/note/trashNote.ts:armRetentionSweep`） — `application/note/__tests__/trashNote.test.ts:TC-note-831: the first note into an empty trash arms the sweep at its own purgeAfter`、同 `TC-note-793: a later note joining the trash leaves the sweep on the earliest purgeAfter`
- `restoreNoteRevision` の応答 `title` / `html` が読み直した姿と一致し、`html` はサニタイズ後（`application/note/restoreNoteRevision.ts`） — `application/note/__tests__/restoreNoteRevision.test.ts:TC-note-832: the response carries the same title and body a read would return`
- `readNotePurgeTurn` が空文字の `deletionOperationId` を fault にし、absent / `null` だけを「障壁なし」に読む（`application/cleanup/notePurgeFanOut.ts:readNotePurgeTurn`） — `application/workers/__tests__/subscribers.test.ts:describe readNotePurgeTurn`（`""` / `"   "` → `SystemError`、absent / `null` → `null`）
- 孤児掃引 payload の読み取りと warn の有無（`application/storage/collectOrphanMedia.ts:readOrphanMediaSweepTurn`、`application/workers/scopeTaskRunner.ts:ORPHAN_MEDIA_TASK_KIND`） — `application/storage/__tests__/collectOrphanMedia.test.ts:TC-storage-255`（2 本）
- 深さ上限の拒否が木ができる前に起きる（`adapters/html/htmlProcessor.ts`） — `adapters/html/__tests__/htmlProcessor.test.ts:TC-note-817`（2,000 段 / 50,000 段の 2 本）
- ADR 参照の解決と `.thread/` 引用禁止（`apps/web/app/`、`packages/core/src/`、`spec/`、`docs/`） — `apps/web/app/__tests__/adrReference.test.ts`（ただし番号解決はソース 2 ルートのみ — [W-001]）
- 台帳の同期手順そのものは実行形を持たない（設計判断。ラウンド 010〜013 で決着） — 本レビューの機械照合で 20 ファイル 0 件を実測

#### カバレッジ

- 確認: `spec/inventory/test.md`（全 43 testcases ファイルとの機械照合・ヘッダー・TC-note-831 / 832 の位置）, `spec/inventory/adapter.md`, `spec/inventory/usecase.md`, `spec/testcases/note/*.md`, `spec/testcases/storage/*.md`, `spec/testcases/integration/deleteBackupRecordsForNote.md`, `spec/testcases/tag/deleteAssignmentsForNote.md`（台帳との突き合わせ）, `spec/domains/note.md`（`findNextPurgeDeadline` の節）, `spec/domains/integration.md`（差分）, `spec/database/index.md:20`, `spec/usecases/note.md`（`trashNote` / `restoreNoteRevision` の節）, `spec/usecases/usage.md`（差分）, `spec/usecases/integration.md`（差分）, `spec/usecases/tag.md`（差分）, `docs/test.md`, `docs/backend_implementation_example.md`（差分）, `docs/frontend_implementation_example.md`（差分）, `apps/web/package.json`, `packages/core/package.json`, `pnpm-lock.yaml`（`typescript` / `parse5` の importer 差分）, `apps/web/app/__tests__/adrReference.test.ts`, `apps/web/app/__tests__/serverFunctionRegistration.test.ts`（性格の確認のみ）, `apps/web/app/components/note/NoteEditor/__tests__/liveReads.test.ts:1-80`（docs の記述との照合のみ）, `packages/core/src/application/note/{trashNote,editing,updateNoteBody,applyTextNodeEdits,restoreNoteRevision,restoreNote,renameNote,changeNoteStyleMode,listTrashedNotes,getNote,purgeExpiredTrash,jobs}.ts`, `packages/core/src/application/note/__tests__/{trashNote,restoreNoteRevision,purgeExpiredTrash,listTrashedNotes}.test.ts`（`it` 名と 831 / 832 の本文）, `packages/core/src/application/note/view.ts`（DTO 型）, `packages/core/src/application/storage/{storeMedia,collectOrphanMedia,deleteFilesForNote,deleteStoredObjects,view}.ts`, `packages/core/src/application/usage/ensureUploadAllowed.ts`, `packages/core/src/application/integration/deleteBackupRecordsForNote.ts`, `packages/core/src/application/cleanup/notePurgeFanOut.ts`, `packages/core/src/application/workers/__tests__/subscribers.test.ts`（差分）, `packages/core/src/domain/note/{noteRevision.ts,ports/noteRepository.ts,services/urlPolicy.ts}`, `packages/core/src/domain/storage/{ports/storedFileRepository.ts,services/storageUrlPolicy.ts}`, `packages/core/src/domain/integration/*.ts`, `packages/core/src/adapters/memory/repositories/{noteRepository,storedFileRepository}.ts`, `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts:451-470`, `packages/core/src/adapters/cloudflare/sql/session.ts:85-215`, `packages/core/src/adapters/conformance/{noteRepository,storedFileRepository,backupRecordRepository}.ts`（`it` 名と ADP-note-057 の本文）, `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`（定数）
- スキップ: `apps/web/app/components/**`（上記以外）, `apps/web/app/routes/**`, `apps/web/app/presentation/**`, `apps/web/app/routeTree.gen.ts`, `apps/web/app/components/note/NoteEditor/__tests__/liveReads.test.ts`（上記以外）, `spec/pages/index.md`, `spec/presentation/index.md`, `spec/manual-tests/editing.md` — frontend 担当（編集島の状態機械には深入りしない）
- スキップ: `packages/core/src/application/tag/**`, `packages/core/src/domain/tag/**`, `packages/core/src/adapters/*/repositories/tagAssignmentRepository.ts`, `packages/core/src/adapters/conformance/tagAssignmentRepository.ts`, `packages/core/src/adapters/*/__tests__/scopeGuards.test.ts`, `spec/domains/tag.md`, `spec/domains/index.md`（継続要求表）, `spec/platform/index.md`, `spec/testcases/tag/**`（台帳との突き合わせ以外） — backend-tag 担当（継続要求表には深入りしない）
- スキップ: `packages/core/src/adapters/html/{allowList,css,htmlProcessor}.ts`, `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`（TC-note-817 の fixture 以外）, `packages/core/src/application/note/{purgeNote,deleteNotesForOwner,emptyTrash,moveNote,createBlankNote,listNotes,listNoteRevisions}.ts`, `packages/core/src/domain/note/{note,valueObject,events,errorCode}.ts`, `packages/core/src/domain/note/services/noteAccessPolicy.ts`, `packages/core/src/domain/note/ports/htmlProcessor.ts`, `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`, `packages/core/src/adapters/{memory,cloudflare}/**`（上記以外・実行のみ）, `packages/core/src/application/identity/**`, `packages/core/src/application/ports/**`, `packages/core/src/application/{scope,execution/unitOfWork}.ts`, `packages/core/src/application/di/**`, `spec/adr/013-html-sanitization-policy.md` — 13 ラウンドで反復確認済みの領域。本ラウンドの差分（直近コミット）に含まれないため実行結果（両 project green）と台帳照合だけで確認した
