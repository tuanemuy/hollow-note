### backend-tag

#### Blockers

**[B-001] `application/cleanup/participants.ts:note` / `application/note/deleteNotesForOwner.ts:settle` — `note` 障壁の ack 条件が spec 正典と逆で、local delete 後に中断した purge が誰にも再駆動されない**

本ラウンドで `personalCleanupParticipants.note` が `absent` から `participant` に変わり、barrier は `note` の ack を待つようになった。その ack を出すのは `deleteNotesForOwner.settle` で、条件は `outcome.remaining <= purgedCount`（= `listByOwner` の総件数が今回消せた件数以下）である。

`spec/usecases/note.md#deleteNotesForOwner` の「冪等性」はこれを名指しで禁じている:

> `listByOwner` に現れないが `purging` の operation が未完了な Note もあるため、scope cleanup の完了 ack は開始件数ではなく**全 purge operation が tombstone へ到達したことを確認して**返す。

`spec/inventory/usecase.md:86`（UC-note-022、本 PR で更新されていない）も同じことを言う — 「全 purge tombstone 完了確認で冪等に ack する」。実装はそのどちらも行っていない。

**帰結（実害）**:

1. `purgeNote.drive` は `deleteLocally` の commit 後に `removeForPurge` / `finishPurge` が落ちると、route を `purging` のまま残して throw する（コメントどおり「until the same command is re-issued」）。
2. その throw は `purgeEachNote` の `catch` に吸われ、`purgedCount` に数えられない。
3. しかし Note 行は既に消えているので、**次の turn の `listByOwner` にはもう現れない**。`NoteRouteStore.resolve` は `purging` 行を隠すので、他のどの列挙（`listPurgeable` も含む）からも到達できない。
4. したがって次の turn は `remaining <= purgedCount` を満たし、`note` を ack して barrier を完了させる。`deleteAccount` は finalize まで進む。
5. 残るのは、**退会済み利用者のノートの `purging` route と public projection の行**。`removeForPurge` が済んでいないので公開読み取りモデルからノートが消えない。誰も再駆動しないので恒久的に残る。

これは「完全削除で公開・共有 URL からアクセスできなくなる」（AC-9 / AC-10）と、退会時のデータ消去そのものが破れる経路である。しかも本 PR の `assertNotePurgeAdmission`（完了済み barrier を通す設計）は、この「fan-out より先に ack が出る」構造を前提として組まれているので、ack 条件は fan-out 設計の土台になっている。

参考実装の Node + in-memory ランタイムでは単一プロセスなので窓が狭いが、正典は配備に依らない。**実装を tombstone 確認に寄せるか、spec/usecases/note.md と UC-note-022 を改訂して「列挙が尽きたら ack する / 中断した purge は回収しない」を明示的な判断として書くか、どちらかが要る。** 現状は「spec がそう書いてあるのに実装が逆」で、どちらが正しいのか読み手が判断できない。

修正箇所は `application/note/deleteNotesForOwner.ts` なので backend-note の指摘と同一原因であれば 1 件に集約されたい。ここに挙げるのは、`participants.ts` の `note: participant` 宣言と `notePurgeFanOut` の受理判定がこの ack 条件に依存しているため。

#### Warnings

**[W-001] `spec/domains/tag.md:209` — 2 つの一意制約をエラー種別で分ける契約が tag 側に正典を持たず、integration 側の相互参照が循環している**

`domain/tag/ports/tagAssignmentRepository.ts` の JSDoc と `adapters/conformance/tagAssignmentRepository.ts` の「ADP-tag-010: answers a re-used assignment id with a fault, not the pair conflict」は、`(tagId, noteId)` の重複 → `ConflictError("ASSIGNMENT_ALREADY_EXISTS")` / `AssignmentId` の再利用 → `SystemError(DatabaseError)` という**振る舞いの契約**を主張している。両バックエンドがそれに合わせて実装されている（memory は `duplicateKey`、cloudflare は `duplicateId`）。

ところが `spec/domains/tag.md` は `**エラーケース**: ConflictError("ASSIGNMENT_ALREADY_EXISTS")、SystemError(DatabaseError)` と列挙するだけで、**どちらの制約がどちらに写るかを書いていない**。一方で本 PR が `spec/domains/integration.md:210` に足した同趣旨の段落は「（`TagAssignmentRepository` の `ASSIGNMENT_ALREADY_EXISTS` と同じ整理）」と tag.md を先例として指している — その先例が存在しない。

[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)・CLAUDE.md の「Adding a contractual behaviour means touching both the port JSDoc and the suite」は、正典が spec 側にあることを前提にしている。前ラウンドの [W-002] で integration 側だけが直り、tag 側に同じ穴が残った形。`spec/domains/tag.md` の `TagAssignmentRepository` 節に integration.md と同じ 1 段落を置き、integration.md の括弧書きが実在の記述を指すようにすること。

**[W-002] `adapters/conformance/backupRecordRepository.ts` — 本ラウンドで契約に格上げした `listByNote` の順序を、どのケースも順不同の挿入で検証していない**

本 PR は `spec/domains/integration.md:208` に「`listByNote` は 1 ノートの記録を `BackupRecordId` 昇順で全件返す。順序はバックエンドの裁量ではなく契約とし…」を追加し、`ADP-integration-030` を台帳にも起こした。しかし適合スイートの 3 ケースはすべて **id 昇順のまま挿入**している:

- ADP-integration-008: `backup-001` → (conflict) → `backup-003`(別ノート) → `backup-004`。期待は `["backup-001", "backup-004"]`
- ADP-integration-014: `backup-001`〜`backup-006` を昇順に挿入

挿入順を返すだけのバックエンドが全ケース green になる。順序契約が実効的に無検証。対になる `TagAssignmentRepository` 側には ADP-tag-012（`assignment-002` → `assignment-001` → 別ノート、期待 `["assignment-001","assignment-002"]`）という正しい形が既にあるので、同じ形を backup 側にも置けばよい。

同じ原因の書き漏れとして、`spec/inventory/adapter.md:275` の ADP-tag-012 の説明は「ノートの assignment を列挙する」のままで昇順に触れていない（本 PR は ADP-note-013 / ADP-storage-010 / ADP-integration-030 では順序を説明に書き足している）。順序を契約にした 3 か所と揃えること。

**[W-003] `application/di/cloudflareRuntime.ts` — 目標プラットフォームには scope outbox の読み手が無く、`note.purged` の fan-out が 1 度も走らない**

`participants.ts` の `outbox: absent(...)`、`cloudflareRuntime.ts:457` の「Global plane only. … this wiring has no reader for those」、本 PR が `spec/platform/index.md:174` に足した「global outbox の reader だけを配線した状態は、この relay を実装していない状態と同じである」— 3 か所で正直に宣言されているのは良い。

ただし帰結の大きさは本 PR で変わっている。これまで取り残されるのは `storage.fileDeleted`（実体回収は `deleteStoredObjects` の冪等性に委ねられる、= 次に配送されれば治る）だけだったが、いま取り残されるのは**ノート完全削除の後始末そのもの**である。Cloudflare 配備では purge 済みノートの `tag_assignments` / `backup_records` / `stored_files` の行と R2 のオブジェクトが恒久的に残る。`participants.ts` 自身が「the `note.purged` fan-out has no second path at all」と書いているとおり、代替経路は無い。

AC-10 / ED-10 の「完全削除で元ファイル・メディア・版・タグ付与・バックアップ記録が消える」は、参照ランタイム（outbox が 1 表なので global relay が拾う）でしか成立しない。ADR 025 のもとでは出荷対象外なので Blocker にはしないが、**scope outbox の読み side を入れる前に Cloudflare ランタイムを本番として立ち上げてはならない**ことが、DI のコメントより強い形（`spec/platform/index.md` の配備前提、あるいは Issue）で残っているべき。

**[W-004] `application/tag/__tests__/` / `application/integration/__tests__/` — 本ラウンドで testcase 文書に足した受理判定の 2 節が無検証**

`assertNotePurgeAdmission` は 3 追随者が共有する認可点なので、節ごとに 1 ケースあれば足りるが、次の 2 つはどのテストも通っていない:

1. **workspace scope に非 null の token が来た turn は拒む** — `spec/testcases/integration/deleteBackupRecordsForNote.md` に本 PR で追加した「受理判定は personal barrier の receipt 1 本なので、`deletionOperationId` を積んだ turn がワークスペース scope で通ることはない」。TC-integration-022 のテストは `run(h, null, workspaceScope)` と **token を null で**呼んでいるので、この節はまったく実行されない。`notePurgeFanOut.ts` の型 JSDoc と `assertNotePurgeAdmission` の JSDoc がどちらもこの拒否を安全性の根拠として挙げている以上、fail-closed であることをテストが押さえるべき（memory の `cleanupReceipts` は scope 単位なので実際には拒まれる — 検証が無いだけ）。
2. **receipt がそもそも存在しない token を拒む** — `spec/testcases/tag/deleteAssignmentsForNote.md` に足した「別 operation・**不在**・abort 済みは `ConflictError("CLEANUP_OPERATION_MISMATCH")`」のうち、「別 operation」は TC-integration-024（`"deletion-9"`）、「abort 済み」は TC-tag-027 が押さえているが、「不在」（barrier を 1 度も開かずに token 付き turn が来る）はどちらにも無い。

**[W-005] `application/cleanup/notePurgeFanOut.ts:readNotePurgeTurn` — 「壊れた payload は `DataIntegrityError`」という宣言が全域でない**

`readNotePurgeTurn` は `noteId` の型と空文字を弾いて `SystemError(DataIntegrityError)` にするが、最後の `NoteId.create(noteId)` はガードの外にある。`{ noteId: "   " }` のような空白のみの id は `NoteId.create` が `BusinessRuleError(NOTE_INVALID_ID)` を投げ、`corrupt()` を経由しない。

`subscribers.test.ts` の「faults on a payload that names no note or an unreadable token, rather than inventing a turn」は `""` / `12` / 欠落しか見ておらず、この経路を通らない。scope task の payload は自分たちが書いたものなので実害は小さいが、`corrupt` を「payload が読めないときの唯一の答え」として JSDoc に書いている以上、`NoteId.create` も同じ `try` に入れるか、JSDoc の主張を狭めるかのどちらかにすること。

**[W-006] `application/workers/subscribers.ts:dispatchDomainEvent` — 兄弟隔離の緩和が全 event 型に効くのに、根拠は fan-out にしか触れていない**

変更後の JSDoc は「the followers of one event clean up aggregates that know nothing of each other」を根拠に、失敗した subscriber の後ろも走らせる。`note.purged` の 3 追随者についてはそのとおりで、テスト（"runs the siblings of a failing subscriber and still fails the delivery"）も効いている。

ただしこの `try`/`catch` は `subscribers` 全体に効くので、`identity.accountDeletionDispatchContinued`（`accountDeletionCleanup` / `accountDeletionGlobalCleanup` / `accountDeletionRedaction` / `accountDeletionFinalize` の 4 件）にも同じ緩和が入る。これらは「互いを知らない追随者」ではなく **1 つのサガの phase** で、`phase !== "cleanup"` の早期 return があるため実際に同時に走るのは cleanup の 2 件だけ、かつ `globalCleanup.ts` の JSDoc が「Both halves are idempotent, and the work of each is skipped once its receipt is in」と両半分の独立を保証している — つまり結論としては安全だと読めた。

問題は、その安全性がこの変更の説明のどこにも書かれていないこと。「前の subscriber が落ちても次が走る」は退会サガの順序保証を静かに変えているので、JSDoc は fan-out だけでなく「phase subscriber も receipt で互いに独立している」まで述べるべき。さもないと次に phase を足す人が、消えた順序保証をまだあるものとして設計する。

**[W-007] 記述の衛生（2 件、同一原因: 説明が「その仕事をするスライス」を答えにしている / 一覧の体裁）**

- `application/cleanup/participants.ts:localProjection.handoff` — 本 PR で `"editing / curation"`（実在のスライス名）から `"the slice that enqueues deletion-driven local projection tasks"` に変わった。`PersonalCleanupParticipant` 型の JSDoc は handoff を「Slice that turns this entry into a participant」と定義しているので、「この項目を participant にするスライス」を答えにすると同語反復で、次に読む人が引き継ぎ先を引けない（`outbox` の `"the slice adding a scope outbox read side"` も同じ形だが、そちらは本 PR 以前から）。`#4` / `#5` / `curation` のように実在の Issue / スライスを指すこと。
- `spec/usecases/tag.md:368` — 手順 1 と手順 2 のあいだに空行が入り、番号付きリストが loose list になった（整形が手順 1 だけ段落扱いになる）。integration.md 側の同じ改訂には空行が無いので、揃えて削ること。

#### テスト保証

**実効的に担保されているもの**

- **購読者単位の冪等** — `subscribers.test.ts` の "clears the files, assignments and backup records … and stays a no-op on redelivery" が、3 追随者を既定レジストリ経由で 2 回配送し、2 回目に残件 0・outbox 件数不変を確認している。加えて usecase 側でも TC-tag-030 / TC-integration-021 が `first.deletedCount` と `second.deletedCount` を別々に主張しており、「購読者ごとに独立して冪等」が satisfied。
- **購読者の登録漏れ** — "registers one subscriber per follower" が `note.purged` の consumerName 集合を `["integration.deleteBackupRecordsForNote", "storage.deleteFilesForNote", "tag.deleteAssignmentsForNote"]` と完全一致で主張する。`dispatchDomainEvent` が未購読 event を warn だけで ack する（= 書いて登録し忘れても全テスト green）という穴を、正しく登録そのもので塞いでいる。前ラウンドの懸念に対する正攻法。
- **兄弟の隔離** — "runs the siblings of a failing subscriber and still fails the delivery" が呼び出し順（`["boom","later","boom-2"]`）と error ログ 2 本、かつ delivery が throw することを同時に主張。3 つを別々に見ているので、片方だけ実装しても落ちる。
- **scope の取り違え** — "TC-integration-022: reclaims a workspace-owned note's residue in the workspace scope, leaving the personal scope untouched" が**両 scope に同じ残渣を仕込んでから**片方だけ消えることを見ている。`scopeOfNoteOwner` の workspace 分岐が subscriber 経由でしか通らないため、これが唯一の検証点で、「どこかで消えた」ではなく「どの scope で消えた」を主張できている。前ラウンド [W-004] に対する適切な応答。
- **継続の priority と再開** — TC-tag-027 / TC-integration-023 が `{kind, operationId, priority, payload}` を丸ごと `toEqual` で見ており、securityCleanup が積まれること・payload が token を保持することを 1 度に押さえる。対になる「削除由来でない purge は `expiryCollection`」も TC-tag-027 の 2 本目が明示。前ラウンド [W-003] に対する応答として過不足ない。
- **受理判定が turn ごとであること** — TC-tag-027 が 2 turn 通したあとに `abortPersonalAccountDeletion` を挟み、3 turn 目が `ConflictError` になり残 50 件が消えないことを見ている。「operation 単位で 1 度検査」では通らない形。
- **完了済み barrier を通すこと** — TC-tag-028 / TC-integration-024 の 2 本目が `markCompleted` 後に 2 turn（1 turn 目は直接、2 turn 目は `runDueScopeTasks` 経由）走ることを確認。`assertOwner` に戻すと必ず落ちる。
- **未登録 kind による滞留** — 両 usecase の "has its continuation resumed by the scope-task runner" が `runDueScopeTasks` を実際に通して `round.processed === 1` と残件 0 を主張する。`scopeTaskHandlers` への登録漏れがそのまま赤になる。
- **適合スイートの両バックエンド実行** — `conformanceCoverage.test.ts` の `PERSISTENCE_SUITES` を 43 → 45 に上げ、memory と cloudflare の呼び出し集合一致を保っている。cloudflare 側は `do/schema.ts` の 2 表 + 索引と実アダプターで走るので、`clashOf` の事前読みと UNIQUE 索引フェンスの両方が実際に評価される。
- **id 再利用と対の衝突の区別** — 両スイートの「answers a re-used … id with a fault, not the … conflict」が `rejects.toSatisfy(isSystemError)` に加えて**両ノートの列挙が変化していないこと**まで見ている。エラー種別だけを見て副作用を見ない形になっていない。
- **ドメインの再構築** — `domain/{tag,integration}/__tests__/valueObject.test.ts` が `isRehydrationError` を各欠損フィールドで確認し、`scopeType: "team"` が BusinessRuleError ではなく RehydrationError になることまで主張。`toBeDefined()` 単独や `not.toBe` 系の空振りは無い。
- **participants の派生** — `deleteAccount.cleanup.test.ts` が `acknowledged` を `["note","storage","usage"]` と**内容で**比較する形に変わった（従来は `toHaveLength(2)`）。`terminalPrune.test.ts` も literal 配列から `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` 参照に変わり、participant を足したときに片側だけ緑になる経路が消えた。良い変更。

**担保されていないもの**

- W-002: `BackupRecordRepository.listByNote` の昇順契約（挿入順を返すだけで全ケース green）。
- W-004-1: workspace scope × 非 null token の拒否（TC-integration-022 は token を null で呼んでいる）。
- W-004-2: receipt 不在の token の拒否。
- W-005: 空白のみの `noteId` を載せた payload（`corrupt()` を通らず BusinessRuleError になる）。
- B-001: local delete 後に中断した purge が回収されないこと自体を突くケース。`purgeNote` 側に TC-note-780（「同じコマンドの再送が public remove 以降を再開する」）が足されたが、`deleteNotesForOwner` 経由では**その再送が起きない**ことを見るケースは無い。
- `purgeNote` → 実 outbox → relay → 3 追随者、という end-to-end の 1 本。`subscribers.test.ts` は `NotePurgedEvent` を手で組んでおり、`purgeNote` が実際に載せる payload（`owner` / `operationId` / `deletionOperationId`）との突き合わせは型だけに委ねられている。

#### カバレッジ

**確認したファイル（担当分すべて）**

- `packages/core/package.json` / `pnpm-lock.yaml`（`parse5@8.0.1` の importer 宣言と snapshot の対応を確認）
- `packages/core/src/domain/tag/`: `valueObject.ts` / `tagAssignment.ts` / `errorCode.ts` / `ports/tagAssignmentRepository.ts` / `__tests__/valueObject.test.ts`
- `packages/core/src/domain/integration/`: `valueObject.ts` / `backupRecord.ts` / `errorCode.ts` / `ports/backupRecordRepository.ts` / `__tests__/valueObject.test.ts`
- `packages/core/src/application/tag/deleteAssignmentsForNote.ts` + `__tests__/deleteAssignmentsForNote.test.ts`
- `packages/core/src/application/integration/deleteBackupRecordsForNote.ts` + `__tests__/deleteBackupRecordsForNote.test.ts`
- `packages/core/src/application/cleanup/notePurgeFanOut.ts` / `participants.ts`
- `packages/core/src/application/workers/subscribers.ts` / `scopeTaskRunner.ts` / `__tests__/subscribers.test.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts` / `cleanupDispatch.ts` / `__tests__/deleteAccount.cleanup.test.ts` / `__tests__/deleteAccount.terminalPrune.test.ts`
- `packages/core/src/application/di/types.ts` / `memoryRuntime.ts` / `cloudflareRuntime.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/ports/noteMovePort.ts` / `noteRouteStore.ts` / `objectStorage.ts`
- `packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts` / `backupRecordRepository.ts` / `__tests__/conformance.test.ts` / `__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts` / `backupRecordRepository.ts` / `do/schema.ts` / `__tests__/conformanceBackend.ts` / `__tests__/conformance/scopeBusiness.test.ts` / `__tests__/ports/scopeBusiness.ts` / `__tests__/deleteFilesByOwner.test.ts` / `__tests__/runtimeComposition.test.ts`
- `packages/core/src/adapters/conformance/backend.ts` / `tagAssignmentRepository.ts` / `backupRecordRepository.ts`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `spec/domains/tag.md` / `spec/domains/integration.md` / `spec/usecases/tag.md` / `spec/usecases/integration.md` / `spec/platform/index.md` / `spec/inventory/adapter.md` / `spec/inventory/test.md` / `spec/inventory/usecase.md` / `spec/testcases/tag/deleteAssignmentsForNote.md` / `spec/testcases/integration/deleteBackupRecordsForNote.md`

**判断のために差分外を読んだファイル**

`spec/database/index.md`（priority クラスと `scheduled_tasks.operation_id` の決定的採番規則。本 PR に差分なし）、`spec/usecases/note.md#deleteNotesForOwner`、`spec/domains/index.md`（継続要求の一覧）、`application/note/purgeNote.ts`、`application/note/deleteNotesForOwner.ts`、`application/ports/scopeTaskScheduler.ts`、`application/ports/scopeCleanupAdmissionStore.ts`、`adapters/memory/repositories/scopeCleanupAdmissionStore.ts`、`adapters/memory/support.ts`、`adapters/memory/store.ts`、`adapters/memory/scopeUnitOfWork.ts`、`application/identity/deleteAccount/globalCleanup.ts`、`domain/{note,storage}/errorCode.ts`

**スキップしたファイル**

なし。担当範囲（`domain/{tag,integration}`、`application/{tag,integration,cleanup,workers,identity,di,execution,ports}`、両バックエンドの tagAssignment / backupRecord リポジトリとスキーマ、`adapters/conformance/` の該当分、`adapters/__tests__/`、`packages/core/package.json` / `pnpm-lock.yaml`、担当分の `spec/`）の変更ファイルはすべて差分本文で確認した。`spec/database/index.md` は担当範囲だが本 PR に差分が無く、参照のみ。

**確認済みで指摘に至らなかった点（記録）**

- `note.purged` 追随者の継続行キー `(kind, purgeOperationId)` は、`purgeNote` の内部 operation ID が `sha256("ownerPurge:" + deletionOperationId + ":" + noteId)` / `sha256("trashExpiry:" + noteId)` とノートごとに導出されるため衝突しない。`userRequest` の採番だけ乱数だが、値は `note.purged` の payload から来るので再配送で同じ行に upsert される（`spec/database/index.md:39` の趣旨を満たす）。
- `runDueScopeTasks` は scope ごとに `claimDue` を 1 回しか呼ばないので、`dueAt: now` で再武装した行が同一ラウンドで再claimされる無限ループにはならない。`schedule` が `attempt` を 0 に戻すが、各 turn は必ず 1 ページ前進するので予算は減り続ける。
- `describePersonalCleanup` は scope 束縛（memory は `scope.cleanupReceipts`）で、別 operation・abort 済みには `null` を返す。workspace scope は receipt を持ち得ないので非 null token は必ず拒まれる（検証は W-004 参照）。
- `assertNotePurgeAdmission` / `armNotePurgeContinuation` はいずれも呼び出し側の `run` の**中**で ctx 経由に呼ばれており、`run` の入れ子は発生していない。`clock.now()` は `run` の外。
- cloudflare の UNIQUE フェンス（`String(cause).includes(...)`）は triage で wont-fix 済み。
- memory の `compareStrings` と cloudflare の `compareText` / SQLite `ORDER BY id`（BINARY）は同じ全順序で、`listByNote` の順序契約は両バックエンドで一致する。
- `NoteRouteResolver` 型の撤去は残存参照ゼロ。`WorkerContainer` / `RequestContainer` の双方が `NotePurgeContainer` を構造的に満たす。
