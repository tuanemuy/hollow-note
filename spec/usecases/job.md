# ユースケース: Job

ドメインの詳細は [domains/job.md](../domains/job.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。実行の回復性と batch 親の完了経路は [ADR 012](../adr/012-job-execution-resilience.md)、匿名ジョブの扱いは [ADR 010](../adr/010-anonymous-export-and-ticket.md) に従う。

## 共通: 登録時の scope の決定

ジョブを登録するユースケース（[domains/job.md](../domains/job.md) の登録経路の表に挙がる全 11 kind）は、`Job.enqueue` / `Job.enqueueBatch` に渡す `scope` を**対象の所有文脈**から導く。要求者からは導かない。

- `target.type === "note"` → 対象ノートの `NoteOwner` を写す
- `target.type === "storedFile"` → 対象ファイルの `StorageOwner` を写す（元ファイルの帰属はノートの所有文脈と一致する）
- `target.type === "batch"`（親ジョブ）→ 子の所有文脈を写す。子ジョブの `scope` は親と同じ値になる

対象を ID の並びで受け取る登録（`requestBulkExport` / `requestBulkNoteOperation` / `requestBackup`）は source ScopeKey を必須入力にし、D1 route の一括解決後もその1つのscope DOだけを呼ぶ。別scope・移動中・削除中のIDは存在を漏らさず `notFound` として除外し、親子の `scope` はsourceに固定する。これによりbatch親のscopeを一意に保ち、最大500のIDを複数DOへfan-outしない（[domains/job.md](../domains/job.md) の「batch 親の `scope` は単一である」、[ADR 012](../adr/012-job-execution-resilience.md)）。

`scope` は登録時点の値のまま書き換えない。`bulkMove` は移動元の文脈を保つ。

Job IDを受け取る `getJobDetail` / `retryJob` / `retryFailedChildren` / `cancelJob` とQueue consumerは、先に `JobId.scopeOf` でscopeを復元してそのobjectだけを呼ぶ。global `job_history` は一覧表示用であり、route・認可・状態遷移の正として使わない。

## 共通: family removal claim

Jobを変化させる全経路は、同じscope-local UoW内で`JobRepository.assertFamilyMutable(jobId)`を状態遷移より先に呼ぶ。単体/rootは自身の`removalOperationId`、子は親rootの同列を検査する。対象にはrun workerのstart/progress/succeed/fail、`updateBatchProgress`、retry、cancel、強制終端、reaperが含まれる。claim中なら`ConflictError("JOB_REMOVAL_IN_PROGRESS")`とし、遅延workerの結果も保存しない。例外はclaim ownerが実行するmanifest buildと`deleteFamilyPage(root, removalOperationId, 100)`だけである。

claimはrootのexpected versionと終端状態を条件に、manifest header作成と同じUoWでCASする。以後abortして通常状態へ戻す経路は設けず、同じremoval operation IDでforward recoveryする。

## 共通: リース期間と回収の間隔

`leaseUntil: Date` を要求する振る舞い（`Job.enqueueBatch` / `start` / `beginAssembly` / `reportProgress` / `renewAssemblyLease` / `reopenBatch`、および `BatchProgressCalculator.applyTo`）に渡す値は、呼び出し側のユースケースが `clock.now() + リース期間` で作る。ドメインは期間を知らない（[domains/job.md](../domains/job.md)）。

| 対象 | リース期間 | 延長の契機 |
| --- | --- | --- |
| 実行体を持つジョブ（単体ジョブと batch の子。kind を問わず一律） | 15 分 | `Job.start`、処理中の `Job.reportProgress` |
| batch 親の進捗リース | 60 分 | `Job.enqueueBatch`、子の終了報告（`updateBatchProgress` → `reportProgress`）、`Job.reopenBatch` |
| batch 親の組み立てリース（`bulkExport` の親のみ） | **15 分** | `Job.beginAssembly`、組み立て中の `Job.renewAssemblyLease` |

- kind では分けない。15 分は**キューのコンシューマーの壁時計の上限そのもの**であり（[platform/index.md](../platform/index.md)）、実行体を持つジョブがこれを超えて生き続けることは原理的にない。最も重い実行（LLM 構造化を伴う変換・再生成）もこの中で終わる必要があり、長い処理は `Job.reportProgress` で次の配送へリースを引き継ぐ。PDF 書き出しの実行時間の上限もこの 15 分であり、`ExportTicket` の有効期間 30 分（[usecases/note.md](./note.md)）は「実行時間の上限に余裕を足した値」としてこれと整合する
- 親の進捗リース 60 分は「子 1 件の実行時間の上限より長く取る」（[domains/job.md](../domains/job.md)）を満たす最小の桁で、子の報告が途絶えてから親が回収されるまでの猶予でもある。こちらは実行体ではなく**一括操作全体の進み具合**を表すため、壁時計の上限とは無関係である
- **組み立てリースは 15 分**である。組み立て（`runBulkExport` の ZIP 生成）を実行するのはキューのコンシューマーであり、壁時計 15 分で必ず強制終了される。60 分にしても組み立てが長く生きられるわけではなく、死んだ組み立てワーカーの親が最大 60 分滞留するだけになる
- 進捗リースと組み立てリースは `jobs.lease_expires_at` の 1 列を共有し、`attempts` の 0 / 1 以上で主体を区別する（[domains/job.md](../domains/job.md)）。期間が違うのは、期限を張り直す主体が違うためである — 組み立て中の親（`attempts >= 1`）のリースは `reportProgress` では延びず、延ばせるのは実行権を持つワーカーの `renewAssemblyLease` だけである
- `reapExpiredJobs` は各 scope object の Alarm で起動する。active Job を保存するたびに最も早い `leaseExpiresAt`（遅くとも5分後）へ Alarm を設定し、回収後も active Job があれば次を設定する。全scopeを5分ごとに走査するglobal Cronは置かない
- `pruneJobHistory` も Job を持つscopeだけが日次taskを自己スケジュールする

## 共通: run 系ワーカーの冪等規則

キューからの配送で起動されるユースケース（`runConversion` / `runRegeneration` / `runNoteExport` / `runBulkExportItem` / `runBulkNoteOperationItem` / `runBackup` / `importExternalReferences`）は、先頭で対象ジョブを引いて次の順に判定する（ADR 012）。

1. ジョブが見つからなければ何もせず成功として返す。終端状態（`succeeded` / `failed` / `canceled`）なら同じく何もせず返す（再配送の重複）
2. `running` でリースが有効（`leaseExpiresAt > now`）なら何もせず返す（他のワーカーが実行中）
3. それ以外は、外部I/O kindならcurrent scopeの `ScopeJobAdmissionStore.tryAcquire({ jobId, leaseUntil, limit: 4 }, now)` を呼ぶ。4枠が埋まっていればJobをqueued/lease失効のまま変更せず `SystemError("SCOPE_ADMISSION_BUSY", retryAfter)` を投げ、Queue再試行へ戻す。取得と `Job.start(job, total, now, leaseUntil)` は同じscope-local UoWで保存して本処理へ進む
   - `queued` は通常の開始
   - リース失効の `running` は引き継ぎ再開（`attempts` を加算し、進捗を作り直す）
   - 引き継ぎで `attempts` が上限を超えた場合、`start` は `expire` の結果（`failed`、`reason: "timeout"`、手動 `retry` 可能）を返すので、それを保存して終了する。この保存の UoW で下記「共通: 強制終端の後始末」を `cause: { type: "expired" }` として併せて実行する — 本処理に入る前に終端しているため、`kind: "conversion"` の対象ノートは `processing` のまま取り残される
4. 本処理の結果（`Job.succeed` / `Job.fail` / `Job.reportProgress`）の保存が `ConflictError`（楽観ロック）になったら、ジョブを読み直す
   - 終端済みなら、実行中に外部から強制終端されたということである（`Job.fail` / `Job.cancel` はリースを検査しない。[domains/job.md](../domains/job.md) の「強制終端とリース」）。生成物を破棄して成功として返し、ジョブは書き換えない。保管済みの artifact は期限付き保管の自動回収に委ねる（強制終端の時点では存在せず、終端させた側から見えないもの。終端の時点で batch 親の子が保管し終えていた artifact は下記「共通: 強制終端の後始末」が回収する）
   - 終端していなければ（リース失効中に別のワーカーが引き継いだなど）`ConflictError` をそのまま投げて再配送に委ねる

配送は少なくとも 1 回のため、この判定により同じジョブを 2 回受け取っても結果は変わらない。長い処理は `Job.reportProgress` でリースを延長する。各ドメインの run 系ユースケースでは、この手順を「run 系の共通規則に従う」と記す。

外部I/O kindは `conversion` / `regeneration` / `pdfExport` / `bulkExport` / `driveBackup` / `bulkBackup` / `referenceImport`。進捗保存は同じUoWでadmission leaseもrenewする。成功・失敗・cancelを含むすべての終端遷移と強制終端は同じUoWでreleaseする。worker crash時はJob leaseと同時刻にadmission leaseも失効し、scope Alarmのreaperが最大100件ずつ回収する。取得commit後の応答喪失ではJobもrunningなので、重複workerは有効lease判定で本処理へ入らない。

**`Job.succeed` は `notices` を要求する**（[domains/job.md](../domains/job.md)）。申し送りを出すのは `runConversion` の公開ステータスの適用（`visibilityNotApplied`）だけで、**それ以外の run 系はすべて空配列を渡す**。各ユースケースの記述にある `Job.succeed(artifact)` のような略記はこの既定（空の `notices`）を指す。取り込みの結果を `notices` に載せない理由は [ADR 014](../adr/014-import-result-provenance.md) にある — ノートに帰属する情報は、ノートを読める者すべてに、ジョブの保持期間と無関係に見えなければならないためである。

判定 1 の「見つからない」は、`deleteJobsForRequester`（退会の後始末。状態を問わず削除する）と配送が競合すると起こる。行がない以上その配送で進められる処理はなく、再配送しても結果は変わらないため、`updateBatchProgress` の「親が不在 → 何もせず成功として返す」と同じ扱いにする。

判定順の唯一の例外は `importExternalReferences`（Storage）で、`Job.start` に渡す `total` が本文を読んで参照を抽出するまで確定しないため、判定 1・2 は先頭で行いつつ判定 3 の `Job.start` だけを抽出後へ後ろ倒しする（[usecases/storage.md](./storage.md)）。

batch 親（`target.type === "batch"`）は本規則の対象外である。親は `enqueueBatch` で即 `running` + リース付きで生成され、子の終了報告（`updateBatchProgress`）がそのリースを延長した直後に起動されるため、判定 2 に必ず該当してしまう。親自身の実行を持つのは `bulkExport` だけで、その再入防止は下記「batch 親の組み立て規則」が定める。

## 共通: 強制終端の後始末

ワーカーの生存を待たずにジョブを終端させる経路（[domains/job.md](../domains/job.md) の「強制終端とリース」の 9 経路 — `failActiveJobsForExpiredIntegration` / `disconnectIntegration` / `trashNote` / `deleteWorkspace` / `deleteAccount` / `removeMember` / `leaveWorkspace` / `changeMemberRole` / `cancelJob`）は、ジョブを終端させるだけでは対象の側に中途半端な状態を残す。次の 2 つを**ジョブの終端と同一 UoW で**併せて行う。各経路の記述ではこれを「強制終端の後始末の規則に従う」と記す。

`cancelJob`（利用者自身による取り消し）だけは網で引かず `jobId` で 1 件を指すが、後始末は同じである。対象を選ぶ手段（対象・スコープ・要求者・`jobId`）は経路ごとに違っても、終端したあとに要る後始末は変わらない。

**節の名前と適用範囲**。この節は強制終端の 9 経路を主たる呼び出し元として書くが、手順 1（`processing` のままのノートの回復）は**リース失効による自動回収**（`Job.expire`）にも適用する。どちらも「実行体が自分で本文を書き換える余地なく終端した」という同じ穴を塞ぐためである。適用範囲の差は下記の共有手順の引数 `cause` が表し、節の名前は主たる呼び出し元を指す通称として残す（手順そのものの名前は `finalizeTerminatedJobs` = 「ジョブを終端させた側の後始末」で、そちらは由来を限定しない）。

**共有手順として定義する**

これは複数の呼び出し元が同一トランザクションの中で使い回す書き込みであり、ユースケースではなく**共有手順**として定義する（[usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」）。「保管ファイルの削除手順」（[usecases/storage.md](./storage.md) の `deleteFiles`）と並ぶ 2 つ目の共有手順であり、同じ規約に従う — UoW のコンテキストを引数に取り、自分では `UnitOfWorkProvider.run` を開かない。

```ts
// ctx は UnitOfWorkProvider.run のコールバックが受け取るコンテキスト
// （application/execution/unitOfWork.ts。[domains/index.md](../domains/index.md) の横断的関心事）
finalizeTerminatedJobs(ctx, params: {
  jobs: readonly (FailedJob | CanceledJob)[];   // この UoW で終端させたジョブ
  cause:
    | { type: "forced"; noteFailureReason: NoteFailureReason }
    | { type: "expired" };
}): Promise<void>
```

- `jobs` は呼び出し元が `Job.fail` / `Job.cancel` / `Job.expire` を適用した**結果**であり、手順そのものは終端の適用を含まない。どの遷移を当てるか（`fail` か `cancel` か `expire` か）と対象をどう選ぶか（対象・スコープ・要求者・`jobId`・リース失効）は経路ごとに違い、共有できるのは終端したあとの後始末だけだからである
- `cause` は終端の由来。`forced` は上記 9 経路（利用者の操作・資格情報の喪失に由来する強制終端）で、`noteFailureReason` を経路ごとに指定する。`expired` はリース失効による自動回収（`reapExpiredJobs` の `Job.expire` と、run 系の共通規則の判定 3 で引き継ぎ試行が上限を超えた場合の `Job.expire`）で、理由は `timeout` に固定される。手順 2 を行うのは `forced` のときだけである（下記「`expired` で生成物を回収しない理由」）
- 呼び出し元は自分の UoW の中でこの手順を実行する。手順の中で保管ファイルを消すときも `deleteFiles` ユースケースは呼ばず、「保管ファイルの削除手順」を同じ `ctx` で実行する

**1 回に終端させるジョブ数の上限は 100 とする**（[platform/index.md](../platform/index.md)）。網で引く経路（`listActiveByScope` / `listActiveByRequester` / `listActiveByTarget`）は `limit: 100` で引き、呼び出し元はその結果を自分の UoW で終端させる。**引いた件数が 100 に達した場合は、同じ scope-local UoW で継続要求 `job.terminationContinued` を `scheduled_tasks` に積み、Alarm を再設定する**。

積むのは**網を引いた呼び出し元自身**であり、`finalizeTerminatedJobs` ではない。共有手順は終端済みのジョブを受け取るだけで、網が上限に達したかどうかを知らないからである。継続要求を受け取るのは [`continueForcedTermination`](#continueforcedtermination) ただ 1 つ。

上限を設けると「操作の完了時点でスコープ内のジョブがすべて終端している」とは言えなくなるが、[ADR 008](../adr/008-domain-boundaries.md) が守ろうとした保証は失われない。残ったジョブも同じ scope の次の Alarm turn で終端し、その終端も後始末を同一 UoW で伴うためである。加えて、網で引く 8 経路はいずれも**その操作の直後から対象へアクセスできなくなる**（退会・ワークスペース削除・除名・脱退・降格・連携解除・連携失効・ゴミ箱への移動）ため、途中状態が利用者に観測されない。`cancelJob` は `jobId` で 1 件を指すので上限に掛からない。

**継続要求は経路を判別子で持つ**

対象の選び方は経路ごとに違い（上記のとおり対象・スコープ・要求者・`kind`）、当てる遷移も違う。したがって継続要求は**どの経路の続きか**を判別子で持ち、その経路が網を引き直すのに要る引数だけを添える。

```ts
// job.terminationContinued の payload は { origin: JobTerminationOrigin } の 1 フィールド
type JobTerminationOrigin =
  | { path: "trashNote";             noteId: NoteId; excludingJobId: JobId | null }
  | { path: "deleteWorkspace";       workspaceId: WorkspaceId; deletionOperationId: string }
  | { path: "deleteAccount";         userId: UserId }
  | { path: "removeMember";          workspaceId: WorkspaceId; memberUserId: UserId }
  | { path: "leaveWorkspace";        workspaceId: WorkspaceId; memberUserId: UserId }
  | { path: "changeMemberRole";      workspaceId: WorkspaceId; memberUserId: UserId; nextRole: WorkspaceRole }
  | { path: "disconnectIntegration"; userId: UserId; provider: ProviderKind }
  | { path: "integrationExpired";    userId: UserId; provider: ProviderKind };
```

スコープだけを運ぶ形（`{ scopeType, scopeId, cause }`）は採らない。それで選択述語を再現できるのは `deleteWorkspace` ただ 1 つで、残る 7 経路の続きは**元より広い集合を終端させる**からである — 除名の続きが他のメンバーのジョブと匿名ジョブまで取り消し（[testcases/workspace/removeMember.md](../testcases/workspace/removeMember.md) が「触れない」と定めている行を破る）、連携解除の続きが対象外の `kind` まで巻き込み、ゴミ箱への移動の続きが所有文脈の全ジョブに広がる。

**網と遷移は `path` から導く。payload には持たせない** — 経路が決まれば一意に決まり、二重に持つと食い違いうるためである。

| `path` | 網 | 追加の絞り込み | 遷移 | `cause.noteFailureReason` |
| --- | --- | --- | --- | --- |
| `trashNote` | `listActiveByTarget({ type: "note", noteId })` | `excludingJobId` に一致するものを除く | `cancel` | `canceled` |
| `deleteWorkspace` | `listActiveByScope({ type: "workspace", workspaceId })` | なし（要求者を問わない） | `cancel` | `canceled` |
| `deleteAccount` | `listActiveByRequester(userId)` と `listActiveByScope({ type: "user", userId })` の和集合 | `jobId` で重複除去（下記） | `cancel` | `canceled` |
| `removeMember` / `leaveWorkspace` | `listActiveByRequester(memberUserId)` | なし（current workspace scope が境界） | `cancel` | `canceled` |
| `changeMemberRole` | `listActiveByRequesterAndKinds(memberUserId, disallowedKinds)` | `nextRole` から kind 集合を導く | `cancel` | `canceled` |
| `disconnectIntegration` | `listActiveByRequesterAndKinds(userId, providerKinds)` | `provider` から kind 集合を導く | `cancel` | `canceled` |
| `integrationExpired` | 同上 | 同上 | **`fail("providerAuthFailed")`** | `providerAuthFailed` |

- `changeMemberRole` の `kind` の絞り込みは `nextRole` から導く。許される `kind` の表は [usecases/workspace.md](./workspace.md) の `changeMemberRole` が唯一の正典であり、継続要求に `kind` の並びを焼き付けない（焼き付けると表を変えたときに配送中のメッセージだけが古い規則で動く）
- `integrationExpired`（`failActiveJobsForExpiredIntegration`）だけが `fail` を使う 9 経路唯一の例外である（[domains/job.md](../domains/job.md) の「強制終端とリース」）。遷移を `path` から導くのはこの 1 経路のためで、`cause` だけを運ぶ形にすると継続の 2 巡目で `failed(providerAuthFailed)` が黙って `canceled` にすり替わる
- `deleteAccount` は global repository を2本走査しない。account deletion orchestrator が membership directory で列挙した各 scope へ command を送り、personal scope は `listActiveByScope`、workspace scope は `listActiveByRequester` をそれぞれ100件ずつ処理する。各 scope の local transaction が終端と後始末を束ね、Alarm task が続ける
- `trashNote` の `excludingJobId` は、`listActiveByTarget` が 1 ノートに限られるため実際には上限に達しない。それでも `origin` に含めるのは、達しないことが**規模の見積もりであって型の保証ではない**ためで、継続が走ったときに除外規約（[usecases/note.md](./note.md) の「共通: ユースケースを合成するときの副作用の範囲」）が黙って外れるほうを避ける

**1. `processing` のままのノートを回復させる**

終端させたジョブの `kind` が `conversion` で、対象ノート（`target.type === "note"`）の `content.status` が `processing` のままなら、`Note.markConversionFailed(reason, now)` を併せて保存する。`cause` の両方に適用する。

- `cause.type === "forced"` の `reason` は強制終端の原因を写す。連携の失効による一括失敗（`failActiveJobsForExpiredIntegration`）だけは `providerAuthFailed`（`runConversion` の失敗時と同じ表示に揃えるため）、残る経路（`disconnectIntegration` / `trashNote` / `deleteWorkspace` / `deleteAccount` / `removeMember` / `leaveWorkspace` / `changeMemberRole`）と `cancelJob` は `canceled` とする
- `cause.type === "expired"` の `reason` は `timeout` に固定する。ジョブ側の `JobFailure.reason` と同じ値であり（`Job.expire` は `failure: { reason: "timeout" }` で終端化する）、`NoteFailureReason` にも `timeout` があるためそのまま写せる。利用者に示す次の一手が「再試行する」で、`retryJob` が使える（`expire` は `attempts` を 0 に戻す）ことともつながる
- `canceled`（「処理が取り消されました」）は本文の失敗理由の語彙 `NoteFailureReason`（[domains/note.md](../domains/note.md)）に加える値である。`unknown` に畳まないのは、利用者に示す次の一手が「取り込み直す・再試行する」と一意に定まるため。変換の実行が返す理由の集合（`ConversionFailureReason`）には足さない — 変換が `canceled` を返すことはなく、外から止められたことだけを表す値だからである
- `regeneration` は失敗しても本文を `ready` のまま保つ設計（[usecases/conversion.md](./conversion.md)）なので対象外。ノート以外を対象とする kind（`driveBackup` / `bulkBackup`）と、`content.status` を動かさない kind（`referenceImport` / `pdfExport` / `bulkExport` / 一括操作系）も対象外
- 対象ノートが `ActiveNote` でなければ何もしない。ノート自身も書き換える `trashNote` だけは順序が要り、`Note.markConversionFailed` を `Note.trash` より**先に**適用する（`markConversionFailed` は `ActiveNote` しか受け取らない）
- 対象ノートごと消える経路（`deleteWorkspace`、`deleteAccount` の個人所有ノート）では結果的に無意味だが、規則を経路ごとに分けない。`deleteAccount` で残るワークスペース所有ノート（AC-09）にはこの回復が要る
- `cause.type === "expired"` の呼び出し元は 2 つある。**リーパー**（`reapExpiredJobs` の手順 2）は、`listExpiredRunning` が返した `running` を `Job.expire` で終端化したあと、同じ行の UoW でこの手順を実行する。**引き継ぎ試行の上限超過**（run 系の共通規則の判定 3）は、`Job.start` が返した `expire` の結果を保存する UoW でこの手順を実行する。どちらもワーカーが自分で本文を書き換える余地なく終端しているため、強制終端と同じ穴が開く

この後始末がないと、`processing` のノートは移動を拒否され（`BusinessRuleError(CannotMoveWhileProcessing)`）、`restoreNote` で戻しても `processing` のままで、本文を作り直す手立て（`requestRegeneration` は元ファイルからの再生成、取り込み直しは別のノートになる）に辿り着けないまま恒久的に固定される。ワーカーが生きている通常の失敗（`runConversion` が `Job.fail` を保存する経路）では本文の回復を実行体自身が同一 UoW で行うため、この手順は「実行体が自分で書き換えられなかったすべての終端」を埋める役になる。

**2. 保管済みの生成物を回収する**

`cause.type === "forced"` のときだけ行う。終端させたジョブが batch 親（`target.type === "batch"`）なら、`JobRepository.listChildren` で子を引き、**`succeeded` の子が持つ `artifact`** を集めて「保管ファイルの削除手順」（[usecases/storage.md](./storage.md) の `deleteFiles`）で破棄する。`cancelJob` の手順 5（一括ダウンロードの中間生成物の破棄）を全経路に広げたものである。

`listChildren` はページングを要求するポートで、`limit` の上限は全ドメイン共通の 100（[usecases/identity.md](./identity.md) の「共通の約束」）である。一括操作の子は最大 500 件あるため 1 ページには収まらない。この手順は**全ページを走査して**子を集める（`retryFailedChildren` の手順 4 も同じ）。画面に返す `getJobDetail` だけが利用者の指定したページをそのまま引く。

- 終端させたジョブ自身は対象にならない。`Job.cancel` / `Job.fail` が受け取るのは `QueuedJob | RunningJob` で、`artifact` を持つのは `succeeded` だけだからである（[domains/job.md](../domains/job.md)）。強制終端の網（`listActiveByTarget` / `listActiveByRequester` / `listActiveByScope`）が未終端のジョブしか返さないことも同じ帰結を与える。**回収の対象は、まだ終端していない親の、既に成功した子の生成物だけ**である
- それが要るのは一括ダウンロードだからである。子・ZIP とも生成物は**要求者の個人 subject**に帰属し、TTL は 7 日ある（[usecases/note.md](./note.md) の `runBulkExportItem` / `runBulkExport`）。除名（`removeMember`）・脱退（`leaveWorkspace`）で走行中の親を止めても回収しなければ、そのワークスペースのノート本文を含む生成物が、既にアクセス権を失った利用者の手元に 7 日残る。期限切れの自動回収（`collectExpiredArtifacts`）に委ねてよい話ではない
- 逆に、成功して終端済みのジョブが持つ生成物（単体の PDF、匿名の PDF、組み立て済みの ZIP）はこの規則では回収しない。強制終端はそもそも未終端のジョブしか止めないため、これらは終端させる集合に入らない。回収は期限（`expiresAt`）の経過に委ね、`collectExpiredArtifacts` が行う。ノートの生涯に連動させないのは Storage 側の方針とも一致する — `deleteFilesForNote` / `relocateFilesForNote` も `purpose: "artifact"` を対象にしない（[usecases/storage.md](./storage.md)）
- 回収するのはジョブが作った生成物（`purpose: "artifact"`）だけである。元ファイル（`purpose: "source"`）や媒体には触れない
- batch 親を終端させうるのは、スコープ・要求者で引く経路（`deleteWorkspace` / `deleteAccount` / `removeMember` / `leaveWorkspace` / `changeMemberRole`）と、親を直接指す `cancelJob` だけである。`trashNote` は対象（`target.type === "note"`）で引くため batch 親を返さず、`failActiveJobsForExpiredIntegration` / `disconnectIntegration` は batch 親を直接終端させない（子の終端化の集計に委ねる。[usecases/integration.md](./integration.md)）
- そのうち実際に artifact が集まるのは、`bulkExport` 親を終端させうる経路（`deleteWorkspace` / `deleteAccount` / `removeMember` / `leaveWorkspace` / `cancelJob`）に限られる。artifact を持つ子は `bulkExport` の子だけだからである。`changeMemberRole` が取り消すのは降格後のロールで実行できなくなる kind に限られ、`bulkExport` は viewer でも実行できてそこに入らない（[usecases/workspace.md](./workspace.md) の kind→要ロール表）ため、batch 親（一括操作・一括バックアップの親）を終端させても回収対象は空になる。`disconnectIntegration` / `failActiveJobsForExpiredIntegration` が絞る provider 依存の kind にも `bulkExport` は入らないため、batch 親を直接終端させないことと合わせて二重に空になる
- 空振りする経路でも規則は分けない。後始末を経路ごとの例外なく同じ形で読めるようにするためである
- 強制終端の**時点で**子が保管し終えている artifact だけが対象である。終端と同時に走っていた子のワーカーがそのあと保管したものは、上記 run 系の共通規則の判定 4 に従い期限付き保管の自動回収に委ねる。`cancelJob` が「実行中の子は完了を待つ」としているぶんもここに含まれる
- 「保管し終えている」と「`succeeded` である」は一致する。`runBulkExportItem` は保管ファイルの登録（手順 4）と `Job.succeed(artifact)`（手順 5）を**同一 UoW で**保存するため、artifact の行が存在することと子が `succeeded` であることが同時に確定するからである（[usecases/note.md](./note.md)）。この原子性がないと「保管済みだが `Job.succeed` 前」の子が生まれ、`succeeded` で絞るこの手順から漏れて、除名・脱退の時点でアクセス権を失った利用者の手元に本文を含む生成物が残る。オブジェクトストレージへの `put` だけは UoW の外（手順 4 の前半）で、UoW がロールバックすればメタデータのない孤児オブジェクトとして残るが、参照されないため害はない（[domains/storage.md](../domains/storage.md) の削除順序と同じ整理）

**`expired` で生成物を回収しない理由**

リース失効による自動回収（`Job.expire`）は `failed`（`timeout`）を作る。`failed` の batch 親は `retryFailedChildren` / `retryJob` が `Job.reopenBatch` で開き直せる（終端不変条件の唯一の例外）ため、成功済みの子の artifact は**そのあとの組み立てで要る資材**であり、消してはならない。7 日の TTL は再試行の窓を覆う長さとして選んである（[usecases/note.md](./note.md) の `runBulkExportItem`）。

対して `forced` の 9 経路が batch 親を終端させるときは必ず `Job.cancel` を使い（`fail` を使う `failActiveJobsForExpiredIntegration` は batch 親を直接終端させない。[domains/job.md](../domains/job.md) の「強制終端とリース」）、`canceled` の親は `Job.reopenBatch` の受理型（`SucceededJob | FailedJob`）に入らないため二度と開き直せない。回収してよいのはこの「開き直せないことが型で保証された」場合だけである。

## 共通: 実行体の振り分け

`JobDispatcher` が運ぶのは `jobId` と `kind` だけで、子ジョブは親と同じ `kind` を持つ（[domains/job.md](../domains/job.md) の batch 親の子ジョブ登録規則）。そのため受け手は `kind` だけで実行体を選べない。必ず `jobId` でジョブを読み直し（run 系の共通規則の先頭でどのみち引く）、`kind` と `target.type` の組で実行体を決める。

| `kind` | `target.type` | 実行体 |
| --- | --- | --- |
| `conversion` | `note` | `runConversion`（Conversion。単体取り込みと一括アップロードの子で共通） |
| `regeneration` | `note` | `runRegeneration`（Conversion） |
| `referenceImport` | `note` | `importExternalReferences`（Storage） |
| `pdfExport` | `note` | `runNoteExport`（Note） |
| `driveBackup` | `storedFile` | `runBackup`（Integration。単体バックアップ） |
| `bulkBackup` | `storedFile` | `runBackup`（Integration。一括バックアップの子） |
| `bulkExport` | `note` | `runBulkExportItem`（Note。一括ダウンロードの子） |
| `bulkExport` | `batch` | `runBulkExport`（Note。親の ZIP 組み立て） |
| `bulkTag` / `bulkVisibility` / `bulkMove` / `bulkDelete` | `note` | `runBulkNoteOperationItem`（Note。一括操作の子） |
| 上記以外 | `batch` | 実行体なし。何もせず返す |

`target.type === "batch"` で実行体を持つのは `bulkExport` 親だけである。他 kind の batch 親は `updateBatchProgress` が終端化するため `dispatchJob` がキューへ送らず、受け手に届かない。古いメッセージなどで届いた場合は何もせず返す。

同じ処理でも登録経路によって `kind` が変わる（一括バックアップの子は `bulkBackup` だが実行体は単体と同じ `runBackup`）。この非対称は `kind` が履歴（JB-01）の分類軸であることに由来する。

## 共通: batch 親の組み立て規則

`bulkExport` 親の実行（`runBulkExport`）は、run 系の共通規則ではなく次の手順で再入を防ぐ（ADR 012）。`job.readyToAssemble` は重複発行・重複配送されうるため、この手順が唯一の防御である。

1. 親ジョブを引く。見つからない、または終端状態なら何もせず返す（不在の扱いは run 系の共通規則の判定 1 と同じ）
2. `JobRepository.summarizeChildren` を引く。未終端の子が残っていれば何もせず返す（終端した親を `retryFailedChildren` が開き直して子を再試行した場合など。組み立ては次の全子終端で改めて起動される）。成功した子が 0 件なら何もせず返す（`updateBatchProgress` が `failed` / `canceled` にする）
3. `Job.beginAssembly(parent, now, leaseUntil)` を保存して実行権を取る
   - `BusinessRuleError(LeaseActive)` なら別のワーカーが組み立て中のため何もせず返す
   - `attempts` が上限を超えた場合、`beginAssembly` は `expire` の結果（`failed`、`reason: "timeout"`）を返すので、それを保存して終了する
   - 保存が `ConflictError` になったらジョブを読み直し、終端済みまたは組み立て中（`attempts >= 1` かつリース有効）なら何もせず返す。同時配送はここで一方だけが実行権を得る
4. 本処理（ZIP の組み立て）を行い、長引く間は `Job.renewAssemblyLease` でリースを延長する（`Job.reportProgress` ではない。組み立て中の親の期限を動かせるのは実行権を持つこのワーカーだけである）
5. `Job.succeed(artifact)` を保存する。保存が `ConflictError` になったときの扱いは run 系の共通規則の判定 4 と同じ（終端済みなら生成物を破棄して成功として返す）

**親を開き直すときの生成物の破棄**

`Job.reopenBatch` は `artifact` を捨てて親を `running` に戻す（[domains/job.md](../domains/job.md)）。捨てるのは参照だけなので、**呼び出し側は開き直す前の親が `artifact` を持っていたなら、その保管ファイルを「保管ファイルの削除手順」（[usecases/storage.md](./storage.md) の `deleteFiles`）で同じ UoW から破棄する**。`reopenBatch` を呼ぶのは `retryFailedChildren` の手順 6 と `retryJob` の手順 3・8 で、いずれもこの規則に従う。

- 対象になるのは `succeeded` の `bulkExport` 親が持つ組み立て済みの ZIP だけである。`failed` / `canceled` の親は `artifact` を持たず（不変条件）、`bulkExport` 以外の batch 親は自身の実行を持たないため生成物を作らない
- 破棄しないと、`stored_files` の行がどこからも参照されないまま TTL（7 日）まで容量を占める。ジョブの `artifact` 参照は上書きされ、履歴（`listJobs` の `artifact`）からも辿れなくなるため、利用者が古い ZIP をダウンロードし直す手立ては残らない
- 破棄の失敗で開き直し自体を止めない、という例外は設けない。同一 UoW なので、どちらかが失敗すれば両方が巻き戻る
- 開き直したあとの組み立てで作る ZIP は新しい `StoredFile` になる。`runBulkExport` の手順 6 が毎回新規に `registerEphemeral` するため、古い行を消しても組み立てのやり直しには影響しない

実行権は `attempts`（親では `beginAssembly` でしか増えない）とリースの組で表す。組み立てが始まる前の親のリースは `updateBatchProgress` の `reportProgress` でも延長されるが、それは「子の報告が届き続けている」ことの表明であって実行権ではない。組み立てが始まったあと（`attempts >= 1`）は `reportProgress` が期限を動かさない（[domains/job.md](../domains/job.md) の「組み立て中の親のリース」）ため、組み立て中にワーカーが落ちればリースは必ず失効し、再配送された `job.readyToAssemble` を `beginAssembly` が引き継ぐか、届かなければリーパー（`reapExpiredJobs`）が `failed`（`timeout`）に回収する。この規則がないと、死んだ組み立てワーカーのリースを子側の報告が延ばし続け、親が `running` のまま永久に終端しない。

## listJobs

### 概要

処理履歴を一覧する（JB-01）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `status` | `string[] \| null` | — | 既知の状態のみ |
| `kind` | `string[] \| null` | — | 既知の種別のみ |
| `parentsOnly` | `boolean` | ○ | 既定は `true` |
| `page`, `limit` | `number` | ○ | `limit` は 1〜100 |

### 出力DTO

`items: JobSummary[]`, `count: number`, `activeCount: number`

`JobSummary` は `jobId`, `kind`, `status`, `targetType`, `targetId`, `targetLabel`, `progress: { completed; total } | null`, `childSummary: { total; succeeded; failed; canceled } | null`, `failureReason: string | null`, `notices: JobNotice[]`, `artifact: { fileId; expiresAt; expired: boolean } | null`, `startedAt`, `finishedAt`, `createdAt`, `retryable: boolean`, `cancelable: boolean`。

`progress` は実行中の進捗であり、`running` のときだけ値を持つ（DB の `progress_*` 列が `running` 限定のため）。`childSummary` は batch 親（`target.type === "batch"`）のみ非 null で、子ジョブの行から数え直した内訳のため終端後も残る。履歴一覧の「100 件中 98 件成功」はこちらから作る。全子終端は `succeeded + failed + canceled === total` で判定する。`notices` は `succeeded` のジョブのみ非空になりうる（それ以外は空配列）。`failureReason` が「なぜ失敗したか」を表すのに対し、`notices` は**成功したジョブが実行中に下した判断**を表す（[domains/job.md](../domains/job.md) の `JobNotice`）。

親ジョブは `notices` を持たない（集計から申し送りは生まれない）。一括アップロードで複数の子が `visibilityNotApplied` になった場合、親の行には現れず子を開いて確認することになる。取り込みの直後に見せる集約表示は P-13（アップロード）の完了内訳が担い、そちらは `startBulkUpload` の応答を追う画面なので履歴とは別経路である。

### 処理フロー

1. global D1 の `JobHistoryQueryService.listByRequester` を引く。projection は scope-local `job.*` event が `sourceVersion` 条件付きで更新し、`targetLabel`、`childSummary`、failure / notice / artifact を一覧表示に必要な形で保持する
2. 一覧表示では scope DO を fan-out して読み直さない。projection の対象が削除済みになった event を受けたら `targetLabel = "削除済み"` に更新する
3. `retryable` は `status === "failed"` かつ再試行上限に達していないこと。ただし batch 親は `retryJob` の規則に従い、`kind === "bulkExport"` かつ子が全件終端・成功 1 件以上のときだけ真とする（組み立てのやり直し）。他の batch 親は偽で、導線は `retryFailedChildren` になる。`cancelable` は projection 上の表示値で、操作時に正データで再判定する
4. `activeCount` も `job_history` の `status IN ('queued','running')` を数える。表示は結果整合でよいが、cancel / retry の可否は操作時に scope-local Job を読み直す

ジョブは実行者本人にのみ見える。ワークスペースのノートに対するジョブでも他のメンバーには表示しない。匿名ジョブ（`requestedBy: null`）はどの `userId` とも一致しないため結果に現れない（ADR 010）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ページング値の範囲外 | `ValidationError("INVALID_PAGINATION")` |
| 未知の状態・種別 | `ValidationError("INVALID_FILTER")` |

## getJobDetail

### 概要

親ジョブを開いて子ジョブの内訳を見る（JB-01）。

### 入力DTO

`userId`, `jobId`, `page`, `limit`

### 出力DTO

`job: JobSummary`, `children: JobSummary[]`, `childCount: number`, `summary: { total; succeeded; failed; canceled }`

### 処理フロー

1. `JobId.scopeOf(jobId)` でscopeを復元し、`ScopeRouter` で正データのobjectを呼ぶ。parseできなければ `NotFoundError("JOB_NOT_FOUND")`
2. scope-local `JobRepository.findById` で `requestedBy === userId` を確認し、違えばnot found。続けて `listChildren` / `summarizeChildren` を引く。global historyの到着を待たず、認可と操作対象はlocal Jobで決める

匿名ジョブは `requestedBy: null` がどの `userId` とも一致しないため、常に `JOB_NOT_FOUND` になる（ADR 010）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ジョブ不在・他人のもの | `NotFoundError("JOB_NOT_FOUND")` |

## retryJob

### 概要

失敗したジョブを同じ設定で再実行する（JB-02）。

### 入力DTO

`userId`, `jobId`

### 出力DTO

`jobId`, `status`

### 処理フロー

1. ジョブを引き、所有を確認する
2. `assertFamilyMutable(jobId)`を確認し、`status !== "failed"` なら `BusinessRuleError(JobNotRetryable)`
3. batch 親（`target.type === "batch"`）は分岐して終える
   - `kind === "bulkExport"` かつ `summarizeChildren` が全件終端・成功 1 件以上なら、失敗したのは ZIP の組み立てである。その `BatchSummary` をそのまま `Job.reopenBatch(parent, summary, now, leaseUntil)` に渡して `running` に戻し、発行される `job.readyToAssemble` を収集して組み立てだけをやり直す（`reopenBatch` が `attempts` を 0 に戻すため `beginAssembly` が改めて実行権を取れる）。保存は `UnitOfWorkProvider.run` で行い、上記「共通: batch 親の組み立て規則」の「親を開き直すときの生成物の破棄」に従う（この分岐の親は `failed` なので `artifact` を持たず、破棄の対象は実際には空になるが、規則は分岐ごとに省かない）
   - それ以外の batch 親は `BusinessRuleError(JobNotRetryable)` とし、子の再試行は `retryFailedChildren` に任せる。batch 親を `Job.retry` で `queued` に戻しても、`job.enqueued` の購読ハンドラーが batch 親をキューへ送らないため実行されない
4. 子ジョブ（`parentId !== null`）は、親を `JobRepository.findById` で引いて `retryFailedChildren` の手順 2・3 と同じガードを当てる
   - 親が組み立て中（`kind === "bulkExport"` かつ `status === "running"` かつ `attempts >= 1`）なら `BusinessRuleError(AssemblyInProgress)`
   - 親が `canceled` なら `BusinessRuleError(JobNotRetryable)`
   - どちらのガードも `retryFailedChildren` と同じ理由による。子を 1 件だけ指しても、走っている組み立てワーカーと競合する事実も、`canceled` の親に子の結果を戻す先がない事実も変わらない。ガードを `retryFailedChildren` にしか置かないと、画面から子ジョブの再試行を選ぶ（`getJobDetail` の子一覧の導線）だけで同じ破れ方をする
5. 対象が存在するかを確認する。ノート・ファイルが削除済みなら `ValidationError("TARGET_MISSING")`
6. 失敗理由が `integrationRequired` / `providerAuthFailed` の場合、`ExternalConnectionRepository.findByUserAndProvider(userId, provider)` で該当の連携を引く（`provider` は `kind` から決まる。`conversion` / `regeneration` は `openrouter`、`driveBackup` / `bulkBackup` は `googleDrive`）。行がなければ `NotFoundError("CONNECTION_NOT_FOUND")`（未連携）、`ExpiredConnection` なら `BusinessRuleError(ReauthorizationRequired)`（失効）。`ActiveConnection` なら次へ進む
   - 未連携と失効を 1 つに畳まないのは `requestRegeneration`（[usecases/conversion.md](./conversion.md)）と同じ理由による — 未連携は「連携すれば再実行できる」、失効は「再連携が要る」で案内が異なり、失敗理由の `integrationRequired` / `providerAuthFailed` の区別とも対応する
7. 対象への権限を再確認する。失っていれば `BusinessRuleError(AccessDenied)`
8. `UnitOfWorkProvider.run` で `Job.retry` を保存する。子ジョブの場合は同じ UoW で親も進行中に戻す — `retryFailedChildren` の手順 6 と同じ規則で、親が終端状態（`succeeded` / `failed`）なら `retry` 適用後の子の現況を `BatchProgressCalculator.summarize` で集計し直して `Job.reopenBatch` に渡し（`succeeded` の `bulkExport` 親なら「親を開き直すときの生成物の破棄」に従って古い ZIP を同じ UoW で破棄する）、`running` の親なら `Job.reportProgress` で進捗を作り直す（リース延長を兼ねる）。実行系への送信は `job.enqueued` を購読するハンドラーが行う（このユースケースは `JobDispatcher` を直接呼ばない）

匿名ジョブは所有の確認で `JOB_NOT_FOUND` になり対象外。匿名の「再試行」は `exportNote` の再実行である（ADR 010）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 失敗状態でない | `BusinessRuleError(JobNotRetryable)` |
| batch 親（`bulkExport` 以外、または子が未終端・成功 0 件） | `BusinessRuleError(JobNotRetryable)` |
| 子ジョブで親が組み立て中（`bulkExport` かつ `running` かつ `attempts >= 1`） | `BusinessRuleError(AssemblyInProgress)` |
| 子ジョブで親が取り消し済み（`canceled`） | `BusinessRuleError(JobNotRetryable)` |
| 再試行の上限 | `BusinessRuleError(RetryLimitExceeded)` |
| 対象が削除済み | `ValidationError("TARGET_MISSING")` |
| 原因が未解消（未連携） | `NotFoundError("CONNECTION_NOT_FOUND")` |
| 原因が未解消（連携が失効） | `BusinessRuleError(ReauthorizationRequired)` |
| 権限を喪失 | `BusinessRuleError(AccessDenied)` |

## retryFailedChildren

### 概要

親ジョブの失敗した子だけをまとめて再実行する（JB-02）。

### 入力DTO

`userId`, `parentJobId`

### 出力DTO

`retriedCount: number`, `skipped: { jobId: string; reason: string }[]`

### 処理フロー

1. 親ジョブを引き、所有を確認する
2. `assertFamilyMutable(parentJobId)`を確認する。親が**組み立て中**（`target.type === "batch"` かつ `status === "running"` かつ `attempts >= 1`。`bulkExport` 親でのみ成立する）なら、子を 1 件も再試行せずに `BusinessRuleError(AssemblyInProgress)` を返す
3. 親が `canceled` なら、子を 1 件も再試行せずに `BusinessRuleError(JobNotRetryable)` を返す（`retryJob` の手順 2 が `status !== "failed"` を弾くのに対応する、本ユースケース唯一の親の状態ガード）
4. `JobRepository.listChildren` を**全ページ走査**して `failed` のものを集める（`limit` の上限は 100 で子は最大 500 件のため 1 ページには収まらない。「共通: 強制終端の後始末」の 2 と同じ走査）
5. 各件について `retryJob` と同じ検査を行い、通ったものだけを `Job.retry` する。通らなかったものは `skipped` に積む
6. 1 件以上 `retry` したら、親を進行中に戻す
   - 親が終端状態（`succeeded` / `failed`）なら、`retry` 適用後の子の現況を `BatchProgressCalculator.summarize` で集計し直し、その `BatchSummary` を `Job.reopenBatch(parent, summary, now, leaseUntil)` に渡して `running` に戻す（終端不変条件の唯一の例外。ADR 012）。進捗は `reopenBatch` が集計から作り直す。`retry` した子が未終端になるため `summary.settled` は偽で、`job.readyToAssemble` は発行されない（全子が改めて終端したときに `updateBatchProgress` が発行する）。`reopenBatch` は `attempts` を 0 に戻すため、改めて全子が終端すれば `beginAssembly` が実行権を取り直して組み立てをやり直せる。開き直す前の親が `artifact`（組み立て済みの ZIP）を持っていた場合は、「共通: batch 親の組み立て規則」の「親を開き直すときの生成物の破棄」に従って同じ UoW でその保管ファイルを破棄する
   - 親がまだ `running` なら `Job.reportProgress` で進捗を同じ値に作り直す（リース延長を兼ねる）。ここに到達する `running` の親は組み立てを始めていない（`attempts === 0`）ため、リースは必ず延びる — 組み立て中の親は手順 2 で弾かれている
7. 保存はすべて同一 UoW で行う。実行系への送信は `job.enqueued` を購読するハンドラーが行う

手順 3 が `canceled` の親を弾くのは、その親には子を戻す先がないためである。キャンセルは待機中の子だけを取り消して実行中の子の結果を残す（`cancelJob` の手順 3）ので、キャンセル前に `failed` だった子を抱えた `canceled` の親は実在する。`Job.reopenBatch` の受理型は `SucceededJob | FailedJob` で `CanceledJob` を含まない（[domains/job.md](../domains/job.md)）ため手順 6 の第 1 分岐は型として適用できず、`running` でもないため第 2 分岐にも合流しない。ガードなしに子だけを `retry` すると親は `canceled` のままで、子が改めて終端しても `updateBatchProgress` は「終端状態なら何もせず返す」で抜けるため、再試行した子の結果が永久に行き場を失う。取り消したものは再試行ではなく元の操作をやり直す（JB-02）。

手順 2 が組み立て中の親を弾くのは、走っている組み立てワーカーとの競合を規則で断つためである。弾かないと、ワーカーは再試行前の古い子集合のまま ZIP を作り終えて `succeed(artifact)` し、そのあと再試行した子が全件終端しても `updateBatchProgress` は「親が終端状態なら何もせず返す」で抜けるため `job.readyToAssemble` が二度と出ない（再試行した子の結果が ZIP に入らないまま親が `succeeded` で固定される）。

拒否は一時的なもので、待てば必ず解ける。組み立て中の親は必ず終端に至るからである（[domains/job.md](../domains/job.md) の「組み立て中の親のリース」） — ワーカーが完了すれば `succeeded`、落ちればリースが `reportProgress` で延びないまま失効し `reapExpiredJobs` が `failed`（`timeout`）に回収する。どちらでも手順 6 の `reopenBatch` 経路に合流し、`attempts` が 0 に戻って組み立てからやり直せる。リースの有効・失効で分けないのはこのためで、失効した親に再試行を許しても `attempts >= 1` のままではリースを延ばせず、結局リーパーの回収を待つあいだに親だけが `failed` になって子の終端が行き場を失う。

匿名ジョブは `parentId: null` のみ構成できるため子として存在せず、本ユースケースが匿名ジョブに触れることはない（ADR 010）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 親ジョブ不在・他人のもの | `NotFoundError("JOB_NOT_FOUND")` |
| 親が組み立て中（`bulkExport` かつ `running` かつ `attempts >= 1`） | `BusinessRuleError(AssemblyInProgress)` |
| 親が取り消し済み（`canceled`） | `BusinessRuleError(JobNotRetryable)` |
| 失敗した子が 0 件 | `ValidationError("NO_RETRYABLE_CHILD")` |

## cancelJob

### 概要

待機中・実行中のジョブを取り消す（JB-03）。

### 入力DTO

`userId`, `jobId`

### 出力DTO

`jobId`, `status`, `canceledChildren: number`

### 処理フロー

1. ジョブを引き、所有を確認する
2. `Job.isCancelable` が偽なら `BusinessRuleError(JobNotCancelable)`
3. 親ジョブなら、待機中の子をすべて `Job.cancel` する。実行中の子は完了を待つ（結果は残る）
4. `Job.cancel` を保存し、イベントを収集する
5. 「共通: 強制終端の後始末」に従う。`kind: "conversion"` の対象ノートが `processing` なら `Note.markConversionFailed("canceled")` を、既に保管された子の生成物（一括ダウンロードの中間生成物）があれば `deleteFiles`（Storage）を、いずれも同一 UoW で併せて保存する

匿名ジョブは所有の確認で `JOB_NOT_FOUND` になり対象外。ただし、対象で引くキャンセル（ゴミ箱への移動。`trashNote` の `listActiveByTarget` 経由）と、スコープで引く一括キャンセル（ワークスペース削除・退会。`listActiveByScope` 経由）には匿名ジョブも含まれる（ADR 010）。除名・脱退のキャンセルは `requestedBy` で絞るため匿名ジョブに触れない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 既に終端状態 | `BusinessRuleError(JobNotCancelable)` |
| ジョブ不在・他人のもの | `NotFoundError("JOB_NOT_FOUND")` |

## updateBatchProgress

### 概要

子ジョブの終了を受けて親ジョブの進捗と終了状態を更新する（`job.succeeded` / `job.failed` / `job.canceled` の購読）。

### 入力DTO

`parentJobId: string`

### 出力DTO

`status: string`, `summary: { total; succeeded; failed; canceled }`

### 処理フロー

1. `JobRepository.findById` で親を引く。終端状態なら何もせず返す
2. `JobRepository.summarizeChildren` を引く
3. `BatchProgressCalculator.applyTo(parent, summary, now, leaseUntil)`を保存する。未終端の`job.progressed`抑制は`Job.reportProgress`が保存済みevent markerで自律判定し、全子終端のterminal eventは抑制しない
   - 未終了なら `reportProgress`（リース延長を兼ねる。組み立て中の親（`attempts >= 1`）では進捗だけが更新され、リースは延びない。[domains/job.md](../domains/job.md) の「組み立て中の親のリース」）
   - 全子終端なら親を終端化する（成功 1 件以上で `succeeded`、成功 0 件かつ失敗ありで `failed`、全件キャンセルで `canceled`）
   - 例外: `kind: "bulkExport"` の親は、成功した子が 1 件以上あれば終端化せず、進捗を `total` まで更新して `job.readyToAssemble` を発行する。ZIP の組み立て（`runBulkExport`）が `succeed(artifact)` で終端させる（ADR 012）。成功 0 件なら他の kind と同じ規則で `failed` / `canceled` になる
4. 現在の子の状態から毎回計算し直すため、同じイベントを 2 回受け取っても結果は変わらない。`job.readyToAssemble` の重複発行・重複配送は受け手が吸収する — `runBulkExport` は上記「共通: batch 親の組み立て規則」に従い、`Job.beginAssembly` の実行権（親の `attempts` とリースの組）で二重の組み立てを防ぐ

このユースケースは `total` を変えない。全子終端の判定が成立するのは「対象 1 件につき子ジョブ 1 件」を登録側が守るからであり、処理が不要・不能な対象でも子を省かない（[domains/job.md](../domains/job.md) の batch 親の子ジョブ登録規則）。子の投入自体が中断されて `total` に届かない場合は、親のリースが延長されなくなって `reapExpiredJobs` が `failed`（`timeout`）として回収する。

匿名ジョブは `parentId: null` のみ構成できるため、本ユースケースが匿名ジョブに触れることはない（ADR 010）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 親が不在 | 何もせず成功として返す |
| 版の競合 | `ConflictError` を投げて再配送に委ねる |

## dispatchJob

### 概要

登録・再開されたジョブを実行系（キュー）へ送る（`job.enqueued` / `job.readyToAssemble` の購読）。`JobDispatcher` を呼ぶのはこのハンドラーだけとする（[domains/job.md](../domains/job.md)）。

### 入力DTO

`scope: JobScope`, `jobId: string`, `kind: string`（event payload）

### 出力DTO

なし

### 処理フロー

1. `job.enqueued` で `target.type === "batch"`（batch 親）なら、キューへ送らず返す。親ジョブの実行は `job.readyToAssemble` の購読経由のみとする（ADR 012）
2. それ以外は `JobDispatcher.dispatch(scope, jobId, kind)` を呼ぶ。JobId に埋め込まれた scope と payload が違えば不正eventとして失敗させる

このハンドラーは実行体を選ばない。`kind` だけでは親と子を区別できないため、振り分けは受け手がジョブを読み直して `kind` と `target.type` の組で行う（上記「共通: 実行体の振り分け」）。

配送は少なくとも 1 回。重複配送は受け手（run 系の共通規則、batch 親は組み立て規則）が吸収するため、このハンドラーは重複排除を行わない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| キュー送信の失敗 | `SystemError(ExternalServiceError)` を投げて再配送に委ねる |

## reapExpiredJobs

### 概要

リースが失効した実行中ジョブを回収する（ADR 012）。Job を持つ scope object の Alarm から呼ばれ、current scope だけを処理する。通常の回復は再配送時の `Job.start`、本ユースケースは再配送が来ない場合の保険である。

### 入力DTO

なし

### 出力DTO

`expiredCount: number`

### 処理フロー

1. current scope の `JobRepository.listExpiredRunning(now, limit)` で **100件**まで列挙する。上限は1 Alarm turnのCPU時間とevent fan-outを固定するためで、100件なら直後にcontinuation taskを積む
2. 各件を `UnitOfWorkProvider.run` で 1 行ずつ処理する。`Job.expire` で終端化して保存し、`job.failed` を収集する（`failure: { reason: "timeout" }`。`attempts` は 0 に戻り、手動 `retry` できる）。同じ UoW で「共通: 強制終端の後始末」を `cause: { type: "expired" }` として実行する — `kind: "conversion"` の対象ノートが `processing` のままなら `Note.markConversionFailed("timeout")` を併せて保存する。生成物の回収（手順 2）は行わない（`failed` の batch 親は `reopenBatch` で開き直せるため、成功済みの子の artifact は組み立ての資材として残す）
3. 1 件の失敗は記録して次の行へ進む（部分失敗の許容）

冪等性: `listExpiredRunning` はリース失効中の `running` のみを返し、`Job.expire` はリース有効なら `BusinessRuleError(LeaseActive)` で拒否する。引き継ぎ再開（`Job.start`、batch 親の組み立ては `Job.beginAssembly`）と競合しても楽観ロックでどちらか一方だけが成立するため、2 回実行しても・再配送と重なっても結果は変わらない。後始末の本文回復も `content.status === "processing"` のときだけ書き換えるため、同じ行を 2 回処理しても `failed(timeout)` のままで変わらない。

回収の対象には batch 親も含まれる — 子の投入や終了報告が途絶えた親、組み立て中にワーカーが落ちた `bulkExport` 親のどちらもリース失効で `failed`（`timeout`）になる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 版の競合 | 該当行をスキップして継続（引き継ぎ再開が成立したものとして扱う） |
| DB 障害 | `SystemError(DatabaseError)` |

## projectJobHistory

### 概要

scope-local Job のイベントから、利用者横断の一覧に使う global D1 `job_history` を更新する。

### 入力DTO

`input: JobEvent | NotePurgedEvent | StorageFileDeletedEvent | { type: "job.removalGlobalContinued"; scope: JobScope; removalOperationId: string } | { type: "job.removalManifestCompactContinued"; scope: JobScope; removalOperationId: string } | { type: "job.targetHistoryCleanupContinued"; target: JobTarget; operationId: string; cursor: string }`

### 出力DTO

なし。

### 処理フロー

0. `job.removalManifestCompactContinued`なら、その task 行が載っている scope objectで`compactItems(removalOperationId, 100)`を1回だけ実行する。残件中は同じtaskを同一UoWで再登録し、itemsが0件になった最後のUoWだけが`markCompleted`でheaderを30日tombstoneへ移す
1. `job.removed` / `job.removalGlobalContinued`ならpayloadのscope objectに残る`JobRemovalManifestStore.listUnacknowledged(removalOperationId, 100)`を読む。各routeは`target.type !== "batch"`ならtarget shardの`tombstoneRoute`を先に呼び、その成功後にrequestedBy別にgroupingして`JobHistoryProjectionWriter.tombstoneAndRemove(routes, removalOperationId)`を最大6 shard並行のwaveで呼ぶ。匿名routeはhistoryを飛ばす。全成功後にmanifest itemをackし、未ackが残れば決定的IDの`job.removalGlobalContinued { scope, removalOperationId }`を1件積む。0件ならそのscopeへ`job.removalManifestCompactContinued { removalOperationId }`を積む（宛先scopeは`scheduled_tasks`の行が持つ）。cursorはmanifestのack集合そのもので、どの段階の応答喪失も同じoperation IDから再実行する
2. `note.purged` / `storage.fileDeleted` / `job.targetHistoryCleanupContinued`ならtarget削除分岐へ入る。初回は`JobTargetHistoryRouteStore.tombstoneTargetBeforeFanOut(target, eventId)`を確定してcursor nullから、継続はpayloadの同じoperation ID/cursorから同target shardを100件ずつ読む。各routeをrequestedBy shardへ最大6並行のwaveで送り、`markTargetRemoved`する。nextCursorがあれば決定的IDの`job.targetHistoryCleanupContinued { target, operationId, cursor: nextCursor }`を1件保存して終了する。Job正データは変更せず、全history shardをscanしない
3. 残る通常Job eventはpayloadの`scope`がJobIdに埋め込まれたScopeKeyと一致することを確認し、そのscope objectから現在のJobを読み直す。Jobが既に削除済みならpayloadの`{ jobId, requestedBy, target }`で、batch以外のreverse routeを先にtombstone化してからhistoryを`tombstoneAndRemove`して終了する
4. parent Jobなら`summarizeChildren(jobId)`、子なら親の現在値と`summarizeChildren(parentId)`も読み、対象ノート・ファイルの表示名を同じscopeで解決して表示専用`JobHistoryEntry`を組み立てる。匿名Jobはglobal historyに保存しない
5. 匿名でなくtargetがbatchでもないJobは、event IDをoperation IDとして`JobTargetHistoryRouteStore.registerBeforeHistory`を先に呼ぶ。返る`routeRemoved`が真ならupsertせず成功、`targetRemoved`だけが真ならtargetLabelを「削除済み」にして`JobHistoryProjectionWriter.upsertIfNewer`を呼ぶ。writerは同じrequestedBy shardの有効なJob removal tombstoneもatomicに確認する。batchはreverse indexへ登録せず通常labelでupsertする。登録応答喪失は同じevent IDで再実行し、history upsert失敗時もrouteを残して再配送する。`sourceVersion`が保存済み以下ならstale eventとしてno-opにする

少なくとも1回配送を前提とし、event payload の進捗や失敗詳細を正として保存しない。常に scope の正データを読み直すため、配送順が逆転しても最新 snapshot へ収束する。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| scope と JobId の不一致 | 不正イベントとして隔離し運用通知 |
| scope object / D1 の一時障害 | 再配送 |

## pruneJobHistory

### 概要

current scope で保持期間を過ぎたジョブ正データを削除する。Job を持つ scope object の日次 scheduled task から呼ばれる。削除eventは global `job_history` projection も消す。

### 入力DTO

local用`{ type: "scopeRetention"; retentionDays: number }`（既定90）、global初回用`{ type: "job.globalTombstonePruneCron" }`、またはglobal継続用`{ type: "job.globalTombstonePruneContinued"; runId; generation; shardId; table: "historyRemoval" | "targetRoute"; cursor: string | null; asOf: Date }`

### 出力DTO

`deletedCount: number`

### 処理フロー

0. `job.globalTombstonePruneCron` / `job.globalTombstonePruneContinued`分岐ではscope Jobを読まない。初回Cronは固定`asOf`を持つ`global.maintenanceRunPruneContinued`初回taskを共通handlerへ発行し、hour bucket・kind・routing generationsから決定的`candidateRunId`を作って`beginOrResumeKind`する。同kindの前hour runが未完了なら新runを作らず、その固定`runId` / `asOf` / positionを再開する。新規または期限切れlease回復時だけ未claim shardから最大6 commandを起動する。各commandは指定1 shard・1 tableについて`pruneRemovalTombstones(asOf, cursor, 100)`または`pruneExpiredTombstones(asOf, cursor, 100)`を1回だけ呼ぶ。行の`expiresAt`自体がremovedAt+30日またはdeletedAt+120日なのでcutoffを再度引かない。target shardのDELETE成功後、run storeの現在positionのcursorと次command key、Queue outboxだけをrouting catalog transactionでcheckpointする（表は進めない — 表を進めるのは`advanceOrAck`側）。DELETE後・checkpoint前の応答喪失は保存済み入力cursorから冪等再実行する。100件なら同laneの次cursor、100件未満なら`advanceOrAck`で前進し、返ったposition（同laneの次表、またはlane最終表のackで自動claimされた別shardの永続化済みposition）をそのまま次の対象にする。表の走査順の正本はrun生成時に固定した表集合だけで、usecaseは表順を持たない。kind全体のactive laneは最大6、全generation/shard ackでcompleted。同時Cronと応答喪失は同じrunId/lease/command keyから再開する。global分岐はここで終了する
1. `type: "scopeRetention"`では`JobRepository.listRemovableRoots(now - retentionDays, 1)`で終端rootを1件だけ選び、`sha256("jobFamilyRemoval:" + canonicalScopeKey + ":" + rootJobId)`をremoval operation IDとする。rootのversion/終端状態を条件に、同じscope-local UoWで`claimFamilyForRemoval`と`JobRemovalManifestStore.beginOrResume(parentOperationId: null)`を確定する。既存claimならそのmanifest stateから再開する
2. 終端状態のジョブのみを対象とし、終了時刻（`finishedAt`）を比較する。境界は排他（`finishedAt < cutoff` のみ削除し、ちょうど `retentionDays` 前に終了したものは残る）
3. rootと子をJobId keysetで100件ずつ読み、各行の`{ jobId, requestedBy, target }`とcursorをmanifestへ同じUoWで追加する。各page後は決定的IDの`job.removalLocalContinued { removalOperationId }`からheader state/cursorを再開する。全件固定後にmarkReadyし、`deleteFamilyPage(root, removalOperationId, 100)`でclaim ownerと全行の終端状態を再検査しながら子を100件ずつ削除して最後にrootを削除する。root削除と同じUoWで`job.removed { scope, removalOperationId, rootJobId, requestedBy }`をoutboxへ保存する。FKはRESTRICTで予期しないCASCADEを禁止する
4. 匿名ジョブ（`requestedBy: null`）もここで削除される。匿名ジョブは `parentId: null` のみ構成できるため必ず削除の起点になる。退会時の後始末（`deleteJobsForRequester`）が及ばないため、これが匿名ジョブの唯一の掃除経路になる（ADR 010）
5. manifest構築・local削除は`job.removalLocalContinued`、global ackは`job.removalGlobalContinued`、item縮約は`job.removalManifestCompactContinued`で再開する。完了headerはscope-local日次taskが`pruneExpiredHeaders(now, 100)`で回収し、100件なら同じtaskを再登録する。family完了後に次rootを選び、対象0件なら翌日のtaskを自己登録する。1turnはいずれも100行以下である。削除済みworkspace scopeではこれらJob retention taskをmaintenance allowlistとして通し、新規Jobやretryはcompleted deletion tombstoneで拒否し続ける

### エラーケース

`SystemError(DatabaseError)`

## deleteJobsForRequester

### 概要

account deletion command が指定した current scope で、その利用者のジョブ履歴を削除する。

### 入力DTO

`operationId`, `scope: JobScope`, `userId`

### 出力DTO

`deletedCount: number`

### 処理フロー

1. current scope が入力の `scope` と一致することを確認し、`JobRepository.listRemovableRootsByRequester(userId, 1)`でroot familyを1件選ぶ。active Job の強制終端taskが完了するまでは実行しない。familyごとのremoval operation IDはpruneと同じscope+rootの決定式を使い、account deletionの`operationId`はparent task/manifestの`parentOperationId`として保持する
2. 匿名ジョブ（`requestedBy: null`）はどの `userId` とも一致しないため対象外で、`pruneJobHistory` が唯一の掃除経路になる（ADR 010）
3. pruneと同じclaim+manifest state machineへroot/childrenのroute keyを100件ずつ固定し、ready後に`deleteFamilyPage(root, removalOperationId, 100)`でlocal正データを削除する。root削除時にmanifest参照型`job.removed`を発行し、global consumerはreverse route→historyの順に100件ずつ消す。artifact は同じ scope の account deletion storage task が回収する
4. familyのglobal ack後に次rootを選び、0件になるまで親account deletion operationのscope taskで続ける。rootが0件でも`hasIncompleteByRequester(userId)`が真なら完了ackを返さず再予定する。これにより同じfamilyをpruneが先にclaimした場合もglobal history cleanupを待ってからaccount deletionを完了する

冪等性: 削除は対象がなければ 0 件で終わるため、同じイベントを 2 回受け取っても結果は変わらない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ジョブが 1 件もない | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## continueForcedTermination

### 概要

強制終端が1回で終端しきれなかったJobを、current scopeの `scheduled_tasks` / Alarmで続ける。上限100件を超えたぶんだけを同じscopeで引き受ける。

本ユースケースが `job.terminationContinued` の唯一の購読者であり、逆に本ユースケースが受け取るのはこの継続要求だけである（ドメインイベントは購読しない）。

### 入力DTO

`origin: JobTerminationOrigin`（「共通: 強制終端の後始末」の判別ユニオン）

### 出力DTO

`terminatedCount: number`

### 処理フロー

1. `origin.path` に応じて網を引き直す。`trashNote` は `listActiveByTarget`、`deleteWorkspace` と personal scope の `deleteAccount` は `listActiveByScope`、workspace scope の `deleteAccount` と `removeMember` / `leaveWorkspace` は `listActiveByRequester`、`changeMemberRole` と integration 系は `listActiveByRequesterAndKinds` を使う。kind 集合は `nextRole` / `provider` から導き、**最終述語を repository query に含めてから `limit: 100` を適用する**。網・遷移・`cause.noteFailureReason` は「共通: 強制終端の後始末」の表を正典とする
   - `deleteWorkspace`分岐は各turnで`assertDeletionOwner(origin.deletionOperationId)`を確認する。他のworkspace membership cleanupはそれぞれのaccount deletion/membership operation lockを確認する
2. **0 件なら何もせず成功として返る。** 対象が尽きた正常な終端であり、継続要求は積まない。終端したジョブは `listActive*` の結果から外れるため、網が空になることが完了の判定そのものになる（[domains/index.md](../domains/index.md) の「継続要求」）
3. `UnitOfWorkProvider.run` の中で、引いたジョブに表の遷移（`Job.cancel`、`integrationExpired` だけは `Job.fail("providerAuthFailed")`）を適用して保存し、併せて共有手順 `finalizeTerminatedJobs(ctx, { jobs, cause: { type: "forced", noteFailureReason } })` を同じ `ctx` で実行する
4. 手順 1 で引いた件数が 100 に達していれば、**同じ UoW で** `job.terminationContinued`（`origin` をそのまま写したもの）を `scheduled_tasks` に積み、次の Alarm を設定する。`origin` は書き換えない — カーソルを持たない継続であり、対象は終端するそばから網の結果から外れるため、同じ `origin` で引き直すだけで必ず前に進む
5. **対象が残っているのに 1 件も終端できなかった場合は新しい継続要求を積まない。** 現在taskの attempt と `dueAt` を更新して Alarm で再試行し、上限到達時は task を `failed` にして global 運用イベントを送る

**遷移と理由を payload から取らない**。手順 1 のとおり `origin.path` から導く。これにより継続の 2 巡目以降も 1 巡目と同じ規則で終端し、`integrationExpired` の続きが `canceled` にすり替わることがない。

**`origin` の実体の存在確認は行わない**。継続が届くまでに、`origin` が指すノート・ワークスペース・利用者・連携そのものが消えていることはありうる（退会やワークスペース削除の後始末は並行して走る）。網は「その述語に一致する未終端ジョブ」を返すだけで対象の実体を読まないため、実体が消えていれば 0 件になって手順 2 で正常終了する。存在確認を足すと、消えた実体のせいで**残っているジョブを終端させずに打ち切る**ことになる。

**このユースケースは `retryJob` / `retryFailedChildren` と競合しうる**。継続が届くまでの間に利用者が `failed` の親を開き直すことはできるが、開き直せるのは `Job.reopenBatch` の受理型（`SucceededJob | FailedJob`）に限られ、9 経路が batch 親に当てるのは必ず `Job.cancel` である（「`expired` で生成物を回収しない理由」）。`canceled` の親は二度と開き直せないため、継続が終端させたものが後から復活することはない。

冪等性: 終端したジョブは `listActive*` の結果に現れないため、同じ継続要求を再実行しても残っているぶんだけを終端させる。`scheduled_tasks` は (`kind`, `operationId`) で一意なので同じ系列を重ねず、個々のジョブの終端は版で守られ、競合したものは次の Alarm turn で拾われる。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 網が 0 件（対象が尽きた・実体が消えた） | 何もせず成功として返す（継続は積まない） |
| 個々の終端の版競合 | そのジョブを飛ばして続ける（次の Alarm turn で拾う） |
| 対象が残っているのに 1 件も終端できなかった | 新規継続を積まず現在taskをbackoffし、上限でfailed + 運用通知 |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |
