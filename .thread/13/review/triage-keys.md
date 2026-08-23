# 非 fix 判定の一覧 — Issue #13 / PR #36 / Round 001

`triage.md` のうち `wont-fix` / `defer` と判定した行だけを抜き出したもの。次ラウンドで同じ指摘が上がったら、この表を根拠に再指摘回数を上げる。

| Key | 元ID | 判定 | 理由（一行） | Issue |
| --- | --- | --- | --- | --- |
| `routes/notes/{index,$noteId}.tsx:17-19` / `/settings` 固有の但し書きの複製 | note-docs W-004 | wont-fix | ADR-003（`.thread/13/adr.md:165`）が「3 ルートすべてに『preload で抑止できるのは cached match だけ』まで書く」ことを明示的に要求した内容で、覆すべき新事実は無い | — |
| `.thread/13/` / 手動検証の実行証跡が無い | auth W-005 | wont-fix | Phase 4（動作検証）が担当。HAR・着地 URL・`head` 記録はそちらの成果物として残る | — |
| `CLAUDE.md` / Presentation の load-bearing files に `sessionGuard.ts` / `appConfig.ts` が未掲載 | note-docs W-008 | wont-fix | エージェントは `CLAUDE.md` を書き換えない方針。Phase 7 の昇格ゲートでユーザーへの提案に回す | — |
| `spec/presentation/index.md` / `AppConfig` 節が署名鍵の供給元として自己矛盾 | auth W-003 (2) | defer | 本 PR が作った矛盾ではなく（露出量は `loadAppContext` 時代と同じ）、解消には未実装の 4 種の鍵の供給元を決める ADR 047 跨ぎの設計判断が要る | #38 |
| `routes/__root.tsx:42` / `<link rel="canonical">` が重複出力（`/terms` で 2 本、`/settings/profile` で 3 本） | routing W-007 | defer | 本 PR の退行ではない既存不具合。直すと AC-5「`head` 出力が変更前と一致」という検証基準自体を無効化し、正しい修正は `buildHead` の canonical 方針とレイアウトルートの `head` の扱いを決める必要があるので `__root.tsx` 1 ファイルでは閉じない | #37 |

## 起票済み Issue

1. #37 — `<link rel="canonical">` が 1 ドキュメントに 2〜3 本出力される
2. #38 — `spec/presentation/index.md` の `AppConfig` 節が「署名鍵の供給元」と「SSR メタデータに秘密を混ぜない」で矛盾している
