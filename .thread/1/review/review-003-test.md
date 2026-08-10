# Review 003 — Test（網羅性・テスト設計・適合ハーネス・TC カバレッジ）

対象: PR #12（`issue/1/account-to-blank-note-skeleton` vs `main`）
契約: `.thread/1/plan.md` / `docs/test.md` / `spec/inventory/{test,adapter}.md` / `spec/testcases/`
台帳: `.thread/1/review/triage.md`（判定済み Key は再審議しない）
ラウンド2 修正コミット: `ea0fddb`

## ラウンド2 指摘（W-001..W-008）の修正確認

| 台帳 Key | 内容 | 判定 |
| --- | --- | --- |
| R2-TS-W-001 | UoW スイートの順序 assert | **済（ただし穴あり）**。順序 assert は `adapters/memory/__tests__/unitOfWork.test.ts` へ移設され、共有スイートは「各 run が原子的に commit し relay kick は commit 1 回につき 1 回」＋「並行する失敗 run は自分の書き込みだけを巻き戻す」の 2 ケースに置換。JSDoc に移植性の理由（ADR-014）も明記。→ **W-001** |
| R2-TS-W-002 | resolveMany 契約の食い違い | **済**。`noteRouteStore` の `ConflictError("NOTE_ROUTE_BATCH_TOO_LARGE")` を `SystemError(DatabaseError)` へ統一し、適合スイートも `isSystemError` へ。`application/ports/noteRouteStore.ts` / `domain/identity/ports/userBatchReader.ts` の両 `Error contract:` 行に相互参照つきで上限超過が明記された。造語コードはリポジトリから消滅（`grep NOTE_ROUTE_BATCH_TOO_LARGE` → 0 件） |
| R2-TS-W-003 | 100 件上限の切り詰め未検証 | **済（3/4）**。`accountDeletionManifestStore` に claimPending/compactItems（101 件 → 100+1）・pruneTerminal（101 → 100+1）・appendMembershipPage（101 → 100+1、`nextCursor` は契約上 edge-key 順なので値 assert も妥当）、`globalMaintenanceRunStore.pruneCompleted`（101 → 100+1）を追加。いずれも「上限を無視する実装が緑で通る」状態を潰している。`scopeCleanupAdmissionStore` の 1 ケースだけ空振り → **W-003** |
| R2-TS-W-004 | apps/web テスト 0 件 | **済**。`apps/web/app/presentation/__tests__/{errorResponse,redirect}.test.ts` を新設（下記で個別評価）。`docs/test.md:54` の Frontend 節にも例外規定を追記。ただし対象関数の選定に漏れ → **W-004**、パッケージ依存の宣言漏れ → **W-005** |
| R2-TS-W-005 | 実時刻参照 | **済**。`getNote.test.ts:162,174` は `h.clock.now()` へ。リポジトリ全体を再走査して `new Date()` / `Date.now()` / `Math.random` / `setTimeout` を持つテストは 0 件 |
| R2-TS-W-006 | タイミングテスト片側のみ | **済**。`signInWithPassword.test.ts` は登録済み失敗経路と未登録経路の verify 回数を両方計測して `toBe(registered)` の比較命題にした。加えて「1 回目の `hash()` が reject → 2 回目で再導出 → 3 回目は memo」を hashCalls 1/2/2 で pin する回帰テストが増え、ADR-034 の WeakMap memo が仕様として固定された。`signUpWithPassword` 側にも hash 回数の対称テスト（新規 1 回 = 既存 1 回）が入っている |
| R2-TS-W-007 | store.ts の生 NUL | **済**。`git diff` がテキストとして差分を出す状態に戻り、`store.ts` 全体をレビューできた。JSDoc のキー形式の記述も実装（`edge.userId` フィールド絞り込み）に合わせて修正済み |
| R2-TS-W-008 | README・vitest の死んだ記述 | **済**。README のコマンド表は node のみに更新、`vitest.config.ts` の `**/*.integration.test.ts` 除外は削除。除外を消したことで apps/web 配下の新規テストが root 実行に自然に入っている |

他観点のラウンド2 修正のうちテスト資産に関わるものも確認した。

- **R2-DM-W-002（note 遷移4点）**: 提案の 4 点すべてがテストになっている。(1) `applyConversionResult` が manual タイトルを保持し auto のみ差し替え、差し替え時だけ `note.renamed` を併発（イベント配列を `["note.contentUpdated","note.renamed"]` の順序込みで assert）、(2) `updateBody` の `ready` 組み立て、(3) 201 件 → 200 件の切り詰めを **両入口**（applyConversionResult / updateBody）で、(4) `Note.reconstruct` の public + パスワード付き休眠リンクを `RehydrationError` で。加えて (4) の対照（パスワードなしの休眠リンクは通る）が置かれており、ガードが広すぎる方向の退行も検出できる。
- **R2-DM-W-001（サロゲートペア分断）**: `Excerpt.fromText` を 199 字 + 絵文字（199/200 単位に跨る）で切り、長さ 199・UTF-8 往復無損失・`Excerpt.create` 再検証まで assert。境界ちょうど（198 字 + 絵文字 → 200 で絵文字を保持）の対照もあり、片側に倒れた実装を弾ける。`NoteHeading` も同形。
- **R2-SC-W-204 / ADR-033（TC-identity-261）**: 下記「TC-identity-261」節。
- **R2-UA-W-001 / R2-SC-W-202**: 上記 R2-TS-W-006 と同じテストで塞がれている。

## TC-identity-261 と ADR-033 の整合

判断・実装・記録は一貫している。

- ADR-033 の決定（一意性は `IdentityUniqueDirectory` のポート契約、列挙耐性は usecase が畳む）に対し、テストは**両層を別々に**検証している。`signUpWithPassword.test.ts` の TC-identity-261 ケースは (a) 実ユーザーがちょうど 1 件、(b) 2 応答とも `emailVerificationRequired: true` / `sessionToken: null` で decoy userId が互いに異なる、(c) 送信メールが `emailVerification` + `existingAccountNotice` の 1 通ずつ、まで assert したうえで、(d) **同じテスト内で** `identityUniqueDirectory.reserve` を直接叩いて `ConflictError("EMAIL_ALREADY_USED")` がポート契約として生きていることを確認している。ADR の「層で分担する」がテストの構造にそのまま写っており、片方だけ緩めた退行はどちらかで落ちる。
- 追加された「孤児 reservation」ケース（commit 失敗 + release 喪失で TTL 10 分の reserved 行が残った状態）は ADR-033 の Context に書かれた競合窓そのもので、`users.size === 0` かつ `existingAccountNotice` のみ、という「新規登録は成立しないが応答は同一」の形を pin している。`resolve` が reserved を返さないという設計上の穴が応答に漏れないことの直接検証で、実装の写しではない。
- spec との乖離は `.thread/1/progress.md:69` の spec-sync 集約に、対象ファイル（`spec/testcases/identity/signUpWithPassword.md` / `spec/inventory/test.md:400`）と改訂後の期待値まで書かれて記録されている。**spec が古く実装が正しい状態が正しく記録されている**と判断する。
- 残る弱点は 1 点だけ: テスト本体のコメントは「なぜ 409 を返さないか」を説明しているが **ADR-033 を参照していない**。spec/inventory の TC-261 行と正面から矛盾するテストなので、後日 spec-sync が spec 側を正として「テストを直す」方向へ倒す事故が起こりうる。コメント 1 行に `ADR-033` を書き足せば閉じる（Warning に起こすほどではないため記録に留める）。

## 機械照合

- **TC カバレッジ**: `vitest list` の**テスト名**から TC ID を抽出して plan.md と突合。
  - 実装対象（`TC-identity-008..016,150..178,213..237,247..255,259,261..263` / `TC-note-054,058..065,165,168..173,176..178,187`）のうち、テスト名に現れないのは **`TC-identity-232` の 1 行のみ**（→ **W-002**。assert 自体は存在するのでカバレッジの実体は欠けていない）。
  - 見送り確定行（`TC-identity-256..258,260` / `TC-note-055..057,066,166,167,174,175,179..186,188,189`）の混入は **0 件**。
  - glue の `TC-identity-294..304` のうち 303/304 は `TC-identity-302/303/304` の複合名に埋まっており、他所で使われている `TC-x-A / TC-x-B` 形式では書かれていない（→ W-002 に同梱）。
- **ADP カバレッジ**: 適合スイート + memory ローカルから ADP ID を抽出（range 宣言 `ADP-common-012..025`・複合 `ADP-note-037/038/039` を展開）。`ADP-common-001..039` / `ADP-identity-001..032,035..038` / `ADP-note-008..049` は**欠落 0**、見送り分（`ADP-identity-033/034`、`ADP-note-001..007,050..054`）の混入も**0**。ラウンド2 から崩れていない。
- **実行**: `pnpm test:unit` → 26 files / 429 tests 全緑（2.86s）。`pnpm typecheck` も緑（`apps/web/tsconfig.json` は `**/*` を include するので新規テストも型検査対象に入っている）。
- **決定性・状態リーク**: テスト配下に壁時計・乱数・タイマーは 0 件。`it.only` / `describe.skip` は 0 件、`ctx.skip()` は `accountDeletionManifestStore.ts:293,324` の 2 箇所のみで、いずれも `seedMembershipEdges` 未提供バックエンド向けの明示 skip（memory では両方走る）。ダミーハッシュの memo は ADR-034 どおり `WeakMap<PasswordHasher, …>` へ移り、`createTestHarness()` が runtime ごとに hasher を作るためテスト間の持ち越しは解消している。

## Blockers

なし

## Warnings

- **[W-001]** 共有 UoW スイートが「並行 run の中間状態が他方から観測されない」を一切 pin しておらず、書き込み透過＋補償だけのバックエンドが全ケースを通過する — 場所: `packages/core/src/adapters/conformance/unitOfWork.ts:148-193`（並行 2 ケース）/ 理由: R2-TS-W-001 の修正で順序 assert を memory ローカルへ移したのは正しいが、共有スイート側に残ったのは「両方が commit される」「失敗 run は自分の書き込みだけ巻き戻す」「relay kick が commit 数と一致する」の 3 点だけで、**すべて単一 run の原子性の言い換え**にとどまっている。memory バックエンドは `backend.transactions.run` の undo ログによる書き込み透過型で、隔離性は mutex による直列化からしか来ていない（`adapters/memory/globalUnitOfWork.ts:38`）。つまりこの suite は「原子性はあるが隔離性がない」実装を検出できず、Issue #11 の D1/DO バックエンドが部分可視状態を露出しても緑で通る。usecase テストの「並行 2 要求で 1 勝者」（TC-identity-261 / TC-note-062 等）はまさにこの性質に依存しているので、契約から落ちたのは実害のある穴 / 提案: 順序ではなく**全か無かの可視性**を assert する 1 ケースを共有スイートへ足す。run A が 2 行（例: user + identity）を suspension point を挟んで書き、並行する run B が両方を読んで「0 件か 2 件、1 件は不可」を assert する形なら、mutex 直列化でもトランザクション隔離でも通り、素の書き込み透過実装だけが落ちる。
- **[W-002]** 実装対象 TC のうち `TC-identity-232` だけテスト名に現れず、機械照合が 1 行だけ素通りする — 場所: `packages/core/src/application/identity/__tests__/signInWithPassword.test.ts:103`（`// TC-identity-232: clear removes the record without waiting for TTL.`）/ 併せて `verifyEmail.test.ts:170` の `TC-identity-302/303/304` / 理由: `docs/test.md:13` は「Usecase tests carry their spec TC ids in the test name so coverage is mechanically traceable」を規律として明文化しており、plan.md のテスト方針も「TC ID をテスト名に含めて対応を機械的に追えるようにする」と書いている。TC-232 の assert（`loginAttemptStore.get(keyFor())` が `null`）は `TC-identity-213` のケース本体に同居しているだけで、テスト名からの抽出では拾えない。ラウンド2 の「全行がテスト名に存在」という照合結果は、ファイル本文の grep がコメントまで拾ったための偽陽性だった。`302/303/304` も他所の複合表記（`TC-identity-217 / TC-identity-233`）と形式が違うため同じ抽出器では分解できない。TC-232 の期待結果（`spec/inventory/test.md:371`）自体は満たされているのでカバレッジの実体に欠落はなく、壊れているのは追跡可能性のほう / 提案: TC-213 のケース名を `TC-identity-213 / TC-identity-232: …` にする（assert は既にある）。`302/303/304` も `TC-identity-302 / TC-identity-303 / TC-identity-304` へ揃える。
- **[W-003]** `ScopeCleanupAdmissionStore.pruneCompleted` の 100 件上限ケースは構造的に空振りで、主張する契約を検証できない — 場所: `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts:116-131`（`pruneCompleted clamps an over-cap limit to the 100-row page cap`）/ 理由: このストアは scope あたり `RECEIPT_KEY` 1 行しか持たない（`adapters/memory/repositories/scopeCleanupAdmissionStore.ts:9,33`）ため、`removed` は最大でも 1 で、`toBeLessThanOrEqual(100)` と `toBe(1)` は **limit を丸ごと無視するバックエンドでも、limit を素直に尊重するバックエンドでも通る**。テスト自身のコメントが「the cap can never be saturated here」と認めているとおり、ケース名が主張する clamp は一度も実行されない。加えて `application/ports/scopeCleanupAdmissionStore.ts:38` の契約文は「`pruneCompleted` reclaims at most `limit` receipts per pass」で、100 という上限をそもそも謳っていない。他 3 ポートで確立した形（101 件投入 → 100+1）を横展開できない対象に、形だけ揃えたケースが残っている状態で、D1 実装者には「検証済みの契約」に見えてしまう / 提案: 「1 scope = 1 receipt なので limit は事実上効かない」ことをケース名とコメントで正直に書くか（現在の assert のままで意味が通る）、ケースごと削除する。100 件上限を契約として持たせたいならポート JSDoc 側に先に書く。
- **[W-004]** ラウンド2 で入った「原文 message を画面に出さない」修正の本体（文言辞書）にテストが無く、R2-FE-W-001 の退行が全自動検証を素通りする — 場所: `apps/web/app/presentation/errorDisplay.ts:80-96`（`renderErrorMessage` / `displayError` / `sanitizeRouteError`）と `apps/web/app/presentation/errorResponse.ts:194-203`（`extractSerializedError`）/ 理由: R2-TS-W-004 の修正は `httpStatusFor` / `redactForClient` / `safeRedirectPath` の 3 つに限定され、`docs/test.md:54` の例外規定もその 3 つしか挙げていない。しかし R2-FE-W-001 を実際に塞いだのは `renderErrorMessage` の「読むのは `kind` と `code` だけ、辞書に無い code は kind の共通文言へ倒す」という規約で、これは 3 関数とまったく同じ性質（フレームワーク非関与の純関数 + spec/design §9・§10 由来の閉じた辞書）を持つ。`MESSAGE_BY_KIND` から 1 行落とす、あるいは `error.message` を混ぜる形に戻す退行は現在どのテストにも当たらない。`extractSerializedError` も同様で、`serializeError` フォールバックが `kind: "unknown"` を返すからこそ原文 message が UI に出ないという連鎖に依存しているのに、この経路（`AppServerError` インスタンス / 構造だけ残った残骸 / 素の Error）が一度も実行されていない / 提案: `apps/web/app/presentation/__tests__/errorDisplay.test.ts` を 1 ファイル足す。最低限、(a) 全 `SerializedErrorKind` × 辞書外 code で `MESSAGE_BY_KIND` に倒れる、(b) 返り値が `error.message` を**含まない**（原文混入の一般形を 1 本の assert で塞げる）、(c) `extractSerializedError` の 3 経路（`AppServerError` / `{serialized}` 残骸 / 素の Error）が期待の `SerializedError` を返す、の 3 点。
- **[W-005]** `apps/web` がテストファイルを持つようになったのに `vitest` を宣言していない — 場所: `apps/web/package.json`（devDependencies に `vitest` なし）に対し `apps/web/app/presentation/__tests__/*.test.ts` が `import { describe, expect, it } from "vitest"` / 理由: 現状動くのはワークスペースルートの `node_modules/vitest`（root devDependency）まで解決が登り切っているからで、`packages/core/package.json` が `vitest` を自パッケージの devDependency として宣言しているのと非対称。宣言のない依存はホイスト設定（`pnpm-workspace.yaml` の `publicHoistPattern` は `@types/*` のみ）や pnpm のバージョン差で静かに壊れ、`pnpm --filter @repo/web exec vitest` も現状は成立しない。テスト実行そのものが root 集約という方針は妥当だが、型解決を root ホイストに依存させる理由は無い / 提案: `apps/web/package.json` の devDependencies に `"vitest": "^4.1.6"` を足す（`packages/core` と同じ形）。

## 良かった点（記録）

- ラウンド2 の 8 件がいずれも字面ではなく根本に対応している。とくに R2-TS-W-006 は「片側 assert では比較命題にならない」という指摘の趣旨どおり `toBe(registered)` の形へ書き換えたうえで、ADR-034 の memo 設計まで hashCalls 1/2/2 で仕様化しており、指摘より一段深い。
- R2-TS-W-001 の修正は、共有スイートの JSDoc に「なぜ順序を契約にしないか」（D1 は対話型トランザクションを持たない）を書き、移設先のローカルテストにも「なぜここにあるか」を書いている。移植性の判断が両側から読める形で残った（W-001 はその線引きの適用漏れであって、方針自体は正しい）。
- 100 件上限の横展開（R2-TS-W-003）で `appendMembershipPage` の `nextCursor` に `"edge-099"` という具体値を assert しているのは、ポート契約が「edge-key 順のキーセット」と明示している（`application/ports/accountDeletionManifestStore.ts:60-61`）ため backend 固有ではない。W-001 で問題にした「実装特性の契約化」との線引きが正しくできている。
- 境界値が等号込みで揃っている点はラウンド2 から維持（254/255、200/201、800,000/800,001、23h59m/24h、29日/30日、100/101、500/501、+ 今回 199/200 のサロゲート境界）。
- `redirect.test.ts` は `//`・`\`・スキーム付き・相対・空文字・`undefined`/`null` を網羅しており、ガードの「通す側」も 3 形（パス・クエリ+ハッシュ・ルート）で押さえている。実装の写しではなく攻撃形の列挙になっている。

## カバレッジ（変更ファイル一覧 400 行との対応）

内訳は `A` 214 / `D` 145 / `M` 41。

### 確認

- 契約・規約: `.thread/1/plan.md`、`.thread/1/adr.md`（ADR-033 / ADR-034）、`.thread/1/progress.md`（spec-sync 集約・見送り一覧）、`.thread/1/review/triage.md`、`.thread/1/review/review-002-test.md`、`.thread/1/review/review-002-domain.md`（R2-DM-W-002 の提案 4 点）、`docs/test.md`
- 適合スイート: `packages/core/src/adapters/conformance/` 26 ファイル（`unitOfWork` / `accountDeletionManifestStore` / `globalMaintenanceRunStore` / `scopeCleanupAdmissionStore` / `noteRouteStore` / `backend` はラウンド3 差分を全読 + 周辺を再読、他は ADP ID 抽出と `ctx.skip()` / 非決定性の全走査で確認）
- memory ローカル: `adapters/memory/__tests__/` 5 ファイル（新規 `unitOfWork.test.ts` を全読、`conformance.test` / `conformanceBackend` / `cryptoAdapters.test` / `miscAdapters.test` はラウンド2 から無変更を確認）
- usecase テスト: `application/identity/__tests__/`（`signInWithPassword` / `signUpWithPassword` は差分全読、`verifyEmail` / `authenticateSession` / `pruneExpiredAuthState` / `authFlowHelpers` はテスト名と TC ID 照合）、`application/note/__tests__/`（`getNote` 差分全読、`createBlankNote` / `listNotes` は TC ID 照合）、`application/workers/__tests__/` 2、`application/__tests__/helpers.ts`（状態リーク・決定性）
- domain テスト: `domain/note/__tests__/{note,valueObject}.test.ts`（ラウンド3 差分を全読）、`domain/note/__tests__/noteAccessPolicy.test.ts` と `domain/identity/__tests__/` 5（テスト名 + 非決定性走査）
- apps/web: `apps/web/app/presentation/__tests__/{errorResponse,redirect}.test.ts`（全読）、被検体の `presentation/{errorResponse,redirect,auth,errorDisplay}.ts`、消費側の `routes/signin.tsx` / `components/auth/SignInForm/index.tsx`（`safeRedirectPath` の到達先確認）
- 被検体のうちラウンド3 で変更された実装: `application/identity/signInWithPassword.ts`（ダミーハッシュ memo）、`application/identity/signUpWithPassword.ts`、`adapters/memory/globalUnitOfWork.ts`、`adapters/memory/repositories/{noteRouteStore,scopeCleanupAdmissionStore}.ts`、`adapters/memory/support.ts`、`adapters/memory/store.ts`、`application/ports/{noteRouteStore,accountDeletionManifestStore,scopeCleanupAdmissionStore}.ts`、`domain/identity/ports/userBatchReader.ts`、`domain/note/valueObject.ts`
- テスト実行基盤: `vitest.config.ts`、`package.json`、`packages/core/package.json`、`apps/web/package.json`、`apps/web/tsconfig.json`（変更なしだが include 範囲の確認）、`pnpm-workspace.yaml`、`.github/workflows/ci.yml`、`README.md`
- spec 側: `spec/inventory/test.md`（TC-identity-230..237 行の期待結果、TC-261 行）、`spec/inventory/adapter.md`（ADP 対象範囲）

### スキップ

- **削除ファイル群（`D` 145 件すべて）** — 旧 todo テスト、旧 d1/libsql `__tests__` 12、worker integration テスト 2、`di/serverCloudflare.test.ts`、`vitest.config.integration*.ts` 2、および非テスト資産（`adapters/{d1,libsql,aws,cloudflare,gcp}/`、`apps/web/{server,worker,scripts,vite.config,wrangler,drizzle}` の他ランタイム分、`infra/{aws,cloudflare,gcp}/`、`docs/runtime_{cloudflare,aws,gcp}.md`）: plan AC-14 / ADR-004 どおりの削除で、置き換え先（memory 適合スイート + usecase テスト）をラウンド1〜3 で検証済み。ラウンド2 からの差分なし。
- **`apps/web/app/components/**`・`routes/**`（signin.tsx / SignInForm を除く）・`styles/**`・`routeTree.gen.ts`・`server.node.ts`・`worker/node/runner.ts`** — フロントエンド実装。テスト資産なし。`presentation/` のうちテスト対象にすべき純関数は W-004 で指摘済みで、残り（`serverFragment.tsx` / `errorResponseMiddleware.ts` / `session.ts` / `clientKey.ts` / `serverErrorLog.ts` / `validator.ts` / `pagination.ts` / `appServerErrorAdapter.ts`）はフレームワーク結合が強く、`.thread/1/testing.md` の手動項目に委ねる判断を妥当と見なした。
- **`packages/core/src/domain/**`（`__tests__` 以外）・`application/**`（usecase・ports・di・errors・execution のうち上記変更分を除く）・`adapters/memory/**`（同）** — テストの被検体。契約適合はテスト経由で検証済み（実装レビューは domain / usecase-adapter 観点の担当）。
- **`.thread/1/{steps,testing}.md`・`.thread/1/review/review-00{1,2}-*.md`（test・domain 以外）・`.thread/1/review/review-00{1,2}.md`** — 他観点の成果物。
- **`docs/{backend,frontend}_implementation_example.md`・`docs/runtime_node.md`・`biome.json`・`apps/web/.env.example`・`apps/web/vite.config.node.ts`・`pnpm-lock.yaml`・`CLAUDE.md`** — テスト設計に非関与（ラウンド2 で確認済み、ラウンド3 での変更は README / docs/test.md のみ）。
