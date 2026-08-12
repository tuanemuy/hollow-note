# レビュー R10 — Frontend

対象: PR #17 / ブランチ `issue/2/account-management-and-auth`（`git status` クリーンを確認のうえ、`git diff --no-renames origin/main...HEAD` と作業ツリーの実ファイルで確認）。

## Frontend

### Blockers

なし

### Warnings

- **[W-001]** P-02 の未確認アラートに置いた再送フォームが、失敗を起こしたアドレスではなく**入力欄の現在値**に束縛されている / 場所: `apps/web/app/components/auth/SignInForm/index.tsx:192,351`（`PhaseAlert` へ `email={email}` を渡し、`unverified` アームが `<ResendVerificationForm email={email} variant="compact" />` を描く） / 理由: `phase` は `useActionState` の結果なので次の送信まで残るが、`email` は `useState` の生の入力値（`:119,207`）で、失敗後に利用者がアドレスを打ち替えるとアラートは「メールアドレスの確認が済んでいません」を出したまま、再送ボタンだけが**打ち替え後のアドレス**へ飛ぶ。応答は列挙耐性のため全経路同一（「確認メールを送りました」）なので、利用者は宛先が変わったことに気づけず、意図した account には何も届かない。判断の材料（どのアドレスで失敗したか）を状態に持たず毎描画で読み直している点は、`ProfileForm/editor.tsx` の `SaveError.handle`（ADR-102）で既に採っている「判断の対象を結果と対で持つ」規律の裏返しでもある。 / 提案: `Phase` の `unverified` アームに `email` を載せて（`{ kind: "unverified"; email: string }`）、`PhaseAlert` はそれを描くだけにする。`waitSeconds` / `unlockAt` を既にアームに載せているのと同じ形。

- **[W-002]** `IdentityBoard` の成功通知が、直前の失敗表示を消さずに重なる / 場所: `apps/web/app/components/settings/IdentityList/board.tsx:131-140`（`onAddPassword`） / 理由: `onRemove`（`:122`）と `onLinkGoogle`（`:153`）は成功時に `setListError(null)` を通すが、`onAddPassword` は `setNotice(null)` しか呼ばない。解除に失敗して `listError` が出ている状態からパスワードを追加すると、同じパネルの下に「解除に失敗しました」と「パスワードを追加しました。…」が同時に残る。`listError` / `notice` が独立した 2 つの `useState` で、実際には排他な 1 つの結果であることが型に出ていないのが原因。 / 提案: 2 つを `type ListOutcome = { kind: "idle" } | { kind: "ok"; message: string } | { kind: "error"; message: string }` の直和 1 本に畳み、`setOutcome` の 1 呼び出しで必ず前の結果を置き換える。live region は今と同じく 2 つ常設のままでよい（`role="status"` の枠は残し、中身だけを直和から出し分ける）。

### 確認した主な観点

- **三層規律 / 所有権**: リスト増減（追加・解除）は親島 `IdentityBoard` が `useOptimistic` ごと所有し、`removeIdentityFn` も親が実行している（葉に持たせていない）。`ChangePasswordForm` / `SignOutOthersPanel` は増減を起こさない葉として自分の server function と pending を持つ。`ProfileEditor` は保存を `useActionState`、アイコンを `useOptimistic` + `useTransition` で分けている。`AddPasswordForm` は入力と表示だけを持ち、送信と楽観追加は親に残している。
- **`router.invalidate()` の再整合**: `removeIdentity` / `addPassword` / `changePassword` / `signOutOtherSessions` / `updateProfile`（保存・アイコン設定・アイコン削除） / `verifyEmail` / `resetPassword` / `completeOAuthCallback` の全経路で通っている。P-25（`DeleteAccountPanel`）だけが意図的な例外で、理由が JSDoc に書かれている。外部オリジンへ出る `startOAuthLink` / `OAuthButton` / `DevConsentForm` と、セッションを捨てる `signOut` はフル遷移。
- **ローディングフォールバック**: `/settings/{profile,auth,usage}` は loader がフラグメントの promise を await せずに転送し、`<Suspense fallback={…Skeleton}>` + `Deferred` で受ける per-fragment streaming（`/notes` と同形）。3 つのスケルトンは実 DOM（パネル数・行数・`grid-cols-[auto_1fr_auto]`・sticky バー）を写しており、条件付き要素（ハンドル変更警告・容量アラート）を意図的に除いている。`/settings/danger` はサーバー状態を読まないので loader を持たず、ルートレベル pending にも落ちない。
- **`__root.tsx` の副作用 import**: `createServerFn` を持つモジュールを全数照合した（`components/{auth/*,layout/AccountMenu,note/CreateNoteButton}/action`、`routes/{auth,dev,settings}/-action`、`presentation/{auth,devOAuth,redirect}`、`routes/notes/-action`）。島からしか到達しない 3 本（`auth/-action` / `dev/-action` / `settings/-action`）は追加済みで、漏れなし。
- **状態のモデル化**: P-03 / P-04 / P-05 / P-25 はいずれも `Phase` / `SaveState` / `SubmitError` の判別共用体で持ち、境界デコード（`ticketStorage.parseStoredTicket` / `canRestoreTicket`）は DOM 非依存の純関数へ切り出して単体テストがある。`OAuthCallbackPanel` の `reachedServer` による再試行可否の分岐、`extractSerializedError` 経由の `code` 分岐（辞書は `errorDisplay` 1 か所）も一貫している。
- **入力バリデーション**: 転送境界は `validateSearch`（`reset-password` / `verify-email` / `auth/callback/$provider` / `dev/oauth/authorize`）と `serverAction` の `inputValidator` のみで、形と DoS 上限だけ。業務不変条件は VO 側に残している（表示名 50 / 自己紹介 500 / ハンドル 3〜30 / UUID の `requestId` / アバター 5 MB は転送側 8 MB との二段）。`serverData`（`loadIdentities` / `loadProfile` / `loadUsageSnapshot`）へ渡すのは `requireSession()` が返した `userId` と `container.config.appUrl` だけで、要求本文由来の値は 1 つも流れていない。
- **アクセシビリティ / 文言**: 文言は `errorDisplay` の辞書に集約（新設コードの取りこぼしなし。`IDENTITY_INVALID_DISPLAY_NAME` を含めて全アームに写像がある）。live region は「空でも常設・余白だけ条件付き」（`panelStyles.errorTextClass` / `not-empty:`）で統一。`aria-describedby` は各欄の常設 `<p>` を指し、`aria-invalid` は該当欄にだけ付く。日付整形はすべて `timeZone: "UTC"` 固定で、島（`IdentityBoard`）と RSC（`UsagePanel`）でハイドレーション不一致が起きない。`vitest.config.ts` が `TZ=Asia/Tokyo` を固定したこととも整合する。
- **デザイントークン**: `panelStyles` / `formStyles` の recipe 経由で `--color-*` / `--radius-pill` / `--list-max` / `--bar-bg` などのトークンを使用。生の色は spec §8 が明示するアバターのフォールバック勾配（`#c9d3df` → `#8e99a8`）のみ。
- **モックとの照合**: P-21 / P-22 / P-24 / P-25 を `spec/design/pages/*.html` と突き合わせ。差分は縮退として記録済みのもの（連携タブ、公開ページプレビュー、workspace 行と「さらに読み込む」、唯一 owner）と、モック側にしかない他スライスの導線（P-24 の「大きいノートを見る」「ゴミ箱を空にする」= `spec/pages/index.md#P-24` の機能一覧に無い）に限られる。P-21 の sticky アクションバーは `spec/design/index.md §3.8`（設定では下端バーを使わない）と食い違うが、`P21-settings-profile.html` の `.actionbar` に一致しており、より具体的なモックに従っている。
- **テストの担保**: 純関数へ切り出した 2 つ（`passwordStrength` / `ticketStorage`）には単体テストがある。島の挙動（楽観追加・除去、ticket ポーリング、焦点移動）を守る自動テストは無く、`spec/manual-tests/account.md` のブラウザ実行に依存している — リポジトリに DOM テスト環境（`environment: "node"` 固定、RTL 未導入）が無いという既存方針どおりで、本 PR 固有の後退ではない。
- **不要な記述**: 差分中のコード・コメントに、指摘への弁明や修正の経緯を残した箇所は見つからなかった（本 PR はむしろ `ADR 028` → `spec/adr/028` の曖昧さ解消を進めている）。`ticketStorage.ts:2` と `oauthStateCookie.ts:66` が本 Issue の `.thread/2/adr.md` 番号（ADR-006 / 095 / 112 / 099）をパス無しで指しており `spec/adr/*` と紛らわしいが、`.thread/2/` は本 PR で追加されるため参照は解決する。指摘には挙げない。

### カバレッジ

**確認（71 件）**

- `.thread/2/adr.md`（該当 ADR のみ）, `.thread/2/plan.md`, `.thread/2/progress.md`
- `apps/web/app/components/auth/OAuthButton/index.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `apps/web/app/components/auth/PasswordStrengthMeter/index.tsx`, `apps/web/app/components/auth/ResendVerificationForm/action.ts`, `apps/web/app/components/auth/ResendVerificationForm/index.tsx`, `apps/web/app/components/auth/ResetPasswordPanel/action.ts`, `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`, `apps/web/app/components/auth/SignInForm/action.ts`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/components/auth/SignUpForm/action.ts`, `apps/web/app/components/auth/SignUpForm/index.tsx`, `apps/web/app/components/auth/VerifyEmailPanel/action.ts`, `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`, `apps/web/app/components/auth/__tests__/passwordStrength.test.ts`, `apps/web/app/components/auth/passwordStrength.ts`, `apps/web/app/components/auth/schema.ts`
- `apps/web/app/components/dev/DevConsentForm/index.tsx`
- `apps/web/app/components/layout/AccountMenu/action.ts`, `apps/web/app/components/layout/AccountMenu/index.tsx`, `apps/web/app/components/layout/AppShell/index.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`
- `apps/web/app/components/note/NoteBody/index.tsx`
- `apps/web/app/components/settings/AddPasswordForm/index.tsx`, `apps/web/app/components/settings/ChangePasswordForm/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/__tests__/ticketStorage.test.ts`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`, `apps/web/app/components/settings/IdentityList/action.ts`, `apps/web/app/components/settings/IdentityList/board.tsx`, `apps/web/app/components/settings/IdentityList/index.tsx`, `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/components/settings/ProfileForm/editor.tsx`, `apps/web/app/components/settings/ProfileForm/index.tsx`, `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`, `apps/web/app/components/settings/UsagePanel/action.ts`, `apps/web/app/components/settings/UsagePanel/index.tsx`, `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`, `apps/web/app/components/settings/panelStyles.ts`
- `apps/web/app/presentation/deletionTicket.ts`, `apps/web/app/presentation/devOAuth.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/verificationSession.ts`
- `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/reset-password.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/auth.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/routes/settings/index.tsx`, `apps/web/app/routes/settings/profile.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/settings/usage.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/routes/verify-email.tsx`
- `docs/test.md`, `vitest.config.ts`
- `packages/core/src/application/identity/view.ts`, `packages/core/src/application/usage/view.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/domain/storage/errorCode.ts`, `packages/core/src/domain/usage/valueObject.ts`（いずれも島・辞書が依存する DTO / コード / しきい値の突き合わせのため）

**スキップ（240 件）**

- `.thread/2/review/review-00*-*.md`（45 件）, `.thread/2/review/triage.md`, `.thread/2/steps.md`, `.thread/2/testing.md`, `.thread/2/review/review-001.md` — 計 49 件。**最終ラウンドはゼロベースで行う指示のため過去のレビュー記録は読まない**（決着済み Key と `progress.md` / `adr.md` の記録のみ参照）。
- `apps/web/.env.example`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/scripts/listen.node.ts`, `docs/runtime_node.md` — 計 6 件。起動配線・ワーカーランタイムで、Adapter / 運用観点の担当。
- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`, `apps/web/app/presentation/__tests__/devOAuth.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts`, `apps/web/app/presentation/oauthStateBinding.ts`, `apps/web/app/presentation/oauthStateCookie.ts` — 計 6 件。署名・束縛 Cookie の設計で Security 観点の担当（画面側の呼び出し形だけ `routes/auth/-action.tsx` 経由で確認済み）。
- `apps/web/app/routeTree.gen.ts` — 1 件。生成物。
- `packages/core/src/**` の残り 178 件（`adapters/` 全体、`application/{cleanup,di,execution,identity,note,ports,storage,usage,workers}/` の実装とテスト、`domain/{common,identity,note,storage,usage}/` の残り） — Domain-Usecase / Adapter / Test 観点の担当。画面が依存する DTO・エラーコード・ポリシーのしきい値だけを上記「確認」の 6 ファイルで突き合わせた。

合計: 確認 71 + スキップ 240 = **311**
