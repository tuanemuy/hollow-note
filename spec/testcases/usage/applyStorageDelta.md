# テストケース: applyStorageDelta

入力は `eventId`（アウトボックスが採番したイベント ID。重複排除の鍵）と `event` の 2 つ。`event` の payload に ID は含まれないため、購読ワーカーが配送された行の ID を明示的に渡す。

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| クォータのレコードがある | `storage.fileStored` を処理する | 消費が加算される | |
| 購読ワーカーがアウトボックス行を配送した | 入力を確認する | `eventId` と `event` の両方を受け取り、`IdempotencyStore.markProcessed(consumer, eventId)` の鍵に `eventId` を使う | |
| `IdempotencyStore.markProcessed` が `false`（処理済み）を返す | 処理する | 何もせず成功として完了する | |
| — | `storage.fileDeleted` を処理する | 消費が減算される | |
| 消費が 0 の状態 | `storage.fileDeleted` を処理する | 0 のまま（負にならない） | |
| — | `storage.fileOwnerChanged` を処理する | 旧主体から減り、新主体に増える | |
| 移動先の主体が既に上限を超えている | `storage.fileOwnerChanged` / `note.moved` を処理する | 付け替えは拒否されず加算され、超過は `warningLevel` の警告表示と以後の新規アップロードの拒否で扱われる（クォータ強制は取り込み時のみ） | |
| — | `note.created` を処理する | ノート件数が 1 増える | |
| — | `note.purged` を処理する | ノート件数が 1 減る | |
| — | `note.moved` を処理する | 旧主体の件数が減り、新主体の件数が増える | |
| `purpose: "artifact"` のファイルが保管された | `storage.fileStored` を処理する | 何もせず成功し、消費は加算されない（生成物は容量クォータに算入しない） | |
| `purpose: "artifact"` のファイルが回収された | `storage.fileDeleted` を処理する | 何もせず成功し、消費は減算されない | |
| `purpose: "artifact"` のファイルの所有者が変わった | `storage.fileOwnerChanged` を処理する | 何もせず成功し、旧主体からの減算も新主体への加算も起きない（artifact は一度も加算されていないため、除外しないと加算されていない容量を旧主体から減算することになる） | |
| `storage.fileStored` / `fileDeleted` / `fileOwnerChanged` の payload | 内容を確認する | 3 つとも `purpose` を運び、購読側が用途で除外できる。`fileOwnerChanged` だけ欠けると付け替えの経路で集計が壊れる（`relocateFilesForNote` 側の絞り込み 1 か所に依存させず、購読側でも効かせる） | |
| artifact だけを保管・回収した主体 | 一連の処理後に使用量を確認する | `consumedBytes` は 0 のまま変わらない | |
| 同じ `fileStored` イベントを 2 回受け取る | 2 回処理する | `IdempotencyStore` がイベント ID で重複を弾き、二重に加算されない | |
| 同じ `fileDeleted` イベントを 2 回受け取る | 2 回処理する | 同じく重複が弾かれ、二重に減算されない（`subtract` の 0 丸めは防御的措置にすぎず、冪等性の根拠ではない） | |
| 同じ `fileOwnerChanged` イベントを 2 回受け取る | 2 回処理する | 重複が弾かれ、容量が二重に移らない | |
| 同じ `note.created` イベントを 2 回受け取る | 2 回処理する | 重複が弾かれ、ノート件数が二重に増えない | |
| 同じ `note.purged` イベントを 2 回受け取る | 2 回処理する | 重複が弾かれ、ノート件数が二重に減らない | |
| 同じ `note.moved` イベントを 2 回受け取る | 2 回処理する | 重複が弾かれ、ノート件数が二重に移らない | |
| 処理済みの記録を書いた後に集計の更新が失敗する | 処理する | 同一 UoW のため処理済みの記録ごと巻き戻り、再配送で安全にやり直せる | |
| 別のコンシューマーが同じイベントを処理済み | 処理する | 重複排除は `(consumer, eventId)` 単位のため、こちらは通常どおり処理される | |
| クォータのレコードがなく加算経路（`fileStored` / `note.created` / `fileOwnerChanged` と `note.moved` の新主体側） | 処理する | `StorageQuota.initialize` が `insert` されてから適用される | |
| `deleteQuota` で行が消えた主体に、遅れて減算イベント（`fileDeleted` / `note.purged`）が届く | 処理する | その主体については何もせず終える。`insert` で行を復活させない（消費 0 のクォータ行が残り、`getUsageSnapshot` に削除済みの主体が現れるのを防ぐ） | |
| `deleteQuota` 済みの主体が `fileOwnerChanged` / `note.moved` の**旧**主体側になっている | 処理する | 旧主体側は行を作らずに終え、新主体側の加算だけが適用される | |
| 版が競合する | 処理する | 読み直して再適用され、成功する | |
| 競合が 5 回続く | 処理する | `ConflictError` が投げられ、再配送に委ねられる | |
| 加算で上限を超えた | 処理する | `usage.storageExceeded` が発行される | |
