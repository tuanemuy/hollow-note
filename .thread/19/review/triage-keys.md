# 既出判定（薄いビュー）

`wont-fix` / `defer` 済みの指摘。同じ Key の指摘は蒸し返さないこと。

| Key | 判定 | Issue |
| --- | --- | --- |
| `conformance/scopeTaskScheduler.ts / running 行への backoffOrSchedule が未拘束` | wont-fix（事実誤認。`:400-426` 後半が既に拘束している） | — |
| `memory/repositories/scopeTaskScheduler.ts / Date インスタンスの防御コピー` | wont-fix（読む本番経路が無く、memory アダプター全体で一貫した方針） | — |
