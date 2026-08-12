# レビュー R10 — Test 観点（最終ラウンド / ゼロベース）

対象: PR #17（`issue/2/account-management-and-auth` ← `main`）/ 契約: `.thread/2/plan.md`
参照した決着済み記録: `.thread/2/progress.md`（縮退・spec-sync 候補・行数の検算）。過去のレビューファイルは読んでいない。

## Test

### Blockers

なし。

AC-1..AC-33 が「通る」と名指した TC 行のうち、spec の期待結果が**まるごと**検証されていないものは見つからなかった。下の Warnings はいずれも「複数節からなる期待結果のうち 1 節が判別的でない」形で、主たる観測は固定されている。

### Warnings

- **[W-001]** `TC-identity-030` の「reservation は**一方だけ成立し**」の前半が未表明 / 場所: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts:259-280` / 理由: AC-8 が名指す TC-identity-030（`spec/testcases/identity/completeOAuthSignIn.md` の「同じプロバイダーアカウントで 2 つのサインアップが同時に走る」行）の期待結果は「reservation は一方だけ成立し、他方は `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`」。後半（敗者のコード）は固定されているが、**勝者の claim が敗者のロールバック後も残っていること**を見ていない。アサーションは `users` 0 件と `directoryRows(h, "email")` 0 件だけで、`directoryRows(h, "providerAccount")` を一度も見ない。`releaseUniqueKeys`（`application/identity/uniqueness.ts`）が operationId ではなく key で解放するように壊れた場合、ライバルの予約ごと消えても本テストは緑のまま（email 行 0 件は同じ壊れ方でも成立する）。隣の TC-identity-031 も rival 不在の状況で `uniqueDirectory` 全 0 件を見るだけなので、解放の**範囲**はどこでも固定されていない / 提案: 1 行足す（`expect(directoryRows(h, "providerAccount")).toMatchObject([{ userId: "other-user", state: "reserved" }])`）。`linkOAuthIdentity.test.ts` の TC-identity-126 が `Promise.allSettled` + `["active"]` で同じ性質を固定しているので、形はそちらに揃えられる。

- **[W-002]** `TC-storage-040` の「先頭から」「**カーソルは持たない**」が判別的でない / 場所: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:287-299` / 理由: AC-25 が名指す TC-storage-040 の期待結果は「残っているものを先頭から `batchSize` 件読んで続きを削除する（カーソルは持たない）」。テストは 30 件を `batchSize: 10` で 3 ターン流し、最終ターンの `deletedCount: 10` / ファイル 0 件 / task 0 件だけを見る。**カーソルを持つ実装でも同じ 3 つのアサーションが成立する**ため、この行の主張そのものは空振りしている。継続 payload を見る TC-storage-039 側も `toMatchObject({ payload: { deletionOperationId } })` の部分一致なので、`payload.cursor` が増えても検出しない。ターン間に行が増減する配置（TC-storage-047 が「1 件だけ残す」状況を作るが、その継続を走らせていない）が無いので、「先頭から読み直す」性質はどこでも固定されていない / 提案: ターン間に 1 件 seed して次ターンがそれも拾うことを見るか、`expect(Object.keys(tasks(h)[0].payload)).toEqual(["deletionOperationId"])` でカーソル不在を直接固定する。

- **[W-003]** `TC-identity-105` の「**同じ固定 `asOf`**」が判別的でない / 場所: `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts:178-193`（fixture は同ファイル 94-143 の `startLane`） / 理由: AC-27 が名指す TC-identity-105 の期待結果は「同じ固定 `asOf`/cursor から冪等に再開し、未回収 header を欠落させない」。cursor と欠落なしの側は固定されているが、`startLane` は 101 件すべてを同じ `retainUntil` で seed し、以後クロックを進めないので、`input.asOf`（`deleteAccount/terminalPrune.ts` が唯一消費する箇所）を無視して `clock.now()` を使う実装でも 100 → 1 の結果は変わらない。TC-identity-106 が固定しているのは run 行の `asOf` であって、prune ページがそれを尊重することではない / 提案: 再実行の前にクロックを進め、「1 回目の `asOf` より後に期限が来る header」を 1 件混ぜて、再開ターンがそれを回収しないことを見る。

- **[W-004]** `TC-identity-100` の「**署名 generation** cursor で固定し」が未表明 / 場所: `packages/core/src/application/identity/__tests__/deleteAccount.manifestBuild.test.ts:167-189` / 理由: AC-27 が名指す TC-identity-100 の期待結果は「署名 generation cursor で 100+100+50 件を固定し、各 item の local/public ack を保存する」。件数（100/200/250）と `authorRouteCursor` 非 null、`status: "built"` は見ているが、**item の中身を一度も見ない**。固定した generation（`deleteAccount/manifestBuild.ts` が item に書く `routeVersion`）はリポジトリ全体で 1 度もアサートされておらず、書かなくなっても全テストが緑のまま（ack スロット側は TC-identity-081 が `ackedCount` で固定している） / 提案: 1 ターン目の item を 1 件取り出して `routeVersion` が seed した route の generation と一致することを見る（`itemsOf(...)[0]` に対する 1 行）。

### 機械照合（plan.md ↔ テストコード）

`gh issue view 2` の本文（チェックリスト 366 行）を実データとして突合した。

| 項目 | 結果 |
|---|---|
| チェックリストの TC 行（ユニーク ID） | 287 |
| 見送り TC 行（`progress.md` の 89 行表） | 82 |
| 実装 TC 行 | **205**（287 − 82。plan.md / progress.md の申告と一致） |
| 実装 205 行のうち**テスト名**に TC ID を持つもの | **205 / 205（取りこぼし 0）**。結合表記（`TC-identity-105/107` など）を展開して照合 |
| 見送り 82 行の先取り | **0**。コード中に現れるのは `TC-identity-052` のみで、`domain/identity/__tests__/policies.test.ts:233` の**コメント**（`AccountDeletionRetryPolicy` の境界は #3 依存と明記）。テスト名ではなく、`progress.md` に記録済み |
| DOM / ADP 行（実装 26） | 17 行がテスト名・describe 名に ID を持つ。残る `DOM-usage-009..017` はポート定義行で、`ADP-usage-001..009` の適合ケース（`conformance/{storageQuotaRepository,llmUsageRepository}.ts`）が 1 対 1 に対応する（progress.md 記載どおり） |
| アサーションを 1 つも持たないテスト | 0（TC ID を含む全テストファイルを走査） |
| `skip` されているケース | `conformance/signInOAuthClient.ts:55` の `describe.skip`（Google の `exchangeCode` 3 件。資格情報が無い環境。理由をスイート名に載せる形で、`mintCode` は呼ばれたら throw する）と、`conformance/accountDeletionManifestStore.ts` の `ctx.skip()` 3 箇所（`seedMembershipEdges` を持たないバックエンド用。memory は実装しているので実行される）。いずれも正当 |

補足（指摘に上げなかったが確認した点）:

- 適合スイート 9 本（`storageQuotaRepository` / `llmUsageRepository` / `storedFileRepository` / `objectStorage` / `signInOAuthClient` / `identityRemovalReceiptStore` / `scopeTaskScheduler` / `appliedOperationStore` / `distributedOperationStore`）はすべて `adapters/memory/__tests__/conformance.test.ts` に登録済み（AC-1 / AC-2 / AC-31）。
- AC-6 の「資格情報不要の純関数として両アダプターで実行する」は成立（`signInOAuthClient.ts:73-106` の認可要求スイートはゲート外）。43 文字 / base64url / 同一 verifier の決定性 / `code_challenge_method=S256` を両方で実行している。
- 境界値の両側: ハンドル 3 / 30 受理・2 / 31 拒否、5MB 受理・+1 バイト拒否、80% / 79% / 超過、保持期限の `retainUntil` ちょうど回収・1ms 前は非回収、`BillingPeriod` の UTC 月境界（`vitest.config.ts` の `TZ=Asia/Tokyo` と対）を確認。表示名 50 / 自己紹介 500 は spec に「受理側」の行が無いため片側のみで妥当。
- AC-19 / AC-22 が名指す `TC-identity-045` は Note / Storage / Usage の 3 経路（plan.md の宣言どおり）で存在。
- `runUntilSettled`（`__tests__/deletionDriver.ts`）は停滞と未収束を throw するので、deleteAccount 系の「完走した」系アサーションは空回りしない。
- コード・コメントに指摘への弁明や修正の経緯は残っていない（`レビュー` / `指摘` / `previously` / `B-0xx` / `W-0xx` 等を全 `.ts` / `.tsx` に対して走査。ヒットは無関係な語義のみ）。
- 決着済みとして再指摘しなかったもの: `TC-identity-090` / `TC-storage-043` / `TC-identity-110` / `TC-storage-047` の一部欠落、`worker/node/runner.ts` のテスト範囲、`assertWritable` 2 本要求の構造的検証不能、`TC-usage-055` / `TC-identity-086` / `TC-identity-111`、`activate` 応答喪失の注入の形（同型の `TC-identity-281`（`updateProfile.test.ts:191-217`）も同じ理由でここに含める）、`TC-identity-268` の `InvalidProvider`。
- 上げなかった近接候補: `TC-identity-089` の「再開する」は `deleteAccount.recovery.test.ts:126` が `runUntilSettled` で完走を固定、`TC-identity-107` の Queue outbox checkpoint は `conformance/globalMaintenanceRunStore.ts` の `ADP-common-027` が固定、`TC-identity-017` の「物理削除前から無効」は同ファイル `TC-identity-018` が行数保持で固定、`TC-identity-210` の継続再武装は `authResidueCleanup.test.ts:129` が固定。いずれも別単位で固定済みのため閾値外。
- 今ラウンド新規の `apps/web/app/components/settings/DeleteAccountPanel/__tests__/ticketStorage.test.ts` は、`parseStoredTicket` の非信頼入力（非 JSON / 配列 / 型違い / `userId` 欠落）と `canRestoreTicket` の主体一致（別利用者は復元不可 / セッション不在は復元可）を両側から固定しており、守るべき挙動（他人の削除進捗を見せない）を押さえている。

### カバレッジ

- 確認（82）: 変更一覧のうちテスト・適合スイート・テスト設定・テスト方針ドキュメントの全 78 ファイル —
  `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`, `apps/web/app/components/settings/DeleteAccountPanel/__tests__/ticketStorage.test.ts`, `apps/web/app/presentation/__tests__/{deletionTicket,devOAuth,oauthStateBinding,oauthStateBindingWiring}.test.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `docs/test.md`, `vitest.config.ts`,
  `packages/core/src/adapters/conformance/{accountDeletionManifestStore,appliedOperationStore,authTokenRepository,backend,distributedOperationStore,identityRemovalReceiptStore,identityUniqueDirectory,llmUsageRepository,noteProjection,objectStorage,outboxRepository,scopeCleanupAdmissionStore,scopeTaskScheduler,signInOAuthClient,storageQuotaRepository,storedFileRepository}.ts`,
  `packages/core/src/adapters/memory/__tests__/{conformance.test,conformanceBackend,unitOfWork.test}.ts`, `packages/core/src/adapters/oauth/__tests__/{conformance,googleSignInOAuthClient}.test.ts`,
  `packages/core/src/application/__tests__/helpers.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/execution/__tests__/eventId.test.ts`,
  `packages/core/src/application/identity/__tests__/` の全 32 ファイル, `packages/core/src/application/note/__tests__/createBlankNote.test.ts`,
  `packages/core/src/application/storage/__tests__/{deleteFiles,deleteFilesByOwner,storeAvatar}.test.ts`, `packages/core/src/application/usage/__tests__/{deleteQuota,getUsageSnapshot,recalculateStorageUsage}.test.ts`,
  `packages/core/src/application/workers/__tests__/{outboxPrune,scopeTaskRunner,subscribers}.test.ts`,
  `packages/core/src/domain/identity/__tests__/policies.test.ts`, `packages/core/src/domain/storage/__tests__/storage.test.ts`, `packages/core/src/domain/usage/__tests__/{quota,valueObject}.test.ts`
  — に加えて `.thread/2/plan.md`, `.thread/2/progress.md`（契約と決着済み事実）、`apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`（新規テストの対象）、`packages/core/src/adapters/oauth/pkce.ts`（AC-6 の S256 契約の実体）。
- スキップ（229）:
  - `.thread/2/review/*.md`（47） — 最終ラウンドはゼロベースで行う指示のため読んでいない。
  - `.thread/2/{adr,steps,testing}.md`（3） — 決着済み事項の参照元。plan.md / progress.md 経由で参照し、直接のレビュー対象にしていない。
  - `docs/runtime_node.md`（1） — 運用手順書で、テスト観点の指摘対象になる期待結果を持たない。
  - 実装・UI・ルート・アダプター・ドメイン本体のソース（178） — Test 観点の指摘対象（AC が名指す TC の期待結果の空振り）は「テスト側のアサーション」と「`spec/testcases/` の期待結果」の突合で判定できるため、実装は W-001..W-004 の判別性を確かめるのに必要な範囲（`uniqueness.ts` / `deleteFilesByOwner.ts` / `terminalPrune.ts` / `manifestBuild.ts` / memory アダプター）だけ読み、網羅レビューはしていない。

確認 82 + スキップ 229 = **311**。
