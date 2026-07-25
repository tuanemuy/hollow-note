# ユースケース: Usage

ドメインの詳細は [domains/usage.md](../domains/usage.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

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
4. `BillingPeriod.of(now)` の `LlmUsageRepository.find` を引く
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

1. `QuotaSubject` を組み立て、`StorageQuotaRepository.find` を引く。不在なら初期値で判定する
2. `llmCalls > 0` なら `LlmUsageRepository.find(userId, BillingPeriod.of(now))` を引く
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

`event`（上記のいずれか）

### 出力DTO

なし。

### 処理フロー

1. イベントから対象の `QuotaSubject` と増減量を求める
   - `fileStored` → 加算、`fileDeleted` → 減算
   - `fileOwnerChanged` → 旧主体から減算し、新主体へ加算
   - `note.created` → ノート件数を +1、`note.purged` → −1、`note.moved` → 旧主体を −1、新主体を +1
2. `StorageQuotaRepository.find` を引く。不在なら `StorageQuota.initialize` を `insert` する
3. `add` / `subtract` / `incrementNotes` / `decrementNotes` を適用して `save` する
4. `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が返ったら読み直して再適用する（最大 5 回）
5. 上限を超えた場合は `usage.storageExceeded` を発行する

減算は 0 で下げ止まるため、同じイベントを 2 回受け取っても値が負にならない。ただし加算は重複すると過大になるため、`storage.fileStored` の処理では `IdempotencyStore` でイベント ID を記録して重複を弾く。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 再試行の上限に達した | `ConflictError`（再配送に委ねる） |
| 書き込みの失敗 | `SystemError(DatabaseError)` |

## consumeLlmCall

### 概要

LLM を使う変換の直前に実行回数を 1 消費する（`runConversion` から呼ばれる）。

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

先に消費してから変換を実行する。変換が失敗しても消費は戻さない（プロバイダー側では呼び出しが起きているため）。ただし変換を実行する前に判明した失敗（連携なし、形式が未対応）では消費しない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
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

1. `StoredFileRepository.sumSizeByOwner` を引く
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

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 既に不在 | 成功として返す |
