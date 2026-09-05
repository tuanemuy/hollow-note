### backend-tag

担当範囲: `note.purged` の波及（tag / integration / cleanup / workers）と横断の配線（di / execution / ports / 各バックエンドの tagAssignment・backupRecord・conformance）。

#### Blockers

- **[B-001]** 削除由来の `note.purged` 追随は「誰も開いたままにしてくれない障壁」を毎ターン検証しており、`markCompleted` 後は永久に拒否される
  - 場所: `packages/core/src/application/tag/deleteAssignmentsForNote.ts:44`（`assertOwner`）/ `packages/core/src/application/integration/deleteBackupRecordsForNote.ts:47` / `packages/core/src/application/storage/deleteFilesForNote.ts:52`（同型）／根の宣言は `packages/core/src/application/cleanup/participants.ts:52-58`
  - 理由: 3 つの追随者は `deletionOperationId !== null` のとき毎ターン `ctx.cleanupAdmission.assertOwner(...)` を通す。しかし `ScopeCleanupAdmissionStore` の契約は「**完了済みの receipt は拒否**する（`packages/core/src/application/ports/scopeCleanupAdmissionStore.ts:36-41`）」であり、その完了は `deleteNotesForOwner` の最終ターンが `acknowledgePersonalComponent("note")` → `completePersonalCleanupIfDone` を同一トランザクションで呼んだ時点で起きる（`packages/core/src/application/note/deleteNotesForOwner.ts:184-196`）。`note.purged` は各 purge のトランザクションで outbox に入り、リレーが**その後**非同期に配送する。つまり「note コンポーネントの ack ＝ 障壁の完了」と「fan-out の配送・継続」が競合し、完了が先に立った瞬間から
    - 初回配送すら `ConflictError` で落ち、outbox 行は `maxAttempts` 到達で隔離される
    - 100 / 200 件を超えて張り替えた継続 task も毎ターン落ち、`SCOPE_TASK_MAX_ATTEMPTS` で `failed` に落ちて二度と claim されない
    という形で、tag 付与・バックアップ記録が**恒久的に取り残される**。tag / backup は `participants.ts` で `absent` なので障壁は彼らを待たず、他に掃除する経路も存在しない（`deleteTagsForScope` は未実装）。storage だけは `deleteFilesByOwner`（participant）が owner 単位で掃くため結果的に救われるが、それは偶然の重複であって設計上の保証ではない。
  - さらに各ユースケースの JSDoc は「冪等（`IdempotencyStore` なし）: 削除済みの行は戻らないので再配送は `0` を返す」と書いているが、障壁完了後の再配送は `0` を返さず **throw する**。契約記述と実装が食い違っている。
  - 現時点で書き込み側（#8 / #4）が無く実データは 0 行なので実害は潜在的だが、欠陥は共有ヘルパーと 3 つの購読者すべてに焼き付いており、書き込み側が乗った瞬間に顕在化する。
  - 提案: 「purge は既にコミット済みで、残っているのは到達不能なゴミ行」という事実に合わせて、追随者側の所有権検査を弱める。具体的には (a) 追随者では `assertOwner` を「**別の生きた operation が所有しているときだけ拒否**」の意味に変える（完了済み・receipt 不在は通す）ヘルパーを `notePurgeFanOut.ts` に置く、または (b) 追随者から `deletionOperationId` の検査自体を落とす（purge 済みノートの行を消すのに障壁の証明は要らない）。いずれにせよ「障壁完了後に追随ターンが走る」ケースのテストを 3 購読者ぶん追加すること（現状 `TC-tag-028` / `TC-integration-024` はいずれも障壁が開いたままの経路しか通していない）。(c) tag / backup を participant に上げる案は、`deleteAssignmentsForNote` が scope 全体の掃き取りではなくノート単位である以上、障壁が待つ相手として成立しない（`participants.ts` の `absent` 理由の判断自体は正しい）。

- **[B-002]** Cloudflare 側の `insert` が主キー衝突と業務上の一意制約衝突を区別せず、memory バックエンドと違う例外を返す
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:120-126` / `packages/core/src/adapters/cloudflare/do/repositories/backupRecordRepository.ts:115-121`
  - 理由: 両者とも `classifySqlError(cause) === "unique"` だけで判定し、`id` の PRIMARY KEY 違反も `ASSIGNMENT_ALREADY_EXISTS` / `BACKUP_RECORD_ALREADY_EXISTS` に写している。memory 側は同じ入力に対し `duplicateKey()`＝`SystemError(DatabaseError)` を投げる（`packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts:20-22`、`.../backupRecordRepository.ts:21-23`）。同一入力に対して 2 つのバックエンドが**別の種類のエラー**を返す状態であり、ADR 026 の「どのバックエンドも同じスイートを同じように通る」を満たしていない。conformance スイートは対（pair）衝突しか突いていないため、この差は緑のまま通る。
  - 同ディレクトリの先行実装は正しい形を持っている: `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts:324-329` は `classifySqlError(cause) === "unique" && String(cause).includes("object_key")` と、**どの一意制約が落ちたか**まで見てから業務エラーに写している。
  - 提案: 2 つの新アダプターでも制約名（`tag_assignments_tag_note_uq` / `backup_records_note_file_uq`）を条件に加え、それ以外の unique 違反は `throwTranslated` に落とす。あわせて「同じ `id` の再挿入は何になるのか」をポート JSDoc に書き、conformance スイートにケースを 1 本足す（片側だけ直すと今度は逆向きに割れる）。

#### Warnings

- **[W-001]** `note.purged` の 3 購読者は 1 回の配送で直列に走り、先頭が throw すると後続が走らない
  - 場所: `packages/core/src/application/workers/subscribers.ts:172-220`（登録）/ `packages/core/src/application/workers/subscribers.ts:225-231`（`dispatchDomainEvent` の JSDoc「a throw fails the whole delivery」）
  - 理由: 追随者は互いに独立な集約を掃除するのに、配送は 1 本の逐次ループで、途中の 1 件が恒久的に失敗すると（B-001 のケース、あるいは片方のスコープだけ DB 障害が続くケース）後続の購読者は**一度も呼ばれない**まま outbox 行が隔離される。JSDoc は「every handler must be safe to re-run」としか言っておらず、「先頭の恒久失敗が後続を巻き添えにする」性質は宣言されていない。テストもすべて成功経路だけを通している。
  - 提案: 少なくとも JSDoc に巻き添えの性質を明記する。実効性を上げるなら、`note.purged` のように「独立な後始末が N 本ぶら下がる」イベントについては購読者ごとの結果を集約し、全滅でないかぎり残りを走らせてから最初の失敗を投げ直す形にする（`EventDispatchOutcome` が既に per-event 粒度を持っているので、per-subscriber 粒度への拡張は自然）。

- **[W-002]** fan-out の唯一の駆動源が scope plane の outbox であり、Cloudflare 配線にはその読み手がいない（**既存の問題（本 PR の変更起因ではない）**が、本 PR で初めて業務上重要になった）
  - 場所: `packages/core/src/application/cleanup/participants.ts:60-63`（`outbox: absent("The scope plane has no reader for its own outbox"...)`）/ `packages/core/src/application/di/cloudflareRuntime.ts:460`（worker の `outboxRepository` は D1＝global plane）/ `packages/core/src/application/note/purgeNote.ts:512`（`note.purged` は scope UoW の `collectEvents`）
  - 理由: 参照ランタイム（memory）は outbox が単一テーブルなので届くが、Cloudflare 側では scope DO の `outbox_events` を読む役がいない。`storage.fileDeleted` については `absent` の理由書きに「冪等な `deleteStoredObjects` に委ねる」という逃げ道が書かれているが、`note.purged` にはそのような代替経路がない（tag 付与・バックアップ記録を掃く他の経路が存在しない）。
  - 提案: 本 PR で塞ぐ必要はないが、`participants.ts` の `outbox` の `absent` 理由に「`note.purged` の fan-out もここに乗る」ことを追記し、`spec/platform/index.md` 側の未実装項目として可視化する。

- **[W-003]** ポート JSDoc と `spec/` の記述が 3 箇所で食い違っている（共通原因: 新規ポート／VO の JSDoc を書くときに `spec/domains/` 側を更新していない）
  - 場所:
    - `packages/core/src/domain/integration/ports/backupRecordRepository.ts:4-8` — 「`deleteByUser` is deliberately absent here **as well as in the spec**」とあるが、`spec/domains/integration.md:201` は `deleteByUser(userId, limit)` を宣言している（同 205 行が否定しているのは「scope をまたぐ」`deleteByUser` だけ）。
    - `packages/core/src/domain/integration/errorCode.ts:3` — `InvalidFileRef: "INTEGRATION_INVALID_FILE_REF"` は `spec/domains/integration.md:330-334` のエラーコード表に無い（表にあるのは `InvalidFolderRef`）。
    - `packages/core/src/domain/tag/ports/tagAssignmentRepository.ts:30`／conformance `ADP-tag-012` — 「`listByNote` は id 昇順」という**新しい契約**を追加しているが、`spec/domains/tag.md:171` が順序を契約として定めているのは `listByTag` だけで、`listByNote` については何も書かれていない。
  - 理由: `CLAUDE.md`「`spec/` はいま効力を持つ設計の正典。決定が変わったら改訂する」。ポート契約の正典はポート定義＋JSDoc だが、`spec/domains/` と矛盾したまま残すと、どちらが正しいか読み手に判定させることになる。
  - 提案: JSDoc の文言を「cross-scope な `deleteByUser` は無い」に直すか `spec/domains/integration.md` を改訂する。`InvalidFileRef` はエラーコード表に追記する。`listByNote` の順序契約は `spec/domains/tag.md#ポート` に 1 行足す。

- **[W-004]** 本スライスが使わない tag の値オブジェクト構築子が一式追加されており、ドメイン層の単体テストが 0 本
  - 場所: `packages/core/src/domain/tag/valueObject.ts:33-45`（`TagScope.user` / `.workspace` / `.fromNoteOwner` / `.equals`）
  - 理由: 型としての `TagScope` は `TagAssignment` が使うが、4 つの構築子・比較子はリポジトリ全体で参照ゼロ（`TagAssignment.reconstruct` すら `{ type: "user", userId: ... }` をインラインで組んでいる）。plan.md「含まれないもの」はタグ管理を #8 に置いており、書き込み側の道具を先取りしている。また `domain/tag/__tests__` / `domain/integration/__tests__` は存在せず、`TagAssignment.reconstruct` の不正 `scopeType` → `RehydrationError`、`ExternalFileRef.create` の空文字拒否といった分岐を直接守るテストが無い（conformance 経由の往復だけ）。
  - 提案: 未使用の構築子は #8 に譲る（`TagAssignment.reconstruct` が `TagScope.user/workspace` を使う形に寄せるなら残してよい）。不正 `scopeType` と空 `ExternalFileRef` の拒否は、他ドメインの `domain/*/__tests__/valueObject.test.ts` に倣って 1 ファイル足せば足りる。

- **[W-005]** `TC-integration-024` の拒否検証が弱い
  - 場所: `packages/core/src/application/integration/__tests__/deleteBackupRecordsForNote.test.ts:244`（`expect(refused).not.toBeNull()`）
  - 理由: 同型の tag 側は `expect(isConflictError(refused)).toBe(true)`（`packages/core/src/application/tag/__tests__/deleteAssignmentsForNote.test.ts:200`）でエラー種別まで固定しているのに、integration 側は「null でない」だけ。何が投げられても通る。直後の `recordIds(h)` の検証があるので検出力ゼロではないが、`ConflictError` が `SystemError` に変わっても気づけない。
  - 提案: tag 側と同じく `isConflictError` を確認する。

#### テスト保証

- `note.purged の購読者登録が 3 件そろっている（workers/subscribers.ts:domainEventSubscribers）` — 守っているテスト: `packages/core/src/application/workers/__tests__/subscribers.test.ts:"registers one subscriber per follower, so no leg of the purge is acknowledged with a warning"`（consumerName の完全一致で比較。未購読 warn ack の穴を塞ぐ意図どおり）
- `note.purged の 3 購読者が既定レジストリ経由で files / assignments / backupRecords を消し、再配送で no-op（subscribers.ts）` — 守っているテスト: 同ファイル `"clears the files, assignments and backup records ... and stays a no-op on redelivery"`（`h.logger.byLevel("warn")` が 0 であることまで見ており、購読漏れ・ハンドラ漏れの両方を検出する）
- `購読者単位の冪等性（tag）` — 守っているテスト: `application/tag/__tests__/deleteAssignmentsForNote.test.ts:"TC-tag-030"`、`"TC-tag-031"`
- `購読者単位の冪等性（integration）` — 守っているテスト: `application/integration/__tests__/deleteBackupRecordsForNote.test.ts:"TC-integration-021"`
- `継続 task の kind がランナーに登録されている（workers/scopeTaskRunner.ts:scopeTaskHandlers）` — 守っているテスト: 両ファイルの `"has its continuation resumed by the scope-task runner, so an unregistered kind cannot strand the rest"`（既定 `scopeTaskHandlers` を使い `processed === 1` と残行 0 を検証。登録漏れを検出できる）
- `継続行が (kind, operationId) 1 行に収束し、deletionOperationId を持ち回る（cleanup/notePurgeFanOut.ts:armNotePurgeContinuation）` — 守っているテスト: `"TC-tag-027"` / `"TC-integration-023"`（kind・operationId・priority・payload を完全一致で比較し、2 ターン目でも行数 1）
- `満杯でないページで継続行を complete する（deleteAssignmentsForNote / deleteBackupRecordsForNote の分岐）` — 守っているテスト: `"TC-tag-027"` 最終ターン・`"TC-integration-023"` 最終ターンの `expect(tasks(h)).toEqual([])`
- `deletionOperationId 非 null のとき所有権を毎ターン再確認する` — 部分的に守られている: `"TC-tag-027"` が abort → `ConflictError` を検証。ただし**完了済み障壁**の経路は未検証 → [B-001]
- `書き込み失敗をそのまま投げて再配送に委ねる` — 守っているテスト: `"TC-tag-032"`（`isSystemError` + code）、`"TC-integration-025"`（同）
- `deleteByNote が limit ちょうどで切れ、id 昇順で、対象なしは 0（domain/tag/ports/tagAssignmentRepository.ts:deleteByNote, domain/integration/ports/backupRecordRepository.ts:deleteByNote）` — 守っているテスト: `adapters/conformance/tagAssignmentRepository.ts:"ADP-tag-019"` / `adapters/conformance/backupRecordRepository.ts:"ADP-integration-014"`（memory・cloudflare 両方から呼ばれている）
- `(tagId, noteId) / (noteId, sourceFileId) の一意性` — 守っているテスト: `"ADP-tag-010"` / `"ADP-integration-008"`。ただし**主キー衝突**の写像は未検証 → [B-002]
- `両バックエンドが同じスイート集合を走らせている` — 守っているテスト: `adapters/__tests__/conformanceCoverage.test.ts:"runs the same suites against the memory and Cloudflare backends"`（`PERSISTENCE_SUITES` を 43→45 に更新済み。片側だけ足す事故を検出する）
- `RequestContainer / WorkerContainer の配線（publicNoteProjectionWriter・htmlProcessor の追加、noteRouteResolver→noteRouteStore の張り替え）` — 守っているテスト: `adapters/cloudflare/__tests__/runtimeComposition.test.ts` の `REQUEST_PORTS` / `WORKER_PORTS`（キー集合の完全一致）
- `personal cleanup の participant 集合に note が入り、barrier が note の ack を要求する（cleanup/participants.ts）` — 守っているテスト: `identity/__tests__/deleteAccount.cleanup.test.ts:"..."`（`acknowledged` を `["note","storage","usage"]` と完全一致で比較。`toHaveLength(2)` から改善されている）／`deleteAccount.terminalPrune.test.ts` はハードコード配列をレジストリ由来に置換
- `participant に上げた note のコマンドが必ず配線される（identity/deleteAccount/cleanupDispatch.ts）` — 守っているのは型: `PERSONAL_CLEANUP_COMMANDS: Record<ActivePersonalCleanupComponent, ...>` が網羅を強制する（テストではなく型で担保、意図どおり）
- `tag / backup を participant に上げていないこと` — 実装現況と一致している（scope 全体を掃く経路が無いため障壁が待てる相手ではない）。ただし「障壁は fan-out を待たない」という帰結が B-001 の前提になっている
- `note.purged 追随ターンが障壁完了後に走ったときの挙動` — 守られていない → [B-001]
- `1 購読者の恒久失敗が兄弟購読者を巻き添えにする経路` — 守られていない → [W-001]
- `新規ドメイン VO の不正入力（TagAssignment.reconstruct の不正 scopeType、ExternalFileRef の空文字）` — 守られていない → [W-004]

#### カバレッジ

- 確認: `packages/core/package.json`, `pnpm-lock.yaml`（`parse5@^8.0.1` の追加。`.thread/7/adr.md` ADR-001 の `HtmlProcessor` 実装に伴うもので、純 JS・Workers でも動く仕様準拠パーサ。ランタイム依存として `dependencies` に置くのは妥当。サーバ側 DI からのみ参照されクライアントバンドルには入らない）
- 確認: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- 確認: `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts`, `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts`, `packages/core/src/adapters/cloudflare/do/repositories/backupRecordRepository.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts`（`tag_assignments` / `backup_records` の DDL・索引・「note_id に FK を張らない」理由コメントは `spec/database/index.md` と ADR 008 の整理どおり）
- 確認: `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/tagAssignmentRepository.ts`, `packages/core/src/adapters/conformance/backupRecordRepository.ts`
- 確認: `packages/core/src/adapters/memory/__tests__/conformance.test.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts`, `packages/core/src/adapters/memory/repositories/backupRecordRepository.ts`, `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/memory/store.ts`
- 確認: `packages/core/src/application/cleanup/notePurgeFanOut.ts`, `packages/core/src/application/cleanup/participants.ts`
- 確認: `packages/core/src/application/di/types.ts`, `packages/core/src/application/di/memoryRuntime.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`（`NotePurgeContainer` を両コンテナが構造的に満たす形は妥当。`noteRouteResolver` → `noteRouteStore` の格上げは purge が route の CAS を要求する以上必要で、JSDoc も更新済み）
- 確認: `packages/core/src/application/execution/unitOfWork.ts`（新 2 ポートは scope plane 側。二面 UoW の分離は保たれている）
- 確認: `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`, `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`, `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`
- 確認: `packages/core/src/application/integration/deleteBackupRecordsForNote.ts`, `packages/core/src/application/integration/__tests__/deleteBackupRecordsForNote.test.ts`
- 確認: `packages/core/src/application/tag/deleteAssignmentsForNote.ts`, `packages/core/src/application/tag/__tests__/deleteAssignmentsForNote.test.ts`
- 確認: `packages/core/src/application/ports/noteMovePort.ts`
- 確認: `packages/core/src/application/workers/subscribers.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- 確認: `packages/core/src/domain/tag/{valueObject,errorCode,tagAssignment,ports/tagAssignmentRepository}.ts`, `packages/core/src/domain/integration/{valueObject,errorCode,backupRecord,ports/backupRecordRepository}.ts`（集約の形は `spec/domains/tag.md:67-86` / `spec/domains/integration.md:111-129` と一致。削除側だけを切り出す形は #8 / #4 の書き込み側を妨げない）
- 確認: `spec/inventory/usecase.md`（UC-note-037 / 038 の追加。UC-tag-013 / UC-integration-013 は既存行と実装が一致）
- 確認: `spec/presentation/index.md`（`AppConfig` から「ストレージの配信元」行を削除。`StorageUrlPolicy` が `ObjectStorage.publicUrl` 由来の `deliveryBaseUrl` を受ける形＝ADR 049 と整合しており、この削除は正しい）
- 参照のみ（判断材料として差分外を読んだ）: `packages/core/src/application/ports/scopeTaskScheduler.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/note/deleteNotesForOwner.ts`, `packages/core/src/application/note/purgeNote.ts`, `packages/core/src/application/storage/deleteFilesForNote.ts`, `packages/core/src/domain/note/events.ts`, `packages/core/src/adapters/cloudflare/sql/errors.ts`, `packages/core/src/adapters/memory/support.ts`, `spec/domains/{tag,integration}.md`, `spec/usecases/{tag,integration}.md`, `spec/testcases/tag/deleteAssignmentsForNote.md`, `spec/testcases/integration/deleteBackupRecordsForNote.md`, `spec/inventory/adapter.md`, `spec/adr/index.md`
- スキップ: `apps/web/**`（全 33 ファイル） — フロントエンド担当の範囲
- スキップ: `packages/core/src/adapters/html/**`, `packages/core/src/adapters/memory|cloudflare/**/{noteRepository,storedFileRepository}.ts` — HtmlProcessor / note / storage 担当の範囲（`storedFileRepository` は fan-out 整合の確認のため `listDeletableByNote` の差分のみ参照）
- スキップ: `packages/core/src/application/note/**`, `packages/core/src/application/storage/**`, `packages/core/src/application/usage/ensureUploadAllowed.ts` — note / storage 担当の範囲（`deleteNotesForOwner` / `purgeNote` / `deleteFilesForNote` は B-001 の判定に必要な範囲でのみ参照）
- スキップ: `packages/core/src/domain/note/**`, `packages/core/src/domain/storage/**` — note / storage 担当の範囲
- スキップ: `spec/domains/{note,storage}.md`, `spec/usecases/{note,storage}.md`, `spec/manual-tests/editing.md` — note / storage / 手動テスト担当の範囲
