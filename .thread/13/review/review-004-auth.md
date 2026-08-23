# レビュー R004 — 認証・セッション（収束確認）

対象: PR #36 / ベース `main` / 差分本文 `13-round-004.diff`（20 ファイル全量）

## 総評（先に結論）

**問題点ゼロ。** Blocker 0 件 / Warning 0 件。

3 ラウンド目の修正 6 件（`routes/auth/-action.tsx` の `REDIRECT_MAX_LENGTH` 統一 / ADR-030 L.34 の書き換え / `Deferred` JSDoc の追記 / `CreateNoteButton` のコメント削除 / ADR-005 参照の絶対パス化 / docs 2 箇所の言い回し）は、`13-round-003.diff` との差分で見るかぎり**挙動を持つ変更が 1 つもなく**（唯一の実コード変更である `.max(2048)` → `.max(REDIRECT_MAX_LENGTH)` は `REDIRECT_MAX_LENGTH === 2048` で値が同一）、認証・セッションの判定に新しい穴は開いていない。

### 認証・セッション

#### Blockers

なし。

#### Warnings

なし。

## 確認して問題が無かった点（検証根拠つき・記録）

タスクで名指しされた 3 点を順に。

### 1. `routes/auth/-action.tsx` の `REDIRECT_MAX_LENGTH` 統一が OAuth 開始フローの入力検証を緩めていないか

**緩めていない。巻き込みもない。**

- 置換は `startSchema.redirectTo` の 1 フィールドのみ（`routes/auth/-action.tsx:12`）。同じスキーマの `provider: z.string().min(1).max(32)` は無傷で、`abandonSchema.state`（`max(512)`、L.44）・`callbackSchema` の `provider` / `state` / `code`（32 / 512 / 4096、L.92-94）はいずれも即値のまま。差分本文でも変更行は import 1 行 + 置換 1 行の 2 行だけである。
- 値も同一。`REDIRECT_MAX_LENGTH = 2048`（`presentation/redirect.ts:23`）で、置換前は `.max(2048)`。上限が上がっても下がってもいないので、`startOAuthSignInFn` の受理集合は変更前と 1 文字も違わない。
- 値としての安全は転送境界ではなくユースケース側にあり、そこも無傷。`startOAuthFlow.ts:51` が `redirectTo !== null && !SameOriginPolicy.isSameOriginPath(redirectTo)` で弾く。`.max()` は DoS 上限であって同一オリジン判定ではないので、定数化がこの網に触れる経路そのものが無い。
- 結合の方向も正しくなった。`/signin?redirect=` → `searchSchema.max(REDIRECT_MAX_LENGTH)` → `safeRedirectPath` → `SignInForm.redirectTo` → `OAuthButton`（`components/auth/OAuthButton/index.tsx:34`）→ `startOAuthSignInFn.validator` という 1 本の経路の**両端が同じ定数を見る**ようになったので、R003 W-002 が挙げた「定数を上げた日に Google だけ 422 で落ちる」沈黙した結合は閉じている。docs 側の表（`docs/frontend_implementation_example.md`）も "both ... and" から 3 箇所の列挙へ直っている。
- クライアントバンドルへの影響も無し。`presentation/redirect.ts` はフレームワーク import を持たず、増えた依存は純粋な `SameOriginPolicy` のみ。`auth/-action.tsx` は元から presentation を静的 import している。

### 2. `spec/adr/030` の混在窓の記述が事実として正しいか

**正しい。**追記 2 行（L.33 / L.34）をコードとルーター実装に当てて確認した。

- **「既訪 match では背景再判定」** — `@tanstack/router-core@1.171.15` `src/load-matches.ts:824-833`。`loaderShouldRunAsync = status === 'success' && (invalid || (shouldReload ?? staleMatchShouldReload))` で、`/notes` `/notes/$noteId` は関数形 loader なので `shouldReloadInBackground`（同 861-865）が真 → 835-848 の背景枝。redirect は 844-846 の `router.navigate(err.options)` が拾う。「1 往復のあいだ直前の `loaderData` が表示されてから `/signin` へ遷移する」はこのとおり。
- **「初めて入る match はブロッキング」** — 同 849 行 `status !== 'success' || loaderShouldRunAsync` の枝で `await runLoader`。新規 match は `status !== 'success'` なので背景枝に入らない。窓は開かない。
- **「`/settings` のガードもブロッキング」** — `routes/settings/route.tsx` の loader はオブジェクト形 + `staleReloadMode: "blocking"` で、`load-matches.ts:861-865` が読むのはオブジェクト形だけ。`shouldReloadInBackground` が偽になり 849 行へ落ちる。正しい。
- **「`router.invalidate()` は invalid にするだけでブロッキングにはしない」** — `router.ts:2769-2792`。`invalid: true` を立てるのは `matches` / `cachedMatches` / `pendingMatches` の全部だが、`status` を `'pending'` に戻すのは `forcePending` 指定時と元が `error` / `notFound` のときだけ。既訪 `/notes` は `status: 'success'` のまま残るので、次のナビゲーションは背景枝に入る。`SignInForm`（`components/auth/SignInForm/index.tsx:141-146`）が `await router.invalidate()` → `router.history.push(redirectTo)` の順で、match キャッシュを捨てないことも変わっていない。
- **「切り替わりが 2 段になる」** — R003 W-001 が求めた実態への修正が入っている。`notes/index.tsx` の `NotesPage` は `user` と `NoteList` を**同じ `Route.useLoaderData()` から**取り、`user` はそのまま `AppShell` へ、`NoteList` だけが `Deferred`（`use(useDeferredValue(promise))`）を通る。`useLoaderData` は `useSyncExternalStore` 経由なので `loaderData` の差し替えは SyncLane で届き、表示名・アバターは即座に新しい主体へ、一覧は deferred lane に押さえられて前の主体のものが残る。「その間は 1 画面に 2 人の主体が混在する」は事実として正しく、`Deferred` が窓を支配しているという帰属も正しい（R003 で「背景枝と `invalidate()` にだけ帰している」と指摘した点が解消されている）。
- **`/notes/$noteId` 側に同じ混在が書かれていない**のも正しい。`renderNoteDetail` は `user` を返さず、`ReaderShell`（`routes/notes/$noteId.tsx:61-88`）は「ノート一覧」リンクだけで主体を一切描かないので、そこに 2 段の切り替わりは存在しない。
- `spec/` の現在形 canon という方針にも収まっている（経緯・変更前との差は書かれていない = triage-keys R003 の wont-fix と整合）。

### 3. オープンリダイレクト／セッション判定の最終確認

**穴なし。**R003 で確認した網が round 4 の変更で 1 箇所も緩んでいないことを再走査した。

- `/signin?redirect=` を**組み立てる**経路は 2 つだけ（`presentation/sessionGuard.ts:16` / `routes/settings/route.tsx` の loader）で、どちらも `signInRedirectOptions` 経由 → `safeRedirectPath` を必ず通る。`presentation/redirect.ts` 全体を grep しても `redirect` を組み立てて `safeRedirectPath` を迂回する関数は無い。
- **消費**側は `routes/signin.tsx:32` の `safeRedirectPath(redirect)` 1 箇所のみ。`useSearch` を持つ他 4 ルート（`verify-email` / `reset-password` / `dev/oauth/authorize` / `auth/callback.$provider`）はいずれも `redirect` 相当のパラメーターを持たない。`/signup` は `OAuthButton redirectTo={null}` 固定。
- 述語は `SameOriginPolicy.isSameOriginPath` に一本化されたまま（`//host` / バックスラッシュ / C0+DEL）。制御文字を落とすので `Location` への CRLF 注入も成立しない。`redirect.test.ts` の追加ケース（`signInRedirectOptions` / `boundedRedirectSource`）は round 3 から変更なしで、`//evil.example` / `https://evil.example` / `/\evil.example` / 生 LF / `javascript:` / `undefined` / `null` と、通す側の `/%0Aevil` を押さえている（AC-7 と一致）。
- セッション判定の抜けも無し。`requireSessionOrRedirect` は `sessionUserOrNull` 経由で、`null` に倒れるのは `ValidationError("UNAUTHENTICATED")` のときだけ（`presentation/session.ts:126-138`）。インフラ障害は throw のままなので「失敗を未サインイン扱いして黙って `/signin` へ流す」形にはならない。
- loader へ渡る `location` は `getLoaderContext`（`load-matches.ts:631`）が `inner.location`（遷移先）を渡すので、`SIGNED_OUT_PATH` 分岐も遷移元ではなく遷移先で判定される。`beforeLoad` 時代と同一。
- `boundedRedirectSource` の境界も整合。上限ちょうど（2048）は通り、超過は `/notes` へ倒す。ブリッジ側は `.min(1).max(REDIRECT_MAX_LENGTH)` で、`location.href` は最短でも `/` なので `min(1)` に掛かる経路は無い。
- AC-14 は維持。`requireAuthenticated` はリポジトリ全体で `.thread/` の記録以外に 0 件。

### スコープ

逸脱なし。20 ファイルはいずれも plan のステップ 1〜6 の範囲で、round 4 で新たに増えた 2 ファイル（`CreateNoteButton/index.tsx` / `routes/auth/-action.tsx`）はどちらも R003 の指摘に対する修正。`packages/core` への変更は `AppConfig` の JSDoc 1 件のみで挙動を持たない。

## カバレッジ

- 確認: `apps/web/app/components/note/CreateNoteButton/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/ui/Deferred/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし
- 差分外で参照した根拠: `apps/web/app/presentation/session.ts`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/components/auth/OAuthButton/index.tsx`, `apps/web/app/routes/{verify-email,reset-password,signin}.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `spec/presentation/index.md`, `@tanstack/router-core@1.171.15` の `src/load-matches.ts` / `src/router.ts`, `.thread/13/review/review-003-auth.md`, `13-round-003.diff`

## 既出（蒸し返さない）

`triage-keys.md` の 8 件（Round 001 の 4 件 / Round 002 の 2 件 / Round 003 の 4 件）はいずれも本レビューで再提起していない。特に Round 003 の 2 件（ADR-030 に変更前との差を書く / `<Deferred key={user.userId}>` で混在窓を閉じる）は wont-fix の判定を尊重し、混在窓については「現在形の記述が事実として正しいか」だけを検証した（正しい）。
