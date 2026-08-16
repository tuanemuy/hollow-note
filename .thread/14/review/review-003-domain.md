# レビュー R3 — ドメイン・ポート契約

第 3 ラウンド（収束確認）。新規の粗探しはせず、(1) 第 2 ラウンドの修正（`triage.md` の M-62〜M-87）が正しく入っているか、(2) 対になる側が置き去りになっていないか、(3) 自観点に関わる AC の検査が実際に通るか、の 3 点に絞って検証した。

## ドメイン・ポート契約

### Blockers

なし。

### Warnings

- **[W-001]** DOM 行 ↔ ADP 行の非対称が、本 PR が新設した 1 組に残っている
  - 場所: `spec/inventory/domain.md:316,317`（`DOM-note-071` / `DOM-note-072`）↔ `spec/inventory/adapter.md:240,241`（`ADP-note-055` / `ADP-note-056`）
  - 理由: ADP 側だけが「**行が変わったかを返す**」を持ち、DOM 側は持たない。M-79 が閉じた 3 組（`DOM-note-037` ↔ `ADP-note-021` / `DOM-common-013` ↔ `ADP-common-012` / `DOM-storage-034` ↔ `ADP-storage-020`）と同じクラスで、しかもこの 4 行は本 PR が**同時に新設した**対である。他の DOM 行（`DOM-common-042`「…を返し、既に消えていれば null を返す」/ `DOM-identity-062`）は戻り値まで書く粒度なので、DOM 側だけが 1 段粗い。
  - 影響は小さい: 定義元 `spec/domains/note.md:550` が `redactAuthor(input: AuthorRedaction): Promise<boolean>;   // 行が変わったかを返す` と書いており、実装 `packages/core/src/domain/note/ports/{localNoteProjectionWriter.ts:97,publicNoteProjectionWriter.ts:34}` とも一致している。台帳の 2 行だけの問題。
  - 提案: `DOM-note-071` / `DOM-note-072` の要点欄を `ADP-note-055` / `ADP-note-056` と同文にする（`… へ 1 行だけ置換し、行が変わったかを返す。行が無い / 別人が作った / 既に同世代以降はいずれも no-op`）。M-79 で採った「DOM 行へ 1 句足す」向きと同じ。

- **[W-002]** ADR-035 の「ヘッダーコメントの範囲表記も同じ（全形）」が、本 PR が編集した 5 つのヘッダーで守られていない
  - 場所: `packages/core/src/adapters/conformance/authTokenRepository.ts:9`（`ADP-identity-021..026, 039`）/ `accountDeletionManifestStore.ts:26`（`ADP-common-012..025, 041`）/ `objectStorage.ts:23`（`ADP-storage-018..020, 024`）/ `scopeCleanupAdmissionStore.ts:28`（`ADP-common-004..011, 040`）/ `signInOAuthClient.ts:41`（`ADP-identity-033/034, 040`）
  - 理由: `.thread/14/adr.md` ADR-035 の決定は「連記は ID を省略せず全形で書く。**ヘッダーコメントの範囲表記も同じ**（`ADP-note-028..034, ADP-note-055, ADP-note-056`）」と明言している。V7 が触った 2 ファイル（`noteProjection.ts:13` / `identityUniqueDirectory.ts:11`）は全形になったが、上記 5 行はいずれも本 PR が**この回で編集した行**（`, 039` / `, 041` / `, 024` / `, 040` の追記）でありながら短縮のままである。ADR-034 の「副産物」節が自ら「本 PR が新設した規約を本 PR 自身が守っていない形が 4 回続いた」と記録しているのと同じ形が 5 か所残る。
  - 到達性は失われていない（`039` / `040` / `041` / `024` はいずれも `it` 名から単体 grep で当たる。実測済み）ので Warning に留める。
  - 提案: 5 行を `ADP-identity-021..026, ADP-identity-039` の形へそろえるか、ADR-035 の決定からヘッダーの一文を落として `it` 名だけに掛ける規則にする（後者なら W-003 の起点も消える）。

- **[W-003]** `.thread/14/adr.md` ADR-029 / ADR-035 の「到達できない ID **21 本**」の帰属が実測と 1 本ずれる
  - 場所: `.thread/14/adr.md:1063`（ADR-029 の Consequences）/ `:1261`, `:1267`（ADR-035 の代替案節・影響節）
  - 理由: どちらも「**`it` 名の短縮連記が 31 ケース**、そのうち単体 grep で到達できない ID が 21 本」と書く。実測すると `it` 名の短縮連記は **31 ケースで一致**するが、そこから到達不能になる ID は **20 本**である。列挙された 21 本目 `ADP-identity-034` は `it` 名には一度も現れず、`signInOAuthClient.ts:41` の**ファイル冒頭 JSDoc**（W-002 の 5 行の 1 つ）にしか出てこない。数え漏れではなく「そのうち」の係り先が違う。
  - 検査（実行済み）: `it()` の第 1 引数だけを走査して短縮連記を展開し、`grep -rhoE "ADP-[a-z]+-[0-9]+"` で到達可能な 113 ID との差を取ると 20 本（`ADP-common-005,010,018,020,021,023,024` / `ADP-identity-011,013,016,022` / `ADP-note-009,011,018,039,044,045` / `ADP-storage-002` / `ADP-usage-002,007`）。
  - 提案: 「`it` 名の短縮連記 31 ケースから到達不能な ID が 20 本、加えてヘッダーの短縮表記から `ADP-identity-034` の 1 本」と分けて書く。W-002 を直すなら 21 → 20 になる。

### 第 2 ラウンドの修正の検証結果（自観点に関わる Key）

| Key | 判定 | 実測 |
| --- | --- | --- |
| M-62 ADP 追跡規約 / ADR 026 誤帰属 | **正しく入っている** | `grep -rn 'describe(' conformance/*.ts \| grep -c "ADP-"` = **0**、`describe` 総数 **34**、ADP ID を名乗る `it` = **166**（うち ADP ID が先頭でないものは **0**）。`spec/adr/052:13,24` は「ケース名（`it` の第 1 引数）の先頭」、`spec/inventory/adapter.md:5` と `spec/adr/index.md:114` も同文。052 の前提節（`:19`）は ADR 026 から引ける範囲を「契約の正本がポート定義／検証が共有適合スイート」に限り、「ADP 行と適合ケースの対応をどう追うかは 026 が決めておらず、本 ADR が決める」と明記。`spec/` に追跡規約としての `describe` は 0 件 |
| M-63 `AvatarUrl` / `SameOriginPolicy` | **正しく入っている** | `spec/domains/identity.md:46-52`（trim 後 1〜2048 文字 / `/` 始まりは `SameOriginPolicy.isSameOriginPath` / それ以外は `appUrl` と同一 origin / `BusinessRuleError(InvalidAvatarUrl)` / `create(raw, appUrl)`）は `valueObject.ts:153,167-199` と一致。`:374-386` の `SameOriginPolicy`（`//` 始まり・バックスラッシュ・C0 制御文字 `U+0000〜U+001F` と `U+007F`、真偽値のみ、呼び出し元は `AvatarUrl` と `startOAuthFlow` の `redirectTo`）は `services/sameOriginPolicy.ts:16-33` および `startOAuthFlow.ts` と一致。`UserBase.avatarUrl: AvatarUrl \| null` は `user.ts:21`、`updateProfile` の引数 `avatarUrl?: AvatarUrl \| null` は `user.ts:152-158` と一致。`:150` の「`appUrl` を要するのでユースケース側が構築」は `application/identity/updateProfile.ts:158-165` の `AvatarUrl.create(input.avatarUrl, config.appUrl)` と一致。再構築を再検証しない旨（`:52`）も `user.ts:315` の cast と一致。`DOM-identity-064/065` の要点欄も同文 |
| M-71 / M-72 適合スイートの連記全形化 | **正しく入っている** | 本 PR が採番した 8 ADP ID ＋ `ADP-identity-007` の 9 本すべてが `grep -rn "<ID>" packages/core/src/adapters/conformance/` で単体ヒット（`ADP-common-040`:1 / `041`:1 / `ADP-identity-039`:1 / `040`:1 / `041`:7 / `ADP-note-055`:2 / `056`:2 / `ADP-storage-024`:1 / `ADP-identity-007`:5）。`it("ADP-note-055/ADP-note-056: …")` / `it("ADP-identity-041/ADP-identity-007: …")` / `it("ADP-identity-041/ADP-identity-009: …")` / `it("ADP-identity-007/ADP-identity-008: …")` / `it("ADP-note-029/ADP-note-033: …")` はすべて全形。ヘッダー 2 本も全形（残り 5 本は W-002） |
| M-73 `continuationKey` の除外条件 | **正しく入っている** | `spec/domains/index.md:312` は「**global outbox で運ぶ identity 系の継続要求のうち**…」と平面を明示。同 diff で足した `identity.personalCleanupHandoverContinued` と既存の `identity.personalBarrierPruneContinued` は表で scope Alarm 側なので除外に当たらない。outbox へ載る identity 系継続は `continuations.ts:24,108,130,158,180` の 4 種で、`continuationKey` を持たないのは `identity.userAuthResidueCleanupContinued` の 1 つだけ（`identity.authStatePruneContinued` / `accountDeletionManifestPruneContinued` は worker の入力型で、event draft を作る経路が実装に無い）。断定は成立する |
| M-74 `updateProfile` 手順 2 | **正しく入っている** | `spec/usecases/identity.md:632` が「判定材料は operation ID であって利用者ではないので、同じ利用者の別 operation からの再予約も同じく衝突する／奪えるのは期限切れの `reserved` だけで、解除待ちの `releasing` の行は奪えない」へ。`:344`（`linkOAuthIdentity` 手順 3）/ `spec/domains/identity.md:429` / ポート JSDoc `identityUniqueDirectory.ts:22-26` / memory 実装 `repositories/identityUniqueDirectory.ts:50-68` と粒度・語がそろっている |
| M-75 `AuthTokenRepository` の JSDoc | **正しく入っている** | `domain/identity/ports/authTokenRepository.ts:23-28` が `resendVerificationEmail` と `requestPasswordReset` の 2 つを併記。対の `spec/domains/identity.md:474` も同じ 2 つを名指し。`DOM-identity-060` の要点欄も「再送間隔の判定に使う」で整合 |
| M-79 DOM 行 ↔ ADP 行の非対称 3 組 | **正しく入っている**（ただし W-001） | `DOM-note-037` ↔ `ADP-note-021`、`DOM-common-013` ↔ `ADP-common-012`、`DOM-storage-034` ↔ `ADP-storage-020` の 3 組は要点欄が**一字一句同じ**。M-32 で直した `DOM-common-009/018/020/022` ↔ `ADP-common-008/017/019/020/021` も同文。新設した `DOM-note-071/072` ↔ `ADP-note-055/056` だけが 1 句ずれている（W-001） |
| ADR-033〜036 の新規記録 | **妥当** | ADR-033（`failed` を落とさず広げず帰属を明記し決定を Phase 5 へ）は `DistributedOperationState` の 3 値・`spec/domains/index.md:147`・`spec/database/index.md` の CHECK と一致し、`spec/adr/046`「実装の縮退を写して spec を狭めない」と「実装にも spec にも無い遷移を新設しない」の両方に整合。ADR-034（規約は ADR 052 自身の決定として立てる）は 052 の本文・前提と実物どおり。ADR-035（連記は全形）は決定として妥当で、実物も `it` 名側では守られている（ヘッダーのみ W-002）。ADR-036（ADR 057 の軸を「ユースケースの失敗経路」へ広げ、行の同一性を「ユースケース × 条件」で定める）は本観点の対象外だが、`spec/adr/046` と矛盾しない |
| ADR-029 / ADR-030 の更新 | **妥当**（ADR-029 に W-003） | ADR-029 は「ADR 052 を触らずに済ませる」とした代替案を取り消し線で撤回し、052 側に規則が入った旨を追記していて、052 の実物（`:24` の連記・短縮禁止、`:54` の影響）と一致する。ADR-030 は検査語を否定形に絞る補足を入れており、実測でも `grep -rn "the spec writes\|the spec's output table\|has no usecase in the spec\|no spec TC\|the spec mandates it unconditionally\|spec の記載漏れ" packages/ apps/` が **0 件**（`dist/` を除く）。ADR-029 の件数の帰属だけが W-003 |

**集計: 正しく入っていた 8 / 反映漏れ 0 / 反映ミス 0 / 新たな矛盾 0**（W-001〜W-003 はいずれも「反映が及ばなかった周辺 1 段」であり、R2 の指摘そのものの反映漏れ・反映ミスではない）。

### 実行した AC の検査コマンドと結果

| AC | コマンド | 結果 |
| --- | --- | --- |
| AC-55 | `spec/inventory/{domain,adapter,usecase}.md` の ID 集合を `origin/main` と差分 | 追加 **22 行**（DOM 11: `DOM-common-041,042` / `DOM-identity-060〜065` / `DOM-note-071,072` / `DOM-storage-038`、ADP 8: `ADP-common-040,041` / `ADP-identity-039〜041` / `ADP-note-055,056` / `ADP-storage-024`、UC 3: `UC-identity-022〜024`）、**消えた ID 0 件**。plan の列挙と 1 対 1 で一致 ✅ |
| AC-58 | `git diff origin/main...HEAD -- packages/core/src/{domain,application/ports}/` | (a) `scopeCleanupAdmissionStore.ts` の JSDoc に completed 拒否が入っている、(b) `domain/identity/errorCode.ts` の冒頭コメント全文削除、(c) `domain/storage/errorCode.ts` の 2 行削除 ✅。対になる側も確認 — `spec/domains/identity.md:590-593` の union に `InvalidAvatarUrl` / `IdentityLimitExceeded`、`spec/domains/storage.md:358` に `InvalidChecksum` ✅ |
| AC-59 | `pnpm test:unit` | 76 files / **925 passed, 3 skipped** ✅。`ADP-common-008` のケースに completed barrier の主張が入っている（`scopeCleanupAdmissionStore.ts:68-84`）✅ |
| AC-61 | `ls spec/adr/05[2-7]-*.md \| wc -l` / `grep -rn "adr/056-" spec/` | **6** ✅ / ADR 056 は `spec/platform/index.md:152` `spec/usecases/storage.md:500` `spec/testcases/storage/deleteFilesByOwner.md:11`（＋ `spec/inventory/test.md:1754`）から参照 ✅ |
| AC-62 | `grep -c createDownloadUrl spec/domains/storage.md` ほか 3 本 | `3` / `3` / `2`（いずれも 1 件以上）✅。`spec/domains/storage.md:296` に `createDownloadUrl` の行が残存 ✅ |
| AC-66 | `grep -c "AppliedOperationStore" spec/domains/index.md` | **1**（`:148` に `DistributedOperationStore` と同粒度の 1 行言及。inventory 行は不採番）✅。`spec/database/index.md:35,1037` が同じ名前と `(operationId, commandKey)` を使い、`:1037` に畳み込み式 `sha256(operationId + ":" + commandKey)` があり実装 `adapters/memory/repositories/appliedOperationStore.ts` と一致（M-83）✅ |
| AC-68（リンク解決） | `grep -rhoE "adr/05[2-7]-[a-z-]+\.md" spec/` の各パスを実解決 | **6 / 6 実在** ✅ |
| M-62 の閉じ方 | `grep -rn 'describe(' packages/core/src/adapters/conformance/*.ts \| grep -c "ADP-"` | **0** ✅ |
| M-71 / M-72 の到達性 | `grep -rhoE "ADP-[a-z]+-[0-9]+" packages/core/src/adapters/conformance/ \| sort -u` と `spec/inventory/adapter.md` の ID 集合の差 | コード側 113 ID がすべて台帳に実在（**台帳に無い ID 0 件**）✅。逆向き（台帳のみ 236 件）は未実装ドメイン（conversion / integration / workspace ほか）を含むので想定どおり |
| ADR-030 | `grep -rn "the spec writes\|the spec's output table\|has no usecase in the spec\|no spec TC\|the spec mandates it unconditionally\|spec の記載漏れ" packages/ apps/` | **0 件**（`dist/` 除く）✅ |
| M-76 | `addPasswordIdentity.ts:15` / `changePassword.ts:26` ↔ `spec/inventory/usecase.md:25,26` | `UC-identity-013` = `addPasswordIdentity` / `014` = `changePassword` で一致 ✅ |

### カバレッジ

**確認（45 件）**

- `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`
- `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/inventory/usecase.md`, `spec/inventory/test.md`
- `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/index.md`
- `spec/database/index.md`, `spec/usecases/identity.md`, `spec/testcases/identity/updateProfile.md`
- `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/storage/errorCode.ts`
- `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/ports/shareTokenProtector.ts`
- `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`, `.../authTokenRepository.ts`, `.../identityUniqueDirectory.ts`, `.../noteProjection.ts`, `.../objectStorage.ts`, `.../scopeCleanupAdmissionStore.ts`, `.../signInOAuthClient.ts`
- `packages/core/src/application/identity/addPasswordIdentity.ts`, `.../changePassword.ts`, `.../completeOAuthCallback.ts`, `.../getProfile.ts`, `.../removeIdentity.ts`, `.../uniqueness.ts`, `.../view.ts`（後半 5 本は ADR-030 の否定形 grep 経由）
- `packages/core/src/application/identity/__tests__/updateProfile.test.ts`, `.../__tests__/getProfile.test.ts`, `.../__tests__/checkHandleAvailability.test.ts`
- `apps/web/app/presentation/session.ts`, `apps/web/app/components/settings/ProfileForm/action.ts`（ADR-030 の否定形 grep 経由）
- `.thread/14/adr.md`（ADR-029 / 030 / 033〜036 の節）, `.thread/14/plan.md`（AC-55 / 58 / 59 / 61 / 62 / 63 / 66 / 68）

**スキップ（56 件）**

- `.thread/14/review/review-001-docs.md`, `review-001-domain.md`, `review-001-general.md`, `review-001-inventory.md`, `review-001-presentation.md`, `review-001-usecase.md`, `review-001.md`, `review-002-docs.md`, `review-002-domain.md`, `review-002-inventory.md`, `review-002-presentation.md`, `review-002-usecase.md`, `review-002.md`, `triage.md` — レビュー中間成果物（後続フェーズで削除。`triage.md` は判定の入力として読んだが内容レビューの対象外）
- `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md` — general / docs 観点の担当（乖離台帳・手順書）
- `.dockerignore`, `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example` — 他ランタイム残骸の削除。ドメイン・ポート契約に触れない（M-85 は docs 観点）
- `CLAUDE.md`, `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md` — docs 観点の担当
- `apps/web/app/start.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts` — presentation 観点の担当（ADR 参照の dangling / Cookie 属性）
- `packages/core/src/application/di/containerStore.ts` — DI 配線のエラーメッセージ文字列のみ。ポート契約に触れない
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` — usecase / test 観点の担当（TC ID 命名）
- `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/057-manual-test-followthrough.md` — presentation / docs 観点の担当（R2 でも本観点の指摘は出ていない）
- `spec/inventory/frontend.md`, `spec/pages/index.md`, `spec/presentation/index.md`, `spec/platform/index.md`, `spec/scenario/account.md` — presentation 観点の担当
- `spec/manual-tests/account.md`, `spec/manual-tests/index.md` — docs / usecase 観点の担当（M-68 / ADR-036）
- `spec/testcases/identity/addPasswordIdentity.md`, `checkHandleAvailability.md`, `completeOAuthCallback.md`, `completeOAuthSignIn.md`, `deleteAccount.md`, `getProfile.md`, `linkOAuthIdentity.md`, `requestPasswordReset.md`, `signUpWithPassword.md`, `startOAuthFlow.md` — usecase / test 観点の担当（本観点は `AvatarUrl` の対になる `updateProfile.md` のみ確認した）
- `spec/testcases/storage/deleteFilesByOwner.md`, `spec/testcases/storage/storeUpload.md`, `spec/testcases/usage/recalculateStorageUsage.md` — usecase / test 観点の担当
- `spec/usecases/storage.md`, `spec/usecases/usage.md` — usecase 観点の担当（本観点は `spec/domains/storage.md` の `ObjectStorage` / `UploadValidationPolicy` 側だけ確認した）

確認 45 ＋ スキップ 56 = **101 件**（変更ファイル一覧と 1 対 1）。

### 収束判定

- 実装レビューを終えてよいか: **はい**
- 理由: 本観点の Blocker は 0 件。第 2 ラウンドの自観点 8 Key（M-62 / M-63 / M-71 / M-72 / M-73 / M-74 / M-75 / M-79）はすべて実物と一致し、反映漏れ・反映ミス・新たな矛盾はいずれも 0 件だった。ADR-033〜036 の新規記録と ADR-029 / ADR-030 の更新も内容として妥当。残る W-001〜W-003 は台帳 2 行・ヘッダーコメント 5 行・`.thread/` の作業成果物の計数 1 か所に閉じており、いずれも ID の到達性・契約の解釈・実行される振る舞いのどれも変えない。マージ後に別スライスで返済しても実装者が誤った成果物を作る経路は無い。
