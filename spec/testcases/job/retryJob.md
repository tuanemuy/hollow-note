# テストケース: retryJob

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 失敗したジョブで原因が解消済み | 再試行する | `queued` に戻り、実行系に送られる | |
| 実行中のジョブ | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる | |
| 成功したジョブ | 再試行する | `BusinessRuleError(JobNotRetryable)` が投げられる | |
| 試行回数が 3 回に達している | 再試行する | `BusinessRuleError(RetryLimitExceeded)` が投げられる | |
| 試行回数が 2 回 | 再試行する | 成功する（境界値） | |
| 対象ノートが削除済み | 再試行する | `ValidationError("TARGET_MISSING")` が投げられる | |
| 失敗理由が `integrationRequired` で未連携のまま | 再試行する | `BusinessRuleError(ReauthorizationRequired)` が投げられる | |
| 失敗理由が `integrationRequired` で連携済みになった | 再試行する | 成功する | |
| 対象への権限を失っている | 再試行する | `BusinessRuleError(AccessDenied)` が投げられる | |
| 他の利用者のジョブ | 再試行する | `NotFoundError("JOB_NOT_FOUND")` が投げられる | |
