# PR Review #003 — [skeleton] アカウント作成から白紙ノート閲覧までを通す

**PR:** #12
**Date:** 2026-08-10
**Round:** 3回目

## Summary

- Blockers: 2
- Warnings: 18
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Domain: review-003-domain.md（B: 0 / W: 1）
- Use Case / Adapter: review-003-usecase-adapter.md（B: 0 / W: 2）
- Test: review-003-test.md（B: 0 / W: 5）
- Frontend: review-003-frontend.md（B: 1 / W: 7）
- Security: review-003-security.md（B: 1 / W: 3）

## ラウンド2修正の検証結果

ラウンド2の fix 30件は全レイヤーが個別に修正済みを確認。ただし **Frontend の修正が3件の退行を生んだ**（B-001 / R3-FE-W-001 / R3-FE-W-003）。

## 指摘一覧（ラウンド3 新規）

### Blockers
- [R3-FE-B-001] router.tsx:defaultErrorComponent — 4ルートの errorComponent 削除で SSR 経路が TanStack 組み込みの英語エラー画面に落ちる（AC-19 未充足・ラウンド2前より後退）
- [R3-SC-B-301] verify-email:自動POST — login CSRF（セッション注入）。攻撃者の確認リンクを踏ませるだけで被害者に攻撃者セッションが焼かれる

### Domain
- [R3-DM-W-001] valueObject.ts:Excerpt.fromText — 非正の max で slice が反転し検査を通らない値がキャストで返る（現行呼び出し元は実害なし）

### Use Case / Adapter
- [R3-UA-W-001] GlobalMaintenanceRunStore — リース失効した lane の回収経路がなく恒久 liveness 障害（D1 実装に複製される）
- [R3-UA-W-002] pruneExpiredAuthState:runCron — claim 済み lane を解放せず抜ける経路が2つ残存（try/finally なし・SWEEP_ORDER_HINT の二重正本）

### Test
- [R3-TS-W-001] conformance/unitOfWork.ts — 「中間状態が観測されない」を pin しておらず隔離性なしのバックエンドが通過する（順序 assert 移設の副作用）
- [R3-TS-W-002] TC-identity-232 がコメントのみでテスト名になく機械照合を素通り
- [R3-TS-W-003] ScopeCleanupAdmissionStore.pruneCompleted の 100件上限ケースが構造的に空振り
- [R3-TS-W-004] errorDisplay.ts:renderErrorMessage / extractSerializedError が無テスト
- [R3-TS-W-005] apps/web が vitest を devDependency 未宣言（root ホイスト依存）

### Frontend
- [R3-FE-W-001] empty:hidden が aria-live 領域を display:none にし常設化が a11y 上無効（6箇所）
- [R3-FE-W-002] THROTTLED 告知が条件付きマウントの role="status" で告知されず、秒読みで毎秒書き換え・disabled でフォーカス喪失
- [R3-FE-W-003] クライアントのメール正規表現がドメイン Email より厳しく、ドット無しアドレスが恒久 disabled でサインイン不能（退行）
- [R3-FE-W-004] VerifyEmailPanel が system エラーを「リンクが壊れている」に潰し原因を誤診断
- [R3-FE-W-005] サインアップ送信完了の画面差し替えに告知もフォーカス移動もない
- [R3-FE-W-006] 辞書の NOTE_ACCESS_DENIED が「権限がありません」を明示し P-46 の同一表示方針に反する
- [R3-FE-W-007] 辞書引きが Object.prototype を素通しし code="constructor" 等で関数が JSX に渡り得る

### Security
- [R3-SC-W-301] mail.sent ログが確認リンク（生トークン付き URL）を production でも info 出力
- [R3-SC-W-302] Node の clientKey がソケット IP のみで、プロキシ配下だと任意アカウントを 15 分ロックできる
- [R3-SC-W-303] safeRedirectPath が制御文字を弾かない（現状は到達不能だがガードの保証が破れている）
