# テスト実行サマリー — Issue #13 / PR #36

**実行日:** 2026-08-23
**テストソース:** `.thread/13/testing.md`
**ブランチ:** `issue/13/reduce-navigation-rpc-roundtrips`
**サーバー:** DEV `pnpm dev` / 本番ビルド `pnpm build` → `pnpm start`（いずれも http://localhost:3100）

判定はメインが観測ログと期待結果を突き合わせて付けた。観測ログは `run-{a,b,c,d}-observations.md` と `api-results.md`。

## 確認項目

| # | テスト名 | AC | 手段 | ラン | 結果 |
| --- | --- | --- | --- | --- | --- |
| 1 | `/notes` へのクライアント遷移が 1 本 / 1 段 | AC-1 | browser | A (DEV) | PASS |
| 2 | `/notes/:noteId` へのクライアント遷移が 1 本 / 1 段 | AC-2 | browser | A (DEV) | PASS |
| 3 | `/notes` → `/settings/profile` が 2 本同時 / 1 段 | AC-3a | browser | A (DEV) | PASS |
| 4 | `/settings/profile` → `/settings/auth` が 2 本同時 / 1 段 | AC-3b | browser | A (DEV) | PASS |
| 5 | `/settings/profile` → `/settings/danger` が 1 本 / 1 段 | AC-3c | browser | A (DEV) | PASS |
| 6 | 公開ルートへのクライアント遷移が 0 本 | AC-4 | browser | A (DEV) | PASS |
| 7 | 代表ルートの `<head>` が変更前と一致 | AC-5 | browser | A (DEV) | PASS |
| 8 | 未サインインで保護ルートを直開きすると `/signin?redirect=...` に着く | AC-6a | browser | B (DEV) | PASS |
| 9 | 別タブでサインアウト後、既訪の `/notes` でガードが再判定される | AC-6b | browser | C (DEV) + D (本番) | PASS |
| 10 | 未サインインの断片ブリッジが遷移元パスを検証してから `/signin` へ倒す | AC-7 | browser | B (DEV) | PASS |
| 11 | 本番ビルドで戻ったとき 1 本の背景再取得・スケルトンに戻らない | AC-8 | browser | D (本番) | PASS |
| 12 | `/notes` 系はブリッジ応答の完了前にスケルトンが出る | AC-9a | browser | A (DEV) | PASS（条件つき） |
| 13 | `/settings/profile` はガード応答のあとに URL が確定する | AC-9b | browser | A (DEV) | PASS |
| 14 | 未サインインで `/settings/danger` が開け、リロードで留まる | AC-11 | browser | C (DEV) | PASS（手順書を訂正） |
| 15 | 上部バーに表示名とアバターが従来どおり出る | AC-12 | browser | A (DEV) | PASS |
| 16 | 品質ゲート | AC-10 | api | — | PASS |
| 17 | ドキュメントから「二重化」の記述が消えている | AC-13 | api | — | PASS |
| 18 | `requireAuthenticated` の参照が残っていない | AC-14 | api | — | PASS |
| 19 | `Deferred` の deferred lane 化が他の断片ルートを壊していない | AC-9a | browser | A (DEV) | PASS（条件つき） |

## エッジケース・異常系

| # | テスト名 | 手段 | ラン | 結果 |
| --- | --- | --- | --- | --- |
| 1 | 未サインインで `/settings/profile` の SSR 直開きが 307 | browser | B (DEV) | PASS |
| 2 | preload が in-flight のままクリックすると本数が 1 本少なく出る | browser | C (DEV) | PASS（手順書を訂正） |
| 3 | `/settings` のタブにホバーするたびガード要求が 1 本飛ぶ | browser | A (DEV) | PASS |
| 4 | `/` へのクライアント遷移の本数（スコープ外の記録項目） | browser | A (DEV) | PASS（手順書を訂正） |
| 5 | 失効後に `/settings` のタブへホバーしても `/signin` へナビゲートしない | browser | C (DEV) | PASS |
| 6 | 失効後に `/settings` のタブをクリックすると `/signin?redirect=<タブのパス>` に着く | browser | C (DEV) | PASS |

**合計: 25 件（PASS 25 / FAIL 0）**

## 判定の補足

### 手順書を訂正した 3 件

いずれも**実装は正しく、`testing.md` / `plan.md` の期待値の側が現実と合っていなかった**。切り分けは実コードと実機で裏を取り、記録を残した。

- **確認項目 14** — 削除チケットは `sessionStorage` に受理〜完了の数十 ms しか存在せず、完了時に `forgetTicket()` が設計どおり破棄する。「終端の完了表示に戻る」は構造上起こらない。項目の本来の目的（`SIGNED_OUT_PATH` の両方向 = 未サインインでも `/settings/danger` が開ける）は満たされている。合格条件を「リロード後も `/signin` へ飛ばず `/settings/danger` に留まる」に置き直した。根拠: `item-14-investigation.md`
- **エッジケース 4** — `/` は loader を持たず `beforeLoad` だけのルートで、`executeBeforeLoad` に dedupe が無いため、マウスクリック自体が予約する intent preload が本体と別にもう 1 本走る。構造上 2 本 / 2 段が正しく、**`main` は 4 本なので PR はこの経路を半減させている（退行ではない）**。期待値を実測値に直し、計測手順にこの性質を明記した。根拠: `edge-4-investigation.md`
- **エッジケース 2** — 「in-flight クリックで 1 本少なく出る」は loader を持つルート限定の性質で、`beforeLoad` 単独ルートでは逆に 1 本多い。エッジケース 4 の調査に合わせて限定を足した

### 条件つき PASS の 2 件（項目 12・19）

インストール済みの `agent-browser` にネットワークスロットリング相当のコマンドが無く（`--help` / `network route --help` / `set --help` で確認）、testing.md が想定した「Slow 4G でスケルトンの表示時間を伸ばして観測する」形は取れなかった。通常速度での観測では、項目 13 と項目 19 のステップ 3 でコンテンツ描画前のフレームを捕捉できたが、項目 12 では毎回は捉えられなかった。

AC-9a の実質（`Deferred` の断片ストリーミングが働いていること）は**確認項目 11 の本番実測が別経路で担保している** — 背景再取得 4 回すべてでスケルトンの再表示が 0 件だった一方、初回マウントではスケルトンが出ることを Run A・Run D の両方で観測している。したがって「スケルトンが出る／出ない」の分岐そのものは成立が確認できており、観測できなかったのは表示時間の長さだけ。

### 観測環境の注記

- **セッション失効の再現** — 別 `--session` は Cookie を共有しないため、同一セッション内の `agent-browser tab new` で「別タブでのサインアウト」を再現した（Run C・Run D）
- **`agent-browser click` の不発** — Run D で `click <ref>` が `✓ Done` を返しながらクリックが発生しない事象を複数回観測し、`eval` 経由の直接クリックで代替した。合否には影響していない（同じ操作の別手段）
- **エッジケース 1** — ブラウザーは 307 に自動追従するため Network 一覧に中間ステータスが残らない。`curl`（`-L` なし）で 307 を直接確認した
