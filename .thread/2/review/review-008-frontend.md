# レビュー 008 — Frontend

対象 PR: #17（`issue/2/account-management-and-auth`） / ベース: `main`
契約: `.thread/2/plan.md`（受け入れ基準 AC-1..33、見送り 89 行、縮退一覧）
方式: ゼロベース。`git status` クリーンを確認したうえで `git diff --no-renames origin/main...HEAD` と作業ツリーの実ファイルを読む（実装の書き換えは行っていない）。

## Frontend

### Blockers

なし

### Warnings

- **[W-001]** P-22 の「解除」二段確認で、確認 UI の出現がフォーカスにも支援技術にも伝わらない / 場所: `apps/web/app/components/settings/IdentityList/board.tsx:255-284`（`onConfirm` は `:156`、`LAST_METHOD_HINT_ID` の live region は `:198`） / 理由: 「解除」ボタンは `confirming ? <解除する/やめる> : <解除>` の三項で**要素ごと差し替わる**ため、押した瞬間にフォーカスされていた `<button>` がアンマウントし、フォーカスは `document.body` へ落ちる。行内には live region が無く（常設の `role="status"` はパネル末尾の `listError` 専用で、確認 UI の出現はそこに載らない）、キーボード / スクリーンリーダー利用者は「破壊的操作の確認が出た」ことを知覚できず、Tab をページ先頭から踏み直すことになる。同じ PR 内の `DeletionProgress`（`DeleteAccountPanel/index.tsx:368`）と `Result`（`ResetPasswordPanel/index.tsx:335`）は「パネルが差し替わるときは焦点も移す」を明示的に実装しており、破壊性がより高いこの経路だけ規律から外れている。加えて `spec/design/index.md#3.10` はダイアログを使ってよい場面として**削除確認**を挙げている（P-22 の状態一覧にも「解除確認」がある）のに対し、実装は削除確認をインライン差し替えにし、逆にリストに無い「パスワード追加」を `<dialog>`（`AddPasswordForm`）にしていて、規律の当てはめが反転している / 提案: 確認 UI を出したら「解除する」ボタンへ `ref.current?.focus()` で焦点を移す（`DeletionProgress` と同じ形）。あわせて「やめる」で元の「解除」ボタンへ焦点を戻すか、`AddPasswordForm` と同じ `<dialog showModal()>` に寄せて §3.10 の割り当て（削除確認＝ダイアログ）に揃える。

- **[W-002]** P-25 で受理済みの削除が `sessionStorage` の可用性に巻き込まれ、「受理されたのに失敗表示」で詰む / 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:165-172`（`sessionStorage.setItem` が `try` の内側かつ `setPhase` より前）、`:67-68`（`readStoredTicket` の `sessionStorage.getItem` が無防備） / 理由: サイト データを遮断した設定（Chrome/Edge の「Cookie とサイト データをブロック」、Firefox の `dom.storage.enabled=false`、制限付き sandbox 内など）では `sessionStorage` へのアクセス自体が `SecurityError` を投げる。(1) 提出経路: `requestDeletion` が 202 を返し**サーバー側では削除が受理されセッション Cookie も破棄された後**に `setItem` が投げると、`catch` が拾って `{ error: submitError(error) }` を返すため `setPhase({kind:"accepted"})` に到達しない。画面は削除フォームのまま「うまく処理できませんでした」を出し、再送しても同一 `requestId` の resume がまた同じ `setItem` で落ちるので、利用者は**取り消せない削除が走っていることを一度も知らされないままサインアウトされる**。(2) 復元経路: `readStoredTicket` は effect 内で `getItem` を素で呼ぶので、同じ環境では effect が例外を投げ、`/settings/danger` の `errorComponent`（`routes/settings/danger.tsx:25`）が `ServerErrorState` に倒れて**削除フォームにすら到達できない**。ticket の保持がクライアント責務であること自体は ADR-006 の決着済み設計だが、「保持に失敗したら受理そのものを失敗として見せる」という順序は設計判断ではなく実装順の副作用に見える / 提案: `setPhase({ kind: "accepted", ticket })` を先に行い、`sessionStorage.setItem` はその後に `try { … } catch { /* 進捗はこのタブのメモリで追う */ }` で包む（保持できなくてもリロードするまでは追える）。`readStoredTicket` も同様に `try/catch` で `null` に倒す。

### カバレッジ

**確認（62 件）**

`apps/web/.env.example`,
`apps/web/app/components/auth/OAuthButton/index.tsx`,
`apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`,
`apps/web/app/components/auth/PasswordStrengthMeter/index.tsx`,
`apps/web/app/components/auth/ResendVerificationForm/action.ts`,
`apps/web/app/components/auth/ResendVerificationForm/index.tsx`,
`apps/web/app/components/auth/ResetPasswordPanel/action.ts`,
`apps/web/app/components/auth/ResetPasswordPanel/index.tsx`,
`apps/web/app/components/auth/SignInForm/action.ts`,
`apps/web/app/components/auth/SignInForm/index.tsx`,
`apps/web/app/components/auth/SignUpForm/action.ts`,
`apps/web/app/components/auth/SignUpForm/index.tsx`,
`apps/web/app/components/auth/VerifyEmailPanel/action.ts`,
`apps/web/app/components/auth/VerifyEmailPanel/index.tsx`,
`apps/web/app/components/auth/__tests__/passwordStrength.test.ts`,
`apps/web/app/components/auth/passwordStrength.ts`,
`apps/web/app/components/auth/schema.ts`,
`apps/web/app/components/dev/DevConsentForm/index.tsx`,
`apps/web/app/components/layout/AccountMenu/action.ts`,
`apps/web/app/components/layout/AccountMenu/index.tsx`,
`apps/web/app/components/layout/AppShell/index.tsx`,
`apps/web/app/components/layout/SettingsTabs/index.tsx`,
`apps/web/app/components/note/NoteBody/index.tsx`,
`apps/web/app/components/settings/AddPasswordForm/index.tsx`,
`apps/web/app/components/settings/ChangePasswordForm/index.tsx`,
`apps/web/app/components/settings/DeleteAccountPanel/index.tsx`,
`apps/web/app/components/settings/IdentityList/action.ts`,
`apps/web/app/components/settings/IdentityList/board.tsx`,
`apps/web/app/components/settings/IdentityList/index.tsx`,
`apps/web/app/components/settings/IdentityListSkeleton/index.tsx`,
`apps/web/app/components/settings/ProfileForm/action.ts`,
`apps/web/app/components/settings/ProfileForm/editor.tsx`,
`apps/web/app/components/settings/ProfileForm/index.tsx`,
`apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`,
`apps/web/app/components/settings/UsagePanel/action.ts`,
`apps/web/app/components/settings/UsagePanel/index.tsx`,
`apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`,
`apps/web/app/components/settings/panelStyles.ts`,
`apps/web/app/presentation/deletionTicket.ts`,
`apps/web/app/presentation/devOAuth.ts`,
`apps/web/app/presentation/errorDisplay.ts`,
`apps/web/app/presentation/oauthStateBinding.ts`,
`apps/web/app/presentation/oauthStateCookie.ts`,
`apps/web/app/presentation/session.ts`,
`apps/web/app/presentation/verificationSession.ts`,
`apps/web/app/routeTree.gen.ts`,
`apps/web/app/routes/__root.tsx`,
`apps/web/app/routes/auth/-action.tsx`,
`apps/web/app/routes/auth/callback.$provider.tsx`,
`apps/web/app/routes/dev/-action.tsx`,
`apps/web/app/routes/dev/oauth/authorize.tsx`,
`apps/web/app/routes/notes/index.tsx`,
`apps/web/app/routes/reset-password.tsx`,
`apps/web/app/routes/settings/-action.tsx`,
`apps/web/app/routes/settings/auth.tsx`,
`apps/web/app/routes/settings/danger.tsx`,
`apps/web/app/routes/settings/index.tsx`,
`apps/web/app/routes/settings/profile.tsx`,
`apps/web/app/routes/settings/route.tsx`,
`apps/web/app/routes/settings/usage.tsx`,
`apps/web/app/routes/storage.$.tsx`,
`apps/web/app/routes/verify-email.tsx`

**スキップ（237 件）**

- `.thread/2/**`（42 件: `adr.md` / `plan.md` / `progress.md` / `steps.md` / `testing.md` / `triage.md` / `review/review-00*-*.md` 35 件）— レビュー成果物・計画文書。ゼロベース指示により過去レビューは読まず、`plan.md` / `progress.md` / `adr.md` のみ「決着済みの事実」として参照した（レビュー対象コードではない）。
- `packages/core/src/application/**`（108 件）— identity / storage / usage のユースケース、ポート、DI、worker、テスト。Domain-Usecase / Adapter / Test 観点の担当。フロントエンドからは DTO（`identity/view.ts`、`usage/view.ts`、`storage/view.ts`）とエラーコードの整合確認のためだけに参照した。
- `packages/core/src/adapters/**`（43 件）— memory / oauth アダプターと適合スイート。Adapter 観点の担当。`memory/objectStorage.ts` の `publicUrl` 形式のみ P-21 の 2 段保存の裏取りに参照。
- `packages/core/src/domain/**`（33 件）— identity / storage / usage / note のエンティティ・VO・ポリシー。Domain 観点の担当。`identity/errorCode.ts` / `identity/valueObject.ts`（`DisplayName` / `AvatarUrl`）/ `storage/errorCode.ts` / `usage/valueObject.ts`（`BillingPeriod`）/ `identity/services/identityPolicy.ts` は文言辞書と UI 判定の突合のためだけに参照。
- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`, `…/devOAuth.test.ts`, `…/oauthStateBinding.test.ts`, `…/oauthStateBindingWiring.test.ts`（4 件）— Test 観点の担当。対応する実装モジュール側は確認済み。
- `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `apps/web/scripts/listen.node.ts`（4 件）— ランタイム起動・ワーカー配線。Adapter / 起動配線観点の担当で、画面の描画経路に関与しない。
- `docs/runtime_node.md`, `docs/test.md`（2 件）— 運用ドキュメント。
- `vitest.config.ts`（1 件）— テスト実行設定。

62 + 237 = 299。

### 確認したが指摘に至らなかった点（記録）

- **三層規律 / 所有権**: P-21 は `useActionState`（保存）＋ `useOptimistic`（アイコン）＋ `useTransition`、P-22 は増減（追加・解除）を親島 `IdentityBoard` が `useOptimistic` ごと所有し、解除は親で実行、変更しないもの（パスワード変更・他端末サインアウト）は葉が自分で持つ。CLAUDE.md の規則どおり。
- **再整合**: `updateProfile` / アイコン保存・削除 / `addPassword` / `changePassword` / `removeIdentity` / `signOutOtherSessions` / `resetPassword` / OAuth コールバックはすべて `router.invalidate()` を通す。P-25 だけが意図的な例外で、その理由がコメントに残っている。
- **ローディング**: `/settings/{profile,auth,usage}` は loader が `renderServerFragment` の未解決 promise を転送し `<Suspense fallback={…Skeleton}>` で受ける per-fragment streaming、`/settings` の `beforeLoad`（セッション確認）だけがブロックしてルート pending に落ちる、という 2 種の使い分けができている。3 つのスケルトンは実 DOM のパネル数・行数・要素高さを写している。
- **バリデーション 2 点**: `/settings/-action.tsx` の各 `validator` は形と DoS 上限のみ（表示名 50・自己紹介 500・ハンドル 3〜30 の業務不変条件は VO 側）。`serverData` 経由の `loadIdentities` / `loadProfile` / `loadUsageSnapshot` はいずれも `requireSession()` 由来の `userId` しか受けておらず、転送境界の値は流れていない。
- **`__root.tsx` の副作用 import**: `createServerFn` を定義する 10 モジュールすべて（新設 5 本を含む）が並んでおり、`routeTree.gen.ts` にも `-action` が混入していない。
- **文言・アクセシビリティ**: 表示文言はすべて `presentation/errorDisplay` の辞書経由（`OAUTH_FLOW_INTERRUPTED_MESSAGE` も辞書と同一値を共有）。ラベルは `useId` で `htmlFor`/`id` 対応、エラーは `aria-describedby` + `aria-invalid`、live region は常設で空文字だけが入れ替わる形（`errorTextClass` の `not-empty:mt-2`）。日付は `Intl.DateTimeFormat` の `timeZone: "UTC"` 固定でハイドレーション不一致を避けている。`ResendVerificationForm` は呼び出し元の live region と二重にならないよう自前の live region を持たない。
- **デザイントークン**: `panelStyles.ts` / 各画面のクラスは `styles/tokens.css` の変数由来（`--color-*` / `--radius-pill` / `--list-max` / `--bar-bg` / `--text-md`）で、生値の直書きはアバターのプレースホルダー階調のみ（モック P21 と同値）。
- **見送り行の非表示**: `PAGE-p21-004`（公開プロフィール preview）/ `PAGE-p24-002`（workspace 使用量の追加読込）/ `PAGE-p25-004`（唯一 owner の実行不可）は、対応要素も無効ボタンの placeholder も UI に出ていない。P-20 タブ列も「連携」を含まない 4 タブ（縮退どおり）。
- **決着済みとして再指摘しない**: ADR-062 / ADR-085（未サインインでも P-25 が開く／復元前の初回描画は idle）、ADR-105（P-25 の説明文が participant 実態に合わせてモックより狭い）。
- **テストによる担保**: 本 PR のフロントエンド側で自動テストが付いているのは純関数・presentation モジュール（`passwordStrength` / `deletionTicket` / `devOAuth` / `oauthStateBinding`）に限られ、コンポーネントテストは無い（vitest は `environment: "node"` 単一で jsdom 環境を持たない）。これは `plan.md`「テスト方針」のプレゼンテーションテストの範囲と一致するため指摘としない。上記 W-001 / W-002 は、その結果として自動テストの守備範囲外に落ちている挙動でもある。
- **コード内の残置記述**: 変更されたフロントエンドのファイルに TODO / FIXME / レビュー経緯・弁明のコメントは無い。
