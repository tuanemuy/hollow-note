### backend-tag

対象: 完全削除の波及と横断の配線（`domain/{tag,integration}`、`application/{tag,integration,cleanup,workers,identity,di,execution,ports}`、両バックエンドの tagAssignment / backupRecord、該当 conformance、`spec/{usecases,domains}/{tag,integration}` ほか）。

検証として `vitest run --project node`（tag / integration / workers.subscribers / domain.tag / domain.integration / identity.deleteAccount.{cleanup,terminalPrune} = 58 件、memory conformance + conformanceCoverage = 419 件）と `--project workers`（cloudflare scopeBusiness conformance = 47 件）を実行し、いずれも green を確認した。

#### Blockers

なし。

#### Warnings

**[W-001]** `assertNotePurgeAdmission` は personal barrier 専用なのに、呼び出し側とその JSDoc は scope 非依存の受理判定として書かれている

- 場所: `packages/core/src/application/cleanup/notePurgeFanOut.ts:83-99`（`ctx.cleanupAdmission.describePersonalCleanup` 固定）／`packages/core/src/application/note/deleteNotesForOwner.ts:24-32`（JSDoc「a workspace deletion names the workspace」）／`packages/core/src/application/integration/__tests__/deleteBackupRecordsForNote.test.ts`「TC-integration-022」
- 理由: `NotePurgeFanOutTurn.deletionOperationId` の JSDoc は「account **or workspace** deletion」由来の token と書き、`assertNotePurgeAdmission` の JSDoc も「a token that does not describe this scope at all」を拒む一般的な述語として説明している。しかし実装が引くのは `describePersonalCleanup` だけで、workspace scope には personal receipt が無い（`adapters/memory/repositories/scopeCleanupAdmissionStore.ts` は receipt テーブルを scope 単位で持つ）ため、workspace 削除由来の token を積んだ `note.purged` は初回配送も継続も一律 `ConflictError("CLEANUP_OPERATION_MISMATCH")` になり、8 回の backoff 後に scope task が `failed` へ駐車して tag 付与・バックアップ記録・保管ファイルが恒久的に残る。`spec/testcases/integration/deleteBackupRecordsForNote.md` の「ワークスペース削除に伴う `note.purged` を受け取る → ワークスペース所有ノートの記録もこの経路で削除される」（TC-integration-022）はまさにこの経路を要求しているが、その ID を名乗るテストは `deletionOperationId: null` を渡しており、要求されたケースを一切踏んでいない。同様に `spec/inventory/test.md` の TC-storage-060「workspace deletion由来の別operation ID → manifest owner不一致として削除を拒否する」も、実際には「personal receipt が無いから拒否」という別理由で偶然通っているだけで、manifest owner の照合はどこにも無い。今の本体コードでは workspace 削除がノートを purge しない（`application/workspace/workspaceDeletionLocal.ts` に note の語が 1 つも無く、`deleteNotesForOwner` の呼び出し元は `identity/deleteAccount/cleanupDispatch.ts` と `NOTE_OWNER_PURGE_TASK_KIND` の 2 つだけ）ため実害は出ていないが、「実装が対応しているように読める JSDoc」と「対応を要求する spec の TC」と「対応していない実装」が三すくみになっている。
- 提案: (a) `assertNotePurgeAdmission` の JSDoc と `NotePurgeFanOutTurn.deletionOperationId` の JSDoc を「personal cleanup barrier の token に限る」と明記し、`deleteNotesForOwner` の workspace 記述を「まだ駆動元が無い」と断る、(b) `spec/testcases/integration/deleteBackupRecordsForNote.md` と `spec/testcases/storage/deleteFilesForNote.md` の workspace 行に「workspace 削除経路は本スライスの範囲外（#? へ handoff）」を書く、(c) TC-integration-022 を名乗るテストは workspace scope + `deletionOperationId: null` を検証しているだけなので、TC の文言と一致するようテスト名か spec のどちらかを直す。少なくとも (a)(b) は本 PR で閉じたい。

**[W-002]** `spec/domains/integration.md` の `BackupRecordRepository` 契約が実装と両側で食い違っている（tag 側は揃っているので、抜けが際立つ）

- 場所: `packages/core/src/domain/integration/ports/backupRecordRepository.ts:26-56` ↔ `spec/domains/integration.md:194-207` / `spec/inventory/adapter.md:303-315`
- 理由: 2 点ある。①**`listByNote`（単数）が spec に存在しない**。spec のインターフェース列挙にあるのは `findByNoteAndFile` / `listByNotes`（複数）/ `deleteByNote` / `deleteByUser` で、`spec/inventory/adapter.md` の ADP-integration-008〜015 にも単数形の行は無い。実装はこれを新設し、本番コードからの呼び出しは 0 件（`grep` 上、利用者は conformance スイートのみ）。tag 側は同じメソッドが ADP-tag-012 として spec に載っているので、これは単なる対称性の欠落ではなく片側だけの未反映である。②**`ConflictError("BACKUP_RECORD_ALREADY_EXISTS")` が spec のエラーケースに無い**。spec/domains/integration.md:207 のエラーケースは `OPTIMISTIC_LOCK_FAILURE` と `DatabaseError` の 2 つだけだが、実装ではポート JSDoc・memory / cloudflare 両アダプター・conformance スイート（`ADP-integration-008: rejects a second record of the same source file of the same note`）がこのコードを要求する。tag 側は `spec/domains/tag.md:209` に `ASSIGNMENT_ALREADY_EXISTS` が既にあり、同 PR で `IntegrationErrorCode` に `InvalidFileRef` を足す改訂は入っているので、「integration.md を触れなかった」ではなく「触ったが 2 点を落とした」形になっている。`CLAUDE.md`「spec と実装を両側突き合わせ」と ADR 026（ポート契約の正典はポート定義と JSDoc、その実行形が conformance）に照らして、正典側を直す必要がある。
- 提案: `spec/domains/integration.md` の `BackupRecordRepository` に `listByNote(noteId): Promise<readonly BackupRecord[]>`（`BackupRecordId` 昇順）を足し、エラーケースへ `ConflictError("BACKUP_RECORD_ALREADY_EXISTS")` と「主キー再利用は `SystemError(DatabaseError)`」の区別を明記し、`spec/inventory/adapter.md` に対応する ADP 行を採番する。`listByNote` を spec に載せたくないなら、逆にポートから外して conformance を `deleteByNote` の戻り値だけで組み直す。

**[W-003]** `note.purged` 追随者の継続要求を、削除由来でない purge まで priority 0（security cleanup）で積んでいる

- 場所: `packages/core/src/application/cleanup/notePurgeFanOut.ts:107-112`（`priority: ScopeTaskPriority.securityCleanup` を無条件に指定）
- 理由: `spec/database/index.md:1151` と `spec/platform/index.md:188` は priority 0 を「security cleanup / lease reaping」と定義し、`spec/platform/index.md:207` は「低 priority task が継続的に補充されても security cleanup と lease reaping を飢餓させない」ことを保証としている。この保証は priority 0 の中身が membership / account の後始末と lease 回収に限られていることに依存しており、priority 0 内部には公平化が無い（`ScopeTaskScheduler` の選択規則は同 priority 内では `(dueAt, kind, operationId)` 順のみ）。ユーザーが自分でゴミ箱を空にした purge や retention sweep の fan-out まで同じ枠に入れると、退会中の scope で `note.ownerPurgeContinued` / `storage.ownerDeleteContinued` と並ぶことになる。JSDoc は「what these turns reclaim is data a user asked to be gone」と理由を書いているが、これは spec の priority 定義の**拡大**であり、spec 側にも ADR にも記録が無い。
- 提案: `deletionOperationId !== null` の turn だけ `securityCleanup`、それ以外は `expiryCollection`（3）にするか、拡大を選ぶなら `spec/database/index.md` / `spec/platform/index.md` の priority 定義に「ノート完全削除の後始末」を明記して、飢餓しない根拠（fan-out は 1 ノートあたり満ページのときだけ 1 行、という上限）を併記する。

**[W-004]** fan-out ヘルパーの分岐がテストで踏まれていない — workspace 所有ノートの経路と、payload 破損の 2 経路

- 場所: `packages/core/src/application/cleanup/notePurgeFanOut.ts:33-36`（`scopeOfNoteOwner` の workspace 分岐）、同 `:44-60`（`readNotePurgeTurn` の 2 つの `corrupt()`）
- 理由: `scopeOfNoteOwner` の唯一の呼び出し元は `subscribers.ts` の 3 購読者で、`__tests__/subscribers.test.ts` の `notePurged()` は `NoteOwner.user` 固定。workspace 分岐はどのテストからも到達しない。`deleteBackupRecordsForNote.test.ts` の TC-integration-022 は usecase を直接呼んで `scope` を手で渡しているため、「イベントの `owner` から scope を導く」という購読者側の変換はワークスペースについて一度も検証されていない（W-001 と同じ穴の別の顔）。`readNotePurgeTurn` の破損 payload 分岐（`SystemError(DataIntegrityError)`）も、happy path が `scopeTaskRunner` 経由の 2 テストで踏まれるだけで、拒否側は未検証。対になる `readOrphanMediaSweepTurn` には TC-storage-255（読めない位置は先頭からやり直す）が用意されているので、こちらだけ無い。
- 提案: `subscribers.test.ts` の fan-out ケースに `NoteOwner.workspace` 版を 1 本足して 3 購読者が workspace scope の行を消すことを見る。`readNotePurgeTurn` は `noteId` 欠落・`deletionOperationId` が文字列でない、の 2 ケースを直接呼び出しで押さえる（1 本で足りる）。

**[W-005]** 新設 2 テーブルの並行時フェンスがドライバのメッセージ文字列に依存し、かつ conformance からは到達不能

- 場所: `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:170-177`、`.../backupRecordRepository.ts:179-186`
- 理由: どちらも `classifySqlError(cause) === "unique" && String(cause).includes(\`${TABLE}.tag_id\`)`（resp. `.source_file_id`）で「業務一意制約」と「主キー」を切り分けている。この二分は conformance が `ConflictError` と `SystemError` として明示的に検証している契約（`ADP-tag-010` / `ADP-integration-008` の 2 本目）そのものだが、事前 read（`clashOf`）が通常経路を全部さばくので、この catch はスイートから一度も踏まれない。加えて `adapters/cloudflare/sql/errors.ts` の JSDoc は「Adapters branch on this rather than on driver message text, so the translation ... happens in exactly one place」と宣言しており、この分岐はその宣言に反している。SQLite が複合 UNIQUE 違反で列名を列挙する現在の書式に依存しているため、書式が索引名を返す実装に変わると、ポートが `ConflictError` を約束している場所で `SystemError` が返る（呼び出し側は「直せ」と言われるべきところで「再試行しろ」と言われる）。パターン自体は `storedFileRepository` の既存流儀（本 PR の差分外）で、そこは**既存の問題**。
- 提案: 列名判定を `classifySqlError` 側に寄せて `{"unique", columns}` を返す形にするか、少なくとも 2 リポジトリで共通のヘルパーに切り出し、メッセージ書式を 1 か所に閉じる。そのうえで、事前 read を迂回する薄いラッパー（`docs/test.md`「Injecting into a concurrency window」）で catch 側を 1 回だけ踏むアダプター単体テストを足す。

#### テスト保証

- 購読者単位の冪等: `subscribers.test.ts`「clears the files, assignments and backup records ... and stays a no-op on redelivery」が 3 集約すべての行を実際に seed → 0 件化 → 再配送で 0 件維持・outbox 行が増えないところまで見ている。usecase 単位でも TC-tag-030 / TC-integration-021 が `deletedCount` の 2→0 遷移で個別に押さえており、`plan.md`「購読者ごとに独立に冪等」の要求を満たす。
- 購読者の登録漏れ検知: `subscribers.test.ts`「registers one subscriber per follower」が `note.purged` の `consumerName` 集合を完全一致で固定している。`dispatchDomainEvent` が未購読イベントを warn だけで ack する（`plan.md` のリスク欄）という穴に対する直接の防具として妥当。
- 兄弟購読者の隔離: 「runs the siblings of a failing subscriber and still fails the delivery」が `calls` の順序（`boom` → `later` → `boom-2`）と error ログ 2 本、かつ最初の失敗の再送出まで検証している。既存の多購読者イベントへの影響も確認した — 順序依存があるのは `identity.accountDeletionDispatchContinued` だけで、cleanup phase の 2 購読者が両方走っても `finalizeAccountDeletion` は `personalCleanup` receipt を要求し、その receipt は障壁完了経由でしか付かないため早期 finalize は起きない。
- 追随者の受理判定: TC-tag-027 が「barrier を abort → 次の turn が `ConflictError`、行は 50 件残る → 開き直すと再開」まで実行し、TC-integration-024 が別 operation ID（`deletion-9`）の拒否と行の残存を見る。完了済み barrier の受理は TC-tag-028 / TC-integration-024 の 2 本目が、必須コンポーネント全 ack + `markCompleted` の後に継続が最後まで走ることで押さえている。`describePersonalCleanup` の契約（別 operation / 不在は `null`）はポート JSDoc に明記され memory 実装も `row.operationId !== operationId → null` なので、他人の operation は確実に落ちる。
- 継続の駆動: TC-tag-027 / TC-integration-023 の 2 本目が `runDueScopeTasks` を通し、`kind` が `scopeTaskHandlers` に登録されていなければ残件が取り残されることを実効的に検出する（未登録 kind は runner が warn して行を due のまま残すため、`processed: 1` と行の消滅がその証明になる）。
- 主キー衝突と業務一意制約の写像: conformance の `ADP-tag-010` / `ADP-integration-008` が各 2 本、`ConflictError(<code>)` と `isSystemError` を明示的に区別して要求し、memory / cloudflare 両方が同一スイートを通ることを実行して確認済み（node 419 件、workers 47 件）。ただし cloudflare 側の並行フェンス経路のみ未到達（W-005）。
- `participants.ts` の宣言と実装の一致: `note` の participant 昇格は、(a) `PERSONAL_CLEANUP_COMMANDS.note` が `deleteNotesForOwner` を発火し、(b) `settle` が `acknowledgePersonalComponent(op, "note")` を打ち、(c) `NOTE_OWNER_PURGE_TASK_KIND` が `scopeTaskHandlers` に登録され `settleCleanupTurn` へ渡る、の 3 点が揃っているので退会は完了に到達する。`deleteAccount.cleanup.test.ts` が ack 集合を `["note","storage","usage"]` の完全一致で固定し、`deleteAccount.terminalPrune.test.ts` が `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` を参照する形に変わったので、登録漏れは両方向で検出される。`tag` / `backup` を `absent` のままにしたのも妥当 — 付与・記録を消すのは note 単位の fan-out であって scope 全体の sweep ではなく、participant に上げると ack する主体が居らず退会が永久に完了しない。`absent` に残しても付与・記録は fan-out が回収するので掃除漏れにもならない（workspace scope に残る退会者のバックアップ記録だけは別の穴で、`backup: absent(..., "#4")` として正しく宣言されている）。
- 継続行のキー: `armNotePurgeContinuation` は `(kind, purge の operationId)` で upsert し、その `operationId` は user purge では `idGenerator` 由来だがイベント payload に載って再配送でも同値、cleanup / retention では `ownerPurgeOperationId` / `retentionPurgeOperationId` で決定的に導出される。TC-tag-027 が 2 turn 目でも `tasks(h)` が 1 行のままであることを見ており、継続が増殖しないことは押さえられている。
- 二面 UoW と `run` の入れ子: 追随者 3 本はいずれも `scopeUnitOfWorkProvider.run` を 1 回だけ開き、その中で `deleteByNote` と `complete` / `schedule` を同一 transaction に収めている。`dispatchDomainEvent` の呼び出し元（`apps/web/app/server.node.ts` の `consumerHandler`）は UoW の外なので入れ子は生じない。
- 満ページ判定の収束: `deletedCount < BATCH → complete` / `=== BATCH → 再武装` は、行が増えることが無い以上「`< BATCH` を観測した時点で残りは無い」が成り立つため、relay 再配送と scope task runner が同じ `(kind, operationId)` 行を同時に駆動しても、どちらの順序でも収束する（complete が残件を持つ行を消すケースは作れない）。lease が advisory であることによる一般的な取りこぼしリスクはポート JSDoc に既記載で、ここで失われるのは purge 済みノートの残行だけであり、退会の chain のように取り返しがつかない対象ではない。

#### カバレッジ

確認（60 / 171）:

- `packages/core/package.json`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts`
- `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/backupRecordRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts`
- `packages/core/src/adapters/cloudflare/do/schema.ts`
- `packages/core/src/adapters/conformance/backend.ts`
- `packages/core/src/adapters/conformance/backupRecordRepository.ts`
- `packages/core/src/adapters/conformance/tagAssignmentRepository.ts`
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts`
- `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/memory/repositories/backupRecordRepository.ts`
- `packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts`
- `packages/core/src/adapters/memory/scopeUnitOfWork.ts`
- `packages/core/src/adapters/memory/store.ts`
- `packages/core/src/application/cleanup/notePurgeFanOut.ts`
- `packages/core/src/application/cleanup/participants.ts`
- `packages/core/src/application/di/cloudflareRuntime.ts`
- `packages/core/src/application/di/memoryRuntime.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
- `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
- `packages/core/src/application/integration/__tests__/deleteBackupRecordsForNote.test.ts`
- `packages/core/src/application/integration/deleteBackupRecordsForNote.ts`
- `packages/core/src/application/ports/noteMovePort.ts`
- `packages/core/src/application/ports/noteRouteStore.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/tag/__tests__/deleteAssignmentsForNote.test.ts`
- `packages/core/src/application/tag/deleteAssignmentsForNote.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/domain/integration/__tests__/valueObject.test.ts`
- `packages/core/src/domain/integration/backupRecord.ts`
- `packages/core/src/domain/integration/errorCode.ts`
- `packages/core/src/domain/integration/ports/backupRecordRepository.ts`
- `packages/core/src/domain/integration/valueObject.ts`
- `packages/core/src/domain/tag/__tests__/valueObject.test.ts`
- `packages/core/src/domain/tag/errorCode.ts`
- `packages/core/src/domain/tag/ports/tagAssignmentRepository.ts`
- `packages/core/src/domain/tag/tagAssignment.ts`
- `packages/core/src/domain/tag/valueObject.ts`
- `pnpm-lock.yaml`
- `spec/domains/integration.md`
- `spec/domains/tag.md`
- `spec/inventory/adapter.md`
- `spec/inventory/test.md`
- `spec/inventory/usecase.md`
- `spec/platform/index.md`
- `spec/testcases/integration/deleteBackupRecordsForNote.md`
- `spec/testcases/tag/deleteAssignmentsForNote.md`
- `spec/usecases/integration.md`
- `spec/usecases/tag.md`

担当外（111 / 171。backend-note / backend-storage / frontend の持ち分として本レビューでは判定していない。ただし `application/note/purgeNote.ts`・`deleteNotesForOwner.ts`・`storage/deleteFilesForNote.ts`・`domain/note/events.ts`・`application/note/eventDecoders.ts`・`adapters/memory/repositories/scopeCleanupAdmissionStore.ts`・`application/ports/scopeCleanupAdmissionStore.ts`・`application/ports/scopeTaskScheduler.ts`・`application/identity/deleteAccount/finalize.ts` は判断のため差分外も含めて参照した）:

- `apps/web/app/components/layout/ScopeToken/index.tsx`
- `apps/web/app/components/layout/ScopeToken/listing.ts`
- `apps/web/app/components/note/NoteDetail/detail.tsx`
- `apps/web/app/components/note/NoteDetail/index.tsx`
- `apps/web/app/components/note/NoteDetail/menu.tsx`
- `apps/web/app/components/note/NoteEditor/editor.tsx`
- `apps/web/app/components/note/NoteEditor/frame.tsx`
- `apps/web/app/components/note/NoteEditor/highlight.ts`
- `apps/web/app/components/note/NoteEditor/index.tsx`
- `apps/web/app/components/note/NoteEditor/preferences.ts`
- `apps/web/app/components/note/NoteEditor/skeleton.tsx`
- `apps/web/app/components/note/NoteEditor/surfaces.tsx`
- `apps/web/app/components/note/NoteEditor/textNodes.ts`
- `apps/web/app/components/note/NoteList/board.tsx`
- `apps/web/app/components/note/NoteList/index.tsx`
- `apps/web/app/components/note/TrashList/action.ts`
- `apps/web/app/components/note/TrashList/board.tsx`
- `apps/web/app/components/note/TrashList/index.tsx`
- `apps/web/app/components/note/schema.ts`
- `apps/web/app/presentation/__tests__/errorDisplay.test.ts`
- `apps/web/app/presentation/__tests__/errorResponse.test.ts`
- `apps/web/app/presentation/errorDisplay.ts`
- `apps/web/app/routeTree.gen.ts`
- `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `apps/web/app/routes/notes/$noteId_.edit.tsx`
- `apps/web/app/routes/notes/-action.tsx`
- `apps/web/app/routes/notes/new.tsx`
- `apps/web/app/routes/notes/trash.tsx`
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/$noteId_.edit.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/new.tsx`
- `apps/web/app/routes/workspaces/$workspaceId/notes/trash.tsx`
- `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/conformance/noteRepository.ts`
- `packages/core/src/adapters/conformance/noteRouteStore.ts`
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`
- `packages/core/src/adapters/html/allowList.ts`
- `packages/core/src/adapters/html/css.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`
- `packages/core/src/adapters/memory/repositories/noteRepository.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/application/note/__tests__/applyTextNodeEdits.test.ts`
- `packages/core/src/application/note/__tests__/changeNoteStyleMode.test.ts`
- `packages/core/src/application/note/__tests__/deleteNotesForOwner.test.ts`
- `packages/core/src/application/note/__tests__/editingHarness.ts`
- `packages/core/src/application/note/__tests__/emptyTrash.test.ts`
- `packages/core/src/application/note/__tests__/listNoteRevisions.test.ts`
- `packages/core/src/application/note/__tests__/listNotes.test.ts`
- `packages/core/src/application/note/__tests__/listTrashedNotes.test.ts`
- `packages/core/src/application/note/__tests__/purgeExpiredTrash.test.ts`
- `packages/core/src/application/note/__tests__/purgeNote.test.ts`
- `packages/core/src/application/note/__tests__/renameNote.test.ts`
- `packages/core/src/application/note/__tests__/restoreNote.test.ts`
- `packages/core/src/application/note/__tests__/restoreNoteRevision.test.ts`
- `packages/core/src/application/note/__tests__/trashNote.test.ts`
- `packages/core/src/application/note/__tests__/updateNoteBody.test.ts`
- `packages/core/src/application/note/applyTextNodeEdits.ts`
- `packages/core/src/application/note/changeNoteStyleMode.ts`
- `packages/core/src/application/note/deleteNotesForOwner.ts`
- `packages/core/src/application/note/editing.ts`
- `packages/core/src/application/note/emptyTrash.ts`
- `packages/core/src/application/note/getNote.ts`
- `packages/core/src/application/note/jobs.ts`
- `packages/core/src/application/note/listNoteRevisions.ts`
- `packages/core/src/application/note/listTrashedNotes.ts`
- `packages/core/src/application/note/moveNote.ts`
- `packages/core/src/application/note/purgeExpiredTrash.ts`
- `packages/core/src/application/note/purgeNote.ts`
- `packages/core/src/application/note/renameNote.ts`
- `packages/core/src/application/note/restoreNote.ts`
- `packages/core/src/application/note/restoreNoteRevision.ts`
- `packages/core/src/application/note/trashNote.ts`
- `packages/core/src/application/note/updateNoteBody.ts`
- `packages/core/src/application/note/view.ts`
- `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/relocateFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- `packages/core/src/application/storage/collectOrphanMedia.ts`
- `packages/core/src/application/storage/deleteFilesForNote.ts`
- `packages/core/src/application/storage/relocateFilesForNote.ts`
- `packages/core/src/application/storage/storeMedia.ts`
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/usage/__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/usage/ensureUploadAllowed.ts`
- `packages/core/src/domain/note/__tests__/noteAccessPolicy.test.ts`
- `packages/core/src/domain/note/noteRevision.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/noteRepository.ts`
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `spec/adr/013-html-sanitization-policy.md`
- `spec/domains/note.md`
- `spec/domains/storage.md`
- `spec/manual-tests/editing.md`
- `spec/pages/index.md`
- `spec/presentation/index.md`
- `spec/testcases/note/emptyTrash.md`
- `spec/testcases/storage/collectOrphanMedia.md`
- `spec/testcases/storage/deleteFilesForNote.md`
- `spec/testcases/storage/storeMedia.md`
- `spec/usecases/note.md`
- `spec/usecases/storage.md`
