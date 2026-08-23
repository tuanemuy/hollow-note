# Round 003 — ノート閲覧のフロントエンド体験・ドキュメント整合

対象: PR #36 / ベース `main` / 差分 `13-round-003.diff`（18 ファイル）

### ノート閲覧のフロントエンド体験・ドキュメント整合

#### Blockers

なし。

#### Warnings

- **[W-001]** `CreateNoteButton` の `router.invalidate()` 理由コメントが、本 PR の変更で偽になった
  - 場所: `apps/web/app/components/note/CreateNoteButton/index.tsx:39-40`
  - 理由: 本 PR は `/notes/` から `staleTime` を外し、代わりに `shouldReload: ({ cause }) => cause !== "preload"` を置いた。`@tanstack/router-core@1.171.15` `src/load-matches.ts:795-826` のとおり `staleTime` は `staleMatchShouldReload` にしか効かず、`shouldReload ?? staleMatchShouldReload` は `shouldReload` が値を返す限り右辺へ落ちない。実際 `staleTime` が残っているのは `/settings/{auth,profile,usage,danger}` だけで、`/notes` にはもう無い。docs 側も L.127 で「Once `shouldReload` is present, do **not** also declare `staleTime` ... That is why neither appears on the routes above」と断定している。このコメントは前提（"`/notes` keeps `staleTime: Infinity` in production"）も帰結（"without the invalidate the list cached before the mutation would never show it"）も現状では成立せず、`/notes` へ戻る遷移は `shouldReload` で必ず再実行される。**変更されたルートの外に残った断定なので、次に画面を足す人はここを根拠に `/notes` の鮮度設計を誤読する。**
  - 提案: 現在の理由に 1 行で置き換える（例: 一覧へ戻ったときの再取得は背景枝なので、`invalidate` はその差し替えを前倒しするためのもの）。理由が自明になったなら CLAUDE.md の「既定でコメントを付けない」に従って落としてもよい。`AccountMenu/index.tsx:57` の `staleTime: Infinity` 言及は `/settings/*` が今も該当するので触らなくてよい。

- **[W-002]** ルートのコメントにある `ADR-005` が、canon の `spec/adr/005-async-processing.md` と番号衝突している
  - 場所: `apps/web/app/routes/notes/index.tsx:20`, `apps/web/app/routes/notes/$noteId.tsx:20`
  - 理由: 指しているのは `.thread/13/adr.md` のローカル番号だが、コメントには何の限定も無い。CLAUDE.md は `spec/adr/` を「現在有効な設計判断の索引」と定めており、リポジトリ内の他のコメントはすべてパス付きで書いている（`presentation/session.ts:18` の `spec/adr/037`、`routes/settings/route.tsx` 周辺の散文、docs L.120 の `spec/adr/031-error-transport-across-rsc-boundary.md`）。`spec/adr/005-async-processing.md` は実在する無関係な ADR なので、無印の `ADR-005` はそこへ読者を送る。`Deferred` の `useDeferredValue` 化はこの PR で最も非自明な判断で、根拠に到達できないと次の人が「素の `use` に戻す」変更を安全だと判断しうる。
  - 提案: `.thread/13/adr.md の ADR-005` と明示する（2 箇所とも同一文なので置換 1 回）。片付けフェーズで `spec/adr/` へ昇格するなら、そのとき採番後の番号へ差し替える。

- **[W-003]** `docs/frontend_implementation_example.md:135` の「neither settles its loader without that round trip」が、既訪 match では偽で、同じ節の L.84 と矛盾する
  - 場所: `docs/frontend_implementation_example.md:135`
  - 理由: `load-matches.ts:823-848` のとおり `status === "success"` の既訪 match は `loaderShouldRunAsync && !sync && shouldReloadInBackground` の背景枝へ落ち、loader を await せずに commit する。同じ節の L.84 が「The re-fetch runs in the background, so the navigation itself settles at once」と書いており、AC-8 は本番ビルドの戻る操作で「遷移は即座に settle する」ことを合格条件にしている。L.135 は無条件の断定なので、AC-8 が観測している主経路（`staleTime` 無し・`shouldReload` 有りの既訪 `/notes`）にそのまま当たって食い違う。旧文（「a streaming route like `/notes` settles its loader immediately and never triggers it」）が一方向に誤っていたのを、逆方向へ振り切った形になっている。
  - 提案: 「初めて入る match では」に相当する限定を 1 句付ける。既訪 match の挙動は L.84 が既に説明しているので、追記は不要。

#### 突き合わせ済み（問題なし）

指示された識別子・断定を実コードと 1 つずつ照合した結果:

| 記述 | 実体 | 判定 |
|---|---|---|
| `use(useDeferredValue(promise))`（docs L.113-118） | `components/ui/Deferred/index.tsx:29` が同一。「初回マウントは前の値が無いのでスケルトンが出る」も React の仕様どおり | 一致 |
| `signInRedirectOptions` / `safeRedirectPath` / `boundedRedirectSource` / `REDIRECT_MAX_LENGTH`（docs L.554 の表） | `presentation/redirect.ts` の export 4 つと完全一致。`/signin` の `validateSearch` と `notes/-action.tsx` の `redirectField` が同じ定数を import している点も記述どおり | 一致 |
| `getInstalledStore()?.getStore()?.config`（docs L.347） | `presentation/appConfig.ts:40` が同一。`containerStore.ts:25-27` に `getInstalledStore` が実在し、`getContainer()` は要求スコープ外で throw する（同 39-57）ので「throw しない読み方」という説明も正しい | 一致 |
| 「`handleRedirectResponse` でもルーターを組む」（docs L.347） | `start-server-core@1.169.17` `createStartHandler.ts:534,681-731` を確認。`getRouter` は要求ごとにメモ化されるが、`_serverFn` 要求では redirect を解決するまで未構築なので、畳んだブリッジの `throw redirect` は実際にルーターツリー構築 + `resolveAppConfig()` を通る | 一致 |
| `staleReloadMode: "blocking"` は `/settings` だけ（docs L.129） | `routes/settings/route.tsx:35-52` がオブジェクト形。`/notes` 系 2 ルートは関数形で `staleReloadMode` を持たない。`load-matches.ts:862-866` が「関数形は `undefined` 扱い」を裏づける | 一致 |
| 「ホバーだけで `/signin` へ飛ぶ」背景枝の `catch`（docs L.129） | `load-matches.ts:843-847` の `catch` が `isRedirect` で `router.navigate` を呼び、preload かを見ていない | 一致 |
| `getRouter` 抜粋（docs L.923-947） | `router.tsx:8-42` と一致（`context` / `dehydrate` / `hydrate` / `Awaited<ReturnType<...>>`）。抜粋が `scrollRestoration` / `defaultPreload` を省くのは抜粋として妥当 | 一致 |
| `head` のガード「16 leaf は `{}`、`__root.tsx` は `{ links: baseLinks }`」（docs L.975） | `head: ({ match })` を持つルートは 17 ファイル、`if (!config) return` も 17 箇所。`__root.tsx:41` だけが `{ links: baseLinks }` を返す | 一致 |
| `/storage/$` の要求スコープ（docs L.347） | `routes/storage.$.tsx:17-38` が `getContainer()` を動的 import で呼ぶ。`settings/-action.tsx:39-47` / `dev/-action.tsx:14-46` の列挙も実在 | 一致 |
| 「401 が残るのはミューテーションと `/settings` 子断片だけ」（docs L.131 / `notes/-action.tsx` 冒頭） | `settings/-action.tsx` は `requireSession()`、`notes/-action.tsx` は `requireSessionOrRedirect()`。`session.ts:126-138` の `sessionUserOrNull` が `UNAUTHENTICATED` だけを `null` に畳む記述も正しい | 一致 |
| AC-13（二重化の記述が 2 箇所とも消えている） | 旧 L.113 / L.545 の主張は消え、「権限判定の権威はハンドラー側」＋ 2 つの形に置き換わっている | 充足 |
| AC-14（`requireAuthenticated` の全消し） | `apps` / `packages` / `docs` / `spec` に 0 件（残るのは `.thread/` の記録のみ） | 充足 |
| `spec/adr/030` の改訂 | 現在形で書かれ、経緯・比較は混ざっていない。追加 2 行の事実性も裏が取れた — `load-matches.ts:824-826` の `loaderShouldRunAsync = status === 'success' && (invalid \|\| ...)` により `router.invalidate()` は背景枝を止めないので「別の利用者がサインインし直しても 1 往復ぶん前の表示が残る」は正しく、`SignInForm/index.tsx:141-146` が `invalidate()` → `history.push` の順で SPA 遷移することも確認した。`/settings` がブロッキングで窓が開かない点も `staleReloadMode: "blocking"` と整合 | 問題なし |
| `Deferred` 化がノート閲覧を壊していないか | 初回マウント＝前の値なし → スケルトン。`/notes` ↔ `/notes/$noteId` は別ルートなので `Match.tsx:432` の `<Comp key={key}/>` が別型となりアンマウントされ、前ノートの本文が新 URL に残る経路は無い（`/notes/$noteId` 間の直接遷移は UI に存在しない — `CreateNoteButton` は `NoteList` 内にしか無く、履歴上も 2 つのノートが隣接しない）。エラー時は deferred lane の `use()` が throw して従来どおり `errorComponent` に落ちる | 問題なし |
| `redirect.test.ts` の実効性 | `boundedRedirectSource` の境界 2 本は `toHaveLength` で上限そのものを固定しており、`REDIRECT_MAX_LENGTH` を動かすと検体長も追随する形になっている。`signInRedirectOptions` は AC-7 の検体（`//evil.example` / `https://evil.example` / `/\evil.example` / 生 LF / `/%0Aevil` 通過）を網羅。既存の `safeRedirectPath` ケースは無改変で残り、`SameOriginPolicy` 委譲の回帰網として機能する | 問題なし |
| CLAUDE.md「Frontend」規約との整合 | 3 層ミューテーション（`DeleteAccountPanel` は `useRouteContext` → `useLoaderData` の供給源差し替えのみで、`useActionState` 側は無改変）、ローディングフォールバックの 2 種（断片スケルトン / `defaultPendingComponent`）の役割分担とも矛盾しない | 問題なし |
| スコープ逸脱 | 18 ファイルすべてが plan のステップ 1〜6 の範囲内。ミューテーション経路・`spec/` 昇格・`SameOriginPath` 値オブジェクト化には手が入っていない | 問題なし |

#### 既出（再指摘しない）

- `/notes` 系 2 ルートの 9 行コメントが逐語で重複している件 → Round 001 note-docs W-004 で wont-fix（ADR-003 の明示要求）
- `CLAUDE.md` の load-bearing files に `sessionGuard.ts` / `appConfig.ts` が未掲載 → Round 001 note-docs W-008 で wont-fix
- `resolveAppConfig` が `undefined` を返しても痕跡が残らない → Round 002 routing W-002 で wont-fix
- `/notes` 系への `staleReloadMode: "blocking"` → Round 002 で据え置き確定

#### カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/ui/Deferred/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし
