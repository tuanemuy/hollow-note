# PR Review #009 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-05
**Round:** 9回目

## Summary

- Blockers: 1
- Warnings: 23
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-009-backend-note.md（B: 0 / W: 5）
- backend-storage: review-009-backend-storage.md（B: 0 / W: 5）
- backend-tag: review-009-backend-tag.md（B: 0 / W: 2）
- frontend: review-009-frontend.md（B: 1 / W: 9）
- general（カバレッジ補完・依存関係）: review-009-general.md（B: 0 / W: 2）

## カバレッジ

- 4担当の申告で確認申告ゼロだったのは `pnpm-lock.yaml` の1件のみ → `general` を1体追加起動して補完済み。追加後の確認申告ゼロのファイル: なし

## 指摘一覧

### backend-note
- [W-001] application/note/restoreNoteRevision.ts:ensureNotTrashed — 本文書き込み3経路のうち restoreNoteRevision だけ NoteLockedByJob の門が無い
- [W-002] spec/domains/note.md:374 — 「資源で有界」が4上限のままで ADR 013 の5上限と食い違う
- [W-003] spec/usecases/note.md:783 / spec/database/index.md:20 — trashNote 手順5が database 規則 (3) と矛盾し、安全な条件が canon に無い
- [W-004] adapters/html/allowList.ts:DROP_WITH_CONTENT — unwrap / 内容ごと除去の2段が ADR 013 に無い
- [W-005] adapters/html/__tests__/htmlProcessor.test.ts:838 ほか — レビュー経緯・修正前の挙動を語る記述が残る（記述の衛生）

### backend-storage
- [W-001] application/storage/storeMedia.ts:asStandaloneSvg — `&amp;lt;` を持つ整形式 SVG が再判定で UnsupportedMimeType に落ちる
- [W-002] application/storage/collectOrphanMedia.ts:readNoteBodies — 最悪 168 MB が同時常駐し Workers の 128 MB の内側にない
- [W-003] domain/storage/ports/storedFileRepository.ts:JSDoc — listByNote（ADP-storage-006）が実装も先送り宣言も無い（既存の問題）
- [W-004] spec/usecases/storage.md:428 — 「30日境界を跨いだ行は拾わない」が実装と逆
- [W-005] application/storage/__tests__/deleteFilesForNote.test.ts:TC-storage-060 — CLEANUP_OPERATION_MISMATCH を固定しておらず追随者間で検出力が不揃い

### backend-tag
- [W-001] spec/domains/index.md:継続要求表 — 「scope は payload に現れない」規則に usecases 3ファイルが追随していない
- [W-002] application/cleanup/notePurgeFanOut.ts:settleNotePurgeTurn — 継続 task の priority class がコード JSDoc にしかない

### frontend
- [B-001] components/note/NoteEditor/surfaces.tsx:scrubForSurface — URL スキーム判定が制御文字迂回を素通りさせ、3適用点で規則が食い違う
- [W-001] components/note/NoteDetail/detail.tsx:versionRef — 3島が OPTIMISTIC_LOCK_FAILURE 後に版を取り直さず再試行が永久に失敗する
- [W-002] components/note/NoteEditor/surfaces.tsx:analyzeMarkup — 「構文を補正しました」が直列化の差にも出る
- [W-003] routes/notes/-action.tsx:createNoteWithBodyFn — 初回保存でのタイトル先頭行派生（ED-01 / TC-02）が無い
- [W-004] components/note/NoteEditor/editor.tsx:commit — 保存成功後の reseedIfUnchanged の失敗が retry: save に落ちる
- [W-005] components/note/NoteEditor/editor.tsx:preference — visual 既定 × ビジュアル不可の逃げ先が wysiwyg 固定で無操作の警告が立つ
- [W-006] spec/pages/index.md:283 — P-10 / P-11 状態表に「削除直後（元に戻す）」が無い
- [W-007] components/note/NoteEditor/editor.tsx:classifySaveFailure — 島から持ち上げた純関数に docs/test.md が求めるテストが無い
- [W-008] presentation/__tests__/errorDisplay.test.ts:119 — 辞書網羅の検証が not.toBe で検出力なし
- [W-009] presentation/__tests__/adrReference.test.ts:SOURCE_ROOTS — .thread/ 引用の検査が spec/ / docs/ を対象にしていない

### general（依存関係）
- [W-001] adapters/cloudflare/__tests__/runtimeComposition.test.ts:htmlProcessor — parse5 が workerd で動く前提が import と構築までしか検証されていない
- [W-002] packages/core/package.json:parse5 — 実行時依存を core に足す判断が .thread/ の ADR にしかなく JSDoc・docs から辿れない
