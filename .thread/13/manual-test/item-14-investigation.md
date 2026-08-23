# 確認項目 14 step 5 の差異の切り分け

**分類: C（テスト手順の問題）** — PR #36 の変更とは無関係。実装は設計どおりに動いており、`testing.md` の手順 4／期待結果 5 が現実のタイミングと噛み合っていない。

## 観測された差異

`run-c-observations.md` の確認項目 14 手順 4〜5:

- 期待: 受理直後にリロードすると `sessionStorage` の ticket から進捗表示が復帰する
- 観測: 空の削除フォームが再表示され、`sessionStorage` には `tsr-scroll-restoration-v1_3` しか無かった

## 1. PR 起因ではないことの根拠（コード）

`git diff origin/main...HEAD -- apps/web/app/components/settings/DeleteAccountPanel/` の差分は 2 行だけ:

```diff
-import { useRouteContext } from "@tanstack/react-router";
+import { useLoaderData } from "@tanstack/react-router";
...
-  const { user } = useRouteContext({ from: "/settings" });
+  const { user } = useLoaderData({ from: "/settings" });
```

この経路に影響しない:

- 復帰判定は `canRestoreTicket(stored, currentUserId)`（`ticketStorage.ts:47-50`）。`currentUserId === null` なら**保存時の主体に関わらず true** を返す。
- 手順 5 の時点でセッションは失効しているので `user` は `null`。供給源が `routeContext` でも `loaderData` でも `currentUserId` は `null` で同一。
- `/settings` の loader が `staleReloadMode: "blocking"` になった件も、リロード（フルロード）では stale 再検証の分岐に入らず、`sessionStorage` の読み書きにも触れない。

## 2. 実際の原因（実機で確認）

ticket は完了到達時に**設計として捨てられる**。`index.tsx:166-170` の `settle()` が `forgetTicket()` を呼び、`completed` / `rejected` / `DELETION_TICKET_EXPIRED` / `DELETION_TICKET_INVALID` で発火する。

このブランチの DEV サーバー（`localhost:3100`）で、`sessionStorage` を 50ms 間隔でサンプリングしながら削除を実行した結果（アカウント `probe14@example.com`）:

| 経過 (ms) | ticket キー | 見出し |
| --- | --- | --- |
| 58 | 無し | アカウントを削除 |
| 3601 | **有り** | アカウントを削除しています |
| 3653 | 無し | アカウントを削除しました |

ticket が `sessionStorage` に存在するのは **受理〜完了のあいだの数十 ms だけ**。in-memory バックエンドでは受理と完了がほぼ同時に返るため、この窓を人手（およびエージェント）のリロードで狙うことは事実上できない。別アカウント（`probe16@example.com`）で 30ms 間隔にしても窓を捕捉できなかった。

したがって run-c の観測（完了表示を確認してからリロード）で空フォームに戻るのは**正しい描画**であり、失敗ではない。

## 3. 復帰そのものは動いている（実機で確認）

窓の短さを取り除くため、`sessionStorage.removeItem` の当該キーだけを 1 回だけ無効化して「完了前にリロードした」状況を再現した（アカウント `probe17@example.com`）:

1. 削除を実行 → `blocked=1` / `ticket=PRESENT` / 見出し「アカウントを削除しました」
2. そのままリロード → 着地 URL は `/settings/danger`（`/signin` へのリダイレクト無し）、Cookie は `[]`（未サインイン）、見出しは **「アカウントを削除しました」**（空フォームではない）

= ticket が残っていればリロード後に進捗表示が復帰する。この PR のブランチ上で成立しているので、`main` との A/B は不要と判断した（差分が上記 2 行のみで、かつ復帰が現ブランチで動いているため）。

## 4. 項目 14 の本来の目的は達成されている

この項目の目的は「ガードを `beforeLoad` から `loader` へ移す唯一の分岐条件（`SIGNED_OUT_PATH`）が両方向で生きていること」。

- 手順 1: 未サインインで `/settings/danger` 直開き → `/signin` へ飛ばずパネル描画（上部バー・タブ列なし）。**合格**
- 手順 5: 受理でサインアウトした状態のリロード → `/signin` へ飛ばず `/settings/danger` に留まる。**合格**

落ちたのは進捗復帰の見え方だけで、それは ticket の寿命の問題。

## 5. `testing.md` の直し方（提案）

`.thread/13/testing.md:364-380` の項目 14:

- 手順 4 を「受理表示が出たらリロード」から、**タイミングに依存しない形**に変える。例:
  - 合否判定は「`/signin` へリダイレクトされず `/settings/danger` に留まること」に置く（これが AC-11 の本題）。
  - 進捗復帰は**条件付き**にする — 「リロードが『アカウントを削除しています』の表示中に間に合った場合のみ進捗表示が復帰する。完了表示に到達したあとのリロードでは、ticket が破棄済みのため空の削除フォームに戻るのが正しい」。
- 期待結果 5 の「終端の『アカウントを削除しました』」という表現は誤解を招く。完了に到達した時点で ticket は捨てられるので、**完了後のリロードでこの表示に戻ることはない**（復帰した ticket を照会した結果として出ることはある）。
- 補足として「in-memory バックエンドでは受理〜完了が数十 ms で、リロードで窓を狙うのは現実的でない」旨を明記する。

## 参照

- `/Users/hikaru/github.com/tuanemuy/hollow/apps/web/app/components/settings/DeleteAccountPanel/index.tsx`（`settle()` / `forgetTicket()` は 166-170、復帰の `useEffect` は 148-154）
- `/Users/hikaru/github.com/tuanemuy/hollow/apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`（キー名 `hollow.account-deletion-ticket`、`canRestoreTicket` は 47-50）
- `/Users/hikaru/github.com/tuanemuy/hollow/.thread/13/testing.md:364-380`
