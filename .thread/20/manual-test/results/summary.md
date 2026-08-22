# テスト実行サマリー — Issue #20

**実行日時**: 2026-08-22
**テストソース**: `.thread/20/testing.md`
**サーバー**: http://localhost:3100（`pnpm --filter @repo/web exec vite dev --config vite.config.node.ts --port 3100`）
**観測ログ**: `run-a-observations.md` / `run-b-observations.md` / `run-c-observations.md` / `run-d-observations.md` / `api-results.md`

`.env` の `APP_URL=http://localhost:3100` に合わせて dev サーバーを 3100 で待ち受けさせた（testing.md は `.env` を 3000 に直す前提で書かれているが、ユーザーの `.env` を書き換えずに済むほうを採った。認可 URL・`redirect_uri` とも `APP_URL` 由来なので等価）。

| # | テスト名 | 種別 | 手段 | 結果 | 備考 |
|---|---|---|---|---|---|
| 1 | 束縛 Cookie の値が `state` から計算できない独立した乱数である | 正常系 | browser | PASS | 値をメイン側でも独立に再計算して照合済み |
| 2 | `Set-Cookie` の属性と寿命が現状のまま | 正常系 | browser | PASS | 生ヘッダーは取得できず Cookie ジャーで代替観測 |
| 3 | 正しい束縛でサインインが完了する | 正常系 | browser | PASS | 中間表示は遷移が速く未捕捉（結末は確認） |
| 4 | `state` だけを知る第三者は照合を通せない | 異常系 | browser | PASS | 4 パターンすべて失敗・Cookie 残存 |
| 5 | 束縛 Cookie を持たない消費要求は `state` を消費しない | 異常系 | browser | PASS | |
| 6 | 束縛が一致しなければ `state` は消費されない | 正常系 | browser | PASS | 操作ミス→訂正後に成立（記録あり） |
| 7 | 連携の往復にも同じ束縛が掛かる | 正常系 | browser | PASS | トースト文言は未捕捉（一覧の状態で確認） |
| 8 | キャンセルの破棄は Cookie を落とす | 正常系 | browser | PASS | |
| 9 | 別ブラウザーのフローを指す破棄は Cookie も `state` 行も落とさない | 異常系 | browser | PASS | 本項目の本体（手順4・6）とも成立 |
| 10 | 束縛 Cookie を持たない破棄要求は何もしない | 異常系 | browser | PASS | |
| 11 | 品質ゲート | — | api | PASS | typecheck / lint:fix / format / test すべて緑、作業ツリー変更なし |
| E2 | 成功したコールバック URL をもう一度開く | エッジ | browser | PASS | 単回消費が成立 |
| E4 | `code` を伴わないコールバック | エッジ | browser | PASS | 対照実験（他人の `state`）でも自分の Cookie は残存 |
| E1 | 同じブラウザーで 2 つのフローを並行して開始する | エッジ | browser | PASS | 設計として受容している縮退。Cookie A を戻せば完了でき、`state` 行は無傷 |
| E3 | 束縛が一致していても TTL を過ぎた `state` は完了できない | エッジ | browser | PASS | 実測 11 分 14 秒待機。Cookie 復元後も完了せず、同じ URL の再訪でも完了しない |

**合計**: 15 件（PASS: 15 / FAIL: 0）

変更起因の FAIL はゼロ。観測しきれなかった細目（`Set-Cookie` の生ヘッダー全文、成功時の中間表示、連携完了トースト）は agent-browser の取得可否と表示の一過性によるもので、いずれも同じ性質を別の観測点（Cookie ジャーの属性・遷移の結末・`/settings/auth` 一覧の状態）で押さえている。

本 Issue の核心にあたる値は、観測ログの記録値をメイン側で再計算して独立に照合した — 束縛 Cookie は `state` そのものとも `sha256(state)` とも一致せず、相互に部分文字列でもなく、43 文字の base64url（項目 1・7・9 の 4 フローすべて）。
