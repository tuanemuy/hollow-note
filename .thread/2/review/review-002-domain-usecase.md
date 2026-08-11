# レビュー 002 — Domain / Use Case

### Domain / Use Case

#### Blockers

- **[B-001]** `updateProfile` の一意性サガで、同じハンドルを同時に保存すると **敗者が勝者の予約を消す**。勝者の書き込みは commit 済みなのに directory に claim が残らず、呼び出し元にはエラーが返る
  - 場所: `packages/core/src/application/identity/updateProfile.ts:168-218`（`profileOperationId` / `releaseUniqueKeys`）、`packages/core/src/application/identity/uniqueness.ts:62-125`
  - 理由: `profileOperationId(userId)` は user 単位で決定的、`reservationOperationId` は `parent:kind:normalizedKey` なので、**同一 user が同一ハンドルを要求する 2 つの並行リクエストは同じ `operationId` の予約行を共有する**。`IdentityUniqueDirectory.reserve` は同一 `operationId` を冪等に受けるため（`packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:54-60`）、両者が「自分が予約を持っている」と信じる。片方が UoW を commit し、もう片方が `OPTIMISTIC_LOCK_FAILURE` で倒れて `releaseUniqueKeys` を呼ぶと、勝者の `reserved` 行が削除される。
    実際に再現テストを書いて実行した結果:
    `{"aError":"No reservation for operation identity.updateProfile:<userId>:handle:shared","storedHandle":"shared","directoryRow":null}`
    つまり (a) user 行は `handle="shared"` で確定、(b) directory に `handle:shared` の行が無い、(c) 成功した側の呼び出しは `ConflictError("UNIQUE_RESERVATION_NOT_FOUND")` を投げる（`activateUniqueKeys` の reconcile も `confirm()` 後に同じ `activate` を再試行するだけなので回復できない）。
    帰結は「一時的な過剰予約」ではなく整合性の破れで、この窓の間に別利用者が `shared` を取ると、元の利用者は `planHandle` の `reclaim` 経路で毎回 `HANDLE_ALREADY_USED` を踏み、**ハンドル欄を含むプロフィール保存が恒久的に通らなくなる**（P-21 のフォームは handle を常に送る）。plan.md のリスク欄が名指しする「失敗時の解放順序を誤ると恒久的な予約漏れになる」の裏返しのケースで、`TC-identity-293` は `displayName` だけを競合させるため（`__tests__/updateProfile.test.ts:354-376`、この経路では `reservations` が空）検出されていない。
  - 提案: 補償の解放を「この試行が実際に作った予約」に限定する。案 1: `IdentityUniqueDirectory.reserve` が「新規に確保したか / 既存行に相乗りしたか」を返し、`reserveUniqueKeys` はそれを `UniqueReservation` に載せて `releaseUniqueKeys` が相乗り分を飛ばす。案 2（ポート変更なし）: `updateProfile` の catch で `OPTIMISTIC_LOCK_FAILURE` のときだけ解放を行わない — 決定的 operationId の下ではこの敗北は「同一 operation の別試行が進行中」を意味するため。いずれの場合も、同一ハンドルの並行保存で「user 行のハンドルと directory の claim が一致する」ことを検証するテストを `updateProfile.test.ts` に足すこと。

#### Warnings

- **[W-001]** 旧ハンドルの `releaseActiveUniqueKey` に再駆動主体が無く、落ちると **誰も取れないハンドル**が残る
  - 場所: `packages/core/src/application/identity/updateProfile.ts:231-238`
  - 理由: 順序（新 key 予約 → commit → activate → 旧 key を releasing → release）自体は正しいが、`activate` 済みで `releaseActiveUniqueKey` 前にプロセスが落ちると、旧ハンドルの `active` 行が `expiresAt: null` のまま残る。`reserve` は他 operation の `active` 行を lapsed 扱いしないので、**他の利用者はその後永久にそのハンドルを取れない**（所有者本人は決定的 operationId のおかげで再取得できるが、本人がそうする動機は無い）。新ハンドル側には ADR-076 の `reclaim` という回復経路が用意されている一方、旧ハンドル側には対応する掃除が無く、plan.md の「縮退」にも記載が無い。
  - 提案: 少なくとも plan.md の縮退（引き継ぎ）に明記する。実装で閉じるなら、旧 key の解放を `identity.user.handleChanged` の購読者（`previousHandle` を持つ冪等なコンシューマー）へ移し、`updateProfile` は commit と同一 UoW でイベントを積むだけにするのが `removeIdentity` → `identityRemovalRelease` と同じ形になり一貫する。

- **[W-002]** `AvatarUrl` の同一オリジン不変条件が**型で表現されていない** — エンティティ側は素の `string | null` のまま
  - 場所: `packages/core/src/domain/identity/valueObject.ts:150-198`、`packages/core/src/domain/identity/user.ts:14, 145-152`
  - 理由: 新設した `AvatarUrl` は `updateProfile` ユースケースでしか構築されず、`User.updateProfile` の引数は `avatarUrl?: string | null`、`UserBase.avatarUrl` も `string | null`。同じファクトリーの中で `displayName` / `bio` は `DisplayName.create` / `Bio.create` を通しているのに、`avatarUrl` だけ検証されずに素通りする。CLAUDE.md の「値オブジェクト構築が 2 つ目の検証点」から外れ、将来 `User.updateProfile` を呼ぶ別経路（storage 側の直結など）が外部オリジン URL を保存しても型検査が止められない。
  - 提案: `UserBase.avatarUrl` を `AvatarUrl | null` にし、`User.updateProfile` は `AvatarUrl | null` を受ける（`appUrl` を要する構築はユースケースに残したままでよい）。`reconstruct` 側は `AvatarUrl` を持たない旧データを想定して `RehydrationError` かフォールバックを決める。

- **[W-003]** パスワードの業務規則がフロントに 2 箇所コピーされている
  - 場所: `apps/web/app/components/auth/ResetPasswordPanel/index.tsx:319-333`、`apps/web/app/components/settings/ChangePasswordForm/index.tsx:173-184`
  - 理由: `8 文字以上 128 以下 / 英字と数字を各 1`（`PlainPassword.create`、`packages/core/src/domain/identity/valueObject.ts:219-242`）と同じ判定を両コンポーネントが独自に書き直しており、しかも送信ボタンの活性をそれで決めている。ドメイン側の定数は module private なので、片方を変えるともう片方が黙って乖離する。同じ PR の `AVATAR_MAX_BYTES` は `UploadValidationPolicy` から export して import する正しい形になっているので、規律としても不揃い。
  - 提案: `PlainPassword`（またはドメインのポリシー）に `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` と `PlainPassword.isAcceptable(raw): boolean` を export し、2 コンポーネントはそれを import して「強度の段階付け」だけを持つ。

- **[W-004]** `EventSubscriber.consumerName` は誰も読まない死んだフィールドで、JSDoc が実在しない用途を主張している
  - 場所: `packages/core/src/application/workers/subscribers.ts:16-18`
  - 理由: 「`IdempotencyStore` の consumer key として使う」と書かれているが、ADR-024 の裁定で本 Issue の購読者はいずれも `IdempotencyStore` を通さないと決まっており、実際に非テストの参照は 0 件（唯一の読者は `__tests__/subscribers.test.ts:85` の一意性アサーション）。読み手は「どこかで冪等性の鍵として使われている」と誤読する。
  - 提案: 使う購読者が現れるまでフィールドを落とすか、JSDoc を「レジストリ内で購読者を識別するための名前。現時点で `IdempotencyStore` を通す購読者は無い（ADR-024）」に直す。

- **[W-005]** コード内の裸の `ADR-NNN` 参照が `.thread/2/adr.md` を指しており、`spec/adr/` の採番と衝突している
  - 場所: `packages/core/src/application/storage/storeAvatar.ts:60`（ADR-014）、`packages/core/src/domain/identity/valueObject.ts:153`（ADR-016）、`packages/core/src/application/identity/uniqueness.ts:154`（ADR-015）、`packages/core/src/application/execution/eventId.ts:12,16`（ADR-019 / ADR-025）ほか多数
  - 理由: `spec/adr/` は 001〜033 で、たとえば `spec/adr/014` は import result provenance、`spec/adr/028` は account enumeration resistance。一方コードが指しているのは `.thread/2/adr.md` の同番号（014 = `storeAvatar` の workspace 拒否、028 = `resolve` は `releasing` を解決しない）で、意味がまったく違う。`.thread/` はスライス作業用のファイルで恒久的な参照先ではないため、Issue が閉じた後にコードだけ残ると追跡不能になる。同じ PR 内でも `resendVerificationEmail.ts:22` は `spec/adr/028-account-enumeration-resistance.md` とフルパスで書いており不揃い。
  - 提案: 残す価値のある判断は `spec/adr/` へ昇格して（#1 の `docs: 設計判断を spec/adr へ昇格` と同じ扱い）フルパスで参照する。昇格しないものは番号を消し、理由を 1 行でその場に書く。

- **[W-006]** `runAccountDeletionGlobalCleanup` の JSDoc が、outbox の重複 id 契約と噛み合っていない
  - 場所: `packages/core/src/application/identity/deleteAccount/globalCleanup.ts:48-52`
  - 理由: 「receipt が既にあっても finalize 試行を再発行する / 応答喪失からの回復は再配送が担う」と書いてあるが、`accountDeletionDispatch` の `continuationKey` は `(operationId, phase, cursor)` から決定的に導出され、`OutboxRepository.save` は既存 id を「先着行をそのまま残す no-op」と契約している（`ports/outboxRepository.ts` の追記）。したがって同じ `finalize:uniquenessRelease` を再発行しても、行が生きている限り新しい配送は起きない。実際の正しさは「3 つの receipt それぞれが自分専用の finalize cursor を持ち、receipt の commit と同一トランザクションで発行される」ことで担保されているので**挙動は正しい**が、コメントの根拠は誤り。
  - 提案: 「再発行が回復手段」ではなく「各 receipt の ack と finalize 試行が同一トランザクションで、cursor が producer 名で分かれているため、最後に揃えた枝の試行だけは必ず新規行になる」と書き直す。

- **[W-007]** 継続イベントの決定的 ID が payload の文字列フィールド名に依存しており、型で守られていない
  - 場所: `packages/core/src/application/execution/eventId.ts:23-31`
  - 理由: `const key: unknown = draft.payload.continuationKey` という構造的な読み取りなので、将来どこかのドメインイベントの payload にたまたま `continuationKey` という文字列フィールドが生えると、そのイベントの ID が黙って決定的になり、`save` の重複スキップで**イベントが 1 度しか保存されなくなる**（ドメインイベントの重複は意味のある履歴だ、という同ファイルの前提が崩れる）。継続要求かどうかはイベントの種別で決まる性質なのに、実行時の文字列一致に落ちている。
  - 提案: `EventDraft` に任意の `deterministicId?: EventId`（またはブランド付きの `ContinuationDraft` 型）を持たせ、`IdentityContinuations.*` だけがそれを埋める形にする。`mintEventIdFor` は宣言されたフィールドだけを見ればよくなり、`unknown` の型アサーションも消える。

#### カバレッジ

- 確認:
  - `packages/core/src/domain/common/event.ts`
  - `packages/core/src/domain/identity/errorCode.ts`
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`
  - `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`
  - `packages/core/src/domain/identity/ports/signInOAuthClient.ts`
  - `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`
  - `packages/core/src/domain/identity/services/identityPolicy.ts`
  - `packages/core/src/domain/identity/services/sameOriginPolicy.ts`
  - `packages/core/src/domain/identity/valueObject.ts`
  - `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`
  - `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`
  - `packages/core/src/domain/storage/errorCode.ts`
  - `packages/core/src/domain/storage/events.ts`
  - `packages/core/src/domain/storage/ports/storedFileRepository.ts`
  - `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
  - `packages/core/src/domain/storage/storedFile.ts`
  - `packages/core/src/domain/storage/valueObject.ts`
  - `packages/core/src/domain/usage/errorCode.ts`
  - `packages/core/src/domain/usage/events.ts`
  - `packages/core/src/domain/usage/llmUsage.ts`
  - `packages/core/src/domain/usage/ports/llmUsageRepository.ts`
  - `packages/core/src/domain/usage/ports/storageQuotaRepository.ts`
  - `packages/core/src/domain/usage/services/quotaEnforcement.ts`
  - `packages/core/src/domain/usage/storageQuota.ts`
  - `packages/core/src/domain/usage/valueObject.ts`
  - `packages/core/src/application/cleanup/participants.ts`
  - `packages/core/src/application/cleanup/personalCleanup.ts`
  - `packages/core/src/application/di/memoryRuntime.ts`
  - `packages/core/src/application/di/serverNode.ts`
  - `packages/core/src/application/di/types.ts`
  - `packages/core/src/application/execution/eventId.ts`
  - `packages/core/src/application/execution/unitOfWork.ts`
  - `packages/core/src/application/identity/addPasswordIdentity.ts`
  - `packages/core/src/application/identity/authResidueCleanup.ts`
  - `packages/core/src/application/identity/changePassword.ts`
  - `packages/core/src/application/identity/checkHandleAvailability.ts`
  - `packages/core/src/application/identity/completeOAuthCallback.ts`
  - `packages/core/src/application/identity/completeOAuthSignIn.ts`
  - `packages/core/src/application/identity/continuations.ts`
  - `packages/core/src/application/identity/deleteAccount/admission.ts`
  - `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`
  - `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`
  - `packages/core/src/application/identity/deleteAccount/compaction.ts`
  - `packages/core/src/application/identity/deleteAccount/finalize.ts`
  - `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`
  - `packages/core/src/application/identity/deleteAccount/index.ts`
  - `packages/core/src/application/identity/deleteAccount/input.ts`
  - `packages/core/src/application/identity/deleteAccount/manifestBuild.ts`
  - `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`
  - `packages/core/src/application/identity/eventDecoders.ts`
  - `packages/core/src/application/identity/getAccountDeletionStatus.ts`
  - `packages/core/src/application/identity/getProfile.ts`
  - `packages/core/src/application/identity/identityRemovalRelease.ts`
  - `packages/core/src/application/identity/linkOAuthIdentity.ts`
  - `packages/core/src/application/identity/listIdentities.ts`
  - `packages/core/src/application/identity/pruneExpiredAuthState.ts`
  - `packages/core/src/application/identity/removeIdentity.ts`
  - `packages/core/src/application/identity/requestPasswordReset.ts`
  - `packages/core/src/application/identity/resendVerificationEmail.ts`
  - `packages/core/src/application/identity/resetPassword.ts`
  - `packages/core/src/application/identity/signOut.ts`
  - `packages/core/src/application/identity/signOutOtherSessions.ts`
  - `packages/core/src/application/identity/startOAuthFlow.ts`
  - `packages/core/src/application/identity/uniqueness.ts`
  - `packages/core/src/application/identity/updateProfile.ts`
  - `packages/core/src/application/identity/view.ts`
  - `packages/core/src/application/ports/accountDeletionManifestStore.ts`
  - `packages/core/src/application/ports/appliedOperationStore.ts`
  - `packages/core/src/application/ports/distributedOperationStore.ts`
  - `packages/core/src/application/ports/identityRemovalReceiptStore.ts`
  - `packages/core/src/application/ports/objectStorage.ts`
  - `packages/core/src/application/ports/outboxRepository.ts`
  - `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`
  - `packages/core/src/application/ports/scopeTaskQueue.ts`
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`
  - `packages/core/src/application/ports/scopeTaskTrigger.ts`
  - `packages/core/src/application/storage/deleteFiles.ts`
  - `packages/core/src/application/storage/deleteFilesByOwner.ts`
  - `packages/core/src/application/storage/deleteStoredObjects.ts`
  - `packages/core/src/application/storage/storeAvatar.ts`
  - `packages/core/src/application/storage/view.ts`
  - `packages/core/src/application/usage/deleteQuota.ts`
  - `packages/core/src/application/usage/getUsageSnapshot.ts`
  - `packages/core/src/application/usage/recalculateStorageUsage.ts`
  - `packages/core/src/application/usage/view.ts`
  - `packages/core/src/application/workers/eventRelayWorker.ts`
  - `packages/core/src/application/workers/scopeTaskRunner.ts`
  - `packages/core/src/application/workers/subscribers.ts`
  - `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts`
  - `packages/core/src/application/identity/__tests__/deleteAccount.globalCleanup.test.ts`
  - `packages/core/src/application/identity/__tests__/deletionDriver.ts`
  - `packages/core/src/application/identity/__tests__/updateProfile.test.ts`
  - `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`
  - `packages/core/src/adapters/memory/repositories/authTokenRepository.ts`
  - `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`
  - `packages/core/src/adapters/memory/scopeUnitOfWork.ts`
  - `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`
  - `apps/web/app/components/settings/ChangePasswordForm/index.tsx`
  - `apps/web/app/routes/settings/-action.tsx`
- スキップ: `.thread/2/**`（12 件） — 計画・ADR・レビュー記録で、レビュー対象の実装コードではない
- スキップ: `apps/web/**` の残り 55 件（コンポーネント / ルート / presentation / server・worker エントリー / `.env.example`） — フロントエンド・presentation 観点の担当で、ドメイン規則の漏れが疑われた 3 ファイルのみ個別確認した
- スキップ: `docs/runtime_node.md` — 運用ドキュメントで、ドメイン / ユースケースの判断を含まない
- スキップ: `packages/core/src/adapters/**` の残り 38 件（conformance スイート・memory アダプター・oauth アダプター） — アダプター観点の担当で、ポート契約の解釈確認に必要な 4 ファイルのみ個別確認した
- スキップ: `packages/core/src/application/**/__tests__/**` の残り 36 件と `di/__tests__`・`execution/__tests__`・`workers/__tests__` — テスト観点の担当で、本観点の結論に直結する 4 ファイル（残渣掃除・global cleanup・削除ドライバー・updateProfile）のみ個別確認した
- スキップ: `packages/core/src/application/__tests__/helpers.ts`, `packages/core/src/application/note/__tests__/createBlankNote.test.ts`, `packages/core/src/application/storage/eventDecoders.ts` — 前 2 者はテストハーネス、後者は wire デコーダーで業務判断を持たない
- スキップ: `packages/core/src/domain/identity/__tests__/policies.test.ts`, `packages/core/src/domain/storage/__tests__/storage.test.ts`, `packages/core/src/domain/usage/__tests__/quota.test.ts`, `packages/core/src/domain/usage/__tests__/valueObject.test.ts` — ドメイン単体テストでテスト観点の担当

（確認 99 件 + スキップ 151 件 = 250 件）
