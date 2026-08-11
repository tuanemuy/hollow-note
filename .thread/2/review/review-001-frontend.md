# レビュー 001 — Frontend

## 前提と読み方

- 基準は `CLAUDE.md`（Frontend 節）、`spec/pages/index.md`（P-02..P-05 / P-20..P-25）、`spec/presentation/index.md`、`spec/design/index.md` / `tokens.md`、`spec/design/pages/*.html`、および `.thread/2/plan.md`（AC-5 / 9 / 12 / 17 / 20 / 23 / 28 と「含まれないもの」89 行）。
- `CLAUDE.md` が名指しする参照実装 `apps/web/app/components/todo/` は現存せず、実体は `apps/web/app/components/note/`（`NoteList` / `NoteDetail` + `Deferred` + `*Skeleton`）。所有権・ストリーミング・再整合の判定はこちらを基準にした。
- モックの数値と spec/usecases の数値が食い違う箇所（`P21-settings-profile.html` の「2 MB まで」「300 文字まで」）は spec/usecases（5 MB / 500 文字）を正とみなし、実装が spec 側に合わせているのは正しいと判定した。指摘に数えていない。

### 見送り行の確認（スコープ超過なし）

- `PAGE-p21-004`（公開プロフィール preview）: `ProfileForm/index.tsx` にも `editor.tsx` にも該当要素・無効ボタンなし。✅
- `PAGE-p24-002`（workspace 使用量の追加読込）: `UsagePanel/index.tsx` は `usage.workspaces` を一切描画せず、「さらに読み込む」も出していない。✅
- `PAGE-p25-004`（唯一 owner の実行不可）: `DeleteAccountPanel` に該当パネル・導線なし。✅
- `P-20` の「連携」タブ: `SETTINGS_TABS` は 4 件で、`P-23` への placeholder を置いていない。✅
- `P-22` の「再認証要求」状態: 未実装（縮退どおり）。✅

### AC 対応の確認

| AC | 判定 | 根拠 |
|---|---|---|
| AC-5 | 満たす | `ResendVerificationForm` を P-03（`VerifyEmailPanel` の expired / invalid）と P-02（`SignInForm` の unverified アラート）で共有。`email` 既知/未知で入力欄の有無を切り替える設計は妥当 |
| AC-9 | 概ね満たす | `completeOAuthCallbackFn` は `state` の intent だけで分岐し、パスの `:provider` は照合のみ。P-05 の 5 状態も揃う。ただし cancel / failed の文言と導線が signIn 固定（W-001） |
| AC-12 | 満たす | `ResetPasswordPanel` の申請 / 実行 2 モード、申請完了の同一文言、`tokenInvalid` からの URL の token 落とし。P-02 の「パスワードを忘れた」と LOCKED アラートの導線も実リンク |
| AC-17 | 満たす | 一覧 / 追加 / 変更 / Google 追加 / 解除（最後の 1 件は `canRemove` false + 理由文 + `aria-describedby`）/ 他端末サインアウト |
| AC-20 | 満たす | 4 タブ + `AccountMenu` の設定導線。アバターは `uploadAvatarFn` → `updateProfileFn` の 2 段（ADR-016）で `AppShell` にも反映 |
| AC-23 | 満たす | 容量 / ノート件数 / 当月 LLM / 最終更新 / 80% 警告 / 上限到達 / `/settings/danger` 導線。`formatResetDate` の `Date.UTC(year, month, 1)` は `BillingPeriod.month` が 1..12 なので翌月 1 日になり正しい |
| AC-28 | 満たす | ticket の `sessionStorage` 退避・ポーリング・完了表示・フル遷移。`router.invalidate()` を呼ばないのも ADR-006 の意図どおり |

### ミューテーション三層規律の棚卸し

| 画面 / 操作 | 取得 | island | React 19 プリミティブ | 所有者 | `router.invalidate()` |
|---|---|---|---|---|---|
| P-21 プロフィール保存 | `ProfileForm`(RSC) | `ProfileEditor` | `useActionState` | leaf | あり |
| P-21 アイコン差し替え / 削除 | 同上 | 同上 | `useTransition` + `useOptimistic` | leaf（in-item） | あり |
| P-22 パスワード追加 | `IdentityList`(RSC) | `IdentityBoard` | 親の `useOptimistic` + leaf の `useActionState` | **親**（list-membership） | あり |
| P-22 解除 | 同上 | 同上 | `useTransition` + `useOptimistic` | **親**（規律どおり leaf に持たせていない） | あり |
| P-22 パスワード変更 | 同上 | `ChangePasswordForm` | `useActionState` | leaf（in-item） | なし（W-006） |
| P-22 他端末サインアウト | 同上 | `SignOutOthersPanel` | `useTransition` | leaf | なし（W-006） |
| P-25 削除実行 | なし | `DeleteAccountPanel` | `useActionState` | leaf | なし（ADR-006 の例外、正） |
| P-01/02 Google | — | `OAuthButton` | `useActionState` | leaf | 不要（フル遷移） |

`<form action={serverFn}>` の直結（既定の失敗モード）は 1 件もない。所有権の規則も、解除を親で走らせている点まで含めて守られている。

---

## Blockers

- **[B-001]** `FormData` を受ける server function に `Origin` 検証が無い（`spec/presentation/index.md` の CSRF 規約で「必須」とされている唯一の追加要件を満たしていない）
  - 場所: `apps/web/app/routes/settings/-action.tsx:168-174`（`uploadAvatarFn` の `.validator((input) => ... input instanceof FormData ...)`）
  - 理由: `spec/presentation/index.md`「CSRF > 規約」は 3 行の規約のうち 1 行を **`FormData` を受けるサーバー関数を作る場合は `Origin` ヘッダーの検証を必須とする** に割いており、理由も明記されている — 「`<form action={fn}>` のためにこの形を用意すると、クロスサイトの `<form>` から到達しうる唯一の経路になる。到達しうる以上、`SameSite` に頼らない検証をその経路自身が持つ必要がある」。本 PR は**リポジトリで初めて `FormData` を受ける server function**（`grep -rn FormData apps/web/app` で `-action` 側に現れるのはこの 1 箇所のみ）を新設したにもかかわらず、`Origin` を見ていない。フレームワーク側にも救いは無い — `@tanstack/start-server-core@1.169.17` の `server-functions-handler.js` に `origin` 検証は存在しない（`origin: "client"` はサーバー関数の解決モードで別物）。`.thread/2/adr.md` にもこの規約を緩める判断は無く、plan.md の「含まれないもの」にも入っていないので、意図的な縮退ではなく単純な漏れと読める。
  - 影響: `multipart/form-data` はクロスサイトの `<form>` が送れる唯一の enctype なので、この 1 経路だけが「一次防御（`SameSite=Lax`）が効かなくなった瞬間に素通しになる」状態で残る。spec が二層目を要求しているのはまさにこのため。実害は「他人のアカウントに任意の画像を保存させる（容量消費 + `sumSizeByOwner` 汚染）」で、`updateProfileFn` は JSON POST なので表示までは連鎖しない。
  - 提案: `errorResponseMiddleware` と並べる形で `originGuard` ミドルウェアを `apps/web/app/presentation/` に足し、`getRequest().headers.get("origin")` を `container.config.appUrl` のオリジンと突き合わせて不一致・欠落を `ValidationError("INVALID_ORIGIN")` で弾く。`uploadAvatarFn` にだけ付けるのでも規約は満たすが、`FormData` を受ける入口が今後増えることを考えると「`validator` が `FormData` を触る server function は必ずこのミドルウェアを通す」と JSDoc で規律化しておくのが安い。テストは `presentation/__tests__/` に純関数（`isSameOrigin(appUrl, originHeader)`）として置けば `createServerFn` を引き込まずに書ける（`devOAuth.ts` と同じ形）。

---

## Warnings

- **[W-001]** P-05 のキャンセル / 失敗が `signIn` 前提の文言と導線に固定されていて、`linkIdentity`（P-22 の「Google を追加」）から来た利用者を `/signin` へ流す
  - 場所: `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx:126-138`（`initialPhase`）、`:199-232`（`cancelled` / `failed` の `<Link to="/signin">`）、`:88-101`（`retryAuthorization` が `startOAuthSignInFn` 固定）
  - 理由: 成功アームだけが intent 別（`succeeded` は `linkIdentity` で「ログイン方法を追加しました」＋`/settings/auth`）で、`cancelled` / `failed` / `needsReauthorization` は intent を持たない。P-22 で「Google を追加」→ 認可画面で「キャンセル」すると、サインイン済みの利用者が「**サインイン**をキャンセルしました」を読まされ、唯一のボタンが `/signin` になる。`/signin` は認証済みでもリダイレクトしない（`apps/web/app/routes/signin.tsx` に guard 無し）ので、着地点はサインインフォームそのもの。`spec/design/pages/P05-oauth-callback.html` のモック自体が「連携をキャンセルしました / 元の画面に戻る」と intent 別の文言を前提に書かれており、成功アームだけ intent を見て他は見ない、という今の形は設計とも噛み合っていない。`retryAuthorization` が `startOAuthSignInFn`（intent=signIn 固定）を呼ぶのも同じ根で、link フローからの「もう一度許可する」がサインインフローを開始してしまう。
  - 提案: キャンセル時も `state` はクエリーに載って戻ってくる（`error=access_denied&state=...`）ので、intent を解決する術はある。(a) `state` から intent だけを引く軽い server function を足して `initialPhase` を非同期に確定させる、(b) link フローの `redirect_uri` を `/auth/callback/$provider?flow=link` のように分けて `validateSearch` で受ける、のどちらか。(b) なら往復が増えず、`retryAuthorization` の分岐先（`startOAuthLinkFn`）と `cancelled` の戻り先（`/settings/auth`）も同じ材料で決まる。最低限、cancelled / failed の文言から「サインイン」を外して戻り先を `document.referrer` ではなく intent 由来にすること。

- **[W-002]** `AccountMenu` の「設定」リンクを押してもメニューが閉じない
  - 場所: `apps/web/app/components/layout/AccountMenu/index.tsx:96-101`
  - 理由: 外側クリックで閉じる `pointerdown` ハンドラーは `rootRef.current?.contains(event.target)` で自分の内側を除外しているので、メニュー内の `<Link>` を押しても `open` は `true` のまま。SPA 遷移では `AccountMenu` はアンマウントされない（`AppShell` は `/notes` と `/settings` の両方で描かれ、同じ位置に居続ける）ため、`/settings/profile` に着いた後もドロップダウンが開きっぱなしで前面に残る。既に `/settings/profile` にいるときに押すと遷移も起きないので、閉じる手段は「外側をクリック」か Esc だけになる。サインアウト側は `setOpen(false)` を明示していて、リンク側だけが抜けている。
  - 提案: `<Link onClick={() => setOpen(false)}>`。あるいは `useRouterState({ select: s => s.location.pathname })` を購読して pathname が変わったら閉じる（将来メニュー項目が増えても効く）。

- **[W-003]** `/settings` を直接開くと、タブ列だけがあって中身が何も無い画面になる
  - 場所: `apps/web/app/routes/settings/route.tsx:65-74`（`SettingsColumn` の `<Outlet />`）、`apps/web/app/routes/settings/` に index ルートが無い
  - 理由: `/settings` は子を持つレイアウトルートだが index 子ルートが無いので、`/settings` にマッチしたときの `<Outlet />` は空になる。見出し「設定」とタブ列だけが出て本文が無い、行き止まりの状態が URL として存在する。`AccountMenu` からは `/settings/profile` に入るので通常導線では踏まないが、ブラウザーの履歴補完・ユーザーが URL を削って戻る・外部からの `/settings` リンクで簡単に到達する。`spec/pages/index.md#P-20` は「設定の各セクションを束ねる枠」であって、セクション不在の状態を定義していない。
  - 提案: `apps/web/app/routes/settings/index.tsx` を足して `beforeLoad` で `throw redirect({ to: "/settings/profile" })`。タブ列の先頭が入口という前提は `AccountMenu` の `SETTINGS_ENTRY_HREF` と同じ根拠なので、`SETTINGS_TABS[0].href` を使い回せば定義が 1 箇所に収まる。

- **[W-004]** サインアウト状態で `/settings/danger` を開くと、削除フォームがそのまま操作可能な見た目で出る
  - 場所: `apps/web/app/routes/settings/route.tsx:25-37`（`SIGNED_OUT_PATH` の素通し）＋ `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:169-233`
  - 理由: `beforeLoad` が `/settings/danger` だけ未認証を通すのは ADR-006 の意図（ticket を持ったままリロードした利用者を守る）で正しいが、`DeleteAccountPanel` は `sessionStorage` に ticket が無ければ `phase: idle` として**削除フォーム**を描く。つまり一度もサインインしていない訪問者が「アカウントを削除」パネルと「アカウントを削除する」ボタンを見ることになる。押せば `requireSession()` で 401 になり、`displayError` が「サインインが必要です」をメールアドレス欄のエラーとして出す — 不一致エラー用の欄に認証エラーが出る形で、`aria-invalid` も付く。ルートのコメントは「他のタブは開いても何も操作できないため」と書いているが、このタブは「操作できるように見えるが 401 になる」状態を作っている。
  - 提案: `Route.useRouteContext()` の `user === null`（あるいは ticket 不在）を `DeleteAccountPanel` に渡し、その組み合わせのときは「進捗を確認できる ticket がありません。サインインしてからやり直してください」＋`/signin` 導線に倒す。`Phase` に `{ kind: "noTicket" }` を足せば型で網羅性が取れる。

- **[W-005]** P-21 の保存状態表示が「保存しました」に張り付き、再編集しても「未保存の変更があります」に戻らない
  - 場所: `apps/web/app/components/settings/ProfileForm/editor.tsx:398-406`
  - 理由: 三項の評価順が `isSaving` → `saveState.status === "saved"` → `dirty` なので、一度保存に成功したあとに表示名を打ち替えると、`dirty === true` で「保存」ボタンが有効になっているのに文言は「保存しました」のまま。`role="status"` の常設リージョンなので支援技術にも「保存しました」が残り続ける。`spec/pages/index.md#P-21` は「保存中 / 保存済み」と「編集」を別状態として並べており、編集に戻った時点で保存済み表示は落ちるべき。
  - 提案: `dirty` を先に見る（`isSaving ? … : dirty ? "未保存の変更があります" : saveState.status === "saved" ? "保存しました" : null`）。より素直には `SaveState` を `useActionState` の外の直和に持たせず、`dirty` が立った時点で `saved` を捨てる（フィールドの `onChange` で `saveState` をリセットする reducer を挟む）と、状態の組み合わせ自体が消える。

- **[W-006]** `changePassword` と `signOutOtherSessions` だけ `router.invalidate()` を呼んでおらず、ADR-006 の例外表に載っていない
  - 場所: `apps/web/app/components/settings/ChangePasswordForm/index.tsx:46-61`、`apps/web/app/components/settings/IdentityList/board.tsx:292-303`
  - 理由: `CLAUDE.md` は「Every mutation reconciles with `router.invalidate()`」と書き、plan.md も「ADR-006 で P-25 だけが意図的な例外」と明記している。この 2 つは P-25 ではないのに再整合を持たない。実害は現時点では小さい（`IdentityListItemView` は `createdAt` しか出さないので、パスワード変更は一覧の見た目を変えない）が、モック `P22-settings-auth.html` の password 行の副題は「… · **最終変更** 2026年3月2日」であり、`updatedAt` を出す方向へ寄せた瞬間に「変更したのに日付が古いまま」になる。`signOutOtherSessions` も同様で、将来セッション件数を出したら黙って古い値が残る。
  - 提案: 両方に `await router.invalidate()` を足す（`IdentityBoard` の `reconcile` をそのまま渡せば `SignOutOthersPanel` は 1 行）。呼ばない判断を通すなら、`.thread/2/adr.md` に「表示に影響しないので再整合しない」と根拠つきで記録し、plan.md の「P-25 だけが例外」を改める。

- **[W-007]** クライアント側のアイコン検証が、ドメインの不変条件（5 MB / MIME 許可リスト）を辞書を通さない別文言で二重に持っている
  - 場所: `apps/web/app/components/settings/ProfileForm/editor.tsx:49-50, 171-183`
  - 理由: `apps/web/app/routes/settings/-action.tsx:150-155` は「転送境界の DoS 上限（8 MB）は業務上の上限（5 MB）より広い。上限違反の理由をドメイン側の 1 か所に保つため」と明示している。その意図に反して、島が `AVATAR_MAX_BYTES = 5 * 1024 * 1024` と `ACCEPTED_IMAGE_TYPES` を持ち、ドメインと同じ判定を先回りしている。しかも文言は `errorDisplay.ts` の `STORAGE_FILE_TOO_LARGE`（「ファイルが大きすぎます。アイコンは 5 MB までです。」）/ `STORAGE_UNSUPPORTED_MIME_TYPE`（「この形式のファイルは扱えません。PNG / JPEG / WebP を選んでください。」）と別に書かれているので、同じ拒否理由が経路によって 2 通りの日本語で出る。`UploadValidationPolicy` が 5 MB を 4 MB に変えても島は 5 MB のまま素通しし、逆も起きる。
  - 提案: 上限値の重複だけでも消す。(a) 島の事前チェックを撤廃してサーバーの `FileTooLarge` / `UnsupportedMimeType` を `displayError` で出す（往復 1 回のコストと引き換えに一元化）、(b) 残すなら文言は `MESSAGE_BY_CODE` を引く形にし、しきい値は `@repo/core/domain/storage/services/uploadValidationPolicy` が公開する定数を import する。`accept` 属性用の MIME 一覧も同じ定数から導けば、`ACCEPTED_IMAGE_TYPES.join(",")` の一致も保証される。

- **[W-008]** `OAuthCallbackPanel` が `errorDisplay.ts` の辞書と同じ文言をハードコードで持ち、`OAUTH_CODE_INVALID` の辞書エントリーを死なせている
  - 場所: `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx:130-138`（`initialPhase`）と `:141-155`（`classify`）
  - 理由: 「認可の手続きが途中で切れました。もう一度サインインからやり直してください。」が `initialPhase` と `classify` の 2 箇所にリテラルで置かれ、さらに `errorDisplay.ts` の `OAUTH_STATE_INVALID` にも同文が入っている（同一文言が 3 箇所）。加えて `classify` の `case "OAUTH_CODE_INVALID"` はその文言で上書きするので、辞書に足した `OAUTH_CODE_INVALID`（「認可の手続きを**完了**できませんでした…」）はこの画面からは決して出ない。`CLAUDE.md` / `spec/presentation` の「エラー文言は辞書経由」という規律に対して、辞書が唯一の正典でなくなっている。
  - 提案: `classify` からコード分岐を落として `renderErrorMessage(error)` に一本化し、`OAUTH_EMAIL_UNVERIFIED` だけを `needsReauthorization` へ倒す形にする（この 1 件は文言ではなく**画面状態**の分岐なので分岐する価値がある）。`initialPhase` の「クエリーが欠けている」ケースは `SerializedError` が存在しない状態なので、`MESSAGE_BY_CODE.OAUTH_STATE_INVALID` を named export して参照するか、`errorDisplay.ts` に `oauthFlowInterruptedMessage` を 1 本足して両者が同じ定数を読む形にする。

- **[W-009]** `crypto.randomUUID()` が `try` の外にあり、非セキュアコンテキストでは削除ボタンが無反応のまま例外になる
  - 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:78`
  - 理由: `requestIdRef.current ??= crypto.randomUUID();` は `try` ブロックの直前にあるので、ここで投げると `useActionState` の action が reject し、`SubmitState` にも `role="status"` にも何も出ないまま、React 19 の仕様どおり最寄りのエラーバウンダリー（ルートの `errorComponent: () => <ServerErrorState />`）へ飛ぶ。`crypto.randomUUID` は**セキュアコンテキスト限定**なので、`http://<LAN IP>:3000` で開いた `pnpm dev`（実機確認でよく使う形）では `undefined` になる。plan.md のマニュアルテスト TC-14 / TC-30..34 を別端末から実行すると、原因の分からない全画面エラーで止まる。
  - 提案: `try` の中へ移すか、フォールバックを 1 行置く（`crypto.randomUUID?.() ?? \`${Date.now()}-${Math.random().toString(16).slice(2)}\``）。`requestId` は「同じ確認画面からの再送を同じ要求として扱わせる」ための冪等鍵であり、`deleteAccountFn` 側で UUID 形式を要求している（`INVALID_REQUEST_ID`）ので、フォールバックを置くなら UUID v4 の形に整形すること。

- **[W-010]** `ProfileFormSkeleton` が実 DOM の下部アクションバーを写しておらず、JSDoc の主張と実装が食い違う
  - 場所: `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx:4-8`（「`ProfileForm` の DOM（2 パネル + 下部のアクションバー）を写して」）と `:15-32`（アクションバー相当が無い）
  - 理由: 実物の `ProfileEditor` は末尾に `sticky bottom-0 … py-2` のバー（`h-10` のボタン 2 つ）を持ち、これはフロー内の要素なので高さを占める。スケルトンにその分が無いため、差し替え時に本文が約 56px 分下へ伸びる — `CLAUDE.md` が「shaped to the real DOM so it swaps in without layout shift」と要求している当のレイアウトシフトが残る。ハンドル変更の警告ボックス（`profile.handle !== null` のとき常に出る）と `handlePrefix` の前置きセグメントも写していないので、ハンドルを設定済みの利用者ではさらに大きくずれる。
  - 提案: バー相当（`h-10 w-24 rounded-pill` × 2 を右寄せした行）を足す。警告ボックスは出るとは限らないので `UsagePanelSkeleton` と同じ理屈で省いてよいが、その場合は JSDoc から「下部のアクションバー」の記述を落として、何を写して何を写さないかを実装と一致させること。

- **[W-011]** `IdentityBoard` が `Intl.DateTimeFormat` をクライアントコンポーネントの中で使っていて、サーバーとブラウザーの時間帯が違う配備でハイドレーション不一致になりうる
  - 場所: `apps/web/app/components/settings/IdentityList/board.tsx:338-344`（`dateFormat` / `formatDate`）、使用箇所は `:233`
  - 理由: `IdentityBoard` は `"use client"` なので SSR でもサーバー側で 1 回描画され、その後ブラウザーでハイドレートされる。`Intl.DateTimeFormat("ja-JP", {...})` に `timeZone` を渡していないため、UTC のサーバーと JST のブラウザーでは日付境界付近の `createdAt` が 1 日ずれ、React のハイドレーション警告 + テキストの差し替えが起きる。同じ問題を `UsagePanel`（サーバーコンポーネント）は構造的に免れており、`UsagePanel/index.tsx:203-209` は「課金期間は UTC の暦月なので、リセット日も UTC で読む — 端末の時間帯で丸めると月末に 1 日ずれた日付を出す」と、まさにこの種のずれを意識したコメントを持っている。同じ配慮がクライアント側に無い。
  - 提案: 表示を島から出す（`IdentityList`（RSC）で整形済み文字列にして渡す）のが一番安い。島に残すなら `suppressHydrationWarning` ではなく、`useEffect` 後にだけ整形する / `timeZone: "UTC"` を明示する、のいずれかで決定的にすること。

- **[W-012]** ADR-007 の intent ディスパッチャー（`completeOAuthCallback`）に一切テストが無い
  - 場所: `packages/core/src/application/identity/completeOAuthCallback.ts`（テストファイルなし。`__tests__/` にあるのは `startOAuthFlow` / `completeOAuthSignIn` / `linkOAuthIdentity` の 3 本のみ）
  - 理由: plan.md「テスト方針 > プレゼンテーションテスト」は「status ticket の署名・検証・期限（ADR-006）と **OAuth callback の intent 分岐（ADR-007）**を追加する」と明記している。前者は `presentation/__tests__/deletionTicket.test.ts` として実装されている（6 ケース、改竄・別鍵・版解決・期限境界まで押さえていて実効的）が、後者はどこにも無い — `presentation/__tests__/devOAuth.test.ts` は dev IdP のリダイレクト組み立ての検証で、intent 分岐は見ていない。AC-9 の「`state` の intent だけで分岐し（ADR-007）」は、この関数の 3 分岐（`provider` 不一致で `oauthStateInvalid` / `signIn` / `linkIdentity`）と `integration` の拒否が守っている性質そのもので、いま回帰を検出する手立てが無い。
  - 提案: `application/identity/__tests__/completeOAuthCallback.test.ts` を足す。`createTestHarness()` の `requestOverrides` で OAuth クライアントを差し替えれば、(a) `signIn` の state で開始 → 応答が `intent: "signIn"` かつ `sessionToken` を持つ、(b) `linkIdentity` の state → `intent: "linkIdentity"` かつ `sessionToken` を**持たない**、(c) パスの provider が state と食い違うと `OAUTH_STATE_INVALID`、(d) 同じ state の 2 回目は `take` の消費により `OAUTH_STATE_INVALID`、の 4 本で AC-9 の主張が実効的に守られる。

- **[W-013]** `completeOAuthCallback` の `container as RequestContainer` が無意味なキャストとして残っている
  - 場所: `packages/core/src/application/identity/completeOAuthCallback.ts:39, 47`
  - 理由: `ServiceArgs<T>` の `container` は既に `RequestContainer`（`packages/core/src/application/types.ts`）で、呼び先の `completeOAuthSignInForFlow` / `linkOAuthIdentityForFlow` も第 1 引数が `RequestContainer`。したがってこの `as` は型を一切変えていない。`CLAUDE.md`「Prioritize type safety」の観点では、無効なキャストが残っていること自体が問題で、将来 `ServiceArgs` の `container` が狭まったときに型エラーではなく実行時の欠落として現れる。
  - 提案: 2 箇所とも `as RequestContainer` を削る。消してコンパイルが通ることが「不要だった」ことの証明になる。

- **[W-014]** `DeletionProgress` が `Phase` 全体を受けるので、到達しない `idle` が「削除しています」に落ちる
  - 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:236, 263-275`
  - 理由: 呼び出し側 `:169-171` が `phase.kind !== "idle"` で守っているので実害は無いが、`DeletionProgress` の引数型は `Phase` のままで、`completed` / `settled` を弾いた**残り**が `accepted | running | idle` になる。`idle` は最後の `return`（「アカウントを削除しています」）に吸い込まれる。`CLAUDE.md`「Make illegal states unrepresentable at the type level before falling back to runtime checks」に照らすと、型で排除できる組み合わせを実行時のガード 1 本に預けている。
  - 提案: `phase: Exclude<Phase, { kind: "idle" }>` にする。そのうえで最後の `return` を `phase.kind === "accepted" ? … : …` ではなく switch の網羅で書けば、`Phase` に状態が増えたときにコンパイルエラーで気づける。

- **[W-015]** 検証不能になった status ticket が `sessionStorage` に残り続け、そのタブでは二度と削除フォームに戻れない
  - 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:143-149`（`catch` で `settle` を使わず `setPhase` だけ）と `:98-103`（マウント時の復元）
  - 理由: コメントは「ticket は捨てない — 一時障害なら再読込でポーリングを再開できる」と説明していて、一時障害についてはそのとおり。しかし `DELETION_TICKET_EXPIRED`（30 分）と `DELETION_TICKET_INVALID`（鍵が変わった場合。memory 配備では**プロセス再起動のたびに起きる** — plan.md「リスクと注意点」の最終行がまさにこれを警告している）は恒久的な失敗で、再読込しても復元 → 即失敗 → `settled` を繰り返す。そのタブでは `/settings/danger` が「削除の進捗を表示できません」に固定され、削除フォームへ戻る手立てが無い。
  - 提案: `catch` で `extractSerializedError(error).code` を見て、`DELETION_TICKET_EXPIRED` / `DELETION_TICKET_INVALID` のときは `settle(...)`（= `sessionStorage` から捨てる）に倒す。それ以外（`system` / ネットワーク）だけ ticket を保持して再読込での再開に賭ける、という分け方なら両方の意図が立つ。

---

## 良かった点（記録として）

- **所有権の規則が明示的に守られている**。`IdentityList/board.tsx:26-36` の JSDoc は「解除は、楽観的除去が行を先にアンマウントするため行側に持たせるとエラー表示ごと消えてしまう」と、`CLAUDE.md` が挙げた失敗モードそのものを理由として書いており、実装もそのとおり。`AddPasswordForm` が `onSubmit(newPassword)` を受け取るだけの純粋な入力に徹し、楽観追加は親が持つ形も正しい。
- **`canRemove` を楽観リストから引き直している**（`board.tsx:87-90`）。サーバーの `removable` は解除前の集合に対する判定なので、1 件消した直後に「まだ解除できる」と見える — この一段を踏んでいるのは丁寧。
- **live region の扱いが一貫している**。「常設して中身だけ差し替える」（`panelStyles.ts:32-34` の `errorTextClass = "… not-empty:mt-2"`、余白だけを条件付きにする）という規律が全画面で統一され、`ResendVerificationForm` が「呼び出し元の live region の中なので自前の live region を持たない」と入れ子を明示的に避けているのも良い。カウントダウンだけ `aria-hidden` にして毎秒の読み上げを止めているのも細かいが効く。
- **per-fragment streaming の使い分けが正しい**。`/settings/{profile,auth,usage}` は `renderXxx()` の promise を await せずに転送して `<Suspense fallback={<Skeleton/>}>` で受け、サーバー状態を持たない `/settings/danger` は loader 自体を置かない。`routes/settings/danger.tsx:8-12` がその理由を書いているのも良い。
- **転送境界の設計**。`userId` を要求本文で受け取らず全て Cookie セッションから引く（`-action.tsx:8-15`）、`startOAuthLinkFn` が intent をクライアントに選ばせず `linkIdentity` 固定、`getDeletionStatusFn` が `operationId` を検証済み ticket からしか取らない — いずれも「境界で信頼を切る」という原則の正しい適用で、TC-identity-048 の主張が構造で守られている。
- **`deletionTicket.ts` の署名検証順序**（`:158-162`「期限は署名の検証を通った後にだけ見る」）と、それを突く 6 本のテスト。アサーションが形骸化しておらず、鍵版の解決不能・別鍵・claims 改竄・境界（30 分ちょうど）まで押さえている。
- **デザイントークンの遵守**。`panelStyles.ts` の recipe はすべてトークン経由で、モック `P22/P25` の `.panel` / `.btn` と 1:1 対応する。ハードコードされた色は `bg-linear-135 from-[#c9d3df] to-[#8e99a8]`（アバターのフォールバック）だけで、これは `spec/design/index.md:296` が「`linear-gradient(135deg, #c9d3df 0%, #8e99a8 100%)` のフォールバック」と生値で規定しているものなので逸脱ではない。`dangerPanelClass` を `panelClass` の重ね掛けにせず別 recipe にした理由（Tailwind の出力順で勝敗が決まる）を書き残しているのも良い。
- **`storage.$.tsx` の配信ヘッダー**。`nosniff` + `Content-Security-Policy: sandbox; default-src 'none'` + 不正な鍵を 400 ではなく 404 に倒す判断（形式違反を区別すると鍵の形が探索の手掛かりになる）。`spec/presentation/index.md`「その他のヘッダー」の要件を満たしている。
- **`__root.tsx` への副作用 import 漏れなし**。新設した server function モジュール 5 本（`ResendVerificationForm/action`・`ResetPasswordPanel/action`・`routes/auth/-action`・`routes/dev/-action`・`routes/settings/-action`）がすべて追加されている。`components/settings/*/action.ts` の 3 本は `serverData`（`createServerFn` ではない）なので追加不要、という区別も正しい。

---

## カバレッジ

確認（58 件）:

`.thread/2/adr.md`, `.thread/2/plan.md`, `apps/web/.env.example`,
`apps/web/app/components/auth/OAuthButton/index.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `apps/web/app/components/auth/ResendVerificationForm/action.ts`, `apps/web/app/components/auth/ResendVerificationForm/index.tsx`, `apps/web/app/components/auth/ResetPasswordPanel/action.ts`, `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/components/auth/SignUpForm/index.tsx`, `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`, `apps/web/app/components/auth/schema.ts`,
`apps/web/app/components/dev/DevConsentForm/index.tsx`,
`apps/web/app/components/layout/AccountMenu/action.ts`, `apps/web/app/components/layout/AccountMenu/index.tsx`, `apps/web/app/components/layout/AppShell/index.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`,
`apps/web/app/components/settings/AddPasswordForm/index.tsx`, `apps/web/app/components/settings/ChangePasswordForm/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/settings/IdentityList/action.ts`, `apps/web/app/components/settings/IdentityList/board.tsx`, `apps/web/app/components/settings/IdentityList/index.tsx`, `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/components/settings/ProfileForm/editor.tsx`, `apps/web/app/components/settings/ProfileForm/index.tsx`, `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`, `apps/web/app/components/settings/UsagePanel/action.ts`, `apps/web/app/components/settings/UsagePanel/index.tsx`, `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`, `apps/web/app/components/settings/panelStyles.ts`,
`apps/web/app/presentation/__tests__/deletionTicket.test.ts`, `apps/web/app/presentation/__tests__/devOAuth.test.ts`, `apps/web/app/presentation/deletionTicket.ts`, `apps/web/app/presentation/devOAuth.ts`, `apps/web/app/presentation/errorDisplay.ts`,
`apps/web/app/routeTree.gen.ts`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/reset-password.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/auth.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/routes/settings/profile.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/settings/usage.tsx`, `apps/web/app/routes/storage.$.tsx`,
`packages/core/src/application/identity/checkHandleAvailability.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/usage/view.ts`, `packages/core/src/domain/usage/valueObject.ts`

スキップ（168 件）:

- `.thread/2/progress.md`, `.thread/2/steps.md`, `.thread/2/testing.md`（3 件） — 実装記録・手順書で、画面の振る舞いを定義しない
- `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`（2 件） — ランタイム entry / worker 配線で、Backend・Runtime 観点
- `docs/runtime_node.md`（1 件） — 運用ドキュメント
- `packages/core/src/**`（162 件。上記「確認」に挙げた 5 ファイルを除く全て） — adapters / application usecase 本体 / domain / ports / 各テスト。画面が読む DTO の形（`identity/view.ts`・`usage/view.ts`）と画面から直接呼ぶ 2 本（`checkHandleAvailability` / `completeOAuthCallback`）、および P-24 の表示を左右する `domain/usage/valueObject.ts` の `BillingPeriod` だけを確認対象に引き上げ、残りは Domain / Usecase / Adapter 観点に委ねた
