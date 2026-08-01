# Job

非同期処理の状態・進捗・再試行・キャンセルを管理する。方針は [ADR 005](../adr/005-async-processing.md) に従う。匿名の PDF エクスポートの帰属は [ADR 010](../adr/010-anonymous-export-and-ticket.md)、実行の回復性と batch 親の完了経路は [ADR 012](../adr/012-job-execution-resilience.md) に従う。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| Job | ジョブ | 1 件の非同期処理。要求者に紐づく（匿名の PDF エクスポートのみ要求者を持たない） |
| ParentJob | 親ジョブ | 一括操作の全体を表すジョブ |
| ChildJob | 子ジョブ | 一括操作の対象 1 件を表すジョブ |
| Target | 対象 | ジョブが作用する相手。種別と ID の組で多相に持つ |
| Artifact | 生成物 | ジョブが作った成果物（PDF / ZIP） |
| FailureReason | 失敗理由 | 利用者に説明できる粒度の失敗の分類 |
| Notice | 申し送り | 成功したジョブが要求者に伝える、実行中に下した判断 |
| Lease | リース | 実行中のワーカーが生きていることの表明。失効した `running` は回収の対象になる |

## 値オブジェクト

### JobId

- **バリデーション**: 空白のみは不可。`BusinessRuleError(JobErrorCode.InvalidId)`

### JobKind

- **フィールド**: `value: "conversion" | "regeneration" | "referenceImport" | "driveBackup" | "pdfExport" | "bulkExport" | "bulkMove" | "bulkVisibility" | "bulkTag" | "bulkDelete" | "bulkBackup"`

### JobTarget

```
JobTarget =
  | { type: "note"; noteId: NoteId }
  | { type: "storedFile"; fileId: StoredFileId }
  | { type: "batch" }              // 親ジョブ。個々の対象は子ジョブが持つ
```

### JobProgress

- **フィールド**: `completed: number`, `total: number`
- **バリデーション**: `0 <= completed <= total`。違反時 `BusinessRuleError(InvalidProgress)`
- **補助**: `JobProgress.ratio(progress): number`

### JobFailure

- **フィールド**: `reason: JobFailureReason`, `detail: string`
- `detail` は運用者向けの文字列。利用者には `reason` から導いた文言を出す

```
JobFailureReason =
  | "unsupportedFormat" | "corruptedFile" | "integrationRequired" | "machineExtractionUnavailable"
  | "providerAuthFailed" | "modelError" | "quotaExceeded" | "timeout" | "sizeExceeded"
  | "passwordProtected" | "permissionRevoked" | "targetMissing" | "storageError" | "unknown"
```

`JobFailureReason` は Conversion の `ConversionFailureReason` の全値を含む上位集合であり、変換ジョブの失敗理由をそのまま格納できる。Job から Conversion への型依存は持たない。`timeout` はリース失効による回収（`expire`）も含む。

### JobNotice

成功したジョブが要求者に伝える申し送り（[ADR 014](../adr/014-import-result-provenance.md)）。

```
JobNotice =
  | { kind: "visibilityNotApplied"; requested: "unlisted" | "public"; reason: "handleMissing" | "slugMissing" }
```

`runConversion`（[usecases/conversion.md](../usecases/conversion.md)）が取り込み時の公開指定を適用できず非公開のまま残したことを表す。従来この事実は「ジョブの `detail` に記録する（ジョブ自体は成功とする）」と書かれていたが、`detail` は `JobFailure` のフィールドであり `failure` を持つのは `FailedJob` だけなので、**型の上で実行できない記述だった**。`notices` はその置き場である。

**中身を 1 種に絞るのは意図である**。取り込み結果（取得できなかった参照、装飾を失ったスタイルシート、除去された CSS 宣言）は `notices` に入れない。それらはノートに帰属する情報で、ノートを読める者すべてに、ジョブの保持期間と無関係に見えなければならない。供給元は本文と Storage の取得記録であり、その割り当ての根拠は ADR 014 にある。すべてをここに載せると `JobNotice` が Conversion・Storage・Note の 3 ドメインの語彙を吸収し、Job の変更理由がすべてのワーカーの都合に開かれる。

**`notices` に依存する不変条件は存在しない**。Job は運搬（終端時に受け取って保持する）と刈り取り（`pruneJobHistory` で行ごと消える）だけを担い、中身を解釈しない。`JobFailure.detail`（運用者向け）は据え置きで、役割が重ならない — `detail` は運用者が原因を追うための文字列、`notices` は利用者に見せる判断の記録である。

`canceled` は含めない。取り消しは `Job.cancel` が `failure` を持たない `CanceledJob` を作るため `status` そのものが表し、`fail` に渡す理由にはならない（`Job.fail("canceled")` を発行する経路は存在しない）。本文側の `NoteFailureReason`（[domains/note.md](./note.md)）が持つ `canceled` は `ConversionFailureReason` から独立に定義される Note の語彙であり、Job の集合とは連動しない。

### JobPayload

ジョブ登録時の指定を保持する。`kind` によって形が決まる。

```
JobPayload =
  | { kind: "conversion"; requestedVisibility: "private" | "unlisted" | "public"; conversionPreference: "auto" | "machineOnly" }
  | { kind: "regeneration"; source: "localFile" | "driveBackup"; instruction: string | null; modelOverride: string | null }
  | { kind: "referenceImport" }
  | { kind: "driveBackup" }
  | { kind: "pdfExport" }
  | { kind: "bulkExport"; format: "html" | "markdown" | "pdf" }
  | { kind: "bulkMove"; targetOwnerType: "user" | "workspace"; targetWorkspaceId: string | null }
  | { kind: "bulkVisibility"; visibility: "private" | "unlisted" | "public" }
  | { kind: "bulkTag"; action: "add" | "remove"; tagName: string }
  | { kind: "bulkDelete"; mode: "trash" | "purge" }
  | { kind: "bulkBackup" }
```

- **バリデーション**: `payload.kind` は `Job.kind` と一致する。不一致なら `BusinessRuleError(PayloadKindMismatch)`
- `payload` は必須。単体ジョブ（`enqueue`）も親ジョブ（`enqueueBatch`）も省略できない。子ジョブは親ジョブと同じ `kind` / `payload` を持つ（下記「batch 親の子ジョブ登録規則」）
- `conversion` の `conversionPreference` は取り込み時の指定。`storeUpload` / `startBulkUpload` が enqueue 時に設定し、非同期実行（`runConversion`）はこの値を `ConversionCapability`（`machineOnly` → `llm: "declined"`）に写して方針を決める（[usecases/storage.md](../usecases/storage.md)、[usecases/conversion.md](../usecases/conversion.md)）。`regeneration` は本人明示の再生成のためこの指定を持たない

### ArtifactRef

- **フィールド**: `fileId: StoredFileId`, `expiresAt: Date`
- **バリデーション**: `expiresAt` は生成時刻より後

### AttemptCount

- **フィールド**: `value: number`
- **バリデーション**: 0 以上の整数。上限は 3（`AttemptCount.exhausted(count): boolean`）

## エンティティ

### Job（集約ルート）

```
JobBase = {
  id: JobId
  target: JobTarget
  payload: JobPayload
  scope: JobScope                       // 対象が属する文脈。履歴の絞り込みに使う
  attempts: AttemptCount
  version: number
  createdAt: Date
  updatedAt: Date
}

// 帰属。匿名ジョブは pdfExport かつ親なしのみ型で構成できる（ADR 010）
JobAttribution =
  | { requestedBy: UserId; kind: JobKind; parentId: JobId | null }
  | { requestedBy: null; kind: JobKind & { value: "pdfExport" }; parentId: null }

JobScope =
  | { type: "user"; userId: UserId }
  | { type: "workspace"; workspaceId: WorkspaceId }

QueuedJob    = JobBase & JobAttribution & { status: "queued" }
RunningJob   = JobBase & JobAttribution & { status: "running"; startedAt: Date; progress: JobProgress; leaseExpiresAt: Date }
SucceededJob = JobBase & JobAttribution & { status: "succeeded"; startedAt: Date; finishedAt: Date; artifact: ArtifactRef | null; notices: readonly JobNotice[] }
FailedJob    = JobBase & JobAttribution & { status: "failed"; startedAt: Date | null; finishedAt: Date; failure: JobFailure }
CanceledJob  = JobBase & JobAttribution & { status: "canceled"; startedAt: Date | null; finishedAt: Date }

Job = QueuedJob | RunningJob | SucceededJob | FailedJob | CanceledJob
```

**不変条件**

- 終端状態（`succeeded` / `failed` / `canceled`）からは遷移しない（batch 親の子再試行による `reopenBatch` を除く）
- `artifact` を持つのは `succeeded` のみ
- `notices` を持つのも `succeeded` のみ。空配列でありうる。匿名ジョブ（`pdfExport`）は常に空 — `visibilityNotApplied` を出すのは `runConversion` だけであり、匿名ジョブは変換を行わない
- `requestedBy: null`（匿名ジョブ）は `kind: "pdfExport"` かつ `parentId: null` のみ（ADR 010）
- `leaseExpiresAt` を持つのは `running` のみ。実行開始（`start`）と進捗報告（`reportProgress`）のたびに延長する（組み立て中の batch 親は例外。下記「振る舞い」の `reportProgress` / `renewAssemblyLease`）。失効の判定は `leaseExpiresAt <= now`（ADR 012）。期間の値と供給元は [usecases/job.md](../usecases/job.md) の「共通: リース期間と回収の間隔」が定める
- `parentId` が指すジョブの `target.type` は `"batch"`
- 親ジョブの `progress.total` は子ジョブの件数と一致する（`total` は登録後に変えない）
- `scope` は対象の所有文脈と一致する（下記「`scope` の導出」）
- 親ジョブと子ジョブの `scope` は一致する。batch 親は対象を持たないため `scope` を子から導くしかなく、子の所有文脈は 1 つでなければならない（下記「batch 親の `scope` は単一である」）

**`scope` の導出**

`scope` はジョブが作用する**対象の所有文脈**をそのまま写した値であり、要求者（`requestedBy`）からは導かない。参加ワークスペースのノートを操作したジョブの `scope` は、要求者が誰であれ `workspace` になる。

| `target` | 導出元 |
| --- | --- |
| `{ type: "note" }` | そのノートの `NoteOwner`（[domains/note.md](./note.md)） |
| `{ type: "storedFile" }` | そのファイルの `StorageOwner`（[domains/storage.md](./storage.md)）。ジョブの対象になるのは元ファイル（`purpose: "source"`）だけで、その帰属はノートの所有文脈と一致する |
| `{ type: "batch" }` | 全子ジョブの所有文脈（単一であることを登録側が保証する） |

`NoteOwner` / `StorageOwner` / `JobScope` は構造的に同じ判別ユニオンで、写し替えは 1 対 1 に定まる。導出そのものは対象を引く登録ユースケースが行い（Job は I/O を持たない）、Job は渡された値を保持するだけである。生成物（artifact）の帰属先（サインイン済みの要求では要求者の個人 subject）は `scope` とは別物で、混同しない — 匿名の PDF 書き出しでも `scope` は対象ノートの所有文脈である（ADR 010）。

`scope` は登録時点の所有文脈で決まり、以後書き換えない。`bulkMove` の `scope` は移動元の文脈であり、実行によってノートの所有者が変わっても追随させない（キャンセルの網は「その文脈で走り始めたジョブ」を止めるためのものだから）。

**batch 親の `scope` は単一である**

一括操作の対象に個人所有ノートとワークスペース所有ノートが混ざると、親の `scope` は原理的に 1 つに定まらない。そこで**混在は登録の入力段階で禁止する**。対象を ID の並びで受け取る登録（`requestBulkExport` / `requestBulkNoteOperation` / `requestBackup`）は、絞り込んだあとの所有文脈が 2 つ以上あれば子を 1 件も作らずに全体を中止し、`ValidationError("MIXED_OWNER_SCOPE")` とする。`startBulkUpload` は取り込み先の所有者を 1 つだけ受け取るため構造的に混在しない。選択と一括操作は 1 つの文脈のノート一覧で行うため通常の操作では起こらず、転送境界で弾いても体験は変わらない。混在を許す代替案（親を文脈ごとに分ける／`JobScope` に混在の variant を足す）を採らない理由は [ADR 012](../adr/012-job-execution-resilience.md) に記録した。

**batch 親の子ジョブ登録規則**

子ジョブは親ジョブと同じ `kind` と同じ `payload` を持ち、`target` だけが対象 1 件を指す（`parentId` は親）。`kind` は「どの登録経路から生まれたか」を表し、「1 件をどう処理するか」は `target.type` と合わせて決まる（[usecases/job.md](../usecases/job.md) の実行体の振り分け規則）。この規則の帰結として、同じ処理でも登録経路によって `kind` が変わる非対称が生じる — 単体のバックアップは `driveBackup`、一括バックアップの 1 件は `bulkBackup` で、どちらも `runBackup` が実行する。単体の取り込みも一括アップロードの 1 件もともに `conversion` で、こちらは `kind` が一致する。履歴（JB-01）の絞り込みは `kind` 単位で行うため、この対応を保ったまま増やす。

登録経路と `kind` / `payload` / `requestedBy` / `scope` の対応は次のとおり。単体ジョブ（親を持たないもの）も含めた全 11 kind を挙げる。

| 登録元 | 分岐 | `JobKind` | `JobPayload` | `target.type`（親 / 子） | `requestedBy` | `scope` |
| --- | --- | --- | --- | --- | --- | --- |
| `storeUpload` | `parentJobId` なし（単体アップロード） | `conversion` | `{ kind: "conversion"; requestedVisibility; conversionPreference }` | 親なし / `note` | 要求者 | 取り込み先の所有文脈 |
| `startBulkUpload` → `storeUpload` | `parentJobId` あり | `conversion` | 同上（親子で同じ） | `batch` / `note` | 要求者 | 取り込み先の所有文脈（`ownerType` / `ownerWorkspaceId`） |
| `requestRegeneration` | — | `regeneration` | `{ kind: "regeneration"; source; instruction; modelOverride }` | 親なし / `note` | 要求者 | 対象ノートの所有文脈 |
| `updateNoteBody` / `runConversion` / `runRegeneration` | 新規の外部参照あり（`updateNoteBody` は `importReferences` が真のとき、変換系は結果の本文に参照が含まれるとき） | `referenceImport` | `{ kind: "referenceImport" }` | 親なし / `note` | 要求者（変換系は実行中ジョブの `requestedBy` を引き継ぐ） | 対象ノートの所有文脈 |
| `exportNote` | 期限内の生成物も実行中ジョブもないとき | `pdfExport` | `{ kind: "pdfExport" }` | 親なし / `note` | サインイン済みは要求者、匿名は `null` | 対象ノートの所有文脈 |
| `requestBulkExport` | — | `bulkExport` | `{ kind: "bulkExport"; format }` | `batch` / `note` | 要求者 | 対象ノートの所有文脈（単一） |
| `requestBackup` | 対象 1 件 | `driveBackup` | `{ kind: "driveBackup" }` | 親なし / `storedFile` | 要求者 | 対象ファイルの所有文脈 |
| `requestBackup` | 対象 2 件以上 | `bulkBackup` | `{ kind: "bulkBackup" }` | `batch` / `storedFile` | 要求者 | 対象ファイルの所有文脈（単一） |
| `requestBulkNoteOperation` | `addTag` | `bulkTag` | `{ kind: "bulkTag"; action: "add"; tagName }` | `batch` / `note` | 要求者 | 対象ノートの所有文脈（単一） |
| `requestBulkNoteOperation` | `removeTag` | `bulkTag` | `{ kind: "bulkTag"; action: "remove"; tagName }` | `batch` / `note` | 要求者 | 対象ノートの所有文脈（単一） |
| `requestBulkNoteOperation` | `changeVisibility` | `bulkVisibility` | `{ kind: "bulkVisibility"; visibility }` | `batch` / `note` | 要求者 | 対象ノートの所有文脈（単一） |
| `requestBulkNoteOperation` | `move` | `bulkMove` | `{ kind: "bulkMove"; targetOwnerType; targetWorkspaceId }` | `batch` / `note` | 要求者 | 移動**元**の所有文脈（単一） |
| `requestBulkNoteOperation` | `trash` | `bulkDelete` | `{ kind: "bulkDelete"; mode: "trash" }` | `batch` / `note` | 要求者 | 対象ノートの所有文脈（単一） |
| `requestBulkNoteOperation` | `purge` | `bulkDelete` | `{ kind: "bulkDelete"; mode: "purge" }` | `batch` / `note` | 要求者 | 対象ノートの所有文脈（単一） |

`BulkOperation` の 6 値（[usecases/note.md](../usecases/note.md)）は `bulkTag` / `bulkVisibility` / `bulkMove` / `bulkDelete` の 4 kind に畳み込まれ、失われる区別（`add` / `remove`、`trash` / `purge`）は `payload` が持つ。

`scope` 列の「所有文脈」は上記「`scope` の導出」の規則そのもので、「（単一）」は混在が禁止されること（上記「batch 親の `scope` は単一である」）を指す。`requestedBy` が `null` になりうるのは `exportNote` の 1 行だけで、これは `JobAttribution` の型が保証する（ADR 010）。

`total` は登録後に変えないため、登録側が「対象 1 件につき子ジョブ 1 件」を必ず守る。処理が不要・不能な対象でも子を省略してはならない — 省略すると `BatchProgressCalculator.summarize` の全子終端の判定が永久に成立せず、親が終端しない。

- 子を親と同一 UoW で作る登録（`requestBulkExport` / `requestBulkNoteOperation` / `requestBackup`）は、対象を絞り込んだあとの件数を `total` にするため定義上ずれない
- 子を別 UoW で作る登録は `startBulkUpload` → `storeUpload` の 1 経路のみ。`storeUpload` は変換方針が `unavailable` でも変換ジョブを必ず作り、終端化を `runConversion` に委ねる（[usecases/storage.md](../usecases/storage.md)）
- それでも子の投入が中断された場合（`storeUpload` 自体が失敗した、クライアントが離脱した）は、親のリースが延長されなくなるため `reapExpiredJobs` が `failed`（`timeout`）として回収する（ADR 012）。これが唯一の取りこぼし経路であり、異常系としてリース失効に委ねる

**匿名ジョブ**（ADR 010）

- `scope` は他の kind と同じ規則で対象ノートの所有文脈から導出する（上記「`scope` の導出」）。副作用として、対象で引くキャンセルの網（ゴミ箱への移動。`listActiveByTarget`）にも、スコープで引くキャンセルの網（ワークスペース削除・退会。`listActiveByScope`）にも匿名ジョブが入る。これは望ましい挙動である
- `listByRequester` 系の結果に現れず、`getJobDetail` / `cancelJob` / `retryJob` の対象外（`requestedBy: null` はどの `userId` とも一致しない）。除名・脱退のキャンセル（`listActiveByScope` のうち `requestedBy` が対象者のもの）にも入らない。匿名の「再試行」は `exportNote` の再実行であり、履歴は `pruneJobHistory` で消える
- 結果への到達は `ExportTicket`（[usecases/note.md](../usecases/note.md) の「共通: ExportTicket」。アプリケーション層の型）で行い、進捗照会・ダウンロードのたびにノートアクセスを再評価する

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `enqueue` | `params: { id: string; target: JobTarget; payload: JobPayload; scope: JobScope } & JobAttribution, now: Date` | `WithEventDrafts<QueuedJob, JobEvent>` | `payload.kind !== kind` なら `BusinessRuleError(PayloadKindMismatch)`。`attempts: 0` で生成し `job.enqueued` を発行。匿名構成（`requestedBy: null`）は `JobAttribution` の型で `pdfExport` かつ親なしに限られる |
| `enqueueBatch` | `params: { id: string; kind: JobKind; payload: JobPayload; requestedBy: UserId; scope: JobScope; total: number }, now: Date, leaseUntil: Date` | `WithEventDrafts<RunningJob, JobEvent>` | 親ジョブ。`payload` は必須で、`payload.kind !== kind` なら `BusinessRuleError(PayloadKindMismatch)`。`target: { type: "batch" }`、`progress: { completed: 0, total }`、`attempts: 0`、`leaseExpiresAt: leaseUntil` で即 `running` にする。`job.enqueued` を発行（batch 親はディスパッチ対象外のため、この発行は監査と購読側の一様な扱いのためである） |
| `start` | `job: QueuedJob \| RunningJob, total: number, now: Date, leaseUntil: Date` | `WithEventDrafts<RunningJob \| FailedJob, JobEvent>` | `queued` の場合: `attempts` を 1 増やし、`startedAt: now`・`leaseExpiresAt: leaseUntil` で `running` にして `job.started` を発行。リース失効の `running` の場合: 引き継ぎ再開（ADR 012）。まず `attempts` を 1 増やし、**この分岐に限り**加算後の `AttemptCount.exhausted` を判定する。真ならリースを張り直さず、**受け取ったジョブ（リース失効のまま）**に `expire` を適用してその結果を返す（張り直したあとでは `expire` がリース有効とみなして `LeaseActive` で拒否する）。偽なら `startedAt` は維持したままリースを `leaseUntil` に張り直し、`progress` を `{ completed: 0, total }` に作り直して `job.started` を発行。リース有効の `running` なら `BusinessRuleError(LeaseActive)`（run 系は呼び出し前にリースを検査し、有効なら何もせず返す）。分岐と試行上限の関係は下記「`start` の分岐と試行上限」 |
| `beginAssembly` | `parent: RunningJob, now: Date, leaseUntil: Date` | `WithEventDrafts<RunningJob \| FailedJob, JobEvent>` | batch 親自身の実行（`bulkExport` の ZIP 組み立て）の実行権を取る（ADR 012）。`target.type !== "batch"` または `kind !== "bulkExport"` なら `BusinessRuleError(InvalidTarget)`。`attempts >= 1` かつリース有効（`leaseExpiresAt > now`）なら別のワーカーが組み立て中のため `BusinessRuleError(LeaseActive)`。それ以外は `attempts` を 1 増やし、加算後の `AttemptCount.exhausted` を判定する。真ならリースを張り直さず、**受け取った親（リース失効のまま）**に `expire` を適用してその結果を返す（`start` と同じ順序。張り直したあとでは `LeaseActive` で拒否される。上限に達するのは `attempts >= 2` の親だけで、直前の `LeaseActive` 判定を抜けている以上リースは必ず失効している）。偽なら `leaseExpiresAt` を `leaseUntil` に張り直して `job.started` を発行 |
| `reportProgress` | `job: RunningJob, completed: number, now: Date, leaseUntil: Date` | `RunningJob` | `JobProgress` を作り直し、`leaseExpiresAt` を `leaseUntil` に延長する。ただし組み立て中の batch 親（`target.type === "batch"` かつ `attempts >= 1`）には延長を適用せず、進捗だけを作り直す（下記「組み立て中の親のリース」）。イベントは発行しない（更新が高頻度になるため） |
| `renewAssemblyLease` | `parent: RunningJob, now: Date, leaseUntil: Date` | `RunningJob` | 組み立て中の batch 親のリースを延長する。`target.type !== "batch"`、`kind !== "bulkExport"`、または `attempts === 0`（実行権を取っていない）なら `BusinessRuleError(InvalidTarget)`。進捗は変えない。イベントは発行しない。実行権を持つ組み立てワーカー（`runBulkExport`）だけが呼ぶ |
| `succeed` | `job: RunningJob, artifact: ArtifactRef \| null, notices: readonly JobNotice[], now: Date` | `WithEventDrafts<SucceededJob, JobEvent>` | `job.succeeded` を発行。`notices` を解釈せずそのまま保持する。申し送りを持たない実行体は空配列を渡す |
| `fail` | `job: QueuedJob \| RunningJob, failure: JobFailure, now: Date` | `WithEventDrafts<FailedJob, JobEvent>` | リースを検査せず終端化する（下記「強制終端とリース」）。`job.failed` を発行 |
| `expire` | `job: RunningJob, now: Date` | `WithEventDrafts<FailedJob, JobEvent>` | リース失効の `running` を回収する（ADR 012）。リース有効なら `BusinessRuleError(LeaseActive)`。`failure: { reason: "timeout" }` で終端化し、`attempts` を 0 に戻して手動 `retry` の余地を残す。`job.failed` を発行 |
| `cancel` | `job: QueuedJob \| RunningJob, now: Date` | `WithEventDrafts<CanceledJob, JobEvent>` | リースを検査せず終端化する（下記「強制終端とリース」）。`job.canceled` を発行 |
| `retry` | `job: FailedJob, now: Date` | `WithEventDrafts<QueuedJob, JobEvent>` | `AttemptCount.exhausted` が真なら `BusinessRuleError(RetryLimitExceeded)`。`status` を `queued` に戻し `failure` を捨てる。`job.enqueued` を発行 |
| `reopenBatch` | `parent: SucceededJob \| FailedJob, summary: BatchSummary, now: Date, leaseUntil: Date` | `WithEventDrafts<RunningJob, JobEvent>` | `target.type !== "batch"` なら `BusinessRuleError(InvalidTarget)`。子の再試行・組み立ての再試行に伴い親を `running` に戻す（終端不変条件の唯一の例外。ADR 012）。`finishedAt` / `failure` / `artifact` / `notices` を捨てる（捨てるのは参照だけなので、保管ファイルの破棄は呼び出し側が同じ UoW で行う。[usecases/job.md](../usecases/job.md) の「親を開き直すときの生成物の破棄」）。`progress` は呼び出し側（`retryFailedChildren` / `retryJob`）が渡した子の現況の集計から `{ completed: succeeded + failed + canceled, total: summary.total }` として作り直す。`startedAt` は維持する（`null` なら `now`）。`attempts` は 0 に戻す（親自身の実行 = 組み立てを新たに主張できるようにする）。`kind: "bulkExport"` かつ `summary.settled` かつ `summary.succeeded >= 1`（子は全件終端のまま親だけを開き直す場合）なら `job.readyToAssemble` を発行し、そうでなければイベントを発行しない。受理型に `CanceledJob` を含めないのは意図であり、取り消した親は開き直さず元の操作をやり直す（呼び出し側は `canceled` の親を手前で弾く。[usecases/job.md](../usecases/job.md) の `retryFailedChildren` 手順 3）。下記「`reopenBatch` が受け取るのは子の集計である」 |
| `isTerminal` | `job: Job` | `boolean` | 終端状態かどうか |
| `isCancelable` | `job: Job` | `boolean` | `queued` または `running` |

**`start` の分岐と試行上限**

`start` の 2 つの分岐は独立しており、試行上限の判定が掛かるのは引き継ぎ分岐だけである。

- `queued` からの通常開始: `attempts` を 1 増やして `running` にする。上限の判定は行わない。`queued` に到達する経路は `enqueue`（`attempts: 0`）と `retry`（上限に達していれば `RetryLimitExceeded` で弾く）だけなので、開始時点で上限内であることは呼び出し前に保証されている
- リース失効した `running` からの引き継ぎ再開: `attempts` を 1 増やし、加算後に `AttemptCount.exhausted` が真なら再開せず `expire` の結果を返す。`expire` は `RunningJob` しか受け取らないため、この判定は型の上でもこの分岐専用である
  - 順序が要る。`expire` はリースが有効なら `LeaseActive` で拒否するため、上限超過の場合は**リースを張り直す前**の（失効したままの）ジョブに適用する。先にリースを張り直してから `expire` を当てると必ず拒否され、上限超過の回収経路が成立しない。`beginAssembly` の上限超過も同じ順序に従う

`AttemptCount` の上限 3 は**自動的に連鎖する試行**の上限であって、ジョブの生涯での絶対上限ではない。`expire` が `attempts` を 0 に戻すのは、リース失効で回収されたジョブに対して利用者が手動 `retry` で新しい試行サイクルを 1 つ与えられるようにするためである。リセットされた `failed` から再び試行が始まるには利用者の明示操作（`retryJob` / `retryFailedChildren`）が必ず要るので、引き継ぎ再開だけで無制限に回ることはない。

**`reopenBatch` が受け取るのは子の集計である**

`reopenBatch` は `JobProgress` ではなく `BatchSummary`（下記 `BatchProgressCalculator`）を受け取る。`job.readyToAssemble` の発行条件が `BatchProgressCalculator.applyTo` の `bulkExport` の例外と同じ「全子終端かつ成功 1 件以上」でなければならず、`{ completed, total }` だけでは成功件数を判定できないためである。成功 0 件で発行すると `runBulkExport` は組み立てるものを持たずに何もせず返し（[usecases/job.md](../usecases/job.md) の「共通: batch 親の組み立て規則」手順 2）、親は `running` のまま誰にも終端されずリース失効による `timeout` を待つことになる。`progress` は `summary` から一意に定まる（`completed = succeeded + failed + canceled`）ため、呼び出し側が `completed` を組み立て直す必要もなくなる。

**強制終端とリース**

リースを検査するのは `start` / `beginAssembly`（実行権の取得）と `expire`（回収）だけである。`fail` / `cancel` はリースを検査せず、実行中のワーカーがいても終端化できる。ワーカーの生存を待たずに終端させる必要がある経路は次の 9 つで、列挙はこれで全部である。これは意図的な設計である。

- 連携失効に伴う一括失敗（`failActiveJobsForExpiredIntegration`。`listActiveByRequester` 経由。ここだけが `fail` を使い、他はすべて `cancel`）
- 連携解除に伴う一括キャンセル（`disconnectIntegration`。`listActiveByRequester` 経由で、その連携に依存する `kind` に絞る）
- ノートのゴミ箱への移動（`trashNote`。対象で引く `listActiveByTarget` 経由）
- ワークスペースの削除（`deleteWorkspace`。`listActiveByScope({ type: "workspace" })` 経由）
- 退会（`deleteAccount`。`listActiveByRequester` と `listActiveByScope({ type: "user" })` の**和集合**を `jobId` で重複除去して引く。退会者がワークスペース所有ノートに対して要求したジョブの `scope` は `workspace` になるため後者では拾えず、匿名の PDF 書き出しは `requestedBy: null` のため前者では拾えない。片方だけでは網が欠ける）
- 除名（`removeMember`）と脱退（`leaveWorkspace`）に伴う一括キャンセル（`listActiveByScope({ type: "workspace" })` のうち `requestedBy` が対象者のものだけ）
- 降格（`changeMemberRole` の editor → viewer）に伴う一括キャンセル（同じく `listActiveByScope({ type: "workspace" })` のうち `requestedBy` が対象者のもので、さらに降格後のロールでは実行できない `kind`（editor を要する `conversion` / `regeneration` / `referenceImport` / `driveBackup` / `bulkBackup` と、一括操作系の `bulkTag` / `bulkVisibility` / `bulkMove` / `bulkDelete`）に絞る。正は [usecases/workspace.md](../usecases/workspace.md) の `changeMemberRole` の kind → 要ロール表。スコープで引く経路のうち `kind` による絞り込みを伴うのはここだけで、除名・脱退・ワークスペース削除は全 `kind` を止める）
- 利用者自身による取り消し（`cancelJob`。網で引かず `jobId` で 1 件を指す唯一の経路。要求者による取り消しでもワーカーの生存は待てないため、リースを検査しない点も後始末も他の 8 経路と同じである）

実行中のワーカーは、次に自分の結果を保存した時点で楽観ロックの `ConflictError` によって終端に気づく。そのときの振る舞いは run 系の共通規則が定める — ジョブを読み直し、終端済みなら生成物を破棄して成功として返す（[usecases/job.md](../usecases/job.md)）。

強制終端した側の後始末（`processing` のまま残るノートの回復と、終端させた batch 親の成功済みの子が持つ生成物の回収）は [usecases/job.md](../usecases/job.md) の「共通: 強制終端の後始末」が定め、上に挙げた経路すべてがこれに従う。同じ後始末のうち**ノートの回復だけ**は、リース失効による自動回収（`expire`。リーパーと引き継ぎ試行の上限超過）にも適用する — どちらもワーカーが自分で本文を書き換える余地なく終端しているためで、そのときのノート側の理由は `timeout` になる。生成物の回収を `expire` に広げないのは、`failed` の batch 親が `reopenBatch` で開き直せる（成功済みの子の artifact は組み立ての資材として要る）からである。終端させるジョブ自身が生成物を持つことはない — `fail` / `cancel` が受け取るのは `QueuedJob | RunningJob` で、`artifact` を持つのは `succeeded` だけだからである。強制終端と同時に走っていたワーカーがそのあと保管した artifact も、強制終端の側から見えないため期限付き保管の自動回収に委ねる。

**組み立て中の親のリース**

batch 親の `leaseExpiresAt` は 1 本しかなく、「子の報告が届き続けている」ことを表す進捗リースと、「ZIP を組み立てている」ことを表す実行権のリースが同じ列を共有する。主体は `attempts`（`beginAssembly` でしか増えない）で区別できるが、期限まで共有すると、組み立て中のワーカーが落ちたあとに `updateBatchProgress`（遅れて届く・重複配送される子の終了報告）の `reportProgress` が期限だけを延ばし続け、`beginAssembly` は `LeaseActive` で弾かれ `reapExpiredJobs` の対象にもならない親が生まれる（`running` のまま永久に終端しない）。

これを防ぐため、**組み立て中の親（`target.type === "batch"` かつ `attempts >= 1`）のリースは `reportProgress` では延長しない**。この状態の期限を延ばせるのは、実行権を持つ組み立てワーカーが呼ぶ `renewAssemblyLease` だけである。子の終了報告が遅れて・重複して届いた場合も `reportProgress` は進捗だけを作り直す。結果、組み立てワーカーが落ちればリースは必ず失効し、`beginAssembly` の再取得か `expire` による回収に戻る。組み立てを始める前の親（`attempts === 0`）は従来どおり `reportProgress` でリースが延びる。

この規則の帰結として、組み立て中の親は必ず終端に至る（ワーカーが完了すれば `succeeded`、落ちればリース失効で `reapExpiredJobs` が `failed`（`timeout`）に回収する）。組み立て中の親に対する子の再試行（`retryFailedChildren`）を受け付けず終端後の `reopenBatch` に合流させられるのは、この「必ず終端する」性質があるからである（[usecases/job.md](../usecases/job.md) の `retryFailedChildren`）。

**ライフサイクル**

`enqueue` → `queued` → `start` → `running` → `succeed` / `fail` / `cancel`。`failed` からのみ `retry` で `queued` に戻れる。リース失効した `running` は、再配送時の `start` が引き継いで再開するか、リーパー（`reapExpiredJobs`）が `expire` で `failed`（`timeout`）に回収する。

batch 親は `enqueueBatch` で直接 `running` から始まり、組み立てが始まるまでは子の終了報告（`updateBatchProgress` 経由の `reportProgress`）でリースが延長される。`bulkExport` 親だけは自身の実行（ZIP の組み立て）を持ち、全子終端後に `beginAssembly` で実行権を取ってから `succeed(artifact)` する。組み立て中のリースを延ばせるのは組み立てワーカーの `renewAssemblyLease` だけで、ワーカーが落ちればリースが失効し、`start` と同じく再配送での引き継ぎ（`beginAssembly` の再取得）かリーパーの `expire` で回収される。終端した batch 親は `reopenBatch` で `running` に戻る（終端不変条件の唯一の例外）。

## ドメインサービス

### BatchProgressCalculator

**責務**: 子ジョブの結果から親ジョブの進捗と終了状態を導く。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `summarize` | `children: readonly Job[]` | `BatchSummary` | 件数を数え、全件が終端なら親の終了状態を決める |
| `applyTo` | `parent: RunningJob, summary: BatchSummary, now: Date, leaseUntil: Date` | `WithEventDrafts<Job, JobEvent>` | 未終了なら `reportProgress`（組み立てが始まる前の親ではリース延長を兼ねる。上記「組み立て中の親のリース」）、全件終端なら `succeed` または `fail`。`succeed` には空の `notices` を渡す（申し送りは 1 件を処理した実行体が出すものであり、集計から生まれない）。`kind: "bulkExport"` の親のみ下記の例外に従う |

```
BatchSummary = Readonly<{
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  settled: boolean;                 // 全件が終端状態
}>;
```

`BatchSummary` は `Job.reopenBatch` の引数でもある（上記「`reopenBatch` が受け取るのは子の集計である」）。親を開き直すときの `job.readyToAssemble` の条件を、`applyTo` の `bulkExport` の例外と同じ集計から判定するためである。

全件が終端で、成功が 1 件以上なら親は `succeeded`（部分失敗を含む）。成功が 0 件かつ失敗が 1 件以上なら `failed`（`reason: "unknown"`）。それ以外（全件キャンセル）は `canceled`。

親の失敗の**内訳を `detail` に書かない**。`detail` は運用者向けの文字列であり（上記 `JobFailure`）、利用者に内訳を見せる経路は既に別にある — 履歴（`listJobs` / `getJobDetail`）は親の `childSummary` を子の行から数え直して返す（[usecases/job.md](../usecases/job.md)）。`detail` にも書くと同じ内訳が 2 か所に載り、しかも一方は終端時点で凍結され、子を再試行して `reopenBatch` で親を開き直したあとは実態とずれる。`detail` に入れるのは運用者が原因を追うための情報（例外の種別など）だけとする。

例外として `kind: "bulkExport"` の親は、成功した子が 1 件以上あっても終端化しない。進捗を `total` まで更新して `job.readyToAssemble` を発行し、ZIP の組み立て（`runBulkExport`）が `succeed(artifact)` で終端させる（ADR 012）。成功が 0 件なら他の kind と同じ規則で `failed` / `canceled` になる。

batch 親のリースは子の終了報告（`updateBatchProgress` 経由の `reportProgress`）で延長される。リース期間（60 分）は子 1 件の実行時間の上限（15 分）より長く取る（[usecases/job.md](../usecases/job.md) の「共通: リース期間と回収の間隔」）。このリースは「親の進捗が更新され続けている」ことの表明であって組み立ての実行権ではない。実行権は `runBulkExport` が `Job.beginAssembly` で別に取る（親の `attempts` は `enqueueBatch` で 0 のまま `reportProgress` でも増えないため、最初の要求は必ず通り、2 回目以降は組み立て中のリースが有効なかぎり `LeaseActive` で弾かれる）。組み立てが始まったあと（`attempts >= 1`）は `applyTo` の `reportProgress` が期限を延ばさない — 上記「組み立て中の親のリース」の規則に従う。

**依存するポート**: なし

### JobConcurrencyPolicy

**責務**: 同時に実行してよいジョブかを判定する。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureNoDuplicate` | `existing: readonly Job[], kind: JobKind, target: JobTarget` | `void` | 同じ `kind` と `target` の未終端ジョブがあれば `BusinessRuleError(DuplicateJob)` |
| `ensureBulkExportSlot` | `runningBulkExports: number` | `void` | 1 件以上動いていれば `BusinessRuleError(BulkExportInProgress)` |

`ensureNoDuplicate` を呼ぶのは、**多重要求を利用者への業務エラーとして返してよい経路だけ**である（`requestRegeneration` と `requestBackup`）。多重登録を避けたいが要求そのものは成功させたい経路はこれを使わず、未終端ジョブの有無を見て登録を見送る — 参照取り込みの登録（`updateNoteBody` / `runConversion` / `runRegeneration` / `restoreNoteRevision`）がこれに当たり、重複の原因が利用者の操作ではなく自動保存だからである。PDF 書き出し（`exportNote`）はさらに別で、既存ジョブに**相乗り**させるためこれを呼べない（[usecases/note.md](../usecases/note.md)）。

**依存するポート**: なし

## ポート

### JobRepository

```ts
interface JobRepository extends TransactionalRepository<Job, JobId> {
  listByRequester(userId: UserId, criteria: JobListCriteria): Promise<PaginationResult<Job>>;
  listChildren(parentId: JobId, pagination: Pagination): Promise<PaginationResult<Job>>;
  listActiveByTarget(target: JobTarget): Promise<readonly Job[]>;
  listActiveByRequester(userId: UserId): Promise<readonly Job[]>;
  countActiveByKind(userId: UserId, kind: JobKind): Promise<number>;
  listActiveByScope(scope: JobScope): Promise<readonly Job[]>;
  listExpiredRunning(asOf: Date): Promise<readonly RunningJob[]>;
  summarizeChildren(parentId: JobId): Promise<BatchSummary>;
  summarizeChildrenOf(parentIds: readonly JobId[]): Promise<readonly { parentId: JobId; summary: BatchSummary }[]>;
  deleteOlderThan(cutoff: Date): Promise<number>;
  deleteByRequester(userId: UserId): Promise<number>;
}

type JobListCriteria = Readonly<{
  status: readonly Job["status"][] | null;
  kind: readonly JobKind[] | null;
  parentsOnly: boolean;
  pagination: Pagination;
}>;
```

- `listExpiredRunning` はリース失効（`leaseExpiresAt <= asOf`）の `running` を返す。リーパーの回収対象の列挙に使う（ADR 012）
- `listByRequester` の既定（`JobListCriteria.parentsOnly: true`）は `requested_by = ? AND parent_id IS NULL` を `created_at` の降順で引く。一括操作では子の行が親の数十〜数百倍になるため、`parent_id` を含まない索引では絞り込みが行の走査に落ちる。履歴一覧の索引は `requested_by` / `parent_id` / `created_at` の 3 列で支えられていることを前提にする（[database/index.md](../database/index.md)）
- `countActiveByKind` は `requestBulkExport`（[usecases/note.md](../usecases/note.md)）が `JobConcurrencyPolicy.ensureBulkExportSlot` に渡す件数を数える。呼び出し元はここだけで、`kind: "bulkExport"` の未終端ジョブ（親・子の両方）を数える。`requested_by` と未終端 `status` に加えて `kind` で絞るため、実行中件数の索引が `kind` を含んでいることを前提にする（同上）
- `summarizeChildren` は 1 件の親の内訳（`getJobDetail`）、`summarizeChildrenOf` は一覧に載った親をまとめて集計する用（`listJobs`）。どちらも `jobs_parent_idx` を使い、親の状態に依存せず子の現況から数え直す。子を持たない ID は結果に現れない
- `deleteOlderThan` は終端状態かつ**親を持たない**（`parentId === null`）ジョブのみを対象とし、終了時刻（`finishedAt`）を比較する。境界は排他（`finishedAt < cutoff` のみ削除する）。子は親の削除に伴って `parent_id` の外部キー CASCADE で一緒に消えるため、親が生きているあいだ子だけが消えることはない（[usecases/job.md](../usecases/job.md) の `pruneJobHistory`）
- 匿名ジョブ（`requestedBy: null`）はどの `userId` とも一致しないため、`listByRequester` / `listActiveByRequester` / `countActiveByKind` / `deleteByRequester` の結果には現れない（ADR 010）

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

### JobDispatcher

**目的**: ジョブを実行系（キュー）へ送る。

```ts
interface JobDispatcher {
  dispatch(jobId: JobId, kind: JobKind): Promise<void>;
}
```

このポートを呼ぶのは `job.enqueued` / `job.readyToAssemble` を購読するハンドラーだけとする。ジョブを登録するユースケースは `Job.enqueue` / `Job.retry` がイベントを発行するのに任せ、直接は呼ばない。これにより送信経路が 1 本に定まり、登録とトランザクションの原子性も保たれる。

`job.enqueued` の購読ハンドラーは `target.type === "batch"`（batch 親）をキューへ送らない。親ジョブの実行は `job.readyToAssemble` の購読経由のみとする（ADR 012）。

メッセージが運ぶのは `jobId` と `kind` だけで、これだけでは実行体が一意に定まらない（子ジョブは親と同じ `kind` を持つため、`bulkExport` には親 = `runBulkExport` と子 = `runBulkExportItem` の 2 つの実行体がある）。受け手は必ず `jobId` でジョブを読み直し、`kind` と `target.type` の組で実行体を選ぶ（[usecases/job.md](../usecases/job.md) の実行体の振り分け規則）。`kind` はキューやログの分類のために運ぶ値であり、振り分けの唯一の根拠ではない。

配送は少なくとも 1 回。受け手は同じジョブを 2 回受け取っても結果が変わらないように実装する。

**エラーケース**: `SystemError(ExternalServiceError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `job.enqueued` | `{ jobId, kind, target, requestedBy, parentId }` | 実行系への送信 |
| `job.started` | `{ jobId, kind }` | 監査 |
| `job.succeeded` | `{ jobId, kind, target, parentId, artifactFileId }` | 親ジョブの進捗更新（`updateBatchProgress`） |
| `job.failed` | `{ jobId, kind, target, parentId, reason }` | 親ジョブの進捗更新（`updateBatchProgress`） |
| `job.canceled` | `{ jobId, kind, target, parentId }` | 親ジョブの進捗更新（`updateBatchProgress`） |
| `job.readyToAssemble` | `{ jobId, kind }` | `bulkExport` 親の実行系への送信（`dispatchJob`。全子終端・成功 1 件以上のとき発行。ADR 012） |

`job.enqueued` の `requestedBy` は匿名ジョブでは `null`（ADR 010）。

終端 3 イベント（`job.succeeded` / `job.failed` / `job.canceled`）の購読者は `updateBatchProgress` だけで、しかも `parentId !== null`（batch の子）のときにしか働かない。購読ハンドラーは `parentId` が `null` のイベントを何もせず捨てる。これらは監査・履歴の材料でもあるが、履歴（`listJobs` / `getJobDetail`）は `jobs` の行を直接引くため専用の購読者を持たない。

- 通知の購読者はいない。処理の結果は利用者が履歴（JB-01）を開いて確認する設計で、プッシュ通知・メール通知はスコープ外である
- ノートの失敗表示（`content.status: "failed"` と `NoteFailureReason`）も `job.failed` の購読では作らない。実行体自身が `Note.markConversionFailed` をジョブの終端と同一 UoW で保存し（[usecases/conversion.md](../usecases/conversion.md) の `runConversion`）、強制終端の経路では終端させた側が同じことを行う（[usecases/job.md](../usecases/job.md) の「共通: 強制終端の後始末」）。イベント経由にすると本文とジョブの状態が一時的に食い違うため、この二重化は意図的に避けている

## エラーコード

```
JobErrorCode =
  | "InvalidId" | "InvalidProgress" | "InvalidTarget" | "PayloadKindMismatch"
  | "RetryLimitExceeded" | "DuplicateJob" | "BulkExportInProgress"
  | "JobNotCancelable" | "JobNotRetryable" | "LeaseActive" | "AssemblyInProgress"
```

## ユースケース（概要）

`listJobs`, `getJobDetail`, `retryJob`, `retryFailedChildren`, `cancelJob`, `updateBatchProgress`, `dispatchJob`, `reapExpiredJobs`, `pruneJobHistory`, `deleteJobsForRequester`

詳細は [usecases/job.md](../usecases/job.md)。
