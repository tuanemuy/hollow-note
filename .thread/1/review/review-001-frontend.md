# Review 001 — Frontend

対象: PR #12（issue/1/account-to-blank-note-skeleton, base: main）
観点: コンポーネント設計・状態管理・UX・ビューとロジックの切り分け
参照: CLAUDE.md Frontend 節 / spec/pages/index.md / spec/presentation/index.md / spec/design/pages/*.html / .thread/1/plan.md（AC-15〜19）/ .thread/1/adr.md（ADR-005/007/021/022/023/024）

### Frontend

#### Blockers

- **[B-001]** ミューテーション後の `router.invalidate()` が一箇所も呼ばれておらず、`staleTime: Number.POSITIVE_INFINITY`（本番）と組み合わさってキャッシュが恒久的に stale になる — 場所: `apps/web/app/components/note/CreateNoteButton/index.tsx:27-36`（作成後 navigate のみ）、`apps/web/app/components/layout/AccountMenu/index.tsx:40-49`（signOut 後 `router.history.push("/")` のみ）、`apps/web/app/components/auth/SignInForm/index.tsx:140-158`（サインイン後 `router.history.push(redirectTo)` のみ）、キャッシュ設定は `apps/web/app/routes/notes/index.tsx:15` / `apps/web/app/routes/notes/$noteId.tsx:13` / 理由:
  1. ノート作成 → 詳細 → 「ノート一覧」で戻ると、`/notes` の loader データ（RSC promise）は staleTime 無限で再取得されず、**作成したノートが一覧に出ない**（AC-18 の体験が本番ビルドで壊れる。dev は staleTime 0 なので手元検証では顕在化しない）。
  2. さらに悪い形として、サインアウト → 別アカウントでサインイン → `/notes` へ push しても同じ router インスタンスのキャッシュが fresh 扱いのまま残り、**前利用者のノート一覧 RSC ペイロードが表示されうる**（同一ブラウザ内とはいえ認可済みデータの越境表示）。
  CLAUDE.md は「Every mutation reconciles with `router.invalidate()`」を明記し、`routes/notes/index.tsx:13-14` のコメント自身も「鮮度は各ミューテーションの `router.invalidate()` が担う」と書いているが、担い手が存在しない。/ 提案: `CreateNoteButton` は navigate 前後で `router.invalidate()`（または `navigate` 後に invalidate）を呼ぶ。認証状態が変わる 2 箇所（signIn 成功・signOut 成功）は `router.invalidate()` で全 match を破棄してから遷移する（サインアウトはキャッシュ破棄の確実性を優先して `window.location` によるフル遷移でもよい）。

#### Warnings

- **[W-001]** サインインの「待機中（THROTTLED）」が状態モデルの外にいる — 場所: `apps/web/app/components/auth/SignInForm/index.tsx:69-76, 86-112, 126-138` / 理由: `Rejection` 直和に throttled 変種がなく、`classify` の戻り値が `Rejection | { waitSeconds }` という ad hoc 合併、実際の状態は `useActionState` の外の `useState(waitSeconds)` + interval に分散している。CLAUDE.md の「状態が直和型で組まれ不正な組み合わせが型で排除される」方針に対し、throttled × locked × rejection の同時成立が型で排除されていない（例: locked 中に別途 waitSeconds>0 が残ると両アラートの優先順位が暗黙）。また `waitSeconds` の parse 失敗時に 60 秒を**捏造**する fallback（`:98`）は `LoginThrottlePolicy` の値の写しに近い（fieldErrors 運搬自体は ADR-021 で確定済み。問題はクライアント側の補完値）。加えて locked は `unlockAt` 経過後も入力が disabled のままでリロードするまで復帰できない。/ 提案: `Phase = idle | throttled(until) | locked(unlockAt) | rejected(Rejection) | pending` の単一直和に畳み、カウントダウンは deadline からの導出にする。parse 失敗時は秒数なしの文言（「しばらく待って…」）へ縮退し数値を発明しない。
- **[W-002]** `NoteBody` の Shadow DOM 昇格 effect が React 管理下の DOM を直接改変・削除する — 場所: `apps/web/app/components/note/NoteBody/index.tsx:80-97` / 理由: ADR-023 の方式自体は確定済みだが、実装は (1) `template.remove()` で React がレンダーした子ノードを手で外し、以後 React の vDOM と実 DOM が乖離した前提で動く、(2) 2 回目以降のレンダーで `shadowRoot.innerHTML = shadowHtml` と `dangerouslySetInnerHTML`（detached template 側）の二重管理になる、(3) 将来 SSR/HTML パース経路（P-44/P-45 と同型を狙うとコメントにある）でハイドレーション対象の template がパーサーに消費済みで mismatch する余地がある。現スライスの Flight 経路では動くが、壊れ方が静かになる構造。/ 提案: template を DOM から外さず `<template>` は初回昇格後に state で描画から落とす（`useState` で promoted フラグ）か、昇格後は `hostRef` 配下を React の子なし（`<div ref>` のみ）にして shadowRoot だけを唯一の書き込み先にする。
- **[W-003]** `AccountMenu` が `role="menu"` / `role="menuitem"` を名乗りながらメニューのキーボード契約を持たない — 場所: `apps/web/app/components/layout/AccountMenu/index.tsx:53-92` / 理由: 開いてもフォーカスが移動せず、矢印キー移動・Home/End・閉時のトリガーへのフォーカス返却がない。ARIA menu ロールは支援技術に完全なキーボード操作を予告するため、実装なしのロール付与はロールなしより悪い。/ 提案: 項目が実質 1 つの現段階では `role="menu"` を外し disclosure（`aria-expanded` のみ）とするか、roving tabindex を実装する。
- **[W-004]** P-10 空状態からコマンドパレットの案内が欠落 — 場所: `apps/web/app/components/note/NoteList/index.tsx:96-107`（`EmptyState`） / 理由: spec/pages/index.md#P-10 は空状態を「コマンドパレットの使い方の案内を出す。初回サインイン後にパレットの存在を伝える唯一の場なので省略しない」と明記し、モック `P10-notes-empty.html` 状態 1 も専用ブロックを持つ。plan.md の期待値変更はアップロード導線の除外のみを記録しており、パレット案内の縮退は未記録（パレット本体が DS スライスなのは事実だが、AppShell はトリガーを disabled で出しており「存在を伝える」ことは可能）。/ 提案: 縮退として Issue コメントの見送り一覧に明記するか、disabled トリガーを指す最小の案内文を置くかを確定する。
- **[W-005]** `VerifyEmailPanel` の終端状態が支援技術に告知されない — 場所: `apps/web/app/components/auth/VerifyEmailPanel/index.tsx:707-766, 768-797` / 理由: `role="status"` は処理中のみで、成功・期限切れ・無効への遷移は aria-live 領域の外での DOM 差し替えになり、スクリーンリーダーには無音で画面が変わる（自動 POST → 自動遷移という操作を伴わないフローなので告知が唯一の手がかり）。/ 提案: 結果コンテナを常設の `aria-live="polite"` 領域にし、phase 遷移でその中身を差し替える。
- **[W-006]** 再試行が `<a href="">` — 場所: `apps/web/app/components/ui/ErrorState/index.tsx:86-98`（`RetryButton`） / 理由: 空 href は現在 URL への再ナビゲーションとしては動くが、リンクとしての遷移先を持たない操作をアンカーで表現しており（HTML 的にも validator 警告対象）、支援技術には「リンク: 再試行」と告知されて挙動が予測できない。ルーターに依存しない制約は `location.reload()` を呼ぶ `<button>` でも満たせる。/ 提案: `<button type="button" onClick={() => window.location.reload()}>` へ。

#### カバレッジ

変更一覧（`changed-files.txt` 全 376 行）との対応。フロントエンド観点の担当範囲を精読し、他レイヤーは担当外としてスキップ理由を記す。

- 確認（精読）:
  - `apps/web/app/components/auth/**`（SignInForm/SignUpForm/VerifyEmailPanel の index+action、formStyles.ts、schema.ts — 8 ファイル）
  - `apps/web/app/components/layout/**`（AppShell、AccountMenu index+action、AuthLayout、PublicShell、LegalPage — 6 ファイル）
  - `apps/web/app/components/note/**`（CreateNoteButton index+action、NoteBody、NoteDetail index+action、NoteDetailSkeleton、NoteList index+action、NoteListSkeleton — 9 ファイル）
  - `apps/web/app/components/ui/**`（Alert、BrandMark、ErrorState、Skeleton、Deferred、RoutePendingFallback — 変更分 4 + 文脈で既存 2）
  - `apps/web/app/presentation/**`（appServerErrorAdapter、auth、clientKey、errorResponse、errorResponseMiddleware、pagination、session、validator、serverAction、errorDisplay、head — 11 ファイル）
  - `apps/web/app/routes/**`（__root、index、signin、signup、verify-email、terms、privacy、notes/{index,$noteId,-action} — 10 ファイル）
  - `apps/web/app/styles/index.css`・`theme.css`（diff 精読）、`app/router.tsx`・`app/start.ts`（配線確認のため参照）
  - 検証コンテキスト: `spec/pages/index.md`、`spec/presentation/index.md`、`spec/design/pages/`（P01/P02/P03/P10-empty/P11/P46/P47 の構造・状態を抽出確認）、`.thread/1/plan.md`、`.thread/1/adr.md`（ADR-005/007/021/022/023/024）、`.thread/1/steps.md`（手順11）、`packages/core/src/application/note/view.ts`（DTO 形状の突合）
- スキップ:
  - `packages/core/src/domain/**`・`application/**`（view.ts 除く）・`adapters/**`（約 150 ファイル）— ドメイン/ユースケース/アダプターは別観点レビューの担当
  - `apps/web/app/routes/todo/**`・`components/todo/**`・`application/todo/**`・`domain/todo/**` の削除（D 行）— AC-14 で計画された参照実装の削除。削除内容の精読は不要
  - `apps/web/app/server.{aws,cloudflare,gcp}.ts`・`worker/**`・`scripts/**`・`vite.config.*`・`wrangler*`・`drizzle*`・`Dockerfile.gcp`・`.env.example` の削除/変更 — ランタイム配線（AC-14）でバックエンド観点の担当
  - `apps/web/app/server.node.ts`・`worker/node/runner.ts` — 同上（diff stat のみ確認）
  - `apps/web/app/routeTree.gen.ts` — 自動生成物
  - `apps/web/app/styles/tokens.css` — トークン値の羅列（diff stat 確認、theme.css 側でマッピングの整合を確認済み）
  - `infra/**`（aws/cloudflare/gcp 全削除 — 約 30 ファイル）— インフラ削除、AC-14 の範囲
  - `packages/core/src/adapters/{d1,libsql,aws,gcp,cloudflare}/**` の削除・`adapters/{memory,conformance}/**` の追加 — アダプター観点の担当
  - `.github/workflows/ci.yml`・`biome.json`・`package.json`（root/web/core）・`pnpm-lock.yaml`・`pnpm-workspace.yaml`・`vitest.config*` — ビルド/CI 設定、統合ゲートの担当
  - `docs/**` — ドキュメント更新（frontend_implementation_example.md は diff stat のみ。パターン記述の更新で実装の正は本レビューのコード側で確認）
  - `.thread/1/{adr,plan,progress,steps,testing}.md` — レビューの参照物であり被レビュー物ではない（adr/plan/steps は精読済み）

#### 受け入れ基準の突合（AC-15〜19）

- AC-15: Cookie 属性（HttpOnly/Lax/Path=/、dev のみ Secure 外し = plan 記載の縮退）と期限 = TTL 再導出（ADR-024）を `presentation/session.ts` で確認。401/429/410 マッピングは `errorResponse.ts` の kind/code 二段テーブルで spec/presentation の閉じたリストと一致。ミューテーションは全て JSON POST の server fn、FormData 経路なし、状態変更 GET なし（signOut も POST、verify-email も GET 描画 + POST 消費）。認証ガードは `requireAuthenticated` + `safeRedirectPath`（オープンリダイレクト対策確認）。**充足**。
- AC-16: P-01 の項目エラー（blur 検出・送信抑止）/ 送信完了 / 全体エラー、P-02 の共通文言・未確認・待機・ロックの状態分離、相互導線、L-03 レイアウトを確認。**充足**（状態モデルの組み方は W-001）。
- AC-17: verify-email リンク → 自動 POST 消費 → セッション Cookie → `/notes` 着地を確認。**充足**（告知は W-005）。
- AC-18: 一覧「新規作成」→ 白紙ノート → 詳細（Shadow DOM・スケルトン・見つかりません）を確認。ただし**作成後に一覧へ戻る経路が本番ビルドで壊れる**（B-001）。not-found はフラグメント内解決（NoteDetail の try/catch）とルート errorComponent の二段で NOTE_NOT_FOUND 収斂を維持。
- AC-19: P-46（存在/権限を区別しない共通表示・再試行・導線）と P-47（/terms /privacy）を確認。**充足**（再試行の実装形は W-006）。
- streaming/Skeleton 規律: `/notes`・`/notes/$noteId` とも loader が RSC promise を await せず転送し `Suspense + Deferred` が受ける形で、スケルトンは実 DOM を写している。route-level pending は `router.tsx` の defaultPendingComponent が既存のまま。**規律どおり**。
- server fn の side-effect import: `__root.tsx` に client-island 到達の 5 action すべて（SignUp/SignIn/VerifyEmail/AccountMenu/CreateNoteButton）が列挙されているのを確認。
