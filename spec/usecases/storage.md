# ユースケース: Storage

ドメインの詳細は [domains/storage.md](../domains/storage.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

クォータの検査は **Usage のユースケース `ensureUploadAllowed`** を呼んで行う（[usecases/usage.md](./usage.md)）。Usage のドメインサービス `QuotaEnforcement` やリポジトリを Storage のユースケースから直接触ることはしない — Storage ドメインは Usage に依存しない（[domains/index.md](../domains/index.md) の依存表）ので、他ドメインの集約を読む必要のある判定はそのドメインのユースケース越しに行う。同じ理由で、`storeUpload` は消費（`consumeLlmCall`）を行わない。ここでの検査は受け付け時の事前確認にとどまり、実際の消費は `runConversion` / `runRegeneration` が行う。

生成物（`artifact`）の `StoredFile.registerEphemeral` は Note 側のエクスポート系ユースケース（`runNoteExport` / `runBulkExport` など）が行う。その帰属は [domains/storage.md](../domains/storage.md) の `StorageOwner` / `FileProvenance` の規則に従う: サインイン済みの要求では要求者の個人 subject、匿名の PDF エクスポートでは対象ノートの所有文脈に帰属し、`uploadedBy` は匿名時のみ `null`（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。

## startBulkUpload

### 概要

複数ファイルのアップロードを開始し、親ジョブを作る（IM-02）。実際の保管と変換は、ファイルごとに `storeUpload` が担う。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string \| null` | — | — |
| `files` | `{ fileName: string; declaredMimeType: string; size: number }[]` | ○ | 1〜100 件 |
| `visibility` | `"private" \| "unlisted" \| "public"` | ○ | 既定は `private` |
| `conversionPreference` | `"auto" \| "machineOnly"` | ○ | 既知の値。既定は `auto` |

`files[]` の宣言 MIME・宣言サイズは**受理判定の入力ではなく、事前の合計サイズ検査（手順 1）と暫定判定（手順 5）のためのヒント**である。確定判定は実体を握る `storeUpload` が行う（[ADR 050](../adr/050-upload-acceptance-from-bytes.md) の前提「受理判定の時点で実体を握っていること」がこのユースケースでは成立しないため）。

### 出力DTO

`parentJobId: string`, `accepted: { index: number; fileName: string; format: string; requiresLlm: boolean }[]`, `rejected: { index: number; fileName: string; reason: string }[]`, `llmRequiredCount: number`, `llmAvailable: boolean`

このユースケースはファイルの内容（head）を読まない。`accepted` の `format` / `requiresLlm` と `llmRequiredCount` は宣言 MIME・拡張子から導いた**暫定値**であり、内容に基づく確定判定は `storeUpload` / `runConversion`（`FormatDetector.detect`）が行う。暫定値と確定判定が食い違うことがある。

`llmRequiredCount` は `conversionPreference` に依らず「LLM 構造化を要する見込みの件数」を数える。`auto` では「N 件は連携が必要です」の事前警告に、`machineOnly` では「N 件は機械的変換では取り込めません」の事前警告に使う（P-13）。`machineOnly` でも暫定判定にすぎないため受け付けは中止せず、確定判定と結果の記録は `storeUpload` / `runConversion` に委ねる。

### 処理フロー

1. 件数が 100 を超えれば `ValidationError("TOO_MANY_FILES")`、合計サイズが 500 MB を超えれば `ValidationError("UPLOAD_TOO_LARGE")`
2. 所有者を組み立て、ワークスペースなら `createNote` の権限を確認する
3. 各ファイルについて `UploadValidationPolicy.ensureAcceptable` を試し、通らないものを `rejected` に積む
4. `ensureUploadAllowed`（Usage のユースケース）を `llmCalls: 0` で呼び、受理したファイルの合計サイズに対する容量の残量を検査する（LLM 実行回数の検査はファイルごとの方針が決まる `storeUpload` 手順 7 で行う。ここでの `llmRequiredCount` は宣言 MIME からの暫定値にすぎず、回数の予約にも使わない）
5. OpenRouter 連携の有無を調べて `llmAvailable` とし、宣言 MIME・拡張子から LLM 構造化を要するファイルの件数を暫定的に数えて `llmRequiredCount` とする（未連携でも `machineOnly` でも受け付ける）
6. `Job.enqueueBatch(kind: "conversion", payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }, requestedBy: userId, scope, total: accepted.length)` で親ジョブを作って保存する。子の `storeUpload` は同じ payload の変換ジョブを作る（[domains/job.md](../domains/job.md) の `JobPayload`）
7. 呼び出し側は `accepted` の各ファイルを `storeUpload` に `parentJobId` と `conversionPreference` つきで送る。`storeUpload` は受理した 1 件につき変換ジョブを必ず 1 件作るため、子の件数は `total` と一致する（[domains/job.md](../domains/job.md) の batch 親の子ジョブ登録規則）

`scope` は手順2で組み立てた取り込み先の所有文脈から導出する。要求者からは導かない。対象IDを受ける一括登録もsource ScopeKeyを必須にしたため、いずれの経路も親子のscopeは入力時点で一意になる。

親の `total` は登録後に変えない。子が `total` に届かないのは呼び出しが中断された場合（`storeUpload` 自体が失敗した、クライアントが離脱した）だけで、この異常系は親のリース失効による回収（`reapExpiredJobs` → `failed("timeout")`）に委ねる。既に取り込めたノートは子ジョブの結果として残る。

`visibility` が `public` の場合、公開ハンドル／スラッグが未設定なら `ValidationError("PUBLIC_HANDLE_REQUIRED")` として全体を中止する。取り込み後の公開ステータスの適用は、変換完了時に `changeNoteVisibility` 相当の処理として行う。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数・合計サイズの上限超過 | `ValidationError("TOO_MANY_FILES")` / `ValidationError("UPLOAD_TOO_LARGE")` |
| すべてのファイルが受け付け不可 | `ValidationError("NO_ACCEPTABLE_FILE")` |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| ワークスペースの権限不足 | `BusinessRuleError(InsufficientRole)` |
| 公開ハンドル未設定で公開を指定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")` |

## storeUpload

### 概要

アップロードされたファイルを保管し、ノートを作って変換ジョブを登録する（IM-01 / IM-02）。1 ファイルにつき 1 回呼ばれる。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string \| null` | — | `ownerType === "workspace"` のとき必須 |
| `fileName` | `string` | ○ | `FileName` の規則 |
| `body` | `ReadableStream<Uint8Array>` | ○ | — |
| `parentJobId` | `string \| null` | — | `startBulkUpload` が返した親ジョブの ID |
| `visibility` | `"private" \| "unlisted" \| "public"` | ○ | 既定は `private` |
| `conversionPreference` | `"auto" \| "machineOnly"` | ○ | 既知の値。既定は `auto`。`machineOnly` は LLM 構造化を使わずに取り込む |

**入力から宣言値を落としている**（宣言 MIME も宣言サイズも受けない）。サイズは実バイト長、型は先頭バイトの署名から決め、申告値を保管する経路を型から消す（[ADR 050](../adr/050-upload-acceptance-from-bytes.md) の決定 1）。保管する型とサイズは `UploadValidationPolicy.ensureAcceptable` の戻り値 `AcceptedUpload` から取る（[domains/storage.md](../domains/storage.md)）。

### 出力DTO

`noteId`, `fileId`, `contentStatus: string`, `contentFailureReason: string | null`, `conversionJobId: string`, `backupJobId: string | null`

`contentStatus` / `contentFailureReason` は作られたノートの `content` をそのまま写す。`failed` の理由を併せて返すのは、`machineExtractionUnavailable`（`auto` での取り込み直しを案内）と `unsupportedFormat`（形式が対象外）と `passwordProtected` で画面の案内が異なるため（P-13）。

### 処理フロー

1. 所有者を組み立て、ワークスペースなら `WorkspaceAuthorization.ensureCan(role, "createNote")` を呼ぶ。`visibility` が `public` なら公開に必要な所有文脈も併せて検査する — 個人所有は `owner.userId` の公開ハンドル、ワークスペース所有は公開スラッグ。未設定なら保管を始める前に `ValidationError("PUBLIC_HANDLE_REQUIRED")` を返す（`startBulkUpload` と同じ事前検査。単体アップロードの経路でも、バイト列を預けてから公開できないと分かる事態を避ける）
2. `UploadValidationPolicy.ensureAcceptable({ purpose: "source", ... })` を呼ぶ
3. `ensureUploadAllowed`（Usage のユースケース）を `llmCalls: 0` で呼び、容量の残量を確認する（LLM 回数の検査は方針が決まる 7 で行う）
4. `IdGenerator.next()` で `fileId` を採番し、`ObjectKey.build` で鍵を作る
5. `ObjectStorage.put` で保管し、実サイズとチェックサムを得る。あわせて**流したストリームの先頭 8192 バイトを退避**し、手順 6 の `head` に渡す。`StoredFile` の登録は手順 8 なので、この時点では `FileContentReader.readHead(fileId, 8192)` で読み直せない（読む範囲は `runConversion` / `requestRegeneration` の `readHead` と同じ 8192 バイトに揃える。[usecases/conversion.md](./conversion.md)）
6. `ConversionCapability` の `llm` を決める — `conversionPreference === "machineOnly"` なら `"declined"`、そうでなければ `ExternalConnectionRepository.findByUserAndProvider(userId, "openrouter")` の有無で `"available"` / `"unavailable"`。これを手順 5 で退避した `head` とともに `planConversionForUpload`（Conversion）に渡し、形式・方針（`ConversionPlan`）・本文の初期値（`InitialContentState`）を得る
7. 方針が LLM を要する場合（`ConversionPlan.requiresLlm(plan)` が真）、`ensureUploadAllowed` を `llmCalls: 1` で呼び、LLM 実行回数の残量を確認する
8. `StoredFile.register` と `Note.createFromUpload` を作る。`FileProvenance` は `{ purpose: "source", noteId, uploadedBy: userId }`（[domains/storage.md](../domains/storage.md)）。`initialContent` には 6 で得た `initialContent` をそのまま渡す — 状態と理由が 1 つの値に閉じているため、`failed(machineExtractionUnavailable)` と `failed(unsupportedFormat)` と `failed(passwordProtected)` は取り違えようがなく、`awaitingIntegration` との区別もここで再判定しない
9. 方針にかかわらず `Job.enqueue({ target: { type: "note", noteId }, payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }, scope, kind: "conversion", requestedBy: userId, parentId })` を作る。`parentJobId` があれば `parentId` に設定する
10. Drive の自動バックアップが有効なら `Job.enqueue({ target: { type: "storedFile", fileId }, payload: { kind: "driveBackup" }, scope, kind: "driveBackup", requestedBy: userId, parentId: null })` も作る
11. `UnitOfWorkProvider.run` でファイル・ノート・ジョブを保存し、すべてのイベントを収集する

Note ID は手順 4 の前に operation ID とともに採番し、global D1 の `NoteRouteStore.reserveCreate(noteId, scope, createdBy: userId, operationId)` で `reserved` routeを確保する。手順 11 のscope-local commit後に `activateCreate` し、失敗時は `createBlankNote` と同じ回復規則に従う。`createdBy` はmove後もrouteに残り、membership離脱後の著者refresh台帳になる。

**手順 9 の `requestedVisibility`**。`visibility` が `private` 以外でも、本文がまだないため保管の時点では適用できない。指定は手順 9 の変換ジョブの payload（`requestedVisibility`）として引き継ぎ、変換の成功後に `runConversion` の手順 14 が適用する（`changeNoteVisibility` ユースケースの呼び出しではなく、その手順の複製である。[usecases/conversion.md](./conversion.md) の「手順 14 は複製であって呼び出しではない」）。変換に失敗した場合は非公開のまま残す。手順 1 の事前検査（公開ハンドル／スラッグ）は、この後追いの適用が権限不足で失敗しないようにするためのものである。

**手順 9・10 の `scope`**。どちらも手順 1 で組み立てた**取り込み先の所有文脈**から導出する（`ownerType === "user"` なら `{ type: "user", userId }`、`ownerType === "workspace"` なら `{ type: "workspace", workspaceId: ownerWorkspaceId }`。[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。要求者からは導かない。手順 8 で作るノートの `NoteOwner` と元ファイル（`purpose: "source"`）の `StorageOwner` はいずれもこの所有者そのものなので、`note` を対象とする変換ジョブと `storedFile` を対象とするバックアップジョブは同じ `scope` になる。`parentJobId` があるとき（一括アップロードの子）は、親の `startBulkUpload` が同じ `ownerType` / `ownerWorkspaceId` から導出した値と一致し、親子の `scope` が一致するという不変条件を満たす。

方針が `unavailable`（`integrationRequired` / `machineExtractionUnavailable` / `unsupportedFormat`）でも変換ジョブを作り、終端化は `runConversion` に委ねる。理由:

- 一括アップロードの親ジョブの `total` は `startBulkUpload` が受理件数で確定させるため、子を省くと全子終端の判定が成立しなくなる。親の `total` を後から減らす案（子ジョブ側から親を書き換える）は、UoW の境界を跨ぐうえに並行する `storeUpload` が同じ親行を奪い合って競合を量産するので採らない
- 取り込めなかった事実がジョブ 1 行として処理履歴（JB-01）に現れ、原因の解消後に再試行（JB-02）できる
- 方針の判定が `runConversion` の 1 箇所に寄る。ここでの判定は head しか読まない暫定判定なので、内容に基づく確定判定で結果が変わりうる（`initialContent` は待たせないための暫定表示にすぎない）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未対応の MIME・拡張子 | `BusinessRuleError(UnsupportedMimeType)` |
| サイズ超過 | `BusinessRuleError(FileTooLarge)` |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| LLM 実行回数の上限到達 | `BusinessRuleError(LlmQuotaExceeded)`。機械的変換でも取り込める形式なら `conversionPreference: "machineOnly"` での再取り込みを案内する。LLM 必須形式では `machineOnly` にしても `machineExtractionUnavailable` になるため、翌月まで待つ案内のみとする |
| ワークスペースの権限不足 | `BusinessRuleError(InsufficientRole)` |
| 公開ハンドル未設定で公開を指定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")`（保管前に検出する） |
| `conversionPreference: "machineOnly"` で LLM 必須形式 | ノートは作り、`content` を `failed(machineExtractionUnavailable)` にする（`auto` での取り込み直しを案内する） |
| パスワード保護の検出 | ノートは作り、`content` を `failed(passwordProtected)` にする |
| オブジェクトストレージの失敗 | `SystemError(ExternalServiceError)`。ノートは作らない |
| 保管後にノート作成が失敗 | 保管したオブジェクトは孤児として回収対象にする |

## storeMedia

### 概要

エディタから挿入する画像・動画を保管する（ED-06）。

### 入力DTO

`userId`, `noteId`, `fileName`, `body`

**入力から宣言値を落としている**（宣言 MIME も宣言サイズも受けない）。型は先頭バイトの署名、サイズは実バイト長から決める（[ADR 050](../adr/050-upload-acceptance-from-bytes.md) の決定 1）。

### 出力DTO

`fileId`, `url: string`, `mimeType`, `size`

### 処理フロー

1. 「共通: 閲覧者コンテキストの解決」（[usecases/note.md](note.md)）と同じ手順でノートを解決し、`canEdit` を確認する。`moving` は切替前 source、`purging` / `tombstone` は not found、scope miss は primary で 1 回だけ引き直す。**route の CAS は取らない** — この経路が書くのは scope 内の `StoredFile` 1 行だけで、route の状態遷移（`beginMove` / `beginPurge`）ではないため `routeVersion` を固定する相手がいない。解決から手順 4 までの間にノートが移動した場合は、`resolveNote` の 1 回の引き直しに間に合ったものだけが新しい scope へ届き、間に合わなければ旧 scope に行が残って `collectOrphanMedia` の回収対象になる（編集系ユースケースがどれも同じ窓を持つ）。**`canEdit` のあとに、ゴミ箱に入っているノートを `BusinessRuleError(NoteIsTrashed)` で拒む** — 本文側の編集ユースケース（`updateNoteBody` ほか）と同じ門を通す。`NoteAccessPolicy` は所有者自身の trashed ノートに `canEdit: true` を返す（trash の壁は所有者以外の経路にしかない）ので、ここで見ないと本文へ入れる手段のないメディアが保管され、容量だけ占めたまま完全削除か 30 日後の孤児回収まで残る
2. `UploadValidationPolicy.ensureAcceptable({ purpose: "media", ... })` を呼ぶ。SVG はここで**長さだけでなく形も**受理の条件になる（単体の 1 文書として開けること、入れ子の深さが 64 以内であること、**breakout tag の要素名を含まないこと**。[domains/storage.md](../domains/storage.md)）。このうち breakout tag の拒否は**前段の安価な防御**であり、サニタイザーの費用を有界にする根拠ではない — 有界にするのは `HtmlProcessor` 自身の資源の上限（[ADR 013](../adr/013-html-sanitization-policy.md)）で、この判定はもっとも安く膨張を作れる形を 1 パスで断ってサニタイザーを走らせないためにある。実際この走査はコメントと処理命令を XML の終端で読むのに対し HTML のトークナイザーは `<?a>` を最初の `>` で終えるので、片方にだけ見える位置に breakout tag を置いた markup は受理される。それが失敗するときに Storage の語彙で失敗することは、この門ではなく手順 3 の翻訳が担保する
3. SVG の場合は `HtmlProcessor.process` に通してから保管する。`process` は本文の断片を前提にするので XML 名前空間の宣言を落とす。単体の `.svg` として開けるよう、**サニタイズが残した内容に `xmlns` を（`xlink:` 属性が残っていれば `xmlns:xlink` も）付け直す**。これは文書の**形**の復元であって許可リストの話ではない — サニタイズ規則の適用点を 1 つに保つため（[ADR 013](../adr/013-html-sanitization-policy.md)）、要素も属性も足さない。あわせて **`&nbsp;` を `&#160;` に書き換える** — U+00A0 を HTML の直列化はこの名前で書くが、DTD を持たない `.svg` にその実体は定義されておらず、未定義実体は XML の致命的エラーになる（直列化が出しうる非定義の参照はこれ 1 つで、ほかの `&` は XML の定義済み 5 つに収まる）。**そのうえで、サニタイズ後の markup が単体の 1 文書であることを、受理判定と同じ述語で確かめる**（[domains/storage.md](../domains/storage.md) の「単体の 1 文書として開けるか」: 根要素が `svg` ひとつで閉じ、その外に XML の `S` 以外が無く、タグが名前まで一致し、実体参照も文字も XML が認めるものだけであること）。受理判定が見たのは**受け取ったバイト列**だが、配られるのは**サニタイザーの出力**で、両者は SVG では別物になる — `process` が返すのは本文の断片なので `</svg>` の後ろの内容はそのまま残り、直列化も HTML の規則で行われる（`<desc>` の中で HTML 解析が再開した結果の void 要素、U+00A0 の `&nbsp;`）。だから同じ問いを、保管する実体にもう一度当てるほかない。1 文書にならなければ `BusinessRuleError(UnsupportedMimeType)` で返す。**`process` が Note の語彙で投げるコードは、ここで `BusinessRuleError(FileTooLarge)` へ翻訳する。** その集合は 2 つ — 資源の上限による打ち切り（`NOTE_HTML_TOO_COMPLEX`。[ADR 013](../adr/013-html-sanitization-policy.md)）と、サニタイズ後の長さが本文の上限を超えたこと（`NOTE_CONTENT_TOO_LARGE`）である。`process` が組み立てる Note の値は `NoteHtml` / `PlainTextContent` / `Excerpt` の 3 つだけなので、Note の語彙でほかのコードは出てこない。**約束（この経路が Storage の語彙でしか失敗しないこと）を支えるのは、この集合を覆い切ることであって「片方は到達不能だ」という論証ではない** — その種の論証は 128 KB について繰り返し実測に否定されている（[domains/storage.md](../domains/storage.md)）。翻訳先が `FileTooLarge` なのは、2 つのコードがどちらも長さの上限であり、そこに当たる入力はサニタイズが完了していれば手順 4 の測り直しで同じ `FileTooLarge` になるからである（`UnsupportedMimeType` は「この形式は扱えない」という偽の説明になり、直せるものを示さない）
4. **保管する直前に、サニタイズ後の実バイト長を測り直し、上限と容量の両方をその値に当てる**。`UploadValidationPolicy.limitFor("media", mimeType)` を超えていれば `BusinessRuleError(FileTooLarge)`、`ensureUploadAllowed`（Usage のユースケース、`llmCalls: 0`）が容量の残量で拒めば `BusinessRuleError(StorageQuotaExceeded)` で返す。手順 2 が測ったのは受け取ったバイト列で、手順 3 は SVG をそのバイト列とは別のものに書き換えるため、判定の対象と実際に保管される実体が食い違う。**容量に効くのも行に載るのもサニタイズ後の長さなので、上限も容量もその 1 つの値に当てる** — 受け取ったバイト列で容量を測ると、膨らむ SVG は残容量を超過でき、縮む SVG は要らない残量で拒まれる（`image/svg+xml` の上限が 128 KB である理由は [domains/storage.md](../domains/storage.md)）。**容量の門がサニタイズの後にあることは意図的である**: 手順 2 が SVG を 128 KB で縛り、`HtmlProcessor` が入力の形によらず自分の資源の上限を守るためサニタイズの費用は有界で、オブジェクトストレージへは 1 バイトも書いていない。そのうえで `ObjectStorage.put` し、`StoredFile.register` を保存する。`FileProvenance` は `{ purpose: "media", noteId, uploadedBy: userId }`。永続化した `noteId` が、孤児判定（`collectOrphanMedia`）と `note.purged` 後の回収（`deleteFilesForNote`）の手がかりになる
5. 手順 4 の transaction が失敗した場合は、手順 4 で置いたオブジェクトを消す。`storeSource` が孤児として回収に任せるのと違うのは、**メディアには回収の手掛かりになる行が残らない**ためである（`StoredFile` が保存されていないので `collectOrphanMedia` が見つけられない）。この後始末自体が失敗した場合は記録して元のエラーを投げる。**この補償が届かない窓がある**: `put` が返ったあと commit の前にプロセス／isolate が落ちると `catch` は走らず、行を持たないオブジェクトが恒久的に残る。行が無いので容量には計上されず鍵も配られないが、回収の手掛かりも無いため `collectOrphanMedia` も `deleteFilesByOwner` も永久に届かない。オブジェクトストレージ側の列挙を持つスライスへ handoff する既知の窓として置く
6. 配信用の URL を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未対応の形式・サイズ超過 | `BusinessRuleError(UnsupportedMimeType)` / `BusinessRuleError(FileTooLarge)` |
| アップロードされた SVG が単体の 1 文書として開けない（整形式でない・入れ子が 64 段を超える・breakout tag を含む） | `BusinessRuleError(UnsupportedMimeType)` |
| サニタイズ後の SVG が単体の 1 文書にならない | `BusinessRuleError(UnsupportedMimeType)` |
| サニタイズが `HtmlProcessor` の資源の上限（[ADR 013](../adr/013-html-sanitization-policy.md)）を超える SVG | `BusinessRuleError(FileTooLarge)`（`NOTE_HTML_TOO_COMPLEX` を翻訳する） |
| サニタイズ後の本文が `NoteHtml` の長さの上限を超える SVG | `BusinessRuleError(FileTooLarge)`（`NOTE_CONTENT_TOO_LARGE` を翻訳する。資源のメーターはエスケープ前の長さを課金するので、直列化で 6 倍に伸びる入力はメーターに掛からずここへ届く） |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| ノート不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| ノートがゴミ箱にある | `BusinessRuleError(NoteIsTrashed)` |
| 保管の失敗 | `SystemError(ExternalServiceError)` |

## storeAvatar

### 概要

利用者・ワークスペースのアイコンを保管する（AC-07 / WS-07）。

### 入力DTO

`userId`, `subjectType: "user" | "workspace"`, `subjectId`, `fileName`, `body`

**入力から宣言値を落とす**（宣言 MIME も宣言サイズも受けない）。サイズは実バイト長、型は先頭バイトの署名から決め、申告値を保管する経路を型から消す（[ADR 050](../adr/050-upload-acceptance-from-bytes.md) の決定 1）。

### 出力DTO

`fileId`, `url: string`

### 処理フロー

1. ワークスペースの場合は `manageWorkspace` の権限を確認する。利用者の場合は本人であることを確認する
2. `UploadValidationPolicy.ensureAcceptable({ purpose: "avatar", ... })` を呼ぶ
3. `ObjectStorage.put` し、`StoredFile.register` を作る。`FileProvenance` は `{ purpose: "avatar", noteId: null, uploadedBy: userId }`
4. `UnitOfWorkProvider.run` で新しいアイコンを保存し、既存のアイコンがあれば**同じ UoW で**「保管ファイルの削除手順」（下記 `deleteFiles`）を実行する。イベントはまとめて収集する。差し替えの前後で消費量が二重に計上されたまま残る状態を作らないため

ワークスペースを主体とする場合、手順 4 の transaction の先頭で `manageWorkspace` を**読み直して**再確認する（[usecases/workspace.md](./workspace.md) 冒頭の規則）。手順 1 は R2 へ 1 バイトも書く前に権限の無い要求を落とす早期拒否であって、判定の正本ではない。削除受理済みのワークスペースへの書き込みは同じ transaction の `assertWritable` が `ConflictError("WORKSPACE_DELETING")` で止める。

**クォータを検査しないこと**。このユースケースは `ensureUploadAllowed`（Usage）を呼ばない。一方でアイコンは容量の集計に算入される（除外されるのは `purpose: "artifact"` だけ。[domains/usage.md](../domains/usage.md)）ため検査と算入が非対称になるが、意図的な扱いである。アイコンは 5 MB 上限（[domains/storage.md](../domains/storage.md) の `UploadValidationPolicy`）で、差し替えのたびに手順 4 が旧アイコンを消すため主体あたり 1 枚しか積み上がらず、際限なく増えていく取り込み（`storeUpload` / `storeMedia`）とは性質が違う。逆に検査すると、容量が上限に達した利用者は消費量を増やさない差し替えまで塞がれる。算入するのは、増分集計と棚卸し（`recalculateStorageUsage` の `sumSizeByOwner`）が同じ除外条件で一致している必要があるためで、算入しない側に倒すと除外条件が 2 つに増える。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 形式・サイズの違反 | `BusinessRuleError` |
| 権限不足（要求の処理中に降格・除名された場合を含む） | `BusinessRuleError(InsufficientRole)` |
| ワークスペースが存在しない | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| ワークスペースが削除を受理済み | `ConflictError("WORKSPACE_DELETING")` |
| 容量の上限到達 | 検査しない（上記） |

## issueDownloadUrl

### 概要

保管ファイル（元ファイル・生成物）の期限付きダウンロード URL を発行する。本人（または所有ワークスペースで権限を持つメンバー）の取得だけを扱う。匿名の閲覧者による生成物のダウンロードは、Note 側の `downloadExportArtifact`（ExportTicket 経由。[usecases/note.md](./note.md)、[ADR 010](../adr/010-anonymous-export-and-ticket.md)）が担う。

### 入力DTO

`userId`, `storageScopeType: "user" | "workspace"`, `storageScopeId`, `fileId`, `expiresInMs: number`

### 出力DTO

`url: string`, `fileName: string`, `expiresAt: Date`

### 処理フロー

1. 入力のstorage ScopeKeyから1つのscope objectを決め、current scopeの`StoredFileRepository.findById`で引く。別scopeのfileIdは存在を漏らさずnot foundとし、全scope探索やfile routeは行わない
2. 所有者が利用者本人か、所有ワークスペースで `downloadNote` の権限があるかを確認する
3. `EphemeralFile` で期限を過ぎていれば `NotFoundError("ARTIFACT_EXPIRED")`
4. `ObjectStorage.createDownloadUrl` を返す。`expiresInMs` の既定は **5 分**で、正典は [platform/index.md](../platform/index.md) の「転送境界」。入力DTO で受け取るのは配備ごとの上書きのためであり、値そのものを呼び出し側が自由に選んでよいという意味ではない（`exportNote` の再利用の下限 35 分がこの値に乗っている。[usecases/note.md](./note.md)）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ファイル不在・権限なし | `NotFoundError("STORED_FILE_NOT_FOUND")` |
| 生成物の期限切れ | `NotFoundError("ARTIFACT_EXPIRED")` |

## importExternalReferences

### 概要

本文中の外部リソースを取得して保管し、参照先を差し替える（IM-05）。ただし外部スタイルシートだけは差し替えではなく、取得した CSS を本文に `<style>` として**インライン化**する（[ADR 013](../adr/013-html-sanitization-policy.md)）。参照取り込みジョブ（`kind: "referenceImport"`、`target: { type: "note", noteId }`）から呼ばれる。

このユースケースはジョブを登録しない。`referenceImport` ジョブを登録するのは `updateNoteBody`（[usecases/note.md](./note.md)）と `runConversion` / `runRegeneration`（[usecases/conversion.md](./conversion.md)）で、いずれも `scope` を**対象ノートの所有文脈**から導出する（[domains/job.md](../domains/job.md) の `JobScope` の導出規則）。ここで保管する参照ファイル（`purpose: "reference"`）の `StorageOwner` も同じノートの所有文脈になるため、ジョブの `scope` と保管ファイルの帰属は一致する。`scope` は登録時点で決まり、このユースケースは書き換えない。

run 系の共通規則（[usecases/job.md](./job.md)）の判定順に対する唯一の例外である。`Job.start` は `total`（取り込む参照の件数）を要求するが、その件数は本文を読んで参照を抽出するまで確定しない。そのため判定 1・2（終端済み・リース有効の除外）は先頭で行い、判定 3 の `Job.start` だけを本文の抽出後（手順 4）へ後ろ倒しする。他の run 系ユースケースは `total` を入力か登録時の payload から得られるためこの例外を要さない。

**サニタイズはこのユースケースより前に済んでいる**。取り込みが読むのは、`runConversion` / `runRegeneration` / `updateNoteBody` が `HtmlProcessor.process` を通して保存した後の本文である。サニタイズは許可リスト方式であり `link rel=stylesheet` は許可されない（[ADR 013](../adr/013-html-sanitization-policy.md)）ため、このユースケースが動く時点で `<link>` は本文に残っていない。そこで `HtmlProcessor.process` は `<link rel="stylesheet" href="…">` を**同じ位置の空の `<style data-stylesheet-href="元の URL">` に置き換え**、除去の事実を `removed` に報告する（`style` 要素と `data-*` 属性はいずれも許可リストの内側にある。[domains/note.md](../domains/note.md)）。このユースケースが取り込むのはこの痕跡であり、元の位置を保つのは CSS のカスケード順が `<link>` の並びに依存するためである。痕跡は `data-*` 属性に URL を持つ通常の要素なので、`ExternalReference`（`{ url, attribute, elementName }` という属性ベースの形）のまま抽出できる。

**取得の結果は痕跡の属性名に書く**（[ADR 014](../adr/014-import-result-provenance.md)）。取得できた痕跡は `data-imported-stylesheet` に、取得できなかった痕跡は `data-stylesheet-unavailable` に付け替える。抽出の対象は `data-stylesheet-href` だけなので、どちらに遷移しても再抽出されない。取得できなかった痕跡を要素ごと取り除かないのは、それが「この URL のスタイルシートを取り込めず装飾を失った」という事実の唯一の記録になるからである（本文以外にこれを語れる場所がない。ジョブは要求者本人にしか見えず保持期間で消える）。

逆向きの順序も守る。**取得した CSS も本文に入る前にサニタイズ規則を通す**（手順 7）。外部から取得した内容を検査せずに本文へ書き込む経路は作らない。

**取得は同時 6 本を超えて並行させない**。実行環境が同時に応答待ちにできる外部接続は 6 本までである（[platform/index.md](../platform/index.md)）。`FetchBudget.maxCount`（200）まで取りにいく場合も 6 本ずつ進める。サブリクエストの総数（10,000）には余裕があるため、上限になるのは同時接続数だけである。

### 入力DTO

`noteId`, `userId`, `jobId`

キューが運ぶのは `jobId` と `kind` だけなので、`noteId` と `userId` は呼び出し側（ジョブのディスパッチャー）が `JobRepository.findById(jobId)` で引いた行から取る — `noteId` は `job.target`（`{ type: "note", noteId }`）、`userId` は `job.requestedBy`（`referenceImport` は匿名ジョブになりえないため必ず非 `null`。[domains/job.md](../domains/job.md) の `JobAttribution`）。保管する参照ファイルの `uploadedBy` に入るのはこの要求者であり、実行時点の誰かではない。

### 出力DTO

`importedCount: number`, `inlinedStylesheetCount: number`, `failed: { url: string; kind: "resource" | "stylesheet"; reason: ReferenceFailureReason }[]`, `skipped: number`

`importedCount` は保管して差し替えたリソースの件数、`inlinedStylesheetCount` はインライン化できたスタイルシートの件数である。分けて返すのは、失敗したときに利用者に伝わる内容が違うため — リソースは元の URL のまま表示され続けるが、スタイルシートは装飾そのものが失われる（IM-05）。`failed` の `kind` はその区別を表す。

**この出力 DTO は呼び出し元（ジョブのディスパッチャー）が受け取るだけで、利用者には届かない**。利用者に見せる経路は本文と `ReferenceImportRecordRepository` の記録であり、ノート詳細（`getNote` の `references`。[usecases/note.md](./note.md)）が合成する。両者は同じ実行から作られるので食い違わない。

### 処理フロー

1. `JobRepository.findById` で引く。終端状態なら何もせず返す（同じジョブを 2 回受け取っても結果が変わらない）。リース有効の `running` も何もせず返す（run 系の共通規則。[usecases/job.md](./job.md)）
2. ノートを引く。不在なら `Job.fail(reason: "targetMissing")` として終了する
3. 本文が `ready` なら `HtmlProcessor.extractExternalReferences(html)` で参照を集め、`StorageUrlPolicy.isInternal`（[domains/storage.md](../domains/storage.md)）が真のものを落とす（`ready` でなければ 0 件として扱う）。抽出はサービス内のストレージを指す URL も返すため、この絞り込みは呼び出し側の責務である。スタイルシートの痕跡（`elementName: "style"`、`attribute: "data-stylesheet-href"`）も同じ抽出に現れる
4. 参照の件数を `total` として `Job.start(job, total, now, leaseUntil)` を保存する（0 件なら何も取り込まず手順 10 の `Job.succeed` で終端する）
5. 各参照について。**種別によって取得後の扱いが分かれる**が、取得までの検査は共通である
   - 既にサービス内のストレージを指すものは飛ばす（`skipped`）。この判定はリソース参照にのみ適用する — スタイルシートの痕跡は飛ばしても本文に空の `<style>` が残るだけで装飾にならないため、取得元がどこであれ次に進む
   - `ExternalFetchPolicy.ensureFetchable(url)` と `ensureWithinBudget` を呼ぶ。スタイルシートも 1 件として数え、SSRF 対策も予算（件数・合計サイズ・タイムアウト）の扱いもリソース参照と同じにする
   - **リソース参照**（画像・動画・音声など、`src` / `srcset` / `poster` といった属性が指すもの）: `RemoteResourceFetcher.fetch` で取得し、`ObjectStorage.put` と `StoredFile.register` で保管する。`limits` は `ExternalFetchPolicy.budget()` から作る（`timeoutMs` は `perItemTimeoutMs`、`maxBytes` は `maxTotalBytes` の残り）。`FileProvenance` は `{ purpose: "reference", noteId, uploadedBy: userId }`。元の URL と保管先の URL の対応を差し替え表に積む
   - **スタイルシート**（`<style data-stylesheet-href>` の痕跡）: 同じ `limits` で CSS を取得し、テキストとして読む。**保管はしない**（`ObjectStorage.put` も `StoredFile.register` も行わない）— 内容が本文の一部になるため、保管すると同じ CSS を本文と保管ファイルで二重に持ち、どこからも参照されない `purpose: "reference"` のファイルが `collectOrphanMedia` の対象にもならないまま残る。読んだ CSS の中の相対 URL は、**取得元のスタイルシートの URL を基準に絶対 URL へ解決してから**インライン化表に積む（インライン化すると相対 URL の基準が本文の文書へ移り、解決先が変わって装飾が壊れるため）
   - 失敗した参照は理由を記録する（`failed`）。リソース参照は**元の URL のまま残る**が、スタイルシートは元の URL のまま残せない — `<link>` は既に本文になく、残せるのは空の痕跡だけである。痕跡は `data-stylesheet-unavailable` に付け替えて空のまま残し、その装飾は失われる。予算超過で取得に至らなかった痕跡も同じ扱いにする。**取り除かない**のは、これが装飾を失った事実の唯一の記録になるためで、抽出の対象が `data-stylesheet-href` に限られる以上、残しても再登録は起きない（[ADR 014](../adr/014-import-result-provenance.md)）
6. 本文を書き換える。リソース参照は `HtmlProcessor.rewriteReferences(html, replacements)` で参照先を差し替え、スタイルシートは `HtmlProcessor.inlineStylesheets(html, contents, unavailable)` で痕跡を遷移させる（`contents` に載せた URL は `data-imported-stylesheet` として CSS を内容に持ち、`unavailable` に載せた URL は `data-stylesheet-unavailable` として空のまま残る）。`rewriteReferences` は URL を URL に写す差し替えなので、内容の埋め込みには使えない（`inlineStylesheets` は [domains/note.md](../domains/note.md) の `HtmlProcessor` に要る操作である）
7. 書き換えた本文を `HtmlProcessor.process` に通し、その `ProcessedHtml` を `Note.updateBody` に渡して保存する（版は作らない）。インライン化した CSS が `position: fixed` / `position: sticky` / `@import` を含んでいれば、ここで宣言単位に落ちる（[ADR 013](../adr/013-html-sanitization-policy.md)）。落ちた宣言は `ProcessedHtml.removed`（`kind: "css"`）に現れる。**これをプロパティ名ごとに件数へ畳んで `ReferenceImportSummary.removedCss` に書く**（ジョブの `detail` には書かない。`detail` は運用者向けであり、`failure` を持たない成功したジョブには存在しない）。1 つの違反で本文全体の装飾を捨てないのは ADR 013 の規則どおりで、このユースケースはスタイルシート単位でも捨てない
8. 進捗は `Job.reportProgress` で更新する（リースの延長を兼ねる）
9. 取得記録を書く。手順 5 で扱った参照 1 件につき `ReferenceAttempt` を 1 件作り（`outcome` は `imported` / `inlined` / `failed` / `notAttempted`）、`ReferenceImportRecordRepository.saveAttempts` で `(noteId, url)` を鍵に上書きする。あわせて手順 7 の `removedCss` を `putSummary` で書く。**この実行が触れなかった URL の記録は消さない** — 前回失敗した参照に今回手が届かなかった場合、その理由が消えてはならない
10. `Job.succeed(job, null, [], now)` を保存する（申し送りはない）。本文の保存・取得記録の書き込み・ジョブの更新は同一の `UnitOfWorkProvider.run` で行い、イベントをまとめて収集する

**`styleMode` は再判定しない**。手順 7 の `Note.updateBody` は `content` だけを更新し `styleMode` を触らない（`styleMode` を変えるのは `changeStyleMode` だけである。[domains/note.md](../domains/note.md)）。インライン化で本文に `<style>` が加わるため手順 7 の `ProcessedHtml.hasDecoration` は真になるが、この値をここで使ってはならない。理由は 2 つある。

- **判定は取り込みの前に済んでいる**。`hasDecoration` はサニタイズで除去する前の入力に対して求められ、除去された `link rel=stylesheet` も装飾の痕跡として数える（[ADR 013](../adr/013-html-sanitization-policy.md) / [ADR 007](../adr/007-default-style-isolation.md)）。外部スタイルシートを持っていた本文は変換の時点で既に `preserve` と判定されており、インライン化は同じ根拠を作り直しているにすぎない
- **利用者の設定を上書きしない**。判定結果はノートごとの設定として後から切り替えられる（[ADR 007](../adr/007-default-style-isolation.md)）。参照取り込みは利用者の操作ではなく後から走るジョブなので、ここで再判定すると `preserve` から `default` に戻した設定をジョブが押し戻すことになる

スタイルシートの取得にすべて失敗して装飾が何も残らなかった場合も `styleMode` は `preserve` のままになる。既定スタイルを当て直したい利用者はノート詳細の切り替え（ADR 007）で `default` にできる。この切り替えを残しているのは、まさに自動判定が実態と食い違いうるためである。

**インライン化した CSS の中の `url()` は取り込まない**。背景画像やフォントを指す `url()` は絶対 URL に解決されたうえで**元の URL のまま残り**、表示のたびに外部から取得される。取り込みの対象にしないのは、`ExternalReference` が `{ url, attribute, elementName }` という属性ベースの形（[domains/note.md](../domains/note.md)）であり、宣言値の中の `url()` を構造上指せないためである。指せる形に広げるには参照の表現そのものを変えることになり、それは「この穴は塞がらないものとし、公開ページの CSP の `style-src` / `img-src` / `font-src` で受ける」という [ADR 013](../adr/013-html-sanitization-policy.md) の決定を越える。したがって手順 5 で `url()` に対して行うのは基準 URL の解決だけで、取得も保管も差し替えもせず、件数・合計サイズの予算にも数えない（取得しないため）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが不在 | `Job.fail("targetMissing")` |
| リソース参照の取得失敗（404・タイムアウト・認証必要） | 記録して継続。元の URL のまま残り、`ReferenceAttempt` に `failed` を書く |
| スタイルシートの取得失敗（404・タイムアウト・認証必要） | 記録して継続。痕跡を `data-stylesheet-unavailable` に付け替えて空のまま残し、その装飾は失われる（元の URL を `<link>` として戻す選択肢はない。[ADR 013](../adr/013-html-sanitization-policy.md)） |
| 取得した CSS が禁じた宣言・規則（`position: fixed` / `position: sticky` / `@import`）を含む | 手順 7 の走査が宣言単位で落とし、残りはインライン化されたまま成功として扱う。落ちた宣言は `ReferenceImportSummary.removedCss` に畳んで残る |
| 拒否された URL（内部アドレス等） | 記録して継続（`failed` の `reason: "refusedUrl"`） |
| 予算超過 | 以降の取得を打ち切り、件数を記録して成功として返す。打ち切られた参照は `ReferenceAttempt` に `notAttempted` を書く。スタイルシートの痕跡は `data-stylesheet-unavailable` にする |
| 本文の保存で版が競合 | 1 度だけ読み直して再適用し、それでも競合すれば `ConflictError` |
| ジョブ保存の版の競合（実行中に外部から強制終端された） | 読み直して終端済みなら、本文の書き換えごと同一 UoW でロールバックされているため取り込み結果を破棄して成功として返し、未終端なら `ConflictError` を投げて再配送に委ねる（run 系の共通規則の判定 4）。保管済みの参照ファイルは本文から参照されないまま残り、ノートの完全削除時に `deleteFilesForNote` が回収する |

## deleteFiles

### 概要

保管ファイルのメタデータを削除し、実体の回収をイベントに委ねる。

### 入力DTO

`fileIds: string[]`, `deletionOperationId: string | null`（既定null）

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `UnitOfWorkProvider.run` を開き、その中で下記の**保管ファイルの削除手順**を実行する
2. 実体の削除は `storage.fileDeleted` を購読する `deleteStoredObjects` に委ねる

### 共有手順: 保管ファイルの削除

削除そのものは、UoW のコンテキストを引数に取り自分では `UnitOfWorkProvider.run` を開かない**共有手順**として定義する（[usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」）。

1. `StoredFileRepository.listByIds(fileIds)` で引く（既に不在のものは結果に現れないだけで、エラーにしない）
2. 各件を削除し、`StorageEvents.fileDeleted` を収集する（`objectKey`と呼び出し元の`deletionOperationId`を含める）

`deleteFiles` ユースケースは「UoW を開いてこの手順を実行するだけ」の薄い入口であり、他の書き込みと同一トランザクションで消したい呼び出し元は、`deleteFiles` を呼ばずに自分の UoW の中でこの手順を実行する。

- ジョブの強制終端の後始末（[usecases/job.md](./job.md) の「共通: 強制終端の後始末」。共有手順 `finalizeTerminatedJobs` がこの手順を自分の `ctx` で実行する）。ジョブの終端・`processing` のノートの回復と同一 UoW で生成物を破棄する必要があるため、必ずこの形になる。各経路の「`deleteFiles` で回収する（同一 UoW）」という記述はこの手順の実行を指す
- batch 親を開き直すときの ZIP の破棄（[usecases/job.md](./job.md) の「親を開き直すときの生成物の破棄」。`retryFailedChildren` / `retryJob` が `Job.reopenBatch` と同一 UoW で実行する）
- `storeAvatar`（新しいアイコンの保存と旧アイコンの削除）

自分の UoW を持たない呼び出し元（`collectExpiredArtifacts` / `collectOrphanMedia` / `deleteFilesForNote` / `deleteFilesByOwner`）は `deleteFiles` ユースケースをそのまま呼んでよい。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 一部が既に不在 | 無視して継続 |

## deleteStoredObjects

### 概要

`storage.fileDeleted` を購読し、オブジェクトストレージ上の実体を回収する。メタデータの削除とオブジェクトの削除を同一トランザクションにできないため、メタデータを先に消して実体を後から消す（[domains/storage.md](../domains/storage.md)）。イベント購読ワーカーから呼ばれる。

### 入力DTO

`events: { fileId: string; objectKey: string }[]`（1 回の配送で受け取った `storage.fileDeleted` のまとまり。`fileId` は記録用）

### 出力DTO

`deletedCount: number`, `failed: { objectKey: string; reason: string }[]`

### 処理フロー

1. イベントから `objectKey` を集める
2. `ObjectStorage.deleteMany(keys)` を呼ぶ。実体が既にない鍵は成功として扱う
3. 失敗した鍵は記録して残りを続け、`failed` に積む。1 件でも失敗が残ればイベントを未処理として返し、再配送に委ねる

このユースケースは `IdempotencyStore` による重複排除を行わない。鍵を指定した削除は本質的に冪等（存在しない鍵の削除は成功）であり、加算・減算を伴う集計の購読者（`applyStorageDelta`）とは事情が異なる。むしろ外部ストレージへの書き込みは UoW に入れられないため、先に処理済みを記録すると削除に失敗したイベントが再配送で弾かれ、実体が永久に残る。重複配送で 2 回消えても結果は変わらないので、記録を持たないほうが安全側に倒れる。

削除に失敗し続けた実体は孤児オブジェクトとして残る。メタデータが存在しないので容量にも列挙にも現れないが、**公開配信する purpose（`avatar` / `media`）では鍵を知っている閲覧者に配られ続ける** — 配信口が引くのはオブジェクトストレージだけだからである（[domains/storage.md](../domains/storage.md)）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 実体が既に不在 | 成功として扱う |
| 一部の鍵の削除が失敗 | 記録して残りを続け、イベントを未処理として返す（再配送で再試行される） |
| オブジェクトストレージの通信・権限の失敗 | `SystemError(ExternalServiceError)`（再配送に委ねる） |

## collectExpiredArtifacts

### 概要

期限を過ぎた生成物を回収する。`registerEphemeral` が当該 scope の最小 `expiresAt` を `scheduled_tasks` に upsertし、その scope object の Alarm から呼ばれる。

### 入力DTO

`limit: number`（既定100。1 Alarm turnのCPU時間と `storage.fileDeleted` fan-outを有界にする値）

### 出力DTO

`collectedCount: number`

### 処理フロー

1. `StoredFileRepository.listExpired(now, limit)` を引く
2. `deleteFiles` を呼んで削除する

`limit` 件に達したら同じtaskを直後に再設定し、未満なら次の `expiresAt` にAlarmを合わせる。global Cronはscope objectを列挙しない。

### エラーケース

個々の失敗は記録して継続。

## collectOrphanMedia

### 概要

作成から 30 日が経過し、本文から参照されていないメディアを回収する。scopeにmediaが**初めて流入する**とき（`storeMedia` の保管、および `relocateFilesForNote` の `stageTarget` が運ぶ移動）に日次taskを自己登録し、そのscope objectのAlarmから呼ぶ。参照が外れた時刻は保持しないため、起点は作成時刻に取る（[domains/storage.md](../domains/storage.md) の `FilePurpose`）。

### 入力DTO

`scope: ScopeKey`, `limit: number`（既定100。1 turn が**読む行数**の上限で、`storage.fileDeleted` の発行量もこれで有界にする。CPU の上限はこの値では決まらない — 費用がかかるのは本文解析で、その回数はページに載るファイル数ではなく**ノート数**に従うため（手順 2））, `cursor: StoredFilePurposeCursor | null`（既定 `null`。前の turn が止まったキーセット位置で、`null` は scope の最も古い media から始める）

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `collectedCount` | `number` |
| `nextCursor` | `StoredFilePurposeCursor \| null` |

`nextCursor` は次の turn が再開する位置。走査し切って日次へ戻る turn は `null` を返すので、呼び手は継続が要るかどうかを `collectedCount` から推測せずに観測できる。turn 全体が失敗した turn は `null` ではなく**開始位置をそのまま返す**（エラーケース表）。

### 処理フロー

1. current scope の `StoredFileRepository.listByPurposeOlderThan("media", now - 30 日, limit, cursor)` で走査する。scope内では所有者を絞らないため、所有者を必須とする `listByOwner` ではなくこのクエリを使う（`stored_files_purpose_created_idx` に対応）。`cursor` はその順序上の位置を**排他的**に指し、位置は行ではないので、その行が既に消えていても解決する — 掃引は読んだページの一部を消すのが常態だからである
2. 各ファイルの `noteId` から所属ノートを引き、**現在の本文と保持している版（`NoteRevision.RETENTION` 件）の本文**に当該ファイルの URL が現れるかを `HtmlProcessor.extractExternalReferences` で調べる。版の本文も参照元に数えるのは、`restoreNoteRevision` が復元できる版が指すメディアを回収すると、復元は成功して画像だけが 404 になるためである（回収の起点は作成時刻なので、本文から外して 30 日経てば版はまだ生きている）。読み取りはファイル単位ではなく**ノート単位**にして 1 turn のあいだ持ち回る — 1 ページは 1 つのノートの画像であることが普通なので、版の数だけ本文解析が増えるのをこれで抑える（`media` の `FileProvenance` は `noteId` を必須で持つため、所属の解決に本文の逆引きは要らない）。持ち回りはそれ自体が上限ではない（ページがファイル数と同じ数のノートに散れば何も再利用されない）ので、**1 turn が本文を読むノート数にも上限を置く（5 件）**。ノート 1 件あたりの解析は現在の本文＋保持中の版で最大 `RETENTION + 1` 本になるため、この上限が 1 turn の解析回数を 105 本 — 版を数えるようになる前の「1 候補につき 1 解析」と同じ桁 — に抑える。上限に達したらそのページの残りは読まず、**判定し終えた最後の行を位置にして直後の継続を張る**（位置が前進するので取りこぼしにはならず、後回しになるだけ）。**ここでは `StorageUrlPolicy.isInternal` で絞らない** — 探しているのはサービス内のストレージを指す URL そのものだからである。このポートが「外部」参照だけを返すのではなく本文中の属性ベースの URL 参照をすべて返すこと（[domains/note.md](../domains/note.md)）が、この経路の前提になっている
3. 現れないものを `deleteFiles` で削除する

処理後は翌日のtaskを自己登録する。**ページが満ちたとき（またはノート数の上限でページを読み切らずに打ち切ったとき）は残件を先に処理するため直後にも継続taskを設定し**、判定し終えた最後の行の `(createdAt, id)` を位置として task の payload に載せる。完了後に日次へ戻す。継続の条件は「回収できたか」ではなく「まだ検査していない行が残っているか（満ページ、またはノート数の上限で打ち切ったか）」である — 掃引は残すと決めた行をそのまま残すので、回収数を条件にすると、最も古い `limit` 件がすべて本文から参照されている scope（稼働中なら普通の状態）で毎日同じページを読み直し、その後ろの孤児が 1 度も検査されない。カーソルが毎回厳密に前進するので、満ページで直後を張っても spin にはならない。位置を task の payload に置くのは、payload が `(kind, operationId)` の upsert で掃引行そのものと一緒に書かれ、位置の寿命が掃引行の寿命と一致するためである。**読めない payload は失敗させず、先頭からやり直す** — 位置は周期的な全走査の再開位置でしかなく、先頭から読み直せば作業は重複するが取りこぼしはない。逆に失敗させると backoff が回り、上限で scope 唯一の掃引行が `failed` に駐車されて、掃引は自分を張り直せないためその scope の回収が二度と動かなくなる。走査中に 30 日境界を跨いだ行はカーソルの後ろに現れうるので、そのパスでは拾わず翌日の先頭からの走査で拾う。大量の低優先media taskがsecurity cleanupを妨げないようpriorityは期限回収（3）とする。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `noteId` の指す所属ノートが既に削除済み | 削除対象として扱う |
| 個々の失敗（1 ファイルの判定・削除） | 記録して継続 |
| turn 全体の失敗 | 記録して翌日の掃引を張り直し、`collectedCount: 0` で正常終了する。`backoff` を回して scope 唯一の掃引行を上限で `failed` に駐車させないためで、張り直し自体が失敗したときだけ throw する。**張り直す payload には開始位置を残し**、`nextCursor` にも同じ位置を返す — 位置を捨てると次の turn が先頭へ戻り、恒久的に失敗するページを毎日読み直してその後ろへ永久に到達しなくなる |

## relocateFilesForNote

### 概要

move Saga のsnapshot / stagingでStoredFile metadataを別scopeへ移送する内部command。R2 bytesは移動せず、`note.moved` の購読者でもない。

### 入力DTO

`migrationId`, `phase: "snapshotSource" | "stageTarget" | "retireSource"`, `noteId`, `owner`（束縛されている scope が行を持っている側の owner）, `targetOwner`（staged 行を登録する owner）, `files?: readonly MovedFileMetadata[]`, `now`

### 出力DTO

`relocatedCount: number`, `files: readonly MovedFileMetadata[]`

`files` は `snapshotSource` が凍結した snapshot 本体で、他の phase では空である。この戻り値がサガへ渡る snapshot の唯一の経路なので、実装詳細ではなく契約の一部にあたる。

### 処理フロー

1. `snapshotSource` はsource scopeの `source` / `media` / `reference` metadataを列挙する。artifactはJob scopeに残しTTLで回収する
2. `stageTarget` は同じobject keyを指すmetadataをtarget ownerで登録する。R2 copyと `storage.fileOwnerChanged` は発行しない
3. `retireSource` はroute切替後にsource metadataを削除するが、R2 delete eventは発行しない（target metadataが同じkeyを参照中）
4. 各phaseは `migrationId + phase` で重複排除し、応答喪失時も二重metadataやR2削除を作らない
5. 重複排除の記録は「この phase の行が置かれている」という主張なので、その phase を**打ち消す**呼び出し側は同じ transaction でその記録も消す（`clearApplied`）。残したまま同じ migration ID で再開すると、戻したはずの staging を飛ばして空の target へ素通りし、その先の route 切替が何も無い場所を指す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象のファイルがない（ノートが既に完全削除済みなど） | 何もせず成功として返る |
| 版が競合する | 各 phase は読みと書きを同じ transaction に置くので、囲っている transaction の中では起きえない。競合が観測されるのは transaction ごとの再適用のときで、そこは `AppliedOperationStore` の receipt が二重適用を止める |

## deleteFilesForNote

### 概要

ノートの完全削除に伴って、そのノートに属する保管ファイルを回収する（`note.purged` の購読）。

### 入力DTO

`noteId`, `deletionOperationId: string | null`（`note.purged`から引き継ぐ）

### 出力DTO

`deletedCount: number`

### 処理フロー

1. `deletionOperationId`が非nullなら各turnで**同じ operation の receipt が current scope にあること**を確認し（`ScopeCleanupAdmissionStore.describePersonalCleanup` で引き、`running` でも `completed` でも通す。別 operation・不在・abort 済み・prune 済みは `ConflictError("CLEANUP_OPERATION_MISMATCH")`）、`StoredFileRepository.listDeletableByNote(noteId, 100)` で `purpose` が `source` / `media` / `reference` のファイルを最大100件列挙する。`artifact` は対象にしない
2. `deleteFiles(fileIds, deletionOperationId)` を呼んで削除する（各`storage.fileDeleted`へ同じtokenを引き継ぐ）
3. **列挙したページが 100 件なら**同じUoWで`storage.noteDeleteContinued { noteId, deletionOperationId }`を再登録する。判断の主語は `listDeletableByNote` が返した件数であって削除できた件数ではない — 別の turn が先に消した行はページを縮めずに削除数だけを縮めるので、削除数で判断すると残りがあるのに継続が止まる（tag / integration は行そのものを消すので両者が一致し、この曖昧さがない）。100件未満になったturnから`ReferenceImportRecordRepository.deleteByNote(noteId, 100)`で取得記録と要約を最大100件ずつ消し、100件なら同じtaskを再登録する（[ADR 014](../adr/014-import-result-provenance.md)）
4. 両集合が100件未満になったときだけ、同じUoWで`storage.noteDeleteContinued`の継続task行を`ScopeTaskScheduler.complete`する — これが継続の連鎖を止める唯一の手段で、呼ばなければ scope-task runner が同じ行を claim し続ける。削除済み行は次回に現れず、同じoperation/tokenで再実行しても結果は変わらない（冪等）

手順 1 で `assertOwner` を使わないのは、それが完了済みの障壁を拒否する述語だからである。障壁を完了させるのは Note 自身の ack で、その ack が待った purge の `note.purged` はリレーがそのあと配送するため、完了と fan-out は必ず競合する。完了済みを通してよいのは、この追随者が receipt に触れず purge 済みノートの行を消すだけだからである（`deleteFilesByOwner` のように障壁へ ack する経路は `assertOwner` のまま）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象のファイルが 1 件もない | 何もせず成功として返る |
| 一部が既に不在 | 無視して継続 |

## deleteFilesByOwner

### 概要

scope cleanup commandに従って所有file metadataを回収する。継続はcurrent scopeの `scheduled_tasks` / Alarmで行う。

### 入力DTO

`deletionOperationId`, `scope: ScopeKey`, `batchSize: number`（既定・最大100）

### 出力DTO

`ScopeCleanupTurn & { deletedCount: number }` — `status: "settled" | "continued" | "stalled" | "alreadyApplied"`, `personalCleanupCompleted: boolean`, `deletedCount: number`

件数だけを返さないのは、下の手順が「残りがあれば継続要求を 1 件だけ積む」「対象が残っているのに 1 件も削除できなかった場合は継続を積まず backoff する」「再配送された command は何もせずに終わる」という**呼び出し側が知らなければ制御できない分岐**を定めているためである。`continued` を返した turn は自分の task 行を積み直しているので、その行を掴んだ実行者はそれを settle してはならない。`personalCleanupCompleted` は、この turn の ack が personal barrier を閉じたかどうかを global 側の受領へ伝える。

### 処理フロー

1. 入力`scope`から`StorageOwner`を組み立てる。各UoW前に`ScopeCleanupAdmissionStore.assertOwner(deletionOperationId)`を呼び、`StoredFileRepository.listByOwner` を `batchSize` 件読んで`deleteFiles(fileIds, deletionOperationId)`を呼ぶ
2. まだ残りがあれば、**継続要求 `storage.ownerDeleteContinued { scope, deletionOperationId }` を 1 件だけ**、その削除と同じ scope-local `UnitOfWorkProvider.run` の中で `scheduled_tasks` に積み、Alarm を再設定する。この継続要求の実行者は本ユースケースだけである
3. 対象が残っているのにそのバッチで 1 件も削除できなかった場合は新しい継続要求を積まず、現在taskをbackoffする。上限到達時は `failed` + global運用通知とする。**対象が 0 件だった場合はこれに当たらない** — 仕事が尽きた正常な終端なので、継続を積まずに成功として返る（[domains/index.md](../domains/index.md) の「継続要求」）

`batchSize` の既定 100 は、**1 回で発行するイベント数**を抑えるための上限である。`deleteFiles` はファイル 1 件につき `storage.fileDeleted` を出し、その購読者（`deleteStoredObjects`）が R2 の実体を消す。性能上の性質（1 turn の SQL 文数がバッチ件数に比例しないこと）はここでは扱わない — 実行基盤の設計目標として [platform/index.md](../platform/index.md) の `## 実行予算と分割単位` → `### Scope DO` に置き、全バックエンドに課す契約のほうは観測可能な性質として [testcases/storage/deleteFilesByOwner.md](../testcases/storage/deleteFilesByOwner.md) に置く（[ADR 056](../adr/056-performance-budget-placement.md)）。

冪等性: `IdempotencyStore` は使わない。削除済みのファイルは `listByOwner` に現れないため、同じイベントを 2 回受け取っても 2 回目は 0 件で終わる（`deleteFilesForNote` と同じ根拠。[domains/index.md](../domains/index.md) の「使わない」分類）。

継続要求があるため、重複配送では同じ所有者に対して 2 系列が並走しうる。並走しても結果は変わらない — 両系列とも「残っているものを読んで消す」だけで、同じファイルを両方が拾った場合は先に消したほうだけが `deleteFiles` の `listByIds` に載せ、遅れたほうは対象が消えているので 0 件で終わる（`storage.fileDeleted` も 1 件につき 1 回しか出ない）。終了条件も系列ごとに独立で、対象が 0 件になった系列から順に継続をやめる。カーソルを持たないのは、対象が処理するそばから消えるため先頭から読むだけで必ず前に進むからである（[domains/index.md](../domains/index.md) の「継続要求」）。

継続の形は `deleteNotesForOwner`（[usecases/note.md](./note.md)）と同一である — どちらも 1 バッチ処理して残りがあれば専用の継続要求を 1 件積む。

### エラーケース

個々の失敗は記録して継続。再実行しても結果は変わらない。
