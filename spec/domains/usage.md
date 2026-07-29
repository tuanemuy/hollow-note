# Usage

保存容量と LLM 実行回数の消費と上限を管理する。上限の値は `import.md` の共通の前提に対応する。

## ユビキタス言語

| 英語 | 日本語 | 定義 |
| --- | --- | --- |
| Quota | クォータ | ある主体に許された上限 |
| Consumption | 消費 | 現時点で使われている量 |
| Subject | 主体 | クォータの帰属先。利用者またはワークスペース |
| BillingPeriod | 集計期間 | LLM 実行回数を数える単位。暦月（UTC） |
| Headroom | 残量 | 上限から消費を引いた残り |

## 値オブジェクト

### QuotaSubject

```
QuotaSubject =
  | { type: "user"; userId: UserId }
  | { type: "workspace"; workspaceId: WorkspaceId }
```

- **補助**: `QuotaSubject.fromStorageOwner(owner: StorageOwner): QuotaSubject`、`QuotaSubject.fromNoteOwner(owner: NoteOwner): QuotaSubject`

### ByteQuota

- **フィールド**: `limit: number`（バイト）
- **バリデーション**: 0 より大きい整数
- **既定値**: 利用者 5 GB、ワークスペース 20 GB。`ByteQuota.defaultFor(subject): ByteQuota`

### LlmCallQuota

- **フィールド**: `limit: number`（回 / 月）
- **バリデーション**: 0 以上の整数
- **既定値**: 利用者あたり 300 回。ワークスペース所有のノートの変換も、実行した利用者の枠から引く

### BillingPeriod

- **フィールド**: `year: number`, `month: number`（1〜12）
- **バリデーション**: `month` は 1〜12
- **補助**: `BillingPeriod.of(date: Date): BillingPeriod`（UTC で判定）、`BillingPeriod.equals(a, b): boolean`

### UsageWarningLevel

- **フィールド**: `value: "none" | "warning" | "exceeded"`
- 消費が上限の 80 % 未満なら `none`、80 % 以上なら `warning`、100 % 以上なら `exceeded`

## エンティティ

### StorageQuota（集約ルート）

```
StorageQuota = {
  subject: QuotaSubject          // 識別子を兼ねる
  quota: ByteQuota
  consumedBytes: number
  noteCount: number
  version: number
  updatedAt: Date
}
```

主体そのものを識別子とするため、独立した ID を持たない。

**不変条件**

- `consumedBytes >= 0`
- `noteCount >= 0`

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `initialize` | `subject: QuotaSubject, now: Date` | `StorageQuota` | 既定のクォータで生成。消費は 0 |
| `add` | `quota: StorageQuota, bytes: number, now: Date` | `StorageQuota` | `bytes` が負なら `BusinessRuleError(InvalidDelta)`。加算する |
| `subtract` | `quota: StorageQuota, bytes: number, now: Date` | `StorageQuota` | 0 を下回る場合は 0 に丸める（防御的措置。重複配送の排除は購読側の重複排除が担う — ドメインイベントの節を参照） |
| `incrementNotes` / `decrementNotes` | `quota: StorageQuota, now: Date` | `StorageQuota` | ノート件数の増減。0 を下回らない |
| `changeLimit` | `quota: StorageQuota, limit: ByteQuota, now: Date` | `StorageQuota` | 運用による上限変更 |
| `headroom` | `quota: StorageQuota` | `number` | `max(0, limit - consumedBytes)` |
| `warningLevel` | `quota: StorageQuota` | `UsageWarningLevel` | 消費率から判定 |
| `ensureCanStore` | `quota: StorageQuota, bytes: number` | `void` | `headroom < bytes` なら `BusinessRuleError(StorageQuotaExceeded)` |

版管理は行うが、加算・減算はイベント駆動で頻繁に起きるため、競合時はユースケース側で読み直して再適用する。

### LlmUsage（集約ルート）

```
LlmUsage = {
  userId: UserId
  period: BillingPeriod
  quota: LlmCallQuota
  consumedCalls: number
  version: number
  updatedAt: Date
}
```

`(userId, period)` が識別子。

**不変条件**

- `consumedCalls >= 0`
- 過去の期間のレコードは変更されない

**振る舞い**

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `initialize` | `userId: UserId, period: BillingPeriod, now: Date` | `LlmUsage` | 既定のクォータで生成 |
| `consume` | `usage: LlmUsage, calls: number, now: Date` | `LlmUsage` | `calls` が 1 未満なら `BusinessRuleError(InvalidDelta)`。加算する |
| `headroom` | `usage: LlmUsage` | `number` | `max(0, limit - consumedCalls)` |
| `warningLevel` | `usage: LlmUsage` | `UsageWarningLevel` | 消費率から判定 |
| `ensureCanCall` | `usage: LlmUsage, calls: number` | `void` | `headroom < calls` なら `BusinessRuleError(LlmQuotaExceeded)` |

## ドメインサービス

### QuotaEnforcement

**責務**: 取り込み前に、容量と LLM 回数の両方をまとめて検査する。

強制は取り込み時（アップロード・変換の受け付け）のみに働く。ノートの移動や所有者の付け替えでは検査しない — 既にサービス内にあるバイト列を主体間で移すだけで総量は増えず、移動を拒むと利用者が超過状態から抜け出せなくなるため。移動先が超過していても操作は通り、超過は警告表示（`warningLevel`）と新規アップロードの拒否で扱う。

| メソッド | 引数 | 戻り値 | 処理 |
| --- | --- | --- | --- |
| `ensureUploadAllowed` | `params: { storage: StorageQuota; llm: LlmUsage \| null; totalBytes: number; llmCalls: number }` | `void` | `storage.ensureCanStore` を呼び、`llmCalls > 0` なら `llm.ensureCanCall` も呼ぶ。`llm` が `null`（当月の記録がまだない）なら `LlmUsage.initialize` と同じ初期値（消費 0）で判定する |
| `describe` | `params: { storage: StorageQuota; llm: LlmUsage \| null }` | `UsageSnapshot` | 表示用の値をまとめる |

```
UsageSnapshot = Readonly<{
  storage: { consumedBytes: number; limitBytes: number; noteCount: number; level: UsageWarningLevel };
  llm: { consumedCalls: number; limitCalls: number; period: BillingPeriod; level: UsageWarningLevel } | null;
}>;
```

`ensureUploadAllowed` が `llm: null` を初期値として扱うのは、`LlmUsage` が当月最初の消費（`consumeLlmCall`）で初めて作られるためで、`initializeQuota` は `StorageQuota` しか作らない。記録の不在を上限到達と読むと、新規利用者と各月の初回で LLM 必須のアップロードが必ず弾かれる。`getUsageSnapshot` が不在の記録を `LlmUsage.initialize` の値で埋めるのと同じ扱いに揃える。

**依存するポート**: なし

## ポート

### StorageQuotaRepository

```ts
interface StorageQuotaRepository {
  find(subject: QuotaSubject): Promise<Versioned<StorageQuota> | null>;
  insert(quota: StorageQuota): Promise<void>;
  save(quota: StorageQuota, expectedVersion: ExpectedVersion<StorageQuota>): Promise<void>;
  listBySubjects(subjects: readonly QuotaSubject[]): Promise<readonly StorageQuota[]>;
  delete(subject: QuotaSubject): Promise<void>;
}
```

`TransactionalRepository` は単一の ID を前提とするため、主体を識別子とするこのポートは同等の契約を独自に持つ。

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

### LlmUsageRepository

```ts
interface LlmUsageRepository {
  find(userId: UserId, period: BillingPeriod): Promise<Versioned<LlmUsage> | null>;
  insert(usage: LlmUsage): Promise<void>;
  save(usage: LlmUsage, expectedVersion: ExpectedVersion<LlmUsage>): Promise<void>;
  deleteByUser(userId: UserId): Promise<number>;
}
```

**エラーケース**: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`、`SystemError(DatabaseError)`

## ドメインイベント

| 型 | payload | 用途 |
| --- | --- | --- |
| `usage.storageExceeded` | `{ subject, consumedBytes, limitBytes }` | 上限到達の通知 |
| `usage.llmExceeded` | `{ userId, period, consumedCalls, limitCalls }` | 上限到達の通知 |

消費の増減自体はイベントを発行しない（Storage / Note のイベントを購読して更新する側であるため）。

購読側（`applyStorageDelta`）の冪等性は、イベント ID による重複排除で担保する。加減算は再適用が非可換で、処理そのものからは冪等性を引き出せないため、`IdempotencyStore`（横断的ポート。[index.md](./index.md) を参照）が必須となる購読者にあたる。処理済みイベント ID を記録して重複配送を弾き、処理済みの記録と集計の更新は同一 UoW で原子的に行う。`subtract` の 0 丸めは防御的措置にすぎず、冪等性の根拠ではない。

容量の集計は `purpose: "artifact"` のファイルを対象にしない。生成物（PDF / ZIP）は期限付きで自動回収されるため、容量クォータに算入しない。除外は加算・減算だけでなく**所有者の付け替えにも及ぶ**。`storage.fileStored` / `storage.fileDeleted` / `storage.fileOwnerChanged` の 3 型すべてで `purpose` を見て artifact を落とす — artifact は一度も加算されていないので、付け替えで旧主体から減算すれば加算していない量を引くことになり、集計が負に振れる（`subtract` の 0 丸めが働けば消費量そのものが失われる）。棚卸し（`recalculateStorageUsage` の `sumSizeByOwner`）も同じ除外条件で数えるため、増分と全数のどちらで数えても同じ値になる。

## エラーコード

```
UsageErrorCode =
  | "InvalidDelta" | "InvalidQuota" | "InvalidPeriod"
  | "StorageQuotaExceeded" | "LlmQuotaExceeded"
```

## ユースケース（概要）

`getUsageSnapshot`, `ensureUploadAllowed`, `applyStorageDelta`, `consumeLlmCall`, `recalculateStorageUsage`, `initializeQuota`, `deleteQuota`

詳細は [usecases/usage.md](../usecases/usage.md)。
