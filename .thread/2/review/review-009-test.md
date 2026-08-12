# レビュー R9 — Test 観点

対象: PR #17 / ブランチ `issue/2/account-management-and-auth` / ベース `main`
契約: `.thread/2/plan.md`（AC-1..AC-33、見送り 89 行）
方式: ゼロベース（過去のレビューファイルは読まない）。`.thread/2/progress.md` / `.thread/2/adr.md` の縮退・spec-sync 候補・Accepted 判断は決着済みの事実として参照。

## Test

### Blockers

なし

### Warnings

なし

閾値（「AC が名指す TC の spec 期待結果を空振りさせているもの」）に照らして、指摘に達するものは 1 件も見つからなかった。205 行すべてについて、`spec/inventory/test.md` の「実装されるべき振る舞いの要点」の各要素が対応テストで実際にアサートされていることを確認した（下記「機械照合」参照）。閾値外として棄却した観察は末尾に列挙する。

### 機械照合

#### 1. plan.md が「実装する」と宣言した TC 行の悉皆確認

plan.md の AC 表が名指す TC 範囲を機械展開すると **205 行**（AC-3/4/7/8/10/11/13/14/15/16/18/19/21/22/24/25/26/27）。これは progress.md の「実装 277 行の内訳 TC 205」と一致する。

- **205 行すべてが `it(...)` / `describe(...)` のテスト名に TC ID 付きで存在する**（コメント内だけの言及ではないことを、`it|test|describe` 呼び出し行に限定した再走査で確認）。取りこぼし **0**。
- 結合表記（`TC-identity-105/107` など）も展開して突合済み。

#### 2. 見送り 89 行の先取り

見送り 82 TC 行を全走査したところ、テスト名として登場するものは **0 件**。唯一 `TC-identity-052` がコード中に現れるが、`packages/core/src/domain/identity/__tests__/policies.test.ts:233` の**コメント**で「チェックリスト行としての検証には `rejected` 経路（#3）が要る」と明記した箇所であり、テスト名ではない（progress.md の記載どおり）。先取り **なし**。

#### 3. AC が名指す TC の期待結果の空振り

205 行を 5 群に分けて、`spec/inventory/test.md` の期待結果文と各テストのアサーションを 1 行ずつ突き合わせた。

| 群 | 行数 | 主な対象 | 結果 |
|---|---|---|---|
| resend / verifyEmail / requestPasswordReset / resetPassword | 37 | AC-3, 4, 10, 11 | 空振りなし |
| startOAuthFlow / completeOAuthSignIn / linkOAuthIdentity | 32 | AC-7, 8, 15 | 空振りなし |
| listIdentities / addPassword / changePassword / removeIdentity / signOut(OtherSessions) / updateProfile | 55 | AC-13, 14, 16, 18 | 空振りなし |
| storeAvatar / deleteFilesByOwner / getUsageSnapshot / recalculateStorageUsage / deleteQuota | 43 | AC-19, 21, 22, 24, 25 | 空振りなし |
| deleteAccount（受理 / personal / global / manifest / compaction / terminal prune） | 38 | AC-26, 27 | 空振りなし |

境界値の両側も確認済みの主なもの: 60 秒（59 / 61）、確認トークン 23:59 / 24:00、reset トークン 59 分 / 1 時間、ハンドル 3 / 30 / 31、表示名 50・自己紹介 500、avatar 5MB ちょうど / +1 バイト、警告レベル 79% / 80% / 100% 超、`batchSize` 既定 / 上限 100 / ちょうど、terminal prune の 100 + 1。

#### 4. AC-1 / AC-2 / AC-6 / AC-28 / AC-31（TC 行を持たない AC）

- AC-1: `domain/usage/__tests__/{valueObject,quota}.test.ts` が `DOM-usage-001..008` を describe 名で持ち、5GiB / 20GiB 既定、300 回/月、UTC 暦月（`vitest.config.ts` の `TZ=Asia/Tokyo` 固定と対）、80% / 100% 境界を押さえている。`DOM-usage-009..017`（ポート行）は適合スイート側。
- AC-2: `domain/storage/__tests__/storage.test.ts` が avatar の 5MB 境界・GIF/SVG 拒否・署名判定を押さえる。適合スイート 9 本（`storageQuotaRepository` / `llmUsageRepository` / `storedFileRepository` / `objectStorage` / `identityRemovalReceiptStore` / `scopeTaskScheduler` / `appliedOperationStore` / `distributedOperationStore` / `signInOAuthClient`）はすべて登録済み（前 8 本が `adapters/memory/__tests__/conformance.test.ts`、`signInOAuthClient` が `adapters/oauth/__tests__/conformance.test.ts`）。
- AC-6: `describeSignInOAuthClientContract` が「認可要求（純関数）」と「code exchange」の 2 スイートに分かれ、dev IdP は両方実行、Google は exchange 側のみ `describe.skip`。skip 名に理由が載り、`mintCode` はゲートが誤って広がったら throw する形なので「未検証が緑に見える」ことがない。**skip は正当**。
- AC-28: `presentation/__tests__/deletionTicket.test.ts` が claim 限定・改竄・別鍵・鍵リング・30 分（期限ちょうどを含む）を押さえる。`getAccountDeletionStatus.test.ts` が「ticket が名指す 1 件しか読めない」を押さえる（TC-identity-048）。
- AC-31 / AC-32: `workers/__tests__/subscribers.test.ts` が「購読者ゼロは warn して ack」「全継続 kind に dispatch がある」を、`scopeTaskRunner.test.ts` が継続の再駆動・backoff・部分失敗隔離を、`di/__tests__/serverNode.test.ts` が dev IdP の env ゲートを押さえる。

#### 5. スイートの実行結果（自分で実測）

`pnpm test:unit` → **75 files / 918 passed + 3 skipped（921）**、25.4s、緑。skip 3 件は AC-6 の Google `exchangeCode` 系のみ。`git status` はクリーンなまま（実装を書き換える変異テストは一切行っていない）。

参考: progress.md の記録は「67 files / 810 passed + 3 skipped」で、R3〜R8 のテスト追加分だけ差がある。閾値外なので指摘としては挙げない。

### 共通チェック（弁明・修正の経緯の残留）

差分の追加行を「レビュー / R{n} / 指摘 / W-0xx / B-0xx / 以前は / previously / 修正した」等で走査したが、**レビュー経緯や弁明を残した記述は無し**。ヒットした 2 件は UI 文言（入力欄の注意書き）と「公開プレビュー導線を出さない理由」の設計判断コメントで、いずれも WHY コメントとして妥当。`docs/test.md` / `vitest.config.ts` からは Issue #1 の ADR 番号参照が落とされ、理由そのものを書く形に直っている。

### 閾値外として棄却した観察（指摘ではない）

- `TC-storage-041` の spec 文言「継続要求を積まず、失敗として返る（キューの再試行と DLQ に委ねる）」に対し、実装は自分の task 行を back-off させる方式。テストは実装側の観測可能な性質（`stalled` + `attempt=1` + 未来 `dueAt`）を固定しており、**テストの空振りではなく spec 文言の未追随**（spec-sync 側の話）。
- `TC-identity-039` の「202 応答に ticket を載せる」ルート結線（`apps/web/app/routes/settings/-action.tsx`）に単体テストは無いが、ticket の署名・claim 限定・失効は presentation テストが押さえており、server function の結線を単体で起こさない方針は本 PR 全体で一貫している。
- `TC-identity-045` の Tag write 経路、`TC-identity-047` / `085` の「代用しない」「最大 100 件」句、`TC-identity-271` の「どちらの state も有効」の実交換確認 — いずれも memory バックエンドでは到達不能 / 表現不能か、期待結果の本体は押さえられている。

## カバレッジ

- 確認（80 件）:
  - `.thread/2/plan.md`, `.thread/2/progress.md`, `.thread/2/adr.md`
  - `docs/test.md`, `vitest.config.ts`
  - 適合スイート 16 件: `packages/core/src/adapters/conformance/{accountDeletionManifestStore,appliedOperationStore,authTokenRepository,backend,distributedOperationStore,identityRemovalReceiptStore,identityUniqueDirectory,llmUsageRepository,noteProjection,objectStorage,outboxRepository,scopeCleanupAdmissionStore,scopeTaskScheduler,signInOAuthClient,storageQuotaRepository,storedFileRepository}.ts`
  - アダプターテスト 5 件: `packages/core/src/adapters/memory/__tests__/{conformance.test.ts,conformanceBackend.ts,unitOfWork.test.ts}`, `packages/core/src/adapters/oauth/__tests__/{conformance.test.ts,googleSignInOAuthClient.test.ts}`
  - ドメインテスト 4 件: `packages/core/src/domain/{identity/__tests__/policies.test.ts,storage/__tests__/storage.test.ts,usage/__tests__/quota.test.ts,usage/__tests__/valueObject.test.ts}`
  - アプリケーションテスト 40 件: `packages/core/src/application/__tests__/helpers.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/execution/__tests__/eventId.test.ts`, `packages/core/src/application/identity/__tests__/*`（31 件: `authFlowHelpers.ts` / `deletionDriver.ts` / `deletionHarness.ts` を含む）, `packages/core/src/application/note/__tests__/createBlankNote.test.ts`, `packages/core/src/application/storage/__tests__/{deleteFiles,deleteFilesByOwner,storeAvatar}.test.ts`, `packages/core/src/application/usage/__tests__/{deleteQuota,getUsageSnapshot,recalculateStorageUsage}.test.ts`, `packages/core/src/application/workers/__tests__/{outboxPrune,scopeTaskRunner,subscribers}.test.ts`
  - web 側テスト 6 件: `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`, `apps/web/app/presentation/__tests__/{deletionTicket,devOAuth,oauthStateBinding,oauthStateBindingWiring}.test.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`

- スキップ（224 件）:
  - `.thread/2/review/review-00*-*.md` + `.thread/2/review/triage.md`（42 件） — 本レビューはゼロベース指示のため読まない
  - `.thread/2/steps.md`, `.thread/2/testing.md`（2 件） — 手順書。契約は plan.md 側で確認済み
  - `apps/web/app/components/**`（36 件）, `apps/web/app/routes/**`（16 件） — フロントエンド観点の担当。TC 行を持たず、`docs/test.md` の方針どおり自動テスト対象外（例外の `presentation/` 純関数は確認側に含む）
  - `apps/web/app/presentation/{deletionTicket,devOAuth,errorDisplay,oauthStateBinding,oauthStateCookie,session,verificationSession}.ts`（7 件） — 実装本体。対応するテスト側は確認済み
  - `apps/web/{.env.example,app/routeTree.gen.ts,app/server.node.ts,app/worker/node/runner.ts,scripts/listen.node.ts}`（5 件） — 起動配線・生成物。テスト範囲の限定は progress.md で決着済み
  - `docs/runtime_node.md`（1 件） — ランタイム運用ドキュメント（Adapter 観点）
  - `packages/core/src/adapters/{memory,oauth}/**` の実装 22 件 — アダプター観点の担当。契約は適合スイート側で確認済み
  - `packages/core/src/application/**` の実装 64 件, `packages/core/src/domain/**` の実装 29 件 — ドメイン / ユースケース観点の担当。TC 期待結果の照合参照としてのみ読み、テスト観点の指摘対象にはしていない

確認 80 + スキップ 224 = **304**（変更ファイル一覧と一致）。

## `git status`

レビュー開始時・終了時ともクリーン（変異テストは共有作業ツリーでは行っていない。本ファイルの作成のみが差分）。
