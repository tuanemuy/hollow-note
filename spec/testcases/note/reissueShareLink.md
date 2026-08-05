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
| ノートを別scopeへ移動済み | 移動前の共有リンクを開く | locator の NoteId から更新済み route を引き、移動先scopeの同じノートが表示される | |
| 有効なトークンの locator 部分だけを別の NoteId に改ざんした | 開く | route先の token hash と一致せず `NotFoundError("NOTE_NOT_FOUND")` が返る | |
| 有効なトークンの secret 部分を改ざんした | 開く | `NotFoundError("NOTE_NOT_FOUND")` が返り、他scopeを走査しない | |
