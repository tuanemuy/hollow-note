# Frontend

ゼロベースで実施。`git status` は（他観点のレビューファイル 1 件を除き）クリーンな状態で差分を確認した。

## Blockers

なし

## Warnings

- **[W-001]** ハンドルの可否ヒントの live region だけが `empty:hidden` で、空のときに DOM から消える（`display:none`）。/ 場所: `apps/web/app/components/settings/ProfileForm/editor.tsx:398` / 理由: 本リポジトリは `apps/web/app/components/settings/panelStyles.ts:32-34` に「空のときに消すと、後から入るテキストが読み上げられないため、余白だけを条件付きにする」と明文化しており、他の live region はすべて `not-empty:*`（余白だけを条件付き）で要素自体は常設している（`formStyles.ts:17` / `panelStyles.ts:34` / `board.tsx:328` / `ChangePasswordForm/index.tsx:136` / `DeleteAccountPanel/index.tsx:336` / `CreateNoteButton/index.tsx:84`）。ここだけが `:empty` で `display:none` に落ちるため、`display:none` → 可視への遷移を「内容の変化」ではなく「新規挿入」として扱う支援技術では「確認中... / このハンドルは使用できます / このハンドルは使われています」が読み上げられない。P-21 の「ハンドル重複（候補提示）」はキーボード操作中に非同期で出る唯一の合図なので、落ちると重複に気づけないまま保存まで進む。/ 提案: `className="empty:hidden"` を他と同じ `not-empty:mt-2` 相当（余白だけ条件付き・要素は常設）に揃える。中の `<span>` 側が持っている `mt-2` は親へ移す。

- **[W-002]** 未サインインで `/settings/danger` を開くと、退避 ticket の有無によらず必ず「アカウントを削除」フォームが描画される。/ 場所: `apps/web/app/routes/settings/route.tsx:30-32`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:148,181-192` / 理由: ticket の復元は `sessionStorage` を読む `useEffect` なので、SSR と初回描画では必ず `phase: "idle"` になる。結果として (1) 受理直後にリロードした当人は、進捗パネルに切り替わるまで削除フォーム（確認メール入力＋赤い実行ボタン）を一瞬見る、(2) ticket を持たない未サインインの訪問者には、そのフォームが出たまま残る。後者では `SettingsLayout` が `user === null` のとき `AppShell` もタブ列も描かないため、この画面から他所へ移る導線が 1 つも無く（`ghostButtonClass` の「トップページへ」は completed / settled 相当でしか出ない）、送信すると `requireSession()` の `UNAUTHENTICATED` が返るだけの行き止まりになる。破壊的操作の見た目を持つ入口として誤解を招く。/ 提案: `Phase` に `restoring` を 1 つ足して初期状態にし、復元 effect が走るまでフォームを出さない。復元できなかった場合は（未サインインのときだけ）`/signin` へ倒すか、最低限「サインインが必要です」＋サインイン導線の表示に切り替える。

## 確認した主な点（指摘に至らなかったもの）

- **三層規律**: 新規 7 画面の全ミューテーションが「server function → `"use client"` 島 → React 19 プリミティブ」を満たす。P-21 保存（`useActionState` + `isSaving`）、P-21 アイコン（`useTransition` + `useOptimistic`）、P-22 追加 / 解除（親 island 所有の `useOptimistic` + `useTransition`）、P-22 パスワード変更 / 他端末サインアウト（葉所有）、P-25 実行（`useActionState`）。
- **所有権**: リスト増減（追加 / 解除）は `IdentityBoard` が所有し、解除は葉に持たせていない。`AddPasswordForm` は入力と pending だけを持ち、`dispatchOptimistic` は親の `onAddPassword` が action の同期部分で呼ぶ（`await` 前なので transition スコープ内。React 19 の `useOptimistic` の要件を満たす）。`canRemove` を楽観リストから引き直しているのも正しい。
- **再整合**: すべてのミューテーションが `router.invalidate()` を通る。例外は P-25 のみで、理由（受理と同じ応答でセッションが失効するため再基底化するとローダーが落ちる）がコード JSDoc にある。
- **フォールバックの 2 種**: `/settings/{profile,auth,usage}` は loader が `renderServerFragment` の未解決 promise をそのまま転送し `<Suspense>` + 専用スケルトンで受ける。`/settings/danger` は読み出すサーバー状態が無いのでスケルトンを持たない。スケルトンは実 DOM（パネル数・行の grid・下部アクションバー）を写している。
- **見送り行の不出現**: `PAGE-p21-004`（公開プロフィール preview 導線）、`PAGE-p24-002`（workspace 行と追加読込）、`PAGE-p25-004`（唯一 owner の実行不可）はいずれも無効ボタン / placeholder すら描画していない。P-20 の「連携」タブも `SETTINGS_TABS` に無い。
- **入力バリデーション**: 転送境界は `validateSearch`（`/reset-password`・`/auth/callback/$provider`・`/dev/oauth/authorize`）と `inputValidator`（`routes/settings/-action.tsx` ほか）の 2 点のみ。上限は形と DoS だけで、業務不変条件（表示名 50 / 自己紹介 500 / ハンドル 3〜30 / 5 MB）は VO とドメインポリシー側に残している。`serverData` は `loadProfile` / `loadIdentities` / `loadUsageSnapshot` の 3 本とも `userId` を `requireSession()` 由来の値からしか受け取らず、外部入力を通していない。
- **`__root.tsx` の副作用 import**: `createServerFn` を持つモジュールを全数照合した（`components/auth/{ResendVerificationForm,ResetPasswordPanel,SignInForm,SignUpForm,VerifyEmailPanel}/action.ts`, `components/layout/AccountMenu/action.ts`, `components/note/CreateNoteButton/action.ts`, `routes/{auth,dev,settings}/-action.tsx`, `routes/notes/-action.tsx`, `presentation/{auth,redirect}.ts`, `__root.tsx` 自身）。`routes/notes/-action.tsx` はサーバー描画される `routes/notes/index.tsx` 経由、`presentation/devOAuth.ts` は純関数のみ（server fn は `routes/dev/-action.tsx` 側）で、漏れは無い。
- **ビューとロジックの切り分け**: 画面状態はすべて直和（`Phase` / `SaveState` / `SubmitError` / `HandleHint` / `RetryAction`）で持ち、境界デコード（`readStoredTicket` の `unknown` からの絞り込み、`extractSerializedError`）と純関数化（`passwordStrength.ts`, `presentation/devOAuth.ts`, `presentation/oauthStateBinding.ts`）が済んでいる。`passwordStrength` はドメインの `PlainPassword` と合否が一致することが `__tests__/passwordStrength.test.ts` で実効的に守られている（`score > 0 ⇔ PlainPassword.create` が通る）。
- **文言・アクセシビリティ**: エラー文言は `presentation/errorDisplay.ts` の辞書経由で、コンポーネント側にハードコードされた失敗文言は無い（`OAUTH_FLOW_INTERRUPTED_MESSAGE` も辞書からの再エクスポート）。UI が分岐に使うコード（`HANDLE_ALREADY_USED` / `IDENTITY_INVALID_HANDLE` / `IDENTITY_HANDLE_RESERVED` / `CONFIRMATION_MISMATCH` / `DELETION_TICKET_{INVALID,EXPIRED}` / `OAUTH_EMAIL_UNVERIFIED` / `AUTH_TOKEN_*`）は実際に投げられる値と一致している。ラベルと `htmlFor` / `aria-describedby` / `aria-invalid` の関連付け、結果パネル差し替え時の `tabIndex={-1}` + `focus()`、`<dialog>` の `showModal()` と送信中の `onCancel` 抑止も揃っている。
- **ハイドレーション**: 日時は `Intl.DateTimeFormat(..., { timeZone: "UTC" })` に固定（`IdentityList/board.tsx`, `UsagePanel`）。`crypto.randomUUID` / `sessionStorage` / `Date.now()` はいずれもクライアント専用の経路（effect・イベントハンドラー）に閉じている。`UsagePanel` の `formatResetDate` は `BillingPeriod.month` が 1 始まりなので `Date.UTC(year, month, 1)` が翌月 1 日になり、12 月でも年跨ぎが正しい。
- **デザイントークン**: 新規クラスはすべて `styles/tokens.css` / `theme.css` のトークン（`--color-*` / `--radius-pill` / `--list-max` / `--bar-bg` / `--text-md` / `--tracking-tightest`）経由。設定画面は `components/settings/panelStyles.ts` に recipe を集約している。モック P21 / P22 / P24 / P25 とパネル構成・見出し・メーターの形が一致する。

## カバレッジ

確認（62 件）:

- `.thread/2/plan.md`
- `apps/web/.env.example`
- `apps/web/app/components/auth/OAuthButton/index.tsx`
- `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`
- `apps/web/app/components/auth/PasswordStrengthMeter/index.tsx`
- `apps/web/app/components/auth/ResendVerificationForm/action.ts`
- `apps/web/app/components/auth/ResendVerificationForm/index.tsx`
- `apps/web/app/components/auth/ResetPasswordPanel/action.ts`
- `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`
- `apps/web/app/components/auth/SignInForm/action.ts`
- `apps/web/app/components/auth/SignInForm/index.tsx`
- `apps/web/app/components/auth/SignUpForm/action.ts`
- `apps/web/app/components/auth/SignUpForm/index.tsx`
- `apps/web/app/components/auth/VerifyEmailPanel/action.ts`
- `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`
- `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`
- `apps/web/app/components/auth/passwordStrength.ts`
- `apps/web/app/components/auth/schema.ts`
- `apps/web/app/components/dev/DevConsentForm/index.tsx`
- `apps/web/app/components/layout/AccountMenu/action.ts`
- `apps/web/app/components/layout/AccountMenu/index.tsx`
- `apps/web/app/components/layout/AppShell/index.tsx`
- `apps/web/app/components/layout/SettingsTabs/index.tsx`
- `apps/web/app/components/note/NoteBody/index.tsx`
- `apps/web/app/components/settings/AddPasswordForm/index.tsx`
- `apps/web/app/components/settings/ChangePasswordForm/index.tsx`
- `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`
- `apps/web/app/components/settings/IdentityList/action.ts`
- `apps/web/app/components/settings/IdentityList/board.tsx`
- `apps/web/app/components/settings/IdentityList/index.tsx`
- `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`
- `apps/web/app/components/settings/ProfileForm/action.ts`
- `apps/web/app/components/settings/ProfileForm/editor.tsx`
- `apps/web/app/components/settings/ProfileForm/index.tsx`
- `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`
- `apps/web/app/components/settings/UsagePanel/action.ts`
- `apps/web/app/components/settings/UsagePanel/index.tsx`
- `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`
- `apps/web/app/components/settings/panelStyles.ts`
- `apps/web/app/presentation/deletionTicket.ts`
- `apps/web/app/presentation/devOAuth.ts`
- `apps/web/app/presentation/errorDisplay.ts`
- `apps/web/app/presentation/oauthStateBinding.ts`
- `apps/web/app/presentation/oauthStateCookie.ts`
- `apps/web/app/presentation/session.ts`
- `apps/web/app/presentation/verificationSession.ts`
- `apps/web/app/routes/__root.tsx`
- `apps/web/app/routes/auth/-action.tsx`
- `apps/web/app/routes/auth/callback.$provider.tsx`
- `apps/web/app/routes/dev/-action.tsx`
- `apps/web/app/routes/dev/oauth/authorize.tsx`
- `apps/web/app/routes/notes/index.tsx`
- `apps/web/app/routes/reset-password.tsx`
- `apps/web/app/routes/settings/-action.tsx`
- `apps/web/app/routes/settings/auth.tsx`
- `apps/web/app/routes/settings/danger.tsx`
- `apps/web/app/routes/settings/index.tsx`
- `apps/web/app/routes/settings/profile.tsx`
- `apps/web/app/routes/settings/route.tsx`
- `apps/web/app/routes/settings/usage.tsx`
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/verify-email.tsx`

スキップ（232 件）:

- `.thread/2/adr.md`, `.thread/2/progress.md`, `.thread/2/steps.md`, `.thread/2/testing.md`, `.thread/2/review/review-00{1..6}-*.md`（30 件）, `.thread/2/review/triage.md` — 計 36 件。指示によりゼロベースで実施するため過去ラウンドのレビュー記録は読まない。計画の契約は `plan.md` だけを正典とした。
- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`, `apps/web/app/presentation/__tests__/devOAuth.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts` — 4 件。署名・束縛の検証内容は Security / Test 観点の担当。対応する実装（`deletionTicket.ts` / `devOAuth.ts` / `oauthStateBinding.ts` / `oauthStateCookie.ts`）は画面が依存する挙動の範囲で確認済み。
- `apps/web/app/routeTree.gen.ts` — 1 件。生成物（新規ルートの登録内容は各ルートファイル側で確認）。
- `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `apps/web/scripts/listen.node.ts` — 4 件。ランタイム配線・ワーカーで、Adapter / Test 観点の担当。
- `docs/runtime_node.md`, `docs/test.md` — 2 件。ドキュメント。
- `packages/core/src/**`（184 件）— ドメイン / ユースケース / アダプター層で、Domain-Usecase / Adapter 観点の担当。ただし画面が依存する契約の整合確認のため、`application/identity/{updateProfile,listIdentities,resetPassword}.ts`, `application/usage/view.ts`, `domain/usage/valueObject.ts`, `domain/identity/{errorCode.ts,services/identityPolicy.ts}`, `domain/storage/errorCode.ts` は参照した（レビューはしていない）。
- `vitest.config.ts` — 1 件。テスト実行設定で Test 観点の担当（`apps/web` に DOM 環境が無く、コンポーネントの単体テストが構造的に置けない点は本 Issue 以前からの前提）。
