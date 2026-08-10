# レビュー 005 — Test（収束判定ラウンド）

対象 PR: #12 / ベース: main / ブランチ: issue/1/account-to-blank-note-skeleton
契約: `.thread/1/plan.md` / 既出指摘: `.thread/1/review/triage.md`（ラウンド1〜4、既出 Key は再審議せず）

ベースライン: `pnpm test:unit` → **28 files / 466 tests all passed**（3.0s、skipped 0）。

## Test

### Blockers

なし

### Warnings

- **[W-001]** ラウンド4で追加された「releaseLane 失敗 → unfinished work」テストが空振りしており、対象の修正（R4-CO-W-004）を一切 pin していない
  - **場所**: テスト `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts:584`（`"a lane whose release fails is reported as unfinished work, not as a completed run"`） / 実装 `packages/core/src/application/identity/pruneExpiredAuthState.ts:252`（`releaseLane` の `catch` 内 `workRemains = true;`）
  - **理由**: ミューテーション検証で `pruneExpiredAuthState.ts:252` の `workRemains = true;` を削除しても **466 tests all passed**（唯一の生存ミューテーション）。原因は、このテストが `maintenanceTablesByKind: { authStatePrune: ["oauth_flow_states", "sessions"] }` を渡していること。レーンの初回テーブルは `oauth_flow_states` で、これは `SWEEP_ORDER_HINT`（`auth_tokens, sessions, login_attempts, oauth_flow_states`）の**最終要素**なので、ack 後に `SWEEP_ORDER_HINT[currentIndex + 1]` が `undefined` となり `nextTable === undefined` 分岐（同ファイル 376-384行）へ落ちる。この分岐は `await releaseLane(lane);` の**直後に無条件で** `workRemains = true;`（382行）を実行するため、`catch` 内の代入が有無にかかわらず `continued: true` が返る。つまりテスト名が主張する「解放失敗だから継続扱い」ではなく「ヒントが次テーブルを名指しできない」経路を通っており、**誤った根拠で緑になっている**。
  - さらに現状の制御フローでは、`catch` 内の `workRemains = true;` が返り値に影響し得る経路が存在しない: `releaseLane` の呼び出しは (a) 382行の無条件 `workRemains = true` を伴う分岐、(b) `finally`（452行）の2箇所のみで、`finally` に未解放レーンが残るのは「予算切れ（277/427行で既に `workRemains = true`）」か「throw 経路（再 throw されるので view を返さない）」に限られる。よって当該代入は現状 **効果を持たない防御コード**であり、テストは原理的に落とせない。
  - **提案**（どちらか）: (1) `releaseLane` を `Promise<boolean>`（解放できたか）に変え、呼び出し側で `workRemains ||= !released` として結果を観測可能にしたうえで、解放失敗がなければ `continued: false` になるケースを組む。 (2) 実装を変えないなら、テスト名・コメントを実際に通る経路（「テーブル集合がヒントで名指しできないレーンは解放して継続報告する」）へ改め、`catch` の代入は防御的で観測不能である旨を実装側コメントに明記する。いずれにせよ「解放失敗を pin している」という現在の主張は取り下げる必要がある。

## ミューテーション検証（ラウンド4追加分）

各ミューテーションは適用 → `pnpm exec vitest run` → `git checkout --` で復元。最終 `git status` はクリーン（本レビュー対象外のファイルを除く）。

| # | 破壊した実装 | 結果 | 落ちたテスト |
|---|---|---|---|
| M1 | `memory/repositories/identityUniqueDirectory.ts` の `expectedUserVersion` 照合を無効化 | **killed** (1 failed) | `ADP-identity-008: activate is conditional on the expected user version` |
| M2 | `memory/repositories/noteRouteStore.ts` の `lastMigrationId === input.migrationId` を `true` に | **killed** | `ADP-note-042: a completed switch does not answer a different migration quoting the same version` |
| M3 | `memory/repositories/globalMaintenanceRunStore.ts` の commandKey から cursor 成分を削除 | **killed** | `ADP-common-027: a lane's commandKey matches the key its position re-derives` |
| M4 | `memory/repositories/noteRouteFanOutReader.ts` を `state === "active"` へ狭める | **killed** | `ADP-note-046/047: enumerates committed routes ... and skips reservations` |
| M4b | 同上を `state !== "tombstone"`（reserved を含める）へ | **killed** | 同上 |
| M5 | `memory/repositories/noteRepository.ts` の id タイブレークを昇順へ反転 | **killed** | `ADP-note-015: listByOwner pages a total updatedAt DESC, id DESC order` |
| M6a | `memory/repositories/accountDeletionManifestStore.ts` の `begin` を INSERT OR REPLACE 相当に | **killed** | `ADP-common-012: a replayed begin preserves everything already recorded` |
| M6b | 同 `membershipFullyAcked` から `cleanupAckedAt` 条件を削除 | **killed** | `ADP-common-017/019/021: the cleanup lane is what finalizes membership items` |
| M7 | `memory/repositories/localNoteQueryService.ts` の `escapeHtml` を除去 | **killed** | `ADP-note-021: highlightedExcerpt escapes the projection's markup` |
| M8a | `domain/note/note.ts` の `reconstruct` ready 必須列チェックを `?? ""` へ戻す | **killed** (3 failed) | `rejects a missing {html,text,excerpt} instead of defaulting it to ""` |
| M8b | 同 `ensurePrivate` のガード条件を無効化 | **killed** | `both refuse to demote the body of a shared note` |
| M9 | `presentation/verificationSession.ts` の `pendingUserId === view.userId` を削除 | **killed** (2 failed) | `refuses when the pending cookie belongs to another user (login CSRF)` / `refuses when no pending cookie is present` |
| M10 | `application/identity/pruneExpiredAuthState.ts:252` の `workRemains = true;` を削除 | **SURVIVED** | （なし → W-001） |

重点検証対象のグループ別判定:

1. 適合スイート（identityUniqueDirectory 条件付き activate / noteRouteStore の migrationId 門番2件 / globalMaintenanceRunStore の commandKey）— **空振りなし**（M1/M2/M3）。なお `noteRouteStore` の門番2件のうち「lost-response replay が同じ route を返す」側は M2 では落ちないが、これは `lastMigrationId` を `true` に固定すると replay 側は依然成立するため（正しい挙動）で、逆向きの門番（別 migration の拒否）が M2 で落ちることをもって条件が pin されていることを確認した。
2. 適合スイート（fanOutReader の state 列挙 / noteRepository の順序 / manifest の begin 冪等 + cleanup レーン / localNoteQueryService のエスケープ）— **空振りなし**（M4/M4b/M5/M6a/M6b/M7）。fanOutReader は「広げる」「狭める」両方向で落ちることを確認済み。
3. ドメイン（`reconstruct` 必須列 / shared note の降格拒否）— **空振りなし**（M8a/M8b）。同 describe 内の `accepts an empty body` と `still defaults missing headings to an empty list` は境界の両側を押さえる補完ケースとして妥当。
4. `presentation/__tests__/verificationSession.test.ts`（4件）— **空振りなし**（M9）。`sessionToken === null` ケースは M9 では落ちないが、これは当該条件を残したミューテーションのため設計どおり。
5. `pruneExpiredAuthState` の releaseLane 失敗ケース — **空振り**（M10 生存）。→ W-001。

## 機械照合（実装対象 TC × テスト名）

- 抽出: テスト・適合スイート中の `TC-(identity|note)-NNN` を全走査 → 107 ID。全 107 ID が `it(...)` / `test(...)` の**テスト名**に出現（コメントのみの ID は 0 件。R3-TS-W-002 で確立した規律は維持されている）。
- 実装対象 TC（plan.md より導出: identity 008-016 / 150-178 / 213-237 / 247-255 / 259 / 261-263、note 054 / 058-065 / 165 / 168-173 / 176-178 / 187）= **96行**。
  - **欠落: 0件**。
- 見送り TC（note 055-057, 066, 166-167, 174-175, 179-186, 188-189 / identity 256-258, 260）を名乗るテスト: **0件**（見送り行の誤実装・誤主張なし）。
- 追加の 11 ID（identity 294-304）は AC-17 の glue である `verifyEmail` の行で、`spec/inventory/test.md` に実在する（`packages/core/src/application/identity/__tests__/verifyEmail.test.ts`）。plan.md のリスク欄が根拠として明記済みで、チェックリスト外の実装ではない。
- 全 107 ID が `spec/inventory/test.md` に実在（架空 ID・タイプミス 0 件）。

## その他の健全性チェック（いずれも問題なし）

- 適合スイート 22 本すべてが `packages/core/src/adapters/memory/__tests__/conformance.test.ts` から呼び出されている（定義したまま未登録＝ファイル単位の空振りは 0）。
- ディスク上の `*.test.ts` は 28 本、実行も 28 本（root `vitest.config.ts` から漏れているテストファイルなし。`apps/web` の 4 本も実行対象に入っている）。
- `it.skip` / `it.only` / `it.todo` は 0 件。`ctx.skip()` は `accountDeletionManifestStore.ts` の3箇所のみで、memory バックエンドは `seedMembershipEdges` を実装しているため実行時 skipped は **0**（W-012 の意図どおり、偽 pass ではなく実行されている）。
- assert を1つも持たない `it` ブロック: 0 件（機械走査）。`expectConflict` / `expectNotFound` / `expectValidation`（`adapters/conformance/asserts.ts`）は「reject したこと」と「型・code」の両方を assert しており、resolve を見逃す作りにはなっていない。

## カバレッジ

- 確認:
  - `packages/core/src/adapters/conformance/`（22 スイート + `asserts.ts` / `backend.ts` / `fixtures.ts` / `testClock.ts`）— ラウンド4差分は全文確認、加えて登録漏れ・空振りを機械検査
  - `packages/core/src/adapters/memory/__tests__/`（`conformance.test.ts` / `cryptoAdapters.test.ts` / `miscAdapters.test.ts` / `unitOfWork.test.ts`）
  - `packages/core/src/application/identity/__tests__/`（6ファイル）、`packages/core/src/application/note/__tests__/`（3ファイル）、`packages/core/src/application/workers/__tests__/`（2ファイル）
  - `packages/core/src/domain/identity/__tests__/`（5ファイル）、`packages/core/src/domain/note/__tests__/`（3ファイル）
  - `apps/web/app/presentation/__tests__/`（4ファイル）
  - ミューテーション対象の実装: `adapters/memory/repositories/{identityUniqueDirectory,noteRouteStore,globalMaintenanceRunStore,noteRouteFanOutReader,noteRepository,accountDeletionManifestStore,localNoteQueryService}.ts` / `domain/note/note.ts` / `application/identity/pruneExpiredAuthState.ts` / `apps/web/app/presentation/verificationSession.ts` / `application/ports/noteRouteFanOutReader.ts`
  - 契約・規約: `.thread/1/plan.md`、`.thread/1/review/triage.md`、`CLAUDE.md`、`docs/test.md`、`spec/inventory/test.md`、`spec/testcases/{identity,note}/`（形式確認）、root `vitest.config.ts`
- スキップ:
  - `apps/web/app/{components,routes,styles}/`、`apps/web/app/presentation/` の非テストファイル — テスト観点の対象外（フロント実装は review-005-frontend の担当。`docs/test.md` の「Frontend は presentation の純関数のみ」方針どおり4本のテストが存在することは確認済み）
  - `packages/core/src/{domain,application,adapters}` の非テスト実装ファイル（ミューテーション対象を除く）— 実装レビューは review-005-core の担当
  - 削除ファイル群（`infra/{aws,cloudflare,gcp}/`、`apps/web/app/worker/{aws,cloudflare,gcp}/`、`adapters/{d1,libsql,aws,gcp,cloudflare}/`、`app/components/todo/`、`app/routes/todo/`、`vitest.config.integration*.ts`、wrangler / drizzle / Dockerfile 系）— 削除に伴うテストの取り残しがないことは「ディスク 28 本 = 実行 28 本」および `pnpm test:unit` の緑で確認済み。個別差分は不要と判断
  - `.thread/1/review/review-00{1,2,3,4}-*.md`、`pnpm-lock.yaml`、`README.md`、`docs/` の `test.md` 以外 — 記録・依存物でテスト網羅性に影響しない

## 結論

Blocker なし。Warning 1件（W-001: ラウンド4追加テスト1本の空振り）。それ以外はラウンド4で追加された適合スイート・ドメイン・presentation のテストがいずれもミューテーションで落ちることを確認しており、実装対象 TC の欠落も 0 件。W-001 は「実装は正しく、回帰ガードだけが効いていない」種類の指摘であり、出荷判断としては W-001 の処置（テスト名の是正または観測可能化）をもって収束と見なしてよい。
