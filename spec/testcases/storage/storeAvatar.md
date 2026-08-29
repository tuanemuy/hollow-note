# テストケース: storeAvatar

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本人 | 自分のアイコンをアップロードする | 保管され、URL が返る | |
| ワークスペースの owner | ワークスペースのアイコンをアップロードする | 保管される | |
| ワークスペースの editor | ワークスペースのアイコンをアップロードする | `BusinessRuleError(InsufficientRole)` が投げられる | |
| ワークスペースの非メンバー | ワークスペースのアイコンをアップロードする | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 存在しないワークスペース | ワークスペースのアイコンをアップロードする | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| 他人の利用者 ID を指定する | アップロードする | `BusinessRuleError(InsufficientRole)` が投げられる | |
| — | 6 MB の画像をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| — | 5 MB の画像をアップロードする | 成功する（境界値） | |
| — | GIF をアップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられる | |
| 既にアイコンがある | 新しいアイコンをアップロードする | 古いアイコンが削除対象になる | |
| ワークスペースの owner が、解決のあと書き込みの前に editor へ降格される | ワークスペースのアイコンを差し替える | `BusinessRuleError(InsufficientRole)` が投げられ、`StoredFile` の行は増えない | |
| ワークスペースが削除を受理済み | ワークスペースのアイコンを差し替える | `ConflictError("WORKSPACE_DELETING")` が投げられる | |
