# エッジケース 2 観測ログ: 極端に短いリースでも取り違えが起きない

**セッション:** verify-edge-002r
**実行日:** 2026-08-24
**env:** `SCOPE_TASK_LEASE_MS=1000`（1秒 = ランナーの tick と同じ長さ）

> 注: 初回の実行はサーバーの停止に失敗しており、リース 10 秒のプロセスに対して観測していた（`server.log` に `Port 3100 is already in use`）。本記録はサーバーを正しく入れ替えた上での再実行。

## サーバーログの妥当性確認（手順 0）

- `ps -p 47561 -o pid,lstart,command` で該当プロセスの起動時刻が `月 8/24 03:47:51 2026` であることを確認。`lsof -p 47561` で fd 1w/2w（stdout/stderr）が `.../scratchpad/server.log`（inode 85925953）に直結していることを確認した
- `lsof -i :3100 -sTCP:LISTEN` でポート 3100 を握っているのが pid 47561 であることを確認
- ログが増えるか: 手順0時点で20行だったログが、以降の操作（ノート作成・アバターアップロード・削除）を経て305行まで増加し、削除完了後10秒待機しても305行のまま安定した。**増加を確認した**
- `already in use` の行: **なし**（`grep -c "already in use" server.log` → 0）

## 実行ログ

| # | 操作 | 期待結果 | 実際に観測した内容（原文） |
|---|------|---------|--------------------------|
| 1 | `http://localhost:3100/signin` を開く→「Google で続ける」→開発用IDプロバイダー同意画面でメール `del-g@example.com` / 表示名 `削除七郎` / `email_verified` ON にして「許可する」 | サインインして `/notes` へ遷移 | 同意画面初期値は `dev-user@example.com` / `Dev User` / `checked=true`。値を書き換えて「許可する」クリック後、見出し「個人」「最初のノートを作る」、`button "白紙から書く"` を表示（サインイン成功、ノート0件） |
| 2 | `/notes` で「白紙から書く」／「新規作成」ボタン（ref e3）を繰り返しクリックし、`open /notes` との往復でノートを20件作成 | 20件のノートが作成される | エラーなく20回作成できた。最終スナップショットで `region "ノート"` 配下に `link "無題 非公開。..."` が20件表示された（ref e7〜e26） |
| 3 | `/settings/profile` で `input[type=file]` に `upload` コマンドで `/tmp/hollow-manual-19/avatar.png` を指定 | 画像がアップロードされる | `upload` 実行後 `✓ Done`。スナップショットで「画像を選ぶ」ボタンの隣に新規に「削除」ボタンが出現。`eval` で `<img>` の `src` が `http://localhost:3100/storage/users/01a02ff4-e8e1-773d-bcfe-26661a31b854/avatar/01a02ff6-d4b7-750a-a7a9-d0d0d9230103.png` に変わっていることを確認（アップロード成功） |
| 4 | サーバーログの現在の行数を記録（`wc -l`） | — | `server.log` は **236行** |
| 5 | `/settings/danger` で確認欄に `del-g@example.com` を入力し「アカウントを削除する」をクリック。進捗を最大90秒観察 | 削除完了表示まで到達する | クリック直後の最初の `snapshot -i -c` の時点で、既に見出しが「アカウントを削除しました」・`button "トップページへ"` に変化していた。中間状態の文言は捕捉できなかった |
| 6 | 手順4以降に増えた `server.log` を確認 | — | クリック直後は305行まで増加（+69行）、その後10秒待機しても305行のまま変化なし（安定） |
| 7 | 参照ログ（`server-tc003.log`）と今回のログを比較 | — | 下記「参照ログとの比較」節を参照 |

- 作れたノート件数: **20件**（指示通り全件作成できた）
- アバターアップロード: **成功**（`<img src>` がアップロード後の storage URL に変化し確認できた）

## 削除の所要時間（手順 5）

- クリック時刻: 1787511118（Unix秒）
- 完了確認時刻: 1787511123（Unix秒、最初の `snapshot -i -c` 実行完了時点）
- 所要: 5秒以内（最初の観測時点で既に完了表示だったため、実際の完了はこれより早い可能性がある）
- 進捗表示の推移: クリック→（`snapshot -i -c` 1回目）で見出しが既に「アカウントを削除しました」、`button "トップページへ"` を表示。「アカウントを削除」という削除前見出しから、中間状態（`accepted`/`running`等）の文言を挟まず完了表示に変わっていた。以降10秒待機してサーバーログの増分停止を確認したが、画面表示自体はその時点で既に完了表示のまま変化していない

## サーバーログの観測

削除操作に対応する区間（手順4時点の236行目の直後〜305行目、69行）を確認:

- `[queue] received`: 12行
- `[deleteAccount] finalize is still waiting`: **1回**（`attemptedBy: 'uniquenessRelease'` のみ。`receipts: [ 'personalCleanup', 'uniquenessRelease' ]`）
- `[scope-tasks] task threw`: **出ない**（該当区間・ログ全体とも0件）
- `[scope-tasks] backoff failed`: 出ない（ログ全体で0件）
- `[scope-tasks] no handler for`: 出ない（ログ全体で0件）
- 出現した identity./storage. イベント種別（6種）: `identity.accountDeletionDispatchContinued` / `identity.accountDeletionManifestBuildContinued` / `identity.accountDeletionManifestCompactContinued` / `identity.user.deleted` / `identity.userAuthResidueCleanupContinued` / `storage.fileDeleted`
- `[subscribers] no subscriber for identity.user.deleted` が1回出現
- 最終行は `[queue] received identity.accountDeletionManifestCompactContinued ... compact:-`（マニフェスト圧縮の継続イベント）で終わっている

## 参照ログとの比較（手順 7）

参照ログ `server-tc003.log`（全164行）は削除操作以外の内容（サインイン・ノート作成等）も含む1セッション分の記録だったため、今回と同じ切り出し方法（`storage.fileStored` の `[subscribers] no subscriber` 行の直後〜削除完了までの区間）で該当箇所（84〜164行目、81行）を抽出して比較した。この末尾には `[ELIFECYCLE] Command failed`・`SIGTERM` 等のプロセス終了ログも含まれていたが、これは削除処理そのものとは無関係な、そのセッション終了時のログである。

| 項目 | 今回（リース1秒） | 参照（server-tc003.log） |
|---|---|---|
| `[queue] received` の行数 | 12 | 12 |
| `[deleteAccount] finalize is still waiting` の行数 | 1 | 2 |
| 同 `attemptedBy` の値 | `uniquenessRelease` のみ | `uniquenessRelease` と `redaction` の両方 |
| `[scope-tasks] task threw` の行数 | 0 | 0 |
| イベント種別の一覧 | `identity.accountDeletionDispatchContinued` / `identity.accountDeletionManifestBuildContinued` / `identity.accountDeletionManifestCompactContinued` / `identity.user.deleted` / `identity.userAuthResidueCleanupContinued` / `storage.fileDeleted`（6種） | 同上6種（完全一致） |

- 今回のログにしか出ていない行: **なし**（UUID等の識別子を正規化した上で行内容を突き合わせたところ、今回のログの行はすべて参照ログ側にも同じ形で存在した）
- 参照ログにしか出ていない行（削除処理起因のもの）:
  ```
  [deleteAccount] finalize is still waiting {
    operationId: '01a02fe0-d3ed-7128-b4b3-0855bae10026',
    attemptedBy: 'redaction',
    receipts: [ 'personalCleanup', 'uniquenessRelease' ]
  }
  ```
  （参照ログはこの直後に `finalize:redaction` 継続イベントを受けてもう一度 `still waiting` を出しているのに対し、今回のログは `finalize:redaction` と `finalize:authResidue` の継続イベントが連続して届き、`still waiting` を経ずに `identity.user.deleted` へ進んでいた。イベント自体の到着順序の違いであり、参照ログ側にもエラー・`[scope-tasks]` 系ログは出現していない）
- 総評（事実のみ）: `[queue] received` の総数（12件）とイベント種別の一覧（6種、完全一致）は今回と参照ログで**同じ**だった。唯一の差分は `[deleteAccount] finalize is still waiting` の**出現回数**（今回1回 vs 参照2回、`attemptedBy: 'redaction'` の1回分が今回は出現しなかった）。エラー系ログ（`task threw` / `backoff failed` / `no handler for`）は今回・参照ともに一貫して0件だった。

## 未実行・観測できなかった手順

- 手順5の「10秒おきに `snapshot -i -c` を観察」: クリックから最初の `snapshot -i -c`（5秒以内）の時点で既に完了表示だったため、以降の画面上の10秒おき観測は実施していない（サーバーログ側は手順6で10秒待機して増分停止を別途確認済み）
