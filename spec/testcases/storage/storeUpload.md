# テストケース: storeUpload

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 対応形式の Markdown ファイル | アップロードする | ファイルが保管され、ノートが `processing` で作られ、変換ジョブが登録される | |
| 画像ファイルで OpenRouter 未連携 | アップロードする | ノートが `awaitingIntegration` で作られ、変換ジョブも登録される（終端化は `runConversion` が行う） | |
| 画像ファイルで OpenRouter 連携済み | アップロードする | ノートが `processing` で作られ、変換ジョブが登録される | |
| 未対応の拡張子 | アップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられる | |
| 拡張子と内容が食い違う | アップロードする | 内容から判定した形式が使われる | |
| 51 MB の PDF | アップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| 50 MB の PDF | アップロードする | 成功する（境界値） | |
| パスワード保護された PDF | アップロードする | ノートが作られ、`content` が `failed(passwordProtected)` になる | |
| `planConversionForUpload` が `initialContent` を返した | ノートの作成を確認する | 返された `InitialContentState` をそのまま `Note.createFromUpload` の `initialContent` に渡し、状態と理由をここで組み立て直さない（`awaitingIntegration` と `failed` の区別も再判定しない） | |
| 方針が `processing` になる Markdown ファイル | 出力を確認する | `contentStatus: "processing"`、`contentFailureReason: null` が返る | |
| 画像ファイルで OpenRouter 未連携 | 出力を確認する | `contentStatus: "awaitingIntegration"`、`contentFailureReason: null` が返る | |
| `conversionPreference: "machineOnly"` で画像ファイル | 出力を確認する | `contentStatus: "failed"`、`contentFailureReason: "machineExtractionUnavailable"` が返り、画面は `auto` での取り込み直しを案内する | |
| 内容の判定で未対応形式と分かったファイル | 出力を確認する | `contentStatus: "failed"`、`contentFailureReason: "unsupportedFormat"` が返り、画面は形式が対象外である旨を案内する | |
| パスワード保護された PDF | 出力を確認する | `contentStatus: "failed"`、`contentFailureReason: "passwordProtected"` が返る | |
| 3 種の `failed` を返す取り込み | 画面の案内を比べる | `contentFailureReason` で案内が分かれる（`machineExtractionUnavailable` / `unsupportedFormat` / `passwordProtected`） | |
| 保存容量の残りが足りない | アップロードする | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| LLM 実行回数の残りがない画像 | アップロードする | `BusinessRuleError(LlmQuotaExceeded)` が投げられる。LLM 必須形式のため `machineOnly` での再取り込みは案内せず、翌月まで待つ案内になる | |
| LLM 実行回数の残りがない Word ファイル、OpenRouter 連携済み | アップロードする | `BusinessRuleError(LlmQuotaExceeded)` が投げられ、`conversionPreference: "machineOnly"` での再取り込みが案内される（機械的変換で取り込める形式） | |
| LLM 実行回数の残りがなく、方針が LLM を要さない Markdown ファイル | アップロードする | LLM 回数の検査は方針決定の後に行われるため掛からず、取り込みが成功する | |
| LLM 実行回数の残りがなく、未対応の拡張子 | アップロードする | 形式の検査が先に働き、`BusinessRuleError(UnsupportedMimeType)` が投げられる | |
| `conversionPreference: "machineOnly"` で Word ファイル、OpenRouter 連携済み | アップロードする | 連携があっても `capability.llm: "declined"` として扱われ、機械的変換（`textExtraction`）の方針になる | |
| `conversionPreference: "machineOnly"` で Word ファイル、LLM 実行回数の残りがない | アップロードする | 方針が LLM を要さないため検査に掛からず、取り込みが成功する | |
| `conversionPreference: "machineOnly"` で画像ファイル | アップロードする | `unavailable(machineExtractionUnavailable)` の方針になり、ノートが `failed(machineExtractionUnavailable)` で作られる（`awaitingIntegration` にはしない） | |
| `conversionPreference: "machineOnly"` で画像ファイル、OpenRouter 連携済み | アップロードする | 連携があっても結果は同じ `failed(machineExtractionUnavailable)` で、連携を促す案内は出ない | |
| `conversionPreference: "auto"`（既定）で Word ファイル、OpenRouter 連携済み | アップロードする | `textExtractionThenStructuring` の方針になる | |
| Drive の自動バックアップが有効 | アップロードする | バックアップジョブも登録される | |
| 自動バックアップが無効 | アップロードする | バックアップジョブは登録されない | |
| ワークスペースの viewer | アップロードする | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 公開ハンドル未設定の個人所有で `visibility: "public"` を指定する | アップロードする | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる。検査は保管を始める前に行われるため、オブジェクトストレージへの `put` もノートの作成も起きない | |
| 公開スラッグ未設定のワークスペース所有で `visibility: "public"` を指定する | アップロードする | 同じく保管前に `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる（検査の基準は所有者であり `createdBy` ではない） | |
| 公開ハンドル未設定で `visibility: "unlisted"` を指定する | アップロードする | 公開ハンドルを要さないため成功する | |
| 実バイト長が 3 MB の画像ファイル | アップロードする | 保管する型は先頭バイトの署名、サイズは実バイト長から決まる（`AcceptedUpload`）。宣言 MIME・宣言サイズを渡す経路は入力 DTO に無い | |
| オブジェクトストレージが失敗する | アップロードする | `SystemError(ExternalServiceError)` が投げられ、ノートは作られない | |
| 同名ファイルを 2 回アップロードする | アップロードする | 別のノートが 2 件作られる | |
| 同一内容のファイルを 2 回アップロードする | 保管記録を確認する | チェックサムによる重複保管の回避は行わず、ノートごとに別の `StoredFile` が作られる | |
| 取り込みに成功した | 保管記録を確認する | `purpose: "source"`、作られたノートの `noteId`、`uploadedBy: userId` が入っている | |
| 変換ジョブを登録した | ジョブの `target` と `payload` を確認する | `target: { type: "note", noteId }`、`payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }` が入る | |
| Drive の自動バックアップが有効 | バックアップジョブの `target` と `payload` を確認する | `target: { type: "storedFile", fileId }`、`payload: { kind: "driveBackup" }` が入る | |
| 個人所有として（`ownerType: "user"`）アップロードする | 変換ジョブの `scope` を確認する | 取り込み先の所有文脈から `{ type: "user", userId }` が入る | |
| 参加ワークスペース所有としてアップロードする（要求者は owner ではないメンバー） | 変換ジョブの `scope` を確認する | `{ type: "workspace", workspaceId: ownerWorkspaceId }` が入る（要求者からは導かない） | |
| Drive の自動バックアップが有効 | 変換ジョブとバックアップジョブの `scope` を比べる | どちらも取り込み先の所有文脈から導かれるため一致する（ノートの `NoteOwner` と元ファイルの `StorageOwner` が同じ所有者のため） | |
| `startBulkUpload` が返した `parentJobId` を指定する | 親子の `scope` を比べる | 親が同じ `ownerType` / `ownerWorkspaceId` から導いた値と一致し、親子の `scope` が一致するという不変条件を満たす | |
| `startBulkUpload` が返した `parentJobId` を指定する | アップロードする | 変換ジョブが `parentId: parentJobId` の子として作られる | |
| `parentJobId` つきで登録した | 親子の `payload` を比べる | 子は親（`Job.enqueueBatch` が作った `{ kind: "conversion", requestedVisibility, conversionPreference }`）と同じ `kind` / `payload` を持ち、`target` だけが対象 1 件を指す | |
| `parentJobId` つきの変換ジョブが終端した | 親ジョブの進捗を確認する | `updateBatchProgress` によって親の進捗に数えられる | |
| `parentJobId` つきで方針が `unavailable`（未対応形式・要 LLM 連携・`machineOnly` の LLM 必須形式） | アップロードする | いずれも変換ジョブが子として登録され、親の `total` と子の件数が一致する | |
| `parentJobId` つきで受理した全 5 件をアップロードする | 親ジョブを確認する | 子が 5 件登録され、全子終端で親が終端する（変換不能な子があっても親は「処理中」のまま残らない） | |
| 方針が `unavailable(unsupportedFormat)` | 出力を確認する | `conversionJobId` が `null` にならない（変換ジョブは方針にかかわらず登録される） | |
| `parentJobId` を指定しない | アップロードする | 変換ジョブは `parentId: null` の単独ジョブとして作られる | |
| `visibility: "unlisted"` を指定する | アップロードする | ノートは非公開で作られ、変換成功後に限定公開になる | |
| 変換が失敗した | 結果を確認する | 公開ステータスは非公開のまま残る | |
| クォータの検査 | 呼び出し先を確認する | Usage の**ユースケース** `ensureUploadAllowed` を呼ぶ。Usage のドメインサービス `QuotaEnforcement` やリポジトリを直接触らない（Storage ドメインは Usage に依存しない） | |
| LLM を要する方針と判定した | 消費の有無を確認する | このユースケースは `consumeLlmCall` を呼ばない。残量の事前確認だけを行い、消費は `runConversion` が行う | |
| Note route予約後にupload処理が失敗する | 再試行する | 対象scopeにNoteがなければreservationを解放し、active routeを残さない | |
| scope-local file / Note / Job commit後にactivation応答を失う | recoveryを実行する | 同じoperation IDでrouteをactiveにし、file・Note・Jobを二重登録しない | |
| scope SQLite使用率が60%以上 | bulk uploadする | sharding完了まで新規bulkを抑制し、削除・export・security cleanupは継続する | |
| scope SQLite使用率が70%以上 | 新規uploadする | 容量エラーで拒否し、hard limit到達前に書込みを止める | |
