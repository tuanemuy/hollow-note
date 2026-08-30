# テストケース: checkWorkspaceSlugAvailability

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| どのワークスペースも使っていないスラッグ | 利用可否を問い合わせる | `available: true` / `ownedBySelf: false` が返る | |
| 自分のワークスペースが使っているスラッグ | `workspaceId` を添えて利用可否を問い合わせる | `available: true` / `ownedBySelf: true` が返る | |
| 別のワークスペースが使っているスラッグ | `workspaceId` を添えて利用可否を問い合わせる | `available: false` / `ownedBySelf: false` が返る | |
| 別のワークスペースが使っているスラッグ | `workspaceId` なし（作成画面）で利用可否を問い合わせる | `available: false` / `ownedBySelf: false` が返る | |
| 自分のワークスペースが使っているスラッグを大文字を含む表記で指定する | `workspaceId` を添えて利用可否を問い合わせる | 入力を正規化してから判定し、`available: true` / `ownedBySelf: true` が返る | |
| 他の operation が予約しただけで確定していない（`reserved`）スラッグ | 利用可否を問い合わせる | 空きとして返る（助言的な読み取りで、勝者は `createWorkspace` / `changeWorkspaceSlug` の予約が決める） | |
| — | 形式が不正なスラッグで問い合わせる | `BusinessRuleError(InvalidSlug)` が投げられる | |
| — | 予約語のスラッグで問い合わせる | `BusinessRuleError(SlugReserved)` が投げられる | |
