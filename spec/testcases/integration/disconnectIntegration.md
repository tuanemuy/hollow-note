# テストケース: disconnectIntegration

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| OpenRouter が連携済み | 解除する | 連携が削除され、資格情報が破棄される | |
| 実行中の変換ジョブがある | OpenRouter を解除する | ジョブがキャンセルされ、`canceledJobs` に数えられる | |
| 実行中のバックアップジョブがある | Drive を解除する | ジョブがキャンセルされる | |
| 取り消し対象の絞り込み | 引くクエリを確認する | `JobRepository.listActiveByRequester(userId)` を `provider` に依存する `kind` に絞る（OpenRouter なら `conversion` / `regeneration`、Google Drive なら `driveBackup` / `bulkBackup`） | |
| 実行中の `driveBackup` / `bulkBackup` のジョブがある | OpenRouter を解除する | `provider` に依存しない kind のため対象外で、取り消されない | |
| 実行中の `conversion` / `regeneration` のジョブがある | Drive を解除する | 同じく対象外で、取り消されない | |
| 実行中の `pdfExport` / `bulkExport` / 一括操作系のジョブがある | いずれかを解除する | どの連携にも依存しないため対象外で、取り消されない | |
| `bulkBackup` の batch 親と子が実行中 | Drive を解除する | batch 親（`target.type === "batch"`）は直接は取り消さず、子の終端化の集計（`updateBatchProgress`）に委ねる（親を直接取り消すと、後から終端する子の `job.succeeded` が行き場を失い、親 `canceled` / 子 `succeeded` の食い違った履歴が残る） | |
| 適用する遷移 | 履歴を確認する | 失効時の `Job.fail("providerAuthFailed")` ではなく `Job.cancel` を使い、履歴には「取り消された」として残る（利用者自身の操作による解除のため） | |
| 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま | OpenRouter を解除する | `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる（本文を作れなかった原因が資格情報の喪失ではなく利用者自身の操作のため。示す次の一手は「取り込み直す・再試行する」） | |
| 同上 | 他の強制終端の経路と比べる | 連携の失効（`failActiveJobsForExpiredIntegration`）だけがノート側の理由を `providerAuthFailed` にし、連携解除を含む残る 8 経路（`disconnectIntegration` / `trashNote` / `cancelJob` / `deleteWorkspace` / `deleteAccount` / `removeMember` / `leaveWorkspace` / `changeMemberRole`）は `canceled` になる | |
| 取り消した `kind: "regeneration"` のジョブ | OpenRouter を解除する | 本文は `ready` のまま変更されない | |
| 取り消したジョブ | 破棄された生成物を確認する | 「共通: 強制終端の後始末」の 2 を規則どおり適用するが、この経路の回収対象は実際には空になる。対象を `provider` に依存する `kind`（`conversion` / `regeneration` / `driveBackup` / `bulkBackup`）に絞っており、生成物（`purpose: "artifact"`）を持つのは `pdfExport` / `bulkExport` だけで、batch 親も直接は終端させないためである（規則は経路ごとに省かず同じ形で適用する） | |
| 連携・ジョブ・ノートの更新 | 保存の境界を確認する | すべて同一 UoW で保存され、`integration.disconnected` とジョブ・ノートのイベントがまとめて収集される | |
| `ActiveConnection` で `CredentialResolver.resolve` が `resolved` | 解除する | 平文で `IntegrationOAuthClient.revoke` を試みる（失敗しても続行する） | |
| `resolve` が `reauthorizationRequired`（失効） | 解除する | 取り消し要求を省いて続行し、`expired` は保存しない（直後に連携ごと削除するため） | |
| ジョブの取り消し時に版が競合した（ワーカーが同時に終端化した） | 解除する | 該当ジョブを読み直し、既に終端なら取り消しの対象から外す | |
| 連携がない | 解除する | 何もせず成功する | |
| プロバイダー側の取り消し要求が失敗する | 解除する | 記録して継続し、解除は成功する | |
| 解除後 | 生成済みのノートを確認する | 内容は残る | |
| 解除後 | 変換を要求する | 再連携を促すエラーになる | |
| Drive を解除した | Google の認証手段を確認する | サインインには影響しない | |
| 自動バックアップが有効だった | Drive を解除する | 設定も無効になる | |
| Drive を解除した | Drive 上のバックアップを確認する | ファイルは残る | |
