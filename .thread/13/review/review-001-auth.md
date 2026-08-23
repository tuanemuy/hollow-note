# レビュー 001 — 認証・セッション

対象: PR #36 / round 001
差分: `.thread/13/` を除く変更ファイル 13 件すべてを認証・セッション観点で確認した。

## 総評（先に結論）

- **ガードの権威の置き換えそのものは正しい。** `/notes` `/notes/$noteId` は `beforeLoad` を捨てて断片ブリッジのハンドラー内に判定を畳んだが、ブリッジはクライアントから直接叩ける経路そのものなので、権威はむしろ強い側へ移っている。`/settings` はレイアウトの `loader` が誘導を担い、実際の権威は子断片 3 本の `requireSession()`（`routes/settings/-action.tsx:26,44,63`）に残っている。**バイパス経路は見つからなかった。**
- **オープンリダイレクトの防御は等価。** `SameOriginPolicy.isSameOriginPath`（`packages/core/src/domain/identity/services/sameOriginPolicy.ts:17-32`）は削除された `redirect.ts` のインライン述語とバイト単位で同じ 3 条件（先頭 `/` かつ `//` でない / バックスラッシュ無し / C0・DEL 無し）を持ち、`redirect.test.ts` を無改変で通す。転送境界の `z.string().min(1).max(2048)` も形と DoS 上限だけを見る役割に収まっている。新しく増えた入力（`redirect`）は必ずサーバー側の `safeRedirectPath` を通る。
- **`shouldReload` は「再判定される」を戻したが、「描画前に判定される」は戻していない。** ここが本 PR で唯一、認証の実挙動が後退している点で、canon がその後退を打ち消す主張を保持したままになっている（B-001）。

## Blockers

- **[B-001]** 別タブ／サーバー側でのセッション失効後、既訪ルートが 1 RTT ぶん前セッションの内容を表示してから `/signin` へ飛ぶ。この経路が「構造的に消えている」と書いた canon が改訂されていない
  - 場所: `apps/web/app/routes/notes/index.tsx:20` / `apps/web/app/routes/notes/$noteId.tsx:20` / `apps/web/app/routes/settings/route.tsx:34`（`shouldReload`）、`spec/adr/030-auth-state-transition-transport.md`（「影響」欄）
  - 理由:
    - 変更前、`/notes` `/notes/$noteId` `/settings` のガードは `beforeLoad` にあり、**ナビゲーションごとにブロッキングで**走った。セッションが失効していれば `component` は一度も描画されずに `/signin` へ飛ぶ。
    - 変更後、ガードは `loader` に移り、既訪 match（`status: "success"`）の再実行は `load-matches.ts` の**背景枝**（`loaderShouldRunAsync && !sync && shouldReloadInBackground`）に落ちる。遷移は即座に settle し、**前回の `loaderData`（＝前セッションで取得したノート一覧・本文・`user`）が描画されたまま**、応答が返ってから `router.navigate` が redirect を拾う。`.thread/13/adr.md` の ADR-003 Consequences も「別タブでサインアウトした利用者は、一瞬キャッシュ済みの画面を見てから `/signin` へ飛ぶ」と明記しており、意図された挙動である。
    - 対象は「別タブでのサインアウト」だけではない。`signOutOtherSessionsFn` / `changePasswordFn` による authEpoch 更新（`authenticateSession.ts:61`）と、セッションの絶対期限切れ（同 51）も**そのタブでは何のナビゲーションも起きないまま**セッションを無効化するので、次に戻る／リンクを踏んだ瞬間に同じ窓が開く。同一タブのサインアウトだけは ADR 030 のフル遷移で救われる。
    - 問題は挙動そのものより canon の側にある。`spec/adr/030` は「クライアントルーターは loader の取得結果をキャッシュしており、SPA 遷移ではそれが残る。**サインアウト後に前の利用者のデータが画面に出うる**」を課題として挙げ、影響欄で「**前の利用者のデータが残る経路が構造的に消え**、無効化対象の列挙が不要になる」と結論している。本 PR 後、この文はもう真ではない（同一タブに限って真）。`CLAUDE.md` は「`spec/` は…決定が変わったら改訂すること — 書かれていることはコードについて真であることを意図している」と定めており、認証データの残存という最も誤読が危険な主張が canon 側で放置されている。
    - plan.md がスコープ外に置いたのは「本 Issue の**設計判断**を `spec/` へ昇格させること」であって、「本 PR が偽にした既存 canon の記述を直すこと」ではない。ここを片付けフェーズ送りにすると、次に認証キャッシュを触る人は ADR 030 を読んで「その経路は無い」と判断する。
  - 提案: `spec/adr/030` の影響欄に 1 文足して真に戻す。例:「同一タブのサインアウトはフル遷移でページごと消えるが、**別タブ／サーバー側の失効（他端末サインアウト・パスワード変更による epoch 更新・期限切れ）は次のナビゲーションでの背景再判定に委ねる**ので、その 1 往復のあいだ直前の `loaderData` が表示される」。挙動側で閉じるなら認証ルートに限って `loader: { handler, staleReloadMode: "blocking" }` を採る選択肢があるが、Issue の目的（体感の改善）と正面から衝突するので canon 改訂が本筋だと考える。どちらを採るにせよ、**この判断が `.thread/13/adr.md`（昇格未定・破棄予定の作業文書）にしか残っていない状態でマージしないこと**が要点。

## Warnings

- **[W-001]** 3 ルートのコメントが「`beforeLoad` が持っていた性質」を戻したと書いているが、戻っていない性質がある
  - 場所: `apps/web/app/routes/notes/index.tsx:14-19` / `apps/web/app/routes/notes/$noteId.tsx:14-19`（`routes/settings/route.tsx:28-33` は文面が違うので該当しない）
  - 理由: `beforeLoad` が持っていた性質は「毎ナビゲーション再実行」と「**描画前にブロッキングで**再実行」の 2 つで、`shouldReload` が戻すのは前者だけ（B-001）。コメントは前者しか書いていないので、次に読む人は「失効後にキャッシュ済み画面が見えることはない」と読む。`.thread/13/adr.md` にはその区別が書かれているが、その文書は昇格されない前提なので、コードに残らないと消える。**`shouldReload` は消しても型が通る**うえ効能の観測点が限られる、とコメント自身が認めている種類のオプションなので、効能の**範囲**を正確に書くことが唯一の防波堤になる。
  - 提案: 既存コメントに 1 行足す。例:「ただし再実行は既訪 match では背景枝に落ちるので、失効後は前回の `loaderData` が 1 往復ぶん表示されてから redirect する（`beforeLoad` のブロッキング性は戻らない）」。

- **[W-002]** 「主体が無効（削除中／削除済み）なら 401」という記述が、コードとドキュメントの両方で事実と食い違う
  - 場所: `apps/web/app/routes/notes/-action.tsx:9`（「主体が無効（削除中／削除済み）なら 401 が出る」）、`docs/frontend_implementation_example.md`（`A folded bridge answers in two shapes … a session whose subject is invalid (being deleted / deleted) → 401`）
  - 理由: `authenticateSession`（`packages/core/src/application/identity/authenticateSession.ts`）は JSDoc で明言のとおり「Every failure collapses to `ValidationError("UNAUTHENTICATED")` without distinction」で、`user.status !== "active"`（削除中／削除済み）も authEpoch 不一致も期限切れも**すべて同じ `UNAUTHENTICATED`** に潰れる（同 51-66）。`sessionUserOrNull`（`presentation/session.ts:126-138`）は `code === "UNAUTHENTICATED"` を漏れなく飲み込むので、`requireSessionOrRedirect` は **必ず redirect を投げる**。畳んだブリッジから 401 が出る経路は存在しない（残る再 throw は system 系＝500）。つまり AC-13 が要求した「2 系統を返す」という記述そのものが誤りで、それが docs と実装コメントの両方に入っている。
  - 影響は挙動ではなく次の実装者の判断にある。「削除中は 401 で区別される」と読んだ人が、その区別に依存した画面分岐（例: 削除進行中の専用表示）を書くと、実際には `/signin` に飛ぶだけなので機能しない。
  - 提案: 両方を事実に合わせる。例:「セッションが解決できない理由（無し／期限切れ／削除中・削除済み／epoch 失効）は**区別されず**、すべて遷移元付きの `/signin` redirect になる。401 が残るのは `requireSession()` を使うミューテーションと `/settings` の子断片で、そちらはナビゲーションではないため redirect できないから」。

- **[W-003]** `AppConfig` を全ページの SSR ペイロードに焼く前提（「秘密を入れない」）がコードのどこにも書かれておらず、canon はむしろ `AppConfig` に署名鍵・暗号鍵を置くと明記している
  - 場所: `apps/web/app/router.tsx:13-17`（`dehydrate: () => ({ config })`）、`apps/web/app/presentation/appConfig.ts:1-29`、`packages/core/src/application/di/types.ts:38-45`、`spec/presentation/index.md`（AppConfig の項目表）
  - 理由:
    - 現時点の `AppConfig` は `appUrl` / `siteName` / `defaultTitle` / `defaultDescription` / `twitterHandle` / `themeColor` だけで、**秘密は混じっていない**。露出量も変更前の `loadAppContext`（root の `beforeLoad` が全ページで引いていた）と同じで、本 PR で増えてはいない。ここまでは合格。
    - 問題は将来の拡張点。canon `spec/presentation/index.md` の AppConfig 項目表は **SharePass の署名鍵 / ExportTicket の署名鍵 / `SecretCipher` の鍵束 / `ShareTokenProtector` の鍵束** を `AppConfig` の項目として列挙している。表のとおりに実装すると、`dehydrate` によって鍵が**未サインインの公開ページを含む全ページの HTML** に焼かれる。同文書は別の段落で「SSR メタデータを運ぶ設定の器に秘密を混ぜず」とも書いており（削除 ticket の鍵を除外する根拠）、canon 内で矛盾している。
    - plan.md:73 と ADR-001 は、この前提を「`AppConfig` を拡張する人がここに気づける形にしておく」ことを明示的に求めていた。実装された 3 箇所（`appConfig.ts` の JSDoc、`router.tsx` の `dehydrate` コメント、`di/types.ts` の型定義）のいずれにもその一文が無く、要求は満たされていない。`di/types.ts` の `DeletionTicketKeyRing` JSDoc に間接的な示唆（「`AppConfig`, which is SSR metadata」）があるだけで、`AppConfig` を拡張する人が読む位置ではない。
  - 提案: (1) `di/types.ts` の `AppConfig` 定義と `presentation/appConfig.ts` の JSDoc に「この型は全ページの SSR ペイロードへ丸ごと載る。署名鍵・暗号鍵をここに足さない」を 1 行。(2) `spec/presentation/index.md` の項目表と但し書きの矛盾（鍵を `AppConfig` に置く／`AppConfig` は SSR メタデータ）を整理する。運び方を変えた本 PR が、この矛盾に気づける最後の地点になる。

- **[W-004]** AC-7 の検体 `/%0Aevil` の期待値が、手順の読み方次第で反転する
  - 場所: `.thread/13/testing.md`（手順 10 の 4 検体と期待結果）、`packages/core/src/domain/identity/services/sameOriginPolicy.ts:25-31`
  - 理由: `isSameOriginPath` は**パーセントエンコードを復号しない**。`redirect` の値が文字列 `"/%0Aevil"` なら制御文字を含まないので**受理**され、応答は `/signin?redirect=/%0Aevil` になる（`/notes` にはならない）。`/notes` が返るのは、`payload` クエリーに生で貼った `%0A` がサーバー側の URL デコードで LF になった場合だけ。つまり同じ手順書から正反対の合否が出る。
    - **実害は無い**ことは確認した。この値の最終消費点は `SignInForm`（`components/auth/SignInForm/index.tsx:146`）の `router.history.push(redirectTo)` で、生文字列をそのまま push するため `%0A` も `%5C` も復号されず、別オリジンへは解決しない。したがって述語を「エンコード済み列も弾く」方向へ強化する必要は無い。直すべきは手順の側。
  - 提案: 手順に「JSON の値として文字列 `"/%0Aevil"` を入れる」か「生の LF を入れる」かを明記し、期待値をそれぞれ `/signin?redirect=/%0Aevil` / `/signin?redirect=/notes` に固定する。あわせて「述語はパーセントエンコードを復号しない。復号しなくてよい根拠は最終消費点が `history.push` の生文字列であること」を確認ポイントに 1 行残すと、次に同じ疑いを持つ人が調査をやり直さずに済む。

- **[W-005]** 認証まわりの受け入れ基準はすべて手動 browser 検証が唯一の網なのに、実行記録が 1 件も無い
  - 場所: `.thread/13/`（`adr.md` / `plan.md` / `steps.md` / `testing.md` のみ。HAR・着地 URL・`head/` の記録が無い）
  - 理由: AC-6a（未サインイン直開き）/ AC-6b（別タブサインアウト後の再判定）/ AC-7（オープンリダイレクト + 2049 文字 → 422）/ AC-11（`SIGNED_OUT_PATH` 分岐）はいずれも自動テストを持たない。`docs/test.md:58` のフロントエンド方針（純関数だけ単体テストを持つ）に照らせば `requireSessionOrRedirect` に単体テストが無いこと自体は規約どおりで、そこは指摘しない。問題は**手動が唯一の網なのにその実行証跡が無い**ことで、plan.md:23,97 は HAR の `.thread/13/` への添付を明示的に求めている。
    - とくに AC-6b の**本番ビルド実行**は、`shouldReload` の書き忘れを検出できる唯一の観測点である（DEV では `cause === "enter"` だけで再取得されるため有無で差が出ない）。ここが未実行のままだと、「ガードが再判定されない」という B-001 より重い退行が誰にも検出されない状態でマージされる。
  - 提案: 少なくとも AC-6b（本番ビルド）・AC-7・AC-11 の 3 つは結果を `.thread/13/` に残してからマージする。レビューが実装直後で手動検証が未実施なだけなら、この Warning は実行記録の添付で閉じる。

- **[W-006]** `/settings` 側の module JSDoc に「ルートガードはリダイレクト、こちらは 401 の二重化」という旧い言い回しが残っている
  - 場所: `apps/web/app/routes/settings/-action.tsx:14-15`
  - 理由: `/settings` では誘導（レイアウト）と権威（子断片の `requireSession()`）が別 match に分かれているので、二重化という記述自体は今も事実に近い。ただし (a) ガードは `beforeLoad` ではなく `loader` に移っており「ルートガード」の指す先がずれている、(b) 同じ言い回しを `docs/frontend_implementation_example.md` からは AC-13 で削っている、(c) 隣の `routes/notes/-action.tsx:7` は「権限判定の権威はここ（ハンドラー側）にあり」と真逆に近い書き出しになっている。2 ファイルを読み比べた人には指針が 2 つあるように見える。
  - 提案: `docs` 側で採った分担の言葉に揃える。例:「レイアウトの `loader` ガードは**遷移の誘導**で、権限判定の権威はここ（ハンドラー側）。別 match なので畳めず、並列に走らせている」。

## 認証観点で確認して問題が無かった点（記録）

- `presentation/sessionGuard.ts` は server-only モジュールを静的 import していない（`@tanstack/react-router` の `redirect` と純関数の `./redirect` のみ静的、`./session` は動的）。クライアントグラフへの漏れは無い。
- `errorResponseMiddleware.ts:32` が `isRedirect(error)` を素通しするので、ブリッジから throw した `redirect` が `AppServerError` に潰れて 500 化する経路は無い。`serverFragment.tsx:42` も同様。
- `renderNoteList` が返すようになった `user` は `AuthenticatedUserView`（`userId` / `displayName` / `handle` / `avatarUrl`）で秘密を含まない。変更前も `sessionUserFn` の応答として同じ内容がクライアントへ渡っていたので露出量の増加は無い。`renderNoteDetail` は `user` を返さず、`ReaderShell` がアカウント要素を持たない設計と整合している。
- `useRouteContext` の残存参照はリポジトリに 0 件（`user` の供給源移行が中途半端に残っていない）。`requireAuthenticated` の参照も `.thread/` 以外に 0 件で AC-14 を満たす。
- `auth.ts` からの `safeRedirectPath` 再輸出が外れ、`signin.tsx` / `settings/route.tsx` は `presentation/redirect` を直接引いている。`signin.tsx` 側は `validateSearch` の `max(2048)` + `catch(undefined)` + 描画時の `safeRedirectPath` で二重に守られたまま。
- `shouldReload: ({ cause }) => cause !== "preload"` が preload でガードを飛ばすのは cached match のみで、その場合クリック時には `cause` が `"enter"` / `"stay"` になり必ず再判定される。preload が in-flight のままクリックした場合にガードが 1 回落ちる経路は plan.md:76 が把握済みで、redirect 自体は preload 側の背景ロードが拾うためバイパスにはならない。
- `/settings` の子断片 3 本は `requireSession()` を保持しており、レイアウトの `loader` ガードをクライアント側で無視しても 401 で止まる。未サインインで `/settings/*` を開くと子断片が 401 を 1 本無駄打ちするが、これは plan.md:77 が把握済みのコストで情報漏れではない。
- `/settings/` index の `beforeLoad` が先に走ることで未サインイン直開きの着地が `/signin?redirect=/settings/profile` に変わる件は AC-6a が明示的に受容している。最終的な着地画面は変わらない。

## カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`
- 差分外で判断材料として読んだもの: `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `apps/web/app/presentation/serverFragment.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/index.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/routes/index.tsx`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/routeTree.gen.ts`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `packages/core/src/application/identity/authenticateSession.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`, `spec/adr/051-same-origin-url-predicate.md`, `spec/presentation/index.md`, `docs/test.md`, `.thread/13/adr.md`, `.thread/13/steps.md`, `.thread/13/testing.md`
- スキップ: なし（変更ファイル 13 件すべてを認証・セッション観点で確認した）
