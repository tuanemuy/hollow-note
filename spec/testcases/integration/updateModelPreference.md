# テストケース: updateModelPreference

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| OpenRouter が連携済み | 3 つの用途のモデルを保存する | 設定が更新される | |
| — | 空文字列のモデル ID を指定する | `BusinessRuleError(InvalidModelPreference)` が投げられる | |
| — | 201 文字のモデル ID を指定する | `BusinessRuleError(InvalidModelPreference)` が投げられる | |
| 未連携 | 保存する | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる | |
| 保存後 | 既存ノートを確認する | 内容は変わらない（再実行が必要） | |
| 保存後 | 新しい変換を実行する | 新しいモデルが使われる | |
| Drive の連携に対して呼ぶ | 保存する | `BusinessRuleError(ProviderMismatch)` が投げられる | |
