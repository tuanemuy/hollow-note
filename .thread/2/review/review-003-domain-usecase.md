### Domain / Use Case

ゼロベースで再検証した。実害のある問題は見つからなかった。

#### Blockers

なし

#### Warnings

なし

#### 検証したポイント（結論の根拠）

指摘は無いが、「見なかったから無い」と区別できるよう、この観点で実際に追った不変条件を記録する。

- **ロジックの配置**: ドメインに置くべき判断（`IdentityPolicy` の 8 件上限 / 最後の 1 件 / `isRemovable`、`UploadValidationPolicy` の avatar 行、`AccountDeletionRetryPolicy` のしきい値と窓、`SameOriginPolicy`、`QuotaEnforcement`、`UsageWarningLevel` の 80% / 100% 境界）はすべてドメインにあり、ユースケースは呼ぶだけ。逆方向（調整責務のドメイン侵食）も無い — `uniqueness.ts` は「2 ストアの順序付け」だけを行い業務判断を持たない旨が JSDoc で明示され、実装もそのとおり。`participants.ts` の宣言レジストリはアプリ層の配備知識であり、ドメインに置いていないのが正しい。
- **不変条件の型表現**: `PersistentFile` から artifact provenance を `Exclude` して「期限なしの生成物」を表現不能にしている、`ContinuationSubscribers` を非空タプルの `Record` にして継続の購読漏れをコンパイルエラーにしている、`PERSONAL_CLEANUP_COMMANDS` を `Record<ActivePersonalCleanupComponent, …>` にして participant 追加時のコマンド未配線を型エラーにしている、`personalCleanupParticipants` / `globalCleanupParticipants` を `satisfies Record<enum, participant | absent>` で網羅させている — いずれも実効的。
- **UoW 規律**: ネストは 1 箇所も無い。`admitAccountDeletion`（global → 戻ってから scope）、`dispatchAccountDeletionCleanup`（scope 読み → scope 書き → global ack）、`dispatchAccountDeletionRedaction`（global claim → scope 書き → global ack）、`runDueScopeTasks`（claim の UoW を閉じてからハンドラー起動）、`authResidueCleanup`（1 本目を閉じてから 2 本目）をそれぞれ確認。トランザクションを跨ぐ共有手続き（`deleteStoredFiles` / `completePersonalCleanupIfDone`）は ctx 受け取り型で、自前で `run` を開かない。
- **Outbox / イベント冪等性**: 継続イベントは `continuationKey` から決定的 ID を導出し（`mintEventIdFor`）、`OutboxRepository.save` の「既存行は触らない」契約と噛み合っている。ID が turn ごとに変わることも確認した — build は `(phase, cursor)`、redaction / compaction は turn 番号、finalize は生成元名（`redaction` / `authResidue` / `uniquenessRelease`）で分離されており、「自分と同じキーを再発行してチェーンが止まる」パターンは無い。finalize は 3 つの必須 receipt それぞれに対応する試行イベントを持つので、どの receipt が最後に埋まっても finalize に到達する。`IdempotencyStore` を通さない購読者（`authResidueCleanup` / `identityRemovalRelease` / `deleteStoredObjects`）は、それぞれ「エポック未満の有界削除」「receipt 起点の no-op 収束」「キー削除の冪等」という根拠を JSDoc に持ち、実装もその通り。
- **同一 UoW の粒度**: `removeIdentity` の 行削除 + receipt + イベント、`changePassword` / `resetPassword` / `signOutOtherSessions` の epoch バンプ + `refreshAuthEpoch` + 継続、`resendVerificationEmail` / `requestPasswordReset` の再送間隔読み + 旧トークン削除 + 新規発行、`deleteFilesByOwner` / `deleteQuota` の `markApplied` + 削除 + 継続登録 — 分割すると壊れる組み合わせがすべて 1 トランザクションに入っている。逆に `acknowledgePersonalCleanup`（scope commit 後に global receipt）と `authResidueCleanup` の receipt ack は、平面をまたぐため意図的に別 UoW で、失われた場合の帰結（再配送で終端 turn に再到達）まで書かれている。
- **アカウント削除のオーケストレーション**: 受理は「terminal 数を数える → 判定 → operation 作成 → `beginDeletion`」の順で、resume 経路では `beginDeletion` を呼ばない（epoch 二重バンプ回避）。uniqueness キーは PII が生きているうちに payload へ凍結し、global cleanup は payload しか読まない。解放は finalize の**前**（`uniquenessRelease` receipt が自分自身を待つのを避けるため）。barrier は global commit 後に scope 自身のトランザクションで取り、barrier 前に確定した write は cleanup scan が回収する。`begin` / `beginPersonalAccountDeletion` / `acknowledgeReceipt` / `markCompleted` はいずれも冪等で、受理の再投入が進行中の manifest を巻き戻さないことを memory 実装で確認した。
- **一意性予約サガ（3 kind）**: `reserve` 失敗時の既取得分ロールバック、`releaseUniqueKeys` の非 throw、`activateUniqueKeys` の `confirm` 1 回化（グループが半分 activate / 半分 release にならない）、`updateProfile` の「新 key 予約 → commit → activate → 旧 key を beginRelease → release」順序、OCC 敗北時に**解放しない**判断（同一 operationId の別試行が勝者側の行を持つため）— いずれも意図と実装が一致し、TC-identity-280 / 281 / 293 で守られている。`reclaim` 経路（commit と activate の間で落ちた claim の再公開）も実装・テストともにある。
- **`authEpoch` 4 経路の共有コンシューマー**: `deleteOlderEpochByUser(userId, currentEpoch, …)` は `< currentEpoch` のみを消し、turn 冒頭で `user.authEpoch !== payload.authEpoch` を stale 判定して停止するので「現世代を消さない」が二重に守られている。削除駆動の chain が stale で receipt を落とすと finalize が止まるが、`deleting` 中は他の 3 バンプ経路がすべて `status === "active"` を要求するため到達しない。テスト TC-identity-041..043 と「never deletes rows of the current generation」が該当。
- **`DeletingUser` / `DeletedUser` の倒れ方**: `signInWithPassword`（deleting 専用分岐）、`completeOAuthSignIn`（既存リンク経路・`AccountLinkingPolicy` 経路の両方）、`linkOAuthIdentity`（最終 UoW 内で status + epoch）、`requestPasswordReset` / `resetPassword`（`!== "active"` を一様応答 / `AUTH_TOKEN_NOT_FOUND` に収斂）、`updateProfile` / `getProfile` / `addPasswordIdentity` / `startOAuthFlow`（linkIdentity は state 行すら作らない）をすべて確認。
- **入力バリデーションの 2 点**: ユースケース側の検証は値オブジェクト構築（`UserId` / `Email` / `Handle` / `PlainPassword` / `AvatarUrl` / `StoredFileId` / `ObjectKey`）と `requireRequestId`（transport 境界の UUID 形式）に限られており、途中で静的型を疑い直す防御的チェックは入っていない。`readUniquenessKeys` の検証は外部入力ではなく自分が書いた行の整合性チェックで、`SystemError(DataIntegrityError)` に落としているので分類も正しい。
- **Cross-layer catch policy**: 広い `try/catch` は 4 箇所のみで、いずれも境界。`storeAvatar`（トランザクションに参加できないオブジェクトストアの補償）、`releaseUniqueKeys` / `activateUniqueKeys`（補償・再照合）、`runDueScopeTasks` / `pruneAccountDeletionManifests`（行単位の部分失敗許容）、メール送信失敗のログ化。ドメインエラーの再翻訳は `changePassword` の「不正形式の現在パスワード → `INVALID_CREDENTIALS`」1 箇所だけで、これは列挙耐性のための意図的な収斂であり理由も書かれている。
- **テストによる担保**: `pnpm test:unit` を実行して 75 files / 891 passed / 3 skipped（Google 資格情報ゲート）で緑。deleteAccount は `deletionDriver.ts` / `deletionHarness.ts` を土台に admission / cleanup / finalize / globalCleanup / manifestBuild / recovery / redaction / terminalPrune の 8 本に分かれ、「build turn の二重配送」「cleanup コマンド再配送」「実行中の再要求でチェーンが分岐しない」「receipt は入ったが finalize 試行が失われた」といった応答喪失系が実際に検証されている。
- **コメントの残渣**: `domain/` と `application/` の非テストコードを `レビュー|指摘|previously|used to|per the review|R1|R2` で走査したが、修正経緯・弁明の記述は 1 件も無い（ヒットした 3 件はいずれも語義どおりの技術記述）。

#### 参考（指摘ではない — 既に plan.md に縮退として記録済み）

以下は今回の再検証でも同じ結論に達したが、`.thread/2/plan.md` の「縮退」節に引き継ぎ先つきで明記されているため指摘としては挙げない。

- `updateProfile` の旧ハンドル `releaseActiveUniqueKey` に再駆動主体が無い（→ #9）。
- `ScopeTaskScheduler` / `ScopeTaskQueue` に `priority` とリースが無い（→ #19）。`claimDue` はスコープ単一 writer 前提。
- `deleteFilesByOwner` / `deleteQuota` の scope task が `SCOPE_TASK_MAX_ATTEMPTS` で `failed` に落ちた場合、barrier が閉じず manifest が running のまま残る（手動回復手順は本 Issue の対象外）。
- global 平面の継続イベントが quarantine に達した場合の再駆動は outbox のオペレーター操作に依存する（`OutboxRepository` の JSDoc が明記）。

#### カバレッジ

- 確認（146 件）:
  - `packages/core/src/domain/**` 全 33 件 — `common/event.ts`, `identity/{errorCode,valueObject,user}.ts`, `identity/ports/{authTokenRepository,identityUniqueDirectory,signInOAuthClient}.ts`, `identity/services/{accountDeletionRetryPolicy,identityPolicy,sameOriginPolicy}.ts`, `identity/__tests__/policies.test.ts`, `note/{valueObject.ts,ports/*}` 5 件, `storage/**` 7 件, `usage/**` 10 件
  - `packages/core/src/application/cleanup/{participants,personalCleanup}.ts`（2）
  - `packages/core/src/application/di/{types,memoryRuntime,serverNode}.ts` と `di/__tests__/serverNode.test.ts`（4）
  - `packages/core/src/application/execution/{eventId,unitOfWork}.ts` と `execution/__tests__/eventId.test.ts`（3）
  - `packages/core/src/application/identity/**` 非テスト 34 件（`deleteAccount/` 10 件を含む）＋ `__tests__/` 31 件
  - `packages/core/src/application/ports/**` 10 件
  - `packages/core/src/application/storage/**` 9 件（実装 6 ＋ テスト 3）
  - `packages/core/src/application/usage/**` 7 件（実装 4 ＋ テスト 3）
  - `packages/core/src/application/workers/**` 6 件（実装 3 ＋ テスト 3）
  - `packages/core/src/application/__tests__/helpers.ts`, `application/note/__tests__/createBlankNote.test.ts`（2）
  - memory アダプター 5 件 — `repositories/{accountDeletionManifestStore,authTokenRepository,distributedOperationStore,scopeCleanupAdmissionStore,storedFileRepository}.ts`（ユースケース側の不変条件（`begin` の冪等・`beginOrResume` の合流規則・`PaginationResult.count` の意味・barrier の所有者判定）が実装で成立するかの確認に必要だったため）
- スキップ（128 件）:
  - `.thread/2/**` 17 件 — 計画・過去レビュー記録であり実装コードではない
  - `apps/web/**` 70 件（`.env.example`, `components/**` 37, `presentation/**` 11, `routes/**` + `routeTree.gen.ts` 17, `server.node.ts`, `worker/node/**` 2, `scripts/listen.node.ts`）— フロントエンド / プレゼンテーション / ランタイム配線の観点担当。ドメイン知識の漏れだけは横断確認し、`IdentityPolicy.isRemovable` / `AVATAR_*` / `Session.isExpired` の 3 件のみで、いずれもドメイン側が「画面に公開する」意図を JSDoc に明記した値の参照であることを確認済み
  - `docs/{runtime_node,test}.md` 2 件 — ドキュメント
  - `packages/core/src/adapters/conformance/**` 16 件 — アダプター適合スイートの観点担当
  - `packages/core/src/adapters/memory/**` 残り 16 件 — アダプター実装の観点担当
  - `packages/core/src/adapters/oauth/**` 6 件 — アダプター実装の観点担当
  - `vitest.config.ts` 1 件 — テスト実行設定
