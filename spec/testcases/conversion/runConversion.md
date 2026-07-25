# テストケース: runConversion

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| Markdown ファイルと待機中のジョブ | 実行する | HTML に変換され、ノートが `ready` になり、ジョブが `succeeded` になる | |
| 装飾のない HTML から変換された | 実行後に確認する | `styleMode: "default"` になる | |
| `style` 要素を含む HTML ファイル | 実行する | `styleMode: "preserve"` になる | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わる（冪等） | |
| ノートが削除済み | 実行する | `failed("targetMissing")` になる | |
| LLM が必要で未連携 | 実行する | ノートが `awaitingIntegration` になり、ジョブが `failed("integrationRequired")` になる | |
| LLM が必要で連携が失効 | 実行する | ノートが `failed(providerAuthFailed)`、ジョブが `failed("providerAuthFailed")` になる | |
| LLM 実行回数の上限に達している | 実行する | ノートが `failed(quotaExceeded)` になる | |
| モデルがレート制限を返す | 実行する | `failed("quotaExceeded")` になる | |
| 実行が時間切れになる | 実行する | `failed("timeout")` になる | |
| 破損したファイル | 実行する | `failed("corruptedFile")` になる | |
| 未対応形式 | 実行する | ノートが `failed(unsupportedFormat)` になる | |
| 変換結果に外部参照がある | 実行する | 参照取り込みジョブが登録される | |
| `payload.requestedVisibility` が `unlisted` | 実行する | 変換成功後に限定公開になり、共有リンクが発行される | |
| `payload.requestedVisibility` が `public` でハンドル未設定 | 実行する | 非公開のまま残り、ジョブは成功する | |
| 変換に失敗した | 結果を確認する | 公開ステータスは変更されない | |
| タイトルの由来が `auto` で変換が題名を返す | 実行する | タイトルが差し替わる | |
| タイトルの由来が `manual` | 実行する | タイトルは差し替わらない | |
| LLM を使う変換を実行した | 使用量を確認する | LLM 実行回数が 1 消費されている | |
| 実行前に判明した失敗（未連携） | 使用量を確認する | LLM 実行回数は消費されていない | |
