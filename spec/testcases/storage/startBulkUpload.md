# テストケース: startBulkUpload

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 対応形式のファイルを 5 件指定する | 開始する | 親ジョブが作られ、5 件が `accepted` になる | |
| 101 件を指定する | 開始する | `ValidationError("TOO_MANY_FILES")` が投げられる | |
| 100 件を指定する | 開始する | 成功する（境界値） | |
| 合計 501 MB を指定する | 開始する | `ValidationError("UPLOAD_TOO_LARGE")` が投げられる | |
| 未対応形式を含む | 開始する | それらは `rejected` に理由つきで入り、他は `accepted` になる | |
| すべて未対応形式 | 開始する | `ValidationError("NO_ACCEPTABLE_FILE")` が投げられる | |
| 保存容量の残りが足りない | 開始する | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| ワークスペースの viewer | 開始する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| LLM を要するファイルを含み未連携 | 開始する | `llmRequiredCount` と `llmAvailable: false` が返り、受け付けは成功する | |
| `conversionPreference: "machineOnly"` で LLM を要するファイルを 2 件含む | 開始する | `llmRequiredCount: 2` が返り（`conversionPreference` に依らず数える）、「LLM なしでは取り込めない見込みの件数」として警告に使われる。受け付けは成功する | |
| `conversionPreference: "machineOnly"` で OpenRouter 連携済み | 開始する | `llmRequiredCount` は連携の有無で変わらず、`llmAvailable: true` が返る | |
| 対応形式のファイルを 5 件指定する | 親ジョブの `progress` を確認する | `total: 5`（`accepted` の件数）で作られ、以後 `total` は変わらない | |
| 親ジョブを作った | `Job.enqueueBatch` の引数と結果を確認する | `kind: "conversion"`、`payload: { kind: "conversion", requestedVisibility: visibility, conversionPreference }`、`target: { type: "batch" }` で即 `running` になり、リースが張られる | |
| 親ジョブを作った | 子（`storeUpload` の変換ジョブ）の `payload` と比べる | 親と子で同じ `kind` / `payload` になる | |
| `ownerType: "user"` で開始する | 親ジョブの `scope` を確認する | 取り込み先の所有文脈から `{ type: "user", userId }` が入る | |
| 参加ワークスペースを取り込み先に指定する（要求者は owner ではないメンバー） | 親ジョブの `scope` を確認する | `{ type: "workspace", workspaceId: ownerWorkspaceId }` が入る（要求者からは導かない） | |
| 親ジョブを作った | 子（`storeUpload` の変換ジョブ）の `scope` と比べる | 子も同じ `ownerType` / `ownerWorkspaceId` から導くため親子で一致する | |
| 取り込み先の所有者を1つだけ受け取る | scopeを確認する | その所有文脈を親子Jobのscopeに使う。一括ID経路もsource ScopeKeyを必須にする | |
| `accepted` に変換不能な見込みのファイルを含む | 開始する | それらも `accepted` に含めて `total` に数える（確定判定は `storeUpload` / `runConversion` が行い、子ジョブとして結果が記録される） | |
| 受け付け後に呼び出し側が `storeUpload` を途中で止めた | 親ジョブを確認する | 子が `total` に届かないためリースが延長されず、`reapExpiredJobs` が `failed("timeout")` として回収する | |
| ファイルを受け付けた | `accepted` の `format` / `requiresLlm` と `llmRequiredCount` を確認する | 宣言 MIME・拡張子から導いた暫定値である（このユースケースは内容（head）を読まない） | |
| 暫定判定と内容に基づく判定が食い違うファイル | `storeUpload` まで進める | 確定判定は `storeUpload` / `runConversion` の `FormatDetector.detect` が行い、暫定値と食い違ってよい | |
| ハンドル未設定で `visibility: "public"` を指定する | 開始する | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる | |
| 音声 200 MB のファイルを含む | 開始する | 受け付けられる（形式別の上限の境界値） | |
| 音声 201 MB のファイルを含む | 開始する | そのファイルが `rejected` になる | |
