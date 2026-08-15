# レビュー — プレゼンテーション・画面・データモデル・プラットフォーム

対象: PR #22（`spec` と実装のドキュメント同期）/ 契約: `.thread/14/plan.md`

## プレゼンテーション・画面・データモデル・プラットフォーム

### Blockers

- **[B-001]** ステータス対応表に `unauthorized`（および `forbidden`）の行が無い。同じ PR が `UnauthorizedError` を usecase spec に書き足したのに、それを受ける転送境界の正典が欠けている
  - 場所: `spec/presentation/index.md:191-201`（`### kind による既定の対応`）／実装は `apps/web/app/presentation/errorResponse.ts:102-111`／spec 側の参照元は `spec/usecases/identity.md:226,237` と `spec/inventory/usecase.md:15`（いずれも本 PR で追加）
  - 理由: この表は自分で「**対応表はここが唯一の正典であり、ユースケース文書はステータスを書かない**」（`:189`）と宣言しており、`:201` は「上記に該当しない値は `unknown` として 500」と閉じている。実装は `unauthorized → 401` / `forbidden → 403` を持ち、`UnauthorizedError("UNAUTHENTICATED")` は `startOAuthFlow`（`packages/core/src/application/identity/startOAuthFlow.ts:68`）と `linkOAuthIdentity.ts:140` で実際に投げられる = 到達する。spec だけを読んで転送境界を再実装すると、この経路が 500 になり、クライアントは「サインインへ誘導する」判断ができない。しかも `ValidationError("UNAUTHENTICATED")` → 401 の例外行（`:210`）が既にあるため、読み手は「未認証は validation 側で表現する」と誤読する。認証系のステータス記述なので、事実と違えばそのまま安全側の判断材料が欠ける
  - 提案: `kind` 既定表に `UnauthorizedError | unauthorized | 401` を追加する。`forbidden` は現状どこからも throw されないが直列化形と写像は実在するので、行を足すか「実装は kind を持つが本設計では権限不足を 404 に畳むため使わない」と 1 句添える。あわせて `:196` の「権限不足を 403 と区別しない」と矛盾しない書き方にする（`ValidationError("UNAUTHENTICATED")` と `UnauthorizedError("UNAUTHENTICATED")` が同じコードで 2 系統ある事実も、どちらを使うかを 1 行で決めておくと次のスライスで割れない）

- **[B-002]** P-25 の状態行に、実装が到達する「進捗を表示できません」状態（ticket 失効・無効・一時障害）が無い。本 PR はこの行自体を書き換えている
  - 場所: `spec/pages/index.md:492`／実装は `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:50-61,199-209,358-379`
  - 理由: 実装の `Phase` は `idle / accepted / running / completed / settled` の直和で、`settled` は (a) `DELETION_TICKET_EXPIRED`（30 分の ticket 期限。削除が長引けば正常系でも到達する）、(b) `DELETION_TICKET_INVALID`、(c) polling の一時障害の 3 経路から到達し、専用の見出し「削除の進捗を表示できません」と「進捗をもう一度確認する」／「トップページへ」の導線を持つ。つまり**画面の状態として実在するのに spec に無い**。同じ PR は P-03 で「一時障害（再試行）」をわざわざ足して 7 状態の直和にしている（AC-15）ので、判定基準としても非対称。この行を正典として実装し直すと、セッションが無く進捗も読めない利用者が行き止まりになる（唯一の脱出導線が消える）
  - 提案: `:492` に「進捗を追えない（ticket 失効・無効は再申請不可の説明とトップへの導線、一時障害は同じ ticket での再試行）」を状態として足す。あわせて `spec/inventory/frontend.md` の `PAGE-p25-003`（`:121`）の要点にも同じ分岐を反映する（現在は `accepted・running・completed・rejected・failed` の**サーバー側 status** の列挙だけで、ticket 側の失敗経路が読めない）

### Warnings

- **[W-001]** CSRF 規約の判定条件が実装の判定順と違う。「`Origin` が欠けている要求は拒否する」は成立しない
  - 場所: `spec/presentation/index.md:126`／実装は `apps/web/app/start.ts:16-21` → `@tanstack/start-client-core/src/createCsrfMiddleware.ts:116-151`
  - 理由: ミドルウェアは (1) `Sec-Fetch-Site` があればそれだけで判定（既定 `same-origin`）、(2) 無ければ `Origin` を要求 URL のオリジンと比較、(3) それも無ければ `Referer` を同一オリジン判定にフォールバック（既定 `referer: true`）、(4) 3 つとも無いときに初めて拒否（`allowRequestsWithoutOriginCheck` 既定 `false`）、という順序を持つ。したがって `Origin` が欠けていても `Sec-Fetch-Site: same-origin` または同一オリジンの `Referer` があれば通る。防御としての強さは同等（ブラウザが付ける `Sec-Fetch-Site` は偽装できず、cross-site の `<form>` POST は必ず落ちる）だが、**規律の記述として事実と違う**。この 1 行が CSRF 規律の正典になった以上、他ランタイム実装者はこの文だけを読んで実装する
  - 提案: 「同一オリジンであることを `Sec-Fetch-Site` → `Origin` → `Referer` の順に確認し、いずれの手掛かりも無い要求は拒否する」と実際の判定へ書き換える。`filter` が `handlerType === "serverFn"` で全 server function に掛かること（`createStartHandler.ts:504-531` が `SERVER_FN_BASE` 配下を必ずこのミドルウェア列に通す）と、`createStart` が既定 `requestMiddleware` を置き換えるので明示登録が要ること（`:99-101`）は**確認済みで、記述どおり成立している**

- **[W-002]** `Cache-Control` 行の例外の書き方（「静的アセット」）が、実装のもう 1 つの自前指定を取りこぼしている
  - 場所: `spec/presentation/index.md:183`／実装は `apps/web/app/server.node.ts:69-86`（`if (!response.headers.has(name))`）と `apps/web/app/routes/storage.$.tsx:52`
  - 理由: 既定値（`private, no-store`）と上書きしない実装は spec どおり。ただし自前の `Cache-Control` を持つ応答は静的アセット（`apps/web/scripts/listen.node.ts:133`）だけではなく、**保管オブジェクトの配信口**（`/storage/*`、アバター）が `private, max-age=31536000, immutable` を意図的に指定している。これは「鍵にファイル ID が入るので内容が不変」「`private` は退会後に共有キャッシュから読めないため」という設計判断で、spec の例外句からは読めない。spec を正典に別ランタイムを書くと、この配信口も `no-store` になり（劣化）、あるいは `public` にされる（P-25 の削除の約束が破れる）
  - 提案: 例外を「自前の `Cache-Control` を持つ応答（静的アセットと、鍵が内容に一意な保管オブジェクトの配信。後者は `private` を外さない）」に広げる

- **[W-003]** Cookie の `Secure` 行が無条件のままで、実装の development 免除への参照が無い
  - 場所: `spec/presentation/index.md:40`／実装は `apps/web/app/presentation/session.ts:32-36,43-51`（`secure: !isDevelopment()`）
  - 理由: 免除の判断自体は `spec/adr/037-node-env-allowlist.md` で承認済みなので設計としては割れていないが、Cookie 属性の正典である本表からその ADR への参照が無く、表だけを読むと「実装が spec に反している」と読める。本 PR は同じ表の「寿命」行に ADR 055 への参照を足して同種の疑問を解消しており、`Secure` だけが取り残されている
  - 提案: `Secure` の理由欄に「免除は `development` のときだけ（[ADR 037](../adr/037-node-env-allowlist.md)）」を 1 句添える

- **[W-004]** P-25 を「認証ガードの明示的な例外」と書いた一方で、URL 割り当ての区分表は `/settings/danger` を「設定（認証必須）」のままにしている
  - 場所: `spec/pages/index.md:49`（区分表）と `:487`（P-25 の新しい但し書き）／実装は `apps/web/app/routes/settings/route.tsx:21-37`（`SIGNED_OUT_PATH = "/settings/danger"` だけガードを抜ける）
  - 理由: 本 PR は同型の spec 内部矛盾（P-40 の状態行 vs URL 表）を SYNC-26 / AC-26 として閉じている。区分表は `:9-14` で「設定 = 認証必須」と定義しているので、同じ文書内に残った矛盾は次の読み手が P-40 と同じ手間で解くことになる
  - 提案: `:49` の行に「（受理後はセッション無しでも到達 — P-25 の例外）」を添えるか、区分列を `設定 *` として脚注を 1 行置く

- **[W-005]** presentation のコードに `.thread/2/adr.md` だけに存在する ADR 番号への参照が 3 件残っている（本 PR が `start.ts` の `AC-15` で潰したのと同じ dangling 参照）
  - 場所: `apps/web/app/presentation/session.ts:32`（`ADR-110`）、`apps/web/app/presentation/oauthStateCookie.ts:23`（`ADR-110`）、`apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts:2`（`ADR-095` / `ADR-112`。`ADR-006` も spec の 006「HTML コンテンツモデル」とは別物を指している）
  - 理由: `spec/adr/` の最大採番は 057 で、095 / 110 / 112 は存在しない。実体は `.thread/2/adr.md` の作業用 ID であり、`.thread/2/` が計画凍結で消えれば参照先を失う。`ADR-110` に対応する正典は `spec/adr/037-node-env-allowlist.md` として既に昇格済みなので、参照先は実在する
  - 提案: `ADR-110` → `spec/adr/037`、`ADR-095` / `ADR-112` は `spec/adr/047-deletion-status-ticket.md`（＋ P-25 の記述）へ差し替える。コード差分 9 ファイル枠を守るなら、フォローアップ Issue に相乗りさせて記録だけ残す

- **[W-006]** ADR 055 の決定 2（「値を使う両側に 1 句ずつ残す」）が、セッションを発行するもう 1 つのユースケースに適用されていない
  - 場所: `spec/adr/055-session-expiry-derivation.md` の決定 2／`spec/usecases/identity.md:270`（`completeOAuthSignIn` 手順 8）と `:70`（`signUpWithPassword` 手順 10）／実装は `apps/web/app/routes/auth/-action.tsx:108-110`（`sessionCookieExpiry` を使う 3 か所目）
  - 理由: `verifyEmail`（`:114`）と `signInWithPassword`（`:186`）には再導出の 1 句が入ったが、`completeOAuthSignIn` は `sessionToken` を返し実装も同じ再導出を使うのに、手順に何も無い。`signUpWithPassword:70` も「有効期間は `Session.ttlMs`」までで、View が `expiresAt` を返さないことに触れていない。ADR が「片側だけだと疑問が解けない」と書いた形が残る
  - 提案: `completeOAuthSignIn` 手順 8 と `signUpWithPassword` 手順 10 に同じ 1 句（View は `expiresAt` を返さず転送境界が再導出する、[ADR 055]）を足す

- **[W-007]** `Cache-Control` の追随が `PAGE-p47-001` だけに入り、同じ公開ページ群の他の行に入っていない
  - 場所: `spec/inventory/frontend.md:168`（P-47 だけ追記）と `:147,151,154,157,160`（P-41〜P-45 は「公開 CSP と referrer policy」のまま）
  - 理由: 本 PR は `spec/presentation/index.md:141` で「Cookie 認証の応答をキャッシュに配らせない指令も**サービス全体の既定**として敷く（公開ページだけ緩めるのは公開閲覧スライス）」と書いた。台帳側で 1 行にだけ書くと、既定ではなく P-47 固有の要件に読める（`spec/inventory/` は本文からの生成物という位置づけなので、選択の基準が読めないと次の同期で揺れる）
  - 提案: 追記を落として本文（presentation）の既定に委ねるか、公開ページ 5 行にも同じ語を足して「既定 + 公開閲覧スライスで緩める」と読める形にそろえる

- **[W-008]** P-03 の「確認済み・サインインが必要」の発生条件が、実装より狭く書かれている
  - 場所: `spec/pages/index.md:174`／実装は `apps/web/app/presentation/verificationSession.ts:14-21` と `VerifyEmailPanel/index.tsx:78-84`
  - 理由: この状態は `pendingUserId === view.userId` が成立しないときに出る。別ブラウザーはその代表例だが、**同じブラウザーでも** 確認待ち Cookie が消えていれば（Cookie 削除、プライベートウィンドウ、`AuthTokenPurpose.ttlMs("email_verification")` 経過後）到達する。spec が「別ブラウザーの場合に出る」と断定すると、手動テスト（TC-42）が別ブラウザー 1 経路だけを見て十分と判断してしまう
  - 提案: 「確認を要求したブラウザーの印（確認待ち Cookie）が無い / 一致しない場合に出る（別ブラウザーで開いた場合が代表例）」に緩める

- **[W-009]** P-40 に「サインイン済みは到達しない」と書いた後も、サインイン済み訪問者を前提にした語が同じ節と台帳に残っている
  - 場所: `spec/pages/index.md:569`（機能「サインアップ / サインインへの導線は未サインインの訪問者にだけ出る」）と `spec/inventory/frontend.md:146`（`PAGE-p40-004`「アプリへ戻る」）
  - 理由: 状態が「通常」のみなら、導線の出し分けは定義上起こらない（実装 `apps/web/app/routes/index.tsx:12-17` は `beforeLoad` で `redirect` するだけで、出し分けの分岐を持たない）。`PAGE-p40-004` は画面内に対応する UI 要素を持たない台帳行として残る
  - 提案: 機能行の後半 1 文を落とすか「サインイン済みはこの画面へ来ないため出し分けの分岐を持たない」と書く。`PAGE-p40-004` は要素名を「サインイン済みのリダイレクト」に改めると、行の指すものと実装が一致する

### 合格として確認したもの（この観点の主要論点）

- CSRF の無条件化そのもの: `createStart` が既定 `requestMiddleware` を置き換えること、`filter: handlerType === "serverFn"` が `SERVER_FN_BASE` 配下の**全** server function 呼び出しに掛かること、フレームワークが server function 側で `multipart/form-data` / `application/x-www-form-urlencoded` を常に受理すること（`server-functions-handler.ts:28-31,83-104`）をフレームワーク実装まで追って確認。アプリに React server actions（`"use server"`）は無く、抜け道は存在しない
- `Cache-Control: private, no-store` の既定は `apps/web/app/server.node.ts:69-77` と一致（上書きしない実装も含む）
- Cookie 寿命の再導出（ADR 055）は `presentation/session.ts:94-102` と一致。`HttpOnly` / `SameSite=Lax` / `Path=/` / `Domain` 未指定も一致
- P-03 の 7 状態は `VerifyEmailPanel/index.tsx:31-38` の `Phase` 直和と 1 対 1（到達しない状態も、書かれていない状態も無い）
- P-25 の認証ガード例外は `routes/settings/route.tsx:21-37` と一致。「`deleteAccountFn` はセッションを要求する」（`routes/settings/-action.tsx:373`）／「`getAccountDeletionStatus` は ticket が名指す 1 件だけ」（`:404-424`、`presentation/deletionTicket.ts:102-164`）も実装どおり
- 削除 status ticket の署名鍵を `AppConfig` に置かない但し書きは `application/di/serverNode.ts:175-186` / `memoryRuntime.ts:131-133`（未設定ならプロセス毎のランダム鍵）と一致
- `spec/database/index.md` の改訂は実装のポート型と一致（`distributed_operations.state` の CHECK 3 値 = `DistributedOperationState`、`countTerminalSince` の位置づけ、`applied_operations` の 2 ポート分割 = `AppliedOperationStore.markApplied(operationId, commandKey)` と `ScopeCleanupAdmissionStore`、componentAcks の宣言集合化）。**列の削除は 1 件も無く**、`attempts` / `next_attempt_at` / `expires_at` と `createDownloadUrl` 等の未実装側も残っている（AC-62 の向き）
- `assertOwner` が completed を拒否する追加主張は memory 実装（`adapters/memory/repositories/scopeCleanupAdmissionStore.ts:46-56,105-107`）が既に満たしており、振る舞い変更なし
- 実行予算の 3 か所（`spec/platform/index.md:152` / `spec/testcases/storage/deleteFilesByOwner.md:11` / `spec/usecases/storage.md:500`）は**同じ主張**になっており矛盾しない。契約側は「列挙 1 回・削除 1 件につきイベント 1 件・件数に比例した往復を要求しない」で、実装（`application/storage/deleteFilesByOwner.ts:82-91`）と一致。出力 DTO `ScopeCleanupTurn & { deletedCount }` の 4 status も実装と一致
- `apps/web/app/start.ts` の参照先差し替えは `spec/presentation/index.md` の CSRF 規約行を正しく指す
- `spec/` 内の相対リンク（presentation / pages / platform / database / inventory-frontend）とアンカー（`#appconfig`、`### Scope DO`）はすべて実在。`docs/*_implementation_example.md` の `apps/` `packages/` パス参照も、テンプレート記法の 2 件（`${domain}`）を除き全件実在

### カバレッジ

- 確認: `.thread/14/plan.md`（契約）, `apps/web/app/start.ts`, `spec/presentation/index.md`, `spec/pages/index.md`, `spec/database/index.md`, `spec/platform/index.md`, `spec/inventory/frontend.md`, `spec/testcases/storage/deleteFilesByOwner.md`, `spec/usecases/storage.md`（`deleteFilesByOwner` の出力 DTO と `batchSize` 段落）, `spec/usecases/identity.md`（セッション Cookie の再導出 / `UnauthorizedError` / OAuth 節）, `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/index.md`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/di/containerStore.ts`, `docs/frontend_implementation_example.md`（参照パスの実在と実在しない固有名の grep）
- スキップ: `.thread/14/{adr,research,research-2,steps,testing}.md` — 計画の作業記録で、レビュー対象は成果物側
- スキップ: `CLAUDE.md`, `README.md`, `docs/backend_implementation_example.md` — 開発者ドキュメントの整合はアーキテクチャ / ドキュメント観点。実在しない固有名の grep（`serverCloudflare` / `todo` / `drizzle` ほか）が 0 件であることだけ確認済み
- スキップ: `spec/domains/{identity,index,note,storage,usage}.md` — ポート契約とドメイン不変条件はドメイン観点。ただし `spec/database/index.md` の照合に必要な範囲（`DistributedOperationStore` / `ScopeCleanupAdmissionStore` / `AppliedOperationStore`）は実装側の型で直接確認した
- スキップ: `spec/usecases/usage.md` — ユースケース観点
- スキップ: `spec/scenario/account.md`, `spec/manual-tests/account.md` — シナリオ / 手動テスト観点
- スキップ: `spec/testcases/identity/{checkHandleAvailability,completeOAuthCallback,getProfile,requestPasswordReset,signUpWithPassword,startOAuthFlow}.md` — テストケース観点
- スキップ: `spec/inventory/{domain,adapter,test,usecase}.md` — 台帳の採番規則と追随は inventory 観点（`review-001-inventory.md`）
- スキップ: `spec/adr/{052,053,054,057}-*.md` — 台帳粒度 / rollback 判定 / 一意性の担保元 / 手順書追随で、それぞれ inventory・ドメイン・テスト観点
- スキップ: `packages/core/src/application/ports/{accountDeletionManifestStore,shareTokenProtector}.ts`, `packages/core/src/domain/identity/{errorCode.ts,ports/identityRepository.ts}`, `packages/core/src/domain/storage/errorCode.ts` — ポート JSDoc とエラーコード語彙はドメイン観点

（確認 17 件 ＋ スキップ 35 件 = 変更ファイル一覧 52 件）
