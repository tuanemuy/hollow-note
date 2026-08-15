# テストケース: checkHandleAvailability

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 誰も使っていないハンドル | 利用可否を問い合わせる | `available: true` / `ownedBySelf: false` が返る | |
| 自分が既に使っているハンドル | 利用可否を問い合わせる | `available: true` / `ownedBySelf: true` が返る | |
| 他人が使っているハンドル | 利用可否を問い合わせる | `available: false` / `ownedBySelf: false` が返る | |
| 他の要求が予約しただけで確定していないハンドル | 利用可否を問い合わせる | 空きとして返る（助言的な読み取りで、勝者は `updateProfile` の予約が決める） | |
| — | 形式が不正なハンドルで問い合わせる | `BusinessRuleError(InvalidHandle)` が投げられる | |
| — | 予約語のハンドルで問い合わせる | `BusinessRuleError(HandleReserved)` が投げられる | |
