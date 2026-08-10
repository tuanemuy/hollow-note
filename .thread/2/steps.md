# 実装手順 — Issue #2

## 設計

### ドメインモデルへの影響

**Identity（既存 — 追加は小さい）**
Issue #1 で `User` の全遷移（`verifyEmail` / `updateProfile` / `assignHandle` / `clearHandle` / `advanceAuthEpoch` / `beginDeletion` / `rejectDeletion` / `finalizeDeletion`）、`Identity`（`createPassword` / `createOAuth` / `changePassword`）、`AuthToken.consume`、`IdentityPolicy`（上限 8 / 最後の 1 件 / パスワード重複）、`AccountLinkingPolicy`（createNew / linkToExisting / refuse）が実装済み。本 Issue が足すのは次だけ。

- `IdentityRemovalReceipt`（値 + ポート）: `removeIdentity` が 30 日保持する解除受領。同じ解除の再送に「既に削除済み」を返す根拠であり、Identity 行が消えた後も `providerAccountKey` を保持する。application ポート（`ScopeKey` 非依存だが UserId shard の永続化契約）として `application/ports/identityRemovalReceiptStore.ts` に置き、`GlobalUnitOfWorkContext` に載せる。
- `SignInOAuthClient` に `deriveCodeChallenge(codeVerifier: string): string` を追加する（ADR-010）。既存の `buildAuthorizationUrl(codeChallenge)` の形は spec どおり据え置く。
- 既存 `IdentityEvent` の網羅確認: `identityAdded` / `identityRemoved` / `identityPasswordChanged` / `userProfileUpdated` / `userHandleChanged` / `userDeleted` は実装済み。追加が要るのは `identity.userAuthResidueCleanupContinued` と `identity.accountDeletion*Continued` の**継続タスク**（ドメインイベントではなく継続要求 — `domain/index.md` の 4 規則に従い、単一サブスクライバー・cursor なし / keyset のどちらかを明示する）。
- `IdentityErrorCode` に **`AccountDeletionRetryLimitExceeded` を追加する**（現行 enum は 12 値でこの値が無い）。値は `IDENTITY_ACCOUNT_DELETION_RETRY_LIMIT_EXCEEDED`。判定（120 日窓の terminal 件数 8）はドメインサービス `AccountDeletionRetryPolicy.ensureRetryable(count)` に置き（`count` は `DistributedOperationStore.countTerminalSince` の観測値）、`BusinessRuleError` を投げるのはここ 1 箇所にする（ADR-013）。`IdentityLimitExceeded`（spec 記載漏れ）は #1 で追加済み。
- **`IdentityUniqueDirectory` に active 予約の解放手段を足す**（ADR-015）。現行ポートは `resolve` / `reserve` / `activate` / `release(operationId)` の 4 メソッドで、memory 実装の `release` は `state === "reserved"` の行しか消さず（`adapters/memory/repositories/identityUniqueDirectory.ts`）、`DirectoryRow.state` も `"reserved" | "active"` の 2 値で spec/database の `releasing` が無い。`removeIdentity` の provider 予約解放・`updateProfile` の旧ハンドル解放・`deleteAccount` の全 uniqueness 解放はいずれも **active 行を、過去の親 operation ID ではなく normalizedKey を鍵に**解放する必要がある（`spec/usecases/identity.md` 手順 4 / `updateProfile` 手順 4 / deleteAccount 手順 4）。ステップ 1 で拡張する。

**Usage（新設 — `spec/domains/usage.md` 全体）**

- VO: `QuotaSubject`（`user` / `workspace` の判別共用体 + `fromStorageOwner` / `fromNoteOwner`）、`ByteQuota`（正の整数、`defaultFor`: user 5GB / workspace 20GB）、`LlmCallQuota`（非負整数、既定 300/月）、`BillingPeriod`（UTC の年月、`of(date)` / `equals`）、`UsageWarningLevel`（`none` <80% / `warning` ≥80% / `exceeded` ≥100%）。
- エンティティ: `StorageQuota`（subject 識別・`consumedBytes` / `noteCount` ≥ 0・`initialize` / `add` / `subtract`（0 で床）/ `incrementNotes` / `decrementNotes` / `changeLimit` / `headroom` / `warningLevel` / `ensureCanStore`）、`LlmUsage`（`(userId, period)` 識別・`initialize` / `consume` / `headroom` / `warningLevel` / `ensureCanCall`、過去期は不変）。いずれも OCC。
- ドメインサービス: `QuotaEnforcement`（`ensureUploadAllowed` / `describe`。`llm === null` は初期値で判定。ポート非依存）。
- ポート: `StorageQuotaRepository`（`find` / `insert` / `save(expectedVersion)` / `listBySubjects` / `delete` — subject キーなので `TransactionalRepository` を継承しない）、`LlmUsageRepository`（`find` / `insert` / `save` / `deleteByUser(userId, limit)`）。
- イベント: `usage.storageExceeded` / `usage.llmExceeded`（**発行元は `applyStorageDelta` と `consumeLlmCall` で、どちらも本 Issue 外**。本 Issue に発行者が存在しないので型定義のみ）。
- エラーコード: `InvalidDelta` / `InvalidQuota` / `InvalidPeriod` / `StorageQuotaExceeded` / `LlmQuotaExceeded`。

**Storage（最小コア — ADR-004）**

- VO: `StorageOwner`（`ScopeKey` と同形の user / workspace）、`FileName`、`MimeType`、`ByteSize`、`FilePurpose`（`"source" | "media" | "reference" | "artifact" | "avatar"`）、`FileProvenance`（`purpose: FilePurpose` / `noteId` / `uploadedBy`）、`ObjectKey`（`ObjectKey.build(owner, purpose, fileId, extension)`。1〜1024 文字・`..` を含まない・先頭が `/` でない）、`Checksum`（`sha256` + 64 桁 hex）、既存 `StoredFileId` を活かす。`ObjectKey` / `Checksum` / `FilePurpose` が無いと `put(key, body, meta)` / `deleteMany(keys)` / `publicUrl(key)` / `StoredFile.register` が型として書けない。
- エンティティ: `StoredFile`（`register` / 参照読み。`objectKey` と `size` を持つ）。
- ドメインサービス: `UploadValidationPolicy.ensureAcceptable({purpose, mimeType, size})` — 本 Issue は `avatar` 行（`image/png` / `image/jpeg` / `image/webp`、5 MB）のみ埋める。
- ポート: `StoredFileRepository extends TransactionalRepository<StoredFile, StoredFileId>`（基底の `insert` / `findById` / `delete(id, expectedVersion)` に加えて `listByIds` / `listByOwner(owner, purpose: FilePurpose | null, pagination: Pagination): Promise<PaginationResult<StoredFile>>` / `sumSizeByOwner(owner)`（`purpose: "artifact"` を除外））、`ObjectStorage`（`put` / `get` / `deleteMany` / `publicUrl` — `ScopeKey` に依存しないので `application/ports/objectStorage.ts`）。**行削除は `findById` が返す `ExpectedVersion` トークン経由でしか書けない**（`domain/common/transactionalRepository.ts`: トークンはアダプターが `findById` の中でのみ発行する）ので、`deleteFiles` は 1 件ずつ `findById` → `delete` する（ADR-022）。`listByOwner` の `purpose` 絞り込みは `storeAvatar` 手順 4（既存アイコンだけを同一 UoW で消す / TC-storage-174）が要求し、`deleteFilesByOwner` は `null` で呼ぶ（TC-storage-049「用途によらずすべて削除される」）。戻り値を `PaginationResult` にするのは、`batchSize` ちょうどの件数で「残件なし」と「まだ残る」を区別するため（TC-storage-038）。`deleteMany` は spec/domains/storage.md の形に合わせる（オブジェクト実体の削除の唯一の経路が `storage.fileDeleted` のまとまりを受ける `deleteStoredObjects` なので 1 件用は置かない）。`publicUrl(objectKey): string` は ADR-011 の追加分で、memory は `/storage/{key}` の**アプリ相対パス**を返す（ADR-016）。
- イベント: `storage.fileStored` / `storage.fileDeleted`（後者は `objectKey` と `deletionOperationId` を持つ）。

**Note（既存への追加なし、読み取りのみ）**
`NoteRepository.countByOwner` / `listByOwner` は #1 で実装済み。`NoteRouteFanOutReader.listByCreatedBy` も実装済み（deleteAccount の author route manifest が使う）。`Local/PublicNoteProjectionWriter` はポート + memory 実装が #1 で完成済みで、購読側 UC（`projectNoteChanges`）は Note スライス（ADR-009）。

**Workspace / Job / Integration / Tag**
本 Issue では触らない（ADR-001）。`deleteAccount` の workspace wave は「manifest への membership item 追加と prepare コマンドの dispatch まで」を実装し、コマンドの受け手は #3 が足す。

### 新設する土台ポートと Unit of Work への搭載

現状の `GlobalUnitOfWorkContext` は 5 ポート（user / identity / session / authToken / identityUniqueDirectory）、`ScopeUnitOfWorkContext` は 4 ポート（noteRepository / noteRevisionRepository / cleanupAdmission / noteProjectionRevisionStore）しか持たない。本 Issue で足すポートは、UoW 契約（CLAUDE.md「Unit of Work」）を満たすためにコンテキストへ載せる必要がある。

| ポート | 置き場所 | 載せる UoW コンテキスト | 根拠 |
|---|---|---|---|
| `IdentityRemovalReceiptStore` | `application/ports/identityRemovalReceiptStore.ts` | Global | removeIdentity 手順 3 が「行削除 + 受領 + outbox」を同一 UoW で要求 |
| `DistributedOperationStore` | `application/ports/distributedOperationStore.ts` | Global（+ 読み取りビュー `Pick<…, "findByOperationId">` を `RequestContainer` へ） | deleteAccount 手順 2 が `beginDeletion` と同一 UserId shard transaction を要求（ADR-013）。読み取りビューは `getAccountDeletionStatus`（セッション失効後の ticket ポーリング）が使う — 読み取りが書き込み UoW を通らないための #1 ADR-019 の規約（`di/types.ts` の `Pick` を `RequestContainer` に置く形） |
| `ScopeTaskScheduler` | `application/ports/scopeTaskScheduler.ts` | Scope | 継続タスクの保存が本処理と同一 UoW（ADR-005） |
| `AppliedOperationStore` | `application/ports/appliedOperationStore.ts` | Scope | scope cleanup コマンドの重複排除が本処理と同一 UoW（ADR-012） |
| `StorageQuotaRepository` / `LlmUsageRepository` | `domain/usage/ports/` | Scope | `StorageQuota` は scope object、`LlmUsage` は personal scope |
| `StoredFileRepository` | `domain/storage/ports/` | Scope | ファイル行は scope object に属し、`deleteFiles` は同一 UoW |
| `ObjectStorage` | `application/ports/objectStorage.ts` | 載せない | UoW 外の外部 I/O（`put` は UoW の前、`deleteMany` はイベント購読側） |
| `ScopeTaskQueue` | `application/ports/scopeTaskQueue.ts` | 載せない（`WorkerContainer`） | 期限到来 scope タスクを **scope 横断で列挙する**唯一の手段。`ScopeTaskScheduler` は scope UoW の中にしか無く、`ScopeUnitOfWorkProvider` / `ScopeRouter` / `WorkerContainer` のどこにも scope の一覧が無いため、ランナーが駆動できない（ADR-005） |

各ポートは `application/execution/unitOfWork.ts` のインターフェース、`adapters/memory/{globalUnitOfWork,scopeUnitOfWork}.ts` の実装、`adapters/conformance/backend.ts` の `ConformanceBackend` / `ScopedConformancePorts` の 3 か所すべてに反映する。

**既存ポートの実行経路への搭載**（#1 で「ポート + memory 実装 + 適合スイート」までは完成しているが、`RequestContainer` / `WorkerContainer` / UoW コンテキストのどれにも載っておらず適合テストからしか触れないもの）。本 Issue が最初の実利用者なので、ここで載せる。

| ポート | 現状 | 載せる先 | 要求元のステップ |
|---|---|---|---|
| `AccountDeletionManifestStore` | 配線ゼロ・必須 receipt 5 値がハードコード | `GlobalUnitOfWorkContext`（`WorkerContainer` にも読み側を置く）+ 必須 receipt 集合の宣言化（ADR-017） | 搭載は 6、宣言化は 29、利用は 28 / 30。「terminal header と `distributedOperationStore.deleteTerminal` を同一 transaction」「`beginDeletion` と同一 UserId shard transaction」は両ポートが同じ ctx にいないと書けない |
| `OAuthStateStore` | `di/memoryRuntime.ts` で生成され `authStateSweeps` にだけ入っている（`RequestContainer` に無い） | `RequestContainer` | 13 / 14 / 20 |
| `NoteRouteFanOutReader` | 配線ゼロ | `RequestContainer`（読み取り専用の `Pick`） | 28（author route manifest 構築） |
| `LocalNoteProjectionWriter` | 配線ゼロ | `ScopeUnitOfWorkContext` | 30（author redaction / TC-identity-081, 082） |
| `PublicNoteProjectionWriter` | 配線ゼロ | `WorkerContainer` | 30（public 平面の redaction） |
| `StorageQuotaRepository` / `LlmUsageRepository`（新設） | — | Scope UoW に加えて `RequestContainer` に `usageReaderFor(scope)`（`Pick` で write を落とす） | 26 / 27。`getUsageSnapshot` と P-24 は読み取り経路なので、`noteReaderFor(scope)` と同じ #1 ADR-019 の規約に従う |

これらは `application/di/types.ts`（型）と `application/di/memoryRuntime.ts`（生成と受け渡し）、必要に応じて `application/execution/unitOfWork.ts` / `adapters/memory/{global,scope}UnitOfWork.ts` に反映する。該当ステップの対象ファイル一覧にこの 2〜4 本を必ず含める。

新設ポートの契約（適合スイートで固定する観測可能な結果）:

- `DistributedOperationStore`（ADR-013）: `beginOrResume({ kind, partitionKey, requestKey, payload })` — 同一 requestKey は既存 operation を返す / running があれば別 requestKey でも既存を返す / rejected 後の新 requestKey だけが新規を作る。`payload` は新規作成時に固定され resume では上書きされない（accountDeletion では uniqueness key を載せる — ADR-020）。**しきい値の判定もその材料の観測も `beginOrResume` に載せない**: 件数は独立メソッド `countTerminalSince(kind, partitionKey, since: Date): Promise<number>` が返し、8 件 / 120 日という業務規則は `AccountDeletionRetryPolicy`（domain）が持つ。受理経路は**数える → 判定する → 作る**の順に呼ぶ（spec 手順 2 の「8 件なら新 operation を作らない」を満たすため。作ってから巻き戻す形にしない）。`markState(operationId, state)`、`findByOperationId`、`deleteTerminal(operationId)`（manifest の terminal prune と同一 UoW から呼ぶ）。
- `ScopeTaskScheduler`（ADR-005）: `schedule({ kind, operationId, dueAt, payload })` は `(kind, operationId)` で upsert（operationId は生成元から決定的に導出するので再実行で増殖しない）、`claimDue(now, limit)`、`complete(kind, operationId)`、`backoff(kind, operationId)` は同じ行の `attempt` を増やし `dueAt` を指数後退させ、上限到達で `failed` にする（`spec/domains/index.md` 継続要求 4 規約）。
- `ScopeTaskQueue`（ADR-005）: `listDue(now, limit): Promise<readonly { scope: ScopeKey; kind: string; operationId: string }[]>` の 1 メソッドのみ。**読み取り専用で、処理も claim もしない**（claim は scope UoW 内の `ScopeTaskScheduler.claimDue` が引き続き担う）。memory 実装は `MemoryBackend.scopeEntries()` を走査し、`dueAt <= now` の行を `dueAt` 昇順で返す。#11 の DO Alarm 実装では scope 自身が起きるので空配列を返す実装になる。
- `AppliedOperationStore`（ADR-012）: `markApplied({ operationId, commandKey })` は `appliedOperationId = sha256(operationId + ":" + commandKey)` を PK に 1 行 insert し、未適用なら `true`、適用済みなら `false` を返す。**PK を単一列に畳むのは spec/database の `applied_operations`（PK は `operation_id` 単独）と同形を保つため**。spec の `result`（再試行へ返す JSON）は本 Issue の cleanup コマンドが値を返さない（ack は manifest の receipt が正本）ので持たせない — 逸脱としてステップ 34 の spec-sync 候補に載せる。scope 平面に閉じ、`IdempotencyStore`（`(consumer, eventId)` キー・worker container 側）は広げない。
- `IdentityUniqueDirectory` の拡張（ADR-015）: 既存 4 メソッドに加えて `beginRelease({ kind, normalizedKey, expectedUserId, operationId })`（`active` → `releasing`。所有者不一致・行不在は no-op、同一 operationId で冪等。**行の `operationId` を渡された解放 operation の ID へ差し替える** — memory 実装の `release(operationId)` は行の `operationId` 一致で対象を引くため、差し替えないと後続の `release` が対象を見つけられない）を足し、`release(operationId)` を `reserved` に加えて `releasing` の行も消す形にする。`DirectoryRow.state` に `"releasing"` を追加する（spec/database の `CHECK IN ('reserved','active','releasing')` に揃う）。適合スイートに「active → releasing → release の後は別 user が同じ key を reserve できる / 所有者違いの `beginRelease` は効かない / 再送で冪等 / `releasing` の間は他 user の `reserve` が通らず、`release` 完了後にだけ通る」を追加する。
- `AccountDeletionManifestStore` の改訂（ADR-017）: memory ファクトリーを `createMemoryAccountDeletionManifestStore(backend, { requiredFinalizeReceipts })` にし、ハードコードの `REQUIRED_FINALIZE_RECEIPTS`（5 値）を宣言集合で置き換える。適合スイートは `ConformanceBackendOptions.requiredFinalizeReceipts` から同じ集合を受け取り「宣言された全 receipt の ack で `allRequiredAcknowledged` が true / 1 つでも欠ければ false・`markCompleted` は ConflictError」へ一般化する。本 Issue の宣言は `personalCleanup` / `authResidue` / `uniquenessRelease` の 3 つ（`externalConnections` は #4、`jobHistory` は #5 の `AbsentReason`）。
- `ScopeCleanupAdmissionStore` の改訂（ADR-002 / ADR-018）: (a) 必須 component 集合を生成時オプション化（宣言は `storage` / `usage` の 2 つ）、(b) 読み取り `describePersonalCleanup(operationId): Promise<{ status: "running" | "completed"; acknowledged: readonly PersonalCleanupComponent[] } | null>` を追加（別 operation 所有 / receipt 不在は `null`）、(c) `markCompleted` は同一 operationId で completed 済みなら冪等 no-op、`acknowledgePersonalComponent` は completed 済み receipt への再送を成功 no-op にする。(b)(c) は継続の再駆動（応答喪失後）を冪等にするために要る。3 点とも適合スイートに追加する。

### ユースケース / アプリケーションロジック

追加する 20 ユースケース（`ServiceArgs<T>` + `view.ts` 射影という既存規約に従う）。

| テーマ | ユースケース | 置き場所 |
|---|---|---|
| メール確認 | `resendVerificationEmail` | `application/identity/` |
| OAuth | `startOAuthFlow` / `completeOAuthSignIn` / `linkOAuthIdentity` | 同上 |
| パスワード再設定 | `requestPasswordReset` / `resetPassword` | 同上 |
| 認証手段 | `listIdentities` / `addPasswordIdentity` / `changePassword` / `removeIdentity` / `signOut` / `signOutOtherSessions` | 同上 |
| プロフィール | `updateProfile` | 同上 |
| アバター | `storeAvatar` / `deleteFilesByOwner` | `application/storage/` |
| 使用量 | `getUsageSnapshot` / `recalculateStorageUsage` / `deleteQuota` | `application/usage/` |
| 削除 | `deleteAccount`（判別共用体入力 6 種）+ `getAccountDeletionStatus` | `application/identity/` |

横断のワーカー / コンシューマー（`application/workers/` および各ドメイン配下）:

- **購読者レジストリ** — `application/workers/subscribers.ts`。`{ eventType, consumerName, handle(event, deps) }` の配列で、リレーが配送したイベントの唯一の入口。`server.node.ts` の `consumerHandler` はこれを引くだけにする。本 Issue が登録するのは `authResidueCleanup` / `identityRemovalRelease` / `deleteStoredObjects` / `accountDeletion*Continued` の各ハンドラー。
- `authResidueCleanupConsumer` — `identity.userAuthResidueCleanupContinued` を処理。現 `authEpoch` を再確認し、`sessions` → `authTokens` の順に 100 件ずつ `deleteOlderEpochByUser`。同一 UoW で次タスク（同一表の継続 / 次表への切替 / 終了 + 削除起因なら auth 残渣 ack）を保存する。4 経路（resetPassword / changePassword / signOutOtherSessions / deleteAccount）が共有。
- `identityRemovalReleaseConsumer` — `identity.identity.removed` を受け、`providerAccountKey` の予約を `releasing → release` へ。`operationId` で冪等。
- `deleteStoredObjects` — `storage.fileDeleted` をまとめて受けて `ObjectStorage.deleteMany`（キー削除なので `IdempotencyStore` を使わない）。
- **cleanup 参加者レジストリ**（ADR-002 / ADR-017 / ADR-018）— `application/cleanup/participants.ts`。2 つの全数宣言を置く。
  - personal: `Record<PersonalCleanupComponent, Participant | AbsentReason>`（8 値を網羅しないと型で落ちる）。本 Issue の `Participant` は **`storage`（`deleteFilesByOwner`）/ `usage`（`deleteQuota`）の 2 つ**、`AbsentReason` は `job`（#5）/ `note`（編集・整理スライス）/ `tag`（整理スライス）/ `backup`（#4）/ `localProjection`（削除由来の local 投影 task を積む主体が本 Issue に無く、author redaction は manifest item ack として別勘定 — 編集・整理 / Note スライス）/ `outbox`（scope 平面から配送 ack を観測する読み側が無い。`storage.fileDeleted` の配送は `deleteStoredObjects` の冪等処理が担保 — #11 / scope outbox 読み側を持つスライス）。
  - global: `Record<Exclude<AccountDeletionReceipt, "personalAbort">, GlobalParticipant | AbsentReason>`。本 Issue の `GlobalParticipant` は `personalCleanup` / `authResidue` / `uniquenessRelease`、`AbsentReason` は `externalConnections`（#4）/ `jobHistory`（#5）。
  - どちらも必須集合は `Participant` / `GlobalParticipant` の側から導出し、composition root（`di/memoryRuntime.ts`）が `ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` の生成時に渡す。

ロジック配置の注意:

- 一意性予約サガ（reserve → UserId shard UoW → activate / release）は**ユースケースの手続き**であってドメインに置かない。3 kind（email / handle / providerAccount）で同じ形になるので、`application/identity/uniqueness.ts` に共通ヘルパーを置いて 4 ユースケース（completeOAuthSignIn / linkOAuthIdentity / updateProfile / deleteAccount の解放）が使う。
- 「資格情報発行と削除開始の直列化」（最終 UoW 内で `status` / `authEpoch` を再検査してから Session / Identity を insert）は spec 共通節の規約。Session 発行を伴う全ユースケース（verifyEmail / completeOAuthSignIn）と Identity 追加系で必ず入れる。
- 列挙耐性（`spec/adr/028-account-enumeration-resistance.md`、#1 の ADR-033）: `resendVerificationEmail` / `requestPasswordReset` は状態にかかわらず同一応答。分岐は送信の有無だけで、応答・所要時間に差を出さない。（#1 の ADR-028 は「サインアウトはフル遷移で router キャッシュを破棄する」で別物。同じ番号を 2 つの意味で引かない。）
- **通常 write 入口は `cleanupAdmission.assertWritable()` と `assertActorWritable(actorUserId)` の 2 本を呼ぶ**（`application/ports/scopeCleanupAdmissionStore.ts` の JSDoc「Every normal write entry point of every domain calls **both**」。既存の `createBlankNote` も 2 本立て）。本 Issue が追加する scope 平面の通常 write は `storeAvatar`（ステップ 24）と `recalculateStorageUsage`（ステップ 26）で、両方に 2 本とも入れる。本 Issue では actor ロック（membership prepare）が空なので挙動は変わらないが、#3 が prepare を入れた時点で差が出る。cleanup 経路（`deleteQuota` / `deleteFilesByOwner`）は cleanup token として `assertOwner` を通す側なので `assertWritable` を呼ばない。TC-identity-045（barrier 後に到着した Storage write の拒否）がこの呼び出しを検証する。
- personal barrier の完了と prune task は**同じ scope UoW で完了ユースケースが積む**（ADR-005）: `cleanupAdmission.markCompleted(operationId, retainUntil)` と `scopeTaskScheduler.schedule({ kind: "identity.personalBarrierPruneContinued", operationId: 決定的導出, dueAt: retainUntil })` を並べる。`application/ports/scopeCleanupAdmissionStore.ts` の JSDoc（「Completion stores ... a prune task」）を「呼び出し側が同一 UoW で積む」に直す。

### アダプター / 永続化 / 外部連携

- `adapters/memory/repositories/` に `storageQuotaRepository` / `llmUsageRepository` / `storedFileRepository` / `identityRemovalReceiptStore` / `distributedOperationStore` / `scopeTaskScheduler` / `appliedOperationStore` を追加し、`store.ts` の `MemoryBackend` に対応する表と行型を足す（`StorageQuotaRow` は subject シリアライズをキーに、`LlmUsageRow` は `(userId, year, month)`、`DistributedOperationRow` は `(kind, partitionKey, requestKey)` の一意制約と `state` / `terminalAt`、`ScheduledTaskRow` は `(kind, operationId)` 一意 + `dueAt` / `attempt` / `state`、`AppliedOperationRow` は scope ごとに `(operationId, commandKey)`）。
- `adapters/memory/objectStorage.ts` — プロセス内 `Map<objectKey, Uint8Array>`。`publicUrl(key)` は配信ルートのパス（`/storage/{key}`）を返す（ADR-011）。
- `adapters/oauth/{googleSignInOAuthClient,devSignInOAuthClient}.ts`（ADR-003）。`deriveCodeChallenge` は両アダプターが実装し、S256（`base64url(sha256(codeVerifier))`）を返す。
- `adapters/conformance/` に 9 スイート追加 + `backend.ts` の `ConformanceBackend` / `ScopedConformancePorts` / `ConformanceBackendOptions` 拡張 + `memory/__tests__/conformanceBackend.ts` の配線 + `conformance.test.ts` の登録行。既存スイートの改訂は 3 本（`scopeCleanupAdmissionStore` の宣言集合化 + `describePersonalCleanup` / 冪等 no-op、`accountDeletionManifestStore` の必須 receipt 宣言集合化 — ADR-017、`identityUniqueDirectory` の `releasing` 対応 — ADR-015）。`ScopeTaskQueue.listDue` は同じ表の読み側なので `scopeTaskScheduler` スイートに含める。`signInOAuthClient` スイートは Google 側だけ資格情報の有無で skip する。
- `adapters/memory/repositories/scopeCleanupAdmissionStore.ts` の必須 component 集合を生成時オプション化（ADR-002）。既存スイートの 8 固定 assert（`ALL_COMPONENTS`）は `ConformanceBackendOptions.requiredCleanupComponents` から受け取る宣言集合ベースへ書き換え、`conformanceBackend.ts` が `createMemoryScopeCleanupAdmissionStore` へ渡す。同様に `adapters/memory/repositories/accountDeletionManifestStore.ts` の `REQUIRED_FINALIZE_RECEIPTS`（5 値ハードコード）を `requiredFinalizeReceipts` オプション化し、適合スイートは `ConformanceBackendOptions.requiredFinalizeReceipts` から受け取る（ADR-017）。
- `di/types.ts` の `RequestContainer` / `WorkerContainer` に新ポートを追加する。`WorkerContainer` には `globalUnitOfWorkProvider` / `scopeUnitOfWorkProvider` と consumer が触るポート（`identityUniqueDirectory` / `identityRemovalReceiptStore` / `accountDeletionManifestStore` / `objectStorage`）を足し、「最初の非可換 consumer が着地した時点で UoW provider を足す」という現行 JSDoc をその事実に合わせて書き換える。読み取り専用で足りるものは `Pick` で write を落とす（#1 ADR-019 の規約）。`di/memoryRuntime.ts` が cleanup 参加者レジストリと OAuth クライアントの選択（env）を担う。
- OAuth クライアントの選択規則（ADR-003）を `di/serverNode.ts` の env スキーマに入れる: `OAUTH_DEV_MODE=true` なら dev IdP（ただし `NODE_ENV=production` との併用は起動時エラー）、そうでなく `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` があれば Google、どちらも無ければ起動失敗。`apps/web/.env.example` に `OAUTH_DEV_MODE=true` を既定の開発設定として記載する。
- **env を `createMemoryRuntime` へ届ける経路を作る**（現状は存在しない）。`di/serverNode.ts` の `memoryRuntime()` は `createMemoryRuntime()` を**引数なし**で呼ぶ `globalThis` シングルトンで、`readNodeServerEnv()` の結果は `AppConfig` と runner tuning にしか流れていない。`OAUTH_DEV_MODE` / `GOOGLE_OAUTH_*` / `DELETION_TICKET_KEY` を `MemoryRuntimeOptions` へ渡すために、`initNodeRuntime(env: NodeServerEnv): void`（1 度だけスロットへ `createMemoryRuntime(optionsFrom(env))` を書き込む。既に生成済みなら no-op）を `di/serverNode.ts` に足し、`apps/web/app/server.node.ts` の `boot()` の**先頭**（コンテナ生成より前）で呼ぶ。**起動失敗の判定は `nodeServerEnvSchema` 側に閉じる** — `createMemoryRuntime` 側に置くと env を持たない `createTestHarness()` が全ユニットテストで落ちる。未初期化のまま `memoryRuntime()` が呼ばれた場合（テスト経路）は現行どおり引数なしの既定（dev IdP・ランダム鍵）で生成する。
- 削除 status ticket の署名鍵は **composition root が供給する**（ADR-006 改訂）。`di/serverNode.ts` の env スキーマが `DELETION_TICKET_KEY` を読み、`createMemoryRuntime({ deletionTicketKeyRing })` へ渡し、`RequestContainer.deletionTicketKeyRing` として presentation に届く。未設定時はプロセス毎ランダム鍵（`ephemeralKeyRing()` と同じ既定）。`presentation/deletionTicket.ts` は `process.env` を読まない — `shareTokenKeyRing` と同じ供給経路に揃え、秘密の供給点を composition root の 1 系統に保つ。
- `adapters/memory/objectStorage.ts` の `publicUrl` が返すのは `/storage/{key}` のアプリ相対パスで、`updateProfile` の `avatarUrl` 検証は「同一オリジンの URL」= **アプリ相対パス（`/` 始まり、スキーム・ホスト・`//` を含まない）、または `AppConfig.appUrl` と同一オリジンの絶対 URL**を受理する（ADR-016）。検証は VO 構築側（`AvatarUrl`）に置き、`appUrl` は VO へ引数で渡す。
- Node runner に継続タスクランナー役を追加（ADR-005 / ADR-023）。駆動側は `ScopeTaskQueue.listDue`（`WorkerContainer`）で、`MemoryBackend.scopeEntries()` を使う memory 実装を `adapters/memory/scopeTaskQueue.ts` に置く。tick 間隔は `NodeWorkerRunnerTuning.scopeTaskIntervalMs`（既定 1,000 ms）+ `ScopeTaskTrigger` の commit 後 kick（`RelayTrigger` と同型の late-bind）。
- **global 平面の継続イベント ID を決定的にする**（ADR-019）。`application/execution/eventId.ts`（新規）に `mintEventIdFor(draft, mint)`（`draft.payload.continuationKey` が文字列なら `EventId.create(continuationKey)`、それ以外は `mint()`）を置き、`adapters/memory/{globalUnitOfWork,scopeUnitOfWork}.ts` の `attachEventIds(drafts, () => backend.mintEventId())` をこれ経由に差し替える。memory の `OutboxRepository.save` は `table.set(event.id, …)` なので、同じ ID の再保存は同じ行への upsert になり継続チェーンが二重化しない。

### UI / プレゼンテーション

**新設ルート**

| ルート | ページ | レイアウト | 主な server function |
|---|---|---|---|
| `/reset-password` | P-04 パスワード再設定 | L-03 | `requestPasswordResetFn` / `resetPasswordFn` |
| `/auth/callback/$provider` | P-05 OAuth コールバック | L-03 | `completeOAuthCallbackFn`（intent 分岐 — ADR-007） |
| `/settings`（レイアウト） | P-20 設定タブ | L-01 | — |
| `/settings/profile` | P-21 プロフィール設定 | L-01 + P-20 タブ | `updateProfileFn` / `uploadAvatarFn` |
| `/settings/auth` | P-22 ログイン方法設定 | 同上 | `listIdentitiesFn`（fragment）/ `addPasswordFn` / `changePasswordFn` / `removeIdentityFn` / `startOAuthLinkFn` / `signOutOtherSessionsFn` |
| `/settings/usage` | P-24 使用量 | 同上 | `renderUsage`（fragment） |
| `/settings/danger` | P-25 アカウント削除 | 同上 | `deleteAccountFn` / `getDeletionStatusFn`（ticket 付き） |
| `/storage/$key` | アバター等の配信（memory ObjectStorage） | — | — |
| `/dev/oauth/authorize` | dev IdP の同意画面（ADR-021。`OAUTH_DEV_MODE` が偽なら 404） | L-03 | —（GET でフォーム、承認 / キャンセルは `redirect_uri` へのリダイレクト） |

**新設コンポーネント**

- `components/layout/SettingsTabs/` — P-20。L-01 中央カラム上部の水平タブ（プロフィール / ログイン方法 / 使用量 / アカウント削除の 4 つ。連携タブは P-23 が #4 のため出さない）。`sm` 未満は横スクロール。
- `components/settings/ProfileForm/`（P-21。表示名 / 自己紹介 / ハンドル / アイコンアップロード。ハンドル重複時の候補提示、ハンドル変更の警告）
- `components/settings/IdentityList/` + `IdentityListSkeleton/`（P-22。**リスト増減は親 island が所有** — 追加も解除も親が server function を呼び、`useOptimistic` はリスト側に置く）
- `components/settings/AddPasswordForm/` / `ChangePasswordForm/`（P-22 内のダイアログ）
- `components/settings/UsagePanel/` + `UsagePanelSkeleton/`（P-24。fragment ストリーミング）
- `components/settings/DeleteAccountPanel/`（P-25。確認入力 → 実行 → status ticket ポーリング。ticket は応答 body で受け取り `sessionStorage` に保持、実行後もページに留まる）
- `components/auth/ResetPasswordPanel/`（P-04。申請 / 実行の 2 モード）
- `components/auth/OAuthCallbackPanel/`（P-05）
- `components/auth/OAuthButton/`（P-01 / P-02 の「Google で続ける」）
- `components/dev/DevConsentForm/`（ADR-021。メールアドレス・表示名・`email_verified` トグル・「許可する」「キャンセル」。`/dev/oauth/authorize` でのみ使う）

**既存コンポーネントの変更**

- `components/auth/SignInForm/` — Google ボタン、パスワード再設定リンク、確認メール再送リンクを追加。LOCKED 表示の「再設定して解除」を実リンクにする。
- `components/auth/SignUpForm/` — Google ボタンを追加。
- `components/auth/VerifyEmailPanel/` — 再送導線を追加。
- `components/layout/AccountMenu/` — 「設定」「プロフィール」導線を追加し、サインアウトを `signOut` ユースケース呼び出しへ差し替える（フル遷移は #1 ADR-028 のまま維持）。
- `presentation/errorDisplay.ts` — 新エラーコードの日本語文言を辞書に追加（`HANDLE_ALREADY_USED` / `PROVIDER_ACCOUNT_ALREADY_LINKED` / `OAUTH_STATE_INVALID` / `OAUTH_CODE_INVALID` / `OAUTH_EMAIL_UNVERIFIED` / `EXISTING_ACCOUNT_UNVERIFIED` / `ACCOUNT_UNAVAILABLE` / `CONFIRMATION_MISMATCH` / `INVALID_REQUEST_ID` / `AccountDeletionRetryLimitExceeded` / `LastIdentityCannotBeRemoved` / `PasswordIdentityAlreadyExists` / `IdentityLimitExceeded` / `InsufficientRole` / `StorageQuotaExceeded` / `UnsupportedMimeType` / `FileTooLarge` ほか）。サーバー由来文字列は描画しない（#1 ADR-037）。
- `presentation/deletionTicket.ts`（新規、ADR-006）。
- `routes/__root.tsx` — 新規 action モジュールの副作用 import を追加。
- `routes/signin.tsx` / `signup.tsx` / `verify-email.tsx` — 導線追加に伴う軽微な変更。

デザインは `spec/design/pages/P{03,04,05,21,22,24,25}*.html` に詳細モックがある。トークンは `apps/web/app/styles/tokens.css`（`spec/design/tokens.md` の生成物）を再利用し、値を再定義しない。

---

## 実装ステップ

依存方向の順（内側が先）に並べる。

### テーマ間の依存

- **テーマ A（ステップ 1〜9）は全テーマの前提**。特にステップ 2（consumer 実行経路）→ 3（残渣掃除）、ステップ 4/5/6（削除の土台ポート）→ テーマ H、ステップ 9（`/settings` レイアウト + P-20 タブ）→ テーマ E / F / G / H の設定ページ。
- **テーマ E はテーマ C に依存する**: ステップ 22（P-22）の「Google 追加」はステップ 14（`startOAuthFlow(intent: "linkIdentity")`）とステップ 13（OAuth アダプター）を要する。ステップ 20（`linkOAuthIdentity`）も同様。
- **テーマ B / C / D は相互に独立**（並列可）。**テーマ F / G はテーマ A の 7・8・9 に依存**するが相互には独立。加えて **テーマ F はテーマ C にも依存する**: ステップ 23（`updateProfile`）は所有者がステップ 14（テーマ C）の `application/identity/uniqueness.ts` へ追記する形なので、14 の完了を待つ（共有ファイル所有表と同じ関係）。
- **テーマ H は A 全体と F（`storeAvatar` / `deleteFiles`）・G（`deleteQuota` の前提）に依存**するので、28 → 29 → 30 → 31 → 32 → 33 の順に直列で進める。

### 品質ゲート

34 ステップ・7 テーマ・共有ファイル 9 本の並行編集という規模なので、**各テーマの終端（ステップ 9 / 12 / 15 / 17 / 22 / 25 / 27 / 30 / 33）で `pnpm typecheck && pnpm test:unit` を実行して緑を確認してから次のテーマへ進む**。`di/types.ts` / `di/memoryRuntime.ts` / `execution/unitOfWork.ts` の同時編集による破損を、最後のステップ 34 まで持ち越さないための最小のゲート。ステップ 29 の「一般化は先頭で単独コミット」も同じ趣旨。

### 共有ファイルの所有ステップ

並列に走らせるときの上書き事故を避けるため、複数ステップが触るファイルは所有者を決め、非所有ステップは**追記のみ**とする。

| ファイル | 所有ステップ | 追記するステップ |
|---|---|---|
| `application/identity/uniqueness.ts` | 14（テーマ C） | 20, 23, 30 |
| `components/auth/SignInForm/` | 12（テーマ B） | 15, 17 |
| `components/layout/AccountMenu/` | 9（テーマ A） | 21 |
| `application/execution/unitOfWork.ts` / `adapters/memory/{global,scope}UnitOfWork.ts` / `adapters/conformance/backend.ts` | 1（Global 側）/ 4（Scope 側） | 5, 6, 7, 8 |
| `application/workers/subscribers.ts` | 2 | 3, 19, 29, 30 |
| `apps/web/app/routes/__root.tsx` | 9 | 導線を足す全ステップ（末尾に 1 行ずつ追加） |
| `adapters/memory/store.ts` | 1 | 4, 5, 6, 7, 8 |
| `application/di/{types.ts,memoryRuntime.ts}` | 1 | 2, 4, 5, 6, 7, 8, 13, 26, 28, 29, 30, 31（本 Issue で最も多くのステップが触るファイル。フィールドの追加のみで、既存の生成順序を並べ替えない） |
| `adapters/memory/scopeUnitOfWork.ts` | 4（Scope 側） | 5, 7, 8, 29, 30, 31（29 は `createMemoryScopeCleanupAdmissionStore(scopeStore)` の生成箇所なので必須 component 集合の受け渡しで、31 は `mintEventIdFor` への差し替えでここを触る） |
| `application/identity/view.ts` | 10（テーマ B） | 14, 16, 18, 23, 28（各ユースケースの DTO 射影を末尾に追加するだけ。既存の射影を書き換えない） |
| `application/identity/eventDecoders.ts` | 3（テーマ A） | 19（`identity.identity.removed` のデコーダーを追加） |
| `apps/web/app/routes/settings/-action.tsx` | 22（テーマ E） | 25（P-21 の server function を追記。P-22 / P-21 の server function が同居するので、`__root.tsx` の副作用 import は 1 行で足りる） |
| `apps/web/app/presentation/errorDisplay.ts` | 12（テーマ B — 最初に新コードを足す UI ステップ） | 15, 17, 22, 25, 27, 32（各ステップが自分の新エラーコードの文言を辞書へ**追記のみ**。既存エントリを書き換えない） |

### テーマ A: 共通基盤

#### 1. Identity の解除受領ポート（+ Global UoW 搭載）と `IdentityUniqueDirectory` の解放 API 拡張

- **対象ファイル:** `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`、`packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`、`packages/core/src/adapters/conformance/identityUniqueDirectory.ts`、`packages/core/src/domain/identity/errorCode.ts`、`packages/core/src/application/ports/identityRemovalReceiptStore.ts`（新規）、`packages/core/src/adapters/memory/repositories/identityRemovalReceiptStore.ts`（新規）、`packages/core/src/adapters/memory/store.ts`、`packages/core/src/application/execution/unitOfWork.ts`、`packages/core/src/adapters/memory/globalUnitOfWork.ts`、`packages/core/src/adapters/conformance/identityRemovalReceiptStore.ts`（新規）、`adapters/conformance/backend.ts`、`adapters/memory/__tests__/{conformanceBackend.ts,conformance.test.ts}`、`application/di/{types.ts,memoryRuntime.ts}`
- **変更内容:** (1) `IdentityUniqueDirectory` に `beginRelease({ kind, normalizedKey, expectedUserId, operationId })` を足し、`release` を `releasing` 対応にし、`DirectoryRow.state` に `"releasing"` を追加して既存適合スイートを拡張する（ADR-015）。**この拡張は既存ポート・既存スイートに触るので、単独コミットで先に緑にしてから (2) へ進む**。(2) 30 日保持の解除受領（`operationId` / `identityId` / `userId` / `kind` / `providerAccountKey` / `expiresAt`）の永続化ポートと memory 実装、適合スイートを追加し、`GlobalUnitOfWorkContext` に載せる。(3) `IdentityErrorCode` に `AccountDeletionRetryLimitExceeded` を追加する（ステップ 6 / 28 が使う）。
- **理由:** `removeIdentity`（ステップ 19）と `deleteAccount` の provider 予約解放（ステップ 30）が同じ受領を読む。Identity 行が消えた後に `providerAccountKey` を再構築できないので、受領が唯一の根拠になる。手順 3 は「行削除 + 受領 + outbox」を同一 UoW で要求するため、コンテキスト搭載が契約の一部。予約解放 API はステップ 19・23・30 の 3 つが共有するので、ここに前倒しする（無いと TC-identity-093 / 094 が構造的に通らない）。

#### 2. グローバルイベント consumer の実行経路

- **対象ファイル:** `packages/core/src/application/workers/subscribers.ts`（新規）、`packages/core/src/application/di/types.ts`（`WorkerContainer` 拡張と JSDoc 更新）、`packages/core/src/application/di/memoryRuntime.ts`（`createWorkerContainer`）、`apps/web/app/server.node.ts`、`apps/web/app/worker/node/runner.ts`、`packages/core/src/application/workers/__tests__/subscribers.test.ts`（新規）
- **変更内容:** リレーが配送したイベントを購読者へ振り分けるレジストリを作り、`server.node.ts:97` の `consumerHandler: async () => {}` をレジストリ呼び出しに差し替える。`WorkerContainer` に `globalUnitOfWorkProvider` / `scopeUnitOfWorkProvider` と、**この時点で型が存在するポートだけ**（`identityUniqueDirectory` / `identityRemovalReceiptStore`（ステップ 1）/ `accountDeletionManifestStore`（#1 で完成済み・未配線））を追加し、`types.ts` の「最初の非可換 consumer が着地した時点で UoW provider を足す」という JSDoc を実際の内容へ更新する。**`objectStorage` はステップ 8 が、`publicNoteProjectionWriter` はステップ 30 が自分で `WorkerContainer` へ載せる**（ポートの新設・搭載表と依存順を合わせる。ここで先に書くと型が存在せずコンパイルできない）。未登録イベントは warn ログのみで ack（イベント種別の増加でリレーを止めない）。
- **理由:** 本 Issue はこのリポジトリで最初の実イベント consumer（ステップ 3 / 19 / 29 / 30）を導入する。この経路が無いと consumer は単体テストからしか呼ばれない dead code になり、AC-29 / AC-32 とマニュアル TC-14 が成立しない。

#### 3. 認証残渣クリーンアップの共有コンシューマー

- **対象ファイル:** `packages/core/src/application/identity/authResidueCleanup.ts`（新規）、`packages/core/src/application/identity/eventDecoders.ts`、`application/workers/subscribers.ts`、`packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts`（新規）
- **変更内容:** `identity.userAuthResidueCleanupContinued { userId, authEpoch, table, deletionOperationId? }` を処理する。現 `User.authEpoch` を再読して payload が古ければ終了。`deleteOlderEpochByUser(userId, authEpoch, 100)` を対象表 1 つに対して 1 回だけ実行し、100 件なら同一表の継続を、100 件未満なら `sessions` → `authTokens` の切替を、`authTokens` が 0 件になったら終了（削除起因なら manifest へ `authResidue` receipt を ack）を**同一 UoW で保存**する。現世代の行は決して消さない。
- **理由:** resetPassword / changePassword / signOutOtherSessions / deleteAccount の 4 経路が共有する。先に作ることで以降のテーマは発行だけを書けばよくなる。

#### 4. `ScopeTaskScheduler`（+ Scope UoW 搭載）

- **対象ファイル:** `packages/core/src/application/ports/scopeTaskScheduler.ts`（新規）、`adapters/memory/repositories/scopeTaskScheduler.ts`（新規）、`adapters/memory/store.ts`、`application/execution/unitOfWork.ts`、`adapters/memory/scopeUnitOfWork.ts`、`adapters/conformance/{scopeTaskScheduler.ts,backend.ts}`、`adapters/memory/__tests__/{conformanceBackend.ts,conformance.test.ts}`、`application/di/{types.ts,memoryRuntime.ts}`
- **変更内容:** 上の「新設する土台ポート」節の契約どおり実装する。`(kind, operationId)` の upsert、`dueAt` 順の `claimDue`、`backoff` による `attempt` / `dueAt` の指数後退と上限到達時の `failed` 遷移まで適合スイートで固定する。
- **理由:** `usage.userCleanupContinued` / `storage.ownerDeleteContinued` / `identity.personalBarrierPruneContinued` は scope 平面の `scheduled_tasks` で運ぶ（`spec/domains/index.md`）。ステップ 24・29 の usecase はこのポートが無いと型として書けない。ランナー役の配線はステップ 31。

#### 5. `AppliedOperationStore`（+ Scope UoW 搭載）

- **対象ファイル:** `packages/core/src/application/ports/appliedOperationStore.ts`（新規）、`adapters/memory/repositories/appliedOperationStore.ts`（新規）、`adapters/memory/store.ts`、`application/execution/unitOfWork.ts`、`adapters/memory/scopeUnitOfWork.ts`、`adapters/conformance/{appliedOperationStore.ts,backend.ts}` + 登録、`application/di/*`
- **変更内容:** `markApplied(operationId, commandKey)` を scope UoW から呼べる形で実装する（ADR-012）。
- **理由:** TC-identity-089 の期待結果が「同じ operation ID で再配送され、`applied_operations` により二重適用されず再開する」を明示している。既存の `IdempotencyStore` は `(consumer, eventId)` キーで worker container 側にしか無く、scope 平面の operationId + commandKey には使えない。

#### 6. `DistributedOperationStore`（+ Global UoW 搭載）

- **対象ファイル:** `packages/core/src/application/ports/distributedOperationStore.ts`（新規）、`adapters/memory/repositories/distributedOperationStore.ts`（新規）、`adapters/memory/store.ts`、`application/execution/unitOfWork.ts`、`adapters/memory/globalUnitOfWork.ts`、`adapters/conformance/{distributedOperationStore.ts,backend.ts}` + 登録、`application/di/*`
- **変更内容:** 上の契約どおり `beginOrResume`（`payload` つき）/ `countTerminalSince` / `markState` / `findByOperationId` / `deleteTerminal` の 5 メソッドを実装する（ADR-013 / ADR-020）。**しきい値判定はポートに載せない**: 「120 日窓で 8 件」は `domain/identity/services/accountDeletionRetryPolicy.ts`（**新規。作成はこのステップだけ**）に置き、ステップ 28 の受理経路が「`countTerminalSince` で数える → `ensureRetryable` で判定 → `beginOrResume` で作る」の順に呼ぶ。適合スイートが固定するのは「`since` 以降の保持中 terminal 行を正しく数える」「rejected 後の新 requestKey だけが新規を作る」「`payload` は新規作成時に固定され resume では初回の値が返る」までで、数値 8 と 120 日はスイートに焼き込まない（バックエンドごとに複製しない）。ドメインサービスの単体テストが 7 / 8 / 9 件の境界を見る。
- **理由:** `AccountDeletionManifestStore` の header は `requestKey` を持たず、利用者ごとの rejected attempt 件数も数えられない。TC-identity-050（同一 requestId の冪等）/ 053（running 中の別 requestId）/ 105（terminal prune）はこのストアの契約そのもの。`beginDeletion` と同一 UserId shard transaction で作る必要があるので Global UoW に載せる。`AccountDeletionManifestStore` 自体も現状どのコンテナ・UoW にも載っていないので、このステップで一緒に `GlobalUnitOfWorkContext` へ載せる（上の「既存ポートの実行経路への搭載」表）。**`AccountDeletionRetryPolicy` と `AccountDeletionRetryLimitExceeded` は本 Issue では到達不能な先行実装**（`rejected` を作る経路が #3 依存で、根拠行 `TC-identity-052` は見送り）なので、本ステップが要求する検証はドメイン単体テストの境界と `countTerminalSince` の適合スイートまで。行としての検証は #3（ADR-013 / plan.md の縮退）。

#### 7. Usage ドメイン + ポート + memory アダプター + 適合テスト

- **対象ファイル:** `packages/core/src/domain/usage/{valueObject.ts,storageQuota.ts,llmUsage.ts,events.ts,errorCode.ts,services/quotaEnforcement.ts,ports/{storageQuotaRepository.ts,llmUsageRepository.ts}}`（新規）、`domain/usage/__tests__/`（新規）、`adapters/memory/repositories/{storageQuotaRepository.ts,llmUsageRepository.ts}`（新規）、`adapters/memory/store.ts`、`application/execution/unitOfWork.ts`、`adapters/memory/scopeUnitOfWork.ts`、`adapters/conformance/{storageQuotaRepository.ts,llmUsageRepository.ts,backend.ts}`（新規 + 登録 4 手順）、`application/di/{types.ts,memoryRuntime.ts}`
- **変更内容:** 上の設計節の Usage 一式を実装し、`ScopeUnitOfWorkContext` と `ScopedConformancePorts` に両リポジトリを、`RequestContainer` に `usageReaderFor(scope)` を載せる。**`QuotaSubject.fromStorageOwner` だけはこのステップでは書けない** — `StorageOwner` はステップ 8 が新設する VO なので、`fromNoteOwner`（`NoteOwner` は既存）までを本ステップで実装し、`fromStorageOwner` はステップ 8 の変更内容として追加する。DOM-usage の該当行はステップ 8 完了時点でチェックする。
- **理由:** DOM-usage-001..017 / ADP-usage-001..009 はチェックリストの独立項目であり、getUsageSnapshot / deleteQuota / recalculateStorageUsage の前提。「依存方向の順（内側が先）」に対する唯一の例外がここ（Usage VO が Storage VO を参照する）なので、順序を入れ替えずに分割で解消する。

#### 8. Storage の avatar 最小コア + ObjectStorage + 適合テスト

- **対象ファイル:** `packages/core/src/domain/storage/{valueObject.ts,storedFile.ts,events.ts,errorCode.ts,services/uploadValidationPolicy.ts,ports/storedFileRepository.ts}`、`application/ports/objectStorage.ts`（新規）、`application/storage/deleteFiles.ts`（新規、共有手続き）、`adapters/memory/{objectStorage.ts,repositories/storedFileRepository.ts}`（新規）、`application/execution/unitOfWork.ts`、`adapters/memory/scopeUnitOfWork.ts`、`adapters/conformance/{storedFileRepository.ts,objectStorage.ts,backend.ts}`（新規 + 登録）、`application/workers/subscribers.ts`、`application/di/*`
- **対象ファイル（追加）:** `packages/core/src/domain/usage/valueObject.ts`（`QuotaSubject.fromStorageOwner`）
- **変更内容:** ADR-004 の範囲を実装する。VO は `StorageOwner` / `FileName` / `MimeType` / `ByteSize` / `FilePurpose` / `FileProvenance` / `ObjectKey`（`build`）/ `Checksum`。`ObjectStorage` は `put` / `get` / `deleteMany` / `publicUrl`（ADR-011。memory は `/storage/{key}` の相対パス — ADR-016）で、**このステップが `application/ports/objectStorage.ts` を新設し、同時に `WorkerContainer` へ載せる**（`deleteStoredObjects` 購読者が使う。ステップ 2 では型が無いので載せられない）。`StoredFileRepository` は `TransactionalRepository<StoredFile, StoredFileId>` を継承し、`listByOwner(owner, purpose: FilePurpose | null, pagination)` は `PaginationResult<StoredFile>` を返す（ADR-022）。`deleteFiles(fileIds, deletionOperationId)` は **1 件ずつ `findById` → `delete(id, expectedVersion)`** で消して `storage.fileDeleted` を収集する（不在 ID は無視。OCC トークンは `findById` の中でしか発行されないため `listByIds` の戻り値からは取れない）。`deleteStoredObjects` サブスクライバーをステップ 2 のレジストリへ登録する。`StorageOwner` を新設したうえで、ステップ 7 で保留した `QuotaSubject.fromStorageOwner` をここで足す。
- **理由:** `storeAvatar`（AC-19）と `deleteFilesByOwner`（削除の personal 参加者）の前提。`StorageOwner` は `ScopeKey` と同形の user / workspace なので、workspace 主体の `deleteFilesByOwner`（TC-storage-045）と `recalculateStorageUsage`（TC-usage-072）は Workspace ドメイン本体を要さずに成立する。

#### 9. `/settings` レイアウトルート + P-20 タブ + `AccountMenu` 導線

- **対象ファイル:** `apps/web/app/routes/settings/route.tsx`（新規）、`components/layout/SettingsTabs/`（新規）、`components/layout/AccountMenu/index.tsx`、`apps/web/app/routes/__root.tsx`
- **変更内容:** `/settings` をレイアウトルートにして L-01 中央カラム上部に P-20 のタブ列を置く（個人設定タブ列のみ 4 タブ。ワークスペース設定タブ列は #3）。`AccountMenu` に「設定」導線を追加する。
- **理由:** PAGE-p20-001..002。テーマ E / F / G / H の設定ページ（`/settings/{auth,profile,usage,danger}`）がこのレイアウトを親に持つので、A で先に確定させて暫定レイアウトの二重作りを防ぐ。

### テーマ B: メール確認

#### 10. `resendVerificationEmail`

- **対象ファイル:** `packages/core/src/application/identity/resendVerificationEmail.ts`（新規）、`application/identity/view.ts`、`application/identity/__tests__/resendVerificationEmail.test.ts`（新規）
- **変更内容:** email 正規化 → directory 解決 → `PendingUser` 以外は無送信で成功 → 直近 60 秒以内の発行があれば無送信で成功 → UserId shard UoW で「既存 pending トークン削除 + 新規 `issue`」を同一 transaction、commit 後に送信。応答は全経路同一。
- **理由:** TC-identity-194..199、AC-3。

#### 11. `verifyEmail` の TC 全消化

- **対象ファイル:** `packages/core/src/application/identity/verifyEmail.ts`、`application/identity/__tests__/verifyEmail.test.ts`
- **変更内容:** #1 で e2e 用に主要経路のみ検証していた分を、TC-identity-294..304 の全行へ拡張する。実装が仕様と食い違う点（用途違いトークン・`authEpoch` 不一致・利用者削除済み・並行消費の敗者が `alreadyVerified` に収斂しトークン / 利用者状態を壊さない）があれば実装側を修正する。
- **理由:** #1 の ADR-005 が「全 TC は後続スライスで消化」と明記した積み残し。

#### 12. P-03 / P-02 の再送導線

- **対象ファイル:** `apps/web/app/components/auth/VerifyEmailPanel/{index.tsx,action.ts}`、`components/auth/SignInForm/{index.tsx,action.ts}`、`apps/web/app/routes/__root.tsx`
- **変更内容:** 期限切れ / 無効状態から再送を要求できるようにする（送信中 / 送信済み / クールダウン中の三態、`useActionState`）。P-02 の「未確認」状態にも再送導線を出す。`spec/design/pages/P03-verify-email.html` に従う。
- **理由:** PAGE-p03-003、PAGE-p02-006（#1 で見送った行）。`PAGE-p03-001` / `PAGE-p03-002` / `PAGE-p03-004` は `VerifyEmailPanel` が #1 で 7 状態（処理中 / 成功 / 確認済み・サインインが必要 / 使用済み / 期限切れ / 無効 / 一時障害）とトークン消費・サインイン導線を実装済みなので、**本ステップでは「再送導線の追加」と「各状態が spec どおり出ることの確認」でチェックする**（AC-5 の 4 行はこのステップに紐づく）。

### テーマ C: OAuth

#### 13. `SignInOAuthClient` アダプター（Google + dev IdP）

- **対象ファイル:** `packages/core/src/domain/identity/ports/signInOAuthClient.ts`（`deriveCodeChallenge` 追加）、`packages/core/src/adapters/oauth/{googleSignInOAuthClient.ts,devSignInOAuthClient.ts,index.ts}`（新規）、`adapters/conformance/signInOAuthClient.ts`（新規）+ 登録、`packages/core/src/application/di/{types.ts,memoryRuntime.ts,serverNode.ts}`（`initNodeRuntime(env)` の新設を含む）、`apps/web/app/server.node.ts`（`boot()` 先頭で `initNodeRuntime(env)`）、`apps/web/app/routes/dev/oauth/authorize.tsx`（新規 — dev IdP の同意画面。ADR-021）、`apps/web/app/components/dev/DevConsentForm/`（新規）、`apps/web/app/routes/__root.tsx`、`apps/web/.env.example`、`docs/runtime_node.md`（必須 env の追記）
- **変更内容:** ADR-003 のとおり。認可 URL は PKCE（S256、`deriveCodeChallenge` で導出 — ADR-010）+ `state` + `redirect_uri`、交換は `code_verifier` 付き POST、`id_token` / userinfo から `providerAccountId` / `email` / `emailVerified` / `displayName` / `avatarUrl` を取る。プロバイダー側の拒否は `OAUTH_CODE_INVALID`、通信失敗は `SystemError(ExternalServiceError)` へ翻訳する。env による選択規則と production ガードを composition root の 1 箇所に閉じ、env は `initNodeRuntime(env)`（`boot()` の先頭で 1 度だけ呼ぶ）経由で `createMemoryRuntime(options)` に届ける — 現状 `memoryRuntime()` は引数なしのシングルトンで env が届かないため、この経路が無いと dev / Google の切り替え自体が配線できない。起動失敗の判定は `nodeServerEnvSchema` 側に置く（`createTestHarness` は env を持たないので `createMemoryRuntime` 側に置くと全ユニットテストが落ちる）。適合スイートは dev アダプターを無条件に、Google アダプターを `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` が揃っているときだけ実行する（登録行は常に置き、skip 条件を 1 箇所に書く — AC-6）。あわせて **`OAuthStateStore` を `RequestContainer` に載せる**（現状は `authStateSweeps` にしか入っておらず、ステップ 14 / 20 が型として書けない）。

  **dev IdP の同意画面**（ADR-021）: `/dev/oauth/authorize` を新設し、`validateSearch` で `client_id` / `redirect_uri` / `state` / `code_challenge` / `code_challenge_method` / `scope` を受ける。画面はメールアドレス・表示名の入力、`email_verified` トグル、「許可する」「キャンセル」の 2 ボタン。許可は `redirect_uri` へ `code` + `state`、キャンセルは `error=access_denied` + `state` を付けて遷移する。`devSignInOAuthClient.buildAuthorizationUrl` はこの URL を返し、`exchangeCode` は `code` から `providerAccountId` / `email` / `emailVerified` / `displayName` を復元する（不正な code は `OAUTH_CODE_INVALID`）。`redirect_uri` は `AppConfig.appUrl` と同一オリジンのパスのみ受理する。`OAUTH_DEV_MODE` が偽ならルートは 404 を返す（判定は composition root が供給するフラグを `RequestContainer` 経由で読み、ルート側で env を直読みしない）。**これが無いとマニュアル TC-05 手順 1〜2 と TC-40 が実行できない**（自動承認だとキャンセル経路が作れない）。
- **理由:** ADP-identity-033/034 相当。#1 で唯一残ったアダプター未実装ポート。

#### 14. `startOAuthFlow` / `completeOAuthSignIn`

- **対象ファイル:** `packages/core/src/application/identity/{startOAuthFlow.ts,completeOAuthSignIn.ts,uniqueness.ts}`（新規）、`application/identity/view.ts`、`application/identity/__tests__/{startOAuthFlow,completeOAuthSignIn}.test.ts`（新規）
- **変更内容:** `startOAuthFlow` は intent 別に state を作り（`codeVerifier` は `SecureTokenGenerator.issue`、`codeChallenge` は `signInOAuthClient.deriveCodeChallenge(codeVerifier)`、linkIdentity は `ActiveUser` 検査 + `authEpoch` 保持、`redirectTo` は相対パスのみ）10 分 TTL で `OAuthStateStore.put`。`completeOAuthSignIn` は `take` → `exchangeCode` → providerAccount 解決 → `AccountLinkingPolicy.decide` → createNew（email + providerAccount の 2 予約 → UserId shard UoW → 2 activate、途中失敗は全解放）/ linkToExisting（providerAccount 1 予約）/ refuse。最終 UoW で `ActiveUser` + epoch + `IdentityPolicy.ensureAddable` を再検査し、Identity と Session を同一 transaction で insert。`uniqueness.ts`（予約サガ共通ヘルパー）はこのステップが所有する。
- **理由:** UC-identity-005/006、TC-identity-024..038, 264..271。

#### 15. P-05 コールバックと P-01 / P-02 の Google 導線

- **対象ファイル:** `apps/web/app/routes/auth/callback.$provider.tsx`（新規）、`apps/web/app/routes/auth/-action.tsx`（新規）、`components/auth/OAuthCallbackPanel/`（新規）、`components/auth/OAuthButton/`（新規）、`components/auth/{SignInForm,SignUpForm}/`、`routes/__root.tsx`
- **変更内容:** コールバックは GET でページを描画し、マウント後に POST の server function で `state` / `code` を消費する（#1 ADR-007 の GET/POST 分離を踏襲）。分岐は state の intent のみ（ADR-007）。成功時は Cookie 発行 + `redirectTo`（同一オリジンのパスのみ）へ、キャンセル / state 不一致 / 期限切れ / 通信失敗 / スコープ不足を状態として出す。
- **理由:** PAGE-p05-001..003、PAGE-p01-003 / p02-003。マニュアル TC-40（同意のキャンセル）はここで検証する。

### テーマ D: パスワード再設定

#### 16. `requestPasswordReset` / `resetPassword`

- **対象ファイル:** `packages/core/src/application/identity/{requestPasswordReset.ts,resetPassword.ts}`（新規）、`application/identity/view.ts`、`application/identity/__tests__/`（新規 2 本）
- **変更内容:** `requestPasswordReset` は directory 解決 → 非 `ActiveUser` は無送信成功 → パスワード手段なしは `passwordResetUnavailable` 送信 → 既存 pending トークン削除 + `issue("password_reset")` を同一 UoW → commit 後送信。`resetPassword` は locate/hash → `ActiveUser` / purpose / status / epoch 検査 → `consume` → 強度検査 + hash → パスワード手段が無ければ `createPassword`、あれば `changePassword` → Identity 保存 + トークン消費 + `authEpoch+1` を同一 UoW（トークン保存の競合は全体ロールバックして `AUTH_TOKEN_NOT_FOUND` へ写す）→ `sessions` 表の残渣掃除タスクを発行。
- **理由:** UC-identity-011/012、TC-identity-187..193, 200..212。

#### 17. P-04 と P-02 の再設定導線

- **対象ファイル:** `apps/web/app/routes/reset-password.tsx`（新規）、`routes/-action` 相当（新規）、`components/auth/ResetPasswordPanel/`（新規）、`components/auth/SignInForm/index.tsx`、`routes/__root.tsx`
- **変更内容:** `?token=` の有無で申請モード / 実行モードを切り替える（`validateSearch`）。申請完了は常に同一文言。実行は新パスワード 2 回入力 + 強度表示、トークン無効・期限切れは再申請へ戻す。P-02 の「パスワードをお忘れですか」と LOCKED 表示の解除導線を実リンクにする。
- **理由:** PAGE-p04-001..004、PAGE-p02-004、および #1 の縮退（LOCKED の文言のみ）の解消。

### テーマ E: 認証手段管理（テーマ C に依存）

#### 18. `listIdentities` / `addPasswordIdentity` / `changePassword`

- **対象ファイル:** `packages/core/src/application/identity/{listIdentities.ts,addPasswordIdentity.ts,changePassword.ts}`（新規）、`view.ts`、`__tests__/`（新規 3 本）
- **変更内容:** `listIdentities` は `listByUserId` + `removable = 件数 ≥ 2`。`addPasswordIdentity` は `ensureAddable` + `ensurePasswordAddable` を事前検査し、最終 UoW 内で現在の集合に対して再検査。`changePassword` はパスワード手段の存在・現セッションの有効性・現パスワード検証 → Identity 更新 + `authEpoch+1` + **現セッションのみ** `refreshAuthEpoch` を同一 UoW → 残渣掃除タスク発行。
- **理由:** UC-identity-013/014/016、TC-identity-001..007, 017..023, 128..133。

#### 19. `removeIdentity` と予約解放コンシューマー

- **対象ファイル:** `packages/core/src/application/identity/removeIdentity.ts`（新規）、`application/identity/identityRemovalRelease.ts`（新規）、`eventDecoders.ts`、`application/workers/subscribers.ts`、`__tests__/`（新規 2 本）
- **変更内容:** 所有確認 → `IdentityPolicy.ensureRemovable` → `operationId = sha256("removeIdentity:" + identityId)` で「行削除 + 30 日受領 + `identity.identity.removed`」を同一 UoW。グローバルコンシューマー（ステップ 2 のレジストリに登録）が受領と primary 行不在を確認してから、受領の `providerAccountKey` を鍵に `beginRelease` → `release` で active 予約を解放する（`operationId` 冪等 — ADR-015）。同じ解除の再送は受領から成功を返す。
- **理由:** UC-identity-015、TC-identity-179..182, 184..186。

#### 20. `linkOAuthIdentity`

- **対象ファイル:** `packages/core/src/application/identity/linkOAuthIdentity.ts`（新規）、`application/identity/uniqueness.ts`（追記）、`__tests__/`（新規）
- **変更内容:** `take(state)` で intent が `linkIdentity` でなければ `OAUTH_STATE_INVALID`。`exchangeCode` → providerAccount directory 解決（他人の active/reserved は `PROVIDER_ACCOUNT_ALREADY_LINKED`）→ 予約 → UserId shard UoW で `ActiveUser` / `epoch === flowState.userAuthEpoch` / `ensureAddable` を再検査し、いずれか不成立なら保存せず**予約を解放**。成功時のみ `createOAuth` を保存 → activate。自分に既に紐づく provider account は冪等成功。
- **理由:** UC-identity-007、TC-identity-119..127。

#### 21. `signOut` / `signOutOtherSessions`

- **対象ファイル:** `packages/core/src/application/identity/{signOut.ts,signOutOtherSessions.ts}`（新規）、`__tests__/`（新規 2 本）、`apps/web/app/components/layout/AccountMenu/action.ts`
- **変更内容:** `signOut` は locate/hash → 見つかれば削除、不在・不正は成功。`signOutOtherSessions` は現セッション検証（userId 一致・未期限切れ・epoch 一致）→ `authEpoch+1` + 現セッションの `refreshAuthEpoch` を同一 UoW → `sessions` 表の残渣掃除タスク発行 → `{ revocationAccepted: true }`。`AccountMenu` のサインアウトを `signOut` 呼び出しへ差し替える（フル遷移は維持）。
- **理由:** UC-identity-009/010、TC-identity-238..246、および #1 ADR-008 の縮退解消（本 Issue の adr.md ADR-008）。

#### 22. P-22 ログイン方法設定ページ

- **対象ファイル:** `apps/web/app/routes/settings/auth.tsx`（新規）、`routes/settings/-action.tsx`（新規）、`components/settings/{IdentityList,IdentityListSkeleton,AddPasswordForm,ChangePasswordForm}/`（新規）、`routes/__root.tsx`
- **変更内容:** ステップ 9 の `/settings` レイアウトの子ルートとして実装する。一覧は fragment ストリーミング（`renderServerFragment` + `Suspense` + Skeleton）。**追加 / 解除はリスト増減なので親 island が所有**し、`useOptimistic` はリスト側に置く。解除は最後の 1 件で無効化し理由を表示。Google 追加は `startOAuthFlow(intent: "linkIdentity")` へ遷移。他端末サインアウトのボタンを置く。モックは `spec/design/pages/P22-settings-auth.html`。
- **理由:** PAGE-p22-001..006。

### テーマ F: プロフィールとアバター

#### 23. `updateProfile`

- **対象ファイル:** `packages/core/src/application/identity/updateProfile.ts`（新規）、`application/identity/uniqueness.ts`（追記）、`view.ts`、`__tests__/`（新規）
- **変更内容:** `PendingUser` は `EMAIL_NOT_VERIFIED`。ハンドル変更時は正規化して予約（他人の active/reserved は `HANDLE_ALREADY_USED`）→ `User.updateProfile` + `assignHandle` / `clearHandle` → UserId shard UoW で保存 → 期待バージョンで activate → 旧ハンドル予約を `beginRelease({ kind: "handle", normalizedKey: 旧ハンドル, expectedUserId, operationId })` → `release`（旧予約の親 operation ID は過去のものなので key ベースで解放する — ADR-015）。応答喪失の 2 経路（shard 更新前 / activate 応答喪失）から同じ operationId で再開できること。テストの検証境界は ADR-009 に従い「イベントの発行有無と payload」まで（TC-272 は値の更新 + `profileUpdated` 発行、TC-273 は表示名変更で発行、TC-274 は自己紹介のみなら非発行、TC-278 は `previousHandle` が旧ハンドル）。
- **理由:** UC-identity-017、TC-identity-272..275, 278..288, 290..293。

#### 24. `storeAvatar` と配信ルート

- **対象ファイル:** `packages/core/src/application/storage/storeAvatar.ts`（新規）、`application/storage/__tests__/storeAvatar.test.ts`（新規）、`apps/web/app/routes/storage.$key.tsx`（新規）
- **変更内容:** 本人（`subjectType: "user"` かつ自分）以外は拒否。workspace 主体は `WorkspaceAuthorization` が #3 のため常に `BusinessRuleError(InsufficientRole)`（ADR-014）。`UploadValidationPolicy.ensureAcceptable({purpose:"avatar"})` → `ObjectStorage.put` → `StoredFile.register` → UoW の先頭で `cleanupAdmission.assertWritable()` と `assertActorWritable(userId)` の 2 本を呼び、新アバター保存 + `listByOwner(owner, "avatar", { limit })` で引いた旧アバターの `deleteFiles` を**同一 UoW**。出力 DTO の `url` は `ObjectStorage.publicUrl(objectKey)`（ADR-011）で、配信ルートのパス形は memory アダプターだけが知る。
- **理由:** UC-storage-004、TC-storage-167, 170..174。TC-identity-045（barrier 後の Storage write 拒否）が `assertWritable` の呼び出しを検証する。マニュアル TC-36（GIF / 5MB 境界 / 6MB 拒否）もここが対象。

#### 25. P-21 プロフィール設定

- **対象ファイル:** `apps/web/app/routes/settings/profile.tsx`（新規）、`components/settings/ProfileForm/`（新規）、`routes/settings/-action.tsx`、`routes/__root.tsx`
- **変更内容:** 表示名 / 自己紹介 / ハンドル / アイコンの編集（`useActionState` + pending、ハンドル重複時の候補提示、ハンドル変更前の警告）。**アイコンは `uploadAvatarFn`（`storeAvatar`）→ 返った `url` を同フォームの `avatarUrl` として `updateProfileFn`（`updateProfile`）へ渡す 2 段**で `User.avatarUrl` に到達させる（ADR-016）。`storeAvatar` は `User` を書かないので、この経路が無いとアップロードは成功するのにプロフィールに反映されない。公開プロフィール preview（PAGE-p21-004）は #9 のため導線を出さない。モックは `P21-settings-profile.html`。
- **理由:** PAGE-p21-001..003、AC-20。マニュアル TC-10 手順 1〜4 / TC-36 がこの経路を通る。

### テーマ G: 使用量

#### 26. `getUsageSnapshot` / `recalculateStorageUsage`

- **対象ファイル:** `packages/core/src/application/usage/{getUsageSnapshot.ts,recalculateStorageUsage.ts,view.ts}`（新規）、`application/usage/__tests__/`（新規 2 本）
- **変更内容:** `getUsageSnapshot` は personal scope の `StorageQuota` / 当月 `LlmUsage`（不在は初期値）→ `QuotaEnforcement.describe` → `updatedAt` は読んだ行の最大値。**workspace セクションは常に空配列を返す**（`membership_directory` からの keyset ページングと `workspace_directory` による名前解決に必要なポートが実コードに無く、本 Issue では新設しない。上限 20 / 並行 6 / ページ部分失敗時の `state: "unavailable"` も含めて**ページング自体を #3 で実装する** — plan.md の縮退に記録し、TC-usage-048..054 は見送り）。`recalculateStorageUsage` は UoW の先頭で `cleanupAdmission.assertWritable()` と `assertActorWritable(userId)` を呼び、`sumSizeByOwner`（artifact 除外）+ `countByOwner(owner, "all")` で保存する。**クォータ行が無い場合は `StorageQuota.initialize` → `insert`、ある場合は `save(expectedVersion)`** の 2 分岐にする（TC-usage-070。本 Issue は `initializeQuota` を実装しないので、これが唯一の行生成経路）。workspace 主体（TC-usage-072）は `StorageOwner` / `ScopeKey` の workspace 種別だけで成立し、Membership を要さない。
- **理由:** UC-usage-001/005、TC-usage-044..047, 055..059, 065..072。

#### 27. P-24 使用量ページ

- **対象ファイル:** `apps/web/app/routes/settings/usage.tsx`（新規）、`components/settings/{UsagePanel,UsagePanelSkeleton}/`（新規）、`routes/__root.tsx`
- **変更内容:** fragment ストリーミングで個人の容量・ノート件数・当月 LLM 回数・最終更新時刻を表示。80% 警告 / 上限到達の表示、削除画面（`/settings/danger`）への導線。workspace セクションと「さらに読み込む」は行が空のため出さない（PAGE-p24-002 見送り）。モックは `P24-settings-usage.html`。
- **理由:** PAGE-p24-001, p24-003。

### テーマ H: アカウント削除（直列）

#### 28. 削除の受理・barrier・manifest 構築

- **対象ファイル:** `packages/core/src/application/identity/deleteAccount/{index.ts,input.ts,admission.ts,manifestBuild.ts}`（新規）、`application/identity/view.ts`、`application/di/{types.ts,memoryRuntime.ts}`（`NoteRouteFanOutReader` の `RequestContainer` 搭載）、`__tests__/deleteAccount.admission.test.ts` / `.manifestBuild.test.ts`（新規）。`domain/identity/services/accountDeletionRetryPolicy.ts` は**ステップ 6 で作成済み**なのでここでは呼ぶだけ。
- **変更内容:** 入力の判別共用体 6 種を型で表現する。`userRequest` は確認メール一致 / `requestId` UUID を検査したうえで、UserId shard UoW を **(1) `countTerminalSince(kind, userId, now − 120 日)` で数える → (2) `AccountDeletionRetryPolicy.ensureRetryable(count)`（超過なら `BusinessRuleError(AccountDeletionRetryLimitExceeded)`。resume では新しい terminal 行が増えないので、判定は新規を作りうる場合だけに掛ける） → (3) `distributedOperationStore.beginOrResume({ kind, partitionKey: userId, requestKey: requestId, payload })` で operation を決める → (4) **新規作成時のみ** `User.beginDeletion(activeUser, operationId, now)`（`deleting` + epoch バンプ）、**resume 時は `user.status === "deleting"` かつ `user.deletionOperationId === operation.id` の一致確認だけ**（不一致は `ConflictError`） → (5) personal barrier（`beginPersonalAccountDeletion`）を ack と同一ローカル transaction で受領」の順で回す。**(3)(4) の順序は必須**: `User.beginDeletion` は実コードで `ActiveUser` 限定・`operationId` 引数つき（`domain/identity/user.ts`）なので、`DeletingUser` に対して呼べず、無理に呼ぶと `authEpoch` を二重にバンプして走行中 cleanup の「現世代を消さない」不変条件を壊す。TC-identity-050 / 053 / 042 / 064 がこの分岐を通る。`payload` には uniqueness key `{ email: normalizedEmailKey, handle: normalizedHandleKey | null, providerAccounts: readonly string[]（最大 8） }` を PII が生きているこの時点で固定する（ADR-020。ステップ 30 の解放と応答喪失からの再開はこの payload だけを読む）。manifest 構築は membership ページ（`appendMembershipPage`、100 件・keyset・応答喪失からの再実行）→ author route ページ（`NoteRouteFanOutReader.listByCreatedBy`、署名付き generation cursor）→ `markBuilt`。**順序の注記**: spec 手順 3 は「全 membership barrier ack **後だけ**」author route 固定へ進むと定めている。本 Issue は membership edge が 0 件なので「membership ページ → author route ページ → `markBuilt`」が直列に見えるが、**#3 が prepare wave を足すときは membership ページと author route ページの *あいだ* に挿入する**（末尾に足すと barrier 前の in-flight workspace write を route scan が拾えなくなる）。コード上もこの 2 フェーズの間に拡張点を残す。先行 accept Saga の有界回復（`listActivatingByUser`）は #3 依存のため入れない（plan.md の縮退）。
- **理由:** UC-identity-020 の受理〜構築。TC-identity-039..043, 048..050, 053, 054, 095, 096, 100, 101（14 行）。

#### 29. cleanup 参加者レジストリと personal scope cleanup（`deleteQuota` / `deleteFilesByOwner`）

- **対象ファイル:** `packages/core/src/application/cleanup/participants.ts`（新規）、`adapters/memory/repositories/{scopeCleanupAdmissionStore.ts,accountDeletionManifestStore.ts}`、`adapters/memory/scopeUnitOfWork.ts`（`createMemoryScopeCleanupAdmissionStore` の実際の生成箇所。必須集合オプションをここで渡す）、`adapters/memory/globalUnitOfWork.ts`（manifest ストアの生成箇所。必須 receipt 集合をここで渡す）、`application/di/memoryRuntime.ts`（2 つの宣言の供給）、`adapters/conformance/{scopeCleanupAdmissionStore.ts,accountDeletionManifestStore.ts,backend.ts}`、`adapters/memory/__tests__/conformanceBackend.ts`、`application/ports/{scopeCleanupAdmissionStore.ts,accountDeletionManifestStore.ts}`（JSDoc と `describePersonalCleanup` の追加）、`application/usage/deleteQuota.ts`（新規）、`application/storage/deleteFilesByOwner.ts`（新規）、`application/identity/deleteAccount/cleanupDispatch.ts`（新規）、`application/workers/subscribers.ts`、各 `__tests__/`
- **変更内容:** (1) **宣言集合化を先に単独コミットで緑にする**（#1 の完成物 2 ポートに手が入るため）。(1-a) `ScopeCleanupAdmissionStore`: 必須 component 集合を生成時オプション化し、適合スイートの 8 値固定 assert を `ConformanceBackendOptions.requiredCleanupComponents` 経由へ一般化する。あわせて `describePersonalCleanup(operationId)` を追加し、`markCompleted` の completed 冪等・`acknowledgePersonalComponent` の completed 後 no-op を契約に足す（ADR-018）。(1-b) `AccountDeletionManifestStore`: `REQUIRED_FINALIZE_RECEIPTS` のハードコード 5 値を `requiredFinalizeReceipts` オプションへ置き換え、適合スイートを `ConformanceBackendOptions.requiredFinalizeReceipts` 経由へ一般化する（ADR-017。**これをやらないと `externalConnections` / `jobHistory` を ack する主体が本 Issue に無く `markCompleted` に永久に到達しない**）。宣言は `participants.ts` の全数宣言（personal: `storage` / `usage`、global: `personalCleanup` / `authResidue` / `uniquenessRelease`）から導出する。
  (2) `deleteQuota`（`assertOwner` → `StorageQuotaRepository.delete` → user なら `LlmUsageRepository.deleteByUser(userId, 100)`、100 件なら同一 UoW で `scopeTaskScheduler.schedule` による継続再登録、100 件未満で `acknowledgePersonalComponent("usage")`）。
  (3) `deleteFilesByOwner`（`assertOwner` → `listByOwner(owner, null, { limit: batchSize ≤ 100 })` → `deleteFiles` → `PaginationResult` に残件があれば継続 1 つだけ再登録、0 件削除なら `scopeTaskScheduler.backoff`、対象 0 件 / 残件なしは正常終端 + `acknowledgePersonalComponent("storage")`）。
  (4) オーケストレーター側の cleanup phase dispatch（`claimPending("cleanup", 100)` → 宣言された participant（`storage` / `usage`）へコマンド → 受け手は `appliedOperationStore.markApplied(operationId, commandKey)` で重複排除 → ack を `acknowledge` で記録）。**`localProjection` / `outbox` へはコマンドを送らない**（`AbsentReason` — ADR-018）。
  (5) **完了と scope→global ブリッジ**: 継続ハンドラーは `describePersonalCleanup(operationId)` を読み、running かつ宣言集合の全 ack が揃っていれば同じ scope UoW で `markCompleted(operationId, now + 120 日)` と `identity.personalBarrierPruneContinued` の task 登録を行って `{ completed: true }` を返す（ADR-005）。**その戻り（= commit ack）を受けた後に**、別の global UoW で `accountDeletionManifestStore.acknowledgeReceipt(operationId, "personalCleanup")` と次 phase の継続イベント（決定的 `continuationKey` つき — ADR-019）を保存する。UoW はネストしない。応答喪失後の再駆動は `describePersonalCleanup` が `completed` を返すので、global ack だけをやり直す。
- **理由:** UC-usage-007 / UC-storage-013 と、AC-26 の personal 経路。TC-usage-026..030, 032, 033、TC-storage-037..043, 045..050、TC-identity-044..047, 084..087, 089（9 行。TC-identity-083 は `note` / `tag` / `backup` participant 不在のため見送り）。**TC-identity-044 は `note` participant が不在なので、「personal File write（`storeAvatar`）が barrier command より先に確定し、barrier ack 後の `deleteFilesByOwner` の owner scan がその行を回収する」形に読み替えて検証する**（AC-26 の注記と同じ読み替え）。TC-identity-045 は共通 `assertWritable` が `ACCOUNT_DELETING` で拒否することを Storage / Usage / Note（`createBlankNote`）の 3 経路で確認する。TC-storage-045（workspace 主体）と TC-storage-049（purpose によらず削除）は `StorageOwner` と `purpose: null` の呼び出しだけで成立するので実装対象。

#### 30. global cleanup・finalize・compaction・terminal prune

- **対象ファイル:** `packages/core/src/application/identity/deleteAccount/{globalCleanup.ts,finalize.ts,compaction.ts,terminalPrune.ts,authorRedaction.ts}`（新規）、`application/identity/uniqueness.ts`（追記）、`application/execution/unitOfWork.ts` / `adapters/memory/scopeUnitOfWork.ts` / `application/di/{types.ts,memoryRuntime.ts}`（`LocalNoteProjectionWriter` を `ScopeUnitOfWorkContext` へ、`PublicNoteProjectionWriter` を `WorkerContainer` へ搭載）、`application/workers/subscribers.ts`、`application/identity/__tests__/deleteAccount.*.test.ts`（新規）
- **変更内容:** global cleanup は Session / AuthToken の物理削除（ステップ 3 の共有コンシューマーを `deletionOperationId` 付きで駆動し、`authTokens` が 0 になったら `authResidue` receipt）+ email / handle / 全 providerAccount 予約の解放（完了時に `uniquenessRelease` receipt）。**順序は「解放 → receipt → finalize 検査 → PII 削除」**で、解放は finalize の**前**に置く（`spec/usecases/identity.md` 手順 4 の global cleanup が解放を担い、手順 5 の finalize が「全 uniqueness release を含む必須 receipt を検査する。揃えば PII を削除」と定めるため。逆順にすると receipt が永久に揃わない循環になる — ADR-015）。予約解放は `IdentityUniqueDirectory.beginRelease({ kind, normalizedKey, expectedUserId, operationId })` → `release(operationId)` の 2 段（ADR-015。`beginRelease` が行の `operationId` を解放 operation の ID へ差し替えるので、後続の `release` が対象を引ける）で、**鍵は受理時に operation payload へ固定した `{ email, handle, providerAccounts }` から取る**（ADR-020。過去の親 operation ID からは導出できず、PII 削除後は再構築もできないので、応答喪失からの再開もこの payload だけを読む）。TC-identity-093 / 094（削除後の同一メール・同一 provider account での再登録）がこの経路の唯一の検証行。author redaction は manifest の各 author route へ local / public 両平面の投影更新を送り、平面ごとに ack。TC-identity-082（削除前 Note event の遅延到着）は投影コンシューマー UC（Note スライス）ではなく `Local/PublicNoteProjectionWriter.replaceSnapshotIfNewer` に古い `authorVersion` を直接渡して旧表示名 / handle が復活しないことで検証する（ADR-009）。finalize は必須 receipt 集合（**ステップ 29 で宣言集合化した `allRequiredAcknowledged`**。本 Issue の宣言は `personalCleanup` / `authResidue` / `uniquenessRelease` の 3 つ — ADR-017）を確認 → user-coordination shard の UoW で directory edge と PII を削除 → `finalizeDeletion` → `identity.user.deleted`。`PublicNoteProjectionWriter` を `WorkerContainer` へ載せるのは**このステップ**（ステップ 2 では載せない）。compaction は 100 件ずつ、最後の 1 ページを空にする transaction で `markCompleted` / `markRejected`（`expiresAt = +120 日`）。terminal prune は `GlobalMaintenanceRunStore` の lane（generation / shard）で 100 件ずつ、checkpoint 再開つきで、manifest header と `distributedOperationStore.deleteTerminal` を同一 transaction で消す。
- **理由:** AC-26 / AC-27。TC-identity-081, 082, 090, 091, 093, 094, 102..107, 109..111（15 行。TC-identity-092 は `deleteNotesForOwner` と `/@handle` 公開ページの両方が本 Issue 外のため見送り）。

#### 31. 継続コマンドのランタイム配線

- **対象ファイル:** `apps/web/app/worker/node/runner.ts`、`apps/web/app/server.node.ts`、`packages/core/src/application/ports/scopeTaskQueue.ts`（新規）、`packages/core/src/adapters/memory/scopeTaskQueue.ts`（新規）、`adapters/conformance/scopeTaskScheduler.ts`（`listDue` の契約を追加）、`packages/core/src/application/workers/scopeTaskRunner.ts`（新規）、`packages/core/src/application/execution/eventId.ts`（新規 — `mintEventIdFor`）、`adapters/memory/{globalUnitOfWork.ts,scopeUnitOfWork.ts}`（採番を `mintEventIdFor` 経由へ）、`application/di/{types.ts,memoryRuntime.ts,serverNode.ts}`、`application/workers/__tests__/scopeTaskRunner.test.ts` / `application/execution/__tests__/eventId.test.ts`（新規）
- **変更内容:** ADR-005 のとおり、期限順に保存済み継続タスクを取り出して同じユースケースへ再投入するランナー役を Node runner に追加する。**駆動側は `ScopeTaskQueue.listDue(now, limit)`（`WorkerContainer`）**: `ScopeTaskScheduler` は `ScopeUnitOfWorkContext` の中にしか無く、`scopeUnitOfWorkProvider.run(scope, fn)` に scope を渡さないと触れないのに、`ScopeUnitOfWorkProvider` にも `ScopeRouter`（`forScope` / `resolveNote` のみ）にも `WorkerContainer` にも scope の一覧が無い — ランナーは「どの scope を叩くか」を自力では決められない。`listDue` が返した `{ scope, kind, operationId }` ごとに `scopeUnitOfWorkProvider.run(scope, …)` を開き、その中で `scopeTaskScheduler.claimDue` → ユースケース再投入 → `complete` / `backoff` を行う。

  **駆動間隔とトリガー**（ADR-023）: `NodeWorkerRunnerTuning` に `scopeTaskIntervalMs`（既定 **1,000 ms**）を足して scope task tick を 1 本増やす（tick は重ならないよう直列化し、`unref()` する — relay tick と同じ規律）。加えて `RelayTrigger` と同型の `ScopeTaskTrigger` を late-bind し（`bindNodeScopeTaskTrigger(trigger)` を `boot()` が呼ぶ）、`scopeTaskScheduler.schedule` を呼んだ scope UoW の **commit 後**に `kick()` する（同時 kick は 1 tick に畳む）。既存 relay の 60 秒間隔に合わせると継続 1 ラウンドごとに最大 60 秒待つことになり、AC-29 のブラウザー検証（マニュアル TC-14）が実用時間で終わらない。

  **global 平面の継続**は既存の outbox / relay に載せるが、イベント ID を生成元から決定的に導出する（ADR-019）: 継続イベントの payload に `continuationKey`（`"{eventType}:{operationId}:{phase}:{cursor ?? "-"}"`）を載せ、`application/execution/eventId.ts` の `mintEventIdFor` を両 UoW アダプターの採番点に挟む。これが無いと ack transaction の応答喪失後の再実行で継続チェーンが 2 本走る（TC-identity-096 / 101 / 105 の経路）。ユニットテストで「同じ `continuationKey` の draft を 2 回 collect しても outbox 行が 1 件」を固定する。プロセス再起動後も未完の継続を拾えること（`listDue` は永続表を読むだけなのでプロセス状態に依存しない）。
- **理由:** AC-29。`deleteAccount` が `pnpm dev` 上で完走しないとマニュアルテスト TC-14 が実行できない。

#### 32. P-25 アカウント削除ページと status ticket

- **対象ファイル:** `packages/core/src/application/identity/getAccountDeletionStatus.ts`（新規）、`packages/core/src/application/identity/__tests__/getAccountDeletionStatus.test.ts`（新規）、`application/di/{types.ts,memoryRuntime.ts}`（`DistributedOperationStore` の読み取りビュー `Pick<…, "findByOperationId">` を `RequestContainer` へ搭載）、`apps/web/app/presentation/deletionTicket.ts`（新規）、`apps/web/app/presentation/__tests__/deletionTicket.test.ts`（新規）、`apps/web/app/routes/settings/danger.tsx`（新規）、`components/settings/DeleteAccountPanel/`（新規）、`presentation/errorResponse.ts`、`routes/__root.tsx`、`apps/web/.env.example`
- **変更内容:** `getAccountDeletionStatus({ operationId })` を application に実装する（ADR-006 の「進捗照会は読み取り経路として application に置く」）。**書き込み UoW を通さない**: `RequestContainer` に載せた `DistributedOperationStore` の読み取りビュー（`Pick<…, "findByOperationId">`、#1 ADR-019 の `Pick` 規約）から `{ operationId, status }` を返し、ticket が示す 1 件以外は読めない（TC-identity-048）。UI 側は説明（削除されるもの / されないもの）→ メールアドレス確認入力 → 実行（202 + 応答 body の ticket + `Set-Cookie` でのセッション破棄）→ **画面遷移せず P-25 に留まって**ticket でステータスをポーリング（`accepted` / `running` / `completed` / `rejected` / `failed`）→ 完了表示に到達してから `window.location.assign("/")` でフル遷移して router キャッシュを破棄する（ADR-006）。ticket は `sessionStorage` に退避してリロードから復帰する。不一致は項目エラー。唯一 owner 由来の `rejected` 表示（PAGE-p25-004）は #3 のため出さない。モックは `P25-settings-danger.html`。
- **理由:** PAGE-p25-001..003、ADR-006、AC-28 / AC-29（status 照会経路）。TC-identity-048（セッション失効後に ticket で進捗を読む）はこのステップの `getAccountDeletionStatus` が根拠になる。マニュアル TC-38（確認入力の不一致）もここが対象。

#### 33. `deleteAccount` の TC 群の消化

- **対象ファイル:** `packages/core/src/application/identity/__tests__/deleteAccount.*.test.ts`、`application/identity/__tests__/deletionDriver.ts`（新規）
- **変更内容:** 継続入力を再投入するドライバー（`runUntilSettled(harness, operationId)`）を用意し、AC-26（25 行）+ AC-27（13 行）の計 38 行を TC ID つきで実装する。特に応答喪失系（042, 087, 096, 101, 105, 107, 111）と二重配送（050, 089）を、同一 operationId の再投入で検証する。TC-identity-085 は ADR-002 / ADR-018 の宣言集合（**`storage` / `usage` の 2 component**）で読み替えて「1 つでも欠ければ running のまま」を検証する。TC-identity-044 は ADR-018 の読み替え（personal File write → barrier ack 後の `deleteFilesByOwner` の owner scan が回収）で検証する。
- **理由:** 完了条件は「実装をレビューで確認できた行にのみチェック」。TC が対応の根拠になる。

### 仕上げ

#### 34. 見送り一覧の確定・横断確認・マニュアルテスト

- **対象ファイル:** `.thread/2/progress.md`（新規）、`docs/` の該当箇所、`spec/manual-tests/account.md` の実行記録
- **変更内容:**
  1. `DeletingUser` / `DeletedUser` が存在する状態で signIn / OAuth / passwordReset / linkIdentity が正しく倒れるかを横断で再確認（TC-identity-029, 122, 124, 189, 205, 266）。
  2. plan.md のスコープ表（ID 単位の 89 行）を `ID / 理由 / 引き継ぎ先` の 1 行ずつで Issue コメントへ転記する。見送り行にはチェックを付けない。実装 277 行はレビューで実装を確認できたものだけにチェックを付け、転記後に `チェック済み 277 + コメント記載 89 = 366` を数えて突合結果を併記する（AC-33）。
  3. 縮退と spec-sync 候補を整理して Issue コメント用にまとめる。**縮退は plan.md「縮退」節の全項目**（アバターの consumption / `noteCount` 未反映、Tag / Backup / Job / Note / localProjection / outbox の cleanup 参加者不在、`externalConnections` / `jobHistory` の finalize receipt 不在、dev IdP でのマニュアルテスト、`storeAvatar` の workspace 主体を常に拒否、先行 accept Saga の有界回復を省く、`AccountDeletionRetryPolicy` が到達不能な先行実装、`getUsageSnapshot` の workspace ページングを実装しない、受理応答 / barrier ack 喪失時の再駆動が利用者の再送依存、**P-20 の連携タブを出さない**、**P-22 の「再認証要求」状態を実装しない**、**Google アダプターの適合スイートが資格情報なし環境で skip される**）で、**チェックを付ける行の一部を欠く縮退は「どの ID のどの要素を欠いたか」を 1 行ずつ書く**（例: 「`PAGE-p20-001` は spec の 5 タブのうち連携を除く 4 タブでチェック」「`PAGE-p22-001` は spec の状態一覧のうち『再認証要求』を除いてチェック」）。spec-sync 候補は（必須 component 集合の宣言化、**finalize の必須 receipt 集合の宣言化**、`PROVIDER_ACCOUNT_ALREADY_LINKED` の担保箇所、`allRollbackReleased` と `personalAbort` の関係、`SignInOAuthClient.deriveCodeChallenge` と `ObjectStorage.publicUrl` の spec 追記、`addPasswordIdentity` の再認可の有無、**`IdentityUniqueDirectory` の `beginRelease` 追加と `releasing` 状態**、**`ScopeCleanupAdmissionStore.describePersonalCleanup` の追加**、**8 件 / 120 日の計数を manifest header ではなく `distributed_operations` に置いた**、**`DistributedOperationStore` の `payload` に uniqueness key を固定した**、**継続イベント payload の `continuationKey`（決定的 EventId 導出）**、**`applied_operations` を `ScopeCleanupAdmissionStore` と `AppliedOperationStore` の 2 ポートに分け、`result` を保持しない**、**削除 status ticket の鍵は実装の `AppConfig` 型ではなく composition root が供給する**）。
  4. Issue #1 のコメントに「#1 で見送った `PAGE-p01-003` / `PAGE-p02-003` / `PAGE-p02-004` / `PAGE-p02-006` / `ADP-identity-033/034` は本 Issue で実装済み」と追記する。
  5. Issue コメントに「既存の `apps/web/.env` を使っている場合は `OAUTH_DEV_MODE=true` を 1 行足さないと起動しない」（ADR-003 の規則 3）を明記する。
  6. `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test:unit` と、plan.md「マニュアルテストの実行範囲（AC-30）」表の実行分（30 件）を実行し、期待結果と異なった手順を「TC 番号・手順番号・観測結果・原因・対応（本 Issue で修正 / 別 Issue 番号）」の形で記録する。
- **理由:** Issue の完了条件（両節）と検証項。
