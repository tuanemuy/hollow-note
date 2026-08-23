# 指摘台帳 — Issue #13 / PR #36

## Round 001

3 本のレビュー（auth B:1/W:6、routing B:1/W:7、note-docs B:2/W:8 — 計 25 件）を統合して **21 件**。

| Key | 元ID | 判定 | 理由 | 再指摘回数 |
| --- | --- | --- | --- | --- |
| `routes/settings/route.tsx:loader` / preload が実ナビゲートする | routing B-001 | fix | **実測で裏を取った。真の退行。** `load-matches.js:436-449` の背景枝は `catch (err) { if (isRedirect(err)) await inner.router.navigate(err.options) }` で preload を一切見ない。`/settings` レイアウト match はタブ間 preload でもアクティブなので `resolvePreload`（同 19-21 `inner.preload && !matchStores.has(matchId)`）が false → `getLoaderContext`（同 348 `cause: preload ? "preload" : cause`）が渡す cause は `"stay"` → `shouldReload` true → `status === "success"` → 背景枝 → `router.navigate`。`main` の `beforeLoad` 版は同 516 `if (isRedirect(err)) throw err` を通って `preloadRoute`（`router.js:768-778`）の catch に着き、ナビゲートしなかった。提案の `staleReloadMode: "blocking"` も実装で確認 — 同 458 が `routeLoader?.staleReloadMode` を見るので**オブジェクト形の loader でのみ有効**、`"blocking"` なら同 436 の条件が偽 → 同 450 の `await runLoader` に落ち、redirect は `Promise.all` → `loadMatches`(536) → `preloadRoute` の catch へ戻る。解決策として成立する | 0 |
| `docs:123` + `routes/notes/-action.tsx:9` / 401 の系統が発火しない | note-docs B-001, auth W-002 | fix | **実測で裏を取った。真。** `authenticateSession.ts:61-66` は `user.status !== "active"`（削除中／削除済み）も authEpoch 不一致も期限切れも `unauthenticated()`（`ValidationError("UNAUTHENTICATED")`）に収斂し、`session.ts:126-138` の `sessionUserOrNull` が `code === "UNAUTHENTICATED"` を漏れなく飲むので `requireSessionOrRedirect` は必ず redirect を投げる。畳んだブリッジから 401 が出る経路は存在しない。ADR-002 Consequences（`.thread/13/adr.md:75`）の「2 系統が残る」という前提そのものが誤りで、ADR 側の誤りに合わせて書かれた doc と実装コメントを事実へ戻す（ADR で決着済みだから wont-fix、には該当しない — **前提が事実と食い違っていることが新事実**） | 0 |
| `docs:334-336` / `getContainer()` 例外リストが陳腐化 | note-docs B-002 | fix | 真。`routes/__root.tsx` は `createRootRouteWithContext` になり `getContainer` を呼ばない（現物確認済み）。代わりに `presentation/appConfig.ts:22-28` が 4 件目の直接呼び出しになっている。「閉じたリスト」と明記された規約なので、旧エントリ残存＋新エントリ欠落は規約の穴。同ファイル内で完結 | 0 |
| `spec/adr/030` 影響欄 / 「前の利用者のデータが残る経路が構造的に消え」 | auth B-001 | fix | 真。本 PR 後、`/notes` `/notes/$noteId` では別タブ／サーバー側の失効（他端末サインアウト・パスワード変更の authEpoch 更新・絶対期限切れ）で 1 往復ぶん前セッションの `loaderData` が描画される。**挙動側は ADR-003（`.thread/13/adr.md:159`）が明示的に受容した既決事項なので蒸し返さない** — `/notes` 系へ `staleReloadMode: "blocking"` を入れる提案は wont-fix 相当。直すのは canon の記述だけ。plan.md:62 がスコープ外に置いたのは「本 Issue の設計判断の `spec/` への昇格」であって「本 PR が偽にした既存 canon の訂正」ではなく、CLAUDE.md が `spec/` に真であることを要求している。1 文の追記で閉じる | 0 |
| `routes/notes/-action.tsx:14` / `location.href` 2048 超で `/notes` が壊れる | routing W-001 | fix | 真。`/notes` は `validateSearch` を持たないので任意のクエリが `location.href` に載り、`.validator` は handler より前に走るため 2048 文字超で断片にもガードにも到達せず errorComponent（`ServerErrorState`）に落ちる。`main` では正常描画または `/signin`。本 PR が入れた退行。ただし `.catch("/notes")` にすると AC-7 後半（2049 文字 → 422）を捨てることになるので、**転送境界の上限は DoS 上限として残し、呼び出し側で clamp する** | 0 |
| `.thread/13/testing.md:290,293` + `plan.md:45` / AC-7 の `/%0Aevil` 検体 | auth W-004, routing W-002 | fix | **実測で裏を取った。指摘は正しく、AC の側が誤り。** `SameOriginPolicy.isSameOriginPath`（`sameOriginPolicy.ts:17-32`）はパーセントデコードせず生の C0/DEL しか見ないので、文字列 `"/%0Aevil"` は同一オリジンパスとして**通る**。これは `main` でも同じで欠陥ではない（最終消費点は `SignInForm` の `router.history.push` で生文字列）。手順書のまま実行すると誤った不合格または誤った合格が記録される。述語の強化はしない（過度に防御的）— 直すのは AC-7 と手順書の検体・期待値 | 0 |
| `docs:839` / redirect の置き場の列挙が陳腐化 | routing W-004, note-docs W-002 | fix | 真。`presentation/auth.ts` は現在 16 行で `redirect` を import すらしていない（現物確認済み）。redirect の決定は `presentation/sessionGuard.ts` と `routes/notes/-action.tsx` へ移った。読者が auth.ts を見に行って何も見つけられない | 0 |
| `routes/{notes/index,notes/$noteId,settings/route}.tsx` + `docs:75-78` / 死んだ `staleTime` | routing W-006, note-docs W-003 | fix | 真。`load-matches.js:430-435` のとおり `shouldReload` が非 undefined を返す限り `staleTime` / `preloadStaleTime` は参照されない。**ADR-003（`.thread/13/adr.md:136`）は「1 行添える」と「行ごと落とす」の両方を許しており、落とす判断は既決事項の蒸し返しに当たらない。** 死んだ設定 + 同一の注意書き 4 箇所複製は次に `shouldReload` を外す人が 1 箇所だけ直して腐らせる形。`/notes` では元々あった生きた WHY（鮮度は `router.invalidate()` が担う）を潰している | 0 |
| `routes/notes/{index,$noteId}.tsx:14-19` / コメントが戻っていない性質を戻したと読ませる | auth W-001 | fix | 真。`beforeLoad` の性質は「毎ナビゲーション再実行」と「描画前にブロッキング」の 2 つで、`shouldReload` が戻すのは前者だけ。既訪 match は背景枝に落ちるので失効後は前回の `loaderData` が 1 往復ぶん出る。`shouldReload` は消しても型が通る種類のオプションで、効能の**範囲**を書くことが唯一の防波堤 | 0 |
| `routes/notes/{index,$noteId}.tsx:17-19` / `/settings` 固有の但し書きの複製 | note-docs W-004 | **wont-fix** | **ADR-003 で決着済み**（`.thread/13/adr.md:165`）: 「『`shouldReload` を関数形にしたのだから preload では鳴らない』と読める書き方をコードにもドキュメントにも残さないこと。3 ルートに添えるコメントは『preload で抑止できるのは cached match（`/notes` 系）だけ』まで書く」。この但し書きは 3 ルートすべてに置くことが明示的に要求されたもので、`/notes` 側から削ると ADR-003 が塞いだ誤読が戻る。判断を覆すべき新事実は出ていない | 0 |
| `routes/settings/-action.tsx:14-15` / 「ルートガードはリダイレクト、こちらは 401」の旧い言い回し | auth W-006 | fix | 真。ガードは `beforeLoad` ではなく `loader` に移っており「ルートガード」の指す先がずれている。同じ言い回しを docs からは AC-13 で削っており、隣の `routes/notes/-action.tsx:7` は真逆に近い書き出しなので、2 ファイルを読み比べた人に指針が 2 つあるように見える。1 箇所の書き換えで閉じる | 0 |
| `presentation/appConfig.ts` + `di/types.ts` / 「`AppConfig` に秘密を入れない」がコードに無い | auth W-003 (1) | fix | 真。plan.md:73 と ADR-001 Consequences（`.thread/13/adr.md:40`）が「`AppConfig` を拡張する人がここに気づける形にしておく」ことを明示的に要求しており、実装された 3 箇所のいずれにもその一文が無い＝**要求が未達**。`dehydrate` で未サインインの公開ページを含む全ページの SSR ペイロードに載る以上、拡張点に 1 行置く価値は高い | 0 |
| `spec/presentation/index.md` / `AppConfig` 節が署名鍵の供給元として自己矛盾 | auth W-003 (2) | **defer** | 真だが本 PR の範囲外。項目表（L.83-88）は SharePass / ExportTicket の署名鍵・`SecretCipher` / `ShareTokenProtector` の鍵束を `AppConfig` の項目に挙げ、L.94 は「SSR メタデータを運ぶ設定の器に秘密を混ぜず」と書いており canon 内で矛盾している。**本 PR が作った矛盾ではなく**（露出量は `loadAppContext` 時代と同じ）、解消には「未実装の 4 種の鍵を実際にどこから供給するか」という ADR 047 と将来機能に跨る設計判断が要る。ルーティング性能の PR で決める性質ではない → 別 Issue | 0 |
| `presentation/appConfig.ts:22-28` / `resolveAppConfig` の契約（throw か undefined か） | routing W-003 | fix | 真。`RouterContext` は `config: AppConfig \| undefined` を許し 17 箇所の `head` はすべて `if (!config) return {}` を持つのに、実装は `getContainer()` が throw する（`containerStore.ts:39-57`）。`createStartHandler` が `getRouter()` を全ドキュメント要求・全サーバールート要求（`/storage/$` を含む）と `handleRedirectResponse` から呼ぶので、影響範囲が `main` より広がっているのは事実。**同一ファイル 1 箇所で完結する**（`getInstalledStore()?.getStore()?.config` に落とすか、throw が正である旨を JSDoc に明記するか）ので defer にしない | 0 |
| `docs:906-921` / `router.tsx` 抜粋が同期版のまま、`dehydrate`/`hydrate` が未記載 | note-docs W-001 | fix | 真。現物は `export async function getRouter()`（`router.tsx:8`）。doc 冒頭が「Every path and identifier below points at real code」と宣言している以上シグネチャの不一致は看過できず、17 箇所の `head` が依存する `match.context?.config` の供給経路が丸ごと差し替わったのに参照ドキュメントに 1 行も無い | 0 |
| `docs:127` / pending と skeleton の非対称の主張 | note-docs W-005 | fix | 真。畳み込み後の `/notes` の loader はブリッジ 1 往復を await してから settle するので「a streaming route like `/notes` settles its loader immediately and never triggers it」は成り立たない。`/settings/*` と構造的に同型になった。放置すると `/notes` の pending 表示の実測を「退行」と誤読させる。plan.md の AC-9a / AC-9b の書き分けも同じ理由で再表現が要る | 0 |
| `presentation/sessionGuard.ts` / `safeRedirectPath` を通していることを守るテストが無い | routing W-005, note-docs W-006 | fix | 真。`redirect.test.ts` が守るのは純関数の述語だけで、「ブリッジがそれを呼んでいること」は誰も保証していない。将来 `search: { redirect: redirectTo }` に書き換えられても CI は緑のまま通り、オープンリダイレクトが復活する。**redirect の組み立てを純関数に切り出せば `docs/test.md` の「apps/web は純関数だけ単体テスト」方針の内側に収まる**ので、規約を曲げずに閉じられる。上の 2048 clamp と同じファイル群なので同時に入る | 0 |
| `.thread/13/` / 手動検証の実行証跡が無い | auth W-005 | **wont-fix** | Phase 4（動作検証）が担当する。レビュー時点で手動検証が未実施なだけで、指摘としてはここで閉じる。HAR・着地 URL・`head` の記録は Phase 4 の成果物として `.thread/13/` に残る | 0 |
| `.thread/13/testing.md` / 未サインインでの `/settings/*` クライアント遷移とホバーの手順が無い | note-docs W-007, routing B-001(テスト欄) | fix | 真。エッジケース 3 はサインイン済みでのホバーしか見ておらず、routing B-001 の退行を検出できない。AC-6a は SSR 直開き、AC-6b は `/notes` 系で、この組み合わせだけ観測されない。手順書 1 ファイルへの追記で閉じる | 0 |
| `routes/__root.tsx:42` / `<link rel="canonical">` が重複出力 | routing W-007 | **defer** | 真（本 PR の退行ではない既存不具合）。root の `head` が `buildHead(config)` を options 無しで呼ぶため常にサイト既定の canonical（`/`）を出し、子が自分のぶんを足す。`/terms` で 2 本、`/settings/profile` は root + `/settings`（`settings/route.tsx:56-58`）+ `settings/profile.tsx:25` で **3 本**（現物確認済み）。**本 PR で直すと AC-5「`head` 出力が変更前と一致」という検証基準そのものを無効化する**うえ、正しい修正には `buildHead` の canonical 出力方針・レイアウトルートの `head`・head を持たないルートの扱いを決める必要があり、`__root.tsx` 1 ファイルでは閉じない → 別 Issue | 0 |
| `CLAUDE.md` / Presentation の load-bearing files に 2 モジュールが未掲載 | note-docs W-008 | **wont-fix** | エージェントは `CLAUDE.md` を書き換えない方針。Phase 7（片付け・昇格ゲート）で「`presentation/sessionGuard.ts` / `presentation/appConfig.ts` を列挙に足すか」をユーザーへの提案として回す | 0 |

### fix の観点別内訳

- 認証・セッション: 6（401 系統の訂正、`spec/adr/030` の訂正、`shouldReload` コメントの範囲、`settings/-action.tsx` の言い回し、sessionGuard のテスト、`/settings` ガードのブロッキング化）
- ルーティング基盤: 4（preload 実ナビゲート、2048 clamp、`resolveAppConfig` の契約、`AppConfig` の秘密前提）
- ノート/ドキュメント: 6（`docs:334` / `docs:839` / `docs:906-921` / `docs:127` / `docs:75-78`、死んだ `staleTime` の除去）
- 計画・手順書: 2（AC-7 検体、手順追加）

（合計 16 件。1 件が複数観点に跨る場合は主たる観点に 1 回だけ数えた）

---

### 実行計画

担当ファイルが重ならない 6 単位に分けた。**Plan A → Plan F の順序依存は Plan F だけ**（Plan A の結果で `spec/adr/030` に書く範囲が `/notes` 系に限定される）。それ以外は並列で進めてよい。

#### 計画A: `/settings` レイアウトのガードをブロッキングに戻す（routing B-001）

- 対象指摘: routing B-001、auth W-006、routing W-006/note-docs W-003 の `/settings` ぶん
- 対象ファイル:
  - `apps/web/app/routes/settings/route.tsx`
  - `apps/web/app/routes/settings/-action.tsx`
- 方針:
  1. `loader: async ({ location }) => {...}` を **オブジェクト形**へ変える: `loader: { handler: async ({ location }) => {...}, staleReloadMode: "blocking" }`。`load-matches.js:458` は `typeof routeLoader === "function" ? void 0 : routeLoader?.staleReloadMode` を見るので、**関数形のままでは効かない**。`shouldReload: ({ cause }) => cause !== "preload"` はそのまま残す（毎ナビゲーション再判定 = ADR-003 の目的はこちらが担う）。
  2. これで `loaderShouldRunAsync` が真でも同 436 の背景枝に入らず同 450 の `await runLoader` に落ち、redirect は `Promise.all` → `loadMatches`(536) → `preloadRoute`(768-778) の catch へ戻る。**ホバーでの実ナビゲートが消え、`main` と同じ「preload は `/signin` を preload するだけ」に揃う。**
  3. **並列性は落ちない。** `loadMatches` は `for (...) matchPromises.push(loadRouteMatch(...))` で全 match の loader を同時に起動してから `Promise.all` するので、レイアウトのガードと子の断片 loader は今までどおり並列（AC-3a / AC-3b の「2 本同時開始 / 1 段」は維持）。変わるのは「ガードが解決するまで遷移が確定しない」ことだけで、これは `beforeLoad` 時代の性質であり AC-9b が期待値として明記している。
  4. **`/notes/` `/notes/$noteId` には付けない。** AC-8（背景再取得・スケルトンに戻らない）が非ブロッキングを要求している。
  5. `staleTime` の行を落とし、`shouldReload` のコメントを実態に合わせる（「ブロッキングなので失効時は描画前に `/signin` へ抜ける」「関数形の preload 抑止はこのレイアウト match には効かない」の 2 点は残す）。
  6. `-action.tsx:14-15` の JSDoc から「ルートガードはリダイレクトのため、こちらは 401 を返す二重化」を落とし、`routes/notes/-action.tsx:7` と揃えた分担の言葉にする。例:「レイアウトの `loader` ガードは遷移の誘導で、権限判定の権威はここ（ハンドラー側）。別 match なので畳めず、並列に走らせている」。

#### 計画B: `/notes` ブリッジの入力境界とガードの純関数化

- 対象指摘: routing W-001、routing W-005/note-docs W-006、auth W-001、note-docs B-001（コード側）、routing W-006/note-docs W-003 の `/notes` ぶん
- 対象ファイル:
  - `apps/web/app/presentation/redirect.ts`
  - `apps/web/app/presentation/sessionGuard.ts`
  - `apps/web/app/routes/notes/-action.tsx`
  - `apps/web/app/routes/notes/index.tsx`
  - `apps/web/app/routes/notes/$noteId.tsx`
  - `apps/web/app/presentation/__tests__/redirect.test.ts`（追記）
- 方針:
  1. **上限の定数化と clamp。** `redirect.ts` に `export const REDIRECT_MAX_LENGTH = 2048` を置き、`-action.tsx` の `redirectField` を `z.string().min(1).max(REDIRECT_MAX_LENGTH)` にする。**転送境界の拒否（422）はそのまま残す** — AC-7 後半（2049 文字 → 422）は DoS 上限として正しい。壊れているのは「クライアントが上限超えの値を送ってしまう」側なので、`redirect.ts` に `boundedRedirectSource(href: string): string`（`href.length <= REDIRECT_MAX_LENGTH ? href : "/notes"`）を足し、2 つの loader を `renderNoteList({ data: { redirect: boundedRedirectSource(location.href) } })` にする。`safeRedirectPath` が弾いたときの倒し先と同じ `/notes` に倒すので導線の一貫性も保たれる。
  2. **redirect の組み立てを純関数へ切り出す。** `redirect.ts` に `signInRedirectOptions(redirectTo: string \| undefined \| null)` を置き（`{ to: "/signin", search: { redirect: safeRedirectPath(redirectTo) } }` を返す）、`sessionGuard.ts` は `throw redirect(signInRedirectOptions(redirectTo))` にする。`redirect.ts` はフレームワーク import を持たない純関数モジュールという性質を保つこと（`redirect()` ヘルパーは呼ばず、options だけを返す）。
  3. **テスト追加。** `__tests__/redirect.test.ts` に `signInRedirectOptions` のケース（`//evil.example` / `https://evil.example` / `/%0Aevil` / `/\evil.example` / 正常な `/settings/auth`）と `boundedRedirectSource`（2048 / 2049 の境界）を足す。`/%0Aevil` の期待値は **`/%0Aevil` がそのまま通る**（同一オリジン）— 述語の現行仕様を固定する（AC-7 の検体訂正と一致させること。計画E参照）。
  4. `-action.tsx:9` の「主体が無効（削除中／削除済み）なら 401 が出る」を落とす。事実は「セッションが解決できない理由（無し／期限切れ／epoch 失効／削除中・削除済み）は区別されず、すべて遷移元付きの `/signin` redirect になる。401 が残るのは `requireSession()` を直に呼ぶミューテーションと `/settings` の子断片だけ」。
  5. 2 ルートから `staleTime` の行を落とす。残すコメントは (a)「loader がガードを兼ねるので毎ナビゲーション再実行させる」(b)「関数形なのは `shouldReload: true` だとホバーのたび要求が飛ぶため。preload を弾けるのは cached match だけで、アクティブなまま残る `/settings` レイアウトのような match には効かない」（**ADR-003 が明示的に要求した内容なので削らない**）(c) **新規**「ただし既訪 match の再実行は背景枝に落ちるので、失効後は前回の `loaderData` が 1 往復ぶん表示されてから redirect する（`beforeLoad` のブロッキング性は戻らない）」。

#### 計画C: `AppConfig` 供給の契約を 1 つに決める

- 対象指摘: routing W-003、auth W-003 (1)
- 対象ファイル:
  - `apps/web/app/presentation/appConfig.ts`
  - `packages/core/src/application/di/types.ts`
- 方針:
  1. `AppConfig` 型定義（`di/types.ts`）の JSDoc と `appConfig.ts` の `RouterContext` / `resolveAppConfig` の JSDoc に **「この型は `dehydrate` によって未サインインの公開ページを含む全ページの SSR ペイロードへ丸ごと載る。署名鍵・暗号鍵をここに足さない」** を 1 行ずつ足す（plan.md:73 / ADR-001 Consequences が要求した未達項目）。
  2. `resolveAppConfig` の `.server(...)` の契約を明示する。**推奨は寛容側**: `const { getInstalledStore } = await import("@repo/core/application/di/containerStore"); return getInstalledStore()?.getStore()?.config;` にして `AppConfig | undefined` の型と実装を一致させる（`head` 側は全 17 箇所が `if (!config) return {}` を持つので「メタデータが出ない」に落ちるだけ）。throw を正とする判断を採るなら、代わりに JSDoc へ「要求スコープ外の呼び出しは配線バグなので throw が正。`RouterContext` の `undefined` はクライアント側の値であって、サーバー側のフォールバックではない」を明記する。**どちらか一方に決めること** — 今は「型は undefined を許すのに実装は throw する」で意図が読めない。
  3. `packages/core` を触るので `pnpm typecheck` は `-r` で通す。

#### 計画D: `docs/frontend_implementation_example.md` の整合

- 対象指摘: note-docs B-001（doc 側）、note-docs B-002、routing W-004/note-docs W-002、note-docs W-001、note-docs W-005、routing W-006/note-docs W-003（doc 側）
- 対象ファイル: `docs/frontend_implementation_example.md`（このファイルのみ）
- 方針:
  1. **L.123**（2 系統の記述）を事実へ。「セッションが解決できない理由（無い／期限切れ／epoch 不一致／削除中・削除済み）は `authenticateSession` で 1 つに収斂するので、畳んだブリッジは**必ず redirect** を返す。401 が残るのは `requireSession()` を直に呼ぶミューテーションと `/settings` の子断片で、そちらはナビゲーションではないため redirect できないから」。続く `sessionUserOrNull` の一文も、"everything else" に削除中・削除済みが含まれないことが分かる書き方へ直す。
  2. **L.334-336**（`getContainer()` の閉じた例外リスト）: `routes/__root.tsx` を外し、`presentation/appConfig.ts` を追加。あわせて L.336 の「every one of those call sites reaches `getContainer` through `await import(...)` **inside the handler**」を、`appConfig.ts` が `createIsomorphicFn().server(...)` の中で動的 import する別形であることを含む書き方へ広げる。
  3. **L.839**: 列挙を `presentation/sessionGuard.ts`, `routes/index.tsx`, `routes/settings/route.tsx` に差し替え、「畳んだブリッジ（`routes/notes/-action.tsx`）からも redirect が出る。こちらは loader が受けるので `useServerFn` の自動処理は関与しない」を 1 文足す。
  4. **L.906-921**: 抜粋を `export async function getRouter()` に直し、`context` / `dehydrate` / `hydrate` の 3 行を含める。短い補足として「配備ごとにしか変わらない値なので SSR ペイロードに 1 回だけ載せる」「`hydrate` は `matchRoutes` の前に走るので初回クライアント遷移から効く」「したがって `AppConfig` に秘密を入れないことが転送の前提」を添える。
  5. **L.127**: 「per-fragment のスケルトンは断片の解決を、`defaultPendingComponent` は loader が await する 1 往復（ガード）を覆う。両者は排他ではなく直列に並ぶ」に直す（"a streaming route like `/notes` … never triggers it" を落とす）。
  6. **L.74-78 / L.87 付近**のコード抜粋: `staleTime` の行と "drop it or say so, as here" を落とし、`staleTime` を書かない理由（`shouldReload` があるかぎり `staleTime` / `preloadStaleTime` は参照されない）を**この 1 箇所にだけ**残す。ルート側のコメント（計画A/B）と重複させない。

#### 計画E: 受け入れ基準と手順書の訂正

- 対象指摘: auth W-004/routing W-002、note-docs W-007、routing B-001（テスト欄）、note-docs W-005（AC-9a/9b の再表現）
- 対象ファイル:
  - `.thread/13/plan.md`
  - `.thread/13/testing.md`
- 方針:
  1. **AC-7 の検体を確定する**（plan.md:45 / testing.md:290,293）。`isSameOriginPath` はパーセントデコードしないので、検体を「JSON の値として文字列 `"/%0Aevil"`」と「生の LF を含む `"/\n/evil.example"`」に分け、期待値をそれぞれ **`/signin?redirect=/%0Aevil`（そのまま通るのが正 — 同一オリジン）**と **`/signin?redirect=/notes`** に固定する。確認ポイントに「述語はパーセントエンコードを復号しない。復号不要の根拠は最終消費点が `SignInForm` の `router.history.push` に渡る生文字列であること」を 1 行残す（次に同じ疑いを持つ人が調査をやり直さないため）。2049 文字 → 422 はそのまま。
  2. **routing B-001 の回帰手順を足す**（testing.md エッジケース 3 の隣）: 「サインイン済みで `/settings/profile` に居る → 別タブでサインアウト → 元タブでタブ列にホバー（**クリックしない**）」で `/signin` へ**ナビゲートしない**こと。`main` とブランチで同じ挙動になることを確認する。
  3. **未サインインでの `/settings/*` クライアント遷移**を 1 手順足す: 「サインイン済みで `/settings/profile` → 別タブでサインアウト → 元タブで `/settings/auth` タブをクリック」→ `/signin?redirect=/settings/auth` に着き、設定カラムに `ServerErrorState` が閃かないこと。
  4. **AC-9a / AC-9b の書き分けを再表現する**。畳み込み後は `/notes` も `/settings/*` も「1 往復ブロック → URL 確定 → 断片ストリーム」で同型なので、「`/notes` は 0 往復で settle」ではなく「どちらもガード 1 往復ぶんブロックしてから settle し、断片はスケルトンでストリームする。200ms を超えれば両方に `defaultPendingComponent` が挟まる」と書く。**計画A で `/settings` がブロッキングになることも AC-9b の表現に反映する**（期待値は変わらない — AC-9b は元々ブロックする前提）。
  5. AC-8（`/notes` の背景再取得・スケルトンに戻らない）は**変えない**。計画A の `staleReloadMode` は `/settings` にしか入らないことを AC-8 の注記に 1 行残す。

#### 計画F: canon（`spec/adr/030`）の訂正

- 対象指摘: auth B-001
- 対象ファイル: `spec/adr/030-auth-state-transition-transport.md`（このファイルのみ）
- 方針:
  - 「影響」欄の「前の利用者のデータが残る経路が構造的に消え、無効化対象の列挙が不要になる」に条件を足して真に戻す。**計画A の適用後を前提に書く**（`/settings` はブロッキングに戻るので対象外）。例:「同一タブのサインアウトはフル遷移でページごと消える。ただし別タブ／サーバー側の失効（他端末サインアウト・パスワード変更による authEpoch 更新・絶対期限切れ）は、`/notes` `/notes/$noteId` では次のナビゲーションでの**背景**再判定に委ねるので、その 1 往復のあいだ直前の `loaderData` が表示されてから `/signin` へ遷移する」。
  - **挙動側は変えない。** `/notes` 系へ `staleReloadMode: "blocking"` を入れる案は ADR-003（`.thread/13/adr.md:159`）が「本 Issue の目的と衝突する」として明示的に退けた既決事項。
  - ADR 030 の「決定」欄・代替案欄には触らない（サインアウトを POST + フル遷移にする判断は今も有効）。

### Round 001 の結末

- fix 16 件をすべて反映（計画A〜F）。品質ゲート: `pnpm typecheck` PASS / `pnpm lint:fix` 修正なし / `pnpm format` 修正なし / `pnpm test` 935 passed・3 skipped
- defer 2 件を起票: #37（canonical 重複）/ #38（`spec/presentation/index.md` の `AppConfig` 節の矛盾）
- wont-fix 3 件は `triage-keys.md` に記録。note-docs W-008（CLAUDE.md 未掲載）は Phase 7 の昇格ゲートで提案に回す
