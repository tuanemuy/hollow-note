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
