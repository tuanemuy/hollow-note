# TC-003 観測ログ: SCOPE_TASK_LEASE_MS を配備側が選べる（dev で値が届く）

**セッション:** verify-tc-003
**実行日:** 2026-08-24
**env:** `SCOPE_TASK_LEASE_MS=600000`

## 実行ログ

| # | 操作 | 期待結果 | 実際に観測した内容（原文） |
|---|------|---------|--------------------------|
| 1 | `http://localhost:3100/signin` を開く | 500 にならず正常応答 | ページタイトル「サインイン — Hollow」。500 やエラー画面は出ず、見出し「サインイン」、フォーム（メールアドレス／パスワード）、ボタン「Google で続ける」が表示された |
| 1 | 「Google で続ける」をクリック | 開発用 ID プロバイダー同意画面に遷移 | 見出し「開発用 ID プロバイダー」。textbox「メールアドレス」（既定値 `dev-user@example.com`）、textbox「表示名」（既定値 `Dev User`）、checkbox「メールアドレスは確認済み（`email_verified`）」（`checked=true`）、ボタン「許可する」「キャンセル」 |
| 1 | メール `del-d@example.com` / 表示名 `削除四郎` を入力し（email_verified は既に ON のまま）「許可する」をクリック | サインインしてホームへ遷移 | 見出し「個人」「最初のノートを作る」、ボタン「白紙から書く」が表示。URL は `/notes` 相当のホーム |
| 2 | `/notes` を開き「白紙から書く」／「新規作成」でノートを3件作成 | ノート3件が作成される | 1件目作成後 URL が `http://localhost:3100/notes/01a02fdf-d399-70bb-8cbb-ad60e49f99c6` に遷移し見出し「無題」。2件目 `http://localhost:3100/notes/01a02fdf-f0f5-7466-be4d-b7fa88912fac`、3件目 `http://localhost:3100/notes/01a02fe0-04fd-73a4-a0b9-c072eceee317`。最終的に `/notes` の一覧に「無題 非公開。 更新 8月24日 03:26 8月24日」のリンクが3件表示された |
| 3 | `/settings/profile` を開き、`input[type=file]` に `upload` で `/tmp/hollow-manual-19/avatar.png` を渡す | 画像が選択・保存される | 下記「アバターアップロード」節を参照 |
| 4 | サーバーログの行数を記録 | - | アバター保存前時点で `wc -l` = 83 行 |
| 5 | `/settings/danger` を開き、確認欄に `del-d@example.com` を入力して「アカウントを削除する」をクリック | 削除完了表示まで進む | 下記「削除の所要時間」節を参照 |
| 6 | 手順4以降の増分ログを確認 | - | 83行 → 157行（74行増加）。下記「サーバーログの観測」節を参照 |

## アバターアップロード（手順 3）

- `upload` コマンドの出力: `[agent-browser] restore: loaded; save: saved` / `✓ Done`（エラーなし）
- 保存後の画面表示: アップロード直後、`snapshot -i -c` で「画像を選ぶ」ボタンの隣に新たに「削除」ボタンが出現。スクリーンショットでは、アイコン枠が単色の緑の円形画像に変化（右上のアカウントメニューのアバターも同じ緑色に変化）。ただし「保存」ボタンは終始 `disabled` のままで、明示的な「保存」クリックは発生しなかった（アイコンは選択と同時に即時保存される挙動と見られる）。
- 検証: ページを `reload` した後も同じ緑のアイコンと「削除」ボタンが残存しており、リロード後も表示が変わらなかった。
- 成功したか: した（アイコンが変化し、リロード後も保持された。「保存」ボタンは押していないが、アップロードは即時反映されている）

## 削除の所要時間（手順 5）

- クリック時刻: 1787509658
- 完了確認時刻: 1787509660
- 所要: 2秒
- 進捗表示の推移: クリック直後、次の `snapshot -i -c`（約2秒後）で見出しが「アカウントを削除」から「アカウントを削除しました」に変化し、ボタン「トップページへ」が表示された。中間の進捗表示（プログレスバー等）は観測タイミングの間隔（10秒おきの予定を1回目で完了確認したため）では捕捉されなかった。

## サーバーログの観測

- 500 / zod エラー: 出ない（`grep -n -iE "zod|500|error"` でサーバーログ全体を検索したが該当行なし）
- `[scope-tasks] task threw` / `backoff failed` / `no handler for`: 出ない（該当行なし）
- 手順4以降に増えた74行はすべて `[queue] received ...`（`identity.accountDeletionManifestBuildContinued` / `identity.accountDeletionDispatchContinued` / `storage.fileDeleted` / `identity.userAuthResidueCleanupContinued` / `identity.accountDeletionManifestCompactContinued` / `identity.user.deleted` 等）と `[deleteAccount] finalize is still waiting {...}`（`attemptedBy: 'uniquenessRelease'` および `attemptedBy: 'redaction'`）、`[subscribers] no subscriber for identity.user.deleted {...}` のみ。これらは通常の削除フローのログ出力であり、`[scope-tasks]` プレフィックスの行やスタックトレース、zod 形式のバリデーションエラーは含まれていなかった。

## 未実行・観測できなかった手順

なし（全手順を制限時間内に実行し観測した）。ただし手順5の「10秒おきの進捗観測」は、1回目のスナップショット（クリックから約2秒後）で既に完了表示になっていたため、それ以降の観測は不要となり実施していない。
