# テストケース: getUsageSnapshot

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 個人の消費が 1 GB、上限 5 GB | 引く | 消費・上限・件数と `level: "none"` が返る | |
| 消費が上限の 80 % | 引く | `level: "warning"` が返る（境界値） | |
| 消費が上限の 79 % | 引く | `level: "none"` が返る | |
| 消費が上限を超えている | 引く | `level: "exceeded"` が返る | |
| owner のワークスペースが 2 件ある | 引く | それぞれの使用量が返る | |
| editor として参加しているワークスペースがある | 引く | 含まれる（対象は `owner` と `editor`） | |
| owner のワークスペースと editor のワークスペースが 1 件ずつある | 引く | `workspaces` に 2 件とも返る | |
| editor として参加するワークスペースが 45 件ある | 先頭ページを引く | workspace RPC は20件以下、同時実行は6以下で、`nextWorkspaceCursor` が返る | |
| 先頭ページのうち1 scopeが一時的に応答しない | 引く | その要素だけ `{ state: "unavailable" }`、他は `{ state: "available" }` で返り、要求全体は成功する | |
| `nextWorkspaceCursor` を指定する | 次ページを引く | 前ページと重複せず最大20件を返す | |
| viewer としてのみ参加しているワークスペース | 引く | 含まれない | |
| どのワークスペースにも参加していない | 引く | `workspaces` は空になる | |
| 個人のクォータのレコードがまだない | 引く | `StorageQuota.initialize` の値が返り、レコードは作られない | |
| 当月の LLM 実行回数が 100 回 | 引く | `consumedCalls: 100` と当月の期間が返る | |
| LLM を一度も使っておらず当月の記録がない | 引く | `LlmUsage.initialize` の値（`consumedCalls: 0`）が返り、レコードは作られない | |
| ゴミ箱にノートがある | 引く | 使用量に数えられている | |
| `workspaceLimit: 21` | 引く | `ValidationError("INVALID_PAGINATION")` が投げられる（20 にクランプしない） | |
| ページの後段で行が削られる（viewer のみ / directory が deleted） | 次ページを引く | 削られた行を読み直さず、ページ全体の末尾の次から返る（表示が 0 件のページでも `nextWorkspaceCursor` は進む） | |
| 当月の LLM 実行回数が上限の 80 % | 引く | LLM 側に `level: "warning"` と消費・上限・期間が返る（境界値） | |
| ワークスペースの消費が上限の 80 % / 上限超過 | 引く | ワークスペースの行も `QuotaEnforcement.describe` の導出をそのまま返し、`level` が `warning` / `exceeded` になる（境界値） | |
