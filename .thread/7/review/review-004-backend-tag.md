### backend-tag

#### Blockers

なし。

前ラウンドの [B-001]（`note` 成分の ack が「列挙が空」で出てしまい、local delete 後に停止した purge が誰にも回収されない）は解消されている。`deleteNotesForOwner.ts` に `StuckPurge` の持ち回りが入り、ack 条件が `outcome.remaining <= purgedCount` から

- `settle` の第 2 分岐 `outcome.remaining > outcome.purgedFromPage || stuckPurges.length > 0` → 継続（`deleteNotesForOwner.ts:361`）
- 第 3 分岐でだけ `acknowledgePersonalComponent(..., "note")`（`deleteNotesForOwner.ts:376-379`）

に変わり、`isOutOfReach`（`deleteNotesForOwner.ts:305-317`）が「route が解決しない＝どの列挙からも消えた」ノートを継続 payload に載せる。`spec/usecases/note.md:966-967` と `spec/inventory/usecase.md:86` の「全 purge tombstone 完了確認で冪等に ack する」に一致し、TC-note-781 / 782 / 783 / 788 / 789 が `acknowledged` に `note` が入らないことを個別に主張している。

#### Warnings

**[W-001] `domain/{tag,integration}/ports/*.deleteByNote` — 適合スイートが削除ページの順序を固定しているのに、ポート契約にも `spec/` にもその宣言が無い（tag / integration 同一原因）**

`adapters/conformance/tagAssignmentRepository.ts:100-103` と `adapters/conformance/backupRecordRepository.ts:111-114` は、`deleteByNote(noteId, 2)` のあと残るのが `assignment-003/004/005`・`backup-003/004/005` であることを主張する。つまり**有界削除は id 昇順の先頭から取る**という順序を契約として固定している。両バックエンドはそのとおり実装されている（memory は `ofNote()` の `compareStrings` ソート後 `slice`、cloudflare は `ORDER BY id LIMIT ?`）。

ところがその順序はどこにも書かれていない:

- `domain/tag/ports/tagAssignmentRepository.ts:47-56` / `domain/integration/ports/backupRecordRepository.ts:49-58` の `deleteByNote` JSDoc は「at most `limit`」「rows it deleted cannot come back, reading from the start always moves forward」としか言わず、**どの `limit` 件かは述べていない**
- `spec/domains/tag.md:171` と `spec/domains/integration.md:208` は本 PR で `listByNote` の昇順だけを契約に格上げしたが、`deleteByNote` には触れていない

本 PR は同じ 2 ファイルで `listByNote` の順序を「バックエンドの裁量ではなく契約」として明文化し、`spec/inventory/adapter.md` の ADP-tag-012 / ADP-integration-030 まで揃えた。同じ扱いが `deleteByNote` に無いのは非対称で、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)・CLAUDE.md の「Adding a contractual behaviour means touching both the port JSDoc and the suite」を片側だけ満たしている。ランダム順で `limit` 件消すバックエンドは 2 つの JSDoc を全文満たしながらスイートで落ちる。

順序を契約にするなら 2 つのポート JSDoc（と `spec/domains/{tag,integration}.md`）に 1 文を足し、契約にしないならスイートの主張を「残り 3 件である」（集合・件数）へ緩めること。

**[W-002] `application/note/deleteNotesForOwner.ts:18-24` — バッチ 100 の根拠が `spec/platform/index.md` の Global D1 予算と噛み合っていない**

`OWNER_PURGE_BATCH_SIZE = 100` の JSDoc は

> The cap is about the CPU of a single alarm turn and the `note.purged` fan-out it emits, **not about query count — scope-local SQL carries no D1 budget** (spec/platform/index.md「実行予算と分割単位」).

と書くが、引かれている節はその逆を言っている。`spec/platform/index.md:134` は「1 Worker invocation が発行してよい D1 query は **500** を設計上限とする。この予算が掛かるのは Identity、**directory / route operation**、**global projection** / rebuild だけである」。

1 ノートの purge は、`purgeNote.ts` の経路上で毎回 global を叩く:

- `admitInternal` の `noteRouteStore.resolve`（`purgeNote.ts:408`）
- `claimRoute` / `resumeInternal` の `beginPurge`（CAS。`purgeNote.ts:476` / `515`）
- `drive` の `publicNoteProjectionWriter.removeForPurge`（`purgeNote.ts:324`）
- `drive` の `noteRouteStore.finishPurge`（`purgeNote.ts:330`）
- 失敗時はさらに `isOutOfReach` の `resolve`（`deleteNotesForOwner.ts:310`）

最低でも 1 ノートあたり 4 往復、CAS を 2 文と数えれば 6 前後で、100 ノート/turn は 400〜600 query になり 500 の設計上限に張り付くか超える。`spec/platform/index.md:147` の「owner / workspace cleanup ｜ **100 rows** ｜ 1 Alarm turn の CPU と outbox fan-out」は **Scope DO** 節の表であって、その根拠欄に global D1 は入っていない。ノートの一括 purge はこのスライスで初めて生まれた「scope cleanup なのに global D1 を件数ぶん叩く」経路なので、どちらの節も現状ではこれを勘定に入れていない。

参照ランタイム（Node + memory）には D1 が無いので出荷影響は無く Blocker にしないが、少なくとも **JSDoc が spec を根拠に挙げるのをやめる**か、`spec/platform/index.md`「実行予算と分割単位」に purge turn の global 予算（例: 1 turn の note 数 × route/projection query 数）を 1 行足すこと。いまは「spec を引いた説明が spec と反対のことを言っている」状態で、次に batch size を触る人が誤った安全側の根拠を継ぐ。

`deleteNotesForOwner.ts` は backend-note の持ち分なので、同じ指摘が向こうにもあれば 1 件に集約されたい。ここに挙げるのは、この batch size が `note.purged` fan-out の 3 追随者（`tag` / `integration` / `storage`）の 1 turn あたり発行 event 数を決める、横断配線側の量だからである。

**[W-003] `spec/domains/index.md:276` — `note.ownerPurgeContinued` の payload 記述が実装と一致しなくなった**

`application/cleanup/participants.ts:40-46` は新しい `NOTE_OWNER_PURGE_TASK_KIND` の JSDoc で「`note.ownerPurgeContinued`, spec/domains/index.md「継続要求」」とその表を kind の正典として引いている。ところが表の行は

| `note.ownerPurgeContinued` | `{ scope, deletionOperationId }` | scope Alarm → `deleteNotesForOwner` |

のままで、本 PR が payload に足した**持ち回り対象**（`deleteNotesForOwner.ts:51` の `stuckPurges`、`readOwnerPurgeTurn` が読む `{ noteId, expectedVersion }[]`）が無い。`spec/usecases/note.md:966` は「そのノート ID を継続要求の payload に載せて次の turn へ持ち回る」と正しく書いているので、**同じ payload の記述が 2 か所にあって片方だけ古い**。

`spec/domains/index.md`「継続要求」は「継続要求は、続きを引き直すのに必要な情報をすべて運ぶ」（同 319 行）を規範として置いている表なので、そこに載っていない項目は「運ばなくてよい」と読める。`stuckPurges` を落とした実装は B-001 そのものに戻るため、この行の更新は装飾ではない。（`{ scope, ... }` の `scope` が実装の payload に無いのは `scheduled_tasks` 側の列である従来どおりの整理で、`storage.ownerDeleteContinued` も同じ。ここでの指摘は `stuckPurges` だけ。）

**[W-004] `domain/integration/valueObject.ts:31` — `ExternalFileRef.create` だけが trim せず、JSDoc の主張と噛み合わない**

同ファイルの `BackupRecordId.create`（:12-14）も `domain/tag/valueObject.ts` の `TagId` / `AssignmentId` も `trim()` してから空判定する。`ExternalFileRef.create` だけが `externalFileId.length === 0 || webViewUrl.length === 0` と生の長さを見るので、`"   "` は通る。

`domain/integration/__tests__/valueObject.test.ts:52-55` のコメントは「Half an address is not an address: with either side empty the record cannot point back at the copy it describes」と述べており、空白のみの URL は同じ理由で住所ではない。テストも `""` しか見ていない（:53 / :56）。`BackupRecord.reconstruct` の「storage cannot have emptied」ループ（:74-80）も `{ externalFileId: "" }` / `{ webViewUrl: "" }` で、id 系だけ `" "` を使っている。

trim して揃えるか、trim しない理由（外部 ID は前後の空白も有意、など）を 1 行で書くこと。前者なら `ExternalFileRef` は trim 後の値を返すべきで、いまは検証と正規化のどちらもしていない。

**[W-005] `adapters/cloudflare/do/schema.ts:310-318` — `tag_assignments.tag_id` の FK CASCADE が落ちていることの宣言が無い**

`spec/database/index.md:624` は `tag_id` を「NOT NULL, FK → `tags.id` ON DELETE CASCADE」と定め、`spec/domains/tag.md:144` は「FK CASCADE は安全網であり scope cleanup の作業分割には使わない」と、あくまで安全網として在ることを前提に書いている。DO schema の `tag_assignments` にはこの FK が無い。理由は明らかで、`SCOPE_TABLES` に `tags` がまだ無い（curation スライス待ち）ためだが、**説明されているのは `note_id` の FK 不在だけ**（:307-309 のコメント）で、`tag_id` については何も書かれていない。

`note_id` の不在は設計判断（別ドメインなのでイベントで後始末する）、`tag_id` の不在はスライス都合の未了、と性質が違う。curation スライスが `tags` 表を足すときに FK を戻し忘れると、spec が安全網として数えているものが黙って消えたままになる。同じコメントブロックに 1 文足すこと。

#### テスト保証

**実効的に担保されているもの**

- **前ラウンドで指摘した無検証 3 点がすべて塞がった。**
  - `listByNote` の昇順（backup 側）— `adapters/conformance/backupRecordRepository.ts:73-75` が `backup-002` → `backup-001` → 別ノートの順に挿入してから `["backup-001","backup-002"]` を主張する。挿入順を返すだけのバックエンドは落ちる。tag 側の ADP-tag-012（:78-86）も同形。
  - workspace scope × 非 null token の拒否 — `deleteBackupRecordsForNote.test.ts:193-213`（TC-integration-022 の 2 本目）が personal scope で barrier を開いたうえで workspace scope に同じ token を渡し、`CLEANUP_OPERATION_MISMATCH` と**行が残っていること**まで見る。
  - receipt 不在の token の拒否 — `deleteAssignmentsForNote.test.ts:240-258`（TC-tag-028 の 2 本目）が `beginPersonalAccountDeletion` を 1 度も呼ばずに token 付き turn を投げ、`ConflictError` かつ付与が残ることを主張。
- **`readNotePurgeTurn` の門が `NoteId` の不変条件と一致した。** `notePurgeFanOut.ts:58-65` が `trim().length === 0` で弾き、`subscribers.test.ts` の "faults on a payload that names no note or an unreadable token" が `{}` / `""` / `"   "` / `12` / `deletionOperationId: 12` を並べたうえ、`"   "` と不正 token については `SystemErrorCode.DataIntegrityError` であることまで個別に確認する（`expect(...).toThrow(SystemError)` だけで終えていない）。対の "reads an absent, null or empty deletion token as `null`" が 4 形とも `toEqual` で戻り値を見ている。
- **兄弟隔離が「順序」「ログ」「delivery の失敗」を別々に主張。** `subscribers.test.ts` の "runs the siblings of a failing subscriber and still fails the delivery" が `calls === ["boom","later","boom-2"]`、error ログ 2 本の**メッセージ完全一致**、`rejects.toThrow("boom")` の 3 つを同時に見る。片方だけ実装しても落ちる形。
- **fan-out 購読者の登録漏れ。** "registers one subscriber per follower" が `note.purged` の consumerName 集合を 3 件と完全一致で主張。`dispatchDomainEvent` が未購読 event を warn だけで ack する穴（＝書いて登録し忘れても全テスト green）を、登録そのもので塞いでいる。
- **`scopeOfNoteOwner` の workspace 分岐。** TC-integration-022 が**両 scope に同じ残渣を仕込んでから**片方だけ消えることを見るので、「どこかで消えた」ではなく「どの scope で消えた」を主張できている。
- **完了済み barrier を通すこと。** TC-tag-028 / TC-integration-024 の各 2 本目が `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` 全成分を ack → `markCompleted` してから 2 turn（直接 + `runDueScopeTasks` 経由）走る。`assertOwner` に戻すと必ず落ちる。ヘルパー `completeBarrier` が literal 配列でなく `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` を回しているので、participant を足したときに片側だけ緑になる経路も無い。
- **受理判定が turn ごとであること。** TC-tag-027 が 2 turn 通したあと `abortPersonalAccountDeletion` を挟み、3 turn 目が `ConflictError` になり残 50 件が消えないことを見る。「operation 単位で 1 度検査」では通らない。
- **継続の priority と payload。** TC-tag-027 / TC-integration-023 が `{kind, operationId, priority, payload}` を丸ごと `toEqual` する。tag 側は「削除由来でない purge は `expiryCollection`」も別ケースで明示。
- **未登録 kind による滞留。** 両 usecase の "has its continuation resumed by the scope-task runner" が `runDueScopeTasks` を実際に通し `round.processed === 1` と残件 0 を主張するので、`scopeTaskHandlers` への登録漏れがそのまま赤になる。
- **participants の派生が literal から外れた。** `deleteAccount.cleanup.test.ts:177-181` が `acknowledged` を `["note","storage","usage"]` と内容で比較（従来は `toHaveLength(2)`）、`deleteAccount.terminalPrune.test.ts:284` も `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` 参照に変わった。
- **id 再利用と対の衝突の区別。** 両スイートの「answers a re-used … id with a fault」が `rejects.toSatisfy(isSystemError)` に加えて**両ノートの列挙が変化していないこと**まで見る。
- **ドメインの再構築。** `domain/{tag,integration}/__tests__/valueObject.test.ts` が `isRehydrationError` を各欠損フィールドで確認し、`scopeType: "team"` が BusinessRuleError ではなく RehydrationError になることまで主張。`toBeDefined()` 単独や `not.toBe` 系の空振りは無い。
- **適合スイートの両バックエンド実行。** `conformanceCoverage.test.ts` の `PERSISTENCE_SUITES` を 43 → 45 に上げ、memory と cloudflare の呼び出し集合一致を保っている。cloudflare 側は `do/schema.ts` の 2 表 + 索引と実アダプターで走るので、`clashOf` の事前読みと UNIQUE 索引フェンスの両方が実際に評価される。

**担保されていないもの**

- W-002 に対応するもの: 1 turn が発行する global D1 query 数を観測する形のテストは無い（`spec/testcases/storage/deleteFilesByOwner.md` にある「件数に比例した追加の往復を要求しない」に相当するものが note purge 側に無い）。
- W-004: 空白のみの `externalFileId` / `webViewUrl`。
- **`PERSONAL_CLEANUP_COMMANDS.note` の配線が、ノートが 1 件でもある状態で通っていない。** `deleteAccount.cleanup.test.ts` はノートを 1 件も仕込まないので、TC-identity-086 が主張する `acknowledged === ["note","storage","usage"]` の `note` は**列挙 0 件の turn**が出した ack である。`storage` には「150 件仕込んで 1 wave では ack させない」TC-identity-085 があるのに、`note` に対応するものが無い（＝ 1 wave で終わらない purge が barrier を `running` に留めることは、`deleteNotesForOwner.test.ts` の単体でしか見ていない）。usecase 側の TC-note-067〜082 / 781〜789 が厚いので実害は小さいが、dispatch 経由の 1 本があると `PERSONAL_CLEANUP_COMMANDS` の型網羅以上の担保になる。
- **`purgeNote` → 実 outbox → relay → 3 追随者、という end-to-end の 1 本。** `subscribers.test.ts` は `NotePurgedEvent` を手で組んでおり（:229-244）、`purgeNote` が実際に載せる payload（`owner` / `operationId` / `deletionOperationId` / `sourceFileId`）との突き合わせは型だけに委ねられている。前ラウンドから変わっていない。
- `armNotePurgeContinuation` の `expiryCollection` 分岐は tag 側にしかケースが無い（integration 側は `securityCleanup` のみ）。実装は共有なので重複ではあるが、非対称のまま。

#### カバレッジ

**確認したファイル（担当分すべて）**

- `packages/core/package.json` / `pnpm-lock.yaml`（`parse5@8.0.1` + `entities@8.0.0` の importer 宣言と snapshot の対応）
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
- `packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts` / `backupRecordRepository.ts` / `scopeUnitOfWork.ts` / `store.ts` / `__tests__/conformance.test.ts` / `__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts` / `backupRecordRepository.ts` / `do/schema.ts` / `__tests__/conformanceBackend.ts` / `__tests__/conformance/scopeBusiness.test.ts` / `__tests__/ports/scopeBusiness.ts` / `__tests__/deleteFilesByOwner.test.ts` / `__tests__/runtimeComposition.test.ts`
- `packages/core/src/adapters/conformance/backend.ts` / `tagAssignmentRepository.ts` / `backupRecordRepository.ts`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `spec/domains/tag.md` / `spec/domains/integration.md` / `spec/usecases/tag.md` / `spec/usecases/integration.md` / `spec/platform/index.md` / `spec/database/index.md` / `spec/inventory/adapter.md` / `spec/inventory/test.md` / `spec/inventory/usecase.md` / `spec/testcases/tag/deleteAssignmentsForNote.md` / `spec/testcases/integration/deleteBackupRecordsForNote.md`

**判断のために差分外を読んだファイル**

`spec/domains/index.md`（「継続要求」の表と決定的採番の規則。本 PR に差分なし）、`spec/usecases/note.md#deleteNotesForOwner`、`spec/testcases/note/deleteNotesForOwner.md`、`application/note/purgeNote.ts`、`application/note/deleteNotesForOwner.ts` + その `__tests__`、`application/cleanup/personalCleanup.ts`、`application/ports/scopeTaskScheduler.ts`、`application/ports/scopeCleanupAdmissionStore.ts`、`application/identity/deleteAccount/globalCleanup.ts`、`application/storage/deleteFilesForNote.ts` / `deleteFilesByOwner.ts`、`domain/note/valueObject.ts`、`domain/note/events.ts`、`apps/web/app/server.node.ts`（`dispatchDomainEvent` の呼び出し位置）

**スキップしたファイル**

なし。担当範囲（`domain/{tag,integration}`、`application/{tag,integration,cleanup,workers,identity,di,execution,ports}`、両バックエンドの tagAssignment / backupRecord リポジトリとスキーマ、`adapters/conformance/` の該当分、`adapters/__tests__/`、`packages/core/package.json` / `pnpm-lock.yaml`、担当分の `spec/`）の変更ファイルはすべて差分本文で確認した。

**確認済みで指摘に至らなかった点（記録）**

- **`participants.ts` の宣言と実装の突き合わせ（今ラウンドの主眼）。** `note: participant` は `deleteNotesForOwner.settle` の ack と `PERSONAL_CLEANUP_COMMANDS.note` の両方で裏打ちされており、`REQUIRED_PERSONAL_CLEANUP_COMPONENTS` の派生順（`storage` → `usage` → `note`）でも note が最後に来るため、note の ack が barrier を閉じ、そのあと `assertOwner` を使う storage / usage の継続が拒まれる、という順序事故は起きない。逆方向（退会が完了しなくなる）も、`settle` の `stalled` 分岐が `backoffOrSchedule` に落ちて継続を増やさないので無限増殖は無い。
- `tag: absent("Nothing sweeps a whole scope's tags")` / `backup: absent("Nothing sweeps a user's backup records")` は正確。`TagAssignmentRepository` に `deleteByScope`、`BackupRecordRepository` に `deleteByUser` はどちらも実在せず、fan-out はノート単位でしか駆動しない。したがって barrier がこの 2 成分を待たないのは宣言どおりで、待たせると（scope 全体の掃き出しが無いので）退会が永久に完了しない側の事故になる。
- `localProjection` の `absent` 理由も現況どおり。`purgeNote` は `noteProjectionRevisionStore.bump` はするが local projection 行の削除は行わず、それを行う `projectNoteChanges` は本スライスに無い。
- 完了済み barrier を通す判定（`assertNotePurgeAdmission`）と 120 日の `pruneCompleted` の関係: prune 後に届いた fan-out は `CLEANUP_OPERATION_MISMATCH` で恒久的に取り残されるが、`spec/usecases/tag.md:367` が「prune 済みは `ConflictError`」と明示的に受け入れているので設計判断として一貫している。
- 兄弟隔離の全 event 型への波及は安全。`identity.accountDeletionDispatchContinued` の 4 購読者のうち同時に走りうるのは `cleanup` phase の 2 件だけで、`runAccountDeletionGlobalCleanup` は `authResidue` / `uniquenessRelease` という personal cleanup と独立な receipt しか触らず、finalize は phase ガードで別配送になる。JSDoc も今ラウンドでその独立性を明文化した（前ラウンド [W-006] への応答）。
- 追随者の継続行キー `(kind, purgeOperationId)` はノートごとに決定的（`admitInternal` が `ownerPurgeOperationId(deletionOperationId, noteId)` / `retentionPurgeOperationId(noteId)` を使う）なので、1 退会が N ノートを purge しても 3N 行に分かれて衝突しない。`userRequest` だけ乱数採番だが、値は `note.purged` payload 経由なので再配送で同じ行に upsert される。
- `deleteByNote` が満杯を返したときだけ再武装する形は、行が増えないため必ず前進し、`complete` は不在行に対して no-op（`ScopeTaskScheduler` の表）なので初回配送でも安全。同一ノートに対する「event 再配送 turn」と「scope task turn」が同時に走っても、削除は排他で、`deletedCount < limit` は「読み取り時点で limit 未満しか無かった」ことと同値なので、行が残ったまま `complete` される窓は無い。
- `assertNotePurgeAdmission` / `armNotePurgeContinuation` はいずれも呼び出し側の `run` の**中**で `ctx` 経由に呼ばれており、`run` の入れ子は無い。`clock.now()` は `run` の外。`dispatchDomainEvent` は `server.node.ts:105` の consumer handler から UoW の外で呼ばれる。
- `NoteRouteResolver` 型の撤去は残存参照ゼロ。`runtimeComposition.test.ts` の `WORKER_PORTS` / `REQUEST_PORTS` も追随済みで、`WorkerContainer` / `RequestContainer` の双方が `NotePurgeContainer` を構造的に満たす。
- cloudflare の UNIQUE フェンス（`String(cause).includes(...)`）は triage で wont-fix 済み。
- memory の `compareStrings` と cloudflare の `ORDER BY id`（SQLite BINARY）は同じ全順序で、`listByNote` の順序契約は両バックエンドで一致する。
- DO schema の 2 表・索引は `spec/database/index.md:619-633` / `666-683` と列名・制約・索引名まで一致（`tag_id` の FK を除く。W-005）。
- コード・`spec/` に `.thread/` への参照は無い（`grep -rn "\.thread/" packages/core/src spec apps/web/app` が 0 件）。
- 前ラウンド [W-007] の 2 件はどちらも解消: `participants.ts` の `localProjection.handoff` は実在のスライス名 `"curation"` に戻り、`spec/usecases/tag.md` の手順 1／2 の間の空行も消えている。
