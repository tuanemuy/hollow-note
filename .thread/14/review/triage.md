# 指摘台帳 — PR #22 レビュー R1 のトリアージ

**対象:** `.thread/14/review/review-001-{domain,usecase,inventory,presentation,docs,general}.md`（Blockers 19 / Warnings 50 = **69 件**）
**束ね後:** **60 件**
**判定:** fix **58** / wont-fix **1** / defer **1**
**別枠:** M-61 は指摘由来ではなく、上記 fix の帰結として必要になる派生項目（AC-63 の更新）。表は 61 行。

## 前提

- 妥当性は全件、`spec/` の実物と実装コードに当たって裏を取った。**事実として誤っていた指摘は 0 件**（詳細は末尾「実地検証の結果」）。
- 本 PR はドキュメント同期で振る舞いを変えない。fix の内容はすべて (a) `spec/` 本文・台帳・手順書の記述、(b) コメント / JSDoc / テストの `it` 名、(c) `.thread/14/` の作業成果物、のいずれかに閉じる。**実行される振る舞いを変える修正は 1 件も無い。**
- ただし **AC-63（コード差分 9 ファイル）は成立しなくなる**。M-02 / M-11 / M-12 / M-23 / M-31 / M-42 が `.ts` を触るため。`.thread/14/adr.md` ADR-024 が 8 → 9 に更新した先例と同じ扱いで、plan.md 側の件数を実測へ改める（M-61）。
- `spec/` を狭める提案は採らない。M-28 は「実装の縮退を spec に書き写した」記述の是正であり、狭める向きではない。

## 台帳

| Key | 指摘 | 判定 | 理由 | 再指摘回数 |
| --- | --- | --- | --- | --- |
| M-01 `spec/usecases/identity.md:277 ほか:ExternalServiceError` | 本 PR が `SignInOAuthClient` のエラーを `ExternalApiError` へ直した結果、同じ失敗を指す identity 側 3 か所が取り残された（`domain:B-001`） | fix | 実測で確認: `spec/domains/identity.md:489` は `ExternalApiError`、`spec/usecases/identity.md:277` / `spec/testcases/identity/completeOAuthSignIn.md:18` / `spec/inventory/test.md:178` は `ExternalServiceError`。`SystemErrorCode` に `ExternalServiceError` は存在せず（`application/errors.ts`）、実装は `ExternalApiError` を投げる。本 PR が新設した内部矛盾で、修正は identity 内 3 行に閉じる。SYNC-27 の残り（conversion / integration / storage / job / `PasswordHasher` / `SecureTokenGenerator`）はスコープ外のまま | 0 |
| M-02 `application/identity/{uniqueness,removeIdentity,view}.ts:JSDoc` | 「the spec writes `sha256(...)`」「the spec's output table types it as non-null」が spec 改訂で事実に反する（`domain:B-002` + `usecase:B-005`） | fix | 同根で束ねた。`spec/database/index.md:57` / `spec/usecases/identity.md:27,576` は合成式へ、`:101,104` は `string \| null` へ改訂済み。AC-67 の目的は「実装が spec を名指しで否定している状態の解消」であり、否定の向きを逆転させただけでは達成されない。同 PR は `errorCode.ts` の同種コメントを AC-58 で全文削除しており、扱いが割れている | 0 |
| M-03 `spec/usecases/identity.md:456:requestPasswordReset` | 発行間隔判定を UoW の外の独立手順として書き、実装の同居性を落とした（`usecase:B-001`） | fix | 実装 `requestPasswordReset.ts:81-113` は `findPendingByUserAndPurpose` を `globalUnitOfWorkProvider.run` の内側で status/epoch 再検査・`deleteByUserAndPurpose`・`AuthToken.issue` と同じ transaction に置き、JSDoc が同居を意図と明言。spec だけを読むと並行要求が 60 秒制限をすり抜ける実装になる（`spec/adr/046` の「JSDoc が実装より弱い」乖離の新設） | 0 |
| M-04 `spec/manual-tests/account.md:346:TC-26` | 手順 1 が「期限切れ / 無効」の出し分けを期待結果に要求している（`usecase:B-002`） | fix | `ResetPasswordPanel/index.tsx:212-218` は 3 コードを `tokenInvalid` へ収斂させ表示は 1 文言のみ。`spec/pages/index.md` P-04 も `spec/scenario/account.md` AC-05 もカバレッジ行も 1 状態。手順 1 と手順 2 が同じ画面出力に別の期待結果を掲げ判定不能。plan の AC-54 の指定文言とも不一致。区別を出すのは実装・P-04・AC-05 を変える話でスコープ外 | 0 |
| M-05 `spec/testcases/identity/addPasswordIdentity.md:エラー行` | usecase に足したエラー 3 行がテストケースへ未追随（`usecase:B-003`） | fix | `USER_NOT_FOUND` / `ACCOUNT_UNAVAILABLE` は `addPasswordIdentity.ts:47-56` に実在するのにテストケース行が無い。同 PR は `startOAuthFlow` / `signUpWithPassword` では追随させており `addPasswordIdentity` だけ抜けている。先頭行の前提が新手順 1 と食い違う点も同じ 1 表内 | 0 |
| M-06 `spec/usecases/identity.md:515:REAUTHENTICATION_REQUIRED` | 造語のままで根拠のフォローアップ Issue が未起票（`usecase:B-004`） | defer | **起票は Phase 5 の必須項目**（plan.md スコープ節 5.、AC-23 / AC-60）で、本 PR の修正作業ではない。台帳に「Phase 5 で必ず起票する（`addPasswordIdentity` の Google 再認可、SYNC-221 / adr.md ADR-013）」として残し、完了コメントで参照を列挙する。**なお、語彙 `ValidationError("REAUTHENTICATION_REQUIRED")` の新設そのものは `.thread/14/adr.md` ADR-022 で決着済みなので蒸し返さない。提案 (a) の「spec から Issue 番号を参照する」と (b) の「実装に到達できない旨を spec が言う」は wont-fix** — `spec/index.md` / `CLAUDE.md:16` が正典から進捗・実装ステータスを排しており、ADR-022 の Consequences が既に「spec が正・実装が未実装」の向きを記録している | 0 |
| M-07 `spec/database/index.md:154:AccountDeletionRetryPolicy` | 定義も inventory 行も無い名前を導入した（`inventory:B-001`） | fix | 実測: `grep -rn AccountDeletionRetryPolicy spec/` は `spec/database/index.md:154` の 1 件のみ。実装は `domain/identity/services/accountDeletionRetryPolicy.ts` に実在し `IdentityPolicy` / `AccountLinkingPolicy` / `LoginThrottlePolicy` と同格。AC-66 が `AppliedOperationStore` について禁じた「名前だけが宙に浮く」状態そのもの。`spec/domains/identity.md` の `### ドメインサービス` に既存 3 サービスと同じ様式で足し、`spec/inventory/domain.md` の identity 群末尾へ `DOM-identity-063` を採番する（`retentionWindowMs` 120 日 / `maxTerminalAttempts` 8 / `windowStart` / `ensureRetryable` → `BusinessRuleError(AccountDeletionRetryLimitExceeded)`） | 0 |
| M-08 `spec/inventory/usecase.md:99,100:UC-storage-002/003` | ADR 050 の DTO 縮小に未追随。`UC-storage-004` だけが更新済み（`inventory:B-002`） | fix | 3 ユースケースに同一の変更（宣言 MIME / サイズを入力から落とす）を加えたのに台帳は 1 行だけ追随。3 分の 1 だけ追随した状態は素通しより誤らせる（「storeAvatar だけが特例」と読める） | 0 |
| M-09 `spec/inventory/{domain,adapter}:allRollbackReleased` | ADR 053 の本文改訂に未追随・対の `allRequiredAcknowledged` だけ書き換わっている（`inventory:B-003`） | fix | `DOM-common-021` / `ADP-common-020` は「rollback release の全完了を判定する」のままで、これは ADR 053 が曖昧だと指摘した書き方そのもの。対の `ADP-common-021` は全面改訂済みで、台帳だけ読むと ADR 053 の決定と逆の印象になる | 0 |
| M-10 `spec/inventory/frontend.md:19,20:PAGE-p03-003/004` | 改訂後の P-03 状態列挙に未追随・実装とも矛盾（`inventory:B-004`） | fix | `PAGE-p03-003` は `無効` を落としており、それを名指しで参照している `VerifyEmailPanel` の冒頭コメント（「期限切れ・無効からは確認メールを再送できる（PAGE-p03-003）」）と直接矛盾。`PAGE-p03-004` は本 PR が新設した「確認済み・サインインが必要」の導線を含まない | 0 |
| M-11 `adapters/conformance/*:ADP ID 命名` | `ADP-common-041` 採番後も `ADP-common-012` を名乗り ID が衝突。ほか 7 か所が別メソッドの ID を名乗る / 無印 / ヘッダー範囲が古い / 追加主張が `it` 名に反映されていない（`inventory:B-005` + `domain:W-002` + `domain:W-003`） | fix | 同根（ADR 052 が「対応は `describe`/`it` 名で追う」を唯一の追跡手段と規範化した当の PR で、その規約が採番 8 行のどれにも成立していない）ので束ねた。実測ヒット: `accountDeletionManifestStore.ts:100`（`ADP-common-012` → `041`）/ `:26` ヘッダー、`scopeCleanupAdmissionStore.ts:132`（`ADP-common-009` → `040`）/ `:68` の `it` 名に completed barrier の主張を追記、`identityUniqueDirectory.ts:179,196,210,226,256`（`ADP-identity-009` → `041`、実測 5 本）、`noteProjection.ts:87`（`ADP-note-028` → `055/056`）/ `:13` ヘッダー、`objectStorage.ts:23` ヘッダー、`authTokenRepository.ts:81` / `signInOAuthClient.ts:80`（無印）。**衝突を作ったのは本 PR の採番**なので、ID の一意性が壊れた状態でマージするのは順序が逆。`it` 名の文字列変更のみで振る舞いは変わらない | 0 |
| M-12 `application/storage/__tests__/deleteFilesByOwner.test.ts:252` | 改訂後の TC-storage-043 行を指さない `it` が同じ ID を名乗る（`usecase:W-006`） | fix | 改訂で clamping は行から消え `spec/usecases/storage.md:500` へ移った。`:358` の `it` が改訂後の行と一致するので、`:252` から `TC-storage-043:` 接頭辞を外す（1 語）。M-11 と同種の「テスト名 ↔ 台帳 ID」整合 | 0 |
| M-13 `spec/presentation/index.md:191:ステータス対応表` | 新設 `UnauthorizedError` を表が写像できず spec どおりだと 500（`presentation:B-001`） | fix | 表は自ら「ここが唯一の正典」「該当しない値は `unknown` として 500」と閉じているのに `unauthorized` / `forbidden` の行が無い。実装 `errorResponse.ts:102-111` は `unauthorized → 401` / `forbidden → 403` を持ち、`UnauthorizedError("UNAUTHENTICATED")` は `startOAuthFlow.ts:68` / `linkOAuthIdentity.ts:140` で実際に到達する。本 PR が同じ `UnauthorizedError` を usecase spec に書き足したので、受け手の正典が欠けたまま増えた。`forbidden` は「直列化形と写像は実在するが本設計では権限不足を 404 に畳むため使わない」を 1 句添える | 0 |
| M-14 `spec/pages/index.md:492:P-25 状態行` | 実装が到達する障害状態が状態の直和から欠落・P-03 と非対称（`presentation:B-002`） | fix | 実装 `DeleteAccountPanel/index.tsx` の `Phase` は `idle/accepted/running/completed/settled` の直和で、`settled` は `DELETION_TICKET_EXPIRED`（30 分。正常系でも到達）/ `DELETION_TICKET_INVALID` / polling の一時障害の 3 経路から到達し、専用見出し「削除の進捗を表示できません」と 2 本の導線を持つ。本 PR は同じ理由で P-03 に「一時障害（再試行）」を足しており（AC-15）判定基準が非対称。`spec/inventory/frontend.md` の `PAGE-p25-003` にも同じ分岐を反映する | 0 |
| M-15 `spec/{testcases,inventory}:相対リンク` | ADR 056 リンクが 1 階層足りず解決しない（AC-68 / AC-61 不成立）。同型の既存リンク切れが `spec/inventory/test.md` に 6 本（`docs:B-001` + `docs:W-006`） | fix | 同根（相対パスの解決深さ）で束ねた。`spec/testcases/storage/deleteFilesByOwner.md:11` は `../adr/` → `../../adr/`。`spec/inventory/test.md:690,876,1520,1635,1819,2194` は `../../` → `../`（実測 6 本、`origin/main` から存在するが本 PR は同ファイルを編集している）。AC-68 の検査手順を「ファイル名の突き合わせ」から「リンク先パスを実際に解決して存在を確認する」へ直すところまで含める | 0 |
| M-16 `spec/domains/identity.md:554:ユースケース概要` | 新設 3 ユースケースが未反映で 21 のまま（`docs:B-002`） | fix | 実測で `spec/usecases/identity.md` 24 節 / `spec/testcases/identity/*.md` 24 本 / `UC-identity-*` 24 行に対し、この一覧だけ 21 個。他ドメイン（storage 13 / usage 7 / note 36）は一致しており identity だけが内部矛盾。`spec/domains/identity.md` を入口にすると新設 3 本へ到達できない | 0 |
| M-17 `spec/manual-tests/index.md:30,40:集計台帳` | TC 41→42 の集計が未更新（本 PR の ADR 057 に違反）（`docs:B-003`） | fix | 実測 `grep -c "^## TC-" spec/manual-tests/account.md` = 42、種別は正常系 14 / 異常系 24 / 境界値 4。index は `41 \| 14 \| 23 \| 4`・合計 `318 \| 133 \| 160 \| 25` のまま。正しくは `42 \| 14 \| 24 \| 4` / 合計 `319 \| 133 \| 161 \| 25`。ADR 057 を新設した PR がその ADR を破っている。ADR 057 の決定に「`manual-tests/index.md` の集計行も追随対象」を 1 句加える | 0 |
| M-18 `.thread/14/research-2.md:314,317,598:spec/adr/022` | 実在しない引用 — `spec/adr/022` は「コマンドパレット航法」で OCC とは無関係（`general:B-001`） | fix | 実測: `spec/adr/022-command-palette-navigation.md`。意図は `.thread/2/adr.md` ADR-022。`spec/adr/022` は実在するのでリンク切れとして検出されず黙って別文書に着地する。SYNC-227 の判定根拠なので、再検討する人が根拠へ辿り着けない。正典側の根拠 `spec/adr/056-performance-budget-placement.md:11` を併記する | 0 |
| M-19 `.thread/14/research{,-2}.md:as-of` | 「現在の spec / 現在の実装」と全 `file:line` が `55a5bb9` 基準である旨の断りが無い（`general:B-002`） | fix | 台帳は AC の由来欄から SYNC ID で恒久参照される成果物（plan.md 前提節）。要修正 59 件が反映済みなので現在形の記述はほぼ全件 HEAD では偽、`file:line` アンカー 254 本もドリフト済み（実測でずれを確認）。冒頭 1 行の as-of 宣言で解消する。**台帳の再調査はしない** | 0 |
| M-20 `spec/usecases/identity.md:343:linkOAuthIdentity 手順3` | 新設した `resolve` の契約（`reserved` / `releasing` は `null`）と手順が噛み合わない（`domain:W-001`） | fix | 手順 3 は「別 userId の active/**reserved** 行があれば」と書くが、新契約では `resolve` から `reserved` は観測できない。実装 `linkOAuthIdentity.ts:94-105` も `resolve`（active のみ）で弾き、`reserved` との衝突は後続 `reserve` が投げる。AC-31 の明文化が下流で取り違えを誘発している | 0 |
| M-21 `spec/inventory/{domain,usecase}.md:採番規則ヘッダー` | 規則が `adapter.md` / `test.md` にしか無く、同じ末尾採番を受けた `domain.md` / `usecase.md` に無い（`domain:W-004` + `inventory:W-003` + `docs:W-005`） | fix | 同根で束ねた。ADR 052 決定 2 は DOM / ADP / UC / TC すべてに掛かる。本 PR は `domain.md` へ 8 行、`usecase.md` へ 3 行を出現順を無視して末尾採番しており、規則の無いファイルでは行位置に意味が読まれる（`DOM-storage-038` が `DnsResolver` の下にある理由が「並べ間違い」に見える）。計画レビュー R3 arch:S-001 が `test.md` について潰した非対称と同型。`frontend.md` は本 PR で新規採番していないので対象外 | 0 |
| M-22 `spec/domains/index.md:312:continuationKey` | 導出式が 3 つの継続要求のうち 1 つに当てはまらない（`domain:W-005`） | fix | `identity.accountDeletionManifestCompactContinued` の payload は `{ operationId, cursor, continuationKey }` で `phase` を持たない。実装 `continuations.ts:180-185` は `phase` の位置にリテラル `"compact"` を渡す。式をそのまま読むと 1 種類だけ payload から鍵を再導出できず、説明の検証可能性が落ちる。半行の追記で済む | 0 |
| M-23 `spec/domains/identity.md:385 + ports/identityUniqueDirectory.ts:25:reserve` | エラーケースの条件（「別の利用者が持っている」）が実装より狭い（`domain:W-006`） | fix | memory 実装 `identityUniqueDirectory.ts:50-66` の判定材料は `operationId` の一致であって `userId` ではなく、同じ利用者の別 operation からの再予約も同じ `ConflictError` になる。ポート JSDoc も同じ表現なので本 PR が新設した矛盾ではないが、AC-31 で `reserve` の奪取条件を精密に書いた段落と並ぶと 1 段粗い。spec と JSDoc を同時に直す | 0 |
| M-24 `spec/usecases/identity.md:284-321:completeOAuthCallback` | 実装と自動テストにある `intent: "integration"` の分岐を扱っていない（`usecase:W-001`） | fix | 実装 `completeOAuthCallback.ts:52-56` は `integration` arm を `oauthStateInvalid()` で明示的に落とし、`__tests__/completeOAuthCallback.test.ts:132` が拘束している。spec の手順 3 は 2 分岐しか書かず、判別共用体の網羅性が読めない。手順・エラー表・テストケースに 1 行ずつ | 0 |
| M-25 `spec/testcases/identity/startOAuthFlow.md:7` | 「削除開始済みまたは削除済み」行だけ期待結果がエラーコードを名指ししない（`usecase:W-002`） | fix | 実装 `startOAuthFlow.ts:66-70` と `__tests__/startOAuthFlow.test.ts:79,92` は明確に `UnauthorizedError("UNAUTHENTICATED")`。本 PR は同じ表の `:9` を直し `spec/usecases/identity.md:236` に `UNAUTHENTICATED` 行を新設したのに、この行だけ粒度が揃わない | 0 |
| M-26 `spec/testcases/identity/requestPasswordReset.md:10,13` | 同じ振る舞いの行が 2 つ並び、境界の明示されない行が 1 つ残った（`usecase:W-003`） | fix | 実装のレート制限は 60 秒の発行間隔 1 つだけで、`:10`（汎用「レート制限」）と `:11`（59 秒）は同じ `it`（TC-identity-192）を指す。`:10` は存在しない第 2 の絞りがあるかのように読める。`:13` は 60 秒以内には成立しないのに経過時間の前提が無い（対応する TC-identity-193 は 61 秒進める）。**採用は部分的**: `:10` を削除すると `TC-identity-*` の連番に穴が空くので、削除ではなく「60 秒の発行間隔に掛かり…」と書き換えて `:11`/`:12` を境界値行として残し、`:13` に「発行から 60 秒以上経過している」を足す | 0 |
| M-27 `spec/testcases/identity/checkHandleAvailability.md:5-10` | 実装と自動テストが持つ 2 つの振る舞いを落としている（`usecase:W-004`） | fix | `__tests__/checkHandleAvailability.test.ts:56`（入力を正規化してから自分のものと判定）と `:68`（`releasing` の claim を空きと読む）に対応する行が無い。後者は本 PR が AC-31 で明文化した `resolve` の契約そのもの | 0 |
| M-28 `spec/usecases/usage.md:173:recalculateStorageUsage` | workspace 認可の欠落を「未実施」として spec に書き込み、追跡先を持たせていない（`usecase:W-005`） | fix | **実装の縮退を spec へ書き写した唯一の箇所**。本 PR の追加文は「workspace 主体の membership 検査は `WorkspaceAuthorization` が入るまで未実施」。実装 `recalculateStorageUsage.ts:40-46` は `subjectType === "user"` のときだけ実行者一致を検査し workspace 主体は誰でも通る。同じスライスの `storeAvatar.ts:71` は同じ状況を fail-closed（`InsufficientRole`）で扱っており縮退の向きが逆。`spec/adr/046` は「記録して放置する」を明示的に否定している。**採用は (b) 側**: 検査の担い手（`WorkspaceAuthorization` — ワークスペーススライス）を正典の記述として書き、実装ステータスの追認と読める「未実施」の言い切りを落とす。追跡は Phase 5 の Issue #3 コメント（plan スコープ節 9.）の骨子へ 1 項目足す。**「workspace 主体は倒す」と書き換える案 (a) は採らない** — 実装変更を要求する記述になり本 PR のスコープ外 | 0 |
| M-29 `spec/adr/057-manual-test-followthrough.md:38` | 代替案節にレビューの経緯が 1 文残っている（`usecase:W-007` + `inventory:W-007`） | fix | 同根で束ねた。「同じ論点が次のレビューで再燃する。**実際にそれが起きた。**」は本 Issue に閉じた経緯。docs 観点は「ADR 051 と同じ既存様式で許容範囲」と判定したが、ADR 051:32 が語るのは設計上生じた状態であってレビュー事象ではない。前文の「再燃する」で理由は成立しており、1 文削除で足りる | 0 |
| M-30 `spec/testcases/identity/getProfile.md:6` | 新設テストケースの網羅と前提条件が甘い（`usecase:W-008`） | fix | `:6` の前提が `—` だが「応答に秘匿値が含まれない」は主体の存在を前提とする観測。`__tests__/getProfile.test.ts:57` が拘束する初期値（`bio` は空文字列、`handle`/`avatarUrl` は `null`）の行も無い。`getProfile` は `bio` を射影する唯一の経路 | 0 |
| M-31 `spec/usecases/identity.md:294 + completeOAuthCallback.ts:10:provider` | 入力 DTO で `provider` を「表示・ログ専用」と説明しているが、実際は state 照合の入力（`usecase:W-009`） | fix | 同じ節の手順 2（`:317`）が「経路の `:provider` が state に保存されたものと一致しなければ state を無効として扱う」と書き、実装も `flow.provider !== input.provider` で比較する。節内で自己矛盾しており、「照合しなくてよい」と読ませうるセキュリティ上意味のある取り違え。実装 JSDoc `completeOAuthCallback.ts:10`（`display / logging only`）も同じ誤記なので同時に直す | 0 |
| M-32 `spec/inventory/domain.md:15,24,26,28:DOM 4 行` | 本文（`spec/domains/index.md`）の改訂に ADP 行だけが追随し DOM 行が置き去り（`inventory:W-001`） | fix | `assertOwner` の完了済み拒否、`acknowledgeReceipt` / `allRequiredAcknowledged` の「必須集合は配備が宣言した集合」、`claimPending` の「完全 ack は cleanup phase の ack を含む」はいずれもドメイン契約の保証であってアダプター実装の詳細ではない。特に `DOM-common-009` は本 PR がポート JSDoc と適合スイートの両方に足した主張 | 0 |
| M-33 `spec/inventory/adapter.md:59:ADP-identity-010` | ADR 054 の契約縮小に未追随。**M-32 と向きが逆**（`inventory:W-002`） | fix | `DOM-identity-031` には追記されたが `ADP-identity-010` は「新規 Identity を保存する」のまま。新バックエンドの実装者が `adapter.md` だけを見て一意制約と `PROVIDER_ACCOUNT_ALREADY_LINKED` を実装してしまう配置。アダプター実装者に最も届く必要がある情報 | 0 |
| M-34 `spec/inventory/frontend.md:68,74,101,128:FormData 条件` | 本 PR が `spec/presentation/index.md` から削除した「`FormData` を受ける場合は」を 4 行が保存し続けている（`inventory:W-004`） | fix | AC-16 の改訂で CSRF 規約は「すべての server function 呼び出しに同一オリジン検証を強制する」になり、条件付けは明示的に否定された。`spec/pages/index.md` に `Origin` も `FormData` も現れないので、これらの行の出所は presentation 側しかない | 0 |
| M-35 `spec/inventory/frontend.md:168:Cache-Control` | `PAGE-p47-001` だけに足したのは本文の「サービス全体の既定」と粒度が合わない（`inventory:W-005` + `presentation:W-007`） | fix | 同根で束ねた。P-41〜P-45 も同じヘッダー集合を要点欄に列挙しており同じ既定が掛かる面。1 行だけに足すと「P-47 固有の要件」と読める。**採用は (b)**: `PAGE-p47-001` から外し、サービス全体の既定は `spec/presentation/index.md` 側だけの記述に留める（台帳 162 行への横展開より保守しやすい） | 0 |
| M-36 `spec/inventory/frontend.md:146 + spec/pages/index.md:569:P-40` | `PAGE-p40-004`「アプリへ戻る」が P-40 に存在しない要素の行になり、機能行にサインイン済み前提の語が残る（`inventory:W-006` + `presentation:W-009`） | fix | 同根で束ねた。本 PR は状態を「通常 のみ」に改訂したので導線の出し分けは定義上起こらず、実装 `routes/index.tsx:12-17` も `beforeLoad` で `redirect` するだけで分岐を持たない。それでも本 PR は機能行に「導線は未サインインの訪問者にだけ出る」を**足している**（自己矛盾を新設）。要素名を「サインイン済みのリダイレクト（`/` → P-10）」へ改め ID は据え置く | 0 |
| M-37 `spec/inventory/domain.md:253:DOM-note-013` | 本 PR が追加した 2 つの不変条件に未追随（`inventory:W-008`） | fix | (a) 公開⇄本文降格の双方向禁止、(b) `Note.reconstruct` が ready 必須列の欠落を拒否。同じ PR で `DOM-usage-006` は `replaceTotals` に合わせて要点欄を伸ばしており、エンティティ行の追随粒度が 2 群で揃っていない | 0 |
| M-38 `spec/presentation/index.md:126:CSRF 判定条件` | 「`Origin` が欠けている要求は拒否する」が実装の判定順と違う（`presentation:W-001`） | fix | `createCsrfMiddleware` は (1) `Sec-Fetch-Site` があればそれだけで判定、(2) 無ければ `Origin`、(3) それも無ければ `Referer`、(4) 3 つとも無いときに初めて拒否、の順。防御の強さは同等だが**規律の記述として事実と違う**。この 1 行が本 PR で CSRF 規律の正典になった以上、他ランタイム実装者はこの文だけを読んで実装する | 0 |
| M-39 `spec/presentation/index.md:183:Cache-Control 例外` | 例外の書き方（「静的アセット」）が実装のもう 1 つの自前指定を取りこぼす（`presentation:W-002`） | fix | `/storage/*`（`routes/storage.$.tsx:52`）が `private, max-age=31536000, immutable` を意図的に指定している（鍵にファイル ID が入るので内容が不変・`private` は退会後に共有キャッシュから読めないため）。spec を正典に別ランタイムを書くと `no-store` へ劣化するか `public` にされ P-25 の削除の約束が破れる | 0 |
| M-40 `spec/presentation/index.md:40:Secure` | 無条件のままで実装の development 免除への参照が無い（`presentation:W-003`） | fix | 実装は `secure: !isDevelopment()`（`session.ts:32-36`）。免除自体は `spec/adr/037-node-env-allowlist.md` で承認済みなので設計は割れていないが、Cookie 属性の正典である表から参照が無いと「実装が spec に反している」と読める。本 PR は同じ表の「寿命」行に ADR 055 参照を足しており `Secure` だけ取り残されている | 0 |
| M-41 `spec/pages/index.md:49:/settings/danger` | P-25 を「認証ガードの明示的な例外」と書いた一方で区分表は「設定（認証必須）」のまま（`presentation:W-004`） | fix | 区分表は `:9-14` で「設定 = 必須」と定義しており、実装 `routes/settings/route.tsx:21-37` は `SIGNED_OUT_PATH = "/settings/danger"` だけガードを抜ける。本 PR は同型の spec 内部矛盾（P-40 の状態行 vs URL 表）を SYNC-26 / AC-26 として閉じているので、同じ文書に残すのは非対称 | 0 |
| M-42 `apps/web/app/presentation/*, DeleteAccountPanel/ticketStorage.ts:ADR 参照` | `.thread/2/adr.md` にしか存在しない ADR 番号への dangling 参照（`presentation:W-005`） | fix | 本 PR が `start.ts` の `AC-15` で潰したのと同じ dangling 参照。実測ヒット: `session.ts:32`（ADR-110）/ `oauthStateCookie.ts:23`（ADR-110）・`:66`（**ADR-099 — レビューの列挙に無い 4 件目**）/ `ticketStorage.ts:2`（ADR-006 / ADR-095 / ADR-112）。`spec/adr/` の最大採番は 057 で 095 / 099 / 110 / 112 は存在しない。**修正時は各番号を `.thread/2/adr.md` で照合し、正典側の受け皿が実在するものだけ差し替え、無いものは番号ごと落とす**（ADR-110 → `spec/adr/037` は検証済み） | 0 |
| M-43 `spec/usecases/identity.md:70,270:ADR 055 の 1 句` | セッションを発行するもう 2 つの経路に決定 2 が適用されていない（`presentation:W-006`） | fix | `verifyEmail`（`:114`）と `signInWithPassword`（`:186`）には入ったが、`completeOAuthSignIn` 手順 8 は `sessionToken` を返し実装も同じ再導出を使う（`routes/auth/-action.tsx:108-110` が 3 か所目）のに何も無い。`signUpWithPassword` 手順 10 も View が `expiresAt` を返さないことに触れていない。ADR 055 が「片側だけだと疑問が解けない」と書いた形が残る | 0 |
| M-44 `spec/pages/index.md:174:P-03 の発生条件` | 「確認済み・サインインが必要」の発生条件が実装より狭い（`presentation:W-008`） | fix | 実装 `verificationSession.ts:14-21` の条件は `pendingUserId === view.userId` の不成立で、別ブラウザーは代表例にすぎない（Cookie 削除・プライベートウィンドウ・確認待ち Cookie の TTL 経過でも到達）。「別ブラウザーの場合に出る」と断定すると手動テスト TC-42 が 1 経路だけで十分と判断してしまう。`spec/inventory/frontend.md` の `PAGE-p03-001` も同文なので同時に直す | 0 |
| M-45 `.thread/14/testing.md:13:ファイル件数` | コード差分を「8 ファイル」と書き `plan.md` AC-63 / 実差分の 9 と食い違う（`docs:W-001`） | fix | `containerStore.ts` を列挙から落として 8 と数えている。確認項目 2 は「ちょうど 8 ファイル」「これ以外が出たらスコープ逸脱」なので、**手順どおり検証すると正しい PR がスコープ逸脱と判定される**。検証手順書としての誤り。M-61 の実測件数へ合わせて更新する | 0 |
| M-46 `apps/web/.env*.example, .dockerignore:他ランタイムの残骸` | 「参照ランタイムは 1 つ」と言い切った直後に他ランタイム用の設定テンプレートが残っている（`docs:W-002`） | fix | 実測: `git ls-files` に `apps/web/.dev.vars.example` / `.env.aws.example` / `.env.gcp.example`。`.dockerignore:3`（`**/.wrangler`）/ `:11`（`infra/aws/cdk.out`）。Dockerfile も wrangler 設定も CDK も既に存在せず、これらを読むコードは 0 件（`grep` で確認）。`CLAUDE.md:98` / `README.md:52` の断言と `spec/adr/025`（「1 つを選んで他は消す」）に対して**現物が文章を裏切っている**状態で、削除は振る舞いに一切影響しない。AC-20 の grep が 4 ファイルに絞られているため構造的に検出できない乖離 | 0 |
| M-47 `spec/{usecases/storage.md:506, testcases/.../deleteFilesByOwner.md:12, inventory/test.md:1742}:改訂履歴` | `spec/index.md` が禁じている「以前は〜だった」の文が 3 か所（`docs:W-003`） | fix | `spec/index.md:5` / `CLAUDE.md:16` は「進捗、レビュー記録、日付つきの改訂履歴、廃止済みの判断は置かず、変更の履歴は Git で管理する」と定める。3 か所とも「今こうである」ではなく「前はこうだったが直った」を語る。本 PR 以前からの文だが同じ 3 ファイルを本 PR が編集しており、2 か所は編集行の隣接行 | 0 |
| M-48 `spec/domains/storage.md:306:ObjectStorage.put` | 引き継ぎ段落に設計ではなく同期作業の判断根拠が混ざっている（`docs:W-004`） | fix | 「未実装なのでユースケース側の記述は狭めない」は `spec/adr/046` を今回の同期作業へどう適用したかという編集判断であって設計の記述ではない。段落の他 3 点（責務の移転・要求元の名指し・実装スライスが入口を広げる）は ADR 046 が要求する申し送りなので残す。1 文の削除 | 0 |
| M-49 `docs/backend_implementation_example.md:347:removeIdentity` | 実装の主要な分岐を省略記号なしで別の振る舞いに置き換えている（`docs:W-007`） | fix | 実装 `removeIdentity.ts:71-73` は `target === undefined` のときまず `identityRemovalReceiptStore.findByIdentityId` を引き、自分の receipt があれば「既に削除済み」として正常復帰する（このユースケースの中心的な設計）。例は無条件 `throw` に置き換えているのに省略マーカーが無く、冒頭が「Every path and identifier below points at real code」と宣言している | 0 |
| M-50 `.thread/14/{steps,adr}.md:相対リンク` | 解決しない相対リンクが約 50 本ある（`docs:W-008`） | wont-fix | **レビュアー自身が「対応不要と判断してよい」と結論している**。いずれも `spec/` へ書き込む本文をそのまま引用した結果で、`.thread/14/` から見て解決しないのは引用の性質。50 本を機械的に触ると引用と本文の一致が崩れ、次ラウンドの差分照合が読めなくなる副作用のほうが大きい | 0 |
| M-51 `.thread/14/research-2.md:553,555,568,569:逆引き件数` | 「反映先ファイル別の逆引き」表の件数が 4 行で ID 数と合わない（`general:W-001`） | fix | 実測: `spec/domains/index.md` 9 に対し ID 10 個、`spec/database/index.md` 4 に対し 5 個、`spec/inventory/domain.md` 11 に対し 10 個、`spec/inventory/adapter.md` 10 に対し 9 個。件数を数えるためだけの表なので、信用できないと表の存在意義が消える | 0 |
| M-52 `.thread/14/research-2.md:523-532:分類別内訳` | 合計が 43 で台帳の総数 44 と合わない（`general:W-002`） | fix | A11+B7+C9+D10+E2+F1+G2+H1 = 43。`### I. 統合作業で追加（1 件）`（SYNC-244）の行だけが表から漏れている。同一ファイル内に 43 と 44 の 2 つの総数が並び、どちらが正か読者に判断できない | 0 |
| M-53 `.thread/14/research-2.md:8:自ファイル行番号` | 「L497 の集計表と一致」の参照が外れている（`general:W-003`） | fix | `:497` は `### I. 統合作業で追加（1 件）` の見出しで、集計表は `:513`。同一ファイル内の参照なので単純な誤り。行番号ではなく見出し名で指す | 0 |
| M-54 `.thread/14/research-2.md:17:PR #17 の ADR 本数` | 昇格させた ADR の本数と範囲が誤っている（`general:W-004`） | fix | 実測 `git diff --name-only cea6134..55a5bb9 -- spec/adr/` = 30 ファイル（ADR 29 本 `023`〜`051` ＋ `index.md`）。「30 本（`038`〜`051`）」は同じ括弧内で自己矛盾し、`research.md:42` の正しい記述とも食い違う。台帳全体の前提を支える箇所 | 0 |
| M-55 `.thread/14/research-2.md:588-603:判断に迷った点` | 決着後も未決着時の一人称の意見表明が残っている（`general:W-005`） | fix | 「私は含める側を推す」「plan で当たり直す必要がある」等。決着は `spec/adr/052`〜`057` と plan の AC に昇格済みで二重管理。`:603` は訂正前の件数（43）のまま `:8`（44）と正面から矛盾する（M-52 と同根）。節ごと畳んで 1 行にする | 0 |
| M-56 `.thread/14/research{,-2}.md:レビュー経緯 23 か所` | レビューループの経緯が台帳本文に埋まっている（`general:W-006`） | fix | 「R2 で訂正した / 旧記載は誤りだった / 落としていた」等、台帳自身の改訂履歴と弁明。`spec/index.md` が正典から改訂履歴を排するのと同じ理由で、恒久参照ドキュメントには残さない。**訂正の結果（現在の正しい記述）は残し、経緯文だけを落とす**（台帳の再調査はしない） | 0 |
| M-57 `.thread/14/research.md:301-313` | 自己否定したまま並置されている段落（`general:W-007`） | fix | `:307-311` の制約宣言を `:313` が「もう適用されない」と打ち消しており、読者は打ち消された制約を先に読まされる。`:305` は完了済みの作業を未来形で書いている | 0 |
| M-58 `.thread/14/research-2.md:312,566,598:#クエリ予算` | 存在しない見出しへのアンカーが反映先として残っている（`general:W-008`） | fix | `spec/platform/index.md#クエリ予算` は `55a5bb9` にも HEAD にも無い（実物は `## 行サイズの予算` / `## 実行予算と分割単位`、本 Issue が足したのは `### Scope DO`）。plan の AC-47 / リスク節は正しく検出して `### Scope DO` へ倒しており、台帳だけが死んだアンカーを指している | 0 |
| M-59 `.thread/14/research-2.md:542:SYNC-237` | 受け皿スライスの一覧が plan と食い違う（`general:W-009`） | fix | 台帳は「#4 / #5 / 編集・整理スライス」、`plan.md:171`（Phase 5 の 7.）は「#3 / #4 / #5 / #7」。Phase 5 の起票内容は AC-60 の参照対象なので、どちらを根拠に起票したか読めなくなる。件数・分類は 7 件で一致しており齟齬はこの 1 行だけ | 0 |
| M-60 `.thread/14/research.md:343,206` | 凍結前提で書かれた記述が実際には凍結されていない状態と食い違う（`general:W-010`） | fix | HEAD に `.thread/1/` は丸ごと残っている。AC-16 の差し替え自体は正しく実施済みなので実害は無いが、台帳が根拠として述べた前提が実物と合わない。`:206` の件数（3 件 → 実測 7 件）も同種の陳腐化。件数を書かない形へ | 0 |
| M-61 `.thread/14/{plan,adr}.md:AC-63` | 本トリアージの fix でコード差分が 9 ファイルを超える | fix | 派生項目（レビュー指摘ではない）。M-02 / M-11 / M-12 / M-23 / M-31 / M-42 が `.ts` を触るため AC-63 の 9 ファイルが成立しなくなる。`.thread/14/adr.md` ADR-024 が 8 → 9 に更新した先例と同じ扱いで、**実測に合わせて件数を改め、「ADP ID の一意性を壊した状態でマージしない」「実装が spec を名指しで否定するコメントを残さない」という判断を ADR として記録する**。M-06 の Phase 5 起票が必須である旨も plan の Phase 5 節に明記する | 0 |

## 実地検証の結果

**69 件すべてについて `spec/` の実物・実装コード・`git diff` に当たり、事実として誤っていた指摘は 0 件だった。** 主な確認:

- `spec/domains/identity.md:489` が本 PR で `ExternalApiError` へ変わり、identity 側 3 か所が `ExternalServiceError` のまま残っていること（M-01）
- `spec/manual-tests/account.md` の TC 総数が 42、`spec/manual-tests/index.md` は 41 のままであること（M-17）
- `spec/adr/022` の実体が `022-command-palette-navigation.md` であること（M-18）
- `git diff --name-only cea6134..55a5bb9 -- spec/adr/` = 30 ファイル（ADR 29 本 + index）であること（M-54）
- 適合スイートの `it` 名が実際に `ADP-common-012` / `ADP-common-009` / `ADP-identity-009`（5 本）/ `ADP-note-028` を名乗っていること（M-11）
- `.env.aws.example` / `.env.gcp.example` / `.dev.vars.example` が追跡済みで、参照するコードが 0 件であること（M-46）

判定が割れた 1 件（ADR 057 の「実際にそれが起きた。」— docs 観点は許容範囲、usecase / inventory 観点は削除）は、ADR 051:32 の「実際に起きた」が**設計上生じた状態**を指すのに対し ADR 057 のそれは**レビュー事象**を指すため、削除側を採った（M-29）。

レビューの列挙に無い 1 件を追加で検出した: `apps/web/app/presentation/oauthStateCookie.ts:66` の `ADR-099` も dangling 参照である（M-42 に含めた）。

## 修正の実行計画

編集ファイルが重ならないよう 11 単位に分割した。**U1〜U10 は並列実行可**。U11 のみ U7 / U8 / U9 の完了後に走らせる。

### U1 — `spec/usecases/` （identity / usage）

- 担当: `domain:B-001`(spec/usecases 部分), `usecase:B-001`, `domain:W-001`, `usecase:W-001`(手順・エラー表部分), `usecase:W-005`, `usecase:W-009`(spec 部分), `presentation:W-006`
- 編集ファイル: `spec/usecases/identity.md`, `spec/usecases/usage.md`
- 順序制約: なし。ただし `usecase:W-001` のテストケース行と `domain:B-001` の testcases / inventory 行は **U2 が担当**するので、両者で同じ文言を使うこと（`SystemError(ExternalApiError)` / 「`integration` は本スライスに受け皿が無いため state を無効として扱う」）

### U2 — `spec/testcases/**` ＋ `spec/inventory/test.md` ＋ `spec/usecases/storage.md`

- 担当: `domain:B-001`(testcases/inventory 部分), `usecase:B-003`, `usecase:W-001`(TC 行), `usecase:W-002`, `usecase:W-003`, `usecase:W-004`, `usecase:W-008`, `docs:B-001`, `docs:W-006`, `docs:W-003`
- 編集ファイル: `spec/testcases/identity/{addPasswordIdentity,checkHandleAvailability,completeOAuthCallback,completeOAuthSignIn,getProfile,requestPasswordReset,startOAuthFlow}.md`, `spec/testcases/storage/deleteFilesByOwner.md`, `spec/inventory/test.md`, `spec/usecases/storage.md`
- 順序制約: **新規 TC 行は `TC-identity-323` 以降へ末尾採番**（実測の最大は `TC-identity-322`）。ADR 052 / ADR 016 の規則どおり既存 ID を繰り下げない。`usecase:W-003` は行の**削除ではなく書き換え**（連番に穴を空けない）

### U3 — `spec/inventory/{domain,adapter,usecase,frontend}.md`

- 担当: `inventory:B-001`(DOM 行), `inventory:B-002`, `inventory:B-003`, `inventory:B-004`, `inventory:W-001`, `inventory:W-002`, `inventory:W-003`, `inventory:W-004`, `inventory:W-005`, `inventory:W-006`, `inventory:W-008`, `presentation:B-002`(PAGE-p25-003), `presentation:W-007`, `presentation:W-008`(PAGE-p03-001), `presentation:W-009`(PAGE-p40-004), `domain:W-004`, `docs:W-005`
- 編集ファイル: `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/inventory/usecase.md`, `spec/inventory/frontend.md`
- 順序制約: **U4 / U5 の本文改訂と文言をそろえる**（台帳は本文の生成物）。`AccountDeletionRetryPolicy` の DOM 行（`DOM-identity-063`）は U4 が書く定義の要点を写すので、U4 の文言を先に確定させる。新規採番はすべて各群の末尾

### U4 — `spec/domains/`

- 担当: `inventory:B-001`(定義), `domain:W-005`, `domain:W-006`(spec 部分), `docs:B-002`, `docs:W-004`
- 編集ファイル: `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/storage.md`
- 順序制約: `AccountDeletionRetryPolicy` の節は既存 3 ドメインサービス（`IdentityPolicy` / `AccountLinkingPolicy` / `LoginThrottlePolicy`）と同じ様式（責務 + メソッド表 + 定数表）で書く。`domain:W-006` のポート JSDoc 側は **U7 が担当**するので文言をそろえる

### U5 — `spec/pages/index.md` ＋ `spec/presentation/index.md`

- 担当: `presentation:B-001`, `presentation:B-002`(状態行), `presentation:W-001`, `presentation:W-002`, `presentation:W-003`, `presentation:W-004`, `presentation:W-008`(P-03 本文), `presentation:W-009`(機能行)
- 編集ファイル: `spec/pages/index.md`, `spec/presentation/index.md`
- 順序制約: なし。U3 と文言をそろえる

### U6 — `spec/manual-tests/` ＋ `spec/adr/057`

- 担当: `usecase:B-002`, `docs:B-003`, `usecase:W-007`, `inventory:W-007`
- 編集ファイル: `spec/manual-tests/account.md`, `spec/manual-tests/index.md`, `spec/adr/057-manual-test-followthrough.md`
- 順序制約: `spec/manual-tests/index.md` の集計は `grep -c "^## TC-"` と `**種別**` 行の実測で確定させる（42 / 14 / 24 / 4、合計 319 / 133 / 161 / 25）

### U7 — コード: application / port の JSDoc とコメント

- 担当: `domain:B-002`, `usecase:B-005`, `usecase:W-009`(実装 JSDoc), `domain:W-006`(ポート JSDoc), `presentation:W-005`
- 編集ファイル: `packages/core/src/application/identity/{uniqueness,removeIdentity,view,completeOAuthCallback}.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `apps/web/app/presentation/{session,oauthStateCookie}.ts`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`
- 順序制約: **コメント / JSDoc のみを変更し、式・型・引数・戻り値は 1 文字も触らない**。`presentation:W-005` の ADR 番号は `.thread/2/adr.md` で 1 件ずつ照合し、正典側の受け皿が実在するものだけ差し替える（無いものは参照ごと落とす）

### U8 — コード: 適合スイート・テストの ID 命名

- 担当: `inventory:B-005`, `domain:W-002`, `domain:W-003`, `usecase:W-006`
- 編集ファイル: `packages/core/src/adapters/conformance/{accountDeletionManifestStore,scopeCleanupAdmissionStore,identityUniqueDirectory,noteProjection,objectStorage,authTokenRepository,signInOAuthClient}.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`
- 順序制約: **`describe` / `it` の文字列とヘッダーコメントだけを変更する**。アサーション・セットアップ・`makeBackend` の呼び出しには触らない。付け替える ADP ID は `spec/inventory/adapter.md` の実物で確認する（`ADP-common-040/041`, `ADP-identity-041`, `ADP-note-055/056`, `ADP-storage-024`）。完了後に `pnpm test:unit` で緑を確認

### U9 — `docs/` ＋ `.thread/14/testing.md` ＋ リポジトリの残骸

- 担当: `docs:W-001`, `docs:W-002`, `docs:W-007`
- 編集ファイル: `docs/backend_implementation_example.md`, `.thread/14/testing.md`, （削除）`apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example`, `.dockerignore`
- 順序制約: `.thread/14/testing.md` のファイル件数は **U11 が確定させる実測値**に合わせるので、U11 の直前または U11 の中で最終確認する（暫定値で書いて U11 で上書きしてよい）。削除前に `grep -rn "dev.vars\|env.aws\|env.gcp\|wrangler\|cdk.out" --include="*.ts" --include="*.json" --include="*.yaml"` が 0 件であることを再確認

### U10 — 乖離台帳（`.thread/14/research.md` / `research-2.md`）

- 担当: `general:B-001`, `general:B-002`, `general:W-001`, `general:W-002`, `general:W-003`, `general:W-004`, `general:W-005`, `general:W-006`, `general:W-007`, `general:W-008`, `general:W-009`, `general:W-010`
- 編集ファイル: `.thread/14/research.md`, `.thread/14/research-2.md`
- 順序制約: **台帳の再調査はしない。** 修正は引用ミス・件数・as-of 表記・作業経緯の残置に限る（plan.md「前提: 乖離項目の台帳」節）。`general:B-002` の as-of 宣言を**先頭に入れてから**他を直すと、以降の「現在形」の扱いが読者に対して一貫する

### U11 — `.thread/14/plan.md` / `adr.md` の受け入れ基準更新

- 担当: 派生項目（M-61）＋ `usecase:B-004`(defer の明記)
- 編集ファイル: `.thread/14/plan.md`, `.thread/14/adr.md`
- 順序制約: **U7 / U8 / U9 の完了後**に走らせる（`git diff --stat` の実測でコード差分ファイル数を確定させるため）。AC-63 の件数と内訳を実測へ改め、(a) ADP ID の一意性を本 PR で閉じる判断、(b) 実装が spec を名指しで否定するコメントを残さない判断を ADR として記録する。あわせて Phase 5 の起票リストに `usecase:B-004`（`addPasswordIdentity` の Google 再認可 = SYNC-221）が**必須**である旨を明記する

### 全単位の完了後

1. `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test:unit`
2. `spec/` 内の相対リンクを実際に解決して存在確認（`docs:B-001` / `docs:W-006` の再発防止。AC-68 の検査手順の是正込み）
3. `grep -rn "ExternalServiceError" spec/usecases/identity.md spec/testcases/identity/ spec/inventory/test.md` の identity 分が 0 件
4. `spec/inventory/*.md` 5 ファイルの「最終同期」日付を再更新

---

# 指摘台帳 — PR #22 レビュー R2 のトリアージ

**対象:** `.thread/14/review/review-002-{domain,usecase,inventory,presentation,docs}.md`（Blockers 11 / Warnings 18 = **29 件**）
**束ね後:** **25 件**
**判定:** fix **25** / wont-fix **0** / defer **0** / 既出継承 **0**
**別枠:** M-87 は指摘由来ではなく、V2 が M-63 の作業中に発見した同クラスの欠落（`updateProfile` の avatar 関連 TC 行の追随）。追加単位 V12 で対応した。表は 26 行。R1 の M-61 と同じ扱い。

## 前提

- 妥当性は全件、`spec/` の実物と実装コード（`git diff 55a5bb9 HEAD` を含む）に当たって裏を取った。**事実として誤っていた指摘は 0 件**（軽微な計数のぶれ 1 件のみ。末尾「実地検証の結果」）。
- R1 の `wont-fix`（M-50）/ `defer`（M-06）と Key の一致する再指摘は 5 観点いずれからも無く、**既出継承は 0 件**。R2 の Key はすべて新規なので `M-62` 以降を連番で採る（R1 の M-01〜M-61 は動かさない）。
- 本 PR はドキュメント同期で振る舞いを変えない（AC-63）。fix の内容はすべて (a) `spec/` 本文・台帳・手順書・ADR の記述、(b) コメント / JSDoc / テストの `it` 名、(c) `.thread/14/` の作業成果物、(d) `.dockerignore` の 1 行、のいずれかに閉じる。**実行される振る舞いを変える修正は 1 件も無い。**
- **`spec/` を狭める提案は採らない。** M-70（削除 status の語彙）は「`failed` を落とす」向きを採らず、語彙の帰属を明記したうえで生成経路の決定を Phase 5 へ送る（`spec/adr/046`）。
- **AC-63 のコード差分件数は再び成立しなくなる**（M-67 / M-69 / M-71 / M-72 / M-75 / M-76 / M-87 が `.ts` / `.tsx` を触り、うち **8 ファイル**は差分に新規参入する）。R1 の M-61 と同じ扱いで実測へ改める（M-80 に含める）。**実測は 35 ファイル = 変更 32 / 削除 3 / 追加 0**。

## 束ねた指摘

3 組を 1 件に束ねた（29 → 25）。

| 束ね後 Key | 元の指摘 ID | 束ねた理由 |
| --- | --- | --- |
| M-62 | `domain:B-002` + `inventory:B-001` + `docs:B-001` | 同一問題。ADR 052 / 台帳ヘッダー / ADR 索引が追跡手段を `describe` 名と規定しているが実体は `it` 名、かつ ADR 026 への誤帰属。3 観点が独立に到達した |
| M-71 | `domain:W-001` + `docs:W-002` | 同一問題の表裏。`ADP-note-056` が短縮連記で grep 到達不能なこと（コード側）と、それを「全数拾える」と主張する `.thread/14/adr.md` ADR-029 影響節（記録側） |
| M-80 | `inventory:W-002` + `docs:W-003` | どちらも `.thread/14/plan.md` の採番系 AC が実測に追随していない件。AC-55 と AC-64 で対象 AC が重なる |

## 台帳

| Key | 指摘 | 判定 | 理由 | 再指摘回数 |
| --- | --- | --- | --- | --- |
| M-62 `spec/adr/052 + spec/inventory/adapter.md:5 + spec/adr/index.md:114:ADP 追跡規約` | 適合ケースの唯一の追跡手段を「`describe` 名に ADP ID を含める命名規約」と規範化しているが実体は `it` 名。さらにその規約を ADR 026 の決定として引用しているが 026 に規定が無い（`domain:B-002` + `inventory:B-001` + `docs:B-001`） | fix | 実測: `grep -rn 'describe(' packages/core/src/adapters/conformance/*.ts \| grep -c "ADP-"` = **0**（`describe` は全 34 本が `` `Xxx conformance [${backendName}]` `` 形式）、ADP ID を名乗る `it` は **166 本**。`spec/adr/026` の決定 2 は `describeXxxContract(name, makeBackend)` というスイート関数名の話だけで、ID 命名規約も ADP ID も出てこない。**採る修正は 2 つだけ** — (a) ADR 052 の 4 か所（`:13` / `:19` / `:23` / `:52`）・`spec/inventory/adapter.md:5`・`spec/adr/index.md:114` の文言を「`describe` / `it` 名」（実際は `it` 名が主で、ポート群の範囲はファイル冒頭 JSDoc が示す）へ改める、(b) `:19` の前提を ADR 026 から引ける範囲（契約の正本がポート定義にあり、検証が共有適合スイートであること）に留め、**ID 命名規約は 052 自身の決定として立てる**。**`describe` 名へコードを付け替える案は採らない** — コード差分が膨らみ AC-63 の趣旨（振る舞いを変えない最小の同期）から外れる。`.thread/14/plan.md:215` は既に「`describe` / `it` 名」と書いており、正しいのは plan 側 | 0 |
| M-63 `spec/domains/identity.md:566 + :94 + :134:AvatarUrl / SameOriginPolicy` | `InvalidAvatarUrl` を union に足したのに、それを投げる値オブジェクト・ドメインサービスが `spec/` に無い。唯一の追跡先だった `errorCode.ts` の冒頭コメントは AC-58(b) で全文削除済み（`domain:B-001`） | fix | **実装が実在するので spec を追随させる**（本 PR の趣旨どおり）。実測: `packages/core/src/domain/identity/valueObject.ts:167-199` の `AvatarUrl`（trim 後 1〜2048 文字、`/` 始まりは `SameOriginPolicy.isSameOriginPath`、絶対 URL は `appUrl` と同一 origin、違反は `BusinessRuleError(InvalidAvatarUrl)`、`appUrl` は引数）、`packages/core/src/domain/identity/services/sameOriginPolicy.ts` の `SameOriginPolicy.isSameOriginPath`（`//` 始まり・バックスラッシュ・C0 制御文字を拒否）。`grep -rn "AvatarUrl\|SameOriginPolicy" spec/` は union の 1 件のみ。設計判断は既に `spec/adr/051-自オリジンの述語` として正典にあり、**本文・台帳だけが欠けている**状態なので、新しい設計を決める作業ではない。`SameOriginPolicy` は `AvatarUrl` と `startOAuthFlow` の `redirectTo`（`application/identity/startOAuthFlow.ts:47`）の 2 か所から呼ばれるので、責務欄はその 2 用途を書く。あわせて `UserBase.avatarUrl` を `AvatarUrl \| null` へ（実装 `user.ts:21`）、`updateProfile` の振る舞い行の引数を `avatarUrl?: AvatarUrl \| null` へ改め「`avatarUrl` は `appUrl` を要するのでユースケース側（`application/identity/updateProfile.ts:163`）で構築して渡す」を 1 句添える（`displayName` / `bio` だけがエンティティ側で再構築される） | 0 |
| M-64 `spec/testcases/identity/{completeOAuthSignIn,linkOAuthIdentity}.md:PROVIDER_ACCOUNT_RELEASE_PENDING` | usecase のエラー表と UC 要点欄には入ったのに、テストケース表と `spec/inventory/test.md` に行が無い（`usecase:B-001`） | fix | R1 の M-05 と同型の残り。実測: `spec/usecases/identity.md:281` / `:349`、`spec/inventory/usecase.md:18,19` には有り、`spec/testcases/identity/` と `spec/inventory/test.md` は 0 件。実装 `application/identity/completeOAuthSignIn.ts:56` に実在し、自動テスト `__tests__/removeIdentity.test.ts:200,224` が 2 経路とも拘束している。「`PROVIDER_ACCOUNT_ALREADY_LINKED` と混同しない」は本 PR の主眼のひとつ。両ファイルに 1 行ずつ足し、identity 群末尾へ `TC-identity-330` / `331` を採番する（実測の最大は `TC-identity-329`） | 0 |
| M-65 `spec/usecases/usage.md:173:recalculateStorageUsage` | 実行者一致検査が入力 DTO の説明段落にだけ書かれ、処理フロー・エラーケース表・テストケース・台帳のどこにも無い（`usecase:B-002`） | fix | 節の内部で自己矛盾している（説明段落は `BusinessRuleError(InsufficientRole)` を明言、同じ節のエラーケース表は `SystemError(DatabaseError)` のみ）。実装 `application/usage/recalculateStorageUsage.ts:38-46` は `subjectType === "user" && subjectId !== actorUserId` で `InsufficientRole` を投げ、`__tests__/recalculateStorageUsage.test.ts:267` が拘束する。R1 の M-28 で「実装ステータスの追認を落として担い手を正典に書く」と決めた向きの片側だけが完了した状態。(a) 処理フロー先頭に検査の手順を足して以降を繰り下げる、(b) エラーケースを 2 行の表にする、(c) TC 1 行を足して usage 群末尾へ `TC-usage-073` を採番する（実測の最大は `TC-usage-072`） | 0 |
| M-66 `spec/testcases/storage/storeUpload.md:36 + spec/inventory/test.md:1926` | AC-65 で入力 DTO から宣言サイズを落としたのに「宣言サイズと実サイズが食い違う」行が残り、成立しえない前提になった（`usecase:B-003`） | fix | 実測: `git diff 55a5bb9 HEAD -- spec/usecases/storage.md` が `storeUpload` の入力表から `declaredMimeType` / `size` を削り、手順 5 から「宣言サイズと実サイズが食い違う場合は実サイズを採用する」を削っている。`grep -rn declaredMimeType packages/ apps/` は 0 件。**削除ではなく書き換える**（M-26 と同じく連番に穴を空けない）— 「宣言 MIME・宣言サイズを渡す経路が無い ／ アップロードする ／ 保管する型は先頭バイトの署名、サイズは実バイト長から決まる（`AcceptedUpload`）」。`TC-storage-221` の台帳行も同文へ | 0 |
| M-67 `application/identity/getProfile.ts:11 ほか 3 か所:spec を否定するコメント` | 本 PR が新設した `getProfile` / `checkHandleAvailability` の spec 節・TC ファイル・UC 行を、実装コメントが名指しで否定したまま（`usecase:B-004`） | fix | R1 の M-02（AC-67 / `.thread/14/adr.md` ADR-030）を同じ PR 内の別ファイルに適用していない。実測の 4 か所: `getProfile.ts:11`（"A read of one's own profile has no usecase in the spec"）/ `__tests__/getProfile.test.ts:17`（"It has no spec TC of its own"）/ `__tests__/checkHandleAvailability.test.ts:12`（同）/ `apps/web/app/components/settings/ProfileForm/action.ts:4`（"UC-identity-017 の対になる読み side" — 実在するのは `UC-identity-022`）。**コメント文字列のみを変更し、式・型・引数は 1 文字も触らない**（U7 と同じ扱い） | 0 |
| M-68 `spec/manual-tests/account.md:535-581:ユースケースエラーケース対応表` | 本 PR が新設した ADR 057 の追随規則を、その ADR を新設した本 PR 自身が破っている（`usecase:B-005`） | fix | R1 の M-17 と同型の再発（追随先が集計行から対応表本体へ移っただけ）。実測: 本 PR は usecase のエラーケースを 10 行以上足している（`startOAuthFlow` の `UNAUTHENTICATED` / `completeOAuthSignIn` と `linkOAuthIdentity` の `PROVIDER_ACCOUNT_RELEASE_PENDING` / `addPasswordIdentity` 3 行 / `getProfile` 3 行 / `checkHandleAvailability` 1 行 / `completeOAuthCallback` 2 行 / `recalculateStorageUsage` の `InsufficientRole`）が、`git diff` で対応表に増えた行は `verifyEmail \| 一時障害（再試行導線） \| 対象外` の **1 行だけ**。UI から再現できないものは既存様式どおり `対象外` ＋ 理由 1 行でよい。あわせて `spec/adr/057` の決定に「本文（scenario）由来で手作業再現不能な経路も対応表に `対象外` として残す」を明記し、表と ADR の言うことを一致させる（既存の「一時障害」行を消さずに正当化する向き。TC の増減が無いので `spec/manual-tests/index.md` の集計は動かない） | 0 |
| M-69 `apps/web/app/presentation/session.ts:17-18:Secure の JSDoc` | 「the spec mandates it unconditionally」が M-40 の spec 修正で偽になった（`presentation:B-001`） | fix | R1 の M-40 の片側置き去り。実測: `spec/presentation/index.md:40` は「外すのは平文 `http` で動く `development` の配備だけで、判定は許可リストで行う（ADR 037）」へ改訂済みなのに、`session.ts:17-19` は今も「spec は無条件だが自分は外している」と述べる。M-02 / ADR-030 と同型（実装が spec を名指しで否定する）。同ファイル `:32` の中立な書き方（`spec/adr/037` 参照）と `oauthStateCookie.ts:17-19` へ寄せれば足りる。コメント文字列のみ | 0 |
| M-70 `spec/presentation/index.md:236 + spec/inventory/frontend.md:121:削除 status の語彙` | `failed` を含む 5 値の表示要求が、新設した 3 値 CHECK と矛盾（`presentation:B-002`） | fix | **どちらも正本ではなく、名前空間が 2 つ混ざっている**というのが実測の結論。3 値（`running` / `completed` / `rejected`）は `packages/core/src/application/ports/distributedOperationStore.ts:11` と `spec/database/index.md:138` の CHECK と `spec/domains/index.md:147` に一貫し、`getAccountDeletionStatus.ts:35` が `operation.state` をそのまま返す。`accepted` は 202 応答の transport status で `spec/presentation/index.md:234` に説明がある。`failed` だけが**どこにも生成経路を持たない**（manifest header の state 集合にも無く、`deleteAccount` の手順が `failed` へ移す記述も無い）。**spec を狭める向き（`failed` を落とす）は採らない**（`spec/adr/046`）。**CHECK を 4 値へ広げる向きも採らない**（生成する遷移が設計に無い以上、実装に無い遷移を spec が新設することになり AC-63 の趣旨から外れる）。採る修正は語彙の帰属の明記に限る — `spec/presentation/index.md:236` に (a) `running` / `completed` / `rejected` は `distributed_operations.state` の 3 値そのもの、(b) `accepted` は 202 応答の transport status、(c) `rejected` が P-25 の状態直和の「実行不可」に着くこと、を書き、`PAGE-p25-003` / `PAGE-p25-004` を同じ粒度へそろえる。**`failed` の生成経路（`failed` を状態語彙に足して遷移を定義するか、`rejected` に畳むか）の決定は Phase 5 の起票へ 1 項目足して追跡する**（M-28 と同じ扱い） | 0 |
| M-71 `conformance/noteProjection.ts:13,87 + .thread/14/adr.md:1062:ADP-note-056 の到達性` | 短縮連記のため `ADP-note-056` が grep で 0 件、その一方で ADR-029 影響節は「全数拾える」と書いている（`domain:W-001` + `docs:W-002`） | fix | 実測: `grep -rn "ADP-note-056" packages/` = **0 件**（`it("ADP-note-055/056: …")` から `-o` が取れるのは `ADP-note-055` だけ）。`spec/inventory/adapter.md:241` に `ADP-note-056`（`PublicNoteProjectionWriter.redactAuthor`）は本 PR が新規採番した行なので、M-11 が問題にした「採番したのにスイートのどこからも名乗られない ID」が 1 本残っている。`ADP-identity-041/009` の `009` は別ケースが単記するので到達性が保たれており、同型ではない。**連記は ID を省略せず全形で書く**（`ADP-note-055/ADP-note-056`、ヘッダーも `ADP-note-028..034, ADP-note-055, ADP-note-056`）。あわせて ADR-029 影響節の検査を実行可能な形へ直す（`-r` が無い / 連記を分解しない）か、トレードオフ節へ「連記は素朴な `-o` 抽出では拾えない」を明記する | 0 |
| M-72 `conformance/identityUniqueDirectory.ts:196:ADP-identity-007 の連記` | `ADP-identity-007` に新設した契約（`releasing` の鍵は奪えない）を拘束する唯一のケースが、その ID を名乗っていない（`domain:W-002`） | fix | `spec/inventory/adapter.md:56` の要点欄に足した主張を拘束するのは `it("ADP-identity-041: a releasing key stays blocked for another user until release")` の 1 本だけで、`ADP-identity-007` を名乗る 4 本（`:62` `:70` `:92` `:103`）はいずれも `releasing` を扱わない。主張の中身は `beginRelease`（041）と `reserve`（007）の協調なので、ADR-029 が `041/009` を認めたのと同じ根拠で連記が要る。`it` 名の文字列のみ（M-71 の全形連記に合わせる） | 0 |
| M-73 `spec/domains/index.md:312:continuationKey の除外条件` | 「identity 系でこの鍵を持たないのは 1 つだけ」の断定が、同じ diff で追加した `identity.personalCleanupHandoverContinued` と噛み合わない（`domain:W-003`） | fix | 実測: `:302` に本 PR が足した `identity.personalCleanupHandoverContinued` の payload は `{ deletionOperationId }` で `continuationKey` を持たない。既存の `identity.personalBarrierPruneContinued` も同じ。どちらも scope 平面（`scheduled_tasks` の `(kind, operation_id)`）で、直前の文が既にその導出を述べているので読み替えれば整合するが、断定の主語（ドメイン軸の「identity 系」）と除外の軸（平面）が揃っていない。「**global outbox で運ぶ identity 系の継続要求のうち**この鍵を持たないのは…」と平面を明示する（M-22 と同じ精度） | 0 |
| M-74 `spec/usecases/identity.md:632:updateProfile 手順 2` | M-23 で精密化した `reserve` の衝突条件が `updateProfile` 手順 2 へ伝播していない（`domain:W-004`） | fix | 実測: `:344`（`linkOAuthIdentity` 手順 3）は M-20 の fix で「`resolve` が返すのは恒久 claim の持ち主だけ／進行中の `reserved` や解除待ちの `releasing` との競合は後続の `reserve` が同じコードで返す」へ書き換わったのに、構造的に同型の `:632` は「別 user の active/reserved 行があれば `ConflictError("HANDLE_ALREADY_USED")`」のまま。実装 `adapters/memory/repositories/identityUniqueDirectory.ts:50-68` の判定材料は `operationId` の一致と失効 `reserved` の例外であって利用者ではない。`:344` と同じ粒度へそろえる（R1 で最も多かった「片側だけ直して対になる側が置き去り」の同型） | 0 |
| M-75 `domain/identity/ports/authTokenRepository.ts:21-27:JSDoc の呼び出し元` | 本 PR が spec 側で名指しした 2 つの呼び出し元のうち 1 つしか挙げていない（`domain:W-005`） | fix | 実測: `spec/domains/identity.md:449` は「再送間隔の判定はここを通す（`resendVerificationEmail` / `requestPasswordReset`）」と 2 つを名指しし、実装も両方が呼ぶ（`application/identity/resendVerificationEmail.ts:65` / `requestPasswordReset.ts:88`）。ポート JSDoc は `resendVerificationEmail` のみ。ADR 026 が契約の正本をポート定義に置く以上、JSDoc だけを読んだ実装者が「パスワード再設定の 60 秒間隔はこの索引の担保外」と読みうる。1 語の併記 | 0 |
| M-76 `application/identity/{addPasswordIdentity,changePassword}.ts:UC ID` | 名乗る UC ID が台帳と入れ替わっている（`usecase:W-001`） | fix | 実測: `addPasswordIdentity.ts:15` が `UC-identity-014`、`changePassword.ts:26` が `UC-identity-013` を名乗るが、`spec/inventory/usecase.md:26,27` は `013` = `addPasswordIdentity` / `014` = `changePassword`。本 PR 由来ではない既存の取り違えだが、本 PR は AC-56 で `UC-identity-013` の要点欄を再認証の記述で書き換えており、その ID を名乗るファイルが `changePassword.ts` である状態が残る。ADR 052 の「ID は識別子であって行位置ではない」を前提にすると、ID を名乗る側の誤りは台帳の並び順より害が大きい。コメント文字列のみの入れ替え | 0 |
| M-77 `spec/testcases/identity/requestPasswordReset.md:10 + spec/inventory/test.md:333` | 期待結果に、そのテストケースからは観測できない全称否定（「絞りはこの発行間隔ひとつだけ」）が入っている（`usecase:W-002`） | fix | M-26 のトリアージが要求したのは `:10` を「60 秒の発行間隔に掛かり…」へ書き換えるところまでで、括弧内は**指摘への回答**が期待結果欄に残った形。「絞りが 1 つしかない」は 1 回の要求から観測できず判定基準にならない。同じ事実は `spec/usecases/identity.md` の処理フローとエラーケース表が既に定めている。括弧を落として止める（台帳行も同文） | 0 |
| M-78 `spec/testcases/identity/startOAuthFlow.md:5 + spec/inventory/test.md:405` | 出力 DTO に `state` を足したのに、TC 行が応答の `state` に触れていない（`usecase:W-003`） | fix | 実測: `spec/usecases/identity.md:216-220` が出力 DTO に `state` を足し「転送境界がプロバイダーの URL を再パースせずにフローを開始したブラウザーへ束縛できるよう別に露出する（ADR 034）」と理由まで書き、`spec/inventory/usecase.md:17` も追随済み。自動テスト `__tests__/startOAuthFlow.test.ts:35` の `expect(view.state).toBe(state)` も拘束している。TC 行だけが「保存される」しか言わない。`TC-identity-264` の期待結果に 1 句追記（新規採番は不要） | 0 |
| M-79 `spec/inventory/domain.md:280 ほか 2 組:DOM 行 ↔ ADP 行の非対称` | 同じポートメソッドの DOM 行と ADP 行が本 PR で新たに食い違った 3 組（`inventory:W-001`） | fix | 実測で 3 組とも `origin/main` では要点欄が一字一句同じで、本 PR が ADP 側だけを伸ばした: `DOM-note-037` ↔ `ADP-note-021`（`highlightedExcerpt` のエスケープ）/ `DOM-common-013` ↔ `ADP-common-012`（再投入された `begin` は記録済みをすべて保つ）/ `DOM-storage-034` ↔ `ADP-storage-020`（存在しない key も許容する）。とくに `ADP-note-021` の主張は `spec/domains/note.md:525-528` の**描画契約**（ドメイン側の正本）由来でアダプター実装の詳細ではなく、M-32 で `DOM-common-009/018/020/022` を直した基準がそのまま当たる。残り 2 組は DOM 行の「冪等に開始する」「冪等に削除する」でおおむね含意されるが、1 句そろえるほうが安く、非対称を欠陥と読ませない。3 組とも DOM 行へ 1 句足す（ADR 052 に例外規定を書き足す案は採らない — 直近に新設した ADR の再改訂を重ねない） | 0 |
| M-80 `.thread/14/plan.md:111,125:AC-55 / AC-64` | 台帳・TC の実測が受け入れ基準を追い越したまま、採番系 AC が更新されていない（`inventory:W-002` + `docs:W-003`） | fix | 実測: AC-55 は「新規 19 行」と閉じた列挙で書くが、R1 の M-07 で `DOM-identity-063`（`AccountDeletionRetryPolicy`）が増え実測は **20 行**（列挙にも無い）。AC-55 の grep 検査はパターンが `063` を含まないので機械検査ではこのずれを検出できない。AC-64 は採番対象を「新設 3 ファイルの行 ＋ `requestPasswordReset.md` の境界 2 行」と書くが、実測は `TC-identity-305`〜`329` の **25 行**で、内訳は `getProfile` 6 / `checkHandleAvailability` 8 / `completeOAuthCallback` 6 / `requestPasswordReset` 2 / **`addPasswordIdentity` 3**（M-05 由来）。M-61 が AC-63 を実測へ改めたのと同じ理由で台帳側だけが取り残された。「列挙に無い行が出たらスコープ逸脱」と読む検証者が正しい PR を逸脱と判定しうる。**M-63 / M-64 / M-65 が新たに採番する `DOM-identity-064,065` / `TC-identity-330,331` / `TC-usage-073` も同じ AC に反映する**。AC-63 のコード差分件数も同時に実測へ改める（M-67 / M-69 / M-71 / M-72 / M-75 / M-76 の分） | 0 |
| M-81 `spec/inventory/usecase.md:36:UC-identity-024` | 要点欄だけが `intent: "integration"` の拒否分岐を落としている（`inventory:W-003`） | fix | 本 PR は M-24 の fix として `spec/usecases/identity.md` の手順 3・エラーケース表・`spec/testcases/identity/completeOAuthCallback.md`・`TC-identity-328` の **4 か所すべて**に「`integration` は本スライスに受け皿が無いため state を無効として扱う」を入れたのに、同じ PR が新設した `UC-identity-024` の要点欄だけが判別共用体の 3 番目の arm と 4 つ目の畳み込み条件に触れていない。台帳だけを読むと `intent` が 2 値に見え、新設ユースケースなので実装者が最初に当たる行でもある。畳み込み条件の列挙に 1 語加える | 0 |
| M-82 `spec/inventory/frontend.md:20 + spec/pages/index.md:176:PAGE-p03-004` | 状態列挙が R1 の修正で「無効」を落とし、実装より狭くなった（`presentation:W-001`） | fix | 実測: `origin/main` は「使用済み・無効状態から P-02 へ遷移する」、本 PR は「確認済み・サインインが必要 / 使用済みの状態から」で**無効を落とした**（M-10 の波及が生んだ退行）。実装 `apps/web/app/components/auth/VerifyEmailPanel/index.tsx` は `verifiedSignInRequired`（`:141`）と `alreadyVerified`（`:151`）が `PrimaryLink to="/signin"` を、`expired`（`:160`）と `invalid`（`:167`）が `ResendActions` 内の「サインインへ」リンク（`:200-204`）を描くので、導線は **4 状態**から出る。同じ PR が `PAGE-p03-003` では「期限切れ・無効」と正しく 2 状態を書いており、隣接行で粒度が割れている。**対になる `spec/pages/index.md:176` の状態行も同時に直す** — 現状は「使用済み（サインインへ）/ 期限切れ（再送）/ 無効（再送）」で、期限切れ・無効が再送フォーム下にサインイン導線を持つことを書いていない。台帳だけを直すと本文との乖離を新設する | 0 |
| M-83 `spec/database/index.md:35,1027-1037:applied_operations の鍵` | ポートの鍵を `(operationId, commandKey)` と書きながら、列定義には `command_key` が無く PK は `operation_id` 単独のまま（`presentation:W-002`） | fix | 実測: 本 PR が `:35` と `:1037` の 2 か所で `(operationId, commandKey)` を正典として書いたが、直下の列表は `operation_id \| text \| PK` のまま。実装は衝突しない — `adapters/memory/repositories/appliedOperationStore.ts:9-13` が `sha256("${operationId}:${commandKey}")` を単一列へ畳んでおり、その JSDoc は「mirroring the single `operation_id` primary key of spec/database's `applied_operations`」と spec を根拠にしている。**畳み込み規則が spec 側にだけ無い**。同じ文書は `scheduled_tasks.operation_id` については導出式を明記しているので様式としても非対称。**列を増やして PK を 2 列にする案は採らない**（barrier receipt と同居する表の設計を変えることになり、実装の JSDoc も偽になる）。新設段落に畳み込み式の 1 文を足す | 0 |
| M-84 `.thread/14/adr.md:1096:ADR-030 の影響節` | 挙げている検証コマンドが HEAD で 0 件にならない（`docs:W-001`） | fix | 実測: `grep -rn "the spec writes\|the spec's" packages/ apps/` は **2 件**（`application/identity/uniqueness.ts:193` の "per the spec's convergence" / `application/identity/updateProfile.ts:36` の "the spec's spelling of"。ほかに `apps/web/dist/` のビルド成果物 1 件）。どちらも spec を**否定**しておらず ADR-030 の決定自体は達成されているが、読者に渡した機械検査が落ちる。ADR-024 / ADR-031 が同じ様式で書いた grep は実際に 0 件で通るので、ここだけ検査として成立しない。検査語を否定形に絞る（`"the spec writes"` / `"has no usecase in the spec"` / `"no spec TC"` / `"spec の記載漏れ"`）か、影響節から grep を落として決定文だけを残す。**M-67 の fix 後に語を確定させる** | 0 |
| M-85 `.dockerignore:11:!.env.*.example` | U9 の削除で対象を失った否定パターンが残っている（`docs:W-004`） | fix | 実測: `git ls-files` で `.env.*.example` に一致する追跡ファイルは **0 件**（`apps/web/.env.example` は直前の `!.env.example` が拾い、`.envrc.example` は `.env.` で始まらない）。U9（M-46）は同じファイルから `**/.wrangler` / `infra/aws/cdk.out` を落としたが、削除 3 本を再包含するためのこの行だけが残った。片側だけ直して対になる行が残った形。1 行削除。Phase 5 の 13.（`.dockerignore` をファイルごと消すか）はこの行に触れていないので、本 PR で落とす | 0 |
| M-86 `.thread/14/research-2.md:448,531:「レビュー R1」の見出し` | 乖離台帳が「レビュー R1」を本 PR のレビュー R1 とは別の意味（計画レビュー R1）で使っている（`docs:W-005`） | fix | 台帳は冒頭で as-of `55a5bb9` を宣言しており（M-19）、本 PR のレビュー R1 より前の状態を記録する成果物。同じ `.thread/14/` の `plan.md` / `adr.md` / `review/triage.md` は「レビュー R1」を **PR レビュー R1** の意味で一貫して使う（`adr.md:972` / `plan.md:210`）。同じ語が同じディレクトリで 2 つのラウンドを指し、「as-of 以降の出来事が台帳に混ざっている」と誤読させる。M-56 が台帳からレビュー経緯を落とした結果、この 1 語だけが残った。由来を書かない中立な見出しへ改める（plan.md の他所は `計画レビュー R1 / R2 / R3` と明示しているので、台帳だけが省略形） | 0 |
| M-87 `spec/testcases/identity/updateProfile.md + spec/inventory/test.md:avatar 関連 TC 行` | `AvatarUrl` の契約を spec 本文と台帳に足したのに、それを拘束する自動テスト 3 本に対応する TC 行が無い（**指摘由来ではない。V2 が M-63 の作業中に発見**） | fix | M-63 と同クラスの欠落で、片側（本文・DOM 行）だけ直して対になる側（TC 行）が置き去りになる R2 で最も多かった形。実測: `__tests__/updateProfile.test.ts` の `describe("updateProfile avatar URL")` が 3 ケース（アプリ相対パスの受理 / 別オリジンとプロトコル相対の拒否 / `null` での解除）を拘束するのに、`spec/testcases/identity/updateProfile.md` と `spec/inventory/test.md` には行が無い。M-63 が `AvatarUrl`（`DOM-identity-064`）と `SameOriginPolicy`（`065`）を台帳に載せた以上、その契約を確かめる TC が台帳から辿れない状態は残せない。**追加単位 V12 で対応** — `updateProfile.md` に 4 行（拒否は 2 条件なので 2 行に割る）、identity 群末尾へ `TC-identity-332`〜`335` を採番、`it` 名 3 本に ID を名乗らせる（1 本は `TC-identity-333 / TC-identity-334` の連記。**ADR-035 と同じ全形**）。**対応済み** | 0 |

## 実地検証の結果

**29 件すべてについて `spec/` の実物・実装コード・`git diff 55a5bb9 HEAD` に当たった。事実として誤っていた指摘は 0 件。** 主な確認:

- `describe` 名に ADP ID を持つケースは 0 件、`it` 名は 166 件。`spec/adr/026` に ID 命名規約の記述が無いこと（M-62）
- `AvatarUrl` / `SameOriginPolicy` が実装に実在し、`spec/` には `InvalidAvatarUrl` の union 行しか無いこと。設計判断は `spec/adr/051` に既にあること（M-63）
- `PROVIDER_ACCOUNT_RELEASE_PENDING` が usecase / UC 台帳・実装・自動テストに実在し、テストケース表と `spec/inventory/test.md` にだけ無いこと（M-64）
- `recalculateStorageUsage.ts:38-46` が `InsufficientRole` を投げること（M-65）
- `storeUpload` の入力から宣言値が落ち、`declaredMimeType` を受ける実装経路が 0 件であること（M-66）
- `git diff` で対応表に増えた行が `verifyEmail \| 一時障害` の 1 行だけであること（M-68）
- `DistributedOperationState` が 3 値で `failed` の生成経路が `spec/` のどこにも無いこと、`accepted` は 202 の transport status として説明が付くこと（M-70）
- `grep -rn "ADP-note-056" packages/` = 0 件（M-71）
- `.env.*.example` に一致する追跡ファイルが 0 件（M-85）

**軽微な計数のぶれが 1 件**（指摘の成否には影響しない）: `domain:B-002` は `describe` を 31 本、`inventory:B-001` は 34 本と書き、`docs:B-001` は本数を書いていない。実測は **34 本**（`grep -c 'describe('`。入れ子の `describe` を含む）。いずれも「ADP ID を含むものが 0 本」という主張は同じで、修正内容は変わらない。

## 修正の実行計画

編集ファイルが重ならないよう **12 単位**に分割した（V12 は M-87 の発見後に追加）。**V1〜V10 / V12 は並列実行可**。V11 のみ V7 / V8 / V9 / V12 の完了後に走らせる。

R1 で最も多かった失敗は「片側だけ直して対になる側が置き去り」なので、各単位に**対になる側**を明記する。単位をまたぐ対は、先に確定する側の文言をそのまま写すこと。

### V1 — ADP 追跡規約（ADR ＋ 台帳ヘッダー ＋ ADR 索引）

- 担当: M-62
- 編集ファイル: `spec/adr/052-adapter-inventory-granularity.md`（`:13` / `:19` / `:23` / `:52`）, `spec/inventory/adapter.md:5`, `spec/adr/index.md:114`
- 対になる側: **適合スイートの `it` 名**（V7 が触る）。V1 は「`describe` / `it` 名に ADP ID を含める命名規約（実際は `it` 名が主で、ポート群の範囲はファイル冒頭 JSDoc が示す）」で統一し、V7 はその規約に合う形で連記を全形化する。**`describe` 名へコードを付け替えない**
- 順序制約: なし。`:19` の前提は ADR 026 から引ける範囲に留め、ID 命名規約は 052 自身の決定として立てる（`spec/adr/026` は本 PR の対象外なので触らない）

### V2 — `spec/domains/` ＋ `spec/inventory/domain.md`

- 担当: M-63, M-73, M-79
- 編集ファイル: `spec/domains/identity.md`, `spec/domains/index.md`, `spec/inventory/domain.md`
- 対になる側: **本文と台帳の両方をこの単位が持つ**（M-63 の `AvatarUrl` / `SameOriginPolicy` は定義と `DOM-identity-064` / `065` の両方、M-79 は DOM 行と既存 ADP 行の文言そろえ）。`spec/inventory/adapter.md` は V1 の担当なので**書き換えない** — M-79 は DOM 行を ADP 行へ寄せる向きだけ
- 順序制約: `AvatarUrl` は既存 VO 節（`DisplayName` / `Bio`）と同じ様式（**フィールド** / **バリデーション**）、`SameOriginPolicy` は既存 4 ドメインサービスと同じ様式で書く。`spec/adr/051` を根拠としてリンクする。台帳行は既存の VO 行 / ドメインサービス行と同じ粒度（`DOM-identity-006〜008` / `019〜021` / `063`）。新規採番は identity 群の末尾（実測の最大は `DOM-identity-063`）

### V3 — `spec/usecases/` ＋ `spec/inventory/usecase.md`

- 担当: M-65（本文）, M-74, M-81
- 編集ファイル: `spec/usecases/identity.md`, `spec/usecases/usage.md`, `spec/inventory/usecase.md`
- 対になる側: **M-65 のテストケース行と台帳行は V4 が担当**（`BusinessRuleError(InsufficientRole)` の文言をそろえる）。**M-64 の usecase 側は既に入っている**ので V3 は触らない
- 順序制約: M-74 は `spec/usecases/identity.md:344`（`linkOAuthIdentity` 手順 3）と**同じ粒度・同じ語**へそろえる。M-65 の処理フローは手順を 1 本足して以降を繰り下げるので、この節の手順番号を外部から参照している箇所が無いことを `grep "手順 [0-9]"` で再確認する（R1 の M-03 と同じ検査）

### V4 — `spec/testcases/**` ＋ `spec/inventory/test.md`

- 担当: M-64, M-65（TC 行）, M-66, M-77, M-78
- 編集ファイル: `spec/testcases/identity/{completeOAuthSignIn,linkOAuthIdentity,requestPasswordReset,startOAuthFlow}.md`, `spec/testcases/usage/recalculateStorageUsage.md`, `spec/testcases/storage/storeUpload.md`, `spec/inventory/test.md`
- 対になる側: **テストケースファイルと `spec/inventory/test.md` の行は必ず同文で対にする**（1 ファイル = 1 群、行数一致）。M-65 の本文側は V3、M-64 の usecase / UC 台帳側は既存
- 順序制約: 新規採番は各群の末尾 — `TC-identity-330` / `331`（実測の最大は `329`）、`TC-usage-073`（実測の最大は `072`）。M-66 と M-77 は**行の削除ではなく書き換え**（連番に穴を空けない）。M-78 は既存行への追記で新規採番しない

### V5 — `spec/pages/index.md` ＋ `spec/presentation/index.md` ＋ `spec/inventory/frontend.md` ＋ `spec/database/index.md`

- 担当: M-70, M-82, M-83
- 編集ファイル: `spec/pages/index.md`, `spec/presentation/index.md`, `spec/inventory/frontend.md`, `spec/database/index.md`
- 対になる側: **M-70 は `spec/presentation/index.md:236` と `PAGE-p25-003` / `PAGE-p25-004` の 3 か所を同時に**。**M-82 は `spec/inventory/frontend.md:20`（`PAGE-p03-004`）と `spec/pages/index.md:176`（P-03 の状態行）の 2 か所を同時に** — 台帳だけを直すと本文との乖離を新設する。M-83 は `spec/database/index.md` の `:35` と `:1037` の 2 か所が同じ鍵を書いているので、畳み込み式は列表の直下の新設段落へ 1 文
- 順序制約: **M-70 は `failed` を削らず、CHECK も広げない**。`running` / `completed` / `rejected` が `distributed_operations.state` の 3 値そのもの、`accepted` が 202 応答の transport status、`rejected` が P-25 の「実行不可」に着くことを書く。`failed` の生成経路の決定は V9 が Phase 5 の起票骨子へ 1 項目足して追跡する

### V6 — `spec/manual-tests/` ＋ `spec/adr/057`

- 担当: M-68
- 編集ファイル: `spec/manual-tests/account.md`, `spec/adr/057-manual-test-followthrough.md`
- 対になる側: **本 PR が増やした usecase エラーケースの全数**（`startOAuthFlow` の `UNAUTHENTICATED` / `completeOAuthSignIn` と `linkOAuthIdentity` の `PROVIDER_ACCOUNT_RELEASE_PENDING` / `addPasswordIdentity` の 3 行 / `getProfile` の 3 行 / `checkHandleAvailability` の 1 行 / `completeOAuthCallback` の 2 行 / `recalculateStorageUsage` の `InsufficientRole`）。V3 / V4 が触る `spec/usecases/` のエラー表を**読んで**数え、表に載せる（V3 / V4 のファイルは編集しない）
- 順序制約: TC は増やさないので `spec/manual-tests/index.md` の集計行は動かさない（動かしたら ADR 057 の決定どおり実測で更新する）。既存の `verifyEmail \| 一時障害` 行は消さず、ADR 057 の決定へ「本文（scenario）由来で手作業再現不能な経路も `対象外` として残す」を明記して軸を広げる

### V7 — コード: 適合スイートの ID 命名

- 担当: M-71（コード側）, M-72
- 編集ファイル: `packages/core/src/adapters/conformance/noteProjection.ts`（`:13` ヘッダー / `:87` の `it` 名）, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`（`:196` の `it` 名）
- 対になる側: **V1 の規約文言**（`describe` / `it` 名）と **`.thread/14/adr.md` ADR-029 の影響節**（V11 が直す）
- 順序制約: **`it` 名の文字列とヘッダーコメントだけを変更する**。アサーション・セットアップには触らない。連記は全形（`ADP-note-055/ADP-note-056`、`ADP-identity-041/ADP-identity-007`）。完了後に `grep -rn "ADP-note-056" packages/` と `grep -rn "ADP-identity-007" packages/core/src/adapters/conformance/` がヒットすることを確認し、`pnpm test:unit` で緑を確認

### V8 — コード: application / port / presentation の JSDoc とコメント

- 担当: M-67, M-69, M-75, M-76
- 編集ファイル: `packages/core/src/application/identity/getProfile.ts`, `packages/core/src/application/identity/__tests__/{getProfile,checkHandleAvailability}.test.ts`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/presentation/session.ts`, `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `packages/core/src/application/identity/{addPasswordIdentity,changePassword}.ts`
- 対になる側: M-67 の対は**本 PR が新設した spec 節・TC ファイル・UC 行**（`spec/usecases/identity.md#getProfile` / `#checkHandleAvailability`、`UC-identity-022` / `023`）。M-69 の対は `spec/presentation/index.md:40`（既に改訂済み）と同ファイル `:32` の中立な書き方。M-75 の対は `spec/domains/identity.md:449`。M-76 の対は `spec/inventory/usecase.md:26,27`
- 順序制約: **コメント / JSDoc の文字列のみを変更し、式・型・引数・戻り値は 1 文字も触らない**（U7 / ADR-030 と同じ扱い）。`ProfileForm/action.ts` は `UC-identity-022` を指す

### V9 — リポジトリの残骸 ＋ Phase 5 起票骨子

- 担当: M-85 ＋ M-70 の追跡（Phase 5 の起票骨子へ 1 項目）
- 編集ファイル: `.dockerignore`, `.thread/14/plan.md` の Phase 5 スコープ節
- 対になる側: `.dockerignore:11` の対は U9 が削除した 3 本の `.env*.example`（既に削除済み）。M-70 の対は V5 が書く `spec/presentation/index.md:236`
- 順序制約: `.thread/14/plan.md` は V11 も触るので、**V9 は Phase 5 スコープ節（`:155` 付近）だけ**を編集し、AC 表（`:105`〜`:130`）には触れない。競合を避けるため V9 → V11 の順で走らせてもよい

### V10 — 乖離台帳（`.thread/14/research-2.md`）

- 担当: M-86
- 編集ファイル: `.thread/14/research-2.md`（`:448` / `:531`）
- 対になる側: `.thread/14/plan.md` の「計画レビュー R1 / R2 / R3」という明示形（変更しない側）
- 順序制約: **台帳の再調査はしない。** 見出しの語の是正のみで、件数・分類・as-of には触らない（M-19 / M-51〜M-60 で確定済み）

### V12 — `updateProfile` の avatar 関連 TC 行（追加単位）

- 担当: M-87
- 編集ファイル: `spec/testcases/identity/updateProfile.md`, `spec/inventory/test.md`, `packages/core/src/application/identity/__tests__/updateProfile.test.ts`
- 対になる側: **V2 が書く `AvatarUrl` / `SameOriginPolicy` の定義と `DOM-identity-064` / `065`**（文言をそろえる）。V4 も `spec/inventory/test.md` を触るので、**採番は V4 の `TC-identity-330` / `331` の後ろ**（`332` 起点）
- 順序制約: 新規採番は identity 群の末尾。`it` 名は**文字列のみ**を変更し、アサーションには触らない。連記は全形（`TC-identity-333 / TC-identity-334`）

### V11 — `.thread/14/adr.md` / `plan.md` の受け入れ基準・ADR 更新

- 担当: M-71（ADR-029 影響節）, M-80, M-84
- 編集ファイル: `.thread/14/adr.md`, `.thread/14/plan.md`（AC 表）
- 対になる側: M-71 の対は V7 の連記全形化（**V7 の後に走らせて実際に grep が全数を返すことを確認してから**影響節を閉じる）。M-84 の対は V8 の M-67（残る否定語を確定させてから検査語を決める）。M-80 の対は V2 / V4 の新規採番（`DOM-identity-064,065` / `TC-identity-330,331` / `TC-usage-073`）と V7 / V8 のコード差分
- 順序制約: **V7 / V8 / V9 / V12 の完了後**に走らせる（`git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/` の実測でコード差分ファイル数を確定させるため。**実測は R1 の 27 ファイル ＋ V8 / V12 の新規参入 8 ファイル = 35 ファイル**）。AC-55 は **22 行**（DOM 11 / ADP 8 / UC 3）、AC-64 は **`TC-identity-305`〜`335` ＋ `TC-usage-073` = 32 行**、AC-63 は **35 ファイル / 機械検査 14 行**へ実測で改める。`.thread/14/adr.md` ADR-029 の代替案節が「連記は ADR 052 の不変を一切侵していない」と述べた根拠は、V1 で 052 の文言が `it` 名へ直った後に 1 文で再確認する

### 全単位の完了後

1. `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test:unit`
2. `spec/` 内の相対リンクを実際に解決して存在確認（M-63 が足す `spec/adr/051` リンク、M-68 が触る ADR 057 のリンクを含む）
3. `grep -rn 'describe(' packages/core/src/adapters/conformance/*.ts | grep -c "ADP-"` が 0 であることと、`spec/inventory/adapter.md:5` / ADR 052 の文言がそれと矛盾しないこと（M-62 の閉じ方の確認）
4. `grep -rhoE "ADP-[a-z]+-[0-9]+" packages/core/src/adapters/conformance/ | sort -u` と `spec/inventory/adapter.md` の ADP ID 集合の差分（M-71 / M-72 の到達性）
5. `grep -rn "the spec writes\|the spec's output table\|has no usecase in the spec\|no spec TC\|the spec mandates it unconditionally\|spec の記載漏れ" packages/ apps/` が 0 件（M-67 / M-69 / M-84）。**検査語は否定形に絞る** — `the spec's` 単体は spec を否定していない 2 件を、`the spec mandates` 単体は `noteAccessPolicy.ts:51`（実装が spec に従っている旨）を拾って 0 件にならない
6. `spec/inventory/*.md` 5 ファイルの「最終同期」日付を再更新

---

# 指摘台帳 — PR #22 レビュー R3 のトリアージ

**対象:** `.thread/14/review/review-003-{domain,usecase,inventory,presentation,docs}.md`（Blockers **0** / Warnings **17 件**）
**束ね後:** **15 件**
**判定:** fix **11** / wont-fix **4** / defer 0 / 既出継承 **0**

## 前提

- R1 の `wont-fix`（M-50）/ `defer`（M-06）と Key の一致する再指摘は 5 観点いずれからも無く、**既出継承は 0 件**。R3 の Key はすべて新規なので `M-88` 以降を連番で採る（M-01〜M-87 は動かさない）。
- 妥当性は全件、`spec/` の実物・実装コード・`git diff` に当たって裏を取った。**事実として誤っていた指摘は 0 件。ただし判定の前提が実測と食い違った指摘が 1 件ある**（末尾「実地検証の結果」の `inventory:W-001`）。
- 本 PR はドキュメント同期で振る舞いを変えない（AC-63）。fix の内容はすべて (a) `spec/` 本文・台帳、(b) コメント / JSDoc / テストの `it` 名、(c) `.thread/14/` の作業成果物、のいずれかに閉じる。**実行される振る舞いを変える修正は 1 件も無い。**
- **AC-63 のコード差分件数は変わらない**（M-93 / M-97 / M-102 が触る 7 ファイルは 35 ファイルの内訳にすべて既出。新規参入 0）。機械検査の残り行も **14 行**のまま（実測で再確認）。
- **`spec/` を狭める提案は採らない。** M-99（`ObjectStorage.put` の上書き契約）は「ADP 行から落とす」向きも「本文に無い主張を DOM 行へ足す」向きも採らず、非対称を理由つきで残した（ADR-038）。

## 束ねた指摘

3 組を 1 件に束ね、1 件を判定の割れで 2 行に分けた（17 → 15）。

| 束ね後 Key | 元の指摘 ID | 束ねた / 分けた理由 |
| --- | --- | --- |
| M-90 | `docs:W-003` + `domain:W-003` | 同一問題。`.thread/14/adr.md` の ADR-029 / ADR-035 が書く「到達不能 ID 21 本」の係り受け。2 観点が独立に到達し、実測値（`it` 名由来 20 ＋ ヘッダー由来 1）まで一致した |
| M-93 | `domain:W-002` + `inventory:W-002` | 同一問題の表裏。ADR-035 の「ヘッダーコメントの範囲表記も全形」が 5 ヘッダーに未適用であること（domain）と、そのうち `signInOAuthClient.ts:41` の短縮で `ADP-identity-034` が grep 0 件になること（inventory） |
| M-94 | `usecase:W-001` + `usecase:W-002` | 同一問題。台帳 → コードの到達性を TC ID / UC ID にも要求するかという 1 つの規約面。usecase 観点自身が「W-001 と同じ単位で処理できる」と書いている |
| M-98 / M-99 | `inventory:W-001` | 8 組を 1 件として扱うと判定が割れる。片側の主張が**本文に由来する 3 組**（fix = M-98）と、**由来しない / 言い換え / アダプター固有の注記である 5 組**（wont-fix = M-99）に分けた |

## 台帳

| Key | 指摘 | 判定 | 理由 | 再指摘回数 |
| --- | --- | --- | --- | --- |
| M-88 `.thread/14/steps.md:5,131,451,478,482,483:実測値` | 最終確認手順・コミット表・起票ステップの件数が R1 時点のまま残り、R2 で実測へ改めた `plan.md` の AC と食い違う（`docs:W-001`） | fix | 実測で 3 か所とも確認: 17-3 / `:131` / `:5` は「27 ファイル = 変更 24 / 削除 3」「機械検査 12 行」で AC-63 の 35 ファイル / 14 行と食い違う、17-8 は「`DOM` 8 行」で AC-55 の 11 行と食い違う、17-7 は「7 つの Issue 番号」で AC-60 の参照数と食い違う。**ステップ 17 は実行手順なので、手順どおり検証すると正しい PR がスコープ逸脱と判定される**（R1 の M-45 が `testing.md` について直したのと同じ形が `steps.md` にだけ 2 ラウンド残っていた）。**採る修正は数値の書き換えではなく参照への置き換え** — `testing.md` が採った「件数と内訳の正典は AC-63 だけで、この文書には写さない」と同じ解き方にする（数値を書き直すだけでは次のラウンドでまた陳腐化する）。**あわせてレビューの列挙に無い 2 か所も直す**（下記「実地検証の結果」）— ステップ 16 の見出しと本文が「新規 7 本 ＋ コメント 4 件」と書き、Phase 5 の 12〜17 を落としている（起票の実行手順なので M-89 と同じ「そのまま Issue になる」経路）。`:200` / `:460` の「`spec/adr/026` の命名規約」「`describe` / `it` 名」「25 本」も M-89 と同根 | 0 |
| M-89 `.thread/14/plan.md:169,219:ADP ID 規約` | Phase 5 の起票骨子とリスク節が「適合スイートの `describe` / `it` 名に ADP ID を付ける」と書き、V1（M-62）が確定させた `spec/adr/052` の決定と食い違う（`docs:W-002`） | fix | **そのまま Issue 本文になる骨子が、052 が明示的に棄却した成果物（34 本の `describe` への ADP ID 付与）を指示してしまう。** R2 の M-62 は「plan 側が正しい」と判定したが、その後 V1 が規約を `it` 名一本へ絞ったので両論併記だった plan 側が緩い側になった（`.thread/14/adr.md` ADR-034 の代替案節も「両論併記のまま残す」を明示的に棄却している）。付随する件数も実測と違う — `:219` の「他 20 本は持つ」に対し、`adapters/conformance/` の**スイートは 31 本**（`export function describeXxxContract` の実測。ヘルパー 4 ファイルを除く）で、ADP ID を 1 つも持たないのは列挙どおり **5 本**、持つのは **26 本**。同じ誤りが `.thread/14/adr.md:589`（ADR-015 の Context）にもあるので同時に直す — **片方だけ直すと R1 / R2 で最も多かった「対になる側が置き去り」を作る** | 0 |
| M-90 `.thread/14/adr.md:1063,1261,1267:到達不能 ID の計数` | 「`it` 名の短縮連記 31 ケース、**そのうち**到達できない ID が 21 本」の係り先が実測と 1 本ずれる（`docs:W-003` + `domain:W-003`） | fix | 自作の走査（`it()` の第 1 引数だけを展開し、ディレクトリ全体の `ADP-[a-z]+-[0-9]+` との差を取る）で独立に再実測: 短縮連記は **31 ケースで一致**、そこから到達不能になる ID は **20 本**（列挙とは `ADP-identity-034` の 1 本だけ違う）。21 本目の `ADP-identity-034` は `it` 名に一度も現れず `signInOAuthClient.ts:41` の**ファイル冒頭 JSDoc** 由来で、これは M-93 の 5 ヘッダーの 1 つ。**M-93 を直すと `ADP-identity-034` は単体 grep に当たるようになる**ので、係り受けを直すのではなく **20 本へ改め、列挙から `034` を落とす**（修正後に再実測して 20 / `it` 名由来のみを確認済み） | 0 |
| M-91 `spec/usecases/note.md:847,977:改訂履歴` | 「以前は〜だった」の記述が 2 か所残っている（`docs:W-004`） | wont-fix | **本 PR の編集対象ファイルではない**（`git diff` に現れない）。R1 の M-47 が同型の 3 か所を落としたのは、いずれも本 PR が同じファイルを編集していたため。レビュアー自身も「本 PR では触らない」と結論している。**Phase 5 の 17.(a) として起票リストへ送る**（`spec/` 全域を走査してこの 2 か所以外に同型の残置が無いことも記録した） | 0 |
| M-92 `spec/inventory/domain.md:316,317:DOM-note-071/072` | 本 PR が**同時に新設した** DOM ↔ ADP の対で、ADP 側だけが「行が変わったかを返す」を持つ（`domain:W-001`） | fix | 実測で 4 行とも本 PR の新規採番。主張の出どころは `spec/domains/note.md:550` の interface の戻り値（`Promise<boolean>` ＋ `// 行が変わったかを返す`）で、**ドメイン契約であってアダプター実装の詳細ではない**。M-32 / M-79 が採った基準がそのまま当たり、しかも同時に新設した対なので「本 PR が作った非対称」に当たる。DOM 2 行へ 1 句足して ADP 行と同文にする | 0 |
| M-93 `conformance/*.ts:ヘッダーの短縮連記 5 行` | ADR-035 の「ヘッダーコメントの範囲表記も全形」が、本 PR が**この回で書き換えた** 5 行に適用されていない。うち `signInOAuthClient.ts:41` は `ADP-identity-034` を grep 0 件にしている（`domain:W-002` + `inventory:W-002`） | fix | 実測: `authTokenRepository.ts:9`（`, 039`）/ `accountDeletionManifestStore.ts:26`（`, 041`）/ `objectStorage.ts:23`（`, 024`）/ `scopeCleanupAdmissionStore.ts:28`（`, 040`）/ `signInOAuthClient.ts:41`（`ADP-identity-033/034, 040`）。**5 行とも本 PR がこの回で追記した行**で、ADR 052 の影響節が定める「全形への書き換えはそのケースに触れた回で行う」に自ら反している。V7 が触った 2 ファイル（`noteProjection.ts:13` / `identityUniqueDirectory.ts:11`）は既に全形なので、同一 PR 内で扱いが割れている。**ADR-035 の決定からヘッダーの一文を落とす案は採らない** — 落とすと `ADP-identity-034` の到達不能が規約上正当化され、M-71 が閉じた面が別の場所で開く。文字列のみの変更で、修正後に `grep -rn "ADP-identity-034" packages/` が 1 件ヒットすることを確認した | 0 |
| M-94 `spec/inventory/{test,usecase}.md ↔ コード:TC / UC ID の名乗り` | 新規採番した TC 32 行のうちコードから到達できるのは 4 行、新設 UC 3 本のうち名乗るのは 1 本（`usecase:W-001` + `usecase:W-002`） | wont-fix | **規約として意図的に許容する。ただし扱いが割れている理由を記録する（`.thread/14/adr.md` ADR-037）。** ADP ID の名乗りが規約なのは、ADR 052 が適合ケースに台帳行を採番しないと決めた結果、**行を持たないケースと行を持つメソッドを結ぶ手段が `it` 名しか無い**ためで、TC / UC にはその事情が無い（TC 行は `spec/testcases/{domain}/{usecase}.md` の 1 行と、UC 行は「1 ユースケース = 1 テストケースファイル = 1 UC 行」の不変で節と、それぞれ 1 対 1）。**全 TC / 全 UC に名乗らせる案は採らない** — 本 PR の採番分だけが名乗る新しい非対称を別の場所に作り直すことになり、既存 2440 行には掛からない。**逆に既に名乗っている分（`TC-identity-332`〜`335` / `UC-identity-022` / identity の application 19 ファイル）を外す案も採らない** — R2 の M-87 が閉じた到達性が戻る | 0 |
| M-95 `spec/manual-tests/account.md:535-581:対応表` | `requestPasswordReset \| レート制限` の行だけが対応表に無い（`usecase:W-003`） | wont-fix | **本 PR 由来ではない既存の欠落。** 実測: 対応するエラーケース行は `origin/main` の `spec/usecases/identity.md:418` に既にあり、本 PR が増やした失敗経路ではない（M-68 / ADR-036 が対応表へ足す対象は「本 PR が増やした条件」で、この行はそれに当たらない）。**Phase 5 の 17.(b) として起票リストへ送る** | 0 |
| M-96 `spec/testcases/storage/storeUpload.md:36 + spec/inventory/test.md:1932:TC-storage-221` | 前提条件が「宣言 MIME・宣言サイズを渡す経路が無い」で、手で用意できる状態ではなく入力 DTO の形の言明になっている（`usecase:W-004`） | fix | **本 PR（R2 の M-66）が書いた文言**で、テストケース表の前提条件欄の様式（実際に用意できる状態）に反する。M-77 が `TC-identity-192` の期待結果から落とした「そのテストケースからは観測できない主張」と同じクラスが、欄を変えて残った形。**行の削除ではなく書き換え**（連番に穴を空けない）で、前提条件を実バイト長の具体値へ、入力 DTO の言明を期待結果の後半へ移す。`spec/inventory/test.md` の行も同文にする。要素欄が変わるが、R3 の inventory 観点が「同じ要素の言い換え」として扱った 8 行と同じ扱いで、ID の指す先は変えない | 0 |
| M-97 `deleteFilesByOwner.test.ts:358:it 名` | `TC-storage-043 (without the statement-count promise)` の括弧書きが改訂前との差分を述べている（`usecase:W-005`） | fix | `spec/index.md:5` / `CLAUDE.md:16` が正典から排した「以前は〜だった」と同じ形。R1 の M-47 が `spec/` の 3 か所から落とした際にテスト側のこの 1 か所が残った（M-12 は `:252` の接頭辞を外すところまでで `:358` の文言に触れていない）。改訂後の台帳行が「バックエンドが発行する文の数はここでは約束しない」と明記しているので、括弧書きが担う情報は無い。`it` 名の文字列のみ | 0 |
| M-98 `spec/inventory/{domain,adapter}.md:本文由来の主張が片側にしか無い 3 組` | `ObjectStorage.get` / `NoteRouteFanOutReader.listByCreatedBy` / `listByScope` で、片側にしか無い主張が本文に由来する（`inventory:W-001` の一部） | fix | 実測: 3 組とも `origin/main` では要点欄が一字一句同じで、**本 PR が片側だけを伸ばした**（M-79 が直した 3 組と同じ形）。主張の出どころも本文にある — `ObjectStorage.get` の「未知の key では null を返す」は `spec/domains/storage.md:292` の interface が `Promise<ObjectBody \| null>` と型で書いている契約そのもので、DOM 行だけが落としている。`tombstone` unspecified は `spec/domains/note.md:676` が「**アダプターは**失効まで残しても物理的に回収してもよく、呼び出し側はどちらも許容しなければならない」と**アダプター向けに**書いた段落で、ADP 行に無いのは届く先が逆。薄い側へ 1 句足す（DOM 1 行 ＋ ADP 2 行） | 0 |
| M-99 `spec/inventory/{domain,adapter}.md:残り 5 組` | 同じポートメソッドの DOM 行と ADP 行が食い違う残り 5 組（`inventory:W-001` の残り） | wont-fix | 一行理由: **片側の主張が本文に由来しない / 同じ主張の言い換え / アダプター実装者だけに向いた注記**で、そろえると台帳が本文を追い越す（`.thread/14/adr.md` ADR-038）。内訳 — `ObjectStorage.put` の「既存 key は上書きする」は `spec/domains/storage.md` の `ObjectStorage` 節に記述が無く、DOM 行へ足すと R3 の `inventory:W-004` が指摘したのと同じ「台帳が本文を追い越す」形を別の行で作る（ADP 行から落とす向きは spec を狭めるので採らない）。`NoteRepository.listByOwner` の「ページ境界で重複・欠落を出さない」は DOM 行の「`updatedAt DESC, id DESC` の全順序」が含意する。`NoteRouteStore.resolveMany` の「上限超過は」/「501 件目からは」と `IdentityUniqueDirectory.reserve` の 2 文は同じ主張の言い換え。`IdentityRepository.insert` の「DB 側に一意制約を置くのは自由だが契約としては要求しない ＋ ADR 054」は**アダプター実装者に向けた注記**で、`adapter.md` にあることが正しい | 0 |
| M-100 `.thread/14/plan.md:112:AC-56` | 本 PR が要点欄を書き換えた UC 行は 11 行だが AC-56 の列挙は 9 行で、`UC-storage-002` / `003` を plan のどの AC も指していない（`inventory:W-003`） | fix | 独立に実測（`git diff` の `spec/inventory/usecase.md` で追加された表行の UC ID を数える）: 変更 14 行のうち 3 行は新設（`UC-identity-022`〜`024` = AC-55 の担当）で、残り **11 行**が要点欄の改訂 — `UC-identity-005,006,007,011,013` / `UC-storage-002,003,004,013` / `UC-usage-005,007`。差の 2 行は R1 の M-08（ADR 050 の DTO 縮小）由来で、`grep -n "UC-storage-002" .thread/14/plan.md` は **0 件**。M-80 が AC-55 / AC-63 / AC-64 に入れた「実測と列挙が一致するかで見る」但し書きが、同じ採番・台帳系の AC-56 にだけ掛かっていない | 0 |
| M-101 `spec/inventory/frontend.md:99,100:PAGE-p21-001/002` | 台帳が、定義場所として指す本文に無い主張（`getProfile` / `checkHandleAvailability` からの供給）を持つ（`inventory:W-004`） | fix | **レビューは「本文へ足すか台帳から落とすかどちらでもよい」としているが、実測すると一方は規約違反になる。** `spec/pages/index.md:5` が「**この文書はユースケース名を書かない**（意図的な記法）」と明言し、理由（同じ対応が 2 か所に分かれ、ユースケースの分割・改名のたびに両方を直す必要が生じる）まで書いている。したがって**本文へ足す向きは採れず、台帳から落とす**。実測の裏づけ: (a) `spec/inventory/frontend.md` 162 行のうちユースケース名を持つのはこの 2 行だけ、(b) 本 PR は P-21 の本文を 1 文字も変えていない（`git diff spec/pages/index.md` は URL 表 / P-03 / P-25 / P-40 の 4 か所のみ）ので、この 2 行は**何にも追随していない**。落とすと 2 行が base と同一に戻るので、**AC-57 の列挙からも `PAGE-p21-001,002` を外す**（対になる側の置き去りを作らない） | 0 |
| M-102 `apps/web/app/start.ts:10,11:CSRF コメント` | 規約を `Origin` 検査に切り詰めており、M-38 で改めた spec の判定順と割れている（`presentation:W-001`） | fix | `spec/presentation/index.md:126` は R1 の M-38 で「`Sec-Fetch-Site` → `Origin` → `Referer` の順に確認し、いずれの手掛かりも持たない要求は拒否する」へ改まり、実装 `createCsrfMiddleware` もその順で判定する。**この文は本 PR が AC-16 で書き換えた当の行**でありながら規約の記述が事実より狭い。同じ規約を語る `apps/web/app/routes/settings/-action.tsx:167-169` は既に 3 ヘッダーの順を正しく書いており、同一 PR 内で粒度が割れている。コメント文字列のみ | 0 |

## 実地検証の結果

**17 件すべてについて `spec/` の実物・実装コード・`git diff 55a5bb9 HEAD` に当たった。事実として誤っていた指摘は 0 件。** 独立に再実測して一致したもの:

- `it` 名の短縮連記 **31 ケース** / そこから到達不能な ID **20 本**（列挙も完全一致）/ `ADP-identity-034` はヘッダー由来の 1 本（M-90）
- `adapters/conformance/` のスイートは **31 本**、ADP ID を持たないのは **5 本**、持つのは **26 本**（M-89 の「他 20 本」が実測と違うこと）
- `spec/inventory/usecase.md` の要点欄改訂は **11 行**（M-100）
- `spec/pages/index.md:5` が「この文書はユースケース名を書かない」と定めていること、`spec/inventory/frontend.md` でユースケース名を持つ行が `PAGE-p21-001/002` の 2 行だけであること（M-101）
- `requestPasswordReset | レート制限` のエラーケース行が `origin/main` の `spec/usecases/identity.md:418` に既にあること（M-95）
- AC-63 の実測が修正後も **35 ファイル = 変更 32 / 削除 3 / 追加 0**、機械検査の残りが **14 行**のままであること

**判定の前提が実測と食い違った指摘が 1 件ある**（指摘そのものの成否には影響しない）: `inventory:W-001` の 8 組は「M-79 の同クラス残存」として挙げられており、R3 のレビュー本文は「`origin/main` では要点欄が一字一句同じで HEAD では食い違う組が 11 組」と正しく書いている。8 組を実際に `merge-base` と比較すると **8 組すべてが本 PR で食い違いを生じている**（`origin/main` では DOM 行と ADP 行が同文）。したがって「本 PR が作ったものではない既存の欠陥だから送る」という切り方はこの 8 組には当たらない。判定は**由来（本 PR か否か）ではなく、片側の主張が本文に由来するか**で切り直した（M-98 / M-99、ADR-038）。

**レビューの列挙に無い 2 件を追加で検出した**（どちらも M-88 / M-89 と同根なので同じ Key に含めた）:

- `.thread/14/steps.md:451` のステップ 16 が「**新規 Issue を 7 本起票し、既存 Issue 4 件へコメントする**」と書き、`plan.md` の Phase 5 リストの 12〜17 を落としている。**起票の実行手順**なので、`docs:W-002` が指摘した「そのまま Issue になる」経路と同じ実害を持つ
- `.thread/14/adr.md:589`（ADR-015 の Context）と `:595`、`.thread/14/steps.md:200` / `:460` が「`spec/adr/026` の命名規約」「`describe` / `it` 名」「25 本」と書いている。M-62 / ADR-034 が帰属を 052 へ直し、V1 が規約を `it` 名へ絞った後も残っていた同型

## 修正の実行

単独で実行した。編集順序は (1) `spec/` 本文 → (2) `spec/inventory/` → (3) コード（コメント・`it` 名のみ）→ (4) `.thread/14/{plan,steps,adr}.md`（コード差分の件数が確定してから）。

| 順 | 対象 | Key |
| --- | --- | --- |
| 1 | `spec/testcases/storage/storeUpload.md` | M-96 |
| 2 | `spec/inventory/{domain,adapter,test,frontend}.md` | M-92, M-96, M-98, M-101 |
| 3 | `packages/core/src/adapters/conformance/{authTokenRepository,accountDeletionManifestStore,objectStorage,scopeCleanupAdmissionStore,signInOAuthClient}.ts` | M-93 |
| 4 | `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `apps/web/app/start.ts` | M-97, M-102 |
| 5 | `.thread/14/steps.md` | M-88 |
| 6 | `.thread/14/plan.md`（AC-56 / AC-57 / AC-60 / Phase 5 の 6. / リスク節 / 起票リスト 17.） | M-89, M-91, M-95, M-100, M-101 |
| 7 | `.thread/14/adr.md`（ADR-015 / ADR-029 / ADR-035 の是正、ADR-037 / ADR-038 の新設） | M-89, M-90, M-94, M-99 |

**新設した ADR**: ADR-037（台帳 ID を名乗るのは適合ケースだけで、TC ID とユースケース実装の UC ID は名乗りを規約にしない）/ ADR-038（台帳の DOM 行 ↔ ADP 行の非対称は、片側の主張が本文に由来するときだけそろえる）。

**Phase 5 へ送ったもの**: M-91 / M-95 を `plan.md` の Phase 5 リストへ **17.** として追加した（既存の 1〜16 と重複しない）。M-94 / M-99 は ADR に記録して閉じ、起票しない（どちらも「規約どおりであって欠陥ではない」という判定で、追跡すべき残作業を持たない）。
