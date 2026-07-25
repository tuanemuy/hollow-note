# テストケース: storeAvatar

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本人 | 自分のアイコンをアップロードする | 保管され、URL が返る | |
| ワークスペースの owner | ワークスペースのアイコンをアップロードする | 保管される | |
| ワークスペースの editor | ワークスペースのアイコンをアップロードする | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 他人の利用者 ID を指定する | アップロードする | `BusinessRuleError(InsufficientRole)` が投げられる | |
| — | 6 MB の画像をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| — | 5 MB の画像をアップロードする | 成功する（境界値） | |
| — | GIF をアップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられる | |
| 既にアイコンがある | 新しいアイコンをアップロードする | 古いアイコンが削除対象になる | |
