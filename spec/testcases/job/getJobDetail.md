# テストケース: getJobDetail

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 子ジョブが 5 件ある親ジョブ | 開く | 親の情報と 5 件の子、内訳が返る | |
| 子 5 件のうち 3 件が `succeeded`、2 件が `failed` | 開く | `summary` が `{ total: 5, succeeded: 3, failed: 2, canceled: 0 }` になる | |
| 同じ親を `listJobs` でも引く | 両方の値を突き合わせる | `summary` は `listJobs` の `job.childSummary` と同じ値になる（同じ投影） | |
| 親が終端した後 | 開く | `summary` は子の行から数え直されるため、終端後も同じ内訳が残る | |
| 他の利用者のジョブ | 開く | `NotFoundError("JOB_NOT_FOUND")` が投げられる | |
| 存在しないジョブ ID | 開く | `NotFoundError("JOB_NOT_FOUND")` が投げられる | |
| 匿名ジョブ（`requestedBy: null`）の ID | 開く | どの `userId` とも一致しないため `NotFoundError("JOB_NOT_FOUND")` が投げられる | |
| 子を持たないジョブ | 開く | `children` が空配列になる | |
| 子が `limit` を超える | 開く | `limit` 件と総件数が返る | |
| 失敗した子がある | 開く | それぞれの失敗理由が返る | |
