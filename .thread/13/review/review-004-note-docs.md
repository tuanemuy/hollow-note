# レビュー 004 — ノート閲覧のフロントエンド体験・ドキュメント整合

**結論: 問題点ゼロ。** Blocker 0 件 / Warning 0 件。収束と判断する。

## ノート閲覧のフロントエンド体験・ドキュメント整合

### Blockers

なし。

### Warnings

なし。

## 最終確認の内訳

### `docs/frontend_implementation_example.md` の最終形

差分と実コードを突き合わせ、記述されている識別子・コード例・断定をすべて確認した。食い違いは残っていない。

- **識別子の実在**: `requireAuthenticated` はリポジトリ全体（コード・docs・spec）から消えている（AC-14 充足）。`requireSessionOrRedirect` / `signInRedirectOptions` / `boundedRedirectSource` / `REDIRECT_MAX_LENGTH` / `resolveAppConfig` / `RouterContext` はいずれも掲載どおりの場所に実在する
- **二重化の記述**（AC-13）: L.113 相当・L.545 相当の 2 箇所とも消え、代わりに「権限判定の権威はハンドラー側」「同一 match は畳む / 別 match は並列」「畳んだブリッジは redirect 一択、401 が残るのはミューテーションと `/settings` 子断片」が入っている。`routes/settings/-action.tsx` の冒頭 JSDoc も同じ内容に揃っている
- **L.554 のモジュール表**: `session.ts` = `requireSession` / `sessionUserOrNull`、`auth.ts` = `sessionUserFn` のみ（`safeRedirectPath` の再エクスポートは削除済み）、`sessionGuard.ts` = `requireSessionOrRedirect`、`redirect.ts` = 4 エクスポート — 実ファイルと 1 対 1 で一致
- **`REDIRECT_MAX_LENGTH` の輸入元 3 箇所**（ブリッジの `.validator` / `/signin` の `validateSearch` / `routes/auth/-action.tsx`）を grep で確認、記述どおり
- **フレームワーク挙動の断定**を `@tanstack/router-core@1.171.15` の `src/load-matches.ts` で裏取り:
  - `shouldReload ?? staleMatchShouldReload`（L.826）— `shouldReload` が真偽値を返す限り `staleTime` / `preloadStaleTime` は死ぬ、は正しい
  - `staleReloadMode` はオブジェクト形の loader からしか読まれない（L.861-865 の `typeof routeLoader === 'function' ? undefined : ...`）、は正しい
  - 背景枝の `catch` が preload を見ずに `router.navigate(err.options)` する（L.836-847）、は正しい
  - loader が match 間で `Promise.all` により並列（L.1026-1030）、`beforeLoad` が逐次、も正しい
- **`authenticateSession` がすべての失敗を `ValidationError("UNAUTHENTICATED")` に畳む**（L.131 の断定）を `packages/core/src/application/identity/authenticateSession.ts` で確認、`sessionUserOrNull` がそのコードだけを `null` にするのも実装どおり
- **`head` の数え**（L.952「sixteen leaf routes」）: `routes/` 配下の `head` 実装は 17 個、うち `__root.tsx` が `{ links: baseLinks }` を返し残り 16 個が `{}` を返す — 数は一致（`settings/route.tsx` はレイアウトルートなので「leaf」は語としてはゆるいが、記述の要点である「数」と「root だけ例外」は正しい）
- **`getContainer()` 例外節**: `settings/-action.tsx`（`container.config.appUrl`）/ `dev/-action.tsx`（`container.oauthDevMode`・`config.appUrl`）/ `appConfig.ts`（`getInstalledStore()?.getStore()?.config`）はいずれも記述どおりの読み方をしている
- **L.977 の `useServerFn` 節**: 「redirect の決定は `sessionGuard.ts` と `routes/index.tsx` / `routes/settings/route.tsx`」— `throw redirect(` の全出現（`routes/index.tsx:15`、`routes/settings/index.tsx:11`、`routes/settings/route.tsx:50`、`sessionGuard.ts:16`）と照らして、認証ガードの列挙としては正しい

### `spec/adr/030` の最終形

canon として現在形・事実として正しい。

- 経緯（`beforeLoad` 時代・`Deferred` 修正前との差）は書かれておらず、Round 003 の wont-fix 判定と整合する
- L.32 で「同一タブのサインアウトでは残らない」と限定し直したうえで、L.33 が窓の開く条件（既訪 match は背景再判定、初回 match と `/settings` はブロッキング）を書いている。`load-matches.ts` の分岐と一致する
- L.34 の再サインイン経路（`SignInForm` が `router.invalidate()` → `router.history.push`）は `components/auth/SignInForm/index.tsx:141-146` の実装どおりで、「上部バーは即時・一覧は deferred lane で遅れる」の 2 段も `notes/index.tsx:40`（`user` を loaderData から同期で読む）と `Deferred` の実装から導ける
- 列挙している失効要因（他端末サインアウト / `authEpoch` 更新 / 絶対期限切れ）は `signOutOtherSessions.ts` / `changePassword.ts` / `Session.isExpired` として実在する
- `spec/adr/index.md` の 030 行（前提・帰結）は今回の追記後も真のままで、更新漏れは無い

### コード内コメント

4 ラウンドぶんの積み上げを見たが、偽になったもの・経緯の残骸は無い。

- `CreateNoteButton` の「`/notes` は本番で `staleTime: Infinity`」は `staleTime` の削除に伴って正しく消えている。残った「reconcile は try の外」は不変の WHY
- `notes/index.tsx` / `$noteId.tsx` の `shouldReload` コメントは、`/settings` 固有の但し書きの重複を含めて Round 001（note-docs W-004）で wont-fix 済み。蒸し返さない
- `Deferred` の JSDoc 追記は ADR-005 の根拠と `remountDeps` の前提（Round 003 の wont-fix で「JSDoc に書く」と決めた内容）で、「note→note の導線は今日存在しない」は grep で裏が取れる（`to="/notes/$noteId"` は `NoteList` と `CreateNoteButton` の 2 箇所のみ、どちらも `/notes` 配下）
- `appConfig.ts` の `undefined` 寛容の JSDoc は Round 002 の wont-fix と整合
- コメントが参照する `.thread/13/adr.md` は git 管理下にあり、リンク切れにならない

### ノート閲覧の体験（`main` 比）

壊れていない。

- **初回マウント**: ブリッジは `user` と未解決の断片 promise を返し、loader はそれを await せず転送する。`useDeferredValue` は初回に前値を持たないので `<Suspense>` のスケルトンはこれまでどおり出る
- **遷移後の差し替え**: 既訪 match への戻りは背景枝で再取得され、`Deferred` が差し替えを deferred lane に載せるのでスケルトンへ戻らない（AC-8 の実測結果とも一致）
- **エラー表示**: `/notes/` の `errorComponent` と `$noteId` の `ReaderShell` 付き分岐は無変更。未サインインは 401 ではなく redirect になるので `ServerErrorState` が閃く経路はむしろ減っている
- `location.href` は `router-core` の `ParsedLocation`（`pathname + search + hash`、`router.ts:1326`）なので `safeRedirectPath` の絶対パス条件を満たし、戻り先が黙って `/notes` に倒れる事故は起きない

### スコープ逸脱

無し。`spec/adr/030` の改訂は「本 PR が既存 canon の断定を部分的に偽にした」ぶんの是正で、plan の「`spec/` への昇格はしない」とは両立する（新規 ADR を起こしていない）。`routes/auth/-action.tsx` の `REDIRECT_MAX_LENGTH` 化も定数一本化の範囲内。

### 実行した検証

- `pnpm exec vitest run apps/web/app/presentation/__tests__/redirect.test.ts` → 12 passed
- `apps/web` で `pnpm exec tsgo --noEmit` → rc=0

（コードには一切手を入れていない。作業ツリーは読み取りのみ。）

## カバレッジ

- 確認: `apps/web/app/components/note/CreateNoteButton/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/ui/Deferred/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし
