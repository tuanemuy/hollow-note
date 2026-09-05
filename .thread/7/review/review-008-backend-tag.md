# レビュー 008 — backend-tag（完全削除の波及と横断の配線）

ゼロベース。担当分の差分を全量読み、必要な範囲で差分外（`purgeNote` / `deleteNotesForOwner` / `purgeExpiredTrash` / `emptyTrash` の本体、D1 の `noteRouteStore` / `snapshotWriter`、`ScopeTaskScheduler` の契約）まで当たった。

### backend-tag

#### Blockers

なし。

今ラウンドの主眼だった **global statement の勘定は実装と一致している**。adapter を数え直した結果:

| 呼び出し | 実装 | 文数 |
| --- | --- | --- |
| `NoteRouteStore.resolve` | `readRow` 1 本 | 1 |
| `NoteRouteStore.beginPurge` | `requireRow` + `commit`（`_occ_guard` + upsert） | 3 |
| `PublicNoteProjectionWriter.removeForPurge` | `readStored` + guard + FTS delete（行が有るときだけ）+ 本体 delete + tags delete | 4〜5 |
| `NoteRouteStore.finishPurge` | `requireRow` + `commit` | 3 |

合計 11〜12 文。中断再開の枝（`resumeInternal` は `resolve` の代わりに `beginPurge` を使う）も abort の枝（`resolve` 1 + `beginPurge` 3 + `abortPurge` 3 = 7）もこの幅の内側。40 × 12 = 480、50 × 12 = 600 も正しい。`emptyTrash` の同期経路が `purgeNote`（`userRequest`）を呼ぶので `scopeRouter.resolveNote` を通るが、これは `routeStore.resolve` の薄いラッパーで 1 文のままであり、`viewerFor` → `resolveWorkspaceAccess` は `workspaceReaderFor`（scope-local）なので global 予算に足されない。600 は過小評価ではない。

`purgeNote` を回す経路が 3 つ（+ 画面からの 1 件削除）で尽きていることも、呼び出し元の全数を当たって確認した。分岐の判断 — Alarm 経由の 2 経路だけ 40 に落とし、利用者に見える閾値である 50 は据え置いて根拠を canon 化 — も妥当。

#### Warnings

**[W-001] spec/platform/index.md:164 / application/note/deleteNotesForOwner.ts:231 — 「同居」と「持ち回り」を同じ 40 文の余地から二重に支払っている。持ち回りには上限が無い**

新しい段落は 2 つの上振れ要因を並べたうえで、両方をまとめて「実上限 1,000 との差」で吸収させている。算術が閉じない。

- **同居だけで 960 を使う。** 同じ scope で `note.ownerPurgeContinued` と `note.trashExpiryContinued` が同時に due なら 80 notes × 12 = 960（これは canon 自身の見積もりで、`SCOPE_TASK_TICK_LIMIT = 100` と Scope Alarm 節 :204 の「1 turn は合計 100 行」に照らして正しい）。残るのは 40 文 ＝ purge 3 件ぶんしかない。
- **持ち回りは 1 件 12 文。** 同居した turn では持ち回り 4 件で 1,008 となり実上限を割る。「実上限 1,000 との差はこの同居と持ち回りのための余地」という一文は、同居を数えたあとにはもう成り立たない。
- **そして持ち回り集合に上限が無い。** `deleteNotesForOwner.ts:231-232` は `carried` をページの上に無条件で積む（`targetsOf`）。`carried` に入るのは `isOutOfReach`、つまり local delete が済んで route が resolve しなくなったノートだけなので、列挙（`listByOwner`）には二度と現れず、`targets = batchSize + N` になる。`removeForPurge` / `finishPurge` が継続的に失敗する障害（global D1 の不調）では 1 turn あたり最大 40 件ずつ `N` が増え、解消するものが無い。canon の「1 turn が**一時的に** 480 を超えることはある」は `N` が有界であることを前提にしているが、その前提はコードにも canon にも無い。payload も同じだけ膨らむ。

直し方はページ側を持ち回りで削ること — `listByOwner` の `limit` を `max(0, OWNER_PURGE_BATCH_SIZE - carried.length)` にすれば 1 turn の総ノート数が 40 で閉じ、canon も「同居 960 ＋ 持ち回りはその 40 の内側」と書けるようになる。持ち回りを捨てる方向は取れない（`deleteNotesForOwner.ts:275-282` のとおり、その id はこの turn のメモリ以外どこにも無い）。

参照ランタイムには D1 の予算が無いので実害は Cloudflare 移行時に出る。ただし *canon が自分の根拠として書いた算術が閉じていない*まま「40 は下げる余地はあっても上げる余地は無い」と結論している点は、値そのものより先に直すべき。canon が次の一手として挙げている「1 turn が訪問する purge 系 task を 1 本に絞る」は同居側だけの手当てで、持ち回り側は塞がらない。

**[W-002] spec/database/index.md:22 — 「その列を持つ行に触れるすべての経路で検査する」が参照バックエンドに掛からない**

改訂の方向は正しく、Cloudflare 側は `insert` / `listByNote` / `deleteByNote` の 3 経路すべてに guard が入り（`adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:697-720, 776-830`）、テストも 3 経路を個別に突いている。「検査は報告であって修復ではない」も実装（交差した行を残して `DataIntegrityError`）と一致している。

問題は文が無条件になったこと。memory は同じ表について `insert`（`adapters/memory/repositories/tagAssignmentRepository.ts:45`）だけを検査し、`listByNote`:73 と `deleteByNote`:77 は無検査。`notes.owner_type / owner_id` にいたっては `adapters/memory/repositories/noteRepository.ts` に検査が 1 つも無い。しかも `adapters/memory/__tests__/scopeGuards.test.ts` の JSDoc はこの節を根拠として引いている。理由（scope ごとに表が分かれるので読みが他 object の行を返しえない）は正しいが、canon の側にその限定が無い。

同じ規約の別の写しである `spec/inventory/adapter.md:275`（ADP-tag-012）/`:282`（ADP-tag-019）には「複数 scope の行が 1 つの表に載るバックエンドでは」という限定がある。ADP-tag-010（保存）は無条件で、memory も保存は検査している。つまり **inventory 側は現行実装のとおりに書けているのに、database/index.md だけが強すぎる**。database/index.md の一文に同じ限定を持ち込めば、2 つの canon と 2 つのバックエンドが 1 つの規約に揃う。

**[W-003] spec/domains/index.md:276-277 — 1 つの表の中で payload の書き方が 2 通りになった（editorial）**

:277 に足した `note.trashExpiryContinued` は payload を字義どおり `{}` と書き、「scope は task 行が持ち…」と、行が持つものは payload に書かないと明示した。一方 :276 の `note.ownerPurgeContinued` は同じラウンドで `stuckPurges` を足しながら `{ scope, ... }` のまま。実装の `continuationPayload`（`deleteNotesForOwner.ts:380-392`）が載せるのは `deletionOperationId` と `stuckPurges` だけで、`scope` は task 行が持つ。:277 で新しい物差しを採ったのだから、表の他の行（`note.ownerPurgeContinued`、`storage.ownerDeleteContinued`、`tag.scopeDeleteContinued`）も同じ物差しに揃えるか、:277 の注記を落として従来の「論理的な内容」表記に戻すか、どちらかに寄せる。今は同じ表の中で読み手が 2 通りに読める。

#### テスト保証

**担保できているもの**

- `TC-tag-023`〜`032`（10/10）と `TC-integration-016`〜`025`（10/10）が実在し、node プロジェクトで green（9 files / 71 tests）。ページ境界（450 件 / 250 件）、冪等な再配送、`deleteTagsForScope` との順序非依存、書き込み失敗の素通し、ワークスペース scope での受理拒否まで、canon の各行に 1:1 で対応している。
- `TagAssignmentRepository` / `BackupRecordRepository` の conformance がメモリと Cloudflare の**同一スイート**で走る（`conformanceCoverage.test.ts` の `PERSISTENCE_SUITES` を 43→45 に更新済み。workers プロジェクトで 49 tests green を確認）。順序（`AssignmentId` / `BackupRecordId` 昇順）を挿入順と食い違わせて入れているので、挿入順を再生するだけのバックエンドは落ちる。`limit <= 0` を `0` と `-1` の両方で突いている点、2 つの一意制約を別のエラー種へ写す点も executable。
- backend 固有の scope guard は `adapters/cloudflare/__tests__/scopeGuards.test.ts` が 3 経路（save / restore / bounded delete）と「1 件も消さない」を押さえている（workers で 5 tests green）。「復元」を突けるのは Cloudflare だけ、という理由付けも正しい。
- **購読者の登録そのものがアサーションになっている**（`subscribers.test.ts` の「registers one subscriber per follower」）。`dispatchDomainEvent` が未購読イベントを warn だけで ack する以上、これが無ければ「書いたが配線し忘れた」が全テスト green のまま通る。ここは効いている。
- 兄弟購読者の独立実行（先に投げた兄弟があっても後続を走らせ、最初の失敗だけ再送出）に、合成レジストリの直接テストと、実レジストリ上の `identity.accountDeletionDispatchContinued` の窓（scope plane を落として global half の receipt だけ入ることを見る）の 2 本がある。
- `readNotePurgeTurn` の壊れた payload（空・空白のみ・数値・不正 token）が `SystemError(DataIntegrityError)` になることが個別に押さえられている。`NoteId.create` が trim する以上 `""` だけの検査では足りない、という理由も書かれている。
- `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` が participants レジストリ由来である性質を、`deleteAccount.terminalPrune.test.ts` がハードコード配列を定数に置き換えて使うことで維持している。`note` 成分の追加が `deleteAccount.cleanup.test.ts` の期待値（`["note","storage","usage"]`）に現れる。

**担保できていないもの（Warning には上げない）**

- **追随者の継続行に対する 2 ドライバー同時実行の窓**。`notePurgeFanOut.ts:200-227` の「リースを取らないリレー再配送とリースを取る runner が同じ `(kind, operationId)` を触っても、短いページを報告する turn は必ず残りが無い turn である」という論証は散文だけで、`docs/test.md` の「Injecting into a concurrency window」の形になっていない。読み直した限り論証自体は正しい（`deletedCount` は読んだ行数で、行は増えない）が、`complete` が絶対（不在でも行を消す・fencing 無し）である以上、これは継続の連鎖が切れないことを支える唯一の根拠になっている。
- **11〜12 文という数値に機械的な歯止めが無い**。この数が 3 つの canon（platform / usecases/note / 各 batch 定数の JSDoc）と 40 という定数を支えているのに、`removeForPurge` が 5 文目・6 文目を足しても落ちるテストが無い。session が発行した statement 数を数える backend-local テストがあれば、この数は宣言から検証済みの性質になる。
- `TC-tag-024`（「タグ本体は残る」）は Tag 集約が無いため、「`tagAssignments` 以外のどの表の件数も変わらない」という代理でしか確認できていない。curation スライスで本来の形に戻す必要がある。

#### カバレッジ

**読んだファイル（担当分・全量）**

- `packages/core/package.json`、`pnpm-lock.yaml`
- `packages/core/src/domain/tag/{valueObject,errorCode,tagAssignment,ports/tagAssignmentRepository,__tests__/valueObject.test}.ts`
- `packages/core/src/domain/integration/{valueObject,errorCode,backupRecord,ports/backupRecordRepository,__tests__/valueObject.test}.ts`
- `packages/core/src/application/tag/{deleteAssignmentsForNote,__tests__/deleteAssignmentsForNote.test}.ts`
- `packages/core/src/application/integration/{deleteBackupRecordsForNote,__tests__/deleteBackupRecordsForNote.test}.ts`
- `packages/core/src/application/cleanup/{notePurgeFanOut,participants}.ts`
- `packages/core/src/application/workers/{subscribers,scopeTaskRunner,__tests__/subscribers.test}.ts`
- `packages/core/src/application/identity/{deleteAccount/authorRedaction,deleteAccount/cleanupDispatch,__tests__/deleteAccount.cleanup.test,__tests__/deleteAccount.terminalPrune.test}.ts`
- `packages/core/src/application/di/{types,memoryRuntime,cloudflareRuntime}.ts`
- `packages/core/src/application/execution/unitOfWork.ts`、`packages/core/src/application/scope.ts`
- `packages/core/src/application/ports/{noteMovePort,noteRouteStore,objectStorage}.ts`
- `packages/core/src/adapters/memory/{store,scopeUnitOfWork,repositories/tagAssignmentRepository,repositories/backupRecordRepository,__tests__/conformance.test,__tests__/conformanceBackend,__tests__/scopeGuards.test}.ts`
- `packages/core/src/adapters/cloudflare/do/{schema,repositories/tagAssignmentRepository,repositories/backupRecordRepository}.ts`
- `packages/core/src/adapters/cloudflare/__tests__/{conformance/scopeBusiness.test,conformanceBackend,deleteFilesByOwner.test,ports/scopeBusiness,runtimeComposition.test,scopeGuards.test}.ts`
- `packages/core/src/adapters/conformance/{backend,tagAssignmentRepository,backupRecordRepository}.ts`、`packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `spec/database/index.md`、`spec/domains/index.md`、`spec/domains/{tag,integration}.md`、`spec/platform/index.md`、`spec/inventory/{adapter,test,usecase}.md`、`spec/usecases/{tag,integration}.md`、`spec/testcases/{tag/deleteAssignmentsForNote,integration/deleteBackupRecordsForNote}.md`

**差分外で参照したファイル（判断のため）**

`application/note/{purgeNote,deleteNotesForOwner,purgeExpiredTrash,emptyTrash,editing,accessControl}.ts`、`application/ports/{scopeTaskScheduler,scopeCleanupAdmissionStore}.ts`、`application/workspace/resolveWorkspaceAccess.ts`、`adapters/cloudflare/d1/repositories/{noteRouteStore,publicNoteProjection}.ts`、`adapters/cloudflare/projection/snapshotWriter.ts`、`adapters/cloudflare/scopeRouter.ts`、`adapters/memory/repositories/noteRepository.ts`、`adapters/conformance/fixtures.ts`、`domain/note/events.ts`、`spec/usecases/{note,storage}.md`（当該節のみ）、`spec/inventory/domain.md`、`docs/test.md`、`CLAUDE.md`

**スキップしたファイル（担当外）**

`apps/web/**` 全 38 ファイル、`packages/core/src/adapters/html/**`、`packages/core/src/adapters/{memory,cloudflare}` の storedFile / note リポジトリ、`packages/core/src/application/note/**`（上記の参照を除き差分としてはレビューせず）、`packages/core/src/application/storage/**`、`packages/core/src/application/usage/**`、`packages/core/src/domain/{note,storage}/**`、`spec/adr/013-html-sanitization-policy.md`、`spec/domains/{note,storage}.md`、`spec/manual-tests/editing.md`、`spec/pages/index.md`、`spec/presentation/index.md`、`spec/usecases/{note,storage}.md`、`spec/testcases/{note,storage}/**`

**実行した検証**

- `npx vitest run --project node`（application/{tag,integration,workers}、domain/{tag,integration}、adapters/__tests__）— 9 files / 71 tests green
- `npx vitest run --project workers packages/core/src/adapters/cloudflare/__tests__/scopeGuards.test.ts` — 5 tests green
- `npx vitest run --project workers .../conformance/scopeBusiness.test.ts` — 49 tests green
- `.thread/` への参照がコード・`spec/`・`docs/` に無いことを確認（0 件）
- 一時ファイルは作成していない
