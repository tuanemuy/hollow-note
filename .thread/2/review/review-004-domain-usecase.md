# Domain / Use Case

レビュー観点: ドメイン / ユースケース層（`packages/core/src/domain/**`, `packages/core/src/application/**`）。
ゼロベースで、`CLAUDE.md` / `spec/domains/{identity,usage,storage}.md` / `spec/usecases/{identity,usage,storage}.md` / `spec/domains/usage.md` と `.thread/2/plan.md` の受け入れ基準・縮退リストを突き合わせて検証した。

## Blockers

なし

## Warnings

- **[W-001]** `identity.identity.removed` の再配送が、同じ provider account を再連携したあとに届くと、**新しい active 予約を解放してしまう** / 場所: `packages/core/src/application/identity/identityRemovalRelease.ts:34-59` / 理由: 冪等性の根拠として置いているガードは「receipt が存在し、かつ `receipt.identityId` の Identity 行が消えていること」の 2 点だけ。利用者が同じ provider account を再連携すると **新しい `IdentityId`** の行が作られるので、旧 `identityId` は不在のままガードを通過する。続く `releaseActiveUniqueKey` は `normalizedKey` と `expectedUserId` だけで引くため（`identityUniqueDirectory.beginRelease` は所有者一致だけを見る — `adapters/memory/repositories/identityUniqueDirectory.ts:119-138`）、再連携で publish されたばかりの `active` 行が `releasing → 削除` される。結果として「Identity 行はあるのに directory に claim が無い」状態になり、その key を**別の利用者が reserve できてしまう**（`removeIdentity.ts` の JSDoc が担保しているつもりの「解除は自分の claim にしか触れない」が破れる）。窓は狭い（配送成功後 `markProcessed` 前のクラッシュ／リース失効による再配送、あるいは quarantine 行の再投入）が、outbox は at-least-once で、しかも「間違えて外したのですぐ付け直す」は現実的な操作列。`removeIdentity.test.ts` の 8 件・`subscribers.test.ts` の 5 件にこのケースを突くテストは無い。 / 提案: 解放前に「その key を今名乗っている Identity が無い」ことまで確認する（`ctx.identityRepository.listByUserId(receipt.userId)` に `providerAccountKey(...)` 一致の oauth identity があれば解放しない）、または receipt に `activatedOperationId` 相当を持たせて directory 行の `operationId` 一致を条件にする。あわせて「解除 → 再連携 → 解除イベント再配送」の回帰テストを 1 本足す。

- **[W-002]** personal cleanup 完了から global receipt への引き渡し（`acknowledgePersonalCleanup`）を落とすと、**削除が `running` のまま復旧経路を持たない** / 場所: `packages/core/src/application/workers/scopeTaskRunner.ts:34-42`, `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts:85-102` / 理由: barrier を閉じた scope turn は同一 UoW で `cleanupAdmission.markCompleted` と `scopeTaskScheduler.complete(...)` を確定させる（`storage/deleteFilesByOwner.ts:121-136`, `usage/deleteQuota.ts:84-98`）。その **あと** に `settleCleanupTurn` が global 平面の `acknowledgePersonalCleanup` を呼ぶ。ここで例外・プロセス断が起きると、runner の `catch` は `scopeTaskScheduler.backoff` を呼ぶが、対象行は既に `complete` で消えているので **no-op**（`ports/scopeTaskScheduler.ts:53-57`、memory 実装 `scopeTaskScheduler.ts:77-84`）。scope 平面には再駆動主体が残らない。global 平面側も、`cleanup` フェーズの継続イベントは決定的 id（`...:cleanup:-`）で既に処理済みなので `OutboxRepository.save` に折り畳まれて再配送されない。`.thread/2/plan.md` の縮退は「barrier ack を落とした場合の再駆動は P-25 の再送に依存する」としているが、再送経路（`deleteAccount/index.ts` → `startAccountDeletionManifestBuild`）が出すのは **manifest build の継続**だけで、`continueAccountDeletionManifestBuild` は `status !== "building"` で即 return するため、cleanup フェーズには決して戻らない。すなわち縮退に書かれた復旧手段が実際には効かず、AC-29 の「プロセスを落として再起動しても未完の継続を拾って完走する」を満たさない状態が 1 経路残る。`cleanupDispatch.ts` の JSDoc も「the cleanup phase is delivered again」と書くが、そのイベントを再度出す主体は存在しない。 / 提案: 受理の resume 経路（`admitAccountDeletion` が `resumed: true` を返した後、または `deleteAccount/index.ts`）で manifest header を `describe` し、`status === "built"` かつ必須 receipt が欠けているフェーズがあればそのフェーズの dispatch 継続を **再送ごとに変わる cursor**（例: `resume:<requestId>` / 試行回数）で発行する。決定的 id の折り畳みを避けつつ、既に完了しているフェーズは各ハンドラーの冪等ガードが no-op に落とすので副作用は無い。これで縮退記述（P-25 再送で復旧）が実装と一致する。

## 検証したこと（主なもの、指摘なし）

- **UoW 規律**: `globalUnitOfWorkProvider.run` / `scopeUnitOfWorkProvider.run` の入れ子は全経路で無し。`deleteStoredFiles` は `ScopeUnitOfWorkContext` を引数に取る共有手続きとして定義され（`storage/deleteFiles.ts`）、`storeAvatar` / `deleteFilesByOwner` が自分の UoW の中で実行している。`completePersonalCleanupIfDone` も同様に ctx 受け取り。イベントは全て `ctx.collectEvents` 経由。
- **継続チェーンの id 規律**: `mintEventIdFor`（`execution/eventId.ts`）は `continuationKey` を持つ draft だけ決定的 id にする。`userAuthResidueCleanupContinued` は key を持たない（同一 payload で複数 turn を回すため）＝正しい選択。redaction / compaction は turn 番号を、finalize は producer 名を cursor に載せて id を分離しており、「自分の key を再発行して自分の relay finalize に潰される」問題を回避できている。
- **`authEpoch` バンプ 4 経路と残渣掃除**: `resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount(admission)` の 4 経路がいずれも同一 UoW で `User.advanceAuthEpoch`（または `beginDeletion`）＋ 最初の継続を積む。`authResidueCleanup` は `versioned.entity.authEpoch !== authEpoch` を stale として即停止し、`deleteOlderEpochByUser` は `< currentEpoch` のみ削除（memory 実装で確認）。「現世代を消さない」は保たれている。`sessions → authTokens` の phase 切替も同一 UoW。テスト 5 件（TC-identity-041/042/043 + 現世代不削除 + 終端）で守られている。
- **一意性予約サガ 3 kind**: `uniqueness.ts` の reserve → commit → activate → （旧 key は）`beginRelease` → `release` の順序は 3 経路（`completeOAuthSignIn` の 2 予約、`linkOAuthIdentity`、`updateProfile`）で一貫。`updateProfile` が `OPTIMISTIC_LOCK_FAILURE` のときだけ補償しない理由（決定的 operationId を共有する競合相手の行を消してしまう）も妥当。`activateUniqueKeys` の `confirmOnce` により複数予約が半活性で終わらない。
- **アカウント削除の順序**: 「terminal 数の判定 → operation 作成 → `beginDeletion` → barrier」の順序、resume 時に `beginDeletion` を再実行しない（二重 epoch バンプ回避）点、uniqueness key を PII が生きているうちに payload へ凍結する点はいずれも正しい。uniqueness 解放を finalize ではなく cleanup 波で行う spec からの逸脱は JSDoc で理由（receipt の自己待ち）が説明されており、rollback は destructive cleanup 前にしか起きないため実害無し。
- **`DeletingUser` / `DeletedUser` の倒れ方**: `signInWithPassword`(`ACCOUNT_DELETING` / `INVALID_CREDENTIALS`)、`completeOAuthSignIn`(`ACCOUNT_UNAVAILABLE`)、`linkOAuthIdentity`(`ACCOUNT_UNAVAILABLE` / epoch 不一致は `UNAUTHENTICATED`)、`startOAuthFlow`(linkIdentity で `UNAUTHENTICATED`)、`requestPasswordReset` / `resendVerificationEmail`（無送信で同一応答）、`resetPassword` / `addPasswordIdentity` / `updateProfile` / `getProfile` いずれも `status !== "active"` で正しく落ちる。
- **宣言集合の型表現**: `cleanup/participants.ts` が `satisfies Record<PersonalCleanupComponent, Participant | AbsentReason>` で列挙を網羅させ、`ActivePersonalCleanupComponent` から必須集合を導出し、`PERSONAL_CLEANUP_COMMANDS` を同じキーで exhaustive にしている。participant を足して command を配線し忘れると型エラーになる形で、「掃除する主体が無いのに完了する」を表現不能にできている。`memoryRuntime.ts` が両集合をアダプターへ渡していることも確認。
- **入力バリデーション 2 点**: usecase 内の検査は VO 構築（`Email` / `Handle` / `AvatarUrl` / `PlainPassword` / `ByteSize` …）と、spec がエラー表で要求する `requireRequestId`（`INVALID_REQUEST_ID`）に限られる。`readUniquenessKeys` は保存済み行の整合性検査（`SystemError(DataIntegrityError)`）で入力検証ではない。
- **cross-layer catch**: 広い `try/catch` は境界のみ — サガの補償（`releaseUniqueKeys`）、object storage のロールバック（`storeAvatar`）、メール送信の best-effort、worker の per-row 許容（`runDueScopeTasks`）。ドメインエラーの再翻訳は `changePassword` の「不正な現在パスワード → `INVALID_CREDENTIALS`」だけで、これは spec のエラー表どおり。
- **ドメイン / ユースケースの配置**: 閾値・境界はドメイン側にある（`UsageWarningLevel` 80%/100%、`ByteQuota.defaultFor`、`LlmCallQuota.default`、`BillingPeriod`(UTC)、`UploadValidationPolicy`(avatar 5MB / GIF 拒否 / マジックバイトで判定)、`IdentityPolicy.isRemovable`、`AccountDeletionRetryPolicy`、`SameOriginPolicy`）。`listIdentities` が件数を数えず `IdentityPolicy.isRemovable` を呼ぶ形も良い。逆方向（ドメインに I/O・設定が漏れる）も無し（`AvatarUrl.create` が `appUrl` を引数で受ける、`User.reconstruct` が設定を読まない）。
- **コード内の残渣**: 修正経緯・レビューへの弁明にあたるコメントは grep で確認して 0 件。

## カバレッジ

確認（139 件）:

- `packages/core/src/domain/**`（33 件、一覧 246–278 の全行）: `common/event.ts`, `identity/{errorCode,user,valueObject}.ts`, `identity/ports/{authTokenRepository,identityUniqueDirectory,signInOAuthClient}.ts`, `identity/services/{accountDeletionRetryPolicy,identityPolicy,sameOriginPolicy}.ts`, `identity/__tests__/policies.test.ts`, `note/valueObject.ts`, `note/ports/{htmlProcessor,localNoteProjectionWriter,localNoteQueryService,publicNoteProjectionWriter}.ts`, `storage/{errorCode,events,storedFile,valueObject}.ts`, `storage/ports/storedFileRepository.ts`, `storage/services/uploadValidationPolicy.ts`, `storage/__tests__/storage.test.ts`, `usage/{errorCode,events,llmUsage,storageQuota,valueObject}.ts`, `usage/ports/{llmUsageRepository,storageQuotaRepository}.ts`, `usage/services/quotaEnforcement.ts`, `usage/__tests__/{quota,valueObject}.test.ts`
- `packages/core/src/application/**`（106 件、一覧 138–245 のうち下記スキップ 2 件を除く全行）: `cleanup/{participants,personalCleanup}.ts`, `di/{types,memoryRuntime,serverNode}.ts`, `execution/{eventId,unitOfWork}.ts` と同 `__tests__`, `identity/**`（`deleteAccount/` 10 ファイル、`uniqueness.ts` / `continuations.ts` / `authResidueCleanup.ts` / `identityRemovalRelease.ts` / `eventDecoders.ts` / `view.ts` を含む 15 usecase と `__tests__` 30 ファイル）, `ports/**`（10 ファイル）, `storage/**`（6 source + 3 test）, `usage/**`（4 source + 3 test）, `workers/{subscribers,scopeTaskRunner,eventRelayWorker}.ts` と同 `__tests__`, `application/__tests__/helpers.ts`
  - うち `identity/__tests__` の deleteAccount 系 8 ファイル・`authResidueCleanup.test.ts` はケース名まで、その他のテストはケース名／件数と対象 TC の対応まで確認した。

スキップ（140 件）:

- `.thread/2/**`（22 件、一覧 1–22）— 計画・過去ラウンドのレビュー記録。本レビューはゼロベース指定のため参照せず（`plan.md` のみ契約として読了）
- `apps/web/**` + `docs/**`（72 件、一覧 23–94）— presentation / frontend / ランタイム配線。Frontend・Security 観点の担当。ただし consumer 実行経路の確認のため `apps/web/app/server.node.ts` の `consumerHandler` 配線だけは参照した
- `packages/core/src/adapters/**`（43 件、一覧 95–137）— Adapter 観点の担当。ポート契約の解釈確認のため `memory/repositories/{identityUniqueDirectory,accountDeletionManifestStore,scopeTaskScheduler,authTokenRepository,noteProjection}.ts` のみ参照した（レビュー対象としては数えない）
- `packages/core/src/application/di/__tests__/serverNode.test.ts`（一覧 141）— composition root の env スキーマ検証。DI / Security 観点
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts`（一覧 213）— #1 の既存ノート経路のテスト追補で、本 Issue のドメイン / ユースケース判断に関わらない
- `vitest.config.ts`（一覧 279）— テスト実行設定

確認 139 + スキップ 140 = 279。
