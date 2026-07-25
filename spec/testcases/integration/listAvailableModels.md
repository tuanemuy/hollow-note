# テストケース: listAvailableModels

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| OpenRouter が連携済み | 一覧する | 用途別のモデル一覧と現在の設定が返り、`catalogAvailable: true` になる | |
| 一覧の取得が失敗する | 一覧する | 既定モデルのみが返り、`catalogAvailable: false` になる | |
| 画像に対応しないモデルがある | 一覧する | `vision` の選択肢には含まれない | |
| 音声に対応しないモデルがある | 一覧する | `transcription` の選択肢には含まれない | |
| 未連携 | 一覧する | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる | |
| 連携が失効している | 一覧する | `BusinessRuleError(ReauthorizationRequired)` が投げられる | |
| アクセストークンの期限が切れていてリフレッシュ可能 | 一覧する | トークンが更新されて成功する | |
