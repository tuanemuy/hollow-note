# 非 fix 判定の一覧 — Issue #13 / PR #36

`triage.md` のうち `wont-fix` / `defer` と判定した行だけを抜き出したもの。次ラウンドで同じ指摘が上がったら、この表を根拠に再指摘回数を上げる。

## Round 001

| Key | 元ID | 判定 | 理由（一行） | Issue |
| --- | --- | --- | --- | --- |
| `routes/notes/{index,$noteId}.tsx:17-19` / `/settings` 固有の但し書きの複製 | note-docs W-004 | wont-fix | ADR-003（`.thread/13/adr.md:165`）が「3 ルートすべてに『preload で抑止できるのは cached match だけ』まで書く」ことを明示的に要求した内容で、覆すべき新事実は無い | — |
| `.thread/13/` / 手動検証の実行証跡が無い | auth W-005 | wont-fix | Phase 4（動作検証）が担当。HAR・着地 URL・`head` 記録はそちらの成果物として残る | — |
| `CLAUDE.md` / Presentation の load-bearing files に `sessionGuard.ts` / `appConfig.ts` が未掲載 | note-docs W-008 | wont-fix | エージェントは `CLAUDE.md` を書き換えない方針。Phase 7 の昇格ゲートでユーザーへの提案に回す | — |
| `spec/presentation/index.md` / `AppConfig` 節が署名鍵の供給元として自己矛盾 | auth W-003 (2) | defer | 本 PR が作った矛盾ではなく（露出量は `loadAppContext` 時代と同じ）、解消には未実装の 4 種の鍵の供給元を決める ADR 047 跨ぎの設計判断が要る | #38 |
| `routes/__root.tsx:42` / `<link rel="canonical">` が重複出力（`/terms` で 2 本、`/settings/profile` で 3 本） | routing W-007 | defer | 本 PR の退行ではない既存不具合。直すと AC-5「`head` 出力が変更前と一致」という検証基準自体を無効化し、正しい修正は `buildHead` の canonical 方針とレイアウトルートの `head` の扱いを決める必要があるので `__root.tsx` 1 ファイルでは閉じない | #37 |

## Round 002

| Key | 元ID | 判定 | 理由（一行） | Issue |
| --- | --- | --- | --- | --- |
| `presentation/appConfig.ts:32-39` / `resolveAppConfig` が `undefined` を返しても痕跡が残らない | routing W-002 | wont-fix | 過度に防御的。契約は Round 001（routing W-003）で寛容側に決着済み、今日この `undefined` に到達する経路は無く（全要求が `storage.run` の内側）、配線が壊れれば `storage.$.tsx` / `settings/-action.tsx` の `getContainer()` が先に throw する。`undefined` が正常値になる将来の経路（prerender）ではこの warn は全ページぶんのノイズになり、素の `console` はロギングをポート背後に置く方針からも外れる | — |

**Round 002 で判定を覆さなかった既決事項**（新事実として持ち込まれたが、退けたもの）:

- `/notes` 系への `staleReloadMode: "blocking"`（routing B-001 の提案 (a)）— ADR-003 の既決事項であることに加え、**そもそも解決にならない**（blocking が await するのはガード 1 往復だけで、commit 時点の断片 promise は未解決のままなのでスケルトンは出る）。ADR-003 は据え置き

## Round 003

いずれも「Warning 全体」ではなく、**fix と判定した指摘に含まれていた提案のうち採らなかったもの**である（元指摘の主部は反映する）。

| Key | 元ID | 判定 | 理由（一行） | Issue |
| --- | --- | --- | --- | --- |
| `spec/adr/030` / 混在窓の記述に「変更前（`beforeLoad` 時代・`Deferred` 修正前）との差」を書く | routing W-003, auth W-001 (b) | wont-fix | `spec/` は現在形の canon で経緯・superseded judgement を持たない方針（CLAUDE.md）。加えて routing W-003 が「書けていない」とした表示名・アバターへの波及は Round 002 の fix で L.34 に既に入っており、指摘のこの部分は事実として外れている。混在窓の**現在の**記述は計画L で真にする | — |
| `routes/notes/index.tsx` / `<Deferred key={user.userId}>`（主体交代で再マウントしスケルトンへ落とす） | auth W-001 提案 (b) | wont-fix | 挙動変更。窓は Blocker ではなく canon で受容済みで、収束フェーズに AC-8（戻る操作でスケルトンを出さない）の観測点へ新しいリスクを持ち込む。`$noteId` 側は `renderNoteDetail` が `user` を返さないので同じ手が取れず、対策としても片肺 | — |
| `components/auth/SignInForm/index.tsx:141` / `router.invalidate()` に `router.clearCache()` を併用して既訪 match ごと捨てる | routing W-003 提案 | wont-fix | 同じく挙動変更で、ADR-003 が受容した「既訪 match は背景再取得」という設計を再サインイン経路だけ剥がす。Blocker が無い収束フェーズで採る性質のものではない | — |
| `routes/notes/$noteId.tsx` / `remountDeps: ({ params }) => params` を足す | routing W-001 提案 (a) | wont-fix | 今日 note→note の導線が存在しない（`to="/notes/$noteId"` は `NoteList` と `CreateNoteButton` の 2 箇所のみで、どちらも `/notes` 配下）ため観測できる挙動が 1 つも変わらない設定になる。Round 001 で死んだ `staleTime` を「次の読み手が生きた設定と誤読する」として落とした判断と衝突する。前提は `Deferred` の JSDoc に書く（計画O） | — |

## 起票済み Issue

1. #37 — `<link rel="canonical">` が 1 ドキュメントに 2〜3 本出力される
2. #38 — `spec/presentation/index.md` の `AppConfig` 節が「署名鍵の供給元」と「SSR メタデータに秘密を混ぜない」で矛盾している
