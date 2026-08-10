# PR Review #002 — [skeleton] アカウント作成から白紙ノート閲覧までを通す

**PR:** #12
**Date:** 2026-08-10
**Round:** 2回目

## Summary

- Blockers: 0
- Warnings: 32
- Verdict: **APPROVED**（Blocker ゼロ。完了判定は台帳の fix ゼロ）

## レイヤー別ファイル

- Domain: review-002-domain.md（B: 0 / W: 3）
- Use Case / Adapter: review-002-usecase-adapter.md（B: 0 / W: 6）
- Test: review-002-test.md（B: 0 / W: 8）
- Frontend: review-002-frontend.md（B: 0 / W: 11）
- Security: review-002-security.md（B: 0 / W: 4）

## ラウンド1修正の検証結果

全29指摘の修正が正しく入っていることを各レイヤーが個別に確認済み。特筆:

- **B-001**（Frontend）— router-core 1.171.15 の `load-matches.js:435` まで降りて検証。`invalidate()` は cachedMatches にも `invalid:true` を立て、`loaderShouldRunAsync` が staleTime を無視して loader を再実行するため、本番 `staleTime: Infinity` 下でも AC-18 が成立。サインアウトのフル遷移で前利用者 RSC ペイロードの残留経路も閉塞
- **W-003**（Domain）— `constantTimeHashEquals` は長さ早期脱出のみで内容依存の分岐なし、XOR 累積の全走査。実装として正しい
- **W-021〜024**（Security）— redaction boundary は同期 throw / 非 Error 値 / reject promise を捕捉、redirect/notFound は素通し。keyring は runtime 寿命で版→鍵写像が成立。ダミー verify は全4分岐が gate 後に1回。scrypt ガードは正規ハッシュを誤検知しない

## 指摘一覧（ラウンド2 新規）

### Domain
- [R2-DM-W-001] note/valueObject.ts:Excerpt.fromText/NoteHeading.create — 切り詰めがサロゲートペアを割る
- [R2-DM-W-002] note/note.ts — spec 明文の分岐4点が domain 単体テスト未カバー
- [R2-DM-W-003] note/valueObject.ts:utf8ByteLength — バイト長検査が毎回全体を符号化（軽微）

### Use Case / Adapter
- [R2-UA-W-001] signInWithPassword.ts:51-57 — ダミーハッシュの rejected promise がプロセス寿命で固定化し列挙オラクル化
- [R2-UA-W-002] conformance/unitOfWork.ts:136 — memory 固有の mutex 直列化順序を契約化し D1/DO が通せない
- [R2-UA-W-003] IdempotencyStore 契約と WorkerContainer の JSDoc が矛盾
- [R2-UA-W-004] OUTBOX_* チューニング env が Node runner に未配線なのに .env.example / docs に掲載
- [R2-UA-W-005] matchedIdentity の null ガードが型として空振り
- [R2-UA-W-006] 削除済み構成を指す契約 JSDoc 2 箇所

### Test
- [R2-TS-W-001] 共有 UoW スイートが厳密な直列化順序を assert（R2-UA-W-002 と同件）
- [R2-TS-W-002] resolveMany 上限超過の契約が2ポートで食い違い、ポート JSDoc に不記載
- [R2-TS-W-003] 100件ページ上限の切り詰めが manifest store 系で未検証
- [R2-TS-W-004] apps/web にテスト0件（httpStatusFor / redactForClient / safeRedirectPath は純関数）
- [R2-TS-W-005] getNote.test.ts:162,174 が実時刻参照（TestClock 規律違反）
- [R2-TS-W-006] タイミング均等化テストが片側のみ assert（R2-UA-W-001 と関連）
- [R2-TS-W-007] adapters/memory/store.ts:251 に生 NUL 残存（406行が binary 扱い）
- [R2-TS-W-008] README.md:113-117 に削除済みコマンド、vitest.config.ts に死んだ exclude

### Frontend
- [R2-FE-W-001] P-02 でドメインの英語原文 message が画面に出る（design §9/§10 違反）
- [R2-FE-W-002] 成功後の遷移まで try に含め、遷移失敗が操作失敗として表示（二重作成誘発）
- [R2-FE-W-003] verify-email だけ router.invalidate() 欠落（B-001 の4箇所目）
- [R2-FE-W-004] 4ルートが P-46 共通表示を使わず素の div errorComponent
- [R2-FE-W-005] 秒読みが role="alert"（assertive）内で毎秒書き換え
- [R2-FE-W-006] 条件付きマウントの aria-live 3箇所・aria-describedby 未接続・skeleton の main role=status
- [R2-FE-W-007] LOCKED アラートが解除時刻経過後も残る
- [R2-FE-W-008] ナビゲーションごとに RPC 3往復直列
- [R2-FE-W-009] 到達しない表面（PublicShell.signedIn / fieldHintClass / pagination.ts）
- [R2-FE-W-010] docs/frontend_implementation_example.md が一括置換で自己矛盾
- [R2-FE-W-011] :focus-visible の outline:none が forced-colors で消える（tokens.md 由来）

### Security
- [R2-SC-W-201] サインアップに同型のタイミング列挙が残存（スロットルなしで測定容易）
- [R2-SC-W-202] ダミーハッシュ reject のキャッシュで未登録メールが恒久 500（R2-UA-W-001 と同件）
- [R2-SC-W-203] 認証済み応答に Cache-Control なし
- [R2-SC-W-204] サインアップ応答同一化に競合窓（reserved 10分間の 409 でメール露出）
