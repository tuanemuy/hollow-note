# PR Review #004 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-01
**Round:** 4回目

## Summary

- Blockers: 4
- Warnings: 21
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-004-backend-note.md（B: 2 / W: 5）
- backend-storage: review-004-backend-storage.md（B: 1 / W: 3）
- backend-tag: review-004-backend-tag.md（B: 0 / W: 5）
- frontend: review-004-frontend.md（B: 1 / W: 8）

## カバレッジ

- 確認申告ゼロのファイル: なし（frontend が apps/web 全 38 ファイルを全量確認、backend-tag / backend-storage もスキップ無し）

## 指摘一覧

### backend-note
- [B-001] adapters/html/css.ts:scanTo/findBlockEnd — 走査がエスケープ非対応で position の除去をバイパスできる（3 ラウンド連続の再発）
- [B-002] application/note/deleteNotesForOwner.ts:settle — 止まった purge の ID が settle の transaction にしか残らず、その失敗で消し残したまま ack する
- [W-001] application/note/purgeNote.ts:deleteLocally — assertOwner が reclaim より先で resume 経路の route を abort しうる
- [W-002] spec/usecases/note.md:deleteNotesForOwner 手順 4 — 実装が守れない要求が spec に残る
- [W-003] application/note/purgeExpiredTrash.ts — 持ち回りが無く止まった purge の残余が spec に未記録
- [W-004] spec/testcases/note/purgeNote.md — FK CASCADE が実装と食い違う（既存の問題）
- [W-005] spec/adr/013 — メディア挿入が ED-07 と書かれているが ED-06（既存の問題）

### backend-storage
- [B-001] application/storage/storeMedia.ts:findSvgRoot — ルート外の形しか見ておらず XML として壊れた markup が保管される
- [W-001] domain/storage/services/uploadValidationPolicy.ts:MEDIA_SVG_MAX_BYTES — 膨張率とスタック消費を構造で有界にしていない
- [W-002] adapters/cloudflare/do/repositories/storedFileRepository.ts — キーセットの OR 形が索引シークにならず費用が二乗に効く
- [W-003] spec/testcases/storage/deleteFilesForNote.md — TC-storage-058 の「250」がページ長のように読める

### backend-tag
- [W-001] domain/tag/ports/*.deleteByNote — 適合スイートが固定する削除ページの順序が契約に無い
- [W-002] application/note/deleteNotesForOwner.ts:OWNER_PURGE_BATCH_SIZE — バッチ 100 の根拠が Global D1 予算と噛み合わない
- [W-003] spec/domains/index.md:276 — note.ownerPurgeContinued の payload が stuckPurges を含まない
- [W-004] domain/integration/valueObject.ts:ExternalFileRef.create — trim せず空白のみの値が通る
- [W-005] adapters/cloudflare/do/schema.ts — tag_assignments.tag_id の FK CASCADE が落ちている

### frontend
- [B-001] components/note/NoteEditor/editor.tsx:commit — 自動保存の往復中に打った文字が保存済みとして捨てられる
- [W-001] components/note/NoteEditor/editor.tsx:applyMode — 占有を取れないとき確認だけ消えてモードが変わらない
- [W-002] components/note/NoteEditor/editor.tsx:busy — 往復を持たない操作まで自動保存のたびに止まる
- [W-003] components/note/NoteEditor/editor.tsx:EditorTarget — 判別ユニオンが sentinel へ展開され version = -1 が型で排除されていない
- [W-004] components/note/NoteEditor/editor.tsx:settleSaved — 新規作成の確定タイトルが応答ではなく生値
- [W-005] components/note/NoteEditor/editor.tsx:uploads — ビジュアルで「再試行」が生き残り本文に生の仮要素が入る
- [W-006] components/note/NoteEditor/surfaces.tsx:scrubForPreview — 未保存 HTML を live DOM へ入れる 3 経路のうち 1 つしか scrub していない
- [W-007] components/note/NoteEditor/editor.tsx:REVISION_REASON_LABEL — RevisionReason に無い 2 行を持つ
- [W-008] components/layout/ScopeToken/listing.ts:canWrite — 「知らない」と「持っていない」が同値
