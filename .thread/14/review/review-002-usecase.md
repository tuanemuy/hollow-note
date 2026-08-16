# レビュー R2 — ユースケース・シナリオ・テストケース

## ユースケース・シナリオ・テストケース

### Blockers

- **[B-001]** `PROVIDER_ACCOUNT_RELEASE_PENDING` を usecase のエラーケースに足したのに、テストケースと台帳へ追随していない
  - 場所: `spec/usecases/identity.md:281`（`completeOAuthSignIn` エラー表）, `spec/usecases/identity.md:349`（`linkOAuthIdentity` エラー節）／欠けている先は `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/inventory/test.md`
  - 理由: R1 の M-05 が「usecase に足したエラー行がテストケースへ未追随」として閉じたのと**まったく同型の残り**。本 PR が AC-43(c) で新設した 2 か所の `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` は実装に実在し（`packages/core/src/application/identity/completeOAuthSignIn.ts:56` の `providerAccountReleasePending`）、自動テストも 2 本が拘束している（`packages/core/src/application/identity/__tests__/removeIdentity.test.ts:177`（`completeOAuthSignIn` 経路）/ `:205`（`linkOAuthIdentity` 経路。どちらも `it` 名に TC ID を持たない）。`spec/inventory/usecase.md:18,19` の UC 要点欄には「別のコードで区別する」まで書き足されているのに、テストケース側にだけ行が無い。「`PROVIDER_ACCOUNT_ALREADY_LINKED` と混同しない」という**本 PR の主眼のひとつ**が、いちばん実装者に届くテストケース表から抜けている
  - 提案: 両ファイルに 1 行ずつ足し（例: 「自分が解除した provider account の claim が解放待ちで残っている ／ 認可コードを交換する ／ `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` が投げられ、他人が持っている `PROVIDER_ACCOUNT_ALREADY_LINKED` とは別のコードである」）、`spec/inventory/test.md` の identity 群末尾に `TC-identity-330` / `331` として採番する（ADR 052 / ADR 016 の末尾採番。既存 ID は動かさない）

- **[B-002]** `recalculateStorageUsage` の実行者一致検査が入力 DTO の段落にだけ書かれ、処理フロー・エラーケース表・テストケース・台帳のどこにも無い
  - 場所: `spec/usecases/usage.md:173`（追加された段落）／欠けている先は同ファイル `:181-183`（処理フロー）、`:187`（エラーケース = `SystemError(DatabaseError)` のみ）、`spec/testcases/usage/recalculateStorageUsage.md`, `spec/inventory/test.md:2160-2167`
  - 理由: 本 PR が足した文は「user 主体の場合は実行者と一致していなければならず、一致しなければ `BusinessRuleError(InsufficientRole)`」と明言しているのに、**同じ節のエラーケース表がそれを載せていない**（節の内部で自己矛盾）。この振る舞いは実装に実在し（`packages/core/src/application/usage/recalculateStorageUsage.ts:40-46`）、自動テストも拘束している（`packages/core/src/application/usage/__tests__/recalculateStorageUsage.test.ts:267`）。認可の拒否条件が本文の説明段落にしか無い状態は、M-28 で「実装ステータスの追認を落として担い手を正典に書く」と決めた向きの片側だけしか完了していないことを意味する。処理フローも手順 1 がいきなり `sumSizeByOwner` から始まり、実装が最初に行う検査を書いていない
  - 提案: (a) 処理フローの先頭に「実行者と主体の対応を検査する（user 主体は実行者と一致必須、workspace 主体は `WorkspaceAuthorization`）」を手順 1 として足し、以降を繰り下げる、(b) エラーケース表を 2 行の表にして `BusinessRuleError(InsufficientRole)` と `SystemError(DatabaseError)` を並べる、(c) `spec/testcases/usage/recalculateStorageUsage.md` に「他人の user 主体を指定して再計算する → `BusinessRuleError(InsufficientRole)`」を足し、`spec/inventory/test.md` の usage 群末尾へ採番する

- **[B-003]** `storeUpload` の入力から宣言サイズを落としたのに、それを前提にしたテストケース行が残っている（spec 内部矛盾の新設）
  - 場所: `spec/testcases/storage/storeUpload.md:36`, `spec/inventory/test.md:1926`（`TC-storage-221`）
  - 理由: 本 PR は AC-65 で `storeUpload` の入力 DTO から `declaredMimeType` / `size` を落とし、処理フロー手順 5 から「宣言サイズと実サイズが食い違う場合は実サイズを採用する」を削除した（`spec/usecases/storage.md:73-96` の差分）。にもかかわらず TC 行「宣言サイズと実サイズが食い違う ／ アップロードする ／ 実サイズが採用される」は残っており、**入力に存在しない値の食い違いを前提にした、成立しえない前提条件**になった。実装にも `declaredMimeType` / 宣言サイズを受ける経路は 1 か所も無い（`grep` で 0 件）。R1 で最も多かった「片側だけ直して対になる側が置き去り」の再発で、しかも `spec/inventory/test.md` は本 PR が編集しているファイルである
  - 提案: TC 行を削除せず（連番に穴を空けない — M-26 と同じ扱い）、「宣言 MIME・宣言サイズを渡す経路が無い ／ アップロードする ／ 保管する型は先頭バイトの署名、サイズは実バイト長から決まる（`AcceptedUpload`）」へ書き換え、`TC-storage-221` の台帳行も同文に追随させる

- **[B-004]** 本 PR が新設した `getProfile` / `checkHandleAvailability` の spec 節とテストケースファイルを、実装側のコメントが名指しで否定したまま残っている
  - 場所: `packages/core/src/application/identity/getProfile.ts:11`（"A read of one's own profile **has no usecase in the spec**"）, `packages/core/src/application/identity/__tests__/getProfile.test.ts:17`（"It **has no spec TC of its own**"）, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts:12`（同上）, `apps/web/app/components/settings/ProfileForm/action.ts:4`（"UC-identity-017 の対になる読み side" — 現在は `UC-identity-022` が実在する）
  - 理由: 本 PR は `spec/usecases/identity.md` に `## getProfile` / `## checkHandleAvailability` を新設し、`spec/testcases/identity/{getProfile,checkHandleAvailability}.md` を新規作成し、`spec/inventory/usecase.md` に `UC-identity-022` / `023` を、`spec/inventory/test.md` に TC 行 14 本を採番した。**その結果、4 か所のコメントが「spec には無い」と断言する状態が新たに生まれた。** AC-67 と R1 の M-02 が閉じたのはまさに「実装が spec を名指しで否定している状態」であり（`uniqueness.ts` / `removeIdentity.ts` / `view.ts` の 3 ファイルは正しく直っている）、同じ判断を同じ PR 内の別ファイルに適用していない。次に読む人は「spec に無いと書いてあるが 3 か所に定義がある」に当たる
  - 提案: U7 と同じ扱い（コメント・JSDoc の文字列のみ変更、式は 1 文字も触らない）で 4 か所を直す。`getProfile.ts` は「`updateProfile` の対になる読み専用ユースケース（UC-identity-022, spec/usecases/identity.md#getprofile）」へ、2 本のテストの冒頭コメントは「spec TC が無い」の一文を落として拘束内容の記述だけを残す、`ProfileForm/action.ts` は `UC-identity-022` を指す。AC-63 のコード差分件数は M-61 と同じ扱いで実測へ改める

- **[B-005]** ADR 057 が定めた「usecase のエラーケースが増えたら手順書のカバレッジ表に行を足す」を、その ADR を新設した本 PR 自身が守っていない
  - 場所: `spec/manual-tests/account.md:535-581`（`### ユースケースエラーケース対応表`。増えた 1 行は `:551`）／根拠は `spec/adr/057-manual-test-followthrough.md:30-33`
  - 理由: 本 PR は `spec/usecases/identity.md` / `usage.md` に**新規のエラーケースを 10 行以上**足している — `startOAuthFlow` の `UnauthorizedError("UNAUTHENTICATED")`、`completeOAuthSignIn` / `linkOAuthIdentity` の `PROVIDER_ACCOUNT_RELEASE_PENDING`、`addPasswordIdentity` の 3 行、新設 3 ユースケース（`getProfile` 3 行 / `checkHandleAvailability` 1 行 / `completeOAuthCallback` 2 行）、`recalculateStorageUsage` の `InsufficientRole`。対応表に増えた行は **1 行だけ**（`verifyEmail | 一時障害（再試行導線） | 対象外`）で、しかもその 1 行は usecase のエラーケース表に無い項目（P-03 の状態）である。すなわち**表の軸に載るべきものが 0 件追随し、軸に載らないものが 1 件だけ載った**。M-17（「ADR 057 を新設した PR がその ADR を破っている」）と同じ形の再発で、追随先が集計行から対応表本体へ移っただけである。あわせて、同じ AC-15 由来の 2 状態のうち「一時障害」は対応表に、「別ブラウザー」は観点チェックリストに、と非対称に振り分けられており、`verifyEmail` の担保状況を対応表からは読み取れない（TC-42 が存在するのに表に現れない）
  - 提案: 上記の新規エラーケースを対応表に追加する。UI から再現できないもの（`getProfile` の `PendingUser` / `DeletingUser`、`RELEASE_PENDING` の収束待ち、`InsufficientRole` など）は既存様式どおり `対象外` と理由 1 行でよい。あわせて「一時障害」行は軸が違うので観点側へ移すか、ADR 057 の決定に「本文（scenario）由来で手作業再現不能な経路も対応表に `対象外` として残す」を明記して軸を広げる（どちらでもよいが、表と ADR の言うことを一致させる）

### Warnings

- **[W-001]** `addPasswordIdentity` と `changePassword` の JSDoc が名乗る UC ID が台帳と入れ替わっている
  - 場所: `packages/core/src/application/identity/addPasswordIdentity.ts:15`（`UC-identity-014`）, `packages/core/src/application/identity/changePassword.ts:26`（`UC-identity-013`）／台帳は `spec/inventory/usecase.md:26,27`（`013` = `addPasswordIdentity`, `014` = `changePassword`）
  - 理由: 本 PR 由来ではない既存の取り違えだが、本 PR は `UC-identity-013` の要点欄を再認証の記述で書き換えており（AC-56）、その ID を名乗るファイルが `changePassword.ts` である状態が残る。ADR 052 が規範化した「ID は識別子であって行位置ではない」を前提にすると、ID を名乗る側が間違っていることの害は台帳の並び順より大きい
  - 提案: 2 か所の ID を入れ替える（コメント文字列のみ）。本 PR の枠に入れないなら、Phase 5 の起票（`spec/inventory/` 周りの項目）に 1 行として相乗りさせる

- **[W-002]** `TC-identity-192` の期待結果に、そのテストケースからは観測できない全称否定が入っている
  - 場所: `spec/testcases/identity/requestPasswordReset.md:10`, `spec/inventory/test.md:333`（「…成功として返る（**絞りはこの発行間隔ひとつだけ**）」）
  - 理由: M-26 のトリアージが要求したのは「`:10` を『60 秒の発行間隔に掛かり…』と書き換える」ところまでで、括弧内の一文は**指摘（「存在しない第 2 の絞りがあるかのように読める」）への回答**が期待結果欄に残った形である。「絞りが 1 つしかない」は 1 回の要求から観測できず、判定基準にならない。同じ事実は `spec/usecases/identity.md` の処理フローとエラーケース表が既に定めている
  - 提案: 括弧を落として「60 秒の発行間隔に掛かり、新しいトークンは発行されず、メールも送られず成功として返る」で止める

- **[W-003]** `startOAuthFlow` の出力 DTO に `state` を足したのに、テストケース行が応答の `state` に触れていない
  - 場所: `spec/usecases/identity.md:218`（出力 DTO に `state: string` を追加）／`spec/testcases/identity/startOAuthFlow.md:5`, `spec/inventory/test.md:405`（`TC-identity-264`）は「認可 URL が返り、`state` と `codeVerifier` が 10 分の期限で**保存される**」のまま
  - 理由: 露出の目的は「転送境界がプロバイダーの URL を再パースせずにフローを開始したブラウザーへ束縛する」（ADR 034）というセキュリティ上の要件で、`spec/inventory/usecase.md:17` の UC 要点欄には追随済み。自動テストは既に応答値を拘束している（`packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts:35` の `expect(view.state).toBe(state)`）のに、テストケース表だけが「保存される」しか言わない。M-25（`startOAuthFlow` の TC 行の粒度をそろえた指摘）と同じファイル・同じ理由の残り
  - 提案: `TC-identity-264` の期待結果に「応答の `state` は認可 URL の `state` と同じ値である（転送境界がブラウザーへ束縛するため）」を追記する（新規採番は不要）

### カバレッジ

- 確認: `.thread/14/plan.md`, `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md`, `spec/testcases/identity/addPasswordIdentity.md`, `spec/testcases/identity/checkHandleAvailability.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/deleteAccount.md`, `spec/testcases/identity/getProfile.md`, `spec/testcases/identity/requestPasswordReset.md`, `spec/testcases/identity/signUpWithPassword.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/testcases/storage/deleteFilesByOwner.md`, `spec/scenario/account.md`, `spec/manual-tests/account.md`, `spec/manual-tests/index.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/adr/057-manual-test-followthrough.md`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/removeIdentity.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`（25 件）
- スキップ: `.thread/14/review/` 配下 8 件 — レビュー中間成果物（`triage.md` は既出判定として参照のみ）
- スキップ: `.thread/14/{adr,research,research-2,steps,testing}.md` 5 件 — 作業台帳・手順書で、ユースケース仕様の正典ではない（general 観点の担当）
- スキップ: `.dockerignore`, `CLAUDE.md`, `README.md`, `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example` 6 件 — リポジトリ構成・ランタイム残骸の整理で、ユースケース仕様に触れない
- スキップ: `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/start.ts` 4 件 — 転送境界のコメント修正（presentation 観点の担当）
- スキップ: `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md` 2 件 — 実装例ドキュメント（docs 観点の担当）
- スキップ: `packages/core/src/adapters/conformance/` 配下 7 件 — 適合スイートの ADP ID 命名（inventory / domain 観点の担当）
- スキップ: `packages/core/src/application/di/containerStore.ts` 1 件 — DI のエラーメッセージ文字列で、ユースケースの手順・DTO に触れない
- スキップ: `packages/core/src/application/ports/{accountDeletionManifestStore,scopeCleanupAdmissionStore,shareTokenProtector}.ts` 3 件 — ポート契約の JSDoc（domain 観点の担当）
- スキップ: `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/storage/errorCode.ts` 4 件 — ドメイン層の語彙・ポート契約（domain 観点の担当）
- スキップ: `spec/adr/052`〜`056` と `spec/adr/index.md` 6 件 — 設計判断の記録（docs 観点の担当。057 のみ手順書追随規則の正典として確認した）
- スキップ: `spec/database/index.md` 1 件 — 表・索引の設計（domain 観点の担当）
- スキップ: `spec/domains/{identity,index,note,storage,usage}.md` 5 件 — ドメイン契約とポート定義（domain 観点の担当。`resolve` / `AccountDeletionRetryPolicy` の契約はユースケース側の整合確認のため参照のみ）
- スキップ: `spec/inventory/{adapter,domain,frontend}.md` 3 件 — ADP / DOM / PAGE 台帳（inventory 観点の担当）
- スキップ: `spec/pages/index.md`, `spec/platform/index.md`, `spec/presentation/index.md` 3 件 — 画面・実行基盤・転送境界（presentation 観点の担当）

（確認 25 + スキップ 58 = 83）

### 1 回目の修正の検証結果

| Key | 判定 | 根拠 |
| --- | --- | --- |
| M-03 `requestPasswordReset` の発行間隔を UoW 内へ | 正しく入っていた | `spec/usecases/identity.md:457` が `findPendingByUserAndPurpose` / `deleteByUserAndPurpose` / `AuthToken.issue` を同一 transaction にまとめ、実装 `requestPasswordReset.ts:82-113` と一致。**手順は 4 本になったが、この節の手順番号を外部から参照している箇所は spec 全域に 0 件**（`grep "手順 [0-9]"` で確認。identity 内の手順参照は `signUpWithPassword` 4/9、`verifyEmail` 3/6、`resetPassword` 5、`completeOAuthCallback` 2、`removeIdentity` 3 のみで、いずれも参照先が実在する） |
| M-04 manual TC-26 | 正しく入っていた | 手順 1/2 とも「開いて送信する」／「期限切れか使用済みかは出し分けない」で、実装 `ResetPasswordPanel/index.tsx:212-234`（`tokenInvalid` の単一文言 + 「再設定を申請し直す」導線）と一致 |
| M-05 `addPasswordIdentity` のエラー 3 行 | 正しく入っていた | `TC-identity-323/324/325` として採番。`324` / `325` は実装 `addPasswordIdentity.ts:47-56` に実在。先頭行の前提も「再認証を済ませている」へ追随 |
| M-24 `completeOAuthCallback` の `integration` arm | 正しく入っていた | 手順 3・エラー表・TC-identity-328 の 3 か所に入り、実装 `completeOAuthCallback.ts:53-56` と `__tests__/completeOAuthCallback.test.ts:132` と一致 |
| M-26 `requestPasswordReset` の重複行と境界前提 | 正しく入っていた | `TC-identity-192` を書き換え（削除せず連番を維持）、`193` に「発行から 60 秒以上経過している」を付与。境界 2 行は `321` / `322` |
| M-27 `checkHandleAvailability` の 2 行 | 正しく入っていた | `TC-identity-326`（正規化）/ `327`（`releasing`）が `__tests__/checkHandleAvailability.test.ts:56,68` と 1 対 1 |
| M-28 `recalculateStorageUsage` の「未実施」 | 正しく入っていた | 実装ステータスの追認は消え、担い手（`WorkspaceAuthorization`）だけが正典として残った。**ただし同じ追記が処理フロー・エラー表・TC へ波及していない → B-002** |
| M-30 `getProfile` の前提条件と初期値行 | 正しく入っていた | `:6` の前提が「パスワード認証手段を持つ `ActiveUser`」になり、初期値行が `TC-identity-329` として追加。`__tests__/getProfile.test.ts:57-68` と一致 |
| M-31 `provider` の役割 | 正しく入っていた | spec の入力 DTO が「state に保存された provider との照合に使う（手順 2）」へ、実装 JSDoc も `completeOAuthCallback.ts:10-11` で照合の記述に差し替わり、`flow.provider !== input.provider` と整合 |
| 新規採番 `TC-identity-323`〜`329` | 1 対 1 で成立 | 7 行が `addPasswordIdentity` 3 / `checkHandleAvailability` 2 / `completeOAuthCallback` 1 / `getProfile` 1 に対応し、テストケースファイルの行数と台帳行数も全 24 ファイルで一致（実測）。`323`（`REAUTHENTICATION_REQUIRED`）だけが未実装の spec 正典だが、これは ADR-022 と M-06 の defer に沿う扱い |
| `terminal 行` の語彙 | そろっている | `spec/domains/identity.md:350-360` / `spec/usecases/identity.md:770,814` / `spec/testcases/identity/deleteAccount.md:18` / `spec/inventory/{domain,test}.md` が「保持中の terminal 行（`completed` / `rejected`）・120 日の窓・8 件」で一致し、memory 実装 `distributedOperationStore.ts:67-77` の `terminalAt !== null` と整合 |
| M-01 / M-15 / M-17 / M-47（担当範囲の波及分） | 正しく入っていた | identity 側の `ExternalServiceError` は 0 件。担当 25 ファイルの相対リンクはすべて実解決を確認。`manual-tests/index.md` の 42 / 14 / 24 / 4 は `grep -c "^## TC-"` と `**種別**` の実測と一致。改訂履歴の残置（`spec/usecases/storage.md` / `deleteFilesByOwner.md` / `inventory/test.md`）は 3 か所とも消えている |
| M-02（担当範囲での同型） | **不完全** | 指定された `uniqueness.ts` / `removeIdentity.ts` / `view.ts` は正しく直っているが、同じ「実装が spec を名指しで否定する」記述が 4 か所残った → B-004 |

**集計: 正しく入っていた 12 / 不完全 1 / 退行を生んだ 0**

退行（R1 の修正が新たに壊したもの）は無い。B-001 / B-003 / B-005 は R1 で検出されなかった**本 PR 由来の未追随**、B-002 は R1 の修正が片側にとどまったものである。
