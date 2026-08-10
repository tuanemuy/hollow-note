# EDGE-3: 他人の確認リンクを踏んでもサインイン状態にならない（login CSRF）

**結果**: PASS
**対応する受け入れ基準**: AC-17、AC-15（CSRF 規律）
**目的**: 確認リンクの自動 POST が「攻撃者セッションの注入」に使えないこと（ADR-038 / R3-SC-B-301）

## 検証構成

Cookie ストアを完全に分離するため、agent-browser の独立セッションを 2 つ使用した。

| 役 | セッション名 | 役割 |
|---|---|---|
| 攻撃者 | `verify-c-attacker` | `attacker@example.com` をサインアップし、確認リンクを入手する |
| 被害者 | `verify-c-victim` | `user-a@example.com` でサインイン済みの通常ウィンドウ。ここで攻撃者のリンクを踏まされる |

攻撃者アカウント: `attacker@example.com` / `Passw0rd123` / 表示名 `Attacker` / userId `019feb21-7812-741e-add0-a5d89946c4c6`

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | 攻撃者セッションで `/signup` から `attacker@example.com` をサインアップ | 送信完了状態になり、ログに確認 URL が出る | 「確認メールを送信しました」。ログに `mail.sent { to: 'attacker@example.com', template: 'emailVerification', actionUrl: 'http://localhost:3000/verify-email?token=MDE5ZmViMjEt….8LPSyGqwEhh9Mg1uaD6r3pT7Fy-7wHtSzFNVePIB1dE' }`。`identity.user.created` / `identity.identity.added` も配信 | PASS |
| 2 | （前提確認）確認 URL を `curl` で GET（JS 実行なし・Cookie なし） | GET だけではセッションが張られない | `HTTP/1.1 200`、`Set-Cookie` ヘッダーなし、`Location` なし。GET 単体では認証状態を作らない（ADR-007） | PASS |
| 3 | 被害者セッションで `/signin` から `user-a@example.com` / `Passw0rd123` サインイン | `/notes` へ着地し User A としてサインイン | URL `http://localhost:3000/notes`。アカウントメニューを開くと表示名 **「User A」** ＋「サインアウト」。「2 件のノート」を表示（TC-4 で作成した user-a のノート 2 件） | PASS |
| 4 | **被害者のウィンドウで、攻撃者の確認 URL をそのまま開く**（攻撃本体） | `/notes` へ遷移せず、確認ページに「メールアドレスを確認しました。サインインしてください」相当の状態が出る | URL は `/verify-email?token=…` のまま（`/notes` へのリダイレクトなし）。画面は **「メールアドレスを確認しました／サインインすると使い始められます。／サインインへ」**。攻撃者としてのサインイン状態には**ならない** | PASS |
| 5 | 手順4 の Network を確認 | トークン消費はマウント後の POST で行われる | `POST /_serverFn/…verifyEmailFn_createServerFn_handler` が 1 本、ステータス 200。ページ GET は 200 のドキュメント取得のみ | PASS |
| 6 | 手順4 の直後に被害者ウィンドウで `/notes` を開く | ユーザー A のセッションが上書き・破棄されていない | `/notes` がそのまま表示（`/signin` へリダイレクトされない ＝ `hollow_session` が破棄されていない）。「2 件のノート」＋ user-a のノート 2 件を表示（攻撃者のノート 0 件の一覧に**なっていない** ＝ セッションが攻撃者に**すり替わっていない**） | PASS |
| 7 | 被害者ウィンドウのアカウントメニューを再確認 | 表示名がユーザー A のまま | **「User A」**＋「サインアウト」。`attacker@example.com` / `Attacker` には変わっていない | PASS |
| 8 | サーバーログを確認 | 攻撃者のメール確認自体は成立している | `identity.user.emailVerified` が `aggregateId: 019feb21-7812-741e-add0-a5d89946c4c6`（= attacker の userId）で配信済み。被害者 user-a の userId ではない | PASS |
| 9 | 攻撃者セッションで同じ確認 URL を開き直す | 「このメールアドレスは確認済みです」になる（トークンは消費済み） | 「このメールアドレスは確認済みです／すでに確認が完了しています。そのままサインインしてください。／サインインへ」。トークンが消費済みであることを確認 | PASS |

## 結論（攻撃シナリオの再現結果）

攻撃者が自分のアカウントの確認リンクを被害者に踏ませても、

- 被害者のブラウザで走る自動 POST は **確認処理だけを実行し、セッション Cookie を発行しない**（画面は「サインインしてください」で止まる）。
- 被害者の `hollow_session` は **上書きも破棄もされない**。手順6 で `/notes` が未認証リダイレクトにならず、user-a のノート 2 件がそのまま見えたことで確認済み。
- 自動サインインは、サインアップ応答で同一ブラウザに焼かれた `hollow_pending_verification` Cookie を持つウィンドウでのみ成立する設計（ADR-038）。被害者のウィンドウには攻撃者の pending Cookie が存在しないため、自動サインイン経路に入らず「確認のみ完了」へ倒れる。
- 攻撃者アカウントのメール確認自体は成立する（トークン消費・`identity.user.emailVerified` 発行）が、それは攻撃者自身の状態変化に留まり、被害者のセッションには一切影響しない。

login CSRF（攻撃者セッションの注入）は成立しない。

## 失敗詳細

なし。
