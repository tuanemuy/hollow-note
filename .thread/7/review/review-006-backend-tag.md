# レビュー 006 — backend-tag（完全削除の波及と横断の配線）

### backend-tag

#### Blockers

なし。

このラウンドの 4 つの主題は、いずれも突き合わせて成立を確認した。

**1. 決着分岐の集約（`settleNotePurgeTurn`）— 3 者の振る舞い。** `application/cleanup/notePurgeFanOut.ts:149` の 1 関数に寄せられ、3 追随者はいずれも `full` フラグを渡すだけになった。振る舞いの同値性を条件式で確かめた。

- `tag/deleteAssignmentsForNote.ts:64` `deletedCount >= 200`、`integration/deleteBackupRecordsForNote.ts:65` `deletedCount >= 100` — 前ラウンドの `if (deletedCount < BATCH) complete` と同値。振る舞いは変わっていない。
- `storage/deleteFilesForNote.ts:84` だけは `files.length >= 100` に**変わっている**。これは意図的な修正であり、正しい向きである: 前の `deletedCount` 基準だと「列挙は満ページだが `deleteStoredFiles` が 1 件取り零した（既に消えていた）」turn が短ページと判定され、`complete` で残りの行が恒久的に取り残される。列挙のページが turn を決める形に直したことで、その窓が閉じた。同一 UoW 内で `listDeletableByNote` → `findById` → `delete` と進む以上（`storage/deleteFiles.ts:26-46`）、満ページは必ず 1 件以上の削除を伴うので spin にもならない。

冪等性も保たれている。3 者とも行を消してから判定するので、再配送は 0 件で終わる。`complete` は「そのノートの行が尽きた瞬間」にしか呼ばれず、`ports/scopeTaskScheduler.ts:108` の遷移表が「`complete` は absent を含む任意の状態で行を消す」と定めているので、継続行が存在しない初回配送での `complete` も no-op で安全。二面 UoW の分離と `run` の非入れ子も保たれている — `settleNotePurgeTurn` / `assertNotePurgeAdmission` はどちらも `ctx` を受け取る形で、自分では `run` を開かない。

**2. `scopeOfNoteOwner` の集約。** `application/scope.ts:65` に移り、`ScopeKey` の隣に置かれた。前ラウンドで数えた 7 箇所の複製はすべて解消し（`createBlankNote` / `listNotes` / `listTrashedNotes` / `emptyTrash` / `editing` / `moveNote` / `subscribers`）、`grep 'owner.type === "user"'` で残るのは `NoteOwner → StorageOwner`（`storeMedia.ts:272`）や `NoteOwner → 表示`（`view.ts:248`）といった別の写像だけになった。

**3. scope 鍵の pin 突き合わせ — memory / cloudflare の契約。** 両者が同じ**エラー種**（`SystemError(DataIntegrityError)`）で拒む点は揃った（`memory/repositories/tagAssignmentRepository.ts:49` / `cloudflare/do/repositories/tagAssignmentRepository.ts:114,123`）。検査点は memory が save のみ、cloudflare が save + restore で、これは非対称だが**契約の差ではない** — memory は scope object ごとに別テーブルなので restore 側に他 scope の行が現れる経路が構造上存在せず、その理由がアダプターの JSDoc に書かれている。`backup_records.user_id` を検査しない側の理由も両バックエンドの JSDoc・`do/schema.ts:52-57` の列挙・`spec/database/index.md:22` の 3 箇所で一致している。前ラウンド [W-001] が指した「どちらの立場も表明しない」状態は解消。

**4. 兄弟隔離の実型テスト。** `workers/__tests__/subscribers.test.ts` の `identity.accountDeletionDispatchContinued siblings` が、合成レジストリではなく**既定のレジストリ**に対して `scopeUnitOfWorkProvider` だけを落とし、先に登録された `accountDeletionCleanup` が投げたあとでも `accountDeletionGlobalCleanup` が走って `uniquenessRelease` receipt が入ること、それでも delivery は失敗することを固定している。`dispatchDomainEvent`（`workers/subscribers.ts:282-303`）の JSDoc が要求する独立性が、実際に兄弟が 2 つ動く唯一の型で検証されるようになった。前ラウンド [W-006] は解消。

そのほか、前ラウンドの [W-003]（keyset 述語の食い違い → `spec/database/index.md:476` が行値比較に統一）、[W-004]（settle の重複と spec の `complete` 欠落 → 集約 + `spec/usecases/{tag,integration}.md` に追記）、[W-005]（`scopeOfNoteOwner`）、[W-007]（負値 `limit` → 両 conformance に `-1` のケース追加）はいずれも解消を確認した。

`.thread/` への参照はコード・`spec/`・`docs/` のいずれにも無い（`grep -rn '\.thread/' packages spec docs apps` が 0 件）。

#### Warnings

**[W-001] spec/platform/index.md:159 / application/note/deleteNotesForOwner.ts:22-30 — global 予算の見積もりが同節の 500 query 上限と依然として矛盾し、その文言が JSDoc にも複写された**

前ラウンド [W-002] と同じ指摘だが、triage では `wont-fix` / `defer` に置かれておらず（`triage-keys.md` に行が無く、ラウンド 005 は「24 件すべて fix / fix-editorial」と記録している）、本文は 1 文字も変わっていないため再掲する。

`spec/platform/index.md:134` は「1 Worker invocation が発行してよい D1 query は **500** を設計上限とする」と定める。同 159 行は「1 turn の global query 数は概ね『ノート数 × 4〜6』」と見積もったうえで、「上表の 100 rows は既定でこの 500 query 上限に**張り付く**値」と書く。100 × 6 = 600 で、帯の上端では上限を 20% 超える。「張り付く」は超過を言い表していない。

実装を数えると帯の上端は空想ではない。1 件の purge が global 側に触るのは `noteRouteStore.resolve`（`purgeNote.ts:408`）、`beginPurge`（同 476 または recovery 経路の 515）、`publicNoteProjectionWriter.removeForPurge`（同 324）、`noteRouteStore.finishPurge`（同 330）の 4 本が最低線で、abort 経路（同 672）や resume の再 claim が挟まれば増える。しかも「query 数」はポート呼び出し数ではなく D1 query 数なので、1 ポート呼び出しが 1 文とは限らない。

今回さらに、同じ文言が `deleteNotesForOwner.ts:27-29` の JSDoc（"At the default the turn therefore sits at the section's 500-query ceiling rather than under it"）へ複写された。矛盾が 1 箇所から 2 箇所に増えている。取るべきはどちらかで、

- 1 件あたりを 5 以下に抑えられる根拠（6 本目が出る経路と、それが 1 turn で何件まで起こりうるか）を書いて幅を狭める、または
- `OWNER_PURGE_BATCH_SIZE`（`deleteNotesForOwner.ts:32`）の既定を上限に収まる値へ下げる

「余裕を取る側の調整は `batchSize` を下げること」という現在の書き方は、既定が予算内であることを前提にした文であって、直前の見積もりと整合しない。reference runtime は Node + memory で D1 予算が掛からないため運用上の即時影響は無いが、Cloudflare 配備の設計上限を宣言している節での自己矛盾である。

**[W-002] 「1 つの決定を複数箇所に書く」型の更新が、今回いずれも 1 箇所ずつ届いていない**

`application/ports/objectStorage.ts:39-42` が「3 箇所に書かれた 1 つの決定はまとめて変えなければならない」と自ら宣言しているとおり、この設計は同じ決定を複数の正典に写す構造を持つ。今回そのパターンが 3 つ動いたが、いずれも 1 箇所が置き去りになっている。共通原因は同じなので 1 件にまとめる。

- **継続要求表（`spec/domains/index.md:274-296`）に、本 PR が足した 2 つの scope-task kind が無い。** `note.trashExpiryContinued`（`application/note/purgeExpiredTrash.ts:15`）と `storage.orphanMediaContinued`（`application/storage/collectOrphanMedia.ts:36`）は、どちらも `workers/scopeTaskRunner.ts` の `scopeTaskHandlers` に登録された実在の継続要求であり、後者は `readOrphanMediaSweepTurn` が読む keyset 位置を payload に載せる（まさに表の payload 列が持つべき情報）。この表は「1 回で処理しきれなかった仕事の続き」の全量として書かれており、`note.ownerPurgeContinued` 行（276）は本 PR で `stuckPurges` を足すために**現に編集されている**。同じ編集で 2 行足りていない。
- **`spec/usecases/storage.md:485-486` だけ、追随者の決着が `ScopeTaskScheduler.complete` を名指ししていない。** `spec/usecases/tag.md:368` と `spec/usecases/integration.md:394` は前ラウンドの指摘を受けて「limit 未満なら同じ UoW で継続 task 行を `ScopeTaskScheduler.complete` する — これが継続の連鎖を止める唯一の手段」を得たが、storage の手順 3/4 は「両集合が 100 件未満になったときだけ**完了する**」のままで、`complete` の呼び出しなのか単に処理が終わることなのかが読み分けられない。3 者が `settleNotePurgeTurn` という 1 つの関数を共有し、その JSDoc（`notePurgeFanOut.ts:134-135`）が `spec/usecases/{tag,integration,storage}.md` を根拠に挙げている以上、3 つのうち 1 つに根拠が無い状態になっている。あわせて storage の手順 3 の「100件なら」が**列挙したページ**なのか**削除できた件数**なのかも書かれていない — 実装は前者を選んでおり（`deleteFilesForNote.ts:80-84` のコメントが「2 つは食い違いうる」と明記している）、しかもこの選択は前ラウンドから変わった点なので、正典側に無いのは落ちである。
- **`spec/inventory/adapter.md:273`（ADP-tag-010）/ `:303`（ADP-integration-008）の `insert` 行だけ、今回付いた契約が反映されていない。** 同じ表の兄弟行（ADP-tag-012 / 019、ADP-integration-014 / 030）は本 PR で昇順・有界削除の契約を書き足されたのに、`insert` は「不変な TagAssignment を保存する」「新規 BackupRecord を保存する」のまま。今回 `insert` が獲得した契約は小さくない — 2 つの一意制約を別のエラー種へ写す規則（`spec/domains/tag.md:179` / `spec/domains/integration.md:210` に新設され、conformance の `tagAssignmentRepository.ts:60` / `backupRecordRepository.ts:83` が実際に突いている）と、tag 側の scope 鍵検査（`memory/__tests__/scopeGuards.test.ts:21` が `ADP-tag-010` を名乗って検証している）である。台帳行が名乗られている ID の実体を説明していない。

**[W-003] adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:114,123 — 弱いほうの guard にだけテストが付き、`spec/database/index.md:22` が要求する形を実装しているほうは無検証**

本 PR は `memory/__tests__/scopeGuards.test.ts` を新設し、その JSDoc で「これは port contract ではなくバックエンド固有の guard なので conformance ではなくここで見る」「pin だけが物理分離を担保するので、書き込みが通ってしまうと下流の誰も気付かない」と、テストが要る理由を正しく書いている。だが実際に置かれたのは memory の insert 側 1 本だけで、

- cloudflare の `ensureScopeOf`（insert 側、`:114`）
- cloudflare の `restore`（読み出し側、`:123`）— `spec/database/index.md:22` が「adapter が**復元・保存の両方で**検査する」と書いている、その「復元」の実体

はどちらも 1 行も実行されていない。memory は「rows of one scope are a table of their own」ゆえ restore 側の検査自体を持たないので、この節の要求を満たす実装は cloudflare 側にしかなく、その唯一の実装が無検証という配置になっている。

既存の `cloudflare/do/repositories/noteRepository.ts:259` の `ensureOwnerInScope` も同様に無検証なので、これは本 PR が作った穴ではなく既存の空白である。ただし今回「この guard を見る場所」を新設したのだから、`cloudflare/__tests__/` 側に対になるファイルを置いて、少なくとも insert と restore を 1 本ずつ突いておきたい。テーブルを直接叩いて他 scope の行を仕込み、`listByNote` が `DataIntegrityError` を投げることを見るだけで足りる（cloudflare 側には `SqlSession` を直に触る既存のテスト、たとえば `deleteFilesByOwner.test.ts` の形がある）。

#### テスト保証

担保できているもの:

- **conformance の両側実行と、足し忘れの検知** — `describeTagAssignmentRepositoryContract` / `describeBackupRecordRepositoryContract` が memory（`memory/__tests__/conformance.test.ts:78-79`）と cloudflare（`cloudflare/__tests__/conformance/scopeBusiness.test.ts:30-37`）の双方に登録され、`adapters/__tests__/conformanceCoverage.test.ts:154` の `PERSISTENCE_SUITES` が 43 → 45 に更新されている。同ファイルは (a) 両バックエンドの呼び出し集合の一致、(b) 絶対件数、(c) 取り違えた factory、(d) `.skip` / `.only` による自己除外、(e) `ConformanceBackend` の optional member をすべて塞いでいるので、「片側だけ通す」「静かに 1 スイート落とす」がどれも赤くなる。実測でも memory 側 416 ケース green。
- **`limit <= 0` の全節** — 前ラウンドの指摘どおり `0` と `-1` の両方が両スイートで突かれるようになった（`conformance/tagAssignmentRepository.ts:97-101`、`backupRecordRepository.ts:108-112`）。「driver に素通しした実装は負のページを全件か driver fault で答える」という理由もコメントに残っている。
- **順序契約が偶然通らない形** — 両スイートとも挿入順を意図的に崩したうえで昇順を要求し（`listByNote`）、部分削除後の残余を id で主張する（`deleteByNote`）。memory の `sort(compareStrings).slice(0, max(0,limit))` と cloudflare の `ORDER BY id LIMIT ?` が同じページを切ることが両側で確認される。
- **購読者登録そのもの** — `subscribers.test.ts:214-225` が `note.purged` の consumerName 3 本を集合として固定。`dispatchDomainEvent` は未購読イベントを warn だけで ack するので、この 1 本が無いと追随者を書いて配線し忘れても全テストが緑のまま通る。
- **owner → scope の workspace 枝** — usecase テストは `scope` を手で渡すため、`scopeOfNoteOwner` の workspace 枝は購読者経由でしか通らない。`subscribers.test.ts:263-281`（TC-integration-022）が personal / workspace の両 scope に residue を播き、workspace 側だけが空になり personal 側が 1/1/1 のまま残ることを主張しているので、「消えた」ではなく「**どちらの scope が**掃かれたか」の検証になっている。
- **admission の fail-closed** — 受理側（running / completed）と拒否側（receipt 不在、別 operation、abort 済み、workspace scope に personal token）が TC-tag-028 / TC-integration-022,024 で押さえられている。`describePersonalCleanup` が `row.operationId !== operationId` で `null` を返す（`memory/repositories/scopeCleanupAdmissionStore.ts:120`）ため、他人の token は必ず落ちる。
- **継続の駆動経路** — TC-tag-027 / TC-integration-023 の第 2 本が `runDueScopeTasks` を実際に回して `processed: 1` と行の消滅を確認する。`scopeTaskHandlers` への登録漏れは warn ログで済んでしまうので、この形でないと検知できない。priority も deletion 由来 = `securityCleanup` / 通常 purge = `expiryCollection` の両方が主張されている。
- **corrupt payload** — `readNotePurgeTurn` の `{}` / `""` / `"   "` / 数値 / 不正 token が `SystemError(DataIntegrityError)` になることを直接検証（`subscribers.test.ts:289-315`）。「空白は `NoteId.create` が trim してから判定するので `""` だけ弾く guard では素通りする」という具体的な穴を突いている。
- **兄弟隔離の実型** — [W-003] の項で述べたとおり、既定レジストリ上で `identity.accountDeletionDispatchContinued` の 2 兄弟について検証されるようになった。合成レジストリ側（`subscribers.test.ts:131-183`）も「boom → later → boom-2 が全部走り、最初の失敗だけが再送出され、error ログは 2 本」まで固定している。
- **退会サガへの `note` 昇格の反映** — `deleteAccount.cleanup.test.ts:177` が ack 集合を `["note","storage","usage"]` と集合で主張し、`deleteAccount.terminalPrune.test.ts:284` は `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` を使うので participant が増えても壊れない。`PERSONAL_CLEANUP_COMMANDS` は `Record<ActivePersonalCleanupComponent, …>` なので、participant を足して command を配線し忘れると型エラーになる。
- **DI の完全性** — `cloudflare/__tests__/runtimeComposition.test.ts` は `assertNoUnlistedPort<Exclude<keyof RequestContainer, …>>()` で型側からも網を掛けるので、`publicNoteProjectionWriter` / `htmlProcessor` の追加や `noteRouteResolver` → `noteRouteStore` の差し替えが片側だけ、という状態にはならない。

担保できていないもの:

- **2 つの駆動系が同じ継続行を同時に触る窓**（前ラウンドから未解消）。`(kind, operationId)` の行を、リレーの再配送（lease を取らない）と scope-task runner（lease を取る）が独立に駆動できるのは、既存の participant には無い構造である。`ports/scopeTaskScheduler.ts:136-140` の「lease は advisory で、超過した writer が後続の再武装した行を settle しうる」がそのまま当たる。解析上は `complete` が「そのノートの行が尽きた瞬間」にしか呼ばれず、余分に再武装された行も次の turn が 0 件で完了させるので取り零しは起きない — が、この不変条件をテストが固定していない。`docs/test.md`「Injecting into a concurrency window」の形で、`deleteByNote` の直後に別の turn を割り込ませる 1 本が欲しい。
- **cloudflare の scope 鍵 guard**（[W-003]）。
- **リレー経由の end-to-end**。テストは `dispatchDomainEvent` を直接呼ぶので、`outbox_events` に落ちた `note.purged` が `note/eventDecoders.ts` の `strict()` デコーダを通って 3 追随者に届くところまでは通っていない。今回 payload は変わっていないため実害は無いが、fan-out 全体の疎通は未検証のまま。
- **`listByNote` の本番呼び出し元が無い**。`TagAssignmentRepository.listByNote` / `BackupRecordRepository.listByNote` を叩くのは conformance と usecase テストだけ。`deleteByNote` の残余を観測する経路として spec が正当化しているので設計上は妥当だが、昇順契約を守り続ける動機がテストにしか無いことは記録しておく。

#### カバレッジ

確認したファイル（差分を読んだもの）:

- `packages/core/src/domain/tag/{errorCode.ts,valueObject.ts,tagAssignment.ts,ports/tagAssignmentRepository.ts}`
- `packages/core/src/domain/integration/{errorCode.ts,valueObject.ts,backupRecord.ts,ports/backupRecordRepository.ts}`
- `packages/core/src/application/tag/{deleteAssignmentsForNote.ts,__tests__/deleteAssignmentsForNote.test.ts}`
- `packages/core/src/application/integration/{deleteBackupRecordsForNote.ts,__tests__/deleteBackupRecordsForNote.test.ts}`
- `packages/core/src/application/cleanup/{notePurgeFanOut.ts,participants.ts}`
- `packages/core/src/application/workers/{subscribers.ts,scopeTaskRunner.ts,__tests__/subscribers.test.ts}`
- `packages/core/src/application/identity/deleteAccount/{authorRedaction.ts,cleanupDispatch.ts}`、`packages/core/src/application/identity/__tests__/{deleteAccount.cleanup.test.ts,deleteAccount.terminalPrune.test.ts}`
- `packages/core/src/application/di/{types.ts,memoryRuntime.ts,cloudflareRuntime.ts}`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/ports/{noteMovePort.ts,noteRouteStore.ts,objectStorage.ts}`、`packages/core/src/application/scope.ts`
- `packages/core/src/adapters/memory/{store.ts,scopeUnitOfWork.ts,repositories/tagAssignmentRepository.ts,repositories/backupRecordRepository.ts,__tests__/conformance.test.ts,__tests__/conformanceBackend.ts,__tests__/scopeGuards.test.ts}`
- `packages/core/src/adapters/cloudflare/do/{schema.ts,repositories/tagAssignmentRepository.ts,repositories/backupRecordRepository.ts}`
- `packages/core/src/adapters/cloudflare/__tests__/{conformanceBackend.ts,ports/scopeBusiness.ts,conformance/scopeBusiness.test.ts,deleteFilesByOwner.test.ts,runtimeComposition.test.ts}`
- `packages/core/src/adapters/conformance/{backend.ts,tagAssignmentRepository.ts,backupRecordRepository.ts}`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/package.json`、`pnpm-lock.yaml`
- `spec/usecases/{tag,integration}.md`、`spec/domains/{tag,integration,index}.md`、`spec/platform/index.md`、`spec/database/index.md`、`spec/inventory/{adapter,test,usecase}.md`、`spec/testcases/{tag/deleteAssignmentsForNote.md,integration/deleteBackupRecordsForNote.md}`

判断のために差分外で読んだファイル: `application/note/{purgeNote.ts,deleteNotesForOwner.ts,purgeExpiredTrash.ts,editing.ts}`、`application/storage/{deleteFiles.ts,deleteFilesForNote.ts,collectOrphanMedia.ts}`、`application/ports/{scopeTaskScheduler.ts,scopeCleanupAdmissionStore.ts}`、`adapters/memory/repositories/{scopeCleanupAdmissionStore.ts,noteRepository.ts}`、`adapters/cloudflare/do/repositories/noteRepository.ts`、`spec/inventory/domain.md`、`docs/test.md`、ルート `package.json`

実行した検証: `pnpm vitest run --project node` を `application/{tag,integration}` / `workers/__tests__/subscribers.test.ts` / `memory/__tests__/{scopeGuards,conformance}.test.ts` / `adapters/__tests__/conformanceCoverage.test.ts` に対して実行（45 + 416 ケース green）。`workers` プロジェクト（cloudflare）は未実行。

スキップしたファイル（担当外。他レビュアーの持ち分）:

- `apps/web/` 配下の全 39 ファイル（frontend）
- `packages/core/src/adapters/html/{allowList.ts,css.ts,htmlProcessor.ts,__tests__/htmlProcessor.test.ts}`（backend-note）
- `packages/core/src/application/note/` の新規・変更 24 ファイル（`purgeNote.ts` / `deleteNotesForOwner.ts` / `purgeExpiredTrash.ts` / `editing.ts` は判断のため参照のみ）、`packages/core/src/application/storage/` の 10 ファイル（`deleteFilesForNote.ts` / `deleteFiles.ts` / `collectOrphanMedia.ts` は参照のみ）、`packages/core/src/application/usage/{ensureUploadAllowed.ts,__tests__/ensureUploadAllowed.test.ts}`
- `packages/core/src/domain/note/` の 5 ファイル、`packages/core/src/domain/storage/` の 4 ファイル、`packages/core/src/domain/{tag,integration}/__tests__/valueObject.test.ts`（値オブジェクトのテスト。契約面は本文で確認済み）
- `packages/core/src/adapters/{memory,cloudflare/do}/repositories/{noteRepository,storedFileRepository}.ts`、`adapters/conformance/{noteRepository,storedFileRepository,noteRouteStore}.ts`
- `spec/adr/013-html-sanitization-policy.md`、`spec/domains/{note,storage}.md`、`spec/usecases/{note,storage}.md`（`#deletefilesfornote` の節のみ参照）、`spec/pages/index.md`、`spec/presentation/index.md`、`spec/manual-tests/editing.md`、`spec/testcases/note/*`（15 本）、`spec/testcases/storage/*`（3 本）
