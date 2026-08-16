# テストケース: checkHandleAvailability

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 誰も使っていないハンドル | 利用可否を問い合わせる | `available: true` / `ownedBySelf: false` が返る | |
| 自分が既に使っているハンドル | 利用可否を問い合わせる | `available: true` / `ownedBySelf: true` が返る | |
| 他人が使っているハンドル | 利用可否を問い合わせる | `available: false` / `ownedBySelf: false` が返る | |
| 自分が既に使っているハンドルを大文字小文字・前後の空白の違う表記で指定する | 利用可否を問い合わせる | 入力を正規化してから判定し、`available: true` / `ownedBySelf: true` が返る | |
| 他の要求が予約しただけで確定していない（`reserved`）ハンドル | 利用可否を問い合わせる | 空きとして返る（助言的な読み取りで、勝者は `updateProfile` の予約が決める） | |
| 解除待ち（`releasing`）の claim が残っているハンドル | 利用可否を問い合わせる | 空きとして返る（`resolve` は恒久 claim の持ち主だけを返す。保存は `updateProfile` の予約が拒みうる） | |
| — | 形式が不正なハンドルで問い合わせる | `BusinessRuleError(InvalidHandle)` が投げられる | |
| — | 予約語のハンドルで問い合わせる | `BusinessRuleError(HandleReserved)` が投げられる | |
