# テストケース: reissueShareLink

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 限定公開のノート | 再発行する | 新しい `shareUrl` が返る | |
| 再発行後 | 古いリンクを開く | `NotFoundError("NOTE_NOT_FOUND")` が返る | |
| パスワード設定済み | 再発行する | パスワードの設定は維持される | |
| 非公開のノート | 再発行する | `BusinessRuleError(NotUnlisted)` が投げられる | |
| 公開ノート | 再発行する | `BusinessRuleError(NotUnlisted)` が投げられる | |
| viewer である | 再発行する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 再発行を 2 回続ける | 2 回目の後に 1 回目のリンクを開く | 「見つかりません」が返る | |
