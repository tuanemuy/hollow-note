# レビュー 005 — Test

ゼロベース検証。`.thread/2/plan.md` の AC-1..AC-33 と「含まれないもの（見送り 89 行）」、`spec/testcases/`、`docs/test.md`、`CLAUDE.md` を正典とした。

## Test

### 機械照合の結論

- Issue #2 のチェックリストは **366 行**（`gh issue view 2` 実測）。内訳は TC 287 / PAGE 30 / UC 23 / ADP 9 / DOM 17。
- plan.md の見送り表から機械展開した見送り TC は **82 行**、すべて Issue のチェックリストに実在（欠番・綴り違いなし）。したがって**実装対象 TC = 287 − 82 = 205 行**。
- 非 TC の実装対象 = PAGE 27 + UC 19 + ADP 9 + DOM 17 = 72。**72 + 205 = 277** で plan.md の「実装 277 + 見送り 89 = 366」と一致。
- **205 行すべてがテストコード中に TC ID として出現する（取りこぼし 0）**。
- **見送り 89 行の先取りは無い**。コード中に現れる見送り ID は `TC-identity-052` の 1 件のみで、`domain/identity/__tests__/policies.test.ts:233` の「この行は #3 で検証する」というスコープ注記のコメント内。テスト名としては使われておらず、先取りに当たらない。
- コード中に出現するがチェックリストに無い TC ID（`TC-identity-008..016 / 150..178 / 213..237 / 247..255 / 259..263`、`TC-note-*`）はすべて Issue #1 由来の既存テスト。
- `pnpm test:unit` 実測: **75 files / 901 passed / 3 skipped**。skip 3 件は Google アダプターの code exchange 半分のみ（AC-6 が明示的に許容する範囲。`describeSignInOAuthClientContract` の `gated` により理由付きで suite 名に出る）。`it.only` / `it.todo` / 恒久 skip は他に無し。
- 既に決着済みの 3 点（`TC-identity-090` / `TC-storage-043` の一部欠落、`worker/node/runner.ts` のテスト範囲、`assertWritable` 2 本の構造的検証不能）は蒸し返していない。
- コード・コメントに指摘への弁明や修正の経緯は見当たらない（差分の追加コメントを全走査）。残っているのは仕様根拠・縮退の事実・WHY のみ。

### Blockers

なし

### Warnings

- **[W-001]** 「activate 応答喪失」の注入が必ず下位の書き込みを成功させてから throw するため、`activateUniqueKeys` の照合処理が assert を支えていない / 場所: `packages/core/src/application/identity/__tests__/updateProfile.test.ts:203-210`、`packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts:316-326` / 理由: TC-identity-281（「User version と値が一致するため activate し」）と TC-identity-024..032 の 2 予約サガ recovery（TC-identity-032）が対象。両テストとも stub は `await real.activate(...)` を実行してから例外を投げるので、`activateUniqueKeys`（`application/identity/uniqueness.ts:200-237`）が `confirm()` を呼ばず例外を握り潰すだけの実装でも、行は既に `active` なので `toEqual(["active","active"])` / `handleRow("ichiro-y").state === "active"` はそのまま通る。結果として (a)「書き込みが着地しなかった側の応答喪失」＝照合して再 activate しないと予約が `reserved` のまま恒久的に鍵を塞ぐケースと、(b) `confirm()` が `null` を返す release 分岐が、スイート全体で一度も実行されない。現状これらのテストが実際に排除できているのは「失敗時に release してしまう実装」だけ。/ 提案: どちらか一方の注入を「下位 activate を呼ばずに throw する」形に変え、再 activate が起きて初めて `active` になることを観測可能にする。あわせて `confirm()` が `null`（正データ不在）を返す経路を 1 本足して release 分岐を踏む。
- **[W-002]** TC-identity-086 の「次 task なしを同じ scope-local UoW で保存」が、継続 task が一度も積まれない配置で検証されている / 場所: `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts:165-177` / 理由: `acceptAndBuild(h)` はファイルを 1 件も seed しないので `deleteFilesByOwner` は初回ターンで 0 件・`settled` に落ち、継続 task はそもそも作られない。よって `expect(tasks.map(kind)).toEqual([PERSONAL_BARRIER_PRUNE_TASK_KIND])` は自明に成立し、spec 行が要求する「最終 page が armed 済みの継続を消す」ケースには到達しない。後半の「応答喪失時も二重完了しない」もこのテストでは注入されていない（TC-identity-087 / 089 が別途担保）。Blocker にしないのは、150 件を積んだ状態から継続を消し切って `listDue` が空になることを `application/workers/__tests__/scopeTaskRunner.test.ts:132-148` が produced state で押さえているため。/ 提案: TC-identity-085 と同じ 150 件 seed から継続ターンを最後まで駆動し、最終 page の直後に `scheduledTasks` から storage 継続が消えていることを見る形にする。
- **[W-003]** TC-usage-055 が実装のハードコードをそのまま突き合わせており、失敗し得ない / 場所: `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts:122-127` / 理由: `application/usage/getUsageSnapshot.ts:55` は `workspaces: []` をリテラルで返すため、`expect((await snapshot(h)).workspaces).toEqual([])` はどんな membership 状態でも真になる。plan.md の縮退「workspace セクションは常に空配列を返す」の帰結ではあるが、チェックを付ける行の assert が構造的に無効である事実は縮退記録に含まれていない。/ 提案: #3 へ引き継ぐ縮退記録に「`TC-usage-055` は現状ハードコードに対する自明な assert で、実効的な検証は workspace 列挙の実装と同時」と 1 行足す（テストは現状のままでよい）。
- **[W-004]** DOM-usage-004 の「ローカルタイムゾーンではなく UTC で判定する」assert が、実行環境の TZ に依存して自明化する / 場所: `packages/core/src/domain/usage/__tests__/valueObject.test.ts:86-95` / 理由: 判定値は `2026-05-31T23:59:59.999Z` と `2026-06-01T00:00:00.000Z`。`vitest.config.ts` は `TZ` を固定していないので、CI が UTC で回ると `getMonth()` 実装と `getUTCMonth()` 実装が同じ結果になり、この 2 点では両者を区別できない（JST の開発機では区別できる＝現状は通っている）。実装 `domain/usage/valueObject.ts:93` は `getUTCFullYear/getUTCMonth` で正しいが、リグレッションを止める力が環境次第になる。/ 提案: `vitest.config.ts` に `env: { TZ: "Asia/Tokyo" }` 等の非 UTC を固定するか、判定を UTC 月境界と「ローカル月が変わる別オフセット」の 2 点対で書く。
- **[W-005]** TC-identity-111 の中核 assert が、テスト自身のヘルパーが直前に書いた状態の読み戻しになっている / 場所: `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts:333-345`（ヘルパー `completeBarrier` は `:269-296`） / 理由: spec 行の主張は「同じ scope-local UoW に task が残るため」だが、その task を積んでいるのはヘルパー自身（`markCompleted` + `scopeTaskScheduler.schedule` を手で並べている）。`expect(scheduled).toHaveLength(1)` と `dueAt === retainUntil` は arranged state の確認で、production 経路が同一 UoW で積むことは証明していない。Blocker にしないのは、その produced state 版が TC-identity-084（`deleteAccount.cleanup.test.ts:125-126`、実 `dispatch` 後に `pruneTasks` 1 件と `dueAt` を確認）にあるため。/ 提案: `completeBarrier` を実 cleanup 経路（`dispatch` まで駆動）に置き換えるか、TC-111 のコメントに「同一 UoW 保存の証明は TC-084 側」と明示して arranged 部分を setup guard と読める形にする。

### 検証したが問題なしと判断した主な点

- **並行・応答喪失の実効性**: `verifyEmail` の同一トークン二重消費（`Promise.all` でも敗者が実際に `AUTH_TOKEN_ALREADY_CONSUMED` を踏むことを save 計測で確認: saves 2 / conflicts 1）、`updateProfile` TC-293（deferred で勝者・敗者を確定分岐させ、敗者が補償しないことまで固定）、`linkOAuthIdentity` TC-126（UoW 直列化後の上限判定に到達）、`resetPassword` TC-211（読み取りと transaction のあいだにライバルの consume を差し込む決定的注入）、`removeIdentity` TC-186。いずれも観測可能な勝敗分岐まで assert している。
- **今ラウンドの新規テスト**: `removeIdentity.test.ts:212-269`（解除 → 再連携 → 再配送）は、再配送で `identityRemovalRelease` が `providerAccountRelinked` を選ぶことを、他人の横取り拒否と本人 signIn の到達まで含めて固定しており、`:271-280`（receipt 不在）と対で release のガード 2 本を両方踏んでいる。`scopeTaskRunner.test.ts:114-159`（引き渡し喪失からの再駆動）は `globalUnitOfWorkProvider.run` を reject させる本物の障害注入で、`processed: 0` / receipt 未記録 / 引き渡し行だけが due という中間状態を確認したうえで、コンテナを作り直して（＝プロセス再起動相当）完走させている。
- **境界値の両側**: 23:59/24:00（`verifyEmail.test.ts:37,49`）、59 秒/61 秒（`resendVerificationEmail.test.ts`）、59 分/60 分（`resetPassword.test.ts`）、79%/80%/100%/+1（`quota.test.ts`, `getUsageSnapshot.test.ts`）、5MB ちょうど/6MB/+1B（`storeAvatar.test.ts`, `domain/storage/__tests__/storage.test.ts:189-198`）、100 件ちょうど/101 件（`deleteFilesByOwner.test.ts`, `deleteAccount.finalize.test.ts`, `terminalPrune`）、8 件上限（`addPasswordIdentity` / `completeOAuthSignIn` / `linkOAuthIdentity`）、120 日と ±1ms（`terminalPrune.test.ts:164`）、ticket TTL の deadline−1/deadline（`deletionTicket.test.ts:119-134`）。
- **適合スイートの一般化（AC-31）**: `scopeCleanupAdmissionStore` / `accountDeletionManifestStore` は宣言集合を enum の**真部分集合**にしたうえで「宣言外の component/receipt を ack しても finalize が進まない」ことを assert しており、full enum をハードコードしたバックエンドは落ちる。形骸化していない。`identityUniqueDirectory` の `beginRelease → release`（非所有者 no-op / 冪等 / reserved 行を触らない / 未知キー no-op）も 6 ケースで押さえている。
- **skip の正当性（AC-6）**: dev IdP は資格情報なしで全ケース実行、Google は authorization request 半分（純関数）を常時実行し、exchange 半分だけ理由付き skip。`describe.skip` でも body は評価されるため minter は「呼ばれたら throw」にしてあり、ゲートを誤って広げると通り抜けではなく失敗する。
- **AC-32（consumer 実行経路）**: `subscribers.test.ts:91-101` が「継続イベント型はすべて購読者登録済み」を機械的に固定しており、ユニットテストからしか呼ばれない consumer の混入を防いでいる。
- **既存テストの弱体化なし**: 変更のあった `verifyEmail.test.ts` / `pruneExpiredAuthState.test.ts` / `outboxPrune.test.ts` / `unitOfWork.test.ts` の差分はいずれも assert の追加・強化のみ。`outboxPrune.test.ts` は最小スタブから実 memory ランタイム由来のコンテナへ格上げされている。

### カバレッジ

確認 93 / スキップ 191（合計 284）。

**確認（93）**

`.thread/2/plan.md`, `.thread/2/progress.md`, `.thread/2/testing.md`, `docs/test.md`, `vitest.config.ts`,
`apps/web/app/components/auth/__tests__/passwordStrength.test.ts`,
`apps/web/app/presentation/__tests__/deletionTicket.test.ts`,
`apps/web/app/presentation/__tests__/devOAuth.test.ts`,
`apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`,
`apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`,
`apps/web/app/worker/node/__tests__/runner.test.ts`,
`packages/core/src/adapters/conformance/`（`accountDeletionManifestStore.ts`, `appliedOperationStore.ts`, `authTokenRepository.ts`, `backend.ts`, `distributedOperationStore.ts`, `identityRemovalReceiptStore.ts`, `identityUniqueDirectory.ts`, `llmUsageRepository.ts`, `noteProjection.ts`, `objectStorage.ts`, `outboxRepository.ts`, `scopeCleanupAdmissionStore.ts`, `scopeTaskScheduler.ts`, `signInOAuthClient.ts`, `storageQuotaRepository.ts`, `storedFileRepository.ts` の 16 本）,
`packages/core/src/adapters/memory/__tests__/conformance.test.ts`, `.../conformanceBackend.ts`, `.../unitOfWork.test.ts`, `packages/core/src/adapters/memory/store.ts`,
`packages/core/src/adapters/oauth/__tests__/conformance.test.ts`, `.../googleSignInOAuthClient.test.ts`,
`packages/core/src/application/__tests__/helpers.ts`,
`packages/core/src/application/di/__tests__/serverNode.test.ts`,
`packages/core/src/application/execution/__tests__/eventId.test.ts`,
`packages/core/src/application/identity/__tests__/`（`addPasswordIdentity`, `authFlowHelpers`, `authResidueCleanup`, `changePassword`, `checkHandleAvailability`, `completeOAuthCallback`, `completeOAuthSignIn`, `deleteAccount.admission`, `deleteAccount.cleanup`, `deleteAccount.finalize`, `deleteAccount.globalCleanup`, `deleteAccount.manifestBuild`, `deleteAccount.recovery`, `deleteAccount.redaction`, `deleteAccount.terminalPrune`, `deletionDriver`, `deletionHarness`, `getAccountDeletionStatus`, `getProfile`, `linkOAuthIdentity`, `listIdentities`, `pruneExpiredAuthState`, `removeIdentity`, `requestPasswordReset`, `resendVerificationEmail`, `resetPassword`, `signOut`, `signOutOtherSessions`, `startOAuthFlow`, `updateProfile`, `verifyEmail` の 31 本）,
`packages/core/src/application/note/__tests__/createBlankNote.test.ts`,
`packages/core/src/application/storage/__tests__/`（`deleteFiles`, `deleteFilesByOwner`, `storeAvatar`）,
`packages/core/src/application/usage/__tests__/`（`deleteQuota`, `getUsageSnapshot`, `recalculateStorageUsage`）,
`packages/core/src/application/workers/__tests__/`（`outboxPrune`, `scopeTaskRunner`, `subscribers`）,
`packages/core/src/domain/identity/__tests__/policies.test.ts`, `packages/core/src/domain/storage/__tests__/storage.test.ts`, `packages/core/src/domain/usage/__tests__/quota.test.ts`, `.../valueObject.test.ts`,
アサーションの実効性を判定するために読んだ実装 13 本: `packages/core/src/application/identity/identityRemovalRelease.ts`, `.../uniqueness.ts`, `.../updateProfile.ts`, `.../completeOAuthSignIn.ts`, `.../linkOAuthIdentity.ts`, `.../deleteAccount/finalize.ts`, `packages/core/src/application/storage/deleteFiles.ts`, `.../deleteFilesByOwner.ts`, `.../storeAvatar.ts`, `packages/core/src/application/usage/getUsageSnapshot.ts`, `.../recalculateStorageUsage.ts`, `packages/core/src/domain/usage/valueObject.ts`, `packages/core/src/adapters/memory/store.ts`。

**スキップ（191）** — いずれも Test 観点の検証対象ではないため（実装コード・UI・ドキュメント・過去ラウンドの記録）。差分中のコメント走査（弁明・経緯の混入チェック）はスキップ分も含め全ファイルに対して実施済み。

- `apps/web/app/components/**` — 36 件。UI 実装（Frontend 観点）。
- `packages/core/src/domain/**`（`__tests__` を除く） — 28 件。ドメイン実装（Domain 観点）。テストからの期待値としては参照済み。
- `packages/core/src/application/identity/**`（`__tests__` と上記 13 本を除く） — 28 件。ユースケース実装（Domain/Usecase 観点）。
- `.thread/2/review/` 配下 — 24 件。過去ラウンドの記録。指示によりゼロベース検証のため未読。
- `packages/core/src/adapters/memory/**`（`__tests__` と `store.ts` を除く） — 17 件。memory アダプター実装（Adapter 観点。契約は適合スイート側で確認済み）。
- `apps/web/app/routes/**` — 16 件。ルート実装（Frontend 観点）。
- `packages/core/src/application/{cleanup,di,execution,storage,usage,workers}/*.ts`（上記 5 本を除く） — 15 件。ユースケース・ワーカー実装。
- `packages/core/src/application/ports/*.ts` — 10 件。ポート定義（Adapter 観点。契約は適合スイート側で確認済み）。
- `apps/web/app/presentation/*.ts`（`__tests__` を除く） — 7 件。プレゼンテーション実装（Frontend/Security 観点）。
- `apps/web` その他（`.env.example`, `routeTree.gen.ts`, `server.node.ts`, `worker/node/runner.ts`, `scripts/listen.node.ts`） — 5 件。
- `packages/core/src/adapters/oauth/*.ts` — 4 件。OAuth アダプター実装（Adapter 観点）。
- `docs/runtime_node.md` — 1 件。運用ドキュメント。
