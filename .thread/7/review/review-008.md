# PR Review #008 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-02
**Round:** 8回目

## Summary

- Blockers: 5
- Warnings: 17
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-008-backend-note.md（B: 2 / W: 3）
- backend-storage: review-008-backend-storage.md（B: 1 / W: 4）
- backend-tag: review-008-backend-tag.md（B: 0 / W: 3）
- frontend: review-008-frontend.md（B: 2 / W: 7）

## カバレッジ

- 確認申告ゼロのファイル: なし

## 前ラウンドの主張の検証結果（レビュアーの実測）

- `<template>` 包みの挙動同値は**正しい**。無作為 39 万件＋長さ 3 の全数 156 万件で差分 0、`tmplCount` 依存分岐 6 か所を全数確認しても差は `<form>` / `</template>` だけ（backend-note）
- `filterBlock` の `trim()` 除去は**過剰除去を生んでいない**。不動点 3 万件で破れ 0、適用される `fixed` の残存なし（backend-note）
- ED-04 の門は `setMode` 3 経路・`loadSurface` 4 経路すべてを網羅し**素通りする経路なし**（frontend）
- global statement の勘定は adapter で数え直して実装と一致。40/40/50 の分岐判断も妥当（backend-tag）
- `deleteByNote` の scope 鍵検査は 3 経路すべてに入りテストも個別に突いている（backend-tag）

## 指摘一覧

### backend-note
- [B-001] adapters/html/htmlProcessor.ts:TEMPLATE_SENSITIVE — 逃げ道が二次コストを復活させる（`<form></form>` 13 バイトで 364ms → 82,347ms）
- [B-002] adapters/html/htmlProcessor.ts — 節点数がどの上限にも掛からず collectHeadings が二次、520 KB で素の RangeError
- [W-001] adapters/html/htmlProcessor.ts:inlineStylesheets — 取り込んだ CSS を filterCss に通していない
- [W-002] adapters/html/__tests__/htmlProcessor.test.ts — TC-note-826 が逃げ道を通る入力を含まない
- [W-003] application/note/listNoteRevisions.ts — 版 1 件につき process 1 回の費用が spec に無い

### backend-storage
- [B-001] spec/domains/storage.md / uploadValidationPolicy.ts — MEDIA_SVG_MAX_BYTES の根拠が実測と食い違い、余裕が 1.74% しかない
- [W-001] application/storage/storeMedia.ts:processSvg — 翻訳が 1 コードだけで網羅性が偽の導出に依存
- [W-002] apps/web/app/routes/storage.$.tsx — 「失効の時点は purge」が回収に失敗した鍵をカバーしていない
- [W-003] spec/testcases/storage/collectOrphanMedia.md — limit の意味が冒頭と表で食い違う
- [W-004] spec/inventory/usecase.md UC-storage-010 — 台帳行が本ラウンドの設計変更を反映していない

### backend-tag
- [W-001] spec/platform/index.md / deleteNotesForOwner.ts — 同居と持ち回りを同じ余地から二重に払い、持ち回り集合に上限が無い
- [W-002] spec/database/index.md — 「すべての経路で検査する」が memory に掛からず inventory の限定付き表記と食い違う
- [W-003] spec/domains/index.md — 継続要求表の payload の書き方が 2 通りになった

### frontend
- [B-001] NoteEditor/editor.tsx:classify — 決定的な業務拒否の集合が閉じておらず新しいコードが failed に落ちる
- [B-002] NoteEditor/editor.tsx — コードから .thread/7/adr.md の ADR 番号を引いている（CLAUDE.md 違反）
- [W-001] NoteEditor/editor.tsx — blocked / locked でも版の「復元」だけ押せる
- [W-002] NoteEditor/editor.tsx — 退避の復元が立てた門を抜けると復元した未保存内容が正本で置き換わる
- [W-003] NoteEditor/editor.tsx:switchMode — 門の逃げ先まで端末の既定モードとして永続化する
- [W-004] NoteEditor/editor.tsx / surfaces.tsx — 「保存後の載せ直し」を門の 4 経路に数えているが原理的に立たない
- [W-005] NoteEditor/editor.tsx — failed の「再試行」が落ちた往復ではなく常に本文保存を実行する
- [W-006] spec/pages/index.md — WYSIWYG 警告のきっかけが門の拡張に追随していない
- [W-007] spec/manual-tests/editing.md — TC-13 手順 7 が P-15 未実装で実行不能なまま
