# レビュー R3 — ユースケース・シナリオ・テストケース

第 3 ラウンド（収束確認）。新規の粗探しはせず、(1) 第 2 ラウンドの修正（`M-62`〜`M-87`）が正しく入っているか、(2) 対になる側が置き去りになっていないか、(3) 自観点の AC の検査が実際に通るか、の 3 点に絞って検証した。

## ユースケース・シナリオ・テストケース

### Blockers

なし。

### Warnings

- **[W-001]** 新規採番した TC のうち、台帳からコードへ到達できるのが 32 行中 4 行だけ。
  - **場所**: `packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts:267`、`packages/core/src/application/identity/__tests__/removeIdentity.test.ts:177,205`
  - **理由**: 実測 `for i in 305..335; grep -rl "TC-identity-$i" packages/ apps/` は `332`〜`335`（R2 の M-87 / V12 が `it` 名に名乗らせた分）だけがヒットし、`305`〜`331` と `TC-usage-073` は 0 件。とくに `recalculateStorageUsage.test.ts` は `it` 10 本のうち 9 本が `TC-usage-065`〜`072` を名乗り、**`TC-usage-073` が拘束する 1 本（`:267` "a user subject other than the actor is refused"）だけが無印**。`removeIdentity.test.ts` も `TC-identity-330` / `331` が拘束する 2 本（`:177` / `:205`）だけが同ファイル内で無印のまま残る。同じ R2 で M-87 は「契約を確かめる TC が台帳から辿れない状態は残せない」を理由に `it` 名を書き換えており、**同一ラウンド内で扱いが割れている**。ADR 052 は TC ID について採番位置しか決めておらず、`it` 名で追うかどうかの規約が無いため、次の実装者はどちらに倣えばよいか読めない。
  - **提案**: (a) `recalculateStorageUsage.test.ts:267` / `removeIdentity.test.ts:177,205` の `it` 名に ID を足す（文字列のみ。AC-63 の実測件数は +2 ファイル）か、(b) それを採らないなら `spec/adr/052` の TC の節に「TC ID は `it` 名で追わない（ADP ID との非対称の理由）」を 1 文足し、V12 の 4 本を例外として位置づける。**どちらかを選んで記録する**のが要点で、無記録のまま 4 / 32 で割れている状態を残さない。

- **[W-002]** 本 PR が新設した `UC-identity-023` / `UC-identity-024` を名乗るコードが無い。
  - **場所**: `packages/core/src/application/identity/checkHandleAvailability.ts:10-24`、`packages/core/src/application/identity/completeOAuthCallback.ts:17-26`
  - **理由**: R2 の M-67 / V8 は `getProfile.ts` の否定コメントを潰すついでに `UC-identity-022` を名乗らせた（`:9`）が、同じ PR が採番した `023` / `024` の 2 本は対象ファイルに入っていなかったため無印のまま。identity の application 実装は 19 ファイルが `UC-identity-0xx` を JSDoc 冒頭で名乗る（`grep -rn "UC-identity-0" packages/core/src/application/identity/*.ts`）ので、新設 3 本のうち 1 本だけが規約に乗った形になる。W-001 と同じ「台帳 → コードの到達性」の面。
  - **提案**: 2 ファイルの JSDoc 1 行目に `(UC-identity-023, spec/usecases/identity.md#checkhandleavailability)` / `(UC-identity-024, spec/usecases/identity.md#completeoauthcallback)` を足す（コメント文字列のみ。V8 / ADR-030 と同じ扱い）。W-001 と同じ単位で処理できる。

- **[W-003]** 手順書のエラーケース対応表に `requestPasswordReset` のレート制限行だけが無い。
  - **場所**: `spec/manual-tests/account.md:535-581`（`### ユースケースエラーケース対応表`）
  - **理由**: `spec/usecases/identity.md` の `requestPasswordReset` エラーケース表は `| レート制限 | 何もせず成功として返す |` の行を持つのに、対応表には `requestPasswordReset | 未登録のメールアドレス` と `パスワード手段なし` の 2 行しかない。**対になる `resendVerificationEmail | 間隔制限 | 対象外 | 60 秒の待機を伴うため自動テストで担保する` と `signUpWithPassword | レート制限 | 対象外` は両方ある**ので、同じ性質の行が 1 つだけ落ちている。本 PR は AC-45 でこのユースケースの 60 秒発行間隔を正典化し（`spec/usecases/identity.md` 処理フロー / `UC-identity-011` / `TC-identity-321,322`）、M-68 で対応表を 15 行増やした直後なので、非対称が目立つ位置にある。本 PR 由来ではない既存の欠落なので Warning。
  - **提案**: `requestPasswordReset | レート制限 | 対象外 | 60 秒の発行間隔の待機を伴うため自動テストで担保する（`TC-identity-321` / `322`）` を `パスワード手段なし` 行の直後に足す。ADR 057 の「手作業で再現できないものは `対象外` と理由を 1 行」の既存様式にそのまま乗る。

- **[W-004]** `TC-storage-221`（M-66 の書き換え後）の前提条件が、手で作れる前提ではなく型レベルの言明になっている。
  - **場所**: `spec/testcases/storage/storeUpload.md:36` ＋ `spec/inventory/test.md:1932`
  - **理由**: 前提条件が「宣言 MIME・宣言サイズを渡す経路が無い」で、これは入力 DTO の形の記述であってテストが用意できる状態ではない。R2 のトリアージが指定した文言をそのまま入れたものなので**反映ミスではない**が、M-77 が `TC-identity-192` から落とした「そのテストケースからは観測できない主張」と同じクラスが、期待結果ではなく前提条件の側に残った形になっている。あわせて期待結果の前半（「保管する型は先頭バイトの署名」）は同ファイル `:9`（`拡張子と内容が食い違う` → `内容から判定した形式が使われる`）と実質同じ主張で、後半（サイズが実バイト長）だけが新しい。
  - **提案**: 連番を保ったまま前提条件を実際に作れる形へ寄せる。例: 前提条件「実サイズが 3 MB のファイル」／操作「アップロードする」／期待結果「保管される MIME は先頭バイトの署名から、サイズは実バイト長から決まる（`AcceptedUpload`。宣言値を渡す経路は入力 DTO に無い — [ADR 050](../../adr/050-upload-acceptance-from-bytes.md)）」。台帳行も同文にする。

- **[W-005]** `TC-storage-043` を名乗る `it` 名に、改訂差分の言い回しが残っている。
  - **場所**: `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:358`
  - **理由**: `it("TC-storage-043 (without the statement-count promise): one turn enumerates once and emits one event per file, whatever the count")` の括弧書きは「（以前あった）文の数の約束を持たない版」という**改訂前との差分**を述べる書き方で、`spec/index.md:5` / `CLAUDE.md:16` が正典から排した「以前は〜だった」と同じ形。R1 の M-47 が `spec/usecases/storage.md` / `spec/testcases/storage/deleteFilesByOwner.md` / `spec/inventory/test.md` の 3 か所から同じ言い回しを落とした際、テスト側のこの 1 か所が残った（M-12 は `:252` から接頭辞を外すところまでで、`:358` の文言は触っていない）。改訂後の台帳行はすでに「バックエンドが発行する文の数はここでは約束しない」と明記しているので、括弧書きが担う情報は無い。
  - **提案**: 括弧を落として `it("TC-storage-043: one turn enumerates once and emits one event per file, whatever the count")` にする（文字列のみ）。

### カバレッジ

**確認（40 件）**

- 契約・前提: `.thread/14/plan.md`（AC-24/44/45/48/52/53/55/61/62/63/64/65/67/68 を実行）, `.thread/14/review/triage.md`, `CLAUDE.md`
- ユースケース: `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md`
- テストケース（14 件）: `spec/testcases/identity/addPasswordIdentity.md`, `spec/testcases/identity/checkHandleAvailability.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/deleteAccount.md`, `spec/testcases/identity/getProfile.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/requestPasswordReset.md`, `spec/testcases/identity/signUpWithPassword.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/testcases/identity/updateProfile.md`, `spec/testcases/storage/deleteFilesByOwner.md`, `spec/testcases/storage/storeUpload.md`, `spec/testcases/usage/recalculateStorageUsage.md`
- 台帳: `spec/inventory/test.md`（全 2440 行を testcases 全 146 ファイルと機械照合）, `spec/inventory/usecase.md`, `spec/inventory/domain.md`（AC-55 の ID 集合差分のみ）, `spec/inventory/adapter.md`（同）
- シナリオ・手順書: `spec/scenario/account.md`, `spec/manual-tests/account.md`, `spec/manual-tests/index.md`
- ADR: `spec/adr/057-manual-test-followthrough.md`, `spec/adr/052-adapter-inventory-granularity.md`
- ドメイン（自観点の対になる側のみ）: `spec/domains/identity.md`（ユースケース概要 24 本 / `reserve` の衝突条件）, `spec/domains/storage.md`（`ObjectStorage` 引き継ぎ段落 / `createDownloadUrl` 残存）
- コード（spec の対になる側）: `packages/core/src/application/identity/getProfile.ts`, `packages/core/src/application/identity/addPasswordIdentity.ts`, `packages/core/src/application/identity/changePassword.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/__tests__/getProfile.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/application/identity/__tests__/updateProfile.test.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `apps/web/app/components/settings/ProfileForm/action.ts`

**スキップ（61 件）**

- `.thread/14/review/review-00{1,2}*.md`（13 件） — レビュー中間成果物（後続フェーズで削除。カバレッジ上まとめてよい旨が指示にある）
- `.thread/14/adr.md`, `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md`（5 件） — 作業成果物。件数・as-of・検査コマンドの追随は general / docs 観点の担当（M-71 影響節 / M-80 / M-84 / M-45）
- `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md`（3 件） — docs 観点
- `.dockerignore`, `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example`（4 件） — リポジトリの残骸。docs / general 観点（M-46 / M-85）
- `apps/web/app/start.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`（4 件） — presentation 観点（M-42 / M-69）
- `packages/core/src/adapters/conformance/{accountDeletionManifestStore,authTokenRepository,identityUniqueDirectory,noteProjection,objectStorage,scopeCleanupAdmissionStore,signInOAuthClient}.ts`（7 件） — 適合スイートの ADP ID 命名。domain / inventory 観点（M-11 / M-62 / M-71 / M-72）
- `packages/core/src/application/di/containerStore.ts` — general 観点（ADR-024）
- `packages/core/src/application/identity/{removeIdentity,uniqueness,view}.ts`, `packages/core/src/application/ports/{accountDeletionManifestStore,scopeCleanupAdmissionStore,shareTokenProtector}.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/{authTokenRepository,identityRepository}.ts`, `packages/core/src/domain/storage/errorCode.ts`（10 件） — ポート契約・JSDoc。domain 観点（M-02 / M-23 / M-58 / M-75）
- `spec/adr/{053,054,055,056}-*.md`, `spec/adr/index.md`（5 件） — 内容は docs / domain 観点。相対リンクの解決だけは全 `spec/` 一括で検査済み（下記）
- `spec/database/index.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/usage.md`（4 件） — domain 観点（M-73 / M-79 / M-83）
- `spec/inventory/frontend.md`, `spec/pages/index.md`, `spec/presentation/index.md`, `spec/platform/index.md`（4 件） — presentation / inventory 観点（M-70 / M-82）

確認 40 ＋ スキップ 61 = **101 件**（変更ファイル一覧と 1 対 1）。

### 収束判定

- 実装レビューを終えてよいか: **はい**。Blocker 0 件。Warning 5 件はいずれも (a) 台帳 → コードへの到達性の記録漏れ（W-001 / W-002）、(b) 既存の 1 行欠落（W-003）、(c) 文言の精度（W-004 / W-005）で、**どれもコメント / 表の 1 行の書き換えに閉じ、実行される振る舞いを変えない**。W-001 と W-002 だけは「同じラウンドの中で扱いが割れている」ので、修正するか記録するかを決めてから閉じるのが望ましい。

## 検証の詳細

### 第 2 ラウンドの修正（自観点の 13 Key）

| Key | 判定 | 実測 |
| --- | --- | --- |
| M-63（TC 側の波及） | 反映済み | `AvatarUrl` / `SameOriginPolicy` が `DOM-identity-064` / `065` として採番され（ID 集合差分で確認）、対になる TC は M-87 が担当 |
| M-64 | 反映済み | `spec/testcases/identity/{completeOAuthSignIn:20,linkOAuthIdentity:14}.md` と `spec/inventory/test.md:471,472`（`TC-identity-330` / `331`）が**同文**。相対リンクの深さだけが正しく違う（`../../adr/` ↔ `../adr/`）。実装 `completeOAuthSignIn.ts` と `removeIdentity.test.ts:177,205` の 2 経路に対応 |
| M-65 | 反映済み | 5 か所すべて — 入力 DTO 段落 `spec/usecases/usage.md:173` / 処理フロー手順 1 `:181` / エラーケース表 `:190` / TC `spec/testcases/usage/recalculateStorageUsage.md:13` / 台帳 `spec/inventory/test.md:2174` ＋ `spec/inventory/usecase.md:131`（実質 6 か所）。実装 `recalculateStorageUsage.ts:40-45` の `subjectType === "user" && subjectId !== actorUserId` と一致。手順番号を外部から参照する箇所は 0 件 |
| M-66 | 反映済み | `storeUpload.md:36` と `spec/inventory/test.md:1932` が同文に書き換わり、行は削除されず連番に穴が無い（W-004 は文言の精度の話） |
| M-67 | 反映済み | 4 か所すべて解消。`grep -rn "the spec writes\|the spec's output table\|has no usecase in the spec\|no spec TC\|the spec mandates it unconditionally\|spec の記載漏れ" packages/ apps/` = **0 件**（AC 検査コマンド） |
| M-68 | 反映済み | 対応表に **15 行**追加（要求された 13 件を全数含む: `startOAuthFlow` 1 / `completeOAuthSignIn` 1 / `linkOAuthIdentity` 1 / `completeOAuthCallback` 3 / `addPasswordIdentity` 3 / `getProfile` 3 / `checkHandleAvailability` 1 / `recalculateStorageUsage` 1、＋ `verifyEmail` の一時障害 1 / `completeOAuthCallback` の伝播 1）。ADR 057 の決定に「本文（scenario）由来で手作業再現不能な経路も同じ表に載せる」「行の同一性はユースケース × 条件で決まる（散文から表への組み替えは『増えた』に当たらない）」「`manual-tests/index.md` の集計表も追随対象」の 3 句が入り、`recalculateStorageUsage` の `書き込みの失敗` を足さない判断がこの規則で説明できる。**集計は不変**: `grep -c "^## TC-" spec/manual-tests/account.md` = 42、種別の実測は 正常系 14 / 異常系 24 / 境界値 4、`spec/manual-tests/index.md:30` = `42 \| 14 \| 24 \| 4`、合計行 `319 \| 133 \| 161 \| 25` |
| M-74 | 反映済み | `spec/usecases/identity.md` の `updateProfile` 手順 2 が `linkOAuthIdentity` 手順 3（`:344`）と同じ粒度へ。判定材料が operation ID であること・`releasing` は奪えないことの 2 点とも入り、memory 実装 `identityUniqueDirectory.ts:50-68` およびポート JSDoc `:25`（"by another operation (a lapsed `reserved` row aside)"）と一致 |
| M-76 | 反映済み | `addPasswordIdentity.ts:15` = `UC-identity-013`、`changePassword.ts:26` = `UC-identity-014`。`spec/inventory/usecase.md:25,26` と一致 |
| M-77 | 反映済み | `spec/testcases/identity/requestPasswordReset.md:10` / `spec/inventory/test.md:333` の括弧書き（全称否定）が消え、両者同文 |
| M-78 | 反映済み | `startOAuthFlow.md:5` / `spec/inventory/test.md:405`（`TC-identity-264`）に `state` の返却と ADR 034 の理由が入り両者同文。新規採番なし |
| M-80 | 反映済み | AC-55 / AC-63 / AC-64 の実測が全部一致（下記の AC 検査） |
| M-81 | 反映済み | `spec/inventory/usecase.md:36`（`UC-identity-024`）に `integration` の畳み込みが入り、本文・TC・エラー表と 4 か所そろった |
| M-87 | 反映済み | `spec/testcases/identity/updateProfile.md:27-30` の 4 行、`spec/inventory/test.md:473-476`（`TC-identity-332`〜`335`）、`updateProfile.test.ts:496,508,522` の `it` 名 3 本（`333 / 334` は全形連記）。3 者が同文・実装の `describe("updateProfile avatar URL")` と 1 対 1 |

**反映漏れ 0 / 反映ミス 0 / 新たな矛盾 0。** ただし R2 の中で M-87 だけが `it` 名まで追随させ、M-64 / M-65 は spec 側で止まっているという**扱いの非対称が 1 件**（W-001）。

### 対になる側の 3 者照合（機械検査）

`spec/testcases/*/*.md` 全 146 ファイル × `spec/inventory/test.md` 全 2440 行を、「ユースケース × 前提条件 × 操作」を鍵にした集合比較で突き合わせた（ADR 052 により行順は一致しないので位置ではなく集合で照合）。

- **identity / storage / usage の全ファイルが行数・要素名・期待結果とも完全一致**（本 PR が触った 17 ファイルを含む）
- 不一致は `spec/testcases/{conversion/runConversion,job/listJobs,note/requestBulkExport}.md` の 3 件だけで、いずれも**本 PR が触っていないファイルで 4 列目（実装ステータス）を欠く行がある**という既存の書式ゆれ（例: `listJobs.md:30`）。内容の乖離ではない
- 相対リンクは `spec/` 全体で **全数が解決する**（`]( ../… )` 形式を実ファイルへ解決して存在確認。AC-68 の 2 番目の検査）

### 実行した AC の検査コマンドと結果

| AC | コマンド | 結果 |
| --- | --- | --- |
| AC-64 | `ls spec/testcases/identity/*.md \| wc -l` / `grep -c "^\| UC-identity-" spec/inventory/usecase.md` | **24** / **24** ✅ |
| AC-64 | `spec/inventory/test.md` の TC ID 集合を `origin/main` と差分 | 追加 **32**（`TC-identity-305`〜`335` ＋ `TC-usage-073`）/ 削除 **0**。plan の内訳（getProfile 6 / checkHandleAvailability 8 / completeOAuthCallback 6 / requestPasswordReset 2 / addPasswordIdentity 3 / completeOAuthSignIn 1 / linkOAuthIdentity 1 / updateProfile 4 / recalculateStorageUsage 1）と**完全一致** ✅ |
| AC-64 | `grep -c "^\| TC-identity-" spec/inventory/test.md` | **335**（001〜335 が連番で埋まる。穴なし）✅ |
| AC-55 | `spec/inventory/{domain,adapter,usecase}.md` の ID 集合を `origin/main` と差分 | 追加 **22**（DOM 11 = `common-041,042` / `identity-060`〜`065` / `note-071,072` / `storage-038`、ADP 8、UC 3）/ 削除 **0**。plan の列挙と完全一致 ✅ |
| AC-63 | `git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/` | **35 ファイル = 変更 32 / 削除 3 / 追加 0** ✅ |
| AC-24 | `pnpm test:unit` | **76 files / 925 passed, 3 skipped** ✅ |
| AC-52 | `grep -n "InvalidProvider\b" spec/usecases/identity.md spec/testcases/identity/startOAuthFlow.md` ＋ `spec/inventory/test.md` の該当行 | identity 側 3 か所とも **0 件** ✅ |
| AC-65 | `grep -cF 'ensureAcceptable({ purpose: "source", mimeType, size })' spec/usecases/storage.md` / `grep -c "declaredMimeType" …` / 「宣言サイズと実サイズ」 | **0** / **1**（`startBulkUpload` の `files` 列のみ）/ **0** ✅。(d) `storeUpload` 入力 DTO の `body` 行は `ReadableStream<Uint8Array>` のまま残存 ✅ |
| AC-62 | `grep -c createDownloadUrl spec/domains/storage.md` / `grep -c "workspaceCursor\|nextWorkspaceCursor" spec/usecases/usage.md` / `grep -c next_attempt_at spec/database/index.md` | **3 / 3 / 2**（すべて 1 件以上）✅ |
| AC-67 | `grep -rn 'sha256("removeIdentity' spec/` | **0 件** ✅ |
| AC-61 | `ls spec/adr/05[2-7]-*.md \| wc -l` / ADR 056 の被リンク | **6** / `spec/platform/index.md`・`spec/usecases/storage.md`・`spec/testcases/storage/deleteFilesByOwner.md`（＋台帳）の 3 か所 ✅ |
| AC-68(2) | `spec/` 内の相対リンクを実解決 | **全数が解決** ✅ |
| AC-44 | `grep -n "^## " spec/usecases/identity.md` | 24 節。`getProfile` / `checkHandleAvailability` が `updateProfile` の直後、`completeOAuthCallback` が `completeOAuthSignIn` と `linkOAuthIdentity` のあいだ ✅ |
| AC-45 | `requestPasswordReset` 処理フロー / `addPasswordIdentity` エラー表 / `requestPasswordReset.md:11,12` | 60 秒発行間隔・再認証手順・`USER_NOT_FOUND` / `ACCOUNT_UNAVAILABLE` の 2 行・境界 2 行がすべて存在 ✅ |
| AC-53 | `spec/testcases/storage/deleteFilesByOwner.md:11` | 文の数が消え、観測可能な性質＋ ADR 056 リンクへ ✅ |
| AC-13 / AC-14 / AC-30 / AC-54 | `git diff origin/main...HEAD -- spec/scenario/account.md` ＋ `spec/manual-tests/account.md` | AC-01 の自己矛盾解消・同一ブラウザー条件・AC-02 の異常系 2 行追加・TC-42 の新設と観点チェックリスト登録・TC-26 / TC-13 の期待結果修正がすべて反映 ✅ |
