### Frontend

#### Blockers

なし

#### Warnings

- **[W-001]** P-25 の完了パネルが 5 秒後に自動でトップページへ遷移し、止める手段が無い / 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:44`（`COMPLETION_LEAVE_MS`）, `:281-287`（タイマー）, `:389-391`（`DeletionProgress` の焦点移動） / 理由: `completed` に入った瞬間に `DeletionProgress` が焦点を自分へ移し、その 5 秒後に無条件で `window.location.assign("/")` が走る。読み上げ対象は見出し「アカウントを削除しました」＋ 2 文（約 80 字）の本文で、既定の読み上げ速度では 5 秒に収まらない。利用者側に延長・停止・解除の手段が無く（「トップページへ」は逆に遷移を早めるボタン）、`prefers-reduced-motion` のような迂回も無い。WCAG 2.2.1（Timing Adjustable）の除外条件（リアルタイム・必須・20 時間）にも当たらない。この画面は削除完了の告知が最後に読める唯一の情報で、以後サインインして読み直すこともできないため、読み落としが回復不能になる。 / 提案: 自動遷移をやめて「トップページへ」の明示操作だけにするか、少なくともキー入力・ポインター操作・焦点移動でタイマーを解除する（`clearTimeout`）形にする。残す場合は残り秒数を可視化し、停止できることを文言で示す。

- **[W-002]** P-22 の追加 / 解除が成功しても告知も焦点復帰も無い / 場所: `apps/web/app/components/settings/IdentityList/board.tsx:109-129`（`onRemove` / `onAddPassword`）, `:204-206`（`listError` の live region） / 理由: この島の live region は `listError`（失敗専用）だけで、解除・追加の**成功**を伝える経路が無い。さらに解除は `useOptimistic` が行を先にアンマウントするため、押した「解除する」ボタンごと消えて焦点が `document.body` へ落ちる（`MethodRow` の `moveFocus` は確認 UI の開閉だけを対象にしていて、ADR-111 の範囲外）。結果、キーボード / 支援技術の利用者は破壊的操作の直後に「何が起きたか」も「今どこにいるか」も失う。同じ島の隣接操作（`ChangePasswordForm` の「パスワードを変更しました…」、`SignOutOthersPanel` の「他の端末のサインインを解除しました…」）は両方とも成功文言を live region に出しており、リスト増減の 2 操作だけがこの規律から外れている。 / 提案: `listError` と対になる成功用の常設 live region（`aria-live="polite"`）を島に 1 つ置き、解除・追加の成功文言を入れる。あわせて解除完了後の焦点をリスト見出しかパネルの `tabIndex={-1}` な受け皿へ戻す（`DeleteAccountPanel` の `DeletionProgress` と同じ形）。

- **[W-003]** `AddPasswordForm` がパスワード規則の写しを 4 か所目として持ち、`score === 0` のゲートも持たない / 場所: `apps/web/app/components/settings/AddPasswordForm/index.tsx:105-107`（「8 文字以上で、英字と数字の両方を含めてください。」）, `:146-149`（送信可否） / 理由: ADR-092 は「UI 側でドメイン規則を写す場所を `components/auth/passwordStrength.ts` の 1 ファイルに閉じる」「ゲートは `score === 0` でのみ送信を止める」と決め、`SignUpForm` / `ResetPasswordPanel` / `ChangePasswordForm` の 3 画面を揃えた。パスワードを新規に作る 4 つ目の面である当ダイアログだけがこの一本化から漏れていて、(a) `PASSWORD_RULE_HINT` を使わず「8」をリテラルで持つため `PASSWORD_MIN_LENGTH` を変えると文言が嘘になる、(b) `passwordStrength` を通さないので `PASSWORD_MAX_LENGTH`（128）超過も英数字条件未達も止まらず、転送境界（`addPasswordSchema` の `max(PASSWORD_MAX_LENGTH)`）まで往復して汎用の validation 文言で返る。ADR-092 の Consequences が「`ChangePasswordForm` の 128 字上限の欠落が塞がり、超過は転送境界へ行く前に score 0 で止まる」を成果として挙げた欠落が、同じ形でここに残っている。 / 提案: 説明文を `PASSWORD_RULE_HINT` に置き換え、`passwordStrength(password).score === 0` を `disabled` 条件に足す（`PasswordStrengthMeter` の表示は他 3 画面に合わせるかどうかを別途決めてよい）。

- **[W-004]** P-25 の ticket 復元にある「主体の照合」が純関数として切り出されておらず、テストが存在しない / 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:88-115`（`readStoredTicket`）, `:202-213`（`stored.userId !== currentUserId` の門） / 理由: ADR-095 が明記するとおり、この照合は「進行中に離脱したタブで別の利用者がサインインしたときに他人の削除の進捗と『削除しました』を見せない」ための境界であり、`sessionStorage` から来る**信頼できない値のデコード**（JSON parse・型検査・`userId` 欠落時の `null` 化）と主体の突き合わせという 2 つの判断を同時に持つ。ところが両方ともコンポーネント本体に埋め込まれた非 export の処理で、単体テストから到達できない。同種の境界判断は本 PR / 既存コードのいずれでも純関数として切り出したうえでテストが付いている（`presentation/verificationSession.ts#shouldIssueVerificationSession`、`presentation/oauthStateBinding.ts#assertOAuthStateBinding`、`presentation/redirect.ts#safeRedirectPath`、`presentation/deletionTicket.ts#readDeletionTicket`）ので、ここだけが規律から外れている。CLAUDE.md の「ビューとロジックの切り分け」「境界デコード」にも掛かる。 / 提案: `readStoredTicket` と「復元してよいか」の判定（`(stored, currentUserId) => boolean` 相当）を `presentation/` か同ディレクトリの純モジュールへ出し、`passwordStrength.test.ts` と同じ粒度で「別 userId は復元しない / userId 欠落は復元する / 壊れた JSON は null」を固定する。

#### 補足（指摘ではない）

- ミューテーションの三層規律・所有権・`router.invalidate()` の再整合は、新設 7 画面すべてで守られていることを確認した。特に P-22 の追加 / 解除が親島（`IdentityBoard`）所有・解除が leaf 非所有になっている点、P-25 だけが `router.invalidate()` を意図的に呼ばない点は契約どおり。
- ローディングフォールバックの 2 種の使い分けも確認した。`/settings/{profile,auth,usage}` は loader が fragment promise を await せず `<Suspense>` + `Deferred` で受け、スケルトンは実 DOM の形（パネル数・行の grid・下部アクションバー）を写している。`/settings/danger` は読み出すサーバー状態が無いので loader 自体を持たない。
- `__root.tsx` への副作用 import は網羅を機械確認した（`createServerFn` を持つ全モジュールのうち、サーバー描画ルートから import されないものはすべて追加済み）。
- 見送り 3 行（`PAGE-p21-004` 公開プロフィール preview / `PAGE-p24-002` workspace 追加読込 / `PAGE-p25-004` 唯一 owner）は UI 上に対応要素も placeholder も出ていない。P-20 の「連携」タブも `SETTINGS_TABS` に無い。
- 文言辞書（`presentation/errorDisplay.ts`）に追加された 28 コードはすべて実コードから投げられることを確認した（`MESSAGE_BY_CODE` のキーと throw 箇所の突合。孤児キー 0）。UI が分岐に使う `CONFIRMATION_MISMATCH` / `DELETION_TICKET_{INVALID,EXPIRED}` / `HANDLE_ALREADY_USED` / `IDENTITY_{INVALID_HANDLE,HANDLE_RESERVED}` も一致している。
- `serverData` は `loadProfile` / `loadIdentities` / `loadUsageSnapshot` の 3 か所のみで、いずれも入力は `requireSession()` 由来の `userId` だけ。転送境界の検証は `validateSearch`（`/reset-password`, `/auth/callback/$provider`, `/dev/oauth/authorize`）と各 server function の `validator` に閉じている。
- ハイドレーション不一致の材料（日付整形）は `IdentityBoard` / `UsagePanel` とも `timeZone: "UTC"` 固定（ADR-083）。`ResendVerificationForm` の `useState(() => Date.now())` は初回描画に現れないので不一致にならない。
- デザイントークンは `styles/tokens.css` に定義済みのものだけを使っている（`text-md` / `tracking-tightest` / `hairline-strong` / `error-surface` / `accent-pressed` / `radius-pill` / `--list-max` / `--bar-bg` を実地確認）。`text-ink-tertiary` をヒントに使う形はモック（`.field-hint`）と同じ。
- 島の状態機械（P-05 の `Phase` / P-25 の `Phase` / P-02 の `Phase`）は直和で表現され、判定は `errorDisplay` の辞書に寄せられている。副作用（`sessionStorage` / `URL.createObjectURL` / タイマー）も try/catch と cleanup で隔離されている。
- コード・コメントに指摘への弁明や修正の経緯を残した記述は見つからなかった（`TODO` / `FIXME` / 「レビュー」「修正した」の類は 0 件）。

#### カバレッジ

**確認（64 件）**

- `apps/web/app/components/auth/`（16）: `OAuthButton/index.tsx`, `OAuthCallbackPanel/index.tsx`, `PasswordStrengthMeter/index.tsx`, `ResendVerificationForm/action.ts`, `ResendVerificationForm/index.tsx`, `ResetPasswordPanel/action.ts`, `ResetPasswordPanel/index.tsx`, `SignInForm/action.ts`, `SignInForm/index.tsx`, `SignUpForm/action.ts`, `SignUpForm/index.tsx`, `VerifyEmailPanel/action.ts`, `VerifyEmailPanel/index.tsx`, `__tests__/passwordStrength.test.ts`, `passwordStrength.ts`, `schema.ts`
- `apps/web/app/components/dev/`（1）: `DevConsentForm/index.tsx`
- `apps/web/app/components/layout/`（4）: `AccountMenu/action.ts`, `AccountMenu/index.tsx`, `AppShell/index.tsx`, `SettingsTabs/index.tsx`
- `apps/web/app/components/note/`（1）: `NoteBody/index.tsx`
- `apps/web/app/components/settings/`（15）: `AddPasswordForm/index.tsx`, `ChangePasswordForm/index.tsx`, `DeleteAccountPanel/index.tsx`, `IdentityList/action.ts`, `IdentityList/board.tsx`, `IdentityList/index.tsx`, `IdentityListSkeleton/index.tsx`, `ProfileForm/action.ts`, `ProfileForm/editor.tsx`, `ProfileForm/index.tsx`, `ProfileFormSkeleton/index.tsx`, `UsagePanel/action.ts`, `UsagePanel/index.tsx`, `UsagePanelSkeleton/index.tsx`, `panelStyles.ts`
- `apps/web/app/presentation/`（11）: `__tests__/deletionTicket.test.ts`, `__tests__/devOAuth.test.ts`, `__tests__/oauthStateBinding.test.ts`, `__tests__/oauthStateBindingWiring.test.ts`, `deletionTicket.ts`, `devOAuth.ts`, `errorDisplay.ts`, `oauthStateBinding.ts`, `oauthStateCookie.ts`, `session.ts`, `verificationSession.ts`
- `apps/web/app/routes/`（16）: `__root.tsx`, `auth/-action.tsx`, `auth/callback.$provider.tsx`, `dev/-action.tsx`, `dev/oauth/authorize.tsx`, `notes/index.tsx`, `reset-password.tsx`, `settings/-action.tsx`, `settings/auth.tsx`, `settings/danger.tsx`, `settings/index.tsx`, `settings/profile.tsx`, `settings/route.tsx`, `settings/usage.tsx`, `storage.$.tsx`, `verify-email.tsx`

**スキップ（240 件）**

- `apps/web/app/routeTree.gen.ts`（1）— 生成物。ルート定義の正は各 `routes/*.tsx` 側で確認済み
- `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `apps/web/app/worker/node/__tests__/runner.test.ts`（3）— Node ランタイム / ワーカー配線。Adapter 観点の担当
- `apps/web/.env.example`, `apps/web/scripts/listen.node.ts`（2）— 起動・環境変数。Security / Adapter 観点の担当
- `docs/runtime_node.md`, `docs/test.md`（2）— 運用ドキュメント。フロントエンドの挙動を規定しない
- `.thread/2/adr.md`, `.thread/2/plan.md`, `.thread/2/progress.md`, `.thread/2/steps.md`, `.thread/2/testing.md`（5）— 契約側の文書。`plan.md` / `progress.md` / `adr.md` は判断材料として参照したがレビュー対象としては扱わない
- `.thread/2/review/review-00{1..8}-*.md`, `.thread/2/review/review-001.md`, `.thread/2/review/triage.md`（42）— 過去のレビュー記録。ゼロベース指示により読んでいない
- `packages/core/src/adapters/**`（43）— アダプター層。Adapter 観点の担当（`domain/storage/errorCode.ts` 等はコード値の突合にのみ参照）
- `packages/core/src/application/**`（108）— ユースケース・ポート・ワーカー。Domain-Usecase / Test 観点の担当（`application/{identity,usage,storage}/view.ts` は DTO の形の確認にのみ参照）
- `packages/core/src/domain/**`（33）— ドメイン層。Domain-Usecase 観点の担当（`identity/valueObject.ts` / `identity/errorCode.ts` / `storage/errorCode.ts` / `usage/valueObject.ts` は UI 側の写しと突合するために参照）
- `vitest.config.ts`（1）— テスト実行設定。Test 観点の担当

合計 64 + 240 = 304。
