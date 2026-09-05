# レビュー 005 — backend-tag（完全削除の波及と横断の配線）

### backend-tag

#### Blockers

なし。

`note.purged` fan-out の骨格（`notePurgeFanOut.ts` の turn 型 / admission / 継続の再武装、3 追随者、購読者登録、scope-task ハンドラ、両バックエンドのリポジトリと conformance）は、契約・spec・テストの 3 点が一致している。特に次の 4 点は突き合わせて確認した。

- `deleteByNote` の削除ページ順序：ポート JSDoc（`domain/tag/ports/tagAssignmentRepository.ts:496-511` / `domain/integration/ports/backupRecordRepository.ts:259-276`）、spec（`spec/domains/tag.md:173` / `spec/domains/integration.md:210`、`spec/inventory/adapter.md` の ADP-tag-012/019・ADP-integration-014/030）、conformance（`conformance/tagAssignmentRepository.ts:271-294` / `backupRecordRepository.ts:148-172`、挿入順を意図的に崩して昇順を要求）が一致。memory は `sort(compareStrings).slice(0, limit)`、cloudflare は `ORDER BY id LIMIT ?` で同じページを切る。
- `assertOwner` ではなく `describePersonalCleanup` を使う判断：ポート JSDoc（`ports/scopeCleanupAdmissionStore.ts:37-40` の「completion で false になる」）、`notePurgeFanOut.ts:98-113`、`spec/usecases/tag.md`／`integration.md` の追記、TC-tag-028 / TC-integration-024 の「completed でも通す」ケースが一致。障壁を閉じるのが `note` 成分自身であり、その ack が待った purge の `note.purged` はリレーが後から配送する以上、`assertOwner` は必ず全滅する — この論証は正しい。fail-closed 側（別 operation・不在・abort 済み・workspace scope）も TC-tag-028 / TC-integration-022 で押さえられている。
- `note.ownerPurgeContinued` の payload に `stuckPurges` が入ったこと：`spec/domains/index.md:276` の継続要求表と `readOwnerPurgeTurn` / `continuationPayload` が一致。`participants.ts` の `note` 昇格（`REQUIRED_PERSONAL_CLEANUP_COMPONENTS` が `["storage","usage","note"]` になる）は `cleanupDispatch.ts` の網羅レコードと退会サガのテスト 2 本（`deleteAccount.cleanup.test.ts:177` / `deleteAccount.terminalPrune.test.ts:284`）に反映済み。`tag` / `backup` を participant に昇格させず「scope 全体を掃く経路が無い」と書き分けたのも妥当で、`deleteByNote` は 1 ノート単位でしか働かないため障壁が待てる ack ではない。
- 二面 UoW と `run` の入れ子：3 追随者はいずれも scope 面の `run` を 1 つだけ開き、その中で admission → `deleteByNote` → `complete` / `schedule` を閉じている。global 面には触れない。`deleteNotesForOwner` は purge が自前の transaction を持つため `run` の外で回し、stuck 行の武装も個別 transaction にしている。入れ子は無い。
- 冪等性：行が消えたら戻らないので `IdempotencyStore` 無しで再配送が 0 件で終わる、という論証は `complete` が絶対行に対して no-op であること（`ports/scopeTaskScheduler.ts` の遷移表）と合わせて成立する。`complete` が呼ばれるのは「読んだ件数 < limit」＝そのノートの行が尽きた瞬間だけなので、リレー再配送と scope-task runner が同じ `(kind, operationId)` を同時に駆動しても、`complete` が未処理の仕事を落とすことはない。

#### Warnings

**[W-001] adapters/{memory,cloudflare/do}/repositories/tagAssignmentRepository.ts — `tag_assignments.scope_type`/`scope_id` は scope key なのに `_scope_identity` の pin と突き合わせていない**

`spec/domains/tag.md` は「assignment の scope は付けたノートの scope」と定め、`domain/tag/valueObject.ts:619-631` の `TagScope` も「`NoteOwner` と同形」と書いている。つまり `scope_type`/`scope_id` は attribution ではなく **scope key** である。ところが

- `packages/core/src/adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:79-89` の `CloudflareTagAssignmentRepositoryDeps` は `{ session }` だけで `ScopeKey` を受け取らず、`insert` / `listByNote` のどこでもオブジェクトの pin と比較しない
- `packages/core/src/adapters/memory/repositories/tagAssignmentRepository.ts:10-33` も同様

これは同じファイル群の `notes` の扱いと非対称である。`adapters/cloudflare/do/repositories/noteRepository.ts:225-228, 259-275` は `deps.scope` を取り、`ensureOwnerInScope` を save と restore の両方に掛けて、scope の違う行を `dataIntegrityError` で拒む。`storedFileRepository.ts:252` はその逆で「owner 列は scope key ではないので検査しない」と明示する。`tagAssignmentRepository` はどちらの立場も表明せず、検査もしない。

加えて `adapters/cloudflare/do/schema.ts:52-57` の `_scope_identity` のコメントは「scope key として働く列 — `notes.owner_type`/`owner_id` とこの行 — は restore と save の両方で検査する。`stored_files` / `storage_quotas` / `llm_usages` の attribution 列は scope key ではなく検査しない」と**列挙**しているが、今回追加した `tag_assignments.scope_type`/`scope_id`（scope key）も `backup_records.user_id`（attribution）もどちらの列にも載っていない。物理分離が pin だけに乗っている設計なので、この列挙が古びると次に表を足す人が判断の根拠を失う。

今スライスに書き込み経路が無い（`insert` を叩くのは conformance とテストだけ）ので実害は潜在だが、curation スライスが `assignTag` を足した瞬間に「間違った scope object に黙って書ける」状態になる。`ScopeKey` を deps に足して `insert` / `fromRow` で検査するか、少なくとも「なぜ検査しないか」をポート／アダプターの JSDoc とスキーマのコメントに書き足すべき。`backup_records.user_id` 側は `backupRecordRepository.ts:95-102` に理由が書いてあるので、スキーマのコメントの列挙にも同じ 2 行を反映すれば揃う。

**[W-002] spec/platform/index.md:159 — 追記した global 予算の見積もりが、同じ節の 500 query 上限を既定値で超えうる**

追記は「1 turn の global query 数は概ね『ノート数 × 4〜6』」「上表の 100 rows は既定でこの 500 query 上限に張り付く値」と書く。だが 100 × 6 = 600 で、同節冒頭（`spec/platform/index.md:133`）の「1 Worker invocation が発行してよい D1 query は **500** を設計上限とする」を帯の上端で 20% 超える。「張り付く」は超過を言い表していない。

`deleteNotesForOwner` は 1 件あたり `resolve` / `beginPurge` / `finishPurge` / `removeForPurge` の 4 本が最低線で、forward recovery や `abortPurge` が挟まると増える経路なので、幅 4〜6 自体は妥当だと思われる。であれば既定値が上限に収まる保証は無い。取るべきはどちらかで、

- 1 件あたりを 5 以下に固定できる根拠（どの経路で 6 本目が出るか、それが turn 内で何件まで起こりうるか）を書いて幅を狭める、または
- `OWNER_PURGE_BATCH_SIZE`（`application/note/deleteNotesForOwner.ts:32`）の既定を上限に収まる値（例: 80）へ下げる

「余裕を取る側の調整は `batchSize` を下げること」という現在の書き方は、既定が予算内であることを前提にした文であって、上の見積もりと整合しない。なお reference runtime は Node + memory で D1 予算が掛からないため運用上の即時影響は無い。

**[W-003] spec/database/index.md:476 — 索引の根拠に書いた keyset 述語が、実装とスキーマのコメントの述語と食い違う**

追記は「keyset は `(created_at, id)` で並べて `created_at = ? AND id > ?` から再開する」と書くが、実装は行値比較で再開する（`adapters/cloudflare/do/repositories/storedFileRepository.ts:479` の `AND (created_at, id) > (?, ?)`）。同じ PR の `adapters/cloudflare/do/schema.ts:467-471` のコメントは正しく「resumes on the row value `(created_at, id) > (?, ?)`」と書いている。

`created_at = ? AND id > ?` は同一時刻の中でしか進まない述語なので、そのまま読むと走査が時刻境界を越えられない設計に見える。索引に `id` を含める根拠としては「同着を索引で解く」で足りているのだから、述語は行値比較の形に直すか、`(created_at, id)` の辞書式の先送りである旨に書き換えるのが正しい。1 つの決定が 2 つの文書で別の式になっている状態は避けたい。

**[W-004] application/{tag/deleteAssignmentsForNote.ts:59-72, integration/deleteBackupRecordsForNote.ts:60-73, storage/deleteFilesForNote.ts:76-89} — 継続を止める唯一の分岐が 3 箇所のコピーで、spec のどこにも書かれていない**

3 追随者の末尾はいずれも

```
if (deletedCount < BATCH) { await ctx.scopeTaskScheduler.complete(KIND, input.operationId); return { deletedCount }; }
await armNotePurgeContinuation(ctx, { kind: KIND, operationId: input.operationId, turn: input, now });
```

という同一形である。共通因子である `NotePurgeFanOutTurn` / `assertNotePurgeAdmission` / `armNotePurgeContinuation` は既に `application/cleanup/notePurgeFanOut.ts` に括り出されているのに、**turn を settle する側だけが括り出されていない**。集約先はそのファイルで、`settleNotePurgeTurn(ctx, { kind, operationId, turn, now, full })` の 1 関数で足りる。

より重いのはドキュメント側で、`spec/usecases/tag.md#deleteassignmentsfornote` の手順 1-2 と `spec/usecases/integration.md#deletebackuprecordsfornote` の手順 1-3 は「200/100 件なら再登録する」までしか書かず、**`complete` に一切触れていない**。この `complete` は継続の連鎖を止める唯一の手段（呼ばなければ runner が同じ行を claim し続ける）なので、正典に無いのは落ちである。今回 spec の手順 1 を書き換えたタイミングなので、同じ手順に「limit 未満なら同じ UoW で継続 task 行を complete する」を足すべき。

**[W-005] application/cleanup/notePurgeFanOut.ts:43 `scopeOfNoteOwner` — `NoteOwner → ScopeKey` の写像が私的な複製で増え続けている**

このスライスで初めて公開のヘルパーが出来たが、同じ 3 行の三項演算子が少なくとも次に散っている（うち 3 つは本 PR で追加）。

- `application/note/createBlankNote.ts:208`（既存）
- `application/note/moveNote.ts:1060`（既存）
- `application/note/listNotes.ts:54`（既存）
- `application/note/listTrashedNotes.ts:56`（本 PR）
- `application/note/emptyTrash.ts:113`（本 PR）
- `application/note/editing.ts:59`（本 PR）
- `application/cleanup/notePurgeFanOut.ts:43`（本 PR・唯一 export されている）

写像そのものは自明だが、「ノートの owner はその scope object を名指す」は `spec/platform` の scope 分割そのものであって、7 箇所に散らして良い決定ではない。集約先は `application/scope.ts`（`ScopeKey` の持ち主）か、少なくとも今回作った `scopeOfNoteOwner` 1 本。fan-out のためだけに cleanup 配下へ置いたことで、note 側の 6 箇所が参照しづらい位置に来てしまっている点も含めて直したい。

**[W-006] application/workers/subscribers.ts:274-296 — 兄弟を止めない dispatcher への変更が、`note.purged` 以外の実型で検証されていない**

`dispatchDomainEvent` が「兄弟が投げても後続を回し、最初の例外を再送出する」へ変わったのは、3 追随者が互いに無関係な集約を掃除する以上正しい。JSDoc も「continuation subscriber が登録順に依存していた前提を落とす」ことまで書いて、`identity.accountDeletionDispatchContinued` の 4 兄弟が phase ガードと receipt で独立している旨を明記している。

ただし新規テスト（`__tests__/subscribers.test.ts:125-160`）は `identity.user.deleted` に合成レジストリを載せた検証で、**実際に兄弟が 2 つ以上いる唯一の型**である `identity.accountDeletionDispatchContinued`（`cleanup` phase に `accountDeletionCleanup` と `accountDeletionGlobalCleanup` が同居）については、片方が投げたときにもう片方が走って安全であることを何も押さえていない。JSDoc が「新しい phase subscriber はこの独立性を自分で担保せよ」と要求している以上、現行の 2 本についてもテストで固定しておきたい。

併せて観測性の点：`firstFailure` しか再送出しないので、追随者の `ConflictError` が後続の transient な `SystemError` を隠す。`eventRelayWorker` は種別で分岐せず attempts だけで隔離するため動作には影響しないが、失敗理由のログは `deps.logger.error` の行に残るだけになる。JSDoc に一言あると良い。

**[W-007] adapters/conformance/{tagAssignmentRepository.ts:277, backupRecordRepository.ts:156} — `limit <= 0` の契約が `0` しか突かれていない**

両ポートの JSDoc は「`limit <= 0` deletes nothing」と書くが、conformance は `deleteByNote(noteId(1), 0)` だけを検証し、負値を渡さない。両アダプターとも `Math.max(0, limit)` / `slice(0, Math.max(0, limit))` で正しく振る舞うが、[ADR 026](../../../spec/adr/026-port-contract-and-conformance.md) の立て付け（ポート JSDoc の実行可能な形が conformance）に従うなら、契約の一文が実行されていない状態は埋めるべき。`expect(await repository.deleteByNote(noteId(1), -1)).toBe(0)` の 1 行で足りる。

#### テスト保証

担保できているもの:

- **conformance の両側実行** — `describeTagAssignmentRepositoryContract` / `describeBackupRecordRepositoryContract` が memory（`memory/__tests__/conformance.test.ts:78-79`）と cloudflare（`cloudflare/__tests__/conformance/scopeBusiness.test.ts:30-37`）の双方に登録済み。`conformanceCoverage.test.ts:154` の `PERSISTENCE_SUITES` も 43 → 45 に更新されていて、スイートの足し忘れが検知される。2 つの一意制約を別のエラー種へ写す契約（`ASSIGNMENT_ALREADY_EXISTS` / `BACKUP_RECORD_ALREADY_EXISTS` vs `SystemError`）も両バックエンドで突かれている。
- **購読者登録そのものの検証** — `subscribers.test.ts:679-690` が `note.purged` の consumerName 3 本を集合として固定している。`dispatchDomainEvent` が未購読イベントを warn だけで ack する（plan.md のリスク欄が名指しした罠）ため、この 1 本が無いと追随者を書いて配線し忘れても全テストが緑のままになる。ここを押さえているのは効いている。
- **owner → scope の workspace 分岐** — usecase テストは `scope` を手で渡すので、`scopeOfNoteOwner` の workspace 枝は購読者経由でしか通らない。`subscribers.test.ts:728-746` が personal / workspace の両 scope に residue を播いて「どちらの scope が掃かれたか」を主張しているのは、単なる「消えた」ではなく到達先の検証になっている。
- **admission の fail-closed** — 別 operation（TC-tag-027 の abort 後・TC-integration-024）、receipt 不在（TC-tag-028）、workspace scope に personal token（TC-integration-022）の 3 通りで `CLEANUP_OPERATION_MISMATCH` と「行が残ること」を確認している。
- **継続の駆動経路** — TC-tag-027 / TC-integration-023 の第 2 本が `runDueScopeTasks` を実際に回して `processed: 1` と行の消滅を確認しており、「usecase は書いたが `scopeTaskHandlers` に登録し忘れた」を検知する。scope-task 未登録は warn ログで済んでしまうので、この形は正しい。
- **完了済み障壁の通過** — TC-tag-028 / TC-integration-024 の `completeBarrier` 版が、`REQUIRED_PERSONAL_CLEANUP_COMPONENTS` を使って ack を全部入れてから `markCompleted` し、その後でも回収できることを固定している。required 集合をハードコードしていないので、participant が増えても壊れない。
- **corrupt payload** — `readNotePurgeTurn` の空文字・空白・型不一致が `SystemError(DataIntegrityError)` になることを直接検証（`subscribers.test.ts:754-780`）。「空白は `NoteId.create` が trim してから判定するので `""` だけ弾く guard では素通りする」という具体的な穴を突いている。

担保できていないもの:

- **2 つの駆動系が同じ継続行を同時に触る窓** — `(kind, operationId)` の行を、リレーの再配送（lease を取らない）と scope-task runner（lease を取る）の両方が独立に駆動できるのは、既存の participant には無い新しい構造である。`ports/scopeTaskScheduler.ts` の「lease は advisory で、超過した writer が後続の再武装した行を settle しうる」という但し書きがそのまま当たる。解析上は `complete` が「そのノートの行が尽きた瞬間」にしか呼ばれないため取り零しは起きないが、その不変条件をテストが固定していない。`docs/test.md`「Injecting into a concurrency window」の形で 1 本欲しい。
- **リレー経由の end-to-end** — テストは `dispatchDomainEvent` を直接呼ぶので、`outbox_events` に落ちた `note.purged` の行が decoder（`application/note/eventDecoders.ts:258-294`、本 PR 対象外・既存）を通って 3 追随者に届くところまでは通っていない。decoder は既存で `strict()` なので payload に列が増えれば落ちる — 今回 payload は変わっていないため実害は無いが、fan-out 全体の疎通は未検証。
- **`listByNote` の本番呼び出し元が無い** — `TagAssignmentRepository.listByNote` / `BackupRecordRepository.listByNote` を叩くのは conformance だけ。`deleteByNote` の残余を観測する経路として spec が正当化しているので設計上は妥当だが、契約（昇順）を守り続ける動機がテストにしか無いことは記録しておく。
- **負値 limit**（[W-007]）。

#### カバレッジ

確認したファイル（差分を読んだもの）:

- `packages/core/src/domain/tag/{errorCode.ts,valueObject.ts,tagAssignment.ts,ports/tagAssignmentRepository.ts,__tests__/valueObject.test.ts}`
- `packages/core/src/domain/integration/{errorCode.ts,valueObject.ts,backupRecord.ts,ports/backupRecordRepository.ts,__tests__/valueObject.test.ts}`
- `packages/core/src/application/tag/{deleteAssignmentsForNote.ts,__tests__/deleteAssignmentsForNote.test.ts}`
- `packages/core/src/application/integration/{deleteBackupRecordsForNote.ts,__tests__/deleteBackupRecordsForNote.test.ts}`
- `packages/core/src/application/cleanup/{notePurgeFanOut.ts,participants.ts}`
- `packages/core/src/application/workers/{subscribers.ts,scopeTaskRunner.ts,__tests__/subscribers.test.ts}`
- `packages/core/src/application/identity/deleteAccount/{authorRedaction.ts,cleanupDispatch.ts}`、`packages/core/src/application/identity/__tests__/{deleteAccount.cleanup.test.ts,deleteAccount.terminalPrune.test.ts}`
- `packages/core/src/application/di/{types.ts,memoryRuntime.ts,cloudflareRuntime.ts}`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/ports/{noteMovePort.ts,noteRouteStore.ts,objectStorage.ts}`
- `packages/core/src/adapters/memory/{store.ts,scopeUnitOfWork.ts,repositories/tagAssignmentRepository.ts,repositories/backupRecordRepository.ts,__tests__/conformance.test.ts,__tests__/conformanceBackend.ts}`
- `packages/core/src/adapters/cloudflare/do/{schema.ts,repositories/tagAssignmentRepository.ts,repositories/backupRecordRepository.ts}`
- `packages/core/src/adapters/cloudflare/__tests__/{conformanceBackend.ts,ports/scopeBusiness.ts,conformance/scopeBusiness.test.ts,deleteFilesByOwner.test.ts,runtimeComposition.test.ts}`
- `packages/core/src/adapters/conformance/{backend.ts,tagAssignmentRepository.ts,backupRecordRepository.ts,noteRouteStore.ts}`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/package.json`、`pnpm-lock.yaml`
- `spec/usecases/{tag,integration}.md`、`spec/domains/{tag,integration,index}.md`、`spec/platform/index.md`、`spec/database/index.md`、`spec/inventory/{adapter,test,usecase}.md`、`spec/testcases/{tag/deleteAssignmentsForNote.md,integration/deleteBackupRecordsForNote.md}`

判断のために差分外で読んだファイル: `domain/note/events.ts`、`application/note/{eventDecoders.ts,deleteNotesForOwner.ts,purgeNote.ts}`、`application/storage/deleteFilesForNote.ts`、`application/ports/{scopeTaskScheduler.ts,scopeCleanupAdmissionStore.ts}`、`application/cleanup/personalCleanup.ts`、`application/workers/eventRelayWorker.ts`、`application/identity/deleteAccount/terminalPrune.ts`、`adapters/memory/{support.ts,repositories/scopeCleanupAdmissionStore.ts}`、`adapters/cloudflare/do/repositories/{noteRepository.ts,storedFileRepository.ts}`

スキップしたファイル（担当外。他レビュアーの持ち分）:

- `apps/web/` 配下の全 39 ファイル（frontend）
- `packages/core/src/adapters/html/{allowList.ts,css.ts,htmlProcessor.ts,__tests__/htmlProcessor.test.ts}`（backend-note）
- `packages/core/src/application/note/` の新規・変更 24 ファイル（`deleteNotesForOwner.ts` / `purgeNote.ts` は参照のみ）、`application/storage/` の 10 ファイル（`deleteFilesForNote.ts` は参照のみ）、`application/usage/{ensureUploadAllowed.ts,__tests__/ensureUploadAllowed.test.ts}`
- `packages/core/src/domain/note/` の 5 ファイル、`packages/core/src/domain/storage/` の 4 ファイル
- `packages/core/src/adapters/{memory,cloudflare/do}/repositories/{noteRepository,storedFileRepository}.ts`、`adapters/conformance/{noteRepository,storedFileRepository}.ts`
- `spec/adr/013-html-sanitization-policy.md`、`spec/domains/{note,storage}.md`、`spec/usecases/{note,storage}.md`、`spec/pages/index.md`、`spec/presentation/index.md`、`spec/manual-tests/editing.md`、`spec/testcases/note/*`（15 本）、`spec/testcases/storage/*`（3 本）

`.thread/` への参照はコード・`spec/`・`docs/` のいずれにも無いことを確認済み。
