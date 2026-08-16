# レビュー R2 — プレゼンテーション・画面・データモデル・プラットフォーム

対象: PR #22（ベース `main`）。既出判定 `.thread/14/review/triage.md` の `wont-fix` / `defer` と Key 一致の指摘は再指摘していない。

## プレゼンテーション・画面・データモデル・プラットフォーム

### Blockers

- **[B-001]** `Secure` の記述を spec 側だけ直し、対になる実装コメントが spec を名指しで否定したまま残っている（M-40 の片側置き去り）
  - 場所: `apps/web/app/presentation/session.ts:17-18`（JSDoc）/ 対になる spec は `spec/presentation/index.md:40`
  - 理由: JSDoc は今も「`Secure` outside dev (**the spec mandates it unconditionally**; dev over plain http is the one accepted degradation)」と書いている。この記述は本 PR 以前は真だったが、M-40 が同じ表の理由欄へ「外すのは平文 `http` で動く `development` の配備だけで、判定は許可リストで行う（[ADR 037](../../spec/adr/037-node-env-allowlist.md)）」を足したことで**偽になった**。spec は無条件を要求していないのに、実装が「spec は無条件だが自分は外している」と述べている状態で、これは triage M-02（`uniqueness.ts` / `view.ts` の「the spec writes …」）と同型の「実装が spec を名指しで否定する」形そのものである。本 PR は同じファイル（`session.ts:32`）を編集しており、U7 の手が届いていた行の 15 行上に残った。
  - 提案: 括弧内を事実に合わせる（例: `Secure` outside dev — the exemption is an allowlist decision recorded in `spec/adr/037` / `spec/presentation/index.md`）。`oauthStateCookie.ts:17-19` は既に「dev の平文 http を除いて `Secure`」と中立に書けているので、そちらへ寄せれば足りる。

- **[B-002]** `distributed_operations.state` を 3 値に固定した一方で、削除 status の語彙 5 値（`failed` を含む）を要求する記述が spec に残り、内部矛盾が新設された
  - 場所: `spec/database/index.md:138`（`CHECK IN ('running','completed','rejected')` の新設）/ `spec/domains/index.md:147`（同じ 3 値の明文化）/ 対して `spec/presentation/index.md:236` と `spec/inventory/frontend.md:121`（`PAGE-p25-003`。**本 PR が編集した行**）
  - 理由: 本 PR は AC-38 に従って `state` の語彙を `running` / `completed` / `rejected` の 3 値へ固定し、`spec/domains/index.md:147` に「`preparing` / `committing` はこの 3 値に含まれない」まで書いた。しかし P-25 の status を定める `spec/presentation/index.md:236` は「状態は `accepted` / `running` / `completed` / `rejected` / `failed`。…`failed` は再試行不能と確定した場合だけ」のままで、`PAGE-p25-003` も「accepted・running・completed・rejected・failed を表示する」と要求している。実装 `packages/core/src/application/identity/getAccountDeletionStatus.ts:35` は `status: operation.state` を**そのまま**返し、`DistributedOperationState`（`packages/core/src/application/ports/distributedOperationStore.ts:11`）も 3 値なので、`failed` はポート・列・ユースケースのどこからも到達しない。`accepted` は 202 応答の transport status として説明が付く（同 :234）が、`failed` には受け皿が spec の中に 1 つも無い（manifest header の state 集合にも `failed` は無い）。D1 実装者はこの CHECK を書いた時点で、同じ spec が表示を要求する状態を永久に作れなくなる。1 回目の失敗パターン（片側だけ直して対になる側が置き去り）が、今回は「列を締めて語彙を締めなかった」向きで再発している。
  - 提案: どちらかへ倒す。(a) `failed` を落とす向きなら `spec/presentation/index.md:236` を 3 値（＋ `accepted` は transport の応答 status である旨を 1 句）へ改め、`PAGE-p25-003` の列挙と `PAGE-p25-004` の記述も同時に直す。(b) `failed` を残す向きなら CHECK を 4 値にし、どの遷移が `failed` を作るかを `spec/usecases/identity.md` の `deleteAccount` 手順に書く。**片方だけの修正は今と同じ矛盾を残す**。あわせて、`rejected` が P-25 のどの状態（`実行不可`）に着くかも同じ箇所で 1 句にすると、状態直和と status 語彙の対応が読めるようになる（実装が `rejected` を `settled` へ畳んでいる件は Phase 5 の受け皿があるので、ここでは spec 側の対応関係だけを指す）。

### Warnings

- **[W-001]** `PAGE-p03-004` の状態列挙が R1 の修正で「無効」を落とし、実装より狭くなった（M-10 の修正が生んだ退行）
  - 場所: `spec/inventory/frontend.md:20`
  - 理由: `origin/main` は「使用済み・無効状態から P-02 へ遷移する」だったが、本 PR は「確認済み・サインインが必要 / 使用済みの状態から P-02 へ遷移する」に置き換え、**無効を落とした**。実装 `apps/web/app/components/auth/VerifyEmailPanel/index.tsx:167-174,190-206` では `expired` / `invalid` のどちらも `ResendActions` を描画し、その中に「サインインへ」リンク（`:200-204`）がある。つまりサインインへの導線は `verifiedSignInRequired` / `alreadyVerified` / `expired` / `invalid` の 4 状態から出る。同じ PR が `PAGE-p03-003` では「期限切れ・無効」と正しく 2 状態を書いており、隣接行で粒度が割れている。
  - 提案: `PAGE-p03-004` を 4 状態（確認済み・サインインが必要 / 使用済み / 期限切れ / 無効）にする。期限切れ・無効側は再送フォームに従属する逃げ道なので、その旨を 1 句添えてもよい。

- **[W-002]** `applied_operations` の鍵を `(operationId, commandKey)` と書きながら、列定義には `command_key` が無く PK は `operation_id` 単独のまま
  - 場所: `spec/database/index.md:35` と `:1027-1037`（`#### applied_operations` の列表と新設段落 `:1037`）
  - 理由: 本 PR は 2 か所で「`AppliedOperationStore.markApplied` の `(operationId, commandKey)`」を正典として書いたが、直下の列表は `operation_id | text | PK` のままで `command_key` 列が無い。この表だけを読んで D1 を実装すると、同じ operation の 2 つ目のコマンドが PK 衝突して落ちる。実装は衝突しない — `packages/core/src/adapters/memory/repositories/appliedOperationStore.ts:9-13` が `sha256("${operationId}:${commandKey}")` を単一の `operation_id` へ畳んでおり、その JSDoc は「mirroring the single `operation_id` primary key of spec/database's `applied_operations`」と spec を根拠にしている。**畳み込み規則が spec 側にだけ無い**状態で、同じ文書は `scheduled_tasks.operation_id`（`:37`）については導出式を明記しているので、様式としても非対称。
  - 提案: 新設段落に 1 文足す（「2 部鍵は `operation_id` 1 列へ決定的に畳む（`sha256(operationId + ":" + commandKey)`）。列を増やさないのは barrier receipt と同居する表だからである」）。または列表に `command_key` を足して PK を 2 列にする。どちらでもよいが、**ポートの鍵と列定義が対応づかない現状は残さない**。

### 1 回目の修正の検証結果（担当分）

| Key | 判定 | 根拠 |
| --- | --- | --- |
| M-13（`unauthorized` / `forbidden` 行の追加） | 正しく入っていた | `spec/presentation/index.md:196-197` の 401 / 403 が `apps/web/app/presentation/errorResponse.ts:102-111` の `HTTP_STATUS_BY_KIND` と一致。`ValidationError("UNAUTHENTICATED")` が同じ 401 に着く旨も `HTTP_STATUS_BY_CODE`（`:117-124`）と一致。`ForbiddenError` を「どの経路も投げない」と書いたのも実測どおり（`grep -rn ForbiddenError` のヒットは `application/errors.ts` の定義と `errorResponse.ts` の union のみで、throw は 0 件） |
| M-14（P-25 の「進捗を追えない」） | 正しく入っていた | `spec/pages/index.md:494` と `spec/inventory/frontend.md:143` が、実装 `DeleteAccountPanel/index.tsx:196-210` の 3 経路（`DELETION_TICKET_EXPIRED` / `DELETION_TICKET_INVALID` は `resumeTicket: null`、それ以外は ticket 保持）と `:358-379` の導線の出し分けに一致。30 分は `apps/web/app/presentation/deletionTicket.ts:24` の実測どおり。4 つ目の経路（`rejected` → `settled`）は Phase 5 送りの判断どおり spec へ書き写されていない（`spec/adr/046` の向きとして正しい）。ただし語彙側の取り残しは B-002 |
| M-38（CSRF 判定順） | 正しく入っていた | `spec/presentation/index.md:126` の `Sec-Fetch-Site` → `Origin` → `Referer`・「先に見つかった手掛かりだけで判定」・「いずれも持たない要求は拒否」が、`@tanstack/start-client-core/dist/esm/createCsrfMiddleware.js` の `getCsrfRequestValidationResult`（早期 return の順序）と `isCsrfRequestAllowed`（3 つとも無い＝`undefined` で、`allowRequestsWithoutOriginCheck` 未指定なので拒否）に完全一致。`apps/web/app/start.ts:19` の `filter: ctx.handlerType === "serverFn"` も「すべての server function 呼び出し」という表現と整合 |
| M-39（`Cache-Control` の例外） | 正しく入っていた | `spec/presentation/index.md:183` の既定 `private, no-store` と「自前の値を上書きしない」例外 2 種が、`apps/web/app/server.node.ts:69-84`（`withSecurityHeaders` は `has()` で既存値を尊重）と `apps/web/app/routes/storage.$.tsx:52`（`private, max-age=31536000, immutable`）の実装と一致。`private` を外さない理由（退会後の共有キャッシュ）も実装コメントと同趣旨 |
| M-40（`Secure` の ADR 037 参照） | **不完全**（spec 側のみ。実装コメントが取り残された） | B-001 |
| M-41（`/settings/danger` の例外注記） | 正しく入っていた | `spec/pages/index.md:49-51` の脚注が `apps/web/app/routes/settings/route.tsx:21-36`（`SIGNED_OUT_PATH` だけ `user: null` を通し、他は `/signin` へ redirect）と一致。他のアプリ画面は `requireAuthenticated`（`routes/notes/index.tsx:16`）を通るので「唯一の例外」も実測どおり。P-25 本文の「`deleteAccountFn` 自体はセッションを要求する」も `routes/settings/-action.tsx:373` の `requireSession()` と一致 |
| M-42（dangling ADR 参照の差し替え） | 正しく入っていた（4 件とも差し替え先を個別に検証） | `session.ts:32` / `oauthStateCookie.ts:23` の ADR-110 → `spec/adr/037`（allowlist と `Secure` の免除が決定本文にある）。`oauthStateCookie.ts:66` の ADR-099 → `spec/adr/034`（決定 3「自分が焼いた Cookie だと確認できたときだけ捨てる」＋決定 4、および「`<img src=…>` で他人のフローの Cookie を落とせる」の理由段落が実在）。`ticketStorage.ts:2` の ADR-006/095/112 → `spec/adr/047`（決定に「退避は best-effort」「復元は主体一致またはセッション無し」「恒久失効では退避を捨てる」が揃っており、3 本の内容を吸収できている）。コード全域で `ADR-[0-9]{2,3}` 形式のヒットは 0 件、`spec/adr/NNN` 形式の参照 16 種はすべて実ファイルが存在 |
| M-43（ADR 055 の 1 句の展開） | 正しく入っていた | `spec/usecases/identity.md:70`（`signUpWithPassword` 手順 10）/ `:114`（`verifyEmail`）/ `:186`（`signInWithPassword`）/ `:270`（`completeOAuthSignIn` 手順 8）の 4 か所に同じ 1 句。実装側の再導出は `apps/web/app/presentation/session.ts:99-101` の `sessionCookieExpiry` で、呼び出しは `VerifyEmailPanel/action.ts:39` / `SignInForm/action.ts:35` / `routes/auth/-action.tsx:108` の 3 経路（`signUpWithPassword` はセッションを発行しないため転送境界に呼び出しが無いのが正しい） |
| M-44（P-03 の条件の緩和） | 正しく入っていた | `spec/pages/index.md:176` と `spec/inventory/frontend.md:17` の条件が、実装 `apps/web/app/presentation/verificationSession.ts:20`（`view.sessionToken !== null && pendingUserId === view.userId`）と、Cookie の寿命 `session.ts:79-81`（`AuthTokenPurpose.ttlMs("email_verification")`）に一致。「別ブラウザーは代表例」という緩め方も実装どおり。P-03 の状態直和 7 個も `VerifyEmailPanel/index.tsx:33-40` の `Phase` union と 1 対 1 |
| M-46（他ランタイム残骸の削除） | 正しく入っていた（壊れた参照なし） | 削除 3 本を読むコードは 0 件（`grep -rn "dev.vars\|env.aws\|env.gcp\|wrangler\|cdk.out"` のヒットは `.gitignore` と `spec/adr/025` の説明文、`.thread/` の記録のみ）。`.dockerignore` は 2 行削除後も残りの規則が独立しており、ビルドが参照するファイルは無い（`Dockerfile` 自体が 0 本）。`.gitignore` の wrangler 行と `.dockerignore` の存否は Phase 5 の 13. が受け皿として明記されている |

**集計: 正しく入っていた 9 / 不完全 1（M-40）/ 退行を生んだ 1（M-10 の波及で `PAGE-p03-004` — W-001）**。加えて、R1 の修正が直接触っていない面で新設された内部矛盾が 1 件（B-002）、既存の記述不足が 1 件（W-002）。

### カバレッジ

確認（20）:

- `.dockerignore`, `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example`
- `apps/web/app/start.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`
- `spec/presentation/index.md`, `spec/pages/index.md`, `spec/database/index.md`, `spec/platform/index.md`, `spec/inventory/frontend.md`, `spec/testcases/storage/deleteFilesByOwner.md`
- `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`
- `spec/usecases/identity.md` — ADR 055 の 4 か所と削除 status の語彙のみ（残りはユースケース観点）
- `CLAUDE.md`, `.thread/14/plan.md`, `.thread/14/review/triage.md`

差分外で判断材料に読んだもの: `apps/web/app/presentation/errorResponse.ts`, `apps/web/app/routes/{index,storage.$,settings/route,settings/-action,notes/index}.tsx`, `apps/web/app/components/{auth/VerifyEmailPanel,settings/DeleteAccountPanel}/*`, `apps/web/app/presentation/{verificationSession,deletionTicket}.ts`, `apps/web/app/server.node.ts`, `packages/core/src/application/{errors.ts,identity/getAccountDeletionStatus.ts,ports/{appliedOperationStore,distributedOperationStore}.ts}`, `packages/core/src/adapters/memory/repositories/appliedOperationStore.ts`, `node_modules/@tanstack/start-client-core/dist/esm/createCsrfMiddleware.js`, `spec/adr/{034,037,046,047,048}`。

スキップ（63）:

- `.thread/14/review/` 配下 8 ファイル（`review-001-{docs,domain,general,inventory,presentation,usecase}.md`, `review-001.md`, ただし `triage.md` は確認済みなので本行は 7 ファイル）＋ `.thread/14/{adr,research,research-2,steps,testing}.md` — レビュー中間成果物・作業台帳（12 ファイル）
- `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md` — docs 観点（3）
- `packages/core/src/adapters/conformance/*.ts` 7 本 — アダプター適合スイートの ID 命名（inventory / domain 観点）（7）
- `packages/core/src/application/{di/containerStore.ts,identity/{completeOAuthCallback,removeIdentity,uniqueness,view}.ts,ports/{accountDeletionManifestStore,scopeCleanupAdmissionStore,shareTokenProtector}.ts,storage/__tests__/deleteFilesByOwner.test.ts}` — application / port JSDoc（ユースケース・ドメイン観点）（9）
- `packages/core/src/domain/{identity/errorCode.ts,identity/ports/identityRepository.ts,identity/ports/identityUniqueDirectory.ts,storage/errorCode.ts}` — ドメイン観点（4）
- `spec/adr/{052,053,054,057}-*.md`, `spec/adr/index.md` — 台帳粒度・ドメイン判断・手順書追随の ADR（docs / domain 観点）（5）
- `spec/domains/{identity,index,note,storage,usage}.md` — ドメイン観点（B-002 の根拠として `index.md:147` の state 語彙のみ参照）（5）
- `spec/inventory/{adapter,domain,test,usecase}.md` — 台帳観点（4）
- `spec/manual-tests/{account,index}.md`, `spec/scenario/account.md` — シナリオ・手順書観点（3）
- `spec/testcases/identity/*.md` 9 本 — テストケース観点（9）
- `spec/usecases/{storage,usage}.md` — ユースケース観点（`storage.md:500` の ADR 056 / platform リンクのみ参照）（2）

（12 + 3 + 7 + 9 + 4 + 5 + 5 + 4 + 3 + 9 + 2 = 63。確認 20 ＋ スキップ 63 = **83**）
