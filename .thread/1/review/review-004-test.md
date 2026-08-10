# レビュー 004 — Test（4ラウンド目 / フルレビュー）

対象 PR: #12（base: main / branch: issue/1/account-to-blank-note-skeleton）
契約: `.thread/1/plan.md` / 既出台帳: `.thread/1/review/triage.md`（Key 一致の既出指摘は再審議せず）
変更ファイル一覧: 408 行（A 221 / D 145 / M 42）

## Test

### Blockers

なし。

`pnpm test:unit` は 27 files / 447 tests 全緑。ラウンド1〜3 で `fix` 判定になったテスト側の指摘（W-008 / W-010 / W-011 / W-012 / W-013 / R2-TS-W-001..008 / R3-TS-W-001..005）は、以下の機械照合とミューテーション検証で実効性を確認した。

#### 検証1: 実装対象 TC 全行 × テスト名の機械照合

`plan.md` AC-8..13 の実装対象 TC（96 行: identity-008..016 / 150..178 / 213..237 / 247..255,259,261..263、note-054 / 058..065 / 165 / 168..173 / 176..178 / 187）を抽出し、`packages/core/src` + `apps/web/app` 中の TC ID 出現と突き合わせた結果 **MISSING: none**。追加分は `TC-identity-294..304`（verifyEmail — AC-17 の glue、`verifyEmail.test.ts` 冒頭コメントで根拠が明示されている）のみで、見送り TC の混入もなし。

ADP 行も同様に照合（`ADP-common-001..039` / `ADP-identity-001..032,035..038` / `ADP-note-008..049`、`ADP-x-NNN/NNN` 短縮記法を展開して集計）した結果 **MISSING: none / EXTRA: none**。AC-7 の列挙と 1:1。

#### 検証2: TC ID 表記規律（ラウンド3で統一したはずの点）

TC ID を含む全行のうち、`it(` / `describe(` の名前**以外**に現れるのは 2 箇所のみ:

- `signInWithPassword.test.ts:103` — `TC-identity-232` の補足コメント。同 TC は `:88` のテスト名にも入っている（R3-TS-W-002 の是正が維持されている）。
- `adapters/conformance/loginAttemptStore.ts:10` — スイート JSDoc。同 TC は `:46` のテスト名にも入っている。

崩れなし。

#### 検証3: ミューテーション（修正を戻すと落ちるか）

ラウンド3 で追加されたテストが空振りしていないことを、実装側を一時的に退行させて確認した（いずれも確認後 `git checkout` で復元済み、作業ツリーはクリーン）。

| 戻した修正 | 落ちたテスト |
|---|---|
| `errorDisplay.ts` の `Object.hasOwn` ガードを素の添字アクセスへ（R3-FE-W-007） | `errorDisplay.test.ts` 1 件（"ignores codes inherited from Object.prototype"） |
| `globalMaintenanceRunStore.ts` の `reclaimLapsedLanes` を無効化（R3-UA-W-001） | `TC-identity-174` + 適合スイート `ADP-common-030` 2 件 = 計 3 件 |
| `pruneExpiredAuthState.ts` の `finally` 内 lane 解放を空配列へ（R3-UA-W-002） | `TC-identity-171` / "a budget-exhausted cron releases…" / "a lane operation that throws…" = 3 件 |
| `memory/store.ts` の UoW 直列化 mutex を除去（R3-TS-W-001） | 共有スイート `ADP-common-003: a concurrent run never observes a half-written run` + backend-local `memory global unit of work serialization` = 2 件 |

4 件すべて回帰を検出する。空振りしているものはない。

#### 検証4: `TC-identity-174` の書き換えと spec の整合

`spec/testcases/identity/pruneExpiredAuthState.md`（「lane owner停止後に10分leaseが切れる / 次Cronで回復する / 同じrun・table・cursor position を新owner がclaim し、重複run を作らず完了まで進める」）および `spec/inventory/test.md:313` と、`pruneExpiredAuthState.test.ts:629-684` の実装は整合している — 100 件掃いた lane を claimed のまま放置 → 11 分進めて lease 失効 → 次 cron が run を 1 本のまま再開し残り 50 件を掃いて `completed` まで到達、を assert している。`progress.md:71` の「TC 記述が continuation 前提になっていないか確認」という申し送りは、spec 側が既に「次 Cron で回復する」と書いているため追随不要。**指摘なし。**

なお本 TC は放置 lane を `PRUNE_LEASE_OWNER`（= 自プロセス id）で staging しており、実際のクラッシュ時に起きる「別 owner が失効 run を引き取る」経路そのものは踏んでいない。ただし (a) 検証3 のとおり lapsed 判定は load-bearing で、(b) 別 owner 経路は適合スイート `ADP-common-030`（`owner-a` → `owner-b`）が cursor 保持込みで押さえている。二重に穴は空いていないので指摘には上げない。

#### 検証5: 適合スイートの取りこぼし

`adapters/conformance/` の 22 スイートは全て `memory/__tests__/conformance.test.ts` に登録済み（孤児スイートなし）。`adapters/memory/repositories/` の 20 実装すべてに対応スイートがあり、残る `mailSender` / `passwordHasher` / `secureTokenGenerator` / `shareTokenProtector` / `timeZoneResolver` は `miscAdapters.test.ts` / `cryptoAdapters.test.ts` が受け持つ。memory 実行時の skip は 0 件（`ctx.skip()` を持つ seeded 系 2 ケースも memory では実走行）。

### Warnings

- **[W-001]** ADR-038（login CSRF）の照合ロジックに自動テストがない — `apps/web/app/components/auth/VerifyEmailPanel/action.ts:33-42` / `apps/web/app/presentation/session.ts:59-89`
  - 理由: セッション Cookie を焼く条件 `session.readPendingVerificationUserId() === view.userId` は、R3-SC-B-301（攻撃者セッションの注入）を塞ぐ唯一のガードでありセキュリティ critical。にもかかわらず自動テストは 0 件で、回帰は `.thread/1/testing.md` 項目3 の手動手順でしか検出できない（CI では走らない）。`docs/test.md:54` は frontend について「例外は `apps/web/app/presentation/` の純関数（status mapping・redaction・オープンリダイレクトガード・`errorDisplay` の辞書）— フレームワーク非関与で閉じた spec リストを符号化しているため unit テストを持つ」と規定しており、この判定条件はまさにその類型に該当する。`safeRedirectPath` を framework import から切り離して `redirect.ts` に置きテストした前例（同 PR 内）がそのまま適用できる。
  - 提案: 判定を presentation の純関数へ切り出す（例 `shouldIssueVerificationSession(pendingUserId: string | null, view: { userId: string; sessionToken: string | null }): boolean`）。`action.ts` はそれを呼ぶだけにし、`presentation/__tests__/` に (1) 一致 + token あり → true、(2) 不一致 → false、(3) Cookie 不在（`null`）→ false、(4) `sessionToken === null`（`alreadyVerified`）→ false の 4 ケースを置く。特に (3) は `null === null` で誤って true にならないことの回帰固定になる。あわせて `action.ts:35-36` の `view.sessionToken !== null && requestedHere` の二重評価も 1 本化できる。テストなしで出荷する場合は、手動手順の実施記録を Issue コメントに残すことを出荷条件にすべき。

- **[W-002]** `TC-note-065` が本番から到達しない関数を検証している — `packages/core/src/application/note/createBlankNote.ts:140` / `packages/core/src/application/note/__tests__/createBlankNote.test.ts:174-237`
  - 理由: `recoverBlankNoteCreation` の呼び出し元はリポジトリ全体でテストのみ（`grep -rn recoverBlankNoteCreation` の結果が実装定義・JSDoc・テスト 3 行だけ）。spec の TC は「recovery を実行する」という操作を前提にしているのでテスト自体は仕様に忠実であり、TC カバレッジ上の欠落ではない。問題は、`pruneExpiredAuthState` のランタイム配線が `plan.md` の見送り一覧に明記されているのに対し、この recovery のスケジュール配線は plan.md にも `progress.md` の見送り項にも記載がないこと。結果として「期限切れ reserved route が実際に回収される」ことは誰も保証していないのに、テストが緑であることでカバー済みに見える。
  - 提案: `progress.md` の見送り一覧に一行（「`recoverBlankNoteCreation` の定期実行配線は後続スライス。usecase とテストのみ本スライスで実装」）を追記し、Issue コメントの見送り一覧にも転記する。実装変更は不要。

- **[W-003]** テストの死んだ束縛 — `packages/core/src/application/identity/__tests__/verifyEmail.test.ts:105,114`
  - 理由: `TC-identity-299` が `const { userId, verificationToken } = ...` で受けた `userId` を使わず、`void userId;` で lint を黙らせている。新規テストファイルに残った lint 回避の痕跡で、読み手には「本来 userId を assert すべきだったのでは」と読める。
  - 提案: 分割代入から `userId` を落として `void` 文を削除する（1 行）。もし本来 assert すべき内容（例: purpose 差し替え後もユーザーが pending のまま）があるならそれを足す。

## カバレッジ

### 確認

- `docs/test.md`（M） — 改訂後の分類・fake ポリシー・frontend 例外規定を読み、本レビューの判定基準に使用
- `vitest.config.ts`（M）/ `vitest.config.integration.ts`（D）/ `vitest.config.integration.node.ts`（D） — 単一 node pool 構成、integration 設定の削除（ADR-002/003）を確認
- `package.json` / `apps/web/package.json` / `packages/core/package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`（M） — `test` / `test:unit` の委譲と `apps/web` の vitest 宣言（R3-TS-W-005）を確認
- `apps/web/app/presentation/__tests__/errorDisplay.test.ts`（A、10 件） — 全 8 kind のフォールバック、prototype 継承コード、`NOTE_ACCESS_DENIED` = `NOTE_NOT_FOUND`、原文 message 非露出、`extractSerializedError` 4 経路、`displayError`。ミューテーション検証済み
- `apps/web/app/presentation/__tests__/errorResponse.test.ts`（A） — kind→status 全網羅・code 例外の kind スコープ・`redactForClient` の system/unknown 剥離
- `apps/web/app/presentation/__tests__/redirect.test.ts`（A） — 制御文字（`\n` `\t` `\r` DEL NUL）・バックスラッシュ・protocol-relative・scheme あり（R3-SC-W-303）
- `apps/web/app/presentation/{errorDisplay,errorResponse,redirect,session}.ts`（A/M） — 上記テストの被テスト実装として通読
- `apps/web/app/components/auth/VerifyEmailPanel/{action.ts,index.tsx}`（A） — W-001 の該当箇所
- `packages/core/src/adapters/conformance/` 全 26 ファイル（A） — 22 スイートの `it(` 名を全件確認。`unitOfWork.ts` / `globalMaintenanceRunStore.ts` / `accountDeletionManifestStore.ts` / `scopeCleanupAdmissionStore.ts` / `userBatchReader.ts` / `asserts.ts` / `backend.ts` / `fixtures.ts` / `testClock.ts` は全文精読
- `packages/core/src/adapters/memory/__tests__/`（A 4 ファイル） — `conformance.test.ts`（22 スイート登録の完全性）/ `conformanceBackend.ts`（`seedMembershipEdges` 実装 → skip 0）/ `unitOfWork.test.ts`（backend-local 直列化）/ `cryptoAdapters.test.ts` / `miscAdapters.test.ts`
- `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`（A） — lane 回収契約の被テスト実装として全文精読
- `packages/core/src/adapters/memory/store.ts` / `globalUnitOfWork.ts`（A） — UoW 隔離性ミューテーションの対象として通読
- `packages/core/src/application/__tests__/helpers.ts`（M）/ `fakes/`（既存） — `createTestHarness` の override 経路と TestClock 供給
- `packages/core/src/application/identity/__tests__/` 全 6 ファイル（A） — `authFlowHelpers.ts` / `authenticateSession`(9) / `pruneExpiredAuthState`(30) / `signInWithPassword`(25) / `signUpWithPassword`(16) / `verifyEmail`(9) を全文精読
- `packages/core/src/application/note/__tests__/` 全 3 ファイル（A） — `createBlankNote`(9) / `getNote`(12) / `listNotes`(2) を全文精読
- `packages/core/src/application/workers/__tests__/`（A/M） — `eventDecoderRegistry.test.ts` / `outboxPrune.test.ts`
- `packages/core/src/domain/{identity,note}/__tests__/` 全 8 ファイル（A） — `it(` 名を全件確認し、note.test.ts / valueObject.test.ts は遷移カバレッジ（R2-DM-W-002）・サロゲートペア（R2-DM-W-001）・`Excerpt` 非正 max（R3-DM-W-001）の該当ケースを精読
- `packages/core/src/application/{identity,note}/*.ts`（A） — `verifyEmail.ts` / `pruneExpiredAuthState.ts` / `createBlankNote.ts` はテスト整合の確認のため精読、他はテスト読解に必要な範囲で参照
- `spec/testcases/identity/{pruneExpiredAuthState,authenticateSession}.md` / `spec/inventory/test.md`（既存） — 期待結果との突き合わせ
- `.thread/1/testing.md`（A） — 手動テスト手順。特に ADR-038 の login CSRF 手順（項目3）と自動テストの分担を確認
- 削除された旧テスト群（D）: `packages/core/src/adapters/{d1,libsql}/__tests__/**`(13) / `packages/core/src/application/todo/__tests__/**`(2) / `packages/core/src/application/di/__tests__/serverCloudflare.test.ts` / `packages/core/src/application/workers/__tests__/eventRelayWorker.integration.test.ts` / `packages/core/src/domain/todo/__tests__/**`(4) / `apps/web/app/worker/{cloudflare,node}/__tests__/**`(3) — AC-14（他ランタイム + todo 参照実装の削除）に対応する削除で、テスト観点の欠落なし（対応する ADP/TC は memory 適合スイートが引き取り済み）

### スキップ

- `apps/web/app/components/**`(39) / `apps/web/app/routes/**`(14) / `apps/web/app/styles/**`(3) / `apps/web/app/__root.tsx` / `router.tsx` / `routeTree.gen.ts` — React コンポーネント・ルート定義。`docs/test.md` の frontend 方針（フレームワーク primitive に委ね、純関数のみテスト）に従い Frontend 観点の担当。ただし `VerifyEmailPanel/{action,index}` は W-001 の根拠として確認済み
- `apps/web/app/worker/**`(19 のうち削除分を除く) / `apps/web/app/server.node.ts` / `apps/web/scripts/**` — ランタイム entry・runner。テスト資産の増減がなく、配線は Usecase/Adapter 観点の担当
- `packages/core/src/adapters/memory/repositories/` の残り 19 実装 / `adapters/node/**` — 適合スイートの被テスト側。スイートの網羅性（検証5）で代替確認とし、実装の正しさは Usecase/Adapter 観点の担当
- `packages/core/src/domain/**` の実装 63 ファイル（`__tests__` を除く） — ドメイン実装本体。Domain 観点の担当。テスト側からは `it(` 名との対応のみ確認
- `packages/core/src/application/**` の実装（di / ports / execution / errors / view など） — Usecase 観点の担当。テストから参照した 3 ファイルのみ精読
- `packages/core/src/config.ts` / `biome.json` / `apps/web/{vite.config.ts,wrangler.toml,Dockerfile,drizzle.config.ts}` 等の設定（削除・変更） — テスト実行に関わる `vitest.config*` / `package.json` のみ確認し、他はビルド設定として General 観点の担当
- `infra/aws/**`(6) / `infra/cloudflare/pulumi/**`(11) / `infra/gcp/**`(12) — すべて削除（AC-14）。テスト資産なし
- `docs/` の `runtime_{node,cloudflare,aws,gcp}.md` / `{backend,frontend}_implementation_example.md` / `README.md` / `CLAUDE.md` — `docs/test.md` 以外のドキュメント。General 観点の担当
- `.thread/1/review/review-00{1,2,3}-test.md` / `.thread/1/{adr,plan,progress,steps}.md` — レビュー入力資料であり被レビュー対象外（内容は判定根拠として参照済み）
