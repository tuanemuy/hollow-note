# ユースケース・シナリオ・テストケース

対象: PR #22（ベース `main`）。観点は `spec/usecases/*.md` / `spec/scenario/account.md` / `spec/testcases/**` / `spec/manual-tests/account.md` と `packages/core/src/application/` 実装の一致。判定規則は `spec/adr/046-port-contract-divergence.md`。

## Blockers

- **[B-001]** `requestPasswordReset` の発行間隔判定を UoW の**外**の独立手順として書いてしまっている。実装はこれを意図的に UoW の**内**に置いている
  - 場所: `spec/usecases/identity.md:456-458`（手順 3 / 4 / 5）／実装 `packages/core/src/application/identity/requestPasswordReset.ts:81-113`
  - 理由: 実装は `findPendingByUserAndPurpose` を `globalUnitOfWorkProvider.run` の中で、User の status/epoch 再検査・`deleteByUserAndPurpose`・`AuthToken.issue` と同じ transaction に入れている。同ファイルの JSDoc（`:28-32`）は「the status/epoch re-check, **the interval read**, the removal of the superseded token, and the new one land together … splitting these would let a concurrent request leave two」と、同居が意図であることを明示している。改訂後の spec は間隔判定を手順 3 として UoW（手順 5）より前に置き、しかも手順 5 の「同じ transaction で保存する」列挙に間隔判定を含めていない。この spec だけを読んで別バックエンドを実装すると、判定を transaction 外で行い、並行要求が 60 秒の間隔制限をすり抜けて再設定メールを 2 通出す形になる（`spec/adr/046` の「JSDoc（＝この場合は spec）が実装より弱い」乖離を新設している）
  - 提案: 手順 3 を独立させず、手順 5（UoW）の内側に畳む。例: 「5. UserId shard UoW で `ActiveUser` と current epoch を再検査し、**同じ transaction で `findPendingByUserAndPurpose` を引いて発行から 60 秒未満なら新規発行せず成功として返す**。そうでなければ既存 token 削除と `AuthToken.issue(purpose: "password_reset")` を同じ transaction で保存する」。手順 4 の削除は既に手順 5 が transaction 内と再宣言しているので、間隔判定だけが宙に浮いている状態を解消する

- **[B-002]** manual TC-26 の手順 1 が、実装・`spec/scenario/account.md` AC-05・`spec/pages/index.md` P-04 のいずれも畳んでいる「期限切れ / 無効」の区別を期待結果として要求している（受け入れ基準 AC-54 の指定文言とも不一致）
  - 場所: `spec/manual-tests/account.md:346`（手順 1）／同 `:347`（手順 2）／同 `:565`（カバレッジ表）
  - 理由: 実装 `apps/web/app/components/auth/ResetPasswordPanel/index.tsx:210-215` は `IDENTITY_TOKEN_EXPIRED` / `AUTH_TOKEN_NOT_FOUND` / `AUTH_TOKEN_ALREADY_CONSUMED` を 1 つの `tokenInvalid` 状態へ収斂させ、表示は「この再設定リンクは使えません／期限が切れているか、すでに使われています。」の**1 文言のみ**（コード中コメントも「すべて『このリンクはもう使えない』に収斂する」と明記）。`spec/pages/index.md:188` の P-04 状態も「トークン無効・期限切れ（再申請へ）」の 1 状態、`spec/scenario/account.md:104` の AC-05 も「有効期限切れ・使用済み・改ざんの場合は、無効である旨と再申請の導線を表示する」で 1 つ、同ファイル `:565` のカバレッジ行も `resetPassword | 期限切れ・使用済み | TC-26` と 1 行に畳んでいる。手順 1 と手順 2 が同一の画面出力に対して異なる期待結果を掲げており、手順書として判定不能。plan の AC-54 も期待結果を「送信が拒否され、**リンクが無効である旨**と再申請への導線が出る」と指定しており、手順 1 はこれを満たしていない
  - 提案: 手順 1 の期待結果を手順 2 と同じ「送信が拒否され、リンクが無効である旨（期限切れか使用済みかは出し分けない）と再申請への導線が出る」に揃える。区別を出したいのであれば実装・P-04・AC-05 を先に変える話であり、本 PR（振る舞いを変えない同期）のスコープ外

- **[B-003]** `addPasswordIdentity` のエラーケース表に 3 行を新設しながら、対の `spec/testcases/identity/addPasswordIdentity.md` に 1 行も追随させていない。うち 2 行は**実装済み**の振る舞いで、しかも先頭行が新設した手順 1 と矛盾する
  - 場所: `spec/usecases/identity.md:515,523-525`（追加した手順 1 とエラー 3 行）／`spec/testcases/identity/addPasswordIdentity.md:5-11`（無改訂）
  - 理由: 追加された 3 行のうち `NotFoundError("USER_NOT_FOUND")` と `ValidationError("ACCOUNT_UNAVAILABLE")` は `packages/core/src/application/identity/addPasswordIdentity.ts:47-56` に実在する。実装済みの振る舞いにテストケースが 1 行も無い状態を新たに作っている。同じ PR は `startOAuthFlow`（`InvalidProviderAccount`）と `signUpWithPassword`（`EMAIL_ALREADY_USED` の畳み込み）については usecase 側の改訂をテストケース側へ追随させており、`addPasswordIdentity` だけ追随が抜けている。さらにテストケース先頭行「Google のみで登録した利用者 | パスワードを追加する | `PasswordIdentity` が作られ…」は、新手順 1（再認証済みであることが前提）と前提条件が食い違う
  - 提案: `spec/testcases/identity/addPasswordIdentity.md` に (a) 利用者が不在 → `NotFoundError("USER_NOT_FOUND")`、(b) `DeletingUser` → `ValidationError("ACCOUNT_UNAVAILABLE")`、(c) 再認証が未了 → `ValidationError("REAUTHENTICATION_REQUIRED")` の 3 行を足し、先頭行の前提条件に「再認証が済んでいる」を加える。TC 行は `spec/inventory/test.md` の identity 群末尾（`TC-identity-323` 以降）へ採番する（本 PR が確立した ADR 052 / ADR 016 の規則どおり）

- **[B-004]** `ValidationError("REAUTHENTICATION_REQUIRED")` が spec だけの造語のまま置かれている。plan がその根拠にしたフォローアップ Issue が**1 本も起票されていない**
  - 場所: `spec/usecases/identity.md:515,525` / `spec/inventory/usecase.md:23`（UC-identity-013）
  - 理由: `grep -rn REAUTHENTICATION_REQUIRED spec/ packages/ apps/` の実装側ヒットは 0 件。plan は「spec が正・実装が未対応」として Phase 5 のフォローアップ Issue（スコープ節の 5.「`addPasswordIdentity` に Google 再認可を実装する」）へ送る前提で AC-45 を書き、AC-23 / AC-60 でその起票を受け入れ条件にしている。しかし `gh issue list --state all` の最大番号は **#21**（本 PR が #22）で、AC-23 の 4 本・AC-60 の 3 本のいずれも存在しない。`spec/adr/046` は「乖離は『見つけたら倒す』対象になり、記録して先送りする選択肢を残さない」と決定しており、追跡先の無い spec 専用コードはこの決定に反する。加えて手順 1 は「再認証（Google 再認可）が済んでいることを確認する」としか書いておらず、**どのポート・どの状態で「済んでいる」を持つか**（flow state の項目か、別のセッション属性か、TTL は何か）が無いため、この 1 文からは実装に到達できない
  - 提案: (a) Phase 5 の Issue（少なくとも `addPasswordIdentity` の Google 再認可の 1 本）を起票し、`spec/usecases/identity.md:515` の該当箇所から Issue 番号を参照する。(b) 手順 1 に「再認証済みであることの保持方法は未決定で、`startOAuthFlow` の intent と `spec/adr/034` / `035` の束縛に触れるため別スライスで決める」旨を 1 文添え、いま実装に到達できないことを spec 自身が言う形にする

- **[B-005]** 本 PR が spec 側を直した 3 項目について、コード側の JSDoc が「spec はこう書いている」と**改訂前の spec を名指しで否定したまま**残っている
  - 場所: `packages/core/src/application/identity/removeIdentity.ts:19-21`（"the spec writes `sha256("removeIdentity:" + identityId)`"）／`packages/core/src/application/identity/uniqueness.ts:63`（"the spec writes `sha256(parent + ":" + ...)`"）／`packages/core/src/application/identity/view.ts:17-21`（"the spec's output table types it as non-null, which cannot represent that path"）
  - 理由: 本 PR は `spec/usecases/identity.md:524`（`removeIdentity` 手順 3）と `:27`（reservation sub-operation ID）を合成形へ、`:101`（`verifyEmail` 出力 DTO の `sessionToken`）を `string | null` へ改訂済み（`grep -rn 'sha256("removeIdentity' spec/` は 0 件）。3 つの JSDoc はいま**事実として誤り**で、読んだ人を存在しない spec 記述へ誘導する。plan の AC-67 は「実装 `removeIdentity.ts:20-30` が spec を名指しで否定している状態を解消する」を目的として掲げており、spec 側だけを直した現状はこの目的の半分しか満たしていない（否定の向きが逆転しただけ）。同じ PR は同種の記述（`domain/identity/errorCode.ts` / `domain/storage/errorCode.ts` の「spec の記載漏れ」コメント）を AC-58 で削除しており、扱いが不整合
  - 提案: 3 か所の「spec は〜と書いている」節を落とす。`removeIdentity.ts` / `uniqueness.ts` は「合成で決定性と識別性が得られ、不可逆性は要らない（`spec/adr/048`）」だけを残せば足りる。`view.ts` は「`alreadyVerified` 経路ではセッションを発行しない」だけを残す。AC-63 の「コード差分 9 ファイル」に収まらないので、AC-63 の件数を 12 に更新するか、この 3 ファイルだけを別コミットに切ること

## Warnings

- **[W-001]** 新設した `completeOAuthCallback` 節が、実装と自動テストに存在する `intent: "integration"` の分岐を扱っていない
  - 場所: `spec/usecases/identity.md:284-321`（処理フロー 手順 3 とエラーケース表 `:319-321`）／`spec/testcases/identity/completeOAuthCallback.md:5-9`
  - 理由: 実装 `packages/core/src/application/identity/completeOAuthCallback.ts:52-56` は `integration` arm を `oauthStateInvalid()` で明示的に落としており、自動テスト `__tests__/completeOAuthCallback.test.ts:132`（"refuses an integration state, which no usecase of this slice may run"）が拘束している。spec の手順 3 は「`signIn` は〜、`linkIdentity` は〜」の 2 分岐しか書かず、エラー表にも該当行が無い。判別共用体の網羅性が spec から読めない
  - 提案: 手順 3 に「`integration` は本スライスに受け皿が無いため state を無効として扱う（外部連携スライスが arm を足す）」を足し、エラー表に 1 行、テストケースファイルにも 1 行足す

- **[W-002]** `startOAuthFlow` テストケースの「削除開始済みまたは削除済み」行だけ、期待結果がエラーコードを名指ししない曖昧な文のまま残っている
  - 場所: `spec/testcases/identity/startOAuthFlow.md:7`
  - 理由: 本 PR は同じ表の `:9` を `BusinessRuleError(InvalidProvider)` → `InvalidProviderAccount` へ直し、`spec/usecases/identity.md:236` のエラー表にも `UnauthorizedError("UNAUTHENTICATED")` の行を新設した。にもかかわらず対応するテストケース行は「OAuth stateを作らず、認証済み利用者として扱わない」のままで、同じ表の他行（`USER_REQUIRED` / `INVALID_REDIRECT` はコード名を書く）と粒度が揃わない。実装 `startOAuthFlow.ts:66-70` と自動テスト `__tests__/startOAuthFlow.test.ts:79,92`（`isUnauthorizedError`）は明確に `UnauthorizedError` を返す
  - 提案: 期待結果を「OAuth state を作らず `UnauthorizedError("UNAUTHENTICATED")` が投げられる」に改める（`spec/inventory/test.md` の TC-identity-266 行も追随）

- **[W-003]** `requestPasswordReset` のテストケース表に、同じ振る舞いを指す行が 2 つ並び、境界の明示されない行が 1 つ残った
  - 場所: `spec/testcases/identity/requestPasswordReset.md:10`（既存「レート制限がかかり…」）／`:11`（新設 59 秒）／`:13`（既存「既存の再設定トークンが未消費で残っている」）
  - 理由: 実装 `requestPasswordReset.ts` にレート制限は 60 秒の発行間隔（`REQUEST_INTERVAL_MS`）**1 つだけ**で、自動テスト `TC-identity-192`（"throttles a second request inside the interval"）は 59 秒進めて検証しており、`:10` と `:11` は同じ `it` を指す。`:10` の「レート制限がかかり」は、存在しない第 2 の絞りがあるかのように読める。また `:13` は 60 秒以内には成立しない（対応する `TC-identity-193` は 61 秒進めてから再要求する）のに経過時間の前提が無い。AC-45 は「`resendVerificationEmail.md` の既存 2 行と同じ粒度」を求めているが、当の `resendVerificationEmail.md` には汎用の「レート制限」行が無く、対応が取れていない
  - 提案: `:10` を削除して `:11` / `:12` に一本化し、`:13` の前提条件を「既存の再設定トークンが未消費で残っており、発行から 60 秒以上経過している」に改める（`spec/inventory/test.md` の TC 行も追随）

- **[W-004]** `checkHandleAvailability` のテストケースが、実装と自動テストが持つ 2 つの振る舞いを落としている
  - 場所: `spec/testcases/identity/checkHandleAvailability.md:5-10`
  - 理由: (a) 自動テスト `__tests__/checkHandleAvailability.test.ts:56`（"separates one's own handle from a free one, **normalizing the input first**"）が `Handle.create` による正規化を経て自分のものと判定することを拘束しているが、表に行が無い。(b) 同 `:68`（"answers free for a claim being **torn down**"）は `releasing` 状態の claim を空きと読む振る舞いだが、表の `:8` は `reserved`（予約しただけ）しか書いていない。`releasing` を `null` として返すのは本 PR が AC-31 で `spec/domains/identity.md` に明文化した `resolve` の契約そのもので、それを検証する行がテストケース側に無い
  - 提案: 「大文字小文字の異なる自分のハンドル → 正規化して `ownedBySelf: true`」と「解除待ち（`releasing`）の claim → 空きとして返る」の 2 行を足す

- **[W-005]** `recalculateStorageUsage` の workspace 認可の欠落を「未実施」として spec に書き込み、追跡先を持たせていない
  - 場所: `spec/usecases/usage.md:173`（新設段落の末尾）／実装 `packages/core/src/application/usage/recalculateStorageUsage.ts:40-46`
  - 理由: 実装は `subjectType === "user"` のときだけ実行者一致を検査し、workspace 主体は誰でも通る。通れば任意 workspace の `consumedBytes` / `noteCount` を読み出して quota 行を上書きできる。同じスライスの `storeAvatar.ts:71`（`packages/core/src/application/storage/storeAvatar.ts`）は同じ「`WorkspaceAuthorization` が無い」状況を **fail-closed**（workspace 主体は一律 `InsufficientRole`）で扱っており、2 つのユースケースで縮退の向きが逆になっている。`spec/adr/046` は「記録して放置する」を明示的に否定した代替案として挙げている。現時点で server function からは呼ばれていない（`grep -rn recalculateStorageUsage apps/web/app` が 0 件）ので実害は無いが、この段落が「未実施でよい」の根拠として次のスライスに読まれる形になっている
  - 提案: 段落末を「workspace 主体は `WorkspaceAuthorization` が入るまで受け付けない（`storeAvatar` と同じく `BusinessRuleError(InsufficientRole)` で倒す）」に変えるか、そのままにするなら Issue #3（ワークスペース）へのコメント参照を 1 つ添えて追跡先を明示する

- **[W-006]** 改訂した TC-storage-043 に対応する `it` が 2 本あり、うち片方の主張が改訂後の行と対応しなくなった
  - 場所: `spec/testcases/storage/deleteFilesByOwner.md:11`／`packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts:252,358`
  - 理由: `:358` の `it("TC-storage-043 (without the statement-count promise): one turn enumerates once and emits one event per file …")` が改訂後の行と一致する一方、`:252` の `it("TC-storage-043: a batchSize above the ceiling is clamped, so one turn never emits more than 100 events")` が主張する clamping は、改訂で行から消えた（`batchSize` の上限としての位置づけは `spec/usecases/storage.md:500` へ移った）。同じ TC ID を名乗る 2 本のうち片方が台帳の行を指さない状態が残る
  - 提案: `:252` の `it` 名から `TC-storage-043:` を外す（clamping は `spec/usecases/storage.md` の記述に紐づく実装ディテール）か、テストケース表に clamping の行を別途採番して足す

- **[W-007]** ADR 057 の代替案節に、レビューの経緯が 1 文残っている
  - 場所: `spec/adr/057-manual-test-followthrough.md:38`（「…同じ論点が次のレビューで再燃する。**実際にそれが起きた。**」）
  - 理由: ADR は長寿命の設計判断を残す文書で、「この計画のレビューで実際に起きた」は本 Issue に閉じた経緯。他の 5 本（052〜056）には同種の記述が無く、様式が揃っていない
  - 提案: 「実際にそれが起きた。」を削除する（前文の「再燃する」で理由は成立している）

- **[W-008]** 新設 `getProfile` テストケースの網羅と前提条件が甘い
  - 場所: `spec/testcases/identity/getProfile.md:5-9`
  - 理由: (a) `:6` の前提条件が `—` だが、「応答に秘匿値が含まれない」は主体の存在を前提とする観測なので、`—` では実行できない。(b) 自動テスト `__tests__/getProfile.test.ts:57`（"answers a profile that was never edited with the sign-up defaults"）が拘束している初期値（`bio` は空文字列、`handle` / `avatarUrl` は `null`）の行が無い。`getProfile` は `bio` を射影する唯一の経路なので、この初期値は仕様として押さえておきたい
  - 提案: `:6` の前提条件を「`ActiveUser` が自分のプロフィールを持つ」に改め、「一度も編集していない利用者 → `bio` は空文字列、`handle` / `avatarUrl` は `null` が返る」の行を足す

- **[W-009]** `completeOAuthCallback` の入力 DTO で `provider` を「表示・ログ専用」と説明しているが、実際は state 照合の入力である
  - 場所: `spec/usecases/identity.md:294`（入力 DTO 表のバリデーション欄）／実装 `packages/core/src/application/identity/completeOAuthCallback.ts:32`
  - 理由: 同じ節の処理フロー手順 2（`:317`）が「経路の `:provider` が state に保存されたものと一致しなければ state を無効として扱う」と書いており、`provider` は照合に使われる。実装も `flow.provider !== input.provider` で比較する。「表示・ログ専用」は同一節の中で自己矛盾しており、しかも読み手に「照合しなくてよい」と読ませうるセキュリティ上意味のある取り違えになる（実装 JSDoc `:10` も同じ誤記を持つ）
  - 提案: 「経路のパスパラメーター。state に保存された provider との照合に使う」に改める

## カバレッジ

一覧 52 件と 1 対 1（確認 21 / スキップ 31）。

### 確認

- `.thread/14/plan.md` — 受け入れ基準の契約として通読（AC-10 / 12 / 13 / 14 / 43〜48 / 52〜54 / 56 / 64 / 65 / 67 を本観点で検証）
- `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md`
- `spec/scenario/account.md`
- `spec/manual-tests/account.md`
- `spec/testcases/identity/checkHandleAvailability.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/getProfile.md`, `spec/testcases/identity/requestPasswordReset.md`, `spec/testcases/identity/signUpWithPassword.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/testcases/storage/deleteFilesByOwner.md`
- `spec/inventory/test.md`, `spec/inventory/usecase.md` — 新設 3 ユースケース / 改訂 4 テストケースの TC・UC 行が本文と一致するかの範囲でのみ確認（採番規則の妥当性は inventory 観点）
- `spec/platform/index.md` — AC-53 で TC-storage-043 から移した設計目標段落の移設先として確認
- `spec/adr/057-manual-test-followthrough.md` — TC-42 追加の根拠として通読（W-007）
- `spec/adr/056-performance-budget-placement.md` — TC-storage-043 改訂の根拠として確認（3 か所からのリンク実在も確認）
- `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/055-session-expiry-derivation.md` — `deleteAccount` rollback 手順と `verifyEmail` / `signInWithPassword` 手順 7 / 8 の根拠として参照
- `packages/core/src/domain/identity/errorCode.ts` — `REAUTHENTICATION_REQUIRED` / `InvalidProviderAccount` / `InvalidHandle` / `HandleReserved` の実在確認（B-004 / W-002 / 新設テストケース）

差分外で読んだ実装・自動テスト: `packages/core/src/application/identity/{getProfile,checkHandleAvailability,completeOAuthCallback,addPasswordIdentity,requestPasswordReset,signUpWithPassword,startOAuthFlow,completeOAuthSignIn,linkOAuthIdentity,removeIdentity,uniqueness,view}.ts`、`packages/core/src/application/usage/{recalculateStorageUsage,deleteQuota,view}.ts`、`packages/core/src/application/storage/{deleteFilesByOwner,storeAvatar}.ts`、`packages/core/src/application/identity/deleteAccount/input.ts`、対応する `__tests__/`、`apps/web/app/routes/auth/-action.tsx`、`apps/web/app/components/auth/{ResetPasswordPanel,VerifyEmailPanel}/`、`apps/web/app/components/settings/IdentityList/board.tsx`。

### スキップ

- `.thread/14/adr.md`, `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md` — 計画側の台帳・作業記録で、spec の正本ではない（5 件）
- `CLAUDE.md`, `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md` — 開発ガイドの同期。docs 観点（4 件）
- `apps/web/app/start.ts` — CSRF ミドルウェアのコメント差し替え。presentation 観点（1 件）
- `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts` — 適合スイートの 1 主張追加。アダプター / inventory 観点（1 件）
- `packages/core/src/application/di/containerStore.ts` — 実在しないランタイム entry 名の除去のみ。ユースケースの入出力に触れない（1 件）
- `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/ports/shareTokenProtector.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/domain/storage/errorCode.ts` — ポート契約とドメインのエラー語彙。ドメイン観点（5 件）
- `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`, `spec/database/index.md` — ポート interface とテーブル定義。ドメイン観点（本観点からは `AuthTokenRepository.findPendingByUserAndPurpose` と `resolve` の契約を参照したのみ）（6 件）
- `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/frontend.md` — ADP / DOM / PAGE 行の採番と追随。inventory 観点（3 件）
- `spec/pages/index.md`, `spec/presentation/index.md` — 画面状態と転送境界の規約。presentation 観点（本観点からは P-03 / P-04 / P-22 / P-25 の状態行を整合確認のため参照した）（2 件）
- `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/index.md` — 台帳採番規則・ポート所有権・ADR 索引。inventory / ドメイン観点（3 件）
