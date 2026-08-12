# レビュー 003 — Frontend

## Frontend

### Blockers

なし

### Warnings

- **[W-001]** `FormData` を受ける server function に `Origin` 検証が無い
  - 場所: `apps/web/app/routes/settings/-action.tsx:167`（`uploadAvatarFn` の `.validator(...)` は 169〜173 行）
  - 理由: `spec/presentation/index.md`「CSRF > 規約」は「**`FormData` を受けるサーバー関数を作る場合は `Origin` ヘッダーの検証を必須とする**」と定めている。根拠は「JSON POST は他サイトの `<form>` から到達できないが、`FormData` を受ける経路だけは到達しうる唯一の入口になる」ことで、同じ節は `SameSite=Lax` を「ブラウザーの既定の振る舞いであって本サービスが与えた保証ではない」ため単独の防御にしないと明記している。`uploadAvatarFn` はリポジトリ内で初めて `FormData` を受ける server function だが、`errorResponseMiddleware` にもハンドラーにも `Origin` の照合が無い。TanStack Start 側の受け口（`@tanstack/start-server-core` の `handleServerAction`）は `Content-Type` が `multipart/form-data` / `application/x-www-form-urlencoded` のとき `x-tsr-serverFn` などのヘッダーを要求せずに `request.formData()` を `data` としてハンドラーへ渡すので、クロスサイトの `<form enctype="multipart/form-data" action="/_serverFn/…">` はこのハンドラー本体に到達する。現状は `requireSession()` が `SameSite=Lax` により Cookie を得られず 401 に倒れるため実被害は観測できないが、spec が「SameSite に頼らない検証をその経路自身が持つ必要がある」としている形になっていない。
  - 提案: `uploadAvatarFn` のハンドラー冒頭（または専用ミドルウェア）で `getRequestHeader("origin")` を `container.config.appUrl` のオリジンと照合し、不一致・欠落は拒否する。判定は `presentation/devOAuth.ts` の `resolveDevRedirectUri` と同じく純関数へ切り出せば単体テストで守れる。以後 `FormData` を受ける入口が増えたときに同じ規約を再発明しないよう、ミドルウェア化が望ましい。

- **[W-002]** ハンドル保存エラーが欄に貼り付いたままになり、提示された候補を選んでも「使われています」+ `aria-invalid` が残る
  - 場所: `apps/web/app/components/settings/ProfileForm/editor.tsx:244`（`handleProblem` の導出は 244〜250 行、候補ボタンは 400〜413 行）
  - 理由: `handleProblem` は `saveFailure`（`useActionState` の結果）を最優先で読み、`saveFailure` は次の submit まで更新されない。`HANDLE_ALREADY_USED` で保存に失敗すると `suggestionsFor(handle)` の候補チップが出るが、その候補を押して `setHandle(suggestion)` した直後も `handleProblem` は前回の失敗文言を返し続けるため、`checkHandleAvailabilityFn` が「使用できます」を返していてもそれが表示されず、入力欄には `aria-invalid="true"` と赤枠が残る。P-21 の「ハンドル重複（候補提示）」は候補を選ばせることが目的の状態なので、その一手を打った直後に画面が「まだ使われている」と言い続けるのは状態モデルの取り違えになっている（`fieldErrorClass` が支援技術にも `invalid` を伝えるため、視覚以外にも影響する）。
  - 提案: `handle` が「保存に失敗したときの値」から変わったら `saveFailure` を無効化する。例えば `SaveError` に `handle: string`（失敗した値）を持たせ、`handleProblem` の判定を `saveFailure.handle === handle` の条件付きにする（`saveErrorFor` は既に `nextHandle` を受け取っているので追加のデータは要らない）。同じ扱いで `suggestions` も現在値と一致しなくなった時点で畳むと、候補チップが古い入力に対して残らない。

- **[W-003]** `IdentityListSkeleton` の「パスワードを変更」パネルが実 DOM より 1 フィールド分以上短く、フラグメント差し替え時に縦方向のシフトが出る
  - 場所: `apps/web/app/components/settings/IdentityListSkeleton/index.tsx:37`（2 枚目の `<section>`、37〜43 行）
  - 理由: 実際の `ChangePasswordForm` は「現在のパスワード / 新しいパスワード / もう一度入力」の 3 フィールド（各 `label` + `h-11` 入力 + `mb-5`）に加えて、入力が始まると `PasswordStrengthMeter` の 4 本バー + 文言が挟まる。スケルトンは `h-11` を 2 本しか置かずラベル分の高さも持たないので、`/settings/auth` の初期表示ではスケルトンからの差し替え時にこのパネルが 150px 前後伸びる。ドキュメンテーションコメントは「`IdentityList` の DOM（3 パネルと 2 行）を写して、差し替え時のレイアウトシフトを防ぐ」と宣言しているので、実装がその宣言を満たしていない。
  - 提案: 2 枚目のパネルを「ラベル(`h-4`) + 入力(`h-11`)」×3 + ボタンの形に揃える。`ProfileFormSkeleton` は同じ要領（`h-4` ラベル → `h-11` 入力）で書けているので、そちらに合わせるだけで済む。

### 確認できた点（記録）

- **三層規律**: 新設 7 画面すべてで `server component → "use client" 島 → React 19 プリミティブ` が成立している。`<form action={serverFn}>` の直結は 1 件も無く、P-21 保存 / P-22 追加・変更 / P-25 実行 / P-03 再送 / P-04 申請・実行 / P-05 再試行 / dev 同意はいずれも `useActionState`（または `useTransition`）で pending と失敗表示を持つ。
- **所有権**: P-22 のリスト増減（追加 / 解除）は `IdentityList/board.tsx` の親島が `useOptimistic` と server function ごと所有し、解除は葉ではなく親で走る（`onRemove`）。パスワード変更・他端末サインアウトはリストを変えないので葉が持つ。`canRemove` を楽観リストから引き直しているのも正しい。
- **`router.invalidate()`**: 保存 / アイコン差し替え / 削除 / 追加 / パスワード変更 / 再設定成功 / OAuth コールバック成功のすべてで再整合している。P-25 だけが意図的な例外で、その理由（受理でセッションが失効するので再基底化すると進捗表示ごと落ちる）がコメントに残っている。
- **ローディングフォールバック**: `/settings/{profile,auth,usage}` は fragment ストリーミング（`Suspense` + `Deferred`）、`/settings/danger` は読み出すサーバー状態を持たないので島を直描き。役割の混線は無い。
- **見送り行**: `PAGE-p21-004`（公開プロフィール preview）/ `PAGE-p24-002`（workspace 追加読込）/ `PAGE-p25-004`（唯一 owner）はいずれも対応要素・無効ボタンの placeholder ともに出ていない。P-20 の「連携」タブも `SETTINGS_TABS` に無く、無効タブも置いていない。
- **入力バリデーション**: 転送境界は `validateSearch`（`verify-email` / `reset-password` / `auth/callback/$provider` / `dev/oauth/authorize`）と `.validator(validateInput(...))` の 2 点のみ。`serverData`（`ProfileForm` / `IdentityList` / `UsagePanel` の `action.ts`）は外部入力を通していない（引数は `requireSession()` が返す `userId` だけ）。
- **`__root.tsx` の副作用 import**: 新設の server function モジュール 5 本（`routes/settings/-action` / `routes/auth/-action` / `routes/dev/-action` / `ResendVerificationForm/action` / `ResetPasswordPanel/action`）はすべて登録済み。`serverData` の 3 本は server function ではないので登録不要。
- **文言と辞書**: UI に出るサーバー由来の失敗はすべて `displayError` / `renderErrorMessage` を通る。`ProfileEditor` の `OVERSIZE_MESSAGE` も辞書から引いており、しきい値は `AVATAR_MAX_BYTES`（ドメイン）から導出している。
- **ハイドレーション**: `Intl.DateTimeFormat` は `IdentityBoard`（`timeZone: "UTC"`）と `UsagePanel`（同）で明示。`UsagePanel` の `formatResetDate` は `BillingPeriod.month` が 1 始まりなので `Date.UTC(year, month, 1)` が翌月 1 日（= リセット日）になり、12 月も年跨ぎで正しい。`ResendVerificationForm` の `Date.now()` 初期値は `sent` 相以外では描画に出ないので不一致にならない。
- **デザイントークン**: 新規クラスはすべて `styles/theme.css` 経由のトークン（`text-ink-tertiary` / `bg-surface` / `rounded-pill` / `shadow-xs` ほか）か `var(--bar-bg)` / `var(--list-max)` の直参照で、素の色リテラルはアバター既定のグラデーション 2 色のみ（`AccountMenu` の既存実装と共有）。
- **残す必要のない記述**: コード・コメントにレビュー経緯や弁明の残骸は無し（`grep` で確認）。

### カバレッジ

- 確認: `apps/web/app/components/auth/OAuthButton/index.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `apps/web/app/components/auth/PasswordStrengthMeter/index.tsx`, `apps/web/app/components/auth/ResendVerificationForm/action.ts`, `apps/web/app/components/auth/ResendVerificationForm/index.tsx`, `apps/web/app/components/auth/ResetPasswordPanel/action.ts`, `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`, `apps/web/app/components/auth/SignInForm/action.ts`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/components/auth/SignUpForm/action.ts`, `apps/web/app/components/auth/SignUpForm/index.tsx`, `apps/web/app/components/auth/VerifyEmailPanel/action.ts`, `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`, `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`, `apps/web/app/components/auth/passwordStrength.ts`, `apps/web/app/components/auth/schema.ts`, `apps/web/app/components/dev/DevConsentForm/index.tsx`, `apps/web/app/components/layout/AccountMenu/action.ts`, `apps/web/app/components/layout/AccountMenu/index.tsx`, `apps/web/app/components/layout/AppShell/index.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`, `apps/web/app/components/note/NoteBody/index.tsx`, `apps/web/app/components/settings/AddPasswordForm/index.tsx`, `apps/web/app/components/settings/ChangePasswordForm/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/settings/IdentityList/action.ts`, `apps/web/app/components/settings/IdentityList/board.tsx`, `apps/web/app/components/settings/IdentityList/index.tsx`, `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/components/settings/ProfileForm/editor.tsx`, `apps/web/app/components/settings/ProfileForm/index.tsx`, `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`, `apps/web/app/components/settings/UsagePanel/action.ts`, `apps/web/app/components/settings/UsagePanel/index.tsx`, `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`, `apps/web/app/components/settings/panelStyles.ts`, `apps/web/app/presentation/__tests__/deletionTicket.test.ts`, `apps/web/app/presentation/__tests__/devOAuth.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/deletionTicket.ts`, `apps/web/app/presentation/devOAuth.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/presentation/oauthStateBinding.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/verificationSession.ts`, `apps/web/app/routeTree.gen.ts`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/reset-password.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/auth.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/routes/settings/index.tsx`, `apps/web/app/routes/settings/profile.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/settings/usage.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/routes/verify-email.tsx`（65 件）
- スキップ: `.thread/2/**`（17 件）— 計画・ADR・過去レビュー記録で実装コードではない
- スキップ: `apps/web/.env.example`（1 件）— 配備設定であり画面の挙動に関わらない
- スキップ: `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `apps/web/scripts/listen.node.ts`, `docs/runtime_node.md`, `docs/test.md`（6 件）— ランタイム entry / ワーカー / 運用ドキュメントで Adapter・Test 観点の担当
- スキップ: `packages/core/src/**`（184 件、リスト 90〜273 行）— ドメイン / ユースケース / アダプター / ポート / 適合テストで Domain-Usecase・Adapter・Test 観点の担当（`application/usage/view.ts` と `domain/usage/valueObject.ts` は P-24 の表示検証のため参照のみ行い、レビュー対象としては計上しない）
- スキップ: `vitest.config.ts`（1 件）— テスト実行設定で Test 観点の担当

合計: 確認 65 + スキップ 209 = 274。
