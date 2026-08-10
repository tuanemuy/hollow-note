# レビュー 007（最終確認） — Issue #1 / PR #12

対象: ラウンド6 の新規差分（`77ee63c fix(web): 本番形の起動でクライアントアセットを配信する`）と、AC-14〜19 の最終充足確認。
既出指摘（triage.md ラウンド1〜6）および Issue #13 に defer 済みの項目は再審議していない。

## 最終確認

**問題点ゼロ。** Blocker / Warning ともになし。

#### Blockers

なし

#### Warnings

なし

## 実測記録

`pnpm build` 後、`PORT=3111 APP_URL=http://localhost:3111 pnpm start`（tsx `scripts/listen.node.ts`）で本番形を起動し、
生ソケットからリクエストラインを直接投げて検証した（curl はクライアント側でパスを正規化してしまうため）。
検証後、ブラウザーセッションとサーバープロセスは終了済み（`port 3111 free` / `no listen.node process` を確認）。

### 1. パストラバーサル — 全経路で遮断、情報漏洩ゼロ

`resolveStaticFile`（`apps/web/scripts/listen.node.ts:95-105`）の三段ガードが実測で成立している。

- `decodeURIComponent` 失敗 → `null` で静的層を素通り（`%zz` / `%` / overlong UTF-8 `%c0%ae` / `%e0%80%af` は Node の HTTP パーサーが先に 400 を返す層もあるが、いずれにせよファイルには到達しない）
- NUL バイト → `decoded.includes("\0")` で拒否（`...js%00.txt` / `/%00/../../.env` / `/assets/%00react-...js` すべて素通り）
- `path.posix.normalize` 後に `.` 前置 → `path.resolve` で root 相対に固定。`pathname` は必ず `/` 始まりなので正規化結果も必ず絶対パスになり、`..` は root 到達前に食われる
- `resolved.startsWith(root + path.sep)` の前置検査で root 自体・兄弟ディレクトリ（`dist/clientXXX`）を排除

投げた攻撃パターンと結果（すべて **アプリの 404 / リダイレクトへフォールスルー、機微情報の露出なし**）:

| パターン | 結果 |
| --- | --- |
| `/../../.env` | 404（アプリ） |
| `/..%2f..%2f.env` / `/%2e%2e%2f%2e%2e%2f.env` / `/%252e%252e%252f...` | 404 |
| `/../server/server.node.js` / `/..%2fserver%2fserver.node.js` | 404 |
| `/assets/../../server/server.node.js` / `/assets/..%2f..%2fserver%2fserver.node.js` | 404 |
| `/../../dist/server/server.node.js` | 404 |
| `/../../package.json` / `/../../app/server.node.ts` | 404 |
| `/../../../../../../etc/passwd` / `/../../../../../../../../Users/hikaru/.ssh/id_rsa` | 404 |
| `/../../node_modules/.bin/tsx` / `/../../data` | 404 |
| `/..\..\.env`（バックスラッシュ） | 404 |
| `/assets/..;/..;/.env` / `/assets/react-....js/../../../.env` / `/assets/./../%2e%2e/.env` | 404 |
| `//etc/passwd` | 308（アプリのルーター正規化。静的層は不通過） |
| `/../clientXXX/foo`（兄弟ディレクトリ） | 404 |

応答本文を `DATABASE|APP_URL|SECRET|PRIVATE KEY|process\.env` で走査し、**漏洩ゼロ**を確認。
**サーバーバンドル（`dist/server/`）・`apps/web/.env`・リポジトリのソースはいずれも読めない**。

シンボリックリンクは `realpath` 検査がないが、`dist/client` 配下の実測シンボリックリンク数は 0（vite の出力は `assets/` 35 ファイルのみ）。
攻撃者が root 配下にリンクを置ける経路が本スライスには存在しないため、実害なし。

### 2. メソッド制限 — 正しく効いている

`request.method !== "GET" && !== "HEAD"` の早期 return が実測で成立。

- `GET /assets/react-BhjfaixL.js` → 200 / 静的層
- `HEAD` 同上 → 200、ボディ 0 バイト、`Content-Length: 7527` 保持
- `POST` / `PUT` / `DELETE` / `OPTIONS` 同 URL → **404（アプリ層）** かつ `Cache-Control: private, no-store` + CSP + Referrer-Policy 付き
  → 静的層を通っていないことがヘッダーの差で機械的に確認できる
- `HEAD /../../.env` → 404（トラバーサルは HEAD でも同じく遮断）

### 3. ヘッダーの適用範囲 — 従来どおり保持、静的側も妥当

| 応答 | Cache-Control | CSP | Referrer-Policy | nosniff |
| --- | --- | --- | --- | --- |
| `/`・`/signin`・`/signup`・`/terms`・`/privacy`・`/verify-email`・404 | `private, no-store` | あり | あり | あり |
| `/notes`（307 リダイレクト） | `private, no-store` | あり | あり | あり |
| `/assets/*.js` `/assets/*.css` | `public, max-age=31536000, immutable` | — | — | あり |

アプリ応答の 4 ヘッダーはすべて従来どおり（`withSecurityHeaders` は静的層をまたがないため影響を受けない）。
静的アセットに CSP / Referrer-Policy が付かないのは設計どおりで、`frame-ancestors` / `form-action` / `object-src` / `base-uri` はハッシュ付きの JS / CSS に対して意味を持たない。

**認証が必要なパスの食われ**は発生していない。`dist/client` は `assets/` 一階層のみで、`index.html` も含まれない。

- `/notes`（未認証）→ **307 → `/signin?redirect=%2Fnotes`**（認証ガード健在）
- `/notes`（認証済み）→ 200 SSR
- `/`・`/signin`・`/signup`・`/terms`・`/privacy`・`/verify-email` → すべて 200 SSR（静的層は不通過）
- `/assets`（拡張子なし・ディレクトリ）→ `stats.isFile()` が false で素通り → アプリ 404
- `/assets/`（末尾スラッシュ）→ アプリの 307

### 4. フォールスルー — 正常

- 未知 URL `/definitely-not-a-file-xyz` → アプリの 404 ページ（P-46 系の共通表示）
- 300 セグメントの長大パス → アプリ 404（例外・クラッシュなし）
- `/.` `/..` → アプリのランディング 200
- `///assets/react-BhjfaixL.js` → 静的 200（正規化が正しく効いている）
- `/./assets/...`・`?v=1` 付き → 静的 200
- SSR ルートは全ページ健在。R6 修正の目的だった **クライアント JS の 404 は解消**:
  `/` `/signin` `/signup` `/terms` `/privacy` `/verify-email` `/notes` が参照する `/assets/*` 全 20 件を実測し **すべて 200**

### 5. MIME — 妥当。XSS 経路にはならない

固定表 15 拡張子は vite が出力する範囲（`.js` `.css` `.map` `.json`）と `public/` に置かれうる典型（画像・フォント・`.ico` `.txt` `.webmanifest`）を過不足なく覆う。
未知拡張子は `application/octet-stream` にフォールバックし、かつ **`X-Content-Type-Options: nosniff` が全静的応答に無条件で付く**ため、
ブラウザーが HTML / JS として解釈し直す経路が塞がっている（実測で `nosniff` を全静的応答に確認）。
`.svg` を `image/svg+xml` で返す点は同一オリジンのスクリプト実行面になりうるが、root 配下に置かれるのはビルド生成物だけで、
利用者が書き込める経路は本スライスに存在しない。

補足（指摘ではない）: 表に `.html` がないため、将来 `public/` に HTML を置くと `application/octet-stream` で降ってくる。
現状 `dist/client` に HTML は存在せず、実害はない。

## AC-14〜19 の充足判定

本番形（`pnpm build` → `pnpm start`）のブラウザー実操作で e2e を通した。

| AC | 判定 | 根拠 |
| --- | --- | --- |
| AC-14 | 充足 | `pnpm build` 成功、`pnpm start` 起動、memory アダプター配線で全ページ動作。他ランタイム（libsql/d1/cf/aws/gcp）と todo 参照実装は削除済み。`pnpm typecheck`（tsgo × 2 パッケージ）・`pnpm lint`（248 ファイル・エラー 0）・`pnpm test`（28 ファイル / 466 テスト全 pass）すべて緑 |
| AC-15 | 充足 | セッション Cookie は `HttpOnly` / `SameSite=Lax` / `Path=/` / `Expires=Session.expiresAt`。`Secure` はビルド後バンドルで `isProduction = () => true` に静的解決されており（`dist/server/rsc/assets/session-*.js` で実測）、本番形では無条件に付く。`document.cookie` が空文字＝HttpOnly 実効。未認証 `/notes` → `/signin?redirect=%2Fnotes` → サインイン成功 → `/notes` へ復帰（同一オリジンのパスのみ）を実測 |
| AC-16 | 充足 | P-01 サインアップ（同意チェック未了で送信ボタン disabled → 入力後に有効化 → 「確認メールを送信しました」パネル + サインインへの導線）、P-02 サインイン（`status` ライブ領域・サインアップへの導線）が L-03 レイアウトで動作 |
| AC-17 | 充足 | 確認リンク（同一ブラウザー）を開くと `/notes` に着地し、ヘッダーがアカウントメニュー付きのシェルに切り替わる＝ActiveUser + サインイン状態。ADR-038 の同一ブラウザー条件つき充足という注記どおり |
| AC-18 | 充足 | 空状態「白紙から書く」→ `/notes/019feb03-…` へ遷移し P-11 ノート詳細（「無題」/「非公開」/「このノートは白紙です。」）を表示。一覧に戻ると「1 件のノート」+ ノートカードが並ぶ |
| AC-19 | 充足 | 存在しないノート ID → P-46「このページは見つかりません」＋「ノート一覧へ」/「トップへ」の導線（存在と権限を区別しない共通表示）。`/terms`「利用規約」・`/privacy`「プライバシーポリシー」が 200 で表示 |

## カバレッジ

- 確認:
  - `/Users/hikaru/github.com/tuanemuy/hollow/apps/web/scripts/listen.node.ts`（R6 の新規差分・全文精読 + 攻撃パターン 51 件の実測）
  - `/Users/hikaru/github.com/tuanemuy/hollow/docs/runtime_node.md`（R6 追記の「Static assets」節。記述と実装・実測結果の一致を確認）
  - `/Users/hikaru/github.com/tuanemuy/hollow/apps/web/app/server.node.ts`（`withSecurityHeaders` の適用範囲が静的層と競合しないこと）
  - `/Users/hikaru/github.com/tuanemuy/hollow/apps/web/app/presentation/session.ts`（AC-15 の Cookie 属性）
  - `/Users/hikaru/github.com/tuanemuy/hollow/apps/web/vite.config.node.ts`、`apps/web/dist/client/`・`apps/web/dist/server/` のビルド成果物
  - 本番形の実行系: `pnpm build` / `pnpm start` / `pnpm typecheck` / `pnpm lint` / `pnpm test`
  - ブラウザー実操作: `/` `/signin` `/signup` `/terms` `/privacy` `/verify-email` `/notes` `/notes/{id}` `/notes/{存在しない id}`
- スキップ:
  - `packages/core/**` — ラウンド6 で Core+Test が問題点ゼロ・出荷可と判定済みで、R6 の差分が及んでいない
  - `apps/web/app/**`（`server.node.ts` / `session.ts` 以外） — 同上。R6 差分は `scripts/` のみで、退行有無は本番形の e2e 実測で確認した
  - triage.md 記載の既出指摘 100 件および Issue #13（RPC 3往復） — 契約により再審議しない

## 出荷可否

**出荷可。** ラウンド6 の修正はセキュリティ上の実害を生んでおらず、退行もない。AC-14〜19 はすべて充足。
