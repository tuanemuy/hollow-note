# レビュー 001 — Security（PR #17 / Issue #2）

## 前提と判定基準

- 規約: `CLAUDE.md`、`spec/presentation/index.md`（資格情報の運搬・CSRF・セキュリティヘッダー・ステータス対応）、`spec/platform/index.md`
- 脅威モデル: `spec/adr/001`（認証手段の分離）/ `spec/adr/028`（列挙耐性）/ `spec/adr/029`（メール確認のセッション束縛 = **login CSRF を「直接のデータ流出経路」と明記**）/ `spec/adr/030`
- 契約: `.thread/2/plan.md`（AC-6 / AC-7 / AC-8 / AC-15 / AC-19 / AC-20 / AC-26 / AC-28、および「含まれないもの」「縮退」）
- 設計意図の確認に `.thread/2/adr.md`（ADR-003 / 006 / 007 / 014 / 015 / 016 / 020 / 021）を参照

先に良い点を書いておく。**主体の取り方は全経路で正しい**。`apps/web/app/routes/settings/-action.tsx` の全ハンドラーが `requireSession()` を通し、`userId` / `subjectId` / `currentSessionToken` を要求本文から取らない。`storeAvatar` は `input.subjectId !== userId` を弾き、`cleanupAdmission.assertWritable()` + `assertActorWritable()` の 2 本を通す。`getAccountDeletionStatus` は検証済み ticket の `operationId` だけを使い、`Pick<…, "findByOperationId">` の読み取りビュー越しなので書き込み UoW を開かない。CSRF は `apps/web/app/start.ts` で `createCsrfMiddleware({ filter: serverFn })` が全 server function に掛かっており、`uploadAvatarFn` の `FormData` 経路も `Sec-Fetch-Site` / `Origin` / `Referer` で守られている（`spec/presentation/index.md` の「`FormData` を受けるサーバー関数は `Origin` 検証必須」を満たす）。`AccountLinkingPolicy` は `providerEmailVerified` が偽なら `createNew` 経路も含めて必ず拒否する。dev IdP の判定はルート側の env 直読みでなく `RequestContainer.oauthDevMode` 経由で、`submitDevConsentFn` にも二重の 404 ガードがある。`releaseActiveUniqueKey` / `beginRelease` は所有者不一致で no-op なので、他人の予約を奪えない。

以下は、その上でなお塞がっていない箇所。

---

## Security

### Blockers

- **[B-001]** OAuth サインインの `state` が「フローを開始したブラウザー」に束縛されておらず、login CSRF（セッション固定 / アカウントすり替え）が成立する
  - 場所: `packages/core/src/application/identity/startOAuthFlow.ts:97-107`（`state` を発行するが Cookie を焼かない）、`apps/web/app/routes/auth/-action.tsx:51-88`（`completeOAuthCallbackFn` が `state` / `code` だけで `Set-Cookie` する）、`packages/core/src/application/ports/oauthStateStore.ts`（`OAuthFlowState` にブラウザー束縛のフィールドが無い）
  - 理由: 攻撃シナリオは `spec/adr/029-verification-session-binding.md` が「直接のデータ流出経路」と呼んだものと**同型**で、今回 OAuth 経路に再導入されている。

    1. 攻撃者が自分のブラウザーで「Google で続ける」を押し、`startOAuthSignInFn` から `state=S` を含む認可 URL を得る
    2. 攻撃者が自分の Google アカウントで同意を完了し、**最終ナビゲーションを止めて** `https://app/auth/callback/google?state=S&code=C` を手元に取る（自分のブラウザーなので DevTools でも拡張でも取れる。state TTL は 10 分、Google の code も同程度）
    3. その URL を被害者に踏ませる（チャット・メール・自サイトからの誘導。トップレベル遷移なので `SameSite=Lax` は素通り）
    4. 被害者のブラウザーで `OAuthCallbackPanel` がマウントされ、自オリジンから `completeOAuthCallbackFn` を POST する。`Origin` も `Sec-Fetch-Site` も正しく揃うので CSRF ミドルウェアは通る
    5. サーバーは `state` を `take` し、`code` を交換し、**攻撃者のアカウントのセッション Cookie を被害者のブラウザーへ焼く**

    以降、被害者が書いたノートは攻撃者のアカウントに保存される。ADR-029 が「通常の CSRF 対策が効かない」「要求を発するのが自オリジンのページ自身である以上 `Origin` 検証も CSRF トークンも原理的に成立しない」と書いた条件がそのまま当てはまる。`OAuthStateStore.take` の原子性が防ぐのは *認可応答のすり替え*（他人の正規フローに別の code を差し込む）だけで、攻撃者が自分の完成済みフローを被害者のブラウザーに持ち込む方向は防げない。

    `linkIdentity` intent は `flow.userId` / `flow.userAuthEpoch` を持つので影響を受けない。**影響は `signIn` intent 限定**だが、それが新規登録とサインインの主導線である。
  - 提案: ADR-029 と同じ形の束縛を OAuth にも入れる。`startOAuthFlow` を呼んだ応答で `state`（またはそのハッシュ）を `HttpOnly` / `SameSite=Lax` / `Path=/` / TTL 10 分の Cookie に焼き、`completeOAuthCallbackFn` が「要求本文の `state` == Cookie の値」を検証してから usecase に渡す。束縛の判定は転送境界に閉じられる（`OAuthFlowState` を変えずに済む）ので、ADR-029 の「ユースケース側は無変更で、束縛は transport 境界に閉じる」と同じ分担で書ける。不一致時は `OAUTH_STATE_INVALID` に畳んで「もう一度サインインからやり直してください」に倒せば、既存の P-05 失敗状態がそのまま使える。
    - あわせて `spec/presentation/index.md` の「OAuth の CSRF は `state` と PKCE で防ぐ」は login CSRF を扱えていないので、spec-sync 候補として記録すること。PKCE は認可コード横取り（同一 UA 内の別アプリ）に効く対策で、この攻撃には効かない。

- **[B-002]** dev IdP の production ガードが、このリポジトリ自身の本番起動経路では発火しない。既定の `.env` と組み合わせると任意アドレスでの全アカウント乗っ取りになる
  - 場所: `packages/core/src/application/di/serverNode.ts:76-86`（`env.NODE_ENV === "production"` を**実行時の** `process.env` から読む）、`apps/web/scripts/listen.node.ts`（`NODE_ENV` を設定しない）、`apps/web/.env.example:20`（`OAUTH_DEV_MODE=true` がコメントアウトされずに既定で有効）
  - 理由: 同じ「今 production か」という問いに、コードベース内で 2 つの異なる答え方がある。

    - `apps/web/app/presentation/session.ts:32` の `process.env.NODE_ENV === "production"` は**リテラル参照**なので Vite のビルド時置換が効く。実際 `apps/web/dist/server/rsc/assets/session-*.js:26` は `var isProduction = () => true;` に畳まれている（＝ Cookie の `Secure` は本番ビルドで正しく付く）
    - `serverNode.ts` の判定は `env.NODE_ENV`（オブジェクトのプロパティ参照）なので置換されず、`apps/web/dist/server/server.node.js:7739` にそのまま `if (env.NODE_ENV === "production")` として残る。**実行時の環境変数**を見る

    そして `pnpm start` → `apps/web/scripts/listen.node.ts` は `dotenv` で `.env` を読むだけで `NODE_ENV` を設定しない。したがって「`OAUTH_DEV_MODE=true` かつ `NODE_ENV=production` は起動失敗」（ADR-003、`docs/runtime_node.md` の "Combining it with `NODE_ENV=production` is a startup error"）は、**運用者が明示的に `NODE_ENV=production` を渡した場合にしか働かない**。

    そのうえで本 PR の `.env.example` は `OAUTH_DEV_MODE=true` を有効行として置いている。`cp .env.example .env && pnpm build && pnpm start` という最短経路が、そのまま dev IdP を公開する。

    攻撃シナリオ（dev IdP が有効なまま公開された場合）: 攻撃者が「Google で続ける」→ `/dev/oauth/authorize` の同意画面に到達 →「メールアドレス」欄に `victim@example.com`、「メールアドレスは確認済み」チェックを入れて「許可する」。`devSignInOAuthClient.exchangeCode` は署名の無い自己完結トークンを復号して `emailVerified: true` の profile を返し、`completeOAuthSignIn` は `identityUniqueDirectory.resolve("email", …)` で被害者の active アカウントに当たり、`AccountLinkingPolicy` が `linkToExisting` を返し、**被害者のセッションが攻撃者に発行される**。メールアドレスを知っているだけで任意アカウントを乗っ取れる。
  - 提案: ガードを「実行時 env の申告」に依存させない。少なくとも次のどれかを取る。
    1. `apps/web/scripts/listen.node.ts` の先頭で `process.env.NODE_ENV ??= "production"` を立てる（`session.ts` が既にビルド時に `production` へ畳まれていることと辻褄が合う）。あわせて `serverNode.ts` の判定も同じ根拠（ビルド時定数）から取るようにして、2 系統に割れている状態を解消する
    2. `.env.example` の `OAUTH_DEV_MODE=true` をコメントアウトし、`APP_URL` が `localhost` / ループバックでないときは dev IdP を無条件に拒否する二重化を足す
    3. `initNodeRuntime` に「dev IdP を選んだ」ことを起動ログの `warn` として必ず出す（誤配備の検知点。現状は無言で選ばれる）
  - なお AC-6 は「`OAUTH_DEV_MODE` が偽のときは 404 になる」までしか要求していないので、これは AC 違反ではなく **ADR-003 が守ろうとした性質（production に漏れない）が配線で満たされていない**という指摘。

### Warnings

- **[W-001]** `AvatarUrl` の同一オリジン検査が、バックスラッシュと C0 制御文字で回避できる
  - 場所: `packages/core/src/domain/identity/valueObject.ts:159-183`
  - 理由: 相対パス分岐は `startsWith("/")` かつ `!startsWith("//")` しか見ていない。WHATWG URL は special scheme でバックスラッシュを `/` として扱い、解決前に C0 制御文字を除去するので、次はどちらも別オリジンへ解決する（Node 25 で実測済み）。

    ```
    new URL("/\\evil.test/x.png",  "http://app.test").href  // => http://evil.test/x.png
    new URL("/\n/evil.test/x.png", "http://app.test").href  // => http://evil.test/x.png
    ```

    `updateProfileFn` は `avatarUrl` を最大 2048 文字の任意文字列として受け、`AvatarUrl.create` が唯一の関門なので、認証済み利用者は自分のアイコンを第三者ホストに向けられる。**同じ PR の `startOAuthFlow.assertSameOriginPath`（`startOAuthFlow.ts:27-49`）は `\\` も C0 も正しく弾いており**、2 つの同一オリジン検査が非対称になっている。現時点の被害範囲は「自分のアイコンが外部読み込みになる」（`AccountMenu` / P-21）に留まるが、値は永続化され、公開プロフィール P-42（#9）でそのまま第三者に描画される想定なので、保存された外部ビーコンになる。ADR-016 / AC-20 が名指しした「同一オリジン検証を通る」という保証が実際には成立していない。
  - 提案: `assertSameOriginPath` と同じ判定に揃える（`value.includes("\\")` と `charCodeAt <= 0x1f || === 0x7f` の拒否を追加）。判定ロジックが 2 箇所にあるので、`lib/` に純関数として括り出して両方から呼ぶのが望ましい。境界値（`/\evil`、`/\n/evil`、`//evil`、`javascript:`）を VO の単体テストに足すこと。

- **[W-002]** `/storage/$` は無認可であらゆる objectKey を配信し、`Cache-Control: public, immutable` を付ける
  - 場所: `apps/web/app/routes/storage.$.tsx:22-48`
  - 理由: ハンドラーはセッションも purpose も見ず、`ObjectStorage.get(key)` の結果をそのまま返す。今は `storeAvatar` が唯一の `put` 呼び出し元なので実質アバター専用だが、`ObjectStorage` は 1 つの鍵空間で、`FilePurpose` には `source` / `media` / `reference` / `artifact`（＝ノートの元ファイルや生成物 = 非公開）が既に定義済みで、`deleteFilesByOwner` はそれらを消す前提で書かれている。取り込みスライス（#6）が同じ `ObjectStorage.put` を使った瞬間、非公開ファイルが鍵を知る者に world-readable になる。鍵は `users/{userId}/{purpose}/{fileId}.png` で fileId は乱数なので当面は推測困難だが、これは security by obscurity で、`publicUrl` の JSDoc 自身が「Use it only for objects that really are public」と書いている制約をルート側が担保していない。加えて `public, max-age=31536000, immutable` は共有キャッシュに保存させる指示なので、後から非公開用途が混ざったときの影響が配信経路の外まで広がる。
  - 提案: 鍵の 2 番目のセグメント（purpose）が `avatar` のときだけ配信し、それ以外は 404 に倒す。将来 `source` / `media` を出す必要が出たら、その時点で `StoredFileRepository` 越しの所有者検査を足す入口として同じルートを使えばよい。`Cache-Control` の `public` は avatar に限定されている限り妥当なので、purpose ガードとセットで残す。

- **[W-003]** MIME 型が申告値のままで、実バイトを見ていない（チェックサムは計算しているのに型の裏取りに使っていない）
  - 場所: `packages/core/src/application/storage/storeAvatar.ts:79`（`MimeType.create(input.declaredMimeType)`）、`apps/web/app/routes/settings/-action.tsx:169-200`（`data.file.type` = クライアント申告）、`packages/core/src/domain/storage/services/uploadValidationPolicy.ts:20-24`
  - 理由: 「MIME / サイズ検証が実バイトに基づくか」の問いに対して、サイズは実バイト（`input.body.byteLength`）だが**型は申告値**。`Content-Type: image/png` と宣言した任意のバイト列（HTML / SVG / ZIP / polyglot）が `avatar` として保存され、`/storage/$` が `Content-Type: image/png` で返す。現状の実害は限定的で、それは配信ルートが `X-Content-Type-Options: nosniff` と `Content-Security-Policy: sandbox; default-src 'none'` を付けているおかげ（sandbox が opaque origin を作るので、仮に HTML が入っても自オリジンでは実行されない）。つまり**防御が配信側だけに寄っており、保管側は素通り**という構造で、`publicUrl` の JSDoc が想定する「R2 等の公開ドメインへ移った配備」ではこのルートごと無くなる（＝ nosniff / CSP も無くなる）ため、その時点で防御がゼロになる。
  - 提案: `storeAvatar` で先頭バイトのマジックナンバー（PNG `89 50 4E 47`、JPEG `FF D8 FF`、WebP `RIFF….WEBP`）を判定し、判定結果を `MimeType` として採用する（申告値は無視する）。判定不能なら `StorageErrorCode.UnsupportedMimeType`。ドメイン側に置くなら `UploadValidationPolicy` にバイト列を渡す形が素直で、`spec/domains/storage.md` の `UploadValidationPolicy` 契約の範囲に収まる。

- **[W-004]** `resendVerificationEmail` / `requestPasswordReset` の応答**時間**がアドレスの登録有無で大きく違う（メール送信を `await` してから返している）
  - 場所: `packages/core/src/application/identity/resendVerificationEmail.ts:48-51, 99-113`、`packages/core/src/application/identity/requestPasswordReset.ts:52-55, 64-79, 122-133`
  - 理由: 応答**内容**は完璧に同一（`UNIFORM_RESPONSE` の空オブジェクト、view.ts に「載せられるフィールドは無い」と明記）で、そこは spec どおり。しかし経路の重さが違う。

    | アドレスの状態 | 実行される I/O |
    | --- | --- |
    | 未登録 | directory 解決 1 回で return |
    | 登録済みだが対象外（active / deleting 等） | directory + user 読み 1 回で return |
    | 対象（pending / password あり） | directory + user 読み + Global UoW（token 削除 + 発行）+ **`mailSender.send` の await** |

    `MailSender` が実 SMTP / API になる本番では最後の 1 行が数百 ms 規模になり、応答時間が「そのアドレスが登録済みで再送対象か」のオラクルになる。ADR-028 は「所要時間を揃える」を明示的な要求として立てており、`signInWithPassword` ではダミーハッシュ検証でそれを実現している。同じ ADR の下でこの 2 経路だけ等時化が無いのは非対称。なお `spec/usecases/identity.md` の当該節は時間について何も書いていないので、**spec 違反ではなく ADR-028 の趣旨との齟齬**という位置づけ。
  - 提案: 最低限、`mailSender.send` を応答から外す（`void` にして失敗はログのみ、あるいは outbox 経由の非同期送信にする）。それだけで一番大きい差が消える。より厳密にやるなら ADR-028 のダミー検証と同じ発想で、全経路が同じ下限時間を消費するようにする。どちらを採るにせよ判断を adr.md に記録すること。

- **[W-005]** 削除完了後も、削除された利用者のメールアドレス・ハンドル・providerAccount キーが control plane 行に残り続ける（prune の駆動主体が無い）
  - 場所: `packages/core/src/application/identity/deleteAccount/terminalPrune.ts:68`（`pruneAccountDeletionManifests` を呼ぶ本番コードが存在しない）、`packages/core/src/application/identity/deleteAccount/input.ts:86-99`（`AccountDeletionUniquenessKeys` に平文の email / handle / providerAccounts）、`apps/web/app/worker/node/runner.ts`（relay / consumer / scope-task / outbox prune の 4 役しか回さない）
  - 理由: ADR-020 の「一意性キーを admission 時に operation payload へ凍結する」設計自体は妥当で、`globalCleanup` がそれを使って directory を解放する。回収は `pruneAccountDeletionManifests` → `distributedOperationStore.deleteTerminal` が担い、コードとポートの JSDoc はどちらも「120 日保持」と書いている。しかし `grep` の結果、この関数を呼ぶのは `__tests__` だけで、Node ランタイムのワーカーにも cron にも載っていない。結果として **`finalize` が `User` を tombstone にして PII を落とした後も、`distributed_operations` 行には「誰の削除だったか」が平文で残り続ける**。`identity_removal_receipts`（30 日）も同様に `deleteExpired` の駆動主体が無い。

    「アカウント削除」という機能の中核的な約束が、配線の欠落で 120 日どころか無期限に破られている。`pruneExpiredAuthState` の cron 未配線は plan.md で「Issue #15」として明示的に見送られているが、**terminal prune の未配線は plan.md の「含まれないもの」にも「縮退」にも書かれていない**（AC-27 は prune のロジックだけを求めており、ユニットテストで満たされる）。
  - 提案: (a) `pruneOutbox` と同じ場所（`runner.ts` の prune tick）に `pruneAccountDeletionManifests` と `identityRemovalReceiptStore.deleteExpired` を足す。どちらも lease / checkpoint を持つので日次 tick に載せられる。あるいは (b) 本 Issue の範囲外と判断するなら、**縮退として plan.md / Issue コメントに 1 行で記録し、引き継ぎ先（#15）を明記する**。無記録のまま残すのが一番まずい。

- **[W-006]** ランタイム singleton の初期化が fail-open（env 無しで作られると dev IdP に倒れ、`??=` がそれを黙って温存する）
  - 場所: `packages/core/src/application/di/memoryRuntime.ts:119`（`oauth = { mode: "dev" }` が既定）、`packages/core/src/application/di/serverNode.ts:153`（`memoryRuntime()` の `??= createMemoryRuntime()`）と `:196`（`initNodeRuntime` の `??=`）
  - 理由: `initNodeRuntime(env)` は「slot が空なら env から作る」であって「env の設定を強制する」ではない。`server.node.ts#boot` が最初に呼ぶ限り正しく動くので**現時点では到達しない**が、フェイルの向きが危ない方に開いている: 何かの理由で `memoryRuntime()` が先に走ると（HMR、ツーリング、将来足される module-scope の初期化、別ランタイム entry の追加）、env 検証を一切通っていない `{ mode: "dev" }` のランタイムがプロセス全体に固定され、`initNodeRuntime` はそれを上書きせず黙って通過する。B-002 と重なると影響が大きい。
  - 提案: `initNodeRuntime` を `??=` ではなく「既に埋まっていたら throw」にする（起動順の違反はバグであって回復可能なランタイムエラーではない、という `getContainer()` と同じ扱い）。あわせて `createMemoryRuntime` の `oauth` 既定を「呼ぶと throw する未設定クライアント」にし、`createTestHarness` 側が明示的に `{ mode: "dev" }` を渡す形にすれば、「設定し忘れ」が dev IdP に化ける経路自体が消える。

- **[W-007]** `addPasswordIdentity` が再認証を求めないので、セッションを握られた時点で永続的な認証手段を追加できる
  - 場所: `packages/core/src/application/identity/addPasswordIdentity.ts:26-45`、`apps/web/app/routes/settings/-action.tsx:202-224`
  - 理由: `changePassword` は現在のパスワード検証を必須にし、成功時に `authEpoch` を進めて他端末を落とす。一方 `addPasswordIdentity` は「セッションがある」以外に何も要求せず、`authEpoch` も進めない。共用端末に開きっぱなしのセッション、あるいは何らかのセッション奪取があったとき、攻撃者は**パスワードを 1 本足すだけで、以後は正規のサインイン手段で入り直せる**。被害者が「他の端末からサインアウト」を実行しても、追加されたパスワード identity は残る。`spec/scenario/account.md` の AC-06 は「パスワードを追加する際は Google 再認可を求める」としており、これは本来この穴を塞ぐ規律だったと読める。
  - 位置づけ: plan.md の「縮退」に **「P-22 の『再認証要求』状態を実装しない」として明記済み**（`spec/usecases/identity.md` の `addPasswordIdentity` 手順に再認可が無く、spec-sync 候補としてステップ 34 に載せる、とある）。したがって**スコープ逸脱ではない**。ただし縮退の記録は現状「UI 状態を出さない」という書きぶりで、セキュリティ上の帰結（乗っ取り後の永続化）が読み取れない。
  - 提案: 縮退の記録に「再認証が無いため、セッション奪取後に永続的な認証手段を追加できる」という帰結を 1 行足し、spec-sync では `spec/usecases/identity.md` 側に再認証手順を足す方向（＝シナリオ AC-06 を正とする）で解消するよう引き継ぐ。実装を今やるなら、`addPasswordIdentity` 成功時に `authEpoch` を進めて現セッションだけ `refreshAuthEpoch` する（`changePassword` と同じ形）だけでも、追加操作が全端末に通知される代わりに他端末が落ちるので被害の検知点になる。

---

## 個別に検証して「問題なし」と判断した点

指摘に至らなかったが、ブリーフが名指しした項目なので判定を残す。

| 観点 | 判定 | 根拠 |
| --- | --- | --- |
| server function が主体を Cookie セッションから取るか | ○ | `routes/settings/-action.tsx` の全ハンドラーが `requireSession()` 経由。`userId` / `subjectId` / `currentSessionToken` を要求本文から取る経路は 1 つも無い |
| 他人のリソースへの操作 | ○ | `removeIdentity` は「他人の identity は不在と同じ」（`identityNotFound()`）、`storeAvatar` は `subjectId !== userId` と workspace 主体を `InsufficientRole` で拒否、`updateProfile` / `deleteAccount` はセッションの `userId` 固定 |
| `assertWritable` / `assertActorWritable` の呼び漏れ | ○ | scope UoW の通常 write 入口は `createBlankNote` / `storeAvatar` / `recalculateStorageUsage` の 3 つで、いずれも 2 本とも呼ぶ。cleanup 系（`deleteQuota` / `deleteFilesByOwner` / `cleanupDispatch` / `personalCleanup` / `authorRedaction`）は barrier を越える必要があり `assertOwner(operationId)` を通す — 正しい使い分け |
| 列挙耐性（応答内容） | ○ | `Resend` / `RequestPasswordReset` の view は「載せられるフィールドが無い」空型で、usecase も全分岐で同一値を返す。`SignUpView` の decoy userId（#1）と整合。ただし所要時間は W-004 |
| エラー文言からの内部状態漏洩 | ○ | `EXISTING_ACCOUNT_UNVERIFIED` / `ACCOUNT_UNAVAILABLE` は「IdP で確認済みメールの所有を証明した後」にしか出ないので、他人の存在を漏らすオラクルにならない。`SystemError` の `code` / `message` は転送境界で伏せられる（既存の `errorResponse.ts`） |
| ログへの秘密の出力 | ○ | 新規コードでトークン / パスワード / URL をログに出す箇所は無い。`MEMORY_MAIL_LOG_ACTION_URL` は本 PR の変更対象外（`adapters/memory/mailSender.ts` は差分に含まれない）で、既定 false・opt-in・JSDoc に危険性が明記済み。`.env.example` にも「Manual testing only」の注記あり |
| トークンのハッシュ保存・one-shot・期限・purpose・authEpoch | ○ | `resetPassword` は `purpose !== "password_reset"` / `status !== "pending"` / `token.authEpoch !== user.authEpoch` / user が active でない の 4 条件すべてを `AUTH_TOKEN_NOT_FOUND` に畳み、消費は UoW 内の条件付き更新（`authTokenRepository.save(consumed)`）＝ 単回消費ゲート。並行消費の敗者はパスワードが変わらない |
| トークンの URL / ログ / クライアント露出 | ○ | 確認・再設定リンクはメール本文のみ。`buildHead` の canonical はクエリーを含まないパスで組むのでトークンが `<link rel=canonical>` に載らない。`Referrer-Policy: strict-origin-when-cross-origin` が外部遷移時の `Referer` を潰す |
| セッション Cookie の属性 | ○ | `HttpOnly` / `SameSite=Lax` / `Path=/` / `Domain` 無指定 / `Expires = Session.expiresAt`。`Secure` は本番ビルドで `() => true` に畳まれることをビルド成果物で確認 |
| `authEpoch` バンプによる一括失効 | ○ | `resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount(beginDeletion)` の 4 経路すべてがバンプし、`authenticateSession` が世代を照合する。現セッションのみ残す経路は同一トランザクション内の `refreshAuthEpoch(session.id, userId, bumped.authEpoch)` 1 行で、他人のセッションには触れない |
| サインアウトの Cookie 破棄 | ○ | `signOutFn` が usecase（行削除）と `clearSessionCookie()` の両方を実行。POST 限定（GET だと Lax 下で外部リンクからログアウト強制が成立する）も維持 |
| PKCE S256 | ○ | `deriveCodeChallengeS256` は `base64url(sha256(verifier))` の 1 実装を両アダプターが共有。認可 URL に `code_challenge_method=S256` を必ず載せ、dev アダプターは `exchangeCode` で challenge を再導出して照合する（盗まれた code だけでは使えない） |
| `redirect_uri` / `redirectTo` のオープンリダイレクト耐性 | ○ | `assertSameOriginPath`（`\\`・C0 制御文字・`//` を拒否）と `resolveDevRedirectUri`（`URL.origin` 比較）。判定はサーバー側にあり、`DevConsentForm` はクライアントに任せていない |
| `email_verified` の検証 | ○ | `AccountLinkingPolicy.decide` が最初に `!providerEmailVerified → refuse` を返すので、新規作成経路も含めて未確認メールでは 1 行も書かれない。Google アダプターは `claims.email_verified === true` の厳密比較で、真偽値以外を偽に倒す |
| `id_token` の署名未検証 | ○ | OIDC Core §3.1.3.7 が明示的に許す唯一のケース（TLS 越しに token endpoint から直接受領）で、JSDoc にその根拠が書かれている。`aud` / `iss` / `exp` 未検証も同じ根拠でこの経路では許容範囲 |
| 既存アカウントへの自動リンク | ○ | `active` かつ IdP 確認済みメールのときだけ。`pending` / `deleting` / `deleted` は拒否。リンク確定は最終 UoW 内で status / epoch を再読して直列化される |
| `state` の one-shot / intent 改竄耐性 | ○（B-001 とは別問題） | `take` は原子的 get+delete、intent はサーバーが `put` した値のみが根拠、`completeOAuthCallback` はパスの `:provider` と保存値の一致も要求。クエリー由来の値で分岐しない |
| dev IdP の 404 と composition root 経由の判定 | ○ | ルート loader は `loadDevOAuthModeFn` → `container.oauthDevMode`、server function 側も `container.oauthDevMode` を再確認。どちらも env を直読みしない。ただし「本番でそもそも有効にならないか」は B-002 |
| 削除 status ticket | ○ | HMAC-SHA-256、鍵は `RequestContainer.deletionTicketKeyRing`（composition root 供給、`process.env` 直読み無し、既定はプロセス毎 `randomBytes(32)`、版付きで rotate 可能）。署名検証は `crypto.subtle.verify`（定数時間）、**期限判定は署名検証の後**（順序の理由がコメントに明記）、claims は `{operationId, expiresAt}` だけで権限を広げる材料が無い。`getDeletionStatusFn` は要求本文の `operationId` を一切見ず、検証済み ticket の値だけを使う（TC-identity-048） |
| ticket のリプレイ耐性 | △（許容） | 30 分間は同じ ticket で何度でも進捗を読める。ただし読めるのは `{operationId, status}` のみで、`partitionKey` / `requestKey` / `payload` は view から意図的に落とされている。ADR-006 の設計どおり |
| パストラバーサル（配信・保管） | ○ | `ObjectKey.create` が `..` と先頭 `/` を拒否。memory アダプターは `Map` キーなのでそもそもパス解決が起きない |
| 配信時の `Content-Type` / ヘッダー | ○（W-002 / W-003 と別） | `nosniff` + `sandbox; default-src 'none'` + 明示 `Content-Length`。不正な鍵は 400 でなく 404 に倒して鍵の形を漏らさない |
| 入力バリデーションの 2 点 | ○ | 転送境界は形と DoS 上限だけ（表示名 50+1 / 自己紹介 500+1 / ハンドル 30+1 / アバター 2048 / パスワード 128 / state 512 / code 4096 / ticket 1024 / アップロード 8MB）で、業務不変条件は値オブジェクトに委ねている。`AVATAR_UPLOAD_MAX_BYTES`(8MB) > 業務上限(5MB) は「上限違反の理由をドメイン 1 箇所に保つ」ための意図的な差でコメント済み |
| `serverData` に未検証の外部入力が流れていないか | ○ | `serverData` は RPC スタブではなく素の関数（`serverAction.ts` の JSDoc どおり）。`loadIdentities` / `loadProfile` / `loadUsageSnapshot` の引数はいずれも `requireSession()` が返した `userId` で、転送境界から届く値ではない |
| CSRF | ○ | `apps/web/app/start.ts` が `createCsrfMiddleware({ filter: serverFn })` を `requestMiddleware` に登録済み。`Sec-Fetch-Site` → `Origin` → `Referer` の順で同一オリジンを要求し、いずれも無ければ拒否。`uploadAvatarFn` の `FormData` 経路もこれで守られる |
| 暗号・乱数 | ○ | ticket 鍵と share token 鍵は `node:crypto.randomBytes(32)`、`state` / `codeVerifier` / セッショントークンは `SecureTokenGenerator.issue`（#1 の既存実装）、チェックサムは sha256、パスワードは scrypt（#1）。`Math.random` の使用は新規コードに無し |
| 一意性予約の他人奪取 | ○ | `beginRelease` は `row.userId !== expectedUserId` と `state === "reserved"` で no-op。`release(operationId)` は `reserved` / `releasing` しか消さず、`active` は消せない |
| 削除の PII 凍結と解放 | ○ | admission で email / handle / providerAccounts を payload へ凍結（ADR-020）、`globalCleanup` が payload だけを読んで directory を解放するので identity 行の生死に依存しない。`finalize` は必須 receipt が揃うまで 1 行も書かない。ただし凍結された PII の回収は W-005 |
| スコープ逸脱 | 無し | 差分に「含まれないもの」を越える実装は見当たらない。`recalculateStorageUsage` は転送境界の入口を持たない（ワーカー / テストのみ）が、これは AC-22 の範囲内で、外部から任意 subject の再集計を叩ける入口を作っていないという意味ではむしろ安全側 |

## テストの実効性（共通チェック）

自分の観点で確認した挙動のうち、**振る舞いを検証するテストが実際に存在するもの**:

- 列挙耐性: `resendVerificationEmail.test.ts` / `requestPasswordReset.test.ts` が「全状態で同一応答・送信の有無」を検証（TC-identity-194..199, 187..193）。ただし**時間の同一性を検証するテストは無い**（W-004）
- トークンの単回消費・期限・用途・epoch: `resetPassword.test.ts` / `verifyEmail.test.ts` が境界（59 分 / 1 時間、23:59 / 24:00）と並行消費を検証
- OAuth: `startOAuthFlow.test.ts`（外部オリジン `redirectTo` の拒否、2 回開始で別 state）、`completeOAuthSignIn.test.ts`（未確認メールの拒否、8 件上限、state 再利用）、`linkOAuthIdentity.test.ts`（epoch 進行での拒否、他人に紐づく provider account）。**`state` のブラウザー束縛は仕様が無いのでテストも無い**（B-001）
- ticket: `presentation/__tests__/deletionTicket.test.ts` が署名・期限・改竄を検証
- dev IdP の production ガード: `di/__tests__/serverNode.test.ts` が `OAUTH_DEV_MODE=true` + `NODE_ENV=production` の起動失敗と「フォールバックしない」を検証。**ただしテストは `readNodeServerEnv` に env を直接渡すので、実際の起動経路が `NODE_ENV` を渡すかは検証範囲外**（B-002 がテストをすり抜けた理由）
- redirect: `presentation/__tests__/devOAuth.test.ts` が別オリジンの `redirect_uri` 拒否を検証。**`AvatarUrl` の同一オリジン検査には境界値テストが無い**（W-001）

アサーションが形骸化しているものは見つからなかった。指摘への弁明・修正経緯のようなコメントも無い（コメントはいずれも「なぜこの形か」を説明する種類で、`CLAUDE.md` の方針に沿っている）。

## カバレッジ

一覧 226 件 = 確認 89 + スキップ 137。

### 確認（89）

`.thread/2/adr.md`, `.thread/2/plan.md`, `apps/web/.env.example`, `apps/web/app/components/auth/OAuthCallbackPanel/index.tsx`, `apps/web/app/components/auth/ResendVerificationForm/action.ts`, `apps/web/app/components/auth/ResendVerificationForm/index.tsx`, `apps/web/app/components/auth/ResetPasswordPanel/action.ts`, `apps/web/app/components/auth/ResetPasswordPanel/index.tsx`, `apps/web/app/components/auth/VerifyEmailPanel/index.tsx`, `apps/web/app/components/auth/schema.ts`, `apps/web/app/components/dev/DevConsentForm/index.tsx`, `apps/web/app/components/layout/AccountMenu/action.ts`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/settings/IdentityList/action.ts`, `apps/web/app/components/settings/IdentityList/board.tsx`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/components/settings/ProfileForm/editor.tsx`, `apps/web/app/components/settings/UsagePanel/action.ts`, `apps/web/app/presentation/deletionTicket.ts`, `apps/web/app/presentation/devOAuth.ts`, `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/routes/dev/-action.tsx`, `apps/web/app/routes/dev/oauth/authorize.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/reset-password.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/auth.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/server.node.ts`, `apps/web/app/worker/node/runner.ts`, `docs/runtime_node.md`, `packages/core/src/adapters/memory/objectStorage.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/oauth/__tests__/conformance.test.ts`, `packages/core/src/adapters/oauth/devSignInOAuthClient.ts`, `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`, `packages/core/src/adapters/oauth/pkce.ts`, `packages/core/src/adapters/oauth/signInOAuthClient.ts`, `packages/core/src/application/cleanup/personalCleanup.ts`, `packages/core/src/application/di/__tests__/serverNode.test.ts`, `packages/core/src/application/di/memoryRuntime.ts`, `packages/core/src/application/di/serverNode.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/identity/addPasswordIdentity.ts`, `packages/core/src/application/identity/authResidueCleanup.ts`, `packages/core/src/application/identity/changePassword.ts`, `packages/core/src/application/identity/checkHandleAvailability.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/deleteAccount/admission.ts`, `packages/core/src/application/identity/deleteAccount/finalize.ts`, `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`, `packages/core/src/application/identity/deleteAccount/index.ts`, `packages/core/src/application/identity/deleteAccount/input.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/getAccountDeletionStatus.ts`, `packages/core/src/application/identity/getProfile.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/listIdentities.ts`, `packages/core/src/application/identity/removeIdentity.ts`, `packages/core/src/application/identity/requestPasswordReset.ts`, `packages/core/src/application/identity/resendVerificationEmail.ts`, `packages/core/src/application/identity/resetPassword.ts`, `packages/core/src/application/identity/signOut.ts`, `packages/core/src/application/identity/signOutOtherSessions.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/updateProfile.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/ports/objectStorage.ts`, `packages/core/src/application/storage/deleteFiles.ts`, `packages/core/src/application/storage/deleteFilesByOwner.ts`, `packages/core/src/application/storage/deleteStoredObjects.ts`, `packages/core/src/application/storage/storeAvatar.ts`, `packages/core/src/application/usage/deleteQuota.ts`, `packages/core/src/application/usage/getUsageSnapshot.ts`, `packages/core/src/application/usage/recalculateStorageUsage.ts`, `packages/core/src/application/workers/subscribers.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/valueObject.ts`, `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`, `packages/core/src/domain/storage/storedFile.ts`, `packages/core/src/domain/storage/valueObject.ts`

（判定に必要だったため、差分外の `apps/web/app/start.ts`（CSRF ミドルウェアの登録）と `apps/web/app/presentation/session.ts`（Cookie 属性）、および `apps/web/dist/server/**` のビルド成果物（B-002 の裏取り）も併せて読んだ。）

### スキップ（137）

| 群 | 件数 | 観点外と判断した理由 |
| --- | --- | --- |
| `.thread/2/{progress,steps,testing}.md` | 3 | 実装手順・進捗の記録で、セキュリティ判定の根拠は plan.md / adr.md で足りる |
| `apps/web/app/routeTree.gen.ts` | 1 | ルーター生成物。手書きの分岐が無く判断が入らない |
| `apps/web/app/components/**`（auth の `OAuthButton` / `SignInForm` / `SignUpForm`、layout の `AccountMenu` / `AppShell` / `SettingsTabs`、settings の `AddPasswordForm` / `ChangePasswordForm` / `IdentityList/index` / `ProfileForm/index` / `UsagePanel/index` / 各 Skeleton / `panelStyles.ts`） | 15 | 表示と入力補助の島・スケルトンで、認可判定はすべて対応する server function 側にある（そちらは確認済み）。危険な描画経路（`dangerouslySetInnerHTML` 等）が無いことは grep で確認した |
| `apps/web/app/routes/settings/{profile,usage}.tsx` | 2 | 認証ガードは親 `/settings/route.tsx`（確認済み）が持ち、子は fragment の受け渡しのみ。`auth.tsx` を代表として確認した |
| `apps/web/app/presentation/__tests__/{deletionTicket,devOAuth}.test.ts` | 2 | テスト。存在と対象範囲は「テストの実効性」節で扱った |
| `packages/core/src/adapters/conformance/**` | 15 | ポート契約の適合スイート。契約自体は対応するポート定義側で見ており、スイートに攻撃面は無い |
| `packages/core/src/adapters/memory/**`（`repositories/identityUniqueDirectory.ts` と `objectStorage.ts` を除く全て） | 17 | プロセス内ストアで外部からの入力面を持たない。認可（一意性の解放）と秘密（オブジェクト配信）に関わる 2 本だけを確認対象にした |
| `packages/core/src/application/**/__tests__/**` | 38 | テスト。実効性は「テストの実効性」節で扱った |
| `packages/core/src/application/ports/**`（8 本） | 8 | 型と JSDoc の契約。認可に関わる `scopeCleanupAdmissionStore` の契約文（「every normal write entry point calls both」）だけは grep で確認した |
| `packages/core/src/application/{cleanup/participants, execution/{eventId,unitOfWork}, identity/{continuations,eventDecoders}, identity/deleteAccount/{authorRedaction,cleanupDispatch,compaction,manifestBuild}, storage/{eventDecoders,view}, usage/view, workers/{eventRelayWorker,scopeTaskRunner}}` | 14 | 削除オーケストレーションの継続駆動・投影・DTO。いずれもワーカー平面で、入力は自分が発行した継続イベントだけ（外部入力を受けない）。barrier / `assertOwner` の使い分けは呼び出し側（確認済み）で判定できた |
| `packages/core/src/domain/**/__tests__/**` | 4 | ドメイン単体テスト |
| `packages/core/src/domain/**`（`identity/valueObject.ts` / `identity/ports/identityUniqueDirectory.ts` / `storage/{valueObject,storedFile,services/uploadValidationPolicy}.ts` を除く: エラーコード・イベント型・ポート宣言・usage の集計ドメイン） | 18 | 秘密も認可も持たない型・定数・集計ロジック。usage は `getUsageSnapshot`（確認済み）が読み取り専用で使うだけ |

---

## 優先順位の提案

1. **B-001**（OAuth login CSRF）— サインイン主導線で被害者のデータが攻撃者アカウントへ流れる。ADR-029 と同じ束縛を transport 境界に足すだけで塞げる
2. **B-002**（dev IdP の production ガード）— 誤配備 1 回で全アカウント乗っ取り。`.env.example` の 1 行と起動スクリプトの 1 行で大きく改善する
3. **W-001**（`AvatarUrl` バイパス）— 1 行の修正で、同じ PR 内に正しい実装の手本がある
4. **W-005**（削除 PII の回収未配線）— 修正するか、縮退として記録するかの判断が要る
5. **W-002 / W-003**（保管・配信のハードニング）— 取り込みスライス（#6）が同じ `ObjectStorage` を使う前に入れておきたい
6. **W-004 / W-006 / W-007** — 記録と後続対応で足りる
