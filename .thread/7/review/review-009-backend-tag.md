### backend-tag

#### Blockers

なし

#### Warnings

- **[W-001]** `spec/domains/index.md` の継続要求表に足した「scope はどの payload にも現れない」という規則と、同じ規則で `scope` を落とした `tag.scopeDeleteContinued` / `storage.ownerDeleteContinued` の行が、ユースケース側の記述と食い違ったまま残っている
  - 場所: `spec/domains/index.md:273`（新設の規則）、`spec/domains/index.md:282`（`tag.scopeDeleteContinued` `{ deletionOperationId }`）に対して `spec/usecases/tag.md:398`（`tag.scopeDeleteContinued { scope, deletionOperationId }`）。同じ形で `spec/usecases/storage.md:518`（`storage.ownerDeleteContinued { scope, deletionOperationId }`）、`spec/usecases/usage.md:248`（`usage.userCleanupContinued { scope, deletionOperationId }`）
  - 理由: 本 PR は index の行を `{ scope, deletionOperationId }` → `{ deletionOperationId }` へ書き換え、「payload の欄は task 行に積む値そのもの」と一般規則化した。実装（`settleNotePurgeTurn` / `scopeTaskRunner` は `task.scope` を行から取り payload に載せない）はその規則どおりだが、ユースケース本文は旧形のままなので、同じ継続要求の payload が 2 つの正典で違う形をしている。`spec/` は「そこに書かれていることが code について真である」ことを約束する（CLAUDE.md）ので、片方だけ直した状態は次スライス（`deleteTagsForScope` を実装する #8）が旧形を写す誘因になる
  - 提案: 共通原因は index の規則追加なので、同じ 1 変更として 3 か所の `{ scope, deletionOperationId }` から `scope` を落とす（tag.md:398 は本担当、storage.md:518 / usage.md:248 は同一指摘として併せて直す）。`spec/usecases/job.md:520` の `job.removalGlobalContinued { scope, … }` は Job 集約が未実装の他スライス分なので、この PR では触れず新規則の例外でないことだけ確認すればよい

- **[W-002]** `note.purged` 追随者の継続 task の priority class（token 無し → 期限回収 3 / 削除由来 → security cleanup 0）が、コードの JSDoc にしか書かれていない
  - 場所: `packages/core/src/application/cleanup/notePurgeFanOut.ts:141-160`（`settleNotePurgeTurn` の JSDoc と `priority` 分岐）に対して `spec/usecases/tag.md:369-370`（手順 2 に priority の記述なし）。同じ欠落は `spec/usecases/storage.md#deleteFilesForNote` / `spec/usecases/integration.md:394` にもある
  - 理由: `collectOrphanMedia` は `spec/usecases/storage.md:428` に「priority は期限回収（3）とする」と根拠つきで置いているのに、同じ scope Alarm を使う 3 追随者は class を決める判断（「class 0 は障壁が待つ削除 turn のためのもので、通常 purge を混ぜると class 内に fairness が無いため飢餓保証が崩れる」）がコードにしか無い。これは `spec/platform/index.md:199` の飢餓保証に直接効く設計判断で、実装を差し替えるときに spec から復元できない。テスト（`deleteAssignmentsForNote.test.ts` TC-tag-027 の 2 本）は両 class を固定しているので挙動は守られているが、正典側の記述が欠けている
  - 提案: `spec/usecases/tag.md` 手順 2 に「再登録の priority は `deletionOperationId` が非 null なら 0（security cleanup）、null なら 3（期限回収）」を 1 文で書き、storage / integration の同じ手順にも同文を置く（3 追随者は `settleNotePurgeTurn` で 1 か所に集約済みなので、spec 側も同じ規則を 3 か所に写すだけでよい）

#### テスト保証

- `TagAssignmentRepository.insert`（`(tagId, noteId)` 重複は `ConflictError("ASSIGNMENT_ALREADY_EXISTS")`、id 再利用は `SystemError`）— 守っているテスト: `packages/core/src/adapters/conformance/tagAssignmentRepository.ts:ADP-tag-010: rejects a second assignment of the same tag to the same note` / `ADP-tag-010: answers a re-used assignment id with a fault, not the pair conflict`（memory / cloudflare 両方に配線。`conformanceCoverage.test.ts` が 45 スイート一致を固定）
- `TagAssignmentRepository.listByNote`（`AssignmentId` 昇順・全欄再構成）— 守っているテスト: `conformance/tagAssignmentRepository.ts:ADP-tag-012: lists one note's assignments by id, rehydrated whole`
- `TagAssignmentRepository.deleteByNote`（`limit <= 0` は 0、昇順先頭から `limit` 件、他ノート不干渉、0 件は正常）— 守っているテスト: `conformance/tagAssignmentRepository.ts:ADP-tag-019: deletes at most limit assignments of one note and answers the count`
- `createMemoryTagAssignmentRepository.insert` の scope 鍵検査（`DataIntegrityError`、行は書かれない）— 守っているテスト: `packages/core/src/adapters/memory/__tests__/scopeGuards.test.ts:ADP-tag-010: refuses an assignment whose scope names another object`
- `createCloudflareTagAssignmentRepository` の scope 鍵検査（insert / listByNote の復元 / deleteByNote はページ全体を検査してから 1 件も消さない）— 守っているテスト: `packages/core/src/adapters/cloudflare/__tests__/scopeGuards.test.ts:ADP-tag-010 / ADP-tag-012 / ADP-tag-019`（5 本）。workers project は本ラウンドで未実行、node project の関連 11 ファイル 486 件は green
- `deleteAssignmentsForNote`（5 件削除・タグ本体不変・他ノート不変・イベント無し・0 件正常・冪等・`deleteTagsForScope` 先行時無害・書き込み失敗は `SystemError(DatabaseError)` を透過）— 守っているテスト: `packages/core/src/application/tag/__tests__/deleteAssignmentsForNote.test.ts:TC-tag-023 / 024 / 025 / 026 / 029 / 030 / 031 / 032`
- `deleteAssignmentsForNote` の 450 件 → 200 / 200 / 50 分割、turn ごとの owner 再確認（abort で `ConflictError`）、継続行の `complete` — 守っているテスト: `deleteAssignmentsForNote.test.ts:TC-tag-027: reclaims 450 assignments 200 at a time, re-checking the deletion owner every turn`
- `settleNotePurgeTurn` の再登録が scope-task runner（`tag.noteDeleteContinued` ハンドラ）で再開されること・token 無しは `expiryCollection` — 守っているテスト: `deleteAssignmentsForNote.test.ts:TC-tag-027: has its continuation resumed by the scope-task runner, so an unregistered kind cannot strand the rest`
- `assertNotePurgeAdmission`（同一 operation の receipt は `running` / `completed` とも通す、不在は `CLEANUP_OPERATION_MISMATCH`）— 守っているテスト: `deleteAssignmentsForNote.test.ts:TC-tag-028`（3 本）
- `subscribers.ts` の `note.purged` に 3 購読者が登録されていること（未登録は warn で ack されるので登録自体を固定）— 守っているテスト: `packages/core/src/application/workers/__tests__/subscribers.test.ts:registers one subscriber per follower, so no leg of the purge is acknowledged with a warning`
- `dispatchDomainEvent` が先行 sibling の失敗後も残りを実行し最初の失敗を再送出すること — 守っているテスト: `subscribers.test.ts:runs the siblings of a failing subscriber and still fails the delivery` / `identity.accountDeletionDispatchContinued siblings:runs the global half of the cleanup wave even when the personal half fails first`
- `scopeOfNoteOwner`（user / workspace 両枝が正しい scope object へ届く）— 守っているテスト: `subscribers.test.ts:TC-integration-022: reclaims a workspace-owned note's residue in the workspace scope, leaving the personal scope untouched` と既定レジストリでの冪等テスト
- `readNotePurgeTurn`（noteId 欠落 / 空白 / 型違い / token 型違いは `DataIntegrityError`、token 欠落・null・空は `null`）— 守っているテスト: `subscribers.test.ts:readNotePurgeTurn`（2 本）
- `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` に `note` が加わり、障壁の ack 集合が `note / storage / usage` になること — 守っているテスト: `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`（acknowledged を sort して 3 要素と一致）、`deleteAccount.terminalPrune.test.ts`（定数を直接反復）
- `TagAssignment.reconstruct` / `TagId` / `AssignmentId` / `TagScope`（trim・空拒否・未知 scope type と壊れた id は `RehydrationError`）— 守っているテスト: `packages/core/src/domain/tag/__tests__/valueObject.test.ts:DOM-tag-001 / 002 / 004 / 006`
- `BackupRecordRepository`（insert の 2 制約の写し分け・`listByNote` 昇順・`deleteByNote` の有界削除）— 守っているテスト: `conformance/backupRecordRepository.ts:ADP-integration-008 / 014 / 030`（両バックエンド配線済み）
- `spec/platform/index.md` の purge 1 件 = `resolve` 1 ＋ `beginPurge` 3 ＋ `removeForPurge` 4〜5 ＋ `finishPurge` 3 の算術 — テストではなく実装読解で裏取り: `d1/repositories/noteRouteStore.ts` の `beginPurge` / `finishPurge` は `requireRow` 1 ＋ `commit`（guard ＋ upsert）2、`projection/snapshotWriter.ts:remove` は `readStored` 1 ＋ guard 1 ＋ FTS withdrawal 0〜1 ＋ 本体 DELETE 1 ＋ tags DELETE 1。40 × 12 = 480 < 500、80 × 12 = 960 < 1,000、50 × 12 = 600 の記述はいずれも正しい。`OWNER_PURGE_BATCH_SIZE = 40` / `TRASH_EXPIRY_BATCH_SIZE = 40` / `EMPTY_TRASH_SYNCHRONOUS_LIMIT = 50` / `SCOPE_TASK_TICK_LIMIT = 100` / `NOTE_ASSIGNMENT_DELETE_BATCH_SIZE = 200` は表の値と一致
- `note.purged` 追随者の継続 task の priority class が正典に無い → [W-002]（挙動自体は TC-tag-027 の 2 本で固定されている）

#### カバレッジ

- 確認: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts`, `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/scopeGuards.test.ts`, `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/backupRecordRepository.ts`, `packages/core/src/adapters/conformance/noteRepository.ts`, `packages/core/src/adapters/conformance/noteRouteStore.ts`, `packages/core/src/adapters/conformance/storedFileRepository.ts`, `packages/core/src/adapters/conformance/tagAssignmentRepository.ts`, `packages/core/src/adapters/memory/__tests__/conformance.test.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/__tests__/scopeGuards.test.ts`, `packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts`, `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/cleanup/notePurgeFanOut.ts`, `packages/core/src/application/cleanup/participants.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`, `packages/core/src/application/di/memoryRuntime.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/execution/unitOfWork.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`, `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`, `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`, `packages/core/src/application/scope.ts`, `packages/core/src/application/tag/__tests__/deleteAssignmentsForNote.test.ts`, `packages/core/src/application/tag/deleteAssignmentsForNote.ts`, `packages/core/src/application/workers/__tests__/subscribers.test.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/subscribers.ts`, `packages/core/src/domain/tag/__tests__/valueObject.test.ts`, `packages/core/src/domain/tag/errorCode.ts`, `packages/core/src/domain/tag/ports/tagAssignmentRepository.ts`, `packages/core/src/domain/tag/tagAssignment.ts`, `packages/core/src/domain/tag/valueObject.ts`, `spec/database/index.md`, `spec/domains/index.md`, `spec/domains/tag.md`, `spec/inventory/adapter.md`, `spec/platform/index.md`, `spec/testcases/tag/deleteAssignmentsForNote.md`, `spec/usecases/tag.md`（49 件）
- スキップ: `apps/web/**`（39 件）— フロントエンド担当
- スキップ: `packages/core/package.json`, `pnpm-lock.yaml`（2 件）— 依存追加（html アダプター用）で担当外
- スキップ: `packages/core/src/adapters/cloudflare/do/repositories/{backupRecordRepository,noteRepository,storedFileRepository}.ts`（3 件）— integration / note / storage 担当（conformance スイート側は確認済み）
- スキップ: `packages/core/src/adapters/html/**`（4 件）— HtmlProcessor は note 担当
- スキップ: `packages/core/src/adapters/memory/repositories/{backupRecordRepository,noteRepository,storedFileRepository}.ts`（3 件）— integration / note / storage 担当
- スキップ: `packages/core/src/application/integration/**`（2 件）— integration 担当（`notePurgeFanOut` 経由の共通部は確認済み）
- スキップ: `packages/core/src/application/note/**`（36 件）— note 担当（batch 定数だけ platform 算術の裏取りに参照）
- スキップ: `packages/core/src/application/ports/{noteMovePort,noteRouteStore,objectStorage}.ts`（3 件）— note / storage 担当
- スキップ: `packages/core/src/application/storage/**`（10 件）— storage 担当
- スキップ: `packages/core/src/application/usage/**`（2 件）— usage は前ラウンドで defer 済み（`[W-009] application/usage/`）かつ担当外
- スキップ: `packages/core/src/domain/integration/**`（5 件）— integration 担当
- スキップ: `packages/core/src/domain/note/**`（6 件）— note 担当
- スキップ: `packages/core/src/domain/storage/**`（4 件）— storage 担当
- スキップ: `spec/adr/013-html-sanitization-policy.md`（1 件）— note 担当
- スキップ: `spec/domains/{integration,note,storage}.md`（3 件）— 各担当
- スキップ: `spec/inventory/{test,usecase}.md`（2 件）— test / usecase 台帳は Phase 4 と usecase 担当
- スキップ: `spec/manual-tests/editing.md`, `spec/pages/index.md`, `spec/presentation/index.md`（3 件）— フロントエンド担当
- スキップ: `spec/testcases/{integration,note,storage}/**`（19 件）— 各担当
- スキップ: `spec/usecases/{integration,note,storage}.md`（3 件）— 各担当（[W-001] / [W-002] の同型箇所は行番号で指示済み）
