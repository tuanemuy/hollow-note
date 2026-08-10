# シードデータ

**投入なし。** 永続化が in-memory のため DB マイグレーション・シード投入は不要（`.thread/1/testing.md` の確認環境に明記）。テストユーザーは各テストケース内でサインアップして作成する。

環境変数:
- `MEMORY_MAIL_LOG_ACTION_URL=true` — 確認メールの URL をサーバーログに出すため（既定 false）

## TC-1〜5 実行後のプロセス内状態（後続テスト向け）

| メール | パスワード | 表示名 | 状態 |
|---|---|---|---|
| `user-a@example.com` | `Passw0rd123` | User A | メール確認済み・Active。ノート 2 件所有。**現在サインアウト済み** |
| `user-a2@example.com` | `Passw0rd123` | User A2 | メール確認済み・Active。ノート 0 件。サインアウト済み |
| `user-c@example.com` | — | — | **未登録**（TC-2 で入力しただけで送信していない） |

ノート（所有者 `user-a@example.com`、いずれもタイトル「無題」／非公開）:
- `/notes/019feb0e-e2a8-7703-b022-9a8f8745dafd`
- `/notes/019feb10-7bf8-754c-9222-e8f0486ee717`

使用済み確認トークン（エッジケース 2「使用済みリンク」で再利用可能）:
- `http://localhost:3000/verify-email?token=MDE5ZmViMGEtZWU1Ny03NGU3LWJhYjItMTg3MTc5NGVkNThm.eMV4RlETJqr_PxOK03fpfmLhb8D3ZcAue1xnoWpcwg8`（user-a）
- `http://localhost:3000/verify-email?token=MDE5ZmViMGQtOTRkMC03NWNhLWJiZmEtYzQ3NGNmNjU3MjU3.-Ywaf5RDpyTBgDDh-8W3DzVHAlLwY7Ew5CE_6MZllDI`（user-a2）

## TC-6〜13 実行後の追加状態（後続テスト向け）

TC-6〜13 で新規に作成したアカウント:

| メール | パスワード | 表示名 | 状態 |
|---|---|---|---|
| `lockme@example.com` | `Passw0rd123` | Lock Me | メール確認済み・Active。**TC-9 で LOCKED（8月10日 19:11 頃まで解除不可）**。ノート 0 件 |
| `pending@example.com` | `Passw0rd123` | Pending User | **メール未確認（Pending）**。確認リンクは未使用のまま残っている |
| `user-b@example.com` | `Passw0rd123` | User B | メール確認済み・Active。ノート 0 件 |

未使用の確認トークン:
- `http://localhost:3000/verify-email?token=MDE5ZmViMTgtNjM5MS03NzljLWJhYTQtYzdiNzE1NzcxNGRi.UVkPosuvhn0BdKSsDzFLVj7u0jAizYh9_igl7ulX078`（`pending@example.com` — 未消費。踏むと Active になるので注意）

使用済み確認トークン（追加）:
- `http://localhost:3000/verify-email?token=MDE5ZmViMTUtMjNlNC03NWU5LWI2NjQtYTkyNTEyYzEwNTcw.f_4X8_COiQgQWKu_V4p37dNftYfQTD8P6jWOTobJ4Bg`（lockme）
- `http://localhost:3000/verify-email?token=MDE5ZmViMTktNDI4Zi03N2M4LWFkZDYtMTJkNjIyMTU4Yjgw.pf1tnrS3xHfO-IVrJmbc3blbLJQD0651DxBNyKruORg`（user-b）

## エッジケース 1〜5 / REGRESSION 実行後の追加状態

dev サーバー（ポート 3000、同一プロセス）に追加されたアカウント:

| メール | パスワード | 表示名 | 状態 |
|---|---|---|---|
| `attacker@example.com` | `Passw0rd123` | Attacker | EDGE-3 用。メール確認済み・Active（確認は被害者ウィンドウで踏まれて成立）。ノート 0 件。**一度もサインインしていない** |

- `user-a@example.com` / `pending@example.com` に対して再サインアップを実行済み（EDGE-1）。どちらも `existingAccountNotice` メールのみで、**アカウント状態は不変**（`pending@example.com` は Pending のまま、未消費トークンも無効化されていない）。
- `user-a@example.com` は EDGE-4 で 4 回サインイン → 4 回サインアウト済み。最後の状態は `verify-c` セッションで `/notes/019feb0e-…` にサインイン中。
- `verify-c-victim` セッションも `user-a@example.com` でサインイン中。

使用済み確認トークン（追加）:
- `http://localhost:3000/verify-email?token=MDE5ZmViMjEtNzgxMi03NDFlLWFkZDAtYTVkODk5NDZjNGM2.8LPSyGqwEhh9Mg1uaD6r3pT7Fy-7wHtSzFNVePIB1dE`（attacker — EDGE-3 で消費済み）

本番ビルド（ポート 3100）は REGRESSION 用に一時起動し**すでに停止済み**。そのプロセス内で作った `prod@example.com` / ノート 1 件は消滅している。dev サーバー（ポート 3000）は**起動したまま**。

その他:
- `user-a@example.com` は TC-9 手順8 の成功サインインで**ログイン失敗記録がクリア済み**（待機・ロックなし）。
- `nobody@example.com` は未登録のまま（TC-8 で入力しただけ）。
- ブラウザセッション（`verify-b` 〜 `verify-b4`）はすべて close 済み。次のエージェントは再度サインインが必要。
- 補足: `agent-browser` の `fill` は、`open` 直後（ハイドレーション完了前）に CSS セレクターで実行すると React の state に反映されず送信ボタンが disabled のままになることがある。`wait --load networkidle` を挟むか、`snapshot` の `@ref` を使うと確実。
