# Domain / Use Case

R9（ゼロベース）。`git status` はクリーンな状態で実施し、共有ツリーへの変更は一切行っていない。

## Blockers

なし

## Warnings

- **[W-001]** `recalculateStorageUsage` に本番の駆動主体が無く、P-24 の個人使用量が構造的に常に 0 のまま／ 場所: `packages/core/src/application/usage/recalculateStorageUsage.ts:36`（呼び出し元不在）、`packages/core/src/application/usage/getUsageSnapshot.ts:44`、`apps/web/app/components/settings/UsagePanel/index.tsx:39` ／ 理由: 本 Issue には `applyStorageDelta` も `initializeQuota` も無いため `storage_quotas` の行を作る経路は `recalculateStorageUsage` だけ（AC-22 が「唯一の行生成経路」と明記）。ところが `grep -rn recalculateStorageUsage apps packages` で当たるのは定義と JSDoc 参照のみで、ルート・server function・worker・scope task のいずれからも呼ばれていない（`__tests__` を除くと呼び出し 0 件）。結果として `getUsageSnapshot` は常に `StorageQuota.initialize` にフォールバックし、P-24 は「0 B / 5 GB」「0 件のノート」を恒久的に表示する。plan.md / progress.md の縮退記録は「アバター保存時の `consumedBytes` と `noteCount` が即時反映されない … `sumSizeByOwner` / `countByOwner` の集計対象ではあるので `recalculateStorageUsage` で反映される」と書いており、**代替経路があることを前提にした記述になっている**が、その代替経路に駆動主体が無いことは記録されていない（＝決着済みの縮退として扱えない差分）。#1 で `createBlankNote` があるためノート件数は実際に増えるので、AC-23 の「個人の容量・ノート件数」は常に誤った値を出す。 ／ 提案: 実装で塞ぐなら P-24 のローダー（`UsagePanel/action.ts`）が `getUsageSnapshot` の前に `recalculateStorageUsage` を 1 回呼ぶ形が最小（`assertWritable` / `assertActorWritable` を通るので削除中は `ACCOUNT_DELETING` に倒れる。ただし表示のたびに write 経路になる点は要判断）。塞がないなら、縮退記録の当該行を「`recalculateStorageUsage` は実装済みだが本 Issue に駆動主体が無く、P-24 の個人使用量は常に 0 を表示する。実値の反映は `applyStorageDelta`（#6）まで到達しない」と**事実どおりに**書き換え、引き継ぎ先（#6）を明記すること。

## 所見（指摘に至らなかった確認事項）

以下は重点確認項目として追ったが、実害のある逸脱は見つからなかった。記録として残す。

- **UoW をネストしない**: `application` 配下の `globalUnitOfWorkProvider.run` / `scopeUnitOfWorkProvider.run` の呼び出しを全て追ったが、コールバック内で別の `run` を開く箇所は無い。scope→global の引き渡し（`acknowledgePersonalCleanup`）・`storeAvatar` の巻き戻し・`admitAccountDeletion` の barrier 取得はいずれも逐次実行。共有手順（`deleteStoredFiles` / `completePersonalCleanupIfDone`）は `ScopeUnitOfWorkContext` を引数で受け、自分では `run` を開かない。
- **継続の同一 UoW 要件**: `deleteFilesByOwner` / `deleteQuota` / `authResidueCleanup` / `manifestBuild` / `authorRedaction` / `compaction` はいずれも「そのターンの書き込み」と「次の継続」を同じ `run` の中で確定させている。`completePersonalCleanupIfDone` も `markCompleted` と prune task を同一 UoW に置いている。
- **決定的 EventId と「自分の鍵を再発行しない」規律**: `mintEventIdFor` は `continuationKey` があるときだけ ID を固定し、`OutboxRepository.save` の「先着行をそのまま残す」契約と組で fork を防ぐ。ターンごとに鍵が変わることも確認した（build は `phase:cursor`、redaction/compact は `nextTurn` の連番、finalize は発行元名 `uniquenessRelease` / `authResidue` / `redaction`）。鍵を変えられない `identity.userAuthResidueCleanupContinued` だけが `continuationKey` を持たず採番に落ちる（ADR-025）ので、`authTokens` の 2 ページ目が 1 ページ目と同じ ID に潰れる事故は起きない。
- **`authEpoch` バンプ 4 経路**: `resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount(beginDeletion)` の 4 つが同じ `authResidueCleanup` を呼び、いずれも `deleteOlderEpochByUser(userId, 現世代, 100)` の 1 形だけを使う。consumer 側は `user.authEpoch !== payload.authEpoch` を `stale` として打ち切るので、旧世代のチェーンが新世代の行を消すことはない。削除由来だけ `deletionOperationId` を運び、`authTokens` が 0 件になった **terminal turn のみ** `authResidue` receipt を積む。`beginDeletion` は resume 経路では呼ばれない（`admission.ts:124-132` が `resumed` を先に判定する）ので、再投入で世代が二重に進んで現世代の資格が消える事故も塞がれている。
- **一意性予約サガ 3 kind**: `reserveUniqueKeys` は途中失敗時に取得済みだけを解放し、`activateUniqueKeys` は `confirm` を 1 回に畳んで「グループが半分 activate・半分 release」になる状態を作らない。`updateProfile` の解放順序（新 key 予約 → commit → activate → 旧 key `releasing`→`release`）は spec 手順 4 どおりで、`OPTIMISTIC_LOCK_FAILURE` のときだけ補償解放しない（ADR-089）。`deleteAccount` の解放は finalize の**前**（`globalCleanup.ts`）で、receipt が自分自身を待つ循環になっていない。
- **削除オーケストレーション**: 受理は「数える → `ensureRetryable` → `beginOrResume` → `beginDeletion`」の順で、operation を作ってから巻き戻す形になっていない。barrier は global commit の**後**に scope 自身のトランザクションで取り、先行 write を scan に拾わせる。`allRequiredAcknowledged` は宣言集合の receipt に加えて **item ack も含む**（memory 実装で確認）ので、author redaction の未 ack で finalize が先行することはない。`compactItems` が空になったターンだけが `markCompleted` + `markState("completed")` を打つ。
- **`DeletingUser` / `DeletedUser` の倒れ方**: `startOAuthFlow`（`UNAUTHENTICATED`）/ `completeOAuthSignIn`（`ACCOUNT_UNAVAILABLE`）/ `linkOAuthIdentity`（`USER_NOT_FOUND` / `ACCOUNT_UNAVAILABLE`）/ `requestPasswordReset`・`resendVerificationEmail`（無送信・同一応答）/ `resetPassword`・`verifyEmail`（`AUTH_TOKEN_NOT_FOUND` / `USER_NOT_FOUND`）/ `updateProfile`・`getProfile`・`addPasswordIdentity`・`changePassword`・`signOutOtherSessions`（`ACCOUNT_UNAVAILABLE` / `UNAUTHENTICATED`）/ `storeAvatar`・`recalculateStorageUsage`（barrier の `ACCOUNT_DELETING`）まで一通り追った。`linkOAuthIdentity` の冪等 replay 分岐（`owner === userId`）だけ status を見ないが、identity を増やさない読み取りのみで、そもそも `deleting` 中はセッションが失効しているため到達しない。
- **Cross-layer catch policy**: `application` / `domain` 配下の `catch` を全数確認。補償解放（uniqueness / `storeAvatar` の object 巻き戻し）、best-effort な副作用（メール送信・ログ・backoff）、worker の行単位隔離（`eventRelayWorker` / `scopeTaskRunner` / `terminalPrune`）、`reconstruct` の `RehydrationError` 変換のみで、通常の業務ロジックを包む広い `try/catch` は無い。
- **入力バリデーション 2 点**: `settings/-action.tsx` の zod スキーマは形と DoS 上限だけを持ち、業務不変条件（表示名 50・自己紹介 500・ハンドル 3〜30 / 予約語・UUID・5MB）は VO / ドメインサービス側に一本化されている。`requestId` の UUID 判定を転送境界に写していない点（`deleteAccount/input.ts:106`）も規約どおり。
- **弁明・経緯コメント**: `TODO` / `FIXME` / `as any` / `@ts-expect-error` は 0 件。`packages/core/src/domain` `application` に「レビュー指摘への対応」といった経緯記述は無く、残っているコメントは全て WHY か library-level JSDoc。
- **テストによる担保**: `deleteAccount.*.test.ts` 8 本が TC ID 付きで admission / build / cleanup / globalCleanup / redaction / finalize / compaction / terminalPrune を押さえ、`deletionDriver.ts` の `runUntilSettled` が「1 ラウンドで何も動かなければ失敗」を明示的に落とすので、チェーンが止まったまま緑になる形にはなっていない。上記 W-001 だけが「実装はあるがどのテスト以外からも呼ばれない」経路。

## カバレッジ

**確認: 101 件**

- 契約・記録（3）: `.thread/2/plan.md`, `.thread/2/progress.md`, `.thread/2/adr.md`
- `packages/core/src/domain/**`（非テスト 29 件、全数）: `common/event.ts`, `identity/errorCode.ts`, `identity/ports/authTokenRepository.ts`, `identity/ports/identityUniqueDirectory.ts`, `identity/ports/signInOAuthClient.ts`, `identity/services/accountDeletionRetryPolicy.ts`, `identity/services/identityPolicy.ts`, `identity/services/sameOriginPolicy.ts`, `identity/user.ts`, `identity/valueObject.ts`, `note/ports/htmlProcessor.ts`, `note/ports/localNoteProjectionWriter.ts`, `note/ports/localNoteQueryService.ts`, `note/ports/publicNoteProjectionWriter.ts`, `note/valueObject.ts`, `storage/errorCode.ts`, `storage/events.ts`, `storage/ports/storedFileRepository.ts`, `storage/services/uploadValidationPolicy.ts`, `storage/storedFile.ts`, `storage/valueObject.ts`, `usage/errorCode.ts`, `usage/events.ts`, `usage/llmUsage.ts`, `usage/ports/llmUsageRepository.ts`, `usage/ports/storageQuotaRepository.ts`, `usage/services/quotaEnforcement.ts`, `usage/storageQuota.ts`, `usage/valueObject.ts`
- `packages/core/src/application/**`（非テスト 64 件、全数）: `cleanup/participants.ts`, `cleanup/personalCleanup.ts`, `di/memoryRuntime.ts`, `di/serverNode.ts`, `di/types.ts`, `execution/eventId.ts`, `execution/unitOfWork.ts`, `identity/addPasswordIdentity.ts`, `identity/authResidueCleanup.ts`, `identity/changePassword.ts`, `identity/checkHandleAvailability.ts`, `identity/completeOAuthCallback.ts`, `identity/completeOAuthSignIn.ts`, `identity/continuations.ts`, `identity/deleteAccount/{admission,authorRedaction,cleanupDispatch,compaction,finalize,globalCleanup,index,input,manifestBuild,terminalPrune}.ts`, `identity/eventDecoders.ts`, `identity/getAccountDeletionStatus.ts`, `identity/getProfile.ts`, `identity/identityRemovalRelease.ts`, `identity/linkOAuthIdentity.ts`, `identity/listIdentities.ts`, `identity/pruneExpiredAuthState.ts`, `identity/removeIdentity.ts`, `identity/requestPasswordReset.ts`, `identity/resendVerificationEmail.ts`, `identity/resetPassword.ts`, `identity/signOut.ts`, `identity/signOutOtherSessions.ts`, `identity/startOAuthFlow.ts`, `identity/uniqueness.ts`, `identity/updateProfile.ts`, `identity/view.ts`, `ports/{accountDeletionManifestStore,appliedOperationStore,distributedOperationStore,identityRemovalReceiptStore,objectStorage,outboxRepository,scopeCleanupAdmissionStore,scopeTaskQueue,scopeTaskScheduler,scopeTaskTrigger}.ts`, `storage/{deleteFiles,deleteFilesByOwner,deleteStoredObjects,eventDecoders,storeAvatar,view}.ts`, `usage/{deleteQuota,getUsageSnapshot,recalculateStorageUsage,view}.ts`, `workers/{eventRelayWorker,scopeTaskRunner,subscribers}.ts`
- 転送境界の確認のため参照（2）: `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/components/settings/UsagePanel/action.ts`
- 契約の実装確認のため参照（1）: `packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`（`allRequiredAcknowledged` / `markCompleted` / `compactItems` の該当箇所）
- テスト（2）: `packages/core/src/application/identity/__tests__/deleteAccount.recovery.test.ts`, `packages/core/src/application/identity/__tests__/deletionDriver.ts`

**スキップ: 203 件**

- `.thread/2/review/review-00*-*.md`（40）, `.thread/2/review/review-001.md`, `.thread/2/review/triage.md`, `.thread/2/steps.md`, `.thread/2/testing.md` — 計 44 件。過去レビュー記録はゼロベース指示により読まない。steps / testing は実装手順書・手動テスト手順であり Domain / Use Case の判定材料ではない
- `apps/web/**` のうち上記 2 件を除く 68 件（コンポーネント・ルート・presentation・worker entry・scripts・`.env.example`・`routeTree.gen.ts`・presentation テスト）— フロントエンド観点／セキュリティ観点の担当。転送境界のバリデーションと server function の入口だけ上記 2 件で確認した
- `packages/core/src/adapters/**` のうち上記 1 件を除く 42 件（conformance スイート 15、memory アダプター 20、oauth アダプター 7）— アダプター観点の担当。ポート契約の側は `application/ports/**` / `domain/**/ports/**` で全数確認済み
- `packages/core/src/application/**/__tests__/**` のうち上記 2 件を除く 42 件 — テスト観点の担当。TC ID を含むテスト名の一覧を機械抽出し、本観点の不変条件（barrier・継続・冪等性・uniqueness 解放・redaction）に対応するケースが存在することだけ確認した
- `packages/core/src/domain/**/__tests__/**` 4 件（`identity/policies.test.ts`, `storage/storage.test.ts`, `usage/quota.test.ts`, `usage/valueObject.test.ts`）— テスト観点の担当
- `docs/runtime_node.md`, `docs/test.md`（2）— 運用ドキュメント。ドキュメント観点の担当
- `vitest.config.ts`（1）— テスト実行設定。テスト観点の担当

確認 101 + スキップ 203 = **304**
