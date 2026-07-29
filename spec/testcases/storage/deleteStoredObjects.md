# テストケース: deleteStoredObjects

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `storage.fileDeleted` を 3 件まとめて受け取る | 処理する | `ObjectStorage.deleteMany` が 3 件の `objectKey` で呼ばれ、`deletedCount: 3` が返る | |
| 受け取ったイベント | 鍵の解決方法を確認する | イベントの `objectKey` をそのまま使い、`StoredFileRepository` を引き直さない（メタデータは既に削除済みのため引けない） | |
| 実体が既に存在しない鍵 | 処理する | 成功として扱われ、`failed` に積まれない | |
| 3 件のうち 1 件の削除が失敗する | 処理する | 失敗した鍵が `failed` に積まれ、残り 2 件の削除は続き、`deletedCount: 2` が返る | |
| 1 件でも失敗が残った | 処理後の扱いを確認する | イベントを未処理として返し、再配送に委ねる（次の配送で残りの鍵を消し直す） | |
| 同じイベントを 2 回受け取る | 2 回処理する | 2 回目は鍵が既にないため成功として扱われ、結果は変わらない（鍵を指定した削除は本質的に冪等） | |
| 重複配送の扱い | `IdempotencyStore` の利用を確認する | `markProcessed` を呼ばない（`applyStorageDelta` のような加算・減算を伴う購読者とは事情が異なる） | |
| 削除に失敗したイベントが再配送される | 処理する | 処理済みの記録がないため弾かれず、再試行できる（外部ストレージへの書き込みは UoW に入れられないため、先に記録すると実体が永久に残る） | |
| 削除に失敗し続けた実体 | オブジェクトストレージを確認する | 孤児オブジェクトとして残るが、メタデータが存在せず参照されないため害はない | |
| オブジェクトストレージの通信・権限が失敗する | 処理する | `SystemError(ExternalServiceError)` が投げられ、再配送に委ねられる | |
| イベントが 0 件 | 処理する | `deletedCount: 0` が返り、`ObjectStorage.deleteMany` を呼ばない | |
| 同じ `storage.fileDeleted` を `applyStorageDelta` も購読している | 本ユースケースが未処理として返した後に再配送される | 重複排除は `(consumer, eventId)` 単位のため、`applyStorageDelta` 側は処理済みとして弾かれ、容量が二重に減らない | |
| `deleteFiles` / `deleteFilesForNote` / `deleteFilesByOwner` / `collectExpiredArtifacts` が削除した | 実体の回収経路を確認する | いずれも `storage.fileDeleted` を発行するだけで、実体の削除は本ユースケースに委ねられる | |
