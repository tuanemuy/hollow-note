# レビュー R3 — プレゼンテーション・画面・データモデル・プラットフォーム

第 3 ラウンド（収束確認）。見たのは (1) 第 2 ラウンドの修正が正しく入っているか、(2) 対になる側が置き去りになっていないか、(3) 自観点の AC の検査が実際に通るか、の 3 点。

## プレゼンテーション・画面・データモデル・プラットフォーム

### Blockers

なし。

### Warnings

- **[W-001]** `apps/web/app/start.ts:10-11` の CSRF コメントが、M-38 で改めた spec の判定順を反映していない
  - 場所: `apps/web/app/start.ts:10-11`（`which is what the CSRF rule in \`spec/presentation/index.md\` requires an \`Origin\` check for.`）
  - 理由: M-38（R1）で `spec/presentation/index.md:126` は「**`Sec-Fetch-Site` → `Origin` → `Referer` の順**に確認し、いずれの手掛かりも持たない要求は拒否する」へ改まり、実装（`@tanstack/start-client-core/createCsrfMiddleware.js:20-36`）もその順で判定する。start.ts のこの文は本 PR が AC-16 で書き換えた当の行でありながら、規約を `Origin` 検査に切り詰めたままになっている。同じ規約を語る `apps/web/app/routes/settings/-action.tsx:167-169` は既に 3 ヘッダーの順を正しく書いており、同一 PR 内で粒度が割れている。**セキュリティ規律の記述が事実より狭い**という点で M-38 と同型（規律そのものは実装で担保されているので Blocker ではない）
  - 提案: `requires an \`Origin\` check for` → `requires the same-origin check for`（または `-action.tsx` と同じく `Sec-Fetch-Site` → `Origin` → `Referer` の順を 1 句で書く）。コメント文字列のみの変更で、AC-63 の「振る舞いを変えない」に収まる

### 第 2 ラウンドの修正の検証結果

| Key | 判定 | 実地確認 |
| --- | --- | --- |
| M-70 | 正しく入っていた | 3 か所すべてに語彙の帰属が入っている（`spec/presentation/index.md:236` / `spec/inventory/frontend.md:121` `PAGE-p25-003` / `:122` `PAGE-p25-004`）。**`failed` は落ちていない**（3 か所とも保持し「この状態へ移す遷移を定めた箇所が本設計に無い」と明記）。**CHECK は 3 値のまま**（`spec/database/index.md:138` = `CHECK IN ('running','completed','rejected')`、`spec/domains/index.md:147` も 3 値）。追跡は `.thread/14/plan.md` Phase 5 の 16.（AC-60 の対象）へ入っている |
| M-82 | 正しく入っていた | `spec/inventory/frontend.md:20`（`PAGE-p03-004` = 4 状態 ＋ 期限切れ・無効では再送が主導線）と `spec/pages/index.md:178`（状態行 = 「期限切れ（再送。サインインへの導線を再送フォームに従属させて添える）/ 無効（同上）」）の**両方**が直っている。実装と一致 — `VerifyEmailPanel/index.tsx` の `verifiedSignInRequired:146` / `alreadyVerified:155` が `PrimaryLink to="/signin"`、`expired:164` / `invalid:173` が `ResendActions`（`:197-208` で再送フォーム＋従属サインインリンク）を描く |
| M-83 | 正しく入っていた | `spec/database/index.md:1039` に「`markApplied` の 2 部鍵は列を増やさず、`operation_id` 1 列へ決定的に畳む（`sha256(operationId + ":" + commandKey)`）」が入り、`:35` からも参照している。実装 `adapters/memory/repositories/appliedOperationStore.ts:10-13` は `sha256(\`${operationId}:${commandKey}\`)` で一致。列表は `operation_id \| text \| PK` のまま（列を増やす向きを採っていない）ので、同ファイルの JSDoc（「mirroring the single `operation_id` primary key」）も偽にならない |
| M-69 | 正しく入っていた | `apps/web/app/presentation/session.ts:17-20` が「`Secure` outside the plain-http `development` deployment (spec/adr/037)」へ改まり、`spec/presentation/index.md:40`（「外すのは平文 `http` で動く `development` の配備だけで、判定は許可リストで行う（ADR 037）」）と一致。実装 `:36,48` の `secure: !isDevelopment()` とも一致。同ファイル `:32` の中立な書き方へそろっている |
| M-85 | 正しく入っていた | `.dockerignore` から `!.env.*.example` が消えている（差分は `**/.wrangler` / `infra/aws/cdk.out` / `!.env.*.example` の 3 行削除）。`git ls-files \| grep -E "\.env"` = `.envrc.example` / `apps/web/.env.example` の 2 件で、`.env.*.example` に一致する追跡ファイルは 0 件。`!.env.example` は残しており対象を失っていない。ファイルごと消すかは Phase 5 の 13. で追跡済み |

**反映漏れ 0 / 反映ミス 0 / 新たな矛盾 0。**

### 第 1 ラウンドの修正の退行チェック（自観点分）

| Key | 判定 | 実地確認 |
| --- | --- | --- |
| M-13（`unauthorized` / `forbidden` 行） | 退行なし | `spec/presentation/index.md:196,197` に両行がある。実装 `errorResponse.ts:102-111` の `unauthorized: 401` / `forbidden: 403` と一致。「`ForbiddenError` はどの経路も投げない」は事実（`grep -rn ForbiddenError packages/core/src apps/web/app` は `errors.ts` の定義と `errorResponse.ts` の型 import のみ）。`UnauthorizedError("UNAUTHENTICATED")` は `startOAuthFlow.ts:68` / `linkOAuthIdentity.ts:140` で実在 |
| M-38（CSRF 判定順） | 退行なし（spec 側） | `spec/presentation/index.md:126` が `Sec-Fetch-Site` → `Origin` → `Referer` の順と「いずれの手掛かりも持たない要求は拒否」を書き、`createCsrfMiddleware.js:20-36`（`fetchSite !== null` → `origin !== null` → `referer`、いずれも無ければ `undefined` → 拒否）と厳密に一致。**コード側の対が 1 か所残る → W-001** |
| M-39（`Cache-Control` の例外） | 退行なし | `spec/presentation/index.md:183` が「静的アセットと、鍵が内容に一意な保管オブジェクトの配信（…`private` を外さない）」を例外として書く。実装 `server.node.ts:72` の既定 `private, no-store` ＋ `withSecurityHeaders`（既存値を上書きしない）と、`routes/storage.$.tsx:52` の `private, max-age=31536000, immutable` に一致。`spec/inventory/frontend.md` の `PAGE-p47-001` には足していない（M-35 採用 (b) どおり） |
| M-40（`Secure` の ADR 037 参照） | 退行なし | `spec/presentation/index.md:40` に ADR 037 参照あり。リンク `../adr/037-node-env-allowlist.md` は実在 |
| M-41（URL 割り当て表の例外注記） | 退行なし | `spec/pages/index.md:49,51` に `設定 *` と脚注（「`/settings/danger` は**認証ガードの唯一の明示的な例外**」）。実装 `routes/settings/route.tsx:21,32-34` の `SIGNED_OUT_PATH = "/settings/danger"` と一致。P-25 本文（`:489`）の「例外は画面の到達性だけで、`deleteAccountFn` 自体はセッションを要求する」も実装どおり |
| M-14（P-25 の障害状態） | 退行なし | `spec/pages/index.md:494` の「進捗を追えない」と `PAGE-p25-003` が実装 `DeleteAccountPanel/index.tsx` の `settled`（`:61`、`resumeTicket: string \| null` で一時障害だけ ticket を保つ。`:362` 「削除の進捗を表示できません」＋ `:371` 再確認 / `:375` トップページ）と一致 |
| M-34 / M-35 / M-36（`spec/inventory/frontend.md`） | 退行なし | `grep -n "Origin" spec/inventory/frontend.md spec/pages/index.md` = 0 件。`Cache-Control` は `frontend.md` に 0 件。`PAGE-p40-001` / `PAGE-p40-004` は「導線の出し分けの分岐は持たない」で `routes/index.tsx:12-16`（`beforeLoad` で `redirect({ to: "/notes" })`）と一致 |
| M-42（dangling ADR 参照） | 退行なし | `session.ts:32` / `oauthStateCookie.ts:23,66` / `ticketStorage.ts:2` が `spec/adr/037` / `spec/adr/034` / `spec/adr/047` へ差し替わっており、いずれも実在（`ls spec/adr/034* 037* 047*`） |
| M-15（ADR 056 の相対リンク） | 退行なし | `spec/testcases/storage/deleteFilesByOwner.md:11` は `../../adr/056-…` で解決する。下記 AC-68 の検査参照 |

### 対になる側の確認

| 対 | 判定 |
| --- | --- |
| `spec/presentation/index.md` / `spec/pages/index.md` ↔ `spec/inventory/frontend.md` | 一致。P-03（7 状態 / 4 状態の導線）、P-25（例外 / 状態直和 / status 語彙）、P-40（通常のみ / リダイレクト）、`/settings/danger` の例外注記が本文と台帳の両側にある。ヘッダーの「最終同期」は 2026-08-16 に更新済み |
| `spec/presentation/index.md` ↔ `apps/web/app/` の実装・JSDoc | Cookie 属性表（`session.ts:44-50`, `:74-82`）、`Session.ttlMs` 再導出（`sessionCookieExpiry:100-102` ＋ ADR 055）、ステータス写像（`errorResponse.ts:101-111`）、セキュリティヘッダー（`server.node.ts:69-73`）、`/storage/*` の例外（`routes/storage.$.tsx:52`）、削除 status ticket の鍵（`spec/presentation/index.md:94`）まですべて一致。**唯一の不一致が W-001** |
| `spec/database/index.md` ↔ `packages/core/src/adapters/memory/` | `applied_operations` の畳み込み式が `appliedOperationStore.ts:10-13` と一致。`distributed_operations.state` の 3 値 CHECK が `application/ports/distributedOperationStore.ts` の `DistributedOperationState` と一致。`attempts` / `next_attempt_at` / `expires_at` は削られていない（AC-62） |
| `spec/platform/index.md` ↔ `spec/testcases/storage/deleteFilesByOwner.md` | 軸の分離が両側に入っている。platform:152 は「上限ではなく設計目標」＋ 3 文の内訳、testcases:11 は文数を約束しない観測可能な性質。`spec/inventory/test.md:1754` の `TC-storage-043` 行も同文。実装テスト `application/storage/__tests__/deleteFilesByOwner.test.ts:358` の `it` 名が改訂後の行を指し、`:252`（clamping）から `TC-storage-043:` 接頭辞が外れている（M-12） |

### 実行した AC の検査コマンドと結果

| AC | コマンド | 結果 |
| --- | --- | --- |
| AC-17 | `grep -c "private, no-store" spec/presentation/index.md` | `1` — PASS |
| AC-20 / AC-25 | `grep -rin "serverCloudflare\|wrangler\|cdk.out\|runtime_aws\|runtime_gcp\|TodoBoard\|routes/todo\|components/todo\|inputValidator\|drizzle" CLAUDE.md README.md docs/frontend_implementation_example.md` | 0 件 — PASS |
| AC-22 | `grep -ic "todo" docs/frontend_implementation_example.md` | `0` — PASS。加えて同ファイル中の `apps/web/…` / `packages/core/…` / `app/…` 形式のパス参照を全数実在確認（MISSING 0 件） |
| AC-38 | `grep -n "DistributedOperationStore" spec/domains/index.md` ／ `sed -n 138p spec/database/index.md` | `:147` に 1 行言及＋3 値の但し書き、interface 新設なし。CHECK は 3 値。`next_attempt_at` 2 件（削除なし） — PASS |
| AC-47 | `spec/usecases/storage.md:500` のリンク先 | `spec/platform/index.md` の `## 実行予算と分割単位` → `### Scope DO`（`grep -n "^#" spec/platform/index.md` で `139:### Scope DO` を確認）。`#クエリ予算` は 0 件 — PASS |
| AC-49 | `spec/database/index.md` の 4 点 | (a) `:57` 合成式 ＋ ADR 048 参照、(b) `:1041` 宣言集合、(c) `:154` `countTerminalSince` / `AccountDeletionRetryPolicy`、(d) `:1039` 2 ポート分割 ＋ `result` 列の位置づけ — PASS |
| AC-50 | `grep -n "PROVIDER_ACCOUNT_RELEASE_PENDING" spec/presentation/index.md` ／ `grep -n "adr/047" spec/presentation/index.md` | `:200` にステータス表の行、`:94` に `AppConfig` の但し書き（`:23` からも `#appconfig` で相互参照。`### AppConfig` は `:77` に実在） — PASS |
| AC-51 | `spec/pages/index.md` P-25 | `:489` に「この 1 画面だけが認証ガードの明示的な例外」＋ ADR 047。`:492` の「削除されるもの / されないもの」機能行は狭められていない — PASS |
| AC-53 | `spec/testcases/storage/deleteFilesByOwner.md:11` ／ `spec/platform/index.md:152` | 文の数が契約から消え、観測可能な性質へ。3 文は platform の表直後の段落に「上限ではなく設計目標」として移動 — PASS |
| AC-61 | `ls spec/adr/05[2-7]-*.md \| wc -l` ／ `grep -n "05[2-7]" spec/adr/index.md` | `6`。一覧（`:57-62`）と前提依存マップ（`:114-119`）に 6 本とも掲載。ADR 056 は `spec/usecases/storage.md` / `spec/testcases/storage/deleteFilesByOwner.md` / `spec/platform/index.md` の 3 か所からリンク — PASS |
| AC-62 | `grep -c createDownloadUrl spec/domains/storage.md` = 3 ／ `grep -c "workspaceCursor\|nextWorkspaceCursor" spec/usecases/usage.md` = 3 ／ `grep -c next_attempt_at spec/database/index.md` = 2 ／ P-25 機能行 = 1 | すべて 1 件以上 — PASS |
| AC-63（件数のみ） | `git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/ \| wc -l` ／ `\| cut -f1 \| sort \| uniq -c` | `35` = `32 M` / `3 D` / `0 A` — plan の実測と一致、PASS（機械検査の行数側は general 観点） |
| AC-66 | `grep -c "AppliedOperationStore" spec/domains/index.md` | `1`（`:148` に `DistributedOperationStore` と同粒度の 1 行言及）。`spec/database/index.md` も同じ名前を使用 — PASS |
| AC-68（リンク解決） | `spec/` 内の `adr/05[2-7]-*` 相対リンクを 1 本ずつ `dirname` 基準で実ファイル解決 | BROKEN 0 件 — PASS |

## カバレッジ

### 確認（26 件）

- `.dockerignore`
- `.thread/14/plan.md`（自観点の AC の検査のみ）, `.thread/14/review/triage.md`
- `CLAUDE.md`（AC-20 の grep のみ）, `README.md`（AC-25 の grep のみ）
- `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example`（削除。参照 0 件を再確認）
- `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`
- `apps/web/app/components/settings/ProfileForm/action.ts`
- `apps/web/app/presentation/oauthStateCookie.ts`
- `apps/web/app/presentation/session.ts`
- `apps/web/app/start.ts`
- `docs/frontend_implementation_example.md`
- `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`（platform ↔ testcases の対として）
- `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/index.md`
- `spec/database/index.md`
- `spec/domains/index.md`（`DistributedOperationStore` / `AppliedOperationStore` の 2 行のみ。ドメイン全体は domain 観点）
- `spec/inventory/frontend.md`
- `spec/inventory/test.md`（`TC-storage-043` 行のみ。全体は inventory 観点）
- `spec/pages/index.md`
- `spec/platform/index.md`
- `spec/presentation/index.md`
- `spec/testcases/storage/deleteFilesByOwner.md`

### スキップ（75 件）

- `.thread/14/adr.md`, `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md` — 作業成果物。自観点の判断材料としては triage / plan で足りる（docs / general 観点の担当）
- `.thread/14/review/review-001-{docs,domain,general,inventory,presentation,usecase}.md`, `review-001.md`, `review-002-{docs,domain,inventory,presentation,usecase}.md`, `review-002.md`（13 件）— レビュー中間成果物（後続フェーズで削除。内容レビュー不要）
- `docs/backend_implementation_example.md` — バックエンド例。docs 観点の担当
- `packages/core/src/adapters/conformance/{accountDeletionManifestStore,authTokenRepository,identityUniqueDirectory,noteProjection,objectStorage,scopeCleanupAdmissionStore,signInOAuthClient}.ts`（7 件）— 適合スイートの ADP ID 命名。inventory / domain 観点の担当
- `packages/core/src/application/di/containerStore.ts` — DI。general 観点の担当
- `packages/core/src/application/identity/__tests__/{checkHandleAvailability,getProfile,updateProfile}.test.ts`（3 件）— usecase / test 観点の担当
- `packages/core/src/application/identity/{addPasswordIdentity,changePassword,completeOAuthCallback,getProfile,removeIdentity,uniqueness,view}.ts`（7 件）— usecase 観点の担当
- `packages/core/src/application/ports/{accountDeletionManifestStore,scopeCleanupAdmissionStore,shareTokenProtector}.ts`（3 件）— ポート契約。domain 観点の担当
- `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/storage/errorCode.ts` — domain 観点の担当
- `packages/core/src/domain/identity/ports/{authTokenRepository,identityRepository,identityUniqueDirectory}.ts`（3 件）— domain 観点の担当
- `spec/adr/052-adapter-inventory-granularity.md`, `053-account-deletion-rollback-completion.md`, `054-provider-account-uniqueness-owner.md`, `057-manual-test-followthrough.md`（4 件）— 台帳採番 / rollback 完了判定 / 一意性の担い手 / 手順書追随。inventory / domain / docs 観点の担当
- `spec/domains/{identity,note,storage,usage}.md`（4 件）— domain 観点の担当
- `spec/inventory/{adapter,domain,usecase}.md`（3 件）— inventory 観点の担当
- `spec/manual-tests/{account,index}.md`（2 件）— docs / usecase 観点の担当
- `spec/scenario/account.md` — シナリオ。docs 観点の担当
- `spec/testcases/identity/{addPasswordIdentity,checkHandleAvailability,completeOAuthCallback,completeOAuthSignIn,deleteAccount,getProfile,linkOAuthIdentity,requestPasswordReset,signUpWithPassword,startOAuthFlow,updateProfile}.md`（11 件）— usecase / test 観点の担当
- `spec/testcases/storage/storeUpload.md`, `spec/testcases/usage/recalculateStorageUsage.md`（2 件）— usecase / test 観点の担当
- `spec/usecases/{identity,storage,usage}.md`（3 件）— usecase 観点の担当。ただし `storage.md:500`（ADR 056 のリンク先）だけは AC-47 の検査で参照した

**合計: 確認 26 ＋ スキップ 75 = 101 件**（変更ファイル一覧と 1 対 1）。

## 収束判定

- 実装レビューを終えてよいか: **はい**

第 2 ラウンドで自観点に割り当たった 5 件（M-70 / M-82 / M-83 / M-69 / M-85）はすべて正しく入っており、反映漏れ・反映ミス・新たな矛盾はいずれも 0 件。第 1 ラウンドの修正にも退行は無い。残る W-001 はコメント文字列 1 語の是正で、規律自体はミドルウェアが担保しているため、マージのブロッカーにはならない（次のコメント整理フェーズで拾えれば十分）。
