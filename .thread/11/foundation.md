# Cloudflare バックエンドの共通基盤 — ステップ 5〜10 の担当者向け

ステップ 1〜4 で `packages/core/src/adapters/cloudflare/` に敷いた土台の使い方。各ヘルパーの詳細は library-level JSDoc を読むこと。

## リポジトリの受け口

**リポジトリは `SqlSession`（`sql/session.ts`）を受け取る。`SqlExecutor` を直接受け取らない。**
UoW の中では staged（write-set へ積む＋read-your-writes）、外では autocommit として同じコードが動く。

## 読み

3 種を使い分ける。

- `query(stmt)` — 素通し。`COUNT(*)` / `RETURNING` / 当該 UoW が触れない読みに使う
- `readRow({table, key, statement})` — 主キー読み。常に overlay 対応
- `readRows({table, statement, keyOf, matches?, compare?, limit?})` — 集合読み。`matches` / `compare` が SQL の `WHERE` / `ORDER BY` を写している範囲でだけ overlay が効く（JSDoc 参照）

`readRows` の overlay は呼び出し側の `matches` / `compare` に依存する。SQL とずれると未 commit の自分の書き込みだけが見えなくなる（素の SQL 結果は正しいまま）。ADR-009 のトレードオフ。

## 書き

`session.write([...RowMutation])`。

- `upsert({table, key, row, statement})` / `remove({table, key, statement})` — 行像を overlay に残す
- `opaque(statement)` — SQL だけ（guard・カウンタ加算・多行 DELETE）。overlay に寄与しない

## OCC / 条件付き更新

`occGuard(condition)`（`sql/occGuard.ts`）を**条件付き更新の直前に** `opaque` で積む。commit 時に発火すると `ConflictError("OPTIMISTIC_LOCK_FAILURE")` になる。

固有のエラー（route CAS の分岐など）が要るときは、ステージ時に読んだ値で先に判定して投げ、guard は同時実行に対する砦として残す。

## エラー翻訳

`sql/errors.ts`。`classifySqlError(e)` が `"occGuard" | "unique" | "check" | "notNull" | "foreignKey" | "unknown"` を返す。既定の翻訳は `throwTranslated(context, e)`。

## 列マッピング

`sql/row.ts` のみを使う（生の `SqlValue` を触らない）。時刻は integer ミリ秒、真偽は 0/1、JSON は text。壊れた行は `SystemError(DataIntegrityError)`。

用意してあるもの: `text` / `int` / `bool` / `date` / `json` / `enumOf` / `toTimestamp` / `toBool` / `toJson` / `compositeKey`

## リスト束縛

**必ず `sql/json.ts` を使う。`?` を件数ぶん並べない（bound parameter 上限 100）。**

- `inJsonList(col)` + `jsonList(ids)`
- 多行 INSERT: `insertRowsFromJson({table, columns, conflictKey, conflict})` + `jsonRows(...)`
- 多行 DELETE: `deleteRowsFromJson(table, col)`
- `assertBindable` が executor 内で上限を検査する

## cursor

`cursor.ts` の `encodeOpaqueCursor` / `decodeOpaqueCursor(cursor, fingerprint)`。`Buffer` 非依存。fingerprint 不一致は `ValidationError("INVALID_PAGINATION")`。

## 表名

`d1/schema.ts` の `GLOBAL_TABLES` / `do/schema.ts` の `SCOPE_TABLES` を使う。

## ScopeTaskScheduler（ステップ 9）

`do/scheduledTasks.ts` の文ビルダーを使う — `dueCandidatesStatement` / `selectDueRows` / `claimStatement` / `scheduleStatement` / `completeStatement` / `backoffStatement`。alarm turn と同じ規則を共有しており、二重実装すると必ずずれる。

## UoW の組み立て（ステップ 11 / 13）

`createGlobalUnitOfWorkProvider({executor, mintEventId, buildRepositories, stageOutbox, relayTrigger})` / `createScopeUnitOfWorkProvider({openScope, ...})`。

`openScope` は `createScopeStubExecutor(ns, scope, objectNamespace)`。ADR-004 の名前空間はこの第 3 引数（production は `""`）。

`stageOutbox`（ステップ 7）は `session` に outbox INSERT を積むだけの関数として渡す。commit と同一原子単位に入る。`scheduled_tasks` を触った write-set は自動で `ScopeTaskTrigger.kick` を撃つので、`schedule` をラップする必要はない。

## migration の拡張

- global 側: 列が足りなければ `d1/migrations/0002_*.sql` を足す
- scope 側: `do/schema.ts` に文を足すだけ（全文 `IF NOT EXISTS`）

## 土台が意図的に持っていないもの

- **`membership_directory` 表は未作成。** `ConformanceBackend.seedMembershipEdges` と `appendMembershipPage` のページ内容ケースに要る。ステップ 6 の担当が `0002_*.sql` で足す
- **DO の alarm handler registry は空。** `registerScopeTaskHandler(kind, handler)` を worker entry がモジュール読み込み時に埋める設計で、これは配備スライス（本 Issue 外）の担当。空の registry でも仕様どおり「訪問して settle せずリース満了まで running」で正しく動く

---

## 適合スイートの足場（ステップ 5〜10 の担当が使う）

全 30 スイートが束ごとに 7 ファイルへ分かれており、各束は独立して回せる。

| ファイル（`packages/core/src/adapters/cloudflare/__tests__/conformance/`） | スイート |
|---|---|
| `identity.test.ts` | userRepository / identityRepository / sessionRepository / authTokenRepository / identityRemovalReceiptStore / userBatchReader / loginAttemptStore / oauthStateStore |
| `directory.test.ts` | identityUniqueDirectory / distributedOperationStore / accountDeletionManifestStore / globalMaintenanceRunStore |
| `route.test.ts` | noteRouteStore / noteRouteFanOutReader / outboxRepository / idempotencyStore / scopeRouter |
| `scopeBusiness.test.ts` | storedFileRepository / noteRepository / storageQuotaRepository / noteRevisionRepository / llmUsageRepository / appliedOperationStore |
| `scopeInfra.test.ts` | scopeTaskScheduler / scopeCleanupAdmissionStore |
| `projection.test.ts` | noteProjection / localNoteQueryService / publicNoteQueryService / objectStorage |
| `unitOfWork.test.ts` | unitOfWork（ステップ 11 の担当。どの束にも入れていない） |

### 回すコマンド

```
pnpm exec vitest run --project workers packages/core/src/adapters/cloudflare/__tests__/conformance/{束}.test.ts
```

### 未実装ポートの切り替え方（担当が編集するのは 2 箇所だけ）

1. `__tests__/pendingPorts.ts` の `PENDING_PORTS` から**自分のポート名の行を削除**する（束ごとにコメントで区切ってあるので他の担当と衝突しない）
2. `__tests__/ports/{自分の束}.ts` の該当する `port<T>("Name")` に**第 2 引数として factory サンクを渡す** — 例: `port<UserRepository>("UserRepository", () => createD1UserRepository(deps))`。同時に `_deps` の下線を外して使う

1 だけやって 2 を忘れると backend 構築時に「PENDING_PORTS から外れたが factory が無い」と明示的に失敗する（黙ってスタブに戻らない）。`conformanceBackend.ts` は誰も編集不要。

`deps`（`__tests__/ports/deps.ts`）が持つもの: `db` / `bucket` / `scopeObjects` / `namespace` / `objectKeyPrefix` / `clock` / `idGenerator` / `maintenanceShardIds` / `maintenanceTablesByKind`（mutable）/ `requiredCleanupComponents` / `requiredFinalizeReceipts` と、`session`（global 束）または `session` + `scope`（scope 束）。
