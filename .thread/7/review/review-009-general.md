### general（カバレッジ補完: 依存関係）

#### Blockers

なし

#### Warnings

- **[W-001]** `parse5` が workerd で動くという前提が、Workers プロジェクトでは「import と `createHtmlProcessor()` の構築」までしか実行されていない
  - 場所: `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts:63,106`（`htmlProcessor` がコンテナに載っていることの確認のみ）、`packages/core/src/application/di/cloudflareRuntime.ts:244`（`createHtmlProcessor()` を Cloudflare composition root が配線）
  - 理由: `adapters/html/__tests__/htmlProcessor.test.ts` は `node` プロジェクトだけで走る（`vitest.shared.ts` の境界により `workers` は `adapters/cloudflare/**` しか含まない）。`parse5@8.0.1` / `entities@8.0.0` の dist に `node:` import・`process`・`Buffer` が無いことは node_modules の grep で確認できるが、それは canon でもテストでもない。最終プラットフォームの composition root が本アダプターを本番経路に載せている以上、「解析・直列化が workerd の isolate で通る」ことを 1 本のテストが固定していないと、parse5 の将来版が Node 専用 API（例: `node:stream` 由来の parser stream）を index から引くようになった時に `pnpm test` が緑のまま通る
  - 提案: `runtimeComposition.test.ts` に「request container の `htmlProcessor.process()` が小さな断片（例: `<p>a<script>x</script></p>`）をサニタイズして返す」1 ケースを足す。許可リストの正しさは node 側の表駆動テストが持つので、ここは「workerd で 1 回走る」ことだけを見ればよい（30 秒枠の pool に 1 件足すだけで、既存の isolate を再利用できる）

- **[W-002]** `@repo/core` に実行時依存を足す判断とその制約（純 JS・`nodejs_compat` 不要で workerd を通ること）が、`.thread/7/adr.md` ADR-007 にしか書かれていない
  - 場所: `packages/core/package.json:14`（`"parse5": "^8.0.1"`）、`packages/core/src/adapters/html/htmlProcessor.ts:1050-1057`（`createHtmlProcessor` の JSDoc — 「parse5 の fragment parser は全域関数」「stateless で共有可」は書かれているが、実行環境の制約は無い）
  - 理由: `spec/adr/013:221` が「ライブラリの選定は実装の判断に残す」と決めているので、parse5 という選定自体を `spec/` に上げる必要は無い。しかし「両 composition root が同じ 1 インスタンスを共有し、それが Node と workerd の双方で動く純 JS でなければならない」という制約は依存を差し替える者に効く不変条件であり、変更（この Issue）より長く生きる。CLAUDE.md は `.thread/` を正典としないことと「理由そのものを適用される場所に書く」ことを求めているが、この制約は今 `.thread/7/adr.md:179` にしか無く、Issue が閉じるとコードのどこからも辿れなくなる。`docs/backend_implementation_example.md` の adapter 群の説明も `memory/` / `conformance/` / `cloudflare/` だけで、`html/`（`oauth/` と同じ「関心事で切った箱」）に触れていない
  - 提案: `createHtmlProcessor` の JSDoc に 1〜2 文足す — 「両ランタイム（Node / workerd）が同じインスタンスを配線するため、下敷きのパーサーは Node 専用 API を持たない純 JS でなければならない。parse5 はその条件を満たす（依存は `entities` のみ）」。あわせて `docs/backend_implementation_example.md` の adapter 群の列挙に `adapters/html/` を 1 行加える。[W-001] のテストを足せば JSDoc の主張に執行力も付く

#### テスト保証

- `parse5` / `entities` が Node で `HtmlProcessor` の契約を満たすこと（`adapters/html/htmlProcessor.ts:createHtmlProcessor`）— 守っているテスト: `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`（node プロジェクト、TC-note-001〜017 / 682〜741 の表駆動）
- `parse5` が workerd で import・構築できること（`application/di/cloudflareRuntime.ts:createCloudflareRuntime`）— 守っているテスト: `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts:builds a request container carrying every port the type declares`（構築まで。解析の実行は [W-001] のとおり該当なし）
- lockfile と `package.json` の整合 — 該当なし（`pnpm ls --filter @repo/core parse5` で `parse5@8.0.1` の 1 件解決を手元で確認）

#### 確認した事実（指摘に上げなかったもの）

- スコープ: `parse5` は AC-3 / AC-4 / AC-6（サニタイズ・SVG・テキストノード編集）の実体である `HtmlProcessor` アダプター（plan.md:52 の ADR-001 で本スライスの持ち分と決着）の唯一の利用先。`packages/core/src/adapters/html/htmlProcessor.ts:6-7` 以外に import は無く、`apps/web` は `@repo/core/adapters/html/htmlProcessor` 経由でしか触れないので web 側に宣言を足す必要は無い。無関係な依存は紛れていない
- バージョン指定: `^8.0.1` はキャレット。同じブロックの `uuid ^14.0.0` / `zod ^4.4.3` と同じ流儀で、`catalog:` も pin も使っていない既存方針と一致。8.0.1 は 2026-04-19 更新の `latest`、deprecated 無し
- 置き場所: 本番の request container（memory / cloudflare 両 composition root）が使うので `dependencies` が正しい
- lockfile: 差分は `importers.packages/core` の 1 項目と `parse5@8.0.1` / `entities@8.0.0` の `packages` / `snapshots` 各 2 項目のみ。`lockfileVersion` / `settings` / `overrides` に変更無し、巻き添え更新無し
- ライセンス: parse5 MIT、entities BSD-2-Clause。サイズは dist で各 400 KB 弱（未圧縮、`entities` は `sideEffects: false`）。`entities` の `engines.node >=20.19.0` はルートの `>=22.12.0` の内側
- Workers 互換: 両パッケージとも `dist` に `node:` import・`process.env`・`Buffer`・`createRequire` は無く（一致した 3 行はすべて JSDoc 内の `require('parse5')` の用例）、`nodejs_compat` に依存しない純 JS。ADR-007 が言う「Node / workerd の双方で動く」は事実として成立している（それをテストが固定していない点だけ [W-001]）

#### カバレッジ

- 確認: `packages/core/package.json`, `pnpm-lock.yaml`
- スキップ: なし
