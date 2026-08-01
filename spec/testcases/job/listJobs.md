# テストケース: listJobs

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 自分のジョブが 10 件ある | 一覧する | 10 件が新しい順で返る | |
| 他の利用者のジョブがある | 一覧する | それらは含まれない | |
| ワークスペースのノートに対する自分のジョブがある | 他のメンバーが一覧する | そのジョブは含まれない | |
| 匿名ジョブ（`requestedBy: null`）がある | 一覧する | どの `userId` とも一致しないため結果に現れず、`activeCount` にも数えられない | |
| 親ジョブと子ジョブがある、`parentsOnly: true` | 一覧する | 親ジョブだけが返る | |
| 親ジョブと子ジョブがある、`parentsOnly: false` | 一覧する | 親ジョブと子ジョブの両方が返る | |
| 状態で絞り込む | 一覧する | 該当状態のジョブだけが返る | |
| 種別で絞り込む | 一覧する | 該当種別のジョブだけが返る | |
| 未知の状態を指定する | 一覧する | `ValidationError("INVALID_FILTER")` が投げられる | |
| 未知の種別を指定する | 一覧する | `ValidationError("INVALID_FILTER")` が投げられる | |
| ジョブが 0 件 | 一覧する | 空配列と `count: 0` が返る | |
| 対象ノートが削除済みのジョブ | 一覧する | `targetLabel` が「削除済み」として返る | |
| 生成物の期限が切れたジョブ | 一覧する | `artifact.expired: true` が返る | |
| 失敗したジョブで再試行上限に達している | 一覧する | `retryable: false` が返る | |
| batch 親ジョブがある | 一覧する | `childSummary`（`total` / `succeeded` / `failed` / `canceled`）が子ジョブの行から数え直して返る。batch 親以外は `null` | |
| 終端した batch 親ジョブ（子 100 件中 98 件成功） | 一覧する | 終端後も `childSummary` が残り、「100 件中 98 件成功」を作れる（親の状態に依存せず子の現況から数え直すため）。`progress` は `running` 限定のため `null` になる | |
| 一覧に batch 親が複数含まれる | 一覧する | `summarizeChildrenOf` にまとめて渡して埋められる（親 1 件につき 1 クエリにしない） | |
| `failed` の `bulkExport` 親で子が全件終端・成功 1 件以上 | 一覧する | `retryable: true` が返る（`retryJob` で組み立てだけをやり直せる） | |
| `failed` の `bulkExport` 親で子に未終端が残る、または成功が 0 件 | 一覧する | `retryable: false` が返る | |
| `failed` の batch 親（`bulkExport` 以外） | 一覧する | `retryable: false` が返る（導線は `retryFailedChildren`） | |
| 実行中のジョブがある | 一覧する | `activeCount` が 1 以上になり、進捗が含まれる | |
| `limit` を 101 にする | 一覧する | `ValidationError("INVALID_PAGINATION")` が投げられる | |
| 公開ステータスを適用できなかった変換ジョブがある | 一覧する | その行の `notices` に `visibilityNotApplied` が入る | |
| 終端していないジョブがある | 一覧する | その行の `notices` は空配列になる |
