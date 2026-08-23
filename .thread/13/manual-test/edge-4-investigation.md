# エッジケース 4 の差異調査 — `/` へのクライアント遷移が 2 本 / 2 段になる

**対象:** `.thread/13/manual-test/run-a-observations.md`「エッジケース 4」/ `.thread/13/testing.md`「エッジケース 4」/ `.thread/13/plan.md` L.59, L.103
**調査ブランチ:** `issue/13/reduce-navigation-rpc-roundtrips`（PR #36）
**結論:** **C — 計画の見込み違い。** 2 本は構造上正しい。PR #36 の退行ではない。

## 判定

| 候補 | 判定 | 根拠 |
| --- | --- | --- |
| A: PR 起因の退行 | **否** | `apps/web/app/routes/index.tsx` は `main` と**バイト単位で同一**（`git show origin/main:apps/web/app/routes/index.tsx` と比較）。`main` はさらに `__root.tsx` の `beforeLoad: () => loadAppContext()` が毎ロード走るので、同じ経路の要求数は `main` ≧ ブランチ。ブランチだけが増える経路が存在しない |
| B: 既存の挙動 | **部分的に該当** | 2 本になるメカニズム（下記）はルーターライブラリ側の挙動で、`main` にもそのまま存在する。ただし `main` の実測は「2 本」ではなく、同じ測り方なら `loadAppContext` が各パスに加わる |
| **C: 計画の見込み違い** | **該当** | `plan.md` / `testing.md` の「1 本」は **`defaultPreload: "intent"` の preload がクリック時にもう一度予約されること**を数えていない。マウスでクリックする限り 2 本が正しい |
| D: 観測環境の制約 | **否** | `agent-browser` 固有ではない。ライブラリのコードで説明でき、フォーカス済みリンクをプログラム的に起動すると 1 本に落ちることまで実測できた |

## メカニズム

2 本はどちらも `/` ルート（`routes/index.tsx`）の `beforeLoad` が撃つ `sessionUserFn` で、**別々の `loadMatches` パス**から出ている。

1. **1 本目 = ナビゲーション本体。** クリック → `router.navigate` → `loadMatches` → `/` の `beforeLoad` → `sessionUserFn`。
2. **2 本目 = クリックに伴って予約された intent preload。** `@tanstack/react-router` の `useLinkProps` は `onFocus` / `onMouseEnter` の両方を `enqueueIntentPreload` に繋いでいる（`src/link.tsx:662-681, 706-707`）。`defaultPreloadDelay` の既定は **50ms**（`router-core/src/router.ts:1038`）で、`router.tsx` は未指定。マウスでリンクを押すと `mouseenter` / `focus` がクリックの直前に走ってタイマーが張られ、**ナビゲーションが終わったあとに `doPreload()` が発火**して `router.preloadRoute` がもう一度 `loadMatches` を回す。
3. **`beforeLoad` にはキャッシュ判定が無いので、この 2 回目でも必ず再実行される。** `executeBeforeLoad`（`router-core/src/load-matches.ts:388-531`）は `route.options.beforeLoad` を無条件に呼ぶ。手前の `handleBeforeLoad` が見る `shouldSkipLoader`（同 171-189, 552）も hydration / SSR の分岐しか持たず、`staleTime` も `preloadStaleTime` も `shouldReload` も参照しない。さらに 1 回目が in-flight なら `preBeforeLoadSetup`（同 355-386）が前の `beforeLoadPromise` を await してから実行するため、**2 本は必ず直列に見える**。

`/notes` 系・`/settings` 系で同じ二重取得が起きないのは、そちらのガードが **loader** に載っているため。loader は `loadRouteMatch`（同 878-920）で進行中の `loaderPromise` を await し、`status === 'success'` なら再実行しない — つまり loader には dedupe の経路があり、`beforeLoad` には無い。**`/` は測定対象のうち唯一「loader を持たない `beforeLoad` だけのルート」**なので、ここだけ本数が 1 本多く出る。

## 実測（ブランチ・DEV `pnpm dev` / :3100・未サインイン `/signin` → ロゴ）

| 条件 | 結果 |
| --- | --- |
| A. 実マウスでロゴをクリック（`agent-browser click`） | `sessionUserFn` **2 本 / 直列**（例: `956-965`, `990-994` ／ 別ラン `14213-14233`, `14235-14239`）。run-a の観測を再現 |
| B. `history.pushState` を計測すると | `push=14212` → 要求 `14213-14233` → 要求 `14235-14239`。URL 確定はガードより**先**（TanStack Router は commit してから load する）。2 本はどちらも URL 確定後 |
| C. JS で `focus()` だけ（クリックしない） | `sessionUserFn` **1 本**（`865-868`）。= `onFocus` が preload を撃つことの直接の証拠 |
| D. C のあと 1 秒待ち、計測をクリアしてから `element.click()`（フォーカス済み・新たな `mouseenter` / `focus` なし） | `sessionUserFn` **1 本**（`6289-6293`）。= ナビゲーション本体の下限は 1 本 |

C + D が「2 本目 = クリック操作が誘発する preload」であることを示している。

## `main` との関係

ブランチ切替は行っていない（作業ツリーに未コミットの `.thread/13/testing.md` 変更と未追跡の `.thread/13/manual-test/` があり、`main` には両方とも存在しないため切替が破壊的になる）。代わりにコードで確定させた:

- `routes/index.tsx` は `main` と同一 → `/` のガードは変わっていない。
- `main` は加えて `__root.tsx` の `beforeLoad: () => loadAppContext()` を持ち、これも `executeBeforeLoad` にキャッシュ判定が無いため**パスごとに**撃たれる。
- `defaultPreload: "intent"` は `main` から変わっていない（`router.tsx` の差分では文脈行）。

したがって同じ測り方（マウスでクリック）なら `main` は `loadAppContext` + `sessionUserFn` を**パスごとに** = 計 4 本、ブランチは 2 本。**PR #36 はこの経路の要求を半減させており、Issue の主題に反する退行は無い。**

## `plan.md` / `testing.md` の直しどころ

1. **エッジケース 4 の期待値を「1 本」から改める。** 測り方を固定したうえで、
   - マウスでクリックして測る（現行の計測手順 1〜8 のまま）なら **2 本 / 直列 2 段**（内訳: ナビゲーションのガード 1 本 + クリックが誘発する intent preload 1 本）。`main` は同条件で 4 本。
   - 「`/` の下限は 1 往復」という**除外の根拠そのものは成立する**。それを直接示したいなら、**リンクを先にフォーカスして preload を出し切ってから、新たな `mouseenter` / `focus` を伴わない形で起動する**（キーボードの Enter、またはフォーカス済み要素への `element.click()`）と 1 本になる、という測り方を手順に足す。
2. **計測手順（testing.md L.107-124）の前提を補う。** 現行は「クリック前に preload を静止させれば preload 分は計測区間に入らない」という前提だが、**クリック操作そのものが 50ms 後に intent preload をもう 1 本予約する**。`beforeLoad` だけのルートではこれが本数に乗る。
3. **plan.md L.76 / testing.md エッジケース 2 の記述は `beforeLoad` には当てはまらない。** 「preload が in-flight のままクリックすると本数が 1 本少なく出る」は `loadRouteMatch` の早期 return、すなわち **loader を持つルート限定**。`beforeLoad` 側は `preBeforeLoadSetup` が待ってから**必ず再実行**するので、逆に 1 本多く出る。
4. AC-1〜AC-4（`/notes` 系・`/settings` 系）は loader 側の dedupe が効くため、この訂正の影響を受けない（run-a の実測 1 本 / 2 本と整合）。

## 参照

- `apps/web/app/routes/index.tsx`（`main` と同一）
- `apps/web/app/router.tsx:21`（`defaultPreload: "intent"`、`defaultPreloadDelay` 未指定 = 50ms）
- `node_modules/.pnpm/@tanstack+react-router@1.170.18_.../src/link.tsx:662-681, 706-707`
- `node_modules/.pnpm/@tanstack+router-core@1.171.15/.../src/load-matches.ts:171-189, 355-386, 388-531, 552, 878-920`
- `node_modules/.pnpm/@tanstack+router-core@1.171.15/.../src/router.ts:1038`
