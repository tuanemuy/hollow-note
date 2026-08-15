# 項目 19: 認証手段管理 — サインアウト

**結果**: PASS
**対応する受け入れ基準**: AC-16 ／ TC-12

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 0 | ウィンドウ2 は項目 18 でサインアウト済みのため `user-a@example.com` / `NewPassw0rd456` で再サインイン | `/notes` 表示、セッション Cookie がある | `/notes` へ遷移。Cookie に `hollow_session=MDE5ZmY1YzAtMTU5NC03MmZhLTlmYjUtOTEzMGU0MjhkM2Y2....`（httpOnly のため `document.cookie` からは見えない） | PASS |
| 1 | アカウントメニューの「サインアウト」を実行（通信を記録） | トップページ（`/`）へ遷移。Cookie が削除される | `http://localhost:3100/` へ遷移。リクエストは `POST /_serverFn/...`（`/app/components/layout/AccountMenu/action.ts` の `signOutFn`）で **200**。実行後の Cookie 一覧は**空**（`hollow_session` が消えている） | PASS |
| 2 | `/notes` を直接開く | サインイン画面へリダイレクト | `http://localhost:3100/signin?redirect=%2Fnotes` へリダイレクト | PASS |

## 確認ポイント

- サインアウトは **POST の server function**（GET リンクではない — ADR-008）であることを通信ログで確認した。
