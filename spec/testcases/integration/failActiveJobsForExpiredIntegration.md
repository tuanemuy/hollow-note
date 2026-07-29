# テストケース: failActiveJobsForExpiredIntegration

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| OpenRouter が失効し、`conversion` と `regeneration` が 1 件ずつ実行中 | `integration.expired` を処理する | 2 件が `failed("providerAuthFailed")` になり、`failedCount: 2` が返る | |
| Google Drive が失効し、`driveBackup` が実行中 | 処理する | `driveBackup` が `failed("providerAuthFailed")` になる | |
| OpenRouter が失効し、Drive の `driveBackup` が実行中 | 処理する | `driveBackup` は対象外で失敗しない（プロバイダーに依存する `kind` だけを選ぶ） | |
| `bulkBackup` の batch 親が実行中 | 処理する | 親は直接失敗させず、子の終端化の集計（`updateBatchProgress`）に委ねる | |
| `kind: "conversion"` の対象ノートが `processing` のまま | 処理する | `Note.markConversionFailed(providerAuthFailed)` も保存され、`runConversion` の失敗時と同じ表示になる | |
| `kind: "regeneration"` の対象ノートがある | 処理する | ジョブは失敗するが、ノートの本文は変更されない | |
| 失敗させたジョブ | 破棄された生成物を確認する | 「共通: 強制終端の後始末」の 2 を規則どおり適用するが、この経路の回収対象は実際には空になる。対象を `provider` に依存する `kind`（`conversion` / `regeneration` / `driveBackup` / `bulkBackup`）に絞っており、生成物（`purpose: "artifact"`）を持つのは `pdfExport` / `bulkExport` だけで、batch 親も直接は終端させないためである（`disconnectIntegration` と同じ理由。規則は経路ごとに省かず同じ形で適用する） | |
| 同じ利用者に `queued` のジョブがある | 処理する | 未終端のため対象となり、`failed("providerAuthFailed")` になる | |
| 他の利用者が同じプロバイダーの実行中ジョブを持つ | 処理する | 他の利用者のジョブには触れない（対象は `listActiveByRequester(userId)` の範囲） | |
| 対象の未終端ジョブが 1 件もない | 処理する | 何もせず `failedCount: 0` で成功として返る | |
| 同じイベントを 2 回受け取る | 2 回処理する | 2 回目は対象が既に終端で `listActiveByRequester` に現れず、`failedCount: 0` で終わる（冪等） | |
| ワーカーが同時に同じジョブを終端化した | 処理する | 該当ジョブを読み直し、既に終端なら何もしない（版の競合を表出させない） | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
