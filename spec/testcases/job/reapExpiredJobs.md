# テストケース: reapExpiredJobs

リース期間は実行体を持つジョブ（単体ジョブと batch の子。kind を問わず一律）が **15 分**、batch 親の進捗リースと組み立てリースが **60 分**。リーパーの実行間隔は **5 分**で、最短のリース期間（15 分）より短く保つ。

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| リース失効（`leaseExpiresAt <= now`）の `running` が 3 件 | 実行する | 3 件が `failed("timeout")` になり、`expiredCount: 3` と `job.failed` × 3 が返る | |
| リースが失効した `running` を回収した | 回収されたジョブを再試行する | `attempts` が 0 に戻っているため手動 `retry` できる | |
| 回収したジョブが `kind: "conversion"` で対象ノートが `processing` のまま | 実行する | 「共通: 強制終端の後始末」を `cause: { type: "expired" }` として同一 UoW で実行し、`Note.markConversionFailed("timeout")` で本文が `failed(timeout)` になる（`processing` のまま固定されて移動も作り直しもできなくなるのを防ぐ） | |
| 回収したジョブが `kind: "regeneration"`、または対象ノートが既に `ready` / `failed` | 実行する | 本文は書き換えられない（再生成は失敗しても `ready` を保つ設計。`processing` 以外は回復の対象外） | |
| 回収したのが `bulkExport` の batch 親で、成功済みの子が artifact を持つ | 実行する | 生成物の回収は**行わない**。`failed` の親は `reopenBatch` で開き直せるため、成功済みの子の artifact は組み立ての資材として残す（回収するのは `canceled` を作る強制終端の経路だけ） | |
| 同じ行を 2 回処理する | 2 回実行する | 本文の回復は `content.status === "processing"` のときだけ書き換えるため、2 回目は `failed(timeout)` のまま変わらない（冪等） | |
| リースが有効な `running` がある | 実行する | 触れられない（`listExpiredRunning` に含まれない） | |
| 単体ジョブ（または batch の子）が最後の `Job.start` / `reportProgress` から 15 分経過した | 実行する | リース失効として `failed("timeout")` に回収される（境界値） | |
| 同じジョブが最後の延長から 14 分しか経っていない | 実行する | リース有効のため対象外（境界値） | |
| batch 親が最後の子の終了報告から 60 分経過した | 実行する | 進捗リースの失効として `failed("timeout")` に回収される（境界値） | |
| batch 親が最後の子の終了報告から 59 分しか経っていない | 実行する | リース有効のため対象外（境界値） | |
| 組み立て中の `bulkExport` 親（`attempts >= 1`）で、組み立てワーカーが停止した後も遅れて届く・重複配送される子の終了報告で `reportProgress` が呼ばれ続ける | 60 分経過後に実行する | 組み立て中の親のリースは `reportProgress` では延びないため必ず失効し、`failed("timeout")` に回収される（`running` のまま永久に残らない） | |
| 子の投入が中断され、`total` に届かないまま子の終了が止まった batch 親 | 60 分経過後に実行する | 親のリースが延長されないため `failed("timeout")` として回収される（親が「処理中」のまま残らない） | |
| リースが失効した | 5 分間隔で動くリーパーを待つ | 失効から回収までの遅れは 1 周期（5 分）に収まり、滞留の総時間がリース期間の 2 倍を超えない | |
| `queued` のジョブがある | 実行する | 対象外で変化しない | |
| 終端状態（`succeeded` / `failed` / `canceled`）のジョブがある | 実行する | 対象外で変化しない | |
| 対象が 0 件 | 実行する | `expiredCount: 0` が返る | |
| 回収直後にもう一度実行する | 2 回実行する | 2 回目は対象が残っていないため 0 件で終わる（冪等） | |
| 引き継ぎ再開（`Job.start`。batch 親の組み立ては `Job.beginAssembly`）と競合する | 実行する | 楽観ロックでどちらか一方だけが成立し、版が競合した行はスキップして継続する | |
| 1 件の保存が失敗する | 実行する | 失敗を記録して次の行へ進む（部分失敗の許容） | |
| リース有効な `running` に `Job.expire` を適用する | 直接呼ぶ | `BusinessRuleError(LeaseActive)` で拒否される | |
| 引き継ぎ再開（`Job.start`）で `attempts` が上限を超えた | 適用の順序を確認する | リースを張り直さず、受け取ったジョブ（リース失効のまま）に `Job.expire` を適用する。先に `leaseUntil` へ張り直してから `expire` を当てるとリース有効とみなされて `LeaseActive` で拒否され、上限超過の回収経路が成立しない | |
| `Job.beginAssembly` で `attempts` が上限を超えた | 適用の順序を確認する | `start` と同じ順序に従い、リースを張り直さず受け取った親（リース失効のまま）に `expire` を適用する（上限に達するのは `attempts >= 2` の親だけで、直前の `LeaseActive` 判定を抜けている以上リースは必ず失効している） | |
| 列挙時に DB が落ちている | 実行する | `SystemError(DatabaseError)` が投げられる | |
