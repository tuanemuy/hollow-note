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

`userId: string`, `workspaceCursor: string | null`, `workspaceLimit: number`（既定20、最大20）

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `personal` | `{ consumedBytes; limitBytes; noteCount; level }` |
| `workspaces` | `WorkspaceUsageItem[]` |
| `nextWorkspaceCursor` | `string | null` |
| `llm` | `{ consumedCalls; limitCalls; period: { year; month }; level }` |
| `updatedAt` | `Date` |

```ts
type WorkspaceUsageItem =
  | { state: "available"; workspaceId: string; workspaceName: string; consumedBytes: number; limitBytes: number; noteCount: number; level: UsageLevel }
  | { state: "unavailable"; workspaceId: string; workspaceName: string | null };
```

`unavailable` の `workspaceName` が null になるのは、名前を供給する `workspace_directory` の側が答えられなかった場合である。手順 2 の解決は id ごとに縮退するため（`WorkspaceDirectoryBatchReader` の `unavailable`）、edge はあるが表示名がない状態が起こりうる。`deleted` と判定された workspace は行ごと落とす。

### 処理フロー

1. personal scope object から `StorageQuotaRepository.find({ type: "user", userId })` を引く。不在なら初期値を返す
2. global D1 の `membership_directory` から active workspace edge を `UserWorkspaceDirectory.listActiveByUser` の `created_at DESC, workspace_id` の keyset で `workspaceLimit` 件引き、`owner` / `editor` だけを残して `workspace_directory` で名前を解決する。editor 参加数には上限がないため、所有上限を fan-out 上限には使わない。ポートはロール述語を取らないので、ロールの絞り込みは取得の**後段**である — 1 ページの表示件数は `workspaceLimit` を下回りうるし、viewer だけのページは 0 件にもなる
3. このページに含まれる最大20個の workspace scope object だけへ問い合わせる。同時RPCは6以下とし、1 scopeの失敗はそのworkspaceを `unavailable` として返し、personalや他workspaceを失敗させない。縮退させるのは scope への RPC の失敗だけであり、その答えから値を導く純粋な導出（`StorageQuota.initialize` / `QuotaEnforcement.describe`）の失敗は畳まず要求ごと失敗させる。続きがあれば、ポートが返す**不透明（署名済み）な cursor をそのまま** `nextWorkspaceCursor` として返す。カーソルは絞り込み後の末尾ではなく**ページ全体の末尾**まで進むので、表示が 0 件のページでも次ページの起点は前へ進む
4. personal scope の `LlmUsageRepository.find(userId, BillingPeriod.of(now))` を引く。不在なら初期値を返す
5. `QuotaEnforcement.describe` で表示用の値を組み立てる
6. `updatedAt` は personal scope の `StorageQuota` と `LlmUsage` の最終更新時刻のうち新しいほう。**workspace 行は畳み込まない** — workspace の一覧はページの持ち物なので、畳み込むと画面が示す基準時刻がページを繰るたびに動く

### エラーケース

| 条件 | 種類 |
| --- | --- |
| `workspaceLimit` が 1〜20 の外、`workspaceCursor` が読めない、または退役した routing generation を指す | `ValidationError("INVALID_PAGINATION")`（`listUserWorkspaces` と同じく、クランプせずに拒否する） |
| 取得の失敗 | `SystemError(DatabaseError)` |

## ensureUploadAllowed

### 概要

アップロードの前に容量と LLM 実行回数の残量を確認する（`storeUpload` / `storeMedia` から呼ばれる。`storeAvatar` は差し替えで累積しないため呼ばない）。

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

current scopeの保管ファイル・ノート増減を集計する。`storage.fileStored` / `fileDeleted` / `note.created` / `note.purged` のlocal eventを購読する。

### 入力DTO

`eventId`, `event`

`eventId` は outbox 行の ID で、重複排除鍵として明示的に渡す。

**ノートの移動による増減はこのユースケースを通らない**。移動の `targetCredit` / `sourceDebit` はサガの各 phase の transaction の中で `StorageQuota` を直接加減算し、重複排除はその phase 自身の `AppliedOperationStore`（`migrationId` + command key）が担う（[usecases/note.md](./note.md#movenote)）。加減算と、それを正当化した行の書き込みが同じ transaction に入らなければならないためで、購読者として切り出すと両者が別の transaction に分かれる。

### 出力DTO

なし。

### 処理フロー

1. eventの`deletionOperationId`が非nullなら`ScopeCleanupAdmissionStore.assertOwner`を確認する。その後 `(consumer, eventId)` をcurrent scopeの `IdempotencyStore.markProcessed` に渡す。`false`なら完了する
2. eventの `purpose` が `artifact` なら何もせず完了する
3. イベントから対象の `QuotaSubject` と増減量を求める
   - `fileStored` → current scopeへ加算、`fileDeleted` → current scopeから減算
   - `note.created` → current scopeのノート件数を+1、`note.purged` → −1
4. `StorageQuotaRepository.find` を引く。不在なら経路で分ける
   - 加算経路（`fileStored` / `note.created`）→ `StorageQuota.initialize` をinsertする
   - 減算経路（`fileDeleted` / `note.purged`）→ 不在なら何もせず終え、削除済みscopeのquotaを復活させない
5. `add` / `subtract` / `incrementNotes` / `decrementNotes` を適用して保存する。event IDの処理済み記録と集計更新はcurrent scopeの同一UoWで原子的に行う
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

`userId: string`, `subjectType`, `subjectId`

`userId` は**主体ではなく実行者**である。`assertActorWritable` が「誰の依頼か」を要るため入力に持つ（[domains/index.md](../domains/index.md) — 全ドメインの通常 write 入口が `assertWritable` と `assertActorWritable` の両方を呼ぶ）。user 主体の場合は実行者と一致していなければならず、一致しなければ `BusinessRuleError(InsufficientRole)`。workspace 主体の場合は、`resolveWorkspaceAccess` が引いたロールの**存在**だけを見る（ロール表の action は課さない）。

### 出力DTO

`consumedBytes: number`, `noteCount: number`

### 処理フロー

1. 実行者と主体の対応を検査する。user 主体なら `subjectId` が実行者（`userId`）と一致していなければ `BusinessRuleError(InsufficientRole)`。workspace 主体なら `resolveWorkspaceAccess`（[usecases/workspace.md](./workspace.md)）でロールを引き、メンバーでなければ `BusinessRuleError(InsufficientRole)`。求めるのはメンバーシップだけで、ロール表の action は課さない — 棚卸しはメンバーが既に見られる値を実データの合計へ置き換えるだけで、新しい情報も新しい能力も生まないため
2. UoW を開き、workspace 主体なら**その transaction の中で** `MembershipRepository.findByWorkspaceAndUser` を引き直し、不在なら `BusinessRuleError(InsufficientRole)`（[usecases/workspace.md](./workspace.md) 冒頭の規則）。手順 1 の解決は早期拒否であって判定の正本ではない。削除受理済みのワークスペースは同じ transaction の `assertWritable` が `ConflictError("WORKSPACE_DELETING")` で止める
3. `StoredFileRepository.sumSizeByOwner` を引く。合計には `purpose: "artifact"` を含めない条件を付ける（増分集計と同じ除外規則。[domains/usage.md](../domains/usage.md)）
4. `NoteRepository.countByOwner(owner, "all")` を引く
5. `StorageQuota` の値を置き換えて保存する。行が無ければ初期値を作ってから置き換える — 主体の初回の棚卸しは行が無い状態から始まりうる

### エラーケース

| 条件 | 種類 |
| --- | --- |
| user 主体が実行者と一致しない | `BusinessRuleError(InsufficientRole)` |
| workspace 主体に実行者のメンバーシップがない（要求の処理中に除名された場合を含む） | `BusinessRuleError(InsufficientRole)` |
| workspace 主体が存在しない | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| workspace 主体が削除を受理済み | `ConflictError("WORKSPACE_DELETING")` |
| 書き込みの失敗 | `SystemError(DatabaseError)` |

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

scope cleanupに合わせてquota行を消す。workspace deletionはlocal event、account deletionはpersonal scope commandから呼ぶ。

### 入力DTO

`deletionOperationId`, `scope: ScopeKey`

### 出力DTO

`ScopeCleanupTurn` — `status`（`settled` / `continued` / `stalled` / `alreadyApplied`）と `personalCleanupCompleted: boolean`。

この turn を駆動した側は、継続を積むか完了 ack を上げるかを件数からは決められない（手順 3 の「100 件未満になってから receipt へ ack を付ける」判断は本ユースケースの内側にある）。呼び出し側が知らなければ制御できない分岐なので、結果として返す。

### 処理フロー

1. `ScopeCleanupAdmissionStore.assertOwner(deletionOperationId)`を確認する
2. `scope`からsubject keyを作り`StorageQuotaRepository.delete`を呼ぶ
3. 利用者の場合は `LlmUsageRepository.deleteByUser(userId, 100)` を1回だけ呼ぶ。100件なら同じUoWで`usage.userCleanupContinued { deletionOperationId }`をscope Alarmへ再登録し、100件未満になってからaccount deletion operation IDのscope cleanup receiptへ完了ackを付ける

`IdempotencyStore` は使わない（[domains/index.md](../domains/index.md) の判断規則）。継続taskとcleanup receiptの進捗は同じscope-local UoWに保存する。冪等性の根拠は、鍵を指定した削除であり 2 回目以降は 0 行で終わることにある（`deleteStoredObjects` と同じ性質）。主体の削除は取り消されないため、削除後に同じ主体の行が正当に作り直されることもない。`applyStorageDelta` の減算が本ユースケースより遅れて届いた場合も、減算経路は不在の主体に行を作らずに終える（`applyStorageDelta` の手順 4）ため、消えた主体の行が復活することはない。

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 既に不在 | 成功として返す |
