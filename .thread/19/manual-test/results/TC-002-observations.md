# TC-002 観測ログ: 2 アカウントの削除を並行して受理しても両方完走する

**セッション:** verify-tc-002a / verify-tc-002b
**実行日:** 2026-08-24

## 実行ログ

| # | セッション | 操作 | 期待結果 | 実際に観測した内容（原文） |
|---|---|------|---------|--------------------------|
| 1 | a | `/signin` → 「Google で続ける」→ 開発用IDプロバイダーで `del-b@example.com` / `削除次郎` / email_verified ON → 「許可する」 | サインインしノート一覧へ | 遷移先見出し「個人」「最初のノートを作る」。ボタン「白紙から書く」表示 |
| 1 | a | 「白紙から書く」→ `/notes` に戻る を3回繰り返し | ノート3件作成 | `/notes` の一覧に `link "無題 非公開。 更新 8月24日 03:22 8月24日"` が3件表示 |
| 2 | b | `/signin` → 「Google で続ける」→ 開発用IDプロバイダーで `del-c@example.com` / `削除三郎` / email_verified ON → 「許可する」 | サインインしノート一覧へ | 遷移先見出し「個人」「最初のノートを作る」。ボタン「白紙から書く」表示 |
| 2 | b | 「白紙から書く」→ `/notes` に戻る を3回繰り返し | ノート3件作成 | `/notes` の一覧に `link "無題 非公開。 更新 8月24日 03:23 8月24日"` が3件表示 |
| 3 | - | サーバーログの行数記録（Bash `wc -l`） | - | `128` 行（この時点までのログ行数） |
| 4 | a | `/settings/danger` を開き `del-b@example.com` を確認欄に入力し「アカウントを削除する」をクリック | 削除処理開始 | クリック実行（詳細はタイミング節参照） |
| 5 | b | 事前に `/settings/danger` を開き `del-c@example.com` を確認欄に入力済み。手順4の直後にクリック | 削除処理開始 | クリック実行（詳細はタイミング節参照） |
| 6 | a/b | クリック直後に両セッションの `snapshot -i -c` を取得 | 進捗表示 or 完了表示 | 両方とも `heading "アカウントを削除しました" [level=2]` と `button "トップページへ"` を即時に表示していた（「進行中」表示は捕捉できず） |
| 7 | - | サーバーログの増分行を確認 | 2つの削除処理の行が交互に出る | 128行→256行に増加。`operationId`/`aggregateId` 2種類が交互に出現（下記参照） |

## 削除の実行タイミング

- セッション a のクリック実行区間: 1787509408.657297 〜 1787509408.691437（Unix秒、`date +%s.%N` で前後計測）
- セッション b のクリック実行区間: 1787509408.738906 〜 1787509408.776048
- 間隔: a のクリック完了（408.691437）から b のクリック開始（408.738906）まで **約 0.047 秒**。同一秒内で連続実行できた。

## 進捗表示の推移（手順 6）

| 経過秒 | セッション a の文言（原文） | セッション b の文言（原文） |
|---|---|---|
| 約 7〜8 秒後（クリック直後の最初の snapshot 取得時） | `heading "アカウントを削除しました" [level=2]` / `button "トップページへ"` | `heading "アカウントを削除しました" [level=2]` / `button "トップページへ"` |

- a の完了までの所要時間: クリックから最初の観測（約7〜8秒後）の時点で既に完了表示。それより前の中間状態（「進行中」等）は観測できなかった。
- b の完了までの所要時間: 同上（クリックから約7〜8秒後の最初の観測時点で既に完了表示）。

**注記:** 10秒おきに交互観測する計画だったが、最初の snapshot 取得（クリックから数秒後）の時点で両セッションとも既に完了表示に到達していたため、それ以降の追加観測（10秒刻み）は行っていない。両方とも「途中で片方だけ止まる」状態は一度も観測されなかった。

## サーバーログの観測

- 2つの削除が重なった証拠（`operationId` / `aggregateId` が2種類、処理行が交互）:
  ```
  [queue] received identity.accountDeletionManifestBuildContinued identity.accountDeletionManifestBuildContinued:01a02fdd-0432-77dd-8dae-7832231ead2b:memberships:- {
    eventId: 'identity.accountDeletionManifestBuildContinued:01a02fdd-0432-77dd-8dae-7832231ead2b:memberships:-',
    eventType: 'identity.accountDeletionManifestBuildContinued',
    aggregateId: '01a02fdd-0432-77dd-8dae-7832231ead2b'
  }
  [queue] received identity.accountDeletionManifestBuildContinued identity.accountDeletionManifestBuildContinued:01a02fdd-0433-7248-ba1a-b60123bf8f55:memberships:- {
    eventId: 'identity.accountDeletionManifestBuildContinued:01a02fdd-0433-7248-ba1a-b60123bf8f55:memberships:-',
    eventType: 'identity.accountDeletionManifestBuildContinued',
    aggregateId: '01a02fdd-0433-7248-ba1a-b60123bf8f55'
  }
  [queue] received identity.accountDeletionManifestBuildContinued identity.accountDeletionManifestBuildContinued:01a02fdd-0432-77dd-8dae-7832231ead2b:authorRoutes:- {
    aggregateId: '01a02fdd-0432-77dd-8dae-7832231ead2b'
  }
  [queue] received identity.accountDeletionManifestBuildContinued identity.accountDeletionManifestBuildContinued:01a02fdd-0433-7248-ba1a-b60123bf8f55:authorRoutes:- {
    aggregateId: '01a02fdd-0433-7248-ba1a-b60123bf8f55'
  }
  [queue] received identity.accountDeletionDispatchContinued identity.accountDeletionDispatchContinued:01a02fdd-0432-77dd-8dae-7832231ead2b:cleanup:- {
    aggregateId: '01a02fdd-0432-77dd-8dae-7832231ead2b'
  }
  [queue] received identity.accountDeletionDispatchContinued identity.accountDeletionDispatchContinued:01a02fdd-0433-7248-ba1a-b60123bf8f55:cleanup:- {
    aggregateId: '01a02fdd-0433-7248-ba1a-b60123bf8f55'
  }
  ...
  [deleteAccount] finalize is still waiting {
    operationId: '01a02fdd-0432-77dd-8dae-7832231ead2b',
    attemptedBy: 'uniquenessRelease',
    receipts: [ 'personalCleanup', 'uniquenessRelease' ]
  }
  ...
  [deleteAccount] finalize is still waiting {
    operationId: '01a02fdd-0433-7248-ba1a-b60123bf8f55',
    attemptedBy: 'uniquenessRelease',
    receipts: [ 'personalCleanup', 'uniquenessRelease' ]
  }
  ...
  [queue] received identity.user.deleted 01a02fdd-0446-7798-927e-032a97731a8c {
    eventId: '01a02fdd-0446-7798-927e-032a97731a8c',
    eventType: 'identity.user.deleted',
    aggregateId: '01a02fdc-301c-779a-a6d1-4625d37f557a'
  }
  [subscribers] no subscriber for identity.user.deleted {
    eventId: '01a02fdd-0446-7798-927e-032a97731a8c',
    eventType: 'identity.user.deleted'
  }
  [queue] received identity.user.deleted 01a02fdd-0446-7798-927e-064c0fb7d791 {
    eventId: '01a02fdd-0446-7798-927e-064c0fb7d791',
    eventType: 'identity.user.deleted',
    aggregateId: '01a02fdc-9cba-7619-8607-153d0a96cc66'
  }
  [subscribers] no subscriber for identity.user.deleted {
    eventId: '01a02fdd-0446-7798-927e-064c0fb7d791',
    eventType: 'identity.user.deleted'
  }
  [queue] received identity.accountDeletionManifestCompactContinued identity.accountDeletionManifestCompactContinued:01a02fdd-0432-77dd-8dae-7832231ead2b:compact:- {
    aggregateId: '01a02fdd-0432-77dd-8dae-7832231ead2b'
  }
  [queue] received identity.accountDeletionManifestCompactContinued identity.accountDeletionManifestCompactContinued:01a02fdd-0433-7248-ba1a-b60123bf8f55:compact:- {
    aggregateId: '01a02fdd-0433-7248-ba1a-b60123bf8f55'
  }
  ```
  operationId `01a02fdd-0432-77dd-8dae-7832231ead2b`（セッション a / del-b の削除）と `01a02fdd-0433-7248-ba1a-b60123bf8f55`（セッション b / del-c の削除）の2種類の処理行が、ログ全体を通してほぼ完全に交互（1行または数行おき）に出現していた。両方とも `[deleteAccount] finalize is still waiting` を経て、それぞれ別の `identity.user.deleted` イベント（`aggregateId: '01a02fdc-301c-779a-a6d1-4625d37f557a'` と `aggregateId: '01a02fdc-9cba-7619-8607-153d0a96cc66'`）に到達していた。
- `[scope-tasks] task threw` / `backoff failed` / `no handler for`: **出ない**（手順3以降に増えた128行のログ全文を `grep` したが該当なし）

## 未実行・観測できなかった手順

- 手順6の「10秒おきに交互に snapshot を取り、両方の文言を記録する」を計画通りの複数時点では実施していない。クリックから最初の snapshot 取得（約7〜8秒後）の時点で両セッションとも既に完了表示（「アカウントを削除しました」）に到達しており、それ以前の「進行中」を示す中間状態のスナップショットは取得できなかった（＝処理が速すぎて中間状態を捉えられなかった）。
- それ以外の手順（1〜5、7）はすべて実行済み。
