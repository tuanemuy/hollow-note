# テストケース: runRegeneration

初回変換（`runConversion`）との違い: `Note.markAwaitingIntegration` は使わない、公開ステータスの適用はない（payload に `requestedVisibility` がない）、`capability.llm` は連携の有無だけで決まり `"declined"` を取らない（payload に `conversionPreference` がない）、失敗しても本文は保持されジョブだけが `failed` になる。

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本文が `ready` で元ファイルがある | 実行する | 直前の本文が `regeneration` の版として記録され、成功時に新しい本文へ置き換わる | |
| 本文が `ready` でない（`awaitingIntegration` のノートを連携後に再生成する） | 実行する | 版は作られず、成功時に本文が入る | |
| 成功した | 実行後に確認する | サニタイズされた HTML と `hasDecoration` から決まる `styleMode` で本文が差し替わる | |
| ノートが削除済み | 実行する | `failed("targetMissing")` になる | |
| `source: "driveBackup"` | 実行する | `fetchBackupForRegeneration` が `BackupRecord.userId` の連携トークンで元ファイルを取り出す | |
| Drive 上の元ファイルが削除・移動されている | 実行する | `failed("targetMissing")` になり、本文は変わらない | |
| 記録所有者の Drive 連携が解除・失効・退会済み（`driveBackup`） | 実行する | `failed("integrationRequired")` / `failed("providerAuthFailed")` になり、本文は変わらない | |
| 方針が `unavailable(integrationRequired)`（OpenRouter 未連携） | 実行する | 本文を変更せず `failed("integrationRequired")` のみになる（`Note.markAwaitingIntegration` は呼ばれない） | |
| 方針が `unavailable(unsupportedFormat)` | 実行する | 本文を変更せず `failed("unsupportedFormat")` になる | |
| LLM 実行回数の上限に達している | 実行する | 本文を変更せず `failed("quotaExceeded")` になる | |
| 連携が失効している（`CredentialResolver.resolve` が `reauthorizationRequired`） | 実行する | 方針の決定に進まず `failed("providerAuthFailed")` になり、本文は変わらない（再生成では `Note.markConversionFailed` を呼ばない） | |
| `resolve` がtoken refreshまたは `lastUsedAt` 更新を返す | 実行する | `resolved.updated` をglobal D1で先に保存してからscope-local再生成を続ける | |
| `resolve` が返した `expired` が非 `null` | 実行する | global D1で連携と `integration.expired` を先に保存し、scope-localでジョブを失敗させる。plane間で停止しても再試行で収束する | |
| OpenRouter 未連携（連携の行がない） | 実行する | 失効とは分かれ、本文を変更せず `failed("integrationRequired")` になる | |
| 変換の実行が失敗する | 実行する | ノートの `content` は `ready` のまま（`Note.markConversionFailed` を呼ばない）、ジョブだけが `failed` になる | |
| 追加指示を指定した | 実行する | 指示が `ConversionInput` に載り、構造化の要求に含まれる | |
| `modelOverride` があり方針が `textExtractionThenStructuring` / `transcriptionThenStructuring` | 実行する | `structuring` のモデルだけが置き換わる | |
| `modelOverride` があり方針が `pageImageStructuring` / `imageStructuring` | 実行する | `vision` のモデルだけが置き換わる | |
| `modelOverride` があり方針に `transcription` が含まれる | 実行する | `transcription` は上書きされず、連携設定のモデルが使われる | |
| 変換結果に外部参照がある | 実行する | 参照取り込みジョブが登録される | |
| 取り込み時に `machineOnly` を指定していたノート | 再生成する | 再生成の payload に `conversionPreference` はなく、連携があれば LLM を使う方針になる | |
| `failed(machineExtractionUnavailable)` のノート（連携済み） | 再生成する | `unavailable(machineExtractionUnavailable)` には到達せず、LLM を使う方針で本文が生成される | |
| 実行後 | タグ・公開設定・共有リンクを確認する | いずれも維持されている（公開ステータスの適用は行わない） | |
| 実行後 | 版の一覧を確認する | 直前の内容から「元に戻す」ことができる | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わる（冪等） | |
| 既に `failed` / `canceled` のジョブ | 再配送で受け取る | 何もせず終わる | |
| ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） | 配送で受け取る | 何もせず成功として返る（run 系共通規則の判定 1） | |
| リースが有効な `running` のジョブ | 再配送で受け取る | 何もせず終わる（他のワーカーが実行中） | |
| リースが失効した `running` のジョブ | 再配送で受け取る | `Job.start` が引き継いで再開し、`attempts` が加算される | |
| リース失効の引き継ぎで `attempts` が上限を超える | 再配送で受け取る | 再開せず `failed("timeout")` になり、手動 `retry` の余地が残る | |
| 実行中に外部から強制終端された（`trashNote` / `cancelJob` など） | 結果を保存する | 保存が `ConflictError` になるためジョブを読み直し、終端済みなら差し替え前に取得した変換結果を破棄して成功として返す（ジョブは書き換えない。run 系共通規則の判定 4） | |
| 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） | 結果を保存する | `ConflictError` をそのまま投げて再配送に委ねる | |
| 実行中 | そのノートを編集する | `BusinessRuleError(NoteLockedByJob)` が投げられる | |
