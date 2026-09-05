# PR Review #002 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-01
**Round:** 2回目

## Summary

- Blockers: 4
- Warnings: 31
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-002-backend-note.md（B: 2 / W: 7）
- backend-storage: review-002-backend-storage.md（B: 1 / W: 9）
- backend-tag: review-002-backend-tag.md（B: 0 / W: 5）
- frontend: review-002-frontend.md（B: 1 / W: 10）

## カバレッジ

- 確認申告ゼロのファイル: なし（`apps/web/app/routeTree.gen.ts` は frontend が生成物として typecheck で担保と申告）

## 指摘一覧

### backend-note
- [B-001] adapters/html/css.ts:viewportAnchoringProperty — var() 一段で position:fixed が素通りする
- [B-002] components/note/schema.ts:NOTE_HTML_TRANSPORT_MAX — 転送上限が spec の「2 MB 以内（サニタイズ前）」と矛盾
- [W-001] workers/subscribers.ts:note.purged — spec 手順 5 の 5 購読者中 3 件のみ登録、欠落の宣言が .thread/ にしかない
- [W-002] domain/note/services/noteAccessPolicy.ts:ensureCanDelete — production 未使用の死んだ API
- [W-003] application/note/purgeNote.ts:drive — 全例外で abortPurge し commit 後の応答喪失で route が active に戻る
- [W-004] application/note/listNoteRevisions.ts:excerpt — 版一覧のたびに最大 20×800 KB を process に通す
- [W-005] adapters/html/__tests__/htmlProcessor.test.ts:tc — 前ラウンドのレビュー ID が 9 箇所残存
- [W-006] application/note/emptyTrash.ts:scheduleBulkPurge — ジョブ 0 件でも purgedCount: N を返す
- [W-007] application/note/editing.ts:ensureExpectedVersion — ブランド付き OCC トークンを as number で剥がす

### backend-storage
- [B-001] application/storage/storeMedia.ts:sanitizeSvg — </svg> の後ろの任意マークアップが保管・配信され XML として開けない
- [W-001] application/storage/collectOrphanMedia.ts:isOrphan — 版が参照するメディアが孤児判定の対象外で版復元が壊れる
- [W-002] spec/testcases/storage/storeMedia.md — TC-storage-253 のテストが存在しない
- [W-003] application/storage/collectOrphanMedia.ts:armOrphanMediaSweepOnFirstMedia — failed に駐車した scope の再武装経路が無い
- [W-004] apps/web/app/routes/storage.$.tsx — media 公開化の帰結が spec に無い
- [W-005] apps/web/app/routes/storage.$.tsx:PUBLICLY_SERVED_PURPOSES — FilePurpose の増減に型が追随しない
- [W-006] application/storage/storeMedia.ts:resolveEditableNote — 引き直しが spec の「scope miss は 1 回だけ」より広い
- [W-007] application/storage/storeMedia.ts:asStandaloneSvg — 開始タグ抽出が属性値中の > で切れる
- [W-008] spec/inventory/usecase.md:105 — 「先頭バイトの署名」「listByNote」の取り残し 2 件
- [W-009] application/usage/ — applyStorageDelta 未実装で容量ゲートが実行時に作動しない（既存の問題）

### backend-tag
- [W-001] application/cleanup/notePurgeFanOut.ts:assertNotePurgeAdmission — personal barrier 専用だが spec の TC は workspace 削除由来も要求
- [W-002] spec/domains/integration.md — listByNote と BACKUP_RECORD_ALREADY_EXISTS が spec に無い
- [W-003] application/cleanup/notePurgeFanOut.ts:armNotePurgeContinuation — 削除由来でない purge まで priority 0 で積む
- [W-004] application/cleanup/notePurgeFanOut.ts:scopeOfNoteOwner — workspace 所有ノートの fan-out と payload 破損が未検証
- [W-005] adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:insert — 並行フェンスがドライバのメッセージ文字列依存（既存の問題）

### frontend
- [B-001] components/note/NoteEditor/editor.tsx:discard — 破棄が面を戻さず捨てた編集が次の自動保存で送られる
- [W-001] components/note/NoteEditor/surfaces.tsx — locked/blocked でも面が編集可能
- [W-002] components/note/NoteEditor/editor.tsx:preferenceAppliedRef — 既定モード復元が ED-04 の警告を素通り
- [W-003] components/note/NoteEditor/editor.tsx:visualAvailable — 打鍵ごとに本文全体を再パース
- [W-004] components/note/NoteEditor/surfaces.tsx:scrubForPreview — 「プレビューの内容で保存されます」が誤った断言
- [W-005] components/note/NoteEditor/editor.tsx:draftOffer — 保存成功後も提案が残り古い退避で上書きできる
- [W-006] components/note/NoteEditor/editor.tsx:commit — タイトル正規化時に確定値を生値で上書き
- [W-007] routes/workspaces/$workspaceId/settings/-action.tsx — 設定配下でゴミ箱の導線が消える
- [W-008] components/note/NoteEditor/editor.tsx:uploadAll — 複数ファイルドロップで挿入位置が壊れる
- [W-009] components/note/NoteEditor/skeleton.tsx — JSDoc と実装の食い違い、読み込み中に戻る導線が無い
- [W-010] components/note/NoteEditor/editor.tsx:removed — サニタイズ通知が消えず直近の保存結果を指さない
