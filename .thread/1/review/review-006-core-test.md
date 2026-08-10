# レビュー 006 — Domain / Use Case / Adapter / Test（最終確認ラウンド）

対象: PR #12 / `issue/1/account-to-blank-note-skeleton` → `main`
契約: `.thread/1/plan.md`
既出指摘: `.thread/1/review/triage.md`（ラウンド1〜5、Key 一致は再審議しない）
位置づけ: 出荷可否の最終判定

## Domain / Use Case / Adapter / Test

### Blockers

なし

### Warnings

なし

**問題点ゼロ**

出荷を止めるべき欠陥（誤った値の書き込み・返却、不変条件の破壊、データ損失、受け入れ基準の未達、ラウンド5修正による退行、テストの空振り、実装対象 TC の欠落）は検出されなかった。

検証コマンドの結果:

- `pnpm test:unit` — 28 files / 466 tests 全緑（3.7s）
- `pnpm typecheck` — `packages/core` / `apps/web` ともに Done
- `pnpm lint` — 248 files / エラーなし（残る 2 infos は biome 設定のマイグレーション案内であり本 PR とは無関係）
- `pnpm format:check` — 260 files / 差分なし

## 重点検証対象（ラウンド5の修正）— 判定: 妥当。退行なし

対象コミット `e91f274` が触れた非ドキュメントファイルは 2 本のみ:
`packages/core/src/application/identity/pruneExpiredAuthState.ts`（コメント 1 箇所の加筆のみ、実行文の変更なし）と
`packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`（`it` 名 1 行 + コメントのみ、アサーション不変）。
プロダクション挙動の変更が皆無であるため、他所への退行は原理的に発生しない。

### 1. テスト名と実際に固定している契約の一致 — 一致している

新テスト名: `a failing lane release is logged rather than thrown, and leaves the lane claimed with the run still unfinished`

同テストが実際に固定している 3 点は、いずれも名前が主張するとおり:

1. **「throw されない」** — `advanceOrAck({completed:false})` が必ず投げるストアを注入した上で
   `await pruneExpiredAuthState(...)` が正常に view を返すことを assert している。
2. **「ログに落ちる」** — `h.logger.byLevel("error")` に
   `[pruneExpiredAuthState] lane release failed` が含まれることを assert している。
3. **「lane は claimed のまま」** — `maintenanceRuns` 全 run の lane のうち `status === "claimed"` が
   ちょうど 1 件であることを assert している。解放が成功していれば 0 件になる。

`run は未完了` に相当する `expect(view.continued).toBe(true)` については、
「この fixture では unnamable-next-table 経路（`releaseLane` 呼び出し直後の `workRemains = true`）が
産んでいる値であり、解放失敗が産んだ値ではない」旨をテスト先頭のコメントが明示している。
主張が実態を超えていないことを確認した。

### 2. 空振りの解消 — 解消している（ミューテーション検証で確認）

**ミューテーション A**（`releaseLane` の `try/catch` を除去し、解放失敗を再送出させる）:

```
FAIL > a failing lane release is logged rather than thrown, ...
Error: release down
 ❯ releaseLane packages/core/src/application/identity/pruneExpiredAuthState.ts:238:33
```

→ 「解放失敗を握り潰してログに落とす」という契約は当テストが**実際に**固定している。空振りではない。
ラウンド5前の旧テスト名（`... is reported as unfinished work, not as a completed run`）が主張していた
「`continued` が解放失敗によって true になる」だけが空振りだったのであり、その主張は名前ごと取り下げられている。

**ミューテーション B**（`releaseLane` の catch 内 `workRemains = true;` を削除）:

→ 31 tests 全緑。コード側コメントの「Defensive today — every current call site already marks work
remaining, so only a future one could observe this」およびテスト側コメントの「防御的代入で観測経路がない」
という記述が、実測どおりで正確であることを確認した。虚偽のコメントではない。

ミューテーションは 2 件とも検証後に原本へ復元し、`git status --porcelain` が空であることを確認済み。

## 機械照合 — 実装対象 TC 全行がテスト名に存在（欠落 0）

`plan.md` の AC-8〜AC-13 が列挙する実装対象 TC 行（TC-identity-008..016 / 150..178 / 213..237 /
247..255 / 259 / 261..263、TC-note-054 / 058..065 / 165 / 168..173 / 176..178 / 187 = **計 96 行**）を
`it(...)` / `test(...)` のテスト名文字列から抽出した ID 集合と突き合わせた。

- **MISSING: 0 件**（96 行すべてがテスト名に存在）
- **EXTRA: 11 件** — `TC-identity-294..304`。これは `spec/inventory/test.md` の verifyEmail 行であり、
  `plan.md` AC-17 / リスク節が「AC-01 を e2e 化するための glue として verifyEmail（UC-identity-002）を
  追加する」と明記している計画内の実装。仕様上の verifyEmail TC は 294..304 の 11 行がすべてで、全行が
  テスト名に存在する（欠落なし）。チェックリスト外の混入ではない。
- 見送り宣言された TC（TC-note-055..057 / 066 / 166 / 167 / 174 / 175 / 179..186 / 188 / 189、
  TC-identity-256..258 / 260）がテスト名に紛れ込んでいないことも同時に確認した。

参考: AC-7 の ADP 行（ADP-common-001..039 / ADP-identity-001..032,035..038 / ADP-note-008..049 = 117 行）
のうち 25 行はテスト名に ID ラベルを持たないが、抽出漏れの 25 行はいずれも適合スイート内で当該メソッドが
実際に呼ばれ assert されていることを標本確認した（例: `TimeZoneResolver.monthOf` / `dayKey` は
`memory/__tests__/miscAdapters.test.ts`、`AccountDeletionManifestStore.acknowledge` /
`allRollbackReleased` / `allRequiredAcknowledged` / `markCompleted` / `markRejected` は
`conformance/accountDeletionManifestStore.ts`）。`docs/test.md` が ID 命名を義務づけているのは
usecase テストの TC 行のみであり、契約実装の欠落ではないため指摘しない。

## 空振り・カバレッジ健全性の横断検査

- **アサーションなしテストの走査**: `packages/core/src` + `apps/web/app` の `__tests__` /
  `conformance` 配下 445 個の `it` / `test` ブロックを機械走査。本文に `expect` / `assert` が現れない
  19 件を抽出したが、全件が実 assert を行うヘルパー経由（`conformance/asserts.ts` の
  `expectConflict` / `expectNotFound` / `expectValidation`、`getNote.test.ts` の `expectNoteNotFound`、
  `authenticateSession.test.ts` の `expectUnauthenticated`）であることをヘルパー実装まで確認した。
  実質の空振りは 0 件。
- **`.only` / `.skip` / `.todo` の走査**: `.only` および `describe.skip` / `it.skip` / `it.todo` は 0 件。
  `ctx.skip()` は `conformance/accountDeletionManifestStore.ts` の 3 箇所のみで、これはラウンド1 W-012
  で「偽 pass を明示的 skip に変える」と判定・修正済みの既出項目。
- **適合スイートの取りこぼし**: `adapters/conformance/` が export する
  `describeXxxContract` 22 本すべてが `adapters/memory/__tests__/conformance.test.ts` から
  呼ばれていることを機械照合（未呼び出し 0 本）。定義だけされて実行されないスイートはない。

## カバレッジ

### 確認

- 重点対象（差分精読 + ミューテーション検証）
  - `packages/core/src/application/identity/pruneExpiredAuthState.ts`
  - `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`
- 機械照合・空振り走査で全量を対象としたもの
  - `packages/core/src/application/{identity,note,workers}/__tests__/` 全テスト
  - `packages/core/src/domain/{identity,note}/__tests__/` 全テスト
  - `packages/core/src/adapters/conformance/` 全 22 スイート
  - `packages/core/src/adapters/memory/__tests__/` 全テスト
  - `apps/web/app/presentation/__tests__/` 全テスト
  - 合計 28 test files / 466 tests / 445 test ブロック
- 契約・規約
  - `.thread/1/plan.md`、`.thread/1/review/triage.md`、`docs/test.md`、`CLAUDE.md`
  - `spec/inventory/test.md`、`spec/testcases/identity/`（verifyEmail 行の照合）

### スキップ

- `apps/web/app/{components,routes,styles}/` — フロントエンド観点の担当範囲。本ラウンドの
  Core / Test 観点では、`presentation/__tests__/` の純関数テストのみを空振り走査の対象に含めた。
- `packages/core/src/` の非テストソース個別精読（domain / adapters / application 実装本体） —
  ラウンド1〜5 で全量を精読済みかつ約100件を triage 済み。ラウンド5 のコミットは
  `pruneExpiredAuthState.ts` のコメント1箇所しか触れておらず、他ファイルへの退行経路が存在しないため、
  本ラウンドでは全量の再精読ではなくテスト緑・typecheck・機械照合による回帰確認に置き換えた。
- `.thread/` / `docs/` / `README.md` / `CLAUDE.md` の記述 — 契約読解のために参照したが、
  レビュー対象（出荷を止める欠陥）としては非コードのため判定対象外。
- `infra/**`、`apps/web/{vite,wrangler,drizzle}.*`、`.github/workflows/ci.yml`、
  `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `biome.json` / `vitest.config.ts` —
  ランタイム削除に伴う構成変更。`pnpm test:unit` / `typecheck` / `lint` / `format:check` が
  全緑であることをもって健全性を確認し、個別精読はスキップ。
- 削除ファイル（`D` 行、todo 参照実装 / libsql / d1 / cf / aws / gcp 一式） — 削除のみで
  新たな欠陥の入り込む余地がなく、残存参照がないことは typecheck / lint / test の全緑が保証する。

## 出荷判定

**出荷可**。Blocker 0 件 / Warning 0 件。ラウンド5 の修正は意図どおりで退行なし、
実装対象 TC 96 行の欠落 0、空振りテスト 0、検証コマンド全緑。
