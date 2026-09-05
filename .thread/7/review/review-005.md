# PR Review #005 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-01
**Round:** 5回目

## Summary

- Blockers: 3
- Warnings: 21
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-005-backend-note.md（B: 1 / W: 2）
- backend-storage: review-005-backend-storage.md（B: 1 / W: 2）
- backend-tag: review-005-backend-tag.md（B: 0 / W: 7）
- frontend: review-005-frontend.md（B: 1 / W: 10）

## カバレッジ

- 確認申告ゼロのファイル: なし（frontend / backend-storage / backend-tag はスキップ無し）

## 指摘一覧

### backend-note
- [B-001] adapters/html/css.ts:readLexeme/scanTo — url() の内側でコメントを字句として扱い position の除去をバイパスできる
- [W-001] application/note/deleteNotesForOwner.ts:purgeEachNote — 「行を狭めない」コメントが実際の削除と食い違う
- [W-002] spec/testcases/note/deleteNotesForOwner.md — 「検知時点で行へ書く」性質に TC 行と ID が無い

### backend-storage
- [B-001] domain/storage/services/uploadValidationPolicy.ts:MEDIA_SVG_MAX_BYTES — 128 KB の根拠（膨張は最大 6 倍）が偽。foster parenting で実測 86 倍
- [W-001] application/storage/storeMedia.ts — 容量判定がサニタイズ前のバイト長で行に載る値と食い違う
- [W-002] application/storage/collectOrphanMedia.ts — 最大 105 本・80 MB 超の本文解析が scope の UoW 内側で走る

### backend-tag
- [W-001] adapters/*/repositories/tagAssignmentRepository.ts:insert — scope key を _scope_identity の pin と突き合わせていない
- [W-002] spec/platform/index.md — 「ノート数 × 4〜6」の見積もりが batchSize 100 で 500 query 上限を超える
- [W-003] spec/database/index.md — keyset 述語の記述が行値比較と食い違う
- [W-004] application/*/delete*ForNote.ts — complete / 再武装の分岐が 3 コピーで spec の手順に complete が無い
- [W-005] application/cleanup/notePurgeFanOut.ts:scopeOfNoteOwner — NoteOwner→ScopeKey の写像が 7 箇所に複製
- [W-006] application/workers/subscribers.ts — 兄弟を止めない変更が合成レジストリでしか検証されていない
- [W-007] adapters/conformance/*.ts — limit <= 0 の契約を 0 しか突いていない

### frontend
- [B-001] components/note/NoteEditor/surfaces.tsx — WYSIWYG の面だけ shadow root の外にあり本文の style が編集画面全体に効く
- [W-001] components/note/NoteEditor/editor.tsx — skipped で拒まれた経路を基準に取り込み永久に保存できなくなる
- [W-002] components/note/NoteEditor/editor.tsx — ビジュアルの丸ごと送る保存が往復中の打鍵を捨てる
- [W-003] components/note/NoteEditor/editor.tsx — 新規作成の初回保存失敗でしていない退避を「した」と告げる
- [W-004] routes/notes/-action.tsx:createNoteWithBodyFn — 冪等でなく再試行が白紙ノートを増やす
- [W-005] components/note/NoteEditor/editor.tsx — WYSIWYG がシード時しか scrub されず createLink が javascript: を通す
- [W-006] components/note/NoteDetail/detail.tsx — タイトル・スタイル・削除の 3 往復に排他が無い
- [W-007] components/note/NoteEditor/preferences.ts — 退避本文が localStorage に無期限で残る
- [W-008] components/note/NoteEditor/editor.tsx — 権限喪失時のダウンロードが Blob URL を同期失効させる
- [W-009] components/note/NoteEditor/editor.tsx — サニタイズ通知の React key が一意でない
- [W-010] routes/notes/-action.tsx:readNoteEditStateFn — canEdit を誰も読まず載せ直した面が権限喪失後も書ける
