# 動作確認計画 — Issue #13: ナビゲーションごとの RPC 3往復を削減する

**Issue:** #13
**作成日:** 2026-08-23

---

## 確認環境

このIssueの変更を確認するために必要な手順のみ記載（依存パッケージのインストール等、プロジェクト全体のセットアップは省略）。

本 Issue の成果は「クライアント遷移 1 回あたりの `_serverFn` 要求の本数と直列段数」なので、確認は **DevTools を開いたブラウザー + 1 プロセスのサーバー**で行う。受け入れ基準は計測環境が 2 つに分かれる（plan.md「計測環境の別」）:

- **DEV**（`staleTime: 0`）… AC-1〜4 / AC-5 / AC-6a / AC-6b / AC-7 / AC-9a / AC-9b / AC-11 / AC-12
- **本番ビルド**（`staleTime: Infinity`）… AC-8 と AC-6b の 2 回目

### 環境変数

`apps/web/.env`（無ければ `cp apps/web/.env.example apps/web/.env`）を、測る環境ごとに次の形にする。**両方を同時に起動しない**（どちらも既定でポート 3000 を使う）。

**DEV 用**

```
APP_URL=http://localhost:3000
OAUTH_DEV_MODE=true
MEMORY_MAIL_LOG_ACTION_URL=true
```

- `OAUTH_DEV_MODE=true` — Google 資格情報なしでサインインを通すループバック IdP（同意画面は `/dev/oauth/authorize`。`apps/web/.env.example`「1. Loopback dev IdP」/ `apps/web/app/routes/dev/oauth/authorize.tsx`）。
- `APP_URL` の**ポートがそのまま dev サーバーの待ち受けポートになる**（`apps/web/vite.config.node.ts:13-14` — `APP_URL` を URL として解釈し `server.port` に入れる。`strictPort: true` なので塞がっていれば起動が失敗する）。
- `MEMORY_MAIL_LOG_ACTION_URL=true` は本番ビルド側でサインイン状態を作るのに要る（下記）。DEV では無くてもよいが、揃えておけば `.env` の差し替えが 1 行で済む。

**本番ビルド用**

```
APP_URL=http://localhost:3000
#OAUTH_DEV_MODE=true
GOOGLE_OAUTH_CLIENT_ID=dummy
GOOGLE_OAUTH_CLIENT_SECRET=dummy
MEMORY_MAIL_LOG_ACTION_URL=true
```

- **`OAUTH_DEV_MODE=true` を残すと本番ビルドは起動しない。** `packages/core/src/application/di/serverNode.ts:84-94` が `NODE_ENV=development` 以外での `OAUTH_DEV_MODE=true` を拒否し、`apps/web/scripts/listen.node.ts:20` が `NODE_ENV` を `production` に固定するため。
- ID プロバイダーは「dev IdP か Google 資格情報のどちらか」が必須（同 95-104）。本番ビルドでの確認は**メール + パスワード**のサインインだけを使うので、`GOOGLE_OAUTH_CLIENT_*` は**空でなければよい**（`createSignInOAuthClient` は値を保持するだけで、起動時に Google へ接続しない — `packages/core/src/adapters/oauth/signInOAuthClient.ts`）。この設定では `/signin` の「Google で続ける」は使えない。

**AC-5（`<head>` の一致）を測るときは、`main` 側とブランチ側で `APP_URL` を同じ値にしておく。** `canonical` / `og:url` / `og:image` は `config.appUrl` から組み立てられる（`apps/web/app/presentation/head.ts:33-51`）ので、ポートを変えると差分が出る。

### 検証環境の起動

すべてリポジトリルートで実行する。

| 用途 | コマンド | 出典（実ファイルで確認） |
| --- | --- | --- |
| 開発サーバー | `pnpm dev` | root `package.json` `scripts.dev` → `@repo/web` の `dev:node`（`vite dev --config vite.config.node.ts`）/ `README.md`「Quick Start」。URL は `APP_URL`（= `http://localhost:3000`） |
| 本番ビルド | `pnpm build` | root `package.json` `scripts.build` → `@repo/web` の `build:node`（`vite build --config vite.config.node.ts`） |
| 本番起動 | `pnpm start` | root `package.json` `scripts.start` → `@repo/web` の `start:node`（`tsx scripts/listen.node.ts`）。待ち受け URL は起動ログの `[listen.node] listening on http://...` 行。ポートは `PORT`（既定 3000 — `apps/web/.env.example`） |
| 型検査 | `pnpm typecheck` | root `package.json` `scripts.typecheck`（`tsgo && pnpm -r typecheck`）/ `CLAUDE.md`「After changes」 |
| Lint（自動修正） | `pnpm lint:fix` | root `package.json` `scripts.lint:fix`（`biome check --write`） |
| 整形 | `pnpm format` | root `package.json` `scripts.format`（`biome format --write`） |
| 単体テスト・適合スイート | `pnpm test` | root `package.json` `scripts.test` → `test:unit`（`vitest run`） |

**「変更前」の実測（`main`）**は同じコマンドを `main` で走らせる。作業ブランチをコミットしてから `git switch main` → `pnpm dev`（依存は同一なので `pnpm install` は不要）、測り終えたら `git switch -`。**同時起動はしない**（ポートが衝突する。`strictPort` なので黙って別ポートには逃げない）。

`routeTree.gen.ts` は自動生成なので、ブランチ側で `pnpm dev` か `pnpm build` を一度通してから測る（plan.md リスク欄）。

補足:

- **DB のマイグレーション・シードは不要。** 永続化は in-memory のみで、`package.json` に `db:*` スクリプトは存在しない（`README.md`「Persistence is in-memory, so there is no schema to generate and no migration command.」）。
- **データはプロセス内メモリのみ。** サーバーを再起動するとアカウントもノートも消える。各環境（DEV / 本番）の確認項目は、それぞれ 1 プロセスの中で上から順に通す。

### サインイン状態の準備

**DEV（`pnpm dev`、`OAUTH_DEV_MODE=true`）**

1. `http://localhost:3000/signin` を開き、「Google で続ける」を押す。
2. 同意画面 `/dev/oauth/authorize?...` で、メールアドレス `nav@example.com` / 表示名 `ナビ太郎` を入力し、`email_verified` トグルを **ON** にして「許可する」を押す。
3. `/notes` に着けばサインイン済み（`hollow_session` Cookie が焼かれる）。

**本番ビルド（`pnpm build && pnpm start`、dev IdP は使えない）**

1. `http://localhost:3000/signup` で `nav@example.com` / パスワード `Passw0rd123` / 表示名 `ナビ太郎` を入力し、利用規約に同意して登録する。
2. `pnpm start` を動かしているターミナルの `mail.sent` ログ行にある `actionUrl`（`/verify-email?token=...`）を同じブラウザーで開く。`MEMORY_MAIL_LOG_ACTION_URL=true` が無いとこの URL は出ない（`packages/core/src/adapters/memory/mailSender.ts:43-60`）。
3. メール確認が通ると**その場でセッションが発行される**（`packages/core/src/application/identity/verifyEmail.ts:112`）のでサインイン済みになる。以降サインインし直すときは `/signin` でメール + パスワード。

**計測用のノートを 1 件作る（両環境で共通・必須）**

`/notes` で「新規作成」を押すと白紙ノートが作られて `/notes/{noteId}` へ遷移する（`apps/web/app/components/note/CreateNoteButton/index.tsx`）。この 1 件が AC-2 / AC-6b / AC-8 で使う一覧項目とノート詳細になる。作成直後の遷移はミューテーション経路なので**計測対象ではない**（一度 `/notes` に戻ってから測る）。

### `_serverFn` 往復の計測手順（AC-1〜AC-4 / AC-8 共通）

DevTools の Network を開き、フィルターに **`_serverFn`** を入力、**"Preserve log" を有効化**する（server function の既定ベースパスは `/_serverFn` — `@tanstack/start-plugin-core` の `schema.js:164`）。

本数と直列段数は、**Console から Resource Timing を読んで数値で判定する**。Network の Waterfall 目視には頼らない（plan.md 前置き「`Start Time` 列（数値）で判定する」）。判定に使うスニペット:

```js
console.table(
  performance.getEntriesByType("resource")
    .filter((e) => e.name.includes("/_serverFn"))
    .map((e) => ({
      fn: e.name.split("?")[0].split("/_serverFn/")[1],
      start: Math.round(e.startTime),
      end: Math.round(e.responseEnd),
    }))
);
```

1 シナリオの測り方（**preload 分とクリック以降を分けて数えるための手順**。plan.md「preload 要求の扱い」の 2 条件をそのまま手順化したもの）:

1. 遷移元のページに着き、Network が静止するまで待つ。
2. Console で `performance.clearResourceTimings()` を実行する。
3. **遷移先リンクにホバーし**（`defaultPreload: "intent"`。`defaultPreload` は計測中も外さない）、Network が再び静止するまで待つ。
4. 上のスニペットを実行する → これが **preload 欄**（本数には数えない。記録だけする）。
5. `performance.clearResourceTimings()` をもう一度実行する。
6. **リンクをクリック**する（ブラウザー戻るで測るシナリオでは 3〜5 を飛ばし、ここで戻るを押す）。
7. 画面が落ち着いたらスニペットを実行する → これが **本数（クリック以降）**。
8. Network パネルの ↓（Export HAR）で HAR を書き出し、`.thread/13/har/{before|after}-{シナリオ名}.har` に保存する。

判定:

- **本数** = 手順 7 の行数。
- **1 段（並列）** = すべての行が互いに重なっている（`max(start) < min(end)`）。
- **n 段（直列）** = ある行の `start` が別の行の `end` 以降にある連鎖の長さ。

**preload が in-flight のままクリックしない**こと。クリック前に静止を確認してから押す（in-flight のまま押すと `loadRouteMatch` の早期 return でガードの再実行がその遷移から落ち、本数が 1 本少なく出る — plan.md リスク欄）。

各シナリオは **`main` → ブランチの順で 2 回**測り、変更前 / 変更後の表を `.thread/13/` に残す（表の「変更前」列は設計上の期待値ではなく `main` の実測値で埋める）。

### デプロイ方法

なし（Node ランタイム一本。ローカルの `pnpm dev` と `pnpm build && pnpm start` で確認できる）。

## 確認項目

項目 1〜15 と項目 19 は DEV（`pnpm dev`）で上から順に通す。ただし項目 9 の後半と項目 11 は本番ビルドで測る（各項目に明記）。項目 19 は末尾に足した回帰項目だが **DEV で項目 14 より前**に通す（項目 14 でアカウントが消えるため）。項目 14（アカウント削除）はアカウントを消すので **DEV の最後**に回す。

### 1. `/notes` へのクライアント遷移が 1 本 / 1 段になる

- **対応する受け入れ基準:** AC-1
- **検証手段:** browser
- **目的:** root の `loadAppContext` と `/notes` の `beforeLoad` ガードが消え、断片ブリッジ 1 本だけになったことを実測する
- **手順:**
  1. サインイン済みで `/notes/{noteId}`（準備で作ったノート）を開く。
  2. 上部バーの「ノート一覧」リンクを対象に、「`_serverFn` 往復の計測手順」を 1〜8 の順で実行する。
  3. 同じ操作を `main` でも実行し、両方の値を記録する。
- **期待結果:** クリック以降の `_serverFn` が **1 本**（`renderNoteList`）で、**1 段**。`main` では 3 本 / 3 段（`loadAppContext` → `sessionUserFn` → `renderNoteList` が直列）になる。
- **確認ポイント:**
  - 一覧が描画され、上部バーに表示名が出ること（要求を減らして描画が壊れていないこと）。
  - preload 欄に `renderNoteList` が出るのは正常（本数には数えない）。
  - 2 本出たら root 側（ステップ 1）が入っていない可能性が高い。要求名で切り分ける。

### 2. `/notes/:noteId` へのクライアント遷移が 1 本 / 1 段になる

- **対応する受け入れ基準:** AC-2
- **検証手段:** browser
- **目的:** ノート詳細でもガードがブリッジに畳まれていることを実測する
- **手順:**
  1. `/notes` を開く。
  2. 一覧のノートカードを対象に、計測手順 1〜8 を実行する。
  3. `main` でも同じ操作を実行する。
- **期待結果:** クリック以降の `_serverFn` が **1 本**（`renderNoteDetail`）で、**1 段**。`main` では 3 本 / 3 段。
- **確認ポイント:** ノート本文が描画され、上部バーの「ノート一覧」リンクが出ること。`renderNoteDetail` は `user` を返さない設計なので、詳細画面に表示名が出ないのは正しい。

### 3. `/notes` → `/settings/profile`（外から入る）が 2 本同時 / 1 段になる

- **対応する受け入れ基準:** AC-3a
- **検証手段:** browser
- **目的:** `/settings` レイアウトのガードが `beforeLoad` から `loader` に移り、子の断片と並列に飛ぶことを実測する
- **手順:**
  1. `/notes` を開き、アカウントメニュー（右上のアバター）を開く。
  2. メニュー内の「設定」リンクを対象に、計測手順 1〜8 を実行する。
  3. `main` でも同じ操作を実行する。
- **期待結果:** クリック以降の `_serverFn` が **2 本**（`/settings` レイアウトのガードと `renderProfileForm`）で、**1 段**（`max(start) < min(end)` を満たす）。`main` では 3 本 / 3 段。
- **確認ポイント:** 2 本が「同時開始」であることをスニペットの `start` 値で確認する。片方の `start` がもう片方の `end` 以降なら並列化できていない。

### 4. `/settings/profile` → `/settings/auth`（タブ間）が 2 本同時 / 1 段になる

- **対応する受け入れ基準:** AC-3b
- **検証手段:** browser
- **目的:** タブ間遷移でも**レイアウトのガードが再実行される**こと（= `shouldReload` が効いていること）を実測する。**`shouldReload` の有無を DEV で判別できる唯一の観測点**（plan.md「計測環境の別」）
- **手順:**
  1. `/settings/profile` を開く。
  2. タブ列の「ログイン方法」を対象に、計測手順 1〜8 を実行する。
  3. `main` でも同じ操作を実行する。
- **期待結果:** クリック以降の `_serverFn` が **2 本**（レイアウトのガードと `renderIdentityList`）で、**1 段**。`main` では 3 本 / 3 段。
- **確認ポイント:**
  - **ここが 1 本（断片だけ）になったら `shouldReload` が入っていない。** レイアウト match は子ルート間遷移で `cause: "stay"` かつ `previousRouteMatchId === match.id` になるため、`shouldReload` が無いと DEV（`staleTime: 0`）でも loader が再実行されない。本数は減るが AC-6 の「ナビゲーションごとの再判定」を失うので**合格ではない**。
  - preload 欄にはレイアウトのガード要求も出る（アクティブ match には関数形の `cause !== "preload"` が効かないため）。これは後退ではない（エッジケース 3）。

### 5. `/settings/profile` → `/settings/danger`（タブ間・loader なし）が 1 本 / 1 段になる

- **対応する受け入れ基準:** AC-3c
- **検証手段:** browser
- **目的:** 断片を持たない子タブでは、残るのがレイアウトのガード 1 本だけであることを実測する
- **手順:**
  1. `/settings/profile` を開く。
  2. タブ列の「アカウント削除」を対象に、計測手順 1〜8 を実行する。
  3. `main` でも同じ操作を実行する。
- **期待結果:** クリック以降の `_serverFn` が **1 本**（レイアウトのガード）で、**1 段**。`main` では 2 本 / 2 段。
- **確認ポイント:** 削除パネルが描画され、タブ列と上部バーが従来どおり出ること。ここで**削除の実行はしない**（項目 14 で行う）。

### 6. 公開ルートへのクライアント遷移が 0 本になる

- **対応する受け入れ基準:** AC-4
- **検証手段:** browser
- **目的:** root の `loadAppContext` が消え、公開ルートの遷移で `_serverFn` が 1 本も出ないことを実測する
- **手順:**
  1. アカウントメニューからサインアウトする（`/` に着く）。
  2. 次の遷移を順に行い、**それぞれについて**計測手順 1〜8 を実行する:
     - `/` → 「サインイン」（`/signin`）
     - `/signin` → 「新しく作る」系のリンク（`/signup`）
     - `/signup` → 利用規約リンク（`/terms`）
     - `/terms` → フッターの「プライバシーポリシー」（`/privacy`）
     - `/signin` → 「パスワードをお忘れですか」（`/reset-password`）
     - `/verify-email` を URL 直開き（トークンなしでよい）→ 画面内の「サインインへ」で `/signin` に移り → **ブラウザー戻る**で `/verify-email` へ戻る（`/verify-email` へのアプリ内リンクは存在しないため、戻るがクライアント遷移の唯一の経路）
  3. `main` でも同じ 6 経路を実行する。
- **期待結果:** クリック（および戻る）以降の `_serverFn` が **すべて 0 本**。`main` ではいずれも 1 本（root の `loadAppContext`）。
- **確認ポイント:**
  - 0 本でも各ページの `<title>` が正しく変わること（`config` がルーターコンテキストから供給されている証拠。詳細は項目 7）。
  - `/` へ**戻る**方向の遷移は 0 本にならない（`/` の `beforeLoad` が `sessionUserFn` を 1 本撃つ）。これはスコープ外の記録項目で、エッジケース 4 で別に測る。

### 7. 代表ルートの `<head>` が変更前と一致する

- **対応する受け入れ基準:** AC-5
- **検証手段:** browser
- **目的:** `AppConfig` の供給経路を `beforeLoad` からルーターコンテキストへ差し替えても、17 箇所の `head` 出力が 1 文字も変わっていないことを確かめる
- **手順:**
  1. 代表 7 ルートを次の 2 経路それぞれで開く。
     - **SSR 初期 HTML**: `view-source:http://localhost:3000{パス}` を開く。
     - **クライアント遷移後の DOM**: アプリ内リンク（または戻る）で同じパスへ遷移し、DevTools の Elements で `<head>` を見る。
  2. 対象は `/`, `/signin`, `/terms`, `/notes`, `/notes/{noteId}`, `/settings/profile`, **未サインインの `/settings/danger`**。`/notes` 系と `/settings/profile` はサインイン済み、`/` と `/settings/danger` は未サインインで開く。
  3. 各ページで次のタグを抜き出してテキストファイルに保存する（`.thread/13/head/{before|after}-{ルート名}.txt`）: `<title>` / `<meta name="description">` / `<link rel="canonical">` / `og:*`（`og:type` `og:url` `og:title` `og:description` `og:image` `og:site_name` `og:locale`）/ `twitter:*`（`twitter:card` `twitter:title` `twitter:description` `twitter:image`）/ `<meta name="theme-color">`。
  4. `main` でも同じ 7 ルート × 2 経路で保存し、ファイル同士を突き合わせる。
- **期待結果:** 14 通り（7 ルート × SSR / クライアント遷移）すべてで、上記タグの値が `main` と**一致する**。とくに `canonical` と `og:url` が `APP_URL` + そのパスになっていること。
- **確認ポイント:**
  - **`head` の本体は 1 行も変えていない**ので、差が出たら供給経路（`dehydrate` / `hydrate` / `router.update({ context })`）の失敗。とくに**クライアント遷移側だけ空になる**なら `hydrate` が効いていない（`match.context?.config` が `undefined` で `head` が `{}` を返している）。
  - 未サインインの `/settings/danger` を含めるのは、親ガードが redirect を投げない分岐でも `config` が届くことを見るため。

### 8. 未サインインで保護ルートを直接開くと `/signin?redirect=...` に着く

- **対応する受け入れ基準:** AC-6a
- **検証手段:** browser
- **目的:** ガードをブリッジ / loader へ移しても、SSR 直開きの誘導と復帰が壊れていないことを確かめる
- **手順:**
  1. サインアウトした状態で、次の URL をアドレスバーから**直接**開く（フルロード）。
     - `http://localhost:3000/notes`
     - `http://localhost:3000/notes/{noteId}`
     - `http://localhost:3000/settings/auth`
     - `http://localhost:3000/settings`
  2. それぞれの着地 URL を記録する。
  3. `/notes` から飛ばされた `/signin?redirect=/notes` でサインインし、着地を確認する。
- **期待結果:**
  - `/notes` → `/signin?redirect=/notes`
  - `/notes/{noteId}` → `/signin?redirect=/notes/{noteId}`
  - `/settings/auth` → `/signin?redirect=/settings/auth`
  - `/settings` → **`/signin?redirect=/settings/profile`**（`/settings/` index の `beforeLoad` がレイアウトの認証判定より先に走るため。`main` は `/signin?redirect=/settings`）
  - 手順 3 のサインイン後、`/notes` に戻る。
- **確認ポイント:** `/settings` だけ `main` と観測値が変わるのは**期待どおり**（plan.md AC-6a）。最終的な着地画面は同じ `/settings/profile` になる。

### 9. 別タブでサインアウトしたあと、既訪の `/notes` に戻るとガードが再判定される

- **対応する受け入れ基準:** AC-6b
- **検証手段:** browser
- **目的:** ガードを `loader` へ移しても `staleTime` とキャッシュに鮮度を支配させていないこと（`shouldReload` が効いていること）を、DEV と本番の両方で確かめる
- **手順（DEV / 本番ビルドで各 1 回、同じ順序で）:**
  1. タブ A でサインインし、`/notes` を開く。
  2. タブ A で一覧のノートをクリックして `/notes/{noteId}` へ遷移する（**この時点で両方を訪問済みにする**）。
  3. **そのあとで**タブ B（同じブラウザーの別タブ）で `http://localhost:3000/settings/profile` などを開き、アカウントメニューからサインアウトする。
  4. タブ A に戻り、**ブラウザー戻る**（または上部バーの「ノート一覧」リンク）で `/notes` へ移動する。
  5. 着地 URL を記録する。
- **期待結果:** DEV・本番ビルドの**どちらでも** `/signin?redirect=/notes` に着く。
- **確認ポイント:**
  - **サインアウトを手順 3 より前に行わないこと。** 先にサインアウトすると `/notes/{noteId}` がその時点で初めて作られる match になり、`shouldReload` を参照しない枝で loader が走って `/signin?redirect=/notes/{noteId}` に着く。観測したいのは**既訪の `/notes` match へ戻る**経路。
  - **`shouldReload` の有無を判別できるのは本番側の 1 回だけ。** DEV は `cause === "enter"` だけで再取得されるため `shouldReload` が無くても同じ結果になる（DEV 実行は「環境差が消えたこと」の確認としてのみ記録する）。本番でノート一覧が表示されたままなら `shouldReload` が入っていない。
  - 本番ビルドでの実行時は、サインイン状態の作り方が DEV と違う（「サインイン状態の準備」の本番ビルド節）。

### 10. 未サインインの断片ブリッジは遷移元パスを検証してから `/signin` へ倒す

- **対応する受け入れ基準:** AC-7
- **検証手段:** browser
- **目的:** ガードがサーバー側へ移ったことで新しく転送境界の入力になった `redirect` に、オープンリダイレクトと長さの両方の防御が効いていることを確かめる
- **手順:**
  1. サインイン済みで `/notes` へクライアント遷移し、Network の `renderNoteList` の `_serverFn` 要求を右クリック → **Copy as fetch**。
  2. Console に貼り、**まだ実行しない**。URL の `payload` クエリー（URL エンコードされた JSON）を `decodeURIComponent` して構造を確認する:
     ```js
     const u = new URL("<コピーした URL>");
     console.log(decodeURIComponent(u.searchParams.get("payload")));
     ```
  3. アカウントメニューからサインアウトする（Cookie が落ちる）。
  4. `redirect` の値を次の 4 つに差し替えて、それぞれ再送する。**JSON の値として何が入るか**で判定が分かれるので、`payload` は文字列置換ではなく `JSON.parse` → 値を書き換え → `JSON.stringify` → `encodeURIComponent` の順で組み立てる:
     `//evil.example` / `https://evil.example` / `/\evil.example` / **生の LF を含む** `"/\n/evil.example"`
  5. 同じ手順で `redirect` を **文字列 `"/%0Aevil"`**（パーセントエンコードのまま。生の LF に戻さないこと）にして再送する。
  6. 同じ手順で `redirect` に **2049 文字**の文字列（例 `"/" + "a".repeat(2048)`）を入れて再送する。
- **期待結果:**
  - 手順 4 の 4 検体はいずれも応答 JSON に `"isSerializedRedirect": true` を含み、遷移先が **`/signin`**、その `redirect` が **`/notes`** になる（`evil.example` も生の LF も応答のどこにも現れない）。
  - 手順 5 は **`/signin?redirect=/%0Aevil`（`"/%0Aevil"` がそのまま載るのが正）**。同一オリジンパスとして受理される検体であり、`/notes` に倒れたら述語が変わっている。
  - 手順 6 は **HTTP 422**（`.validator` の上限超過。`kind: "validation"` / `code: "INVALID_INPUT"`）。**400 ではない。**
- **確認ポイント:**
  - 応答に外部オリジンがそのまま載ったら `safeRedirectPath` を通していない。
  - **述語（`SameOriginPolicy.isSameOriginPath`）はパーセントエンコードを復号しない。** だから `"/%0Aevil"` は制御文字を含まない同一オリジンパスとして通る（手順 5）。復号が不要な根拠は、この値の最終消費点が `SignInForm`（`apps/web/app/components/auth/SignInForm/index.tsx`）の `router.history.push(redirectTo)` に渡る生文字列で、別オリジンへ解決しないこと。次に同じ疑いを持つ人が調査をやり直さないための注記。
  - 422 が 400 になったら、`validateInput` 以外の経路でエラーが作られている。
  - Copy as fetch は Cookie を同送するので、手順 3 のサインアウトを飛ばすと普通に断片が返ってしまう。

### 11. 本番ビルドで戻ったとき 1 本の背景再取得になり、スケルトンに戻らない

- **対応する受け入れ基準:** AC-8
- **検証手段:** browser
- **目的:** `shouldReload` による再実行が**背景で**走って遷移が即座に settle すること、および**その差し替えでスケルトンに巻き戻らない**ことを本番ビルドで確かめる。後者の根拠は背景枝ではなく `Deferred` の `use(useDeferredValue(promise))`（ADR-005）— 背景枝の `updateMatch` は `loaderData` を未解決の断片 promise ごと差し替え、その更新は SyncLane で届くので、消費側が deferred lane に載せていなければマウント済みの `<Suspense>` はフォールバックへ戻る。**React ランタイムの挙動に依存する判断なので、本番実測が合格条件**
- **手順:**
  1. `.env` を本番ビルド用に直し、`pnpm build` → `pnpm start`。起動ログの URL を開く。
  2. メール + パスワードでサインインし、ノートを 1 件作る。
  3. `/notes` → 一覧のノートをクリック → `/notes/{noteId}`。
  4. DevTools の Network で throttling を「Slow 4G」程度にする。
  5. 計測手順の 5〜8（`performance.clearResourceTimings()` → **ブラウザー戻る** → スニペット → HAR）を実行し、戻る操作中の画面を観察する。
  6. **スケルトンの再表示を目視だけで判定しない。** 戻る操作の**前**に Console で次を仕込み、戻ったあと `window.__skel` の要素数と時刻を読む（0 件が合格）。戻る操作は 4 回繰り返し、毎回 0 件であることを見る。
     ```js
     window.__skel = [];
     const t0 = performance.now();
     new MutationObserver(() => {
       if (document.querySelector('main[aria-busy="true"]')) {
         window.__skel.push(Math.round(performance.now() - t0));
       }
     }).observe(document.body, { childList: true, subtree: true });
     ```
     セレクターの根拠: `NoteListSkeleton` は `<main aria-busy="true">` を出す（`apps/web/app/components/note/NoteListSkeleton/index.tsx:18-19`）。本体の `NoteList` は `aria-busy` を持たない。
- **期待結果:**
  - 戻る以降の `_serverFn` が **1 本**（`renderNoteList`）。
  - 遷移は**即座に settle** し、**前回の一覧が表示されたまま**新しい内容に置き換わる。
  - **戻る操作の直後に `NoteListSkeleton` が再表示されない**（手順 6 の観測で 4 回とも 0 件）。**これが本項目の主眼**で、要求本数だけを数えて合格にしない。
- **確認ポイント:**
  - **0 本なら `shouldReload` が入っていない**（`staleTime: Infinity` のキャッシュに埋もれている）。
  - **2 本なら root 側（ステップ 1）が入っていない**（`loadAppContext` が毎ロード飛んでいる）。
  - **スケルトンが 1 件でも出たら不合格。** 原因は「背景再取得が同期ロードに落ちている」か「`Deferred` が `useDeferredValue` を通していない」のどちらかで、後者なら戻る操作の数十 ms 後（`Deferred` 修正前の実測では 21ms 後）に 1 件出る。要求が 1 本で `Start Time` も即時なのにスケルトンが出るなら後者。
  - **`/notes` 系に `staleReloadMode: "blocking"` を足して直そうとしないこと。** blocking が await するのは loader（ガード 1 往復）だけで、commit 時点の断片 promise は未解決のままなのでスケルトンは出たまま、URL 確定が遅れるだけになる（ADR-005 の却下案）。

### 12. `/notes` 系はブリッジ応答の完了前にスケルトンが出る

- **対応する受け入れ基準:** AC-9a
- **検証手段:** browser
- **目的:** ブリッジが断片 promise を**未解決のまま**返しており、loader が await していないことを確かめる（断片を await してしまう実装ミスを落とす基準）
- **手順:**
  1. DEV でサインインし、`/notes/{noteId}` を開く。
  2. Network throttling を「Slow 4G」にする。
  3. `/notes` へ**初回**のクライアント遷移を行う（計測手順の 1〜3 でホバー preload を済ませてから測ると preload 結果が再利用されて観測できないため、**この項目だけはホバーせずに直接クリック**し、Network で `renderNoteList` が in-flight の間の画面を見る）。
  4. `/notes` から `/notes/{別のノート}` へも同様に行う（ノートが 1 件しか無ければ 1 件追加する）。
- **期待結果:** **ガードの 1 往復（ブリッジのハンドラー本体が返るまで）ぶんは遷移がブロックされる**。そのあと URL が確定して `NoteListSkeleton` / `NoteDetailSkeleton` が表示され、**断片が届いた時点で**本体に差し替わる。
- **確認ポイント:**
  - **断片の中身が届くまで URL が変わらない・スケルトンが出ないなら、loader が断片を await している**（落としたい実装ミス）。見分けは「`renderNoteList` の応答受信が始まってからスケルトンが出るまでの間に、断片の内容が届いているか」。
  - **`RoutePendingFallback`（`defaultPendingMs: 200`）が挟まっても不合格ではない。** ガードの 1 往復ぶんはブロックするので、Slow 4G ではむしろ挟まるのが普通。`/settings/profile`（項目 13）と構造は同型で、違うのは往復の内訳だけ。「`/notes` は 0 往復で settle する」という読み方をしない。

### 13. `/settings/profile` はガード応答のあとに URL が確定する

- **対応する受け入れ基準:** AC-9b
- **検証手段:** browser
- **目的:** `/settings` レイアウトの loader が**本物のブロッキング loader**（`sessionUserFn()` を await し、`staleReloadMode: "blocking"` で既訪 match の再実行も背景枝へ落とさない）であることを確かめる
- **手順:**
  1. DEV でサインインし、`/notes` を開く。
  2. Network throttling を「Slow 4G」にする。
  3. アカウントメニューの「設定」を（ホバー preload を待たずに）クリックし、URL が変わるタイミングと画面を観察する。
- **期待結果:** **レイアウトのガード応答が返ってから** URL が `/settings/profile` に確定し、子の断片スケルトンが表示される。ガード応答が 200ms を超えると `RoutePendingFallback` が挟まる。
- **確認ポイント:**
  - **AC-9a と構造は同型**（どちらもガード 1 往復ぶんブロックしてから settle し、断片はスケルトンでストリームする）。違うのは往復の内訳だけで、`/notes` 系はガードと断片が 1 要求に畳まれ、`/settings/*` はガードと断片が別 match の 2 要求として並列に走る。
  - **`main` と比べて「`defaultPendingComponent` の有無が変わった」と記録しないこと。** 変更前の `beforeLoad` も `sessionUserFn()` を await しており、同じフォールバックが掛かっていた。本 Issue で変わるのは待ち時間の長さ（3 段 → 1 段）だけで、短くなる方向。

### 14. 未サインインで `/settings/danger` が開け、受理直後のリロードで進捗が復帰する

- **対応する受け入れ基準:** AC-11
- **検証手段:** browser
- **目的:** ガードを `beforeLoad` から `loader` へ移す唯一の分岐条件（`SIGNED_OUT_PATH`）が両方向で生きていることを確かめる
- **手順:**
  1. **未サインイン直開き**: サインアウトした状態で `http://localhost:3000/settings/danger` をアドレスバーから開く。
  2. 画面を確認したら、あらためてサインインする（アカウントが無ければ「サインイン状態の準備」から作り直す）。
  3. `/settings/danger` を開き、確認欄にアカウントのメールアドレス（`nav@example.com`）を入力して「アカウントを削除する」を押す。
  4. 受理表示（「アカウントを削除しています」など）が出たら、**その画面をリロード**する。
  5. リロード後の画面を確認する。
- **期待結果:**
  - 手順 1: `/signin` へ飛ばずに `/settings/danger` のパネルが描画される（この状態では上部バーもタブ列も出ない）。
  - 手順 5: `/signin` へ飛ばず、`sessionStorage` に退避された ticket から**進捗表示が復帰する**（「アカウントを削除しています」または終端の「アカウントを削除しました」）。空の削除フォームに戻らない。
- **確認ポイント:**
  - 手順 4 の時点で**セッションは既に失効している**（受理と同時にサインアウトされる）ので、手順 5 は「未サインインで `/settings/danger` を開く」経路そのもの。ここで `/signin` に飛んだら `SIGNED_OUT_PATH` の分岐が `loader` 移行で落ちている。
  - **この項目でアカウントが消える**ので DEV の最後に回す。以降の確認を続けるならサーバーを再起動して作り直す。

### 15. 上部バーに表示名とアバターが従来どおり出る

- **対応する受け入れ基準:** AC-12
- **検証手段:** browser
- **目的:** `user` の供給源が `routeContext` から `loaderData` に移っても `AppShell` の描画が壊れていないことを確かめる
- **手順:**
  1. サインイン済みで `/settings/profile` を開き、アバター画像を 1 枚設定する。
  2. `/notes` へ遷移し、上部バー右上を確認する。
  3. `/settings/profile` / `/settings/auth` / `/settings/usage` / `/settings/danger` を順に開き、上部バーを確認する。
  4. アカウントメニューを開き、表示名の行を確認する。
- **期待結果:** すべての画面で上部バーにアバター画像が出る（未設定なら表示名先頭 2 文字のイニシャル）。アカウントメニューに表示名が出る。
- **確認ポイント:** `/notes/{noteId}` の `ReaderShell` には元から上部バーのアカウント要素が無い（「ノート一覧」リンクだけ）。これは仕様どおりで、`renderNoteDetail` が `user` を返さないことと整合する。

### 16. 品質ゲート

- **対応する受け入れ基準:** AC-10
- **検証手段:** api
- **目的:** 型検査・Lint・整形・単体テストがすべて緑であることを確かめる
- **手順:** リポジトリルートで順に実行する。
  1. `pnpm typecheck`
  2. `pnpm lint:fix`
  3. `pnpm format`
  4. `pnpm test`
- **期待結果:** 4 つとも終了コード 0。`pnpm test` に `apps/web/app/presentation/__tests__/redirect.test.ts` が含まれ、全ケースが pass する。
- **確認ポイント:**
  - `Register.router` を `Awaited<ReturnType<typeof getRouter>>` に直し忘れると `pnpm typecheck` がルーター型のエラーを大量に出す。
  - `redirect.test.ts` は**変更しない**（既存ケースがそのまま通ることが `SameOriginPolicy.isSameOriginPath` への委譲の回帰網）。ここが落ちたら委譲で挙動が変わっている。

### 17. ドキュメントから「ガードとハンドラーの二重化」の記述が消えている

- **対応する受け入れ基準:** AC-13
- **検証手段:** api
- **目的:** `docs/frontend_implementation_example.md` の**2 箇所**にある同一主張（L.113 と L.545）が両方とも書き換わり、統合後の分担が書かれていることを確かめる
- **手順:** リポジトリルートで実行する。
  ```
  grep -n "defense in depth" docs/frontend_implementation_example.md
  grep -n "the pair is intentional" docs/frontend_implementation_example.md
  grep -n "return 401" docs/frontend_implementation_example.md
  grep -c "requireSessionOrRedirect" docs/frontend_implementation_example.md
  grep -c "shouldReload" docs/frontend_implementation_example.md
  ```
- **期待結果:** 最初の 3 つは**出力なし**（終了コード 1）。`requireSessionOrRedirect` と `shouldReload` の件数はいずれも **1 以上**。
- **確認ポイント:**
  - L.113 だけ直して L.545 を残すと 2 番目の grep が引っかかる（同じ節に AC-14 の掲載も同居しているため、AC-13 と AC-14 は同じ節で共倒れする）。
  - `return 401` を残してよいのは「主体が無効なら 401」の側だけ。grep が引っかかった行を読み、**ガードとハンドラーの二重化を根拠にした 401** でないことを確認したうえで判断する（文面が変わっているなら合格）。

### 18. `requireAuthenticated` の参照がリポジトリに残っていない

- **対応する受け入れ基準:** AC-14
- **検証手段:** api
- **目的:** 死んだ導線（コード側 1 箇所 + docs 側 4 箇所）が完全に消えたことを確かめる
- **手順:** リポジトリルートで実行する。
  ```
  grep -rn "requireAuthenticated" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.thread .
  grep -n "safeRedirectPath" apps/web/app/presentation/auth.ts
  ```
- **期待結果:** 1 つ目は**出力なし**（終了コード 1）。2 つ目も**出力なし**（`auth.ts` から再輸出が外れ、残るのは `sessionUserFn` だけ）。
- **確認ポイント:**
  - `.thread/` を除外するのは計画・ADR に語として出てくるため。実装と docs だけを見る。
  - コード側（ステップ 5）だけを消しても `docs/frontend_implementation_example.md` の 4 箇所が残っていれば通らない。ステップ 6 とセットで初めて閉じる。

### 19. `Deferred` の deferred lane 化が他の断片ルートを壊していない

- **対応する受け入れ基準:** AC-9a の不変性を守る回帰項目（ADR-005 / 新しい AC は立てない）
- **検証手段:** browser
- **目的:** `Deferred`（`use(useDeferredValue(promise))`）は `/notes` 系だけでなく `/settings/{profile,auth,usage}` の 3 断片からも使われる。deferred lane 化で **(a) 初回マウントのスケルトンが出なくなる**、**(b) ミューテーション後の `router.invalidate()` で内容が更新されない**、のどちらも起きていないことを確かめる
- **手順:** DEV で、Network throttling を「Slow 4G」にしてから通す。
  1. サインイン済みで `/notes` を開き、アカウントメニューの「設定」をクリックする（**初回**遷移）。設定カラムの表示を観察する。
  2. `/settings/auth`、`/settings/usage` へも**初回**遷移し、同じく設定カラムを観察する。
  3. `/notes` へ**初回**遷移し、一覧が出るまでの表示を観察する（項目 12 と同じ観測。ここでは再確認）。
  4. `/settings/profile` で表示名を変更して保存し、保存後の表示を観察する。
  5. `/settings/auth` でログイン方法を 1 つ追加（または解除）し、一覧の変化を観察する。
  6. `/notes` で「新規作成」→ 詳細 → 上部バーの「ノート一覧」で戻り、一覧に 1 件増えていることを見る。
- **期待結果:**
  - 手順 1〜3（**初回マウント**）: `ProfileFormSkeleton` / `IdentityListSkeleton` / `UsagePanelSkeleton` / `NoteListSkeleton` が**出る**。**これが正**（`useDeferredValue` は初回に前の値を持たないのでそのままサスペンドする。**AC-9a は不変**）。
  - 手順 4〜6（**ミューテーション後の `router.invalidate()`**）: 前の内容が表示されたまま、新しい断片が解決した時点で置き換わる。数秒以内に必ず新しい値（表示名 / ログイン方法 / ノート 1 件）に**更新される**。
- **確認ポイント:**
  - **初回でスケルトンが出なくなっていたら不合格。** `useDeferredValue` に `initialValue` を渡している疑い（渡すと初回も前の値扱いになる）。ストリーミングの初回フォールバックは `CLAUDE.md` のフロントエンド規約が要求している側なので、消してはいけない。
  - **手順 4〜6 で内容が古いまま戻らないなら不合格。** deferred lane の再レンダリングが走っていない（差し替え後の promise が同一参照になっている疑い）。`router.invalidate()` から数秒待っても変わらなければここを疑う。
  - ミューテーション後にスケルトンへ**巻き戻る**のは deferred lane 化の目的（前の内容を残す）に反するので、これも不合格として記録する。

## エッジケース・異常系

### 1. 未サインインで `/settings/profile` を SSR 直開きしたときの HTML 応答が 307 である

- **検証手段:** browser
- **目的:** ガードを `loader` へ移した結果、子の断片 loader が親のガードと**並列に**発火して 401 を 1 本打つ組み合わせが新しく生まれる。それがドキュメント応答のステータスを汚さないことを 1 回だけ確かめる（plan.md リスク欄 / 手動 7）
- **手順:**
  1. サインアウトし、DevTools の Network を開いて "Preserve log" を有効にする。
  2. `http://localhost:3000/settings/profile` をアドレスバーから直接開く。
  3. Doc 種別の要求（`/settings/profile`）のステータスを確認する。
  4. 同じ Network に残る `_serverFn` 要求のステータスも確認する。
- **期待結果:** Doc 応答は **307**（`/signin?redirect=/settings/profile` へ）。`renderProfileForm` の `_serverFn` が **401** で 1 本残るのは想定内で、これは画面には出ない。
- **確認ポイント:** Doc 応答が 401 になったら、断片側の `setResponseStatus(401)` がドキュメント応答へ漏れている。ここだけは実測で 1 回押さえる（現状の `main` では起きない組み合わせ）。

### 2. preload が in-flight のままクリックすると本数が 1 本少なく出る

- **検証手段:** browser
- **目的:** 計測手順の「preload 完了後にクリックする」条件を守らないと AC-1〜AC-4 の数値がずれることを、意図的に再現して把握しておく
- **手順:**
  1. `/notes/{noteId}` から「ノート一覧」リンクにホバーし、**preload の応答を待たずに**すぐクリックする。
  2. 計測スニペットで本数を読む。
- **期待結果:** クリック以降の `_serverFn` が **0 本**になることがある（`loadRouteMatch` が進行中の `loaderPromise` を見て早期 return するため）。画面は正常に描画され、redirect も背景ロード側で拾われる。
- **確認ポイント:** これは**不具合ではない**。この形で測った数値を AC の実測値として記録しないこと。記録済みの HAR がこの状態でないかは、preload 欄とクリック欄の要求名が重複していないかで見分ける。

### 3. `/settings` のタブにホバーするたびレイアウトのガード要求が 1 本飛ぶ

- **検証手段:** browser
- **目的:** `shouldReload: ({ cause }) => cause !== "preload"` の関数形が preload を抑止できるのは cached match だけで、アクティブなまま残る `/settings` レイアウトには効かないこと（= 後退ではないこと）を確認しておく
- **手順:**
  1. `/settings/profile` を開き、Network を `_serverFn` で絞る。
  2. タブ列の「ログイン方法」「使用量」に順にホバーする（クリックはしない）。
  3. 飛んだ要求の本数と種類を記録する。
  4. `main` でも同じ操作を行う。
- **期待結果:** ホバーごとにレイアウトのガード要求 + 子の断片 preload が飛ぶ。**`main` と本数が変わらない**（`main` の `beforeLoad` ガードも `executeBeforeLoad` にキャッシュ判定が無いため今すでにホバーのたび飛んでいる）。
- **確認ポイント:**
  - `main` より増えていたら `shouldReload` を真偽値の `true` で書いている疑い（`preloadStaleTime` まで無効化され、読み込み済みの `/notes/` `/notes/$noteId` にホバーするたびにも要求が飛ぶ）。**`/notes` 側でホバーを繰り返して要求が飛ばないこと**もあわせて見る。
  - ここで見るのは**サインイン済み**でのホバー。**セッションが失効している状態でのホバー**は別の危険（クリックしていないのに `/signin` へ飛ばされる）なのでエッジケース 5 で測る。

### 4. `/` へのクライアント遷移が 1 本になる（スコープ外の記録項目）

- **検証手段:** browser
- **目的:** 「`loadAppContext` が消えたあと `/` の下限は 1 往復（`sessionUserFn` のみ）」という除外の根拠を事後に裏づける
- **手順:**
  1. **未サインイン**で `/signin` を開く。
  2. 画面上部のロゴ（`AuthLayout` の「Hollow のトップへ」）を対象に、計測手順 1〜8 を実行する。
- **期待結果:** クリック以降の `_serverFn` が **1 本**（`sessionUserFn`）で、1 段。`main` では 2 本。
- **確認ポイント:** **サインイン済みの `/notes` → `/` では測らない。** `AppShell` に `/` へのリンクは無く、仮に起こしても `routes/index.tsx` の `beforeLoad` がサインイン済みを `/notes` へ redirect し返すので、`/notes` の loader がもう 1 本走って 1 本にならない。これは AC ではなく記録項目。

### 5. セッション失効後に `/settings` のタブへホバーしても `/signin` へナビゲートしない

- **検証手段:** browser
- **目的:** `/settings` レイアウトの loader が**非ブロッキング**だと、ホバー（preload）で走った loader の redirect を `load-matches` の背景枝（デタッチされた promise の catch）が `router.navigate` で拾い、**クリックしていないのに**画面が `/signin` へ奪われる。`main` の `beforeLoad` ガードでは起きない後退なので、`main` と同じ挙動に揃っていることを確認する
- **手順:**
  1. タブ A でサインインし、`/settings/profile` を開く。Network を `_serverFn` で絞り "Preserve log" を有効にする。
  2. タブ B（同じブラウザーの別タブ）で同じアカウントをサインアウトする。
  3. タブ A に戻り、タブ列の「ログイン方法」「使用量」の上に**マウスを乗せるだけ**（クリックしない）。数秒待つ。
  4. アドレスバーの URL と画面表示を記録する。
  5. `main` でも 1〜4 を実行する。
- **期待結果:** URL は **`/settings/profile` のまま**で `/signin` へナビゲートしない。ホバーぶんのガード要求は飛び、その応答は redirect だが、preload の解決として握り潰される。**`main` と同じ挙動**になる。
- **想定内（退行として記録しない）:** ホバーだけで**子断片の 401 が 1 本飛び**（レイアウト match はアクティブなので `cause: "stay"` → `shouldReload` 真 → ガードが redirect する一方、同じ tick で着火済みの子断片 loader は `requireSession()` で 401 を返し切る）、その cached match が `status: "error"` のまま残る。**クリックすれば `status !== "success"` で再実行され、レイアウトの redirect が遷移を奪うので `/signin?redirect=/settings/...` に着く**（エッジケース 6）。画面には `ServerErrorState` は出ない。
- **確認ポイント:**
  - **`/signin?redirect=/settings/profile` へ飛んだら不合格。** レイアウトの loader が非ブロッキングのままである（背景枝の `router.navigate` は preload かどうかを見ない）。`loader: { handler, staleReloadMode: "blocking" }` の**オブジェクト形**になっているかを見る — **関数形の loader に `staleReloadMode` を書いても参照されない**。
  - `/settings/danger` で削除を受理した直後（セッションが消えたままその場に留まる画面）でも同じ操作を 1 回試す。ここで飛ばされると AC-11 の「その場に留まる」が失われる。

### 6. セッション失効後に `/settings` のタブをクリックすると `/signin?redirect=<タブのパス>` に着く

- **検証手段:** browser
- **目的:** 未サインインで `/settings/*` へ**クライアント遷移**する経路（エッジケース 1 の SSR 直開きと対になる経路）で、親のガードと並列に走る子の断片 401 が画面に出ないことを確かめる。AC-6a は SSR 直開き、AC-6b は `/notes` 系なので、この組み合わせを見るのはここだけ
- **手順:**
  1. タブ A でサインインし、`/settings/profile` を開く。Network を `_serverFn` で絞り "Preserve log" を有効にする。
  2. タブ B でサインアウトする。
  3. タブ A に戻り、タブ列の「ログイン方法」を**クリック**する。
  4. 着地 URL と、遷移中の設定カラムの表示を記録する。Network に残る `_serverFn` のステータスも見る。
- **期待結果:** **`/signin?redirect=/settings/auth`** に着く。遷移の間、設定カラムに `ServerErrorState` が閃かない。`renderIdentityList` の 401 が 1 本残るのは想定内で、画面には出ない。
- **確認ポイント:**
  - URL がいったん `/settings/auth` に確定してから `/signin` へ飛ぶ、または `ServerErrorState` が一瞬でも出るなら、レイアウトのガードが遷移をブロックしていない（エッジケース 5 と同じ原因）。
  - 着地が `/signin?redirect=/settings/profile`（遷移元のパス）になっていたら、ガードが読む遷移先が確定前の `location` になっている。

## 既存機能への影響確認

- **ノートの新規作成**（`CreateNoteButton`）— `router.invalidate()` → `/notes/$noteId` へ遷移、の順で走る。`shouldReload` を入れた 3 ルートでは `staleTime` が参照されなくなるため、invalidate との組み合わせが変わっていないかを見る。確認方法: `/notes` で「新規作成」を押し、作成した詳細画面へ遷移すること、戻ったときに一覧へその 1 件が増えていること。
- **サインアウト**（`AccountMenu` → `window.location.assign("/")` のフルナビゲーション）— ルーターごと破棄してキャッシュを捨てる導線。確認方法: `spec/manual-tests/account.md` TC-12 をそのまま通す。
- **アカウント削除**（`DeleteAccountPanel`。`useRouteContext({ from: "/settings" })` → `useLoaderData({ from: "/settings" })` に変わる）— 確認方法: `spec/manual-tests/account.md` TC-14 をそのまま通す。加えて本計画の項目 14（未サインイン直開き / 受理直後のリロード）を必須級の回帰として実施する（TC-14 にも L.80 にも「未サインインで `/settings/danger` を開く」手順は無いため）。
- **`/settings/*` の各断片とその楽観更新**（`ProfileForm` のアバター差し替え、`IdentityList` の追加 / 解除）— レイアウトのガードが `loader` に移り、子の断片と並列に走るようになる。確認方法: `/settings/profile` で表示名とアバターを変更、`/settings/auth` でログイン方法の追加 / 解除を 1 往復ずつ行い、楽観 UI と `router.invalidate()` 後の再取得が従来どおりであること。
- **`/storage/$`（アバター配信のサーバールート）** — `createStartHandler` の `handleServerRoutes` は要求ごとに `getRouter()` を呼ぶ。`getRouter()` が async になり `resolveAppConfig()` → `getContainer()` を通るようになるので、要求スコープ外で壊れるならここが最初に出る。確認方法: アバター設定後に `/notes` を開き、上部バーの画像（`/storage/...`）が 200 で返ること。
- **未サインインの断片要求（401）** — `renderNoteList` / `renderNoteDetail` は未サインインで redirect を throw するようになるが、`/settings` の子断片は従来どおり 401 のまま。確認方法: エッジケース 1 で Network に残る 401 が 1 本であることを見る。
- **dev IdP の同意画面 `/dev/oauth/authorize`** — `head` が `match.context?.config` を読む 17 箇所のひとつで、loader を持つ公開ルート。確認方法: DEV でサインインの往復を 1 回通し（サインイン状態の準備）、同意画面のタイトルが「開発用 ID プロバイダー — ...」になっていること。
- **サーバー再起動でデータが消える** — 永続化は in-memory。DEV / 本番それぞれの確認項目は 1 プロセス内で通し、途中でサーバーを落としたらサインインからやり直す。
