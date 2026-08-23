# レビュー R003 — 認証・セッション

対象: PR #36 / ベース `main` / 差分本文 `13-round-003.diff`（18 ファイル全量）

## 総評（先に結論）

**Blocker なし。** 2 ラウンド目の 4 つの修正（`signInRedirectOptions` への一本化 / `REDIRECT_MAX_LENGTH` の定数化 / `shouldReload` コメントの限定化 / ADR-030 の追記）は、いずれも**認証の判定そのものには新しい穴を開けていない**。オープンリダイレクトの網は 3 箇所すべてで閉じており（生成 2 経路 + 消費 1 経路がすべて `safeRedirectPath` を通る）、クライアントから直接叩ける server function にセッション判定の抜けは無い。

残る 2 件はいずれも Warning。1 件は `Deferred` の deferred lane 化が作った**混在表示の窓**を canon（ADR-030）が実態と違う形で書いていること、もう 1 件は `REDIRECT_MAX_LENGTH` の統一が 3 箇所目に届いておらず**沈黙した結合**が残っていることである。

## Blockers

なし。

## Warnings

- **[W-001]** `Deferred` の `useDeferredValue` 化により「前の利用者のノート一覧が、新しい利用者の表示名の下に表示される」混在状態が生まれるが、ADR-030 の追記はこれを「表示名・アバターとノート一覧が 1 往復ぶん残る」と**両者が同時に切り替わる**かのように書いている
  - 場所: `apps/web/app/components/ui/Deferred/index.tsx:29` / `spec/adr/030-auth-state-transition-transport.md:33`（追記の 2 行目）/ `apps/web/app/routes/notes/index.tsx:40`
  - 理由: 本 PR で `user` の供給源が `beforeLoad` の routeContext（**必ずブロッキング**）から `loader` の `loaderData` へ移り、同時に `Deferred` が `use(useDeferredValue(promise))` になった。この 2 つを重ねると、`/notes` の背景再実行が完了した瞬間に **`user` だけが SyncLane で新しい主体へ切り替わり**（`useLoaderData` は `useSyncExternalStore` 経由）、**`NoteList` は `useDeferredValue` が押さえるので断片のストリームが終わるまで前の主体のものが残る**。到達経路は ADR-030 の追記が挙げているものそのまま — A のセッションがサーバー側で失効（別端末サインアウト / `authEpoch` 更新 / 絶対期限切れ）→ 既訪 `/notes` へのナビゲーションで背景 redirect → `/signin?redirect=/notes` → **同じタブで B がサインイン**（`SignInForm` は `router.invalidate()` のあと `router.history.push` なので match キャッシュは生き残る、`components/auth/SignInForm/index.tsx:141-146`）→ `/notes` の loader は `invalid` で再実行されるが `shouldReloadInBackground` が真なので背景枝（`load-matches.ts:826-847`）。共有端末では「B の名前の下に A のノート一覧」という、**それが B のものだと誤読させる**形で出る。ADR-030 の「1 往復ぶん残る」という書き方だと、応答が返った時点で両方入れ替わると読めてしまい、この混在窓が canon から抜け落ちる。なお `Deferred` 修正前は同じ瞬間に `<Suspense>` がスケルトンへ落ちていたので、**前の主体の一覧が見える時間は本 PR の R002 修正で伸びている**（ADR-005 の狙いどおりの副作用だが、認証面の帰結は書かれていない）
  - 提案: (a) 必須 — ADR-030 の当該行を実態に合わせる。「表示名・アバターは応答到達で新しい主体へ切り替わるが、断片は `Deferred` が deferred lane に載せているため後続のストリーム完了まで前の主体のものが残り、その間は主体が混在した画面になる」と、`Deferred` が窓を支配していることまで書く（現状の文は窓の長さを背景枝と `router.invalidate()` にだけ帰している）。(b) 任意 — 混在自体を閉じるなら `notes/index.tsx` で `<Deferred key={user.userId} promise={NoteList} />`（または `<Suspense key={user.userId}>`）にする。主体が変わったときだけ再マウントしてスケルトンへ落ちるので、**同一主体の戻る操作（AC-8）は `key` が同じままで壊れない**。`$noteId.tsx` は `renderNoteDetail` が `user` を返していないので同じ手は取れず、そちらは (a) だけで受けることになる

- **[W-002]** `REDIRECT_MAX_LENGTH` への統一が 3 箇所目（OAuth 開始）に届いておらず、定数を上げた日に `/signin` の OAuth ボタンだけが 422 で落ちる沈黙した結合が残っている
  - 場所: `apps/web/app/routes/auth/-action.tsx:11`（`redirectTo: z.string().max(2048).nullable()`）/ `apps/web/app/presentation/redirect.ts:23`
  - 理由: R002 W-002 の修正で `signin.tsx` の即値 2048 は `REDIRECT_MAX_LENGTH` に寄ったが、**同じ値が同じ意味で立っている 3 箇所目**が即値のまま残った。`/signin` の `redirect` は `searchSchema`（`max(REDIRECT_MAX_LENGTH)`）→ `safeRedirectPath` → `SignInForm` の `redirectTo` → `OAuthButton` → `startOAuthSignInFn` の `.validator` と、**1 本の経路で流れる**（`components/auth/SignInForm/index.tsx:252` → `components/auth/OAuthButton/index.tsx:34` → `routes/auth/-action.tsx:35`）。したがって `REDIRECT_MAX_LENGTH` を 2048 より大きくすると、2049〜新上限の `redirect` は `/signin` を通過してフォームまで届くのに OAuth 開始だけが 422 になる。壊れ方が「メール／パスワードのサインインは動くが Google だけ落ちる」で、定数を変えた側からは原因が見えない。`docs/frontend_implementation_example.md:554` の表が `REDIRECT_MAX_LENGTH` を「the transport ceiling **both** the bridge's validator and `/signin`'s `validateSearch` import」と 2 箇所に限定して書いているのも、この 3 箇所目が視界に入っていないことを示している
  - 提案: `routes/auth/-action.tsx` で `REDIRECT_MAX_LENGTH` を import して `z.string().max(REDIRECT_MAX_LENGTH).nullable()` にする（import 1 行 + 置換 1 行）。変更ファイル一覧の外だが、本 PR が導入した定数の適用漏れなので本 PR で閉じるのが筋。ドキュメント側（同 554 行）の「both」も 3 箇所へ直す

## 認証観点で確認して問題が無かった点（検証根拠つき・記録）

タスクで名指しされた 5 点を順に。

1. **`/settings` のガードが `signInRedirectOptions` を通るようになった遷移元の受け渡し** — 等価。変更前 `redirect({ to: "/signin", search: { redirect: safeRedirectPath(location.href) } })` / 変更後 `redirect(signInRedirectOptions(location.href))` で、`signInRedirectOptions` は `{ to: "/signin", search: { redirect: safeRedirectPath(redirectTo) } }` をそのまま返す（`presentation/redirect.ts:39-44`）。`location` は `getLoaderContext`（`load-matches.ts:631`）が `inner.location` を渡すので**遷移先**の location であり、`beforeLoad` 時代と同一。`ParsedLocation.href` は `pathname + searchStr + hash`（`router.ts:1326`）でオリジンを含まないので、`safeRedirectPath` の「`/` 始まり」判定に落ちる形にもならない。
2. **`signin.tsx` の `REDIRECT_MAX_LENGTH` 統一で `validateSearch` の拒否挙動が変わっていないか** — 変わっていない。`REDIRECT_MAX_LENGTH === 2048` で、スキーマは `.max(...).optional().catch(undefined)` のまま。上限超過は従来どおり**拒否ではなく `undefined` へ黙って倒れ**、`safeRedirectPath(undefined)` → `/notes`。ブリッジ側の `redirectField`（`.min(1).max(REDIRECT_MAX_LENGTH)`）とは失敗の形が違う（422 / 黙って既定値）が、これは転送境界と URL パラメーターの役割差そのもので、両方とも文書化済み。
3. **クライアントから直接叩ける経路の `requireSession()` 相当** — 抜けなし。`grep` で `createServerFn` を持つ 13 ファイルを走査した結果、認証が要るハンドラーはすべて `requireSession()` / `requireSessionOrRedirect()` を通る。意図的に通さない 2 つ（`getDeletionStatusFn` は ticket が主体・`sessionUserFn` は `null` を返すプローブ）は既存の設計どおり。`/storage/$` は avatar 限定の公開配信で 401 を持たないので、`notes/-action.tsx:11-12` の「401 が残るのはミューテーションと `/settings` の子断片だけ」という列挙も正しい。本 PR は `loadAppContext`（無認証だが `container.config` しか返さない）を**削除**しており、公開エンドポイントは 1 本減っている。
4. **オープンリダイレクトの網** — 穴なし。`/signin?redirect=` を組み立てる経路は 2 つ（`sessionGuard.requireSessionOrRedirect` / `settings/route.tsx` の loader）で、**どちらも `signInRedirectOptions` 経由なので `safeRedirectPath` を必ず通る**。消費側の `signin.tsx:32` も `safeRedirectPath(redirect)` を再度通す二重化。述語は `SameOriginPolicy.isSameOriginPath`（`//host` / バックスラッシュ / C0+DEL の 3 形）に一本化され、`redirect.test.ts` の追加ケースが `//evil.example` / `https://evil.example` / `/\evil.example` / 生 LF / `javascript:` / `undefined` / `null` を網羅している。制御文字が落ちるので `Location` ヘッダーへの CRLF 注入も成立しない。OAuth 側の `redirectTo` は `startOAuthFlow.ts:51` が同じ述語で弾く。
5. **`errorResponseMiddleware` が redirect を潰さないか** — 潰さない。`presentation/errorResponseMiddleware.ts:32` が `isRedirect(error) || isNotFound(error)` を先に再 throw する。クライアント側も `createServerFn.ts:166-169` が `parseRedirect(result.error)` を見て redirect を rethrow し、`runLoader` の `handleRedirectAndNotFound` が拾う。畳んだブリッジの redirect が loader まで届く経路は成立している。

追加で当たった点:

- **`staleReloadMode: "blocking"` の主張はコードどおり** — `load-matches.ts:857-864` の `shouldReloadInBackground` はオブジェクト形 loader の `staleReloadMode` しか読まず（関数形は `undefined`）、`"blocking"` なら 826 行の背景枝ではなく 848 行の `await runLoader` に落ちる。そこで throw された redirect は preload 経由なら `preloadRoute` の `catch`（`router.ts:2933-2948`）が拾って**ナビゲートせず `/signin` を preload するだけ**なので、`settings/route.tsx:36-40` のコメント（「ホバーだけで `/signin` へ実ナビゲートしない」）は正しい。逆に関数形だと 845 行の `await inner.router.navigate(err.options)` が preload を判別せずに走るという指摘も正しい。
- **`shouldReload` がレイアウトのタブ間遷移で効く** — `load-matches.ts:808-826`。関数形 `shouldReload` は `getLoaderContext` 付きで呼ばれ、`cause: preload ? 'preload' : cause`。タブ間は `cause: "stay"` → 真 → `loaderShouldRunAsync` 真 → blocking なので同期実行。`SIGNED_OUT_PATH` 分岐が毎ナビゲーション再判定される前提は満たされている。
- **`/settings` の遷移元 href が `boundedRedirectSource` を通らない**のは退行ではない。`/settings` 側の redirect はフレームワークの `redirect()` であって `.validator` を経由しないので 422 になりようがなく、2048 超は `/signin` の `.catch(undefined)` で `/notes` に倒れる。倒れ先が `boundedRedirectSource` と同じ `/notes` なので、観測される挙動も変更前と同一。
- **`DeleteAccountPanel` の `useRouteContext` → `useLoaderData`** — 主体の鮮度は等価。レイアウトの loader は blocking + `shouldReload` なので `beforeLoad` 時代と同じく**遷移ごとに解決済みの `user`** を渡す。`canRestoreTicket(stored, currentUserId)`（`ticketStorage.ts:47-50`）の「`currentUserId === null` なら通す」も、`/settings/danger` の `SIGNED_OUT_PATH` 分岐が `{ user: null }` を返す形と噛み合ったまま（AC-11 の削除受理直後リロード復帰が生きている）。
- **`renderNoteList` が返すようになった `user`** — `AuthenticatedUserView` は `userId / displayName / handle / avatarUrl` のみ（`application/identity/view.ts:39-44`）で、`beforeLoad` の routeContext として既にクライアントへ渡っていた値と同一。露出は増えていない。
- **AC-13 / AC-14** — `requireAuthenticated` はコード・docs とも `grep` で 0 件。「ルートガードは redirect、ハンドラーは 401 の二重化」の主張は L.113 / L.545 の両方が消え、代わりに「権限判定の権威はハンドラー側」「同一 match は畳む / 別 match は並列」「畳んだブリッジは redirect の 1 系統」が入っている。認証観点の受け入れ基準（AC-6a / AC-7 / AC-11 / AC-14）はコード上の前提としては満たされている（実測は Phase 4 の担当）。
- **スコープ逸脱なし** — 18 ファイルはいずれも plan のステップ 1〜6 の範囲。`packages/core` への変更は `AppConfig` の JSDoc 1 件のみで、挙動を持たない。

## カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/ui/Deferred/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし
- 差分外で参照した根拠: `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/components/auth/OAuthButton/index.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/index.tsx`, `apps/web/app/routes/settings/index.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `packages/core/src/application/identity/{view,startOAuthFlow}.ts`, `spec/presentation/index.md`, `@tanstack/router-core@1.171.15` の `load-matches.ts` / `router.ts` / `location.ts`, `@tanstack/start-client-core@1.170.14` の `createServerFn.ts`

## 既出（蒸し返さない）

`triage-keys.md` の 5 件はいずれも本レビューで再提起していない。特に R001 auth B-001 / R002 auth W-004（既訪 match の背景再判定で前セッションの内容が 1 RTT 残る件）は ADR-030 の追記で決着済みと扱い、W-001 は**その追記が `Deferred` の寄与を書けていない**という別の切り口に限定している。R002 auth W-001（`signInRedirectOptions` 一本化）/ W-002（`REDIRECT_MAX_LENGTH`）/ W-003（`shouldReload` コメント）はすべて反映を確認した。
