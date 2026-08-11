# PR Review #001 — [account] アカウント管理と認証手段

**PR:** #17
**Date:** 2026-08-12
**Round:** 1回目

## Summary

- Blockers: 8
- Warnings: 48
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Domain / Use Case: review-001-domain-usecase.md（B: 2 / W: 7）
- Adapter / Infrastructure: review-001-adapter.md（B: 2 / W: 10）
- Frontend: review-001-frontend.md（B: 1 / W: 15）
- Security: review-001-security.md（B: 2 / W: 7）
- Test: review-001-test.md（B: 1 / W: 9）

## カバレッジ

- 確認申告ゼロのファイル: `.thread/2/steps.md` / `.thread/2/testing.md` / `.thread/2/progress.md` の 3 件のみ。いずれも本 Issue の作業記録で出荷物ではなく、steps.md はレビュー基準から意図的に外している（review-guide の「steps.md は必読にしない」）。testing.md は Phase 4 のブラウザ検証で実行そのものが検証になる。よって General Review の追加起動は行わない。コードファイルは 223 件すべて 1 体以上の確認申告あり。

## 指摘一覧

### Blockers

- [B-001] `application/identity/deleteAccount/globalCleanup.ts:64-99` / UoW・応答喪失 — receipt 書き込みと finalize 継続が別トランザクションで削除が恒久停止（Domain）
- [B-002] `domain/identity/valueObject.ts:AvatarUrl.create` / 不変条件 — `/\host/...` と C0 制御文字が同一オリジン検証を素通り（Domain）
- [B-003] `application/ports/outboxRepository.ts:save` / port-contract — 決定的 EventId が契約に無い memory 実装特性に依存（Adapter）
- [B-004] `application/workers/scopeTaskRunner.ts:100` / liveness — throw した scope task に backoff が掛からず 1 秒間隔で無限再実行（Adapter）
- [B-005] `routes/settings/-action.tsx:uploadAvatarFn` / CSRF — `FormData` server function の Origin 検証（Frontend）
- [B-006] `application/identity/startOAuthFlow.ts` + `routes/auth/-action.tsx` / auth-oauth — OAuth サインインの `state` がブラウザーに束縛されず login CSRF が成立（Security）
- [B-007] `application/di/serverNode.ts` + `scripts/listen.node.ts` + `.env.example` / dev-idp-guard — dev IdP の production ガードが `pnpm start` で発火しない（Security）
- [B-008] `application/identity/completeOAuthCallback.ts` / テスト欠落 — ADR-007 の intent 分岐にテストがゼロ（Test。Frontend の W-012 と同一）

### Warnings

Domain / Use Case
- [W-D01] `application/identity/updateProfile.ts:78,203` handle サガ — commit 後 activate 前の再実行が `keep` に潰れ旧 handle claim が恒久漏れ
- [W-D02] `application/ports/scopeTaskScheduler.ts:58` — `claimDue` が適合テスト専用で claim 直列化が実行経路に無い
- [W-D03] `application/identity/listIdentities.ts:26` — 「最後の 1 件は解除不可」をユースケースで再実装
- [W-D04] `application/identity/completeOAuthSignIn.ts:32` — `DisplayName` の上限 50 をユースケースに複写
- [W-D05] `deleteAccount/cleanupDispatch.ts:80-83` — JSDoc が保証する再駆動主体がこの配備に無い
- [W-D06] `deleteAccount/authorRedaction.ts:97` — 継続判定がフィルタ後件数で、未 ack を残して finalize へ渡しうる
- [W-D07] `application/storage/storeAvatar.ts:94-137` — 失敗時にメタデータ行を持たない孤児オブジェクトが残る

Adapter / Infrastructure
- [W-A01] `application/di/serverNode.ts:196` — `initNodeRuntime` の `??=` サイレント no-op と OAuth 既定値 dev
- [W-A02] `adapters/conformance/signInOAuthClient.ts:93` — Google exchange 3 本が live モードで即 return（緑だが無検証）
- [W-A03] `application/ports/scopeTaskScheduler.ts:58` — `claimDue` / `ScopeTask.payload` が適合スイート専用（W-D02 と同一 Key）
- [W-A04] `application/ports/objectStorage.ts:29` — checksum の "measured" 契約とスイートの凍結が矛盾
- [W-A05] `application/storage/storeAvatar.ts:94` — 孤児オブジェクト（W-D07 と同一 Key）
- [W-A06] `application/storage/deleteFilesByOwner.ts:92` — 初回コマンド stalled 時に `backoff` が no-op で再駆動主体が消える
- [W-A07] `adapters/oauth/googleSignInOAuthClient.ts:118` — token endpoint 呼び出しにタイムアウトが無い
- [W-A08] `application/di/types.ts:191` — `identity_removal_receipts` が `authStateSweeps` 未登録で 30 日保持が回収されない
- [W-A09] `apps/web/app/routes/storage.$.tsx:15` — purpose を問わず全オブジェクトを無認証配信
- [W-A10] `apps/web/app/worker/node/runner.ts:177` — 起動ドレインがトリガーの直列化を迂回

Frontend
- [W-F01] `components/auth/OAuthCallbackPanel:cancelled/failed` — キャンセル・失敗が signIn 前提の文言と導線に固定
- [W-F02] `components/layout/AccountMenu:Link` — 「設定」リンクでメニューが閉じない
- [W-F03] `routes/settings/ (index 不在)` — `/settings` 直接アクセスが行き止まり
- [W-F04] `routes/settings/route.tsx:SIGNED_OUT_PATH` — 未認証の `/settings/danger` で削除フォームが操作可能に見える
- [W-F05] `components/settings/ProfileForm/editor.tsx:保存状態表示` — 「保存しました」が張り付く
- [W-F06] `ChangePasswordForm / SignOutOthersPanel` — `router.invalidate()` が無く例外表にも無い
- [W-F07] `ProfileForm/editor.tsx:AVATAR_MAX_BYTES` — 5MB・MIME 許可リストの二重化
- [W-F08] `OAuthCallbackPanel:classify` — 文言が 3 箇所に散り `OAUTH_CODE_INVALID` の辞書が死んでいる
- [W-F09] `DeleteAccountPanel:crypto.randomUUID` — `try` の外で非セキュアコンテキストで無言の全画面エラー
- [W-F10] `ProfileFormSkeleton` — 実 DOM の下部アクションバーを写していない
- [W-F11] `IdentityList/board.tsx:formatDate` — `Intl.DateTimeFormat` に `timeZone` 指定が無い
- [W-F12] `completeOAuthCallback.ts:39,47` — 無意味な `as RequestContainer`
- [W-F13] `DeleteAccountPanel:DeletionProgress` — 到達しない `idle` が「削除しています」に落ちる型
- [W-F14] `DeleteAccountPanel:poll catch` — 恒久失効した ticket が捨てられず削除フォームに戻れない

Security
- [W-S01] `domain/identity/valueObject.ts:AvatarUrl` — 同一オリジン検査の回避（B-002 と同一 Key）
- [W-S02] `routes/storage.$.tsx` — 無認可配信と `public, immutable`（W-A09 と同一 Key）
- [W-S03] `application/storage/storeAvatar.ts` — MIME が申告値のまま（マジックナンバー未検証）
- [W-S04] `identity/{resendVerificationEmail,requestPasswordReset}.ts` — メール送信を await して所要時間がオラクルになる
- [W-S05] `deleteAccount/terminalPrune.ts` — 本番の駆動主体が無く PII 相当キーが無期限で残る
- [W-S06] `di/{memoryRuntime,serverNode}.ts` — ランタイム singleton の既定が dev で fail-open（W-A01 と同一 Key）
- [W-S07] `identity/addPasswordIdentity.ts` — 再認証を求めない（宣言済み縮退だが帰結の記録が不足）

Test
- [W-T01] `deleteAccount.admission.test.ts:76` / TC-identity-040 — 10,000 件の前提が再現されず O(1) 性が観測できない
- [W-T02] `authResidueCleanup.test.ts:184` / TC-identity-043 — 「User 世代を巻き戻さない」が未検証
- [W-T03] `authResidueCleanup.test.ts:160` / TC-identity-042 — 「finalize 条件を満たす」が未検証
- [W-T04] `deleteAccount.finalize.test.ts:103` / TC-identity-090 — 「再試行時刻を記録する」が未検証
- [W-T05] `deleteAccount.terminalPrune.test.ts:118` / TC-identity-107 — 105 と結合され前提が再現されていない
- [W-T06] `conformance/signInOAuthClient.ts:100` — live モードの 3 ケースが空テスト（W-A02 と同一 Key）
- [W-T07] `deleteFilesByOwner.test.ts:250` / TC-storage-042 — 「2 系列が並走」が完全に逐次
- [W-T08] `checkHandleAvailability.ts / getProfile.ts` — テストが無い
- [W-T09] `routes/dev/oauth/authorize.tsx:27` — 「OAUTH_DEV_MODE 偽で 404」にテストが無い
