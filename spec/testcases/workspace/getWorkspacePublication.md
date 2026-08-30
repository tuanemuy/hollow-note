# テストケース: getWorkspacePublication

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 非公開・スラッグ未設定 | 公開設定を読む | `publication: "private"` / `slug: null` / `publicUrl: null` が返る | |
| 非公開・スラッグ設定済み | 公開設定を読む | `slug` は返るが `publicUrl: null` になる（私有のスラッグはどのページにも解決しない） | |
| 公開中 | 公開設定を読む | `publication: "published"` と、アプリ URL とスラッグから組み立てた `publicUrl` が返る | |
| 公開ノートが 3 件 | 公開設定を読む | `publicNoteCount: 3` が返る | |
| 公開ノートが 0 件 | 公開設定を読む | `publicNoteCount: 0` が返る（画面が空のページを案内できる） | |
| 非公開で公開ノートが 2 件 | 公開設定を読む | `publicNoteCount: 2` が返る（公開前の注意に使うため非公開でも数える） | |
| viewer のメンバー | 公開設定を読む | 射影は返り、`canPublish: false` になる | |
| 非メンバー | 公開設定を読む | `BusinessRuleError(InsufficientRole)` が投げられる | |
| ワークスペースが不在・削除済み | 公開設定を読む | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
