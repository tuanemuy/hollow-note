# レビュー 001 — Test 観点

対象: PR #17（`issue/2/account-management-and-auth` → `main`）/ 変更 226 ファイル
契約: `.thread/2/plan.md`（AC-1..AC-33、見送り 89 行）、`spec/testcases/`、`spec/inventory/test.md`

## 前提と進め方

1. `spec/inventory/test.md`（TC ID の正典）から、plan.md の AC-3/4/7/8/10/11/13/14/15/16/18/19/21/22/24/25/26/27 が名指す TC 行を機械抽出した（**identity 172 行 / storage 19 行 / usage 14 行 = 205 行**。progress.md の「実装 277 行のうち TC 205 行」と一致する）。
2. 205 行それぞれについて、テストコード側に ID の言及があるかを機械照合した。**未言及は `TC-identity-107` の 1 件のみ**で、これは `TC-identity-105/107` として 1 テストに結合されている（後述 W-005）。
3. 見送り 89 行の先取りを機械照合した。**TC としての先取りは無い**。唯一 `TC-identity-052` がドメイン単体テスト名に現れるが、plan.md の縮退（`AccountDeletionRetryPolicy` は到達不能な先行実装、行としての検証は #3）どおりの扱いで、progress.md にも「チェックは付けない」と明記済み。**指摘に至らないと判断した。**
4. アサーションの実効性は、各 TC の spec 期待結果（`spec/testcases/**`）と 1 行ずつ突き合わせた。
5. 「並行」と称して逐次になっていないかは、**メモリ backend に実際にプローブを差し込んで UoW 突入回数を計測**して確認した（下記「並行テストの実効性検証」）。

## 並行テストの実効性検証（この観点の主眼）

レビュー依頼どおり「`Promise.all` を並べただけでは競合分岐に到達しない」ことを疑い、**一時テストで `globalUnitOfWorkProvider.run` の突入回数を計測**した（計測後に削除済み。`git status` clean を確認）。

| 検証対象 | 結果 |
|---|---|
| `verifyEmail` TC-identity-302/303/304（`Promise.all`） | **UoW 突入 2 回**。負けた側は `authTokenRepository.save` の条件付き更新で `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")` を踏み、rollback → `alreadyVerified: true` の分岐に到達している。pending token の読みが UoW の外にあるため、mutex による直列化の前に両者が pending を観測できる。**形骸化していない。** |
| `removeIdentity` TC-identity-186（`Promise.allSettled`） | **UoW 突入 2 回**（fulfilled / rejected）。最終 UoW 内の「最後の 1 件」再検査が実際に効いている。**形骸化していない。** |

injected-provider 型（`resetPassword` TC-identity-211 / `changePassword` TC-identity-023 / `updateProfile` TC-identity-280/281/293 / `completeOAuthSignIn` TC-identity-031/032）は、いずれも「本物のポートを包んで、コミット直後・応答喪失・ライバル先行コミットを注入する」正しい形になっている。`completeOAuthSignIn` TC-identity-030 は「別 operation が予約済み」の状態を作って `reserve` 側の競合分岐へ落としており、逐次実行でも到達すべき分岐に到達している。

**結論: 逐次実行に化けている並行テストは無い。**

## 境界値の確認（両側とも検証されているか）

| 境界 | 検証箇所 | 両側 |
|---|---|---|
| 23:59 / 24:00（verifyEmail） | `verifyEmail.test.ts:38,49` | ○（成功 / `TokenExpired` + `pending` のまま） |
| 59 秒 / 61 秒（resend・reset の間隔） | `resendVerificationEmail.test.ts:39,51`, `requestPasswordReset.test.ts:128` | ○ |
| 59 分 / 1 時間（resetPassword） | `resetPassword.test.ts:168,176` | ○（後者はハッシュ不変も確認） |
| 79% / 80% / 100%（警告レベル） | `domain/usage/__tests__/valueObject.test.ts:122`（79/80/99/100/101）, `quota.test.ts:90`, `getUsageSnapshot.test.ts:95,105,115` | ○ |
| 5MB ちょうど / 6MB / 5MB+1byte | `storeAvatar.test.ts:86,96`, `domain/storage/__tests__/storage.test.ts:125,139` | ○ |
| 8 件上限 | `addPasswordIdentity` 006/007, `linkOAuthIdentity` 125/126, `completeOAuthSignIn` 027, `listIdentities` 133 | ○ |
| 100 件ページング | `authResidueCleanup` 041（100+1）, `deleteQuota` 032（100/100/50）, manifest build 095/100（100+100+50）, compaction 102/103, terminal prune 104 | ○ |
| `batchSize` ちょうど 100 | `deleteFilesByOwner.test.ts:186`（継続を積まないこと） | ○ |
| 120 日 | `terminalPrune.test.ts:104`（`asOf` と同時刻は回収、1ms 後は残す）, `AccountDeletionRetryPolicy.windowStart` | ○ |
| 3 / 30 / 2 / 31 文字ハンドル、50 / 51 表示名、500 / 501 bio | `updateProfile.test.ts:209..242,290,301` | ○（2 と 31 の外側も） |

境界値は spec のとおりで、**両側が揃っている**。ここに指摘は無い。

---

## Blockers

- **[B-001]** ADR-007 の OAuth コールバック intent 分岐（`completeOAuthCallback`）に**テストが 1 本も無い**。plan.md の「テスト方針」が明示的に追加を宣言しているのに、実際に追加されたのは `devOAuth.test.ts`（ADR-021 の dev 同意画面のリダイレクト組み立て）だけで、別物である。
  - 場所: `packages/core/src/application/identity/completeOAuthCallback.ts:30`（テストが存在しない）/ 宣言箇所は `.thread/2/plan.md:170`「プレゼンテーションテスト: … と **OAuth callback の intent 分岐（ADR-007）**を追加する」
  - 理由: このディスパッチャーは AC-9（「`/auth/callback/$provider` が `state` の intent だけで分岐し（ADR-007）」）の実体で、しかも**セキュリティ境界**を 1 つ持っている。
    - `flow.provider !== input.provider` → `OAUTH_STATE_INVALID`。`:provider` は攻撃者が自由に書ける path パラメーターで、この一致検査が唯一の防御。**壊しても現行のテストは 1 件も落ちない。**
    - `intent: "integration"` → `OAUTH_STATE_INVALID`。#4 が来るまで state が発行されないという前提に依存した拒否だが、これも無検証。
    - `signIn` / `linkIdentity` の 2 arm がそれぞれ正しい usecase と DTO（`linkIdentity` arm だけ `redirectTo` を載せる — ADR-045）に落ちること。`TC-identity-121` は `linkOAuthIdentity` を**直接**呼んで signIn state を拒否させているだけで、ディスパッチャーを通っていない。
    - `take` が 1 回で state を消すこと（`TC-identity-035` は `completeOAuthSignIn` 側で見ているが、ディスパッチャー経由の経路では未検証）。
  - また、`spec/manual-tests/account.md` にも provider 不一致 / `integration` intent を突く手順は無い（TC-05 / TC-06 / TC-07 / TC-40 はいずれも正規の往復）。**自動でも手動でもゼロカバレッジ**であり、「緑であること」が何も保証していない領域が AC-9 の中核に残っている。
  - 提案: `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts` を追加し、既存の `beginOAuthFlow` / `devAuthorizationCode` ヘルパーを使って最低 5 ケースを固定する — (1) signIn state → `intent: "signIn"` かつセッション発行、(2) linkIdentity state → `intent: "linkIdentity"` かつ `redirectTo` を含む、(3) **state は google なのに `input.provider` が別値** → `OAUTH_STATE_INVALID` かつ Identity / Session が増えない、(4) `oauthStateStore` に `intent: "integration"` を直接置いた state → `OAUTH_STATE_INVALID`、(5) 同じ state の 2 回目 → `OAUTH_STATE_INVALID`。(3) は 1 行の条件式を守るためだけのテストだが、守る対象がリダイレクト先の乗っ取り耐性なので費用対効果は高い。

## Warnings

- **[W-001]** `TC-identity-040` の前提（session / token 行が**各 10,000 件**）が再現されておらず、期待結果の後半（「物理行は各 100 件 page の ack 完了まで finalize を待つ」）もこのテストでは見ていない。
  - 場所: `packages/core/src/application/identity/__tests__/deleteAccount.admission.test.ts:76`
  - 理由: 実際に置かれているのは sign-up が作った session 1 行だけで、`h.backend.sessions.values()).toHaveLength(1)` は「1 行が消えていない」ことしか言っていない。この行の眼目は「失効は世代であって行数に依存しない（O(1)）」なので、件数が 1 では定数時間性が観測できない。同種の行（TC-identity-018 / 210 / 246）は 10,000 件を実際に積んで `sessions.size` が変わらないことを確認しており、この行だけ規模が落ちている。
  - 提案: `changePassword.test.ts:142` の `plantSessions` と同じ形で 10,000 行を積み、`sessions.size` が受理後も 10,001 のままであること（＋ `authTokens` 側も同様）を足す。「finalize を待つ」の側は TC-identity-041 / 090 が担っているので、そちらへの参照コメントで十分。

- **[W-002]** `TC-identity-043` の期待結果は 2 つあるが、後半の「**User 世代を巻き戻さない**」が検証されていない。
  - 場所: `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts:184`
  - 理由: 検証しているのは `sessions.size === 9`（何も消していない）と継続 0 件だけ。世代を巻き戻す実装ミス（payload の `authEpoch` で `User` を上書きしてしまう類）はこのテストを通過する。前提で `authEpoch: 2` にしているのだから、事後にも 2 のままであることを見るのが自然。
  - 提案: `expect(h.backend.users.get(userId)?.authEpoch).toBe(2)` を 1 行足す。

- **[W-003]** `TC-identity-042` の期待結果のうち「**finalize 条件を満たす**」が検証されていない。
  - 場所: `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts:160`
  - 理由: このケースだけ `deletionOperationId` を渡しておらず（`event({ userId, authEpoch: 1, table: "authTokens" })`）、manifest を `begin` してもいないので、`authResidue` receipt が記録されるかを見ようがない。「Session phase へ戻らない」（前半）は見ているが、「戻らずに終端条件を満たす」という後半が抜けている。隣の TC-identity-041 は `deletionOperationId: "deletion-1"` を渡して receipt まで確認しているので、同じ形にできるはず。
  - 提案: TC-041 と同じく manifest を `begin` して `deletionOperationId` を渡し、再配送後に `manifestHeaders.get("deletion-1")?.receipts` が `authResidue` を含むことを足す。

- **[W-004]** `TC-identity-090` の期待結果のうち「**再試行時刻を記録する**」が検証されておらず、縮退記録も ID 単位になっていない。
  - 場所: `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts:103`（検証は「`deleting` のまま」「PII が残る」「`built` のまま」＋ログ文字列 `finalize is still waiting`）
  - 理由: ログ行は「再試行時刻の記録」ではない。実装上これは `DistributedOperationStore` が `next_attempt_at` を持たないこと（ADR-026）の帰結で、`.thread/2/progress.md` の「機能・運用としての縮退」に散文では書かれている。しかし plan.md 自身が定めた記録規律は「**チェックを付ける行の一部を欠く縮退は、どの ID のどの要素を欠いたかまで書く**」であり、progress.md の「チェックを付ける行の一部を欠くもの（ID 単位）」表には `TC-storage-043` / `TC-identity-044` / `TC-identity-085` / `TC-usage-059` はあっても `TC-identity-090` が無い。後続スライス（recovery Cron を足すスライス）が行単位で差分を拾えない。
  - 提案: progress.md の ID 単位表に `TC-identity-090 — 期待結果のうち「再試行時刻を記録する」を欠く（ADR-026。`next_attempt_at` が無いため再駆動は P-25 の再送に依存）→ recovery Cron を足すスライス` を 1 行足す。テスト側は「ログが出る」で妥協せず、少なくとも `finalize` 後も `distributedOperations` の `state` が `running` のままであることを見ておくと、無検証区間が狭くなる。

- **[W-005]** `TC-identity-107` が `TC-identity-105` と 1 テストに結合されており、**107 の前提（run checkpoint 前に停止）が再現されていない**（むしろ checkpoint が書かれたことを assert してから再実行している）。
  - 場所: `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts:118`（`expect(checkpointed).not.toBeNull()` → その後 `turn(null)` を再実行）
  - 理由: 105 は「checkpoint 済み・応答喪失 → 同じ cursor から再開」、107 は「DELETE 済み・checkpoint 未書き込み → lane 再実行」で、**状態が違う**。テストは前者の状態しか作っていない。今回の実装では `cursor` が引数なので入力としては同値になり、期待結果の 2 要素（「同じ入力 cursor の DELETE を冪等再実行」「次 cursor を catalog transaction で checkpoint する」）はどちらも観測されているため致命ではないが、行としては 1 つ分の状態が未検証のまま。
  - 提案: 再実行前に lane の cursor を `null` へ戻す（＝checkpoint が commit されなかった状態）1 行を足して、107 を独立した `it` に分ける。

- **[W-006]** `SignInOAuthClient` 適合スイートの exchange 半分は、Google 側では**資格情報がある環境でも何も検証しない**（`kind === "live"` で早期 `return` するだけの空パス）。
  - 場所: `packages/core/src/adapters/conformance/signInOAuthClient.ts:100,115,146`（3 ケースとも `if (harness.exchange.kind === "live") { return; }`）
  - 理由: 資格情報が無い環境では `describe.skip` になる（AC-6 どおり、810 passed / 3 skipped の 3 件がこれ）ので問題ないが、**資格情報を入れた瞬間に「3 件 passed」と表示される空テストに化ける**。緑が何も担保していない状態が「skip」ではなく「pass」として見えるのは、AC-30 の判定材料として危険。
  - 提案: `enabled` の条件を「資格情報がある **かつ** `exchange.kind === "offline"`」にするか、`live` の 3 ケースを `it.skip` として登録して、実行環境によらず「実行されていない」ことがレポートに残るようにする。

- **[W-007]** `TC-storage-042`（継続要求が**重複配送され 2 系列が並走**する）が、完全に逐次で実行されている。
  - 場所: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:250`（`const [first, second] = [await run(...), await run(...)]` — 配列リテラルの見た目に反して 2 つ目は 1 つ目の完了後に走る）
  - 理由: 期待結果「両系列とも『残っているものを読んで消す』だけなので結果は変わらず、対象が 0 件になった系列から順に継続をやめる」は逐次でも成立するので誤りではないが、**前提の「並走」が再現されていない**うえ、配列リテラルの書き方が並行に見えるため、後から読む人が「並行を検証済み」と誤読する。memory の UoW は mutex で直列化されるので `Promise.all` にしても真の並走にはならない点も含め、意図を明示すべき。
  - 提案: `await run(...)` を 2 行に分けたうえで、「memory の UoW は直列化されるため、ここで検証しているのは『2 系列が同じ残件を読んでも結果が変わらない』という冪等性であり、真の並走ではない」と 1 行コメントを置く。あるいは `deleteFilesByOwner` の `listByOwner` を包んで両系列が同じスナップショットを読む形を注入する（`TC-storage-043` のカウンター注入と同じ手口が使える）。

- **[W-008]** `checkHandleAvailability` / `getProfile`（ADR-047 で新設した 2 読み取り）にテストが無い。
  - 場所: `packages/core/src/application/identity/checkHandleAvailability.ts:26`, `packages/core/src/application/identity/getProfile.ts`
  - 理由: `checkHandleAvailability` は `Handle.create(input.handle)` を通すので、フォームが 2 文字や予約語を打った瞬間に `BusinessRuleError(InvalidHandle / HandleReserved)` を投げる。P-21 の「重複候補提示」は入力途中に叩かれる導線なので、この throw をフォームがどう扱うかが挙動を決めるが、その分岐は自動でも手動でも固定されていない。また `resolve` が `releasing` 行を解決しない（ADR-028）ことに依存した「保守的に free と答える」という判断も、`updateProfile` 側の `reserve` が `releasing` を塞ぐ非対称と組み合わさっており、両者のズレ（「free と出たのに保存で `HANDLE_ALREADY_USED`」）が仕様どおりであることを固定した箇所が無い。
  - 提案: `available` / `ownedBySelf` の 3 状態（未使用 / 自分が保持 / 他人が保持）と、`releasing` 行に対して `available: true` を返すこと（＝助言であって主張ではないこと）を 1 本のテストで固定する。JSDoc が主張している性質そのものなので、退行検知の価値が高い。

- **[W-009]** AC-6 の「**`OAUTH_DEV_MODE` が偽のときは 404 になる**」に自動テストも手動手順も無い。
  - 場所: `apps/web/app/routes/dev/oauth/authorize.tsx:27`（`loader` で `loadDevOAuthModeFn()` → `notFound()`）
  - 理由: コード上はガードが存在するが、`devOAuth.test.ts` が見ているのはリダイレクト URL の組み立てだけで、404 ガードは通らない。`spec/manual-tests/account.md` も dev モード ON 前提の手順しか無い。「production に dev IdP が漏れないこと」は plan.md の「リスクと注意点」で名指しされている項目なので、無検証で残っているのは惜しい。`readNodeServerEnv` 側（`NODE_ENV=production` × `OAUTH_DEV_MODE=true` の起動失敗）は `di/__tests__/serverNode.test.ts:19` で押さえられているので、ガードは 2 枚のうち 1 枚が検証済み。
  - 提案: `loadDevOAuthModeFn` が参照する判定関数だけを純関数として切り出せるなら 1 ケース足す。難しければ、AC-6 のこの要素は「起動時ガード（検証済み）＋ルートガード（コード確認のみ）」であることを progress.md の縮退に 1 行残す。

## 確認したが指摘に至らなかった点

的外れな指摘を避けるため、疑ったが問題無しと判断したものを残す。

- **`TC-storage-043`（1 バッチ 3 文）**: 実装は ADR-022 の帰結で 1 件ずつ `findById` → `delete` するため spec の「件数によらず 3 文」は満たさず、テストも「列挙 1 回 / 削除 1 件につきイベント 1 件」に置き換えている。当初これを Blocker 候補としたが、`.thread/2/progress.md` の「チェックを付ける行の一部を欠くもの（ID 単位）」に **TC ID とどの要素を欠いたかまで含めて記録済み**（ADR-057、「D1 実装を書くスライスが同じ行を再検証する必要がある」の引き継ぎ付き）で、plan.md の縮退記録規律を満たしている。**規律どおりの縮退であり、指摘しない。**
- **`TC-identity-085` / `TC-identity-044` の読み替え**: plan.md AC-26 が読み替えを明記し、テストもその形（宣言集合 `storage` / `usage`、personal File write の owner scan 回収）で書かれている。progress.md にも ID 単位で記録済み。
- **`TC-identity-052` がドメイン単体テスト名に現れる**: 見送り行だが、plan.md の縮退が「ドメイン単体テスト（7 / 8 / 9 の境界）と `countTerminalSince` の適合スイートまで」を明示的に許容し、progress.md も「チェックは付けない」と注記している。先取りではない。
- **適合スイートの一般化（ADR-002 / ADR-017）が #1 の保証を緩めていないか**: 緩めていない。`scopeCleanupAdmissionStore.ts` / `accountDeletionManifestStore.ts` はいずれも「宣言集合は enum の**真部分集合**であること」を意図的に使い、`UNDECLARED_COMPONENT` / `UNDECLARED_RECEIPT` を ack しても完了へ進まないことを追加で固定している。つまり「8 固定を要求する backend が落ちる」と「宣言外の ack が代用にならない」の両方向を締めており、**保証はむしろ強くなっている**。memory 側のデフォルトが全数（`ALL_COMPONENTS` / `ALL_FINALIZE_RECEIPTS`）で fail-closed なのも良い。
- **`ConformanceBackendOptions` が観測不能な内部を契約化していないか**: していない。新設 9 スイート（`storageQuotaRepository` / `llmUsageRepository` / `storedFileRepository` / `objectStorage` / `signInOAuthClient` / `identityRemovalReceiptStore` / `scopeTaskScheduler` / `appliedOperationStore` / `distributedOperationStore`）はすべて公開メソッドの戻り値と可視状態だけを見ている。`scopeTaskScheduler` スイートが `ScopeTaskQueue.listDue`（期限到来分のみ / `dueAt` 昇順 / limit 尊重）まで含む点も plan.md のテスト方針どおり。
- **`assertActorWritable` が独立に検証されていない**: AC-19 / AC-22 が要求する 2 本の呼び出しはコード上存在する（`storeAvatar.ts:102-103`, `recalculateStorageUsage.ts:52-53`）。ただし本 Issue には「actor の除名準備ロック」を作る経路（membership 側、#3）が無いため、`assertWritable` と区別できる入力を作れない。**構造的に検証不能であり、テストの不足ではない。**
- **`toBeDefined()` / `not.toBeNull()` 止まりのアサーション**: 新規テスト全体を走査したが、いずれも直後により強いアサーションが続く前置き（型ナローイング目的）で、単独で終わっているものは無かった。
- **`TC-identity-045` の 3 経路**: Note（`createBlankNote.test.ts:239`）/ Storage（`storeAvatar.test.ts:129`）/ Usage（`recalculateStorageUsage.test.ts:265`）の 3 つで `ACCOUNT_DELETING` を確認しており、plan.md AC-26 の「3 経路で成立」を満たしている。
- **見送り 89 行の先取り**: TC としてはゼロ。W-008 で挙げた `checkHandleAvailability` / `getProfile` は spec に無い追加入口（ADR-047）であって見送り行ではない。

## カバレッジ

一覧 226 件 = 確認 **70** + スキップ **156**。

### 確認（個別）

契約・記録:

- `.thread/2/adr.md`, `.thread/2/plan.md`, `.thread/2/progress.md`

テストコード（application / domain）:

- `packages/core/src/application/identity/__tests__/addPasswordIdentity.test.ts`
- `packages/core/src/application/identity/__tests__/authFlowHelpers.ts`
- `packages/core/src/application/identity/__tests__/authResidueCleanup.test.ts`
- `packages/core/src/application/identity/__tests__/changePassword.test.ts`
- `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.admission.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.globalCleanup.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.manifestBuild.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.recovery.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.redaction.test.ts`
- `packages/core/src/application/identity/__tests__/deleteAccount.terminalPrune.test.ts`
- `packages/core/src/application/identity/__tests__/deletionDriver.ts`
- `packages/core/src/application/identity/__tests__/deletionHarness.ts`
- `packages/core/src/application/identity/__tests__/getAccountDeletionStatus.test.ts`
- `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`
- `packages/core/src/application/identity/__tests__/listIdentities.test.ts`
- `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`
- `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`
- `packages/core/src/application/identity/__tests__/resendVerificationEmail.test.ts`
- `packages/core/src/application/identity/__tests__/resetPassword.test.ts`
- `packages/core/src/application/identity/__tests__/signOut.test.ts`
- `packages/core/src/application/identity/__tests__/signOutOtherSessions.test.ts`
- `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`
- `packages/core/src/application/identity/__tests__/updateProfile.test.ts`
- `packages/core/src/application/identity/__tests__/verifyEmail.test.ts`
- `packages/core/src/application/note/__tests__/createBlankNote.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/application/storage/__tests__/storeAvatar.test.ts`
- `packages/core/src/application/usage/__tests__/deleteQuota.test.ts`
- `packages/core/src/application/usage/__tests__/getUsageSnapshot.test.ts`
- `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts`
- `packages/core/src/application/workers/__tests__/outboxPrune.test.ts`
- `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/application/di/__tests__/serverNode.test.ts`
- `packages/core/src/application/execution/__tests__/eventId.test.ts`
- `packages/core/src/domain/identity/__tests__/policies.test.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/domain/usage/__tests__/quota.test.ts`
- `packages/core/src/domain/usage/__tests__/valueObject.test.ts`

適合テスト・バックエンド配線:

- `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`
- `packages/core/src/adapters/conformance/appliedOperationStore.ts`
- `packages/core/src/adapters/conformance/authTokenRepository.ts`
- `packages/core/src/adapters/conformance/backend.ts`
- `packages/core/src/adapters/conformance/distributedOperationStore.ts`
- `packages/core/src/adapters/conformance/identityRemovalReceiptStore.ts`
- `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`
- `packages/core/src/adapters/conformance/llmUsageRepository.ts`
- `packages/core/src/adapters/conformance/noteProjection.ts`
- `packages/core/src/adapters/conformance/objectStorage.ts`
- `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`
- `packages/core/src/adapters/conformance/scopeTaskScheduler.ts`
- `packages/core/src/adapters/conformance/signInOAuthClient.ts`
- `packages/core/src/adapters/conformance/storageQuotaRepository.ts`
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts`
- `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`

プレゼンテーションテスト:

- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`
- `apps/web/app/presentation/__tests__/devOAuth.test.ts`

テストの妥当性判定のために読んだ実装:

- `packages/core/src/application/identity/checkHandleAvailability.ts`（W-008 の根拠）
- `packages/core/src/application/identity/completeOAuthCallback.ts`（B-001 の根拠）
- `packages/core/src/domain/identity/errorCode.ts`（`TC-identity-268` の `InvalidProvider` / `InvalidProviderAccount` 呼称ずれの確認。#1 からの既知の spec 欠落で、本 PR の逸脱ではない）
- `apps/web/app/routes/dev/oauth/authorize.tsx`（W-009 の根拠）

### スキップ（ディレクトリ単位）

- `.thread/2/steps.md`, `.thread/2/testing.md`（2 件）— 手順書。テストの充足判定には plan.md / progress.md を正典とした。
- `apps/web/.env.example`, `docs/runtime_node.md`（2 件）— 設定・運用ドキュメント。観点外。
- `apps/web/app/components/**`（30 件）— UI 実装。コンポーネントテストは本リポジトリに存在せず（#1 から一貫）、PAGE 行の検証は AC-30 のマニュアルテスト担当。Frontend 観点へ。
- `apps/web/app/presentation/{deletionTicket,devOAuth,errorDisplay}.ts`（3 件）— 実装本体。対応するテストの中身で判定した。
- `apps/web/app/routes/**`（`dev/oauth/authorize.tsx` を除く 16 件）, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`（合計 16 件）— ルート／エントリー実装。自動テストの対象外で、AC-29 / AC-30 のブラウザ検証担当。
- `packages/core/src/adapters/memory/**`（`__tests__/` を除く 17 件）, `packages/core/src/adapters/oauth/{devSignInOAuthClient,googleSignInOAuthClient,pkce,signInOAuthClient}.ts`（4 件）— アダプター実装。適合スイート側で契約の充足を判定した。
- `packages/core/src/application/{cleanup,di,execution,identity,storage,usage,workers}/` の実装（`__tests__/` と B-001/W-008 の 2 ファイルを除く 74 件）— ユースケース実装。Backend / Architecture 観点へ。
- `packages/core/src/application/ports/**`（9 件）— ポート定義。契約の検証は適合スイート側で見た。
- `packages/core/src/domain/**`（`__tests__/` と `errorCode.ts` を除く 22 件）— ドメイン実装。単体テスト側で判定した。
