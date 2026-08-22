# 動作確認計画 — Issue #20: OAuth 束縛 Cookie を state から独立した乱数にする

**Issue:** #20
**作成日:** 2026-08-22

---

## 確認環境

このIssueの変更を確認するために必要な手順のみ記載（依存パッケージのインストール等、プロジェクト全体のセットアップは省略）。

本 Issue の観測対象は `hollow_oauth_state` **Cookie の値と `Set-Cookie` ヘッダー**、および「束縛が一致しない要求で `state` 行が消費されないこと」なので、確認はブラウザーの DevTools を開いた状態で dev サーバーを 1 プロセス動かして行う。

### 環境変数（起動前に必須）

`apps/web/.env` が次の 3 行であること。

```
APP_URL=http://localhost:3000
OAUTH_DEV_MODE=true
MEMORY_MAIL_LOG_ACTION_URL=true
```

- `OAUTH_DEV_MODE=true` — Google 資格情報なしで OAuth の往復（許可・キャンセルの両方）を回すためのループバック IdP。同意画面はアプリ内ルート `/dev/oauth/authorize`（`apps/web/.env.example` の「1. Loopback dev IdP」、`apps/web/app/routes/dev/oauth/authorize.tsx`）。**これが無いと OAuth の実機確認そのものができない**（Google 資格情報も無ければ起動が失敗する — `.env.example`「Exactly one of the two setups below must be configured or boot fails」）。
- `APP_URL` は**待ち受けポートに一致させる**こと（`.env.example`「Match the host:port the listener binds to」）。認可 URL と `redirect_uri` はどちらも `APP_URL` から組み立てられる（`packages/core/src/adapters/oauth/devSignInOAuthClient.ts` の `buildAuthorizationUrl`、`packages/core/src/application/identity/startOAuthFlow.ts` の `oauthRedirectUri`）ため、ずれていると往復が成立しない。`pnpm dev` は `apps/web/vite.config.node.ts` の `server.port: 3000` で待ち受けるので `http://localhost:3000`。
  - **現在の `apps/web/.env` は `APP_URL=http://localhost:3100`** になっている。確認を始める前に `3000` へ直す（または `.env` 側のポートで待ち受けられるよう起動方法を揃える）。
- `MEMORY_MAIL_LOG_ACTION_URL=true` は本 Issue の確認には不要だが、既存 `.env` の記載をそのまま残してよい。

### 検証環境の起動

すべてリポジトリルートで実行する。

| 用途 | コマンド | 出典（実ファイルで確認） |
| --- | --- | --- |
| 開発サーバー | `pnpm dev` | root `package.json` の `scripts.dev`（→ `@repo/web` の `dev:node` = `vite dev --config vite.config.node.ts`）/ `README.md`「Quick Start」/ `CLAUDE.md`「Development Commands」。URL は `http://localhost:3000`（`apps/web/vite.config.node.ts` の `server.port`） |
| 型検査 | `pnpm typecheck` | root `package.json` の `scripts.typecheck`（`tsgo && pnpm -r typecheck`）/ `CLAUDE.md`「After changes」 |
| Lint（自動修正） | `pnpm lint:fix` | root `package.json` の `scripts.lint:fix`（`biome check --write`）/ `CLAUDE.md` |
| 整形 | `pnpm format` | root `package.json` の `scripts.format`（`biome format --write`）/ `CLAUDE.md` |
| 単体テスト・適合スイート | `pnpm test` | root `package.json` の `scripts.test` → `test:unit`（`vitest run`）/ `README.md`「Development commands」 |
| 本番ビルド | `pnpm build` | root `package.json` の `scripts.build` → `@repo/web` の `build:node` |
| 本番起動 | `pnpm start` | root `package.json` の `scripts.start` → `@repo/web` の `start:node`（`tsx scripts/listen.node.ts`）。待ち受け URL は起動ログの `[listen.node] listening on http://...` 行 |

補助コマンド（値の突き合わせに使う。`node -e` の一行実行は `apps/web/.env.example` の `DELETION_TICKET_KEY` 節が示す本リポジトリの慣用）:

```
node -e "console.log(require('node:crypto').createHash('sha256').update(process.argv[1],'utf8').digest('hex'))" '<state の値>'
```

出力は **64 文字の小文字 16 進**。これが本 Issue で廃止される旧 Cookie 値（`sha256(state)` を hex 化したもの — `apps/web/app/presentation/oauthStateBinding.ts` の `deriveOAuthStateBinding`、ステップ 8 で削除）なので、修正後の Cookie 値がこれと一致しないことを確認するために使う。

補足（すべて実ファイルで確認済み）:

- **DB のマイグレーション・シードは不要。** 永続化は in-memory アダプターのみで、`package.json` に `db:*` スクリプトは存在しない（`README.md`「Persistence is in-memory, so there is no schema to generate and no migration command.」）。
- **データはプロセス内メモリのみ。** 本計画の確認項目は **1 つの `pnpm dev` プロセス内で上から順に**実行する。再起動するとアカウントも `state` 行もすべて消える。
- **`state` 行の寿命は 10 分**（`OAUTH_STATE_TTL_MS = 10 * 60 * 1000`、`packages/core/src/application/identity/startOAuthFlow.ts:16`）。1 フローの確認はその中で終える。
- **本番ビルド（`pnpm start`）ではループバック IdP を使えない。** `OAUTH_DEV_MODE` は `NODE_ENV=development`（`vite dev` だけが立てる）でしか受理されず、それ以外は起動を拒否する（`apps/web/.env.example`）。したがって OAuth 往復の実機確認は `pnpm dev` でのみ行う。

### ブラウザーの使い分け

- **ウィンドウ1** = 通常ウィンドウ（主操作）
- **ウィンドウ2** = シークレットウィンドウ（「別のブラウザー」役。Cookie を共有しないこと）
- **ウィンドウ3** = 2 つ目のシークレットウィンドウ、またはウィンドウ2 の Cookie を消してから再利用（「Cookie を一切持たない第三者」役）

DevTools は常に開いておき、次の 2 か所を使う。

- **Application > Storage > Cookies > `http://localhost:3000`** — `hollow_oauth_state` の Value / HttpOnly / SameSite / Path / Secure / Expires を読む。Value セルはその場で編集でき、これが「`state` だけを知る第三者」の再現手段になる。
- **Network** — 「Google で続ける」押下で飛ぶ POST（応答 JSON が `{"authorizationUrl": ...}`）の応答ヘッダーの `set-cookie`、および `/auth/callback/google?...` のドキュメント要求の応答ヘッダー。

### デプロイ方法

なし（Node ランタイム一本、ローカルの `pnpm dev` のみで確認できる）。

## 確認項目

上から順に、同じ `pnpm dev` プロセス内で実行する。項目 1〜3 は 1 つのフローを、項目 4〜6 は次の 1 つのフローを共有する（各項目の「前提」に明記）。

### 1. 束縛 Cookie の値が `state` から計算できない独立した乱数である

- **対応する受け入れ基準:** AC-1、AC-8
- **検証手段:** browser
- **目的:** `Set-Cookie` に載る値が `state` そのものでも `sha256(state)` でもなく、`state` からは導けない別の乱数であることを実機で確かめる
- **手順:**
  1. ウィンドウ1 で `http://localhost:3000/signin` を開き、DevTools の Network タブを開く
  2. 「Google で続ける」を押す
  3. Network で、応答 JSON が `{"authorizationUrl": ...}` の POST を選び、**Response Headers の `set-cookie`** を読む。`hollow_oauth_state=<値>` の `<値>` を控える
  4. 遷移先の同意画面 `/dev/oauth/authorize?...` の URL バーから **`state` クエリーの値**を控える
  5. Application > Cookies で `hollow_oauth_state` の Value が手順 3 の値と同じであることを確認する
  6. 確認環境の `node -e` コマンドに手順 4 の `state` を渡し、`sha256(state)`（64 文字の hex）を計算する
- **期待結果:** Cookie の値が、(a) `state` そのものと**一致しない**、(b) 手順 6 の `sha256(state)` と**一致しない**、(c) `state` の部分文字列でも、`state` を含む文字列でもない。値の形は 43 文字の base64url（`[A-Za-z0-9_-]`）。
- **確認ポイント:**
  - **`state` と Cookie 値は見た目が似ている**（どちらも 32 バイトの base64url = 43 文字。`packages/core/src/adapters/memory/secureTokenGenerator.ts`）。長さや文字種ではなく**値そのもの**を突き合わせること。
  - 値が **64 文字の hex** だったら旧実装（`sha256(state)`）のままなので失敗。
  - `authorizationUrl` にも同意画面の URL にも Cookie 値が現れないこと（束縛の秘密は Cookie でしか運ばれない）。
  - 手順 3 の POST の応答ボディに `state` が含まれていないこと（`StartOAuthFlowView` から `state` を落とす — AC-8）。

### 2. `Set-Cookie` の属性と寿命が現状のまま

- **対応する受け入れ基準:** AC-3
- **検証手段:** browser
- **前提:** 項目 1 の手順 3 の応答と、同意画面を開いたままの状態
- **目的:** 値の作り方だけを変え、Cookie の属性・寿命は退行させていないことを確かめる
- **手順:**
  1. 項目 1 手順 3 の `set-cookie` ヘッダー全文を読む
  2. Application > Cookies の `hollow_oauth_state` の行で HttpOnly / SameSite / Path / Secure / Expires の各列を読む
- **期待結果:** `HttpOnly` が付き、`SameSite=Lax`、`Path=/`、`Secure` は**付かない**（`pnpm dev` は `NODE_ENV=development` なので免除 — `apps/web/app/presentation/oauthStateCookie.ts`）。`Expires` が発行時刻のおよそ **10 分後**（`state` 行の TTL と同じ）。
- **確認ポイント:** `HttpOnly` があるので `document.cookie` からは読めない。DevTools の Console で `document.cookie` を評価して `hollow_oauth_state` が出ないことも併せて見る（スクリプトから読めたら属性の退行）。

### 3. 正しい束縛でサインインが完了する（正常系の 1 往復）

- **対応する受け入れ基準:** AC-3
- **検証手段:** browser
- **前提:** 項目 1・2 で開いた同意画面
- **目的:** 束縛を独立乱数に変えても、認可の往復とサインインが従来どおり完了することを確かめる
- **手順:**
  1. 同意画面でメールアドレス `bind-a@example.com`、表示名 `束縛太郎` を入力し、`email_verified` トグルを **ON** にして「許可する」を押す
  2. 遷移した `/auth/callback/google?code=...&state=...` の表示を見る
  3. Application > Cookies を確認する
  4. 上部バーのアカウントメニューを開く
- **期待結果:** コールバック画面が「手続きを完了しています」→ 成功表示を経て `/notes` へ遷移し、サインイン状態になる（アカウントメニューに `束縛太郎`）。`hollow_oauth_state` は**消えている**（消費に成功した往復では捨てる）。
- **確認ポイント:** セッション Cookie（`hollow_oauth_state` とは別の Cookie）が新たに焼かれていること。ここが通らない場合は以降の項目をすべて中止し、束縛の照合そのものが壊れていないかを先に疑う。

### 4. `state` だけを知る第三者は照合を通せない

- **対応する受け入れ基準:** AC-1
- **検証手段:** browser
- **目的:** `state`（認可 URL とコールバック URL の両方に載って往復する値）を握った第三者が用意できる Cookie 値では、消費要求が必ず `OAUTH_STATE_INVALID` になることを実機で確かめる
- **手順:**
  1. ウィンドウ1 でアカウントメニューからサインアウトし、`/signin` で再度「Google で続ける」を押す
  2. 同意画面の URL から **`state` の値**を控え、Application > Cookies から **`hollow_oauth_state` の正しい値**を控える（項目 6 で戻すので必ず控える）
  3. **同意画面のままで**、Application > Cookies の `hollow_oauth_state` の Value を **`state` の値**に書き換える
  4. 「許可する」を押す（メール `bind-a@example.com`、表示名 `束縛太郎`、`email_verified` ON）
  5. コールバック画面の表示と、Application > Cookies の `hollow_oauth_state` を確認する
  6. 遷移した `/auth/callback/google?code=...&state=...` の **URL 全体をコピー**して控える
  7. Cookie の Value を手順 2 で計算できる **`sha256(state)`（`node -e` の 64 hex）** に書き換え、手順 6 の URL を再読み込みする
  8. Cookie の Value を任意の文字列（例 `x`）に書き換え、手順 6 の URL を再読み込みする
  9. Cookie の Value を**空文字**に書き換え、手順 6 の URL を再読み込みする
- **期待結果:** 手順 4・7・8・9 のいずれもサインインせず、コールバック画面が「手続きを完了できませんでした」を表示する。再試行ボタンは出ず「Hollow に戻る」だけが出る（サーバーに届いた失敗なので `retry: null`）。**`hollow_oauth_state` は消えずに残っている**。
- **確認ポイント:**
  - **どれか 1 つでもサインインが成立したら本 Issue の目的が達成されていない。** とくに手順 7（`sha256(state)`）は旧実装で通っていた値なので、ここが通ると修正が効いていない。
  - **失敗のたびに Cookie が消えていないこと。** 消えると項目 6 の再現ができなくなるうえ、「照合を通らなかったと言い切れない限り捨てない」という破棄条件（他人のブラウザーの進行中フローを落とせる経路を作らない）に反する。
  - 文言は原因を区別しない共通のもの（`state` 不一致・期限切れ・不在をすべて `OAUTH_STATE_INVALID` に畳む設計）。

### 5. 束縛 Cookie を持たない消費要求は `state` を消費しない

- **対応する受け入れ基準:** AC-1
- **検証手段:** browser
- **前提:** 項目 4 のフロー（`state` 行が残っており、手順 6 のコールバック URL を控えている）
- **目的:** Cookie が無い要求がユースケースへ届く前に転送境界で畳まれ、`state` 行に触らないことを確かめる
- **手順:**
  1. ウィンドウ2（シークレット）を開き、項目 4 手順 6 で控えたコールバック URL をそのまま開く
  2. 画面表示を見る
  3. ウィンドウ2 の Application > Cookies を確認する
- **期待結果:** サインインせず「手続きを完了できませんでした」が表示される。ウィンドウ2 に `hollow_oauth_state` は作られない（`set-cookie` が出ない）。
- **確認ポイント:** ウィンドウ2 は Cookie を 1 つも持たないので、ここで成功したら「Cookie 無しでも消費できる」＝束縛が成立していない。この後の項目 6 で**同じ `state` がまだ生きている**ことまで確認して初めて「消費されていない」が言える。

### 6. 束縛が一致しなければ `state` は消費されない（後から正しい束縛で完了できる）

- **対応する受け入れ基準:** AC-2、AC-3
- **検証手段:** browser
- **前提:** 項目 4・5 で合計 5 回の不一致／不在の消費要求を送った直後。項目 4 手順 2 で控えた正しい Cookie 値と、手順 6 のコールバック URL を使う
- **目的:** 不一致・不在の消費要求が `state` 行を焼き切らないこと（消費は束縛が一致したときだけ起きる条件付きの原子操作であること）を、実機の「後から完了できる」で確かめる
- **手順:**
  1. ウィンドウ1 の Application > Cookies で `hollow_oauth_state` の Value を、項目 4 手順 2 で控えた**正しい値**に戻す
  2. 項目 4 手順 6 のコールバック URL を再読み込みする
  3. 遷移後の画面とアカウントメニューを確認する
  4. Application > Cookies を確認する
- **期待結果:** サインインが完了して `/notes` へ遷移する（アカウントメニューに `束縛太郎`）。つまり項目 4・5 の 5 回の要求では `state` 行が 1 度も消費されていない。成功した往復なので `hollow_oauth_state` は消えている。
- **確認ポイント:**
  - ここで「手続きを完了できませんでした」になったら、**不一致の要求が `state` を消費してしまっている**（本 Issue が塞ぐべき退行そのもの）。ただし項目 4 開始から 10 分を超えていると TTL 切れでも同じ表示になるので、超えていたら項目 4 からやり直して測り直す。
  - この項目が AC-3 の「一致した消費要求は従来どおり単回消費して完了できる」も兼ねる。

### 7. 連携（ログイン方法を追加）の往復にも同じ束縛が掛かる

- **対応する受け入れ基準:** AC-3
- **検証手段:** browser
- **目的:** `startOAuthFlow` のもう 1 つの呼び出し元（`startOAuthLinkFn`、P-22「ログイン方法を追加」）も新しい束縛 Cookie を焼き、連携が完了することを確かめる
- **手順:**
  1. ウィンドウ1 でサインアウトし、`/signup` から `pass-a@example.com` / `Passw0rd123` / 表示名 `パスワード太郎` で登録する。`pnpm dev` のターミナルログの `mail.sent` 行の `actionUrl`（`/verify-email?token=...`）を**同じウィンドウ1**で開き、メール確認まで済ませる
  2. `/settings/auth` を開き、Google の追加（ログイン方法を追加）を押す
  3. Application > Cookies で `hollow_oauth_state` の値を控え、同意画面の URL の `state` と突き合わせる
  4. 同意画面でメールアドレス `bind-b@example.com`、表示名 `連携太郎`、`email_verified` ON で「許可する」を押す
  5. 戻った画面と `/settings/auth` の一覧、Application > Cookies を確認する
- **期待結果:** 手順 3 で Cookie 値が `state` とも `sha256(state)` とも一致しない（項目 1 と同じ性質が連携の入口でも成り立つ）。手順 5 で「ログイン方法を追加しました」が表示され、`/settings/auth` の一覧に Google が加わり、`hollow_oauth_state` は消えている。
- **確認ポイント:** 配線テストが実値で押さえるのはサインイン開始の 1 経路だけで、**連携開始（`startOAuthLinkFn`）の追随はここが唯一の実機確認**（型検査でしか担保されていない）。Cookie を焼き忘れていると手順 4 で `OAUTH_STATE_INVALID` になる。

### 8. キャンセルの破棄 — 束縛が一致した破棄要求は Cookie を落とす

- **対応する受け入れ基準:** AC-5
- **検証手段:** browser
- **目的:** 消費 POST が起きずに終わる往復（同意のキャンセル）で、自分が焼いた束縛 Cookie が確かに捨てられることを確かめる
- **手順:**
  1. ウィンドウ1 の `/signin`（サインアウト済みなら `/settings/auth` からでもよい）で「Google で続ける」を押す
  2. Application > Cookies で `hollow_oauth_state` が焼かれていることを確認し、同意画面の URL 全体を控える
  3. 同意画面で「キャンセル」を押す
  4. 遷移した `/auth/callback/google?error=access_denied&state=...` の表示を見る
  5. Network で、そのコールバック URL のドキュメント要求の応答ヘッダーと、Application > Cookies を確認する
- **期待結果:** 「手続きをキャンセルしました」が表示され、`hollow_oauth_state` が**消えている**（ドキュメント応答に破棄の `set-cookie` が出る）。
- **確認ポイント:** 破棄は「`abandonOAuthFlow` が一致を返したときだけ」なので、Cookie が残っていたら束縛の照合が破棄経路で成立していない。なお **`state` 行がその場で解放される（TTL を待たない）ことはブラウザーからは観測できない** — `code` を伴わないキャンセル経路では再消費を試す材料が無いため。行の解放はユースケース単体テスト（`abandonOAuthFlow.test.ts`）と適合スイートに委ねる。

### 9. 別のブラウザーのフローを指す破棄は Cookie も `state` 行も落とさない

- **対応する受け入れ基準:** AC-5
- **検証手段:** browser
- **目的:** コールバック URL を踏ませるだけで他人の進行中フローを壊せる経路が無いことを、2 つのブラウザーで実機再現する
- **手順:**
  1. ウィンドウ1 で `/signin` の「Google で続ける」を押し、同意画面の URL と `state`（= **state A**）を控え、`hollow_oauth_state`（= **Cookie A**）の値も控える。**同意画面は開いたままにする**
  2. ウィンドウ2（シークレット）で `/signin` の「Google で続ける」を押し、同意画面の URL を控え、`hollow_oauth_state`（= **Cookie B**）の値を控える
  3. ウィンドウ2 のアドレスバーに `http://localhost:3000/auth/callback/google?error=access_denied&state=<state A>` を入力して開く
  4. ウィンドウ2 の Application > Cookies を確認する
  5. ウィンドウ2 で手順 2 に控えた同意画面 URL を開き直し、`bind-c@example.com` / 表示名 `別ブラウザー太郎` / `email_verified` ON で「許可する」を押す
  6. ウィンドウ1 に戻り、開いたままの同意画面で `bind-a@example.com` / 表示名 `束縛太郎` / `email_verified` ON で「許可する」を押す
- **期待結果:**
  - 手順 3 で「手続きをキャンセルしました」は表示されるが、ウィンドウ2 の `hollow_oauth_state` は **Cookie B のまま残る**（手順 4）。
  - 手順 5 でウィンドウ2 のフローが完了しサインインできる（Cookie B が壊されていない）。
  - 手順 6 でウィンドウ1 のフローも完了しサインインできる（**state A の行が残っている** — 他人の破棄要求で焼き切られていない）。
- **確認ポイント:** 手順 4 で Cookie B が消えていたら「踏ませるだけで他人の Cookie を落とせる」経路が残っている。手順 6 が `OAUTH_STATE_INVALID` になったら「踏ませるだけで他人の `state` 行を解放できる」経路が残っている。**この 2 つが本項目の本体**で、キャンセル表示が出ること自体は合否ではない。

### 10. 束縛 Cookie を持たない破棄要求は何もしない

- **対応する受け入れ基準:** AC-1
- **検証手段:** browser
- **目的:** Cookie が無い破棄要求がユースケースを呼ばず、`Set-Cookie` も出さず、`state` 行も残すことを確かめる
- **手順:**
  1. ウィンドウ1 で `/signin` の「Google で続ける」を押し、同意画面の URL と `state`（= **state D**）を控える。同意画面は開いたままにする
  2. ウィンドウ3（`hollow_oauth_state` を 1 つも持たないシークレットウィンドウ）で `http://localhost:3000/auth/callback/google?error=access_denied&state=<state D>` を開く
  3. Network でそのドキュメント要求の応答ヘッダーと、ウィンドウ3 の Application > Cookies を確認する
  4. ウィンドウ1 に戻り、開いたままの同意画面で `bind-a@example.com` / `email_verified` ON で「許可する」を押す
- **期待結果:** 手順 3 の応答に `hollow_oauth_state` の `set-cookie` が**一切出ない**（破棄の空値も出ない）。ウィンドウ3 に Cookie は作られない。手順 4 でウィンドウ1 のフローが完了する（**state D の行が残っている**）。
- **確認ポイント:** ここは `requireOAuthStateCookie()` ではなく `readOAuthStateCookie()` の `null` で終わる別経路なので、項目 5（消費経路の Cookie 不在）では覆えない。手順 4 が失敗したら、Cookie 不在の破棄要求がユースケースまで届いて行を触っている。

### 11. 品質ゲート

- **対応する受け入れ基準:** AC-7
- **検証手段:** api
- **目的:** 型検査・Lint・整形・単体テスト／適合スイートがすべて緑であることを確かめる
- **手順:**
  1. リポジトリルートで `pnpm typecheck`
  2. `pnpm lint:fix`
  3. `pnpm format`
  4. `pnpm test`
- **期待結果:** 4 つすべてが成功で終了する。`pnpm test` には新しい適合スイートのケース（束縛不一致では消費されない）、`completeOAuthCallback` / `startOAuthFlow` / `abandonOAuthFlow` の追加ケース、書き直した配線テスト `oauthStateBindingWiring.test.ts` が含まれる。
- **確認ポイント:** `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts` が**削除されている**こと（対象の純関数が無くなるため）。`pnpm test` の出力にこのファイル名が残っていたら、削除したはずの導出関数が本番コードに残っている合図。

## エッジケース・異常系

### 1. 同じブラウザーで 2 つのフローを並行して開始する

- **検証手段:** browser
- **目的:** 束縛 Cookie は 1 本なので、後から始めたフローが前のフローの Cookie を上書きし、先に始めたフローが完了できなくなること（設計として受容している縮退で、不具合ではない）を把握する
- **手順:**
  1. ウィンドウ1 で「Google で続ける」を押し、同意画面 A の URL を控える
  2. 同じウィンドウ1 で新しいタブを開き、`/signin` からもう一度「Google で続ける」を押す（同意画面 B）
  3. 同意画面 B で許可してサインインを完了する
  4. 手順 1 で控えた同意画面 A の URL を開き、許可する
- **期待結果:** 手順 3 は成功する。手順 4 は「手続きを完了できませんでした」になる（Cookie が B の束縛に上書きされており、A の `state` とは一致しない）。
- **確認ポイント:** これは**期待どおりの縮退**で、不具合として起票しない。ただし手順 4 の失敗が `state` 行を消費していないこと（A の Cookie 値を控えてあれば、戻して再読み込みすると完了できる）は項目 6 と同じ性質なので、余力があれば確認する。

### 2. 成功したコールバック URL をもう一度開く

- **検証手段:** browser
- **目的:** 一致した消費で `state` が単回消費されており、同じ URL では二度と完了できないことを確かめる
- **手順:**
  1. 項目 6 手順 2 で成功したコールバック URL を、同じウィンドウ1 でもう一度開く
- **期待結果:** サインイン済み状態は変わらず、コールバック画面は「手続きを完了できませんでした」になる（`state` 行は既に消えており、束縛 Cookie も捨てられている）。
- **確認ポイント:** ここで再びサインインが成立したら単回消費が壊れている。

### 3. 束縛が一致していても TTL（10 分）を過ぎた `state` は完了できない

- **検証手段:** browser
- **目的:** 束縛の変更が期限切れの扱いを壊していないことを確かめる（束縛が一致すれば期限切れでも行は削除され、結果は `null`）
- **手順:**
  1. ウィンドウ1 で「Google で続ける」を押し、同意画面を開いたまま **10 分以上**待つ
  2. Cookie（`hollow_oauth_state`）が Expires 到達で消えている場合に備え、待つ前に値を控えておき、手順 3 の直前に同じ値を Application > Cookies で復元する
  3. 同意画面で「許可する」を押す
- **期待結果:** 「手続きを完了できませんでした」になる。もう一度同じコールバック URL を開いても完了できない（一致した以上、期限切れでも行は削除されている）。
- **確認ポイント:** Cookie の寿命と `state` 行の寿命は同じ 10 分なので、Cookie を復元しないと「不一致・不在」と区別がつかない。手順 2 を省略しないこと。

### 4. `code` を伴わないコールバック（プロバイダーが `code` を返さない）

- **検証手段:** browser
- **目的:** `error` が無くても `code` が欠けていれば破棄経路（`abandonOAuthFlowFn`）が走り、自分の Cookie だけが落ちることを確かめる
- **手順:**
  1. ウィンドウ1 で「Google で続ける」を押し、同意画面の `state`（= **state E**）と `hollow_oauth_state` の値を控える
  2. アドレスバーに `http://localhost:3000/auth/callback/google?state=<state E>`（`code` も `error` も無し）を入力して開く
  3. 画面表示と Application > Cookies を確認する
- **期待結果:** 「手続きを完了できませんでした」（交換を始める材料が無いので再試行導線なし）が表示され、`hollow_oauth_state` が**消えている**（束縛が一致した破棄なので Cookie を落とす）。
- **確認ポイント:** 同じ URL の `state` を**他人の `state`（項目 9 の state A など、生きている別フローの値）**に差し替えて開いた場合は、Cookie が消えないこと。ここが消えると項目 9 と同じ経路の穴になる。

## 既存機能への影響確認

- **サインイン／サインアップの非 OAuth 経路**（メール + パスワード、メール確認リンク、パスワード再設定）— `hollow_oauth_state` とは別 Cookie なので影響しないはずだが、項目 7 手順 1 でサインアップ → メール確認 → サインインまでを 1 往復通して確かめる。
- **P-05 コールバック画面の 5 状態**（処理中 / 成功 / キャンセル / 再許可 / 失敗）— 本 Issue は画面・ルーティングを変えないが、失敗時の再試行導線の出し分けが変わりうる。項目 4（サーバーに届いた失敗 → 再試行ボタン無し）、項目 8（キャンセル状態）、エッジケース 4（材料不足の失敗）で 3 状態を通る。成功は項目 3 / 6 / 7、再許可（`OAUTH_EMAIL_UNVERIFIED`）は同意画面で `email_verified` を **OFF** にして許可すると出るので、余力があれば 1 回確認する（このときも `state` は消費済みなので、出る導線は「もう一度許可する」＝認可のやり直しであること）。
- **P-22「ログイン方法」一覧**（`/settings/auth`）— 項目 7 で Google 追加後の一覧に反映されること、追加後は解除ボタンが有効になること。
- **セッション Cookie の発行**（`completeOAuthCallbackFn` の `Set-Cookie` 2 本立て）— 項目 3 / 6 で、束縛 Cookie の破棄とセッション Cookie の発行が同じ応答で両立していること。
- **単体テスト・適合スイート**（項目 11）— `take` の署名変更は `completeOAuthCallback` / `completeOAuthSignIn` / `linkOAuthIdentity` と `pruneExpiredAuthState`（期限切れ回収）に波及する。期限切れの回収経路は実機では 10 分待ちになるためエッジケース 3 でしか触れられず、担保の主体は `pnpm test`。
- **本番ビルド**（`pnpm build` → `pnpm start`）— ビルドが通り、起動ログの `[listen.node] listening on http://...` の URL でトップと `/signin` が描画されること。**OAuth 往復そのものは本番ビルドでは確認できない**（ループバック IdP は `NODE_ENV=development` でしか受理されず、`OAUTH_DEV_MODE=true` を残したままでは起動が拒否される）。確認するときは `.env` の `OAUTH_DEV_MODE` を外し、`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` を設定して起動できることまでに留める。
- **サーバー再起動でデータが消える** — 永続化は in-memory なので、確認の途中で `pnpm dev` を落とすとアカウントも `state` 行もすべて消える（仕様どおり）。項目 1〜11 は 1 プロセス内で通す。
