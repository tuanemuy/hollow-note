# PR Review #001 — [skeleton] アカウント作成から白紙ノート閲覧までを通す

**PR:** #12
**Date:** 2026-08-10
**Round:** 1回目

## Summary

- Blockers: 1
- Warnings: 28
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Domain: review-001-domain.md（B: 0 / W: 3）
- Use Case / Adapter: review-001-usecase-adapter.md（B: 0 / W: 4）
- Test: review-001-test.md（B: 0 / W: 7）
- Frontend: review-001-frontend.md（B: 1 / W: 6）
- Security: review-001-security.md（B: 0 / W: 4）
- General Review: review-001-general.md（B: 0 / W: 4）

## カバレッジ

- 確認申告ゼロのファイル: 5レイヤー時点で172件（171削除+生存13件） → General Review で追跡し全量カバー。予期せぬ削除なし

## 指摘一覧

- [B-001] CreateNoteButton/AccountMenu/SignInForm:router.invalidate — ミューテーション後の invalidate 皆無 + 本番 staleTime Infinity で一覧が陳腐化（Frontend）
- [W-001] note.ts:createFromUpload/createBlank/moveTo — spec にない引数追加の spec-sync 未記録（Domain）
- [W-002] noteMovePort.ts:NoteMoveSnapshot — opaque 型の引き継ぎ明記不足（Domain）
- [W-003] noteAccessPolicy.ts:evaluate — トークンハッシュ比較が非定数時間（Domain）
- [W-004] signInWithPassword.ts — 最終 UoW で PasswordIdentity version 再検査欠落（UseCase-Adapter）
- [W-005] pruneExpiredAuthState.ts:runCron — 予算切れ時に claimed lane 未解放で run が完了しない（UseCase-Adapter）
- [W-006] runner.ts:consumer — UoW 外 markProcessed 単独確定のテンプレート残骸（UseCase-Adapter）
- [W-007] adapters/memory/{crypto系} — プロバイダー分割規約からの配置逸脱（UseCase-Adapter）
- [W-008] verifyEmail テスト — TC ID 欠落で機械追跡から漏れ（Test）
- [W-009] UoW 契約が ConformanceBackend 差し替え契約外（Test）
- [W-010] TC-identity-229 が stale get 未注入で TC-214 の再掲（Test）
- [W-011] TC-identity-171 の同時接続上限 未 assert（Test）
- [W-012] membership ページケースが skip でなく pass 報告（Test）
- [W-013] resolveMany 入力上限の適合ケース欠落（Test）
- [W-014] CLAUDE.md の test:integration 残骸・fast-check/docs 不整合（Test）
- [W-015] SignInForm:THROTTLED — 状態モデルが直和の外・60秒捏造・locked 復帰不能（Frontend）
- [W-016] NoteBody:Shadow DOM 昇格 effect が React 管理 DOM を直接削除（Frontend）
- [W-017] AccountMenu:role="menu" のキーボード契約なし（Frontend）
- [W-018] P-10 空状態のコマンドパレット案内欠落（Frontend）
- [W-019] VerifyEmailPanel 終端状態が aria-live 外（Frontend）
- [W-020] P-46 再試行が href=""（Frontend）
- [W-021] RSC ストリーミング断片のエラーが redaction boundary を通らない（Security）
- [W-022] ShareTokenKeyRing がリクエスト毎新造で鍵管理契約違反（Security）
- [W-023] 未登録メール時の scrypt スキップでタイミング列挙可能（Security）
- [W-024] scrypt verify の N/r/p 無上限受け入れ（Security）
- [W-025] identityUniqueDirectory.ts の生 NUL バイト埋め込み（General）
- [W-026] allRollbackReleased の receipt 集合解釈差（General）
- [W-027] eventRelayWorker.ts:103 の stale コメント（General）
- [W-028] IdentityRepository:PROVIDER_ACCOUNT_ALREADY_LINKED 未送出（General）
