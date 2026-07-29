# テストケース: collectExpiredArtifacts

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 期限が過ぎた PDF がある | 実行する | 削除され、`collectedCount` に数えられる | |
| 期限が過ぎた PDF がある | 実行後にイベントを確認する | `deleteFiles` と同じ手順を通るため、件ごとに `storage.fileDeleted`（`objectKey` を含む）が発行される | |
| `storage.fileDeleted` が発行された | 購読側を確認する | 実体の回収は `deleteStoredObjects` が行う（本ユースケースはオブジェクトストレージを直接触らない） | |
| 回収の前後 | 使用量を確認する | 容量クォータは変化しない（`artifact` はクォータに算入しないため `applyStorageDelta` の減算対象外） | |
| `uploadedBy: null` の匿名 PDF の artifact の期限が過ぎている | 実行する | 通常の artifact と同じく回収される（要求者が存在しなくても対象になる） | |
| 一括ダウンロードの ZIP（`noteId: null` / `noteVersion: null`）の期限が過ぎている | 実行する | 回収される | |
| 一部の削除が失敗する | 実行する | 個々の失敗は記録して残りの回収を続ける | |
| 期限内の PDF がある | 実行する | 削除されない | |
| 期限のちょうど 1 ミリ秒前 | 実行する | 削除されない（境界値） | |
| 対象が `limit` を超える | 実行する | `limit` 件だけ削除される | |
| `persistent` のファイルがある | 実行する | 対象にならない | |
| 対象が 0 件 | 実行する | `collectedCount: 0` が返る | |
| 削除後 | 履歴を確認する | 生成物が「期限切れ」として表示される | |
