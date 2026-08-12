# 項目 28: アカウント削除 — 受理からの完走（accepted → running → completed）

**結果**: PASS
**対応する受け入れ基準**: AC-26、AC-27、AC-28、AC-29、AC-31、AC-32（TC-14 手順 1〜3。手順 4〜7 は skip → #9 / #3 / #5 / #6）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | `/settings/danger` の確認欄に `user-a@example.com` を入力し削除を実行 | 受理される | `POST /_serverFn/…deleteAccountFn…` が発行された | PASS |
| 2 | 実行直後の画面表示と応答ステータスを確認 | HTTP **202**、セッション Cookie 破棄、**画面は `/settings/danger` に留まる** | 応答は **202**（直前の誤入力時は 422）。`agent-browser cookies` の出力が空になり `hollow_session` が消えた。`location.pathname` は `/settings/danger` のまま（別ページへの遷移なし） | PASS |
| 3 | 画面から離れずに進捗表示を最大 60 秒観察 | `accepted` → `running` → `completed` と進む | **約 2 秒以内に完了**し、「アカウントを削除しました／プロフィールとログイン方法、アップロード済みファイルを削除しました。ご利用ありがとうございました。」＋「トップページへ」を表示。途中経過（accepted / running）は速すぎて画面上では観測できなかったが、サーバーログ上で全ステージの進行を確認（下記） | PASS |
| 4 | 完了表示からの遷移導線を押す | トップページへフル遷移 | 「トップページへ」で `GET http://localhost:3100/` が **Document リクエスト**として発生（＝フル遷移）。トップの LP が表示 | PASS |
| 5 | `/notes` を開く | サインイン画面へリダイレクト | `GET /notes` → `/signin?redirect=%2Fnotes`。Cookie も空のまま | PASS |

## 確認ポイントの検証

- **削除実行後にナビゲートしない（ADR-006）**: 画面は `/settings/danger` に留まった。**PASS**
- **サーバーログの処理内容**（エラー・例外なし。`error` / `failed` / `reject` のログは 0 件）:
  - `identity.accountDeletionManifestBuildContinued …:memberships:-` / `…:authorRoutes:-`（マニフェスト構築）
  - `identity.accountDeletionDispatchContinued …:cleanup:-`（personal cleanup 開始）
  - `storage.fileDeleted 019ff5e6-cb54-… aggregateId: user:019ff5c0-…`（**storage** のアバター削除）
  - `identity.userAuthResidueCleanupContinued`（**authResidue**）× 2
  - `identity.accountDeletionDispatchContinued …:redaction:-`
  - `identity.accountDeletionDispatchContinued …:finalize:uniquenessRelease` と `[deleteAccount] finalize is still waiting { receipts: [ 'personalCleanup', 'uniquenessRelease' ] }`（**personalCleanup / uniquenessRelease** のレシート確認）
  - `identity.user.deleted 019ff5e6-cb58-…`
  - `…:finalize:authResidue` → `identity.accountDeletionManifestCompactContinued …:compact:-`
  - `usage` 名義の個別ログ行は出ないが、personal cleanup のレシートに集約されている（`receipts: ['personalCleanup', …]`）。
- **完了までの所要時間**: 60 秒どころか約 2 秒。ADR-023 の 1 秒 tick / commit kick は正常に効いている。
- **進捗ポーリング中の再読み込み復帰（`sessionStorage` の ticket）**: 削除が 2 秒で完走したため、ポーリング中に再読み込みするタイミングを取れず**未検証**。完了後は `sessionStorage` に削除 ticket は残っていない（`tsr-scroll-restoration-v1_3` のみ）。

## 補足

- 手順 4〜7 は testing.md の指示どおり skip（#9 / #3 / #5 / #6）。
- 本項目の実行により `user-a@example.com` は削除済み。ウィンドウ1（`mt-w1`）は未サインイン状態になった。
