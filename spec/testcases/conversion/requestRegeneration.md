# テストケース: requestRegeneration

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 元ファイルがあり LLM 連携済み | `localFile` で要求する | 再生成ジョブが登録される | |
| Drive バックアップがある | `driveBackup` で要求する | 再生成ジョブが登録される | |
| 元ファイルもバックアップもない | 要求する | `ValidationError("NO_REGENERATION_SOURCE")` が投げられる | |
| LLM が必要だが未連携 | 要求する | `BusinessRuleError(ReauthorizationRequired)` が投げられる | |
| LLM が必要で連携が失効 | 要求する | `BusinessRuleError(ReauthorizationRequired)` が投げられる | |
| — | 2001 文字の追加指示を指定する | `BusinessRuleError(InvalidInstruction)` が投げられる | |
| — | 2000 文字の追加指示を指定する | 成功する（境界値） | |
| 同じノートの再生成が実行中 | 要求する | `BusinessRuleError(DuplicateJob)` が投げられる | |
| viewer である | 要求する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ゴミ箱のノート | 要求する | `BusinessRuleError(NoteIsTrashed)` が投げられる | |
| 「要 LLM 連携」のノートで連携済み | 要求する | 初回生成として登録される | |
| 要求後 | ジョブの `payload` を確認する | `source` と追加指示とモデル指定が保存されている | |
