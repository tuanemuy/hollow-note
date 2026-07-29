# テストケース: requestRegeneration

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 元ファイルがあり LLM 連携済み | `localFile` で要求する | 再生成ジョブが登録される | |
| Drive バックアップがある | `driveBackup` で要求する | 再生成ジョブが登録される | |
| 元ファイルもバックアップもない | 要求する | `ValidationError("NO_REGENERATION_SOURCE")` が投げられる | |
| `localFile` で LLM 必須形式（テキスト層のない PDF・画像・音声）、OpenRouter の連携の行がない | 要求する | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる（未連携。連携を促す） | |
| `localFile` で LLM 必須形式、OpenRouter が `ExpiredConnection` | 要求する | `BusinessRuleError(ReauthorizationRequired)` が投げられる（失効。再連携を促す） | |
| 未連携と失効を比べる | それぞれ要求する | 1 つのエラーに畳まれず、`ConversionCapability` の 3 値化と同じ理由で案内が分かれる（`runRegeneration` 側の `integrationRequired` / `providerAuthFailed` の区別と対応する） | |
| `localFile` で LLM 必須形式、OpenRouter が `ActiveConnection` | 要求する | 登録に進む | |
| `localFile` で LLM を要さない形式（`html` / `markdown` / `word` / `pdfWithText` など）、OpenRouter 未連携 | 要求する | 連携を確認せず登録される（`ConversionPlanner.plan(format, { llm: "unavailable" })` が `unavailable(integrationRequired)` を返す形式だけを LLM 必須に数える） | |
| `localFile` の事前確認 | 呼び出しを確認する | `FileContentReader.readHead(sourceFileId, 8192)` と手順 3 の `StoredFile` の `fileName` / `mimeType` で `FormatDetector.detect` を呼ぶ。`CredentialResolver.resolve` は呼ばない（トークンの更新と失効の確定は実行時の `runRegeneration` が行う） | |
| `readHead` が `NotFoundError("STORED_FILE_NOT_FOUND")` になる | `localFile` で要求する | 事前確認を省いて登録に進む（確定判定は `runRegeneration` がやり直し、実体が失われていれば `Job.fail("targetMissing")` になる） | |
| `FormatDetector.detect` が `SystemError(ExternalServiceError)` になる | `localFile` で要求する | 同じく事前確認を省いて登録に進む（事前確認の失敗で要求は止めない） | |
| `driveBackup` で LLM 必須だが OpenRouter 未連携 | 要求する | 登録時には検査せず登録され、実行時に `runRegeneration` が `Job.fail("integrationRequired")` とする | |
| `driveBackup` で OpenRouter が失効している | 要求する | 同じく登録され、実行時に `Job.fail("providerAuthFailed")` になる（元ファイルがローカルにないため登録時に形式を判定できない） | |
| `driveBackup` で要求した | `readHead` / `detect` の呼び出しを確認する | どちらも呼ばれない（記録所有者の資格情報での Drive 取得は要求の受け付けとして重すぎるため、連携の要否も含め `runRegeneration` に委ねる） | |
| — | 2001 文字の追加指示を指定する | `BusinessRuleError(InvalidInstruction)` が投げられる | |
| — | 2000 文字の追加指示を指定する | 成功する（境界値） | |
| — | 200 文字の `modelOverride` を指定する | 成功する（境界値） | |
| — | 201 文字の `modelOverride` を指定する | `ValidationError("INVALID_MODEL_OVERRIDE")` が投げられる（転送境界での入力検証） | |
| — | 空文字の `modelOverride` を指定する | `ValidationError("INVALID_MODEL_OVERRIDE")` が投げられる（1 文字以上。指定しない場合は `null`） | |
| — | 1 文字の `modelOverride` を指定する | 成功する（境界値） | |
| 同じノートの再生成が実行中 | 要求する | `BusinessRuleError(DuplicateJob)` が投げられる | |
| 存在しない `noteId` | 要求する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| viewer である | 要求する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ゴミ箱のノート | 要求する | `BusinessRuleError(NoteIsTrashed)` が投げられる | |
| 「要 LLM 連携」のノートで連携済み | 要求する | 初回生成として登録される | |
| 要求後 | ジョブの `payload` を確認する | `{ kind: "regeneration", source, instruction, modelOverride }` が保存されている | |
| 個人所有のノートを再生成する | ジョブの `scope` を確認する | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る | |
| 参加ワークスペース所有のノートを再生成する（要求者は owner ではないメンバー） | ジョブの `scope` を確認する | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない。そのワークスペースの削除・除名でキャンセルされるため） | |
