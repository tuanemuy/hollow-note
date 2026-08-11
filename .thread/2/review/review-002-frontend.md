# レビュー 002 — Frontend

対象 PR: #17（`issue/2/account-management-and-auth` → `main`）
観点: Frontend（三層規律 / 所有権 / streaming と skeleton / 状態のモデル化 / 転送境界 / a11y / トークン）

## Frontend

#### Blockers

なし。

新規 7 画面すべてでミューテーションの三層規律が守られている（サーバーコンポーネント取得 → `"use client"` island → React 19 プリミティブ）。所有権の規則も守られており、リスト増減（パスワード追加 / 認証手段の解除）は `IdentityList/board.tsx` の親 island が `useOptimistic` ごと所有し、解除は親で実行されている。in-item に相当するパスワード変更・他端末サインアウトは葉が自分の server function と pending / エラー表示を持つ。`router.invalidate()` は全ミューテーション経路に入っており、欠けているのは ADR-006 で意図的に外した P-25 だけ。per-fragment streaming（`/settings/{profile,auth,usage}`）は `renderServerFragment` の未解決 promise を loader が await せず転送する参照実装どおりの形。`__root.tsx` への副作用 import も、`createServerFn` を持つ新規モジュール 5 本（`ResendVerificationForm/action` / `ResetPasswordPanel/action` / `routes/auth/-action` / `routes/dev/-action` / `routes/settings/-action`）が全て追加済みで漏れは無い。転送境界の検証も `validateSearch`（`reset-password` / `callback.$provider` / `dev/oauth/authorize`）と `serverAction` の `validator` の 2 点に閉じており、`serverData`（`loadProfile` / `loadIdentities` / `loadUsageSnapshot`）には `userId` しか渡していない（外部入力は通っていない）。見送り 3 行（`PAGE-p21-004` 公開プロフィール preview / `PAGE-p24-002` workspace 行と追加読込 / `PAGE-p25-004` 唯一 owner）は、無効ボタンの placeholder を含めて UI 上に一切出ていないことを確認した。

#### Warnings

- **[W-001]** パスワード強度の採点ロジックが 3 か所に分裂していて、同じパスワードが画面ごとに違う強さで表示される
  - 場所: `apps/web/app/components/settings/ChangePasswordForm/index.tsx:173`, `apps/web/app/components/auth/ResetPasswordPanel/index.tsx:319`, `apps/web/app/components/auth/SignUpForm/index.tsx:71`
  - 理由: 本 PR で 2 本目・3 本目が増えた。`ResetPasswordPanel` は大文字小文字混在にボーナスを与え 128 文字上限も見るが、`ChangePasswordForm` はどちらも見ない。同じ `Abcdefgh1234` が P-04 では「十分」、P-22 では「ふつう」になる。ADR-046 が明示的に許容したのは「パスワード入力の見た目が 2 か所に分かれる」ことであって、判定ロジックの分岐ではない。さらに `ChangePasswordForm` の写しには 128 文字の上界が無いので、200 文字のパスワードが「とても強い」と表示され送信ボタンも有効なまま、転送境界（`PASSWORD_MAX_LENGTH = 128`）で往復してから初めて弾かれる。CLAUDE.md の「ビジネスロジックはフレームワーク非依存の純粋関数」にも反する（3 つともコンポーネント本体に埋まっている）。
  - 提案: `components/auth/passwordStrength.ts` に純関数 1 本（＋`StrengthMeter`）を出して 3 画面で共有し、ドメイン `PlainPassword` の条件（8〜128・英字・数字）を 1 か所で写す。

- **[W-002]** P-21 のハンドル欄で、重複以外の失敗（不正・予約語）が欄に紐づかない
  - 場所: `apps/web/app/components/settings/ProfileForm/editor.tsx:234-239`, `:363-384`, `:434-438`
  - 理由: `handleProblem` は「`saveState.status === "error"` **かつ** 候補が 1 件以上」のときだけ欄側に出す。候補が付くのは `HANDLE_ALREADY_USED` だけなので（`suggestionsFor`）、`IDENTITY_INVALID_HANDLE` / `IDENTITY_HANDLE_RESERVED` は `aria-invalid` が false のまま、画面下端の sticky バーの live region に出る。`spec/pages/index.md#P-21` は「ハンドル重複（候補提示）」と「ハンドル不正・予約語」を別の状態として並べており、辞書にも欄向けの具体文言（「ハンドルは英小文字・数字…」「このハンドルは予約されていて使えません」）がある。支援技術には「どこが悪いか」が伝わらず、視覚的にも入力欄から一番遠い場所に出る。ADR-085 が P-25 で徹底した「項目のエラー / パネルのエラー」の分離が、同じ理由が成り立つ P-21 に適用されていない。
  - 提案: `suggestions.length > 0` ではなく `SerializedError.code` で判定し、`HANDLE_ALREADY_USED` / `IDENTITY_INVALID_HANDLE` / `IDENTITY_HANDLE_RESERVED` の 3 コードを欄側（`aria-invalid` + `aria-describedby` の先）へ、それ以外をバーへ振る。

- **[W-003]** P-25 の ticket 復元が「今サインインしている利用者」に紐づいておらず、無関係なセッションに「アカウントを削除しました」を見せる
  - 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:133-138`
  - 理由: マウント時に `sessionStorage` の ticket を無条件に読んで `accepted` へ遷移する。ticket が捨てられるのは終端（completed / rejected / 恒久失効）に達したときだけなので、進行中に画面を離れた（`leave()` を待たず自分でナビゲートした）タブには ticket が残る。同じタブで別アカウントにサインインして `/settings/danger` を開くと、削除フォームではなく「アカウントを削除しています」が出て、ポーリングが `completed` を返した瞬間に「アカウントを削除しました」を表示し、5 秒後に `window.location.assign("/")` で強制遷移する。生きているアカウントの利用者に破壊的操作の完了を誤って通知する形になる（次回訪問時には ticket が消えて自己回復するが、1 回は必ず誤表示する）。
  - 提案: ticket の保存時に対象 `userId`（または「受理直後＝未サインイン」であること）を一緒に持たせ、復元は「保存時の主体と今の主体が一致する、またはセッションが無い」ときだけにする。`/settings` の `beforeLoad` は既に `user` を context に載せているので判定材料はある。

- **[W-004]** P-25 の進捗ポーリングが一時障害で終端し、UI に再開手段が無い
  - 場所: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx:178-196`, `:314-323`
  - 理由: ADR-085 の決定どおり一時障害では ticket を残すが、`setPhase(next)` で `settled` に落ちると `activeTicket` が null になりポーリングは止まる。この状態の画面が出す操作は「トップページへ」だけで、「削除の処理はこのまま進みます」という文言はあっても「この画面を再読み込みすれば進捗を追い直せる」ことがどこにも書かれていない。ticket を残した意図（再読込での再開）が利用者に到達しない。
  - 提案: `settled` のうち ticket が残っている場合だけ「再試行」ボタンを出し、押したら `accepted` へ戻してポーリングを再開する（`retryExchange` と同じ形の attempt カウンターで足りる）。少なくとも文言に再読込の案内を足す。

- **[W-005]** P-05 の「もう一度試す」が消費済みの `state` / `code` を再送するため、ほぼ必ず 2 回目も失敗する
  - 場所: `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx:111-114`, `:233-253`
  - 理由: `retryExchange` は `attempt` を進めて同じ `state` / `code` で `completeOAuthCallbackFn` を再 POST する。`state` は単回消費なので、この再試行が意味を持つのは「交換要求そのものがネットワーク層で失敗した」場合だけで、失敗の大半（state 不一致・期限切れ・再利用・`PROVIDER_ACCOUNT_ALREADY_LINKED` など消費後に発生する失敗）では 2 回目が `OAUTH_STATE_INVALID` になり、利用者は同じ画面で「認可の手続きが途中で切れました」を見て手詰まりになる。ADR-084 は失敗時に「もう一度試す」を置くとだけ決めており、何を再試行するかは決めていない。
  - 提案: `needsReauthorization` と同じく `startOAuthSignInFn` から認可をやり直す（`retryAuthorization`）を既定にするか、`state` を消費していないと判る失敗（`initialPhase` 由来の `code` / `state` 欠落と通信失敗）だけ交換の再試行に倒す。

- **[W-006]** スケルトンが実 DOM に常に存在する末尾要素を欠いていて、差し替え時にレイアウトシフトが出る
  - 場所: `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx:10-29`, `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx:16-33`
  - 理由: `UsagePanel` は末尾に「アカウント削除へ」の導線行（`border-t` + `py-5`）を無条件に持つが、スケルトンには無い。`ProfileForm` も自己紹介の下（「500 文字まで」）とハンドル欄の下（「空欄にすると公開ハンドルを解除します。」）に常設の注記段落を持つが、スケルトンはどちらも省いている。条件付きの要素（ハンドル変更の警告・使用量の警告アラート）を省くのは JSDoc のとおり妥当だが、これらは条件が無く必ず出るので、その分だけ実データ到着時に下方向へ伸びる。
  - 提案: 3 か所に対応する `Skeleton` 行（`h-3` 相当と末尾行）を足す。

- **[W-007]** アイコン選択の `<input type="file">` にアクセシブルネームが無い
  - 場所: `apps/web/app/components/settings/ProfileForm/editor.tsx:248-262`
  - 理由: 見出しに使っている「アイコン」は `<label>` ではなく `<span className={fieldLabelClass}>` で、input には `id` も `aria-label` も無い。`sr-only` は視覚的に隠すだけでフォーカスも読み上げも残るので、支援技術の利用者にはラベルの無い「ファイル選択」コントロールが 1 つ現れる（実際の操作導線である「画像を選ぶ」ボタンとは別に）。
  - 提案: input に `aria-label="アイコン画像を選ぶ"` を付けるか、`hidden` 属性（フォーカス不可）にして操作をボタンだけに寄せる。

- **[W-008]** P-24 の「…時点」だけ時間帯が実行環境依存になっている
  - 場所: `apps/web/app/components/settings/UsagePanel/index.tsx:190-201`
  - 理由: 同じファイルのリセット日は「課金期間が UTC 暦月なので UTC で読む」と `timeZone: "UTC"` を明示している（ADR-083 もこの扱いに揃えると書いている）のに、`updatedAt` の整形だけ `timeZone` 未指定でサーバーの時間帯に従う。サーバーコンポーネントなのでハイドレーション不一致は起きないが、UTC 以外で配備すると同じパネル内で基準の違う 2 つの日時が並ぶ。
  - 提案: `updatedDateFormat` / `updatedTimeFormat` にも `timeZone: "UTC"` を明示して同一基準に揃える（または表示に基準を添える）。

- **[W-009]** `AccountMenu` の JSDoc が現在の UI と食い違っている
  - 場所: `apps/web/app/components/layout/AccountMenu/index.tsx:67-69`
  - 理由: 「a one-item popover doesn't implement」という理由づけで ARIA menu ロールを避けているが、本 PR で「設定」リンクが増えて項目は 2 つになった。判断（disclosure のままにする）は妥当だが、根拠の記述が事実と合わなくなっており、次に項目を足す人が同じ理由づけを再利用できない。
  - 提案: 「項目数によらず矢印キー / フォーカス管理を実装しないため disclosure に留める」といった、項目数に依存しない表現へ直す。

#### カバレッジ

- 確認: `apps/web/app/components/auth/OAuthButton/index.tsx`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `apps/web/app/components/auth/ResendVerificationForm/action.ts`, `apps/web/app/components/auth/ResendVerificationForm/index.tsx`, `apps/web/app/components/auth/ResetPasswordPanel/action.ts`, `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/components/auth/SignUpForm/index.tsx`, `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`, `apps/web/app/components/auth/schema.ts`, `apps/web/app/components/dev/DevConsentForm/index.tsx`, `apps/web/app/components/layout/AccountMenu/action.ts`, `apps/web/app/components/layout/AccountMenu/index.tsx`, `apps/web/app/components/layout/AppShell/index.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`, `apps/web/app/components/settings/AddPasswordForm/index.tsx`, `apps/web/app/components/settings/ChangePasswordForm/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/settings/IdentityList/action.ts`, `apps/web/app/components/settings/IdentityList/board.tsx`, `apps/web/app/components/settings/IdentityList/index.tsx`, `apps/web/app/components/settings/IdentityListSkeleton/index.tsx`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/components/settings/ProfileForm/editor.tsx`, `apps/web/app/components/settings/ProfileForm/index.tsx`, `apps/web/app/components/settings/ProfileFormSkeleton/index.tsx`, `apps/web/app/components/settings/UsagePanel/action.ts`, `apps/web/app/components/settings/UsagePanel/index.tsx`, `apps/web/app/components/settings/UsagePanelSkeleton/index.tsx`, `apps/web/app/components/settings/panelStyles.ts`, `apps/web/app/presentation/deletionTicket.ts`, `apps/web/app/presentation/devOAuth.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/reset-password.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/auth.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/routes/settings/index.tsx`, `apps/web/app/routes/settings/profile.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/settings/usage.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/server.node.ts`（計 50）
- スキップ: `.thread/2/**`（12 件）— 計画・ADR・前ラウンドのレビュー記録でコードではない
- スキップ: `apps/web/.env.example`（1 件）— 起動時の env 契約でランタイム / セキュリティ観点
- スキップ: `apps/web/app/presentation/__tests__/{deletionTicket,devOAuth,oauthStateBinding}.test.ts`（3 件）— 純関数の単体テストでテスト観点の担当（辞書 `errorDisplay.test.ts` は本 PR で未更新だが、未知コードは kind へ落ちる設計なので指摘には挙げない）
- スキップ: `apps/web/app/presentation/oauthStateBinding.ts`（1 件）— state 束縛の暗号処理でセキュリティ観点
- スキップ: `apps/web/app/routeTree.gen.ts`（1 件）— 自動生成
- スキップ: `apps/web/app/worker/node/runner.ts`, `apps/web/scripts/listen.node.ts`, `docs/runtime_node.md`（3 件）— ワーカー実行経路と運用ドキュメント
- スキップ: `packages/core/**`（179 件）— ドメイン / アプリケーション / アダプター層で他観点の担当（UI に届く DTO・エラーコード・`SameOriginPolicy` / `BillingPeriod` の意味だけを照合のため参照）

確認 50 + スキップ 200 = 250。
