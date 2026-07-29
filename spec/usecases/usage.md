# ユースケース: Usage

ドメインの詳細は [domains/usage.md](../domains/usage.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## 共通: UoW の境界

[usecases/identity.md](./identity.md) の「UoW の合成と、ユースケースどうしの呼び出し」に従う。このドメインのユースケースは次の 3 種に分かれる。

| ユースケース | UoW |
| --- | --- |
| `getUsageSnapshot` / `ensureUploadAllowed` | 開かない（読み取りと判定だけで書き込みを持たないため、規約の対象外） |
| `consumeLlmCall` / `applyStorageDelta` / `initializeQuota` / `deleteQuota` / `recalculateStorageUsage` | 自分で `UnitOfWorkProvider.run` を開く |

書き込みを持つ 5 件はいずれも Usage の集約（`StorageQuota` / `LlmUsage`）だけを書き換え、他ドメインの集約には触れない。そのため他ドメインの UoW に合成する必要がなく、共有手順として切り出す対象にもならない。

**他ドメインから呼ばれる 2 件**。`ensureUploadAllowed` は Storage（`storeUpload` / `startBulkUpload` / `storeMedia`）から、`consumeLlmCall` は Conversion（`runConversion` / `runRegeneration`）から呼ばれる。どちらも**呼び出し元が自分の UoW を開く前**に呼ぶ。`run` を入れ子にしないための順序であり、意味の上でも整合する。

- `ensureUploadAllowed` は書き込みを持たないため、呼び出し元の UoW の内外どちらでも結果は変わらない。実際には保管（`ObjectStorage.put`）より前に判定を済ませる必要があるので、UoW を開くよりずっと手前で呼ばれる
- `consumeLlmCall` は書き込みを持ち、自分の UoW で先に確定する。呼び出し元（変換の実行）がそのあと失敗しても消費は戻らないが、これは意図した設計である — プロバイダー側では呼び出しが起きているためで、「呼ばれた側だけが確定していても矛盾しない」というユースケース間呼び出しの条件を満たす（変換を実行する前に判明する失敗ではそもそもここに到達しない）

## getUsageSnapshot

### 概要

設定画面に使用量を表示する（AC-10）。

### 入力DTO

`userId: string`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `personal` | `{ consumedBytes; limitBytes; noteCount; level }` |
| `workspaces` | `{ workspaceId; workspaceName; consumedBytes; limitBytes; noteCount; level }[]` |
| `llm` | `{ consumedCalls; limitCalls; period: { year; month }; level }` |
| `updatedAt` | `Date` |

### 処理フロー

1. `StorageQuotaRepository.find({ type: "user", userId })` を引く。不在なら `StorageQuota.initialize` の値を返す（レコードは作らない）
2. `MembershipRepository.listByUser` を引き、`owner` または `editor` のワークスペースだけを対象にする
3. `StorageQuotaRepository.listBySubjects` でまとめて引き、`WorkspaceRepository.listByIds` で名前を解決する
4. `BillingPeriod.of(now)` の `LlmUsageRepository.find` を引く。不在なら `LlmUsage.initialize` の値を返す（レコードは作らない）
5. `QuotaEnforcement.describe` で表示用の値を組み立てる
6. `updatedAt` は各レコードの最終更新時刻のうち最も新しいもの

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 取得の失敗 | `SystemError(DatabaseError)` |

## ensureUploadAllowed

### 概要

アップロードの前に容量と LLM 実行回数の残量を確認する（`storeUpload` から呼ばれる）。

### 入力DTO

`subjectType: "user" | "workspace"`, `subjectId: string`, `userId: string`, `totalBytes: number`, `llmCalls: number`

### 出力DTO

なし（違反時に例外を投げる）。

### 処理フロー

1. `QuotaSubject` を組み立て、`StorageQuotaRepository.find` を引く。不在なら `StorageQuota.initialize` の値で判定する（レコードは作らない）
2. `llmCalls > 0` なら `LlmUsageRepository.find(userId, BillingPeriod.of(now))` を引く。不在なら `null` のまま渡す — `QuotaEnforcement.ensureUploadAllowed` が `LlmUsage.initialize` と同じ初期値で判定する（[domains/usage.md](../domains/usage.md)）。当月の記録は最初の消費（`consumeLlmCall`）で作られるため、不在は「まだ 1 回も使っていない」を意味する
3. `QuotaEnforcement.ensureUploadAllowed` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 容量の上限到達 | `BusinessRuleError(StorageQuotaExceeded)` |
| LLM 実行回数の上限到達 | `BusinessRuleError(LlmQuotaExceeded)` |

## applyStorageDelta

### 概要

保管ファイルの増減とノート件数の増減を集計に反映する（`storage.fileStored` / `fileDeleted` / `fileOwnerChanged` / `note.created` / `note.purged` / `note.moved` の購読）。

### 入力DTO

`eventId: string`（アウトボックスが採番したイベント ID。重複排除の鍵）, `event`（上記のいずれか）

イベント購読ワーカーは配送されたアウトボックス行の ID と本体を両方渡す。`event` の payload には ID が含まれないため、`IdempotencyStore` の鍵は入力として明示的に受け取る。

### 出力DTO

なし。

### 処理フロー

1. `IdempotencyStore.markProcessed(consumer, eventId)` を呼ぶ。`false`（処理済み）なら何もせず成功として完了する
2. `fileStored` / `fileDeleted` / `fileOwnerChanged` の `purpose` が `"artifact"` なら何もせず成功として完了する（生成物は容量クォータに算入しない。[domains/usage.md](../domains/usage.md) の除外規則）。`fileOwnerChanged` を除外に含めるのは、artifact が一度も加算されていないためである — `relocateFilesForNote`（[usecases/storage.md](./storage.md)）はノートに属するファイルを `listByNote` でまとめて付け替えるので artifact も対象に入り、除外しないと**加算されていない容量を旧主体から減算する**ことになる
3. イベントから対象の `QuotaSubject` と増減量を求める
   - `fileStored` → 加算、`fileDeleted` → 減算
   - `fileOwnerChanged` → 旧主体から減算し、新主体へ加算
   - `note.created` → ノート件数を +1、`note.purged` → −1、`note.moved` → 旧主体を −1、新主体を +1
4. `StorageQuotaRepository.find` を引く。不在なら経路で分ける
   - 加算経路（`fileStored` / `note.created` / `fileOwnerChanged` と `note.moved` の新主体側）→ `StorageQuota.initialize` を `insert` する
   - 減算経路（`fileDeleted` / `note.purged` / `fileOwnerChanged` と `note.moved` の旧主体側）→ その主体については何もせず終える。`deleteQuota` で消えた主体に遅れて減算イベントが届いたときに、`insert` で行を復活させないため（復活させると消費 0 のクォータ行が残り、`getUsageSnapshot` に削除済みの主体が現れる）
5. `add` / `subtract` / `incrementNotes` / `decrementNotes` を適用して `save` する。処理済みの記録と集計の更新は同一 UoW で原子的に行う
6. `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が返ったら読み直して再適用する（最大 5 回）
7. 上限を超えた場合は `usage.storageExceeded` を発行する

6 の再試行はこのユースケースが個別に組む。`storage_quotas` はイベント駆動で更新されるホット行で、`ConflictError` を再配送に委ねると同じ競合が繰り返し起きて再配送ループになりやすいため、ここでは読み直して再適用する。汎用の OCC 再試行デコレーターを置かない方針（CLAUDE.md）とは別で、必要なユースケースが個別に組むことは `docs/backend_implementation_example.md` が認めている。

冪等性はイベント ID による重複排除で担保する（`IdempotencyStore`。[domains/index.md](../domains/index.md)）。加減算は同じイベントの再適用が非可換で、処理そのものからは冪等性を引き出せないため、重複排除が必須となる購読者にあたる。記録と更新が同一 UoW のため、途中で失敗すれば処理済みの記録ごと巻き戻り、再配送で安全にやり直せる。`subtract` の 0 丸めは防御的措置にすぎず、冪等性の根拠ではない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 再試行の上限に達した | `ConflictError`（処理済みの記録ごと巻き戻るため、再配送で再処理される） |
| 書き込みの失敗 | `SystemError(DatabaseError)` |

## consumeLlmCall

### 概要

LLM を使う変換の直前に実行回数を 1 消費する（`runConversion` / `runRegeneration` から呼ばれる）。

### 入力DTO

`userId: string`, `calls: number`

### 出力DTO

`headroom: number`

### 処理フロー

1. `BillingPeriod.of(now)` を求める
2. `LlmUsageRepository.find` を引く。不在なら `LlmUsage.initialize` を `insert` する
3. `ensureCanCall` を呼び、通れば `consume` を適用して `save` する
4. 競合したら読み直して再適用する（最大 5 回）
5. 上限を超えた場合は `usage.llmExceeded` を発行する

先に消費してから変換を実行する。変換が失敗しても消費は戻さない（プロバイダー側では呼び出しが起きているため）。ただし変換を実行する前に判明した失敗（連携なし、形式が未対応、パスワード保護）では消費しない。`runConversion` / `runRegeneration` はいずれもパスワード保護の判定を連携の解決・方針の決定より先に置き、本ユースケースに到達させない（[usecases/conversion.md](./conversion.md)）。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `calls` が 1 未満 | `BusinessRuleError(InvalidDelta)` |
| 上限到達 | `BusinessRuleError(LlmQuotaExceeded)` |
| 再試行の上限 | `ConflictError` |

## recalculateStorageUsage

### 概要

集計のずれを実データから作り直す。運用操作。

### 入力DTO

`subjectType`, `subjectId`

### 出力DTO

`consumedBytes: number`, `noteCount: number`

### 処理フロー

1. `StoredFileRepository.sumSizeByOwner` を引く。合計には `purpose: "artifact"` を含めない条件を付ける（増分集計と同じ除外規則。[domains/usage.md](../domains/usage.md)）
2. `NoteRepository.countByOwner(owner, "all")` を引く
3. `StorageQuota` の値を置き換えて保存する

### エラーケース

`SystemError(DatabaseError)`

## initializeQuota

### 概要

利用者・ワークスペースの作成に合わせてクォータ行を用意する（`identity.user.created` / `workspace.created` の購読）。

### 入力DTO

`subjectType`, `subjectId`

### 出力DTO

なし。

### 処理フロー

1. `StorageQuotaRepository.find` を引き、既にあれば何もしない
2. `StorageQuota.initialize` を `insert` する

`IdempotencyStore` は使わない（[domains/index.md](../domains/index.md) の判断規則）。冪等性の根拠は、主体そのものが主キー（`storage_quotas` は (`subject_type`, `subject_id`)）であり、処理が「不在なら初期値を 1 行作る」だけであることにある。再配送されても 1 で既存を見て何もせず終わり、既存行の値には触れないため、後続の加減算で進んだ消費量が初期値に巻き戻ることもない。1 と 2 のあいだに他の実行が割り込んで主キーが衝突した場合も既存として扱い成功とするので、重複排除の記録を別に持つ必要がない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 同時作成による重複 | 既存として扱い成功とする |

## deleteQuota

### 概要

利用者・ワークスペースの削除に合わせてクォータ行を消す（`identity.user.deleted` / `workspace.deleted` の購読）。

### 入力DTO

`subjectType`, `subjectId`

### 出力DTO

なし。

### 処理フロー

1. `StorageQuotaRepository.delete` を呼ぶ
2. 利用者の場合は `LlmUsageRepository.deleteByUser` も呼ぶ

`IdempotencyStore` は使わない（[domains/index.md](../domains/index.md) の判断規則）。冪等性の根拠は、鍵を指定した削除であり 2 回目以降は 0 行で終わることにある（`deleteStoredObjects` と同じ性質）。主体の削除は取り消されないため、削除後に同じ主体の行が正当に作り直されることもない。`applyStorageDelta` の減算が本ユースケースより遅れて届いた場合も、減算経路は不在の主体に行を作らずに終える（`applyStorageDelta` の手順 4）ため、消えた主体の行が復活することはない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 既に不在 | 成功として返す |
