# Domain / Use Case

## 前提と読み方

- 判定基準は `CLAUDE.md`（UoW 規律 / Outbox / cross-layer catch / 入力検証 2 点）、`spec/domains/{identity,usage,storage}.md`、`spec/usecases/{identity,usage,storage}.md`、`.thread/2/plan.md`（受け入れ基準・スコープ・縮退）。
- 縮退として plan.md に明記済みの事項（`applyStorageDelta` 未実装 / workspace ページング不在 / participant 2 種 / finalize receipt 3 種 / `AccountDeletionRetryPolicy` の到達不能 / 受理応答喪失の再駆動主体なし）は「設計からの逸脱」として数えていない。
- スコープ逸脱（見送り 89 行への越境）は見つからなかった。`participants.ts` の `AbsentReason` と `getUsageSnapshot` の `workspaces: readonly never[]`、`storeAvatar` の workspace 拒否はいずれも plan.md の宣言どおりで、見送り対象のドメイン本体を実装していない。

全体としては、削除オーケストレーションの設計（宣言集合による必須集合の導出、`AppliedOperationStore` によるコマンド重複排除、継続イベント ID の決定化、release → receipt → finalize → PII 削除の順序）は spec と ADR に忠実で、テストの網羅度も高い。以下は、その設計が守り切れていない 2 点と、周辺の 7 点。

---

## Blockers

- **[B-001]** `uniquenessRelease` の receipt 書き込みと finalize 継続の発行が別トランザクションで、しかも再配送時に早期 return するため、応答喪失で削除が恒久的に停止する
  - 場所: `packages/core/src/application/identity/deleteAccount/globalCleanup.ts:64-99`
  - 理由:
    `acknowledgeReceipt("uniquenessRelease")` は UoW の外で直接ポートに書き（83-86 行）、finalize 継続はその後の別 UoW で発行される（88-99 行）。この 2 つの間で応答が失われると、receipt だけが残る。ところが再配送されたコマンドは 64-66 行の

    ```ts
    if (header.receipts.includes("uniquenessRelease")) {
      return;
    }
    ```

    で早期 return するので、finalize 継続は二度と発行されない。`finalize` は「receipt を完成させた枝が再試行する」設計（`finalize.ts` の JSDoc、ADR-019 / ADR-025）なので、`uniquenessRelease` が最後の receipt だった場合、他に finalize を試みる主体がいない。しかも `acknowledgePersonalCleanup`（`cleanupDispatch.ts:89-100`）は receipt と継続を**同一 UoW** で書いており、`authResidueCleanup`（`authResidueCleanup.ts:85-111`）は UoW 外 ack を採りつつ「再配送すれば terminal turn に再到達して再 ack + 再発行できる」ことを JSDoc で明示して穴を塞いでいる。globalCleanup だけがこの規律から外れている。

    実際に再現した（memory ランタイム、`createTestHarness`）。`personalCleanup` / `authResidue` が先に着地し、uniqueness 解放が一度失敗して再駆動される（＝`uniquenessRelease` が最後の receipt になる）状況で、成功した回の finalize 継続を outbox から落とし、同じコマンドを再配送すると:

    ```
    receipts:   ["personalCleanup", "authResidue", "uniquenessRelease"]
    userStatus: "deleting"       // PII は残ったまま
    opStates:   ["running"]      // P-25 は永久に「処理中」
    ```

    以後どれだけ relay を回しても `completed` にならない。既存テストはこの経路を突いていない — `deleteAccount.globalCleanup.test.ts:77` の再駆動テストは manifest が `completed` になった**後**に呼ぶので `status !== "built"` で抜けてしまい、`deleteAccount.recovery.test.ts` が二重配送するのは personal 側の `dispatchAccountDeletionCleanup` だけ。plan.md の縮退にある「受理応答 / barrier ack を落としたときの再駆動主体を置かない」は**受理**の話で、continuation 平面のこの穴は含まれていない（AC-26「応答喪失からの再開」に真正面から反する）。
  - 提案: `acknowledgeReceipt("uniquenessRelease")` と finalize 継続の `collectEvents` を 1 つの `globalUnitOfWorkProvider.run` にまとめる（`acknowledgePersonalCleanup` と同じ形）。あわせて 64-66 行の早期 return を、`authResidueCleanup` と同じく「receipt があっても finalize 継続だけは再発行して抜ける」形に変える（`releaseActiveUniqueKey` のループだけをスキップする）。どちらか一方でも塞げるが、両方入れると「receipt があるのに finalize が来ない」状態が構造的に表現不能になる。

- **[B-002]** `AvatarUrl` が「同一オリジン」の不変条件を守れていない — `/\host/...` と C0 制御文字を含むパスがクロスオリジンに解決する
  - 場所: `packages/core/src/domain/identity/valueObject.ts:160-172`
  - 理由:
    `create` は「先頭が `/` で、`//` で始まらなければ相対パス」として素通しする。しかし URL 解決器は special scheme のバックスラッシュを `/` と同一視し、C0 制御文字を除去してから解決するので、次の 2 つはどちらも別オリジンになる（Node 22 / ブラウザーとも同じ）:

    ```
    "/\\evil.test/x.png"    -> https://evil.test/x.png
    "/<LF>/evil.test/x.png" -> https://evil.test/x.png
    ```

    どちらも `trimmed.startsWith("//")` を通らないので VO を通過する。転送境界（`apps/web/app/routes/settings/-action.tsx:93`）は `z.string().max(2048)` の DoS 上限しか見ない（これは規約どおり正しい）ので、業務不変条件を持つのはこの VO だけであり、そこが抜けている。結果として利用者は自分の `avatarUrl` を任意の外部ホストに向けられ、`AccountMenu` / P-21 / 将来の公開プロフィールを見た第三者のブラウザーが外部にリクエストを飛ばす。ADR-016 と AC-20 が明示的に要求する「同一オリジン検証を通り」が成立していない。

    同じリポジトリの兄弟実装 `startOAuthFlow.ts:27-47` の `assertSameOriginPath` は、まさにこの 2 つ（`\` と C0 制御文字）を JSDoc 付きで弾いている。片方だけ知識が反映されていない。既存テスト（`updateProfile.test.ts:352`「refuses a cross-origin URL and a protocol-relative one」）も `//` 形だけを見ており、この 2 形は通ってしまう。
  - 提案: `AvatarUrl.create` の相対パス分岐を `assertSameOriginPath` と同じ判定にそろえる（`value.includes("\\")` と C0 / DEL の走査を追加）。判定ロジックが 2 箇所に重複しているのが根本なので、`assertSameOriginPath` 相当を `AvatarUrl` 側（ドメイン）に一本化し、`startOAuthFlow` の `redirectTo` 検証もそれを呼ぶ形にするのが望ましい。テストに `/\evil.test/...` と改行入りの行を足すこと。

---

## Warnings

- **[W-001]** `updateProfile` の handle サガは commit と activate の間で落ちると回復できない — 再実行が `keep` に潰れ、User 行の handle に対応する durable claim が永久に存在しなくなる
  - 場所: `packages/core/src/application/identity/updateProfile.ts:74-78, 192-210`
  - 理由: `planHandle` は「すでに自分が持っている handle の再設定」を `keep` にする（78 行）。これは正常系では正しい（自分の予約に `HANDLE_ALREADY_USED` を返さないため）が、`globalUnitOfWorkProvider.run` が commit した直後にプロセスが落ちると、(a) 新 handle の `reserved` 行は 10 分の TTL で消え、(b) 旧 handle の `active` claim は解放されないまま残り、(c) 同じ入力で再実行しても `keep` になるので activate も旧 handle の解放も走らない。以後、User 行は handle X を名乗るが directory には X の claim が無く、別の利用者が X を `reserve` → `activate` できてしまう（`checkHandleAvailability` も「空き」と答える）。`spec/usecases/identity.md:27` は「複数予約の途中停止は operation payload に固定した全 sub-operation を照合し…commit 済みなら全 activate へ収束させる」と定めているが、`updateProfile` には照合対象の payload（`DistributedOperation`）が無く、`activateUniqueKeys` の回復はプロセス内で `activate` が例外を投げた場合しか働かない。AC-18 の「予約サガの 2 経路 recovery」＝ TC-identity-280/281 はどちらもプロセス内の経路で、この穴はテストにもない。
  - 提案: 最小修正としては、`planHandle` が `keep` を返す前に directory を `resolve` して「User 行の handle に対応する active claim が自分のものとして存在するか」を確認し、無ければ `assign` として扱って再予約 → activate → 旧 handle 解放まで走らせる（現行の `profileOperationId` が決定的なので同じ予約行に収束する）。全面対応が本 Issue の規模に合わないなら、少なくとも plan.md の「縮退」に 1 行として明記し、引き継ぎ先を書くこと。

- **[W-002]** `ScopeTaskScheduler.claimDue` が適合テストからしか呼ばれていない — ポートが宣言する「claim は scope トランザクションの中で行う」直列化が実行経路に無い
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:33-38, 58` / `packages/core/src/application/workers/scopeTaskRunner.ts:85-116`
  - 理由: `runDueScopeTasks` は `scopeTaskQueue.listDue` で期限到来行を読み、そのまま usecase を呼ぶ。usecase 側は `complete` / `backoff` / `schedule` で自分の行を決着させるが、`claimDue` は一度も呼ばれない。つまりポート JSDoc の「`claimDue` reads the due, non-failed rows in `dueAt` order and the caller settles each」は実装されていない契約になっている。Node ランタイムでは `createInProcessRelayTrigger` が 1 ラウンドを直列化するので実害は出にくいが、`runner.ts` の起動時 `track(runScopeTaskTick())` はトリガーを介さないため、起動直後の 1 秒 tick と重なれば同じ due 行を 2 本同時に駆動しうる（`deleteFilesByOwner` / `deleteQuota` はいずれも収束するので今は壊れないが、それは偶然に頼っている）。AC-31 の「適合テスト専用のポートが残らない」という方針とも整合しない。
  - 提案: `runDueScopeTasks` の各行を `scopeUnitOfWorkProvider.run(scope, ctx => ctx.scopeTaskScheduler.claimDue(...))` 経由にして、ポートの契約どおり claim してから usecase を呼ぶ。それが本 Issue の範囲外なら、`claimDue` をポートから外すか、JSDoc を「claim は将来の複数ワーカー配備で使う」と明示して現状の駆動方式を書き足す。

- **[W-003]** 「最後の 1 件は解除できない」というドメイン規則が、ユースケースで `identities.length >= 2` として再実装されている
  - 場所: `packages/core/src/application/identity/listIdentities.ts:26`
  - 理由: 同じ規則は `IdentityPolicy.ensureRemovable` がドメイン側に持っており、`removeIdentity` はそちらを呼ぶ。表示用に同じ判断をアプリケーション層で数え直すと、規則が変わったとき（例: 「password + OAuth のうち password は最後でも消せる」等）に画面と実行が食い違う。CLAUDE.md の「ドメインに置くべきロジックがユースケースに漏れていないか」に該当する。
  - 提案: `IdentityPolicy.isRemovable(identities): boolean`（または `removableIds(identities)`）を domain 側に足し、`ensureRemovable` をそれで実装したうえで `listIdentities` から呼ぶ。

- **[W-004]** `DisplayName` の上限 50 がユースケースに再宣言されている
  - 場所: `packages/core/src/application/identity/completeOAuthSignIn.ts:32, 56`
  - 理由: `DISPLAY_NAME_MAX_LENGTH = 50` は `packages/core/src/domain/identity/valueObject.ts:116` の同名定数の写しで、プロバイダー名の切り詰めに使われている。VO の上限が変われば OAuth サインアップだけが黙って `InvalidDisplayName` を投げ始める（切り詰めが上限を超える）か、逆に不要に短くなる。値の境界はドメインの持ち物。
  - 提案: `DisplayName` に `truncate(raw: string): DisplayName`（または `maxLength` の公開）を足し、ユースケースはそれを呼ぶ。

- **[W-005]** barrier ack を落としたときの「次の駆動が直す」という JSDoc の主張に、対応する駆動主体がいない
  - 場所: `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts:80-83` / `packages/core/src/application/workers/scopeTaskRunner.ts:105-115`
  - 理由: JSDoc は「A response lost in between leaves a completed barrier with no receipt, which the next drive repairs by re-reading the barrier and running this alone (ADR-018)」と書くが、この配備でその "next drive" にあたるのは `cleanup` フェーズの再配送のみで、`acknowledgePersonalCleanup` が scope task ランナー経由（`settleCleanupTurn`）で呼ばれて失敗した場合、task 行は既に `complete` 済み、例外は `runDueScopeTasks` の `catch` に飲まれ、`cleanup` イベントも消費済みなので誰も再駆動しない。plan.md はこれを縮退（「barrier ack を落としたときの再駆動主体を置かない」）として受け入れているので実装の判断としては範囲内だが、コード側の記述が実際より強い保証を約束している。
  - 提案: JSDoc から「次の駆動が直す」を落とし、「この配備では再駆動主体が無く、P-25 の再送に依存する（plan.md 縮退）」と書き換える。`runDueScopeTasks` の `catch` も、ack 失敗はログレベルを `error` のまま残しつつ「削除が running のまま残る」ことが分かる文言にする。

- **[W-006]** 著者 redaction の継続判定が、フィルタ後の件数をページ上限と比較している
  - 場所: `packages/core/src/application/identity/deleteAccount/authorRedaction.ts:53-61, 97-99`
  - 理由: `claimPending(operationId, "redaction", MANIFEST_PAGE_LIMIT)` の戻りを `isAuthorRoute` で絞ってから `claimed.targets.length === MANIFEST_PAGE_LIMIT` で「まだ続きがある」を判定している。`claimPending` が `redaction` フェーズで `authorRoute` 以外を返さない限り一致するが、その前提は型にもポート契約（`AccountDeletionManifestItem` は union のまま返る）にも表れていない。membership item を扱うスライス（#3）が入ったときに、100 件フルのページのうち何件かが membership だと「短いページ＝終端」と誤読し、未 ack の authorRoute を残したまま `finalize` へハンドオーバーする。`finalize` は `allRequiredAcknowledged`（receipt 集合）しか見ないので、この取りこぼしは検知されない。
  - 提案: 継続判定は claim した**生の件数**（`items.length === MANIFEST_PAGE_LIMIT`）で行い、`targets` は書き込み対象の絞り込みにだけ使う。あるいは `claimPending` の戻り型をフェーズで絞る（`claimPending<"redaction">` が `Extract<…, {kind:"authorRoute"}>[]` を返す）ようにして、型で表現不能にする。

- **[W-007]** `storeAvatar` は barrier / UoW 失敗時に、メタデータ行を持たないオブジェクトを残す
  - 場所: `packages/core/src/application/storage/storeAvatar.ts:94-137`
  - 理由: `objectStorage.put` はトランザクションの外・前で走る（設計どおり）。しかしその後の scope UoW が `assertWritable()`（削除 barrier 後）/ `assertActorWritable()` / OCC / 落下で失敗すると、オブジェクトだけが残り、`StoredFile` 行が無い。行が無いので `deleteFilesByOwner` の owner scan にも `sumSizeByOwner` にも現れず、`storage.fileDeleted` も出ないため、**アカウント削除を完了させてもそのバイト列は残る**。plan.md が縮退として記録しているのは「アップロードしたがプロフィールを保存せずに離脱 → 参照されない `StoredFile` が 1 件残る」ケースで、こちらは行がある分 #6 の orphan 回収で拾えるが、本件は行が無いので回収経路そのものが無い。
  - 提案: 少なくとも `assertWritable` / `assertActorWritable` の判定を `put` より前に行い（読み取りだけの前段チェックとして scope UoW を 1 本開くか、`cleanupAdmission` の読み取りビューを使う）、拒否が確定するケースでバイト列を書かないようにする。UoW 側の失敗経路については、`catch` で `objectStorage.deleteMany([objectKey])` をベストエフォートで走らせる（キー削除は冪等）か、この穴を縮退として plan.md / Issue コメントに記録する。

---

## 確認したが問題なしと判断した主な点（記録）

- **UoW 規律**: 変更されたユースケースはすべて `globalUnitOfWorkProvider.run` / `scopeUnitOfWorkProvider.run` の中で書き込み、イベントは `ctx.collectEvents` 経由のみ。ネストは無い（`admitAccountDeletion` の global UoW → その**後**に scope UoW、`deleteAccount/index.ts` の admission → manifest build も逐次）。UoW 外の書き込みは `acknowledgeReceipt`（2 箇所）と `signOut` の `deleteById`、`objectStorage.put/deleteMany`、`identityUniqueDirectory` のサガのみで、いずれも「跨げないストア」という理由が JSDoc に書かれている（`acknowledgeReceipt` の片方は B-001 として指摘）。
- **解放 → receipt → finalize 検査 → PII 削除の順序**: `globalCleanup.ts:76-86` が finalize より前に `releaseActiveUniqueKey` を回し、`finalize.ts:42-98` が `allRequiredAcknowledged` と identity 削除・`User.finalizeDeletion` を同一トランザクションに閉じている。解放に使う鍵は admission が payload に凍結（`admission.ts:37-50` / `input.ts:116-141`）しており、PII 削除後に鍵を再構築する経路は存在しない。ADR-020 どおり。
- **一意性サガの解放順序**: `reserveUniqueKeys` は途中失敗で取得済みだけを解放し（`uniqueness.ts:89-102`）、`releaseUniqueKeys` は決して throw しない。`updateProfile` は「新 activate → 旧 releasing」の順で、逆転していない（W-001 は別の穴）。`completeOAuthSignIn` の 2 鍵は 1 つの親 operation から決定的に派生し、commit 失敗の `catch` で両方解放される。
- **`authEpoch` バンプ 4 経路の共有コンシューマー**: `authResidueCleanup` は保存された `authEpoch` と現世代の一致を確認してから `deleteOlderEpochByUser(userId, authEpoch, …)` を呼ぶので、現世代は決して消えない。4 経路すべて（`resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount`）が同じ継続を同一 UoW で積んでいる。
- **`DeletingUser` / `DeletedUser` の横断**: `signInWithPassword`（既存）、`startOAuthFlow:88-92`、`completeOAuthSignIn` の 3 分岐、`linkOAuthIdentity:124-133`、`requestPasswordReset:57`、`resetPassword:68`、`addPasswordIdentity:51`、`updateProfile:107-115`、`getProfile:25-36` がすべて `status !== "active"` を UoW 内で再確認して倒れる。
- **入力検証 2 点**: 転送境界は形と DoS 上限だけ（`routes/settings/-action.tsx:77-94` にその旨のコメントあり）、業務不変条件は VO / ドメインサービス。ユースケースが中間で再検証している箇所は見当たらない（`addPasswordIdentity` / `completeOAuthSignIn` の `IdentityPolicy` 二度呼びは「ハッシュ計算前の早期棄却＋トランザクション内の本判定」で、性質が違うので重複検証ではない）。
- **cross-layer catch**: 広い `try/catch` は「サガの補償（`reserveUniqueKeys` / `activateUniqueKeys` / `releaseUniqueKeys`）」「メール送信のベストエフォート」「ワーカーの行単位耐性（`scopeTaskRunner` / `terminalPrune`）」「`PlainPassword.create` を `INVALID_CREDENTIALS` に潰す `changePassword:93-100`（意図が JSDoc にある）」「`resetPassword:152-159` の `AUTH_TOKEN_ALREADY_CONSUMED` → `AUTH_TOKEN_NOT_FOUND`（列挙耐性のための意図的な畳み込み）」に限られる。ドメインエラーをユースケース境界で再翻訳している箇所は無い。
- **Outbox / 冪等性**: 継続イベント ID の決定化（`eventId.ts` + `continuations.ts` の `continuationKey`）と、「自分と同じキーを再発行するとチェーンが止まる」ADR-025 の制約が、redaction のターン番号と finalize の producer 名で守られている。`IdempotencyStore` を通す / 通さないの判断（`authResidueCleanup` と `deleteStoredObjects` は根拠付きで通さない、`identityRemovalRelease` も同様）はいずれも JSDoc に冪等性の根拠が書かれており、plan.md の「未解決事項」に挙がっていた論点は決着している。
- **宣言集合による表現不能化**: `participants.ts` の `satisfies Record<enum, participant | absent>` は、コンポーネントを増やしたときに登録漏れを型エラーにする。`PERSONAL_CLEANUP_COMMANDS: Record<ActivePersonalCleanupComponent, …>` も同様。「誰も掃除していないのに完了できる」が構造的に作れない形になっており、ADR-002 / ADR-017 / ADR-018 の意図が型で表現されている。
- **テストの実効性**: `deleteAccount.*` / `updateProfile` / `deleteFilesByOwner` / `deleteQuota` / `recalculateStorageUsage` / `getUsageSnapshot` は TC ID 単位で振る舞いを検証しており、`runUntilSettled` が「動かない round があれば失敗」で停止を検知する作りになっているのは良い。形骸化したアサーションは見当たらなかった。弁明・修正経緯の残骸コメントも見当たらない。
- ドメイン層の `Usage` / `Storage` は spec/domains の表と 1 対 1（`UsageWarningLevel` の 80% / 100% 境界、`BillingPeriod` の UTC、`ByteQuota` の subject 別既定値、`ensureUploadAllowed` の `llm: null` の扱い、`PersistentFile` から artifact provenance を除いて「期限なしの生成物」を表現不能にした点）。

---

## カバレッジ

一覧 226 件に 1 対 1 で対応（確認 118 + スキップ 108 = 226）。

### 確認（118）

- `.thread/2/plan.md`
- `apps/web/app/routes/settings/-action.tsx`（転送境界の検証範囲の確認のため）
- `apps/web/app/worker/node/runner.ts`（scope task の駆動と直列化）
- `packages/core/src/application/cleanup/participants.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/application/execution/eventId.ts`, `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/identity/__tests__/` 27 件すべて（`deleteAccount.recovery.test.ts` / `deleteAccount.globalCleanup.test.ts` / `deletionDriver.ts` / `deletionHarness.ts` は全読、他はテスト名とアサーションを走査）
- `packages/core/src/application/identity/` の実装 33 件すべて（`addPasswordIdentity.ts`, `authResidueCleanup.ts`, `changePassword.ts`, `checkHandleAvailability.ts`, `completeOAuthCallback.ts`, `completeOAuthSignIn.ts`, `continuations.ts`, `deleteAccount/{admission,authorRedaction,cleanupDispatch,compaction,finalize,globalCleanup,index,input,manifestBuild,terminalPrune}.ts`, `eventDecoders.ts`, `getAccountDeletionStatus.ts`, `getProfile.ts`, `identityRemovalRelease.ts`, `linkOAuthIdentity.ts`, `listIdentities.ts`, `removeIdentity.ts`, `requestPasswordReset.ts`, `resendVerificationEmail.ts`, `resetPassword.ts`, `signOut.ts`, `signOutOtherSessions.ts`, `startOAuthFlow.ts`, `uniqueness.ts`, `updateProfile.ts`, `view.ts`）
- `packages/core/src/application/ports/` 9 件（`accountDeletionManifestStore.ts`, `appliedOperationStore.ts`, `distributedOperationStore.ts`, `identityRemovalReceiptStore.ts`, `objectStorage.ts`, `scopeCleanupAdmissionStore.ts`, `scopeTaskQueue.ts`, `scopeTaskScheduler.ts`, `scopeTaskTrigger.ts`）
- `packages/core/src/application/storage/` 8 件（`__tests__/{deleteFiles,deleteFilesByOwner,storeAvatar}.test.ts`, `deleteFiles.ts`, `deleteFilesByOwner.ts`, `deleteStoredObjects.ts`, `storeAvatar.ts`, `view.ts`）
- `packages/core/src/application/usage/` 7 件（`__tests__/{deleteQuota,getUsageSnapshot,recalculateStorageUsage}.test.ts`, `deleteQuota.ts`, `getUsageSnapshot.ts`, `recalculateStorageUsage.ts`, `view.ts`）
- `packages/core/src/application/workers/eventRelayWorker.ts`, `scopeTaskRunner.ts`, `subscribers.ts`
- `packages/core/src/domain/` 実装・ポート 23 件（`common/event.ts`, `identity/errorCode.ts`, `identity/ports/{authTokenRepository,identityUniqueDirectory,signInOAuthClient}.ts`, `identity/services/accountDeletionRetryPolicy.ts`, `identity/valueObject.ts`, `note/ports/{localNoteProjectionWriter,publicNoteProjectionWriter}.ts`, `storage/errorCode.ts`, `storage/events.ts`, `storage/ports/storedFileRepository.ts`, `storage/services/uploadValidationPolicy.ts`, `storage/storedFile.ts`, `storage/valueObject.ts`, `usage/errorCode.ts`, `usage/events.ts`, `usage/llmUsage.ts`, `usage/ports/{llmUsageRepository,storageQuotaRepository}.ts`, `usage/services/quotaEnforcement.ts`, `usage/storageQuota.ts`, `usage/valueObject.ts`）

### スキップ（108）

- `.thread/2/{adr,progress,steps,testing}.md`（4） — 設計意図の参照用。今回は plan.md で判断がつき、adr.md は B-001 / 解放順序の確認時に該当節のみ参照
- `apps/web/.env.example`（1） — 配線・設定でドメイン観点外
- `apps/web/app/components/**`（30） — フロントエンド観点（別レビュー担当）
- `apps/web/app/presentation/**`（5: `__tests__/{deletionTicket,devOAuth}.test.ts`, `deletionTicket.ts`, `devOAuth.ts`, `errorDisplay.ts`） — プレゼンテーション層の transport / 署名の関心
- `apps/web/app/routeTree.gen.ts`, `routes/__root.tsx`, `routes/auth/**`, `routes/dev/**`, `routes/notes/index.tsx`, `routes/reset-password.tsx`, `routes/settings/{auth,danger,profile,route,usage}.tsx`, `routes/storage.$.tsx`（14） — ルーティング / 画面配線でドメイン観点外
- `apps/web/app/server.node.ts`（1） — ランタイム配線
- `docs/runtime_node.md`（1） — 運用ドキュメント
- `packages/core/src/adapters/conformance/**`（15） — アダプター適合スイート（別レビュー担当）。ポート契約の側は `application/ports` / `domain/**/ports` で確認済み
- `packages/core/src/adapters/memory/**`（19） — memory アダプター実装（別レビュー担当）
- `packages/core/src/adapters/oauth/**`（5） — OAuth アダプター実装（別レビュー担当）
- `packages/core/src/application/di/{__tests__/serverNode.test.ts,memoryRuntime.ts,serverNode.ts}`（3） — composition root の配線・dev IdP ガード（別レビュー担当）。UoW コンテキストへのポート搭載は `execution/unitOfWork.ts` 側で確認
- `packages/core/src/application/execution/__tests__/eventId.test.ts`（1） — 実装側 `eventId.ts` を確認済みで、テストは決定 ID の単体検証
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts`（1） — Note スライスのテストへの barrier アサーション追加（18 行）で、本観点の判断に影響しない
- `packages/core/src/application/storage/eventDecoders.ts`（1） — ワイヤーデコーダーで、契約は `domain/storage/events.ts` 側で確認済み
- `packages/core/src/application/workers/__tests__/{outboxPrune,scopeTaskRunner,subscribers}.test.ts`（3） — 実装 3 本を確認済みで、B-001 の再現は独自ハーネスで実施
- `packages/core/src/domain/identity/__tests__/policies.test.ts`（1） — 既存ポリシーへの単体テスト追補（22 行）
- `packages/core/src/domain/storage/__tests__/storage.test.ts`（1） — `UploadValidationPolicy` / VO の単体テストで、実装側を確認済み
- `packages/core/src/domain/usage/__tests__/{quota,valueObject}.test.ts`（2） — 同上（Usage VO / 集約の単体テスト）
