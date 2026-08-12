# 進捗メモ — Issue #2（ステップ 34: 仕上げ）

ステップ 1〜33 は実装・コミット済み。本メモはステップ 34（横断確認 / 見送り一覧の確定 / 縮退・spec-sync の整理 / 自動テスト）の記録と、Issue コメントへの転記用の文面をまとめたもの。

## 残存課題

### 本フェーズで実施していない作業（担当フェーズが別）

- **Issue #2 本文のチェックボックス（277 行）は 1 つも付いていない**。`gh issue view 2` で取得した本文のチェックリストは 366 行すべて `- [ ]` のまま。AC-33 は「実装 277 行がチェック済み」を求めるので、下記「見送り一覧」の 89 行**以外**の 277 行にチェックを付ける作業が残っている（ID 単位の突合は本メモで済ませてある）。
- **Issue #2 / #1 へのコメント投稿**は行っていない。本メモの「Issue コメント用」節をそのまま転記する。
- **マニュアルテスト（AC-30 / ステップ 34 項目 6 の後半）** は未実施。`spec/manual-tests/account.md` の実行分 30 件はブラウザ検証フェーズが担当する。

### 既知の制限・エッジケース

- **`deleteFiles` の OCC 競合からの手動回復手順が未定義**（plan.md「未解決事項」のまま）。barrier 後は通常 write が閉じているので `OPTIMISTIC_LOCK_FAILURE` は理論上起きないが、起きた場合は `ScopeTaskScheduler.backoff` の上限に達して `failed` へ落ち、manifest は running のまま残る。`failed` タスクの再投入手順は本 Issue では定義しない。
- **`localProjection` / `outbox` を participant に戻すスライスとの整合**（plan.md「未解決事項」のまま）。ADR-018 で 2 component を `AbsentReason` にしたため、本 Issue の配備で `completed` になった barrier receipt（120 日保持）は、後続スライスが participant を足した後の必須集合を満たさない状態で残る。過去 receipt の扱いは participant を足すスライスの判断に委ねる。
- **`ScopeTaskScheduler.claimDue` の実利用者が本 Issue に居ない**（ADR-061）。適合スイートからしか呼ばれない。複数プロセスでランナーを走らせる場合は claim による排他が要るので、そのときにランナー側へ戻す判断が必要 — #11 への引き継ぎ。
- **memory アダプターの非永続性**: dev サーバー再起動でアバターとアカウントが消え、`DELETION_TICKET_KEY` 未設定なら削除 status ticket の署名鍵も変わる。マニュアルテストは 1 プロセス内で完結させる。

### 適用した回避策とその理由

- **`AccountMenu` の設定導線を `<a href>` から `Link` へ差し替えた**（ADR-030 のステップ 34 確認項目）。ステップ 9 の時点では `/settings/profile` が未生成で型付き `to` を書けなかったが、テーマ E〜H で 4 ルートが揃ったので素のリンクを残す理由が消えた。`SettingsTabs` は既に `Link` へ差し替え済みだった。差し替えないと設定への遷移だけフルナビゲーションのままになる。
- **`SignInOAuthClient` の適合スイートを 2 つに割った**（ADR-064 を追記）。`enabled: false` がスイート全体に掛かっていたため、AC-6 が「資格情報を要さない純関数の検証として両アダプターで実行する」と定める `deriveCodeChallenge` の S256 契約が Google 側で 1 度も実行されていなかった。認可要求の 2 ケース（challenge 導出 / URL 構築）は常に実行し、`exchangeCode` の 3 ケースだけを資格情報でゲートする形に変えた。

### フォローアップ

- 上記「本フェーズで実施していない作業」3 件。
- **先行 accept Saga の有界回復**（`MembershipDirectoryReservationStore.listActivatingByUser` で `activating` edge が 0 件になるまで manifest scan を待つ — spec/usecases/identity.md 手順 3）は実装していない。#3 が membership 予約を実装した時点で、`deleteAccount` 受理経路にこの待ちを足す必要がある。
- `spec/` への反映は下記「spec-sync 候補」節。spec-sync スキルで一括処理するか、#3 / #4 / #5 が自分の範囲を拾うかは未定。

## ステップ 34 で行ったコード変更

1. `packages/core/src/application/identity/__tests__/authFlowHelpers.ts` — `markDeleted`（active → `deleting` → `User.finalizeDeletion` で PII-free tombstone にする）を追加。
2. `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts` — TC-identity-266 は spec の前提が「削除開始済み**または削除済み**」なのに `deleting` しか検証していなかったため、tombstone のケースを 1 本追加（どちらも `UnauthorizedError` / state 行 0 件）。既存側も `markDeleting` ヘルパーへ寄せた。
3. `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts` — TC-identity-122 は spec の前提が「対象の利用者が削除済み」なのに行そのものを消す形だけだったため、tombstone のケースを 1 本追加（`USER_NOT_FOUND` / identity 増えない / providerAccount 予約 0 件）。
4. `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts` — TC-identity-029 の期待結果「Identity/Session を作らない」のうち Identity 側の表明が無かったので追加。
5. `packages/core/src/adapters/conformance/signInOAuthClient.ts` / `packages/core/src/adapters/oauth/__tests__/conformance.test.ts` — 上記「適用した回避策」の 2 本目（ADR-064）。
6. `apps/web/app/components/layout/AccountMenu/index.tsx` — 設定導線を `Link` へ（ADR-030）。
7. `apps/web/app/components/auth/SignUpForm/index.tsx` — 「Google・招待経由は本スライス外のため出さない」という JSDoc が実装（`OAuthButton` を表示している）と食い違っていたため、招待経由だけの記述に直した。
8. `.thread/2/adr.md` — ADR-064 を追記。

## 横断確認の結果（ステップ 34 項目 1）

`DeletingUser` / `DeletedUser` が存在する状態で signIn / OAuth / passwordReset / linkIdentity が正しく倒れるかの再確認。**6 行すべて既存テストで消化済み**で、実装と spec の食い違いは無かった（TC-122 / 266 の tombstone 分だけテストを足した）。

| TC | 消化場所 | 期待結果 |
|---|---|---|
| TC-identity-029 | `application/identity/__tests__/completeOAuthSignIn.test.ts` — 「TC-identity-029: a DeletingUser reached by address or by provider link is ACCOUNT_UNAVAILABLE」 | provider link 経由 / メール経由の両方で `ValidationError("ACCOUNT_UNAVAILABLE")`、Session も Identity も増えない |
| TC-identity-122 | `linkOAuthIdentity.test.ts` — 「TC-identity-122: refuses a user that no longer exists」＋（追加）「TC-identity-122: refuses a tombstoned user the same way」 | `NotFoundError("USER_NOT_FOUND")`、予約は解放される |
| TC-identity-124 | `linkOAuthIdentity.test.ts` — 「TC-identity-124: a deletion started after the flow blocks the late insert」 | `ValidationError("ACCOUNT_UNAVAILABLE")`、identity の late insert 無し、予約 0 件 |
| TC-identity-189 | `requestPasswordReset.test.ts` — 「TC-identity-189: sends nothing for an address whose account is deleting」 | 未登録と同じ空の成功応答。メールもトークンも発行しない |
| TC-identity-205 | `resetPassword.test.ts` — 「TC-identity-205: rejects a token whose user moved to deleting and keeps it deleting」 | `NotFoundError("AUTH_TOKEN_NOT_FOUND")`、user は `deleting` のまま |
| TC-identity-266 | `startOAuthFlow.test.ts` — 「TC-identity-266: a user that started deletion is not an authenticated principal」＋（追加）「TC-identity-266: a tombstoned user is not an authenticated principal either」 | `UnauthorizedError("UNAUTHENTICATED")`、OAuth state を作らない |

隣接する経路も確認した（いずれも既存で緑）。

- signIn: `TC-identity-234`（`signInWithPassword.test.ts`）が `DeletingUser` → `ValidationError("ACCOUNT_DELETING")` を固定している。最終 UoW でも status を読み直して同じコードへ倒す（`signInWithPassword.ts`）。
- `DeletedUser`（tombstone）はメールも handle も持たないため、`findByEmail` 経路（signIn / requestPasswordReset）は「未登録」に収束する。同一メール / 同一 provider account での再登録が通ることは `TC-identity-093 / 094`（`deleteAccount.globalCleanup.test.ts`）が固定している。
- `startOAuthFlow` / `linkOAuthIdentity` はどちらも `status !== "active"` を先に見る（前者は `UNAUTHENTICATED`、後者は `deleted` → `USER_NOT_FOUND` / `deleting` → `ACCOUNT_UNAVAILABLE`）。

## Issue コメント用: 見送り一覧（89 行）

見送り基準は adr.md ADR-001（他スライスが所有するドメインの本体実装を要するか）。**下記 89 行にはチェックを付けない**。

| ID | 理由 | 引き継ぎ先 |
|---|---|---|
| UC-workspace-021 `deleteMembershipsForUser` | Workspace ドメイン本体（`Membership` 集約）が無い | #3 |
| UC-job-011 `deleteJobsForRequester` | Job 集約と削除マニフェストが無い | #5 |
| UC-integration-015 `deleteIntegrationsForUser` | ExternalConnection / BackupRecord / CredentialResolver が無い | #4 |
| UC-identity-020 `deleteAccount` | personal + global 経路は完成。workspace scope の prepare / commit / rollback wave と唯一 owner による rejected が残るため部分実装をチェック済みにしない | #3 |
| PAGE-p21-004 | 公開プロフィール preview（P-42 が未実装） | #9 |
| PAGE-p24-002 | workspace 使用量の追加読込（行が常に空） | #3 |
| PAGE-p25-004 | 唯一 owner 問題を解消（rejected 経路が workspace 依存） | #3 |
| TC-workspace-069 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-workspace-070 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-workspace-071 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-workspace-072 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-workspace-073 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-workspace-074 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-workspace-075 | `deleteMembershipsForUser` 本体が #3 | #3 |
| TC-job-056 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-057 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-058 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-059 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-060 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-061 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-062 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-063 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-064 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-job-065 | `deleteJobsForRequester` 本体が #5 | #5 |
| TC-integration-026 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-027 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-028 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-029 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-030 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-031 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-032 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-033 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-034 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-035 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-036 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-037 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-038 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-039 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-integration-040 | `deleteIntegrationsForUser` 本体が #4 | #4 |
| TC-usage-031 | workspace 行削除後の cleanup | #3 |
| TC-usage-048 | workspace 使用量（`membership_directory` が空。ページング構造は本 Issue で実装せず ADR-051 で DTO ごと落とした） | #3 |
| TC-usage-049 | workspace 使用量（同上） | #3 |
| TC-usage-050 | workspace 使用量（同上） | #3 |
| TC-usage-051 | workspace 使用量（同上） | #3 |
| TC-usage-052 | workspace 使用量（同上） | #3 |
| TC-usage-053 | workspace 使用量（同上） | #3 |
| TC-usage-054 | workspace 使用量（同上） | #3 |
| TC-storage-044 | `deleteNotesForOwner` との形の比較（当該 UC が編集・整理スライス） | 編集・整理スライス |
| TC-storage-168 | workspace アイコン（`WorkspaceAuthorization` が #3） | #3 |
| TC-storage-169 | workspace アイコン（`WorkspaceAuthorization` が #3） | #3 |
| TC-identity-051 | 唯一 owner による rejected とその再要求 | #3 |
| TC-identity-052 | 唯一 owner による rejected とその再要求 | #3 |
| TC-identity-055 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-056 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-057 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-058 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-059 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-060 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-061 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-062 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-063 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-064 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-065 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-066 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-067 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-068 | workspace prepare / lock / rollback / release wave | #3 |
| TC-identity-069 | Job の強制終端 | #5 |
| TC-identity-070 | Job の強制終端 | #5 |
| TC-identity-071 | Job の強制終端 | #5 |
| TC-identity-072 | Job の強制終端 | #5 |
| TC-identity-073 | membership edge と workspace scope の write / Note | #3 |
| TC-identity-074 | membership edge と workspace scope の write / Note | #3 |
| TC-identity-075 | membership edge と workspace scope の write / Note | #3 |
| TC-identity-079 | membership edge と workspace scope の write / Note | #3 |
| TC-identity-080 | membership edge と workspace scope の write / Note | #3 |
| TC-identity-076 | 他メンバーの Job / 変換 Job / artifact | #5 / #6 |
| TC-identity-077 | 他メンバーの Job / 変換 Job / artifact | #5 / #6 |
| TC-identity-078 | 他メンバーの Job / 変換 Job / artifact | #5 / #6 |
| TC-identity-083 | personal Note / Tag / File / Backup / Usage の全データ削除（`note` / `tag` / `backup` participant が不在 — ADR-002。File / Usage だけの部分確認を「全データを削除」と読み替えない） | 編集・整理スライス / #8 / #4 |
| TC-identity-088 | Drive 連携と複数 scope の backup 記録 | #4 |
| TC-identity-092 | 公開 personal Note の URL が tombstone になる（`deleteNotesForOwner` と `/@handle` 公開ページの両方が本 Issue 外 — ADR-009） | 編集・整理スライス / #9 |
| TC-identity-097 | workspace prepare の dispatch と barrier 前後の write | #3 |
| TC-identity-098 | workspace prepare の dispatch と barrier 前後の write | #3 |
| TC-identity-099 | workspace prepare の dispatch と barrier 前後の write | #3 |
| TC-identity-108 | rejected header / operation の prune（rejected 経路が #3 依存） | #3 |
| TC-identity-183 | Google Drive 連携が残ることの確認 | #4 |
| TC-identity-276 | ハンドル初回設定時の `note_routes(created_by)` fan-out 再投影（購読側が Note スライス、かつ workspace 所有ノートが #3 — ADR-009） | #3 / Note スライス |
| TC-identity-277 | `searchPublicNotes` の結果に著者リンクが出る | #9 |
| TC-identity-289 | 旧ハンドル URL が失効し新 URL で到達できる（`/@handle` 公開ページ — ADR-009） | #9 |

### 行数の検算（AC-33）

`gh issue view 2` の本文から `- [ ]` / `- [x]` 行を機械抽出して突合した（plan.md の自己申告ではなく実データ）。

| 項目 | 値 |
|---|---|
| チェックリスト総行数 | **366**（ID 重複 0、パースできない行 0） |
| 見送り（上表） | **89**（ID 重複 0、全 89 行が checklist に実在） |
| 実装 | **277**（366 − 89。取りこぼし 0 / 二重計上 0） |
| 内訳（実装 277） | TC 205 / DOM 17 / ADP 9 / PAGE 27 / UC 19 |
| 内訳（見送り 89） | TC 82 / PAGE 3 / UC 4 |

**`277 + 89 = 366` が成立**。

裏取りとして、実装 277 行のうち TC 205 行はすべてテストコード側に ID の言及があることを機械確認した（複数行を 1 テストで消化しているものは結合表記: `TC-identity-105/107`、`ADP-usage-001/002`、`ADP-usage-006/007`）。`DOM-usage-009..017` / `ADP-usage-002` / `ADP-usage-007` は ID をテスト名に持たないポート定義・アダプター実装行なので、`domain/usage/ports/{storageQuotaRepository,llmUsageRepository}.ts` のメソッド存在と適合スイートの該当ケースで確認した。

注意: **`TC-identity-052` は見送り行で、同 ID を冠したテスト名は存在しない**。`domain/identity/__tests__/policies.test.ts` に `AccountDeletionRetryPolicy` の境界を押さえるドメイン単体テストはあるが、TC-identity-052 との関係はテスト名ではなくコメントに残している。plan.md の縮退（`AccountDeletionRetryPolicy` は到達不能な先行実装）どおり、境界のドメイン検証だけ先に置き、行としての検証は #3 に残す形。チェックは付けない。

## 縮退（実装したが spec の一部要素を欠く）

### チェックを付ける行の一部を欠くもの（ID 単位）

- `PAGE-p20-001` — spec の個人設定タブ列 5 つ（プロフィール / ログイン方法 / **連携** / 使用量 / アカウント削除）のうち、**連携を除く 4 タブ**でチェック。遷移先 P-23 が #4。無効タブの placeholder も置かない。ワークスペース設定のタブ列（一般 / メンバー / 公開 / 削除）も #3 のため出していない。
- `PAGE-p21-001` — spec の機能のうち「**公開ページへのプレビュー導線**」を除いてチェック（同じ導線を指す `PAGE-p21-004` は見送り行）。P-42 が #9。
- `PAGE-p22-001` — spec の状態一覧のうち「**再認証要求**」を除いてチェック。`spec/usecases/identity.md` の `addPasswordIdentity` 手順に再認可が無く、シナリオ AC-06 の記述と spec が食い違っているため（spec-sync 候補、マニュアル TC-07 手順 2 の skip と同根）。
- `PAGE-p24-001` — spec の機能のうち「**ワークスペースごとの容量・ノート件数**」と「**workspace を 20 件ずつ読み込む導線**」、状態のうち「**さらに読み込む / workspace 部分取得中 / workspace ごとの取得不可**」を除いてチェック（個人の容量・ノート件数・当月 LLM 回数・最終更新時刻・80% 警告・上限到達・削除画面への導線のみ）。`membership_directory` の keyset を引くポートが無いため。
- `PAGE-p25-001` — spec の機能のうち「**唯一の owner が見つかった場合は削除を中止し、再サインイン後に移譲を案内する**」と、状態の「**実行不可（唯一の owner）**」を除いてチェック（同じ経路を指す `PAGE-p25-004` は見送り行）。
- `UC-usage-001 getUsageSnapshot` — spec の出力 DTO のうち **workspace セクションのページング構造ごと**（`workspaces: WorkspaceUsageItem[]` / `nextWorkspaceCursor` / 入力の `workspaceCursor` / `workspaceLimit`）を落として `workspaces: readonly never[]` だけにしてチェック（ADR-051）。上限 20 / 並行 6 / ページ部分失敗時の `state: "unavailable"` は #3。
- `UC-storage-004 storeAvatar` — spec の入力 DTO から **`size`** を落とし実バイト長を唯一のサイズとしてチェック（ADR-048）。**workspace 主体は常に `BusinessRuleError(InsufficientRole)` で拒否**（ADR-014、`WorkspaceAuthorization` が #3）。保存しても `StorageQuota.consumedBytes` は即時に増えない（`applyStorageDelta` が #6）。
- `UC-storage-013 deleteFilesByOwner` / `UC-usage-007 deleteQuota` — spec に無い戻り値（turn の `status`、`deletedCount`）を足してチェック（ADR-055）。
- `TC-identity-044` — spec の期待結果は personal Note の owner scan（`deleteNotesForOwner`、本 Issue 外）だが、**personal File write（`storeAvatar`）が barrier command より先に確定し、barrier ack 後の `deleteFilesByOwner` の owner scan がその行を回収する**形に読み替えてチェック（plan.md AC-26）。
- `TC-identity-085` — spec の期待結果は 8 component 固定だが、**ADR-002 / ADR-018 の宣言集合（`storage` / `usage` の 2 つ）**に読み替えて「1 つでも欠ければ running のまま」を検証してチェック。
- `TC-storage-043` — spec の期待結果「列挙 1 文 + 多行 DELETE 1 文 + 多行 outbox INSERT 1 文の計 3 文」のうち**文の数という性能上の約束を検証せず**、「列挙は 1 回だけ / 削除できたファイル 1 件につき `storage.fileDeleted` が 1 件 / どちらも件数に依存しない」に置き換えてチェック（ADR-057。OCC トークンを `findById` から得る ADR-022 の帰結で 1 件ずつ読む）。
- `TC-usage-059`（ゴミ箱のノートも数える）— 根拠は `recalculateStorageUsage` の `countByOwner(owner, "all")` 側**だけ**。`noteCount` の即時反映（`applyStorageDelta`）が #6 のため。
- `TC-identity-090` — spec の期待結果のうち「**再試行時刻を記録する**」を欠いてチェック（ADR-026。`DistributedOperationStore` が `next_attempt_at` を持たないため、記録すべき時刻そのものが無い。事実上の再駆動は P-25 の再送に依存する。cleanup 引き渡しは ADR-106 の継続行が駆動する）。検証しているのは「`deleting` のまま / PII が残る / manifest は `built` のまま / finalize が待ち続けるログ」まで。→ recovery Cron を足すスライス

### 機能・運用としての縮退

- **先行 accept Saga の有界回復を行わない**（`MembershipDirectoryReservationStore.listActivatingByUser` で `activating` edge が 0 件になるまで manifest scan を待つ — spec/usecases/identity.md 手順 3）。当該ストアは #3 所有で本 Issue に membership 予約を作る経路が無いため実害は無いが、`deleteAccount` の受理経路が spec より緩い前提に立つ。→ #3
- **アバター保存時の `consumedBytes` と `noteCount` が即時反映されない**（ADR-004。どちらも `applyStorageDelta` が担う）。`sumSizeByOwner` / `countByOwner` の集計対象ではあるので `recalculateStorageUsage` で反映される。→ #6
- **`storeAvatar` の workspace 主体は常に拒否**（ADR-014）。→ #3
- **personal cleanup の participant は `storage` / `usage` の 2 つだけ**（ADR-002 / ADR-018）。`job`（#5）/ `note`（編集・整理スライス）/ `tag`（整理スライス）/ `backup`（#4）に加えて、**`localProjection`**（削除由来の local 投影 task を積む主体が本 Issue に無い。author redaction は manifest item ack として別勘定）と **`outbox`**（scope 平面から配送 ack を観測する読み側が無い。`storage.fileDeleted` の配送は `deleteStoredObjects` の冪等処理が担保）も `AbsentReason` として残る。→ #5 / #4 / 編集・整理スライス / #11
- **finalize の必須 receipt も宣言集合に縮退**（ADR-017）。`externalConnections`（#4）/ `jobHistory`（#5）を ack する主体が本 Issue に無いため、必須集合は `personalCleanup` / `authResidue` / `uniquenessRelease` の 3 つ。→ #4 / #5
- **`AccountDeletionRetryPolicy`（8 件 / 120 日）と `AccountDeletionRetryLimitExceeded` は到達不能な先行実装**（ADR-013）。しきい値の発火には同一利用者の terminal 行が 8 件必要だが、`completed` は 1 件しか作れず `rejected` 経路は workspace 依存。検証はドメイン単体テスト（7 / 8 / 9 の境界）と `countTerminalSince` の適合スイートまで。→ #3
- **`getUsageSnapshot` の workspace ページングを実装しない**（ADR-051）。→ #3
- **受理応答を落としたときの再駆動主体を置かない**。`spec/database/index.md` は `next_attempt_at` の partial index を recovery Cron が使うと定めるが、本 Issue の `DistributedOperationStore` は `next_attempt_at` を持たず recovery を回すステップも無い。受理そのものを落とした場合の再駆動は P-25 の再送（同一 `requestId` で冪等）に依存する。**barrier ack（scope→global の引き渡し）はこの縮退の対象ではない**: P-25 の再送が出すのは manifest build の継続だけで cleanup フェーズには戻らないため、runner が barrier を閉じたターンで専用の継続行 `identity.personalCleanupHandoverContinued` を先に積み、receipt が入ってから消す（ADR-106）。イベント駆動ウェーブ側は outbox の再配送が同じ役を果たす。**残る穴は、barrier を閉じたコミットと引き渡し行を積むコミットのあいだでプロセスが落ちた場合**（塞ぐには `completePersonalCleanupIfDone` と同じ UoW で積む必要があり、cleanup ユースケース側の変更になるため持ち越し）。継続タスク（scope 平面）は `ScopeTaskScheduler` の backoff で自律再開する。
- **Google OAuth アダプターの適合スイートのうち `exchangeCode` の 3 ケースは資格情報の無い環境で skip される**（AC-6 / ADR-003 / ADR-064）。CI と既定の開発機で実行されるのは dev IdP アダプターの全ケースと、両アダプター共通の認可要求（`deriveCodeChallenge` / `buildAuthorizationUrl`）契約。
- **マニュアルテストは dev IdP で実行する**（ADR-003）。実 Google 資格情報での往復は検証範囲外。
- **アイコンをアップロードしてプロフィールを保存せずに離脱すると、参照されない `StoredFile` が 1 件残る**（ADR-016 の 2 段経路の帰結）。orphan media 回収は #6。`sumSizeByOwner` には算入されるので `recalculateStorageUsage` の値には現れる。
- **`/settings/danger`（P-25）は未サインインでも 200 を返す**（ADR-062）。受理と同時にセッションが消える以上、進捗を読める画面は認証を要求できないため。読み取りの権限は status ticket が持ち、`getAccountDeletionStatus` は ticket が名指す 1 件しか返さない。`deleteAccountFn` 自体は `requireSession()` を通すので操作はできない。
- **本番の外部サービス結合は行っていない**: 実メール送信（memory の `MailSender` のまま。本文は開発ログから読む）、R2 等の実オブジェクトストレージ（memory + `/storage/$` 配信ルート）、Cloudflare ランタイム（#11）。
- **AC-19 / AC-22 の「`assertWritable` / `assertActorWritable` の 2 本を呼ぶ」が構造的に検証不能**。`scope.actorLocks` を立てる経路（membership prepare wave）が本 Issue に無いため、`storeAvatar` / `recalculateStorageUsage` の 2 本は同じ receipt 行の同じ `ACCOUNT_DELETING` に落ち、片方を消してもテストは緑のまま。actorLock を立てるバックエンドが入るまで両者を撃ち分けられない。→ #3

### steps.md / AC の記述と実装がずれた箇所（読み替えの記録）

- **AC-31 の「`NoteRouteFanOutReader` → `RequestContainer`」は `WorkerContainer` と読み替える**（ADR-054）。削除の継続ハンドラーは worker plane の consumer であり、`RequestContainer` は購読者からは作れないため。
- **steps.md ステップ 29 (4) の `claimPending("cleanup", 100)` は呼ばない**（ADR-056）。membership item を作る経路も cleanup コマンドの受け手も本 Issue に無く、呼ぶと「dispatch 済みだが誰も ack しない item」を作るだけになる。→ #3
- **steps.md ステップ 32 の対象ファイルのうち `presentation/errorResponse.ts` は変更していない**（ADR-063）。`spec/presentation/index.md#コードによる例外` の 5 行を増やさない判断。
- **マニュアル TC-40 手順 2「サインイン画面に戻り」はワンクリック挟む形で判定する**（ADR-038）。P-05 にキャンセル状態を出し、`/signin` へは明示リンクで戻す。

## spec-sync 候補

実装が spec と乖離した箇所。ID は本 Issue の adr.md の番号。

### ポート定義に足りない / 増えたメソッド

- `AuthTokenRepository.findPendingByUserAndPurpose(userId, purpose)` の追加（ADR-031）。`spec/domains/identity.md` のポート定義とテストケース表の両方に追記が要る。
- `SignInOAuthClient.deriveCodeChallenge(codeVerifier)` の追加（ADR-010）。PKCE S256 の導出をアダプター側に置いた。
- `ObjectStorage.publicUrl(key)` の追加（ADR-011）と、`put` / `get` が**バイト列のみ**でストリームを扱わない・`createDownloadUrl` を持たないこと（ADR-027）。→ #6 が広げる。
- `StorageQuota.replaceTotals(quota, { consumedBytes, noteCount }, now)` の追加（ADR-029）。spec の振る舞い表は差分メソッドしか持たない。
- `IdentityUniqueDirectory.beginRelease` の追加と `DirectoryRow.state` の `releasing`（ADR-015）。あわせて `resolve` は `releasing` を解決せず、`reserve` は `releasing` を塞ぐという非対称（ADR-028）。
- `ScopeCleanupAdmissionStore.describePersonalCleanup` の追加（ADR-018）。
- `ScopeCleanupAdmissionStore.assertOwner` が `completed` の barrier も `ConflictError` で弾く点が、ポート JSDoc にも適合スイート（ADP-common-008）にも固定されていない。周囲の設計意図（`markCompleted` / `acknowledgePersonalComponent` は完了済みを冪等に受ける）と逆向きに見えるので、`completed` の扱いを契約として明示したい。
- `AccountDeletionManifestStore.describe(operationId)` の追加（ADR-053）。
- `AccountDeletionManifestStore.pruneTerminal` の戻りを `{ removed }` から `{ operationIds, nextCursor }` へ（ADR-059）。header と operation を同一 transaction で消すため。
- `LocalNoteProjectionWriter` / `PublicNoteProjectionWriter` に `redactAuthor({ noteId, createdBy, redactionVersion })` を追加（ADR-058）。`projectNoteChanges` を実装するスライスは、完全 snapshot 置換と `redactAuthor` のどちらで author redaction を受けるかを選ぶ必要がある。
- `StorageErrorCode` に `InvalidChecksum`（`STORAGE_INVALID_CHECKSUM`）が無い（`domain/storage/errorCode.ts` のコメント参照）。

### DTO・入出力の差

- `storeAvatar` の入力 DTO から `size` を落とした（ADR-048）。実バイト長が唯一のサイズ。
- `recalculateStorageUsage` の入力に主体（`subjectType` / `subjectId`）とは別の**実行者 `userId`** を足した（ADR-052）。`assertActorWritable` に要るため。
- `getUsageSnapshot` の入出力から workspace ページングの構造を落とした（ADR-051）。#3 が `never[]` を置き換える形で戻す。
- `deleteQuota` に戻り値を、`deleteFilesByOwner` の戻り値に turn の `status` を足した（ADR-055）。
- `identity.accountDeletionManifestBuildContinued` / `…DispatchContinued` の payload に `cursor` を足し、`identity.accountDeletionManifestCompactContinued` を新設した（ADR-053 / ADR-060）。
- 継続イベント payload の `continuationKey`（決定的 EventId 導出 — ADR-019）。`identity.userAuthResidueCleanupContinued` だけは持たない（ADR-025）。
- OAuth コールバックの応答を intent 付きの判別共用体にし、`linkIdentity` arm に `redirectTo` を載せた（ADR-045。spec の出力 DTO は `identityId` のみ）。

### 手順・エラー表の差

- `startOAuthFlow` のエラー表に「非 active な主体の `linkIdentity` → `UnauthorizedError("UNAUTHENTICATED")`」の行が無い（ADR-039）。
- `requestPasswordReset` の手順に 60 秒の発行間隔規則が無い（ADR-041）。60 秒という値の正典が実装側にある。
- `addPasswordIdentity` の手順に Google 再認可が無い（`spec/pages/index.md` の P-22 状態一覧とシナリオ AC-06 は「再認証要求」を求める）。どちらを正とするか要決定。マニュアル TC-07 手順 2 の skip と同根。
- `SignInOAuthClient` の通信失敗が `SystemError(ExternalServiceError)` と書かれているが、実 enum は `SystemErrorCode.ExternalApiError`（`EXTERNAL_API_ERROR`）— 呼称ずれ（ADR-034）。
- `spec/testcases/identity/startOAuthFlow.md` の TC-identity-268 が `BusinessRuleError(InvalidProvider)` を期待しているが、未知プロバイダーの実コードは `IdentityErrorCode.InvalidProviderAccount`（`IDENTITY_INVALID_PROVIDER_ACCOUNT`）で、`InvalidProvider` は `spec/domains/identity.md` のエラーコード union にも存在しない — 呼称ずれ（spec 側を直す）。
- sub-operation ID を `sha256(parent + ":" + kind + ":" + key)` ではなく構成 `${parent}:${kind}:${key}` で導出した（ADR-035）。`removeIdentity` の `operationId` も同様に `"removeIdentity:" + identityId`（ADR-044）。application 層にハッシュ実装を持ち込まないため。
- `PROVIDER_ACCOUNT_ALREADY_LINKED` の担保箇所を「一意性は `IdentityUniqueDirectory`、応答は usecase（`linkOAuthIdentity` / `completeOAuthSignIn`）」に確定した。`IdentityRepository` の JSDoc はまだこのコードを自分の error contract に列挙しているが、memory アダプターは投げない。
- `completeOAuthSignIn` / `linkOAuthIdentity` のエラーケース表に `PROVIDER_ACCOUNT_RELEASE_PENDING`（`ConflictError`）の行が無い（ADR-108）。directory の claim は残っているが UserId shard に対応する identity が居ない収束待ちの状態を、`PROVIDER_ACCOUNT_ALREADY_LINKED` と別のコードで名乗る。手順 3 の要求（返った UserId shard で既存 Identity と User を確認する）自体は満たしているので、表側の追記だけ。
- `TC-storage-043` の「3 文」という性能上の約束を、観測可能な性質（列挙 1 回 / 削除 1 件につきイベント 1 件）に置き換えた（ADR-057）。D1 実装を書くスライスが同じ行を再検証する必要がある。

### 必須集合・データモデルの差

- personal cleanup の必須 component 集合を「spec の 8 固定」から**配備に存在する参加者の宣言集合**へ一般化した（ADR-002）。`spec/domains/index.md` に「必須集合は配備に存在する参加者の集合」を書き足す必要がある。
- finalize の必須 receipt 集合も同じく宣言集合へ（ADR-017。spec は 5 receipt 固定）。`personalAbort` は rollback 側の receipt なので必須集合の対象外（`Record<Exclude<AccountDeletionReceipt, "personalAbort">, …>`）— `allRollbackReleased` との関係を spec 側で明示したい。
- 8 件 / 120 日の再要求しきい値の計数を、`account_deletion_manifests` の索引ではなく `distributed_operations` に置いた（ADR-013）。
- `DistributedOperationStore` が `expires_at` / `attempts` / `next_attempt_at` を持たない（ADR-026）。recovery Cron を足すスライスが `next_attempt_at` を追加する必要がある。
- `DistributedOperationStore` の `payload` に uniqueness key を固定した（ADR-020）。
- `applied_operations` の 1 表がコードでは 2 ポート（`ScopeCleanupAdmissionStore` と `AppliedOperationStore`）に分かれ、`result` 列を持たない（ADR-012）。値を返すコマンドを足すスライスが `result` を戻す。
- 削除 status ticket の署名鍵は実装の `AppConfig` 型ではなく **composition root が供給する**（ADR-006）。spec は `AppConfig` の表に鍵を並べている。
- `/settings/danger`（P-25）が未サインインでも到達できること（ADR-062）を spec/pages の P-25 に明記したい。
- 継続 kind `identity.personalCleanupHandoverContinued`（ADR-106。barrier を閉じたターンの scope→global 引き渡しを駆動する scope 平面の継続）が `spec/domains/index.md#継続要求` の表に無い。
- P-25 の「削除されるもの / されないもの」と完了文言を、宣言された participant（`storage` / `usage`）の実態に合わせて狭めた（ADR-105）。`spec/design/pages/P25-settings-danger.html` と `spec/pages/index.md#P-25` は participant 完備の完成形のままなので、participant を足すスライスが左の列へ戻す。

### spec に無い application 入口

- `getProfile` / `checkHandleAvailability` の 2 読み取りを `application/identity/` に足した（ADR-047）。どちらも write を持たない `updateProfile` の対。
- `completeOAuthCallback`（コールバックのディスパッチャー）を `application/identity/` に足した（ADR-036）。spec の `completeOAuthSignIn` / `linkOAuthIdentity` の入力 DTO はそのまま保っている。

### レビュー R1 で増えた差

- `UploadValidationPolicy.ensureAcceptable` の引数を `{ purpose, mimeType, size }` から `{ purpose, body }` へ、戻り値を `void` から `{ mimeType, size }` へ変えた（ADR-078）。MIME は申告値ではなくバイト列の署名（PNG / JPEG / WebP）で決め、サイズは実バイト長で測る。`spec/domains/storage.md` の `UploadValidationPolicy` の表と、`storeAvatar` の入力 DTO の `declaredMimeType` 相当（ADR-048 の `size` と同根）に反映が要る。署名を持たない形式（`text/markdown` 等）を許可する purpose を足す #6 が、入口の形をさらに広げる。

## Issue #1 へのコメント用

`.thread/1/progress.md` が「本スライス外」として見送った下記 5 行は、本 Issue（#2）で実装済み。コードで確認した。

| ID | 実装箇所 |
|---|---|
| PAGE-p01-003（Google サインアップを開始） | `apps/web/app/components/auth/SignUpForm/index.tsx` が `OAuthButton provider="google"` を描画し、`apps/web/app/routes/auth/-action.tsx` の server function が `startOAuthFlow`（intent は `signIn` 固定）を呼ぶ |
| PAGE-p02-003（Google サインインを開始） | `apps/web/app/components/auth/SignInForm/index.tsx` が同じ `OAuthButton` を `redirectTo` つきで描画する |
| PAGE-p02-004（パスワード再設定へ移動） | `SignInForm` の 2 箇所（フッターと LOCKED アラート内）が `Link to="/reset-password"` になっている |
| PAGE-p02-006（確認メールを再送） | `SignInForm` の未確認アラートが `ResendVerificationForm variant="compact"`（P-03 と共有する island — ADR-032）を出す |
| ADP-identity-033 / 034（`SignInOAuthClient.buildAuthorizationUrl` / `exchangeCode`） | `packages/core/src/adapters/oauth/{googleSignInOAuthClient,devSignInOAuthClient}.ts` の 2 実装。共有適合スイート `describeSignInOAuthClientContract` に両方登録済み（Google の `exchangeCode` 側は資格情報が無い環境で skip — ADR-064） |

## 環境変数の注意

- **既存の `apps/web/.env` を使っている場合は `OAUTH_DEV_MODE=true` を 1 行足さないと起動しない**（ADR-003 の規則 3: `OAUTH_DEV_MODE` も Google 資格情報も無ければ起動失敗。フェイクへ黙って落ちない）。`.env.example` は更新済みなので、新しく作る場合はコピーするだけでよい。実 Google を使うときは `OAUTH_DEV_MODE` をコメントアウトして `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` を両方設定する（`NODE_ENV=production` かつ `OAUTH_DEV_MODE=true` は起動失敗）。
- `DELETION_TICKET_KEY`（P-25 の status ticket 署名鍵、32 バイト base64url）は**任意**。未設定ならプロセス毎のランダム鍵になり、削除自体は完走するが再起動で発行済み ticket が読めなくなる（進捗表示が「削除は続行されます」に倒れる）。

## 自動テストの実行結果（ステップ 34 項目 6 の前半）

| コマンド | 結果 |
|---|---|
| `pnpm typecheck` | 緑（root `tsgo` + `packages/core` + `apps/web`） |
| `pnpm test:unit` | 緑 — **67 files / 810 passed + 3 skipped（813）**。ステップ 33 時点は 806 passed + 5 skipped（811）。+2 は本ステップで足した TC-identity-122 / 266 の tombstone ケース、skip の 5 → 3 は ADR-064 の分割で Google の認可要求 2 ケースが実行されるようになった分。残る skip 3 件は `SignInOAuthClient conformance [google]` の `exchangeCode` 系（資格情報なし） |
| `pnpm build` | 成功（`dist/server/server.node.js` 330 kB / client アセット生成まで） |
| `pnpm lint:fix` | 緑（Biome、427 files）。本ステップで足した import 文 1 箇所を整形 |
| `pnpm format` | 緑（Biome、427 files。追加の修正なし） |

マニュアルテスト（`spec/manual-tests/account.md` の実行分 30 件）はブラウザ検証フェーズが実行する。

## レビュー R1 の反映（単位 U-6: composition root / 起動配線）

- **B-007 / Security B-002（dev IdP の production ガードが本番起動経路で発火しない）**: `apps/web/scripts/listen.node.ts` が dotenv より前に `process.env.NODE_ENV ??= "production"` を宣言し、`apps/web/.env.example` の `OAUTH_DEV_MODE=true` をコメントアウトした。`cp .env.example .env && pnpm build && pnpm start` は dev IdP を公開せず、`OAUTH_DEV_MODE=true` の `.env` を持つ手元でも起動が失敗する（実測: ZodError「OAUTH_DEV_MODE=true cannot be combined with NODE_ENV=production」）。
- **W-A01 / Adapter W-001 + Security W-006（ランタイム singleton の fail-open）**: `memoryRuntime()` は未初期化なら throw、`initNodeRuntime` は「別 env で初期化済み」なら throw する（同一 env の再入は `vite dev` のプログラム再読込なので singleton を保つ — ADR-074）。`MemoryRuntimeOptions.oauth` の既定（dev）を廃して明示必須にし、`createTestHarness` が `{ mode: "dev" }` を明示する。
- **W-A08 / Adapter W-008（`identity_removal_receipts` の 30 日保持が回収されない）**: `AuthStateTable` に `identity_removal_receipts` を足し、`authStateSweeps` / memory backend の `authStatePrune` 表順 / `PruneExpiredAuthStateView` へ反映した。`pruneExpiredAuthState` の cron 配線自体は引き続き Issue #15。
- **W-T09 / Test W-009（AC-6 の 404 ガードに自動テストが無い）**: **どこまで検証済みか** — env → `RequestContainer.oauthDevMode` の経路は `di/__tests__/serverNode.test.ts` の 3 ケース（`true` / Google 配備 / `"true"` 以外の値）で自動検証済み、そのフラグが偽のとき `/dev/oauth/authorize` が実際に 404 を返すことは本番形の起動（`OAUTH_DEV_MODE=false` + Google 資格情報）で手動確認済み（`/` が 200、当該ルートが 404）。ルート loader の `notFound()` 1 行自体を通す自動テストは、`createServerFn` の実行時を引き込むため置いていない。

## レビュー R2 の反映（単位: Node ランナー / 起動配線）

対象は Adapter 観点の W-001 / W-002 / W-003 / W-004 / W-010。

- **A-W001（`docs/runtime_node.md` が本 PR を反映していない）**: Worker runner 表を実装に合わせた。Consumer 行を `dispatchDomainEvent`（購読者レジストリ経由。購読者ゼロのイベントは warn して ack）に、Pruner 行を「24 時間 interval + 起動時 1 回、`pruneOutbox` / `pruneAccountDeletionManifests` / `identity_removal_receipts` の 3 sweep」に直し、Scope tasks 行（1 秒 interval + commit kick、ADR-023）を追加した。env 表に `DELETION_TICKET_KEY`（未設定 = プロセス毎の鍵、不正値は起動エラー）を追加。あわせて graceful shutdown の手順・「Known limitations」の auth-state prune 行・notable log lines も実態に合わせた。
- **A-W002（dev 再ロードで worker runner が多重起動する）**: ADR-093。boot slot を `globalThis` / `import.meta.hot.data` に載せ、再ロード時は**前の boot を `shutdown()` で retire してから作り直す**（再利用しないのは boot が `server-entry` の名前空間を抱えるため）。signal リスナーはプロセスで 1 度だけ張り、slot 越しに現行 boot を見る。retire / start をログ化した。
- **A-W003（removal receipt 回収の二重化）**: 裁定どおり runner 側の sweep を残し、JSDoc を実態に合わせた（下の引き継ぎを参照）。
- **A-W004（prune tick が起動時に走らない）**: `start()` で `track(runPruneTick())` を打つようにした。relay / scope task と同じ即時ドレインで、`stop()` は待つ。
- **A-W010（runner にテストが無い）**: `apps/web/app/worker/node/__tests__/runner.test.ts` を新設し、裁定どおり A-W002 / A-W004 の 2 点に限定して 4 本置いた —「`start()` で prune が 1 回走る」「2 度目の `start()` を無視する」「`stop()` 後は interval が止まる（走っている間は 1 秒間隔で刻むことと対にして固定）」「`stop()` が SIGTERM / SIGINT のリスナーを完全に戻すので、差し替えても累積しない」。stop のドレインと prune 3 本の例外隔離は本 Issue の受け入れ基準の要求を超えるので書いていない。boot slot 自体は `server-entry` の動的 import を抱えるためユニットで起こせず、`pnpm dev` の実測が担保（下記）。

### `pnpm dev` での多重起動の実測

`vite dev`（port 3100、`OAUTH_DEV_MODE=true`）を起動し、`apps/web/app/worker/node/runner.ts` の保存を 4 回繰り返して毎回リクエストを 1 本流した。ログは boot 5 回に対し `[server.node] retiring the previous boot` が 4 本で、常に retire → started の交互（`started` が 2 本続く箇所は無い）。各 boot の直後に `[outbox] pruned 0 processed event(s)` が 1 行出ており、起動時 prune tick も実プロセスで確認できた。`MaxListenersExceededWarning` は 0 件。

### Issue #15 への引き継ぎ（`identity_removal_receipts` の回収経路が 2 系統）

同じ表を 2 つの経路が掃く状態になっている。

| 経路 | 実装 | 上限 / 記録 |
|---|---|---|
| runner の直接 sweep | `apps/web/app/worker/node/runner.ts#sweepIdentityRemovalReceipts`（prune tick 内） | 100 件 × 最大 100 ページ、maintenance run の bookkeeping なし |
| `pruneExpiredAuthState` の lane | `packages/core/src/application/identity/pruneExpiredAuthState.ts`（`AuthStateTable` / `authStateSweeps` に登録済み） | maintenance run のリース + チェックポイント付き |

本 Issue では `pruneExpiredAuthState` を呼ぶ本番コードが存在せず（cron 配線は #15）、一本化すると 30 日保持の回収が誰も走らせない状態になるため、runner 側の sweep を残した（JSDoc に理由と引き継ぎ先を明記）。**#15 が `pruneExpiredAuthState` に駆動主体を付けた時点で、runner の sweep を落として lane に一本化する。**

## Issue #7 への引き継ぎ（`DistributedOperationStore.markState` は遷移を拘束しない）

ADR-103 のとおり `markState` の契約は実装側に寄せた。ストアは未知 ID しか弾かず、`completed → running` も通って `terminalAt` が `null` に戻る（＝ `countTerminalSince` の計数からも `deleteTerminal` の対象からも外れる）。今日は `deleteAccount/compaction.ts` が `header.status === "completed"` で早期 return するため二重呼び出しが起きないが、**同じポートを再利用する #7（note move）は terminal 後の `markState` を自分で防ぐか、遷移を拒否する契約へ強化する（適合スイートに terminal → running の 1 ケースを足す）かを決めること。**
