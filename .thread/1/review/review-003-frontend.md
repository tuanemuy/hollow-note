# Review 003 — Frontend

対象: PR #12（issue/1/account-to-blank-note-skeleton, base: main）
観点: コンポーネント設計・状態管理・UX・ビューとロジックの切り分け
参照: CLAUDE.md Frontend 節 / spec/pages/index.md（P-01/02/03/10/11/46/47・L-01/02/03）/ spec/design/index.md §9・§10 / .thread/1/plan.md（AC-15〜19）/ .thread/1/review/triage.md / .thread/1/review/review-002-frontend.md
前提: 3 ラウンド目のフルレビュー。台帳で判定済みの Key（B-001 / W-014〜W-021 / R2-FE-W-001〜011）は再審議しない。R2-FE-W-008（RPC 3 往復）は Issue #13 に defer 済みのため対象外。

## ラウンド 2 指摘（W-001〜W-011）の修正確認

| Key | 判定 | 根拠 |
| --- | --- | --- |
| R2-FE-W-001 原文 message の画面露出 | **解決** | `presentation/errorDisplay.ts` が `kind` + `code` だけを読む辞書になり、`error.message` を返す経路が消えた。`fieldErrors` の zod 文言も出さない。P-01/P-02 には `components/auth/fieldValidation.ts` のクライアント検証が入り、`IDENTITY_INVALID_EMAIL` が往復しなくなった（ただし W-003 参照） |
| R2-FE-W-002 遷移失敗が操作失敗として表示 | **解決** | `SignInForm/index.tsx:116-130`・`CreateNoteButton/index.tsx:29-49`・`VerifyEmailPanel/index.tsx:38-63` とも `try` はサーバー関数呼び出しだけになり、`invalidate` / `navigate` は `.catch(...)` 付きで外に出た。穴は見当たらない（`AccountMenu/index.tsx:128-139` だけ成功後の `window.location.assign` が `try` 内に残るが、`assign` は投げないので実害なし） |
| R2-FE-W-003 verify-email の invalidate 欠落 | **解決** | `VerifyEmailPanel/index.tsx:58-60` |
| R2-FE-W-004 4 ルートが P-46 を使わない | **未解決（B-001）** | errorComponent は消えたが、`router.tsx` に `defaultErrorComponent` がないため SSR 経路では root に落ちない。下記 B-001 |
| R2-FE-W-005 秒読みが assertive | **形は入ったが実効なし（W-002）** | `role="status"` になったが、その領域自体が条件付きマウントで、かつ毎秒書き換わる |
| R2-FE-W-006 aria-live/describedby の未適用 | **describedby は解決 / live region は実効なし（W-001）** | `aria-describedby` の接続とスケルトンの `role="status"` 移設は正しい。live region の常設は `empty:hidden` で打ち消されている |
| R2-FE-W-007 LOCKED アラートが残存 | **解決** | `SignInForm/index.tsx:264` |
| R2-FE-W-009 到達しない表面 | **解決** | `PublicShell` の `signedIn` prop 削除、`fieldHintClass` 削除、`pagination.ts:4-6` に残置理由の注記 |
| R2-FE-W-010 docs の自己矛盾 | **解決** | `docs/frontend_implementation_example.md:424, 874` とも旧 API 名が `.inputValidator(...)` に戻っている |
| R2-FE-W-011 focus-visible の forced-colors | **fix 分は解決** | `styles/index.css:19-23` に `outline: 2px solid transparent` 併記。accent 背景のリング色は台帳どおり spec-revise 送り |

### エラー文言辞書の情報欠落チェック（依頼事項）

core 側で実際に投げられる code を洗い出し、UI に届く 6 経路（signUp / signIn / verifyEmail / createBlankNote / signOut / ノート断片）と突き合わせた。

- 到達する code: `TERMS_NOT_ACCEPTED` / `IDENTITY_INVALID_EMAIL` / `IDENTITY_WEAK_PASSWORD` / `IDENTITY_INVALID_DISPLAY_NAME` / `INVALID_CREDENTIALS` / `EMAIL_NOT_VERIFIED` / `ACCOUNT_DELETING` / `THROTTLED` / `LOCKED` / `IDENTITY_TOKEN_EXPIRED` / `AUTH_TOKEN_NOT_FOUND` / `AUTH_TOKEN_ALREADY_CONSUMED` / `USER_NOT_FOUND` / `NOTE_NOT_FOUND` / `UNAUTHENTICATED` / `OPTIMISTIC_LOCK_FAILURE` / `INVALID_INPUT`（transport validator）/ `system`。
- 辞書に無いのは `USER_NOT_FOUND`（`verifyEmail.ts:55,70,82,121`）と `INVALID_INPUT`（`presentation/validator.ts:12`）の 2 つだけ。前者は VerifyEmailPanel が辞書を使わず phase に落とすので表示に関与せず、後者はクライアント検証が先に塞ぐうえ `validation` の共通文言（「入力内容を確認して…」）が意味的に正しい。**「原因不明に潰れる」経路は無い**と判断する。
- 逆に、到達しない code が辞書に残っている点は基本無害だが 1 件だけ実害の芽がある（W-006）。

## Blockers

- **[B-001]** 4 ルートの errorComponent 削除だけでは SSR 経路が P-46 に落ちず、TanStack の既定エラー画面（英語 + `error.message` 表示トグル）が出る — 場所: `apps/web/app/router.tsx:6-15`（`defaultErrorComponent` 未設定）、`apps/web/app/routes/index.tsx:24-26`、`routes/signin.tsx:25`、`routes/signup.tsx:16`、`routes/verify-email.tsx:24` / 理由: `@tanstack/react-router@1.170.18` の `Match.js` を読むと挙動が 2 経路に割れる。(1) クライアント描画では `ResolvedCatchBoundary = routeErrorComponent ? CatchBoundary : SafeFragment`（`Match.js:78`）なので errorComponent の無いルートは**境界を張らず**、`MatchInner` の `throw match.error`（`:238`）が root の CatchBoundary まで上がる — ここは意図どおり P-46 に落ちる。(2) しかし SSR 側は同じ `Match.js:164` で `jsx((route.options.errorComponent ?? router.options.defaultErrorComponent) || ErrorComponent, ...)` と**その場で描画**する。`defaultErrorComponent` は `router.tsx` にも `start.ts` にも無いので、フォールバックは `CatchBoundary.js:48-94` の組み込み `ErrorComponent` — `<strong>Something went wrong!</strong>` と「Show Error」ボタン、押すと `error.message` を `<pre>` に出す英語 UI である。`/` は `beforeLoad: sessionUserFn()` を持ち（`routes/index.tsx:12-17`）、コンテナ/DB 障害時にこの経路へ確実に入る。つまり「初回ロード（＝障害時にユーザーが最も踏む経路）で P-46 が出ない」状態で、AC-19「共通表示」と spec/pages/index.md#P-46「一貫して扱う」を満たしていない。ラウンド 2 で errorComponent を消したことで、以前あった日本語の `role="alert"` すら失われ、SSR 経路は**後退**している。/ 提案: `getRouter()` に `defaultErrorComponent: () => <ServerErrorState />`（と必要なら `defaultNotFoundComponent`）を足す。これで SSR / クライアント双方が同じ表示に収束し、各ルートが errorComponent を持たない現状の書き方が初めて正しくなる。root への「委譲」に依存した現在のコメント（`routes/*.tsx` の「失敗は root の P-46 共通表示へ委譲する」）も、そのとき初めて事実になる。

## Warnings

- **[W-001]** `empty:hidden` で aria-live 領域を隠しており、R2-FE-W-006 の「常設」修正が実効を伴っていない — 場所: `apps/web/app/components/auth/SignUpForm/index.tsx:186-192, 233-239, 266-272`、`components/auth/SignInForm/index.tsx:188-194`、`components/note/CreateNoteButton/index.tsx:83-85`、`components/layout/AccountMenu/index.tsx:176-181` / 理由: 6 箇所とも `<p aria-live="polite" class="... empty:hidden">{error}</p>`。Tailwind の `empty:` は `&:empty { display: none }` を出すので、エラーが無い間この要素は **`display: none` = アクセシビリティツリーに存在しない**。テキストが入る瞬間に `:empty` が外れて表示されるため、支援技術から見た遷移は「領域が中身ごと現れた」ままで、修正前と区別がつかない（アクセシビリティツリーに存在しないノードへの挿入は多くのスクリーンリーダーで告知されない）。コメント（`SignUpForm/index.tsx:183-185` ほか）は「領域を常設した」と主張しているが、DOM 常設と a11y ツリー常設は別物で、必要なのは後者。結果として AC-16 の「項目エラー」は視覚利用者にしか届かない。/ 提案: `empty:hidden` を外し、余白が出ないよう空時のマージンを消す（`fieldErrorClass` を `mt-2` 込みの固定余白ではなく、テキストがある時だけ余白を持つ形にする／親側の `gap` に寄せる）。視覚的に隠したいなら `display:none` ではなく高さ 0 + `overflow:hidden` など a11y ツリーに残る手段を使う。
- **[W-002]** THROTTLED の告知が「条件付きマウントの `role="status"`」になり、告知されないまま毎秒書き換わる — 場所: `apps/web/app/components/auth/SignInForm/index.tsx:168, 242-259`、`components/ui/Alert/index.tsx:53-62` / 理由: R2-FE-W-005 の修正で `role="alert"` → `role="status"` に変えたが、`PhaseAlert` は `idle` で `null` を返すので、この `<div role="status">` は**失敗した瞬間に中身ごと新規マウント**される。`role="alert"` は挿入時告知が広く実装されている一方 `role="status"`（polite）は W-001 と同じ理由で挿入時に読まれないため、assertive を外した代わりに「何も読まれない」に倒れている。加えて `now` が 1 秒ごとに更新されて本文（`:256` の「あと N 秒」）が書き換わるため、告知される環境では今度は polite キューに毎秒積まれる — spec/design/index.md:306 の「状態遷移・完了・失敗は polite」は満たすが、待機案内としては依然として過剰。さらに `waiting` 中は入力とボタンが `disabled`（`:181, 206, 213`）になるので、送信時にフォーカスがあった入力が外れ、フォーカスは `<body>` に落ちる — 告知もフォーカスも無い状態で 15 分（LOCKED 時）操作不能になる。/ 提案: 告知用の `role="status"` コンテナを `PhaseAlert` の外に常設し、中身だけ差し替える（VerifyEmailPanel と同じ形）。秒数はライブ領域の外の `<span>` に切り出して、領域の本文は「しばらく待ってからお試しください」で固定する。`disabled` にする場合はフォーカスをアラートへ移すか、`aria-disabled` + 送信時の握り潰しに変える。
- **[W-003]** クライアントのメール形式検証がドメイン `Email` の契約より厳しく、ドメイン的に有効なアドレスの利用者がサインインできない — 場所: `apps/web/app/components/auth/fieldValidation.ts:10-15`（`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`）対 `packages/core/src/domain/identity/valueObject.ts:48`（`EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/`）/ 理由: ドメインはドットを要求しないが、UI はドットを必須にしている。`SignInForm/index.tsx:213` は `disabled={... || emailError !== null || ...}` で送信ボタンを塞ぐので、ドット無しアドレス（`user@localhost` など、シード・直 RPC・将来のインポートで作られ得る）を持つ利用者は**サインインボタンが恒久 disabled になり、エラー文言も出ない**（`shownEmailError` は blur まで出ないうえ、出ても「形式が正しくありません」で、サーバーは受け付ける）。ラウンド 2 の修正が送信ゲートを「空でない」から「正規表現一致」に強めたことで入った退行。より本質的には、入力の妥当性がドメインとプレゼンテーションの 2 箇所で別々に定義され、UI 側が黙って契約を狭めている（CLAUDE.md「Validate at the boundaries」は 2 点での検証を認めるが、契約の食い違いは認めていない）。/ 提案: `fieldValidation.ts` の正規表現をドメインと同じ `^[^\s@]+@[^\s@]+$` に揃える（ドットを求める案内が要るなら「エラー」ではなく hint に落とす）。あわせて `EMAIL_MAX_LENGTH` と同様、パターンも `components/auth/schema.ts` 側に一元化してドメインとの一致をテストで固定する。
- **[W-004]** VerifyEmailPanel が system エラーを「リンクが壊れている / 書き換えられている」と誤診断する — 場所: `apps/web/app/components/auth/VerifyEmailPanel/index.tsx:40-48, 121-135` / 理由: `catch` の分岐は `IDENTITY_TOKEN_EXPIRED` かそれ以外の 2 値で、`SystemError`（DB 断・コンテナ初期化失敗）も `AUTH_TOKEN_NOT_FOUND` と同じ `invalid` に落ちる。表示は「このリンクは使えません / リンクが途中で切れているか、書き換えられている可能性があります」で、導線はサインインのみ。実際には一時障害なので、正しい案内は「時間をおいて同じリンクをもう一度開く」であり、現状の文言は利用者を「リンクを疑って再送を待つ」誤った行動に誘導する。`errorDisplay.ts` が `system` に「一時的な問題が発生しました。少し待ってからもう一度お試しください。」を用意しているのに、この画面だけそこへ繋がっていない。P-03 の状態直和が「原因」ではなく「結果」で切られているのが原因。/ 提案: `Phase` に `{ kind: "failed" }`（一時障害）を足し、`serialized.kind === "system" || serialized.kind === "unknown"` をそこへ振る。文言は `renderErrorMessage` の system 分岐を使い、導線は「もう一度試す」（再実行）にする。
- **[W-005]** サインアップの送信完了が告知もフォーカス移動もなく画面ごと差し替わる — 場所: `apps/web/app/components/auth/SignUpForm/index.tsx:127-145` / 理由: `state.done` で `<form>` を含むツリー全体を「確認メールを送信しました」に差し替えるが、live region ではないうえ、フォーカスがあった送信ボタンが unmount されてフォーカスが `<body>` へ落ちる。スクリーンリーダー利用者には「押したのに何も起きなかった」ように見える。AC-16 は「送信完了」を P-01 の状態として明示しており、VerifyEmailPanel（W-019 で常設 live region 化済み）と同じ扱いが必要なのに、こちらだけ取り残されている。/ 提案: 完了パネルの見出しに `tabIndex={-1}` + `useEffect` でのフォーカス移動を入れる（画面差し替え型の完了は live region より focus 移動が適切）。live region で済ませるなら W-001 と同じく常設コンテナ方式にする。
- **[W-006]** 文言辞書に「権限がありません」を明示する `NOTE_ACCESS_DENIED` があり、P-46 の「存在の有無・権限の有無を区別しない」に反する既製文言になっている — 場所: `apps/web/app/presentation/errorDisplay.ts:60`（`NOTE_ACCESS_DENIED: "このノートを開く権限がありません。"`）/ 理由: spec/pages/index.md:656 は P-46 の状態を「見つかりません / 権限なし（同一表示）」と定めており、`getNote`（`packages/core/src/application/note/getNote.ts:42-56`）も不在・他人の非公開・権限なしを `NOTE_NOT_FOUND` に収斂させている。一方 `NoteErrorCode.AccessDenied` は `noteAccessPolicy.ensureCanEdit` / `noteOwnershipPolicy` が実際に投げる code で、編集系ユースケースが載る次スライスで UI に到達し得る。そのとき辞書がすでに「権限がありません」を用意していると、収斂設計を迂回して権限の有無が文言から漏れる。辞書が「文言を決める唯一の場所」になった以上、そこに置く文言は仕様の非開示ポリシーと一致していなければならない。/ 提案: `NOTE_ACCESS_DENIED` のエントリを削除して `business` の共通文言へ倒すか、`NOTE_NOT_FOUND` と同一文字列にする。判断が要るなら「読み取り経路は収斂・編集経路は権限を明示してよい」を spec 側に書いてから辞書に戻す。
- **[W-007]** 辞書引きが `Object.prototype` を素通しし、型は `string` でも実体が関数になり得る — 場所: `apps/web/app/presentation/errorDisplay.ts:84-87`（`MESSAGE_BY_CODE[error.code]`）/ 理由: `MESSAGE_BY_CODE` は `Readonly<Record<string, string>>` のオブジェクトリテラルなので、`code` が `"constructor"` / `"toString"` / `"valueOf"` のとき `byCode` にプロトタイプ由来の関数が入り、`?? ` を素通りして関数が JSX 子として描画され「Functions are not valid as a React child」でページごと落ちる。現状 core が投げる code にこれらは無いが、`code` はサーバー由来の任意文字列として型付けされており、「型で不正状態を表現不能にする」（CLAUDE.md）に対して穴が空いたままである。境界で 1 行止められる。/ 提案: `Object.hasOwn(MESSAGE_BY_CODE, error.code) ? MESSAGE_BY_CODE[error.code] : undefined` にする（あるいは `Map` にする）。

## カバレッジ

変更ファイル一覧（`changed-files-r3.txt` 全 400 行）との対応。

- 確認（本ラウンドで精読）:
  - `apps/web/app/components/auth/**`（8 ファイル）— `SignInForm/{index.tsx,action.ts}`、`SignUpForm/{index.tsx,action.ts}`、`VerifyEmailPanel/{index.tsx,action.ts}`、`fieldValidation.ts`、`formStyles.ts`、`schema.ts`
  - `apps/web/app/components/layout/**`（6 ファイル）— `AccountMenu/{index.tsx,action.ts}`、`AppShell`、`AuthLayout`、`LegalPage`、`PublicShell`
  - `apps/web/app/components/note/**`（9 ファイル）— `CreateNoteButton/{index.tsx,action.ts}`、`NoteBody`、`NoteDetail/{index.tsx,action.ts}`、`NoteDetailSkeleton`、`NoteList/{index.tsx,action.ts}`、`NoteListSkeleton`
  - `apps/web/app/components/ui/**`（4 ファイル）— `Alert`、`BrandMark`、`ErrorState`、`Skeleton`。文脈確認で未変更の `Deferred` も参照
  - `apps/web/app/presentation/**`（12 ファイル）— `appServerErrorAdapter`、`auth`、`clientKey`、`errorDisplay`、`errorResponse`、`errorResponseMiddleware`、`pagination`、`redirect`、`serverErrorLog`、`serverFragment`、`session`、`validator` + `__tests__/{errorResponse,redirect}.test.ts`
  - `apps/web/app/routes/**`（10 ファイル）— `__root.tsx`、`index.tsx`、`signin.tsx`、`signup.tsx`、`verify-email.tsx`、`terms.tsx`、`privacy.tsx`、`notes/{index.tsx,$noteId.tsx,-action.tsx}`
  - `apps/web/app/styles/{index.css,theme.css,tokens.css}`（3 ファイル、diff とフォーカストークンの解決）
  - `docs/frontend_implementation_example.md`（W-010 該当行）
  - 未変更だが配線検証のため参照: `apps/web/app/router.tsx`、`apps/web/app/start.ts`
  - 検証コンテキスト（被レビュー物ではない）: `spec/pages/index.md`（P-46/P-47）、`spec/design/index.md` §9、`.thread/1/{plan.md,review/triage.md,review/review-002-frontend.md}`、`@tanstack/react-router@1.170.18`（`Match.js` / `CatchBoundary.js`）、`packages/core/src/{domain/identity/valueObject.ts,domain/note/errorCode.ts,domain/note/services/noteAccessPolicy.ts,domain/identity/errorCode.ts,application/identity/*.ts,application/note/{getNote,accessControl}.ts}`（UI に届く code の洗い出し）
- スキップ:
  - `.thread/1/**`（20 ファイル）— 本レビューの参照物であり被レビュー物ではない
  - `apps/web/app/components/todo/**`・`apps/web/app/routes/todo/**`（14 ファイル、全て D）— AC-14 の参照実装削除。削除内容の精読は不要
  - `apps/web/app/routeTree.gen.ts` — 自動生成物
  - `apps/web/app/server.*.ts`・`worker/**`・`scripts/**`・`vite.config.*`・`wrangler*`・`drizzle*.config.ts`・`Dockerfile.gcp`・`.env.example`（約 30 ファイル）— ランタイム配線（AC-14）でバックエンド観点の担当
  - `packages/core/src/**`（domain / application / adapters / conformance、約 200 ファイル）— ドメイン・ユースケース・アダプター観点の担当。上記「検証コンテキスト」に挙げたファイルのみ、UI に届く DTO と code の形を突き合わせる目的で参照
  - `infra/**`（約 30 ファイル、全て D）— インフラ削除、AC-14 の範囲
  - `.github/workflows/ci.yml`・`biome.json`・`package.json`（root / web / core）・`pnpm-lock.yaml`・`pnpm-workspace.yaml`・`vitest.config*.ts` — ビルド / CI 設定、統合ゲートの担当
  - `CLAUDE.md`・`README.md`・`docs/{backend_implementation_example,runtime_node,test}.md`・`docs/runtime_{aws,cloudflare,gcp}.md`（D）— バックエンド / テスト観点の担当（`frontend_implementation_example.md` のみ本観点で確認）

## 受け入れ基準の突合（AC-16〜19）

- **AC-16**: P-01 の項目エラー / 送信完了 / 全体エラー、P-02 の状態分離と相互導線、L-03 レイアウトを再確認。**視覚的には充足**。支援技術での成立は W-001（項目エラーが読まれない）・W-002（待機案内が読まれない）・W-005（送信完了が読まれない）で 3 状態が欠落。加えてメール検証の過剰厳格化が W-003。
- **AC-17**: `/verify-email` の GET 描画 → 自動 POST 消費 → Cookie → `/notes` 着地。reconcile の欠落は解消。**充足**。system 障害時の案内が誤りなのが W-004。
- **AC-18**: 「新規作成」→ 白紙ノート → 詳細（Shadow DOM・スケルトン・見つかりません）と作成後の一覧復帰。`invalidate` → `navigate` の順序と `try` 範囲の切り分けを再確認。**充足**。
- **AC-19**: P-46 / P-47。`__root.tsx`・`notes/*` は収斂しているが、`/` `/signin` `/signup` `/verify-email` は SSR 経路で共通表示に落ちない（B-001）。**未充足**。
- **streaming / Skeleton**: `/notes`・`/notes/$noteId` とも loader は `renderServerFragment(...)` の promise を await せず転送し、`Suspense + Deferred` が受ける。スケルトンは `role="status"` を内側の sr-only span へ移し `<main>` ランドマークを保っている（R2-FE-W-006 の該当分は解決）。**規律どおり**。
- **三層ミューテーション規律**: 一覧 membership を変える操作が無く、遷移で画面ごと入れ替わる形なので item-local `useOptimistic` の対象は無い。`useActionState` / `useTransition` の pending 表示が三層目を担う構成は妥当。
- **server fn の side-effect import**: `__root.tsx:19-23` に client island 経由の 5 つの action が全て列挙されている。**漏れなし**。
