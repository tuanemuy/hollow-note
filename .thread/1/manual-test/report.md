# ブラウザ検証レポート — Issue #1: [skeleton] アカウント作成から白紙ノート閲覧までを通す

**実行日**: 2026-08-10
**PR**: #12
**テストソース**: `.thread/1/testing.md`
**検証環境**: http://localhost:3000（`MEMORY_MAIL_LOG_ACTION_URL=true PORT=3000 pnpm dev`）
**ツール**: agent-browser 0.33.2

---

## サマリー

| 区分 | 件数 | PASS | FAIL | SKIP |
| --- | --- | --- | --- | --- |
| 確認項目（TC-1〜13） | 13 | 13 | 0 | 0 |
| エッジケース・異常系（EDGE-1〜6） | 6 | 6 | 0 | 0 |
| 既存機能への影響確認 | 1 | 1 | 0 | 0 |
| **合計** | **20** | **20** | **0** | **0** |

**FAIL ゼロ。起票した Issue: なし。**

EDGE-6（サーバー再起動）はテスト実行エージェントの権限外だったため SKIP として引き継ぎ、サーバーの停止・起動権限を持つメインエージェントが最終クリーンアップ時に実行して PASS を確認した。

---

## 確認項目

| TC | テスト名 | 対応 AC | 結果 |
| --- | --- | --- | --- |
| TC-1 | サインアップの基本フロー | AC-16 / AC-8 | PASS |
| TC-2 | サインアップの項目エラーと送信抑止 | AC-16 / AC-2 | PASS |
| TC-3 | メール確認リンクでサインイン状態になりノート一覧へ着地 | AC-17 / AC-15 | PASS |
| TC-4 | ノート一覧の空状態と白紙ノート作成 → 詳細閲覧 | AC-18 / AC-19 | PASS |
| TC-5 | サインアウト | AC-15 | PASS |
| TC-6 | サインインの成功 | AC-16 | PASS |
| TC-7 | 未認証ガードと元の遷移先への復帰 | AC-15 | PASS |
| TC-8 | 認証失敗の共通文言（アカウント存在の秘匿） | AC-15 | PASS |
| TC-9 | 段階待機（THROTTLED）とロック（LOCKED）の状態分離 | AC-16 | PASS |
| TC-10 | 未確認ユーザーのサインイン（EMAIL_NOT_VERIFIED の分離） | AC-16 | PASS |
| TC-11 | 他人のノートへのアクセス収斂（NOTE_NOT_FOUND → P-46） | AC-19 | PASS |
| TC-12 | トップページのサインイン状態分岐 | AC-19 | PASS |
| TC-13 | 静的ページ（P-47） | AC-19 | PASS |

### 特筆事項

- **TC-9** — 失敗1回目は 422、2回目以降は 429。待機秒数が 1→2→4→8→16→32→60→60 秒と倍々に伸び（上限60秒）、10回目で LOCKED 表示に分離することを実測。待機中は再送信自体がブロックされ、待機満了後に正しいパスワードで成功・失敗記録のクリアも確認
- **TC-3 / TC-5** — Cookie 属性を実測: `hollow_session`（HttpOnly / SameSite=Lax / Path=/ / 30日）、`hollow_pending_verification`（HttpOnly / Lax / Path=/ / 約24h）。dev(http) で `Secure` が付かないのは計画どおりの縮退
- verify / signOut / createNote はいずれも `POST /_serverFn/...` で実行されることを Network で確認（ADR-007 / ADR-008 準拠）

---

## エッジケース・異常系

| EDGE | テスト名 | 結果 |
| --- | --- | --- |
| EDGE-1 | 登録済みメールでの再サインアップ（応答同一性） | PASS |
| EDGE-2 | 使用済み・無効な確認リンク | PASS |
| EDGE-3 | **他人の確認リンクを踏んでもサインイン状態にならない（login CSRF）** | PASS |
| EDGE-4 | オープンリダイレクト防止 | PASS |
| EDGE-5 | サインイン画面に見送り機能の UI が出ていないこと | PASS |
| EDGE-6 | サーバー再起動でデータが消える（仕様の確認） | PASS |

### EDGE-3（login CSRF）— ADR-038 の実効性

独立した2セッション（攻撃者役 / 被害者役）で攻撃シナリオをなぞった:

1. 攻撃者セッションで `attacker@example.com` をサインアップ → 確認 URL を取得。`hollow_pending_verification` は攻撃者のブラウザーにのみ発行される
2. 事前確認として確認 URL を Cookie なしの `curl` で GET → 200、`Set-Cookie` なし（GET 単体では認証状態を作らない）
3. 被害者セッションで `user-a@example.com` としてサインイン済みの状態を作る
4. **被害者のウィンドウで攻撃者の確認 URL を開く**（攻撃本体）→ `/notes` へ遷移せず「メールアドレスを確認しました／サインインしてください」に着地
5. 被害者の `hollow_session` は破棄も上書きもされず、直後に `/notes` を開くと **user-a のノート2件がそのまま表示**。アカウントメニューも「User A」のまま
6. サーバーログでは `identity.user.emailVerified` が **攻撃者の userId** で発行済み（＝攻撃者自身のメール確認は成立、被害者には影響なし）

**結論: login CSRF は成立しない。** 自動サインインは、サインアップ応答で同一ブラウザーに焼かれた `hollow_pending_verification` を持つウィンドウでのみ成立する（ADR-038 の設計どおり）。

### EDGE-6（サーバー再起動）の判定根拠

再起動後に、再起動前は登録済みだった `user-a@example.com` で再サインアップしたところ、サーバーログのテンプレートが `emailVerification`（新規登録）となり確認 URL も発行された。EDGE-1 で同じ操作をしたときは `email_already_registered` で確認 URL は出なかったため、**アカウントが再起動で消えている**ことが観測できた。in-memory 永続化の仕様どおり。

---

## 既存機能への影響確認

`/`（未認証・認証済み両方）、`/signup`、`/signin`、`/terms`、`/privacy`、`/notes`、`/notes/{id}`、存在しないパス（404 → P-46）、他人のノート（NOT_FOUND → P-46）を巡回し、いずれも健全。

- `pnpm typecheck` / `lint` / `format:check` / `test:unit`（28 files・466 tests）/ `build` すべて成功
- **本番ビルドでも検証**: ポート3100 で `pnpm start` を起動し、signup / verify / createBlankNote / signOut / signin の **server function 5本すべて POST 200（404 ゼロ）**
- 削除した todo 参照実装への導線・残存 UI は皆無（`/todo` は dev / 本番とも 404 + P-46）
- dev 起動ログに libSQL / `DATABASE_URL` / wrangler 由来の警告・エラーなし

---

## FAIL 扱いしなかった観測（計画どおりの縮退・testing.md の注記に該当）

- LOCKED 時のパスワード再設定導線が文言のみ（実導線は後続スライス）
- 確認メールの再送導線なし
- dev(http) で Cookie に `Secure` が付かない
- ノート一覧の空状態にアップロード導線がない
- P-46 の NOT_FOUND 表示に「再試行」ボタンがない（再試行は ServerErrorState 側の設計）
- **TC-4 の確認ポイント「本文領域が Shadow DOM で描画される」は確認不能（N/A）** — `NoteDetail` は `content.html` が空のとき Shadow DOM ホストではなく「このノートは白紙です。」に分岐する。本スライスは白紙ノートしか作れないため観測対象が存在しない。実装バグではなく手順書側のギャップ

## 軽微な観測（FAIL 扱いせず、TC-9 に記録）

待機アラートの `aria-hidden` なカウンタ「（あと N 秒）」が表示直後の1秒だけ過大な値を出す（`SignInForm` の `now` がマウント時の値のままで、1秒周期のインターバル初回発火まで更新されないため）。1秒後に補正され、支援技術に読まれる権威的な「約 N 秒」は常に正しい。

---

## 環境の後始末

- dev サーバー（ポート3000）・本番検証サーバー（ポート3100）とも停止済み、ポート解放を確認
- agent-browser の全セッションを close、残存プロセスなし
- テストで作成したデータは in-memory のためサーバー停止とともに消滅
- ソースコードへの変更なし（`git status` はテスト成果物のみ）
