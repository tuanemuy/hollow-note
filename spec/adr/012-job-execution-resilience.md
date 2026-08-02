# 012. ジョブの実行はリースで保護し、batch 親の完了経路を一本化する

## ステータス

承認済み（[ADR 015](./015-cloudflare-runtime.md) が実行基盤を確定し、本 ADR の決定を**すべて維持**したうえで、batch 親の**組み立てリースの期間だけを 60 分から 15 分に短縮**した。組み立ては Queue コンシューマーで走り、壁時計 15 分で必ず終了するためである。進捗リースは 60 分のまま。期間の表の正典は [usecases/job.md](../usecases/job.md)）

## コンテキスト

ジョブの実行（[ADR 005](./005-async-processing.md)）は少なくとも 1 回の配送を前提とするが、実行中の異常系に対する規則が欠けていた。

1. ワーカーがクラッシュすると `running` のジョブが永久に滞留する。回復手段が手動キャンセルしかない
2. キューは同じメッセージを再配送しうるが、`running` のジョブを受け取ったワーカーがどう振る舞うべきかが未定義。生存している別ワーカーの実行中なのか、死んだワーカーの残骸なのかを区別できない
3. `retryFailedChildren` は終端した batch 親を再び進行中に戻す必要があるが、「終端状態からは遷移しない」という不変条件と衝突する。さらに、親がまだ `running`（`bulkExport` の組み立て中）のあいだに子を再試行すると、走っている組み立てワーカーとの競合をどう扱うかが定まらない
4. `bulkExport` の親ジョブの完了経路が `updateBatchProgress`（全子終端で succeed）と `runBulkExport`（ZIP を組み立てて succeed(artifact)）で二重に定義され、`runBulkExport` の起動契機も未定義だった
5. `target.type === "batch"` の親ジョブの `job.enqueued` をディスパッチハンドラーがキューへ送るのかが未定義だった
6. batch 親は `enqueueBatch` で直接 `running` から始まるため、run 系のような実行権の取得点を持たない。`bulkExport` 親の組み立ては再配送や `retryFailedChildren` で複数回起動されうるが、子の終了報告で延び続けるリースだけでは「進捗のために生きている」と「組み立て中である」を区別できず、組み立ての再入を弾けない
7. リースを検査する操作としない操作の線引きが未定義だった。連携失効に伴う一括失敗や、連携解除・ゴミ箱への移動・ワークスペース削除・退会・除名・脱退・ロールの降格に伴う一括キャンセルは実行中のワーカーの生存を待てないが、リースを一律に検査すると終端させられなくなる。さらに、強制終端したあとに対象の側へ残るもの（初回変換の途中で止められて `processing` のままになるノート、既に保管された生成物）の扱いも定義されていなかった
8. リース期間の具体値も、その供給元も定義されていなかった。`leaseUntil` を要求する振る舞いが 5 つあるのに、誰がどの長さで作るのかがどこにも書かれていない。`reapExpiredJobs` の実行間隔も同様で、間隔とリース期間の大小関係が決まらないと滞留がいつ解消されるのかを見積もれない
9. `JobScope` の決定規則が `exportNote`（匿名 PDF）以外の登録経路で未定義だった。`scope` は除名・脱退・ワークスペース削除・退会に伴うジョブ取り消しの網（`listActiveByScope`）の唯一の鍵である。さらに `requestBulkExport` / `requestBulkNoteOperation` は個人所有ノートとワークスペース所有ノートを混在させられるため、親ジョブの `scope` が原理的に 1 つに決まらない

## 決定

- **リース**: `jobs.lease_expires_at` を追加する（`status = 'running'` のとき NOT NULL、部分インデックス `WHERE status = 'running'`）。実行開始と進捗報告のたびに延長する（組み立て中の batch 親だけは例外。下記「組み立て中の親のリースは進捗報告で延ばさない」）
- **running 再配送の共通規則**: run 系ワーカーが `running` のジョブを受け取った場合、リースが有効なら何もせず返す（他ワーカーが実行中）。リースが失効していれば引き継いで再開する（`attempts` を加算し、上限超過なら `fail("timeout")` とし `retry` 可能にする）。`Job.start` の受理型を `QueuedJob | RunningJob（リース失効）` に拡張する
- **リーパー**: 定期実行（pruner と同じワーカーロール）でリース失効の `running` を検出し `fail("timeout")` に落とす経路も設ける。再配送が来ない場合の保険とする
- **reopenBatch**: `Job.reopenBatch(parent: SucceededJob | FailedJob, summary: BatchSummary, now: Date, leaseUntil: Date) → WithEventDrafts<RunningJob, JobEvent>` を追加し、`retryFailedChildren` / `retryJob` から使う。不変条件は「終端状態からは遷移しない（batch 親の子再試行による reopen を除く）」に改める。`finishedAt` / `failure` / `artifact` を捨て、`progress` は呼び出し側が渡した子の現況の集計から作り直す（`completed = succeeded + failed + canceled`）。`attempts` は 0 に戻し、親自身の実行（組み立て）を新たに主張できるようにする。`kind: "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1` なら `job.readyToAssemble` を発行し、そうでなければイベントを発行しない。`JobProgress` ではなく `BatchSummary` を受け取るのは、発行条件を `BatchProgressCalculator.applyTo` の `bulkExport` の例外（全子終端かつ成功 1 件以上）と一致させるためである — 成功 0 件で発行すると `runBulkExport` が組み立てるものを持たずに返し、親が `running` のまま誰にも終端されずリース失効の `timeout` を待つことになる
- **bulkExport の完了経路一本化**: `updateBatchProgress` は全子終端時、`kind: "bulkExport"` の親を succeed せず `job.readyToAssemble` イベントを発行する。購読ハンドラーが親ジョブをキューへディスパッチし、`runBulkExport` が ZIP を組み立てて `succeed(artifact)` する。他 kind の batch 親は従来どおり `updateBatchProgress` が succeed / fail する
- **batch 親のディスパッチ除外**: `job.enqueued` の購読ハンドラーは `target.type === "batch"` をキューへ送らない。親ジョブの実行は上記の `job.readyToAssemble` 経路のみとする
- **組み立ての実行権**: batch 親の実行（ZIP の組み立て）は `Job.beginAssembly(parent, now, leaseUntil)` で実行権を取ってから始める。再入判定は `attempts >= 1` かつリース有効なら `BusinessRuleError(LeaseActive)`。親の `attempts` は `enqueueBatch` で 0 に置かれ `reportProgress` では増えないため、子の終了報告で延び続ける「進捗のリース」と、`beginAssembly` が張り直す「組み立ての実行権」を、DB 列を増やさずに `attempts` の 0 / 1 以上で区別できる。最初の要求は必ず通り、2 回目以降は組み立て中のリースが有効なかぎり弾かれる。組み立て中にワーカーが落ちればリースが失効し（そのために下記のとおり進捗報告では延ばさない）、再配送での `beginAssembly` の再取得かリーパーの `expire` で回収される
- **リース期間**: 実行体を持つジョブ（単体ジョブと batch の子）は kind を問わず一律 **15 分**、batch 親は進捗リース・組み立てリースとも **60 分**とする。値は呼び出し側のユースケースが `clock.now() + 期間` で作り、ドメインは期間を知らない。`reapExpiredJobs` の実行間隔は **5 分**とし、**実行間隔 < 最短のリース期間**を保つ（生きているジョブを誤って落とさないことは `expire` のリース検査が保証するので、この関係は回復の遅れを抑えるためのものである。失効から回収までの遅れが 1 周期に収まり、滞留の総時間がリース期間の 2 倍を超えない）。表は [usecases/job.md](../usecases/job.md) の「共通: リース期間と回収の間隔」に置く
- **組み立て中の親のリースは進捗報告で延ばさない**: batch 親の `lease_expires_at` は進捗リースと組み立ての実行権が共有するため、`attempts >= 1`（組み立て中）の親には `reportProgress` によるリース延長を適用しない。進捗だけを作り直す。この状態で期限を延ばせるのは実行権を持つワーカーが呼ぶ `Job.renewAssemblyLease(parent, now, leaseUntil)` だけとし、これを振る舞いに追加する。組み立てワーカーが落ちればリースは必ず失効し、`beginAssembly` の再取得か `expire` に戻る
- **`JobScope` の導出と混在の禁止**: `scope` は要求者ではなく**対象の所有文脈**（`target.type === "note"` ならノートの `NoteOwner`、`storedFile` ならファイルの `StorageOwner`、`batch` なら子の所有文脈）から導き、登録時点の値のまま書き換えない。batch 親の `scope` を 1 つに定めるため、対象の所有文脈が 2 つ以上になる一括操作は登録の入力段階で禁止し、`ValidationError("MIXED_OWNER_SCOPE")` として全体を中止する
- **強制終端はリースを検査しない**: リースを検査するのは実行権を取る `start` / `beginAssembly` と、回収する `expire` の 3 つだけとする。`fail` / `cancel` は実行中のワーカーがいても終端化できる強制終端とする。ワーカーの生存を待てない経路は次の 9 つで、列挙はこれで全部である — 連携失効に伴う一括失敗（`failActiveJobsForExpiredIntegration`。要求者で引く）、連携解除（`disconnectIntegration`。要求者で引き、その連携に依存する `kind` に絞る）、ゴミ箱への移動（`trashNote`。対象で引く）、ワークスペース削除（`deleteWorkspace`。スコープで引く）、退会（`deleteAccount`。**要求者とスコープの和集合**で引く。退会者がワークスペース所有ノートに要求したジョブの `scope` は `workspace` になるためスコープだけでは拾えず、匿名の PDF 書き出しは `requestedBy: null` のため要求者だけでは拾えない）、除名・脱退（`removeMember` / `leaveWorkspace`。スコープで引き `requestedBy` で絞る）、ロールの降格（`changeMemberRole` の editor → viewer。スコープで引き `requestedBy` で絞ったうえで、降格後のロールで実行できなくなる `kind` にさらに絞る。スコープで引く経路のうち、この経路だけが `kind` による絞り込みを伴う）、利用者自身の取り消し（`cancelJob`。網で引かず `jobId` で 1 件を指す唯一の経路）。実行中のワーカーは次に自分の結果を保存した時点で楽観ロックの `ConflictError` によって終端に気づき、run 系の共通規則に従ってジョブを読み直し、終端済みなら生成物を破棄して成功として返す
- **強制終端の後始末**: 上に挙げた 9 経路は、ジョブの終端と**同一 UoW で**次の 2 つを併せて行う。(1) `kind: "conversion"` の対象ノートが `processing` のままなら `Note.markConversionFailed` で回復させる。理由は連携失効だけ `providerAuthFailed`、他は新設の `canceled` とする（`processing` は移動を拒否され `restoreNote` でも解けないため、放置すると本文が恒久的に固定される）。(2) 終端させたのが batch 親なら、`succeeded` の子が持つ `purpose: "artifact"` の生成物を `deleteFiles` で回収する。一括ダウンロードの生成物は要求者の個人 subject に 7 日残るため、回収しないと除名された利用者の手元に除名されたワークスペースのノート本文を含む生成物が残る。終端させるジョブ自身は対象にならない — `fail` / `cancel` が受け取るのは未終端のジョブだけで、`artifact` を持つのは `succeeded` のみだからである。成功して終端済みのジョブの生成物（単体 PDF・匿名 PDF・組み立て済みの ZIP）と、強制終端と同時に走っていたワーカーがそのあと保管した artifact は、いずれも期限付き保管の自動回収（`collectExpiredArtifacts`）に委ねる。規則の本体は [usecases/job.md](../usecases/job.md) の「共通: 強制終端の後始末」に置く
- **後始末は共有手順として定義する**: 上記は 9 経路が同一トランザクションの中で使い回す書き込みであり、ユースケースではなく**共有手順** `finalizeTerminatedJobs(ctx, { jobs, cause })` として定義する（[usecases/identity.md](../usecases/identity.md) の UoW 合成の規約。既存の「保管ファイルの削除手順」と並ぶ 2 つ目）。`cause` は終端の由来を表す判別ユニオンで、`{ type: "forced"; noteFailureReason }` が 9 経路、`{ type: "expired" }` がリース失効による自動回収（リーパーの `expire` と、引き継ぎ試行の上限超過による `expire`）に対応する
- **自動回収にも本文の回復を適用する**: `expire` で終端したジョブも、ワーカーが自分で本文を書き換える余地なく終わっている点は強制終端と同じである。`kind: "conversion"` の対象ノートが `processing` のままなら `Note.markConversionFailed("timeout")` で回復させる（理由はジョブ側の `JobFailure.reason` と同じ値を写す）。一方、生成物の回収は `expired` では**行わない** — `expire` が作る `failed` の batch 親は `reopenBatch` で開き直せるため、成功済みの子の artifact はそのあとの組み立てで要る資材だからである。回収してよいのは、`Job.cancel` が作る `canceled` の親のように `reopenBatch` の受理型に入らないことが型で保証された場合に限る
- **親を開き直すときは古い生成物を破棄する**: `reopenBatch` は `artifact` の参照を捨てるだけなので、呼び出し側（`retryFailedChildren` / `retryJob`）は開き直す前の親が `artifact` を持っていた場合、その保管ファイルを同一 UoW で「保管ファイルの削除手順」により破棄する。対象は `succeeded` の `bulkExport` 親が持つ組み立て済みの ZIP だけで、放置すると誰からも参照されない行が TTL まで容量を占める
- **組み立て中の親では子の再試行を受け付けない**: `retryFailedChildren` は、親が `bulkExport` の batch 親で `running` かつ `attempts >= 1`（組み立て中）なら `BusinessRuleError(AssemblyInProgress)` として 1 件も再試行しない。子を 1 件だけ指す `retryJob` にも同じガード（および `canceled` の親を弾くガード）を置く — 対象が 1 件か全件かで競合の性質は変わらないため、片方だけに置くと画面の子ジョブ再試行の導線から同じ破れ方をする。許すと、走っている組み立てワーカーが再試行前の古い子集合のまま `succeed(artifact)` で親を終端させ、そのあと再試行した子が全件終端しても `updateBatchProgress` が「親が終端状態なら何もせず返す」で抜けるため `job.readyToAssemble` が二度と出ない。組み立て中の親は上記「組み立て中の親のリースは進捗報告で延ばさない」により必ず終端に至る（完了なら `succeeded`、ワーカーが落ちればリース失効で `expire`）ので、拒否は待てば解け、終端後は `reopenBatch`（`attempts` を 0 に戻す）経路に合流して組み立てからやり直せる。リースの有効・失効では分けない — 失効した親に再試行を許しても `attempts >= 1` のままリースを延ばせず、リーパーが親を `failed` にするまでのあいだに子の終端が行き場を失う
- **runBulkExportItem**: 一括ダウンロードの子ジョブ（1 ノートの HTML / Markdown / PDF 書き出し）を実行するユースケースとして新設する。payload の format で分岐し、生成物を artifact として保管して `Job.succeed(artifact)` する

## 検討した代替案

### リースを持たず、経過時間だけで滞留を判定する

`started_at` からの経過でリーパーが `running` を落とす案。列の追加は不要だが、時間のかかる正常なジョブと死んだワーカーの残骸を区別できず、閾値を長くすれば回復が遅れ、短くすれば実行中のジョブを誤って失敗させて二重実行を招く。進捗報告で延長されるリースなら「生きているか」を直接表現できる。不採用。

### running の再配送を常に無視する

冪等性の名のもとに `running` を受け取ったら常に返す案。実装は最も単純だが、クラッシュしたワーカーのジョブは誰も引き継げず、滞留の解消がリーパーの `fail("timeout")` と手動 `retry` だけになり回復が 1 サイクル遅れる。リース失効時の引き継ぎを許すほうが再配送という既存の仕組みをそのまま回復に使える。不採用。

### retryFailedChildren で親ジョブを作り直す

終端した親はそのままにして新しい親を登録する案。不変条件は守れるが、子ジョブの `parentId` を付け替えるか履歴を分裂させるかの二択になり、処理履歴（JB-01）上「1 つの一括操作」が複数行に割れる。例外を 1 つ明記するほうが安い。不採用。

### 進捗リースと組み立てリースを 1 本のまま共有し続ける

`attempts` で主体は区別できるのだから期限は共有したままでよい、という案。列も振る舞いも増えないが、組み立て中（`attempts >= 1`）のワーカーが落ちたあとに `updateBatchProgress`（遅れて届く・重複配送される子の終了報告）の `reportProgress` が期限だけを延ばし続けると、`beginAssembly` は `LeaseActive` で弾かれ、`reapExpiredJobs` も失効していない親を拾えない。親は `running` のまま永久に終端せず、`retryJob` は `failed` を要求するので手動の回復手段もない。ジョブの滞留を潰すという ADR の目的そのものに反する。`renewAssemblyLease` を 1 つ足すほうが安い。不採用。

### 組み立て中の親を `attempts: 0` に戻して子の再試行を受け付ける

拒否する代わりに、`retryFailedChildren` が親の `attempts` を 0 に戻して「子を待つ」状態へ差し戻す案。利用者を待たせずに済むが、実行権を表す唯一の印を、実行権を持たない側が消すことになる。走っている組み立てワーカーは楽観ロックで気づくまで動き続け、その間に別のワーカーが `beginAssembly` を通せてしまう（二重の組み立て）。`attempts` を 0 に戻す振る舞いも `reopenBatch` とは別に要る。組み立ては必ず終端に至る短命な状態なので、終端を待って既存の `reopenBatch` 経路に合流させるほうが、増える概念がゼロで済む。不採用。

### `runBulkExport` が `succeed` の直前に子の集計を取り直す

組み立て終了時に `summarizeChildren` を引き直し、未終端の子がいれば生成物を捨てて終端させない案。競合そのものは検出できるが、そこで返ってもリースは張られたままで、`attempts >= 1` の親のリースは進捗報告では延びない以上、次の `job.readyToAssemble` は `LeaseActive` で弾かれ、親はリース失効まで進めない。検出しても回復しないので、入口で拒否するほうが短い。不採用。

### 成功済みのジョブの生成物も強制終端の後始末で回収する

`StoredFileRepository` から対象ノートの `purpose: "artifact"` を引き、既に完了した単体 PDF などもまとめて破棄する案。強制終端の網は未終端のジョブしか返さないため、これは「ジョブの後始末」ではなく「ノートやスコープを起点にした生成物の一斉削除」という別の規則になる。生成物は所属ノートの生涯ではなく `expiresAt` で回収するというのが Storage 側の一貫した方針（`deleteFilesForNote` / `relocateFilesForNote` も `artifact` を対象にしない）で、そこだけ例外を作ると保持期間の約束（単体 24 時間 / 一括 7 日）と削除契機が二重管理になる。ゴミ箱への移動は復元できる操作でもあり、生成物を即時に消す理由が弱い。不採用。

### 混在する一括操作を、所有文脈ごとに親を分けて受け付ける

対象を個人所有とワークスペース所有に割って親ジョブを 2 つ立てる案。入力を制限せずに済むが、`JobConcurrencyPolicy.ensureBulkExportSlot` が「未終端の `bulkExport` が 1 件以上あれば拒否」である以上、一括ダウンロードでは 2 つ目の親をそもそも登録できず自己矛盾する。加えて「1 つの一括操作 = 履歴 1 行」（`retryFailedChildren` で親を作り直さない理由と同じ）が割れ、返す `jobId` も 1 つに定まらない。不採用。

### `JobScope` に混在を表す variant を足す

`{ type: "mixed"; scopes: [...] }` を加える案。型の上では表現できるが、`listActiveByScope` の照合が単一文脈の等値比較から含有判定に変わり、部分インデックス `jobs_scope_active_idx` も効かなくなる。さらに、混在した親を除名や脱退で取り消すと、無関係な文脈のノートに対する子まで巻き添えで取り消される — 「そのワークスペースのぶんだけ止める」というキャンセル網の意図に反する。選択と一括操作は 1 つの文脈のノート一覧で行うため、混在は正規の操作では発生しない。不採用。

### updateBatchProgress の中で ZIP を組み立てる

完了経路は 1 本になるが、イベント購読ハンドラーの中で全生成物の読み出しと ZIP 生成という重い処理を行うことになり、実行時間の制約に収まらない。組み立てはキュー経由の専用実行（`runBulkExport`）に渡す。不採用。

## 影響

- `jobs` に `lease_expires_at` 列と部分インデックスが加わる。`Job.start` / `reportProgress` の署名にリース延長が関わる
- run 系の全ユースケースが「`running` を受け取った場合」の共通規則を前提にでき、個別の記述が要らなくなる
- リーパーの定期実行が pruner のワーカーロールに相乗りする
- `job.readyToAssemble` イベントと購読ハンドラー、`runBulkExportItem` ユースケースが増える
- `Job.beginAssembly` が振る舞いに加わる。組み立ての実行権のために `jobs` へ追加する列はない（`attempts` と `lease_expires_at` で足りる）
- `Job.renewAssemblyLease` が振る舞いに加わり、`reportProgress` は組み立て中の親の期限を動かさなくなる。`runBulkExport` の組み立て中の延長はこちらを呼ぶ。ここでも列は増えない
- リース期間（葉 15 分 / batch 親 60 分）と `reapExpiredJobs` の実行間隔（5 分）が運用上の確定値になる。リーパーは `pruneJobHistory`（1 日 1 回）と同じワーカーロールに相乗りするが、起動間隔は別に持つ。デプロイ側の定期実行の設定もこの 2 つの間隔に合わせる
- ジョブを登録する全 11 kind の経路が `scope` の導出規則に従う。対象を ID の並びで受け取る 3 経路（`requestBulkExport` / `requestBulkNoteOperation` / `requestBackup`）に、所有文脈の混在を弾く検査と `ValidationError("MIXED_OWNER_SCOPE")` が加わる
- ジョブ履歴の削除（`pruneJobHistory`）は親を持たないジョブを起点にし、子は `parent_id` の CASCADE で一緒に消える。`reopenBatch` で親が `running` に戻ったまま保持期間を跨いでも、終端済みの子だけが消えて親が終端できなくなることはない
- 失敗理由 `timeout` が「リース失効による回収」を含むようになり、利用者向け文言もそれを踏まえる
- `runBulkExportItem` の追加により、生成物の保持期間が経路で分かれる（単体 PDF は 24 時間、一括ダウンロードの生成物は子・ZIP とも 7 日）。`exportNote` の PDF 再利用は残りの保持期間が 24 時間以内の artifact だけを拾うことでこの差を吸収し、単体エクスポートの「24 時間保持」の約束を経路によらず保つ（[ADR 005](./005-async-processing.md)、[usecases/note.md](../usecases/note.md) の `exportNote` の「再利用の範囲」）
- 強制終端の 9 経路に、`Note.markConversionFailed` による `processing` ノートの回復と、終端させた batch 親の成功済みの子が持つ artifact の `deleteFiles` による回収が加わる。本文の失敗理由の語彙 `NoteFailureReason` に `canceled` が増える（`ConversionFailureReason` は変えない — 変換の実行がこの理由を返すことはないため）
- 取り消しは `Job.cancel` が `failure` を持たない `CanceledJob` を作るため、`JobFailureReason` には `canceled` を持たせない（`Job.fail("canceled")` を発行する経路がない）。`NoteFailureReason` の `canceled` は Note 側の語彙として独立に定義される。`JobFailureReason` は 14 値になり、`jobs.failure_reason` の CHECK もこの 14 値に揃う（[database/index.md](../database/index.md)）
- `retryFailedChildren` と `retryJob`（子ジョブを指す場合）に組み立て中の親を弾く分岐が加わり、`JobErrorCode` に `AssemblyInProgress` が増える
- 後始末が共有手順になることで、`_shared` に置く共有手順が 2 つになる。`reapExpiredJobs` と run 系の判定 3 が新たにその呼び出し元に加わり、`NoteFailureReason` の `timeout` が本文にも書かれるようになる（値そのものは既存で、`ConversionFailureReason` から引き継いだもの）
