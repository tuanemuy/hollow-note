# 残存課題 — Issue #20

## 1. `spec/inventory/usecase.md` の説明文が一部旧記述のまま

- **内容:** UC-identity-006 / UC-identity-007 / UC-integration-001 / UC-integration-002 の説明文が「OAuth state を単回消費し」等のままで、消費が束縛一致を条件とするようになった旨を含んでいない。
- **理由:** steps.md のステップ11 が名指ししたのは UC-identity-005 / UC-identity-024 と新規 UC-identity-025 のみで、実装側が勝手にスコープを広げなかった。
- **影響範囲:** 台帳の説明文のみ。記述は偽ではない（単回消費は今も真）が、束縛が一致したときだけ消費するという新しい条件を書き落としている。正典本体（`spec/usecases/*.md` / `spec/domains/*.md`）は追随済み。

## 2. 配線テストの abandon 3 ケースは「例外が出ないこと」を主張していない

- **内容:** `abandonOAuthFlowFn` の応答 `null` が `createServerFn` のクライアント側チェーンで `TypeError` になる（`next(null)` を受けて `userCtx.context` を読むため）。テスト harness 固有の制約で、コンパイラーが呼び出し側を書き換える本番経路には無い。
- **適用した回避策:** abandon の 3 ケースは例外の有無を主張せず、`take` の非呼び出し・`Set-Cookie` の不在・`state` 行の残存で振る舞いを固定した。判断の経緯は adr.md の ADR-010 に記録。
- **影響範囲:** 配線テストのアサーション方法のみ。変更前の実装も `null` を返しており（旧テストはこの assertion を持っていなかった）、本 Issue で持ち込んだ制約ではない。
