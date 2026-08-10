# 実装計画 — Issue #2: [account] アカウント管理と認証手段

**Issue:** #2
**作成日:** 2026-08-10
**複雑度:** 中〜大規模
**実装方針:** steps.md

---

## 目的

メール確認・OAuth・パスワード再設定・認証手段管理・プロフィール / アバター・使用量・アカウント削除の 7 テーマを、Identity ドメインの残り 15 ユースケースと新設の Usage ドメイン・Storage 最小コアの上に実装し、利用者が自分のアカウントを一通り安全に管理できる状態にする。

## 受け入れ基準

**呼称の区別**: 本表の基準はゼロ埋めなしの `AC-1`〜`AC-33`。`spec/scenario/account.md` のシナリオはゼロ埋めありの `AC-01`〜`AC-10` で、本計画・adr.md からシナリオを指すときは必ず「シナリオ AC-07」または `spec/scenario/account.md#AC-07` の形で書き、裸の `AC-07` は使わない。

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | Usage ドメインが `spec/domains/usage.md` どおり実装され、VO 5 種（QuotaSubject / ByteQuota（user 5GB・workspace 20GB）/ LlmCallQuota（300/月）/ BillingPeriod（UTC 暦月）/ UsageWarningLevel（80% / 100% 境界））・エンティティ 2 種・`QuotaEnforcement`・リポジトリ 2 種が単体テストと適合テストを通る | DOM-usage-001..017, ADP-usage-001..009 | 7 |
| AC-2 | Storage の avatar 経路（`StoredFile` / VO 8 種（`StorageOwner` / `FileName` / `MimeType` / `ByteSize` / `FilePurpose` / `FileProvenance` / `ObjectKey` / `Checksum`）/ `UploadValidationPolicy`(avatar) / `StoredFileRepository`（`TransactionalRepository` 継承。`listByOwner` は `PaginationResult` を返す — ADR-022）/ `ObjectStorage` / 共有手続き `deleteFiles`（`findById` の OCC トークン経由で削除））が実装され、適合テストを通る | UC-storage-004/013 の前提（ADR-004） | 8 |
| AC-3 | `resendVerificationEmail`: PendingUser で再送、60 秒以内は無送信で成功、ActiveUser / 未登録は応答同一のまま無送信、不正形式は `InvalidEmail`。TC-identity-194..199 が通る | UC-identity-003 | 10 |
| AC-4 | `verifyEmail` の TC-identity-294..304 が全行通る（23:59/24:00 境界、消費済み、用途違い、利用者削除済み、authEpoch 進行、同一トークン並行消費で片方 `alreadyVerified` に収斂しトークン・利用者状態が壊れない） | UC-identity-002 | 11 |
| AC-5 | P-03 に確認メール再送の導線があり、P-02 にも再送導線がある。P-03 の状態（処理中 / 成功 / 確認済み・サインインが必要 / 使用済み / 期限切れ / 無効 / 一時障害）が spec どおり出る | PAGE-p03-001..004, PAGE-p02-006（#1 の見送り行） | 12 |
| AC-6 | `SignInOAuthClient` のアダプターが Google 実装 + dev IdP 実装の 2 本存在し（ADR-003）、**dev IdP アダプターが共有適合スイート `describeSignInOAuthClientContract` を資格情報なしで通る**。Google アダプターは同じスイートに登録され、`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` が無い環境では `describe.skip` 相当で skip される（登録行の存在と skip 条件をコードで確認できる）。両アダプターが `deriveCodeChallenge` の S256 契約（同一 verifier → 同一値 / 43 文字 base64url / 認可 URL に `code_challenge_method=S256`）を満たすことは、資格情報を要さない純関数の検証として両方で実行する（ADR-010）。あわせて **dev IdP の同意画面ルート `/dev/oauth/authorize` が存在し、「許可する」が `redirect_uri` へ `code` + `state` を、「キャンセル」が `error=access_denied` + `state` を返し、`OAUTH_DEV_MODE` が偽のときは 404 になる**（ADR-021。マニュアル TC-05 手順 1〜2 / TC-40 の前提） | ADP-identity-033/034（#1 の見送り行） | 13 |
| AC-7 | `startOAuthFlow`: signIn / linkIdentity の 2 intent、linkIdentity は ActiveUser 必須で `authEpoch` を state に保持、未知プロバイダー・外部オリジン `redirectTo` を拒否、2 回開始で別 state。TC-identity-264..271 が通る | UC-identity-005 | 14 |
| AC-8 | `completeOAuthSignIn`: 既存紐づけ / 同一メール ActiveUser への自動リンク / 未確認メールの拒否 / `PendingUser` / `DeletingUser` / 8 件上限 / 2 予約のサガとその recovery / state 不在・再利用 / 交換拒否・通信失敗 / `redirectTo` 復元。TC-identity-024..038 が通る | UC-identity-006 | 14 |
| AC-9 | `/auth/callback/$provider` が `state` の intent だけで分岐し（ADR-007）、P-05 の状態（処理中 / 成功 / キャンセル / 失敗 / 再許可）を表示する。P-01 / P-02 に「Google で続ける」が出る | PAGE-p05-001..003, PAGE-p01-003, PAGE-p02-003（後 2 者は #1 の見送り行） | 15 |
| AC-10 | `requestPasswordReset`: パスワード手段あり→再設定メール、Google のみ→`passwordResetUnavailable` メール、`DeletingUser` / 未登録→無送信で同一応答、既存未消費トークンは置き換え。TC-identity-187..193 が通る | UC-identity-011 | 16 |
| AC-11 | `resetPassword`: 59 分 / 1 時間境界、消費済み・用途違い・epoch 進行・`deleting` 遷移済みは `AUTH_TOKEN_NOT_FOUND`、パスワード手段が無ければ作成、弱パスワード拒否、成功で全セッション失効（10,000 件でも O(1)）、並行消費で負けた側はパスワードが変わらない。TC-identity-200..212 が通る | UC-identity-012 | 16 |
| AC-12 | P-04（申請 / 実行の 2 モード、申請完了は常に同一文言、トークン無効時は再申請へ）が動作し、P-02 の再設定導線と LOCKED 表示の解除導線が実リンクになる | PAGE-p04-001..004, PAGE-p02-004（#1 の見送り行） | 17 |
| AC-13 | `listIdentities` / `addPasswordIdentity` / `changePassword` が spec どおり動作する（上限 8・パスワード重複拒否・現在パスワード検証・変更後は現セッションのみ残る・10,000 セッションでも O(1)・並行更新）。TC-identity-001..007, 017..023, 128..133 が通る | UC-identity-013/014/016 | 18 |
| AC-14 | `removeIdentity`: 最後の 1 件は拒否、他人の / 不在の ID は `IDENTITY_NOT_FOUND`、削除は receipt + `identity.identity.removed` を同一 UoW で書き、グローバルコンシューマーが受領の `providerAccountKey` を鍵に active 予約を `releasing → release` する（ADR-015）、同じ解除の再送は receipt から成功を返す、2 件同時解除で 1 件残る。TC-identity-179..182, 184..186 が通る | UC-identity-015 | 1, 2, 19 |
| AC-15 | `linkOAuthIdentity`: linkIdentity intent の state のみ受理、他人に紐づく provider account は `PROVIDER_ACCOUNT_ALREADY_LINKED`、epoch 進行 / 削除開始 / 8 件上限では予約を解放して保存しない、自分に既に紐づく場合は冪等。TC-identity-119..127 が通る | UC-identity-007 | 20 |
| AC-16 | `signOut`（不在・不正トークンでもエラーにしない）と `signOutOtherSessions`（`authEpoch` バンプ + 現セッションのみ `refreshAuthEpoch` + 残渣掃除タスク発行、10,000 件でも O(1)、他利用者に影響しない）が実装され、#1 の Cookie 破棄 glue が置き換わる。TC-identity-238..246 が通る | UC-identity-009/010, ADR-008 | 2, 3, 21 |
| AC-17 | P-22 が動作する（有効な方法の一覧 / パスワード追加 / パスワード変更 / Google 追加 / 解除（最後の 1 件は解除不可を理由つきで表示）/ 他端末サインアウト） | PAGE-p22-001..006 | 9, 22 |
| AC-18 | `updateProfile`: 表示名 50・自己紹介 500 の境界、ハンドル 3〜30 / 予約語 / 大文字 / 空文字クリア、重複は `HANDLE_ALREADY_USED`、予約サガの 2 経路 recovery、旧ハンドルの active 予約は key ベースで `releasing → release`（ADR-015）、`PendingUser` は `EMAIL_NOT_VERIFIED`、並行更新。**検証境界は「イベントの発行有無と payload」まで**（`profileUpdated` は表示名変更時のみ発行、`handleChanged` は初回設定でも `previousHandle: null` で発行）で、読み取りモデルへの反映・公開ページ / 検索結果の表示は購読側（Note スライス / #9）の担当（ADR-009）。TC-identity-272..275, 278..288, 290..293（19 行）が通る | UC-identity-017 | 23 |
| AC-19 | `storeAvatar`: 本人以外は拒否（workspace 主体は `BusinessRuleError(InsufficientRole)` — ADR-014）、5MB 境界・GIF 拒否、既存アイコン（`purpose: "avatar"` で絞り込んだ既存行）は同一 UoW で削除、scope の通常 write 入口として `cleanupAdmission.assertWritable()` と `assertActorWritable(userId)` の 2 本を呼ぶ（ポートの JSDoc「every normal write entry point calls both」。削除 barrier 後は `ACCOUNT_DELETING` — TC-identity-045 が検証する）。`StorageQuota.consumedBytes` は即時には増えない（`applyStorageDelta` は本 Issue 外 — ADR-004）が、`sumSizeByOwner` の集計対象なので `recalculateStorageUsage` で反映される。TC-storage-167, 170..174 が通る | UC-storage-004 | 24 |
| AC-20 | P-20 設定タブが L-01 中央カラム上部に出て **4 セクション**（プロフィール / ログイン方法 / 使用量 / アカウント削除。連携タブは P-23 が #4 のため出さない）を切り替えられ、P-21（表示名 / アイコン / 自己紹介 / ハンドルの編集、重複候補提示、ハンドル変更の警告）が動作する。`AccountMenu` に設定導線が出る。**アイコンをアップロードすると `storeAvatar` が返した `url` が `updateProfile` の `avatarUrl` として保存され、同一オリジン検証を通り、再読込後も P-21 と `AccountMenu` に表示される**（ADR-016） | PAGE-p20-001..002, PAGE-p21-001..003 | 9, 24, 25 |
| AC-21 | `getUsageSnapshot`: 個人の消費 / 上限 / ノート件数 / 警告レベル（79% / 80% / 超過の境界）、当月 LLM 回数（記録なしは既定値）、`updatedAt`、ワークスペース未参加時の空配列。workspace セクションは**常に空配列**を返す（keyset ページングと名前解決に要るポートが実コードに無く本 Issue では新設しないため、ページング自体を #3 で実装する — 縮退に記録。検証は TC-usage-048..054 とともに #3）。TC-usage-044..047, 055..059 が通る | UC-usage-001 | 26 |
| AC-22 | `recalculateStorageUsage`: `artifact` を除いた合計と `countByOwner` で置き換え、**クォータ行が無い場合は `StorageQuota.initialize` + `insert`、ある場合は `save(expectedVersion)`**（TC-usage-070。本 Issue で `initializeQuota` を実装しないので唯一の行生成経路）、2 回連続で同値、workspace 対象も動く。scope の通常 write 入口として `cleanupAdmission.assertWritable()` と `assertActorWritable(userId)` の 2 本を呼ぶ。TC-usage-065..072 が通る | UC-usage-005 | 26 |
| AC-23 | P-24 が動作する（個人の容量・ノート件数・当月 LLM 回数・最終更新時刻・80% 警告・上限到達・削除画面への導線） | PAGE-p24-001, PAGE-p24-003 | 9, 27 |
| AC-24 | `deleteQuota`: subject 削除、既に不在でも成功、`LlmUsage` を 100 件ずつ削除して継続タスクを同一 UoW で再登録、100 未満で ack。TC-usage-026..030, 032..033 が通る | UC-usage-007 | 4, 29 |
| AC-25 | `deleteFilesByOwner`: `batchSize` 既定 / 最大 100、継続タスクは 1 つだけ、0 件削除時は継続を積まずバックオフ、対象 0 件は正常終端、workspace 主体では**そのワークスペースのファイルだけ**が消える、purpose によらず（avatar / artifact も）消える、`storage.fileDeleted` の発行数、再実行の冪等性。TC-storage-037..043, 045..050（13 行）が通る | UC-storage-013 | 4, 29 |
| AC-26 | `deleteAccount` の受理と personal / global 経路が spec どおり動く: 確認メール一致検査・`requestId` UUID 検査・同一 requestId の冪等・running 中の別 requestId、`beginDeletion`（`deleting` + epoch バンプ）と personal barrier、barrier 前後の write 可否、宣言された全 component の ack で `markCompleted`、auth 残渣掃除（sessions → authTokens の phase 切替と応答喪失からの再開）、uniqueness 解放（active 予約の `releasing → release` を含む — ADR-015）、`finalizeDeletion` と `identity.user.deleted`、削除後の同一メール / 同一 provider account での再登録。**対象 TC（25 行）**: TC-identity-039..050, 053, 054, 081, 082, 084..087, 089..091, 093, 094。読み替えが 2 行ある: **TC-identity-085**（1 component 未 ack）は spec の期待結果が 8 component 固定だが、**ADR-002 / ADR-018 の宣言集合（本 Issue では `storage` / `usage` の 2 つ）に読み替えて「1 つでも欠ければ running のまま」を検証する**。**TC-identity-044**（barrier command より先に到着した write を回収する）は spec の期待結果が personal Note の owner scan（`deleteNotesForOwner` — 本 Issue 外）に依存するので、**personal File write（`storeAvatar`）が barrier command より先に確定し、barrier ack 後の `deleteFilesByOwner` の owner scan がその行を回収する**形に読み替えて検証する（隣接する TC-identity-045 は共通 `assertWritable` の拒否なので Note / Storage / Usage の 3 経路で成立し、読み替え不要）。**finalize の必須 receipt 集合も同じく宣言集合**（`personalCleanup` / `authResidue` / `uniquenessRelease`。`externalConnections` は #4、`jobHistory` は #5 のため — ADR-017） | UC-identity-020 | 5, 6, 28, 29, 30, 33 |
| AC-27 | manifest の構築・compaction・terminal prune が動く: membership ページ（seed edge 経由）と author route ページの keyset 継続と応答喪失からの再実行、ack 済み item の 100 件ずつの compaction、terminal header の shard / generation lane 越しの prune と checkpoint 再開。**対象 TC（13 行）**: TC-identity-095, 096, 100..107, 109..111 | UC-identity-020 | 6, 28, 30, 33 |
| AC-28 | P-25 が動作する（削除されるもの / されないものの説明、メールアドレス確認入力、不一致表示、実行後の即時サインアウト（`Set-Cookie` による破棄で、画面は P-25 に留まる）と 202 + status ticket（ADR-006）による進捗表示、完了表示とそこからのフル遷移）。進捗照会は `getAccountDeletionStatus`（`RequestContainer` の `DistributedOperationStore` 読み取りビュー経由で、書き込み UoW を通らない）が `{ operationId, status }` だけを返し、ticket が示す 1 件以外は読めない（TC-identity-048） | PAGE-p25-001..003 | 9, 32 |
| AC-29 | 継続コマンドが Node ランタイムで駆動され（ADR-005: 期限到来 scope タスクの列挙は `ScopeTaskQueue.listDue` が担い、`WorkerContainer` に載る。ADR-023: scope task tick は既定 1 秒間隔 + scope UoW の commit 後 kick、global 平面の継続イベント ID は生成元から決定的に導出する — ADR-019）、`pnpm dev` 上で `deleteAccount` が受理から `completed` まで完走する（ブラウザーで進捗が `accepted` → `running` → `completed` と進む）。プロセスを落として再起動しても未完の継続を拾って完走する | PAGE-p25-003, manual TC-14 | 4, 28, 29, 30, 31, 32 |
| AC-30 | `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test:unit` が全て緑で、`spec/manual-tests/account.md` の下表「実行」欄の TC を `pnpm dev`（dev IdP モード）のブラウザーで実行し、**各手順が期待結果どおりになる**。期待結果と異なった行は「TC 番号・手順番号・観測結果・原因・対応（本 Issue で修正 / 別 Issue 起票（番号必須））」を Issue コメントに記録する。未記録の不一致が 1 件でも残っている状態では満たさない。skip 欄は依存 Issue 番号つきで同じコメントに記録する | Issue 検証 | 全ステップ, 34 |
| AC-31 | 削除オーケストレーションの土台ポート 4 種が新設され、それぞれ UoW コンテキストに載り適合スイートを通る: `IdentityRemovalReceiptStore`（`GlobalUnitOfWorkContext`）、`DistributedOperationStore`（ADR-013、`GlobalUnitOfWorkContext`）、`ScopeTaskScheduler`（ADR-005、`ScopeUnitOfWorkContext`）、`AppliedOperationStore`（ADR-012、`ScopeUnitOfWorkContext`）。あわせて既存ポートの実行経路搭載（`AccountDeletionManifestStore` → Global UoW、`OAuthStateStore` → `RequestContainer`、`NoteRouteFanOutReader` → `RequestContainer`、`Local/PublicNoteProjectionWriter` → Scope UoW / `WorkerContainer`、`ObjectStorage` → `WorkerContainer`、`DistributedOperationStore` の読み取りビュー（`Pick<…, "findByOperationId">`）→ `RequestContainer`）が済み、適合テスト専用のポートが本 Issue の対象範囲に残らない。既存 2 ポートの必須集合が宣言集合ベースへ一般化され（`ScopeCleanupAdmissionStore` の personal component — ADR-002、`AccountDeletionManifestStore` の finalize receipt — ADR-017）、どちらも適合スイートが宣言集合を受け取る形になっている | UC-identity-015/020 の前提 | 1, 4, 5, 6, 8, 13, 28, 29, 30, 32 |
| AC-32 | グローバルイベント consumer の実行経路が通る: 購読者レジストリが存在し、`WorkerContainer` が UoW プロバイダーを持ち、`server.node.ts` の `consumerHandler` が no-op でなくなり、`identity.identity.removed` / `storage.fileDeleted` / `identity.userAuthResidueCleanupContinued` が `pnpm dev` 上で実際に処理される（ユニットテストからしか呼ばれない consumer が無い） | UC-identity-015/020 の前提 | 2, 3, 8, 19 |
| AC-33 | Issue 本文のチェックリスト 366 行について、**実装 277 行がチェック済み**（実装をレビューで確認できた行のみ）、**見送り 89 行はチェックされていない**、かつ見送り 89 行の `ID / 理由 / 引き継ぎ先` が Issue コメントに 1 行ずつ転記されている。同じコメントに下記「縮退」節の全項目と spec-sync 候補が記録されている。転記後に `チェック済み 277 + コメント記載 89 = 366` が成立することを数えて確認する | Issue 完了条件（2 節目） | 34 |

### マニュアルテストの実行範囲（AC-30）

`spec/manual-tests/account.md` は TC-01〜TC-41 の 41 件。内訳は **実行 30 + 本 Issue の対象シナリオ外 7 + skip 4 = 41** で、下表がその正典。

| 区分 | TC / 手順 | 依存 |
|---|---|---|
| 実行 | **TC-02**, TC-05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 19..34, **36, 38, 40** | — |
| 対象シナリオ外 | TC-01, 03, 04, 15, 16, 17, 18（シナリオ AC-01 / AC-04 に対応し #1 で実行済み。TC-02 は前提として TC-01 の手順を実行するが、合否判定は TC-02 の手順のみで行う） | — |
| skip（TC 全体） | TC-35（公開ハンドル URL の失効 — `/@handle` 公開ページ） | #9 |
| skip（TC 全体） | TC-37（未保存の編集がある状態のサインアウト） | 編集スライス |
| skip（TC 全体） | TC-39（唯一 owner のワークスペースがある状態の削除） | #3 |
| skip（TC 全体） | TC-41（無効な招待トークン付きリンクからの登録） | #3 |
| skip（手順） | TC-05 手順 4（外部連携一覧で Drive 未連携を確認） | #4（P-23） |
| skip（手順） | TC-07 手順 2（パスワード追加時の Google 再認可） | spec の `addPasswordIdentity` 手順に再認可が無い — spec-sync 候補としてステップ 34 で記録 |
| skip（手順） | TC-10 手順 5〜7（`/@test-taro` 公開ページ・公開検索の著者リンク） | #9 |
| skip（手順） | TC-11 手順 4〜6（workspace 使用量のページングと部分失敗） | #3 |
| skip（手順） | TC-14 手順 4〜7（公開ノート URL の失効 / workspace ノートの変換ジョブ / artifact 回収） | #9 / #3 / #5 / #6 |

## スコープ

### 含まれないもの

見送り基準は adr.md ADR-001（他スライスが所有するドメインの本体実装を要するか）。見送り行はチェックを付けず、下記の ID をそのまま Issue コメントへ **1 行ずつ**転記する（総行数 366 = 実装 277 + 見送り 89）。

**UC 行（3 行）**

| ID | 理由 | 引き継ぎ先 |
|---|---|---|
| UC-workspace-021 `deleteMembershipsForUser` | Workspace ドメイン本体（`Membership` 集約）が無い | #3 |
| UC-job-011 `deleteJobsForRequester` | Job 集約と削除マニフェストが無い | #5 |
| UC-integration-015 `deleteIntegrationsForUser` | ExternalConnection / BackupRecord / CredentialResolver が無い | #4 |

**UC-identity-020 `deleteAccount`（1 行、チェックしない）**: personal + global 経路は完成させるが、workspace scope の prepare / commit / rollback wave と唯一 owner による rejected が #3 依存で残るため、部分実装をチェック済みにしない。#3 完了時に #3 側でチェックする。

**PAGE 行（3 行）**

| ID | 理由 | 引き継ぎ先 |
|---|---|---|
| PAGE-p21-004 | 公開プロフィール preview（P-42 が未実装） | #9 |
| PAGE-p24-002 | workspace 使用量の追加読込（行が常に空） | #3 |
| PAGE-p25-004 | 唯一 owner 問題を解消（rejected 経路が workspace 依存） | #3 |

いずれも UI 上に対応要素を出さない（無効ボタンの placeholder を作らない）。

**TC 行（82 行）**

| ID（行単位） | 理由 | 引き継ぎ先 |
|---|---|---|
| TC-workspace-069, 070, 071, 072, 073, 074, 075 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-job-056, 057, 058, 059, 060, 061, 062, 063, 064, 065 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-integration-026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-usage-031 | workspace 行削除後の cleanup | #3 |
| TC-usage-048, 049, 050, 051, 052, 053, 054 | workspace 使用量（`membership_directory` が空。ページング構造は本 Issue で実装済み・検証は #3） | #3 |
| TC-storage-044 | `deleteNotesForOwner` との形の比較（当該 UC が編集 / 整理スライス） | 編集・整理スライス |
| TC-storage-168, 169 | workspace アイコン（`WorkspaceAuthorization` が #3） | #3 |
| TC-identity-083 | personal Note / Tag / File / Backup / Usage の全データ削除（`note` / `tag` / `backup` participant が不在 — ADR-002。File / Usage だけの部分確認を「全データを削除」と読み替えない） | 編集・整理スライス / #8 / #4 |
| TC-identity-092 | 公開 personal Note の URL が tombstone になる（`deleteNotesForOwner` と `/@handle` 公開ページの両方が本 Issue 外 — ADR-009） | 編集・整理スライス / #9 |
| TC-identity-183 | Google Drive 連携が残ることの確認 | #4 |
| TC-identity-276 | ハンドル初回設定時の `note_routes(created_by)` fan-out 再投影（購読側が Note スライス、かつ workspace 所有ノートが #3 — ADR-009） | #3 / Note スライス |
| TC-identity-277 | `searchPublicNotes` の結果に著者リンクが出る | #9 |
| TC-identity-289 | 旧ハンドル URL が失効し新 URL で到達できる（`/@handle` 公開ページ — ADR-009） | #9 |
| TC-identity-051, 052 | 唯一 owner による rejected とその再要求 | #3 |
| TC-identity-055, 056, 057, 058, 059, 060, 061, 062, 063, 064, 065, 066, 067, 068 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-069, 070, 071, 072 | Job の強制終端 | #5 |
| TC-identity-076, 077, 078 | 他メンバーの Job / 変換 Job / artifact | #5 / #6 |
| TC-identity-073, 074, 075, 079, 080 | membership edge と workspace scope の write / Note | #3 |
| TC-identity-097, 098, 099 | workspace prepare の dispatch と barrier 前後の write | #3 |
| TC-identity-088 | Drive 連携と複数 scope の backup 記録 | #4 |
| TC-identity-108 | rejected header / operation の prune（rejected 経路が #3 依存） | #3 |

**本 Issue で実装しない周辺 UC**: `applyStorageDelta` / `ensureUploadAllowed` / `consumeLlmCall` / `initializeQuota`（UC-usage、チェックリスト外 — 消費の増分反映は #6、本 Issue の整合は `recalculateStorageUsage` で取る）、`storeUpload` / `storeMedia` / artifact・orphan 回収（#6）、`deleteNotesForOwner` / `deleteTagsForScope`（編集・整理スライス）、`pruneExpiredAuthState` の cron 配線（Issue #15）、`projectNoteChanges`（Note スライス — ADR-009）。

**縮退（Issue コメントに記録する）**

記録形式: 1 項目 1 行で「内容 / 理由 / 引き継ぎ先」。**チェックを付ける行の一部を欠く縮退は、どの ID のどの要素を欠いたかまで書く**（例: 「`PAGE-p20-001` — spec の個人設定 5 タブのうち『連携』を除く 4 タブでチェック（P-23 が #4）」「`PAGE-p22-001` — spec の状態一覧のうち『再認証要求』を除いてチェック」）。後続スライスが差分を行単位で拾えるようにするため。

- 先行 accept Saga の有界回復（`MembershipDirectoryReservationStore.listActivatingByUser` で `activating` edge が 0 件になるまで manifest scan を待つ — spec/usecases/identity.md 手順 3）を行わない。当該ストアは #3 所有で、本 Issue には membership 予約を作る経路が無いため実害は無いが、`deleteAccount` の受理経路が spec より緩い前提に立つ。
- アバター保存時の `consumedBytes` **と `noteCount`** の未反映（ADR-004。どちらも `applyStorageDelta` が担うため。TC-usage-059「ゴミ箱のノートも数える」の根拠は `recalculateStorageUsage` の `countByOwner(owner, "all")` 側だけになる）、dev IdP でのマニュアルテスト（ADR-003）、`storeAvatar` の workspace 主体は常に拒否（ADR-014）。
- **personal cleanup の participant は `storage` / `usage` の 2 つだけ**（ADR-002 / ADR-018）。`job`（#5）/ `note`（編集・整理スライス）/ `tag`（整理スライス）/ `backup`（#4）に加えて、**`localProjection`**（削除由来の local 投影 task を積む主体が本 Issue に無い。author redaction は manifest item ack として別勘定 — 編集・整理 / Note スライス）と **`outbox`**（scope 平面から配送 ack を観測する読み側が無い。`storage.fileDeleted` の配送は `deleteStoredObjects` の冪等処理が担保 — #11 / scope outbox 読み側を持つスライス）も `AbsentReason` として残る。
- **finalize の必須 receipt も宣言集合に縮退する**（ADR-017）。`externalConnections`（#4）/ `jobHistory`（#5）を ack する主体が本 Issue に無いため、必須集合は `personalCleanup` / `authResidue` / `uniquenessRelease` の 3 つ。#4 / #5 が `AbsentReason` を差し替えた時点で必須集合に入る。
- **`AccountDeletionRetryPolicy`（8 件 / 120 日）と `AccountDeletionRetryLimitExceeded` は到達不能な先行実装**（ADR-013）。しきい値が発火するには同一利用者の terminal 行が 8 件必要だが、`completed` は 1 件しか作れず、`rejected` 経路は workspace 依存で #3。根拠行 `TC-identity-052` も見送り。本 Issue で検証するのはドメイン単体テスト（7 / 8 / 9 の境界）と `countTerminalSince` の適合スイートまでで、行としての検証は #3。
- **`getUsageSnapshot` の workspace ページングを実装しない**（AC-21）。`membership_directory` の keyset と `workspace_directory` の名前解決に要るポートが実コードに無く、本 Issue では新設しないため、workspace セクションは常に空配列を返す。上限 20 / 並行 6 / ページ部分失敗時の `state: "unavailable"` を含めて #3。
- **受理応答 / barrier ack を落としたときの再駆動主体を置かない**。`spec/database/index.md` は `next_attempt_at` の partial index を recovery Cron が使うと定めるが、本 Issue の `DistributedOperationStore` は `next_attempt_at` を持たず recovery を回すステップも無い。事実上の再駆動は P-25 の再送（同一 `requestId` で冪等）に依存する。継続タスク（scope 平面）は `ScopeTaskScheduler` の backoff で自律再開するので、対象は「受理そのものを落とした場合」に限られる。
- **P-20 の「連携」タブを出さない**。`spec/pages/index.md` の個人設定タブ列は 5 つ（プロフィール / ログイン方法 / 連携 / 使用量 / アカウント削除）だが、連携タブの遷移先 P-23 は #4。`PAGE-p20-001` はチェックを付ける行なので、4 タブで出す判断を縮退として明記する（無効タブの placeholder も置かない）。
- **P-22 の「再認証要求」状態を実装しない**。`spec/pages/index.md` の P-22 状態一覧には「再認証要求」があり、シナリオ AC-06 は「パスワードを追加する際は Google 再認可を求める」としているが、`spec/usecases/identity.md` の `addPasswordIdentity` 手順に再認可が無い。`PAGE-p22-001` はチェックを付ける行なので、この状態を出さない判断を縮退として明記し、spec-sync 候補（ステップ 34）に載せる。マニュアル TC-07 手順 2 の skip と同じ理由。
- **Google OAuth アダプターの適合スイートは資格情報の無い環境で skip される**（AC-6 / ADR-003）。CI と既定の開発機で実際に実行されるのは dev IdP アダプターと、両アダプター共通の `deriveCodeChallenge` 契約のみ。
- **アイコンをアップロードしてプロフィールを保存せずに離脱すると、参照されない `StoredFile` が 1 件残る**（ADR-016 の 2 段経路の帰結）。orphan media 回収は #6 の担当。`sumSizeByOwner` には算入されるので `recalculateStorageUsage` の値には現れる。

**本番の外部サービス結合**: 実メール送信（memory の `MailSender` のまま。本文は開発ログから読む）、R2 等の実オブジェクトストレージ（memory + 配信ルート）、Cloudflare ランタイム（#11）。Google OAuth は実アダプターを実装する（ADR-003）が、資格情報のない環境では dev IdP を明示的に選択する。

**#1 から引き継ぐ見送り行**: `PAGE-p01-003` / `PAGE-p02-003` / `PAGE-p02-004` / `PAGE-p02-006` / `ADP-identity-033/034` は本 Issue のチェックリストには無いが、`.thread/1/progress.md` が「本スライス外」として見送った行を本 Issue が実際に埋める。ステップ 34 で Issue #1 側のコメントに「本 Issue で実装済み」と追記する。

## リスクと注意点

- **テーマ H（アカウント削除）が単独で全体の 4 割規模**。しかも「#1 で土台は完成済み」は成り立たない: control plane（`DistributedOperationStore`）・scope 平面の継続タスク（`ScopeTaskScheduler` / `scheduled_tasks`）・scope 平面の operation 重複排除（`AppliedOperationStore`）・グローバルイベント consumer の実行経路・期限到来 scope の列挙（`ScopeTaskQueue` — ADR-005）の 5 つが新設で、うち 4 つはテーマ A に前倒しした（ステップ 2, 4, 5, 6）。加えて **#1 で「完成済み」のポートのうち 5 つ（`AccountDeletionManifestStore` / `OAuthStateStore` / `NoteRouteFanOutReader` / `Local`・`PublicNoteProjectionWriter`）はコンテナ・UoW に載っておらず適合テストからしか触れない**ので、本 Issue で実行経路へ載せる。ここが遅れるとテーマ H 全体が動かない。
- **既存 2 ポートの必須集合を宣言的部分集合へ一般化する**（`ScopeCleanupAdmissionStore` の 8 component — ADR-002、`AccountDeletionManifestStore` の 5 receipt — ADR-017）ため、既存の適合スイート（`ADP-common-*`）と memory アダプターに手が入る。**後者をやらないと `externalConnections` / `jobHistory` を ack する主体が本 Issue に存在せず `markCompleted` に到達できない**（finalize 系の TC と AC-26 / 27 / 29 が構造的に落ちる）。#1 の緑を壊さないよう、両方の一般化をステップ 29 の先頭で単独コミットにする。`IdentityUniqueDirectory`（ADR-015、ステップ 1）と合わせて、本 Issue が #1 の完成物を書き換えるのはこの 3 ポート。
- **`deleteAccount` は `User` の状態遷移を通じて他テーマに波及する**。`DeletingUser` / `DeletedUser` が存在するようになるので、signIn / OAuth / passwordReset / linkIdentity の各経路が `ACCOUNT_UNAVAILABLE` 相当へ正しく倒れるかを、テーマ H 完了後に横断で再確認する（TC-identity-029, 122, 124, 189, 205, 266 がその検証行）。
- **`authEpoch` バンプ経路が 4 つに増える**（resetPassword / changePassword / signOutOtherSessions / deleteAccount）。残渣掃除コンシューマーは 4 経路が共有する 1 実装で、`sessions` → `authTokens` の phase 切替と「現世代を消さない」不変条件を壊すと全経路が同時に壊れる。ステップ 3 で先に作り、以降のテーマはそれを呼ぶだけにする。
- **一意性予約サガの kind が 3 つに増える**（email に加えて handle / providerAccount）。`updateProfile` の「新 handle 予約 → UserId shard 更新 → activate → 旧 handle を releasing」と、`completeOAuthSignIn` の「email + providerAccount の 2 予約」は失敗時の解放順序を間違えると恒久的な予約漏れになる。TC-identity-031/032, 280/281 がその検証行。
- **`PROVIDER_ACCOUNT_ALREADY_LINKED` の担保箇所が未確定**（#1 の spec-sync メモ）。memory では `IdentityUniqueDirectory` が担保し `IdentityRepository` は投げない。本 Issue で「一意性は directory、応答は usecase」に寄せる形で確定し、spec-sync 候補として記録する。
- **OAuth の dev IdP が production に漏れないこと**は配線規律 + 起動時ガード（`NODE_ENV=production` かつ `OAUTH_DEV_MODE=true` は起動失敗 — ADR-003）で守る。composition root の分岐を 1 箇所に閉じ、レビュー対象として明示する。
- **OAuth の env 必須化で既存の `.env` が起動しなくなる**。現行 `apps/web/.env.example` の必須項目は `APP_URL` だけで、開発者の手元 `.env`（コミットされない）は ADR-003 の規則 3（`OAUTH_DEV_MODE` も Google 資格情報も無ければ起動失敗）に当たる。`.env.example` の更新に加えて、ステップ 34 の Issue コメントに「既存の `.env` に `OAUTH_DEV_MODE=true` を 1 行足す」と明記し、マニュアルテスト実行者が最初につまずかないようにする。
- **`IdentityUniqueDirectory` の解放 API を拡張する**（ADR-015）。現行 `release(operationId)` は `reserved` 行しか消さず、`DirectoryRow.state` に `releasing` が無い。`removeIdentity` / `updateProfile` の旧ハンドル / `deleteAccount` の 3 経路がすべて **active 行の解放**を要求するので、ステップ 1 で拡張しないと 3 テーマが同時に止まる。既存の適合スイートと memory 実装に手が入るため、#1 の緑を壊さないようステップ 1 の先頭で単独コミットにする。
- **`/settings/*` は 5 ルート同時新設**で、P-20 タブ・`AppShell`・`AccountMenu` に同時に手が入る。既存の `AppShell` は「個人コンテキスト固定の最小形」なので、タブを足すときにワークスペース設定タブ列（#3）と混ぜない。
- **複数テーマが同じファイルを並行編集する**（`components/auth/SignInForm`、`application/identity/uniqueness.ts`、`components/layout/AccountMenu`、`routes/__root.tsx`）。steps.md 冒頭の「共有ファイルの所有ステップ」表で所有者を決め、非所有ステップは追記のみ・同一ファイルの同時編集を避ける。
- **先行 accept Saga の有界回復を省く**（上記の縮退）。#3 が membership 予約を実装した時点で、`deleteAccount` 受理経路に `listActivatingByUser` の待ちを足す必要がある — 引き継ぎとして Issue コメントに残す。
- **ミューテーションの三層規律**（CLAUDE.md）を新規 7 画面すべてで守る。特に P-22 の「認証手段の追加 / 解除」はリスト増減なので親 island が所有し、解除は leaf に持たせない。P-21 のフォーム保存・P-25 の削除実行は `useActionState` + pending / optimistic を必ず付ける。
- **`__root.tsx` への副作用 import 漏れ**でビルド後に server function が 404 になる（#1 の gotcha）。新規 action モジュールを足すたびに追加する。
- **memory の非永続性**: dev サーバー再起動でアバターとアカウントが消え、削除 status ticket の署名鍵（既定はプロセス毎ランダム — ADR-006）も変わる。マニュアルテストは 1 プロセス内で完結させる。

## テスト方針

- **ドメイン単体テスト**: `packages/core/src/domain/usage/__tests__/`（VO の境界: 80% / 100% 警告、BillingPeriod の UTC 暦月、ByteQuota の subject 別既定値、`add`/`subtract`/`consume` の不正差分、`ensureCanStore`/`ensureCanCall`）、`domain/storage/__tests__/`（`UploadValidationPolicy` の avatar 行: 5MB 境界・GIF 拒否）、`domain/identity/__tests__/` の追補（既存の VO / ポリシーで未検証の分岐があれば）。
- **ポート適合テスト**: `adapters/conformance/` に 9 スイートを追加し、`ConformanceBackend` と memory バックエンドへ配線して 1 行ずつ登録する — `storageQuotaRepository` / `llmUsageRepository` / `storedFileRepository` / `objectStorage` / `signInOAuthClient` / `identityRemovalReceiptStore` / `scopeTaskScheduler` / `appliedOperationStore` / `distributedOperationStore`。既存スイートの改訂は 3 本 — `scopeCleanupAdmissionStore` は宣言的必須集合へ一般化し（`ConformanceBackendOptions.requiredCleanupComponents`）、あわせて `describePersonalCleanup` と「completed 後の `markCompleted` / `acknowledgePersonalComponent` は冪等 no-op」を追加する（ADR-018）。`accountDeletionManifestStore` は必須 finalize receipt を `ConformanceBackendOptions.requiredFinalizeReceipts` 経由の宣言集合へ一般化する（ADR-017）。`identityUniqueDirectory` は active 予約の `releasing → release`（所有者不一致は no-op / 同一 operationId で冪等 / `beginRelease` が行の `operationId` を差し替える / 解放後は別 user が reserve できる）を追加する（ADR-015）。`scopeTaskScheduler` スイートには同じ表の読み側である `ScopeTaskQueue.listDue` の契約（期限到来分だけを scope 横断で返す / `dueAt` 昇順 / limit 尊重）も含める。契約化するのは観測可能な結果だけ（#1 ADR-035）。
- **ユースケーステスト**: `application/{identity,usage,storage}/__tests__/` に TC ID をテスト名に含めて実装する。`createTestHarness()` を使い、外部ポート（OAuth クライアント・メール）は `requestOverrides` で差し替える。並行・応答喪失系（TC-identity-030..032, 185, 186, 211, 280, 281, 293 と deleteAccount の recovery 群）は「同じ入力を 2 回流す / 途中で例外を注入して同じ operationId で再投入する」形で書く。
- **deleteAccount のテストハーネス**: 継続入力を再投入するドライバー（`runUntilSettled(harness, operationId)`）を `application/identity/__tests__/` に用意し、各 TC は「途中で止める / 応答を落とす / 二重配送する」の差分だけを書く。
- **プレゼンテーションテスト**: 既存の `apps/web/app/presentation/__tests__/` に、status ticket の署名・検証・期限（ADR-006）と OAuth callback の intent 分岐（ADR-007）を追加する。
- **検証コマンド**: `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test:unit`。
- **マニュアルテスト**: `spec/manual-tests/account.md` を `pnpm dev`（dev IdP モード）で実行する。実行 / skip の範囲は上の「マニュアルテストの実行範囲（AC-30）」表が正典。合否は AC-30 の基準（各手順が期待結果どおり／不一致は原因と対応 Issue つきで記録）で判定し、記録はステップ 34 で Issue コメントにまとめる。

## 未解決事項

R3 反映後もなお決めきれていない点。実装フェーズで最初に判断し、決めたら adr.md に追記する。

- **global consumer の冪等性境界**: ADR-019 で継続イベント ID を決定的にした結果、同じ ID の outbox 行が再保存されると 1 度だけ再配送されうる。購読者レジストリのどのハンドラーが `IdempotencyStore.markProcessed(consumer, eventId)` を通すかは実装時に決める（非可換な副作用を持つ `authResidueCleanup` / `identityRemovalRelease` は通し、キー削除だけの `deleteStoredObjects` は通さない、が現時点の想定 — ステップ 2 / 3 / 19 で確定させる）。
- **`deleteFiles` の OCC 競合時の回復**: barrier 後は通常 write が閉じているので `OPTIMISTIC_LOCK_FAILURE` は理論上起きないが、起きた場合は `ScopeTaskScheduler.backoff` の上限に達して `failed` へ落ち、manifest は running のまま残る。手動回復の手順（`failed` タスクの再投入）は本 Issue では定義しない。
- **`localProjection` / `outbox` を participant に戻すスライスとの整合**: ADR-018 で 2 component を `AbsentReason` にしたため、本 Issue の配備で `completed` になった barrier receipt（120 日保持）は、後続スライスが participant を足した後の必須集合を満たさない状態で残る。過去 receipt をどう扱うか（そのまま保持 / 移行時に読み替え）は participant を足すスライスの判断に委ねる。
- **dev IdP の `code` 表現**: ADR-021 は「dev アダプターが復号できる自己完結トークン」とだけ決めており、署名の有無と鍵の出所（composition root 供給に揃えるか、開発専用の固定値にするか）は実装時に決める。production では 404 になるルートなので、選択はセキュリティ要件ではなく実装の単純さで決めてよい。
