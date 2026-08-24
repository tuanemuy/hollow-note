# 動作確認計画 — Issue #21: identityRemovalRelease の解放判定と beginRelease のあいだの TOCTOU を閉じる

**Issue:** #21
**作成日:** 2026-08-24

---

## 確認環境

このIssueの変更を確認するために必要な手順のみ記載（依存パッケージのインストール等、プロジェクト全体のセットアップは省略）。

本 Issue が閉じるのは `IdentityUniqueDirectory` の恒久 claim を巡る**並行性の窓**で、窓そのもの（判定 UoW のコミット直後に割り込む再連携、`activate` 喪失 + `reserved` の TTL 失効、`beginRelease` 済み・`release` 前の中断）は**ブラウザーからは再現できない**。実機で観測するのは「契約変更後も、利用者から見た identity の連携・解除・再連携・鍵の解放が従来どおり動くこと」であり、窓を閉じたことそのものは注入テスト（`api` 項目 7〜9）で観測する。

### 環境変数（起動前に必須）

`apps/web/.env` が次の 3 行であること（現在の内容と同じ）。

```
APP_URL=http://localhost:3100
OAUTH_DEV_MODE=true
MEMORY_MAIL_LOG_ACTION_URL=true
```

- `OAUTH_DEV_MODE=true` — Google 資格情報なしで OAuth の往復を回すループバック IdP。同意画面はアプリ内ルート `/dev/oauth/authorize`（`apps/web/.env.example`「1. Loopback dev IdP」/ `apps/web/app/routes/dev/oauth/authorize.tsx`）。**これが無いと本計画の browser 項目はほぼすべて実行できない**（Google 資格情報も無ければ起動が失敗する — `.env.example`「Exactly one of the two setups below must be configured or boot fails」）。
- `MEMORY_MAIL_LOG_ACTION_URL=true` — メール確認リンクを起動ターミナルの `mail.sent` 行の `actionUrl` に出す（`packages/core/src/adapters/memory/mailSender.ts:60`）。項目 2 / 6 のパスワード登録で必要。
- **待ち受け URL は `APP_URL` のポートで決まる。** `apps/web/vite.config.node.ts:14` が `APP_URL` の port を読んで `server.port` に渡すので、上記の `.env` では `pnpm dev` は **`http://localhost:3100`** で待ち受ける。本計画の URL はすべてこの基点で書く。`APP_URL` を変えると認可 URL / `redirect_uri` ごと移動するので、変えた場合は本文中の `3100` を読み替える。

### 検証環境の起動

すべてリポジトリルートで実行する。

| 用途 | コマンド | 出典（実ファイルで確認） |
| --- | --- | --- |
| 開発サーバー | `pnpm dev` | root `package.json` の `scripts.dev`（→ `@repo/web` の `dev:node` = `vite dev --config vite.config.node.ts`）/ `README.md`「Quick Start」/ `CLAUDE.md`「Development Commands」。URL は `http://localhost:3100`（上記） |
| 型検査 | `pnpm typecheck` | root `package.json` の `scripts.typecheck`（`tsgo && pnpm -r typecheck`）/ `CLAUDE.md`「After changes」 |
| Lint（自動修正） | `pnpm lint:fix` | root `package.json` の `scripts.lint:fix`（`biome check --write`）/ `CLAUDE.md` |
| 整形 | `pnpm format` | root `package.json` の `scripts.format`（`biome format --write`）/ `CLAUDE.md` |
| 単体テスト・適合スイート | `pnpm test:unit`（`pnpm test` は別名） | root `package.json` の `scripts.test:unit`（`vitest run`）/ `README.md`「Development commands」。設定は root `vitest.config.ts`（`spec/**` を除外、`TZ=Asia/Tokyo`、`testTimeout: 10_000`） |
| 本番ビルド | `pnpm build` | root `package.json` の `scripts.build` → `@repo/web` の `build:node` |
| 本番起動 | `pnpm start` | root `package.json` の `scripts.start` → `@repo/web` の `start:node`（`tsx scripts/listen.node.ts`） |

**テストの部分実行**（api 項目 7〜9 で使う。本計画の作成時に実際に実行して動作を確認済み）:

```
pnpm exec vitest run <テストファイルのパス> --reporter=verbose
```

`vitest` は root `package.json` の devDependency で、`--reporter=verbose` は `describe` / `it` 名を 1 行ずつ出力する。このリポジトリのテスト名は `ADP-identity-041: ...` / `TC-identity-179: ...` のように**台帳 ID を先頭に持つ**ので、狙ったケースが存在して緑であることを出力から機械的に判定できる。

### 実行前の基準値（本計画の作成時に実測）

| 検査 | 結果 |
| --- | --- |
| `pnpm typecheck` | 緑 |
| `pnpm lint` | 緑（Checked 434 files / Found 2 infos） |
| `pnpm format:check` | 緑（Checked 446 files / No fixes applied） |
| `pnpm test:unit` | **Test Files 76 passed / Tests 958 passed, 3 skipped** |

Issue #21 完了後の期待値は「**テストファイル数は 76 のまま**（ステップ 9・10 はいずれも既存ファイルへの追加で、新規テストファイルを作らない）／**テスト件数は 958 より増える**（`TC-identity-342/343/344/345` の 4 件 + 適合スイートの `ADP-identity-042` 系の新規ケース）／skipped は 3 のまま」。

### マイグレーション・シード

**不要。** 永続化は in-memory アダプターのみで、`package.json`（root / `apps/web` / `packages/core`）に `db:*` に相当するスクリプトは 1 つも無い（`CLAUDE.md`「Persistence is in-memory, so there is no database to provision and no migration script.」/ `apps/web/.env.example` 冒頭）。**データはプロセス内メモリだけに載るので、`pnpm dev` を再起動するとアカウント・identity 行・ディレクトリ行がすべて消える。** 本計画の browser 項目は原則として 1 つの `pnpm dev` プロセス内で上から順に実行する（項目ごとに独立したアカウントを作るので、途中で再起動した場合はその項目の先頭からやり直せばよい）。

### デプロイ方法

**なし。** 参照ランタイムは Node.js + in-memory アダプターの 1 本だけで（`CLAUDE.md`「Reference runtime」/ ADR 025）、ローカルの `pnpm dev` で全確認が完結する。CI（`.github/workflows/ci.yml`）は `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test:unit` と `pnpm build:node` を回すので、api 項目 10 が通れば CI も通る。

なお **`pnpm start`（本番ビルド）ではループバック IdP を使えない**。`OAUTH_DEV_MODE` は `NODE_ENV=development`（`vite dev` だけが立てる）でしか受理されず、それ以外は起動を拒否する（`apps/web/.env.example`）。OAuth を伴う browser 項目は `pnpm dev` でのみ実行する。

### ブラウザーの使い分け

- **ウィンドウ1** = 通常ウィンドウ（主操作の利用者 A）
- **ウィンドウ2** = シークレットウィンドウ（別利用者 B 役。セッション Cookie を共有しないこと）

`pnpm dev` を起動したターミナルのログも観測対象にする。本計画で見る行は次の 3 つ。

- `mail.sent`（`actionUrl` にメール確認リンク）
- `[queue] received identity.identity.removed <event id>` — 解除イベントがリレーから配送された合図（`apps/web/app/worker/node/runner.ts:104`）
- `[identityRemovalRelease] keeping the claim` — 解放を見送った合図（`packages/core/src/application/identity/identityRemovalRelease.ts:72`）

### 実機で観測しない受け入れ基準

- **AC-1 / AC-2 / AC-3**（ポート契約・観測手段・適合スイートの 6 点）— ポート契約とその実行形なので画面には現れない。api 項目 7 に集約する。
- **AC-4 / AC-5 / AC-8**（3 種の注入経路）— いずれも UoW のコミット直後・`activate` の失敗・`release` の中断という**プロセス内部の窓**を作らないと再現できず、ブラウザー操作では作れない。api 項目 8・9 に集約し、browser 側は「同じ経路がユーザー操作として従来どおり成功すること」だけを見る。
- **AC-7**（spec / ADR の改訂）— 文書側の基準なので、コマンドではなくレビューで確認する。対象は `spec/domains/identity.md`（`#ポート` / `#ドメインサービス`）、`spec/inventory/{adapter,domain,test,usecase}.md`、`spec/testcases/identity/{removeIdentity,linkOAuthIdentity,completeOAuthSignIn}.md`、`spec/usecases/identity.md`、新規 `spec/adr/060-conditional-unique-claim-teardown.md`、および `spec/adr/index.md` / `038-*` / `054-*` の整合（steps.md ステップ 11・12）。

## 確認項目

### 1. Google 連携を解除したあと、同じ Google アカウントで再連携できる

- **対応する受け入れ基準:** AC-4、AC-6
- **検証手段:** browser
- **目的:** `identityRemovalRelease` を「観測 → 判定 → 条件付き解放」に組み替えたあとも、解除でディレクトリの provider account 鍵が実際に解放され、同じ外部アカウントを取り直せることを確かめる（CAS が常に外れて解放されなくなる、という最も起きやすい退行を落とす）
- **手順:**
  1. ウィンドウ1 で `http://localhost:3100/signup` を開き、メールアドレス `relink-a@example.com` / パスワード `Passw0rd123` / 表示名 `再連携太郎` で登録する
  2. `pnpm dev` のターミナルの `mail.sent` 行の `actionUrl`（`/verify-email?token=...`）を**同じウィンドウ1**で開き、メール確認を完了する
  3. `/signin` で `relink-a@example.com` / `Passw0rd123` でサインインする
  4. `http://localhost:3100/settings/auth` を開き、「Google を追加」を押す
  5. 同意画面（`/dev/oauth/authorize?...`）でメールアドレス `oauth-a@example.com`、表示名 `外部太郎`、「メールアドレスは確認済み（`email_verified`）」を **ON** にして「許可する」を押す
  6. 戻った `/settings/auth` の一覧を確認する
  7. Google の行の「解除」を押し、続けて現れる「解除する」を押す
  8. ターミナルに `[queue] received identity.identity.removed ...` が出るのを待つ（数秒以内）
  9. `/settings/auth` を再読み込みし、「Google を追加」を押す
  10. 同意画面で**手順 5 と同じ** `oauth-a@example.com` / `email_verified` ON で「許可する」を押す
  11. `/settings/auth` の一覧を確認する
- **期待結果:**
  - 手順 6 で一覧に「Google」の行が現れ、パスワードと合わせて **2 件**になる
  - 手順 7 で Google の行が即座に消える（楽観的除去）。再読み込み後も消えたまま
  - 手順 10 が成功し、「ログイン方法を追加しました」相当の表示のあと手順 11 の一覧に Google が再び現れ、**合計 2 件**（Google が 2 行に増えていない）
- **確認ポイント:**
  - **手順 10 で「この外部アカウントの解除処理が進行中です。少し待ってからもう一度お試しください。」が出たら、まだリレーが解除イベントを配送していないだけ。** 数秒待って再試行する（エッジケース 1 で扱う）。**何度待っても同じ表示のままなら、解放が走っていない = 本 Issue の退行**。
  - ターミナルに `[identityRemovalRelease] keeping the claim` が出ていないこと。出ていたら判定が `keep` に倒れており、鍵が解放されていない。
  - 手順 11 で Google の行が **2 行**になっていたら、`findOAuth` による治癒が「既存行の再利用」ではなく「新規追加」に倒れている（この経路は本来 `existing === null` なので 1 行が正しい）。

### 2. 既存のパスワード利用者に Google サインインが 1 件だけ紐づく

- **対応する受け入れ基準:** AC-5
- **検証手段:** browser
- **目的:** `completeOAuthSignIn.attachToExistingUser` に `findOAuth` を入れたあとも、既存利用者への追加が従来どおり成立し、identity 行がちょうど 1 件だけ増えることを確かめる（治癒の判定を入れた結果、正常系で追加が飛ばされてしまう退行を落とす）
- **手順:**
  1. ウィンドウ1 でアカウントメニューからサインアウトする
  2. `http://localhost:3100/signup` で メールアドレス `attach-a@example.com` / パスワード `Passw0rd123` / 表示名 `付与太郎` で登録する
  3. ターミナルの `mail.sent` の `actionUrl` を同じウィンドウ1 で開き、メール確認を完了する
  4. `/signin` から `attach-a@example.com` / `Passw0rd123` でサインインし、`/settings/auth` で一覧が **パスワードの 1 件だけ**であることを確認したうえで、サインアウトする
  5. `/signin` で「Google で続ける」を押す
  6. 同意画面でメールアドレス **`attach-a@example.com`（手順 2 と同じ）**、表示名 `付与太郎`、`email_verified` を **ON** にして「許可する」を押す
  7. 遷移後の表示とアカウントメニューを確認する
  8. `/settings/auth` を開いて一覧を確認する
- **期待結果:** 手順 7 でサインインが完了し（新しいアカウントが作られるのではなく `付与太郎` として入る）、手順 8 の一覧が **パスワード + Google の 2 件**（Google はちょうど 1 行）。
- **確認ポイント:**
  - **手順 6 の `email_verified` を必ず ON にすること。** OFF だと `AccountLinkingPolicy.decide` が `providerEmailUnverified` で拒否し、既存利用者への追加経路（`attachToExistingUser`）に到達しない。
  - 手順 7 で**別のアカウントとして**サインインしていたら（`/settings/auth` の一覧が Google 1 件だけ）、`linkToExisting` ではなく `createNew` に落ちている。メールアドレスの綴りを確認したうえで、それでも再現するなら退行。
  - 手順 8 で Google の行が **0 行**（追加が丸ごと飛ばされている）だった場合、`findOAuth` が既存行なしの状態で誤って一致を返している。

### 3. 同じ Google アカウントで繰り返しサインインしても identity 行が増えない

- **対応する受け入れ基準:** AC-5
- **検証手段:** browser
- **目的:** 「1 利用者の identity 集合に同じ `(provider, providerAccountId)` が 2 件生えない」という本 Issue の不変条件を、ユーザー操作で到達できる形（同じ外部アカウントでの再サインイン）で確かめる
- **前提:** 項目 2 を完了した状態（`attach-a@example.com` にパスワードと Google が紐づいている）
- **手順:**
  1. ウィンドウ1 でサインアウトする
  2. `/signin` で「Google で続ける」を押し、同意画面で `attach-a@example.com` / `email_verified` ON で「許可する」を押す
  3. `/settings/auth` の一覧を確認する
  4. 手順 1〜3 をもう一度繰り返す
- **期待結果:** 2 回とも `付与太郎` としてサインインでき、`/settings/auth` の一覧は毎回 **パスワード + Google の 2 件**のまま（Google は常に 1 行、`追加 <日付>` の日付も最初の連携時のまま変わらない）。
- **確認ポイント:**
  - Google の行が 2 行・3 行と増えていったら、`signInLinkedUser`（既存 identity の同定）が効かずに追加経路へ落ちている。
  - 「追加」日付が毎回更新されるなら、既存行を再利用せず作り直している。

### 4. 別の利用者が使っている Google アカウントは連携できない

- **対応する受け入れ基準:** AC-6
- **検証手段:** browser
- **目的:** `IdentityPolicy.findOAuth`（1 利用者の集合内の重複を見る）を足したことで、`IdentityUniqueDirectory` が担保する**全利用者にまたがる**一意性が緩んでいないことを確かめる
- **前提:** 項目 1 を完了した状態（利用者 A = `relink-a@example.com` に `oauth-a@example.com` の Google が紐づいている）
- **手順:**
  1. ウィンドウ2（シークレット）で `http://localhost:3100/signup` を開き、メールアドレス `other-b@example.com` / パスワード `Passw0rd123` / 表示名 `別人次郎` で登録する
  2. ターミナルの `mail.sent` の `actionUrl` を**ウィンドウ2**で開き、メール確認を完了する
  3. ウィンドウ2 で `/signin` から `other-b@example.com` でサインインする
  4. `/settings/auth` を開き、「Google を追加」を押す
  5. 同意画面で **`oauth-a@example.com`**（利用者 A が使っている外部アカウント）、`email_verified` ON で「許可する」を押す
  6. 戻った `/settings/auth` の表示と一覧を確認する
  7. ウィンドウ1 に戻り、`/settings/auth` を再読み込みする
- **期待結果:** 手順 6 で「この外部アカウントは別の利用者に紐づいています。別のアカウントでお試しください。」が表示され、ウィンドウ2 の一覧は **パスワードの 1 件だけ**のまま。手順 7 でウィンドウ1 の一覧は **パスワード + Google の 2 件**のまま（利用者 A の連携が奪われていない）。
- **確認ポイント:**
  - **ここが通ってしまったら、`findOAuth` の追加がディレクトリの一意性を迂回している**（steps.md「ディレクトリが担保するのは全利用者にまたがる一意性、`findOAuth` が見るのは 1 利用者の集合の中」の境界が壊れている）。本 Issue で最も重い退行なので、失敗したら以降を中止して報告する。
  - 手順 7 で利用者 A の Google が消えていたら、失敗した連携が他人の claim を取り壊している。

### 5. ハンドルを変更すると旧ハンドルが解放され、取り直せる

- **対応する受け入れ基準:** AC-6
- **検証手段:** browser
- **目的:** `beginRelease` の必須引数化（`expectedClaimToken`）に追随した `updateProfile` の旧 handle 解放と、`checkHandleAvailability`（取り壊し中は free に見える）の判定が従来どおり動くことを確かめる
- **前提:** 項目 4 の利用者 B（`other-b@example.com`）でウィンドウ2 にサインイン済み。ウィンドウ1 は利用者 A（`relink-a@example.com`）でサインイン済み
- **手順:**
  1. ウィンドウ1 で `http://localhost:3100/settings/profile` を開き、公開ハンドル欄に `alpha` を入力して保存する
  2. ウィンドウ2 で `/settings/profile` を開き、公開ハンドル欄に `alpha` を入力する（保存はしない）。欄の下のヒント表示を確認する
  3. ウィンドウ1 に戻り、公開ハンドルを `beta` に変更して保存する
  4. ウィンドウ2 で公開ハンドル欄をいったん空にしてから、もう一度 `alpha` を入力し、ヒント表示を確認する
  5. ウィンドウ2 で `alpha` のまま保存する
  6. ウィンドウ1 で `/settings/profile` を再読み込みし、ハンドルを確認する
- **期待結果:**
  - 手順 2 で「このハンドルは使われています」が表示される
  - 手順 4 では**その表示が出ない**（`alpha` が解放されている）
  - 手順 5 の保存が成功し、ウィンドウ2 のハンドルが `alpha` になる
  - 手順 6 でウィンドウ1 のハンドルは `beta` のまま
- **確認ポイント:**
  - 手順 4 で「使われています」が残る／手順 5 の保存が重複で失敗するなら、旧 handle の解放が効いていない（`expectedClaimToken` の受け渡しを誤ると `beginRelease` が黙って no-op になる — これが本 Issue で最も静かに壊れる箇所）。
  - 逆に手順 2 で「使われています」が**出ない**なら、`checkHandleAvailability` が使用中の鍵を free と誤判定している。
  - ヒントは目安であり確定は保存時なので、合否は**手順 5 の保存結果**で判断する。

### 6. アカウント削除後、同じメールアドレスとハンドルで再登録できる

- **対応する受け入れ基準:** AC-6
- **検証手段:** browser
- **目的:** `deleteAccount` の全鍵解放（`globalCleanup`：email / handle / providerAccount）が契約変更に追随していることを確かめる
- **手順:**
  1. ウィンドウ2（利用者 B = `other-b@example.com`、ハンドル `alpha`）で `/settings/auth` を開き、「Google を追加」で `oauth-b@example.com` / `email_verified` ON を連携する（削除時に解放される provider account 鍵を 1 本用意する）
  2. `http://localhost:3100/settings/danger` を開く
  3. 「確認のため、アカウントのメールアドレスを入力してください」に `other-b@example.com` を入力し、「アカウントを削除する」を押す
  4. 画面の進捗表示が終端（削除完了）に達するまで待つ（数秒〜十数秒）
  5. 同じウィンドウ2 で `/signup` を開き、メールアドレス `other-b@example.com` / パスワード `Passw0rd123` / 表示名 `再登録次郎` で登録する
  6. ターミナルの `mail.sent` の `actionUrl` をウィンドウ2 で開いてメール確認を完了し、サインインする
  7. `/settings/profile` で公開ハンドルに `alpha` を入力して保存する
  8. `/settings/auth` で「Google を追加」を押し、同意画面で `oauth-b@example.com` / `email_verified` ON で「許可する」を押す
- **期待結果:** 手順 5 の登録が「登録済み」で弾かれずに成功し、手順 7 のハンドル保存も成功し、手順 8 の連携も成功する（削除で email / handle / providerAccount の 3 種の鍵がすべて解放されている）。
- **確認ポイント:**
  - 手順 5 が「このメールアドレスは登録済みです」相当で弾かれる、手順 7 が「使われています」で弾かれる、手順 8 が「別の利用者に紐づいています」になる — いずれも該当する鍵が解放されていない合図で、`releaseActiveUniqueKey` の観測値受け渡しの誤りを疑う。
  - 削除は非同期（スコープタスク駆動、既定 1 秒間隔）なので、手順 4 の完了表示を待たずに手順 5 へ進まないこと。待たずに失敗した場合は退行ではない。

### 7. ポート契約と適合スイート（claim の観測と条件付き取り壊し）

- **対応する受け入れ基準:** AC-1、AC-2、AC-3
- **検証手段:** api
- **目的:** `resolveClaim` の追加・`expectedClaimToken` の必須化・`releasing` の no-op が、memory バックエンドに対する適合スイートで拘束されていることを確かめる
- **手順:**
  1. リポジトリルートで次を実行する

     ```
     pnpm exec vitest run packages/core/src/adapters/memory/__tests__/conformance.test.ts --reporter=verbose
     ```

  2. 出力から `ADP-identity-042` と `ADP-identity-041` を含む行を読む
- **期待結果:**
  - `Test Files 1 passed` / 失敗 0 で終了する
  - `ADP-identity-042` を含む ✓ 行が存在し、AC-3 の (a) claim の観測 / (b) **同じ `operationId` で**張り直した claim の観測値が前と一致しないこと / (d) 4 状態（行なし・`reserved`・`active`・`releasing`）での `resolve` と `resolveClaim` の一致 / (f) 冪等な `activate` を挟んでも観測値が不変であること、に対応するケースが読み取れる
  - `ADP-identity-041` を含む ✓ 行に、(c) 古い観測値の `beginRelease` が現行 claim を壊さない / (e) `releasing` 行が別 operation の `beginRelease` に奪われない、に対応するケースが**追加されている**（実行前は `ADP-identity-041` を含む行は 6 行 — 解放できる / `releasing` は他人に奪えない / 冪等 / 別利用者は no-op / `reserved` は no-op / 行なしは no-op）
- **確認ポイント:**
  - **既存 6 ケースが消えていないこと。** ステップ 4 でこの 6 件は「正しい観測値を渡す形」に書き換わるが、`beginRelease` を no-op にする条件（別利用者 / `reserved` / 行なし）の主張が薄まってはいけない。ダミートークンを渡す形に書き換えると、no-op の理由がトークン不一致にすり替わり、所有者判定の主張が黙って落ちる。
  - AC-3(b) は「**同じ `operationId` で**張り直す」強い形であること。別の `operationId` で張り直す弱い形しか無ければ、トークンを `operationId` から導くバックエンドがスイートを通ってしまう。

### 8. 経路 1（判定 → `beginRelease` の窓）と孤児 `releasing` 行の回収

- **対応する受け入れ基準:** AC-4、AC-8
- **検証手段:** api
- **目的:** 判定 UoW のコミット直後に「先行配送の解放 + 本人の再連携」を割り込ませる注入テストと、`beginRelease` 済み・`release` 前で中断した解放の回収テストが緑であることを確かめる
- **手順:**
  1. リポジトリルートで次を実行する

     ```
     pnpm exec vitest run packages/core/src/application/identity/__tests__/removeIdentity.test.ts --reporter=verbose
     ```

- **期待結果:**
  - `Test Files 1 passed` / 失敗 0 で終了する
  - 出力に `TC-identity-342`（経路 1 の割り込み）と `TC-identity-345`（孤児 `releasing` 行の回収）を含む ✓ 行が**両方**存在する
  - 実行前に存在した 11 件（`TC-identity-179` 〜 `TC-identity-186` 等）がすべて ✓ のまま残っている
- **確認ポイント:**
  - `TC-identity-342` は**観測を判定 UoW より後に取る実装でも落ちる**ことが値打ちなので、割り込みが `beginRelease` ではなく**判定 UoW のコミット直後**に置かれていることをテストコードで確認する（`beginRelease` に割り込むと誤順序の実装でも通ってしまう）。
  - `TC-identity-345` は `releaseObservedUniqueKey` が観測 null で早期 return する実装で落ちる。緑であることに加え、テストが「行が消える」ことと「別の利用者がその鍵を `reserve` できる」ことの**両方**を主張していることを確認する。
  - 既存の「keeps the re-linked claim when the removal event is redelivered」（逐次再配送ガード）が残っていること（AC-6）。

### 9. 経路 2（`activate` 喪失 + `reserved` の TTL 失効）の治癒

- **対応する受け入れ基準:** AC-5
- **検証手段:** api
- **目的:** 予約サガを commit 後・`activate` 前で止め、`reserved` を TTL 失効させてから再連携する注入テストが、`linkOAuthIdentity` / `completeOAuthSignIn` の両方で緑であることを確かめる
- **手順:**
  1. リポジトリルートで次を実行する

     ```
     pnpm exec vitest run packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts --reporter=verbose
     ```

- **期待結果:**
  - `Test Files 2 passed` / 失敗 0 で終了する
  - 出力に `TC-identity-343`（`linkOAuthIdentity`）と `TC-identity-344`（`completeOAuthSignIn` の既存利用者への追加）を含む ✓ 行が存在する
- **確認ポイント:**
  - `TC-identity-343` が「identity 行が 1 件」「`resolve("providerAccount", key)` が本人 = claim が `active` に復旧」「返る `identityId` が既存行の ID」の 3 点を主張していること。**「重複を弾く」実装でも 1 件目の主張だけは通ってしまう**ので、claim の復旧と既存 ID の返却が要になる。
  - `TC-identity-344` は provider が返す email を既存利用者の account email と一致させて `attachToExistingUser` に落としていること（一致していないと `createNew` に流れ、テストが別のものを測る）。`CompleteOAuthSignInView` は `identityId` を持たないので、こちらの主張は「identity 行 1 件」「claim が `active`」「セッションが発行される」の 3 点。

### 10. 品質ゲート（全体）

- **対応する受け入れ基準:** AC-6
- **検証手段:** api
- **目的:** 契約変更（`expectedClaimToken` の必須化）が全呼び出し元へ型として波及し、既存の identity 群・適合ランがすべて緑のままであることを確かめる
- **手順:**
  1. リポジトリルートで `pnpm typecheck`
  2. `pnpm lint:fix`
  3. `pnpm format`
  4. `pnpm test:unit`
- **期待結果:**
  - 4 つすべてが成功で終了する
  - `pnpm test:unit` は **Test Files 76 passed**（実行前と同じ）、**Tests は 958 より多い passed / 3 skipped**
- **確認ポイント:**
  - **`pnpm typecheck` が最初の検証**。`beginRelease` の直接呼び出し元（`application/identity/uniqueness.ts` / `adapters/conformance/identityUniqueDirectory.ts` / `adapters/memory/repositories/identityUniqueDirectory.ts` / `application/identity/__tests__/checkHandleAvailability.test.ts`）がすべて追随していないと通らない。
  - **`checkHandleAvailability.test.ts` にダミーのトークン文字列が渡されていないこと。** ダミーだと `beginRelease` が no-op になり、テストは緑のまま「取り壊し中は free に見える」という主張だけが黙って落ちる。正しい直し方は「先に `resolveClaim("handle", "ichiro")` して観測値を渡す」。
  - テストファイル数が 76 から増えていたらスコープ逸脱（ステップ 9・10 はいずれも既存ファイルへの追加）。
  - `pnpm lint` の infos が 2 件から増えていないこと。

## エッジケース・異常系

### 1. 解除した直後に同じ Google アカウントを再連携する

- **検証手段:** browser
- **目的:** 解除イベントの配送が済む前の再連携が、`PROVIDER_ACCOUNT_RELEASE_PENDING` として畳まれ、待って再試行すれば必ず成功する（鍵が固まらない）ことを確かめる
- **手順:**
  1. ウィンドウ1 で `/settings/auth` を開き、Google の行の「解除」→「解除する」を押す
  2. **ターミナルのログを待たずに、即座に**「Google を追加」を押し、同意画面で解除したのと同じメールアドレス / `email_verified` ON で「許可する」を押す
  3. 表示を確認する
  4. 10 秒待ってから、もう一度「Google を追加」→ 同じメールアドレスで「許可する」を押す
- **期待結果:** 手順 3 は「この外部アカウントの解除処理が進行中です。少し待ってからもう一度お試しください。」が出るか、あるいは（配送が既に済んでいれば）そのまま連携が成功する — **どちらでもよい**。手順 4 は**必ず成功**し、一覧に Google が 1 行だけ現れる。
- **期待結果の要点:** 合否は**手順 4** だけで判断する。手順 3 の表示は配送タイミング次第で変わるので、どちらでも不具合ではない。

### 2. 解除した Google アカウントを別の利用者が取得できる

- **検証手段:** browser
- **目的:** 解除で鍵が「所有者ごと」解放されており、別の利用者が取り直せること（no-op に倒れていないことの、項目 1 とは独立した観測）を確かめる
- **手順:**
  1. ウィンドウ1（利用者 A）で `/settings/auth` を開き、Google（`oauth-a@example.com`）の「解除」→「解除する」を押す
  2. ターミナルに `[queue] received identity.identity.removed ...` が出るのを待つ
  3. ウィンドウ2 で新しい利用者 C（`taker-c@example.com` / `Passw0rd123` / 表示名 `横取太郎`）を `/signup` から登録し、`mail.sent` の `actionUrl` でメール確認してサインインする
  4. ウィンドウ2 の `/settings/auth` で「Google を追加」を押し、同意画面で **`oauth-a@example.com`**（利用者 A が解除したもの）/ `email_verified` ON で「許可する」を押す
  5. ウィンドウ2 の一覧と、ウィンドウ1 の `/settings/auth` を確認する
- **期待結果:** 手順 4 が成功し、ウィンドウ2 の一覧に Google が 1 行現れる。ウィンドウ1 の一覧は パスワードの 1 件だけ（解除済みのまま）。
- **確認ポイント:** 手順 4 が「別の利用者に紐づいています」になったら、解放が走っていない（`beginRelease` が常に no-op に倒れている疑い）。項目 1 の手順 10 と合わせて、同じ原因を 2 つの角度から落とす。

### 3. 連携と解除を 3 往復しても鍵が固まらない

- **検証手段:** browser
- **目的:** 解放の operation ID が決定的に再導出される（同じ鍵に同じ ID の claim が繰り返し生まれる）経路で、トークン条件が「同じ ID の別 claim」を取り違えず、鍵が恒久的に使用不能にならないことを確かめる
- **手順:**
  1. ウィンドウ1（利用者 A、パスワードあり）で `/settings/auth` を開く
  2. 「Google を追加」→ 同意画面で `oauth-loop@example.com` / `email_verified` ON →「許可する」
  3. Google の行の「解除」→「解除する」を押し、ターミナルの `[queue] received identity.identity.removed ...` を待つ
  4. 手順 2〜3 をさらに 2 回繰り返す（合計 3 往復）
  5. 最後にもう一度「Google を追加」で `oauth-loop@example.com` を連携し、一覧を確認する
- **期待結果:** 3 往復のすべてで連携と解除が成功し、手順 5 の最終連携も成功して一覧が パスワード + Google の 2 件になる。
- **確認ポイント:**
  - 途中のどこかで「この外部アカウントの解除処理が進行中です」が出続けて先へ進めなくなったら、`releasing` 行が回収されずに残っている（AC-8 が閉じられていない）。ターミナルに `[identityRemovalRelease] keeping the claim` が繰り返し出ていないかも合わせて見る。
  - Google の行が 2 行以上に増えたら、`findOAuth` の治癒が誤って新規追加に倒れている。

## 既存機能への影響確認

- **P-22「ログイン方法」一覧（`/settings/auth`）の追加 / 解除 / 楽観的更新** — 本 Issue は UI を変えない（steps.md「UI / プレゼンテーション: 影響なし」）が、`linkOAuthIdentity` / `completeOAuthSignIn` / `removeIdentity` の内部が変わるので、追加後の一覧反映（項目 1・2）、解除の楽観的除去と行の再表示（項目 1）、「最後のログイン方法は解除できません」の抑止（Google だけの状態で「解除」ボタンが無効であること）を通しで見る。
- **パスワード認証手段の追加（`addPasswordIdentity`）** — `IdentityPolicy.ensureAddable` の呼び出し順序が OAuth 2 経路だけ変わる（`findOAuth` が先）ため、パスワード側が巻き添えで壊れていないことを `/settings/auth` の「パスワードを追加」で 1 回確認する（Google だけで登録した利用者にパスワードを足せること）。
- **サインアップ / メール確認 / サインイン（非 OAuth 経路）** — email 鍵の予約サガを共有するので、項目 2・6 の登録 → 確認 → サインインで 2 往復通る。
- **P-05 OAuth コールバック画面の状態出し分け** — 項目 1〜4 で成功・「別の利用者に紐づいています」・「解除処理が進行中です」の 3 状態を通る。`email_verified` を OFF にして「許可する」を押すと再許可導線（`OAUTH_EMAIL_UNVERIFIED`）が出るので、余力があれば 1 回確認する。
- **P-19 プロフィール編集のハンドル可用性ヒント（`checkHandleAvailability`）** — `beginRelease` の直接呼び出し元がユースケーステストにあり（`checkHandleAvailability.test.ts`）、直し方を誤ると主張が黙って落ちる箇所。項目 5 が実機側の担保、api 項目 10 の `pnpm typecheck` が型側の担保。
- **P-25 アカウント削除の全鍵解放** — 項目 6。削除は複数の鍵種を一度に解放する唯一の経路なので、契約変更の追随漏れがあればここに出る。
- **単体テスト・適合スイート** — `expectedClaimToken` の必須化は型で全呼び出し元に波及するので、退行の主体は `pnpm test:unit`（api 項目 10）。テストファイル 76・テスト 958+ / skipped 3 を基準に、件数の減少（ケースの消失）と増加幅（スコープ逸脱）の両方を見る。
- **本番ビルド（`pnpm build` → `pnpm start`）** — CI の `build` ジョブと同じ検査。ビルドが通り、起動ログの待ち受け URL でトップと `/signin` が描画されるところまで確認する。**OAuth 往復そのものは本番ビルドでは確認できない**（`OAUTH_DEV_MODE` は `NODE_ENV=development` でしか受理されず、`.env` に残したままでは起動が拒否される）。確認するなら `.env` の `OAUTH_DEV_MODE` を外し、`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` を設定して起動できることまでに留める。
- **サーバー再起動でデータが消える** — 永続化は in-memory なので、確認の途中で `pnpm dev` を落とすとアカウントも identity 行もディレクトリ行もすべて消える（仕様どおり）。browser 項目は 1 プロセス内で通す。
