# エッジケース 4: 再設定リンク・確認リンクのオープンリダイレクト耐性

**結果**: PASS
**対応する受け入れ基準**: ADR-021（`AppConfig.appUrl` と同一オリジンのパスのみ許可）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | 正規の認可 URL の `redirect_uri` を外部オリジンに書き換えて開く（`/dev/oauth/authorize?client_id=dev-google&redirect_uri=https%3A%2F%2Fexample.com%2F&response_type=code&scope=openid+email+profile&state=…&code_challenge=…&code_challenge_method=S256`） | 外部オリジンの `redirect_uri` は受理されない | 同意画面自体は描画される（`redirect_uri` の検査は同意の送信時にサーバーが行う設計 — `DevConsentForm` の JSDoc「許可・キャンセルのどちらも遷移先はサーバーが決める」） | PASS |
| 2 | 同意画面で「許可する」を押す | エラー表示になり、外部オリジンへは遷移しない | 「続行できませんでした／遷移先が正しくありません。もう一度最初からお試しください。」を表示。`location.href` は `/dev/oauth/authorize?...` のままで `https://example.com/` へは遷移しない | PASS |

## 確認ポイント

- 遷移先の判定はサーバー側（`submitDevConsentFn`）が行い、クライアントは返された `location` にしか遷移しない。外部オリジンはサーバーで弾かれるため、同意画面の描画時点で 400 にしないことは設計どおり。
- 外部オリジンへのナビゲーションも `code` の発行も発生しなかった。

## 失敗詳細

なし。
