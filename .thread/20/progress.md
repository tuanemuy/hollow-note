# 残存課題 — Issue #20

## 配線テストの abandon 経路は「例外が出ないこと」を主張できない

- **内容:** `abandonOAuthFlowFn` の応答 `null` が `createServerFn` のクライアント側チェーンで `TypeError` になる（`next(null)` を受けて `userCtx.context` を読むため）。テスト harness 固有の制約で、コンパイラーが呼び出し側を書き換える本番経路には無い。
- **適用した回避策:** 一致・不一致・Cookie 不在の 3 ケースは例外に触れず、`take` の呼び出し有無・`Set-Cookie` の有無・`state` 行の残存だけで振る舞いを固定した。ストア障害のケースは例外を無視できない（畳んでいることが主張の中身なので）ため、`outcome.error` が harness 由来の `TypeError` であることと logger への記録の 2 点で書いた。判断の経緯は adr.md の ADR-010 / ADR-011 に記録。
- **影響範囲:** 配線テストのアサーション方法のみ。変更前の実装も `null` を返しており（旧テストはこの assertion を持っていなかった）、本 Issue で持ち込んだ制約ではない。
