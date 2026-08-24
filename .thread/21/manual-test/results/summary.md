# 動作検証サマリー — Issue #21

**実行日:** 2026-08-25
**ブランチ:** `issue/21/identity-claim-cas` / **PR:** #41
**検証環境:** `pnpm dev` → http://localhost:3100（in-memory 永続化）
**テストソース:** `.thread/21/testing.md`

判定（PASS / FAIL）はメインが観測記録と期待結果を突き合わせて付けた。観測の生記録は `results/` 配下と `../api-results.md`。

## 確認項目

| # | 確認項目 | 手段 | AC | 結果 | 観測記録 |
|---|---|---|---|---|---|
| 1 | Google 連携を解除したあと、同じ Google アカウントで再連携できる | browser | AC-4, AC-6 | PASS | `results/browser-1-3-observations.md` |
| 2 | 既存のパスワード利用者に Google サインインが 1 件だけ紐づく | browser | AC-5 | PASS | 同上 |
| 3 | 同じ Google アカウントで繰り返しサインインしても identity 行が増えない | browser | AC-5 | PASS | 同上 |
| 4 | 別の利用者が使っている Google アカウントは連携できない | browser | AC-6 | PASS | `results/browser-4-6-observations.md` |
| 5 | ハンドルを変更すると旧ハンドルが解放され、取り直せる | browser | AC-6 | PASS（注記あり） | 同上 |
| 6 | アカウント削除後、同じメールアドレスとハンドルで再登録できる | browser | AC-6 | PASS | 同上 |
| 7 | ポート契約と適合スイート | api | AC-1, AC-2, AC-3 | PASS | `../api-results.md` |
| 8 | 経路 1（判定 → `beginRelease` の窓）と孤児 `releasing` 行の回収 | api | AC-4, AC-8 | PASS | 同上 |
| 9 | 経路 2（`activate` 喪失 + `reserved` の TTL 失効）の治癒 | api | AC-5 | PASS | 同上 |
| 10 | 品質ゲート（全体） | api | AC-6 | PASS | 同上 |

## エッジケース・異常系

| # | 確認項目 | 手段 | 結果 | 観測記録 |
|---|---|---|---|---|
| E1 | 解除した直後に同じ Google アカウントを再連携する | browser | PASS | `results/browser-edge-observations.md` |
| E2 | 解除した Google アカウントを別の利用者が取得できる | browser | PASS | 同上 |
| E3 | 連携と解除を 3 往復しても鍵が固まらない | browser | PASS | 同上 |

**合計:** 13 件（PASS 13 / FAIL 0）

## 判定の根拠（要点）

### 経路 1・経路 2 が閉じたこと（AC-4 / AC-5 / AC-8）

api 項目 8 で `TC-identity-342` の割り込みが `realProvider.run(fn)` の**直後**（判定 UoW のコミット完了後）に置かれていることをテストコードで確認した。`beginRelease` の直前に割り込む形なら誤順序の実装でも通ってしまうため、この位置が値打ちになる。`TC-identity-345` は「`releasing` 行が消える」ことと「別の利用者がその鍵を `reserve` できる」ことの両方を主張している。

api 項目 9 で `TC-identity-343` が `view.identityId` が既存の残骸行の ID であること・identity が 8 件のまま（9 件に増えていない）ことを主張し、`TC-identity-344` が `sessions` の件数を before / after で比べていることを確認した。

### 全利用者一意性が緩んでいないこと（AC-6）

browser 項目 4 で、利用者 B が利用者 A の使う `oauth-a@example.com` を連携しようとして「この外部アカウントは別の利用者に紐づいています。別のアカウントでお試しください。」で弾かれ、かつ利用者 A の一覧が 2 件のまま（連携を奪われていない）ことを観測した。`IdentityPolicy.findOAuth` の追加がディレクトリの一意性を迂回していない。

### 解放が no-op に倒れていないこと（AC-4 / AC-6）

browser 項目 1（同一利用者の再取得）と エッジ 2（別利用者による取得）の 2 つの角度から、解除で鍵が実際に解放されていることを観測した。エッジ 3 の 3 往復ではどの回にも「解除処理が進行中です」が出ず、`[identityRemovalRelease] keeping the claim` はログに 0 件だった。

### 適合スイート（AC-1 / AC-2 / AC-3）

`ADP-identity-041` は 9 行（変更前の 6 ケース — 解放できる / `releasing` は他人に奪えない / 冪等 / 別利用者は no-op / `reserved` は no-op / 行なしは no-op — がすべて残り、「古い観測値の `beginRelease` が現行 claim を壊さない」「`releasing` 行が別 operation に奪われない」が追加されている）。`ADP-identity-042` は 5 行で、claim の観測 / 鍵種ごとの分離 / claim 生存中のトークン不変 / 同一 `operationId` での張り直しでトークンが変わる / 4 状態での `resolve` と `resolveClaim` の一致、をカバーしている。

## 注記 — 項目 5 のヒント表示（変更起因ではない）

項目 5 の手順 4（旧ハンドル `alpha` が解放されたあと、ウィンドウ2 で `alpha` を入力し直す）で、可用性ヒントが「このハンドルは使われています」のまま変わらなかった。ただし手順 5 の保存は「保存しました」で成功し、ハンドルは `alpha` になっている。

testing.md は「ヒントは目安であり確定は保存時なので、合否は手順 5 の保存結果で判断する」と定めており、保存が成功しているので **PASS**。また保存が通ったこと自体が「旧ハンドルの鍵が実際に解放されている」ことの証拠になっている。

ヒントが古いまま残るのは**本 PR とは無関係**である。`git diff origin/main...HEAD` で確認したところ、`checkHandleAvailability` のユースケース本体もフロントエンド（`apps/web/app`）も本 PR では一切変更されておらず、変わったのは `checkHandleAvailability.test.ts`（`beginRelease` の呼び出しを新しい契約に追随させたもの）だけである。同じ値を入力し直したときにヒントが再問い合わせしない挙動は既存のものと考えられる。

→ Phase 5 でスコープ外の Issue として扱う。

## 環境メモ

- 検証の途中で `pnpm dev` が SIGTERM で停止し、in-memory のデータが失われたため、項目 4〜6 は利用者 A の作成からやり直した（項目 1〜3 の観測は停止前に取得済み）。
- ブラウザーの 2 ウィンドウは `agent-browser` の別セッション（`verify2-w1` / `verify2-w2`）で分離した。
